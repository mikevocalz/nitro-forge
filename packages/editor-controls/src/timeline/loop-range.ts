import type {FrameRate} from "../timebase.ts";
import {framesToSeconds} from "./time.ts";
import type {InOutRange} from "./edits.ts";

/**
 * The playback loop (D-13): `[inFrame, outFrame)`, at least one frame long.
 * The range is document state (Splice `setLoopRange` / `clearLoopRange`);
 * whether the player is looping is player state the host owns.
 */
export interface LoopRange {
  readonly inFrame:number;
  readonly outFrame:number;
}
/** A loop range with the seconds Splice stores. */
export interface LoopCommit extends LoopRange {
  readonly inSeconds:number;
  readonly outSeconds:number;
}

/**
 * `range` with one end moved to `frame`, clamped to `[0, durationFrames]`. An
 * end pushed past the other stops one frame short of it, so the loop never
 * empties or flips.
 */
export function setLoopEdge(range:LoopRange,edge:"in"|"out",frame:number,durationFrames:number):LoopRange{
  if(!Number.isSafeInteger(durationFrames)||durationFrames<1)throw new RangeError("A loop needs a timeline at least one frame long");
  const f=Math.min(durationFrames,Math.max(0,Math.round(frame)));
  return edge==="in"?{inFrame:Math.min(f,range.outFrame-1),outFrame:range.outFrame}:{inFrame:range.inFrame,outFrame:Math.max(f,range.inFrame+1)};
}

/** The loop for an in/out selection, with unset marks at the timeline's ends; `undefined` if it would be empty. */
export function loopFromMarks(marks:InOutRange,durationFrames:number):LoopRange|undefined{
  const inFrame=marks.inFrame??0,outFrame=marks.outFrame??durationFrames;
  if(marks.inFrame===undefined&&marks.outFrame===undefined)return undefined;
  return outFrame>inFrame?{inFrame,outFrame}:undefined;
}

/** `range` with seconds for the engine. */
export function loopCommit(range:LoopRange,rate:FrameRate):LoopCommit{
  if(!(range.outFrame>range.inFrame))throw new RangeError("Loop out must be after loop in");
  return {...range,inSeconds:framesToSeconds(range.inFrame,rate),outSeconds:framesToSeconds(range.outFrame,rate)};
}

/** Where looped playback goes after `frame`: back to the in-point once it reaches the out-point. */
export function loopNext(frame:number,range:LoopRange|undefined,looping:boolean):number{
  if(!looping||!range)return frame;
  return frame>=range.outFrame||frame<range.inFrame?range.inFrame:frame;
}
