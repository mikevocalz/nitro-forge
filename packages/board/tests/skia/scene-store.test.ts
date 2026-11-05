import { describe, expect, it } from "vitest";
import type { Store } from "@quickdrawjs/core";
import { createNativeBoardSceneBridge } from "../../src/skia/scene-store";
import { createInkOutlineEncoder } from "../../src/renderer/createInkOutlineEncoder";

function fakeStore() {
  let snapshot: unknown = { document: { store: {} } };
  let listener: (() => void) | null = null;
  return {
    source: {
      getSnapshot: () => snapshot,
      listen: (cb: () => void) => {
        listener = cb;
        return () => { listener = null; };
      },
    } as unknown as Pick<Store, "getSnapshot" | "listen">,
    change: (next: unknown) => {
      snapshot = next;
      listener?.();
    },
    get subscribed() { return listener !== null; },
  };
}
describe("Zustand native board scene subscription", () => {
  it.each([
    null,
    { id: "a", typeName: "shape", type: "draw", x: 0, y: 0, props: null },
    { id: "a", typeName: "shape", type: "draw", x: 0, y: 0, props: {} },
  ])("falls back for malformed records or outline failures and recovers without editing the source: %j", (record) => {
    const s = fakeStore();
    const original = { document: { store: { a: record } } };
    const preserved = JSON.stringify(original);
    s.change(original);
    const encoder = createInkOutlineEncoder(() => { throw new Error("outline cannot be produced"); });
    const pending = new Map<number, (now: number) => void>();
    let next = 0;
    const bridge = createNativeBoardSceneBridge({
      source: s.source,
      encodeSnapshot: encoder.encodeSnapshot,
      requestFrame(callback) { pending.set(++next, callback); return next; },
      cancelFrame(handle) { pending.delete(handle); },
    });
    expect(bridge.state.getState().scene.kind).toBe("unsupported");
    expect(JSON.stringify(s.source.getSnapshot())).toBe(preserved);
    // A subsequent good document recovers; fallback does not poison the owner.
    s.change({ document: { store: {} } });
    bridge.flush();
    expect(bridge.state.getState().scene).toEqual({ kind: "ready", marks: [] });
    // The same failure after mount must also publish fallback rather than throw.
    s.change(original);
    expect(() => bridge.flush()).not.toThrow();
    expect(bridge.state.getState().scene.kind).toBe("unsupported");
    expect(JSON.stringify(s.source.getSnapshot())).toBe(preserved);
    bridge.dispose();
    expect(pending.size).toBe(0);
    expect(s.subscribed).toBe(false);
  });

  it("starts from the only document authority and coalesces updates", () => {
    const s = fakeStore();
    const pending = new Map<number, (now: number) => void>();
    let next = 1;
    const b = createNativeBoardSceneBridge({
      source: s.source,
      encodeSnapshot: (value) => JSON.stringify(value),
      requestFrame(cb) { const id = next++; pending.set(id, cb); return id; },
      cancelFrame(handle) { pending.delete(handle); },
    });
    expect(b.state.getState().scene.kind).toBe("ready");
    expect(b.state.getState().revision).toBe(1);
    s.change({ document: { store: {} } });
    s.change({ document: { store: {} } });
    expect(pending.size).toBe(1);
    pending.get(1)?.(16);
    pending.delete(1);
    expect(b.state.getState().revision).toBe(2);
    s.change({ document: { store: {
      a: { id:"a", typeName:"shape", type:"text", x:0, y:0, props:{} },
    } } });
    expect(pending.size).toBe(1);
    b.flush();
    expect(pending.size).toBe(0);
    expect(b.state.getState().scene.kind).toBe("unsupported");
    expect(b.state.getState().revision).toBe(3);
    b.dispose();
    b.dispose();
    expect(s.subscribed).toBe(false);
    s.change({ document: { store: {} } });
    expect(pending.size).toBe(0);
    expect(b.state.getState().revision).toBe(3);
  });
});
