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
  addSection: "addSection",
  updateSection: "updateSection",
  removeSection: "removeSection",
  addMaster: "addMaster",
  renameMaster: "renameMaster",
  setMasterBackground: "setMasterBackground",
  removeMaster: "removeMaster",
  addLayout: "addLayout",
  renameLayout: "renameLayout",
  removeLayout: "removeLayout",
  setSlideLayout: "setSlideLayout",
  addPlaceholder: "addPlaceholder",
  updatePlaceholder: "updatePlaceholder",
  removePlaceholder: "removePlaceholder",
  removeSlide: "removeSlide",
  moveSlide: "moveSlide",
  moveSlides: "moveSlides",
  removeSlides: "removeSlides",
  setBackground: "setBackground",
  setSlideSize: "setSlideSize",
  setNotes: "setNotes",
  slideNotes: "slideNotes",
  addInkStroke: "addInkStroke",
  updateInkStroke: "updateInkStroke",
  removeInkStroke: "removeInkStroke",
  clearInk: "clearInk",
  slideInk: "slideInk",
  setSlideTransition: "setSlideTransition",
  clearSlideTransition: "clearSlideTransition",
  slideTransition: "slideTransition",
  setSlideTiming: "setSlideTiming",
  clearSlideTiming: "clearSlideTiming",
  slideTiming: "slideTiming",
  addText: "addText",
  setText: "setText",
  setTextStyle: "setTextStyle",
  addRect: "addRect",
  addShape: "addShape",
  addConnector: "addConnector",
  updateConnector: "updateConnector",
  addMedia: "addMedia",
  updateMedia: "updateMedia",
  addImage: "addImage",
  moveObject: "moveObject",
  setObjectOrder: "setObjectOrder",
  resizeObject: "resizeObject",
  rotateObject: "rotateObject",
  removeObject: "removeObject",
  addAnimation: "addAnimation",
  addTriggeredAnimationV1: "addTriggeredAnimationV1",
  removeAnimation: "removeAnimation",
  updateAnimation: "updateAnimation",
  updateTriggeredAnimationV1: "updateTriggeredAnimationV1",
  slideAt: "slideAt",
  slideAtWithClicksV1: "slideAtWithClicksV1",
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
/** Stable boundary; follows start_slide_id on reorder. Removing that slide removes this boundary. */
export interface PitchSection { id: number; label: string; start_slide_id: number }
/**
 * Slide master/layout/placeholder definitions (P14 slice 8a). DATA ONLY:
 * the engine stores and validates these definitions plus the slide→layout
 * binding (`layout_id` on each slide in `describe`); it does NOT render
 * master content onto slides or resolve placeholders — apply/bind is a
 * later slice. Masters and layouts are flat deck-level collections; a
 * layout references its master via `master_id`.
 *
 * Bounds enforced by the engine: at most 64 masters, 256 layouts and 64
 * placeholders per layout; names/labels non-blank <=128 UTF-8 bytes;
 * placeholder x/y finite within ±1,000,000 and w/h finite >0 <=1,000,000.
 * Ids share the document id space. `removeMaster` cascade-removes its
 * layouts; `removeLayout`/`removeMaster` clear slide `layout_id` bindings
 * without touching slide content.
 */
export type PitchPlaceholderKind =
  | "title"
  | "body"
  | "image"
  | "media"
  | "date"
  | "footer"
  | "pageNumber";
/** Typed placeholder region on a layout (NYC-Tron `MasterPlaceholder` contract). */
export interface PitchPlaceholder {
  id: number;
  kind: PitchPlaceholderKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  inherit_theme?: boolean;
}
/** `addPlaceholder` payload; the engine assigns `id`. */
export type PitchPlaceholderInput = Omit<PitchPlaceholder, "id">;
/** Partial in-place placeholder edit; omitted fields preserve the region. */
export interface PitchPlaceholderPatch {
  kind?: PitchPlaceholderKind;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  label?: string;
  inherit_theme?: boolean;
}
export interface PitchMaster {
  id: number;
  name: string;
  background?: Rgba;
}
export interface PitchLayout {
  id: number;
  master_id: number;
  name: string;
  placeholders: PitchPlaceholder[];
}
export type Layout = "blank" | "title" | "titleBody";
/**
 * Bounded shape-preset catalog admitted by `addShape`. Every preset is
 * inscribed in the object's axis-aligned x/y/w/h bounds before rotation;
 * `line` and `arrow` are open shapes drawn from `stroke`. `"rect"` is the
 * same outline as `addRect`.
 */
export type PitchShapeKind =
  | "rect"
  | "roundedRect"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "line"
  | "arrow"
  | "star";
/** Optional stroke outline for shape objects; width is finite >0 and <=10,000 slide units. */
export interface PitchShapeStroke {
  width: number;
  color: Rgba;
}
/**
 * Connector endpoint. `free` is an absolute slide-space point (coordinates
 * finite within ±1,000,000). `bound` attaches to another object's bounds at
 * a named side; the engine resolves the current anchor point at read time,
 * so the endpoint follows that object through move/resize. Bound targets
 * must be non-connector objects on the same slide.
 */
export type PitchAnchorSide = "top" | "bottom" | "left" | "right" | "center";
export type PitchConnectorEnd =
  | { type: "free"; x: number; y: number }
  | { type: "bound"; object_id: number; side: PitchAnchorSide };
/** Routing catalog: `straight` is the endpoint segment; `elbow` is the H-V-H route through the mean x. */
export type PitchConnectorRoute = "straight" | "elbow";
/** Which ends carry an arrowhead. */
export type PitchConnectorArrows = "none" | "start" | "end" | "both";
/** Stored connector spec (the `connector` field of a connector object in `describe`). */
export interface PitchConnectorSpec {
  from: PitchConnectorEnd;
  to: PitchConnectorEnd;
  route: PitchConnectorRoute;
  arrows: PitchConnectorArrows;
  stroke?: PitchShapeStroke;
}
/** Partial in-place connector edit; `from`/`to` replace the whole endpoint, `stroke: null` clears it. */
export interface PitchConnectorUpdate {
  from?: PitchConnectorEnd;
  to?: PitchConnectorEnd;
  route?: PitchConnectorRoute;
  arrows?: PitchConnectorArrows;
  stroke?: PitchShapeStroke | null;
}
/**
 * Bounded media kind catalog mirroring the NYC-Tron SlideMedia contract
 * (`video`|`audio`); still images stay on `addImage`/`kind:"image"`.
 */
export type PitchMediaKind = "video" | "audio";
/** Bounded fit catalog mirroring NYC-Tron `SlideMediaSettings.fit`. */
export type PitchMediaFit = "contain" | "cover" | "stretch";
/**
 * Stored media spec (the `media` field of a `kind:"media"` object in
 * `describe`). METADATA ONLY: the engine never decodes, buffers, plays or
 * renders media — hosts own media pipelines and read this spec as data.
 * `src`/`poster` are host-resolved asset references (bounded non-empty
 * strings, the same reference model as image `src`), never embedded bytes.
 * Bounds enforced by the engine: `src`/`poster` 1..=4096 UTF-8 bytes,
 * `mime` 1..=128, trim points whole milliseconds 0..=86,400,000 with
 * `trim_in_ms <= trim_out_ms` when both present, `volume` finite 0..=1.
 */
export interface PitchMediaSpec {
  src: string;
  kind: PitchMediaKind;
  mime?: string;
  poster?: string;
  trim_in_ms?: number;
  trim_out_ms?: number;
  volume?: number;
  fit?: PitchMediaFit;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  show_controls?: boolean;
  hide_when_stopped?: boolean;
}
/**
 * `addMedia` payload: the spec fields are flattened next to the geometry.
 * `src` and `kind` are required; every other field is optional.
 */
export type PitchMediaInput = PitchMediaSpec;
/**
 * Partial in-place media edit mirroring `updateConnector`: omitted fields
 * preserve the spec, explicit `null` clears an optional field, and `src`/
 * `kind` replace the reference/kind (null is invalid for both). Equal or
 * empty patches are eventless no-ops that preserve redo.
 */
export interface PitchMediaUpdate {
  src?: string;
  kind?: PitchMediaKind;
  mime?: string | null;
  poster?: string | null;
  trim_in_ms?: number | null;
  trim_out_ms?: number | null;
  volume?: number | null;
  fit?: PitchMediaFit | null;
  autoplay?: boolean | null;
  loop?: boolean | null;
  muted?: boolean | null;
  show_controls?: boolean | null;
  hide_when_stopped?: boolean | null;
}
export type InkKind = "pen" | "highlighter" | "laser";
/**
 * Persistent annotation stroke. `points` are `[x, y]` pairs in slide-space
 * units (the same coordinate space as object x/y/w/h), not normalized.
 * Bounds enforced by the engine: 1..=2048 points per stroke, at most 256
 * strokes per slide, coordinates finite within ±1,000,000, width finite
 * >0 and <=10,000, color four RGBA channels 0..255, opacity 0..=1 or null.
 */
export interface PitchInkStroke {
  id: number;
  kind: InkKind;
  points: [number, number][];
  width: number;
  color: Rgba;
  /** Optional extra opacity multiplier; absent/null means opaque apart from the color alpha. */
  opacity?: number | null;
}
/** Stroke input for `addInkStroke`; the engine assigns `id`. */
export type PitchInkStrokeInput = Omit<PitchInkStroke, "id">;
/** Partial in-place ink edit; omitted fields preserve the stroke. `opacity: null` clears it. */
export interface PitchInkStrokePatch {
  kind?: InkKind;
  points?: [number, number][];
  width?: number;
  color?: Rgba;
  opacity?: number | null;
}
/**
 * Slide-to-slide transition descriptor stored per slide. This is DATA for the
 * host renderer: the engine stores and resolves it but never animates
 * transitions itself. `kind` is bounded to the catalog below; `"none"` in
 * `setSlideTransition` clears the transition. `duration_ms` is a whole
 * millisecond integer within 1..=60,000; `direction` is an optional hint
 * ("left"|"right"|"up"|"down"), meaningful for `wipe`.
 */
export type PitchTransitionKind =
  | "fade"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "wipe"
  | "zoom";
export type PitchTransitionDirection = "left" | "right" | "up" | "down";
export interface PitchSlideTransition {
  kind: PitchTransitionKind;
  duration_ms: number;
  direction?: PitchTransitionDirection;
}
/** Per-slide rehearsal/advance timing; `duration_ms` is 1..=3,600,000. */
export type PitchAdvanceMode = "manual" | "after";
export interface PitchSlideTiming {
  duration_ms: number;
  advance: PitchAdvanceMode;
}
export type AnimKind = "fadeIn" | "slideInLeft" | "zoomIn" | "pulse" | "spin" | "fadeOut" | "zoomOut";
export type PitchAnimationTrigger = {type:"absolute"}|{type:"on-click";click_index:number}|{type:"with-previous"}|{type:"after-previous"};
function ownAnimationTrigger(value:PitchAnimationTrigger):PitchAnimationTrigger {
 if(!value||typeof value!=='object')throw new TypeError('Animation trigger must be explicit');
 const keys=Object.keys(value);
 if(value.type==='on-click'){
  if(keys.length!==2||!keys.includes('type')||!keys.includes('click_index')||!Number.isInteger(value.click_index)||value.click_index<0||value.click_index>=256)throw new RangeError('Invalid click trigger');
  return {type:'on-click',click_index:value.click_index};
 }
 if(keys.length!==1||keys[0]!=='type'||!['absolute','with-previous','after-previous'].includes(value.type))throw new RangeError('Invalid animation trigger');
 return {type:value.type};
}
export interface PitchAnimationSchedule {index:number;start_s:number|null;end_s:number|null}

/** Partial in-place animation edit; omitted fields preserve the effect and timing. */
export interface PitchAnimationUpdate {
  trigger?: PitchAnimationTrigger;
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
    const doc = await DocumentHandle.openSnapshot(host, "pitch", bytes);
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
  addSection(label: string, startSlide: number) {
    return this.call<{ section_id: number }>(OPS.addSection, { label, start_slide: startSlide });
  }
  updateSection(id: number, patch: { label?: string; start_slide?: number }) {
    return this.call<{ ok: boolean }>(OPS.updateSection, { ...patch, id });
  }
  /** Removes only the boundary, retaining every slide. */
  removeSection(id: number) { return this.call<{ ok: boolean }>(OPS.removeSection, { id }); }
  /** Add a named slide master; optional RGBA `background` is stored data for the host. */
  addMaster(name: string, background?: Rgba | null) {
    return this.call<{ master_id: number }>(OPS.addMaster, {
      name,
      ...(background === undefined ? {} : { background }),
    });
  }
  renameMaster(id: number, name: string) {
    return this.call<{ ok: boolean }>(OPS.renameMaster, { id, name });
  }
  /** Set/clear (null) the master's stored background color. */
  setMasterBackground(id: number, color: Rgba | null) {
    return this.call<{ ok: boolean }>(OPS.setMasterBackground, { id, color });
  }
  /** Cascade-removes the master's layouts and clears slide layout bindings to them. */
  removeMaster(id: number) {
    return this.call<{ ok: boolean }>(OPS.removeMaster, { id });
  }
  addLayout(master: number, name: string) {
    return this.call<{ layout_id: number }>(OPS.addLayout, { master, name });
  }
  renameLayout(id: number, name: string) {
    return this.call<{ ok: boolean }>(OPS.renameLayout, { id, name });
  }
  /** Removes the layout and clears slide `layout_id` bindings to it; slide content is kept. */
  removeLayout(id: number) {
    return this.call<{ ok: boolean }>(OPS.removeLayout, { id });
  }
  /** Bind a slide to an existing layout; `null` clears the binding. Data only — no master content is applied. */
  setSlideLayout(slide: number, layout: number | null) {
    return this.call<{ ok: boolean }>(OPS.setSlideLayout, { slide, layout });
  }
  /** Add a typed placeholder region to a layout; returns the assigned `placeholder_id`. */
  addPlaceholder(layout: number, placeholder: PitchPlaceholderInput) {
    return this.call<{ placeholder_id: number }>(OPS.addPlaceholder, { layout, ...placeholder });
  }
  /** Partial placeholder patch; equal/empty patches are eventless no-ops. */
  updatePlaceholder(layout: number, id: number, patch: PitchPlaceholderPatch) {
    return this.call<{ ok: boolean }>(OPS.updatePlaceholder, { ...patch, layout, id });
  }
  removePlaceholder(layout: number, id: number) {
    return this.call<{ ok: boolean }>(OPS.removePlaceholder, { layout, id });
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
  /** Speaker notes: plain text up to 32768 UTF-8 bytes; "" clears. */
  setNotes(slide: number, text: string) {
    return this.call<{ ok: boolean }>(OPS.setNotes, { slide, text });
  }
  /** Read-only; `notes` is null when the slide has no speaker notes. */
  slideNotes(slide: number) {
    return this.call<{ notes: string | null }>(OPS.slideNotes, { slide });
  }
  /** Persistent ink stroke in slide-space coordinates; returns the assigned `stroke_id`. */
  addInkStroke(slide: number, stroke: PitchInkStrokeInput) {
    return this.call<{ stroke_id: number }>(OPS.addInkStroke, { slide, stroke });
  }
  /** Partial stroke patch; equal/empty patches are eventless no-ops. */
  updateInkStroke(slide: number, strokeId: number, patch: PitchInkStrokePatch) {
    return this.call<{ ok: boolean }>(OPS.updateInkStroke, { ...patch, slide, stroke_id: strokeId });
  }
  removeInkStroke(slide: number, strokeId: number) {
    return this.call<{ ok: boolean }>(OPS.removeInkStroke, { slide, stroke_id: strokeId });
  }
  /** Remove every ink stroke on the slide in one undoable step; empty is a no-op. */
  clearInk(slide: number) {
    return this.call<{ ok: boolean }>(OPS.clearInk, { slide });
  }
  /** Read-only; `strokes` is empty when the slide has no persistent ink. */
  slideInk(slide: number) {
    return this.call<{ strokes: PitchInkStroke[] }>(OPS.slideInk, { slide });
  }
  /**
   * Store slide-transition data for the host to animate; the engine does not
   * render transitions. `kind: "none"` clears (same as clearSlideTransition).
   * Equal patches are eventless no-ops.
   */
  setSlideTransition(slide: number, transition: PitchSlideTransition | { kind: "none" }) {
    return this.call<{ ok: boolean }>(OPS.setSlideTransition, { slide, ...transition });
  }
  /** Remove the slide's transition data; absent is an eventless no-op. */
  clearSlideTransition(slide: number) {
    return this.call<{ ok: boolean }>(OPS.clearSlideTransition, { slide });
  }
  /** Read-only; `transition` is null when the slide has no transition data. */
  slideTransition(slide: number) {
    return this.call<{ transition: PitchSlideTransition | null }>(OPS.slideTransition, { slide });
  }
  /** Per-slide rehearsal/advance timing; equal patches are eventless no-ops. */
  setSlideTiming(slide: number, timing: PitchSlideTiming) {
    return this.call<{ ok: boolean }>(OPS.setSlideTiming, { slide, ...timing });
  }
  /** Remove the slide's timing override; absent is an eventless no-op. */
  clearSlideTiming(slide: number) {
    return this.call<{ ok: boolean }>(OPS.clearSlideTiming, { slide });
  }
  /** Read-only; `timing` is null when the slide uses host-default timing. */
  slideTiming(slide: number) {
    return this.call<{ timing: PitchSlideTiming | null }>(OPS.slideTiming, { slide });
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
  /**
   * Add a bounded shape preset. `fill`/`stroke` are optional; omitted or null
   * means no fill/outline. `line` and `arrow` are open shapes rendered from
   * `stroke`. Returns the assigned `object_id`.
   */
  addShape(
    slide: number,
    kind: PitchShapeKind,
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: Rgba | null,
    stroke?: PitchShapeStroke | null,
  ) {
    return this.call<{ object_id: number }>(OPS.addShape, {
      slide, kind, x, y, w, h,
      ...(fill === undefined ? {} : { fill }),
      ...(stroke === undefined ? {} : { stroke }),
    });
  }
  /**
   * Add a connector between two endpoints. `route` defaults to `"straight"`,
   * `arrows` to `"none"`; `stroke` is an optional bounded outline. Returns the
   * assigned `object_id`. `describe` exposes the resolved polyline under the
   * object's `resolved` field.
   */
  addConnector(
    slide: number,
    from: PitchConnectorEnd,
    to: PitchConnectorEnd,
    options?: { route?: PitchConnectorRoute; arrows?: PitchConnectorArrows; stroke?: PitchShapeStroke | null },
  ) {
    return this.call<{ object_id: number }>(OPS.addConnector, {
      slide, from, to,
      ...(options?.route === undefined ? {} : { route: options.route }),
      ...(options?.arrows === undefined ? {} : { arrows: options.arrows }),
      ...(options?.stroke === undefined ? {} : { stroke: options.stroke }),
    });
  }
  /** Partial connector patch; equal/empty patches are eventless no-ops. */
  updateConnector(slide: number, id: number, patch: PitchConnectorUpdate) {
    return this.call<{ ok: boolean }>(OPS.updateConnector, { ...patch, slide, id });
  }
  /**
   * Add a media object: bounded METADATA ONLY (source reference, kind,
   * optional mime/poster/trim/volume/fit/playback flags). The engine never
   * decodes or plays media — hosts own media pipelines. Media has real
   * bounds, so move/resize/rotate apply (unlike connectors). `w`/`h` must
   * be > 0. Returns the assigned `object_id`.
   */
  addMedia(
    slide: number,
    x: number,
    y: number,
    w: number,
    h: number,
    spec: PitchMediaInput,
  ) {
    return this.call<{ object_id: number }>(OPS.addMedia, {
      slide, x, y, w, h, ...spec,
    });
  }
  /** Partial media spec patch; equal/empty patches are eventless no-ops. */
  updateMedia(slide: number, id: number, patch: PitchMediaUpdate) {
    return this.call<{ ok: boolean }>(OPS.updateMedia, { ...patch, slide, id });
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
  addAnimation(slide: number, object: number, kind: AnimKind, startS: number, durationS: number, trigger?: PitchAnimationTrigger) {
    return this.call<{ index: number }>(trigger === undefined ? OPS.addAnimation : OPS.addTriggeredAnimationV1, {
      slide, object, kind, start_s: startS, duration_s: durationS, ...(trigger === undefined ? {} : { trigger: ownAnimationTrigger(trigger) }),
    });
  }
  /** Retains target object and list index; equal/empty patches preserve history. */
  updateAnimation(slide: number, index: number, patch: PitchAnimationUpdate) {
    return this.call<{ ok: boolean }>(patch.trigger === undefined ? OPS.updateAnimation : OPS.updateTriggeredAnimationV1, { ...patch, ...(patch.trigger === undefined ? {} : { trigger: ownAnimationTrigger(patch.trigger) }), slide, index });
  }
  removeAnimation(slide: number, index: number) {
    return this.call(OPS.removeAnimation, { slide, index });
  }
  /** Resolve slide objects at presentation time t (animations applied). */
  slideAt(slide: number, tS: number, clickTimes?: readonly number[]) {
    if(clickTimes && (clickTimes.length>256||clickTimes.some((time,index)=>!Number.isFinite(time)||time<0||time>86400||(index>0&&time<clickTimes[index-1]!))))throw new RangeError("Click times must be a bounded ordered slide-relative history");
    return this.call<{ objects: AnimatedObject[]; schedule: PitchAnimationSchedule[] }>(clickTimes === undefined ? OPS.slideAt : OPS.slideAtWithClicksV1, {
      slide,
      t_s: tS,
      ...(clickTimes === undefined ? {} : { click_times: [...clickTimes] }),
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
