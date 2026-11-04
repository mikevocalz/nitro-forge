import { createStore, type StoreApi } from "zustand/vanilla";
import { assertFrameRate, clampFrame, secondsToFrame, type FrameRate } from "./timebase";

export type VideoMonitorPhase =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly playing: boolean }
  | { readonly kind: "error"; readonly message: string };

export interface VideoMonitorState {
  readonly phase: VideoMonitorPhase;
  /** Last frame reported by the *actual* native decoder; not an optimistic request. */
  readonly reportedFrame: number;
  /**
   * Latest user request. Cleared when a native report reaches it, or when
   * `settleSeekRequest` reads the native position after the seek.
   */
  readonly requestedFrame: number | null;
  readonly durationFrames: number;
  readonly bufferedFrame: number;
  /** Frame rate the native video track reports, or null when unknown (always null on web). */
  readonly trackFrameRate: number | null;
}

export function createVideoMonitorStore(): StoreApi<VideoMonitorState> {
  return createStore<VideoMonitorState>(() => ({
    phase: { kind: "loading" },
    reportedFrame: 0,
    durationFrames: 0,
    bufferedFrame: 0,
    requestedFrame: null,
    trackFrameRate: null,
  }));
}

export function validFrameCount(seconds: number, rate: FrameRate): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return secondsToFrame(seconds, rate);
}

/** Absorbs float error well below any container timescale (1e-6 frame). */
const FRAME_EPSILON = 1e-6;

/** Index of the frame whose interval [PTS, next PTS) contains `seconds`. */
export function frameAtTime(seconds: number, rate: FrameRate): number {
  assertFrameRate(rate);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("Seconds must be finite and nonnegative");
  }
  const frame = Math.floor(seconds * rate.numerator / rate.denominator + FRAME_EPSILON);
  if (!Number.isSafeInteger(frame)) throw new RangeError("Frame exceeds safe integer");
  return frame;
}

/**
 * Seek target for a frame: the centre of its interval. Targeting the PTS
 * itself lets a sub-ULP shortfall land on the previous frame.
 */
export function frameSeekSeconds(frame: number, rate: FrameRate): number {
  assertFrameRate(rate);
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError("Frame must be a nonnegative safe integer");
  }
  return (2 * frame + 1) * rate.denominator / (2 * rate.numerator);
}

/**
 * Applies a native timeUpdate. The reported playhead always moves; a pending
 * request clears only when the report reaches it. While playing, a report up
 * to `playingWindowFrames` past the target also counts, because the playhead
 * keeps advancing between events. A report from before the seek never does.
 */
export function reportNativePlaybackTime(
  store: StoreApi<VideoMonitorState>,
  currentSeconds: number,
  bufferedSeconds: number,
  rate: FrameRate,
  playingWindowFrames = 0,
): void {
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return;
  const state = store.getState();
  const nextFrame = clampFrame(frameAtTime(currentSeconds, rate), state.durationFrames);
  const bufferedFrame = !Number.isFinite(bufferedSeconds)
    ? state.bufferedFrame
    : clampFrame(frameAtTime(Math.max(0, bufferedSeconds), rate), state.durationFrames);
  const playing = state.phase.kind === "ready" && state.phase.playing;
  const window = playing ? Math.max(0, Math.floor(playingWindowFrames)) : 0;
  const requested = state.requestedFrame;
  const reached = requested !== null &&
    nextFrame - requested >= 0 && nextFrame - requested <= window;
  store.setState({
    reportedFrame: nextFrame,
    bufferedFrame,
    requestedFrame: reached ? null : requested,
  });
}

/**
 * Seek-completion fallback. A paused player may emit no progress event after
 * a seek, so once the seek settles the caller reads the player's current
 * position and passes it here. The native reading becomes the reported frame
 * and resolves the request, unless a newer request superseded
 * `requestedFrame`. No player is wired yet (see VIDEO_PLAYBACK_CAPABILITY).
 */
export function settleSeekRequest(
  store: StoreApi<VideoMonitorState>,
  requestedFrame: number,
  nativeSeconds: number,
  rate: FrameRate,
): void {
  const state = store.getState();
  if (state.requestedFrame !== requestedFrame) return;
  if (!Number.isFinite(nativeSeconds) || nativeSeconds < 0) return;
  store.setState({
    reportedFrame: clampFrame(frameAtTime(nativeSeconds, rate), state.durationFrames),
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

/** playingChange/playToEnd only toggle playback inside `ready`; loading and error stand. */
export function applyPlayingChange(
  phase: VideoMonitorPhase,
  isPlaying: boolean,
): VideoMonitorPhase {
  if (phase.kind !== "ready" || phase.playing === isPlaying) return phase;
  return { kind: "ready", playing: isPlaying };
}

function formatFps(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Frame numbers come from the caller's `frameRate` prop, not the media track.
 * The label says so and shows the track's own rate when the platform reports it.
 */
export function describeFrameTimebase(rate: FrameRate, trackFrameRate: number | null): string {
  assertFrameRate(rate);
  const caller = formatFps(Math.round(rate.numerator / rate.denominator * 100) / 100);
  const track = trackFrameRate !== null && Number.isFinite(trackFrameRate) && trackFrameRate > 0
    ? `track reports ${formatFps(trackFrameRate)} fps`
    : "track rate unavailable";
  return `Frame index at ${caller} fps (caller timebase); ${track}`;
}
