import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeReceipt, restartChecks, runtimeChecks, runtimeEngineKinds, verifyRestart } from "./runtime-receipt.mjs";
import { createRequire } from "node:module";

const identity = { platform: "ios", revision: "a".repeat(40), runId: "fresh-run" };
function receipt(phase, token = phase) {
  const checks = phase === "RESTART" ? [...restartChecks] : [...runtimeChecks];
  return { ...identity, message: `FORGE_NATIVE_RUNTIME_${phase} ${JSON.stringify({
    schema: 1, ...identity, processToken: token, checks, engineKinds: [...runtimeEngineKinds],
  })}` };
}
test("the current run must first write, then reopen in another process", () => {
  const first = parseRuntimeReceipt(receipt("RESTART"), identity);
  const second = parseRuntimeReceipt(receipt("PASS"), identity);
  assert.doesNotThrow(() => verifyRestart(first, second));
  assert.throws(() => verifyRestart(undefined, second));
  assert.throws(() => verifyRestart(first, first));
  assert.throws(() => verifyRestart(first, { ...second, processToken: first.processToken }));
  assert.throws(() => verifyRestart(first, { ...second, runId: "old-run" }));
  assert.throws(() => verifyRestart(first, { ...second, engineKinds: second.engineKinds.slice(1) }));
});

test("both OS processes must report each registered engine exactly once", () => {
  assert.equal(runtimeEngineKinds.length, 11);
  for (const phase of ["RESTART", "PASS"]) {
    const prefix = `FORGE_NATIVE_RUNTIME_${phase} `;
    for (const mutation of [
      report => { delete report.engineKinds; },
      report => { report.engineKinds.pop(); },
      report => { report.engineKinds[0] = report.engineKinds[1]; },
      report => { report.engineKinds[0] = "unregistered-engine"; },
      report => { report.engineKinds.push("extra-engine"); },
    ]) {
      const envelope = receipt(phase), report = JSON.parse(envelope.message.slice(prefix.length));
      mutation(report); envelope.message = prefix + JSON.stringify(report);
      assert.throws(() => parseRuntimeReceipt(envelope, identity), /engine roster/);
    }
    const envelope = receipt(phase), report = JSON.parse(envelope.message.slice(prefix.length));
    report.engineKinds.reverse(); envelope.message = prefix + JSON.stringify(report);
    assert.doesNotThrow(() => parseRuntimeReceipt(envelope, identity));
  }
});

test("the real Expo virtual entry and existing rewrite preserve the app's acceptance path", () => {
  const { withAcceptanceEntry } = createRequire(import.meta.url)("../../examples/native-cadence/acceptance-entry.cjs");
  const config = withAcceptanceEntry({ server: { unstable_serverRoot: "/forge",
    rewriteRequestUrl: value => value.replace("initial=1", "rewritten=1") } }, "/forge/examples/native-cadence", "runtime");
  for (const entry of ["index", ".expo/.virtual-metro-entry", "examples/native-cadence/index"]) {
    assert.equal(config.server.rewriteRequestUrl(`http://localhost:8081/${entry}.bundle?platform=ios&initial=1`),
      "http://localhost:8081/examples/native-cadence/runtime-acceptance.bundle?platform=ios&rewritten=1");
  }
  assert.equal(config.server.rewriteRequestUrl("/assets/file.png"), "/assets/file.png");
  const unchanged = {}; assert.equal(withAcceptanceEntry(unchanged, "/forge", "unknown"), unchanged);
});
test("stale, foreign, failed and incomplete native receipts cannot pass", () => {
  for (const key of ["platform", "revision", "runId"]) {
    assert.throws(() => parseRuntimeReceipt({ ...receipt("PASS"), [key]: "other" }, identity));
  }
  assert.throws(() => parseRuntimeReceipt({ ...identity, message: "FORGE_NATIVE_RUNTIME_FAIL actual native failure" }, identity), /actual native failure/);
  for (const mutation of [
    report => { report.checks.pop(); }, report => { report.checks[0] = report.checks[1]; },
    report => { report.processToken = ""; }, report => { report.revision = "old"; },
    report => { report.phase = "restart-required"; }, report => { report.runId = "old-run"; },
  ]) {
    const envelope = receipt("PASS"), report = JSON.parse(envelope.message.slice("FORGE_NATIVE_RUNTIME_PASS ".length));
    mutation(report); envelope.message = "FORGE_NATIVE_RUNTIME_PASS " + JSON.stringify(report);
    assert.throws(() => parseRuntimeReceipt(envelope, identity));
  }
});
