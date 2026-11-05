# HSV color picker (SDK 58)

`HsvPicker` is owned by NYC-Tron UI
(`@nyc-tron/ui/components/forge/color/HsvPicker`, pinned to v0.1.0-alpha.2 in
`tooling/nyc-tron.json`). `@nitro-forge/color-ui` re-exports it with its field
helpers: `HsvPicker`, `pointToHsv`, `hsvToPoint`, `createFieldGesture` and
`assertHsv`. The Forge copy that lived here (`NativeHsvPicker` and its
`field*` modules) was removed so there is one implementation.

What the NYC-Tron picker does:
- A saturation/value field drawn with `expo-linear-gradient`, a native
  `@expo/ui` hue slider (0-359), 44pt saturation and brightness steppers, and
  optional RGBA channels.
- The field ignores touches before the first `onLayout`, refuses responder
  termination during a drag so a parent `ScrollView` cannot steal it, and
  restores the drag-start color if the platform cancels the touch.
- One controlled `HsvColor` value. `onValueChange` previews; `onApply` and
  `onCancel` let the Rust host make one undo transaction per committed color.

Screen readers: the field is `adjustable`. Increment and decrement step
saturation by `step` (default 0.05) and clamp at 0 and 1. Named actions step
brightness and hue (`hueStep`, default 5 degrees). The announced value and the
visible label show hue as 0-359; 359.6 reads as 0. The hue slider has no
accessible name of its own, which is why the field carries the hue actions.
None of this has run under VoiceOver or TalkBack yet.

The color lab (`apps/forge-color-lab`) hosts the picker through one Zustand
HSV value and needs `expo-linear-gradient`, `@expo/ui` and Uniwind:

```tsx
import { HsvPicker } from "@nyc-tron/ui/components/forge/color/HsvPicker";

<HsvPicker
  value={draftColor}
  onValueChange={(next) => colorStore.setState({ hsv: next })}
  onApply={(next) => commitToRust(next)}
  onCancel={() => restoreDocumentColor()}
/>
```

**Boundary:** this is a display-space sRGB control, not a gamut, ICC, CMYK,
HDR, L\*a\*b\*, spot ink or document color authority. Canvas eyedropper
sampling needs a real Board pixel-sampling API. Physical iOS/Android and
Playwright web interaction, pen hover and Surface Duo hinge tests are still
required before claiming parity.
