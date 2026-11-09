# Completion status

The remaining P02–P20 program is sequenced in [MEGAPLAN.md](MEGAPLAN.md).
It records ground truth, worktree/subagent waves, dependency order and the
lifted native/runtime review gate; it promotes no phase or acceptance field.

P00 and P01 are complete. Fresh iOS/Android builds and native engine/edit/undo/reopen checks pass on both targets; see [P01](reports/P01.md) for provenance.

P02 is in progress. Native task/cache/binary, checkpoint recovery, atomic edits,
telemetry consent/export, picker import and bookmark recovery pass on iOS/Android.
The real SQLite/HTTP collaboration service passes restart/conflict checks, and
both native apps recover ambiguous uploads plus later edits across relaunch.
The native lab now links reserved regions and uses the existing precision
scrubber with Cadence-owned ranges/commits. Simulator decrement and undo/redo
pass on both targets; iOS Duo fold transitions preserve the document. Shared
playback disposal preserves preview/capture focus arbitration.

Remaining work includes product recovery/playback integration, assistive-technology
acceptance, Android recipient delivery, wider provider cases and other required
host/platform evidence. Realtime object merging and presence are separate later
work. See [P02](reports/P02.md) and [N-11](N11-collaboration.md) for evidence/limits.

P03 is in progress. Genuine Android decoding and corrected iOS audio trimming
pass the generated native H.264/AAC frame/PCM fixture on both simulators.
Playback and frame-accurate scrubber integration remain active work.

No component has been promoted to fully accepted across all required platforms.
Each phase appends its report, evidence and commit checkpoint.

Umbrella PRs: [Forge #63](https://github.com/mikevocalz/nitro-forge/pull/63) and [NYC-Tron #54](https://github.com/mikevocalz/NYC-Tron-UI/pull/54).

## Audio detail composition checkpoint (2026-11-07)

Cadence now composes existing routing, send, insert/preset/parameter and MIDI controls through the shared document write gate. This is a source implementation checkpoint; required runtime and platform acceptance remain open. See [Cadence detail controls](../design/CADENCE_DETAIL_PHASE.md). The new audio target propagation is owned by NYC-Tron `48aef26`; consumer alpha.4 pins remain unchanged pending review and release.

## Timeline detail composition checkpoint (2026-11-07)

Splice now composes the canonical marker, transition and batch controls with its existing timeline adapter. Annotation-aware UI bounds and shared clip selection are integrated into the stage without changing the engine's clip duration. See [Splice detail controls](../design/SPLICE_DETAIL_PHASE.md). Builds and source review do not promote the required runtime/platform acceptance fields.

## MIDI grid and scroll checkpoint (2026-11-07)

NYC-Tron `c81ef50` adds rational time-signature grids and controlled horizontal anchors. Forge's capability-aware host binding preserves the alpha.4 fallback while accepting the new source contract. See [MIDI host binding](../design/MIDI_HOST_BINDING_PHASE.md). Static checks and source review do not promote runtime/platform acceptance.

## Cadence automation and analysis checkpoint (2026-11-07)

The Analysis panel composes supported automation edits, engine response curves and bounded on-demand offline analysis. Parent/child selection and source admission guard writes and reads. See [Cadence automation and analysis](../design/CADENCE_ANALYSIS_PHASE.md). Static checks/source review do not promote runtime/native acceptance; no audio host or simulated live measurements were added.

## Tally data and view checkpoint (2026-11-07)

Tally now composes controlled selection, bounded atomic TSV paste/clear and view-only freeze commands with active-sheet checks. Measured freeze limits feed the same bounded cell reads and admission generation. See [Tally data/view controls](../design/TALLY_DETAIL_PHASE.md). Unsupported formatting/data-structure operations, legacy widget focus/scroll resets and runtime/native acceptance remain explicit. No full acceptance field is promoted.

## Active scope and pushed source checkpoints (2026-11-07)

The user extended the original P02–P11 request through the final phase. The ledger contains 21 phases numbered P00–P20, so active scope is all remaining original phases through P20. See [P02–P11 implementation map](P02-P11-IMPLEMENTATION-MAP.md) and [P12–P20 implementation map](P12-P20-IMPLEMENTATION-MAP.md). This scope extension did not answer or lift the existing review gate for full/runtime/native testing. Phase and platform acceptance fields remain unchanged.

Pushed source checkpoints: source/acceptance reconciliation `428e534`; Prism inspector/write ownership and bounded PNG delivery `995ce12`; experimental player source recovery/provenance `df28780`; recovery buffer ownership/cancellation `0263d2c`. NYC-Tron adds actual native presentation timestamp enumeration in `f9a071d`, with TypeScript checks passed and Swift/Kotlin compilation still open. [P10/P11 prerequisites](P10-P11-ENGINE-PREREQUISITES.md) records the missing backend scope without replacing it with UI settings.

## Persistent document operations checkpoint (2026-11-07)

Tally now persists sheet ordering and semantic tab tones (`0938cd3`), duplicates independent sheet data and guards ID exhaustion (`13b099d`). Its actual host forwards the canonical callbacks and discards positional rename drafts on source/readiness changes. Pitch adds persistent object ordering (`be711fa`) and atomic partial text-style edits (`d5709a6`). Quill preserves direct font families (`ab88727`) and exact half-point font sizes (`c46cbe2`) through snapshots, history and DOCX. See [source review](reports/P13-P14-QUILL-SOURCE-REVIEW.md) and linked per-slice reports. Scoped TypeScript and Rust regression-source compilation pass; new tests were not executed under the review gate. These are implementation checkpoints within P12–P14, not completed original phases.

Further source checkpoints: real bounded Cadence WAV delivery (`4302c65`), Prism boolean/group/path styling (`2eb4a21`, rejection handling `c6e7ece`) and preserved opt-in native monitor integration (`469f258`). The native candidate's default dependency, ABI/Fabric and runtime gates remain open; original local work was preserved rather than discarded. The full original source/engine/platform exits in the implementation maps remain the work list through P20.

## Latest source boundary (2026-11-07)

Further pushed operations: Tally protected-sheet editing guard and real host toggle (`81cd05b`); Pitch in-place animation effect/timing updates (`f84f889`); Quill exact RGB inline shading through DOCX (`4499943`). Combined preview TypeScript, production Vite bundle, Rust regression-source compilation for Tally/Pitch/Quill, whitespace and completion-ledger checks passed after these changes. Regression cases were compiled, not executed. GitHub Actions were queued when inspected; no green-CI claim is made.

The original P02–P20 exits remain open, including required native/provider acceptance and the remaining photo/motion backend scope and absent design/CAD backends identified in the implementation maps. Continue from the actual remaining operation tables and maps, not a newly invented phase numbering. Keep the existing review gate for native rebuilds/runtime/full suites unless the user lifts it. Experimental native monitor/player default dependencies remain local candidates, with source preserved in the opt-in patch and provenance reports. Do not merge, publish or update consumer pins as though P19/P20 had passed.

## Current execution scope (2026-11-07)

The user's latest selection is groups 1, 2 and 3: finish P02–P03 recovery/media and focused native validation, P04–P09 host integration, and P10–P17 production backend/document work. This includes the focused validation named in group 1. Broad P19 platform acceptance and P20 release remain separate; no completed phase or green platform field is inferred from these checkpoints. [Project environment](PROJECT-ENVIRONMENT.json) records the inspected runtime/toolchain setup.

Focused P02 fault-injection checks now execute the recovery changes: **20 tests pass** across recovery ownership, autosave and collaboration-checkpoint files. They prove the tested resource/buffer/error/cancellation contracts with controlled host/storage adapters; they are not native storage/relaunch acceptance. See [recovery evidence](reports/P02-recovery-buffer-ownership-source.md).


Motion now has a registered bounded 2D source backend (native/checkpoint tag 8 after Photo 7). It persists shape layers/keyframes, evaluates hold/linear/Bezier curves and renders actual Prism RGBA frames, with atomic history/batch/restore and explicit resource caps. Focused Rust, CLI/FFI, checkpoint-tag and typed-source checks pass; see [Motion source report](reports/P11-motion-source.md). This supplies one P11 backend slice, not the complete motion/compositing exit. Native rollout, nested compositions, media, mattes/effects, spring/expressions/particles/3D and encoded render queues remain open.

## Focused native and backend checkpoints (2026-11-07)

NYC-Tron now has actual iOS Expo decoder-bridge and AVPlayerLayer lifecycle evidence (`b192a23`), with two unchanged recorded passes per flow. Android's affected modules/app compiled; final player owner/range changes compile (`6d07b08`). APK assembly and emulator runtime remain pending disk capacity, last measured near 3 GiB free. The linked Tron reports record precise source/build hashes and exclusions; these are focused P03 results, not full codec/performance/platform acceptance.

Forge now registers Photo (`40bfd4c`) and bounded 2D Motion (`e4489ba`) with distinct additive native/checkpoint identities. Photo preserves original/version metadata, ratings and labels. The isolated genuine RAW-to-Prism proof (`d902db3`) validates decoded pixels, history and snapshots without admitting a default native RAW provider. Motion returns real Prism-rendered RGBA with persistent scalar curves and atomic history; 9 engine, 1 FFI and 4 registration checks pass after renderer-bound correction. [Photo](reports/P10-registered-photo-catalog-source.md), [RAW](reports/P10-libraw-isolated-decode-source.md) and [Motion](reports/P11-motion-source.md) reports retain wider backend/host/processing limits.

Folio now persists bounded Unicode annotation text edits in actual PDFs (`1d94fc0`): 20 engine and 4 adapter tests pass, including save/reopen, undo/redo and rejected-edit atomicity. The pinned comment control has no edit callback, so no replacement UI is invented. Cadence's actual track rename is connected through the existing write gate (`58da4d5`); draft ownership preserves unrelated refreshes and geometry, with scoped TypeScript and 4 existing admission checks passed. Mounted focus/native acceptance remains open.

Original phase statuses and acceptance remain unchanged. The completion validator still reports 341 components, 21 phases, 8 required platforms and 0 fully verified, with all 329 library source reviews recorded. These checkpoints are pushed separately; broad P19 acceptance, release and consumer pins remain open.

## Additional pushed P12–P17 source checkpoints (2026-11-07)

Pitch section boundaries (`d74a22f`) now persist stable identities through reorder, deletion and history; 25 engine and 11 adapter tests pass. Quill style-preserving Unicode case conversion (`607043f`) retains complete run styles and returns adjusted selections; 46 engine and 10 adapter tests pass. Tally bounded conditional aggregates (`276a57b`) evaluate actual stored formulas; all 49 engine tests pass. Their source reports document the pinned UI callback boundaries, editing grammars and intentional formula subset.

Design9 (`58e3d33`) supplies fixed frame trees, row/column layout and actual Prism RGBA. Eight engine tests, a final registered FFI test and six then-current registration checks pass. Draft10 (`b195744`) supplies real 2D snaps, bounded linear constraints and rendered paths; eight engine tests, a registered real-pixel FFI test and the final eight registration checks pass. Tests preserve all eleven native/checkpoint identities. Draft registration tests use an explicit task-only workspace alias; fresh installed native/public consumers remain separate gates. Neither source engine is activated in a default product or promoted to full P16/P17 acceptance.

NYC-Tron Android `101016b` now directly owns MediaPlayer/SurfaceView without automatic VideoView focus, with generation/resource guards and aspect-fit layout. Corrected final source passes actual Kotlin compilation, nine architectural checks and scoped TypeScript. Those checks are not native behavior acceptance. The user explicitly said to continue code while additional disk space is unavailable; APK/emulator/runtime validation remains pending. The parent reclaimed only this task's generated Rust incremental cache after checking that no Rust compiler jobs were active, preserving source, binaries, evidence and global caches.

The current code checkpoints are committed and pushed separately. Remaining original scope includes production RAW/develop/storage, wider motion/compositing, complete document/office/PDF processing, design/prototype and general CAD/3D workflows, product/native integration and acceptance. No original phase is newly closed by these bounded source checkpoints.

## Wrapped layout, drafting commands and PDF threads (2026-11-07)

Design wrapping (`373858f`) adds actual row/column line breaking, per-line alignment/justification and rendered pixels while retaining legacy nonwrap snapshots; all eleven Design tests and scoped TypeScript pass. Hug/fill and actual product adoption remain open.

Draft command/guides (`88d2710`) add real anchor-dependent ortho/polar projections, an explicit bounded command parser and atomic line creation. Eleven engine tests and five binding/real-CLI tests pass. Canonical source bindings require host admission and retain the full source revision so stale query feedback is withheld. Published alpha.4 lacks those CAD subpaths; no default consumer is activated.

Folio replies/review (`8a6d036`) persist actual PDF replies, separate author-specific Review state records and atomic descendant deletion. Twenty-seven engine tests and eight TypeScript tests pass, including saved PDFs, shared-page ownership, generic annotation deletion, stale metadata and target-payload protection. Reply/resolve requires caller identity/time and a generation/write gate; no identity or clock is fabricated. Rendering, general imported-PDF coverage, native consumer/runtime checks and wider P15 exits remain open.

After these checkpoints, the scoped preview TypeScript and completion validator pass. Acceptance remains 0 fully verified across the required platform matrix; source count remains 329/329. Experimental player/monitor files remain preserved local opt-in candidates, outside these staged changes. Android APK/emulator checks remain deferred by the user's explicit capacity constraint.

## Intrinsic sizing and owned pixel processing (2026-11-07)

`f125c05` adds actual Design fixed/hug/fill dependency evaluation, read-only capabilities and fixed transitions that freeze evaluated geometry. `10f820b` adds owned Motion raster assets/layers, actual Prism image rendering and legacy snapshot/describe compatibility. `073c9b9` adds persistent Photo recipes and real bounded sRGB preview processing with exact identity/recipe guards. The decoded-pixel pipeline is real, while original storage/RAW decoding, ICC profile handling, lens/mask/tone-curve controls and wider motion/design exits remain open. Bounded Kelvin/tint white balance now persists and affects preview pixels as a declared sRGB blackbody approximation (see [the white-balance source report](reports/P10-photo-white-balance-source.md)).

Review also fixed a shared decoder bug (`6949110`) that accepted non-ASCII input as zero bytes. Package test scripts and portable CI discovery now cover the new backend tests. The final local check set passes 54 Rust tests, 18 source/CLI tests, four focused binary FFI tests and preview TypeScript; see [discovery and interoperability](reports/backend-test-discovery.md). Remote CI and native targets remain separate. No platform/phase acceptance or consumer pin is promoted.

## Office numbering, animation and circular geometry (2026-11-07)

Pushed checkpoints add real Quill list definitions and DOCX numbering (`da312b6`), Pitch explicit animation triggers/effects (`cb3ad8d`), Draft circular geometry/analytic snaps (`8d4f2f4`) and Folio text-markup quadrilaterals (`0e5f2bc`). New Quill/Pitch/Draft features use engine-local versioned snapshot containers so old permissive readers reject instead of silently discarding metadata. Legacy document encoding is preserved where the new features are absent.

Focused local checks pass 123 office Rust tests (Quill 60, Pitch 34, Folio 29), 51 office TypeScript tests (12/24/15), 60 Photo/Motion/Design/Draft Rust tests and 20 source/CLI backend tests. Preview TypeScript and completion validation pass. The office CI job now executes its Rust document/interchange tests before compiling the real CLI. Exact limits and unsupported cases remain in the linked [Quill](reports/P12-quill-list-numbering-source.md), [Pitch](reports/P14-animation-effects-triggers-source.md), [Draft](reports/P17-draft-circular-source.md) and [Folio](reports/P15-text-markup-geometry-source.md) reports. Native/visual acceptance, remaining original phase exits, release and consumer pins remain open.

Quill's later marker checkpoint (`038dc87`) derives actual starts, continuation and mixed-context labels from its complete stored block read. NYC-Tron `ca90f80` admits explicit host markers through an advertised source capability; older installed controls retain the strict preview gate. Sixteen focused Quill tests and sixteen Tron office-model tests pass, with package/UI/public-slot typechecks passed. This is source integration, with no default consumer or release activation.

Folio shape checkpoint `32f2b51` adds saved Square/Circle annotations and canonical rectangle/ellipse tool forwarding. Independent review identified minimum-PDF-version handling: older imported headers now upgrade with the shape edit and undo restores the original version, preserving newer headers/catalog metadata. All 31 Folio Rust tests, 15 TS tests and package typecheck pass. See [shape source report](reports/P15-shape-annotations-source.md); renderer placement and viewer/native acceptance remain open.

## folio-render pdfium admission executed (2026-11-12)

The P15 PDF backend decision is now executed as a documented admission in [P15-folio-render-admission](reports/P15-folio-render-admission.md): pdfium via `pdfium-render` remains the primary render/text backend with hayro as the WASM/pure-Rust hedge. License facts were re-verified (pdfium BSD-3-Clause with shipped third-party notices; `pdfium-render` 0.9.5 MIT/Apache-2.0; hayro 0.9.0 Apache-2.0/MIT, MSRV 1.92/edition 2024). A /tmp-only spike extracted the `chromium/8138` mac-arm64 `libpdfium.dylib`: clean system-framework linkage and 112 `FPDF_*` exports confirmed on this dev host; no artifact committed. The report proposes a `rust/folio-render` host-service crate boundary (not an Engine, preserving the I/O-free contract), an in-process runtime-bound FFI worker, a proposed `open`/`renderPage`/`textPage`/`search`/`pageInfo` op contract mapped to K-01–K-21 rows, license-notice obligations, and security/input-bound notes. All non-dev-host builds remain NOT-RUN; no crate, dependency or platform acceptance was added.

## folio-render first implementation slice (2026-11-12, `codex/w5-folio-r`)

The admitted `folio-render` host service is implemented in `rust/folio-render` (workspace member): pdfium via `pdfium-render` 0.9.5 (`pdfium_8125` bindings feature) runtime-bound to a never-committed `libpdfium.dylib`, JSON-lines ops `open`/`renderPage`/`textPage`/`search`/`pageInfo`/`close`/`describe` over engine save bytes, fail-closed bounds per the admission record, and the `folio-render` binary plus `@nitro-forge/folio/render` TS adapter (`FolioRenderService`). `FOLIO_DEFERRED_OPS` no longer lists `renderPage`/`textPositions`; the op contract is recorded in `docs/ENGINE_OPS.md` §folio-render service. Verified on this macOS arm64 host: 6 Rust tests against the real chromium/8138 dylib and 5 vitest e2e driving `FolioDocument.savePdf` bytes through the binary (44 folio vitest total; folio-engine unchanged at 149). iOS/Android/Linux/Windows/WASM remain NOT-RUN; the pdfium binary is resolved via `FOLIO_PDFIUM_LIBRARY`/`FOLIO_PDFIUM_DIR`/`rust/folio-render/lib/` with tarball+ dylib SHA-256 recorded in `rust/folio-render/README.md`. No phase or platform acceptance is promoted.

## Consuming-app adoption for photo/motion/design/draft (2026-11-07, `codex/w14-consumers`)

The four newer engines are now exercised by real consuming apps, closing the
activation gap noted in earlier checkpoints. `apps/console` demos all 11
engines end-to-end through nf-cli (photo catalog/develop preview, motion
composition evaluate/render, design layout, draft profiles — each with
undo/redo and snapshot reopen; 28/28 checks, failures now exit non-zero).
`STUDIOS` gains `photo`/`motion`/`design`/`draft` with app manifests, workspace
icons, read-only `ForgeDocumentStage` projections and shared `EditorConfig`s
in `apps/example` (also consumed by `apps/studio-preview`), matching the
existing generic folio/pitch adoption pattern — no new UI framework or
dedicated canvas surfaces were added. The studio-preview `/api/engine` bridge
verification now covers all 11 kinds (draft `source_revision` normalized as
non-undo state). The Nitro kind boundary already carried tags 7–10; no spec
regeneration or Rust changes were needed. Dedicated editing surfaces, native/
device acceptance and any P10–P19 phase promotion remain open; see the ROSTER
section of the same name for exact commands and results.

## nf-color ICC provider first slice (2026-11-08, `codex/w20-nf-color`)

The P07 ICC color-management decision is now executed as a host-side provider
crate `rust/nf-color` (workspace member, same non-engine contract class as
`nf-raw`/`folio-render`: no Journal, no snapshot, no document I/O). It wraps
moxcms `=0.8.1` — the exact version already in `Cargo.lock` via image 0.25 —
with the `extended_range` feature enabled for gamut measurement. v1 scope per
the decision record: bounded ICC parsing (`MAX_PROFILE_BYTES` 8 MiB plus
moxcms CLUT/TRC caps; hostile/mutated-profile rejection tested), built-in
sRGB/Display-P3/Rec.2020/AdobeRGB/ProPhoto profiles, RGB/RGBA/CMYK/Gray buffer
transforms under all four rendering intents, chained soft-proof
(doc → proof → display), and gamut measurement by f32 out-of-range detection
plus a round-trip delta cross-check (approximation of `cmsFLAGS_GAMUTCHECK`;
method and thresholds are part of the `GamutReport` contract). Real ICC
fixtures are vendored under `tests/fixtures/` with per-file provenance in
`rust/nf-color/THIRD_PARTY_NOTICES.md`. Verified on this dev host:
`cargo test -p nf-color` 21 pass, `cargo build --workspace` clean; evidence
log `docs/completion/evidence/w20-cargo-test-nf-color.log`. NOT done: no
JSON-lines host protocol, no WASM/bundle-size measurement, no ICC-aware PNG
encode, no spot/ink model; engine crates untouched and `prism-engine` keeps
`rgba8-straight-sRGB` as its working space. No phase or platform acceptance
is promoted.

## raw-decode service first slice (2026-11-08, `codex/w24-raw-wiring`)

The P10 RAW product admission's deferred host-wiring step now exists as
`rust/raw-decode`, a non-engine JSON-lines service in the
`folio-render`/`splice-render`/`nf-raw` provider family: ops `probe`,
`decodePreview`, `jobStatus`, `cancelJob`, `describe` run
`nf_raw::probe`/`nf_raw::decode_preview` on a single dedicated LibRaw
worker thread (the admission's single-worker rule) with bounded jobs
(≤8 live, ≤256 MiB queued input) and cooperative `AtomicBool`
cancellation at LibRaw callback boundaries. The `@nitro-forge/photo` TS
surface gains `RawDecodeService` (spawn adapter, `RAW_DECODE` env,
default `target/debug/raw-decode`) and `processDecodedPreview`, the
admitted chain original bytes → bounded RGBA8 →
`PhotoDocument.processPreview`, whose existing identity/recipe guards
reject stale decodes. No engine crate, op name, snapshot format or
`components.json`/`ENGINE_OPS.md` row changed; `asset_ref` resolution and
original-byte retention remain unimplemented host concerns, and decoded
output is preview-quality (no ICC/develop pipeline). Verified on this dev
host (macOS arm64): `cargo test -p raw-decode` 11 pass plus the ignored
real-fixture test pass against the CC0 Pentax K-7 DNG
(`NF_RAW_TEST_FIXTURE`, sha256 `f441c366…c92386`);
`pnpm --filter @nitro-forge/photo test` 14 pass including 4 raw.e2e
tests that drive the real binary into the real engine (identity develop
byte-equal, stale recipe rejected); `cargo build -p nf-cli` and photo
`tsc --noEmit` clean. iOS/Android/visionOS/Quest/PICO/Linux/Windows/WASM
remain NOT-RUN per the admission; CDDL source-offer mechanics for shipped
binaries are still open. No phase or platform acceptance is promoted.
