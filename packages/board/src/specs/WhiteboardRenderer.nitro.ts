import { Android, type HybridObject } from "nitro-core";
import type { BoardCamera } from "./BoardCamera";
import type { ListenerSubscription } from "./ListenerSubscription";
import type { WhiteboardRendererFactory } from "./WhiteboardRendererFactory.nitro";
import type { WhiteboardRendererState } from "./WhiteboardRendererState";

export * from "#nitro/WhiteboardRenderer";

/**
 * Draws a QuickDraw document into one Viro-owned Surface.
 *
 * The renderer keeps its own copy of the document, built from
 * {@linkcode WhiteboardRenderer.loadSnapshot} and
 * {@linkcode WhiteboardRenderer.applyDiff}, and redraws only when the
 * document, camera, overlay or Surface changes. Losing the Surface never
 * loses the document.
 *
 * Wire format. Snapshots are QuickDraw `Store.getSnapshot()` JSON
 * (`{ document: { store: { [id]: record } } }`); diffs are QuickDraw diff
 * JSON (`{ added, updated, removed }`). The renderer reads `added` records,
 * the second element of each `updated` pair and the keys of `removed`, so
 * the first `updated` element and the `removed` values may be `null`. Every
 * `draw` record with dash `draw` must carry `inkOutline`: the flat
 * `[x, y, ...]` outline from `getInkOutline(record)`, so ink matches the web
 * board exactly. Image records are drawn from an asset record whose `src` is
 * a base64 `data:` URL (up to 8 MiB of text) or a `file://` URL or absolute
 * path to a regular file inside the app's cache or files directory. Other
 * sources, and images past the renderer's 96 MiB bitmap budget, draw
 * QuickDraw's placeholder.
 *
 * Size limits. A snapshot or diff may be up to 32 MiB of JSON and 50,000
 * records, an overlay up to 4 MiB; a `pts`, `inkOutline` or eraser trail up
 * to 200,000 numbers; a text, label or id up to 32,768 characters. Larger
 * input is rejected. Shape `w` and `h` are clamped to 1,000,000 board units.
 *
 * Created by {@linkcode WhiteboardRendererFactory.createRenderer}. Call the
 * inherited `dispose()` when done: it stops drawing, ends the Surface
 * subscription, stops the render thread and frees cached paths and bitmaps.
 * The Surface belongs to Viro and is not released. `dispose()` is idempotent;
 * every other method throws afterwards.
 *
 * @platform android
 */
@Android({
  language: "kotlin",
  implementation: { className: "HybridWhiteboardRenderer", package: ["whiteboard"] },
})
export declare class WhiteboardRenderer extends HybridObject {
  /** Current lifecycle state. Cheap to read. */
  readonly state: WhiteboardRendererState;

  /**
   * Replaces the whole document.
   *
   * @param revision Must be greater than every revision this renderer accepted before.
   * @param snapshotJson QuickDraw snapshot JSON; see the class docs for `inkOutline`.
   * @throws Error when the revision is not newer, the JSON is malformed or
   * over a size limit, or the renderer is disposed. The current document is
   * kept.
   */
  loadSnapshot(revision: number, snapshotJson: string): void;

  /**
   * Applies one (usually coalesced) QuickDraw diff.
   *
   * @param revision Must be greater than every revision this renderer accepted before.
   * @param diffJson QuickDraw diff JSON; see the class docs.
   * @throws Error when the revision is not newer, the JSON is malformed or
   * over a size limit, or the renderer is disposed. Nothing from the rejected
   * diff is applied.
   */
  applyDiff(revision: number, diffJson: string): void;

  /**
   * Sets the camera.
   * @throws Error unless every field is finite and `z > 0`.
   */
  setCamera(camera: BoardCamera): void;

  /**
   * Replaces the overlay: the JSON of the headless board's `getOverlay()`
   * (selection, marquees, laser trails, eraser trails, shapes pending erase).
   * Never part of the document.
   * @throws Error when the JSON is malformed or over a size limit. The
   * previous overlay is kept.
   */
  setOverlay(overlayJson: string): void;

  /**
   * Registers a listener for {@linkcode WhiteboardRenderer.state} changes.
   * Listeners run on the renderer's thread and are delivered to JS
   * asynchronously.
   */
  addOnStateChangedListener(listener: (state: WhiteboardRendererState) => void): ListenerSubscription;
}
