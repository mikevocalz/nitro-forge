import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, PanResponder, Pressable, ScrollView, Text, View, useColorScheme, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DOCKS, dockPanel, type Dock, type DockAction, type Rect, type Studio } from '@nitro-forge/studio-layout';
import { createStudioWorkspaceStore, MIN_STAGE_HEIGHT, MIN_STAGE_WIDTH, PANEL_IDS, KNOWN_PANELS } from './model';
import { ForgeDocumentStage } from './stage';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { workspaceThemes, workspaceScale as scale, type WorkspaceColors } from './theme';
export { createStudioWorkspaceStore } from './model';
export { ForgeDocumentStage } from './stage';

export type WorkspaceRow = { label: string; value: string };
export type WorkspaceAction = { title: string; run: () => Promise<unknown> | unknown };
export type ForgeWorkspaceProps = {
  studioId: Studio; title: string; documentTitle: string; state: unknown;
  rows: WorkspaceRow[]; actions: WorkspaceAction[];
  onUndo: () => Promise<unknown> | unknown; onRedo: () => Promise<unknown> | unknown;
  onSave: () => Promise<unknown> | unknown; onRefresh: () => Promise<unknown> | unknown;
  headerLeading?: ReactNode; headerTrailing?: ReactNode; leadingActions?: ReactNode;
  themeOverrides?: Partial<WorkspaceColors>;
  busy?: boolean; error?: string | null; children?: ReactNode;
  /** Host storage and blocked geometry are ports; no credentials or documents in presets. */
  loadPreset?: () => Promise<string | null>; persistPreset?: (raw: string) => Promise<void>;
  blockedRegions?: readonly Rect[]; theme?: 'dark' | 'light';
};
const panelNames: Record<string, string> = { outline: 'Document', properties: 'Properties', actions: 'Commands', history: 'History' };
const panelIcons: Record<string, string> = { outline: 'layers', properties: 'settings', actions: 'plus', history: 'undo' };
const appIcons: Record<Studio, string> = { quill: 'text', prism: 'brush', tally: 'table', pitch: 'slide', folio: 'pdf', splice: 'video', cadence: 'music' };

/** Shared inner editor chrome. The host owns and supplies one stable engine document. */
export function ForgeWorkspace(props: ForgeWorkspaceProps) {
  const systemTheme = useColorScheme();
  const appearance = (props.theme ?? systemTheme) === 'light' ? 'light' : 'dark';
  const colors: WorkspaceColors = { ...workspaceThemes[appearance], ...props.themeOverrides };
  const store = useMemo(() => createStudioWorkspaceStore(props.studioId), [props.studioId]);
  const ui = useMemo(() => createStore(() => ({ arranging: false, menu: false, reducedMotion: true, width: 1200 })), [props.studioId]);
  const arranging = useStore(ui, s => s.arranging);
  const menu = useStore(ui, s => s.menu);
  const reducedMotion = useStore(ui, s => s.reducedMotion);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) ui.setState({ reducedMotion: value }); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => ui.setState({ reducedMotion: value }));
    return () => { active = false; subscription.remove(); };
  }, [ui]);
  const layout = useStore(store, s => s.layout);
  const geometry = useStore(store, s => s.geometry);
  const drag = useStore(store, s => s.drag);
  const status = useStore(store, s => s.status);
  const layoutError = useStore(store, s => s.error);
  const shell = useRef<View>(null);
  const hostRect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const savedPreset = useMemo(() => ({ current: null as string | null }), [store]);
  const operation = useMemo(() => ({ current: false }), [store]);
  // Breakpoints use the stable outer width; the rail must not change its own breakpoint.
  const compact = useStore(ui, s => s.width) < 700;

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
  const button = (label: string, onPress: () => void, selected = false, disabled = false, small = false, iconOnly = false, glyph?: string) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => ({ minHeight: scale.size.target, minWidth: scale.size.target, paddingHorizontal: iconOnly ? 10 : small ? 10 : 14,
        justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: scale.space.element, borderRadius: scale.radius.control,
        backgroundColor: selected ? colors.soft : pressed ? colors.line : 'transparent', opacity: disabled ? .4 : 1 })}>
      {({ pressed }) => <>
        {glyph && <ForgeIcon name={glyph} size={18} selected={selected} pressed={pressed} disabled={disabled}
          appearance={appearance} color={selected ? colors.accent : colors.muted} selectedColor={colors.accent} surfaceColor={selected ? colors.soft : colors.base} reducedMotion={reducedMotion} />}
        {!iconOnly && <Text style={{ fontSize: scale.type.label, fontWeight: selected ? '600' : '400', color: selected ? colors.accent : colors.text }}>{label}</Text>}
      </>}
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
        <Text style={{ color: colors.muted, fontSize: scale.type.label, fontWeight: '500', flex: 1 }}>{panelNames[id]}</Text>
        {arranging && <DragHandle id={id} store={store} measure={measure} hostRect={hostRect} blockedRegions={props.blockedRegions} color={colors.muted} />}
        {button(`Hide ${panelNames[id]}`, () => action(id, 'collapse'), false, false, true, true, 'close')}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
        {id === 'outline' && <>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10 }}><ForgeIcon name={appIcons[props.studioId]} size={20} color={colors.accent} reducedMotion={reducedMotion} /><Text style={{ color: colors.text, fontSize: scale.type.body, fontWeight: '500', flex: 1 }}>{props.documentTitle}</Text></View>
          {props.rows.map((row, index) => <View key={index} style={{ borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 10, gap: 4 }}>
            <Text selectable style={{ color: colors.muted, fontSize: 10 }}>{row.label}</Text>
            <Text selectable numberOfLines={2} style={{ color: colors.text, fontSize: scale.type.label, lineHeight: 19 }}>{row.value || 'Empty paragraph'}</Text>
          </View>)}
        </>}
        {id === 'properties' && <>
          <Text style={{ color: colors.muted, fontSize: 10, letterSpacing: 1.1 }}>DOCUMENT DETAILS</Text>
          {props.rows.length ? props.rows.map((row, index) => <View key={index} style={{ gap: 6, paddingVertical: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{row.label}</Text>
            <Text selectable style={{ color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{row.value}</Text>
          </View>) : <Text style={{ color: colors.muted }}>Open a document to inspect its properties.</Text>}
        </>}
        {id === 'actions' && <>
          <Text style={{ color: colors.muted, fontSize: 10, letterSpacing: 1.1 }}>AVAILABLE ACTIONS</Text>
          {props.actions.map(item => <View key={item.title} style={{ backgroundColor: colors.base, borderRadius: scale.radius.control }}>
            {button(item.title, () => { void perform(item.title, item.run); }, false, props.busy)}
          </View>)}
        </>}
        {id === 'history' && <View style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>Document history</Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>Undo and redo your document edits.</Text>
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
        {panels.map(id => button(panelNames[id] ?? id, () => action(id, 'activate'), active === id, false, true, false, panelIcons[id]))}
      </ScrollView>
      {renderPanel(active, dock)}
    </View>;
  };

  const keyboardProps = { onKeyDown: (event: { key: string }) => { if (event.key === 'Escape') { store.getState().cancelDrag(); ui.setState({ menu: false }); } } };
  const rail = <View style={{ width: scale.size.rail, backgroundColor: colors.base, borderRightWidth: 1, borderRightColor: colors.line, alignItems: 'center', paddingVertical: 12, gap: 10 }}>
    {PANEL_IDS.map(id => <View key={id} style={{ alignItems: 'center' }}>
      {button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, false, true, panelIcons[id])}
      <Text style={{ color: !layout.collapsed.includes(id) ? colors.accent : colors.muted, fontSize: scale.type.micro }}>{id === 'properties' ? 'Inspect' : id === 'actions' ? 'Tools' : panelNames[id]}</Text>
    </View>)}
  </View>;
  return <View {...keyboardProps} onLayout={event => {
    const width = event.nativeEvent.layout.width;
    if (width > 0 && width !== ui.getState().width) ui.setState({ width });
  }} testID="forge-workspace" style={{ flex: 1, minHeight: 0, backgroundColor: colors.base }}>
    <View style={{ paddingHorizontal: compact ? 12 : 20, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: compact ? 8 : 16, minHeight: scale.size.header }}>
      {props.headerLeading}
      <View style={{ width: 38, height: 38, backgroundColor: colors.soft, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
        <ForgeIcon name={appIcons[props.studioId]} size={23} selected color={colors.accent} selectedColor={colors.accent} surfaceColor={colors.soft} reducedMotion={reducedMotion} />
      </View>
      <View style={{ flex: 1, minWidth: 40, gap: 4 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '500', fontSize: 14 }}>{props.documentTitle}</Text>
        <Text style={{ color: colors.muted, fontSize: 10 }}>{props.title}</Text>
      </View>
      {props.headerTrailing}
      {button('Save', () => { void perform('Save', props.onSave); }, true, props.busy, false, compact, 'save')}
    </View>
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: 'center', paddingHorizontal: compact ? 8 : 16, minHeight: scale.size.toolbar }}>
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: 4 }}>
        {props.leadingActions}
        <View style={{ width: 1, height: 20, backgroundColor: colors.line, marginHorizontal: 8 }} />
        {button('Undo', () => { void perform('Undo', props.onUndo); }, false, props.busy, true, true, 'undo')}
        {button('Redo', () => { void perform('Redo', props.onRedo); }, false, props.busy, true, true, 'redo')}
      </ScrollView>
      {button('Workspace', () => ui.setState({ menu: !menu }), menu, false, true, compact, 'settings')}
    </View>
    {menu && <View testID="workspace-menu" style={{ position: 'absolute', zIndex: 100, top: scale.size.header + scale.size.toolbar, right: 10, width: 226, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.panel, padding: 8 }}>
      {button(arranging ? 'Done arranging' : 'Arrange panels', () => { ui.setState({ arranging: !arranging, menu: false }); store.getState().cancelDrag(); }, arranging, false, false, false, 'move')}
      {button('Save layout', () => { void perform('Save layout', async () => { const raw = store.getState().savePreset(); if (raw) { savedPreset.current = raw; await props.persistPreset?.(raw); } }); ui.setState({ menu: false }); }, false, false, false, false, 'save')}
      {button('Restore layout', () => { if (savedPreset.current) store.getState().restorePreset(savedPreset.current); else store.setState({ error: 'Save a layout first' }); ui.setState({ menu: false }); }, false, false, false, false, 'folder')}
      {button('Reset layout', () => { store.getState().reset(); ui.setState({ menu: false }); }, false, false, false, false, 'layers')}
      {button('Refresh', () => { void perform('Refresh', props.onRefresh); ui.setState({ menu: false }); }, false, props.busy, false, false, 'file')}
    </View>}
    {arranging && <View style={{ flexDirection: 'row', backgroundColor: colors.soft, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: colors.accent, fontSize: 11 }}>Drag a panel to an edge, or use its move controls.</Text>{button('Done arranging', () => { ui.setState({ arranging: false }); store.getState().cancelDrag(); })}</View>}
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
      {!compact && rail}
    <View ref={shell} onLayout={onLayout} testID="workspace-host" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
        {dockView('left', { width: `${layout.sizes.leftFraction * 100}%` })}
        <View testID="document-stage" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.deep }}>
          {props.children ?? <ForgeDocumentStage studioId={props.studioId} state={props.state} theme={appearance} />}
        </View>
        {dockView('right', { width: `${layout.sizes.rightFraction * 100}%` })}
      </View>
      {dockView('bottom', { height: `${layout.sizes.bottomFraction * 100}%` })}
      {layout.floating.filter(f => !layout.collapsed.includes(f.panelId)).map(f => <View key={f.panelId} style={{ position: 'absolute', left: `${f.rect.x * 100}%`, top: `${f.rect.y * 100}%`, width: `${f.rect.width * 100}%`, height: `${f.rect.height * 100}%`, borderWidth: 1, borderColor: colors.accent }}>{renderPanel(f.panelId)}</View>)}
      {drag?.preview && <View pointerEvents="none" testID="dock-preview" style={{ position: 'absolute', left: drag.preview.rect.x - hostRect.current.x, top: drag.preview.rect.y - hostRect.current.y, width: drag.preview.rect.width, height: drag.preview.rect.height, backgroundColor: colors.accent + '30', borderColor: colors.accent, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>Dock {drag.preview.dock}</Text></View>}
      {drag && <View style={{ position: 'absolute', alignSelf: 'center', top: 8, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.accent }}>{button('Cancel move', () => store.getState().cancelDrag())}</View>}
    </View>
    </View>
    {compact && <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.base, paddingBottom: 6 }}>
      {PANEL_IDS.map(id => <View key={id} style={{ flex: 1, alignItems: 'center' }}>
        {button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, true, true, panelIcons[id])}
        <Text style={{ color: layout.collapsed.includes(id) ? colors.muted : colors.accent, fontSize: scale.type.micro }}>{id === 'properties' ? 'Inspect' : id === 'actions' ? 'Tools' : panelNames[id]}</Text>
      </View>)}
    </View>}
    <View style={{ minHeight: scale.size.status, paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Text accessibilityRole={props.error || layoutError ? 'alert' : undefined} accessibilityLiveRegion="polite" selectable style={{ color: props.error || layoutError ? colors.error : colors.muted, fontSize: 11 }}>{props.error || layoutError || status}</Text>
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
    <ForgeIcon name="move" size={16} color={color} reducedMotion />
  </View>;
}

export { QuillTextEditor, type QuillTextEditorHandle, type QuillTextEditorProps } from './text-editor';
