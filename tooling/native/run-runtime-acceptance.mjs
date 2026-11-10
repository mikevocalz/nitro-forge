import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { parseRuntimeReceipt, runtimeChecks, verifyRestart } from "./runtime-receipt.mjs";
import { recordNativeArtifact } from "./native-artifact.mjs";

const [platform, input] = process.argv.slice(2);
if (!["android", "ios"].includes(platform) || !input)
  throw new Error("Usage: node tooling/native/run-runtime-acceptance.mjs android|ios /absolute/path/to/app.apk|app.app");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = join(repo, "examples/native-cadence"), artifact = resolve(input);
const output = resolve(process.env.FORGE_ACCEPTANCE_OUTPUT ?? join(process.env.RUNNER_TEMP ?? tmpdir(), `forge-runtime-${platform}`));
mkdirSync(output, { recursive: true });
const children = [], runId = randomUUID();
let revision, stage = "preflight", bootedSimulator, capture, stopApp, receiver;
let expectedPhase = "restart-required", receiptError;
const receipts = new Map(), launches = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 1000));
const event = (kind, details = {}) => {
  appendFileSync(join(output, "steps.jsonl"), JSON.stringify({ time: new Date().toISOString(), stage, kind, ...details }) + "\n");
};
function enter(next) { stage = next; event("stage"); console.info(`Native acceptance: ${next}`); }
function run(file, args, { optional = false, timeout = 30000 } = {}) {
  event("command-start", { file, args, timeout });
  const began = Date.now();
  const result = spawnSync(file, args, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  event("command-end", { file, args, elapsedMs: Date.now() - began, status: result.status,
    signal: result.signal, error: result.error?.message, stdout: result.stdout?.slice(-8000), stderr: result.stderr?.slice(-8000) });
  if (result.error || result.status !== 0) {
    if (optional) return result.stdout ?? "";
    throw new Error(`${file} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr?.slice(-4000) ?? result.status}`);
  }
  return result.stdout;
}
function background(file, args, name, options = {}) {
  event("process-start", { file, args, log: name });
  const descriptor = openSync(join(output, name), "w");
  const child = spawn(file, args, { detached: true, stdio: ["ignore", descriptor, descriptor], ...options });
  closeSync(descriptor);
  child.on("error", error => { child.launchError = error; event("process-error", { file, error: error.message }); });
  child.on("exit", (code, signal) => event("process-exit", { file, code, signal, expected: Boolean(child.expectedExit) }));
  children.push(child); return child;
}
async function waitFor(check, label, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check(); if (value) return value;
    const failed = children.find(child => !child.expectedExit && (child.launchError || child.exitCode !== null || child.signalCode !== null));
    if (failed) throw new Error(`${label}: native app or Metro exited (${failed.launchError?.message ?? failed.exitCode ?? failed.signalCode})`);
    await pause();
  }
  throw new Error(`Timed out waiting for ${label}; inspect ${output}`);
}
async function probeMetro() {
  const attempts = [];
  for (const origin of ["http://127.0.0.1:8081", "http://localhost:8081", "http://[::1]:8081"]) {
    try {
      const response = await fetch(origin + "/status", { signal: AbortSignal.timeout(1500) });
      const body = (await response.text()).slice(0, 256);
      const ready = response.ok && body.includes("packager-status:running");
      attempts.push({ origin, status: response.status, body, ready });
      if (ready) { event("metro-probe", { attempts }); return { ready: true, occupied: true, origin }; }
    } catch (error) { attempts.push({ origin, error: error.message, cause: error.cause?.code }); }
  }
  event("metro-probe", { attempts });
  return { ready: false, occupied: attempts.some(attempt => attempt.status !== undefined) };
}
async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function awaitReceipt(phase) {
  return waitFor(() => {
    if (receiptError) throw receiptError;
    return receipts.get(phase);
  }, `the native ${phase} receipt`);
}
function storeFirst(report) {
  if (report.phase !== "restart-required") throw new Error("MMKV acceptance must write before process restart");
  writeFileSync(join(output, "before-process-restart.json"), JSON.stringify(report, null, 2) + "\n");
}

try {
  if (!existsSync(artifact)) throw new Error(`Built native app is missing: ${artifact}`);
  const nativeArtifact = recordNativeArtifact(platform, artifact, output);
  revision = run("git", ["-C", repo, "rev-parse", "HEAD"]).trim();
  writeFileSync(join(output, "invocation.json"), JSON.stringify({ platform, artifact, revision, runId,
    requestedSimulator: process.env.FORGE_IOS_UDID ?? null }, null, 2) + "\n");
  const receiptPath = "/forge-native/" + randomUUID();
  receiver = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== receiptPath) { response.writeHead(404).end(); return; }
    try {
      const chunks = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 131072) throw new Error("Native runtime report exceeded its receipt limit");
        chunks.push(chunk);
      }
      const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      writeFileSync(join(output, `receipt-${expectedPhase}.json`), JSON.stringify(envelope, null, 2) + "\n");
      const report = parseRuntimeReceipt(envelope, { platform, revision, runId });
      const previous = receipts.get(report.phase);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(report)) throw new Error("The app emitted conflicting results for one phase");
      } else {
        if (report.phase !== expectedPhase) throw new Error(`Received ${report.phase} before its OS process launch`);
        receipts.set(report.phase, report);
      }
      event("native-receipt", { phase: report.phase, processToken: report.processToken });
      response.writeHead(200).end("recorded");
    } catch (error) {
      receiptError = error; event("native-receipt-error", { message: error.message });
      response.writeHead(400).end("invalid native result");
    }
  });
  receiver.requestTimeout = 15000; receiver.headersTimeout = 15000;
  await new Promise((resolve, reject) => { receiver.once("error", reject); receiver.listen(0, "127.0.0.1", resolve); });
  const receiptPort = receiver.address().port;
  enter("starting owned Metro");
  if ((await probeMetro()).occupied) throw new Error("Port 8081 is already occupied; refusing another app's Metro source");
  background("corepack", ["pnpm", "exec", "expo", "start", "--localhost", "--port", "8081", "--max-workers", "1", "--clear"], "metro.log", {
    cwd: app,
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", FORGE_ACCEPTANCE: "runtime",
      EXPO_PUBLIC_FORGE_REVISION: revision, EXPO_PUBLIC_FORGE_ACCEPTANCE_RUN: runId,
      EXPO_PUBLIC_FORGE_ACCEPTANCE_URL: `http://127.0.0.1:${receiptPort}${receiptPath}` },
  });
  const metro = await waitFor(async () => { const status = await probeMetro(); return status.ready ? status : undefined; }, "the acceptance Metro server", 90000);
  event("metro-ready", { origin: metro.origin });
  let report, first, launcher, host;
  if (platform === "android") {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error("ANDROID_HOME must point to the SDK used to build the app");
    const adb = join(sdk, "platform-tools", "adb"), serial = process.env.FORGE_ANDROID_SERIAL ?? "emulator-5554";
    const args = ["-s", serial], bundle = "ai.nitroforge.cadence.studio";
    host = { serial };
    capture = phase => {
      run(adb, [...args, "shell", "uiautomator", "dump", "/sdcard/forge-runtime.xml"], { optional: true, timeout: 10000 });
      writeFileSync(join(output, `screen-${phase}.xml`), run(adb, [...args, "shell", "cat", "/sdcard/forge-runtime.xml"], { optional: true, timeout: 10000 }));
      run(adb, [...args, "shell", "screencap", "-p", "/sdcard/forge-runtime.png"], { optional: true, timeout: 10000 });
      run(adb, [...args, "pull", "/sdcard/forge-runtime.png", join(output, `screen-${phase}.png`)], { optional: true, timeout: 10000 });
      writeFileSync(join(output, `logcat-${phase}.log`), run(adb, [...args, "logcat", "-d", "-t", "2000"], { optional: true, timeout: 10000 }));
    };
    stopApp = () => {
      run(adb, [...args, "shell", "am", "force-stop", bundle], { optional: true });
      for (const port of [8081, receiptPort]) run(adb, [...args, "reverse", "--remove", `tcp:${port}`], { optional: true });
    };
    enter("waiting for Android boot");
    await waitFor(() => run(adb, [...args, "shell", "getprop", "sys.boot_completed"], { optional: true, timeout: 10000 }).trim() === "1", "Android boot");
    for (const port of [8081, receiptPort]) run(adb, [...args, "reverse", `tcp:${port}`, `tcp:${port}`]);
    enter("installing Android app");
    run(adb, [...args, "install", "-r", artifact], { timeout: 120000 });
    for (let launch = 0; launch < 2; launch++) {
      enter(`launching Android process ${launch + 1}`);
      run(adb, [...args, "shell", "am", "force-stop", bundle]);
      if (run(adb, [...args, "shell", "pidof", bundle], { optional: true }).trim()) throw new Error("Android force-stop left the previous app process running");
      expectedPhase = launch === 0 ? "restart-required" : "complete";
      run(adb, [...args, "shell", "am", "start", "-n", `${bundle}/.MainActivity`]);
      report = await awaitReceipt(expectedPhase);
      const pid = run(adb, [...args, "shell", "pidof", bundle]).trim();
      launches.push({ launch: launch + 1, pid, processToken: report.processToken });
      capture(String(launch + 1));
      if (launch === 0) { first = report; storeFirst(report); }
      else verifyRestart(first, report);
    }
  } else {
    enter("selecting iOS simulator");
    const available = run("xcrun", ["simctl", "list", "devices", "available", "--json"], { timeout: 90000 });
    writeFileSync(join(output, "simulators.json"), available);
    const devices = Object.entries(JSON.parse(available).devices)
      .sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true })).flatMap(([, list]) => list);
    const requested = process.env.FORGE_IOS_UDID;
    const device = requested ? devices.find(device => device.udid === requested && device.isAvailable) :
      devices.find(device => device.isAvailable && device.name.startsWith("iPhone") && device.state === "Booted") ??
      devices.find(device => device.isAvailable && device.name.startsWith("iPhone"));
    if (!device) throw new Error(requested ? `Requested simulator ${requested} is unavailable` : "No available iPhone simulator runtime is installed");
    const bundle = "ai.nitroforge.cadence.native";
    host = { udid: device.udid, name: device.name };
    writeFileSync(join(output, "selected-simulator.json"), JSON.stringify(device, null, 2) + "\n");
    capture = phase => {
      run("xcrun", ["simctl", "io", device.udid, "screenshot", join(output, `screen-${phase}.png`)], { optional: true, timeout: 20000 });
      writeFileSync(join(output, `simulator-${phase}.log`), run("xcrun", ["simctl", "spawn", device.udid,
        "log", "show", "--last", "3m", "--style", "compact", "--predicate", `eventMessage CONTAINS "${bundle}"`], { optional: true, timeout: 20000 }));
    };
    stopApp = () => { run("xcrun", ["simctl", "terminate", device.udid, bundle], { optional: true, timeout: 20000 }); };
    enter("booting selected iOS simulator");
    if (device.state !== "Booted") {
      run("xcrun", ["simctl", "boot", device.udid], { timeout: 90000 }); bootedSimulator = device.udid;
    }
    run("xcrun", ["simctl", "bootstatus", device.udid, "-b"], { timeout: 420000 });
    enter("installing iOS app");
    const executable = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(artifact, "Info.plist")]).trim();
    launcher = join(artifact, executable);
    run("xcrun", ["simctl", "install", device.udid, artifact], { timeout: 180000 });
    let appProcess;
    for (let launch = 0; launch < 2; launch++) {
      enter(`launching iOS process ${launch + 1}`);
      if (appProcess) {
        appProcess.expectedExit = true;
        // A successful terminate is required before accepting a second receipt.
        run("xcrun", ["simctl", "terminate", device.udid, bundle], { timeout: 30000 });
      }
      expectedPhase = launch === 0 ? "restart-required" : "complete";
      appProcess = background("xcrun", ["simctl", "launch", "--console", "--terminate-running-process", device.udid, bundle], `app-${launch + 1}.log`);
      report = await awaitReceipt(expectedPhase);
      launches.push({ launch: launch + 1, processToken: report.processToken });
      capture(String(launch + 1));
      if (launch === 0) { first = report; storeFirst(report); }
      else verifyRestart(first, report);
    }
  }
  enter("recording completed native evidence");
  writeFileSync(join(output, "result.json"), JSON.stringify({ ...report,
    provenance: { ...host, sourceCommit: revision, nativeArtifact,
      ...(launcher ? { launcherSha256: await digest(launcher) } : {}), launches } }, null, 2) + "\n");
  console.info(`Native ${platform} acceptance passed: ${runtimeChecks.length} generated-binding checks at ${revision}. Evidence: ${output}`);
} catch (error) {
  event("failure", { message: error.message, stack: error.stack });
  writeFileSync(join(output, "failure.json"), JSON.stringify({ platform, revision, runId, stage,
    message: String(error.message ?? error), stack: error.stack }, null, 2) + "\n");
  try { capture?.("failure"); } catch (captureError) { event("capture-failure", { message: String(captureError) }); }
  throw error;
} finally {
  stopApp?.();
  for (const child of children.reverse()) {
    child.expectedExit = true;
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    }
  }
  if (receiver) { receiver.closeAllConnections(); await new Promise(resolve => receiver.close(resolve)); }
  if (bootedSimulator) run("xcrun", ["simctl", "shutdown", bootedSimulator], { optional: true, timeout: 90000 });
}
