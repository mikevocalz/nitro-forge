/**
 * Strict, portable QuickDraw 0.2.x snapshot -> native Skia scene compiler.
 * Does not mutate the document or read a WebView. Unknown records are NOT
 * silently dropped: all unsupported render kinds cause a caller fallback.
 */
export type PaintMode = "fill" | "stroke";
export type DashMode = "solid" | "dashed" | "dotted";
export interface BoardMark {
  readonly id: string;
  readonly path: string;
  readonly color: string;
  readonly mode: PaintMode;
  readonly width: number;
  readonly alpha: number;
  readonly dash: DashMode;
  readonly blendMode: "srcOver" | "multiply";
  /** Rotation about the same local-bounds pivot as QuickDraw's ShapeBounds. */
  readonly rotation?: { readonly radians: number; readonly centerX: number; readonly centerY: number };
}
export type SceneResult =
  | { readonly kind: "ready"; readonly marks: readonly BoardMark[] }
  | { readonly kind: "unsupported"; readonly reasons: readonly string[] };

const MAX_JSON_CHARS = 32 * 1024 * 1024;
const MAX_RECORDS = 50_000;
const MAX_COORDS = 200_000;
const MAX_EXTENT = 1_000_000;
const WIDTH: Readonly<Record<string, number>> = Object.freeze({
  s: 2.5, m: 4, l: 6.5, xl: 10,
});
// Exact QuickDraw light-theme stroke colors from Forge's Kotlin InkColor.kt.
const COLORS: Readonly<Record<string, string>> = Object.freeze({
  black: "#1D1D1D", grey: "#9FA8B2", "light-violet": "#E085F4",
  violet: "#AE3EC9", blue: "#4263EB", "light-blue": "#4DABF7",
  yellow: "#F1AC4B", orange: "#E16919", green: "#099268",
  "light-green": "#4CB05E", "light-red": "#F87777", red: "#E03131",
});
const FILLS: Readonly<Record<string, string>> = Object.freeze({
  black: "#E8E8E8", grey: "#ECEEF0", "light-violet": "#F9EBFC",
  violet: "#F0DCF5", blue: "#DFE5FB", "light-blue": "#E0F0FE",
  yellow: "#FCEFDC", orange: "#FAE5D5", green: "#D3EBE3",
  "light-green": "#DFF0E2", "light-red": "#FDE4E4", red: "#F9DCDC",
});
type JsonMap = Record<string, unknown>;
function map(value: unknown): JsonMap | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap : null;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function bounded(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= MAX_EXTENT;
}
function shapeId(record: JsonMap, key: string): string {
  return typeof record.id === "string" ? record.id : key;
}
function errorFor(id: string, problem: string): string {
  return id + ": " + problem;
}
function asPoints(value: unknown, stride: 2 | 3): number[] | null {
  if (!Array.isArray(value) || value.length === 0 ||
      value.length > MAX_COORDS || value.length % stride !== 0 ||
      !value.every(bounded)) return null;
  return value as number[];
}
function num(value: number): string {
  // Keep generated SVG compact and valid for Skia.Path.MakeFromSVGString.
  return String(value);
}
function pairsToPath(coords: readonly number[], closed: boolean): string {
  const out = ["M " + num(coords[0]!) + " " + num(coords[1]!)];
  for (let i = 2; i < coords.length; i += 2) {
    out.push("L " + num(coords[i]!) + " " + num(coords[i + 1]!));
  }
  if (closed) out.push("Z");
  else if (coords.length === 2) {
    // Degenerate one-point centerline must still be visible with round caps.
    out.push("L " + num(coords[0]! + 0.01) + " " + num(coords[1]!));
  }
  return out.join(" ");
}
function centerline(pts: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    out.push(pts[i]!, pts[i + 1]!);
  }
  return out;
}
function withOrigin(coords: readonly number[], x: number, y: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < coords.length; i += 2) {
    result.push(coords[i]! + x, coords[i + 1]! + y);
  }
  return result;
}
function ellipse(x: number, y: number, w: number, h: number): string {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  if (rx === 0 || ry === 0) return "M " + num(x) + " " + num(y);
  return [
    "M", num(cx + rx), num(cy), "A", num(rx), num(ry), "0 1 0",
    num(cx - rx), num(cy), "A", num(rx), num(ry), "0 1 0",
    num(cx + rx), num(cy), "Z",
  ].join(" ");
}
function polygonPoints(kind: string, w: number, h: number): number[] | null {
  switch (kind) {
    case "rectangle": return [0, 0, w, 0, w, h, 0, h];
    case "triangle": return [w / 2, 0, w, h, 0, h];
    case "diamond": return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2];
    case "hexagon": return [w * 0.25, 0, w * 0.75, 0, w, h / 2, w * 0.75, h, w * 0.25, h, 0, h / 2];
    case "star": {
      const out: number[] = [];
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? 1 : 0.45;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        out.push(w / 2 + Math.cos(a) * radius * w / 2, h / 2 + Math.sin(a) * radius * h / 2);
      }
      return out;
    }
    default: return null;
  }
}
function mark(id: string, path: string, color: string, mode: PaintMode, width: number,
              dash: DashMode = "solid", alpha = 1, blendMode: BoardMark["blendMode"] = "srcOver"): BoardMark {
  return { id, path, color, mode, width, dash, alpha, blendMode };
}
type Compiled = { marks: BoardMark[]; highlight: boolean; z: number; id: string };
function compileShape(record: JsonMap, key: string): Compiled | string {
  const id = shapeId(record, key);
  if (!bounded(record.x) || !bounded(record.y)) return errorFor(id, "invalid position");
  const x = record.x, y = record.y;
  const rot = record.rot ?? 0;
  const z = record.z ?? 0;
  if (!finite(rot) || !finite(z)) return errorFor(id, "invalid transform");
  // Exact pivot matches require the QuickDraw shape-bounds engine; never draw
  // an incorrectly positioned rotated shape as though it were unrotated.
  // Renderer adds Skia Group origin around QuickDraw local bounds, below.
  const props = map(record.props);
  if (props === null) return errorFor(id, "invalid props");
  const type = record.type;
  const colorName = typeof props.color === "string" ? props.color : "black";
  const strokeColor = COLORS[colorName];
  const strokeWidth = WIDTH[typeof props.size === "string" ? props.size : "m"];
  if (strokeColor === undefined || strokeWidth === undefined) return errorFor(id, "unknown palette or size");
  const marks: BoardMark[] = [];
  if (type === "draw" || type === "highlight") {
    const pts = asPoints(props.pts, 3);
    if (pts === null) return errorFor(id, "invalid pressure point triplets");
    const dash = typeof props.dash === "string" ? props.dash : "draw";
    if (type === "draw" && dash === "draw") {
      const outline = asPoints(record.inkOutline, 2);
      if (outline === null || outline.length < 6) return errorFor(id, "missing QuickDraw pressure inkOutline");
      marks.push(mark(id, pairsToPath(withOrigin(outline, x, y), true), strokeColor, "fill", 0));
    } else if (type === "highlight") {
      marks.push(mark(id, pairsToPath(withOrigin(centerline(pts), x, y), false),
        strokeColor, "stroke", strokeWidth * 4.5, "solid", 0.55, "multiply"));
    } else if (dash === "solid" || dash === "dashed" || dash === "dotted") {
      marks.push(mark(id, pairsToPath(withOrigin(centerline(pts), x, y), false),
        strokeColor, "stroke", strokeWidth, dash));
    } else {
      return errorFor(id, "unsupported draw dash");
    }
  } else if (type === "geo") {
    const w = props.w, h = props.h;
    if (!bounded(w) || !bounded(h) || w < 0 || h < 0) return errorFor(id, "invalid geo extent");
    if (typeof props.label === "string" && props.label.length > 0) return errorFor(id, "geo label needs text parity");
    const geoName = typeof props.geo === "string" ? props.geo : "rectangle";
    const path = geoName === "ellipse" ? ellipse(x, y, w, h) : (() => {
      const points = polygonPoints(geoName, w, h);
      return points === null ? null : pairsToPath(withOrigin(points, x, y), true);
    })();
    if (path === null) return errorFor(id, "unknown geometry");
    const fill = typeof props.fill === "string" ? props.fill : "none";
    if (fill === "solid") marks.push(mark(id + ":fill", path, FILLS[colorName]!, "fill", 0));
    else if (fill === "semi") marks.push(mark(id + ":fill", path, "#F9F7F1", "fill", 0, "solid", 0.85));
    else if (fill !== "none") return errorFor(id, "pattern fill needs native shader");
    const dash = typeof props.dash === "string" ? props.dash : "draw";
    if (!["draw", "solid", "dashed", "dotted"].includes(dash)) return errorFor(id, "invalid geo dash");
    marks.push(mark(id + ":border", path, strokeColor, "stroke", strokeWidth,
      dash === "draw" ? "solid" : dash as DashMode));
  } else {
    return errorFor(id, "unsupported record type " + String(type));
  }

  if (rot !== 0) {
    let bounds: { x: number; y: number; w: number; h: number };
    if (type === "geo") {
      const w = props.w as number;
      const h = props.h as number;
      bounds = { x: 0, y: 0, w: w === 0 ? 1 : w, h: h === 0 ? 1 : h };
    } else {
      const pts = props.pts as number[];
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        left = Math.min(left, pts[i]!);
        top = Math.min(top, pts[i + 1]!);
        right = Math.max(right, pts[i]!);
        bottom = Math.max(bottom, pts[i + 1]!);
      }
      // Exact Forge Kotlin ShapeBounds margin.
      const margin = type === "highlight" ? strokeWidth * 4.5 / 2 : strokeWidth * 0.75;
      bounds = { x: left - margin, y: top - margin,
        w: right - left + margin * 2, h: bottom - top + margin * 2 };
    }
    const rotation = {
      radians: rot,
      centerX: x + bounds.x + bounds.w / 2,
      centerY: y + bounds.y + bounds.h / 2,
    };
    for (let i = 0; i < marks.length; i++) {
      marks[i] = { ...marks[i]!, rotation };
    }
  }
  return { id, z, marks, highlight: type === "highlight" };
}
/**
 * Accepts the same augmented document snapshot sent to the existing Kotlin
 * renderer by createInkOutlineEncoder().encodeSnapshot(snapshot).
 *
 * All-or-nothing: if even one visible shape is unsupported, the native view
 * must use the passed fallback rather than silently dropping that record.
 */
export function compileQuickDrawScene(input: string | unknown): SceneResult {
  if (typeof input === "string" && input.length > MAX_JSON_CHARS) {
    return { kind: "unsupported", reasons: ["snapshot exceeds 32 MiB"] };
  }
  let doc: unknown = input;
  if (typeof input === "string") {
    try { doc = JSON.parse(input); }
    catch { return { kind: "unsupported", reasons: ["invalid snapshot JSON"] }; }
  }
  const root = map(doc), document = map(root?.document), records = map(document?.store);
  if (records === null) return { kind: "unsupported", reasons: ["missing document.store"] };
  const keys = Object.keys(records);
  if (keys.length > MAX_RECORDS) return { kind: "unsupported", reasons: ["too many board records"] };
  const good: Compiled[] = [];
  const errors: string[] = [];
  for (const key of keys) {
    const record = map(records[key]);
    if (record === null) { errors.push(errorFor(key, "invalid record")); continue; }
    // Assets aren't visible by themselves. A referenced image record is
    // unsupported until native image decoding/caching is implemented.
    if (record.typeName === "asset") continue;
    if (record.typeName !== "shape") {
      errors.push(errorFor(key, "unknown record type"));
      continue;
    }
    const compiled = compileShape(record, key);
    if (typeof compiled === "string") errors.push(compiled);
    else good.push(compiled);
  }
  if (errors.length > 0) return { kind: "unsupported", reasons: errors };
  good.sort((a, b) => Number(b.highlight) - Number(a.highlight) || a.z - b.z || a.id.localeCompare(b.id));
  return { kind: "ready", marks: good.flatMap((s) => s.marks) };
}
