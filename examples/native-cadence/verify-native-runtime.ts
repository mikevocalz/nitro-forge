import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";
import { ForgeFactory } from "@nitro-forge/ignition/nitro";
import { DocumentHandle, ENGINE_KINDS, normalizeNativeEngineError, type EngineKind, type ForgeDocument, type ForgeMediaCache, type ForgeTask } from "@nitro-forge/ignition";
import { createCheckpointStore, DocumentAutosave } from "@nitro-forge/ignition/autosave";
import { createMMKVCheckpointStorage } from "@nitro-forge/ignition/autosave/mmkv";
import { ForgeV1EngineHost } from "@nitro-forge/ignition/v1-host";
import { verifyBoardOffline } from "./verify-board-offline";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Native runtime: ${message}`);
}
function equalBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const left = new Uint8Array(a), right = new Uint8Array(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
async function rejects(work: () => unknown | Promise<unknown>, message: string) {
  let rejected = false;
  try { await work(); } catch { rejected = true; }
  check(rejected, message);
}
const command = (op: string, payload: unknown = {}) => ({ op, payloadJson: JSON.stringify(payload) });

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function savedDescription(kind: EngineKind, description: Record<string, unknown>): string {
  // Draft's source_revision identifies a live owner; it is not persisted state.
  const value = { ...description };
  if (kind === "draft") delete value.source_revision;
  return JSON.stringify(canonical(value));
}

/** Runs only against generated Nitro v1 bindings in an installed native app.
 * No injectable host, CLI, mock or platform fallback can satisfy this routine. */
export async function verifyNativeRuntime(): Promise<string> {
  const started = performance.now();
  const mmkv = createMMKV({ id: "forge-board-native-acceptance", recoveryStrategy: "recover-on-error" });
  const offline = await verifyBoardOffline(mmkv);
  const checks = [...offline.checks];
  const factory = new ForgeFactory();
  const checkpointHost = new ForgeV1EngineHost(factory);
  const checkpointStore = createCheckpointStore(createMMKVCheckpointStorage(mmkv, {
    scope: "native-acceptance/engine-checkpoints", maxCheckpointBytes: 8 * 1024 * 1024,
  }));
  const documents: ForgeDocument[] = [], tasks: ForgeTask[] = [];
  let cache: ForgeMediaCache | undefined, primaryFailure: unknown;
  try {
    if (offline.phase === "restart-required") {
      for (const kind of ENGINE_KINDS) {
        const document = await DocumentHandle.open(checkpointHost, kind);
        try {
          await document.apply("new", kind === "prism" ? { width: 4, height: 4 } : kind === "folio" ? { pages: 1 } : {});
          const expected = savedDescription(kind, (await document.apply<Record<string, unknown>>("describe", {})).data);
          await new DocumentAutosave(document, checkpointStore, kind, 60_000).close();
          mmkv.set(`engine-checkpoint-description/${kind}`, expected);
        } finally { await document.close(); }
      }
      mmkv.set("engine-checkpoint-run", offline.runId);
      checks.push("mmkv-v4-all-engine-snapshot-write");
      return `FORGE_NATIVE_RUNTIME_RESTART ${JSON.stringify({
        schema: 1, platform: Platform.OS, revision: process.env.EXPO_PUBLIC_FORGE_REVISION ?? "local",
        ...offline, checks, engineKinds: ENGINE_KINDS,
      })}`;
    }
    check(mmkv.getString("engine-checkpoint-run") === offline.runId, "engine checkpoints belong to another run");
    for (const kind of ENGINE_KINDS) {
      const document = await DocumentAutosave.recover(checkpointHost, kind, checkpointStore, kind);
      check(document, `${kind} checkpoint was missing after process relaunch`);
      try {
        const actual = savedDescription(kind, (await document.apply<Record<string, unknown>>("describe", {})).data);
        check(actual === mmkv.getString(`engine-checkpoint-description/${kind}`), `${kind} checkpoint changed across process relaunch`);
      } finally { await document.close(); }
    }
    checks.push("mmkv-v4-all-engine-snapshot-reopen");

    const prism = await factory.open("prism"); documents.push(prism);
    await prism.apply(command("new", { width: 1, height: 1 }));
    const layer = JSON.parse((await prism.apply(command("addRasterLayer"))).dataJson).layer_id;
    const pixels = new Uint8Array([11, 22, 33, 255]);
    const drawing = prism.applyBinary(command("drawPixels", { id: layer, x: 0, y: 0, w: 1, h: 1 }), pixels.buffer);
    pixels.fill(0); await drawing;
    const flattened = await prism.applyBinary(command("flatten"));
    check(flattened.output && equalBytes(flattened.output, new Uint8Array([11, 22, 33, 255]).buffer), "binary input was borrowed or output pixels changed");
    check(!Object.hasOwn(JSON.parse(flattened.dataJson), "pixels_b64"), "binary output was encoded as base64");
    const saved = await prism.snapshot(), expected = saved.slice(0);
    const restoring = prism.restore(saved); new Uint8Array(saved).fill(0); await restoring;
    check(equalBytes(await prism.snapshot(), expected), "restore borrowed caller bytes");
    checks.push("binary-input-output-ownership", "restore-input-ownership");

    cache = factory.createMediaCache(4);
    const first = new Uint8Array([1, 2]);
    const putting = cache.put("revision:1:a", first.buffer); first.fill(9); await putting;
    await cache.put("revision:1:b", new Uint8Array([3, 4]).buffer);
    const cached = await cache.get("revision:1:a");
    check(cached && equalBytes(cached, new Uint8Array([1, 2]).buffer), "cache borrowed input bytes");
    new Uint8Array(cached).fill(8);
    check(equalBytes((await cache.get("revision:1:a"))!, new Uint8Array([1, 2]).buffer), "cache returned borrowed storage");
    await cache.put("revision:1:c", new Uint8Array([5, 6]).buffer);
    check(await cache.get("revision:1:b") === undefined && cache.byteSize === 4, "cache LRU or byte accounting changed");
    await rejects(() => cache!.put("oversized", new ArrayBuffer(5)), "oversized cache input succeeded");
    check(cache.byteSize === 4 && await cache.get("revision:1:a"), "rejected cache write changed retained entries");
    const acceptedPut = cache.put("revision:2:a", new Uint8Array([7, 8]).buffer), closingCache = cache.close();
    await acceptedPut; await closingCache; await cache.close();
    check(Number(cache.byteSize) === 0, "closed cache retained payload bytes");
    await rejects(() => cache!.get("revision:2:a"), "closed cache accepted a read");
    checks.push("cache-copy-lru-bounds", "cache-fifo-close");

    const audio = await factory.open("cadence"); documents.push(audio);
    const track = JSON.parse((await audio.apply(command("addTrack", { kind: "midi" }))).dataJson).track_id;
    const ticks = 115200;
    const clip = JSON.parse((await audio.apply(command("addClip", { track, start_ticks: 0, length_ticks: ticks }))).dataJson).clip_id;
    await audio.apply(command("addNote", { clip, pitch: 69, velocity: 100, start_ticks: 0, length_ticks: ticks }));
    const before = await audio.snapshot();
    const running = audio.startTask(command("render", { from_ticks: 0, to_ticks: ticks, sample_rate: 48000 })); tasks.push(running);
    let finished = false;
    const runningResult = running.result().then(value => { finished = true; return { value }; }, error => { finished = true; return { error }; });
    const queued = audio.startTask(command("setTempo", { bpm: 150 })); tasks.push(queued);
    const queuedResult = queued.result().then(value => ({ value }), error => ({ error }));
    queued.cancel(); queued.cancel();
    const deadline = Date.now() + 10000;
    let progress = running.progress;
    while (progress === 0 && !finished && Date.now() < deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 1));
      const next = running.progress;
      check(next >= progress && next <= 1, "task progress moved backwards or exceeded one"); progress = next;
    }
    check(progress > 0 && progress < 1 && !finished, "running cancellation checkpoint was not observed");
    running.cancel();
    for (const result of await Promise.all([runningResult, queuedResult])) {
      check("error" in result && normalizeNativeEngineError(result.error).code === "cancelled", "cancelled task did not reject with the engine code");
    }
    check(equalBytes(await audio.snapshot(), before), "cancelled work mutated the document");
    const completed = audio.startTask(command("render", { from_ticks: 0, to_ticks: 960, sample_rate: 8000 })); tasks.push(completed);
    const rendered = await completed.result();
    check(rendered.output && rendered.output.byteLength > 0 && completed.progress === 1, "completed task output/progress missing");
    check(!Object.hasOwn(JSON.parse(rendered.dataJson), "samples_b64"), "task output used base64");
    check(equalBytes((await completed.result()).output!, rendered.output), "repeated result changed native output");
    checks.push("running-and-queued-cancellation", "task-progress-result-ownership");

    const editing = prism.apply(command("setColors", { foreground: [91, 92, 93, 255] }));
    const describing = prism.apply(command("describe")), snapshotting = prism.snapshot(), closingDocument = prism.close();
    await editing;
    const finalDescription = (await describing).dataJson, finalSnapshot = await snapshotting;
    await closingDocument; await prism.close();
    await rejects(() => prism.snapshot(), "closed document accepted a snapshot");
    const reopened = await factory.open("prism"); documents.push(reopened);
    await reopened.restore(finalSnapshot);
    check((await reopened.apply(command("describe"))).dataJson === finalDescription, "close overtook accepted edits or snapshot");
    check(equalBytes(flattened.output, new Uint8Array([11, 22, 33, 255]).buffer), "output bytes depended on a live document");
    checks.push("document-fifo-close", "output-survives-document-close");

    return `FORGE_NATIVE_RUNTIME_PASS ${JSON.stringify({ schema: 1, platform: Platform.OS,
      revision: process.env.EXPO_PUBLIC_FORGE_REVISION ?? "local", runId: offline.runId, processToken: offline.processToken, checks, engineKinds: ENGINE_KINDS,
      storage: { bindings: "react-native-mmkv@4.3.2 + Nitro 120 port", core: Platform.OS === "ios" ? "MMKVCore@2.4.0" : "io.github.zhongwuzw:mmkv@2.4.1" },
      elapsedMs: Math.round(performance.now() - started) })}`;
  } catch (error) {
    primaryFailure = error; throw error;
  } finally {
    // Cancellation is nonblocking; document close drains every accepted task.
    const failures: unknown[] = [];
    for (const task of tasks) { try { task.cancel(); } catch (error) { failures.push(error); } }
    const cleanup = await Promise.allSettled([checkpointHost.dispose(), ...(cache ? [cache.close()] : []), ...documents.map(document => document.close())]);
    failures.push(...cleanup.flatMap(result => result.status === "rejected" ? [result.reason] : []));
    try { factory.dispose(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(primaryFailure ? [primaryFailure, ...failures] : failures, "Native runtime cleanup failed");
  }
}
