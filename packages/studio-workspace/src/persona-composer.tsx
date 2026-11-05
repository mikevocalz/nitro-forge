import { useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Keyboard, Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { iconStroke } from '@nitro-forge/icons';
import {
  Banner, Button, FieldGroup, IconButton, Menu, NightScope, Pressable, SegmentedControl, Text, TextInput, View,
} from './ui';
import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import { DragGrabHandle } from '@nyc-tron/ui/components/DragGrabHandle';
import { forgeDragTransport } from './drag-transport';
import { PERSONA_SURFACES, type PersonaSpec, type PersonaSurface } from './persona';
import type { PersonaStore } from './persona-store';
import {
  BUILT_IN_CAPTION, COMPOSER_TILE_MIN, EMPTY_COMPOSER_DRAFT, PERSONA_NAME_MAX, SURFACE_LABELS, capabilityTag, capabilityToggleName, composerCapabilities,
  composerLayout, designStudioInstruments, disclosureCount, dragTargetIndex, draftManifest, instrumentLabel, instrumentTag, instrumentToggleName,
  moveAnnouncement, moveRailItem, nameCounter, personaSummary, railPosition, requestedImportLabel, saveBlocker, savedMessage,
  SURFACE_PROSE, toPersonaDraft, toggleGrid, toggleId, type ComposerDraft, type SurfaceMode,
} from './persona-composer-model';
import { prismThemes, workspaceScale as scale, type WorkspaceColors } from './theme';

/** How the host delivered an exported persona, so the confirmation can say what happened. */
export type PersonaExportOutcome = 'copied' | 'shared';

/** Props for {@linkcode PersonaComposer}. */
export type PersonaComposerProps = {
  /** The open document's persona store; every save, import and removal goes through it. */
  store: PersonaStore;
  theme?: 'dark' | 'light';
  colors?: WorkspaceColors;
  /** Host copy or share (clipboard on web, share sheet on native). When omitted,
   * the exported JSON is shown in a selectable field instead. Rejections are shown. */
  onExportPersona?: (json: string, persona: PersonaSpec) => Promise<PersonaExportOutcome>;
};

/** `at` keeps a notice next to the control that caused it: Save in the preview, list actions under Personas. */
type Notice = Readonly<{ tone: 'success' | 'danger' | 'info'; title: string; description?: string; at?: 'list' }>;
type Drag = Readonly<{ index: number; originY: number | null; target: number }>;
type ComposerState = {
  draft: ComposerDraft;
  width: number;
  railHeight: number;
  drag: Drag | null;
  notice: Notice | null;
  announcement: string;
  importOpen: boolean;
  importText: string;
  exported: Readonly<{ id: string; label: string; json: string }> | null;
  gridWidth: number;
  /** Phone only: whether the instrument and capability grids are unfolded. */
  open: Readonly<{ instruments: boolean; capabilities: boolean }>;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The kit's studio section pads its body by the 12 pt inset. Pulling it back
 * puts section text on the page's own gutter, so the form has one left edge,
 * and sections sit one section gap apart instead of gap plus two insets. */
const SECTION_INSET = scale.space.inset;
/** The kit's small ghost button pads its label by the same inset, inside the 1 pt High Contrast edge. */
const GHOST_INSET = scale.space.inset + 1;
/** Danger notices sit on a danger-tinted ground; the kit's raised ground is
 * the navy every tone shares in the night scheme. */
const DANGER_GROUND = 'bg-danger/15';
/** Windows High Contrast removes backgrounds; a transparent edge keeps each kit button and segment's shape there. */
const HC_EDGE = 'border border-transparent';
const LEVEL_1 = { 'aria-level': 1 } as object;
const LEVEL_2 = { 'aria-level': 2 } as object;
/** Light theme on web: the Surfaces well follows the page instead of the
 * kit's night well. Theme tokens (`forge-*`), so the class reads the theme. */
const LIGHT_SEGMENTS = {
  className: 'border-forge-border bg-forge-mat',
  // Labels stay in the text ink (muted fails 4.5:1 on the well); the chosen
  // segment is a raised tile with a muted ring, which holds 3:1 on the well;
  // keyboard focus draws a 2 px ring in the page accent over it.
  segmentClassName: 'border border-transparent hover:bg-forge-border aria-checked:bg-forge-raised aria-checked:ring-1 aria-checked:ring-forge-muted aria-checked:focus-visible:ring-2 aria-checked:focus-visible:ring-forge-accent aria-checked:shadow-[0_1px_2px_#252A3A26] *:text-forge-text',
} as const;
const isWeb = Platform.OS === 'web';
/** Web announces through the hidden live region; iOS and Android need an explicit announcement. */
const announceNative = (text: string) => { if (!isWeb && text) AccessibilityInfo.announceForAccessibility(text); };

/** Glyphs the authored Forge set does not carry yet, drawn on the same 24-unit grid and stroke. */
export type ComposerGlyphName = 'more' | 'chevron-left' | 'chevron-down' | 'chevron-up';
export function ComposerGlyph({ name, size = 16, color }: { name: ComposerGlyphName; size?: number; color: string }) {
  const line = { stroke: color, strokeWidth: iconStroke.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...(isWeb ? {} : { accessible: false, focusable: false })}>
    {name === 'more' ? <>{[5, 12, 19].map(x => <Circle key={x} cx={x} cy={12} r={2} fill={color} />)}</>
      : <Path {...line} d={name === 'chevron-left' ? 'M15 5l-7 7 7 7' : name === 'chevron-down' ? 'M5 9l7 7 7-7' : 'M5 15l7-7 7 7'} />}
  </Svg>;
}

/**
 * Persona Composer for the design studio: name a persona, build and order its
 * instrument rail, pick capabilities (unbuilt ones stay selectable and say so),
 * choose surfaces, preview the manifest for this surface, then save through
 * {@linkcode PersonaStore}. Lists every persona with export, import and removal.
 * Reorder works by Move up/Move down buttons, screen readers and drag.
 */
export function PersonaComposer(props: PersonaComposerProps) {
  const local = useRef<StoreApi<ComposerState> | null>(null);
  if (!local.current) local.current = createStore<ComposerState>(() => ({
    draft: EMPTY_COMPOSER_DRAFT, width: 0, railHeight: 0, drag: null, notice: null, announcement: '',
    importOpen: false, importText: '', exported: null, gridWidth: 0, open: { instruments: false, capabilities: false },
  }));
  const ui = local.current;
  const s = useStore(ui, x => x);
  const personas = useStore(props.store, x => x.personas);
  const surface = useStore(props.store, x => x.surface);
  const storeError = useStore(props.store, x => x.error);
  const c = props.colors ?? prismThemes[props.theme ?? 'dark'];
  const layout = composerLayout(s.width);
  const wide = layout === 'wide';
  const phone = layout === 'phone';
  const { draft } = s;
  const setDraft = (patch: Partial<ComposerDraft>) => ui.setState(st => ({ draft: { ...st.draft, ...patch } }));
  const blocker = saveBlocker(draft);
  const manifest = draftManifest(draft, surface);
  const grid = phone ? toggleGrid(s.gridWidth, scale.space.element) : toggleGrid(s.gridWidth, scale.space.element, COMPOSER_TILE_MIN);
  const surfaceWord = SURFACE_PROSE[surface];

  const move = (index: number, delta: number) => {
    const id = draft.rail[index];
    if (!id) return;
    const rail = moveRailItem(draft.rail, index, delta);
    const announcement = moveAnnouncement(rail, id);
    ui.setState(st => ({ draft: { ...st.draft, rail }, announcement }));
    announceNative(announcement);
  };
  const save = () => {
    if (blocker) return;
    try {
      const saved = props.store.getState().compose(toPersonaDraft(draft));
      const title = savedMessage('Saved', draft.label, saved);
      ui.setState({ draft: EMPTY_COMPOSER_DRAFT, notice: { tone: 'success', title } });
      // The name field resets, so its keyboard would cover the result.
      Keyboard.dismiss();
      announceNative(title);
    } catch (e) { ui.setState({ notice: { tone: 'danger', title: 'Not saved', description: message(e) } }); announceNative(`Not saved. ${message(e)}`); }
  };
  const runImport = () => {
    const json = s.importText;
    try {
      const saved = props.store.getState().importJson(json);
      const title = savedMessage('Imported', requestedImportLabel(json), saved);
      ui.setState({ importOpen: false, importText: '', notice: { tone: 'success', title, at: 'list' } });
      announceNative(title);
    } catch (e) { ui.setState({ notice: { tone: 'danger', title: 'Not imported', description: message(e), at: 'list' } }); announceNative(`Not imported. ${message(e)}`); }
  };
  const exportPersona = async (persona: PersonaSpec) => {
    let json: string;
    try { json = props.store.getState().exportJson(persona.id); }
    catch (e) { ui.setState({ notice: { tone: 'danger', title: `${persona.label} not exported`, description: message(e), at: 'list' } }); return; }
    if (!props.onExportPersona) {
      ui.setState({ exported: { id: persona.id, label: persona.label, json }, notice: { tone: 'info', title: `${persona.label} as JSON`, description: 'Select the text below and copy it.', at: 'list' } });
      return;
    }
    try {
      const outcome = await props.onExportPersona(json, persona);
      ui.setState({ exported: null, notice: { tone: 'success', title: outcome === 'shared' ? `Shared ${persona.label}` : `Copied ${persona.label} as JSON`, at: 'list' } });
    } catch (e) {
      ui.setState({ exported: { id: persona.id, label: persona.label, json }, notice: { tone: 'danger', title: `${persona.label} not copied`, description: `${message(e)}. Select the text below and copy it instead.`, at: 'list' } });
    }
  };
  const removePersona = (persona: PersonaSpec) => {
    try {
      props.store.getState().remove(persona.id);
      ui.setState(st => ({ exported: st.exported?.id === persona.id ? null : st.exported, notice: { tone: 'info', title: `Removed ${persona.label}`, at: 'list' } }));
    } catch (e) { ui.setState({ notice: { tone: 'danger', title: `${persona.label} not removed`, description: message(e), at: 'list' } }); }
  };
  const startFrom = (persona: PersonaSpec) => {
    ui.setState({
      draft: {
        label: persona.label, rail: persona.rail.filter(id => designStudioInstruments.some(i => i.id === id)), capabilities: [...persona.capabilities],
        surfaceMode: persona.surfaces === 'all' ? 'all' : 'chosen', surfaces: persona.surfaces === 'all' ? [] : [...persona.surfaces],
      },
      notice: { tone: 'info', title: `Editing a copy of ${persona.label}`, description: 'Saving keeps the original and adds a numbered copy if the name is unchanged.' },
    });
  };

  /** A kit section whose body padding is pulled back onto the page gutter. */
  const section = (children: ReactNode) => <FieldGroup.Section>
    <View style={{ margin: -SECTION_INSET }}>{children}</View>
  </FieldGroup.Section>;
  const label = (text: string) => <Text style={{ color: c.muted, fontSize: scale.type.label }}>{text}</Text>;
  // Web: one h1 for the page title, h2 for each section (React Native Web reads aria-level).
  const heading = (text: string, id?: string) => <Text accessibilityRole="header" {...LEVEL_2} nativeID={id} style={{ color: c.text, fontSize: scale.type.body, fontWeight: '600' }}>{text}</Text>;
  const rowHeights = draft.rail.map(() => (draft.rail.length ? s.railHeight / draft.rail.length : 0));

  const nameSection = section(
    <View style={{ gap: scale.space.stack }}>
      {heading('Name')}
      <TextInput testID="composer-name" accessibilityLabel="Persona name" placeholder="Print layout" maxLength={PERSONA_NAME_MAX}
        value={draft.label} onChangeText={text => setDraft({ label: text })} returnKeyType="done"
        style={{ minHeight: scale.size.target, borderWidth: 1, borderColor: c.line, borderRadius: scale.radius.control, paddingHorizontal: scale.space.inset, color: c.text, backgroundColor: c.deep, fontSize: scale.type.body }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: scale.space.element }}>
        {label('Shown on the turret and the rail header')}
        <Text style={{ color: c.muted, fontSize: scale.type.label, fontVariant: ['tabular-nums'] }}>{nameCounter(draft.label)}</Text>
      </View>
    </View>);

  /** A dense on/off tile. Accent marks chosen tiles only; the rest stay neutral. */
  const tile = (key: string, props: { on: boolean; title: string; note?: string; mark?: ReactNode; name: string; onPress: () => void; testID?: string }) =>
    <Pressable key={key} testID={props.testID} accessibilityRole="button" accessibilityLabel={props.name} accessibilityState={{ selected: props.on }} onPress={props.onPress}
      style={({ pressed }) => ({
        width: grid.tile || undefined, flexGrow: grid.tile ? 0 : 1, minHeight: scale.size.target, flexDirection: 'row', alignItems: 'center', gap: scale.space.element,
        paddingHorizontal: scale.space.inset, paddingVertical: scale.space.element, borderRadius: scale.radius.control, borderWidth: 1,
        borderColor: props.on ? c.accent : c.line, backgroundColor: props.on ? c.soft : pressed ? c.raised : c.deep, opacity: pressed ? 0.85 : 1,
      })}>
      <View style={{ width: 18, alignItems: 'center' }}>{props.mark ?? (props.on
        ? <ForgeIcon name="check" size={14} color={c.accent} reducedMotion />
        : <ForgeIcon name="plus" size={14} color={c.muted} reducedMotion />)}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontSize: scale.type.label, fontWeight: props.on ? '600' : '400' }}>{props.title}</Text>
        {props.note && <Text style={{ color: c.muted, fontSize: scale.type.label }}>{props.note}</Text>}
      </View>
    </Pressable>;
  const tileGrid = (testID: string, children: ReactNode) => <View testID={testID} onLayout={e => { const w = e.nativeEvent.layout.width; if (Math.abs(w - ui.getState().gridWidth) > 0.5) ui.setState({ gridWidth: w }); }}
    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: scale.space.element }}>{children}</View>;
  /** Section title. On a phone the grid sections fold, and the title becomes the disclosure. */
  const foldTitle = (which: 'instruments' | 'capabilities', title: string, count: string) => {
    if (!phone) return <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: scale.space.element }}>
      {heading(title)}<Text style={{ color: c.muted, fontSize: scale.type.label, fontVariant: ['tabular-nums'] }}>{count}</Text>
    </View>;
    const open = s.open[which];
    return <Pressable testID={`composer-fold-${which}`} accessibilityRole="button" accessibilityLabel={`${title}, ${count}`} accessibilityState={{ expanded: open }}
      onPress={() => ui.setState(st => ({ open: { ...st.open, [which]: !st.open[which] } }))}
      style={{ minHeight: scale.size.target, flexDirection: 'row', alignItems: 'center', gap: scale.space.element }}>
      <Text style={{ color: c.text, fontSize: scale.type.body, fontWeight: '600', flex: 1 }}>{title}</Text>
      <Text style={{ color: c.muted, fontSize: scale.type.label, fontVariant: ['tabular-nums'] }}>{count}</Text>
      <ComposerGlyph name={open ? 'chevron-up' : 'chevron-down'} color={c.muted} />
    </Pressable>;
  };
  const unfolded = (which: 'instruments' | 'capabilities') => !phone || s.open[which];
  // The kit's native Menu drops triggerLabel, so the trigger names itself. A
  // screen reader's double-tap lands on this view's centre, inside the menu.
  const rowMenu = (labelText: string) => <View accessible accessibilityRole="button" accessibilityLabel={labelText} style={{ minWidth: scale.size.target, minHeight: scale.size.target, alignItems: 'center', justifyContent: 'center' }}>
    <ComposerGlyph name="more" color={c.muted} />
  </View>;
  /** Rows share the toggle tiles' material and type, so the rail, the grid and
   * the persona list read as one instrument. The kit sections scope night on
   * web; light rows put the day scheme back for the kit buttons inside them. */
  const rowStack = (testID: string, label: string, children: ReactNode, onLayout?: (height: number) => void) =>
    <View testID={testID} accessibilityRole="list" accessibilityLabel={label} {...((props.theme ?? 'dark') === 'light' ? { className: 'scheme-light' } : {})}
      {...(onLayout ? { onLayout: (e: { nativeEvent: { layout: { height: number } } }) => onLayout(e.nativeEvent.layout.height) } : {})}
      style={{ gap: scale.space.stack }}>{children}</View>;
  const row = (key: string, parts: { on?: boolean; leading?: ReactNode; title: string; note?: string; trailing?: ReactNode }) =>
    <View key={key} role="listitem" style={{
      minHeight: scale.size.target, flexDirection: 'row', alignItems: 'center', gap: scale.space.element,
      paddingLeft: parts.leading ? scale.space.stack : scale.space.inset, paddingRight: scale.space.stack, paddingVertical: scale.space.stack,
      borderRadius: scale.radius.control, borderWidth: 1, borderColor: parts.on ? c.accent : c.line, backgroundColor: parts.on ? c.soft : c.deep,
    }}>
      {parts.leading}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: scale.type.label, fontWeight: '600' }}>{parts.title}</Text>
        {parts.note && <Text style={{ color: c.muted, fontSize: scale.type.label }}>{parts.note}</Text>}
      </View>
      {parts.trailing}
    </View>;

  const capabilityBody = <>
    {foldTitle('capabilities', 'Capabilities', disclosureCount('capabilities', draft.capabilities.length, composerCapabilities.length))}
    {unfolded('capabilities') && <>
      {label('Unbuilt items can still be picked. The preview marks them missing until the engine supports them.')}
      {tileGrid('composer-capabilities', composerCapabilities.map(cap => {
        const on = draft.capabilities.includes(cap.id);
        const tag = capabilityTag(cap);
        return tile(cap.id, {
          on, title: cap.label, name: capabilityToggleName(cap, on), testID: `composer-capability-${cap.id}`, ...(tag ? { note: tag } : {}),
          onPress: () => setDraft({ capabilities: toggleId(draft.capabilities, cap.id) }),
        });
      }))}
    </>}
  </>;

  const railSection = section(
    <View style={{ gap: scale.space.element }}>
      {heading('Rail')}
      {label('Top to bottom, the order the rail will show them. Instruments marked Not in this build keep their place until they ship. Drag the handle or use the row controls to reorder.')}
      {draft.rail.length === 0
        ? <View testID="composer-rail-empty" style={{ minHeight: scale.size.target, justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: scale.radius.control, paddingHorizontal: scale.space.inset }}>
          <Text style={{ color: c.muted, fontSize: scale.type.label }}>{phone ? 'The rail is empty. Open Instruments below and pick one.' : 'The rail is empty. Pick an instrument below.'}</Text>
        </View>
        : rowStack('composer-rail', 'Rail order', draft.rail.map((id, index) => {
            const name = instrumentLabel(id);
            const target = s.drag?.target === index && s.drag.index !== index;
            return row(id, {
              on: s.drag?.index === index || target, title: name,
              leading: <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {draft.rail.length > 1 ? <DragGrabHandle label={`Drag ${name} to reorder`} transport={forgeDragTransport}
                  onStart={() => ui.setState({ drag: { index, originY: null, target: index } })}
                  onMove={point => ui.setState(st => {
                    if (!st.drag) return {};
                    const originY = st.drag.originY ?? point.y;
                    return { drag: { ...st.drag, originY, target: dragTargetIndex(st.drag.index, point.y - originY, rowHeights) } };
                  })}
                  onCommit={() => { const d = ui.getState().drag; ui.setState({ drag: null }); if (d && d.target !== d.index) move(d.index, d.target - d.index); }}
                  onCancel={() => ui.setState({ drag: null })}><ForgeIcon name="menu" size={16} color={c.muted} reducedMotion /></DragGrabHandle> : null}
                {/* The same numeral the chosen tile carries. */}
                <Text style={{ color: c.accent, fontSize: scale.type.label, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 18, textAlign: 'center' }}>{String(index + 1)}</Text>
              </View>,
              trailing: !wide ? <Menu title={name} triggerLabel={`Move or remove ${name}`}
                actions={[
                  { id: 'up', title: 'Move up', disabled: index === 0 }, { id: 'down', title: 'Move down', disabled: index === draft.rail.length - 1 },
                  { id: 'top', title: 'Move to top', disabled: index === 0 }, { id: 'bottom', title: 'Move to bottom', disabled: index === draft.rail.length - 1 },
                  { id: 'remove', title: 'Remove from rail', destructive: true },
                ]}
                onAction={a => {
                  if (a === 'up') move(index, -1); else if (a === 'down') move(index, 1);
                  else if (a === 'top') move(index, -index); else if (a === 'bottom') move(index, draft.rail.length - 1 - index);
                  else if (a === 'remove') setDraft({ rail: draft.rail.filter(x => x !== id) });
                }}>{rowMenu(`Move or remove ${name}`)}</Menu> : <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Button title="Up" aria-label={`Move ${name} up`} disabled={index === 0} onPress={() => move(index, -1)} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className={HC_EDGE} />
                <Button title="Down" aria-label={`Move ${name} down`} disabled={index === draft.rail.length - 1} onPress={() => move(index, 1)} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className={HC_EDGE} />
                <IconButton aria-label={`Remove ${name} from the rail`} icon={<ForgeIcon name="close" size={16} color={c.muted} reducedMotion />}
                  onPress={() => setDraft({ rail: draft.rail.filter(x => x !== id) })} variant="ghost" size="sm" tone="carolina" className={HC_EDGE} />
              </View>,
            });
          }), height => ui.setState({ railHeight: height }))}
      {s.drag && <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontSize: scale.type.label }}>
        {`Drop at position ${s.drag.target + 1} of ${draft.rail.length}. Press Escape to cancel.`}</Text>}
      <View style={{ gap: scale.space.element, marginTop: scale.space.element }}>
        {foldTitle('instruments', 'Instruments', disclosureCount('rail', draft.rail.length, designStudioInstruments.length))}
        {unfolded('instruments') && tileGrid('composer-instruments', designStudioInstruments.map(i => {
          const position = railPosition(draft.rail, i.id);
          const tag = instrumentTag(i);
          return tile(i.id, {
            on: position !== undefined, title: i.label, name: instrumentToggleName(i.label, position, tag), testID: `composer-instrument-${i.id}`, ...(tag ? { note: tag } : {}),
            ...(position !== undefined ? { mark: <Text style={{ color: c.accent, fontSize: scale.type.label, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{String(position)}</Text> } : {}),
            onPress: () => setDraft({ rail: toggleId(draft.rail, i.id) }),
          });
        }))}
        {/* Phone: both grids fold, so their disclosures sit together in one
            section, split by a hairline, with no section gap between them. */}
        {phone && <View style={{ gap: scale.space.element, borderTopWidth: 1, borderTopColor: c.line }}>{capabilityBody}</View>}
      </View>
    </View>);

  const capabilitySection = section(<View style={{ gap: scale.space.element }}>{capabilityBody}</View>);

  const surfaceSection = section(
    <View style={{ gap: scale.space.element }}>
      {heading('Surfaces')}
      <SegmentedControl aria-label="Where this persona appears" value={draft.surfaceMode}
        options={[{ value: 'all', label: 'Every surface' }, { value: 'chosen', label: 'Chosen surfaces' }]}
        onChange={value => setDraft({ surfaceMode: value as SurfaceMode })}
        {...(isWeb && (props.theme ?? 'dark') === 'light' ? LIGHT_SEGMENTS : { segmentClassName: HC_EDGE })} />
      {draft.surfaceMode === 'chosen' && tileGrid('composer-surfaces', PERSONA_SURFACES.map(sf => {
          const on = draft.surfaces.includes(sf);
          return tile(sf, { on, title: SURFACE_LABELS[sf], name: `${on ? 'Shown on' : 'Show on'} ${SURFACE_LABELS[sf]}`, testID: `composer-surface-${sf}`,
            onPress: () => setDraft({ surfaces: toggleId<PersonaSurface>(draft.surfaces, sf) }) });
        }))}
      {label(draft.surfaceMode === 'all' ? 'Shows on iPhone, iPad, Android, web, desktop and XR.' : 'The turret hides this persona on surfaces left out.')}
    </View>);

  /** Dismiss's label lines up with the message text: the button's own inset is pulled out. */
  const dismiss = (onPress: () => void) => <View style={{ marginLeft: -GHOST_INSET }}>
    <Button title="Dismiss" onPress={onPress} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className={HC_EDGE} />
  </View>;
  const noticeBanner = (where: 'save' | 'list') => s.notice && (s.notice.at ?? 'save') === where && <Banner tone={s.notice.tone} live={s.notice.tone === 'danger' ? 'alert' : 'status'} title={s.notice.title}
    {...(s.notice.description ? { description: s.notice.description } : {})}
    {...(s.notice.tone === 'danger' ? { className: DANGER_GROUND } : {})}
    action={dismiss(() => ui.setState({ notice: null }))} />;
  const notices = <>
    {storeError && <Banner tone="danger" live="alert" title="Persona problem" description={storeError} className={DANGER_GROUND}
      action={dismiss(() => props.store.getState().clearError())} />}
    {noticeBanner('save')}
  </>;

  const previewSection = <View testID="composer-preview" style={{ gap: scale.space.element, padding: scale.space.group, backgroundColor: c.raised, borderRadius: scale.radius.panel, borderWidth: 1, borderColor: c.line }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: scale.space.element }}>
      {heading(`${draft.label.trim() || 'Untitled persona'} on ${surfaceWord}`)}
      <Text style={{ color: c.muted, fontSize: scale.type.label, fontVariant: ['tabular-nums'] }}>{`${draft.rail.length} on rail`}</Text>
    </View>
    {!manifest.available && <Text style={{ color: c.error, fontSize: scale.type.label }}>{`${manifest.reason}. It won't appear on ${surfaceWord}.`}</Text>}
    {draft.rail.length > 0 && <View accessibilityLabel="Rail order" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: scale.space.element }}>
      {draft.rail.map((id, i) => <View key={id} style={{ flexDirection: 'row', gap: scale.space.stack, paddingVertical: scale.space.stack, paddingHorizontal: scale.space.element, borderRadius: scale.radius.control, backgroundColor: c.deep }}>
        <Text style={{ color: c.accent, fontSize: scale.type.label, fontVariant: ['tabular-nums'] }}>{String(i + 1)}</Text>
        <Text style={{ color: c.text, fontSize: scale.type.label }}>{instrumentLabel(id)}</Text>
      </View>)}
    </View>}
    {manifest.lines.length === 0
      ? <Text style={{ color: c.muted, fontSize: scale.type.label }}>No capabilities picked. The rail works without them.</Text>
      : manifest.lines.map(line => <View key={line.id} style={{ flexDirection: 'row', alignItems: 'center', gap: scale.space.element, minHeight: 28 }}>
        <ForgeIcon name={line.ready ? 'check' : 'minus'} size={14} color={line.ready ? c.accent : c.muted} reducedMotion />
        <Text style={{ color: line.ready ? c.text : c.muted, fontSize: scale.type.label, flex: 1 }}>{line.ready ? `${line.label}: works here` : line.note}</Text>
      </View>)}
    <View style={{ gap: scale.space.stack, marginTop: scale.space.element }}>
      <Button title="Save persona" onPress={save} disabled={!!blocker} variant="primary" size="md" tone="carolina" cornerRadius={4} className={HC_EDGE}
        {...(blocker ? { accessibilityHint: blocker } : {})} />
      {blocker && <Text style={{ color: c.muted, fontSize: scale.type.label }}>{blocker}</Text>}
      {notices}
    </View>
  </View>;

  const personaRows = <View style={{ gap: scale.space.element }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: scale.space.element }}>
      {heading('Personas')}
      <Button title={s.importOpen ? 'Close import' : 'Import'} onPress={() => ui.setState(st => ({ importOpen: !st.importOpen }))} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className={HC_EDGE} />
    </View>
    {s.importOpen && <View style={{ gap: scale.space.element }}>
      <TextInput testID="composer-import" accessibilityLabel="Persona JSON to import" multiline numberOfLines={4} value={s.importText}
        placeholder='Paste an exported persona, starting with {"format":1' autoCapitalize="none" autoCorrect={false}
        onChangeText={text => ui.setState({ importText: text })}
        style={{ minHeight: 96, borderWidth: 1, borderColor: c.line, borderRadius: scale.radius.control, padding: scale.space.inset, color: c.text, backgroundColor: c.deep, fontSize: scale.type.label, fontFamily: scale.font.mono, textAlignVertical: 'top' }} />
      <Button title="Import persona" onPress={runImport} disabled={!s.importText.trim()} variant="primary" size="sm" tone="carolina" cornerRadius={4} className={HC_EDGE} />
    </View>}
    {noticeBanner('list')}
    {personas.some(p => p.builtIn) && label(BUILT_IN_CAPTION)}
    {rowStack('composer-personas', 'Personas', personas.map(p => {
      const actions = p.builtIn
        ? [{ id: 'copy', title: 'Start a copy' }]
        : [{ id: 'copy', title: 'Start a copy' }, { id: 'export', title: props.onExportPersona ? 'Export' : 'Show JSON' }, { id: 'remove', title: 'Remove', destructive: true }];
      return row(p.id, {
        title: p.label, note: personaSummary(p),
        trailing: <Menu title={p.label} triggerLabel={`Actions for ${p.label}`} actions={actions}
          onAction={id => { if (id === 'copy') startFrom(p); else if (id === 'export') void exportPersona(p); else if (id === 'remove') removePersona(p); }}>
          {rowMenu(`Actions for ${p.label}`)}
        </Menu>,
      });
    }))}
    {personas.every(p => p.builtIn) && label('Personas you save or import are listed here too.')}
    {s.exported && <View style={{ gap: scale.space.stack }}>
      {label(`${s.exported.label} as JSON`)}
      <TextInput testID="composer-export" accessibilityLabel={`${s.exported.label} as JSON`} value={s.exported.json} editable={false} selectTextOnFocus multiline
        style={{ minHeight: 72, borderWidth: 1, borderColor: c.line, borderRadius: scale.radius.control, padding: scale.space.inset, color: c.text, backgroundColor: c.deep, fontSize: scale.type.label, fontFamily: scale.font.mono }} />
    </View>}
  </View>;


  const form = <FieldGroup>{nameSection}{railSection}{phone ? null : capabilitySection}{surfaceSection}</FieldGroup>;
  const cancelDrag = (event: StudioKeyboardEvent) => { if (keyboardKey(event) === 'Escape' && ui.getState().drag) ui.setState({ drag: null }); };
  const body = <View testID="persona-composer" onLayout={e => ui.setState({ width: e.nativeEvent.layout.width })}
    {...{ onKeyDown: cancelDrag }}
    style={{ gap: scale.space.group, padding: wide ? scale.space.section : scale.space.group, backgroundColor: c.base }}>
    <View style={{ gap: scale.space.stack }}>
      <Text accessibilityRole="header" {...LEVEL_1} style={{ color: c.text, fontSize: scale.type.title, fontWeight: '700' }}>New persona</Text>
      <Text style={{ color: c.muted, fontSize: scale.type.label }}>{`Pick the rail and capabilities for a persona in the design studio. The preview shows what works on ${surfaceWord}.`}</Text>
    </View>
    {isWeb && <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>{s.announcement}</Text>}
    {wide
      ? <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: scale.space.section }}>
        <View style={{ flex: 3, minWidth: 0 }}>{form}</View>
        <View style={{ flex: 2, minWidth: 0, gap: scale.space.section }}>{previewSection}{personaRows}</View>
      </View>
      : <View style={{ gap: scale.space.section }}>{form}{previewSection}{personaRows}</View>}
  </View>;
  return (props.theme ?? 'dark') === 'dark' ? <NightScope>{body}</NightScope> : body;
}
