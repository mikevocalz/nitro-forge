---
name: "Folio"
namespace: "@nitro-forge"
subpath: "@nitro-forge/folio"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Folio

## Purpose

<!-- generated:begin purpose source=packages/folio/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge folio document API. Studio task line (APP_MANIFESTS): "Work with a PDF". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/folio/package.json,compatibility.v1.json,tooling/docs/examples/folio.ts -->
- Package: `@nitro-forge/folio`
- Import: `import { FolioDocument } from '@nitro-forge/folio';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/folio` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/folio/package.json,packages/folio/src/index.ts -->
Not a component, so there are no props. 4 entry points: `@nitro-forge/folio`, `@nitro-forge/folio/office-cluster`, `@nitro-forge/folio/render`, `@nitro-forge/folio/transfer`. Top-level exports of `src/index.ts` (27): `OPS`, `Rect`, `AnnotSubtype`, `InkStroke`, `InkPaths`, `FolioPermission`, `FolioImageFormat`, `FolioPageImage`, `FolioEncryptOptions`, `Annotation`, `FolioCommentMetadata`, `FolioCommentEntry`, `FolioCommentThread`, `FolioOutlineItem`, `FolioFormField`, `FolioSignature`, `FolioAttachmentInfo`, `FolioRedactRetainedReason`, `FolioRedactReport`, `FolioComparePageChange`, `FolioCompareAnnotEntry`, `FolioCompareField`, `FolioCompareOutlineItem`, `FolioCompareSignature`, `FolioCompareResult`, `FolioPageInfo`, `FolioDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/folio/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/folio/package.json -->
A document is live from `open`, `create`, `openPdf` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/folio/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show folio state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/folio.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/folio.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the folio-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `pageCount`, `addAnnotation`, `listAnnotations`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=folio
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { FolioDocument } from '@nitro-forge/folio';

export const ops = ['new', 'pageCount', 'addAnnotation', 'listAnnotations'];

export async function example(host: EngineHost) {
  const doc = await FolioDocument.create(host, 2);
  assert.equal((await doc.pageCount()).data.pages, 2);
  await doc.addAnnotation(0, [100, 700, 200, 20], 'Check this total');

  const bytes = await doc.save();
  await doc.close();

  const reopened = await FolioDocument.openSnapshot(host, bytes);
  const notes = async () => (await reopened.listAnnotations(0)).data.annots.map((a) => a.contents);
  assert.deepEqual(await notes(), ['Check this total']);
  await reopened.addAnnotation(0, [100, 600, 200, 20], 'Second note');
  assert.equal((await notes()).length, 2);
  assert.equal(await reopened.undo(), true);
  assert.deepEqual(await notes(), ['Check this total']);
  assert.equal(await reopened.redo(), true);
  assert.equal((await notes()).length, 2);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the folio-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/folio` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/folio needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
