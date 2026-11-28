import {assertMidiNotes} from './note-grid.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
/**
 * Velocity lane under a piano roll: per-note bars plus a line tool.
 *
 * Structural references (Mobbin, iOS; structure only):
 * - Spotify, Edit transition: an automation curve drawn over the lane it
 *   controls, with the mode choices in a row under it.
 * - Riveo, clip audio sheet: "Ramp In" / "Ramp Out" as numeric rows, the
 *   non-gesture way to shape a level over time.
 * - TikTok, Set countdown: a two-option segmented control beside its label.
 * - ChatGPT, image draw tools: a straight-line tool chosen from a tool row
 *   before drawing.
 */
import { useEffect, useRef } from "react";
import {
  PanResponder, Platform, Pressable, ScrollView, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type PanResponderGestureState, type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { announce } from "@nyc-tron/ui/components/feedback/announce";
import { clampVelocity, dragVelocity, pitchName, velocityToHeight, type MidiNote } from "./note-grid.ts";
import {
  describeVelocityBatch, rampRoom, rampVelocities, velocityLineChanges, type LanePoint, type VelocityChange,
} from "./velocity-line.ts";
import { MidiValueStepper } from "./MidiChannelPicker.tsx";
import type { MIDIPianoRoll } from "./MIDIPianoRoll.tsx";

const HIT = 44;
const BAR = 8;
const SLOP = 4;
/** A line or tap hits a bar this far either side of its start, so the drawn bar width counts. */
const LINE_REACH = BAR / 2 + 2;

/**
 * Editing tool of a {@linkcode MIDIVelocityLane}: `"bars"` drags one bar at a
 * time, `"line"` draws a straight line across several.
 */
export type VelocityTool = "bars" | "line";

/** Props for {@linkcode MIDIVelocityLane}. */
export interface MIDIVelocityLaneProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** The same notes, in the same order, as the piano roll above. */
  readonly notes: readonly MidiNote[];
  readonly clipTicks: number;
  /** Must match the piano roll. @default 0.1 */
  readonly pixelsPerTick?: number;
  /** Height of the bar area, points (the tool row adds to it). @default 96 */
  readonly height?: number;
  /** Leading space so bars line up with the roll's grid, e.g. `PIANO_ROLL_KEY_COLUMN`. @default 0 */
  readonly inset?: number;
  /**
   * Follow another view's horizontal scroll (the roll's `onScrollX`). When
   * omitted the lane scrolls on its own.
   */
  readonly scrollX?: number;
  /** Arrow-key and screen-reader step. @default 4 */
  readonly step?: number;
  readonly selectedIndex?: number;
  readonly onSelect?: (index: number) => void;
  /** Once per finished bar drag or step. */
  readonly onVelocityCommit: (index: number, velocity: number) => void | Promise<unknown>;
  /**
   * Batch edit: once per finished line drawing or ramp, with the changes
   * sorted by note index, no duplicate index, never empty. Maps onto the
   * Cadence `setVelocities` op, so one gesture is one undo step. Giving it
   * shows the Bars / Line tool row; leaving it out keeps the lane bar-only.
   * A rejected promise leaves the committed velocities as they are.
   */
  readonly onVelocitiesCommit?: (changes: readonly VelocityChange[]) => void | Promise<unknown>;
  /** Current tool. Leave out to let the lane keep its own (starting at `"bars"`). */
  readonly tool?: VelocityTool;
  /** Called when the person picks the other tool. */
  readonly onToolChange?: (tool: VelocityTool) => void;
  /** @default false */
  readonly disabled?: boolean;
  /** @default "Velocity" */
  readonly label?: string;
  className?: string;
  unstyled?: boolean;
}

type Lane = {
  tool: VelocityTool;
  /** In-flight line, in content-area points; undefined when not drawing. */
  line: { start: LanePoint; end: LanePoint } | undefined;
  rampCount: number;
  rampEnd: number;
};

/**
 * Controlled per-note velocity bars under a {@linkcode MIDIPianoRoll}.
 *
 * Bars tool: drag a bar up or down, or focus it and use Up/Down
 * (PageUp/PageDown for 16). One `onVelocityCommit` per gesture.
 *
 * Line tool (needs `onVelocitiesCommit`): drag across the lane to draw a
 * straight line; bars under it preview the new heights and the whole batch
 * commits once on release. Escape or an interrupted touch drops the line
 * with no commit, and a line that changes nothing commits nothing. A tap
 * sets the bar under it to the tap's height.
 *
 * Ramp, the keyboard and screen-reader route to the same batch: with a note
 * selected, the Line tool row shows two steppers, "Notes" (how many notes,
 * starting at the selected one and going forward in time) and "End" (the
 * last note's velocity), and a Ramp button. Velocities run in equal steps
 * from the selected note's current velocity to End.
 *
 * Time runs left to right in every locale, so the bars and the line never
 * mirror; the tool row follows the layout direction.
 */
export function MIDIVelocityLane({scope='MIDIVelocityLane',revision=0,...props}:MIDIVelocityLaneProps){
 const retained=useRef({scrollX:0,scope,revision});
 if(retained.current.scope!==scope||retained.current.revision!==revision)retained.current={scrollX:0,scope,revision};
 const saved=useRef<ReturnType<typeof createVelocityToolStore>|null>(null);saved.current??=createVelocityToolStore();const toolStore=saved.current,localTool=useStore(toolStore,s=>s.tool);
 assertMidiNotes(props.notes,props.clipTicks);
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.clipTicks,props.pixelsPerTick,props.height,props.inset,props.notes,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <MIDIVelocityLaneBody key={owner} {...props} retained={retained.current} tool={props.tool??localTool} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onVelocityCommit={(...args:Parameters<MIDIVelocityLaneProps['onVelocityCommit']>)=>guard.run('onVelocityCommit',h=>h.onVelocityCommit(...args))}
  onVelocitiesCommit={props.onVelocitiesCommit?(...args:Parameters<NonNullable<MIDIVelocityLaneProps['onVelocitiesCommit']>>)=>guard.run('onVelocitiesCommit',h=>h.onVelocitiesCommit?.(...args)):undefined}
  onSelect={props.onSelect?(...args:Parameters<NonNullable<MIDIVelocityLaneProps['onSelect']>>)=>{guard.current()?.onSelect?.(...args);}:undefined}
  onToolChange={tool=>{const h=guard.current();if(h){toolStore.setState({tool});h.onToolChange?.(tool);}}}
 />;
}
function MIDIVelocityLaneBody({actionError,disabledReason,retained,
  notes, clipTicks, pixelsPerTick = 0.1, height = 96, inset = 0, scrollX, step = 4, selectedIndex, onSelect,
  onVelocityCommit, onVelocitiesCommit, tool, onToolChange, disabled = false, label = "Velocity",
  className, unstyled = false, style, ...rest
}: MIDIVelocityLaneProps&{actionError?:string|null;retained:{scrollX:number}}) {
 if(notes.length>4096)throw new RangeError('MIDI velocity lane exceeds drawing budget');
  if (!Number.isInteger(clipTicks) || clipTicks <= 0) throw new RangeError("clipTicks must be a positive integer");
  if (!Number.isFinite(height) || height < HIT) throw new RangeError(`Velocity lane height must be at least ${HIT}`);
  const styled = !unstyled;
  const width = clipTicks * pixelsPerTick;

  const local = useRef<StoreApi<Lane> | null>(null);
  if (!local.current) local.current = createStore<Lane>(() => ({ tool: "bars", line: undefined, rampCount: 4, rampEnd: 64 }));
  const store = local.current;
  const ownTool = useStore(store, s => s.tool);
  const line = useStore(store, s => s.line);
  const rampCount = useStore(store, s => s.rampCount);
  const rampEnd = useStore(store, s => s.rampEnd);
  const batch = onVelocitiesCommit !== undefined;
  const activeTool: VelocityTool = batch ? tool ?? ownTool : "bars";
  const ownScroll = useRef(retained.scrollX);
  const geometry = () => ({ pixelsPerTick, inset: 0, scrollX: scrollX ?? ownScroll.current, height });

  const latest = useRef({ notes, disabled, onVelocitiesCommit, geometry });
  latest.current = { notes, disabled, onVelocitiesCommit, geometry };
  const cancelLine = () => { if (store.getState().line) store.setState({ line: undefined }); };
  const commitBatch = (changes: readonly VelocityChange[]) => {
    const p = latest.current;
    if (p.disabled || !p.onVelocitiesCommit || changes.length === 0) return;
    void p.onVelocitiesCommit(changes);
    announce(describeVelocityBatch(changes));
  };
  const point = (e: GestureResponderEvent): LanePoint => ({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: e => { const at = point(e); store.setState({ line: { start: at, end: at } }); },
    onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
      const l = store.getState().line;
      if (!l) return;
      store.setState({ line: { start: l.start, end: { x: l.start.x + g.dx, y: l.start.y + g.dy } } });
    },
    onPanResponderRelease: () => {
      const l = store.getState().line;
      store.setState({ line: undefined });
      if (!l) return;
      const p = latest.current;
      commitBatch(velocityLineChanges(p.notes, p.geometry(), l.start, l.end, LINE_REACH));
    },
    onPanResponderTerminate: cancelLine,
    onPanResponderTerminationRequest: () => store.getState().line === undefined,
    onShouldBlockNativeResponder: () => true,
  });

  // A mouse drag on the web leaves focus where it was, so Escape is heard on the window.
  const drawing = line !== undefined;
  useEffect(() => {
    if (!drawing || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: { key: string; preventDefault(): void }) => { if (e.key === "Escape") { e.preventDefault(); cancelLine(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);
  // Dropping the tool or disabling the lane mid-draw cancels the line.
  useEffect(() => { if (activeTool !== "line" || disabled) cancelLine(); }, [activeTool, disabled]);

  const preview = new Map<number, number>();
  if (line) for (const c of velocityLineChanges(notes, geometry(), line.start, line.end, LINE_REACH)) preview.set(c.index, c.velocity);

  const pickTool = (next: VelocityTool) => {
    if (disabled || next === activeTool) return;
    if (tool === undefined) store.setState({ tool: next });
    onToolChange?.(next);
  };
  const selected = selectedIndex !== undefined && selectedIndex >= 0 && selectedIndex < notes.length ? selectedIndex : undefined;
  const room = selected === undefined ? 0 : rampRoom(notes, selected);
  const count = Math.min(Math.max(2, rampCount), Math.max(2, room));
  const rampChanges = selected !== undefined && room >= 2 ? rampVelocities(notes, selected, count, rampEnd) : [];

  const muted = joinClasses(styled && "text-text-muted");
  const segment = (on: boolean) => joinClasses(styled && "rounded-control items-center justify-center focus-visible:ring-2 focus-visible:ring-focus active:opacity-80",
    styled && (on ? "bg-primary" : "bg-transparent"));
  const segmentText = (on: boolean) => joinClasses(styled && "font-semibold", styled && (on ? "text-on-primary" : "text-text"));

  const toolbar = batch ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 8, padding: 8 }}
    {...{ className: joinClasses(styled && "border-b border-border") }}>
    <View accessibilityRole="radiogroup" accessibilityLabel="Velocity tool"
      {...{ className: joinClasses(styled && "rounded-control border border-border bg-surface-sunken") }}
      style={{ flexDirection: "row", padding: 2, gap: 2, opacity: disabled ? 0.45 : 1 }}>
      {(["bars", "line"] as const).map(t => <Pressable key={t} accessibilityRole="radio"
        accessibilityLabel={t === "bars" ? "Bars" : "Line"}
        accessibilityHint={t === "bars" ? "Drag one bar at a time" : "Drag across the lane to draw a straight line"}
        accessibilityState={{ checked: activeTool === t, disabled }} disabled={disabled} onPress={() => pickTool(t)}
        {...{ className: segment(activeTool === t) }} style={{ minWidth: HIT + 16, minHeight: HIT, paddingHorizontal: 12 }}>
        <Text {...{ className: segmentText(activeTool === t) }}>{t === "bars" ? "Bars" : "Line"}</Text>
      </Pressable>)}
    </View>
    {activeTool === "line" ? (selected !== undefined && room >= 2
      ? <View {...{role:"group"}} accessibilityLabel={`Ramp from ${pitchName(notes[selected]!.pitch)} note ${selected + 1}`}
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 8, flexShrink: 1, maxWidth: "100%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text aria-hidden {...{ className: muted }}>Notes</Text>
            <MidiValueStepper value={count} min={2} max={room} label="Ramp length in notes" pageStep={4}
              valueText={v => `${v} notes`} disabled={disabled} unstyled={unstyled}
              onValueCommit={v => store.setState({ rampCount: v })} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text aria-hidden {...{ className: muted }}>End</Text>
            <MidiValueStepper value={clampVelocity(rampEnd)} min={0} max={127} step={step} pageStep={16}
              label="Ramp end velocity" valueText={v => `velocity ${v}`} disabled={disabled} unstyled={unstyled}
              onValueCommit={v => store.setState({ rampEnd: v })} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Ramp"
            accessibilityHint={`Sets ${count} velocities from ${notes[selected]!.velocity} to ${clampVelocity(rampEnd)}`}
            disabled={disabled || rampChanges.length === 0} onPress={() => commitBatch(rampChanges)}
            {...{ className: joinClasses(styled && "rounded-control items-center justify-center border border-primary focus-visible:ring-2 focus-visible:ring-focus active:opacity-80") }}
            style={{ minWidth: HIT, minHeight: HIT, paddingHorizontal: 14, opacity: disabled || rampChanges.length === 0 ? 0.45 : 1 }}>
            <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>Ramp</Text>
          </Pressable>
        </View>
      : notes.length === 0 ? null
      : <Text {...{ className: muted }} style={{ flexShrink: 1, maxWidth: "100%" }}>
          {selected === undefined ? "Draw across the bars, or select a note to ramp from it."
            : "Draw across the bars. A ramp needs a later note than the selected one."}
        </Text>) : null}
  </View> : null;

  const content = <View style={{ width, height, direction: "ltr" }}>
    {notes.length === 0 ? null : [0.25, 0.5, 0.75].map(f => <View key={f} pointerEvents="none" {...{ className: joinClasses(styled && "bg-border") }}
      style={{ position: "absolute", left: 0, right: 0, top: height * (1 - f), height: 1 }} />)}
    {notes.map((note, index) => <VelocityBar key={index} index={index} note={note} x={note.startTicks * pixelsPerTick}
      laneHeight={height} step={step} selected={index === selectedIndex} disabled={disabled} styled={styled}
      locked={activeTool === "line"} preview={preview.get(index)}
      onSelect={onSelect} onCommit={onVelocityCommit} />)}
  </View>;
  const empty = notes.length === 0
    ? <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 8 }}>
        <Text {...{ className: muted }} style={{ textAlign: "center" }}>No notes yet. Add notes in the piano roll to set their velocity.</Text>
      </View>
    : null;
  const segmentView = line ? lineSegment(line.start, line.end) : undefined;
  const webDraw = Platform.OS === "web" ? { touchAction: "none", cursor: "crosshair", userSelect: "none" } as unknown as ViewStyle : undefined;
  return <View {...rest} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised overflow-hidden", className) }}
    style={style}>
    {toolbar}
    <View style={{ flexDirection: "row", direction: "ltr" }}>
      <View style={{ width: inset, justifyContent: "center" }}>
        {inset >= 40 ? <Text {...{ className: muted }} style={{ paddingHorizontal: 6 }}>Vel</Text> : null}
      </View>
      <View style={{ flex: 1, height, overflow: "hidden" }}>
        {scrollX === undefined
          ? <ScrollView horizontal contentOffset={{x:retained.scrollX,y:0}} style={{ flex: 1 }} scrollEventThrottle={16}
              onScroll={e => { ownScroll.current = e.nativeEvent.contentOffset.x;retained.scrollX=ownScroll.current; }}>{content}</ScrollView>
          : <View style={{ transform: [{ translateX: -scrollX }] }}>{content}</View>}
        {empty}
        {activeTool === "line" && !disabled && notes.length > 0
          ? <View {...responder.current.panHandlers} accessible={false} testID={rest.testID ? rest.testID + "-draw" : undefined}
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, ...webDraw }}>
              {segmentView ? <>
                <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-primary") }}
                  style={{ position: "absolute", left: segmentView.centerX - segmentView.length / 2, top: segmentView.centerY - 1,
                    width: segmentView.length, height: 2, borderRadius: 1, transform: [{ rotate: `${segmentView.angleDeg}deg` }] }} />
                {[line!.start, line!.end].map((p, i) => <View key={i} pointerEvents="none"
                  {...{ className: joinClasses(styled && "bg-primary border-2 border-surface-raised") }}
                  style={{ position: "absolute", left: p.x - 5, top: p.y - 5, width: 10, height: 10, borderRadius: 5 }} />)}
              </> : null}
            </View>
          : null}
      </View>
    </View>
  <ErrorMessage message={actionError??disabledReason} unstyled={unstyled}/></View>;
}

/** A segment drawn as a rotated view about its centre (the Sparkline technique). */
function lineSegment(a: LanePoint, b: LanePoint) {
  return {
    centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2,
    length: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    angleDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

type Bar = { preview: number; active: boolean };

interface VelocityBarProps {
  readonly index: number;
  readonly note: MidiNote;
  readonly x: number;
  readonly laneHeight: number;
  readonly step: number;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly styled: boolean;
  /** Line tool active: the bar ignores drags (keys still work). */
  readonly locked: boolean;
  /** Height the line tool would give this bar. */
  readonly preview: number | undefined;
  readonly onSelect?: (index: number) => void;
  readonly onCommit: MIDIVelocityLaneProps["onVelocityCommit"];
}

function VelocityBar({ index, note, x, laneHeight, step, selected, disabled, styled, locked, preview: linePreview, onSelect, onCommit }: VelocityBarProps) {
  const latest = useRef({ index, note, laneHeight, step, disabled, locked, onSelect, onCommit });
  latest.current = { index, note, laneHeight, step, disabled, locked, onSelect, onCommit };
  const local = useRef<StoreApi<Bar> | null>(null);
  if (!local.current) local.current = createStore<Bar>(() => ({ preview: note.velocity, active: false }));
  const store = local.current;
  const active = useStore(store, s => s.active);
  const preview = useStore(store, s => s.preview);
  const current = linePreview ?? (active ? preview : note.velocity);
  const cancel = () => store.setState({ active: false, preview: latest.current.note.velocity });
  const commit = (next: number) => {
    const p = latest.current;
    store.setState({ active: false, preview: next });
    if (!p.disabled && next !== p.note.velocity) void p.onCommit(p.index, next);
  };
  const claims = (_e: GestureResponderEvent, g: PanResponderGestureState) =>
    !latest.current.disabled && !latest.current.locked && Math.abs(g.dy) >= SLOP && Math.abs(g.dy) > Math.abs(g.dx);
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: claims,
    onMoveShouldSetPanResponderCapture: claims,
    onPanResponderGrant: () => {
      const p = latest.current;
      p.onSelect?.(p.index);
      store.setState({ active: true, preview: p.note.velocity });
    },
    onPanResponderMove: (_e, g) => {
      const p = latest.current;
      const next = dragVelocity(p.note.velocity, g.dy, p.laneHeight);
      if (next !== store.getState().preview) store.setState({ preview: next });
    },
    onPanResponderRelease: () => { if (store.getState().active) commit(store.getState().preview); },
    onPanResponderTerminate: cancel,
    onPanResponderTerminationRequest: () => !store.getState().active,
    onShouldBlockNativeResponder: () => true,
  });
  const nudge = (delta: number) => {
    const p = latest.current;
    if (p.disabled || store.getState().active) return;
    commit(clampVelocity(p.note.velocity + delta));
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    const delta = key === "ArrowUp" ? step : key === "ArrowDown" ? -step : key === "PageUp" ? 16 : key === "PageDown" ? -16 : 0;
    if (key === "Escape" && store.getState().active) { e.preventDefault(); cancel(); return; }
    if (delta === 0) return;
    e.preventDefault();
    nudge(delta);
  };
  const h = velocityToHeight(current, laneHeight);
  const lit = selected || active || linePreview !== undefined;
  const webStyle = Platform.OS === "web" ? { touchAction: "pan-x", cursor: locked ? undefined : "ns-resize" } as unknown as ViewStyle : undefined;
  return <View {...responder.current.panHandlers}
    accessible focusable={!disabled} accessibilityRole="adjustable"
    accessibilityLabel={`Velocity of ${pitchName(note.pitch)} note ${index + 1}`}
    accessibilityValue={{ min: 0, max: 127, now: current }}
    {...{ "aria-valuemin": 0, "aria-valuemax": 127, "aria-valuenow": current }}
    accessibilityState={{ selected, disabled }}
    accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
    onAccessibilityAction={e => nudge(e.nativeEvent.actionName === "increment" ? step : -step)}
    onKeyDown={onKeyDown}
    onFocus={() => onSelect?.(index)}
    {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus") }}
    style={{ position: "absolute", left: x - (HIT - BAR) / 2, top: 0, width: HIT, height: laneHeight,
      opacity: disabled ? 0.45 : 1, ...webStyle }}>
    <View pointerEvents="none" {...{ className: joinClasses(styled && (lit ? "bg-primary" : "bg-accent")) }}
      style={{ position: "absolute", left: (HIT - BAR) / 2, width: BAR, bottom: 0, height: Math.max(2, h), borderRadius: 2 }} />
    <View pointerEvents="none" {...{ className: joinClasses(styled && (lit ? "bg-primary" : "bg-accent")) }}
      style={{ position: "absolute", left: (HIT - BAR) / 2 - 3, width: BAR + 6, height: 4, borderRadius: 2, bottom: Math.max(2, h) - 2 }} />
  </View>;
}

function createVelocityToolStore(){return createStore<{tool:VelocityTool}>(()=>({tool:"bars"}));}
