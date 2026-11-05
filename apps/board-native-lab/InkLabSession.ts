import { createStore, type StoreApi } from "zustand/vanilla";
import type { BoardPointerSample } from "@nitro-forge/board/skia";
import type { BoardStroke, BoardPoint } from "@nitro-forge/board/ink";

export type InkLabTool = "pen" | "highlighter" | "eraser";
export interface InkLabState {
  readonly tool: InkLabTool;
  readonly strokes: readonly BoardStroke[];
  readonly draft: BoardStroke | null;
  readonly undoCount: number;
  readonly redoCount: number;
}
type Active = {
  pointerId: number;
  tool: InkLabTool;
  before: readonly BoardStroke[];
  draft: BoardStroke | null;
};

const distanceSquared = (x: number, y: number, a: BoardPoint, b: BoardPoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 0 ? 0 :
    Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return (x - px) * (x - px) + (y - py) * (y - py);
};
const hitStroke = (stroke: BoardStroke, x: number, y: number): boolean => {
  const p = stroke.points;
  if (!p.length) return false;
  const radius = Math.max(10, stroke.baseWidth / 2 + 6);
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i]!;
    const b = p[Math.min(i + 1, p.length - 1)]!;
    if (distanceSquared(x, y, a, b) <= radius * radius) return true;
  }
  return false;
};
const samplePoint = (sample: BoardPointerSample): BoardPoint => ({
  x: sample.x,
  y: sample.y,
  ...(sample.pressure === undefined ? {} : { pressure: sample.pressure }),
});

/**
 * Self-contained Android/iPad INK SMOKE LAB, not an SDK document authority.
 * Production consumers must use their existing QuickDraw/Yjs document and
 * must not instantiate a second document or duplicate Muse subscriptions.
 */
export function createInkLabSession(): {
  readonly state: StoreApi<InkLabState>;
  setTool(tool: InkLabTool): void;
  onPointer(sample: BoardPointerSample): void;
  undo(): void;
  redo(): void;
  clear(): void;
  dispose(): void;
} {
  const store = createStore<InkLabState>(() => ({
    tool: "pen", strokes: [], draft: null, undoCount: 0, redoCount: 0,
  }));
  let active: Active | null = null;
  let serial = 1;
  let disposed = false;
  const past: (readonly BoardStroke[])[] = [];
  const future: (readonly BoardStroke[])[] = [];
  const set = (changes: Partial<InkLabState>) => {
    if (!disposed) store.setState((prev) => ({
      ...prev, ...changes, undoCount: past.length, redoCount: future.length,
    }));
  };
  const commit = (before: readonly BoardStroke[], next: readonly BoardStroke[]) => {
    if (next !== before) {
      past.push(before);
      future.length = 0;
    }
    set({ strokes: next, draft: null });
  };
  const cancel = () => {
    if (active === null) return;
    set({ strokes: active.before, draft: null });
    active = null;
  };
  const eraseAt = (sample: BoardPointerSample) => {
    if (!active || active.tool !== "eraser") return;
    const before = store.getState().strokes;
    const next = before.filter((stroke) => !hitStroke(stroke, sample.x, sample.y));
    if (next.length !== before.length) set({ strokes: next });
  };
  return {
    state: store,
    setTool(tool) {
      if (disposed || !["pen","highlighter","eraser"].includes(tool)) return;
      cancel();
      set({ tool });
    },
    onPointer(sample) {
      if (disposed || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return;
      if (sample.phase === "begin") {
        if (active !== null) cancel();
        const tool = store.getState().tool;
        const before = store.getState().strokes;
        const point = samplePoint(sample);
        active = {
          pointerId: sample.pointerId, tool, before,
          draft: tool === "eraser" ? null : {
            kind: "stroke", id: "lab-ink-" + serial++,
            color: tool === "highlighter" ? "#F8B11B" : "#263344",
            baseWidth: tool === "highlighter" ? 16 : 4,
            opacity: tool === "highlighter" ? 0.4 : 1,
            points: [point],
          },
        };
        if (tool === "eraser") eraseAt(sample);
        else set({ draft: active.draft });
        return;
      }
      if (active === null || active.pointerId !== sample.pointerId) return;
      if (sample.phase === "cancel") { cancel(); return; }
      if (active.tool === "eraser") {
        eraseAt(sample);
        if (sample.phase === "end") {
          const next = store.getState().strokes;
          const before = active.before;
          active = null;
          commit(before, next.length === before.length ? before : next);
        }
        return;
      }
      if (active.draft === null) return;
      const last = active.draft.points.at(-1);
      const nextPoint = samplePoint(sample);
      const changed = last?.x !== nextPoint.x || last?.y !== nextPoint.y ||
        last?.pressure !== nextPoint.pressure;
      if (changed) {
        active.draft = {
          ...active.draft,
          points: [...active.draft.points, nextPoint],
        };
      }
      if (sample.phase === "end") {
        const before = active.before;
        const next = [...before, active.draft];
        active = null;
        commit(before, next);
      } else if (changed) {
        set({ draft: active.draft });
      }
    },
    undo() {
      if (disposed) return;
      cancel();
      const before = past.pop();
      if (before === undefined) return;
      future.push(store.getState().strokes);
      set({ strokes: before });
    },
    redo() {
      if (disposed) return;
      cancel();
      const next = future.pop();
      if (next === undefined) return;
      past.push(store.getState().strokes);
      set({ strokes: next });
    },
    clear() {
      if (disposed) return;
      cancel();
      const before = store.getState().strokes;
      if (before.length) commit(before, []);
    },
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
    },
  };
}
