import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {useMemo as useIdentityMemo} from 'react';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {valueAccessibility} from "../value-a11y.ts";
/*
 * Structural references (Mobbin, iOS; structure only). Mobbin has no DAW
 * automation-lane screens, so these are the closest timeline patterns:
 * - TikTok video editor: a time ruler above stacked full-width lanes, each
 *   lane scrolling with the same horizontal offset.
 * - Facebook reel editor: empty lanes stay visible with an inline "Add
 *   audio" / "Add text" affordance instead of disappearing.
 * - Waymo audio settings: each control shows its value next to its name
 *   ("Bass +11"), which is where this lane's live point readout sits.
 * - Suno extend: a waveform lane with the exact time readout of the handle
 *   being dragged shown outside the drawing.
 */
import { useLayoutEffect,useRef } from "react";
import {
  PanResponder, Platform, Pressable, ScrollView, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import {
  AUTOMATION_PPQ, DEFAULT_SNAP_TICKS, assertGeometry, automationKeyEdit, automationSegments,
  canAddPointAt, clampAutomationValue, describeAutomationPoint, dragPoint, formatPosition, hitTestPoint, neutralValue,
  snapTicksTo, ticksToX, valueAt, valueToPosition, valueToY, yToValue,paramRange,formatAutomationValue,positionToValue,
  type AutomationGeometry, type AutomationMode, type AutomationParam, type AutomationPoint,
} from "./automation.ts";
import type { AutomationModePicker } from "./AutomationModePicker.tsx";
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from "../tokens.ts";

/** Minimum hit size (iOS 44pt / Android 48dp floor). */
const HIT = 44;
const DOT = 12;
const AXIS = 52;
/** Space before tick 0 and after the lane end, so edge points keep a full target. */
const LEAD = HIT / 2;

/**
 * Leading space, points, between the lane's outer start edge and tick 0
 * (axis labels plus a half-target lead). Give a view the lane lines up with
 * the same leading inset, for example `MIDIVelocityLane`'s `inset`.
 */
export const AUTOMATION_LANE_INSET = AXIS + LEAD;
/** Most beat lines drawn before falling back to bar lines only. */
const MAX_BEAT_LINES = 256;

type Drag = { index: number; ticks: number; value: number };
const IDLE: Drag = { index: -1, ticks: 0, value: 0 };

/** Props for {@linkcode AutomationLane}. */
export interface AutomationLaneProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Which lane this is: linear gain 0..1 or pan -1..1. Sets the scale and readouts. */
  readonly param: AutomationParam;
  /** Committed points from the engine, sorted by `ticks`, at most one per tick. */
  readonly points: readonly AutomationPoint[];
  /** Committed lane mode. Set it with {@linkcode AutomationModePicker}. */
  readonly mode: AutomationMode;
  /** Timeline length the lane covers, ticks. */
  readonly lengthTicks: number;
  /** Horizontal scale; match the arrangement or piano roll above. @default 0.1 */
  readonly pixelsPerTick?: number;
  /**
   * Follow another view's horizontal scroll (for example a timeline's
   * `onScrollX`). When omitted the lane scrolls on its own.
   */
  readonly scrollX?: number;
  /** Lane drawing height, points (the header and footer add to it). @default 160 */
  readonly height?: number;
  /** Time grid for adding, dragging and Left/Right steps. @default 240 */
  readonly snapTicks?: number;
  /** @default 960 */
  readonly ppq?: number;
  /** For bar lines and the "Bar 2 beat 1" readout. @default 4 */
  readonly beatsPerBar?: number;
  readonly selectedIndex?: number;
  readonly onSelect?: ((index: number) => void) | undefined;
  /**
   * Where the "Add point" button adds, ticks (for example the playhead).
   * @default 0
   */
  readonly cursorTicks?: number;
  /**
   * Once per tap on empty lane area or "Add point" press. Never called for a
   * tick that already has a point (the engine rejects duplicates).
   */
  readonly onPointAdd: (ticks: number, value: number,signal?:AbortSignal) => void | Promise<unknown>;
  /**
   * Once per finished drag or key step. `ticks` is always strictly between
   * the neighbours, so the index never changes. A rejected promise leaves the
   * committed point on screen.
   */
  readonly onPointMove: (index: number, ticks: number, value: number,signal?:AbortSignal) => void | Promise<unknown>;
  /** Delete/Backspace on a focused point, or the screen-reader "Delete point" action. */
  readonly onPointRemove: (index: number,signal?:AbortSignal) => void | Promise<unknown>;
  /** @default false */
  readonly disabled?: boolean;
  /** Visible title and accessible name, e.g. `"Vocal volume automation"`. */
  readonly label: string;
  className?: string;
  unstyled?: boolean | undefined;
}

/**
 * Controlled automation lane for one track parameter. Tap or click empty
 * lane area to add a point; drag a point to move it in time and value; focus
 * a point and use Up/Down for value (PageUp/PageDown for big steps),
 * Left/Right for time (Shift for a bar) and Delete to remove. Every gesture
 * commits once on release; Escape or an interrupted touch restores the
 * committed point. The "Add point" button adds at `cursorTicks`.
 *
 * Read mode renders linear between points and holds before the first and
 * after the last, which is what the line shows. In off mode the line is
 * dimmed and editing stays available.
 *
 * Time runs left to right in every locale, so the lane never mirrors; the
 * axis labels, header and footer follow the layout direction.
 *
 * Curved segments are not offered: the Cadence engine interpolates
 * linearly only. Write, touch and latch recording are covered in
 * {@linkcode AutomationModePicker}.
 */
export function AutomationLane({scope='automation-lane',revision=0,...props}:AutomationLaneProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),typeof props.param==='object'?props.param.id:props.param]);
 const signature=useIdentityMemo(()=>JSON.stringify(props.points),[props.points]),boundary=useEditorBoundary([owner,signature,JSON.stringify(props.param),props.disabled,props.disabledReason,props.lengthTicks,props.pixelsPerTick,props.height,props.snapTicks]);
 const guard=useScopedControl(boundary,props,!!props.disabled||props.disabledReason!==undefined);
 return <AutomationLaneBody key={owner} {...props} interactionBoundary={boundary} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onSelect={index=>guard.current()?.onSelect?.(index)}
  onPointAdd={(ticks,value)=>guard.run('add',(host,signal)=>host.onPointAdd(ticks,value,signal))}
  onPointMove={(index,ticks,value)=>guard.run('move',(host,signal)=>host.onPointMove(index,ticks,value,signal))}
  onPointRemove={index=>guard.run('remove',(host,signal)=>host.onPointRemove(index,signal))}/>;
}
function AutomationLaneBody({
  interactionBoundary,actionError=null,disabledReason,param, points, mode, lengthTicks, pixelsPerTick = 0.1, scrollX, height = 160, snapTicks = DEFAULT_SNAP_TICKS,
  ppq = AUTOMATION_PPQ, beatsPerBar = 4, selectedIndex, onSelect, cursorTicks = 0, onPointAdd, onPointMove,
  onPointRemove, disabled = false, label, className, unstyled = false, style, ...rest
}: AutomationLaneProps&{interactionBoundary:string;actionError?:string|null}) {
  const geometry: AutomationGeometry = { param, height, pixelsPerTick, lengthTicks };
  assertGeometry(geometry);
  const bounds=paramRange(param);if(points.length>10000||points.some((p,i)=>!Number.isSafeInteger(p.ticks)||p.ticks<0||p.ticks>lengthTicks||i>0&&p.ticks<=points[i-1]!.ticks||!Number.isFinite(p.value)||p.value<bounds.min||p.value>bounds.max))throw new RangeError("Invalid automation points");
  if (!Number.isInteger(snapTicks) || snapTicks < 1) throw new RangeError("snapTicks must be a positive integer");
  const styled = !unstyled;
  const local = useRef<StoreApi<Drag> | null>(null);
  if (!local.current) local.current = createStore<Drag>(() => IDLE);
  const store = local.current;
  const pressBoundary=useRef<string|null>(null);
  useLayoutEffect(()=>{store.setState(IDLE);pressBoundary.current=null;},[interactionBoundary,store]);
  const drag = useStore(store, s => s);
  const shown = drag.index >= 0 && drag.index < points.length
    ? points.map((p, i) => (i === drag.index ? { ticks: drag.ticks, value: drag.value } : p)) : points;
  const width = ticksToX(lengthTicks, pixelsPerTick);
  const off = mode === "off";
  const web = Platform.OS === "web";

  const beatPx = ppq * pixelsPerTick;
  const beatCount = Math.ceil(lengthTicks / ppq);
  const lines: number[] = [];
  const beatStep=beatCount<=MAX_BEAT_LINES?1:beatsPerBar*Math.max(1,Math.ceil(beatCount/beatsPerBar/MAX_BEAT_LINES));
  for(let b=beatStep;b<beatCount&&lines.length<MAX_BEAT_LINES;b+=beatStep)lines.push(b);

  const addAt = (e: GestureResponderEvent) => {
    if (disabled||pressBoundary.current!==interactionBoundary) return;
    let { locationX: x, locationY: y } = e.nativeEvent;
    if (web) {
      const event = e as unknown as {nativeEvent:{clientX:number;clientY:number};currentTarget:{getBoundingClientRect():{left:number;top:number}}};
      const rect = event.currentTarget.getBoundingClientRect();
      x = event.nativeEvent.clientX - rect.left; y = event.nativeEvent.clientY - rect.top;
    }
    const hit = hitTestPoint(points, x, y, geometry);
    if (hit !== undefined) { onSelect?.(hit); return; }
    const ticks = snapTicksTo(x / pixelsPerTick, snapTicks, lengthTicks);
    if (!canAddPointAt(points, ticks)) { onSelect?.(points.findIndex(p => p.ticks === ticks)); return; }
    void onPointAdd(ticks, yToValue(y, geometry));
  };
  const cursor = Math.min(lengthTicks, Math.max(0, Math.round(cursorTicks)));
  const cursorFree = canAddPointAt(points, cursor);
  const addCursor = () => {
    if (disabled || !cursorFree) return;
    void onPointAdd(cursor, clampAutomationValue(param, valueAt(points, cursor) ?? neutralValue(param)));
  };

  const focusIndex = drag.index >= 0 ? drag.index : selectedIndex;
  const focusPoint = focusIndex !== undefined ? shown[focusIndex] : undefined;
  const readout = focusPoint ? `Point ${focusIndex! + 1}: ${describeAutomationPoint(focusPoint, param, ppq, beatsPerBar)}` : "";
  const status = [
    off ? (typeof param==='object'?`Automation off: manual ${param.label}`:param === "gain" ? "Automation off: the fader sets the level" : "Automation off: the pan control sets the position") : "",
    points.length === 0 ? `No points. ${web ? "Click" : "Tap"} the lane to add one` : "",
  ].filter(Boolean);
  const axis = typeof param==='object'?[param.minimum,positionToValue(param,.5),param.maximum].map(v=>({v,t:formatAutomationValue(param,v)})):param === "gain"
    ? [{ v: 1, t: "0 dB" }, { v: 0.5012, t: "-6" }, { v: 0.1, t: "-20" }, { v: 0.01, t: "-40" }, { v: 0, t: "-inf" }]
    : [{ v: 1, t: "R" }, { v: 0, t: "C" }, { v: -1, t: "L" }];
  const muted = joinClasses(styled && "text-text-muted");
  const lineClass = joinClasses(styled && (off ? "bg-text-muted" : "bg-accent"));

  const content = <View style={{ width: width + LEAD * 2, height, direction: "ltr" }}>
   <View style={{ position: "absolute", left: LEAD, top: 0, width, height }}>
    <Pressable accessible={false} focusable={false} disabled={disabled} onPressIn={()=>{pressBoundary.current=interactionBoundary;}} onPress={addAt}
      style={{ position: "absolute", left: 0, top: 0, width, height,
        ...(web ? { cursor: disabled ? "default" : "copy" } as unknown as ViewStyle : null) }}>
      {lines.map(b => <View key={b} pointerEvents="none"
        {...{ className: joinClasses(styled && (b % beatsPerBar === 0 ? "bg-text-muted" : "bg-border")) }}
        style={{ position: "absolute", top: 0, bottom: 0, left: b * beatPx, width: tokens.borderWidth.hairline, opacity: b % beatsPerBar === 0 ? controlTokens.opacity.muted : 1 }} />)}
      {axis.map(a => <View key={a.t} pointerEvents="none" {...{ className: joinClasses(styled && "bg-border") }}
        style={{ position: "absolute", left: 0, right: 0, top: valueToY(a.v, geometry), height: tokens.borderWidth.hairline }} />)}
    </Pressable>
    {automationSegments(shown, geometry).map((s, i) => <View key={i} pointerEvents="none" {...{ className: lineClass }}
      // One extra point each way closes the antialiasing gaps between pieces.
      style={{ position: "absolute", left: s.centerX - s.length / 2 - tokens.borderWidth.hairline, top: s.centerY - tokens.borderWidth.hairline, width: s.length + tokens.spacing.off2, height: tokens.spacing.off2,
        borderRadius: forgeHairlineRadius.tick, transform: [{ rotate: `${s.angleDeg}deg` }] }} />)}
    {points.map((point, index) => <PointHandle key={index} index={index} points={points} shown={shown[index] ?? point}
      geometry={geometry} snapTicks={snapTicks} ppq={ppq} beatsPerBar={beatsPerBar} store={store}
      selected={index === selectedIndex} off={off} disabled={disabled} styled={styled}
      onSelect={onSelect} onMove={onPointMove} onRemove={onPointRemove} />)}
   </View>
  </View>;

  return <View {...rest} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised overflow-hidden", className) }}
    style={style}>
    <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: tokens.spacing.fixedInset, rowGap: tokens.spacing.off2,
      paddingHorizontal: tokens.spacing.fixedInset, paddingTop: tokens.spacing.off10, paddingBottom: tokens.spacing.fixedElement }}>
      <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>{label}</Text>
      <Text {...{ className: joinClasses(styled && "text-text-muted text-sm") }} accessibilityLiveRegion="polite"
        style={{ fontVariant: ["tabular-nums"] }}>{readout}</Text>
    </View>
    <View style={{ flexDirection: "row", height, opacity: disabled ? tokens.opacity.disabled : 1 }}>
      <View aria-hidden importantForAccessibility="no-hide-descendants" style={{ width: AXIS }}>
        {axis.map(a => <Text key={a.t} {...{ className: joinClasses(styled && "text-text-muted text-xs") }}
          style={{ position: "absolute", left: 0, right: 0, top: valueToY(a.v, geometry) - tokens.spacing.fixedElement, height: tokens.spacing.fixedGroup, lineHeight: tokens.text.off15,
            paddingHorizontal: tokens.spacing.fixedElement, textAlign: "right", fontVariant: ["tabular-nums"] }}>{a.t}</Text>)}
      </View>
      <View {...{ className: joinClasses(styled && "bg-surface-sunken") }}
        style={{ flex: 1, overflow: "hidden", direction: "ltr" }}>
        {scrollX === undefined
          ? <ScrollView horizontal style={{ flex: 1, direction: "ltr" }}>{content}</ScrollView>
          : <View style={{ transform: [{ translateX: -scrollX }] }}>{content}</View>}
      </View>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
      gap: tokens.spacing.fixedElement, paddingHorizontal: tokens.spacing.fixedInset, paddingVertical: tokens.spacing.fixedElement }}>
      <View style={{ flexShrink: 1, flexGrow: 1, flexBasis: controlTokens.extent.previewCompact, gap: tokens.spacing.off2 }}>
        {status.map(t => <Text key={t} {...{ className: muted }}>{t}</Text>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={"Add point at " + formatPosition(cursor, ppq, beatsPerBar)}
        accessibilityHint={cursorFree ? undefined : "A point already sits here"}
        accessibilityState={{ disabled: disabled || !cursorFree }}
        disabled={disabled || !cursorFree} onPress={addCursor}
        {...{ className: joinClasses(styled && "rounded-control border border-border bg-surface-sunken items-center justify-center active:opacity-80 focus-visible:ring-2 focus-visible:ring-focus") }}
        style={{ minHeight: HIT, minWidth: HIT, paddingHorizontal: tokens.spacing.off14, opacity: disabled || !cursorFree ? tokens.opacity.disabled : 1 }}>
        <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>Add point</Text>
      </Pressable>
    </View>
  </View>;
}

interface PointHandleProps {
  readonly index: number;
  readonly points: readonly AutomationPoint[];
  /** The point as drawn: the drag preview while this point is dragged. */
  readonly shown: AutomationPoint;
  readonly geometry: AutomationGeometry;
  readonly snapTicks: number;
  readonly ppq: number;
  readonly beatsPerBar: number;
  readonly store: StoreApi<Drag>;
  readonly selected: boolean;
  readonly off: boolean;
  readonly disabled: boolean;
  readonly styled: boolean;
  readonly onSelect?: ((index: number) => void) | undefined;
  readonly onMove: AutomationLaneProps["onPointMove"];
  readonly onRemove: AutomationLaneProps["onPointRemove"];
}

/** One draggable, focusable breakpoint. Holds no state; the drag preview lives in the lane's store. */
function PointHandle({
  index, points, shown, geometry, snapTicks, ppq, beatsPerBar, store, selected, off, disabled, styled, onSelect, onMove, onRemove,
}: PointHandleProps) {
  const latest = useRef({ index, points, geometry, snapTicks, ppq, beatsPerBar, disabled, onSelect, onMove, onRemove });
  useLayoutEffect(()=>{latest.current = { index, points, geometry, snapTicks, ppq, beatsPerBar, disabled, onSelect, onMove, onRemove };});
  const point = points[index]!;
  const active = useStore(store, s => s.index === index);
  const cancel = () => { if (store.getState().index === latest.current.index) store.setState(IDLE); };
  const finish = () => {
    const p = latest.current;
    const d = store.getState();
    if (d.index !== p.index) return;
    store.setState(IDLE);
    const committed = p.points[p.index];
    if (p.disabled || !committed) return;
    if (d.ticks !== committed.ticks || d.value !== committed.value) void p.onMove(p.index, d.ticks, d.value);
  };
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: () => {
      const p = latest.current;
      const committed = p.points[p.index]!;
      p.onSelect?.(p.index);
      store.setState({ index: p.index, ticks: committed.ticks, value: committed.value });
    },
    onPanResponderMove: (_e, g) => {
      const p = latest.current;
      if (p.disabled || store.getState().index !== p.index) return;
      const next = dragPoint(p.points, p.index, g.dx, g.dy, p.geometry, p.snapTicks);
      const s = store.getState();
      if (next.ticks !== s.ticks || next.value !== s.value) store.setState({ index: p.index, ...next });
    },
    onPanResponderRelease: finish,
    onPanResponderTerminate: cancel,
    onPanResponderTerminationRequest: () => store.getState().index !== latest.current.index,
    onShouldBlockNativeResponder: () => true,
  });

  const edit = (key: string, shift: boolean) => {
    const p = latest.current;
    if (p.disabled || store.getState().index >= 0) return false;
    const e = automationKeyEdit(p.points, p.index, key, shift, {
      param: p.geometry.param, lengthTicks: p.geometry.lengthTicks, snapTicks: p.snapTicks, barTicks: p.ppq * p.beatsPerBar,
    });
    if (!e) return key === "Delete" || key === "Backspace";
    if (e.kind === "remove") void p.onRemove(p.index);
    else void p.onMove(p.index, e.ticks, e.value);
    return true;
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    if (key === "Escape" && store.getState().index === latest.current.index) { e.preventDefault(); cancel(); return; }
    if (edit(key, Boolean((e.nativeEvent as { shiftKey?: boolean }).shiftKey))) e.preventDefault();
  };
  const actions: Record<string, string> = {
    increment: "ArrowUp", decrement: "ArrowDown", moveEarlier: "ArrowLeft", moveLater: "ArrowRight", delete: "Delete",
  };

  const { param } = geometry;
  const x = ticksToX(shown.ticks, geometry.pixelsPerTick);
  const y = valueToY(shown.value, geometry);
  const lit = selected || active;
  const position = valueToPosition(param, point.value);
  const webStyle = Platform.OS === "web"
    ? { touchAction: "none", userSelect: "none", cursor: disabled ? "default" : active ? "grabbing" : "grab" } as unknown as ViewStyle
    : undefined;
  const size = lit ? DOT + 4 : DOT;
  return <View {...responder.current.panHandlers}
    accessible focusable={!disabled} accessibilityRole="adjustable"
    accessibilityLabel={`Point ${index + 1}`}
    {...valueAccessibility({
      min: typeof param==='object'?param.minimum:param === "gain" ? 0 : -100, max: typeof param==='object'?param.maximum:100,
      now: typeof param==='object'?point.value:Math.round((param === "gain" ? position : point.value) * 100),
      text: describeAutomationPoint(point, param, ppq, beatsPerBar),
    })}
    accessibilityState={{ selected, disabled }}
    accessibilityActions={[
      { name: "increment" }, { name: "decrement" },
      { name: "moveEarlier", label: "Move earlier" }, { name: "moveLater", label: "Move later" },
      { name: "delete", label: "Delete point" },
    ]}
    onAccessibilityAction={e => { const k = actions[e.nativeEvent.actionName]; if (k) edit(k, false); }}
    onKeyDown={onKeyDown}
    onFocus={() => onSelect?.(index)}
    {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus") }}
    style={{ position: "absolute", left: x - HIT / 2, top: y - HIT / 2, width: HIT, height: HIT,
      alignItems: "center", justifyContent: "center", ...webStyle }}>
    <View pointerEvents="none"
      {...{ className: joinClasses(styled && "border-2", styled && (lit ? "bg-primary border-primary"
        : off ? "bg-surface-raised border-text-muted" : "bg-surface-raised border-accent")) }}
      style={{ width: size, height: size, borderRadius: forgeRadius.sm }} />
  </View>;
}
