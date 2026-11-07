import { Directory, File, Paths } from "expo-file-system";
import { createNitroHost, DocumentHandle } from "@nitro-forge/ignition";
import { createCheckpointStore, DocumentAutosave } from "@nitro-forge/ignition/autosave";
// Candidate-only API: this file belongs to the opt-in companion-branch lab,
// not the alpha.4 default consumer graph. The linked package supplies its type.
import { createPlatformCheckpointStorage } from "@nyc-tron/platform-services/checkpoints";

export async function verifyNativeCheckpoints(): Promise<string> {
  const storage = createPlatformCheckpointStorage("completion-acceptance");
  const store = createCheckpointStore(storage);
  const host = createNitroHost();
  let document: DocumentHandle | undefined;
  let autosave: DocumentAutosave | undefined;
  try {
    // An existing checkpoint proves persistence across a full app relaunch.
    const existing = await DocumentAutosave.recover(host, "cadence", store, "cadence");
    const reopened = existing !== undefined;
    if (existing) {
      const { data } = await existing.apply<{ tempo_bpm: number }>("describe");
      if (data.tempo_bpm !== 120) throw new Error("Persisted checkpoint lost its acknowledged state");
      await existing.close();
    }
    await storage.remove("cadence");
    document = await DocumentHandle.open(host, "cadence");
    await document.apply("new");
    autosave = new DocumentAutosave(document, store, "cadence", 60_000);
    await document.apply("setTempo", { bpm: 130 }); await autosave.flush();
    await document.undo(); await autosave.flush();
    await document.redo(); await autosave.flush();
    await autosave.close(); autosave = undefined;
    await document.close(); document = undefined;

    // A torn temporary write must never supersede the last committed file.
    const dir = new Directory(Paths.document, "NYCTronCheckpoints", "completion-acceptance", "cadence");
    const torn = new File(dir, "interrupted.tmp");
    torn.create({ overwrite: true }); await torn.write(new Uint8Array([0, 1]));
    const files = dir.list().filter((file): file is File => file instanceof File && /^\d{16}\.bin$/.test(file.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    // Corrupt the newest committed generation; the prior undo checkpoint is 120 BPM.
    await files[0]!.write(new Uint8Array([0]));
    const freshStorage = createPlatformCheckpointStorage("completion-acceptance");
    try {
      const recovered = await DocumentAutosave.recover(host, "cadence", createCheckpointStore(freshStorage), "cadence");
      if (!recovered) throw new Error("Native checkpoint disappeared");
      try {
        const { data } = await recovered.apply<{ tempo_bpm: number }>("describe");
        if (data.tempo_bpm !== 120) throw new Error("Corrupt generation did not recover last good state");
      } finally { await recovered.close(); }
    } finally { await freshStorage.close(); }

    // Cause a real native I/O failure without filling the disk: a regular
    // file occupies the directory path for this separate disposable key.
    const blocked = new File(Paths.document, "NYCTronCheckpoints", "completion-acceptance", "blocked");
    blocked.create({ overwrite: true }); await blocked.write("blocked");
    document = await DocumentHandle.open(host, "cadence"); await document.apply("new");
    autosave = new DocumentAutosave(document, store, "blocked", 60_000);
    await document.apply("setTempo", { bpm: 140 });
    let rejected = false;
    try { await autosave.flush(); } catch { rejected = true; }
    if (!rejected || autosave.state.savedRevision !== 0 || !autosave.state.error)
      throw new Error("Failed native save was reported as acknowledged");
    blocked.delete(); await autosave.flush();
    if (autosave.state.savedRevision !== autosave.state.revision || autosave.state.error)
      throw new Error("Native save did not recover after I/O retry");
    await autosave.close(); autosave = undefined;
    await document.close(); document = undefined;
    await storage.remove("blocked");
    return `Native checkpoint storage passed: disk write, undo/redo, fresh-store recovery, interrupted-write isolation, corruption fallback and I/O-failure retry. Prior app checkpoint reopened: ${reopened}.`;
  } finally {
    try { await autosave?.close(); } finally {
      try { await document?.close(); } finally {
        try { await host.dispose(); } finally { await storage.close(); }
      }
    }
  }
}
