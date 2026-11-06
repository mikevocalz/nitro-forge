import { Platform } from "react-native";
import { createNitroHost } from "@nitro-forge/ignition";
import { DocumentCollaboration, CollaborationConflict } from "@nitro-forge/ignition/collaboration";
import { createHttpCollaborationTransport, CollaborationTransportError, type RevisionWatch } from "@nitro-forge/ignition/collaboration-http";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Native collaboration: ${message}`);
}
async function deadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Native collaboration notification deadline")), 10000);
  })]); } finally { clearTimeout(timer); }
}

/** Requires the explicit loopback acceptance service, never a mock transport. */
export async function verifyNativeCollaboration(): Promise<string> {
  const host = createNitroHost();
  const transport = createHttpCollaborationTransport({ baseUrl: "http://127.0.0.1:4187" });
  const id = `native:${Platform.OS}:${Date.now()}`;
  const documents: DocumentCollaboration[] = [];
  let watch: RevisionWatch | undefined;
  try {
    const a = await DocumentCollaboration.create(host, "cadence", id, transport, [{ op: "new" }]); documents.push(a);
    const b = await DocumentCollaboration.create(host, "cadence", id, transport, [{ op: "new" }]); documents.push(b);
    await a.apply([{ op: "setTempo", payload: { bpm: 137 } }]); await a.syncNow();
    await b.acceptRemote();
    check((await b.describe<{ tempo_bpm: number }>()).data.tempo_bpm === 137, "initial peer restore failed");
    let changed!: () => void, failed!: (error: unknown) => void;
    const updated = new Promise<void>((resolve, reject) => { changed = resolve; failed = reject; });
    watch = transport.watch({ documentId: id, afterRevision: 1, intervalMs: 250,
      onRevision: async () => { await b.syncNow(); changed(); }, onError: error => { failed(error); return "stop"; } });
    await a.apply([{ op: "setTempo", payload: { bpm: 143 } }, { op: "setTimeSig", payload: { n: 3, d: 4 } }]);
    await a.syncNow(); await deadline(updated); await watch.close(); watch = undefined;
    check((await b.describe<{ tempo_bpm: number }>()).data.tempo_bpm === 143, "revision notification did not restore real engine");
    check(!await b.undo(), "remote revision retained unrelated history");
    await b.apply([{ op: "setTempo", payload: { bpm: 160 } }]);
    let conflict!: () => void, conflictFailed!: (error: unknown) => void;
    const conflicted = new Promise<void>((resolve, reject) => { conflict = resolve; conflictFailed = reject; });
    watch = transport.watch({ documentId: id, afterRevision: 2, intervalMs: 250,
      onRevision: async () => { await b.syncNow(); }, onError: error => {
        if (error instanceof CollaborationConflict) conflict(); else conflictFailed(error);
        return "stop";
      } });
    await a.apply([{ op: "setTempo", payload: { bpm: 150 } }]); await a.syncNow();
    await deadline(conflicted); await watch.close(); watch = undefined;
    check(b.state.dirty && (await b.describe<{ tempo_bpm: number }>()).data.tempo_bpm === 160, "remote conflict overwrote local draft");
    check(await b.undo(), "conflict erased local history");
    await b.acceptRemote();
    check((await b.describe<{ tempo_bpm: number }>()).data.tempo_bpm === 150, "explicit conflict resolution failed");
    try { await transport.read("forbidden:fixture"); throw new Error("Unauthorized read accepted"); }
    catch (error) { check(error instanceof CollaborationTransportError && error.status === 403, "authorization error not preserved"); }
    return "Native collaboration passed: real HTTP/SQLite revisions, peer notifications into Rust, atomic edits, preserved conflicts/history, explicit resolution and denied unauthorized access.";
  } finally {
    await watch?.close();
    try { for (const document of documents) await document.close(); } finally { await host.dispose(); }
  }
}
