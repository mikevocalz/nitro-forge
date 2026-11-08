import {
  DocumentHandle,
  bytesToBase64,
  type CommandResult,
  type EngineHost,
} from "@nitro-forge/ignition";
import type { Rgba } from "./rgba";
import type {
  AlignEdge, AlignTarget, Artboard, BlendMode, BooleanOp, FillRule, LayerBounds, LayerTransform, NodeKind,
  Paint, PaintOrder, PathNode, PixelPreview, SampleSource, SelectionMode, SelectionShape, SelectionState,
  Stroke, Subpath,
} from "./canvas-types";

export type { Rgba } from "./rgba";
export * from "./canvas-types";

/** Op names — mirrors docs/ENGINE_OPS.md § prism. */
export const OPS = {
  newDoc: "new",
  describe: "describe",
  resize: "resize",
  addRasterLayer: "addRasterLayer",
  addShape: "addShape",
  setShapeFill: "setShapeFill",
  transformShape: "transformShape",
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
  setLayerTransform: "setLayerTransform",
  translateLayers: "translateLayers",
  setTransformOrigin: "setTransformOrigin",
  layerBounds: "layerBounds",
  hitTest: "hitTest",
  alignLayers: "alignLayers",
  distributeLayers: "distributeLayers",
  selectLayers: "selectLayers",
  selectRegion: "selectRegion",
  selectAll: "selectAll",
  deselect: "deselect",
  invertSelection: "invertSelection",
  magicWand: "magicWand",
  modifySelection: "modifySelection",
  getSelection: "getSelection",
  groupLayers: "groupLayers",
  ungroupLayer: "ungroupLayer",
  setLayerParent: "setLayerParent",
  setLayerLocked: "setLayerLocked",
  setLayerBlend: "setLayerBlend",
  setClipped: "setClipped",
  layerThumbnail: "layerThumbnail",
  renderRegion: "renderRegion",
  addMask: "addMask",
  removeMask: "removeMask",
  setMaskEnabled: "setMaskEnabled",
  invertMask: "invertMask",
  paintMask: "paintMask",
  refineMask: "refineMask",
  maskThumbnail: "maskThumbnail",
  addArtboard: "addArtboard",
  removeArtboard: "removeArtboard",
  updateArtboard: "updateArtboard",
  moveArtboard: "moveArtboard",
  artboardThumbnail: "artboardThumbnail",
  addPath: "addPath",
  setPathNodes: "setPathNodes",
  setPathNode: "setPathNode",
  insertPathNode: "insertPathNode",
  removePathNode: "removePathNode",
  setNodeKind: "setNodeKind",
  setSubpathClosed: "setSubpathClosed",
  setFill: "setFill",
  setStroke: "setStroke",
  setFillRule: "setFillRule",
  setPaintOrder: "setPaintOrder",
  convertToPath: "convertToPath",
  booleanLayers: "booleanLayers",
  setBooleanOp: "setBooleanOp",
  rasterizeLayer: "rasterizeLayer",
  floodFill: "floodFill",
  setColors: "setColors",
  swapColors: "swapColors",
  clearRecentColors: "clearRecentColors",
  getColors: "getColors",
} as const;

/** Document palette returned by `getColors` and included in `describe`. */
export interface PrismColors {
  foreground: Rgba;
  background: Rgba;
  /** Newest first, at most 16, deduplicated. */
  recent: Rgba[];
}

/** `changed` is false when the op matched the current palette and recorded nothing. */
export interface PrismColorChange {
  ok: true;
  changed: boolean;
}


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

/** Positive axis-aligned scaling about the shape top-left, followed by translation. */
export interface ShapeTransform { dx?: number; dy?: number; scaleX?: number; scaleY?: number }

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
    const doc = await DocumentHandle.openInitialized(host, "prism",
      (document) => document.apply(OPS.newDoc, { width, height }));
    return new PrismDocument(doc);
  }

  static async openSnapshot(
    host: EngineHost,
    bytes: Uint8Array,
  ): Promise<PrismDocument> {
    const doc = await DocumentHandle.openSnapshot(host, "prism", bytes);
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
  /** Change an existing shape fill without replacing its geometry or layer ID. */
  setShapeFill(id: number, color: Rgba) {
    return this.call(OPS.setShapeFill, { id, color });
  }
  /** One atomic Rust undo step; preserves identity, fill and other layer properties. */
  transformShape(id: number, { dx = 0, dy = 0, scaleX = 1, scaleY = 1 }: ShapeTransform) {
    return this.call(OPS.transformShape, { id, dx, dy, scale_x: scaleX, scale_y: scaleY });
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
  /** Commit foreground and/or background; one undo step. `remember` (default true) adds them to `recent`. */
  setColors(colors: { foreground?: Rgba; background?: Rgba; remember?: boolean }) {
    return this.call<PrismColorChange>(OPS.setColors, colors);
  }
  swapColors() {
    return this.call<PrismColorChange>(OPS.swapColors, {});
  }
  clearRecentColors() {
    return this.call<PrismColorChange>(OPS.clearRecentColors, {});
  }
  getColors() {
    return this.call<PrismColors>(OPS.getColors, {});
  }
  describe<T = unknown>() {
    return this.call<T>(OPS.describe);
  }

  // -- transform and object selection (B-05..B-08, B-25) --------------------
  /** Partial transform update; omitted fields keep their value. One undo step. */
  setLayerTransform(id: number, transform: Partial<Pick<LayerTransform, "tx" | "ty" | "sx" | "sy" | "rotation">>) {
    return this.call(OPS.setLayerTransform, { id, transform });
  }
  /** Move several layers by one canvas delta in one undo step. */
  translateLayers(ids: number[], dx: number, dy: number) {
    return this.call(OPS.translateLayers, { ids, dx, dy });
  }
  /** Move the pivot (content coordinates) without moving the layer. */
  setTransformOrigin(id: number, ox: number, oy: number) {
    return this.call(OPS.setTransformOrigin, { id, ox, oy });
  }
  /** Canvas-space bounds; all layers when `ids` is omitted. Read-only. */
  layerBounds(ids?: number[]) {
    return this.call<{ bounds: LayerBounds[] }>(OPS.layerBounds, ids ? { ids } : {});
  }
  /** Topmost painted layer at a canvas point. Read-only. */
  hitTest(x: number, y: number) {
    return this.call<{ layer_id: number | null; top_level_id: number | null }>(OPS.hitTest, { x, y });
  }
  alignLayers(ids: number[], align: AlignEdge, to: AlignTarget = "selection") {
    return this.call(OPS.alignLayers, { ids, align, to });
  }
  distributeLayers(ids: number[], axis: "horizontal" | "vertical", options: { mode?: "centers" | "spacing"; spacing?: number } = {}) {
    return this.call(OPS.distributeLayers, { ids, axis, ...options });
  }
  selectLayers(ids: number[], mode: "replace" | "add" | "remove" | "toggle" = "replace") {
    return this.call(OPS.selectLayers, { ids, mode });
  }

  // -- pixel selection (B-19, B-20) ------------------------------------------
  selectRegion(shape: SelectionShape, mode: SelectionMode = "replace", feather = 0) {
    return this.call(OPS.selectRegion, { shape, mode, feather });
  }
  selectAll() {
    return this.call(OPS.selectAll, {});
  }
  deselect() {
    return this.call(OPS.deselect, {});
  }
  invertSelection() {
    return this.call(OPS.invertSelection, {});
  }
  magicWand(options: { x: number; y: number; tolerance?: number; contiguous?: boolean; sample?: SampleSource; mode?: SelectionMode }) {
    return this.call(OPS.magicWand, options);
  }
  modifySelection(op: "grow" | "shrink" | "feather" | "smooth", radius: number) {
    return this.call(OPS.modifySelection, { op, radius });
  }
  getSelection() {
    return this.call<SelectionState>(OPS.getSelection, {});
  }

  // -- groups, lock, blend, clipping (B-09, B-11, B-13) -----------------------
  groupLayers(ids: number[], name?: string) {
    return this.call<{ layer_id: number }>(OPS.groupLayers, { ids, name });
  }
  ungroupLayer(id: number) {
    return this.call(OPS.ungroupLayer, { id });
  }
  setLayerParent(id: number, parent: number | null) {
    return this.call(OPS.setLayerParent, { id, parent });
  }
  setLayerLocked(id: number, locked: boolean) {
    return this.call(OPS.setLayerLocked, { id, locked });
  }
  setLayerBlend(id: number, blend: BlendMode) {
    return this.call(OPS.setLayerBlend, { id, blend });
  }
  setClipped(id: number, clipped: boolean) {
    return this.call(OPS.setClipped, { id, clipped });
  }

  // -- previews (B-10, B-14, B-27) --------------------------------------------
  layerThumbnail(id: number, max: number) {
    return this.call<PixelPreview>(OPS.layerThumbnail, { id, max });
  }
  renderRegion(x: number, y: number, w: number, h: number, max: number) {
    return this.call<PixelPreview>(OPS.renderRegion, { x, y, w, h, max });
  }

  // -- masks (B-12) -------------------------------------------------------------
  addMask(id: number, fill: "reveal" | "hide" | "selection" = "reveal") {
    return this.call(OPS.addMask, { id, fill });
  }
  removeMask(id: number, apply = false) {
    return this.call(OPS.removeMask, { id, apply });
  }
  setMaskEnabled(id: number, enabled: boolean) {
    return this.call(OPS.setMaskEnabled, { id, enabled });
  }
  invertMask(id: number) {
    return this.call(OPS.invertMask, { id });
  }
  /** Paint a `w*h` alpha patch into the mask. */
  paintMask(id: number, x: number, y: number, w: number, h: number, alpha: Uint8Array, mode: "replace" | "add" | "subtract" = "replace") {
    return this.call(OPS.paintMask, { id, x, y, w, h, data_b64: bytesToBase64(alpha), mode });
  }
  refineMask(id: number, feather: number, grow = 0) {
    return this.call(OPS.refineMask, { id, feather, grow });
  }
  maskThumbnail(id: number, max: number) {
    return this.call<PixelPreview>(OPS.maskThumbnail, { id, max });
  }

  // -- artboards (B-14) ---------------------------------------------------------
  addArtboard(rect: Omit<Artboard, "id" | "name">, name?: string) {
    return this.call<{ artboard_id: number }>(OPS.addArtboard, { ...rect, name });
  }
  removeArtboard(id: number) {
    return this.call(OPS.removeArtboard, { id });
  }
  updateArtboard(id: number, patch: Partial<Omit<Artboard, "id">>) {
    return this.call(OPS.updateArtboard, { id, ...patch });
  }
  moveArtboard(id: number, to_index: number) {
    return this.call(OPS.moveArtboard, { id, to_index });
  }
  artboardThumbnail(id: number, max: number) {
    return this.call<PixelPreview>(OPS.artboardThumbnail, { id, max });
  }

  // -- vector (B-21..B-24) --------------------------------------------------------
  addPath(subpaths: Subpath[], options: { fill?: Paint; stroke?: Stroke; fill_rule?: FillRule; name?: string } = {}) {
    return this.call<{ layer_id: number }>(OPS.addPath, { path: { subpaths }, ...options });
  }
  setPathNodes(id: number, subpaths: Subpath[]) {
    return this.call(OPS.setPathNodes, { id, subpaths });
  }
  setPathNode(id: number, subpath: number, index: number, node: PathNode) {
    return this.call(OPS.setPathNode, { id, subpath, index, node });
  }
  insertPathNode(id: number, subpath: number, index: number, node: PathNode) {
    return this.call(OPS.insertPathNode, { id, subpath, index, node });
  }
  removePathNode(id: number, subpath: number, index: number) {
    return this.call(OPS.removePathNode, { id, subpath, index });
  }
  setNodeKind(id: number, subpath: number, index: number, kind: NodeKind) {
    return this.call(OPS.setNodeKind, { id, subpath, index, kind });
  }
  setSubpathClosed(id: number, subpath: number, closed: boolean) {
    return this.call(OPS.setSubpathClosed, { id, subpath, closed });
  }
  /** `null` clears a path or boolean fill; shapes take solid paints only. */
  setFill(id: number, fill: Paint | null) {
    return this.call(OPS.setFill, { id, fill });
  }
  setStroke(id: number, stroke: Stroke | null) {
    return this.call(OPS.setStroke, { id, stroke });
  }
  setFillRule(id: number, rule: FillRule) {
    return this.call(OPS.setFillRule, { id, rule });
  }
  setPaintOrder(id: number, order: PaintOrder) {
    return this.call(OPS.setPaintOrder, { id, order });
  }
  convertToPath(id: number) {
    return this.call(OPS.convertToPath, { id });
  }
  /** Wrap sibling shapes/paths in an editable boolean container. */
  booleanLayers(ids: number[], op: BooleanOp, name?: string) {
    return this.call<{ layer_id: number }>(OPS.booleanLayers, { ids, op, name });
  }
  setBooleanOp(id: number, op: BooleanOp) {
    return this.call(OPS.setBooleanOp, { id, op });
  }
  rasterizeLayer(id: number) {
    return this.call(OPS.rasterizeLayer, { id });
  }

  // -- region fill (B-30) -----------------------------------------------------------
  /** Paint-bucket fill on a raster layer, inside the pixel selection when one exists. */
  floodFill(id: number, options: { x: number; y: number; color: Rgba; tolerance?: number; contiguous?: boolean; sample?: SampleSource }) {
    return this.call<{ ok: true; filled: number }>(OPS.floodFill, { id, ...options });
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
