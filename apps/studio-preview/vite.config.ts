import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { skiaWebAssets } from './skia-web-assets.mjs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const sourceUIRoot = process.env.STUDIO_UI_ROOT ?? fileURLToPath(new URL('../../../nyc-mon/packages/ui', import.meta.url));
const hostRequire = createRequire(import.meta.url);
const hostSkiaRoot = dirname(hostRequire.resolve('react-native-skia/package.json'));
const uiRequire = createRequire(resolve(sourceUIRoot, 'package.json'));
const legendMotionEsm = resolve(dirname(uiRequire.resolve('@legendapp/motion/package.json')), 'lib/module/index.js');
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

/** NYC-Tron styles RN primitives with `className`; route its `react-native`
 * imports to the RNW binding that forwards it (src/react-native-classname.tsx). */
function nycTronClassName(): Plugin {
  const shim = fileURLToPath(new URL('./src/react-native-classname.tsx', import.meta.url));
  // The react-native alias below runs first, so the id may already be RNW's entry.
  const rnw = createRequire(import.meta.url).resolve('react-native-web');
  return {
    name: 'nyc-tron-classname',
    enforce: 'pre',
    resolveId(source, importer) {
      const from = importer?.replaceAll('\\', '/') ?? '';
      if ((source === 'react-native' || source === rnw) && from.includes('/@nyc-tron/ui/')) return shim;
      // One React Native Web for the app and the binding: two copies run two responder systems.
      if (source === 'react-native-web' && from.endsWith('/react-native-classname.tsx')) return rnw;
      return null;
    },
  };
}

const webExtensions = ['.web.mjs', '.mjs', '.web.js', '.js', '.web.ts', '.ts', '.web.tsx', '.tsx', '.json'];

export default defineConfig({
  // React Native Web Animated uses the RN global alias in lifecycle cleanup.
  define: { global: 'globalThis', 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify('') },
  plugins: [nycTronClassName(), tailwindcss(), engineBridge(), skiaWebAssets(fileURLToPath(new URL('./package.json', import.meta.url)))],
  // Dependency pre-bundling resolves NYC-Tron's imports too, so it needs the same routing.
  // Listed up front: a late discovery re-optimizes mid-session and mixes dependency versions.
  optimizeDeps: { include: ['@nyc-tron/ui/components/forge/layers/LayerStack', '@nyc-tron/ui/components/forge/inputs/PrecisionScrubber',
    '@nyc-tron/ui/components/DragGrabHandle', '@nyc-tron/ui/components/gestures/PanResponderDrag'], rolldownOptions: { resolve: { extensions: webExtensions }, plugins: [nycTronClassName()] } },
  resolve: {
    // React Native packages publish platform siblings without browser exports.
    extensions: webExtensions,
    alias: [
    { find: /^react-native-skia$/, replacement: hostRequire.resolve('react-native-skia') },
    { find: /^react-native-skia\//, replacement: hostSkiaRoot + '/' },
    { find: /^@react-native\/assets-registry\/registry$/, replacement: hostRequire.resolve('react-native-web/dist/modules/AssetRegistry/index.js') },
    // Canonical Skia web components must not reach RN's Flow-only asset registry.
    { find: /^react-native\/(asset-registry|Libraries\/Image\/AssetRegistry)$/, replacement: createRequire(import.meta.url).resolve('react-native-web/dist/modules/AssetRegistry/index.js') },
    // Canonical Image uses Solito's Next image adapter. Resolve its peer from
    // this standalone host, not the adjacent source checkout's node_modules.
    { find: /^next\/image$/, replacement: createRequire(import.meta.url).resolve('next/image') },
    // The published root is an ESM star-export of CommonJS. Use the same
    // installed library's real ESM entry so Vite dev can expose named exports.
    { find: /^@legendapp\/motion$/, replacement: legendMotionEsm },
    { find: /^@acme\/ui\/studio-controls\/web$/, replacement: resolve(sourceUIRoot, 'studio-controls/web.tsx') },
    { find: /^@acme\/ui\/studio-controls$/, replacement: resolve(sourceUIRoot, 'studio-controls/index.tsx') },
    { find: /^@acme\/ui\/html$/, replacement: resolve(sourceUIRoot, 'html/index.tsx') },
    { find: /^react-native-svg$/, replacement: createRequire(import.meta.url).resolve('react-native-svg/lib/module/ReactNativeSVG.web.js') },
    { find: /^react-native$/, replacement: createRequire(import.meta.url).resolve('react-native-web') },
    { find: 'react-native-nitro-modules', replacement: fileURLToPath(new URL('./src/native-unavailable.ts', import.meta.url)) },
  ], dedupe: ['react', 'react-dom', 'react-native-web'] },
  server: { host: '127.0.0.1', port: 4173, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url)), sourceUIRoot, resolve(sourceUIRoot, '..')] } },
});
