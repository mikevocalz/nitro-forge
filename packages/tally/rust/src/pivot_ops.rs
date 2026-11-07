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
//! **Storage only — no materialization**: `insertPivot` writes no cells.
//! The engine stores and returns the bounded spec; computing the pivot
//! grid, writing output cells, refresh-on-edit and update/refresh ops
//! are deferred (a later slice). `describe`/`listPivots`/`describePivot`
//! expose the stored spec; a host reads source cells through
//! `getRange`/`getCell` and renders or computes host-side.
//!
//! `updatePivot {id, patch}` is a partial patch like `updateChart`:
//! present keys set, explicit `null` clears `name`/`filters`/`sort`,
//! `source`/`rows`/`columns`/`values` cannot be nulled, unknown patch
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
//! drops the pivot. The output sheet carries no coordinates, so edits
//! there never touch the spec.
//!
//! Protection: pivots are workbook metadata bound to an output sheet, so
//! mutations are guarded by that sheet exactly like chart ops (see
//! `protection.rs`); the source sheet is a read reference and does not
//! gate. `listPivots`/`describePivot` are ungated reads.
use super::range_ops::Rect;
use super::*;

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

/// One durable pivot spec: `id` a workbook-unique handle, `sheet` the
/// output sheet id, `source` the data binding.
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
            "name" | "source" | "rows" | "columns" | "values" | "filters" | "sort"
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
    Ok(PivotPatch {
        name,
        source_sheet,
        source_range,
        rows,
        columns,
        values,
        filters,
        sort,
    })
}

impl TallyEngine {
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
        Ok(Value::Object(out))
    }

    /// `insertPivot {sheet?, pivot:{name?,source:{sheet?,range:{from,to}},
    /// rows, columns, values, filters?, sort?}}` — store a pivot spec bound
    /// to the resolved output sheet. Always appends with a fresh
    /// workbook-unique id; duplicate specs are allowed. Writes no cells —
    /// materialization/refresh are deferred.
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
        // Validate the merged spec before committing: name bound, caps,
        // field indices inside the (possibly new) source width.
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
}
