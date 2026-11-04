/**
 * Native React Native PointerEvent -> QuickDraw board-coordinate adapter.
 *
 * Not a second editor. On 2D boards, the pointer event target's offsetX/Y
 * represents pixels in the surface (no Viro world transform). On XR, keep
 * using Viro's existing BoardInputRouter instead of feeding this adapter.
 */
export type BoardInputPhase = "begin" | "move" | "end" | "cancel";
export interface NativePointerLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pressure?: number;
  readonly button?: number;
  readonly isPrimary?: boolean;
}
export interface BoardPointerSample {
  readonly phase: BoardInputPhase;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly timestampMs: number;
}
export type PalmRejection = "off" | "during-pen" | "after-pen";
export interface NativeBoardPointerOptions {
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly onPointer: (sample: BoardPointerSample) => void;
  readonly now?: () => number;
  /**
   * After-pen prevents palm strokes until resetPenPreference(). Default.
   * In both rejection modes a pen down cancels an active touch stroke.
   */
  readonly palmRejection?: PalmRejection;
}
export interface NativeBoardPointerRouter {
  handle(phase: "down" | "move" | "up" | "cancel" | "leave", event: NativePointerLike): void;
  /** Cancel an active pointer on background, unmount or lost window focus. */
  cancelAll(): void;
  /** Allow touch drawing again after the last stylus interaction. */
  resetPenPreference(): void;
  dispose(): void;
}
import { boardTransform, projectPointer } from "../ink/geometry";

const isFinitePositive = (n: number) => Number.isFinite(n) && n > 0;

export function createNativeBoardPointerRouter(options: NativeBoardPointerOptions): NativeBoardPointerRouter {
  for (const length of [options.surfaceWidth, options.surfaceHeight, options.boardWidth, options.boardHeight]) {
    if (!isFinitePositive(length)) throw new RangeError("board sizes must be finite positive numbers");
  }
  const transform = boardTransform(
    options.boardWidth, options.boardHeight, options.surfaceWidth, options.surfaceHeight,
  );
  if (transform === null) throw new RangeError("Native canvas projection is not invertible");
  const now = options.now ?? (() => performance.now());
  const palmRejection = options.palmRejection ?? "after-pen";
  let lastTimestamp = -Infinity;
  let active: { id: number; type: string; x: number; y: number } | null = null;
  let penSeen = false;
  let disposed = false;

  const timestamp = () => {
    const current = now();
    const finite = Number.isFinite(current) ? current : lastTimestamp === -Infinity ? 0 : lastTimestamp;
    lastTimestamp = Math.max(lastTimestamp, finite);
    return lastTimestamp;
  };
  const send = (phase: BoardInputPhase, e: NativePointerLike, x: number, y: number) => {
    const pressure = e.pressure;
    const validPressure = typeof pressure === "number" && Number.isFinite(pressure) &&
      pressure >= 0 && pressure <= 1 ? pressure : undefined;
    options.onPointer({
      phase, pointerId: e.pointerId, pointerType: e.pointerType, x, y,
      ...(validPressure === undefined ? {} : { pressure: validPressure }),
      timestampMs: timestamp(),
    });
  };
  const coords = (e: NativePointerLike, clampOutside: boolean): readonly [number, number] | null =>
    projectPointer(
      e.offsetX, e.offsetY, options.boardWidth, options.boardHeight,
      transform, clampOutside,
    );
  const canStart = (e: NativePointerLike): boolean => {
    if (!Number.isSafeInteger(e.pointerId) || !["mouse", "pen", "touch"].includes(e.pointerType)) return false;
    if (e.pointerType === "mouse" && e.button !== undefined && e.button !== 0) return false;
    if (e.pointerType === "touch" && e.isPrimary === false) return false;
    if (e.pointerType === "touch" && ((palmRejection === "after-pen" && penSeen) ||
        (palmRejection === "during-pen" && active?.type === "pen"))) return false;
    return true;
  };
  const cancel = () => {
    if (active === null) return;
    const original = active;
    active = null;
    send("cancel", {
      pointerId: original.id, pointerType: original.type,
      offsetX: 0, offsetY: 0,
    }, original.x, original.y);
  };
  return {
    handle(phase, event) {
      if (disposed) return;
      if (phase === "down") {
        // With palm rejection on, a pen pre-empts a touch stroke that landed
        // first (usually the palm): the touch stroke is cancelled, not kept.
        const penPreempts = active !== null && active.type === "touch" &&
          event.pointerType === "pen" && palmRejection !== "off";
        if ((active !== null && !penPreempts) || !canStart(event)) return;
        const xy = coords(event, false);
        if (xy === null) return;
        if (penPreempts) cancel();
        if (event.pointerType === "pen") penSeen = true;
        active = { id: event.pointerId, type: event.pointerType, x: xy[0], y: xy[1] };
        send("begin", event, xy[0], xy[1]);
        return;
      }
      if (active === null || event.pointerId !== active.id) return;
      if (phase === "cancel" || phase === "leave") { cancel(); return; }
      const xy = coords(event, true);
      if (xy !== null) { active.x = xy[0]; active.y = xy[1]; }
      if (phase === "move") {
        if (xy !== null) send("move", event, active.x, active.y);
      } else {
        const terminal = active;
        active = null;
        send("end", event, terminal.x, terminal.y);
      }
    },
    cancelAll: cancel,
    resetPenPreference() {
      if (active?.type !== "pen") penSeen = false;
    },
    dispose() {
      if (disposed) return;
      // Must emit cancellation before marking disposed.
      cancel();
      disposed = true;
    },
  };
}
