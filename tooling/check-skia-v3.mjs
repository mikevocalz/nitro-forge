/**
 * NitroForge's cross-platform GPU release gate.
 * It does not treat a manifest check as proof of a working native build.
 *
 * Flags:
 *   --lockfile=<path>  resolve Dawn from this lockfile instead of pnpm-lock.yaml
 *   --registry         report pinned vs published npm latest. Drift is reported,
 *                      not failed: a new upstream release must not turn every
 *                      scheduled run red. Add --strict to fail on drift.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const example = readJson(join(root, "apps/example/package.json"));
const app = readJson(join(root, "apps/example/app.json"));
const deps = example.dependencies;

function parse(v) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  assert.ok(match, `Expected an exact npm version, got ${v}`);
  return match.slice(1).map(Number);
}
function atLeast(v, maj, min, pat = 0) {
  const actual = parse(v);
  return actual[0] > maj
    || (actual[0] === maj && (actual[1] > min
      || (actual[1] === min && actual[2] >= pat)));
}
function findLegacyDependencies() {
  const paths = [join(root, "package.json")];
  for (const dir of ["apps", "packages"]) {
    const base = join(root, dir);
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const file = join(base, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(file)) paths.push(file);
    }
  }
  return paths.filter((p) => {
    const pkg = readJson(p);
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
      (section) => Object.hasOwn(pkg[section] ?? {}, "@shopify/react-native-skia"),
    );
  });
}
const legacy = findLegacyDependencies();
assert.deepEqual(legacy, [], `Old Shopify Skia would conflict with v3: ${legacy.join(", ")}`);
assert.equal(parse(deps["react-native-skia"])[0], 3, "Only react-native-skia v3 is supported.");
assert.ok(atLeast(deps["react-native-skia"], 3, 7), "Skia v3 Graphite must be >=3.7.");
assert.ok(atLeast(deps["react-native-webgpu"], 0, 17), "WebGPU must be >=0.17 for Skia >=3.7 (same Dawn family).");
assert.ok(atLeast(deps["expo"], 58, 0), "Expo example must target SDK 58+.");
assert.ok(atLeast(deps["react-native"], 0, 88), "Expo SDK 58 targets React Native 0.88+.");
const properties = app.expo.plugins.find((plugin) =>
  Array.isArray(plugin) && plugin[0] === "expo-build-properties",
);
assert.ok(properties, "Skia v3 needs the expo-build-properties native configuration.");
assert.ok(properties[1]?.android?.minSdkVersion >= 26, "Skia v3 requires Android minSdk 26.");
assert.ok(Number(properties[1]?.ios?.deploymentTarget) >= 16.4, "Expo SDK 58 requires iOS 16.4+.");

// One Dawn for the whole graph. Skia v3 and react-native-webgpu each depend on
// react-native-webgpu-dawn; two resolved versions link two Dawn runtimes into
// one app. The lockfile is the resolved graph, so count distinct versions there.
const DAWN = "react-native-webgpu-dawn";
const lockArg = process.argv.find((a) => a.startsWith("--lockfile="));
const lockPath = lockArg ? resolve(lockArg.slice("--lockfile=".length)) : join(root, "pnpm-lock.yaml");
assert.ok(existsSync(lockPath), `No lockfile at ${lockPath}; Dawn resolution cannot be checked.`);
const lock = readFileSync(lockPath, "utf8");
const dawnInLock = new Set(
  [...lock.matchAll(/^ {2}'?react-native-webgpu-dawn@([^:'(\s]+)/gm)].map((m) => m[1]),
);
assert.ok(dawnInLock.size > 0, `${DAWN} is not in ${lockPath}; Skia v3/WebGPU did not resolve.`);
assert.equal(
  dawnInLock.size, 1,
  `${DAWN} resolves to ${dawnInLock.size} versions (${[...dawnInLock].join(", ")}); exactly one is allowed.`,
);
// After an install, also count what pnpm actually laid out on disk.
const store = join(root, "node_modules/.pnpm");
if (!lockArg && existsSync(store)) {
  const onDisk = readdirSync(store).filter((d) => d.startsWith(`${DAWN}@`));
  assert.ok(onDisk.length <= 1, `${DAWN} is installed ${onDisk.length} times: ${onDisk.join(", ")}`);
}
const [dawn] = dawnInLock;

console.log(`Skia v${deps["react-native-skia"]} Graphite + WebGPU v${deps["react-native-webgpu"]}: manifest contract OK.`);
console.log(`${DAWN}: one resolved version (${dawn}) in ${relative(root, lockPath)}.`);
console.log("Not a runtime/build check. Verify Android Vulkan 1.1, Xcode/Gradle linkage and device builds separately.");

if (process.argv.includes("--registry")) {
  const npmView = (spec, field) => execFileSync(
    "npm", ["view", spec, field, "--json", "--fetch-retries=1", "--fetch-timeout=12000"],
    { cwd: root, encoding: "utf8", timeout: 20000 },
  ).trim();
  const rows = [];
  for (const name of ["react-native-skia", "react-native-webgpu"]) {
    const latest = JSON.parse(npmView(name, "version"));
    const latestDawn = JSON.parse(npmView(`${name}@${latest}`, "dependencies") || "{}")[DAWN] ?? "none";
    rows.push({ name, pinned: deps[name], latest, latestDawn, drift: deps[name] !== latest });
  }
  const pairDawn = rows[0].latestDawn === rows[1].latestDawn;
  const drift = rows.some((r) => r.drift);
  const lines = [
    "| Package | Pinned | npm latest | Dawn of latest |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.name} | ${r.pinned} | ${r.latest} | ${r.latestDawn} |`),
    "",
    drift
      ? `Drift: upstream has newer releases. The latest pair ${pairDawn ? "shares" : "does NOT share"} one Dawn version. Bump both pins together in a dependency PR and regenerate the lockfile.`
      : "No drift: pins match npm latest.",
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Skia/WebGPU npm drift\n\n${lines.join("\n")}\n`);
  if (process.env.DRIFT_REPORT) writeFileSync(process.env.DRIFT_REPORT, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `drift=${drift}\n`);
  if (drift && process.argv.includes("--strict")) process.exit(1);
}
