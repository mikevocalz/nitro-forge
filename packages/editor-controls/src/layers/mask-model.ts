/**
 * Engine-neutral layer-mask contract for `MaskThumbnailAndEditor` (B-12).
 * Every payload is the argument object of one engine op, so the host adapter
 * forwards it unchanged: `addMask`, `removeMask`, `setMaskEnabled`,
 * `invertMask` and `refineMask`. `maskThumbnail` feeds the preview loader.
 */

/** The layer's mask as the engine describes it, or `null` when it has none. */
export interface MaskInfo {
  readonly enabled:boolean;
  readonly inverted:boolean;
  /** Bumps whenever the mask pixels change, so the preview reloads. */
  readonly revision:number;
}
/** Thumbnail revisions are safe integer cache versions, including zero. */
export function validateMaskInfo(mask:MaskInfo|null):void {
 if(mask===null)return;
 if(!mask||typeof mask.enabled!=='boolean'||typeof mask.inverted!=='boolean'||!Number.isSafeInteger(mask.revision)||mask.revision<0)throw new RangeError('Invalid mask state or thumbnail revision');
}

/** How a new mask starts: everything shown, everything hidden, or the pixel selection. */
export type MaskFill="reveal"|"hide"|"selection";

/** `addMask` argument. */
export interface AddMaskOp {readonly id:string;readonly fill:MaskFill}
/** `removeMask` argument. `apply: true` bakes the mask into the layer's pixels first. */
export interface RemoveMaskOp {readonly id:string;readonly apply:boolean}
/** `setMaskEnabled` argument. */
export interface SetMaskEnabledOp {readonly id:string;readonly enabled:boolean}
/** `invertMask` argument. */
export interface InvertMaskOp {readonly id:string}
/** `refineMask` argument. Both amounts are in document pixels. */
export interface RefineMaskOp {readonly id:string;readonly feather:number;readonly grow:number}

/** A refine amount the host keeps while the person dials it in. */
export interface RefineDraft {readonly feather:number;readonly grow:number}

/** Engine bounds for `refineMask`. */
export const FEATHER_RANGE={min:0,max:250,step:1} as const;
/** Negative grow shrinks the mask. */
export const GROW_RANGE={min:-250,max:250,step:1} as const;
/** The draft a fresh editor starts from. */
export const NO_REFINE:RefineDraft={feather:0,grow:0};

/** The three ways to create a mask, in button order. */
export const MASK_FILLS=[
  {fill:"reveal",label:"Reveal all"},
  {fill:"hide",label:"Hide all"},
  {fill:"selection",label:"From selection"},
] as const satisfies readonly {fill:MaskFill;label:string}[];

/** Why a layer's mask controls cannot run, or `undefined` when they can. Locked layers reject mask edits. */
export function maskBlockedReason(locked:boolean):string|undefined{
  return locked?"Unlock the layer to edit its mask":undefined;
}

/** Why a create option cannot run, or `undefined` when it can. */
export function maskFillReason(fill:MaskFill,{locked,hasSelection}:{locked:boolean;hasSelection:boolean}):string|undefined{
  const blocked=maskBlockedReason(locked);
  if(blocked)return blocked;
  if(fill==="selection"&&!hasSelection)return "Make a selection first";
  return undefined;
}

/** Clamps a draft to the engine bounds, rounding to whole pixels. @throws RangeError on non-finite values. */
export function normalizeRefine(draft:RefineDraft):RefineDraft{
  if(!Number.isFinite(draft.feather)||!Number.isFinite(draft.grow))throw new RangeError("Refine amounts must be finite");
  const clamp=(v:number,r:{min:number;max:number})=>Math.round(Math.min(r.max,Math.max(r.min,v)));
  return {feather:clamp(draft.feather,FEATHER_RANGE),grow:clamp(draft.grow,GROW_RANGE)};
}

/** Why "Refine" cannot run, or `undefined` when it can. A zero draft would be an undo step that changes nothing. */
export function refineReason(draft:RefineDraft,locked:boolean):string|undefined{
  const blocked=maskBlockedReason(locked);
  if(blocked)return blocked;
  const d=normalizeRefine(draft);
  return d.feather===0&&d.grow===0?"Set a feather or grow amount first":undefined;
}

/** The `refineMask` argument for a draft. */
export function refineOp(id:string,draft:RefineDraft):RefineMaskOp{
  return {id,...normalizeRefine(draft)};
}

/** Spoken state of the mask, e.g. "Mask, on, inverted". */
export function maskStateLabel(mask:MaskInfo|null):string{
  if(!mask)return "No mask";
  return ["Mask",mask.enabled?"on":"off",mask.inverted?"inverted":undefined].filter(Boolean).join(", ");
}

/** Short visible status next to the preview, e.g. "On, inverted". */
export function maskStatusText(mask:MaskInfo):string{
  return [mask.enabled?"On":"Off",mask.inverted?"inverted":undefined].filter(Boolean).join(", ");
}

/** Thumbnail cache id for a layer's mask preview; kept apart from the layer's own preview. */
export function maskThumbnailId(layerId:string):string{
  return "mask:"+layerId;
}
