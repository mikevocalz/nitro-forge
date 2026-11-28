import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "@typescript/typescript6";
import * as sharedOverlays from "@nyc-tron/core/overlays";
import { createRequire } from "node:module";
// Moved controls load relative to their own file; NYC-Tron primitives load from the
// installed @nyc-tron/ui release (its dist JS), as Forge consumes them.
const requireFromPackage = createRequire(new URL("../../package.json", import.meta.url));
const resolveSpecifier = (from, name) => name.startsWith("@nyc-tron/") ? requireFromPackage.resolve(name) : resolve(dirname(from), name);

// Runs the real LayerStack with mocked RN hosts. Function components are
// expanded in place so rows render; this proves props, labels and callbacks,
// not React reconciliation, native layout or screen-reader output on a device.
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
function harness({ rtl = false } = {}) {
  const refs = [];
  let cursor = 0;
  const responders = [];
  const layoutEffects = [];
  const element = (type, props) => ({ type, props });
  const contextToken = Symbol("mock React context");
  const createContext = value => {
    const context = { [contextToken]: true, currentValue: value };
    context.Provider = context; // React 19 supports the context itself as provider.
    context.Consumer = ({ children }) => children(context.currentValue);
    return context;
  };
  const useContext = context => {
    if (!context?.[contextToken]) throw new TypeError("useContext requires a context");
    return context.currentValue;
  };
  const mocks = {
    // Resolve the real peer-free implementation after its shared-owner extraction.
    "@nyc-tron/core/overlays": sharedOverlays,
    react: { createContext, useContext, useRef: v => refs[cursor++] ?? (refs[cursor - 1] = { current: v }), useEffect: () => {}, useLayoutEffect: fn => { layoutEffects.push(fn); },
      useMemo: f => f(), cloneElement: (el, props) => ({ ...el, props: { ...el.props, ...props } }) },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": {
      View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput", Modal: "Modal",
      I18nManager: { isRTL: rtl }, Platform: { OS: "ios" }, useWindowDimensions: () => ({ width: 390, height: 844 }),
      PanResponder: { create: config => { responders.push(config); return { panHandlers: {} }; } },
    },
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
    runInNewContext(code, { exports, AbortController, require: name => mocks[name] ?? load(resolveSpecifier(path, name)) },
      { filename: path });
    return exports;
  }
  const { LayerStack } = load(resolve(src, "layers/LayerStack.tsx"));
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (node.type?.[contextToken]) {
      const context = node.type, previous = context.currentValue;
      context.currentValue = node.props.value;
      try { return expand(node.props.children); }
      finally { context.currentValue = previous; }
    }
    if (typeof node.type === "function") return expand(node.type(node.props));
    const children = node.props?.children;
    return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children) } };
  };
  return {
    render: props => { cursor = 0; layoutEffects.length = 0; const tree = expand(LayerStack(props)); for (const effect of layoutEffects) effect(); return tree; },
    // Each row creates its opacity responder, then its drag responder.
    opacityResponder: row => responders[row * 2],
  };
}
const kids = n => [n?.props?.children].flat(Infinity).filter(x => x && typeof x === "object");
function findAll(n, pred, out = []) {
  if (pred(n)) out.push(n);
  for (const c of kids(n)) findAll(c, pred, out);
  return out;
}
const texts = tree => findAll(tree, n => n.type === "Text").map(n => [n.props.children].flat().join(""));
const byLabel = (tree, label) => findAll(tree, n => n.props?.accessibilityLabel === label)[0];
const rowMain = (tree, name) => findAll(tree, n => n.type === "Pressable" && n.props.accessibilityActions !== undefined
  && String(n.props.accessibilityLabel).startsWith(name + ","))[0];

const base = [
  { id: "rect", name: "Card", visible: true, opacity: 1, kind: "vector", kindLabel: "Rectangle",
    thumbnail: { fill: "#e0402a", label: "red fill" } },
  { id: "photo", name: "Photo", visible: true, opacity: 0.5, kind: "raster",
    thumbnail: { node: { type: "Preview", props: {} } } },
  { id: "bg", name: "Background", visible: false, opacity: 1, kind: "raster", kindLabel: "Raster", locked: true },
];
const noop = () => {};
const props = extra => ({ layers: base, onSelect: noop, onToggleVisible: noop, onOpacityCommit: noop,
  onMove: noop, onRename: noop, ...extra });

test("kindLabel replaces the built-in kind label and falls back when absent", () => {
  const tree = harness().render(props());
  const shown = texts(tree);
  assert.ok(shown.includes("Rectangle"));
  assert.ok(shown.includes("Pixel"), "no kindLabel keeps the built-in label");
  assert.ok(shown.includes("Raster, locked"));
  assert.ok(!shown.includes("Shape"), "the built-in vector label is replaced");
  assert.match(rowMain(tree, "Card").props.accessibilityLabel, /^Card, Rectangle layer, red fill, 1 of 3/);
});

test("thumbnails render a fill or the caller's node, hidden from screen readers", () => {
  const tree = harness().render(props());
  const thumbs = findAll(tree, n => n.type === "View" && n.props.accessibilityElementsHidden === true
    && n.props["aria-hidden"] === true);
  assert.equal(thumbs.length, 2, "only rows with a thumbnail draw one");
  const [fill, node] = thumbs;
  assert.equal(fill.props.style.backgroundColor, "#e0402a");
  assert.equal(fill.props.style.width, 28);
  assert.equal(fill.props.importantForAccessibility, "no-hide-descendants");
  assert.equal(kids(node)[0].type, "Preview", "caller node is rendered inside the clip");
  assert.equal(node.props.style.overflow, "hidden");
  assert.equal(node.props.style.backgroundColor, undefined);
  const spacers = findAll(tree, n => n.type === "View" && n.props.style?.width === 28 && n.props["aria-hidden"] === undefined);
  assert.equal(spacers.length, 1, "the row without a thumbnail keeps an empty slot so columns align");
  assert.equal(rowMain(tree, "Photo").props.accessibilityLabel, "Photo, Pixel layer, 2 of 3, visible, 50% opacity",
    "an unlabelled thumbnail adds nothing to the spoken label");
});

test("no onRemove means no remove control, action or key handling", () => {
  const tree = harness().render(props());
  assert.equal(byLabel(tree, "Remove Card"), undefined);
  const main = rowMain(tree, "Card");
  assert.ok(!main.props.accessibilityActions.some(a => a.name === "remove"));
  let prevented = false;
  main.props.onKeyDown({ nativeEvent: { key: "Delete" }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, "Delete passes through when the host cannot remove");
});

test("onRemove adds a button, a screen-reader action and Delete/Backspace on the row", async () => {
  const removed = [];
  const tree = harness().render(props({ onRemove: id => removed.push(id) }));
  const button = byLabel(tree, "Remove Card");
  assert.equal(button.type, "Pressable");
  assert.equal(button.props.accessibilityRole, "button");
  button.props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  const main = rowMain(tree, "Card");
  assert.equal(main.props.accessibilityActions.find(a => a.name === "remove")?.label, "Remove");
  main.props.onAccessibilityAction({ nativeEvent: { actionName: "remove" } });
  await new Promise(resolve => setImmediate(resolve));
  let prevented = 0;
  for (const key of ["Delete", "Backspace", "Enter"]) {
    main.props.onKeyDown({ nativeEvent: { key }, preventDefault: () => { prevented++; } });
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(removed, ["rect", "rect", "rect", "rect"], "button, action, Delete and Backspace; Enter is not remove");
  assert.equal(prevented, 2);
});

test("locked rows keep a disabled remove slot and expose no remove action", () => {
  const removed = [];
  const tree = harness().render(props({ onRemove: id => removed.push(id) }));
  const button = byLabel(tree, "Remove Background");
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityState.disabled, true);
  button.props.onPress();
  const main = rowMain(tree, "Background");
  assert.ok(!main.props.accessibilityActions.some(a => a.name === "remove"));
  main.props.onKeyDown({ nativeEvent: { key: "Delete" }, preventDefault: noop });
  assert.deepEqual(removed, []);
});

test("RTL anchors the selection strip to the start edge and flips opacity drag", () => {
  for (const rtl of [false, true]) {
    const h = harness({ rtl });
    const commits = [];
    const tree = h.render(props({ selectedId: "photo", onOpacityCommit: (id, v) => commits.push(v) }));
    const strip = findAll(tree, n => n.type === "View" && n.props.style?.width === 3)[1];
    assert.equal(strip.props.style.start, 0);
    assert.equal(strip.props.style.left, undefined);
    const g = h.opacityResponder(1);
    g.onPanResponderGrant();
    g.onPanResponderMove({}, { dx: 22, dy: 0 });
    g.onPanResponderRelease();
    assert.deepEqual([...commits], [rtl ? 0 : 1], rtl ? "rightward drag lowers opacity in RTL" : "rightward drag raises opacity");
  }
});

test("existing rows without the new fields render as before", () => {
  const plain = base.map(({ kindLabel, thumbnail, ...row }) => row);
  const tree = harness().render(props({ layers: plain }));
  assert.ok(texts(tree).includes("Shape"));
  assert.equal(findAll(tree, n => n.props?.["aria-hidden"] === true).length, 0);
  assert.equal(findAll(tree, n => String(n.props?.accessibilityLabel).startsWith("Remove ")).length, 0);
});

test("readout rows replace the slider with a labelled button that opens the scrubber", () => {
  const h = harness();
  const tree = h.render(props({ opacityControl: "readout", onRemove: noop }));
  assert.equal(findAll(tree, n => n.props?.accessibilityRole === "adjustable").length, 0, "no inline slider");
  const readout = byLabel(tree, "Photo opacity, 50%");
  assert.equal(readout.type, "Pressable");
  assert.equal(readout.props.accessibilityRole, "button");
  assert.equal(readout.props["aria-expanded"], false);
  assert.equal(readout.props["aria-haspopup"], "dialog");
  assert.equal(readout.props.accessibilityHint, "Opens a scrubber to change opacity.");
  assert.ok(readout.props.style.minWidth >= 44 && readout.props.style.height >= 44, "44pt target");
  const locked = byLabel(tree, "Background opacity, 100%");
  assert.equal(locked.props.disabled, true);
  assert.equal(locked.props.accessibilityState.disabled, true);
  // The name may shrink beside the readout, so the remove button never clips.
  const nameCell = findAll(tree, n => n.type === "View" && n.props.style?.flex === 1 && n.props.style?.height === 44)[0];
  assert.equal(nameCell.props.style.minWidth, 0);
  assert.ok(byLabel(tree, "Remove Photo"), "remove stays in the row");
  // Pressing opens the popover: the next render announces it expanded.
  readout.props.onPress();
  const reopened = byLabel(h.render(props({ opacityControl: "readout", onRemove: noop })), "Photo opacity, 50%");
  assert.equal(reopened.props["aria-expanded"], true);
});

test("slider rows keep the 96pt name floor and the 120pt slider", () => {
  const tree = harness().render(props({ opacityControl: "slider" }));
  const slider = findAll(tree, n => n.props?.accessibilityRole === "adjustable")[0];
  assert.equal(slider.props.style.width, 120);
  const nameCell = findAll(tree, n => n.type === "View" && n.props.style?.flex === 1 && n.props.style?.height === 44)[0];
  assert.equal(nameCell.props.style.minWidth, 96);
});
