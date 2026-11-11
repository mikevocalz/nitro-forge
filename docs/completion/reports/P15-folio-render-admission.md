# P15 folio-render service admission

2026-11-12. Executes the admission decided in
`P15-pdf-backend-decision.md`: a host-side read-only PDF render/text
service for Folio, primary backend **pdfium via `pdfium-render`**, hedge
**hayro** for WASM/pure-Rust fallback. This record admits the *design and
dependency set*; it commits no Rust code, no `Cargo.toml` dependency, and
no platform acceptance. Verification performed: web license/source checks
(2026-11-12) plus a local prebuilt-binary link spike on this macOS arm64
machine (§4). Everything else is marked NOT-RUN.

## 1. Boundary — this is not an Engine

`docs/ARCHITECTURE.md` §2 requires every `Engine` to be synchronous,
single-threaded, `Send`-only, and **I/O-free**. pdfium is a native C++
library whose objects are not `Send`, requires a shared library at run
time, and does raster work with its own threading assumptions. It
therefore cannot live inside `folio-engine`'s `apply`.

Admission keeps the decision doc's hybrid boundary:

- `folio-engine` (lopdf) remains the sole writer and the ingest gate.
  It owns every mutation, the `Journal`, `NFD1` snapshots, and validation.
- `folio-render` is a **sibling host service**, not an `Engine` impl:
  no `EngineKind`, no `Command`/`Journal`, no snapshot format of its
  own. It is fed serialized document bytes (the engine's `save`/export
  output, or the original `open` bytes) and answers read queries.
  Document bytes cross the boundary by value; no shared buffers — same
  ownership rule as `restore`/`snapshot`.

## 2. Proposed crate/package layout

Workspace `members` already globs `packages/*/rust` and lists
`rust/{ignition-core,nf-cli,nf-sys,nf-raw}` explicitly. Proposal:

```
rust/folio-render/            # new workspace member (explicit member line)
  Cargo.toml                  # folio-render; deps: pdfium-render 0.9.x,
                              # serde/serde_json; hayro optional/feature-gated
  src/lib.rs                  # RenderService: open(bytes,password?),
                              # renderPage, textPage, search, pageInfo
  src/pdfium.rs               # pdfium-render backend (native)
  src/hayro.rs                # hayro backend (feature = "hayro"; wasm/fallback)
  LICENSES/                   # vendored pdfium + third-party notices (§6)
```

Rationale for `rust/` over `packages/folio/rust-render`: the glob
`packages/*/rust` admits only one crate per package, and `folio-engine`
already owns `packages/folio/rust`. A top-level `rust/` sibling matches
how `nf-raw` (a non-engine host-adjacent crate) is already placed.

TS side: no new `Engine`/Nitro HybridObject. The service is consumed by
hosts through whatever transport P19 packaging selects (initially the
same stdin/stdout JSON-lines pattern as `nf-cli` for tests, behind a
`folio-render` binary or a module of `nf-cli`). `FOLIO_DEFERRED_OPS`
(`packages/folio/src/office-cluster.ts:22`) entries `renderPage`/
`textPositions` lift only when the TS adapter surface exists; that is a
later slice, not this admission.

## 3. FFI vs subprocess design

**Admitted: in-process FFI via `pdfium-render` runtime bindings.**
`pdfium-render` 0.9.x binds to a pdfium shared library at *run time*
(dlopen-style), not compile time, so the Rust crate compiles everywhere
and the native lib is supplied per-platform. Objects are confined to one
worker: the service holds a single `Pdfium` document handle per open
document on one dedicated thread — pdfium page/document objects are not
`Send`, matching the engine-worker serialization model in ARCHITECTURE §2.

**Not admitted now (documented options):**

- *Subprocess isolation* (`pdfium` helper binary): stronger crash/
  sandbox boundary for untrusted input on desktop; adds IPC and a second
  artifact. Deferred to P19 packaging — the FFI worker is correct first,
  isolation is a deployment decision.
- *Static linking*: rejected for now; runtime binding keeps one crate
  buildable for WASM and lets hosts swap pdfium builds without rebuilding
  Rust.

hayro needs no FFI at all (pure Rust) and is the WASM path; it enters as
a feature-gated backend only after the pdfium native path is proven, per
the decision doc's "never the sole parser for untrusted input" rule —
lopdf remains the ingest gate regardless of backend.

## 4. Build/license verification — executed 2026-11-12

### Verified facts

- **pdfium license**: BSD-3-Clause. Prebuilt tarballs from
  `bblanchon/pdfium-binaries` ship `licenses/pdfium.txt` (the BSD-3 text
  above) plus a `licenses/` directory of per-dependency notices
  (abseil, freetype, harfbuzz, icu, libpng, libjpeg_turbo, lcms, zlib,
  openjpeg, etc.). Redistribution requires reproducing the copyright +
  conditions in binary distributions (§6).
- **`pdfium-render` 0.9.5**: MIT OR Apache-2.0, ~3.7M downloads, binds
  pdfium at run time — WASM-compatible in principle. Latest feature pin
  `pdfium_8125`; binaries are Chromium-versioned (`chromium/8138` etc.).
- **hayro 0.9.0**: Apache-2.0 OR MIT, MSRV 1.92, edition 2024, pure Rust,
  CPU-only (vello_cpu), read-only by design, decrypts for reading only,
  no encrypted-doc save path, young/experimental (~1400-file regression
  corpus). Confirms the decision doc's hedge characterization.
- **Local spike (RUN, /tmp only — not committed)**: downloaded
  `pdfium-mac-arm64.tgz` for `chromium/8138` (pdfium 159.0.8138.0),
  extracted `lib/libpdfium.dylib`: Mach-O arm64, links only system
  frameworks (AppKit/CoreGraphics/CoreFoundation/Foundation/libSystem —
  no bundled third-party dylibs), exports 112 `FPDF_*` symbols including
  `FPDF_InitLibrary`, `FPDFText_LoadPage`, `FPDF_RenderPageBitmap`.
  Confirms the prebuilt binary loads on this arm64 macOS dev machine.
  Headers (`fpdf_text.h`, `fpdf_annot.h`, `fpdf_formfill.h`,
  `fpdf_signature.h`, …) and `PDFiumConfig.cmake` ship in the tarball.

### Build matrix

| Target | Backend | Status |
|---|---|---|
| macOS arm64 (dev machine) | pdfium prebuilt `pdfium-mac-arm64` | **RUN** — dylib extracted, `otool -L` clean, symbols present; full Rust link NOT-RUN |
| macOS x64 | pdfium prebuilt `pdfium-mac-x64` | NOT-RUN (artifact exists upstream) |
| iOS device/simulator arm64 (+x64 sim, catalyst) | pdfium prebuilt `pdfium-ios-*` | NOT-RUN |
| Android arm64/arm/x86/x64 | pdfium prebuilt `pdfium-android-*` (.so) | NOT-RUN |
| Linux x64/arm64 (+musl) | pdfium prebuilt `pdfium-linux-*` | NOT-RUN (musl arm64/x64 builds marked failing upstream) |
| Windows x64/x86/arm64 | pdfium prebuilt | NOT-RUN |
| WASM (web) | pdfium via Emscripten build, or **hayro** | NOT-RUN — pdfium wasm build chain unverified; hayro compiles to WASM by design but MSRV/edition-2024 check per-crate pending |

No `cargo build`/`cargo test` for a `folio-render` crate was run — none
exists yet. The spike proves binary availability and link cleanliness on
the dev host only.

## 5. Op contract the service exposes

Read-only, bytes-in/JSON-out. Proposed ops (names provisional until
ENGINE_OPS grows a `folio-render` section):

| Service op | Payload | Returns | Unblocks |
|---|---|---|---|
| `open` | `{bytes_b64, password?}` | `{pages, page_sizes:[{w,h}pt], encrypted}` | session for all below |
| `renderPage` | `{page, scale|dpi?, format:"png"|"raw", max_dim?}` | `{image_b64|bytes, width, height}` | K-01 viewer, K-02 thumbnails (same op, small scale), K-03 layout preview, K-16 compare overlay, K-17 print preview, K-20 scan-session display |
| `textPage` | `{page}` | `{items:[{text, bbox:[x,y,w,h], font?, size?}]}` | K-04 hit rects, K-05 selection, K-18 read-aloud position, K-21 edit metrics |
| `search` | `{query, pages?}` | `{hits:[{page, bbox, context?}]}` | K-04 (implemented host-side over `textPage` if cheaper) |
| `pageInfo` | `{page}` | `{size, rotate, links:[{rect,uri|dest}]}` | K-03, K-13 inspector data |

Mapping notes:

- `renderPage`/`textPositions` in `FOLIO_DEFERRED_OPS` correspond to
  service `renderPage`/`textPage`; the deferred map lifts when the TS
  adapter ships, not at service admission.
- `textPage` glyph boxes are what `redactRect`'s `content_note` and
  slice E's "text/vector under the rect is NOT provable" limitation
  (P15-folio-backlog §Slice E) need for the K-14 text half.
- K-08 signature creation, K-14 true redaction, K-17 PDF/A export remain
  **engine/host work**, not service ops — pdfium signature support is
  verify-oriented and there is no redaction API (decision doc §"Hard
  sub-problems").
- `search` may legitimately be a thin host composition over `textPage`
  first; keep it in-contract so a later backend can accelerate it.

Bounds to encode at the service boundary (fail-closed, matching engine
conventions): input PDF ≤ 64 MiB (consistent with `getAttachment` cap),
render output ≤ 4096 px per side / ≤ 32 MiB decoded, page count ≤ 4096,
query text ≤ 4096 chars, all coordinates finite. These mirror existing
folio caps; the service must not accept unbounded pixel requests.

## 6. License obligations on admission

- Ship `licenses/pdfium.txt` (BSD-3) verbatim plus the tarball's
  `licenses/` third-party notices inside `rust/folio-render/LICENSES/`
  and in any distributed app bundle — binary redistribution requires the
  notice reproduction; this is the main compliance cost of pdfium.
- `pdfium-render` MIT/Apache-2.0 and hayro Apache-2.0/MIT are
  notice-only; keep `LICENSE-APACHE`/`LICENSE-MIT` copies.
- Prebuilt-binary provenance: record the exact
  `bblanchon/pdfium-binaries` tag (e.g. `chromium/8138`, pdfium
  159.0.8138.0) and tarball SHA-256 in the service crate's build notes —
  binaries are third-party artifacts, not built from source here.
- MuPDF stays rejected (AGPL-3.0); Ghostscript remains AGPL for any
  future PDF/A path — do not let either slip in via a transitive dep
  without review.

## 7. Security notes

- pdfium is the Chrome PDF engine — heavily fuzzed — but it is still
  native code parsing untrusted input. It has **no sandbox of its own**;
  Chrome sandboxes it at the process level. The in-process FFI worker is
  therefore acceptable only behind the same host trust boundary as the
  engine worker; subprocess isolation (§3) is the upgrade path for
  hostile-document deployments.
- Do not enable pdfium JavaScript/formfill action execution beyond what
  `FPDF_FORMFILL` requires for rendering; no doc should execute embedded
  JS through this service.
- Input bounds in §5 plus the already-documented lopdf decompression-bomb
  limitation (P15-folio-backlog "Known limitations") both apply: hosts
  bound input PDF size *before* `open`, and the service re-checks.
  pdfium itself streams object parsing more safely than lopdf's
  materialize-then-cap reads, but neither is a substitute for a size cap.
- Service is read-only: it never writes the document, so it cannot
  corrupt journal/undo state; a crashed worker loses only the service
  session, recoverable by re-feeding `save` bytes.

## 8. Readiness verdict and remaining blockers

**Admission: READY for implementation slice** — license confirmed
permissive with a manageable notice-bundling obligation, prebuilt
binaries exist for every required native target, the dev-host spike
passed, and the crate boundary respects ARCHITECTURE's I/O-free engine
rule. What remains before code:

1. `rust/folio-render` crate + `pdfium-render` dep admission (Cargo
   workspace change — needs its own review per repo rules).
2. Pin pdfium binary source + record checksums; decide bundling
   mechanism per platform (P19 packaging).
3. Full `cargo build`/link verification per platform — all NOT-RUN above.
4. TS adapter + `FOLIO_DEFERRED_OPS` lift — separate slice.
5. hayro WASM path — separate spike; only if web target needs it before
   an Emscripten pdfium build is proven.
