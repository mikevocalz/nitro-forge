import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "@typescript/typescript6";
import { createRequire } from "node:module";
// Moved controls load relative to their own file; NYC-Tron primitives load from the
// installed @nyc-tron/ui release (its dist JS), as Forge consumes them.
const requireFromPackage = createRequire(new URL("../../package.json", import.meta.url));
const resolveSpecifier = (from, name) => name.startsWith("@nyc-tron/") ? requireFromPackage.resolve(name) : resolve(dirname(from), name);

// Runs the real components with mocked RN hosts and expands function
// components into host elements. Proves wiring and a11y props, not native
// reconciliation, layout or screen-reader output on a device.
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
function harness({ os = "ios", withOptions = true } = {}) {
  const announcements = [];
  const slots = new Map();
  const effects = [];
  let path = "root", cursor = 0;
  const slot = init => {
    const key = path + "#" + cursor++;
    if (!slots.has(key)) slots.set(key, init());
    return slots.get(key);
  };
  const effect = (fn, deps) => {
    const state = slot(() => ({ deps: undefined, cleanup: undefined }));
    if (!state.deps || !deps || deps.some((value, i) => !Object.is(value, state.deps[i]))) {
      state.deps = deps;
      effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
    }
  };
  const element = (type, props, key) => ({ type, props: props ?? {}, key });
  const mocks = {
    react: {
      useRef: value => slot(() => ({ current: value })),
      useEffect: effect,
      useLayoutEffect: effect,
      useState: value => [value, () => {}],
      // Read the real waveform's gesture-store snapshot. This harness tests
      // parent wiring; subscription/reconciliation is covered by browser tests.
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    },
    "zustand/vanilla": { createStore: init => {
      let value = init();
      return { getState: () => value,
        setState: next => { value = { ...value, ...(typeof next === "function" ? next(value) : next) }; } };
    } },
    zustand: { useStore: (store, selector) => selector(store.getState()) },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-native": {
      View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", ScrollView: "ScrollView",
      ActivityIndicator: "ActivityIndicator",
      Platform: { OS: os },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      // react-native-web has only the plain announce; withOptions: false models it.
      AccessibilityInfo: withOptions
        ? { announceForAccessibilityWithOptions: (text, options) => announcements.push({ text, options }) }
        : { announceForAccessibility: text => announcements.push({ text, options: { priority: "low" } }) },
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(code, { exports, JSON, Math, Date, Number, String, RangeError, Array, Object, AbortController,
      require: name => mocks[name] ?? load(resolveSpecifier(path, name)) }, { filename: path });
    return exports;
  }
  const expand = (node, at) => {
    if (Array.isArray(node)) return node.flatMap((child, i) => expand(child, at + "/" + i));
    if (!node || typeof node !== "object") return node === null || node === undefined || node === false ? [] : [node];
    if (typeof node.type === "function") {
      const saved = [path, cursor];
      path = at + ":" + node.type.name + (node.key ?? ""); cursor = 0;
      const out = node.type(node.props), here = path;
      [path, cursor] = saved;
      return expand(out, here);
    }
    const children = node.props.children === undefined ? [] : expand(node.props.children, at + "/" + node.type);
    return [{ type: node.type, props: { ...node.props, children } }];
  };
  const render = el => {
    const tree = expand(el, "root");
    for (const commit of effects.splice(0)) commit();
    return tree;
  };
  const all = (tree, pred) => tree.filter(n => n && typeof n === "object").flatMap(n => [...(pred(n) ? [n] : []), ...all(n.props.children ?? [], pred)]);
  const text = n => (n.props.children ?? []).map(c => typeof c === "string" || typeof c === "number" ? String(c) : text(c)).join("");
  const buttons = tree => all(tree, n => n.type === "Pressable" && n.props.accessibilityRole === "button");
  const button = (tree, label) => buttons(tree).find(b => text(b).includes(label) || b.props.accessibilityLabel === label);
  return { load, render, all, text, buttons, button, announcements, reset: () => { for (const state of slots.values()) state.cleanup?.(); slots.clear(); } };
}

test("DevicePairingDialog wires every state to the right callback", () => {
  const h = harness();
  const { DevicePairingDialog } = h.load(resolve(src, "devices/DevicePairingDialog.tsx"));
  const calls = [];
  const cb = name => (...args) => calls.push([name, ...args]);
  const base = { visible: true, onScan: cb("scan"), onSelect: cb("select"), onCancel: cb("cancel"),
    onRetry: cb("retry"), onDone: cb("done"), deviceNoun: "pen" };
  const pen = { id: "p1", name: "Stylus", signalDbm: -70, detail: "Model S" };
  const at = state => h.render({ type: DevicePairingDialog, props: { ...base, state } });

  let tree = at({ kind: "idle" });
  h.button(tree, "Search for devices").props.onPress();
  tree = at({ kind: "scanning" });
  assert.ok(h.all(tree, n => n.type === "ActivityIndicator").length, "scanning shows progress");
  h.button(tree, "Stop searching").props.onPress();
  tree = at({ kind: "found", devices: [pen] });
  const row = h.buttons(tree).find(b => b.props.accessibilityLabel.startsWith("Connect to Stylus"));
  assert.equal(row.props.accessibilityLabel, "Connect to Stylus, Model S · Fair signal");
  assert.equal(row.props.accessibilityHint, undefined, "detail is content, not a hint");
  row.props.onPress();
  tree = at({ kind: "found", devices: [] });
  assert.match(h.text(h.all(tree, n => n.props.accessibilityLiveRegion === "polite")[0]), /No pen found/);
  h.button(tree, "Search again").props.onPress();
  tree = at({ kind: "connecting", device: pen });
  h.button(tree, "Cancel").props.onPress();
  tree = at({ kind: "connected", device: pen });
  h.button(tree, "Done").props.onPress();
  const modal = tree[0];
  modal.props.onRequestClose();
  tree = at({ kind: "error", code: "connection-failed" });
  h.button(tree, "Try again").props.onPress();
  h.all(tree, n => n.type === "Modal")[0].props.onRequestClose();
  assert.deepEqual(calls, [
    ["scan"], ["cancel"], ["select", "p1"], ["scan"], ["cancel"], ["done"], ["done"], ["retry"], ["cancel"],
  ]);
  // 44pt: every Pressable in the dialog uses the md Button (min-h-11) or a min-h-14 row.
  for (const state of [{ kind: "idle" }, { kind: "found", devices: [pen] }, { kind: "error", code: "radio-off" }]) {
    for (const b of h.buttons(at(state))) assert.match(b.props.className, /min-h-(11|14)/);
  }
});

test("permission errors offer Settings only when the app can open it", () => {
  const h = harness();
  const { DevicePairingDialog } = h.load(resolve(src, "devices/DevicePairingDialog.tsx"));
  const noop = () => {};
  const props = { visible: true, onScan: noop, onSelect: noop, onCancel: noop, onRetry: noop, onDone: noop,
    state: { kind: "error", code: "permission-denied" } };
  assert.equal(h.button(h.render({ type: DevicePairingDialog, props }), "Open Settings"), undefined);
  let opened = 0;
  const tree = h.render({ type: DevicePairingDialog, props: { ...props, onOpenSettings: () => opened++ } });
  h.button(tree, "Open Settings").props.onPress();
  assert.equal(opened, 1);
  assert.ok(h.button(tree, "Ask again"));
});

test("RecordingTrack shows the meter only while recording and maps actions", () => {
  const h = harness();
  const { RecordingTrack } = h.load(resolve(src, "audio/RecordingTrack.tsx"));
  const calls = [];
  const props = { peaks: [{ min: -0.5, max: 0.5 }], level: 0.3, onStart: () => calls.push("start"),
    onStop: () => calls.push("stop"), onRetry: () => calls.push("retry") };
  const at = state => { h.reset(); return h.render({ type: RecordingTrack, props: { ...props, state } }); };
  let tree = at({ kind: "idle" });
  assert.equal(h.all(tree, n => n.props.accessibilityRole === "progressbar").length, 0);
  h.button(tree, "Start recording").props.onPress();
  tree = at({ kind: "recording", durationMs: 61_000 });
  const meter = h.all(tree, n => n.props.accessibilityRole === "progressbar")[0];
  assert.equal(meter.props.accessibilityValue.text, "Input level good");
  assert.ok(h.all(tree, n => n.props.accessibilityLabel === "Elapsed 1 minute 1 second").length);
  assert.ok(h.all(tree, n => n.props.accessibilityLabel === "Live input waveform").length, "lane comes from WaveformLane");
  h.button(tree, "Stop and save").props.onPress();
  h.button(at({ kind: "interrupted", durationMs: 5, message: "Call started" }), "Save what was recorded").props.onPress();
  h.button(at({ kind: "no-input-device" }), "Try again").props.onPress();
  h.button(at({ kind: "error", message: "Stream failed" }), "Try again").props.onPress();
  assert.equal(h.buttons(at({ kind: "preparing" })).length, 0, "busy state has no action");
  assert.deepEqual(calls, ["start", "stop", "stop", "retry", "retry"]);
  assert.ok(h.announcements.length >= 1 && h.announcements.every(a => a.options.priority === "low"));
});

test("AudioPreview maps play, stop and retry and reports position", () => {
  const h = harness();
  const { AudioPreview } = h.load(resolve(src, "audio/AudioPreview.tsx"));
  const calls = [];
  const props = { onPlay: () => calls.push("play"), onStop: () => calls.push("stop"), peaks: [] };
  const at = state => h.render({ type: AudioPreview, props: { ...props, state } });
  assert.equal(h.buttons(at({ kind: "empty" })).length, 0);
  h.button(at({ kind: "ready", durationMs: 2000 }), "Play recording").props.onPress();
  const playing = at({ kind: "playing", durationMs: 2000, positionMs: 1000 });
  assert.ok(h.all(playing, n => n.props.accessibilityLabel === "1 second of 2 seconds").length);
  h.button(playing, "Stop").props.onPress();
  h.button(at({ kind: "error", message: "Codec" }), "Try again").props.onPress();
  assert.deepEqual(calls, ["play", "stop", "play"]);
});

test("LevelMeter announces on react-native-web, which lacks the options variant", () => {
  const h = harness({ os: "web", withOptions: false });
  const { LevelMeter } = h.load(resolve(src, "audio/LevelMeter.tsx"));
  assert.doesNotThrow(() => h.render({ type: LevelMeter, props: { level: 1, announce: true } }));
  assert.deepEqual(h.announcements.map(a => a.text), ["Input clipping"]);
});

test("a peak held at full scale stays inside the clipped track", () => {
  const h = harness();
  const { LevelMeter } = h.load(resolve(src, "audio/LevelMeter.tsx"));
  const tree = h.render({ type: LevelMeter, props: { level: 1, peakHold: 1 } });
  const marker = h.all(tree, n => n.props.style?.width === 2)[0];
  assert.equal(marker.props.style.left, "100.0%");
  assert.equal(marker.props.style.marginLeft, -2, "pulled back by its own width");
});

test("disabled never traps a live take", () => {
  const h = harness();
  const { RecordingTrack } = h.load(resolve(src, "audio/RecordingTrack.tsx"));
  const noop = () => {};
  const at = state => { h.reset(); return h.render({ type: RecordingTrack, props: { peaks: [], disabled: true, onStart: noop, onStop: noop, state } }); };
  assert.equal(h.button(at({ kind: "recording", durationMs: 1 }), "Stop and save").props.disabled, false);
  assert.equal(h.button(at({ kind: "interrupted", durationMs: 1, message: "x" }), "Save what was recorded").props.disabled, false);
  assert.equal(h.button(at({ kind: "idle" }), "Start recording").props.disabled, true);
});

test("AudioPreview tolerates a slightly negative playhead", () => {
  const h = harness();
  const { AudioPreview } = h.load(resolve(src, "audio/AudioPreview.tsx"));
  const noop = () => {};
  assert.doesNotThrow(() => h.render({ type: AudioPreview,
    props: { onPlay: noop, onStop: noop, state: { kind: "playing", durationMs: 5000, positionMs: -12 } } }));
});

test("phase changes are announced on iOS only, where live regions are ignored", () => {
  for (const [os, expected] of [["ios", ["Recording"]], ["android", []], ["web", []]]) {
    const h = harness({ os });
    const { RecordingTrack } = h.load(resolve(src, "audio/RecordingTrack.tsx"));
    const props = { peaks: [], onStart: () => {}, onStop: () => {} };
    h.render({ type: RecordingTrack, props: { ...props, state: { kind: "idle" } } });
    h.render({ type: RecordingTrack, props: { ...props, state: { kind: "recording", durationMs: 0 } } });
    assert.deepEqual(h.announcements.map(a => a.text), expected, os);
  }
});

test("DevicePairingDialog splits stop from close and never closes a linked device through stop", () => {
  const h = harness();
  const { DevicePairingDialog } = h.load(resolve(src, "devices/DevicePairingDialog.tsx"));
  const calls = [];
  const cb = name => () => calls.push(name);
  const pen = { id: "p1", name: "Stylus" };
  const base = { visible: true, onScan: cb("scan"), onSelect: cb("select"), onStopSearch: cb("stop"),
    onClose: cb("close"), onRetry: cb("retry"), onDone: cb("done"), deviceNoun: "pen", testID: "pair" };
  const at = (state, extra = {}) => h.render({ type: DevicePairingDialog, props: { ...base, ...extra, state } });
  const modal = tree => h.all(tree, n => n.type === "Modal")[0];
  const closeButton = tree => h.buttons(tree).find(b => b.props.testID === "pair-close");

  let tree = at({ kind: "scanning" });
  h.button(tree, "Stop searching").props.onPress();
  assert.equal(closeButton(tree).props.accessibilityLabel, "Close");
  closeButton(tree).props.onPress();
  modal(tree).props.onRequestClose();
  tree = at({ kind: "connecting", device: pen });
  h.button(tree, "Cancel").props.onPress();
  tree = at({ kind: "awaiting-input", device: pen });
  assert.equal(h.button(tree, "Done"), undefined, "no Done before input is verified");
  closeButton(tree).props.onPress();
  tree = at({ kind: "connected", device: pen });
  closeButton(tree).props.onPress();
  assert.deepEqual(calls, ["stop", "close", "close", "stop", "close", "done"]);

  // Legacy onCancel: still stops and closes unlinked dialogs, but a linked
  // dialog closes through onDone so a cancel that disconnects is never hit.
  calls.length = 0;
  const legacy = { ...base, onStopSearch: undefined, onClose: undefined, onCancel: cb("cancel") };
  const old = state => h.render({ type: DevicePairingDialog, props: { ...legacy, state } });
  tree = old({ kind: "scanning" });
  h.button(tree, "Stop searching").props.onPress();
  assert.equal(closeButton(tree).props.accessibilityLabel, "Cancel and close");
  closeButton(tree).props.onPress();
  tree = old({ kind: "awaiting-input", device: pen });
  assert.equal(closeButton(tree).props.accessibilityLabel, "Close");
  closeButton(tree).props.onPress();
  modal(tree).props.onRequestClose();
  assert.deepEqual(calls, ["cancel", "cancel", "done", "done"]);

  // With no stop callback at all the stop button is disabled, not dead.
  tree = h.render({ type: DevicePairingDialog, props: { ...base, onStopSearch: undefined, state: { kind: "scanning" } } });
  assert.equal(h.button(tree, "Stop searching").props.disabled, true);
});

test("DevicePairingDialog shows the intro only before a search and lists system-pairing steps", () => {
  const h = harness();
  const { DevicePairingDialog } = h.load(resolve(src, "devices/DevicePairingDialog.tsx"));
  const noop = () => {};
  const intro = "Search asks for Bluetooth access so the app can find your pen.";
  const props = { visible: true, onScan: noop, onSelect: noop, onStopSearch: noop, onClose: noop, onRetry: noop,
    onDone: noop, intro, testID: "pair" };
  const byId = (tree, id) => h.all(tree, n => n.props.testID === id)[0];
  assert.equal(h.text(byId(h.render({ type: DevicePairingDialog, props: { ...props, state: { kind: "idle" } } }), "pair-intro")), intro);
  assert.equal(byId(h.render({ type: DevicePairingDialog, props: { ...props, state: { kind: "scanning" } } }), "pair-intro"), undefined);

  let opened = 0;
  const steps = ["Open Settings, then Bluetooth.", "Select Stylus and tap Pair."];
  const tree = h.render({ type: DevicePairingDialog, props: { ...props, onOpenSettings: () => opened++,
    state: { kind: "system-pairing", steps } } });
  const items = h.all(tree, n => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Step "));
  assert.deepEqual(items.map(n => n.props.accessibilityLabel), ["Step 1 of 2: " + steps[0], "Step 2 of 2: " + steps[1]]);
  assert.equal(h.all(tree, n => n.type === "ActivityIndicator").length, 0, "no spinner while the OS owns pairing");
  h.button(tree, "Open Settings").props.onPress();
  assert.equal(opened, 1);
  for (const b of h.buttons(tree)) assert.match(b.props.className, /min-h-(11|14)/);
});

test("new pairing states reach the live region and the iOS announcement", () => {
  const h = harness({ os: "ios" });
  const { DevicePairingDialog } = h.load(resolve(src, "devices/DevicePairingDialog.tsx"));
  const noop = () => {};
  const pen = { id: "p1", name: "Stylus" };
  const props = { visible: true, onScan: noop, onSelect: noop, onStopSearch: noop, onClose: noop, onRetry: noop, onDone: noop, deviceNoun: "pen" };
  const live = tree => h.text(h.all(tree, n => n.props.accessibilityLiveRegion === "polite")[0]);
  const phases = [];
  const art = (phase, state) => { phases.push(phase + ":" + state.kind); return null; };
  let tree = h.render({ type: DevicePairingDialog, props: { ...props, renderStatusArt: art, state: { kind: "connecting", device: pen } } });
  tree = h.render({ type: DevicePairingDialog, props: { ...props, renderStatusArt: art, state: { kind: "system-pairing", steps: ["Pair in Settings."] } } });
  assert.match(live(tree), /in Settings/);
  tree = h.render({ type: DevicePairingDialog, props: { ...props, renderStatusArt: art, state: { kind: "awaiting-input", device: pen } } });
  assert.match(live(tree), /Linked to Stylus/);
  tree = h.render({ type: DevicePairingDialog, props: { ...props, renderStatusArt: art, state: { kind: "connected", device: pen } } });
  const spoken = h.announcements.map(a => a.text);
  assert.equal(spoken.length, 3);
  assert.match(spoken[0], /in Settings/);
  assert.match(spoken[1], /^Linked to Stylus/);
  assert.equal(spoken[2], "Connected to Stylus.");
  assert.deepEqual(phases, ["connecting:connecting", "connecting:system-pairing", "connecting:awaiting-input", "connected:connected"],
    "art never shows connected before the link is verified");
});
