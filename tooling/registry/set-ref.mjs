#!/usr/bin/env node
// Set the two registry refs and regenerate everything that embeds them.
//   node tooling/registry/set-ref.mjs <nitroForgeRef> [nycTronRef]
// Both are moving refs (branches) until the owner cuts release tags (decision 45). Passing a tag pins the URLs.
// The second argument is optional; omit it to keep the current nycTronRef.
// Regenerates registry.json, r/, components.json, registry-excluded.json, docs, llms*.txt and the site.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, REG_DIR } from './lib.mjs';

const [nitroForgeRef, nycTronRef] = process.argv.slice(2);
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
if (!nitroForgeRef || !REF.test(nitroForgeRef) || (nycTronRef !== undefined && !REF.test(nycTronRef))) {
  console.error('usage: node tooling/registry/set-ref.mjs <nitroForgeRef> [nycTronRef]   (refs are branch or tag names)');
  process.exit(1);
}

const path = join(REG_DIR, 'config.json');
const cfg = JSON.parse(readFileSync(path, 'utf8'));
cfg.nitroForgeRef = nitroForgeRef;
if (nycTronRef !== undefined) cfg.nycTronRef = nycTronRef;
writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`set-ref: nitroForgeRef=${cfg.nitroForgeRef} nycTronRef=${cfg.nycTronRef}`);

for (const script of ['tooling/registry/build.mjs', 'tooling/docs/build-docs.mjs', 'tooling/docs/build-site.mjs']) {
  const run = spawnSync(process.execPath, [join(ROOT, script)], { cwd: ROOT, stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`set-ref: ${script} exited ${run.status}`);
    process.exit(run.status ?? 1);
  }
}
console.log('set-ref: regenerated. Run check-imports, validate-registry, check-docs and build-site --check, then commit.');
