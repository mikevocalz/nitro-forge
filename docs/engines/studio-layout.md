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

<!-- generated:begin install source=packages/studio-layout/package.json,compatibility.v1.json,tooling/docs/examples/studio-layout.ts -->
- Package: `@nitro-forge/studio-layout`
- Import: `import { collapsePanel, createWorkspace, dockPanel, parsePreset, serializePreset } from '@nitro-forge/studio-layout';`
- Peers: none
- Requires: none; pure TypeScript with no runtime dependencies
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

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/studio-layout/package.json -->
Pure functions over a `Layout` value. `dockPanel`, `collapsePanel`, `floatPanel` and `resizeDock` return `{ ok: true, layout }` or `{ ok: false, layout, reason }`, where a failed call returns the layout it was given. `parsePreset` returns `null` for a preset it rejects.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/studio-layout/package.json -->
Not UI. The workspace chrome that renders a layout (`forge-workspace`) carries its own A11y section.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/studio-layout.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/studio-layout.ts`) in Node (`tooling/docs/examples.test.ts`).

```ts example=studio-layout
import assert from 'node:assert/strict';
import { collapsePanel, createWorkspace, dockPanel, parsePreset, serializePreset } from '@nitro-forge/studio-layout';

export async function example() {
  const known = new Set(['layers', 'inspector']);
  const empty = createWorkspace('prism');

  const docked = dockPanel(empty, 'layers', 'right', 0, known);
  assert.equal(docked.ok, true);
  assert.deepEqual(docked.layout.docks.right, ['layers']);

  const unknown = dockPanel(docked.layout, 'history', 'left', 0, known);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.ok ? undefined : unknown.reason, 'unknown-panel');

  const collapsed = collapsePanel(docked.layout, 'layers', true);
  assert.deepEqual(collapsed.layout.collapsed, ['layers']);

  const saved = serializePreset(collapsed.layout, known);
  assert.deepEqual(parsePreset(saved, known), collapsed.layout);
  assert.equal(parsePreset('{"schemaVersion":2}', known), null);
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Validate saved presets with `parsePreset` before making them active.
- Pass the set of panel ids the studio knows; unknown ids fail with `unknown-panel`.
- Check `registry-excluded.json` for the reason and the condition for returning.

### Don't

- Do not run `shadcn add` for this package; it is a private workspace package with no tarball (decision 3).
- Do not mutate a `Layout` in place; use the returned layout.
- Do not publish or invent a release URL for it.
<!-- generated:end dont -->
