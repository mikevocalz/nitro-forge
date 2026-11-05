/**
 * RgbaColor, assertRgba, rgbaToHex and alphaPercent are owned by NYC-Tron UI
 * (@nyc-tron/ui/components/forge/color). The HSV model, parseHexColor,
 * rgbToHsv and hsvToRgb stay here until NYC-Tron-UI PR #21 ships them in
 * v0.1.0-alpha.2; then delete this file's local code and re-export.
 */
import { assertRgba, type RgbaColor } from "@nyc-tron/ui/components/forge/color";

export { alphaPercent, assertRgba, rgbaToHex } from "@nyc-tron/ui/components/forge/color";
export type { RgbaColor } from "@nyc-tron/ui/components/forge/color";

export interface HsvColor {
  /** Hue angle in degrees [0, 360), retained when saturation is zero by caller. */
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly alpha: number;
}

export function parseHexColor(value: string): RgbaColor {
  const candidate = value.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(candidate)) {
    throw new RangeError("Expected #RGB, #RGBA, #RRGGBB or #RRGGBBAA");
  }
  const hex = candidate.length <= 4
    ? [...candidate].map((c) => c + c).join("")
    : candidate;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

export function rgbToHsv(color: RgbaColor, retainedHue = 0): HsvColor {
  assertRgba(color);
  if (!Number.isFinite(retainedHue)) throw new RangeError("Hue must be finite");
  const r = color.r / 255, g = color.g / 255, b = color.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = ((retainedHue % 360) + 360) % 360;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max, alpha: color.alpha };
}

export function hsvToRgb(color: HsvColor): RgbaColor {
  const { h, s, v, alpha } = color;
  if (![h, s, v, alpha].every(Number.isFinite) || s < 0 || s > 1 ||
      v < 0 || v > 1 || alpha < 0 || alpha > 1) {
    throw new RangeError("Invalid HSV color channels");
  }
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
    alpha,
  };
}
