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

interface HarnessOptions {
  /** Device lists returned by successive availableInputIds() calls. */
  readonly inputs?: string[][];
  /** resume() resolves but the recorder stays stopped (Audio API no-op). */
  readonly resumeIsNoop?: boolean;
  readonly resumeThrows?: boolean;
  readonly pauseThrows?: boolean;
  /** Hold driver.pause() until released, to overlap events. */
  readonly holdPause?: boolean;
}

/** One native recorder writing one file; counts files opened and finalized. */
function harness(options: HarnessOptions = {}) {
  const inputs = options.inputs ?? [["built-in", "headset-mic"]];
  const calls: string[] = [];
  let filesOpened = 0;
  let running = false;
  let finalized: Promise<string> | null = null;
  let inputReads = 0;
  let releasePause: () => void = () => undefined;
  const finalize = () => {
    if (!finalized) {
      calls.push("finalize");
      running = false;
      finalized = Promise.resolve(FILE);
    }
    return finalized;
  };
  const driver: RecordingDriver = {
    requestPermission: async () => true,
    configure: async () => { calls.push("configure"); },
    prepare: async () => { calls.push("prepare"); },
    record: async () => { calls.push("record"); filesOpened++; running = true; },
    pause: async () => {
      calls.push("pause");
      if (options.holdPause) await new Promise<void>((resolve) => { releasePause = resolve; });
      if (options.pauseThrows) throw new Error("pause rejected");
      running = false;
    },
    resume: async () => {
      calls.push("resume");
      if (options.resumeThrows) throw new Error("engine did not restart");
      if (!options.resumeIsNoop) running = true;
    },
    stop: finalize,
    release: async () => { calls.push("release"); },
    getStatus: () => ({ isRecording: running, durationMillis: 0 }),
  };
  const store = createRecordingStore();
  const controller = new ForgeRecordingController(driver, store);
  const events = new CaptureInterruptions(controller, {
    pauseCapture: async () => { calls.push("pauseCapture"); running = false; },
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
  const expectSaveable = async () => {
    expect(await controller.stop()).toBe(FILE);
    expect(store.getState().phase.kind).toBe("saved");
    expect(calls.filter((c) => c === "finalize")).toHaveLength(1);
  };
  return {
    calls, store, controller, events, startTake, expectSaveable,
    filesOpened: () => filesOpened,
    releasePause: () => releasePause(),
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

    await h.expectSaveable();
    expect(h.filesOpened()).toBe(1);
    expect(h.calls.at(-1)).toBe("release");
  });

  it("pauses capture, then finalizes the partial take, when the interruption ends without shouldResume", async () => {
    const h = harness();
    await h.startTake(900);
    await h.events.onInterruption({ type: "began", shouldResume: false });
    await h.events.onInterruption({ type: "ended", shouldResume: false });
    expect(h.calls).not.toContain("resume");
    // iOS restarts input on its own; capture is paused before the file closes.
    expect(h.calls.slice(-2)).toEqual(["pauseCapture", "finalize"]);
    expect(h.store.getState().phase).toEqual({
      kind: "interrupted", durationMs: 900, message: INTERRUPTION_ENDED_MESSAGE, cause: "ended",
    });
    await h.expectSaveable();
    expect(await h.controller.start()).toBe(true);
  });

  it("applies an ended event that arrives while began is still pausing", async () => {
    const h = harness({ holdPause: true });
    await h.startTake();
    const began = h.events.onInterruption({ type: "began", shouldResume: false });
    const ended = h.events.onInterruption({ type: "ended", shouldResume: true });
    for (let i = 0; i < 50 && !h.calls.includes("pause"); i++) await Promise.resolve();
    expect(h.calls).toContain("pause");
    h.releasePause();
    await began; await ended;
    expect(h.store.getState().phase.kind).toBe("recording");
    expect(h.calls).toContain("resume");
    expect(h.calls).not.toContain("finalize");
  });

  it("does not report recording when resume() silently did nothing", async () => {
    const h = harness({ resumeIsNoop: true });
    await h.startTake(1200);
    await h.events.onInterruption({ type: "began", shouldResume: false });
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    const phase = h.store.getState().phase;
    expect(phase.kind === "interrupted" && phase.cause).toBe("ended");
    expect(phase.kind === "interrupted" && phase.message).toContain("did not restart");
    await h.expectSaveable();
  });

  it("keeps a take saveable when resume throws", async () => {
    const h = harness({ resumeThrows: true });
    await h.startTake();
    await h.events.onInterruption({ type: "began", shouldResume: false });
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    const phase = h.store.getState().phase;
    expect(phase.kind === "interrupted" && phase.message).toContain("engine did not restart");
    await h.expectSaveable();
  });

  it("keeps a take saveable when pause throws", async () => {
    const h = harness({ pauseThrows: true });
    await h.startTake();
    await h.events.onInterruption({ type: "began", shouldResume: false });
    const phase = h.store.getState().phase;
    expect(phase.kind === "interrupted" && phase.cause).toBe("ended");
    expect(phase.kind === "interrupted" && phase.message).toContain("pause rejected");
    await h.expectSaveable();
  });

  it("ignores an ended event for a take that was not paused by the session", async () => {
    const h = harness();
    await h.startTake();
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    expect(h.calls).not.toContain("resume");
    expect(h.store.getState().phase.kind).toBe("recording");
  });

  it("finalizes a paused take when capture ends for good (app in background)", async () => {
    const h = harness();
    await h.startTake();
    await h.events.onInterruption({ type: "began", shouldResume: false });
    await h.events.finalize("Recording stopped when the app went to the background.");
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    expect(h.calls).not.toContain("resume");
    await h.expectSaveable();
  });
});

describe("route changes", () => {
  it("pauses when the headset mic the take could use is unplugged", async () => {
    const h = harness({ inputs: [["built-in", "headset-mic"], ["built-in"]] });
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
    await h.expectSaveable();
  });

  it("pauses after a resume when the headset was unplugged during the interruption", async () => {
    const h = harness({ inputs: [["built-in", "headset-mic"], ["built-in"]] });
    await h.startTake();
    await h.events.onInterruption({ type: "began", shouldResume: false });
    // The route change lands while the take is paused and is not acted on.
    await h.events.onRouteChange("OldDeviceUnavailable");
    await h.events.onInterruption({ type: "ended", shouldResume: true });
    const phase = h.store.getState().phase;
    expect(phase.kind === "interrupted" && phase.cause).toBe("input-lost");
    await h.expectSaveable();
  });

  it("keeps recording when only an output device went away", async () => {
    const h = harness({ inputs: [["built-in"], ["built-in"]] });
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
    const h = harness({ inputs: [["built-in"], []] });
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

  it("asks for notify-others in the capture options", async () => {
    const { p, calls } = port();
    configureCaptureSession(p);
    expect(calls).toEqual([
      ["setSystemOptions", CAPTURE_SESSION_OPTIONS],
      ["observeAudioInterruptions", true],
    ]);
    expect(CAPTURE_SESSION_OPTIONS.ios?.notifyOthersOnDeactivation).toBe(true);
    expect(CAPTURE_SESSION_OPTIONS.ios?.category).toBe("playAndRecord");
    await releaseCaptureSession(p, false);
  });

  it("deactivates the session, without switching category, when nothing plays", async () => {
    const { p, calls } = port();
    configureCaptureSession(p);
    calls.length = 0;
    await releaseCaptureSession(p, false);
    expect(calls).toEqual([
      ["observeAudioInterruptions", false],
      ["setAudioSessionActivity", false],
    ]);
  });

  it("hands the session to a playing preview, then deactivates when it ends", async () => {
    const { p, calls } = port();
    const preview = claimPlayback();
    configureCaptureSession(p);
    calls.length = 0;
    await releaseCaptureSession(p, true);
    expect(calls).toEqual([
      ["observeAudioInterruptions", false],
      ["setSystemOptions", PLAYBACK_SESSION_OPTIONS],
    ]);
    preview();
    await Promise.resolve();
    expect(calls.at(-1)).toEqual(["setAudioSessionActivity", false]);
  });

  it("does not deactivate after a preview if a new take owns the session", async () => {
    const { p, calls } = port();
    const preview = claimPlayback();
    configureCaptureSession(p);
    await releaseCaptureSession(p, true);
    configureCaptureSession(p); // next take started while the preview played
    calls.length = 0;
    preview();
    await Promise.resolve();
    expect(calls).toEqual([]);
    await releaseCaptureSession(p, false);
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
