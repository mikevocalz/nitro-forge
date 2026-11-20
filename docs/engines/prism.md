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
Nitro-Forge prism document API. Studio task line (APP_MANIFESTS): "Create an image". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/prism/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/prism`
- Import: `import {} from '@nitro-forge/prism';`
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

<!-- generated:begin states source=packages/prism/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/prism/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/prism/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `prism` before calling `apply`.
- Treat `@nitro-forge/prism` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/prism needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
