import { describe, expect, it } from "vitest";
import { createInkOutlineEncoder, createWhiteboardRendererBinding } from "../src";
import type { ShapeRecord, Store } from "@quickdrawjs/core";

const makeDraw = () => ({
  id: "draw:1",
  typeName: "shape",
  type: "draw",
  x: 0,
  y: 0,
  rot: 0,
  props: { size: "m", dash: "draw", pts: [{ x: 0, y: 0 }] },
});

describe("native whiteboard QuickDraw compatibility", () => {
  it("encodes original snapshot records with the editor's ink outline", () => {
    const shape = makeDraw();
    let calls = 0;
    const encoder = createInkOutlineEncoder((_s) => { calls++; return [0, 0, 10, 2]; });
    const snapshot = { document: { store: { "draw:1": shape } } };
    const first = JSON.parse(encoder.encodeSnapshot(snapshot as never));
    expect(first.document.store["draw:1"].inkOutline).toEqual([0, 0, 10, 2]);
    encoder.encodeSnapshot(snapshot as never);
    expect(calls).toBe(1); // cache by immutable props identity
  });

  it("encodes updated record's new value and deletes by record id", () => {
    const encoder = createInkOutlineEncoder((_s: ShapeRecord) => [1, 1, 2, 2]);
    const record = makeDraw();
    const diff = {
      added: { "draw:1": record },
      updated: { "draw:2": [record, { ...record, id: "draw:2" }] },
      removed: { "draw:3": record },
    };
    const result = JSON.parse(encoder.encodeDiff(diff as never));
    expect(result.updated["draw:2"][0]).toBeNull();
    expect(result.updated["draw:2"][1].inkOutline).toEqual([1, 1, 2, 2]);
    expect(result.removed["draw:3"]).toBeNull();
  });

  it("sends one snapshot then ordered diffs to the native renderer", () => {
    const calls: Array<[string, number]> = [];
    let notify: ((diff: unknown) => void) | undefined;
    let revision = 0;
    const snapshot = { document: { store: {} } };
    const store = {
      getSnapshot: () => snapshot,
      listen: (listener: (diff: unknown) => void) => {
        notify = listener; return () => { notify = undefined; };
      },
    } as unknown as Store;
    const renderer = {
      loadSnapshot: (rev: number) => { calls.push(["snapshot", rev]); revision = rev; },
      applyDiff: (rev: number) => { calls.push(["diff", rev]); revision = rev; },
      setCamera: () => {},
      setOverlay: () => {},
      addOnStateChangedListener: () => ({ remove: () => {} }),
    };
    const binding = createWhiteboardRendererBinding({
      store,
      renderer: renderer as never,
      getInkOutline: () => undefined,
      requestFrame: () => 1,
      cancelFrame: () => {},
    });
    binding.flush();
    expect(revision).toBe(1);
    notify?.({ added: {}, updated: {}, removed: {} });
    binding.flush();
    expect(calls).toEqual([["snapshot", 1], ["diff", 2]]);
    binding.dispose();
    expect(notify).toBeUndefined();
  });
});
