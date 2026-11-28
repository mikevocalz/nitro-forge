# Third-party notices

`@nitro-forge/editor-controls` is MIT-licensed (see `LICENSE`). Its code came
from NYC-Tron UI (https://github.com/mikevocalz/NYC-Tron-UI) at commit
`5a1ea4db`, path `packages/ui/src/components/forge/`. NYC-Tron UI is also MIT,
Copyright (c) 2026 NYC-Tron UI contributors, so `LICENSE` is NYC-Tron's text
unchanged. A file at `forge/<path>` in NYC-Tron is at `src/<path>` here.

The files were moved without edits, so each ported file still carries its
original header: the source file, the upstream commit, the copyright line and
a dated modification notice. "Modified for NYC-Tron UI" in those headers refers
to the changes made when the code was first ported into NYC-Tron. The move into
Nitro Forge changed no code in these files.

The upstream license texts are in `licenses/`, copied verbatim from NYC-Tron
UI's `licenses/` folder. This file records provenance. It is not legal advice.

## ArtCraft family

23 files are ports from ArtCraft projects. All five upstreams below are
licensed MIT or Apache-2.0 at the user's option, Copyright (c) 2026 ArtCraft
Team and the respective project contributors. Both license texts and each
upstream NOTICE file are in `licenses/`. Only code was ported. No ArtCraft
fonts, icons, models, assets or brand files are included, and the ArtCraft
names and marks are not used. No CapCraft (AGPL-3.0) source is used.

### ProCraft for Android

https://github.com/artcraft-android/procraft-android, commit
`c2f7518d03141c746a365f90d8df05a44ddef002`. Texts:
`licenses/ProCraft-LICENSE-MIT.txt`, `licenses/ProCraft-LICENSE-APACHE.txt`,
`licenses/ProCraft-NOTICE.txt`. Kotlin paths are under
`android/app/src/main/java/io/github/artcraftandroid/procraft/ui/`.

| File | ProCraft source |
| --- | --- |
| `src/color/wheel-geometry.ts` | `ColorPanel.kt` (`Disc` picker ring and disc geometry) |
| `src/color/floating-palette.ts` | `ColorPanel.kt` (`UndockHandle` and floating palette) |
| `src/canvas/ruler-model.ts` | `crates/engine/src/guide.rs` (`LengthUnit`) |
| `src/canvas/snap-grid-model.ts` | `crates/engine/src/transform.rs` (`snap_offset`) |
| `src/canvas/transform-origin-model.ts` | `crates/engine/src/transform.rs` (`MAGNETIC_STEP`, 15 degree steps) |
| `src/layers/clipping-model.ts` | `LayersPanel.kt` (`LayerRow` clipped-layer rules) |
| `src/layers/ClippingMaskControls.tsx` | `LayersPanel.kt` (`LayerRow` clipping controls) |
| `src/layers/layer-thumbnail-model.ts` | `LayersPanel.kt` (`Thumb`, `checker`) |
| `src/layers/LayerThumbnail.tsx` | `LayersPanel.kt` (`Thumb`) |
| `src/layers/MaskThumbnailAndEditor.tsx` | `LayersPanel.kt` (`Thumb` and mask editing) |
| `src/canvas-tools/reference-board-model.ts` | `ReferenceUi.kt` and `crates/core/src/reference_view.rs` (`ReferenceWindow`) |
| `src/canvas-tools/ReferenceImageBoard.tsx` | `ReferenceUi.kt` (reference window) |
| `src/canvas-tools/color-drop-model.ts` | `ColorDropUi.kt` (`dropSource`, `DropDot`) |
| `src/canvas-tools/ColorDropCanvasTarget.tsx` | `ColorDropUi.kt` (tap or drag color chip) |
| `src/canvas-tools/gesture-map-model.ts` | `crates/core/src/gestures.rs` and `GestureControlsUi.kt` |
| `src/canvas-tools/GestureCustomizationPanel.tsx` | `GestureControlsUi.kt` (`GestureControls`) |

`src/layers/ClippingMaskControls.tsx` and `src/layers/MaskThumbnailAndEditor.tsx`
also carry "Modified for NYC-Tron UI on 2026-11-06: added document ownership and
permission guards; original licenses retained."

### FilmCraft for Android

https://github.com/artcraft-android/filmcraft-android, commit
`c41b58467edd28d098336286528159b24c5203b5`. Texts:
`licenses/FilmCraft-LICENSE-MIT.txt`, `licenses/FilmCraft-LICENSE-APACHE.txt`,
`licenses/FilmCraft-NOTICE.txt`. Kotlin paths are under
`apps/filmcraft-android/android/app/src/main/java/io/github/artcraftandroid/filmcraft/ui/editor/`.

| File | FilmCraft source |
| --- | --- |
| `src/timeline/ruler.ts` | `TimelineMath.kt` (`rulerStep`, `rulerLabel`) |
| `src/timeline/ClipTrimHandles.tsx` | `Timeline.kt` (trim drag handles) |

### GridCraft for Android

https://github.com/artcraft-android/gridcraft-android, commit
`72d5bfc0729d0966e9bd966c2eabaa0312eea3ff`. Texts: `licenses/GridCraft-MIT.txt`,
`licenses/GridCraft-Apache-2.0.txt`, `licenses/GridCraft-NOTICE.txt`. GridCraft's
`ATTRIBUTION.md` lists assets; none are used. Kotlin paths are under
`apps/gridcraft-android/android/app/src/main/java/io/github/artcraftandroid/gridcraft/ui/editor/`.

| File | GridCraft source |
| --- | --- |
| `src/spreadsheet/reference-colors.ts` | `FormulaRefs.kt` (per-reference color assignment) |
| `src/spreadsheet/cards-model.ts` | `Cards.kt` (card title and preview-field model) |
| `src/spreadsheet/SpreadsheetCardsView.tsx` | `Cards.kt` (Cards View list, detail and field editing) |

### WordCraft for Android

https://github.com/artcraft-android/wordcraft-android, commit
`b2b7cf913c6f61604062e2db30962f32ec921b11`. Texts: `licenses/WordCraft-MIT.txt`,
`licenses/WordCraft-Apache-2.0.txt`, `licenses/WordCraft-NOTICE.txt`.

| File | WordCraft source |
| --- | --- |
| `src/office/read-aloud-model.ts` | `crates/engine/src/speech.rs` (sentence splitting, abbreviation and initial rules, spoken-text tidying, word spans, speed limits) |

### PdfCraft for Android

https://github.com/artcraft-android/pdfcraft-android, commit
`c643244e0e00c1f0b746ceaff4661a91921e907e`. Texts: `licenses/PdfCraft-MIT.txt`,
`licenses/PdfCraft-Apache-2.0.txt`, `licenses/PdfCraft-NOTICE.txt`.

| File | PdfCraft source |
| --- | --- |
| `src/pdf/search-model.ts` | `apps/pdfcraft-android/android/app/src/main/java/io/github/artcraftandroid/pdfcraft/ui/viewer/Search.kt` (search from the current page with wrap-round, page-ordered hit insertion, wrapping next and previous) |

That is 23 files: 16 ProCraft, 2 FilmCraft, 3 GridCraft, 1 WordCraft,
1 PdfCraft.

## Nitro Forge draft code

`src/waveform.ts` adapts the min/max extrema math from the draft media-ui
`WaveformLane` in Nitro Forge PR #25, the owner's own repository. It returns
here under the same owner.

## React Native Skia (optional peer)

`src/canvas/GPUCanvasViewport.tsx`, `src/canvas/graphite-frame.ts`,
`src/ink/InkStrokePreview.tsx` and `src/slides/InkAndLaserPointer.tsx` import
`react-native-skia` through an optional peer dependency (`>=3.9.1 <4`). No
Skia code is copied and no native binaries are bundled. MIT, Copyright
2026-present William Candillon; Copyright 2021-2026 Shopify Inc. Text:
`licenses/REACT-NATIVE-SKIA-MIT.txt`. Skia's Dawn, Graphite and CanvasKit
dependencies keep their own notices, which apply to apps that ship them.

## Not included

No external fonts, icons, branding, binary SDKs or artwork are redistributed.
