# @nitro-forge/color-ui

Cross-platform Expo **SDK 58** native color components for the Nitro Forge
editor suite, based on the native API, Expo UI, and ArtCraft source research.

## Source-level P0 slice

`NativeColorChannels`: controlled RGB and opacity controls with a live
color swatch and hex readout. Uses actual **SwiftUI** and **Jetpack Compose**
sliders via the `@expo/ui` universal API and the same API's web fallback;
React Native provides the swatch container.

`rgbaToHex`, `parseHexColor`, `rgbToHsv`, `hsvToRgb` provide
deterministic document-agnostic display color calculations. They do **not**
replace Rust ICC profile management, HDR, P3, CMYK, spot ink or theme color
references, and must not flatten document colors when saving.

```tsx
import { NativeColorChannels } from '@nitro-forge/color-ui';

<NativeColorChannels
  value={selectedDisplayColor}
  onValueChange={(rgba) => updatePreviewColor(rgba)}
  testID="prism-fill-color"
/>;
```

No local React state is created. The host/Rust document retains the
authoritative color data and group undo commits.

**Not yet implemented:** wheel, hue/SV field, eyedropper, gradients,
sample-from-canvas, color profile transform, native device E2E, fold/hinge
layout, reduced motion/VoiceOver/TalkBack/keyboard QA. Those remain distinct
component entries in `docs/COMPONENT_MASTER_INVENTORY.md` and must not be
claimed complete.

**License:** independent Forge code. ProCraft/LightCraft sources are design
and API references, not copied files. CapCraft AGPL material is kept only in
its separate attribution-bearing experimental package.

**Native skills applied:** Margelo API design, Swift/Kotlin/Nitro design;
Expo `expo-ui` universal controls and `expo-module`. The source API is
based on Expo `packages/expo-ui/src/universal/Slider/types.ts`.
