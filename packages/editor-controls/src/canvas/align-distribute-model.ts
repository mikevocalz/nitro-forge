/**
 * Align, distribute and arrange rules for {@linkcode AlignDistributePanel}
 * (B-25). Every command the panel emits is shaped like the Prism op it maps
 * to (`alignLayers`, `distributeLayers`, `moveLayer`), so the host forwards it
 * without translating. Each command is one undo step in the engine.
 */

/** Edge or centre line to align to: `alignLayers.align`. */
export type AlignEdge="left"|"hcenter"|"right"|"top"|"vcenter"|"bottom";
/** Every {@linkcode AlignEdge} with its label, in button order. */
export const ALIGN_EDGES=[
  {edge:"left",label:"Align left edges"},{edge:"hcenter",label:"Align horizontal centers"},{edge:"right",label:"Align right edges"},
  {edge:"top",label:"Align top edges"},{edge:"vcenter",label:"Align vertical centers"},{edge:"bottom",label:"Align bottom edges"},
] as const satisfies readonly {edge:AlignEdge;label:string}[];
/** What layers align against: `alignLayers.to`. */
export type AlignReference="selection"|"canvas"|{readonly artboard:string};
/** The relative-to choice shown in the panel. The artboard id comes from {@linkcode AlignDistributePanel}'s `artboard`. */
export type AlignReferenceKind="selection"|"canvas"|"artboard";
/** Payload of `alignLayers`. */
export interface AlignCommand {
  readonly ids:readonly string[];
  readonly align:AlignEdge;
  readonly to:AlignReference;
}
/** `distributeLayers.axis`. */
export type DistributeAxis="horizontal"|"vertical";
/** `distributeLayers.mode`: equal steps between centres, or equal gaps between edges. */
export type DistributeMode="centers"|"spacing";
/** Payload of `distributeLayers`. `spacing` is set only in spacing mode with a fixed gap. */
export interface DistributeCommand {
  readonly ids:readonly string[];
  readonly axis:DistributeAxis;
  readonly mode:DistributeMode;
  readonly spacing?:number;
}
/** Arrange actions. They map to `moveLayer {id, to_index}` with index 0 at the bottom. */
export type ArrangeAction="front"|"forward"|"backward"|"back";
export const ARRANGE_ACTIONS=[
  {action:"front",label:"Bring to front"},{action:"forward",label:"Bring forward"},
  {action:"backward",label:"Send backward"},{action:"back",label:"Send to back"},
] as const satisfies readonly {action:ArrangeAction;label:string}[];
/** Payload of `moveLayer`. */
export interface MoveLayerCommand {
  readonly id:string;
  readonly to_index:number;
}
/** One selected layer as the panel needs it. */
export interface AlignItem {
  readonly id:string;
  readonly name:string;
  /** Prism rejects transform edits on locked layers, so they block align and distribute. */
  readonly locked?:boolean;
}
/** The selected layer's place among its siblings, for arranging. Index 0 is the bottom, like `moveLayer`. */
export interface StackPosition {
  readonly index:number;
  readonly count:number;
}
/** Whether a group of buttons works, and if not, the sentence the panel shows instead. */
export type Availability={readonly enabled:true}|{readonly enabled:false;readonly reason:string};
const ok:Availability={enabled:true};
const no=(reason:string):Availability=>({enabled:false,reason});
/** Fixed spacing bounds, document pixels. */
export const DISTRIBUTE_MAX_SPACING=10000;

const lockedNames=(items:readonly AlignItem[])=>items.filter(i=>i.locked).map(i=>i.name);
const unlockReason=(names:string[],verb:string)=>
  names.length===1?`Unlock ${names[0]} to ${verb}`:`Unlock ${names.length} locked layers to ${verb}`;

/** Throws a `RangeError` for duplicate or empty ids. */
export function validateAlignItems(items:readonly AlignItem[]):void{
  if(items.length>10000)throw new RangeError("Too many layers for alignment");
  const seen=new Set<string>();
  for(const i of items){
    if(!i.id.trim()||i.id.length>512||!i.name.trim()||i.name.length>1024)throw new RangeError("Every selected layer needs an id");
    if(seen.has(i.id))throw new RangeError(`Layer ${i.id} is selected twice`);
    seen.add(i.id);
  }
}
/**
 * Align needs two layers against the selection (one would align to itself)
 * but one is enough against the canvas or an artboard. Locked layers block it.
 */
export function alignAvailability(items:readonly AlignItem[],reference:AlignReferenceKind,hasArtboard=true):Availability{
  if(reference==="artboard"&&!hasArtboard)return no("Add an artboard to align to it");
  const need=reference==="selection"?2:1;
  if(items.length<need)return no(need===2?"Select 2 or more layers to align them to each other":"Select a layer to align");
  const locked=lockedNames(items);
  return locked.length?no(unlockReason(locked,"align")):ok;
}
/** Distribute needs three layers: with two there is nothing between them to space. */
export function distributeAvailability(items:readonly AlignItem[]):Availability{
  if(items.length<3)return no("Select 3 or more layers to distribute");
  const locked=lockedNames(items);
  return locked.length?no(unlockReason(locked,"distribute")):ok;
}
/** Arrange works on exactly one layer, because `moveLayer` moves one layer per undo step. */
export function arrangeAvailability(items:readonly AlignItem[],stack:StackPosition|undefined):Availability{
  if(items.length!==1)return no(items.length?"Select one layer to change its order":"Select a layer to change its order");
  if(items[0]!.locked)return no(`Unlock ${items[0]!.name} to change its order`);
  if(!stack)return no("Layer order is not available for this layer");
  if(stack.count<2)return no("This is the only layer at its level");
  return ok;
}
/** The `moveLayer` target index for an arrange action, or a reason it would do nothing. */
export function arrangeTarget(stack:StackPosition,action:ArrangeAction):{readonly to_index:number}|{readonly reason:string}{
  if(!Number.isInteger(stack.index)||!Number.isInteger(stack.count)||stack.index<0||stack.index>=stack.count)
    throw new RangeError(`Stack position ${stack.index} of ${stack.count} is out of range`);
  const top=stack.count-1;
  const up=action==="front"||action==="forward";
  if(up&&stack.index===top)return {reason:"Already at the front"};
  if(!up&&stack.index===0)return {reason:"Already at the back"};
  switch(action){
    case "front":return {to_index:top};
    case "forward":return {to_index:stack.index+1};
    case "backward":return {to_index:stack.index-1};
    case "back":return {to_index:0};
  }
}
/** The `alignLayers.to` value for the panel's choice. */
export function alignReference(kind:AlignReferenceKind,artboardId?:string):AlignReference{
  if(kind!=="artboard")return kind;
  if(!artboardId)throw new RangeError("Aligning to an artboard needs its id");
  return {artboard:artboardId};
}
/** Builds an `alignLayers` payload, or throws with the availability reason. */
export function planAlign(items:readonly AlignItem[],align:AlignEdge,kind:AlignReferenceKind,artboardId?:string):AlignCommand{
  const a=alignAvailability(items,kind,artboardId!==undefined);
  if(!a.enabled)throw new RangeError(a.reason);
  return {ids:items.map(i=>i.id),align,to:alignReference(kind,artboardId)};
}
/** Validates a fixed spacing: finite, 0..{@linkcode DISTRIBUTE_MAX_SPACING} document pixels. */
export function validateSpacing(spacing:number):void{
  if(!Number.isFinite(spacing)||spacing<0||spacing>DISTRIBUTE_MAX_SPACING)
    throw new RangeError(`Spacing must be 0..${DISTRIBUTE_MAX_SPACING} document pixels, got ${spacing}`);
}
/**
 * Builds a `distributeLayers` payload. In spacing mode a `spacing` number
 * sets a fixed gap; `undefined` spreads the layers evenly between the
 * outermost two.
 */
export function planDistribute(items:readonly AlignItem[],axis:DistributeAxis,mode:DistributeMode,spacing?:number):DistributeCommand{
  const a=distributeAvailability(items);
  if(!a.enabled)throw new RangeError(a.reason);
  const ids=items.map(i=>i.id);
  if(mode==="spacing"&&spacing!==undefined){validateSpacing(spacing);return {ids,axis,mode,spacing};}
  return {ids,axis,mode};
}
