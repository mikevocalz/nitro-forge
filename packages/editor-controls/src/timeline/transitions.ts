import type {FrameRate} from "../timebase.ts";
import {framesToSeconds} from "./time.ts";
import {clipEnd,clipLength,type TimelineClip,type TimelineTrack} from "./edits.ts";

/**
 * A transition centered on the cut between two touching clips (D-23). Half
 * the duration plays over the end of `leftClipId` and half over the start of
 * `rightClipId`, using media past each clip's edge. Splice stores it
 * (`addTransition`) and drops it when an edit separates the clips or eats
 * their handles.
 */
export interface TimelineTransition {
  readonly id:string;
  readonly trackId:string;
  readonly leftClipId:string;
  readonly rightClipId:string;
  /** One of the host's transition kinds, e.g. `cross_dissolve`. */
  readonly kind:string;
  readonly durationFrames:number;
}
/** A cut: two clips on one track whose edges touch. */
export interface TimelineCut {
  readonly trackId:string;
  readonly leftClipId:string;
  readonly rightClipId:string;
  /** The frame the clips meet at. */
  readonly frame:number;
}
/** What {@linkcode TransitionHandlesProps.onAdd} receives. */
export interface TransitionRequest {
  readonly trackId:string;
  readonly leftClipId:string;
  readonly rightClipId:string;
  readonly kind:string;
  readonly durationFrames:number;
  readonly durationSeconds:number;
}

/** Which kinds a cut accepts: audio tracks take a crossfade, video and overlay tracks the visual kinds. */
export type TransitionTarget="visual"|"audio";
export const transitionTarget=(track:TimelineTrack):TransitionTarget=>track.kind==="audio"?"audio":"visual";
/** The only kind an audio cut takes. */
export const AUDIO_CROSSFADE="cross_fade";

const EPS=1e-9;

/** Every cut on `track`, left to right. */
export function cutsOf(track:TimelineTrack):TimelineCut[]{
  const sorted=[...track.clips].sort((a,b)=>a.startFrame-b.startFrame);
  const out:TimelineCut[]=[];
  for(let i=1;i<sorted.length;i++){
    const l=sorted[i-1]!,r=sorted[i]!;
    if(Math.abs(clipEnd(l)-r.startFrame)<EPS)out.push({trackId:track.id,leftClipId:l.id,rightClipId:r.id,frame:r.startFrame});
  }
  return out;
}

/**
 * Longest transition the cut allows, in whole frames: twice the smallest of
 * the left clip's media after its out-point, the right clip's media before its
 * in-point (both in timeline frames at the clip's speed) and the two clips'
 * lengths. A left clip with no known source length has no tail handle to
 * spend, so it allows 0.
 */
export function maxTransitionFrames(left:TimelineClip,right:TimelineClip):number{
  const leftHandle=left.sourceDuration===undefined?0:(left.sourceDuration-left.sourceOut)/left.speed;
  const rightHandle=right.sourceIn/right.speed;
  const half=Math.min(leftHandle,rightHandle,clipLength(left),clipLength(right));
  return Math.max(0,Math.floor(2*half+EPS));
}

/** The transition at `cut`, if any. */
export const transitionAt=(transitions:readonly TimelineTransition[],cut:TimelineCut)=>
  transitions.find(t=>t.leftClipId===cut.leftClipId&&t.rightClipId===cut.rightClipId);

/** `durationFrames` clamped to `[1, max]`, or `undefined` when the cut allows none. */
export function clampTransitionFrames(durationFrames:number,max:number):number|undefined{
  if(max<1)return undefined;
  return Math.min(max,Math.max(1,Math.round(durationFrames)));
}

/** The add request for `cut`, clamped to what it allows; `undefined` when it allows none. */
export function transitionRequest(cut:TimelineCut,tracks:readonly TimelineTrack[],kind:string,durationFrames:number,rate:FrameRate):TransitionRequest|undefined{
  const pair=clipsOfCut(tracks,cut);
  if(!pair)return undefined;
  const frames=clampTransitionFrames(durationFrames,maxTransitionFrames(pair.left,pair.right));
  if(frames===undefined)return undefined;
  return {trackId:cut.trackId,leftClipId:cut.leftClipId,rightClipId:cut.rightClipId,kind,durationFrames:frames,durationSeconds:framesToSeconds(frames,rate)};
}

/** The two clips of `cut`, when both still exist on its track. */
export function clipsOfCut(tracks:readonly TimelineTrack[],cut:TimelineCut):{track:TimelineTrack;left:TimelineClip;right:TimelineClip}|undefined{
  const track=tracks.find(t=>t.id===cut.trackId);
  const left=track?.clips.find(c=>c.id===cut.leftClipId),right=track?.clips.find(c=>c.id===cut.rightClipId);
  return track&&left&&right?{track,left,right}:undefined;
}
