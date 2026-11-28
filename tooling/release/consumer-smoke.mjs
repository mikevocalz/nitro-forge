/**
 * Clean-consumer smoke for the tarballs written by `pnpm run check:packages`.
 *
 * Creates a new Expo app outside this checkout, installs every @nitro-forge
 * package from the release tarballs by file path (never from the workspace or
 * a registry), adds the Ignition config plugin, typechecks an import of every
 * package, and runs `expo prebuild --no-install --clean` per platform. Native
 * directories must not exist before prebuild, and a second prebuild must give a
 * byte-identical tree, so the native projects come from config + plugins only.
 *
 * It does not build, install or run the app. Opening, editing, saving,
 * reopening and undoing a document on iOS/Android needs a simulator or device
 * and is outside this script.
 *
 *   node tooling/release/consumer-smoke.mjs --app /tmp/forge-consumer \
 *     [--release dist/release] [--platform android] [--platform ios]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { RELEASE_PACKAGES, listFiles, parseSha256Sums } from "./package-verify.mjs";

const CREATE_EXPO_APP = "create-expo-app@5.0.0";
const TEMPLATE = "expo-template-blank-typescript@58.0.35";
const NITRO = "1.0.0-alpha.nightly.136.gdb81de61bd32";
// The admitted graph from docs/release/RELEASE_TRAIN.md and the Ignition plugin.
const RUNTIME = {
  expo: "58.0.24",
  react: "19.3.1",
  "react-native": "0.88.1",
  "react-native-nitro-modules": NITRO,
  "nitro-core": NITRO,
};

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { values } = parseArgs({ options: {
  app: { type: "string" },
  release: { type: "string", default: "dist/release" },
  platform: { type: "string", multiple: true, default: ["android", "ios"] },
} });
if (!values.app) throw new Error("--app <new directory outside the checkout> is required");
const app = resolve(values.app);
const release = resolve(root, values.release);
const rel = relative(root, app);
if (!(rel === ".." || rel.startsWith(".." + sep))) throw new Error(`Consumer app must be outside ${root}`);
if (existsSync(app)) throw new Error(`${app} exists; the smoke needs a new directory`);

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", NODE_PATH: "" };
const sh = (cmd, args, cwd = app) => execFileSync(cmd, args, { cwd, env, stdio: "inherit" });
const out = (cmd, args, cwd = app) => execFileSync(cmd, args, { cwd, env, encoding: "utf8" });

const stages = [];
function stage(name, fn) {
  if (stages.some((s) => s.status === "FAIL")) { stages.push({ name, status: "NOT RUN", detail: "earlier stage failed" }); return; }
  console.log(`\n== ${name}`);
  try {
    const detail = fn();
    stages.push({ name, status: "PASS", ...(detail ? { detail } : {}) });
  } catch (error) {
    const message = String(error.stderr ?? "") + String(error.message ?? error);
    const lines = [...new Set(message.split("\n").map((l) => l.trim()).filter((l) => /^(Error|\w*Error):/.test(l)))];
    stages.push({ name, status: "FAIL", detail: (lines.length ? lines : message.trim().split("\n").slice(-6)).join("\n") });
    console.error(`FAIL ${name}\n${message}`);
  }
}

/** sha256 over every file path and its bytes under `dir`, sorted. */
function treeHash(dir) {
  const h = createHash("sha256");
  for (const f of listFiles(dir)) h.update(f + "\0" + sha256(join(dir, f)) + "\n");
  return h.digest("hex");
}

const tarballs = {};
stage("verify release tarballs against SHA256SUMS", () => {
  const sums = parseSha256Sums(readFileSync(join(release, "SHA256SUMS"), "utf8"));
  for (const { sha256: expected, file } of sums) {
    const path = join(release, file);
    if (sha256(path) !== expected) throw new Error(`${file}: SHA256 mismatch`);
    const text = out("tar", ["-xzOf", path, "package/package.json"], release);
    const pkg = JSON.parse(text);
    tarballs[pkg.name] = { file, path, version: pkg.version, packageJsonSha256: createHash("sha256").update(text).digest("hex") };
  }
  const expectedNames = RELEASE_PACKAGES.map((n) => `@nitro-forge/${n}`).sort();
  const got = Object.keys(tarballs).sort();
  if (JSON.stringify(got) !== JSON.stringify(expectedNames)) throw new Error(`Release set mismatch: ${got.join(", ")}`);
  return `${got.length} tarballs`;
});

stage("create Expo app outside the workspace", () => {
  mkdirSync(dirname(app), { recursive: true });
  sh("pnpm", ["dlx", CREATE_EXPO_APP, app, "--template", TEMPLATE, "--no-install", "--yes"], dirname(app));
  for (const d of ["android", "ios"]) if (existsSync(join(app, d))) throw new Error(`Template shipped ${d}/; expected Continuous Native Generation`);
  return `${CREATE_EXPO_APP} --template ${TEMPLATE}`;
});

stage("point dependencies at the tarballs and add the config plugin", () => {
  const artifacts = join(app, "artifacts");
  mkdirSync(artifacts);
  const pkg = readJson(join(app, "package.json"));
  const overrides = {};
  for (const [name, t] of Object.entries(tarballs)) {
    cpSync(t.path, join(artifacts, t.file));
    overrides[name] = `file:./artifacts/${t.file}`;
  }
  pkg.dependencies = { ...pkg.dependencies, ...RUNTIME, ...overrides };
  pkg.packageManager = "pnpm@12.18.0";
  writeJson(join(app, "package.json"), pkg);
  // Overrides make the engines' "@nitro-forge/ignition": "<version>" dependency
  // resolve to the tarball too; these packages are never on a registry.
  writeFileSync(join(app, "pnpm-workspace.yaml"), [
    "packages:", '  - "."', "minimumReleaseAge: 0", "overrides:",
    ...Object.entries(overrides).map(([n, s]) => `  ${JSON.stringify(n)}: ${JSON.stringify(s)}`),
  ].join("\n") + "\n");
  const config = readJson(join(app, "app.json"));
  config.expo.newArchEnabled = true;
  config.expo.experiments = { ...config.expo.experiments, swiftPackageManager: true };
  config.expo.plugins = [...(config.expo.plugins ?? []), "@nitro-forge/ignition"];
  config.expo.ios = { ...config.expo.ios, bundleIdentifier: "dev.nitroforge.consumersmoke" };
  config.expo.android = { ...config.expo.android, package: "dev.nitroforge.consumersmoke" };
  writeJson(join(app, "app.json"), config);
  writeFileSync(join(app, "forge-imports.ts"), [
    ...RELEASE_PACKAGES.map((n) => `import * as ${n} from "@nitro-forge/${n}";`),
    `export const forgePackages = [${RELEASE_PACKAGES.join(", ")}];`,
  ].join("\n") + "\n");
});

stage("install from tarballs", () => {
  sh("pnpm", ["install"]);
  for (const [name, t] of Object.entries(tarballs)) {
    const dir = realpathSync(join(app, "node_modules", name));
    if (!dir.startsWith(realpathSync(app) + sep)) throw new Error(`${name} resolved outside the app: ${dir}`);
    if (dir.startsWith(root + sep)) throw new Error(`${name} resolved into the workspace: ${dir}`);
    if (sha256(join(dir, "package.json")) !== t.packageJsonSha256) throw new Error(`${name}: installed package.json differs from the tarball`);
  }
  const lock = readFileSync(join(app, "pnpm-lock.yaml"), "utf8");
  if (/workspace:|link:/.test(lock.split("importers:")[1]?.split("packages:")[0] ?? "")) throw new Error("Lockfile importer still links workspace sources");
  return "all @nitro-forge packages are real installs inside the app";
});

stage("typecheck imports of every package", () => {
  sh("pnpm", ["exec", "tsc", "--noEmit"]);
});

stage("config plugin resolves and accepts the installed graph", () => {
  const configJson = out("pnpm", ["exec", "expo", "config", "--json", "--type", "prebuild"]);
  const plugins = JSON.parse(configJson).plugins ?? [];
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === "@nitro-forge/ignition")) throw new Error("plugin missing from evaluated config");
});

for (const platform of values.platform) {
  if (platform === "ios" && process.platform !== "darwin") {
    stages.push({ name: "prebuild ios", status: "NOT RUN", detail: "iOS prebuild with SwiftPM needs macOS" });
    continue;
  }
  stage(`prebuild ${platform} (--no-install, generated twice)`, () => {
    if (existsSync(join(app, platform))) throw new Error(`${platform}/ existed before prebuild`);
    // Prebuild rewrites the android/ios run scripts; the dependency graph must not move.
    const graph = () => JSON.stringify(["dependencies", "devDependencies", "pnpm", "overrides", "resolutions"]
      .map((k) => readJson(join(app, "package.json"))[k] ?? null));
    const before = { graph: graph(), lock: sha256(join(app, "pnpm-lock.yaml")) };
    const generate = () => {
      sh("pnpm", ["exec", "expo", "prebuild", "--no-install", "--clean", "--platform", platform]);
      return treeHash(join(app, platform));
    };
    const first = generate();
    const second = generate();
    if (first !== second) throw new Error(`${platform}/ differs between two clean prebuilds`);
    if (graph() !== before.graph) throw new Error("prebuild changed package.json dependencies");
    if (sha256(join(app, "pnpm-lock.yaml")) !== before.lock) throw new Error("prebuild changed pnpm-lock.yaml");
    return `${platform}/ tree sha256 ${first}, ${readdirSync(join(app, platform)).length} top-level entries`;
  });
}
stages.push({ name: "open, edit, save, reopen, undo on iOS/Android", status: "NOT RUN", detail: "needs a simulator or device" });

const receipt = { app, release: values.release, runtime: RUNTIME, stages };
if (existsSync(app)) writeJson(join(app, "forge-consumer-receipt.json"), receipt);
console.log("\n" + stages.map((s) => `${s.status.padEnd(7)} ${s.name}${s.detail ? `\n        ${s.detail.replace(/\n/g, "\n        ")}` : ""}`).join("\n"));
process.exit(stages.some((s) => s.status === "FAIL") ? 1 : 0);
