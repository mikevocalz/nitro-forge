import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const [platform, input] = process.argv.slice(2);
if (!["android", "ios"].includes(platform) || !input)
  throw new Error("Usage: node tooling/native/run-runtime-acceptance.mjs android|ios /absolute/path/to/app.apk|app.app");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = join(repo, "examples/native-cadence"), artifact = resolve(input);
if (!existsSync(artifact)) throw new Error(`Built native app is missing: ${artifact}`);
const output = resolve(process.env.FORGE_ACCEPTANCE_OUTPUT ?? join(process.env.RUNNER_TEMP ?? tmpdir(), `forge-runtime-${platform}`));
mkdirSync(output, { recursive: true });
const children = [];
let bootedSimulator;
const pause = () => new Promise(resolve => setTimeout(resolve, 1000));
function run(file, args, { optional = false, timeout = 30000 } = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (optional) return "";
    throw new Error(`${file} failed: ${result.error?.message ?? result.stderr?.slice(-4000) ?? result.status}`);
  }
  return result.stdout;
}
function background(file, args, name, options = {}) {
  const descriptor = openSync(join(output, name), "w");
  const child = spawn(file, args, { detached: true, stdio: ["ignore", descriptor, descriptor], ...options });
  closeSync(descriptor);
  child.on("error", error => { child.launchError = error; });
  children.push(child); return child;
}
async function waitFor(check, label, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check(); if (value) return value;
    const failed = children.find(child => child.launchError || child.exitCode !== null || child.signalCode !== null);
    if (failed) throw new Error(`${label}: native app or Metro exited (${failed.launchError?.message ?? failed.exitCode ?? failed.signalCode})`);
    await pause();
  }
  throw new Error(`Timed out waiting for ${label}; inspect ${output}`);
}
const requiredChecks = ["binary-input-output-ownership", "restore-input-ownership", "cache-copy-lru-bounds",
  "cache-fifo-close", "running-and-queued-cancellation", "task-progress-result-ownership",
  "document-fifo-close", "output-survives-document-close"];
function reportFrom(text) {
  const failed = text.indexOf("FORGE_NATIVE_RUNTIME_FAIL");
  if (failed !== -1) throw new Error(text.slice(failed, failed + 2000));
  const match = /FORGE_NATIVE_RUNTIME_PASS (\{[^\r\n]+\})/.exec(text);
  if (!match) return undefined;
  const report = JSON.parse(match[1]);
  if (report.schema !== 1 || report.platform !== platform || report.revision !== revision ||
      !Array.isArray(report.checks) || requiredChecks.some(check => !report.checks.includes(check)))
    throw new Error("Native acceptance reported incomplete checks or different binary/source provenance");
  return report;
}
const revision = run("git", ["-C", repo, "rev-parse", "HEAD"]).trim();
try {
  background("corepack", ["pnpm", "exec", "expo", "start", "--localhost", "--port", "8081"], "metro.log", {
    cwd: app,
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", FORGE_ACCEPTANCE: "runtime", EXPO_PUBLIC_FORGE_REVISION: revision },
  });
  await waitFor(async () => {
    try { return (await (await fetch("http://127.0.0.1:8081/status", { signal: AbortSignal.timeout(1500) })).text()).includes("packager-status:running"); }
    catch { return false; }
  }, "the acceptance Metro server", 60000);
  let report;
  if (platform === "android") {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error("ANDROID_HOME must point to the SDK used to build the app");
    const adb = join(sdk, "platform-tools", "adb"), serial = process.env.FORGE_ANDROID_SERIAL ?? "emulator-5554";
    const args = ["-s", serial];
    await waitFor(() => run(adb, [...args, "shell", "getprop", "sys.boot_completed"], { optional: true, timeout: 10000 }).trim() === "1", "Android boot", 180000);
    run(adb, [...args, "reverse", "tcp:8081", "tcp:8081"]);
    run(adb, [...args, "install", "-r", artifact], { timeout: 120000 });
    run(adb, [...args, "shell", "am", "force-stop", "ai.nitroforge.cadence.studio"]);
    run(adb, [...args, "shell", "am", "start", "-n", "ai.nitroforge.cadence.studio/.MainActivity"]);
    report = await waitFor(() => {
      run(adb, [...args, "shell", "uiautomator", "dump", "/sdcard/forge-runtime.xml"], { optional: true, timeout: 10000 });
      const xml = run(adb, [...args, "shell", "cat", "/sdcard/forge-runtime.xml"], { optional: true, timeout: 10000 });
      writeFileSync(join(output, "screen.xml"), xml);
      for (const [, attribute] of xml.matchAll(/text="([^"]*)"/g)) {
        const text = attribute.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
        const report = reportFrom(text); if (report) return report;
      }
      return undefined;
    }, "real Android Nitro runtime results");
    run(adb, [...args, "shell", "screencap", "-p", "/sdcard/forge-runtime.png"]);
    run(adb, [...args, "pull", "/sdcard/forge-runtime.png", join(output, "screen.png")]);
    writeFileSync(join(output, "logcat.log"), run(adb, [...args, "logcat", "-d", "-t", "1000"]));
  } else {
    const devices = Object.values(JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "--json"])).devices).flat();
    const device = devices.find(device => device.isAvailable && device.name.startsWith("iPhone") && device.state === "Booted") ??
      devices.find(device => device.isAvailable && device.name.startsWith("iPhone"));
    if (!device) throw new Error("No available iPhone simulator runtime is installed");
    if (device.state !== "Booted") { run("xcrun", ["simctl", "boot", device.udid]); bootedSimulator = device.udid; }
    run("xcrun", ["simctl", "bootstatus", device.udid, "-b"], { timeout: 180000 });
    run("xcrun", ["simctl", "install", device.udid, artifact], { timeout: 120000 });
    background("xcrun", ["simctl", "launch", "--console", "--terminate-running-process", device.udid, "ai.nitroforge.cadence.native"], "app.log");
    report = await waitFor(() => reportFrom(readFileSync(join(output, "app.log"), "utf8")), "real iOS Nitro runtime results");
    run("xcrun", ["simctl", "io", device.udid, "screenshot", join(output, "screen.png")]);
  }
  writeFileSync(join(output, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.info(`Native ${platform} acceptance passed: ${requiredChecks.length} generated-binding checks at ${revision}. Evidence: ${output}`);
} finally {
  for (const child of children.reverse()) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Process already exited. */ }
    }
  }
  if (bootedSimulator) run("xcrun", ["simctl", "shutdown", bootedSimulator], { optional: true });
}
