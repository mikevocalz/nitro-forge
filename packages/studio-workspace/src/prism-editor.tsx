import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import type { StudioViewRef } from './ui';
import { useEffect, useRef } from 'react';
import { Image, Pressable, ScrollView, Text, View, Menu, Button, IconButton, Banner, Badge, EmptyState, NightScope } from './ui';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { base64ToBytes, bytesToBase64 } from '@nitro-forge/ignition';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { encodeRgbaPng, validatePreviewSize } from './rgba-png';
import { prismThemes, workspaceScale as scale } from './theme';
import { prismViewportLayout, PRISM_DOCKED_LAYERS_MIN_WIDTH } from './prism-layout';
import { PrismCanvas } from './prism-canvas';
import { ForgePrecisionScrubber } from './precision-scrubber';
import type { CanvasLayer } from './prism-canvas-model';
import { SHAPE_TRANSFORMS, shapeTransformPayload } from './prism-transform';
import { DragGrabHandle, type DragPoint } from './drag-grab-handle';
import { Platform } from 'react-native';
import { PersonaTurret, documentRtl, turretBoxWidth, turretTextScale, useForgeRenderPrefs, useTurretShortcut, type PersonaTurretHandle } from './persona-turret';
import { chromePalette, forgeDirections, forgeFeedbackMotion, workbenchChrome } from './forge-directions';
import { turretDisplayAngle } from './turret';
import { personasOn } from './persona';
import { createPersonaStore, type PersonaStore } from './persona-store';
import type { PersonaSurface } from './persona';
import type { TurretEffect } from './turret';
import { layerDropIndex, awaitLayerDrop, type LayerMeasurements, type MeasuredLayer } from './layer-drop';

type Layer = CanvasLayer & { name: string };
type PrismState = { width: number; height: number; layers: Layer[] };
type LayerDrag = { id: number; target: number | null };
type LocalState = { drag: LayerDrag | null; selectedId: number | null; uri: string | null; rendering: boolean; busy: boolean; error: string | null; previewError: string | null; notice: string; layersOpen: boolean; personaOpen: boolean; personaStatus: string; trigger: { x: number; width: number }; toolbarHeight: number; width: number; height: number; retry: number; color: number };
/** A real-engine Prism canvas. Selection and panel state are local; all edits use engine commands. */
export interface PrismEditorProps {
  state: unknown;
  apply: (op: string, payload?: unknown) => Promise<unknown>;
  reload: () => Promise<void>;
  theme?: 'dark' | 'light';
  busy?: boolean;
  /** Persona session for this document. Omitted: the editor keeps its own. */
  personas?: PersonaStore;
  /** Host feedback for turret detents and commits (haptics on native). */
  onPersonaEffect?: (effect: TurretEffect) => void;
  /** Host-presented persona panel (a native sheet or a fold dock). When set,
   * the editor's Persona control opens it instead of the inline panel. */
  onOpenPersonas?: () => void;
  /** Opens the host's Persona Composer for this document's persona store. */
  onComposePersona?: () => void;
}
const hostSurface = (): PersonaSurface => Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? ((Platform as { isPad?: boolean }).isPad ? 'ipad' : 'iphone') : 'android-phone';
const FILLS = [[105, 80, 209, 255], [36, 145, 132, 255], [227, 155, 76, 255], [226, 109, 146, 255]] as const;
const FILL_COLORS = ['#6950D1', '#249184', '#E39B4C', '#E26D92'];
const FILL_NAMES = ['violet', 'teal', 'amber', 'rose'];
/** A colour chip is the content, so forced colours must not repaint it (web). */
const keepColour = Platform.OS === 'web' ? { forcedColorAdjust: 'none' } as object : {};
/** Below this editor width the persona panel is a bottom sheet over a scrim. */
const PERSONA_SHEET_MAX_WIDTH = 600;
const workbench = forgeDirections.workbench;
const PERSONA_ARROW = 12;
/** Room for the layer name and its size line, Transform, the persona mode and Layers. */
const TOOLBAR_MAX_WIDTH = 560;
/** One gutter for the persona panel: title, turret captions and footer share it. */
const PANEL_GUTTER = 16;
/** The tool rail's right edge plus a gutter, in toolbar coordinates: the popover never covers it. */
const POPOVER_MIN_LEFT = 64;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function readState(state: unknown): PrismState | null {
  if (!state || typeof state !== 'object') return null;
  const value = state as Partial<PrismState>;
  return typeof value.width === 'number' && typeof value.height === 'number' && Array.isArray(value.layers) ? value as PrismState : null;
}

/** Render Prism's own raster/vector composite, with bounded PNG transfer to native or web Image. */
export function PrismEditor(props: PrismEditorProps) {
  const scheme = props.theme ?? 'dark';
  const mat = prismThemes[scheme];
  // Every panel is cut from the turret's Workbench material: graphite in
  // dark, white ceramic with dark engraving in light.
  const chrome = workbenchChrome[scheme];
  const colors = chromePalette(scheme);
  const forced = !!useForgeRenderPrefs().forcedColors;
  const ownPersonas = useRef<PersonaStore | null>(null);
  if (!props.personas && !ownPersonas.current) ownPersonas.current = createPersonaStore({ surface: hostSurface() });
  const personaStore = props.personas ?? ownPersonas.current!;
  const persona = useStore(personaStore, s => s);
  const activePersona = persona.personas.find(p => p.id === persona.activeId);
  const activeCaps = new Set(activePersona?.capabilities ?? []);
  const localRef = useRef<StoreApi<LocalState> | null>(null);
  if (!localRef.current) localRef.current = createStore<LocalState>(() => ({ drag: null, selectedId: null, uri: null, rendering: false, busy: false, error: null, previewError: null, notice: '', layersOpen: false, personaOpen: false, personaStatus: '', trigger: { x: 0, width: 0 }, toolbarHeight: 48, width: 800, height: 600, retry: 0, color: 0 }));
  const store = localRef.current;
  const drag = useStore(store, s => s.drag);
  const selectedId = useStore(store, s => s.selectedId);
  const uri = useStore(store, s => s.uri);
  const rendering = useStore(store, s => s.rendering);
  const busy = useStore(store, s => s.busy);
  const error = useStore(store, s => s.error);
  const previewError = useStore(store, s => s.previewError);
  const notice = useStore(store, s => s.notice);
  const layersOpen = useStore(store, s => s.layersOpen);
  const personaOpen = useStore(store, s => s.personaOpen);
  const width = useStore(store, s => s.width);
  const height = useStore(store, s => s.height);
  const retry = useStore(store, s => s.retry);
  const color = useStore(store, s => s.color);
  const current = useRef(props);
  current.current = props;
  const mounted = useRef(true);
  const firstMeasurement = useRef(true);
  const rowViews = useRef(new Map<number, StudioViewRef>());
  const layerViewport = useRef<StudioViewRef>(null);
  const dragSequence = useRef(0);
  const dragSession = useRef<{ token: number; id: number; signature: string; rows: MeasuredLayer[]; viewport: MeasuredLayer | null; point: DragPoint | null; ready: Promise<LayerMeasurements> | null } | null>(null);
  const cancelLayerDrag = () => {
    ++dragSequence.current;
    dragSession.current = null;
    if (mounted.current && store.getState().drag) store.setState({ drag: null, notice: 'Layer move cancelled' });
  };
  useEffect(() => { cancelLayerDrag(); }, [props.state, width, height, layersOpen]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!notice || drag) return;
    const timer = setTimeout(() => {
      if (mounted.current && store.getState().notice === notice) store.setState({ notice: '' });
    }, 2500);
    return () => clearTimeout(timer);
  }, [notice, drag, store]);
  const doc = readState(props.state);
  const layers = doc?.layers ?? [];
  const selected = layers.find(layer => layer.id === selectedId);
  const selectedIndex = layers.findIndex(layer => layer.id === selectedId);
  const ratio = doc && doc.width > 0 && doc.height > 0 ? doc.width / doc.height : 1;
  const { narrow, short, dockedLayers, panelWidth, panelTop, panelMaxHeight, layerListMaxHeight,
    canvasLeft, canvasRight, canvasTop, canvasBottom, canvasWidth, canvasHeight, fillWidth, fillLeft
  } = prismViewportLayout(width, height, ratio, layersOpen, !!selected);
  const feedback = error ?? previewError ?? (rendering ? 'Updating engine composite…' : notice);
  const dropRows = drag ? layers.slice().reverse().filter(layer => layer.id !== drag.id) : [];
  const dropVisualIndex = drag?.target === null || !drag ? null : layers.length - 1 - drag.target;
  const dropBefore = dropVisualIndex === null ? null : dropRows[dropVisualIndex]?.id;
  const dropAtEnd = dropVisualIndex !== null && dropVisualIndex === dropRows.length;

  useEffect(() => {
    const next = readState(props.state);
    if (!next) { store.setState({ uri: null, rendering: false }); return; }
    const selection = store.getState().selectedId;
    if (!next.layers.some(layer => layer.id === selection)) store.setState({ selectedId: next.layers.at(-1)?.id ?? null });
    try { validatePreviewSize(next.width, next.height); }
    catch (cause) { store.setState({ uri: null, rendering: false, previewError: message(cause) }); return; }
    let active = true;
    store.setState({ rendering: true, previewError: null, notice: '' });
    void (async () => {
      try {
        const result = await current.current.apply('flatten') as { data?: { pixels_b64?: unknown; width?: unknown; height?: unknown } };
        if (!active) return;
        const data = result.data;
        if (!data || data.width !== next.width || data.height !== next.height || typeof data.pixels_b64 !== 'string') throw new Error('The engine returned an inconsistent canvas preview.');
        const png = encodeRgbaPng(next.width, next.height, base64ToBytes(data.pixels_b64));
        if (active) store.setState({ uri: `data:image/png;base64,${bytesToBase64(png)}`, rendering: false, previewError: null });
      } catch (cause) {
        if (active) store.setState({ uri: null, rendering: false, previewError: message(cause) });
      }
    })();
    return () => { active = false; };
  }, [props.state, retry, store]);

  const run = async (op: string, payload: unknown, label: string) => {
    if (store.getState().busy || current.current.busy || !current.current.state) return;
    store.setState({ busy: true, error: null, notice: '' });
    try {
      const result = await current.current.apply(op, payload) as { data?: { layer_id?: number } };
      if (mounted.current && typeof result.data?.layer_id === 'number') store.setState({ selectedId: result.data.layer_id });
      await current.current.reload();
      if (mounted.current) store.setState({ notice: label });
    } catch (cause) { if (mounted.current) store.setState({ error: message(cause) }); }
    finally { if (mounted.current) store.setState({ busy: false }); }
  };
  const previewLayerDrag = (point: DragPoint) => {
    const session = dragSession.current;
    if (!session) return;
    session.point = point;
    if (!session.viewport || session.rows.length === 0) return;
    const target = layerDropIndex(session.rows, session.id, point, session.viewport);
    store.setState({ drag: { id: session.id, target } });
  };
  const beginLayerDrag = (id: number) => {
    cancelLayerDrag();
    if (store.getState().busy || current.current.busy) return;
    const snapshot = readState(current.current.state);
    if (!snapshot || snapshot.layers.length < 2) return;
    const token = ++dragSequence.current;
    const session = { token, id, signature: JSON.stringify(current.current.state), rows: [] as MeasuredLayer[], viewport: null as MeasuredLayer | null, point: null as DragPoint | null, ready: null as Promise<LayerMeasurements> | null };
    dragSession.current = session;
    store.setState({ selectedId: id, drag: { id, target: null }, notice: 'Moving layer…' });
    const measure = (view: { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void } | null, rowId: number) => new Promise<MeasuredLayer | null>(resolve => {
      if (!view) { resolve(null); return; }
      const timeout = setTimeout(() => resolve(null), 500);
      try { view.measureInWindow((x, y, width, height) => { clearTimeout(timeout); resolve(width > 0 && height > 0 ? { id: rowId, x, y, width, height } : null); }); }
      catch { clearTimeout(timeout); resolve(null); }
    });
    session.ready = Promise.all([measure(layerViewport.current, -1), ...snapshot.layers.slice().reverse().map(layer => measure(rowViews.current.get(layer.id) ?? null, layer.id))]).then(([viewport, ...rows]) => {
      const measured = { viewport: rows.some(row => !row) ? null : viewport ?? null, rows: rows.filter((row): row is MeasuredLayer => !!row) };
      if (mounted.current && dragSession.current === session && token === dragSequence.current) {
        session.viewport = measured.viewport;
        session.rows = measured.rows;
        if (session.point) previewLayerDrag(session.point);
      }
      return measured;
    });
  };
  const commitLayerDrag = async () => {
    const session = dragSession.current;
    if (!session?.ready || !session.point) { cancelLayerDrag(); store.setState({ notice: 'Layer move cancelled' }); return; }
    const isCurrent = () => mounted.current && dragSession.current === session
      && session.token === dragSequence.current && session.signature === JSON.stringify(current.current.state);
    const target = await awaitLayerDrop(session.ready, session.id, session.point, isCurrent);
    if (!isCurrent()) return;
    cancelLayerDrag();
    if (target === null) { store.setState({ notice: 'Layer move cancelled' }); return; }
    const snapshot = readState(current.current.state);
    const index = snapshot?.layers.findIndex(layer => layer.id === session.id) ?? -1;
    if (index < 0 || index === target) { store.setState({ notice: 'Layer order unchanged' }); return; }
    await run('moveLayer', { id: session.id, to_index: target }, 'Layer reordered');
  };
  const control = (label: string, onPress: () => void, disabled = false, selected = false, glyph?: string, visibleLabel?: string, iconOnly = false, hint?: string) => {
    const unavailable = disabled || busy || !!props.busy || !!drag;
    const icon = glyph ? <ForgeIcon name={glyph} size={17} color={unavailable ? chrome.disabledInk : selected ? colors.accent : colors.muted} reducedMotion /> : undefined;
    // `opacity-100` keeps a host's blanket disabled fade off the kit's own
    // disabled ink, which is drawn to be read at full strength.
    const shared = { onPress, disabled: unavailable, variant: 'ghost' as const, size: 'sm' as const, tone: 'carolina' as const,
      cornerRadius: 4, className: `rounded-[4px] border border-transparent${selected ? ' bg-carolina-500/15' : ''}${unavailable ? ' opacity-100' : ''}`,
      ...(label === 'Layers' ? { selected } : {}), ...(hint ? { accessibilityHint: hint } : {}) };
    const button = iconOnly
      ? <IconButton key={label} {...shared} icon={icon} aria-label={label} />
      : <Button key={label} {...shared} title={visibleLabel ?? label} aria-label={label} icon={icon} />;
    // Unavailable controls sit in a recessed well, where the disabled ink
    // still reads (forge-directions.test.ts).
    return unavailable ? <View key={label} style={{ backgroundColor: chrome.well, borderRadius: scale.radius.control }}>{button}</View> : button;
  };
  const addShape = (kind: 'rect' | 'ellipse') => {
    if (!doc) return;
    const w = Math.max(1, Math.round(doc.width * .38)), h = Math.max(1, Math.round(doc.height * .32));
    void run('addShape', { name: `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} ${layers.length + 1}`, shape: { kind, x: Math.max(0, Math.round((doc.width - w) / 2)), y: Math.max(0, Math.round((doc.height - h) / 2)), w, h, fill: FILLS[store.getState().color] } }, `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} added`);
  };
  /** One panel finish for every piece of chrome: the face, its chamfer and the lit top edge. */
  const chromeSurface = { backgroundColor: chrome.body, borderWidth: 1, borderColor: chrome.edge, borderRadius: scale.radius.panel, boxShadow: chrome.depth };
  const panel = <View testID="prism-layers" style={{ width: panelWidth, maxHeight: panelMaxHeight, position: 'absolute', zIndex: 60, top: panelTop, right: 12, ...chromeSurface, overflow: 'visible' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, minHeight: 48, borderBottomWidth: 1, borderBottomColor: chrome.rule }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}>Layers</Text><Badge label={String(layers.length)} tone="neutral" size="xs" className="self-center mr-2 rounded-[4px] overflow-hidden" />
      {control('Close layers', () => store.setState({ layersOpen: false }), false, false, 'close', undefined, true)}
    </View>
    {/* Layer opacity uses the same precision instrument as every studio;
        only its released value becomes a Rust document operation. */}
    {selected && <View style={{ paddingHorizontal: 12, paddingVertical: 8, zIndex: 10 }}>
      <ForgePrecisionScrubber
        label="Layer opacity"
        value={selected.opacity * 100}
        min={0}
        max={100}
        step={1}
        unit="%"
        detents={[0, 25, 50, 75, 100]}
        disabled={busy || !!props.busy || !!drag}
        colors={colors}
        onCommit={value => run('setLayerOpacity', { id: selected.id, opacity: value / 100 }, 'Layer opacity changed')}
      />
    </View>}
      <View ref={layerViewport} collapsable={false} style={{ maxHeight: layerListMaxHeight, flexShrink: 1 }}><ScrollView nestedScrollEnabled removeClippedSubviews={false} scrollEnabled={!drag} onScroll={cancelLayerDrag} scrollEventThrottle={16} style={{ maxHeight: layerListMaxHeight, flexShrink: 1 }}>
        {[...layers].reverse().map(layer => <View key={layer.id} ref={view => { if (view) rowViews.current.set(layer.id, view); else rowViews.current.delete(layer.id); }} collapsable={false} style={{ position: 'relative', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, backgroundColor: selectedId === layer.id ? chrome.selected : 'transparent', borderBottomWidth: 1, borderBottomColor: chrome.rule }}>
          {(dropBefore === layer.id || (dropAtEnd && dropRows.at(-1)?.id === layer.id)) && <View pointerEvents="none" style={{ position: 'absolute', left: 4, right: 4, height: 2, backgroundColor: colors.accent, ...(dropBefore === layer.id ? { top: 0 } : { bottom: 0 }) }} />}
          <DragGrabHandle label={`Drag layer ${layer.name} to reorder`} color={selectedId === layer.id ? chrome.selectedMuted : colors.muted} disabled={busy || props.busy || layers.length < 2}
            onStart={() => beginLayerDrag(layer.id)} onMove={previewLayerDrag} onCommit={() => { void commitLayerDrag(); }} onCancel={cancelLayerDrag} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Select layer ${layer.name}`} accessibilityState={{ selected: selectedId === layer.id }} onPress={() => store.setState({ selectedId: layer.id })} style={{ flex: 1, minWidth: 0, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 2, borderWidth: 1, borderColor: 'transparent', borderRadius: scale.radius.control }}>
            {/* The thumbnail is the layer's own fill; the selected one is ringed in the accent. */}
            <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: scale.radius.control + 2, borderWidth: 2, borderColor: selectedId === layer.id ? (forced ? 'Highlight' : chrome.accent) : 'transparent', ...keepColour }}>
              <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: forced ? 'CanvasText' : chrome.chipEdge, borderRadius: scale.radius.control, backgroundColor: layer.content?.type === 'shape' && layer.content.shape?.fill ? `rgba(${layer.content.shape.fill.slice(0, 3).join(',')},${(layer.content.shape.fill[3] ?? 255) / 255})` : chrome.well, ...keepColour }}><ForgeIcon name={layer.content?.type === 'shape' ? layer.content.shape?.kind === 'ellipse' ? 'ellipse' : 'rectangle' : 'image'} size={15} color={layer.content?.type === 'shape' ? '#FFFFFF' : colors.muted} reducedMotion /></View>
            </View>
            <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: selectedId === layer.id ? '600' : '400' }}>{layer.name}</Text><Text style={{ color: selectedId === layer.id ? chrome.selectedMuted : colors.muted, fontSize: scale.type.label }}>{layer.content?.type === 'shape' ? layer.content.shape?.kind : 'Raster'} · {Math.round(layer.opacity * 100)}%</Text></View>
          </Pressable>
          {control(`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, () => { void run('setLayerVisible', { id: layer.id, visible: !layer.visible }, layer.visible ? 'Layer hidden' : 'Layer shown'); }, false, false, undefined, layer.visible ? 'Hide' : 'Show')}
        </View>)}
        {!layers.length && <EmptyState title="No layers" description="Add a shape or raster layer to begin." className="p-3" tone="carolina" action={<Button title="Add rectangle" onPress={() => addShape('rect')} disabled={busy || !!props.busy || !doc} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" />} />}
      </ScrollView></View>
      {selected && <View style={{ padding: 12, gap: 8 }}>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: chrome.rule, paddingTop: 5 }}>{control('Raise', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex + 1 }, 'Layer raised'); }, selectedIndex === layers.length - 1)}{control('Lower', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex - 1 }, 'Layer lowered'); }, selectedIndex <= 0)}{control('Remove', () => { void run('removeLayer', { id: selected.id }, 'Layer removed'); })}</View>
      </View>}
    {drag && <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2, padding: 10, gap: 4, backgroundColor: chrome.body, borderTopWidth: 1, borderTopColor: chrome.rule }}><Text accessibilityLiveRegion="polite" style={{ color: colors.accent, fontSize: 11 }}>{drag.target === null ? 'Drag within the layer list to choose a position' : `Move to layer position ${drag.target + 1} from bottom`}</Text><Button title="Cancel move" aria-label="Cancel layer move" onPress={cancelLayerDrag} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" /></View>}
  </View>;

  // Persona: a mode control in the toolbar. Its panel follows it in reading
  // order, anchored under it on wide editors and a bottom sheet on phones.
  const personaTriggerView = useRef<StudioViewRef>(null);
  const personaToolbar = useRef<StudioViewRef>(null);
  const personaTurret = useRef<PersonaTurretHandle>(null);
  const personaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (personaTimer.current) clearTimeout(personaTimer.current); }, []);
  const personaStatus = useStore(store, s => s.personaStatus);
  const trigger = useStore(store, s => s.trigger);
  const toolbarHeight = useStore(store, s => s.toolbarHeight);
  const { keys: shortcutKeys, shortcut } = useTurretShortcut();
  const personaStops = personasOn(persona.personas, persona.surface);
  const activeStop = Math.max(0, personaStops.findIndex(p => p.id === persona.activeId));
  const personaLabel = activePersona?.label ?? 'Persona';
  const focusPersonaTrigger = () => {
    if (Platform.OS !== 'web') return;
    const node = personaTriggerView.current as unknown as { querySelector?: (q: string) => { focus?: () => void } | null } | null;
    node?.querySelector?.('[role="button"],button')?.focus?.();
  };
  // RN Web reports layout x from the inline start in RTL, and a direction
  // change moves the trigger without a layout event; the popover is placed
  // physically, so the browser measures it again on every open.
  const measureTrigger = (fallback?: { x: number; width: number }) => {
    type Rect = { left: number; width: number };
    const box = (v: unknown) => (v as { getBoundingClientRect?: () => Rect } | null)?.getBoundingClientRect?.();
    const own = box(personaTriggerView.current), bar = box(personaToolbar.current);
    if (own && bar) store.setState({ trigger: { x: own.left - bar.left - 1, width: own.width } });
    else if (fallback) store.setState({ trigger: fallback });
  };
  const closePersonas = (restoreFocus = true) => {
    if (personaTimer.current) { clearTimeout(personaTimer.current); personaTimer.current = null; }
    personaTurret.current?.cancel();
    store.setState({ personaOpen: false });
    if (restoreFocus) requestAnimationFrame(focusPersonaTrigger);
  };
  const announcePersona = (text: string) => store.setState(s => ({ personaStatus: s.personaStatus === text ? `${text}\u00A0` : text }));
  const sheet = width < PERSONA_SHEET_MAX_WIDTH;
  const toolbarWidth = Math.max(1, Math.min(narrow ? width - 24 : TOOLBAR_MAX_WIDTH, width - (layersOpen && dockedLayers ? panelWidth + 36 : 24)));
  const popoverWidth = Math.min(turretBoxWidth(turretTextScale(), personaStops.length) + PANEL_GUTTER * 2, Math.max(1, width - 24));
  const triggerCentre = trigger.x + trigger.width / 2;
  // Keep the popover on the editor; the arrow keeps pointing at the trigger.
  const popoverLeft = Math.max(Math.min(POPOVER_MIN_LEFT, width - 24 - popoverWidth), Math.min(triggerCentre - popoverWidth / 2, width - 24 - popoverWidth));
  const arrowLeft = Math.max(PERSONA_ARROW, Math.min(popoverWidth - PERSONA_ARROW * 2, triggerCentre - popoverLeft - PERSONA_ARROW / 2));
  const popoverTop = toolbarHeight + PERSONA_ARROW / 2 + 6;
  const pm = workbench.materials[scheme];

  const personaTrigger = <View ref={personaTriggerView} key="persona-trigger" collapsable={false}
    onLayout={event => { const { x, width: w } = event.nativeEvent.layout; measureTrigger({ x, width: w }); }}>
    <Pressable testID="persona-trigger" accessibilityRole="button" aria-expanded={personaOpen} accessibilityState={{ expanded: personaOpen }}
      accessibilityLabel={`Persona: ${personaLabel}`} accessibilityHint="Opens the persona turret"
      onPress={() => { if (props.onOpenPersonas) props.onOpenPersonas(); else if (personaOpen) closePersonas(); else { measureTrigger(); store.setState({ personaOpen: true }); } }}
      style={({ pressed }) => ({
        minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderRadius: scale.radius.control,
        borderWidth: 1, borderColor: 'transparent',
        backgroundColor: personaOpen ? `${colors.accent}26` : pressed ? chrome.press : 'transparent',
        transform: [{ scale: pressed ? forgeFeedbackMotion.press.scale : 1 }],
      }) as never}>
      {/* A small dial: the ring and a pointer set to the active stop. */}
      <View aria-hidden style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: personaOpen ? colors.accent : colors.muted, transform: [{ rotate: `${personaStops.length ? turretDisplayAngle(activeStop, personaStops.length, documentRtl()) : 0}deg` }] }}>
        <View style={{ position: 'absolute', left: 5.75, top: 1.5, width: 1.5, height: 5, borderRadius: 0.75, backgroundColor: colors.accent }} />
      </View>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{personaLabel}</Text>
      {shortcutKeys && activeStop < 9 && <Text style={{ color: colors.muted, fontSize: scale.type.micro + 1, fontVariant: ['tabular-nums'] }}>{shortcut.tag(activeStop + 1)}</Text>}
    </Pressable>
  </View>;

  const personaBody = <>
    {/* The close glyph's own inset is pulled into the gutter, so its edge lines up with the captions. */}
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', minHeight: 44, marginRight: -scale.space.inset }}>
      <Text accessibilityRole="header" style={{ color: pm.text, fontSize: 13, fontWeight: '600', flex: 1 }}>Persona</Text>
      {control('Close personas', () => closePersonas(), false, false, 'close', undefined, true)}
    </View>
    <PersonaTurret handle={personaTurret} personas={persona.personas} surface={persona.surface} activeId={persona.activeId} colors={colors} direction="workbench" scheme={scheme}
      autoFocus onAnnounce={announcePersona} onDismiss={() => closePersonas()}
      onSwitch={id => {
        persona.switchTo(id);
        // Hold the panel for the rim flash that confirms the switch.
        personaTimer.current = setTimeout(() => { personaTimer.current = null; if (mounted.current) closePersonas(); }, forgeFeedbackMotion.commit.ms);
      }}
      {...(props.onPersonaEffect ? { onEffect: props.onPersonaEffect } : {})} />
    {persona.error && <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: scale.type.label, alignSelf: 'stretch' }}>{persona.error}</Text>}
    {/* The ghost button's inset is pulled out, so its glyph sits on the gutter. */}
    {props.onComposePersona && <View style={{ alignSelf: 'stretch', borderTopWidth: 1, borderTopColor: pm.panelEdge, paddingTop: 4, alignItems: 'flex-start' }}>
      <View style={{ marginLeft: -scale.space.inset }}>{control('Compose new persona', () => { closePersonas(false); props.onComposePersona?.(); }, false, false, 'plus', 'Compose new persona', false, 'Opens the Persona Composer')}</View>
    </View>}
  </>;
  const panelSurface = { backgroundColor: chrome.body, borderColor: chrome.edge, boxShadow: chrome.depth };
  const personaKeys = { onKeyDown: (event: StudioKeyboardEvent & { preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (keyboardKey(event) !== 'Escape') return;
    event.preventDefault?.(); event.stopPropagation?.();
    closePersonas();
  } };
  const personaSurface = !personaOpen || props.onOpenPersonas ? null : sheet
    ? <View key="persona-sheet" testID="persona-sheet-layer" style={{ position: 'absolute', left: -13, top: -13, width, height }}>
      <Pressable testID="persona-scrim" focusable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
        onPress={() => closePersonas()} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#000000', opacity: 0.45 }} />
      <View testID="persona-panel" role="dialog" aria-modal aria-label="Personas" accessibilityViewIsModal {...personaKeys}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: Math.min(560, Math.round(height * 0.6)), borderTopWidth: 1, borderTopLeftRadius: scale.radius.panel, borderTopRightRadius: scale.radius.panel, ...panelSurface } as never}>
        <ScrollView contentContainerStyle={{ padding: PANEL_GUTTER, paddingTop: 4, gap: 8, alignItems: 'center' }}>{personaBody}</ScrollView>
      </View>
    </View>
    : <View key="persona-popover" testID="persona-panel" role="dialog" aria-label="Personas" {...personaKeys}
      style={{ position: 'absolute', top: popoverTop, left: popoverLeft, width: popoverWidth, maxHeight: Math.max(240, height - popoverTop - 36), borderWidth: 1, borderRadius: scale.radius.panel, ...panelSurface } as never}>
      {/* The notch: a square turned 45°, its top edges in the panel's edge colour. */}
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: -PERSONA_ARROW / 2 - 1, left: arrowLeft, width: PERSONA_ARROW, height: PERSONA_ARROW, backgroundColor: chrome.body, borderLeftWidth: 1, borderTopWidth: 1, borderColor: chrome.edge, transform: [{ rotate: '45deg' }] }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: PANEL_GUTTER, paddingTop: 4, paddingBottom: 12, gap: 8, alignItems: 'center' }}>{personaBody}</ScrollView>
    </View>;
  const editor = <View className={scheme === 'dark' ? 'scheme-dark' : 'scheme-light'} {...{ onKeyDown: (event: StudioKeyboardEvent) => { if (keyboardKey(event) === 'Escape') cancelLayerDrag(); } }} testID="prism-editor" onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    if (firstMeasurement.current) { firstMeasurement.current = false; store.setState({ width, height, layersOpen: width >= PRISM_DOCKED_LAYERS_MIN_WIDTH }); }
    else store.setState({ width, height });
  }} style={{ flex: 1, minHeight: 0, position: 'relative', backgroundColor: mat.deep }}>
    <View pointerEvents="box-none" style={{ position: 'absolute', left: canvasLeft, top: canvasTop, right: canvasRight, bottom: canvasBottom, alignItems: 'center', justifyContent: 'center' }}>
      {doc && <PrismCanvas document={doc} width={canvasWidth} height={canvasHeight} selectedId={selectedId}
        disabled={busy || !!props.busy || !!drag || rendering || !!previewError} color={colors.accent}
        onSelect={id => store.setState({ selectedId: id })}
        onMoveShape={(id, dx, dy) => { void run('transformShape', { id, dx, dy, scale_x: 1, scale_y: 1 }, 'Shape moved'); }}>
        {uri && !previewError ? <Image testID="prism-composite" accessible accessibilityLabel="Prism canvas composite" source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} onError={() => { if (store.getState().uri === uri) store.setState({ previewError: 'The canvas preview could not be displayed. Retry the preview.' }); }} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}><Text style={{ color: colors.paperInk, fontSize: 12, textAlign: 'center' }}>{previewError ? 'Preview unavailable' : 'Rendering canvas…'}</Text></View>}
      </PrismCanvas>}
    </View>
    <View ref={personaToolbar} onLayout={event => store.setState({ toolbarHeight: event.nativeEvent.layout.height })} style={{ position: 'absolute', zIndex: personaOpen ? 70 : 20, top: 12, left: 12, width: toolbarWidth, minHeight: 48, paddingLeft: 14, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 10, ...chromeSurface }}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{selected?.name ?? 'Artboard'}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: scale.type.label }}>{selected?.content?.type === 'shape' ? 'Shape layer' : selected ? 'Raster layer' : 'Prism document'}{doc ? ` · ${doc.width} × ${doc.height} px` : ''}</Text></View>
      {selected?.content?.type === 'shape' && !props.busy && <Menu key={selected.id} title="Transform shape" triggerLabel="Transform shape"
        actions={SHAPE_TRANSFORMS.map(({ id, title }) => ({ id, title, disabled: busy || !!props.busy || !!drag }))}
        onAction={action => {
          const selection = store.getState().selectedId;
          // Reject stale callbacks. Keep the trigger mounted across our own
          // relative edits so repeated keyboard actions retain focus.
          if (selection !== selected.id || current.current.state !== props.state || store.getState().drag) return;
          const payload = shapeTransformPayload(selected.id, action);
          if (payload) void run('transformShape', payload, 'Shape transformed');
        }}>
        <View style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, opacity: busy || props.busy || drag ? .4 : 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Transform</Text>
        </View>
      </Menu>}
      {personaTrigger}
      {personaSurface}
      {control('Layers', () => store.setState({ layersOpen: !layersOpen }), false, layersOpen, 'layers', undefined, width < 420)}
    </View>
    <View accessibilityLabel="Creation tools" style={{ position: 'absolute', zIndex: 20, left: 12, top: short ? 68 : 76, width: 52, alignItems: 'center', padding: 3, gap: 3, ...chromeSurface }}>
      {activeCaps.has('shapes') && <>
        {control('Rectangle', () => addShape('rect'), !doc, false, 'rectangle', undefined, true, 'Adds a centered rectangle using the selected fill')}
        {control('Ellipse', () => addShape('ellipse'), !doc, false, 'ellipse', undefined, true, 'Adds a centered ellipse using the selected fill')}
      </>}
      {activeCaps.has('shapes') && activeCaps.has('raster-layers') && <View style={{ height: 1, width: 26, backgroundColor: chrome.rule }} />}
      {activeCaps.has('raster-layers') && control('Raster layer', () => { void run('addRasterLayer', { name: `Raster ${layers.length + 1}` }, 'Raster layer added'); }, !doc, false, 'image', undefined, true, 'Adds an empty raster layer')}
      {!activeCaps.has('shapes') && !activeCaps.has('raster-layers') && <Text accessibilityRole="text" style={{ color: colors.muted, fontSize: scale.type.label, textAlign: 'center', paddingVertical: 6 }}>No tools in this build</Text>}
    </View>
    {layersOpen && panel}
    <View testID="prism-fill-bar" style={{ position: 'absolute', zIndex: 25, left: fillLeft, bottom: 20, width: fillWidth, minHeight: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, ...chromeSurface }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minHeight: 50, alignItems: 'center', flexDirection: 'row', gap: 2 }} style={{ flex: 1 }}>
      {!narrow && <Text style={{ color: colors.muted, fontSize: scale.type.label, marginRight: 8 }}>{selected ? 'Fill' : 'New shape fill'}</Text>}
      {/* Each chip sits in a 44 pt target. The chosen one is ringed with a gap,
          in the engraving colour, or the system highlight under forced colours. */}
      {FILL_COLORS.map((fill, index) => <Pressable key={fill} accessibilityRole="button" accessibilityLabel={`Choose ${FILL_NAMES[index]} fill`} accessibilityState={{ selected: color === index }} onPress={() => store.setState({ color: index })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', borderRadius: scale.radius.control }}>
        <View style={{ width: 33, height: 33, alignItems: 'center', justifyContent: 'center', borderRadius: scale.radius.control + 2, borderWidth: 2, borderColor: color === index ? (forced ? 'Highlight' : chrome.chipRing) : 'transparent', ...keepColour }}>
          <View style={{ width: 25, height: 25, backgroundColor: fill, borderRadius: scale.radius.control, borderWidth: 1, borderColor: forced ? 'CanvasText' : chrome.chipEdge, ...keepColour }} />
        </View>
      </Pressable>)}
      {selected && <><View style={{ width: 1, height: 24, backgroundColor: chrome.rule, marginHorizontal: 5 }} />{control('Fill layer', () => { void run(selected.content.type === 'shape' ? 'setShapeFill' : 'fillLayer', { id: selected.id, color: FILLS[color] }, selected.content.type === 'shape' ? 'Shape fill changed' : 'Raster layer filled'); }, false, false, undefined, short && narrow ? 'Fill' : 'Fill layer')}</>}
      </ScrollView>
    </View>
    {!!feedback && <View style={{ position: 'absolute', zIndex: 35, bottom: 82, left: (width - Math.min(360, width - 24)) / 2, width: Math.min(360, Math.max(1, width - 24)) }}>
      <Banner tone={error || previewError ? 'danger' : 'info'} title={feedback} live={error || previewError ? 'alert' : 'status'} className="rounded-[4px]"
        {...(previewError ? { action: <Button title="Retry preview" onPress={() => store.setState(s => ({ retry: s.retry + 1 }))} disabled={busy || !!props.busy || !!drag} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" /> } : {})} />
    </View>}
    {/* The one live region for persona changes. It stays mounted, so the commit is read after the panel closes. */}
    <Text testID="persona-status" accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>{personaStatus}</Text>
  </View>;
  // Kit controls take the chrome's scheme: night on graphite, day on ceramic.
  return scheme === 'dark' ? <NightScope>{editor}</NightScope> : editor;
}
