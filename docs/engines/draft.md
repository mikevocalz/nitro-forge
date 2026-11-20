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
Bounded persistent world-space 2D drafting and linear coordinate constraints. Studio task line (APP_MANIFESTS): "Draw a CAD document". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/draft/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/draft`
- Import: `import {} from '@nitro-forge/draft';`
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

<!-- generated:begin states source=packages/draft/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/draft/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/draft/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `draft` before calling `apply`.
- Treat `@nitro-forge/draft` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/draft needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
