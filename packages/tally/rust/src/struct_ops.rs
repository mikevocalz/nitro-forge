//! Structural row/column edits (`insertRows`/`deleteRows`/`insertCols`/
//! `deleteCols`) and merged-cell regions (`mergeCells`/`unmergeCells`/
//! `listMergedCells`).
//!
//! Every coordinate-bound structure on the edited sheet is remapped in one
//! atomic pass (see `docs/ENGINE_OPS.md` for the per-structure table):
//! `cells`/`formats` keys move or drop, formula references inside cell raws
//! rewrite through `formula::remap_references`, per-sheet `merges`
//! shrink/drop, and every workbook table bound to the sheet id — names,
//! validations, conditional formats, filters (+column), charts (+series
//! ranges), sparklines, captured view filter specs, comments and pivot
//! source ranges — has its canonical `"A1"`/`"A1:B2"` range remapped;
//! entries the band deletes outright are dropped. Each op records one
//! whole-document undo entry (`UndoEntry::Reset`, the sheet-structural
//! precedent), so undo/redo restore the exact prior document.
//!
//! Merge semantics (bounded subset): a merge is display metadata stored
//! per sheet as inclusive 0-based rectangles. `mergeCells` records the
//! region without touching cell contents or formats — every raw stays
//! live to formulas, `getRange`, sorts and fills; hosts render only the
//! top-left (anchor) value and treat covered cells as hidden. Covered
//! cells report `merged_into` in `getCell`/`getRange`. Merges may not
//! overlap, must span at least two cells and stay inside the sheet and
//! the shared 16,384-cell cap.
use super::range_ops::Rect;
use super::*;
use formula::{band_covers, band_map, BandEdge, RefAxis};

/// Maximum merged regions per sheet.
pub const MAX_MERGES: usize = 256;

/// One structural band edit: `start`/`count` are 0-based on `axis`;
/// `deleting` selects delete semantics (band removed, later positions
/// shift back) versus insert (positions at/after `start` shift forward).
#[derive(Clone, Copy)]
struct Band {
    axis: RefAxis,
    start: u32,
    count: u32,
    deleting: bool,
}

impl Band {
    fn axis_max(&self) -> u32 {
        match self.axis {
            RefAxis::Row => formula::SHEET_MAX_ROWS,
            RefAxis::Col => formula::SHEET_MAX_COLUMNS,
        }
    }

    /// Single coordinate through the band (`None` = deleted/off-sheet).
    fn map(&self, x: u32) -> Option<u32> {
        band_map(
            x,
            self.start,
            self.count,
            self.deleting,
            self.axis_max(),
            BandEdge::Single,
        )
    }

    /// Whether `[lo, hi]` on the edited axis dies inside a delete band.
    fn covers(&self, lo: u32, hi: u32) -> bool {
        self.deleting && band_covers(lo, hi, self.start, self.count)
    }

    /// Remap an inclusive `(c0, r0, c1, r1)` rectangle; `None` when the
    /// edited-axis span is entirely deleted. Endpoints inside a delete
    /// band clamp to the surviving edge (the band start for the low end,
    /// just below it for the high end), so partially covered ranges
    /// shrink instead of dying — the same rule `remap_references` applies
    /// to formula ranges.
    fn rect(&self, coords: name_ops::RefersCoords) -> Option<name_ops::RefersCoords> {
        let (c0, r0, c1, r1) = coords;
        let (lo, hi) = match self.axis {
            RefAxis::Row => (r0, r1),
            RefAxis::Col => (c0, c1),
        };
        if self.covers(lo, hi) {
            return None;
        }
        let map_end = |x: u32| -> Option<u32> {
            let edge = if x == lo.min(hi) {
                BandEdge::Low
            } else {
                BandEdge::High
            };
            band_map(
                x,
                self.start,
                self.count,
                self.deleting,
                self.axis_max(),
                edge,
            )
        };
        let (nc0, nr0, nc1, nr1) = match self.axis {
            RefAxis::Row => (c0, map_end(r0)?, c1, map_end(r1)?),
            RefAxis::Col => (map_end(c0)?, r0, map_end(c1)?, r1),
        };
        if !formula::on_sheet(nc0, nr0) || !formula::on_sheet(nc1, nr1) {
            return None;
        }
        Some((nc0.min(nc1), nr0.min(nr1), nc0.max(nc1), nr0.max(nr1)))
    }

    /// Remap a canonical `"A1"`/`"A1:B2"` range string; `None` when dead.
    fn range_str(&self, range: &str) -> Option<String> {
        let coords = name_ops::parse_refers_to(range).ok()?;
        self.rect(coords).map(name_ops::canonical_refers_to)
    }

    /// Whether `range` parses but its rectangle cannot remap under this
    /// band. Only meaningful for inserts (`!deleting`), which have no
    /// delete band — there a `None` remap is always an endpoint pushed
    /// past the sheet edge. Unparseable strings return `false`: they are
    /// dropped by the normal path either way and are not overflow.
    fn overflows(&self, range: &str) -> bool {
        name_ops::parse_refers_to(range)
            .map(|coords| self.rect(coords).is_none())
            .unwrap_or(false)
    }
}

/// Error for an insert that would push stored content off the sheet.
/// Inserts have no delete band, so any coordinate that cannot remap
/// necessarily overflowed the edge — the op rejects atomically rather
/// than silently dropping the entry (Excel rejects the whole edit).
fn insert_overflow() -> EngineError {
    EngineError::out_of_bounds("insert would push stored content off the sheet")
}

/// Overlap test for two inclusive rectangles.
pub(super) fn rects_overlap(a: name_ops::RefersCoords, b: name_ops::RefersCoords) -> bool {
    a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
}

/// Merge-region helpers on `(c0, r0, c1, r1)`.
fn merge_coords(m: &MergeRegion) -> name_ops::RefersCoords {
    (m.c0, m.r0, m.c1, m.r1)
}

/// Field-level merge invariant shared by op validation and hostile
/// restore: normalized, at least two cells, on-sheet, inside the shared
/// 16,384-cell cap.
pub(super) fn merge_ok(m: &MergeRegion) -> bool {
    m.c0 <= m.c1
        && m.r0 <= m.r1
        && (m.c1 > m.c0 || m.r1 > m.r0)
        && formula::on_sheet(m.c0, m.r0)
        && formula::on_sheet(m.c1, m.r1)
        && u64::from(m.c1 - m.c0 + 1) * u64::from(m.r1 - m.r0 + 1) <= MAX_GET_RANGE_CELLS
}

/// Address of the merge anchor covering `(c, r)`, when `(c, r)` is a
/// covered non-anchor cell of a stored merge.
pub(super) fn merge_anchor(sheet: &Sheet, c: u32, r: u32) -> Option<String> {
    sheet.merges.iter().find_map(|m| {
        if c >= m.c0 && c <= m.c1 && r >= m.r0 && r <= m.r1 && (c, r) != (m.c0, m.r0) {
            Some(fmt_addr(m.c0, m.r0))
        } else {
            None
        }
    })
}

/// Apply `band` to every coordinate-bound structure in `doc`. Only
/// entries bound to the edited sheet id remap; other sheets' structures
/// are untouched. Formulas follow the same rule through their qualifiers:
/// unqualified refs and `EditedSheet!`-qualified refs remap, refs naming
/// any other sheet are copied verbatim — and the mirror pass rewrites
/// `EditedSheet!` refs stored on *other* sheets' formulas. Deletes may
/// drop in-band entries; inserts never legitimately drop anything, so
/// an insert that would push a stored coordinate past the sheet edge
/// fails with `out_of_bounds` instead of losing the entry — callers
/// stage on a clone, so the error leaves the live document untouched.
fn remap_band(doc: &mut Workbook, sheet_idx: usize, band: Band) -> Result<(), EngineError> {
    let sheet_id = doc.sheets[sheet_idx].id;
    // The edited sheet's current name scopes formula-reference remapping:
    // `Name!`-qualified refs on *other* sheets that point here follow the
    // same band edit, while unqualified refs there belong to their own
    // sheet and stay put.
    let sheet_name = doc.sheets[sheet_idx].name.clone();
    // Per-sheet geometry first: cell contents (with formula-reference
    // rewriting), formats and merge regions all key off addresses.
    {
        let sheet = &mut doc.sheets[sheet_idx];
        let cells = mem::take(&mut sheet.cells);
        for (addr, cell) in cells {
            let Some((c, r)) = parse_addr(&addr) else {
                continue;
            };
            let coord = match band.axis {
                RefAxis::Row => r,
                RefAxis::Col => c,
            };
            let Some(mapped) = band.map(coord) else {
                // On an insert, `None` is always edge overflow for an
                // in-bounds coordinate — reject rather than drop the cell.
                if !band.deleting && coord < band.axis_max() {
                    return Err(insert_overflow());
                }
                continue;
            };
            let (nc, nr) = match band.axis {
                RefAxis::Row => (c, mapped),
                RefAxis::Col => (mapped, r),
            };
            if !formula::on_sheet(nc, nr) {
                continue;
            }
            let raw = if cell.raw.starts_with('=') {
                formula::remap_references(
                    &cell.raw,
                    band.axis,
                    band.start,
                    band.count,
                    band.deleting,
                    &sheet_name,
                )
                .unwrap_or(cell.raw)
            } else {
                cell.raw
            };
            sheet.cells.insert(fmt_addr(nc, nr), Cell { raw });
        }
        let formats = mem::take(&mut sheet.formats);
        for (addr, fmt) in formats {
            let Some((c, r)) = parse_addr(&addr) else {
                continue;
            };
            let coord = match band.axis {
                RefAxis::Row => r,
                RefAxis::Col => c,
            };
            let Some(mapped) = band.map(coord) else {
                if !band.deleting && coord < band.axis_max() {
                    return Err(insert_overflow());
                }
                continue;
            };
            let (nc, nr) = match band.axis {
                RefAxis::Row => (c, mapped),
                RefAxis::Col => (mapped, r),
            };
            if formula::on_sheet(nc, nr) {
                sheet.formats.insert(fmt_addr(nc, nr), fmt);
            }
        }
        let merges = mem::take(&mut sheet.merges);
        for m in merges {
            let Some(coords) = band.rect(merge_coords(&m)) else {
                // Inserts cannot shrink a merge to nothing — a `None`
                // rect is an endpoint pushed off the sheet.
                if !band.deleting {
                    return Err(insert_overflow());
                }
                continue;
            };
            // A merge shrunk to a single cell is no longer a merge.
            if coords.2 > coords.0 || coords.3 > coords.1 {
                // An insert can grow a merge past the shared
                // 16,384-cell cap `merge_ok` enforces on restore;
                // deletes only shrink, so an over-cap remap is always
                // an insert pushing stored content past the bound —
                // reject atomically like every other overflow.
                if u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
                    > MAX_GET_RANGE_CELLS
                {
                    return Err(insert_overflow());
                }
                sheet.merges.push(MergeRegion {
                    c0: coords.0,
                    r0: coords.1,
                    c1: coords.2,
                    r1: coords.3,
                });
            }
        }
    }
    // Cross-sheet formula references: a formula on any *other* sheet that
    // names the edited sheet (`Edited!A1`) follows the same band edit —
    // Excel rewrites those references too. Unqualified refs on those
    // sheets belong to their own sheet and are untouched, as are refs
    // qualified with any third sheet's name.
    for (si, other) in doc.sheets.iter_mut().enumerate() {
        if si == sheet_idx {
            continue;
        }
        for cell in other.cells.values_mut() {
            if !cell.raw.starts_with('=') {
                continue;
            }
            let raw = formula::remap_qualified_references(
                &cell.raw,
                band.axis,
                band.start,
                band.count,
                band.deleting,
                &sheet_name,
            )
            .unwrap_or_else(|_| cell.raw.clone());
            cell.raw = raw;
        }
    }
    // Workbook-level tables bound to the edited sheet id. Each entry's
    // canonical range remaps; an entry the band deletes outright is
    // dropped (a name/validation/rule/chart/sparkline/comment cannot
    // point at nothing).
    let mut names = mem::take(&mut doc.names);
    let mut kept_names = Vec::with_capacity(names.len());
    for mut n in names.drain(..) {
        if n.sheet == sheet_id {
            match band.range_str(&n.refers_to) {
                Some(range) => n.refers_to = range,
                None => {
                    if !band.deleting && band.overflows(&n.refers_to) {
                        return Err(insert_overflow());
                    }
                    continue;
                }
            }
        }
        kept_names.push(n);
    }
    doc.names = kept_names;
    macro_rules! remap_rule_ranges {
        ($vec:expr, $field:ident) => {{
            let mut items = mem::take(&mut $vec);
            let mut kept = Vec::with_capacity(items.len());
            for mut item in items.drain(..) {
                if item.sheet == sheet_id {
                    match band.range_str(&item.$field) {
                        Some(range) => item.$field = range,
                        None => {
                            if !band.deleting && band.overflows(&item.$field) {
                                return Err(insert_overflow());
                            }
                            continue;
                        }
                    }
                }
                kept.push(item);
            }
            $vec = kept;
        }};
    }
    remap_rule_ranges!(doc.validations, range);
    remap_rule_ranges!(doc.conditional_formats, range);
    // Filters additionally carry a column letter that must survive a
    // column edit inside the remapped range.
    {
        let mut items = mem::take(&mut doc.filters);
        let mut kept = Vec::with_capacity(items.len());
        for mut f in items.drain(..) {
            if f.sheet == sheet_id {
                let Some(range) = band.range_str(&f.range) else {
                    if !band.deleting && band.overflows(&f.range) {
                        return Err(insert_overflow());
                    }
                    continue;
                };
                if band.axis == RefAxis::Col {
                    if let Some(col) = &f.column {
                        match filter_ops::column_index(col) {
                            Some(idx) => match band.map(idx) {
                                Some(mapped) => {
                                    f.column = Some(filter_ops::column_name(mapped));
                                }
                                None => {
                                    if !band.deleting {
                                        return Err(insert_overflow());
                                    }
                                    continue;
                                }
                            },
                            None => continue,
                        }
                    }
                }
                f.range = range;
            }
            kept.push(f);
        }
        doc.filters = kept;
    }
    // Charts: the data anchor must survive; a dead series range drops
    // just that override (a series reduced to neither name nor range is
    // removed).
    {
        let mut items = mem::take(&mut doc.charts);
        let mut kept = Vec::with_capacity(items.len());
        for mut c in items.drain(..) {
            if c.sheet == sheet_id {
                let Some(range) = band.range_str(&c.range) else {
                    if !band.deleting && band.overflows(&c.range) {
                        return Err(insert_overflow());
                    }
                    continue;
                };
                c.range = range;
                if let Some(series) = &mut c.series {
                    let mut kept_series = Vec::with_capacity(series.len());
                    for mut s in series.drain(..) {
                        if let Some(sr) = &mut s.range {
                            match band.range_str(sr) {
                                Some(mapped) => *sr = mapped,
                                None => {
                                    if !band.deleting && band.overflows(sr.as_str()) {
                                        return Err(insert_overflow());
                                    }
                                    s.range = None;
                                }
                            }
                        }
                        if s.name.is_some() || s.range.is_some() {
                            kept_series.push(s);
                        }
                    }
                    *series = kept_series;
                    if series.is_empty() {
                        c.series = None;
                    }
                }
            }
            kept.push(c);
        }
        doc.charts = kept;
    }
    // Sparklines need both anchors; either dying drops the spec.
    {
        let mut items = mem::take(&mut doc.sparklines);
        let mut kept = Vec::with_capacity(items.len());
        for mut s in items.drain(..) {
            if s.sheet == sheet_id {
                match (band.range_str(&s.target), band.range_str(&s.data)) {
                    (Some(target), Some(data)) => {
                        s.target = target;
                        s.data = data;
                    }
                    _ => {
                        if !band.deleting && (band.overflows(&s.target) || band.overflows(&s.data))
                        {
                            return Err(insert_overflow());
                        }
                        continue;
                    }
                }
            }
            kept.push(s);
        }
        doc.sparklines = kept;
    }
    // Views capture filter specs: remap each spec like a live filter
    // rule; specs the band kills are dropped from the capture (the view
    // itself stays — it is a named snapshot, not live state).
    {
        let mut items = mem::take(&mut doc.views);
        for v in items.iter_mut() {
            if v.sheet != sheet_id {
                continue;
            }
            let mut kept_specs = Vec::with_capacity(v.filters.len());
            for mut f in mem::take(&mut v.filters).into_iter() {
                let Some(range) = band.range_str(&f.range) else {
                    if !band.deleting && band.overflows(&f.range) {
                        return Err(insert_overflow());
                    }
                    continue;
                };
                if band.axis == RefAxis::Col {
                    if let Some(col) = &f.column {
                        match filter_ops::column_index(col) {
                            Some(idx) => match band.map(idx) {
                                Some(mapped) => {
                                    f.column = Some(filter_ops::column_name(mapped));
                                }
                                None => {
                                    if !band.deleting {
                                        return Err(insert_overflow());
                                    }
                                    continue;
                                }
                            },
                            None => continue,
                        }
                    }
                }
                f.range = range;
                kept_specs.push(f);
            }
            v.filters = kept_specs;
        }
        doc.views = items;
    }
    // Comments anchor to coordinates: the anchor moves with the cells
    // (Excel behavior); an anchor fully inside the deleted band drops
    // the comment.
    {
        let mut items = mem::take(&mut doc.comments);
        let mut kept = Vec::with_capacity(items.len());
        for mut c in items.drain(..) {
            if c.sheet == sheet_id {
                match band.range_str(&c.anchor) {
                    Some(anchor) => c.anchor = anchor,
                    None => {
                        if !band.deleting && band.overflows(&c.anchor) {
                            return Err(insert_overflow());
                        }
                        continue;
                    }
                }
            }
            kept.push(c);
        }
        doc.comments = kept;
    }
    // Pivot specs: only `source.range` is coordinate-bound (the output
    // sheet carries no stored coordinates). A pivot whose source sheet is
    // the edited sheet remaps its source range like a chart anchor; a
    // range fully covered by a deleted band — or a column edit that
    // shrinks the range below a referenced field index — drops the pivot
    // (a spec that cannot name its fields cannot compute). Pivots bound
    // to the edited sheet only as *output* sheet are untouched.
    {
        let mut items = mem::take(&mut doc.pivots);
        let mut kept = Vec::with_capacity(items.len());
        for mut pv in items.drain(..) {
            if pv.source.sheet == sheet_id {
                match band.range_str(&pv.source.range) {
                    Some(range) => pv.source.range = range,
                    None => {
                        if !band.deleting && band.overflows(&pv.source.range) {
                            return Err(insert_overflow());
                        }
                        continue;
                    }
                }
                // Column deletes can shrink the source width under a
                // referenced field index; the spec then cannot resolve
                // its fields and drops (deletes only — inserts expand).
                if !pivot_ops::fields_ok(&pv) {
                    continue;
                }
            }
            kept.push(pv);
        }
        doc.pivots = kept;
    }
    // Table objects: `range` is the table's anchor and remaps like every
    // other bound range — inserts shift/expand it, deletes shrink it, and
    // a range fully covered by a deleted band drops the table (Excel
    // removes a table whose rows/columns are all deleted); a remap that
    // would leave under two cells drops it too, and growth past the
    // shared 16,384-cell cap rejects atomically. Because every
    // bound structure remaps through the same `Band`, disjoint table and
    // merge ranges stay disjoint.
    {
        let mut items = mem::take(&mut doc.tables);
        let mut kept = Vec::with_capacity(items.len());
        for mut t in items.drain(..) {
            if t.sheet == sheet_id {
                // Same parse → rect → canonical pipeline as
                // `Band::range_str`, kept as coords so the remapped
                // range can be re-checked against the invariants
                // `restore` enforces via `table_ops::stored_ok`.
                let remapped = name_ops::parse_refers_to(&t.range)
                    .ok()
                    .and_then(|coords| band.rect(coords));
                match remapped {
                    Some(coords) => {
                        let cells = table_ops::cell_count(coords);
                        // A delete can shrink a table to a single cell —
                        // drop it like a merge shrunk to one cell (a
                        // table degenerated by a structural delete cannot
                        // satisfy `range_ok`, so keeping it would emit a
                        // snapshot `restore` rejects).
                        if cells < 2 {
                            continue;
                        }
                        // An insert can grow a table past the shared
                        // 16,384-cell cap; deletes only shrink, so
                        // over-cap is insert-only in practice. Reject
                        // atomically like every other bound structure.
                        if cells > MAX_GET_RANGE_CELLS {
                            return Err(insert_overflow());
                        }
                        t.range = name_ops::canonical_refers_to(coords);
                    }
                    None => {
                        if !band.deleting && band.overflows(&t.range) {
                            return Err(insert_overflow());
                        }
                        continue;
                    }
                }
            }
            kept.push(t);
        }
        doc.tables = kept;
    }
    Ok(())
}

impl TallyEngine {
    /// Parse `{sheet?, from, to}` (1-based inclusive) into a sheet index
    /// and a 0-based band on `axis`. `insert` requires the band to fit
    /// inside the sheet (`start + count <= max`); `delete` additionally
    /// refuses to remove every row/column of the sheet.
    fn band_payload(
        &self,
        p: &Value,
        axis: RefAxis,
        insert: bool,
    ) -> Result<(usize, Band), EngineError> {
        let idx = self.sheet_index(p)?;
        let parse_1based = |key: &str| -> Result<u32, EngineError> {
            let v = Self::field(p, key)?;
            let n = v
                .as_u64()
                .ok_or_else(|| EngineError::validation(format!("'{key}' must be an integer")))?;
            u32::try_from(n)
                .ok()
                .filter(|&b| b >= 1)
                .ok_or_else(|| EngineError::validation(format!("'{key}' must be >= 1")))
        };
        let from = parse_1based("from")?;
        let to = parse_1based("to")?;
        if to < from {
            return Err(EngineError::validation("band 'to' must be >= 'from'"));
        }
        let count = to - from + 1;
        let max = match axis {
            RefAxis::Row => formula::SHEET_MAX_ROWS,
            RefAxis::Col => formula::SHEET_MAX_COLUMNS,
        };
        if u64::from(to) > u64::from(max) {
            return Err(EngineError::out_of_bounds(format!(
                "band is past the sheet bound ({max})"
            )));
        }
        let start = from - 1;
        if insert {
            // The inserted band occupies `[start, start+count)`; it must
            // fit inside the sheet.
            if u64::from(start) + u64::from(count) > u64::from(max) {
                return Err(EngineError::out_of_bounds(format!(
                    "insert band does not fit inside the sheet ({max})"
                )));
            }
        } else if count >= max {
            return Err(EngineError::validation(
                "cannot delete every row/column of a sheet",
            ));
        }
        Ok((
            idx,
            Band {
                axis,
                start,
                count,
                deleting: !insert,
            },
        ))
    }

    /// Shared body of the four structural ops: validate, stage the remap
    /// on a clone, commit as one whole-document undo entry when anything
    /// actually moved (an empty sheet makes the edit a no-op).
    fn op_structural(
        &mut self,
        p: &Value,
        axis: RefAxis,
        insert: bool,
    ) -> Result<CommandResult, EngineError> {
        let (idx, band) = self.band_payload(p, axis, insert)?;
        let mut next = self.doc.clone();
        remap_band(&mut next, idx, band)?;
        if next == self.doc {
            return Ok(Self::readonly(json!({ "ok": true, "changed": 0 })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc = next;
        Ok(Self::changed(json!({ "ok": true, "changed": 1 })))
    }

    pub(super) fn op_insert_rows(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.op_structural(p, RefAxis::Row, true)
    }
    pub(super) fn op_delete_rows(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.op_structural(p, RefAxis::Row, false)
    }
    pub(super) fn op_insert_cols(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.op_structural(p, RefAxis::Col, true)
    }
    pub(super) fn op_delete_cols(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.op_structural(p, RefAxis::Col, false)
    }

    // -- merged cells ---------------------------------------------------------

    /// `{sheet?, range:{from,to}}` → sheet index + normalized rect.
    /// `multi` requires at least two cells (mergeCells); unmergeCells
    /// accepts any rectangle — a single cell selects the merge covering
    /// it, like Excel's unmerge-on-selection.
    fn merge_rect(
        &self,
        p: &Value,
        multi: bool,
    ) -> Result<(usize, name_ops::RefersCoords), EngineError> {
        let idx = self.sheet_index(p)?;
        let rect = Rect::read(Self::field(p, "range")?)?;
        let coords = rect.coords();
        if multi && coords.2 == coords.0 && coords.3 == coords.1 {
            return Err(EngineError::validation(
                "a merge must cover at least two cells",
            ));
        }
        Ok((idx, coords))
    }

    pub(super) fn op_merge_cells(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let (idx, coords) = self.merge_rect(p, true)?;
        let sheet = &self.doc.sheets[idx];
        if sheet.merges.iter().any(|m| merge_coords(m) == coords) {
            // Idempotent: merging an already-merged region is a no-op;
            // it still reports the canonical range like a fresh merge.
            return Ok(Self::readonly(json!({
                "ok": true,
                "range": name_ops::canonical_refers_to(coords),
            })));
        }
        if sheet.merges.len() >= MAX_MERGES {
            return Err(EngineError::validation("too many merged regions"));
        }
        if sheet
            .merges
            .iter()
            .any(|m| rects_overlap(merge_coords(m), coords))
        {
            return Err(EngineError::validation(
                "merge overlaps an existing merged region",
            ));
        }
        // Excel forbids merged cells inside a table: a merge may not
        // intersect a table object bound to this sheet (the reverse
        // direction is enforced by `insertTable`/`updateTable`).
        if self.doc.tables.iter().any(|t| {
            t.sheet == sheet.id
                && table_ops::range_coords(t)
                    .is_some_and(|c| rects_overlap(c, coords))
        }) {
            return Err(EngineError::validation(
                "merge overlaps a table object",
            ));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.sheets[idx].merges.push(MergeRegion {
            c0: coords.0,
            r0: coords.1,
            c1: coords.2,
            r1: coords.3,
        });
        Ok(Self::changed(json!({
            "ok": true,
            "range": name_ops::canonical_refers_to(coords),
        })))
    }

    pub(super) fn op_unmerge_cells(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let (idx, coords) = self.merge_rect(p, false)?;
        let mut next = self.doc.clone();
        let before = next.sheets[idx].merges.len();
        next.sheets[idx]
            .merges
            .retain(|m| !rects_overlap(merge_coords(m), coords));
        let cleared = before - next.sheets[idx].merges.len();
        if cleared == 0 {
            return Ok(Self::readonly(json!({ "cleared": 0 })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc = next;
        Ok(Self::changed(json!({ "cleared": cleared })))
    }

    /// `{sheet?}` → merged regions; absent `sheet` lists every sheet's
    /// merges tagged with the bound sheet's current name and id.
    pub(super) fn op_list_merged_cells(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let selected = match p.get("sheet") {
            None | Some(Value::Null) => None,
            Some(v) => Some(self.resolve_sheet(v)?),
        };
        let mut out = Vec::new();
        for (i, s) in self.doc.sheets.iter().enumerate() {
            if selected.is_some_and(|sel| sel != i) {
                continue;
            }
            for m in &s.merges {
                let mut entry = serde_json::Map::new();
                entry.insert("sheet_id".to_string(), json!(s.id));
                entry.insert("sheet".to_string(), json!(s.name));
                entry.insert("from".to_string(), json!(fmt_addr(m.c0, m.r0)));
                entry.insert("to".to_string(), json!(fmt_addr(m.c1, m.r1)));
                out.push(Value::Object(entry));
            }
        }
        Ok(Self::readonly(json!({ "merges": out })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::Command;

    fn run(e: &mut TallyEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn run_err(e: &mut TallyEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }
    fn raw(e: &mut TallyEngine, addr: &str) -> Value {
        run(e, "getCell", json!({"addr":addr})).data["raw"].clone()
    }
    fn computed(e: &mut TallyEngine, addr: &str) -> Value {
        run(e, "getCell", json!({"addr":addr})).data["computed"].clone()
    }
    fn sheet_cell(e: &TallyEngine, idx: usize, addr: &str) -> Option<String> {
        e.doc.sheets[idx].cells.get(addr).map(|c| c.raw.clone())
    }
    /// Length of an optional serialized vec field (absent when empty).
    fn field_len(v: &Value, key: &str) -> usize {
        v[key].as_array().map_or(0, Vec::len)
    }

    // -- insert/delete rows ----------------------------------------------------

    #[test]
    fn insert_rows_shifts_cells_formats_and_formula_refs() {
        let mut e = TallyEngine::new();
        run(&mut e, "setRange", json!({"from":"A1","values":[["1","=A1*2","x"],["2","=A2*2","y"]]}));
        run(&mut e, "setFormat", json!({"range":{"from":"B2","to":"B2"},"format":{"bold":true}}));
        let before = e.snapshot().unwrap();
        let r = run(&mut e, "insertRows", json!({"from":2,"to":2}));
        assert_eq!(r.data["changed"], 1);
        assert_eq!(r.events.len(), 1);
        // Row 1 untouched, old row 2 now row 3.
        assert_eq!(raw(&mut e, "A1"), "1");
        assert_eq!(raw(&mut e, "A3"), "2");
        assert_eq!(raw(&mut e, "B3"), "=A3*2");
        assert_eq!(computed(&mut e, "B3"), 4.0);
        // B1's =A1*2 references row 1, above the inserted row: unchanged.
        assert_eq!(raw(&mut e, "B1"), "=A1*2");
        assert_eq!(raw(&mut e, "B2"), "");
        // Format followed the cell.
        let d = run(&mut e, "getCell", json!({"addr":"B3"})).data;
        assert_eq!(d["format"]["bold"], true);
        // Undo restores exactly.
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(raw(&mut e, "A3"), "2");
        assert_eq!(raw(&mut e, "A2"), "");
    }

    #[test]
    fn insert_rows_multi_count_and_refs_below_band() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"=B3"}));
        run(&mut e, "setCell", json!({"addr":"B3","value":"7"}));
        // Insert two rows before row 1: everything shifts down 2.
        run(&mut e, "insertRows", json!({"from":1,"to":2}));
        assert_eq!(raw(&mut e, "A3"), "=B5");
        assert_eq!(raw(&mut e, "B5"), "7");
        assert_eq!(computed(&mut e, "A3"), 7.0);
    }

    #[test]
    fn delete_rows_drops_band_and_rewrites_refs() {
        let mut e = TallyEngine::new();
        run(&mut e, "setRange", json!({"from":"A1","values":[["1"],["2"],["3"],["4"]]}));
        // Formula cells sit below the deleted band so they survive.
        run(&mut e, "setCell", json!({"addr":"D5","value":"=A3"}));
        run(&mut e, "setCell", json!({"addr":"D6","value":"=SUM(A1:A4)"}));
        run(&mut e, "setCell", json!({"addr":"D7","value":"=A2:A3"}));
        let before = e.snapshot().unwrap();
        // Delete rows 2-3 (1-based): A2,A3 gone; A4 -> A2.
        run(&mut e, "deleteRows", json!({"from":2,"to":3}));
        assert_eq!(raw(&mut e, "A1"), "1");
        assert_eq!(raw(&mut e, "A2"), "4");
        assert_eq!(raw(&mut e, "A3"), "");
        // D5->D3: referenced A3 (row idx2) is inside the band -> #REF!.
        assert_eq!(raw(&mut e, "D3"), "=#REF!");
        // D6->D4: range A1:A4 loses its covered rows -> A1:A2.
        assert_eq!(raw(&mut e, "D4"), "=SUM(A1:A2)");
        // D7->D5: range A2:A3 fully inside the band -> #REF!.
        assert_eq!(raw(&mut e, "D5"), "=#REF!");
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(raw(&mut e, "A2"), "4");
    }

    #[test]
    fn delete_rows_partial_range_clamps() {
        let mut e = TallyEngine::new();
        // =SUM(A1:A5), delete rows 3-4 -> =SUM(A1:A3)
        run(&mut e, "setCell", json!({"addr":"B1","value":"=SUM(A1:A5)"}));
        run(&mut e, "deleteRows", json!({"from":3,"to":4}));
        assert_eq!(raw(&mut e, "B1"), "=SUM(A1:A3)");
        // Delete rows covering the range start: =SUM(A2:A5) delete row 2 -> =SUM(A2:A4)
        let mut e2 = TallyEngine::new();
        run(&mut e2, "setCell", json!({"addr":"B1","value":"=SUM(A2:A5)"}));
        run(&mut e2, "deleteRows", json!({"from":2,"to":2}));
        assert_eq!(raw(&mut e2, "B1"), "=SUM(A2:A4)");
        // Range end inside band: =SUM(A1:A3) delete row 3 -> =SUM(A1:A2)
        let mut e3 = TallyEngine::new();
        run(&mut e3, "setCell", json!({"addr":"B1","value":"=SUM(A1:A3)"}));
        run(&mut e3, "deleteRows", json!({"from":3,"to":3}));
        assert_eq!(raw(&mut e3, "B1"), "=SUM(A1:A2)");
    }

    #[test]
    fn cols_ops_mirror_rows() {
        let mut e = TallyEngine::new();
        run(&mut e, "setRange", json!({"from":"A1","values":[["1","=A1","x"],["2","=B1","y"]]}));
        run(&mut e, "insertCols", json!({"from":2,"to":2}));
        // B column content moved to C; refs to col A stay, refs to B shift.
        assert_eq!(raw(&mut e, "C1"), "=A1");
        assert_eq!(raw(&mut e, "C2"), "=C1");
        run(&mut e, "deleteCols", json!({"from":2,"to":2}));
        assert_eq!(raw(&mut e, "B1"), "=A1");
        assert_eq!(raw(&mut e, "B2"), "=B1");
    }

    #[test]
    fn structural_bounds_and_atomicity() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        // Delete every row / every column rejects.
        run_err(&mut e, "deleteRows", json!({"from":1,"to":1048576}));
        run_err(&mut e, "deleteCols", json!({"from":1,"to":16384}));
        // Bands past the sheet bound reject.
        run_err(&mut e, "insertRows", json!({"from":1048576,"to":1048577}));
        run_err(&mut e, "deleteRows", json!({"from":1040000,"to":1048577}));
        // An insert at the last row fits exactly (start+count == max) and,
        // on an empty sheet, is eventless.
        let r = run(&mut e, "insertRows", json!({"from":1048575,"to":1048576}));
        assert_eq!(r.events.len(), 0, "empty-sheet insert is eventless");
        assert_eq!(e.snapshot().unwrap(), before);
        // Inverted band rejects.
        assert!(e.apply(Command::new("insertRows", json!({"from":5,"to":2}))).is_err());
        assert!(e.apply(Command::new("deleteRows", json!({"from":0,"to":2}))).is_err());
        assert!(e.apply(Command::new("deleteRows", json!({"from":1,"to":2000000}))).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn structural_respects_sheet_param_and_protection() {
        let mut e = TallyEngine::new();
        run(&mut e, "addSheet", json!({"name":"Second"}));
        run(&mut e, "setActive", json!({"sheet":"Second"}));
        run(&mut e, "setCell", json!({"addr":"A1","value":"s2"}));
        // Structural op on sheet 0 by name while sheet 1 is active.
        run(&mut e, "setActive", json!({"sheet":0}));
        run(&mut e, "setCell", json!({"addr":"A1","value":"s1"}));
        run(&mut e, "insertRows", json!({"sheet":"Second","from":1,"to":1}));
        assert_eq!(raw(&mut e, "A1"), "s1");
        run(&mut e, "setActive", json!({"sheet":"Second"}));
        assert_eq!(raw(&mut e, "A2"), "s2");
        // Protection gates.
        run(&mut e, "protectSheet", json!({"sheet":"Second","protected":true}));
        let before = e.snapshot().unwrap();
        for op in ["insertRows","deleteRows","insertCols","deleteCols","mergeCells","unmergeCells"] {
            let p = if op.contains("merge") {
                json!({"sheet":"Second","range":{"from":"A1","to":"A2"}})
            } else {
                json!({"sheet":"Second","from":1,"to":1})
            };
            assert!(e.apply(Command::new(op, p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), before, "{op}");
        }
        // listMergedCells stays a read.
        assert!(e.apply(Command::new("listMergedCells", json!({"sheet":"Second"}))).is_ok());
    }

    // -- insert overflow at the sheet edge --------------------------------------

    #[test]
    fn insert_past_last_row_rejects_atomically() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1048576","value":"edge"}));
        let before = e.snapshot().unwrap();
        // The last-row cell would shift to row 1048577 — Excel rejects
        // the whole op; Tally rejects before any mutation.
        let err = run_err(&mut e, "insertRows", json!({"from":1048576,"to":1048576}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        // An insert anywhere above pushes it off too — same rejection.
        let err = run_err(&mut e, "insertRows", json!({"from":1,"to":1}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        // The only undo entry is the setCell — the rejected inserts
        // recorded nothing.
        assert!(e.undo().unwrap());
        assert!(!e.undo().unwrap());
        // Content adjacent to the edge still shifts legally.
        let mut e2 = TallyEngine::new();
        run(&mut e2, "setCell", json!({"addr":"A1048575","value":"near"}));
        let r = run(&mut e2, "insertRows", json!({"from":1048575,"to":1048575}));
        assert_eq!(r.data["changed"], 1);
        assert_eq!(raw(&mut e2, "A1048576"), "near");
        // And an insert band below all content stays a no-op.
        let mut e3 = TallyEngine::new();
        run(&mut e3, "setCell", json!({"addr":"A1","value":"low"}));
        let r = run(&mut e3, "insertRows", json!({"from":1048576,"to":1048576}));
        assert_eq!(r.data["changed"], 0);
    }

    #[test]
    fn insert_past_last_col_rejects_atomically() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"XFD1","value":"edge"}));
        let before = e.snapshot().unwrap();
        let err = run_err(&mut e, "insertCols", json!({"from":16384,"to":16384}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.undo().unwrap());
        assert!(!e.undo().unwrap());
        // XFC is one in from the edge: it shifts onto XFD legally.
        let mut e2 = TallyEngine::new();
        run(&mut e2, "setCell", json!({"addr":"XFC1","value":"near"}));
        let r = run(&mut e2, "insertCols", json!({"from":16383,"to":16383}));
        assert_eq!(r.data["changed"], 1);
        assert_eq!(raw(&mut e2, "XFD1"), "near");
    }

    #[test]
    fn insert_overflow_covers_every_bound_structure() {
        // Merge at the last row.
        let mut e = TallyEngine::new();
        run(&mut e, "mergeCells", json!({"range":{"from":"A1048575","to":"B1048576"}}));
        let before = e.snapshot().unwrap();
        let err = run_err(&mut e, "insertRows", json!({"from":1048576,"to":1048576}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        // Defined name at the last row.
        let mut e = TallyEngine::new();
        run(&mut e, "defineName", json!({"name":"Edge","refers_to":"A1048576"}));
        let before = e.snapshot().unwrap();
        let err = run_err(&mut e, "insertRows", json!({"from":1048576,"to":1048576}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        // Validation rule anchored at the last row.
        let mut e = TallyEngine::new();
        run(&mut e, "setValidation", json!({"range":{"from":"A1048576","to":"B1048576"},"rule":{"kind":"number","min":0}}));
        let before = e.snapshot().unwrap();
        let err = run_err(&mut e, "insertRows", json!({"from":1048576,"to":1048576}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        // Comment anchor at the last column.
        let mut e = TallyEngine::new();
        run(&mut e, "addComment", json!({"cell":"XFD1","body":"note"}));
        let before = e.snapshot().unwrap();
        let err = run_err(&mut e, "insertCols", json!({"from":16384,"to":16384}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        // Deletes at the same edge still work — in-band drops are legal.
        run(&mut e, "deleteCols", json!({"from":16384,"to":16384}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(field_len(&d, "comments"), 0);
    }

    #[test]
    fn insert_remaps_locked_refs_and_expands_ranges() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"B5","value":"=$A$3+1"}));
        run(&mut e, "setCell", json!({"addr":"D1","value":"=SUM(A1:B2)"}));
        run(&mut e, "setCell", json!({"addr":"E2","value":"=SUM($A$1:$B$2)"}));
        run(&mut e, "insertRows", json!({"from":2,"to":2}));
        // `$` locks are preserved syntactically but do not pin: $A$3
        // (row idx 2, at/after the band) shifts to $A$4; the cell itself
        // moved B5 -> B6.
        assert_eq!(raw(&mut e, "B6"), "=$A$4+1");
        // A band inside a range expands it (Excel): A1:B2 -> A1:B3.
        assert_eq!(raw(&mut e, "D1"), "=SUM(A1:B3)");
        // Locked endpoints keep their `$` through the same expansion;
        // E2 sits on the band so the cell moved to E3.
        assert_eq!(raw(&mut e, "E3"), "=SUM($A$1:$B$3)");
    }

    // -- workbook table remap ---------------------------------------------------

    #[test]
    fn names_validations_conditionals_filters_remap() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        run(&mut e, "defineName", json!({"name":"Target","refers_to":"A2:B3"}));
        run(&mut e, "setValidation", json!({"range":{"from":"C1","to":"C5"},"rule":{"kind":"number","min":0}}));
        run(&mut e, "setConditionalFormat", json!({"range":{"from":"D1","to":"D5"},"rule":{"criteria":">1","format":{"bold":true}}}));
        run(&mut e, "setFilter", json!({"range":{"from":"E1","to":"E9"},"column":"E","criteria":">0"}));
        run(&mut e, "insertRows", json!({"from":2,"to":3}));
        let d = run(&mut e, "describe", json!({})).data;
        let wb = &d;
        // The name's rows (2-3, 1-based) sit inside the inserted band and
        // shift; every range starting above row 2 expands downward instead
        // (Excel semantics — the band lands inside the range).
        assert_eq!(wb["names"][0]["refers_to"], "A4:B5");
        assert_eq!(wb["validations"][0]["range"], "C1:C7");
        assert_eq!(wb["conditional_formats"][0]["range"], "D1:D7");
        assert_eq!(wb["filters"][0]["range"], "E1:E11");
        // Column-axis edit shifts the whole filter range and its column.
        run(&mut e, "insertCols", json!({"from":5,"to":5}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(d["filters"][0]["range"], "F1:F11");
        assert_eq!(d["filters"][0]["column"], "F");
        // Deleting the filter's column drops the rule.
        run(&mut e, "deleteCols", json!({"from":6,"to":6}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(field_len(&d, "filters"), 0);
    }

    #[test]
    fn charts_sparklines_comments_views_remap() {
        let mut e = TallyEngine::new();
        run(&mut e, "setRange", json!({"from":"A1","values":[["1","2"],["3","4"]]}));
        run(&mut e, "insertChart", json!({"chart":{"kind":"line","range":{"from":"A1","to":"B2"},"series":[{"name":"s1","range":{"from":"A1","to":"A2"}}]}}));
        run(&mut e, "setSparkline", json!({"cell":"D1","data":{"from":"A1","to":"B2"},"kind":"line"}));
        run(&mut e, "setFilter", json!({"range":{"from":"A1","to":"B2"},"criteria":">0"}));
        run(&mut e, "saveSheetView", json!({"name":"V"}));
        run(&mut e, "addComment", json!({"cell":"C3","body":"note"}));
        run(&mut e, "insertRows", json!({"from":1,"to":1}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(d["charts"][0]["range"], "A2:B3");
        assert_eq!(d["charts"][0]["series"][0]["range"], "A2:A3");
        assert_eq!(d["sparklines"][0]["target"], "D2");
        assert_eq!(d["sparklines"][0]["data"], "A2:B3");
        assert_eq!(d["views"][0]["filters"][0]["range"], "A2:B3");
        assert_eq!(d["comments"][0]["anchor"], "C4");
        // Deleting the comment's row drops the comment.
        run(&mut e, "deleteRows", json!({"from":4,"to":4}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(field_len(&d, "comments"), 0);
    }

    #[test]
    fn dead_entries_drop_on_delete() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        run(&mut e, "setCell", json!({"addr":"A2","value":"2"}));
        run(&mut e, "defineName", json!({"name":"Gone","refers_to":"A1"}));
        // A formula cell below the band references a deleted cell.
        run(&mut e, "setCell", json!({"addr":"D5","value":"=A1"}));
        run(&mut e, "deleteRows", json!({"from":1,"to":2}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(field_len(&d, "names"), 0);
        // D5 -> D3; its =A1 reference died with the row -> #REF!.
        assert_eq!(raw(&mut e, "D3"), "=#REF!");
    }

    // -- merged cells ------------------------------------------------------------

    #[test]
    fn merge_unmerge_list_and_anchor_reporting() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"B2","value":"top"}));
        run(&mut e, "setCell", json!({"addr":"C3","value":"hidden-but-live"}));
        let r = run(&mut e, "mergeCells", json!({"range":{"from":"B2","to":"D4"}}));
        assert_eq!(r.data["range"], "B2:D4");
        // Idempotent re-merge is eventless but still reports the range.
        let again = run(&mut e, "mergeCells", json!({"range":{"from":"B2","to":"D4"}}));
        assert!(again.events.is_empty());
        assert_eq!(again.data["range"], "B2:D4");
        // Covered cells report merged_into; contents stay live.
        let cov = run(&mut e, "getCell", json!({"addr":"C3"})).data;
        assert_eq!(cov["merged_into"], "B2");
        assert_eq!(cov["raw"], "hidden-but-live");
        assert_eq!(computed(&mut e, "C3"), "hidden-but-live");
        // Anchor itself reports no merged_into.
        let anchor = run(&mut e, "getCell", json!({"addr":"B2"})).data;
        assert!(anchor.get("merged_into").is_none());
        // listMergedCells.
        let list = run(&mut e, "listMergedCells", json!({})).data;
        assert_eq!(list["merges"][0]["from"], "B2");
        assert_eq!(list["merges"][0]["to"], "D4");
        assert_eq!(list["merges"][0]["sheet"], "Sheet1");
        // Single-cell unmerge selector removes the intersecting merge.
        let un = run(&mut e, "unmergeCells", json!({"range":{"from":"C3","to":"C3"}}));
        assert_eq!(un.data["cleared"], 1);
        let list = run(&mut e, "listMergedCells", json!({"sheet":0})).data;
        assert_eq!(list["merges"].as_array().unwrap().len(), 0);
        // Unmerge with no hit is eventless.
        let none = run(&mut e, "unmergeCells", json!({"range":{"from":"A1","to":"A1"}}));
        assert!(none.events.is_empty());
        assert_eq!(none.data["cleared"], 0);
    }

    #[test]
    fn merge_rejects_overlap_single_cell_and_bad_bounds() {
        let mut e = TallyEngine::new();
        run(&mut e, "mergeCells", json!({"range":{"from":"A1","to":"B2"}}));
        let before = e.snapshot().unwrap();
        for p in [
            json!({"range":{"from":"B2","to":"C3"}}),   // overlaps
            json!({"range":{"from":"A1","to":"A1"}}),   // single cell
            json!({"range":{"from":"A1","to":"Z99999"}}), // off sheet
        ] {
            assert!(e.apply(Command::new("mergeCells", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Adjacent (non-overlapping) merges are fine.
        run(&mut e, "mergeCells", json!({"range":{"from":"C1","to":"D2"}}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(d["sheets"][0]["merges"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn merges_remap_shrink_and_drop_with_structural_ops() {
        let mut e = TallyEngine::new();
        run(&mut e, "mergeCells", json!({"range":{"from":"B2","to":"D4"}}));
        run(&mut e, "mergeCells", json!({"range":{"from":"F1","to":"G1"}}));
        // Insert a row above: both shift down one (0-based rows +1).
        run(&mut e, "insertRows", json!({"from":1,"to":1}));
        let d = run(&mut e, "describe", json!({})).data;
        let merges = d["sheets"][0]["merges"].as_array().unwrap();
        assert_eq!(merges[0]["r0"], 2);
        assert_eq!(merges[0]["r1"], 4);
        assert_eq!(merges[1]["r0"], 1);
        assert_eq!(merges[1]["r1"], 1);
        // Delete row 2 (1-based): the single-row merge dies with it; the
        // first merge's low edge was above the band and its high edge
        // shifts up — B3:D5 (0-based rows 1-3).
        run(&mut e, "deleteRows", json!({"from":2,"to":2}));
        let d = run(&mut e, "describe", json!({})).data;
        let merges = d["sheets"][0]["merges"].as_array().unwrap();
        assert_eq!(merges.len(), 1);
        assert_eq!(merges[0]["r0"], 1);
        assert_eq!(merges[0]["r1"], 3);
        // Column delete through the middle shrinks horizontally.
        run(&mut e, "deleteCols", json!({"from":3,"to":3})); // delete col C
        let d = run(&mut e, "describe", json!({})).data;
        let m = &d["sheets"][0]["merges"][0];
        assert_eq!(m["c0"], 1);
        assert_eq!(m["c1"], 2); // was D(3) -> C(2)
    }

    #[test]
    fn merge_undo_redo_and_snapshot_roundtrip() {
        let mut e = TallyEngine::new();
        run(&mut e, "mergeCells", json!({"range":{"from":"A1","to":"C1"}}));
        let saved = e.snapshot().unwrap();
        // Schema 8 emitted.
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), saved);
        // Undo removes the merge; redo restores.
        assert!(e.undo().unwrap());
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(field_len(&d["sheets"][0], "merges"), 0);
        assert!(e.redo().unwrap());
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(field_len(&d["sheets"][0], "merges"), 1);
    }

    #[test]
    fn hostile_restore_rejects_bad_merges() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"x"}));
        // Craft schema:8 doc with hostile merges.
        let base = json!({
            "kind":"tally","schema":8,
            "document":{
                "next_sheet":1,
                "sheets":[{"id":0,"name":"S","cells":{},"merges":[{"c0":0,"r0":0,"c1":1,"r1":1}]}],
                "active":0
            }
        });
        let env = |v: &Value| encode_envelope(&serde_json::to_vec(v).unwrap());
        // Valid minimal merge restores.
        let mut e2 = TallyEngine::new();
        e2.restore(&env(&base)).unwrap();
        let stable = e2.snapshot().unwrap();
        let d = run(&mut e2, "describe", json!({})).data;
        assert_eq!(field_len(&d["sheets"][0], "merges"), 1);
        // Overlapping merges reject and leave state untouched.
        let mut bad = base.clone();
        bad["document"]["sheets"][0]["merges"] = json!([
            {"c0":0,"r0":0,"c1":1,"r1":1},
            {"c0":1,"r0":1,"c1":2,"r1":2}
        ]);
        assert!(e2.restore(&env(&bad)).is_err());
        assert_eq!(e2.snapshot().unwrap(), stable);
        // Single-cell merge rejects.
        let mut bad = base.clone();
        bad["document"]["sheets"][0]["merges"] = json!([{"c0":0,"r0":0,"c1":0,"r1":0}]);
        assert!(e2.restore(&env(&bad)).is_err());
        assert_eq!(e2.snapshot().unwrap(), stable);
        // Out-of-bounds rejects.
        let mut bad = base.clone();
        bad["document"]["sheets"][0]["merges"] = json!([{"c0":0,"r0":0,"c1":20000,"r1":1}]);
        assert!(e2.restore(&env(&bad)).is_err());
        assert_eq!(e2.snapshot().unwrap(), stable);
        // Schema downgrade smuggling merges rejects.
        let mut bad = base.clone();
        bad["schema"] = json!(7);
        assert!(e2.restore(&env(&bad)).is_err());
        assert_eq!(e2.snapshot().unwrap(), stable);
        // Bare workbook with merges rejects (predates schema 8).
        let bare = json!({
            "next_sheet":1,
            "sheets":[{"id":0,"name":"S","cells":{},"merges":[{"c0":0,"r0":0,"c1":1,"r1":1}]}],
            "active":0
        });
        assert!(e2.restore(&env(&bare)).is_err());
        assert_eq!(e2.snapshot().unwrap(), stable);
        // Unknown merge field rejects (deny_unknown_fields).
        let mut bad = base.clone();
        bad["document"]["sheets"][0]["merges"] = json!([{"c0":0,"r0":0,"c1":1,"r1":1,"evil":1}]);
        assert!(e2.restore(&env(&bad)).is_err());
        assert_eq!(e2.snapshot().unwrap(), stable);
        // Reversed endpoints canonicalize on restore.
        let mut ok = base.clone();
        ok["document"]["sheets"][0]["merges"] = json!([{"c0":2,"r0":2,"c1":1,"r1":1}]);
        let mut e3 = TallyEngine::new();
        e3.restore(&env(&ok)).unwrap();
        let d = run(&mut e3, "listMergedCells", json!({})).data;
        assert_eq!(d["merges"][0]["from"], "B2");
        assert_eq!(d["merges"][0]["to"], "C3");
    }

    #[test]
    fn merge_ops_undo_redo_atomic() {
        let mut e = TallyEngine::new();
        run(&mut e, "mergeCells", json!({"range":{"from":"A1","to":"B1"}}));
        let before = e.snapshot().unwrap();
        // Failed merge leaves state and redo intact.
        assert!(e.apply(Command::new("mergeCells", json!({"range":{"from":"A1","to":"C1"}}))).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.undo().unwrap());
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(field_len(&d["sheets"][0], "merges"), 0);
        // Structural undo restores merges too (Reset entry covers doc):
        // the insert shifted D1:E1 to D2:E2; undoing returns D1:E1.
        run(&mut e, "mergeCells", json!({"range":{"from":"D1","to":"E1"}}));
        run(&mut e, "insertRows", json!({"from":1,"to":1}));
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(d["sheets"][0]["merges"][0]["r0"], 1);
        assert!(e.undo().unwrap()); // undo insert
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(d["sheets"][0]["merges"][0]["r0"], 0);
        assert_eq!(d["sheets"][0]["merges"][0]["c0"], 3);
    }

    #[test]
    fn insert_growing_merge_past_cell_cap_rejects_atomically() {
        let mut e = TallyEngine::new();
        // Exactly at the shared 16,384-cell cap: 16 cols x 1024 rows.
        run(&mut e, "mergeCells", json!({"range":{"from":"A1","to":"P1024"}}));
        let before = e.snapshot().unwrap();
        // A row inserted inside the merge would grow it to 16,400
        // cells — past the cap `merge_ok` enforces on restore — so the
        // whole edit rejects rather than storing an unrestorable merge.
        let err = run_err(&mut e, "insertRows", json!({"from":2,"to":2}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(e.snapshot().unwrap(), before);
        // The pre-edit snapshot still restores cleanly.
        let mut e2 = TallyEngine::new();
        e2.restore(&before).unwrap();
        let d = run(&mut e2, "listMergedCells", json!({})).data;
        assert_eq!(d["merges"].as_array().unwrap().len(), 1);
    }
}
