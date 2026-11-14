import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { requireDisk } from '../archive-files.mjs';

const source = readFileSync(new URL('../consumer-fixture/App.tsx', import.meta.url), 'utf8');
const body = source.match(/const save = \(\) => run\('Save to disk', async \(\) => \{([\s\S]*?)\n  \}\);/)?.[1];
assert.ok(body, 'Execute the actual fixture Save handler, not a copied implementation');
const declaration = stripTypeScriptTypes('async function saveFixture() {' + body + '\n}');
const compiledBody = declaration.slice(declaration.indexOf('{') + 1, declaration.lastIndexOf('}'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const save = new AsyncFunction('active', 'store', 'describe', 'validateEnvelope', 'snapshotFile', 'expectedFile', 'mountedRef', compiledBody);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('actual Save handler waits for both async disk writes before reading or reporting success', { timeout: 10000 }, async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'forge-save-async-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  requireDisk(root, 64 * 1024 * 1024);
  // File-I/O scheduling regression only. Native behavior remains subject to
  // actual installed-app workflows; these deferred writes are not UI evidence.
  const bytes = Uint8Array.from([78, 70, 68, 49, 1]);
  const binaryEntered = deferred(), binaryRelease = deferred();
  const recordEntered = deferred(), recordRelease = deferred();
  const events = [];
  function diskFile(name, entered, release) {
    const path = resolve(root, name);
    return {
      uri: 'file://' + path,
      create() { writeFileSync(path, ''); },
      async write(value) { events.push(name + ':write-start'); entered.resolve(); await release.promise; await writeFile(path, value); events.push(name + ':write-done'); },
      async bytes() { events.push(name + ':read'); return new Uint8Array(await readFile(path)); },
      async text() { events.push(name + ':read'); return readFile(path, 'utf8'); },
    };
  }
  const file = diskFile('snapshot.nfd', binaryEntered, binaryRelease);
  const record = diskFile('expected.json', recordEntered, recordRelease);
  const state = { studio: 'cadence' };
  let reported = false;
  const result = save(
    () => ({ probe: { document: { save: async () => bytes } } }),
    { getState: () => state, setState: value => Object.assign(state, value) },
    async () => '{"tempo_bpm":121}', () => {},
    () => file, () => record, { current: true },
  ).then(value => { reported = true; return value; });
  await binaryEntered.promise;
  await new Promise(done => setImmediate(done));
  assert.deepEqual(events, ['snapshot.nfd:write-start']);
  assert.equal(reported, false);
  binaryRelease.resolve();
  await recordEntered.promise;
  await new Promise(done => setImmediate(done));
  assert.deepEqual(events, ['snapshot.nfd:write-start', 'snapshot.nfd:write-done', 'snapshot.nfd:read', 'expected.json:write-start']);
  assert.equal(reported, false);
  recordRelease.resolve();
  assert.match(await result, /5 exact NFD1 bytes read back from file:\/\//);
  assert.deepEqual(new Uint8Array(await readFile(resolve(root, 'snapshot.nfd'))), bytes);
  assert.equal(JSON.parse(await readFile(resolve(root, 'expected.json'), 'utf8')).canonical, '{"tempo_bpm":121}');
  assert.equal(events.at(-1), 'expected.json:read');
});
