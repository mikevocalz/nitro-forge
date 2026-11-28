---
name: "Draft"
namespace: "@nitro-forge"
subpath: "@nitro-forge/draft"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Draft

## Purpose

<!-- generated:begin purpose source=packages/draft/package.json,packages/studio-workspace/src/app-manifest.ts -->
Bounded persistent world-space 2D drafting and linear coordinate constraints. Studio task line (APP_MANIFESTS): "Draw a CAD document". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/draft/package.json,compatibility.v1.json,tooling/docs/examples/draft.ts -->
- Package: `@nitro-forge/draft`
- Import: `import { DraftDocument } from '@nitro-forge/draft';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/draft` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/draft/package.json,packages/draft/src/index.ts -->
Not a component, so there are no props. 1 entry point: `@nitro-forge/draft`. Top-level exports of `src/index.ts` (29): `DraftPoint`, `DraftLayer`, `DraftSegment`, `DraftCircle`, `DraftArc`, `ConstraintDefinition`, `DraftConstraint`, `DraftHatchLoops`, `DraftHatchPattern`, `DraftHatch`, `DraftDimensionKind`, `DraftDimensionAxis`, `DraftDimension`, `DraftDimensionMeasured`, `DraftDimensionState`, `DraftSheet`, `DraftViewportEntity`, `DraftBlock`, `DraftInsert`, `SnapSettings`, `DraftState`, `SolveReport`, `SnapResult`, `DraftSnapQuery`, `DraftProfileBounds`, `DraftProfile`, `DraftProfiles`, `DraftViewport`, `DraftDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/draft/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/draft/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/draft/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show draft state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/draft.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/draft.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the draft-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addPoint`, `addSegment`, `updatePoint`, `describe`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=draft
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { DraftDocument } from '@nitro-forge/draft';

export const ops = ['new', 'addPoint', 'addSegment', 'updatePoint', 'describe'];

export async function example(host: EngineHost) {
  const doc = await DraftDocument.open(host, 'mm');
  const a = (await doc.addPoint(0, 0)).data.point_id;
  const b = (await doc.addPoint(30, 0)).data.point_id;
  await doc.addSegment(a, b, { name: 'Wall' });

  const bytes = await doc.save();
  await doc.close();

  const reopened = await DraftDocument.openSnapshot(host, bytes);
  const endX = async () => (await reopened.describe()).data.points[String(b)]?.x;
  assert.equal(await endX(), 30);
  await reopened.updatePoint(b, { x: 45 });
  assert.equal(await endX(), 45);
  assert.equal(await reopened.undo(), true);
  assert.equal(await endX(), 30);
  assert.equal(await reopened.redo(), true);
  assert.equal(await endX(), 45);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the draft-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/draft` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/draft needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
