---
name: "Pitch"
namespace: "@nitro-forge"
subpath: "@nitro-forge/pitch"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Pitch

## Purpose

<!-- generated:begin purpose source=packages/pitch/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge pitch document API. Studio task line (APP_MANIFESTS): "Build a presentation". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/pitch/package.json,compatibility.v1.json,tooling/docs/examples/pitch.ts -->
- Package: `@nitro-forge/pitch`
- Import: `import { PitchDocument } from '@nitro-forge/pitch';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/pitch` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/pitch/package.json,packages/pitch/src/index.ts -->
Not a component, so there are no props. 2 entry points: `@nitro-forge/pitch`, `@nitro-forge/pitch/office-cluster`. Top-level exports of `src/index.ts` (55): `OPS`, `Rgba`, `PitchTextStyle`, `PitchSection`, `PitchPlaceholderKind`, `PitchPlaceholder`, `PitchPlaceholderInput`, `PitchPlaceholderPatch`, `PitchMaster`, `PitchLayout`, `PitchThemeColorSlot`, `PitchThemeFontSlot`, `PitchTheme`, `Layout`, `PitchShapeKind`, `PitchShapeStroke`, `PitchAnchorSide`, `PitchConnectorEnd`, `PitchConnectorRoute`, `PitchConnectorArrows`, `PitchConnectorSpec`, `PitchConnectorUpdate`, `PitchMediaKind`, `PitchMediaFit`, `PitchMediaSpec`, `PitchMediaInput`, `PitchMediaUpdate`, `PitchChartKind`, `PitchChartPoint`, `PitchChartSeries`, `PitchChartSpec`, `PitchChartUpdate`, `PitchTableCellValue`, `PitchTableCell`, `PitchTableSpec`, `PitchTableUpdate`, `InkKind`, `PitchInkStroke`, `PitchInkStrokeInput`, `PitchInkStrokePatch`, and more.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/pitch/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/pitch/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/pitch/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show pitch state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/pitch.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/pitch.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the pitch-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addSlide`, `addText`, `deck`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=pitch
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { PitchDocument } from '@nitro-forge/pitch';

export const ops = ['new', 'addSlide', 'addText', 'deck'];

export async function example(host: EngineHost) {
  const doc = await PitchDocument.open(host, 'Q4 review');
  const slide = (await doc.addSlide('titleBody')).data.slide_id;
  await doc.addText(slide, 100, 60, 400, 60, 'Revenue', 44);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await PitchDocument.openSnapshot(host, bytes);
  const slides = async () => (await reopened.deck()).data.slide_count;
  assert.equal((await reopened.deck()).data.title, 'Q4 review');
  assert.equal(await slides(), 2);
  await reopened.addSlide('blank');
  assert.equal(await slides(), 3);
  assert.equal(await reopened.undo(), true);
  assert.equal(await slides(), 2);
  assert.equal(await reopened.redo(), true);
  assert.equal(await slides(), 3);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the pitch-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/pitch` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/pitch needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
