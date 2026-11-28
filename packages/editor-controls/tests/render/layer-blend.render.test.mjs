import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "@typescript/typescript6";
import { createRequire } from "node:module";
// Moved controls load relative to their own file; NYC-Tron primitives load from the
// installed @nyc-tron/ui release (its dist JS), as Forge consumes them.
const requireFromPackage = createRequire(new URL("../../package.json", import.meta.url));
const resolveSpecifier = (from, name) => name.startsWith("@nyc-tron/") ? requireFromPackage.resolve(name) : resolve(dirname(from), name);

// Shallow render of the real LayerBlendAndOpacity with mocked RN hosts and
// stubbed child components (MenuButton, PrecisionScrubber, ErrorMessage). It
// proves the element tree, props and callbacks the component hands to its
// children. It does not cover React reconciliation, native layout or what a
// screen reader says on a device.
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../src/layers/LayerBlendAndOpacity.tsx");
// Captured from LayerBlendAndOpacity.tsx at 1.0.0-rc.1 (main 693e068) with this
// harness, before alphaModes existed. Regenerate only from that source:
//   LAYER_BLEND_RC1_WRITE=1 node --experimental-strip-types --test <this file>
const goldenPath = resolve(here, "layer-blend-rc1.golden.json");

function harness() {
  const refs = [];
  let cursor = 0;
  const layoutEffects = [];
  const runs = [];
  const element = (type, props, key) => ({ type, props, key });
  const stub = name => ({ [name]: Object.defineProperty(() => null, "name", { value: name }) });
  const mocks = {
    react: { useRef: v => refs[cursor++] ?? (refs[cursor - 1] = { current: v }), useLayoutEffect: fn => { layoutEffects.push(fn); } },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": { View: "View", Text: "Text" },
    "@nyc-tron/ui/components/shell/MenuButton": stub("MenuButton"),
    "@nyc-tron/ui/components/feedback/ErrorMessage": stub("ErrorMessage"),
    "@nyc-tron/ui/components/shell/PrecisionScrubber": stub("PrecisionScrubber"),
    "@nyc-tron/ui/components/shell/useOwnedAction": { useOwnedAction: () => ({ pending: null, error: undefined,
      run: (kind, operation) => { runs.push(kind); return Promise.resolve(operation(new AbortController().signal)); } }) },
    "@nyc-tron/ui/components/styles": { joinClasses: (...names) => names.filter(Boolean).join(" ") || undefined },
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
    runInNewContext(code, { exports, AbortController, JSON, Symbol, Promise,
      require: name => mocks[name] ?? load(resolveSpecifier(path, name)) }, { filename: path });
    return exports;
  }
  const { LayerBlendAndOpacity } = load(source);
  return {
    runs,
    render: props => { cursor = 0; layoutEffects.length = 0; const tree = LayerBlendAndOpacity(props); for (const effect of layoutEffects) effect(); return tree; },
  };
}

// Functions become a marker so the snapshot compares structure, not identity.
// Round-tripping also moves values out of the vm realm before deepEqual.
const serialize = node => JSON.parse(JSON.stringify(node, (key, value) => {
  if (typeof value === "function") return value.name && /^[A-Z]/.test(value.name) ? "<" + value.name + ">" : "[Function]";
  return value;
}));
const kids = n => [n?.props?.children].flat(Infinity).filter(x => x && typeof x === "object");
function findAll(n, pred, out = []) {
  if (pred(n)) out.push(n);
  for (const c of kids(n)) findAll(c, pred, out);
  return out;
}
const named = name => n => n.type?.name === name;
const menu = (tree, label) => findAll(tree, n => named("MenuButton")(n) && n.props.label === label)[0];
const texts = tree => findAll(tree, n => n.type === "Text").map(n => [n.props.children].flat().join(""));

const modes = [{ id: "normal", label: "Normal" }, { id: "multiply", label: "Multiply" },
  { id: "legacy", label: "Legacy", unavailableReason: "Unsupported by compositor" }];
const spaces = [{ id: "linear", label: "Linear sRGB", transfer: "linear", modeIds: ["normal", "multiply", "legacy"] },
  { id: "encoded", label: "Encoded sRGB", transfer: "encoded", modeIds: ["normal"] }];
const value = { mode: "normal", opacity: 0.5, spaceId: "linear", alphaMode: "straight" };
const props = extra => ({ scope: "doc", layerId: "layer-1", value, modes, spaces, onCommit: () => {}, ...extra });

// Scenarios rendered without alphaModes. Each must match rc.1 element for element.
const rc1Scenarios = {
  straight: props(),
  premultiplied: props({ value: { ...value, alphaMode: "premultiplied" } }),
  retainedUnavailableMode: props({ value: { ...value, mode: "legacy" } }),
  disabledUnstyledEncoded: props({ disabled: true, unstyled: true, revision: 3, value: { ...value, spaceId: "encoded" } }),
};

test("without alphaModes the render matches rc.1 element for element", () => {
  const actual = Object.fromEntries(Object.entries(rc1Scenarios).map(([name, p]) => [name, serialize(harness().render(p))]));
  if (process.env.LAYER_BLEND_RC1_WRITE === "1") writeFileSync(goldenPath, JSON.stringify(actual, null, 1) + "\n");
  assert.deepEqual(actual, JSON.parse(readFileSync(goldenPath, "utf8")));
});

const alphaMenu = tree => menu(tree, "Layer alpha representation");
const alertText = tree => findAll(tree, n => n.type === "Text" && n.props.accessibilityRole === "alert").map(n => n.props.children)[0];
const scrubber = tree => findAll(tree, named("PrecisionScrubber"))[0];
const straightOnly = [{ id: "straight", label: "Straight alpha" }];
const premultipliedUnavailable = [{ id: "straight", label: "Straight alpha" },
  { id: "premultiplied", label: "Premultiplied alpha", unavailableReason: "This compositor stores straight alpha only." }];

test("passing the default catalog explicitly renders the same alpha menu as omitting it", async () => {
  const { defaultAlphaModes } = await import("../../src/layers/layer-blend-model.ts");
  const omitted = alphaMenu(harness().render(props())), given = alphaMenu(harness().render(props({ alphaModes: defaultAlphaModes })));
  assert.deepEqual(serialize(given.props.items), serialize(omitted.props.items));
  assert.deepEqual(serialize(given.props.accessibilityValue), serialize(omitted.props.accessibilityValue));
  assert.equal(given.props.disabled, omitted.props.disabled);
});

test("a single catalog entry renders as text and offers no alpha menu", () => {
  const tree = harness().render(props({ alphaModes: straightOnly }));
  assert.equal(alphaMenu(tree), undefined);
  const shown = texts(tree);
  assert.ok(shown.includes("Layer alpha representation"), "the row keeps its visible label");
  assert.ok(shown.includes("Straight alpha"));
  assert.equal(alertText(tree), undefined);
  assert.ok(menu(tree, "Layer blend mode"), "other controls are unaffected");
});

test("an unavailable entry is listed disabled with its reason and cannot be committed", () => {
  const h = harness(), commits = [];
  const tree = h.render(props({ alphaModes: premultipliedUnavailable, onCommit: (next, detail) => { commits.push([next, detail]); } }));
  const control = alphaMenu(tree);
  assert.equal(control.props.disabled, false, "the menu opens so the reason can be read");
  assert.deepEqual(serialize(control.props.items), [
    { id: "straight", label: "Straight alpha" },
    { id: "premultiplied", label: "Premultiplied alpha", description: "This compositor stores straight alpha only.", disabled: true },
  ]);
  control.props.onSelect("premultiplied");
  assert.deepEqual(commits, []);
  assert.deepEqual(h.runs, []);
});

test("an available alpha choice commits one alpha transaction", () => {
  const h = harness(), commits = [];
  const tree = h.render(props({ alphaModes: [{ id: "straight", label: "Straight" }, { id: "premultiplied", label: "Premultiplied" }],
    onCommit: (next, detail) => { commits.push([next, detail]); } }));
  assert.deepEqual(serialize(alphaMenu(tree).props.accessibilityValue), { text: "Straight" }, "the host's label is spoken as the value");
  alphaMenu(tree).props.onSelect("premultiplied");
  assert.deepEqual(serialize(commits), [[{ ...value, alphaMode: "premultiplied" }, { kind: "alpha" }]]);
});

test("a retained unavailable alpha shows its reason and leaves the menu open for a fix", () => {
  const h = harness(), commits = [];
  const catalog = [{ id: "straight", label: "Straight alpha" },
    { id: "premultiplied", label: "Premultiplied alpha", unavailableReason: "Imported premultiplied layers can't be composited here. Choose Straight alpha." }];
  const tree = h.render(props({ value: { ...value, alphaMode: "premultiplied" }, alphaModes: catalog, onCommit: next => { commits.push(next); } }));
  assert.equal(alertText(tree), catalog[1].unavailableReason);
  assert.equal(scrubber(tree).props.disabled, true, "opacity waits until the alpha problem is resolved, as for blend problems");
  assert.equal(alphaMenu(tree).props.disabled, false);
  for (const label of ["Layer blend mode", "Layer compositing space"])
    assert.equal(menu(tree, label).props.disabled, true, label + " is locked so it cannot open onto a pick that would be dropped");
  assert.ok(!texts(tree).some(t => t.startsWith("Premultiplied alpha: ")), "the alert already carries this reason");
  alphaMenu(tree).props.onSelect("straight");
  assert.deepEqual(serialize(commits), [{ ...value, alphaMode: "straight" }]);
});

test("a blend-mode problem still locks the alpha menu when a catalog is given", () => {
  const tree = harness().render(props({ value: { ...value, mode: "legacy" }, alphaModes: premultipliedUnavailable }));
  assert.equal(alertText(tree), "Unsupported by compositor");
  assert.equal(alphaMenu(tree).props.disabled, true);
  assert.ok(texts(tree).includes("Premultiplied alpha: This compositor stores straight alpha only."),
    "a locked menu can't show its reasons, so they render as text");
});

test("a current alpha reason masked by a blend problem still renders as text", () => {
  const catalog = [{ id: "straight", label: "Straight alpha" },
    { id: "premultiplied", label: "Premultiplied alpha", unavailableReason: "This compositor stores straight alpha only." }];
  const tree = harness().render(props({ value: { ...value, mode: "legacy", alphaMode: "premultiplied" }, alphaModes: catalog }));
  assert.equal(alertText(tree), "Unsupported by compositor");
  assert.ok(texts(tree).includes("Premultiplied alpha: This compositor stores straight alpha only."));
});

test("a host-disabled control keeps unavailable reasons on screen", () => {
  const tree = harness().render(props({ disabled: true, alphaModes: premultipliedUnavailable }));
  assert.ok(alphaMenu(tree));
  assert.ok(texts(tree).includes("Premultiplied alpha: This compositor stores straight alpha only."));
});

test("an enabled menu keeps reasons inside it and adds no extra text", () => {
  const tree = harness().render(props({ alphaModes: premultipliedUnavailable }));
  assert.ok(!texts(tree).some(t => t.includes("This compositor stores straight alpha only.")));
  assert.equal(alphaMenu(tree).key, undefined);
});

test("when no entry is available the alpha row is text and every reason is visible", () => {
  const catalog = [{ id: "straight", label: "Straight alpha", unavailableReason: "The compositor is offline." },
    { id: "premultiplied", label: "Premultiplied alpha", unavailableReason: "This compositor stores straight alpha only." }];
  const tree = harness().render(props({ alphaModes: catalog }));
  assert.equal(alphaMenu(tree), undefined, "no menu that opens onto nothing");
  const shown = texts(tree);
  assert.ok(shown.includes("Straight alpha"));
  assert.ok(shown.includes("Premultiplied alpha: This compositor stores straight alpha only."));
  assert.equal(alertText(tree), "The compositor is offline.", "the current entry's reason is announced as an alert");
});

test("invalid alpha catalogs throw RangeError from the component", () => {
  const h = harness();
  for (const alphaModes of [[], [...premultipliedUnavailable, straightOnly[0]], [straightOnly[0], straightOnly[0]],
    [{ id: "linear", label: "Linear" }], [{ id: "straight", label: " " }], [{ id: "straight", label: "Straight", unavailableReason: "" }]])
    assert.throws(() => h.render(props({ alphaModes })), { name: "RangeError" }, JSON.stringify(alphaModes));
  assert.throws(() => h.render(props({ value: { ...value, alphaMode: "premultiplied" }, alphaModes: straightOnly })),
    { name: "RangeError", message: /alpha catalog/ });
});
