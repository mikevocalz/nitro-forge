import { createStore, type StoreApi } from "zustand/vanilla";
import { clampFrame, secondsToFrame, type FrameRate } from "./timebase";

export type VideoMonitorPhase =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly playing: boolean }
  | { readonly kind: "error"; readonly message: string };

export interface VideoMonitorState {
  readonly phase: VideoMonitorPhase;
  /** Last frame reported by the *actual* native decoder; not an optimistic request. */
  readonly reportedFrame: number;
  /** Latest user request, cleared by the first subsequent decoder time event. */
  readonly requestedFrame: number | null;
  readonly durationFrames: number;
  readonly bufferedFrame: number;
}

export function createVideoMonitorStore(): StoreApi<VideoMonitorState> {
  return createStore<VideoMonitorState>(() => ({
    phase: { kind: "loading" },
    reportedFrame: 0,
    durationFrames: 0,
    bufferedFrame: 0,
    requestedFrame: null,
  }));
}

export function validFrameCount(seconds: number, rate: FrameRate): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return secondsToFrame(seconds, rate);
}

/** Only native playback events acknowledge a seek or move the reported playhead. */
export function reportNativePlaybackTime(
  store: StoreApi<VideoMonitorState>,
  currentSeconds: number,
  bufferedSeconds: number,
  rate: FrameRate,
): void {
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return;
  const state = store.getState();
  const nextFrame = clampFrame(secondsToFrame(currentSeconds, rate), state.durationFrames);
  const bufferedFrame = !Number.isFinite(bufferedSeconds)
    ? state.bufferedFrame
    : clampFrame(secondsToFrame(Math.max(0, bufferedSeconds), rate), state.durationFrames);
  store.setState({
    reportedFrame: nextFrame,
    bufferedFrame,
    requestedFrame: null,
  });
}

export function requestVideoFrame(
  store: StoreApi<VideoMonitorState>,
  targetFrame: number,
): number {
  const target = clampFrame(targetFrame, store.getState().durationFrames);
  store.setState({ requestedFrame: target });
  return target;
}
