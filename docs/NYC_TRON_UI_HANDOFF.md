# NYC-Tron UI and Nitro Forge: package handoff

## One component source

The [NYC-Tron-UI](https://github.com/mikevocalz/NYC-Tron-UI) repository owns
every reusable cross-app UI control, basic and professional, under
`packages/ui/src/components/`. As of 2026-11-04 that code is on open PRs only:
[PR #1](https://github.com/mikevocalz/NYC-Tron-UI/pull/1) is the baseline and
PRs #2, #3 and #8 to #10 build on it. NYC-Tron-UI `main` contains only a
README. The repository itself is public, but every package is marked
`"private": true`, none is on npm, and none has a validated native production
build.

Subpaths that exist in the PR #1 `packages/ui/package.json` exports map:

```text
Consumer (Moyo, NYC-MON, Forge, other)
  ├── @nyc-tron/ui/components/Button
  ├── @nyc-tron/ui/components/NavigationRail
  ├── @nyc-tron/ui/components/forge/WaveformLane
  ├── @nyc-tron/ui/components/forge/NativeSeekBar   (needs the optional @expo/ui ^58 peer)
  ├── @nyc-tron/ui/components/forge/ColorChannels   (needs the optional @expo/ui ^58 peer)
  ├── @nyc-tron/ui/components/forge/SpreadsheetGrid
  ├── @nyc-tron/ui/components/data/DataTable
  └── @nitro-forge/cadence, @nitro-forge/prism, ...  (document engines)
```

**Forge imports NYC-Tron UI. NYC-Tron UI never imports Forge.** An app that
needs a standalone transport control does not depend on the Rust audio editor.
Professional controls take controlled values and callbacks. They do not own
persistence, file I/O, engine state or undo.

## Package selection

| App capability | Forge dependency | UI import (PR #1 unless marked) |
| --- | --- | --- |
| Drawing / imaging | `@nitro-forge/prism` | `components/forge/graphics/` planned, not extracted |
| Music / recording | `@nitro-forge/cadence` | `.../forge/WaveformLane`; mixer and EQ controls not extracted |
| Video | `@nitro-forge/splice` | `.../forge/NativeSeekBar`; timeline not extracted |
| Color | any editor | `.../forge/ColorChannels` (RGBA); HSV wheel not extracted |
| Word documents | `@nitro-forge/quill` | Document controls not extracted |
| Grids | `@nitro-forge/tally` | `.../forge/SpreadsheetGrid`, `.../data/DataTable` |
| Slides | `@nitro-forge/pitch` | Slide/canvas controls not extracted |
| PDF | `@nitro-forge/folio` | Annotation controls not extracted |
| Full Nitro Forge suite | All seven editors plus `@nitro-forge/ignition` | Each screen imports only the UI modules it uses |

`@nitro-forge/ignition` is the engine host. It is a dependency of the engine
integration, not of every UI component. A per-editor package may ship an
adapter for convenience only if it does not copy UI source or pull all seven
editors into each consumer.

NYC-Tron-UI `docs/COMPONENT_OWNERSHIP.md` (PR #1) is the authoritative
inventory and status table. Update it, not this file, when a component moves.

## Forge PR mapping

- Forge #25 and #26: seek bar, waveform lane and RGBA channel controls.
  NYC-Tron PR #1 holds the extracted `WaveformLane`, `NativeSeekBar` and
  `ColorChannels`. Remove the Forge copies only after consumer integration
  tests and review.
- Forge #35: PCM waveform source. `WaveformLane` is the UI target; the WAV
  decoding stays in Forge.
- Forge #34: HSV picker. No NYC-Tron target exists yet (`components/forge/color/`
  is planned).
- Forge #32: Forge 2046 precision scrubber, gestures and instrument system.
  Extract the reusable controls to NYC-Tron (`PrecisionScrubber` is planned,
  not extracted). Editor orchestrators, undo and document commands stay in
  Forge.
- Forge #15 and #18 to #20: whiteboard, ink and Muse BLE. Hardware-native and
  engine work stays in Forge; the reusable UI surfaces move to NYC-Tron
  (`components/forge/ink/` is planned).
- Forge #21: icon catalog. Reusable glyph rendering moves to a separate
  NYC-Tron export (`components/icons/` is planned). Keep the Rive runtime and
  asset limits.
- Forge #5: studio navigation and workspace. `@nyc-tron/core/navigation`
  (PR #1) defines the shell policy: a collapsible left drawer on Windows and a
  right-hand rail on Android foldables. The native Windows `NavigationView`
  adapter is not implemented. Each app owns route selection, pane intent and
  session state.
- Forge #39: Tally spreadsheet windows. `SpreadsheetGrid` is the UI target.
- Forge #7 and #23: npm distribution must keep per-package installation and
  native compatibility, not bundle every editor into one runtime.

## Moyo and NYC-MON themes stay distinct

Moyo keeps its Tailwind v4/Uniwind tokens for neubrutalist buttons and cards.
NYC-MON keeps its NeonBlade port and day/night theme. NYC-Tron components
accept `className` and an `unstyled` switch, so an app can supply its own full
Tailwind recipe instead of fighting the default classes. Native controls take
the `TronTheme` semantic resources from `@nyc-tron/core` (PR #1). Native
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
