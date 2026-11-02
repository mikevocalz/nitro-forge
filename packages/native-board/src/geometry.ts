import type { BoardPoint, BoardStroke } from "./index";

export interface BoardSegment {
  readonly id: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width: number;
  readonly color: string;
  readonly opacity: number;
  readonly dot: boolean;
}
export interface BoardTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const finitePoint = (p: BoardPoint): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * A missing pressure reading uses the brush's full base width for display;
 * this is not a synthetic pressure value in the original sample or document.
 */
function displayPressure(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

/** Convert document strokes to variable-width native render segments. */
export function strokeToSegments(stroke: BoardStroke): BoardSegment[] {
  if (!Number.isFinite(stroke.baseWidth) || stroke.baseWidth <= 0) return [];
  if (!Array.isArray(stroke.points) || !stroke.points.every(finitePoint)) return [];
  if (stroke.points.length === 0) return [];
  const opacity = stroke.opacity === undefined || !Number.isFinite(stroke.opacity)
    ? 1 : clamp(stroke.opacity, 0, 1);
  const make = (a: BoardPoint, b: BoardPoint, dot: boolean): BoardSegment => ({
    id: stroke.id,
    x1: a.x, y1: a.y,
    x2: b.x, y2: b.y,
    width: stroke.baseWidth * (displayPressure(a.pressure) + displayPressure(b.pressure)) / 2,
    color: stroke.color,
    opacity,
    dot,
  });
  if (stroke.points.length === 1) return [make(stroke.points[0]!, stroke.points[0]!, true)];
  const result: BoardSegment[] = [];
  for (let i = 1; i < stroke.points.length; i++) {
    result.push(make(stroke.points[i - 1]!, stroke.points[i]!, false));
  }
  return result;
}

/**
 * Uniform board scale and centered offsets. Distortion through non-uniform
 * scaling is not acceptable for drawing: projection must be invertible.
 */
export function boardTransform(
  boardWidth: number,
  boardHeight: number,
  viewWidth: number,
  viewHeight: number,
): BoardTransform | null {
  if (![boardWidth, boardHeight, viewWidth, viewHeight].every(Number.isFinite) ||
      boardWidth <= 0 || boardHeight <= 0 || viewWidth <= 0 || viewHeight <= 0)
    return null;
  const scale = Math.min(viewWidth / boardWidth, viewHeight / boardHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return {
    scale,
    offsetX: (viewWidth - boardWidth * scale) / 2,
    offsetY: (viewHeight - boardHeight * scale) / 2,
  };
}

/**
 * View touch -> document space. Starts outside the paper are ignored;
 * active strokes may clamp to the paper when a pen leaves its bounds.
 */
export function projectPointer(
  viewX: number,
  viewY: number,
  boardWidth: number,
  boardHeight: number,
  transform: BoardTransform,
  clampOutside = false,
): readonly [number, number] | null {
  if (![viewX, viewY, boardWidth, boardHeight, transform.scale, transform.offsetX, transform.offsetY]
    .every(Number.isFinite) || transform.scale <= 0 || boardWidth <= 0 || boardHeight <= 0)
    return null;
  const x = (viewX - transform.offsetX) / transform.scale;
  const y = (viewY - transform.offsetY) / transform.scale;
  if (!clampOutside && (x < 0 || y < 0 || x > boardWidth || y > boardHeight)) return null;
  return [clamp(x, 0, boardWidth), clamp(y, 0, boardHeight)];
}
