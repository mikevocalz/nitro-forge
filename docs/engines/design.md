---
name: "Design"
namespace: "@nitro-forge"
subpath: "@nitro-forge/design"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Design

## Purpose

<!-- generated:begin purpose source=packages/design/package.json,packages/studio-workspace/src/app-manifest.ts -->
Bounded persistent fixed-frame design layout with real Prism rendering. Studio task line (APP_MANIFESTS): "Design an interface". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/design/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/design`
- Import: `import {} from '@nitro-forge/design';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/design` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/design/package.json,packages/design/src/index.ts -->
Not a component, so there are no props. 1 entry point: `@nitro-forge/design`. Top-level exports of `src/index.ts` (79): `OPS`, `SizeMode`, `Axis`, `AxisSizing`, `AxisSizingUpdate`, `SizingSettings`, `NodeKind`, `OverridePath`, `OverrideValue`, `NodeOverride`, `ComponentVariant`, `InstanceSpec`, `TextFontStyle`, `TextStyle`, `FontStylePatch`, `TextStylePatch`, `VariableType`, `VariableValue`, `DesignVariable`, `DesignMode`, `BindPath`, `VariableBinding`, `VariableBindingInfo`, `VariableInfo`, `VariablesDescription`, `HorizontalAnchor`, `VerticalAnchor`, `NodeConstraints`, `ConstraintNodeInfo`, `ConstraintSolveInfo`, `ConstraintsDescription`, `LayoutConstraintReport`, `PrototypeTrigger`, `PrototypeAction`, `TransitionKind`, `TransitionEasing`, `SlideDirection`, `PrototypeTarget`, `PrototypeScreen`, `PrototypeHotspot`, and more.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/design/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/design/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/design/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/design/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `design` before calling `apply`.
- Treat `@nitro-forge/design` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/design needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
