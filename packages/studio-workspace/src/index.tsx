import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme, type View as NativeView, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Pressable, ScrollView, Text, View, Menu } from './ui';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DOCKS, dockPanel, type Dock, type DockAction, type Rect, type Studio } from '@nitro-forge/studio-layout';
import { createStudioWorkspaceStore, MIN_STAGE_HEIGHT, MIN_STAGE_WIDTH, PANEL_IDS, KNOWN_PANELS } from './model';
import { ForgeDocumentStage } from './stage';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { DragGrabHandle } from './drag-grab-handle';
import { workspaceThemes, prismThemes, workspaceScale as scale, type WorkspaceColors } from './theme';
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
const panelIcons: Record<string, string> = { outline: 'file', properties: 'layers', actions: 'plus', history: 'undo' };
const panelHeadings: Record<string, string> = { outline: 'Document structure', properties: 'Inspector', actions: 'Document commands', history: 'Edit history' };
const appIcons: Record<Studio, string> = { quill: 'text', prism: 'brush', tally: 'table', pitch: 'slide', folio: 'pdf', splice: 'video', cadence: 'music' };

/** Shared inner editor chrome. The host owns and supplies one stable engine document. */
export function ForgeWorkspace(props: ForgeWorkspaceProps) {
  const systemTheme = useColorScheme();
  const appearance = (props.theme ?? systemTheme) === 'light' ? 'light' : 'dark';
  const canvasStudio = props.studioId === 'prism';
  const colors: WorkspaceColors = { ...(canvasStudio ? prismThemes : workspaceThemes)[appearance], ...props.themeOverrides };
  const store = useMemo(() => createStudioWorkspaceStore(props.studioId), [props.studioId]);
  const ui = useMemo(() => createStore(() => ({ arranging: false, reducedMotion: true, width: 1200 })), [props.studioId]);
  const arranging = useStore(ui, s => s.arranging);
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
  const shell = useRef<NativeView>(null);
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
  const button = (label: string, onPress: () => void, selected = false, disabled = false, small = false, iconOnly = false, glyph?: string, primary = false) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(Object.values(panelNames).includes(label) ? { selected } : {}) }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => ({ minHeight: scale.size.target, minWidth: scale.size.target, paddingHorizontal: iconOnly ? 10 : small ? 10 : 14,
        justifyContent: iconOnly || primary ? 'center' : 'flex-start', alignItems: 'center', flexDirection: 'row', gap: scale.space.element, borderRadius: scale.radius.control,
        borderWidth: 1, borderColor: primary ? colors.accent : selected ? colors.accent + '35' : 'transparent',
        backgroundColor: primary ? colors.accent : selected ? colors.soft : pressed ? colors.line : 'transparent', opacity: disabled ? .4 : 1 })}>
      {({ pressed }) => <>
        {glyph && <ForgeIcon name={glyph} size={18} selected={selected} pressed={pressed} disabled={disabled}
          appearance={appearance} color={primary ? colors.ink : selected ? colors.accent : colors.muted} selectedColor={primary ? colors.ink : colors.accent} surfaceColor={primary ? colors.accent : selected ? colors.soft : colors.base} reducedMotion={reducedMotion} />}
        {!iconOnly && <Text style={{ fontSize: scale.type.label, fontWeight: selected ? '600' : '400', color: primary ? colors.ink : selected ? colors.accent : colors.text }}>{label}</Text>}
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
      {(!dock || arranging) && <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, minHeight: 52 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}>{panelHeadings[id]}</Text>
        {arranging && <DragHandle id={id} store={store} measure={measure} hostRect={hostRect} blockedRegions={props.blockedRegions} color={colors.muted} />}
        {button(`Hide ${panelNames[id]}`, () => action(id, 'collapse'), false, false, true, true, 'close')}
      </View>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: dock && !arranging ? 16 : 0, paddingBottom: 18, gap: 14 }}>
        {id === 'outline' && <>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, backgroundColor: colors.base, borderRadius: scale.radius.control }}><ForgeIcon name={appIcons[props.studioId]} size={20} color={colors.accent} reducedMotion={reducedMotion} /><Text style={{ color: colors.text, fontSize: scale.type.body, fontWeight: '500', flex: 1 }}>{props.documentTitle}</Text></View>
          {props.rows.map((row, index) => <View key={index} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}>
            <View style={{ width: 3, backgroundColor: colors.line, borderRadius: 2 }} />
            <View style={{ flex: 1, gap: 5 }}><Text selectable style={{ color: colors.muted, fontSize: 10 }}>{row.label}</Text>
            <Text selectable numberOfLines={2} style={{ color: colors.text, fontSize: scale.type.label, lineHeight: 19 }}>{row.value || 'Empty paragraph'}</Text></View>
          </View>)}
        </>}
        {id === 'properties' && <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.soft }}><Text style={{ color: colors.accent, fontSize: 10, fontWeight: '600' }}>{props.title}</Text></View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Document details</Text>
          </View>
          <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.control, overflow: 'hidden' }}>
            {props.rows.length ? props.rows.map((row, index) => <View key={index} style={{ gap: 7, padding: 13, borderTopWidth: index ? 1 : 0, borderTopColor: colors.line }}>
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '500' }}>{row.label}</Text>
              <Text selectable style={{ color: colors.text, fontSize: 13, lineHeight: 20, fontVariant: ['tabular-nums'] }}>{row.value}</Text>
            </View>) : <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19, padding: 13 }}>Open a document to inspect its properties.</Text>}
          </View>
        </>}
        {id === 'actions' && <>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>Run an operation on this document.</Text>
          {props.actions.map(item => <View key={item.title} style={{ backgroundColor: colors.base, borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.control }}>
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
    return <View key={dock} testID={`dock-${dock}`} style={[{ minHeight: 0, padding: 8, backgroundColor: colors.deep }, style]}>
      <View style={{ flex: 1, minHeight: 0, borderColor: colors.line, borderWidth: 1, borderRadius: scale.radius.panel, overflow: 'hidden', backgroundColor: colors.raised }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 5, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: 3 }}>
            {panels.map(id => button(panelNames[id] ?? id, () => action(id, 'activate'), active === id, false, true, false, panelIcons[id]))}
          </ScrollView>
          {!arranging && button(`Hide ${panelNames[active]}`, () => action(active, 'collapse'), false, false, true, true, 'close')}
        </View>
        {renderPanel(active, dock)}
      </View>
    </View>;
  };

  const keyboardProps = { onKeyDown: (event: { key: string }) => { if (event.key === 'Escape') { store.getState().cancelDrag(); } } };
  const rail = <View style={{ width: scale.size.rail, backgroundColor: colors.base, borderRightWidth: 1, borderRightColor: colors.line, alignItems: 'center', paddingVertical: 14 }}>
    <View style={{ alignItems: 'center', gap: 12, paddingBottom: 16 }}>
      {PANEL_IDS.filter(id => id !== 'history').map(id => <View key={id} style={{ alignItems: 'center', gap: 4 }}>
        {button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, false, true, panelIcons[id])}
        <Text style={{ color: !layout.collapsed.includes(id) ? colors.accent : colors.muted, fontSize: 9, fontWeight: !layout.collapsed.includes(id) ? '600' : '400' }}>{id === 'properties' ? 'Inspect' : id === 'actions' ? 'Commands' : 'Document'}</Text>
      </View>)}
    </View>
    <View style={{ width: 28, height: 1, backgroundColor: colors.line }} />
    <View style={{ alignItems: 'center', gap: 4, paddingTop: 16 }}>
      {button('History', () => action('history', layout.collapsed.includes('history') ? 'activate' : 'collapse'), !layout.collapsed.includes('history'), false, false, true, panelIcons.history)}
      <Text style={{ color: layout.collapsed.includes('history') ? colors.muted : colors.accent, fontSize: 9 }}>History</Text>
    </View>
  </View>;
  return <View {...keyboardProps} onLayout={event => {
    const width = event.nativeEvent.layout.width;
    if (width > 0 && width !== ui.getState().width) ui.setState({ width });
  }} testID="forge-workspace" style={{ flex: 1, minHeight: 0, backgroundColor: canvasStudio ? colors.deep : colors.base }}>
    <View style={{ paddingHorizontal: compact ? 12 : 20, borderBottomWidth: canvasStudio ? 0 : 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: compact ? 8 : 16, minHeight: canvasStudio ? 52 : scale.size.header, ...(canvasStudio ? { backgroundColor: colors.base, margin: 8, marginBottom: 0, borderRadius: 10, boxShadow: '0 3px 12px #00000020' } : {}) }}>
      {props.headerLeading}
      <View style={{ width: 38, height: 38, backgroundColor: colors.soft, borderRadius: scale.radius.panel, alignItems: 'center', justifyContent: 'center' }}>
        <ForgeIcon name={appIcons[props.studioId]} size={23} selected color={colors.accent} selectedColor={colors.accent} surfaceColor={colors.soft} reducedMotion={reducedMotion} />
      </View>
      <View style={{ flex: 1, minWidth: 40, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10, fontWeight: '600', letterSpacing: .4, flexShrink: 1 }}>{props.title}</Text>{!compact && <><Text style={{ color: colors.line, fontSize: 10 }}> / </Text><Text style={{ color: colors.muted, fontSize: 10 }}>{props.busy ? 'Working…' : 'Document'}</Text></>}</View>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600', fontSize: compact ? 13 : 15 }}>{props.documentTitle}</Text>
      </View>
      {props.headerTrailing}
      {button('Save', () => { void perform('Save', props.onSave); }, true, props.busy, false, compact, 'save', true)}
    </View>
    <View style={{ flexDirection: 'row', borderBottomWidth: canvasStudio ? 0 : 1, borderBottomColor: colors.line, alignItems: 'center', paddingHorizontal: compact ? 8 : 16, minHeight: canvasStudio ? 44 : scale.size.toolbar }}>
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: 4 }}>
        {props.leadingActions}
        <View style={{ width: 1, height: 22, backgroundColor: colors.line, marginHorizontal: 8 }} />
        {button('Undo', () => { void perform('Undo', props.onUndo); }, false, props.busy, true, true, 'undo')}
        {button('Redo', () => { void perform('Redo', props.onRedo); }, false, props.busy, true, true, 'redo')}
      </ScrollView>
      <Menu title="Workspace" triggerLabel="Workspace" actions={[
        ...PANEL_IDS.map(id => ({ id: `panel:${id}`, title: `${layout.collapsed.includes(id) ? 'Show' : 'Hide'} ${panelNames[id]}` })),
        { id: 'arrange', title: arranging ? 'Done arranging' : 'Arrange panels' },
        { id: 'save', title: 'Save layout' }, { id: 'restore', title: 'Restore layout' },
        { id: 'reset', title: 'Reset layout' }, { id: 'refresh', title: 'Refresh', disabled: !!props.busy },
      ]} onAction={id => {
        if (id.startsWith('panel:')) { const panel = id.slice(6); if (PANEL_IDS.includes(panel as typeof PANEL_IDS[number])) action(panel, layout.collapsed.includes(panel) ? 'activate' : 'collapse'); }
        if (id === 'arrange') { ui.setState({ arranging: !arranging }); store.getState().cancelDrag(); }
        if (id === 'save') void perform('Save layout', async () => { const raw = store.getState().savePreset(); if (raw) { savedPreset.current = raw; await props.persistPreset?.(raw); } });
        if (id === 'restore') { if (savedPreset.current) store.getState().restorePreset(savedPreset.current); else store.setState({ error: 'Save a layout first' }); }
        if (id === 'reset') store.getState().reset();
        if (id === 'refresh') void perform('Refresh', props.onRefresh);
      }}><View style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: 'center' }}><Text style={{ color: colors.text, fontSize: 12 }}>Workspace</Text></View></Menu>
    </View>
    {arranging && <View style={{ flexDirection: 'row', backgroundColor: colors.soft, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: colors.accent, fontSize: 11 }}>Drag a panel to an edge, or use its move controls.</Text>{button('Done arranging', () => { ui.setState({ arranging: false }); store.getState().cancelDrag(); })}</View>}
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
      {!compact && !canvasStudio && rail}
    <View ref={shell} onLayout={onLayout} testID="workspace-host" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
        {dockView('left', { width: `${layout.sizes.leftFraction * 100}%` })}
        <View testID="document-stage" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.deep }}>
          {props.children ?? <ForgeDocumentStage studioId={props.studioId} state={props.state} theme={appearance} />}
        </View>
        {dockView('right', { width: `${layout.sizes.rightFraction * 100}%` })}
      </View>
      {dockView('bottom', { height: `${layout.sizes.bottomFraction * 100}%` })}
      {layout.floating.filter(f => !layout.collapsed.includes(f.panelId)).map(f => <View key={f.panelId} style={{ position: 'absolute', left: `${f.rect.x * 100}%`, top: `${f.rect.y * 100}%`, width: `${f.rect.width * 100}%`, height: `${f.rect.height * 100}%`, borderWidth: 1, borderColor: colors.accent, borderRadius: scale.radius.panel, overflow: 'hidden' }}>{renderPanel(f.panelId)}</View>)}
      {drag?.preview && <View pointerEvents="none" testID="dock-preview" style={{ position: 'absolute', left: drag.preview.rect.x - hostRect.current.x, top: drag.preview.rect.y - hostRect.current.y, width: drag.preview.rect.width, height: drag.preview.rect.height, backgroundColor: colors.accent + '30', borderColor: colors.accent, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>Dock {drag.preview.dock}</Text></View>}
      {drag && <View style={{ position: 'absolute', alignSelf: 'center', top: 8, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.accent }}>{button('Cancel move', () => store.getState().cancelDrag())}</View>}
    </View>
    </View>
    {compact && !canvasStudio && <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.base, paddingBottom: 6 }}>
      {PANEL_IDS.map(id => <View key={id} style={{ flex: 1, alignItems: 'center' }}>
        {button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, true, true, panelIcons[id])}
        <Text style={{ color: layout.collapsed.includes(id) ? colors.muted : colors.accent, fontSize: scale.type.micro }}>{id === 'properties' ? 'Inspect' : id === 'actions' ? 'Tools' : panelNames[id]}</Text>
      </View>)}
    </View>}
    {(!canvasStudio || props.error || layoutError || /complete|generated|failed|…/.test(status)) && <View style={{ minHeight: scale.size.status, paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line, ...(canvasStudio ? { position: 'absolute', left: 76, right: 76, bottom: 84, zIndex: 20, backgroundColor: colors.raised, borderRadius: 8, borderWidth: 1, borderColor: colors.line, boxShadow: '0 4px 16px #00000030' } : {}) }}>
      <Text accessibilityRole={props.error || layoutError ? 'alert' : undefined} accessibilityLiveRegion="polite" selectable style={{ color: props.error || layoutError ? colors.error : colors.muted, fontSize: 11 }}>{props.error || layoutError || status}</Text>
    </View>}
  </View>;
}

// Stable component identity keeps the responder alive while preview state updates.
function DragHandle({ id, store, measure, hostRect, blockedRegions, color }: {
  id: string; store: ReturnType<typeof createStudioWorkspaceStore>; measure: () => void;
  hostRect: { current: Rect }; blockedRegions: readonly Rect[] | undefined; color: string;
}) {
  return <DragGrabHandle label={`Drag ${panelNames[id]} to a dock edge`} color={color}
    onStart={() => { measure(); store.getState().beginDrag(id); }}
    onMove={point => store.getState().previewDrag({ point, host: hostRect.current,
      ...(blockedRegions ? { blockedRegions } : {}) })}
    onCommit={() => { store.getState().commitDrag(); }}
    onCancel={() => store.getState().cancelDrag()} />;
}

export { QuillTextEditor, type QuillTextEditorHandle, type QuillTextEditorProps } from './text-editor';
