import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import type { StudioViewRef } from './ui';
import { useEffect, useRef } from 'react';
import { Image, Pressable, ScrollView, Text, View, Menu, Button, IconButton, Banner, Badge, EmptyState, NightScope, TokenScope } from './ui';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { base64ToBytes, bytesToBase64 } from '@nitro-forge/ignition';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { encodeRgbaPng, validatePreviewSize } from './rgba-png';
import { prismThemes, resolveWorkspaceScale, type WorkspaceDensity } from './theme';
import { prismViewportLayout, PRISM_DOCKED_LAYERS_MIN_WIDTH, PRISM_TOOLBAR_TOP } from './prism-layout';
import { prismLayerLabel } from './prism-layer-label';
import { PrismCanvas } from './prism-canvas';
import { PrecisionScrubber } from '@nyc-tron/ui/components/forge/inputs/PrecisionScrubber';
import { LayerStack } from '@nyc-tron/ui/components/forge/layers/LayerStack';
import { prismLayerRows, prismMoveCommand, prismOpacityCommand, prismRenameCommand, prismRemoveCommand, prismSelectedRowId, prismVisibilityCommand, type PrismLayer, type PrismLayerCommand } from './prism-layers';
import { SHAPE_TRANSFORMS, shapeTransformPayload } from './prism-transform';
import { Platform } from 'react-native';
import { PersonaTurret, documentRtl, turretBoxWidth, useForgeRenderPrefs, useStudioTextScale, useTurretShortcut, type PersonaTurretHandle } from './persona-turret';
import { chromePalette, forgeDirections, forgeFeedbackMotion, nycTronTokens, nycTronTokensFor, directionPalette, systemColor, workbenchChrome, type ForgeDirectionId } from './forge-directions';
import { turretDisplayAngle } from './turret';
import { personasOn } from './persona';
import { createPersonaStore, type PersonaStore } from './persona-store';
import type { PersonaSurface } from './persona';
import type { TurretEffect } from './turret';

type PrismState = { width: number; height: number; layers: PrismLayer[] };
type LocalState = { selectedId: number | null; uri: string | null; rendering: boolean; busy: boolean; error: string | null; previewError: string | null; notice: string; layersOpen: boolean; personaOpen: boolean; personaStatus: string; trigger: { x: number; width: number }; toolbarHeight: number; railWidth: number; fillHeight: number; feedbackHeight: number; popoverHeight: number; width: number; height: number; retry: number; color: number };
/** A real-engine Prism canvas. Selection and panel state are local; all edits use engine commands. */
export interface PrismEditorProps {
  state: unknown;
  apply: (op: string, payload?: unknown) => Promise<unknown>;
  reload: () => Promise<void>;
  theme?: 'dark' | 'light';
  density?: WorkspaceDensity;
  /** Material comparison only; document state remains in the same host session. */
  direction?: ForgeDirectionId;
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
  const scale = resolveWorkspaceScale(props.density);
  const directionId = props.direction ?? 'workbench';
  const direction = forgeDirections[directionId];
  const material = direction.materials[scheme];
  const mat = prismThemes[scheme];
  // Every panel is cut from the turret's Workbench material: graphite in
  // dark, white ceramic with dark engraving in light.
  const baseChrome = workbenchChrome[scheme];
  const chrome = directionId === 'workbench' ? baseChrome : { ...baseChrome, body: material.panelSolid, edge: material.panelEdge, text: material.text, muted: material.muted, accent: material.accent, depth: direction.depth[scheme].panel };
  const colors = directionId === 'workbench' ? chromePalette(scheme) : directionPalette(direction, scheme);
  const controlTokens = directionId === 'workbench' ? nycTronTokens(scheme) : nycTronTokensFor(colors);
  const forced = !!useForgeRenderPrefs().forcedColors;
  const textScale = useStudioTextScale();
  const ownPersonas = useRef<PersonaStore | null>(null);
  if (!props.personas && !ownPersonas.current) ownPersonas.current = createPersonaStore({ surface: hostSurface() });
  const personaStore = props.personas ?? ownPersonas.current!;
  const persona = useStore(personaStore, s => s);
  const activePersona = persona.personas.find(p => p.id === persona.activeId);
  const activeCaps = new Set(activePersona?.capabilities ?? []);
  const localRef = useRef<StoreApi<LocalState> | null>(null);
  if (!localRef.current) localRef.current = createStore<LocalState>(() => ({ selectedId: null, uri: null, rendering: false, busy: false, error: null, previewError: null, notice: '', layersOpen: false, personaOpen: false, personaStatus: '', trigger: { x: 0, width: 0 }, toolbarHeight: 48, railWidth: 52, fillHeight: 52, feedbackHeight: 0, popoverHeight: 0, width: 800, height: 600, retry: 0, color: 0 }));
  const store = localRef.current;
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
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      if (mounted.current && store.getState().notice === notice) store.setState({ notice: '' });
    }, 2500);
    return () => clearTimeout(timer);
  }, [notice, store]);
  const doc = readState(props.state);
  const layers = doc?.layers ?? [];
  const selected = layers.find(layer => layer.id === selectedId);
  const selectedIndex = layers.findIndex(layer => layer.id === selectedId);
  const ratio = doc && doc.width > 0 && doc.height > 0 ? doc.width / doc.height : 1;
  // Larger text grows the kit controls in the toolbar and rail; the layout
  // starts from what was measured, not from the 100 % offsets.
  const measuredToolbar = useStore(store, s => s.toolbarHeight);
  const railWidth = useStore(store, s => s.railWidth);
  const fillHeight = useStore(store, s => s.fillHeight);
  const feedbackHeight = useStore(store, s => s.feedbackHeight);
  const { narrow, short, dockedLayers, panelWidth, panelTop, panelMaxHeight, layerListMaxHeight, railTop,
    canvasLeft, canvasRight, canvasTop, canvasBottom, canvasWidth, canvasHeight, fillWidth, fillLeft
  } = prismViewportLayout(width, height, ratio, layersOpen, !!selected, { toolbarBottom: PRISM_TOOLBAR_TOP + measuredToolbar, railRight: 12 + railWidth });
  const feedback = error ?? previewError ?? (rendering ? 'Updating engine composite…' : notice);

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
  /** One LayerStack callback becomes at most one engine operation (one undo step). */
  const runLayerCommand = (build: (layers: readonly PrismLayer[]) => PrismLayerCommand | undefined) => {
    if (store.getState().busy || current.current.busy) { store.setState({ notice: 'Wait for the current edit to finish' }); return; }
    let command: PrismLayerCommand | undefined;
    try { command = build(readState(current.current.state)?.layers ?? []); }
    catch (cause) { store.setState({ error: message(cause) }); return; }
    return command ? run(command.op, command.payload, command.label) : undefined;
  };
  const selectedRow = prismSelectedRowId(selectedId);
  const control = (label: string, onPress: () => void, disabled = false, selected = false, glyph?: string, visibleLabel?: string, iconOnly = false, hint?: string) => {
    const unavailable = disabled || busy || !!props.busy;
    const icon = glyph ? <ForgeIcon name={glyph} size={17} color={unavailable ? chrome.disabledInk : selected ? colors.accent : colors.muted} reducedMotion /> : undefined;
    // `opacity-100` keeps a host's blanket disabled fade off the kit's own
    // disabled ink, which is drawn to be read at full strength.
    const shared = { onPress, disabled: unavailable, variant: 'ghost' as const, size: 'sm' as const, tone: 'carolina' as const,
      cornerRadius: 4, className: `rounded-[4px] border border-transparent${props.density === 'comfortable' ? ' min-h-12 min-w-12' : ''}${selected ? ' bg-carolina-500/15' : ''}${unavailable ? ' opacity-100' : ''}`,
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
    const name = prismLayerLabel(kind);
    void run('addShape', { name: `${name} ${layers.length + 1}`, shape: { kind, x: Math.max(0, Math.round((doc.width - w) / 2)), y: Math.max(0, Math.round((doc.height - h) / 2)), w, h, fill: FILLS[store.getState().color] } }, `${name} added`);
  };
  /** One panel finish for every piece of chrome: the face, its chamfer and the lit top edge. */
  const chromeSurface = { backgroundColor: chrome.body, borderWidth: 1, borderColor: chrome.edge, borderRadius: scale.radius.panel, boxShadow: chrome.depth };
  const panel = <View testID="prism-layers" style={{ width: panelWidth, maxHeight: panelMaxHeight, position: 'absolute', zIndex: 60, top: panelTop, right: 12, ...chromeSurface, overflow: 'visible' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: scale.space.group, paddingRight: scale.space.stack, minHeight: scale.size.target+4, borderBottomWidth: 1, borderBottomColor: chrome.rule }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}>Layers</Text><Badge label={String(layers.length)} tone="neutral" size="xs" className="self-center mr-2 rounded-[4px] overflow-hidden" />
      {control('Close layers', () => store.setState({ layersOpen: false }), false, false, 'close', undefined, true)}
    </View>
    {/* NYC-Tron parts read semantic variables; these are cut from the same Workbench chrome. */}
    <TokenScope variables={controlTokens}>
    {/* Layer opacity uses the same precision instrument as every studio;
        only its released value becomes a Rust document operation. */}
    {selected && <View style={{ paddingHorizontal: scale.space.inset, paddingVertical: scale.space.element, zIndex: 10 }}>
      <PrecisionScrubber
        {...{targetSize: scale.size.target}}
        label="Layer opacity"
        value={selected.opacity * 100}
        min={0}
        max={100}
        step={1}
        unit="%"
        detents={[0, 25, 50, 75, 100]}
        disabled={busy || !!props.busy}
        forcedColors={forced}
        onCommit={value => run('setLayerOpacity', { id: selected.id, opacity: value / 100 }, 'Layer opacity changed')}
      />
    </View>}
      {layers.length
        ? <LayerStack testID="prism-layer-stack" layers={prismLayerRows(layers)} {...(selectedRow === undefined ? {} : { selectedId: selectedRow })} accentColor={forced ? systemColor('Highlight') : chrome.accent}
          style={{ maxHeight: layerListMaxHeight, flexShrink: 1, borderRadius: 0 }}
          onSelect={id => store.setState({ selectedId: Number(id) })}
          onToggleVisible={id => runLayerCommand(rows => prismVisibilityCommand(rows, id))}
          onOpacityCommit={(id, value) => runLayerCommand(rows => prismOpacityCommand(rows, id, value))}
          onMove={(id, toIndex) => runLayerCommand(rows => prismMoveCommand(rows, id, toIndex))}
          onRename={(id, name) => runLayerCommand(rows => prismRenameCommand(rows, id, name))}
          onRemove={id => runLayerCommand(rows => prismRemoveCommand(rows, id))} />
        : <EmptyState title="No layers" description="Add a shape or raster layer to begin." className="p-3" tone="carolina" action={<Button title="Add rectangle" onPress={() => addShape('rect')} disabled={busy || !!props.busy || !doc} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" />} />}
    </TokenScope>
      {/* Each row removes its own layer (button, screen-reader action, Delete).
          LayerStack reorders only by drag and screen-reader actions, so Raise
          and Lower stay for keyboard and pointer users. The last row already
          draws the rule above them. */}
      {selected && <View style={{ paddingHorizontal: scale.space.inset, paddingVertical: scale.space.element }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{control('Raise', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex + 1 }, 'Layer raised'); }, selectedIndex === layers.length - 1)}{control('Lower', () => { void run('moveLayer', { id: selected.id, to_index: selectedIndex - 1 }, 'Layer lowered'); }, selectedIndex <= 0)}</View>
      </View>}
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
  const popoverWidth = Math.min(turretBoxWidth(textScale, personaStops.length) + PANEL_GUTTER * 2, Math.max(1, width - 24));
  const triggerCentre = trigger.x + trigger.width / 2;
  // Keep the popover on the editor; the arrow keeps pointing at the trigger.
  const popoverLeft = Math.max(Math.min(POPOVER_MIN_LEFT, width - 24 - popoverWidth), Math.min(triggerCentre - popoverWidth / 2, width - 24 - popoverWidth));
  const arrowLeft = Math.max(PERSONA_ARROW, Math.min(popoverWidth - PERSONA_ARROW * 2, triggerCentre - popoverLeft - PERSONA_ARROW / 2));
  // Toolbar coordinates; the popover adds the toolbar's offset and 1 px border.
  const popoverTop = toolbarHeight + PERSONA_ARROW / 2 + 6;
  // The toast sits over the fill bar, centred. While the persona popover is
  // open it moves clear of the popover's right edge when the editor has room;
  // otherwise the popover ends above it. Neither ever covers the other.
  const toastBottom = 20 + fillHeight + 10;
  const toastWidth = Math.min(360, Math.max(1, width - 24));
  const popoverRight = PRISM_TOOLBAR_TOP + popoverLeft + popoverWidth;
  const popoverShown = personaOpen && !sheet && !props.onOpenPersonas;
  const popoverHeight = useStore(store, s => s.popoverHeight);
  // Only a popover whose content reaches down to the toast moves it.
  const popoverReachesToast = popoverShown && PRISM_TOOLBAR_TOP + popoverTop + popoverHeight > height - toastBottom - feedbackHeight - 8;
  const toastBeside = popoverReachesToast && popoverRight + 12 + toastWidth <= width - 12;
  const centredToast = (width - toastWidth) / 2;
  const toastLeft = toastBeside ? Math.max(centredToast, popoverRight + 12) : centredToast;
  const popoverFloor = feedback && !toastBeside ? toastBottom + feedbackHeight + 8 : 36;
  const pm = material;

  const personaTrigger = <View ref={personaTriggerView} key="persona-trigger" collapsable={false}
    onLayout={event => { const { x, width: w } = event.nativeEvent.layout; measureTrigger({ x, width: w }); }}>
    <Pressable testID="persona-trigger" accessibilityRole="button" aria-expanded={personaOpen} accessibilityState={{ expanded: personaOpen }}
      accessibilityLabel={`Persona: ${personaLabel}`} accessibilityHint="Opens the persona turret"
      onPress={() => { if (props.onOpenPersonas) props.onOpenPersonas(); else if (personaOpen) closePersonas(); else { measureTrigger(); store.setState({ personaOpen: true }); } }}
      style={({ pressed }) => ({
        minHeight: scale.size.target, flexDirection: 'row', alignItems: 'center', gap: scale.space.element, paddingHorizontal: scale.space.element, borderRadius: scale.radius.control,
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
      <Text accessibilityRole="header" {...{ 'aria-level': 2 }} style={{ color: pm.text, fontSize: 13, fontWeight: '600', flex: 1 }}>Persona</Text>
      {control('Close personas', () => closePersonas(), false, false, 'close', undefined, true)}
    </View>
    <PersonaTurret handle={personaTurret} personas={persona.personas} surface={persona.surface} activeId={persona.activeId} colors={colors} direction={directionId} scheme={scheme}
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
    ? <View key="persona-sheet" testID="persona-sheet-layer" style={{ position: 'absolute', zIndex: 70, left: 0, top: 0, width, height }}>
      <Pressable testID="persona-scrim" focusable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
        onPress={() => closePersonas()} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#000000', opacity: 0.45 }} />
      <View testID="persona-panel" role="dialog" aria-modal aria-label="Personas" accessibilityViewIsModal {...personaKeys}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: Math.min(560, Math.round(height * 0.6)), borderTopWidth: 1, borderTopLeftRadius: scale.radius.panel, borderTopRightRadius: scale.radius.panel, ...panelSurface } as never}>
        <ScrollView contentContainerStyle={{ padding: PANEL_GUTTER, paddingTop: 4, gap: 8, alignItems: 'center' }}>{personaBody}</ScrollView>
      </View>
    </View>
    : <View key="persona-popover" testID="persona-panel" role="dialog" aria-label="Personas" {...personaKeys}
      style={{ position: 'absolute', zIndex: 70, top: PRISM_TOOLBAR_TOP + 1 + popoverTop, left: PRISM_TOOLBAR_TOP + 1 + popoverLeft, width: popoverWidth, maxHeight: Math.max(160, height - PRISM_TOOLBAR_TOP - popoverTop - popoverFloor), borderWidth: 1, borderRadius: scale.radius.panel, ...panelSurface } as never}>
      {/* The notch: a square turned 45°, its top edges in the panel's edge colour. */}
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: -PERSONA_ARROW / 2 - 1, left: arrowLeft, width: PERSONA_ARROW, height: PERSONA_ARROW, backgroundColor: chrome.body, borderLeftWidth: 1, borderTopWidth: 1, borderColor: chrome.edge, transform: [{ rotate: '45deg' }] }} />
      {/* The content's own height, not the capped panel's, decides whether the toast must move. */}
      <ScrollView onContentSizeChange={(_, h) => { const next = Math.round(h) + 2; if (next !== store.getState().popoverHeight) store.setState({ popoverHeight: next }); }}
        contentContainerStyle={{ paddingHorizontal: PANEL_GUTTER, paddingTop: 4, paddingBottom: 12, gap: 8, alignItems: 'center' }}>{personaBody}</ScrollView>
    </View>;
  const editor = <View className={scheme === 'dark' ? 'scheme-dark' : 'scheme-light'} testID="prism-editor" onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    if (firstMeasurement.current) { firstMeasurement.current = false; store.setState({ width, height, layersOpen: width >= PRISM_DOCKED_LAYERS_MIN_WIDTH }); }
    else store.setState({ width, height });
  }} style={{ flex: 1, minHeight: 0, position: 'relative', backgroundColor: mat.deep }}>
    <View pointerEvents="box-none" style={{ position: 'absolute', left: canvasLeft, top: canvasTop, right: canvasRight, bottom: canvasBottom, alignItems: 'center', justifyContent: 'center' }}>
      {doc && <PrismCanvas document={doc} width={canvasWidth} height={canvasHeight} selectedId={selectedId}
        disabled={busy || !!props.busy || rendering || !!previewError} color={colors.accent}
        onSelect={id => store.setState({ selectedId: id })}
        onMoveShape={(id, dx, dy) => { void run('transformShape', { id, dx, dy, scale_x: 1, scale_y: 1 }, 'Shape moved'); }}>
        {uri && !previewError ? <Image testID="prism-composite" accessible accessibilityLabel="Prism canvas composite" source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} onError={() => { if (store.getState().uri === uri) store.setState({ previewError: 'The canvas preview could not be displayed. Retry the preview.' }); }} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}><Text style={{ color: colors.paperInk, fontSize: 12, textAlign: 'center' }}>{previewError ? 'Preview unavailable' : 'Rendering canvas…'}</Text></View>}
      </PrismCanvas>}
    </View>
    <View ref={personaToolbar} onLayout={event => store.setState({ toolbarHeight: event.nativeEvent.layout.height })} style={{ position: 'absolute', zIndex: personaOpen ? 70 : 20, top: 12, left: 12, width: toolbarWidth, minHeight: scale.size.target+4, paddingLeft: scale.space.inset+2, paddingRight: scale.space.stack, flexDirection: 'row', alignItems: 'center', gap: 10, ...chromeSurface }}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{selected?.name ?? 'Artboard'}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: scale.type.label }}>{selected ? `${prismLayerLabel(selected)} layer` : 'Prism document'}{doc ? ` · ${doc.width} × ${doc.height} px` : ''}</Text></View>
      {selected?.content?.type === 'shape' && !props.busy && <Menu key={selected.id} title="Transform shape" triggerLabel="Transform shape"
        actions={SHAPE_TRANSFORMS.map(({ id, title }) => ({ id, title, disabled: busy || !!props.busy }))}
        onAction={action => {
          const selection = store.getState().selectedId;
          // Reject stale callbacks. Keep the trigger mounted across our own
          // relative edits so repeated keyboard actions retain focus.
          if (selection !== selected.id || current.current.state !== props.state) return;
          const payload = shapeTransformPayload(selected.id, action);
          if (payload) void run('transformShape', payload, 'Shape transformed');
        }}>
        <View style={{ minHeight: scale.size.target, justifyContent: 'center', paddingHorizontal: scale.space.element, opacity: busy || props.busy ? .4 : 1 }}>
          <Text style={{ color: colors.muted, fontSize: 11 }}>Transform</Text>
        </View>
      </Menu>}
      {personaTrigger}
      {control('Layers', () => store.setState({ layersOpen: !layersOpen }), false, layersOpen, 'layers', undefined, width < 420)}
    </View>
    {/* Persona surfaces sit on the editor, not inside the toolbar: Android
        hit-tests children only within their parent's bounds, so a popover
        drawn past the toolbar row could be seen but not touched. */}
    {personaSurface}
    <View accessibilityLabel="Creation tools" onLayout={event => { const w = Math.round(event.nativeEvent.layout.width); if (w > 0 && w !== store.getState().railWidth) store.setState({ railWidth: w }); }}
      style={{ position: 'absolute', zIndex: 20, left: 12, top: railTop, minWidth: scale.size.canvasRail, alignItems: 'center', padding: 3, gap: 3, ...chromeSurface }}>
      {activeCaps.has('shapes') && <>
        {control('Rectangle', () => addShape('rect'), !doc, false, 'rectangle', undefined, true, 'Adds a centered rectangle using the selected fill')}
        {control('Ellipse', () => addShape('ellipse'), !doc, false, 'ellipse', undefined, true, 'Adds a centered ellipse using the selected fill')}
      </>}
      {activeCaps.has('shapes') && activeCaps.has('raster-layers') && <View style={{ height: 1, width: 26, backgroundColor: chrome.rule }} />}
      {activeCaps.has('raster-layers') && control('Raster layer', () => { void run('addRasterLayer', { name: `Raster ${layers.length + 1}` }, 'Raster layer added'); }, !doc, false, 'image', undefined, true, 'Adds an empty raster layer')}
      {!activeCaps.has('shapes') && !activeCaps.has('raster-layers') && <Text accessibilityRole="text" style={{ color: colors.muted, fontSize: scale.type.label, textAlign: 'center', paddingVertical: 6 }}>No tools in this build</Text>}
    </View>
    {layersOpen && panel}
    <View testID="prism-fill-bar" accessibilityLabel={selected ? 'Fill' : 'New shape fill'} onLayout={event => { const h = Math.round(event.nativeEvent.layout.height); if (h > 0 && h !== store.getState().fillHeight) store.setState({ fillHeight: h }); }} style={{ position: 'absolute', zIndex: 25, left: fillLeft, bottom: 20, width: fillWidth, minHeight: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, ...chromeSurface }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minHeight: 50, alignItems: 'center', flexDirection: 'row', gap: 2 }} style={{ flex: 1 }}>
      {!narrow && <Text style={{ color: colors.muted, fontSize: scale.type.label, marginRight: 8 }}>{selected ? 'Fill' : 'New shape fill'}</Text>}
      {/* Each chip sits in a 44 pt target. The chosen one is ringed with a gap,
          in the engraving colour, or the system highlight under forced colours. */}
      {FILL_COLORS.map((fill, index) => <Pressable key={fill} accessibilityRole="button" accessibilityLabel={`Choose ${FILL_NAMES[index]} fill`} accessibilityState={{ selected: color === index }} onPress={() => store.setState({ color: index })} style={{ width: scale.size.target, height: scale.size.target, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', borderRadius: scale.radius.control }}>
        <View style={{ width: 33, height: 33, alignItems: 'center', justifyContent: 'center', borderRadius: scale.radius.control + 2, borderWidth: 2, borderColor: color === index ? (forced ? systemColor('Highlight') : chrome.chipRing) : 'transparent', ...keepColour }}>
          <View style={{ width: 25, height: 25, backgroundColor: fill, borderRadius: scale.radius.control, borderWidth: 1, borderColor: forced ? systemColor('CanvasText') : chrome.chipEdge, ...keepColour }} />
        </View>
      </Pressable>)}
      {selected && <><View style={{ width: 1, height: 24, backgroundColor: chrome.rule, marginHorizontal: 5 }} />{control('Fill layer', () => { void run(selected.content.type === 'shape' ? 'setShapeFill' : 'fillLayer', { id: selected.id, color: FILLS[color] }, selected.content.type === 'shape' ? 'Shape fill changed' : 'Raster layer filled'); }, false, false, undefined, short && narrow ? 'Fill' : 'Fill layer')}</>}
      </ScrollView>
    </View>
    {!!feedback && <View onLayout={event => { const h = Math.round(event.nativeEvent.layout.height); if (h !== store.getState().feedbackHeight) store.setState({ feedbackHeight: h }); }}
      style={{ position: 'absolute', zIndex: 35, bottom: toastBottom, left: toastLeft, width: toastWidth }}>
      <Banner tone={error || previewError ? 'danger' : 'info'} title={feedback} live={error || previewError ? 'alert' : 'status'} className="rounded-[4px]"
        {...(previewError ? { action: <Button title="Retry preview" onPress={() => store.setState(s => ({ retry: s.retry + 1 }))} disabled={busy || !!props.busy} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px]" /> } : {})} />
    </View>}
    {/* The one live region for persona changes. It stays mounted, so the commit is read after the panel closes. */}
    <Text testID="persona-status" accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>{personaStatus}</Text>
  </View>;
  // Kit controls take the chrome's scheme: night on graphite, day on ceramic.
  const themed = <TokenScope variables={controlTokens}>{editor}</TokenScope>;
  return scheme === 'dark' ? <NightScope>{themed}</NightScope> : themed;
}
