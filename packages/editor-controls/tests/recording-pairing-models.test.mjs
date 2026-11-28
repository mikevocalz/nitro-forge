import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  levelToDb, meterFill, meterBand, createMeterAnnouncer, METER_BAND_LABELS,
} from "../src/audio/level-meter.ts";
import { presentRecording, formatElapsed, spokenElapsed } from "../src/audio/recording-model.ts";
import { presentPreview } from "../src/audio/preview-model.ts";
import { presentPairing, signalLabel } from "../src/devices/pairing-model.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("meter maps linear peaks to dBFS, fill and bands", () => {
  assert.equal(levelToDb(1), 0);
  assert.equal(levelToDb(0), Number.NEGATIVE_INFINITY);
  assert.equal(meterFill(0), 0);
  assert.equal(meterFill(1), 1);
  assert.equal(meterFill(2), 1, "over-range input clamps to full scale");
  assert.ok(Math.abs(meterFill(0.1) - 2 / 3) < 1e-9, "-20 dBFS is two thirds of a 60 dB scale");
  assert.equal(meterBand(0), "silent");
  assert.equal(meterBand(0.01), "low");
  assert.equal(meterBand(0.2), "good");
  assert.equal(meterBand(0.6), "hot");
  assert.equal(meterBand(1), "clipping");
  assert.throws(() => meterFill(Number.NaN), /finite/);
  assert.throws(() => meterFill(-0.1), />= 0/);
});

test("meter announcer is throttled and never repeats a band", () => {
  const say = createMeterAnnouncer({ minIntervalMs: 2000 });
  assert.equal(say(0.2, 0), METER_BAND_LABELS.good);
  assert.equal(say(0.2, 100), undefined, "same band is silent");
  assert.equal(say(0.6, 500), undefined, "band change inside the interval is held");
  assert.equal(say(0.2, 2500), undefined, "flicker back to the spoken band stays silent");
  assert.equal(say(0.6, 2600), METER_BAND_LABELS.hot);
  assert.equal(say(1, 2700), METER_BAND_LABELS.clipping, "clipping skips the interval");
  // 60 updates/s for 10 s across alternating bands produce at most 1 + 10/2 announcements.
  const spam = createMeterAnnouncer();
  let spoken = 0;
  for (let frame = 0; frame < 600; frame++) if (spam(frame % 2 ? 0.2 : 0.6, frame * 16.7)) spoken++;
  assert.ok(spoken <= 6, "spoke " + spoken + " times");
  assert.throws(() => createMeterAnnouncer({ minIntervalMs: -1 }), /minIntervalMs/);
});

test("every recording state has honest copy and a defined action", () => {
  const states = [
    { kind: "idle" }, { kind: "requesting-permission" }, { kind: "permission-denied" },
    { kind: "no-input-device" }, { kind: "preparing" }, { kind: "recording", durationMs: 1200 },
    { kind: "interrupted", durationMs: 4000, message: "A call interrupted recording" },
    { kind: "stopping", durationMs: 4000 }, { kind: "saved", durationMs: 4000 },
    { kind: "error", message: "Input stream failed" },
  ];
  for (const s of states) {
    const v = presentRecording(s, false);
    assert.ok(v.status.length > 0, s.kind);
    assert.equal(v.isBusy, v.action === undefined, s.kind + ": busy states and only busy states have no action");
  }
  assert.equal(presentRecording({ kind: "permission-denied" }, true).action.kind, "open-settings");
  assert.equal(presentRecording({ kind: "permission-denied" }, false).action.kind, "retry");
  assert.equal(presentRecording({ kind: "no-input-device" }, false).action.kind, "retry");
  assert.equal(presentRecording({ kind: "error", message: "x" }, false).isProblem, true);
  assert.equal(presentRecording({ kind: "interrupted", durationMs: 1, message: "m" }, false).action.kind, "save-interrupted");
  assert.equal(presentRecording({ kind: "saved", durationMs: 1, label: "take 3" }, false).status, "Saved take 3");
  assert.equal(formatElapsed(83_450), "1:23.4");
  assert.equal(formatElapsed(0), "0:00.0");
  assert.equal(spokenElapsed(61_000), "1 minute 1 second");
  assert.throws(() => formatElapsed(-1), /durationMs/);
});

test("preview states cover empty, loading, playback and error", () => {
  assert.equal(presentPreview({ kind: "empty" }).action, undefined);
  assert.equal(presentPreview({ kind: "ready", durationMs: 1000 }).action.kind, "play");
  assert.equal(presentPreview({ kind: "loading" }).action.kind, "stop");
  assert.equal(presentPreview({ kind: "playing", durationMs: 1000, positionMs: 250 }).progress, 0.25);
  assert.equal(presentPreview({ kind: "playing", durationMs: 0, positionMs: 250 }).progress, 0);
  assert.equal(presentPreview({ kind: "error", message: "Codec unsupported" }).action.kind, "retry");
});

test("pairing dialog covers all six states plus no-device and error recovery", () => {
  const pen = { id: "p1", name: "Stylus", signalDbm: -55 };
  const kinds = {
    idle: presentPairing({ kind: "idle" }, "pen", false),
    scanning: presentPairing({ kind: "scanning" }, "pen", false),
    found: presentPairing({ kind: "found", devices: [pen] }, "pen", false),
    none: presentPairing({ kind: "found", devices: [] }, "pen", false),
    connecting: presentPairing({ kind: "connecting", device: pen }, "pen", false),
    connected: presentPairing({ kind: "connected", device: pen }, "pen", false),
  };
  assert.equal(kinds.idle.primary.kind, "scan");
  assert.equal(kinds.scanning.secondary.kind, "cancel");
  assert.deepEqual(kinds.found.devices, [pen]);
  assert.equal(kinds.none.isProblem, false, "nothing found is guidance, not an error");
  assert.equal(kinds.none.primary.kind, "rescan");
  assert.match(kinds.none.body, /No pen found/);
  assert.equal(kinds.connecting.secondary.kind, "cancel");
  assert.equal(kinds.connected.primary.kind, "done");
  for (const code of ["permission-denied", "radio-off", "connection-failed", "unknown"]) {
    const v = presentPairing({ kind: "error", code }, "pen", false);
    assert.equal(v.isProblem, true);
    assert.ok([v.primary?.kind, v.secondary?.kind].includes("retry"), code + " can retry");
  }
  assert.equal(presentPairing({ kind: "error", code: "permission-denied" }, "pen", true).primary.kind, "open-settings");
  assert.equal(presentPairing({ kind: "error", code: "unknown", message: "GATT 133" }, "pen", false).body, "GATT 133");
  assert.equal(signalLabel(-50), "Strong signal");
  assert.equal(signalLabel(-90), "Weak signal");
});

test("system-pairing and awaiting-input states: host steps, Settings, never Connected", () => {
  const pen = { id: "p1", name: "Stylus" };
  const steps = ["Open Settings > Bluetooth.", "Select Stylus and tap Pair."];
  const os = presentPairing({ kind: "system-pairing", steps }, "pen", true);
  assert.deepEqual(os.steps, steps);
  assert.equal(os.primary.kind, "open-settings");
  assert.equal(os.isBusy, false, "the OS owns progress, so no spinner");
  assert.equal(os.isLinked, false);
  assert.match(os.body, /in Settings/);
  const osNoSettings = presentPairing({ kind: "system-pairing", steps: [] }, "pen", false);
  assert.equal(osNoSettings.primary, undefined, "no dead Open Settings button");
  assert.equal(osNoSettings.steps, undefined, "an empty step list hides the list");
  assert.equal(presentPairing({ kind: "system-pairing", steps, message: "Pair in visionOS Settings." }, "pen", true).body, "Pair in visionOS Settings.");

  const waiting = presentPairing({ kind: "awaiting-input", device: pen }, "pen", false);
  assert.equal(waiting.isLinked, true);
  assert.equal(waiting.isBusy, true);
  assert.doesNotMatch(waiting.body, /connected/i, "linked but unverified never reads as Connected");
  assert.match(waiting.body, /Linked to Stylus/);
  assert.equal(waiting.primary, undefined);
  assert.notEqual(waiting.secondary?.kind, "done");
  assert.equal(presentPairing({ kind: "awaiting-input", device: pen, message: "Tap the screen with your pen." }, "pen", false).body, "Tap the screen with your pen.");

  assert.equal(presentPairing({ kind: "connected", device: pen }, "pen", false).isLinked, true);
  for (const state of [{ kind: "idle" }, { kind: "scanning" }, { kind: "connecting", device: pen }, { kind: "error", code: "unknown" }]) {
    assert.equal(presentPairing(state, "pen", false).isLinked, false, state.kind);
  }
});

test("recording and pairing views stay presentational", () => {
  const files = [
    "audio/RecordingTrack.tsx", "audio/LevelMeter.tsx", "audio/AudioPreview.tsx",
    "audio/level-meter.ts", "audio/recording-model.ts", "audio/preview-model.ts",
    "devices/DevicePairingDialog.tsx", "devices/pairing-model.ts",
  ];
  const banned = /from\s+["'](?:@nitro-forge\/|react-native-audio-api|expo-audio|expo-av|react-native-ble|@config-plugins|zustand|@acme\/)/;
  for (const file of files) {
    const text = readFileSync(resolve(root, "src", file), "utf8");
    assert.ok(!banned.test(text), file + " imports capture, BLE, store or engine code");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(text), file + " hardcodes a hex color");
  }
  const track = readFileSync(resolve(root, "src/audio/RecordingTrack.tsx"), "utf8");
  assert.match(track, /from "\.\.\/WaveformLane\.tsx"/, "lane rendering reuses WaveformLane");
  // The root-barrel check ("./components/forge" stays out of src/index.ts) stays in
  // NYC-Tron's contracts.test.mjs; this package has no root barrel.
});
