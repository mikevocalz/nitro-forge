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
  setBackground: "setBackground",
  addText: "addText",
  setText: "setText",
  addRect: "addRect",
  addImage: "addImage",
  moveObject: "moveObject",
  resizeObject: "resizeObject",
  rotateObject: "rotateObject",
  removeObject: "removeObject",
  addAnimation: "addAnimation",
  removeAnimation: "removeAnimation",
  slideAt: "slideAt",
  deck: "deck",
} as const;

export type Rgba = [number, number, number, number];
export type Layout = "blank" | "title" | "titleBody";
export type AnimKind = "fadeIn" | "slideInLeft" | "zoomIn";

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
    const doc = await DocumentHandle.open(host, "pitch");
    await doc.apply(OPS.newDoc, { title });
    return new PitchDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<PitchDocument> {
    const doc = await DocumentHandle.open(host, "pitch");
    await doc.restore(bytes);
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
  addRect(slide: number, x: number, y: number, w: number, h: number, fill: Rgba) {
    return this.call<{ object_id: number }>(OPS.addRect, { slide, x, y, w, h, fill });
  }
  addImage(slide: number, x: number, y: number, w: number, h: number, src: string) {
    return this.call<{ object_id: number }>(OPS.addImage, { slide, x, y, w, h, src });
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
