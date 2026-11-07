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
//! `conditional_formats` is the durable workbook-level conditional-format
//! table (see `conditional_ops`): each rule binds a sheet id, a canonical
//! range, a COUNTIF-style criteria string and a bounded style payload;
//! the engine reports which rules match which computed cell values —
//! applying the styles is host-side.
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
//! * Formulas evaluate against the **active sheet only** — there are no
//!   cross-sheet references.
//! * Read ops (`describe`, `getCell`, `getRange`, `evaluate`, `workbook`)
//!   record no undo entries and emit no events; mutating ops emit
//!   `document:changed`.
//! * Undo entries are per-cell previous raw (`None` = "cell was empty") for
//!   `setCell`/`clearCell`, plus structural entries covering sheet ops and
//!   `new` — a strict superset of the spec's per-cell undo. `restore` and
//!   `new` reset the journal's view of the world appropriately.

mod conditional_ops;
mod formula;
mod format_ops;
mod name_ops;
mod range_ops;
mod sheet_ops;
mod protection;

use conditional_ops::ConditionalRule;
use format_ops::CellFormat;
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
    /// Durable conditional-format rules; empty in legacy documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    conditional_formats: Vec<ConditionalRule>,
    /// Next id handed out by `setConditionalFormat`.
    #[serde(default)]
    next_conditional: u64,
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
        }],
        active: 0,
        names: Vec::new(),
        conditional_formats: Vec::new(),
        next_conditional: 1,
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
    /// A sheet was added; undo removes it.
    AddSheet { sheet_id: u64 },
    /// A sheet was removed; undo re-inserts it at `index`, restores `active`
    /// and re-adds `dropped_names`/`dropped_conditional_formats` (names and
    /// conditional rules bound to the removed sheet are cascade-dropped on
    /// removal). Re-admission skips entries whose case-insensitive name
    /// twin already exists, that would exceed the table caps, or (for rules)
    /// that no longer satisfy the stored-rule invariants, keeping `doc`
    /// inside the invariants `restore` enforces.
    RemoveSheet {
        index: usize,
        sheet: Sheet,
        prev_active: usize,
        dropped_names: Vec<NamedRange>,
        dropped_conditional_formats: Vec<ConditionalRule>,
    },
    RenameSheet { sheet_id: u64, prev_name: String },
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
    /// named-range resolution enabled when `names` is nonempty.
    fn evaluator_for(&self, index: usize) -> Evaluator<'_, Sheet> {
        let sheet = &self.doc.sheets[index];
        if self.doc.names.is_empty() {
            Evaluator::new(sheet)
        } else {
            Evaluator::with_names(sheet, sheet.id, name_ops::name_table(&self.doc.names))
        }
    }

    /// Fresh per-request evaluator over the active sheet.
    fn evaluator(&self) -> Evaluator<'_, Sheet> {
        self.evaluator_for(self.doc.active)
    }

    /// Remove sheet at `idx`, fixing `active` exactly like `removeSheet` and
    /// cascade-dropping names and conditional rules bound to the removed
    /// sheet id. Returns the removed sheet and the dropped entries.
    fn remove_sheet_at(
        &mut self,
        idx: usize,
    ) -> (Sheet, Vec<NamedRange>, Vec<ConditionalRule>) {
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
        self.doc.conditional_formats.retain(|r| {
            if r.sheet == removed.id {
                dropped_rules.push(r.clone());
                false
            } else {
                true
            }
        });
        (removed, dropped, dropped_rules)
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
        };
        self.journal.record(UndoEntry::AddSheet { sheet_id: id });
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
        let sheet_id = self.doc.sheets[idx].id;
        let prev_name = self.doc.sheets[idx].name.clone();
        self.journal.record(UndoEntry::RenameSheet {
            sheet_id,
            prev_name,
        });
        self.doc.sheets[idx].name = to.to_string();
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn op_remove_sheet(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.resolve_sheet(Self::field(p, "sheet")?)?;
        if self.doc.sheets.len() <= 1 {
            return Err(EngineError::validation("workbook must keep at least one sheet"));
        }
        // Names and conditional rules bound to the removed sheet are
        // cascade-dropped; the undo entry carries them so undo/redo restore
        // them exactly.
        let sheet_id = self.doc.sheets[idx].id;
        let dropped_names: Vec<NamedRange> = self
            .doc
            .names
            .iter()
            .filter(|n| n.sheet == sheet_id)
            .cloned()
            .collect();
        let dropped_conditional_formats: Vec<ConditionalRule> = self
            .doc
            .conditional_formats
            .iter()
            .filter(|r| r.sheet == sheet_id)
            .cloned()
            .collect();
        let entry = UndoEntry::RemoveSheet {
            index: idx,
            sheet: self.doc.sheets[idx].clone(),
            prev_active: self.doc.active,
            dropped_names,
            dropped_conditional_formats,
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
            UndoEntry::AddSheet { sheet_id } => {
                match self.doc.sheets.iter().position(|s| s.id == sheet_id) {
                    Some(idx) => {
                        let prev_active = self.doc.active;
                        let (removed, dropped_names, dropped_conditional_formats) =
                            self.remove_sheet_at(idx);
                        UndoEntry::RemoveSheet {
                            index: idx,
                            sheet: removed,
                            prev_active,
                            dropped_names,
                            dropped_conditional_formats,
                        }
                    }
                    // Already gone — nothing changed; emit a no-op entry.
                    None => UndoEntry::SetActive {
                        prev: self.doc.active,
                    },
                }
            }
            UndoEntry::RemoveSheet {
                index,
                sheet,
                prev_active,
                dropped_names,
                dropped_conditional_formats,
            } => {
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
                UndoEntry::AddSheet { sheet_id }
            }
            UndoEntry::RenameSheet {
                sheet_id,
                prev_name,
            } => match self.sheet_by_id_mut(sheet_id) {
                Some(s) => {
                    let cur = mem::replace(&mut s.name, prev_name);
                    UndoEntry::RenameSheet {
                        sheet_id,
                        prev_name: cur,
                    }
                }
                None => UndoEntry::SetActive {
                    prev: self.doc.active,
                },
            },
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

    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        if cmd.v != SUPPORTED_VERSION {
            return Err(EngineError::unsupported(format!(
                "unsupported command version {} (expected {SUPPORTED_VERSION})",
                cmd.v
            )));
        }
        let p = &cmd.payload;
        self.check_protection(&cmd.op, p)?;
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
            "setConditionalFormat" => self.op_set_conditional_format(p),
            "clearConditionalFormat" => self.op_clear_conditional_format(p),
            "getConditionalFormats" => self.op_get_conditional_formats(p),
            "evaluateConditionalFormats" => self.op_evaluate_conditional_formats(p),
            "clearCell" => self.op_clear_cell(p),
            "getCell" => self.op_get_cell(p),
            "getRange" => self.op_get_range(p),
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
        // names, or conditional-format rules carry durable fields added
        // after the first release; older readers ignore unknown
        // `Sheet`/`Workbook` fields, so wrap those documents and let old
        // engines fail closed instead of silently discarding them. Plain
        // workbooks keep the legacy payload shape. `conditional_formats`
        // postdates the schema:1 wrapper fields and `Workbook` does not
        // deny unknown fields, so documents carrying rules emit schema:3 —
        // schema:1 readers reject them. schema:2 is reserved by the
        // unmerged data-validation slice (`codex/w6-tally-validation`); this
        // build emits and accepts only {1,3} so a validation snapshot fails
        // closed here rather than being silently stripped (see
        // docs/ENGINE_OPS.md for the merge reconciliation note).
        let has_conditional = !self.doc.conditional_formats.is_empty();
        let extended = self.doc.sheets.iter().any(|s| {
            s.tone.is_some() || s.is_protected || !s.formats.is_empty()
        }) || !self.doc.names.is_empty()
            || has_conditional;
        let payload = if extended {
            serde_json::to_vec(&VersionedSnapshot {
                kind: "tally",
                schema: if has_conditional { 3 } else { 1 },
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
        let mut doc: Workbook = if wrapped {
            let wrapper: VersionedDoc = serde_json::from_value(value)?;
            // schema:2 is intentionally absent: it belongs to the unmerged
            // validation slice and this build cannot honor its rules, so
            // accepting it would silently drop them on the next save.
            if wrapper.kind != "tally" || !matches!(wrapper.schema, 1 | 3) {
                return Err(EngineError::unsupported(
                    "unsupported Tally snapshot kind/schema",
                ));
            }
            wrapper.document
        } else {
            serde_json::from_value(value)?
        };
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
        // Conditional rules get the same hostile-input treatment: bounded
        // count, unique ids, existing sheet ids, canonical on-sheet ranges
        // within the shared cell cap, criteria the matcher accepts, and
        // valid format payloads.
        if doc.conditional_formats.len() > conditional_ops::MAX_CONDITIONAL_RULES {
            return Err(EngineError::serialization(
                "too many conditional format rules",
            ));
        }
        let mut seen_rule_ids = std::collections::BTreeSet::new();
        for r in &mut doc.conditional_formats {
            if !seen_rule_ids.insert(r.id) {
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
            index: 0,
            sheet: ghost_sheet(77),
            prev_active: 0,
            dropped_names: vec![dropped_name("Foo"), dropped_name("Bar")],
            dropped_conditional_formats: Vec::new(),
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
            index: 0,
            sheet: ghost_sheet(77),
            prev_active: 0,
            dropped_names: vec![dropped_name("Extra")],
            dropped_conditional_formats: Vec::new(),
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
            // wrong schema / wrong kind fail closed
            json!({"kind":"tally","schema":2,"document":doc}),
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
}
