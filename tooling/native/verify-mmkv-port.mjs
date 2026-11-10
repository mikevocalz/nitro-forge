import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Compile the installed patched package against the exact host runtime, then
// exercise the actual core in two subprocesses. Native app execution is separate.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = join(repo, "examples/native-cadence");
const core = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node tooling/native/verify-mmkv-port.mjs /path/to/Tencent-MMKV-v2.4.0");
const requireApp = createRequire(join(app, "package.json"));
const requireHost = createRequire(requireApp.resolve("react-native-nitro-modules/package.json"));
const packageRoot = name => dirname((name === "nitro-core" ? requireHost : requireApp).resolve(`${name}/package.json`));
const pkg = name => JSON.parse(readFileSync(join(packageRoot(name), "package.json"), "utf8"));
const pin = "1.0.0-alpha.nightly.120.g33ef045b96c0";
const upstream = "23d652c17e8c2023bb50f1c92e862a2304eaa2a2";
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${file} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
if (pkg("react-native-mmkv").version !== "4.3.2" || pkg("react-native-nitro-modules").version !== pin || pkg("nitro-core").version !== pin)
  throw new Error("MMKV and both native runtime packages must use the reviewed versions");
if (run("git", ["-C", core, "rev-parse", "HEAD"]).trim() !== upstream)
  throw new Error("MMKV core source must match the reviewed v2.4.0 commit");
const mmkv = packageRoot("react-native-mmkv"), nitro = packageRoot("nitro-core"), rn = packageRoot("react-native");
const requireMMKV = createRequire(join(mmkv, "package.json"));
if (requireMMKV.resolve("nitro-core/package.json") !== requireHost.resolve("nitro-core/package.json"))
  throw new Error("MMKV resolved a second Nitro core runtime");
const shared = join(mmkv, "nitrogen/generated/shared/c++");
const cpp = directory => readdirSync(directory).filter(name => name.endsWith(".cpp")).map(name => join(directory, name));
run("g++", ["-std=c++20", "-Wall", "-Wextra", "-Werror", "-Wno-unused-parameter", "-Wno-attributes", "-fsyntax-only",
  "-I" + join(mmkv, "cpp"), "-I" + join(shared, "include"), "-I" + join(core, "Core/fakeinclude"),
  "-isystem", join(nitro, "native/cpp/include"), "-isystem", join(rn, "ReactCommon/jsi"), "-isystem", join(rn, "ReactCommon"),
  ...cpp(join(mmkv, "cpp")), ...cpp(shared),
  join(mmkv, "nitrogen/generated/android/c++/HybridMMKVSpecClass.cpp"),
  join(mmkv, "nitrogen/generated/android/c++/HybridMMKVFactorySpecClass.cpp"),
]);
const directory = mkdtempSync(join(tmpdir(), "forge-mmkv-core-"));
try {
  const binary = join(directory, "mmkv-core-smoke");
  const source = join(core, "Core");
  run("g++", ["-std=c++20", "-O2", "-pthread", "-I" + source,
    ...cpp(source), ...cpp(join(source, "aes")), ...cpp(join(source, "aes/openssl")), ...cpp(join(source, "crc32")),
    join(source, "crc32/zlib/crc32.cpp"), join(repo, "tooling/native/mmkv-core-smoke.cpp"), "-lz", "-o", binary]);
  const write = run(binary, [join(directory, "store"), "write"]).trim();
  const reopen = run(binary, [join(directory, "store"), "read"]).trim();
  if (write !== "MMKV_CORE_2_4_0_WRITE_PASS" || reopen !== "MMKV_CORE_2_4_0_REOPEN_PASS") throw new Error("Core subprocess evidence is incomplete");
  const report = { schema: 1, binding: "react-native-mmkv@4.3.2 + Nitro 120 port", nitro: pin,
    core: { repository: "Tencent/MMKV", revision: upstream, version: "2.4.0" }, platform: process.platform,
    checks: ["installed-package-cpp-compatibility", "one-nitro-runtime", "core-binary-input-output-ownership", "core-subprocess-reopen"],
    limits: "Linux core and C++ source checks; native iOS/Android generated-binding acceptance runs separately. No power-loss guarantee." };
  if (process.env.FORGE_MMKV_PORT_OUTPUT) {
    const output = resolve(process.env.FORGE_MMKV_PORT_OUTPUT); mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "mmkv-port.json"), JSON.stringify(report, null, 2) + "\n");
  }
  console.info(JSON.stringify(report));
} finally { rmSync(directory, { recursive: true, force: true }); }
