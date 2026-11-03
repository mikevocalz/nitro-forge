import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** Inspect real built ELF files; source/header checks cannot prove native linkage. */
export function verifyBoardAndroidLink(buildDir, requestedAbis, readDynamic) {
  const found = new Set();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'libNitroForgeBoard.so') {
        const abi = basename(dir);
        if (!requestedAbis.includes(abi)) throw new Error(`Unexpected Board ABI: ${abi}`);
        const dependencies = readDynamic(path);
        if (!/\(NEEDED\).*\[libNitroModules\.so\]/.test(dependencies)) {
          throw new Error(`${path} does not depend on libNitroModules.so`);
        }
        found.add(abi);
      }
    }
  };
  visit(buildDir);
  for (const abi of requestedAbis) {
    if (!found.has(abi)) throw new Error(`Board native library was not built for ${abi}`);
  }
  return [...found].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [buildDir, abiList] = process.argv.slice(2);
  if (!buildDir || !abiList) throw new Error('Usage: verify-board-android-link.mjs <build-directory> <comma-separated-abis>');
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const ndk = process.env.ANDROID_NDK_HOME ?? (sdk ? join(sdk, 'ndk', '28.2.13676358') : undefined);
  if (!ndk) throw new Error('Set ANDROID_HOME or ANDROID_NDK_HOME to inspect the ELF dependency table');
  const host = process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  const readelf = join(ndk, 'toolchains', 'llvm', 'prebuilt', host, 'bin', 'llvm-readelf');
  const abis = verifyBoardAndroidLink(buildDir, abiList.split(','), (file) => {
    const result = spawnSync(readelf, ['--dynamic', file], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
    return result.stdout;
  });
  console.log(`PASS: real Board ELF links NitroModules for ${abis.join(', ')}`);
}
