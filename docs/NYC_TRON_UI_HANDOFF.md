# NYC-Tron UI and Nitro Forge: package handoff

## One component source

The [NYC-Tron-UI](https://github.com/mikevocalz/NYC-Tron-UI) repository owns
every reusable cross-app UI control, basic and professional, under
`packages/ui/src/components/`. NYC-Tron-UI `main` holds the packages, and
[`v0.1.0-alpha.1`](https://github.com/mikevocalz/NYC-Tron-UI/releases/tag/v0.1.0-alpha.1)
(commit `2e16fee`, 2026-11-05) is the first GitHub Release. It ships six
tarballs plus `SHA256SUMS`: `@nyc-tron/core`, `geometry`, `ui`, `panes`,
`native-controls` and `expo-controls`. Every package is still marked
`"private": true` and none is on npm, so a Forge package installs them by
release tarball URL. The pin file and its verifier land with Forge #49. No
NYC-Tron package has a validated native production build yet.

Some subpaths in the released `@nyc-tron/ui` exports map:

```text
Consumer (Moyo, NYC-MON, Forge, other)
  ├── @nyc-tron/ui/components/Button
  ├── @nyc-tron/ui/components/NavigationRail
  ├── @nyc-tron/ui/components/forge/WaveformLane
  ├── @nyc-tron/ui/components/forge/NativeSeekBar   (needs the optional @expo/ui ^58 peer)
  ├── @nyc-tron/ui/components/forge/ColorChannels   (needs the optional @expo/ui ^58 peer)
  ├── @nyc-tron/ui/components/forge/SpreadsheetGrid
  ├── @nyc-tron/ui/components/data/DataTable
  ├── @nyc-tron/ui/components/forge/inputs/InstrumentKnob
  ├── @nyc-tron/ui/components/forge/inputs/PrecisionScrubber
  ├── @nyc-tron/native-controls/ArcKnob            (SwiftUI / Compose; needs @expo/ui ^58)
  └── @nitro-forge/cadence, @nitro-forge/prism, ...  (document engines)
```

**Forge imports NYC-Tron UI. NYC-Tron UI never imports Forge.** An app that
needs a standalone transport control does not depend on the Rust audio editor.
Professional controls take controlled values and callbacks. They do not own
persistence, file I/O, engine state or undo.

## Package selection

| App capability | Forge dependency | UI import (release `v0.1.0-alpha.1`) |
| --- | --- | --- |
| Drawing / imaging | `@nitro-forge/prism` | `.../forge/graphics/ImageCropOverlay` (UI only; Prism has no crop op yet) |
| Music / recording | `@nitro-forge/cadence` | `.../forge/WaveformLane`, `.../forge/inputs/InstrumentKnob`, `@nyc-tron/native-controls/ArcKnob`; mixer and EQ controls not extracted |
| Video | `@nitro-forge/splice` | `.../forge/NativeSeekBar`; timeline not extracted |
| Color | any editor | `.../forge/ColorChannels` (RGBA); the HSV picker is on NYC-Tron `main` (PR #21) but not in this release |
| Word documents | `@nitro-forge/quill` | Document controls not extracted |
| Grids | `@nitro-forge/tally` | `.../forge/SpreadsheetGrid`, `.../data/DataTable` |
| Slides | `@nitro-forge/pitch` | Slide/canvas controls not extracted |
| PDF | `@nitro-forge/folio` | Annotation controls not extracted |
| Full Nitro Forge suite | All seven editors plus `@nitro-forge/ignition` | Each screen imports only the UI modules it uses |

`@nitro-forge/ignition` is the engine host. It is a dependency of the engine
integration, not of every UI component. A per-editor package may ship an
adapter for convenience only if it does not copy UI source or pull all seven
editors into each consumer.

NYC-Tron-UI `docs/COMPONENT_OWNERSHIP.md` is the authoritative
inventory and status table. Update it, not this file, when a component moves.

## Forge PR mapping

- Forge #25 and #26: seek bar, waveform lane and RGBA channel controls.
  The release holds the extracted `WaveformLane`, `NativeSeekBar` and
  `ColorChannels`. Remove the Forge copies only after consumer integration
  tests and review.
- Forge #35: PCM waveform source. `WaveformLane` is the UI target; the WAV
  decoding stays in Forge.
- Forge #34: HSV picker. Extracted by NYC-Tron PR #21, merged to `main` after
  `v0.1.0-alpha.1` was cut, so it ships in the next release, not this one.
- Forge #32: Forge 2046 precision scrubber, gestures and instrument system.
  `PrecisionScrubber` and `DragGrabHandle` are extracted (NYC-Tron PR #23) and
  in the release. Editor orchestrators, undo and document commands stay in
  Forge.
- Forge #15 and #18 to #20: whiteboard, ink and Muse BLE. Hardware-native and
  engine work stays in Forge; the reusable UI surfaces move to NYC-Tron
  (`components/forge/ink/` is planned).
- Forge #21: icon catalog. Reusable glyph rendering moves to a separate
  NYC-Tron export (`components/icons/` is planned). Keep the Rive runtime and
  asset limits.
- Forge #5: studio navigation and workspace. `@nyc-tron/core/navigation`
  defines the shell policy: a collapsible left drawer on Windows and a
  right-hand rail on Android foldables. The native Windows `NavigationView`
  adapter is not implemented. Each app owns route selection, pane intent and
  session state.
- Forge #39: Tally spreadsheet windows. `SpreadsheetGrid` is the UI target.
- Forge #40 and #43: Cadence instrument bindings and the native editor
  session. `InstrumentKnob` and the native `ArcKnob` consume Cadence's adapter.
- Forge #7 and #23: package distribution must keep per-package installation
  and native compatibility, not bundle every editor into one runtime. Like
  NYC-Tron, Forge packages ship as GitHub Release tarballs, not npm.

## Moyo and NYC-MON themes stay distinct

Moyo keeps its Tailwind v4/Uniwind tokens for neubrutalist buttons and cards.
NYC-MON keeps its NeonBlade port and day/night theme. NYC-Tron components
accept `className` and an `unstyled` switch, so an app can supply its own full
Tailwind recipe instead of fighting the default classes. Native controls take
the `TronTheme` semantic resources from `@nyc-tron/core`. Native
WinUI, AppKit, SwiftUI and Compose adapters can only map values those OS
controls expose; they cannot honor arbitrary CSS.

The `@nyc-tron/ui` root entry must never import an app's `@acme/theme`, and a
generic Button must not pull in Viro, Skia, Nitro, Fishjam, React Vision or the
Forge engines.

## Migration requirements

1. Extract the component and its behavior tests into NYC-Tron first.
2. Check native interface and version compatibility: Expo SDK 58 / RN 0.88
   versus Spark SDK 55 / RN 0.83, and Nitro v1 only after a Hermes/JSI ABI test.
3. Add a typed import bridge in the specific Forge package without replacing
   its other APIs. Keep semver and tree-shaking.
4. Test styling, accessibility, performance and editor command round trips in
   a real consumer app on supported devices.
5. Remove the duplicate Forge UI source only after parity. Do not mass-merge
   draft PRs, and do not rewrite the Rust engines to get UI extraction done.

This handoff is an architecture contract. Existing Forge apps and native
builds have not migrated, and most components listed above are still
unextracted.
