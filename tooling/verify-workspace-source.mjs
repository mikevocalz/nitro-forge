// Verify an adapter contract against a built NYC-Tron checkout before that
// checkout is released. The color controls now live in @nitro-forge/editor-controls,
// so this checks two things against the checkout: the controls compile against
// its @nyc-tron/ui declarations, and the Forge contract compiles against those
// declarations and the shell components and the controls. See tooling/editor-controls-contract.mjs.
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { root, stageTronDeclarations, tronSubpathsMissing, emitEditorControlsDeclarations } from './editor-controls-contract.mjs';
if (!process.argv[2]) throw new Error('Usage: node tooling/verify-workspace-source.mjs /absolute/path/to/nyc-tron');
const ui = resolve(process.argv[2], 'packages/ui');
if (JSON.parse(readFileSync(join(ui, 'package.json'))).name !== '@nyc-tron/ui' || !existsSync(join(ui, 'dist/components/shell/WorkspaceHost.d.ts'))) {
  throw new Error('Build the NYC-Tron checkout before checking workspace contracts');
}
const missing = tronSubpathsMissing(ui);
if (missing.length) throw new Error('The NYC-Tron checkout does not export what the editor controls import:\n  ' + missing.join('\n  '));
const staged = stageTronDeclarations(ui);
const temp = mkdtempSync(join(tmpdir(), 'forge-workspace-contract-'));
let controls;
try {
  const tronPaths = { '@nyc-tron/ui/components/files/FileImportExportSheet': [join(staged.dir, JSON.parse(readFileSync(join(ui, 'package.json'), 'utf8')).exports['./components/files/FileImportExportSheet'].types)], '@nyc-tron/ui/*': [join(staged.dir, 'dist/*')] };
  controls = emitEditorControlsDeclarations(tronPaths);
  const file = join(temp, 'tsconfig.json');
  writeFileSync(file, JSON.stringify({ extends: join(root, 'tsconfig.base.json'), compilerOptions: {
    noEmit: true, lib: ['ES2022', 'DOM'], types: ['node'], typeRoots: [join(root, 'node_modules/@types')],
    paths: { ...tronPaths, ...controls.paths },
  }, files: [join(root, 'packages/ignition/contracts/workspace-cluster.ts')] }));
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', file], { cwd: root, stdio: 'inherit' });
  console.log('Workspace cluster consumer contract matches the built NYC-Tron checkout');
} finally { rmSync(temp, { recursive: true, force: true }); controls?.dispose(); staged.dispose(); }
