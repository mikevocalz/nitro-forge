import { afterEach, expect, it, vi } from "vitest";
import { CliHost } from "../src/host-cli";
import { DocumentHandle } from "../src/document";
import { UndoTransactionCoordinator } from "../src/transactions";

const hosts: CliHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose())); });

async function fixture() {
  const host = new CliHost(); hosts.push(host);
  const document = await DocumentHandle.open(host, "cadence"); await document.apply("new");
  const coordinator = new UndoTransactionCoordinator(document, (_initial: Readonly<{ bpm: number; numerator: number }>, value) => [
    { op: "setTempo", payload: { bpm: value.bpm } },
    { op: "setTimeSig", payload: { n: value.numerator, d: 4 } },
  ]);
  return { document, coordinator };
}

it("previews and cancellation preserve the engine and redo, while a compound commit undoes once", async () => {
  const { document, coordinator } = await fixture();
  await document.apply("setTempo", { bpm: 130 }); await document.undo();
  const initial = await document.snapshot();
  const cancelled = coordinator.begin({ bpm: 120, numerator: 4 }, "touch");
  coordinator.update(cancelled, { bpm: 140, numerator: 3 });
  expect(await document.snapshot()).toEqual(initial);
  expect(coordinator.cancel(cancelled)).toBe(true);
  expect(await document.redo()).toBe(true);
  const before = await document.snapshot();

  const id = coordinator.begin({ bpm: 130, numerator: 4 }, "pen");
  for (let i = 0; i < 100; i++) coordinator.update(id, { bpm: 140 + i / 10, numerator: 3 });
  const dispatch = vi.spyOn(document, "applyBatch");
  const first = coordinator.commit(id), duplicate = coordinator.commit(id);
  expect(duplicate).toBe(first);
  expect(coordinator.update(id, { bpm: 170, numerator: 4 })).toBe(false);
  expect(coordinator.cancel(id)).toBe(false);
  expect((await first).committed).toBe(true);
  expect(coordinator.commit(id)).toBe(first);
  expect(dispatch).toHaveBeenCalledTimes(1);
  const after = await document.snapshot(); expect(after).not.toEqual(before);
  await coordinator.undo(); expect(await document.snapshot()).toEqual(before);
  await coordinator.redo(); expect(await document.snapshot()).toEqual(after);
  await coordinator.close(); await document.close();
});

it("stale pointer events cannot affect a new gesture and unchanged previews create no history", async () => {
  const { document, coordinator } = await fixture();
  const stale = coordinator.begin({ bpm: 120, numerator: 4 }); coordinator.cancel(stale);
  const current = coordinator.begin({ bpm: 120, numerator: 4 }, "accessibility");
  expect(coordinator.update(stale, { bpm: 140, numerator: 3 })).toBe(false);
  await expect(coordinator.commit(stale)).rejects.toThrow("Stale");
  expect(() => coordinator.begin({ bpm: 140, numerator: 3 })).toThrow("busy");
  const apply = vi.spyOn(document, "applyBatch");
  expect((await coordinator.commit(current)).committed).toBe(false);
  expect(apply).not.toHaveBeenCalled();
  await coordinator.close(); await document.close();
});

it("a rejected engine step clears the preview without partial edits or history loss", async () => {
  const { document, coordinator } = await fixture();
  await document.apply("setTempo", { bpm: 130 }); await document.undo();
  const before = await document.snapshot();
  const id = coordinator.begin({ bpm: 120, numerator: 4 }, "keyboard");
  // Tempo is valid and executes in staging; the later time signature fails.
  coordinator.update(id, { bpm: 140, numerator: 0 });
  await expect(coordinator.commit(id)).rejects.toThrow();
  expect(coordinator.state).toMatchObject({ phase: "error", preview: null });
  expect(await document.snapshot()).toEqual(before);
  expect(await coordinator.redo()).toBe(true);
  await coordinator.close(); await document.close();
});

it("owns finite preview data, rejects resources/cycles and drains an accepted commit on close", async () => {
  const { document, coordinator } = await fixture();
  const value = { bpm: 120, numerator: 4 };
  const id = coordinator.begin(value); value.bpm = 300;
  expect(coordinator.state.preview?.bpm).toBe(120);
  expect(() => coordinator.update(id, { bpm: NaN, numerator: 4 })).toThrow();
  expect(() => coordinator.update(id, new Uint8Array() as never)).toThrow("resources");
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => coordinator.update(id, cyclic as never)).toThrow("acyclic");
  coordinator.update(id, { bpm: 140, numerator: 3 });
  const apply = document.applyBatch.bind(document);
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(document, "applyBatch").mockImplementation(async commands => { await blocked; return apply(commands); });
  const committing = coordinator.commit(id); const closing = coordinator.close();
  let closed = false; void closing.then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  expect(() => coordinator.begin(value)).toThrow("closed");
  release(); await committing; await closing;
  expect(coordinator.state.phase).toBe("closed");
  await expect(coordinator.commit(id)).rejects.toThrow("closed");
  await document.close();
});

it("blocks fresh gestures during history work and drains undo before closing", async () => {
  const { document, coordinator } = await fixture();
  await document.apply("setTempo", { bpm: 130 });
  const undo = document.undo.bind(document);
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(document, "undo").mockImplementation(async () => { await blocked; return undo(); });
  const undoing = coordinator.undo();
  expect(() => coordinator.begin({ bpm: 130, numerator: 4 })).toThrow("busy");
  const closing = coordinator.close();
  let closed = false; void closing.then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  release(); await undoing; await closing;
  expect((await document.apply<{ tempo_bpm: number }>("describe")).data.tempo_bpm).toBe(120);
  expect(coordinator.state.phase).toBe("closed");
  await document.close();
});
