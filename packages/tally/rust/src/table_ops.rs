//! Durable workbook-level table objects (Excel "Tables" / ListObjects) and
//! the `insertTable`/`updateTable`/`removeTable`/`listTables`/`describeTable`
//! ops (P12-P14 backlog item 12 — storage + CRUD + read).
//!
//! Model decision: tables are **workbook-level entries** like pivots and
//! charts — `TableSpec = { id, sheet, name, range, show_headers,
//! show_totals, banded_rows, banded_columns }` where `sheet` is the
//! durable id of the sheet the table lives on and `range` a canonical
//! `"A1"`/`"A1:B2"` rectangle on that sheet (reuses
//! `name_ops::parse_refers_to`, capped at the shared 16,384-cell bound and
//! requiring at least two cells). The header row is always the range's
//! top row — `show_headers` only controls whether hosts render it, so the
//! header is inside the range by construction. `show_totals`,
//! `banded_rows` and `banded_columns` are storage-only display flags:
//! the engine never computes totals rows or applies banding; hosts read
//! cells and render. At most `MAX_TABLES` per workbook.
//!
//! `name` is the Excel-style display name: unique **workbook-wide**
//! case-insensitively (Excel's rule, not per-sheet), 1–128 bytes of ASCII
//! `[A-Za-z_][A-Za-z0-9_.]*`. `insertTable` accepts an optional `name`;
//! absent, the engine assigns the smallest free `"Table{n}"` like Excel's
//! auto-naming. Structured-reference formula syntax (`Table1[Col]`) is
//! deferred — the formula evaluator does not resolve table names, so
//! table names deliberately do NOT reuse the defined-name legality rules
//! (which would reject ref-shaped names like `Table1`).
//!
//! **Overlap rules (Excel-faithful, enforced both directions)**: table
//! ranges on one sheet may not intersect each other, and a table range
//! may not intersect any merged-cell region on its sheet — `insertTable`/
//! `updateTable` reject over either, and `mergeCells` rejects a merge
//! that would intersect a table. Cell *contents* inside a table are
//! ordinary cells: `setCell`/`setRange`/formats/filters/sorts all work
//! normally; the table is metadata.
//!
//! `updateTable {id, patch}` is a partial patch like `updatePivot`:
//! present keys set (`name`, `range` as `{from,to}`, the four flags),
//! every field rejects explicit `null`, unknown patch keys and a `sheet`
//! field alongside `id` reject. The merged spec re-validates before
//! commit — name legality/uniqueness (excluding itself), range caps and
//! both overlap rules — so a patch cannot leave an invalid table; an
//! unchanged spec is eventless. `insertTable` always creates (duplicate
//! specs are allowed — tables are objects, though equal ranges on one
//! sheet still reject as overlaps). `removeTable {id}` removes one
//! (`sheet` alongside `id` rejects); `listTables {sheet?}` filters by
//! bound sheet and `describeTable {id}` reads one spec — both silent.
//!
//! `removeSheet` cascade-drops tables bound to the removed sheet into the
//! same undo entry; undo re-admits each only while it still satisfies the
//! restore invariants. `duplicateSheet`/`moveSheet`/`renameSheet` do not
//! copy or retarget tables (the sheet copy's merges are per-sheet and
//! cannot collide with tables bound to the new sheet id).
//!
//! Structural edits: a table's `range` is coordinate-bound, so it
//! participates in `remap_band` like every other range — inserts shift
//! and expand it (a band strictly inside grows the table, a band at its
//! edge shifts it whole), deletes shrink/clamp it, and a range fully
//! covered by a deleted band drops the table (Excel removes a table whose
//! rows/columns are all deleted). Inserts that would push the range off
//! the sheet reject atomically like every other bound structure.
//!
//! Protection: tables are workbook metadata bound to one sheet, so
//! mutations are guarded by that sheet exactly like chart/pivot ops (see
//! `protection.rs`); `listTables`/`describeTable` are ungated reads.
use super::range_ops::Rect;
use super::*;

/// Maximum table objects per workbook.
pub const MAX_TABLES: usize = 256;
/// `name` bound in UTF-8 bytes.
pub const MAX_TABLE_NAME_LEN: usize = 128;

/// One durable table object: `id` a workbook-unique handle, `sheet` the
/// bound sheet id, `name` the workbook-unique display name, `range` the
/// canonical `"A1"`/`"A1:B2"` anchor including the header row.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TableSpec {
    pub id: u64,
    pub sheet: u64,
    pub name: String,
    pub range: String,
    /// Whether the range's top row renders as the header row.
    #[serde(default = "default_show_headers")]
    pub show_headers: bool,
    /// Storage-only totals-row flag; the engine never computes totals.
    #[serde(default)]
    pub show_totals: bool,
    /// Storage-only banded-rows display flag.
    #[serde(default = "default_banded_rows")]
    pub banded_rows: bool,
    /// Storage-only banded-columns display flag.
    #[serde(default)]
    pub banded_columns: bool,
}

fn default_show_headers() -> bool {
    true
}
fn default_banded_rows() -> bool {
    true
}

/// `insertTable`'s `table` payload (id/sheet are engine-assigned). Flags
/// are optional booleans; absent fields take the Excel defaults above.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TableInput {
    #[serde(default)]
    name: Option<String>,
    range: Value,
    #[serde(default)]
    show_headers: Option<bool>,
    #[serde(default)]
    show_totals: Option<bool>,
    #[serde(default)]
    banded_rows: Option<bool>,
    #[serde(default)]
    banded_columns: Option<bool>,
}

/// Parsed `updateTable` patch: `Some` sets, outer `None` leaves untouched.
/// No field accepts `null` — tables have no clearable attributes.
struct TablePatch {
    name: Option<String>,
    range: Option<name_ops::RefersCoords>,
    show_headers: Option<bool>,
    show_totals: Option<bool>,
    banded_rows: Option<bool>,
    banded_columns: Option<bool>,
}

/// Excel-style display name: ASCII letter/underscore start, then
/// letters/digits/`_`/`.`, 1–128 bytes. Deliberately does NOT reuse the
/// defined-name rules — structured references are deferred, so
/// ref-shaped names like `Table1` are legal.
fn valid_table_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= MAX_TABLE_NAME_LEN
        && (b[0].is_ascii_alphabetic() || b[0] == b'_')
        && b[1..]
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'_' || c == b'.')
}

/// Inclusive 0-based rectangle of a stored canonical range.
pub(super) fn range_coords(t: &TableSpec) -> Option<name_ops::RefersCoords> {
    name_ops::parse_refers_to(&t.range).ok()
}

fn cell_count(coords: name_ops::RefersCoords) -> u64 {
    u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
}

/// Canonical stored range must parse, be canonical, span at least two
/// cells and stay inside the shared 16,384-cell cap.
fn range_ok(range: &str) -> bool {
    name_ops::parse_refers_to(range)
        .map(|c| {
            name_ops::canonical_refers_to(c) == range
                && cell_count(c) >= 2
                && cell_count(c) <= MAX_GET_RANGE_CELLS
        })
        .unwrap_or(false)
}

/// Field-level check shared by hostile-restore (after canonicalization)
/// and undo re-admission; sheet existence, id/name uniqueness and overlap
/// rules are checked by the caller.
pub(super) fn stored_ok(t: &TableSpec) -> bool {
    valid_table_name(&t.name) && range_ok(&t.range)
}

/// Whether `name` is free workbook-wide (case-insensitive), excluding the
/// table `except_id` (update-in-place keeps its own name).
fn name_free(doc: &Workbook, name: &str, except_id: u64) -> bool {
    !doc
        .tables
        .iter()
        .any(|t| t.id != except_id && t.name.eq_ignore_ascii_case(name))
}

/// Smallest free `"Table{n}"` display name (Excel auto-naming).
fn auto_table_name(doc: &Workbook) -> String {
    for n in 1u64.. {
        let candidate = format!("Table{n}");
        if name_free(doc, &candidate, u64::MAX) {
            return candidate;
        }
    }
    unreachable!("table name space exhausted")
}

/// Whether `coords` intersects any merged region on the sheet bound to
/// `sheet_id`. Merges are per-sheet; a missing sheet (defensive — ids are
/// never recycled) reports no conflict.
fn overlaps_merges(doc: &Workbook, sheet_id: u64, coords: name_ops::RefersCoords) -> bool {
    doc.sheets
        .iter()
        .find(|s| s.id == sheet_id)
        .is_some_and(|s| {
            s.merges.iter().any(|m| {
                struct_ops::rects_overlap(coords, (m.c0, m.r0, m.c1, m.r1))
            })
        })
}

/// Whether `coords` intersects another table bound to `sheet_id`
/// (excluding `except_id`). Tables on different sheets may share
/// coordinates — overlap is a per-sheet rule.
fn overlaps_tables(
    doc: &Workbook,
    sheet_id: u64,
    coords: name_ops::RefersCoords,
    except_id: u64,
) -> bool {
    doc.tables.iter().any(|t| {
        t.id != except_id
            && t.sheet == sheet_id
            && range_coords(t).is_some_and(|c| struct_ops::rects_overlap(c, coords))
    })
}

/// Both overlap rules for a candidate range on `sheet_id`.
fn range_conflicts(
    doc: &Workbook,
    sheet_id: u64,
    coords: name_ops::RefersCoords,
    except_id: u64,
) -> bool {
    overlaps_merges(doc, sheet_id, coords) || overlaps_tables(doc, sheet_id, coords, except_id)
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped table
/// comes back only while it still satisfies every invariant `restore`
/// enforces — bound sheet exists, unique id, under the cap, unique
/// workbook-wide name, canonical in-cap range, no overlap with merges or
/// other tables on its sheet. Tables cannot be created for a sheet while
/// it is gone (sheet ids are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, t: &TableSpec) -> bool {
    doc.tables.len() < MAX_TABLES
        && !doc.tables.iter().any(|e| e.id == t.id)
        && doc.sheets.iter().any(|s| s.id == t.sheet)
        && name_free(doc, &t.name, t.id)
        && stored_ok(t)
        && range_coords(t).is_none_or(|c| !range_conflicts(doc, t.sheet, c, t.id))
}

/// Validate a candidate `(name, coords)` for `sheet_id` on `doc`;
/// `except_id` excludes the table being updated. Returns the canonical
/// range string.
fn check_candidate(
    doc: &Workbook,
    sheet_id: u64,
    name: &str,
    coords: name_ops::RefersCoords,
    except_id: u64,
) -> Result<String, EngineError> {
    if !valid_table_name(name) {
        return Err(EngineError::validation(
            "table name must be 1-128 bytes of [A-Za-z_][A-Za-z0-9_.]*",
        ));
    }
    if !name_free(doc, name, except_id) {
        return Err(EngineError::validation(format!(
            "table name '{name}' already exists"
        )));
    }
    if cell_count(coords) < 2 {
        return Err(EngineError::validation(
            "a table must cover at least two cells",
        ));
    }
    if cell_count(coords) > MAX_GET_RANGE_CELLS {
        return Err(EngineError::out_of_bounds("table range exceeds 16384 cells"));
    }
    if range_conflicts(doc, sheet_id, coords, except_id) {
        return Err(EngineError::validation(
            "table range overlaps a merge or another table on the sheet",
        ));
    }
    Ok(name_ops::canonical_refers_to(coords))
}

impl TallyEngine {
    /// JSON view of one table with the bound sheet's *current* name
    /// resolved; all display flags are always emitted.
    fn table_json(&self, t: &TableSpec) -> Result<Value, EngineError> {
        let sheet_name = self
            .doc
            .sheets
            .iter()
            .find(|s| s.id == t.sheet)
            .map(|s| s.name.clone());
        Ok(json!({
            "id": t.id,
            "sheet": sheet_name,
            "sheet_id": t.sheet,
            "name": t.name,
            "range": t.range,
            "show_headers": t.show_headers,
            "show_totals": t.show_totals,
            "banded_rows": t.banded_rows,
            "banded_columns": t.banded_columns,
        }))
    }

    /// `insertTable {sheet?, table:{name?, range:{from,to}, show_headers?,
    /// show_totals?, banded_rows?, banded_columns?}}` — store a table
    /// object bound to the resolved sheet. Always appends with a fresh
    /// workbook-unique id; an absent `name` auto-assigns `"Table{n}"`.
    /// Writes no cells — rendering and structured references are
    /// host-side/deferred.
    pub(super) fn op_insert_table(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let input: TableInput = serde_json::from_value(Self::field(p, "table")?.clone())
            .map_err(|e| EngineError::invalid(format!("invalid table spec: {e}")))?;
        let coords = Rect::read(&input.range)?.coords();
        let name = match input.name {
            Some(n) => n,
            None => auto_table_name(&self.doc),
        };
        let range = check_candidate(&self.doc, sheet_id, &name, coords, u64::MAX)?;
        if self.doc.tables.len() >= MAX_TABLES {
            return Err(EngineError::out_of_bounds(format!(
                "table limit of {MAX_TABLES} reached"
            )));
        }
        let id = self.doc.next_table;
        self.doc.next_table = self
            .doc
            .next_table
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("table id space exhausted"))?;
        let spec = TableSpec {
            id,
            sheet: sheet_id,
            name,
            range,
            show_headers: input.show_headers.unwrap_or(true),
            show_totals: input.show_totals.unwrap_or(false),
            banded_rows: input.banded_rows.unwrap_or(true),
            banded_columns: input.banded_columns.unwrap_or(false),
        };
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.tables.push(spec.clone());
        Ok(Self::changed(json!({ "table": self.table_json(&spec)? })))
    }

    /// `updateTable {id, patch:{name?, range?, show_headers?,
    /// show_totals?, banded_rows?, banded_columns?}}` — partial patch;
    /// every field rejects `null`, unknown keys and `sheet` alongside
    /// `id` reject. The merged spec re-validates before commit; an
    /// unchanged spec is eventless.
    pub(super) fn op_update_table(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if p.get("sheet").is_some_and(|v| !v.is_null()) {
            return Err(EngineError::invalid(
                "updateTable 'sheet' is not allowed alongside 'id'",
            ));
        }
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let patch = parse_table_patch(Self::field(p, "patch")?)?;
        let pos = self
            .doc
            .tables
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no table {id}")))?;
        let old = self.doc.tables[pos].clone();
        let mut next = old.clone();
        if let Some(n) = patch.name {
            next.name = n;
        }
        if let Some(c) = patch.range {
            next.range = name_ops::canonical_refers_to(c);
        }
        if let Some(b) = patch.show_headers {
            next.show_headers = b;
        }
        if let Some(b) = patch.show_totals {
            next.show_totals = b;
        }
        if let Some(b) = patch.banded_rows {
            next.banded_rows = b;
        }
        if let Some(b) = patch.banded_columns {
            next.banded_columns = b;
        }
        // Validate the merged spec before committing: legal unique name,
        // canonical in-cap range of ≥2 cells, no overlap with merges or
        // other tables on the bound sheet (itself excluded).
        let coords = range_coords(&next)
            .ok_or_else(|| EngineError::validation("invalid table range"))?;
        let range = check_candidate(&self.doc, next.sheet, &next.name, coords, next.id)?;
        next.range = range;
        if next == old {
            return Ok(Self::readonly(json!({
                "table": self.table_json(&old)?
            })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.tables[pos] = next.clone();
        Ok(Self::changed(json!({ "table": self.table_json(&next)? })))
    }

    /// `removeTable {id}` — remove one table; `sheet` alongside `id`
    /// rejects like the `clear*` mixed-selector precedent.
    pub(super) fn op_remove_table(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if p.get("sheet").is_some_and(|v| !v.is_null()) {
            return Err(EngineError::invalid(
                "removeTable 'sheet' is not allowed alongside 'id'",
            ));
        }
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .tables
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no table {id}")))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.tables.remove(pos);
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// `listTables {sheet?}` — silent read; `sheet` absent lists every
    /// table in the workbook, present filters to the bound sheet.
    pub(super) fn op_list_tables(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let tables: Vec<&TableSpec> = match p.get("sheet") {
            None | Some(Value::Null) => self.doc.tables.iter().collect(),
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                let sheet_id = self.doc.sheets[idx].id;
                self
                    .doc
                    .tables
                    .iter()
                    .filter(|t| t.sheet == sheet_id)
                    .collect()
            }
        };
        let mut out = Vec::with_capacity(tables.len());
        for t in tables {
            out.push(self.table_json(t)?);
        }
        Ok(Self::readonly(json!({ "tables": out })))
    }

    /// `describeTable {id}` — silent read of one table spec.
    pub(super) fn op_describe_table(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let t = self
            .doc
            .tables
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no table {id}")))?;
        Ok(Self::readonly(json!({
            "table": self.table_json(t)?
        })))
    }
}

/// Parse `updateTable`'s `patch` object. Unknown keys reject; every known
/// key rejects explicit `null` (tables have no clearable attributes);
/// `range` is a `{from,to}` rectangle re-canonicalized on merge.
fn parse_table_patch(v: &Value) -> Result<TablePatch, EngineError> {
    let obj = v
        .as_object()
        .ok_or_else(|| EngineError::invalid("table patch must be an object"))?;
    for key in obj.keys() {
        if !matches!(
            key.as_str(),
            "name" | "range" | "show_headers" | "show_totals" | "banded_rows" | "banded_columns"
        ) {
            return Err(EngineError::invalid(format!(
                "unknown table patch field '{key}'"
            )));
        }
    }
    let name = match obj.get("name") {
        None => None,
        Some(Value::String(t)) => Some(t.clone()),
        Some(_) => {
            return Err(EngineError::invalid(
                "table patch 'name' must be a string",
            ))
        }
    };
    let range = match obj.get("range") {
        None => None,
        Some(v) => Some(Rect::read(v)?.coords()),
    };
    let flag = |key: &str| -> Result<Option<bool>, EngineError> {
        match obj.get(key) {
            None => Ok(None),
            Some(Value::Bool(b)) => Ok(Some(*b)),
            Some(_) => Err(EngineError::invalid(format!(
                "table patch '{key}' must be a boolean"
            ))),
        }
    };
    Ok(TablePatch {
        name,
        range,
        show_headers: flag("show_headers")?,
        show_totals: flag("show_totals")?,
        banded_rows: flag("banded_rows")?,
        banded_columns: flag("banded_columns")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::{Command, ErrorCode};

    fn apply(e: &mut TallyEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn apply_err(e: &mut TallyEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }
    fn data(e: &mut TallyEngine, op: &str, p: Value) -> Value {
        apply(e, op, p).data
    }
    fn tables(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "listTables", json!({}))["tables"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn insert(e: &mut TallyEngine, table: Value) -> Value {
        data(e, "insertTable", json!({"table":table}))["table"].clone()
    }
    fn base_table() -> Value {
        json!({
            "name":"Sales",
            "range": {"from":"B2","to":"E10"},
            "show_headers": true,
            "show_totals": false,
            "banded_rows": true,
            "banded_columns": false
        })
    }

    #[test]
    fn insert_list_describe_remove_roundtrip() {
        let mut e = TallyEngine::new();
        let t = insert(&mut e, base_table());
        assert_eq!(t["id"], json!(1));
        assert_eq!(t["sheet"], json!("Sheet1"));
        assert_eq!(t["sheet_id"], json!(0));
        assert_eq!(t["name"], json!("Sales"));
        assert_eq!(t["range"], json!("B2:E10"));
        assert_eq!(t["show_headers"], json!(true));
        assert_eq!(t["show_totals"], json!(false));
        assert_eq!(t["banded_rows"], json!(true));
        assert_eq!(t["banded_columns"], json!(false));
        // describeTable returns the same spec.
        let d = data(&mut e, "describeTable", json!({"id":1}))["table"].clone();
        assert_eq!(d, t);
        // listTables filters by bound sheet.
        assert_eq!(tables(&mut e).len(), 1);
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(
            &mut e,
            "insertTable",
            json!({"sheet":"Data","table":{"name":"T2","range":{"from":"A1","to":"C3"}}}),
        );
        assert_eq!(tables(&mut e).len(), 2);
        let on_data = data(&mut e, "listTables", json!({"sheet":"Data"}))["tables"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(on_data.len(), 1);
        assert_eq!(on_data[0]["sheet"], json!("Data"));
        // Storage only: no cells were written.
        let wb = data(&mut e, "workbook", json!({}));
        assert_eq!(wb["sheets"][0]["cell_count"], json!(0));
        // removeTable by id; sheet alongside id rejects.
        assert_eq!(
            apply_err(&mut e, "removeTable", json!({"id":1,"sheet":0})).code,
            ErrorCode::InvalidCommand
        );
        data(&mut e, "removeTable", json!({"id":1}));
        assert_eq!(tables(&mut e).len(), 1);
        assert_eq!(
            apply_err(&mut e, "removeTable", json!({"id":1})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "describeTable", json!({"id":99})).code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn name_rules_and_auto_naming() {
        let mut e = TallyEngine::new();
        // Absent name auto-assigns Table1, then Table2.
        let t1 = insert(&mut e, json!({"range":{"from":"A1","to":"B2"}}));
        assert_eq!(t1["name"], json!("Table1"));
        let t2 = insert(&mut e, json!({"name":"My.Table_2","range":{"from":"D1","to":"E2"}}));
        assert_eq!(t2["name"], json!("My.Table_2"));
        // Workbook-wide case-insensitive uniqueness.
        for bad in ["table1", "TABLE1", "my.table_2"] {
            assert_eq!(
                apply_err(
                    &mut e,
                    "insertTable",
                    json!({"table":{"name":bad,"range":{"from":"G1","to":"H2"}}})
                )
                .code,
                ErrorCode::Validation,
                "{bad}"
            );
        }
        // Illegal names reject; Table1-shaped names are legal (no
        // structured references yet, so ref-shaped names are fine).
        let bad_names = ["", "1abc", "has space", "bad!"]
            .into_iter()
            .map(String::from)
            .chain(std::iter::once("x".repeat(129)));
        for bad in bad_names {
            assert!(
                e.apply(Command::new(
                    "insertTable",
                    json!({"table":{"name":bad,"range":{"from":"G1","to":"H2"}}})
                ))
                .is_err(),
                "{bad}"
            );
        }
        // A table named like a cell ref is accepted — documented subset.
        insert(&mut e, json!({"name":"A1","range":{"from":"J1","to":"K2"}}));
        assert_eq!(tables(&mut e).len(), 3);
    }

    #[test]
    fn insert_validation_is_atomic() {
        let mut e = TallyEngine::new();
        let cases: Vec<Value> = vec![
            // single-cell range
            json!({"name":"T","range":{"from":"A1","to":"A1"}}),
            // over-cap range
            json!({"name":"T","range":{"from":"A1","to":"XFD1048576"}}),
            // bad range shape
            json!({"name":"T","range":{"from":"A","to":"B"}}),
            // unknown spec key (deny_unknown_fields)
            json!({"name":"T","range":{"from":"A1","to":"B2"},"deferred":true}),
            // non-bool flag
            json!({"name":"T","range":{"from":"A1","to":"B2"},"banded_rows":"yes"}),
            // missing range
            json!({"name":"T"}),
        ];
        for bad in cases {
            assert!(
                e.apply(Command::new("insertTable", json!({"table":bad.clone()}))).is_err(),
                "accepted {bad}"
            );
        }
        assert!(tables(&mut e).is_empty());
        insert(&mut e, base_table());
        assert_eq!(tables(&mut e).len(), 1);
    }

    #[test]
    fn table_table_overlap_rejects() {
        let mut e = TallyEngine::new();
        insert(&mut e, json!({"name":"A","range":{"from":"B2","to":"E10"}}));
        // Intersecting on the same sheet rejects; disjoint and
        // different-sheet overlaps are fine.
        for range in [
            json!({"from":"E10","to":"G20"}), // touches corner cell E10
            json!({"from":"C5","to":"Z9"}),  // interior overlap
            json!({"from":"A1","to":"B2"}),  // covers the header corner
        ] {
            assert_eq!(
                apply_err(
                    &mut e,
                    "insertTable",
                    json!({"table":{"name":"B","range":range}})
                )
                .code,
                ErrorCode::Validation
            );
        }
        // Adjacent (not overlapping) is fine.
        insert(&mut e, json!({"name":"B","range":{"from":"F2","to":"G10"}}));
        // Same coordinates on ANOTHER sheet are fine.
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(
            &mut e,
            "insertTable",
            json!({"sheet":"Data","table":{"name":"C","range":{"from":"B2","to":"E10"}}}),
        );
        assert_eq!(tables(&mut e).len(), 3);
    }

    #[test]
    fn table_merge_overlap_rejects_both_directions() {
        let mut e = TallyEngine::new();
        // A merge first: the table covering it rejects.
        data(&mut e, "mergeCells", json!({"range":{"from":"C3","to":"D4"}}));
        assert_eq!(
            apply_err(&mut e, "insertTable", json!({"table":base_table()})).code,
            ErrorCode::Validation
        );
        // A table first: a merge intersecting it rejects.
        data(&mut e, "unmergeCells", json!({"range":{"from":"A1","to":"Z100"}}));
        insert(&mut e, base_table()); // B2:E10
        for range in [
            json!({"from":"E10","to":"F12"}), // touches corner
            json!({"from":"B2","to":"C3"}),   // covers the header anchor
            json!({"from":"A1","to":"Z100"}), // swallows the table
        ] {
            assert_eq!(
                apply_err(&mut e, "mergeCells", json!({"range":range})).code,
                ErrorCode::Validation
            );
        }
        // Disjoint merge is fine.
        data(&mut e, "mergeCells", json!({"range":{"from":"G2","to":"H3"}}));
        // And updateTable cannot resize onto a merge either.
        assert_eq!(
            apply_err(
                &mut e,
                "updateTable",
                json!({"id":1,"patch":{"range":{"from":"A1","to":"Z100"}}})
            )
            .code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn update_table_patches_and_clears() {
        let mut e = TallyEngine::new();
        insert(&mut e, json!({
            "name":"P","range":{"from":"A1","to":"D10"},
            "show_headers":true,"show_totals":false,
            "banded_rows":true,"banded_columns":false
        }));
        // Partial patch: rename + flags + resize.
        let r = data(
            &mut e,
            "updateTable",
            json!({"id":1,"patch":{"name":"Q","show_totals":true,"banded_columns":true,"range":{"from":"B2","to":"F12"}}}),
        );
        let t = &r["table"];
        assert_eq!(t["name"], json!("Q"));
        assert_eq!(t["range"], json!("B2:F12"));
        assert_eq!(t["show_totals"], json!(true));
        assert_eq!(t["banded_columns"], json!(true));
        assert_eq!(t["show_headers"], json!(true));
        assert_eq!(t["banded_rows"], json!(true));
        // Clearing the name is not allowed; nulls reject.
        // name "Q" patching itself is legal (uniqueness excludes self).
        data(&mut e, "updateTable", json!({"id":1,"patch":{"name":"Q"}}));
        for patch in [
            json!({"name":null}),
            json!({"range":null}),
            json!({"banded_rows":null}),
            json!({"bogus":1}),
            json!({"range":{"from":"A1","to":"A1"}}),
            json!({"name":"bad name!"}),
        ] {
            assert!(
                e.apply(Command::new("updateTable", json!({"id":1,"patch":patch.clone()}))).is_err(),
                "accepted {patch}"
            );
        }
        assert_eq!(
            apply_err(&mut e, "updateTable", json!({"id":1,"sheet":0,"patch":{}})).code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            apply_err(&mut e, "updateTable", json!({"id":99,"patch":{}})).code,
            ErrorCode::NotFound
        );
        // Eventless identical patch emits no events.
        let r = apply(&mut e, "updateTable", json!({"id":1,"patch":{"name":"Q","show_totals":true}}));
        assert!(r.events.is_empty());
        // Rename collision with a second table rejects.
        insert(&mut e, json!({"name":"Other","range":{"from":"J1","to":"K3"}}));
        assert_eq!(
            apply_err(&mut e, "updateTable", json!({"id":1,"patch":{"name":"other"}})).code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn undo_redo_restores_tables() {
        let mut e = TallyEngine::new();
        insert(&mut e, base_table());
        insert(&mut e, json!({"name":"Two","range":{"from":"J1","to":"K3"}}));
        assert_eq!(tables(&mut e).len(), 2);
        assert!(e.undo().unwrap());
        assert_eq!(tables(&mut e).len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(tables(&mut e).len(), 2);
        data(&mut e, "updateTable", json!({"id":1,"patch":{"name":"Renamed"}}));
        assert!(e.undo().unwrap());
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["name"],
            json!("Sales")
        );
        assert!(e.redo().unwrap());
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["name"],
            json!("Renamed")
        );
    }

    #[test]
    fn remove_sheet_cascades_and_readds() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        insert(&mut e, base_table()); // on Sheet1
        data(
            &mut e,
            "insertTable",
            json!({"sheet":"Data","table":{"name":"OnData","range":{"from":"A1","to":"B2"}}}),
        );
        assert_eq!(tables(&mut e).len(), 2);
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert_eq!(tables(&mut e).len(), 1);
        // Undo restores the sheet and its table.
        assert!(e.undo().unwrap());
        assert_eq!(tables(&mut e).len(), 2);
        assert!(e.redo().unwrap());
        assert_eq!(tables(&mut e).len(), 1);
        // duplicateSheet does not copy tables.
        data(&mut e, "addSheet", json!({"name":"Data"}));
        let before = tables(&mut e).len();
        data(&mut e, "duplicateSheet", json!({"sheet":"Sheet1"}));
        assert_eq!(tables(&mut e).len(), before);
    }

    #[test]
    fn structural_edits_remap_table_range() {
        let mut e = TallyEngine::new();
        insert(&mut e, json!({"name":"T","range":{"from":"B2","to":"E10"}}));
        // Insert 3 rows before row 1 → range shifts to B5:E13.
        data(&mut e, "insertRows", json!({"from":1,"to":3}));
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["range"],
            json!("B5:E13")
        );
        // Insert a column before column A → B..E becomes C..F.
        data(&mut e, "insertCols", json!({"from":1,"to":1}));
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["range"],
            json!("C5:F13")
        );
        // Insert INSIDE the table (row 8, col D) expands it: C5:F13 rows
        // 5..13 → row band inside grows to 5..14; col D inside C..F grows
        // to C..G.
        data(&mut e, "insertRows", json!({"from":8,"to":8}));
        data(&mut e, "insertCols", json!({"from":4,"to":4}));
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["range"],
            json!("C5:G14")
        );
        // Insert at the top edge shifts the whole table (does not grow).
        data(&mut e, "insertRows", json!({"from":5,"to":5}));
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["range"],
            json!("C6:G15")
        );
        // Delete the rows covering the whole table → table drops.
        data(&mut e, "deleteRows", json!({"from":6,"to":15}));
        assert!(tables(&mut e).is_empty());
        // Undo restores the pre-delete table.
        assert!(e.undo().unwrap());
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["range"],
            json!("C6:G15")
        );
        // Partial delete shrinks: delete rows 6..10 → rows 11..15 remain.
        data(&mut e, "deleteRows", json!({"from":6,"to":10}));
        assert_eq!(
            data(&mut e, "describeTable", json!({"id":1}))["table"]["range"],
            json!("C6:G10")
        );
    }

    #[test]
    fn insert_overflow_rejects_atomically() {
        let mut e = TallyEngine::new();
        insert(&mut e, json!({"name":"T","range":{"from":"XFC1","to":"XFD10"}}));
        let before = tables(&mut e);
        // Inserting a column before XFD pushes the table range off-sheet
        // → out_of_bounds, spec untouched.
        assert_eq!(
            apply_err(&mut e, "insertCols", json!({"from":16380,"to":16384})).code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(tables(&mut e), before);
    }

    #[test]
    fn protection_gates_mutations_by_bound_sheet() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        insert(&mut e, base_table()); // on Sheet1
        data(
            &mut e,
            "insertTable",
            json!({"sheet":"Data","table":{"name":"T2","range":{"from":"A1","to":"B2"}}}),
        );
        data(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("insertTable", json!({"table":{"name":"X","range":{"from":"J1","to":"K2"}}})),
            ("updateTable", json!({"id":1,"patch":{"name":"X"}})),
            ("removeTable", json!({"id":1})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), before, "{op}");
        }
        // Reads stay ungated; tables on the unprotected sheet still mutate.
        assert!(e.apply(Command::new("listTables", json!({}))).is_ok());
        assert!(e.apply(Command::new("describeTable", json!({"id":2}))).is_ok());
        apply(&mut e, "updateTable", json!({"id":2,"patch":{"name":"Ok"}}));
        apply(&mut e, "removeTable", json!({"id":2}));
        apply(
            &mut e,
            "insertTable",
            json!({"sheet":"Data","table":{"name":"T3","range":{"from":"C1","to":"D2"}}}),
        );
    }

    #[test]
    fn snapshot_roundtrip_and_schema10() {
        let mut e = TallyEngine::new();
        insert(&mut e, base_table());
        let snap = e.snapshot().unwrap();
        let (_tag, payload) = decode_envelope(&snap).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["kind"], json!("tally"));
        assert_eq!(v["schema"], json!(10));
        assert_eq!(v["document"]["tables"].as_array().unwrap().len(), 1);
        // describe carries the table; restore round-trips it.
        let before = data(&mut e, "describe", json!({}));
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        assert_eq!(data(&mut e2, "describe", json!({})), before);
        // A table under schema:9 fails closed.
        let mut doc = before.clone();
        let wrapped9 = json!({"kind":"tally","schema":9,"document":doc.clone()});
        assert!(e2
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped9).unwrap()))
            .is_err());
        doc["next_table"] = json!(1);
        let wrapped10 = json!({"kind":"tally","schema":10,"document":doc});
        e2.restore(&encode_envelope(&serde_json::to_vec(&wrapped10).unwrap()))
            .unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert!(d["next_table"].as_u64().unwrap() > 1);
    }

    #[test]
    fn hostile_restore_validates_tables() {
        let mut e = TallyEngine::new();
        insert(&mut e, base_table());
        insert(&mut e, json!({"name":"Two","range":{"from":"J1","to":"K3"}}));
        let doc = data(&mut e, "describe", json!({}));
        let before = doc.clone();
        let mutates: Vec<Box<dyn Fn(&mut Value)>> = vec![
            // duplicate id
            Box::new(|d| d["tables"][1]["id"] = json!(1)),
            // missing bound sheet
            Box::new(|d| d["tables"][0]["sheet"] = json!(99)),
            // bad / single-cell / over-cap range (non-canonical endpoint
            // order is re-canonicalized on restore like every other
            // refers_to table, so it is not a hostile case)
            Box::new(|d| d["tables"][0]["range"] = json!("not-a-range")),
            Box::new(|d| d["tables"][0]["range"] = json!("A1")),
            Box::new(|d| d["tables"][0]["range"] = json!("A1:XFD1048576")),
            // bad name
            Box::new(|d| d["tables"][0]["name"] = json!("")),
            Box::new(|d| d["tables"][0]["name"] = json!("has space")),
            // duplicate name (case-insensitive, workbook-wide)
            Box::new(|d| d["tables"][1]["name"] = json!("sales")),
            // overlapping tables on one sheet
            Box::new(|d| d["tables"][1]["range"] = json!("B2:E10")),
            // unknown field (deny_unknown_fields)
            Box::new(|d| d["tables"][0]["deferred"] = json!(true)),
            // wrong flag type
            Box::new(|d| d["tables"][0]["show_headers"] = json!("yes")),
        ];
        for mutate in mutates {
            let mut bad = doc.clone();
            mutate(&mut bad);
            let wrapped = json!({"kind":"tally","schema":10,"document":bad});
            assert!(
                e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap())).is_err(),
                "accepted mutation"
            );
            assert_eq!(data(&mut e, "describe", json!({})), before);
        }
        // Table overlapping a merge on its sheet rejects too.
        data(&mut e, "mergeCells", json!({"range":{"from":"G1","to":"H2"}}));
        let with_merge = data(&mut e, "describe", json!({}));
        // Point table 2 at the merge: G1:H2 is 2 cells, no table overlap
        // (table 1 is B2:E10) but intersects the merge.
        let mut bad2 = with_merge.clone();
        bad2["tables"][1]["range"] = json!("G1:H2");
        bad2["tables"][1]["name"] = json!("Merged");
        let wrapped = json!({"kind":"tally","schema":10,"document":bad2});
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .is_err());
        // Honest payload round-trips.
        let wrapped = json!({"kind":"tally","schema":10,"document":with_merge});
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        assert_eq!(tables(&mut e).len(), 2);
    }

    #[test]
    fn table_cap_enforced() {
        let mut e = TallyEngine::new();
        // Fill to MAX_TABLES with non-overlapping single-column strips is
        // impossible on one sheet; use many sheets instead — tables are
        // workbook-capped regardless of sheet.
        for i in 0..MAX_TABLES {
            data(&mut e, "addSheet", json!({"name":format!("S{i}")}));
            data(
                &mut e,
                "insertTable",
                json!({"sheet":format!("S{i}"),"table":{"name":format!("T{i}"),"range":{"from":"A1","to":"B2"}}}),
            );
        }
        assert_eq!(
            apply_err(
                &mut e,
                "insertTable",
                json!({"sheet":"S0","table":{"name":"Over","range":{"from":"D1","to":"E2"}}})
            )
            .code,
            ErrorCode::OutOfBounds
        );
    }
}
