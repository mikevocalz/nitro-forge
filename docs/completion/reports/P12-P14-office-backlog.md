# P12–P14 office engine backlog

2026-11-07. Source-scoping record for dispatching implementation slices.
Backed by `components.json` (H-01–H-22, I-01–I-21, J-01–J-16),
`P12-P20-IMPLEMENTATION-MAP.md`, `docs/ENGINE_OPS.md` and engine sources.
No slice below is marked complete; this is a work list, not acceptance.

## Cross-cutting rules for every slice

- Op names/payloads must land in `docs/ENGINE_OPS.md`, the Rust dispatch,
  and the package `OPS` map in `packages/<engine>/src/index.ts` together.
- New durable state uses the engine-local versioned snapshot wrapper
  (`{kind:"<engine>",schema:N,document:<state>}` inside the NFD1
  envelope), emitted only when new features are present so legacy payloads
  keep the old shape. Old readers must fail closed. Precedent: Quill
  schema:2, Pitch schema:2.
- Tally has no versioned wrapper yet; any slice adding durable state must
  introduce it first. New Tally mutating ops must also be added to
  `check_protection` in `packages/tally/rust/src/protection.rs`.
- Tally formula language currently admits only `COUNTIF SUMIF SUM AVERAGE
  MIN MAX COUNT COUNTA IF ROUND ABS CONCAT TRUE FALSE`; ~~cross-sheet refs
  unsupported~~ — slice 14 landed `Sheet!A1`/`'Name'!A1:B2` qualifiers
  (single qualifier only; 3D ranges and `Sheet!name` remain unsupported).

## P12 — Quill slice order

1. Find/replace ops (`findText`, `replaceText`) — no schema change.
2. Bookmarks (`addBookmark`/`removeBookmark`/`listBookmarks`) — schema:3;
   position-stability design decision required.
3. Named paragraph styles (`defineStyle`/`applyNamedStyle`) — schema bump;
   DOCX `styles.xml` subset.
4. Sections + headers/footers + page setup — large; split model/ops from
   DOCX `sectPr` + layout metrics.
5. Comments — schema bump; DOCX comment subset.
6. Revisions/track changes — largest schema change; split comments vs
   revisions if needed.
7. Tables — new block structure; split insert/basic vs row/col/cell ops.
8. Footnotes/citations + TOC field + mail merge (bounded rows).
9. Indent/tab stops + alignment on Style.

External-blocked (not engine slices): licensed fonts/font metrics, native
IME/caret/selection/bidi bridge, speech/dictation, `renderPage` pixels,
text frames/wrap layout, layout spreads/masters.

## P13 — Tally slice order

0. Snapshot versioning wrapper — prerequisite for all durable-state slices.
1. Series fill (`fillSeries` op; keep `fillRange` semantics unchanged).
2. Cell formats (`formats` map; `setCellFormat`/`clearCellFormat`; schema).
3. Named ranges + `functionCatalog` read op (I-04/I-05).
4. Data validation (`setValidation`/`clearValidation`/`validateCell` read).
5. Conditional formats (reuse `conditional.rs` criteria matcher).
6. Sort/filter (`sortRange`, `setFilter`/`clearFilter`; define hide-vs-
   delete semantics and formula-ref behavior).
7. Charts + sparklines persistence (`insertChart`/`setSparkline`;
   lifts `TALLY_DEFERRED_OPS`; rendering stays host-side).
8. Saved sheet views + `setSheetView` (decision: workbook-persisted vs
   host-persisted; lifts `TALLY_DEFERRED_OPS.setSheetView`).
9. Comments (`addComment`/`resolveComment`/`listComments`).
10. CSV/TSV import-export ops now; XLSX blocked on dependency admission.
11. Pivot tables — split spec-storage/create from update/refresh.
12. Table objects (Excel Tables).
13. Merged cells + row/column insert/delete (reuse `shift_references`).
14. Cross-sheet formula references — late, risky evaluator change.
    **Done (slice 14):** `Sheet!ref`/`'Quoted Name'!ref[:ref]` qualifiers
    resolved by current sheet name (case-insensitive); `renameSheet`
    rewrites stored qualifiers workbook-wide in one undo entry;
    `removeSheet` leaves qualifiers at `#REF!`; cycles/memo/work bounds
    are keyed by `(sheet, addr)`; structural band edits remap qualified
    refs on the edited sheet and mirror `Edited!` refs on other sheets.
    Deferred: 3D ranges, `Sheet!name`, qualified defined names.

## P14 — Pitch slice order

1. Speaker notes (`setNotes`, `slideNotes` read).
2. Slide transitions (`setTransition`; kinds bounded; expose in describe).
3. Rehearsal timings (small; can batch carefully or keep separate).
4. Shape presets beyond rect (`addShape`, bounded `ObjKind` set + stroke).
5. Connectors/diagram tools (after shapes).
6. Persistent ink (`addInkStroke` etc.; bounded points/strokes).
7. Media object metadata (`ObjKind::Media`; decode/playback is host-side).
8. Masters/layouts/placeholders (largest schema change; split CRUD from
   apply/bind).
9. Themes/templates.
10. Charts/tables in slides (embedded bounded data recommended).
11. Morph transitions (after transitions; `setMorphName` + kind).
12. Scene-description/thumbnail read op (Prism-pixels pattern optional).

External-blocked: presenter view + external display routing (host/native),
media decode/render, real transition/morph pixel evaluation.

## Doc gaps found

- `addTriggeredAnimationV1`, `updateTriggeredAnimationV1`,
  `slideAtWithClicksV1` are implemented and described in prose but missing
  from the Pitch op table in `docs/ENGINE_OPS.md` — fix in the next Pitch
  slice.

## P12 Quill slice 8 checkpoint — footnotes/endnotes (2026-11-08, branch codex/w6-quill-footnotes)

Item 8 landed its largest coherent honest subset: footnotes and endnotes.
A `Footnote` is `{id,at,kind,body}` — a single live `{block,offset}`
reference anchor (bookmark right gravity, comment-endpoint clamp-on-delete
semantics, never drops) plus a plain-text body stored on the record outside
the block stream. Ops: `addFootnote` (auto `fn-N` id when omitted),
`updateFootnote`, `removeFootnote`, `listFootnotes` (per-kind 1-based
numbering in document order; the engine stores no numbers). Anchors re-map
through every position-moving op via the shared comments/revisions
machinery, including `changeCase`, `replaceText` match spans, and table
insert/delete (anchors may never sit on a table block). Bounds: ≤1024
notes, bodies ≤8192 chars (empty allowed), unique token ids. Snapshots ride
the schema:3 `deny_unknown_fields` document as an optional `footnotes` key
— no schema bump; schema:2/legacy strays reject. Undo/redo, batches,
eventless reads, and hostile-restore validation all covered.

Deferred honestly (follow-up slices): the TOC field (needs a field/code
model plus heading-scan semantics), mail merge (needs a data-source/record
model; bounded-row merge is a separate contract), citations/bibliography
(no citation semantics distinct from footnotes are defined — `kind` covers
footnote vs endnote placement only), rich/multi-paragraph note bodies, and
DOCX `w:footnoteReference`/`w:endnoteReference`/`footnotes.xml` interop.

TOC checkpoint (codex/w6-quill-toc): the TOC field landed as the second
half of slice 8. A `kind:"toc"` block carries `TocField
{from_level,to_level,entries}` — an inclusive 1..=3 heading-level range
over the `h1`/`h2`/`h3` block kinds plus a cached `TocEntry
{level,title,block}` list scanned from heading blocks (named styles carry
no outline level; text is never matched). Ops: `insertToc` (populates
entries at insert), `updateToc` (re-range + rescan), `refreshToc`
(regenerate cache — the Word "update field" gesture), `listToc`
(always-live deterministic scan, `{block?}` honors a field's range).
Entries are a Word-style field cache: heading text edits leave titles
stale until refresh; `entry.block` indices remap through every
block-count op and entries on deleted heading blocks drop (never clamp —
a wrong-block title would be dishonest). No page numbers: Quill has no
pagination engine, so entries carry block indices and hosts derive
geometry. Guards mirror table blocks (`insertText`/`splitBlock`/
`mergeBlock`/`deleteRange`-from/`setBlockStyle` reject; covering
`deleteRange` deletes the field; `setBlockKind` converts and drops the
payload). Snapshot: **no schema bump** — `kind:"toc"` fails pre-feature
readers closed via the `BlockKind` enum (the `"table"` precedent) and the
payload is a serde-optional `Block` field; `validate_toc` enforces the
kind⇔payload invariant, hygiene, level bounds, ≤64 fields, and
strictly-increasing in-range entry blocks on restore. `exportDocx`
rejects toc-containing documents. Deferred honestly: page numbers and
entry numbering/indent (no pagination/style model), DOCX field
(`w:fldSimple`/`TOC`) interop, toc fields in table cells, outline-level
named styles, mail merge, citations/bibliography (unchanged).

Local evidence: `cargo test -p quill-engine` 184 passed (9 new footnote
tests covering ops, per-kind numbering, remap through every position-moving
op, undo/redo/batch, schema:3 round-trip, stray-key and hostile-restore
rejection), `cargo build -p nf-cli` clean, `pnpm --filter
@nitro-forge/quill test` and `typecheck` (see commit for counts). No
native/device acceptance implied.

Mail-merge checkpoint (codex/w6-quill-mailmerge): the last deferred half
of item 8 landed as text-token fields plus payload records — the honest
subset for an I/O-free engine. A merge field is the literal `{{name}}`
token in block inline text (Word MERGEFIELD-as-field-code model): no
field collection, no snapshot state, no schema bump; `listMergeFields`
is a live scan like `listToc`. Grammar: `{{` + first `}}`, inner
trimmed, name 1..=64 chars without braces/control chars (interior
spaces ok); invalid spans are literal. `previewMerge {records}` (≤1024
records, `{field:value}` objects, single-line values ≤8192 chars, ≤256
fields/record) is read-only and returns per-record merged `text`-op
serialization plus `missing` fields; `runMerge {record,from?,to?}` is
the mutating single-record fill — optional Pos range with
`findText`/`replaceText` coverage rules (table cells included), staged
clone, first-scalar style inheritance, per-span-length anchor remapping
through bookmarks/comments/revisions/footnotes, staged validation, one
undo entry, eventless on zero tokens. Missing fields merge as `""` and
report; unused record keys ignored; single-pass (values never
rescanned). Deferred honestly: CSV/DB/data-source parsing and
persistence (records travel in payloads only), conditional fields,
multi-paragraph/styled values, per-record output documents (hosts open
one handle per record), DOCX `w:fldSimple`/`MERGEFIELD` interop, and
citations/bibliography (unchanged — still no citation semantics
distinct from footnotes).

Local evidence: `cargo test -p quill-engine` 217 passed (9 new merge
tests), `cargo build -p nf-cli` clean, `pnpm install --prefer-offline`
clean, `pnpm --filter @nitro-forge/quill test` 49 passed across 8 files
(5 new nf-cli mail-merge cases), `pnpm --filter @nitro-forge/quill
typecheck` clean. No native/device acceptance implied.
