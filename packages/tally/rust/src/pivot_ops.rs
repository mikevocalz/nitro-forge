//! Durable workbook-level pivot-table specs and the
//! `insertPivot`/`updatePivot`/`removePivot`/`listPivots`/`describePivot`
//! ops (P12-P14 backlog item 11, slice A — spec storage/create/read/delete).
//!
//! Model decision: pivots are **workbook-level entries** like charts and
//! named ranges — `PivotSpec = { id, sheet, name?, source, rows,
//! columns, values, filters?, sort? }` where `sheet` is the durable id of
//! the *output* sheet the pivot belongs to and `source = { sheet,
//! range }` names the durable id of the sheet holding the source data
//! plus a canonical `"A1"`/`"A1:B2"` rectangle on it (both reuse
//! `name_ops::parse_refers_to`, capped at the shared 16,384-cell bound).
//! At most `MAX_PIVOTS` per workbook.
//!
//! **Field references are 0-based column offsets into the source range**,
//! not header names: `rows`/`columns` are lists of field indices,
//! `values` is a list of `{field, agg}` and `filters` a list of
//! `{field, values}`. Index references are robust — they do not depend
//! on the header row's text (which slice A does not require to exist or
//! be unique) and survive header renames; a later refresh slice can add
//! name resolution on top. `agg` is the bounded `sum|count|avg|min|max`
//! enum; `sort` is an optional `{field, ascending}` ordering hint.
//! Duplicate field indices reject inside `rows` and inside `columns`;
//! `values` may repeat a field under different aggregations; each
//! `filters` entry needs a unique field and 1–64 bounded values.
//!
//! **Materialization (slice B)**: `refreshPivot {id}` /
//! `refreshAllPivots {}` compute the pivot grid from the *computed* source
//! cells and write it as ordinary cells on the output sheet, anchored at
//! `output.anchor` (default `"A1"`). Layout: one header row, then one row
//! per distinct row-group; the first `rows.len()` columns carry the row
//! group labels (one per row field), followed by `columns-groups ×
//! values` aggregate columns. Group order is first-occurrence after the
//! optional `sort` reorders source records; aggregations read computed
//! values — only finite numbers feed `sum`/`avg`/`min`/`max`, `count`
//! counts non-empty cells, errors never propagate. The spec's `output`
//! records the anchor plus the last materialized `(rows, cols)` footprint
//! so a refresh clears exactly the previous grid before writing the new
//! one; an identical refresh stages zero cell writes and is eventless.
//! Materialized cells are normal cells — structural edits, formats and
//! undo treat them like any other content. `refreshAllPivots` skips
//! pivots whose output sheet is protected; `refreshPivot` is gated by
//! the output sheet like the other pivot mutations.
//!
//! `updatePivot {id, patch}` is a partial patch like `updateChart`:
//! present keys set, explicit `null` clears `name`/`filters`/`sort`/
//! `output`, `source`/`rows`/`columns`/`values` cannot be nulled, unknown patch
//! keys and a `sheet` field alongside `id` reject. An update that
//! leaves the spec unchanged is eventless. `insertPivot` always creates
//! (duplicate specs are allowed — pivots are objects, not keyed rules).
//! `removePivot`/`updatePivot` take `id` only.
//!
//! `removeSheet` cascade-drops pivots bound to the removed sheet **as
//! output sheet or as source sheet** — a pivot whose source data is gone
//! cannot compute, so it drops with it (recorded in the same undo entry;
//! undo re-admits each only while it still satisfies the restore
//! invariants). `duplicateSheet`/`moveSheet`/`renameSheet` do not copy
//! or retarget pivots.
//!
//! Structural edits: a pivot's `source.range` is coordinate-bound, so it
//! participates in `remap_band` like charts/views — inserts shift and
//! expand it, deletes shrink it, and a source range fully covered by a
//! deleted band (or column-shrunk below a referenced field index)
//! drops the pivot. `output.anchor` is a fixed top-left that does not
//! remap; the materialized cells themselves are ordinary cells and do.
//!
//! Protection: pivots are workbook metadata bound to an output sheet, so
//! mutations are guarded by that sheet exactly like chart ops (see
//! `protection.rs`); the source sheet is a read reference and does not
//! gate. `listPivots`/`describePivot` are ungated reads.
use super::range_ops::Rect;
use super::sort_ops::{cmp_in_class, rank, sort_val, SortKeyVal};
use super::*;
use std::cmp::Ordering;

/// Maximum pivot specs per workbook.
pub const MAX_PIVOTS: usize = 256;
/// Maximum field indices in `rows` and in `columns` each.
pub const MAX_PIVOT_AXIS_FIELDS: usize = 16;
/// Maximum `{field, agg}` entries in `values`.
pub const MAX_PIVOT_VALUES: usize = 16;
/// Maximum `{field, values}` entries in `filters`.
pub const MAX_PIVOT_FILTERS: usize = 32;
/// Maximum literal values per filter entry.
pub const MAX_PIVOT_FILTER_VALUES: usize = 64;
/// `name` bound in UTF-8 bytes.
pub const MAX_PIVOT_NAME_LEN: usize = 128;
/// Filter value bound in UTF-8 bytes.
pub const MAX_PIVOT_FILTER_VALUE_LEN: usize = 512;

/// Bounded aggregation kinds for `values` entries.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PivotAgg {
    Sum,
    Count,
    Avg,
    Min,
    Max,
}

/// One aggregated value slot: `field` is a 0-based column offset into the
/// source range, `agg` the bounded aggregation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotValue {
    pub field: u32,
    pub agg: PivotAgg,
}

/// One field filter: `field` a 0-based column offset into the source
/// range, `values` the 1–64 accepted literal values (≤512 bytes each).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotFilter {
    pub field: u32,
    pub values: Vec<String>,
}

/// Optional result ordering hint over one source field.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotSort {
    pub field: u32,
    pub ascending: bool,
}

/// Source data binding: durable sheet id plus canonical range.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotSource {
    pub sheet: u64,
    pub range: String,
}

/// Materialization anchor plus the last-written grid footprint.
/// `anchor` is a canonical single-cell `"A1"` address on the output
/// sheet; `rows`/`cols` are the dimensions of the grid the last
/// `refreshPivot`/`refreshAllPivots` wrote (header row included), `0/0`
/// when nothing is materialized. `rows`/`cols` are engine-managed — spec
/// inputs and patches only ever set `anchor`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotOutput {
    pub anchor: String,
    pub rows: u32,
    pub cols: u32,
}

/// One durable pivot spec: `id` a workbook-unique handle, `sheet` the
/// output sheet id, `source` the data binding, `output` the optional
/// materialization anchor/footprint.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PivotSpec {
    pub id: u64,
    pub sheet: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub source: PivotSource,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<u32>,
    pub values: Vec<PivotValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filters: Vec<PivotFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<PivotSort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<PivotOutput>,
}

/// `insertPivot`'s `pivot` payload (id/sheet are engine-assigned).
/// `source.sheet` accepts a sheet name or index and defaults to the
/// pivot's output sheet.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PivotInput {
    #[serde(default)]
    name: Option<String>,
    source: PivotSourceInput,
    #[serde(default)]
    rows: Vec<u32>,
    #[serde(default)]
    columns: Vec<u32>,
    values: Vec<PivotValue>,
    #[serde(default)]
    filters: Option<Vec<PivotFilter>>,
    #[serde(default)]
    sort: Option<PivotSort>,
    #[serde(default)]
    output: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PivotSourceInput {
    #[serde(default)]
    sheet: Option<Value>,
    range: Value,
}

/// Parsed `updatePivot` patch: `Some(None)` clears an optional field,
/// `Some(Some(_))` sets it, outer `None` leaves it untouched.
struct PivotPatch {
    name: Option<Option<String>>,
    source_sheet: Option<u64>,
    source_range: Option<name_ops::RefersCoords>,
    rows: Option<Vec<u32>>,
    columns: Option<Vec<u32>>,
    values: Option<Vec<PivotValue>>,
    filters: Option<Vec<PivotFilter>>,
    sort: Option<Option<PivotSort>>,
    /// `Some(Some(anchor))` retargets the output anchor (footprint dims
    /// reset to `0/0` — the old grid's cells are no longer tracked);
    /// `Some(None)` clears `output` entirely.
    output: Option<Option<String>>,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= MAX_PIVOT_NAME_LEN
}

fn valid_filter_values(values: &[String]) -> bool {
    !values.is_empty()
        && values.len() <= MAX_PIVOT_FILTER_VALUES
        && values
            .iter()
            .all(|v| !v.is_empty() && v.len() <= MAX_PIVOT_FILTER_VALUE_LEN)
}

/// Parse a user-supplied `output` anchor (`"A1"`-style cell address,
/// `$`/case tolerated) into its canonical stored form. `None` rejects.
fn parse_output_anchor(v: &str) -> Option<String> {
    let (c, r) = formula::parse_addr(v)?;
    if !formula::on_sheet(c, r) {
        return None;
    }
    Some(formula::fmt_addr(c, r))
}

/// Stored-`output` invariants for hostile restore and undo re-admission:
/// canonical on-sheet anchor, footprint either `0/0` (never materialized)
/// or a positive rectangle that fits the sheet and the shared cell cap.
fn output_ok(o: &PivotOutput) -> bool {
    let Some((c, r)) = formula::parse_addr(&o.anchor) else {
        return false;
    };
    if !formula::on_sheet(c, r) || formula::fmt_addr(c, r) != o.anchor {
        return false;
    }
    if (o.rows == 0) != (o.cols == 0) {
        return false;
    }
    if o.rows == 0 {
        return true;
    }
    u64::from(o.rows) * u64::from(o.cols) <= MAX_GET_RANGE_CELLS
        && u64::from(c) + u64::from(o.cols) <= u64::from(formula::SHEET_MAX_COLUMNS)
        && u64::from(r) + u64::from(o.rows) <= u64::from(formula::SHEET_MAX_ROWS)
}

/// Column count of a canonical source range; `None` when unparseable.
fn source_width(range: &str) -> Option<u32> {
    let (c0, _, c1, _) = name_ops::parse_refers_to(range).ok()?;
    Some(c1 - c0 + 1)
}

/// Field-level checks shared by the op path, hostile restore, undo
/// re-admission and the structural remap (a column-shrunk source range
/// can push a referenced field index out of bounds).
pub(super) fn fields_ok(p: &PivotSpec) -> bool {
    let Some(width) = source_width(&p.source.range) else {
        return false;
    };
    let in_range = |f: u32| f < width;
    p.rows.len() <= MAX_PIVOT_AXIS_FIELDS
        && p.columns.len() <= MAX_PIVOT_AXIS_FIELDS
        && p.values.len() <= MAX_PIVOT_VALUES
        && !p.values.is_empty()
        && p.filters.len() <= MAX_PIVOT_FILTERS
        && p.rows.iter().all(|&f| in_range(f))
        && p.columns.iter().all(|&f| in_range(f))
        && p.values.iter().all(|v| in_range(v.field))
        && p.filters.iter().all(|f| {
            in_range(f.field)
                && valid_filter_values(&f.values)
        })
        && p.sort.as_ref().is_none_or(|s| in_range(s.field))
        && {
            let mut seen = std::collections::BTreeSet::new();
            p.rows.iter().all(|f| seen.insert(*f))
        }
        && {
            let mut seen = std::collections::BTreeSet::new();
            p.columns.iter().all(|f| seen.insert(*f))
        }
        && {
            let mut seen = std::collections::BTreeSet::new();
            p.filters.iter().all(|f| seen.insert(f.field))
        }
}

/// Inclusive 0-based rectangle of a stored canonical range.
fn spec_coords(range: &str) -> Option<name_ops::RefersCoords> {
    name_ops::parse_refers_to(range).ok()
}

fn cell_count(coords: name_ops::RefersCoords) -> u64 {
    u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
}

fn range_ok(range: &str) -> bool {
    spec_coords(range).is_some_and(|c| {
        name_ops::canonical_refers_to(c) == range && cell_count(c) <= MAX_GET_RANGE_CELLS
    })
}

/// Field-level check shared by hostile-restore (after canonicalization)
/// and undo re-admission: name bound, canonical in-cap source range,
/// bounded field lists; sheet existence is checked by the caller.
pub(super) fn stored_ok(p: &PivotSpec) -> bool {
    p.name.as_deref().is_none_or(valid_name)
        && range_ok(&p.source.range)
        && fields_ok(p)
        && p.output.as_ref().is_none_or(output_ok)
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped pivot
/// comes back only while it still satisfies every invariant `restore`
/// enforces — output and source sheets exist, unique id, under the cap,
/// stored spec valid. Pivots cannot be created for a sheet while it is
/// gone (sheet ids are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, pivot: &PivotSpec) -> bool {
    doc.pivots.len() < MAX_PIVOTS
        && !doc.pivots.iter().any(|p| p.id == pivot.id)
        && doc.sheets.iter().any(|s| s.id == pivot.sheet)
        && doc.sheets.iter().any(|s| s.id == pivot.source.sheet)
        && stored_ok(pivot)
}

/// Build a spec from parsed input minus id; shared by create and the
/// update patch's full-field sets. `source_sheet` is already resolved.
fn build_spec(
    sheet: u64,
    name: Option<String>,
    source_sheet: u64,
    source_range: String,
    rows: Vec<u32>,
    columns: Vec<u32>,
    values: Vec<PivotValue>,
    filters: Vec<PivotFilter>,
    sort: Option<PivotSort>,
    output: Option<PivotOutput>,
) -> Result<PivotSpec, EngineError> {
    if let Some(n) = &name {
        if !valid_name(n) {
            return Err(EngineError::validation(
                "pivot name must be 1-128 bytes",
            ));
        }
    }
    if rows.len() > MAX_PIVOT_AXIS_FIELDS || columns.len() > MAX_PIVOT_AXIS_FIELDS {
        return Err(EngineError::out_of_bounds(format!(
            "pivot row/column field limit of {MAX_PIVOT_AXIS_FIELDS} exceeded"
        )));
    }
    if values.is_empty() {
        return Err(EngineError::validation("pivot requires at least one value"));
    }
    if values.len() > MAX_PIVOT_VALUES {
        return Err(EngineError::out_of_bounds(format!(
            "pivot value limit of {MAX_PIVOT_VALUES} exceeded"
        )));
    }
    if filters.len() > MAX_PIVOT_FILTERS {
        return Err(EngineError::out_of_bounds(format!(
            "pivot filter limit of {MAX_PIVOT_FILTERS} exceeded"
        )));
    }
    for f in &filters {
        if !valid_filter_values(&f.values) {
            return Err(EngineError::validation(
                "pivot filter values must be 1-64 entries of 1-512 bytes",
            ));
        }
    }
    let spec = PivotSpec {
        id: 0,
        sheet,
        name,
        source: PivotSource {
            sheet: source_sheet,
            range: source_range,
        },
        rows,
        columns,
        values,
        filters,
        sort,
        output,
    };
    // Field indices are validated against the source width here so a bad
    // index rejects before any mutation; `fields_ok` re-checks the whole
    // stored shape.
    if !fields_ok(&spec) {
        return Err(EngineError::validation(
            "pivot field index is outside the source range",
        ));
    }
    Ok(spec)
}

/// Parse `insertPivot`'s `pivot` object into a spec minus id; `sheet` is
/// the resolved output sheet id and the default source sheet.
fn parse_pivot_input(
    e: &TallyEngine,
    v: &Value,
    sheet: u64,
) -> Result<PivotSpec, EngineError> {
    let input: PivotInput = serde_json::from_value(v.clone())
        .map_err(|e| EngineError::invalid(format!("invalid pivot spec: {e}")))?;
    let source_sheet = match &input.source.sheet {
        None | Some(Value::Null) => sheet,
        Some(v) => {
            let idx = e.resolve_sheet(v)?;
            e.doc.sheets[idx].id
        }
    };
    let rect = Rect::read(&input.source.range)?;
    let range = name_ops::canonical_refers_to(rect.coords());
    let output = match &input.output {
        None => None,
        Some(v) => Some(PivotOutput {
            anchor: parse_output_anchor(v).ok_or_else(|| {
                EngineError::validation("pivot output must be an on-sheet 'A1' address")
            })?,
            rows: 0,
            cols: 0,
        }),
    };
    build_spec(
        sheet,
        input.name,
        source_sheet,
        range,
        input.rows,
        input.columns,
        input.values,
        input.filters.unwrap_or_default(),
        input.sort,
        output,
    )
}

/// Parse `updatePivot`'s `patch` object. Unknown keys reject; `source`,
/// `rows`, `columns` and `values` cannot be null; `name`/`filters`/`sort`
/// accept null to clear. `source` is a partial `{sheet?,range?}` object —
/// at least one key required.
fn parse_pivot_patch(e: &TallyEngine, v: &Value) -> Result<PivotPatch, EngineError> {
    let obj = v
        .as_object()
        .ok_or_else(|| EngineError::invalid("pivot patch must be an object"))?;
    for key in obj.keys() {
        if !matches!(
            key.as_str(),
            "name" | "source" | "rows" | "columns" | "values" | "filters" | "sort" | "output"
        ) {
            return Err(EngineError::invalid(format!(
                "unknown pivot patch field '{key}'"
            )));
        }
    }
    let name = match obj.get("name") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(t)) if valid_name(t) => Some(Some(t.clone())),
        Some(_) => {
            return Err(EngineError::validation(
                "pivot name must be 1-128 bytes or null",
            ))
        }
    };
    let (source_sheet, source_range) = match obj.get("source") {
        None => (None, None),
        Some(Value::Null) => {
            return Err(EngineError::invalid("pivot patch 'source' cannot be null"))
        }
        Some(v) => {
            let sobj = v
                .as_object()
                .ok_or_else(|| EngineError::invalid("pivot patch 'source' must be an object"))?;
            for key in sobj.keys() {
                if !matches!(key.as_str(), "sheet" | "range") {
                    return Err(EngineError::invalid(format!(
                        "unknown pivot source field '{key}'"
                    )));
                }
            }
            let sheet = match sobj.get("sheet") {
                None | Some(Value::Null) => None,
                Some(v) => Some(e.doc.sheets[e.resolve_sheet(v)?].id),
            };
            let range = match sobj.get("range") {
                None => None,
                Some(Value::Null) => {
                    return Err(EngineError::invalid(
                        "pivot source 'range' cannot be null",
                    ))
                }
                Some(v) => Some(Rect::read(v)?.coords()),
            };
            if sheet.is_none() && range.is_none() {
                return Err(EngineError::invalid(
                    "pivot patch 'source' needs 'sheet' and/or 'range'",
                ));
            }
            (sheet, range)
        }
    };
    let field_list = |key: &str| -> Result<Option<Vec<u32>>, EngineError> {
        match obj.get(key) {
            None => Ok(None),
            Some(Value::Null) => Err(EngineError::invalid(format!(
                "pivot patch '{key}' cannot be null"
            ))),
            Some(v) => {
                let list: Vec<u32> = serde_json::from_value(v.clone())
                    .map_err(|e| EngineError::invalid(format!("invalid pivot {key}: {e}")))?;
                Ok(Some(list))
            }
        }
    };
    let rows = field_list("rows")?;
    let columns = field_list("columns")?;
    let values = match obj.get("values") {
        None => None,
        Some(Value::Null) => {
            return Err(EngineError::invalid("pivot patch 'values' cannot be null"))
        }
        Some(v) => Some(
            serde_json::from_value::<Vec<PivotValue>>(v.clone())
                .map_err(|e| EngineError::invalid(format!("invalid pivot values: {e}")))?,
        ),
    };
    let filters = match obj.get("filters") {
        None => None,
        Some(Value::Null) => Some(Vec::new()),
        Some(v) => Some(
            serde_json::from_value::<Vec<PivotFilter>>(v.clone())
                .map_err(|e| EngineError::invalid(format!("invalid pivot filters: {e}")))?,
        ),
    };
    let sort = match obj.get("sort") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => Some(Some(
            serde_json::from_value::<PivotSort>(v.clone())
                .map_err(|e| EngineError::invalid(format!("invalid pivot sort: {e}")))?,
        )),
    };
    let output = match obj.get("output") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => match parse_output_anchor(s) {
            Some(anchor) => Some(Some(anchor)),
            None => {
                return Err(EngineError::validation(
                    "pivot output must be an on-sheet 'A1' address or null",
                ))
            }
        },
        Some(_) => {
            return Err(EngineError::invalid(
                "pivot patch 'output' must be an 'A1' address string or null",
            ))
        }
    };
    Ok(PivotPatch {
        name,
        source_sheet,
        source_range,
        rows,
        columns,
        values,
        filters,
        sort,
        output,
    })
}

// ---------------------------------------------------------------------------
// Materialization (refreshPivot / refreshAllPivots)
// ---------------------------------------------------------------------------

/// Display text of a computed scalar — group labels, filter matching and
/// written cell raws all share this canonical form.
fn display_text(v: &formula::Value) -> String {
    match v {
        formula::Value::Empty => String::new(),
        formula::Value::Num(n) if n.is_finite() => formula::fmt_num(*n),
        formula::Value::Num(_) => formula::ERR_NUM.to_string(),
        formula::Value::Str(s) => s.clone(),
        formula::Value::Bool(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        formula::Value::Err(e) => (*e).to_string(),
        // `eval_cell` scalarizes ranges, so `List` cannot appear; map it
        // defensively like every other non-scalar.
        formula::Value::List(_) => formula::ERR_VALUE.to_string(),
    }
}

/// Type-tagged grouping/filter key for a computed scalar: distinct value
/// classes never collide (`Str("b1")` ≠ `Bool(true)`, `Num(1)` ≠ `Str("1")`).
fn vkey(v: &formula::Value) -> String {
    match v {
        formula::Value::Empty => "e".to_string(),
        formula::Value::Num(n) if n.is_finite() => {
            // Normalize -0.0 so it groups with 0.0.
            let n = if *n == 0.0 { 0.0 } else { *n };
            format!("n{}", n.to_bits())
        }
        formula::Value::Num(_) => "r#NUM!".to_string(),
        formula::Value::Str(s) => format!("s{s}"),
        formula::Value::Bool(b) => {
            if *b {
                "b1".to_string()
            } else {
                "b0".to_string()
            }
        }
        formula::Value::Err(e) => format!("r{e}"),
        formula::Value::List(_) => "l".to_string(),
    }
}

/// Per-(row-group, column-group, value-slot) aggregate state. Only finite
/// `Num` values feed the numeric aggregations; `count` counts every
/// non-empty scalar (errors included — they never propagate).
struct PivotAcc {
    nonempty: u64,
    nums: u64,
    sum: f64,
    min: f64,
    max: f64,
}

impl PivotAcc {
    fn new() -> Self {
        Self {
            nonempty: 0,
            nums: 0,
            sum: 0.0,
            min: f64::INFINITY,
            max: f64::NEG_INFINITY,
        }
    }
    fn add(&mut self, v: &formula::Value) {
        match v {
            formula::Value::Empty => {}
            formula::Value::Num(n) if n.is_finite() => {
                self.nonempty += 1;
                self.nums += 1;
                self.sum += n;
                self.min = self.min.min(*n);
                self.max = self.max.max(*n);
            }
            _ => self.nonempty += 1,
        }
    }
    /// Raw text to store; `""` clears the cell. Non-finite results
    /// (overflowed `sum`/`avg`) write empty rather than a non-numeric raw.
    fn raw(&self, agg: PivotAgg) -> String {
        let finite = |x: f64| x.is_finite().then(|| formula::fmt_num(x)).unwrap_or_default();
        match agg {
            PivotAgg::Count => formula::fmt_num(self.nonempty as f64),
            PivotAgg::Sum => {
                if self.nums > 0 {
                    finite(self.sum)
                } else {
                    String::new()
                }
            }
            PivotAgg::Avg => {
                if self.nums > 0 {
                    finite(self.sum / self.nums as f64)
                } else {
                    String::new()
                }
            }
            PivotAgg::Min => {
                if self.nums > 0 {
                    finite(self.min)
                } else {
                    String::new()
                }
            }
            PivotAgg::Max => {
                if self.nums > 0 {
                    finite(self.max)
                } else {
                    String::new()
                }
            }
        }
    }
}

/// A fully computed refresh: `want` is every cell of the new output rect
/// (plus `""` clears for the previous footprint), `output` the spec's new
/// recorded footprint.
struct RefreshPlan {
    want: std::collections::BTreeMap<String, String>,
    output: PivotOutput,
}

impl TallyEngine {
    /// Compute one pivot's output grid without mutating. Returns `None`
    /// when the refresh would be a no-op (every wanted raw already stored
    /// and the recorded footprint unchanged) — the eventless path.
    /// All bounds are checked here, before any mutation: source cells are
    /// capped by the shared 16,384-cell range bound, output cells by the
    /// same cap, and group counts are derived from filtered records.
    fn plan_refresh(&self, spec: &PivotSpec) -> Result<Option<RefreshPlan>, EngineError> {
        let src_idx = self
            .doc
            .sheets
            .iter()
            .position(|s| s.id == spec.source.sheet)
            .ok_or_else(|| EngineError::not_found("pivot source sheet is gone"))?;
        let out_idx = self
            .doc
            .sheets
            .iter()
            .position(|s| s.id == spec.sheet)
            .ok_or_else(|| EngineError::not_found("pivot output sheet is gone"))?;
        let Some((c0, r0, c1, r1)) = spec_coords(&spec.source.range) else {
            return Err(EngineError::validation("pivot source range is invalid"));
        };
        let width = (c1 - c0 + 1) as usize;
        let height = (r1 - r0 + 1) as usize;
        let anchor = spec
            .output
            .as_ref()
            .map(|o| o.anchor.clone())
            .unwrap_or_else(|| "A1".to_string());
        // `output_ok`/insert-time validation guarantee a canonical
        // on-sheet anchor; re-parse defensively anyway.
        let Some((ac, ar)) = formula::parse_addr(&anchor).filter(|&(c, r)| formula::on_sheet(c, r))
        else {
            return Err(EngineError::validation("pivot output anchor is invalid"));
        };
        // Evaluate every source cell once, against the source sheet's own
        // context (formulas resolve bare refs on their own sheet).
        let mut ev = self.evaluator_for(src_idx);
        let mut records: Vec<Vec<formula::Value>> = Vec::with_capacity(height);
        for r in r0..=r1 {
            let mut row = Vec::with_capacity(width);
            for c in c0..=c1 {
                if ev.charge_work(1).is_err() {
                    return Err(EngineError::validation(
                        "pivot evaluation exceeded the work allowance",
                    ));
                }
                row.push(ev.eval_cell(&fmt_addr(c, r)));
            }
            records.push(row);
        }
        // Field filters: a record passes when every filter's display text
        // is one of its accepted literals (AND across filters).
        let mut kept: Vec<usize> = (0..records.len()).collect();
        kept.retain(|&i| {
            spec.filters.iter().all(|f| {
                let text = display_text(&records[i][f.field as usize]);
                f.values.iter().any(|v| v == &text)
            })
        });
        // Optional sort: stable reorder of the kept records by the computed
        // value at `sort.field`, using the sortRange class order (errors
        // last in both directions). Group keys then appear in
        // first-occurrence order.
        if let Some(s) = &spec.sort {
            let f = s.field as usize;
            let keys: Vec<SortKeyVal> =
                kept.iter().map(|&i| sort_val(&records[i][f])).collect();
            let mut order: Vec<usize> = (0..kept.len()).collect();
            let asc = s.ascending;
            order.sort_by(|&a, &b| {
                let ra = rank(&keys[a]);
                let rb = rank(&keys[b]);
                if ra != rb {
                    return ra.cmp(&rb);
                }
                if ra == 4 {
                    return Ordering::Equal; // both errors: stable tie
                }
                let ord = cmp_in_class(&keys[a], &keys[b]);
                if asc {
                    ord
                } else {
                    ord.reverse()
                }
            });
            kept = order.iter().map(|&i| kept[i]).collect();
        }
        // Group kept records into distinct row/column key tuples, in
        // first-occurrence order. An empty axis is a single empty group —
        // but only when at least one record survives the filters.
        let mut row_groups: Vec<Vec<formula::Value>> = Vec::new();
        let mut row_map: std::collections::BTreeMap<Vec<String>, usize> =
            std::collections::BTreeMap::new();
        let mut col_groups: Vec<Vec<formula::Value>> = Vec::new();
        let mut col_map: std::collections::BTreeMap<Vec<String>, usize> =
            std::collections::BTreeMap::new();
        let mut pairs: Vec<(usize, usize)> = Vec::with_capacity(kept.len());
        for &i in &kept {
            let rec = &records[i];
            let rkey: Vec<String> = spec
                .rows
                .iter()
                .map(|&f| vkey(&rec[f as usize]))
                .collect();
            let ri = match row_map.get(&rkey) {
                Some(&ri) => ri,
                None => {
                    let ri = row_groups.len();
                    row_groups.push(
                        spec.rows.iter().map(|&f| rec[f as usize].clone()).collect(),
                    );
                    row_map.insert(rkey, ri);
                    ri
                }
            };
            let ckey: Vec<String> = spec
                .columns
                .iter()
                .map(|&f| vkey(&rec[f as usize]))
                .collect();
            let ci = match col_map.get(&ckey) {
                Some(&ci) => ci,
                None => {
                    let ci = col_groups.len();
                    col_groups.push(
                        spec.columns
                            .iter()
                            .map(|&f| rec[f as usize].clone())
                            .collect(),
                    );
                    col_map.insert(ckey, ci);
                    ci
                }
            };
            pairs.push((ri, ci));
        }
        let r_groups = row_groups.len();
        let c_groups = col_groups.len();
        let v_slots = spec.values.len();
        let label_cols = spec.rows.len();
        // Output rect: 1 header row + one row per row group; label columns
        // plus column-groups × value slots. `cols_out == 0` means no
        // records survived and there are no label columns — an empty
        // grid that only clears the previous footprint.
        let cols_out = label_cols + c_groups * v_slots;
        let rows_out = 1 + r_groups;
        if cols_out > 0 {
            let cells_out = rows_out as u64 * cols_out as u64;
            if cells_out > MAX_GET_RANGE_CELLS {
                return Err(EngineError::out_of_bounds(format!(
                    "pivot output {rows_out}x{cols_out} exceeds the {MAX_GET_RANGE_CELLS}-cell limit"
                )));
            }
            if u64::from(ac) + cols_out as u64 > u64::from(formula::SHEET_MAX_COLUMNS)
                || u64::from(ar) + rows_out as u64 > u64::from(formula::SHEET_MAX_ROWS)
            {
                return Err(EngineError::out_of_bounds(
                    "pivot output anchor leaves no room for the grid on the sheet",
                ));
            }
        }
        // Stage every cell of the new rect plus "" clears for the previous
        // footprint (when the anchor moved via patch, dims reset to 0/0 and
        // the old cells are simply left alone — documented).
        let mut want = std::collections::BTreeMap::new();
        if let Some(o) = &spec.output {
            if o.rows > 0 && o.cols > 0 {
                if let Some((oc, orr)) = formula::parse_addr(&o.anchor) {
                    for rr in orr..orr + o.rows {
                        for cc in oc..oc + o.cols {
                            want.insert(fmt_addr(cc, rr), String::new());
                        }
                    }
                }
            }
        }
        if cols_out > 0 {
            let agg_name = |a: PivotAgg| match a {
                PivotAgg::Sum => "sum",
                PivotAgg::Count => "count",
                PivotAgg::Avg => "avg",
                PivotAgg::Min => "min",
                PivotAgg::Max => "max",
            };
            // Header row: label columns stay empty (written "" so the
            // pivot owns its whole rect); each value column gets
            // "<col-group labels> | <agg>:<field>" (labels omitted when
            // the pivot has no column fields).
            for j in 0..label_cols {
                want.insert(fmt_addr(ac + j as u32, ar), String::new());
            }
            for ci in 0..c_groups {
                let colpart = if spec.columns.is_empty() {
                    String::new()
                } else {
                    col_groups[ci]
                        .iter()
                        .map(display_text)
                        .collect::<Vec<_>>()
                        .join(" / ")
                };
                for (si, v) in spec.values.iter().enumerate() {
                    let valpart = format!("{}:{}", agg_name(v.agg), v.field);
                    let text = if colpart.is_empty() {
                        valpart
                    } else {
                        format!("{colpart} | {valpart}")
                    };
                    want.insert(
                        fmt_addr(ac + label_cols as u32 + (ci * v_slots + si) as u32, ar),
                        text,
                    );
                }
            }
            // Data rows.
            let mut stats: std::collections::BTreeMap<(usize, usize), Vec<PivotAcc>> =
                std::collections::BTreeMap::new();
            for (pos, &(ri, ci)) in pairs.iter().enumerate() {
                let rec = &records[kept[pos]];
                let entry = stats
                    .entry((ri, ci))
                    .or_insert_with(|| (0..v_slots).map(|_| PivotAcc::new()).collect());
                for (si, v) in spec.values.iter().enumerate() {
                    entry[si].add(&rec[v.field as usize]);
                }
            }
            for ri in 0..r_groups {
                let row = ar + 1 + ri as u32;
                for (j, cell) in row_groups[ri].iter().enumerate() {
                    want.insert(fmt_addr(ac + j as u32, row), display_text(cell));
                }
                for ci in 0..c_groups {
                    let accs = stats.get(&(ri, ci));
                    for (si, v) in spec.values.iter().enumerate() {
                        let raw = accs
                            .map(|a| a[si].raw(v.agg))
                            .unwrap_or_default();
                        want.insert(
                            fmt_addr(
                                ac + label_cols as u32 + (ci * v_slots + si) as u32,
                                row,
                            ),
                            raw,
                        );
                    }
                }
            }
        }
        let new_output = PivotOutput {
            anchor,
            rows: if cols_out == 0 { 0 } else { rows_out as u32 },
            cols: cols_out as u32,
        };
        // Eventless check: no wanted raw differs from the stored cells and
        // the recorded footprint already matches.
        let sheet = &self.doc.sheets[out_idx];
        let differs = want.iter().any(|(addr, raw)| {
            sheet
                .cells
                .get(addr)
                .map(|c| c.raw.as_str())
                .unwrap_or("")
                != raw
        });
        if !differs && spec.output.as_ref() == Some(&new_output) {
            return Ok(None);
        }
        Ok(Some(RefreshPlan {
            want,
            output: new_output,
        }))
    }

    /// Apply a plan against the live document: diff `want` per cell,
    /// write the differences, record the new footprint. Returns the number
    /// of cells written. Caller records the undo entry.
    fn apply_refresh_plan(&mut self, pos: usize, plan: &RefreshPlan) -> usize {
        let sheet_id = self.doc.pivots[pos].sheet;
        let writes: Vec<(String, String)> = match self
            .doc
            .sheets
            .iter()
            .position(|s| s.id == sheet_id)
        {
            Some(si) => {
                let sheet = &self.doc.sheets[si];
                plan.want
                    .iter()
                    .filter(|(addr, raw)| {
                        sheet
                            .cells
                            .get(*addr)
                            .map(|c| c.raw.as_str())
                            .unwrap_or("")
                            != raw.as_str()
                    })
                    .map(|(a, r)| (a.clone(), r.clone()))
                    .collect()
            }
            None => Vec::new(),
        };
        let n = writes.len();
        if let Some(si) = self.doc.sheets.iter().position(|s| s.id == sheet_id) {
            let sheet = &mut self.doc.sheets[si];
            for (addr, raw) in writes {
                if raw.is_empty() {
                    sheet.cells.remove(&addr);
                } else {
                    sheet.cells.insert(addr, Cell { raw });
                }
            }
        }
        self.doc.pivots[pos].output = Some(plan.output.clone());
        n
    }

    /// `refreshPivot {id}` — materialize one pivot's grid on its output
    /// sheet. `sheet` alongside `id` rejects like the sibling pivot ops.
    /// One whole-document undo entry covers the cell writes and the spec's
    /// recorded footprint; an identical refresh is eventless.
    pub(super) fn op_refresh_pivot(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if p.get("sheet").is_some_and(|v| !v.is_null()) {
            return Err(EngineError::invalid(
                "refreshPivot 'sheet' is not allowed alongside 'id'",
            ));
        }
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .pivots
            .iter()
            .position(|pv| pv.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no pivot {id}")))?;
        let spec = self.doc.pivots[pos].clone();
        let Some(plan) = self.plan_refresh(&spec)? else {
            return Ok(Self::readonly(json!({ "changed": 0 })));
        };
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let changed = self.apply_refresh_plan(pos, &plan);
        Ok(Self::changed(json!({ "changed": changed })))
    }

    /// `refreshAllPivots {}` — materialize every pivot whose output sheet
    /// is unprotected, in spec order (later pivots win overlapping cells).
    /// One undo entry covers the whole batch; pivots on protected output
    /// sheets are skipped and reported, not errors.
    pub(super) fn op_refresh_all_pivots(&mut self, _p: &Value) -> Result<CommandResult, EngineError> {
        let mut plans: Vec<(usize, RefreshPlan)> = Vec::new();
        let mut skipped: Vec<u64> = Vec::new();
        for (pos, pv) in self.doc.pivots.iter().enumerate() {
            let protected = self
                .doc
                .sheets
                .iter()
                .any(|s| s.id == pv.sheet && s.is_protected);
            if protected {
                skipped.push(pv.id);
                continue;
            }
            if let Some(plan) = self.plan_refresh(pv)? {
                plans.push((pos, plan));
            }
        }
        if plans.is_empty() {
            return Ok(Self::readonly(json!({
                "changed": 0,
                "refreshed": 0,
                "skipped": skipped,
            })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let mut changed = 0usize;
        for (pos, plan) in &plans {
            changed += self.apply_refresh_plan(*pos, plan);
        }
        Ok(Self::changed(json!({
            "changed": changed,
            "refreshed": plans.len(),
            "skipped": skipped,
        })))
    }

    /// JSON view of one pivot with both bound sheets' *current* names
    /// resolved; optional fields appear only when set.
    fn pivot_json(&self, p: &PivotSpec) -> Result<Value, EngineError> {
        let sheet_name = |id: u64| {
            self.doc
                .sheets
                .iter()
                .find(|s| s.id == id)
                .map(|s| s.name.clone())
        };
        let mut out = serde_json::Map::new();
        out.insert("id".to_string(), json!(p.id));
        out.insert("sheet".to_string(), json!(sheet_name(p.sheet)));
        out.insert("sheet_id".to_string(), json!(p.sheet));
        if let Some(n) = &p.name {
            out.insert("name".to_string(), json!(n));
        }
        out.insert(
            "source".to_string(),
            json!({
                "sheet": sheet_name(p.source.sheet),
                "sheet_id": p.source.sheet,
                "range": p.source.range,
            }),
        );
        out.insert("rows".to_string(), json!(p.rows));
        out.insert("columns".to_string(), json!(p.columns));
        out.insert("values".to_string(), serde_json::to_value(&p.values)?);
        if !p.filters.is_empty() {
            out.insert("filters".to_string(), serde_json::to_value(&p.filters)?);
        }
        if let Some(s) = &p.sort {
            out.insert("sort".to_string(), serde_json::to_value(s)?);
        }
        if let Some(o) = &p.output {
            out.insert("output".to_string(), serde_json::to_value(o)?);
        }
        Ok(Value::Object(out))
    }

    /// `insertPivot {sheet?, pivot:{name?,source:{sheet?,range:{from,to}},
    /// rows, columns, values, filters?, sort?, output?}}` — store a pivot
    /// spec bound to the resolved output sheet. Always appends with a
    /// fresh workbook-unique id; duplicate specs are allowed. Writes no
    /// cells — `refreshPivot`/`refreshAllPivots` materialize the grid.
    pub(super) fn op_insert_pivot(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let mut spec = parse_pivot_input(self, Self::field(p, "pivot")?, sheet_id)?;
        if self.doc.pivots.len() >= MAX_PIVOTS {
            return Err(EngineError::out_of_bounds(format!(
                "pivot limit of {MAX_PIVOTS} reached"
            )));
        }
        let id = self.doc.next_pivot;
        self.doc.next_pivot = self
            .doc
            .next_pivot
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("pivot id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        spec.id = id;
        self.doc.pivots.push(spec.clone());
        Ok(Self::changed(json!({ "pivot": self.pivot_json(&spec)? })))
    }

    /// `updatePivot {id, patch:{…}}` — partial patch over the stored spec;
    /// present keys set, `null` clears `name`/`filters`/`sort`, unknown
    /// keys and a `sheet` field alongside `id` reject. An unchanged spec
    /// is eventless.
    pub(super) fn op_update_pivot(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if p.get("sheet").is_some_and(|v| !v.is_null()) {
            return Err(EngineError::invalid(
                "updatePivot 'sheet' is not allowed alongside 'id'",
            ));
        }
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let patch = parse_pivot_patch(self, Self::field(p, "patch")?)?;
        let pos = self
            .doc
            .pivots
            .iter()
            .position(|pv| pv.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no pivot {id}")))?;
        let mut next = self.doc.pivots[pos].clone();
        if let Some(n) = patch.name {
            next.name = n;
        }
        if patch.source_sheet.is_some() || patch.source_range.is_some() {
            if let Some(s) = patch.source_sheet {
                next.source.sheet = s;
            }
            if let Some(r) = patch.source_range {
                next.source.range = name_ops::canonical_refers_to(r);
            }
        }
        if let Some(r) = patch.rows {
            next.rows = r;
        }
        if let Some(c) = patch.columns {
            next.columns = c;
        }
        if let Some(v) = patch.values {
            next.values = v;
        }
        if let Some(f) = patch.filters {
            next.filters = f;
        }
        if let Some(s) = patch.sort {
            next.sort = s;
        }
        if let Some(o) = patch.output {
            // Retargeting the anchor drops the recorded footprint — the
            // old grid's cells are no longer tracked for clearing.
            next.output = o.map(|anchor| PivotOutput {
                anchor,
                rows: 0,
                cols: 0,
            });
        }
        // Validate the merged spec before committing: name bound, caps,
        // field indices inside the (possibly new) source width, stored
        // output footprint sane.
        if next.name.as_deref().is_some_and(|n| !valid_name(n))
            || next.values.is_empty()
            || next.values.len() > MAX_PIVOT_VALUES
            || next.rows.len() > MAX_PIVOT_AXIS_FIELDS
            || next.columns.len() > MAX_PIVOT_AXIS_FIELDS
            || next.filters.len() > MAX_PIVOT_FILTERS
            || !next
                .filters
                .iter()
                .all(|f| valid_filter_values(&f.values))
            || !fields_ok(&next)
            || !next.output.as_ref().is_none_or(output_ok)
        {
            return Err(EngineError::validation("invalid pivot spec"));
        }
        if next == self.doc.pivots[pos] {
            return Ok(Self::readonly(json!({
                "pivot": self.pivot_json(&self.doc.pivots[pos].clone())?
            })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.pivots[pos] = next.clone();
        Ok(Self::changed(json!({ "pivot": self.pivot_json(&next)? })))
    }

    /// `removePivot {id}` — remove one pivot; `sheet` alongside `id`
    /// rejects like the `clear*` mixed-selector precedent.
    pub(super) fn op_remove_pivot(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if p.get("sheet").is_some_and(|v| !v.is_null()) {
            return Err(EngineError::invalid(
                "removePivot 'sheet' is not allowed alongside 'id'",
            ));
        }
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .pivots
            .iter()
            .position(|pv| pv.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no pivot {id}")))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.pivots.remove(pos);
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// `listPivots {sheet?}` — silent read; `sheet` absent lists every
    /// pivot in the workbook, present filters to that *output* sheet.
    pub(super) fn op_list_pivots(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let pivots: Vec<&PivotSpec> = match p.get("sheet") {
            None | Some(Value::Null) => self.doc.pivots.iter().collect(),
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                let sheet_id = self.doc.sheets[idx].id;
                self.doc
                    .pivots
                    .iter()
                    .filter(|pv| pv.sheet == sheet_id)
                    .collect()
            }
        };
        let mut out = Vec::with_capacity(pivots.len());
        for pv in pivots {
            out.push(self.pivot_json(pv)?);
        }
        Ok(Self::readonly(json!({ "pivots": out })))
    }

    /// `describePivot {id}` — silent read of one pivot spec.
    pub(super) fn op_describe_pivot(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pv = self
            .doc
            .pivots
            .iter()
            .find(|pv| pv.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no pivot {id}")))?;
        Ok(Self::readonly(json!({
            "pivot": self.pivot_json(pv)?
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;

    fn apply(e: &mut TallyEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn apply_err(e: &mut TallyEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }
    fn data(e: &mut TallyEngine, op: &str, p: Value) -> Value {
        apply(e, op, p).data
    }
    fn pivots(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "listPivots", json!({}))["pivots"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn insert(e: &mut TallyEngine, pivot: Value) -> Value {
        data(e, "insertPivot", json!({"pivot":pivot}))["pivot"].clone()
    }
    fn insert_on(e: &mut TallyEngine, sheet: &str, pivot: Value) -> Value {
        data(e, "insertPivot", json!({"sheet":sheet,"pivot":pivot}))["pivot"].clone()
    }
    fn base_pivot() -> Value {
        json!({
            "source": {"range": {"from":"A1","to":"D10"}},
            "rows": [0],
            "columns": [1],
            "values": [{"field":2,"agg":"sum"},{"field":3,"agg":"count"}]
        })
    }

    #[test]
    fn insert_list_describe_remove_roundtrip() {
        let mut e = TallyEngine::new();
        let p = insert(&mut e, json!({
            "name":"Sales",
            "source": {"sheet":"Sheet1","range": {"from":"B2","to":"E9"}},
            "rows": [0,2],
            "columns": [1],
            "values": [{"field":3,"agg":"avg"}],
            "filters": [{"field":0,"values":["east","west"]}],
            "sort": {"field":0,"ascending":false}
        }));
        assert_eq!(p["id"], json!(1));
        assert_eq!(p["sheet"], json!("Sheet1"));
        assert_eq!(p["sheet_id"], json!(0));
        assert_eq!(p["name"], json!("Sales"));
        assert_eq!(p["source"]["range"], json!("B2:E9"));
        assert_eq!(p["source"]["sheet_id"], json!(0));
        assert_eq!(p["rows"], json!([0,2]));
        assert_eq!(p["values"][0]["agg"], json!("avg"));
        assert_eq!(p["filters"][0]["values"], json!(["east","west"]));
        assert_eq!(p["sort"]["ascending"], json!(false));
        // describePivot returns the same spec.
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d, p);
        // listPivots filters by output sheet.
        assert_eq!(pivots(&mut e).len(), 1);
        data(&mut e, "addSheet", json!({"name":"Out"}));
        data(
            &mut e,
            "insertPivot",
            json!({"sheet":"Out","pivot":base_pivot()}),
        );
        let all = pivots(&mut e);
        assert_eq!(all.len(), 2);
        let on_out = data(&mut e, "listPivots", json!({"sheet":"Out"}))["pivots"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(on_out.len(), 1);
        assert_eq!(on_out[0]["sheet"], json!("Out"));
        // Storage only: no cells were written anywhere.
        let wb = data(&mut e, "workbook", json!({}));
        assert_eq!(wb["sheets"][0]["cell_count"], json!(0));
        // removePivot by id; sheet alongside id rejects.
        assert_eq!(
            apply_err(&mut e, "removePivot", json!({"id":1,"sheet":0})).code,
            ErrorCode::InvalidCommand
        );
        data(&mut e, "removePivot", json!({"id":1}));
        assert_eq!(pivots(&mut e).len(), 1);
        assert_eq!(
            apply_err(&mut e, "removePivot", json!({"id":1})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "describePivot", json!({"id":99})).code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn source_sheet_defaults_to_output_and_resolves_names() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        // Output on Sheet1 (active), source on "Data" by name.
        let p = insert(
            &mut e,
            json!({
                "source": {"sheet":"Data","range": {"from":"A1","to":"C4"}},
                "rows": [],
                "columns": [],
                "values": [{"field":0,"agg":"min"}]
            }),
        );
        assert_eq!(p["sheet"], json!("Sheet1"));
        assert_eq!(p["source"]["sheet"], json!("Data"));
        assert_eq!(p["source"]["sheet_id"], json!(1));
        // Omitted source.sheet defaults to the output sheet.
        let p2 = insert(&mut e, base_pivot());
        assert_eq!(p2["source"]["sheet_id"], json!(p2["sheet_id"]));
        // Bad source sheet name rejects atomically.
        let before = pivots(&mut e).len();
        assert_eq!(
            apply_err(
                &mut e,
                "insertPivot",
                json!({"pivot": {"source":{"sheet":"Nope","range":{"from":"A1","to":"A1"}},"values":[{"field":0,"agg":"sum"}]}})
            )
            .code,
            ErrorCode::NotFound
        );
        assert_eq!(pivots(&mut e).len(), before);
    }

    #[test]
    fn insert_validation_is_atomic() {
        let mut e = TallyEngine::new();
        let good = base_pivot();
        let cases: Vec<Value> = vec![
            // missing values
            json!({"source":{"range":{"from":"A1","to":"D2"}},"rows":[0],"columns":[]}),
            // empty values
            json!({"source":{"range":{"from":"A1","to":"D2"}},"values":[]}),
            // bad agg
            json!({"source":{"range":{"from":"A1","to":"D2"}},"values":[{"field":0,"agg":"median"}]}),
            // field index past source width (D2 = 4 cols → max index 3)
            json!({"source":{"range":{"from":"A1","to":"D2"}},"values":[{"field":4,"agg":"sum"}]}),
            json!({"source":{"range":{"from":"A1","to":"D2"}},"rows":[4],"values":[{"field":0,"agg":"sum"}]}),
            json!({"source":{"range":{"from":"A1","to":"D2"}},"columns":[9],"values":[{"field":0,"agg":"sum"}]}),
            // duplicate row fields
            json!({"source":{"range":{"from":"A1","to":"D2"}},"rows":[0,0],"values":[{"field":0,"agg":"sum"}]}),
            // duplicate filter fields
            json!({"source":{"range":{"from":"A1","to":"D2"}},"filters":[{"field":0,"values":["a"]},{"field":0,"values":["b"]}],"values":[{"field":0,"agg":"sum"}]}),
            // empty filter values / oversized filter value
            json!({"source":{"range":{"from":"A1","to":"D2"}},"filters":[{"field":0,"values":[]}],"values":[{"field":0,"agg":"sum"}]}),
            json!({"source":{"range":{"from":"A1","to":"D2"}},"filters":[{"field":0,"values":[""]}],"values":[{"field":0,"agg":"sum"}]}),
            json!({"source":{"range":{"from":"A1","to":"D2"}},"filters":[{"field":0,"values":["x".repeat(513)]}],"values":[{"field":0,"agg":"sum"}]}),
            // over-cap range
            json!({"source":{"range":{"from":"A1","to":"XFD1048576"}},"values":[{"field":0,"agg":"sum"}]}),
            // bad range
            json!({"source":{"range":{"from":"A","to":"B"}},"values":[{"field":0,"agg":"sum"}]}),
            // bad name
            json!({"name":"","source":{"range":{"from":"A1","to":"D2"}},"values":[{"field":0,"agg":"sum"}]}),
            json!({"name":"n".repeat(129),"source":{"range":{"from":"A1","to":"D2"}},"values":[{"field":0,"agg":"sum"}]}),
            // unknown spec key (deny_unknown_fields)
            json!({"deferred":true,"source":{"range":{"from":"A1","to":"D2"}},"values":[{"field":0,"agg":"sum"}]}),
            // sort field out of range
            json!({"source":{"range":{"from":"A1","to":"D2"}},"sort":{"field":4,"ascending":true},"values":[{"field":0,"agg":"sum"}]}),
        ];
        for bad in cases {
            assert!(
                e.apply(Command::new("insertPivot", json!({"pivot":bad.clone()}))).is_err(),
                "accepted {bad}"
            );
        }
        assert!(pivots(&mut e).is_empty());
        // The good spec still inserts — nothing was left mutated.
        insert(&mut e, good);
        assert_eq!(pivots(&mut e).len(), 1);
    }

    #[test]
    fn field_and_value_caps_enforced() {
        let mut e = TallyEngine::new();
        // 17 row fields needs a ≥17-column source; use XFD-bounded range.
        let wide = json!({"from":"A1","to":"Q10"}); // 17 columns
        let mut rows: Vec<u32> = (0..17).collect();
        let mut p = json!({
            "source": {"range": wide},
            "rows": rows.clone(),
            "columns": [],
            "values": [{"field":0,"agg":"sum"}]
        });
        assert!(e.apply(Command::new("insertPivot", json!({"pivot":p.clone()}))).is_err());
        rows.truncate(16);
        p["rows"] = json!(rows);
        insert(&mut e, p);
        // 17 values reject.
        let vals: Vec<Value> = (0..17).map(|i| json!({"field":i%16,"agg":"sum"})).collect();
        assert!(e.apply(Command::new("insertPivot", json!({
            "pivot": {"source":{"range":{"from":"A1","to":"P10"}},"values":vals}
        }))).is_err());
        // Pivot cap: fill to MAX_PIVOTS then reject.
        let mut e2 = TallyEngine::new();
        for _ in 0..MAX_PIVOTS {
            insert(&mut e2, base_pivot());
        }
        assert_eq!(
            apply_err(&mut e2, "insertPivot", json!({"pivot":base_pivot()})).code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn update_pivot_patches_and_clears() {
        let mut e = TallyEngine::new();
        insert(&mut e, json!({
            "name":"P","source":{"range":{"from":"A1","to":"D10"}},
            "rows":[0],"columns":[],"values":[{"field":1,"agg":"sum"}],
            "filters":[{"field":0,"values":["x"]}],
            "sort":{"field":0,"ascending":true}
        }));
        // Partial patch: rename + swap agg + clear filters/sort/name.
        let r = data(
            &mut e,
            "updatePivot",
            json!({"id":1,"patch":{"name":"Q","values":[{"field":2,"agg":"max"}],"filters":null,"sort":null}}),
        );
        let p = &r["pivot"];
        assert_eq!(p["name"], json!("Q"));
        assert_eq!(p["values"], json!([{"field":2,"agg":"max"}]));
        assert!(p.get("filters").is_none());
        assert!(p.get("sort").is_none());
        // source patch: sheet by name + range.
        data(&mut e, "addSheet", json!({"name":"Data"}));
        let r = data(
            &mut e,
            "updatePivot",
            json!({"id":1,"patch":{"source":{"sheet":"Data","range":{"from":"C3","to":"F20"}}}}),
        );
        assert_eq!(r["pivot"]["source"]["sheet"], json!("Data"));
        assert_eq!(r["pivot"]["source"]["range"], json!("C3:F20"));
        // Clearing the name.
        data(&mut e, "updatePivot", json!({"id":1,"patch":{"name":null}}));
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert!(d.get("name").is_none());
        // Unknown patch key / sheet alongside id / bad patch shapes reject.
        for (payload, code) in [
            (json!({"id":1,"patch":{"bogus":1}}), ErrorCode::InvalidCommand),
            (json!({"id":1,"sheet":0,"patch":{}}), ErrorCode::InvalidCommand),
            (json!({"id":1,"patch":{"rows":null}}), ErrorCode::InvalidCommand),
            (json!({"id":1,"patch":{"source":null}}), ErrorCode::InvalidCommand),
            (json!({"id":1,"patch":{"source":{}}}), ErrorCode::InvalidCommand),
            (json!({"id":1,"patch":{"values":[]}}), ErrorCode::Validation),
            (json!({"id":1,"patch":{"values":[{"field":9,"agg":"sum"}]}}), ErrorCode::Validation),
            (json!({"id":99,"patch":{}}), ErrorCode::NotFound),
        ] {
            assert_eq!(apply_err(&mut e, "updatePivot", payload).code, code);
        }
        // Eventless identical patch emits no events.
        let r = apply(
            &mut e,
            "updatePivot",
            json!({"id":1,"patch":{"rows":[0]}}),
        );
        assert!(r.events.is_empty());
    }

    #[test]
    fn undo_redo_restores_specs() {
        let mut e = TallyEngine::new();
        insert(&mut e, base_pivot());
        insert(&mut e, json!({
            "name":"Second","source":{"range":{"from":"A1","to":"B2"}},
            "values":[{"field":0,"agg":"count"}]
        }));
        assert_eq!(pivots(&mut e).len(), 2);
        assert!(e.undo().unwrap());
        assert_eq!(pivots(&mut e).len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(pivots(&mut e).len(), 2);
        // Undo an update.
        data(&mut e, "updatePivot", json!({"id":1,"patch":{"name":"Renamed"}}));
        assert!(e.undo().unwrap());
        assert!(data(&mut e, "describePivot", json!({"id":1}))["pivot"].get("name").is_none());
        assert!(e.redo().unwrap());
        assert_eq!(
            data(&mut e, "describePivot", json!({"id":1}))["pivot"]["name"],
            json!("Renamed")
        );
    }

    #[test]
    fn remove_sheet_cascades_on_output_and_source() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        // Pivot 1: output Sheet1, source Data. Pivot 2: output Data,
        // source Sheet1 (cross-bound both ways).
        insert(
            &mut e,
            json!({"source":{"sheet":"Data","range":{"from":"A1","to":"C4"}},
                   "values":[{"field":0,"agg":"sum"}]}),
        );
        insert_on(
            &mut e,
            "Data",
            json!({"source":{"sheet":"Sheet1","range":{"from":"A1","to":"C4"}},
                   "values":[{"field":0,"agg":"sum"}]}),
        );
        assert_eq!(pivots(&mut e).len(), 2);
        // Removing "Data" drops BOTH pivots (one as output, one as source).
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert!(pivots(&mut e).is_empty());
        // Undo restores both.
        assert!(e.undo().unwrap());
        assert_eq!(pivots(&mut e).len(), 2);
        assert!(e.redo().unwrap());
        assert!(pivots(&mut e).is_empty());
    }

    #[test]
    fn structural_edits_remap_source_range() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        // Source B2:D10 on Data (rows 2..10, cols B..D → indices 0..2).
        let p = insert_on(
            &mut e,
            "Data",
            json!({"source":{"sheet":"Data","range":{"from":"B2","to":"D10"}},
                   "rows":[0],"columns":[1],"values":[{"field":2,"agg":"sum"}]}),
        );
        assert_eq!(p["source"]["range"], json!("B2:D10"));
        // Insert 3 rows before row 1 on Data → source shifts to B5:D13.
        data(&mut e, "insertRows", json!({"sheet":"Data","from":1,"to":3}));
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["source"]["range"], json!("B5:D13"));
        // Insert a column before column A → B..D becomes C..E.
        data(&mut e, "insertCols", json!({"sheet":"Data","from":1,"to":1}));
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["source"]["range"], json!("C5:E13"));
        // Delete the columns covering the whole source width (C..E) →
        // pivot drops.
        data(&mut e, "deleteCols", json!({"sheet":"Data","from":3,"to":5}));
        assert!(pivots(&mut e).is_empty());
        // Undo restores the pivot with its pre-delete range.
        assert!(e.undo().unwrap());
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["source"]["range"], json!("C5:E13"));
    }

    #[test]
    fn column_delete_shrinking_source_drops_pivot() {
        let mut e = TallyEngine::new();
        // Source A1:D4 (4 columns); field index 3 referenced.
        insert(
            &mut e,
            json!({"source":{"range":{"from":"A1","to":"D4"}},
                   "values":[{"field":3,"agg":"sum"}]}),
        );
        // Delete column D → width 3, field 3 out of range → drop.
        data(&mut e, "deleteCols", json!({"from":4,"to":4}));
        assert!(pivots(&mut e).is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(pivots(&mut e).len(), 1);
        // Deleting an interior column the spec doesn't reference keeps it:
        // field indices are offsets, so deleting column B shrinks the
        // range to A1:C4 and field 3 is still out of range — drop again
        // is the honest outcome; a spec referencing only field 0 survives.
        let mut e2 = TallyEngine::new();
        insert(
            &mut e2,
            json!({"source":{"range":{"from":"A1","to":"D4"}},
                   "values":[{"field":0,"agg":"sum"}]}),
        );
        data(&mut e2, "deleteCols", json!({"from":4,"to":4}));
        let d = data(&mut e2, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["source"]["range"], json!("A1:C4"));
    }

    #[test]
    fn insert_overflow_rejects_atomically() {
        let mut e = TallyEngine::new();
        // Pivot source pinned at the sheet's right edge.
        insert(
            &mut e,
            json!({"source":{"range":{"from":"XFC1","to":"XFD10"}},
                   "values":[{"field":0,"agg":"sum"}]}),
        );
        let before = pivots(&mut e);
        // Inserting a column before XFD pushes the range off-sheet →
        // out_of_bounds, spec untouched.
        assert_eq!(
            apply_err(&mut e, "insertCols", json!({"from":16380,"to":16384})).code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(pivots(&mut e), before);
    }

    #[test]
    fn protection_gates_mutations_by_output_sheet() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        insert(&mut e, base_pivot()); // output Sheet1
        data(
            &mut e,
            "insertPivot",
            json!({"sheet":"Data","pivot":base_pivot()}),
        ); // output Data
        data(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("insertPivot", json!({"pivot":base_pivot()})),
            ("updatePivot", json!({"id":1,"patch":{"name":"X"}})),
            ("removePivot", json!({"id":1})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), before, "{op}");
        }
        // Reads stay ungated; pivots on the unprotected sheet still mutate.
        assert!(e.apply(Command::new("listPivots", json!({}))).is_ok());
        assert!(e.apply(Command::new("describePivot", json!({"id":2}))).is_ok());
        apply(&mut e, "updatePivot", json!({"id":2,"patch":{"name":"Ok"}}));
        apply(&mut e, "removePivot", json!({"id":2}));
        apply(
            &mut e,
            "insertPivot",
            json!({"sheet":"Data","pivot":base_pivot()}),
        );
    }

    #[test]
    fn snapshot_roundtrip_and_schema9() {
        let mut e = TallyEngine::new();
        insert(&mut e, base_pivot());
        let snap = e.snapshot().unwrap();
        let (_tag, payload) = decode_envelope(&snap).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["kind"], json!("tally"));
        assert_eq!(v["schema"], json!(9));
        assert_eq!(v["document"]["pivots"].as_array().unwrap().len(), 1);
        // describe carries the table; restore round-trips it.
        let before = data(&mut e, "describe", json!({}));
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        assert_eq!(data(&mut e2, "describe", json!({})), before);
        // next_pivot repair on crafted payloads is covered by the shared
        // restore path; a pivot under schema:8 fails closed.
        let mut doc = before.clone();
        let wrapped8 = json!({"kind":"tally","schema":8,"document":doc});
        assert!(e2
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped8).unwrap()))
            .is_err());
        doc["next_pivot"] = json!(1);
        let wrapped9 = json!({"kind":"tally","schema":9,"document":doc});
        e2.restore(&encode_envelope(&serde_json::to_vec(&wrapped9).unwrap()))
            .unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert!(d["next_pivot"].as_u64().unwrap() > 1);
    }

    #[test]
    fn hostile_restore_validates_pivots() {
        let mut e = TallyEngine::new();
        insert(&mut e, base_pivot());
        insert(
            &mut e,
            json!({"name":"Two","source":{"range":{"from":"A1","to":"B2"}},
                   "values":[{"field":0,"agg":"count"}]}),
        );
        let doc = data(&mut e, "describe", json!({}));
        let before = doc.clone();
        let mutates: Vec<Box<dyn Fn(&mut Value)>> = vec![
            // duplicate id
            Box::new(|d| d["pivots"][1]["id"] = json!(1)),
            // missing output sheet
            Box::new(|d| d["pivots"][0]["sheet"] = json!(99)),
            // missing source sheet
            Box::new(|d| d["pivots"][0]["source"]["sheet"] = json!(99)),
            // unparseable / over-cap source range
            Box::new(|d| d["pivots"][0]["source"]["range"] = json!("not-a-range")),
            Box::new(|d| d["pivots"][0]["source"]["range"] = json!("A1:XFD1048576")),
            // non-canonical range (re-canonicalized on honest restore, but
            // endpoints out of order are normalized — use a bad one instead)
            Box::new(|d| d["pivots"][0]["source"]["range"] = json!("ZZ9")),
            // field index past source width
            Box::new(|d| d["pivots"][0]["values"][0]["field"] = json!(4)),
            // bad agg
            Box::new(|d| d["pivots"][0]["values"][0]["agg"] = json!("median")),
            // unknown spec field (deny_unknown_fields)
            Box::new(|d| d["pivots"][0]["deferred"] = json!(true)),
            Box::new(|d| d["pivots"][0]["source"]["extra"] = json!(1)),
            // empty values / too many values
            Box::new(|d| d["pivots"][0]["values"] = json!([])),
            Box::new(|d| {
                d["pivots"][0]["values"] = json!(
                    (0..17).map(|_| json!({"field":0,"agg":"sum"})).collect::<Vec<_>>()
                )
            }),
            // duplicate row fields
            Box::new(|d| d["pivots"][0]["rows"] = json!([0,0,0])),
            // bad name
            Box::new(|d| d["pivots"][0]["name"] = json!("")),
            // over-cap filter values
            Box::new(|d| {
                d["pivots"][0]["filters"] = json!([{
                    "field":0,
                    "values": (0..65).map(|i| format!("v{i}")).collect::<Vec<_>>()
                }])
            }),
        ];
        for mutate in mutates {
            let mut bad = doc.clone();
            mutate(&mut bad);
            let wrapped = json!({"kind":"tally","schema":9,"document":bad});
            assert!(
                e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap())).is_err(),
                "accepted mutation"
            );
            assert_eq!(data(&mut e, "describe", json!({})), before);
        }
        // An honest schema:9 payload round-trips; the same document under
        // schema:8 fails closed (covered above in the schema test too).
        let wrapped = json!({"kind":"tally","schema":9,"document":doc});
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        assert_eq!(pivots(&mut e).len(), 2);
    }

    // -- refresh / materialization -------------------------------------

    fn refresh(e: &mut TallyEngine, id: u64) -> CommandResult {
        apply(e, "refreshPivot", json!({"id": id}))
    }
    /// Stored raw of `addr` on the sheet named `sheet`, read through the
    /// silent `describe` op (getCell only sees the active sheet and
    /// setActive would pollute the undo journal these tests assert on).
    fn raw_on(e: &mut TallyEngine, sheet: &str, addr: &str) -> String {
        let d = data(e, "describe", json!({}));
        d["sheets"]
            .as_array()
            .and_then(|sheets| {
                sheets
                    .iter()
                    .find(|s| s["name"] == json!(sheet))
                    .and_then(|s| s.get("cells"))
                    .and_then(|cells| cells.get(addr))
                    .and_then(|c| c.get("raw"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default()
    }

    /// Seed the classic region/qty/price table on Sheet1 (A1:C4, no
    /// header row — every source row is a record).
    fn seed_sales(e: &mut TallyEngine) {
        data(
            e,
            "setRange",
            json!({"from":"A1","values":[
                ["east","1","10"],
                ["west","2","20"],
                ["east","3","30"],
                ["west","4","40"]
            ]}),
        );
    }

    #[test]
    fn refresh_writes_grouped_grid_and_is_eventless_when_identical() {
        let mut e = TallyEngine::new();
        seed_sales(&mut e);
        data(&mut e, "addSheet", json!({"name":"Out"}));
        insert_on(
            &mut e,
            "Out",
            json!({
                "source": {"sheet":"Sheet1","range":{"from":"A1","to":"C4"}},
                "rows": [0],
                "values": [{"field":1,"agg":"sum"},{"field":2,"agg":"avg"}]
            }),
        );
        // insertPivot writes no cells; refresh materializes.
        let r = refresh(&mut e, 1);
        assert_eq!(r.data["changed"], json!(8)); // 3 header + 2×3 data cells? see below
        assert_eq!(r.events.len(), 1);
        // Layout: row1 header ("" | "sum:1" | "avg:2"), then east/west rows.
        assert_eq!(raw_on(&mut e, "Out", "A1"), "");
        assert_eq!(raw_on(&mut e, "Out", "B1"), "sum:1");
        assert_eq!(raw_on(&mut e, "Out", "C1"), "avg:2");
        assert_eq!(raw_on(&mut e, "Out", "A2"), "east");
        assert_eq!(raw_on(&mut e, "Out", "B2"), "4"); // 1+3
        assert_eq!(raw_on(&mut e, "Out", "C2"), "20"); // (10+30)/2
        assert_eq!(raw_on(&mut e, "Out", "A3"), "west");
        assert_eq!(raw_on(&mut e, "Out", "B3"), "6"); // 2+4
        assert_eq!(raw_on(&mut e, "Out", "C3"), "30"); // (20+40)/2
        // describePivot reports the recorded footprint.
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["output"], json!({"anchor":"A1","rows":3,"cols":3}));
        // Identical refresh: eventless, no journal entry — the next undo
        // reverts the FIRST refresh directly (a phantom second entry
        // would leave B2 = "4" after one undo).
        let r2 = refresh(&mut e, 1);
        assert_eq!(r2.data["changed"], json!(0));
        assert!(r2.events.is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(raw_on(&mut e, "Out", "B2"), "");
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert!(d.get("output").is_none());
        assert!(e.redo().unwrap());
        assert_eq!(raw_on(&mut e, "Out", "B2"), "4");
    }

    #[test]
    fn refresh_honors_columns_filters_sort_and_all_aggs() {
        let mut e = TallyEngine::new();
        seed_sales(&mut e);
        data(&mut e, "addSheet", json!({"name":"Out"}));
        // Column field = field 2 (price bucket via parity? no — use field
        // 0 region as column field) plus a filter and a sort.
        insert_on(
            &mut e,
            "Out",
            json!({
                "source": {"sheet":"Sheet1","range":{"from":"A1","to":"C4"}},
                "rows": [1],
                "columns": [0],
                "values": [
                    {"field":1,"agg":"count"},
                    {"field":2,"agg":"min"},
                    {"field":2,"agg":"max"}
                ],
                "filters": [{"field":0,"values":["east","west"]}],
                "sort": {"field":1,"ascending":true}
            }),
        );
        refresh(&mut e, 1);
        // rows = qty values {1,2,3,4} sorted asc; cols = regions
        // {east,west} first-occurrence. Grid: 1 label col + 2 col-groups ×
        // 3 slots = 7 cols; header + 4 data rows.
        assert_eq!(raw_on(&mut e, "Out", "B1"), "east | count:1");
        assert_eq!(raw_on(&mut e, "Out", "E1"), "west | count:1");
        assert_eq!(raw_on(&mut e, "Out", "G1"), "west | max:2");
        // qty=1 row: only east has qty 1 → east cells filled, west blank.
        assert_eq!(raw_on(&mut e, "Out", "A2"), "1");
        assert_eq!(raw_on(&mut e, "Out", "B2"), "1"); // count
        assert_eq!(raw_on(&mut e, "Out", "C2"), "10"); // min price
        assert_eq!(raw_on(&mut e, "Out", "D2"), "10"); // max price
        assert_eq!(raw_on(&mut e, "Out", "E2"), ""); // no west qty-1 row
        // qty=4 row: only west.
        assert_eq!(raw_on(&mut e, "Out", "A5"), "4");
        assert_eq!(raw_on(&mut e, "Out", "E5"), "1");
        assert_eq!(raw_on(&mut e, "Out", "F5"), "40");
        assert_eq!(raw_on(&mut e, "Out", "G5"), "40");
        // A filter that excludes everything clears the footprint.
        data(
            &mut e,
            "updatePivot",
            json!({"id":1,"patch":{"filters":[{"field":0,"values":["north"]}]}}),
        );
        let r = refresh(&mut e, 1);
        assert!(r.events.len() == 1);
        assert_eq!(raw_on(&mut e, "Out", "B1"), "");
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["output"], json!({"anchor":"A1","rows":1,"cols":1}));
    }

    #[test]
    fn refresh_output_anchor_patch_and_bounds() {
        let mut e = TallyEngine::new();
        seed_sales(&mut e);
        insert(
            &mut e,
            json!({
                "output": "J10",
                "source": {"range":{"from":"A1","to":"C4"}},
                "rows": [],
                "values": [{"field":1,"agg":"sum"}]
            }),
        );
        refresh(&mut e, 1);
        // No row/column fields: header "sum:1" at J10, one data row J11.
        assert_eq!(raw_on(&mut e, "Sheet1", "J10"), "sum:1");
        assert_eq!(raw_on(&mut e, "Sheet1", "J11"), "10"); // 1+2+3+4
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["output"], json!({"anchor":"J10","rows":2,"cols":1}));
        // Retarget the anchor: footprint resets, old cells stay put.
        data(&mut e, "updatePivot", json!({"id":1,"patch":{"output":"N5"}}));
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["output"], json!({"anchor":"N5","rows":0,"cols":0}));
        refresh(&mut e, 1);
        assert_eq!(raw_on(&mut e, "Sheet1", "N5"), "sum:1");
        assert_eq!(raw_on(&mut e, "Sheet1", "N6"), "10");
        assert_eq!(raw_on(&mut e, "Sheet1", "J10"), "sum:1"); // stale, documented
        // Bad anchors reject at insert and patch time.
        for bad in [json!(""), json!("A0"), json!("XFE1"), json!("1:2"), json!(5)] {
            assert!(
                e.apply(Command::new(
                    "insertPivot",
                    json!({"pivot": {"output": bad, "source":{"range":{"from":"A1","to":"C4"}},"values":[{"field":0,"agg":"sum"}]}})
                ))
                .is_err(),
                "accepted output {bad}"
            );
        }
        assert!(e
            .apply(Command::new(
                "updatePivot",
                json!({"id":1,"patch":{"output":"ZZZ9"}})
            ))
            .is_err());
        // Output grid that cannot fit at the anchor rejects atomically:
        // anchor near the right edge with several value columns.
        let mut e2 = TallyEngine::new();
        seed_sales(&mut e2);
        insert_on(
            &mut e2,
            "Sheet1",
            json!({
                "output": "XFC1",
                "source": {"sheet":"Sheet1","range":{"from":"A1","to":"C4"}},
                "rows": [0],
                "columns": [0],
                "values": [{"field":1,"agg":"sum"},{"field":2,"agg":"sum"}]
            }),
        );
        // 2 regions × 2 slots + 1 label = 5 cols → XFC+4 = XFD+1 off-sheet.
        assert_eq!(
            apply_err(&mut e2, "refreshPivot", json!({"id":1})).code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(raw_on(&mut e2, "Sheet1", "XFC1"), "");
        // Too many distinct groups: 200 distinct values on both axes with
        // 16 value slots → cols = 1 + 200×16, rows = 201 → far over the
        // 16,384-cell output cap → out_of_bounds before any mutation.
        let mut e3 = TallyEngine::new();
        let vals: Vec<String> = (0..200).map(|i| i.to_string()).collect();
        data(
            &mut e3,
            "setRange",
            json!({"from":"A1","values": vals.iter().map(|v| vec![v.clone()]).collect::<Vec<_>>()}),
        );
        insert_on(
            &mut e3,
            "Sheet1",
            json!({
                "source": {"range":{"from":"A1","to":"A200"}},
                "rows": [0],
                "columns": [0],
                "values": (0..16).map(|_| json!({"field":0,"agg":"sum"})).collect::<Vec<_>>()
            }),
        );
        assert_eq!(
            apply_err(&mut e3, "refreshPivot", json!({"id":1})).code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn refresh_all_skips_protected_and_undoes_as_one_entry() {
        let mut e = TallyEngine::new();
        seed_sales(&mut e);
        data(&mut e, "addSheet", json!({"name":"Out"}));
        data(&mut e, "addSheet", json!({"name":"Locked"}));
        insert_on(
            &mut e,
            "Out",
            json!({"source":{"sheet":"Sheet1","range":{"from":"A1","to":"C4"}},
                   "rows":[0],"values":[{"field":1,"agg":"sum"}]}),
        );
        insert_on(
            &mut e,
            "Locked",
            json!({"source":{"sheet":"Sheet1","range":{"from":"A1","to":"C4"}},
                   "values":[{"field":1,"agg":"count"}]}),
        );
        data(&mut e, "protectSheet", json!({"sheet":"Locked","protected":true}));
        let r = apply(&mut e, "refreshAllPivots", json!({}));
        assert_eq!(r.data["refreshed"], json!(1));
        assert_eq!(r.data["skipped"], json!([2]));
        assert_eq!(raw_on(&mut e, "Out", "B2"), "4");
        // Locked pivot's sheet untouched.
        assert_eq!(raw_on(&mut e, "Locked", "A1"), "");
        // Single refreshPivot on the protected output sheet rejects.
        assert_eq!(
            apply_err(&mut e, "refreshPivot", json!({"id":2})).code,
            ErrorCode::Validation
        );
        // One undo entry restores both the cells and both footprints.
        assert!(e.undo().unwrap());
        assert_eq!(raw_on(&mut e, "Out", "B2"), "");
        let d = data(&mut e, "describePivot", json!({"id":1}))["pivot"].clone();
        assert!(d.get("output").is_none());
        assert!(e.redo().unwrap());
        assert_eq!(raw_on(&mut e, "Out", "B2"), "4");
        // Second refreshAll is eventless.
        let r2 = apply(&mut e, "refreshAllPivots", json!({}));
        assert!(r2.events.is_empty());
        assert_eq!(r2.data["refreshed"], json!(0));
    }

    #[test]
    fn refresh_snapshot_roundtrip_and_restore_validation() {
        let mut e = TallyEngine::new();
        seed_sales(&mut e);
        data(&mut e, "addSheet", json!({"name":"Out"}));
        insert_on(
            &mut e,
            "Out",
            json!({"output":"C3",
                   "source":{"sheet":"Sheet1","range":{"from":"A1","to":"C4"}},
                   "rows":[0],"values":[{"field":1,"agg":"sum"}]}),
        );
        refresh(&mut e, 1);
        let snap = e.snapshot().unwrap();
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        assert_eq!(raw_on(&mut e2, "Out", "C4"), "east");
        assert_eq!(raw_on(&mut e2, "Out", "D4"), "4");
        let d = data(&mut e2, "describePivot", json!({"id":1}))["pivot"].clone();
        assert_eq!(d["output"], json!({"anchor":"C3","rows":3,"cols":2}));
        // Hostile output footprints reject on restore.
        let doc = data(&mut e, "describe", json!({}));
        let mut bad = doc.clone();
        bad["pivots"][0]["output"]["anchor"] = json!("not-an-addr");
        let wrapped = json!({"kind":"tally","schema":9,"document":bad});
        assert!(e2
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .is_err());
        let mut bad2 = doc.clone();
        bad2["pivots"][0]["output"]["rows"] = json!(0); // cols stays 2 → asymmetric
        let wrapped = json!({"kind":"tally","schema":9,"document":bad2});
        assert!(e2
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .is_err());
        let mut bad3 = doc.clone();
        bad3["pivots"][0]["output"] = json!({"anchor":"A1","rows":99999,"cols":99999});
        let wrapped = json!({"kind":"tally","schema":9,"document":bad3});
        assert!(e2
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .is_err());
    }
}
