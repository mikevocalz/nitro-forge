// Checked against the installed pinned release by verify:released-ui; also usable with the source verifier.
import type { TimelineEdit } from '@nyc-tron/ui/components/forge/timeline/edits';
import type { TrackHeadersProps } from '@nyc-tron/ui/components/forge/timeline/TrackHeaders';
import type { LoopRangeBarProps } from '@nyc-tron/ui/components/forge/timeline/LoopRangeBar';
import type { RollSlipSlideControlsProps } from '@nyc-tron/ui/components/forge/timeline/RollSlipSlideControls';
import type { DragReorderAndRippleProps } from '@nyc-tron/ui/components/forge/timeline/DragReorderAndRipple';
import type { TransitionHandlesProps } from '@nyc-tron/ui/components/forge/timeline/TransitionHandles';
import type { TimelineMarkersProps } from '@nyc-tron/ui/components/forge/timeline/TimelineMarkers';
import type { OverlayAndEffectsTrackStackProps } from '@nyc-tron/ui/components/forge/timeline/OverlayAndEffectsTrackStack';
import type { BatchEditPanelProps } from '@nyc-tron/ui/components/forge/timeline/BatchEditPanel';
import type { TransitionPresetBrowserProps } from '@nyc-tron/ui/components/forge/timeline/TransitionPresetBrowser';
import { timelineClusterCallbacks, type SpliceTimelineAdapter, type TimelineEditInput, type SpliceTimelineView } from '../src/timeline-cluster';

export const edit = (value: TimelineEdit): TimelineEditInput => value;
export function bindings(adapter: SpliceTimelineAdapter, view: SpliceTimelineView) {
  const c = timelineClusterCallbacks(adapter);
  const headers: Pick<TrackHeadersProps, 'tracks' | 'onSetFlag' | 'onRename' | 'onMove'> = {
    tracks: view.tracks, onSetFlag: c.onSetFlag, onRename: c.onRename, onMove: c.onMoveTrack,
  };
  const stack: Pick<OverlayAndEffectsTrackStackProps, 'tracks' | 'onEdit' | 'onAddTrack' | 'onSetFlag' | 'onRename' | 'onMoveTrack'> = {
    ...headers, onMoveTrack: c.onMoveTrack, onAddTrack: c.onAddTrack, onEdit: c.onEdit,
  };
  const trim: RollSlipSlideControlsProps['onEdit'] = c.onEdit;
  const move: DragReorderAndRippleProps['onEdit'] = c.onEdit;
  const transitions: Pick<TransitionHandlesProps, 'transitions' | 'onAdd' | 'onChange' | 'onRemove'> = {
    transitions: view.transitions, onAdd: c.onAddTransition, onChange: c.onChangeTransition, onRemove: c.onRemoveTransition,
  };
  const markers: Pick<TimelineMarkersProps, 'markers' | 'onAdd' | 'onUpdate' | 'onRemove'> = {
    markers: view.markers, onAdd: c.onAddMarker, onUpdate: c.onUpdateMarker, onRemove: c.onRemoveMarker,
  };
  const loop: LoopRangeBarProps['onCommit'] = c.onCommitLoop;
  const range: LoopRangeBarProps['range'] = view.loopRange;
  const batch: BatchEditPanelProps['onApply'] = c.onApply;
  const preset = (cut: { leftClipId: string; rightClipId: string }): TransitionPresetBrowserProps['onApply'] =>
    (kind, _frames, durationSeconds) => c.onAddTransition({ ...cut, kind, durationSeconds });
  return { headers, stack, trim, move, transitions, markers, loop, range, batch, preset };
}
