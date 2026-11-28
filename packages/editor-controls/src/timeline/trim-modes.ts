import type {FrameRate} from "../timebase.ts";
import {
  clipEnd,clipLength,deltaSeconds,fitsOnTrack,
  type RippleScope,type TimelineClip,type TimelineEdit,type TimelineTrack,
} from "./edits.ts";

/**
 * Slip, slide, roll and ripple trim (D-21), as pure previews. Each takes a
 * whole-frame delta and returns the clips it would change plus `valid`; the
 * matching `*Edit` turns a valid preview into one `TimelineEdit`. The rules
 * mirror the engine's (Splice `slipClip`, `slideClip`, `rollEdit`,
 * `rippleTrim`) so an invalid preview never reaches it.
 */

/** Why a preview cannot be committed. */
export type TrimModeProblem="overlap"|"media"|"length"|"locked"|"adjacent";
/** What each {@linkcode TrimModeProblem} reads as under the clip. */
export const TRIM_MODE_PROBLEM_TEXT:Readonly<Record<TrimModeProblem,string>>={
  overlap:"Overlaps another clip",media:"Not enough media",length:"Clip needs at least one frame",
  locked:"Track locked",adjacent:"No touching clip to roll with",
};
/** A clip's position and media span after an edit. */
export interface ClipGeometry {
  readonly startFrame:number;
  readonly sourceIn:number;
  readonly sourceOut:number;
}
/** Result of every preview here: the changed clips by id, keyed to their new geometry. */
export interface TrimModePreview {
  readonly delta:number;
  readonly clips:Readonly<Record<string,ClipGeometry>>;
  readonly valid:boolean;
  readonly problem?:TrimModeProblem;
}

const EPS=1e-9;
const geo=(c:TimelineClip):ClipGeometry=>({startFrame:c.startFrame,sourceIn:c.sourceIn,sourceOut:c.sourceOut});
const lenOf=(c:TimelineClip,g:ClipGeometry)=>(g.sourceOut-g.sourceIn)/c.speed;
const mediaOk=(c:TimelineClip,g:ClipGeometry)=>g.sourceIn>=-EPS&&(c.sourceDuration===undefined||g.sourceOut<=c.sourceDuration+EPS);
const fail=(delta:number,clips:Record<string,ClipGeometry>,problem:TrimModeProblem):TrimModePreview=>({delta,clips,valid:false,problem});
const whole=(d:number)=>{if(!Number.isSafeInteger(d))throw new RangeError("Delta must be a whole number of frames");return d;};

/** The clip on `track` whose end touches `clip`'s start. */
export const previousTouching=(track:TimelineTrack,clip:TimelineClip)=>
  track.clips.find(c=>c.id!==clip.id&&Math.abs(clipEnd(c)-clip.startFrame)<EPS);
/** The clip on `track` whose start touches `clip`'s end. */
export const nextTouching=(track:TimelineTrack,clip:TimelineClip)=>
  track.clips.find(c=>c.id!==clip.id&&Math.abs(c.startFrame-clipEnd(clip))<EPS);

/** Media frames a clip can slip each way before running out of source. */
export function slipLimits(clip:TimelineClip):{min:number;max:number}{
  return {min:-Math.floor(clip.sourceIn+EPS),max:clip.sourceDuration===undefined?Number.MAX_SAFE_INTEGER:Math.floor(clip.sourceDuration-clip.sourceOut+EPS)};
}
/** Slip: in and out both move `delta` media frames; the clip keeps its place and length. */
export function slipPreview(track:TimelineTrack,clip:TimelineClip,delta:number):TrimModePreview{
  whole(delta);
  const g={startFrame:clip.startFrame,sourceIn:clip.sourceIn+delta,sourceOut:clip.sourceOut+delta};
  const clips={[clip.id]:g};
  if(track.locked)return fail(delta,clips,"locked");
  if(!mediaOk(clip,g))return fail(delta,clips,"media");
  return {delta,clips,valid:true};
}

/**
 * Slide: the clip moves `delta` frames. A clip touching its start gives up or
 * gains tail media, a clip touching its end gives up or gains head media, so
 * the sequence length stays the same. Sides with no touching neighbour only
 * need free space.
 */
export function slidePreview(track:TimelineTrack,clip:TimelineClip,delta:number):TrimModePreview{
  whole(delta);
  const prev=previousTouching(track,clip),next=nextTouching(track,clip);
  const clips:Record<string,ClipGeometry>={[clip.id]:{...geo(clip),startFrame:clip.startFrame+delta}};
  if(prev)clips[prev.id]={...geo(prev),sourceOut:prev.sourceOut+delta*prev.speed};
  if(next)clips[next.id]={startFrame:next.startFrame+delta,sourceIn:next.sourceIn+delta*next.speed,sourceOut:next.sourceOut};
  if(track.locked)return fail(delta,clips,"locked");
  if(clip.startFrame+delta<0)return fail(delta,clips,"overlap");
  for(const n of [prev,next])if(n){
    const g=clips[n.id]!;
    if(lenOf(n,g)<1-EPS)return fail(delta,clips,"length");
    if(!mediaOk(n,g))return fail(delta,clips,"media");
  }
  const len=clipLength(clip);
  const others={...track,clips:track.clips.filter(c=>c.id!==prev?.id&&c.id!==next?.id)};
  if(!fitsOnTrack(others,clip.startFrame+delta,len,clip.id))return fail(delta,clips,"overlap");
  return {delta,clips,valid:true};
}

/** Roll: the cut between touching `left` and `right` moves `delta` frames; the pair's total length stays. */
export function rollPreview(track:TimelineTrack,left:TimelineClip,right:TimelineClip,delta:number):TrimModePreview{
  whole(delta);
  const clips:Record<string,ClipGeometry>={
    [left.id]:{...geo(left),sourceOut:left.sourceOut+delta*left.speed},
    [right.id]:{startFrame:right.startFrame+delta,sourceIn:right.sourceIn+delta*right.speed,sourceOut:right.sourceOut},
  };
  if(track.locked)return fail(delta,clips,"locked");
  if(Math.abs(clipEnd(left)-right.startFrame)>EPS)return fail(delta,clips,"adjacent");
  for(const c of [left,right]){
    const g=clips[c.id]!;
    if(lenOf(c,g)<1-EPS)return fail(delta,clips,"length");
    if(!mediaOk(c,g))return fail(delta,clips,"media");
  }
  return {delta,clips,valid:true};
}

/** The tracks a ripple on `track` shifts. Locked tracks never move. */
export const rippleTracks=(tracks:readonly TimelineTrack[],track:TimelineTrack,scope:RippleScope)=>
  scope==="all"?tracks.filter(t=>t.id===track.id||!t.locked):[track];

/**
 * Shift every clip starting at or after `from` by `shift` on the ripple
 * tracks (except `exceptId`), and report overlaps with clips that stay.
 */
function rippleShift(tracks:readonly TimelineTrack[],track:TimelineTrack,scope:RippleScope,from:number,shift:number,
  exceptId:string,clips:Record<string,ClipGeometry>):TrimModeProblem|undefined{
  for(const t of rippleTracks(tracks,track,scope)){
    const moved=t.clips.filter(c=>c.id!==exceptId&&c.startFrame>=from-EPS);
    for(const c of moved){
      const start=c.startFrame+shift;
      if(start<-EPS)return "overlap";
      clips[c.id]={...geo(c),startFrame:start};
    }
    // Clips that stay put on this track (other than the edited one) must not meet a shifted clip.
    const stay=t.clips.filter(c=>c.id!==exceptId&&!(c.startFrame>=from-EPS));
    for(const c of moved){
      const g=clips[c.id]!;
      if(!fitsOnTrack({...t,clips:stay},g.startFrame,clipLength(c)))return "overlap";
    }
  }
  return undefined;
}

/**
 * Ripple trim one edge by `delta` frames (positive is later). The clip keeps
 * its start either way; a head trim changes its in-point. Clips after its old
 * end shift by the change in length, on `scope`'s tracks.
 */
export function rippleTrimPreview(tracks:readonly TimelineTrack[],track:TimelineTrack,clip:TimelineClip,edge:"head"|"tail",delta:number,scope:RippleScope):TrimModePreview{
  whole(delta);
  const g=edge==="tail"?{...geo(clip),sourceOut:clip.sourceOut+delta*clip.speed}:{...geo(clip),sourceIn:clip.sourceIn+delta*clip.speed};
  const clips:Record<string,ClipGeometry>={[clip.id]:g};
  if(track.locked)return fail(delta,clips,"locked");
  if(lenOf(clip,g)<1-EPS)return fail(delta,clips,"length");
  if(!mediaOk(clip,g))return fail(delta,clips,"media");
  const problem=rippleShift(tracks,track,scope,clipEnd(clip),edge==="tail"?delta:-delta,clip.id,clips);
  return problem?fail(delta,clips,problem):{delta,clips,valid:true};
}

/**
 * Ripple delete: the clip goes and later clips on `scope`'s tracks close the
 * gap. The preview lists the shifted clips; the removed one is absent.
 */
export function rippleDeletePreview(tracks:readonly TimelineTrack[],track:TimelineTrack,clip:TimelineClip,scope:RippleScope):TrimModePreview{
  const clips:Record<string,ClipGeometry>={};
  if(track.locked)return fail(0,clips,"locked");
  const problem=rippleShift(tracks,track,scope,clipEnd(clip),-clipLength(clip),clip.id,clips);
  return problem?fail(0,clips,problem):{delta:0,clips,valid:true};
}

const delta=(p:TrimModePreview,rate:FrameRate)=>({deltaFrames:p.delta,deltaSeconds:deltaSeconds(p.delta,rate)});
/** The `slip` edit for a valid preview with a nonzero delta. */
export const slipEdit=(clip:TimelineClip,trackId:string,p:TrimModePreview,rate:FrameRate):TimelineEdit|undefined=>
  p.valid&&p.delta!==0?{kind:"slip",clipId:clip.id,trackId,...delta(p,rate)}:undefined;
/** The `slide` edit for a valid preview with a nonzero delta. */
export const slideEdit=(clip:TimelineClip,trackId:string,p:TrimModePreview,rate:FrameRate):TimelineEdit|undefined=>
  p.valid&&p.delta!==0?{kind:"slide",clipId:clip.id,trackId,...delta(p,rate)}:undefined;
/** The `roll` edit for a valid preview with a nonzero delta. */
export const rollEdit=(left:TimelineClip,right:TimelineClip,trackId:string,p:TrimModePreview,rate:FrameRate):TimelineEdit|undefined=>
  p.valid&&p.delta!==0?{kind:"roll",leftClipId:left.id,rightClipId:right.id,trackId,...delta(p,rate)}:undefined;
/** The `rippleTrim` edit for a valid preview with a nonzero delta. */
export const rippleTrimEdit=(clip:TimelineClip,trackId:string,edge:"head"|"tail",scope:RippleScope,p:TrimModePreview,rate:FrameRate):TimelineEdit|undefined=>
  p.valid&&p.delta!==0?{kind:"rippleTrim",clipId:clip.id,trackId,edge,scope,...delta(p,rate)}:undefined;

/**
 * Roll at one edge of `clip`: its tail rolls with the clip after it, its head
 * with the clip before it. `undefined` when nothing touches that edge.
 */
export function rollPair(track:TimelineTrack,clip:TimelineClip,edge:"head"|"tail"):{left:TimelineClip;right:TimelineClip}|undefined{
  if(edge==="tail"){const right=nextTouching(track,clip);return right?{left:clip,right}:undefined;}
  const left=previousTouching(track,clip);
  return left?{left,right:clip}:undefined;
}
