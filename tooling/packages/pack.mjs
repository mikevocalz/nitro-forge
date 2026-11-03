import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { artifacts, names, root, run } from './shared.mjs';

rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });
for (const name of names) {
  // pnpm rewrites workspace:* to the concrete workspace version in the tarball.
  run('pnpm', ['pack', '--pack-destination', artifacts], { cwd: resolve(root, 'packages', name) });
}
writeFileSync(resolve(artifacts, 'README.txt'),
  'Local JavaScript/TypeScript preview artifacts. Native bindings and WASM are not included. Not a production release.\n');
