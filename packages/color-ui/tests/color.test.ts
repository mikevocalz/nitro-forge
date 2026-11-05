// color-ui re-exports NYC-Tron's RGBA and HSV math. The round trips below pin
// the hex and HSV behavior Forge's color panels rely on.
import { describe, expect, it } from "vitest";
import * as tron from "@nyc-tron/ui/components/forge/color";
import {
  alphaPercent, assertRgba, hsvToRgb, parseHexColor, rgbToHsv, rgbaToHex,
} from "../src/color";

describe("color-ui consumes NYC-Tron RGBA math", () => {
  it("re-exports the NYC-Tron functions themselves", () => {
    expect(rgbaToHex).toBe(tron.rgbaToHex);
    expect(alphaPercent).toBe(tron.alphaPercent);
    expect(assertRgba).toBe(tron.assertRgba);
    expect(parseHexColor).toBe(tron.parseHexColor);
    expect(rgbToHsv).toBe(tron.rgbToHsv);
    expect(hsvToRgb).toBe(tron.hsvToRgb);
  });
});

describe("hex parsing against NYC-Tron formatting", () => {
  it("supports hexadecimal rgb/rgba short and long forms", () => {
    expect(parseHexColor("#F0A")).toEqual({ r: 255, g: 0, b: 170, alpha: 1 });
    expect(rgbaToHex(parseHexColor("#F0A"))).toBe("#FF00AAFF");
    expect(parseHexColor("f08c")).toEqual({ r: 255, g: 0, b: 136, alpha: 204 / 255 });
    expect(parseHexColor("#33669980").alpha).toBeCloseTo(128 / 255);
    expect(() => parseHexColor("#12345")).toThrow();
  });
  it("shows the same whole opacity percent after a hex round trip", () => {
    for (let percent = 0; percent <= 100; percent++) {
      const color = { r: 10, g: 20, b: 30, alpha: percent / 100 };
      const reparsed = parseHexColor(rgbaToHex(color));
      expect(alphaPercent(color.alpha)).toBe(percent);
      expect(alphaPercent(reparsed.alpha)).toBe(percent);
    }
  });
  it("stores the quantized byte, not the slider value, after parsing", () => {
    expect(rgbaToHex({ r: 0, g: 0, b: 0, alpha: 0.01 })).toBe("#00000003");
    expect(parseHexColor("#00000003").alpha).toBe(3 / 255);
  });
});

describe("HSV conversion", () => {
  it("round-trips standard RGB channels through HSV", () => {
    const colors = [
      { r: 255, g: 0, b: 0, alpha: 1 },
      { r: 0, g: 255, b: 0, alpha: 0.6 },
      { r: 0, g: 0, b: 255, alpha: 0.25 },
      { r: 30, g: 87, b: 210, alpha: 1 },
    ];
    for (const color of colors) expect(hsvToRgb(rgbToHsv(color))).toEqual(color);
  });
  it("retains chosen hue at zero saturation", () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128, alpha: 1 }, 217).h).toBe(217);
  });
  it("rejects invalid input", () => {
    expect(() => rgbToHsv({ r: -1, g: 0, b: 0, alpha: 1 })).toThrow();
    expect(() => hsvToRgb({ h: 0, s: 2, v: 1, alpha: 1 })).toThrow();
  });
});
