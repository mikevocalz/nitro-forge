/** RGBA channels 0–255, as presentation engines store document colors. */
export type SlideRgba=readonly [number,number,number,number];

/** Kinds of object a slide holds. */
export type SlideObjectKind="text"|"rect"|"image";

/**
 * One object on a slide, in slide units (the deck's coordinate space, see
 * {@linkcode SLIDE_DEFAULT_SIZE}). Fields that only apply to one kind are
 * optional on the shared shape because engines report them that way; the
 * renderer reads them by `kind`.
 */
export interface SlideObject {
  readonly id:string;
  readonly kind:SlideObjectKind;
  readonly x:number;
  readonly y:number;
  readonly w:number;
  readonly h:number;
  /** Degrees clockwise. */
  readonly rotation:number;
  readonly text?:string;
  readonly fontSize?:number;
  readonly bold?:boolean;
  readonly italic?:boolean;
  readonly color?:SlideRgba;
  readonly fill?:SlideRgba;
  readonly src?:string;
  /** Resolved opacity at a preview time, 0–1. @default 1 */
  readonly opacity?:number;
}

/** A slide as the filmstrip, sorter and canvas draw it. */
export interface SlideSummary {
  readonly id:string;
  readonly objects:readonly SlideObject[];
  readonly background?:SlideRgba;
}

/** Deck coordinate space used when the engine stores none: 16:9 at 960 × 540 units. */
export const SLIDE_DEFAULT_SIZE={width:960,height:540} as const;

/** Width and height of a deck's coordinate space. */
export interface SlideSize {
  readonly width:number;
  readonly height:number;
}

/** CSS color for a document RGBA. */
export function rgbaCss(c:SlideRgba):string{
  const ch=(v:number)=>Math.min(255,Math.max(0,Math.round(v)));
  return `rgba(${ch(c[0])},${ch(c[1])},${ch(c[2])},${Math.round(Math.min(255,Math.max(0,c[3]))/255*1000)/1000})`;
}

/** The slide's title for labels: its first non-empty text object, else "Slide n". */
export function slideTitle(slide:SlideSummary,index:number):string{
  const t=slide.objects.find(o=>o.kind==="text"&&o.text?.trim());
  return t?.text?.trim().split(/\n/u)[0]!.slice(0,80)??"Slide "+(index+1);
}

/** Screen-reader label for a slide thumbnail. */
export function slideLabel(slide:SlideSummary,index:number,count:number):string{
  const title=slideTitle(slide,index);
  const n=slide.objects.length;
  return "Slide "+(index+1)+" of "+count+(title==="Slide "+(index+1)?"":", "+title)+", "+(n===1?"1 object":n+" objects");
}

/** `ids` reordered so `id` sits at `toIndex`. Unknown ids or indexes throw. */
export function moveId(ids:readonly string[],id:string,toIndex:number):string[]{
  const from=ids.indexOf(id);
  if(from<0)throw new RangeError(`Unknown slide "${id}"`);
  if(!Number.isSafeInteger(toIndex)||toIndex<0||toIndex>=ids.length)throw new RangeError(`Slide index ${toIndex} is out of range`);
  const next=[...ids];
  next.splice(from,1);
  next.splice(toIndex,0,id);
  return next;
}

/**
 * Moves several slides as a block to `toIndex` (the block's new first
 * position, counted after the block is taken out), keeping their order.
 * Returns the resulting order.
 */
export function moveBlock(ids:readonly string[],moving:readonly string[],toIndex:number):string[]{
  const set=new Set(moving);
  for(const id of set)if(!ids.includes(id))throw new RangeError(`Unknown slide "${id}"`);
  const block=ids.filter(id=>set.has(id));
  const rest=ids.filter(id=>!set.has(id));
  const at=Math.min(Math.max(0,Math.trunc(toIndex)),rest.length);
  return [...rest.slice(0,at),...block,...rest.slice(at)];
}

/**
 * Single `from → to` moves (each a valid index in the order at that moment)
 * that turn `before` into `after`. Hosts whose engine moves one slide per
 * call apply these in sequence.
 */
export function planMoves(before:readonly string[],after:readonly string[]):Array<{from:number;to:number}>{
  if(before.length!==after.length||new Set(before).size!==before.length||!after.every(id=>before.includes(id)))
    throw new RangeError("Slide orders must hold the same ids");
  const cur=[...before];
  const out:Array<{from:number;to:number}>=[];
  after.forEach((id,to)=>{
    const from=cur.indexOf(id);
    if(from===to)return;
    cur.splice(from,1);
    cur.splice(to,0,id);
    out.push({from,to});
  });
  return out;
}

/** Selection after a plain, additive (Cmd/Ctrl) or range (Shift) click on `id`. */
export function nextSelection(order:readonly string[],selected:readonly string[],anchor:string|undefined,id:string,mode:"replace"|"toggle"|"range"):{selected:string[];anchor:string}{
  if(mode==="toggle")return {selected:selected.includes(id)?selected.filter(s=>s!==id):[...selected,id],anchor:id};
  if(mode==="range"&&anchor!==undefined&&order.includes(anchor)){
    const a=order.indexOf(anchor),b=order.indexOf(id);
    return {selected:order.slice(Math.min(a,b),Math.max(a,b)+1),anchor};
  }
  return {selected:[id],anchor:id};
}

/** Columns that fit `width` with cells at least `minCell` wide and `gap` apart (at least 1). */
export function gridColumns(width:number,minCell:number,gap:number):number{
  if(!(width>0)||!(minCell>0))return 1;
  return Math.max(1,Math.floor((width+gap)/(minCell+gap)));
}

/** Focus target for an arrow key in a grid of `count` cells and `columns` columns, or `undefined` at an edge. */
export function gridMove(index:number,key:string,columns:number,count:number,rtl=false):number|undefined{
  const right=rtl?-1:1;
  const delta=key==="ArrowRight"?right:key==="ArrowLeft"?-right:key==="ArrowDown"?columns:key==="ArrowUp"?-columns:
    key==="Home"?-index:key==="End"?count-1-index:undefined;
  if(delta===undefined)return undefined;
  const next=index+delta;
  return next>=0&&next<count?next:undefined;
}

/** Bounded source geometry shared by canvas, sorter and filmstrip. */
export function validateSlideSummary(slide:SlideSummary):void{
 if(!slide.id.trim()||slide.id.length>256||slide.objects.length>2048||new Set(slide.objects.map(o=>o.id)).size!==slide.objects.length||slide.objects.reduce((n,o)=>n+(o.text?.length??0),0)>1048576||slide.objects.some(o=>!o.id.trim()||o.id.length>256||!['text','rect','image'].includes(o.kind)||![o.x,o.y,o.w,o.h,o.rotation].every(Number.isFinite)||o.w<=0||o.h<=0||o.w>1e7||o.h>1e7||o.src!==undefined&&o.src.length>8192||o.opacity!==undefined&&(!Number.isFinite(o.opacity)||o.opacity<0||o.opacity>1)))throw new RangeError('Invalid slide source geometry');
 for(const rgba of [slide.background,...slide.objects.flatMap(o=>[o.fill,o.color])])if(rgba&&(rgba.length!==4||rgba.some(n=>!Number.isFinite(n)||n<0||n>255)))throw new RangeError('Invalid slide document color');
}
