import {assertMidiNotes} from './note-grid.ts';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { useLayoutEffect, useRef, type ComponentRef } from "react";
import {
  PanResponder, Platform, Pressable, ScrollView, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import {
  assertGrid, cellAt, describeNote, dragNote, dragNoteEnd, gridSize, isSharp, noteKeyEdit, noteRect,
  midiGridLines, pitchName, usesSeveralChannels, visiblePitches, type MidiNote, type NoteGrid,
} from "./note-grid.ts";
import { MidiChannelPicker } from "./MidiChannelPicker.tsx";

const HIT = 44;
/** Width of the keyboard column; a {@linkcode MIDIVelocityLane} below insets by it. */
export const PIANO_ROLL_KEY_COLUMN = 52;
const KEY_COLUMN = PIANO_ROLL_KEY_COLUMN;
/** Visible width of the end-resize grip. */
const GRIP = 10;
/** Most beat lines drawn; longer clips draw bar lines only. */
const MAX_BEAT_LINES = 256;

/** Props for {@linkcode MIDIPianoRoll}. */
export interface MIDIPianoRollProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** Committed notes of one clip. A note's index is its engine identity. */
  readonly notes: readonly MidiNote[];
  /** Clip length, ticks. */
  readonly clipTicks: number;
  /** Ticks per quarter note. @default 960 */
  readonly ppq?: number;
  /** Quarter-note beats per bar for legacy callers. Ignored by timeSignature. @default 4 */
  readonly beatsPerBar?: number;
  /** Musical numerator/denominator. Overrides beatsPerBar without rounding measure boundaries. */
  readonly timeSignature?: readonly [number,number];
  /** @default 48 (C3) */
  readonly lowestPitch?: number;
  /** @default 72 (C5) */
  readonly highestPitch?: number;
  /** Grid quantum for drags, keys and new notes. @default ppq / 4 (a sixteenth) */
  readonly snapTicks?: number;
  /** Horizontal zoom, points per tick. @default 0.1 (96 pt per beat at 960 ppq) */
  readonly pixelsPerTick?: number;
  /** Pitch row height; 44 keeps rows at the touch-target floor. @default 44 */
  readonly rowHeight?: number;
  /** Visible height before the rows scroll. @default 352 */
  readonly height?: number;
  /** Highlighted note. */
  readonly selectedIndex?: number;
  readonly onSelect?: (index: number) => void;
  /** Once per finished body drag or arrow-key move: new start and pitch together. */
  readonly onNoteMove: (index: number, startTicks: number, pitch: number) => void | Promise<unknown>;
  /** Once per finished end-edge drag or Shift+arrow. */
  readonly onNoteResize: (index: number, lengthTicks: number) => void | Promise<unknown>;
  /** Tap on an empty cell. Leave out to make the grid read-only for adding. */
  readonly onNoteAdd?: (startTicks: number, lengthTicks: number, pitch: number) => void | Promise<unknown>;
  /** Delete/Backspace on a focused note, or the screen-reader delete action. */
  readonly onNoteRemove?: (index: number) => void | Promise<unknown>;
  /**
   * Press on a key in the keyboard column. The UI plays nothing itself; the
   * app routes this to its synth. Leave out and the keys are labels only.
   */
  readonly onAudition?: (pitch: number) => void;
  /**
   * Horizontal scroll offset of the grid, points, so a velocity lane or ruler
   * can follow it (see `MIDIVelocityLane.scrollX`).
   */
  readonly onScrollX?: (x: number) => void;
  /** Nonnegative requested horizontal offset in layout points, clamped after measuring the viewport. */
  readonly scrollX?: number;
  /**
   * Set the selected note's MIDI channel (0..15), once per press or key; maps
   * onto the Cadence `setNoteChannel` op. Giving it shows a channel stepper
   * above the grid while a note is selected. A note without `channel` shows
   * as channel 1 (zero-based 0), which is where the engine plays it.
   */
  readonly onNoteChannel?: (index: number, channel: number) => void | Promise<unknown>;
  /** @default false */
  readonly disabled?: boolean;
  /** Accessible name. @default "Piano roll" */
  readonly label?: string;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled MIDI note editor for one clip. Drag a note to move it in time
 * and pitch, drag its end grip to resize, tap an empty cell to add, focus a
 * note and use arrows (Shift for length, Delete to remove). Every gesture
 * commits once, on release; Escape or an interrupted touch restores the
 * committed note.
 *
 * Musical time runs left to right in every locale (as in notation and in
 * the engine), so the grid never mirrors for right-to-left layouts.
 *
 * Note labels name the channel ("…, channel 10") only when the clip's
 * notes use more than one channel.
 *
 * Notes are plain views. This holds for a clip of a few hundred notes; a
 * dense arrangement view needs the Skia renderer, which is not verified yet.
 */
export function MIDIPianoRoll({scope='MIDIPianoRoll',revision=0,...props}:MIDIPianoRollProps){
 const retained=useRef({x:0,y:null as number|null,scope,revision});
 if(retained.current.scope!==scope||retained.current.revision!==revision)retained.current={x:0,y:null,scope,revision};
 assertMidiNotes(props.notes,props.clipTicks);
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.clipTicks,props.ppq,props.beatsPerBar,props.timeSignature,props.pixelsPerTick,props.rowHeight,props.lowestPitch,props.highestPitch,props.snapTicks,props.notes,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 // Note acknowledgements preserve focused controls. The full owner still cancels stale gestures.
 const bodyKey=JSON.stringify([...controlIdentity(scope,revision),props.clipTicks,props.ppq,props.beatsPerBar,props.timeSignature,props.pixelsPerTick,props.rowHeight,props.lowestPitch,props.highestPitch,props.snapTicks,props.disabled,props.disabledReason]);
 return <MIDIPianoRollBody key={bodyKey} {...props} interactionBoundary={owner} retained={retained.current} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onNoteMove={(...args:Parameters<MIDIPianoRollProps['onNoteMove']>)=>guard.run('onNoteMove',h=>h.onNoteMove(...args))}
  onNoteResize={(...args:Parameters<MIDIPianoRollProps['onNoteResize']>)=>guard.run('onNoteResize',h=>h.onNoteResize(...args))}
  onNoteAdd={props.onNoteAdd?(...args:Parameters<NonNullable<MIDIPianoRollProps['onNoteAdd']>>)=>guard.run('onNoteAdd',h=>h.onNoteAdd?.(...args)):undefined}
  onNoteRemove={props.onNoteRemove?(...args:Parameters<NonNullable<MIDIPianoRollProps['onNoteRemove']>>)=>guard.run('onNoteRemove',h=>h.onNoteRemove?.(...args)):undefined}
  onNoteChannel={props.onNoteChannel?(...args:Parameters<NonNullable<MIDIPianoRollProps['onNoteChannel']>>)=>guard.run('onNoteChannel',h=>h.onNoteChannel?.(...args)):undefined}
  onSelect={props.onSelect?(...args:Parameters<NonNullable<MIDIPianoRollProps['onSelect']>>)=>{guard.current()?.onSelect?.(...args);}:undefined}
  onAudition={props.onAudition?(...args:Parameters<NonNullable<MIDIPianoRollProps['onAudition']>>)=>{guard.current()?.onAudition?.(...args);}:undefined}
  onScrollX={props.onScrollX?(...args:Parameters<NonNullable<MIDIPianoRollProps['onScrollX']>>)=>{guard.current()?.onScrollX?.(...args);}:undefined}
 />;
}
function MIDIPianoRollBody({actionError,disabledReason,retained,interactionBoundary,
  notes, clipTicks, ppq = 960, beatsPerBar = 4, timeSignature, scrollX, lowestPitch = 48, highestPitch = 72,
  snapTicks, pixelsPerTick = 0.1, rowHeight = 44, height = 352, selectedIndex, onSelect,
  onNoteMove, onNoteResize, onNoteAdd, onNoteRemove, onAudition, onScrollX, onNoteChannel, disabled = false, label = "Piano roll",
  className, unstyled = false, ...rest
}: MIDIPianoRollProps&{actionError?:string|null;interactionBoundary:string;retained:{x:number;y:number|null}}) {
  const grid: NoteGrid = {
    clipTicks, lowestPitch, highestPitch, pixelsPerTick, rowHeight,
    snapTicks: snapTicks ?? Math.max(1, Math.round(ppq / 4)),
  };
  assertGrid(grid);
  if(notes.length>4096||!Number.isSafeInteger(ppq)||ppq<1||!Number.isFinite(sizeProduct(grid))||sizeProduct(grid)>1000000000)throw new RangeError('MIDI grid exceeds drawing budget');
  const styled = !unstyled;
  const size = gridSize(grid);
  const rows = visiblePitches(grid);
  const lines=midiGridLines(clipTicks,ppq,beatsPerBar,timeSignature,MAX_BEAT_LINES);
  if(scrollX!==undefined&&(!Number.isFinite(scrollX)||scrollX<0))throw new RangeError('Invalid MIDI scroll offset');
  const horizontal=useRef<ComponentRef<typeof ScrollView>|null>(null);
  const viewportWidth=useRef(0),dragging=useRef(false),actualX=useRef(0),acknowledgedX=useRef<number|null>(null),pendingScroll=useRef<number|null>(null),mounted=useRef(true);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const boundX=(value:number)=>Math.max(0,Math.min(value,Math.max(0,size.width-viewportWidth.current)));
  const acknowledgeX=(x:number)=>{retained.x=x;if(acknowledgedX.current!==x){acknowledgedX.current=x;onScrollX?.(x);}};
  const restoreX=()=>{
    if(!mounted.current||viewportWidth.current<=0||dragging.current)return;
    const target=boundX(scrollX??retained.x);
    if(Math.abs(target-actualX.current)<0.5){pendingScroll.current=null;acknowledgeX(target);return;}
    pendingScroll.current=target;
    horizontal.current?.scrollTo({x:target,y:0,animated:false});
  };
  useLayoutEffect(()=>{restoreX();},[scrollX,size.width]);

  // Open on the notes, not on the top row: scroll once, on first layout.
  const rowsScroll = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const opened = useRef(false);
  const inWindow = notes.filter(n => n.pitch >= lowestPitch && n.pitch <= highestPitch);
  const focusPitch = inWindow.length
    ? Math.round(inWindow.reduce((sum, n) => sum + n.pitch, 0) / inWindow.length)
    : Math.round((lowestPitch + highestPitch) / 2);
  const openAt = Math.max(0, Math.min(size.height - height, (highestPitch - focusPitch + 0.5) * rowHeight - height / 2));
  const onRowsLayout = () => {
    if (opened.current) return;
    opened.current = true;
    rowsScroll.current?.scrollTo({ y: retained.y??openAt, animated: false });
  };

  const addAt = (e: GestureResponderEvent) => {
    if (disabled || !onNoteAdd) return;
    const cell = cellAt(e.nativeEvent.locationX, e.nativeEvent.locationY, grid);
    if (cell) void onNoteAdd(cell.startTicks, cell.lengthTicks, cell.pitch);
  };

  const withChannel = usesSeveralChannels(notes);
  const picked = selectedIndex !== undefined ? notes[selectedIndex] : undefined;
  return <View {...rest} accessibilityLabel={label} {...{ role: "group" }}
    {...{ className: joinClasses(styled && "rounded-card border border-border bg-surface-raised overflow-hidden", className) }}>
    {onNoteChannel && picked ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4,
        paddingHorizontal: 8, paddingVertical: 6 }}
      {...{ className: joinClasses(styled && "border-b border-border") }}>
      <Text {...{ className: joinClasses(styled && "text-text font-semibold") }} style={{ fontVariant: ["tabular-nums"] }}>
        {pitchName(picked.pitch) + ", note " + (selectedIndex! + 1)}
      </Text>
      <MidiChannelPicker channel={picked.channel ?? 0} disabled={disabled} unstyled={unstyled}
        label={"MIDI channel of " + pitchName(picked.pitch) + " note " + (selectedIndex! + 1)}
        onChannelCommit={channel => onNoteChannel(selectedIndex!, channel)} />
    </View> : null}
    <ScrollView ref={rowsScroll} style={{ height }} nestedScrollEnabled onLayout={onRowsLayout} onScroll={e=>{if(mounted.current)retained.y=e.nativeEvent.contentOffset.y;}} scrollEventThrottle={16}>
      <View style={{ flexDirection: "row", direction: "ltr" }}>
        <View style={{ width: KEY_COLUMN }}>
          {rows.map(pitch => {
            const sharp = isSharp(pitch);
            const keyClass = joinClasses(styled && "justify-center border-b border-border",
              styled && (sharp ? "bg-surface-sunken" : "bg-surface-raised"));
            const text = <Text {...{ className: joinClasses(styled && (pitch % 12 === 0 ? "text-text font-semibold" : "text-text-muted")) }}
              style={{ paddingHorizontal: 6, fontVariant: ["tabular-nums"] }}>{pitchName(pitch)}</Text>;
            return onAudition
              ? <Pressable key={pitch} accessibilityRole="button" accessibilityLabel={"Play " + pitchName(pitch)}
                  disabled={disabled} onPress={() => onAudition(pitch)}
                  {...{ className: joinClasses(keyClass, styled && "active:opacity-70 focus-visible:ring-2 focus-visible:ring-focus") }}
                  style={{ height: rowHeight }}>{text}</Pressable>
              : <View key={pitch} {...{ className: keyClass }} style={{ height: rowHeight }}>{text}</View>;
          })}
        </View>
        <ScrollView ref={horizontal} horizontal nestedScrollEnabled style={{ flex: 1, direction: "ltr" }}
          onLayout={e=>{viewportWidth.current=e.nativeEvent.layout.width;restoreX();}}
          onContentSizeChange={()=>restoreX()} onScrollBeginDrag={()=>{dragging.current=true;pendingScroll.current=null;}}
          onScrollEndDrag={()=>{dragging.current=false;restoreX();}}
          scrollEventThrottle={16}
          onScroll={e=>{
            if(!mounted.current||viewportWidth.current<=0)return;
            const rawX=e.nativeEvent.contentOffset.x;
            if(!Number.isFinite(rawX))return;
            // A stale old-layout offset must not become a matching acknowledgement
            // merely because clamping maps it onto the new pending target.
            if(pendingScroll.current!==null&&Math.abs(rawX-pendingScroll.current)>=0.5){
              const maxX=Math.max(0,size.width-viewportWidth.current);
              if(rawX<=-0.5||rawX>=maxX+0.5)restoreX();
              return;
            }
            const x=boundX(rawX);
            if(Math.abs(rawX-x)>=0.5){restoreX();return;}
            pendingScroll.current=null;actualX.current=x;acknowledgeX(x);
          }}>
          <View style={{ width: size.width, height: size.height }}>
            <Pressable accessible={false} disabled={disabled || !onNoteAdd} onPress={addAt}
              style={{ position: "absolute", left: 0, top: 0, width: size.width, height: size.height }}>
              {rows.map((pitch, i) => <View key={pitch} pointerEvents="none"
                {...{ className: joinClasses(styled && "border-b border-border", styled && isSharp(pitch) && "bg-surface-sunken") }}
                style={{ position: "absolute", left: 0, right: 0, top: i * rowHeight, height: rowHeight }} />)}
              {lines.map(line => <View key={line.ticks} pointerEvents="none"
                {...{ className: joinClasses(styled && (line.bar ? "bg-text-muted" : "bg-border")) }}
                style={{ position: "absolute", top: 0, bottom: 0, left: line.ticks * pixelsPerTick, width: line.bar ? 2 : 1 }} />)}
              <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-text-muted") }}
                style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 2 }} />
            </Pressable>
            {notes.map((note, index) => noteRect(note, grid)
              ? <NoteBox key={index} interactionBoundary={interactionBoundary} index={index} note={note} grid={grid} ppq={ppq} withChannel={withChannel}
                  selected={index === selectedIndex} disabled={disabled} styled={styled}
                  onSelect={onSelect} onMove={onNoteMove} onResize={onNoteResize} onRemove={onNoteRemove} />
              : null)}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  <ErrorMessage message={actionError??disabledReason} unstyled={unstyled}/></View>;
}

type Drag = { mode: "idle" | "move" | "resize"; startTicks: number; pitch: number; lengthTicks: number };

interface NoteBoxProps {
  readonly interactionBoundary: string;
  readonly index: number;
  readonly note: MidiNote;
  readonly grid: NoteGrid;
  readonly ppq: number;
  /** Name the channel in the accessible label. */
  readonly withChannel: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly styled: boolean;
  readonly onSelect?: (index: number) => void;
  readonly onMove: MIDIPianoRollProps["onNoteMove"];
  readonly onResize: MIDIPianoRollProps["onNoteResize"];
  readonly onRemove?: MIDIPianoRollProps["onNoteRemove"];
}

/** One draggable note. Holds only the in-flight preview; the note itself is a prop. */
function NoteBox({ interactionBoundary, index, note, grid, ppq, withChannel, selected, disabled, styled, onSelect, onMove, onResize, onRemove }: NoteBoxProps) {
  const latest = useRef({ index, note, grid, disabled, onSelect, onMove, onResize, onRemove });
  useLayoutEffect(() => { latest.current = { index, note, grid, disabled, onSelect, onMove, onResize, onRemove }; });
  const local = useRef<StoreApi<Drag> | null>(null);
  if (!local.current) local.current = createStore<Drag>(() => ({ mode: "idle", startTicks: 0, pitch: 0, lengthTicks: 0 }));
  const store = local.current;
  const drag = useStore(store, s => s);
  const idle = { mode: "idle" as const, startTicks: 0, pitch: 0, lengthTicks: 0 };
  const cancel = () => store.setState(idle);
  useLayoutEffect(() => { cancel(); }, [interactionBoundary]);
  const begin = (mode: "move" | "resize") => {
    const p = latest.current;
    p.onSelect?.(p.index);
    store.setState({ mode, startTicks: p.note.startTicks, pitch: p.note.pitch, lengthTicks: p.note.lengthTicks });
  };
  const finish = () => {
    const p = latest.current;
    const d = store.getState();
    store.setState(idle);
    if (p.disabled || d.mode === "idle") return;
    if (d.mode === "move" && (d.startTicks !== p.note.startTicks || d.pitch !== p.note.pitch)) {
      void p.onMove(p.index, d.startTicks, d.pitch);
    }
    if (d.mode === "resize" && d.lengthTicks !== p.note.lengthTicks) void p.onResize(p.index, d.lengthTicks);
  };
  const make = (mode: "move" | "resize") => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: () => begin(mode),
    onPanResponderMove: (_e, g) => {
      const p = latest.current;
      if (p.disabled || store.getState().mode !== mode) return;
      if (mode === "move") {
        const next = dragNote(p.note, g.dx, g.dy, p.grid);
        const s = store.getState();
        if (next.startTicks !== s.startTicks || next.pitch !== s.pitch) store.setState(next);
      } else {
        const lengthTicks = dragNoteEnd(p.note, g.dx, p.grid);
        if (lengthTicks !== store.getState().lengthTicks) store.setState({ lengthTicks });
      }
    },
    onPanResponderRelease: finish,
    onPanResponderTerminate: cancel,
    onPanResponderTerminationRequest: () => store.getState().mode === "idle",
    onShouldBlockNativeResponder: () => true,
  });
  const body = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const end = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!body.current) body.current = make("move");
  if (!end.current) end.current = make("resize");

  const apply = (edit: ReturnType<typeof noteKeyEdit>) => {
    const p = latest.current;
    if (!edit || p.disabled) return;
    if (edit.kind === "move") void p.onMove(p.index, edit.startTicks, edit.pitch);
    if (edit.kind === "resize") void p.onResize(p.index, edit.lengthTicks);
    if (edit.kind === "remove" && p.onRemove) void p.onRemove(p.index);
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    if (key === "Escape" && store.getState().mode !== "idle") { e.preventDefault(); cancel(); return; }
    const edit = noteKeyEdit(latest.current.note, key, Boolean((e.nativeEvent as { shiftKey?: boolean }).shiftKey), latest.current.grid);
    if (!edit) return;
    e.preventDefault();
    apply(edit);
  };
  const actionKeys: Record<string, [string, boolean]> = {
    moveEarlier: ["ArrowLeft", false], moveLater: ["ArrowRight", false],
    pitchUp: ["ArrowUp", false], pitchDown: ["ArrowDown", false],
    shorten: ["ArrowLeft", true], lengthen: ["ArrowRight", true], delete: ["Delete", false],
  };

  const shown: MidiNote = drag.mode === "move" ? { ...note, startTicks: drag.startTicks, pitch: drag.pitch }
    : drag.mode === "resize" ? { ...note, lengthTicks: drag.lengthTicks } : note;
  const rect = noteRect(shown, grid) ?? noteRect(note, grid)!;
  const active = drag.mode !== "idle";
  const grip = Math.min(GRIP, rect.width / 3);
  const slopX = Math.max(0, (HIT - rect.width) / 2);
  const slopY = Math.max(0, (HIT - rect.height) / 2);
  const noSelect = Platform.OS === "web" ? { userSelect: "none", touchAction: "none", cursor: "grab" } as unknown as ViewStyle : undefined;
  return <View {...body.current.panHandlers}
    accessible focusable={!disabled} accessibilityRole="button"
    accessibilityLabel={describeNote(note, ppq, withChannel)}
    accessibilityState={{ selected, disabled }}
    accessibilityActions={[
      { name: "moveEarlier", label: "Move earlier" }, { name: "moveLater", label: "Move later" },
      { name: "pitchUp", label: "Pitch up" }, { name: "pitchDown", label: "Pitch down" },
      { name: "shorten", label: "Shorten" }, { name: "lengthen", label: "Lengthen" },
      ...(onRemove ? [{ name: "delete", label: "Delete note" }] : []),
    ]}
    onAccessibilityAction={e => {
      const k = actionKeys[e.nativeEvent.actionName];
      if (k) apply(noteKeyEdit(latest.current.note, k[0], k[1], latest.current.grid));
    }}
    onKeyDown={onKeyDown}
    onFocus={() => onSelect?.(index)}
    hitSlop={{ left: slopX, right: slopX, top: slopY, bottom: slopY }}
    {...{ className: joinClasses(styled && "rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
      styled && (selected || active ? "bg-primary border-focus" : "bg-accent border-accent")) }}
    style={{ position: "absolute", left: rect.x, top: rect.y + 3, width: Math.max(2, rect.width), height: rect.height - 6,
      opacity: disabled ? 0.45 : 1, ...noSelect }}>
    <View {...end.current.panHandlers}
      hitSlop={{ left: 6, right: Math.max(8, HIT - grip - 6), top: slopY + 3, bottom: slopY + 3 }}
      {...{ className: joinClasses(styled && (selected || active ? "bg-on-primary" : "bg-surface-raised")) }}
      style={{ position: "absolute", right: 0, top: 6, bottom: 6, width: grip, borderRadius: 2,
        ...(Platform.OS === "web" ? { cursor: "ew-resize" } as unknown as ViewStyle : null) }} />
  </View>;
}

function sizeProduct(g:NoteGrid){return g.clipTicks*g.pixelsPerTick;}

/** Optional runtime probe for hosts whose published dependency predates these props. */
MIDIPianoRoll.capabilities = Object.freeze({version:1 as const,rationalTimeSignature:true as const,controlledScrollX:true as const});
