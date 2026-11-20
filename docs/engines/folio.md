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
Nitro-Forge folio document API. Studio task line (APP_MANIFESTS): "Work with a PDF". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/folio/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/folio`
- Import: `import {} from '@nitro-forge/folio';`
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

<!-- generated:begin states source=packages/folio/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/folio/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/folio/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `folio` before calling `apply`.
- Treat `@nitro-forge/folio` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/folio needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
