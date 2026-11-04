/** Document-agnostic display color. Not a replacement for ICC/CMYK/spot colors. */
export interface RgbaColor {
  /** Integer red channel [0, 255]. */
  readonly r: number;
  /** Integer green channel [0, 255]. */
  readonly g: number;
  /** Integer blue channel [0, 255]. */
  readonly b: number;
  /** Floating alpha [0, 1]. */
  readonly alpha: number;
}
export interface HsvColor {
  /** Hue angle in degrees [0, 360), retained when saturation is zero by caller. */
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly alpha: number;
}

export function assertRgba(color: RgbaColor): void {
  for (const channel of [color.r, color.g, color.b]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError("RGB channels must be integer values 0..255");
    }
  }
  if (!Number.isFinite(color.alpha) || color.alpha < 0 || color.alpha > 1) {
    throw new RangeError("Alpha must be in [0, 1]");
  }
}

/**
 * Whole opacity percent shown in the UI for a stored alpha.
 *
 * `#RRGGBBAA` stores alpha as one byte (0..255), so a slider value of 0.01
 * is written as `03` and parses back as 3/255 (about 0.0118). The byte step
 * (0.39%) is finer than 1%, so every whole percent 0..100 survives a hex
 * round trip under this rounding. Callers that need the exact float must keep
 * it outside the hex string.
 */
export function alphaPercent(alpha: number): number {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError("Alpha must be in [0, 1]");
  }
  return Math.round(alpha * 100);
}

export function rgbaToHex(color: RgbaColor, includeAlpha = true): string {
  assertRgba(color);
  const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0").toUpperCase();
  const rgb = "#" + hex(color.r) + hex(color.g) + hex(color.b);
  return includeAlpha ? rgb + hex(color.alpha * 255) : rgb;
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
