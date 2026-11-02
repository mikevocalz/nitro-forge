import { useStore } from "zustand";
import type { ReactElement } from "react";
import { NativeBoardCanvas, type NativeBoardCanvasProps } from "./NativeBoardCanvas";
import type { NativeBoardSceneBridge } from "./scene-store";

/**
 * Reads the coalesced Zustand scene. The full QuickDraw Store and undo remain
 * in the caller's board session; this view never authors document changes.
 */
export function ConnectedNativeBoardCanvas({
  bridge, ...props
}: Omit<NativeBoardCanvasProps, "scene"> & { readonly bridge: NativeBoardSceneBridge }): ReactElement {
  const scene = useStore(bridge.state, (value) => value.scene);
  return <NativeBoardCanvas {...props} scene={scene} />;
}
