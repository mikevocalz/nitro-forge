import type {TimelineTrack} from './edits.ts';
/** Bounded geometry/permission identity; a playback clock tick is not an edit. */
export function timelineEditSignature(tracks:readonly TimelineTrack[]):string{
 if(tracks.length>1000)throw new RangeError('Too many timeline tracks');
 const trackIds=new Set<string>(),clipIds=new Set<string>();let count=0;
 for(const track of tracks){
  if(!track.id.trim()||track.id.length>512||trackIds.has(track.id)||track.label.length>1024||!['video','overlay','audio'].includes(track.kind))throw new RangeError('Invalid timeline track');trackIds.add(track.id);
  count+=track.clips.length;if(count>50000)throw new RangeError('Too many timeline clips');
  for(const clip of track.clips){
   if(!clip.id.trim()||clip.id.length>512||clipIds.has(clip.id)||!Number.isSafeInteger(clip.startFrame)||clip.startFrame<0||![clip.sourceIn,clip.sourceOut,clip.speed].every(Number.isFinite)||clip.sourceIn<0||clip.sourceOut<=clip.sourceIn||clip.speed<=0||clip.sourceDuration!==undefined&&(!Number.isFinite(clip.sourceDuration)||clip.sourceDuration<clip.sourceOut))throw new RangeError('Invalid timeline clip');clipIds.add(clip.id);
  }
 }
 return JSON.stringify(tracks.map(t=>[t.id,t.kind,t.locked,t.hidden,t.muted,t.solo,t.clips.map(c=>[c.id,c.startFrame,c.sourceIn,c.sourceOut,c.speed,c.sourceDuration])]));
}
