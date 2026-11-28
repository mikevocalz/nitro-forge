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

// Harness copied from mixer-midi.render.test.mjs (with an AccessibilityInfo
// mock). Drives the velocity lane's line tool, ramp, the channel picker and
// the roll's channel labels through their real props and PanResponder configs. Function components are
// expanded with per-path hook slots, so nested NoteBox/VelocityBar keep their
// gesture state between renders. Proves the preview/commit contracts, not
// React reconciliation, native gesture arbitration or screen-reader output.
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

function harness({ rtl = false, os = "ios", opaque = [] } = {}) {
  const slots = new Map();
  const announced = [];
  let path = "root";
  let cursor = 0;
  const effects = [];
  const layouts = [];
  const timers = [];
  const slot = init => {
    const k = path + "#" + cursor++;
    if (!slots.has(k)) slots.set(k, init());
    return slots.get(k);
  };
  const element = (type, props, key) => ({ type, props: props ?? {}, key });
  const store = init => {
    let value = typeof init === "function" ? init() : init;
    return {
      getState: () => value,
      setState: next => { value = { ...value, ...(typeof next === "function" ? next(value) : next) }; },
    };
  };
  const mocks = {
    react: {
      useRef: v => slot(() => ({ current: v })),
      createContext: value => ({_value:value}),
      useContext: context => context._value,
      useLayoutEffect: (fn, deps) => {
        const s = slot(() => ({ deps: undefined, cleanup: undefined }));
        if (!s.deps || !deps || deps.some((d, i) => d !== s.deps[i])) {
          s.deps = deps;
          layouts.push(() => { s.cleanup?.(); s.cleanup=fn(); });
        }
      },
      useEffect: (fn, deps) => {
        const s = slot(() => ({ deps: undefined }));
        if (!s.deps || !deps || deps.some((d, i) => d !== s.deps[i])) { s.deps = deps; effects.push(fn); }
      },
      useSyncExternalStore: (_sub, get) => get(),
      useMemo: fn => slot(() => ({ v: fn() })).v,
      useCallback: fn => fn,
      useId: () => "id-" + path,
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-native": {
      View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput",
      I18nManager: { isRTL: rtl },
      Platform: { OS: os },
      AccessibilityInfo: { announceForAccessibility: t => announced.push(t) },
      PanResponder: { create: config => ({ panHandlers: { __responder: config } }) },
    },
    "zustand/vanilla": { createStore: store },
    zustand: { useStore: (s, selector) => selector(s.getState()) },
  };
  const cache = new Map();
  const context = {
    setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimeout: t => { if (t) t.live = false; },
    Date, AbortController,
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
    }).outputText;
    runInNewContext(code, { ...context, exports,
      require: name => mocks[name] ?? load(resolveSpecifier(file, name)) }, { filename: file });
    return exports;
  }
  function expand(node, at) {
    if (Array.isArray(node)) return node.map((n, i) => expand(n, at + "/" + i));
    if (!node || typeof node !== "object") return node;
    // Components with their own tests (PrecisionScrubber) stay unexpanded.
    if (typeof node.type === "function" && opaque.includes(node.type.name)) return node;
    if (typeof node.type === "function") {
      const saved = [path, cursor];
      path = at + ":" + node.type.name + (node.key ?? "");
      cursor = 0;
      const out = node.type(node.props);
      const here = path;
      [path, cursor] = saved;
      return expand(out, here);
    }
    const children = node.props.children;
    return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children, at + "/" + String(node.type)) } };
  }
  return {
    module: rel => load(resolve(src, rel)),
    render: (Component, props) => {
      path = "root"; cursor = 0;
      const tree=expand({ type: Component, props, key: undefined }, "root");
      for (const commit of layouts.splice(0)) commit();
      return tree;
    },
    announced,
    flushEffects: () => { for (const fn of effects.splice(0)) fn(); },
    runTimers: () => { for (const t of timers.splice(0)) if (t.live) t.fn(); },
  };
}
const kids = n => [n?.props?.children].flat(Infinity).filter(x => x && typeof x === "object");
function findAll(n, pred, out = []) {
  if (!n || typeof n !== "object") return out;
  if (pred(n)) out.push(n);
  for (const c of kids(n)) findAll(c, pred, out);
  return out;
}
const find = (n, pred) => findAll(n, pred)[0];
const byLabel = (tree, label) => find(tree, n => n.props?.accessibilityLabel === label);
// Values built inside the vm realm have foreign prototypes; compare as data.
const plain = v => JSON.parse(JSON.stringify(v));
const key = (k, extra = {}) => ({ nativeEvent: { key: k, ...extra }, preventDefault() {} });

const notes = [
  { pitch: 60, velocity: 100, startTicks: 0, lengthTicks: 480 },
  { pitch: 64, velocity: 80, startTicks: 960, lengthTicks: 480 },
  { pitch: 67, velocity: 110, startTicks: 1920, lengthTicks: 480 },
];
// height 127 makes 1 pt = 1 velocity step; bars at x = 0, 96, 192 (no inset, no scroll).
const laneProps = extra => ({ notes, clipTicks: 3840, height: 127, scrollX: 0, onVelocityCommit() {}, ...extra });
const drawLayer = tree => find(tree, n => n.props?.__responder && n.props.accessible === false);
const at = (x, y) => ({ nativeEvent: { locationX: x, locationY: y } });

test("velocity lane: no batch callback means no tool row and no draw layer", () => {
  const h = harness();
  const { MIDIVelocityLane } = h.module("midi/MIDIVelocityLane.tsx");
  const tree = h.render(MIDIVelocityLane, laneProps({ tool: "line" }));
  assert.equal(byLabel(tree, "Velocity tool"), undefined);
  assert.equal(drawLayer(tree), undefined);
});

test("velocity lane: tool row is a radiogroup; uncontrolled tool switches and reports", () => {
  const h = harness();
  const { MIDIVelocityLane } = h.module("midi/MIDIVelocityLane.tsx");
  const tools = [];
  const props = laneProps({ onVelocitiesCommit() {}, onToolChange: t => tools.push(t) });
  let tree = h.render(MIDIVelocityLane, props);
  assert.equal(byLabel(tree, "Velocity tool").props.accessibilityRole, "radiogroup");
  const line = byLabel(tree, "Line");
  assert.equal(line.props.accessibilityRole, "radio");
  assert.ok(line.props.style.minHeight >= 44 && line.props.style.minWidth >= 44);
  assert.equal(drawLayer(tree), undefined, "bars tool by default");
  line.props.onPress();
  tree = h.render(MIDIVelocityLane, props);
  assert.deepEqual(tools, ["line"]);
  assert.equal(byLabel(tree, "Line").props.accessibilityState.checked, true);
  assert.ok(drawLayer(tree));
});

test("velocity lane: a line previews, then commits the batch once on release", () => {
  const h = harness();
  const { MIDIVelocityLane } = h.module("midi/MIDIVelocityLane.tsx");
  const batches = []; const singles = [];
  const props = laneProps({ tool: "line", onVelocitiesCommit: c => batches.push(c), onVelocityCommit: (...a) => singles.push(a) });
  let tree = h.render(MIDIVelocityLane, props);
  const g = drawLayer(tree).props.__responder;
  g.onPanResponderGrant(at(0, 0));
  g.onPanResponderMove({}, { dx: 96, dy: 63 });
  g.onPanResponderMove({}, { dx: 192, dy: 127 });
  assert.equal(batches.length, 0, "nothing commits while drawing");
  tree = h.render(MIDIVelocityLane, props);
  assert.equal(byLabel(tree, "Velocity of E4 note 2").props.accessibilityValue.now, 64, "bar previews the line");
  // Bars ignore drags while the line tool is on.
  const bar = byLabel(tree, "Velocity of E4 note 2").props.__responder;
  assert.equal(bar.onMoveShouldSetPanResponder({}, { dx: 0, dy: 20 }), false);
  g.onPanResponderRelease();
  assert.deepEqual(plain(batches), [[{ index: 0, velocity: 127 }, { index: 1, velocity: 64 }, { index: 2, velocity: 0 }]]);
  assert.deepEqual(singles, []);
  assert.deepEqual(h.announced, ["3 velocities changed"]);
  tree = h.render(MIDIVelocityLane, props);
  assert.equal(byLabel(tree, "Velocity of E4 note 2").props.accessibilityValue.now, 80, "committed value returns until props change");
});

test("velocity lane: terminate cancels; a no-op line commits nothing", () => {
  const h = harness();
  const { MIDIVelocityLane } = h.module("midi/MIDIVelocityLane.tsx");
  const batches = [];
  const props = laneProps({ tool: "line", onVelocitiesCommit: c => batches.push(c) });
  const g = drawLayer(h.render(MIDIVelocityLane, props)).props.__responder;
  g.onPanResponderGrant(at(0, 0));
  g.onPanResponderMove({}, { dx: 192, dy: 127 });
  assert.equal(g.onPanResponderTerminationRequest(), false, "keeps the gesture while drawing");
  g.onPanResponderTerminate();
  g.onPanResponderRelease();
  assert.equal(batches.length, 0, "interrupted line does not commit");
  const tree = h.render(MIDIVelocityLane, props);
  assert.equal(byLabel(tree, "Velocity of E4 note 2").props.accessibilityValue.now, 80);
  // A line drawn exactly at E4's current height over E4 only.
  g.onPanResponderGrant(at(90, 47));
  g.onPanResponderMove({}, { dx: 12, dy: 0 });
  g.onPanResponderRelease();
  assert.equal(batches.length, 0);
});

test("velocity lane: ramp from the selected note commits one batch", () => {
  const h = harness();
  const { MIDIVelocityLane } = h.module("midi/MIDIVelocityLane.tsx");
  const batches = [];
  const props = laneProps({ tool: "line", selectedIndex: 0, onVelocitiesCommit: c => batches.push(c) });
  let tree = h.render(MIDIVelocityLane, props);
  const count = byLabel(tree, "Ramp length in notes");
  assert.equal(count.props.accessibilityRole, "adjustable");
  assert.equal(count.props.accessibilityValue.text, "3 notes", "clamped to the notes that follow");
  const end = byLabel(tree, "Ramp end velocity");
  end.props.onKeyDown(key("Home"));
  tree = h.render(MIDIVelocityLane, props);
  assert.equal(byLabel(tree, "Ramp end velocity").props.accessibilityValue.now, 0);
  byLabel(tree, "Ramp").props.onPress();
  assert.deepEqual(plain(batches), [[{ index: 1, velocity: 50 }, { index: 2, velocity: 0 }]]);
  // No selection: a hint instead of the ramp controls.
  const none = h.render(MIDIVelocityLane, laneProps({ tool: "line", onVelocitiesCommit() {} }));
  assert.equal(byLabel(none, "Ramp"), undefined);
  assert.ok(find(none, n => n.type === "Text" && [n.props.children].flat().join("").includes("select a note to ramp")));
});

test("velocity lane: disabled hides the draw layer; empty clip says so", () => {
  const h = harness();
  const { MIDIVelocityLane } = h.module("midi/MIDIVelocityLane.tsx");
  assert.equal(drawLayer(h.render(MIDIVelocityLane, laneProps({ tool: "line", disabled: true, onVelocitiesCommit() {} }))), undefined);
  const empty = h.render(MIDIVelocityLane, laneProps({ notes: [], tool: "line", onVelocitiesCommit() {} }));
  assert.equal(drawLayer(empty), undefined);
  assert.ok(find(empty, n => n.type === "Text" && [n.props.children].flat().join("").startsWith("No notes yet")));
});

test("channel picker: slider reads 1-16, commits once per key, clamps, disabled", () => {
  const h = harness();
  const { MidiChannelPicker } = h.module("midi/MidiChannelPicker.tsx");
  const calls = [];
  const tree = h.render(MidiChannelPicker, { channel: 2, onChannelCommit: c => calls.push(c) });
  const slider = byLabel(tree, "MIDI channel");
  assert.equal(slider.props.accessibilityRole, "adjustable");
  assert.deepEqual(plain(slider.props.accessibilityValue), { min: 0, max: 15, now: 2, text: "Channel 3" });
  slider.props.onKeyDown(key("ArrowUp"));
  slider.props.onKeyDown(key("ArrowLeft"));
  slider.props.onKeyDown(key("End"));
  slider.props.onKeyDown(key("Home"));
  slider.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
  assert.deepEqual(calls, [3, 1, 15, 0, 3]);
  const buttons = findAll(tree, n => n.type === "Pressable");
  assert.equal(buttons.length, 2);
  for (const b of buttons) assert.equal(b.props.style.width, 44);
  buttons[1].props.onPress();
  assert.deepEqual(calls.at(-1), 3);
  const top = h.render(MidiChannelPicker, { channel: 15, onChannelCommit: c => calls.push(c) });
  byLabel(top, "MIDI channel").props.onKeyDown(key("ArrowUp"));
  assert.equal(calls.length, 6, "no commit past channel 16");
  const off = h.render(MidiChannelPicker, { channel: 4, disabled: true, onChannelCommit: c => calls.push(c) });
  byLabel(off, "MIDI channel").props.onKeyDown(key("ArrowUp"));
  assert.equal(calls.length, 6, "disabled commits nothing");
  assert.throws(() => h.render(MidiChannelPicker, { channel: 16, onChannelCommit() {} }), /0\.\.15/);
});

test("piano roll: channel in labels only with several channels; picker for the selected note", () => {
  const h = harness();
  const { MIDIPianoRoll } = h.module("midi/MIDIPianoRoll.tsx");
  const base = { clipTicks: 3840, onNoteMove() {}, onNoteResize() {} };
  const one = h.render(MIDIPianoRoll, { ...base, notes });
  assert.ok(byLabel(one, "C4, beat 1, 0.50 beats long, velocity 100"));
  const mixed = [notes[0], { ...notes[1], channel: 9 }];
  const calls = [];
  const several = h.render(MIDIPianoRoll, { ...base, notes: mixed, selectedIndex: 1, onNoteChannel: (...a) => calls.push(a) });
  assert.ok(byLabel(several, "C4, beat 1, 0.50 beats long, velocity 100, channel 1"));
  assert.ok(byLabel(several, "E4, beat 2, 0.50 beats long, velocity 80, channel 10"));
  const picker = byLabel(several, "MIDI channel of E4 note 2");
  assert.equal(picker.props.accessibilityValue.text, "Channel 10");
  picker.props.onKeyDown(key("ArrowDown"));
  assert.deepEqual(calls, [[1, 8]]);
  const unselected = h.render(MIDIPianoRoll, { ...base, notes: mixed, onNoteChannel() {} });
  assert.equal(find(unselected, n => String(n.props?.accessibilityLabel ?? "").startsWith("MIDI channel")), undefined);
  const noProp = h.render(MIDIPianoRoll, { ...base, notes: mixed, selectedIndex: 0 });
  assert.equal(find(noProp, n => String(n.props?.accessibilityLabel ?? "").startsWith("MIDI channel")), undefined);
});
