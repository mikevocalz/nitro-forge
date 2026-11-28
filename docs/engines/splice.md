---
name: "Splice"
namespace: "@nitro-forge"
subpath: "@nitro-forge/splice"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Splice

## Purpose

<!-- generated:begin purpose source=packages/splice/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge splice document API. Studio task line (APP_MANIFESTS): "Edit a video timeline". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/splice/package.json,compatibility.v1.json,tooling/docs/examples/splice.ts -->
- Package: `@nitro-forge/splice`
- Import: `import { SpliceDocument } from '@nitro-forge/splice';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/splice` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/splice/package.json,packages/splice/src/index.ts -->
Not a component, so there are no props. 3 entry points: `@nitro-forge/splice`, `@nitro-forge/splice/timeline-cluster`, `@nitro-forge/splice/transfer`. Top-level exports of `src/index.ts` (14): `OPS`, `BatchableOp`, `TrackKind`, `RippleScope`, `PlacementMode`, `TRANSITION_KINDS`, `TransitionKind`, `TrackFlags`, `SpeedKey`, `CLIP_GAIN_DB_RANGE`, `CLIP_PAN_RANGE`, `ClipMix`, `ClipEditResult`, `SpliceDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/splice/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/splice/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/splice/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show splice state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/splice.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/splice.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the splice-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addSource`, `addTrack`, `addClip`, `duration`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=splice
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { SpliceDocument } from '@nitro-forge/splice';

export const ops = ['new', 'addSource', 'addTrack', 'addClip', 'duration'];

export async function example(host: EngineHost) {
  const doc = await SpliceDocument.open(host, 30);
  const source = (await doc.addSource(10, 'take1.mp4')).data.source_id;
  const track = (await doc.addTrack('video')).data.track_id;
  await doc.addClip({ track, source, in_s: 0, out_s: 4 });

  const bytes = await doc.save();
  await doc.close();

  const reopened = await SpliceDocument.openSnapshot(host, bytes);
  const seconds = async () => (await reopened.duration()).data.seconds;
  assert.equal(await seconds(), 4);
  await reopened.addClip({ track, source, in_s: 4, out_s: 10 });
  assert.equal(await seconds(), 10);
  assert.equal(await reopened.undo(), true);
  assert.equal(await seconds(), 4);
  assert.equal(await reopened.redo(), true);
  assert.equal(await seconds(), 10);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the splice-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/splice` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/splice needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
