import { describe, expect, it } from "vitest";
import {
  createVideoMonitorStore,
  reportNativePlaybackTime,
  requestVideoFrame,
  validFrameCount,
} from "../src/videoMonitorState";
import { FRAME_RATES } from "../src/timebase";

describe("native video seek observability", () => {
  const fps = FRAME_RATES.NTSC_2997;
  it("does not treat a requested frame as a decoded frame", () => {
    const store = createVideoMonitorStore();
    store.setState({ durationFrames: 600 });
    expect(requestVideoFrame(store, 61)).toBe(61);
    expect(store.getState().requestedFrame).toBe(61);
    expect(store.getState().reportedFrame).toBe(0);
    reportNativePlaybackTime(store, 2, 5, fps);
    expect(store.getState().reportedFrame).toBe(60);
    expect(store.getState().requestedFrame).toBeNull();
    expect(store.getState().bufferedFrame).toBe(150);
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
    expect(validFrameCount(Infinity, FRAME_RATES.VIDEO_30)).toBe(0);
    expect(validFrameCount(-3, FRAME_RATES.VIDEO_30)).toBe(0);
  });
  it("does not make invalid/indefinite media scrubbable", () => {
    const store = createVideoMonitorStore();
    expect(requestVideoFrame(store, 120)).toBe(0);
    expect(store.getState().reportedFrame).toBe(0);
  });
});
