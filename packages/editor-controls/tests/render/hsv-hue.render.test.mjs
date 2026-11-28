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

// Runs the real HsvPicker with mocked RN and @expo/ui hosts to check how the
// hue slider is named. It proves props and the web DOM patch, not VoiceOver,
// TalkBack or a browser screen reader.
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
function harness(os) {
  const refs = [];
  const effects = [];
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const mocks = {
    react: {
      useRef: v => refs[cursor++] ?? (refs[cursor - 1] = { current: v }),
      useEffect: fn => { effects.push(fn); },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-native": {
      View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", Platform: { OS: os },
      PanResponder: { create: () => ({ panHandlers: {} }) },
    },
    "expo-linear-gradient": { LinearGradient: "LinearGradient" },
    "@expo/ui": { Host: "Host", Slider: "Slider" },
    "zustand/vanilla": { createStore: init => { let v = init(); return { getState: () => v, setState: n => { v = { ...v, ...n }; } }; } },
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
  const { HsvPicker } = load(resolve(src, "color/HsvPicker.tsx"));
  return { render: props => { cursor = 0; effects.length = 0; return HsvPicker(props); }, refs, effects };
}
const kids = n => [n?.props?.children].flat(Infinity).filter(x => x && typeof x === "object");
function findAll(n, pred, out = []) {
  if (!n || typeof n !== "object") return out;
  if (pred(n)) out.push(n);
  for (const c of kids(n)) findAll(c, pred, out);
  return out;
}
const value = { h: 120.4, s: 0.5, v: 0.5, alpha: 1 };

test("native: the hue slider is one adjustable stop named Hue that reads degrees and steps hue", () => {
  for (const os of ["ios", "android"]) {
    const changes = [];
    const tree = harness(os).render({ value, onValueChange: next => changes.push(next.h), showChannels: false });
    const hue = findAll(tree, n => n.props?.accessibilityLabel === "Hue")[0];
    assert.ok(hue, os + ": a stop named Hue");
    assert.equal(hue.props.accessible, true);
    assert.equal(hue.props.accessibilityRole, "adjustable");
    assert.deepEqual({ ...hue.props.accessibilityValue }, { min: 0, max: 359, now: 120, text: "120 degrees" });
    hue.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
    hue.props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } });
    assert.deepEqual(changes, [125.4, 115.4], os + ": steps by hueStep (5 degrees)");
    const hidden = kids(hue)[0];
    assert.equal(hidden.props.importantForAccessibility, "no-hide-descendants");
    assert.equal(hidden.props.accessibilityElementsHidden, true);
    assert.equal(findAll(hidden, n => n.type === "Slider").length, 1, os + ": the native slider stays inside");
  }
});

test("disabled pickers report the hue stop disabled and ignore its actions", () => {
  const changes = [];
  const tree = harness("ios").render({ value, onValueChange: next => changes.push(next), disabled: true, showChannels: false });
  const hue = findAll(tree, n => n.props?.accessibilityLabel === "Hue")[0];
  assert.equal(hue.props.accessibilityState.disabled, true);
  hue.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
  assert.deepEqual(changes, []);
});

test("web: the range input itself gets aria-label and aria-valuetext", () => {
  const h = harness("web");
  const tree = h.render({ value, onValueChange: () => {}, showChannels: false });
  assert.equal(findAll(tree, n => n.props?.accessibilityRole === "adjustable" && n.props?.accessibilityLabel === "Hue").length, 0,
    "no wrapping slider role around the native input");
  const attributes = {};
  const input = { setAttribute: (name, v) => { attributes[name] = v; } };
  for (const ref of h.refs) if (ref && ref.current === null) ref.current = { querySelector: s => s === 'input[type="range"]' ? input : null };
  for (const effect of h.effects) effect();
  assert.deepEqual(attributes, { "aria-label": "Hue", "aria-valuetext": "120 degrees" });
});
