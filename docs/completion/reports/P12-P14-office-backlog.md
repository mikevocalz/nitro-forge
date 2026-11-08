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
