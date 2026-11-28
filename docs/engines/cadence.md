---
name: "Cadence"
namespace: "@nitro-forge"
subpath: "@nitro-forge/cadence"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Cadence

## Purpose

<!-- generated:begin purpose source=packages/cadence/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge cadence document API. Studio task line (APP_MANIFESTS): "Make an audio project". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/cadence/package.json,compatibility.v1.json,tooling/docs/examples/cadence.ts -->
- Package: `@nitro-forge/cadence`
- Import: `import { CadenceDocument } from '@nitro-forge/cadence';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/cadence` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/cadence/package.json,packages/cadence/src/index.ts -->
Not a component, so there are no props. 6 entry points: `@nitro-forge/cadence`, `@nitro-forge/cadence/instrument-adapter`, `@nitro-forge/cadence/instrument-session`, `@nitro-forge/cadence/editor-adapter`, `@nitro-forge/cadence/mixer-cluster`, `@nitro-forge/cadence/transfer`. Top-level exports of `src/index.ts` (22): `OPS`, `TrackKind`, `InsertKind`, `AutomationParam`, `AutomationMode`, `EqBandType`, `EqBand`, `CompressorParams`, `InsertParams`, `AnalysisRange`, `MeterReading`, `MeterResult`, `LoudnessResult`, `SpectrogramResult`, `BeatDetectionResult`, `BeatDetectionOptions`, `CadenceMarker`, `MarkerInput`, `MarkerPatch`, `InsertPreset`, `ProjectInfo`, `CadenceDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/cadence/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/cadence/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/cadence/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show cadence state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/cadence.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/cadence.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the cadence-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addTrack`, `addClip`, `addNote`, `project`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=cadence
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { CadenceDocument } from '@nitro-forge/cadence';

export const ops = ['new', 'addTrack', 'addClip', 'addNote', 'project'];

export async function example(host: EngineHost) {
  const doc = await CadenceDocument.open(host, 120);
  const track = (await doc.addTrack('midi', 'Keys')).data.track_id;
  const clip = (await doc.addClip(track, 0, 960)).data.clip_id;
  await doc.addNote(clip, 69, 0, 960, 100);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await CadenceDocument.openSnapshot(host, bytes);
  const tracks = async () => (await reopened.project()).data.track_count;
  assert.equal((await reopened.project()).data.tempo_bpm, 120);
  assert.equal(await tracks(), 1);
  await reopened.addTrack('midi', 'Bass');
  assert.equal(await tracks(), 2);
  assert.equal(await reopened.undo(), true);
  assert.equal(await tracks(), 1);
  assert.equal(await reopened.redo(), true);
  assert.equal(await tracks(), 2);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the cadence-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/cadence` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/cadence needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
