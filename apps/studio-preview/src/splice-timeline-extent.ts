import type { SpliceTimelineView } from '../../../packages/splice/src/timeline-cluster';

/** UI bounds include annotations; the engine's durationFrames remains the last clip end. */
export function spliceTimelineExtent(view: SpliceTimelineView): number {
  let extent = Math.max(0, view.durationFrames, view.loopRange?.outFrame ?? 0);
  for (const marker of view.markers) extent = Math.max(extent, marker.frame + (marker.durationFrames ?? 0));
  return extent;
}
