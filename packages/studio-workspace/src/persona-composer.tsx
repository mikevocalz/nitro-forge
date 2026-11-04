import { useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { ForgeIcon } from '@nitro-forge/icons/native';
import {
  Banner, Button, FieldGroup, IconButton, List, ListItem, Menu, NightScope, SegmentedControl, Text, TextInput, View,
} from './ui';
import { DragGrabHandle } from './drag-grab-handle';
import { PERSONA_SURFACES, type PersonaSpec, type PersonaSurface } from './persona';
import type { PersonaStore } from './persona-store';
import {
  EMPTY_COMPOSER_DRAFT, PERSONA_NAME_MAX, SURFACE_LABELS, capabilityTag, composerCapabilities, designStudioInstruments,
  dragTargetIndex, draftManifest, instrumentLabel, moveAnnouncement, moveRailItem, nameCounter, requestedImportLabel,
  saveBlocker, savedMessage, SURFACE_PROSE, toPersonaDraft, toggleId, type ComposerDraft, type SurfaceMode,
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

type Notice = Readonly<{ tone: 'success' | 'danger' | 'info'; title: string; description?: string }>;
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
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WIDE = 1000;

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
    importOpen: false, importText: '', exported: null,
  }));
  const ui = local.current;
  const s = useStore(ui, x => x);
  const personas = useStore(props.store, x => x.personas);
  const surface = useStore(props.store, x => x.surface);
  const storeError = useStore(props.store, x => x.error);
  const c = props.colors ?? prismThemes[props.theme ?? 'dark'];
  const wide = s.width >= WIDE;
  const { draft } = s;
  const setDraft = (patch: Partial<ComposerDraft>) => ui.setState(st => ({ draft: { ...st.draft, ...patch } }));
  const blocker = saveBlocker(draft);
  const manifest = draftManifest(draft, surface);
  const available = designStudioInstruments.filter(i => !draft.rail.includes(i.id));
  const surfaceWord = SURFACE_PROSE[surface];

  const move = (index: number, delta: number) => {
    const id = draft.rail[index];
    if (!id) return;
    const rail = moveRailItem(draft.rail, index, delta);
    ui.setState(st => ({ draft: { ...st.draft, rail }, announcement: moveAnnouncement(rail, id) }));
  };
  const save = () => {
    if (blocker) return;
    try {
      const saved = props.store.getState().compose(toPersonaDraft(draft));
      ui.setState({ draft: EMPTY_COMPOSER_DRAFT, notice: { tone: 'success', title: savedMessage('Saved', draft.label, saved) } });
    } catch (e) { ui.setState({ notice: { tone: 'danger', title: 'Not saved', description: message(e) } }); }
  };
  const runImport = () => {
    const json = s.importText;
    try {
      const saved = props.store.getState().importJson(json);
      ui.setState({ importOpen: false, importText: '', notice: { tone: 'success', title: savedMessage('Imported', requestedImportLabel(json), saved) } });
    } catch (e) { ui.setState({ notice: { tone: 'danger', title: 'Not imported', description: message(e) } }); }
  };
  const exportPersona = async (persona: PersonaSpec) => {
    let json: string;
    try { json = props.store.getState().exportJson(persona.id); }
    catch (e) { ui.setState({ notice: { tone: 'danger', title: `${persona.label} not exported`, description: message(e) } }); return; }
    if (!props.onExportPersona) {
      ui.setState({ exported: { id: persona.id, label: persona.label, json }, notice: { tone: 'info', title: `${persona.label} as JSON`, description: 'Select the text below and copy it.' } });
      return;
    }
    try {
      const outcome = await props.onExportPersona(json, persona);
      ui.setState({ exported: null, notice: { tone: 'success', title: outcome === 'shared' ? `Shared ${persona.label}` : `Copied ${persona.label} as JSON` } });
    } catch (e) {
      ui.setState({ exported: { id: persona.id, label: persona.label, json }, notice: { tone: 'danger', title: `${persona.label} not copied`, description: `${message(e)}. Select the text below and copy it instead.` } });
    }
  };
  const removePersona = (persona: PersonaSpec) => {
    try {
      props.store.getState().remove(persona.id);
      ui.setState(st => ({ exported: st.exported?.id === persona.id ? null : st.exported, notice: { tone: 'info', title: `Removed ${persona.label}` } }));
    } catch (e) { ui.setState({ notice: { tone: 'danger', title: `${persona.label} not removed`, description: message(e) } }); }
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

  const label = (text: string) => <Text style={{ color: c.muted, fontSize: scale.type.label }}>{text}</Text>;
  const heading = (text: string, id?: string) => <Text accessibilityRole="header" nativeID={id} style={{ color: c.text, fontSize: scale.type.body, fontWeight: '600' }}>{text}</Text>;
  const rowHeights = draft.rail.map(() => (draft.rail.length ? s.railHeight / draft.rail.length : 0));

  const nameSection = <FieldGroup.Section>
    <View style={{ gap: scale.space.stack }}>
      {heading('Name')}
      <TextInput testID="composer-name" accessibilityLabel="Persona name" placeholder="Print layout" maxLength={PERSONA_NAME_MAX}
        value={draft.label} onChangeText={text => setDraft({ label: text })} returnKeyType="done"
        style={{ minHeight: scale.size.target, borderWidth: 1, borderColor: c.line, borderRadius: scale.radius.control, paddingHorizontal: scale.space.inset, color: c.text, backgroundColor: c.deep, fontSize: scale.type.body }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: scale.space.element }}>
        {label('Shown on the turret and the rail header')}
        <Text style={{ color: c.muted, fontSize: scale.type.label, fontVariant: ['tabular-nums'] }}>{nameCounter(draft.label)}</Text>
      </View>
    </View>
  </FieldGroup.Section>;

  const railSection = <FieldGroup.Section>
    <View style={{ gap: scale.space.element }}>
      {heading('Rail')}
      {label('Instruments appear on the rail top to bottom in this order.')}
      {draft.rail.length === 0
        ? <View testID="composer-rail-empty" style={{ minHeight: scale.size.target, justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: scale.radius.control, paddingHorizontal: scale.space.inset }}>
          <Text style={{ color: c.muted, fontSize: scale.type.label }}>The rail is empty. Add an instrument from the list below.</Text>
        </View>
        : <View testID="composer-rail" onLayout={e => ui.setState({ railHeight: e.nativeEvent.layout.height })}>
          <List tone="carolina">
            {draft.rail.map((id, index) => {
              const name = instrumentLabel(id);
              const target = s.drag?.target === index && s.drag.index !== index;
              return <ListItem key={id} selected={s.drag?.index === index || target}
                supportingText={`Position ${index + 1} of ${draft.rail.length}`}
                leading={draft.rail.length > 1 ? <DragGrabHandle label={`Drag ${name} to reorder`} color={c.muted}
                  onStart={() => ui.setState({ drag: { index, originY: null, target: index } })}
                  onMove={point => ui.setState(st => {
                    if (!st.drag) return {};
                    const originY = st.drag.originY ?? point.y;
                    return { drag: { ...st.drag, originY, target: dragTargetIndex(st.drag.index, point.y - originY, rowHeights) } };
                  })}
                  onCommit={() => { const d = ui.getState().drag; ui.setState({ drag: null }); if (d && d.target !== d.index) move(d.index, d.target - d.index); }}
                  onCancel={() => ui.setState({ drag: null })} /> : undefined}
                trailing={!wide ? <Menu title={name} triggerLabel={`Move or remove ${name}`}
                  actions={[
                    { id: 'up', title: 'Move up', disabled: index === 0 }, { id: 'down', title: 'Move down', disabled: index === draft.rail.length - 1 },
                    { id: 'top', title: 'Move to top', disabled: index === 0 }, { id: 'bottom', title: 'Move to bottom', disabled: index === draft.rail.length - 1 },
                    { id: 'remove', title: 'Remove from rail', destructive: true },
                  ]}
                  onAction={a => {
                    if (a === 'up') move(index, -1); else if (a === 'down') move(index, 1);
                    else if (a === 'top') move(index, -index); else if (a === 'bottom') move(index, draft.rail.length - 1 - index);
                    else if (a === 'remove') setDraft({ rail: draft.rail.filter(x => x !== id) });
                  }}>
                  <View accessibilityLabel={`Move or remove ${name}`} style={{ minWidth: scale.size.target, minHeight: scale.size.target, alignItems: 'center', justifyContent: 'center' }}>
                    <ForgeIcon name="move" size={16} color={c.muted} reducedMotion />
                  </View>
                </Menu> : <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Button title="Up" aria-label={`Move ${name} up`} disabled={index === 0} onPress={() => move(index, -1)} variant="ghost" size="sm" tone="carolina" cornerRadius={4} />
                  <Button title="Down" aria-label={`Move ${name} down`} disabled={index === draft.rail.length - 1} onPress={() => move(index, 1)} variant="ghost" size="sm" tone="carolina" cornerRadius={4} />
                  <IconButton aria-label={`Remove ${name} from the rail`} icon={<ForgeIcon name="close" size={16} color={c.muted} reducedMotion />}
                    onPress={() => setDraft({ rail: draft.rail.filter(x => x !== id) })} variant="ghost" size="sm" tone="carolina" />
                </View>}>{name}</ListItem>;
            })}
          </List>
        </View>}
      {s.drag && <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontSize: scale.type.label }}>
        {`Drop at position ${s.drag.target + 1} of ${draft.rail.length}. Press Escape to cancel.`}</Text>}
      {available.length > 0 && <View style={{ gap: scale.space.stack, marginTop: scale.space.element }}>
        {heading('Add to rail')}
        <List tone="carolina">
          {available.map(i => <ListItem key={i.id}
            trailing={<Button title="Add" aria-label={`Add ${i.label} to the rail`} onPress={() => setDraft({ rail: [...draft.rail, i.id] })} variant="outline" size="sm" tone="carolina" cornerRadius={4} />}>{i.label}</ListItem>)}
        </List>
      </View>}
    </View>
  </FieldGroup.Section>;

  const capabilitySection = <FieldGroup.Section>
    <View style={{ gap: scale.space.element }}>
      {heading('Capabilities')}
      {label('Items not in this build can still be picked. They show as missing until the engine supports them.')}
      <List tone="carolina">
        {composerCapabilities.map(cap => {
          const tag = capabilityTag(cap);
          const on = draft.capabilities.includes(cap.id);
          return <ListItem key={cap.id} {...(tag ? { supportingText: tag } : {})}
            trailing={<Button title={on ? 'Included' : 'Include'} selected={on} aria-label={`Include ${cap.label}${tag ? `, ${tag.toLowerCase()}` : ''}`}
              {...(on ? { icon: <ForgeIcon name="check" size={14} color={c.ink} reducedMotion /> } : {})}
              onPress={() => setDraft({ capabilities: toggleId(draft.capabilities, cap.id) })} variant={on ? 'primary' : 'outline'} size="sm" tone="carolina" cornerRadius={4} />}>{cap.label}</ListItem>;
        })}
      </List>
    </View>
  </FieldGroup.Section>;

  const surfaceSection = <FieldGroup.Section>
    <View style={{ gap: scale.space.element }}>
      {heading('Surfaces')}
      <SegmentedControl aria-label="Where this persona appears" value={draft.surfaceMode}
        options={[{ value: 'all', label: 'Every surface' }, { value: 'chosen', label: 'Chosen surfaces' }]}
        onChange={value => setDraft({ surfaceMode: value as SurfaceMode })} />
      {draft.surfaceMode === 'chosen' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: scale.space.element }} accessibilityLabel="Surfaces">
        {PERSONA_SURFACES.map(sf => {
          const on = draft.surfaces.includes(sf);
          return <Button key={sf} title={SURFACE_LABELS[sf]} selected={on} onPress={() => setDraft({ surfaces: toggleId<PersonaSurface>(draft.surfaces, sf) })}
            icon={on ? <ForgeIcon name="check" size={14} color={c.accent} reducedMotion /> : undefined}
            variant={on ? 'primary' : 'outline'} size="sm" tone="carolina" cornerRadius={4} />;
        })}
      </View>}
      {label(draft.surfaceMode === 'all' ? 'Shows on iPhone, iPad, Android, web, desktop and XR.' : 'The turret hides this persona on surfaces left out.')}
    </View>
  </FieldGroup.Section>;

  const notices = <>
    {storeError && <Banner tone="danger" live="alert" title="Persona problem" description={storeError}
      action={<Button title="Dismiss" onPress={() => props.store.getState().clearError()} variant="ghost" size="sm" tone="carolina" cornerRadius={4} />} />}
    {s.notice && <Banner tone={s.notice.tone} live={s.notice.tone === 'danger' ? 'alert' : 'status'} title={s.notice.title}
      {...(s.notice.description ? { description: s.notice.description } : {})}
      action={<Button title="Dismiss" onPress={() => ui.setState({ notice: null })} variant="ghost" size="sm" tone="carolina" cornerRadius={4} />} />}
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
      <Button title="Save persona" onPress={save} disabled={!!blocker} variant="primary" size="md" tone="carolina" cornerRadius={4}
        {...(blocker ? { accessibilityHint: blocker } : {})} />
      {blocker && <Text style={{ color: c.muted, fontSize: scale.type.label }}>{blocker}</Text>}
      {notices}
    </View>
  </View>;

  const personaRows = <View style={{ gap: scale.space.element }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: scale.space.element }}>
      {heading('Personas')}
      <Button title={s.importOpen ? 'Close import' : 'Import'} onPress={() => ui.setState(st => ({ importOpen: !st.importOpen }))} variant="ghost" size="sm" tone="carolina" cornerRadius={4} />
    </View>
    {s.importOpen && <View style={{ gap: scale.space.element }}>
      <TextInput testID="composer-import" accessibilityLabel="Persona JSON to import" multiline numberOfLines={4} value={s.importText}
        placeholder='Paste an exported persona, starting with {"format":1' autoCapitalize="none" autoCorrect={false}
        onChangeText={text => ui.setState({ importText: text })}
        style={{ minHeight: 96, borderWidth: 1, borderColor: c.line, borderRadius: scale.radius.control, padding: scale.space.inset, color: c.text, backgroundColor: c.deep, fontSize: scale.type.label, fontFamily: scale.font.mono, textAlignVertical: 'top' }} />
      <Button title="Import persona" onPress={runImport} disabled={!s.importText.trim()} variant="primary" size="sm" tone="carolina" cornerRadius={4} />
    </View>}
    <List tone="carolina">
      {personas.map(p => {
        const actions = p.builtIn
          ? [{ id: 'copy', title: 'Start a copy' }]
          : [{ id: 'copy', title: 'Start a copy' }, { id: 'export', title: props.onExportPersona ? 'Export' : 'Show JSON' }, { id: 'remove', title: 'Remove', destructive: true }];
        return <ListItem key={p.id}
          supportingText={p.builtIn ? "Built in. Can't be removed or exported; start a copy to change it." : `${p.rail.length} on rail, ${p.surfaces === 'all' ? 'every surface' : p.surfaces.map(x => SURFACE_LABELS[x]).join(', ')}`}
          trailing={<Menu title={p.label} triggerLabel={`Actions for ${p.label}`} actions={actions}
            onAction={id => { if (id === 'copy') startFrom(p); else if (id === 'export') void exportPersona(p); else if (id === 'remove') removePersona(p); }}>
            <View accessibilityLabel={`Actions for ${p.label}`} style={{ minWidth: scale.size.target, minHeight: scale.size.target, alignItems: 'center', justifyContent: 'center' }}>
              <ForgeIcon name="menu" size={16} color={c.muted} reducedMotion />
            </View>
          </Menu>}>{p.label}</ListItem>;
      })}
    </List>
    {personas.every(p => p.builtIn) && label('Personas you save or import are listed here with the four built in.')}
    {s.exported && <View style={{ gap: scale.space.stack }}>
      {label(`${s.exported.label} as JSON`)}
      <TextInput testID="composer-export" accessibilityLabel={`${s.exported.label} as JSON`} value={s.exported.json} editable={false} selectTextOnFocus multiline
        style={{ minHeight: 72, borderWidth: 1, borderColor: c.line, borderRadius: scale.radius.control, padding: scale.space.inset, color: c.text, backgroundColor: c.deep, fontSize: scale.type.label, fontFamily: scale.font.mono }} />
    </View>}
  </View>;


  const form = <FieldGroup>{nameSection}{railSection}{capabilitySection}{surfaceSection}</FieldGroup>;
  const body = <View testID="persona-composer" onLayout={e => ui.setState({ width: e.nativeEvent.layout.width })}
    style={{ gap: scale.space.group, padding: wide ? scale.space.section : scale.space.group, backgroundColor: c.base }}>
    <View style={{ gap: scale.space.stack }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: scale.type.title, fontWeight: '700' }}>New persona</Text>
      <Text style={{ color: c.muted, fontSize: scale.type.label }}>{`Pick the rail and capabilities for a persona in the design studio. The preview shows what works on ${surfaceWord}.`}</Text>
    </View>
    <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>{s.announcement}</Text>
    {wide
      ? <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: scale.space.section }}>
        <View style={{ flex: 3, minWidth: 0 }}>{form}</View>
        <View style={{ flex: 2, minWidth: 0, gap: scale.space.section }}>{previewSection}{personaRows}</View>
      </View>
      : <View style={{ gap: scale.space.section }}>{form}{previewSection}{personaRows}</View>}
  </View>;
  return (props.theme ?? 'dark') === 'dark' ? <NightScope>{body}</NightScope> : body;
}
