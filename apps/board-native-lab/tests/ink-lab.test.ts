import { describe, expect, it } from "vitest";
import { createInkLabSession } from "../InkLabSession";
import type { BoardPointerSample } from "@nitro-forge/board/skia";
const event = (phase: BoardPointerSample["phase"], x: number, y: number, pressure?: number): BoardPointerSample => ({
  phase, pointerId: 5, pointerType: "pen", x, y, timestampMs: 100,
  ...(pressure === undefined ? {} : { pressure }),
});
describe("Android live ink lab / one temporary host document", () => {
  it("preserves measured pressure including zero, commits on up and supports undo/redo", () => {
    const lab = createInkLabSession();
    lab.onPointer(event("begin", 10, 10, 0));
    lab.onPointer(event("move", 20, 20, 0.5));
    lab.onPointer(event("end", 30, 30, 1));
    expect(lab.state.getState().strokes).toHaveLength(1);
    expect(lab.state.getState().strokes[0]?.points.map(p => p.pressure)).toEqual([0,0.5,1]);
    expect(lab.state.getState().draft).toBeNull();
    lab.undo();
    expect(lab.state.getState().strokes).toHaveLength(0);
    lab.redo();
    expect(lab.state.getState().strokes).toHaveLength(1);
    lab.dispose();
  });
  it("cancels incomplete stroke without committing it", () => {
    const lab = createInkLabSession();
    lab.onPointer(event("begin", 30, 30));
    lab.onPointer(event("move", 50, 50));
    expect(lab.state.getState().draft?.points).toHaveLength(2);
    lab.onPointer(event("cancel", 50, 50));
    expect(lab.state.getState().strokes).toHaveLength(0);
    expect(lab.state.getState().draft).toBeNull();
    expect(lab.state.getState().undoCount).toBe(0);
    lab.dispose();
  });
  it("highlights with transparent width and vector-eraser removes one stroke in one undo step", () => {
    const lab = createInkLabSession();
    lab.setTool("highlighter");
    lab.onPointer(event("begin", 100, 100));
    lab.onPointer(event("end", 120, 100));
    expect(lab.state.getState().strokes[0]).toMatchObject({baseWidth: 16, opacity: 0.4});
    lab.setTool("eraser");
    lab.onPointer(event("begin", 110, 100));
    lab.onPointer(event("end", 110, 100));
    expect(lab.state.getState().strokes).toHaveLength(0);
    lab.undo();
    expect(lab.state.getState().strokes).toHaveLength(1);
    lab.dispose();
  });
  it("does not commit an eraser drag canceled by Android focus loss", () => {
    const lab = createInkLabSession();
    lab.onPointer(event("begin", 10, 10));
    lab.onPointer(event("end", 50, 50));
    lab.setTool("eraser");
    lab.onPointer(event("begin", 20, 20));
    lab.onPointer(event("cancel", 20, 20));
    expect(lab.state.getState().strokes).toHaveLength(1);
    lab.dispose();
  });
});
