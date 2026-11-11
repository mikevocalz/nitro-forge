# P15 PDF backend decision

2026-11-07. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against `packages/folio/rust` and the
P15 exit criteria in `components.json` (K-01–K-21).

## Current state

`folio-engine` wraps a single `lopdf::Document` (lopdf 0.36). Ops cover
parse, annotations (text/highlight/underline/strike/geometry), replies,
review state, page rotate, save, info. `pageText` is a documented lossy
literal-string extractor — no renderer, glyph positions, real
selection/search, forms, signatures, redaction, encryption wiring,
compare, print, or scan.

Key finding: **lopdf 0.36 already implements PDF encryption/decryption**
(`Document::decrypt`, `Document::encrypt`, `EncryptionVersion` V1–V5/R5);
the engine just never calls it (`open` reports `encrypted:false`
unconditionally). Wiring this covers part of K-15/K-24 with no new deps.

## Candidates

| Backend | License | Render | Glyph positions | Mutations | Platforms |
|---|---|---|---|---|---|
| pdfium via `pdfium-render` 0.9.x | BSD-3/Apache-2.0 | Excellent (Chrome engine), CPU bitmap | Per-char bounds — yes | AcroForm read/fill; no annot creation; verify-oriented signatures; no redaction API | iOS/Android/macOS/Windows/Linux + WASM via pdfium-lib builds |
| hayro 0.9 | Apache-2.0/MIT | Good, improving; CPU-only | Partial via `Device` trait (`draw_glyph` + `Glyph::as_unicode`) | Read-only by design; decrypts for reading only | Pure Rust — all targets incl. WASM, zero FFI |
| MuPDF | **AGPL-3.0** or commercial | Excellent | Full | Full incl. redaction/signing | Rejected: AGPL contaminates distributed product |
| lopdf extensions | MIT (admitted) | None | No positions | Already owns annots; encryption unused | Already everywhere |
| Platform-native renderers | System | Divergent | Inconsistent (Android `PdfRenderer`: none) | N implementations | Rejected: no uniform glyph API, multiplies test matrix |

## Decision

**Hybrid architecture — rendering stays outside `Engine::apply`:**

- `folio-engine` (lopdf) remains the sole writer: annotations, forms
  values, encryption via `Document::encrypt`, redaction via
  content-stream/object removal, page ops, outlines. Journal/undo/NFD1
  unchanged.
- New `folio-render` read service (separate crate/module, host-side
  worker): owns serialized document bytes, serves `renderPage`→bitmap,
  `textPage`→positioned glyphs, `search`→hits. Fed by engine `save`
  bytes; stateless, single-worker (pdfium objects are not `Send`).
- Primary backend: **pdfium-render + pdfium-lib binaries** — one uniform
  API for raster + per-character bounds across all required platforms
  incl. WASM.
- Hedge: **hayro** for WASM/pure-Rust fallback and positioned-text
  cross-checks. Never the sole parser for untrusted input (young,
  experimental; lopdf remains the ingest gate).

## Hard sub-problems flagged

- **Redaction (K-14)**: no candidate offers true redaction; must remove
  content streams/images under geometry + scrub metadata in lopdf.
  Significant effort; pdfium hit-data can assist. Do not claim until
  saved artifacts verifiably lack the content.
- **Signatures (K-08)**: pdfium signature support is verify-oriented;
  creation likely needs host crypto or `x509-cert`/`cms` — unverified.
- **PDF/A export (K-17)**: no candidate; likely external (Ghostscript is
  AGPL; pdfcpu/verapdf alternatives unverified).
- **Encrypted-doc UX**: decide whether engine op or host prompt owns
  passwords; lopdf decrypt exists unwired.
- **hayro toolchain**: needs Rust ≥1.92/edition-2024 deps; workspace is
  edition 2021 — per-crate OK, verify CI.
- **WASM size**: pdfium-wasm ~4–8 MB vs hayro smaller; bundle-size
  decision deferred to web target work.
