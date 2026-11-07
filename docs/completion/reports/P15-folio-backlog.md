# P15 folio-engine backlog — in-engine ops vs host pdfium service

2026-11-11. Scoping record for dispatching folio slices. Backed by
`P15-pdf-backend-decision.md`, `components.json` (K-01–K-21),
`docs/ENGINE_OPS.md` §folio-engine, `packages/folio/rust/src/*`,
vendored lopdf-0.36.0 sources, and the P12–P14 backlog for style.
No slice below is marked complete; this is a work list, not acceptance.

## Checkout caveat

Folio needs **no versioned snapshot wrapper**: `SnapshotState` is
`{pdf_b64}` inside NFD1 — the whole `lopdf::Document` serializes in, so
new durable features persist/restore for free. Undo is a whole-Document
clone journal (cap 8). Only snapshot risk: encrypted docs —
`Document::load_mem` may fail on ciphertext without a password; decide
snapshot semantics when encryption merges.

## lopdf 0.36 capability map (verified against vendored source)

- Encryption: `encrypt`/`decrypt`/`is_encrypted`, V1/V2/V4/R5/V5,
  `Permissions` bitflags — landed on `codex/w1-folio-pdf-ops` (pending
  merge/review).
- AcroForm: no helper — hand-walk catalog `/AcroForm`→`/Fields`,
  `/FT`/`/T`/`/V`/`/Ff`, merged widget annots.
- Signatures: `/FT /Sig` + `/ByteRange`/`/SubFilter` inspection only; no
  CMS/PKCS#7 — read-only listing.
- Content streams: `Content::decode`/`encode` — enables surgery.
- Page images: `get_page_images` audit; PNG row decode exists.
- Outlines: `get_outlines`/`get_toc`/`Bookmark` read+write helpers.
- Annotations: Text/Highlight/Underline/StrikeOut/Square/Circle +
  comment trees already owned; extend subtypes freely.
- Rendering/glyph positions: **none** — host pdfium service only.

## Slice order (folio-engine only)

Each slice: op+payload in `docs/ENGINE_OPS.md` + Rust dispatch +
`OPS` in `packages/folio/src/index.ts` together; vitest e2e via nf-cli;
lift `FOLIO_DEFERRED_OPS` entries where applicable.

- **Slice A (small, parallel-safe):** F-1 ink annotations
  (`addInkAnnotation` `/InkList` paths, ≤64 paths/≤2048 points, lifts
  `inkAnnotation` defer) + F-2 link annotations (`addLinkAnnotation`
  `/A << /S /URI >>`).
- **Slice B:** F-3a page ops — `movePage`/`deletePage`(≥1 floor)/
  `duplicatePage`/`insertBlankPage`/`listPageInfo`; F-3b cross-doc
  extract/merge/split later (object renumbering).
- **Slice C:** F-4 outlines (`listOutlines`/`addBookmark`/`removeBookmark`,
  hand-built `/Outlines` dicts) → F-5 `listFormFields` (flattened
  name/FT/V/Ff + widget rect; ≤10k fields, cycle-safe) → F-6
  `fillFormField` (set `/V`, `/NeedAppearances true` honesty; checkbox/
  radio sub-slice; Sig fields reject).
- **Slice D:** F-7 `listSignatures` read (ByteRange/SubFilter/signer);
  F-8 `addFileAttachment` (EmbeddedFile stream + Filespec + name tree +
  PushPin annot; ≤25 MB b64).
- **Slice E (large):** F-9 structural redaction — delete intersecting
  annots, remove fully-contained image XObjects, `scrubMetadata`
  (/PieceInfo, XMP, /Info); return `{removed, retained}` — text/vector
  under rect NOT provable without glyph positions; F-12 `comparePdf`
  structural diff (page/annot/field/outline level; lossy text compare
  documented).
- **Slice F:** F-10 encryption reconciliation (`open` password path,
  real `encrypted` reporting, snapshot semantics for encrypted docs) +
  F-11 `insertPageImage` (JPEG DCTDecode passthrough / PNG FlateDecode;
  camera capture stays host-side).

## Known limitations (engine-side, lopdf 0.36)

- **Unbounded stream decompression.** `getAttachment`'s 64 MiB cap and
  `pageText`/content reads apply to the *decoded* result, but lopdf
  0.36 has no bounded-decompression API: `get_plain_content`/
  `get_page_content` materialize the decompressed stream fully before
  any cap can reject it, so a small compressed stream can expand past
  the cap in memory (decompression bomb). Pre-existing across all
  filtered-stream read paths, not introduced by the signatures/
  attachments slice; a bounded inflater was deliberately not built
  (scope/risk). Mitigation is host-side: bound input PDF sizes before
  `open`. Revisit if lopdf adds a capped decode or a different backend
  is admitted.

## Blocked on host `folio-render` pdfium service

renderPage/thumbnails/layouts (K-01–03); glyph positions, selection,
search hits, read-aloud (K-04/05/18); text-content redaction (K-14 text
half — needs glyph boxes to locate `Tj`/`TJ` ops); inline text editing
(K-21 — needs font metrics); signature creation/verification UX (K-08 —
engine keeps read-only); print preview/PDF-A (K-17 — print is host OS
print of save bytes; PDF/A has no admitted writer).

## ENGINE_OPS.md gaps

Folio table has no entries for these ops yet; `open` row still documents
`encrypted:false` (update when encryption merges); `describe` should
grow `has_forms`/`signature_count`/`encrypted` so hosts can gate UI.

## Renderer-service contract (not folio)

Define `folio-render` op surface (`renderPage`, `textPage`, `search`)
in a sibling doc once pdfium-render is admitted — the real P15 unblock
for K-01–05, K-14 text half, K-16 overlay, K-17 preview, K-18 follow,
K-21.
