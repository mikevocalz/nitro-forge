export type DragPoint = { x: number; y: number };
/** Shared gesture lifecycle: preview callbacks never commit and release is consumed once. */
export function createDragController(callbacks: {
  disabled: () => boolean;
  start: () => void; move: (point: DragPoint) => void;
  commit: () => void; cancel: () => void;
}) {
  let active = false;
  const cancel = () => { if (active) { active = false; callbacks.cancel(); } };
  return {
    begin() { cancel(); if (callbacks.disabled()) return; active = true; callbacks.start(); },
    move(point: DragPoint) { if (!active) return; if (callbacks.disabled()) cancel(); else callbacks.move(point); },
    release() { if (!active) return; active = false; if (callbacks.disabled()) callbacks.cancel(); else callbacks.commit(); },
    cancel,
  };
}
