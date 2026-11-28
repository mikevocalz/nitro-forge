---
name: "Quill"
namespace: "@nitro-forge"
subpath: "@nitro-forge/quill"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Quill

## Purpose

<!-- generated:begin purpose source=packages/quill/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge quill document API. Studio task line (APP_MANIFESTS): "Write a document". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/quill/package.json,compatibility.v1.json,tooling/docs/examples/quill.ts -->
- Package: `@nitro-forge/quill`
- Import: `import { QuillDocument } from '@nitro-forge/quill';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/quill` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/quill/package.json,packages/quill/src/index.ts -->
Not a component, so there are no props. 3 entry points: `@nitro-forge/quill`, `@nitro-forge/quill/office-cluster`, `@nitro-forge/quill/transfer`. Top-level exports of `src/index.ts` (67): `OPS`, `TextCase`, `BlockKind`, `ListKind`, `ListFormat`, `ListLevel`, `ListDefinition`, `ListItem`, `Pos`, `Range`, `Style`, `LayoutLine`, `LayoutPage`, `TocPageEntry`, `TocFieldPages`, `LayoutResult`, `RenderPageResult`, `RenderPageOptions`, `FindMatch`, `CellPos`, `CellFindMatch`, `Bookmark`, `NamedStyleKind`, `ParagraphAlignment`, `TabAlignment`, `TabLeader`, `TabStop`, `ParagraphFormat`, `ParagraphFormatPatch`, `NamedStyleProperties`, `NamedStyle`, `FindOptions`, `CommentAnchor`, `DocComment`, `RevisionKind`, `Revision`, `FootnoteKind`, `Footnote`, `TocEntry`, `TocField`, and more.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/quill/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/quill/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/quill/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show quill state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/quill.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/quill.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the quill-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `insertText`, `text`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=quill
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { QuillDocument } from '@nitro-forge/quill';

export const ops = ['new', 'insertText', 'text'];

export async function example(host: EngineHost) {
  const doc = await QuillDocument.open(host);
  await doc.insertText({ block: 0, offset: 0 }, 'Hello');

  const bytes = await doc.save();
  await doc.close();

  const reopened = await QuillDocument.openSnapshot(host, bytes);
  const text = async () => (await reopened.text()).data.text;
  assert.equal(await text(), 'Hello');
  await reopened.insertText({ block: 0, offset: 5 }, ' world');
  assert.equal(await text(), 'Hello world');
  assert.equal(await reopened.undo(), true);
  assert.equal(await text(), 'Hello');
  assert.equal(await reopened.redo(), true);
  assert.equal(await text(), 'Hello world');
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the quill-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/quill` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/quill needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
