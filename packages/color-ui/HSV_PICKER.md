# Native HSV color picker (SDK 58)

**New source-level color controls**, building on
[Forge color-ui PR #26](https://github.com/mikevocalz/nitro-forge/pull/26).

`NativeHsvPicker` is a cross-platform display-color editor with:
- A touch/stylus/mouse saturation/value field backed by actual
  `expo-linear-gradient` native views (iOS/Android) and web renderer
- Exact, bounded saturation/value pointer geometry with clamp-to-field
  semantics. Touches before the first `onLayout` are ignored.
- The field keeps the touch for the whole drag: it refuses termination
  requests and blocks the native responder, so a parent `ScrollView` does not
  scroll or steal a vertical brightness drag. If the platform still cancels
  the touch (an incoming call, a system gesture), the field restores the color
  from the start of that drag, the same as a UIKit or Android touch cancel.
  A normal release keeps the last color; `onCancel` is how a host discards a
  previewed color.
- A hue spectrum preview, native SwiftUI/Compose/web `@expo/ui` Hue,
  Saturation, Brightness sliders, and RGBA/alpha controls
- `onValueChange` preview, explicit `onApply` and `onCancel` to let
  the Rust editor host create **one undo transaction per committed color**
- A single controlled HSV object; no `useState` or duplicated document
  state, preserving hue on zero saturation through `rgbToHsv`

The existing color lab now hosts the picker through one Zustand HSV value.

```tsx
import { NativeHsvPicker } from "@nitro-forge/color-ui";

<NativeHsvPicker
  value={draftColor}
  onValueChange={(next) => colorStore.setState({ hsv: next })}
  onApply={(next) => commitToRust(next)}
  onCancel={() => restoreDocumentColor()}
/>
```

**Boundary:** This picker is a display-space sRGB control, not full gamut,
ICC transform, CMYK, HDR, L*a*b*, spot ink or document color authority.
Canvas eyedropper sampling requires a real Board pixel-sampling API.
Native keyboard/screen-reader alternatives use the `@expo/ui` sliders.
Actual physical iOS/Android and Playwright web interaction, pen hover and
Surface Duo hinge/occlusion tests remain required before declaring parity.

Source inspirations are ProCraft/LightCraft under their separate licenses;
**no upstream Kotlin code or art assets were copied** here. AGPL CapCraft
code remains isolated in the explicit experimental package.
