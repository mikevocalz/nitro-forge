# Phase 3: canvas and layers completed locally

NYC-Tron: `/Users/mikevocalz/recovered-work/2026-11-05/tron-phase3`, branch `codex/phase3-canvas` (includes phase 2).
Forge: `/Users/mikevocalz/recovered-work/2026-11-05/forge-phase3`, branch `codex/phase3-prism-adapter` (includes phases 1–2).

The four recovered canvas workers are integrated with 41 new public component/model subpaths. They cover rulers/grid/guides, alignment/pivot, layer thumbnails and clipping, masks, artboards/compare, region/wand selection, color drop, reference boards, gesture preferences, path nodes, booleans, fills/strokes and gradients. Existing compact LayerStack opacity behavior is preserved. Per-file ProCraft provenance and packaged notices remain intact. NYC-Tron's `docs/CANVAS_CLUSTER.md` records ownership and control mappings.

Forge integrates the recovered #60 Prism operations and exports `PrismCanvasAdapter` from `@nitro-forge/prism/canvas-cluster`. It binds readonly UI requests to real engine commands, converts canonical string IDs, decodes real RGBA previews and returns fresh engine state after successful writes. The host publishes those results and errors. Curve-preserving insertions and handle-kind changes use one whole-path write when neighbors change. Color drop requires an explicit host color resolver. No optimistic document or UI runtime dependency is introduced.

Integration fixed three observable issues: Alt-drag selection/vector gestures were rejected by React Native Web's responder filter (web now uses actual pointer capture while native retains PanResponder); horizontal guide culling compared against the wrong viewport dimension; and ShapeBuilder retained an unavailable reason after its selection changed. Rust legacy shape edits now reject non-shape content and honor ancestor locks before mutation. Their regression tests verify unchanged state/undo history on rejection.

## Executed checks

- NYC-Tron: 617 source/model/render tests; workspace build and all typechecks pass.
- Full Chromium lane: 323 pass, including new interactions and light/dark phone/tablet/RTL captures. Reviewed 95 canvas/layers/selection/vector captures using contact sheets.
- Export verifier: 316 built conditional exports and 404 ESM files pass.
- Local release-pack check: 13 unpublished packages with checked exports and license/notice contents; artifacts in `phase3-local-packs`. Inherited alpha.3 filenames do not replace published release assets.
- Rust workspace: 286 tests pass. A fresh `nf-cli` was built from this phase's source.
- Forge workspace: 408 package tests pass, one existing native check skipped; all workspace typechecks pass. Prism's 18 tests include five real-engine adapter scenarios covering alignment/pivot, readonly selection and fill, atomic path/gradient edits, artboards/previews, locks and invalid IDs.
- `node tooling/verify-canvas-source.mjs ../tron-phase3` passes against the actual built unpublished UI declarations. Run via `pnpm verify:canvas-source /absolute/path/to/nyc-tron` after building that checkout.

Logs: `phase3-*.log` beside the worktrees. The 341-row/21-column `roster-status.tsv` records unpublished completion as BUILT-LOCAL and retains native/device gates.

## Boundaries and next phase

Production release pins remain alpha.3. No remote push, merge or new release occurred. No app-window/orientation/manifest contract changed. Browser tests use controlled Zustand fixtures; separate Rust-backed tests establish engine behavior. No new native build, pen hardware, screen-reader or physical foldable acceptance is claimed.

Viewport/grid/guides, reference frames, gesture preferences and selection focus remain host-owned. Real brush/Ink, GPU viewport rendering and missing selection-bounds controls remain separate backlog. Selection smoothing has no engine operation and remains unavailable. Generic mask controls do not provide an Ink painting surface. Phase 4 is audio cluster 2 and its Cadence bindings.
