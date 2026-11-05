import { describe, expect, it } from "vitest";
import { createSvgPathCache } from "../../src/skia/svg-path-cache";

describe("Skia SVG path cache", () => {
  it("parses each unchanged mark once and reparses only edited marks", () => {
    const parsed: string[] = [];
    const cache = createSvgPathCache((svg) => { parsed.push(svg); return { svg } as never; });
    const a = { id: "a", path: "M0 0L1 1" };
    const b = { id: "b", path: "M2 2L3 3" };
    const first = cache.resolve([a, b]);
    const second = cache.resolve([a, b]);
    expect(parsed).toEqual(["M0 0L1 1", "M2 2L3 3"]);
    expect(second).toEqual(first);
    expect(second![0]).toBe(first![0]);
    cache.resolve([a, { id: "b", path: "M2 2L4 4" }]);
    expect(parsed).toEqual(["M0 0L1 1", "M2 2L3 3", "M2 2L4 4"]);
  });
  it("drops removed marks and reports an unparseable path instead of skipping it", () => {
    const parsed: string[] = [];
    const cache = createSvgPathCache((svg) => { parsed.push(svg); return svg === "bad" ? null : ({ svg } as never); });
    cache.resolve([{ id: "a", path: "M0 0" }]);
    cache.resolve([]);
    cache.resolve([{ id: "a", path: "M0 0" }]);
    expect(parsed).toEqual(["M0 0", "M0 0"]);
    expect(cache.resolve([{ id: "a", path: "M0 0" }, { id: "x", path: "bad" }])).toBeNull();
  });
});
