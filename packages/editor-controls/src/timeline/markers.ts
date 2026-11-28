import type {FrameRate} from "../timebase.ts";
import {framesToSeconds} from "./time.ts";

/**
 * A sequence marker (D-24). A point marker has no duration; a range marker
 * covers `[frame, frame + durationFrames)`. Splice stores markers in seconds
 * (`addMarker`, `updateMarker`, `removeMarker`) and keeps them where they are
 * when clips ripple. Markers carry no color: the engine stores none, and the
 * app's tokens draw them.
 */
export interface TimelineMarker {
  readonly id:string;
  readonly frame:number;
  readonly durationFrames?:number;
  readonly name:string;
  /** App-owned marker metadata, mapped to a supplied palette. */
  readonly colorId?:string;
  readonly note?:string;
}
/** A marker change, in frames for the UI and seconds for the engine. */
export interface MarkerUpdate {
  readonly frame:number;
  readonly seconds:number;
  readonly durationFrames?:number;
  readonly durationSeconds?:number;
  readonly name?:string;
  readonly note?:string;
}

/** Markers by start frame, then by id, so the list order is stable. */
export const sortMarkers=(markers:readonly TimelineMarker[])=>
  [...markers].sort((a,b)=>a.frame-b.frame||(a.id<b.id?-1:a.id>b.id?1:0));

/** The nearest marker strictly after (`1`) or before (`-1`) `frame`. */
export function adjacentMarker(markers:readonly TimelineMarker[],frame:number,direction:1|-1):TimelineMarker|undefined{
  const sorted=sortMarkers(markers);
  return direction===1?sorted.find(m=>m.frame>frame):sorted.reverse().find(m=>m.frame<frame);
}

/**
 * The update that moves `marker` to `frame`, keeping its duration and its
 * end inside `[0, durationFrames]`. `undefined` when it would not move.
 */
export function moveMarker(marker:TimelineMarker,frame:number,durationFrames:number,rate:FrameRate):MarkerUpdate|undefined{
  const len=marker.durationFrames??0;
  const f=Math.min(Math.max(0,durationFrames-len),Math.max(0,Math.round(frame)));
  if(f===marker.frame)return undefined;
  return {frame:f,seconds:framesToSeconds(f,rate)};
}

/** The update that sets the marker's duration; 0 makes it a point marker. */
export function resizeMarker(marker:TimelineMarker,durationFrames:number,timelineFrames:number,rate:FrameRate):MarkerUpdate|undefined{
  const d=Math.min(Math.max(0,timelineFrames-marker.frame),Math.max(0,Math.round(durationFrames)));
  if(d===(marker.durationFrames??0))return undefined;
  return {frame:marker.frame,seconds:framesToSeconds(marker.frame,rate),durationFrames:d,durationSeconds:framesToSeconds(d,rate)};
}

/** A default name that does not repeat one already used ("Marker 3"). */
export function nextMarkerName(markers:readonly TimelineMarker[]):string{
  const used=new Set(markers.map(m=>m.name));
  for(let n=markers.length+1;;n++)if(!used.has("Marker "+n))return "Marker "+n;
}
