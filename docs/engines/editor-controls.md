---
name: "EditorControls"
namespace: "@nitro-forge"
subpath: "@nitro-forge/editor-controls"
tier: 2
docs: "generated"
platforms: []
category: "primitive"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# EditorControls

## Purpose

<!-- generated:begin purpose source=packages/editor-controls/package.json -->
Nitro Forge editor controls (audio, timeline, spreadsheet, canvas, color, photo, motion, office and more) built on NYC-Tron UI primitives. Moved here from @nyc-tron/ui/components/forge. The editor controls (audio and MIDI, timeline, spreadsheet, canvas and layers, color, photo, motion, vector, office, PDF) moved here unchanged from NYC-Tron UI's `packages/ui/src/components/forge/` at commit `5a1ea4db`. Import them as `@nitro-forge/editor-controls/<path>`: the export `./<path>` is the old `@nyc-tron/ui/components/forge/<path>`, except three precision helpers that now come from `@nyc-tron/ui/components/shell/`. Nothing in Forge may import `@nyc-tron/ui/components/forge/*`; `node tooling/verify-nyc-tron-pin.mjs` fails if anything does. Not a registry item. Decision 3. Private workspace package with no tarball and no versioning scheme. Forge owns the editor controls since #95; they moved here unchanged from NYC-Tron UI, and nothing in Forge imports @nyc-tron/ui/components/forge/*.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/editor-controls/package.json,compatibility.v1.json,tooling/docs/examples/editor-controls.ts -->
- Package: `@nitro-forge/editor-controls`
- Import: `import { formatOpacity, moveLayer, stepOpacity, validateLayers, type LayerRow } from '@nitro-forge/editor-controls/layers/layer-model';`
- Peers: `@expo/ui`, `expo-linear-gradient`, `react`, `react-native`, `react-native-gesture-handler`, `react-native-skia`
- Requires: `@nyc-tron/ui` from the release pinned in `tooling/nyc-tron.json`, with `patches/@nyc-tron__ui@1.0.0-rc.2.patch` adding 20 export-map entries rc.2 lacks (packages/editor-controls/README.md)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/editor-controls` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/editor-controls/package.json,packages/editor-controls/src/index.ts -->
Not a component, so there are no props. 450 entry points: `@nitro-forge/editor-controls/WaveformLane`, `@nitro-forge/editor-controls/NativeSeekBar`, `@nitro-forge/editor-controls/ColorChannels`, `@nitro-forge/editor-controls/waveform`, `@nitro-forge/editor-controls/timebase`, `@nitro-forge/editor-controls/audio/level`, `@nitro-forge/editor-controls/audio/LevelFader`, `@nitro-forge/editor-controls/color`, `@nitro-forge/editor-controls/color/HsvPicker`, `@nitro-forge/editor-controls/color/fieldGeometry`, `@nitro-forge/editor-controls/color/fieldGesture`, `@nitro-forge/editor-controls/color/AlphaSlider`, `@nitro-forge/editor-controls/color/ColorWheel`, `@nitro-forge/editor-controls/color/ColorDiscPicker`, `@nitro-forge/editor-controls/color/ColorChannelFields`, `@nitro-forge/editor-controls/color/ForegroundBackgroundChips`, and 434 more in `packages/editor-controls/package.json`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/editor-controls/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/editor-controls/package.json -->
Controlled components: the caller passes values and callbacks. The controls own no persistence, file I/O, engine state or undo; the engine adapters (`@nitro-forge/cadence`, `@nitro-forge/tally` and the rest) supply those.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/editor-controls/package.json -->
Not part of the agent-native source review, so nothing here is verified (decision 34). The package has its own render tests, including `packages/editor-controls/tests/render/screen-reader-audit.render.test.mjs`; this page does not restate their results.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/editor-controls.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/editor-controls.ts`) in Node (`tooling/docs/examples.test.ts`).

```ts example=editor-controls
import assert from 'node:assert/strict';
import { formatOpacity, moveLayer, stepOpacity, validateLayers, type LayerRow } from '@nitro-forge/editor-controls/layers/layer-model';

export async function example() {
  const rows: LayerRow[] = [
    { id: 'title', name: 'Title', kind: 'text', visible: true, opacity: 1 },
    { id: 'photo', name: 'Photo', kind: 'raster', visible: true, opacity: 0.8 },
    { id: 'paper', name: 'Paper', kind: 'raster', visible: false, opacity: 1 },
  ];
  validateLayers(rows);

  const reordered = moveLayer(rows, 'paper', 0);
  assert.deepEqual(reordered.map((row) => row.id), ['paper', 'title', 'photo']);

  assert.equal(stepOpacity(0.8, 1), 0.85);
  assert.equal(formatOpacity(0.85), '85%');
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Add `"@nitro-forge/editor-controls": "workspace:*"` to the consuming package and import `@nitro-forge/editor-controls/<path>`.
- Run `pnpm --filter @nitro-forge/editor-controls build` before typechecking a consumer on its own; consumers typecheck against `dist/`.
- Extend the control that exists here (knob, graph, crop overlay and the rest) instead of writing a second one in another package.
- Check `registry-excluded.json` for the reason and the condition for returning.

### Don't

- Do not import `@nyc-tron/ui/components/forge/*` or depend on `@nyc-tron/forge/*` registry items; the controls live here now.
- Do not run `shadcn add` for this package; it is a private workspace package with no tarball (decision 3).
- Do not publish or invent a release URL for it.
<!-- generated:end dont -->
