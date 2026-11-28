---
name: "Photo"
namespace: "@nitro-forge"
subpath: "@nitro-forge/photo"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Photo

## Purpose

<!-- generated:begin purpose source=packages/photo/package.json,packages/studio-workspace/src/app-manifest.ts -->
Persistent photo catalog metadata and version identities. Studio task line (APP_MANIFESTS): "Organize a photo catalog". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/photo/package.json,compatibility.v1.json,tooling/docs/examples/photo.ts -->
- Package: `@nitro-forge/photo`
- Import: `import { PhotoDocument } from '@nitro-forge/photo';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/photo` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/photo/package.json,packages/photo/src/index.ts -->
Not a component, so there are no props. 2 entry points: `@nitro-forge/photo`, `@nitro-forge/photo/raw`. Top-level exports of `src/index.ts` (6): `OriginalDescriptor`, `PhotoOriginal`, `PhotoVersion`, `PhotoCatalog`, `OPS`, `PhotoDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/photo/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/photo/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/photo/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show photo state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/photo.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/photo.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the photo-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `addOriginal`, `setRating`, `readOriginal`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=photo
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { PhotoDocument } from '@nitro-forge/photo';

export const ops = ['new', 'addOriginal', 'setRating', 'readOriginal'];

export async function example(host: EngineHost) {
  const doc = await PhotoDocument.open(host);
  const { original_id } = (await doc.addOriginal({
    sha256: 'a'.repeat(64),
    asset_ref: 'library:IMG_0001.dng',
    byte_length: 1024,
    camera_make: 'Example',
    camera_model: 'One',
  })).data;
  await doc.setRating(original_id, 3);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await PhotoDocument.openSnapshot(host, bytes);
  const rating = async () => (await reopened.readOriginal(original_id)).data.original.rating;
  assert.equal(await rating(), 3);
  await reopened.setRating(original_id, 5);
  assert.equal(await rating(), 5);
  assert.equal(await reopened.undo(), true);
  assert.equal(await rating(), 3);
  assert.equal(await reopened.redo(), true);
  assert.equal(await rating(), 5);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the photo-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/photo` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/photo needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
