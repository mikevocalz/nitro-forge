import {
  DocumentHandle,
  bytesToBase64,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";

/** Op names — mirrors docs/ENGINE_OPS.md § prism. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  resize: "resize",
  addRasterLayer: "addRasterLayer",
  addShape: "addShape",
  removeLayer: "removeLayer",
  moveLayer: "moveLayer",
  renameLayer: "renameLayer",
  setLayerOpacity: "setLayerOpacity",
  setLayerVisible: "setLayerVisible",
  drawPixels: "drawPixels",
  fillLayer: "fillLayer",
  applyFilter: "applyFilter",
  flatten: "flatten",
  getLayer: "getLayer",
} as const;

export type Rgba = [number, number, number, number];

export interface RectShape {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: Rgba;
}
export interface EllipseShape {
  kind: "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: Rgba;
}
export type Shape = RectShape | EllipseShape;

export type Filter =
  | { type: "grayscale" }
  | { type: "invert" }
  | { type: "brightness"; amount: number };

export class PrismDocument {
  private constructor(private doc: DocumentHandle) {}

  static async open(
    host: EngineHost,
    width = 1024,
    height = 1024,
  ): Promise<PrismDocument> {
    const doc = await DocumentHandle.open(host, "prism");
    await doc.apply(OPS.newDoc, { width, height });
    return new PrismDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<PrismDocument> {
    const doc = await DocumentHandle.open(host, "prism");
    await doc.restore(bytes);
    return new PrismDocument(doc);
  }

  get handle(): DocumentHandle {
    return this.doc;
  }
  private call<T>(op: string, payload?: unknown): Promise<CommandResult<T>> {
    return this.doc.apply<T>(op, payload);
  }

  resize(width: number, height: number) {
    return this.call(OPS.resize, { width, height });
  }
  addRasterLayer(name?: string) {
    return this.call<{ layer_id: number }>(OPS.addRasterLayer, { name });
  }
  addShape(shape: Shape, name?: string) {
    return this.call<{ layer_id: number }>(OPS.addShape, { shape, name });
  }
  removeLayer(id: number) {
    return this.call(OPS.removeLayer, { id });
  }
  moveLayer(id: number, to_index: number) {
    return this.call(OPS.moveLayer, { id, to_index });
  }
  renameLayer(id: number, name: string) {
    return this.call(OPS.renameLayer, { id, name });
  }
  setLayerOpacity(id: number, opacity: number) {
    return this.call(OPS.setLayerOpacity, { id, opacity });
  }
  setLayerVisible(id: number, visible: boolean) {
    return this.call(OPS.setLayerVisible, { id, visible });
  }
  /** Paint a w*h RGBA patch onto a raster layer at (x,y), src-over blended. */
  drawPixels(id: number, x: number, y: number, w: number, h: number, data: Uint8Array) {
    return this.call(OPS.drawPixels, { id, x, y, w, h, data_b64: bytesToBase64(data) });
  }
  fillLayer(id: number, color: Rgba) {
    return this.call(OPS.fillLayer, { id, color });
  }
  applyFilter(id: number, filter: Filter) {
    return this.call(OPS.applyFilter, { id, filter });
  }
  /** Composite all visible layers → premultiplied-free RGBA bytes. */
  flatten() {
    return this.call<{ pixels_b64: string; width: number; height: number }>(
      OPS.flatten,
    );
  }
  getLayer(id: number) {
    return this.call(OPS.getLayer, { id });
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
