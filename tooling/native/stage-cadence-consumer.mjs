#!/usr/bin/env node
/**
 * Cross-repository native example workspace. Never copy NYC-Tron sources into
 * Nitro Forge's product packages or silently install an unreleased npm version.
 *
 * node tooling/native/stage-cadence-consumer.mjs <nyc-tron-source> <stage-dir>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const [tronInput, stageInput] = process.argv.slice(2);
if (!tronInput || !stageInput) {
  throw new Error("Usage: stage-cadence-consumer.mjs <nyc-tron-checkout> <stage-dir>");
}
const tron = resolve(tronInput);
const stage = resolve(stageInput);
const sources = [
  [join(root, "packages/ignition"), "packages/ignition"],
  [join(root, "packages/cadence"), "packages/cadence"],
  [join(tron, "packages/native-controls"), "packages/native-controls"],
  [join(root, "examples/native-cadence"), "app"],
];
for (const [source] of sources) {
  if (!existsSync(join(source, "package.json"))) {
    throw new Error("Required package is missing: " + source);
  }
}
if (stage === root || stage === tron || root.startsWith(stage + "/") || tron.startsWith(stage + "/")) {
  throw new Error("Staging cannot overwrite a source checkout");
}
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const [source, target] of sources) {
  cpSync(source, join(stage, target), {
    recursive: true,
    filter: (path) => !path.split("/").some((part) =>
      ["node_modules", ".git", ".expo", "ios-build", "android-build", "dist"].includes(part)),
  });
}
const ignitionPath = join(stage, "packages/ignition/package.json");
const ignition = JSON.parse(readFileSync(ignitionPath, "utf8"));
// This disposable integration lab uses ONLY the current Nitro v1 alpha.
// Never mutate the shipped legacy Ignition 0.x source checkout.
ignition.devDependencies ??= {};
ignition.devDependencies["react-native-nitro-modules"] =
  "1.0.0-alpha.nightly.120.g33ef045b96c0";
writeFileSync(ignitionPath, JSON.stringify(ignition, null, 2) + "\n");

writeFileSync(join(stage, "pnpm-workspace.yaml"),
  "packages:\n  - 'packages/*'\n  - 'app'\n");
writeFileSync(join(stage, "package.json"), JSON.stringify({
  name: "cadence-native-integration-workspace",
  version: "0.0.0", private: true, type: "module",
  packageManager: "pnpm@10.32.1",
}, null, 2) + "\n");
const nativePkg=JSON.parse(readFileSync(join(stage, "packages/native-controls/package.json"),"utf8"));
if (nativePkg.name !== "@nyc-tron/native-controls") throw new Error("Unexpected native controls package");
const appPkg=JSON.parse(readFileSync(join(stage,"app/package.json"),"utf8"));
if (!Object.values(appPkg.dependencies).includes("workspace:*"))throw new Error("Missing workspace component dependencies");
process.stdout.write("Prepared isolated Expo 58 + Nitro v1 native consumer workspace at " + stage + "\n");
