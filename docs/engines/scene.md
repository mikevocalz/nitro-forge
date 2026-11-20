---
name: "Scene"
namespace: "@nitro-forge"
subpath: "@nitro-forge/scene"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Scene

## Purpose

<!-- generated:begin purpose source=packages/scene/package.json -->
Bounded persistent 3D scene graph: TRS nodes, PBR-state materials, host-side deterministic rendering. No studio manifest names this engine. Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/scene/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/scene`
- Import: `import {} from '@nitro-forge/scene';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/scene` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/scene/package.json,packages/scene/src/index.ts -->
Not a component, so there are no props. 1 entry point: `@nitro-forge/scene`. Top-level exports of `src/index.ts` (19): `SceneTransform`, `SceneNodeKind`, `SceneCameraParams`, `SceneLightParams`, `SceneNode`, `SceneColor`, `SceneMaterial`, `SceneMesh`, `SceneState`, `SceneBounds`, `ScenePickHit`, `ScenePickResult`, `SceneTextures`, `SceneRenderRequest`, `SceneRenderDescription`, `ScenePrimitiveKind`, `ScenePrimitiveParams`, `SceneMaterialInput`, `SceneDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/scene/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/scene/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/scene/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/scene/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `scene` before calling `apply`.
- Treat `@nitro-forge/scene` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/scene needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
