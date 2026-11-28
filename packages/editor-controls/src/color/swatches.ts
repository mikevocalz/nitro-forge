import {rgbaToHex,type RgbaColor} from "../color.ts";

/** One color in a {@linkcode SwatchGroup}. */
export interface Swatch {
  /** Stable key, unique within its group. */
  readonly id:string;
  readonly color:RgbaColor;
  /** Shown to screen readers and matched by search. Hex is used when absent. */
  readonly name?:string;
}
/** Where a {@linkcode SwatchGroup}'s colors come from; it picks the group's empty-state text. */
export type SwatchGroupKind="recent"|"document"|"saved"|"named";
/** A titled section of `SwatchGrid`. The host owns and persists every group. */
export interface SwatchGroup {
  readonly id:string;
  readonly label:string;
  readonly kind:SwatchGroupKind;
  readonly swatches:readonly Swatch[];
}

/** Hex key used for search and duplicate checks: `#RRGGBBAA`. */
export const swatchKey=(s:Swatch)=>rgbaToHex(s.color);

/**
 * Groups filtered by `query`: a case-insensitive substring of the swatch name,
 * or a hex prefix with or without `#` (`1f5` matches the hex key 1F5FD1FF). An empty
 * query returns every group unchanged, empty groups included; a non-empty query
 * drops groups with no match.
 */
export function filterSwatchGroups(groups:readonly SwatchGroup[],query:string):SwatchGroup[]{
  const q=query.trim().toLowerCase();
  if(!q)return [...groups];
  const hex=q.replace(/^#/,"");
  const isHex=/^[0-9a-f]+$/.test(hex);
  return groups.map(g=>({...g,swatches:g.swatches.filter(s=>
    (s.name?.toLowerCase().includes(q)??false)||(isHex&&swatchKey(s).slice(1).toLowerCase().startsWith(hex)))}))
    .filter(g=>g.swatches.length>0);
}

/**
 * A recent-colors list with `color` moved or added to the front, duplicates
 * (same `#RRGGBBAA`) removed and the list cut to `limit`. Ids are the hex key.
 */
export function pushRecentSwatch(recent:readonly Swatch[],color:RgbaColor,limit=12):Swatch[]{
  if(!Number.isSafeInteger(limit)||limit<1)throw new RangeError("Recent swatch limit must be a positive integer");
  const next:Swatch={id:rgbaToHex(color),color};
  return [next,...recent.filter(s=>swatchKey(s)!==next.id)].slice(0,limit);
}

/** Columns that fit `width` with square `cell` swatches separated by `gap`; at least 1. */
export function swatchColumns(width:number,cell=44,gap=6):number{
  if(!Number.isFinite(width)||width<=0)return 1;
  return Math.max(1,Math.floor((width+gap)/(cell+gap)));
}

/**
 * Next focused index in a row-major grid of `count` swatches, `columns` wide, or
 * `undefined` for keys the grid does not handle. Left/Right flip under `rtl`
 * because the rows are laid out right to left.
 */
export function swatchGridMove(index:number,key:string|undefined,columns:number,count:number,rtl=false):number|undefined{
  if(count<=0)return undefined;
  const clamp=(n:number)=>Math.max(0,Math.min(count-1,n));
  switch(key){
    case "ArrowRight":return clamp(index+(rtl?-1:1));
    case "ArrowLeft":return clamp(index+(rtl?1:-1));
    case "ArrowDown":return index+columns<count?index+columns:index;
    case "ArrowUp":return index-columns>=0?index-columns:index;
    case "Home":return 0;
    case "End":return count-1;
    default:return undefined;
  }
}
