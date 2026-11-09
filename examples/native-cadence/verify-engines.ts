import { createNitroHost, ENGINE_KINDS } from "@nitro-forge/ignition";
import { CadenceInstrumentSession } from "@nitro-forge/cadence/instrument-session";

/** Run only inside the installed native lab, against the production JSI host. */
export async function verifyNativeEngines(): Promise<string> {
  const host = createNitroHost();
  const verified: string[] = [];
  const failures: string[] = [];
  try {
    for (const kind of ENGINE_KINDS) {
      try {
      const handle = await host.open(kind);
      const describeJson = async (h: number) =>
        JSON.stringify((await host.apply(h, { op: "describe", payload: {} })).data);
      // describe may embed a revision counter that restore legitimately bumps
      // (draft source_revision); compare with that field stripped to classify
      // a mismatch precisely instead of guessing.
      const stripRevision = (json: string) =>
        JSON.stringify(JSON.parse(json), (key, value) =>
          key === "source_revision" ? undefined : value);
      const diffKind = (a: string, b: string) =>
        stripRevision(a) === stripRevision(b) ? "describe fields identical except source_revision" : "document fields differ";
      try {
        // A newly allocated engine is not yet an initialized document (Prism
        // deliberately starts at 0x0); use the documented new operation.
        await host.apply(handle, {
          op: "new", payload: kind === "prism" ? { width: 32, height: 32 } : {},
        });
        const before = await describeJson(handle);
        const bytes = await host.snapshot(handle);
        if (String.fromCharCode(...bytes.subarray(0, 4)) !== "NFD1")
          throw new Error(`${kind}: invalid snapshot envelope`);
        await host.restore(handle, bytes);
        const afterRestore = await describeJson(handle);
        if (afterRestore !== before)
          throw new Error(`${kind}: snapshot round trip changed document (${diffKind(before, afterRestore)})`);
        let rejected = false;
        try { await host.restore(handle, new Uint8Array([0])); }
        catch { rejected = true; }
        if (!rejected) throw new Error(`${kind}: accepted invalid snapshot`);
        const afterReject = await describeJson(handle);
        if (afterReject !== before)
          throw new Error(`${kind}: invalid restore changed document (${diffKind(before, afterReject)})`);
      } finally {
        await host.close(handle);
      }
      let rejected = false;
      try { await host.apply(handle, { op: "describe", payload: {} }); }
      catch { rejected = true; }
      if (!rejected) throw new Error(`${kind}: closed document remained usable`);
      verified.push(kind);
      } catch (error) {
        failures.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const session = await CadenceInstrumentSession.open(host);
    try {
      await session.setGain(0.5);
      await session.setPan(0.25);
      if (session.state.gain !== 0.5 || session.state.pan !== 0.25)
        throw new Error("Cadence: committed values did not reach Rust");
      if (!await session.undo() || Number(session.state.pan) !== 0)
        throw new Error("Cadence: undo did not restore pan");
      if (!await session.redo() || session.state.pan !== 0.25)
        throw new Error("Cadence: redo did not restore pan");
      const bytes = await session.save();
      const restored = await host.open("cadence");
      try {
        await host.restore(restored, bytes);
        const { data } = await host.apply<{ tracks: { volume: number; pan: number }[] }>(restored, { op: "describe", payload: {} });
        if (data.tracks[0]?.volume !== 0.5 || data.tracks[0]?.pan !== 0.25)
          throw new Error("Cadence: reopened snapshot lost committed values");
      } finally { await host.close(restored); }
    } finally { await session.close(); }
    if (failures.length > 0)
      throw new Error(
        `engine failures: ${failures.join("; ")}. ` +
        `Passed: ${verified.join(", ") || "none"}. ` +
        `Cadence edit, undo, redo and reopen passed.`,
      );
    return `Native engine round trips passed: ${verified.join(", ")}. Cadence edit, undo, redo and reopen passed.`;
  } finally {
    await host.dispose();
  }
}
