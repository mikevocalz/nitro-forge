import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error Build-artifact verification is shared with the Node CI CLI.
import { verifyBoardAndroidLink } from '../../../scripts/verify-board-android-link.mjs';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function artifact(abis: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'forge-elf-fixture-')); dirs.push(root);
  for (const abi of abis) {
    const dir = join(root, 'intermediates', 'cxx', 'Debug', 'hash', 'obj', abi);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'libNitroForgeBoard.so'), 'ELF fixture path only; dynamic reader supplied by the test');
  }
  return root;
}
it('requires a real Nitro dynamic dependency for every requested ABI', () => {
  const root = artifact(['arm64-v8a']);
  expect(verifyBoardAndroidLink(root, ['arm64-v8a'], () => '0x1 (NEEDED) Shared library: [libNitroModules.so]')).toEqual(['arm64-v8a']);
  expect(() => verifyBoardAndroidLink(root, ['arm64-v8a'], () => '0x1 (NEEDED) Shared library: [libreactnative.so]')).toThrow('does not depend');
});
it('rejects the missing and unexpected architectures that caused the original link failure', () => {
  expect(() => verifyBoardAndroidLink(artifact([]), ['arm64-v8a'], () => '')).toThrow('not built');
  expect(() => verifyBoardAndroidLink(artifact(['armeabi-v7a']), ['arm64-v8a'], () => '')).toThrow('Unexpected Board ABI');
});
