import { describe, it, expect } from "vitest";
import { compileQuickDrawScene } from "../src/scene";

function snapshot(records: Record<string, unknown>) {
  return { document: { store: records } };
}
function draw(extra: Record<string, unknown> = {}) {
  return {
    id: "draw-1", typeName: "shape", type: "draw",
    x: 10, y: 15, rot: 0, z: 1,
    props: { color: "red", size: "m", dash: "draw", pts: [0, 0, 0, 10, 1, 1, 20, 0, 0.5] },
    inkOutline: [0, 0, 10, 5, 20, 0, 10, -5], ...extra,
  };
}

describe("strict QuickDraw -> Skia Graphite scene", () => {
  it("renders an empty board safely", () => {
    const r = compileQuickDrawScene(JSON.stringify(snapshot({})));
    expect(r).toEqual({ kind: "ready", marks: [] });
  });
  it("preserves QuickDraw's actual pressure outline, position and stroke palette", () => {
    const r = compileQuickDrawScene(snapshot({ a: draw() }));
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.marks).toHaveLength(1);
    expect(r.marks[0]?.path).toBe("M 10 15 L 20 20 L 30 15 L 20 10 Z");
    expect(r.marks[0]).toMatchObject({ color: "#E03131", mode: "fill", width: 0 });
  });
  it("draws highlights underneath other ink with multiply blend", () => {
    const highlight = { ...draw(), id: "hi", type: "highlight", z: 800 };
    const r = compileQuickDrawScene(snapshot({ ink: draw({ z: -10 }), hi: highlight }));
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.marks.map((x) => x.id)).toEqual(["hi", "draw-1"]);
    expect(r.marks[0]).toMatchObject({ blendMode: "multiply", width: 18, alpha: 0.55 });
  });
  it("supports native geometric paper shapes and native dash stroke", () => {
    const geo = {
      id: "g", typeName: "shape", type: "geo", x: 1, y: 2, rot: 0, z: 0,
      props: { geo: "rectangle", w: 20, h: 10, fill: "solid", color: "blue", size: "s", dash: "dashed" },
    };
    const r = compileQuickDrawScene(snapshot({ g: geo }));
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.marks).toHaveLength(2);
    expect(r.marks[0]).toMatchObject({ color: "#DFE5FB", mode: "fill" });
    expect(r.marks[1]).toMatchObject({ color: "#4263EB", mode: "stroke", dash: "dashed" });
  });
  it("never silently drops text, images, rotation or unknown records", () => {
    for (const problematic of [
      draw({ type: "text" }), draw({ type: "image" }), draw({ rot: 0.1 }),
      draw({ type: "mystery" }), draw({ inkOutline: undefined }),
    ]) {
      const r = compileQuickDrawScene(snapshot({ p: problematic }));
      expect(r.kind).toBe("unsupported");
      if (r.kind === "unsupported") expect(r.reasons).toHaveLength(1);
    }
  });
  it("rejects malformed JSON, pressure coordinates and unreasonable sizes", () => {
    expect(compileQuickDrawScene("{").kind).toBe("unsupported");
    expect(compileQuickDrawScene(snapshot({ x: draw({ inkOutline: [0, 0, 1] }) })).kind).toBe("unsupported");
    expect(compileQuickDrawScene(snapshot({ x: draw({ x: Number.NaN }) })).kind).toBe("unsupported");
    expect(compileQuickDrawScene(snapshot({ x: draw({ props: { pts: [1, 2] } }) })).kind).toBe("unsupported");
    expect(compileQuickDrawScene(snapshot({ x: draw({ z: Infinity }) })).kind).toBe("unsupported");
  });
  it("keeps authored ordering: highlight first, then z, then id", () => {
    const r = compileQuickDrawScene(snapshot({
      b: draw({ id: "b", z: 2 }),
      c: draw({ id: "c", z: 1 }),
      a: draw({ id: "a", z: 1 }),
    }));
    expect(r.kind).toBe("ready");
    if (r.kind === "ready") expect(r.marks.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
});
