import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { WhiteboardRenderer } from "../specs/WhiteboardRenderer.nitro";
import { createWhiteboardRendererBinding } from "./createWhiteboardRendererBinding";
import { resolveWhiteboardRendererFactory } from "../runtime/resolveWhiteboardRendererFactory";
import type { UseWhiteboardRendererOptions } from "./UseWhiteboardRendererOptions";
import type { WhiteboardRendererBinding } from "./WhiteboardRendererBinding";
import type { WhiteboardRendererStatus } from "./WhiteboardRendererStatus";

type StatusState = { status: WhiteboardRendererStatus };

/**
 * Creates a native whiteboard renderer for a Viro surface and keeps it in
 * step with a QuickDraw store: one coalesced diff per frame, overlay and
 * camera from the headless board, and a snapshot resync when the renderer
 * reports `lost` or rejects a call.
 *
 * Returns `{ kind: "unavailable" }` where no native renderer exists (iOS
 * today, Android below API 29, or a Viro build without the Surface
 * registry); render the application fallback then. The renderer is disposed on
 * unmount and whenever an option other than `onError` or `getInkOutline`
 * changes. Both callbacks are read through refs, so passing a new function
 * each render does not recreate the native renderer and its render thread;
 * outlines already computed for a record are kept until that record changes.
 *
 * @example
 * ```tsx
 * const status = useWhiteboardRenderer({
 *   store, board, surfaceId, widthPx: 2016, heightPx: 1260,
 *   pixelRatio: 2, cornerRadiusPx: 64, backgroundColor: "#FFFFFF",
 * })
 * if (status.kind === "unavailable") return <QuickDrawWebBoard />
 * ```
 */
export function useWhiteboardRenderer(options: UseWhiteboardRendererOptions): WhiteboardRendererStatus {
  const { store, board, surfaceId, widthPx, heightPx, pixelRatio, cornerRadiusPx, backgroundColor } = options;
  const statusStore = useRef<StoreApi<StatusState> | undefined>(undefined);
  if (statusStore.current === undefined) {
    statusStore.current = createStore<StatusState>(() => ({ status: { kind: "creating" } }));
  }
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const getInkOutlineRef = useRef(options.getInkOutline);
  getInkOutlineRef.current = options.getInkOutline;
  const status = useStore(statusStore.current, (s) => s.status);

  useEffect(() => {
    const target = statusStore.current;
    if (target === undefined) return undefined;
    const setStatus = (next: WhiteboardRendererStatus) => target.setState({ status: next });
    const factory = resolveWhiteboardRendererFactory();
    if (factory === undefined) {
      setStatus({ kind: "unavailable" });
      return undefined;
    }

    let isCancelled = false;
    let renderer: WhiteboardRenderer | undefined;
    let binding: WhiteboardRendererBinding | undefined;
    let stateSubscription: { remove: () => void } | undefined;
    setStatus({ kind: "creating" });

    factory
      .createRenderer({ surfaceId, widthPx, heightPx, pixelRatio, cornerRadiusPx, backgroundColor })
      .then(
        (created) => {
          if (isCancelled) {
            created.dispose();
            return;
          }
          renderer = created;
          stateSubscription = created.addOnStateChangedListener((state) => {
            setStatus({ kind: "ready", renderer: created, state });
          });
          binding = createWhiteboardRendererBinding({
            store,
            ...(board === undefined ? {} : { board }),
            renderer: created,
            getInkOutline: (shape) => getInkOutlineRef.current(shape),
            requestFrame: (callback) => requestAnimationFrame(callback),
            cancelFrame: (handle) => cancelAnimationFrame(handle),
            onError: (error) => onErrorRef.current?.(error),
          });
          setStatus({ kind: "ready", renderer: created, state: created.state });
        },
        (error: unknown) => {
          if (isCancelled) return;
          setStatus({ kind: "failed", error: error instanceof Error ? error : new Error(String(error)) });
        },
      );

    return () => {
      isCancelled = true;
      stateSubscription?.remove();
      binding?.dispose();
      renderer?.dispose();
    };
  }, [store, board, surfaceId, widthPx, heightPx, pixelRatio, cornerRadiusPx, backgroundColor]);

  return status;
}
