import { createStore, type StoreApi } from "zustand/vanilla";
import { createInkOutlineEncoder } from "@nitro-forge/board";
import type { ShapeRecord, Store } from "@quickdrawjs/core";
import { compileQuickDrawScene, type SceneResult } from "./scene";

/**
 * One source of truth: the caller's existing QuickDraw Store.
 * This is a derived, read-only Skia presentation bridge. Multiple native
 * canvas views can subscribe to the same derived store, but one owner
 * should create/dispose it per board document.
 */
export interface NativeBoardSceneState {
  readonly scene: SceneResult;
  readonly revision: number;
}
export interface NativeBoardSceneBridgeOptions {
  readonly source: Pick<Store, "getSnapshot" | "listen">;
  readonly getInkOutline: (shape: ShapeRecord) => number[] | undefined;
  /** Must schedule a callback before the next display frame. */
  readonly requestFrame: (callback: (timestampMs: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
}
export interface NativeBoardSceneBridge {
  readonly state: StoreApi<NativeBoardSceneState>;
  /** Synchronously present the most recent document once; safe for tests. */
  flush(): void;
  /** Detach the store listener and cancel any pending frame. Idempotent. */
  dispose(): void;
}
export function createNativeBoardSceneBridge(options: NativeBoardSceneBridgeOptions): NativeBoardSceneBridge {
  const encoder = createInkOutlineEncoder(options.getInkOutline);
  const capture = () => compileQuickDrawScene(encoder.encodeSnapshot(options.source.getSnapshot()));
  const state = createStore<NativeBoardSceneState>(() => ({
    scene: capture(), revision: 1,
  }));
  let disposed = false;
  let frame: number | undefined;

  const flush = () => {
    if (disposed) return;
    if (frame !== undefined) {
      options.cancelFrame(frame);
      frame = undefined;
    }
    // Compute only once per frame. Unsupported records are represented as a
    // fallback scene; the editor document itself is never mutated.
    state.setState((previous) => ({
      scene: capture(), revision: previous.revision + 1,
    }));
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = options.requestFrame(() => {
      frame = undefined;
      flush();
    });
  };
  const unsubscribe = options.source.listen(() => schedule());
  return {
    state,
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) options.cancelFrame(frame);
      frame = undefined;
      unsubscribe();
    },
  };
}
