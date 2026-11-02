import type { BoardMark, SceneResult } from "./skia/scene";

/**
 * Universal, versioned *presentation* input. It is not an editable document
 * or a QuickDraw record: PixForge, PDF annotation, and other authors can emit
 * the same deterministic vector paths without adopting QuickDraw persistence.
 */
export interface UniversalCanvasMark {
  readonly id: string;
  /** An SVG path supported by the Skia Path parser (no XML/HTML). */
  readonly path: string;
  readonly color: string;
  readonly mode: "fill" | "stroke";
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly dash?: "solid" | "dashed" | "dotted";
  readonly blend?: "srcOver" | "multiply";
  readonly rotation?: {
    readonly radians: number;
    readonly centerX: number;
    readonly centerY: number;
  };
}

export interface UniversalCanvasFrame {
  readonly schemaVersion: 1;
  readonly width: number;
  readonly height: number;
  /** Ordered back-to-front; editor/engine retains document & undo authority. */
  readonly elements: readonly UniversalCanvasMark[];
}

const MAX_MARKS = 50_000;
const MAX_PATH_LENGTH = 200_000;
const MAX_TOTAL_PATH_CHARS = 8 * 1024 * 1024;
const MAX_EXTENT = 1_000_000;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const within = (value: unknown, min: number, max: number): value is number =>
  finite(value) && value >= min && value <= max;
const color = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);
/** Restricted path tokens: commands, numeric arguments and separators only. */
const PATH_TOKENS = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;

/**
 * Prepare a draw-only scene for the existing Skia v3 / Viro canvas adapters.
 * Unknown or invalid items trigger the **entire scene fallback** instead of
 * silently omitting part of an authored document.
 */
export function compileUniversalCanvasScene(input: UniversalCanvasFrame): SceneResult {
  if (input?.schemaVersion !== 1 ||
      !within(input.width, 0.001, MAX_EXTENT) ||
      !within(input.height, 0.001, MAX_EXTENT) ||
      !Array.isArray(input.elements) || input.elements.length > MAX_MARKS) {
    return { kind: "unsupported", reasons: ["invalid universal frame or dimensions"] };
  }
  const ids = new Set<string>();
  const marks: BoardMark[] = [];
  let total = 0;
  for (let i = 0; i < input.elements.length; i++) {
    const m: UniversalCanvasMark = input.elements[i]!;
    if (typeof m !== "object" || m === null) {
      return { kind: "unsupported", reasons: [`element ${i}: not an object`] };
    }
    if (typeof m.id !== "string" || m.id.length === 0 || m.id.length > 256 ||
        ids.has(m.id)) {
      return { kind: "unsupported", reasons: [`element ${i}: invalid or duplicate id`] };
    }
    ids.add(m.id);
    if (typeof m.path !== "string" || !m.path.startsWith("M") ||
        m.path.length > MAX_PATH_LENGTH || !PATH_TOKENS.test(m.path)) {
      return { kind: "unsupported", reasons: [`element ${i}: invalid SVG path`] };
    }
    total += m.path.length;
    if (total > MAX_TOTAL_PATH_CHARS) {
      return { kind: "unsupported", reasons: ["universal scene exceeds path budget"] };
    }
    if (!color(m.color) || !["fill","stroke"].includes(m.mode) ||
        !within(m.opacity ?? 1, 0, 1) ||
        !within(m.strokeWidth ?? (m.mode === "fill" ? 0 : 1), 0, 10_000) ||
        !["solid","dashed","dotted"].includes(m.dash ?? "solid") ||
        !["srcOver","multiply"].includes(m.blend ?? "srcOver")) {
      return { kind: "unsupported", reasons: [`element ${i}: invalid paint`] };
    }
    if (m.rotation !== undefined &&
        (!within(m.rotation.radians, -Math.PI * 2, Math.PI * 2) ||
         !within(m.rotation.centerX, -MAX_EXTENT, MAX_EXTENT) ||
         !within(m.rotation.centerY, -MAX_EXTENT, MAX_EXTENT))) {
      return { kind: "unsupported", reasons: [`element ${i}: invalid rotation`] };
    }
    marks.push({
      id: m.id,
      path: m.path,
      color: m.color,
      mode: m.mode,
      width: m.strokeWidth ?? (m.mode === "fill" ? 0 : 1),
      alpha: m.opacity ?? 1,
      dash: m.dash ?? "solid",
      blendMode: m.blend ?? "srcOver",
      ...(m.rotation ? { rotation: { ...m.rotation } } : {}),
    });
  }
  return { kind: "ready", marks };
}
