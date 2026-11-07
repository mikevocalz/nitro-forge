//! Durable row-filter rules and the filter read ops.
//!
//! Model decision (mirrors `conditional_ops`/`validation_ops`): rules are
//! **workbook-level entries** bound to one sheet by durable sheet id —
//! `FilterRule = { id, sheet: sheet-id, range, column?, criteria }` where
//! `range` is a canonical `"A1"`/`"A1:B2"` (reuses
//! `name_ops::parse_refers_to`, capped at the shared 16,384-cell bound),
//! `column` is an optional canonical uppercase column letter inside that
//! range, and `criteria` is a COUNTIF-style string evaluated by the same
//! `formula::CriteriaMatcher` conditional formats use. `id` is a
//! workbook-unique `u64` handle for `clearFilter`. Rules **may overlap** on
//! one sheet: a row is visible only when every covering rule passes, and
//! `evaluateFilters` reports each rule's verdict per row. Removing a sheet
//! cascade-drops its rules into the same undo entry; undo re-admits each
//! dropped rule only while it still satisfies the invariants `restore`
//! enforces (`readd_ok`).
//!
//! Hide-vs-delete decision: filters **hide, never delete**. The engine
//! stores rules only; row visibility is a pure function of the rules and
//! the *computed* cell values, so it can never go stale after edits, undo
//! or reopen. There is no separate stored `hidden` flag — `getRange`,
//! `setCell` and every other op keep reading and writing hidden rows
//! normally (hiding is presentation metadata the host applies at render
//! time, driven by `evaluateFilters`). `duplicateSheet` does not copy
//! rules, matching names/validation/conditional behavior.
//!
//! Row semantics: a rule "covers" a 0-based sheet row `r` when `r` lies in
//! the rule range's row span. With `column` set, the rule tests that one
//! cell `(column, r)`; without `column`, the rule tests **every** column of
//! its range at row `r` and the row passes only when all of them satisfy
//! the criteria (AND across columns — the honest whole-row subset; NYC-Tron's
//! per-column `SheetFilter` operators map onto criteria strings host-side).
//! Blank cells evaluate to `Value::Empty`, so `""` passes them and numeric
//! criteria do not.
//!
//! Criteria reuse means the same bounds apply: criteria over 255 chars or
//! relational non-numeric text reject at set time, `*`/`?`/`~` wildcards
//! match ASCII-case-insensitively, numbers compare numbers only, and error
//! values never match.
//!
//! Protection: rules are workbook metadata bound to a sheet, so mutations
//! are guarded by the bound/target sheet exactly like name/validation ops
//! (see `protection.rs`); all read ops are ungated.
use super::range_ops::Rect;
use super::*;

/// Maximum filter rules per workbook.
pub const MAX_FILTERS: usize = 256;
/// `evaluateFilters` bound on total cell-tests (rows × covering rules ×
/// tested columns). Beyond it the read rejects rather than emitting an
/// unbounded report; mutations already charge the shared 1,000,000-step
/// conditional allowance per match attempt.
pub const MAX_FILTER_TESTS: u64 = 65_536;

/// One durable rule: `id` is a workbook-unique handle, `sheet` the bound
/// sheet id, `range` a canonical `"A1"`/`"A1:B2"`, `column` an optional
/// canonical uppercase column letter inside `range`, `criteria` a
/// COUNTIF-style string. `deny_unknown_fields` keeps deferred NYC-Tron
/// filter fields (`enabled`, per-operator operands) from being silently
/// dropped out of hostile payloads.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FilterRule {
    pub id: u64,
    pub sheet: u64,
    pub range: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    pub criteria: String,
}

/// Inclusive 0-based rectangle shared with `name_ops`/`validation_ops`.
type Rect4 = name_ops::RefersCoords;

/// Parse a column letter spec (`"A"`, `"bc"`, `"XFD"`) into a 0-based column
/// index. Letters only — addresses like `"B2"` and numbers reject; shared by
/// `sortRange` keys and `setFilter`.
pub(super) fn column_index(letters: &str) -> Option<u32> {
    if letters.is_empty()
        || letters.len() > 3
        || !letters.bytes().all(|b| b.is_ascii_alphabetic())
    {
        return None;
    }
    let mut n: u64 = 0;
    for ch in letters.bytes() {
        n = n * 26 + u64::from(ch.to_ascii_uppercase() - b'A') + 1;
    }
    let idx = n.checked_sub(1)?;
    if idx >= u64::from(formula::SHEET_MAX_COLUMNS) {
        return None;
    }
    Some(idx as u32)
}

/// Canonical uppercase column letters for a 0-based column index.
pub(super) fn column_name(idx: u32) -> String {
    // `fmt_addr(idx, 0)` ends in '1'; dropping it leaves the letters.
    let addr = fmt_addr(idx, 0);
    addr[..addr.len() - 1].to_string()
}

/// Field-level validation shared by op parsing and hostile-restore checks:
/// criteria the matcher accepts and, when present, a column letter that
/// parses and lies inside the rule range's columns.
pub(super) fn valid_stored(f: &FilterRule) -> bool {
    if !formula::CriteriaMatcher::is_valid(&f.criteria) {
        return false;
    }
    let Ok(coords) = name_ops::parse_refers_to(&f.range) else {
        return false;
    };
    match &f.column {
        None => true,
        Some(col) => column_index(col).is_some_and(|c| c >= coords.0 && c <= coords.2),
    }
}

/// Parse a stored canonical range; `None` only for snapshots that predate
/// filters (restore re-validates, so this is defensive).
fn rule_coords(range: &str) -> Option<Rect4> {
    name_ops::parse_refers_to(range).ok()
}

fn cell_count(coords: Rect4) -> u64 {
    u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped rule
/// comes back only while it still satisfies every invariant `restore`
/// enforces — bound sheet exists, canonical on-sheet range within the cell
/// cap, parseable criteria, in-range column, unique id, under the cap. Rules
/// on other sheets cannot have been created for the removed sheet while it
/// was gone (sheet ids are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, rule: &FilterRule) -> bool {
    if doc.filters.len() >= MAX_FILTERS {
        return false;
    }
    if doc.filters.iter().any(|r| r.id == rule.id) {
        return false;
    }
    if !doc.sheets.iter().any(|s| s.id == rule.sheet) {
        return false;
    }
    if !valid_stored(rule) {
        return false;
    }
    let Some(coords) = rule_coords(&rule.range) else {
        return false;
    };
    name_ops::canonical_refers_to(coords) == rule.range && cell_count(coords) <= MAX_GET_RANGE_CELLS
}

fn err_literal(v: &formula::Value) -> &'static str {
    match v {
        formula::Value::Err(e) => e,
        _ => formula::ERR_VALUE,
    }
}

/// One armed rule ready to test rows: parsed coords, optional 0-based
/// column, and the criteria matcher.
struct Armed<'a> {
    rule: &'a FilterRule,
    coords: Rect4,
    column: Option<u32>,
    matcher: formula::CriteriaMatcher,
}

impl TallyEngine {
    /// JSON view of one rule with its bound sheet's *current* name resolved.
    fn filter_rule_json(&self, r: &FilterRule) -> Result<Value, EngineError> {
        let sheet = self
            .doc
            .sheets
            .iter()
            .find(|s| s.id == r.sheet)
            .map(|s| s.name.clone());
        let mut out = serde_json::Map::new();
        out.insert("id".to_string(), json!(r.id));
        out.insert("sheet".to_string(), json!(sheet));
        out.insert("sheet_id".to_string(), json!(r.sheet));
        out.insert("range".to_string(), json!(r.range));
        if let Some(col) = &r.column {
            out.insert("column".to_string(), json!(col));
        }
        out.insert("criteria".to_string(), json!(r.criteria));
        Ok(Value::Object(out))
    }

    /// `setFilter {sheet?, range:{from,to}, column?, criteria}` — append a
    /// rule. An identical existing rule (same sheet, range, column and
    /// criteria) is an eventless no-op returning the existing rule;
    /// anything else appends with a fresh workbook-unique id. `column`
    /// must be a column letter inside `range`; absent means the criteria
    /// must hold for every cell of the row's range slice (AND semantics).
    pub(super) fn op_set_filter(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let rect = Rect::read(Self::field(p, "range")?)?;
        let coords: Rect4 = rect.coords();
        let range = name_ops::canonical_refers_to(coords);
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let column = match p.get("column") {
            None | Some(Value::Null) => None,
            Some(v) => {
                let letters = v.as_str().ok_or_else(|| {
                    EngineError::invalid("'column' must be a column letter like \"B\"")
                })?;
                let c = column_index(letters).ok_or_else(|| {
                    EngineError::validation(format!("invalid column '{letters}'"))
                })?;
                if c < coords.0 || c > coords.2 {
                    return Err(EngineError::validation(
                        "filter column must lie inside the filter range",
                    ));
                }
                Some(column_name(c))
            }
        };
        let criteria = Self::str_field(p, "criteria")?;
        if !formula::CriteriaMatcher::is_valid(criteria) {
            return Err(EngineError::validation(format!(
                "invalid filter criteria '{criteria}'"
            )));
        }
        if let Some(existing) = self.doc.filters.iter().find(|r| {
            r.sheet == sheet_id
                && r.range == range
                && r.column == column
                && r.criteria == criteria
        }) {
            return Ok(Self::readonly(json!({
                "rule": self.filter_rule_json(existing)?
            })));
        }
        if self.doc.filters.len() >= MAX_FILTERS {
            return Err(EngineError::out_of_bounds(format!(
                "filter rule limit of {MAX_FILTERS} reached"
            )));
        }
        let id = self.doc.next_filter;
        self.doc.next_filter = self
            .doc
            .next_filter
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("filter id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let rule = FilterRule {
            id,
            sheet: sheet_id,
            range,
            column,
            criteria: criteria.to_string(),
        };
        self.doc.filters.push(rule.clone());
        Ok(Self::changed(json!({
            "rule": self.filter_rule_json(&rule)?
        })))
    }

    /// `clearFilter` — exactly one of `id` (rule handle) or
    /// `range:{from,to}` (+ optional `sheet`, default active) removing every
    /// rule on that sheet intersecting the rectangle.
    pub(super) fn op_clear_filter(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let has_id = p.get("id").is_some_and(|v| !v.is_null());
        let has_range = p.get("range").is_some_and(|v| !v.is_null());
        // `sheet` only applies to the `range` selector; with `id` it would be
        // silently ignored, so reject the mix instead (mirrors clearValidation).
        let has_sheet = p.get("sheet").is_some_and(|v| !v.is_null());
        match (has_id, has_range) {
            (true, false) if has_sheet => Err(EngineError::invalid(
                "clearFilter 'sheet' requires the 'range' selector",
            )),
            (true, false) => {
                let id = p
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
                let pos = self
                    .doc
                    .filters
                    .iter()
                    .position(|r| r.id == id)
                    .ok_or_else(|| EngineError::not_found(format!("no filter rule {id}")))?;
                self.journal.record(UndoEntry::Reset {
                    prev: self.doc.clone(),
                });
                self.doc.filters.remove(pos);
                Ok(Self::changed(json!({ "cleared": 1 })))
            }
            (false, true) => {
                let rect = Rect::read(Self::field(p, "range")?)?;
                let coords: Rect4 = rect.coords();
                let idx = self.sheet_index(p)?;
                let sheet_id = self.doc.sheets[idx].id;
                let mut hits = Vec::new();
                for (i, r) in self.doc.filters.iter().enumerate() {
                    if r.sheet == sheet_id
                        && rule_coords(&r.range).is_some_and(|rc| {
                            rc.0 <= coords.2
                                && coords.0 <= rc.2
                                && rc.1 <= coords.3
                                && coords.1 <= rc.3
                        })
                    {
                        hits.push(i);
                    }
                }
                if hits.is_empty() {
                    return Ok(Self::readonly(json!({ "cleared": 0 })));
                }
                self.journal.record(UndoEntry::Reset {
                    prev: self.doc.clone(),
                });
                for i in hits.iter().rev() {
                    self.doc.filters.remove(*i);
                }
                Ok(Self::changed(json!({ "cleared": hits.len() })))
            }
            _ => Err(EngineError::invalid(
                "clearFilter requires exactly one of 'id' or 'range'",
            )),
        }
    }

    /// `getFilters {sheet?}` — silent read; `sheet` absent lists every rule
    /// in the workbook, present filters to that sheet.
    pub(super) fn op_get_filters(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let rules: Vec<&FilterRule> = match p.get("sheet") {
            None | Some(Value::Null) => self.doc.filters.iter().collect(),
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                let sheet_id = self.doc.sheets[idx].id;
                self
                    .doc
                    .filters
                    .iter()
                    .filter(|r| r.sheet == sheet_id)
                    .collect()
            }
        };
        let mut out = Vec::with_capacity(rules.len());
        for r in rules {
            out.push(self.filter_rule_json(r)?);
        }
        Ok(Self::readonly(json!({ "rules": out })))
    }

    /// `evaluateFilters {sheet?, range:{from,to}, id?}` — silent read
    /// reporting, per sheet row inside `range`, whether the row passes the
    /// covering filter rules. Without `id`, every rule on the sheet whose
    /// range covers the row is tested and the row reports `visible` plus
    /// the `matched`/`failed` rule ids; with `id`, only that rule (which
    /// must belong to the resolved sheet) is tested and each row reports
    /// `matched` — rows outside the rule's row span report `matched:true`
    /// because the rule imposes no constraint on them. `visible:false`
    /// rows are the ones a host should hide; the engine itself never hides
    /// or deletes anything (see module docs).
    ///
    /// A rule covers row `r` when `r` is inside its range's row span; with
    /// `column` set it tests that single cell, without it every column of
    /// the rule range at row `r` must satisfy the criteria. Evaluation runs
    /// against computed values through the normal evaluator, so results
    /// track edits, undo and reopen. The total number of cell-tests
    /// (rows × covering rules × tested columns) is capped at
    /// `MAX_FILTER_TESTS` and every match attempt charges the shared
    /// 1,000,000-step conditional allowance, so hostile rule×row products
    /// reject instead of emitting unbounded reports.
    pub(super) fn op_evaluate_filters(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let rect = Rect::read(Self::field(p, "range")?)?;
        let (_, r0, _, r1) = rect.coords();
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let selected = match p.get("id") {
            None | Some(Value::Null) => None,
            Some(v) => {
                let id = v
                    .as_u64()
                    .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
                Some(
                    self.doc
                        .filters
                        .iter()
                        .find(|r| r.id == id && r.sheet == sheet_id)
                        .ok_or_else(|| {
                            EngineError::not_found(format!("no filter rule {id} on this sheet"))
                        })?,
                )
            }
        };
        // Arm the rules that can cover any queried row, in doc order.
        let mut armed: Vec<Armed> = Vec::new();
        for r in &self.doc.filters {
            if r.sheet != sheet_id || selected.is_some_and(|s| s.id != r.id) {
                continue;
            }
            let Some(coords) = rule_coords(&r.range) else {
                continue;
            };
            if coords.3 < r0 || coords.1 > r1 {
                continue; // no queried row can be covered
            }
            let matcher = formula::CriteriaMatcher::parse(&r.criteria).map_err(|_| {
                EngineError::serialization("stored filter criteria failed to parse")
            })?;
            let column = r
                .column
                .as_deref()
                .and_then(column_index)
                .filter(|&c| c >= coords.0 && c <= coords.2);
            armed.push(Armed {
                rule: r,
                coords,
                column,
                matcher,
            });
        }
        // Pre-check the cell-test product so oversized reports reject
        // before any evaluation work happens.
        let mut total_tests: u64 = 0;
        for r in r0..=r1 {
            for a in &armed {
                if a.coords.1 <= r && r <= a.coords.3 {
                    total_tests += if a.column.is_some() {
                        1
                    } else {
                        u64::from(a.coords.2 - a.coords.0) + 1
                    };
                    if total_tests > MAX_FILTER_TESTS {
                        return Err(EngineError::out_of_bounds(format!(
                            "filter evaluation exceeds the {MAX_FILTER_TESTS}-test limit"
                        )));
                    }
                }
            }
        }
        let mut ev = self.evaluator_for(idx);
        let mut rows = Vec::with_capacity((r1 - r0 + 1) as usize);
        for r in r0..=r1 {
            let mut matched_ids = Vec::new();
            let mut failed_ids = Vec::new();
            let mut all_pass = true;
            for a in &armed {
                if !(a.coords.1 <= r && r <= a.coords.3) {
                    continue;
                }
                let passed = if let Some(col) = a.column {
                    let value = ev.eval_cell(&fmt_addr(col, r));
                    match ev.match_value(&value, &a.matcher) {
                        Ok(m) => m,
                        Err(e) => {
                            return Err(EngineError::validation(format!(
                                "filter evaluation failed: {}",
                                err_literal(&e)
                            )))
                        }
                    }
                } else {
                    // Whole-row AND: every column of the rule range at this
                    // row must satisfy the criteria.
                    let mut pass = true;
                    for c in a.coords.0..=a.coords.2 {
                        let value = ev.eval_cell(&fmt_addr(c, r));
                        match ev.match_value(&value, &a.matcher) {
                            Ok(true) => {}
                            Ok(false) => {
                                pass = false;
                                break;
                            }
                            Err(e) => {
                                return Err(EngineError::validation(format!(
                                    "filter evaluation failed: {}",
                                    err_literal(&e)
                                )))
                            }
                        }
                    }
                    pass
                };
                if passed {
                    matched_ids.push(a.rule.id);
                } else {
                    failed_ids.push(a.rule.id);
                    all_pass = false;
                }
            }
            let mut out = serde_json::Map::new();
            out.insert("row".to_string(), json!(u64::from(r) + 1));
            if let Some(sel) = selected {
                // Single-rule mode: rows the rule does not cover pass.
                let covered = armed.iter().any(|a| a.coords.1 <= r && r <= a.coords.3);
                let matched = !covered || matched_ids.contains(&sel.id);
                out.insert("matched".to_string(), json!(matched));
            } else {
                out.insert("visible".to_string(), json!(all_pass));
                out.insert("matched".to_string(), json!(matched_ids));
                out.insert("failed".to_string(), json!(failed_ids));
            }
            rows.push(Value::Object(out));
        }
        Ok(Self::readonly(json!({ "rows": rows })))
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
    fn set(e: &mut TallyEngine, p: Value) -> Value {
        data(e, "setFilter", p)["rule"].clone()
    }
    fn filters(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "getFilters", json!({}))["rules"]
            .as_array()
            .unwrap()
            .clone()
    }
    fn rows(e: &mut TallyEngine, p: Value) -> Vec<Value> {
        data(e, "evaluateFilters", p)["rows"]
            .as_array()
            .unwrap()
            .clone()
    }

    fn seed(e: &mut TallyEngine) {
        // A1:A4 numbers 10/20/30/40, B1:B4 text.
        for (a, v) in [
            ("A1", "10"),
            ("A2", "20"),
            ("A3", "30"),
            ("A4", "40"),
            ("B1", "apple"),
            ("B2", "banana"),
            ("B3", "apple"),
            ("B4", "pear"),
        ] {
            data(e, "setCell", json!({"addr": a, "value": v}));
        }
    }

    #[test]
    fn set_list_clear_and_match() {
        let mut e = TallyEngine::new();
        seed(&mut e);
        let rule = set(
            &mut e,
            json!({"range":{"from":"A1","to":"A4"},"column":"A","criteria":">15"}),
        );
        assert_eq!(rule["id"], json!(1));
        assert_eq!(rule["range"], json!("A1:A4"));
        assert_eq!(rule["column"], json!("A"));
        assert_eq!(rule["sheet"], json!("Sheet1"));

        // Rows 2-4 pass (>15), row 1 fails.
        let rs = rows(
            &mut e,
            json!({"range":{"from":"A1","to":"A4"}}),
        );
        let vis: Vec<bool> = rs.iter().map(|r| r["visible"].as_bool().unwrap()).collect();
        assert_eq!(vis, vec![false, true, true, true]);
        assert_eq!(rs[0]["failed"], json!([1]));
        assert_eq!(rs[1]["matched"], json!([1]));

        // Single-rule mode reports matched per row.
        let rs = rows(
            &mut e,
            json!({"range":{"from":"A1","to":"A4"},"id":1}),
        );
        let m: Vec<bool> = rs.iter().map(|r| r["matched"].as_bool().unwrap()).collect();
        assert_eq!(m, vec![false, true, true, true]);

        // Identical resubmission is eventless; different criteria appends.
        let dup = apply(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A4","to":"A1"},"column":"a","criteria":">15"}),
        );
        assert!(dup.events.is_empty());
        assert_eq!(dup.data["rule"]["id"], json!(1));
        set(
            &mut e,
            json!({"range":{"from":"B1","to":"B4"},"criteria":"apple"}),
        );
        assert_eq!(filters(&mut e).len(), 2);

        // clearFilter by id and by range.
        let c = data(
            &mut e,
            "clearFilter",
            json!({"range":{"from":"B1","to":"B4"}}),
        );
        assert_eq!(c["cleared"], json!(1));
        assert_eq!(filters(&mut e).len(), 1);
        let c = data(&mut e, "clearFilter", json!({"id":1}));
        assert_eq!(c["cleared"], json!(1));
        assert!(filters(&mut e).is_empty());
        // All rows visible again — nothing is deleted.
        let rs = rows(&mut e, json!({"range":{"from":"A1","to":"A4"}}));
        assert!(rs.iter().all(|r| r["visible"] == json!(true)));
    }

    #[test]
    fn whole_row_filter_ands_across_columns() {
        let mut e = TallyEngine::new();
        seed(&mut e);
        // No column on a single-column range: AND over one cell, same as a
        // column filter.
        set(
            &mut e,
            json!({"range":{"from":"A1","to":"A4"},"criteria":">15"}),
        );
        let rs = rows(&mut e, json!({"range":{"from":"A1","to":"A4"}}));
        let vis: Vec<bool> = rs.iter().map(|r| r["visible"].as_bool().unwrap()).collect();
        assert_eq!(vis, vec![false, true, true, true]);
        // A whole-row rule over A1:B4 with numeric criteria fails every row:
        // the B cells are text and ">5" never matches text.
        set(
            &mut e,
            json!({"range":{"from":"A1","to":"B4"},"criteria":">5"}),
        );
        let rs = rows(&mut e, json!({"range":{"from":"A1","to":"B4"}}));
        let vis: Vec<bool> = rs.iter().map(|r| r["visible"].as_bool().unwrap()).collect();
        assert_eq!(vis, vec![false, false, false, false]);
        // Row 1 failed both rules; rows 2-4 failed only the second.
        assert_eq!(rs[0]["failed"], json!([1, 2]));
        assert_eq!(rs[1]["failed"], json!([2]));
        assert_eq!(rs[1]["matched"], json!([1]));
    }

    #[test]
    fn criteria_match_computed_values_and_undo_restores() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        data(&mut e, "setCell", json!({"addr":"A2","value":"=A1*4"}));
        data(&mut e, "setCell", json!({"addr":"A3","value":"=1/0"}));
        set(
            &mut e,
            json!({"range":{"from":"A1","to":"A3"},"column":"A","criteria":">10"}),
        );
        let rs = rows(&mut e, json!({"range":{"from":"A1","to":"A3"}}));
        // A2 computes 20 → passes; error cell never matches.
        let m: Vec<bool> = rs.iter().map(|r| r["visible"].as_bool().unwrap()).collect();
        assert_eq!(m, vec![false, true, false]);
        // Live: editing the precedent flips visibility.
        data(&mut e, "setCell", json!({"addr":"A1","value":"50"}));
        let rs = rows(&mut e, json!({"range":{"from":"A1","to":"A1"}}));
        assert_eq!(rs[0]["visible"], json!(true));
        // Undo the setCell first (LIFO), then the filter: rules gone,
        // cells untouched — nothing was deleted, only hidden.
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert!(filters(&mut e).is_empty());
        let rs = rows(&mut e, json!({"range":{"from":"A1","to":"A3"}}));
        assert!(rs.iter().all(|r| r["visible"] == json!(true)));
        assert_eq!(get_cell_pub(&mut e, "A2")["computed"], json!(20.0));
        // Redo restores the rule and its hiding.
        assert!(e.redo().unwrap());
        assert_eq!(filters(&mut e).len(), 1);
        let rs = rows(&mut e, json!({"range":{"from":"A1","to":"A3"}}));
        assert_eq!(rs[0]["visible"], json!(false));
        assert_eq!(rs[1]["visible"], json!(true));
    }

    fn get_cell_pub(e: &mut TallyEngine, a: &str) -> Value {
        data(e, "getCell", json!({"addr": a}))
    }

    #[test]
    fn validation_and_atomicity() {
        let mut e = TallyEngine::new();
        seed(&mut e);
        let before = e.snapshot().unwrap();
        for p in [
            // criteria the matcher rejects
            json!({"range":{"from":"A1","to":"A4"},"criteria":">apple"}),
            // column outside the range
            json!({"range":{"from":"A1","to":"A4"},"column":"Z","criteria":">1"}),
            // column not letters
            json!({"range":{"from":"A1","to":"A4"},"column":"B2","criteria":">1"}),
            // missing criteria
            json!({"range":{"from":"A1","to":"A4"}}),
        ] {
            assert!(e.apply(Command::new("setFilter", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert_eq!(
            apply_err(&mut e, "clearFilter", json!({"id":9})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "clearFilter", json!({})).code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            apply_err(
                &mut e,
                "clearFilter",
                json!({"id":1,"range":{"from":"A1","to":"A1"}})
            )
            .code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            apply_err(
                &mut e,
                "evaluateFilters",
                json!({"range":{"from":"A1","to":"A1"},"id":9})
            )
            .code,
            ErrorCode::NotFound
        );
        // Cap: 256 rules then out_of_bounds.
        for i in 0..MAX_FILTERS {
            set(
                &mut e,
                json!({"range":{"from":"A1","to":"A1"},"criteria":format!("={i}")}),
            );
        }
        assert_eq!(
            apply_err(
                &mut e,
                "setFilter",
                json!({"range":{"from":"A2","to":"A2"},"criteria":"=1"})
            )
            .code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn sheet_scoping_cascade_and_snapshot_schema() {
        let mut e = TallyEngine::new();
        seed(&mut e);
        data(&mut e, "addSheet", json!({"name":"Other"}));
        // Rule on Sheet1 by name; rule on Other by index.
        set(
            &mut e,
            json!({"sheet":"Sheet1","range":{"from":"A1","to":"A4"},"column":"A","criteria":">15"}),
        );
        set(
            &mut e,
            json!({"sheet":1,"range":{"from":"A1","to":"A4"},"criteria":"*"}),
        );
        assert_eq!(filters(&mut e).len(), 2);
        // getFilters sheet filter.
        let only = data(&mut e, "getFilters", json!({"sheet":"Other"}))["rules"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(only.len(), 1);
        assert_eq!(only[0]["sheet"], json!("Other"));
        // evaluateFilters on Other: "*" matches text only; numbers fail.
        data(&mut e, "setActive", json!({"sheet":1}));
        data(&mut e, "setCell", json!({"addr":"A1","value":"hello"}));
        let rs = rows(&mut e, json!({"sheet":1,"range":{"from":"A1","to":"A1"}}));
        assert_eq!(rs[0]["visible"], json!(true));
        // removeSheet cascades the Other rule away; undo restores it.
        let snap = e.snapshot().unwrap();
        data(&mut e, "removeSheet", json!({"sheet":"Other"}));
        assert_eq!(filters(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(filters(&mut e).len(), 2);
        assert_eq!(e.snapshot().unwrap(), snap);
        // Snapshot round-trip preserves rules; schema bumps to 4.
        let saved = e.snapshot().unwrap();
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), saved);
        assert_eq!(filters(&mut reopened).len(), 2);
    }
}
