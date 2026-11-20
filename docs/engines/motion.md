---
name: "Motion"
namespace: "@nitro-forge"
subpath: "@nitro-forge/motion"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Motion

## Purpose

<!-- generated:begin purpose source=packages/motion/package.json,packages/studio-workspace/src/app-manifest.ts -->
Bounded persistent 2D motion with Prism frame rendering. Studio task line (APP_MANIFESTS): "Build a motion composition". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/motion/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/motion`
- Import: `import {} from '@nitro-forge/motion';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/motion` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/motion/package.json,packages/motion/src/index.ts -->
Not a component, so there are no props. 1 entry point: `@nitro-forge/motion`. Top-level exports of `src/index.ts` (40): `MotionProperty`, `MotionPathNode`, `MotionPath`, `CurvePoint`, `MotionKey`, `MotionKeyInput`, `Transform`, `Transform3D`, `ProjectedTransform2D`, `MotionLight`, `Shape`, `LayerKind`, `MotionBlendMode`, `MotionMatteMode`, `MotionMatte`, `MotionMatteInput`, `MotionEffect`, `MotionSprite`, `MotionEmitter`, `MotionExpression`, `MotionGraphNodeKind`, `MotionGraphEdge`, `MotionGraphNodeParams`, `MotionGraphNode`, `MotionGraphBinding`, `MotionGraph`, `MotionGraphInput`, `MotionLayerMedia`, `MotionLayer`, `MOTION_RASTER_FORMAT`, `MotionRasterAsset`, `CompositionSettings`, `MotionComposition`, `MotionState`, `MotionEvaluation`, `RenderJobStatus`, `RenderJob`, `RenderQueueSummary`, `RenderQueueStep`, `MotionDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/motion/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/motion/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/motion/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/motion/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `motion` before calling `apply`.
- Treat `@nitro-forge/motion` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/motion needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
