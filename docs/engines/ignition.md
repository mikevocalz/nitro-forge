---
name: "Ignition"
namespace: "@nitro-forge"
subpath: "@nitro-forge/ignition"
tier: 2
docs: "generated"
platforms: []
category: "primitive"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Ignition

## Purpose

<!-- generated:begin purpose source=packages/ignition/package.json -->
Nitro-Forge native integration layer: engine session contracts, Nitro HybridObject spec, and host transports. Not a registry item. Decision 4. shadcn copies files. It cannot run nitrogen, pod install or CMake. Documented as a prerequisite with the exact commands in docs/agent-native/install-order.md.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/ignition/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/ignition`
- Import: `import {} from '@nitro-forge/ignition';`
- Peers: `react-native-nitro-modules`, `nitro-core`
- Requires: Rust, Xcode or the Android NDK; see docs/agent-native/install-order.md steps 0 and 1
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/ignition` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/ignition/package.json,packages/ignition/src/index.ts -->
Not a component, so there are no props. 13 entry points: `@nitro-forge/ignition`, `@nitro-forge/ignition/cli`, `@nitro-forge/ignition/nitro`, `@nitro-forge/ignition/v1-host`, `@nitro-forge/ignition/workspace`, `@nitro-forge/ignition/transfer`, `@nitro-forge/ignition/workspace-ui`, `@nitro-forge/ignition/transfer-ui`, `@nitro-forge/ignition/autosave`, `@nitro-forge/ignition/transactions`, `@nitro-forge/ignition/collaboration`, `@nitro-forge/ignition/collaboration-http`, `@nitro-forge/ignition/collaboration-checkpoint`. 
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/ignition/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/ignition/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/ignition/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Follow the commands in docs/agent-native/install-order.md for `@nitro-forge/ignition`.
- Check `registry-excluded.json` for the reason and the condition for returning.

### Don't

- Do not run `shadcn add` for this package; Decision 4.
- Do not publish or invent a release URL for it.
<!-- generated:end dont -->
