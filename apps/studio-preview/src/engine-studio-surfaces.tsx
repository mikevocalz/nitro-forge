import { useEffect, useMemo, useRef } from 'react';
import { PrismEditor, type PrismEditorProps } from '@nitro-forge/studio-workspace/prism';
import type { PrismDocument } from '../../../packages/prism/src/index';
import { PrismCanvasAdapter } from '../../../packages/prism/src/canvas-cluster';
import { PrismDetailControls } from './prism-detail-controls';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Banner, ScrollView, Text, TokenScope, View } from '@nitro-forge/studio-workspace/ui';
import { resolveWorkspaceScale, workspaceThemes, type WorkspaceDensity } from '@nitro-forge/studio-workspace/theme';
import { nycTronTokens } from '@nitro-forge/studio-workspace/directions';
import { SpreadsheetGrid, type SpreadsheetWindowRequest } from '@nyc-tron/ui/components/forge/SpreadsheetGrid';
import { SheetTabs } from '@nyc-tron/ui/components/forge/spreadsheet/SheetTabs';
import { TempoAndMetronome } from '@nyc-tron/ui/components/forge/audio/TempoAndMetronome';
import { MixingConsole } from '@nyc-tron/ui/components/forge/audio/MixingConsole';
import { TimelinePlayhead } from '@nyc-tron/ui/components/forge/timeline/TimelinePlayhead';
import { TimelineZoomAndScroll } from '@nyc-tron/ui/components/forge/timeline/TimelineZoomAndScroll';
import { FRAME_RATES, type FrameRate } from '@nyc-tron/ui/components/forge/timebase';
import { TimelineRuler } from '@nyc-tron/ui/components/forge/timeline/TimelineRuler';
import { OverlayAndEffectsTrackStack } from '@nyc-tron/ui/components/forge/timeline/OverlayAndEffectsTrackStack';
import { clampViewport, followPlayhead, type TimelineViewport } from '@nyc-tron/ui/components/forge/timeline/viewport';
import { TallyDetailControls, boundedTallyFreeze, useTallyDetailView } from './tally-detail-controls';
import type { TallyDocument } from '../../../packages/tally/src/index';
import { readTallyWindow, commitTallyGridCell, type TallyGridData } from '../../../packages/tally/src/grid-adapter';
import { bindTallySheetTabs, readTallySheetTabs, commitTallyFill, TALLY_SHEET_BOUNDS, type TallySheetTabsBinding } from '../../../packages/tally/src/grid-cluster';
import { CadenceDetailControls } from './cadence-detail-controls';
import { CadenceMixerAdapter, mixerClusterChannels, type CadenceMixerState } from '../../../packages/cadence/src/mixer-cluster';
import type { CadenceDocument } from '../../../packages/cadence/src/index';
import { createCadenceTempoBindings } from '../../../packages/cadence/src/editor-adapter';
import { SpliceDetailControls, SpliceTransitionOverlay, spliceTimelineExtent, useSpliceDetailSelection } from './splice-detail-controls';
import type { SpliceDocument } from '../../../packages/splice/src/index';
import { SpliceTimelineAdapter, timelineClusterCallbacks, type SpliceTimelineView } from '../../../packages/splice/src/timeline-cluster';

export interface EngineStudioSurfaceProps {
  studio: 'tally' | 'cadence' | 'splice' | 'prism';
  direction?: PrismEditorProps['direction'];
  personas?: PrismEditorProps['personas'];
  onComposePersona?: () => void;
  /** The already-open typed document; this surface never creates an engine session. */
  document: unknown;
  state: unknown;
  reload: () => Promise<void>;
  /** One host lock shared with Save, Open, history and generic commands. */
  perform: (action: () => Promise<unknown>) => Promise<void>;
  theme: 'dark' | 'light';
  density: WorkspaceDensity;
  /** Host document operations close surface admission until the refreshed read settles. */
  disabled?: boolean;
}
import { SurfaceAdmission, performSurfaceWrite } from './surface-admission';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** App composition only. Every reusable instrument is owned by NYC-Tron. */
export function EngineStudioSurface(props: EngineStudioSurfaceProps) {
  return <TokenScope variables={nycTronTokens(props.theme)}>
    {props.studio === 'prism' ? <PrismSurface {...props}/> : props.studio === 'tally' ? <TallySurface {...props}/> : props.studio === 'cadence' ? <CadenceSurface {...props}/> : <SpliceSurface {...props}/>}
  </TokenScope>;
}

/** Shares the host write lock with history/files and keeps raster reads outside it. */
function PrismSurface(props: EngineStudioSurfaceProps) {
  const document = props.document as PrismDocument | null;
  const adapter = useMemo(() => document ? new PrismCanvasAdapter(document) : null, [document]);
  const read = useMemo(() => async () => {
    if (!adapter) throw new Error('The document is still opening.');
    return adapter.read();
  }, [adapter]);
  const surface = useDocumentSurface(document, props.state, read, props.perform, props.disabled);
  const selection = useMemo(() => createStore(() => ({ id: null as number | null })), [document]);
  const selectedId = useStore(selection, state => state.id);
  const latest = useRef({ document, selection });
  latest.current = { document, selection };
  const onSelectLayer = (id: number | null) => {
    if (latest.current.document === document) selection.setState({ id });
  };
  const apply: PrismEditorProps['apply'] = async (op, payload) => {
    if (!document) throw new Error('The document is still opening.');
    // These operations only inspect/render pixels. A read must never reload its own source.
    if (op === 'flatten' || op === 'describe' || op === 'renderRegion') return document.handle.apply(op, payload);
    let result: unknown;
    await surface.commit(async () => { result = await document.handle.apply(op, payload); return result; });
    return result;
  };
  return <View testID="prism-engine-surface" style={{ flex: 1, minHeight: 0 }}>
    {surface.error && <Banner tone="danger" title={surface.error} live="alert"/>}
    <PrismEditor state={props.state} apply={apply} reload={props.reload} documentIdentity={document} applyOwnsRefresh theme={props.theme} density={props.density}
      {...(props.direction ? { direction: props.direction } : {})} {...(props.personas ? { personas: props.personas } : {})} {...(props.onComposePersona ? { onComposePersona: props.onComposePersona } : {})}
      selectedLayerId={selectedId} onSelectLayer={onSelectLayer} busy={!surface.ready}/>
    {document && surface.data && <ScrollView style={{ maxHeight: 300, flexGrow: 0, flexShrink: 1 }}>
      <PrismDetailControls document={document} state={surface.data} selectedLayerId={selectedId}
        onSelectLayer={onSelectLayer} disabled={!surface.ready} commit={surface.commit} theme={props.theme} density={props.density}/>
    </ScrollView>}
  </View>;
}

const initialWindow: SpreadsheetWindowRequest = { startRow: 0, endRow: 64, startColumn: 0, endColumn: 16, frozenRows: 0, frozenColumns: 0 };
function TallySurface(props: EngineStudioSurfaceProps) {
  const document = props.document as TallyDocument | null;
  const store = useMemo(() => createStore(() => ({ cells: {} as TallyGridData, tabs: null as TallySheetTabsBinding | null,
    range: initialWindow, error: null as string | null, busy: false, ready: false, revision: 0, gridSize: { width: 0, height: 0 } })), []);
  const { cells, tabs, range, error, busy, ready, revision, gridSize } = useStore(store, s => s);
  const details = useTallyDetailView(document, tabs?.activeId ?? '');
  const scale = resolveWorkspaceScale(props.density);
  const freeze = boundedTallyFreeze(details.freeze, gridSize, scale.size.target, range);
  const readRange = useMemo(() => ({ ...range, frozenRows: freeze.frozenRows, frozenColumns: freeze.frozenColumns }), [range, freeze.frozenRows, freeze.frozenColumns]);
  const authority = useRef({ document, state: props.state, revision: 0 });
  if (authority.current.document !== document || authority.current.state !== props.state)
    authority.current = { document, state: props.state, revision: authority.current.revision + 1 };
  useEffect(() => {
    if (details.freeze.frozenRows !== freeze.frozenRows || details.freeze.frozenColumns !== freeze.frozenColumns) details.onFreezeChange(freeze);
  }, [details.freeze.frozenRows, details.freeze.frozenColumns, freeze.frozenRows, freeze.frozenColumns, details.onFreezeChange]);
  const latest = useRef({ document, state: props.state });
  latest.current = { document, state: props.state };
  const gate = useRef(new SurfaceAdmission()).current;
  gate.update(document, props.state, readRange, props.disabled);
  const loaded = useRef<{ document: TallyDocument | null; state: unknown; range: SpreadsheetWindowRequest }>({ document: null, state: null, range: initialWindow });
  useEffect(() => {
    const token = gate.beginRead();
    store.setState({ ready: false });
    if (!document) {
      loaded.current.document = null;
      store.setState({ cells: {}, tabs: null });
      return;
    }
    if (!token) return;
    const current = () => gate.current(token);
    const read = async () => {
      // The callback is deliberately inert: this surface coordinates its own refresh.
      const binding = await bindTallySheetTabs(document, () => {});
      const next = await readTallyWindow(document, readRange);
      const confirmed = await readTallySheetTabs(document);
      if (JSON.stringify(confirmed) !== JSON.stringify({ tabs: binding.tabs, activeId: binding.activeId }))
        throw new Error('The active worksheet changed while its cells were loading. Refresh the workbook.');
      if (gate.acceptRead(token)) {
        loaded.current = { document, state: props.state, range: readRange };
        store.setState({ tabs: binding, cells: next, error: null, ready: true });
      }
    };
    void read().catch(error => { if (current()) store.setState({ error: message(error), ready: false }); });
    return () => { if (gate.current(token)) gate.invalidate(); };
  }, [document, props.state, props.disabled, readRange, revision, store, gate]);
  const token = gate.capture();
  const canEdit = ready && gate.ready && !busy;
  const commit = async (write: () => Promise<unknown>) => {
    if (!document) throw new Error('The document is still opening.');
    let admitted = false;
    try {
      await performSurfaceWrite(gate, token, async () => {
        admitted = true;
        store.setState({ busy: true, ready: false, error: null });
        await props.perform(async () => {
          const active = await readTallySheetTabs(document);
          if (active.activeId !== tabs?.activeId) throw new Error('The active worksheet changed. Refresh before editing.');
          await write();
        });
      });
    } catch (error) {
      if (latest.current.document === document) store.setState({ error: message(error) });
      throw error;
    } finally {
      // Readiness stays closed until a new binding and window have both loaded.
      if (admitted) store.setState(current => ({ busy: false, revision: current.revision + 1 }));
    }
  };
  const visibleTabs = loaded.current.document === document ? tabs : null;
  return <View testID="tally-engine-surface" style={{ flex: 1, minHeight: 0 }}>
    {error && <Banner tone="danger" title={error} live="alert"/>}
    {!canEdit && <Text accessibilityLiveRegion="polite" style={{ color: workspaceThemes[props.theme].muted }}>Worksheet edits are unavailable until the current window is loaded.</Text>}
    {visibleTabs && <SheetTabs tabs={visibleTabs.tabs} activeId={visibleTabs.activeId}
      onSelect={id => commit(() => visibleTabs.onSelect(id))} onAdd={() => commit(visibleTabs.onAdd)}
      onRename={(id, name) => commit(() => visibleTabs.onRename(id, name))} onRemove={id => commit(() => visibleTabs.onRemove(id))}/>}
    {visibleTabs && <SpreadsheetGrid key={JSON.stringify([authority.current.revision,visibleTabs.activeId])} selection={details.selection} onSelectionChange={details.onSelectionChange} frozenRows={freeze.frozenRows} frozenColumns={freeze.frozenColumns} sheetId={visibleTabs.activeId} sheetName={visibleTabs.tabs.find(tab => tab.id === visibleTabs.activeId)?.name ?? ''}
      rowCount={TALLY_SHEET_BOUNDS.rowCount} columnCount={TALLY_SHEET_BOUNDS.columnCount} cells={cells}
      rowHeight={scale.size.target} columnWidth={112} style={{ flex: 1, minHeight: 0 }}
      onLayout={event => { const { width, height } = event.nativeEvent.layout; if (width > 0 && height > 0) store.setState(current => current.gridSize.width === width && current.gridSize.height === height ? current : { gridSize: { width, height } }); }}
      onWindowChange={next => { if (JSON.stringify(next) !== JSON.stringify(store.getState().range)) {
        gate.invalidate();
        store.setState({ range: next, ready: false });
      } }}
      {...(canEdit && document ? { onCommitCell: (address: string, raw: string) => commit(() => commitTallyGridCell(document, address, raw)),
        onFillRange: (plan: Parameters<typeof commitTallyFill>[1]) => commit(() => commitTallyFill(document, plan)) } : {})}/>}
    {visibleTabs && document && <ScrollView style={{ maxHeight: 300, flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ padding: scale.space.inset }}>
      <TallyDetailControls document={document} sheetId={visibleTabs.activeId} cells={cells} selection={details.selection} getSelection={details.getSelection}
        freeze={freeze} viewport={gridSize} window={readRange} onFreezeChange={details.onFreezeChange} disabled={!canEdit} commit={commit} density={props.density} theme={props.theme}/>
    </ScrollView>}
  </View>;
}

/** Read/commit admission belongs to the current document and read generation. */
function useDocumentSurface<T>(document: unknown, source: unknown, read: () => Promise<T>, perform: EngineStudioSurfaceProps['perform'], disabled = false) {
  const store = useMemo(() => createStore(() => ({ data: null as T | null, error: null as string | null, ready: false, busy: false, revision: 0 })), []);
  const state = useStore(store, s => s);
  const latest = useRef({ document, source });
  latest.current = { document, source };
  const gate = useRef(new SurfaceAdmission()).current;
  gate.update(document, source, null, disabled);
  const loadedDocument = useRef<unknown>(null);
  useEffect(() => {
    const token = gate.beginRead();
    store.setState({ ready: false });
    if (!token) return;
    const current = () => gate.current(token);
    void read().then(data => {
      if (gate.acceptRead(token)) {
        loadedDocument.current = document;
        store.setState({ data, ready: true, error: null });
      }
    }, error => { if (current()) store.setState({ error: message(error), ready: false }); });
    return () => { if (gate.current(token)) gate.invalidate(); };
  }, [document, source, disabled, read, state.revision, store, gate]);
  const token = gate.capture();
  const ready = state.ready && gate.ready && !state.busy;
  const commit = async (write: () => Promise<unknown>) => {
    let admitted = false;
    try {
      await performSurfaceWrite(gate, token, async () => {
        admitted = true;
        store.setState({ busy: true, ready: false, error: null });
        await perform(write);
      });
    }
    catch (error) {
      if (latest.current.document === document) store.setState({ error: message(error) });
      throw error;
    } finally {
      if (admitted) store.setState(current => ({ busy: false, revision: current.revision + 1 }));
    }
  };
  return { data: loadedDocument.current === document ? state.data : null, error: state.error, ready, commit };
}

function CadenceSurface(props: EngineStudioSurfaceProps) {
  const document = props.document as CadenceDocument | null;
  const read = useMemo(() => async () => {
    if (!document) throw new Error('The document is still opening.');
    return (await document.handle.apply<CadenceMixerState>('describe')).data;
  }, [document]);
  const { data: project, error, ready, commit } = useDocumentSurface(document, props.state, read, props.perform, props.disabled);
  const scale = resolveWorkspaceScale(props.density);
  if (!document) return null;
  const tempo = createCadenceTempoBindings(document), mixer = new CadenceMixerAdapter(document).mixer();
  const observedWrite = (write: () => Promise<unknown>) => {
    const task = commit(write);
    void task.catch(() => {});
    return task;
  };
  return <ScrollView testID="cadence-engine-surface" style={{ flex: 1 }} contentContainerStyle={{ padding: scale.space.group, gap: scale.space.group }}>
    {error && <Banner tone="danger" title={error} live="alert"/>}
    {!ready && <Text accessibilityLiveRegion="polite" style={{ color: workspaceThemes[props.theme].muted }}>Document edits are unavailable until the current state is loaded.</Text>}
    {project && <>
      <TempoAndMetronome {...{targetSize:scale.size.target}} bpm={project.tempo_bpm} timeSignature={project.time_sig} disabled={!ready}
        onTempoCommit={bpm => {
          const task = commit(() => tempo.onTempoCommit(bpm));
          // alpha.4 awaits numeric entry but invokes tap tempo as a void callback.
          // Observe that path while returning the original rejection to awaited callers.
          void task.catch(() => {});
          return task;
        }}
        onTimeSignatureCommit={signature => { void commit(() => tempo.onTimeSignatureCommit(signature)).catch(() => {}); }}/>
      <MixingConsole {...{targetSize:scale.size.target}} channels={mixerClusterChannels(project)} disabled={!ready}
        onGainCommit={(id, value) => observedWrite(() => mixer.onGainCommit(id, value))}
        onPanCommit={(id, value) => observedWrite(() => mixer.onPanCommit(id, value))}
        onMutedCommit={(id, value) => observedWrite(() => mixer.onMutedCommit(id, value))}
        onSoloCommit={(id, value) => observedWrite(() => mixer.onSoloCommit(id, value))}
        onSoloSafeCommit={(id, value) => observedWrite(() => mixer.onSoloSafeCommit(id, value))}
        onGroupSoloCommit={(group, value) => observedWrite(() => mixer.onGroupSoloCommit(group, value))}
        onGroupMutedCommit={(group, value) => observedWrite(() => mixer.onGroupMutedCommit(group, value))}/>
      <CadenceDetailControls document={document} project={project} disabled={!ready} commit={commit} density={props.density} theme={props.theme}/>
    </>}
    <Text style={{ color: workspaceThemes[props.theme].muted, fontSize: scale.type.body }}>Tempo and mixer edits are saved in the document. Audio output and metronome playback require the native audio host.</Text>
  </ScrollView>;
}

/** Preserve the document's frame rate; refuse rates outside the shared control contract. */
function spliceRate(fps: number): FrameRate | null {
  for (const rate of Object.values(FRAME_RATES)) {
    if (Math.abs(rate.numerator / rate.denominator - fps) < 1e-9) return rate;
  }
  for (let denominator = 1; denominator <= 100000 && fps * denominator <= 120000; denominator++) {
    const numerator = Math.round(fps * denominator);
    if (numerator > 0 && Math.abs(numerator / denominator - fps) < 1e-9) return { numerator, denominator };
  }
  return null;
}
function SpliceSurface(props: EngineStudioSurfaceProps) {
  const document = props.document as SpliceDocument | null;
  const selection = useSpliceDetailSelection(document);
  const fps = (props.state as { fps?: number } | null)?.fps ?? 30;
  const rate = useMemo(() => spliceRate(fps), [fps]);
  const adapter = useMemo(() => document && rate ? new SpliceTimelineAdapter(document, rate) : null, [document, rate]);
  const store = useMemo(() => createStore(() => ({
    viewport: { startFrame: 0, pxPerFrame: 2, widthPx: 600 } as TimelineViewport, frame: 0, width: 800 })), []);
  const { viewport, frame, width } = useStore(store, s => s);
  const read = useMemo(() => async () => {
    if (!adapter) throw new Error('The document is still opening.');
    return adapter.read();
  }, [adapter]);
  const { data: view, error, ready, commit } = useDocumentSurface<SpliceTimelineView>(document, props.state, read, props.perform, props.disabled);
  const scale = resolveWorkspaceScale(props.density), compact = width < 700, headerWidth = compact ? 56 : 232;
  useEffect(() => {
    store.setState({ frame: 0 });
  }, [document, store]);
  const extent = view ? spliceTimelineExtent(view) : 0;
  const cursor = Math.max(0, Math.min(frame, extent));
  const knownClips = new Set(view?.tracks.flatMap(track => track.clips.map(clip => clip.id)) ?? []);
  const selectedClipIds = selection.selectedClipIds.filter(id => knownClips.has(id));
  const selected = selectedClipIds.length === 1 ? selectedClipIds[0] : undefined;
  useEffect(() => {
    store.setState(current => {
      const frame = Math.max(0, Math.min(current.frame, extent));
      const viewport = clampViewport(current.viewport, extent);
      return frame === current.frame && viewport.startFrame === current.viewport.startFrame ? current : { frame, viewport };
    });
  }, [extent, store]);
  const seekMarker = (frame: number) => {
    const next = Math.max(0, Math.min(frame, extent));
    store.setState(current => ({ frame: next, viewport: followPlayhead(current.viewport, next, extent, 'center') }));
  };
  if (!rate) return <Banner tone="danger" title={`The sequence rate ${fps} cannot be represented by the timeline controls.`} live="alert"/>;
  if (!adapter) return null;
  const bindings = timelineClusterCallbacks(adapter);
  return <ScrollView testID="splice-engine-surface" style={{ flex: 1 }} contentContainerStyle={{ padding: scale.space.element, gap: scale.space.element }}
    onLayout={event => { const width = event.nativeEvent.layout.width; if (width > 0) store.setState(current => ({ width, viewport: { ...current.viewport, widthPx: Math.max(1, width - (width < 700 ? 56 : 232) - scale.space.element * 2) } })); }}>
    {error && <Banner tone="danger" title={error} live="alert"/>}
    {view && <>
      <TimelineZoomAndScroll viewport={viewport} onViewportChange={viewport => store.setState({ viewport })} durationFrames={extent} rate={rate} playheadFrame={cursor} disabled={!ready}/>
      <View style={{ marginLeft: headerWidth }}><TimelineRuler viewport={viewport} rate={rate} durationFrames={extent} frame={cursor}
        disabled={!ready} onSeek={frame => store.setState({ frame })}/>
        <TimelinePlayhead viewport={viewport} frame={cursor} durationFrames={extent} rate={rate} height={44}
          disabled={!ready} onSeek={frame => store.setState({ frame })}/>
      </View>
      <OverlayAndEffectsTrackStack tracks={view.tracks} viewport={viewport} onViewportChange={viewport => store.setState({ viewport })}
        rate={rate} durationFrames={extent} playheadFrame={cursor} {...(selected ? { selectedClipId: selected } : {})}
        selectedClipIds={selectedClipIds} onSelect={selection.selectClip} onToggleSelect={selection.toggleClip}
        laneOverlay={<SpliceTransitionOverlay adapter={adapter} view={view} rate={rate} viewport={viewport} selection={selection} disabled={!ready} commit={commit} laneHeight={Math.max(56, scale.size.target)}/>} onEdit={edit => { void commit(() => bindings.onEdit(edit)).catch(() => {}); }}
        compactHeaders={compact} headerWidth={headerWidth} laneHeight={Math.max(56, scale.size.target)} disabled={!ready}
        onSetFlag={(id, flag, value) => { void commit(() => bindings.onSetFlag(id, flag, value)).catch(() => {}); }}
        onRename={(id, name) => { void commit(() => bindings.onRename(id, name)).catch(() => {}); }}
        onMoveTrack={(id, index) => { void commit(() => bindings.onMoveTrack(id, index)).catch(() => {}); }}
        onAddTrack={kind => { void commit(() => bindings.onAddTrack(kind)).catch(() => {}); }}/>
      <SpliceDetailControls adapter={adapter} view={view} rate={rate} viewport={viewport} selection={selection} disabled={!ready} commit={commit}
        frame={cursor} onSeek={seekMarker} theme={props.theme} density={props.density}/>
    </>}
  </ScrollView>;
}
