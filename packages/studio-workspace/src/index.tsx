import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import type { StudioViewRef } from './ui';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { ScrollView, Text, View, Menu, SegmentedControl, TabBar, Button, IconButton, KeyValueList, FieldGroup, ErrorMessage, Toolbar, List, ListItem, EmptyState } from './ui';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DOCKS, type Dock, type DockAction, type Rect, type Studio } from '@nitro-forge/studio-layout';
import { createStudioWorkspaceStore, MIN_STAGE_HEIGHT, MIN_STAGE_WIDTH, PANEL_IDS, PANEL_NAMES, actOnPanel, layoutErrorMessage } from './model';
import { APP_MANIFESTS } from './app-manifest';
import { ForgeDocumentStage } from './stage';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { DragGrabHandle } from '@nyc-tron/ui/components/DragGrabHandle';
import { forgeDragTransport } from './drag-transport';
import { useStudioTextScale } from './persona-turret';
import { workspaceThemes, prismThemes, resolveWorkspaceScale, WORKSPACE_DENSITIES, isWorkspaceDensity, type WorkspaceColors, type WorkspaceDensity } from './theme';
export { createStudioWorkspaceStore } from './model';
export { ForgeDocumentStage } from './stage';

export type WorkspaceRow = { label: string; value: string };
/** `id` is a stable test handle (`workspace-action-<id>`); `title` is the label people read. */
export type WorkspaceAction = { id?: string; title: string; run: () => Promise<unknown> | unknown };
export type ForgeWorkspaceProps = {
  studioId: Studio; title: string; documentTitle: string; state: unknown;
  rows: WorkspaceRow[]; actions: WorkspaceAction[];
  onUndo: () => Promise<unknown> | unknown; onRedo: () => Promise<unknown> | unknown;
  onSave: () => Promise<unknown> | unknown; onRefresh: () => Promise<unknown> | unknown;
  headerLeading?: ReactNode; headerTrailing?: ReactNode; leadingActions?: ReactNode;
  themeOverrides?: Partial<WorkspaceColors>;
  /** User-selected chrome spacing; independent of window width and document layout. */
  density?: WorkspaceDensity;
  onDensityChange?: (density: WorkspaceDensity) => void;
  busy?: boolean; error?: string | null; children?: ReactNode;
  /** Host storage and blocked geometry are ports; no credentials or documents in presets. */
  loadPreset?: () => Promise<string | null>; persistPreset?: (raw: string) => Promise<void>;
  blockedRegions?: readonly Rect[]; theme?: 'dark' | 'light';
};
const panelNames: Readonly<Record<string, string>> = PANEL_NAMES;
const panelIcons: Record<string, string> = { outline: 'file', properties: 'layers', actions: 'plus', history: 'undo' };
/** Status text while an operation runs and once it is done. */
const progressLabels: Record<string, string> = { Undo: 'Undoing…', Redo: 'Redoing…', Save: 'Saving…', Open: 'Opening…', Refresh: 'Refreshing…', 'Save layout': 'Saving layout…' };
const doneLabels: Record<string, string> = { Undo: 'Undone', Redo: 'Redone', Save: 'Saved', Open: 'Opened', Refresh: 'Refreshed', 'Save layout': 'Layout saved' };
const titleCase = (text: string) => text ? text[0]!.toUpperCase() + text.slice(1) : text;
const appIcons: Record<Studio, string> = { quill: 'text', prism: 'brush', tally: 'table', pitch: 'slide', folio: 'pdf', splice: 'video', cadence: 'music', photo: 'image', motion: 'play', design: 'color-wheel', draft: 'pencil' };

/** Shared inner editor chrome. The host owns and supplies one stable engine document. */
export function ForgeWorkspace(props: ForgeWorkspaceProps) {
  const scale = resolveWorkspaceScale(props.density);
  const systemTheme = useColorScheme();
  const appearance = (props.theme ?? systemTheme) === 'light' ? 'light' : 'dark';
  const canvasStudio = props.studioId === 'prism';
  const colors: WorkspaceColors = { ...(canvasStudio ? prismThemes : workspaceThemes)[appearance], ...props.themeOverrides };
  const store = useMemo(() => createStudioWorkspaceStore(props.studioId), [props.studioId]);
  const ui = useMemo(() => createStore(() => ({ arranging: false, reducedMotion: true, width: 1200, height: 800, operationStatus: null as string | null })), [props.studioId]);
  const arranging = useStore(ui, s => s.arranging);
  const operationStatus = useStore(ui, s => s.operationStatus);
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
  const shell = useRef<StudioViewRef>(null);
  const hostRect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const savedPreset = useMemo(() => ({ current: null as string | null }), [store]);
  const operation = useMemo(() => ({ current: false }), [store]);
  // Breakpoints use the stable outer width; the rail must not change its own breakpoint.
  const outerWidth = useStore(ui, s => s.width);
  const outerHeight = useStore(ui, s => s.height);
  const compact = outerWidth < 700;
  // The header's kit controls grow with the text size, so the width that fits
  // them on one row grows too: at 200 % a 390 pt phone gives the host
  // controls their own row instead of clipping Save.
  const textScale = useStudioTextScale();
  const separateHostControls = canvasStudio && outerWidth < 380 * textScale && !!props.headerTrailing;
  // A short landscape host keeps its existing toolbar height. Host menus stay
  // outside the horizontal scroller so their platform popup can open normally.
  const packHostControls = separateHostControls && outerHeight < 500;

  useEffect(() => {
    let active = true;
    void props.loadPreset?.().then(raw => { if (active && raw) { savedPreset.current = raw; store.getState().restorePreset(raw); } })
      .catch(() => { if (active) store.setState({ error: 'Could not load your saved layout' }); });
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
    const progress = progressLabels[label] ?? `${label}…`;
    ui.setState({ operationStatus: progress });
    store.setState({ status: progress, error: null });
    try {
      await action();
      const done = doneLabels[label] ?? `Done: ${label}`;
      ui.setState({ operationStatus: done });
      store.setState({ status: done });
    }
    catch (error) { store.setState({ error: error instanceof Error ? error.message : String(error) }); }
    finally { operation.current = false; }
  };
  const button = (label: string, onPress: () => void, selected = false, disabled = false, small = false, iconOnly = false, glyph?: string, primary = false, testID?: string) => {
    const toggled = Object.values(panelNames).includes(label) ? selected : undefined;
    const icon = glyph ? <ForgeIcon name={glyph} size={18} selected={selected} disabled={disabled}
      appearance={appearance} color={primary ? colors.ink : selected ? colors.accent : colors.muted}
      selectedColor={primary ? colors.ink : colors.accent} surfaceColor={primary ? colors.accent : selected ? colors.soft : colors.base} reducedMotion={reducedMotion} /> : undefined;
    const shared = { onPress, disabled, targetSize: scale.size.target, ...(toggled === undefined ? {} : { selected: toggled }), ...(testID ? { testID } : {}), cornerRadius: scale.radius.control,
      variant: primary ? 'primary' as const : 'ghost' as const, tone: 'carolina' as const,
      // A transparent edge keeps each button's shape under Windows High Contrast.
      className: (selected && !primary ? 'rounded-sm border border-transparent bg-ink-800' : 'rounded-sm border border-transparent') + (props.density === 'comfortable' ? ' min-h-12 min-w-12' : '') };
    return iconOnly ? <IconButton key={label} {...shared} size={primary ? 'md' : 'sm'} aria-label={label} icon={icon} />
      : <Button key={label} {...shared} size={small ? 'sm' : 'md'} title={label} icon={icon} />;
  };
  const action = (id: string, kind: DockAction) => actOnPanel(store, id, kind, compact);
  const fraction = (dock: Dock) => layout.sizes[dock === 'left' ? 'leftFraction' : dock === 'right' ? 'rightFraction' : 'bottomFraction'];

  const manifest = APP_MANIFESTS[props.studioId];
  // What the studio is for, until the document has something in it.
  const emptyState = <View testID="workspace-empty" style={{ padding: scale.space.inset, backgroundColor: colors.base, borderRadius: scale.radius.control }}>
    <EmptyState tone="carolina" title={props.state ? manifest.task : 'Opening document…'}
      {...(props.state ? { description: `${manifest.detail} Start from Actions.` } : {})} />
  </View>;
  function renderPanel(id: string, dock?: Dock) {
    return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.raised }}>
      {(!dock || arranging) && <Toolbar density="compact" title={panelNames[id] ?? id} tone="carolina"
        leading={arranging ? <DragHandle id={id} store={store} measure={measure} hostRect={hostRect} blockedRegions={props.blockedRegions} color={colors.muted} /> : undefined}
        actions={button(`Hide ${panelNames[id]}`, () => action(id, 'collapse'), false, false, true, true, 'close')} />}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: scale.space.group, paddingTop: dock && !arranging ? scale.space.group : 0, paddingBottom: scale.space.group + 2, gap: scale.space.inset + 2 }}>
        {id === 'outline' && <>
          <View style={{ flexDirection: 'row', gap: scale.space.element + 2, alignItems: 'center', padding: scale.space.inset, backgroundColor: colors.base, borderRadius: scale.radius.control }}><ForgeIcon name={appIcons[props.studioId]} size={20} color={colors.accent} reducedMotion={reducedMotion} /><Text style={{ color: colors.text, fontSize: scale.type.body, fontWeight: '500', flex: 1 }}>{props.documentTitle}</Text></View>
          {props.rows.length ? <List tone="carolina">{props.rows.map((row, index) => <ListItem key={`${index}:${row.label}`} supportingText={row.value || 'Empty'}>{row.label}</ListItem>)}</List> : emptyState}
        </>}
        {id === 'properties' && !props.rows.length && emptyState}
        {id === 'properties' && !!props.rows.length && <View style={{ borderRadius: scale.radius.control, overflow: 'hidden' }}><FieldGroup>
          <FieldGroup.Section title="Document details" tone="carolina">
            <KeyValueList columns={1} surface="night" items={props.rows.map((row, index) => ({ key: `${index}:${row.label}`, label: row.label, value: row.value || 'Empty' }))} />
          </FieldGroup.Section>
        </FieldGroup></View>}
        {id === 'actions' && <>
          <Text style={{ color: colors.muted, fontSize: scale.type.label, lineHeight: 19 }}>{props.actions.length ? 'Quick changes to this document. Each one can be undone.' : 'This studio has no quick actions.'}</Text>
          {props.actions.map(item => <View key={item.id ?? item.title} style={{ backgroundColor: colors.base, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: scale.radius.control }}>
            {button(item.title, () => { void perform(item.title, item.run); }, false, props.busy, false, false, undefined, false, `workspace-action-${item.id ?? item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)}
          </View>)}
        </>}
        {id === 'history' && <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: scale.type.body - 1 }}>{panelNames.history}</Text>
          <Text style={{ color: colors.muted, fontSize: scale.type.label, lineHeight: 19 }}>Step back through your edits, or forward again.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>{button('Undo', () => { void perform('Undo', props.onUndo); }, false, props.busy)}{button('Redo', () => { void perform('Redo', props.onRedo); }, false, props.busy)}</View>
        </View>}
        {arranging && <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: scale.space.inset, gap: scale.space.stack }}>
          <Text style={{ color: colors.muted, fontSize: scale.type.caption, fontWeight: '600' }}>Panel position</Text>
          <SegmentedControl aria-label={`Dock position for ${panelNames[id] ?? id}`} value={dock ?? ''}
            options={DOCKS.map(zone => ({ value: zone, label: zone[0]!.toUpperCase() + zone.slice(1) }))}
            onChange={zone => { if (DOCKS.includes(zone as Dock)) action(id, `move-${zone as Dock}`); }}
            tone="royal" className="w-full rounded-sm" segmentClassName="rounded-sm" />
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
    return <View key={dock} testID={`dock-${dock}`} style={[{ minHeight: 0, padding: scale.space.element, backgroundColor: colors.deep }, style]}>
      <View style={{ flex: 1, minHeight: 0, borderColor: colors.controlBorder, borderWidth: 1, borderRadius: scale.radius.panel, overflow: 'hidden', backgroundColor: colors.raised }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: scale.space.stack + 1, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <TabBar semantics="tabs" density="compact" aria-label={`${titleCase(dock)} panels`} tone="royal" className="rounded-sm overflow-hidden" tabs={panels.map(id => ({
              key: id, label: panelNames[id] ?? id, active: active === id,
              onPress: () => action(id, 'activate'),
              icon: <ForgeIcon name={panelIcons[id] ?? 'file'} size={17} color={active === id ? colors.ink : colors.muted} reducedMotion={reducedMotion} />,
            }))} />
          </View>
          {!arranging && button(`Hide ${panelNames[active]}`, () => action(active, 'collapse'), false, false, true, true, 'close')}
        </View>
        {renderPanel(active, dock)}
      </View>
    </View>;
  };

  const keyboardProps = { onKeyDown: (event: StudioKeyboardEvent) => { if (keyboardKey(event) === 'Escape') { store.getState().cancelDrag(); } } };
  const rail = <View style={{ width: scale.size.rail, backgroundColor: colors.base, borderRightWidth: 1, borderRightColor: colors.line, alignItems: 'center', paddingVertical: scale.space.inset + 2 }}>
    <View style={{ alignItems: 'center', gap: scale.space.inset, paddingBottom: scale.space.group }}>
      {PANEL_IDS.filter(id => id !== 'history').map(id => <View key={id} style={{ alignItems: 'center', gap: 4 }}>
        {button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, false, true, panelIcons[id], false, `rail-${id}`)}
        <Text aria-hidden style={{ color: !layout.collapsed.includes(id) ? colors.accent : colors.muted, fontSize: scale.type.caption, fontWeight: !layout.collapsed.includes(id) ? '600' : '400' }}>{panelNames[id]}</Text>
      </View>)}
    </View>
    <View style={{ width: 28, height: 1, backgroundColor: colors.line }} />
    <View style={{ alignItems: 'center', gap: scale.space.stack, paddingTop: scale.space.group }}>
      {button(panelNames.history!, () => action('history', layout.collapsed.includes('history') ? 'activate' : 'collapse'), !layout.collapsed.includes('history'), false, false, true, panelIcons.history, false, 'rail-history')}
      <Text aria-hidden style={{ color: layout.collapsed.includes('history') ? colors.muted : colors.accent, fontSize: scale.type.caption }}>{panelNames.history}</Text>
    </View>
  </View>;
  return <View {...keyboardProps} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== ui.getState().width || height !== ui.getState().height)) ui.setState({ width, height });
  }} testID="forge-workspace" style={{ flex: 1, minHeight: 0, backgroundColor: canvasStudio ? colors.deep : colors.base }}>
    <View style={{ paddingHorizontal: compact ? scale.space.inset : scale.space.group + scale.space.stack, borderBottomWidth: canvasStudio ? 0 : 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: compact ? scale.space.element : scale.space.group, minHeight: canvasStudio ? scale.size.canvasHeader : scale.size.header, ...(canvasStudio ? { backgroundColor: colors.base, margin: scale.space.element, marginBottom: 0, borderRadius: scale.radius.control, boxShadow: '0 3px 12px #00000020' } : {}) }}>
      {props.headerLeading}
      <View style={{ width: separateHostControls ? 32 : 38, height: separateHostControls ? 32 : 38, backgroundColor: colors.soft, borderRadius: scale.radius.control, alignItems: 'center', justifyContent: 'center' }}>
        <ForgeIcon name={appIcons[props.studioId]} size={separateHostControls ? 20 : 23} selected color={colors.accent} selectedColor={colors.accent} surfaceColor={colors.soft} reducedMotion={reducedMotion} />
      </View>
      <View style={{ flex: 1, minWidth: 40, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: .4, flexShrink: 1 }}>{props.title}</Text>{!compact && <><Text style={{ color: colors.line, fontSize: 11 }}> / </Text><Text style={{ color: colors.muted, fontSize: 11 }}>{props.busy ? 'Working…' : 'Document'}</Text></>}</View>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600', fontSize: compact ? 13 : 15 }}>{props.documentTitle}</Text>
      </View>
      {!separateHostControls && props.headerTrailing}
      {button('Save', () => { void perform('Save', props.onSave); }, true, props.busy, false, compact, 'save', true, 'workspace-save')}
    </View>
    {separateHostControls && !packHostControls && <View testID="workspace-host-controls" style={{ minHeight: scale.size.target, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: scale.space.inset }}>
      {props.headerTrailing}
    </View>}
    <View style={{ flexDirection: 'row', borderBottomWidth: canvasStudio ? 0 : 1, borderBottomColor: colors.line, alignItems: 'center', paddingHorizontal: compact ? scale.space.element : scale.space.group, minHeight: canvasStudio ? scale.size.canvasToolbar : scale.size.toolbar }}>
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: scale.space.stack }}>
        {props.leadingActions}
        <View style={{ width: 1, height: 22, backgroundColor: colors.line, marginHorizontal: 8 }} />
        {button('Undo', () => { void perform('Undo', props.onUndo); }, false, props.busy, true, true, 'undo', false, 'workspace-undo')}
        {button('Redo', () => { void perform('Redo', props.onRedo); }, false, props.busy, true, true, 'redo', false, 'workspace-redo')}
      </ScrollView>
      {packHostControls && <View testID="workspace-host-controls" style={{ flexDirection: 'row', alignItems: 'center' }}>{props.headerTrailing}</View>}
      <Menu title="Workspace" triggerLabel="Workspace" actions={[
        ...(props.onDensityChange ? WORKSPACE_DENSITIES.map(density => ({id:'density:'+density,title:'Spacing: '+titleCase(density)+(density===(props.density??'standard')?' (current)':'')})) : []),
        ...PANEL_IDS.map(id => ({ id: `panel:${id}`, title: `${layout.collapsed.includes(id) ? 'Show' : 'Hide'} ${panelNames[id]}` })),
        { id: 'arrange', title: arranging ? 'Done arranging' : 'Arrange panels' },
        { id: 'save', title: 'Save layout' }, { id: 'restore', title: 'Restore layout' },
        { id: 'reset', title: 'Reset layout' }, { id: 'refresh', title: 'Refresh', disabled: !!props.busy },
      ]} onAction={id => {
        if (id.startsWith('density:')) { const density=id.slice(8); if(isWorkspaceDensity(density)) props.onDensityChange?.(density); }
        if (id.startsWith('panel:')) { const panel = id.slice(6); if (PANEL_IDS.includes(panel as typeof PANEL_IDS[number])) action(panel, layout.collapsed.includes(panel) ? 'activate' : 'collapse'); }
        if (id === 'arrange') { ui.setState({ arranging: !arranging }); store.getState().cancelDrag(); }
        if (id === 'save') void perform('Save layout', async () => { const raw = store.getState().savePreset(); if (raw) { savedPreset.current = raw; await props.persistPreset?.(raw); } });
        if (id === 'restore') { if (savedPreset.current) store.getState().restorePreset(savedPreset.current); else store.setState({ error: 'Save a layout first' }); }
        if (id === 'reset') store.getState().reset();
        if (id === 'refresh') void perform('Refresh', props.onRefresh);
      }}><View style={{ minHeight: scale.size.target, minWidth: scale.size.target, paddingHorizontal: scale.space.element + 2, justifyContent: 'center' }}><Text style={{ color: colors.text, fontSize: 12 }}>Workspace</Text></View></Menu>
    </View>
    {arranging && <View style={{ flexDirection: 'row', backgroundColor: colors.soft, paddingHorizontal: scale.space.group, alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: colors.accent, fontSize: 11 }}>Drag a panel to an edge, or use its move controls.</Text>{button('Done arranging', () => { ui.setState({ arranging: false }); store.getState().cancelDrag(); })}</View>}
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
      {!compact && !canvasStudio && rail}
    <View ref={shell} onLayout={onLayout} testID="workspace-host" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
        {dockView('left', { width: `${layout.sizes.leftFraction * 100}%` })}
        <View testID="document-stage" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.deep }}>
          {props.children ?? <ForgeDocumentStage studioId={props.studioId} state={props.state} theme={appearance} />}
        </View>
        {dockView('right', { width: `${layout.sizes.rightFraction * 100}%` })}
        {/* Sized by its buttons, so grown text widens the column and the stage gives way, rather than the buttons spilling over the stage. */}
        {canvasStudio && !compact && <View accessibilityLabel="Studio panels" style={{ minWidth: scale.size.canvasRail, paddingHorizontal: 3, alignItems: 'center', gap: scale.space.stack, paddingTop: scale.space.inset, backgroundColor: colors.deep }}>
          <View style={{ paddingVertical: 4, gap: 2, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: scale.radius.control }}>
            {(['properties', 'actions', 'history'] as const).map(id => button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, true, true, panelIcons[id], false, `rail-${id}`))}
          </View>
        </View>}
      </View>
      {dockView('bottom', { height: `${layout.sizes.bottomFraction * 100}%` })}
      {layout.floating.filter(f => !layout.collapsed.includes(f.panelId)).map(f => <View key={f.panelId} style={{ position: 'absolute', left: `${f.rect.x * 100}%`, top: `${f.rect.y * 100}%`, width: `${f.rect.width * 100}%`, height: `${f.rect.height * 100}%`, borderWidth: 1, borderColor: colors.accent, borderRadius: scale.radius.panel, overflow: 'hidden' }}>{renderPanel(f.panelId)}</View>)}
      {drag?.preview && <View pointerEvents="none" testID="dock-preview" style={{ position: 'absolute', left: drag.preview.rect.x - hostRect.current.x, top: drag.preview.rect.y - hostRect.current.y, width: drag.preview.rect.width, height: drag.preview.rect.height, backgroundColor: colors.accent + '30', borderColor: colors.accent, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>{`Drop to dock ${drag.preview.dock === 'bottom' ? 'at the bottom' : `on the ${drag.preview.dock}`}`}</Text></View>}
      {drag && <View style={{ position: 'absolute', alignSelf: 'center', top: 8, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.accent, borderRadius: scale.radius.control }}>{button('Cancel move', () => store.getState().cancelDrag())}</View>}
    </View>
    </View>
    {compact && !canvasStudio && <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.base, paddingBottom: 6 }}>
      {PANEL_IDS.map(id => <View key={id} style={{ flex: 1, alignItems: 'center' }}>
        {button(panelNames[id]!, () => action(id, layout.collapsed.includes(id) ? 'activate' : 'collapse'), !layout.collapsed.includes(id), false, true, true, panelIcons[id], false, `bar-${id}`)}
        <Text aria-hidden style={{ color: layout.collapsed.includes(id) ? colors.muted : colors.accent, fontSize: scale.type.caption }}>{panelNames[id]}</Text>
      </View>)}
    </View>}
    {(!canvasStudio || props.error || layoutError || (!!operationStatus && status === operationStatus)) && <View style={{ minHeight: scale.size.status, paddingHorizontal: scale.space.group, paddingVertical: scale.space.element / 2 + 2, borderTopWidth: 1, borderTopColor: colors.line, ...(canvasStudio ? { position: 'absolute', left: 76, right: 76, bottom: 84, zIndex: 20, backgroundColor: colors.raised, borderRadius: scale.radius.control, borderWidth: 1, borderColor: colors.controlBorder, boxShadow: '0 4px 16px #00000030' } : {}) }}>
      {props.error || layoutError ? <ErrorMessage surface="night" message={props.error || layoutErrorMessage(layoutError ?? '')} /> : <Text accessibilityLiveRegion="polite" selectable style={{ color: colors.muted, fontSize: 11 }}>{status}</Text>}
    </View>}
  </View>;
}

// Stable component identity keeps the responder alive while preview state updates.
function DragHandle({ id, store, measure, hostRect, blockedRegions, color }: {
  id: string; store: ReturnType<typeof createStudioWorkspaceStore>; measure: () => void;
  hostRect: { current: Rect }; blockedRegions: readonly Rect[] | undefined; color: string;
}) {
  return <DragGrabHandle label={`Drag ${panelNames[id]} to a dock edge`} transport={forgeDragTransport}
    onStart={() => { measure(); store.getState().beginDrag(id); }}
    onMove={point => store.getState().previewDrag({ point, host: hostRect.current,
      ...(blockedRegions ? { blockedRegions } : {}) })}
    onCommit={() => { store.getState().commitDrag(); }}
    onCancel={() => store.getState().cancelDrag()}><ForgeIcon name="menu" size={16} color={color} reducedMotion /></DragGrabHandle>;
}

export { QuillTextEditor, type QuillTextEditorHandle, type QuillTextEditorProps } from './text-editor';
