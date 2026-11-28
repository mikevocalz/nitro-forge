/**
 * Settings and request builders for {@linkcode MagicSelectionControls} and
 * {@linkcode MagicWandCanvas}. Requests map 1:1 onto the editor's `magicWand`
 * and `modifySelection` operations; values are in document pixels.
 */
import {MAX_SELECTION_RADIUS,clampRadius,type SelectionMode} from "./selection-model.ts";

/** Largest wand tolerance; the engine compares channel differences 0..255. */
export const MAX_TOLERANCE=255;

/** Which pixels the wand compares: everything visible, or one layer. */
export type WandSample="composite"|"layer";
/** The engine's sample field: `"composite"` or `{layer:id}`. */
export type WandSampleRequest="composite"|{readonly layer:string|number};

/** The wand settings the host keeps and the controls edit. */
export interface MagicWandSettings {
  /** 0..{@linkcode MAX_TOLERANCE}. */
  readonly tolerance:number;
  /** Only pixels connected to the clicked one, or every matching pixel. */
  readonly contiguous:boolean;
  readonly sample:WandSample;
}

/** One wand click, sent through `MagicWandCanvasProps.onMagicWand`. Same fields as `magicWand`. */
export interface MagicWandRequest {
  readonly x:number;
  readonly y:number;
  readonly tolerance:number;
  readonly contiguous:boolean;
  readonly sample:WandSampleRequest;
  readonly mode:SelectionMode;
}

/** A selection edge change. Same fields as `modifySelection`. */
export interface ModifySelectionRequest {
  readonly op:"grow"|"shrink"|"feather";
  /** Document pixels, 1..{@linkcode MAX_SELECTION_RADIUS}. */
  readonly radius:number;
}

/**
 * A refine-edge pass: smoothing then feathering. The Prism v2 contract has no
 * smoothing op, so the panel only offers this when the host passes a handler.
 */
export interface RefineEdgeRequest {
  readonly smooth:number;
  readonly feather:number;
}

/** Throws unless the settings can be sent to the engine as they are. */
export function validateWandSettings(s:MagicWandSettings):void{
  if(!Number.isInteger(s.tolerance)||s.tolerance<0||s.tolerance>MAX_TOLERANCE)
    throw new RangeError(`Tolerance must be a whole number 0..${MAX_TOLERANCE}`);
  if(typeof s.contiguous!=="boolean")throw new RangeError("Contiguous must be a boolean");
  if(s.sample!=="composite"&&s.sample!=="layer")throw new RangeError(`Unknown wand sample "${String(s.sample)}"`);
}

/**
 * Why a layer-sampled wand cannot run, or `undefined` when it can. With
 * `sample: "layer"` the wand needs the current layer's id.
 */
export function wandProblem(s:MagicWandSettings,currentLayerId:string|number|undefined):string|undefined{
  return s.sample==="layer"&&currentLayerId===undefined?"Pick a layer to sample, or sample all layers":undefined;
}

/** Builds the `magicWand` request for a click at document point `x`, `y`. */
export function buildMagicWand(
  x:number,y:number,s:MagicWandSettings,mode:SelectionMode,currentLayerId:string|number|undefined,
):MagicWandRequest{
  validateWandSettings(s);
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new RangeError("Wand point must be numbers");
  const problem=wandProblem(s,currentLayerId);
  if(problem)throw new RangeError(problem);
  return {x:Math.round(x),y:Math.round(y),tolerance:s.tolerance,contiguous:s.contiguous,
    sample:s.sample==="composite"?"composite":{layer:currentLayerId!},mode};
}

/** Why an edge change cannot run, or `undefined` when it can. */
export function modifyProblem(hasSelection:boolean,radius:number):string|undefined{
  if(!hasSelection)return "Nothing is selected";
  if(clampRadius(radius)<1)return "Set a radius of at least 1 px";
  return undefined;
}
/** Builds a `modifySelection` request, or throws with the reason it cannot run. */
export function buildModifySelection(op:ModifySelectionRequest["op"],radius:number,hasSelection:boolean):ModifySelectionRequest{
  const problem=modifyProblem(hasSelection,radius);
  if(problem)throw new RangeError(problem);
  return {op,radius:clampRadius(radius)};
}

/** Tolerance as the percentage people read, e.g. 32 -> "13%". */
export function formatTolerance(tolerance:number):string{
  return Math.round(tolerance/MAX_TOLERANCE*100)+"%";
}
/** Spoken summary of the wand settings, e.g. "Tolerance 32, contiguous, all layers". */
export function describeWand(s:MagicWandSettings):string{
  return `Tolerance ${s.tolerance}, ${s.contiguous?"contiguous":"every matching pixel"}, ${s.sample==="composite"?"all layers":"current layer"}`;
}

/** The sample choices in segmented-control order. */
export const WAND_SAMPLES=[
  {value:"composite",label:"All layers"},
  {value:"layer",label:"Current layer"},
] as const satisfies readonly {value:WandSample;label:string}[];
export {MAX_SELECTION_RADIUS};
