#![forbid(unsafe_code)]
//! tally-engine — the Nitro-Forge spreadsheet engine.
//!
//! Implements the `tally-engine` op surface from `docs/ENGINE_OPS.md` against
//! `ignition_core::Engine`. State is `{ next_sheet, sheets: [Sheet], active,
//! names: [NamedRange] }`; each `Sheet` is `{ id, name, cells: { "A1": { raw } },
//! formats?: { "A1": CellFormat } }`. Only raw cell text is stored — computed
//! values are always derived live by the formula evaluator (`formula`
//! module). `formats` is durable per-cell display metadata (number format,
//! font, fill, borders) kept in a separate map so it survives content edits
//! and never affects evaluation (see `format_ops`). `names` is the durable
//! workbook-level named-range table (see `name_ops`): each entry binds a
//! validated name to one sheet id and a canonical `"A1"`/`"A1:B2"` target;
//! formulas resolve names bound to the sheet being evaluated.
//! `validations` is the durable workbook-level data-validation table (see
//! `validation_ops`): each rule binds a sheet id, a canonical range and a
//! bounded criteria object evaluated against computed cell values.
//! `conditional_formats` is the durable workbook-level conditional-format
//! table (see `conditional_ops`): each rule binds a sheet id, a canonical
//! range, a COUNTIF-style criteria string and a bounded style payload;
//! the engine reports which rules match which computed cell values —
//! applying the styles is host-side.
//! `filters` is the durable workbook-level row-filter table (see
//! `filter_ops`): each rule binds a sheet id, a canonical range, an
//! optional column and a COUNTIF-style criteria string; filters hide rows
//! (never delete) and visibility is derived live from computed values.
//! `charts` is the durable workbook-level chart-object table (see
//! `chart_ops`): each spec binds a sheet id, a bounded kind, a canonical
//! data-anchor range and optional title/series/colors — the engine stores
//! the spec only, rendering is host-side. `sparklines` is the durable
//! workbook-level sparkline table (see `sparkline_ops`): each spec binds a
//! sheet id, a canonical target anchor and data range plus a bounded kind —
//! likewise storage-only.
//! `sortRange` (see `sort_ops`) is a pure mutation — it permutes raw cell
//! rows by computed key values with formulas moving verbatim.
//! `comments` is the durable workbook-level comment table (see
//! `comment_ops`): each entry binds a sheet id and a canonical
//! `"A1"`/`"A1:B2"` coordinate anchor plus author/body/resolved.
//! `merges` is the per-sheet merged-cell registry (see `struct_ops`):
//! display metadata only — contents are never cleared and every cell
//! stays live to formulas and reads. `insertRows`/`deleteRows`/
//! `insertCols`/`deleteCols` are structural band edits that remap every
//! coordinate-bound structure on the target sheet (cells, formats,
//! formulas' references, merges, names, validations, conditional formats,
//! filters + columns, charts + series, sparklines, captured view filter
//! specs and comments) in one atomic whole-document undo entry.
//!
//! Semantics documented for reviewers:
//! * Cell addresses `$?[A-Z]+$?[0-9]+` (case-insensitive); `$` markers are
//!   accepted and normalized away — `setCell`/`getCell` on `$a$1` is `A1`.
//! * `setCell` stores the raw string verbatim; `""` (or JSON `null`) clears.
//!   Numeric/bool JSON values are stored in their canonical text form.
//! * `computed` values serialize as JSON scalars: number, string, boolean,
//!   `null` for empty cells, or an error literal string such as `"#DIV/0!"`.
//! * Sheet parameters (`renameSheet`/`removeSheet`/`setActive`) accept a sheet
//!   name (case-insensitive) or a 0-based index.
//! * Sheet names are unique case-insensitively (Excel behavior).
//! * Formulas evaluate against the whole workbook: bare references and
//!   defined names resolve on the formula's own sheet, while
//!   `Sheet!A1`/`'Sheet Name'!A1:B2` qualifiers (resolved by current sheet
//!   name, case-insensitive) reach any sheet — see `formula` for the
//!   grammar, rename/removal/cycle semantics. 3D sheet ranges are not
//!   supported.
//! * Read ops (`describe`, `getCell`, `getRange`, `evaluate`, `workbook`)
//!   record no undo entries and emit no events; mutating ops emit
//!   `document:changed`.
//! * Undo entries are per-cell previous raw (`None` = "cell was empty") for
//!   `setCell`/`clearCell`, plus structural entries covering sheet ops and
//!   `new` — a strict superset of the spec's per-cell undo. `restore` and
//!   `new` reset the journal's view of the world appropriately.

mod chart_ops;
mod comment_ops;
mod conditional_ops;
mod csv_ops;
mod filter_ops;
mod formula;
mod format_ops;
mod name_ops;
mod pivot_ops;
mod range_ops;
mod sheet_ops;
mod sort_ops;
mod struct_ops;
mod table_ops;
mod protection;
mod sparkline_ops;
mod validation_ops;
mod view_ops;
mod xlsx;

use chart_ops::ChartSpec;
use comment_ops::Comment;
use conditional_ops::ConditionalRule;
use filter_ops::FilterRule;
use pivot_ops::PivotSpec;
use table_ops::TableSpec;
use sparkline_ops::SparklineSpec;
use view_ops::SheetView;
use format_ops::CellFormat;
use validation_ops::ValidationRule;
use formula::{fmt_addr, fmt_num, parse_addr, CellLookup, Evaluator};
use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal, TaskContext,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::mem;

const JOURNAL_CAPACITY: usize = 64;
/// Upper bound on `getRange` materialization (`from`/`to` rect size).
const MAX_GET_RANGE_CELLS: u64 = 16_384;
const SUPPORTED_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Cell {
    pub raw: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sheet {
    pub id: u64,
    pub name: String,
    pub cells: BTreeMap<String, Cell>,
    /// Durable per-cell format metadata keyed by canonical "A1" address.
    /// Independent of `cells`: formats survive content edits, apply to empty
    /// cells, and never affect formula evaluation (see `format_ops`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub formats: BTreeMap<String, CellFormat>,
    #[serde(default)]
    pub tone: Option<String>,
    #[serde(default)]
    pub is_protected: bool,
    /// Durable id of the sheet view last applied via `setSheetView`
    /// (schema:6); `None` when no view selection is recorded. Restore
    /// requires it to reference a view bound to this sheet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_view: Option<u64>,
    /// Durable merged-cell regions as inclusive 0-based rectangles
    /// (schema:8). Display metadata only: contents are never cleared and
    /// every cell stays live to formulas/reads (see `struct_ops`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merges: Vec<MergeRegion>,
}

/// One merged-cell region: inclusive 0-based `(c0, r0)..(c1, r1)`
/// rectangle, normalized so `c0 <= c1` and `r0 <= r1`, spanning at least
/// two cells. The top-left cell `(c0, r0)` is the anchor that hosts
/// render; covered cells report `merged_into` in `getCell`/`getRange`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MergeRegion {
    pub c0: u32,
    pub r0: u32,
    pub c1: u32,
    pub r1: u32,
}

/// Workbook-level named range (see `name_ops` for the model decision):
/// `name` is unique case-insensitively, `sheet` is the durable sheet id the
/// range is bound to, and `refers_to` is a canonical `"A1"`/`"A1:B2"`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NamedRange {
    pub name: String,
    pub sheet: u64,
    pub refers_to: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Workbook {
    next_sheet: u64,
    sheets: Vec<Sheet>,
    active: usize,
    /// Durable named ranges; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    names: Vec<NamedRange>,
    /// Durable data-validation rules; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    validations: Vec<ValidationRule>,
    /// Next id handed out by `setValidation`.
    #[serde(default)]
    next_validation: u64,
    /// Durable conditional-format rules; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    conditional_formats: Vec<ConditionalRule>,
    /// Next id handed out by `setConditionalFormat`.
    #[serde(default)]
    next_conditional: u64,
    /// Durable row-filter rules; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    filters: Vec<FilterRule>,
    /// Next id handed out by `setFilter`.
    #[serde(default)]
    next_filter: u64,
    /// Durable chart objects; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    charts: Vec<ChartSpec>,
    /// Next id handed out by `insertChart`.
    #[serde(default)]
    next_chart: u64,
    /// Durable sparkline specs; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    sparklines: Vec<SparklineSpec>,
    /// Next id handed out by `setSparkline`.
    #[serde(default)]
    next_sparkline: u64,
    /// Durable named sheet views; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    views: Vec<SheetView>,
    /// Next id handed out by `saveSheetView`.
    #[serde(default)]
    next_view: u64,
    /// Durable cell/range-anchored comments; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    comments: Vec<Comment>,
    /// Next id handed out by `addComment`.
    #[serde(default)]
    next_comment: u64,
    /// Durable pivot-table specs; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pivots: Vec<PivotSpec>,
    /// Next id handed out by `insertPivot`.
    #[serde(default)]
    next_pivot: u64,
    /// Durable table objects (Excel Tables); empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tables: Vec<TableSpec>,
    /// Next id handed out by `insertTable`.
    #[serde(default)]
    next_table: u64,
}

/// Versioned snapshot wrapper, mirroring the quill/pitch precedent. Emitted
/// only when the workbook carries durable post-release fields (`tone`,
/// `is_protected`, `formats`, `names`) that pre-wrapper readers would
/// silently drop;
/// workbooks without them keep the legacy bare-`Workbook` payload so older
/// engines can still read them.
#[derive(Serialize)]
struct VersionedSnapshot<'a> {
    kind: &'static str,
    schema: u32,
    document: &'a Workbook,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VersionedDoc {
    kind: String,
    schema: u32,
    document: Workbook,
}

fn blank_workbook() -> Workbook {
    Workbook {
        next_sheet: 1,
        sheets: vec![Sheet {
            id: 0,
            name: "Sheet1".to_string(),
            cells: BTreeMap::new(),
            formats: BTreeMap::new(),
            tone: None,
            is_protected: false,
            active_view: None,
            merges: Vec::new(),
        }],
        active: 0,
        names: Vec::new(),
        validations: Vec::new(),
        next_validation: 1,
        conditional_formats: Vec::new(),
        next_conditional: 1,
        filters: Vec::new(),
        next_filter: 1,
        charts: Vec::new(),
        next_chart: 1,
        sparklines: Vec::new(),
        next_sparkline: 1,
        views: Vec::new(),
        next_view: 1,
        comments: Vec::new(),
        next_comment: 1,
        pivots: Vec::new(),
        next_pivot: 1,
        tables: Vec::new(),
        next_table: 1,
    }
}

impl CellLookup for Sheet {
    fn cell_raw(&self, addr: &str) -> Option<&str> {
        self.cells.get(addr).map(|c| c.raw.as_str())
    }

    fn addrs_in(&self, c0: u32, r0: u32, c1: u32, r1: u32) -> Vec<String> {
        self.cells
            .keys()
            .filter(|k| match parse_addr(k) {
                Some((c, r)) => c >= c0 && c <= c1 && r >= r0 && r <= r1,
                None => false,
            })
            .cloned()
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/// Inverse-mutation entries, recorded before each mutation. `invert` applies
/// an entry and returns the entry describing the opposite direction, so undo
/// and redo share one code path.
enum UndoEntry {
    /// One inverse entry for an atomic multi-cell edit.
    Cells {
        sheet: u64,
        cells: Vec<(String, Option<String>)>,
    },
    /// Previous raw text of a cell (`None` = the cell was empty).
    Cell {
        sheet: u64,
        addr: String,
        prev: Option<String>,
    },
    /// One inverse entry for an atomic multi-cell format edit.
    Formats {
        sheet: u64,
        cells: Vec<(String, Option<CellFormat>)>,
    },
    /// Previous format of a cell (`None` = the cell had no format).
    Format {
        sheet: u64,
        addr: String,
        prev: Option<CellFormat>,
    },
    /// A sheet was added; undo removes it and restores the allocator.
    AddSheet { sheet_id: u64, prev_next_sheet: u64 },
    /// A sheet was removed; undo re-inserts it at `index`, restores `active`
    /// and re-adds `dropped_names`/`dropped_validations`/
    /// `dropped_conditional_formats`/`dropped_filters`/`dropped_charts`/
    /// `dropped_sparklines`/`dropped_views`/`dropped_comments`/
    /// `dropped_pivots`/`dropped_tables` (names, validation rules,
    /// conditional rules,
    /// filter rules, charts, sparkline specs, named views, comments,
    /// pivot specs and table objects bound to the removed sheet — as
    /// output *or* source for pivots —
    /// are cascade-dropped on removal).
    /// Re-admission skips entries whose case-insensitive name twin already
    /// exists, that would exceed the table caps, or (for rules/specs) that
    /// no longer satisfy the stored-entry invariants, keeping `doc` inside
    /// the invariants `restore` enforces; `active_view` references left
    /// dangling by skipped views are swept to `None`.
    RemoveSheet {
        /// Allocator value before this inverse; swapped for redo as well.
        prev_next_sheet: u64,
        index: usize,
        sheet: Sheet,
        prev_active: usize,
        dropped_names: Vec<NamedRange>,
        dropped_validations: Vec<ValidationRule>,
        dropped_conditional_formats: Vec<ConditionalRule>,
        dropped_filters: Vec<FilterRule>,
        dropped_charts: Vec<ChartSpec>,
        dropped_sparklines: Vec<SparklineSpec>,
        dropped_views: Vec<SheetView>,
        dropped_comments: Vec<Comment>,
        dropped_pivots: Vec<PivotSpec>,
        dropped_tables: Vec<TableSpec>,
    },
    SetActive { prev: usize },
    /// `new` replaced the whole document.
    Reset { prev: Workbook },
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

pub struct TallyEngine {
    doc: Workbook,
    journal: Journal<UndoEntry>,
}

impl Default for TallyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl TallyEngine {
    pub fn new() -> Self {
        Self {
            doc: blank_workbook(),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    // -- payload helpers -----------------------------------------------------

    fn field<'a>(p: &'a Value, key: &str) -> Result<&'a Value, EngineError> {
        p.get(key)
            .ok_or_else(|| EngineError::invalid(format!("missing payload field '{key}'")))
    }

    fn str_field<'a>(p: &'a Value, key: &str) -> Result<&'a str, EngineError> {
        Self::field(p, key)?.as_str().ok_or_else(|| {
            EngineError::invalid(format!("payload field '{key}' must be a string"))
        })
    }

    /// Normalized "A1" form of a payload address field.
    fn addr_field(p: &Value, key: &str) -> Result<String, EngineError> {
        let (c, r) = Self::addr_coords(p, key)?;
        Ok(fmt_addr(c, r))
    }

    fn addr_coords(p: &Value, key: &str) -> Result<(u32, u32), EngineError> {
        let s = Self::str_field(p, key)?;
        let (c, r) = parse_addr(s).ok_or_else(|| {
            EngineError::validation(format!("invalid cell address '{s}'"))
        })?;
        // Every address-taking op reads through here, so nothing can read or
        // write a cell the grid cannot show.
        if !formula::on_sheet(c, r) {
            return Err(EngineError::out_of_bounds(format!(
                "cell address '{s}' is past the sheet (XFD1048576)"
            )));
        }
        Ok((c, r))
    }

    /// `sheet` payload param: string → case-insensitive name, number → index.
    fn resolve_sheet(&self, v: &Value) -> Result<usize, EngineError> {
        match v {
            Value::Number(n) => {
                let i = n.as_u64().ok_or_else(|| {
                    EngineError::invalid("'sheet' index must be a non-negative integer")
                })? as usize;
                if i < self.doc.sheets.len() {
                    Ok(i)
                } else {
                    Err(EngineError::out_of_bounds(format!(
                        "sheet index {i} out of range ({} sheets)",
                        self.doc.sheets.len()
                    )))
                }
            }
            Value::String(name) => self
                .doc
                .sheets
                .iter()
                .position(|s| s.name.eq_ignore_ascii_case(name))
                .ok_or_else(|| EngineError::not_found(format!("no sheet named '{name}'"))),
            _ => Err(EngineError::invalid(
                "'sheet' must be a name (string) or index (number)",
            )),
        }
    }

    fn name_taken(&self, name: &str, except: Option<usize>) -> bool {
        self.doc
            .sheets
            .iter()
            .enumerate()
            .any(|(i, s)| Some(i) != except && s.name.eq_ignore_ascii_case(name))
    }

    fn default_sheet_name(&self, id: u64) -> String {
        let mut k = id + 1;
        loop {
            let candidate = format!("Sheet{k}");
            if !self.name_taken(&candidate, None) {
                return candidate;
            }
            k += 1;
        }
    }

    fn active_sheet(&self) -> &Sheet {
        // `active` is an invariant: always in range (validated on restore and
        // maintained on removeSheet).
        &self.doc.sheets[self.doc.active]
    }

    fn active_sheet_mut(&mut self) -> &mut Sheet {
        &mut self.doc.sheets[self.doc.active]
    }

    fn sheet_by_id_mut(&mut self, id: u64) -> Option<&mut Sheet> {
        self.doc.sheets.iter_mut().find(|s| s.id == id)
    }

    /// Fresh per-request evaluator over one sheet, with workbook
    /// named-range resolution enabled when `names` is nonempty. The whole
    /// workbook is visible so `Sheet!` cross-sheet references resolve;
    /// `index` is both the home sheet and its position in the book.
    fn evaluator_for(&self, index: usize) -> Evaluator<'_, Sheet> {
        let book: Vec<(Option<&str>, u64, &Sheet)> = self
            .doc
            .sheets
            .iter()
            .map(|s| (Some(s.name.as_str()), s.id, s))
            .collect();
        let names = if self.doc.names.is_empty() {
            None
        } else {
            Some(name_ops::name_table(&self.doc.names))
        };
        Evaluator::with_book(book, index, names)
    }

    /// Fresh per-request evaluator over the active sheet.
    fn evaluator(&self) -> Evaluator<'_, Sheet> {
        self.evaluator_for(self.doc.active)
    }

    /// Sheet index for ops with an optional `sheet` payload (name or
    /// index); absent/null means the active sheet.
    fn sheet_index(&self, p: &Value) -> Result<usize, EngineError> {
        match p.get("sheet") {
            None | Some(Value::Null) => Ok(self.doc.active),
            Some(v) => self.resolve_sheet(v),
        }
    }

    /// Remove sheet at `idx`, fixing `active` exactly like `removeSheet` and
    /// cascade-dropping names, validation rules, conditional rules, filter
    /// rules, charts, sparkline specs, named views, comments and pivot
    /// specs bound to the removed sheet id (pivots drop when the removed
    /// sheet is their output *or* their source sheet). Returns the removed
    /// sheet and the dropped entries.
    fn remove_sheet_at(
        &mut self,
        idx: usize,
    ) -> (
        Sheet,
        Vec<NamedRange>,
        Vec<ValidationRule>,
        Vec<ConditionalRule>,
        Vec<FilterRule>,
        Vec<ChartSpec>,
        Vec<SparklineSpec>,
        Vec<SheetView>,
        Vec<Comment>,
        Vec<PivotSpec>,
        Vec<TableSpec>,
    ) {
        let removed = self.doc.sheets.remove(idx);
        let len = self.doc.sheets.len();
        if self.doc.active > idx {
            self.doc.active -= 1;
        } else if self.doc.active >= len {
            self.doc.active = len.saturating_sub(1);
        }
        let mut dropped = Vec::new();
        self.doc.names.retain(|n| {
            if n.sheet == removed.id {
                dropped.push(n.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_rules = Vec::new();
        self.doc.validations.retain(|v| {
            if v.sheet == removed.id {
                dropped_rules.push(v.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_conditional = Vec::new();
        self.doc.conditional_formats.retain(|r| {
            if r.sheet == removed.id {
                dropped_conditional.push(r.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_filters = Vec::new();
        self.doc.filters.retain(|r| {
            if r.sheet == removed.id {
                dropped_filters.push(r.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_charts = Vec::new();
        self.doc.charts.retain(|c| {
            if c.sheet == removed.id {
                dropped_charts.push(c.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_sparklines = Vec::new();
        self.doc.sparklines.retain(|s| {
            if s.sheet == removed.id {
                dropped_sparklines.push(s.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_views = Vec::new();
        self.doc.views.retain(|v| {
            if v.sheet == removed.id {
                dropped_views.push(v.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_comments = Vec::new();
        self.doc.comments.retain(|c| {
            if c.sheet == removed.id {
                dropped_comments.push(c.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_pivots = Vec::new();
        self.doc.pivots.retain(|pv| {
            if pv.sheet == removed.id || pv.source.sheet == removed.id {
                dropped_pivots.push(pv.clone());
                false
            } else {
                true
            }
        });
        let mut dropped_tables = Vec::new();
        self.doc.tables.retain(|t| {
            if t.sheet == removed.id {
                dropped_tables.push(t.clone());
                false
            } else {
                true
            }
        });
        (
            removed,
            dropped,
            dropped_rules,
            dropped_conditional,
            dropped_filters,
            dropped_charts,
            dropped_sparklines,
            dropped_views,
            dropped_comments,
            dropped_pivots,
            dropped_tables,
        )
    }

    // -- op results -----------------------------------------------------------

    fn changed(data: Value) -> CommandResult {
        CommandResult::data(data) // includes the `document:changed` event
    }

    fn readonly(data: Value) -> CommandResult {
        CommandResult {
            events: vec![],
            data,
            output: None,
        }
    }

    // -- ops ------------------------------------------------------------------

    fn op_new(&mut self) -> Result<CommandResult, EngineError> {
        let prev = mem::replace(&mut self.doc, blank_workbook());
        self.journal.record(UndoEntry::Reset { prev });
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn op_describe(&self) -> Result<CommandResult, EngineError> {
        Ok(Self::readonly(serde_json::to_value(&self.doc)?))
    }

    fn op_add_sheet(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let name = match p.get("name") {
            None | Some(Value::Null) => None,
            Some(v) => Some(v.as_str().ok_or_else(|| {
                EngineError::invalid("'name' must be a string")
            })?),
        };
        if let Some(n) = name {
            if n.is_empty() {
                return Err(EngineError::validation("sheet name must not be empty"));
            }
            if self.name_taken(n, None) {
                return Err(EngineError::validation(format!(
                    "sheet name '{n}' already exists"
                )));
            }
        }
        let id = self.doc.next_sheet;
        let next_id = id.checked_add(1)
            .ok_or_else(|| EngineError::validation("sheet id space exhausted"))?;
        let name = name
            .map(str::to_string)
            .unwrap_or_else(|| self.default_sheet_name(id));
        let sheet = Sheet {
            id,
            name,
            cells: BTreeMap::new(),
            formats: BTreeMap::new(),
            tone: None,
            is_protected: false,
            active_view: None,
            merges: Vec::new(),
        };
        self.journal.record(UndoEntry::AddSheet { sheet_id: id, prev_next_sheet: self.doc.next_sheet });
        self.doc.next_sheet = next_id;
        self.doc.sheets.push(sheet);
        let index = self.doc.sheets.len() - 1;
        Ok(Self::changed(json!({
            "sheet": { "id": id, "name": self.doc.sheets[index].name, "index": index }
        })))
    }

    fn op_rename_sheet(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.resolve_sheet(Self::field(p, "sheet")?)?;
        let to = Self::str_field(p, "to")?;
        if to.is_empty() {
            return Err(EngineError::validation("sheet name must not be empty"));
        }
        if self.name_taken(to, Some(idx)) {
            return Err(EngineError::validation(format!(
                "sheet name '{to}' already exists"
            )));
        }
        let prev_name = self.doc.sheets[idx].name.clone();
        // Sheet references in formulas are name-bound (`Sheet!A1`), so a
        // rename must rewrite every stored qualifier across the workbook —
        // the Excel behavior — or all cross-sheet references would strand
        // at `#REF!`. Qualifiers that fail to lex are left alone (they
        // evaluate to `#REF!`/`#NAME?` either way). One whole-document
        // undo entry covers the rename and every rewritten cell.
        let mut rewrites: Vec<(usize, String, String)> = Vec::new();
        for (si, s) in self.doc.sheets.iter().enumerate() {
            for (addr, cell) in &s.cells {
                if !cell.raw.starts_with('=') {
                    continue;
                }
                if let Ok(raw) = formula::rename_sheet_refs(&cell.raw, &prev_name, to) {
                    if raw != cell.raw {
                        rewrites.push((si, addr.clone(), raw));
                    }
                }
            }
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.sheets[idx].name = to.to_string();
        for (si, addr, raw) in rewrites {
            self.doc.sheets[si].cells.insert(addr, Cell { raw });
        }
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn op_remove_sheet(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.resolve_sheet(Self::field(p, "sheet")?)?;
        if self.doc.sheets.len() <= 1 {
            return Err(EngineError::validation("workbook must keep at least one sheet"));
        }
        // Names, validation rules, conditional rules, filter rules, charts,
        // sparkline specs, named views, comments and pivot specs bound to
        // the removed sheet are cascade-dropped (a pivot drops when the
        // removed sheet is its output *or* its source sheet); the undo
        // entry carries them so undo/redo restore them exactly.
        let sheet_id = self.doc.sheets[idx].id;
        let dropped_names: Vec<NamedRange> = self
            .doc
            .names
            .iter()
            .filter(|n| n.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_validations: Vec<ValidationRule> = self
            .doc
            .validations
            .iter()
            .filter(|v| v.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_conditional_formats: Vec<ConditionalRule> = self
            .doc
            .conditional_formats
            .iter()
            .filter(|r| r.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_filters: Vec<FilterRule> = self
            .doc
            .filters
            .iter()
            .filter(|r| r.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_charts: Vec<ChartSpec> = self
            .doc
            .charts
            .iter()
            .filter(|c| c.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_sparklines: Vec<SparklineSpec> = self
            .doc
            .sparklines
            .iter()
            .filter(|s| s.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_views: Vec<SheetView> = self
            .doc
            .views
            .iter()
            .filter(|v| v.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_comments: Vec<Comment> = self
            .doc
            .comments
            .iter()
            .filter(|c| c.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_pivots: Vec<PivotSpec> = self
            .doc
            .pivots
            .iter()
            .filter(|pv| pv.sheet == sheet_id || pv.source.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_tables: Vec<TableSpec> = self
            .doc
            .tables
            .iter()
            .filter(|t| t.sheet == sheet_id)
            .cloned()
            .collect();
        let entry = UndoEntry::RemoveSheet {
            prev_next_sheet: self.doc.next_sheet,
            index: idx,
            sheet: self.doc.sheets[idx].clone(),
            prev_active: self.doc.active,
            dropped_names,
            dropped_validations,
            dropped_conditional_formats,
            dropped_filters,
            dropped_charts,
            dropped_sparklines,
            dropped_views,
            dropped_comments,
            dropped_pivots,
            dropped_tables,
        };
        self.journal.record(entry);
        self.remove_sheet_at(idx);
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn op_set_active(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.resolve_sheet(Self::field(p, "sheet")?)?;
        let prev = self.doc.active;
        self.journal.record(UndoEntry::SetActive { prev });
        self.doc.active = idx;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn op_set_cell(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let addr = Self::addr_field(p, "addr")?;
        let raw = match Self::field(p, "value")? {
            Value::String(s) => s.clone(),
            Value::Number(n) => fmt_num(n.as_f64().unwrap_or(0.0)),
            Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
            Value::Null => String::new(),
            other => {
                return Err(EngineError::validation(format!(
                    "cell value must be a string, number, boolean, or null (got {other})"
                )))
            }
        };
        let sheet_id = self.active_sheet().id;
        let prev = self
            .active_sheet()
            .cells
            .get(&addr)
            .map(|c| c.raw.clone());
        self.journal.record(UndoEntry::Cell {
            sheet: sheet_id,
            addr: addr.clone(),
            prev,
        });
        {
            let sheet = self.active_sheet_mut();
            if raw.is_empty() {
                sheet.cells.remove(&addr);
            } else {
                sheet.cells.insert(addr.clone(), Cell { raw });
            }
        }
        let computed = self.evaluator().eval_cell(&addr).to_json();
        Ok(Self::changed(json!({ "addr": addr, "computed": computed })))
    }

    fn op_clear_cell(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let addr = Self::addr_field(p, "addr")?;
        let sheet_id = self.active_sheet().id;
        let prev = self
            .active_sheet()
            .cells
            .get(&addr)
            .map(|c| c.raw.clone());
        self.journal.record(UndoEntry::Cell {
            sheet: sheet_id,
            addr: addr.clone(),
            prev,
        });
        self.active_sheet_mut().cells.remove(&addr);
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn op_get_cell(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let addr = Self::addr_field(p, "addr")?;
        let sheet = self.active_sheet();
        let raw = sheet
            .cells
            .get(&addr)
            .map(|c| c.raw.clone())
            .unwrap_or_default();
        let computed = self.evaluator().eval_cell(&addr).to_json();
        let mut out = serde_json::Map::new();
        out.insert("raw".to_string(), Value::String(raw));
        out.insert("computed".to_string(), computed);
        if let Some(f) = sheet.formats.get(&addr) {
            out.insert("format".to_string(), serde_json::to_value(f)?);
        }
        if let Some((c, r)) = parse_addr(&addr) {
            if let Some(anchor) = struct_ops::merge_anchor(sheet, c, r) {
                out.insert("merged_into".to_string(), Value::String(anchor));
            }
        }
        Ok(Self::readonly(Value::Object(out)))
    }

    fn op_get_range(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let (fa, fr) = Self::addr_coords(p, "from")?;
        let (ta, tr) = Self::addr_coords(p, "to")?;
        let (c0, c1) = (fa.min(ta), fa.max(ta));
        let (r0, r1) = (fr.min(tr), fr.max(tr));
        let w = u64::from(c1 - c0) + 1;
        let h = u64::from(r1 - r0) + 1;
        if w.saturating_mul(h) > MAX_GET_RANGE_CELLS {
            return Err(EngineError::out_of_bounds(format!(
                "range {w}x{h} exceeds the {MAX_GET_RANGE_CELLS}-cell limit"
            )));
        }
        let sheet = self.active_sheet();
        let mut ev = self.evaluator();
        let mut rows = Vec::with_capacity(h as usize);
        for r in r0..=r1 {
            let mut row = Vec::with_capacity(w as usize);
            for c in c0..=c1 {
                let addr = fmt_addr(c, r);
                let raw = sheet
                    .cells
                    .get(&addr)
                    .map(|c| c.raw.clone())
                    .unwrap_or_default();
                let computed = ev.eval_cell(&addr).to_json();
                let mut cell = serde_json::Map::new();
                cell.insert("addr".to_string(), Value::String(addr.clone()));
                cell.insert("raw".to_string(), Value::String(raw));
                cell.insert("computed".to_string(), computed);
                if let Some(f) = sheet.formats.get(&addr) {
                    cell.insert("format".to_string(), serde_json::to_value(f)?);
                }
                if let Some(anchor) = struct_ops::merge_anchor(sheet, c, r) {
                    cell.insert("merged_into".to_string(), Value::String(anchor));
                }
                row.push(Value::Object(cell));
            }
            rows.push(Value::Array(row));
        }
        Ok(Self::readonly(json!({ "cells": rows })))
    }

    fn op_evaluate(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let f = Self::str_field(p, "formula")?;
        let v = self.evaluator().eval_formula_text(f);
        Ok(Self::readonly(json!({ "value": v.to_json() })))
    }

    fn op_workbook(&self) -> Result<CommandResult, EngineError> {
        let sheets: Vec<Value> = self
            .doc
            .sheets
            .iter()
            .map(|s| json!({ "name": s.name, "cell_count": s.cells.len(), "tone": s.tone, "is_protected": s.is_protected }))
            .collect();
        Ok(Self::readonly(json!({
            "sheets": sheets,
            "active": self.doc.active,
        })))
    }

    // -- undo machinery ---------------------------------------------------------

    /// Apply the inverse of `e` to the document and return the entry that
    /// inverts *that* (pushed onto the opposite journal stack).
    fn invert(&mut self, e: UndoEntry) -> UndoEntry {
        match e {
            UndoEntry::Cells { sheet, cells } => {
                let inverse = cells
                    .into_iter()
                    .map(|(addr, prev)| match self.invert(UndoEntry::Cell { sheet, addr, prev }) {
                        UndoEntry::Cell { addr, prev, .. } => (addr, prev),
                        _ => unreachable!(),
                    })
                    .collect();
                UndoEntry::Cells {
                    sheet,
                    cells: inverse,
                }
            }
            UndoEntry::Cell { sheet, addr, prev } => {
                let cur = self
                    .doc
                    .sheets
                    .iter()
                    .find(|s| s.id == sheet)
                    .and_then(|s| s.cells.get(&addr))
                    .map(|c| c.raw.clone());
                if let Some(s) = self.sheet_by_id_mut(sheet) {
                    match &prev {
                        Some(r) => {
                            s.cells.insert(addr.clone(), Cell { raw: r.clone() });
                        }
                        None => {
                            s.cells.remove(&addr);
                        }
                    }
                }
                UndoEntry::Cell {
                    sheet,
                    addr,
                    prev: cur,
                }
            }
            UndoEntry::Formats { sheet, cells } => {
                let inverse = cells
                    .into_iter()
                    .map(|(addr, prev)| {
                        match self.invert(UndoEntry::Format {
                            sheet,
                            addr,
                            prev,
                        }) {
                            UndoEntry::Format { addr, prev, .. } => (addr, prev),
                            _ => unreachable!(),
                        }
                    })
                    .collect();
                UndoEntry::Formats {
                    sheet,
                    cells: inverse,
                }
            }
            UndoEntry::Format { sheet, addr, prev } => {
                let cur = self
                    .doc
                    .sheets
                    .iter()
                    .find(|s| s.id == sheet)
                    .and_then(|s| s.formats.get(&addr))
                    .cloned();
                if let Some(s) = self.sheet_by_id_mut(sheet) {
                    match &prev {
                        Some(f) => {
                            s.formats.insert(addr.clone(), f.clone());
                        }
                        None => {
                            s.formats.remove(&addr);
                        }
                    }
                }
                UndoEntry::Format {
                    sheet,
                    addr,
                    prev: cur,
                }
            }
            UndoEntry::AddSheet { sheet_id, prev_next_sheet } => {
                match self.doc.sheets.iter().position(|s| s.id == sheet_id) {
                    Some(idx) => {
                        let prev_active = self.doc.active;
                        let (
                            removed,
                            dropped_names,
                            dropped_validations,
                            dropped_conditional_formats,
                            dropped_filters,
                            dropped_charts,
                            dropped_sparklines,
                            dropped_views,
                            dropped_comments,
                            dropped_pivots,
                            dropped_tables,
                        ) = self.remove_sheet_at(idx);
                        let next_sheet = mem::replace(&mut self.doc.next_sheet, prev_next_sheet);
                        UndoEntry::RemoveSheet {
                            prev_next_sheet: next_sheet,
                            index: idx,
                            sheet: removed,
                            prev_active,
                            dropped_names,
                            dropped_validations,
                            dropped_conditional_formats,
                            dropped_filters,
                            dropped_charts,
                            dropped_sparklines,
                            dropped_views,
                            dropped_comments,
                            dropped_pivots,
                            dropped_tables,
                        }
                    }
                    // Already gone — nothing changed; emit a no-op entry.
                    None => UndoEntry::SetActive {
                        prev: self.doc.active,
                    },
                }
            }
            UndoEntry::RemoveSheet {
                prev_next_sheet,
                index,
                sheet,
                prev_active,
                dropped_names,
                dropped_validations,
                dropped_conditional_formats,
                dropped_filters,
                dropped_charts,
                dropped_sparklines,
                dropped_views,
                dropped_comments,
                dropped_pivots,
                dropped_tables,
            } => {
                let next_sheet = mem::replace(&mut self.doc.next_sheet, prev_next_sheet);
                let idx = index.min(self.doc.sheets.len());
                let sheet_id = sheet.id;
                self.doc.sheets.insert(idx, sheet);
                self.doc.active = prev_active.min(self.doc.sheets.len() - 1);
                // Names cascade-dropped with the sheet come back with it —
                // but only while re-admission keeps `doc.names` inside the
                // invariants `restore` enforces (case-insensitive
                // uniqueness, MAX_NAMES). A name redefined while its sheet
                // was gone wins; the dropped entry is discarded rather than
                // leaving the document in an unrestorable state.
                for n in dropped_names {
                    if self.doc.names.len() >= name_ops::MAX_NAMES {
                        break;
                    }
                    if self
                        .doc
                        .names
                        .iter()
                        .any(|e| e.name.eq_ignore_ascii_case(&n.name))
                    {
                        continue;
                    }
                    self.doc.names.push(n);
                }
                // Validation rules cascade-dropped with the sheet come back
                // under the same discipline: each is re-admitted only while
                // it still satisfies the invariants `restore` enforces
                // (existing sheet, canonical in-bounds range, valid
                // criteria, unique id, no overlap). Rules cannot be created
                // for a sheet while it is gone, so conflicts are defensive.
                for v in dropped_validations {
                    if validation_ops::readd_ok(&self.doc, &v) {
                        self.doc.validations.push(v);
                    }
                }
                // Conditional rules cascade-dropped with the sheet come back
                // under the same discipline: each is re-admitted only while
                // it still satisfies the invariants `restore` enforces
                // (existing sheet, canonical in-bounds range, parseable
                // criteria, valid format, unique id, under the cap). Rules
                // cannot be created for a sheet while it is gone, so
                // conflicts are defensive.
                for r in dropped_conditional_formats {
                    if conditional_ops::readd_ok(&self.doc, &r) {
                        self.doc.conditional_formats.push(r);
                    }
                }
                // Filter rules cascade-dropped with the sheet come back
                // under the same discipline: each is re-admitted only while
                // it still satisfies the invariants `restore` enforces
                // (existing sheet, canonical in-bounds range, parseable
                // criteria, in-range column, unique id, under the cap).
                for r in dropped_filters {
                    if filter_ops::readd_ok(&self.doc, &r) {
                        self.doc.filters.push(r);
                    }
                }
                // Charts and sparkline specs cascade-dropped with the sheet
                // come back under the same discipline: each is re-admitted
                // only while it still satisfies the invariants `restore`
                // enforces (existing sheet, unique id, under the cap,
                // canonical in-cap ranges and bounded fields).
                for c in dropped_charts {
                    if chart_ops::readd_ok(&self.doc, &c) {
                        self.doc.charts.push(c);
                    }
                }
                for s in dropped_sparklines {
                    if sparkline_ops::readd_ok(&self.doc, &s) {
                        self.doc.sparklines.push(s);
                    }
                }
                // Named views cascade-dropped with the sheet come back
                // under the same discipline: each is re-admitted only
                // while it still satisfies the invariants `restore`
                // enforces (existing sheet, unique id, per-sheet name
                // free, under the cap, valid captured specs). A view
                // redefined while its sheet was gone wins; the dropped
                // entry is discarded.
                for v in dropped_views {
                    if view_ops::readd_ok(&self.doc, &v) {
                        self.doc.views.push(v);
                    }
                }
                // Comments cascade-dropped with the sheet come back under
                // the same discipline: each is re-admitted only while it
                // still satisfies the invariants `restore` enforces
                // (existing sheet, unique id, under the cap, canonical
                // in-cap anchor, valid author/body). Comments cannot be
                // created for a sheet while it is gone, so conflicts are
                // defensive.
                for c in dropped_comments {
                    if comment_ops::readd_ok(&self.doc, &c) {
                        self.doc.comments.push(c);
                    }
                }
                // Pivot specs cascade-dropped with the sheet come back
                // under the same discipline: each is re-admitted only
                // while it still satisfies the invariants `restore`
                // enforces (existing output *and* source sheets, unique
                // id, under the cap, canonical in-cap source range,
                // bounded fields). A pivot dropped because its source
                // sheet was removed is only restored when that sheet
                // itself comes back — undoing `removeSheet` restores
                // exactly the sheets that were removed together.
                for pv in dropped_pivots {
                    if pivot_ops::readd_ok(&self.doc, &pv) {
                        self.doc.pivots.push(pv);
                    }
                }
                // Table objects cascade-dropped with the sheet come back
                // under the same discipline: each is re-admitted only
                // while it still satisfies the invariants `restore`
                // enforces (existing bound sheet, unique id, workbook-
                // wide unique name, canonical in-cap range, no overlap
                // with merges or other tables on its sheet).
                for t in dropped_tables {
                    if table_ops::readd_ok(&self.doc, &t) {
                        self.doc.tables.push(t);
                    }
                }
                // A re-admitted sheet restores its own `active_view`, but
                // a view skipped above leaves the pointer dangling —
                // sweep it so `doc` stays inside the invariants
                // `restore` enforces.
                for s in &mut self.doc.sheets {
                    if let Some(av) = s.active_view {
                        if !self
                            .doc
                            .views
                            .iter()
                            .any(|v| v.id == av && v.sheet == s.id)
                        {
                            s.active_view = None;
                        }
                    }
                }
                UndoEntry::AddSheet { sheet_id, prev_next_sheet: next_sheet }
            }
            UndoEntry::SetActive { prev } => {
                let cur = self.doc.active;
                self.doc.active = prev.min(self.doc.sheets.len() - 1);
                UndoEntry::SetActive { prev: cur }
            }
            UndoEntry::Reset { prev } => {
                let cur = mem::replace(&mut self.doc, prev);
                UndoEntry::Reset { prev: cur }
            }
        }
    }
}

impl Engine for TallyEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Tally
    }

    /// `importXlsx` accepts the `.xlsx` archive as a binary sidecar
    /// (`Command.input`) in addition to the `bytes_b64` payload field.
    fn binary_input_ops(&self) -> &'static [&'static str] {
        &["importXlsx"]
    }

    fn apply(&mut self, mut cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        if cmd.v != SUPPORTED_VERSION {
            return Err(EngineError::unsupported(format!(
                "unsupported command version {} (expected {SUPPORTED_VERSION})",
                cmd.v
            )));
        }
        self.check_protection(&cmd.op, &cmd.payload)?;
        // `importXlsx` needs `&mut cmd` for the binary sidecar, so it runs
        // before the shared payload borrow below.
        if cmd.op == "importXlsx" {
            return self.op_import_xlsx(&mut cmd);
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            "new" => self.op_new(),
            "describe" => self.op_describe(),
            "addSheet" => self.op_add_sheet(p),
            "renameSheet" => self.op_rename_sheet(p),
            "removeSheet" => self.op_remove_sheet(p),
            "setActive" => self.op_set_active(p),
            "moveSheet" => self.op_move_sheet(p),
            "duplicateSheet" => self.op_duplicate_sheet(p),
            "setSheetColor" => self.op_set_sheet_color(p),
            "protectSheet" => self.op_protect_sheet(p),
            "setCell" => self.op_set_cell(p),
            "setRange" => self.op_set_range(p),
            "fillRange" => self.op_fill_range(p),
            "fillSeries" => self.op_fill_series(p),
            "setFormat" => self.op_set_format(p),
            "clearFormat" => self.op_clear_format(p),
            "defineName" => self.op_define_name(p),
            "updateName" => self.op_update_name(p),
            "removeName" => self.op_remove_name(p),
            "listNames" => self.op_list_names(),
            "functionCatalog" => self.op_function_catalog(),
            "setValidation" => self.op_set_validation(p),
            "clearValidation" => self.op_clear_validation(p),
            "validateCell" => self.op_validate_cell(p),
            "setConditionalFormat" => self.op_set_conditional_format(p),
            "clearConditionalFormat" => self.op_clear_conditional_format(p),
            "getConditionalFormats" => self.op_get_conditional_formats(p),
            "evaluateConditionalFormats" => self.op_evaluate_conditional_formats(p),
            "sortRange" => self.op_sort_range(p),
            "setFilter" => self.op_set_filter(p),
            "clearFilter" => self.op_clear_filter(p),
            "getFilters" => self.op_get_filters(p),
            "evaluateFilters" => self.op_evaluate_filters(p),
            "insertChart" => self.op_insert_chart(p),
            "updateChart" => self.op_update_chart(p),
            "removeChart" => self.op_remove_chart(p),
            "listCharts" => self.op_list_charts(p),
            "setSparkline" => self.op_set_sparkline(p),
            "clearSparkline" => self.op_clear_sparkline(p),
            "listSparklines" => self.op_list_sparklines(p),
            "saveSheetView" => self.op_save_sheet_view(p),
            "setSheetView" => self.op_set_sheet_view(p),
            "removeSheetView" => self.op_remove_sheet_view(p),
            "listSheetViews" => self.op_list_sheet_views(p),
            "addComment" => self.op_add_comment(p),
            "updateComment" => self.op_update_comment(p),
            "removeComment" => self.op_remove_comment(p),
            "resolveComment" => self.op_resolve_comment(p),
            "reopenComment" => self.op_reopen_comment(p),
            "listComments" => self.op_list_comments(p),
            "insertPivot" => self.op_insert_pivot(p),
            "updatePivot" => self.op_update_pivot(p),
            "removePivot" => self.op_remove_pivot(p),
            "listPivots" => self.op_list_pivots(p),
            "describePivot" => self.op_describe_pivot(p),
            "refreshPivot" => self.op_refresh_pivot(p),
            "refreshAllPivots" => self.op_refresh_all_pivots(p),
            "insertTable" => self.op_insert_table(p),
            "updateTable" => self.op_update_table(p),
            "removeTable" => self.op_remove_table(p),
            "listTables" => self.op_list_tables(p),
            "describeTable" => self.op_describe_table(p),
            "insertRows" => self.op_insert_rows(p),
            "deleteRows" => self.op_delete_rows(p),
            "insertCols" => self.op_insert_cols(p),
            "deleteCols" => self.op_delete_cols(p),
            "mergeCells" => self.op_merge_cells(p),
            "unmergeCells" => self.op_unmerge_cells(p),
            "listMergedCells" => self.op_list_merged_cells(p),
            "clearCell" => self.op_clear_cell(p),
            "getCell" => self.op_get_cell(p),
            "getRange" => self.op_get_range(p),
            "importCsv" => self.op_import_delimited(p, b','),
            "importTsv" => self.op_import_delimited(p, b'\t'),
            "exportCsv" => self.op_export_delimited(p, b','),
            "exportTsv" => self.op_export_delimited(p, b'\t'),
            "exportXlsx" => self.op_export_xlsx(&cmd),
            "evaluate" => self.op_evaluate(p),
            "workbook" => self.op_workbook(),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn apply_batch(
        &mut self,
        cmd: Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let batch = ignition_core::parse_batch(cmd)?;
        let staged = Self { doc: self.doc.clone(), journal: Journal::new(1) };
        let (staged, result) = match ctx {
            Some(ctx) => ignition_core::execute_batch_with_ctx(staged, batch, ctx)?,
            None => ignition_core::execute_batch(staged, batch)?,
        };
        if result.events.iter().any(|event| event.kind == "document:changed") {
            let prev = self.doc.clone();
            self.journal.record(UndoEntry::Reset { prev });
            self.doc = staged.doc;
        }
        Ok(result)
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        // Sheets with a tone, protection flag, stored formats, workbook
        // names, validation rules, conditional-format rules, filter rules,
        // charts, sparkline specs or named views carry durable fields added
        // after the first release; older readers ignore unknown
        // `Sheet`/`Workbook` fields, so wrap those documents and let old
        // engines fail closed instead of silently discarding them. Plain
        // workbooks keep the legacy payload shape.
        // `Workbook` does not deny unknown fields, so each newer table bumps
        // the schema: documents carrying only validations emit schema:2,
        // documents carrying conditional rules emit schema:3 (which may
        // also carry validations), documents carrying filter rules emit
        // schema:4 (which may carry every earlier table), documents
        // carrying charts or sparklines emit schema:5 (which may carry
        // every earlier table), documents carrying named views emit
        // schema:6 (which may carry every earlier table), documents
        // carrying comments emit schema:7 (which may carry every earlier
        // table), documents carrying merged-cell regions emit
        // schema:8 (which may carry every earlier table) and documents
        // carrying pivot specs emit schema:9 (which may carry every
        // earlier table) and documents carrying table objects emit
        // schema:10 (which may carry every earlier table) — `Sheet`/`Workbook` lack `deny_unknown_fields`,
        // so older readers would silently drop `merges`/`pivots` without
        // the bump. Tone/protection/formats/names alone
        // stay schema:1 — older readers reject the higher schemas rather
        // than silently dropping rules/specs (see docs/ENGINE_OPS.md).
        let has_validations = !self.doc.validations.is_empty();
        let has_conditional = !self.doc.conditional_formats.is_empty();
        let has_filters = !self.doc.filters.is_empty();
        let has_charts = !self.doc.charts.is_empty() || !self.doc.sparklines.is_empty();
        // `active_view` selections ride inside `sheets`; they only exist
        // alongside the views table, but counting them keeps the emit
        // honest even for a hand-built in-memory document.
        let has_views = !self.doc.views.is_empty()
            || self.doc.sheets.iter().any(|s| s.active_view.is_some());
        let has_comments = !self.doc.comments.is_empty();
        let has_merges = self.doc.sheets.iter().any(|s| !s.merges.is_empty());
        let has_pivots = !self.doc.pivots.is_empty();
        let has_tables = !self.doc.tables.is_empty();
        let extended = self.doc.sheets.iter().any(|s| {
            s.tone.is_some()
                || s.is_protected
                || !s.formats.is_empty()
                || !s.merges.is_empty()
        }) || !self.doc.names.is_empty()
            || has_validations
            || has_conditional
            || has_filters
            || has_charts
            || has_views
            || has_comments
            || has_pivots
            || has_tables;
        let payload = if extended {
            serde_json::to_vec(&VersionedSnapshot {
                kind: "tally",
                schema: if has_tables {
                    10
                } else if has_pivots {
                    9
                } else if has_merges {
                    8
                } else if has_comments {
                    7
                } else if has_views {
                    6
                } else if has_charts {
                    5
                } else if has_filters {
                    4
                } else if has_conditional {
                    3
                } else if has_validations {
                    2
                } else {
                    1
                },
                document: &self.doc,
            })?
        } else {
            serde_json::to_vec(&self.doc)?
        };
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_tag, payload) = decode_envelope(data)?;
        // Decode + validate into a local first so failures leave state untouched.
        let value: Value = serde_json::from_slice(payload)?;
        let wrapped = value.as_object().is_some_and(|object| {
            ["kind", "schema", "document"]
                .iter()
                .any(|key| object.contains_key(*key))
        });
        let mut doc: Workbook;
        // Schema of a wrapped snapshot (`None` for a bare legacy Workbook,
        // which predates every versioned table).
        let mut snapshot_schema: Option<u32> = None;
        if wrapped {
            let wrapper: VersionedDoc = serde_json::from_value(value)?;
            // schema:2 (validations only), schema:3 (conditional rules,
            // possibly alongside validations), schema:4 (filter rules,
            // possibly alongside every earlier table), schema:5 (chart
            // objects and sparkline specs, possibly alongside every earlier
            // table), schema:6 (named sheet views and `active_view`
            // selections, possibly alongside every earlier table),
            // schema:7 (comments, possibly alongside every earlier table),
            // schema:8 (merged-cell regions, possibly alongside every
            // earlier table), schema:9 (pivot specs, possibly alongside
            // every earlier table) and schema:10 (table objects,
            // possibly alongside every earlier table) are all honored;
            // every table absent
            // from a document deserializes to its serde default, so
            // cross-version payloads never lose the other families' rules.
            if wrapper.kind != "tally"
                || !matches!(wrapper.schema, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10)
            {
                return Err(EngineError::unsupported(
                    "unsupported Tally snapshot kind/schema",
                ));
            }
            snapshot_schema = Some(wrapper.schema);
            doc = wrapper.document;
        } else {
            doc = serde_json::from_value(value)?;
        }
        // Fail closed on crafted lower-version payloads smuggling newer
        // tables: each durable table restores only under the schema that
        // introduced it — pivot specs need schema:9, merged regions
        // schema:8, comments schema:7,
        // named views and `active_view` selections schema:6, chart/sparkline
        // specs schema:5, filter rules schema:4, conditional rules schema:3,
        // validations schema:2 — and a bare (unwrapped) Workbook predates
        // every versioned table. Emit always stamps the highest table
        // present, so
        // honest payloads are unaffected; this only rejects hand-built
        // downgrades.
        if !doc.tables.is_empty() && snapshot_schema.is_none_or(|s| s < 10) {
            return Err(EngineError::serialization(
                "table objects require snapshot schema 10",
            ));
        }
        if !doc.pivots.is_empty() && snapshot_schema.is_none_or(|s| s < 9) {
            return Err(EngineError::serialization(
                "pivot specs require snapshot schema 9",
            ));
        }
        if doc.sheets.iter().any(|s| !s.merges.is_empty())
            && snapshot_schema.is_none_or(|s| s < 8)
        {
            return Err(EngineError::serialization(
                "merged cells require snapshot schema 8",
            ));
        }
        if !doc.comments.is_empty() && snapshot_schema.is_none_or(|s| s < 7) {
            return Err(EngineError::serialization(
                "comments require snapshot schema 7",
            ));
        }
        if (!doc.views.is_empty()
            || doc.sheets.iter().any(|s| s.active_view.is_some()))
            && snapshot_schema.is_none_or(|s| s < 6)
        {
            return Err(EngineError::serialization(
                "sheet views require snapshot schema 6",
            ));
        }
        if (!doc.charts.is_empty() || !doc.sparklines.is_empty())
            && snapshot_schema.is_none_or(|s| s < 5)
        {
            return Err(EngineError::serialization(
                "charts and sparklines require snapshot schema 5",
            ));
        }
        if !doc.filters.is_empty() && snapshot_schema.is_none_or(|s| s < 4) {
            return Err(EngineError::serialization(
                "filters require snapshot schema 4",
            ));
        }
        if !doc.conditional_formats.is_empty()
            && snapshot_schema.is_none_or(|s| s < 3)
        {
            return Err(EngineError::serialization(
                "conditional formats require snapshot schema 3",
            ));
        }
        if !doc.validations.is_empty() && snapshot_schema.is_none_or(|s| s < 2) {
            return Err(EngineError::serialization(
                "validations require snapshot schema 2",
            ));
        }
        if doc.sheets.is_empty() {
            return Err(EngineError::serialization(
                "workbook must contain at least one sheet",
            ));
        }
        if doc.active >= doc.sheets.len() {
            return Err(EngineError::serialization(
                "workbook active index out of range",
            ));
        }
        if let Some(max_id) = doc.sheets.iter().map(|s| s.id).max() {
            if doc.next_sheet <= max_id {
                doc.next_sheet = max_id.checked_add(1)
                    .ok_or_else(|| EngineError::serialization("sheet id space exhausted"))?;
            }
        }
        // Reject crafted snapshots: sheet ids/names must be unique and every
        // cell key must be a canonical address reachable via the ops.
        let mut seen_ids = std::collections::BTreeSet::new();
        let mut seen_names = std::collections::BTreeSet::new();
        for s in &mut doc.sheets {
            if !sheet_ops::valid_tone(s.tone.as_deref()) {
                return Err(EngineError::serialization("invalid sheet tone"));
            }
            if !seen_ids.insert(s.id) {
                return Err(EngineError::serialization("duplicate sheet id"));
            }
            if !seen_names.insert(s.name.to_ascii_lowercase()) {
                return Err(EngineError::serialization("duplicate sheet name"));
            }
            for key in std::mem::take(&mut s.cells).into_iter() {
                let (col, row) = formula::parse_addr(&key.0)
                    .filter(|&(c, r)| formula::on_sheet(c, r))
                    .ok_or_else(|| {
                        EngineError::serialization(format!("invalid cell key '{}'", key.0))
                    })?;
                s.cells.insert(formula::fmt_addr(col, row), key.1);
            }
            // Format keys get the same canonical-address treatment as cell
            // keys, and every stored format must satisfy the op-level
            // invariants (bounded strings, #RRGGBB colors, sane borders).
            for (key, mut fmt) in std::mem::take(&mut s.formats).into_iter() {
                let (col, row) = formula::parse_addr(&key)
                    .filter(|&(c, r)| formula::on_sheet(c, r))
                    .ok_or_else(|| {
                        EngineError::serialization(format!("invalid format key '{key}'"))
                    })?;
                if !format_ops::valid_format(&fmt) {
                    return Err(EngineError::serialization(format!(
                        "invalid cell format at '{key}'"
                    )));
                }
                format_ops::canonicalize(&mut fmt);
                if !fmt.is_empty() {
                    s.formats.insert(formula::fmt_addr(col, row), fmt);
                }
            }
            // Merge regions get the same hostile-input treatment: bounded
            // count, normalized to canonical endpoint order, at least two
            // cells, on-sheet, inside the shared cell cap, and pairwise
            // non-overlapping.
            if s.merges.len() > struct_ops::MAX_MERGES {
                return Err(EngineError::serialization("too many merged regions"));
            }
            for m in &mut s.merges {
                if m.c0 > m.c1 {
                    std::mem::swap(&mut m.c0, &mut m.c1);
                }
                if m.r0 > m.r1 {
                    std::mem::swap(&mut m.r0, &mut m.r1);
                }
                if !struct_ops::merge_ok(m) {
                    return Err(EngineError::serialization("invalid merge region"));
                }
            }
            for i in 0..s.merges.len() {
                for j in (i + 1)..s.merges.len() {
                    let (a, b) = (&s.merges[i], &s.merges[j]);
                    let overlap = a.c0 <= b.c1
                        && b.c0 <= a.c1
                        && a.r0 <= b.r1
                        && b.r0 <= a.r1;
                    if overlap {
                        return Err(EngineError::serialization(
                            "overlapping merge regions",
                        ));
                    }
                }
            }
        }
        // Named ranges get the same hostile-input treatment: bounded count,
        // legal unique names, existing sheet ids, on-sheet refers_to that is
        // re-canonicalized before state is replaced.
        if doc.names.len() > name_ops::MAX_NAMES {
            return Err(EngineError::serialization("too many named ranges"));
        }
        let mut seen_range_names = std::collections::BTreeSet::new();
        for n in &mut doc.names {
            if !name_ops::valid_name(&n.name) {
                return Err(EngineError::serialization(format!(
                    "invalid defined name '{}'",
                    n.name
                )));
            }
            if !seen_range_names.insert(n.name.to_ascii_lowercase()) {
                return Err(EngineError::serialization("duplicate defined name"));
            }
            if !doc.sheets.iter().any(|s| s.id == n.sheet) {
                return Err(EngineError::serialization(format!(
                    "name '{}' references a missing sheet",
                    n.name
                )));
            }
            let coords = name_ops::parse_refers_to(&n.refers_to)
                .map_err(|_| EngineError::serialization("invalid refers_to"))?;
            n.refers_to = name_ops::canonical_refers_to(coords);
        }
        // Validation rules get the same hostile-input treatment: bounded
        // count, unique ids, existing sheet ids, canonical on-sheet ranges
        // within the shared cell cap, criteria satisfying the op-level
        // invariants, and no overlapping rules on one sheet.
        if doc.validations.len() > validation_ops::MAX_VALIDATIONS {
            return Err(EngineError::serialization("too many validation rules"));
        }
        let mut seen_rule_ids = std::collections::BTreeSet::new();
        for v in &mut doc.validations {
            if !seen_rule_ids.insert(v.id) {
                return Err(EngineError::serialization("duplicate validation rule id"));
            }
            if !doc.sheets.iter().any(|s| s.id == v.sheet) {
                return Err(EngineError::serialization(
                    "validation rule references a missing sheet",
                ));
            }
            if !validation_ops::valid_criteria(&v.criteria) {
                return Err(EngineError::serialization("invalid validation criteria"));
            }
            let coords = name_ops::parse_refers_to(&v.range)
                .map_err(|_| EngineError::serialization("invalid validation range"))?;
            if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                > MAX_GET_RANGE_CELLS
            {
                return Err(EngineError::serialization(
                    "validation range exceeds 16384 cells",
                ));
            }
            v.range = name_ops::canonical_refers_to(coords);
        }
        for i in 0..doc.validations.len() {
            for j in (i + 1)..doc.validations.len() {
                let (a, b) = (&doc.validations[i], &doc.validations[j]);
                if a.sheet == b.sheet {
                    let (ca, cb) = (
                        name_ops::parse_refers_to(&a.range),
                        name_ops::parse_refers_to(&b.range),
                    );
                    if let (Ok(ca), Ok(cb)) = (ca, cb) {
                        if ca.0 <= cb.2 && cb.0 <= ca.2 && ca.1 <= cb.3 && cb.1 <= ca.3 {
                            return Err(EngineError::serialization(
                                "overlapping validation rules",
                            ));
                        }
                    }
                }
            }
        }
        if let Some(max_id) = doc.validations.iter().map(|v| v.id).max() {
            if doc.next_validation <= max_id {
                doc.next_validation = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("validation id space exhausted")
                })?;
            }
        }
        if doc.next_validation == 0 {
            doc.next_validation = 1;
        }
        // Conditional rules get the same hostile-input treatment: bounded
        // count, unique ids, existing sheet ids, canonical on-sheet ranges
        // within the shared cell cap, criteria the matcher accepts, and
        // valid format payloads.
        if doc.conditional_formats.len() > conditional_ops::MAX_CONDITIONAL_RULES {
            return Err(EngineError::serialization(
                "too many conditional format rules",
            ));
        }
        let mut seen_conditional_ids = std::collections::BTreeSet::new();
        for r in &mut doc.conditional_formats {
            if !seen_conditional_ids.insert(r.id) {
                return Err(EngineError::serialization(
                    "duplicate conditional rule id",
                ));
            }
            if !doc.sheets.iter().any(|s| s.id == r.sheet) {
                return Err(EngineError::serialization(
                    "conditional rule references a missing sheet",
                ));
            }
            if !formula::CriteriaMatcher::is_valid(&r.criteria) {
                return Err(EngineError::serialization(
                    "invalid conditional criteria",
                ));
            }
            // Normalize before validating so stored rules stay canonical:
            // `false` booleans collapse to absent exactly like the op path,
            // keeping identical-resubmission equality and re-serialization
            // stable for hostile `{"bold":false}` payloads.
            conditional_ops::normalize_format(&mut r.format);
            if !conditional_ops::valid_conditional_format(&r.format) {
                return Err(EngineError::serialization(
                    "invalid conditional format",
                ));
            }
            let coords = name_ops::parse_refers_to(&r.range)
                .map_err(|_| EngineError::serialization("invalid conditional range"))?;
            if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                > MAX_GET_RANGE_CELLS
            {
                return Err(EngineError::serialization(
                    "conditional range exceeds 16384 cells",
                ));
            }
            r.range = name_ops::canonical_refers_to(coords);
        }
        if let Some(max_id) = doc.conditional_formats.iter().map(|r| r.id).max() {
            if doc.next_conditional <= max_id {
                doc.next_conditional = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("conditional rule id space exhausted")
                })?;
            }
        }
        if doc.next_conditional == 0 {
            doc.next_conditional = 1;
        }
        // Filter rules get the same hostile-input treatment: bounded count,
        // unique ids, existing sheet ids, canonical on-sheet ranges within
        // the shared cell cap, criteria the matcher accepts, and columns
        // that parse and lie inside the rule range.
        if doc.filters.len() > filter_ops::MAX_FILTERS {
            return Err(EngineError::serialization("too many filter rules"));
        }
        let mut seen_filter_ids = std::collections::BTreeSet::new();
        for f in &mut doc.filters {
            if !seen_filter_ids.insert(f.id) {
                return Err(EngineError::serialization("duplicate filter rule id"));
            }
            if !doc.sheets.iter().any(|s| s.id == f.sheet) {
                return Err(EngineError::serialization(
                    "filter rule references a missing sheet",
                ));
            }
            let coords = name_ops::parse_refers_to(&f.range)
                .map_err(|_| EngineError::serialization("invalid filter range"))?;
            if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                > MAX_GET_RANGE_CELLS
            {
                return Err(EngineError::serialization(
                    "filter range exceeds 16384 cells",
                ));
            }
            f.range = name_ops::canonical_refers_to(coords);
            // Normalize the column to canonical uppercase letters inside the
            // range before the field-level check, so stored rules stay
            // canonical like every other table.
            if let Some(col) = &mut f.column {
                let idx = filter_ops::column_index(col)
                    .filter(|&c| c >= coords.0 && c <= coords.2)
                    .ok_or_else(|| {
                        EngineError::serialization("invalid filter column")
                    })?;
                *col = filter_ops::column_name(idx);
            }
            if !filter_ops::valid_stored(f) {
                return Err(EngineError::serialization("invalid filter criteria"));
            }
        }
        if let Some(max_id) = doc.filters.iter().map(|f| f.id).max() {
            if doc.next_filter <= max_id {
                doc.next_filter = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("filter id space exhausted")
                })?;
            }
        }
        if doc.next_filter == 0 {
            doc.next_filter = 1;
        }
        // Chart objects get the same hostile-input treatment: bounded
        // count, unique ids, existing sheet ids, canonical on-sheet ranges
        // within the shared cell cap (re-canonicalized, including each
        // series range), bounded title/series/colors, deduped palette.
        if doc.charts.len() > chart_ops::MAX_CHARTS {
            return Err(EngineError::serialization("too many charts"));
        }
        let mut seen_chart_ids = std::collections::BTreeSet::new();
        for c in &mut doc.charts {
            if !seen_chart_ids.insert(c.id) {
                return Err(EngineError::serialization("duplicate chart id"));
            }
            if !doc.sheets.iter().any(|s| s.id == c.sheet) {
                return Err(EngineError::serialization(
                    "chart references a missing sheet",
                ));
            }
            let coords = name_ops::parse_refers_to(&c.range)
                .map_err(|_| EngineError::serialization("invalid chart range"))?;
            if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                > MAX_GET_RANGE_CELLS
            {
                return Err(EngineError::serialization(
                    "chart range exceeds 16384 cells",
                ));
            }
            c.range = name_ops::canonical_refers_to(coords);
            if let Some(series) = &mut c.series {
                for s in series.iter_mut() {
                    if let Some(range) = &mut s.range {
                        let coords = name_ops::parse_refers_to(range)
                            .map_err(|_| EngineError::serialization("invalid chart series range"))?;
                        if (coords.2 - coords.0 + 1) as u64
                            * (coords.3 - coords.1 + 1) as u64
                            > MAX_GET_RANGE_CELLS
                        {
                            return Err(EngineError::serialization(
                                "chart series range exceeds 16384 cells",
                            ));
                        }
                        *range = name_ops::canonical_refers_to(coords);
                    }
                }
            }
            if let Some(colors) = &mut c.colors {
                let mut seen = std::collections::BTreeSet::new();
                colors.retain(|col| seen.insert(col.clone()));
            }
            if !chart_ops::stored_ok(c) {
                return Err(EngineError::serialization("invalid chart spec"));
            }
        }
        if let Some(max_id) = doc.charts.iter().map(|c| c.id).max() {
            if doc.next_chart <= max_id {
                doc.next_chart = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("chart id space exhausted")
                })?;
            }
        }
        if doc.next_chart == 0 {
            doc.next_chart = 1;
        }
        // Sparkline specs get the same hostile-input treatment: bounded
        // count, unique ids, existing sheet ids, canonical on-sheet target
        // and data ranges within the shared cell cap.
        if doc.sparklines.len() > sparkline_ops::MAX_SPARKLINES {
            return Err(EngineError::serialization("too many sparkline specs"));
        }
        let mut seen_sparkline_ids = std::collections::BTreeSet::new();
        let mut seen_sparkline_targets = std::collections::BTreeSet::new();
        for s in &mut doc.sparklines {
            if !seen_sparkline_ids.insert(s.id) {
                return Err(EngineError::serialization("duplicate sparkline id"));
            }
            if !doc.sheets.iter().any(|sh| sh.id == s.sheet) {
                return Err(EngineError::serialization(
                    "sparkline references a missing sheet",
                ));
            }
            for range in [&mut s.target, &mut s.data] {
                let coords = name_ops::parse_refers_to(range)
                    .map_err(|_| EngineError::serialization("invalid sparkline range"))?;
                if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                    > MAX_GET_RANGE_CELLS
                {
                    return Err(EngineError::serialization(
                        "sparkline range exceeds 16384 cells",
                    ));
                }
                *range = name_ops::canonical_refers_to(coords);
            }
            if !seen_sparkline_targets.insert((s.sheet, s.target.clone())) {
                return Err(EngineError::serialization(
                    "duplicate sparkline target on sheet",
                ));
            }
            if !sparkline_ops::stored_ok(s) {
                return Err(EngineError::serialization("invalid sparkline spec"));
            }
        }
        if let Some(max_id) = doc.sparklines.iter().map(|s| s.id).max() {
            if doc.next_sparkline <= max_id {
                doc.next_sparkline = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("sparkline id space exhausted")
                })?;
            }
        }
        if doc.next_sparkline == 0 {
            doc.next_sparkline = 1;
        }
        // Named views get the same hostile-input treatment: bounded count,
        // unique ids, existing sheet ids, legal names unique
        // case-insensitively per sheet, bounded captured specs whose ranges
        // are re-canonicalized and whose criteria/columns satisfy the
        // op-level invariants, plus `active_view` selections that must
        // reference a view bound to the same sheet.
        if doc.views.len() > view_ops::MAX_VIEWS {
            return Err(EngineError::serialization("too many sheet views"));
        }
        let mut seen_view_ids = std::collections::BTreeSet::new();
        let mut seen_view_names = std::collections::BTreeSet::new();
        for v in &mut doc.views {
            if !seen_view_ids.insert(v.id) {
                return Err(EngineError::serialization("duplicate sheet view id"));
            }
            if !doc.sheets.iter().any(|s| s.id == v.sheet) {
                return Err(EngineError::serialization(
                    "sheet view references a missing sheet",
                ));
            }
            if !view_ops::valid_view_name(&v.name) {
                return Err(EngineError::serialization("invalid sheet view name"));
            }
            // ASCII-case-insensitive like the op path's
            // `eq_ignore_ascii_case` — non-ASCII case pairs stay distinct.
            if !seen_view_names.insert((v.sheet, v.name.to_ascii_lowercase())) {
                return Err(EngineError::serialization(
                    "duplicate sheet view name on sheet",
                ));
            }
            if v.filters.len() > view_ops::MAX_VIEW_FILTERS {
                return Err(EngineError::serialization(
                    "sheet view has too many captured filters",
                ));
            }
            for f in &mut v.filters {
                let coords = name_ops::parse_refers_to(&f.range)
                    .map_err(|_| EngineError::serialization("invalid view filter range"))?;
                if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                    > MAX_GET_RANGE_CELLS
                {
                    return Err(EngineError::serialization(
                        "view filter range exceeds 16384 cells",
                    ));
                }
                f.range = name_ops::canonical_refers_to(coords);
                if let Some(col) = &mut f.column {
                    let idx = filter_ops::column_index(col)
                        .filter(|&c| c >= coords.0 && c <= coords.2)
                        .ok_or_else(|| {
                            EngineError::serialization("invalid view filter column")
                        })?;
                    *col = filter_ops::column_name(idx);
                }
                if !formula::CriteriaMatcher::is_valid(&f.criteria) {
                    return Err(EngineError::serialization(
                        "invalid view filter criteria",
                    ));
                }
            }
            if !view_ops::stored_ok(v) {
                return Err(EngineError::serialization("invalid sheet view"));
            }
        }
        if let Some(max_id) = doc.views.iter().map(|v| v.id).max() {
            if doc.next_view <= max_id {
                doc.next_view = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("view id space exhausted")
                })?;
            }
        }
        if doc.next_view == 0 {
            doc.next_view = 1;
        }
        // Comments get the same hostile-input treatment: bounded count,
        // unique ids, existing sheet ids, anchors re-canonicalized and
        // capped like every other refers_to table, and author/body/flag
        // fields satisfying the op-level invariants.
        if doc.comments.len() > comment_ops::MAX_COMMENTS {
            return Err(EngineError::serialization("too many comments"));
        }
        let mut seen_comment_ids = std::collections::BTreeSet::new();
        for c in &mut doc.comments {
            if !seen_comment_ids.insert(c.id) {
                return Err(EngineError::serialization("duplicate comment id"));
            }
            if !doc.sheets.iter().any(|s| s.id == c.sheet) {
                return Err(EngineError::serialization(
                    "comment references a missing sheet",
                ));
            }
            let coords = name_ops::parse_refers_to(&c.anchor)
                .map_err(|_| EngineError::serialization("invalid comment anchor"))?;
            if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                > MAX_GET_RANGE_CELLS
            {
                return Err(EngineError::serialization(
                    "comment anchor exceeds 16384 cells",
                ));
            }
            c.anchor = name_ops::canonical_refers_to(coords);
            if !comment_ops::stored_ok(c) {
                return Err(EngineError::serialization("invalid comment"));
            }
        }
        if let Some(max_id) = doc.comments.iter().map(|c| c.id).max() {
            if doc.next_comment <= max_id {
                doc.next_comment = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("comment id space exhausted")
                })?;
            }
        }
        if doc.next_comment == 0 {
            doc.next_comment = 1;
        }
        // Pivot specs get the same hostile-input treatment: bounded
        // count, unique ids, existing output *and* source sheet ids,
        // canonical in-cap source ranges re-canonicalized like every
        // other refers_to table, bounded names/field lists and field
        // indices inside the source width.
        if doc.pivots.len() > pivot_ops::MAX_PIVOTS {
            return Err(EngineError::serialization("too many pivot specs"));
        }
        let mut seen_pivot_ids = std::collections::BTreeSet::new();
        for pv in &mut doc.pivots {
            if !seen_pivot_ids.insert(pv.id) {
                return Err(EngineError::serialization("duplicate pivot id"));
            }
            if !doc.sheets.iter().any(|s| s.id == pv.sheet) {
                return Err(EngineError::serialization(
                    "pivot references a missing output sheet",
                ));
            }
            if !doc.sheets.iter().any(|s| s.id == pv.source.sheet) {
                return Err(EngineError::serialization(
                    "pivot references a missing source sheet",
                ));
            }
            let coords = name_ops::parse_refers_to(&pv.source.range)
                .map_err(|_| EngineError::serialization("invalid pivot source range"))?;
            if (coords.2 - coords.0 + 1) as u64 * (coords.3 - coords.1 + 1) as u64
                > MAX_GET_RANGE_CELLS
            {
                return Err(EngineError::serialization(
                    "pivot source range exceeds 16384 cells",
                ));
            }
            pv.source.range = name_ops::canonical_refers_to(coords);
            if !pivot_ops::stored_ok(pv) {
                return Err(EngineError::serialization("invalid pivot spec"));
            }
        }
        if let Some(max_id) = doc.pivots.iter().map(|pv| pv.id).max() {
            if doc.next_pivot <= max_id {
                doc.next_pivot = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("pivot id space exhausted")
                })?;
            }
        }
        if doc.next_pivot == 0 {
            doc.next_pivot = 1;
        }
        // Table objects get the same hostile-input treatment: bounded
        // count, unique ids, existing bound sheet ids, legal
        // workbook-wide-unique names, canonical in-cap ranges of at
        // least two cells re-canonicalized like every other refers_to
        // table, no overlapping tables or merges on one sheet, strict
        // spec shape and `next_table` id-space repair.
        if doc.tables.len() > table_ops::MAX_TABLES {
            return Err(EngineError::serialization("too many table objects"));
        }
        let mut seen_table_ids = std::collections::BTreeSet::new();
        let mut seen_table_names = std::collections::BTreeSet::new();
        for t in &mut doc.tables {
            if !seen_table_ids.insert(t.id) {
                return Err(EngineError::serialization("duplicate table id"));
            }
            if !doc.sheets.iter().any(|s| s.id == t.sheet) {
                return Err(EngineError::serialization(
                    "table references a missing sheet",
                ));
            }
            let coords = name_ops::parse_refers_to(&t.range)
                .map_err(|_| EngineError::serialization("invalid table range"))?;
            t.range = name_ops::canonical_refers_to(coords);
            if !table_ops::stored_ok(t) {
                return Err(EngineError::serialization("invalid table spec"));
            }
            if !seen_table_names.insert(t.name.to_ascii_lowercase()) {
                return Err(EngineError::serialization(
                    "duplicate table name",
                ));
            }
        }
        // Pairwise overlap rules per sheet: tables may not intersect
        // each other or any merged region on their bound sheet (the op
        // path enforces both directions; structural remaps preserve
        // disjointness, so engine-emitted documents always satisfy this).
        for i in 0..doc.tables.len() {
            let (sheet, coords) = {
                let t = &doc.tables[i];
                let Some(c) = table_ops::range_coords(t) else {
                    return Err(EngineError::serialization("invalid table range"));
                };
                (t.sheet, c)
            };
            for j in (i + 1)..doc.tables.len() {
                let u = &doc.tables[j];
                if u.sheet == sheet
                    && table_ops::range_coords(u)
                        .is_some_and(|c| struct_ops::rects_overlap(c, coords))
                {
                    return Err(EngineError::serialization(
                        "overlapping table objects",
                    ));
                }
            }
            if let Some(s) = doc.sheets.iter().find(|s| s.id == sheet) {
                if s.merges.iter().any(|m| {
                    struct_ops::rects_overlap(coords, (m.c0, m.r0, m.c1, m.r1))
                }) {
                    return Err(EngineError::serialization(
                        "table overlaps a merged region",
                    ));
                }
            }
        }
        if let Some(max_id) = doc.tables.iter().map(|t| t.id).max() {
            if doc.next_table <= max_id {
                doc.next_table = max_id.checked_add(1).ok_or_else(|| {
                    EngineError::serialization("table id space exhausted")
                })?;
            }
        }
        if doc.next_table == 0 {
            doc.next_table = 1;
        }
        for s in &doc.sheets {
            if let Some(av) = s.active_view {
                if !doc
                    .views
                    .iter()
                    .any(|v| v.id == av && v.sheet == s.id)
                {
                    return Err(EngineError::serialization(
                        "sheet active_view references a missing view",
                    ));
                }
            }
        }
        self.doc = doc;
        self.journal = Journal::new(JOURNAL_CAPACITY);
        Ok(())
    }

    fn undo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_undo() {
            None => Ok(false),
            Some(e) => {
                let redo = self.invert(e);
                self.journal.push_redo(redo);
                Ok(true)
            }
        }
    }

    fn redo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_redo() {
            None => Ok(false),
            Some(e) => {
                let undo = self.invert(e);
                self.journal.push_undo(undo);
                Ok(true)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Minimal base64 (ignition_core::protocol is crate-private) — same codec as
// quill/folio.
// ---------------------------------------------------------------------------

const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

#[cfg(test)]
fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64_ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(B64_ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64_ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn base64_decode(s: &str) -> Result<Vec<u8>, EngineError> {
    let mut table = [255u8; 256];
    for (i, &c) in B64_ALPHABET.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let s = s.trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        let v = table[c as usize];
        if v == 255 {
            return Err(EngineError::serialization("invalid base64 in bytes_b64"));
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;
    use serde_json::json;

    fn cmd(op: &str, payload: Value) -> Command {
        Command::new(op, payload)
    }

    fn apply(e: &mut TallyEngine, op: &str, payload: Value) -> CommandResult {
        match e.apply(cmd(op, payload.clone())) {
            Ok(r) => r,
            Err(err) => panic!("{op} {payload} failed: {err:?}"),
        }
    }

    fn apply_err(e: &mut TallyEngine, op: &str, payload: Value) -> EngineError {
        e.apply(cmd(op, payload)).unwrap_err()
    }

    fn data(e: &mut TallyEngine, op: &str, payload: Value) -> Value {
        apply(e, op, payload).data
    }

    fn describe(e: &mut TallyEngine) -> Value {
        data(e, "describe", json!({}))
    }

    fn get_cell(e: &mut TallyEngine, addr: &str) -> Value {
        data(e, "getCell", json!({ "addr": addr }))
    }

    // -- basics ----------------------------------------------------------------

    #[test]
    fn kind_and_new_defaults() {
        let mut e = TallyEngine::new();
        assert_eq!(e.kind(), EngineKind::Tally);
        let d = describe(&mut e);
        assert_eq!(d["active"], json!(0));
        assert_eq!(d["next_sheet"], json!(1));
        assert_eq!(d["sheets"].as_array().unwrap().len(), 1);
        assert_eq!(d["sheets"][0]["name"], json!("Sheet1"));
        assert_eq!(d["sheets"][0]["id"], json!(0));
        assert!(d["sheets"][0]["cells"].as_object().unwrap().is_empty());

        // `new` on a dirty doc resets it.
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        let r = data(&mut e, "new", json!({}));
        assert_eq!(r["ok"], json!(true));
        assert_eq!(
            data(&mut e, "workbook", json!({})),
            json!({"sheets":[{"name":"Sheet1","cell_count":0,"tone":null,"is_protected":false}],"active":0})
        );
    }

    #[test]
    fn version_gate_and_unknown_op() {
        let mut e = TallyEngine::new();
        let mut c = cmd("workbook", json!({}));
        c.v = 2;
        assert_eq!(e.apply(c).unwrap_err().code, ErrorCode::Unsupported);
        assert_eq!(
            apply_err(&mut e, "bogus", json!({})).code,
            ErrorCode::InvalidCommand
        );
    }

    // -- cells ------------------------------------------------------------------

    #[test]
    fn set_get_cell_variants() {
        let mut e = TallyEngine::new();
        // numeric string → number
        let r = data(&mut e, "setCell", json!({"addr":"A1","value":"42"}));
        assert_eq!(r, json!({"addr":"A1","computed":42.0}));
        // formula
        let r = data(&mut e, "setCell", json!({"addr":"$a$2","value":"=A1*2"}));
        assert_eq!(r, json!({"addr":"A2","computed":84.0}));
        // text stays text
        let r = data(&mut e, "setCell", json!({"addr":"B1","value":"hi"}));
        assert_eq!(r["computed"], json!("hi"));
        // JSON number / bool values are stored canonically
        let r = data(&mut e, "setCell", json!({"addr":"C1","value":3.5}));
        assert_eq!(r["computed"], json!(3.5));
        let r = data(&mut e, "setCell", json!({"addr":"C2","value":true}));
        assert_eq!(r["computed"], json!("TRUE"));

        let g = get_cell(&mut e, "A2");
        assert_eq!(g["raw"], json!("=A1*2"));
        assert_eq!(g["computed"], json!(84.0));
        // empty cell → raw "", computed null
        assert_eq!(get_cell(&mut e, "Z9"), json!({"raw":"","computed":null}));

        // "" clears the cell
        data(&mut e, "setCell", json!({"addr":"B1","value":""}));
        assert_eq!(get_cell(&mut e, "B1"), json!({"raw":"","computed":null}));
        // null also clears
        data(&mut e, "setCell", json!({"addr":"A1","value":null}));
        assert_eq!(get_cell(&mut e, "A1"), json!({"raw":"","computed":null}));
        // A2's formula now sees empty A1 → 0
        assert_eq!(get_cell(&mut e, "A2")["computed"], json!(0.0));
    }

    #[test]
    fn cell_ops_validation() {
        let mut e = TallyEngine::new();
        assert_eq!(
            apply_err(&mut e, "setCell", json!({"addr":"1A","value":"1"})).code,
            ErrorCode::Validation
        );
        assert_eq!(
            apply_err(&mut e, "setCell", json!({"addr":"A1"})).code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            apply_err(&mut e, "setCell", json!({"addr":"A1","value":[1,2]})).code,
            ErrorCode::Validation
        );
        assert_eq!(
            apply_err(&mut e, "getCell", json!({"addr":"?"})).code,
            ErrorCode::Validation
        );
        // state unchanged
        assert_eq!(
            data(&mut e, "workbook", json!({})),
            json!({"sheets":[{"name":"Sheet1","cell_count":0,"tone":null,"is_protected":false}],"active":0})
        );
    }

    #[test]
    fn computed_is_derived_live() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"10"}));
        data(&mut e, "setCell", json!({"addr":"A2","value":"=A1*2"}));
        assert_eq!(get_cell(&mut e, "A2")["computed"], json!(20.0));
        data(&mut e, "setCell", json!({"addr":"A1","value":"50"}));
        assert_eq!(get_cell(&mut e, "A2")["computed"], json!(100.0));
    }

    #[test]
    fn get_range_op() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        data(&mut e, "setCell", json!({"addr":"B2","value":"=A1+10"}));
        let r = data(&mut e, "getRange", json!({"from":"A1","to":"B2"}));
        let cells = r["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 2); // two rows
        assert_eq!(
            cells[0][0],
            json!({"addr":"A1","raw":"1","computed":1.0})
        );
        assert_eq!(cells[0][1], json!({"addr":"B1","raw":"","computed":null}));
        assert_eq!(cells[1][0], json!({"addr":"A2","raw":"","computed":null}));
        assert_eq!(
            cells[1][1],
            json!({"addr":"B2","raw":"=A1+10","computed":11.0})
        );
        // reversed bounds are normalized
        let r2 = data(&mut e, "getRange", json!({"from":"B2","to":"A1"}));
        assert_eq!(r2, r);
        // oversized range → OutOfBounds, state untouched
        assert_eq!(
            apply_err(&mut e, "getRange", json!({"from":"A1","to":"ZZ9999"})).code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn evaluate_op() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"7"}));
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"=A1*6"})),
            json!({"value":42.0})
        );
        // '=' is optional
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"SUM(1,2)"})),
            json!({"value":3.0})
        );
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"1/0"})),
            json!({"value":"#DIV/0!"})
        );
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"=("})),
            json!({"value":"#NAME?"})
        );
        assert_eq!(
            apply_err(&mut e, "evaluate", json!({"formula":5})).code,
            ErrorCode::InvalidCommand
        );
    }

    #[test]
    fn formulas_end_to_end() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"=1+2*3"}));
        data(&mut e, "setCell", json!({"addr":"A2","value":"=\"x\"&\"y\""}));
        data(&mut e, "setCell", json!({"addr":"A3","value":"=A1>5"}));
        data(&mut e, "setCell", json!({"addr":"A4","value":"=IF(A3,\"big\",\"small\")"}));
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!(7.0));
        assert_eq!(get_cell(&mut e, "A2")["computed"], json!("xy"));
        assert_eq!(get_cell(&mut e, "A3")["computed"], json!(true));
        assert_eq!(get_cell(&mut e, "A4")["computed"], json!("big"));
    }

    #[test]
    fn cycles_end_to_end() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"=B1"}));
        data(&mut e, "setCell", json!({"addr":"B1","value":"=A1"}));
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!("#CYCLE!"));
        assert_eq!(get_cell(&mut e, "B1")["computed"], json!("#CYCLE!"));
        data(&mut e, "setCell", json!({"addr":"C1","value":"=A1+1"}));
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!("#CYCLE!"));
        // break the cycle
        data(&mut e, "setCell", json!({"addr":"B1","value":"9"}));
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!(9.0));
    }

    // -- sheets -----------------------------------------------------------------

    #[test]
    fn sheet_lifecycle() {
        let mut e = TallyEngine::new();
        let r = data(&mut e, "addSheet", json!({}));
        assert_eq!(r["sheet"]["name"], json!("Sheet2"));
        assert_eq!(r["sheet"]["id"], json!(1));
        assert_eq!(r["sheet"]["index"], json!(1));
        let r = data(&mut e, "addSheet", json!({"name":"Data"}));
        assert_eq!(r["sheet"]["name"], json!("Data"));
        // duplicate name (case-insensitive) → Validation, state unchanged
        let before = describe(&mut e);
        assert_eq!(
            apply_err(&mut e, "addSheet", json!({"name":"data"})).code,
            ErrorCode::Validation
        );
        assert_eq!(describe(&mut e), before);

        // setActive by name and by index
        data(&mut e, "setActive", json!({"sheet":"data"}));
        assert_eq!(describe(&mut e)["active"], json!(2));
        data(&mut e, "setActive", json!({"sheet":0}));
        assert_eq!(describe(&mut e)["active"], json!(0));
        assert_eq!(
            apply_err(&mut e, "setActive", json!({"sheet":"Nope"})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "setActive", json!({"sheet":9})).code,
            ErrorCode::OutOfBounds
        );

        // rename by index, check uniqueness
        data(&mut e, "renameSheet", json!({"sheet":1,"to":"Renamed"}));
        assert_eq!(describe(&mut e)["sheets"][1]["name"], json!("Renamed"));
        assert_eq!(
            apply_err(&mut e, "renameSheet", json!({"sheet":"Renamed","to":"DATA"})).code,
            ErrorCode::Validation
        );

        // remove middle sheet while another is active
        data(&mut e, "setActive", json!({"sheet":"Data"}));
        data(&mut e, "removeSheet", json!({"sheet":"Renamed"}));
        let d = describe(&mut e);
        assert_eq!(d["sheets"].as_array().unwrap().len(), 2);
        assert_eq!(d["sheets"][d["active"].as_u64().unwrap() as usize]["name"], json!("Data"));

        // removing the last sheets is rejected
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert_eq!(
            apply_err(&mut e, "removeSheet", json!({"sheet":0})).code,
            ErrorCode::Validation
        );
        assert_eq!(describe(&mut e)["sheets"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn cells_are_per_active_sheet() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        data(&mut e, "addSheet", json!({"name":"Two"}));
        data(&mut e, "setActive", json!({"sheet":"Two"}));
        // Sheet "Two" has no A1 — formulas see the active sheet only.
        assert_eq!(get_cell(&mut e, "A1"), json!({"raw":"","computed":null}));
        data(&mut e, "setCell", json!({"addr":"A1","value":"2"}));
        assert_eq!(
            data(&mut e, "workbook", json!({})),
            json!({
                "sheets":[
                    {"name":"Sheet1","cell_count":1,"tone":null,"is_protected":false},
                    {"name":"Two","cell_count":1,"tone":null,"is_protected":false}
                ],
                "active":1
            })
        );
        data(&mut e, "setActive", json!({"sheet":0}));
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!(1.0));
    }

    // -- undo / redo ------------------------------------------------------------

    #[test]
    fn undo_redo_cells() {
        let mut e = TallyEngine::new();
        assert_eq!(e.undo().unwrap(), false);
        assert_eq!(e.redo().unwrap(), false);

        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        data(&mut e, "setCell", json!({"addr":"A1","value":"2"}));
        data(&mut e, "clearCell", json!({"addr":"B1"}));
        data(&mut e, "setCell", json!({"addr":"B1","value":"x"}));

        assert!(e.undo().unwrap()); // undo B1 set
        assert_eq!(get_cell(&mut e, "B1"), json!({"raw":"","computed":null}));
        assert!(e.undo().unwrap()); // undo B1 clear (was already empty)
        assert!(e.undo().unwrap()); // undo A1=2 → back to "1"
        assert_eq!(get_cell(&mut e, "A1"), json!({"raw":"1","computed":1.0}));
        assert!(e.undo().unwrap()); // undo A1=1 → empty
        assert_eq!(get_cell(&mut e, "A1"), json!({"raw":"","computed":null}));
        assert_eq!(e.undo().unwrap(), false);

        assert!(e.redo().unwrap());
        assert_eq!(get_cell(&mut e, "A1")["raw"], json!("1"));
        assert!(e.redo().unwrap());
        assert_eq!(get_cell(&mut e, "A1")["raw"], json!("2"));
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(get_cell(&mut e, "B1")["raw"], json!("x"));
        assert_eq!(e.redo().unwrap(), false);

        // new mutation clears redo
        assert!(e.undo().unwrap());
        data(&mut e, "setCell", json!({"addr":"C1","value":"z"}));
        assert_eq!(e.redo().unwrap(), false);
    }

    #[test]
    fn undo_redo_sheets_and_new() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        data(&mut e, "addSheet", json!({"name":"S2"}));
        data(&mut e, "setActive", json!({"sheet":"S2"}));
        data(&mut e, "renameSheet", json!({"sheet":"S2","to":"Second"}));

        assert!(e.undo().unwrap()); // un-rename
        assert_eq!(describe(&mut e)["sheets"][1]["name"], json!("S2"));
        assert!(e.undo().unwrap()); // un-setActive
        assert_eq!(describe(&mut e)["active"], json!(0));
        assert!(e.undo().unwrap()); // un-addSheet
        assert_eq!(describe(&mut e)["sheets"].as_array().unwrap().len(), 1);

        // removeSheet undo restores the sheet with its cells
        data(&mut e, "addSheet", json!({"name":"Temp"}));
        data(&mut e, "setActive", json!({"sheet":"Temp"}));
        data(&mut e, "setCell", json!({"addr":"A1","value":"99"}));
        data(&mut e, "removeSheet", json!({"sheet":"Temp"}));
        assert_eq!(describe(&mut e)["sheets"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap()); // un-remove
        assert_eq!(describe(&mut e)["sheets"].as_array().unwrap().len(), 2);
        assert_eq!(describe(&mut e)["sheets"][1]["name"], json!("Temp"));
        assert_eq!(describe(&mut e)["active"], json!(1));
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!(99.0));

        // `new` is undoable too
        data(&mut e, "new", json!({}));
        assert_eq!(describe(&mut e)["sheets"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(describe(&mut e)["sheets"].as_array().unwrap().len(), 2);

        // redo chain still coherent
        while e.redo().unwrap() {}
        assert_eq!(describe(&mut e)["sheets"].as_array().unwrap().len(), 1);
    }

    fn ghost_sheet(id: u64) -> Sheet {
        Sheet {
            id,
            name: "Ghost".to_string(),
            cells: BTreeMap::new(),
            formats: BTreeMap::new(),
            tone: None,
            is_protected: false,
            active_view: None,
            merges: Vec::new(),
        }
    }

    fn dropped_name(name: &str) -> NamedRange {
        NamedRange {
            name: name.to_string(),
            sheet: 77,
            refers_to: "B2".to_string(),
        }
    }

    #[test]
    fn undo_remove_sheet_readmits_names_within_restore_invariants() {
        let mut e = TallyEngine::new();
        data(&mut e, "defineName", json!({"name":"foo","refers_to":"A1"}));
        // A RemoveSheet undo entry recorded while "Foo" was bound to the
        // removed sheet, with "foo" defined while the sheet was gone.
        // Re-admission must skip the case-insensitive duplicate — a bare
        // extend would leave doc.names unrestorable. The public op surface
        // cannot currently produce this interleaving (the journal is
        // strictly LIFO and `record` clears redo), so the entry is crafted
        // directly to pin the invariant.
        e.journal.record(UndoEntry::RemoveSheet {
            prev_next_sheet: 78,
            index: 0,
            sheet: ghost_sheet(77),
            prev_active: 0,
            dropped_names: vec![dropped_name("Foo"), dropped_name("Bar")],
            dropped_validations: Vec::new(),
            dropped_conditional_formats: Vec::new(),
            dropped_filters: Vec::new(),
            dropped_charts: Vec::new(),
            dropped_sparklines: Vec::new(),
            dropped_views: Vec::new(),
            dropped_comments: Vec::new(),
            dropped_pivots: Vec::new(),
            dropped_tables: Vec::new(),
        });
        assert!(e.undo().unwrap());
        // "foo" (defined meanwhile) wins; "Foo" is skipped, "Bar" returns.
        let ns = data(&mut e, "listNames", json!({}))["names"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(ns.len(), 2);
        assert_eq!(ns[0]["name"], json!("foo"));
        assert_eq!(ns[1]["name"], json!("Bar"));
        assert_eq!(ns[1]["sheet"], json!("Ghost"));
        // The document must still snapshot and restore cleanly (the crafted
        // sheet id bumps `next_sheet` on restore, so compare name state, not
        // envelope bytes).
        let saved = e.snapshot().unwrap();
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(
            data(&mut reopened, "listNames", json!({})),
            data(&mut e, "listNames", json!({}))
        );
    }

    #[test]
    fn undo_remove_sheet_dropped_names_respect_max_names() {
        let mut e = TallyEngine::new();
        // Fill the name table to the cap directly; the invariant under test
        // is the re-admission guard, not the define path.
        e.doc.names = (0..name_ops::MAX_NAMES)
            .map(|i| NamedRange {
                name: format!("nm_{i}"),
                sheet: 0,
                refers_to: "A1".to_string(),
            })
            .collect();
        e.journal.record(UndoEntry::RemoveSheet {
            prev_next_sheet: 78,
            index: 0,
            sheet: ghost_sheet(77),
            prev_active: 0,
            dropped_names: vec![dropped_name("Extra")],
            dropped_validations: Vec::new(),
            dropped_conditional_formats: Vec::new(),
            dropped_filters: Vec::new(),
            dropped_charts: Vec::new(),
            dropped_sparklines: Vec::new(),
            dropped_views: Vec::new(),
            dropped_comments: Vec::new(),
            dropped_pivots: Vec::new(),
            dropped_tables: Vec::new(),
        });
        assert!(e.undo().unwrap());
        assert_eq!(e.doc.names.len(), name_ops::MAX_NAMES);
        assert!(e.doc.names.iter().all(|n| n.name != "Extra"));
        let saved = e.snapshot().unwrap();
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
    }

    // -- snapshot / restore -------------------------------------------------------

    #[test]
    fn snapshot_restore_equality() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"=B1*2"}));
        data(&mut e, "setCell", json!({"addr":"B1","value":"21"}));
        data(&mut e, "addSheet", json!({"name":"S2"}));
        data(&mut e, "setActive", json!({"sheet":"S2"}));
        data(&mut e, "setCell", json!({"addr":"C3","value":"text"}));
        let before = describe(&mut e);
        let snap = e.snapshot().unwrap();

        let mut e2 = TallyEngine::new();
        data(&mut e2, "setCell", json!({"addr":"A1","value":"junk"}));
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&mut e2), before);
        // computed values derive identically after restore
        data(&mut e2, "setActive", json!({"sheet":0}));
        assert_eq!(get_cell(&mut e2, "A1")["computed"], json!(42.0));
    }

    #[test]
    fn restore_rejects_garbage() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        let before = describe(&mut e);

        for bad in [
            &b""[..],
            b"NFD",
            b"XXXX\x00\x00\x00\x00\x00",
            b"NFD1\x00\x03\x00\x00\x00ab", // truncated payload
            b"NFD1\x00\x05\x00\x00\x00junk!", // payload is not JSON
        ] {
            assert_eq!(
                e.restore(bad).unwrap_err().code,
                ErrorCode::Serialization,
                "accepted {bad:?}"
            );
        }
        // valid envelope, invalid document (active out of range)
        let bad_doc = encode_envelope(b"{\"next_sheet\":1,\"sheets\":[{\"id\":0,\"name\":\"S\",\"cells\":{}}],\"active\":5}");
        assert_eq!(
            e.restore(&bad_doc).unwrap_err().code,
            ErrorCode::Serialization
        );
        // state untouched throughout
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn snapshot_wraps_only_when_durable_sheet_fields_present() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"5"}));

        // A plain workbook keeps the legacy bare-Workbook payload.
        let plain = e.snapshot().unwrap();
        let (_tag, payload) = decode_envelope(&plain).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert!(v.get("sheets").is_some());
        assert!(v.get("kind").is_none());

        // tone / is_protected are durable fields older readers would drop;
        // their presence switches the payload to {kind:"tally",schema:1}.
        data(&mut e, "setSheetColor", json!({"sheet":0,"tone":"accent"}));
        data(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let snap = e.snapshot().unwrap();
        let (_tag, payload) = decode_envelope(&snap).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["kind"], json!("tally"));
        assert_eq!(v["schema"], json!(1));
        assert!(v["document"]["sheets"].is_array());
        // No root workbook fields, so pre-wrapper readers fail closed rather
        // than silently discarding tone/is_protected.
        assert!(v.get("sheets").is_none());
        assert!(serde_json::from_value::<Workbook>(v.clone()).is_err());

        // The wrapped snapshot restores identically.
        let before = describe(&mut e);
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&mut e2), before);
        assert_eq!(
            data(&mut e2, "workbook", json!({}))["sheets"][0]["is_protected"],
            json!(true)
        );
    }

    #[test]
    fn restore_accepts_wrapped_and_legacy_raw_payloads() {
        let doc = json!({
            "next_sheet": 2,
            "sheets": [{
                "id": 0, "name": "Data", "tone": "info", "is_protected": true,
                "cells": {"B2": {"raw": "=A1*2"}}
            }],
            "active": 0
        });
        // Hand-built wrapped payload (as a future writer might emit).
        let wrapped = json!({"kind":"tally","schema":1,"document":doc});
        let mut e = TallyEngine::new();
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        assert_eq!(
            data(&mut e, "workbook", json!({}))["sheets"][0]["tone"],
            json!("info")
        );
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!(null));

        // The same document as a legacy bare payload still restores.
        let mut e2 = TallyEngine::new();
        e2.restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap()))
            .unwrap();
        assert_eq!(describe(&mut e), describe(&mut e2));
    }

    #[test]
    fn versioned_snapshot_rejects_bad_kind_schema_atomically() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        let before = describe(&mut e);

        let doc = json!({
            "next_sheet": 1,
            "sheets": [{"id":0,"name":"S","cells":{"A1":{"raw":"9"}}}],
            "active": 0
        });
        for wrapper in [
            // wrong schema / wrong kind fail closed (schemas 1–10 are the
            // accepted tally versions; 11 is beyond them)
            json!({"kind":"tally","schema":11,"document":doc}),
            json!({"kind":"quill","schema":1,"document":doc}),
            // unknown wrapper keys rejected by deny_unknown_fields
            json!({"kind":"tally","schema":1,"document":doc,"extra":true}),
            // wrapper whose document fails document validation
            json!({"kind":"tally","schema":1,"document":{
                "next_sheet":1,
                "sheets":[{"id":0,"name":"S","cells":{"A1048577":{"raw":"x"}}}],
                "active":0
            }}),
        ] {
            let bytes = encode_envelope(&serde_json::to_vec(&wrapper).unwrap());
            assert!(e.restore(&bytes).is_err(), "accepted {wrapper}");
            assert_eq!(describe(&mut e), before, "state mutated by {wrapper}");
        }

        // A correct wrapper restores and replaces state + journal.
        let ok = json!({"kind":"tally","schema":1,"document":doc});
        e.restore(&encode_envelope(&serde_json::to_vec(&ok).unwrap()))
            .unwrap();
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!(9.0));
    }

    fn snapshot_schema(e: &TallyEngine) -> (Option<u64>, Value) {
        let snap = e.snapshot().unwrap();
        let (_tag, payload) = decode_envelope(&snap).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        let schema = v.get("schema").and_then(Value::as_u64);
        (schema, v)
    }

    #[test]
    fn snapshot_schema_matrix_emit_and_restore() {
        // Neither durable table → bare legacy Workbook payload.
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, None);
        assert!(v.get("sheets").is_some());

        // Validations only → schema:2; restores with empty conditional table.
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"B1","to":"B1"},"rule":{"kind":"list","values":["a"]}}),
        );
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, Some(2));
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        assert_eq!(data(&mut e2, "describe", json!({}))["validations"].as_array().unwrap().len(), 1);
        assert_eq!(data(&mut e2, "describe", json!({}))["conditional_formats"].as_array().map_or(0, Vec::len), 0);

        // Conditional rules only → schema:3; restores with empty validations.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setConditionalFormat",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}}}),
        );
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, Some(3));
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        assert_eq!(data(&mut e2, "describe", json!({}))["conditional_formats"].as_array().unwrap().len(), 1);
        assert_eq!(data(&mut e2, "describe", json!({}))["validations"].as_array().map_or(0, Vec::len), 0);

        // Both tables → schema:3 carrying both; each restores intact.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"B1","to":"B1"},"rule":{"kind":"list","values":["a"]}}),
        );
        data(
            &mut e,
            "setConditionalFormat",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}}}),
        );
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, Some(3));
        assert_eq!(v["document"]["validations"].as_array().unwrap().len(), 1);
        assert_eq!(v["document"]["conditional_formats"].as_array().unwrap().len(), 1);
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["validations"].as_array().unwrap().len(), 1);
        assert_eq!(d["conditional_formats"].as_array().unwrap().len(), 1);

        // A hand-built schema:2 payload (validations only, no conditional
        // key) restores with an empty conditional table — serde defaults
        // keep the absent family optional in both directions.
        let mut e3 = TallyEngine::new();
        let payload = json!({
            "kind":"tally","schema":2,
            "document":{
                "next_sheet":1,
                "sheets":[{"id":0,"name":"S","cells":{"A1":{"raw":"1"}}}],
                "active":0,
                "validations":[{"id":1,"sheet":0,"range":"A1","criteria":{"kind":"number","min":0}}]
            }
        });
        e3.restore(&encode_envelope(&serde_json::to_vec(&payload).unwrap()))
            .unwrap();
        let d = data(&mut e3, "describe", json!({}));
        assert_eq!(d["validations"].as_array().unwrap().len(), 1);
        assert_eq!(d["conditional_formats"].as_array().map_or(0, Vec::len), 0);
        // Re-saving keeps schema:2 — nothing was silently promoted.
        assert_eq!(snapshot_schema(&e3).0, Some(2));

        // Filters only → schema:4; restores with empty earlier tables.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A4"},"column":"A","criteria":">1"}),
        );
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, Some(4));
        assert_eq!(v["document"]["filters"].as_array().unwrap().len(), 1);
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["filters"].as_array().unwrap().len(), 1);
        assert_eq!(d["conditional_formats"].as_array().map_or(0, Vec::len), 0);
        assert_eq!(d["validations"].as_array().map_or(0, Vec::len), 0);

        // Filters alongside every earlier table → still schema:4, all
        // tables restore intact.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"B1","to":"B1"},"rule":{"kind":"list","values":["a"]}}),
        );
        data(
            &mut e,
            "setConditionalFormat",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}}}),
        );
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A4"},"criteria":"*"}),
        );
        assert_eq!(snapshot_schema(&e).0, Some(4));
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["validations"].as_array().unwrap().len(), 1);
        assert_eq!(d["conditional_formats"].as_array().unwrap().len(), 1);
        assert_eq!(d["filters"].as_array().unwrap().len(), 1);

        // Charts only → schema:5; restores with empty earlier tables.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "insertChart",
            json!({"chart":{"kind":"line","range":{"from":"A1","to":"A4"}}}),
        );
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, Some(5));
        assert_eq!(v["document"]["charts"].as_array().unwrap().len(), 1);
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["charts"].as_array().unwrap().len(), 1);
        assert_eq!(d["filters"].as_array().map_or(0, Vec::len), 0);

        // Sparklines alongside every earlier table → still schema:5, all
        // tables restore intact.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"B1","to":"B1"},"rule":{"kind":"list","values":["a"]}}),
        );
        data(
            &mut e,
            "setConditionalFormat",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}}}),
        );
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A4"},"criteria":"*"}),
        );
        data(
            &mut e,
            "insertChart",
            json!({"chart":{"kind":"column","range":{"from":"A1","to":"A4"},"title":"T"}}),
        );
        data(
            &mut e,
            "setSparkline",
            json!({"cell":"C1","data":{"from":"A1","to":"A4"},"kind":"line"}),
        );
        assert_eq!(snapshot_schema(&e).0, Some(5));
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["validations"].as_array().unwrap().len(), 1);
        assert_eq!(d["conditional_formats"].as_array().unwrap().len(), 1);
        assert_eq!(d["filters"].as_array().unwrap().len(), 1);
        assert_eq!(d["charts"].as_array().unwrap().len(), 1);
        assert_eq!(d["sparklines"].as_array().unwrap().len(), 1);

        // Views only → schema:6; restores with empty earlier tables, and
        // the sheet's active_view selection survives.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A4"},"criteria":">1"}),
        );
        data(&mut e, "saveSheetView", json!({"name":"V"}));
        data(&mut e, "setSheetView", json!({"view":1}));
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, Some(6));
        assert_eq!(v["document"]["views"].as_array().unwrap().len(), 1);
        assert_eq!(v["document"]["sheets"][0]["active_view"], json!(1));
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["views"].as_array().unwrap().len(), 1);
        assert_eq!(d["sheets"][0]["active_view"], json!(1));
        assert_eq!(d["filters"].as_array().unwrap().len(), 1);

        // Views alongside every earlier table → still schema:6, all
        // tables restore intact.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"B1","to":"B1"},"rule":{"kind":"list","values":["a"]}}),
        );
        data(
            &mut e,
            "setConditionalFormat",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}}}),
        );
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A4"},"criteria":"*"}),
        );
        data(
            &mut e,
            "insertChart",
            json!({"chart":{"kind":"column","range":{"from":"A1","to":"A4"}}}),
        );
        data(
            &mut e,
            "setSparkline",
            json!({"cell":"C1","data":{"from":"A1","to":"A4"},"kind":"line"}),
        );
        data(&mut e, "saveSheetView", json!({"name":"All"}));
        assert_eq!(snapshot_schema(&e).0, Some(6));
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["validations"].as_array().unwrap().len(), 1);
        assert_eq!(d["conditional_formats"].as_array().unwrap().len(), 1);
        assert_eq!(d["filters"].as_array().unwrap().len(), 1);
        assert_eq!(d["charts"].as_array().unwrap().len(), 1);
        assert_eq!(d["sparklines"].as_array().unwrap().len(), 1);
        assert_eq!(d["views"].as_array().unwrap().len(), 1);

        // Comments only → schema:7; restores with empty earlier tables.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "addComment",
            json!({"cell":"B2","author":"Ada","body":"note"}),
        );
        let (schema, v) = snapshot_schema(&e);
        assert_eq!(schema, Some(7));
        assert_eq!(v["document"]["comments"].as_array().unwrap().len(), 1);
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["comments"].as_array().unwrap().len(), 1);
        assert_eq!(d["comments"][0]["anchor"], json!("B2"));
        assert_eq!(d["views"].as_array().map_or(0, Vec::len), 0);
        assert_eq!(d["filters"].as_array().map_or(0, Vec::len), 0);

        // Comments alongside every earlier table → still schema:7, all
        // tables restore intact.
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"B1","to":"B1"},"rule":{"kind":"list","values":["a"]}}),
        );
        data(
            &mut e,
            "setConditionalFormat",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}}}),
        );
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A4"},"criteria":"*"}),
        );
        data(
            &mut e,
            "insertChart",
            json!({"chart":{"kind":"column","range":{"from":"A1","to":"A4"}}}),
        );
        data(
            &mut e,
            "setSparkline",
            json!({"cell":"C1","data":{"from":"A1","to":"A4"},"kind":"line"}),
        );
        data(&mut e, "saveSheetView", json!({"name":"All"}));
        data(&mut e, "addComment", json!({"cell":"D1","body":"all tables"}));
        assert_eq!(snapshot_schema(&e).0, Some(7));
        let mut e2 = TallyEngine::new();
        e2.restore(&e.snapshot().unwrap()).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["validations"].as_array().unwrap().len(), 1);
        assert_eq!(d["conditional_formats"].as_array().unwrap().len(), 1);
        assert_eq!(d["filters"].as_array().unwrap().len(), 1);
        assert_eq!(d["charts"].as_array().unwrap().len(), 1);
        assert_eq!(d["sparklines"].as_array().unwrap().len(), 1);
        assert_eq!(d["views"].as_array().unwrap().len(), 1);
        assert_eq!(d["comments"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn restore_rejects_newer_tables_under_lower_or_bare_schema() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        let before = describe(&mut e);
        let sheet = json!({"id":0,"name":"S","cells":{"A1":{"raw":"1"}}});
        let conditional = json!([{
            "id":1,"sheet":0,"range":"A1","criteria":">0","format":{"bold":true}
        }]);
        let validation = json!([{
            "id":1,"sheet":0,"range":"A1","criteria":{"kind":"number","min":0}
        }]);
        let filter = json!([{
            "id":1,"sheet":0,"range":"A1:A4","column":"A","criteria":">1"
        }]);
        let chart = json!([{
            "id":1,"sheet":0,"kind":"line","range":"A1:A4"
        }]);
        let sparkline = json!([{
            "id":1,"sheet":0,"target":"C1","data":"A1:A4","kind":"line"
        }]);
        let view = json!([{
            "id":1,"sheet":0,"name":"V","filters":[{"range":"A1:A4","criteria":">1"}]
        }]);
        let comment = json!([{
            "id":1,"sheet":0,"anchor":"B2","body":"note"
        }]);
        let doc_with = |extra: Value| {
            let mut d = json!({
                "next_sheet":1,
                "sheets":[sheet.clone()],
                "active":0
            });
            for (k, v) in extra.as_object().unwrap() {
                d[k.as_str()] = v.clone();
            }
            d
        };
        for payload in [
            // Conditional rules smuggled under schema:2, schema:1, or a
            // bare (unwrapped) Workbook all fail closed.
            json!({"kind":"tally","schema":2,"document":doc_with(json!({"conditional_formats":conditional.clone()}))}),
            json!({"kind":"tally","schema":1,"document":doc_with(json!({"conditional_formats":conditional.clone()}))}),
            doc_with(json!({"conditional_formats":conditional.clone()})),
            // Same for validations under schema:1 or bare — schema:2 is
            // the minimum that introduced the table.
            json!({"kind":"tally","schema":1,"document":doc_with(json!({"validations":validation.clone()}))}),
            doc_with(json!({"validations":validation.clone()})),
            // Filter rules smuggled under schema:1/2/3 or a bare Workbook
            // all fail closed — schema:4 is the minimum that introduced
            // the table.
            json!({"kind":"tally","schema":3,"document":doc_with(json!({"filters":filter.clone()}))}),
            json!({"kind":"tally","schema":2,"document":doc_with(json!({"filters":filter.clone()}))}),
            json!({"kind":"tally","schema":1,"document":doc_with(json!({"filters":filter.clone()}))}),
            doc_with(json!({"filters":filter.clone()})),
            // Chart/sparkline specs smuggled under schema:1–4 or a bare
            // Workbook all fail closed — schema:5 is the minimum that
            // introduced the tables.
            json!({"kind":"tally","schema":4,"document":doc_with(json!({"charts":chart.clone()}))}),
            json!({"kind":"tally","schema":3,"document":doc_with(json!({"charts":chart.clone()}))}),
            json!({"kind":"tally","schema":2,"document":doc_with(json!({"charts":chart.clone()}))}),
            json!({"kind":"tally","schema":1,"document":doc_with(json!({"charts":chart.clone()}))}),
            doc_with(json!({"charts":chart.clone()})),
            json!({"kind":"tally","schema":4,"document":doc_with(json!({"sparklines":sparkline.clone()}))}),
            json!({"kind":"tally","schema":1,"document":doc_with(json!({"sparklines":sparkline.clone()}))}),
            doc_with(json!({"sparklines":sparkline.clone()})),
            // Named views and active_view selections smuggled under
            // schema:1–5 or a bare Workbook all fail closed — schema:6 is
            // the minimum that introduced them.
            json!({"kind":"tally","schema":5,"document":doc_with(json!({"views":view.clone()}))}),
            json!({"kind":"tally","schema":4,"document":doc_with(json!({"views":view.clone()}))}),
            json!({"kind":"tally","schema":1,"document":doc_with(json!({"views":view.clone()}))}),
            doc_with(json!({"views":view.clone()})),
            json!({"kind":"tally","schema":5,"document":doc_with(json!({"sheets":[{"id":0,"name":"S","cells":{},"active_view":1}]}))}),
            doc_with(json!({"sheets":[{"id":0,"name":"S","cells":{},"active_view":1}]})),
            // Comments smuggled under schema:1–6 or a bare Workbook all
            // fail closed — schema:7 is the minimum that introduced the
            // table.
            json!({"kind":"tally","schema":6,"document":doc_with(json!({"comments":comment.clone()}))}),
            json!({"kind":"tally","schema":5,"document":doc_with(json!({"comments":comment.clone()}))}),
            json!({"kind":"tally","schema":1,"document":doc_with(json!({"comments":comment.clone()}))}),
            doc_with(json!({"comments":comment.clone()})),
        ] {
            let bytes = encode_envelope(&serde_json::to_vec(&payload).unwrap());
            assert!(e.restore(&bytes).is_err(), "accepted {payload}");
            assert_eq!(describe(&mut e), before, "state mutated by {payload}");
        }
        // Honest payloads are unaffected: schema:3 with conditional rules
        // (validations optional) and schema:2 with validations only.
        for (schema, extra) in [
            (3u32, json!({"conditional_formats":conditional})),
            (2u32, json!({"validations":validation})),
            (4u32, json!({"filters":filter})),
            (5u32, json!({"charts":chart,"sparklines":sparkline})),
            (6u32, json!({"views":view})),
            (7u32, json!({"comments":comment})),
        ] {
            let payload = json!({
                "kind":"tally","schema":schema,
                "document":doc_with(extra)
            });
            e.restore(&encode_envelope(&serde_json::to_vec(&payload).unwrap()))
                .unwrap();
        }
    }

    #[test]
    fn full_round_trip() {
        // new → mutate → snapshot → restore → mutate → verify
        let mut e = TallyEngine::new();
        data(&mut e, "new", json!({}));
        data(&mut e, "setCell", json!({"addr":"A1","value":"=SUM(B1:B3,10)"}));
        data(&mut e, "setCell", json!({"addr":"B1","value":"1"}));
        data(&mut e, "setCell", json!({"addr":"B2","value":"2"}));
        data(&mut e, "setCell", json!({"addr":"B3","value":"3"}));
        let snap = e.snapshot().unwrap();

        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        // keep mutating after restore
        data(&mut e2, "setCell", json!({"addr":"B4","value":"4"}));
        assert_eq!(
            data(&mut e2, "evaluate", json!({"formula":"=SUM(B1:B4)"})),
            json!({"value":10.0})
        );
        // undo still works post-restore (journal was reset; new ops record)
        assert!(e2.undo().unwrap());
        assert_eq!(get_cell(&mut e2, "B4"), json!({"raw":"","computed":null}));
        // snapshot equality of the shared prefix is preserved
        assert_eq!(describe(&mut e2)["sheets"][0]["cells"]["A1"]["raw"], json!("=SUM(B1:B3,10)"));
    }

    #[test]
    fn events_emitted_on_mutations_only() {
        let mut e = TallyEngine::new();
        let r = apply(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));
        let r = apply(&mut e, "getCell", json!({"addr":"A1"}));
        assert!(r.events.is_empty());
        let r = apply(&mut e, "workbook", json!({}));
        assert!(r.events.is_empty());
        let r = apply(&mut e, "describe", json!({}));
        assert!(r.events.is_empty());
    }

    #[test]
    fn every_address_op_stops_at_the_sheet_edge() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"XFD1048576","value":"7"}));
        let before = e.snapshot().unwrap();
        let mut undo_depth = 0;
        while e.undo().unwrap() {
            undo_depth += 1;
        }
        for _ in 0..undo_depth {
            e.redo().unwrap();
        }
        for (op, payload) in [
            ("setCell", json!({"addr":"A1048577","value":"x"})),
            ("setCell", json!({"addr":"XFE1","value":"x"})),
            ("clearCell", json!({"addr":"XFE1048577"})),
            ("getCell", json!({"addr":"A4294967295"})),
            ("getRange", json!({"from":"XFD1048576","to":"XFE1048576"})),
            ("setRange", json!({"from":"A1048577","values":[["x"]]})),
            ("fillRange", json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"A1048577"}})),
        ] {
            assert_eq!(apply_err(&mut e, op, payload).code, ErrorCode::OutOfBounds, "{op}");
            assert_eq!(e.snapshot().unwrap(), before, "{op} mutated the document");
        }
        // Nothing above was journaled: undo still reaches only the XFD1048576 write.
        let mut depth = 0;
        while e.undo().unwrap() {
            depth += 1;
        }
        assert_eq!(depth, undo_depth);
        for _ in 0..depth {
            e.redo().unwrap();
        }
        assert_eq!(data(&mut e, "getCell", json!({"addr":"xfd1048576"}))["computed"], 7.0);
        // Formula references past the sheet evaluate to #REF!, not to an empty cell.
        for formula in ["=A1048577", "=XFE1+1", "=SUM(A1:A1048577)", "=SUM(XFD1048576:XFE1048576)"] {
            assert_eq!(data(&mut e, "evaluate", json!({"formula":formula}))["value"], "#REF!", "{formula}");
        }
        assert_eq!(data(&mut e, "evaluate", json!({"formula":"=XFD1048576*2"}))["value"], 14.0);
        // A snapshot holding an off-sheet key is rejected, like any other unreachable key.
        let mut doc = data(&mut e, "describe", json!({}));
        let mut reopened = TallyEngine::new();
        assert!(reopened.restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap())).is_ok());
        doc["sheets"][0]["cells"]["A1048577"] = json!({"raw":"x"});
        let err = reopened
            .restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap()))
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::Serialization);
    }

    // -- cross-sheet formula references -----------------------------------------

    /// Two-sheet fixture: Sheet1 (active, index 0) and "Data" (index 1)
    /// with A1=5, B2=10 on Data.
    fn two_sheets() -> TallyEngine {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(&mut e, "setActive", json!({"sheet":"Data"}));
        data(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        data(&mut e, "setCell", json!({"addr":"B2","value":"10"}));
        data(&mut e, "setActive", json!({"sheet":"Sheet1"}));
        e
    }

    #[test]
    fn cross_sheet_refs_evaluate_and_quote() {
        let mut e = two_sheets();
        data(&mut e, "setCell", json!({"addr":"C1","value":"=Data!A1*2+Data!B2"}));
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(20.0));
        // Case-insensitive qualifier, quoted form, ranges, ad-hoc evaluate.
        data(&mut e, "setCell", json!({"addr":"C2","value":"=data!A1+'Data'!B2"}));
        assert_eq!(get_cell(&mut e, "C2")["computed"], json!(15.0));
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"=SUM(Data!A1:B2)"}))["value"],
            json!(15.0)
        );
        // Self-qualified reference on the home sheet.
        data(&mut e, "setCell", json!({"addr":"D1","value":"=Sheet1!C1+1"}));
        assert_eq!(get_cell(&mut e, "D1")["computed"], json!(21.0));
        // A formula stored on Data sees its own bare refs through Sheet1!'s eyes.
        data(&mut e, "setActive", json!({"sheet":"Data"}));
        data(&mut e, "setCell", json!({"addr":"C3","value":"=A1+B2"}));
        // COUNTIF's same-sheet range must resolve on Data, not Sheet1.
        data(&mut e, "setCell", json!({"addr":"C4","value":"=COUNTIF(A1:B2,\">4\")"}));
        data(&mut e, "setActive", json!({"sheet":"Sheet1"}));
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"=Data!C3*2"}))["value"],
            json!(30.0)
        );
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"=Data!C4"}))["value"],
            json!(2.0)
        );
    }

    #[test]
    fn cross_sheet_missing_and_hostile_refs() {
        let mut e = two_sheets();
        for (formula, want) in [
            ("=Nope!A1", "#REF!"),
            ("='Nope'!A1", "#REF!"),
            ("=Data!A0", "#REF!"),
            ("=Data!XFE1", "#REF!"),
            ("=Data!A1:Data!B2", "#NAME?"), // second qualifier unsupported
            ("=Sheet1:Data!A1", "#NAME?"),  // 3D ranges unsupported
            ("='Data'", "#NAME?"),
            ("=Data!", "#NAME?"),
        ] {
            assert_eq!(
                data(&mut e, "evaluate", json!({"formula":formula}))["value"],
                json!(want),
                "{formula}"
            );
        }
        // Stored hostile formulas evaluate the same way, never panic.
        data(&mut e, "setCell", json!({"addr":"E1","value":"=Nope!A1"}));
        assert_eq!(get_cell(&mut e, "E1")["computed"], json!("#REF!"));
        data(&mut e, "setCell", json!({"addr":"E2","value":"='unclosed"}));
        assert_eq!(get_cell(&mut e, "E2")["computed"], json!("#NAME?"));
    }

    #[test]
    fn cross_sheet_cycles_and_depth_bounds() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"S2"}));
        data(&mut e, "setActive", json!({"sheet":"S2"}));
        data(&mut e, "setCell", json!({"addr":"B1","value":"=Sheet1!A1"}));
        data(&mut e, "setActive", json!({"sheet":"Sheet1"}));
        data(&mut e, "setCell", json!({"addr":"A1","value":"=S2!B1"}));
        assert_eq!(get_cell(&mut e, "A1")["computed"], json!("#CYCLE!"));
        // Long acyclic cross-sheet chain stays under the depth cap.
        let mut e2 = TallyEngine::new();
        for i in 1..=8 {
            data(&mut e2, "addSheet", json!({"name":format!("T{i}")}));
        }
        // T1!A1 = 1; Ti!A1 = T(i-1)!A1 + 1 for i = 2..=8
        data(&mut e2, "setActive", json!({"sheet":"T1"}));
        data(&mut e2, "setCell", json!({"addr":"A1","value":"1"}));
        for i in 2..=8u64 {
            data(&mut e2, "setActive", json!({"sheet":format!("T{i}")}));
            data(
                &mut e2,
                "setCell",
                json!({"addr":"A1","value":format!("=T{}!A1+1", i - 1)}),
            );
        }
        assert_eq!(
            data(&mut e2, "evaluate", json!({"formula":"=T8!A1"}))["value"],
            json!(8.0)
        );
    }

    #[test]
    fn rename_sheet_rewrites_cross_sheet_refs() {
        let mut e = two_sheets();
        data(&mut e, "setCell", json!({"addr":"C1","value":"=Data!A1*2"}));
        data(&mut e, "setCell", json!({"addr":"C2","value":"='Data'!B2+Sheet1!C1"}));
        let before = e.snapshot().unwrap();
        data(&mut e, "renameSheet", json!({"sheet":"Data","to":"Metrics"}));
        // Qualifiers rewritten on every sheet, quoted form used when needed.
        assert_eq!(get_cell(&mut e, "C1")["raw"], json!("=Metrics!A1*2"));
        assert_eq!(
            get_cell(&mut e, "C2")["raw"],
            json!("=Metrics!B2+Sheet1!C1")
        );
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(10.0));
        assert_eq!(get_cell(&mut e, "C2")["computed"], json!(20.0));
        // Undo restores name AND formula text; redo re-applies both.
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert_eq!(get_cell(&mut e, "C1")["raw"], json!("=Data!A1*2"));
        assert!(e.redo().unwrap());
        assert_eq!(get_cell(&mut e, "C1")["raw"], json!("=Metrics!A1*2"));
        // Rename to a name that needs quoting.
        data(&mut e, "renameSheet", json!({"sheet":"Metrics","to":"Q1 Data"}));
        assert_eq!(
            get_cell(&mut e, "C1")["raw"],
            json!("='Q1 Data'!A1*2")
        );
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(10.0));
        // Snapshot round-trip keeps rewritten formulas working.
        let saved = e.snapshot().unwrap();
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(
            data(&mut reopened, "evaluate", json!({"formula":"='Q1 Data'!A1"}))["value"],
            json!(5.0)
        );
    }

    #[test]
    fn remove_sheet_leaves_refs_at_ref_error() {
        let mut e = two_sheets();
        data(&mut e, "setCell", json!({"addr":"C1","value":"=Data!A1+1"}));
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(6.0));
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        // Stored text keeps the qualifier; evaluation reports #REF!.
        assert_eq!(get_cell(&mut e, "C1")["raw"], json!("=Data!A1+1"));
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!("#REF!"));
        // Undo restores the sheet and the reference works again.
        assert!(e.undo().unwrap());
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(6.0));
        // Re-adding a sheet with the same name revives the reference.
        assert!(e.redo().unwrap());
        data(&mut e, "addSheet", json!({"name":"Data"}));
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(1.0)); // Data!A1 now empty → 0+1
    }

    #[test]
    fn structural_edits_remap_qualified_refs_on_all_sheets() {
        let mut e = two_sheets();
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        data(&mut e, "setCell", json!({"addr":"C1","value":"=Data!A1+A1"}));
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(6.0)); // 5 + 1
        // Insert a row at the top of Data: the qualified ref follows the
        // moved cell (Data!A1 → Data!A2, still 5) while Sheet1's bare A1
        // ref is untouched — the value is unchanged, the text is not.
        data(&mut e, "insertRows", json!({"sheet":"Data","from":1,"to":1}));
        assert_eq!(get_cell(&mut e, "C1")["raw"], json!("=Data!A2+A1"));
        assert_eq!(get_cell(&mut e, "C1")["computed"], json!(6.0));
        // A structural edit on Sheet1 moves its own bare + self-qualified
        // refs but leaves the Data-qualified ref alone.
        data(&mut e, "setCell", json!({"addr":"F1","value":"=Sheet1!C1+Data!A2"}));
        data(&mut e, "insertRows", json!({"sheet":"Sheet1","from":1,"to":1}));
        assert_eq!(
            get_cell(&mut e, "F2")["raw"],
            json!("=Sheet1!C2+Data!A2")
        );
        // C1's own formula moved to C2 with its bare ref remapped too.
        assert_eq!(
            get_cell(&mut e, "C2")["raw"],
            json!("=Data!A2+A2")
        );
        assert_eq!(get_cell(&mut e, "C2")["computed"], json!(6.0)); // 5 + 1
        // Undo restores everything.
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert_eq!(get_cell(&mut e, "C1")["raw"], json!("=Data!A2+A1"));
    }
}
