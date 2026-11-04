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
import { prismViewportLayout } from './prism-layout';
import { PrismCanvas } from './prism-canvas';
import type { CanvasLayer } from './prism-canvas-model';
import { SHAPE_TRANSFORMS, shapeTransformPayload } from './prism-transform';
import { DragGrabHandle, type DragPoint } from './drag-grab-handle';
import { layerDropIndex, awaitLayerDrop, type LayerMeasurements, type MeasuredLayer } from './layer-drop';

type Layer = CanvasLayer & { name: string };
type PrismState = { width: number; height: number; layers: Layer[] };
type LayerDrag = { id: number; target: number | null };
type LocalState = { drag: LayerDrag | null; selectedId: number | null; uri: string | null; rendering: boolean; busy: boolean; error: string | null; previewError: string | null; notice: string; layersOpen: boolean; width: number; height: number; retry: number; color: number };
/** A real-engine Prism canvas. Selection and panel state are local; all edits use engine commands. */
export interface PrismEditorProps {
  state: unknown;
  apply: (op: string, payload?: unknown) => Promise<unknown>;
  reload: () => Promise<void>;
  theme?: 'dark' | 'light';
  busy?: boolean;
}
const FILLS = [[105, 80, 209, 255], [36, 145, 132, 255], [227, 155, 76, 255], [226, 109, 146, 255]] as const;
const FILL_COLORS = ['#6950D1', '#249184', '#E39B4C', '#E26D92'];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function readState(state: unknown): PrismState | null {
  if (!state || typeof state !== 'object') return null;
  const value = state as Partial<PrismState>;
  return typeof value.width === 'number' && typeof value.height === 'number' && Array.isArray(value.layers) ? value as PrismState : null;
}

/** Render Prism's own raster/vector composite, with bounded PNG transfer to native or web Image. */
export function PrismEditor(props: PrismEditorProps) {
  const mat = prismThemes[props.theme ?? 'dark'];
  // Editing controls remain graphite over the continuous artboard mat.
  const colors = prismThemes.dark;
  const localRef = useRef<StoreApi<LocalState> | null>(null);
  if (!localRef.current) localRef.current = createStore<LocalState>(() => ({ drag: null, selectedId: null, uri: null, rendering: false, busy: false, error: null, previewError: null, notice: '', layersOpen: false, width: 800, height: 600, retry: 0, color: 0 }));
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
  const { narrow, short, panelWidth, panelTop, panelMaxHeight, layerListMaxHeight,
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
    const icon = glyph ? <ForgeIcon name={glyph} size={17} color={selected ? colors.accent : colors.muted} reducedMotion /> : undefined;
    const shared = { onPress, disabled: unavailable, variant: 'ghost' as const, size: 'sm' as const, tone: 'carolina' as const,
      cornerRadius: 4, className: `rounded-[4px]${selected ? ' bg-carolina-500/15' : ''}`,
      ...(label === 'Layers' ? { selected } : {}), ...(hint ? { accessibilityHint: hint } : {}) };
    return iconOnly
      ? <IconButton key={label} {...shared} icon={icon} aria-label={label} />
      : <Button key={label} {...shared} title={visibleLabel ?? label} aria-label={label} icon={icon} />;
  };
  const addShape = (kind: 'rect' | 'ellipse') => {
    if (!doc) return;
    const w = Math.max(1, Math.round(doc.width * .38)), h = Math.max(1, Math.round(doc.height * .32));
    void run('addShape', { name: `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} ${layers.length + 1}`, shape: { kind, x: Math.max(0, Math.round((doc.width - w) / 2)), y: Math.max(0, Math.round((doc.height - h) / 2)), w, h, fill: FILLS[store.getState().color] } }, `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} added`);
  };
  const panel = <View testID="prism-layers" style={{ width: panelWidth, maxHeight: panelMaxHeight, position: 'absolute', zIndex: 60, top: panelTop, right: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, borderRadius: scale.radius.control, overflow: 'visible', boxShadow: '0 12px 30px #00000035' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}>Layers</Text><Badge label={String(layers.length)} tone="neutral" size="xs" className="mr-2 rounded-[4px] overflow-hidden" />
      {control('Close layers', () => store.setState({ layersOpen: false }), false, false, 'close', undefined, true)}
    </View>
    {/* Opacity is above the measured row scroller. The canonical web menu
        opens outside its bounds; only the layer rows own clipping. */}
    {selected && <View style={{ paddingHorizontal: 12, paddingVertical: 8, zIndex: 10 }}>
        <Menu title="Layer opacity" triggerLabel="Layer opacity" actions={[0, .25, .5, .75, 1].map(value => ({ id: String(value), title: `${value * 100}%`, disabled: busy || !!props.busy || !!drag }))}
          onAction={value => { const opacity = Number(value); if (!store.getState().busy && !current.current.busy && !store.getState().drag && [0, .25, .5, .75, 1].includes(opacity)) void run('setLayerOpacity', { id: selected.id, opacity }, 'Layer opacity changed'); }}>
          <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, borderRadius: scale.radius.control, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.base, opacity: busy || props.busy || drag ? .4 : 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11, flex: 1 }}>Opacity</Text><Text style={{ color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] }}>{Math.round(selected.opacity * 100)}%</Text>
            <View style={{ transform: [{ rotate: '90deg' }] }}><ForgeIcon name="play" size={10} color={colors.muted} reducedMotion /></View>
          </View>
        </Menu>
    </View>}
      <View ref={layerViewport} collapsable={false} style={{ maxHeight: layerListMaxHeight, flexShrink: 1 }}><ScrollView nestedScrollEnabled removeClippedSubviews={false} scrollEnabled={!drag} onScroll={cancelLayerDrag} scrollEventThrottle={16} style={{ maxHeight: layerListMaxHeight, flexShrink: 1 }}>
        {[...layers].reverse().map(layer => <View key={layer.id} ref={view => { if (view) rowViews.current.set(layer.id, view); else rowViews.current.delete(layer.id); }} collapsable={false} style={{ position: 'relative', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, backgroundColor: selectedId === layer.id ? '#2468AC' : 'transparent', borderBottomWidth: 1, borderBottomColor: colors.line }}>
          {(dropBefore === layer.id || (dropAtEnd && dropRows.at(-1)?.id === layer.id)) && <View pointerEvents="none" style={{ position: 'absolute', left: 4, right: 4, height: 2, backgroundColor: colors.accent, ...(dropBefore === layer.id ? { top: 0 } : { bottom: 0 }) }} />}
          <DragGrabHandle label={`Drag layer ${layer.name} to reorder`} color={selectedId === layer.id ? '#DFEFFF' : colors.muted} disabled={busy || props.busy || layers.length < 2}
            onStart={() => beginLayerDrag(layer.id)} onMove={previewLayerDrag} onCommit={() => { void commitLayerDrag(); }} onCancel={cancelLayerDrag} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Select layer ${layer.name}`} accessibilityState={{ selected: selectedId === layer.id }} onPress={() => store.setState({ selectedId: layer.id })} style={{ flex: 1, minWidth: 0, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 2 }}>
            <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF35', borderRadius: scale.radius.control, backgroundColor: layer.content?.type === 'shape' && layer.content.shape?.fill ? `rgba(${layer.content.shape.fill.slice(0, 3).join(',')},${(layer.content.shape.fill[3] ?? 255) / 255})` : colors.base }}><ForgeIcon name={layer.content?.type === 'shape' ? layer.content.shape?.kind === 'ellipse' ? 'ellipse' : 'rectangle' : 'image'} size={17} color={selectedId === layer.id ? '#FFFFFF' : colors.muted} reducedMotion /></View>
            <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: selectedId === layer.id ? '600' : '400' }}>{layer.name}</Text><Text style={{ color: selectedId === layer.id ? '#DAEBFC' : colors.muted, fontSize: 9 }}>{layer.content?.type === 'shape' ? layer.content.shape?.kind : 'Raster'} · {Math.round(layer.opacity * 100)}%</Text></View>
          </Pressable>
          {control(`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, () => { void run('setLayerVisible', { id: layer.id, visible: !layer.visible }, layer.visible ? 'Layer hidden' : 'Layer shown'); }, false, false, undefined, layer.visible ? 'Hide' : 'Show')}
        </View>)}
        {!layers.length && <EmptyState title="No layers" description="Add a shape or raster layer to begin." className="p-3" tone="carolina" action={<Button title="Add rectangle" onPress={() => addShape('rect')} disabled={busy || !!props.busy || !doc} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" />} />}
      </ScrollView></View>
      {selected && <View style={{ padding: 12, gap: 8 }}>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 5 }}>{control('Raise', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex + 1 }, 'Layer raised'); }, selectedIndex === layers.length - 1)}{control('Lower', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex - 1 }, 'Layer lowered'); }, selectedIndex <= 0)}{control('Remove', () => { void run('removeLayer', { id: selected.id }, 'Layer removed'); })}</View>
      </View>}
    {drag && <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2, padding: 10, gap: 4, backgroundColor: colors.raised, borderTopWidth: 1, borderTopColor: colors.line }}><Text accessibilityLiveRegion="polite" style={{ color: colors.accent, fontSize: 11 }}>{drag.target === null ? 'Drag within the layer list to choose a position' : `Move to layer position ${drag.target + 1} from bottom`}</Text><Button title="Cancel move" aria-label="Cancel layer move" onPress={cancelLayerDrag} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" /></View>}
  </View>;
  return <NightScope><View className="scheme-dark" {...{ onKeyDown: (event: StudioKeyboardEvent) => { if (keyboardKey(event) === 'Escape') cancelLayerDrag(); } }} testID="prism-editor" onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    if (firstMeasurement.current) { firstMeasurement.current = false; store.setState({ width, height, layersOpen: width >= 700 }); }
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
    <View style={{ position: 'absolute', zIndex: 20, top: 12, left: 12, width: Math.max(1, Math.min(narrow ? width - 24 : 360, width - (layersOpen && !narrow ? panelWidth + 36 : 24))), minHeight: 48, paddingLeft: 14, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.control, backgroundColor: colors.base, boxShadow: '0 4px 14px #00000020' }}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{selected?.name ?? 'Artboard'}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 9 }}>{selected?.content?.type === 'shape' ? 'Shape layer' : selected ? 'Raster layer' : 'Prism document'}{doc ? ` · ${doc.width} × ${doc.height} px` : ''}</Text></View>
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
      {control('Layers', () => store.setState({ layersOpen: !layersOpen }), false, layersOpen, 'layers')}
    </View>
    <View accessibilityLabel="Creation tools" style={{ position: 'absolute', zIndex: 20, left: 12, top: short ? 68 : 76, width: 52, alignItems: 'center', padding: 3, gap: 3, borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.control, backgroundColor: colors.base, boxShadow: '0 4px 14px #00000020' }}>
      {control('Rectangle', () => addShape('rect'), !doc, false, 'rectangle', undefined, true, 'Adds a centered rectangle using the selected fill')}
      {control('Ellipse', () => addShape('ellipse'), !doc, false, 'ellipse', undefined, true, 'Adds a centered ellipse using the selected fill')}
      <View style={{ height: 1, width: 26, backgroundColor: colors.line }} />
      {control('Raster layer', () => { void run('addRasterLayer', { name: `Raster ${layers.length + 1}` }, 'Raster layer added'); }, !doc, false, 'image', undefined, true, 'Adds an empty raster layer')}
    </View>
    {layersOpen && panel}
    <View testID="prism-fill-bar" style={{ position: 'absolute', zIndex: 25, left: fillLeft, bottom: 20, width: fillWidth, minHeight: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.control, backgroundColor: colors.base, boxShadow: '0 6px 20px #00000025' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minHeight: 50, alignItems: 'center', flexDirection: 'row', gap: 2 }} style={{ flex: 1 }}>
      {!narrow && <Text style={{ color: colors.muted, fontSize: 10, marginRight: 8 }}>{selected ? 'Fill' : 'New shape fill'}</Text>}
      {FILL_COLORS.map((fill, index) => <Pressable key={fill} accessibilityRole="button" accessibilityLabel={`Choose ${['violet', 'teal', 'amber', 'rose'][index]} fill`} accessibilityState={{ selected: color === index }} onPress={() => store.setState({ color: index })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 25, height: 25, backgroundColor: fill, borderRadius: scale.radius.control, borderWidth: color === index ? 3 : 1, borderColor: color === index ? '#FFFFFF' : '#FFFFFF50' }} /></Pressable>)}
      {selected && <><View style={{ width: 1, height: 24, backgroundColor: colors.line, marginHorizontal: 5 }} />{control('Fill layer', () => { void run(selected.content.type === 'shape' ? 'setShapeFill' : 'fillLayer', { id: selected.id, color: FILLS[color] }, selected.content.type === 'shape' ? 'Shape fill changed' : 'Raster layer filled'); }, false, false, undefined, short && narrow ? 'Fill' : 'Fill layer')}</>}
      </ScrollView>
    </View>
    {!!feedback && <View style={{ position: 'absolute', zIndex: 35, bottom: 82, left: (width - Math.min(360, width - 24)) / 2, width: Math.min(360, Math.max(1, width - 24)) }}>
      <Banner tone={error || previewError ? 'danger' : 'info'} title={feedback} live={error || previewError ? 'alert' : 'status'} className="rounded-[4px]"
        {...(previewError ? { action: <Button title="Retry preview" onPress={() => store.setState(s => ({ retry: s.retry + 1 }))} disabled={busy || !!props.busy || !!drag} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" /> } : {})} />
    </View>}
  </View></NightScope>;
}
