const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const host = createRequire(path.resolve(__dirname, '../package.json'));
const expo = createRequire(host.resolve('expo/package.json'));
const cli = createRequire(expo.resolve('@expo/cli/package.json'));
const FileMap = cli('@expo/metro-file-map').default;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < deadline, 'timed out waiting for filesystem event'); await pause(20); }
}
function fixture(t, fallback, watch = false) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-roots-'));
  const project = path.join(base, 'project');
  const external = path.join(base, 'external');
  fs.mkdirSync(project); fs.mkdirSync(external);
  fs.writeFileSync(path.join(project, 'index.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(external, 'first.js'), 'module.exports = 2;');
  const map = new FileMap({ rootDir: project, roots: [project], extensions: ['js', 'json'], enableSymlinks: true,
    enableFallback: fallback, scopeFallback: true, serverRoot: project, retainAllFiles: true,
    computeSha1: true, maxWorkers: 1, useWatchman: false, watch,
    healthCheck: { enabled: false, filePrefix: '.metro-health', interval: 10000, timeout: 1000 },
    cacheManagerFactory: () => ({ read: async () => null, write: async () => {}, end: async () => {} }),
  });
  t.after(async () => { await map.end(); fs.rmSync(base, { recursive: true, force: true }); });
  return { map, base, project, external };
}
for (const fallback of [false, true]) {
  test(`dynamic crawl, deduplication and symlink roots (on-demand=${fallback})`, async t => {
    const { map, base, project, external } = fixture(t, fallback);
    assert.throws(() => map.addRoot(external), /after build/);
    const build = map.build();
    const addedDuringBuild = map.addRoot(external);
    const { fileSystem } = await build;
    await addedDuringBuild;
    assert.equal(fileSystem.exists(path.join(external, 'first.js')), true);
    const alias = path.join(project, 'linked'); fs.symlinkSync(external, alias, 'dir');
    const before = map.getRoots().length;
    await map.addRoot(alias); await map.addRoot(external);
    assert.equal(map.getRoots().length, before);
    assert.deepEqual(map.getRoots().map(r => r.dynamic), [false, true]);
    assert.equal(map.getRoots()[1].rootRelativePath, path.join('..', 'external'));
    fs.mkdirSync(path.join(external, 'nested')); await map.addRoot(path.join(external, 'nested'));
    assert.equal(map.getRoots().length, before + 1);
    assert.throws(() => map.addRoot(path.join(base, 'missing')), /ENOENT/);
    assert.throws(() => map.addRoot(path.join(external, 'first.js')), /directory/);
    await map.end(); assert.throws(() => map.addRoot(external), /abort/i);
  });
  test(`dynamic watch create/change/delete and lifecycle (on-demand=${fallback})`, async t => {
    const { map, external } = fixture(t, fallback, true);
    const { fileSystem } = await map.build();
    let events = 0; map.on('change', () => events++);
    await map.addRoot(external);
    assert.equal(fileSystem.exists(path.join(external, 'first.js')), true);
    assert.ok(events > 0, 'dynamic crawl emits change');
    const target = path.join(external, 'new.js');
    fs.writeFileSync(target, 'one');
    await until(() => fileSystem.exists(target));
    const oldSha = (await fileSystem.getOrComputeSha1(target)).sha1;
    fs.writeFileSync(target, 'two changed');
    await until(() => fileSystem.getSize(target) === 11);
    assert.notEqual((await fileSystem.getOrComputeSha1(target)).sha1, oldSha);
    fs.unlinkSync(target); await until(() => !fileSystem.exists(target));
    await map.end(); const endedEvents = events;
    fs.writeFileSync(path.join(external, 'after-end.js'), 'closed'); await pause(150);
    assert.equal(events, endedEvents, 'no changes after end');
  });
}
test('concurrent additions, failed crawl rollback and retry', async t => {
  const { map, external, base } = fixture(t, false, true);
  await map.build();
  const second = path.join(base, 'second'); fs.mkdirSync(second); fs.writeFileSync(path.join(second, 'two.js'), '2');
  const a = map.addRoot(external); const duplicate = map.addRoot(external);
  assert.equal(a, duplicate, 'concurrent calls share readiness promise');
  await Promise.all([a, map.addRoot(second)]);
  assert.equal(map.getRoots().length, 3);
  const Watcher = cli('@expo/metro-file-map/build/Watcher').Watcher;
  const original = Watcher.prototype.recrawl;
  const third = path.join(base, 'third'); fs.mkdirSync(third); fs.writeFileSync(path.join(third, 'three.js'), '3');
  Watcher.prototype.recrawl = async function (...args) { if (args[0].endsWith('third')) throw new Error('injected crawl failure'); return original.apply(this, args); };
  try { await assert.rejects(map.addRoot(third), /injected crawl failure/); }
  finally { Watcher.prototype.recrawl = original; }
  assert.equal(map.getRoots().some(r => r.absolutePath === third), false, 'failed readiness is rolled back');
  await map.addRoot(third);
  assert.equal(map.getRoots().filter(r => r.absolutePath === third).length, 1);
});
