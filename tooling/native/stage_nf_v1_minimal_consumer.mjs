#!/usr/bin/env node
/**
 * Stage the smallest Expo 58 app that links the Nitro v1 Forge package and the
 * Rust xcframework, for an Xcode compile-and-link check:
 *   <stage>/packages/ignition-v1-lab   this branch's package, built artifacts included
 *   <stage>/app                        examples/native-linkage/minimal-app
 *
 * It carries no Cadence or NYC-Tron sources, so a failure points at this
 * package. pnpm patches in examples/native-linkage/patches are applied only
 * for dependencies the app declares.
 *
 * node tooling/native/stage_nf_v1_minimal_consumer.mjs <stage>
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const [stageInput] = process.argv.slice(2);
if (!stageInput) throw new Error("Usage: stage_nf_v1_minimal_consumer.mjs <stage>");
const stage = resolve(stageInput);
if (root === stage || root.startsWith(stage + "/") || stage.startsWith(root + "/")) {
  throw new Error("Stage the minimal consumer outside the repository: " + stage);
}

const lab = join(root, "packages/ignition-v1-lab");
const xcframework = join(lab, "native/apple/NitroForgeRust.xcframework/Info.plist");
if (!existsSync(xcframework)) {
  throw new Error("Missing " + xcframework + ". Run tooling/native/build_nf_v1_artifacts.sh apple first.");
}
if (!existsSync(join(lab, "nitrogen/generated"))) {
  throw new Error("Missing Nitrogen output. Run the ignition-v1-lab codegen script first.");
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const ignored = new Set(["node_modules", ".git", ".expo", ".gradle", "build", "dist"]);
const copy = (source, dest) =>
  cpSync(source, join(stage, dest), {
    recursive: true,
    filter: path => !path.slice(source.length).split("/").some(part => ignored.has(part)),
  });
copy(lab, "packages/ignition-v1-lab");
copy(join(root, "examples/native-linkage/minimal-app"), "app");

const readJSON = path => JSON.parse(readFileSync(path, "utf8"));
const app = readJSON(join(stage, "app/package.json"));
const declared = { ...(app.dependencies ?? {}), ...(app.devDependencies ?? {}) };
const patchSource = join(root, "examples/native-linkage/patches");
const patched = [];
for (const file of existsSync(patchSource) ? readdirSync(patchSource).sort() : []) {
  if (!file.endsWith(".patch")) continue;
  const match = /^(.+)@([^@]+)\.patch$/.exec(file);
  if (!match) throw new Error("Patch file is not named <package>@<version>.patch: " + file);
  const name = match[1].replaceAll("__", "/");
  if (!(name in declared)) continue;
  mkdirSync(join(stage, "app/patches"), { recursive: true });
  cpSync(join(patchSource, file), join(stage, "app/patches", file));
  patched.push([name + "@" + match[2], "app/patches/" + file]);
}

writeFileSync(join(stage, "package.json"), JSON.stringify({
  name: "nitro-forge-v1-minimal-consumer", private: true, version: "0.0.0",
  type: "module", packageManager: "pnpm@10.32.1",
}, null, 2) + "\n");
writeFileSync(join(stage, "pnpm-workspace.yaml"),
  "packages:\n  - 'packages/*'\n  - 'app'\n" +
  (patched.length === 0 ? "" : "patchedDependencies:\n" +
    patched.map(([spec, file]) => "  " + JSON.stringify(spec) + ": " + JSON.stringify(file) + "\n").join("")));
process.stdout.write("Staged minimal Nitro v1 consumer: " + stage + "\n");
