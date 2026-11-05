import { describe, expect, it } from "vitest";
import { adjustFieldForAccessibility, displayHueDegrees } from "../src/fieldAccessibility";

const base = { h: 200, s: 0.4, v: 0.5, alpha: 1 };

describe("saturation/brightness field screen-reader actions", () => {
  it("steps brightness on increment and decrement, keeping hue, saturation and alpha", () => {
    expect(adjustFieldForAccessibility(base, "increment")).toEqual({ ...base, v: 0.55 });
    expect(adjustFieldForAccessibility(base, "decrement")).toEqual({ ...base, v: 0.45 });
  });
  it("clamps at both ends", () => {
    expect(adjustFieldForAccessibility({ ...base, v: 1 }, "increment")!.v).toBe(1);
    expect(adjustFieldForAccessibility({ ...base, v: 0.02 }, "decrement")!.v).toBe(0);
  });
  it("reaches 1 exactly after repeated increments", () => {
    let c = { ...base, v: 0 };
    for (let i = 0; i < 20; i++) c = adjustFieldForAccessibility(c, "increment")!;
    expect(c.v).toBe(1);
  });
  it("ignores other actions", () => {
    expect(adjustFieldForAccessibility(base, "activate")).toBeUndefined();
  });
});

describe("hue display", () => {
  it("never shows 360", () => {
    expect(displayHueDegrees(359.6)).toBe(0);
    expect(displayHueDegrees(359.4)).toBe(359);
    expect(displayHueDegrees(-10)).toBe(350);
  });
});
