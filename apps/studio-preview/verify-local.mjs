import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const base = 'http://127.0.0.1:4185';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', '4185', '--strictPort'], {
  cwd: root, stdio: 'inherit',
});
let serverExited = false;
let serverError;
const serverExit = new Promise(resolve => {
  server.once('error', error => { serverError = error; serverExited = true; resolve(); });
  server.once('exit', () => { serverExited = true; resolve(); });
});

try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (serverExited) throw new Error('Studio development server exited before readiness');
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for the loopback listener to start. */ }
    await pause(200);
  }
  if (!ready) throw new Error('Studio development server did not become ready in 30 seconds');
  const verifier = spawn(process.execPath, [resolve(root, 'verify-bridge.mjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, STUDIO_PREVIEW_URL: base },
  });
  await new Promise((resolve, reject) => {
    verifier.once('error', reject);
    verifier.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Bridge verification failed (${code ?? signal})`)));
  });
} finally {
  if (!serverExited) {
    server.kill('SIGTERM');
    let graceTimer;
    await Promise.race([serverExit, new Promise(resolve => { graceTimer = setTimeout(resolve, 5000); })]);
    clearTimeout(graceTimer);
    if (!serverExited) { server.kill('SIGKILL'); await serverExit; }
  }
}
