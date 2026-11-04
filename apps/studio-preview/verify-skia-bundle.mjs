import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const uiRoot = process.env.STUDIO_UI_ROOT ?? fileURLToPath(new URL('../../../nyc-mon/packages/ui', import.meta.url));
const fixture = await mkdtemp(join(root, '.skia-check-'));
try {
  // Exercise the real canonical web wrapper/gate/drawing chain, not a clone.
  await writeFile(join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="./entry.tsx"></script>');
  await writeFile(join(fixture, 'entry.tsx'), `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { Arrow } from ${JSON.stringify(resolve(uiRoot, 'cursors/arrow.web.tsx'))};\ncreateRoot(document.getElementById('root')!).render(<Arrow size={120} fill="#ff8800" outline="#ffffff" />);`);
  const outDir = join(fixture, 'dist');
  await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'error', build: { outDir, rolldownOptions: { input: join(fixture, 'index.html') } } });
  const wasm = await readFile(join(outDir, 'canvaskit/canvaskit.wasm'));
  assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109]);
  const assets = await readdir(join(outDir, 'assets'));
  assert.ok(assets.some(name => name.startsWith('arrow.skia-')), 'Drawing must remain a deferred chunk');
  console.log('PASS: canonical Arrow → SkiaWebGate → deferred drawing bundles with CanvasKit WASM. Browser pixels not tested.');
} finally {
  await rm(fixture, { recursive: true, force: true });
}
