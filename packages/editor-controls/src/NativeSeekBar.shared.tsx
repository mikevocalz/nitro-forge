import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Text, View } from "react-native";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { Button } from "@nyc-tron/ui/components/Button";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { clampFrame, formatTimecode, frameToPosition, positionToFrame } from "./timebase.ts";
import type { NativeSeekBarProps } from "./NativeSeekBar.types.ts";

import {controlIdentity} from "./inputs/useScopedControl.ts";
import { tokens } from "./tokens.ts";

type Drag = { preview: number | undefined };

/** What a platform slider needs from the shared seek-bar state. */
export interface SeekBarModel {
  /** True when disabled or the media has no frames. */
  readonly key:string;
  readonly off: boolean;
  /** Slider value in [0, 1]: the dragged frame mid-drag, otherwise `frame`. */
  readonly position: number;
  /** A drag tick at slider position `position`: previews, never commits. */
  readonly move: (position: number) => void;
  /**
   * The drag ended. Commits the frame at `position` when the platform reports
   * one, otherwise the last previewed frame. A second call commits nothing.
   */
  readonly release: (position?: number) => void;
}

const toFrame = (position: number, durationFrames: number) =>
  positionToFrame(Math.min(1, Math.max(0, position)), durationFrames);

/**
 * Preview/commit state shared by the iOS, Android and web seek bars, modelled
 * on `LevelFader`: drag ticks go to `onPreview`, the release goes to
 * `onCommit` once. `onSeek` is the deprecated name for `onCommit`; when both
 * are passed only `onCommit` runs, so no gesture fires twice.
 */
export function useSeekBarModel(props: NativeSeekBarProps) {
  const { frame, durationFrames, stepFrames = 1, disabled = false, onPreview } = props;
  if (!Number.isSafeInteger(durationFrames) || durationFrames < 0 ||
      !Number.isSafeInteger(stepFrames) || stepFrames < 1)
    throw new RangeError("Invalid frame count or step");
  const onCommit = props.onCommit ?? props.onSeek;
  if (typeof onCommit !== "function") throw new TypeError("NativeSeekBar needs onCommit (or the deprecated onSeek)");
  const boundary=JSON.stringify([...controlIdentity(props.scope??"native-seek",props.revision??0),durationFrames,stepFrames,disabled]);
  const current = clampFrame(frame, durationFrames);
  const off = disabled || durationFrames === 0;
  const latest = useRef({ boundary,current, durationFrames, off, onPreview, onCommit });
  useLayoutEffect(()=>{latest.current = { boundary,current, durationFrames, off, onPreview, onCommit };});
  const local = useRef<StoreApi<Drag> | null>(null);
  if (!local.current) local.current = createStore<Drag>(() => ({ preview: undefined }));
  const store = local.current;
  useLayoutEffect(()=>{store.setState({preview:undefined});},[boundary,store]);
  const preview = useStore(store, s => s.preview);
  const shown = preview ?? current;

  const commit = (next: number) => {
    const p = latest.current;
    if(p.boundary!==boundary)return;
    store.setState({ preview: undefined });
    if (p.off || next === p.current) return;
    p.onCommit(next);
  };
  const model: SeekBarModel = {
    key:boundary,off,
    position: frameToPosition(shown, durationFrames),
    move: position => {
      const p = latest.current;
      if (p.boundary!==boundary||p.off || !Number.isFinite(position)) return;
      const next = toFrame(position, p.durationFrames);
      if (next === (store.getState().preview ?? p.current)) return;
      store.setState({ preview: next });
      p.onPreview?.(next);
    },
    release: position => {
      const p = latest.current;
      if(p.boundary!==boundary)return;
      const dragged = store.getState().preview;
      if (position !== undefined && Number.isFinite(position)) commit(toFrame(position, p.durationFrames));
      else if (dragged !== undefined) commit(dragged);
    },
  };
  /** Step buttons: one commit per press, no preview. */
  const step = (delta: number) => commit(clampFrame(latest.current.current + delta, latest.current.durationFrames));
  return { model, shown, step };
}

/**
 * The seek bar frame around a platform slider: the slider on top, then one
 * row with step back, timecode and step forward (Forge PR #25, #27). The
 * transport is app-token RN, so it follows the app theme rather than the OS
 * scheme that `@expo/ui` text follows.
 */
export function SeekBarLayout({ props, shown, step, off, slider }: {
  props: NativeSeekBarProps;
  shown: number;
  step: (delta: number) => void;
  off: boolean;
  slider: ReactNode;
}) {
  const {
    scope:_scope,revision:_revision,frame: _frame, durationFrames, frameRate, onPreview: _preview, onCommit: _commit, onSeek: _seek,
    stepFrames = 1, dropFrameTimecode = false, disabled: _disabled, className, unstyled = false, style, ...rest
  } = props;
  const tc = (f: number) => formatTimecode(f, frameRate, { dropFrame: dropFrameTimecode });
  return <View {...rest}
    {...{ className: joinClasses("w-full", !unstyled && "rounded-control bg-surface-raised p-3", className) }}
    style={style}>
    {slider}
    <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.spacing.fixedElement, marginTop: tokens.spacing.fixedElement }}>
      <Button title={`−${stepFrames} frame`} variant="secondary" size="sm" disabled={off}
        onPress={() => step(-stepFrames)} />
      <Text selectable {...{ className: joinClasses(!unstyled && "text-text") }}
        style={{ flex: 1, minWidth: 0, textAlign: "center", fontVariant: ["tabular-nums"] }}>
        {`${tc(shown)} / ${tc(durationFrames)}`}
      </Text>
      <Button title={`+${stepFrames} frame`} variant="secondary" size="sm" disabled={off}
        onPress={() => step(stepFrames)} />
    </View>
  </View>;
}
