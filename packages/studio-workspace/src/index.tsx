import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PanResponder, Pressable, ScrollView, Text, View, useColorScheme, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DOCKS, dockPanel, type Dock, type DockAction, type Rect, type Studio } from '@nitro-forge/studio-layout';
import { createStudioWorkspaceStore, MIN_STAGE_HEIGHT, MIN_STAGE_WIDTH, PANEL_IDS, KNOWN_PANELS } from './model';
import { ForgeDocumentStage } from './stage';
export { createStudioWorkspaceStore } from './model';
export { ForgeDocumentStage } from './stage';

export type WorkspaceRow = { label: string; value: string };
export type WorkspaceAction = { title: string; run: () => Promise<unknown> | unknown };
export type ForgeWorkspaceProps = {
  studioId: Studio; title: string; documentTitle: string; state: unknown;
  rows: WorkspaceRow[]; actions: WorkspaceAction[];
  onUndo: () => Promise<unknown> | unknown; onRedo: () => Promise<unknown> | unknown;
  onSave: () => Promise<unknown> | unknown; onRefresh: () => Promise<unknown> | unknown;
  busy?: boolean; error?: string | null; children?: ReactNode;
  /** Host storage and blocked geometry are ports; no credentials or documents in presets. */
  loadPreset?: () => Promise<string | null>; persistPreset?: (raw: string) => Promise<void>;
  blockedRegions?: readonly Rect[]; theme?: 'dark' | 'light';
};
const panelNames: Record<string, string> = { outline: 'Document', properties: 'Properties', actions: 'Commands', history: 'History' };
const dark = { base: '#151718', raised: '#202324', deep: '#0e1011', line: '#383c3e', text: '#eceee8', muted: '#a4aaa6', accent: '#e8b66a', ink: '#151718' };
const light = { base: '#e9ebe6', raised: '#f8f9f5', deep: '#d6dad3', line: '#bec5bd', text: '#202923', muted: '#556359', accent: '#80510a', ink: '#ffffff' };

/** Shared inner editor chrome. The host owns and supplies one stable engine document. */
export function ForgeWorkspace(props: ForgeWorkspaceProps) {
  const systemTheme = useColorScheme();
  const colors = (props.theme ?? systemTheme) === 'light' ? light : dark;
  const store = useMemo(() => createStudioWorkspaceStore(props.studioId), [props.studioId]);
  const ui = useMemo(() => createStore(() => ({ arranging: false })), [props.studioId]);
  const arranging = useStore(ui, s => s.arranging);
  const layout = useStore(store, s => s.layout);
  const geometry = useStore(store, s => s.geometry);
  const drag = useStore(store, s => s.drag);
  const status = useStore(store, s => s.status);
  const layoutError = useStore(store, s => s.error);
  const shell = useRef<View>(null);
  const hostRect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const savedPreset = useMemo(() => ({ current: null as string | null }), [store]);
  const operation = useMemo(() => ({ current: false }), [store]);
  const compact = (geometry?.width ?? 1200) < 700;

  useEffect(() => {
    let active = true;
    void props.loadPreset?.().then(raw => { if (active && raw) { savedPreset.current = raw; store.getState().restorePreset(raw); } })
      .catch(() => { if (active) store.setState({ error: 'Could not load workspace preset' }); });
    return () => { active = false; };
  }, [store, props.loadPreset]);

  const measure = () => shell.current?.measureInWindow((x, y, width, height) => { hostRect.current = { x, y, width, height }; });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      store.getState().setGeometry({ width, height, minStageWidth: Math.min(MIN_STAGE_WIDTH, width), minStageHeight: width < 700 ? Math.min(160, height * 0.4) : Math.min(MIN_STAGE_HEIGHT, height) });
      if (width < 700) {
        const current = store.getState();
        for (const id of [...current.layout.docks.left, ...current.layout.docks.right]) current.action(id, 'collapse');
      }
      measure();
    }
  };
  const perform = async (label: string, action: () => Promise<unknown> | unknown) => {
    if (operation.current || props.busy) return;
    operation.current = true;
    store.setState({ status: `${label}…`, error: null });
    try { await action(); store.setState({ status: label === 'Save' ? 'Document snapshot generated' : `${label} complete` }); }
    catch (error) { store.setState({ error: error instanceof Error ? error.message : String(error) }); }
    finally { operation.current = false; }
  };
  const button = (label: string, action: () => void, selected = false, disabled = false, small = false) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled}
      onPress={action} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, paddingHorizontal: small ? 9 : 13, justifyContent: 'center', alignItems: 'center', borderRadius: 6,
        backgroundColor: selected ? colors.accent : pressed ? colors.line : 'transparent', opacity: disabled ? 0.45 : 1 })}>
      <Text style={{ fontSize: small ? 11 : 12, fontWeight: '600', color: selected ? colors.ink : colors.text }}>{label}</Text>
    </Pressable>
  );
  const action = (id: string, kind: DockAction) => {
    const current = store.getState();
    if (compact && (kind === 'activate' || kind === 'expand')) {
      const target = dockPanel(current.layout, id, 'bottom', current.layout.docks.bottom.filter(p => p !== id).length,
        KNOWN_PANELS, current.geometry ?? undefined);
      if (target.ok) {
        store.setState({ layout: target.layout });
        current.resize('bottom', 0.5);
      }
    }
    store.getState().action(id, kind);
  };
  const fraction = (dock: Dock) => layout.sizes[dock === 'left' ? 'leftFraction' : dock === 'right' ? 'rightFraction' : 'bottomFraction'];

  function renderPanel(id: string, dock?: Dock) {
    return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.raised }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <Text style={{ color: colors.muted, fontSize: 10, letterSpacing: 1.6, flex: 1 }}>{panelNames[id]?.toUpperCase()}</Text>
        {arranging && <DragHandle id={id} store={store} measure={measure} hostRect={hostRect} blockedRegions={props.blockedRegions} color={colors.muted} />}
        {button(`Hide ${panelNames[id]}`, () => action(id, 'collapse'), false, false, true)}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
        {id === 'outline' && <>
          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>{props.title} document</Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{props.documentTitle}</Text>
          {props.rows.map((row, index) => <View key={index} style={{ borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 10, gap: 4 }}>
            <Text selectable style={{ color: colors.text, fontSize: 12 }}>{row.label}</Text>
            <Text selectable style={{ color: colors.muted, fontSize: 11 }}>{row.value}</Text>
          </View>)}
        </>}
        {id === 'properties' && <>
          <Text style={{ color: colors.muted, fontSize: 11 }}>DOCUMENT PROPERTIES</Text>
          {props.rows.length ? props.rows.map((row, index) => <View key={index} style={{ gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{row.label}</Text>
            <Text selectable style={{ color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{row.value}</Text>
          </View>) : <Text style={{ color: colors.muted }}>Open a document to inspect its properties.</Text>}
        </>}
        {id === 'actions' && <>
          <Text style={{ color: colors.muted, fontSize: 11 }}>ENGINE COMMANDS</Text>
          {props.actions.map(item => <View key={item.title} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 6 }}>
            {button(item.title, () => { void perform(item.title, item.run); }, false, props.busy)}
          </View>)}
        </>}
        {id === 'history' && <View style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>Engine undo history</Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>Undo and redo operate on your open document. Moving a panel changes only this workspace.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>{button('Undo', () => { void perform('Undo', props.onUndo); }, false, props.busy)}{button('Redo', () => { void perform('Redo', props.onRedo); }, false, props.busy)}</View>
        </View>}
        {arranging && <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, gap: 4 }}>
          <Text style={{ color: colors.muted, fontSize: 10, letterSpacing: 1 }}>PANEL POSITION</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{DOCKS.map(zone => button(`Move ${zone}`, () => action(id, `move-${zone}`), dock === zone, false, true))}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {button('Move before', () => action(id, 'move-before'), false, false, true)}
            {button('Move after', () => action(id, 'move-after'), false, false, true)}
            {dock && button(dock === 'bottom' ? 'Shorter' : 'Narrower', () => { store.getState().resize(dock, Math.max(0.1, fraction(dock) - 0.04)); }, false, false, true)}
            {dock && button(dock === 'bottom' ? 'Taller' : 'Wider', () => { store.getState().resize(dock, fraction(dock) + 0.04); }, false, false, true)}
          </View>
        </View>}
      </ScrollView>
    </View>;
  }
  const dockView = (dock: Dock, style: ViewStyle) => {
    const panels = layout.docks[dock].filter(id => !layout.collapsed.includes(id));
    if (!panels.length) return null;
    const active = panels.includes(layout.activeTabs[dock] ?? '') ? layout.activeTabs[dock]! : panels[0]!;
    return <View key={dock} testID={`dock-${dock}`} style={[{ borderColor: colors.line, borderWidth: 1, overflow: 'hidden', minHeight: 0 }, style]}>
      <ScrollView horizontal style={{ flexGrow: 0, backgroundColor: colors.base }} contentContainerStyle={{ gap: 2, paddingHorizontal: 5 }}>
        {panels.map(id => button(panelNames[id] ?? id, () => action(id, 'activate'), active === id, false, true))}
      </ScrollView>
      {renderPanel(active, dock)}
    </View>;
  };

  const keyboardProps = { onKeyDown: (event: { key: string }) => { if (event.key === 'Escape') store.getState().cancelDrag(); } };
  return <View {...keyboardProps} testID="forge-workspace" style={{ flex: 1, minHeight: 0, backgroundColor: colors.base }}>
    <View style={{ paddingHorizontal: compact ? 12 : 22, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64 }}>
      <View style={{ width: 30, height: 30, backgroundColor: colors.accent, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.ink, fontWeight: '900', fontSize: 18 }}>N</Text></View>
      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>NitroForge <Text style={{ color: colors.muted, fontWeight: '400' }}>/ {props.title}</Text></Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>{props.documentTitle}</Text></View>
      {button('Save', () => { void perform('Save', props.onSave); }, true, props.busy)}
    </View>
    <ScrollView horizontal style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.line }} contentContainerStyle={{ paddingHorizontal: 10, alignItems: 'center', gap: 6 }}>
      <Text style={{ color: colors.accent, fontSize: 10, letterSpacing: 1.8, marginHorizontal: 10 }}>WORKSPACE</Text>
      {button('Undo', () => { void perform('Undo', props.onUndo); }, false, props.busy)}
      {button('Redo', () => { void perform('Redo', props.onRedo); }, false, props.busy)}
      {button('Refresh', () => { void perform('Refresh', props.onRefresh); }, false, props.busy)}
      <View style={{ width: 1, height: 18, backgroundColor: colors.line, marginHorizontal: 6 }} />
      {button(arranging ? 'Done arranging' : 'Arrange panels', () => { ui.setState({ arranging: !arranging }); store.getState().cancelDrag(); }, arranging)}
      {button('Save layout', () => { void perform('Save layout', async () => { const raw = store.getState().savePreset(); if (raw) { savedPreset.current = raw; await props.persistPreset?.(raw); } }); })}
      {button('Restore layout', () => { if (savedPreset.current) store.getState().restorePreset(savedPreset.current); else store.setState({ error: 'Save a layout first' }); })}
      {button('Reset layout', () => store.getState().reset())}
    </ScrollView>
    <View ref={shell} onLayout={onLayout} testID="workspace-host" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
        {dockView('left', { width: `${layout.sizes.leftFraction * 100}%` })}
        <View testID="document-stage" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.deep }}>
          <View style={{ flexDirection: 'row', padding: 12, alignItems: 'center', gap: 10 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: props.busy ? colors.muted : colors.accent }} />
            <Text style={{ color: colors.muted, fontSize: 10, letterSpacing: 1.6 }}>{props.title.toUpperCase()} / DOCUMENT STAGE</Text>
          </View>
          {props.children ?? <ForgeDocumentStage studioId={props.studioId} state={props.state} theme={colors === light ? 'light' : 'dark'} />}
        </View>
        {dockView('right', { width: `${layout.sizes.rightFraction * 100}%` })}
      </View>
      {dockView('bottom', { height: `${layout.sizes.bottomFraction * 100}%` })}
      {layout.floating.filter(f => !layout.collapsed.includes(f.panelId)).map(f => <View key={f.panelId} style={{ position: 'absolute', left: `${f.rect.x * 100}%`, top: `${f.rect.y * 100}%`, width: `${f.rect.width * 100}%`, height: `${f.rect.height * 100}%`, borderWidth: 1, borderColor: colors.accent }}>{renderPanel(f.panelId)}</View>)}
      {drag?.preview && <View pointerEvents="none" testID="dock-preview" style={{ position: 'absolute', left: drag.preview.rect.x - hostRect.current.x, top: drag.preview.rect.y - hostRect.current.y, width: drag.preview.rect.width, height: drag.preview.rect.height, backgroundColor: colors.accent + '30', borderColor: colors.accent, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>Dock {drag.preview.dock}</Text></View>}
      {drag && <View style={{ position: 'absolute', alignSelf: 'center', top: 8, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.accent }}>{button('Cancel move', () => store.getState().cancelDrag())}</View>}
    </View>
    <ScrollView horizontal style={{ flexGrow: 0, borderTopWidth: 1, borderTopColor: colors.line }} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 12, gap: 6 }}>
      <Text style={{ color: colors.muted, fontSize: 10, marginRight: 6 }}>PANELS</Text>
      {PANEL_IDS.map(id => button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, true))}
    </ScrollView>
    <View style={{ minHeight: 32, paddingHorizontal: 16, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Text accessibilityRole={props.error || layoutError ? 'alert' : undefined} accessibilityLiveRegion="polite" selectable style={{ color: props.error || layoutError ? '#dc7c70' : colors.muted, fontSize: 11 }}>{props.error || layoutError || status}</Text>
    </View>
  </View>;
}

// Stable component identity keeps the responder alive while preview state updates.
function DragHandle({ id, store, measure, hostRect, blockedRegions, color }: {
  id: string; store: ReturnType<typeof createStudioWorkspaceStore>; measure: () => void;
  hostRect: { current: Rect }; blockedRegions: readonly Rect[] | undefined; color: string;
}) {
  const current = useRef({ measure, blockedRegions });
  current.current = { measure, blockedRegions };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { current.current.measure(); store.getState().beginDrag(id); },
    onPanResponderMove: (_event, gesture) => {
      store.getState().previewDrag({ point: { x: gesture.moveX, y: gesture.moveY }, host: hostRect.current,
        ...(current.current.blockedRegions ? { blockedRegions: current.current.blockedRegions } : {}) });
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: () => { store.getState().commitDrag(); },
    onPanResponderTerminate: () => { store.getState().cancelDrag(); },
  }), [id, store, hostRect]);
  return <View {...responder.panHandlers} accessibilityLabel={`Drag ${panelNames[id]} to a dock edge`}
    style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ color, fontSize: 20 }}>⠿</Text>
  </View>;
}

export { QuillTextEditor, type QuillTextEditorHandle, type QuillTextEditorProps } from './text-editor';
