import { describe, expect, it } from "vitest";
import { presentRecording } from "@nyc-tron/ui/components/forge/audio/recording-model";
import { fileLabel, inputLevel, toRecordingViewState } from "../src/recordingView";
import type { RecordingPhase } from "../src/recording";

describe("controller phase -> NYC-Tron RecordingTrack state", () => {
  it("maps every phase and keeps elapsed time", () => {
    const cases: [RecordingPhase, unknown][] = [
      [{ kind: "idle" }, { kind: "idle" }],
      [{ kind: "requesting-permission" }, { kind: "requesting-permission" }],
      [{ kind: "permission-denied" }, { kind: "permission-denied" }],
      [{ kind: "preparing" }, { kind: "preparing" }],
      [{ kind: "recording", durationMs: 1200 }, { kind: "recording", durationMs: 1200 }],
      [{ kind: "stopping", durationMs: 1300 }, { kind: "stopping", durationMs: 1300 }],
      [{ kind: "interrupted", durationMs: 900, message: "Call started" },
        { kind: "interrupted", durationMs: 900, message: "Call started" }],
      [{ kind: "saved", uri: "file:///docs/Forge/take%201.wav", durationMs: 4000 },
        { kind: "saved", durationMs: 4000, label: "take 1.wav" }],
      [{ kind: "error", message: "No available microphone" }, { kind: "error", message: "No available microphone" }],
    ];
    for (const [phase, view] of cases) expect(toRecordingViewState(phase)).toEqual(view);
  });

  it("drives the view's primary action from the controller phase", () => {
    const action = (phase: RecordingPhase) => presentRecording(toRecordingViewState(phase), false).action?.kind;
    expect(action({ kind: "idle" })).toBe("start");
    expect(action({ kind: "recording", durationMs: 0 })).toBe("stop");
    expect(action({ kind: "interrupted", durationMs: 10, message: "x" })).toBe("save-interrupted");
    expect(action({ kind: "error", message: "x" })).toBe("retry");
    expect(action({ kind: "stopping", durationMs: 10 })).toBeUndefined();
  });

  it("labels saved files by name, including blob and odd URIs", () => {
    expect(fileLabel("file:///a/b/c.m4a?x=1")).toBe("c.m4a");
    expect(fileLabel("blob:https://app/1234")).toBe("1234");
    expect(fileLabel("file:///a/%E0%A4%A.wav")).toBe("%E0%A4%A.wav");
    expect(fileLabel("")).toBe("recording");
  });

  it("reads the meter level from the newest measured peak only", () => {
    expect(inputLevel([])).toBeUndefined();
    expect(inputLevel([{ min: -0.1, max: 0.1 }, { min: -0.7, max: 0.3 }])).toBe(0.7);
    expect(inputLevel([{ min: -2, max: 2 }])).toBe(1);
    expect(inputLevel([{ min: Number.NaN, max: 0 }])).toBeUndefined();
  });
});
