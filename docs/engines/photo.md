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
Persistent photo catalog metadata and version identities. Studio task line (APP_MANIFESTS): "Organize a photo catalog". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/photo/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/photo`
- Import: `import {} from '@nitro-forge/photo';`
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

<!-- generated:begin states source=packages/photo/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/photo/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/photo/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `photo` before calling `apply`.
- Treat `@nitro-forge/photo` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/photo needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
