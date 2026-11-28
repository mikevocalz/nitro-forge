---
name: "Design"
namespace: "@nitro-forge"
subpath: "@nitro-forge/design"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Design

## Purpose

<!-- generated:begin purpose source=packages/design/package.json,packages/studio-workspace/src/app-manifest.ts -->
Bounded persistent fixed-frame design layout with real Prism rendering. Studio task line (APP_MANIFESTS): "Design an interface". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/design/package.json,compatibility.v1.json,tooling/docs/examples/design.ts -->
- Package: `@nitro-forge/design`
- Import: `import { DesignDocument } from '@nitro-forge/design';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/design` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/design/package.json,packages/design/src/index.ts -->
Not a component, so there are no props. 1 entry point: `@nitro-forge/design`. Top-level exports of `src/index.ts` (79): `OPS`, `SizeMode`, `Axis`, `AxisSizing`, `AxisSizingUpdate`, `SizingSettings`, `NodeKind`, `OverridePath`, `OverrideValue`, `NodeOverride`, `ComponentVariant`, `InstanceSpec`, `TextFontStyle`, `TextStyle`, `FontStylePatch`, `TextStylePatch`, `VariableType`, `VariableValue`, `DesignVariable`, `DesignMode`, `BindPath`, `VariableBinding`, `VariableBindingInfo`, `VariableInfo`, `VariablesDescription`, `HorizontalAnchor`, `VerticalAnchor`, `NodeConstraints`, `ConstraintNodeInfo`, `ConstraintSolveInfo`, `ConstraintsDescription`, `LayoutConstraintReport`, `PrototypeTrigger`, `PrototypeAction`, `TransitionKind`, `TransitionEasing`, `SlideDirection`, `PrototypeTarget`, `PrototypeScreen`, `PrototypeHotspot`, and more.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/design/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/design/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/design/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show design state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/design.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/design.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the design-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addShape`, `updateNode`, `describe`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=design
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { DesignDocument } from '@nitro-forge/design';

export const ops = ['new', 'addShape', 'updateNode', 'describe'];

export async function example(host: EngineHost) {
  const doc = await DesignDocument.open(host, { width: 320, height: 200 });
  const root = 1;
  const card = (await doc.addShape(root, 'rect', { name: 'Card', x: 16, y: 16, width: 120, height: 80 })).data.node_id;

  const bytes = await doc.save();
  await doc.close();

  const reopened = await DesignDocument.openSnapshot(host, bytes);
  const width = async () => (await reopened.describe()).data.nodes[String(card)]?.width;
  assert.equal(await width(), 120);
  await reopened.updateNode(card, { width: 200 });
  assert.equal(await width(), 200);
  assert.equal(await reopened.undo(), true);
  assert.equal(await width(), 120);
  assert.equal(await reopened.redo(), true);
  assert.equal(await width(), 200);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the design-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/design` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/design needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
