---
name: "StudioLayout"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-layout"
tier: 2
docs: "generated"
platforms: []
category: "primitive"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# StudioLayout

## Purpose

<!-- generated:begin purpose source=packages/studio-layout/package.json -->
The package has no description field. Not a registry item. Decision 3. Private workspace package with no tarball and no versioning scheme.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/studio-layout/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/studio-layout`
- Import: `import {} from '@nitro-forge/studio-layout';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/studio-layout` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/studio-layout/package.json,packages/studio-layout/src/index.ts -->
Not a component, so there are no props. 1 entry point: `@nitro-forge/studio-layout`. Top-level exports of `src/index.ts` (24): `STUDIOS`, `Studio`, `DOCKS`, `Dock`, `Rect`, `Geometry`, `DockSizes`, `Layout`, `Reason`, `Result`, `createWorkspace`, `parsePreset`, `serializePreset`, `stageFits`, `dockPanel`, `collapsePanel`, `floatPanel`, `resizeDock`, `DockAction`, `applyDockAction`, `Point`, `DockDropPreview`, `DockDropQuery`, `resolveDockDropPreview`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/studio-layout/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/studio-layout/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/studio-layout/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/studio-layout/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Follow the commands in docs/agent-native/install-order.md for `@nitro-forge/studio-layout`.
- Check `registry-excluded.json` for the reason and the condition for returning.

### Don't

- Do not run `shadcn add` for this package; Decision 3.
- Do not publish or invent a release URL for it.
<!-- generated:end dont -->
