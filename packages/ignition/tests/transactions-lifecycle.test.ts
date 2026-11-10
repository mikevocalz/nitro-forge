import { expect, it, vi } from "vitest";
import { UndoTransactionCoordinator } from "../src/transactions";

function fixture() {
  let finishUndo!: (changed: boolean) => void;
  const undoing = new Promise<boolean>(resolve => { finishUndo = resolve; });
  const document = {
    applyBatch: vi.fn(async () => ({ data: { results: [] }, events: [{ kind: "document:changed" }] })),
    undo: vi.fn(() => undoing), redo: vi.fn(async () => false),
  };
  const coordinator = new UndoTransactionCoordinator(document, (_initial: Readonly<{ value: number }>, preview) =>
    [{ op: "edit", payload: { value: preview.value } }]);
  return { coordinator, document, finishUndo };
}

it("reserves history ownership before publishing cancellation of a preview", async () => {
  const { coordinator, finishUndo } = fixture();
  coordinator.begin({ value: 1 });
  const observed: string[] = [];
  const unsubscribe = coordinator.subscribe(state => {
    observed.push(state.phase);
    // A UI observer may immediately start a new gesture on an idle transition.
    if (state.phase === "idle") coordinator.begin({ value: 2 });
  });
  const undoing = coordinator.undo();
  expect(observed).toEqual(["committing"]);
  expect(() => coordinator.begin({ value: 3 })).toThrow("busy");
  unsubscribe(); finishUndo(true); await undoing;
  expect(coordinator.state.phase).toBe("idle");
  const next = coordinator.begin({ value: 4 });
  expect(coordinator.cancel(next)).toBe(true);
  await coordinator.close();
});

it("returns the same close promise to an observer that reenters shutdown", async () => {
  const { coordinator } = fixture();
  let repeated: Promise<void> | undefined, requested = false;
  coordinator.subscribe(state => {
    if (state.phase === "closed" && !requested) { requested = true; repeated = coordinator.close(); }
  });
  const first = coordinator.close();
  expect(repeated).toBe(first);
  await first;
});

it("drains an accepted rejected commit through close and preserves its error", async () => {
  const { coordinator, document } = fixture();
  let reject!: (error: Error) => void;
  document.applyBatch.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const id = coordinator.begin({ value: 1 }); coordinator.update(id, { value: 2 });
  const committing = coordinator.commit(id), closing = coordinator.close();
  await Promise.resolve();
  const error = new Error("engine rejected transaction"); reject(error);
  await expect(committing).rejects.toBe(error);
  await expect(closing).rejects.toBe(error);
  expect(coordinator.state).toMatchObject({ phase: "closed", error: error.message, preview: null });
});
