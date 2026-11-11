import type { TimelineEdit } from '@nyc-tron/ui/components/forge/timeline/edits';
import type { TrackFlag } from '@nyc-tron/ui/components/forge/timeline/TrackHeaders';

type Commit = (write: () => Promise<unknown>) => Promise<void>;
/** The slice of `timelineClusterCallbacks(adapter)` the trim and header controls call. */
export interface SpliceTrimBindings {
  onEdit: (edit: TimelineEdit) => Promise<unknown>;
  onSetFlag: (trackId: string, flag: TrackFlag, value: boolean) => Promise<unknown>;
}

/**
 * Released NYC-Tron callbacks return void, so a rejected engine write would be
 * an unhandled rejection. The surface still shows the failure: `commit` stores
 * the engine message in the surface error banner before it rejects.
 */
function observed(task: Promise<void>): Promise<void> {
  void task.catch(() => {});
  return task;
}

/**
 * Binds D-21 `RollSlipSlideControls` and the D-31 lane edits (`rollEdit`,
 * `slipClip`, `slideClip`) and D-18 `TrackHeaders` (`setTrackFlags`) to the
 * Splice adapter through the surface's admission gate. Every write is awaited
 * by `commit`; nothing is applied optimistically.
 */
export function spliceTrimHandlers(bindings: SpliceTrimBindings, commit: Commit) {
  return {
    onEdit: (edit: TimelineEdit) => observed(commit(() => bindings.onEdit(edit))),
    onSetFlag: (trackId: string, flag: TrackFlag, value: boolean) => observed(commit(() => bindings.onSetFlag(trackId, flag, value))),
  };
}
