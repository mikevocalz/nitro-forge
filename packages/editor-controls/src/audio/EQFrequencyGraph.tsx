import {forgeRadius} from "../radius.ts";
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {createAudioPreviewOwner,commitAudioPreview,audioResponderCurrent} from './audio-preview-owner.ts';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {valueAccessibility} from "../value-a11y.ts";
/*
 * Structural references (Mobbin, iOS, structure only):
 * - Waymo, Audio settings: labelled bass/treble rows with the value printed
 *   beside the label, plus a 2D puck over a plotted field.
 * - [untitled] (Mobbin listing), Varispeed adjust: a parameter row per
 *   control with the live value at the trailing edge.
 * - Riveo, audio volume/ramp rows: label column, tick track, value column.
 * - Discord, voice settings: grouped audio controls under section headings.
 * Mobbin returned no parametric EQ graph; the plot layout (log frequency
 * axis, dB gridlines, numbered band handles, a readout row under the plot)
 * follows the common desktop EQ arrangement, drawn here from scratch.
 */
import { useMemo, useRef, useLayoutEffect } from "react";
import {
  PanResponder, Platform, Pressable, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type LayoutChangeEvent, type PanResponderGestureState,
  type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { webToggleProps } from "@nyc-tron/ui/components/forms/toggle-a11y";
import {
  EQ_DEFAULT_RANGE_DB, bandTypeName, describeBand, dragBand, eqFrequencyGridlines, eqGainGridlines,
  eqHandlePosition, eqResponseSegments, formatFreq, formatGain, formatQ, isPassBand, stepBand,
  type EqBand, type EqBandEdit, type EqPlot, type EqResponsePoint,
} from "./eq-graph.ts";
import {exact} from '../exact-optional.ts';

/** Minimum hit size (iOS 44pt / Android 48dp floor). */
const HIT = 44;
const DOT = 24;
/** Movement, in points, before a handle drag starts. */
const SLOP = 3;
const AXIS = 18;

/** Props for {@linkcode EQFrequencyGraph}. */
export interface EQFrequencyGraphProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Committed bands from the engine, at most 8, in band order. */
  readonly bands: readonly EqBand[];
  /**
   * The engine's combined magnitude response (`eqResponse`), log-spaced
   * 20 Hz..20 kHz. Drawn as given. Pass a new array whenever the engine
   * recomputes it: the graph dims the curve from the start of a drag until a
   * different array arrives. Empty draws the grid and handles with a
   * "Response unavailable" note.
   */
  readonly response: readonly EqResponsePoint[];
  /**
   * Once per finished handle drag or key press, with the band's new
   * frequency and gain. Not called when nothing changed. Q is edited through the separate onQCommit capability. A rejected promise keeps the committed band on screen.
   */
  readonly onBandCommit: (index: number, edit: EqBandEdit) => void | Promise<unknown>;
  /** Live values while a handle is dragged, and the committed values again on cancel. Never persisted. */
  readonly onBandChange?: ((index: number, edit: EqBandEdit) => void) | undefined;
  /** The band shown in the readout row and drawn as selected. */
  readonly selectedIndex?: number;
  /** A handle was pressed, focused or dragged, or a band chip was chosen. */
  readonly onSelect?: ((index: number) => void) | undefined;
  /** The readout's on/off toggle. Without it the toggle is hidden. */
  readonly onQCommit?:((index:number,q:number)=>void|Promise<unknown>)|undefined;
  readonly onEnabledCommit?: ((index: number, enabled: boolean) => void | Promise<unknown>) | undefined;
  /** Half the visible dB span. @default 18 */
  readonly range?: number;
  /** Plot height, points. @default 200 */
  readonly height?: number;
  /** @default false */
  readonly disabled?: boolean;
  /** Name of the EQ, e.g. `"Vocal EQ"`; also the group's accessible name. */
  readonly label: string;
  className?: string;
  unstyled?: boolean;
}

type Drag = { index: number; edit: EqBandEdit };
type Local = { width: number; drag?: Drag | undefined; staleFor?: readonly EqResponsePoint[] | undefined };

/**
 * Controlled parametric EQ graph. Draws the engine's response curve over a
 * log-frequency, dB grid with one numbered handle per band. Drag a handle to
 * move frequency and gain together, or focus it and use Left/Right (one
 * twelfth of an octave), Up/Down (0.5 dB), PageUp/PageDown (3 dB), Home
 * (0 dB); hold Shift for finer steps. Escape cancels a drag. One
 * `onBandCommit` per gesture or key press.
 *
 * The graph does no filter math. While a handle moves, only the handle
 * follows the pointer; the curve dims until the engine sends a new
 * `response`. Frequency runs left to right in every locale. Band type is shown read-only; Q has an optional admitted editor; adding, removing and retyping bands belong to the
 * insert's band list.
 */
export function EQFrequencyGraph({scope='EQFrequencyGraph',revision=0,...props}:EQFrequencyGraphProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.label,props.disabled,props.disabledReason,props.height,props.range,props.bands]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 const previews=useRef<ReturnType<typeof createAudioPreviewOwner<{index:number;edit:EqBandEdit}>>|null>(null);previews.current??=createAudioPreviewOwner();
 useLayoutEffect(()=>()=>previews.current!.clear(owner),[owner]);
 return <EQFrequencyGraphBody scope={scope} revision={revision} gestureBoundary={owner} onPreviewCancel={()=>previews.current!.clear(owner)} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onBandCommit={(...args:Parameters<EQFrequencyGraphProps['onBandCommit']>)=>commitAudioPreview(previews.current!,owner,track=>guard.run('onBandCommit',h=>track(()=>h.onBandCommit(...args))))}
  onQCommit={props.onQCommit?(index,q)=>guard.run('q',h=>h.onQCommit?.(index,q)):undefined}
  onEnabledCommit={props.onEnabledCommit?(...args:Parameters<NonNullable<EQFrequencyGraphProps['onEnabledCommit']>>)=>guard.run('onEnabledCommit',h=>h.onEnabledCommit?.(...args)):undefined}
  onBandChange={props.onBandChange?(...args:Parameters<NonNullable<EQFrequencyGraphProps['onBandChange']>>)=>{const host=guard.current(),band=host?.bands[args[0]];if(host?.onBandChange&&band){const notify=host.onBandChange;previews.current!.publish(owner,v=>notify(v.index,v.edit),{index:args[0],edit:{freqHz:band.freqHz,gainDb:band.gainDb}},{index:args[0],edit:args[1]},notify);}}:undefined}
  onSelect={props.onSelect?(...args:Parameters<NonNullable<EQFrequencyGraphProps['onSelect']>>)=>{guard.current()?.onSelect?.(...args);}:undefined}
 />;
}
function EQFrequencyGraphBody({scope='EQFrequencyGraph',revision=0,gestureBoundary,onPreviewCancel,actionError,disabledReason,
  bands, response, onBandCommit, onBandChange, selectedIndex, onSelect, onEnabledCommit,onQCommit,
  range = EQ_DEFAULT_RANGE_DB, height = 200, disabled = false, label, className, unstyled = false, style, ...rest
}: EQFrequencyGraphProps&{gestureBoundary:string;onPreviewCancel:()=>void;actionError?:string|null}) {
  if(bands.length>8||bands.some(b=>!['peak','low_shelf','high_shelf','low_pass','high_pass'].includes(b.type)||![b.freqHz,b.gainDb,b.q].every(Number.isFinite)||b.freqHz<20||b.freqHz>20000||Math.abs(b.gainDb)>24||b.q<.1||b.q>18)||response.length>16384||response.some(p=>!Number.isFinite(p.hz)||p.hz<=0||!Number.isFinite(p.db)))throw new RangeError('Invalid EQ data');
  if (!Number.isFinite(height) || height < HIT * 2) throw new RangeError(`EQ plot height must be at least ${HIT * 2}`);
  if (!Number.isFinite(range) || range <= 0) throw new RangeError("EQ range must be positive");
  const local = useRef<StoreApi<Local> | null>(null);
  if (!local.current) local.current = createStore<Local>(() => ({ width: 0 }));
  const store = local.current;
  const width = useStore(store, s => s.width);
  const drag = useStore(store, s => s.drag);
  const staleFor = useStore(store, s => s.staleFor);
  const latest = useRef({ bands, response, onBandCommit, onBandChange, onSelect, disabled });
  latest.current = { bands, response, onBandCommit, onBandChange, onSelect, disabled };

  const boundary=JSON.stringify([gestureBoundary,width,height,range,disabled,bands]);
  const qScope=useEditorBoundary([scope,revision,selectedIndex,selectedIndex===undefined?undefined:bands[selectedIndex]?.type]);
  const committed=useRef(boundary);
  useLayoutEffect(()=>{committed.current=boundary;store.setState({drag:undefined,staleFor:undefined});onPreviewCancel();return()=>{onPreviewCancel();};},[boundary,store]);
  const plot: EqPlot | undefined = width > 0 ? { width, height, rangeDb: range } : undefined;
  const segments = useMemo(() => (plot ? eqResponseSegments(response, plot) : []), [response, width, height, range]);
  const freqLines = useMemo(() => (plot ? eqFrequencyGridlines(width) : []), [width]);
  const gainLines = useMemo(() => eqGainGridlines(height, range), [height, range]);

  const commit = (index: number, edit: EqBandEdit) => {
    if(committed.current!==boundary)return;
    const p = latest.current;
    const band = p.bands[index];
    store.setState({ drag: undefined });
    if (!band || p.disabled || (edit.freqHz === band.freqHz && edit.gainDb === band.gainDb)) {
      store.setState({ staleFor: undefined });
      return;
    }
    store.setState({ staleFor: p.response });
    const result = p.onBandCommit(index, edit);
    // A rejected commit leaves the old band and curve current again.
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).then(applied => {
        if(applied===false&&committed.current===boundary&&store.getState().staleFor===p.response)store.setState({staleFor:undefined});
      }, () => {
        if (committed.current===boundary&&store.getState().staleFor === p.response) store.setState({ staleFor: undefined });
      });
    }
  };
  const cancel = () => {
    store.setState({ drag: undefined, staleFor: undefined });
    onPreviewCancel();
  };
  const ctx = { store, latest, commit, cancel, boundary };

  const styled = !unstyled;
  const dimmed = staleFor !== undefined && staleFor === response;
  const selected = selectedIndex !== undefined ? bands[selectedIndex] : undefined;
  const shown: EqBand | undefined = selected && drag && drag.index === selectedIndex ? { ...selected, ...drag.edit } : selected;
  const muted = joinClasses(styled && "text-text-muted");
  const tabular = { fontVariant: ["tabular-nums"] } as const;
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== store.getState().width) store.setState({ width: w });
  };
  const order = bands.map((_, i) => i).sort((a, b) => (a === selectedIndex ? 1 : 0) - (b === selectedIndex ? 1 : 0));

  return <View {...rest} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised", className) }}
    style={[{ padding: 16, gap: 10, opacity: disabled ? 0.55 : 1 }, style]}>
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>{label}</Text>
      {response.length === 0
        ? <Text {...{ className: muted }} accessibilityLiveRegion="polite">Response unavailable</Text>
        : null}
    </View>
    {/* Frequency is physical: the plot never mirrors in right-to-left layouts. */}
    <View style={{ direction: "ltr" }}>
      <View onLayout={onLayout} accessibilityElementsHidden={false}
        {...{ className: joinClasses(styled && "rounded-control bg-surface-sunken border border-border") }}
        style={{ height, position: "relative" }}>
        {plot ? <>
          {freqLines.map(g => <View key={"f" + g.at} pointerEvents="none" aria-hidden
            {...{ className: joinClasses(styled && "bg-border") }}
            style={{ position: "absolute", top: 0, bottom: 0, left: g.at, width: 1, opacity: g.major ? 1 : 0.45 }} />)}
          {gainLines.map(g => <View key={"g" + g.at} pointerEvents="none" aria-hidden
            {...{ className: joinClasses(styled && (g.major ? "bg-text-muted" : "bg-border")) }}
            style={{ position: "absolute", left: 0, right: 0, top: g.at, height: 1, opacity: g.major ? 0.6 : 1 }} />)}
          {gainLines.map(g => <Text key={"gl" + g.at} pointerEvents="none" aria-hidden
            {...{ className: muted }}
            style={{ position: "absolute", left: 4, top: g.at - 15, fontSize: 11, lineHeight: 14, ...tabular }}>{g.label}</Text>)}
          <View pointerEvents="none" aria-hidden style={{ position: "absolute", inset: 0, opacity: dimmed ? 0.3 : 1 }}>
            {segments.map((s, i) => <View key={i} {...{ className: joinClasses(styled && "bg-primary") }}
              style={{ position: "absolute", left: s.centerX - s.length / 2 - 0.5, top: s.centerY - 1,
                width: s.length + 1, height: 2, transform: [{ rotate: `${s.angleDeg}deg` }] }} />)}
          </View>
          {order.map(i => <BandHandle key={i} index={i} band={bands[i]!} plot={plot}
            preview={drag?.index === i ? drag.edit : undefined} selected={i === selectedIndex}
            disabled={disabled} styled={styled} ctx={ctx} />)}
        </> : null}
      </View>
      <View aria-hidden style={{ height: AXIS, position: "relative" }}>
        {freqLines.filter(g => g.major).map(g => <Text key={g.label} {...{ className: muted }}
          style={{ position: "absolute", left: g.at - 20, width: 40, top: 2, textAlign: "center", fontSize: 11, lineHeight: 14 }}>{g.label}</Text>)}
      </View>
    </View>
    {bands.length === 0
      ? <Text {...{ className: muted }}>No bands on this EQ. Add one from the insert's band list.</Text>
      : <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 8 }}>
        {onSelect
          ? <View accessibilityRole="radiogroup" accessibilityLabel={label + " bands"} style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {bands.map((b, i) => {
              const on = i === selectedIndex;
              return <Pressable key={i} accessibilityRole="radio" accessibilityLabel={"Band " + (i + 1)}
                accessibilityHint={describeBand(b)} accessibilityState={{ checked: on, disabled }} disabled={disabled}
                onPress={() => onSelect(i)}
                {...{ className: joinClasses(styled && "rounded-control items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80",
                  styled && (on ? "bg-primary" : b.enabled ? "bg-surface-sunken border border-border" : "border border-dashed border-border")) }}
                style={{ minWidth: HIT, minHeight: HIT }}>
                <Text {...{ className: joinClasses(styled && "font-semibold", styled && (on ? "text-on-primary" : b.enabled ? "text-text" : "text-text-muted")) }}
                  style={tabular}>{i + 1}</Text>
              </Pressable>;
            })}
          </View>
          : null}
        {shown && selectedIndex !== undefined
          ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 6, flexGrow: 1 }}>
            <Readout label="Type" value={bandTypeName(shown.type)} styled={styled} />
            <Readout label="Freq" value={formatFreq(shown.freqHz)} styled={styled} />
            <Readout label="Gain" value={isPassBand(shown.type) ? "Not used" : formatGain(shown.gainDb)} styled={styled} />
            {onQCommit?<PrecisionScrubber scope={qScope} label={`Band ${selectedIndex+1} Q`} value={shown.q} min={.1} max={18} step={.01} disabled={disabled} unstyled={unstyled} onCommit={q=>onQCommit(selectedIndex,q)}/>:<Readout label="Q" value={formatQ(shown.q)} styled={styled} />}
            {onEnabledCommit
              ? <Pressable accessibilityRole="togglebutton" accessibilityLabel={"Band " + (selectedIndex + 1) + " on"}
                accessibilityState={{ checked: shown.enabled, disabled }} {...webToggleProps(shown.enabled)}
                disabled={disabled} onPress={() => { void onEnabledCommit(selectedIndex, !shown.enabled); }}
                {...{ className: joinClasses(styled && "rounded-control items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80",
                  styled && (shown.enabled ? "bg-accent" : "bg-surface-sunken border border-border")) }}
                style={{ minWidth: HIT + 20, minHeight: HIT, paddingHorizontal: 12, marginStart: "auto" }}>
                <Text {...{ className: joinClasses(styled && "font-semibold", styled && (shown.enabled ? "text-on-primary" : "text-text-muted")) }}>
                  {shown.enabled ? "On" : "Bypassed"}</Text>
              </Pressable>
              : null}
          </View>
          : <Text {...{ className: muted }}>Select a band to see its settings.</Text>}
      </View>}
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}

function Readout({ label, value, styled }: { label: string; value: string; styled: boolean }) {
  return <View accessible accessibilityLabel={label + " " + value} style={{ minWidth: 56 }}>
    <Text {...{ className: joinClasses(styled && "text-text-muted") }} style={{ fontSize: 12, lineHeight: 16 }}>{label}</Text>
    <Text {...{ className: joinClasses(styled && "text-text") }} style={{ fontVariant: ["tabular-nums"] }}>{value}</Text>
  </View>;
}

interface HandleCtx {
  readonly boundary:string;
  readonly store: StoreApi<Local>;
  readonly latest: { current: { bands: readonly EqBand[]; response: readonly EqResponsePoint[]; onBandChange?: ((index: number, edit: EqBandEdit) => void) | undefined;
    onSelect?: ((index: number) => void) | undefined; disabled: boolean } };
  readonly commit: (index: number, edit: EqBandEdit) => void;
  readonly cancel: () => void;
}

interface BandHandleProps {
  readonly index: number;
  readonly band: EqBand;
  readonly plot: EqPlot;
  readonly preview?: EqBandEdit | undefined;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly styled: boolean;
  readonly ctx: HandleCtx;
}

function BandHandle({ index, band, plot, preview, selected, disabled, styled, ctx }: BandHandleProps) {
  const mine = useRef({ index, band, plot, ctx });
  mine.current = { index, band, plot, ctx };
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const moved = useRef(false);
  const admitted=useRef<string|null>(null),gestureId=useRef<number|null>(null);
  useLayoutEffect(()=>{admitted.current=null;gestureId.current=null;moved.current=false;},[ctx.boundary]);
  const claims = (_e: GestureResponderEvent, g: PanResponderGestureState) =>
    !mine.current.ctx.latest.current.disabled && Math.hypot(g.dx, g.dy) >= SLOP;
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => !mine.current.ctx.latest.current.disabled,
    onMoveShouldSetPanResponder: claims,
    onMoveShouldSetPanResponderCapture: claims,
    onPanResponderGrant: (_event,g) => {
      const m = mine.current;
      if(m.ctx.latest.current.disabled)return;admitted.current=m.ctx.boundary;gestureId.current=g.stateID;
      moved.current = false;
      m.ctx.latest.current.onSelect?.(m.index);
    },
    onPanResponderMove: (_e, g) => {
      const m = mine.current;
      if (!audioResponderCurrent(admitted.current,m.ctx.boundary,m.ctx.latest.current.disabled,gestureId.current,g.stateID)) return;
      if (!moved.current && Math.hypot(g.dx, g.dy) < SLOP) return;
      const start = { freqHz: m.band.freqHz, gainDb: m.band.gainDb };
      const edit = dragBand(start, m.band.type, g.dx, g.dy, m.plot);
      const prev = m.ctx.store.getState().drag;
      if (!moved.current) {
        moved.current = true;
        // The curve on screen no longer matches the handle until the engine answers.
        m.ctx.store.setState({ staleFor: m.ctx.latest.current.response });
      }
      if (prev && prev.edit.freqHz === edit.freqHz && prev.edit.gainDb === edit.gainDb) return;
      m.ctx.store.setState({ drag: { index: m.index, edit } });
      m.ctx.latest.current.onBandChange?.(m.index, edit);
    },
    onPanResponderRelease: (_event,g) => {
      const m = mine.current;
      if(!audioResponderCurrent(admitted.current,m.ctx.boundary,m.ctx.latest.current.disabled,gestureId.current,g.stateID))return;admitted.current=null;
      const d = m.ctx.store.getState().drag;
      if (!d || d.index !== m.index) return;
      m.ctx.commit(m.index, d.edit);
    },
    onPanResponderTerminate: (_event,g) => {
      if(!audioResponderCurrent(admitted.current,mine.current.ctx.boundary,false,gestureId.current,g.stateID))return;admitted.current=null;
      const d = mine.current.ctx.store.getState().drag;
      if (d && d.index === mine.current.index) mine.current.ctx.cancel();
    },
    onPanResponderTerminationRequest: () => mine.current.ctx.store.getState().drag === undefined,
    onShouldBlockNativeResponder: () => true,
  });
  const keyEdit = (key: string, fine: boolean): boolean => {
    if(mine.current.ctx.boundary!==ctx.boundary)return false;
    const m = mine.current;
    if (m.ctx.latest.current.disabled || m.ctx.store.getState().drag) return false;
    const next = stepBand(m.band, key, fine);
    if (!next) return false;
    m.ctx.latest.current.onBandChange?.(m.index, next);
    m.ctx.commit(m.index, next);
    return true;
  };
  const onKeyDown = (e: KeyDownEvent) => {
    if(mine.current.ctx.boundary!==ctx.boundary)return;
    const { key, shiftKey } = e.nativeEvent;
    if (key === "Escape") {
      const d = mine.current.ctx.store.getState().drag;
      if (d && d.index === index) { e.preventDefault(); admitted.current=null;gestureId.current=null;moved.current=false;mine.current.ctx.cancel(); }
      return;
    }
    if (keyEdit(key, shiftKey === true)) e.preventDefault();
    else if (/^(Arrow|Page|Home)/.test(key)) e.preventDefault();
  };

  const current: EqBand = preview ? { ...band, ...preview } : band;
  const { x, y } = eqHandlePosition(current, plot);
  const pass = isPassBand(band.type);
  const active = preview !== undefined;
  const webStyle = Platform.OS === "web"
    ? { touchAction: "none", cursor: disabled ? "default" : active ? "grabbing" : "grab" } as unknown as ViewStyle : undefined;
  const fill = selected || active ? "bg-primary border-primary"
    : band.enabled ? "bg-surface-raised border-primary" : "bg-surface-sunken border-text-muted";
  const ink = selected || active ? "text-on-primary" : band.enabled ? "text-text" : "text-text-muted";
  const tipAbove = y > 40;
  return <View {...responder.current.panHandlers}
    accessible focusable={!disabled} accessibilityRole="adjustable"
    accessibilityLabel={"Band " + (index + 1)}
    {...valueAccessibility({ text: describeBand(current) })}
    accessibilityState={{ selected, disabled }}
    accessibilityHint={pass ? "Adjusts frequency" : "Adjusts gain; use actions for frequency"}
    accessibilityActions={[{ name: "increment" }, { name: "decrement" },
      { name: "raiseFrequency", label: "Raise frequency" }, { name: "lowerFrequency", label: "Lower frequency" }]}
    onAccessibilityAction={e => {
      const a = e.nativeEvent.actionName;
      if (a === "raiseFrequency") keyEdit("ArrowRight", false);
      else if (a === "lowerFrequency") keyEdit("ArrowLeft", false);
      else if (a === "increment") keyEdit(pass ? "ArrowRight" : "ArrowUp", false);
      else if (a === "decrement") keyEdit(pass ? "ArrowLeft" : "ArrowDown", false);
    }}
    onKeyDown={onKeyDown}
    onFocus={() => {if(mine.current.ctx.boundary===ctx.boundary)ctx.latest.current.onSelect?.(index);}}
    {...{ className: joinClasses(styled && "rounded-sm focus-visible:ring-2 focus-visible:ring-focus") }}
    style={{ position: "absolute", left: x - HIT / 2, top: y - HIT / 2, width: HIT, height: HIT,
      alignItems: "center", justifyContent: "center", zIndex: selected || active ? 2 : 1, ...webStyle }}>
    <View pointerEvents="none" {...{ className: joinClasses(styled && fill) }}
      style={{ width: DOT, height: DOT, borderRadius: forgeRadius.sm, borderWidth: 2, alignItems: "center", justifyContent: "center",
        borderStyle: band.enabled ? "solid" : "dashed" }}>
      <Text {...{ className: joinClasses(styled && "font-semibold", styled && ink) }}
        style={{ fontSize: 12, lineHeight: 14, fontVariant: ["tabular-nums"] }}>{index + 1}</Text>
    </View>
    {active
      ? <View pointerEvents="none" aria-hidden
        {...{ className: joinClasses(styled && "rounded-control bg-surface-raised border border-border") }}
        style={{ position: "absolute", top: tipAbove ? -24 : HIT + 2, paddingHorizontal: 6, paddingVertical: 2, minWidth: 96, alignItems: "center" }}>
        <Text {...{ className: joinClasses(styled && "text-text") }} numberOfLines={1}
          style={{ fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] }}>
          {pass ? formatFreq(current.freqHz) : formatFreq(current.freqHz) + "  " + formatGain(current.gainDb)}</Text>
      </View>
      : null}
  </View>;
}
