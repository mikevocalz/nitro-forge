/**
 * Pure and renderer-independent native board contract.
 * The frame is a projection of the existing QuickDraw/Moyo document, NOT a
 * separate document. Records are ordered front-to-back exactly as supplied.
 */
export type BoardPoint = Readonly<{ x: number; y: number; pressure?: number }>;

export interface BoardStroke {
  readonly kind: "stroke";
  readonly id: string;
  readonly color: string;
  readonly baseWidth: number;
  readonly opacity?: number;
  readonly points: readonly BoardPoint[];
}

export interface BoardRect {
  readonly kind: "rect";
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly opacity?: number;
}

export interface BoardEllipse extends Omit<BoardRect, "kind"> {
  readonly kind: "ellipse";
}

export type BoardDrawable = BoardStroke | BoardRect | BoardEllipse;

export interface NativeBoardFrame {
  readonly width: number;
  readonly height: number;
  /** Document z-order, with last item on top. */
  readonly drawables: readonly BoardDrawable[];
}

export interface NativeBoardPointer {
  readonly phase: "down" | "move" | "up" | "cancel";
  readonly pointerId: number;
  readonly source: "touch" | "pen" | "controller";
  readonly x: number;
  readonly y: number;
  /** Native measured pressure only. Undefined means not reported. */
  readonly pressure?: number;
}

export {
  strokeToSegments,
  boardTransform,
  projectPointer,
  type BoardSegment,
  type BoardTransform,
} from "./geometry";
