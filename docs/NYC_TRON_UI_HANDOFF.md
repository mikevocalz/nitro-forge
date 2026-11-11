# NYC-Tron UI and Nitro Forge: package handoff

## One component source

The [NYC-Tron-UI](https://github.com/mikevocalz/NYC-Tron-UI) repository owns
every reusable cross-app UI control, basic and professional, under
`packages/ui/src/components/`. NYC-Tron-UI `main` holds the packages and
ships them as GitHub Releases. Forge pins
[`v0.1.0-alpha.2`](https://github.com/mikevocalz/NYC-Tron-UI/releases/tag/v0.1.0-alpha.2)
(commit `ff08d05`, 2026-11-05), which ships eight tarballs plus `SHA256SUMS`;
Forge uses `@nyc-tron/core`, `geometry`, `ui`, `panes`, `native-controls` and
`expo-controls`. The first release, `v0.1.0-alpha.1` (`2e16fee`), cannot be
used for iOS: its `native-controls` imports `ExpoUI`, which Expo SDK 58's
SwiftPM build of a pure-Swift module cannot resolve (fixed in `d4f350a`). Every package is still marked
`"private": true` and none is on npm, so Forge installs them by release URL.
No NYC-Tron package has a validated native production build yet.

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
  ├── @nyc-tron/native-controls/ArcKnob            (SwiftUI / Compose; needs @expo/ui ^58 and expo >=58.0.21)
  └── @nitro-forge/cadence, @nitro-forge/prism, ...  (document engines)
```

**Forge imports NYC-Tron UI. NYC-Tron UI never imports Forge.** An app that
needs a standalone transport control does not depend on the Rust audio editor.
Professional controls take controlled values and callbacks. They do not own
persistence, file I/O, engine state or undo.

## Depending on a release

`tooling/nyc-tron.json` is the single pin: the release tag, the commit it
was cut from, and for each package the tarball URL and its sha256 from
`SHA256SUMS`. A Forge package or app depends on NYC-Tron by putting that
exact URL in `package.json`:

```json
"@nyc-tron/ui": "https://github.com/mikevocalz/NYC-Tron-UI/releases/download/v0.1.0-alpha.2/nyc-tron-ui-0.1.0-alpha.2.tgz"
```

Then run `pnpm install` so the lockfile records it, and check the pin:

```sh
node tooling/verify-nyc-tron-pin.mjs             # manifests and lockfiles agree with the pin
node tooling/verify-nyc-tron-pin.mjs --download  # also re-hash every release asset
```

The script fails on any `@nyc-tron/*` specifier that is not the pinned URL,
on a lockfile entry resolved from somewhere else, and with `--download` on a
tarball whose sha256 no longer matches. pnpm stores no integrity hash for
URL tarballs, so the `--download` run in CI is the integrity check.

To move to a new release, update `tooling/nyc-tron.json` from the new
`SHA256SUMS`, change the URLs in each `package.json`, reinstall each
workspace that uses them and rerun the check.

Current consumers:

- `packages/cadence` has `@nyc-tron/ui` as a devDependency for one reason:
  `tests/nyc-tron-props.typecheck.ts` checks Cadence's knob bindings against
  the released `InstrumentKnob` props. Cadence's runtime and public types do
  not import NYC-Tron, so Cadence installs without it.
- `examples/native-cadence` installs `@nyc-tron/ui` and
  `@nyc-tron/native-controls`. It is a separate pnpm workspace (Expo 58,
  RN 0.88, Nitro v1 alpha) that joins `packages/ignition` and
  `packages/cadence` from source, so the root workspace and its Expo 54
  example never resolve Expo 58 native packages.

Peers: `@nyc-tron/ui` needs `react` 19 and `react-native` 0.88, with
`@expo/ui`, `zustand`, `@tanstack/react-table` and
`react-native-gesture-handler` as optional peers. `@nyc-tron/panes` peers on
`@nyc-tron/core` and `@nyc-tron/expo-controls` peers on `@nyc-tron/ui`, so
install those pairs together. The app must provide the peers itself. The
Cadence example's bundle check (`tooling/native/check-bundle-singletons.mjs`)
fails CI if Metro bundles a second React, React Native, Nitro, Zustand,
`@expo/ui` or NYC-Tron copy, or a NYC-Tron package that did not come from a
release tarball.

## Developing against a NYC-Tron checkout

To try an unreleased NYC-Tron change in a Forge app without publishing a
release, point Metro at a local checkout:

```js
// metro.config.js
const { withNycTronDevLink } = require("../../tooling/nyc-tron-metro.cjs");
module.exports = withNycTronDevLink(config, { projectRoot: __dirname });
```

```sh
NYC_TRON_ROOT=../NYC-Tron-UI pnpm exec expo start
```

With `NYC_TRON_ROOT` unset the helper returns the config unchanged and the
tarballs are bundled. With it set, the checkout joins `watchFolders`,
`@nyc-tron/*` imports resolve through each checkout package's exports map,
and `react`, `react-native`, `@expo/ui`, `zustand`, `@tanstack/react-table`
and `react-native-gesture-handler` always resolve to the app's own copies.
The helper chains any resolver already in the config. `pinToApp` from the
same file applies the singleton pin without a checkout; the Cadence example
uses it for the Forge source packages and Nitro.

Limits of the dev-link:

- NYC-Tron exports built `dist/` files, so run `pnpm build` (or a `tsc -w`
  build) in the checkout package you are editing.
- It changes only the JS bundle. Native code (the SwiftUI and Compose views
  in `@nyc-tron/native-controls`) still comes from the installed tarball
  until the app is rebuilt against the checkout.
- TypeScript in the app still checks against the installed tarball types.
- Never commit a `link:` or `file:` NYC-Tron dependency or a checkout path.
  CI installs only the pinned release.

## Package selection

| App capability | Forge dependency | UI import (release `v0.1.0-alpha.2`) |
| --- | --- | --- |
| Drawing / imaging | `@nitro-forge/prism` | `components/forge/graphics/` planned, not extracted |
| Music / recording | `@nitro-forge/cadence` | `.../forge/WaveformLane`, `.../forge/inputs/InstrumentKnob`, `@nyc-tron/native-controls/ArcKnob`; mixer and EQ controls not extracted |
| Video | `@nitro-forge/splice` | `.../forge/NativeSeekBar`; timeline not extracted |
| Color | any editor | `.../forge/ColorChannels` (RGBA), `.../forge/color/HsvPicker` |
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
- Forge #34: HSV picker. Extracted by NYC-Tron PR #21 and in the
  `v0.1.0-alpha.2` release as `components/forge/color/HsvPicker`.
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
  session. `InstrumentKnob` and the native `ArcKnob` consume Cadence's
  adapter; `examples/native-cadence` installs both from the release.
- Forge mixer/MIDI adapter (`@nitro-forge/cadence/editor-adapter`) and the
  note ops in #51: `MixingConsole`, `PanControl`, `SoloMuteButtons`,
  `TempoAndMetronome`, `MIDIPianoRoll`, `MIDIVelocityLane`, `StepSequencer`
  and the `WaveformLane` viewport are NYC-Tron PR #41, released in
  `v0.1.0-alpha.2` together with `LevelFader`. `tests/nyc-tron-props.typecheck.ts`
  checks the mixer, tempo, piano roll, velocity lane and step sequencer
  bindings against the released props. The metronome switch stays unbound
  until Cadence has audio output.
- Forge #7 and #23: npm distribution must keep per-package installation and
  native compatibility, not bundle every editor into one runtime.

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

## Studio preview wiring status (2026-11-11)

Pinned release: `v0.1.0-alpha.4`. Checked against the NYC-Tron-UI PR #54 head
(`d5207cc7`, branch `codex/complete-all-components`).

Wired in `apps/studio-preview` (Splice surface):

- D-21 `RollSlipSlideControls` -> `rollEdit`, `slipClip`, `slideClip`. The tool
  also drives drag editing on the clip lanes.
- D-18 `TrackHeaders` (inside `OverlayAndEffectsTrackStack`) -> `setTrackFlags`.
  Already mounted; its handler now goes through `spliceTrimHandlers`, which has
  a test.

Deferred, with the blocker named:

| Row | Component | Engine op (verified in `docs/ENGINE_OPS.md` and `packages/*/src`) | Blocker |
| --- | --- | --- | --- |
| D-13 | `LoopRangeBar` | Splice `setLoopRange` / `clearLoopRange` (adapter `setLoopRange`) | The bar always renders a player "Loop playback" switch (`onLoopingChange` is required) and the Splice surface has no transport, so the switch would do nothing. Unblocks when a transport exists or NYC-Tron-UI renders the switch only when `onLoopingChange` is passed. |
| I-15 | `PivotFieldList` | Tally `insertPivot`, `describePivot`, `refreshPivot` | Not in `alpha.4`. No release contains PR #54, and the pin policy (`tooling/nyc-tron.json`, `verify-nyc-tron-pin.mjs`) accepts only a release tarball URL with a sha256. |
| I-12 | `SortFilterHeader` | Tally `sortRange`, `setFilter`, `evaluateFilters` | Same: absent from `alpha.4`. |
| I-04 | `NameBox` | Tally `defineName`, `listNames` | Same. |
| I-11 | `ValidationDropdown` | Tally `setValidation`, `validateCell` | Same. |
| I-07 | `FillHandleAndAutoFill` | Tally `fillSeries`, `fillRange` | Same. |
| C-11 | `EyedropperTool` | Prism `samplePixels` | Same. |
| E-35 | `BeatDetectionMarkerLane` | Cadence `detectBeats` | Same. |
| B-11 | `LayerBlendAndOpacity` | Prism `setLayerBlend`, `setLayerOpacity` | Same. |
| E-14 | `VerticalFader` | Cadence `setTrackGain` | Same. |

When a NYC-Tron-UI release that contains PR #54 exists, update
`tooling/nyc-tron.json` and the manifests together, then wire the rows above.
