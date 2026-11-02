import type { BoardStroke } from "./index";
import { strokeToSegments } from "./geometry";
import type { BoardMark, SceneResult } from "../skia/scene";

/**
 * Pure, QuickDraw-independent pressure ink converter. Drawing and annotation
 * engines provide their own ordered stroke records; output is a derived Skia
 * scene, never a competing document, persistence store or undo history.
 *
 * Each pressure segment becomes an independently variable-width stroke path.
 * For full vector-outline fidelity, an engine may supply a precomputed
 * outline via compileUniversalCanvasScene instead.
 */
export function compileNativeInkScene(strokes: readonly BoardStroke[]): SceneResult {
  if (!Array.isArray(strokes) || strokes.length > 50_000) {
    return { kind: "unsupported", reasons: ["invalid ink collection"] };
  }
  const MAX_POINTS = 200_000;
  let points = 0;
  const marks: BoardMark[] = [];
  for (const [i, stroke] of strokes.entries()) {
    if (!stroke || typeof stroke.id !== "string" || stroke.id.length < 1 ||
        stroke.id.length > 256 || typeof stroke.color !== "string" ||
        !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(stroke.color) ||
        !Array.isArray(stroke.points)) {
      return { kind: "unsupported", reasons: [`ink ${i}: invalid stroke`] };
    }
    points += stroke.points.length;
    if (points > MAX_POINTS) {
      return { kind: "unsupported", reasons: ["ink point budget exceeded"] };
    }
    const segments = strokeToSegments(stroke);
    if (segments.length === 0) {
      return { kind: "unsupported", reasons: [`ink ${i}: unsupported stroke geometry`] };
    }
    for (let j = 0; j < segments.length; j++) {
      const segment = segments[j]!;
      if (!Number.isFinite(segment.width) || segment.width <= 0 ||
          !Number.isFinite(segment.opacity)) {
        return { kind: "unsupported", reasons: [`ink ${i}: invalid segment paint`] };
      }
      // Skia round-caps turn a short or zero-length line into a round dot.
      const endX = segment.dot ? segment.x1 + 0.001 : segment.x2;
      const endY = segment.y2;
      marks.push({
        id: `${stroke.id}:${j}`,
        path: `M ${segment.x1} ${segment.y1} L ${endX} ${endY}`,
        color: segment.color,
        mode: "stroke",
        width: segment.width,
        alpha: segment.opacity,
        dash: "solid",
        blendMode: "srcOver",
      });
    }
  }
  return { kind: "ready", marks };
}
