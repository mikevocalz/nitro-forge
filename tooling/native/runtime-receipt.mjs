import { ENGINE_KINDS } from "../../packages/ignition/src/types.ts";

export const runtimeEngineKinds = Object.freeze([...ENGINE_KINDS]);
const hasRegisteredEngines = value => Array.isArray(value) && value.length === runtimeEngineKinds.length &&
  new Set(value).size === value.length && runtimeEngineKinds.every(kind => value.includes(kind));

export const runtimeChecks = Object.freeze([
  "binary-input-output-ownership", "restore-input-ownership", "cache-copy-lru-bounds",
  "cache-fifo-close", "running-and-queued-cancellation", "task-progress-result-ownership",
  "document-fifo-close", "output-survives-document-close", "mmkv-v4-native-binary-ownership",
  "mmkv-v4-yjs-roundtrip", "mmkv-v4-process-reopen", "mmkv-v4-scope-isolation",
  "mmkv-v4-corruption-preserved", "mmkv-v4-explicit-recovery",
  "mmkv-v4-all-engine-snapshot-reopen",
]);

export const restartChecks = Object.freeze([
  "mmkv-v4-native-binary-ownership", "mmkv-v4-yjs-roundtrip", "mmkv-v4-all-engine-snapshot-write",
]);

/** An app receipt is accepted only for this candidate, host, and fresh run. */
export function parseRuntimeReceipt(envelope, { platform, revision, runId }) {
  if (!envelope || envelope.platform !== platform || envelope.revision !== revision || envelope.runId !== runId ||
      typeof envelope.message !== "string") throw new Error("Native receipt has different platform/source/run provenance");
  if (envelope.message.startsWith("FORGE_NATIVE_RUNTIME_FAIL ")) throw new Error(envelope.message.slice(0, 8000));
  const match = /^FORGE_NATIVE_RUNTIME_(PASS|RESTART) (\{[^\r\n]+\})$/.exec(envelope.message);
  if (!match) throw new Error("Native receipt contains no complete runtime report");
  const report = JSON.parse(match[2]);
  const phase = match[1] === "RESTART" ? "restart-required" : "complete";
  const required = phase === "restart-required" ? restartChecks : runtimeChecks;
  if (report.schema !== 1 || report.platform !== platform || report.revision !== revision || report.runId !== runId ||
      (report.phase !== undefined && report.phase !== phase) || typeof report.processToken !== "string" || !report.processToken ||
      !hasRegisteredEngines(report.engineKinds) ||
      !Array.isArray(report.checks) || report.checks.length !== required.length ||
      new Set(report.checks).size !== report.checks.length || required.some(check => !report.checks.includes(check))) {
    throw new Error("Native acceptance reported incomplete checks/engine roster or different platform/source/run provenance");
  }
  return { ...report, phase };
}

export function verifyRestart(previous, current) {
  if (!previous || previous.phase !== "restart-required" || current.phase !== "complete" ||
      previous.runId !== current.runId || previous.processToken === current.processToken ||
      !hasRegisteredEngines(previous.engineKinds) || !hasRegisteredEngines(current.engineKinds)) {
    throw new Error("MMKV evidence requires a write receipt followed by a different app process");
  }
}
