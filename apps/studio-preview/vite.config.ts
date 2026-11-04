import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const sourceUIRoot = process.env.STUDIO_UI_ROOT ?? fileURLToPath(new URL('../../../nyc-mon/packages/ui', import.meta.url));
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

const webExtensions = ['.web.mjs', '.mjs', '.web.js', '.js', '.web.ts', '.ts', '.web.tsx', '.tsx', '.json'];

export default defineConfig({
  // React Native Web Animated uses the RN global alias in lifecycle cleanup.
  define: { global: 'globalThis' },
  plugins: [tailwindcss(), engineBridge()],
  optimizeDeps: { esbuildOptions: { resolveExtensions: webExtensions, define: { global: 'globalThis' } } },
  resolve: {
    // React Native packages publish platform siblings without browser exports.
    extensions: webExtensions,
    alias: [
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
