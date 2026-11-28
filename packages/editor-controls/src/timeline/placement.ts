import type {FrameRate} from "../timebase.ts";
import {framesToSeconds} from "./time.ts";
import {
  clipLength,compatibleKinds,fitsOnTrack,
  type MoveMode,type RippleScope,type TimelineClip,type TimelineEdit,type TimelineTrack,
} from "./edits.ts";

/**
 * Where a dragged clip lands (D-22): which track, and whether it fits there.
 * A strict move must fit between the clips already on the target. An
 * `insert` or `overwrite` always fits, because the engine resolves the clips
 * it meets (Splice `moveClip` with `mode`); only a locked or incompatible
 * target is refused.
 */
export interface Placement {
  readonly trackId:string;
  readonly startFrame:number;
  readonly valid:boolean;
  readonly problem?:"overlap"|"locked"|"kind";
}

/**
 * The track `laneOffset` lanes away from `fromTrackId` in `tracks` order,
 * clamped to the list. Returns the origin when the offset is 0.
 */
export function trackAtOffset(tracks:readonly TimelineTrack[],fromTrackId:string,laneOffset:number):TimelineTrack|undefined{
  const i=tracks.findIndex(t=>t.id===fromTrackId);
  if(i<0)return undefined;
  return tracks[Math.min(tracks.length-1,Math.max(0,i+Math.round(laneOffset)))];
}

/** Whether `clip` from `from` may land on `target` at `startFrame` under `mode`. */
export function placementPreview(from:TimelineTrack,target:TimelineTrack,clip:TimelineClip,startFrame:number,mode?:MoveMode):Placement{
  const base={trackId:target.id,startFrame};
  if(from.locked||target.locked)return {...base,valid:false,problem:"locked"};
  if(!compatibleKinds(from.kind,target.kind))return {...base,valid:false,problem:"kind"};
  if(mode)return {...base,valid:true};
  return fitsOnTrack(target,startFrame,clipLength(clip),clip.id)?{...base,valid:true}:{...base,valid:false,problem:"overlap"};
}

/** The `move` edit for a valid placement, or `undefined` when nothing changes. */
export function placementEdit(clip:TimelineClip,from:TimelineTrack,p:Placement,rate:FrameRate,mode?:MoveMode,scope:RippleScope="track"):TimelineEdit|undefined{
  if(!p.valid)return undefined;
  const crosses=p.trackId!==from.id;
  if(!crosses&&p.startFrame===clip.startFrame)return undefined;
  return {kind:"move",clipId:clip.id,trackId:from.id,startFrame:p.startFrame,startSeconds:framesToSeconds(p.startFrame,rate),
    ...(crosses?{targetTrackId:p.trackId}:{}),...(mode?{mode}:{}),...(mode==="insert"?{scope}:{})};
}
