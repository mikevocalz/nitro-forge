#!/usr/bin/env node
/**
 * Compose three pinned sources in a disposable native integration lab:
 *   1. Current Forge v1 C++/Rust native branch.
 *   2. Forge Cadence PR #43 (session and v1 EngineHost).
 *   3. NYC-Tron PR #8 (native SwiftUI/Compose controls).
 * No npm publishing, UI vendoring, or Nitro v0.x runtime.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const [cadenceInput, tronInput, stageInput] = process.argv.slice(2);
if (!cadenceInput || !tronInput || !stageInput) {
  throw new Error("Usage: stage_nf_v1_consumer.mjs <forge-pr43> <nyc-tron-pr8> <stage>");
}
const cadence = resolve(cadenceInput);
const tron = resolve(tronInput);
const stage = resolve(stageInput);
if ([root, cadence, tron].some(s => s === stage || s.startsWith(stage + "/"))) {
  throw new Error("Unsafe native integration staging destination");
}
const sources = [
  [join(cadence, "packages/ignition"), "packages/ignition"],
  [join(cadence, "packages/cadence"), "packages/cadence"],
  [join(root, "packages/ignition-v1-lab"), "packages/ignition-v1-lab"],
  [join(tron, "packages/native-controls"), "packages/native-controls"],
  [join(cadence, "examples/native-cadence"), "app"],
];
for (const [source] of sources) {
  if (!existsSync(join(source, "package.json"))) {
    throw new Error("Missing source: " + source);
  }
}
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const ignored = new Set(["node_modules", ".git", ".expo", ".gradle", "build", "dist"]);
for (const [source, dest] of sources) {
  cpSync(source, join(stage, dest), {
    recursive: true,
    filter: path => !path.split("/").some(x => ignored.has(x)),
  });
}
const readJSON = path => JSON.parse(readFileSync(path, "utf8"));
const writeJSON = (path, data) =>
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
const ignitionPath = join(stage, "packages/ignition/package.json");
const ignition = readJSON(ignitionPath);
ignition.devDependencies ??= {};
ignition.devDependencies["react-native-nitro-modules"] =
  "1.0.0-alpha.nightly.120.g33ef045b96c0";
writeJSON(ignitionPath, ignition);

const app = join(stage, "app");
const appPath = join(app, "package.json");
const pkg = readJSON(appPath);
pkg.dependencies["@nitro-forge/ignition-v1-lab"] = "workspace:*";
pkg.dependencies["nitro-core"] = "1.0.0-alpha.nightly.120.g33ef045b96c0";
pkg.dependencies["react-native-nitro-modules"] = "1.0.0-alpha.nightly.120.g33ef045b96c0";
writeJSON(appPath, pkg);

const tsconfigPath = join(app, "tsconfig.json");
const tsconfig = readJSON(tsconfigPath);
tsconfig.include = [...new Set([...(tsconfig.include ?? []), "register-nitro-v1.ts"])];
writeJSON(tsconfigPath, tsconfig);
cpSync(join(root, "examples/native-linkage/register-nitro-v1.ts"),
  join(app, "register-nitro-v1.ts"));
writeFileSync(join(app, "index.js"),
  'import "./register-nitro-v1";\n' +
  'import { registerRootComponent } from "expo";\n' +
  'import App from "./App";\n' +
  'registerRootComponent(App);\n');

writeJSON(join(stage, "package.json"), {
  name: "nitro-forge-v1-native-lab", private: true, version: "0.0.0",
  type: "module", packageManager: "pnpm@10.32.1",
});
writeFileSync(join(stage, "pnpm-workspace.yaml"),
  "packages:\n  - 'packages/*'\n  - 'app'\n");

// No generated stub substitutes for actual archive packaging.
const androidArtifact = join(stage,
  "packages/ignition-v1-lab/native/android/arm64-v8a/libnf_sys.a");
const appleArtifact = join(stage,
  "packages/ignition-v1-lab/native/apple/NitroForgeRust.xcframework");
if (!existsSync(androidArtifact) && !existsSync(appleArtifact)) {
  throw new Error("Refusing to stage a Nitro v1 consumer without a real Rust archive");
}
process.stdout.write("Prepared generated factory + native Rust archive: " + stage + "\n");
