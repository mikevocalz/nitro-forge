const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const host = createRequire(path.resolve(__dirname, '../package.json'));
const expo = createRequire(host.resolve('expo/package.json'));
const cli = createRequire(expo.resolve('@expo/cli/package.json'));
const build = path.dirname(cli.resolve('@expo/metro-file-map'));
const { Watcher } = require(path.join(build, 'Watcher.js'));
const Backend = require(path.join(build, 'watchers/FallbackWatcher.js')).default;
const Native = require(path.join(build, 'watchers/NativeWatcher.js')).default;
function fixture(t, start) {
  const originals = [Backend.prototype.startWatching, Backend.prototype.stopWatching, Native.isSupported, Backend.isLiveOnStart];
  const stopped = [];
  Backend.prototype.startWatching = start;
  Backend.prototype.stopWatching = async function () { stopped.push(this.root); };
  Native.isSupported = () => false;
  Backend.isLiveOnStart = () => true;
  t.after(() => {
    [Backend.prototype.startWatching, Backend.prototype.stopWatching, Native.isSupported, Backend.isLiveOnStart] = originals;
  });
  const watcher = new Watcher({ roots: ['/project', '/sibling'], extensions: ['js'], watch: true,
    useWatchman: false, healthCheckFilePrefix: '.metro-health', console,
    abortSignal: new AbortController().signal });
  t.after(() => watcher.close());
  return { watcher, stopped };
}
test('startup rejection promptly rejects and stops partially started siblings', async t => {
  const { watcher, stopped } = fixture(t, async function () {
    if (this.root === '/sibling') throw new Error('startup failed');
  });
  await assert.rejects(watcher.watch(() => {}, new Map()), /startup failed/);
  assert.ok(stopped.includes('/project'));
  assert.ok(stopped.includes('/sibling'));
});
test('close during startup cancels registration and suppresses late events', async t => {
  const releases = [];
  const backends = [];
  const { watcher, stopped } = fixture(t, function () {
    backends.push(this);
    return new Promise(resolve => releases.push(resolve));
  });
  let events = 0;
  const starting = watcher.watch(() => events++, new Map());
  const rejected = assert.rejects(starting, /abort/i);
  await watcher.close();
  releases.forEach(resolve => resolve());
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  backends.forEach(backend => backend.emitFileEvent({event:'delete',relativePath:'late.js'}));
  assert.equal(events, 0);
  assert.ok(stopped.includes('/project'));
  assert.ok(stopped.includes('/sibling'));
  await assert.rejects(watcher.watchRoot('/late'), /abort/i);
});
test('dynamic watcher registration is deduplicated across retries', async t => {
  const started = [];
  const { watcher } = fixture(t, async function () { started.push(this.root); });
  await watcher.watch(() => {}, new Map());
  await Promise.all([watcher.watchRoot('/external'), watcher.watchRoot('/external')]);
  await watcher.watchRoot('/external');
  assert.equal(started.filter(root => root === '/external').length, 1);
});
