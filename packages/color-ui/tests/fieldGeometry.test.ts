import { describe, expect, it } from "vitest";
import { pointToHsv, hsvToPoint } from "../src/fieldGeometry";

describe("cross-platform saturation/value surface geometry", () => {
  const white = { h: 240, s: 0, v: 1, alpha: 1 };
  const size = { width: 300, height: 200 };
  it("maps corners and clamps gestures to the drawable field", () => {
    expect(pointToHsv({ x: 0, y: 0 }, size, white)).toEqual(white);
    expect(pointToHsv({ x: 300, y: 0 }, size, white))
      .toEqual({ h: 240, s: 1, v: 1, alpha: 1 });
    expect(pointToHsv({ x: 300, y: 200 }, size, white))
      .toEqual({ h: 240, s: 1, v: 0, alpha: 1 });
    expect(pointToHsv({ x: -50, y: 400 }, size, white))
      .toEqual({ h: 240, s: 0, v: 0, alpha: 1 });
  });
  it("round-trips normalized xy and preserves alpha", () => {
    const hsv = { h: 327, s: 0.35, v: 0.63, alpha: 0.4 };
    const point = hsvToPoint(hsv, size);
    const next = pointToHsv(point, size, hsv);
    expect(next.s).toBeCloseTo(hsv.s);
    expect(next.v).toBeCloseTo(hsv.v);
    expect(next.alpha).toBeCloseTo(0.4);
    expect(next.h).toBe(327);
  });
  it("rejects corrupt geometry", () => {
    expect(() => pointToHsv({ x: 0, y: NaN }, size, white)).toThrow();
    expect(() => pointToHsv({ x: 0, y: 0 }, {width:0,height:10}, white)).toThrow();
    expect(() => hsvToPoint({ ...white, s: 4 }, size)).toThrow();
  });
});
