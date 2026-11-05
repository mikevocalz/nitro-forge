# @nitro-forge/color-ui

Cross-platform Expo **SDK 58** native color components for the Nitro Forge
editor suite, based on the native API, Expo UI, and ArtCraft source research.

## Where the code lives

`ColorChannels` (exported here as `NativeColorChannels`) and the RGBA math
(`RgbaColor`, `assertRgba`, `rgbaToHex`, `alphaPercent`) are owned by
[NYC-Tron UI](https://github.com/mikevocalz/NYC-Tron-UI). Forge depends on the
release tarball pinned in `tooling/nyc-tron.json` (v0.1.0-alpha.1), and
`node tooling/verify-nyc-tron-pin.mjs --download` checks it. The control uses
SwiftUI and Jetpack Compose sliders through the `@expo/ui` universal API, with
that API's web fallback.

NYC-Tron styles the panel and swatch with Tailwind v4 classes
(`bg-surface-raised`, `rounded-control`), so the host needs Uniwind and the
tokens from NYC-Tron's `docs/THEME_TOKENS.md`. `apps/forge-color-lab`
(`metro.config.js`, `global.css`) shows the setup. The per-slider testIDs
(`<testID>-red` and so on) are gone; `testID` lands on the outer View.

Still local until NYC-Tron v0.1.0-alpha.2 (NYC-Tron-UI PR #21): `HsvColor`,
`parseHexColor`, `rgbToHsv`, `hsvToRgb`. None of these replace Rust ICC
profile management, HDR, P3, CMYK, spot ink or theme color references, and
they must not flatten document colors when saving.

Hex alpha is 8-bit. `rgbaToHex` writes `Math.round(alpha * 255)`, so an
opacity of 0.01 becomes `03` and `parseHexColor` returns 3/255, not 0.01.
The opacity label uses `alphaPercent`, which rounds to a whole percent; every
whole percent from 0 to 100 reads the same before and after a hex round trip
(covered in `tests/color.test.ts`). Keep the float yourself if you need it
exactly.

```tsx
import { ColorChannels } from '@nyc-tron/ui/components/forge/ColorChannels';

<ColorChannels
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
