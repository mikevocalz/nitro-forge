/** How one list level numbers its items. */
export type ListFormat="bullet"|"decimal"|"lowerLetter"|"upperLetter"|"lowerRoman"|"upperRoman";

/** What a paragraph is, list-wise. `none` takes it out of the list. */
export type ListKind="none"|"bullet"|"numbered"|"multilevel";

/** Deepest level index; levels run 0..8, nine in all, as in Word and OOXML. */
export const LIST_MAX_LEVEL=8;

/** Every {@linkcode ListFormat}, in picker order. */
export const LIST_FORMATS:readonly ListFormat[]=["bullet","decimal","lowerLetter","upperLetter","lowerRoman","upperRoman"];

/** Level formats a {@linkcode ListKind} starts with; multilevel cycles 1. a. i. down the levels. */
export function defaultLevelFormats(kind:Exclude<ListKind,"none">):ListFormat[]{
  if(kind==="bullet")return Array(LIST_MAX_LEVEL+1).fill("bullet");
  if(kind==="numbered")return Array(LIST_MAX_LEVEL+1).fill("decimal");
  return Array.from({length:LIST_MAX_LEVEL+1},(_,i)=>(["decimal","lowerLetter","lowerRoman"] as const)[i%3]!);
}

const BULLETS=["•","◦","▪"] as const;

function roman(n:number):string{
  const table:Array<[number,string]>=[[1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]];
  let out="",v=n;
  for(const [k,s] of table)while(v>=k){out+=s;v-=k;}
  return out;
}

function letters(n:number):string{
  // a..z, then aa, bb, ... as Word numbers past 26.
  const i=(n-1)%26,repeat=Math.floor((n-1)/26)+1;
  return String.fromCharCode(97+i).repeat(repeat);
}

/** The marker for item number `n` (1-based) at `level` in `format`: "3.", "c.", "iii.", "•". */
export function listMarker(format:ListFormat,n:number,level=0):string{
  if(!Number.isSafeInteger(n)||n<1)throw new RangeError(`List item number must be a positive integer, got ${n}`);
  switch(format){
    case "bullet":return BULLETS[level%BULLETS.length]!;
    case "decimal":return n+".";
    case "lowerLetter":return letters(n)+".";
    case "upperLetter":return letters(n).toUpperCase()+".";
    case "lowerRoman":return roman(n)+".";
    case "upperRoman":return roman(n).toUpperCase()+".";
  }
}

/** Source capability; consumers must check the linked control, not assume a release has it. */
export const BULLETS_NUMBERING_CAPABILITIES=Object.freeze({version:1 as const,authoritativeMarkers:true as const});
/** Maximum UTF-16 code units in one host-supplied, single-line marker. */
export const LIST_PREVIEW_MARKER_MAX=4096;

/** One paragraph of a list. */
export interface ListItemLevel {
  readonly level:number;
}

/** Checks every level is an integer in 0..{@linkcode LIST_MAX_LEVEL}. */
export function validateLevels(items:readonly ListItemLevel[]):void{
  items.forEach((it,i)=>{
    if(!Number.isSafeInteger(it.level)||it.level<0||it.level>LIST_MAX_LEVEL)throw new RangeError(`Item ${i} has invalid level ${it.level}`);
  });
}

/**
 * Markers for consecutive list items. A level's counter restarts whenever a
 * shallower item appears, so "1. a. b. 2. a." numbers the way readers expect.
 */
export function listMarkers(items:readonly ListItemLevel[],formats:readonly ListFormat[]):string[]{
  validateLevels(items);
  const counters=Array<number>(LIST_MAX_LEVEL+1).fill(0);
  return items.map(it=>{
    counters[it.level]!++;
    for(let d=it.level+1;d<=LIST_MAX_LEVEL;d++)counters[d]=0;
    return listMarker(formats[it.level]??"bullet",counters[it.level]!,it.level);
  });
}

/** Optional authoritative text; the empty string intentionally represents no marker. */
export interface ListMarkerItem extends ListItemLevel {readonly marker?:string}
/** Preserve the legacy counter helper while allowing document-owned starts/mixed contexts. */
export function listPreviewMarkers(items:readonly ListMarkerItem[],formats:readonly ListFormat[],kind:ListKind|"mixed"):string[]{
  validateLevels(items);
  for(const item of items){if(item.marker!==undefined&&(typeof item.marker!=="string"||item.marker.length>LIST_PREVIEW_MARKER_MAX||/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(item.marker)))throw new RangeError("Invalid authoritative list preview marker");}
  const defaults=items.some(item=>item.marker===undefined)?(kind==="none"?items.map(()=>""):listMarkers(items,formats)):undefined;
  return items.map((item,index)=>item.marker??defaults![index]!);
}

/**
 * Nesting policy: an item may go at most one level deeper than the item
 * before it, never deeper than {@linkcode LIST_MAX_LEVEL}, and the first item
 * stays at level 0. Applies to the range `[from, to]` as one block.
 */
export function canIndent(items:readonly ListItemLevel[],from:number,to=from):boolean{
  if(from<=0||to<from||to>=items.length)return false;
  const prev=items[from-1]!.level;
  for(let i=from;i<=to;i++)if(items[i]!.level>=LIST_MAX_LEVEL)return false;
  return items[from]!.level+1<=prev+1;
}

/** An outdent is allowed when every item in `[from, to]` is below level 0. */
export function canOutdent(items:readonly ListItemLevel[],from:number,to=from):boolean{
  if(from<0||to<from||to>=items.length)return false;
  for(let i=from;i<=to;i++)if(items[i]!.level<=0)return false;
  return true;
}

/** New levels after indenting (+1) or outdenting (-1) `[from, to]`; throws when the policy forbids it. */
export function shiftLevels<T extends ListItemLevel>(items:readonly T[],from:number,to:number,direction:1|-1):T[]{
  const ok=direction>0?canIndent(items,from,to):canOutdent(items,from,to);
  if(!ok)throw new RangeError(direction>0?"Cannot indent these items further":"These items are already at the first level");
  return items.map((it,i)=>i>=from&&i<=to?{...it,level:it.level+direction}:it);
}

/** Spoken name of a format, e.g. "1, 2, 3". */
export function formatLabel(format:ListFormat):string{
  return {bullet:"Bullet",decimal:"1, 2, 3",lowerLetter:"a, b, c",upperLetter:"A, B, C",lowerRoman:"i, ii, iii",upperRoman:"I, II, III"}[format];
}
