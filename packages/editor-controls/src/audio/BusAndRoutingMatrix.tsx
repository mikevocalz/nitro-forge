import {forgeHairlineRadius} from "../radius.ts";
import {Select} from '@nyc-tron/ui/components/Select';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {valueAccessibility} from "../value-a11y.ts";
/**
 * Bus and routing matrix (roster E-19).
 *
 * Structural references pulled from Mobbin (structure only; Mobbin has no
 * GarageBand, BandLab, Logic Remote, Koala or Ableton Note screens, so these
 * are the closest matches it returned):
 * - TIDE, sound mix sheet: one level control per source, side by side.
 * - Spotify, Edit transition: per-track Volume / EQ / Effects selectors in one row.
 * - Brink, Playback Effects: grouped labelled rows, one setting per row on phone.
 * - Oura, Soundscapes: single-choice list with the current choice marked.
 */
import { useRef } from "react";
import {
  I18nManager, PanResponder, Platform, Pressable, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type LayoutChangeEvent,
  type PanResponderGestureState, type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { EmptyState, type EmptyStateExit } from "@nyc-tron/ui/components/feedback/EmptyState";
import {
  DEFAULT_SEND_LEVEL, ROUTING_COLUMNS, SEND_PAGE_STEP, SEND_STEP,
  cycleOutput, dragToSendLevel, formatSendLevel, outputName, resolveOutput, routingLayout,
  sendLabel, sendLevel, stepSendLevel,
  type RouteId, type RoutingBus, type RoutingSource,
} from "./routing.ts";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

const HIT = 44;
const SLOP = 4;

/** Props for {@linkcode BusAndRoutingMatrix}. */
export interface BusAndRoutingMatrixProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Committed routing of each source track, in display order. */
  readonly sources: readonly RoutingSource[];
  readonly ioBindings?:readonly {sourceId:RouteId;inputId:string|null;sidechainId:string|null;inputs:readonly {id:string;label:string}[];sidechains:readonly {id:string;label:string}[]}[];
  readonly onInputCommit?:((sourceId:RouteId,inputId:string|null)=>void|Promise<unknown>)|undefined;
  readonly onSidechainCommit?:((sourceId:RouteId,source:string|null)=>void|Promise<unknown>)|undefined;
  /** Buses that sources can output or send to. Buses feed the master only. */
  readonly buses: readonly RoutingBus[];
  /**
   * Once per press or arrow key with the requested main output, `null` for
   * the master. The matrix keeps showing `sources` until the app passes new
   * ones, so a rejected promise leaves the old routing on screen.
   */
  readonly onOutputCommit: (sourceId: RouteId, busId: RouteId | null) => void | Promise<unknown>;
  /**
   * Once per finished drag, key press or screen-reader step with the new
   * send level (0..1), and once with {@linkcode DEFAULT_SEND_LEVEL} when a
   * send is added. Not called when the level is unchanged.
   */
  readonly onSendCommit: (sourceId: RouteId, busId: RouteId, level: number) => void | Promise<unknown>;
  /** Once per press of a send's remove button or Delete on its slider. */
  readonly onSendRemove: (sourceId: RouteId, busId: RouteId) => void | Promise<unknown>;
  /** Live send level while a drag is in progress; never persist it. */
  readonly onSendChange?: ((sourceId: RouteId, busId: RouteId, level: number) => void) | undefined;
  /** The way out when there are no buses, e.g. "Add bus". */
  readonly emptyAction?: EmptyStateExit | undefined;
  /** @default false */
  readonly disabled?: boolean;
  /** Accessible name of the matrix region. @default "Routing" */
  readonly label?: string;
  className?: string;
  /** Drop the default token recipe; supply a full app recipe via `className`. */
  unstyled?: boolean;
}

/** React Native Web does not flip I18nManager for `dir="rtl"`; read the document there. */
function isRTL(): boolean {
  if (I18nManager.isRTL) return true;
  return Platform.OS === "web" && typeof document !== "undefined" && document.documentElement.dir === "rtl";
}

/**
 * Controlled routing matrix for track outputs and post-fader sends.
 *
 * At a container width that fits every column (at least 600 pt, see
 * `routingLayout`) it draws a grid: one row per source, an Output column
 * holding a radio group (Master plus each bus) and one send column per bus.
 * Narrower containers get one card per source with the same controls in
 * labelled rows. The width comes from `onLayout` on the matrix itself, not
 * from the window, so it adapts inside panes and split views.
 *
 * A send cell starts as an "Add send" button; pressing it commits
 * {@linkcode DEFAULT_SEND_LEVEL}. An existing send is a horizontal slider
 * (drag, arrows, PageUp/PageDown, Home/End, screen-reader increment and
 * decrement) with a remove button; Delete on the slider removes it too.
 * Each drag commits once on release; Escape or a responder termination
 * restores the committed level without a commit.
 *
 * A track may send to the bus its main output already feeds. The engine
 * accepts it and the matrix allows it: the bus then receives the track
 * twice, once at fader level and once at send level.
 */
export function BusAndRoutingMatrix({scope='BusAndRoutingMatrix',revision=0,...props}:BusAndRoutingMatrixProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.sources.map(s=>s.id),props.buses.map(b=>b.id),props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <BusAndRoutingMatrixBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  emptyAction={props.emptyAction?{...props.emptyAction,onPress:()=>{guard.current()?.emptyAction?.onPress();}}:undefined}
  onInputCommit={props.onInputCommit?(...args)=>guard.run('input',h=>{const b=h.ioBindings?.find(b=>b.sourceId===args[0]);return b&&(args[1]===null||b.inputs.some(v=>v.id===args[1]))?h.onInputCommit?.(...args):undefined;}):undefined}
  onSidechainCommit={props.onSidechainCommit?(...args)=>guard.run('sidechain',h=>{const b=h.ioBindings?.find(b=>b.sourceId===args[0]);return b&&(args[1]===null||b.sidechains.some(v=>v.id===args[1]))?h.onSidechainCommit?.(...args):undefined;}):undefined}
  onOutputCommit={(...args:Parameters<BusAndRoutingMatrixProps['onOutputCommit']>)=>guard.run('onOutputCommit',h=>h.onOutputCommit(...args))}
  onSendCommit={(...args:Parameters<BusAndRoutingMatrixProps['onSendCommit']>)=>guard.run('onSendCommit',h=>h.onSendCommit(...args))}
  onSendRemove={(...args:Parameters<BusAndRoutingMatrixProps['onSendRemove']>)=>guard.run('onSendRemove',h=>h.onSendRemove(...args))}
  onSendChange={props.onSendChange?(...args:Parameters<NonNullable<BusAndRoutingMatrixProps['onSendChange']>>)=>{guard.current()?.onSendChange?.(...args);}:undefined}
 />;
}
function BusAndRoutingMatrixBody({actionError,disabledReason,
  sources, buses,ioBindings=[],onInputCommit,onSidechainCommit, onOutputCommit, onSendCommit, onSendRemove, onSendChange, emptyAction,
  disabled = false, label = "Routing", className, unstyled = false, onLayout, ...rest
}: BusAndRoutingMatrixProps&{actionError?:string|null}) {
  if(sources.length>256||buses.length>64||new Set(sources.map(s=>String(s.id))).size!==sources.length||new Set(buses.map(b=>String(b.id))).size!==buses.length||sources.some(s=>s.sends.length>64||s.sends.some(v=>!Number.isFinite(v.level)||v.level<0||v.level>1))||ioBindings.length>256||ioBindings.some(b=>!sources.some(s=>s.id===b.sourceId)||b.inputs.length>256||b.sidechains.length>256||new Set(b.inputs.map(v=>v.id)).size!==b.inputs.length||new Set(b.sidechains.map(v=>v.id)).size!==b.sidechains.length||[...b.inputs,...b.sidechains].some(v=>!v.id.trim()||v.id.length>512||!v.label.trim()||v.label.length>1024)))throw new RangeError('Invalid routing matrix');
  const styled = !unstyled;
  const local = useRef<StoreApi<{ width: number }> | null>(null);
  if (!local.current) local.current = createStore(() => ({ width: 0 }));
  const store = local.current;
  const width = useStore(store, s => s.width);
  const measure = (e: LayoutChangeEvent) => {
    store.setState({ width: e.nativeEvent.layout.width });
    onLayout?.(e);
  };
  const frame = joinClasses(styled && "rounded-card border border-border bg-surface-raised", className);

  if (sources.length === 0) {
    return <EmptyState {...rest} onLayout={onLayout} title="No tracks to route"
      description="Add a track to the project and its output and sends appear here."
      {...{ className: frame }} />;
  }


  const layout = routingLayout(width, buses.length);
  const muted = joinClasses(styled && "text-text-muted text-sm");
  const rowProps = (source: RoutingSource) => ({
    source, buses, disabled, styled, onOutputCommit, onSendCommit, onSendRemove, onSendChange,
  });
  return <View {...rest} onLayout={measure} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: frame }} style={[{ opacity: width === 0 ? 0 : 1 }, rest.style]}>
    {buses.length===0?<EmptyState title="No buses yet" description="Add a bus to send tracks to a shared output or effect." {...exact({exitAction:disabled?undefined:emptyAction})} unstyled={unstyled}/>:null}
    {ioBindings.map(binding=><View key={String(binding.sourceId)} style={{gap:tokens.spacing.fixedElement,padding:tokens.spacing.fixedElement}}>
     <Text {...{className:muted}}>{sources.find(s=>s.id===binding.sourceId)?.name} input and sidechain</Text>
     {onInputCommit?<Select label="Track input" value={binding.inputId===null?'none':'source:'+binding.inputId} options={[{value:'none',label:'No input'},...binding.inputs.map(v=>({value:'source:'+v.id,label:v.label}))]} disabled={disabled} unstyled={unstyled} onValueChange={id=>onInputCommit(binding.sourceId,id==='none'?null:id.slice(7))}/>:null}
     {onSidechainCommit?<Select label="Sidechain source" value={binding.sidechainId===null?'none':'source:'+binding.sidechainId} options={[{value:'none',label:'No sidechain'},...binding.sidechains.map(v=>({value:'source:'+v.id,label:v.label}))]} disabled={disabled} unstyled={unstyled} onValueChange={id=>onSidechainCommit(binding.sourceId,id==='none'?null:id.slice(7))}/>:null}
    </View>)}
    {layout === "grid" ? <View>
      <View style={{ flexDirection: "row", paddingHorizontal: tokens.spacing.fixedInset, paddingVertical: tokens.spacing.off10 }}
        {...{ className: joinClasses(styled && "border-b border-border") }}>
        <Text {...{ className: muted }} style={{ width: ROUTING_COLUMNS.name }}>Track</Text>
        <Text {...{ className: muted }} style={{ width: ROUTING_COLUMNS.output }}>Output</Text>
        {buses.map(bus => <Text key={bus.id} numberOfLines={1} {...{ className: muted }}
          style={{ flex: 1, minWidth: ROUTING_COLUMNS.send }}>{"Send to " + bus.name}</Text>)}
      </View>
      {sources.map((source, i) => <GridRow key={source.id} {...rowProps(source)} last={i === sources.length - 1} />)}
    </View> : <View style={{ padding: tokens.spacing.fixedInset, gap: tokens.spacing.fixedInset }}>
      {sources.map(source => <SourceCard key={source.id} {...rowProps(source)} />)}
    </View>}
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}

type RowProps = {
  source: RoutingSource;
  buses: readonly RoutingBus[];
  disabled: boolean;
  styled: boolean;
  onOutputCommit: BusAndRoutingMatrixProps["onOutputCommit"];
  onSendCommit: BusAndRoutingMatrixProps["onSendCommit"];
  onSendRemove: BusAndRoutingMatrixProps["onSendRemove"];
  onSendChange: BusAndRoutingMatrixProps["onSendChange"];
};

function GridRow({ last, ...p }: RowProps & { last: boolean }) {
  const { source, buses, styled } = p;
  return <View accessibilityLabel={source.name} {...{ role: "group" }}
    style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.spacing.fixedInset, paddingVertical: tokens.spacing.off10 }}
    {...{ className: joinClasses(styled && !last && "border-b border-border") }}>
    <Text numberOfLines={2} {...{ className: joinClasses(styled && "text-text font-semibold") }}
      style={{ width: ROUTING_COLUMNS.name, paddingEnd: tokens.spacing.fixedElement }}>{source.name}</Text>
    <View style={{ width: ROUTING_COLUMNS.output, paddingEnd: tokens.spacing.fixedInset }}><OutputGroup {...p} /></View>
    {buses.map(bus => <View key={bus.id} style={{ flex: 1, minWidth: ROUTING_COLUMNS.send, paddingEnd: tokens.spacing.fixedElement }}>
      <SendControl {...p} bus={bus} />
    </View>)}
  </View>;
}

function SourceCard(p: RowProps) {
  const { source, buses, styled } = p;
  const caption = joinClasses(styled && "text-text-muted text-sm");
  return <View accessibilityLabel={source.name} {...{ role: "group" }} style={{ padding: tokens.spacing.fixedInset, gap: tokens.spacing.fixedInset }}
    {...{ className: joinClasses(styled && "rounded-control border border-border bg-surface-sunken") }}>
    <Text role="heading" {...{ "aria-level": 3 }}
      {...{ className: joinClasses(styled && "text-text font-semibold text-base") }}>{source.name}</Text>
    <View style={{ gap: tokens.spacing.off6 }}>
      <Text {...{ className: caption }}>Output</Text>
      <OutputGroup {...p} />
    </View>
    <View style={{ gap: tokens.spacing.off6 }}>
      <Text {...{ className: caption }}>Sends</Text>
      {buses.map(bus => <View key={bus.id} style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.fixedElement }}>
        <Text numberOfLines={1} {...{ className: joinClasses(styled && "text-text") }}
          style={{ width: controlTokens.extent.field }}>{bus.name}</Text>
        <View style={{ flex: 1 }}><SendControl {...p} bus={bus} /></View>
      </View>)}
    </View>
  </View>;
}

/** Radio group: Master plus one option per bus. Arrows move and commit, wrapping. */
function OutputGroup({ source, buses, disabled, styled, onOutputCommit }: RowProps) {
  const refs = useRef(new Map<RouteId | "master", { focus?: () => void } | null>());
  const resolved = resolveOutput(source.output, buses);
  const options: { id: RouteId | null; name: string }[] = [{ id: null, name: "Master" }, ...buses.map(b => ({ id: b.id, name: b.name }))];
  const choose = (id: RouteId | null) => {
    if (disabled) return;
    if (id !== source.output) void onOutputCommit(source.id, id);
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    const rtl = isRTL();
    const next = key === "ArrowDown" || key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1
      : key === "ArrowUp" || key === (rtl ? "ArrowRight" : "ArrowLeft") ? -1 : 0;
    if (next === 0 || disabled) return;
    e.preventDefault();
    const target = cycleOutput(source.output, buses, next);
    choose(target);
    refs.current.get(target ?? "master")?.focus?.();
  };
  return <View style={{ gap: tokens.spacing.off6 }}>
    <View accessibilityLabel={source.name + " output"} {...{ role: "radiogroup" }}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.off6 }}>
      {options.map(option => {
        const checked = option.id === source.output;
        // Roving focus: only the checked option (or Master when the output is missing) is in the tab order.
        const tabStop = checked || (resolved.kind === "missing" && option.id === null);
        return <Pressable key={option.id ?? "master"} ref={r => { refs.current.set(option.id ?? "master", r); }}
          role="radio" aria-checked={checked} accessibilityState={{ checked, disabled }}
          accessibilityLabel={option.name} disabled={disabled} focusable={tabStop && !disabled}
          {...(Platform.OS === "web" ? { tabIndex: tabStop && !disabled ? 0 : -1 } : {})}
          onPress={() => choose(option.id)} onKeyDown={onKeyDown}
          {...{ className: joinClasses(styled && "rounded-control border focus-visible:ring-2 focus-visible:ring-focus active:opacity-80",
            styled && (checked ? "bg-primary border-primary" : "bg-surface-raised border-border")) }}
          style={{ minHeight: HIT, minWidth: HIT, paddingHorizontal: tokens.spacing.fixedInset, justifyContent: "center", alignItems: "center", opacity: disabled ? tokens.opacity.disabled : 1 }}>
          <Text numberOfLines={1} {...{ className: joinClasses(styled && (checked ? "text-on-primary font-semibold" : "text-text")) }}>{option.name}</Text>
        </Pressable>;
      })}
    </View>
    {resolved.kind === "missing"
      ? <Text {...{ className: joinClasses(styled && "text-danger text-sm") }}>Output bus no longer exists. Choose another output.</Text>
      : null}
  </View>;
}

type SendLocal = { active: boolean; preview: number };

/** "Add send" button, or a slider plus remove button once the send exists. */
function SendControl({ source, bus, disabled, styled, onSendCommit, onSendRemove, onSendChange }: RowProps & { bus: RoutingBus }) {
  const level = sendLevel(source, bus.id);
  const name = sendLabel(source.name, bus.name);
  const latest = useRef({ level, disabled, onSendCommit, onSendChange, sourceId: source.id, busId: bus.id });
  latest.current = { level, disabled, onSendCommit, onSendChange, sourceId: source.id, busId: bus.id };
  const local = useRef<StoreApi<SendLocal> | null>(null);
  if (!local.current) local.current = createStore<SendLocal>(() => ({ active: false, preview: level ?? 0 }));
  const store = local.current;
  const active = useStore(store, s => s.active);
  const preview = useStore(store, s => s.preview);
  const trackWidth = useRef(1);
  const start = useRef(0);

  const commit = (next: number) => {
    const p = latest.current;
    store.setState({ active: false, preview: next });
    if (p.level === undefined || next === p.level) return;
    void p.onSendCommit(p.sourceId, p.busId, next);
  };
  const cancel = () => {
    const p = latest.current;
    if (!store.getState().active) return;
    store.setState({ active: false, preview: p.level ?? 0 });
    if (p.level !== undefined) p.onSendChange?.(p.sourceId, p.busId, p.level);
  };
  const claims = (_e: GestureResponderEvent, g: PanResponderGestureState) =>
    !latest.current.disabled && Math.abs(g.dx) >= SLOP && Math.abs(g.dx) > Math.abs(g.dy);
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: claims,
    onMoveShouldSetPanResponderCapture: claims,
    onPanResponderGrant: () => {
      start.current = latest.current.level ?? 0;
      store.setState({ active: true, preview: start.current });
    },
    onPanResponderMove: (_e, g) => {
      const p = latest.current;
      // Escape cancelled this drag; ignore the rest of it.
      if (!store.getState().active || p.disabled) return;
      const next = dragToSendLevel(start.current, isRTL() ? -g.dx : g.dx, trackWidth.current);
      if (next !== store.getState().preview) {
        store.setState({ preview: next });
        p.onSendChange?.(p.sourceId, p.busId, next);
      }
    },
    onPanResponderRelease: () => {
      if (!store.getState().active) return;
      if (latest.current.disabled) { cancel(); return; }
      commit(store.getState().preview);
    },
    onPanResponderTerminate: cancel,
    onPanResponderTerminationRequest: () => !store.getState().active,
    onShouldBlockNativeResponder: () => true,
  });

  const box = { minHeight: HIT, opacity: disabled ? tokens.opacity.disabled : 1 };
  if (level === undefined) {
    return <Pressable role="button" accessibilityLabel={"Add " + name} disabled={disabled}
      onPress={() => { void onSendCommit(source.id, bus.id, DEFAULT_SEND_LEVEL); }}
      {...{ className: joinClasses(styled && "rounded-control border border-dashed border-border bg-surface-raised items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80") }}
      style={[box, { paddingHorizontal: tokens.spacing.fixedInset }]}>
      <Text {...{ className: joinClasses(styled && "text-text-muted") }}>Add send</Text>
    </Pressable>;
  }

  const shown = active ? preview : level;
  const step = (delta: number) => {
    const p = latest.current;
    if (p.disabled || store.getState().active || p.level === undefined) return;
    commit(stepSendLevel(p.level, delta, 1));
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    if (key === "Escape") { if (store.getState().active) { e.preventDefault(); cancel(); } return; }
    if (disabled) return;
    const rtl = isRTL();
    const raise = key === "ArrowUp" || key === (rtl ? "ArrowLeft" : "ArrowRight");
    const lower = key === "ArrowDown" || key === (rtl ? "ArrowRight" : "ArrowLeft");
    let delta: number | undefined;
    if (raise) delta = SEND_STEP;
    else if (lower) delta = -SEND_STEP;
    else if (key === "PageUp") delta = SEND_PAGE_STEP;
    else if (key === "PageDown") delta = -SEND_PAGE_STEP;
    else if (key === "Home") delta = -1;
    else if (key === "End") delta = 1;
    else if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      if (!store.getState().active) void onSendRemove(source.id, bus.id);
      return;
    }
    if (delta === undefined) return;
    e.preventDefault();
    step(delta);
  };
  const webTrack = Platform.OS === "web" ? { touchAction: "pan-y" } as unknown as ViewStyle : undefined;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.off6 }}>
    <View {...responder.current.panHandlers}
      onLayout={e => { trackWidth.current = Math.max(1, e.nativeEvent.layout.width); }}
      accessible focusable={!disabled} accessibilityRole="adjustable" accessibilityLabel={name}
      {...valueAccessibility({ min: 0, max: 100, now: Math.round(shown * 100), text: formatSendLevel(shown) })}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={e => {
        if (e.nativeEvent.actionName === "increment") step(SEND_STEP);
        if (e.nativeEvent.actionName === "decrement") step(-SEND_STEP);
      }}
      onKeyDown={onKeyDown}
      {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus") }}
      style={{ flex: 1, height: HIT, justifyContent: "center", opacity: disabled ? tokens.opacity.disabled : 1, ...webTrack }}>
      <View pointerEvents="none" style={{ height: tokens.spacing.fixedElement, borderRadius: forgeHairlineRadius.tick, overflow: "hidden" }}
        {...{ className: joinClasses(styled && "bg-surface-sunken border border-border") }}>
        <View style={{ position: "absolute", top: 0, bottom: 0, start: 0, width: `${shown * 100}%` }}
          {...{ className: joinClasses(styled && "bg-accent") }} />
      </View>
    </View>
    <Text {...{ className: joinClasses(styled && "text-text text-sm") }}
      style={{ width: tokens.spacing.off40, textAlign: "right", fontVariant: ["tabular-nums"] }}>{formatSendLevel(shown)}</Text>
    <Pressable role="button" accessibilityLabel={"Remove " + name} disabled={disabled}
      onPress={() => { void onSendRemove(source.id, bus.id); }}
      {...{ className: joinClasses(styled && "rounded-control items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80") }}
      style={[box, { width: HIT }]}>
      <CloseGlyph styled={styled} />
    </Pressable>
  </View>;
}

/** Remove mark drawn with two rotated bars; the app has no icon dependency here. */
function CloseGlyph({ styled }: { styled: boolean }) {
  const bar = { position: "absolute" as const, width: tokens.spacing.off14, height: tokens.spacing.off2, borderRadius: forgeHairlineRadius.tick };
  const cls = { className: joinClasses(styled && "bg-text-muted") };
  return <View pointerEvents="none" style={{ width: tokens.spacing.off14, height: tokens.spacing.off14, alignItems: "center", justifyContent: "center" }}>
    <View {...cls} style={[bar, { transform: [{ rotate: "45deg" }] }]} />
    <View {...cls} style={[bar, { transform: [{ rotate: "-45deg" }] }]} />
  </View>;
}
