---
name: "Motion"
namespace: "@nitro-forge"
subpath: "@nitro-forge/motion"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Motion

## Purpose

<!-- generated:begin purpose source=packages/motion/package.json,packages/studio-workspace/src/app-manifest.ts -->
Bounded persistent 2D motion with Prism frame rendering. Studio task line (APP_MANIFESTS): "Build a motion composition". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/motion/package.json,compatibility.v1.json,tooling/docs/examples/motion.ts -->
- Package: `@nitro-forge/motion`
- Import: `import { MotionDocument } from '@nitro-forge/motion';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/motion` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/motion/package.json,packages/motion/src/index.ts -->
Not a component, so there are no props. 1 entry point: `@nitro-forge/motion`. Top-level exports of `src/index.ts` (40): `MotionProperty`, `MotionPathNode`, `MotionPath`, `CurvePoint`, `MotionKey`, `MotionKeyInput`, `Transform`, `Transform3D`, `ProjectedTransform2D`, `MotionLight`, `Shape`, `LayerKind`, `MotionBlendMode`, `MotionMatteMode`, `MotionMatte`, `MotionMatteInput`, `MotionEffect`, `MotionSprite`, `MotionEmitter`, `MotionExpression`, `MotionGraphNodeKind`, `MotionGraphEdge`, `MotionGraphNodeParams`, `MotionGraphNode`, `MotionGraphBinding`, `MotionGraph`, `MotionGraphInput`, `MotionLayerMedia`, `MotionLayer`, `MOTION_RASTER_FORMAT`, `MotionRasterAsset`, `CompositionSettings`, `MotionComposition`, `MotionState`, `MotionEvaluation`, `RenderJobStatus`, `RenderJob`, `RenderQueueSummary`, `RenderQueueStep`, `MotionDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/motion/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/motion/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/motion/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show motion state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/motion.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/motion.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the motion-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addShapeLayer`, `describe`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=motion
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { MotionDocument } from '@nitro-forge/motion';

export const ops = ['new', 'addShapeLayer', 'describe'];

export async function example(host: EngineHost) {
  const doc = await MotionDocument.open(host, { width: 64, height: 36, duration_s: 2 });
  await doc.addShapeLayer({ kind: 'rect', x: 0, y: 0, w: 8, h: 8, fill: [255, 0, 0, 255] }, 'Box');

  const bytes = await doc.save();
  await doc.close();

  const reopened = await MotionDocument.openSnapshot(host, bytes);
  const layerNames = async () => (await reopened.describe()).data.layers.map((l) => l.name);
  assert.deepEqual(await layerNames(), ['Box']);
  await reopened.addShapeLayer({ kind: 'rect', x: 8, y: 0, w: 8, h: 8, fill: [0, 0, 255, 255] }, 'Second box');
  assert.deepEqual(await layerNames(), ['Box', 'Second box']);
  assert.equal(await reopened.undo(), true);
  assert.deepEqual(await layerNames(), ['Box']);
  assert.equal(await reopened.redo(), true);
  assert.deepEqual(await layerNames(), ['Box', 'Second box']);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the motion-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/motion` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/motion needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
