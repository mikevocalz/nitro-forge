/**
 * Engine-neutral artboard list contract for `ArtboardNavigator` (B-14). The
 * `on*` payloads are the argument objects of `addArtboard`, `updateArtboard`,
 * `removeArtboard` and `moveArtboard`; `artboardThumbnail` feeds the previews.
 * Geometry is document pixels.
 */

/** One artboard as the engine describes it (`describe.artboards`), plus a preview revision. */
export interface ArtboardItem {
  readonly id:string;
  readonly name:string;
  readonly x:number;
  readonly y:number;
  readonly w:number;
  readonly h:number;
  /** Bumps whenever the artboard's pixels change, so its preview reloads. @default 0 */
  readonly revision?:number;
}

/** `addArtboard` argument. */
export interface AddArtboardOp {readonly name?:string;readonly x:number;readonly y:number;readonly w:number;readonly h:number}
/** `updateArtboard` argument; the navigator only sends `name`. */
export interface UpdateArtboardOp {readonly id:string;readonly name?:string;readonly x?:number;readonly y?:number;readonly w?:number;readonly h?:number}
/** `removeArtboard` argument. */
export interface RemoveArtboardOp {readonly id:string}
/** `moveArtboard` argument; `to_index` is the new position in the list (0 = first). */
export interface MoveArtboardOp {readonly id:string;readonly to_index:number}

/** How the navigator lays artboards out. */
export type ArtboardLayout="list"|"grid";

/** Size of a new artboard when there is nothing to copy. */
export const DEFAULT_ARTBOARD_SIZE={w:1920,h:1080} as const;
/** Gap, in document pixels, between a new artboard and the rightmost one. */
export const ARTBOARD_GAP=100;
/** Narrowest grid tile in points; the column count follows the pane width. */
export const ARTBOARD_TILE_MIN=148;
/** Upper bound on artboards the navigator renders; larger documents need virtualization. */
export const ARTBOARD_MAX=300;

/** Throws a RangeError for duplicate or empty ids, blank names, non-positive sizes or non-finite geometry. */
export function validateArtboards(artboards:readonly ArtboardItem[]):void{
  if(artboards.length>ARTBOARD_MAX)throw new RangeError("Artboard navigator exceeds "+ARTBOARD_MAX+" artboards");
  const seen=new Set<string>();
  for(const a of artboards){
    if(!a.id.trim()||a.id.length>512||seen.has(a.id))throw new RangeError("Duplicate or empty artboard id: "+a.id);
    seen.add(a.id);
    if(!a.name.trim()||a.name.length>512)throw new RangeError("Artboard name is blank: "+a.id);
    if(![a.x,a.y,a.w,a.h,a.x+a.w,a.y+a.h].every(Number.isFinite)||a.w<=0||a.h<=0)throw new RangeError("Invalid artboard geometry: "+a.id);
    if(a.revision!==undefined&&(!Number.isSafeInteger(a.revision)||a.revision<0))throw new RangeError("Invalid artboard revision: "+a.id);
  }
}

/** "Artboard N" with the smallest N not already used. */
export function nextArtboardName(artboards:readonly Pick<ArtboardItem,"name">[]):string{
  const used=new Set(artboards.map(a=>a.name.trim().toLowerCase()));
  // Counting from 1 means deleting "Artboard 2" lets the next new one take the name.
  for(let k=1;;k++)if(!used.has("artboard "+k))return "Artboard "+k;
}

/**
 * The `addArtboard` argument for the add button: same size as `like` (the
 * selected artboard, else the last one, else 1920x1080), placed 100 px right of
 * the rightmost artboard and level with the top-most one, so it never overlaps.
 */
export function newArtboardOp(artboards:readonly ArtboardItem[],likeId?:string):AddArtboardOp{
  validateArtboards(artboards);if(artboards.length>=ARTBOARD_MAX)throw new RangeError("Artboard render limit reached");
  const like=artboards.find(a=>a.id===likeId)??artboards[artboards.length-1];
  const w=like?.w??DEFAULT_ARTBOARD_SIZE.w,h=like?.h??DEFAULT_ARTBOARD_SIZE.h;
  const name=nextArtboardName(artboards);
  if(artboards.length===0)return {name,x:0,y:0,w,h};
  const right=Math.max(...artboards.map(a=>a.x+a.w));
  const top=Math.min(...artboards.map(a=>a.y));
  const x=right+ARTBOARD_GAP;if(!Number.isFinite(x+w)||x<=right)throw new RangeError("No representable position for the next artboard");
  return {name,x,y:top,w,h};
}

/** Grid columns for a pane `width` points wide. Never below 1. */
export function artboardColumns(width:number,gap=8):number{
  if(!Number.isFinite(gap)||gap<0)throw new RangeError("Invalid artboard tile gap");
  if(!Number.isFinite(width)||width<=0)return 1;
  return Math.min(ARTBOARD_MAX,Math.max(1,Math.floor((width+gap)/(ARTBOARD_TILE_MIN+gap))));
}

/**
 * Index a dragged tile lands on. In a list only `dy` counts; in a grid the drag
 * moves by whole cells in both axes, reading order left to right (right to
 * left in RTL), then down. Clamped to the list.
 */
export function artboardDropIndex({from,dx,dy,count,columns,cellWidth,cellHeight,rtl=false}:{
  from:number;dx:number;dy:number;count:number;columns:number;cellWidth:number;cellHeight:number;rtl?:boolean;
}):number{
  if(!Number.isSafeInteger(count)||count<1||count>ARTBOARD_MAX||!Number.isSafeInteger(columns)||columns<1||columns>ARTBOARD_MAX)throw new RangeError("Invalid artboard count or columns");
  if(!Number.isInteger(from)||from<0||from>=count)throw new RangeError("Drag start index out of range");
  if(![dx,dy,cellWidth,cellHeight].every(Number.isFinite)||cellWidth<=0||cellHeight<=0||columns<1)
    throw new RangeError("Invalid drag metrics");
  const cols=Math.floor(columns);
  const row=Math.floor(from/cols)+Math.round(dy/cellHeight);
  const col=cols===1?0:Math.min(cols-1,Math.max(0,from%cols+Math.round((rtl?-dx:dx)/cellWidth)));
  return Math.min(count-1,Math.max(0,row*cols+col));
}

/** What a key press on a focused artboard does. */
export type ArtboardKeyAction=
  |{readonly kind:"focus";readonly index:number}
  |{readonly kind:"move";readonly to:number}
  |{readonly kind:"select"}
  |{readonly kind:"rename"}
  |{readonly kind:"remove"};

/**
 * Keyboard map for a focused artboard. Arrows move focus (left/right flip in
 * RTL; up/down jump a row in a grid), Home/End jump to the ends, and the same
 * keys with Alt held reorder the artboard instead. Enter or Space selects
 * (navigates to) it, F2 renames, Delete or Backspace removes. `null` means the
 * key is not handled.
 */
export function artboardKeyAction(key:string|undefined,{index,count,columns,layout,rtl=false,alt=false}:{
  index:number;count:number;columns:number;layout:ArtboardLayout;rtl?:boolean;alt?:boolean;
}):ArtboardKeyAction|null{
  if(!Number.isSafeInteger(count)||count<0||count>ARTBOARD_MAX||!Number.isSafeInteger(columns)||columns<1||columns>ARTBOARD_MAX||!Number.isInteger(index)||index<0||count>0&&index>=count||!["list","grid"].includes(layout))throw new RangeError("Invalid artboard keyboard metrics");
  if(key===undefined||count===0)return null;
  if(!alt){
    if(key==="Enter"||key===" ")return {kind:"select"};
    if(key==="F2")return {kind:"rename"};
    if(key==="Delete"||key==="Backspace")return {kind:"remove"};
  }
  const row=layout==="grid"?Math.max(1,Math.floor(columns)):1;
  const forward=rtl?"ArrowLeft":"ArrowRight",back=rtl?"ArrowRight":"ArrowLeft";
  let target:number|undefined;
  if(key==="ArrowDown")target=index+row;
  else if(key==="ArrowUp")target=index-row;
  else if(key===forward&&(layout==="grid"||!alt))target=index+1;
  else if(key===back&&(layout==="grid"||!alt))target=index-1;
  else if(key==="Home")target=0;
  else if(key==="End")target=count-1;
  if(target===undefined)return null;
  const clamped=Math.min(count-1,Math.max(0,target));
  if(clamped===index)return null;
  return alt?{kind:"move",to:clamped}:{kind:"focus",index:clamped};
}

/** "1920 × 1080" with whole pixels. */
export function formatArtboardSize(a:Pick<ArtboardItem,"w"|"h">):string{
  return Math.round(a.w)+" × "+Math.round(a.h);
}

/** Spoken label for an artboard tile. */
export function artboardAccessibilityLabel(a:ArtboardItem,index:number,count:number):string{
  return `${a.name}, ${Math.round(a.w)} by ${Math.round(a.h)} pixels, ${index+1} of ${count}`;
}

/** Thumbnail cache id for an artboard preview, kept apart from layer ids. */
export function artboardThumbnailId(id:string):string{
  return "artboard:"+id;
}
