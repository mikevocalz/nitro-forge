import { useEffect, useRef } from 'react';
import type { View as NativeView } from 'react-native';
import { Image, Pressable, ScrollView, Text, View, Select } from './ui';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { base64ToBytes, bytesToBase64 } from '@nitro-forge/ignition';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { encodeRgbaPng, validatePreviewSize } from './rgba-png';
import { workspaceThemes } from './theme';
import { DragGrabHandle, type DragPoint } from './drag-grab-handle';
import { layerDropIndex, awaitLayerDrop, type LayerMeasurements, type MeasuredLayer } from './layer-drop';

type Layer = { id: number; name: string; opacity: number; visible: boolean; content: { type: string; shape?: { kind: string; fill: number[] } } };
type PrismState = { width: number; height: number; layers: Layer[] };
type LayerDrag = { id: number; target: number | null };
type LocalState = { drag: LayerDrag | null; selectedId: number | null; uri: string | null; rendering: boolean; busy: boolean; error: string | null; previewError: string | null; notice: string; layersOpen: boolean; width: number; retry: number; color: number };
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
  const colors = workspaceThemes[props.theme ?? 'dark'];
  const localRef = useRef<StoreApi<LocalState> | null>(null);
  if (!localRef.current) localRef.current = createStore<LocalState>(() => ({ drag: null, selectedId: null, uri: null, rendering: false, busy: false, error: null, previewError: null, notice: '', layersOpen: false, width: 800, retry: 0, color: 0 }));
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
  const retry = useStore(store, s => s.retry);
  const color = useStore(store, s => s.color);
  const current = useRef(props);
  current.current = props;
  const mounted = useRef(true);
  const firstMeasurement = useRef(true);
  const rowViews = useRef(new Map<number, NativeView>());
  const layerViewport = useRef<NativeView>(null);
  const dragSequence = useRef(0);
  const dragSession = useRef<{ token: number; id: number; signature: string; rows: MeasuredLayer[]; viewport: MeasuredLayer | null; point: DragPoint | null; ready: Promise<LayerMeasurements> | null } | null>(null);
  const cancelLayerDrag = () => {
    ++dragSequence.current;
    dragSession.current = null;
    if (mounted.current && store.getState().drag) store.setState({ drag: null, notice: 'Layer move cancelled' });
  };
  useEffect(() => { cancelLayerDrag(); }, [props.state, width, layersOpen]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const doc = readState(props.state);
  const layers = doc?.layers ?? [];
  const selected = layers.find(layer => layer.id === selectedId);
  const selectedIndex = layers.findIndex(layer => layer.id === selectedId);
  const narrow = width < 700;
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
  const control = (label: string, onPress: () => void, disabled = false, selected = false, glyph?: string, visibleLabel?: string) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy || !!props.busy || !!drag, ...(label === 'Layers' ? { selected } : {}) }} disabled={disabled || busy || props.busy || !!drag} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, minWidth: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 8, backgroundColor: selected ? colors.soft : pressed ? colors.line : 'transparent', opacity: disabled || busy || props.busy || drag ? .4 : 1 })}>
    {glyph && <ForgeIcon name={glyph} size={17} color={selected ? colors.accent : colors.muted} reducedMotion />}
    <Text style={{ color: selected ? colors.accent : colors.text, fontSize: 11, fontWeight: selected ? '600' : '400' }}>{visibleLabel ?? label}</Text>
  </Pressable>;
  const addShape = (kind: 'rect' | 'ellipse') => {
    if (!doc) return;
    const w = Math.max(1, Math.round(doc.width * .38)), h = Math.max(1, Math.round(doc.height * .32));
    void run('addShape', { name: `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} ${layers.length + 1}`, shape: { kind, x: Math.max(0, Math.round((doc.width - w) / 2)), y: Math.max(0, Math.round((doc.height - h) / 2)), w, h, fill: FILLS[store.getState().color] } }, `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} added`);
  };
  const panel = <View testID="prism-layers" style={{ width: narrow ? Math.min(276, Math.max(220, width - 24)) : 264, maxHeight: '85%', position: 'absolute', top: 12, right: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.raised, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 28px #00000020' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 15, paddingRight: 3, borderBottomWidth: 1, borderBottomColor: colors.line }}><Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}>Layers</Text>{control('Close layers', () => store.setState({ layersOpen: false }))}</View>
    <View ref={layerViewport} collapsable={false} style={{ maxHeight: 245, flexShrink: 1 }}><ScrollView removeClippedSubviews={false} scrollEnabled={!drag} onScroll={cancelLayerDrag} scrollEventThrottle={16} style={{ maxHeight: 245, flexShrink: 1 }}>
      {[...layers].reverse().map(layer => <View key={layer.id} ref={view => { if (view) rowViews.current.set(layer.id, view); else rowViews.current.delete(layer.id); }} collapsable={false} style={{ position: 'relative', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, backgroundColor: selectedId === layer.id ? colors.soft : 'transparent', borderBottomWidth: 1, borderBottomColor: colors.line }}>
        {(dropBefore === layer.id || (dropAtEnd && dropRows.at(-1)?.id === layer.id)) && <View pointerEvents="none" style={{ position: 'absolute', left: 4, right: 4, height: 2, backgroundColor: colors.accent, ...(dropBefore === layer.id ? { top: 0 } : { bottom: 0 }) }} />}
        <DragGrabHandle label={`Drag layer ${layer.name} to reorder`} color={colors.muted} disabled={busy || props.busy || layers.length < 2}
          onStart={() => beginLayerDrag(layer.id)} onMove={previewLayerDrag} onCommit={() => { void commitLayerDrag(); }} onCancel={cancelLayerDrag} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Select layer ${layer.name}`} accessibilityState={{ selected: selectedId === layer.id }} onPress={() => store.setState({ selectedId: layer.id })} style={{ flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 5 }}>
          <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 5, backgroundColor: layer.content?.type === 'shape' && layer.content.shape?.fill ? `rgba(${layer.content.shape.fill.slice(0, 3).join(',')},${(layer.content.shape.fill[3] ?? 255) / 255})` : colors.base }}><ForgeIcon name={layer.content?.type === 'shape' ? layer.content.shape?.kind === 'ellipse' ? 'ellipse' : 'rectangle' : 'image'} size={17} color={selectedId === layer.id ? colors.accent : colors.muted} reducedMotion /></View>
          <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 12 }}>{layer.name}</Text><Text style={{ color: colors.muted, fontSize: 9 }}>{layer.content?.type === 'shape' ? layer.content.shape?.kind : 'Raster'} · {Math.round(layer.opacity * 100)}%</Text></View>
        </Pressable>
        {control(`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, () => { void run('setLayerVisible', { id: layer.id, visible: !layer.visible }, layer.visible ? 'Layer hidden' : 'Layer shown'); }, false, false, undefined, layer.visible ? 'Hide' : 'Show')}
      </View>)}
      {!layers.length && <Text style={{ padding: 16, color: colors.muted, fontSize: 12, lineHeight: 19 }}>No layers. Add a shape or raster layer to begin.</Text>}
    </ScrollView></View>
    {drag && <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2, padding: 10, gap: 4, backgroundColor: colors.raised, borderTopWidth: 1, borderTopColor: colors.line }}><Text accessibilityLiveRegion="polite" style={{ color: colors.accent, fontSize: 11 }}>{drag.target === null ? 'Drag within the layer list to choose a position' : `Move to layer position ${drag.target + 1} from bottom`}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel layer move" onPress={cancelLayerDrag} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.text, fontSize: 12 }}>Cancel move</Text></Pressable></View>}
    {selected && <View style={{ padding: 12, gap: 7 }}>
      <Select label="Layer opacity" value={String(selected.opacity)} disabled={busy || !!props.busy || !!drag}
        options={[0, .25, .5, .75, 1].map(value => ({ value: String(value), label: `${value * 100}%` }))}
        onValueChange={value => { const opacity = Number(value); if ([0, .25, .5, .75, 1].includes(opacity)) void run('setLayerOpacity', { id: selected.id, opacity }, 'Layer opacity changed'); }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{control('Raise', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex + 1 }, 'Layer raised'); }, selectedIndex === layers.length - 1)}{control('Lower', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex - 1 }, 'Layer lowered'); }, selectedIndex <= 0)}{control('Remove', () => { void run('removeLayer', { id: selected.id }, 'Layer removed'); })}</View>
    </View>}
  </View>;
  return <View {...{ onKeyDown: (event: { key: string }) => { if (event.key === 'Escape') cancelLayerDrag(); } }} testID="prism-editor" onLayout={event => { const width = event.nativeEvent.layout.width; if (width <= 0) return; if (firstMeasurement.current) { firstMeasurement.current = false; store.setState({ width, layersOpen: width >= 700 }); } else store.setState({ width }); }} style={{ flex: 1, minHeight: 0, backgroundColor: colors.deep }}>
    <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.base, paddingHorizontal: 8 }}>
      <ScrollView horizontal contentContainerStyle={{ alignItems: 'center', gap: 2 }} style={{ flex: 1 }}>{control('Rectangle', () => addShape('rect'), !doc, false, 'rectangle')}{control('Ellipse', () => addShape('ellipse'), !doc, false, 'ellipse')}{control('Raster layer', () => { void run('addRasterLayer', { name: `Raster ${layers.length + 1}` }, 'Raster layer added'); }, !doc, false, 'image')}</ScrollView>
      {control('Layers', () => store.setState({ layersOpen: !layersOpen }), false, layersOpen, 'layers')}
    </View>
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView contentContainerStyle={{ padding: narrow ? 16 : 28, paddingRight: layersOpen && !narrow ? 292 : narrow ? 16 : 28, paddingBottom: 40, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>Artboard</Text><Text style={{ color: colors.muted, fontSize: 10 }}>{doc ? `${doc.width} × ${doc.height} px` : 'Opening…'}</Text></View>
        <View style={{ width: '100%', maxWidth: 620, alignSelf: 'center', aspectRatio: doc && doc.width > 0 && doc.height > 0 ? doc.width / doc.height : 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
          {uri && !previewError ? <Image testID="prism-composite" accessible accessibilityLabel="Prism canvas composite" source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} onError={() => { if (store.getState().uri === uri) store.setState({ previewError: 'The canvas preview could not be displayed. Retry the preview.' }); }} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}><Text style={{ color: colors.paperInk, fontSize: 12, textAlign: 'center' }}>{previewError ? 'Preview unavailable' : 'Rendering canvas…'}</Text></View>}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}><Text style={{ color: colors.muted, fontSize: 10, marginRight: 8 }}>SHAPE / RASTER FILL</Text>{FILL_COLORS.map((fill, index) => <Pressable key={fill} accessibilityRole="button" accessibilityLabel={`Choose ${['violet', 'teal', 'amber', 'rose'][index]} fill`} accessibilityState={{ selected: color === index }} onPress={() => store.setState({ color: index })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 24, height: 24, backgroundColor: fill, borderRadius: 6, borderWidth: color === index ? 3 : 1, borderColor: color === index ? colors.text : colors.line }} /></Pressable>)}{selected?.content?.type === 'raster' && control('Fill layer', () => { void run('fillLayer', { id: selected.id, color: FILLS[color] }, 'Raster layer filled'); })}</View>
        <Text accessibilityLiveRegion="polite" style={{ color: error || previewError ? colors.error : colors.muted, fontSize: 11, lineHeight: 18 }}>{error ?? previewError ?? (rendering ? 'Updating engine composite…' : notice || 'Raster and shape layers composited by Prism. Transparency appears on white.')}</Text>
        {previewError && control('Retry preview', () => store.setState(s => ({ retry: s.retry + 1 })))}
      </ScrollView>
      {layersOpen && panel}
    </View>
  </View>;
}
