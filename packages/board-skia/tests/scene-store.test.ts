import { describe, expect, it } from "vitest";
import type { Store } from "@quickdrawjs/core";
import { createNativeBoardSceneBridge } from "../src/scene-store";

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
  it("starts from the only document authority and coalesces updates", () => {
    const s = fakeStore();
    const pending = new Map<number, (now: number) => void>();
    let next = 1;
    const b = createNativeBoardSceneBridge({
      source: s.source,
      getInkOutline: () => undefined,
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
