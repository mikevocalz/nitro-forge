---
name: "Pitch"
namespace: "@nitro-forge"
subpath: "@nitro-forge/pitch"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Pitch

## Purpose

<!-- generated:begin purpose source=packages/pitch/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge pitch document API. Studio task line (APP_MANIFESTS): "Build a presentation". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/pitch/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/pitch`
- Import: `import {} from '@nitro-forge/pitch';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/pitch` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/pitch/package.json,packages/pitch/src/index.ts -->
Not a component, so there are no props. 2 entry points: `@nitro-forge/pitch`, `@nitro-forge/pitch/office-cluster`. Top-level exports of `src/index.ts` (55): `OPS`, `Rgba`, `PitchTextStyle`, `PitchSection`, `PitchPlaceholderKind`, `PitchPlaceholder`, `PitchPlaceholderInput`, `PitchPlaceholderPatch`, `PitchMaster`, `PitchLayout`, `PitchThemeColorSlot`, `PitchThemeFontSlot`, `PitchTheme`, `Layout`, `PitchShapeKind`, `PitchShapeStroke`, `PitchAnchorSide`, `PitchConnectorEnd`, `PitchConnectorRoute`, `PitchConnectorArrows`, `PitchConnectorSpec`, `PitchConnectorUpdate`, `PitchMediaKind`, `PitchMediaFit`, `PitchMediaSpec`, `PitchMediaInput`, `PitchMediaUpdate`, `PitchChartKind`, `PitchChartPoint`, `PitchChartSeries`, `PitchChartSpec`, `PitchChartUpdate`, `PitchTableCellValue`, `PitchTableCell`, `PitchTableSpec`, `PitchTableUpdate`, `InkKind`, `PitchInkStroke`, `PitchInkStrokeInput`, `PitchInkStrokePatch`, and more.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/pitch/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/pitch/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/pitch/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/pitch/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `pitch` before calling `apply`.
- Treat `@nitro-forge/pitch` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/pitch needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
