import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PRISM_LAYER_LIST_MIN_HEIGHT, PRISM_LAYERS_HEAD_HEIGHT } from '../../packages/studio-workspace/src/prism-layout.ts';

// F3 B-11 in Chromium: opens Prism in the Vite dev host (real engines through
// the loopback nf-cli bridge; `cargo build --locked -p nf-cli` first) and
// checks the Layers panel's blend mode menu, Straight alpha text and opacity
// scrubber:
// - 1280x1000, one layer: the blend menu commits Multiply to the engine and
//   Undo restores Normal; two presses of "−" take opacity from 100 % to 98 %.
// - 1280x1000 and 1024x768 with six layers: the mode menu and every part of
//   the opacity scrubber are on screen and hit-testable, with nothing scrolled.
// - Forced colours (emulated): the opacity track paints its scale in system
//   colours. Checked through computed styles: ticks inside the track opt out
//   of forced-colour adjustment and keep a non-transparent background.
// Pass a directory to also save full-viewport PNGs of the six-layer states,
// captured before any blend or opacity interaction, with no page changes.
const captureDir = process.argv[2];
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const port = 4189;
const base = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'inherit' });
let serverExited = false;
const serverExit = new Promise(done => server.once('exit', () => { serverExited = true; done(); }));
let browser;
const failures = [];
/** Run one scenario; record its failure and carry on, so one run reports every regression. */
const scenario = async (name, body) => {
  try { await body(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${error.message.split('\n').join('\n  ')}`); }
};

async function openPrism(viewport, options = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  if (options.forcedColors) await page.emulateMedia({ forcedColors: 'active' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack ?? String(error)));
  await page.goto(base, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'All applications' }).waitFor({ timeout: 90_000 });
  await page.getByText('Open Prism').first().click();
  const panel = page.getByTestId('prism-layers');
  // Below the docked width the panel starts closed; the toolbar opens it.
  await page.getByRole('button', { name: 'Layers', exact: true }).first().waitFor({ timeout: 60_000 });
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'Layers', exact: true }).first().click();
  const blend = panel.getByRole('button', { name: 'Layer blend mode', exact: true });
  await blend.waitFor({ timeout: 60_000 });
  return { context, page, panel, blend, pageErrors };
}

/** The opacity scrubber's parts, as a user meets them. */
const opacityParts = panel => ({
  label: panel.getByText('Layer opacity', { exact: true }),
  track: panel.getByRole('slider', { name: 'Layer opacity', exact: true }),
  decrease: panel.getByRole('button', { name: 'Decrease Layer opacity', exact: true }),
  increase: panel.getByRole('button', { name: 'Increase Layer opacity', exact: true }),
});

/** On screen and not hidden under a scroll fold: the browser's own hit test lands on it at its corners and centre. */
async function assertReachable(name, locator) {
  assert.equal(await locator.count(), 1, `${name}: exactly one`);
  const hit = await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const points = [[r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
    const misses = points.filter(([x, y]) => { const at = document.elementFromPoint(x, y); return !at || !el.contains(at); });
    let scrolled = 0;
    for (let node = el.parentElement; node; node = node.parentElement) scrolled += node.scrollTop;
    return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], misses, scrolled, viewport: [innerWidth, innerHeight] };
  });
  assert.equal(hit.scrolled, 0, `${name}: reached without scrolling`);
  assert.deepEqual(hit.misses, [], `${name} at ${JSON.stringify(hit.rect)} in ${hit.viewport.join('x')} is covered, clipped or off screen`);
}

async function addRectangles(page, panel, count) {
  for (let i = 0; i < count; i += 1) {
    const before = await panel.getByTestId('prism-layer-stack').getByText(/^(Layer|Rectangle) \d+$/).count();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).first().click();
    await panel.getByTestId('prism-layer-stack').getByText(`Rectangle ${before + 1}`, { exact: true }).waitFor({ timeout: 30_000 });
  }
}

try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (serverExited) throw new Error('Studio server exited before readiness');
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error('Studio server did not become ready in 60 seconds');
    await new Promise(done => setTimeout(done, 200));
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  if (captureDir) mkdirSync(captureDir, { recursive: true });

  await scenario('1280x1000: Straight alpha text, one opacity owner, Multiply commit and Undo', async () => {
    const { context, page, panel, blend, pageErrors } = await openPrism({ width: 1280, height: 1000 });
    try {
      assert.equal(await panel.getByText('Layer opacity', { exact: true }).count(), 1, 'one Layer opacity control in the Layers panel');
      assert.equal(await panel.getByRole('button', { name: 'Layer alpha representation', exact: true }).count(), 0, 'no alpha menu');
      assert.ok(await panel.getByText('Straight alpha', { exact: true }).isVisible(), 'Straight alpha is shown');
      assert.equal(await page.getByText('Premultiplied alpha').count(), 0, 'Premultiplied is not offered');
      assert.equal(await page.getByTestId('prism-detail-controls').getByRole('button', { name: 'Layer blend mode', exact: true }).count(), 0, 'no second blend panel in the detail controls');
      assert.equal(await blend.innerText(), 'Normal');
      const panelBox = await panel.boundingBox(), rowBox = await panel.getByTestId('prism-layer-stack').getByText('Layer 1', { exact: true }).boundingBox();
      assert.ok(panelBox && rowBox && rowBox.height > 0 && rowBox.y >= panelBox.y && rowBox.y + rowBox.height <= panelBox.y + panelBox.height, 'the layer row is inside the Layers panel');
      // The menu's commit is one setLayerBlend; the panel re-reads the engine.
      await blend.click();
      await page.getByText('Multiply', { exact: true }).last().click();
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Layer blend mode"]')].some(el => el.textContent === 'Multiply'), null, { timeout: 30_000 });
      // Undo is the engine's: the mode goes back to Normal.
      await page.getByTestId('workspace-undo').first().click();
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Layer blend mode"]')].some(el => el.textContent === 'Normal'), null, { timeout: 30_000 });
      assert.deepEqual(pageErrors, [], 'no uncaught errors');
    } finally { await context.close(); }
  });

  await scenario('1280x1000: two presses of "−" take opacity from 100 % to 98 %', async () => {
    const { context, panel, pageErrors } = await openPrism({ width: 1280, height: 1000 });
    try {
      const { track, decrease } = opacityParts(panel);
      assert.equal(await track.getAttribute('aria-valuetext'), '100%');
      for (const expected of ['99%', '98%']) {
        await decrease.click();
        // Each press is one setLayerOpacity; the value shown is the engine's after reload.
        try { await track.and(panel.locator(`[aria-valuetext="${expected}"]`)).waitFor({ timeout: 10_000 }); }
        catch { throw new Error(`after "−" opacity reads ${await track.getAttribute('aria-valuetext')}, expected ${expected}`); }
      }
      assert.deepEqual(pageErrors, [], 'no uncaught errors');
    } finally { await context.close(); }
  });

  for (const [width, height] of [[1280, 1000], [1024, 768]]) {
    await scenario(`${width}x${height}, six layers: mode menu and the whole opacity scrubber reachable without scrolling`, async () => {
      const { context, page, panel, blend, pageErrors } = await openPrism({ width, height });
      try {
        await addRectangles(page, panel, 5);
        await page.mouse.move(0, 0);
        if (captureDir) await page.screenshot({ path: join(captureDir, `f3-b11-layers-six-${width}x${height}.png`) });
        await assertReachable('Layer blend mode menu', blend);
        await assertReachable('"Straight alpha"', panel.getByText('Straight alpha', { exact: true }));
        for (const [part, locator] of Object.entries(opacityParts(panel))) await assertReachable(`opacity ${part}`, locator);
        // prism-layout.ts budgets this much of the panel for everything but the list.
        const panelBox = await panel.boundingBox(), listBox = await panel.getByTestId('prism-layer-stack').boundingBox();
        const head = Math.ceil(panelBox.height - listBox.height);
        const editorBox = await page.getByTestId('prism-editor').boundingBox(), fillBox = await page.getByTestId('prism-fill-bar').boundingBox();
        const round = box => [box.x, box.y, box.width, box.height].map(Math.round).join(',');
        console.log(`  ${width}x${height}: editor [${round(editorBox)}], fill bar [${round(fillBox)}], panel [${round(panelBox)}], list ${Math.round(listBox.height)} px, head ${head} px (budget ${PRISM_LAYERS_HEAD_HEIGHT})`);
        const lower = panel.getByRole('button', { name: 'Lower', exact: true });
        const body = await panel.getByTestId('prism-layers-body').evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
        if (body.scrollHeight <= body.clientHeight + 1) {
          // Everything fits: the list keeps at least one row and Raise/Lower close the panel.
          assert.ok(head <= PRISM_LAYERS_HEAD_HEIGHT, `the drawn head is ${head} px, over the ${PRISM_LAYERS_HEAD_HEIGHT} px layout budget`);
          assert.ok(listBox.height >= PRISM_LAYER_LIST_MIN_HEIGHT - 1, `the layer list is ${Math.round(listBox.height)} px, under one ${PRISM_LAYER_LIST_MIN_HEIGHT} px row`);
          // Raise is disabled on the top layer, so only Lower takes a hit test.
          await assertReachable('Lower', lower);
        } else {
          // Too short an editor for head and rows: the body scrolls, head first.
          console.log(`  ${width}x${height}: the panel body scrolls (${body.scrollHeight} px in ${body.clientHeight} px); rows and Raise/Lower are below the head`);
          assert.ok(listBox.height >= PRISM_LAYER_LIST_MIN_HEIGHT - 1, `the layer list is ${Math.round(listBox.height)} px, under one ${PRISM_LAYER_LIST_MIN_HEIGHT} px row`);
          await lower.scrollIntoViewIfNeeded();
          const lowerBox = await lower.boundingBox(), panelNow = await panel.boundingBox();
          assert.ok(lowerBox.y >= panelNow.y && lowerBox.y + lowerBox.height <= panelNow.y + panelNow.height + 1, 'scrolling the panel body brings Lower inside the panel');
        }
        assert.deepEqual(pageErrors, [], 'no uncaught errors');
      } finally { await context.close(); }
    });
  }

  await scenario('forced colours: the opacity track paints its scale in system colours', async () => {
    const { context, panel, pageErrors } = await openPrism({ width: 1280, height: 1000 }, { forcedColors: true });
    try {
      const { track } = opacityParts(panel);
      const ink = await track.evaluate(el => {
        const painted = [...el.querySelectorAll('*')].filter(node => {
          const style = getComputedStyle(node);
          return style.forcedColorAdjust === 'none' && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && node.getBoundingClientRect().width > 0;
        });
        return { painted: painted.length, sample: painted[0] ? getComputedStyle(painted[0]).backgroundColor : null };
      });
      assert.ok(ink.painted >= 5, `the track has ${ink.painted} scale marks painted through forced colours (sample ${ink.sample}); without them it renders blank`);
      assert.deepEqual(pageErrors, [], 'no uncaught errors');
    } finally { await context.close(); }
  });

  if (failures.length) throw new Error(`${failures.length} B-11 check(s) failed: ${failures.join('; ')}`);
  console.log('Prism Layers panel: blend menu, Straight alpha text and opacity scrubber pass in Chromium');
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
