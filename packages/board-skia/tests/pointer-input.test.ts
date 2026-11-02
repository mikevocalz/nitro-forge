import { describe, expect, it } from "vitest";
import { createNativeBoardPointerRouter, type BoardPointerSample } from "../src/pointer-input";
const event = (id: number, x: number, y: number, pointerType = "pen", pressure?: number) =>
  ({ pointerId: id, pointerType, offsetX: x, offsetY: y, isPrimary: true, button: 0, pressure });

function create() {
  const out: BoardPointerSample[] = [];
  let time = 0;
  const router = createNativeBoardPointerRouter({
    surfaceWidth: 200, surfaceHeight: 100, boardWidth: 1000, boardHeight: 500,
    now: () => time++, onPointer: (sample) => out.push(sample),
  });
  return { out, router };
}
describe("native 2D pen/touch board coordinates", () => {
  it("maps native device position exactly once and preserves measured zero pressure", () => {
    const { out, router } = create();
    router.handle("down", event(2, 20, 20, "pen", 0));
    router.handle("move", event(2, 30, 40, "pen", 0.5));
    router.handle("up", event(2, 40, 50, "pen", 0.7));
    expect(out.map(s => s.phase)).toEqual(["begin", "move", "end"]);
    expect(out.map(s => [s.x, s.y])).toEqual([[100, 100], [150, 200], [200, 250]]);
    expect(out.map(s => s.pressure)).toEqual([0, 0.5, 0.7]);
    router.dispose();
  });
  it("clamps off-paper movement, cancels on unmount and never leaves a capture", () => {
    const { out, router } = create();
    router.handle("down", event(1, 40, 40));
    router.handle("move", event(1, 400, -100));
    router.dispose();
    router.dispose();
    expect(out.map(x => x.phase)).toEqual(["begin", "move", "cancel"]);
    expect(out[1]).toMatchObject({ x: 1000, y: 0 });
    expect(out[2]).toMatchObject({ x: 1000, y: 0 });
    router.handle("up", event(1, 10, 10));
    expect(out).toHaveLength(3);
  });
  it("rejects another palm while the pen is captured and remembers pen preference", () => {
    const { out, router } = create();
    router.handle("down", event(1, 0, 0, "pen"));
    router.handle("down", event(2, 10, 10, "touch"));
    router.handle("up", event(1, 5, 5, "pen"));
    router.handle("down", event(2, 10, 10, "touch"));
    expect(out.map(s => s.phase)).toEqual(["begin", "end"]);
    router.resetPenPreference();
    router.handle("down", event(2, 10, 10, "touch"));
    expect(out.at(-1)?.pointerType).toBe("touch");
    router.dispose();
  });
  it("rejects wrong pointer id, secondary mouse, nonprimary touch and malformed samples", () => {
    const { out, router } = create();
    router.handle("down", { ...event(1, 3, 3, "mouse"), button: 2 });
    router.handle("down", { ...event(1, 3, 3, "touch"), isPrimary: false });
    router.handle("down", event(1, NaN, 3));
    expect(out).toHaveLength(0);
    router.handle("down", event(1, 3, 3));
    router.handle("move", event(4, 4, 4));
    router.handle("up", event(1, 3, 3));
    expect(out.map(s => s.phase)).toEqual(["begin", "end"]);
    router.dispose();
  });
});
