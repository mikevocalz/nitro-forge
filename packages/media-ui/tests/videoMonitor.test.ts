import { describe, expect, it } from "vitest";
import {
  applyPlayingChange,
  createVideoMonitorStore,
  describeFrameTimebase,
  frameAtTime,
  frameSeekSeconds,
  initialVideoMonitorPhase,
  reportNativePlaybackTime,
  requestVideoFrame,
  settleSeekRequest,
  validFrameCount,
} from "../src/videoMonitorState";
import { FRAME_RATES, framesToSeconds } from "../src/timebase";
import { VIDEO_PLAYBACK_CAPABILITY } from "../src/videoCapability";

describe("native video seek observability", () => {
  const fps = FRAME_RATES.NTSC_2997;
  it("keeps a request pending when a stale in-flight report predates the seek", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 600, phase: { kind: "ready", playing: false } });
    expect(requestVideoFrame(store, 61)).toBe(61);
    expect(store.getState().requestedFrame).toBe(61);
    expect(store.getState().reportedFrame).toBe(0);
    // A timeUpdate for frame 60 was already in flight when frame 61 was requested.
    reportNativePlaybackTime(store, framesToSeconds(60, fps), 5, fps);
    expect(store.getState().reportedFrame).toBe(60);
    expect(store.getState().requestedFrame).toBe(61);
    expect(store.getState().bufferedFrame).toBe(149);
  });
  it("clears the request once a native report reaches the requested frame", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 600, phase: { kind: "ready", playing: false } });
    requestVideoFrame(store, 61);
    reportNativePlaybackTime(store, frameSeekSeconds(61, fps), 5, fps);
    expect(store.getState().reportedFrame).toBe(61);
    expect(store.getState().requestedFrame).toBeNull();
  });
  it("accepts reports just past the target while playing, never pre-seek ones", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 600, phase: { kind: "ready", playing: true } });
    requestVideoFrame(store, 200);
    reportNativePlaybackTime(store, framesToSeconds(103, fps), 5, fps, 4);
    expect(store.getState().requestedFrame).toBe(200);
    reportNativePlaybackTime(store, framesToSeconds(203, fps), 5, fps, 4);
    expect(store.getState().requestedFrame).toBeNull();
    expect(store.getState().reportedFrame).toBe(203);
  });
  it("ignores the playback window while paused", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 600, phase: { kind: "ready", playing: false } });
    requestVideoFrame(store, 200);
    reportNativePlaybackTime(store, framesToSeconds(202, fps), 5, fps, 4);
    expect(store.getState().requestedFrame).toBe(200);
  });
  it("settles a seek that produced no timeUpdate from a native time read", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 600, phase: { kind: "ready", playing: false } });
    requestVideoFrame(store, 61);
    // The decoder snapped to a keyframe at 48; the native getter is the truth.
    settleSeekRequest(store, 61, framesToSeconds(48, fps), fps);
    expect(store.getState().requestedFrame).toBeNull();
    expect(store.getState().reportedFrame).toBe(48);
  });
  it("does not let a superseded settle clear a newer request", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 600, phase: { kind: "ready", playing: false } });
    requestVideoFrame(store, 61);
    requestVideoFrame(store, 90);
    settleSeekRequest(store, 61, framesToSeconds(61, fps), fps);
    expect(store.getState().requestedFrame).toBe(90);
    expect(store.getState().reportedFrame).toBe(0);
  });
  it("clamps seek requests and actual decoder position", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 100 });
    expect(requestVideoFrame(store, 500)).toBe(100);
    reportNativePlaybackTime(store, 20, 100, FRAME_RATES.VIDEO_30);
    expect(store.getState().reportedFrame).toBe(100);
    expect(store.getState().bufferedFrame).toBe(100);
  });
  it("ignores a corrupt native callback instead of fabricating playback", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 100 });
    reportNativePlaybackTime(store, NaN, 1, FRAME_RATES.VIDEO_30);
    expect(store.getState().reportedFrame).toBe(0);
    expect(store.getState().requestedFrame).toBeNull();
    settleSeekRequest(store, 0, NaN, FRAME_RATES.VIDEO_30);
    expect(store.getState().reportedFrame).toBe(0);
    expect(validFrameCount(Infinity, FRAME_RATES.VIDEO_30)).toBe(0);
    expect(validFrameCount(-3, FRAME_RATES.VIDEO_30)).toBe(0);
  });
  it("does not make invalid/indefinite media scrubbable", () => {
    const store = createVideoMonitorStore();
    expect(requestVideoFrame(store, 120)).toBe(0);
    expect(store.getState().reportedFrame).toBe(0);
  });
});

describe("frame-centre seek targets", () => {
  const rates = [FRAME_RATES.NTSC_2997, FRAME_RATES.NTSC_5994, FRAME_RATES.FILM_24, FRAME_RATES.VIDEO_30];
  it("lands every target strictly inside its own frame interval", () => {
    const misses: string[] = [];
    for (const rate of rates) {
      for (let n = 0; n < 200_000; n++) {
        const t = frameSeekSeconds(n, rate);
        // Decoder model: the frame on screen is the last one whose PTS <= t.
        const shown = Math.floor(t * rate.numerator / rate.denominator);
        if (shown !== n || frameAtTime(t, rate) !== n) misses.push(`${rate.numerator}/${rate.denominator}:${n}`);
      }
    }
    expect(misses).toEqual([]);
  });
  it("maps a report at a frame's exact PTS to that frame, not the next", () => {
    const misses: number[] = [];
    for (const rate of rates) {
      for (let n = 0; n < 200_000; n++) {
        if (frameAtTime(framesToSeconds(n, rate), rate) !== n) misses.push(n);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe("phase transitions", () => {
  it("starts unavailable, not loading, while the selected player is blocked", () => {
    expect(VIDEO_PLAYBACK_CAPABILITY.status).toBe("blocked");
    const expected = { kind: "unavailable", reason: VIDEO_PLAYBACK_CAPABILITY.reason };
    expect(initialVideoMonitorPhase()).toEqual(expected);
    expect(createVideoMonitorStore().getState().phase).toEqual(expected);
  });
  it("keeps unavailable when a playing change arrives", () => {
    const phase = { kind: "unavailable", reason: "blocked" } as const;
    expect(applyPlayingChange(phase, true)).toBe(phase);
  });
  it("only updates playing while ready", () => {
    expect(applyPlayingChange({ kind: "ready", playing: false }, true))
      .toEqual({ kind: "ready", playing: true });
    expect(applyPlayingChange({ kind: "loading" }, true)).toEqual({ kind: "loading" });
    expect(applyPlayingChange({ kind: "error", message: "decode" }, false))
      .toEqual({ kind: "error", message: "decode" });
  });
});

describe("frame label", () => {
  it("names the caller timebase and the track rate separately", () => {
    expect(describeFrameTimebase(FRAME_RATES.NTSC_2997, 23.976))
      .toBe("Frame index at 29.97 fps (caller timebase); track reports 23.976 fps");
    expect(describeFrameTimebase(FRAME_RATES.VIDEO_30, null))
      .toBe("Frame index at 30 fps (caller timebase); track rate unavailable");
  });
});
