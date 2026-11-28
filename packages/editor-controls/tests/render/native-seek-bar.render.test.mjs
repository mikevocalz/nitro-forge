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

// Runs the real NativeSeekBar platform files with mocked RN and @expo/ui
// hosts. It drives the slider callbacks the way each OS reports a drag:
// SwiftUI `onValueChange` ticks then `onEditingChanged(false)`, Compose
// `onValueChange` ticks then `onValueChangeFinished`, and on web the range
// input's `input` ticks then one DOM `change`. This proves the preview/commit
// contract, not native event order on a device or screen-reader output.
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const FILES = { ios: "NativeSeekBar.native.tsx", android: "NativeSeekBar.native.tsx", web: "NativeSeekBar.web.tsx" };

function harness(os, file = FILES[os]) {
  const refs = [];
  let cursor = 0;
  let effects = [];
  let layouts = [];
  // Expands the kit's own function components (SeekBarLayout) so the tree
  // shows the host elements; Button stays a leaf through its mock.
  const element = (type, props) => typeof type === "function" ? type(props) : { type, props };
  const mocks = {
    react: {
      useRef: v => refs[cursor++] ?? (refs[cursor - 1] = { current: v }),
      useEffect: fn => { effects.push(fn); },
      useLayoutEffect: (fn,deps) => {
        const i=cursor++,s=refs[i]??(refs[i]={});
        if(!s.deps||!deps||deps.some((d,i)=>d!==s.deps[i])){
          s.deps=deps;layouts.push(()=>{s.cleanup?.();s.cleanup=fn();});
        }
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-native": { View: "View", Text: "Text", Platform: { OS: os } },
    "@expo/ui": { Host: "Host", Slider: "Slider" },
    "@expo/ui/swift-ui": { Slider: "SwiftUISlider" },
    "@expo/ui/swift-ui/modifiers": { disabled: v => ({ disabled: v }) },
    "@expo/ui/jetpack-compose": { Slider: "ComposeSlider" },
    "@nyc-tron/ui/components/Button": { Button: "Button" },
    "zustand/vanilla": { createStore: init => {
      let value = init();
      return { getState: () => value, setState: next => { value = { ...value, ...next }; } };
    } },
    zustand: { useStore: (store, selector) => selector(store.getState()) },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
    }).outputText;
    cache.set(path, exports);
    runInNewContext(code, { exports, require: name => mocks[name] ?? load(resolveSpecifier(path, name)) },
      { filename: path });
    return exports;
  }
  const { NativeSeekBar } = load(resolve(src, file));
  let tree;
  return {
    render: props => { cursor = 0; effects = []; tree = NativeSeekBar(props); for(const fn of layouts.splice(0))fn(); return tree; },
    /** Runs the effects of the last render, as React would after commit; returns their cleanups. */
    mount: () => effects.map(fn => fn()).filter(Boolean),
    tree: () => tree,
  };
}
const kids = n => [n?.props?.children].flat(Infinity).filter(x => x && typeof x === "object");
function find(n, pred) {
  if (pred(n)) return n;
  for (const c of kids(n)) { const r = find(c, pred); if (r) return r; }
}
const slider = tree => find(tree, n => typeof n.props?.onValueChange === "function");
const button = (tree, title) => find(tree, n => n.props?.title === title);
const timecode = tree => find(tree, n => n.type === "Text").props.children;
const base = { frame: 120, durationFrames: 240, frameRate: { numerator: 24, denominator: 1 } };

/** Web: a fake DOM node standing in for the View that wraps the range input. */
function webHost(h) {
  const listeners = {};
  const node = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; },
  };
  find(h.tree(), n => n.props?.ref && typeof n.props.ref === "object").props.ref.current = node;
  const cleanups = h.mount();
  return { change: value => listeners.change?.({ target: { value: String(value) } }), listeners, cleanups };
}

test("slider ticks preview without seeking; one commit on iOS release", () => {
  const h = harness("ios"); const previews = []; const commits = [];
  const props = { ...base, onPreview: f => previews.push(f), onCommit: f => commits.push(f) };
  const s = slider(h.render(props));
  s.props.onEditingChanged(true);
  s.props.onValueChange(0.25);
  s.props.onValueChange(0.25);
  s.props.onValueChange(0.75);
  assert.deepEqual(previews, [60, 180], "each distinct frame previews once");
  assert.deepEqual(commits, [], "no commit while the thumb moves");
  const mid = h.render(props);
  assert.equal(slider(mid).props.value, 0.75, "the thumb shows the preview");
  assert.match(timecode(mid), /^00:00:07:12 \//, "the timecode shows the preview");
  slider(mid).props.onEditingChanged(false);
  assert.deepEqual(commits, [180]);
  slider(h.render(props)).props.onEditingChanged(false);
  assert.deepEqual(commits, [180], "a second end event does not commit again");
});

test("Android commits once on onValueChangeFinished", () => {
  const h = harness("android"); const commits = [];
  const props = { ...base, onCommit: f => commits.push(f) };
  const s = slider(h.render(props));
  assert.equal(s.type, "ComposeSlider");
  for (const p of [0.1, 0.2, 0.3]) s.props.onValueChange(p);
  assert.deepEqual(commits, []);
  s.props.onValueChangeFinished();
  assert.deepEqual(commits, [72]);
});

test("web commits once on the range input's change event", () => {
  const h = harness("web"); const previews = []; const commits = [];
  const props = { ...base, onPreview: f => previews.push(f), onCommit: f => commits.push(f) };
  h.render(props);
  const host = webHost(h);
  const s = slider(h.tree());
  for (const p of [0.6, 0.7, 0.8]) s.props.onValueChange(p);
  assert.equal(previews.length, 3);
  assert.deepEqual(commits, [], "input ticks do not seek");
  host.change(0.8);
  assert.deepEqual(commits, [192]);
});

test("onSeek is a deprecated alias of onCommit and never fires on ticks", () => {
  // Android and web get no drag-start event, so this runs the ticks alone.
  const h = harness("android"); const seeks = [];
  const s = slider(h.render({ ...base, onSeek: f => seeks.push(f) }));
  s.props.onValueChange(0.5 + 1 / 240);
  s.props.onValueChange(0.5 + 2 / 240);
  assert.deepEqual(seeks, [], "the old tick-by-tick seek is gone");
  s.props.onValueChangeFinished();
  assert.deepEqual(seeks, [122]);
});

test("onCommit wins over onSeek: one call per gesture, never both", () => {
  const h = harness("android"); const commits = []; const seeks = [];
  const props = { ...base, onCommit: f => commits.push(f), onSeek: f => seeks.push(f) };
  const s = slider(h.render(props));
  s.props.onValueChange(0);
  s.props.onValueChangeFinished();
  button(h.render(props), "+1 frame").props.onPress();
  assert.deepEqual(commits, [0, 121]);
  assert.deepEqual(seeks, []);
});

test("step buttons commit once per press and skip a step past the end", () => {
  const h = harness("ios"); const commits = []; const previews = [];
  const props = { ...base, frame: 240, stepFrames: 5, onPreview: f => previews.push(f), onCommit: f => commits.push(f) };
  const tree = h.render(props);
  button(tree, "+5 frame").props.onPress();
  button(tree, "−5 frame").props.onPress();
  assert.deepEqual(commits, [235], "already at the end, so +5 does nothing");
  assert.deepEqual(previews, [], "steps commit directly");
});

test("a release on the starting frame does not commit", () => {
  const h = harness("android"); const commits = [];
  const s = slider(h.render({ ...base, onCommit: f => commits.push(f) }));
  s.props.onValueChange(0.3);
  s.props.onValueChange(0.5);
  s.props.onValueChangeFinished();
  assert.deepEqual(commits, []);
});

test("iOS treats a value change outside a drag as one step", () => {
  // VoiceOver increment/decrement on a SwiftUI Slider changes the value
  // without onEditingChanged, so each such change commits on its own.
  const h = harness("ios"); const commits = [];
  const props = { ...base, onCommit: f => commits.push(f) };
  slider(h.render(props)).props.onValueChange(0.6);
  assert.deepEqual(commits, [144]);
});

test("disabled and empty seek bars ignore the slider and buttons", () => {
  for (const extra of [{ disabled: true }, { durationFrames: 0, frame: 0 }]) {
    for (const os of ["ios", "android", "web"]) {
      const h = harness(os); const commits = [];
      const props = { ...base, ...extra, onCommit: f => commits.push(f) };
      const tree = h.render(props);
      const s = slider(tree);
      s.props.onValueChange(0.9);
      s.props.onEditingChanged?.(false);
      s.props.onValueChangeFinished?.();
      if (os === "web") webHost(h).change(0.9);
      button(tree, "+1 frame").props.onPress();
      assert.deepEqual(commits, [], `${os} ${JSON.stringify(extra)}`);
    }
  }
});

test("web removes its change listener on unmount", () => {
  const h = harness("web");
  h.render({ ...base, onCommit: () => {} });
  const host = webHost(h);
  assert.equal(typeof host.listeners.change, "function");
  host.cleanups.forEach(c => c());
  assert.equal(host.listeners.change, undefined);
});

test("a seek bar without onCommit or onSeek throws", () => {
  const h = harness("ios");
  assert.throws(() => h.render({ ...base }), { name: "TypeError" });
  assert.throws(() => h.render({ ...base, durationFrames: -1, onCommit: () => {} }), { name: "RangeError" });
});
