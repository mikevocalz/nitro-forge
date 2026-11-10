import { describe, expect, it } from "vitest";
import { presentPreview } from "@nyc-tron/ui/components/forge/audio/preview-model";
import { toPreviewViewState } from "../src/previewView";
import type { PlaybackSnapshot } from "../src/audioPlayback";

const snap = (phase: PlaybackSnapshot["phase"], duration = 0, message = ""): PlaybackSnapshot =>
  ({ phase, duration, message });
const URI = "file:///take.wav";

describe("preview player snapshot -> NYC-Tron AudioPreview state", () => {
  it("is empty until a take is saved", () => {
    expect(toPreviewViewState(snap("idle"), null, 0, 0)).toEqual({ kind: "empty", message: "Record a clip to preview" });
  });
  it("offers play for a saved take, using the recorded length before decode", () => {
    for (const phase of ["idle", "stopped"] as const) {
      const view = toPreviewViewState(snap(phase), URI, 4.2, 0);
      expect(view).toEqual({ kind: "ready", durationMs: 4200 });
      expect(presentPreview(view).action?.kind).toBe("play");
    }
  });
  it("shows decode, then playback with a clamped playhead", () => {
    expect(toPreviewViewState(snap("loading"), URI, 4, 0)).toEqual({ kind: "loading" });
    expect(toPreviewViewState(snap("playing", 2), URI, 4, 0.5)).toEqual({ kind: "playing", durationMs: 2000, positionMs: 500 });
    expect(toPreviewViewState(snap("playing", 2), URI, 4, 9)).toEqual({ kind: "playing", durationMs: 2000, positionMs: 2000 });
    expect(presentPreview(toPreviewViewState(snap("playing", 2), URI, 4, 1)).action?.kind).toBe("stop");
  });
  it("keeps the player's error text", () => {
    expect(toPreviewViewState(snap("error", 0, "Preview supports recordings up to 60 seconds"), URI, 90, 0))
      .toEqual({ kind: "error", message: "Preview supports recordings up to 60 seconds" });
  });
  it("never reports NaN or negative lengths", () => {
    expect(toPreviewViewState(snap("idle"), URI, Number.NaN, 0)).toEqual({ kind: "ready", durationMs: 0 });
    expect(toPreviewViewState(snap("playing", -1), URI, 0, -3)).toEqual({ kind: "playing", durationMs: 0, positionMs: 0 });
  });
});
