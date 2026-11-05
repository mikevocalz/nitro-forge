import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { artifacts, names, root, run } from './shared.mjs';

// Extract actual archives into an isolated consumer, with no workspace symlinks
// or registry access. This also ensures packed workspace dependencies resolve.
const consumer = mkdtempSync(resolve(tmpdir(), 'nitro-forge-consumer-'));
try {
  writeFileSync(resolve(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const scope = resolve(consumer, 'node_modules/@nitro-forge');
  mkdirSync(scope, { recursive: true });
  const archives = readdirSync(artifacts).filter(f => f.endsWith('.tgz'));
  assert.equal(archives.length, names.length, 'one archive per package');
  for (const name of names) {
    const source = JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json')));
    const archive = resolve(artifacts, `nitro-forge-${name}-${source.version}.tgz`);
    const dir = resolve(scope, name);
    mkdirSync(dir);
    run('tar', ['-xzf', archive, '--strip-components=1', '-C', dir]);
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json')));
    assert.equal(pkg.name, source.name);
    assert.equal(pkg.version, source.version);
    for (const version of Object.values(pkg.dependencies ?? {})) {
      assert(!version.startsWith('workspace:'), 'workspace protocol escaped into tarball');
    }
    if (name !== 'ignition') assert.equal(pkg.dependencies['@nitro-forge/ignition'], source.version);
    const checkTargets = value => {
      if (typeof value === 'string') readFileSync(resolve(dir, value));
      else if (value) Object.values(value).forEach(checkTargets);
    };
    checkTargets(pkg.exports);
    // Workspace manifests point at src/ so tests and Metro run without a build;
    // pnpm pack must swap in publishConfig's compiled entry points.
    // ./nitro is the one deliberate source export (Nitrogen reads the spec).
    const compiled = target => /^\.\/dist\/.+\.(js|d\.ts)$/.test(target);
    assert(compiled(pkg.main) && compiled(pkg.types), `${name}: main/types must be compiled dist files`);
    for (const [subpath, value] of Object.entries(pkg.exports)) {
      if (subpath === './package.json' || subpath === './nitro') continue;
      const targets = [];
      const collect = v => typeof v === 'string' ? targets.push(v) : v && Object.values(v).forEach(collect);
      collect(value);
      assert(targets.length && targets.every(compiled), `${name} export ${subpath} must resolve to dist, got ${targets}`);
    }
    assert(!readdirSync(dir).includes('rust'), 'unbuilt Rust sources are not runtime assets');
    assert(!readdirSync(dir).includes('tests'), 'tests must not ship');
  }
  writeFileSync(resolve(consumer, 'empty-types.d.ts'), '');
  const imports = names.map(n => `import * as ${n} from '@nitro-forge/${n}';`).join('\n');
  const classes = names.slice(1).map(n => `${n}.${n[0].toUpperCase() + n.slice(1)}Document`);
  writeFileSync(resolve(consumer, 'smoke.mjs'), `${imports}
import assert from 'node:assert/strict';
import { CliHost } from '@nitro-forge/ignition/cli';
assert.equal(typeof CliHost, 'function');
for (const Document of [${classes.join(',')}]) assert.equal(typeof Document, 'function');
assert.deepEqual([...ignition.base64ToBytes(ignition.bytesToBase64(new Uint8Array([0,128,255])))], [0,128,255]);
`);
  run(process.execPath, ['smoke.mjs'], { cwd: consumer });
  run(process.execPath, ['--conditions=react-native', 'smoke.mjs'], { cwd: consumer });
  if (process.argv.includes('--engines')) {
    assert(process.env.NF_CLI, '--engines requires an explicit NF_CLI binary');
    writeFileSync(resolve(consumer, 'engines.mjs'), `${imports}
import assert from 'node:assert/strict';
import { CliHost } from '@nitro-forge/ignition/cli';
const host = new CliHost(process.env.NF_CLI);
const cases = [
  [prism.PrismDocument, d => d.addRasterLayer('packed')],
  [cadence.CadenceDocument, d => d.setTempo(123)],
  [splice.SpliceDocument, d => d.addTrack('video')],
  [folio.FolioDocument, d => d.rotatePage(0, 90)],
  [pitch.PitchDocument, d => d.addSlide('title')],
  [tally.TallyDocument, d => d.setCell('A1', '=SUM(1,2,3)')],
  [quill.QuillDocument, d => d.insertText({block:0,offset:0}, 'packed')],
];
try {
  for (const [Document, mutate] of cases) {
    const doc = await (Document === folio.FolioDocument ? Document.create(host) : Document.open(host));
    // lopdf can serialize equivalent PDFs differently; compare page semantics
    // for Folio, as its Rust snapshot test does, and exact bytes elsewhere.
    const state = async d => Document === folio.FolioDocument ? (await d.describe()).data : d.save();
    const before = await state(doc);
    await mutate(doc);
    const snapshot = await doc.save();
    assert.equal(new TextDecoder().decode(snapshot.subarray(0, 4)), 'NFD1');
    const after = await state(doc);
    assert.notDeepEqual(after, before);
    assert.equal(await doc.undo(), true);
    assert.deepEqual(await state(doc), before);
    assert.equal(await doc.redo(), true);
    assert.deepEqual(await state(doc), after);
    await doc.close();
    const reopened = await Document.openSnapshot(host, snapshot);
    assert.deepEqual(await state(reopened), after);
    await reopened.close();
    console.log('Packaged round-trip passed:', Document.name);
  }
  console.log('Verified packaged APIs against all seven Rust engines.');
} finally { await host.dispose(); }
`);
    run(process.execPath, ['engines.mjs'], { cwd: consumer, timeout: 120000 });
  }
  writeFileSync(resolve(consumer, 'consumer.ts'), `${imports}
const host: ignition.EngineHost = {} as ignition.EngineHost;
const documents: Array<Promise<unknown>> = [${names.slice(1).map(n => `${n}.${n[0].toUpperCase() + n.slice(1)}Document.${n === 'folio' ? 'create' : 'open'}(host)`).join(',')}];
void documents;
// @ts-expect-error the public API must retain engine parameter validation
prism.PrismDocument.open(host, 'bad-width');
`);
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', './empty-types', 'consumer.ts'], { cwd: consumer });
  console.log('Verified 8 tarballs: exports, isolated ESM/React Native conditions, strict consumer declarations.');
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
