import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

/** Serve the WASM belonging to the host's Skia used by canonical UI, never a second version.
 * @param {string} hostManifest
 * @returns {import('vite').Plugin}
 */
export function skiaWebAssets(hostManifest) {
  const hostRequire = createRequire(hostManifest);
  const skiaRequire = createRequire(hostRequire.resolve('react-native-skia/package.json'));
  const wasmPath = skiaRequire.resolve('canvaskit-wasm/bin/full/canvaskit.wasm');
  let base = '/';
  return {
    name: 'canonical-ui-skia-assets',
    configResolved(config) { base = config.base; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== `${base}canvaskit/canvaskit.wasm`) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end();
          return;
        }
        try {
          const bytes = await readFile(wasmPath);
          res.setHeader('Content-Type', 'application/wasm');
          res.setHeader('Content-Length', bytes.length);
          res.setHeader('Cache-Control', 'no-cache');
          res.end(req.method === 'HEAD' ? undefined : bytes);
        } catch (error) {
          // Never return the HTML SPA fallback for a missing binary.
          res.statusCode = 503;
          res.setHeader('Content-Type', 'text/plain');
          res.end('CanvasKit unavailable. Reinstall the canonical UI dependencies.');
          server.config.logger.error(`CanvasKit read failed: ${String(error)}`);
        }
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'canvaskit/canvaskit.wasm', source: await readFile(wasmPath) });
    },
  };
}
