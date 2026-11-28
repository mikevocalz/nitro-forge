---
name: "Prism"
namespace: "@nitro-forge"
subpath: "@nitro-forge/prism"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Prism

## Purpose

<!-- generated:begin purpose source=packages/prism/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge prism document API. Studio task line (APP_MANIFESTS): "Create an image". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/prism/package.json,compatibility.v1.json,tooling/docs/examples/prism.ts -->
- Package: `@nitro-forge/prism`
- Import: `import { PrismDocument } from '@nitro-forge/prism';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/prism` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/prism/package.json,packages/prism/src/index.ts -->
Not a component, so there are no props. 3 entry points: `@nitro-forge/prism`, `@nitro-forge/prism/canvas-cluster`, `@nitro-forge/prism/color-cluster`. Top-level exports of `src/index.ts` (9): `OPS`, `PrismColors`, `PrismColorChange`, `RectShape`, `EllipseShape`, `Shape`, `ShapeTransform`, `Filter`, `PrismDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/prism/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/prism/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/prism/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show prism state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/prism.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/prism.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the prism-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addRasterLayer`, `fillLayer`, `flatten`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=prism
import assert from 'node:assert/strict';
import { base64ToBytes, type EngineHost } from '@nitro-forge/ignition';
import { PrismDocument } from '@nitro-forge/prism';

export const ops = ['new', 'addRasterLayer', 'fillLayer', 'flatten'];

export async function example(host: EngineHost) {
  const doc = await PrismDocument.open(host, 2, 2);
  const layer = (await doc.addRasterLayer('Background')).data.layer_id;
  await doc.fillLayer(layer, [0, 0, 255, 255]);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await PrismDocument.openSnapshot(host, bytes);
  const firstPixel = async () => [...base64ToBytes((await reopened.flatten()).data.pixels_b64).subarray(0, 4)];
  assert.deepEqual(await firstPixel(), [0, 0, 255, 255]);
  await reopened.fillLayer(layer, [255, 0, 0, 255]);
  assert.deepEqual(await firstPixel(), [255, 0, 0, 255]);
  assert.equal(await reopened.undo(), true);
  assert.deepEqual(await firstPixel(), [0, 0, 255, 255]);
  assert.equal(await reopened.redo(), true);
  assert.deepEqual(await firstPixel(), [255, 0, 0, 255]);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the prism-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/prism` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/prism needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
