import { describe, expect, it } from "vitest";
import type { HsvColor } from "../src/color";
import { createFieldGesture } from "../src/fieldGesture";

function setup(width: number, height: number) {
  let value: HsvColor = { h: 200, s: 0.2, v: 0.8, alpha: 1 };
  const changes: HsvColor[] = [];
  const size = { width, height };
  const gesture = createFieldGesture({
    getSize: () => size,
    getValue: () => value,
    getDisabled: () => false,
    onChange: (next) => { value = next; changes.push(next); },
  });
  return { gesture, changes, size, get value() { return value; } };
}

describe("saturation/value field gesture", () => {
  it("ignores touches before the field has been measured", () => {
    const t = setup(0, 0);
    expect(t.gesture.shouldStart()).toBe(false);
    expect(() => t.gesture.grant({ x: 10, y: 10 })).not.toThrow();
    expect(() => t.gesture.move({ x: 20, y: 20 })).not.toThrow();
    expect(t.changes).toEqual([]);
  });
  it("keeps the responder for the whole drag", () => {
    const t = setup(200, 100);
    expect(t.gesture.shouldStart()).toBe(true);
    t.gesture.grant({ x: 100, y: 50 });
    expect(t.gesture.terminationRequest()).toBe(false);
    t.gesture.release();
    expect(t.gesture.terminationRequest()).toBe(true);
  });
  it("restores the start color only on a forced platform cancel", () => {
    const t = setup(200, 100);
    t.gesture.grant({ x: 100, y: 50 });
    t.gesture.move({ x: 200, y: 0 });
    expect(t.value).toMatchObject({ s: 1, v: 1 });
    t.gesture.terminate();
    expect(t.value).toEqual({ h: 200, s: 0.2, v: 0.8, alpha: 1 });
  });
  it("leaves the last color in place after a normal release", () => {
    const t = setup(200, 100);
    t.gesture.grant({ x: 0, y: 100 });
    t.gesture.release();
    t.gesture.terminate();
    expect(t.value).toMatchObject({ s: 0, v: 0 });
  });
});
