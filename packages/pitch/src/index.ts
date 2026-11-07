import {
  DocumentHandle,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";

/** Op names — mirrors docs/ENGINE_OPS.md § pitch. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  addSlide: "addSlide",
  removeSlide: "removeSlide",
  moveSlide: "moveSlide",
  moveSlides: "moveSlides",
  removeSlides: "removeSlides",
  setBackground: "setBackground",
  setSlideSize: "setSlideSize",
  addText: "addText",
  setText: "setText",
  setTextStyle: "setTextStyle",
  addRect: "addRect",
  addImage: "addImage",
  moveObject: "moveObject",
  setObjectOrder: "setObjectOrder",
  resizeObject: "resizeObject",
  rotateObject: "rotateObject",
  removeObject: "removeObject",
  addAnimation: "addAnimation",
  removeAnimation: "removeAnimation",
  updateAnimation: "updateAnimation",
  slideAt: "slideAt",
  deck: "deck",
} as const;

export type Rgba = [number, number, number, number];
/** Omitted text attributes remain unchanged; null is invalid. RGBA channels are 0..255. */
export interface PitchTextStyle {
  font_size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: Rgba;
}
export type Layout = "blank" | "title" | "titleBody";
export type AnimKind = "fadeIn" | "slideInLeft" | "zoomIn";

/** Partial in-place animation edit; omitted fields preserve the effect and timing. */
export interface PitchAnimationUpdate {
  kind?: AnimKind;
  start_s?: number;
  duration_s?: number;
}

export interface AnimatedObject {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
}

export class PitchDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(host: EngineHost, title = "Untitled"): Promise<PitchDocument> {
    const doc = await DocumentHandle.openInitialized(host, "pitch",
      (document) => document.apply(OPS.newDoc, { title }));
    return new PitchDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<PitchDocument> {
    const doc = await DocumentHandle.openInitialized(host, "pitch",
      (document) => document.restore(bytes));
    return new PitchDocument(doc);
  }

  get handle(): DocumentHandle {
    return this.doc;
  }
  private call<T>(op: string, payload?: unknown): Promise<CommandResult<T>> {
    return this.doc.apply<T>(op, payload);
  }

  addSlide(layout: Layout = "blank") {
    return this.call<{ slide_id: number }>(OPS.addSlide, { layout });
  }
  removeSlide(id: number) {
    return this.call(OPS.removeSlide, { id });
  }
  moveSlide(from: number, to: number) {
    return this.call(OPS.moveSlide, { from, to });
  }
  /** Replace the complete slide order in one undoable transaction. */
  moveSlides(order: readonly number[]) {
    return this.call(OPS.moveSlides, { order });
  }
  /** Remove a unique set of slide IDs in one undoable transaction. */
  removeSlides(ids: readonly number[]) {
    return this.call(OPS.removeSlides, { ids });
  }
  /** Deck coordinates only; does not resize objects or the application window. */
  setSlideSize(width: number, height: number) {
    return this.call<{ ok: boolean }>(OPS.setSlideSize, { width, height });
  }
  setBackground(slide: number, color: Rgba | null) {
    return this.call(OPS.setBackground, { slide, color });
  }
  addText(slide: number, x: number, y: number, w: number, h: number, text: string, fontSize?: number) {
    return this.call<{ object_id: number }>(OPS.addText, {
      slide, x, y, w, h, text, font_size: fontSize,
    });
  }
  setText(slide: number, id: number, text: string) {
    return this.call(OPS.setText, { slide, id, text });
  }
  /** Apply a partial text style in one history entry; equal/empty patches are no-ops. */
  setTextStyle(slide: number, id: number, style: PitchTextStyle) {
    return this.call<{ ok: boolean }>(OPS.setTextStyle, { ...style, slide, id });
  }
  addRect(slide: number, x: number, y: number, w: number, h: number, fill: Rgba) {
    return this.call<{ object_id: number }>(OPS.addRect, { slide, x, y, w, h, fill });
  }
  addImage(slide: number, x: number, y: number, w: number, h: number, src: string) {
    return this.call<{ object_id: number }>(OPS.addImage, { slide, x, y, w, h, src });
  }
  /** Absolute bottom-to-top object index; object and animation identities are unchanged. */
  setObjectOrder(slide: number, id: number, to: number) {
    return this.call(OPS.setObjectOrder, { slide, id, to });
  }
  moveObject(slide: number, id: number, x: number, y: number) {
    return this.call(OPS.moveObject, { slide, id, x, y });
  }
  resizeObject(slide: number, id: number, w: number, h: number) {
    return this.call(OPS.resizeObject, { slide, id, w, h });
  }
  rotateObject(slide: number, id: number, degrees: number) {
    return this.call(OPS.rotateObject, { slide, id, degrees });
  }
  removeObject(slide: number, id: number) {
    return this.call(OPS.removeObject, { slide, id });
  }
  addAnimation(slide: number, object: number, kind: AnimKind, startS: number, durationS: number) {
    return this.call<{ index: number }>(OPS.addAnimation, {
      slide, object, kind, start_s: startS, duration_s: durationS,
    });
  }
  /** Retains target object and list index; equal/empty patches preserve history. */
  updateAnimation(slide: number, index: number, patch: PitchAnimationUpdate) {
    return this.call<{ ok: boolean }>(OPS.updateAnimation, { ...patch, slide, index });
  }
  removeAnimation(slide: number, index: number) {
    return this.call(OPS.removeAnimation, { slide, index });
  }
  /** Resolve slide objects at presentation time t (animations applied). */
  slideAt(slide: number, tS: number) {
    return this.call<{ objects: AnimatedObject[] }>(OPS.slideAt, {
      slide,
      t_s: tS,
    });
  }
  deck() {
    return this.call<{ title: string; slide_count: number }>(OPS.deck);
  }
  describe<T = unknown>() {
    return this.call<T>(OPS.describe);
  }

  save() {
    return this.doc.snapshot();
  }
  undo() {
    return this.doc.undo();
  }
  redo() {
    return this.doc.redo();
  }
  close() {
    return this.doc.close();
  }
}
