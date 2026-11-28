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

// Renders the real automation lane and mode picker against mocked React
// Native hosts and drives their real PanResponder configs. Harness copied
// from mixer-midi.render.test.mjs. Function components are
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


const points = [{ ticks: 0, value: 0.71 }, { ticks: 1920, value: 1 }, { ticks: 3840, value: 0.5 }];
function lane(h, extra = {}) {
  const { AutomationLane } = h.module("audio/AutomationLane.tsx");
  const calls = [];
  const props = { param: "gain", points, mode: "read", lengthTicks: 7680, label: "Vocal volume automation",
    onPointAdd: (t, v) => calls.push(["add", t, v]), onPointMove: (i, t, v) => calls.push(["move", i, t, v]),
    onPointRemove: i => calls.push(["remove", i]), onSelect: i => calls.push(["select", i]), ...extra };
  return { calls, props, render: () => h.render(AutomationLane, props) };
}
const texts = tree => findAll(tree, n => n.type === "Text").map(n => [n.props.children].flat().join(""));

test("AutomationLane: one move per drag, preview in between, terminate restores", () => {
  const h = harness();
  const l = lane(h);
  const p2 = byLabel(l.render(), "Point 2");
  assert.equal(p2.props.accessibilityRole, "adjustable");
  assert.equal(p2.props.accessibilityValue.text, "Bar 1 beat 3, 0.0 dB");
  assert.equal(p2.props.style.width, 44);
  const g = p2.props.__responder;
  g.onPanResponderGrant();
  g.onPanResponderMove({}, { dx: 24, dy: 0 });
  g.onPanResponderMove({}, { dx: 48, dy: 0 });
  assert.ok(texts(l.render()).includes("Point 2: Bar 1 beat 3.5, 0.0 dB"), "header shows the preview");
  g.onPanResponderRelease();
  assert.deepEqual(l.calls, [["select", 1], ["move", 1, 2400, 1]]);
  g.onPanResponderGrant();
  g.onPanResponderMove({}, { dx: 500, dy: 30 });
  g.onPanResponderTerminate();
  assert.equal(l.calls.filter(c => c[0] === "move").length, 1, "terminated drag does not commit");
  const after = l.render();
  assert.ok(!texts(after).some(t => t.startsWith("Point 2:")), "no preview readout left behind (no selectedIndex passed)");
  assert.equal(byLabel(after, "Point 2").props.style.left, 192 - 22, "restored to the committed x");
});

test("AutomationLane: Escape cancels a drag; keys and actions edit once each", async () => {
  const h = harness();
  const l = lane(h);
  const p = byLabel(l.render(), "Point 3");
  const g = p.props.__responder;
  g.onPanResponderGrant();
  g.onPanResponderMove({}, { dx: 30, dy: 30 });
  p.props.onKeyDown(key("Escape"));
  await settle();
  g.onPanResponderRelease();
  assert.deepEqual(l.calls, [["select", 2]]);
  p.props.onKeyDown(key("ArrowLeft"));
  await settle();
  p.props.onKeyDown(key("Backspace"));
  await settle();
  p.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
  await settle();
  p.props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } });
  await settle();
  assert.deepEqual(plain(l.calls.slice(1).map(c => c.slice(0, 3))),
    [["move", 2, 3600], ["remove", 2], ["move", 2, 3840], ["remove", 2]]);
  assert.deepEqual(plain(p.props.accessibilityActions.map(a => a.name)),
    ["increment", "decrement", "moveEarlier", "moveLater", "delete"]);
});

test("AutomationLane: tap adds snapped, never on a taken tick; Add point uses the cursor", async () => {
  const h = harness();
  const l = lane(h, { cursorTicks: 960 });
  const tree = l.render();
  const area = find(tree, n => n.type === "Pressable" && n.props.accessible === false);
  area.props.onPressIn();
  area.props.onPress({ nativeEvent: { locationX: 100, locationY: 22 } });
  await settle();
  area.props.onPressIn();
  area.props.onPress({ nativeEvent: { locationX: 2, locationY: 140 } });
  await settle();
  area.props.onPressIn();
  area.props.onPress({ nativeEvent: { locationX: 380, locationY: 140 } });
  await settle();
  byLabel(tree, "Add point at Bar 1 beat 2").props.onPress();
  assert.deepEqual(plain(l.calls.map(c => c.slice(0, 2))), [["add", 960], ["select", 0], ["select", 2], ["add", 960]]);
  assert.equal(l.calls[0][2], 1, "top of travel is 0 dB");
  const busy = lane(harness(), { cursorTicks: 1920 }).render();
  assert.equal(byLabel(busy, "Add point at Bar 1 beat 3").props.disabled, true);
});

test("AutomationLane: empty, off and disabled states", async () => {
  const h = harness();
  const empty = lane(h, { points: [], mode: "off", param: "pan" }).render();
  const t = texts(empty);
  assert.ok(t.includes("Automation off: the pan control sets the position"));
  assert.ok(t.includes("No points. Tap the lane to add one"));
  const off = lane(harness(), { mode: "off" }).render();
  assert.ok(texts(off).includes("Automation off: the fader sets the level"));
  const d = lane(harness(), { disabled: true });
  const p = byLabel(d.render(), "Point 1");
  assert.equal(p.props.focusable, false);
  assert.equal(p.props.__responder.onStartShouldSetPanResponder(), false);
  p.props.onKeyDown(key("Delete"));
  await settle();
  assert.deepEqual(d.calls, []);
  assert.throws(() => lane(harness(), { height: 40 }).render(), /height/);
});

test("AutomationModePicker: radios gate live modes behind explicit host capabilities", async () => {
  const h = harness({os:"web"});
  const { AutomationModePicker } = h.module("audio/AutomationModePicker.tsx");
  const commits = [];
  const tree = h.render(AutomationModePicker, { mode: "read", onModeCommit: m => commits.push(m) });
  const radios = findAll(tree, n => n.props?.role === "radio");
  assert.deepEqual(radios.map(r => texts(r).join("")), ["Off", "Read", "Write", "Touch", "Latch", "Trim"]);
  assert.ok(radios.slice(2).every(r=>r.props.accessibilityState.disabled));
  for(const radio of radios.slice(2))radio.props.onPress();
  assert.deepEqual(commits,[],"unsupported modes cannot invoke the host");
  assert.deepEqual(plain(radios[1].props.accessibilityState), { checked: true, disabled: false });
  assert.equal(radios[0].props.tabIndex, -1, "roving tab stop on the checked radio");
  radios[1].props.onPress();
  radios[0].props.onPress();
  await settle();
  radios[1].props.onKeyDown(key("ArrowLeft"));
  assert.deepEqual(commits, ["off", "off"]);
  assert.equal(radios[0].props.style({pressed:false})[0].minHeight, 44);
  const off = h.render(AutomationModePicker, { mode: "off", disabled: true, onModeCommit: m => commits.push(m) });
  findAll(off, n => n.props?.role === "radio")[1].props.onPress();
  assert.equal(commits.length, 2);
});

test("AutomationModePicker: host enables live modes and can disable one with a reason", async () => {
  const h=harness({os:"web"});
  const {AutomationModePicker}=h.module("audio/AutomationModePicker.tsx");
  const commits=[];
  const capabilities=[{mode:"off"},{mode:"read"},{mode:"write"},{mode:"touch"},{mode:"latch",disabledReason:"Transport unavailable"},{mode:"trim"}];
  const tree=h.render(AutomationModePicker,{mode:"read",capabilities,onModeCommit:mode=>commits.push(mode)});
  const radios=findAll(tree,n=>n.props?.role==="radio");
  for(const index of [2,3,4,5]){radios[index].props.onPress();await settle();}
  assert.deepEqual(commits,["write","touch","trim"]);
  assert.equal(radios[4].props.accessibilityState.disabled,true);
  assert.ok(texts(tree).includes("Latch: Transport unavailable"));
});
