import { createNitroHost, DocumentHandle, ENGINE_KINDS, EngineError } from "@nitro-forge/ignition";
import { UndoTransactionCoordinator } from "@nitro-forge/ignition/transactions";
import { CadenceInstrumentSession } from "@nitro-forge/cadence/instrument-session";

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function verifyNativeTransactions(): Promise<string> {
  const host = createNitroHost();
  try {
    for (const kind of ENGINE_KINDS) {
      const doc = await DocumentHandle.open(host, kind);
      try {
        await doc.apply("new", kind === "prism" ? { width: 2, height: 2 } : {});
        if (kind === "tally") await doc.apply("setCell", { addr: "A1", value: "before" });
        if (kind === "quill") await doc.apply("insertText", { at: { block: 0, offset: 0 }, text: "before" });
        const before = await doc.snapshot();
        const payload = kind === "prism" ? { width: 3, height: 4 }
          : kind === "cadence" ? { tempo_bpm: 140 }
          : kind === "splice" ? { fps: 24 }
          : kind === "folio" ? { pages: 2 }
          : kind === "pitch" ? { title: "After transaction" } : {};
        const result = await doc.applyBatch([{ op: "new", payload }, { op: "describe" }]);
        check(result.data.results.length === 2 && result.events.filter(e => e.kind === "document:changed").length === 1,
          `${kind}: batch result/events are invalid`);
        const after = await doc.snapshot();
        check(!same(before, after), `${kind}: batch did not mutate`);
        check(await doc.undo() && same(await doc.snapshot(), before), `${kind}: compound undo failed`);
        let rejected = false;
        try { await doc.applyBatch([{ op: "new", payload }, { op: "unknownOperation" }]); }
        catch (error) {
          check(error instanceof EngineError && error.code === "invalid_command" && error.recoverable,
            `${kind}: native rejection lost its error code/recoverability`);
          rejected = true;
        }
        check(rejected && same(await doc.snapshot(), before), `${kind}: failed batch leaked edits`);
        check(await doc.redo() && same(await doc.snapshot(), after), `${kind}: failure erased redo`);
      } finally { await doc.close(); }
    }
    const doc = await DocumentHandle.open(host, "cadence");
    const coordinator = new UndoTransactionCoordinator(doc, (_initial: Readonly<{ bpm: number; numerator: number }>, next) => [
      { op: "setTempo", payload: { bpm: next.bpm } },
      { op: "setTimeSig", payload: { n: next.numerator, d: 4 } },
    ]);
    try {
      await doc.apply("new"); const before = await doc.snapshot();
      const cancelled = coordinator.begin({ bpm: 120, numerator: 4 }, "touch");
      coordinator.update(cancelled, { bpm: 140, numerator: 3 }); coordinator.cancel(cancelled);
      check(same(await doc.snapshot(), before), "Cancelled preview changed engine state");
      const id = coordinator.begin({ bpm: 120, numerator: 4 }, "pen");
      check(!coordinator.update(cancelled, { bpm: 180, numerator: 4 }), "Stale gesture was accepted");
      coordinator.update(id, { bpm: 140, numerator: 3 });
      const committing = coordinator.commit(id);
      check(coordinator.commit(id) === committing, "Gesture dispatched twice");
      check((await committing).committed, "Gesture did not commit");
      check(await coordinator.undo() && same(await doc.snapshot(), before), "Gesture was not one undo entry");
      await coordinator.redo();
    } finally { try { await coordinator.close(); } finally { await doc.close(); } }

    const session = await CadenceInstrumentSession.open(host);
    try {
      check(!await session.undo(), "Instrument setup leaked into user history");
      await session.xyPad.onCommit({ x: 0.75, y: 0.4 });
      check(session.state.gain === 0.4 && session.state.pan === 0.5, "XY axes did not reach Rust");
      await session.undo();
      check(Number(session.state.gain) === 1 && Number(session.state.pan) === 0, "XY gesture did not undo together");
      await session.redo();
      check(session.state.gain === 0.4 && session.state.pan === 0.5, "XY gesture did not redo together");
    } finally { await session.close(); }
    return "Native transactions passed: seven atomic engines, rollback/history preservation, gesture cancellation/stale-event isolation and paired gain/pan undo/redo.";
  } finally { await host.dispose(); }
}
