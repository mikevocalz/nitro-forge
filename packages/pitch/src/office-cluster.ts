import type { AnimKind, PitchDocument } from "./index";

/**
 * Engine side of NYC-Tron's slide controls (Forge roster J-01 SlideFilmstrip,
 * J-02 SlideSorter, J-05 SlideCanvas, J-09 SlideAnimationPane). Like Tally's
 * `grid-cluster`, this file imports no React and no `@nyc-tron/*` package: it
 * returns plain data and callbacks whose names and shapes match the NYC-Tron
 * props, and the app passes them through.
 *
 * Callbacks exist only for operations the Rust Pitch engine has. NYC-Tron
 * draws a control only when its callback is supplied, so the operations in
 * {@link PITCH_DEFERRED_OPS} never appear as dead buttons. Every write goes
 * to the engine first and the binding is re-read afterwards; nothing is
 * applied optimistically, and an engine error rejects with its message.
 */

/**
 * Engine operations the slide controls can express but Pitch does not have.
 * Each is a DEFER: the matching NYC-Tron prop is left out. Adding the op to
 * `packages/pitch/rust` and `OPS` is what lifts the deferral.
 */
export const PITCH_DEFERRED_OPS = {
  /** J-01 sections in the filmstrip: Pitch slides carry no section. */
  setSlideSection: "J-01",
  /** J-05: the deck's coordinate space. Pitch stores none, so the adapter uses {@link PITCH_SLIDE_SIZE}. */
  setSlideSize: "J-05",
  /** J-05 bring forward / send backward: objects keep insertion order. */
  setObjectOrder: "J-05",
  /** J-05 text formatting on the canvas (font size, bold, italic, color after creation). */
  setTextStyle: "J-05",
  /** J-09 edit an animation's timing or effect in place (today: remove and add). */
  updateAnimation: "J-09",
  /** J-09 triggers (on click, with previous, after previous): Pitch animations have absolute start times only. */
  setAnimationTrigger: "J-09",
  /** J-09 emphasis and exit effects: `addAnimation` accepts fadeIn, slideInLeft and zoomIn only. */
  emphasisAndExitEffects: "J-09",
} as const;
export type PitchDeferredOp = keyof typeof PITCH_DEFERRED_OPS;

/** Coordinate space the adapter assumes for Pitch decks (Pitch stores none; see `setSlideSize`). */
export const PITCH_SLIDE_SIZE = { width: 960, height: 540 } as const;

/** Effects `addAnimation` accepts, with the names the animation pane shows. */
export const PITCH_ANIMATION_EFFECTS = [
  { kind: "fadeIn", category: "entrance", label: "Fade in" },
  { kind: "slideInLeft", category: "entrance", label: "Fly in from left" },
  { kind: "zoomIn", category: "entrance", label: "Zoom in" },
] as const satisfies readonly { kind: AnimKind; category: "entrance"; label: string }[];

type Rgba = readonly [number, number, number, number];

/** A slide object as NYC-Tron `SlideObject` takes it. Ids are the engine's numeric ids as strings. */
export interface PitchSlideObject {
  readonly id: string;
  readonly kind: "text" | "rect" | "image";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rotation: number;
  readonly text?: string;
  readonly fontSize?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly color?: Rgba;
  readonly fill?: Rgba;
  readonly src?: string;
  readonly opacity?: number;
}

/** A slide as NYC-Tron `SlideSummary` takes it. */
export interface PitchSlideSummary {
  readonly id: string;
  readonly objects: readonly PitchSlideObject[];
  readonly background?: Rgba;
}

/** An animation as NYC-Tron `SlideAnimation` takes it; `index` is the engine's list index. */
export interface PitchSlideAnimation {
  readonly index: number;
  readonly objectId: string;
  readonly kind: string;
  readonly startS: number;
  readonly durationS: number;
}

/** The deck read from `describe`. */
export interface PitchDeck {
  readonly title: string;
  readonly slides: readonly PitchSlideSummary[];
  /** Animations per slide id. */
  readonly animations: Readonly<Record<string, readonly PitchSlideAnimation[]>>;
}

export type PitchOfficeDocument = Pick<PitchDocument,
  "describe" | "addSlide" | "removeSlide" | "moveSlide" | "moveSlides" | "removeSlides" | "moveObject" | "resizeObject" | "rotateObject" |
  "setText" | "removeObject" | "addAnimation" | "removeAnimation" | "slideAt">;

interface RawObj {
  id: number; kind: string; x: number; y: number; w: number; h: number; rotation_deg: number;
  text?: { content: string; font_size: number; color: number[]; bold: boolean; italic: boolean };
  fill?: number[]; src?: string;
}
interface RawSlide { id: number; background: number[] | null; objects: RawObj[]; animations: { object_id: number; kind: string; start_s: number; duration_s: number }[] }
interface RawState { meta: { title: string }; slides: RawSlide[] }

const rgba = (c: unknown): Rgba | undefined =>
  Array.isArray(c) && c.length === 4 && c.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? [c[0], c[1], c[2], c[3]] : undefined;

function requireData<T>(response: { data?: T }, op: string): T {
  if (response.data === undefined || response.data === null) throw new Error(`Pitch ${op} returned no data`);
  return response.data;
}

/** Engine id for a NYC-Tron string id. */
export function pitchId(id: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(id)) throw new RangeError(`"${id}" is not a Pitch id`);
  const n = Number(id);
  if (!Number.isSafeInteger(n)) throw new RangeError(`"${id}" is not a Pitch id`);
  return n;
}

function toObject(o: RawObj): PitchSlideObject {
  const kind: PitchSlideObject["kind"] | undefined = o.kind === "text" || o.kind === "rect" || o.kind === "image" ? o.kind : undefined;
  if (!kind || ![o.x, o.y, o.w, o.h, o.rotation_deg].every(Number.isFinite)) throw new Error("Pitch returned a malformed object");
  const base: PitchSlideObject = { id: String(o.id), kind, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation_deg };
  if (kind === "text" && o.text) {
    const color = rgba(o.text.color);
    return { ...base, text: o.text.content, fontSize: o.text.font_size, bold: o.text.bold, italic: o.text.italic, ...(color ? { color } : {}) };
  }
  if (kind === "rect") { const fill = rgba(o.fill); return fill ? { ...base, fill } : base; }
  if (kind === "image" && typeof o.src === "string") return { ...base, src: o.src };
  return base;
}

/** Reads the whole deck through `describe`: slides, objects and animations, in engine order. */
export async function readPitchDeck(document: Pick<PitchDocument, "describe">): Promise<PitchDeck> {
  const state = requireData(await document.describe<RawState>(), "describe");
  if (!state || !Array.isArray(state.slides) || typeof state.meta?.title !== "string") throw new Error("Pitch returned an invalid deck");
  const animations: Record<string, PitchSlideAnimation[]> = {};
  const slides = state.slides.map(s => {
    if (!Number.isSafeInteger(s.id) || !Array.isArray(s.objects) || !Array.isArray(s.animations)) throw new Error("Pitch returned a malformed slide");
    animations[String(s.id)] = s.animations.map((a, index) => ({
      index, objectId: String(a.object_id), kind: a.kind, startS: a.start_s, durationS: a.duration_s,
    }));
    const background = rgba(s.background);
    return { id: String(s.id), objects: s.objects.map(toObject), ...(background ? { background } : {}) };
  });
  return { title: state.meta.title, slides, animations };
}

/** Single from/to moves (valid indexes at each step) that turn `before` into `after`. */
export function pitchMovePlan(before: readonly string[], after: readonly string[]): { from: number; to: number }[] {
  if (before.length !== after.length || new Set(before).size !== before.length || new Set(after).size !== after.length || !after.every(id => before.includes(id)))
    throw new RangeError("Slide orders must hold the same ids");
  const cur = [...before];
  const out: { from: number; to: number }[] = [];
  after.forEach((id, to) => {
    const from = cur.indexOf(id);
    if (from === to) return;
    cur.splice(from, 1);
    cur.splice(to, 0, id);
    out.push({ from, to });
  });
  return out;
}

/** `SlideFilmstrip` and `SlideSorter` props backed by Pitch. */
export interface PitchSlideListBinding {
  readonly slides: readonly PitchSlideSummary[];
  /** Filmstrip: one `moveSlide`. */
  readonly onMove: (id: string, toIndex: number) => Promise<void>;
  /** Sorter: the complete order as one atomic undo step. */
  readonly onReorder: (order: string[]) => Promise<void>;
  /** Appends a blank slide (Pitch appends; it has no insert-at). */
  readonly onAdd: () => Promise<void>;
  /** Filmstrip: one slide. Pitch refuses to remove the last slide. */
  readonly onRemove: (id: string) => Promise<void>;
  /** Sorter: several slides as one atomic undo step. */
  readonly onRemoveMany: (ids: string[]) => Promise<void>;
}

/** Reads the deck and returns slide-list props; each write re-reads and calls `onChanged`. */
export async function bindPitchSlideList(
  document: PitchOfficeDocument, onChanged: (next: PitchSlideListBinding) => void,
): Promise<PitchSlideListBinding> {
  const deck = await readPitchDeck(document);
  const order = deck.slides.map(s => s.id);
  const after = async (write: () => Promise<unknown>) => {
    await write();
    onChanged(await bindPitchSlideList(document, onChanged));
  };
  const indexOf = (id: string) => {
    const i = order.indexOf(id);
    if (i < 0) throw new RangeError(`Unknown slide "${id}"`);
    return i;
  };
  return {
    slides: deck.slides,
    onMove: (id, toIndex) => after(() => document.moveSlide(indexOf(id), toIndex)),
    onReorder: next => after(async () => {
      pitchMovePlan(order, next); // Validate the complete permutation before dispatch.
      await document.moveSlides(next.map(pitchId));
    }),
    onAdd: () => after(() => document.addSlide("blank")),
    onRemove: id => after(() => document.removeSlide(pitchId(id))),
    onRemoveMany: ids => after(async () => {
      if (new Set(ids).size >= order.length) throw new RangeError("A deck keeps at least one slide");
      if (new Set(ids).size !== ids.length) throw new RangeError("Duplicate slide id");
      ids.forEach(indexOf);
      await document.removeSlides(ids.map(pitchId));
    }),
  };
}

/** `SlideCanvas` callbacks for one slide, each one engine write. */
export interface PitchCanvasBinding {
  readonly slide: PitchSlideSummary;
  readonly size: typeof PITCH_SLIDE_SIZE;
  readonly onMoveObject: (id: string, x: number, y: number) => Promise<void>;
  readonly onResizeObject: (id: string, w: number, h: number) => Promise<void>;
  readonly onRotateObject: (id: string, degrees: number) => Promise<void>;
  readonly onSetText: (id: string, text: string) => Promise<void>;
  readonly onRemoveObject: (id: string) => Promise<void>;
}

/** Binds `SlideCanvas` to slide `slideId`. */
export async function bindPitchCanvas(
  document: PitchOfficeDocument, slideId: string, onChanged: (next: PitchCanvasBinding) => void,
): Promise<PitchCanvasBinding> {
  const deck = await readPitchDeck(document);
  const slide = deck.slides.find(s => s.id === slideId);
  if (!slide) throw new RangeError(`Unknown slide "${slideId}"`);
  const s = pitchId(slideId);
  const after = async (write: () => Promise<unknown>) => {
    await write();
    onChanged(await bindPitchCanvas(document, slideId, onChanged));
  };
  return {
    slide, size: PITCH_SLIDE_SIZE,
    onMoveObject: (id, x, y) => after(() => document.moveObject(s, pitchId(id), x, y)),
    onResizeObject: (id, w, h) => after(() => document.resizeObject(s, pitchId(id), w, h)),
    onRotateObject: (id, degrees) => after(() => document.rotateObject(s, pitchId(id), degrees)),
    onSetText: (id, text) => after(() => document.setText(s, pitchId(id), text)),
    onRemoveObject: id => after(() => document.removeObject(s, pitchId(id))),
  };
}

/** `SlideAnimationPane` props for one slide. */
export interface PitchAnimationBinding {
  readonly animations: readonly PitchSlideAnimation[];
  readonly effects: typeof PITCH_ANIMATION_EFFECTS;
  readonly onAdd: (a: { objectId: string; kind: string; startS: number; durationS: number }) => Promise<void>;
  readonly onRemove: (index: number) => Promise<void>;
}

const ANIM_KINDS = new Set<string>(PITCH_ANIMATION_EFFECTS.map(e => e.kind));

/** Binds `SlideAnimationPane` to slide `slideId`. Kinds outside {@link PITCH_ANIMATION_EFFECTS} are refused before the engine call. */
export async function bindPitchAnimations(
  document: PitchOfficeDocument, slideId: string, onChanged: (next: PitchAnimationBinding) => void,
): Promise<PitchAnimationBinding> {
  const deck = await readPitchDeck(document);
  const animations = deck.animations[slideId];
  if (!animations) throw new RangeError(`Unknown slide "${slideId}"`);
  const s = pitchId(slideId);
  const after = async (write: () => Promise<unknown>) => {
    await write();
    onChanged(await bindPitchAnimations(document, slideId, onChanged));
  };
  return {
    animations, effects: PITCH_ANIMATION_EFFECTS,
    onAdd: a => after(() => {
      if (!ANIM_KINDS.has(a.kind)) throw new RangeError(`Pitch cannot play "${a.kind}" (see PITCH_DEFERRED_OPS.emphasisAndExitEffects)`);
      return document.addAnimation(s, pitchId(a.objectId), a.kind as AnimKind, a.startS, a.durationS);
    }),
    onRemove: index => after(() => document.removeAnimation(s, index)),
  };
}

/**
 * The slide with each object's geometry and opacity at presentation time
 * `tS`, from `slideAt`, for the canvas's animation preview (J-05 + J-09).
 */
export async function readPitchSlideAt(document: PitchOfficeDocument, slideId: string, tS: number): Promise<PitchSlideSummary> {
  const deck = await readPitchDeck(document);
  const slide = deck.slides.find(s => s.id === slideId);
  if (!slide) throw new RangeError(`Unknown slide "${slideId}"`);
  const at = requireData(await document.slideAt(pitchId(slideId), tS), "slideAt");
  const byId = new Map(at.objects.map(o => [String(o.id), o]));
  return {
    ...slide,
    objects: slide.objects.map(o => {
      const r = byId.get(o.id);
      return r ? { ...o, x: r.x, y: r.y, w: r.w, h: r.h, rotation: r.rotation, opacity: r.opacity } : o;
    }),
  };
}
