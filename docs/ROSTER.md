# Nitro-Forge Task Roster

Living ledger per the project operating standard. "Evidence" means a command whose
output actually exists; anything not executed is marked NOT RUN.

## Verified — evidence exists

| Check | Result | Command |
|---|---|---|
| ignition-core contract tests | 5 pass | `cargo test -p ignition-core` |
| prism-engine unit tests | 158 pass | `cargo test -p prism-engine` |
| tally-engine unit + formula tests | 212 pass | `cargo test -p tally-engine` |
| cadence-engine tests (incl. real PCM render, stems, clip split/gain/mute, beat detection) | 70 pass | `cargo test -p cadence-engine` |
| @nitro-forge/cadence vitest e2e via nf-cli | 45 pass | `pnpm --filter @nitro-forge/cadence test` |
| splice-engine tests (incl. track flags, ripple/roll/slip/slide, insert/overwrite, transitions, markers, loop range, batch, keyframed speed, per-clip mix) | 55 pass | `cargo test -p splice-engine` |
| splice vitest via nf-cli + unit (timeline ops, cluster, transfer, keyframed speed, clip mix) | 39 pass (incl. 7 speed-keys e2e + 4 clip-mix e2e + 1 view unit) | `pnpm --filter @nitro-forge/splice test` |
| folio-engine tests (real PDF round-trip via lopdf; page ops, ink/link annots, encryption, outlines, form fields, signatures, attachments) | 112 pass | `cargo test -p folio-engine` |

| cadence-engine tests (incl. real PCM render) | 21 pass | `cargo test -p cadence-engine` |
| splice-engine tests (incl. track flags, ripple/roll/slip/slide, insert/overwrite, transitions, markers, loop range, batch) | 44 pass | `cargo test -p splice-engine` |
| splice e2e via nf-cli (timeline ops) | 11 pass (4 existing + 7 new) | `pnpm --filter @nitro-forge/splice exec vitest run` |
| folio-engine tests (real PDF round-trip via lopdf; page ops, ink/link annots, encryption, outlines, form fields, signatures, attachments, structural redaction, PDF compare, page images, encryption reconciliation) | 144 pass | `cargo test -p folio-engine` |
| pitch-engine tests (animation timing) | 17 pass | `cargo test -p pitch-engine` |
| quill-engine tests (incl. real DOCX zip round-trip, lists, case, bookmarks, styles, sections, comments, revisions/track-changes, footnotes/endnotes, TOC fields, citations/bibliography, tables incl. cell merge/unmerge and in-cell find/replace, paragraph format, mail merge, session font registry + harfrust-shaped measured layout) | 238 pass | `cargo test -p quill-engine` |
| nf-sys C FFI + dispatch tests (incl. folio binary-input gate) | 28 pass | `cargo test -p nf-sys` |
| Package e2e suites (vitest → nf-cli → real Rust) | 4×8 = 32 pass | `pnpm -r test` |
| Console workflow demo (all 7 products, create→edit→save→reopen) | 14/14 checks | `pnpm --filter @nitro-forge/console demo` |
| Typecheck: ignition + 7 product packages + apps/console + apps/example | clean | `pnpm -r exec tsc --noEmit` |
| Post-review full workspace retest | 184 Rust + 32 vitest pass | `cargo test --workspace && pnpm -r test` |
| Folio slice E (redactRect + comparePdf, 2026-11-07 `codex/w1-folio-redact`; review fixes `codex/w1-folio-e`) | 133 folio Rust tests + 35 folio vitest pass; nf-cli build + folio typecheck clean | `cargo test -p folio-engine`, `cargo build -p nf-cli`, `pnpm --filter @nitro-forge/folio test`, `pnpm --filter @nitro-forge/folio typecheck` |
| Splice per-clip mix (`gain_db`/`pan`, `setClipMix`; `codex/w4-splice-mix`) | 55 splice Rust tests + 39 splice vitest pass; nf-cli build + splice typecheck clean | `cargo test -p splice-engine`, `cargo build -p nf-cli`, `pnpm --filter @nitro-forge/splice test`, `pnpm --filter @nitro-forge/splice typecheck` |
| Folio slice F (encryption reconciliation + insertPageImage, 2026-11-11 `codex/w1-folio-f`; review fixes same branch) | 149 folio Rust tests + 39 folio vitest pass; nf-cli build + folio typecheck clean; nf-sys 28 pass | `cargo test -p folio-engine`, `cargo build -p nf-cli`, `pnpm --filter @nitro-forge/folio test`, `pnpm --filter @nitro-forge/folio typecheck`, `cargo test -p nf-sys` |
| folio-render service first slice (pdfium host service, 2026-11-12 `codex/w5-folio-r`; admission `P15-folio-render-admission.md`) | 7 folio-render Rust tests pass against real `libpdfium.dylib` (chromium/8138, pdfium 159.0.8138.0) on macOS arm64 + 44 folio vitest pass incl. 5 render.e2e driving engine `savePdf` bytes through the `folio-render` binary; folio-engine unchanged 149 pass; folio typecheck clean. All other platforms NOT-RUN | `cargo build -p folio-render`, `cargo test -p folio-render`, `cargo test -p folio-engine`, `pnpm --filter @nitro-forge/folio test`, `pnpm --filter @nitro-forge/folio typecheck` |
| quill font/glyph backend first slice (2026-11-08 `codex/w5-quill-font`; decision `P-font-glyph-backend-decision.md`) | 236 quill Rust tests pass (9 new: registry identity/dedup, payload+hostile-byte validation, 64-face cap, remove-by-hash, session-state snapshot/undo exclusion, real-advance wrap + hard break, heading/table coverage, fixture advance values) + 54 quill vitest pass incl. 4 fonts.e2e via nf-cli; nf-cli build + quill typecheck clean. Deps admitted: skrifa 0.49.0 (MIT OR Apache-2.0, autohint_shading pinned out via default-features=false+std), sha2 0.10.9 (MIT OR Apache-2.0, already in tree). Measured: unhinted cmap+hmtx advances. NOT done: harfrust shaping, rasterization, per-run font resolution, TOC page numbers, renderPage | `cargo test -p quill-engine`, `cargo build -p nf-cli`, `pnpm --filter @nitro-forge/quill test`, `pnpm --filter @nitro-forge/quill typecheck` |
| quill font/glyph backend second slice — harfrust shaping (2026-11-08 `codex/w5-quill-shaping`) | 238 quill Rust tests pass (2 new: shaped kern/ligature advance values, shaped-vs-stub wrap spans; fixture gained GPOS kern W+W −300 and GSUB liga f+i→f_i, 97 glyphs) + 55 quill vitest pass (1 new ligature-wrap fonts.e2e) via nf-cli; nf-cli build + quill typecheck clean. Dep admitted: harfrust 0.15.0 (MIT, MSRV 1.85, default-features=false+std → builtin UCD, no icu). `layout {font}` now shapes each block's text once (full default GSUB+GPOS feature set) and folds glyph x_advances onto cluster-first chars for the greedy wrap; shaping failure/panic falls back to unshaped advances per block. NOT done: per-line re-shaping, glyph positions/extents, rasterization, per-run font resolution, TOC page numbers, renderPage | `cargo test -p quill-engine`, `cargo build -p nf-cli`, `pnpm --filter @nitro-forge/quill test`, `pnpm --filter @nitro-forge/quill typecheck` |
| Prism brush/stroke engine (P06; `codex/w5-prism-brush`, per `docs/completion/reports/P-prism-brush-ink-decision.md`) | 158 prism Rust tests + 32 prism vitest pass (incl. 5 new brush/stroke e2e via real nf-cli); `cargo build -p nf-cli` + prism typecheck clean; `pnpm install --prefer-offline` clean | `cargo test -p prism-engine`, `cargo build -p nf-cli`, `pnpm --filter @nitro-forge/prism test`, `pnpm --filter @nitro-forge/prism typecheck` |

## Transport status

| Transport | Status |
|---|---|
| nf-cli JSON-lines | ✅ verified — powers all e2e suites |
| folio-render JSON-lines (pdfium service) | ✅ verified macOS arm64 only — powers render.e2e; other platforms NOT-RUN |
| nf-sys C ABI (staticlib/cdylib) | ✅ verified — FFI round-trip test passes |
| Nitro HybridObject codegen (nitrogen) | ⚠️ spec written (`Forge.nitro.ts` + `nitro.json`); codegen NOT run |
| iOS / Android / WASM builds | ❌ NOT RUN |
| apps/example on simulator/device | ❌ NOT RUN |

## Workstreams

| Workstream | Role | Task | Status |
|---|---|---|---|
| Ignition contracts | Architect (main session) | ARCHITECTURE.md, ignition-core, protocol, envelope, journal, registry | ✅ verified |
| C FFI | Platform eng (main session) | nf-sys | ✅ verified (1 test) |
| TS host/DX | API eng (main session) | EngineHost/NitroHost/CliHost/DocumentHandle, 7 typed APIs | ✅ verified via e2e |
| Prism engine | Graphics eng (subagent 3ba36e7a) | layers, pixels, filters, flatten; 2026-11-05 W2 ops slice: `modifySelection` smooth, `crop` (intersection semantics; transformed rasters reject), `samplePixels` (composite eyedropper, premultiplied average); 2026-11-11 W2 slice: `duplicateLayer` (subtree-aware deep copy, fresh ids, remapped parents); 2026-11-05 W5 slice: brush/stroke engine (`modelStroke`, brush CRUD, `paintStroke` dab pipeline per ink-admission decision; review fixes: angle-wrap hardening, layer-transform/selection-aware stamping, 2^28 stamp-pixel budget, eventless no-ops, brush-id restore validation) | ✅ 158 tests |
| Tally engine | Spreadsheet eng (subagent ddf87203) | formula parser/evaluator | ✅ 27 tests |
| Cadence engine | Audio/DSP eng (subagent 75836ea5) | MIDI clips, transport, PCM render; 2026-11-05 w3: renderStems, splitClip/setClipGain/setClipMute, detectBeats | ✅ 70 tests |
| Splice engine | Video systems eng (subagent 75836ea5) | timeline, split/trim/speed; 2026-11-05: track flags, ripple/roll/slip/slide, insert/overwrite, transitions, markers, loop range, batch; 2026-11-07: keyframed speed (`speed_keys`, `setSpeedKeys`, integral footprint through all structural ops); 2026-11-08: per-clip mix (`gain_db` -60..=12, `pan` -1..=1, `setClipMix`, renderPlan exposure — storage/plan metadata only, no mixer) | ✅ 55 tests |
| Folio engine | PDF eng (subagent bdd8014e; slice E codex/w1-folio-redact; slice F codex/w1-folio-f) | lopdf parse/annotate/save; page ops (move/delete/duplicate/insert/listPageInfo), ink/link annots, encryption (encrypt/decrypt + `open {password}`; all mutating and string-decoding ops reject ciphertext docs), outline (bookmark) ops, form fields (listFormFields/fillFormField, checkbox+radio subset), signatures (listSignatures read), file attachments (list/get/addFileAttachment), structural redaction (redactRect: annots + contained image XObjects + PieceInfo/XMP//Info scrub, honest retained reporting, text/vector explicitly not removed), structural PDF compare (comparePdf: page/annot/field/outline/attachment/signature projections, lossy text hint), page images (insertPageImage: jpeg DCTDecode passthrough, real PNG decode gray/RGB alpha-discarded with local five-filter unfiltering, raw 8-bpc samples; appended content stream, inherited /Resources cloned) | ✅ 149 tests |
| folio-render service | PDF render/text host service (codex/w5-folio-r) | `rust/folio-render`: pdfium via pdfium-render runtime binding; JSON-lines ops open/renderPage/textPage/search/pageInfo/close/describe over engine save bytes; TS adapter `@nitro-forge/folio/render`; `FOLIO_DEFERRED_OPS` lifted for renderPage/textPositions | ✅ 6 Rust + 5 vitest e2e, macOS arm64 only |
| Pitch engine | Presentation eng (subagent bdd8014e) | slides, objects, animation resolve | ✅ 17 tests |
| Quill engine | Text/layout eng (subagent fa0fd913) | blocks/styles/layout + DOCX + lists + case + bookmarks + named styles + sections/page-setup/headers + range-anchored comments + track-changes revisions (`setTrackChanges` + ins/del records with per-op author/time, accept/reject single+all, schema:3 keys, no DOCX interop) + block-model tables (insert/delete, cell text, row/column structural ops, rectangular cell merge/unmerge via `Table.merges` registry, in-cell find/replace + `text`/`layout` cell coverage; no styling or DOCX table interop) + footnotes/endnotes (`addFootnote`/`updateFootnote`/`removeFootnote`/`listFootnotes`, Pos-anchored right-gravity marks remapped through every position-moving op, per-kind document-order numbering, plain-text bodies ≤8192 chars, ≤1024 notes, schema:3 `footnotes` key, no DOCX interop) + TOC fields (`insertToc`/`updateToc`/`refreshToc`/`listToc`, `kind:"toc"` block with `{from_level,to_level,entries}` cache over h1/h2/h3 kinds, live `listToc` scan, block-index entry anchors remapped/dropped on edits, no page numbers, no schema bump, no DOCX interop) + citations/bibliography (`addSource`/`updateSource`/`removeSource`/`listSources`, `addCitation`/`updateCitation`/`removeCitation`/`listCitations`, `insertBibliography`/`updateBibliography`/`refreshBibliography`/`listBibliography`; Pos-anchored citations naming source ids with right-gravity remap, `removeSource` cascade, `kind:"bibliography"` field block with cached `{source,text}` entries and `"alpha"|"citation"` sort, live `listBibliography` scan, deterministic single-format entry text — no CSL/DOI/URL fetch/Word field interop, no schema bump) + paragraph alignment/indents/tab stops (`setParagraphFormat` patch + `properties.paragraph` on paragraph styles, storage-only, schema:4) + mail merge (`listMergeFields`/`previewMerge`/`runMerge`: `{{name}}` text tokens scanned live — no field collection or schema change — records in op payloads, read-only multi-record preview plus one-undo `runMerge` fill over optional Pos ranges incl. table cells, missing fields merge as "" and report, no CSV/source parsing or DOCX interop) + font/glyph backend first slice (`registerFont`/`removeFont`/`listFonts` session registry over skrifa-parsed host bytes, sha256-keyed, ≤16MiB/face ≤64 faces ≤256MiB; `layout {font}` real unhinted advance-width wrap vs the 0.5em estimate; no shaping/harfrust, no rasterization, fonts excluded from snapshot/undo; `codex/w5-quill-font`) | ✅ 236 tests |
| Independent review | Reviewer (subagent 3cb4c8fe) | FFI safety, engine spot-checks, TS protocol | ✅ 23 findings; 16 fixed + retested |
| Example app | RN eng (main session) | Expo screens + useDocument hook | ⚠️ source + typecheck only |
| Design/UX | — | — | ❌ not staffed this session |
| AI workstream | — | — | ❌ not started (engines are provider-free as required) |
| Performance budgets | — | — | ❌ unmeasured; no perf claims made |

## Independent review — findings & resolution (subagent 3cb4c8fe)

Reviewer reproduced three defects live (nf-cli + a C harness against
`libnf_sys.dylib`). Fixed and retested:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | nf-sys mutex poisoning → process abort on engine panic | Critical | `reg_lock()` recovers poisoned registry at every lock site |
| 2 | nf_snapshot/nf_restore/nf_close lacked `catch_unwind` | Critical | all extern fns now panic-guarded; panic closes the session |
| 3 | nf_free_bytes assumed Vec cap == len (latent UB) | Major | snapshot hands out `Box<[u8]>`; freed as slice, capacity-free |
| 4 | cadence u64 `start+len` overflow panics on crafted input | Major | saturating/checked arithmetic at end_ticks, overlaps, addNote, resizeClip, render |
| 5 | folio `page as u32 + 1` overflow/truncation aliased pages | Major | `u32::try_from` + `checked_add` → OutOfBounds |
| 6 | NitroHost.apply ignored `{"ok":false}` → silent success | Major | throws EngineError on `ok === false` |
| 7 | CliHost: no `error` handler on proc/stdin (ENOENT crash) | Major | `killAll` rejects all pending on error/exit/parse failure |
| 8 | CliHost UTF-8 corruption at pipe chunk boundaries | Major | `StringDecoder` accumulation |
| 9 | folio journal recorded before fallible work | Major | add/removeAnnotation validate destination + existence first |
| 10 | prism restore skipped MAX_PIXELS ceiling | Major | `check_dims` enforced on restore |
| 12 | envelope: unknown format → `Unsupported` not `Serialization` | Minor | spec-aligned; 4 GiB assert added to encode |
| 13 | nf_apply didn't route `__snapshot` | Minor | routed, parity with run_stdio |
| 14 | `*out_err` dereferenced unconditionally | Minor | `set_err` null-checks every write |
| 15 | tally restore accepted unreachable cell keys/dup sheets | Minor | keys normalized via parse/fmt_addr; dup id/name rejected |
| 16 | cadence setTimeSig `as u32` truncation | Minor | bounds-checked (d ≤ 128, n ≤ u32::MAX) |
| 17 | cadence/splice restore could reuse ids | Minor | next_id clamped past max live id |
| 18 | prism drawPixels fractional x/y + event on no-op | Minor | integral coords required; off-canvas emits no event |
| 20 | quill import_docx unbounded decompression | Minor | 256 MiB cap on document.xml |
| 21 | DocumentHandle.emit: listener throw failed apply | Minor | listener errors rethrown via queueMicrotask |
| 22 | CliHost pending leak + URL.pathname | Minor | pending deleted on write error; `fileURLToPath` |
| 23 | unparseable frame answered id:0 → caller hangs | Minor | best-effort `extract_frame_id` |

**Deferred (documented, not fixed):**
- #11 base64 decoders accept non-canonical input (`len%4==1`, stray `=`) —
  leniency is consistent across Rust+TS decoders; tighten if a strict consumer
  appears.
- #19 quill `deleteRange` boundary-block kind merge — behavior is
  self-consistent with `text()`'s newline-inclusive slicing; flagged for
  product-level confirmation rather than changed blindly.

## Known issues & honest limitations
- Three e2e test expectations were wrong vs. spec and were fixed post-review
  (`ZZ99` is a legal cell address; `addClip` defaults to track end; `blocks`
  returns `{blocks:[…]}`). Engines were correct; tests were not.
- Several engines carry a private base64 copy because the ignition-core
  re-export landed after they were written — `ignition_core::base64_*` now
  exists; dedupe is safe but deferred (tracked here).
- Folio `pageText` is a lossy literal-string extractor, documented.
- Folio page ops: structural ops reject encrypted documents (lopdf encrypts
  strings/streams in place keyed by object id); `deletePage` can leave ghost
  `/Type /Page` objects reachable via named destinations/outlines/open-action
  (dest scrubbing deferred); `/PageLabels` number tree goes stale on reorder;
  `duplicatePage` strips `/StructParents`+`/B` but still shares `/PieceInfo`,
  `/Tabs`, `/AA`, `/Metadata` verbatim. `removeBookmark` prunes every
  trailer-unreachable object, including orphans that pre-date the op —
  not only objects the removed items referenced. All documented in
  ENGINE_OPS.md.
- No `.pptx`/`.xlsx` interop; Quill DOCX is real (zip + OOXML).
- Nitro native build (Swift/Kotlin/C++ side of `Forge`) is unwritten —
  `nf-sys` is the C ABI it will call.
- No git remote → commits are local; no PRs.

## Studio workspace implementation — November 3, 2026

Implemented `packages/studio-workspace` over the existing layout core and wired
it into the Expo editor route and `apps/studio-preview`. The shared shell has
three dock zones, tabs, collapse/activate, move/reorder/resize controls, drag
previews, cancellation, compact bottom panels and host-owned presets. Zustand
stores contain UI/document projections; native document handles remain in refs.
The browser harness uses the actual Rust engines through a loopback CLI bridge.

| Check | Result | Evidence |
|---|---|---|
| Strict workspace typechecks, including Expo and browser harness | PASS | `pnpm -r typecheck` |
| Original host/product e2e tests | 32 PASS | `pnpm -r test` |
| Dock layout core tests | 12 PASS | same command |
| New workspace model tests | 8 PASS: isolation, atomic drag/cancel, invalid targets, geometry, compact reset/restore, presets and resize | same command |
| Browser bundle | PASS, Vite 7.3.7; 586.40 kB JS before gzip (size warning remains) | `pnpm --filter @nitro-forge/studio-preview build` |
| Seven-engine HTTP mutation, undo/redo, NFD1 snapshot/reopen; request-origin guards | PASS | `pnpm --filter @nitro-forge/studio-preview test:integration` |
| Frozen workspace lock | PASS | `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts --offline` |
| Browser pointer docking | PASS: Document dragged left→right, status `outline docked` | connected Chrome UI |
| Browser keyboard movement | PASS: Enter on Pitch Commands→Move left; existing slide text retained | connected Chrome UI |
| Engine history survives layout changes | PASS: Quill paragraph undo/redo after moving Commands; layout save/reset/restore retains placement | connected Chrome UI |
| Preset reload | PASS: saved Tally bottom Commands restored after page reload and studio selection | connected Chrome UI |
| Measured responsive hosts / themes | PASS: full width, 768px, 390px; bottom Commands accessible; Prism retained two layers through theme/width changes | screenshots below |
| Browser snapshot download UI | NOT VERIFIED: browser download-wait tooling timed out; bridge snapshot/reopen verified above | no download claim |
| iOS/Android execution, native drag/stylus, VoiceOver/TalkBack, physical fold/hinge, XR | NOT RUN | no suitable running simulator/emulator; native runtime remains separate |

Screenshots: [desktop Tally](ux/evidence/studio-desktop-tally.png),
[390px host](ux/evidence/studio-compact-tally.png),
[768px light host](ux/evidence/studio-tablet-light-tally.png).
These are measured editor containers in Chrome, not native device screenshots.
Browser viewport emulation itself was not established.

Subagent implementation/review found and fixed stale async document actions
crossing studio sessions, panel responder remounts, compact presets reopening side
docks and incorrect PDF/snapshot status wording. The same document stays mounted
while changing layout, theme or measured host width. Switching studios intentionally
closes that studio's current temporary document.

The default stages are read-only projections of engine state. Native raster/PDF
painting, direct manipulation, media playback, object snapping, Rive integration,
independent native floating windows and the broader UX milestone acceptance packet
remain pending. No native manifest/window contract was modified or verified.


## Independent app entry and writing flow — November 3, 2026

User clarified that each app is independently requested from a list. Replaced
browser studio tabs with an app launcher and per-app hash routes; apps open on
first request and retain separate sessions while navigating the list. Browser
reload still ends temporary sessions. The native Expo list already uses separate
routes. Shared shell code remains reusable without imposing a suite-mode UI.

Quill now provides a Zustand-backed essay draft, Unicode-aware minimal engine
edits, conflict detection, snapshot flush and DOCX/NFD opening / DOCX export in
the browser harness. Native example snapshots also flush its writing surface;
native file selection remains a host integration. Formatting outside edited spans
is preserved by the engine; this writing surface is a plain text editor, with
existing format commands remaining available.

Follow-up evidence:
- Workspace tests: 11 PASS (8 docking + 3 text-diff); workspace/example/browser
  typechecks PASS; browser bundle PASS (594.78 kB JS, existing size warning).
- `pnpm --filter @nitro-forge/studio-preview test:integration` PASS: seven engines,
  six Unicode/newline essay edit scenarios, real DOCX export/import and independent
  document state. Integration server stops itself afterward.
- Browser PASS: app list → Quill, type/apply two paragraphs → app list → Tally →
  app list → Quill, essay retained. [App list](ux/evidence/app-list.png) and
  [writing space](ux/evidence/quill-writing-space.png) captured.
- Native essay execution NOT RUN. Automated browser file-selection check blocked
  by Chrome extension file-access permission; permission unchanged. DOCX engine
  import/export passed via the integration bridge, not the file-picker UI.


## Reference-driven visual pass — November 3, 2026

Reviewed the complete current docs plus relevant remote-branch visual/native/icon
contracts. All seven exact Mobbin images from the original ledger were opened
and inspected, alongside additional Craft writing references and the official
Affinity layout image. See [DESIGN_REFERENCE_AUDIT.md](ux/DESIGN_REFERENCE_AUDIT.md)
for exact sources and what was actually visible. No Mobbin artwork is vendored.

- Reworked the existing shared workspace: single document header, one context
  toolbar, optional inspector, original icon rail, Workspace menu, compact panel
  controls and writing-first defaults. History starts collapsed.
- Reused the exact authored icon source from the icons branch, adding typed native
  exports. Expo 54's supported SVG version is pinned. Selected/disabled states and
  reduced-motion handling are active; compiled Rive remains pending.
- Central semantic theme tokens feed native RN styles and generated Tailwind v4
  CSS. Host overrides remain supported. Native home uses the same app manifests,
  theme and glyphs, with typecheck evidence only. Duplicate native headers removed.
- App launcher has original decorative tool previews and actual opened-session
  state. No fabricated recent files, usage counts or document thumbnails.

| Check | Result | Evidence |
|---|---|---|
| All package/app typechecks | PASS | `pnpm -r typecheck`; example rechecked after native home change |
| All JS/TS tests | 61 PASS: 32 host/product, 12 dock core, 12 workspace/text, 5 icon | `pnpm -r test` |
| Browser bundle and Tailwind v4 token compilation | PASS; existing large-chunk warning remains | `pnpm --filter @nitro-forge/studio-preview build` |
| Seven-engine, Unicode essay, DOCX import/export and independent documents | PASS | `pnpm --filter @nitro-forge/studio-preview test:integration` |
| Frozen lockfile | PASS | `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts --offline` |
| Browser controls | PASS: menu/reset, keyboard undo/redo, drag left→right, compact bottom Commands, essay retained through theme/width | Chrome UI |
| Breakpoint band / animated icon cleanup | PASS after fixes: stable outer 724px measurement, real SVG web resolver, RN Animated global alias in both dev and production | Chrome and generated dev code |
| Native iOS/Android, assistive technology, physical fold/pen/XR | NOT RUN | no native execution claim |

[Before/after board](ux/evidence/quill-before-after.html),
[comparison PNG](ux/evidence/quill-before-after.png),
[new app list](ux/evidence/app-list-redesign.png),
[writing page](ux/evidence/quill-redesign.png),
[390px light container](ux/evidence/quill-redesign-compact-light.png).
Screenshots depict measured browser containers, not native devices.

Review found and fixed a rail-induced breakpoint oscillation and an RN Web
Animated cleanup error. A minimum-stage fixture was adjusted from 400px to 380px
because the narrower default left dock now legitimately fits at 400px; the
stage-space rejection invariant remains tested. Shared native-control extraction
with Moyo, SDK-specific Expo UI adapters, native visual baselines and Rive
compilation remain separate release gates. App window/manifest contracts unchanged.

### Studio PhotoCraft / Affinity refresh — November 3, 2026

Shared editor uses cool neutral themes, violet selection, 8pt controls and 12pt
panels, grouped rail controls and denser inspector hierarchy. Browser and native
source app lists use compact directories; separate routes and sessions remain.
Quill paper branding was removed, paragraph labels made readable, and browser
file-action labels shortened while keeping full accessible names.

Prism now uses its actual `flatten` RGBA output, encoded as bounded PNG for
native/web Image. It supports existing engine operations through contextual
rectangle/ellipse/raster creation, raster fill, layer selection, visibility,
opacity, reordering and removal. Default generic Prism docks are collapsed to
reserve the canvas; its context Layers panel opens on first wide measurement.
PNG transfer is limited to 1,048,576 pixels and 4096px per side with explicit
fallback. This is not freehand/node editing, photo import, PSD support or
Affinity feature parity. Native source is wired but native runtime is unverified.

Executed: `pnpm -r typecheck`, `pnpm -r test` (65 tests), preview production
build, frozen lockfile installation, and isolated integration bridge. New proof
checks exact RGBA for raster/rectangle/ellipse compositing, layer visibility,
opacity, order, removal/undo, PNG and snapshot restore. Encoder tests independently
check CRC/zlib/alpha and block boundaries. A regression test covers canvas-first
collapsed Prism preset restoration. Final browser build has the existing >500KB
chunk warning (679KB minified JS), not a build failure.

Chrome native accessibility fallback: Quill typing/apply and desktop/390px host,
Prism fill/shapes/50% opacity/visibility/undo, layer panel dismissal at390px,
and Prism artwork retained through app-list/Quill navigation. Browser extension
connection was unavailable for these captures; native Chrome screenshots include
browser chrome. Full OS/browser matrix, screen reader, physical phone/stylus and
native runtime were not run. Screens in docs/ux/evidence/*refresh.jpg.

Reference evidence and continued critic scores are in docs/ux/studio-refresh.
REA6.8.0 source-only static analysis ran successfully using temporary Node26.12.1,
without global configuration changes; partial coverage and 68 observations are
not runtime validation or bug counts. The bounded summary is committed; full
report stays in ignored artifacts/rea.

### Canonical NYC UI integration — November 3, 2026

User selected `nyc-mon/packages/ui`. Studio now requires a host-injected
`StudioUIProvider`, with actual canonical semantic primitives, native Menu and
Select bindings, Image and input adapters. Browser landmarks and FilePicker
use `@acme/ui/html`. An AST check rejects direct React Native visual imports
inside shared Studio. Dock bars and layer bars reuse the same drag controller.
A release-before-measurement race was reproduced and fixed with an awaited,
cancellable measurement transaction.

Executed: all package typechecks, 70 package tests, preview production build,
and seven-engine integration checks passed. Canonical NYC UI additionally
passed its typecheck, scoped lint and three adapter regression tests. Browser
manual evidence confirms provider Menu/Select operation and real layer drag,
reorder and undo. The final app-list review exposed canonical default style
conflicts; host styles were corrected afterward. A fresh screenshot and the
new browser FilePicker interaction remain unverified because the Chrome
automation window became unavailable. DOCX engine import/export integration
passed independently. No native runtime/device or full browser matrix run.

Canonical UI commit `4154ea344987de4bee94d4ee0e9f0249f66e8087` is local only.
CI pins that paired source commit and was not run remotely; publish the NYC
commit before the NitroForge branch. The legacy Expo54 example is not asserted
compatible with the Expo58 UI runtime. SDK/window/orientation/manifest contracts
remain unchanged. See `docs/ux/studio-refresh/OWN_UI_INTEGRATION.md`.

### Craft Anything browser inspection — November 3, 2026

Official Craft Anything v0.3.0 CLI archive verified against its release digest,
then used through its own persistent MCP server in Clean room mode. Captured
launcher, Prism and the public Affinity iPad page at390/768/1440. Captures found
and drove fixes for canonical utility precedence and tag-dependent helper/footer
styles. All three final launcher images were inspected by the main agent and
continued critic, with readable text and mobile helper hiding confirmed. All
three Prism baseline images were inspected. Preview typecheck and production
build passed after fixes. Quill open timed out; native runtime, file-picker
interaction and the full OS/browser matrix remain unverified. Raw evidence
stays ignored; final launcher images and provenance are committed in docs/ux.
No nested rebuild, global registration or native configuration changes.
See `docs/ux/studio-refresh/CRAFT_ANYTHING.md`.

### Affinity canvas composition — November 3, 2026

Prism now uses a local graphite/blue palette and continuous measured canvas
with floating tool capsule, compact selected-layer ribbon, detached Layers and
stationary fill strip. The artboard fits both available dimensions and preserves
its aspect ratio. Generic dock controls remain reachable through Workspace.
No app-window/orientation/manifest changes or unsupported editor tools. Native
resources remain refs; view state remains per-instance Zustand.

Craft Anything live browser walks created real violet rectangles and teal
ellipses at390/768/1440. Round1 visual review led to compact ribbon and neutral
opacity Menu refinements. Round2 found a genuine clipped popup; a dispatched
click was not accepted as proof of an engine edit. Details, subsequent proof and
limits are in `docs/ux/studio-refresh/AFFINITY_FEEL.md`. Workspace21 tests, all
package typechecks, preview build and seven-engine integration passed. Native
runtime and full browser/OS/device matrix remain unverified.

Final Round3 browser proof: the complete opacity menu is visible, and actual
selection changes the engine layer to50% with a visibly blended canvas at
390/768/1440. Phone final closes Layers without changing the artwork. Main and
continued critic inspected final captures. Final21 workspace tests/typecheck
and preview build passed after popup fix. Images: docs/ux/evidence/prism-affinity-*.png.

### Responsive verification — November 3, 2026

Craft Anything reproduced and verified fixes for narrow-header Save clipping,
a 26px landscape artboard and viewport/stacking clipping of opacity options.
Measured viewport geometry, adaptive header packing and the source-owned NYC
web Menu now support 320×480,320×568,390×667,844×390,1024×768 and 1440×900.
All six accepted runs show actual shape edits and 100%→50% opacity changes;
short landscape uses focus-scroll plus visible click to reach clipped options.
A previously interrupted tablet run passed a frozen-source retry. Keyboard-only
activation, native hardware and the full browser/OS matrix remain unverified.
Success notices expire without altering document state; focused short phone
and landscape images confirm unobscured paper afterward.

All package typechecks, 25 workspace tests, the visual import boundary and
preview production build passed. NYC UI full typecheck, 3 new Menu placement
tests and scoped lint passed. Its local-only paired commit is
c8ac0ddab89076eb4bc28036c5befd7d7d4ab70c; CI pins it but remote CI was not run.
Publish paired NYC source before NitroForge. No native window/config changes.
See docs/ux/studio-refresh/RESPONSIVE.md and prism-responsive-*.png evidence.

### Canonical component inventory and reuse — November 3, 2026

Audited 42 public NYC UI export entries, root/group barrels, platform contracts
and 41 NeonBlade catalog entries. Bound and consumed actual Button/IconButton,
TabBar, SegmentedControl, Toolbar, FieldGroup/KeyValueList, static List/ListItem,
Card, Badge, Banner/ErrorMessage, EmptyState and NightScope, alongside existing
Menu/Select/Input/Image/semantic components. Open uses the actual DropZone and
keeps its FilePicker path. Layer sorting retains its measured domain controller.
The component-first requirement is persisted in AGENTS.md.

Eleven fresh Craft Anything scenarios passed after fixes for tab-order jumps,
compact captions/colour, Card badge wrapping, DOM accessibility labels and RN
line-height conversion. Named Quill text entry/apply updates the real engine
and renders top-left/wrapped at desktop/phone. The motion ESM runtime failure
is fixed through actual installed-module resolution and a UI module export
guard, rather than a replacement motion/control implementation.

Executed 28 workspace tests, all package typechecks, source UI typecheck/lint,
six focused style/type-scale tests, UI module contracts, preview build and
seven-engine integration. Native runtime/hardware, full OS/browser matrix,
screen readers and real drop/picker interaction remain unverified. Paired NYC
commit 782c682ea684606111e612242a66761d50137f95 is local, pinned in CI; remote
CI not run. Native window/config contracts unchanged. See
docs/ux/studio-refresh/UI_COMPONENT_AUDIT.md and docs/ux/evidence/kit-*.png.

## Studio Affinity control finish — November 3, 2026

Canonical NYC UI commit `75617163382235ed698e2230e9eefb70c8e19e06` adds opt-in
Studio appearances to the existing shared controls. Prism adds a direct wide
panel rail, quieter layer selection and a larger measured artboard. Native
window/configuration and document engine contracts are unchanged.

Verified locally: all package typechecks;28 workspace tests; the UI boundary
check;4 motion/18 control export module checks; browser production build;
canonical UI typecheck, scoped13-file lint and6 type-scale/style tests.
The existing production chunk-size warning remains. No remote CI run is claimed.

Craft Anything round1 passed6 fresh scenarios. Final round2 passed5 fresh
scenarios covering1440 desktop,768 tablet,390 phone, Properties open/close and
light theme. Screenshots show real rectangle/ellipse edits,50% opacity and
restored canvas geometry after panel closure. One standalone desktop browser
WebSocket failure is retained and excluded; the successful extended desktop
scenario repeats the same editing flow. A startup timeout occurred before app
navigation and succeeded on retry. Both visual review rounds were inspected.

Final proof index: `artifacts/craft-anything/affinity-evolution-r2/verified-summary.json`.
Committed representative screenshots: `docs/ux/evidence/affinity-studio-*.png`.
Portable desktop/phone scripts: `apps/studio-preview/qa/affinity-editor-*.json`.
Native runtime, physical input, screen readers and full OS/browser matrix are
unverified. Rea source analysis is recorded separately in
`docs/ux/studio-refresh/rea-workspace-summary.json` and is not runtime proof.

## Stable tablet canvas — November 3, 2026

Prism Layers now starts closed below1100px of measured editor width and overlays
rather than resizing the artboard on those layouts. Explicit panel choices
survive subsequent measurement. Desktop reserved-panel layout remains available.
Native app window dimensions, orientation, manifests and engine contracts did
not change.

Verified locally:29 workspace tests (including closed/open artboard geometry),
all package typechecks, UI import boundary and production build. Four actual
Craft Anything cases at768/1024/390/1440 show real shape creation,50% opacity,
Layers open/close, unchanged overlay artboard geometry and desktop restoration.
Full-size screenshots and captured DOM geometry were inspected independently.
The response-size limit required supported evidence pagination; all recorded
steps were successful. Proof is indexed in RESPONSIVE.md. Native runtime,
physical input and full browser/OS matrix remain unverified.

## Prism existing-shape fill editing — 2026-11-04

Studio's existing Fill layer action now works for selected rectangles and ellipses,
not only raster layers. `setShapeFill` and the typed `PrismDocument.setShapeFill`
API change only RGBA fill in the original Rust document, preserving layer ID,
geometry, name, opacity, visibility and stack order. The operation records one
Rust history entry; it adds no parallel document/history store or upstream code.
The existing horizontally scrolling adaptive palette reserves space for this
action for both shape and raster selections. Selecting a swatch alone still only
chooses the color; Fill layer commits it.

Local checks: 40 dock/workspace tests, Prism/Studio/example/preview TypeScript,
canonical UI boundary/module checks and preview production bundle passed.
Rust toolchain is unavailable locally; new Rust tests and typed nf-cli tests
are committed and included in the existing Studio CI workflow, not claimed as
executed locally. The Rust cases cover rectangles/ellipses, rendered pixels,
transparent fill, invalid channels/targets, atomic failure preserving redo,
one-step undo/redo and snapshot restoration. No native/device or interactive
browser validation of this new action has been performed.

## Prism bounded shape geometry editing — 2026-11-04

The original Prism engine now exposes `transformShape`: relative translation and
positive axis-aligned scaling anchored at the top-left, committed as one Rust
history entry. It retains shape kind, fill, layer identity and all layer metadata.
Computed non-finite or non-positive bounds, raster targets and malformed inputs
are rejected before document/history mutation. Off-canvas shapes remain valid
and are clipped by the existing renderer.

Studio uses the canonical Menu in its existing context bar for selected shapes:
1px/10px directional moves and 10% enlarge/shrink. The menu resets on selection change or host busy state, while old callbacks
reject stale state. Its trigger stays mounted across its own edits to preserve
keyboard focus.
No parallel geometry state, new package, copied upstream source, or renderer
migration was introduced. Arbitrary numeric bounds, pointer resize handles,
rotation, skew, path editing and full ArtCraft parity remain outside this slice.

Local verification: 42 dock/workspace Node tests and affected TypeScript checks
passed. Rust and typed-host tests plus the browser bridge scenario are in the
existing CI workflow; local Rust execution remains unavailable. Browser module
and build checks are separate from interactive browser or native/device QA,
which has not been performed for the new transform menu.

## Prism direct artboard selection and shape movement — 2026-11-04

Added touch/pointer responder wiring to the existing Prism artboard. Taps select
by topmost rectangle/ellipse pixel coverage and raster alpha; hidden/transparent
layers are skipped. Dragging a shape shows a dashed bounds preview, then issues
one existing `transformShape` command on release. The composite remains the Rust
engine result. Layer controls and the Transform menu remain the accessible
alternatives; this does not add pointer resize/rotation handles.

The gesture model handles delayed or failed measurements, selection changes,
document/viewport changes, multi-touch cancellation, Escape, responder termination,
unmount and repeated releases. Release remeasures the artboard and cancels if
its origin or dimensions moved, including ancestor scrolling. Web coordinates
account for page scrolling; captured scroll/resize/blur also cancel. A tap or
cancel records no history. Raster selections cannot dispatch shape transforms.

Local checks: 53 dock/workspace tests and Studio/example/preview typechecks pass.
The production bundle and canonical UI boundary/module checks pass. The existing
real-engine bridge test now drives the same gesture planner into Rust, checking
pixels, one-step undo/redo and save/restore in CI.

Interactive Chromium validation was attempted against an isolated component
fixture but blocked before browser launch by `socket() failed: Operation not
permitted`, including after tool escalation. No pointer/touch interaction success
or native device evidence is claimed. The gesture wiring is statically reviewed
and unit tested; physical input, browser interaction and assistive-technology QA
remain release gates.

## SDK58/latest host migration candidate — 2026-11-04

The canonical shared Image, root Gesture Handler adapter, latest npm host pins,
Nitro v1 session integration and Skia web asset work are preserved in this draft.
The provisional SDK54 additions were replaced before publication.

**Blocked:** Metro0.87.2 and latest Expo CLI's file-map fork have incompatible
runtime-root APIs. (The release-age rejection noted earlier no longer applies:
the workspace sets `minimumReleaseAge: 0` as of 2026-11-04.)
Do not treat this as native-ready, a clean-install pass, or complete parity.
See docs/native/SDK58_METRO_UPGRADE.md for exact versions, reproduction,
source checks, native autolinking evidence and remaining release gates.

## Recovered alpha.3 Studio integration (2026-11-05)

- NYC-Tron release pins and SHA256SUMS verified against all four consumed tarballs.
- Studio suite: 148 tests passed; Studio and preview TypeScript passed; example TypeScript passed.
- Preview production build passed; UI boundary check passed.
- NativePopover and grouped Select are bound in both hosts; Layers uses its original 280pt width.
- No device, screen-reader, foldable, or native rebuild acceptance was performed for this change.

## Audio API migration draft — November 4, 2026

Audio lab and audio-ui migrate native capture and shared playback to
react-native-audio-api 1.0.0; browser capture directly uses MediaRecorder
because upstream has no browser recorder. Seven dependency-free audio graph /
PCM contracts pass locally. Full install correctly blocked by the 24-hour
package-age policy until 18:01:08.810 UTC; lockfile, TypeScript, Metro, native
builds and hardware capture/playback are pending. No Cadence project attachment,
multitrack DAW, Meta runtime or production readiness is asserted.
See packages/audio-ui/README.md for API/skill roster and exact boundaries.

## Recovered alpha.3 audio integration (2026-11-05)

- All six NYC-Tron dependency references use v0.1.0-alpha.3; the UI and platform-services tarballs were downloaded and checked against release SHA256SUMS.
- Audio UI: 68 tests pass, including native policy-action ordering and capture/preview ownership. The eight dependency-free graph tests pass.
- Audio UI and audio-lab TypeScript pass; the audio-lab web export passes.
- Expo autolinking resolves NYCTronPlatformServices alpha.3 on Apple and Android. Android uses the package's Expo Modules v2 path; an empty legacy modules array is expected.
- Preview intent now lives in NYC-Tron's session store. Audition stops on interruptions, output loss and resets and requires a new Play press. Recorders keep their own capture lifecycle.
- No native rebuild, microphone/device, routing or interruption acceptance was run for this follow-up.


## Tally atomic range edits — November 5, 2026

- Added `setRange`, `fillRange`, grouped inverse journal entries, reference-token
  shifting, TypeScript methods and the `commitTallyFill` UI callback adapter.
- Local Rust workspace tests: 191 passed, including Tally's 34 tests.
- Local Tally Vitest: 24 passed, including two new live `nf-cli` range-operation
  tests and a callback routing test. Workspace TypeScript: 9/9 packages passed.
- Frozen pnpm 10.32.1 install and fresh `cargo build -p nf-cli`: passed.
- Review fix: references and range writes are bounded to the sheet
  (XFD1048576), not the u32 address domain; a range with an off-sheet endpoint
  shifts to a single `#REF!` instead of the unparseable `#REF!:A2`. After the
  fix: Rust workspace 192 passed (Tally 35), Tally Vitest 25 passed (three live
  `nf-cli` range-operation tests), workspace TypeScript 9/9.
- Same bound for every address-taking op: `setCell`, `clearCell`, `getCell`
  and `getRange` past XFD1048576 return `out_of_bounds` with no mutation or
  journal entry; formula references past the sheet evaluate to `#REF!`;
  `restore` rejects off-sheet cell keys. Rust workspace 193 passed (Tally 36),
  Tally Vitest 26 passed (four live `nf-cli` range-operation tests).
- Rust/CLI evidence only. Native JSI hosts, clipboard OS APIs, hardware and
  the unreleased NYC-Tron fill prop's installed consumer contract: NOT RUN.
- Adds no UI copy or dependency upgrade; stack remains based on Tally grid
  cluster PR #50, with the released NYC-Tron alpha.1 pin unchanged.

## Recovered alpha.3 Tally consumer (2026-11-05)

31 tests pass, including atomic paste/fill against a freshly built nf-cli. Tally TypeScript and the release URL/lockfile/SHA256 pin check pass. Includes the local #50/#54 stack.

## Recovered alpha.3 Office consumer (2026-11-05)

Pitch 17, Quill 12 and Folio 10 tests pass against a freshly built nf-cli. All three package typechecks and the release URL/lockfile/SHA256 pin check pass. Includes the local #53/#55 stack.

## 2026-11-04 advanced component bridge work

- Cadence typed gain/pan knob adapter **SOURCE IMPLEMENTED** (`@nitro-forge/cadence/instrument-adapter`). Verified on Ubuntu CI: TypeScript, Vitest + real Rust host passed [run 41902604860](https://github.com/mikevocalz/nitro-forge/actions/runs/41902604860). Native iOS/Android and desktop still NOT RUN.
- Graph routing, real crop, MIDI piano roll, Media3/AVFoundation decoder, Ink/Muse and spatial renderer **NOT IMPLEMENTED**. The roster in `ADVANCED_NATIVE_PORT_ROSTER.md` is a plan, not device proof.

## Recovered alpha.3 Mixer consumer (2026-11-05)

22 Cadence tests pass against a freshly built nf-cli. Cadence and native-cadence example typechecks pass. Root and example lockfiles and all release hashes pass the pin verifier.

## Recovered alpha.3 Timeline consumer (2026-11-05)

23 Splice tests pass against a freshly built nf-cli; Splice TypeScript passes. The consumer contract pins the alpha.3 release tarball. The unreleased second NYC-Tron timeline cluster is still deferred.

These are local source/protocol checks. No new native build or device acceptance was run. The follow-up has not been pushed or merged.

## Phase 1 combined recovery — 2026-11-05

The six alpha.3 follow-ups are combined locally on `codex/phase1-alpha3-integration`.
The combined workspace passes 245 Rust tests and 394 package tests (one existing native check skipped), all package typechecks, eight audio graph tests and two lab Metro regression checks. Studio, audio-lab and media-lab browser builds pass. Release-pin/hash and UI-boundary checks pass.

Integration fixed lab Metro watch folders so pnpm assets can be exported and preserved existing Expo/Uniwind configuration. Root `test:rust` now targets the actual Cargo workspace. Studio app configuration remains byte-identical to its baseline. No new native/device validation, remote push or PR merge is claimed.

See `docs/recovery/PHASES.md` for phases 2–6 and `docs/recovery/roster-status.tsv` for all 341 rows and 21 status columns.

## Phase 2 timeline source completion — 2026-11-05

NYC-Tron's local second timeline cluster is integrated and tested: 544 source/model/render tests, 254 full-lane Chromium checks, workspace build/types and package export/pack checks pass. Track/marker text commits are deduplicated across Enter and blur while the engine response is pending.

Forge's bound timeline callbacks pass 25 Splice tests against real Rust and TypeScript. The explicit `verify:timeline-source` command checks the actual built, unreleased component declarations while production pins stay on alpha.3. No new Rust code was added. No new release/native/device acceptance is claimed. See `docs/recovery/PHASE2.md` and the updated 341-row status table.

## Phase 3 canvas source completion — 2026-11-05

Recovered canvas/layers/selection/vector controls and the Prism engine operations are integrated locally. NYC-Tron passes 617 source tests and 323 Chromium tests, builds/types/exports and local packing. Forge passes 286 Rust tests, 408 package tests (one existing native skip), workspace types and the actual built-source canvas contract. Prism includes five new real-engine adapter scenarios. Production pins stay alpha.3; native/device acceptance and publication remain pending. See `docs/recovery/PHASE3.md` and the updated 341-row table.

## Phase 4 audio source completion — 2026-11-05

Recovered audio routing/inserts/automation/analysis and MIDI batch/channel controls are integrated locally with Cadence engine ops and a serialized mixer adapter. NYC-Tron passes 692 source tests and 414 Chromium tests, workspace build/types and export/pack checks. Forge passes 317 Rust tests and 421 package tests (one existing native skip), all workspace types and the actual built-source contract. Cadence passes 35 tests including five new real-engine adapter cases. Offline engine evidence does not establish realtime device audio, native builds or physical-device acceptance. Pins stay alpha.3. See `docs/recovery/PHASE4.md` and the updated 341-row table.

## Phase 5 workspace/color/transfer completion — 2026-11-05

Workspace/presets, contextual overflow, file transfer, color dialog and presenter session ink controls are integrated locally. NYC-Tron passes 713 source tests, 427 Chromium tests, builds/types, 351 export checks and 13 local packs. Forge passes 327 Rust tests and 446 package tests (one existing native skip), workspace types and the actual built-source consumer contract. WorkspaceSession keeps one document, formats produce real bytes and explicit delivery errors, Prism palette/new/fill history is tested, and WAV effect output is continuous. Presenter persistence/remote transport and native/device acceptance remain pending. See `docs/recovery/PHASE5.md` and the 341-row table.

## Recovery phase 6

See [PHASE6](recovery/PHASE6.md): 340 Rust / 446 Forge package tests pass, one pre-existing native check skipped. Actual linked C++ task/binary/cache and FIFO tests and generated-header compilation pass. NYC-Tron has 716 source tests, 435 full Chromium tests and an actual iOS simulator app build. Native runtime, Android decoder, complete RNW app and QNX gates remain explicitly open.

## Focused P02 recovery follow-up, 2026-11-07

`pnpm --filter @nitro-forge/ignition exec vitest run tests/recovery-ownership.test.ts tests/autosave.test.ts tests/collaboration-checkpoint.test.ts` passed 20 tests in 3 files. Seven new fault-injected cases cover Buffer ownership, recovery cancellation boundaries, aggregate cleanup errors and close-during-notification scheduling. This is focused JS/CLI evidence; native/device cancellation and platform storage acceptance remain NOT RUN.

## P10 photo catalog source checkpoint (2026-11-07)

Registered `photo` catalog metadata/version engine and typed API. Focused crate, CLI/tag/ordinal and v1 FFI checks plus source typechecks are recorded in [the source report](completion/reports/P10-registered-photo-catalog-source.md). This is not a RAW provider, develop renderer, native consumer acceptance or full P10 completion. Existing seven engine tags/ordinals are preserved and photo appends7.


## P11 immutable Motion raster source checkpoint (2026-11-07)

Motion now persists owned immutable straight-sRGB RGBA8 assets and real raster layers using the existing Prism binary upload/compositor. Focused evidence: full Motion engine suite 14 passed; registered binary FFI ownership/pixel/invalid-input case 1 passed; actual CLI caller-subview copy/shared-layer/opacity/reopen and empty/legacy describe cases 2 passed; direct source typecheck passed. Exact commands, logical storage budgets, old-shape compatibility and remaining gates are in the [raster source report](completion/reports/P11-motion-raster-source.md). No native target run, decoder/encoder, default product activation or full P11 completion is implied.

## P10 decoded develop preview source checkpoint (2026-11-07)

Photo persists version recipes and processes real bounded straight-alpha sRGB RGBA8. Thirteen Photo engine tests and ten TypeScript tests pass, including identity/color/alpha, persistence, stale authority, owned input and malformed/oversized responses. The parent independently verifies a binary FFI preview and a real Photo-to-Motion CLI pixel/history/reopen flow. Those use synthetic decoded pixels, not a RAW decoder or original-file provenance proof. See [the develop source report](completion/reports/P10-nondestructive-develop-preview-source.md). No native target, full RAW controls or P10 acceptance is inferred.

## P10 develop white balance source checkpoint (2026-11-07)

The develop recipe gains bounded `temperature_kelvin` (2000–40000 K) and `tint` (−1..1) fields that persist, undo/redo and actually change preview pixels through a declared sRGB blackbody-ratio approximation normalized at 6500 K — not ICC or camera calibration. Additive serde-defaulted fields keep legacy recipes/snapshots byte-identical; bounds and hostile-restore rejection are tested. See [the white-balance source report](completion/reports/P10-photo-white-balance-source.md). ICC profile handling, the canonical RAWDevelopPanel binding and all platform acceptance remain open.

## Shared decoder and backend test entry (2026-11-07)

The base64 decoder now rejects malformed alphabet/padding/trailing bits before allocation while retaining valid unpadded input (`6949110`); seven decoder/host tests pass. New package test scripts and the shared source runner make Photo/Motion/Design/Draft tests discoverable in workspace and existing CI runs. Local evidence: 54 scoped Rust tests, 18 source/CLI tests, four binary FFI checks and preview TypeScript pass. See [test entry report](completion/reports/backend-test-discovery.md). These results do not establish remote CI, native consumer or required-platform acceptance.

## Office and circular drafting source checkpoint (2026-11-07)

Quill now persists bounded explicit list definitions and actual DOCX numbering; Pitch evaluates explicit host click histories plus emphasis/exit effects; Draft persists circles/arcs and evaluates analytic circular snaps; Folio writes bounded PDF text-markup quadrilaterals. Quill/Pitch/Draft protect new feature snapshots from permissive old readers using local versioned containers, with unchanged framing and engine identities. Local checks pass 123 office Rust/51 office TypeScript tests and 60 backend Rust/20 source-CLI tests; preview TypeScript and the completion validator pass. See [current status](completion/STATUS.md) and linked reports for commands, contracts and remaining work. These source checks do not establish native rendering, Word/PDF viewer interoperability or full original phase/platform acceptance.

## Tally cell formats source checkpoint (2026-11-07)

Tally persists per-cell format metadata (`number_format`, `bold`, `italic`,
`fill`, `border`) in a `formats` map on each sheet, exposed through new
`setFormat`/`clearFormat` ops (range or explicit cells, patch semantics with
`null` clearing attributes), `getCell`/`getRange` `format` members and
`describe`. Formats are independent of cell contents, never affect formula
evaluation, and are protection-checked writes with atomic apply, single
journal entries and NFD1-unchanged snapshots. Nonempty formats trigger the
existing `{kind:"tally",schema:1}` wrapper; `restore` re-validates keys,
bounds and attribute shapes atomically. Local checks: `cargo test -p
tally-engine` 64 passed (9 new), `pnpm --filter @nitro-forge/tally` typecheck
and 41 Vitest tests passed including two new live `nf-cli` format tests.
Number-format rendering is host-side; no locale-aware display, XLSX or
native/device acceptance is claimed.

## P11 Motion blend modes and clipping source checkpoint (2026-11-07)

Motion layers now carry an optional W3C `blend` mode (all 13 Prism modes, `null`/`"normal"` clears) and a `clipped` flag that masks a layer to the alpha of the nearest unclipped sibling below it in the same composition, via `setLayerBlend`/`setLayerClipped` ops mapped onto the ephemeral Prism scene. Snapshot schema stays 2: both fields are additive serde defaults skipped when unset, so pre-B1 snapshots restore unchanged. Local evidence: 30 Motion engine tests pass (5 new covering every blend mode's pixels, clip runs, comp-layer/raster composition, undo/redo and hostile restore), 4 Motion CLI/TypeScript tests pass including a new nf-cli blend/clip case, and package typecheck passes. No native target run, mattes/effects/expressions or full P11 completion is implied.

## P11 Motion track mattes source checkpoint (2026-11-07)

Motion layers now carry an optional `matte` (`source_layer`, `mode` alpha/alpha-inverted/luma/luma-inverted, `feather` 0..=64, `enabled`) set via `setLayerMatte`. The matte source's subtree renders standalone into an ephemeral Prism scene, flattens to RGBA, derives an alpha or premultiplied-Rec.601-luma mask, and uploads it to the target's Prism layer mask so it multiplies the target's own alpha before blend/clip compositing. Matte chains are same-composition, acyclic and bounded at 8 edges; structural ops that would strand a reference reject atomically and `duplicateComposition` remaps sources. Snapshot schema stays 2 via additive serde defaults. Local evidence: 37 Motion engine tests pass (7 new covering all four modes' pixels, feather bounds, cycle/transitive/depth rejection, strand prevention across layer ops, nested-comp and comp-source mattes, blend ordering, undo/redo and hostile restore), 5 Motion CLI/TypeScript tests pass including a new nf-cli matte case, package typecheck passes, and `nf-cli` builds. Painted masks, matte-source hiding and full P11 completion are not implied.

## P16 design constraints C2 source checkpoint (2026-11-07)

Design `Node.constraints` now stores the rest of the NYC-Tron `DesignConstraints` contract: optional per-axis extent bounds (`min_width`/`max_width`/`min_height`/`max_height`, finite, 0..=1e7, min<=max when both present), the `aspect_locked` flag (no stored ratio; a solver derives it at enforcement time), and `relative_to` targets widened from parent-only to the parent frame or a sibling sharing that parent. `scale` anchors, self/unknown/cross-tree targets and invalid bounds reject with distinct reasons on mutation and hostile restore; whole-document validation also rejects `removeNode` of a referenced target, flow conversion or reparenting that would strand constraints. Snapshot schema stays 2: the fields are additive serde defaults inside `deny_unknown_fields` `NodeConstraints`, so absent fields serialize byte-identically and old readers fail closed on the new keys. Constraints remain storage-only: `readConstraints` still reports `solving:"storage-only"` and `enforced:false`, and `evaluateLayout`/`renderFrame` ignore them. Local evidence: `cargo test -p design-engine` 31 passed (1 new C2 test), `pnpm --filter @nitro-forge/design test` 9 passed (1 new nf-cli contract test, 1 updated C1 test), package typecheck clean, `cargo build -p nf-cli` clean. No solver, native target run or full P16 completion is implied.

## P11 Motion bounded CPU effect stack source checkpoint (2026-11-07)

Motion layers now carry an optional `effects` stack (at most 16 typed entries: `invert`, `grayscale`, `brightness`, `contrast`, `gaussian-blur`, `fill`) set via the `setLayerEffects` full-replace op. Effected layers rasterize their content subtree plus evaluated transform into an ephemeral canvas-sized Prism scene, run the CPU passes in stack order on the flattened straight RGBA, and upload the result as an identity-transform raster layer, so effects apply after the layer's own render/transform and before opacity, blend, clipping and matte compositing; matte sources' own effects feed their derived masks. Snapshot schema stays 2 via additive serde defaults with a strict hand-rolled effect deserializer (unknown kinds/fields reject). Local evidence: 50 Motion engine tests pass (11 new covering per-effect pixels, stack ordering, transform/opacity/blend/clip/matte interaction, nested-comp effects, the shared raster/effected-layer canvas-storage budget, undo/redo and hostile restore), 6 Motion CLI/TypeScript tests pass including a new nf-cli effects case, package typecheck passes, and `nf-cli` builds. Effected layers share the raster canvas-storage budget (a layer with asset_id or a non-empty effect stack counts once toward the 16-layer/16 MiB caps). No native target run, GPU path, expressions/particles/media or full P11 completion is implied.

## P14 Pitch morph transitions source checkpoint (2026-11-07)

Pitch slide transitions now admit `kind:"morph"` and objects carry an optional `morph_name` tag set via `setMorphName`/`clearMorphName`. Names are non-blank, <=128 UTF-8 bytes and unique per slide (the same name on different slides is the intended cross-slide pairing); equal re-tags and absent clears are eventless no-ops, tags die with their objects, and hostile restores reject duplicate or out-of-bound names. DATA ONLY: the engine stores the morph kind and the tags for the host to match objects across adjacent slides; it performs no morph evaluation, interpolation or rendering. Snapshots carrying morph data use the new `{kind:"pitch",schema:5}` wrapper because `morph_name` is an additive field old readers would silently drop (the `"morph"` kind variant already fails closed); readers accept schema:2 through schema:5. Local evidence: `cargo test -p pitch-engine` 71 passed (3 new morph tests), `pnpm --filter @nitro-forge/pitch test` 36 passed across 8 files (2 new nf-cli morph cases), package typecheck clean, `cargo build -p nf-cli` clean. No native target run, morph pixel evaluation or full P14 completion is implied.

## Tally conditional formats source checkpoint (2026-11-07)

Tally persists workbook-level conditional-format rules (`id`, bound sheet id,
canonical `"A1"`/`"A1:B2"` range, COUNTIF-style `criteria`, bounded `format`
payload of `bold`/`italic`/`underline`/`color`/`fill`) via new
`setConditionalFormat`/`clearConditionalFormat`/`getConditionalFormats`/
`evaluateConditionalFormats` ops. Criteria reuse the `COUNTIF`/`SUMIF`
matcher (`formula::conditional`, now exposed as `CriteriaMatcher` +
`Evaluator::match_value`), so comparisons, wildcards and empty-text
semantics match the aggregate functions exactly; evaluation runs against
computed cell values through the normal evaluator, so matches track edits,
undo and reopen. Rules may overlap (unlike validation); an identical
resubmission is eventless, mutations journal whole-document undo entries,
`removeSheet` cascade-drops rules into the undo entry with `readd_ok`
re-admission, and bound-sheet protection guards apply. `evaluateConditionalFormats`
reports `{addr, computed, matches}` per cell — matches only, no style
application, merge or rendering (host-side). Rules-carrying snapshots emit
`{kind:"tally",schema:3}`; after the data-validation slice merged, `restore`
accepts schemas 1–3 and emits 1/2/3 by feature (bare workbook / validations
only / conditional rules present, possibly alongside validations) — the
final three-tier contract is documented in `docs/ENGINE_OPS.md`. Deferred:
NYC-Tron `kind` variants (formula,
color-scale, icon-set, data-bar), `styleId`, `enabled`/`stopIfTrue`,
whole-row/column ranges, pixel output. Local evidence (post-merge with the
data-validation slice): `cargo test -p tally-engine` 94 passed including a
new emit+restore schema-matrix test covering bare/schema:2/schema:3/both,
`pnpm --filter @nitro-forge/tally` 51 Vitest passed across 13 files (2 new
live `nf-cli` cases), package typecheck clean, `cargo build -p nf-cli`
clean. Pre-merge this slice alone reported 82 engine tests and 47 Vitest.
No native target run, XLSX or full P13 completion is implied.

Review follow-up on the same slice: `Evaluator::match_value` now charges one
unit of the shared 1,000,000-step conditional allowance per candidate
rule-cell evaluation before criteria-type dispatch, so
`evaluateConditionalFormats` cannot bypass the work bound via numeric
comparisons, empty-criteria matches or type mismatches — a rule×cell product
over the allowance fails the whole op with `#NUM!` (validation error) rather
than emitting giant or partial output (no truncation flag; the bound is
fail-closed). `ConditionalRule` gained `deny_unknown_fields` so deferred
NYC-Tron fields (`enabled`, `stopIfTrue`, `styleId`, `kind`) reject instead
of being silently dropped. `clearConditionalFormat {id, sheet}` now rejects
the mixed selectors like `clearValidation` (`sheet:null` stays allowed).
Restore normalizes each rule's `format` with the op-path `false`-boolean
collapse before validation, so crafted `{"bold":false}` payloads cannot
store non-canonical rules, and restore now fails closed when nonempty
`conditional_formats` arrives under schema<3 or nonempty `validations`
under schema<2 (including bare workbooks) — emitters always stamp the
highest table present, so honest payloads are unaffected. Local evidence:
`cargo test -p tally-engine` 98 passed (4 new), `pnpm --filter
@nitro-forge/tally` 51 Vitest passed (unchanged — no TS surface change),
typecheck clean, `cargo build -p nf-cli` clean.

## Tally data validation source checkpoint (2026-11-07)

Tally persists workbook-level data-validation rules (`{id, sheet, range,
criteria}`) through new `setValidation`/`clearValidation` ops and the
read-only `validateCell` op. Criteria are bounded to what the engine honestly
evaluates: `number` (optional inclusive min/max, `integer` flag), `list`
(1–512 exact case-sensitive text-form entries, matching the NYC-Tron
ValidationDropdown caps) and `text` (optional inclusive length bounds).
Date bounds, custom formulas, whole-row/column ranges and the dropdown's
allowOther/allowBlank commit policy are deferred and documented in
`docs/ENGINE_OPS.md`. Rules cannot overlap per sheet; same sheet+range
replaces criteria in place keeping the id. Sheet removal cascade-drops rules
into the same undo entry and undo re-admits them only while they satisfy the
restore invariants. Snapshots carrying rules emit `{kind:"tally",schema:2}`
because `Workbook` does not deny unknown fields and schema:1 readers would
silently drop them; `restore` accepts schema 1 and 2 and re-validates rule
count, id uniqueness, bound sheets, canonical in-bounds ranges, criteria
invariants and per-sheet overlap atomically. Mutations are protection-checked
against the bound sheet like name ops. Local evidence: `cargo test -p
tally-engine` 85 passed (9 new), `pnpm --filter @nitro-forge/tally` typecheck
clean and 49 Vitest tests passed including four new live `nf-cli`
data-validation tests, `cargo build -p nf-cli` clean. No UI wiring, XLSX or
native/device acceptance is claimed.

Review follow-up on the same slice: `validateCell`'s `text` criteria now
rejects error values before consulting the text form (previously `=1/0`
could satisfy a length rule via the literal `"#DIV/0!"` text), and the
blank check narrowed to "no stored raw" so a formula computing to `Empty`
no longer passes every rule (both match the already-documented semantics).
`clearValidation {id, sheet}` now rejects the mixed selectors, and
`validateCell {addr:null, cell}` treats explicit null as absent like
`sheet:null`. `describe` vs op-result `sheet` key semantics (durable id vs
current name + `sheet_id`) are documented in `docs/ENGINE_OPS.md`. Local
evidence: `cargo test -p tally-engine` 87 passed (2 new), `pnpm --filter
@nitro-forge/tally test` 49 passed, typecheck clean, `cargo build -p
nf-cli` clean. After the conditional-formats slice merged on top, snapshots
keep the three-tier contract: schema:2 for validations-only documents,
schema:3 whenever `conditional_formats` is nonempty (which may also carry
validations), schema:1 otherwise; `restore` accepts 1–3 and both rule tables
are serde-optional so each restores with the other's table empty.

## P14 Pitch deck themes source checkpoint (2026-11-07)

Pitch decks now store named deck themes plus a deck→theme binding
(P14 slice 9, the NYC-Tron `ThemeAndTemplateGallery` `kind:"theme"`
contract): `addTheme`/`renameTheme`/`setThemeColor`/`setThemeFont`/
`removeTheme`/`setDeckTheme` mutate and `deckTheme` reads. Color slots are
the OOXML theme color roles (`dk1|lt1|dk2|lt2|accent1..accent6|hlink|
fol_hlink`), font slots the OOXML major/minor latin typefaces
(`major_latin|minor_latin`); slots are sparse and names/font families are
bounded non-blank ≤128 UTF-8 bytes, ≤32 themes per deck, ids share the
document `next_id` space. DATA ONLY: the engine stores and validates the
slot maps and the binding — it does not resolve theme colors/fonts onto
objects, masters, layouts or placeholders, and placeholder `inherit_theme`
stays an independent flag. NYC-Tron `kind:"template"` presets (bundled
theme + master/layout set) are deferred: masters/layouts/placeholders are
separate validated collections and the apply/bind slice does not exist
yet. Removing the bound theme clears `deck_theme`; equal slot writes and
rebinds are eventless no-ops; hostile restores reject missing bindings,
duplicate ids, blank/oversize names and fonts, unknown slots (typed enum
keys fail serde before validation) and over-cap collections atomically.
Snapshots carrying themes or a binding use the new
`{kind:"pitch",schema:6}` wrapper because `themes`/`deck_theme` are
additive fields old readers would silently drop; readers accept schema:2
through schema:6. Local evidence: `cargo test -p pitch-engine` 77 passed
(6 new theme tests; the legacy-reader reject probe moved to schema:7),
`pnpm --filter @nitro-forge/pitch test` 39 passed across 9 files (3 new
nf-cli theme cases), package typecheck clean, `cargo build -p nf-cli`
clean. No theme application to objects, template bundles, UI wiring or
native target run is claimed.

## Tally sort/filter source checkpoint (2026-11-07)

Tally gains `sortRange` plus the durable row-filter table behind
`setFilter`/`clearFilter`/`getFilters`/`evaluateFilters`. Sort permutes
whole rows inside a rectangle by computed key-cell values under a
documented total order (class rank empty < number < text < boolean <
error, fixed in both directions; errors always last; text uses the same
lowercase-then-byte collation as formula comparisons). Formulas move
verbatim with no reference rewriting — a deliberate, documented subset
that differs from Excel. `has_header` pins the first row; the sort is
stable, atomic, protection-guarded and undoable via the shared
`commit_cells` path, and charges the shared 1,000,000-step conditional
allowance per key-cell evaluation and per key-level comparison. Filters
hide, never delete: visibility is derived live from rules plus computed
values (no stored hidden flag), `column`-less rules AND across the row's
range slice, overlapping rules all must pass, and `evaluateFilters`
reports per-row `visible`/`matched`/`failed` (or single-rule `matched`)
with a 65,536 cell-test report cap. Sheet removal cascade-drops filter
rules into the same undo entry with `readd_ok` re-admission. Snapshots
carrying filters emit `{kind:"tally",schema:4}`; `restore` accepts 1–4
and fails closed on filters under lower or bare schemas. Local evidence:
`cargo test -p tally-engine` 109 passed (11 new across sort_ops/filter_ops
plus schema-matrix and protection coverage), `pnpm --filter
@nitro-forge/tally` typecheck clean and 54 Vitest passed across 14 files
(3 new live `nf-cli` sort-filter tests), `cargo build -p nf-cli` clean.
No UI wiring, XLSX or native/device acceptance is claimed.

Review fixes on the same slice (2026-11-07, second pass): `sortRange` now
commits through `commit_cells_on_sheet` so the permutation, prior-value
lookup and undo entry all target the resolved `sheet` — sorting a
non-active sheet no longer writes into the active one, and the protection
guard and mutation agree on the same sheet (regression tests cover
active+target permutations, protected-active/unprotected-target, and the
inverse). Sort work is charged *during* comparison through the evaluator
(one unit per key examined; the comparator short-circuits on exhaustion
and the op rejects before mutation), duplicate resolved key columns are
deduplicated before evaluation, and text keys are lowercased once at key
evaluation instead of per comparison — the corrected bound (~229k units
worst case under the 16,384-cell cap) is documented in the module docs
and ENGINE_OPS. `evaluateFilters`' 65,536 cap is documented as the
worst-case product (whole-row rules are charged full width despite
evaluation short-circuit). The stale "schema:3 is highest" test comment
and the TS `SortKey` type (now a discriminated union rejecting `{}` and
`{column,offset}`) were corrected. Local evidence: `cargo test
-p tally-engine` 113 passed (4 new sort regression tests), `pnpm
--filter @nitro-forge/tally` typecheck clean and 54 Vitest passed,
`cargo build -p nf-cli` clean.

## P14 Pitch charts/tables in slides source checkpoint (2026-11-07)

Pitch slides now carry chart and table objects with EMBEDDED bounded data
(P14 slice 10, the NYC-Tron `ChartAndTableEditor` contract): `addChart`/
`updateChart` and `addTable`/`updateTable` mutate, `describe` exposes the
stored specs, and `moveObject`/`resizeObject`/`rotateObject`/`removeObject`
treat them like media objects (real bounds, cascade removal, animation
targets allowed). Charts mirror `SheetChartSpec`/`SheetChartSeries` minus
the sheet-source fields: `kind` is the `line|column|area` catalog,
`series` is inline `{id,label,points:[{x,y}]}` data with 1..=32 series,
1..=1024 points per series, <=4096 points total, unique non-blank ids
<=64 bytes, labels <=128 bytes and point coordinates finite within
±1e12; optional `title`/`x_axis_label`/`y_axis_label`/`show_legend`/
`show_data_labels` cover the text and boolean half of `ChartPresentation`.
Tables are the bounded `VirtualSpreadsheetGrid` subset: `rows` 1..=100,
`cols` 1..=26, sparse unique `{row,col,value}` cells <=1024 with string
(<=128 bytes)/number/boolean values; per-cell `TableCellLayout` (spans,
alignment, borders, fills), formulas, chart number formats and
per-series colors are deferred. DATA ONLY: the engine stores and
validates the embedded data — it never renders charts or tables; hosts
draw from `describe` output. `updateChart`/`updateTable` are partial
patches mirroring `updateMedia` (series/cells replace wholesale,
explicit null clears optional fields, merged spec re-validated);
equal/empty patches are eventless no-ops, hostile restores reject
kind/spec mismatches, missing specs, duplicate cells, out-of-grid cells,
non-positive bounds and over-bound collections atomically, and `new`
drops the objects with the deck. Snapshots carrying chart/table objects
use the new `{kind:"pitch",schema:7}` wrapper: the `chart`/`table` Obj
fields are additive like `media`/`morph_name`, so they take schema:7
even though the new ObjKind variants also fail closed as unknown
variants; readers accept schema:2 through schema:7 and the legacy-reader
reject probe moved to schema:8. Local evidence: `cargo test -p
pitch-engine` 85 passed (8 new data tests), `pnpm --filter
@nitro-forge/pitch test` 42 passed across 10 files (3 new nf-cli
chart/table cases), package typecheck clean, `cargo build -p nf-cli`
clean. No chart/table rendering, NYC-Tron slide-model kind extension,
formula evaluation or native target run is claimed.

## P14 Pitch slideScene source checkpoint (2026-11-07)

Pitch slides now expose `slideScene`, the per-slide STRUCTURED scene
read (P14 slice 12): `{slide,t_s?,click_times?}` returns the slide
chrome (id, deck index, background, deck size, layout, layout binding,
notes, ink count, transition, timing), the complete bottom-to-top
object inventory with stored geometry and every per-kind payload
(`text`/`fill`/`stroke`/`src`, connector spec plus the same `resolved`
polyline `describe` emits, `media`/`chart`/`table` specs, `morph_name`),
the verbatim `animations` program, and, only when `t_s` is supplied,
per-object `frame` entries identical to `slideAt` output plus the
resolved `schedule`. The frame path reuses the `slideAt` evaluator
verbatim, so geometry, opacity and pending-click semantics cannot
drift; `click_times` without `t_s` rejects, as do unknown slide ids,
non-finite `t_s` and unordered click histories. The op is read-only: no
journal entry, no `document:changed`, no state change, and no snapshot
schema bump (read ops never touch durable state). HONESTY BOUNDARY:
structured description only, the engine has no rasterizer and returns
no pixels or thumbnail bitmap; hosts render filmstrip thumbnails and
slide canvases from this data (the pinned NYC-Tron
`SlideSummary`/`SlideObject` filmstrip contract is a projection of
these fields). A separate `slideThumbnail` op was considered and
rejected: it would duplicate this payload, and hosts that need only a
summary can project the fields they need. Deferred: pixel thumbnails
(host-side rendering, e.g. via the existing Prism `flatten` path),
ink stroke payloads inside the scene (`ink_count` reports presence;
full strokes stay on `slideInk`/`describe`). Local evidence: `cargo
test -p pitch-engine` 88 passed (3 new slideScene tests), `pnpm
--filter @nitro-forge/pitch test` 45 passed across 11 files (3 new
nf-cli scene cases), package typecheck clean, `cargo build -p nf-cli`
clean. No pixel rendering, native target run or full P14 completion is
claimed.

## P14 Pitch masters/layouts apply-bind source checkpoint (2026-11-08)

Pitch masters/layouts/placeholders gain the apply/bind slice on top of
the slice-8a storage model. The inheritance chain is slide → layout →
master → deck theme: `Slide.layout_id` binds a slide to a `SlideLayout`,
which back-references its `SlideMaster` via `master_id`, and
`deck_theme` binds the deck to a `DeckTheme`. "Apply" is DERIVED
resolution, never materialization — masters carry no object payloads, so
there is nothing to copy onto slides. Two bindings are stored:
`Slide.layout_id` (existing) and the new `Obj.placeholder_id`, the
object→placeholder content tag written only by `setObjectPlaceholder`
(`placeholder:null`/omitted clears). A tag must resolve on the slide's
CURRENT bound layout — placeholder ids are deck-unique, so a tag can
never resolve on another layout — and connector objects reject (no
geometry/content payload). Cascades mirror the existing binding rules:
`setSlideLayout` to a different layout or null, `removePlaceholder`,
`removeLayout` and the `removeMaster` cascade all clear the affected
tags without touching slide object content; equal re-tags and clears on
untagged objects are eventless no-ops with one undo entry per mutation.
The new read-only `slideLayout {slide}` resolves the chain into
effective chrome: bound layout/master/theme (null when unbound), the
EFFECTIVE background (`slide.background ?? master.background`), and each
layout placeholder extended with `objects` — the z-ordered ids of the
objects bound to it. `inherit_theme` placeholders resolve against the
reported deck theme; the engine maps no theme slots onto object styles
(hosts own slot→style application) and there are no object-level theme
references. `describe`/`slideScene` expose `placeholder_id` on objects
verbatim. Restore/ops validation rejects tags without a slide layout
binding, tags outside the bound layout and unknown placeholder ids
atomically. Snapshots carrying any `placeholder_id` use the new
`{kind:"pitch",schema:8}` wrapper (additive Obj field a schema:≤7 reader
would silently drop); readers accept schema:2 through schema:8 and the
legacy-reader reject probes moved to schema:9. Deferred honestly:
NYC-Tron layout `parentId` inheritance, materializing placeholder
objects onto slides (no stored master content exists to copy),
object-level theme references, per-placeholder kind↔object-kind
compatibility rules (any non-connector object may tag any placeholder
kind), theme `kind:"template"` bundles, and all pixel rendering (hosts
project `slideLayout`/`slideScene` through the existing Prism path).
Local evidence: `cargo test -p pitch-engine` 93 passed (5 new
apply/bind tests covering resolution, cascades, atomic validation,
connector rejection and hostile restore), `pnpm install
--prefer-offline` clean, `pnpm --filter @nitro-forge/pitch test` 47
passed across 12 files (2 new nf-cli apply-bind cases), package
typecheck clean, `cargo build -p nf-cli` clean. No native/device
acceptance, UI wiring or full P14 completion is claimed.

## P16 design components & instances slice D checkpoint (2026-11-07)

Design gains the NYC-Tron L-01/L-05 component model as a materialized-instance slice. `Kind` adds `component` (frame-like definition node owning the template subtree, optional flow layout, named variant bundles) and `instance` (leaf storing `instance:{component,variant?,overrides?}` with no stored children/layout and fixed sizing only). Overrides are a bounded `{node,path,value}` set — `name|fill|x|y|width|height|visible|locked|text` — targeting the component root id (expanded instance root) or descendant template ids, with path↔value kind checks, per-axis geometry bounds, unique `(node,path)` pairs, and whole-document validation on mutation and hostile restore. The component-reference graph must be acyclic (Kahn check), which bounds expansion independently of the read caps.

Expansion is deterministic and read-only: `evaluateLayout`/`renderFrame`/`describeComponents` run `variables::effective` then clone each instance's component subtree under synthetic ids `>= 2^53-1` in stored DFS order, wire the instance as materialized root (component root's children/layout, instance's own box fields), apply variant properties then instance overrides (instance wins), and recurse into nested instances. Caps: depth 8, 16384 clones per read; breaches fail reads honestly while edits continue, and `describeComponents` surfaces the reason as `unavailable_reason`. Snapshots stay schema:2 — new kinds/fields fail old readers closed via serde, presence triggers the same wrapper, no schema:3. `detachInstance` is the only persistence path for an expansion. New ops: `createComponent`, `updateComponent`, `createInstance`, `updateInstance`, `detachInstance`, `describeComponents`; frames and components both parent children. Deferred: group/layer kinds, multi-axis variants, instance hug/fill, component-root sizing propagation, UI wiring pending the NYC-Tron `forge/design` release.

Local evidence: `cargo test -p design-engine` 36 passed (5 new component tests covering expansion determinism, overrides, variants, detach, cascade rules, cycle/depth/node bounds, hostile restore, undo/redo), `pnpm --filter @nitro-forge/design` typecheck clean and 11 Vitest passed across 8 files (1 new nf-cli live test, 1 new payload-contract test), `cargo build -p nf-cli` clean. No native/device acceptance, UI wiring or full P16 completion is implied.

## P16 design components review-fix checkpoint (2026-11-07)

Independent-review fixes on the slice-D component model. Expansion now reads template ids/children/clone sources from the pre-expansion node map, so in-place expansion of instances stored inside component subtrees no longer leaks synthetic children into a later instance's template walk (previously orphan clones could fail `evaluateLayout` on fill/hug sizing and waste the node budget). Cloned `component` nodes get their variant override targets retargeted at expansion clones, and `detachInstance` re-identifies those targets through its id map — detaching an instance whose template embeds a component bearing variants previously failed validation. `setAxisSizing` rejects hug/fill on instances and `validate` rejects non-fixed instance sizing on hostile restore, matching the documented fixed-only contract. The component acyclicity check gains ancestor→descendant containment edges, so component-in-component nesting with a back reference rejects at validation instead of only failing reads at the depth cap. New bounds: 64 variants per component, 256 overrides per instance spec or variant bundle. `EvaluatedBox.id` documents synthetic `>= 2^53-1` ids as read-only handles; `detachInstance` documents whole-document (bounded) expansion.

Local evidence: `cargo test -p design-engine` 41 passed (5 new tests: pristine-template nested expansion, detach variant retarget, instance fixed sizing mutation+restore, containment-cycle validation, override/variant budgets), `pnpm --filter @nitro-forge/design` typecheck clean and 11 Vitest passed across 8 files, `cargo build -p nf-cli` clean. No native/device acceptance or full P16 completion is implied.

## Tally charts/sparklines persistence source checkpoint (2026-11-07)

Tally gains durable chart objects and sparkline specs (P13 slice 7), lifting
the `insertChart`/`setSparkline` entries from `TALLY_DEFERRED_OPS` (the
`setSheetView` deferral remains). Charts are workbook-scoped
`ChartSpec = {id, sheet, kind, title?, range, series?, colors?}` objects
bound to one sheet by durable id — bounded `line|column|bar|area|pie`
kind, nonempty ≤512-byte title, canonical `"A1"`/`"A1:B2"` data anchor under
the shared 16,384-cell cap, ≤32 `{name?,range?}` series overrides and ≤16
deduped `#RRGGBB` colors, at most 256 per workbook. Ops: `insertChart`,
`updateChart` (partial patch — `null` clears optionals, equal patch
eventless, `sheet` alongside `id` and unknown patch keys reject),
`removeChart`, read-only `listCharts`. Sparklines are workbook-scoped
`SparklineSpec = {id, sheet, target, data, kind}` entries — canonical
target anchor (`cell` or `range`, exactly one) plus canonical data range,
bounded `line|column|bar|winloss` kind, at most 256 per workbook. Ops:
`setSparkline` (identical sheet+target+data+kind eventless, same target
with a different spec replaces in place keeping the id), `clearSparkline`
(`{id}` xor `{sheet?,cell|range}`, mixed selectors reject), read-only
`listSparklines`. Both tables are STORAGE ONLY: the engine never evaluates
series/data ranges, computes geometry or renders — hosts read cells and
draw (honest boundary; no chart evaluation is claimed). Mutations record
one whole-document undo entry each, emit `document:changed` once, and
`removeSheet` cascade-drops bound charts/sparklines into the same undo
entry with `readd_ok` re-admission; `duplicateSheet`/`moveSheet` do not
copy or retarget them. Bound-sheet protection guards apply like the other
rule tables. Snapshots carrying either table emit
`{kind:"tally",schema:5}` — the bump is required because `Workbook` does
not deny unknown fields and schema:4 readers would silently drop the new
top-level tables (same reasoning as filters' schema:4); `restore` accepts
schemas 1–5, fails closed on charts/sparklines under lower or bare
schemas, and re-validates count/id uniqueness, bound sheets,
re-canonicalized in-cap ranges (series ranges included), bounded
fields and `next_chart`/`next_sparkline` id-space repair atomically.
`TALLY_DEFERRED_OPS` drops `insertChart`/`setSparkline`; NYC-Tron
`ChartBuilder.onInsert`/`SparklineEditor` wiring is host-side. Local
evidence: `cargo test -p tally-engine` 123 passed (10 new across
chart_ops/sparkline_ops plus schema-matrix and smuggle coverage), `pnpm
--filter @nitro-forge/tally` typecheck clean and 57 Vitest passed across
15 files (3 new live `nf-cli` chart/sparkline tests), `cargo build -p
nf-cli` clean. No rendering, XLSX or native/device acceptance is claimed.

## Tally saved sheet views + setSheetView slice checkpoint (2026-11-07)

Tally gains durable workbook-persisted named sheet views (P13 slice 8),
lifting the `setSheetView` entry from `TALLY_DEFERRED_OPS`. Decision:
**workbook-persisted** — the engine's only durable view-ish state is the
filter table (row visibility derives live from computed values), so a
`SheetView = {id, sheet, name, filters}` captures the bound sheet's
current filter specs (`{range,column?,criteria}`, rule ids stripped); at
most 256 views per workbook, 64 specs per view, 128-byte names unique
case-insensitively per sheet. Scroll, zoom, frozen panes/splits and
column widths are NOT engine-owned (host view state) and `sortRange` is a
destructive mutation, so views honestly capture filters only — the
I-17 freeze/split half stays host-side and is noted in
`TALLY_DEFERRED_OPS`' successor comment. Ops: `saveSheetView` (same
sheet+name updates specs in place keeping `id`; identical capture
eventless; >64 rules rejects), `setSheetView` (`{view:id}` replaces the
bound sheet's filter rules with the captured specs under fresh ids —
projected against the shared filter cap — and records `Sheet.active_view`
durably; `{view:null,sheet?}` clears only the selection; re-applying the
active view is eventless; `sheet` alongside an id rejects),
`removeSheetView` (clears `active_view` references), read-only
`listSheetViews` (`active` flag per view). All mutations journal one
whole-document undo entry; `removeSheet` cascade-drops bound views with
`readd_ok` re-admission plus an `active_view` dangling-pointer sweep;
`duplicateSheet` does not copy views and clears `active_view` on the
copy; bound-sheet protection guards all three mutations. Snapshots
carrying views or any `active_view` emit `{kind:"tally",schema:6}` — the
bump is required because `Workbook`/`Sheet` do not deny unknown fields
and schema:5 readers would silently drop the new table and field (same
reasoning as filters' schema:4); `restore` accepts schemas 1–6, fails
closed on views/`active_view` under lower or bare schemas, and
re-validates count/id uniqueness, bound sheets, per-sheet name
uniqueness, bounded specs with re-canonicalized in-cap ranges, parseable
criteria, in-range columns, `next_view` repair and same-sheet
`active_view` references atomically. `TALLY_DEFERRED_OPS` is now empty;
NYC-Tron view-selector wiring is host-side. Local evidence: `cargo test
-p tally-engine` 129 passed (6 new across view_ops/protection plus
schema-matrix and smuggle coverage), `pnpm --filter @nitro-forge/tally`
typecheck clean and 59 Vitest passed across 16 files (1 new live `nf-cli`
sheet-views test file, 2 cases), `cargo build -p nf-cli` clean. No
freeze-pane/split persistence, rendering or native/device acceptance is
claimed.

## P12 Quill tables slice 7-A checkpoint (2026-11-07)

Quill gains block-model tables (P12 slice 7-A, insert/basic model). A table is a single `kind:"table"` block in the top-level stream carrying `Table {rows,cols,cells}` — a dense row-major grid whose `TableCell`s each hold their own paragraph `blocks` (one empty paragraph at insert). New ops: `insertTable {index,rows,cols}` (rows 1..=64, cols 1..=26, ≤256 tables/doc, ≤64 blocks/cell, ≤65536 cell blocks/doc), `deleteTable {block}`, `setCellText {block,row,col,text}` (plain paragraphs, `\n` splits, ≤8192 chars, equal content eventless), `listTables`, `describeTable`. Because the table is one block, bookmarks/comments/sections keep their existing `{block,offset}`/`{block}` anchors with zero new anchor types: `insertTable` reuses the `insertBlock` remap and `deleteTable` applies single-block-delete rules (bookmark on the table removed, comment endpoints clamp to the deletion point, section boundary merges away). Cell text is unreachable by `Pos`, so `setCellText` cannot move top-level anchors. Guards preserve the kind/payload invariant: `insertText`/`splitBlock`/`mergeBlock`/`setBlockKind`/`setBlockStyle`/`deleteRange`-from reject table blocks, list ops re-validate the merged candidate, `exportDocx` rejects documents containing tables rather than dropping cell content, and `findText`/`replaceText`/`text`/`layout`/`applyStyle`/`changeCase` treat a table block as empty (cell text not covered this slice). On restore, cell blocks are restricted to strict plain `para` paragraphs — any other kind (including `kind:"list"` without metadata and nested `kind:"table"`), `list`, `style_id`, and any stray `table` payload on a cell block are rejected (a stray payload would hide its inner blocks from `all_blocks` and bypass inline-style/`style_id` validation); the table block itself must have empty `inlines` and no `list`/`style_id`. Cell-paragraph inlines get the same highlight/font_size/font_family validation as top-level blocks; `setCellText` re-validates the document-wide cell-block budget on its staged candidate before committing. Schema: **no bump** — every snapshot tier deserializes `Block.kind` through the `BlockKind` enum, so schema≤3/legacy readers fail closed on the unknown `"table"` variant rather than silently dropping the payload. Deferred honestly: row/column insert/delete, cell merge/split, cell/table styling, nested tables, in-cell find/replace and rich cell editing, `text`/`layout` cell coverage, DOCX `w:tbl` import/export.

Local evidence: `cargo test -p quill-engine` 133 passed (18 table tests covering model, bounds, atomic rejects, undo/redo, anchor stability through insert/delete and in-cell edits, snapshot round-trip, hostile restore incl. cell style_id, cell-inline style rejection, stray cell table payloads, nonempty table-block inlines and cell-block budget enforcement on `setCellText`, old-reader fail-closed), `cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean, `pnpm --filter @nitro-forge/quill test` 32 passed across 6 files (2 new nf-cli table cases), `pnpm --filter @nitro-forge/quill typecheck` clean. No native/device acceptance or full P12 completion is implied.

## Tally comments source checkpoint (2026-11-07)

Tally gains durable workbook-level comments (slice 9): `addComment`,
`updateComment`, `removeComment`, `resolveComment`, `reopenComment` and
read-only `listComments`. A `Comment` is `{id,sheet,anchor,author?,body,
resolved}` — a workbook-unique numeric id bound to one sheet by durable
sheet id, `anchor` a canonical `"A1"`/`"A1:B2"` coordinate string (single
cell via `cell` or bounded rectangle via `range`, exactly one required,
under the shared 16,384-cell cap), `body` required non-blank ≤8192 UTF-8
bytes, `author` optional ≤128 bytes without control characters, `resolved`
a durable flag, at most 1024 comments per workbook. Single-entry, not
threaded — NYC-Tron's `CommentThread.replies` is a deferred host-side
grouping (quill comments precedent); no timestamps or mentions.
**Anchor semantics are static coordinates**: anchors name grid positions,
never content — `setCell`/ranges/fills/formats and `sortRange` never move
them, and row/column insert/delete ops are deferred so there is nothing to
remap against. `updateComment` patches author (`null` clears)/body with
eventless equal/no-field paths; resolve/reopen are eventless when already
in state; `listComments {sheet?,cell?,range?}` filters by bound sheet and
by containing/intersecting anchors on the resolved sheet (default active).
All mutations journal one whole-document undo entry; `removeSheet`
cascade-drops bound comments with `readd_ok` re-admission;
`duplicateSheet`/`moveSheet`/`renameSheet` do not copy or retarget them;
bound-sheet protection guards mutations while `listComments` stays
ungated. Snapshots carrying comments emit `{kind:"tally",schema:7}` — the
bump is required because `Workbook` does not deny unknown fields and
schema:6 readers would silently drop the table; `restore` accepts schemas
1–7, fails closed on comments under lower or bare schemas, re-canonicalizes
anchors and re-validates count/id uniqueness, bound sheets, anchor caps,
author/body bounds, strict shape (`deny_unknown_fields`) and `next_comment`
repair atomically. Local evidence: `cargo test -p tally-engine` 135 passed
(6 new across comment_ops/protection plus schema-matrix and smuggle
coverage), `pnpm --filter @nitro-forge/tally` typecheck clean and 63 Vitest
passed across 17 files (1 new live `nf-cli` comments test file, 4 cases),
`cargo build -p nf-cli` clean. No threading/replies, anchor remapping on
row/column edits, comment-pin UI wiring or native/device acceptance is
claimed.

## P12 Quill tables slice 7-B checkpoint (2026-11-07)

Quill gains row/column structural ops on existing tables (P12 slice 7-B), completing the structural half of block-model tables. New ops: `insertTableRow {block,row}` (`index`/`at` aliases; 0..=rows, `rows` appends), `deleteTableRow {block,row}`, `insertTableColumn {block,col}` (`index`/`at` aliases; 0..=cols, `cols` appends), `deleteTableColumn {block,col}`. Inserts splice `cols`/`rows` fresh cells in the `setCellText` empty shape (one empty `para` each); deletes drop the removed cells' content. A table must keep ≥1 row and ≥1 column, the 64-row/26-col caps reject inserts at the limit, out-of-range positions reject, and every op rebuilds the dense row-major grid then re-validates the staged candidate through `validate_tables` before commit — so the document-wide ≤65536 cell-block budget, per-cell ≤64 block cap, and all strict-para cell-block rules hold exactly as on restore. Because the table stays one top-level block, no `Pos`-anchored collection (bookmarks, comments, sections) can move: each op records a plain block-splice undo entry like `setCellText`, and successful ops always change state so there is no eventless case (rejects record nothing). Schema: **no bump** — `Table {rows,cols,cells}` already carries everything the new ops produce, snapshots stay byte-compatible, and the same fail-closed `BlockKind` argument covers old readers. Deferred honestly: cell merge/split, per-cell or table styling, nested tables, in-cell find/replace and rich cell editing, `text`/`layout` cell coverage, DOCX `w:tbl` import/export, consumer geometry.

Local evidence: `cargo test -p quill-engine` 141 passed (8 new table tests covering row/column insert+delete happy paths, aliases, bounds, min-dims and dimension-cap rejects, atomic snapshot-equality on rejects, cell-block budget enforcement on row insert, undo/redo, anchor stability, snapshot round-trip), `cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean, `pnpm --filter @nitro-forge/quill test` 33 passed across 6 files (1 new nf-cli row/column case), `pnpm --filter @nitro-forge/quill typecheck` clean. No native/device acceptance or full P12 completion is implied.

## P12 Quill tables slice 7-C checkpoint (2026-11-07)

Quill gains rectangular cell merge/unmerge (P12 slice 7-C). New ops: `mergeTableCells {block,from,to}` (`from`/`to` are `{row,col}` objects; flat `from_row`/`from_col`/`to_row`/`to_col` aliases accepted; corners normalize either order) and `unmergeTableCells {block,row,col}` (removes whichever merge contains the cell, anchor or covered). Merge model decision: `Table` gains a serde-optional `merges:[TableMerge]` registry of `{row,col,rows,cols}` grid rects rather than per-cell span fields — the dense row-major `cells` grid stays exactly `rows*cols`, `TableCell` and every cell-block rule are untouched, and overlap/bounds validation is a simple rect pass. The top-left anchor keeps its content; covered cells are reset to the canonical empty paragraph at merge time (covered content discarded, spreadsheet semantics — undo restores it), `setCellText` rejects covered cells, and unmerge returns them as ordinary empty cells. Restore validation requires every merge in-bounds, ≥2 cells, pairwise non-overlapping, and every covered cell a pristine empty paragraph; hostile snapshots with overlapping/out-of-bounds/degenerate merges, covered-cell content, or unknown merge fields all reject atomically. Structural-op interaction: row/column inserts shift merge anchors when wholly outside a merge and reject when strictly inside its span; deletes reject when they would remove a covered row/column and shift merges below/right otherwise — cut-through is rejected rather than silently reshaping merges. `listTables`/`describeTable` expose the `merges` registry so hosts can render spans. Schema: **no bump** — `merges` is serde-optional and omitted when empty (merge-free snapshots byte-identical); a slice-A/B reader's `deny_unknown_fields` `Table` fails closed only on snapshots carrying merges, the same precedent as `comments`/`sections` on schema:3. Deferred honestly: per-cell/table styling, nested tables, in-cell find/replace and rich cell editing, `text`/`layout` cell coverage, band-merge convenience ops, DOCX `w:tbl` import/export, consumer geometry.

Local evidence: `cargo test -p quill-engine` 149 passed (8 new merge tests covering registry shape, content discard, covered-cell `setCellText` reject, overlap/bounds/degenerate rejects, unmerge via anchor and covered cell, structural shift/reject on both axes, undo/redo, snapshot round-trip with byte-identical merge-free payloads, hostile restore cases), `cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean, `pnpm --filter @nitro-forge/quill test` 34 passed across 6 files (1 new nf-cli merge/unmerge case), `pnpm --filter @nitro-forge/quill typecheck` clean. No native/device acceptance or full P12 completion is implied.

## Tally CSV/TSV transfer source checkpoint (2026-11-07)

Tally gains delimited-text import/export ops (slice 10, backlog item 10 —
"CSV/TSV import-export ops now; XLSX blocked on dependency admission"):
`importCsv`/`importTsv` take the file text in `text` (engines are I/O-free
— never a path) plus optional `sheet` (name or index, default active) and
`at` anchor (default `A1`); `exportCsv`/`exportTsv` are silent reads
returning `{text,rows,cols}` over `range:{from,to}` or the bounding box
of the sheet's used cells. One parser serves both, parameterized by `,`/`\t`:
RFC 4180 quoting with `""` escapes and embedded newlines, strict rejection
of unterminated quotes or data after a closing quote, CRLF/LF/lone-CR
breaks, one leading UTF-8 BOM stripped, completely blank lines skipped
(`",,"` stays a real row of empty fields), no header handling — every row
is data. Field text stores verbatim like `setRange` (`=` fields become
formulas, numeric text computes as numbers, empty fields clear cells);
rows may be ragged. Import is atomic — 16 MiB text cap, full parse,
`XFD1048576` bounds from `at` and a 1,048,576-cell budget all check before
`commit_cells_on_sheet` stages — one undo entry, eventless when nothing
changes. Export writes *computed* values in display text form
(`fmt_num`/`TRUE`/`FALSE`/`#…!` literals, formats ignored) with the same
quoting rules and a trailing CRLF; the explicit or used-bounds rectangle
is capped at the shared 16,384 cells. Bound-sheet protection guards both
import ops; exports stay ungated reads. These are pure cell reads/writes —
no durable state, so **no schema bump** (stays schema:7-capable). TS
mirror adds `OPS` entries, `importCsv`/`importTsv`/`exportCsv`/`exportTsv`
(and shared `importDelimited`/`exportDelimited`) on `TallyDocument`, and
`transfer.ts` gains `csv`/`tsv` `ImportFormat`s decoding UTF-8 strictly
through `runImport`; the banded `getRange` CSV export stays for sheets
larger than one op's cell cap. `TALLY_DEFERRED_OPS` was already empty —
nothing to lift. Local evidence: `cargo test -p tally-engine` 148 passed
(13 new across csv_ops: round-trip, quoting/CRLF/embedded-newline/BOM,
ragged rows, blank-line skip, `at`/`sheet` targeting, atomic rejects,
undo, protection, unicode, sparse-sheet export bounds),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/tally test` 68 Vitest passed across 18 files
(1 new live `nf-cli` csv-transfer file, 5 cases), `pnpm --filter
@nitro-forge/tally typecheck` clean. XLSX import, header-row options,
encoding selection (host-side) and any import-preview UI remain deferred.

## Tally structural edits + merged cells source checkpoint (2026-11-07)

Tally gains row/column structural ops and merged-cell regions (slice 13,
backlog item 13 — "Merged cells + row/column insert/delete (reuse
`shift_references`)"): `insertRows`/`deleteRows`/`insertCols`/`deleteCols`
take `{sheet?,from,to}` 1-based inclusive bands, validate fully, stage the
remap on a cloned document and commit as one whole-document undo entry —
eventless `{ok:true,changed:0}` when nothing moves. Bounds: bands inside
XFD1048576, inserts must fit the cap, deletes may not cover every row or
column; bound-sheet protection gates all four plus `mergeCells`/
`unmergeCells`. `mergeCells`/`unmergeCells`/`listMergedCells` manage
per-sheet `merges` rectangles (inclusive 0-based `{c0,r0,c1,r1}`, ≥2
cells, non-overlapping, 256/sheet cap); covered cells report
`merged_into` in `getCell`/`getRange` while every cell stays live to
formulas/reads — merges are render metadata only this slice.

Every coordinate-bound structure remaps Excel-like on the edited axis:
cell/format keys shift or drop; formula references rewrite lexically
(`$` preserved syntactically, deleted refs → `#REF!`, partially covered
ranges shrink, fully covered → `#REF!`, insert inside a range expands it);
names/validations/conditional-formats/filters(+column)/charts(+series)/
sparklines/views' captured filter specs/comments anchors/merges all
remap, dropping entries fully covered by a deleted band; ids, criteria,
kinds, titles, bodies and sheet order stay static. Comments — previously
documented static because the ops were deferred — now shift like Excel
and drop with their anchor's band. **Schema bump to 8**: `Sheet.merges`
is new durable state `Sheet`/`Workbook` do not `deny_unknown_fields`, so
merge-carrying snapshots emit `{kind:"tally",schema:8}` and restore
accepts 1–8 with per-table schema gates (nonempty merges require 8);
restore re-canonicalizes merge rectangles and rejects overlaps,
single-cell/out-of-bounds regions, cap violations and unknown fields
atomically. TS mirror adds the seven `OPS` entries, `BandEdit`/
`MergedRangeInfo` types, `merged_into` on `CellInfo`, and
`TallyDocument` methods; `grid-cluster.ts` docs updated (no UI callback
changes — hosts wire the methods directly). Local evidence:
`cargo test -p tally-engine` 164 passed (16 new struct_ops tests covering
the full remap matrix, merge ops, bounds, atomicity, undo/redo, hostile
restore and protection), `cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/tally test` 75 Vitest passed across 19 files (1 new live
nf-cli structural-merges file, 7 cases), `pnpm --filter
@nitro-forge/tally typecheck` clean. Deferred: merge render/fill
semantics, sort/format interaction rules, and any row/column UI wiring —
no native/device acceptance or full P13+ completion is implied.

Review follow-up (same slice): inserts now reject atomically with
`out_of_bounds` when any stored coordinate would shift past the sheet
edge (previously the off-sheet entry was silently dropped while the op
reported `changed:1`); `mergeCells`' idempotent no-op reports the
canonical `range` like a fresh merge; `unmergeCells`' inherited
16,384-cell range cap is documented. `cargo test -p tally-engine` 168
passed (4 new tests: edge-overflow rejection across cells/merges/names/
validations/comments, locked-ref remap and range expansion).

## P11 Motion slice E motion paths source checkpoint (2026-11-07)

Motion layers now carry an optional `path` — a single Prism-style node
subpath (x/y anchors, `in`/`out` cubic handles as node offsets, optional
`closed`, `auto_orient`) set via `setMotionPath` (null clears path, progress
base and `path_progress` curve atomically) — plus `path_progress`, the new
`Property::PathProgress` curve property (0..=1) evaluated by the existing
key machinery. Evaluation flattens each path per call into at most 4096
vertices with a cumulative arc-length table, so progress selects a point at
a uniform fraction of total arc length; the offset adds to evaluated
tx/ty after curves and `auto_orient` adds the flattened-edge tangent angle
to rotation. Snapshot schema stays 2 via additive serde defaults; validate
rejects path_progress without a path on hostile restore too. Local
evidence: `cargo test -p motion-engine` 56 passed (6 new covering exact
polyline arc length/progress, bezier subdivision under the sample cap,
progress-keyframe positioning with real pixels, auto-orient tangent angles,
clear/locked/hostile-restore/undo, extreme path offsets saturating the
evaluated transform at the ±1e7 Prism bound so renderFrame still succeeds),
`cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/motion test` 7 passed across 6 files (1 new nf-cli path case),
`pnpm --filter @nitro-forge/motion typecheck` clean. Cubic curvature
between flattened samples, multi-subpath paths, path drawing/editing UI
and full P11 completion are not implied.

## Tally pivot specs storage source checkpoint (2026-11-07)

Tally gains workbook-level pivot-table specs (backlog item 11, slice 11-A —
spec storage/create/read/delete only): `insertPivot`/`updatePivot`/
`removePivot`/`listPivots`/`describePivot` manage `pivots` entries
`{id, sheet, name?, source:{sheet,range}, rows, columns, values,
filters?, sort?}` — durable ids, at most 256 per workbook. `sheet` is the
output sheet id the pivot belongs to; `source.sheet`/`source.range` bind
the data (canonical A1/B2 rectangles under the shared 16,384-cell cap,
existing-sheet checked). **Field references are 0-based column offsets
into the source range**, not header names: `rows`/`columns` ≤16 unique
indices each, `values` 1–16 `{field,agg}` slots (`sum|count|avg|min|max`),
`filters` ≤32 `{field,values}` entries and `sort` an optional
`{field,ascending}` — every field index must lie inside the source
width; name resolution is deferred to a later refresh slice.
`name` is an optional ≤128-byte string. `insertPivot {sheet?, pivot}`
always appends a fresh id (duplicate specs allowed — pivots are objects,
not keyed rules); `updatePivot {id,patch}` is a partial metadata patch —
present keys set, explicit `null` clears `name`/`filters`/`sort`,
`source` is a partial `{sheet?,range?}` needing one key, unknown keys
and `sheet` alongside `id` reject, and the merged spec re-validates
before commit (equal patch is eventless). `listPivots {sheet?}` filters
by output sheet; `describePivot {id}` reads one spec; both silent.

**Storage only — no materialization**: create/update write no cells and
the engine never computes, refreshes or renders the pivot grid —
update/refresh/compute ops are explicitly deferred; hosts read source
cells via `getRange`/`getCell` and compute host-side. Mutations record
one whole-document undo entry each; `removeSheet` cascade-drops pivots
whose output OR source sheet is removed into the same undo entry and
undo re-admits each only while it still satisfies restore invariants;
`duplicateSheet`/`moveSheet`/`renameSheet` do not copy or retarget
pivots. A pivot's `source.range` remaps with structural row/column
edits on the source sheet (insert expands/shifts, delete shrinks or
drops fully covered ranges — and a pivot additionally drops when a
column delete shrinks the source below a referenced field index);
pivots bound to the edited sheet only as output are untouched.
Protection guards mutations by the output sheet like chart ops — the
source sheet is a read reference and does not gate.

**Schema bump to 9**: `pivots`/`next_pivot` are new workbook-level
durable state `Workbook` does not `deny_unknown_fields`, so
pivot-carrying snapshots emit `{kind:"tally",schema:9}` and restore
accepts 1–9 with per-table gates (nonempty pivots require 9); restore
strictly validates pivot shape, id uniqueness, existing output/source
sheet ids, canonical capped source ranges, bounded names/field lists
with field indices inside the source width and `next_pivot` id-space
repair atomically. TS mirror adds the five `OPS` entries,
`PivotAgg`/`PivotInput`/`PivotPatch`/`PivotInfo`/`PivotValueInput`/
`PivotFilterInput`/`PivotSortInput` types and `insertPivot`/
`updatePivot`/`removePivot`/`listPivots`/`describePivot` methods on
`TallyDocument`; `grid-cluster.ts` docs updated (no UI callback
changes). Local evidence: `cargo test -p tally-engine` 181 passed
(13 new pivot_ops tests covering CRUD, bounds/caps, atomic failure,
undo/redo, sheet-removal cascade + re-admission, hostile restore,
schema matrix and structural source-range remap), `cargo build -p
nf-cli` clean, `pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/tally test` 77 Vitest passed across 20 files (1 new live
nf-cli pivots file, 2 cases), `pnpm --filter @nitro-forge/tally
typecheck` clean. Deferred: pivot compute/refresh/materialization,
header-name field resolution, pivot UI wiring — no native/device
acceptance or full P12–P14 completion is implied.

## Tally table objects source checkpoint (2026-11-07)

Tally gains workbook-level table objects (backlog item 12, slice 12 —
Excel Table / ListObject storage + CRUD/read only):
`insertTable`/`updateTable`/`removeTable`/`listTables`/`describeTable`
manage `tables` entries `{id, sheet, name, range, show_headers?,
show_totals?, banded_rows?, banded_columns?}` — durable ids, at most 256
per workbook. `sheet` is the bound sheet id; `range` is a canonical
A1/B2 rectangle under the shared 16,384-cell cap covering at least two
cells, its top row acting as the header row. `name` is the display name —
`[A-Za-z_][A-Za-z0-9_.]*`, ≤128 bytes, **unique case-insensitively across
the whole workbook** (Excel's rule); omitted, the engine assigns the
smallest free `"Table{n}"`. The four flags are storage-only display
intent: the engine writes no cells, computes no totals and applies no
banding. On one sheet table ranges may not overlap each other or any
merged region, and `mergeCells` symmetrically rejects rectangles that
intersect a table — Excel's no-merged-cells-inside-tables rule in both
directions.

`insertTable {sheet?, table}` declares the range a table outright (no
conversion workflow); `updateTable {id,patch}` is a partial patch —
present keys set, no field accepts `null`, unknown keys and `sheet`
alongside `id` reject, the merged spec re-validates name uniqueness and
overlap before commit, and an unchanged spec is eventless.
`listTables {sheet?}` filters by bound sheet; `describeTable {id}` reads
one spec; both silent. **Storage only** — structured references
(`Table1[Col]`), totals computation, autofilter integration and any
table UI are explicitly deferred. Mutations record one whole-document
undo entry each; `removeSheet` cascade-drops the sheet's tables into the
same undo entry and undo re-admits each only while it still satisfies
restore invariants; `duplicateSheet`/`moveSheet`/`renameSheet` do not
copy or retarget tables. A table's `range` remaps with structural
row/column edits on its sheet like every other bound range — inserting
inside expands it (Excel behavior), partial deletes shrink it and a
fully covered range drops the table; disjoint structures stay disjoint
through the shared `Band`. Protection guards mutations by the bound
sheet like the other rule tables; reads stay allowed.

**Schema bump to 10**: `tables`/`next_table` are new workbook-level
durable state `Workbook` does not `deny_unknown_fields`, so
table-carrying snapshots emit `{kind:"tally",schema:10}` and restore
accepts 1–10 with per-table gates (nonempty tables require 10); restore
strictly validates table shape, id uniqueness, existing bound sheet ids,
name legality and workbook-wide case-insensitive uniqueness, canonical
capped ranges with no same-sheet table/table or table/merge overlap, and
`next_table` id-space repair atomically. TS mirror adds the five `OPS`
entries, `TableInput`/`TablePatch`/`TableInfo` types and
`insertTable`/`updateTable`/`removeTable`/`listTables`/`describeTable`
methods on `TallyDocument`; `grid-cluster.ts` docs updated (no UI
callback changes). Local evidence: `cargo test -p tally-engine` 195
passed (14 new table_ops tests covering CRUD, bounds/caps, name
legality/uniqueness/auto-naming, overlap and merge rejection, atomic
failure, undo/redo, sheet-removal cascade + re-admission, hostile
restore, schema matrix and structural range remap), `cargo build -p
nf-cli` clean, `pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/tally test` 79 Vitest passed across 21 files (1 new live
nf-cli tables file, 2 cases), `pnpm --filter @nitro-forge/tally
typecheck` clean. Deferred: structured references, totals computation,
autofilter integration, table UI wiring — no native/device acceptance
or full P12–P14 completion is implied.

## P12 Quill tables slice 7-D checkpoint (2026-11-07)

Quill closes the two tractable deferred table items (P12 slice 7-D): in-cell
find/replace and `text`/`layout` cell coverage — no new state, so no schema
bump and hostile-restore behavior is unchanged. Addressing-model decision:
cell text stays unreachable by `Pos` (a table block's only valid position is
`{block,0}`), so `findText` keeps `matches`/`count` byte-identical for
top-level hits and adds `cell_matches`/`cell_count`, each entry `{from,to,text}`
whose endpoints are cell-qualified `CellPos = {block,row,col,cell_block,offset}`
(table block index, grid cell, paragraph index inside the cell, scalar offset).
Cell coverage follows `deleteRange`'s inclusive block-range convention: a
table's cells are searched iff the query's block range includes the table index
and is not collapsed on it; matching stays per cell paragraph, so hits never
span paragraphs, cells, or the table boundary. `replaceText` applies the same
matches on the staged clone — in-cell hits rewrite the cell paragraph's
inlines with the same first-scalar style inheritance, right-to-left per
paragraph; bookmarks/comments/sections remap through top-level matches only
(cell edits cannot move `Pos` anchors), the candidate still passes list +
`validate_tables` staging, `replaced` counts top-level plus in-cell edits, and
merge-covered cells are canonical empty paragraphs that can never match.
`text` serializes a covered table block as rows `\n`-joined, cells
`\t`-separated, cell paragraphs `\n`-joined (documented ambiguity: a
multi-paragraph cell reads as extra row breaks); `layout` wraps that same
serialization with line spans indexing it — honest coverage with no cell
geometry. Still deferred: in-cell `changeCase`/`applyStyle` and rich cell
editing (all need cell-qualified range addressing), per-cell/table styling,
nested tables, band-merge convenience ops, DOCX `w:tbl`.

Local evidence: `cargo test -p quill-engine` 154 passed (5 new slice-D tests
covering cell-match positions and ordering, range/case rules, multi-cell
replace with undo/redo/eventless/snapshot round-trip, merge-covered cells,
`text`/`layout` serialization), `cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter @nitro-forge/quill test`
35 passed across 6 files (1 new nf-cli in-cell find/replace case),
`pnpm --filter @nitro-forge/quill typecheck` clean. No native/device acceptance
or full P12 completion is implied.

## P12 Quill slice 9 paragraph format checkpoint (2026-11-07)

Quill gains paragraph alignment, indents, and tab stops (P12 slice 9) as
storage-only block formatting — the DOCX `w:jc`/`w:ind`/`w:tabs` subset
with no layout consumer. New op `setParagraphFormat {block,alignment?,
indent_left?,indent_right?,indent_first?,tabs?}` is a partial patch on the
new serde-optional `Block.format` (`ParagraphFormat`): present keys set,
`null` clears, absent untouched, `tabs` replaces the ≤64 strictly
increasing `{position,alignment,leader?}` stop list, and an all-empty
result canonicalizes `format` away. Alignment is `left`/`center`/`right`/
`justify`; indents and tab positions are twips (left/right 0..=31680,
`indent_first` ±31680 where negative is hanging); tab alignment
`left`/`center`/`right`/`decimal`, leader `dot`/`hyphen`/`underscore`/
`heavy`. Format rides the block through splits (both halves), merges
(head wins), `deleteRange`, `changeCase`, `replaceRange` and block-splice
undo for free. `"paragraph"`-kind named styles carry the same grammar
under `properties.paragraph` (character kinds reject the key);
`setBlockStyle` merges it onto `Block.format` with the same
present-wins/absent-untouched snapshot semantics as the inline stamp, and
`updateStyle`/`removeStyle` never propagate. Table blocks and cell
paragraphs reject `format` (`validate_tables`), so cell-paragraph
formatting stays deferred until cell-qualified addressing exists.

Schema: **bump to schema:4** — `Block` has no `deny_unknown_fields`, so a
`format` field would be silently dropped by schema≤3 readers (the same
reason `list` needed schema:2). Any snapshot carrying `Block.format` or a
non-null `properties.paragraph` emits `{kind:"quill",schema:4,document:
<identical schema:3 shape>}`; schema≤3/legacy payloads carrying v4
features reject rather than silently accepting them, `ParagraphFormat`/
`TabStop` are `deny_unknown_fields` with bounded re-validation on restore,
and documents without format features keep emitting schema≤3
byte-identically. Deferred honestly: any layout/render consumption
(alignment/indent/tab-stop effects on `layout`/`text`), DOCX
`w:jc`/`w:ind`/`w:tabs`/`styles.xml` paragraph-format import/export, cell
formatting, `bar` tab stops and `start`/`end`/`distribute` alignments,
multi-block format ops beyond `__batch`, and live style updates.

Local evidence: `cargo test -p quill-engine` 167 passed (13 new covering
set/patch/clear, eventless equal writes, bounds and table-block atomic
rejects, undo/redo, split/merge carry rules, schema:4 emission and
round-trip, hostile restore incl. schema:3-relabeled and cell/table
format smuggling, named-style precedence and character-kind rejection,
batch/`replaceRange`/`changeCase` preservation), `cargo build -p nf-cli`
clean, `pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/quill test` 41 passed across 7 files (6 new nf-cli
paragraph-format cases), `pnpm --filter @nitro-forge/quill typecheck`
clean. No native/device acceptance or full P12 completion is implied.

## P11 Motion slice F deterministic particles source checkpoint (2026-11-08)

Motion gains `kind:"particles"` layers carrying an optional bounded
`emitter` spec (`addParticlesLayer` creates the empty kind,
`setParticleEmitter` full-replaces or null-clears the spec; locked layers
and non-particles targets reject). **No sim state exists**: birth index
`n` occurs at `n/rate`, alive while `tau=t-n/rate` is in `0..=lifetime_s`,
position is closed-form `spawn + v*tau + 0.5*gravity*tau^2`, and every
per-particle attribute (spawn point, angle, speed, size, fade phase)
derives from a splitmix64-style hash of `(seed, n, channel)` — `evaluate(t)`
and `renderFrame(t)` are pure functions of time, seek-safe forward and
backward. Sprites are bounded shapes (rect/ellipse, dims <=512) or existing
immutable raster assets at natural size; rendering rasterizes on the CPU
into a canvas-sized straight-alpha buffer (4x4 supersampled masks,
source-over in ascending birth order) and uploads through the normal
`addRasterLayer`+`drawPixels` path with identity transform, baking the
layer's effective affine — own transform plus `parent_id` chain, shear
included — into positions and per-axis sprite scale, so transform, opacity,
visibility, curves, blend, clipping, mattes, effects and nested comps all
compose unchanged. Caps: `rate*lifetime_s<=511` (<=512 alive sprites per
emitter per frame), <=64 emitters per document across all compositions,
<=512 summed alive-sprite bound per composition, sprites join the 16
canvas-raster-layer/16 MiB per-comp storage budget, and a deterministic
8x-canvas stamped-pixel budget drops younger particles when spent.
Snapshot schema stays 2 via additive serde defaults; `validate` re-checks
all bounds, sprite-asset existence, kind matching and budgets on hostile
restore; `removeRasterAsset` also rejects emitter sprite references.
Sprite orientation is never rotated and asset sprites resample
nearest-neighbor — documented approximations.

Local evidence: `cargo test -p motion-engine` 63 passed (7 new covering
byte-identical repeat/seek determinism, seed decorrelation, lifetime
window edges, per-emitter/per-comp/64-emitter caps, kind rules,
hostile-restore rejection with state preservation, undo/redo, transform
translation of the particle field, asset sprites, asset-reference
stranding and snapshot round-trip), `cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/motion test` 8 passed across 7 files (1 new nf-cli particles
case), `pnpm --filter @nitro-forge/motion typecheck` clean. Particle UI,
GPU sims, per-particle curves and full P11 completion are not implied.

## P11 Motion slice G1 3D model/eval source checkpoint (2026-11-08)

Motion layers gain an optional `transform3d` (`{rx,ry,z}` — X/Y euler
rotations in degrees about the layer's anchor plus view depth) set via the
new `setLayer3D` op (null clears the transform and any `rx`/`ry`/`z` curves
atomically, the `setMotionPath` precedent). `rx`/`ry`/`z` are ordinary scalar
curve properties on the existing `setPropertyKeys` machinery bounded ±1e7
with no angle wrapping; `rotation` remains the Z-axis roll so no new
position/scale/roll/anchor fields exist. Presence of `transform3d` marks the
layer 3D-enabled and is required by 3D curves — `validate` rejects orphan
3D curves on hostile restore too. **Storage/eval only, no raster**:
`renderFrame` ignores `transform3d` entirely (nonzero rx/ry/z produce
byte-identical pixels, verified), while `evaluate` reports each 3D layer's
evaluated `{rx,ry,z}` plus a read-only computed `projected_transform`
`{a,b,c,d,e,f}` — the orthographic projection (view axis = layer-local Z,
depth dropped) of the evaluated local transform as raw 2x3 coefficients,
because the projected affine can carry shear the pivoted `Transform` fields
cannot express. Documented limitations: `z` never enters the orthographic
coefficients, the 2D `rotation` roll composes inside the pre-tilt transform
rather than the euler chain, projection is local-only like every other
`evaluate` transform report, `describe`/snapshots carry authored values only,
and there is no camera, lights, depth sorting or true projection rendering —
the backlog's `Camera`/`Light[]` G1 entries are deferred (camera parameters
are meaningless until G2 defines the view model; lights belong to G3).
Snapshot schema stays 2 via additive serde defaults; old readers fail closed
(`transform3d` is unknown under `deny_unknown_fields`, `rx`/`ry`/`z` curve
names fail the strict `Property` enum) — never silently dropped, the same
accepted cost as blend/clipped/matte/effects/path/emitter. `updateLayer`
does not patch `transform3d` (dedicated op only); equal writes and
clear-when-absent are eventless.

Local evidence: `cargo test -p motion-engine` 71 passed (8 new: 5 engine
tests covering set/eval curves, hand-verified projected affine coefficients,
edge-on collapse, render no-op byte-identity, snapshot round-trip,
undo/redo, atomic clear, equal-write eventless, bounds/locked/hostile-restore
rejection and nested-comp projection, plus 3 projection unit tests),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/motion test` 9 passed across 8 files (1 new
nf-cli transform3d case), `pnpm --filter @nitro-forge/motion typecheck`
clean. 3D rasterization, camera, lights, depth ordering and full P11
completion are not implied. (The render no-op claim above was true at this
checkpoint; the G2/G3 checkpoint below supersedes it — `renderFrame` now
projects 3D layers and honors light rigs.)

## P11 Motion slices G2/G3a 3D rasterization + lighting source checkpoint (2026-11-08)

Per `P11-motion-g23-decisions.md`: G2 Option A CPU affine rasterization and
G3a Lambertian+ambient lighting. `transform3d` layers now render: content
stages through the shared rasterize path (shape/effects/particles/nested
comp all supported), resamples through the evaluated projected affine —
shear-capable, deterministic nearest-neighbor, `TaskContext` checkpoints —
and uploads once as an identity raster so transform/opacity/blend/clip/
matte compositing is unchanged. `renderFrame`, `renderQueueFrame` and
nested-comp renders share the path. Each composition gains an additive
`lights` rig (≤8 directional/ambient lights) set via `setLights`; shading
applies only to `transform3d` layers (constant normal
`RotY(ry)·RotX(rx)·Z`, RGB multiply after effects before compositing, alpha
untouched). Snapshot schema stays 2 via serde defaults; `describe`
materializes `lights` (`[]` when unset). Deferred per the decision record:
perspective/camera/FOV, depth sorting, z occlusion (`z` render-inert),
specular, normal maps, point falloff, shadows; nearest-neighbor aliasing
and edge-on collapse are documented behavior.

Local evidence: `cargo test -p motion-engine` 126 passed (new
`render3d_tests` covering hand-verified rx/ry/shear/rotation-composed
pixels, byte-identical unlit path, effects/mattes/nested-comp composition,
particles/media 3D acceptance, light validation/atomicity/undo/snapshot,
Lambert+ambient shading and unlit-layer invariance, plus queue parity via
the shared renderer), `cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter @nitro-forge/motion
test` 15 passed across 13 files (updated nf-cli transform3d case now
asserts real projection; new nf-cli lights case covers ambient/directional
shading, comp-scoped rigs and snapshot round-trip), `pnpm --filter
@nitro-forge/motion typecheck` clean. Perspective projection, camera,
depth sorting, specular/shadows and full P11 completion are not implied.

## P11 Motion slice D bounded expressions source checkpoint (2026-11-08)

Motion layers gain an optional `expressions` list — at most one
`{property,source}` per layer, covering all 12 scalar curve properties —
set via the new `setExpression` op (`source` string ≤4096 UTF-8 bytes or
explicit `null` to clear; absent rejects). Sources are stored as text and
re-parsed at op time and on `restore` through a hand-rolled
recursive-descent parser: arithmetic/comparison/ternary/`&&`/`||`/`!` over
f64, the whitelisted pure functions `abs floor ceil round trunc sign sqrt
cbrt exp ln log10 sin cos tan asin acos atan atan2 pow hypot min max
clamp lerp mod smoothstep`, the time constants `time`/`frame`/`fps`/
`duration` (composition-local, same mapping as curve eval) and property
references `this.<prop>`/`layer(<id>).<prop>` limited to the same
composition. `random`/noise are excluded — evaluation is a pure function
of document state plus explicit time with no clock, I/O or host calls.
Caps: ≤512 AST nodes, ≤64 call nodes, 10,000 defensive eval steps per cell
resolution (exceed → NaN → 0.0). Ownership is mutually exclusive and
last-write-wins with atomic clear: `setExpression` deletes the property's
curve, `setPropertyKeys` deletes its expression, `setMotionPath` null
clears `path_progress` expressions and `setLayer3D` null clears
`rx`/`ry`/`z` expressions — one journal entry each, undo/redo atomic.
`validate` re-checks parse/caps/kind gates/mutual exclusion/same-comp
refs and whole-document `(layer,property)` dependency acyclicity
(including self-references) on every mutation and hostile restore;
structural ops that would strand a `layer()` ref (`removeLayer` of a
referenced layer, cross-composition `reparentLayer`, `removeComposition`)
reject atomically, and `duplicateComposition` rewrites `layer(<id>)`
arguments to the copy's fresh identities. Resolution order per property is
expression → curve → base, memoized per evaluation so references see
resolved values order-independently and seek-safely; NaN/±inf propagates
through IEEE arithmetic and sanitizes only at the property boundary
(non-finite → 0.0, finite → `Property::bounds` clamp). `describe` returns
sources verbatim; `evaluate`/`renderFrame` clear `expressions` in output
like `curves` with resolved values in the same fields. Snapshot schema
stays 2 via additive serde defaults — expression-free layers serialize
byte-identically. TS gains `MotionExpression`, `expressions?` on
`MotionLayer` and `setExpression`. Deferred per spec: host-side scripting,
non-scalar outputs, per-effect/emitter/matte binding, cross-composition
reads, seeded noise, expression UI.

Local evidence: `cargo test -p motion-engine` 84 passed (13 new covering
the parse/bounds rejection matrix, mutual-exclusion atomic clear both
directions, self/two-property/two-layer cycle rejection, time/frame/fps/
duration at root and nested-comp-scaled times, 30 whitelisted-function
spot checks plus `this`/`layer()` resolution, non-finite→0 and bound
clamping, seek determinism, undo/redo atomicity, equal-write eventless,
kind gates, structural clears, hostile-restore rejection matrix,
cross-comp ref rejection, duplicate remap and referenced-layer removal),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/motion test` 10 passed across 9 files (1 new
nf-cli expression case), `pnpm --filter @nitro-forge/motion typecheck`
clean. UI, cross-comp reads and full P11 completion are not implied.

## Draft layers slice A1 (2026-11-07)

Draft gains bounded named layers (`addLayer`/`updateLayer`/`removeLayer`,
at most128, unique 1..512-byte names, optional RGBA color, `visible`/`locked`).
Layer id 0 is implicit and reserved: never serialized in `layers`, always the
entity default, and cannot be added, renamed, removed, hidden or locked.
Segments/circles/arcs carry an optional `layer` field (serde default 0, skipped
when 0), so layer-0 documents keep byte-identical legacy schema1 snapshots;
any nonempty layer map or nonzero entity layer forces the existing strict
`{kind:"draft",schema:2}` wrapper, and hostile restores reject dangling layer
references, reserved id 0, duplicate/empty names and unwrapped extended state.
Entities on invisible layers are excluded from `renderFrame`, all segment and
circular snap modes and `findProfiles` exactly like `visible:false` (authored
points still snap as endpoints; points have no layer). Entities on locked
layers reject update/remove ops and any point edit touching their endpoints or
center, and cannot be moved off the layer, while assigning entities onto a
locked layer stays allowed; the linear solver treats their coordinates as
fixed. `removeLayer` rejects layer 0, unknown ids and nonempty layers rather
than silently reassigning entities. There is no active/current layer; hosts
pass `layer` per entity op. `executeCommand` grammar, hatches, dimensions,
nonlinear solving, paper space and blocks remain unimplemented later slices.

Local evidence: `cargo test -p draft-engine` 28 passed (4 new layer tests),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/draft test` 9 passed across 3 files (1 new nf-cli
layer e2e), `pnpm --filter @nitro-forge/draft typecheck` clean. UI adoption,
native acceptance and full P17 completion are not implied.

## P16 design prototype catalog slice E checkpoint (2026-11-08)

Design gains the NYC-Tron L-08..L-11 prototype contracts as durable document
state under `prototype:{screens,hotspots,interactions,transitions}` (the
installed alpha.4 pin still lacks `forge/design`; contracts were read from
the NYC-Tron `codex/complete-all-components` source). Screens (≤512)
reference `frame`/`component` nodes with an `entry` flag; hotspots (≤4096)
are trigger regions normalized to 0..=1 inside the unit square of a
registered screen; interactions (≤4096) attach to exactly one hotspot or
screen and carry the `PrototypeInteraction` trigger/action/target/delay/
duration fields plus a bounded transition preset reference (≤256 presets,
kind `instant|dissolve|slide|smart-animate`, easing
`linear|ease-in|ease-out|ease-in-out`, slide direction, duration ≤600000ms,
trigger delay ≤86400000ms); `target` is a typed `{kind:"screen",node}` /
`{kind:"variable",id}` mapping of the contract's string `destinationId`,
and `value` is an engine extension carrying the set-variable literal
(aliases rejected, type must match). New ops: `definePrototypeScreen`,
`updatePrototypeScreen`, `removePrototypeScreen`, `definePrototypeHotspot`,
`updatePrototypeHotspot`, `removePrototypeHotspot`,
`definePrototypeTransition`, `updatePrototypeTransition`,
`removePrototypeTransition`, `definePrototypeInteraction`,
`updatePrototypeInteraction`, `removePrototypeInteraction`, plus the
`prototypeGraph` and `resolvePrototypeEvent` reads. `resolvePrototypeEvent`
is a pure deterministic function — `{hotspot?|screen?,trigger?}` in,
first catalog-order match or JSON `null` out, with the resolved transition
(`duration_ms` override applied) and `delay_ms`; `prototypeGraph` projects
screens/hotspots/interactions/transitions plus derived FlowOverview `links`.
The engine stores no playback status/progress and no clock — scheduling is
`scheduled_by:"host"` — so it never fakes animation. Validation is
whole-document on mutation and hostile restore (unknown/dangling
references, bad geometry, timing bounds, slide-direction rules, action/
target pairing all reject atomically); screen/hotspot/node/variable
removals cascade or reject so no dangling reference survives, and
`removePrototypeTransition` rejects while referenced. Snapshot schema
stays 2 via the presence-triggered wrapper: any non-empty prototype
collection emits `{kind:"design",schema:2,document}` and unwrapped state
carrying `prototype` rejects on restore. Presence stays out — server
transport only per the P16 placement decision.

Local evidence: `cargo test -p design-engine` 44 passed (3 new prototype
tests covering CRUD/graph/resolve determinism and eventless reads,
validation bounds/targets/atomic rejection, transition lifecycle,
cascades, schema:2 wrapper round-trip and hostile restore),
`cargo build -p nf-cli` clean, `pnpm --filter @nitro-forge/design test` 14
passed across 10 files (1 new nf-cli live test, 1 new payload-contract
test), `pnpm --filter @nitro-forge/design typecheck` clean. Overlay stack
semantics, drag hit-testing, reusable styles, comments, presence transport,
native/JSI rebuild and UI wiring remain deferred; no full P16 completion is
implied.

## Tally cross-sheet formula references source checkpoint (2026-11-07)

Tally gains workbook-wide `Sheet!` formula references (backlog item 14,
slice 14 — the last P13 item): `Sheet1!A1`, `'Q1 Data'!B2` and
`Data!A1:B2` qualifiers (bare word or single-quoted with `''` escaping,
resolved by **current sheet name, case-insensitive**) reach any sheet.
One `Evaluator` now carries the whole book — `(name, id, cells)` per
sheet — so memoization, the 500-deep evaluation cap, cycle detection
and the 1,000,000 conditional-work allowance are all keyed/shared
across sheets (`visiting`/`memo` keys are `(sheet index, address)`);
bare refs, ranges and defined names inside a reached formula resolve
on the sheet holding that formula (`current`), never the request's
home sheet — `COUNTIF`/`SUMIF` range scans included (they previously
would have read the home sheet's cells). `evaluate` treats the active
sheet as home.

Semantics: `renameSheet` rewrites every stored `Old!` qualifier
workbook-wide in the same whole-document undo entry (Excel behavior;
new names re-render bare or quoted as needed), `removeSheet` leaves
qualifiers in place so they evaluate `#REF!` until a same-named sheet
exists again, and structural band edits remap qualified refs like bare
ones — unqualified + self-qualified on the edited sheet, a mirror pass
for `Edited!` refs stored on other sheets, other qualifiers verbatim;
a reference killed by a band collapses the whole `Sheet!ref` to
`#REF!`. 3D ranges (`Sheet1:Sheet3!A1`), `Sheet!name` and
second-endpoint qualifiers (`S!A1:T!B2`) are not in the grammar and
parse `#NAME?`; `duplicateSheet` copies formula text verbatim so
self-name qualifiers keep pointing at the source sheet (documented
subset). No schema bump — formulas are strings; legacy snapshots and
single-sheet workbooks evaluate identically. `index.ts` gained doc
comments only (no API surface change). Local evidence:
`cargo test -p tally-engine` 212 passed (11 new: formula unit tests
for qualifiers/quoting/cycles/remap/rename plus lib integration tests
for evaluation, hostile strings, cycles, depth chains, rename
undo/redo, removal revival and cross-sheet structural remap),
`cargo build -p nf-cli` clean, `pnpm --filter @nitro-forge/tally test`
85 Vitest passed across 22 files (1 new live nf-cli cross-sheet file,
6 cases), `pnpm --filter @nitro-forge/tally typecheck` clean. Deferred:
3D ranges, qualified names, COUNTIF/SUMIF over qualified ranges
(same-sheet contract kept), duplicate-sheet qualifier retargeting, and
any UI wiring — no native/device acceptance or full P13+ completion is
implied.

## Draft hatches slice A4 (2026-11-07)

Draft gains bounded hatches (`addHatch`/`updateHatch`/`removeHatch`, at most64)
with explicit world-space boundary loops, built-in patterns only (`solid`,
`ansi31` 45-degree lines, `crosshatch` 45+135 degrees, `horizontal` 0 degrees;
base pitch 3.0 world units times `scale` 1e-3..1e3, `angle` rotation within
+-360000 degrees, line `width` 1e-6..1000 world units, at most8 loops and4096
sampled vertices per hatch) and the same visible/locked/layer semantics as
entities. Boundaries come from explicit `loops` point polygons or
`boundary_ids`: segment/circle/arc ids traced once through the findProfiles
machinery (visibility ignored, every id must partition into closed nonzero-area
loops) into sampled polygons stored on the hatch, so hatches are deliberately
NOT associative — later entity edits never move them (deferred). Prism exposes
no vector path-clip op (`addMask` is a canvas-space alpha buffer, `setClipped`
clips a whole layer to the composite below), so `solid` renders as a real Prism
`fill` with `fill_rule:"evenodd"` over the stored loops and line patterns are
clipped analytically in draft — even-odd interval pairing of each pattern line
against every boundary edge, emitted as bounded stroked subpaths (512 lines per
family, 4096 segments per hatch; exceeding rejects the render honestly). Hatches
composite under entity strokes, respect hidden/locked layers, block `removeLayer`
while referenced, join undo/redo and force the existing strict
`{kind:"draft",schema:2}` wrapper; hostile restores reject unknown patterns,
dangling layers, degenerate loops and unwrapped extended state. `describe` and
`evaluate` expose the `hatches` map.

Local evidence: `cargo test -p draft-engine` 33 passed (5 hatch tests),
`cargo build -p nf-cli` clean, `pnpm install` clean,
`pnpm --filter @nitro-forge/draft test` 10 passed across 4 files (1 new nf-cli
hatch e2e), `pnpm --filter @nitro-forge/draft typecheck` clean. Associative
hatches, custom patterns, gradients and PNG fills remain deferred; UI adoption,
native acceptance and full P17 completion are not implied.

## P12 Quill revisions slice 6 checkpoint (2026-11-07)

Quill gains track-changes revisions (P12 slice 6), the largest remaining
quill item besides footnotes/TOC/mail-merge. Model decision: revision
**records**, not inline `w:ins`/`w:del`-style markers — a `Revision`
`{id,kind:"ins"|"del",from,to,author?,time?,text?}` anchors to live
`{block,offset}` positions with comment-style gravity (`ins` from left/to
right so typing at either boundary extends the marked range; `del`
collapses both anchors to the deletion point, right gravity). `ins`
records bracket text already in the block stream; `del` records store the
deleted plain text (65536-char cap, `\n`-joined) so reject can restore it.
`setTrackChanges {enabled,author?}` persists the setting plus default
author inside the schema:3 `deny_unknown_fields` document alongside a
`revisions` key — **no schema bump**, same precedent as comments/sections:
schema:3-era readers fail closed on either key, absent keys restore as
empty/disabled, and schema:2/legacy payloads carrying them reject.
`insertText`/`deleteRange`/`replaceRange` auto-record while tracking is on
(per-op `author`/`time` payload overrides; `time` is caller-supplied unix
seconds, engine has no clock); `listRevisions` is eventless;
`acceptRevision`/`rejectRevision`/`acceptAllRevisions`/`rejectAllRevisions`
(with optional `kind` filter) stage decisions on a tracking-disabled clone
and commit one whole-document undo entry — ins-accept keeps the marked
text, ins-reject deletes the marked range, del-accept drops the record,
del-reject re-inserts plain text via `insertText` (styles/kinds NOT
restored, documented), and inapplicable or failed records stay pending
in `*All` (a record drops only after its staged decision succeeds).
Anchors remap through every position-moving path incl. `changeCase`,
`replaceText`, `insertTable`/`deleteTable` (comment-style clamping);
`importDocx`/`new` reset both. Restore strictly validates count (1024),
unique ids, kind/text invariants, author caps, `time` bound and anchor
bounds before replacing state. Deferred honestly: fmt-change revisions,
cell-text revisions (Pos-unreachable), range-scoped accept, markup/"show
changes" reads, and all DOCX `w:ins`/`w:del`/`w:revisionId` interop — these
records must not be presented as Word revision ids.

Local evidence: `cargo test -p quill-engine` 175 passed 0 failed
(includes revision tracking/decision/restore/remap/bulk-filter/undo tests),
`cargo build -p nf-cli` clean, `pnpm --filter @nitro-forge/quill test` 36
passed across 6 files (1 new revisions e2e), `pnpm --filter @nitro-forge/quill
typecheck` clean.

## Draft associative dimensions slice A3 (2026-11-07)

Draft gains bounded associative dimensions (`addDimension`/`updateDimension`/
`removeDimension`, at most64) with kinds `linear` (two point ids + required
`axis:"x"|"y"`), `aligned` (two point ids), `angular` (vertex + two ray point
ids, unsigned 0..180 degrees) and `radial`/`diameter` (circle/arc `entity` id).
Dimensions store only authored references — measured geometry is re-derived on
every `evaluate`/`renderFrame` in the new `dimensions` module, so moving
referenced points or curve centers recomputes results; `evaluate` reports each
dimension's `status` (`linked`/`orphaned`) plus `measured` (`value` in world
units or degrees, `null` only for a degenerate angular anchor, and bounded
world-space stroke lines: extension lines, dimension line, open chevron
arrowheads, angle rays and a <=24-segment arc polyline). Writes require every
reference to resolve, but point/circle/arc deletions deliberately do NOT
reject on dimension references — the dimension becomes `orphaned` with
`measured:null` and no rendered strokes while authored refs stay for
re-linking (a documented divergence from constraint references, which block
deletion); style-only updates on orphans stay allowed while any
kind/points/entity/axis change must resolve again. References resolving to
the wrong identity kind are malformed and fail validation; absent ids are
legal orphans. Dimensions honor `visible`/layer visibility, reject edits on
locked layers/entities, block `removeLayer` while referenced, join
undo/redo, stay out of `order`/snaps/`findProfiles`/`point_fixed`/the solver,
and force the existing strict `{kind:"draft",schema:2}` wrapper — no schema:3
because the field is an additive serde default and `deny_unknown_fields`
fails old readers closed (same argument as layers/hatches). There is no glyph
backend, so numeric labels and filled arrowheads are deferred (same gate as
Quill fonts); dimension strokes composite above entity strokes as real Prism
paths within the same projection budgets. Arrowhead legs are schematic
overshoot, not authored geometry: a chevron leg that would exceed the ±1e6
world budget is omitted independently rather than failing
`evaluate`/`renderFrame` (the dimension/extension lines themselves derive
from authored in-bounds points and still error if they ever exceed it; a
lopsided chevron at the boundary is accepted clipping). The angular arc
polyline is likewise schematic: it is sampled provisionally and emitted
together with its two arc arrowheads only when every vertex stays inside
the ±1e6 budget — a single overshooting vertex drops the whole arc while
the authored rays still draw — and it runs arc-start to arc-end through
the per-15-degree samples (an earlier revision emitted a spurious
vertex-to-first-sample stroke instead). Orphan re-linking matches references
by raw id identity: monotonic in-session id allocation prevents reuse through
normal ops, but a crafted snapshot with a regressed `next_id` could re-link an
orphan to new geometry (trusted-snapshot caveat). `diameter`/`radial` on an
arc report the underlying circle's radius/diameter and draw the chord at
`start_deg`; for small arcs the chord may not touch the arc itself (documented
semantics, not a bug).

Local evidence: `cargo test -p draft-engine` 41 passed (8 dimension
tests), `cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/draft test` 11 passed across 5 files (1 nf-cli
dimension e2e), `pnpm --filter @nitro-forge/draft typecheck` clean. Dimension
text, offsets, filled arrowheads, ordinate/projection kinds, dimension
stylesheets and UI adoption remain deferred; native acceptance and full P17
completion are not implied.

## Draft command grammar slice A8 (2026-11-07)

Draft's bounded `executeCommand` grammar gains the drafting command set on
top of the existing POINT/LINE/CIRCLE/ARC/SEGMENT/MOVE/DELETE/SOLVE/SNAP
surface: `LAYER NEW name`, `LAYER RENAME id name`, `LAYER VISIBLE id flag`,
`LAYER LOCK id flag`, `LAYER DELETE id`; `HATCH pattern id [id ...]`
(1..6 boundary entity ids traced through the A4 `boundary_ids` path);
`DIM LINEAR a b x|y`, `DIM ALIGNED a b`, `DIM ANGULAR vertex first second`,
`DIM RADIAL entity`, `DIM DIAMETER entity` wired to the A3 associative
dimension model; and `DELETE` extended to `HATCH`, `DIMENSION` and `LAYER`.
Every new form re-enters the same typed op (`addLayer`/`updateLayer`/
`removeLayer`, `addHatch`, `addDimension`, `removeHatch`/`removeDimension`/
`removeLayer`), so locks, reference resolution, budgets, atomicity and the
single journal entry per command are identical to typed calls — verified by
tests asserting one-undo restoration. Parser bounds are unchanged (4096
ASCII bytes, 1..8 tokens of at most64 bytes, case-insensitive keywords,
finite numbers, safe integer ids); flags accept on/off/true/false/yes/no/1/0,
HATCH patterns are restricted to the four built-ins before dispatch, and
DIM axes to x/y. Honest gaps, documented in `docs/ENGINE_OPS.md`: no
current-layer or entity-to-layer assignment in the grammar (typed ops keep
the `layer` field), HATCH has no explicit coordinate-loop form (typed
`addHatch` keeps `loops`), DIM takes authored ids rather than interactive
point picking, and `BLOCK` rejects as unsupported until the deferred A9
blocks slice. `DRAFT_COMMAND_COMPLETIONS` lists all new forms. No schema or
snapshot change: commands are behavior, not state.

Local evidence: `cargo test -p draft-engine` 42 passed (1 new grammar test
covering the full LAYER/HATCH/DIM/DELETE lifecycle, single-undo entries,
case-insensitivity and 16 hostile-input rejections), `cargo build -p
nf-cli` clean, `pnpm --filter @nitro-forge/draft test` 12 passed across 5
files (1 new nf-cli grammar e2e), `pnpm --filter @nitro-forge/draft
typecheck` clean. UI adoption, native acceptance and full P17 completion are
not implied.

## Draft paper space slice A7 (2026-11-07)

Draft gains bounded paper-space state per the Track-A backlog (`sheets`/
`viewports` model + ops; `renderFrame{sheet_id}`; print stays host-side).
`sheets` (at most32) are named page setups in fixed millimetres regardless
of document `units`: `width`/`height` 50..2000 mm with unique 1..512-byte
names, four margins (default 10 mm, must leave a positive printable area);
orientation is derived, never stored. `viewports` (at most64) are
paper-space rectangles fully contained in their sheet (sheet-mm coordinates,
bottom-left origin, +y up) carrying a model window: `center_x`/`center_y`
world point at the viewport center and `scale` as paper mm per world unit
(1e-6..1e3), plus `visible`/`locked` honored like entities. Ops
`addSheet`/`updateSheet`/`removeSheet`/`addViewport`/`updateViewport`/
`removeViewport` follow the layer-op patterns: atomic apply, single journal
entries, `removeSheet` rejects nonempty sheets, locked viewports reject all
fields except `id`/`locked`, and final `validate` rejects dangling sheet
references, duplicate names, bad sizes/margins and out-of-sheet rectangles
on mutation and hostile restore. `renderFrame` gains the mutually exclusive
`{sheet_id,dpi?}` form (dpi default 96, admitted 24..600): it rasterizes an
opaque white paper field at the sheet's pixel size, draws margin/viewport
borders as fixed 0.25 mm chrome, and composites each visible viewport's
model window — the full hatch/entity/dimension scene honoring
`visible`/layer visibility — from an offscreen Prism scene sized to the
viewport's pixel rectangle. The raster boundary is the honest clip (Prism
has no vector path-clip); nothing outside the window is rasterized and no
clip is faked. Sub-pixel viewports draw nothing; oversized pixel budgets
reject the read. Deferred and documented: paper-space entities, title
blocks/sheet templates, active-sheet selection, viewport rotation/tint,
non-uniform scale, plot styles, print/export (`printReady` stays false
host-side). Snapshot compat is presence-triggered: any sheet/viewport
forces the existing strict `{kind:"draft",schema:2}` wrapper; inner state
stays schema:1 and legacy bare snapshots restore byte-identically.
`describe`/`evaluate` expose the new maps; the command grammar is unchanged
(typed ops only). `DraftDocument` gains `addSheet`/`updateSheet`/
`removeSheet`/`addViewport`/`updateViewport`/`removeViewport`/`renderSheet`.

Local evidence: `cargo test -p draft-engine` 45 passed (3 new paper-space
tests covering CRUD/validation/locks/single-entry undo, real clipped sheet
pixels including hidden-viewport and payload-honesty rejections, and
wrapper/hostile-restore cases), `cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter @nitro-forge/draft
test` 13 passed across 6 files (1 new nf-cli paper-space e2e),
`pnpm --filter @nitro-forge/draft typecheck` clean. UI adoption, native
acceptance and full P17 completion are not implied.

## Draft blocks/instances slice A9 (2026-11-07)

Draft gains bounded named block definitions and block-reference inserts per
the Track-A backlog scope decision. `blocks` (at most32) are `{name,
base_x,base_y}` definitions — names unique, base is the definition-space
insertion origin; membership lives on members (`block` on
segments/circles/arcs, `parent` on inserts), never on the block, so no
member list can dangle and `removeBlock` rejects while referenced (entity
membership, insert target or insert parent). `inserts` (at most32) carry
`{block,parent?,x,y,scale,rotation_deg,visible,locked,layer?}`: the target
block's base point lands at `(x,y)` under a uniform positive similarity
transform (`scale` 1e-6..1e3, `rotation_deg` ±360000); `parent != 0` nests
the insert inside another definition's local space and transforms compose
as similarities. Block members are definition geometry: they keep their
points/order/editability and solver visibility but never draw, snap or
trace `findProfiles` directly — only materialized instances do, honoring
each member's and each insert level's `visible`/`layer`/style (stroke width
scales by accumulated scale, arc start rotates, sweep preserved). Ops
`addBlock`/`updateBlock`/`removeBlock`/`addInsert`/`updateInsert`/
`removeInsert` follow the layer/viewport patterns: atomic apply, single
journal entries, locked/locked-layer rejection, `removeLayer` counts insert
layers. Nesting is bounded honestly: `check_graph` rejects cyclic block
graphs and chains deeper than 8 at validation on every mutation and hostile
restore; `expand` materializes at most1024 leaf primitives and validation
runs the identical expansion so over-budget writes reject atomically.
Snaps cover transformed endpoints/midpoints/projections/intersections/
centers/nearest_circle/tangents with sources = sorted [root insert, member
entity]; `renderFrame` draws instances after the ordered entity pass before
dimensions. The command grammar gains `BLOCK NEW name`, `BLOCK DELETE id`,
`INSERT blockId x y [scale] [rotationDeg]` and `DELETE BLOCK|INSERT id`;
membership/base/rename stay on typed ops. Deferred and documented: block
attributes, dynamic blocks, xrefs, non-uniform/negative scale, explode,
`findProfiles` through instances, dimension/hatch/constraint membership,
text glyphs. Snapshot compat stays presence-triggered: any block/insert
forces the existing strict `{kind:"draft",schema:2}` wrapper; inner state
stays schema:1 and legacy bare snapshots restore byte-identically.
`describe`/`evaluate` expose the new maps; `DraftDocument` gains
`addBlock`/`updateBlock`/`removeBlock`/`addInsert`/`updateInsert`/
`removeInsert` and entity ops accept `block`.

Local evidence: `cargo test -p draft-engine` 49 passed (3 new block tests
covering transforms/snaps/real pixels/single-undo, nested composition,
self+two-block cycles, depth-9 and expansion-budget rejection, hidden
subtrees, locks, grammar routing, wrapper roundtrip and hostile restores),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/draft test` 14 passed across 7 files (1 new
nf-cli blocks e2e), `pnpm --filter @nitro-forge/draft typecheck` clean.
UI adoption, native acceptance and full P17 completion are not implied.

## Draft nonlinear constraints slice A5 (2026-11-07)

Draft's `solve` op gains the bounded nonlinear constraint stage from the
Track-A backlog, completing the last Draft Track-A slice. Nine new
`Definition` kinds are admitted and atomically validated like the linear
kinds: `distance` (unsigned point-to-point), `angle` (unsigned vertex
angle in degrees), `perpendicular`/`parallel`/`equal` (segment pairs),
`radius` (circle/arc), `concentric` (two curves), `midpoint`
(point-on-segment-midpoint) and `tangent` (segment-curve or
curve-curve, `internal` for internal circle tangency; arcs participate
through their carrier circle). The Gaussian-elimination linear stage is
untouched and still runs first; the new pass is a deterministic
Levenberg-Marquardt/Gauss-Newton iteration over free point coordinates
and curve radii — central-difference Jacobian with noise-floor
truncation, dense normal equations, Marquardt damping with an
absolute-scaled floor, per-component trust region and positive-radius
enforcement. Hard budgets bound every run: 48 outer iterations, 8 damping
retries, 256 variables (64 points × 2 coordinates + up to 128 curve
radii), 512 residual rows and 33554432 shared work
operations; no randomness and no wall-clock dependence. `solve` runs on
`apply_long`, so batch routing and `TaskContext` cancellation/progress
reach the iteration loop. Only a fully converged result whose point
coordinates and circle/arc radius+extent also land inside the
world/entity bounds publishes point/radius updates (one journal entry,
one `document:changed`); a no-op solve stays eventless, and
`unconverged`/singular/cancelled/over-budget/out-of-bounds outcomes
publish nothing — geometry, history and redo are untouched exactly like
an inconsistent linear solve, and the solve is atomic across both stages
so a failed nonlinear outcome does not commit the linear stage's point
updates either. The report merges
both stages: top-level `status` gains `unconverged` plus a `nonlinear`
sub-report `{status,iterations,residual,unsatisfied_constraints}`;
`rank`/`dof`/`scope` keep describing the linear matrix. Nonlinear
constraint presence (enabled or not) triggers the existing strict
`{kind:"draft",schema:2}` snapshot wrapper so old readers fail closed;
inner state stays schema:1 and legacy-only documents serialize
byte-identically. `ConstraintDefinition`/`SolveReport` in
`@nitro-forge/draft` expose the new kinds and report shape.
Deferred and documented: expression/driving-dimension fields (v1 admits
typed kinds only), arc-aware tangent points, oriented/supplementary
angle semantics, ellipse/spline entities, redundant-constraint
certification, constraint priorities/groups, and any claim of
general-CAD solving.

Local evidence: `cargo test -p draft-engine` 59 passed (10 new nonlinear
tests covering every admitted kind, real geometry movement, merged
report shape, locked/fixed participants, atomic rejection,
contradictory-system unconverged publication safety including the
mixed linear+nonlinear atomicity regression, converged-but-out-of-bounds
radius reporting `unconverged` instead of a publish error, work-budget
exhaustion reporting `unconverged` rather than an op error, apply_long
cancellation and in-batch solve, undo/redo, snapshot roundtrip and
hostile restore), `cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/draft test` 17 passed across 8 files (1 new nf-cli
nonlinear-constraints e2e file, 3 tests), `pnpm --filter
@nitro-forge/draft typecheck` clean. UI adoption, native acceptance and
full P17 completion are not implied.

## P16 design comment threads/pins slice G checkpoint (2026-11-08)

Design gains engine-owned comment threads as durable document state under
`comments:{threads}` — the P16 slice-G backlog item and the L-14
`CommentPins`/`CommentsThreadPanel` contract (read from the NYC-Tron
`codex/complete-all-components` source; the installed alpha.4 pin still
lacks `forge/design`). A thread is `{id,anchor:{x,y},body,author?,
time_label?,resolved?,replies?}`: the anchor is a document-space point in
document units — the engine mapping of the contract's viewport pin
coordinates, which the host converts — matching the L-14 `{threadId,x,y}`
pin shape. Pins are deliberately canvas positions, not node attachments:
the contract carries no node/frame anchor, so layout changes never move a
pin and `removeNode`/`reparentNode` need no cascade or remap (documented
choice; node-following pins would need quill-style `{block,offset}` remap
machinery and stay deferred). `author`/`time_label` are optional
host-supplied display strings stored verbatim — the engine keeps no clock
and no authorship identity. Replies are append-only `CommentEntry`
records (`reply-N` ids unique per thread, ≤1024 per thread); there is no
per-reply edit or delete, matching the panel's action surface
(reply/resolve/delete only).

New ops: `defineCommentThread` (`id` optional → `comment-N`, ≤1024
threads), `addCommentReply` (→ `{id}`), `setCommentResolved` (durable
flag, equal writes silent), `removeCommentThread` (thread + replies in one
journal entry), and the `listComments` read (silent, returns stored
threads; the engine stores no `page` — hosts map the single canvas to the
panel's page 0, and `resolved:false`/empty fields are omitted on the wire).
Bounds mirror the panel roster guard: ≤1024 threads, ≤1024 replies per
thread, body ≤64KiB UTF-8 admitting only `\n`/`\t` control chars, ids ≤256
bytes, author/time_label ≤256 bytes, anchor finite within ±1e6 document
units; whole-document `validate_comments` enforces all of it on mutation
and hostile restore. Snapshot schema stays 2 via the presence-triggered
wrapper: any thread emits `{kind:"design",schema:2,document}` and
unwrapped state carrying `comments` rejects on restore; removing the last
thread returns snapshots to bare schema:1. Presence stays out —
collaboration-server transport only per the P16 placement decision; no
real-time collaboration, notifications or mentions are implemented.

Local evidence: `cargo test -p design-engine` 47 passed (3 new comment
tests covering CRUD/reply/resolve/list, journaled undo/redo, silent
reads, schema:1↔2 wrapper transitions, atomic rejection, the 1024-thread
cap and hostile restore of duplicate ids, out-of-bounds anchors and
oversized bodies), `cargo build -p nf-cli` clean,
`pnpm --filter @nitro-forge/design test` 16 passed across 12 files (1 new
nf-cli live test, 1 new payload-contract test),
`pnpm --filter @nitro-forge/design typecheck` clean. Node-anchored pins
with layout remap, per-reply editing/deletion, mentions, notifications,
presence transport and UI wiring remain deferred; no full P16 completion
is implied.

## P16 design handoff + export contract slice F checkpoint (2026-11-08)

`describeHandoff` and `exportSlice` land the L-12 dev-handoff storage scope
and the L-15 screen/frame membership scope as pure deterministic reads —
eventless, ungated, non-mutating, no journal entries. `describeHandoff`
projects evaluated layout measurements (same variables→expansion→layout
pipeline as `evaluateLayout`, capped at 8192 boxes with a `truncated` flag),
stored-node structure in DFS order, bounded typography (content preview
≤256 UTF-8 bytes plus exact byte length/truncation flag), prototype screen
membership with evaluated boxes, an always-empty `assets` list (no image or
asset nodes are admitted), and ≤512 deterministic per-node structural
hints — "code hints" describing stored state, not generated code. A new
engine-side `state_revision` u64 (the draft `source_revision` precedent)
advances on every committed state change — mutations, batch commits,
`restore`, `undo`, `redo` — is never serialized into snapshots (hostile
restores cannot choose it), does not advance on net-unchanged ops, and is
exposed on both reads as a host staleness hint. `exportSlice {node,scale?}`
requires a stored frame/component node (every registered prototype screen
qualifies), renders its expanded subtree through the same Prism flatten
path as `renderFrame` translated to the slice's evaluated origin, and
returns raw RGBA8 (`pixels_b64`/binary sidecar duality) plus a JSON
manifest of slice-relative node entries capped at 4096 with
`nodes_total`/`nodes_truncated` — the raster is never truncated. Optional
`scale` is bounded to 0.25..=4 (default 1) with the scaled pixel count held
to the 1,048,576-pixel design output budget. Honest deferrals documented in
`docs/ENGINE_OPS.md`: no PNG/SVG/vector encoder, no real code generation,
no asset store, export formats/presets/multi-slice batching host-side,
presence transport-only. No schema or snapshot change.

Local evidence: `cargo test -p design-engine` 50 passed (5 new tests:
handoff determinism/bounds/eventlessness/revision tags, revision advance
across mutation/batch/undo/redo/restore, slice RGBA+manifest/subtree scope/
scale/binary sidecar, atomic rejections and pixel budget, component+
instance+variable coverage, oversized-member clipping/culling),
`cargo build -p nf-cli` clean,
`pnpm --filter @nitro-forge/design test` 16 passed across 12 files (1 new
nf-cli live test, 1 new payload-contract test), `pnpm --filter
@nitro-forge/design typecheck` clean. UI wiring, native acceptance and full
P16 completion are not implied.

Review fixes on `codex/w1-design-handoff` (same branch): `exportSlice` now
translates/scales member boxes into slice pixels and culls boxes that cannot
cover a canvas pixel before they reach Prism; intersecting rect members
whose scaled bounds exceed Prism's 1e7 coordinate bound are clamped to their
canvas intersection (pixel-identical), canvas-covering oversized ellipses
rasterize as an equivalent canvas rect, and partially visible oversized
ellipses reject honestly with a coordinate-budget error instead of failing
inside Prism validation. `docs/ENGINE_OPS.md` now documents that in-batch
`describeHandoff`/`exportSlice` reads report per-step speculative
`state_revision` values (the batch still commits as a single +1), that
`describeHandoff` accepts and ignores its payload like `evaluateLayout`,
and corrects synthetic expansion ids to `>= 2^53` (first clone is
`SAFE_ID + 1`). `undo`/`redo` check the journal before spending a revision
so an empty stack returns `Ok(false)` even at revision exhaustion.
Evidence rerun after fixes: `cargo test -p design-engine` 50 passed,
`cargo build -p nf-cli` clean, `pnpm --filter @nitro-forge/design test`
16 passed across 12 files, `pnpm --filter @nitro-forge/design typecheck`
clean.

## P11 Motion slice I value node graph source checkpoint (2026-11-08)

Motion gains the admitted slice-I spec
(`docs/completion/reports/P11-motion-nodegraph-spec.md`): `State.graph`, a
document-global scalar f64 DAG plus `(layer,property)` bindings, behind the
single full-replacement `setGraph` op (`{nodes?,bindings?}` or `null`).
Closed 48-kind enum — sources `const`/`time`/`frame`/`fps`/`duration`/
`property`, unary/binary math, comparisons, `clamp`/`lerp`/`smoothstep`/
`select` — with exact per-kind input pins valued as `{"node":id}` or
`{"const":f64}`; caps ≤512 nodes/≤2048 edges/≤128 bindings inside the 16
MiB state cap; `schema` stays 2 via additive serde defaults and
graph-free documents serialize byte-identically (a cleared graph keeps its
`next_node_id`). Bindings are mutually exclusive with curves AND
expressions on the same cell — `setGraph` clears conflicts in its journal
entry while `setPropertyKeys`/`setExpression`/`setMotionPath` null/
`setLayer3D` null drop conflicting bindings symmetrically, all atomic
through undo/redo/batch; locked-layer bindings reject. `property` sources
read pre-binding curve/base values in the referenced layer's own comp
context (expressions excluded), keeping the graph acyclic by construction;
`time`-family sources evaluate per consuming comp's local time. Evaluation
is iterative end to end: Kahn topo-sort (ascending-id ties) plus a flat
per-comp memoized pass — no recursion whose depth scales with document
content — with a defensive 4096-op counter saturating to 0.0. `validate`/
restore re-check structure, caps, edge targets, acyclicity, binding
referential integrity and exclusivity; `removeLayer`/`removeComposition`
of referenced layers reject atomically, `reparentLayer` stays valid and
`duplicateComposition` inherits bindings under fresh layer ids. TS gains
`MotionGraph*` types, `graph?` on `MotionState` and `setGraph`.

Local evidence: `cargo test -p motion-engine` 97 passed (11 new covering
the kind/pin/param/edge/cap rejection matrix with snapshot-atomicity,
write+hostile-restore cycle rejection, topo determinism under reordered
insertion, pre-binding property reads incl. curve-fed and cross-binding
cases, exclusivity clears in both directions, per-comp time-family eval
incl. nested-comp scaling, non-finite sanitize/clamp, seek determinism,
undo/redo/equal-write/batch atomicity, duplicate/remove/reparent binding
semantics, hostile-restore matrix and graph-free byte-identity),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/motion test` 11 passed across 10 files (1 new
nf-cli graph case), `pnpm --filter @nitro-forge/motion typecheck` clean.
No pixel compositing, multi-type nodes, expression↔graph cross-references
or node UI is claimed; full P11 completion is not implied.

## P11 Motion slice H media/footage references (schema only) source checkpoint (2026-11-08)

Motion layers gain `kind:"media"` carrying an optional `media`
`{source_id,in_point}` reference — durable model and ops only, **no
pixels**. `source_id` is an opaque host-owned reference (non-empty, <=512
UTF-8 bytes, no control characters) the engine stores and round-trips
without lookup or decode; `in_point` is stored source seconds
(0..=604800, default 0) that nothing consumes yet. Real frame transport
is blocked on the P03 decoder contract; the backlog's per-call
`{layer_id,rgba}` sidecar transport remains the recommended design.
`addMediaLayer` creates the kind (media spec optional, the
`addParticlesLayer` precedent) and `setLayerMedia` attaches/replaces/clears
the spec (null clears to an empty media layer); `updateLayer` cannot patch
`media`. Media layers compose like every other kind minus content —
transform/opacity/curves/blend/clipping/mattes/transform-parents/effects
and nested compositions all apply — while `source_id`s are not raster
assets (`removeRasterAsset` neither sees nor protects them).
**Render behavior is honest transparency:** `renderFrame` stages a 1x1
fully transparent raster per media layer so it keeps its stack slot
(clipping runs, matte-source masks, sibling compositing) while
contributing zero pixels at every `time_s`; effects cannot invent alpha
and no checkerboard/placeholder/duration-derived frame selection is
faked. `in_point` does not affect `evaluate` or `renderFrame`. Snapshot
schema stays 2 via additive serde defaults; old readers fail closed
(`media` is unknown under `Layer`'s `deny_unknown_fields`, `kind:"media"`
fails the strict `LayerKind` enum) — the same accepted cost as prior
slices.

Local evidence: `cargo test -p motion-engine` 76 passed (5 new covering
add/set/clear round-trip, byte-transparent render with sibling compositing
and effect non-invention, parent/blend/curve/matte-source/nested-comp
composition, source_id/in_point/unknown-field bounds, kind exclusivity,
locked rejection, five hostile-restore mutations, undo/redo, equal-write
eventless and snapshot schema:2 round-trip), `cargo build -p nf-cli`
clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/motion test` 10 passed across 9 files (1 new
nf-cli media case), `pnpm --filter @nitro-forge/motion typecheck` clean.
Footage decode, frame transport, speed/trim/remap, media UI and full P11
completion are not implied.

## P11 Motion slice J1 durable render queue source checkpoint (2026-11-08)

Motion gains a durable `render_queue` of bounded jobs (`{id,name?,comp_id?,
from_frame,to_frame,status,frames_done}`) with ops `addRenderJob`,
`setRenderQueueOrder` (exact permutation), `cancelRenderJob`,
`removeRenderJob` and `renderQueueFrame`. Jobs are inclusive 0-based frame
ranges rendered at the target composition's own rational frame rate —
`comp_id` absent is the root, a nested id renders that composition
standalone. Bounds: 256 jobs, 4096 frames/job, 16384 summed frames; pending
jobs must keep their last frame inside the composition's current
duration/rate, so `setComposition` changes that would strand one reject
atomically while done/cancelled history never constrains.
`removeComposition` rejects while any job references the comp. Statuses are
`pending|done|cancelled` — no persisted `rendering` state exists because
stepping renders and commits inside one atomic `apply`; `renderQueueFrame`
returns the real `render_comp` RGBA (byte-identical to `renderFrame` at the
mapped time, verified in tests) plus exact integer progress
(`frames_done`/`frames_total`/queue counters — never percentages) through
the same `pixels_b64`/binary-output contract. Stepping is journaled like
every mutation: queue progress is durable document state, so undo rewinds
real frames (16-entry journal bounds reach) and restore resets history.
Snapshot schema stays 2 via additive serde defaults (`render_queue` skipped
when empty, `next_job_id` skipped at 1); `describe` materializes both.
Hostile restores re-check job ids, ranges, progress/status consistency,
comp refs, name length and all budgets. **No encoder exists**: the queue
returns raw RGBA frames only and never claims encoded output — J2 remains
blocked. Time-range jobs and stepped ranges are deferred.

Local evidence: `cargo test -p motion-engine` 81 passed (10 new covering
enqueue/reorder/cancel/remove, real-pixel stepping identical to
`renderFrame`, named-job stepping, queue summaries, comp-job standalone
render, comp-removal guard, undo/redo/snapshot/hostile-restore, all bounds,
`setComposition` stranding rules, atomic batches and cancelled tasks),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/motion test` 11 passed across 9 files (2 new
nf-cli queue cases), `pnpm --filter @nitro-forge/motion typecheck` clean.
Encoded export, render-queue UI, native target runs and full P11
completion are not implied.

## P12 Quill mail merge checkpoint (2026-11-08, `codex/w6-quill-mailmerge`)

Quill gains mail merge, completing the P12 slice-8 triad after
footnotes/endnotes and TOC fields. Model decision — fields are plain
text, not stored state: a merge field is the literal token `{{name}}`
inside block inline text (the Word MERGEFIELD-as-field-code model), so
there is no field collection and **no snapshot/schema change** —
`listMergeFields` is a live scan like `listToc`, fields move/split/delete
with ordinary text edits for free, and tokens may span inline-run
boundaries inside one block but never block/cell-paragraph/table-
serialization boundaries. Grammar: `{{` + first `}}`, inner trimmed,
name 1..=64 chars without braces or control characters (interior
spaces allowed); invalid or unterminated spans are literal text.
`previewMerge {records}` is the read-only multi-record text preview
(≤1024 records of `{field:value}` objects — values single-line ≤8192
chars, ≤256 fields per record, canonical trimmed keys; the engine is
I/O-free so hosts parse CSV/DB sources and pass rows in), reporting
`{index,text,missing}` per record over the `text`-op serialization plus
the shared field census. `runMerge {record,from?,to?}` is the mutating
single-record fill: optional `Pos` range (default whole document,
`findText`/`replaceText` per-block clipping and table coverage rules),
staged-clone substitution with first-scalar style inheritance and
in-cell rewriting, per-block `(start,end,repl_len)` re-anchoring of
bookmarks/comments/revisions/footnotes, staged `lists`/`tables`/`toc`
validation, and one whole-document undo entry — zero tokens or a
verbatim reproduction is eventless. Missing fields merge as `""` and
report in `missing`; unused record keys are ignored; merge is
single-pass (values never rescanned). Deferred honestly: CSV/DB source
parsing/persistence, conditional fields, multi-paragraph or styled
values, per-record output documents (hosts open one handle per record),
and DOCX `w:fldSimple`/`MERGEFIELD` interop.

Local evidence: `cargo test -p quill-engine` 227 passed on the merged
tree with citations/bibliography (9 new merge tests covering token
grammar edge cases, census order/counts, preview text/missing/
validation, runMerge substitution/undo/redo, ranges and eventless
paths, style inheritance and anchor remapping, table-cell coverage,
multi-block preview), `cargo build -p nf-cli` clean,
`pnpm install --prefer-offline` clean, `pnpm --filter
@nitro-forge/quill test` 50 passed across 8 files (5 nf-cli
mail-merge cases), `pnpm --filter @nitro-forge/quill typecheck`
clean. No native/device acceptance or full P12 completion is implied.

## P12 Quill citations/bibliography slice 8 checkpoint (2026-11-08)

Quill gains citations and bibliography fields (P12 slice 8, third half),
the last engine slice on this branch. New ops:
`addSource`/`updateSource`/`removeSource`/`listSources`,
`addCitation`/`updateCitation`/`removeCitation`/`listCitations`, and
`insertBibliography`/`updateBibliography`/`refreshBibliography`/
`listBibliography`. Model decisions, mirroring footnotes + TOC: a
`CitationSource` document-level record (`{id,author,title,year?,
container?,volume?,issue?,pages?,doi?,url?,note?}`; author/title
required ≤512 chars, optional fields raw strings never parsed) lives in
the schema:3 wrapper's `deny_unknown_fields` document as an optional key
alongside `footnotes` — no schema bump. A `Citation` is `{id,at,source,
locator?}` with `at` a single live `{block,offset}` position carrying
bookmark right gravity through every position-moving op
(`insertText`/`deleteRange`/`splitBlock`/`mergeBlock`/`insertBlock`/
`insertTable`/`deleteTable`/`replaceRange`/`replaceText`/`changeCase`/
revision decisions); a delete covering the anchor clamps to the deletion
start rather than dropping the citation, anchors can never sit on
table/toc/bibliography field blocks (ops and restore reject, the same
Pos-unreachable precedent), `source` must resolve on every mutation and
at restore, `listCitations` resolves 1-based `number` in document order
(engine stores none), and `removeSource` cascades its citing citations
in one undo entry. A bibliography is a `kind:"bibliography"` field block
carrying `{sort:"alpha"|"citation",entries:[{source,text}]}` — cached
Word-field-style lines in one deterministic format (no CSL, no style
selection) that go stale on source/citation edits while `listBibliography`
is the always-live cited-source scan honoring a named field's sort;
field-block hygiene, `Pos`-op rejection, list-op range rejection,
`setBlockKind` payload-drop removal, and `exportDocx` rejection all
match the toc-field contract. Bounds: ≤1024 sources, ≤2048 citations,
≤64 fields, locator ≤128 chars; ids unique tokens engine-assigned
`src-N`/`cit-N`. Restore strictly validates counts, uniqueness,
referential integrity, bounds, anchors, and field invariants before
replacing state; `new`/`importDocx` reset both collections.

Deferred honestly: CSL style processors and bibliography style
selection, DOI/URL resolution or fetching, Word `CITATION`/
`BIBLIOGRAPHY` field-code interop, rendered "[n]" marks in the block
stream (citations are anchors + data — hosts render), multi-line/
hanging-indent entry layout, bibliography fields inside table cells,
and consumer anchor→geometry mapping. Mail merge has since landed on
the same tree (`codex/w6-quill-mailmerge`, merged after this slice).

Local evidence: `cargo test -p quill-engine` 227 passed 0 failed on the
merged tree with mail merge (7 new citation tests covering
source/citation CRUD + numbering, validation and referential
integrity, field-block anchor rejection and remap, bibliography
scan/sort/refresh and guards, delete-range/cover/undo, snapshot
round-trip + hostile restore, batch/new/import/redo),
`cargo build -p nf-cli` clean, `pnpm install --prefer-offline` clean,
`pnpm --filter @nitro-forge/quill test` 50 passed across 8 files (1
nf-cli citations e2e), `pnpm --filter @nitro-forge/quill typecheck`
clean. No native/device acceptance or full P12–P14 completion is
implied.

## P16 design constraint solver checkpoint (2026-11-08)

Design constraints are now enforced, not just stored. `layout::evaluate`
gains a derived solve pass inside absolute placement: each absolute
parent's constrained children solve in one deterministic topological pass
over sibling `relative_to` dependencies (functional dep graph, cycle
members revert to baseline). Anchors pin FLUSH — left/right/center/stretch
and top/bottom/center/stretch land the child's edge/midpoint/span exactly
on the live reference box (parent frame or sibling's solved box); the
NYC-Tron `DesignConstraints` contract stores no inset margins, and a
margin measured against the live reference would drift with it, so flush
pinning is the only responsive honest semantics. C2 `min_*`/`max_*` bounds
clamp resolved extents and `aspect_locked` derives the ratio from the
unconstrained evaluated box (height-from-width unless only the vertical
axis stretches). Unsatisfied nodes — dependency cycles, bound/aspect
conflicts, non-positive solved extents — keep their unconstrained box and
are reported, never silently dropped or fatal to the read. `scale` anchors
stay rejected; grandparents/arbitrary `relative_to`, inset margins,
stored ratios and constraint-aware hug/fill measurement remain deferred
(hug/fill still measures pre-constraint geometry; frames do not clip).
Instance expansion retargets `constraints.relative_to` through the clone
id map and `detachInstance` remaps synthetic targets back to real ids.
`evaluateLayout` gains a `constraints` report block
(`{solving:"evaluateLayout",status,constrained,unsatisfied}`);
`readConstraints` reports `solving:"evaluateLayout"`, a live `solve`
summary (`solved`/`partial`/`unavailable` against the effective stored
state) and per-node `enforced`/`satisfied`. No schema change: solving is
derived, snapshots/undo untouched. x/y bindings resolve first, so
constraints anchor against binding-resolved geometry.

Local evidence: `cargo test -p design-engine` 54 passed (1 new solver
test covering resize response, center/stretch, bound conflict, aspect
lock, sibling tracking, dep cycles, nested frames and the evaluateLayout
report), `cargo build -p nf-cli` clean, `pnpm install --prefer-offline`
clean, `pnpm --filter @nitro-forge/design test` 19 passed across 15 files
(1 new nf-cli solver e2e, 2 updated contract tests),
`pnpm --filter @nitro-forge/design typecheck` clean. No native/device
acceptance or full P16 completion is implied.
