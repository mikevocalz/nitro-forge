import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { files, hash, inside, json } from './archive-files.mjs';

export const NITRO_LICENSE_SHA256 = '833ee7046f3908173364391ad4a2028560029503faf3a29e8acb77506dfe52ea';

/** Material presence/identity checks, never a permissive-license classifier. */
export function checkLicenseMembers(root, pkg, originalSha, expectedSource) {
  assert.equal(pkg.license, 'MIT', `Missing original-code license metadata: ${pkg.name}`);
  assert.equal(hash(resolve(root, 'LICENSE')), originalSha, `Missing/changed original-code license: ${pkg.name}`);
  if (pkg.name === '@nitro-forge/ignition') {
    assert.ok(existsSync(resolve(root, 'THIRD_PARTY_NOTICES.md')), 'Missing Ignition generated/native notices');
    assert.equal(hash(resolve(root, 'licenses/Nitro-MIT.txt')), NITRO_LICENSE_SHA256, 'Changed/missing pinned Nitro license text');
    const packetRoot = resolve(root, 'native/licenses');
    const packet = json(resolve(packetRoot, 'provenance.json'));
    assert.equal(packet.schemaVersion, 1);
    assert.match(packet.sourceCommit ?? '', /^[0-9a-f]{40}$/);
    if (expectedSource) assert.equal(packet.sourceCommit, expectedSource);
    assert.equal(packet.originalLicenseSha256, originalSha);
    assert.deepEqual(files(packetRoot).sort(), ['provenance.json', ...packet.files.map(f => f.path)].sort(), 'Missing/extra native license material');
    for (const material of packet.files) assert.equal(hash(inside(packetRoot, material.path)), material.sha256, `Changed native license material: ${material.path}`);
    assert.equal(hash(resolve(packetRoot, 'Cargo.lock')), packet.cargoLockSha256);
    const selected = nativeClosure(packet.resolvedGraph);
    assert.deepEqual(selected.map(p => p.id).sort(), packet.components.map(p => p.id).sort(), 'Native component list does not match resolved closure');
    for (const component of packet.components) {
      const declared = selected.find(p => p.id === component.id);
      assert.equal(component.licenseExpression, declared.license);
      assert.ok(component.materials.length > 0, `Missing license/source materials for ${component.id}`);
      if (declared.source) {
        assert.ok(component.materials.some(m => m.path.startsWith('sources/') && m.sha256 === component.checksum), `Missing exact registry source archive: ${component.id}`);
      }
      for (const material of component.materials) assert.equal(hash(inside(packetRoot, material.path)), material.sha256);
    }
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE', 'COPYRIGHT', 'COPYRIGHT-library.html']) {
      const material = packet.toolchain.materials.find(m => m.path === `rust-toolchain/${name}`);
      assert.ok(material, `Missing Rust toolchain ${name}`);
      assert.equal(hash(inside(packetRoot, material.path)), material.sha256);
    }
  }
}

export function lockChecksums(text) {
  const result = new Map();
  for (const block of text.split(/\n\[\[package\]\]\n/).slice(1)) {
    const field = key => block.match(new RegExp(`^${key} = "([^"]+)"`, 'm'))?.[1];
    if (field('source')) result.set(`${field('name')}@${field('version')}|${field('source')}`, field('checksum'));
  }
  return result;
}

/** All-target normal/build closure is a conservative superset of linked
 * dependencies. It excludes unrelated workspace packages and dev-only edges.
 */
export function nativeClosure(metadata) {
  assert.ok(metadata.resolve, 'Full resolved Cargo metadata required; --no-deps is not provenance');
  const packages = new Map(metadata.packages.map(p => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map(n => [n.id, n]));
  const roots = metadata.packages.filter(p => p.name === 'nf-sys' && !p.source);
  assert.equal(roots.length, 1, 'Expected exactly one first-party nf-sys root');
  const selected = new Set(), pending = [roots[0].id];
  while (pending.length) {
    const id = pending.pop();
    if (selected.has(id)) continue;
    selected.add(id);
    const node = nodes.get(id);
    assert.ok(node, `Missing Cargo resolution node: ${id}`);
    for (const dep of node.deps) {
      if (dep.dep_kinds.some(k => k.kind === null || k.kind === 'build')) pending.push(dep.pkg);
    }
  }
  return [...selected].map(id => {
    const pkg = packages.get(id);
    assert.ok(pkg, `Missing resolved Cargo package: ${id}`);
    assert.ok(pkg.license, `Unresolved license declaration: ${pkg.name}@${pkg.version}; license_file/custom terms need explicit review`);
    return pkg;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
