import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {valueAccessibility} from "../value-a11y.ts";
/*
 * Structural references (Mobbin, iOS, structure only):
 * - Sonos, Audio Compression: compression as a short list of named settings
 *   under a plain heading and one sentence of explanation.
 * - [untitled] (Mobbin listing), Varispeed adjust: labelled parameter rows,
 *   value at the trailing edge, a centre tick on each track.
 * - Riveo, Volume / Ramp In / Ramp Out rows: icon-and-label column, tick
 *   track, numeric value column.
 * - Waymo, Audio settings: label with its current value inline above each
 *   slider.
 * Mobbin returned no compressor transfer graph; the square in/out plot with
 * a unity diagonal and threshold marker follows the common desktop
 * compressor layout, drawn here from scratch.
 */
import { useMemo, useRef } from "react";
import {
  PanResponder, Platform, Pressable, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type LayoutChangeEvent, type PanResponderGestureState,
  type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { cancelPreview } from "../cancel-preview.ts";
import {
  DYN_MAX_RATIO, DYN_MIN_RATIO, clampThreshold, curveOutputAt, describeDynamics, describeLevel, dragThreshold,
  dynamicsCurveSegments, dynamicsGridlines, dynamicsPoint, formatKnee, formatMakeup, formatRatio,
  formatThreshold, levelToOffset, stepRatio, unitySegment,
  type DynamicsCurvePoint, type DynamicsParams,
} from "./dynamics-graph.ts";
import {exact} from '../exact-optional.ts';

/** Minimum hit size (iOS 44pt / Android 48dp floor). */
const HIT = 44;
const SLOP = 4;
/** Width of the y-axis label column. */
const GUTTER = 30;
const THUMB = 14;
/** Container width at which the readouts move beside the plot. */
const SIDE_BY_SIDE = 520;

/** Props for {@linkcode DynamicsTransferGraph}. */
export interface DynamicsTransferGraphProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Committed compressor parameters from the engine. Attack and release are not drawn on a static curve. */
  readonly params: DynamicsParams;
  /**
   * The engine's static curve (`dynamicsCurve`), input -60..0 dB in 1 dB
   * steps. Drawn as given. Pass a new array whenever the engine recomputes
   * it: the graph dims the curve from the start of a threshold drag until a
   * different array arrives. Empty draws the grid with "Curve unavailable".
   */
  readonly curve: readonly DynamicsCurvePoint[];
  /** Once per finished threshold drag or key press, whole dB in -60..0. A rejected promise keeps the committed value. */
  readonly onThresholdCommit: (thresholdDb: number) => void | Promise<unknown>;
  /** Live threshold while dragging, and the committed value again on cancel. Never persisted. */
  readonly onThresholdChange?: ((thresholdDb: number) => void) | undefined;
  /** Once per stepper press, with the next ratio stop (1, 1.5, 2, 3, 4, 6, 8, 10, 20). */
  readonly onRatioCommit: (ratio: number) => void | Promise<unknown>;
  /** Current input level from a meter, dBFS. Drawn as a dot on the curve; display only. */
  readonly inputLevelDb?: number;
  readonly gainReductionDb?:number;
  readonly onKneeCommit?:((db:number)=>void|Promise<unknown>)|undefined;
  readonly onMakeupCommit?:((db:number)=>void|Promise<unknown>)|undefined;
  /** Largest plot side, points. The plot shrinks to fit narrower containers. @default 280 */
  readonly maxSize?: number;
  /** @default false */
  readonly disabled?: boolean;
  /** Name of the insert, e.g. `"Vocal compressor"`. @default "Compressor" */
  readonly label?: string;
  className?: string;
  unstyled?: boolean;
}

type Local = { width: number; active: boolean; preview: number; staleFor?: readonly DynamicsCurvePoint[] | undefined };

/**
 * Controlled compressor transfer graph: input level across, output level
 * up, both -60..0 dBFS, with the 1:1 diagonal for reference, the engine's
 * curve, a threshold marker and readouts. Drag the threshold track under the
 * plot sideways or focus it and use the arrow keys (1 dB, PageUp/PageDown
 * 6 dB); Escape cancels a drag. The ratio stepper walks
 * 1, 1.5, 2, 3, 4, 6, 8, 10 and 20 to 1. One commit per gesture or press.
 *
 * The graph does no compressor math. While the threshold moves, only the
 * marker follows; the curve dims until the engine sends a new `curve`.
 * Knee and makeup editors require the corresponding host callbacks. Levels run left to right in every
 * locale.
 */
export function DynamicsTransferGraph({scope='DynamicsTransferGraph',revision=0,...props}:DynamicsTransferGraphProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.label,props.disabled,props.disabledReason,props.maxSize]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <DynamicsTransferGraphBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onKneeCommit={props.onKneeCommit?db=>guard.run('knee',h=>h.onKneeCommit?.(db)):undefined}
  onMakeupCommit={props.onMakeupCommit?db=>guard.run('makeup',h=>h.onMakeupCommit?.(db)):undefined}
  onThresholdCommit={(...args:Parameters<DynamicsTransferGraphProps['onThresholdCommit']>)=>guard.run('onThresholdCommit',h=>h.onThresholdCommit(...args))}
  onRatioCommit={(...args:Parameters<DynamicsTransferGraphProps['onRatioCommit']>)=>guard.run('onRatioCommit',h=>h.onRatioCommit(...args))}
  onThresholdChange={props.onThresholdChange?(...args:Parameters<NonNullable<DynamicsTransferGraphProps['onThresholdChange']>>)=>{guard.current()?.onThresholdChange?.(...args);}:undefined}
 />;
}
function DynamicsTransferGraphBody({actionError,disabledReason,
  params, curve, onThresholdCommit, onThresholdChange, onRatioCommit, inputLevelDb,gainReductionDb,onKneeCommit,onMakeupCommit, maxSize = 280,
  disabled = false, label = "Compressor", className, unstyled = false, style, ...rest
}: DynamicsTransferGraphProps&{actionError?:string|null}) {
  if(![params.thresholdDb,params.ratio,params.kneeDb,params.makeupDb].every(Number.isFinite)||params.thresholdDb< -60||params.thresholdDb>0||params.ratio<1||params.ratio>20||params.kneeDb<0||params.kneeDb>24||params.makeupDb<0||params.makeupDb>24||curve.length>16384||curve.some(p=>!Number.isFinite(p.inDb)||!Number.isFinite(p.outDb))||gainReductionDb!==undefined&&(!Number.isFinite(gainReductionDb)||gainReductionDb<0))throw new RangeError('Invalid dynamics data');
  if (!Number.isFinite(maxSize) || maxSize < HIT * 2) throw new RangeError(`maxSize must be at least ${HIT * 2}`);
  const committed = clampThreshold(params.thresholdDb);
  const local = useRef<StoreApi<Local> | null>(null);
  if (!local.current) local.current = createStore<Local>(() => ({ width: 0, active: false, preview: committed }));
  const store = local.current;
  const width = useStore(store, s => s.width);
  const active = useStore(store, s => s.active);
  const preview = useStore(store, s => s.preview);
  const staleFor = useStore(store, s => s.staleFor);
  const threshold = active ? preview : committed;

  const wide = width >= SIDE_BY_SIDE;
  const size = width > 0 ? Math.max(HIT * 2, Math.min(maxSize, (wide ? width * 0.55 : width) - GUTTER)) : 0;
  const latest = useRef({ committed, curve, size, disabled, onThresholdCommit, onThresholdChange });
  latest.current = { committed, curve, size, disabled, onThresholdCommit, onThresholdChange };

  const segments = useMemo(() => (size > 0 ? dynamicsCurveSegments(curve, size) : []), [curve, size]);
  const grid = useMemo(() => (size > 0 ? dynamicsGridlines(size) : []), [size]);

  const cancel = () => cancelPreview(latest.current.committed,
    v => store.setState({ active: false, preview: v, staleFor: undefined }), latest.current.onThresholdChange);
  const commit = (next: number) => {
    const p = latest.current;
    store.setState({ active: false, preview: next });
    if (p.disabled || next === p.committed) { store.setState({ staleFor: undefined }); return; }
    store.setState({ staleFor: p.curve });
    const result = p.onThresholdCommit(next);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).then(undefined, () => {
        if (store.getState().staleFor === p.curve) store.setState({ staleFor: undefined });
      });
    }
  };
  const start = useRef(committed);
  const claims = (_e: GestureResponderEvent, g: PanResponderGestureState) =>
    !latest.current.disabled && Math.abs(g.dx) >= SLOP && Math.abs(g.dx) > Math.abs(g.dy);
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: claims,
    onMoveShouldSetPanResponderCapture: claims,
    onPanResponderGrant: () => {
      start.current = latest.current.committed;
      store.setState({ active: true, preview: start.current, staleFor: latest.current.curve });
    },
    onPanResponderMove: (_e, g) => {
      const p = latest.current;
      if (p.disabled || p.size <= 0) return;
      const next = dragThreshold(start.current, g.dx, p.size);
      if (next !== store.getState().preview) {
        store.setState({ preview: next });
        p.onThresholdChange?.(next);
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
  const nudge = (delta: number) => {
    const p = latest.current;
    if (p.disabled || store.getState().active) return;
    const next = clampThreshold(p.committed + delta);
    if (next === p.committed) return;
    p.onThresholdChange?.(next);
    commit(next);
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    if (key === "Escape" && store.getState().active) { e.preventDefault(); cancel(); return; }
    const delta = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1
      : key === "PageUp" ? 6 : key === "PageDown" ? -6 : 0;
    if (delta === 0) return;
    e.preventDefault();
    nudge(delta);
  };
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== store.getState().width) store.setState({ width: w });
  };

  const styled = !unstyled;
  const muted = joinClasses(styled && "text-text-muted");
  const tabular = { fontVariant: ["tabular-nums"] } as const;
  const dimmed = staleFor !== undefined && staleFor === curve;
  const ratio = params.ratio;
  const lower = stepRatio(ratio, -1), higher = stepRatio(ratio, 1);
  const thrX = size > 0 ? levelToOffset(threshold, size) : 0;
  const thrOut = curveOutputAt(curve, threshold);
  const thrDot = thrOut !== undefined && size > 0 ? dynamicsPoint(threshold, thrOut, size) : undefined;
  const levelOut = inputLevelDb !== undefined ? curveOutputAt(curve, inputLevelDb) : undefined;
  const levelDot = inputLevelDb !== undefined && levelOut !== undefined && size > 0 ? dynamicsPoint(inputLevelDb, levelOut, size) : undefined;
  const unity = size > 0 ? unitySegment(size) : undefined;
  const webTrack = Platform.OS === "web"
    ? { touchAction: "pan-y", cursor: disabled ? "default" : "ew-resize" } as unknown as ViewStyle : undefined;
  const chip = joinClasses(styled && "rounded-control items-center justify-center bg-surface-sunken border border-border focus-visible:ring-2 focus-visible:ring-focus active:opacity-80");
  const line = (key: string, left: number, top: number, w: number, h: number, cls: string, opacity = 1) =>
    <View key={key} pointerEvents="none" aria-hidden {...{ className: joinClasses(styled && cls) }}
      style={{ position: "absolute", left, top, width: w, height: h, opacity }} />;

  const plot = size > 0 ? <View style={{ direction: "ltr", alignSelf: "flex-start" }}>
    <View style={{ flexDirection: "row" }}>
      <View aria-hidden style={{ width: GUTTER, height: size }}>
        {grid.map(g => <Text key={g.db} {...{ className: muted }}
          style={{ position: "absolute", right: 4, top: size - g.at - 7, fontSize: 11, lineHeight: 14, ...tabular }}>{g.label}</Text>)}
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={label + " transfer curve"}
        {...valueAccessibility({ text: describeDynamics({ ...params, thresholdDb: threshold }, inputLevelDb) })}
        {...{ role: "img", "aria-label": label + " transfer curve. " + describeDynamics({ ...params, thresholdDb: threshold }, inputLevelDb) }}
        {...{ className: joinClasses(styled && "rounded-control bg-surface-sunken border border-border") }}
        style={{ width: size, height: size, overflow: "hidden" }}>
        {grid.map(g => line("v" + g.db, g.at, 0, 1, size, "bg-border"))}
        {grid.map(g => line("h" + g.db, 0, size - g.at, size, 1, "bg-border"))}
        {unity ? <View pointerEvents="none" aria-hidden {...{ className: joinClasses(styled && "bg-text-muted") }}
          style={{ position: "absolute", left: unity.centerX - unity.length / 2, top: unity.centerY - 0.5, width: unity.length,
            height: 1, opacity: 0.5, transform: [{ rotate: `${unity.angleDeg}deg` }] }} /> : null}
        {line("thr", thrX - 1, 0, 2, size, "bg-accent", 0.8)}
        <View pointerEvents="none" aria-hidden style={{ position: "absolute", inset: 0, opacity: dimmed ? 0.3 : 1 }}>
          {segments.map((s, i) => <View key={i} {...{ className: joinClasses(styled && "bg-primary") }}
            style={{ position: "absolute", left: s.centerX - s.length / 2 - 0.5, top: s.centerY - 1, width: s.length + 1,
              height: 2, transform: [{ rotate: `${s.angleDeg}deg` }] }} />)}
          {thrDot ? line("thrDot", thrDot.x - 4, thrDot.y - 4, 8, 8, "bg-accent rounded-full") : null}
        </View>
        {levelDot ? line("lvl", levelDot.x - 5, levelDot.y - 5, 10, 10, "bg-success rounded-full border-2 border-surface-raised") : null}
        <Text aria-hidden {...{ className: muted }} style={{ position: "absolute", left: 6, top: 4, fontSize: 11, lineHeight: 14 }}>Out</Text>
        <Text aria-hidden {...{ className: muted }} style={{ position: "absolute", right: 6, bottom: 4, fontSize: 11, lineHeight: 14 }}>In</Text>
        {curve.length === 0
          ? <Text {...{ className: muted }} style={{ position: "absolute", left: 0, right: 0, top: size / 2 - 10, textAlign: "center" }}>Curve unavailable</Text>
          : null}
      </View>
    </View>
    <View style={{ flexDirection: "row" }}>
      <View style={{ width: GUTTER }} />
      <View {...responder.current.panHandlers}
        accessible focusable={!disabled} accessibilityRole="adjustable" accessibilityLabel="Threshold"
        {...valueAccessibility({ min: -60, max: 0, now: threshold, text: describeLevel(threshold) })}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={e => nudge(e.nativeEvent.actionName === "increment" ? 1 : -1)}
        onKeyDown={onKeyDown}
        {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus") }}
        style={{ width: size, height: HIT, ...webTrack }}>
        {line("track", 0, HIT / 2 - 2, size, 4, "bg-border rounded-full")}
        {line("thumb", Math.min(size - THUMB, Math.max(0, thrX - THUMB / 2)), (HIT - 26) / 2, THUMB, 26,
          active ? "bg-accent border-accent rounded-control" : "bg-surface-raised border-2 border-accent rounded-control")}
      </View>
    </View>
  </View> : null;

  return <View {...rest} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised", className) }}
    style={[{ padding: 16, gap: 10, opacity: disabled ? 0.55 : 1 }, style]}>
    <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>{label}</Text>
    <View onLayout={onLayout} style={{ flexDirection: wide ? "row" : "column", gap: wide ? 24 : 12, alignItems: wide ? "flex-start" : "stretch" }}>
      {plot}
      <View style={{ gap: 12, flexShrink: 1 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: 8 }}>
          <Readout label="Threshold" value={formatThreshold(threshold)} styled={styled} />
          {onKneeCommit?<PrecisionScrubber label="Compressor knee" value={params.kneeDb} min={0} max={24} step={.1} unit="dB" disabled={disabled} unstyled={unstyled} onCommit={onKneeCommit}/>:<Readout label="Knee" value={formatKnee(params.kneeDb)} styled={styled}/>}
          {onMakeupCommit?<PrecisionScrubber label="Compressor makeup" value={params.makeupDb} min={0} max={24} step={.1} unit="dB" disabled={disabled} unstyled={unstyled} onCommit={onMakeupCommit}/>:<Readout label="Makeup" value={formatMakeup(params.makeupDb)} styled={styled}/>}
          <Readout label="Measured gain reduction" value={gainReductionDb===undefined?'Not reported':gainReductionDb.toFixed(2)+' dB'} styled={styled}/>
          {inputLevelDb !== undefined && Number.isFinite(inputLevelDb)
            ? <Readout label="Input" value={Math.round(inputLevelDb) + " dB"} styled={styled} /> : null}
        </View>
        <View accessibilityLabel="Ratio" {...{ role: "group" }} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Lower ratio"
            disabled={disabled || lower === ratio || ratio <= DYN_MIN_RATIO} onPress={() => { void onRatioCommit(lower); }}
            {...{ className: chip }} style={{ minWidth: HIT, minHeight: HIT, opacity: ratio <= DYN_MIN_RATIO ? 0.45 : 1 }}>
            <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>−</Text>
          </Pressable>
          <View accessible accessibilityLabel={"Ratio " + formatRatio(ratio)} style={{ minWidth: 72, alignItems: "center" }}>
            <Text {...{ className: muted }} style={{ fontSize: 12, lineHeight: 16 }}>Ratio</Text>
            <Text {...{ className: joinClasses(styled && "text-text font-semibold") }} style={tabular}>{formatRatio(ratio)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Raise ratio"
            disabled={disabled || higher === ratio || ratio >= DYN_MAX_RATIO} onPress={() => { void onRatioCommit(higher); }}
            {...{ className: chip }} style={{ minWidth: HIT, minHeight: HIT, opacity: ratio >= DYN_MAX_RATIO ? 0.45 : 1 }}>
            <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}

function Readout({ label, value, styled }: { label: string; value: string; styled: boolean }) {
  return <View accessible accessibilityLabel={label + " " + value} style={{ minWidth: 64 }}>
    <Text {...{ className: joinClasses(styled && "text-text-muted") }} style={{ fontSize: 12, lineHeight: 16 }}>{label}</Text>
    <Text {...{ className: joinClasses(styled && "text-text") }} style={{ fontVariant: ["tabular-nums"] }}>{value}</Text>
  </View>;
}
