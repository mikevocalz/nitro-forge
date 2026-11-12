import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Loads the Studio in Chromium and fails when the shell does not render.
// `dev` serves through Vite's dependency pre-bundling; `preview` serves the
// output of `vite build`, so run the build first.
const mode = process.argv[2] ?? 'dev';
assert.ok(mode === 'dev' || mode === 'preview', `Unknown mode ${mode}; use dev or preview`);

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const port = mode === 'dev' ? 4187 : 4188;
const base = `http://127.0.0.1:${port}/`;
const args = mode === 'dev' ? ['--host', '127.0.0.1', '--port', String(port), '--strictPort']
  : ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
const server = spawn(process.execPath, [vite, ...args], { cwd: root, stdio: 'inherit' });
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

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack ?? String(error)));

  await page.goto(base, { waitUntil: 'load' });
  // The first dev load pre-bundles dependencies; give it time, then require the launcher.
  // An uncaught error before the launcher appears fails at once instead of at the timeout.
  try {
    await Promise.race([
      page.getByRole('heading', { name: 'All applications' }).waitFor({ timeout: 90_000 }),
      new Promise((_, reject) => page.once('pageerror', reject)),
    ]);
  } catch (error) {
    const html = await page.locator('#root').innerHTML();
    throw new Error(`Studio shell did not render (${mode}). #root holds ${html.length} characters.\n`
      + `Uncaught page errors:\n${pageErrors.join('\n') || '(none)'}`, { cause: error });
  }
  assert.ok(await page.getByText('Choose where to work').isVisible(), 'launcher hint is visible');
  assert.deepEqual(pageErrors, [], 'no uncaught errors while the shell renders');
  console.log(`Studio shell rendered in Chromium (${mode})`);
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
