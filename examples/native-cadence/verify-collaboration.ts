import { createPlatformCheckpointStorage } from "@nyc-tron/platform-services/checkpoints";
import { createCollaborationCheckpointStore } from "@nitro-forge/ignition/collaboration-checkpoint";
import { Platform } from "react-native";
import { createNitroHost } from "@nitro-forge/ignition";
import { DocumentCollaboration, CollaborationConflict, type CollaborationTransport } from "@nitro-forge/ignition/collaboration";
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
async function verifyNativePeers(): Promise<string> {
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


/** Two real process launches: stage an ambiguous upload and later offline edit,
 * then recover both revision metadata and engine contents from native storage. */
export async function verifyNativeCollaboration(): Promise<string> {
  const disk = createPlatformCheckpointStorage("native-collaboration");
  const store = createCollaborationCheckpointStore(disk);
  const key = "recovery";
  const transport = createHttpCollaborationTransport({ baseUrl: "http://127.0.0.1:4187" });
  try {
    const saved = await store.read(key);
    if (saved) {
      const host = createNitroHost();
      let document: DocumentCollaboration | undefined;
      try {
        document = await DocumentCollaboration.recover({ host, transport, documentId: saved.documentId, checkpoint: saved });
        check(saved.pending && !saved.pending.matchesCurrent, "pending later-edit metadata missing after launch");
        check((await document.describe<{ tempo_bpm: number }>()).data.tempo_bpm === 181, "offline edit lost on launch");
        await document.syncNow();
        check(document.state.revision === 2 && !document.state.dirty, "durable ACK or later edit recovery failed");
        check((await document.describe<{ tempo_bpm: number }>()).data.tempo_bpm === 181, "recovered sync overwrote offline edit");
        await disk.remove(key);
        return "Native collaboration recovery passed after process relaunch: real SQLite ACK, exact pending upload, later offline edit at 181 BPM and clean revision 2. Peer notification/conflict/authorization workflow also passed before staging.";
      } finally { try { await document?.close(); } finally { await host.dispose(); } }
    }
    await verifyNativePeers();
    const host = createNitroHost();
    let document: DocumentCollaboration | undefined;
    const uncertain: CollaborationTransport = {
      read: id => transport.read(id),
      async compareAndSwap(id, revision, checkpoint) {
        const result = await transport.compareAndSwap(id, revision, checkpoint);
        check(result.accepted, "staging upload conflicted");
        // Deterministically simulate losing the client acknowledgement only
        // after the real HTTP service has committed to its SQLite database.
        throw new Error("Acceptance acknowledgement lost");
      },
    };
    try {
      document = await DocumentCollaboration.create(host, "cadence", `native:${Platform.OS}:${Date.now()}`,
        uncertain, [{ op: "new" }]);
      await document.apply([{ op: "setTempo", payload: { bpm: 137 } }]);
      try { await document.syncNow(); throw new Error("Expected lost acknowledgement"); }
      catch (error) { check(error instanceof Error && error.message === "Acceptance acknowledgement lost", "unexpected staging failure"); }
      await document.apply([{ op: "setTempo", payload: { bpm: 181 } }]);
      await store.write(key, await document.checkpoint());
      return "Native collaboration recovery staged: durable server revision 1, simulated lost client ACK and later offline edit persisted. Restart this app for recovery acceptance.";
    } finally { try { await document?.close(); } finally { await host.dispose(); } }
  } finally { await disk.close(); }
}
