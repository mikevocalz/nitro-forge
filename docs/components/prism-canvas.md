---
name: "PrismCanvas"
namespace: "@nitro-forge"
subpath: "@/components/forge/prism-canvas"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: ["--border-width-strong", "--color-artboard-checker-a", "--color-artboard-checker-b", "--color-on-overlay-chip", "--color-overlay-chip", "--shadow-artboard", "--spacing-fixed-stack"]
registryDependencies: ["@nitro-forge/forge-directions", "@nitro-forge/studio-gesture", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider"]
a11yStatus: "reviewed-fail"
---

# PrismCanvas

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

The Prism artboard: a transparency checker, the engine composite as children, an optional overlay, a selection outline, and one-finger move gestures that preview bounds and commit once on release.

## Install

- Package: `@nitro-forge/prism-canvas` (registry item)
- Import: `import { PrismCanvas, ARTBOARD_CHECKER } from '@/components/forge/prism-canvas';`  (the original line carried a note; see Notes)
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-theme`; `@nitro-forge/forge-directions`; `@nitro-forge/studio-gesture`
- Command: `npx shadcn@4.23.0 add @nitro-forge/prism-canvas`
- Installs: `react-native-svg@15.16.0`, `zustand@5.1.0` (the CLI adds them when they are absent)
- Files: `components/forge/prism-canvas.tsx`, `components/forge/prism-canvas-model.ts`

## Props

Extends: Exports `ARTBOARD_CHECKER` = `{size: 8, light: "#FFFFFF", dark: "#EDEFF3"}`.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| document | `CanvasDocument` | none | yes | `{width, height, layers}`. |
| width, height | `number` | none | yes | Artboard size in points. |
| selectedId | `number \| null` | none | yes |  |
| disabled | `boolean` | none | yes | Cancels any gesture. |
| color | `string` | none | yes | Selection outline colour. |
| children | `ReactNode` | none | yes | The engine composite. |
| overlay | `ReactNode` | none | no | Replaces the built-in outline. |
| onSelect | `(id: number \| null) => void` | none | yes |  |
| onMoveShape | `(id, dx, dy) => void` | none | yes | Called once on release. |

## Variants

none

## States

| State | How it is set | What the code does |
|---|---|---|
| Selected | `selectedId` matches a layer | Outline `prism-selection-bounds`. |
| Moving | drag | Preview badge "Move preview · release to apply" and "Cancel move". |
| Disabled | `disabled` | Gestures ignored. |
| Reset | document, size or disabled changes | Any open gesture is cancelled. |

### Motion

None. The preview is a static outline offset.

## A11y

- Artboard label: "Prism artboard. Select layers or use Transform for accessible move actions."
- Escape cancels a gesture.
- Web: `touchAction: none`; scroll, resize and blur cancel the gesture because measured geometry goes stale.
- The cancel button is a provider `Button` with `aria-label="Cancel shape move"`.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N04 1.4.3: Cancel move ghost label on #111827 chip 1.11:1 (chrome light) and 1.24:1 (reference light) (prism-canvas.tsx:96-97)

## Example

```tsx example=prism-canvas
import { PrismCanvas } from '@/components/forge/prism-canvas';
import { View } from 'react-native';

export const Demo = () => (
  <PrismCanvas document={{ width: 800, height: 600, layers: [] }} width={400} height={300}
    selectedId={null} disabled={false} color="#086CB8" onSelect={() => {}} onMoveShape={() => {}}>
    <View />
  </PrismCanvas>
);
```

## Do/Don't

### Do

- Commit on `onMoveShape` only; it fires once per release.
- Pass `disabled` while the engine is busy.
- Use `overlay` to draw your own selection UI.

### Don't

- Do not treat the move preview as document state.
- Do not rely on `platforms: ["web"]` meaning web only: the file branches on `Platform.OS === "web"` for listeners and runs on native through `studio-gesture`.
