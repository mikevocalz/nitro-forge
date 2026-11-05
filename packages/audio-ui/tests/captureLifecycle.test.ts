import { describe, expect, it } from "vitest";
import { ForgeRecordingController, createRecordingStore, type RecordingDriver } from "../src/recording";
import {
  CaptureInterruptions, INPUT_LOST_MESSAGE, INTERRUPTION_ENDED_MESSAGE, SESSION_INTERRUPTED_MESSAGE,
} from "../src/captureInterruptions";
import {
  CAPTURE_SESSION_OPTIONS, PLAYBACK_SESSION_OPTIONS, configureCaptureSession, releaseCaptureSession,
  type CaptureSessionPort,
} from "../src/captureSession";
import { claimPlayback, isPlaybackActive } from "../src/playbackOwnership";

const FILE = "file:///docs/Forge/take.wav";

/** One native recorder writing one file; counts files opened and closed. */
function harness(inputs: string[][] = [["built-in", "headset-mic"]]) {
  const calls: string[] = [];
  let filesOpened = 0;
  let finalized: Promise<string> | null = null;
  let inputReads = 0;
  let failResume = false;
  const finalize = () => {
    if (!finalized) {
      calls.push("finalize");
      finalized = Promise.resolve(FILE);
    }
    return finalized;
  };
  const driver: RecordingDriver = {
    requestPermission: async () => true,
    configure: async () => { calls.push("configure"); },
    prepare: async () => { calls.push("prepare"); },
    record: async () => { calls.push("record"); filesOpened++; },
    pause: async () => { calls.push("pause"); },
    resume: async () => {
      calls.push("resume");
      if (failResume) throw new Error("engine did not restart");
    },
    stop: finalize,
    release: async () => { calls.push("release"); },
    getStatus: () => ({ isRecording: true, durationMillis: 0 }),
  };
  const store = createRecordingStore();
  const controller = new ForgeRecordingController(driver, store);
  const events = new CaptureInterruptions(controller, {
    finalize,
    availableInputIds: async () => {
      const list = inputs[Math.min(inputReads, inputs.length - 1)]!;
      inputReads++;
      return list;
    },
  });
  const startTake = async (durationMs = 1500) => {
    expect(await controller.start()).toBe(true);
    await events.snapshotInputs();
    store.setState({ phase: { kind: "recording", durationMs } });
  };
  return {
    calls, store, controller, events, startTake,
    filesOpened: () => filesOpened,
    failNextResume: () => { failResume = true; },
  };
}

describe("OS interruptions keep the take", () => {
  it("pauses on began and resumes into the same file when the OS says shouldResume", async () => {
    const h = harness();
    await h.startTake(1500);
    await h.events.onInterruption({ type: "began", shouldResume: false });
    expect(h.store.getState().phase).toEqual({
      kind: "interrupted", durationMs: 1500, message: SESSION_INTERRUPTED_MESSAGE, cause: "session",
    });
    expect(h.calls).not.toContain("finalize");

    await h.events.onInterruption({ type: "ended", shouldResume: true });
    expect(h.store.getState().phase).toEqual({ kind: "recording", durationMs: 1500 });
    expect(h.calls.slice(-2)).toEqual(["pause", "resume"]);

    expect(await h.controller.stop()).toBe(FILE);
    expect(h.filesOpened()).toBe(1);
    expect(h.calls.filter((c) => c === "finalize")).toHaveLength(1);
    expect(h.calls.at(-1)).toBe("release");
  });

  it("finalizes the partial take when the interruption ends without shouldResume", async () => {
    const h = harness();
    await h.startTake(900);
    await h.events.onInterruption({ type: "began", shouldResume: false });
    await h.events.onInterruption({ type: "ended", shouldResume: false });
    expect(h.calls).not.toContain("resume");
    expect(h.calls).toContain("finalize");
    expect(h.store.getState().phase).toEqual({
      kind: "interrupted", durationMs: 900, message: INTERRUPTION_ENDED_MESSAGE, cause: "ended",
    });
    // Recoverable: the same take is saved, then a new one can start.
    expect(await h.controller.stop()).toBe(FILE);
    expect(h.store.getState().phase).toEqual({ kind: "saved", uri: FILE, durationMs: 900 });
    expect(await h.controller.start()).toBe(true);
  });

  it("ignores an ended event for a take that was not paused by the session", async () => {
    const h = harness();
    await h.startTake();
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    expect(h.calls).not.toContain("resume");
    expect(h.store.getState().phase.kind).toBe("recording");
  });

  it("shows a failed resume as an error and does not finalize twice", async () => {
    const h = harness();
    await h.startTake();
    await h.events.onInterruption({ type: "began", shouldResume: false });
    h.failNextResume();
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    const phase = h.store.getState().phase;
    expect(phase.kind).toBe("error");
    expect(phase.kind === "error" && phase.message).toContain("engine did not restart");
    expect(h.calls.filter((c) => c === "finalize")).toHaveLength(1);
    expect(h.calls.at(-1)).toBe("release");
  });
});

describe("route changes", () => {
  it("pauses when the headset mic the take could use is unplugged", async () => {
    const h = harness([["built-in", "headset-mic"], ["built-in"]]);
    await h.startTake(2000);
    await h.events.onRouteChange("OldDeviceUnavailable");
    expect(h.store.getState().phase).toEqual({
      kind: "interrupted", durationMs: 2000, message: INPUT_LOST_MESSAGE, cause: "input-lost",
    });
    expect(h.calls.at(-1)).toBe("pause");
    expect(h.calls).not.toContain("finalize");
    // A lost input never auto-resumes on an interruption-ended event.
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    expect(h.calls).not.toContain("resume");
    expect(await h.controller.stop()).toBe(FILE);
  });

  it("keeps recording when only an output device went away", async () => {
    const h = harness([["built-in"], ["built-in"]]);
    await h.startTake();
    await h.events.onRouteChange("OldDeviceUnavailable");
    expect(h.store.getState().phase.kind).toBe("recording");
    expect(h.calls).not.toContain("pause");
  });

  it("pauses when the inputs cannot be compared", async () => {
    const h = harness();
    // No snapshot: the take started before the device list could be read.
    expect(await h.controller.start()).toBe(true);
    await h.events.onRouteChange("OldDeviceUnavailable");
    expect(h.store.getState().phase.kind).toBe("interrupted");
  });

  it("ignores other route reasons", async () => {
    const h = harness([["built-in"], []]);
    await h.startTake();
    for (const reason of ["NewDeviceAvailable", "CategoryChange", "Override"]) {
      await h.events.onRouteChange(reason);
    }
    expect(h.store.getState().phase.kind).toBe("recording");
  });
});

describe("capture session release", () => {
  function port() {
    const calls: unknown[][] = [];
    const p: CaptureSessionPort = {
      setSystemOptions: (options) => { calls.push(["setSystemOptions", options]); },
      setAudioSessionActivity: async (enabled) => { calls.push(["setAudioSessionActivity", enabled]); },
      observeAudioInterruptions: (enabled) => { calls.push(["observeAudioInterruptions", enabled]); },
    };
    return { p, calls };
  }

  it("asks for notify-others in the capture options", () => {
    const { p, calls } = port();
    configureCaptureSession(p);
    expect(calls).toEqual([
      ["setSystemOptions", CAPTURE_SESSION_OPTIONS],
      ["observeAudioInterruptions", true],
    ]);
    expect(CAPTURE_SESSION_OPTIONS.ios?.notifyOthersOnDeactivation).toBe(true);
    expect(CAPTURE_SESSION_OPTIONS.ios?.category).toBe("playAndRecord");
  });

  it("deactivates the session, without switching category, when nothing plays", async () => {
    const { p, calls } = port();
    await releaseCaptureSession(p, false);
    expect(calls).toEqual([
      ["observeAudioInterruptions", false],
      ["setAudioSessionActivity", false],
    ]);
  });

  it("hands the session back to playback only while the app plays", async () => {
    const { p, calls } = port();
    await releaseCaptureSession(p, true);
    expect(calls).toEqual([
      ["observeAudioInterruptions", false],
      ["setSystemOptions", PLAYBACK_SESSION_OPTIONS],
    ]);
  });

  it("tracks preview playback claims idempotently", () => {
    expect(isPlaybackActive()).toBe(false);
    const a = claimPlayback();
    const b = claimPlayback();
    a(); a();
    expect(isPlaybackActive()).toBe(true);
    b();
    expect(isPlaybackActive()).toBe(false);
  });
});
