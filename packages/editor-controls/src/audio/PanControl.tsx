import {forgeRadius,forgeHairlineRadius} from "../radius.ts";
import {audioTargetSize} from './audio-chrome.ts';
import {valueAccessibility} from "../value-a11y.ts";
import { useRef } from "react";
import {
  PanResponder, Platform, Pressable, Text, View,
  type GestureResponderEvent, type KeyDownEvent, type PanResponderGestureState, type ViewProps, type ViewStyle,
} from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { cancelPreview } from "../cancel-preview.ts";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { describeBalance, describePan, dragToPan, formatPan, panToPosition, quantizePan, stepPan } from "./pan.ts";
import { tokens } from "../tokens.ts";

/** Minimum hit size (iOS 44pt / Android 48dp floor). */
const THUMB = 14;
/** Horizontal movement, in points, before the control claims a touch. */
const SLOP = 4;

type Local = { preview: number; active: boolean };

export interface PanControlLabels {
 pan?:string;balance?:string;centreAction?:string;
 name?:(channel:string,mode:'pan'|'balance')=>string;
 centreName?:(name:string)=>string;currentHint?:(spoken:string)=>string;
 spoken?:(value:number,mode:'pan'|'balance')=>string;
}

/** Props for {@linkcode PanControl}. */
export interface PanControlProps extends Omit<ViewProps, "children"> {
  /** App-owned minimum interaction target. Defaults to 44 points. */
  readonly targetSize?: number;
  readonly labels?:PanControlLabels|undefined;
  /** Committed mono pan from the app or engine, -1 (left) .. 1 (right). */
  readonly value: number;
  /**
   * Channel name; the accessible name is `"<label> pan"`, or
   * `"<label> balance"` in balance mode.
   */
  readonly label: string;
  /**
   * `"pan"` positions a mono source; `"balance"` is for a stereo bus, where
   * the engine attenuates the far side and keeps the near side. Changes the
   * accessible name, the caption and the spoken value; the drawn track and
   * the short readout are the same. @default "pan"
   */
  readonly mode?: "pan" | "balance";
  /** Live preview while dragging, and the restored value on cancel. */
  readonly onChange?: ((pan: number) => void) | undefined;
  /**
   * Once per completed drag, step or centre reset. Not called when the pan
   * is unchanged. The control keeps showing `value`, so a rejected promise
   * leaves the old position on screen.
   */
  readonly onCommit: (pan: number) => void | Promise<unknown>;
  /** One arrow-key or screen-reader step. @default 0.05 */
  readonly step?: number;
  /** Track width, points. @default 120 */
  readonly width?: number;
  /** Hide the visible channel name (strips already show it). @default false */
  readonly hideLabel?: boolean;
  /** @default false */
  readonly disabled?: boolean;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled mono pan control. Drag horizontally, use Left/Right arrows,
 * screen-reader increment/decrement, or press the readout to centre. Drags
 * snap to centre within a small detent. One `onCommit` per gesture.
 *
 * The stereo field is physical, so the track never mirrors in right-to-left
 * layouts: left is the left speaker and Right arrow pans right everywhere.
 * Text around it follows the layout direction.
 *
 * With `mode="balance"` the same control drives a bus balance (see
 * {@linkcode describeBalance}). Surround positioning is not offered: the
 * Cadence engine is stereo only (roster E-33, struck).
 */
export function PanControl({
  value, label, mode = "pan", onChange, onCommit, step = 0.05, width = 120, hideLabel = false, disabled = false,
  className, unstyled = false, targetSize, labels, ...rest
}: PanControlProps) {
  const HIT = audioTargetSize(targetSize);
  if (!Number.isFinite(width) || width <= THUMB * 2) throw new RangeError(`Pan width must be greater than ${THUMB * 2}`);
  const committed = quantizePan(value);
  const travel = width - THUMB;
  const latest = useRef({ value: committed, step, disabled, onChange, onCommit, travel });
  latest.current = { value: committed, step, disabled, onChange, onCommit, travel };
  const local = useRef<StoreApi<Local> | null>(null);
  if (!local.current) local.current = createStore<Local>(() => ({ preview: committed, active: false }));
  const store = local.current;
  const active = useStore(store, s => s.active);
  const preview = useStore(store, s => s.preview);
  const current = active ? preview : committed;
  const start = useRef(0);

  const cancel = () => cancelPreview(latest.current.value,
    restored => store.setState({ active: false, preview: restored }), latest.current.onChange);
  const commit = (next: number) => {
    const p = latest.current;
    store.setState({ active: false, preview: next });
    if (next === p.value) return;
    void p.onCommit(next);
  };
  const claims = (_e: GestureResponderEvent, g: PanResponderGestureState) =>
    !latest.current.disabled && Math.abs(g.dx) >= SLOP && Math.abs(g.dx) > Math.abs(g.dy);
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: claims,
    onMoveShouldSetPanResponderCapture: claims,
    onPanResponderGrant: () => {
      start.current = latest.current.value;
      store.setState({ active: true, preview: start.current });
    },
    onPanResponderMove: (_e, g) => {
      const p = latest.current;
      if (p.disabled) return;
      const next = dragToPan(start.current, g.dx, p.travel);
      if (next !== store.getState().preview) {
        store.setState({ preview: next });
        p.onChange?.(next);
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
  const nudge = (direction: -1 | 1) => {
    const p = latest.current;
    if (p.disabled || store.getState().active) return;
    const next = stepPan(p.value, direction, p.step);
    if (next === p.value) return;
    p.onChange?.(next);
    commit(next);
  };
  const centre = () => {
    const p = latest.current;
    if (p.disabled || store.getState().active || p.value === 0) return;
    p.onChange?.(0);
    commit(0);
  };
  const onKeyDown = (e: KeyDownEvent) => {
    const key = e.nativeEvent.key;
    if (key === "Escape" && store.getState().active) { e.preventDefault(); cancel(); return; }
    if (key === "Home" || key === "c" || key === "C") { e.preventDefault(); centre(); return; }
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    e.preventDefault();
    nudge(key === "ArrowRight" ? 1 : -1);
  };

  const styled = !unstyled;
  const x = panToPosition(current) * travel;
  const centreX = travel / 2 + THUMB / 2;
  const fillLeft = Math.min(x + THUMB / 2, centreX);
  const fillWidth = Math.abs(x + THUMB / 2 - centreX);
  const webTrack = Platform.OS === "web" ? { touchAction: "pan-y" } as unknown as ViewStyle : undefined;
  const readout = formatPan(current);
  const balance = mode === "balance";
  const name = labels?.name?.(label,mode)??label + (balance ? " balance" : " pan");
  const spoken = labels?.spoken?.(current,mode)??(balance ? describeBalance(current) : describePan(current));

  return <View {...rest} {...{ className: joinClasses("items-center gap-1", className) }}>
    {hideLabel ? null : <Text {...{ className: joinClasses(styled && "text-text-muted") }}>{balance ? (labels?.balance??"Balance") : (labels?.pan??"Pan")}</Text>}
    <View {...responder.current.panHandlers}
      accessible focusable={!disabled} accessibilityRole="adjustable" accessibilityLabel={name}
      {...valueAccessibility({ min: -100, max: 100, now: Math.round(current * 100), text: spoken })}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "centre", label: labels?.centreAction??"Centre" }]}
      onAccessibilityAction={e => {
        const action = e.nativeEvent.actionName;
        if (action === "increment") nudge(1);
        if (action === "decrement") nudge(-1);
        if (action === "centre") centre();
      }}
      onKeyDown={onKeyDown}
      {...{ className: joinClasses(styled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus") }}
      // Physical stereo field: never mirrored by an RTL ancestor.
      style={{ width, height: HIT, direction: "ltr", opacity: disabled ? tokens.opacity.disabled : 1, ...webTrack }}>
      <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-surface-sunken border border-border") }}
        style={{ position: "absolute", left: THUMB / 2, right: THUMB / 2, top: (HIT - tokens.spacing.off6) / 2, height: tokens.spacing.off6, borderRadius: forgeHairlineRadius.tick }} />
      <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-accent") }}
        style={{ position: "absolute", left: fillLeft, width: fillWidth, top: (HIT - tokens.spacing.off6) / 2, height: tokens.spacing.off6 }} />
      <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-text-muted") }}
        style={{ position: "absolute", left: centreX - tokens.borderWidth.hairline, width: tokens.spacing.off2, top: (HIT - tokens.spacing.fixedGroup) / 2, height: tokens.spacing.fixedGroup }} />
      <View pointerEvents="none" {...{ className: joinClasses(styled && "bg-surface-raised border-accent") }}
        style={{ position: "absolute", left: x, width: THUMB, top: (HIT - tokens.spacing.fixedSection) / 2, height: tokens.spacing.fixedSection, borderRadius: forgeRadius.sm, borderWidth: tokens.borderWidth.strong }} />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={labels?.centreName?.(name)??"Centre " + name}
      accessibilityHint={labels?.currentHint?.(spoken)??"Currently " + spoken} disabled={disabled || current === 0}
      onPress={centre}
      {...{ className: joinClasses(styled && "rounded-control active:opacity-80 focus-visible:ring-2 focus-visible:ring-focus") }}
      style={{ minWidth: HIT, minHeight: HIT, paddingHorizontal: tokens.spacing.off6, justifyContent: "center", alignItems: "center" }}>
      <Text {...{ className: joinClasses(styled && "text-text") }} style={{ fontVariant: ["tabular-nums"] }}>{readout}</Text>
    </Pressable>
  </View>;
}
