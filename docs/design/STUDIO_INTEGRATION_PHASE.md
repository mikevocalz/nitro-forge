# Shared controls in the studio preview

2026-11-07. This phase connects existing engine adapters to the preview's Tally, Cadence and Splice document stage. It also gives Quill's draft actions the workspace density contract. These are working document controls, not complete replacements for every studio editor.

## Ownership and behavior

The preview composes NYC-Tron's released per-component controls. Forge retains its existing typed engine adapters; no engine operation, generic instrument, popup, menu or playback service is copied into the preview. The surface receives the already-open document and never opens another handle. A shared host operation lock serializes its writes with Save, Open, undo, redo and command actions. Read generations bind callbacks to the current document, state and viewport; a sheet switch closes write admission synchronously until its binding and cell window finish refreshing. Failed reads stay readonly, and rejected commits stay rejected. Per-instance view state uses Zustand. Density changes spacing and bounded row/target geometry, while Quill's manuscript typography and page geometry stay unchanged.

- **Tally:** `SpreadsheetGrid` reads only the requested window through `readTallyWindow`. Formula commits use `commitTallyGridCell`; fill gestures use the engine's single `fillRange` operation. `SheetTabs` uses `bindTallySheetTabs` for active sheet, add, rename and remove. The app does not fabricate computed values or optimistic sheet state. The grid's selection remains within the source-owned component.
- **Cadence:** `TempoAndMetronome` receives committed BPM/signature through `createCadenceTempoBindings`; `MixingConsole` receives engine tracks through `toMixerChannels` and `createCadenceMixerBindings`. Gain, pan, mute and solo commit through the engine and reload. No metronome switch or meters are supplied when there is no audio output/measurement host.
- **Splice:** `SpliceTimelineAdapter` supplies frame-based track/clip views to `OverlayAndEffectsTrackStack`. Track add, rename, flags, reorder and completed clip-edit gestures use its real callbacks. Ruler, accessible playhead and zoom share app-owned viewport/cursor state; moving that cursor is not decoder playback. Frame rates are represented by the bounded rational contract, or the surface reports why it cannot render that rate. Narrow content uses the track stack's existing compact header/settings composition.
- **Quill:** draft apply and conflict-resolution actions receive comfortable 48pt minimum classes. Density changes the gap between chrome groups; it does not resize manuscript type or recreate the draft store.

## Focused verification

Executed against the existing real `nf-cli` host:

| Command | Result |
| --- | --- |
| `pnpm --filter @nitro-forge/tally exec vitest run tests/grid-adapter.e2e.test.ts tests/grid-cluster.e2e.test.ts` | 2 files, 4 tests passed |
| `pnpm --filter @nitro-forge/cadence exec vitest run tests/editor-adapter.e2e.test.ts` | 1 file, 4 tests passed |
| `pnpm --filter @nitro-forge/splice exec vitest run tests/timeline-cluster.e2e.test.ts` | 1 file, 7 tests passed |
| `node --experimental-strip-types --test apps/studio-preview/src/surface-admission.test.ts` | 4 admission/rejection regressions passed |
| `pnpm --filter @nitro-forge/studio-preview typecheck` | Passed |
| `pnpm --filter @nitro-forge/studio-workspace typecheck` | Passed |

These checks validate the adapters now used by the surfaces. They do not replace browser interaction evidence, native acceptance, full-suite execution or the user's design review. Browser/native evidence, where collected by the parent phase, is recorded separately.

## Remaining scope

Tally's engine still lacks duplicate/reorder/protect/color sheet operations and persisted chart/sparkline/view operations listed in `TALLY_DEFERRED_OPS`. Their callbacks remain absent. Quill remains the existing atomic plain-text draft editor; its office adapters expose only formatting operations its engine supports, not a full native rich-text editing host. Cadence's MIDI editing, bus/FX/send surfaces, live meters, render output and native audio routing are not all composed by this preview. Splice's transition, marker, batch, playback/decoder and export surfaces remain separate from the track-stage composition here. Folio and Pitch retain their existing generic stage and adapters; this phase does not audit or complete them.

The current release pin remains alpha.4. No release, native manifest, window contract, dependency, lockfile or unrelated native-cadence/media work changes are included. Universal comfortable-density target coverage, localization, enlarged text, RTL, screen readers and the hardware matrix remain acceptance work.

## Browser evidence and host binding

Argent drove an isolated Chromium session through the real local Rust bridge. Tally's A1 formula `=2+3` displayed 5; creating/selecting Sheet2 showed an empty A1; selecting Sheet1 restored 5. Cadence committed 128 BPM, Undo showed 120, Redo showed 128; adding a MIDI track exposed its actual mixer strip and lowering gain displayed −1.0 dB. Splice added V1 through its adapter, Undo removed it and Redo restored it. Captures are in `evidence/studio-integration/`.

A one-shot injected transport rejection on Cadence's next setTempo request kept the committed value at 120, showed the failure in the UI and produced no unhandled rejection. This is a browser transport-failure demonstration, not a simulated successful engine response. The alpha.4 tempo control both awaits numeric commits and invokes tap tempo as a void callback. The host attaches a rejection observer while returning the original promise, preserving rejection for awaited callers and handling the void path.

The strict Studio UI host now carries an optional targetSize through the existing Button/IconButton binding. ForgeWorkspace and Quill supply their scale target. Prism requests the canonical scrubber's target extension. That extension and the icon aria-name correction are demonstrated through local source aliases to NYC-Tron 5925c5d; the shipped alpha.4 scrubber does not yet implement that extension. The preview wrapper explicitly exports RN Web's ActivityIndicator for source-linked Button rendering. No private alias configuration is committed.

The preview environment was inspected with Argent's workspace tool by a subagent: it is Vite+React+React Native Web (`is_react_native=false`), with no native app directories. The actual Rust bridge needs a running development host; a static build alone does not provide it. Native simulator/device evidence is not inferred from Chromium.

The production preview build also passed. It reports a 933.92 kB JavaScript chunk (277.91 kB gzip), the 500 kB chunk advisory, RN Web module-level directive notices and Vite's future native-config loader import-extension warnings. These are recorded warnings, not a performance or warning-free acceptance result.
