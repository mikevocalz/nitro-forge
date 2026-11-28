/**
 * Rules and labels for {@linkcode ShapeBuilder} (B-22). The availability rules
 * mirror Prism's `booleanLayers` validation, so the UI explains a refusal
 * before the engine has to reject it.
 */
import {AVAILABLE,unavailable,type Availability,type BooleanOp} from "./vector-types.ts";

/** Engine layer id (Prism ids are integers from one counter). */
export type LayerId=number;
/** Content kind of a layer as the engine reports it. */
export type BuilderLayerKind="raster"|"shape"|"path"|"group"|"boolean";

/** A layer as the shape builder needs to see it. */
export interface BuilderLayer {
  readonly id:LayerId;
  readonly name:string;
  readonly kind:BuilderLayerKind;
  /** Parent group or boolean id, or `null` at the document root. */
  readonly parent:LayerId|null;
  /** Kind of the parent, when there is one. */
  readonly parentKind?:"group"|"boolean";
  readonly locked:boolean;
}
/** The boolean group being edited, with its operands top to bottom. */
export interface BooleanGroup {
  readonly id:LayerId;
  readonly name:string;
  readonly op:BooleanOp;
  readonly locked:boolean;
  /** Operand layers, topmost first (the bottom operand is last). */
  readonly operands:readonly BuilderLayer[];
}

/** The four boolean operations, labelled, in toolbar order. */
export const BOOLEAN_OPS=[
  {value:"union",label:"Union",description:"Merge the shapes into one outline"},
  {value:"subtract",label:"Subtract",description:"Cut the upper shapes out of the bottom one"},
  {value:"intersect",label:"Intersect",description:"Keep only where every shape overlaps"},
  {value:"exclude",label:"Exclude",description:"Keep where shapes do not overlap"},
] as const satisfies readonly {value:BooleanOp;label:string;description:string}[];
/** Label for a {@linkcode BooleanOp}. */
export function booleanOpLabel(op:BooleanOp):string{
  const found=BOOLEAN_OPS.find(o=>o.value===op);
  if(!found)throw new RangeError("Unknown boolean op: "+String(op));
  return found.label;
}

const KIND_NAMES={raster:"pixel",shape:"shape",path:"path",group:"group",boolean:"boolean"} as const satisfies Record<BuilderLayerKind,string>;
/** Lower-case noun for a layer kind, e.g. "pixel" for raster. */
export function layerKindName(kind:BuilderLayerKind):string{
  return KIND_NAMES[kind];
}

/**
 * Whether `selection` can become a boolean. Reasons, in order: fewer than two
 * layers, a layer that is not a shape or path, layers in different parents,
 * layers already inside a boolean, a locked layer.
 */
export function booleanAvailability(selection:readonly BuilderLayer[]):Availability{
  if(selection.length<2)return unavailable("Select at least two shapes or paths");
  const other=selection.find(l=>l.kind!=="shape"&&l.kind!=="path");
  if(other)return unavailable(`“${other.name}” is a ${KIND_NAMES[other.kind]} layer; booleans take shapes and paths`);
  if(new Set(selection.map(l=>l.parent)).size>1)return unavailable("Booleans combine layers in the same group; move them together first");
  if(selection.some(l=>l.parentKind==="boolean"))
    return unavailable("These shapes are already in a boolean; change its operation instead");
  const locked=selection.find(l=>l.locked);
  if(locked)return unavailable(`“${locked.name}” is locked`);
  return AVAILABLE;
}
/** Ids to send to `booleanLayers`, in selection order. */
export function booleanIds(selection:readonly BuilderLayer[]):LayerId[]{
  return selection.map(l=>l.id);
}
/** Whether the edited boolean can change op, be released or be expanded. */
export function groupAvailability(group:BooleanGroup|undefined):Availability{
  if(!group)return unavailable("Select a boolean group to edit it");
  if(group.locked)return unavailable(`Unlock “${group.name}” first`);
  return AVAILABLE;
}

/** Throws a RangeError for a boolean group the builder cannot show honestly. */
export function validateBooleanGroup(group:BooleanGroup):void{
  if(!Number.isInteger(group.id))throw new RangeError("Boolean id must be an integer");
  if(!BOOLEAN_OPS.some(o=>o.value===group.op))throw new RangeError("Unknown boolean op: "+String(group.op));
  const seen=new Set<LayerId>();
  for(const operand of group.operands){
    if(seen.has(operand.id))throw new RangeError("Duplicate operand: "+operand.id);
    seen.add(operand.id);
    if(operand.kind!=="shape"&&operand.kind!=="path")throw new RangeError("Boolean operands are shapes or paths: "+operand.id);
  }
}

/** Screen-reader label for an operand row, e.g. "Circle, path, operand 1 of 3, top, locked". */
export function operandAccessibilityLabel(operand:BuilderLayer,index:number,count:number):string{
  return [operand.name,KIND_NAMES[operand.kind],`operand ${index+1} of ${count}`,
    index===0?"top":index===count-1?"bottom":undefined,operand.locked?"locked":undefined].filter(Boolean).join(", ");
}
