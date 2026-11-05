import { describe, expect, it } from "vitest";
import { compileNativeInkScene } from "../../src/ink/scene";
import type { BoardStroke } from "../../src/ink";

const ink = (id = "stroke"): BoardStroke => ({
  kind: "stroke", id, color: "#4263EB", baseWidth: 8,
  opacity: 0.5, points: [
    { x: 1, y: 2, pressure: 0.25 },
    { x: 3, y: 4, pressure: 0.75 },
    { x: 8, y: 9, pressure: 1 },
  ],
});

describe("universal native pressure ink scenes", () => {
  it("keeps measured pressure and original per-segment width", () => {
    const result = compileNativeInkScene([ink()]);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.marks).toHaveLength(2);
    expect(result.marks.map(m => [m.width, m.alpha, m.path])).toEqual([
      [4,0.5,"M 1 2 L 3 4"],
      [7,0.5,"M 3 4 L 8 9"],
    ]);
  });

  it("preserves original stroke order and renders single-touch dots", () => {
    const dot: BoardStroke = {
      kind: "stroke",id:"dot",color:"#FF0000",baseWidth:4,
      points:[{x:100,y:50}],
    };
    const result = compileNativeInkScene([dot,ink("later")]);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.marks.map(m => m.id)).toEqual(["dot:0","later:0","later:1"]);
      expect(result.marks[0]!.path).toBe("M 100 50 L 100.001 50");
    }
  });

  it("does not silently omit malformed or unsupported strokes", () => {
    expect(compileNativeInkScene([{ ...ink(), baseWidth: -1 }]).kind)
      .toBe("unsupported");
    expect(compileNativeInkScene([{ ...ink(), color: "invalid" }]).kind)
      .toBe("unsupported");
    expect(compileNativeInkScene([{ ...ink(), points: [] }]).kind)
      .toBe("unsupported");
  });

  it("accepts an empty scene and does not alter source strokes", () => {
    const strokes = [ink()];
    const before = JSON.stringify(strokes);
    expect(compileNativeInkScene([])).toEqual({ kind: "ready",marks:[] });
    compileNativeInkScene(strokes);
    expect(JSON.stringify(strokes)).toBe(before);
  });
});
