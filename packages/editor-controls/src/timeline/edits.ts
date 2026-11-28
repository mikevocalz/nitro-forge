import type {FrameRate} from "../timebase.ts";
import {framesToSeconds,positionToSeconds} from "./time.ts";
import type {FrameRange} from "./viewport.ts";

/**
 * A clip as the timeline draws it. Timeline positions are whole frames at the
 * sequence rate. `sourceIn`/`sourceOut` are media positions in frames at the
 * same rate; they can be fractional when `speed` is not 1, because the engine
 * stores media time as seconds.
 */
export interface TimelineClip {
  readonly id:string;
  readonly startFrame:number;
  readonly sourceIn:number;
  readonly sourceOut:number;
  /** Playback speed; the clip covers `(sourceOut - sourceIn) / speed` timeline frames. */
  readonly speed:number;
  /** Length of the source media in frames, which bounds trims. Unbounded when absent. */
  readonly sourceDuration?:number;
  readonly label?:string;
}
/**
 * Kind of media a {@linkcode TimelineTrack} holds. `overlay` is picture over
 * the video tracks; it takes the same clips as `video`.
 */
export type TrackKind="video"|"overlay"|"audio";
/** One lane of clips. Clips on a track never overlap. */
export interface TimelineTrack {
  readonly id:string;
  readonly kind:TrackKind;
  readonly label:string;
  readonly clips:readonly TimelineClip[];
  /** Locked tracks refuse every edit (Splice `setTrackFlags`). */
  readonly locked?:boolean;
  /** Video and overlay tracks only: left out of the picture. */
  readonly hidden?:boolean;
  /** Audio tracks only. */
  readonly muted?:boolean;
  /** Audio tracks only. When any track is soloed, only soloed audio plays. */
  readonly solo?:boolean;
}
/** Whether clips can move between tracks of these kinds: audio with audio, video with overlay. */
export const compatibleKinds=(a:TrackKind,b:TrackKind)=>(a==="audio")===(b==="audio");
/** Whether the track's output is off: hidden, muted, or silent because another audio track is soloed. */
export function trackSilenced(track:TimelineTrack,tracks:readonly TimelineTrack[]):boolean{
  if(track.kind!=="audio")return track.hidden===true;
  if(tracks.some(t=>t.kind==="audio"&&t.solo))return track.solo!==true;
  return track.muted===true;
}

/** Which tracks a ripple shifts: the clip's own, or every unlocked track. */
export type RippleScope="track"|"all";
/**
 * How a move lands on clips already there. `insert` splits a clip under the
 * drop point and pushes later clips right; `overwrite` trims, splits or removes
 * what it covers. Without a mode a move that would overlap is refused.
 */
export type MoveMode="insert"|"overwrite";

/**
 * One finished edit gesture, emitted once on release, key press or
 * screen-reader action. Frames are for the UI; the `*Seconds` fields are the
 * same positions at the sequence rate for engines that store seconds (Splice's
 * `moveClip(id, start_s)`, `trimClip(id, in_s, out_s)` and
 * `splitClip(id, at_s)`).
 */
export type TimelineEdit=
  |{
    readonly kind:"move";readonly clipId:string;readonly trackId:string;readonly startFrame:number;readonly startSeconds:number;
    /** Splice `moveClip(id, start_s, {mode})`. Absent: a strict move that never overlaps. */
    readonly mode?:MoveMode;
    /** Set when the clip changes track (`moveClip` `track`). */
    readonly targetTrackId?:string;
    /** Ripple scope for an `insert`. */
    readonly scope?:RippleScope;
  }
  |{
    readonly kind:"trim";readonly clipId:string;readonly trackId:string;readonly edge:"head"|"tail";
    readonly startFrame:number;readonly startSeconds:number;
    readonly sourceIn:number;readonly sourceOut:number;readonly inSeconds:number;readonly outSeconds:number;
    /**
     * Apply order that never overlaps a neighbour midway, for engines whose trim
     * keeps the clip's start fixed (Splice): `trim-only` for a tail trim,
     * `trim-then-move` when the head moves later, `move-then-trim` when it moves
     * earlier. Apply both steps inside one undo group.
     */
    readonly order:"trim-only"|"trim-then-move"|"move-then-trim";
  }
  |{readonly kind:"split";readonly clipId:string;readonly trackId:string;readonly atFrame:number;readonly atSeconds:number}
  /** Both media points shift by the delta, in media time; the clip stays put (Splice `slipClip`). */
  |{readonly kind:"slip";readonly clipId:string;readonly trackId:string;readonly deltaFrames:number;readonly deltaSeconds:number}
  /** The clip moves on the timeline; touching neighbours give and take media (Splice `slideClip`). */
  |{readonly kind:"slide";readonly clipId:string;readonly trackId:string;readonly deltaFrames:number;readonly deltaSeconds:number}
  /** The cut between two touching clips moves by the delta (Splice `rollEdit`). */
  |{readonly kind:"roll";readonly leftClipId:string;readonly rightClipId:string;readonly trackId:string;readonly deltaFrames:number;readonly deltaSeconds:number}
  /**
   * One edge moves by the delta (positive is later) and later clips follow
   * (Splice `rippleTrim`). A head trim keeps the clip's start, so later clips
   * shift by minus the delta; a tail trim shifts them by the delta.
   */
  |{readonly kind:"rippleTrim";readonly clipId:string;readonly trackId:string;readonly edge:"head"|"tail";readonly deltaFrames:number;readonly deltaSeconds:number;readonly scope:RippleScope}
  /** Remove the clip and close its gap (Splice `rippleDelete`). */
  |{readonly kind:"rippleDelete";readonly clipId:string;readonly trackId:string;readonly scope:RippleScope};

const EPS=1e-9;

export function assertClip(c:TimelineClip):void{
  if(!Number.isSafeInteger(c.startFrame)||c.startFrame<0)throw new RangeError("Clip start must be a nonnegative whole frame");
  if(![c.sourceIn,c.sourceOut,c.speed].every(Number.isFinite)||c.sourceIn<0||c.sourceOut<=c.sourceIn||c.speed<=0)
    throw new RangeError("Clip needs 0 <= sourceIn < sourceOut and a positive speed");
}
/** Timeline frames the clip covers. */
export function clipLength(c:TimelineClip):number{
  assertClip(c);
  return (c.sourceOut-c.sourceIn)/c.speed;
}
/** First frame after the clip. Fractional when the speed does not divide the span. */
export const clipEnd=(c:TimelineClip)=>c.startFrame+clipLength(c);

/**
 * Whether `[start, start + length)` is free on `track`, ignoring `exceptId`.
 * Touching edges are allowed, as the engine allows them.
 */
export function fitsOnTrack(track:TimelineTrack,start:number,length:number,exceptId?:string):boolean{
  return track.clips.every(c=>c.id===exceptId||start+length<=c.startFrame+EPS||start>=clipEnd(c)-EPS);
}

/** Clips on `track` that intersect the visible `range`, so dense lanes only mount what shows. */
export function visibleClips(track:TimelineTrack,range:FrameRange):TimelineClip[]{
  return track.clips.filter(c=>c.startFrame<range.end&&clipEnd(c)>range.start);
}

/** Result of {@linkcode snapFrame}. */
export interface Snap {
  readonly frame:number;
  /** The target it snapped to, if any. */
  readonly target?:number;
}
/** `frame` moved to the nearest of `targets` within `threshold` frames. */
export function snapFrame(frame:number,targets:readonly number[],threshold:number):Snap{
  let best:number|undefined;
  for(const t of targets){
    const d=Math.abs(t-frame);
    if(d<=threshold&&(best===undefined||d<Math.abs(best-frame)))best=t;
  }
  return best===undefined?{frame}:{frame:best,target:best};
}

/** Snap targets: every clip edge on every track (except `exceptId`), plus `extra` (playhead, in/out). */
export function snapTargets(tracks:readonly TimelineTrack[],exceptId:string|undefined,extra:readonly number[]=[]):number[]{
  const out=new Set<number>(extra);
  for(const t of tracks)for(const c of t.clips)if(c.id!==exceptId){out.add(c.startFrame);out.add(clipEnd(c));}
  return [...out];
}

/** Snapping inputs shared by the edit previews. */
export interface SnapOptions {
  readonly targets?:readonly number[];
  /** Distance in frames within which an edge snaps. 0 disables snapping. */
  readonly threshold?:number;
}

/** A move or trim preview. `valid` is false when it would overlap a neighbour; it must not be committed. */
export interface EditPreview {
  readonly startFrame:number;
  readonly sourceIn:number;
  readonly sourceOut:number;
  readonly valid:boolean;
  readonly snappedTo?:number;
}

/**
 * Where `clip` lands when dragged to `rawStart` (fractional frames from the
 * pointer): rounded to a frame, then snapped by whichever edge (start or end)
 * is nearer a target, and kept at or after frame 0.
 */
export function movePreview(track:TimelineTrack,clip:TimelineClip,rawStart:number,opts:SnapOptions={}):EditPreview{
  const len=clipLength(clip);
  const threshold=opts.threshold??0;
  const targets=opts.targets??[];
  let start=Math.max(0,Math.round(rawStart));
  let snappedTo:number|undefined;
  if(threshold>0&&targets.length){
    const head=snapFrame(rawStart,targets,threshold);
    const tail=snapFrame(rawStart+len,targets,threshold);
    const dHead=head.target===undefined?Infinity:Math.abs(head.target-rawStart);
    const dTail=tail.target===undefined?Infinity:Math.abs(tail.target-(rawStart+len));
    if(dHead<=dTail&&head.target!==undefined){start=head.target;snappedTo=head.target;}
    else if(tail.target!==undefined&&Number.isSafeInteger(Math.round(tail.target-len))){
      // An end that lands between frames moves the start off the frame grid; keep starts whole.
      start=Math.round(tail.target-len);snappedTo=tail.target;
    }
    start=Math.max(0,Math.round(start));
  }
  return {startFrame:start,sourceIn:clip.sourceIn,sourceOut:clip.sourceOut,
    valid:fitsOnTrack(track,start,len,clip.id),...(snappedTo===undefined?{}:{snappedTo})};
}

/**
 * Trimming one edge of `clip` to `rawEdge` (fractional frames from the pointer).
 * The edge is rounded to a whole frame and snapped; the clip keeps at least one
 * frame; the media span stays inside `[0, sourceDuration]`. A head trim moves
 * the start and the in-point together; a tail trim moves the out-point.
 */
export function trimPreview(track:TimelineTrack,clip:TimelineClip,edge:"head"|"tail",rawEdge:number,opts:SnapOptions={}):EditPreview{
  assertClip(clip);
  const threshold=opts.threshold??0;
  const snap=threshold>0?snapFrame(rawEdge,opts.targets??[],threshold):{frame:rawEdge};
  const edgeFrame=Math.round(snap.frame);
  const end=clipEnd(clip);
  const snappedTo=snap.target===undefined?{}:{snappedTo:snap.target};
  if(edge==="tail"){
    const tail=Math.max(edgeFrame,clip.startFrame+1);
    // An edge left where it was keeps the stored out-point exactly; recomputing
    // it through the speed can differ by an ulp and read as an edit.
    let out=Math.abs(tail-end)<EPS?clip.sourceOut:clip.sourceIn+(tail-clip.startFrame)*clip.speed;
    if(clip.sourceDuration!==undefined)out=Math.min(out,clip.sourceDuration);
    const len=(out-clip.sourceIn)/clip.speed;
    return {startFrame:clip.startFrame,sourceIn:clip.sourceIn,sourceOut:out,
      valid:fitsOnTrack(track,clip.startFrame,len,clip.id),...snappedTo};
  }
  // Head: latest start keeps one frame; earliest is frame 0 or the media's first frame.
  const earliest=Math.max(0,Math.ceil(end-clip.sourceOut/clip.speed-EPS));
  const start=Math.min(Math.max(edgeFrame,earliest),Math.floor(end-1+EPS));
  const sourceIn=start===clip.startFrame?clip.sourceIn:Math.max(0,clip.sourceOut-(end-start)*clip.speed);
  return {startFrame:start,sourceIn,sourceOut:clip.sourceOut,
    valid:start>=0&&fitsOnTrack(track,start,end-start,clip.id),...snappedTo};
}

/** The `move` edit for a valid preview, or `undefined` when nothing moved. */
export function moveEdit(clip:TimelineClip,trackId:string,p:EditPreview,rate:FrameRate):TimelineEdit|undefined{
  if(!p.valid||p.startFrame===clip.startFrame)return undefined;
  return {kind:"move",clipId:clip.id,trackId,startFrame:p.startFrame,startSeconds:framesToSeconds(p.startFrame,rate)};
}

/** The `trim` edit for a valid preview, or `undefined` when nothing changed. */
export function trimEdit(clip:TimelineClip,trackId:string,edge:"head"|"tail",p:EditPreview,rate:FrameRate):TimelineEdit|undefined{
  if(!p.valid)return undefined;
  const near=(a:number,b:number)=>Math.abs(a-b)<EPS;
  if(p.startFrame===clip.startFrame&&near(p.sourceIn,clip.sourceIn)&&near(p.sourceOut,clip.sourceOut))return undefined;
  const order=edge==="tail"?"trim-only":p.startFrame>clip.startFrame?"trim-then-move":"move-then-trim";
  return {kind:"trim",clipId:clip.id,trackId,edge,startFrame:p.startFrame,startSeconds:framesToSeconds(p.startFrame,rate),
    sourceIn:p.sourceIn,sourceOut:p.sourceOut,inSeconds:positionToSeconds(p.sourceIn,rate),outSeconds:positionToSeconds(p.sourceOut,rate),order};
}

/**
 * The `split` edit at `frame`, or `undefined` unless the frame is strictly
 * inside the clip (the engine rejects splits at an edge).
 */
export function splitEdit(clip:TimelineClip,trackId:string,frame:number,rate:FrameRate):TimelineEdit|undefined{
  const at=Math.round(frame);
  if(!(at>clip.startFrame+EPS&&at<clipEnd(clip)-EPS))return undefined;
  return {kind:"split",clipId:clip.id,trackId,atFrame:at,atSeconds:framesToSeconds(at,rate)};
}

/** Clips under `frame` on `tracks`, for "split at playhead" with no selection. */
export function clipsAt(tracks:readonly TimelineTrack[],frame:number):{track:TimelineTrack;clip:TimelineClip}[]{
  const out:{track:TimelineTrack;clip:TimelineClip}[]=[];
  for(const track of tracks)for(const clip of track.clips)
    if(frame>clip.startFrame+EPS&&frame<clipEnd(clip)-EPS)out.push({track,clip});
  return out;
}

/** An in/out selection. Either mark may be unset. */
export interface InOutRange {
  readonly inFrame?:number;
  readonly outFrame?:number;
}
/**
 * `range` with one mark set to `frame`, clamped to `[0, durationFrames]`. Setting
 * an in at or after the out (or an out at or before the in) clears the other
 * mark rather than producing an empty or reversed range.
 */
export function setMark(range:InOutRange,mark:"in"|"out",frame:number,durationFrames:number):InOutRange{
  if(!Number.isFinite(frame)||!Number.isSafeInteger(durationFrames)||durationFrames<0)throw new RangeError("Invalid mark or duration");
  const f=Math.min(durationFrames,Math.max(0,Math.round(frame)));
  if(mark==="in")return range.outFrame!==undefined&&f>=range.outFrame?{inFrame:f}:{...range,inFrame:f};
  return range.inFrame!==undefined&&f<=range.inFrame?{outFrame:f}:{...range,outFrame:f};
}
/** The marked range as `[in, out)`, defaulting unset marks to the timeline's ends. */
export function markedRange(range:InOutRange,durationFrames:number):FrameRange{
  return {start:range.inFrame??0,end:range.outFrame??durationFrames};
}
/** Total timeline length: the end of the last clip on any track, rounded up to a frame. */
export function timelineDuration(tracks:readonly TimelineTrack[]):number{
  let end=0;
  for(const t of tracks)for(const c of t.clips)end=Math.max(end,clipEnd(c));
  return Math.ceil(end-EPS);
}

/** Seconds for a signed whole-frame delta at the sequence rate. */
export function deltaSeconds(deltaFrames:number,rate:FrameRate):number{
  if(!Number.isSafeInteger(deltaFrames))throw new RangeError("Delta must be a whole number of frames");
  return Math.sign(deltaFrames)*framesToSeconds(Math.abs(deltaFrames),rate);
}
/** The `rippleDelete` edit for a clip. */
export const rippleDeleteEdit=(clipId:string,trackId:string,scope:RippleScope):TimelineEdit=>({kind:"rippleDelete",clipId,trackId,scope});
