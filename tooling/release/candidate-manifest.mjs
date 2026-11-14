import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { hash, inside, json } from './archive-files.mjs';

/** Verify the supplied artifacts; never build or substitute checkout sources. */
export function candidate(file, expectedSource) {
  assert.ok(!existsSync(resolve(dirname(file), 'INCOMPLETE.txt')), 'Candidate producer did not complete');
  const manifest = json(file);
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.sourceCommit ?? '', /^[0-9a-f]{40}$/);
  assert.equal(manifest.sourceCommit, expectedSource, 'Candidate source differs from requested exact source');
  assert.match(manifest.version ?? '', /^\d+\.\d+\.\d+-[a-zA-Z0-9.-]+$/);
  const names = ['ignition', 'prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'].map(n => `@nitro-forge/${n}`);
  assert.deepEqual(manifest.archives.map(a => a.name).sort(), names.sort(), 'Candidate must contain exactly eight declared packages');
  assert.deepEqual([...manifest.deferred].sort(), ['photo', 'motion', 'design', 'draft', 'scene'].sort());
  const seen = new Set();
  for (const archive of manifest.archives) {
    assert.equal(archive.version, manifest.version);
    assert.match(archive.archive, /^nitro-forge-[a-z]+-[a-zA-Z0-9.-]+\.tgz$/);
    assert.ok(!seen.has(archive.archive), 'Duplicate archive');
    seen.add(archive.archive);
    assert.match(archive.sha256, /^[0-9a-f]{64}$/);
    assert.equal(hash(inside(dirname(resolve(file)), archive.archive)), archive.sha256, `Archive checksum mismatch: ${archive.archive}`);
    assert.ok(Array.isArray(archive.contents) && archive.contents.length > 0, 'Missing archive content inventory');
    const paths = new Set();
    for (const entry of archive.contents) {
      inside('/package', entry.path);
      assert.ok(!paths.has(entry.path), 'Duplicate archive content path');
      paths.add(entry.path);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    }
  }
  return manifest;
}
