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

// Expands the real LevelFader and its ownership hooks against mocked RN hosts.
// Vertical controls use RNGH callbacks; horizontal controls use PanResponder.
// These checks cover callback wiring and rendered props, not native gesture
// arbitration, React reconciliation or screen-reader output on a device.
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
function harness({ rtl = false, os = "ios" } = {}) {
  const slots = new Map();
  const layouts = [];
  let path = "root", cursor = 0;
  let responder, pan, tap;
  const slot = init => {
    const key = path + "#" + cursor++;
    if (!slots.has(key)) slots.set(key, init());
    return slots.get(key);
  };
  const effect = (fn, deps) => {
    const state = slot(() => ({ deps: undefined, cleanup: undefined }));
    if (!state.deps || !deps || deps.some((value, i) => !Object.is(value, state.deps[i]))) {
      state.deps = deps;
      layouts.push(() => { state.cleanup?.(); state.cleanup = fn(); });
    }
  };
  const element = (type, props, key) => ({ type, props: props ?? {}, key });
  const mocks = {
    react: { useRef: value => slot(() => ({ current: value })), useLayoutEffect: effect, useEffect: effect },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": {
      View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable",
      I18nManager: { isRTL: rtl },
      Platform: { OS: os },
      PanResponder: { create: config => { responder = config; return { panHandlers: {} }; } },
    },
    "react-native-gesture-handler": {
      GestureDetector: "GestureDetector",
      usePanGesture: config => { pan = config; return { kind: "pan", config }; },
      useTapGesture: config => { tap = config; return { kind: "tap", config }; },
      useCompetingGestures: (...gestures) => gestures,
    },
    "zustand/vanilla": { createStore: init => {
      let value = init();
      return { getState: () => value,
        setState: next => { value = { ...value, ...(typeof next === "function" ? next(value) : next) }; } };
    } },
    zustand: { useStore: (store, selector) => selector(store.getState()) },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
    }).outputText;
    cache.set(file, exports);
    runInNewContext(code, { exports, AbortController,
      require: name => mocks[name] ?? load(resolveSpecifier(file, name)) }, { filename: file });
    return exports;
  }
  function expand(node, at) {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, at + "/" + i));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const saved = [path, cursor];
      path = at + ":" + node.type.name + (node.key ?? ""); cursor = 0;
      const out = node.type(node.props), here = path;
      [path, cursor] = saved;
      return expand(out, here);
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, at + "/" + node.type) } };
  }
  const { LevelFader } = load(resolve(src, "audio/LevelFader.tsx"));
  const level = load(resolve(src, "audio/level.ts"));
  const render = props => {
    const tree = expand(element(LevelFader, props), "root");
    for (const commit of layouts.splice(0)) commit();
    return tree;
  };
  return { level, render, renderHorizontal: props => render({ ...props, orientation: "horizontal" }),
    responder: () => responder, pan: () => pan, tap: () => tap };
}
const kids = n => [n?.props?.children].flat(Infinity).filter(x => x && typeof x === "object");
function find(n, pred) {
  if (pred(n)) return n;
  for (const c of kids(n)) { const r = find(c, pred); if (r) return r; }
}
const track = tree => find(tree, n => n.props?.accessibilityRole === "adjustable");

let nextGestureId=0;
function responderGesture(){
 const stateID=++nextGestureId;let last={dx:0,dy:0};
 return {state:(delta={})=>{last={...last,...delta};return{stateID,x0:100,y0:100,moveX:100+last.dx,moveY:100+last.dy,vx:0,vy:0,numberActiveTouches:1,...last};},
  event:phase=>({nativeEvent:{touches:phase==='release'||phase==='cancel'?[]:[{identifier:stateID,pageX:100,pageY:100}],changedTouches:[{identifier:stateID,pageX:100,pageY:100}]}})};
}

test("horizontal drag previews on every distinct value and commits once on release", () => {
  const h = harness(); const previews = []; const commits = [];
  const props = { value: 1, label: "Vocals", length: 116,
    onChange: g => previews.push(g), onCommit: g => commits.push(g) };
  h.renderHorizontal(props);
  const g = h.responder(), gesture = responderGesture();
  g.onPanResponderGrant(gesture.event('grant'),gesture.state());
  g.onPanResponderMove(gesture.event('move'),gesture.state({ dx: -50, dy: 0 }));
  g.onPanResponderMove(gesture.event('move'),gesture.state({ dx: -50, dy: 0 }));
  g.onPanResponderMove(gesture.event('move'),gesture.state({ dx: -100, dy: 0 }));
  assert.equal(previews.length, 2, "repeat positions are not re-emitted");
  assert.equal(commits.length, 0, "no commit mid-drag");
  const tree = h.renderHorizontal(props);
  assert.equal(track(tree).props.accessibilityValue.now, 0);
  g.onPanResponderRelease(gesture.event('release'),gesture.state());
  assert.deepEqual(commits, [0]);
});
test("horizontal drag over 25 pt of 100 pt travel moves 15 dB", () => {
  const h = harness(); const commits = [];
  h.renderHorizontal({ value: h.level.dbToGain(-30), label: "Bass", length: 116, onCommit: g => commits.push(g) });
  const g = h.responder(), gesture = responderGesture();
  g.onPanResponderGrant(gesture.event('grant'),gesture.state());
  g.onPanResponderMove(gesture.event('move'),gesture.state({ dx: 25, dy: 0 }));
  g.onPanResponderRelease(gesture.event('release'),gesture.state());
  assert.equal(commits.length, 1);
  assert.ok(Math.abs(h.level.gainToDb(commits[0]) + 15) < 1e-9);
});
test("cancelled horizontal drag restores the committed value without committing", () => {
  const h = harness(); const previews = []; const commits = [];
  const props = { value: 0.5, label: "Pad", onChange: g => previews.push(g), onCommit: g => commits.push(g) };
  h.renderHorizontal(props);
  const g = h.responder(), gesture = responderGesture();
  g.onPanResponderGrant(gesture.event('grant'),gesture.state());
  g.onPanResponderMove(gesture.event('move'),gesture.state({ dx: 40, dy: 0 }));
  g.onPanResponderTerminate(gesture.event('cancel'),gesture.state());
  assert.equal(commits.length, 0);
  assert.equal(previews.at(-1), 0.5);
  assert.equal(track(h.renderHorizontal(props)).props.accessibilityValue.text, "-6.0 dB");
});
test("unchanged horizontal release does not commit", () => {
  const h = harness(); const commits = [];
  h.renderHorizontal({ value: 1, label: "Keys", onCommit: g => commits.push(g) });
  const g = h.responder(), gesture = responderGesture();
  g.onPanResponderGrant(gesture.event('grant'),gesture.state());
  g.onPanResponderMove(gesture.event('move'),gesture.state({ dx: 30, dy: 0 }));
  g.onPanResponderRelease(gesture.event('release'),gesture.state());
  assert.equal(commits.length, 0, "already at the top of travel");
});
test("horizontal screen-reader actions step in dB and commit each step", async () => {
  const h = harness(); const commits = []; const previews = []; const order=[];
  const tree = h.renderHorizontal({ value: h.level.dbToGain(-6), label: "Drums",
    onChange: g => {previews.push(g);order.push("preview");}, onCommit: g => {commits.push(g);order.push("commit");} });
  const t = track(tree);
  assert.equal(t.props.accessibilityLabel, "Drums");
  assert.equal(t.props.accessibilityActions.map(a => a.name).join(), "increment,decrement");
  assert.equal(t.props.accessibilityValue.text, "-6.0 dB");
  t.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
  await Promise.resolve();
  t.props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } });
  assert.equal(commits.length, 2);
  assert.deepEqual(previews, commits);
  assert.deepEqual(order,["preview","commit","preview","commit"],"steps emit no cancellation restoration");
  assert.ok(Math.abs(h.level.gainToDb(commits[0]) + 5) < 1e-9);
  assert.ok(Math.abs(h.level.gainToDb(commits[1]) + 7) < 1e-9);
});
test("disabled horizontal fader refuses gestures and steps", () => {
  const h = harness(); const commits = [];
  const tree = h.renderHorizontal({ value: 0.5, label: "FX", disabled: true, onCommit: g => commits.push(g) });
  assert.equal(h.responder().onMoveShouldSetPanResponder({}, responderGesture().state({ dx: 0, dy: 30 })), false);
  track(tree).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
  assert.equal(track(tree).props.accessibilityState.disabled, true);
  assert.equal(commits.length, 0);
});
test("horizontal travel follows reading direction in RTL", () => {
  for (const [rtl, dx] of [[false, 30], [true, -30]]) {
    const h = harness({ rtl }); const commits = [];
    h.renderHorizontal({ value: 0, label: "Send", orientation: "horizontal", onCommit: g => commits.push(g) });
    const g = h.responder(), gesture = responderGesture();
    g.onPanResponderGrant(gesture.event('grant'),gesture.state());
    g.onPanResponderMove(gesture.event('move'),gesture.state({ dx, dy: 0 }));
    g.onPanResponderRelease(gesture.event('release'),gesture.state());
    assert.equal(commits.length, 1, `rtl=${rtl}`);
    assert.ok(commits[0] > 0);
  }
});
test("every horizontal fader pressable target is at least 44 pt", () => {
  const h = harness();
  const tree = h.renderHorizontal({ value: 0.5, label: "Mix", onCommit: () => {} });
  const t = track(tree);
  assert.ok(t.props.style.height >= 44);
  const buttons = [];
  (function walk(n) { if (n?.type === "Pressable") buttons.push(n); kids(n).forEach(walk); })(tree);
  assert.equal(buttons.length, 2);
  for (const b of buttons) {
    assert.ok(b.props.style.minWidth >= 44 && b.props.style.minHeight >= 44);
    assert.match(b.props.accessibilityLabel, /(Raise|Lower) Mix by 1 dB/);
  }
});
test("horizontal invalid values throw instead of rendering a fake level", () => {
  const h = harness();
  assert.throws(() => h.renderHorizontal({ value: NaN, label: "X", onCommit: () => {} }), { name: "RangeError" });
  assert.throws(() => h.renderHorizontal({ value: 1, label: "X", length: 20, onCommit: () => {} }), { name: "RangeError" });
});

test("horizontal fader claims only travel-axis drags and keeps them against a parent scroll", () => {
  const h = harness();
  h.renderHorizontal({ value: 0.5, label: "Vox", onCommit: () => {} });
  const g = h.responder(), gesture = responderGesture();
  assert.equal(g.onStartShouldSetPanResponder(), false, "a press alone never claims");
  assert.equal(g.onMoveShouldSetPanResponder(gesture.event('move'),gesture.state({ dx: 3, dy: 2 })), false, "inside slop");
  assert.equal(g.onMoveShouldSetPanResponder(gesture.event('move'),gesture.state({ dx: 6, dy: 40 })), false, "vertical swipe remains available to the parent");
  assert.equal(g.onMoveShouldSetPanResponder(gesture.event('move'),gesture.state({ dx: -12, dy: 3 })), true);
  assert.equal(g.onMoveShouldSetPanResponderCapture(gesture.event('move'),gesture.state({ dx: -12, dy: 3 })), true);
  assert.equal(g.onPanResponderTerminationRequest(), true, "idle fader yields");
  g.onPanResponderGrant(gesture.event('grant'),gesture.state());
  assert.equal(g.onPanResponderTerminationRequest(), false, "an active drag is kept");
  assert.equal(g.onShouldBlockNativeResponder(), true);
  g.onPanResponderRelease(gesture.event('release'),gesture.state());
  assert.equal(g.onPanResponderTerminationRequest(), true);
  const hz = harness();
  hz.renderHorizontal({ value: 0.5, label: "Send", orientation: "horizontal", onCommit: () => {} });
  assert.equal(hz.responder().onMoveShouldSetPanResponder({}, responderGesture().state({ dx: 2, dy: 30 })), false);
  assert.equal(hz.responder().onMoveShouldSetPanResponder({}, responderGesture().state({ dx: 12, dy: 2 })), true);
});
test("horizontal arrow keys step the focused track", () => {
  const h = harness({ os: "web" }); const commits = [];
  const t = track(h.renderHorizontal({ value: h.level.dbToGain(-6), label: "Keys", onCommit: g => commits.push(g) }));
  assert.equal(t.props.focusable, true);
  assert.equal(t.props.style.touchAction, "pan-y");
  let prevented = 0;
  t.props.onKeyDown({ nativeEvent: { key: "ArrowUp" }, preventDefault: () => prevented++ });
  t.props.onKeyDown({ nativeEvent: { key: "Tab" }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.equal(Math.round(h.level.gainToDb(commits[0])), -5);
  assert.equal(track(harness().renderHorizontal({ value: 0.5, label: "N", onCommit: () => {} })).props.style.touchAction, undefined);
});
test("horizontal range with headroom marks unity", () => {
  const h = harness();
  const has = props => {
    let found = false;
    (function walk(n) { if (n?.props?.className === "bg-text-muted") found = true; kids(n).forEach(walk); })(h.renderHorizontal(props));
    return found;
  };
  assert.equal(has({ value: 1, label: "U", onCommit: () => {} }), false);
  assert.equal(has({ value: 1, label: "C", range: h.level.FADER_RANGES.CHANNEL, onCommit: () => {} }), true);
});
test("horizontal stepDb and negative gain are validated at render", () => {
  const h = harness();
  assert.throws(() => h.renderHorizontal({ value: 0.5, label: "X", stepDb: 0, onCommit: () => {} }), { name: "RangeError" });
  assert.throws(() => h.renderHorizontal({ value: -0.1, label: "X", onCommit: () => {} }), { name: "RangeError" });
});

const button = (tree, label) => find(tree, n => n.type === "Pressable" && n.props.accessibilityLabel === label);
const input = tree => find(tree, n => n.type === "TextInput");
const detector = tree => find(tree, n => n.type === "GestureDetector");
const flushActions = async () => { await Promise.resolve(); await Promise.resolve(); };

test("vertical fader previews RNGH travel and commits only the final value", () => {
  const h = harness(); const previews = []; const commits = [];
  const props = { value: 1, label: "Vocals", length: 116,
    onChange: gain => previews.push(gain), onCommit: gain => commits.push(gain) };
  const tree = h.render(props), g = h.pan();
  assert.equal(h.responder(), undefined, "vertical faders do not instantiate PanResponder");
  assert.equal(detector(tree).props.gesture.map(g => g.kind).join(), "pan,tap");
  g.onActivate({ translationY: 25 });
  assert.ok(Math.abs(h.level.gainToDb(previews.at(-1)) + 15) < 1e-9);
  g.onUpdate({ translationY: 50 });
  assert.ok(Math.abs(h.level.gainToDb(previews.at(-1)) + 30) < 1e-9);
  assert.equal(commits.length, 0, "preview never commits mid-drag");
  assert.equal(track(h.render(props)).props.accessibilityValue.text, "-30.0 dB");
  g.onDeactivate({ translationY: 100, canceled: false });
  g.onFinalize({ canceled: false });
  assert.deepEqual(commits, [0]);
  assert.equal(track(h.render(props)).props.accessibilityValue.text, "0.0 dB", "the app still owns the committed value");
});

test("vertical cancellation and extra pointers restore gain without committing", () => {
  for (const cancel of [g => g.onDeactivate({ translationY: -40, canceled: true }),
    g => g.onFinalize({ canceled: true }), g => g.onTouchesDown({ numberOfTouches: 2 })]) {
    const h = harness(); const previews = []; const commits = [];
    const props = { value: 0.5, label: "Pad", onChange: gain => previews.push(gain), onCommit: gain => commits.push(gain) };
    h.render(props); const g = h.pan();
    g.onActivate({ translationY: -40 });
    assert.notEqual(previews.at(-1), props.value);
    cancel(g);
    g.onUpdate({ translationY: -60 });
    g.onDeactivate({ translationY: -60, canceled: false });
    assert.deepEqual(commits, []);
    assert.equal(previews.at(-1), props.value);
    assert.equal(track(h.render(props)).props.accessibilityValue.text, "-6.0 dB");
  }
});

test("vertical RNGH config admits single-pointer vertical travel and unchanged releases do not commit", () => {
  const h = harness(); const commits = [];
  h.render({ value: 1, label: "Keys", onCommit: gain => commits.push(gain) });
  const g = h.pan();
  assert.equal(g.enabled, true);
  assert.equal(g.runOnJS, true);
  assert.equal(g.maxPointers, 1);
  assert.equal(Array.from(g.activeOffsetY).join(), "-4,4");
  assert.equal(Array.from(g.failOffsetX).join(), "-8,8");
  g.onActivate({ translationY: -30 });
  g.onDeactivate({ translationY: -30, canceled: false });
  assert.deepEqual(commits, []);
});

test("vertical screen-reader actions step in dB and reset to unity", async () => {
  const h = harness(); const commits = [];
  const tree = h.render({ value: h.level.dbToGain(-6), label: "Drums", onCommit: gain => commits.push(gain) });
  const t = track(tree);
  assert.equal(t.props.accessibilityLabel, "Drums");
  assert.equal(t.props.accessibilityActions.map(a => a.name).join(), "increment,decrement,reset");
  assert.ok(t.props.accessibilityActions.every(action => action.label));
  assert.equal(t.props.accessibilityValue.text, "-6.0 dB");
  for (const actionName of ["increment", "decrement", "reset"]) {
    t.props.onAccessibilityAction({ nativeEvent: { actionName } });
    await flushActions();
  }
  assert.equal(commits.length, 3);
  assert.ok(Math.abs(h.level.gainToDb(commits[0]) + 5) < 1e-9);
  assert.ok(Math.abs(h.level.gainToDb(commits[1]) + 7) < 1e-9);
  assert.equal(commits[2], 1);
});

test("disabled vertical faders reject gesture, keyboard and accessibility edits", () => {
  const h = harness(); const commits = [];
  const tree = h.render({ value: 0.5, label: "FX", disabled: true, onCommit: gain => commits.push(gain) });
  assert.equal(h.pan().enabled, false);
  assert.equal(h.tap().enabled, false);
  assert.equal(track(tree).props.accessibilityState.disabled, true);
  assert.equal(track(tree).props.focusable, false);
  assert.equal(input(tree).props.editable, false);
  track(tree).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
  track(tree).props.onKeyDown({ key: "ArrowUp" });
  h.pan().onActivate({ translationY: -40 });
  h.pan().onDeactivate({ translationY: -40, canceled: false });
  assert.deepEqual(commits, []);
});

test("vertical targets and keyboard controls retain the native gesture contract", async () => {
  const h = harness({ os: "web" }); const commits = [];
  const tree = h.render({ value: h.level.dbToGain(-6), label: "Mix", targetSize: 48, onCommit: gain => commits.push(gain) });
  assert.equal(track(tree).props.style.width, 48);
  assert.equal(input(tree).props.style.minHeight, 48);
  assert.equal(detector(tree).props.touchAction, "pan-x");
  for (const label of ["Lower Mix by 1 dB", "Raise Mix by 1 dB", "Fine gain off", "Reset gain to unity"]) {
    const b = button(tree, label);
    assert.ok(b, label);
    const style = Object.assign({}, ...b.props.style({ pressed: false }).filter(Boolean));
    assert.ok(style.minWidth >= 48 && style.minHeight >= 48, label);
  }
  let prevented = 0;
  const key = (key, shiftKey = false) => track(tree).props.onKeyDown({ key, shiftKey, preventDefault: () => prevented++ });
  key("ArrowUp", true); await flushActions();
  key("Home"); await flushActions();
  key("End"); await flushActions();
  key("Tab");
  assert.equal(prevented, 3);
  assert.ok(Math.abs(h.level.gainToDb(commits[0]) + 5.9) < 1e-9);
  assert.deepEqual(commits.slice(1), [0, 1]);
});

test("vertical fine mode reduces travel to one tenth", () => {
  const h = harness(); const commits = [];
  const props = { value: h.level.dbToGain(-30), label: "Bass", length: 116, onCommit: gain => commits.push(gain) };
  button(h.render(props), "Fine gain off").props.onPress();
  const tree = h.render(props);
  assert.ok(button(tree, "Fine gain on"));
  h.pan().onActivate({ translationY: -25 });
  h.pan().onDeactivate({ translationY: -25, canceled: false });
  assert.equal(commits.length, 1);
  assert.ok(Math.abs(h.level.gainToDb(commits[0]) + 28.5) < 1e-9);
});

test("vertical double tap resets unity but rejects multiple touches", async () => {
  const h = harness(); const commits = [];
  h.render({ value: 0.5, label: "Send", onCommit: gain => commits.push(gain) });
  const tap = h.tap();
  assert.equal(tap.numberOfTaps, 2);
  assert.equal(tap.maxDelay, 300);
  assert.equal(tap.maxDuration, 250);
  tap.onBegin(); tap.onTouchesDown({ numberOfTouches: 2 }); tap.onActivate();
  assert.deepEqual(commits, []);
  tap.onBegin(); tap.onTouchesDown({ numberOfTouches: 1 }); tap.onActivate();
  await flushActions();
  assert.deepEqual(commits, [1]);
});

test("vertical numeric entry validates dB and accepts silence", async () => {
  const h = harness(); const commits = [];
  const props = { value: 0.5, label: "Send", onCommit: gain => commits.push(gain) };
  let tree = h.render(props);
  assert.equal(input(tree).props.accessibilityLabel, "Send gain decibels");
  input(tree).props.onChangeText("3"); input(tree).props.onSubmitEditing();
  tree = h.render(props);
  assert.deepEqual(commits, []);
  assert.ok(find(tree, n => n.props?.role === "alert"), "out-of-range gain reports an error");
  input(tree).props.onChangeText("-12 dB"); input(tree).props.onSubmitEditing();
  await flushActions();
  input(tree).props.onBlur();
  assert.equal(commits.length, 1, "blur does not recommit a submitted value");
  assert.ok(Math.abs(h.level.gainToDb(commits[0]) + 12) < 1e-9);
  input(tree).props.onChangeText("-inf"); input(tree).props.onSubmitEditing();
  await flushActions();
  assert.deepEqual(commits.slice(1), [0]);
});

test("vertical scope changes invalidate a drag before a later release", () => {
  const h = harness(); const commits = [];
  const props = { value: 0.5, label: "Send", onCommit: gain => commits.push(gain) };
  h.render({ ...props, scope: "track-a" });
  const oldPan = h.pan(); oldPan.onActivate({ translationY: -20 });
  h.render({ ...props, scope: "track-b" });
  oldPan.onDeactivate({ translationY: -40, canceled: false });
  assert.deepEqual(commits, []);
  assert.equal(track(h.render({ ...props, scope: "track-b" })).props.accessibilityValue.text, "-6.0 dB");
});

test("vertical fader validates gains, travel, step and labels at render", () => {
  const h = harness();
  for (const invalid of [{ value: NaN }, { value: -0.1 }, { value: 2 }, { length: 20 }, { stepDb: 0 }, { label: " " }]) {
    assert.throws(() => h.render({ value: 0.5, label: "Gain", onCommit: () => {}, ...invalid }), { name: "RangeError" });
  }
});


test("horizontal old gesture IDs cannot release or cancel a newer active preview",()=>{
 const h=harness(),commits=[];const props={value:1,label:'Owned',length:116,onCommit:v=>commits.push(v)};h.renderHorizontal(props);const g=h.responder(),old=responderGesture(),current=responderGesture();
 g.onPanResponderGrant(old.event('grant'),old.state());g.onPanResponderMove(old.event('move'),old.state({dx:-25}));
 g.onPanResponderGrant(current.event('grant'),current.state());g.onPanResponderMove(current.event('move'),current.state({dx:-50}));
 g.onPanResponderTerminate(old.event('cancel'),old.state());g.onPanResponderRelease(old.event('release'),old.state());assert.deepEqual(commits,[]);
 assert.equal(track(h.renderHorizontal(props)).props.accessibilityValue.now,50);
 g.onPanResponderRelease(current.event('release'),current.state());assert.equal(commits.length,1);assert.ok(Math.abs(h.level.gainToDb(commits[0])+30)<1e-9);
});

test("queued horizontal accessibility steps cannot retarget a replacement source",()=>{
 const h=harness(),old=[],current=[];const previous=track(h.renderHorizontal({scope:'old',value:0.5,label:'Gain',onCommit:v=>old.push(v)}));
 const next=track(h.renderHorizontal({scope:'new',value:0.5,label:'Gain',onCommit:v=>current.push(v)}));
 previous.props.onAccessibilityAction({nativeEvent:{actionName:'increment'}});assert.deepEqual(old,[]);assert.deepEqual(current,[]);
 next.props.onAccessibilityAction({nativeEvent:{actionName:'increment'}});assert.equal(current.length,1);
});

test('successful horizontal and vertical releases never restore original feedback before commit',async()=>{
 for(const orientation of ['horizontal','vertical']){
  const h=harness(),events=[];const props={orientation,value:1,label:'Release',length:116,onChange:v=>events.push(['preview',v]),onCommit:v=>events.push(['commit',v])};h.render(props);
  let release;
  if(orientation==='horizontal'){const g=h.responder(),gesture=responderGesture();g.onPanResponderGrant(gesture.event('grant'),gesture.state());g.onPanResponderMove(gesture.event('move'),gesture.state({dx:-50}));release=()=>g.onPanResponderRelease(gesture.event('release'),gesture.state());}
  else{const g=h.pan();g.onActivate({translationY:50});release=()=>g.onDeactivate({translationY:50,canceled:false});}
  const expected=events.at(-1)[1];release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events.at(-1),['commit',expected]);assert.equal(events.filter(e=>e[0]==='preview'&&e[1]===1).length,0,orientation);
  h.render(props);assert.equal(events.filter(e=>e[0]==='preview'&&e[1]===1).length,0,'controlled refresh after success must not restore consumed feedback');
 }
});

test('rejected and false fader commits restore the original feedback once after dispatch',async()=>{
 for(const orientation of ['horizontal','vertical'])for(const outcome of ['reject','false']){
  const h=harness(),events=[];h.render({orientation,value:1,label:'Rejected',length:116,onChange:v=>events.push(['preview',v]),onCommit:v=>{events.push(['commit',v]);return outcome==='reject'?Promise.reject(new Error('Host refused gain')):false;}});
  if(orientation==='horizontal'){const g=h.responder(),gesture=responderGesture();g.onPanResponderGrant(gesture.event('grant'),gesture.state());g.onPanResponderMove(gesture.event('move'),gesture.state({dx:-50}));g.onPanResponderRelease(gesture.event('release'),gesture.state());}
  else{const g=h.pan();g.onActivate({translationY:50});g.onDeactivate({translationY:50,canceled:false});}
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(e=>e[0]==='commit').length,1);assert.equal(events.filter(e=>e[0]==='preview'&&e[1]===1).length,1);assert.deepEqual(events.at(-1),['preview',1]);
 }
});
