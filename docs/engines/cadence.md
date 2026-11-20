---
name: "Cadence"
namespace: "@nitro-forge"
subpath: "@nitro-forge/cadence"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Cadence

## Purpose

<!-- generated:begin purpose source=packages/cadence/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge cadence document API. Studio task line (APP_MANIFESTS): "Make an audio project". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/cadence/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/cadence`
- Import: `import {} from '@nitro-forge/cadence';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/cadence` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/cadence/package.json,packages/cadence/src/index.ts -->
Not a component, so there are no props. 6 entry points: `@nitro-forge/cadence`, `@nitro-forge/cadence/instrument-adapter`, `@nitro-forge/cadence/instrument-session`, `@nitro-forge/cadence/editor-adapter`, `@nitro-forge/cadence/mixer-cluster`, `@nitro-forge/cadence/transfer`. Top-level exports of `src/index.ts` (22): `OPS`, `TrackKind`, `InsertKind`, `AutomationParam`, `AutomationMode`, `EqBandType`, `EqBand`, `CompressorParams`, `InsertParams`, `AnalysisRange`, `MeterReading`, `MeterResult`, `LoudnessResult`, `SpectrogramResult`, `BeatDetectionResult`, `BeatDetectionOptions`, `CadenceMarker`, `MarkerInput`, `MarkerPatch`, `InsertPreset`, `ProjectInfo`, `CadenceDocument`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/cadence/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/cadence/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/cadence/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/cadence/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `cadence` before calling `apply`.
- Treat `@nitro-forge/cadence` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/cadence needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
