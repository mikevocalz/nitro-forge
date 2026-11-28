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

// Renders the real mixer and MIDI components against mocked React Native
// hosts and drives their real PanResponder configs. Function components are
// expanded with per-path hook slots, so nested NoteBox/VelocityBar keep their
// gesture state between renders. Proves the preview/commit contracts, not
// React reconciliation, native gesture arbitration or screen-reader output.
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

function harness({ rtl = false, os = "ios", opaque = [] } = {}) {
  const slots = new Map();
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
      PanResponder: { create: config => ({ panHandlers: { __responder: config } }) },
    },
    "react-native-gesture-handler": {GestureDetector:"GestureDetector",usePanGesture:options=>options,useTapGesture:options=>options,useCompetingGestures:(...gestures)=>gestures},
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
    render: (Component, props, commit = true) => {
      path = "root"; cursor = 0;
      const tree=expand({ type: Component, props, key: undefined }, "root");
      if (commit) for (const effect of layouts.splice(0)) effect();
      return tree;
    },
    commitLayouts: () => { for (const effect of layouts.splice(0)) effect(); },
    flushEffects: () => { for (const fn of effects.splice(0)) fn(); },
    runTimers: () => { for (const t of timers.splice(0)) if (t.live) t.fn(); },
  };
}
// Separate user events run after the preceding host acknowledgement settles.
const settle = () => new Promise(resolve => setImmediate(resolve));
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

test("PanControl: one commit per drag, previews in between, cancel restores", () => {
  const h = harness();
  const { PanControl } = h.module("audio/PanControl.tsx");
  const previews = []; const commits = [];
  const props = { value: 0, label: "Bass", width: 114, onChange: v => previews.push(v), onCommit: v => commits.push(v) };
  const tree = h.render(PanControl, props);
  const track = byLabel(tree, "Bass pan");
  assert.equal(track.props.accessibilityRole, "adjustable");
  assert.equal(track.props.style.direction, "ltr", "stereo field is never mirrored");
  const g = track.props.__responder;
  assert.equal(g.onMoveShouldSetPanResponder({}, { dx: 2, dy: 0 }), false, "below slop");
  assert.equal(g.onMoveShouldSetPanResponder({}, { dx: 2, dy: 9 }), false, "vertical swipes scroll");
  g.onPanResponderGrant();
  g.onPanResponderMove({}, { dx: 12.5, dy: 0 });
  g.onPanResponderMove({}, { dx: 25, dy: 0 });
  assert.equal(commits.length, 0);
  assert.equal(byLabel(h.render(PanControl, props), "Bass pan").props.accessibilityValue.text, "50 percent right");
  g.onPanResponderRelease();
  assert.deepEqual(commits, [0.5]);
  assert.deepEqual(previews, [0.25, 0.5]);
  g.onPanResponderGrant();
  g.onPanResponderMove({}, { dx: -50, dy: 0 });
  g.onPanResponderTerminate();
  assert.deepEqual(commits, [0.5], "interrupted drag does not commit");
  assert.equal(previews.at(-1), 0, "cancel restores the committed value");
});

test("PanControl: arrows, Home and screen-reader actions step physically, RTL included", () => {
  const h = harness({ rtl: true });
  const { PanControl } = h.module("audio/PanControl.tsx");
  const commits = [];
  const tree = h.render(PanControl, { value: -0.2, label: "Pad", onCommit: v => commits.push(v) });
  const track = byLabel(tree, "Pad pan");
  track.props.onKeyDown(key("ArrowRight"));
  track.props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } });
  track.props.onKeyDown(key("Home"));
  assert.deepEqual(commits, [-0.15, -0.25, 0]);
  assert.deepEqual(plain(track.props.accessibilityActions.map(a => a.name)), ["increment", "decrement", "centre"]);
  const centre = byLabel(tree, "Centre Pad pan");
  assert.equal(centre.props.style.minHeight, 44);
});

test("SoloMuteButtons request the opposite state and show solo silencing", async () => {
  const h = harness();
  const { SoloMuteButtons } = h.module("audio/SoloMuteButtons.tsx");
  const calls = [];
  const tree = h.render(SoloMuteButtons, { label: "Drums", muted: false, solo: true, audibility: "audible",
    onMutedCommit: v => calls.push(["mute", v]), onSoloCommit: v => calls.push(["solo", v]) });
  const mute = byLabel(tree, "Mute Drums");
  const solo = byLabel(tree, "Solo Drums");
  assert.equal(mute.props.accessibilityRole, "togglebutton");
  assert.deepEqual(plain(solo.props.accessibilityState), { checked: true, disabled: false });
  mute.props.onPress(); await settle(); solo.props.onPress();
  assert.deepEqual(calls, [["mute", true], ["solo", false]]);
  const silenced = byLabel(h.render(SoloMuteButtons, { label: "Bass", muted: false, solo: false,
    audibility: "silenced-by-solo", onMutedCommit() {}, onSoloCommit() {} }), "Mute Bass");
  assert.equal(silenced.props.accessibilityHint, "Silent while another channel is soloed");
});

test("MixingConsole routes each strip's commits with its channel id", async () => {
  const h = harness();
  const { MixingConsole } = h.module("audio/MixingConsole.tsx");
  const calls = [];
  const channels = [
    { id: 1, name: "Kick", gain: 1, pan: 0, muted: false, solo: true },
    { id: 2, name: "Bass", gain: 0.5, pan: -0.5, muted: false, solo: false },
  ];
  const tree = h.render(MixingConsole, { channels,
    onGainCommit: (id, v) => calls.push(["gain", id, v]), onPanCommit: (id, v) => calls.push(["pan", id, v]),
    onMutedCommit: (id, v) => calls.push(["mute", id, v]), onSoloCommit: (id, v) => calls.push(["solo", id, v]) });
  byLabel(tree, "Mute Bass").props.onPress();
  await settle();
  byLabel(tree, "Bass pan").props.onKeyDown(key("ArrowRight"));
  await settle();
  find(tree, n => n.props?.accessibilityLabel === "Kick" && n.props.accessibilityRole === "adjustable")
    .props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } });
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [["mute", 2], ["pan", 2], ["gain", 1]]);
  assert.equal(calls[1][2], -0.45);
  assert.equal(byLabel(tree, "Mute Bass").props.accessibilityHint, "Silent while another channel is soloed",
    "Kick is soloed, so Bass is silenced");
  const empty = h.render(MixingConsole, { channels: [], onGainCommit() {}, onPanCommit() {}, onMutedCommit() {}, onSoloCommit() {} });
  assert.ok(find(empty, n => n.type === "Text" && [n.props.children].flat().includes("No tracks to mix")));
});

const notes = [
  { pitch: 60, velocity: 100, startTicks: 0, lengthTicks: 480 },
  { pitch: 64, velocity: 80, startTicks: 960, lengthTicks: 240 },
];
const rollProps = calls => ({
  notes, clipTicks: 3840, selectedIndex: 0,
  onNoteMove: (...a) => calls.push(["move", ...a]), onNoteResize: (...a) => calls.push(["resize", ...a]),
  onNoteAdd: (...a) => calls.push(["add", ...a]), onNoteRemove: (...a) => calls.push(["remove", ...a]),
  onSelect: i => calls.push(["select", i]),
});
const noteNode = (tree, label) => find(tree, n => n.props?.accessibilityLabel?.startsWith(label) && n.props.__responder);

test("MIDIPianoRoll: a body drag commits time and pitch together, once", () => {
  const h = harness();
  const { MIDIPianoRoll } = h.module("midi/MIDIPianoRoll.tsx");
  const calls = [];
  const props = rollProps(calls);
  let tree = h.render(MIDIPianoRoll, props);
  const g = noteNode(tree, "E4").props.__responder;
  g.onPanResponderGrant();
  g.onPanResponderMove({}, { dx: 48, dy: -44 });
  g.onPanResponderMove({}, { dx: 96, dy: -88 });
  tree = h.render(MIDIPianoRoll, props);
  const moving = noteNode(tree, "E4");
  assert.equal(moving.props.style.left, (960 + 960) * 0.1, "preview follows the drag");
  assert.deepEqual(calls, [["select", 1]], "no commit mid-drag");
  g.onPanResponderRelease();
  assert.deepEqual(calls.at(-1), ["move", 1, 1920, 66]);
  assert.equal(calls.filter(c => c[0] === "move").length, 1);
});

test("MIDIPianoRoll: end grip resizes; interrupted drags and taps commit nothing", () => {
  const h = harness();
  const { MIDIPianoRoll } = h.module("midi/MIDIPianoRoll.tsx");
  const calls = [];
  const props = rollProps(calls);
  const tree = h.render(MIDIPianoRoll, props);
  const note = noteNode(tree, "C4");
  const grip = find(note, n => n !== note && n.props?.__responder).props.__responder;
  grip.onPanResponderGrant();
  grip.onPanResponderMove({}, { dx: 48, dy: 0 });
  grip.onPanResponderRelease();
  assert.deepEqual(calls.at(-1), ["resize", 0, 960]);
  const body = note.props.__responder;
  body.onPanResponderGrant();
  body.onPanResponderMove({}, { dx: 200, dy: 0 });
  body.onPanResponderTerminate();
  body.onPanResponderGrant();
  body.onPanResponderRelease();
  assert.equal(calls.filter(c => c[0] === "move").length, 0);
  assert.equal(noteNode(h.render(MIDIPianoRoll, props), "C4").props.style.left, 0, "cancel restores");
});

test("MIDIPianoRoll: a note acknowledgement cancels an active gesture without replacing its body", () => {
  const h = harness();
  const { MIDIPianoRoll } = h.module("midi/MIDIPianoRoll.tsx");
  const calls = [];
  const props = rollProps(calls);
  const tree = h.render(MIDIPianoRoll, props);
  const gesture = noteNode(tree, "E4").props.__responder;
  gesture.onPanResponderGrant();
  gesture.onPanResponderMove({}, { dx: 96, dy: -88 });
  const changed = { ...props, notes: props.notes.map((note, index) => index === 1 ? { ...note, lengthTicks: 720 } : note) };
  h.render(MIDIPianoRoll, changed);
  gesture.onPanResponderMove({}, { dx: 144, dy: -44 });
  gesture.onPanResponderRelease();
  assert.deepEqual(calls, [["select", 1]], "a stale drag cannot commit against acknowledged notes");
  const restored = noteNode(h.render(MIDIPianoRoll, changed), "E4");
  assert.equal(restored.props.style.left, 96);
});

test("MIDIPianoRoll: an uncommitted note render cannot replace live responder data or callbacks", () => {
  const h = harness();
  const { MIDIPianoRoll } = h.module("midi/MIDIPianoRoll.tsx");
  const calls = [], replacementCalls = [];
  const props = rollProps(calls);
  const gesture = noteNode(h.render(MIDIPianoRoll, props), "E4").props.__responder;
  gesture.onPanResponderGrant();
  h.render(MIDIPianoRoll, { ...rollProps(replacementCalls),
    notes: props.notes.map((note, index) => index === 1 ? { ...note, startTicks: 1920, pitch: 70 } : note),
  }, false);
  gesture.onPanResponderMove({}, { dx: 48, dy: -44 });
  gesture.onPanResponderRelease();
  assert.deepEqual(calls, [["select", 1], ["move", 1, 1440, 65]], "the live gesture uses the last committed note and callback");
  assert.deepEqual(replacementCalls, []);
  h.commitLayouts();
  gesture.onPanResponderMove({}, { dx: 96, dy: -88 });
  gesture.onPanResponderRelease();
  assert.deepEqual(replacementCalls, [], "committing the replacement cancels the old gesture");
});

test("MIDIPianoRoll: keyboard and screen-reader actions edit the focused note", async () => {
  const h = harness({ os: "web" });
  const { MIDIPianoRoll } = h.module("midi/MIDIPianoRoll.tsx");
  const calls = [];
  const tree = h.render(MIDIPianoRoll, rollProps(calls));
  const note = noteNode(tree, "C4");
  assert.equal(note.props.accessibilityLabel, "C4, beat 1, 0.50 beats long, velocity 100");
  note.props.onKeyDown(key("ArrowUp"));
  await settle();
  note.props.onKeyDown(key("ArrowRight", { shiftKey: true }));
  await settle();
  note.props.onKeyDown(key("Delete"));
  await settle();
  note.props.onAccessibilityAction({ nativeEvent: { actionName: "moveLater" } });
  await settle();
  assert.deepEqual(calls, [["move", 0, 0, 61], ["resize", 0, 720], ["remove", 0], ["move", 0, 240, 60]]);
  assert.equal(note.props.style.direction, undefined);
  const grid = find(tree, n => n.type === "ScrollView" && n.props.horizontal);
  assert.equal(grid.props.style.direction, "ltr", "musical time is never mirrored");
});

test("MIDIPianoRoll: tapping an empty cell adds a one-step note there", () => {
  const h = harness();
  const { MIDIPianoRoll } = h.module("midi/MIDIPianoRoll.tsx");
  const calls = [];
  const tree = h.render(MIDIPianoRoll, rollProps(calls));
  const background = find(tree, n => n.type === "Pressable" && n.props.accessible === false);
  background.props.onPress({ nativeEvent: { locationX: 130, locationY: 50 } });
  assert.deepEqual(calls, [["add", 1200, 240, 71]]);
  const readOnly = h.render(MIDIPianoRoll, { ...rollProps([]), onNoteAdd: undefined });
  assert.equal(find(readOnly, n => n.type === "Pressable" && n.props.accessible === false).props.disabled, true);
});

test("MIDIVelocityLane: vertical drag commits once; keys step", async () => {
  const h = harness();
  const { MIDIVelocityLane } = h.module("midi/MIDIVelocityLane.tsx");
  const calls = [];
  const props = { notes, clipTicks: 3840, height: 127, onVelocityCommit: (i, v) => calls.push([i, v]) };
  const tree = h.render(MIDIVelocityLane, props);
  const bar = byLabel(tree, "Velocity of E4 note 2");
  assert.equal(bar.props.style.width, 44);
  const g = bar.props.__responder;
  assert.equal(g.onMoveShouldSetPanResponder({}, { dx: 10, dy: 3 }), false, "horizontal swipes scroll");
  g.onPanResponderGrant();
  g.onPanResponderMove({}, { dx: 0, dy: -20 });
  g.onPanResponderMove({}, { dx: 0, dy: -30 });
  assert.equal(byLabel(h.render(MIDIVelocityLane, props), "Velocity of E4 note 2").props.accessibilityValue.now, 110);
  g.onPanResponderRelease();
  assert.deepEqual(calls, [[1, 110]]);
  await settle();
  bar.props.onKeyDown(key("ArrowUp"));
  await settle();
  bar.props.onKeyDown(key("PageDown"));
  await settle();
  assert.deepEqual(calls.slice(1), [[1, 84], [1, 64]]);
});

test("StepSequencer: press toggles notes, long press accents", async () => {
  const h = harness();
  const { StepSequencer } = h.module("midi/StepSequencer.tsx");
  const calls = [];
  const seqNotes = [{ pitch: 36, velocity: 96, startTicks: 0, lengthTicks: 240 }];
  const tree = h.render(StepSequencer, { notes: seqNotes, clipTicks: 3840,
    lanes: [{ pitch: 36, name: "Kick" }, { pitch: 38, name: "Snare" }],
    onStepAdd: (...a) => calls.push(["add", ...a]), onStepRemove: i => calls.push(["remove", i]),
    onStepVelocity: (...a) => calls.push(["vel", ...a]) });
  const on = byLabel(tree, "Kick, step 1");
  assert.deepEqual(plain(on.props.accessibilityState), { checked: true, disabled: false });
  on.props.onPress();
  await settle();
  on.props.onLongPress();
  await settle();
  on.props.onKeyDown(key("a"));
  await settle();
  byLabel(tree, "Snare, step 5").props.onPress();
  assert.deepEqual(calls, [["remove", 0], ["vel", 0, 127], ["vel", 0, 127], ["add", 38, 960, 240, 96]]);
  assert.equal(byLabel(tree, "Snare, step 5").props.style.width, 44);
  assert.throws(() => h.render(StepSequencer, { notes: [], lanes: [], clipTicks: 960, steps: 16,
    onStepAdd() {}, onStepRemove() {}, onStepVelocity() {} }), /fit/);
});

test("TempoAndMetronome: tap tempo commits once after the taps stop", async () => {
  const h = harness({ opaque: ["PrecisionScrubber"] });
  const { TempoAndMetronome } = h.module("audio/TempoAndMetronome.tsx");
  const commits = []; const sigs = [];
  let clock = 0;
  const props = { bpm: 100, timeSignature: [4, 4], now: () => clock,
    onTempoCommit: v => commits.push(v), onTimeSignatureCommit: s => sigs.push(s) };
  let tree = h.render(TempoAndMetronome, props);
  for (const t of [0, 500, 1000]) { clock = t; byLabel(tree, "Tap tempo").props.onPress(); tree = h.render(TempoAndMetronome, props); }
  assert.equal(byLabel(tree, "Tap tempo").props.accessibilityValue.text, "120.0 BPM");
  h.flushEffects();
  assert.equal(commits.length, 0, "nothing commits while tapping");
  const scrubber = find(tree, n => n.type?.name === "PrecisionScrubber");
  assert.equal(scrubber.props.min, 20);
  assert.equal(scrubber.props.max, 400);
  scrubber.props.onCommit(130);
  assert.deepEqual(commits,[130],"tempo drag reaches the host through the ownership guard");
  await settle();
  h.runTimers();
  await settle();
  assert.deepEqual(commits, [130,120]);
  byLabel(tree, "More beats per bar").props.onPress();
  await settle();
  byLabel(tree, "Beat unit 8").props.onPress();
  await settle();
  byLabel(tree, "Beat unit 4").props.onPress();
  await settle();
  assert.deepEqual(plain(sigs), [[5, 4], [4, 8]], "re-choosing the current unit commits nothing");
  assert.equal(byLabel(tree, "Metronome"), undefined, "no switch without a click to switch");
  const withClick = h.render(TempoAndMetronome, { ...props, beat: 2, metronome: { enabled: false, onChange: v => sigs.push(v) } });
  byLabel(withClick, "Metronome").props.onPress();
  assert.equal(sigs.at(-1), true);
  assert.ok(byLabel(withClick, "Beat 3 of 4"));
});

test("WaveformLane: sideways drag scrolls the window once; a tap seeks inside it", () => {
  const h = harness();
  const { WaveformLane } = h.module("WaveformLane.tsx");
  const seeks = []; const ranges = [];
  const peaks = Array.from({ length: 400 }, () => ({ min: -0.5, max: 0.5 }));
  const props = { peaks, columns: 64, visibleRange: { start: 0.5, end: 0.75 },
    onSeekNormalized: v => seeks.push(v), onVisibleRangeCommit: r => ranges.push(r) };
  const tree = find(h.render(WaveformLane, props),n=>n.props?.__responder);
  tree.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
  const g = tree.props.__responder;
  g.onPanResponderGrant({ nativeEvent: { touches: [{}] } });
  g.onPanResponderMove({}, { dx: 3, dy: 0, numberActiveTouches: 1 });
  g.onPanResponderRelease({ nativeEvent: { locationX: 100 } });
  assert.deepEqual(seeks, [0.625], "a short move is a tap");
  g.onPanResponderGrant({ nativeEvent: { touches: [{}] } });
  g.onPanResponderMove({}, { dx: 40, dy: 0, numberActiveTouches: 1 });
  g.onPanResponderMove({}, { dx: 80, dy: 0, numberActiveTouches: 1 });
  g.onPanResponderRelease({ nativeEvent: { locationX: 100 } });
  assert.deepEqual(plain(ranges), [{ start: 0.4, end: 0.65 }]);
  assert.equal(seeks.length, 1, "a scroll does not seek");
  assert.equal(kids(tree).length, 64, "draws the requested columns of the window");
  assert.equal(tree.props.style.find(s => s && s.direction).direction, "ltr");
});
