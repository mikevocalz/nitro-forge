#!/usr/bin/env node
/**
 * Cross-repository native example workspace. Never copy NYC-Tron sources into
 * Nitro Forge's product packages or silently install an unreleased npm version.
 *
 * node tooling/native/stage-cadence-consumer.mjs <nyc-tron-source> <stage-dir>
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// NYC-Tron exports only built dist/ files, so its package must be built in the
// NYC-Tron checkout (pnpm install && pnpm --filter @nyc-tron/native-controls build)
// before staging. Forge packages export src/ and their dist/ is never copied.
const tronControls = join(tron, "packages/native-controls");
if (!existsSync(join(tronControls, "dist/index.js"))) {
  throw new Error("Build @nyc-tron/native-controls in the NYC-Tron checkout first: " + join(tronControls, "dist"));
}
if (stage === root || stage === tron || root.startsWith(stage + "/") || tron.startsWith(stage + "/")) {
  throw new Error("Staging cannot overwrite a source checkout");
}
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const [source, target] of sources) {
  const skip = ["node_modules", ".git", ".expo", "ios-build", "android-build"];
  if (source !== tronControls) skip.push("dist");
  cpSync(source, join(stage, target), {
    recursive: true,
    filter: (path) => !path.split("/").some((part) => skip.includes(part)),
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

// The app's patches/ directory holds `pnpm patch` output for dependencies that
// need fixes to build, such as SwiftPM manifests for Expo modules that ship no
// prebuilt XCFramework. Register every one; pnpm fails the install if a patch
// does not match an installed version, so a stale patch cannot pass silently.
const patchDir = join(stage, "app/patches");
const patched = existsSync(patchDir)
  ? readdirSync(patchDir).filter((file) => file.endsWith(".patch")).sort().map((file) => {
      const match = /^(.+)@([^@]+)\.patch$/.exec(file);
      if (!match) throw new Error("Patch file is not named <package>@<version>.patch: " + file);
      return [match[1].replaceAll("__", "/") + "@" + match[2], "app/patches/" + file];
    })
  : [];
writeFileSync(join(stage, "pnpm-workspace.yaml"),
  "packages:\n  - 'packages/*'\n  - 'app'\n" +
  (patched.length === 0 ? "" : "patchedDependencies:\n" +
    patched.map(([spec, file]) => "  " + JSON.stringify(spec) + ": " + JSON.stringify(file) + "\n").join("")));
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
