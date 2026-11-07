import { useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Text, View } from '@nitro-forge/studio-workspace/ui';
import { resolveWorkspaceScale, workspaceThemes, type WorkspaceDensity } from '@nitro-forge/studio-workspace/theme';
import { TimelineMarkers } from '@nyc-tron/ui/components/forge/timeline/TimelineMarkers';
import { TransitionHandles } from '@nyc-tron/ui/components/forge/timeline/TransitionHandles';
import { TransitionPresetBrowser } from '@nyc-tron/ui/components/forge/timeline/TransitionPresetBrowser';
import { BatchEditPanel } from '@nyc-tron/ui/components/forge/timeline/BatchEditPanel';
import { clipsOfCut, cutsOf, maxTransitionFrames, transitionAt, transitionTarget, type TimelineCut } from '@nyc-tron/ui/components/forge/timeline/transitions';
import { stackOrder } from '@nyc-tron/ui/components/forge/timeline/track-stack';
import type { FrameRate } from '@nyc-tron/ui/components/forge/timebase';
import type { TimelineViewport } from '@nyc-tron/ui/components/forge/timeline/viewport';
import type { SpliceDocument } from '../../../packages/splice/src/index';
import { spliceTimelineExtent } from './splice-timeline-extent';
export { spliceTimelineExtent } from './splice-timeline-extent';
import { SPLICE_TRANSITION_PRESETS, timelineClusterCallbacks, type SpliceTimelineAdapter, type SpliceTimelineView } from '../../../packages/splice/src/timeline-cluster';

type DetailSelection = {
  selectedClipIds: readonly string[];
  selectedCut: TimelineCut | undefined;
  selectedTransitionId: string | undefined;
  selectedMarkerId: string | undefined;
};
/** Presentation selection resets on document identity, never on density or pane geometry. */
export function useSpliceDetailSelection(document: SpliceDocument | null) {
  const store = useMemo(() => createStore<DetailSelection>(() => ({
    selectedClipIds: [], selectedCut: undefined, selectedTransitionId: undefined, selectedMarkerId: undefined,
  })), [document]);
  const state = useStore(store, value => value);
  return { ...state,
    selectClip: (id: string | undefined) => store.setState({ selectedClipIds: id ? [id] : [] }),
    toggleClip: (id: string) => store.setState(current => ({ selectedClipIds: current.selectedClipIds.includes(id)
      ? current.selectedClipIds.filter(value => value !== id) : [...current.selectedClipIds, id] })),
    clearClips: () => store.setState({ selectedClipIds: [] }),
    selectCut: (selectedCut: TimelineCut | undefined) => store.setState({ selectedCut, selectedTransitionId: undefined }),
    selectTransition: (selectedTransitionId: string | undefined) => store.setState({ selectedTransitionId }),
    selectMarker: (selectedMarkerId: string | undefined) => store.setState({ selectedMarkerId }),
  };
}
export type SpliceDetailSelection = ReturnType<typeof useSpliceDetailSelection>;

export interface SpliceDetailProps {
  adapter: SpliceTimelineAdapter;
  view: SpliceTimelineView;
  rate: FrameRate;
  viewport: TimelineViewport;
  selection: SpliceDetailSelection;
  disabled: boolean;
  /** The current surface admission gate; its host serializes all document writers. */
  commit: (write: () => Promise<unknown>) => Promise<void>;
}
function currentCut({ view, selection }: Pick<SpliceDetailProps, 'view' | 'selection'>): TimelineCut | undefined {
  const cut = selection.selectedCut;
  if (!cut) return undefined;
  return view.tracks.flatMap(track => cutsOf(track)).find(candidate => candidate.trackId === cut.trackId &&
    candidate.leftClipId === cut.leftClipId && candidate.rightClipId === cut.rightClipId && candidate.frame === cut.frame);
}
/** A new authoritative read cancels drafts/gestures in the older released controls. */
function useReadRevision(view: SpliceTimelineView) {
  const current = useRef({ view, revision: 0 });
  if (current.current.view !== view) current.current = { view, revision: current.current.revision + 1 };
  return current.current.revision;
}
/** alpha.4 event callbacks are void; preserve the rejection while observing that boundary. */
function observedCommit(commit: SpliceDetailProps['commit'], write: () => Promise<unknown>) {
  const task = commit(write);
  void task.catch(() => {});
  return task;
}

/** Mount in OverlayAndEffectsTrackStack.laneOverlay, whose coordinates use stackOrder. */
export function SpliceTransitionOverlay(props: SpliceDetailProps & { laneHeight: number }) {
  const revision = useReadRevision(props.view);
  const bindings = timelineClusterCallbacks(props.adapter), selectedCut = currentCut(props);
  const selectedTransitionId = props.view.transitions.some(item => item.id === props.selection.selectedTransitionId)
    ? props.selection.selectedTransitionId : undefined;
  return <TransitionHandles key={revision} tracks={stackOrder(props.view.tracks)} transitions={props.view.transitions}
    viewport={props.viewport} rate={props.rate} laneHeight={props.laneHeight} disabled={props.disabled}
    {...(selectedCut ? { selectedCut } : {})} {...(selectedTransitionId ? { selectedTransitionId } : {})}
    onSelectCut={props.selection.selectCut} onSelectTransition={props.selection.selectTransition}
    onAdd={request => observedCommit(props.commit, () => bindings.onAddTransition(request))}
    onChange={(id, change) => observedCommit(props.commit, () => bindings.onChangeTransition(id, change))}
    onRemove={id => observedCommit(props.commit, () => bindings.onRemoveTransition(id))}/>;
}

/** Canonical marker, transition and transactional batch controls; no decoder or player imitation. */
export function SpliceDetailControls(props: SpliceDetailProps & {
  frame: number;
  onSeek: (frame: number) => void;
  theme: 'dark' | 'light';
  density: WorkspaceDensity;
}) {
  const { view, selection, commit, adapter, disabled } = props;
  const revision = useReadRevision(view);
  const scale = resolveWorkspaceScale(props.density), colors = workspaceThemes[props.theme];
  const bindings = timelineClusterCallbacks(adapter);
  const cut = currentCut(props), located = cut ? clipsOfCut(view.tracks, cut) : undefined;
  const existing = cut ? transitionAt(view.transitions, cut) : undefined;
  const browserCut = located ? { target: transitionTarget(located.track), maxFrames: maxTransitionFrames(located.left, located.right),
    ...(existing ? { currentKind: existing.kind } : {}) } : undefined;
  const knownClips = new Set(view.tracks.flatMap(track => track.clips.map(clip => clip.id)));
  const selectedClipIds = selection.selectedClipIds.filter(id => knownClips.has(id));
  const selectedMarkerId = view.markers.some(marker => marker.id === selection.selectedMarkerId) ? selection.selectedMarkerId : undefined;
  return <View testID="splice-detail-controls" style={{ gap: scale.space.group }}>
    <TimelineMarkers key={revision} markers={view.markers} viewport={props.viewport} rate={props.rate} durationFrames={spliceTimelineExtent(view)}
      playheadFrame={props.frame} disabled={disabled} {...(selectedMarkerId ? { selectedMarkerId } : {})}
      onSelect={selection.selectMarker} onSeek={props.onSeek}
      onAdd={at => observedCommit(commit, () => bindings.onAddMarker(at))}
      onUpdate={(id, change) => observedCommit(commit, () => bindings.onUpdateMarker(id, change))}
      onRemove={id => observedCommit(commit, () => bindings.onRemoveMarker(id))}/>
    <Text style={{ color: colors.muted, fontSize: scale.type.body }}>Select a cut between touching clips to choose a transition. Select several clips with Shift, Control or Command for batch edits.</Text>
    <TransitionPresetBrowser key={revision} kinds={SPLICE_TRANSITION_PRESETS} rate={props.rate} disabled={disabled}
      {...(browserCut ? { cut: browserCut } : {})}
      onApply={(kind, _frames, durationSeconds) => {
        if (!cut) return;
        const preset = SPLICE_TRANSITION_PRESETS.find(item => item.kind === kind);
        if (!preset) return;
        return observedCommit(commit, () => existing
          ? adapter.setTransition(existing.id, { kind: preset.kind, durationSeconds })
          : bindings.onAddTransition({ leftClipId: cut.leftClipId, rightClipId: cut.rightClipId, kind, durationSeconds }));
      }}/>
    <BatchEditPanel key={revision} tracks={view.tracks} selectedClipIds={selectedClipIds} rate={props.rate} disabled={disabled}
      onClearSelection={selection.clearClips} onApply={edits => observedCommit(commit, () => bindings.onApply(edits))}/>
  </View>;
}
