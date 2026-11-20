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
Nitro-Forge splice document API. Studio task line (APP_MANIFESTS): "Edit a video timeline". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/splice/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/splice`
- Import: `import {} from '@nitro-forge/splice';`
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

<!-- generated:begin states source=packages/splice/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/splice/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/splice/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `splice` before calling `apply`.
- Treat `@nitro-forge/splice` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/splice needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
