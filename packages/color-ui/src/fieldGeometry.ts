import type { HsvColor } from "./color";

/** Hit-test coordinates for a 2D saturation (X) and value (Y) field. */
export interface FieldPoint {
  readonly x: number;
  readonly y: number;
}
export interface FieldSize {
  readonly width: number;
  readonly height: number;
}
export function assertHsv(value: HsvColor): void {
  if (![value.h, value.s, value.v, value.alpha].every(Number.isFinite) ||
      value.s < 0 || value.s > 1 || value.v < 0 || value.v > 1 ||
      value.alpha < 0 || value.alpha > 1) {
    throw new RangeError("Expected a finite HSV/alpha color in its valid range");
  }
}
/** Pure geometry. Preview and final commit use exactly the same mapping. */
export function pointToHsv(
  point: FieldPoint,
  size: FieldSize,
  current: HsvColor,
): HsvColor {
  assertHsv(current);
  if (![point.x, point.y, size.width, size.height].every(Number.isFinite) ||
      size.width <= 0 || size.height <= 0) {
    throw new RangeError("Color field dimensions/coordinates must be finite");
  }
  return {
    h: ((current.h % 360) + 360) % 360,
    s: Math.max(0, Math.min(1, point.x / size.width)),
    v: Math.max(0, Math.min(1, 1 - point.y / size.height)),
    alpha: current.alpha,
  };
}
export function hsvToPoint(color: HsvColor, size: FieldSize): FieldPoint {
  assertHsv(color);
  if (![size.width, size.height].every(Number.isFinite) ||
      size.width <= 0 || size.height <= 0) {
    throw new RangeError("Color field dimensions must be positive and finite");
  }
  return { x: size.width * color.s, y: size.height * (1 - color.v) };
}
