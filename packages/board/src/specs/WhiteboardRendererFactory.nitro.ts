import { Android, type HybridObject } from "nitro-core";
import type { WhiteboardRenderer } from "./WhiteboardRenderer.nitro";
import type { WhiteboardRendererOptions } from "./WhiteboardRendererOptions";

export * from "#nitro/WhiteboardRendererFactory";

/**
 * Creates {@linkcode WhiteboardRenderer} instances. All members are static.
 *
 * Only Android has an implementation. On other platforms the class is not
 * registered, so reading it throws; check availability before use.
 *
 * @platform android
 */
@Android({
  language: "kotlin",
  implementation: { className: "HybridWhiteboardRendererFactory", package: ["whiteboard"] },
})
export declare class WhiteboardRendererFactory extends HybridObject {
  /**
   * Whether this device can run the native board renderer: Android 10 (API 29)
   * or later, for the `multiply` blend the highlighter needs, and a Viro build
   * that ships the public `CanvasSurfaces` registry.
   */
  static readonly isAvailable: boolean;

  /**
   * Creates a renderer subscribed to the Viro Surface for
   * {@linkcode WhiteboardRendererOptions.surfaceId}.
   *
   * Resolves once the renderer is subscribed, which may be before Viro
   * provides the Surface; the renderer then reports `waiting-for-surface` and
   * starts drawing when the Surface arrives.
   *
   * @throws Error (rejects) for invalid options or when
   * {@linkcode WhiteboardRendererFactory.isAvailable} is false.
   */
  static createRenderer(options: WhiteboardRendererOptions): Promise<WhiteboardRenderer>;
}
