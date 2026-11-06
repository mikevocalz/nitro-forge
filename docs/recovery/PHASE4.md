# Phase 4: audio cluster 2 completed locally

NYC-Tron: `/Users/mikevocalz/recovered-work/2026-11-05/tron-phase4`, branch `codex/phase4-audio` (includes phases 2–3).
Forge: `/Users/mikevocalz/recovered-work/2026-11-05/forge-phase4`, branch `codex/phase4-cadence-adapter` (includes phases 1–3).

## Delivered

Integrated the interrupted audio UI files and recovered Cadence #58 operations. Twenty-one new public UI component/model subpaths cover automation, routing, inserts/presets, EQ/dynamics, analysis, mix groups and MIDI batch velocity/channel editing. Existing mixer controls gain bus balance, solo-safe, routing labels and measured meters. NYC-Tron's `docs/AUDIO_CLUSTER_2.md` records detailed ownership and scope.

Forge exports `CadenceMixerAdapter` from `@nitro-forge/cadence/mixer-cluster`. Domain bindings commit through the engine and return fresh state for the host to publish. Writes through an adapter instance are serialized, including EQ read/modify/write, so consecutive edits preserve neighboring bands and rejected edits do not block later writes. Real engine data supplies graph curves, loudness and spectrograms. Color/selection/window/session state is not copied into the adapter.

The UI integration corrected an Android-invalid group role, missing web ARIA values/checked state, web automation click coordinates and two recovered useState usages. Existing native value semantics are preserved. A stale interpolation expectation and two browser locators were corrected against the actual fixture and public props. The actual built-source contract caught optional-property and rack-prop mismatches before completion.

## Executed checks

- NYC-Tron: 692 source/model/render tests; workspace build and typechecks pass.
- Full Chromium lane: 414 pass. Fifty-seven new audio/MIDI captures reviewed across light/dark phone/tablet and RTL, with empty/error/disabled/focus/drag states. Design detector reports no findings.
- Export verifier: 337 conditional built exports and 426 ESM files pass.
- All 13 local release packages pass packing/export/notice checks in `phase4-local-packs`. These inherited alpha.3 filenames are unpublished and do not replace release assets.
- Rust workspace: 317 tests pass; fresh nf-cli built from this phase.
- Forge workspace: 421 package tests pass; one existing native test skipped. All workspace typechecks pass.
- Cadence: 35 tests pass, including five new real-engine adapter tests for routing/groups/solo-safe, rack/presets/undo, queued EQ edits and rejection recovery, atomic automation/batch velocity/channel edits, and read-only measured analysis retaining history.
- `node tooling/verify-audio-source.mjs ../tron-phase4` passes against the actual built UI declarations. Re-run through `pnpm verify:audio-source /absolute/path/to/nyc-tron` after building that checkout.

Logs: `phase4-*.log` beside the worktrees. The 341-row/21-column roster records unpublished source completion and preserves separate platform gates.

## Consumption examples

```ts
const mixer = new CadenceMixerAdapter(document);
// Publish only committed engine state; route rejections into the host's error UI.
const onSendCommit = async (source: string | number, bus: string | number, level: number) => {
  try { store.setState({document: await mixer.routing().onSendCommit(source, bus, level)}); }
  catch (error) { store.setState({error}); }
};
// One gesture, one engine command, one undo step.
await mixer.midi(clipId).onVelocitiesCommit([{index: 0, velocity: 80}, {index: 1, velocity: 100}]);
// Host decides range, polling/cancellation and when to publish returned analysis.
const spectrum = await mixer.analysis({fromTicks: 0, toTicks: 3840}).spectrogram();
```

The adapter owns no native resource. The existing document owner closes the document after playback/analysis users finish. Hosts should use one adapter per document for its serialized writes; edits made directly through the document remain the host's coordination responsibility.

## Boundaries and next phase

Production pins remain published alpha.3. No new release, push or merge is claimed for this phase. No app-window/orientation/manifest/navigation contract changed. Source/browser validation does not establish native compilation, screen-reader, hardware input, physical foldable or audio-device acceptance.

The recovered engine renders offline MIDI synthesis with effects and measures the result. It does not supply realtime audio device scheduling, new decoded audio clips, recorder/comping, external plugins, true-peak limiting or live write/touch/latch automation. Existing playback lifecycle ownership is retained. Analysis targets and meter ballistics/polling remain host-owned.

Phase 5 is workspace, color and transfer integration. Phase 6 retains native task/cache/decoder and desktop review work.
