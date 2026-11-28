import type {FrameRate} from "../timebase.ts";
import {framesToSeconds} from "./time.ts";
import {clipLength,fitsOnTrack,type RippleScope,type TimelineClip,type TimelineTrack} from "./edits.ts";

/**
 * One change in a batch (D-41). A Forge adapter sends the whole list as one
 * engine batch (Splice `batch {ops}`), so it applies all or nothing and is one
 * undo step. Edits come ordered so that applying them one after another never
 * overlaps clips midway: moves later in time go latest-first, earlier
 * moves earliest-first, and ripple deletes latest-first.
 */
export type BatchEdit=
  |{readonly kind:"move";readonly clipId:string;readonly startFrame:number;readonly startSeconds:number}
  |{readonly kind:"speed";readonly clipId:string;readonly speed:number}
  |{readonly kind:"remove";readonly clipId:string}
  |{readonly kind:"rippleDelete";readonly clipId:string;readonly scope:RippleScope};

/** A batch, or the reason it cannot be applied. */
export type BatchResult=
  |{readonly valid:true;readonly edits:readonly BatchEdit[]}
  |{readonly valid:false;readonly reason:string};

/** Clip speed limits Splice accepts (`setSpeed`). */
export const SPEED_RANGE={min:0.1,max:10} as const;

type Located={track:TimelineTrack;clip:TimelineClip};
/** The selected clips that still exist, earliest first. */
export function selectedClips(tracks:readonly TimelineTrack[],ids:readonly string[]):Located[]{
  const want=new Set(ids);
  return tracks.flatMap(track=>track.clips.filter(c=>want.has(c.id)).map(clip=>({track,clip})))
    .sort((a,b)=>a.clip.startFrame-b.clip.startFrame||(a.clip.id<b.clip.id?-1:1));
}
const lockedIn=(sel:Located[])=>sel.find(s=>s.track.locked);
const none=(sel:Located[]):BatchResult|undefined=>!sel.length?{valid:false,reason:"Select clips first"}
  :lockedIn(sel)?{valid:false,reason:`${lockedIn(sel)!.track.label} is locked`}:undefined;

/** Shift every selected clip by `deltaFrames`, refusing overlaps with clips that stay. */
export function batchShift(tracks:readonly TimelineTrack[],ids:readonly string[],deltaFrames:number,rate:FrameRate):BatchResult{
  const sel=selectedClips(tracks,ids);
  const bad=none(sel);if(bad)return bad;
  if(!Number.isSafeInteger(deltaFrames))return {valid:false,reason:"Enter a whole number of frames"};
  if(deltaFrames===0)return {valid:false,reason:"Enter a shift other than 0"};
  const moving=new Set(ids);
  for(const {track,clip} of sel){
    const start=clip.startFrame+deltaFrames;
    if(start<0)return {valid:false,reason:`${clip.label??"A clip"} would start before 0`};
    const stay={...track,clips:track.clips.filter(c=>!moving.has(c.id))};
    if(!fitsOnTrack(stay,start,clipLength(clip)))return {valid:false,reason:`${clip.label??"A clip"} would overlap another clip`};
  }
  const order=deltaFrames>0?[...sel].reverse():sel;
  return {valid:true,edits:order.map(({clip})=>{
    const startFrame=clip.startFrame+deltaFrames;
    return {kind:"move",clipId:clip.id,startFrame,startSeconds:framesToSeconds(startFrame,rate)};
  })};
}

/** Set every selected clip's speed. Starts stay; a clip that grows must not reach the next clip. */
export function batchSpeed(tracks:readonly TimelineTrack[],ids:readonly string[],speed:number):BatchResult{
  const sel=selectedClips(tracks,ids);
  const bad=none(sel);if(bad)return bad;
  if(!Number.isFinite(speed)||speed<SPEED_RANGE.min||speed>SPEED_RANGE.max)
    return {valid:false,reason:`Speed must be between ${SPEED_RANGE.min}x and ${SPEED_RANGE.max}x`};
  // Starts stay put, so the new layout is every selected clip at its new length.
  const want=new Set(ids);
  for(const {track,clip} of sel){
    const after={...track,clips:track.clips.map(c=>want.has(c.id)?{...c,speed}:c)};
    if(!fitsOnTrack(after,clip.startFrame,(clip.sourceOut-clip.sourceIn)/speed,clip.id))
      return {valid:false,reason:`${clip.label??"A clip"} would overlap the next clip at ${speed}x`};
  }
  // Slower clips grow, so the ones that shrink go first.
  const grows=(c:TimelineClip)=>speed<c.speed;
  const order=[...sel.filter(s=>!grows(s.clip)),...sel.filter(s=>grows(s.clip))];
  return {valid:true,edits:order.map(({clip})=>({kind:"speed",clipId:clip.id,speed}))};
}

/** Remove every selected clip, leaving gaps. */
export function batchRemove(tracks:readonly TimelineTrack[],ids:readonly string[]):BatchResult{
  const sel=selectedClips(tracks,ids);
  const bad=none(sel);if(bad)return bad;
  return {valid:true,edits:sel.map(({clip})=>({kind:"remove",clipId:clip.id}))};
}

/** Ripple delete every selected clip, latest first so each delete leaves the earlier ones where they were. */
export function batchRippleDelete(tracks:readonly TimelineTrack[],ids:readonly string[],scope:RippleScope):BatchResult{
  const sel=selectedClips(tracks,ids);
  const bad=none(sel);if(bad)return bad;
  // With scope "all", locked tracks hold still; the engine refuses the whole batch if that overlaps.
  return {valid:true,edits:[...sel].reverse().map(({clip})=>({kind:"rippleDelete",clipId:clip.id,scope}))};
}
