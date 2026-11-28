import type {TimelineTrack,TrackKind} from "./edits.ts";

/**
 * Track order for `OverlayAndEffectsTrackStack` (D-31): overlay tracks on top,
 * then video, then audio, each group in the host's order. The host's list
 * (Splice's track order, changed with `moveTrack`) stays the source of truth;
 * this only groups it for display.
 */
const GROUP:Readonly<Record<TrackKind,number>>={overlay:0,video:1,audio:2};

export function stackOrder(tracks:readonly TimelineTrack[]):TimelineTrack[]{
  return tracks.map((t,i)=>({t,i})).sort((a,b)=>GROUP[a.t.kind]-GROUP[b.t.kind]||a.i-b.i).map(x=>x.t);
}

/**
 * The index in the host's list that `trackId` moves to when it moves one place
 * up (`-1`) or down (`1`) within its group, or `undefined` at a group's end.
 */
export function stackMoveTarget(tracks:readonly TimelineTrack[],trackId:string,direction:-1|1):number|undefined{
  const shown=stackOrder(tracks);
  const i=shown.findIndex(t=>t.id===trackId);
  const me=shown[i],other=shown[i+direction];
  if(!me||!other||other.kind!==me.kind)return undefined;
  return tracks.findIndex(t=>t.id===other.id);
}
