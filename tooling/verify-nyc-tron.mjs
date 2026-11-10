// Every @nyc-tron dependency in the workspace must be the release tarball
// pinned in tooling/nyc-tron.json, and that tarball must still hash to the
// pinned sha256 (the release's SHA256SUMS).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pin = JSON.parse(readFileSync(join(root, 'tooling/nyc-tron.json'), 'utf8'));
const manifests = ['apps', 'packages', 'examples'].flatMap(dir => readdirSync(join(root, dir)).map(name => join(root, dir, name, 'package.json'))).filter(existsSync);
const used = new Set();
for (const path of manifests) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!name.startsWith('@nyc-tron/')) continue;
    assert.ok(pin.packages[name], `${path}: ${name} is not pinned in tooling/nyc-tron.json`);
    assert.equal(spec, pin.packages[name].url, `${path}: ${name} must use the pinned ${pin.tag} tarball`);
    assert.ok(pin.packages[name].url.includes(`/download/${pin.tag}/`), `${name} URL is not from ${pin.tag}`);
    used.add(name);
  }
}
assert.deepEqual([...used].sort(), Object.keys(pin.packages).sort(), 'every pinned package is used, and only those');
for (const [name, { url, sha256 }] of Object.entries(pin.packages)) {
  const response = await fetch(url);
  assert.ok(response.ok, `${name}: ${response.status} from ${url}`);
  const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  assert.equal(digest, sha256, `${name}: tarball sha256 differs from the pin`);
}
console.log(`NYC-Tron ${pin.tag}: ${used.size} packages pinned, used and verified`);
