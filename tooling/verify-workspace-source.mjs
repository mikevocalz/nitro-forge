// Verify the adapter against a built NYC-Tron checkout before that cluster is released.
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node tooling/verify-workspace-source.mjs /absolute/path/to/nyc-tron');
const ui = resolve(process.argv[2], 'packages/ui');
if (JSON.parse(readFileSync(join(ui, 'package.json'))).name !== '@nyc-tron/ui' || !existsSync(join(ui, 'dist/components/shell/WorkspaceHost.d.ts'))) {
  throw new Error('Build the NYC-Tron checkout before checking workspace contracts');
}
const temp = mkdtempSync(join(tmpdir(), 'forge-workspace-contract-'));
try {
  const file = join(temp, 'tsconfig.json');
  writeFileSync(file, JSON.stringify({ extends: join(root, 'tsconfig.base.json'), compilerOptions: {
    noEmit: true, lib: ['ES2022', 'DOM'], types: ['node'], typeRoots: [join(root, 'node_modules/@types')],
    paths: { '@nyc-tron/ui/components/files/FileImportExportSheet': [join(ui, JSON.parse(readFileSync(join(ui,'package.json'),'utf8')).exports['./components/files/FileImportExportSheet'].types)], '@nyc-tron/ui/*': [join(ui, 'dist/*')] },
  }, files: [join(root, 'packages/ignition/contracts/workspace-cluster.ts')] }));
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', file], { cwd: root, stdio: 'inherit' });
  console.log('Workspace cluster consumer contract matches the built NYC-Tron checkout');
} finally { rmSync(temp, { recursive: true, force: true }); }
