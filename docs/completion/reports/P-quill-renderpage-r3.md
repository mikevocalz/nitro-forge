# P-quill-renderpage-r3

2026-11-08. Implementation record for slice **R3** of
`P-quill-renderpage-decision.md` (branch `codex/w15-quill-r3`, base forge
main `5f8b8f4`). R3 scope per the decision: document geometry and
pagination semantics driven by the persisted sections model —
`page_setup` binding in `layout`/`renderPage`, headers/footers, and TOC
page numbers. Verified: `cargo test -p quill-engine` (271 pass),
`cargo build -p nf-cli`, `pnpm install --prefer-offline`,
`pnpm --filter @nitro-forge/quill test` (64 pass),
`pnpm --filter @nitro-forge/quill typecheck` — all clean. **No new
dependencies, no schema bump** — sections, `page_setup`, and
header/footer state already ride the schema:3 wrapper.

## What shipped

- **`layout {use_sections:true}` / `renderPage {use_sections:true}`** —
  a new opt-in payload flag on both read-only ops. When set,
  `page_width`/`page_height` are ignored (accepted for caller
  convenience; each page's own `PageSetup` supplies its geometry) and
  pagination runs the new shared `layout_pages_sectioned`
  (`lib.rs`) instead of the uniform `layout_pages`. Non-bool
  `use_sections` rejects as `Validation`; `renderPage` still requires
  `font` and applies the same 4096px/32MiB bounds per section page.
- **Sectioned pagination** (`SectionFlow`/`SectionPage` in `lib.rs`).
  Each `Section.page_setup` supplies page `width`/`height` (`orientation`
  is decorative metadata today — `setPageSetup` stores it but nothing
  swaps width/height, so stored width/height are used as-is),
  margins define the text area, and `columns`/`column_gap` split it
  column-major (`column_width = (text_w − (n−1)·gap)/n`,
  `col_height = height − margin_top − margin_bottom`). `SectionStart`
  semantics: `next-page` forces a break; `even-page`/`odd-page` pad
  blank pages owned by the previous section until the physical page
  index has the required parity (index 0 = printed page 1 = odd);
  `continuous` keeps filling the current column's remainder under the
  OLD page's geometry; the wrap width switches to the new section
  immediately but is CLAMPED to the host page's column width, since
  glyphs draw inside the host column band — a wider new-section
  measure would overflow the text area. On overflow it flows onto
  fresh pages of the new section's geometry. Section boundaries come from the
  same live `Section.block` anchors every other op maintains.
- **Printed page numbers.** After pagination, per-section page counts
  produce `number` values: a section's `header_footer.number_start`
  restarts its count, otherwise numbering continues from the previous
  section's total (section 0 defaults to 1). `number_start` is honored
  only by a section owning ≥1 page — a `continuous` section whose
  content all fit in the previous section's tail owns zero pages, so
  its restart is inert and numbering continues past it (Word does not
  restart on an empty section). Blank parity pads count toward their
  owner section's total. `toc_pages` and `renderPage`'s
  `number` field report these numbers; `page_numbers` only gates
  *drawing* the number in the header band. Parity for
  even/odd starts and even/odd header variants is computed on the
  physical page `index`, not the printed `number` — documented
  approximation vs Word's printed-number parity.
- **`layout` sectioned payload.** Pages report
  `{index,section,width,height,number,first_in_section}` (points) and
  lines carry `column`. `first_in_section` marks a section's first
  OWNED page — a `continuous` section sharing the previous section's
  page tail does not claim it (that page keeps the previous section's
  header/footer). The result always includes `toc_pages` (empty array
  without toc fields; also present on the uniform path).
- **`toc_pages` — real TOC page numbers.** One `{field,entries}` per
  `kind:"toc"` block. Entries are the LIVE heading scan — the same
  `toc::scan_entries` `listToc` uses, honoring the field's
  `from_level`/`to_level` — with `page` = the printed number of the
  page each heading's first emitted line landed on (derived from the
  same pagination result; the stored `TocField.entries` cache is
  untouched and stays geometry-free). Works on both the sectioned and
  uniform paths (uniform numbers pages sequentially from 1).
- **Sectioned rasterization** (`glyphs::render_page_rgba_sectioned`).
  Body lines draw inside the margin box at their column x-offset
  (`margin_left + column·(column_width + column_gap)`), with a
  per-column running y cursor — column-major order matching layout.
  Header/footer bands draw through the SAME shaping/raster pipeline as
  body text: each non-empty body becomes a synthetic single-`para`
  block resolved by `runs::resolve_block_runs` (base face + `font_size`,
  real `hhea`/`OS/2` metrics, identical shaping budget gate) and wrapped
  at the full text width via the shared `block_line_spans`. Header
  bodies bottom-align to the top margin's inner edge; footer bodies
  bottom-align to the page's bottom edge (Word's footer placement —
  a footer taller than the bottom margin overflows upward toward the
  page center instead of clipping at the page edge). Variant selection honors
  `different_first` (on `first_in_section`) and `different_odd_even`
  (physical index parity); a `null` selected body draws nothing —
  `link_previous` is NOT resolved (the section model documents it as
  consumer metadata). `page_numbers` right-aligns
  `format_page_number(number, number_format)` — new
  `sections::format_page_number` implementing `decimal`, lowercase
  `roman` (subtractives through 3999), and spreadsheet-style `letters`
  — on the header band's last line, drawn even with no header body.
  Bodies taller than their margin overflow toward the page center —
  deterministic, never rejected.
- **Shared measurement.** `block_line_spans` was extracted from
  `layout_pages` so uniform layout, sectioned layout, and header/footer
  wrapping all measure identically (same estimate path, same
  `BlockRuns` resolution, same bounded per-line shaping passes).
- **Docs/API.** `docs/ENGINE_OPS.md` layout/renderPage rows, listToc
  note, sections and TOC paragraphs, and the renderPage paragraph
  rewritten; `index.ts` gains `useSections` on `layout`/`renderPage`,
  `LayoutResult`/`TocFieldPages`/`TocPageEntry` types, optional
  `column`/`section`/`number`/etc. fields, and corrected header/footer
  comments.

## Design decisions taken

1. **Opt-in flag, not a behavior change.** `use_sections` defaults
   off; on the uniform path pagination and rendered pixels are
   identical to R2 — the only envelope delta is the additive
   `toc_pages` key, present on every `layout` result. This keeps every
   existing caller and test untouched while letting hosts migrate
   deliberately.
2. **`number_start` lives in `HeaderFooter`** (existing schema), so
   sectioned numbering reads it unconditionally — `toc_pages`/`number`
   reflect restarts even when `page_numbers` is false (the flag only
   gates drawing). Documented in ENGINE_OPS.
3. **Parity blanks are real pages** owned by the previous section —
   they paginate, count toward that section's number total, render
   with that section's header/footer, and appear in `layout` output
   (empty `lines`). This matches Word's "blank page carries the
   previous section's header" behavior better than dropping them.
4. **HF bodies are plain text, single style.** Stored bodies are plain
   strings ≤8192 chars; each becomes one unstyled `para` block at render
   time. Per-run styling, images, and tables in bands are deferred —
   the schema stores no richer body model.
5. **`toc_pages` computes at read time.** Page numbers are never
   persisted into `TocField.entries`; reads derive them from live
   pagination so they cannot go stale and `listToc`/`refreshToc`
   semantics are unchanged.

## Honest scope notes / remaining R3 work

- Paragraph `format` (alignment/indents/tab stops) is still
  storage-only — sectioned layout does not consume it (same deferral
  as uniform layout).
- `link_previous` inheritance is not resolved; even/odd and
  first-page variants select only within the section's own stored
  bodies.
- Header/footer text is a single unstyled run at the op's base
  `font_size`/`font`; no per-band sizing, no images/tables/rich text,
  no footer page numbers (page number draws in the header band only —
  a documented approximation of Word's three-part header/footer).
- No facing-pages margins, line numbering, page borders/fills, or
  DOCX `sectPr`/header-footer (`headerReference`/`footerReference`)
  import-export — the schema models none of these.
- Column text in headers/footers wraps at full text width (columns
  ignored in bands); vertical CJK text and bidi-correct HF positioning
  inherit the body's documented approximations.
- `layout`'s sectioned pages omit nothing the uniform path reports,
  but sectioned `layout` still does not model table cell geometry,
  list markers, or paragraph spacing — same honest limits as before.

## Tests added

- Rust (9): `layout_use_sections_binds_page_setup` (margins/size wrap,
  ignored `page_width`, `toc_pages` presence),
  `layout_use_sections_columns_flow_column_major`,
  `layout_use_sections_next_page_start_and_geometry`,
  `layout_use_sections_even_page_pads_blank` (parity pad + numbering),
  `layout_use_sections_continuous_shares_column_tail`,
  `layout_use_sections_empty_section_number_start_is_inert`,
  `layout_use_sections_continuous_wrap_clamps_to_host_column`,
  `render_page_use_sections_footer_bottom_aligns`,
  `layout_toc_pages_report_printed_numbers` (incl. `number_start` and
  uniform path), `render_page_use_sections_draws_geometry_and_bands`
  (pixel dims from PageSetup, header/footer ink bands, determinism,
  bare-vs-banded diff), `use_sections_validates_and_bounds`, plus
  `sections::tests::page_number_formats` (decimal/roman/letters).
- vitest e2e (4, `render-page-sections.e2e.test.ts` via real nf-cli):
  sectioned layout geometry + `toc_pages`, section-start breaks +
  columns, sectioned renderPage bands + determinism + bare diff,
  validation/bounds.
