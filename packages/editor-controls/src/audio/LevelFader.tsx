import {createAudioPreviewOwner,commitAudioPreview,audioResponderCurrent} from './audio-preview-owner.ts';
import {audioTargetSize} from './audio-chrome.ts';
import {NativeVerticalFader} from './LevelFader.vertical.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {valueAccessibility} from "../value-a11y.ts";
import { useRef,useLayoutEffect } from "react";
import {
  I18nManager, PanResponder, Platform, Pressable, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type PanResponderGestureState, type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import {
  FADER_RANGES, clampGain, dragToGain, formatDb, gainToPosition, stepGain,
  type FaderRange,
} from "./level.ts";
import {exact} from '../exact-optional.ts';

/** Visual thickness of the thumb along the travel axis, in points. */
const THUMB = 16;
/** Minimum hit area across the travel axis (iOS 44pt / Android 48dp floor). */
/** Travel-axis movement, in points, before the fader claims a touch. */
const SLOP = 4;

type Local = { preview: number; active: boolean };

export interface LevelFaderLabels {
 lower?:(name:string,step:number)=>string;raise?:(name:string,step:number)=>string;
 gainInput?:(name:string)=>string;faderName?:(name:string)=>string;
 fineOn?:string;fineOff?:string;fineOnName?:string;fineOffName?:string;
 reset?:string;resetName?:string;raiseAction?:string;lowerAction?:string;resetAction?:string;
 invalidValue?:(min:number,max:number)=>string;
}

/** Props for {@linkcode LevelFader}. */
export interface LevelFaderProps extends Omit<ViewProps, "children">,ScopedControlProps {
  /** App-owned minimum interaction target. Defaults to 44 points. */
  readonly targetSize?: number;
  readonly labels?:LevelFaderLabels|undefined;
  /** Committed linear gain from the app or engine (0 = silence, 1 = 0 dB). */
  readonly value: number;
  /** Accessible name and visible label, e.g. `"Vocals"`. */
  readonly label: string;
  /**
   * Called with each new gain while a drag is in progress, with the restored
   * `value` when a drag is cancelled, and with the stepped gain just before
   * each step's `onCommit`. Use it for live preview only.
   */
  readonly onChange?: ((gain: number) => void) | undefined;
  /**
   * Called once per completed drag on release, and once per step from the
   * buttons, arrow keys or a screen-reader action. Not called when the gain
   * is unchanged. The fader keeps showing `value`, so a rejected promise
   * leaves the old level on screen; report the failure from the app.
   */
  readonly onCommit: (gain: number,signal?:AbortSignal) => void | Promise<unknown>;
  /**
   * Decibel window of the travel. The bottom of travel is always silence.
   * @default FADER_RANGES.UNITY (-60 dB to 0 dB)
   */
  readonly range?: FaderRange;
  /**
   * Size of one button or screen-reader step, in dB.
   * @default 1
   */
  readonly stepDb?: number;
  /** @default "vertical" */
  readonly orientation?: "vertical" | "horizontal";
  /**
   * Track length along the travel axis, in points.
   * @default 160
   */
  readonly length?: number;
  /** @default false */
  readonly disabled?: boolean;
  className?: string;
  /** Drop the default token recipe; supply a full app recipe via `className`. */
  unstyled?: boolean;
}

/**
 * Controlled audio level fader. It holds no engine state: the app passes the
 * committed `value`, sees previews through `onChange`, and receives exactly
 * one `onCommit` per gesture. Travel is linear in dB (see `level.ts`).
 *
 * Gesture arbitration: the fader does not claim a touch on press. It claims
 * one only after the finger moves {@linkcode SLOP} points along the travel
 * axis more than across it, so a swipe across a strip of vertical faders
 * still scrolls a horizontal mixer. Once it owns the drag it refuses
 * termination requests, so a parent ScrollView on the same axis cannot
 * cancel the move halfway. On web the track also sets `touch-action` to
 * leave only the cross axis to the browser.
 *
 * Each drag renders once per distinct 0.1 dB step (see `positionToGain`), so
 * the readout stays live without a render per touch event.
 *
 * Extracted from Nitro Forge PR #25 `NativeLevelSlider`, which wrapped the
 * `@expo/ui` Slider and fired on every move. This version draws its own
 * track with responder gestures so it can separate preview from commit and
 * needs no `@expo/ui` host.
 */
export function LevelFader({orientation='vertical',onChange,disabled=false,...props}:LevelFaderProps){
 return orientation==='horizontal'?<HorizontalLevelFader {...props} orientation={orientation} disabled={disabled} {...(onChange?{onChange}:{})}/>:<NativeVerticalFader {...props} range={props.range??FADER_RANGES.UNITY} length={props.length??160} {...(onChange?{onPreview:onChange}:{})} {...(disabled?{disabledReason:props.disabledReason??'Gain editing is paused'}:{})}/>;
}
function HorizontalLevelFader({scope='horizontal-fader',revision=0,...props}:LevelFaderProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.value,props.range,props.length,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 const previews=useRef<ReturnType<typeof createAudioPreviewOwner<number>>|null>(null);previews.current??=createAudioPreviewOwner();
 useLayoutEffect(()=>()=>previews.current!.clear(owner),[owner]);
 return <LevelFaderBody gestureBoundary={owner} onPreviewCancel={()=>previews.current!.clear(owner)} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending} onStepChange={gain=>guard.current()?.onChange?.(gain)} onChange={gain=>{const host=guard.current();if(host?.onChange)previews.current!.publish(owner,host.onChange,host.value,gain);}} onCommit={gain=>commitAudioPreview(previews.current!,owner,track=>guard.run('gain',(host,signal)=>track(()=>host.onCommit(gain,signal))))}/>;
}
function LevelFaderBody({
  gestureBoundary,onPreviewCancel,onStepChange,scope:_scope,revision:_revision,disabledReason,actionError=null,value, label, onChange, onCommit, range = FADER_RANGES.UNITY, stepDb = 1,
  orientation = "vertical", length = 160, disabled = false,
  className, unstyled = false, targetSize, labels, ...rest
}: LevelFaderProps&{gestureBoundary:string;onPreviewCancel:()=>void;onStepChange:(gain:number)=>void;actionError?:string|null}) {
  const HIT = audioTargetSize(targetSize);
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Gain must be finite and nonnegative");
  if (!Number.isFinite(stepDb) || stepDb <= 0) throw new RangeError("stepDb must be finite and positive");
  if (!Number.isFinite(length) || length <= THUMB * 2) {
    throw new RangeError(`Fader length must be greater than ${THUMB * 2}`);
  }
  const vertical = orientation === "vertical";
  const travel = length - THUMB;
  const latest = useRef({ value, range, stepDb, disabled, onChange, onCommit, onPreviewCancel, onStepChange, vertical, travel });
  latest.current = { value, range, stepDb, disabled, onChange, onCommit, onPreviewCancel, onStepChange, vertical, travel };
  const local = useRef<StoreApi<Local> | null>(null);
  if (!local.current) local.current = createStore<Local>(() => ({ preview: value, active: false }));
  const store = local.current;
  const active = useStore(store, s => s.active);
  const preview = useStore(store, s => s.preview);
  const current = clampGain(active ? preview : value, range);
  const position = gainToPosition(current, range);
  const startPosition = useRef(0);

  const boundary=JSON.stringify([gestureBoundary,value,range,length,disabled,orientation,I18nManager.isRTL]);
  const boundaryRef=useRef(boundary);boundaryRef.current=boundary;
  const admitted=useRef<string|null>(null),gestureId=useRef<number|null>(null);
  const cancel=()=>{admitted.current=null;gestureId.current=null;store.setState({active:false,preview:latest.current.value});latest.current.onPreviewCancel();};
  useLayoutEffect(()=>{cancel();},[boundary]);
  useLayoutEffect(()=>()=>onPreviewCancel(),[]);
  const commit = (next: number) => {
    const p=latest.current;
    admitted.current=null;
    store.setState({ active: false, preview: next });
    if (next === clampGain(p.value, p.range)) return;
    void p.onCommit(next);
  };
  // Claim only a drag along the travel axis, so cross-axis swipes reach a
  // parent ScrollView.
  const claims = (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
    const p = latest.current;
    if (p.disabled) return false;
    const along = Math.abs(p.vertical ? gesture.dy : gesture.dx);
    const across = Math.abs(p.vertical ? gesture.dx : gesture.dy);
    return along >= SLOP && along > across;
  };
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: claims,
    onMoveShouldSetPanResponderCapture: claims,
    onPanResponderGrant: (_event,gesture) => {
      const p = latest.current;
      if(p.disabled)return;admitted.current=boundaryRef.current;gestureId.current=gesture.stateID;
      const start = clampGain(p.value, p.range);
      startPosition.current = gainToPosition(start, p.range);
      store.setState({ active: true, preview: start });
    },
    onPanResponderMove: (_event, gesture) => {
      const p = latest.current;
      if (!audioResponderCurrent(admitted.current,boundaryRef.current,p.disabled,gestureId.current,gesture.stateID)||!store.getState().active) return;
      // Up raises a vertical fader. Horizontal travel follows reading
      // direction, so RTL layouts raise the level toward the left.
      const delta = p.vertical ? -gesture.dy : I18nManager.isRTL ? -gesture.dx : gesture.dx;
      const next = dragToGain(startPosition.current, delta, p.travel, p.range);
      if (next !== store.getState().preview) {
        store.setState({ preview: next });
        p.onChange?.(next);
      }
    },
    onPanResponderRelease: (_event,gesture) => {
      if (!store.getState().active||!audioResponderCurrent(admitted.current,boundaryRef.current,latest.current.disabled,gestureId.current,gesture.stateID)) return;
      if (latest.current.disabled) { cancel(); return; }
      commit(store.getState().preview);
    },
    onPanResponderTerminate: (_event,gesture)=>{if(audioResponderCurrent(admitted.current,boundaryRef.current,false,gestureId.current,gesture.stateID))cancel();},
    // Keep the drag once it started; releasing it mid-move would snap the
    // level back while the finger is still on the fader.
    onPanResponderTerminationRequest: () => !store.getState().active,
    onShouldBlockNativeResponder: () => true,
  });
  const nudge = (direction: -1 | 1) => {
    if(boundaryRef.current!==boundary)return;
    const p = latest.current;
    if (p.disabled || store.getState().active) return;
    const next = stepGain(p.value, direction, p.stepDb, p.range);
    if (next === clampGain(p.value, p.range)) return;
    p.onStepChange(next);
    if(boundaryRef.current!==boundary)return;
    commit(next);
  };

  const styled = !unstyled;
  const offset = position * travel;
  const readout = formatDb(current);
  const trackStyle = vertical
    ? { width: HIT, height: length }
    : { width: length, height: HIT };
  const railStyle = vertical
    ? { position: "absolute" as const, top: THUMB / 2, bottom: THUMB / 2, width: 6, left: (HIT - 6) / 2, borderRadius: 3 }
    : { position: "absolute" as const, start: THUMB / 2, end: THUMB / 2, height: 6, top: (HIT - 6) / 2, borderRadius: 3 };
  const fillStyle = vertical
    ? { position: "absolute" as const, bottom: THUMB / 2, height: offset, width: 6, left: (HIT - 6) / 2, borderRadius: 3 }
    : { position: "absolute" as const, start: THUMB / 2, width: offset, height: 6, top: (HIT - 6) / 2, borderRadius: 3 };
  const thumbStyle = vertical
    ? { position: "absolute" as const, bottom: offset, left: 4, width: HIT - 8, height: THUMB, borderRadius: 4, borderWidth: 2 }
    : { position: "absolute" as const, start: offset, top: 4, width: THUMB, height: HIT - 8, borderRadius: 4, borderWidth: 2 };
  const text = joinClasses(styled && "text-text");
  const stepButton = { minWidth: HIT, minHeight: HIT, justifyContent: "center" as const, alignItems: "center" as const, opacity: disabled ? 0.45 : 1 };
  const stepClass = joinClasses(styled && "rounded-control border border-border bg-surface-sunken active:opacity-80 focus-visible:ring-2 focus-visible:ring-focus");
  // Unity (0 dB) mark for ranges with headroom; on UNITY it is the top stop.
  const unity = range.maxDb > 0 ? gainToPosition(1, range) * travel + THUMB / 2 : undefined;
  const unityStyle = unity === undefined ? undefined : vertical
    ? { position: "absolute" as const, bottom: unity - 1, height: 2, left: (HIT - 18) / 2, width: 18 }
    : { position: "absolute" as const, start: unity - 1, width: 2, top: (HIT - 18) / 2, height: 18 };
  // Web only: the browser keeps the cross axis for page or mixer scrolling.
  // `touchAction` is a react-native-web style key, absent from RN's ViewStyle.
  const webTrack = Platform.OS === "web"
    ? { touchAction: vertical ? "pan-x" : "pan-y" } as unknown as ViewStyle : undefined;
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    const raise = key === "ArrowUp" || key === (I18nManager.isRTL ? "ArrowLeft" : "ArrowRight");
    const lower = key === "ArrowDown" || key === (I18nManager.isRTL ? "ArrowRight" : "ArrowLeft");
    if (!raise && !lower) return;
    e.preventDefault();
    nudge(raise ? 1 : -1);
  };

  return <View {...rest}
    {...{ className: joinClasses("items-center gap-2", styled && "rounded-control bg-surface-raised p-3", className) }}>
      <ErrorMessage {...exact({message:actionError??undefined,unstyled:unstyled})}/>
    <Text {...{ className: joinClasses(styled && "text-text font-semibold") }}>{label}</Text>
    <View {...responder.current.panHandlers}
      accessible focusable={!disabled} accessibilityRole="adjustable"
      accessibilityLabel={label}
      {...valueAccessibility({ min: 0, max: 100, now: Math.round(position * 100), text: readout })}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={e => {
        if (e.nativeEvent.actionName === "increment") nudge(1);
        if (e.nativeEvent.actionName === "decrement") nudge(-1);
      }}
      onKeyDown={onKeyDown}
      {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus") }}
      style={{ ...trackStyle, ...webTrack, opacity: disabled ? 0.45 : 1 }}>
      <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-surface-sunken") }} style={railStyle} />
      {unityStyle ? <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-text-muted") }} style={unityStyle} /> : null}
      <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-accent") }} style={fillStyle} />
      <View pointerEvents="none"
        {...{ className: joinClasses(styled && "bg-surface-sunken border-accent") }}
        style={thumbStyle} />
    </View>
    <Text {...{ className: joinClasses(styled && "text-text-muted") }}
      style={{ fontVariant: ["tabular-nums"] }}>{readout}</Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={labels?.lower?.(label,stepDb)??`Lower ${label} by ${stepDb} dB`}
        disabled={disabled} onPress={() => nudge(-1)} {...{ className: stepClass }} style={stepButton}>
        <Text {...{ className: text }}>−</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={labels?.raise?.(label,stepDb)??`Raise ${label} by ${stepDb} dB`}
        disabled={disabled} onPress={() => nudge(1)} {...{ className: stepClass }} style={stepButton}>
        <Text {...{ className: text }}>+</Text>
      </Pressable>
    </View>
  </View>;
}
