import { Platform } from "react-native";
import { NitroModules } from "react-native-nitro-modules";
import type { MMKV } from "react-native-mmkv";
import * as Y from "yjs";
import { CorruptCheckpointError } from "@nitro-forge/board/offline";
import { createMMKVBoardStorage } from "@nitro-forge/board/offline/mmkv";
import { createLocalYjsBoardSession, type LocalYjsBoardSession } from "@nitro-forge/board/offline/yjs";

const processToken = `${Date.now()}-${Math.random()}`;
const scope = "native-acceptance/account-one";
const documentId = "offline-strokes";
const recordKey = `nitroforge.board.v1/${encodeURIComponent(scope)}/${encodeURIComponent(documentId)}`;
const expected = new Uint8Array([0, 1, 127, 128, 255]);

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`MMKV native acceptance: ${message}`);
}
function equalBytes(left: ArrayBuffer, right: Uint8Array): boolean {
  const bytes = new Uint8Array(left);
  return bytes.length === right.length && bytes.every((value, index) => value === right[index]);
}

/** The driver force-stops and relaunches the installed app between these phases. */
export async function verifyBoardOffline(mmkv: MMKV) {
  check(Platform.OS === "ios" || Platform.OS === "android", "requires an installed native app");
  const runId = process.env.EXPO_PUBLIC_FORGE_ACCEPTANCE_RUN ?? "manual";
  check(NitroModules.isHybridObject(mmkv), "a JavaScript/mock MMKV instance cannot satisfy native acceptance");
  const storage = createMMKVBoardStorage(mmkv, { scope });
  const documents: Y.Doc[] = [], sessions: LocalYjsBoardSession[] = [];
  const session = () => {
    const doc = new Y.Doc(); documents.push(doc);
    const records = doc.getMap<unknown>("records");
    const board = createLocalYjsBoardSession({ documentId, storage, document: {
      encode: () => Y.encodeStateAsUpdate(doc),
      merge: (bytes, origin) => Y.applyUpdate(doc, bytes, origin),
    } });
    sessions.push(board);
    return { doc, records, board };
  };
  const checks: string[] = [];
  let primaryFailure: unknown;
  try {
    const input = expected.slice();
    mmkv.set("binary-probe", input.buffer); input.fill(42);
    const output = mmkv.getBuffer("binary-probe");
    check(output && equalBytes(output, expected), "set borrowed caller bytes");
    new Uint8Array(output).fill(91);
    check(equalBytes(mmkv.getBuffer("binary-probe")!, expected), "getBuffer returned mutable storage");
    checks.push("mmkv-v4-native-binary-ownership");

    const metadata = mmkv.getString("acceptance-run");
    const previous = metadata ? JSON.parse(metadata) as { runId: string; phase: string; processToken: string } : undefined;
    if (!previous || previous.runId !== runId || previous.phase !== "restart-required") {
      // This ID belongs only to this acceptance app; no user storage is touched.
      mmkv.remove(recordKey);
      const seed = session();
      await seed.board.initialize();
      seed.doc.transact(() => {
        seed.records.set("stroke-one", { x: 12, y: 24, pressure: 0.7 });
        seed.records.set("stroke-two", { x: 18, y: 31, pressure: 0.4 });
      }, "local");
      check((await seed.board.saveLocal()).revision === 1, "local transaction did not produce revision 1");
      await seed.board.close();
      const sameProcess = session();
      await sameProcess.board.initialize();
      check(sameProcess.records.size === 2 && sameProcess.board.lastReceipt?.needsSync, "Yjs round trip lost records or sync state");
      await sameProcess.board.close();
      checks.push("mmkv-v4-yjs-roundtrip");
      mmkv.set("acceptance-run", JSON.stringify({ runId, phase: "restart-required", processToken }));
      return { phase: "restart-required" as const, runId, processToken, checks };
    }

    check(previous.processToken !== processToken, "reopen must happen in a new app process");
    const reopened = session();
    const receipt = await reopened.board.initialize();
    check(receipt.revision === 1 && receipt.syncedRevision === 0 && receipt.needsSync, "process relaunch lost checkpoint metadata");
    check(JSON.stringify(reopened.records.get("stroke-one")) === JSON.stringify({ x: 12, y: 24, pressure: 0.7 }) &&
      reopened.records.has("stroke-two"), "process relaunch lost Yjs records");
    await reopened.board.close();
    checks.push("mmkv-v4-yjs-roundtrip", "mmkv-v4-process-reopen");
    check(await createMMKVBoardStorage(mmkv, { scope: "native-acceptance/account-two" }).load(documentId) === null,
      "another account could read this checkpoint");
    checks.push("mmkv-v4-scope-isolation");

    const saved = mmkv.getBuffer(recordKey);
    check(saved && saved.byteLength > 32, "binary checkpoint is missing");
    const corrupt = saved.slice(0), corruptBytes = new Uint8Array(corrupt);
    corruptBytes[corruptBytes.length - 1] ^= 0xff;
    mmkv.set(recordKey, corrupt);
    const recovery = session();
    const error = await recovery.board.initialize().catch(error => error);
    check(error instanceof CorruptCheckpointError && recovery.board.status === "corrupt", "corruption was not surfaced as a typed error");
    check(equalBytes(mmkv.getBuffer(recordKey)!, corruptBytes), "failed open silently replaced corrupt bytes");
    const wrong = await recovery.board.discardCorruptCheckpoint("different-board").catch(error => error);
    check(wrong instanceof Error && equalBytes(mmkv.getBuffer(recordKey)!, corruptBytes), "wrong-board confirmation changed data");
    checks.push("mmkv-v4-corruption-preserved");
    recovery.records.set("recovered", true);
    await recovery.board.discardCorruptCheckpoint(documentId);
    await recovery.board.close();
    const afterRecovery = session();
    await afterRecovery.board.initialize();
    check(afterRecovery.records.get("recovered") === true && afterRecovery.board.lastReceipt?.revision === 0,
      "explicit recovery did not write a readable replacement");
    checks.push("mmkv-v4-explicit-recovery");
    mmkv.set("acceptance-run", JSON.stringify({ runId, phase: "complete", processToken }));
    return { phase: "complete" as const, runId, processToken, checks };
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const closed = await Promise.allSettled(sessions.map(board => board.close()));
    for (const doc of documents) doc.destroy();
    const errors = closed.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(primaryFailure ? [primaryFailure, ...errors] : errors, "MMKV acceptance session cleanup failed");
  }
}
