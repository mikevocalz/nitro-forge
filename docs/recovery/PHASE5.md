# Phase 5: workspace, color and transfers completed

NYC-Tron: `/Users/mikevocalz/recovered-work/2026-11-05/tron-phase5`, branch `codex/phase5-workspace` (includes phases 2–4).
Forge: `/Users/mikevocalz/recovered-work/2026-11-05/forge-phase5`, branch `codex/phase5-workspace-transfer` (includes phases 1–4).

## Delivered

The recovered workspace host/preset and color files are integrated, with the missing contextual toolbar, file transfer sheet and presenter ink controls completed. Fourteen new public component/model subpaths have independent exports. Existing AdaptiveDock preserves canvas identity while docks and compact layouts change. NYC-Tron's `docs/WORKSPACE_COLOR_TRANSFER.md` records ownership and platform limits.

Forge adds WorkspaceSession with one engine document, persisted per-mode layouts/presets and an explicit host storage boundary. The workspace UI helpers bind controls and require a host parser for opaque layouts. Input options and returned views are copied so caller mutations cannot bypass persistence. Duplicate/corrupt persisted presets are filtered; built-in IDs/names are validated before opening a document. An edited layout with no active preset remains usable as Custom layout.

Transfer modules expose actual bytes only: universal native NFD snapshots, Cadence float WAV, Folio PDF, Quill DOCX, Splice JSON render plans and Tally CSV computed values. Import supports real available operations (NFD plus PDF/DOCX). UI format descriptions omit unsupported metadata. Transfer bindings require an explicit platform writer and selected destination; done is published only after delivery succeeds. Invalid names, busy transfers and engine/write errors reject through the host's error channel. Native Files/share/download delivery remains the consuming platform adapter's responsibility.

WAV export uses one bounded engine render so EQ/compressor state stays continuous; a real-engine regression crosses the old ten-second chunk boundary. The engine's existing render-size ceiling still applies. Cancellation can be checked before/after rendering, not interrupt a running synchronous engine render. No streaming or native audio-output claim is made.

Prism colors now compose with the canvas engine: set/swap/reset/recent palette writes, snapshots and undo/redo are tested. New-canvas creation retains the palette under the recovered API contract; combined document history also captures palette state. The formerly deferred selected-fill path now uses the real setFill operation in one undo step. Dialog HSV-to-RGBA conversion stays with the existing UI color model.

## Executed checks

- NYC-Tron: 713 source/model/render tests; workspace build and typechecks pass.
- Full Chromium lane: 427 pass; focused 13 Phase 5 tests also pass after web resolver/capture fixes. Thirteen light/dark phone/tablet/RTL captures reviewed.
- Export verifier: 351 conditional built exports and 442 ESM files pass. The dependency scanner now parses declarations; a test prevents import/export copy from becoming a false package dependency.
- Thirteen local unpublished release packs pass exports and license/notice checks in `phase5-local-packs`. Their inherited alpha.3 filenames do not replace published assets.
- Rust workspace: 327 tests pass; fresh nf-cli built for engine-backed checks.
- Forge workspace: 446 package tests pass; one existing native test skipped. All workspace typechecks pass.
- Tests include actual document continuity across modes, preset persistence/undo/invalid state, NFD/PDF/DOCX/CSV/render-plan/WAV bytes, color/reset/fill history, UI format/explicit delivery status and continuous effect output.
- `pnpm verify:workspace-source /absolute/path/to/nyc-tron` checks the actual built unpublished declarations, including the canonical platform-conditional file-sheet export. It passes against tron-phase5.

Logs: `phase5-*.log` beside the worktrees. The 341-row/21-column roster records local/unpublished completion separately from native/device gates.

## Host examples

```ts
const view = workspaceUiView(session, parseDockLayout);
const callbacks = workspaceUiBindings(session, state => store.setState({workspace: state}));
// Supply document title/dirty state, mode panels and native resources from the host.
const transfer = createTransferUiBindings({
  document: session.document, exports: formats, imports,
  onStatus: status => store.setState({transferStatus: status}),
  write: (result, destination) => platformWriter(result, destination),
});
// Catch rejection in the host to display its error; preview never writes a document.
await transfer.onExport({formatId: 'nfd', filename: 'Harbor.nfd', metadata: {}, destination: 'files'});
```

WorkspaceSession closes its attached/opened document exactly once; the host must coordinate other users before closing. Layout/session state is distinct from engine document history. The storage API is MMKV-compatible but no new native storage dependency is introduced.

## Remaining boundaries

Production pins remain alpha.3. No release or merge is performed; completed phase branches are pushed under the user's standing instruction. No app-window/orientation/manifest/navigation contract changed. Native build, real OS picker/writer, screen-reader, physical foldable and hardware pen acceptance remain pending.

Presenter ink is a controlled host session overlay with normalized geometry, not a Pitch annotation engine or remote audience transport. PNG encoding, encoded video, PPTX and metadata operations remain absent and explicitly deferred. The laser is a timed dot. Brush/Ink/Muse and native task/cache/decoder/desktop review remain outside this phase. Phase 6 is next.
