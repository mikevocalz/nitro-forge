import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const hostRequire = createRequire(import.meta.url);
import { CliHost } from '../../packages/ignition/src/host-cli';
import type { EngineKind, Command } from '../../packages/ignition/src/types';

function engineBridge(): Plugin {
  return {
    name: 'loopback-rust-engines',
    configureServer(server) {
      const host = new CliHost(fileURLToPath(new URL('../../target/debug/nf-cli', import.meta.url)));
      server.httpServer?.once('close', () => { void host.dispose(); });
      server.middlewares.use('/api/engine', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const expectedOrigin = `http://${req.headers.host}`;
        if (req.method !== 'POST' || req.headers.origin !== expectedOrigin
          || !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '')
          || !req.headers['content-type']?.startsWith('application/json')) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: 'Same-origin loopback POST required' }));
          return;
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 16 * 1024 * 1024) throw new Error('Request too large');
          }
          const { op, args } = JSON.parse(body) as { op: string; args: unknown[] };
          if (!Array.isArray(args)) throw new Error('Invalid arguments');
          let data: unknown;
          switch (op) {
            case 'open': data = await host.open(args[0] as EngineKind); break;
            case 'apply': data = await host.apply(args[0] as number, args[1] as Command); break;
            case 'snapshot': data = Array.from(await host.snapshot(args[0] as number)); break;
            case 'restore': await host.restore(args[0] as number, new Uint8Array(args[1] as number[])); break;
            case 'undo': data = await host.undo(args[0] as number); break;
            case 'redo': data = await host.redo(args[0] as number); break;
            case 'close': data = await host.close(args[0] as number); break;
            default: throw new Error('Unknown engine operation');
          }
          res.end(JSON.stringify({ data }));
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

/** NYC-Tron styles RN primitives with `className`; route the `react-native`
 * imports of every @nyc-tron package to the RNW binding that forwards it
 * (src/react-native-classname.tsx). */
function nycTronClassName(): Plugin {
  const shim = fileURLToPath(new URL('./src/react-native-classname.tsx', import.meta.url));
  // The react-native alias below runs first, so the id may already be RNW's entry.
  const rnw = createRequire(import.meta.url).resolve('react-native-web');
  return {
    name: 'nyc-tron-classname',
    enforce: 'pre',
    resolveId(source, importer) {
      const from = importer?.replaceAll('\\', '/') ?? '';
      if ((source === 'react-native' || source === rnw) && from.includes('/@nyc-tron/')) return shim;
      // One React Native Web for the app and the binding: two copies run two responder systems.
      // Resolved as the app's own `react-native` import, so dev serves the optimized copy.
      if (source === 'react-native-web' && from.endsWith('/react-native-classname.tsx')) return this.resolve('react-native', importer, { skipSelf: true });
      return null;
    },
  };
}

/** react-native-gesture-handler probes Reanimated internals by source path
 * (`react-native-reanimated/src/createAnimatedComponent/AnimatedComponent`).
 * That path is TypeScript, which dependency pre-bundling leaves external, so the
 * browser loaded Reanimated's raw sources and failed on its CommonJS version
 * check. Point those probes at the compiled `lib/module` build, the copy the
 * package's main entry already loads, so the page holds one Reanimated. */
function reanimatedCompiledSubpaths(): Plugin {
  const sourcePath = /^react-native-reanimated\/src\//;
  return {
    name: 'reanimated-compiled-subpaths',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!sourcePath.test(source)) return null;
      return this.resolve(source.replace(sourcePath, 'react-native-reanimated/lib/module/'), importer, { skipSelf: true });
    },
  };
}

/** React Native libraries read Metro's `__DEV__` global at module scope
 * (react-native-gesture-handler's createHandler does), so define it per mode. */
function reactNativeDevFlag(): Plugin {
  return { name: 'react-native-dev-flag', config: (_, { mode }) => ({ define: { __DEV__: JSON.stringify(mode !== 'production') } }) };
}

/** Every NYC-Tron entry the app or studio-workspace imports on web. */
const nycTronEntries = [
  '@nyc-tron/ui/components/forge/layers/LayerStack', '@nyc-tron/ui/components/forge/inputs/PrecisionScrubber',
  '@nyc-tron/ui/components/DragGrabHandle', '@nyc-tron/ui/components/gestures/PanResponderDrag',
  '@nyc-tron/ui/components/Button', '@nyc-tron/ui/components/Card', '@nyc-tron/ui/components/SegmentedControl',
  '@nyc-tron/ui/components/TabBar', '@nyc-tron/ui/components/Toolbar', '@nyc-tron/ui/components/List',
  '@nyc-tron/ui/components/IconButton', '@nyc-tron/ui/components/FieldGroup', '@nyc-tron/ui/components/feedback/Banner',
  '@nyc-tron/ui/components/feedback/Badge', '@nyc-tron/ui/components/feedback/EmptyState', '@nyc-tron/ui/components/feedback/ErrorMessage',
  '@nyc-tron/ui/components/content/KeyValueList', '@nyc-tron/ui/components/theme/NightScope', '@nyc-tron/ui/components/files/DropZone',
  '@nyc-tron/ui/components/files/FilePicker', '@nyc-tron/ui/components/html',
  '@nyc-tron/expo-controls/Select', '@nyc-tron/expo-controls/NativeActionMenu',
];

const webExtensions = ['.web.mjs', '.mjs', '.web.js', '.js', '.web.ts', '.ts', '.web.tsx', '.tsx', '.json'];

export default defineConfig({
  // React Native Web Animated uses the RN global alias in lifecycle cleanup.
  define: { global: 'globalThis', 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify('') },
  plugins: [reactNativeDevFlag(), reanimatedCompiledSubpaths(), nycTronClassName(), tailwindcss(), engineBridge()],
  // Dependency pre-bundling resolves NYC-Tron's imports too, so it needs the same routing.
  // Listed up front: a late discovery re-optimizes mid-session and mixes dependency versions.
  optimizeDeps: { include: nycTronEntries, rolldownOptions: { resolve: { extensions: webExtensions }, plugins: [reanimatedCompiledSubpaths(), nycTronClassName()] } },
  resolve: {
    // React Native packages publish platform siblings without browser exports.
    extensions: webExtensions,
    alias: [
    { find: /^@react-native\/assets-registry\/registry$/, replacement: hostRequire.resolve('react-native-web/dist/modules/AssetRegistry/index.js') },
    // React Native packages must not reach RN's Flow-only asset registry.
    { find: /^react-native\/(asset-registry|Libraries\/Image\/AssetRegistry)$/, replacement: createRequire(import.meta.url).resolve('react-native-web/dist/modules/AssetRegistry/index.js') },
    { find: /^react-native-svg$/, replacement: createRequire(import.meta.url).resolve('react-native-svg/lib/module/ReactNativeSVG.web.js') },
    { find: /^react-native$/, replacement: createRequire(import.meta.url).resolve('react-native-web') },
    { find: 'react-native-nitro-modules', replacement: fileURLToPath(new URL('./src/native-unavailable.ts', import.meta.url)) },
  ], dedupe: ['react', 'react-dom', 'react-native-web'] },
  server: { host: '127.0.0.1', port: 4173, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
});
