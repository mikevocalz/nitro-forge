import { realpathSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A successful build can still use an older pnpm patch directory through a stale SPM symlink. */
export function verifyNativeCadenceAutolinking(app) {
  for (const name of ["platform-services", "hardware-keys", "reserved-regions"]) {
    const installed = realpathSync(join(app, "node_modules/@nyc-tron", name));
    const generated = join(app, "ios/build/generated/autolinking/expo/expo-source", `nyc-tron-${name}`);
    if (realpathSync(join(generated, "root")) !== installed)
      throw Error(`Stale SwiftPM source for @nyc-tron/${name}; regenerate with react-native spm add --deintegrate --yes after installing patches`);
    const manifest = readFileSync(join(generated, "Package.swift"), "utf8");
    if (!manifest.includes('path: "root/ios"')) throw Error(`Unexpected native source target for @nyc-tron/${name}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = resolve(fileURLToPath(new URL("../examples/native-cadence", import.meta.url)));
  verifyNativeCadenceAutolinking(app);
  console.log("NativeCadence SwiftPM sources match all three installed NYC-Tron patches");
}
