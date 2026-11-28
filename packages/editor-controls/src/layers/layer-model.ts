/**
 * Engine-neutral layer list contract. The app (or its compositor) owns the
 * layer document; {@linkcode LayerStack} only previews gestures and reports
 * committed intent through callbacks.
 */
import type {ReactNode} from "react";

/**
 * What a {@linkcode LayerRow} contains. Its built-in label ({@linkcode layerKindLabel})
 * is shown under the name unless the row sets {@linkcode LayerRow.kindLabel}.
 */
export type LayerKind="raster"|"vector"|"text"|"group"|"adjustment";

/**
 * Small preview drawn before a {@linkcode LayerRow}'s name. Either a solid
 * `fill` colour taken from the layer's content, or a `node` the app renders
 * (for example a scaled raster preview). The node is clipped to a 28pt square.
 *
 * The preview is never its own screen-reader element. When `label` is set it
 * joins the row's spoken label; without it the preview is treated as decorative.
 * @see {@linkcode LayerRow.thumbnail}
 */
export type LayerThumbnail=Readonly<{
 /** Any colour string the host platform accepts, e.g. the layer's fill. */
 fill:string;
 /** Spoken description, e.g. "red fill". Omit when the preview is decorative. */
 label?:string;
}>|Readonly<{
 /** App-rendered preview, clipped to the thumbnail square. */
 node:ReactNode;
 /** Spoken description, e.g. "photo of a skyline". Omit when the preview is decorative. */
 label?:string;
}>;

/**
 * One row in a {@linkcode LayerStack}. Index 0 of the `layers` array is the
 * topmost layer and renders at the top of the list.
 */
export type LayerRow=Readonly<{
 /** Stable identity; must be unique within the stack. */
 id:string;
 /** Display name; must contain at least one non-space character. */
 name:string;
 /** Whether the compositor draws this layer. */
 visible:boolean;
 /** Layer opacity from 0 (transparent) to 1 (opaque). */
 opacity:number;
 /**
  * Locked layers can still be selected and hidden, but cannot be renamed,
  * reordered, or have their opacity changed.
  * @default false
  */
 locked?:boolean;
 /** What the layer contains. */
 kind:LayerKind;
 /** Optional containing group. Flat stacks omit this field. */
 parentId?:string|null;
 /**
  * Text shown under the name and spoken as "<kindLabel> layer", replacing the
  * built-in {@linkcode layerKindLabel} for `kind`, e.g. "Rectangle" for a
  * vector layer. Must contain a non-space character when set.
  */
 kindLabel?:string;
 /** Optional preview before the name; the row keeps its height. */
 thumbnail?:LayerThumbnail;
 /**
  * Name of the base layer this one clips to. The row is indented with a clip
  * glyph and its spoken label says "clipped to <name>". `resolveClipping` in
  * `clipping-model` computes it from the layers' `clipped` flags.
  */
 clippedTo?:string;
}>;

/** Minimum touch target edge for every interactive part of a row, in points. */
export const LAYER_TOUCH_TARGET=44;
/** Edge of a {@linkcode LayerThumbnail} square, in points. Fits inside the 44pt row. */
export const LAYER_THUMBNAIL_SIZE=28;
/** Opacity change applied by one screen-reader increment or decrement. */
export const LAYER_OPACITY_STEP=0.05;
/** Upper bound on rows; larger documents need a virtualized list. */
export const LAYER_STACK_MAX_ROWS=500;
/** Width the name column keeps before the opacity control gives anything up, in points. */
export const LAYER_NAME_MIN_WIDTH=96;
/**
 * Width of the inline opacity slider column (track, gap and percent text), in
 * points. Below it the track is too short to drag with any precision, so the
 * row switches to the readout instead of squeezing the slider.
 */
export const LAYER_OPACITY_SLIDER_WIDTH=120;
/** Width of the compact opacity readout button that replaces the slider, in points. */
export const LAYER_OPACITY_READOUT_WIDTH=56;

/**
 * How a {@linkcode LayerStack} row shows opacity: `slider` draws the inline
 * drag track, `readout` a percentage button that opens a scrubber popover.
 * @see {@linkcode layerOpacityMode}
 */
export type LayerOpacityMode="slider"|"readout";

/** Which fixed-width parts a row carries; see {@linkcode layerRowMinWidth}. */
export type LayerRowParts=Readonly<{
  /** Any row in the stack has a thumbnail, so every row keeps the slot. */
  thumbnail:boolean;
  /** The host passed `onRemove`, so every row has a remove button. */
  removable:boolean;
}>;

/**
 * Narrowest row, in points, that fits every part with the name at
 * {@linkcode LAYER_NAME_MIN_WIDTH} and opacity shown as `mode`: drag handle,
 * visibility switch, optional thumbnail slot, name, opacity, optional remove.
 */
export function layerRowMinWidth(parts:LayerRowParts,mode:LayerOpacityMode):number{
  const opacity=mode==="slider"?LAYER_OPACITY_SLIDER_WIDTH:LAYER_OPACITY_READOUT_WIDTH;
  return LAYER_TOUCH_TARGET*2+(parts.thumbnail?LAYER_THUMBNAIL_SIZE+4:0)+LAYER_NAME_MIN_WIDTH+opacity+
    (parts.removable?LAYER_TOUCH_TARGET:0);
}

/**
 * Opacity presentation for a stack `width` points wide. The inline slider is
 * kept only while the whole row fits beside it; otherwise the readout takes
 * its place so the name and the remove button always fit. An unmeasured
 * stack (`width` undefined) keeps the slider, which is what it drew before
 * the first layout.
 */
export function layerOpacityMode(width:number|undefined,parts:LayerRowParts):LayerOpacityMode{
  if(width===undefined||!Number.isFinite(width))return "slider";
  return width>=layerRowMinWidth(parts,"slider")?"slider":"readout";
}

const KIND_LABELS={
 raster:"Pixel",vector:"Shape",text:"Text",group:"Group",adjustment:"Adjustment",
} as const satisfies Record<LayerKind,string>;

/** Human-readable label for a {@linkcode LayerKind}. */
export function layerKindLabel(kind:LayerKind):string{
 return KIND_LABELS[kind];
}

/** Label shown under a row's name: {@linkcode LayerRow.kindLabel} when set, else the kind's built-in label. */
export function layerDetail(layer:Pick<LayerRow,"kind"|"kindLabel">):string{
 return layer.kindLabel?.trim()||layerKindLabel(layer.kind);
}

/**
 * Throws a RangeError when the controlled `layers` prop cannot be rendered
 * honestly: duplicate or empty ids, blank names, unknown kinds, opacity
 * outside 0..1, a blank `kindLabel`, or a thumbnail with neither a non-blank
 * `fill` nor a `node`, or with a blank `label`.
 */
export function validateLayers(layers:readonly LayerRow[]):void{
 if(layers.length>LAYER_STACK_MAX_ROWS)throw new RangeError("Layer stack exceeds "+LAYER_STACK_MAX_ROWS+" rows");
 const seen=new Set<string>();
 for(const layer of layers){
  if(!layer.id.trim()||layer.id.length>512||seen.has(layer.id))throw new RangeError("Duplicate or empty layer id: "+layer.id);
  seen.add(layer.id);
  if(!layer.name.trim()||layer.name.length>512)throw new RangeError("Layer name is blank or too long: "+layer.id);
  if(typeof layer.visible!=="boolean"||layer.locked!==undefined&&typeof layer.locked!=="boolean"||layer.parentId!=null&&(!layer.parentId.trim()||layer.parentId.length>512))throw new RangeError("Invalid layer visibility, lock or parent: "+layer.id);
  if(!Number.isFinite(layer.opacity)||layer.opacity<0||layer.opacity>1)
   throw new RangeError("Layer opacity must be within 0..1: "+layer.id);
  if(!Object.hasOwn(KIND_LABELS,layer.kind))throw new RangeError("Unknown layer kind: "+String(layer.kind));
  if(layer.kindLabel!==undefined&&!layer.kindLabel.trim())throw new RangeError("Layer kindLabel is blank: "+layer.id);
  if(layer.clippedTo!==undefined&&!layer.clippedTo.trim())throw new RangeError("Layer clippedTo is blank: "+layer.id);
  validateThumbnail(layer);
 }
}

function validateThumbnail(layer:LayerRow):void{
 const thumb=layer.thumbnail;
 if(thumb===undefined)return;
 const hasFill="fill" in thumb&&typeof thumb.fill==="string"&&thumb.fill.trim()!=="";
 const hasNode="node" in thumb&&thumb.node!==undefined&&thumb.node!==null&&thumb.node!==false;
 if(hasFill===hasNode)throw new RangeError("Layer thumbnail needs exactly one of a fill colour or a node: "+layer.id);
 if(thumb.label!==undefined&&!thumb.label.trim())throw new RangeError("Layer thumbnail label is blank: "+layer.id);
}

/** Clamp to 0..1 and round to whole percent so previews and commits agree. */
export function normalizeOpacity(value:number):number{
 if(!Number.isFinite(value))throw new RangeError("Opacity must be a finite number");
 return Math.round(Math.min(1,Math.max(0,value))*100)/100;
}

/** Opacity after one screen-reader increment (+1) or decrement (-1). */
export function stepOpacity(value:number,direction:-1|1,step=LAYER_OPACITY_STEP):number{
 return normalizeOpacity(value+direction*step);
}

/**
 * Opacity under a horizontal drag. Dragging the full track width changes
 * opacity by 1. A track narrower than one touch target uses the touch target
 * width so tiny layouts are not hypersensitive.
 */
export function opacityFromDrag(start:number,dx:number,trackWidth:number):number{
 if(!Number.isFinite(dx)||!Number.isFinite(trackWidth))throw new RangeError("Invalid opacity drag");
 return normalizeOpacity(start+dx/Math.max(LAYER_TOUCH_TARGET,trackWidth));
}

/** Whole-percent text read by screen readers and shown in the row. */
export function formatOpacity(value:number):string{
 return Math.round(normalizeOpacity(value)*100)+"%";
}

/**
 * Index a dragged row lands on after moving `dy` points vertically. Rows are
 * `rowHeight` tall; the result is clamped to the list.
 */
export function dragTargetIndex(fromIndex:number,dy:number,rowHeight:number,count:number):number{
 if(!Number.isInteger(fromIndex)||fromIndex<0||fromIndex>=count)throw new RangeError("Drag start index out of range");
 if(!Number.isFinite(dy)||!Number.isFinite(rowHeight)||rowHeight<=0)throw new RangeError("Invalid drag metrics");
 return Math.min(count-1,Math.max(0,fromIndex+Math.round(dy/rowHeight)));
}

/**
 * Returns a new array with layer `id` moved to `toIndex` (0 = top). Apps can
 * use it to apply an `onMove` callback to their own state.
 * @throws RangeError when the id is unknown or the index is out of range.
 */
export function moveLayer<T extends Pick<LayerRow,"id">>(layers:readonly T[],id:string,toIndex:number):T[]{
 const from=layers.findIndex(l=>l.id===id);
 if(from<0)throw new RangeError("Unknown layer: "+id);
 if(!Number.isInteger(toIndex)||toIndex<0||toIndex>=layers.length)throw new RangeError("Layer index out of range: "+toIndex);
 const next=layers.slice();
 const [row]=next.splice(from,1);
 next.splice(toIndex,0,row!);
 return next;
}

/**
 * Returns a new array without layer `id`. Apps can use it to apply an
 * `onRemove` callback to their own state; keep the removed row and its index
 * in the undo record so the host can restore it.
 * @throws RangeError when the id is unknown.
 */
export function removeLayer<T extends Pick<LayerRow,"id">>(layers:readonly T[],id:string):T[]{
 const from=layers.findIndex(l=>l.id===id);
 if(from<0)throw new RangeError("Unknown layer: "+id);
 return layers.filter((_,i)=>i!==from);
}

/**
 * Trimmed name to commit, or `undefined` when the draft is blank or unchanged
 * and the rename should be dropped.
 */
export function resolveRename(current:string,draft:string):string|undefined{
 const next=draft.trim();
 return next&&next!==current?next:undefined;
}

/**
 * Screen-reader label for a row's main element. The thumbnail's `label`, when
 * set, follows the kind so the preview is described once, on the row.
 */
export function layerAccessibilityLabel(layer:LayerRow,index:number,count:number):string{
 return [layer.name,layerDetail(layer)+" layer",layer.clippedTo?"clipped to "+layer.clippedTo.trim():undefined,
  layer.thumbnail?.label?.trim(),(index+1)+" of "+count,
  layer.visible?"visible":"hidden",formatOpacity(layer.opacity)+" opacity",
  layer.locked?"locked":undefined].filter(Boolean).join(", ");
}
