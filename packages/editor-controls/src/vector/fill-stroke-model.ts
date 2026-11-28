/**
 * Paint and stroke editing rules for {@linkcode FillStrokeInspector} (B-23).
 * Conversions keep the user's colors where they can and place new gradient
 * geometry on the layer's content bounds.
 */
import {
  AVAILABLE,MITER_LIMIT_RANGE,roundCoord,unavailable,validateDash,
  type Availability,type GradientStop,type Paint,type Rgba,type Stroke,
} from "./vector-types.ts";

/** Fill choice in the inspector: no paint, or one of the {@linkcode Paint} types. */
export type FillType="none"|Paint["type"];
/** The fill types, labelled, in control order. */
export const FILL_TYPES=[
  {value:"none",label:"None"},{value:"solid",label:"Solid"},{value:"linear",label:"Linear"},{value:"radial",label:"Radial"},
] as const satisfies readonly {value:FillType;label:string}[];
/** The fill type a paint shows as. */
export function fillTypeOf(paint:Paint|null):FillType{
  return paint===null?"none":paint.type;
}

/** Layer content kinds the inspector edits. */
export type PaintableKind="shape"|"path"|"boolean";
/** What a layer kind can take: shape layers carry a solid fill only, booleans a fill only. */
export interface PaintSupport {
  readonly gradientFill:Availability;
  readonly stroke:Availability;
  readonly fillRule:Availability;
  readonly paintOrder:Availability;
}
/** {@linkcode PaintSupport} for a layer kind, with the reasons the UI shows. */
export function paintSupport(kind:PaintableKind):PaintSupport{
  switch(kind){
    case "path":return {gradientFill:AVAILABLE,stroke:AVAILABLE,fillRule:AVAILABLE,paintOrder:AVAILABLE};
    case "shape":{
      const convert=unavailable("Shape layers take a solid fill only. Convert the shape to a path for gradients and fill rules");
      const stroke=unavailable("Convert the shape to a path to add a stroke");
      return {gradientFill:convert,stroke,fillRule:convert,paintOrder:stroke};
    }
    case "boolean":{
      const fillOnly=unavailable("A boolean has a fill only. Expand it, or stroke its operands");
      return {gradientFill:AVAILABLE,stroke:fillOnly,fillRule:fillOnly,paintOrder:fillOnly};
    }
    default:throw new RangeError("Unknown layer kind: "+String(kind));
  }
}

/** Content-space rectangle of the layer, used to place new gradients. */
export interface ContentBounds {
  readonly x:number;
  readonly y:number;
  readonly width:number;
  readonly height:number;
}
const transparent=(c:Rgba):Rgba=>[c[0],c[1],c[2],0];
/** First color a paint carries: the solid color or the first stop. */
export function primaryColor(paint:Paint):Rgba{
  return paint.type==="solid"?paint.color:paint.stops[0]!.color;
}
/**
 * `paint` converted to `type`. Solid to gradient fades the color to
 * transparent; gradient to solid keeps the first stop; linear and radial
 * swap geometry and keep their stops. New geometry spans `bounds`.
 */
export function convertPaint(paint:Paint|null,type:FillType,bounds:ContentBounds,fallback:Rgba):Paint|null{
  if(type==="none")return null;
  if(paint?.type===type)return paint;
  const color=paint?primaryColor(paint):fallback;
  const stops:readonly GradientStop[]=paint&&paint.type!=="solid"?paint.stops:[{offset:0,color},{offset:1,color:transparent(color)}];
  const cx=roundCoord(bounds.x+bounds.width/2),cy=roundCoord(bounds.y+bounds.height/2);
  switch(type){
    case "solid":return {type:"solid",color};
    case "linear":return {type:"linear",x0:roundCoord(bounds.x),y0:cy,x1:roundCoord(bounds.x+bounds.width),y1:cy,stops};
    case "radial":return {type:"radial",cx,cy,r:roundCoord(Math.max(1,Math.max(bounds.width,bounds.height)/2)),stops};
    default:throw new RangeError("Unknown fill type: "+String(type));
  }
}
/** `paint` with its solid color, or stop `stopIndex`, set to `color`. */
export function withPaintColor(paint:Paint,color:Rgba,stopIndex=0):Paint{
  if(paint.type==="solid")return {type:"solid",color};
  if(!Number.isInteger(stopIndex)||stopIndex<0||stopIndex>=paint.stops.length)throw new RangeError("No stop "+stopIndex);
  return {...paint,stops:paint.stops.map((s,i)=>i===stopIndex?{...s,color}:s)};
}

/** Stroke a path gets when its stroke is switched on. */
export function defaultStroke(color:Rgba):Stroke{
  return {paint:{type:"solid",color},width:2,join:"miter",cap:"butt",miter_limit:4,dash:[],dash_offset:0};
}

/** Dash presets as multiples of the stroke width, so they scale with it. */
export type DashPreset="solid"|"dash"|"dot"|"dash-dot"|"custom";
const PRESET_PATTERNS={solid:[],dash:[3,2],dot:[1,2],"dash-dot":[4,2,1,2]} as const satisfies Record<Exclude<DashPreset,"custom">,readonly number[]>;
/** Dash presets, labelled, in control order. "Custom" means any other pattern. */
export const DASH_PRESETS=[
  {value:"solid",label:"Solid"},{value:"dash",label:"Dash"},{value:"dot",label:"Dot"},
  {value:"dash-dot",label:"Dash dot"},{value:"custom",label:"Custom"},
] as const satisfies readonly {value:DashPreset;label:string}[];
/** The dash pattern for a preset at stroke `width`. */
export function dashForPreset(preset:Exclude<DashPreset,"custom">,width:number):number[]{
  if(!Number.isFinite(width)||width<=0)throw new RangeError("Stroke width must be positive");
  return PRESET_PATTERNS[preset].map(n=>roundCoord(n*width));
}
/** Which preset `dash` matches at stroke `width`, or "custom". */
export function presetForDash(dash:readonly number[],width:number):DashPreset{
  for(const [preset,pattern] of Object.entries(PRESET_PATTERNS) as [Exclude<DashPreset,"custom">,readonly number[]][]){
    const expect=dashForPreset(preset,width);
    if(expect.length===dash.length&&expect.every((v,i)=>Math.abs(v-dash[i]!)<1e-6))return preset;
    if(pattern.length===0&&dash.length===0)return preset;
  }
  return "custom";
}
/** Result of {@linkcode parseDash}. */
export type DashParse=Readonly<{ok:true;dash:number[]}>|Readonly<{ok:false;error:string}>;
/** Parses a typed dash pattern such as "6 3" or "6, 3, 1, 3". Blank means solid. */
export function parseDash(text:string):DashParse{
  const parts=text.split(/[\s,]+/).filter(Boolean);
  const dash=parts.map(Number);
  if(dash.some(n=>!Number.isFinite(n)))return {ok:false,error:"Use numbers separated by spaces or commas, for example 6 3"};
  try{validateDash(dash);}catch(e){return {ok:false,error:(e as Error).message};}
  return {ok:true,dash:dash.map(roundCoord)};
}
/** Dash pattern as the text a user would type, e.g. "6 3". */
export function formatDash(dash:readonly number[]):string{
  return dash.map(n=>String(roundCoord(n))).join(" ");
}

/** Whether the miter limit matters: only for miter joins. */
export function miterAvailability(stroke:Stroke):Availability{
  return stroke.join==="miter"?AVAILABLE:unavailable("The miter limit applies to miter joins only");
}
/** Stroke width bounds for the width control. */
export const STROKE_WIDTH_RANGE={min:0.1,max:500,step:0.1} as const;
/** Miter limit bounds for its control. */
export const MITER_RANGE={min:MITER_LIMIT_RANGE.min,max:MITER_LIMIT_RANGE.max,step:0.5} as const;
/** Dash offset bounds for its control. */
export const DASH_OFFSET_RANGE={min:-1000,max:1000,step:0.5} as const;
