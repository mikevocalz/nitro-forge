import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runs tooling/docs/examples/*.ts, the code shown in docs/engines/<name>.md, against the real engines
// through nf-cli. Each @nitro-forge package resolves to its source entry, as the package tests do.
const root = fileURLToPath(new URL('../../', import.meta.url));
const src = (pkg, file = 'src/index.ts') => `${root}packages/${pkg}/${file}`;
const engines = readdirSync(`${root}packages`).filter((p) => existsSync(src(p)));

export default {
  root,
  resolve: {
    alias: [
      { find: /^@nitro-forge\/ignition\/cli$/, replacement: src('ignition', 'src/host-cli.ts') },
      { find: /^@nitro-forge\/editor-controls\/(.+)$/, replacement: `${root}packages/editor-controls/src/$1` },
      ...engines.map((p) => ({ find: new RegExp(`^@nitro-forge/${p}$`), replacement: src(p) })),
    ],
  },
  test: { environment: 'node', include: ['tooling/docs/examples.test.ts'] },
};
