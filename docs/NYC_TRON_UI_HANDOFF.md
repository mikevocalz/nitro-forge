# NYC-Tron UI and Nitro Forge — package handoff

## A single component source

The private [NYC-Tron-UI](https://github.com/mikevocalz/NYC-Tron-UI)
repository owns **every reusable cross-app UI control** (basic and professional)
under `packages/ui/src/components/`. That repository's
[PR #1](https://github.com/mikevocalz/NYC-Tron-UI/pull/1)
starts the independently themeable source library. Its packages are marked
private and are NOT yet npm-published or native-production validated.

```text
Consumer (Moyo, NYC-MON, Forge, other)
  ├── @nyc-tron/ui/components/Button
  ├── @nyc-tron/ui/components/NavigationRail
  ├── @nyc-tron/ui/components/forge/WaveformLane
  ├── @nyc-tron/ui/components/forge/NativeSeekBar  [Expo SDK 58 optional]
  └── @nitro-forge/cadence or @nitro-forge/prism ... [document engine]
```

**Dependency arrow: Forge imports NYC-Tron UI; NYC-Tron UI never imports
Forge.** An app that needs a standalone transport control does not depend on
the Rust audio editor. Professional controls accept controlled values and
callbacks: they do not own persistence, file I/O, engine state or undo.

## Package selection

| App capability | Selective Forge dependency | Selective UI import |
| --- | --- | --- |
| Drawing / imaging | `@nitro-forge/prism` | `@nyc-tron/ui/components/forge/<GraphicControl>` |
| Music / recording | `@nitro-forge/cadence` | `.../forge/WaveformLane`, `.../forge/ColorChannels` |
| Video | `@nitro-forge/splice` | `.../forge/NativeSeekBar`, timeline later |
| Word documents | `@nitro-forge/quill` | Document controls (pending extraction) |
| Grids | `@nitro-forge/tally` | Table/spreadsheet controls (pending extraction) |
| Slides | `@nitro-forge/pitch` | Slide/canvas controls (pending extraction) |
| PDF | `@nitro-forge/folio` | Annotation controls (pending extraction) |
| Full Nitro Forge suite | Consumer opts into all seven | Each screen imports only relevant UI modules |

The `@nitro-forge/ignition` engine host is a transport/dependency of the
engine integration, not a default dependency of every UI component. Per-editor
packages can offer convenient adapters only when they do not duplicate UI
source or force all seven engines into each consumer.

## Existing PR and source mapping

- Forge #25, #26, #34, #35: native media/color controls. Initial
  WaveformLane, seek, and RGBA channel source has a migration target in
  NYC-Tron PR #1; remove original duplicate source only after consumer
  integration tests and review.
- Forge #32: Forge 2046 precision scrubber, gestures and instrument system;
  extract reusable controls to NYC-Tron, keep editor orchestrators, undo and
  document commands within Forge.
- Forge #18–20: whiteboard/ink and Muse BLE; retain hardware-native and engine
  responsibilities, extract the reusable UI surfaces to NYC-Tron.
- Forge #21: icon design catalog; move reusable icon glyph rendering into a
  separately importable NYC-Tron UI export; preserve Rive runtime/asset limits.
- Forge #5: studio navigation/workspace design. Native Windows collapsible
  NavigationView and Android physical-right rail are NYC-Tron UI adapters,
  while each app owns actual route selection, pane intent and session state.
- Forge #7/#23: npm distribution must retain per-package installation and
  native compatibility, not bundle every editor into a monolithic runtime.

## Moyo and NYC-MON themes stay distinct

Keep Moyo's own Tailwind v4/Uniwind tokens for neubrutalist buttons/cards;
keep NYC-MON's NeonBlade port and daylit/night theme for its game. NYC-Tron
components accept `className`, named slot overrides and theme-resource inputs.
Tailwind @source includes published UI source/classes. Native WinUI/AppKit/
SwiftUI/Compose resource adapters only support values actually exposed by
those OS controls; they cannot promise every arbitrary CSS rule.

The NYC-Tron root package must never import an app's `@acme/theme` and
must not bring Viro, Skia, Nitro, Fishjam, React Vision or all Forge engines
into a generic Button.

## Migration requirements

1. Extract a component and its behavior tests into NYC-Tron first.
2. Verify native interface/version compatibility (Expo 58 vs Spark Expo 55;
   Nitro v1 only after Hermes/JSI ABI test).
3. Add a typed import bridge in the specific Forge package without replacing
   other package APIs; keep semver and tree-shaking.
4. Test actual consumer app styling, accessibility, performance and editor
   command round trips on supported devices.
5. Remove duplicate Forge UI source only after parity. Do not mass-merge
   draft PRs; do not rewrite existing Rust engines to accomplish UI extraction.

Current handoff is an architecture contract only. It makes no claim that
existing Forge apps, all components or all native builds have migrated.
