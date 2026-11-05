import { describe, it, expect } from "vitest";
import {
  ForgeRecordingController,
  createRecordingStore,
  dbfsToPeak,
  pushMeterLevel,
  type RecordingDriver,
  type RecordingStatus,
} from "../src/recording";

function mockRecorder(permission = true) {
  const calls: string[] = [];
  let isRecording = false;
  let permissionResult = permission;
  const status: RecordingStatus = { isRecording: true, durationMillis: 500, metering: -6 };
  const driver: RecordingDriver = {
    requestPermission: async () => {
      calls.push("requestPermission");
      return permissionResult;
    },
    configure: async () => { calls.push("configure"); },
    prepare: async () => { calls.push("prepare"); },
    record: () => { calls.push("record"); isRecording = true; },
    stop: async () => {
      calls.push("stop");
      isRecording = false;
      return "file:///recorded-audio.m4a";
    },
    release: async () => { calls.push("release"); },
    getStatus: () => ({ ...status, isRecording }),
  };
  return { driver, calls, setPermission: (yes: boolean) => { permissionResult = yes; } };
}

describe("real native recording controller lifecycle", () => {
  it("requests permission and saves an actual URI through the driver", async () => {
    const { driver, calls } = mockRecorder();
    const store = createRecordingStore();
    const controller = new ForgeRecordingController(driver, store);
    expect(await controller.start()).toBe(true);
    expect(store.getState().phase.kind).toBe("recording");
    controller.observe(driver.getStatus());
    expect(store.getState().levelHistory.length).toBe(1);
    expect(await controller.stop()).toBe("file:///recorded-audio.m4a");
    expect(store.getState().phase).toEqual({
      kind: "saved", uri: "file:///recorded-audio.m4a", durationMs: 500,
    });
    expect(calls).toEqual(["requestPermission", "configure", "prepare", "record", "stop", "release"]);
    await controller.dispose();
    expect(calls.filter((item) => item === "stop")).toHaveLength(1);
  });

  it("does not prepare or record when permission is denied", async () => {
    const { driver, calls } = mockRecorder(false);
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    expect(await controller.start()).toBe(false);
    expect(controller.store.getState().phase.kind).toBe("permission-denied");
    expect(calls).toEqual(["requestPermission"]);
  });

  it("prevents duplicate start and stop operations", async () => {
    const { driver } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    const first = controller.start();
    expect(await controller.start()).toBe(false);
    expect(await first).toBe(true);
    await controller.stop();
    await expect(controller.stop()).rejects.toThrow("not recording");
  });

  it("stops a recorder when its host unmounts", async () => {
    const { driver, calls } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    await controller.dispose();
    expect(calls.filter((item) => item === "stop")).toHaveLength(1);
    await expect(controller.start()).rejects.toThrow("disposed");
  });

  it("preserves an explicit error from the native backend", async () => {
    const mock = mockRecorder();
    const failingDriver: RecordingDriver = {
      ...mock.driver,
      prepare: async () => { throw new Error("No available microphone"); },
    };
    const controller = new ForgeRecordingController(failingDriver, createRecordingStore());
    await expect(controller.start()).rejects.toThrow("No available microphone");
    expect(controller.store.getState().phase).toEqual({
      kind: "error", message: "No available microphone",
    });
  });

  it("does not fabricate waveform data from missing meter samples", async () => {
    const { driver } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    controller.observe({ isRecording: true, durationMillis: 1000 });
    expect(controller.store.getState().levelHistory).toEqual([]);
    controller.observe({ isRecording: true, durationMillis: 1200, metering: Number.NaN });
    expect(controller.store.getState().levelHistory).toEqual([]);
    controller.observe({ isRecording: true, durationMillis: 1300, metering: -12 });
    expect(controller.store.getState().levelHistory).toHaveLength(1);
  });

  it("shows actual native interruption as a failure, not a green success", async () => {
    const { driver } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    controller.observe({ isRecording: false, durationMillis: 1500, mediaServicesDidReset: true });
    expect(controller.store.getState().phase.kind).toBe("error");
    await controller.dispose();
  });
});

describe("host lifecycle re-runs and interruptions", () => {
  it("survives an effect cleanup followed by a re-attach (StrictMode / Fast Refresh)", async () => {
    const { driver, calls } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    controller.attach();
    await controller.detach();
    controller.attach();
    expect(await controller.start()).toBe(true);
    await controller.detach();
    expect(calls.filter((item) => item === "stop")).toHaveLength(1);
    expect(calls.at(-1)).toBe("release");
    await expect(controller.start()).rejects.toThrow("detached");
  });

  it("surfaces a recorder the OS stopped as an interrupted phase", async () => {
    const { driver } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    controller.observe({ isRecording: true, durationMillis: 900, metering: -10 });
    controller.observe({ isRecording: false, durationMillis: 900 });
    expect(controller.store.getState().phase).toEqual({
      kind: "interrupted", durationMs: 900,
      message: "Recording stopped by the system (call, route change or another app).",
    });
  });

  it("surfaces a status read failure instead of freezing the timer", async () => {
    const { driver } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    await controller.reportStatusError(new Error("recorder released"));
    expect(controller.store.getState().phase).toEqual({
      kind: "error", message: "recorder released",
    });
  });

  it("stops native capture and restores the session when a live failure aborts", async () => {
    const { driver, calls } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    await controller.abort("Audio stream failed");
    expect(calls.slice(-2)).toEqual(["stop", "release"]);
    expect(controller.store.getState().phase).toEqual({
      kind: "error", message: "Audio stream failed",
    });
    expect(await controller.start()).toBe(true);
  });

  it("stops the recorder when media services reset", async () => {
    const { driver, calls } = mockRecorder();
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    controller.observe({ isRecording: true, durationMillis: 10, mediaServicesDidReset: true });
    await controller.settled();
    expect(calls.slice(-2)).toEqual(["stop", "release"]);
    expect(controller.store.getState().phase.kind).toBe("error");
  });

  it("restores the audio session after a failed start", async () => {
    const mock = mockRecorder();
    const controller = new ForgeRecordingController({
      ...mock.driver,
      prepare: async () => { throw new Error("busy"); },
    }, createRecordingStore());
    await expect(controller.start()).rejects.toThrow("busy");
    expect(mock.calls.at(-1)).toBe("release");
  });

  it("does not touch the audio session when permission is denied", async () => {
    const { driver, calls } = mockRecorder(false);
    const controller = new ForgeRecordingController(driver, createRecordingStore());
    await controller.start();
    await controller.dispose();
    expect(calls).not.toContain("release");
  });
});

describe("real meter history math", () => {
  it("converts dBFS to linear amplitude", () => {
    expect(dbfsToPeak(0)).toEqual({ min: -1, max: 1 });
    expect(dbfsToPeak(-20).max).toBeCloseTo(0.1);
    expect(dbfsToPeak(-1000).max).toBeLessThan(1e-40);
    expect(dbfsToPeak(8).max).toBe(1);
    expect(() => dbfsToPeak(Number.NaN)).toThrow();
  });
  it("bounds history without losing the latest sample", () => {
    let history: ReturnType<typeof dbfsToPeak>[] = [];
    for (let i = 0; i < 50; i++) history = pushMeterLevel(history, -30 + i, 16);
    expect(history).toHaveLength(16);
    expect(history.at(-1)).toEqual(dbfsToPeak(19));
    expect(pushMeterLevel(history, -5, 1)).toEqual([dbfsToPeak(-5)]);
    expect(() => pushMeterLevel(history, -5, 0)).toThrow();
  });
});
