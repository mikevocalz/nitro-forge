import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// F3 B-11 in Chromium: opens Prism in the Vite dev host (real engines through
// the loopback nf-cli bridge; `cargo build --locked -p nf-cli` first), checks
// the Layers panel's LayerBlendAndOpacity and drives its blend mode menu, so
// the mounted onCommit reaches the engine. Pass a PNG path to also save the
// Layers panel as shipped, captured before any interaction and without
// changing the page's layout.
const capture = process.argv[2];
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const port = 4189;
const base = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'inherit' });
let serverExited = false;
const serverExit = new Promise(done => server.once('exit', () => { serverExited = true; done(); }));
let browser;

try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (serverExited) throw new Error('Studio server exited before readiness');
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error('Studio server did not become ready in 60 seconds');
    await new Promise(done => setTimeout(done, 200));
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack ?? String(error)));
  await page.goto(base, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'All applications' }).waitFor({ timeout: 90_000 });
  await page.getByText('Open Prism').first().click();

  const panel = page.getByTestId('prism-layers');
  const blend = panel.getByRole('button', { name: 'Layer blend mode', exact: true });
  await blend.waitFor({ timeout: 60_000 });
  // One opacity owner in the panel for the selected layer; Straight alpha is text, not a menu.
  assert.equal(await panel.getByText('Layer opacity', { exact: true }).count(), 1, 'one Layer opacity control in the Layers panel');
  assert.equal(await panel.getByRole('button', { name: 'Layer alpha representation', exact: true }).count(), 0, 'no alpha menu');
  assert.ok(await panel.getByText('Straight alpha', { exact: true }).isVisible(), 'Straight alpha is shown');
  assert.equal(await page.getByText('Premultiplied alpha').count(), 0, 'Premultiplied is not offered');
  assert.equal(await page.getByTestId('prism-detail-controls').getByRole('button', { name: 'Layer blend mode', exact: true }).count(), 0, 'no second blend panel in the detail controls');
  assert.equal(await blend.innerText(), 'Normal');
  // The blend section scrolls; the layer rows stay inside the panel.
  const panelBox = await panel.boundingBox(), rowBox = await panel.getByTestId('prism-layer-stack').getByText('Layer 1', { exact: true }).boundingBox();
  assert.ok(panelBox && rowBox && rowBox.height > 0 && rowBox.y >= panelBox.y && rowBox.y + rowBox.height <= panelBox.y + panelBox.height, 'the layer row is inside the Layers panel');
  if (capture) await panel.screenshot({ path: capture });

  // The menu's commit is one setLayerBlend; the panel re-reads the engine.
  await blend.click();
  await page.getByText('Multiply', { exact: true }).last().click();
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Layer blend mode"]')].some(el => el.textContent === 'Multiply'), null, { timeout: 30_000 });
  // Undo is the engine's: the mode goes back to Normal.
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Layer blend mode"]')].some(el => el.textContent === 'Normal'), null, { timeout: 30_000 });
  assert.deepEqual(pageErrors, [], 'no uncaught errors');
  console.log('Prism Layers panel: blend mode Multiply committed to the engine and undone; Straight alpha only');
} finally {
  await browser?.close();
  if (!serverExited) {
    server.kill('SIGTERM');
    let graceTimer;
    await Promise.race([serverExit, new Promise(done => { graceTimer = setTimeout(done, 5000); })]);
    clearTimeout(graceTimer);
    if (!serverExited) { server.kill('SIGKILL'); await serverExit; }
  }
}
