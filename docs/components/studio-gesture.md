---
name: "StudioGesture"
namespace: "@nitro-forge"
subpath: "@/components/forge/studio-gesture"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "primitive"
tokens: []
registryDependencies: ["@nyc-tron/gestures/GestureHandlerDrag", "@nyc-tron/gestures/PanResponderDrag"]
a11yStatus: "reviewed-pass"
---

# StudioGesture

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

One-finger gesture recogniser with a shared contract. Web uses `PanResponder`; native uses a Gesture Handler Pan raced against a Tap.

## Install

- Package: `@nitro-forge/studio-gesture` (registry item)
- Import: `import { StudioGesture } from '@/components/forge/studio-gesture';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-gesture-handler` >=3.4 <4 (native file)
- Requires: `@nyc-tron/gestures/GestureHandlerDrag`; `@nyc-tron/gestures/PanResponderDrag`
- Command: `npx shadcn@4.23.0 add @nitro-forge/studio-gesture`
- Installs: `react-native-gesture-handler@^3.5.0` (the CLI adds them when they are absent)
- Files: `components/forge/studio-gesture.tsx`, `components/forge/studio-gesture.native.tsx`, `components/forge/studio-gesture-types.ts`, `components/forge/keyboard-event.ts`, `components/forge/drag-transport.ts`, `components/forge/drag-transport.native.ts`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| children | `ReactElement` | none | yes | One element; it receives the handlers. |
| onBegin | `(point) => void` | none | yes |  |
| onMove | `(point, touches) => void` | none | yes |  |
| onRelease | `(point) => void` | none | yes |  |
| onCancel | `() => void` | none | yes |  |
| disabled | `boolean` | falsy | no |  |

## Variants

### file

| Value | Effect |
|---|---|
| `studio-gesture.tsx` | Web `PanResponder`. |
| `studio-gesture.native.tsx` | Gesture Handler `Pan` (minDistance 0, maxPointers 1) raced with `Tap` (maxDistance 4). |

## States

| State | How it is set | What the code does |
|---|---|---|
| Disabled | `disabled` | Gestures not enabled. |
| Second touch | more than one pointer | `onCancel`. |
| Pan loses to Tap | native race | Tap release still fires; the lost Pan does not cancel it. |

### Motion

None.

## A11y

- Sets no role, label or state; it clones handlers onto its child.
- Review status: reviewed-pass, reviewed, no failures found in the source read. Nothing was rendered, so no item is verified (decision 34).

## Example

```tsx example=studio-gesture
import { View } from 'react-native';
import { StudioGesture } from '@/components/forge/studio-gesture';

export const Demo = () => (
  <StudioGesture onBegin={() => {}} onMove={() => {}} onRelease={() => {}} onCancel={() => {}}><View /></StudioGesture>
);
```

## Do/Don't

### Do

- Give it a single child element (`children`).
- Handle `onCancel` to drop preview state.

### Don't

- Do not wrap more than one child.
- Do not use it for multi-touch; `maxPointers(1)` and the second-touch cancel reject it.
