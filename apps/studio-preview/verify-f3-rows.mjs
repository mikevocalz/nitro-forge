import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// F3 I-15 and E-35 in Chromium: opens Tally and Cadence in the Vite dev host
// (real engines through the loopback nf-cli bridge; `cargo build --locked -p nf-cli`
// first) and drives both rows through the visible controls only. No store or
// engine calls are injected; the script reads the bridge traffic the page sends.
// - I-15 Tally PivotFieldList: A1=5, A2=7, A3=SUM(A1:A2). Selecting A1:A3 and
//   putting Column A in filters keeps a host draft (no engine write). Adding it
//   to values creates the pivot with an empty ("All") filter. Refresh writes the
//   unfiltered total; Undo removes the output and keeps the pivot; Redo restores it.
// - E-35 Cadence BeatDetectionMarkerLane: a MIDI track with the C-major command
//   clip, its second note softened in the velocity lane. Detection at sensitivity
//   0, then 1, each sends that sensitivity; 1 finds the quieter onset that 0 does
//   not. Each run adds markers as one undo step; Undo and Redo move a whole run. Renaming a marker in
//   the lane sends updateMarker with the name only, and the marker keeps its ticks.
// Pass a directory to also save one full-viewport PNG per row and the observed
// bridge requests and responses for the marker rename.
const captureDir = process.argv[2];
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const port = 4192;
const base = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'inherit' });
let serverExited = false;
const serverExit = new Promise(done => server.once('exit', () => { serverExited = true; done(); }));
let browser;
const failures = [];
const scenario = async (name, body) => {
  try { await body(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${error.message.split('\n').join('\n  ')}`); }
};

/** Opens an app and records every engine op the page sends, with its parsed response. */
async function openApp(app) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [], ops = [];
  page.on('pageerror', error => pageErrors.push(error.stack ?? String(error)));
  // Record each op when its request is sent, so `ops` keeps request order;
  // the parsed response is filled in later. Recording on response completion
  // let a slower, older listMarkers land after a newer one.
  const pending = new Map();
  page.on('request', request => {
    if (!request.url().endsWith('/api/engine') || request.method() !== 'POST') return;
    let body; try { body = JSON.parse(request.postData() ?? 'null'); } catch { return; }
    if (body?.op !== 'apply') return;
    const op = body.args?.[1];
    const entry = { op: op?.op, payload: op?.payload, result: null };
    ops.push(entry);
    pending.set(request, entry);
  });
  page.on('response', async response => {
    const entry = pending.get(response.request());
    if (!entry) return;
    pending.delete(response.request());
    try { entry.result = JSON.parse(await response.text()); } catch { /* closed page */ }
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'All applications' }).waitFor({ timeout: 90_000 });
  await page.getByText(`Open ${app}`).first().click();
  await page.getByRole('button', { name: 'Undo', exact: true }).first().waitFor({ timeout: 60_000 });
  return { context, page, pageErrors, ops };
}
const opsNamed = (ops, name) => ops.filter(entry => entry.op === name);
const cell = (page, address) => page.getByRole('cell', { name: new RegExp(`^${address},`) });
async function cellLabel(page, address) { return (await cell(page, address).getAttribute('aria-label')) ?? ''; }
async function waitForCell(page, address, pattern) {
  try { await page.waitForFunction(([a, p]) => [...document.querySelectorAll('[role="cell"]')].some(el => (el.getAttribute('aria-label') ?? '').startsWith(`${a},`) && new RegExp(p).test(el.getAttribute('aria-label'))), [address, pattern.source], { timeout: 15_000 }); }
  catch { throw new Error(`${address} reads "${await cellLabel(page, address)}", expected ${pattern}`); }
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

  await scenario('I-15 Tally: filters-only draft stays in the host; All filter refreshes to the unfiltered total; Undo/Redo', async () => {
    const { context, page, pageErrors, ops } = await openApp('Tally');
    try {
      const formula = page.getByRole('textbox', { name: 'Formula bar', exact: true });
      for (const [address, input] of [['A1', '5'], ['A2', '7'], ['A3', '=SUM(A1:A2)']]) {
        await cell(page, address).click();
        await formula.fill(input);
        await formula.press('Enter');
      }
      await waitForCell(page, 'A3', /^A3, 12\b/);
      const nameBox = page.getByRole('textbox', { name: 'Cell address or range name', exact: true });
      await nameBox.fill('A1:A3');
      await page.getByRole('button', { name: 'Go to range', exact: true }).click();
      await page.getByRole('tab', { name: 'Pivot', exact: true }).click();
      const panel = page.getByTestId('tally-pivot-panel');
      await panel.getByText('This sheet has no pivot.', { exact: true }).waitFor({ timeout: 30_000 });
      await panel.getByRole('button', { name: 'Use selection as pivot source', exact: true }).click();
      await panel.getByText(/^Draft pivot over A1:A3\./).waitFor({ timeout: 30_000 });

      // Filters only: the host keeps a draft until a value exists. No pivot op reaches the engine.
      const before = ops.length;
      await panel.getByRole('button', { name: 'Add Column A to filters', exact: true }).click();
      await page.waitForTimeout(1000);
      assert.ok(await panel.getByText(/^Draft pivot over A1:A3\./).isVisible(), 'still a draft after a filters-only assignment');
      const pivotWrites = ops.slice(before).filter(entry => /Pivot/.test(entry.op ?? '') && !/^(listPivots|describePivot|getPivot)/.test(entry.op));
      assert.deepEqual(pivotWrites.map(entry => entry.op), [], 'no pivot write for a draft without a value');

      // A value: one insertPivot whose filter has no values ("All").
      await panel.getByRole('button', { name: 'Add Column A to values', exact: true }).click();
      await panel.getByText(/^Pivot \S+ reads A1:A3; its output starts at C1\./).waitFor({ timeout: 30_000 });
      const inserts = opsNamed(ops, 'insertPivot');
      assert.equal(inserts.length, 1, `one insertPivot, saw ${inserts.length}`);
      console.log(`  insertPivot payload: ${JSON.stringify(inserts[0].payload)}`);
      const filters = inserts[0].payload?.pivot?.filters;
      assert.ok(Array.isArray(filters) && filters.length === 1, 'the pivot carries one filter');
      const values = filters[0].values;
      assert.deepEqual(values, [], `the filter is "All" (an empty value list), got ${JSON.stringify(filters[0])}`);

      // Refresh: the All filter admits every record, so the sum is 5 + 7 + 12 = 24.
      await panel.getByRole('button', { name: 'Refresh pivot output', exact: true }).click();
      await waitForCell(page, 'C2', /^C2, 24\b/);
      console.log(`  after refresh: C1 "${await cellLabel(page, 'C1')}", C2 "${await cellLabel(page, 'C2')}"`);
      await page.mouse.move(0, 0);
      if (captureDir) await page.screenshot({ path: join(captureDir, 'f3-i15-tally-all-filter-refreshed-1280x1000.png') });

      // Undo removes the refresh output only; the pivot definition and the source stay.
      await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
      await waitForCell(page, 'C2', /^C2, empty\b/);
      await waitForCell(page, 'C1', /^C1, empty\b/);
      // The panel re-reads pivots after every reload; wait for that read to settle.
      try { await panel.getByText(/^Pivot \S+ reads A1:A3;/).waitFor({ timeout: 15_000 }); }
      catch { throw new Error(`the pivot definition is gone after Undo of the refresh; the panel reads: ${(await panel.innerText()).slice(0, 300)}`); }
      for (const [address, pattern] of [['A1', /^A1, 5\b/], ['A2', /^A2, 7\b/], ['A3', /^A3, 12\b/]]) await waitForCell(page, address, pattern);
      await page.getByRole('button', { name: 'Redo', exact: true }).first().click();
      await waitForCell(page, 'C2', /^C2, 24\b/);
      assert.deepEqual(pageErrors, [], 'no uncaught errors');
    } finally { await context.close(); }
  });

  await scenario('E-35 Cadence: detectBeats at sensitivity 0 and 1, one undo step per run, marker rename keeps ticks', async () => {
    const { context, page, pageErrors, ops } = await openApp('Cadence');
    try {
      await page.getByRole('tab', { name: 'Commands', exact: true }).click();
      await page.getByRole('button', { name: 'Add MIDI track', exact: true }).last().click();
      await page.getByRole('button', { name: 'Add C-major clip to first track', exact: true }).click();
      // Soften the clip's second note in the MIDI tab's velocity lane (keyboard on the
      // slider), so a quiet onset exists that only the higher sensitivity picks up.
      await page.getByRole('tab', { name: 'MIDI', exact: true }).click();
      const velocity = page.getByRole('slider', { name: 'Velocity of E4 note 2', exact: true });
      await velocity.focus();
      for (let guard = 0; Number(await velocity.getAttribute('aria-valuenow')) > 30 && guard < 200; guard += 1) await velocity.press('ArrowDown');
      const softened = Number(await velocity.getAttribute('aria-valuenow'));
      await page.getByRole('button', { name: `E4, beat 1.33, 0.33 beats long, velocity ${softened}`, exact: true }).waitFor({ timeout: 15_000 });
      console.log(`  E4 note 2 velocity set to ${softened} through the velocity lane`);
      await page.getByRole('tab', { name: 'Analysis', exact: true }).click();
      const beatTab = page.getByRole('tab', { name: 'Beat markers', exact: true });
      await beatTab.click();
      const lane = page.getByTestId('cadence-beat-lane');
      await lane.getByText('No markers yet. Detect beats, or add one at the playhead.', { exact: true }).waitFor({ timeout: 30_000 });
      const sensitivity = lane.getByRole('textbox', { name: 'Beat detection sensitivity value', exact: true });
      const detectButton = lane.getByRole('button', { name: 'Detect clip beats', exact: true });
      const markerSliders = lane.getByRole('list', { name: 'Markers', exact: true }).getByRole('slider');
      const summary = value => lane.getByText(new RegExp(`^Sensitivity ${value}: (\\d+) onsets? found, (no new markers|(\\d+) markers? added in one undo step)\\.$`));
      const detect = async value => {
        await sensitivity.fill(String(value));
        await sensitivity.press('Enter');
        const sent = opsNamed(ops, 'detectBeats').length;
        await detectButton.click();
        const line = summary(value.toFixed(2));
        await line.waitFor({ timeout: 60_000 });
        const calls = opsNamed(ops, 'detectBeats');
        assert.equal(calls.length, sent + 1, 'one detectBeats per run');
        assert.equal(calls.at(-1).payload.sensitivity, value, `detectBeats carries sensitivity ${value}`);
        const [, found, , added] = (await line.innerText()).match(/^Sensitivity [\d.]+: (\d+) onsets? found, (no new markers|(\d+) markers? added)/);
        return { found: Number(found), added: Number(added ?? 0) };
      };
      const expectMarkers = async count => {
        try { await page.waitForFunction(([n]) => document.querySelectorAll('[data-testid="cadence-beat-lane"] [role="list"][aria-label="Markers"] [role="slider"]').length === n, [count], { timeout: 15_000 }); }
        catch { throw new Error(`the lane shows ${await markerSliders.count()} markers, expected ${count}`); }
      };
      const undo = page.getByRole('button', { name: 'Undo', exact: true }).first(), redo = page.getByRole('button', { name: 'Redo', exact: true }).first();

      const low = await detect(0);
      console.log(`  sensitivity 0: ${low.found} onsets, ${low.added} added`);
      assert.ok(low.added > 0, 'sensitivity 0 adds markers');
      await expectMarkers(low.added);
      await undo.click();
      await lane.getByText('No markers yet. Detect beats, or add one at the playhead.', { exact: true }).waitFor({ timeout: 15_000 });
      await redo.click();
      await expectMarkers(low.added);

      const high = await detect(1);
      console.log(`  sensitivity 1: ${high.found} onsets, ${high.added} added`);
      assert.ok(high.found > low.found, `sensitivity 1 finds more onsets than 0 (${high.found} vs ${low.found})`);
      assert.ok(high.added > 0, 'sensitivity 1 adds the quieter onset');
      await expectMarkers(low.added + high.added);
      await undo.click(); await expectMarkers(low.added);
      await redo.click(); await expectMarkers(low.added + high.added);
      const addCalls = opsNamed(ops, 'addMarkers');
      assert.ok(addCalls.length >= 1 && addCalls.every(entry => entry.op === 'addMarkers'), 'markers are written with addMarkers');

      // Rename the first marker through the lane's name field, then blur.
      const latestList = opsNamed(ops, 'listMarkers').at(-1);
      for (let i = 0; i < 50 && latestList.result === null; i++) await page.waitForTimeout(100);
      const listed = latestList.result.data.data.markers;
      // A stale list from before the Redo would hold fewer markers than the lane shows.
      assert.equal(listed.length, low.added + high.added, `the latest listMarkers reflects the Redo, saw ${listed.length}`);
      const first = listed[0];
      // Each run numbers its markers from "Beat 1", so pick the earliest marker by position.
      const firstSlider = markerSliders.first();
      assert.equal(await firstSlider.getAttribute('aria-label'), `Marker ${first.name}`, 'the lane lists markers in tick order');
      await firstSlider.click();
      const nameField = lane.getByRole('textbox', { name: 'Marker name', exact: true });
      await nameField.fill('Reviewed beat');
      const updatesBefore = opsNamed(ops, 'updateMarker').length;
      await nameField.press('Tab');
      await lane.getByRole('slider', { name: /^Marker Reviewed beat/ }).waitFor({ timeout: 15_000 });
      const updates = opsNamed(ops, 'updateMarker').slice(updatesBefore);
      assert.equal(updates.length, 1, `one updateMarker, saw ${updates.length}`);
      console.log(`  updateMarker payload: ${JSON.stringify(updates[0].payload)}`);
      const patch = { ...updates[0].payload }; delete patch.id;
      const patchFields = patch.patch ? Object.keys(patch.patch) : Object.keys(patch);
      assert.deepEqual(patchFields, ['name'], 'the rename sends the name only');
      const latestAfter = opsNamed(ops, 'listMarkers').at(-1);
      for (let i = 0; i < 50 && latestAfter.result === null; i++) await page.waitForTimeout(100);
      const after = latestAfter.result.data.data.markers.find(marker => marker.id === first.id);
      console.log(`  before: ${JSON.stringify(first)}; after: ${JSON.stringify(after)}`);
      assert.deepEqual(after, { ...first, name: 'Reviewed beat' }, 'the marker keeps its id, ticks, length and note');
      await page.mouse.move(0, 0);
      if (captureDir) {
        await page.screenshot({ path: join(captureDir, 'f3-e35-cadence-renamed-marker-1280x1000.png') });
        writeFileSync(join(captureDir, 'f3-e35-marker-rename-observed.json'), `${JSON.stringify({ before: first, updateMarker: updates[0].payload, after }, null, 2)}\n`);
      }
      assert.deepEqual(pageErrors, [], 'no uncaught errors');
    } finally { await context.close(); }
  });

  if (failures.length) throw new Error(`${failures.length} F3 row check(s) failed: ${failures.join('; ')}`);
  console.log('F3 I-15 and E-35: pivot All filter and beat markers pass in Chromium');
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
