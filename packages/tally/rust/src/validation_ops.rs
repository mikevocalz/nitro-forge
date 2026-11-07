//! Durable per-range data-validation rules and the `validateCell` read op.
//!
//! Model decision: rules are **workbook-level entries** bound to one sheet by
//! durable sheet id, like `NamedRange`s — `ValidationRule = { id, sheet:
//! sheet-id, range, criteria }` where `range` is a canonical `"A1"`/`"A1:B2"`
//! (reuses `name_ops::parse_refers_to`, capped at the shared 16,384-cell
//! bound). Rules on one sheet may not overlap; `setValidation` on the exact
//! same sheet+range replaces the criteria in place (keeping the rule id),
//! which is the edit path — there is no separate update op. Removing a sheet
//! cascade-drops its rules into the same undo entry, mirroring names.
//!
//! Criteria subset (what the engine can honestly evaluate against the
//! computed cell value):
//! * `number` — computed value must be a finite JSON number within optional
//!   inclusive `min`/`max`; `integer:true` additionally requires an integral
//!   value. No bounds at all means "must be a number".
//! * `list` — computed value's text form must equal one of `values`
//!   (case-sensitive, exact match; bounds match the NYC-Tron
//!   `ValidationDropdown` contract: ≤512 entries of ≤8192 chars, nonempty).
//! * `text` — computed value's text form must have a Unicode-scalar length
//!   within optional inclusive `min_length`/`max_length` (≤65536).
//!
//! Deferred loudly: date bounds (the evaluator has no date serials),
//! custom-formula criteria, whole-row/column ranges, and the dropdown's
//! `allowOther`/`allowBlank` commit policy — those are host/UI concerns;
//! the engine only answers "does this value satisfy the rule".
//!
//! `validateCell` is a silent read: no journal entry, no events. A cell with
//! no covering rule reports `{valid:true}`; a blank cell (no stored raw)
//! reports valid under any rule, matching spreadsheets' default
//! ignore-blank behavior — hosts enforce "value required" at commit time.
//! Error values (`#DIV/0!` etc.) count as ordinary values: they satisfy a
//! `list` rule only if an entry literally equals the error text, and never
//! satisfy `number`/`text` bounds.
//!
//! Protection: rules are workbook metadata bound to a sheet, so mutations
//! are guarded by the bound sheet exactly like name ops (see
//! `protection.rs`); `validateCell` is ungated.
use super::range_ops::Rect;
use super::*;

/// Maximum validation rules per workbook.
pub const MAX_VALIDATIONS: usize = 256;
/// `list` criteria bounds, matching the NYC-Tron ValidationDropdown caps.
pub const MAX_LIST_VALUES: usize = 512;
pub const MAX_LIST_VALUE_LEN: usize = 8192;
/// `text` length bounds (Unicode scalar count of the computed text form).
pub const MAX_TEXT_LEN: u32 = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CriteriaKind {
    Number,
    List,
    Text,
}

/// Stored validation criteria. One flat struct with `deny_unknown_fields`:
/// `kind` selects which optional fields are meaningful and `valid_criteria`
/// rejects fields belonging to other kinds, so hostile snapshots cannot
/// smuggle inert data past restore.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidationCriteria {
    pub kind: CriteriaKind,
    /// `number`: inclusive lower bound.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    /// `number`: inclusive upper bound.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// `number`: require an integral value when true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integer: Option<bool>,
    /// `list`: allowed values (exact, case-sensitive text match).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<String>>,
    /// `text`: inclusive minimum length in characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_length: Option<u32>,
    /// `text`: inclusive maximum length in characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
}

/// One durable rule: `id` is a workbook-unique handle for `clearValidation`,
/// `sheet` the bound sheet id, `range` a canonical `"A1"`/`"A1:B2"`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ValidationRule {
    pub id: u64,
    pub sheet: u64,
    pub range: String,
    pub criteria: ValidationCriteria,
}

/// Inclusive 0-based rectangle `(c0, r0, c1, r1)` shared by `name_ops` and
/// stored validation ranges.
type Rect4 = name_ops::RefersCoords;

fn intersects(a: Rect4, b: Rect4) -> bool {
    a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
}

fn contains(coords: Rect4, c: u32, r: u32) -> bool {
    c >= coords.0 && c <= coords.2 && r >= coords.1 && r <= coords.3
}

fn cell_count(coords: Rect4) -> u64 {
    u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
}

/// Parse a stored canonical range; `None` only for snapshots that predate
/// validation (restore re-validates, so this is a defensive path).
fn rule_coords(range: &str) -> Option<Rect4> {
    name_ops::parse_refers_to(range).ok()
}

/// Field-level validation shared by op parsing and hostile-restore checks.
pub(super) fn valid_criteria(c: &ValidationCriteria) -> bool {
    let stray_number = c.values.is_some() || c.min_length.is_some() || c.max_length.is_some();
    let stray_list = c.min.is_some()
        || c.max.is_some()
        || c.integer.is_some()
        || c.min_length.is_some()
        || c.max_length.is_some();
    let stray_text = c.min.is_some()
        || c.max.is_some()
        || c.integer.is_some()
        || c.values.is_some();
    match c.kind {
        CriteriaKind::Number => {
            !stray_number
                && c.min.zip(c.max).is_none_or(|(lo, hi)| lo <= hi)
        }
        CriteriaKind::List => {
            !stray_list
                && c.values.as_deref().is_some_and(|values| {
                    !values.is_empty()
                        && values.len() <= MAX_LIST_VALUES
                        && values.iter().all(|v| {
                            !v.is_empty() && v.chars().count() <= MAX_LIST_VALUE_LEN
                        })
                })
        }
        CriteriaKind::Text => {
            !stray_text
                && (c.min_length.is_some() || c.max_length.is_some())
                && c.min_length.is_none_or(|n| (1..=MAX_TEXT_LEN).contains(&n))
                && c.max_length.is_none_or(|n| (1..=MAX_TEXT_LEN).contains(&n))
                && c.min_length
                    .zip(c.max_length)
                    .is_none_or(|(lo, hi)| lo <= hi)
        }
    }
}

/// Text form used by `list`/`text` criteria: strings as-is, finite numbers
/// via `fmt_num`, booleans as `TRUE`/`FALSE`, errors as their literal text.
/// `Empty`, non-finite numbers and range `List`s have no text form.
fn text_form(v: &formula::Value) -> Option<String> {
    match v {
        formula::Value::Str(s) => Some(s.clone()),
        formula::Value::Num(n) if n.is_finite() => Some(fmt_num(*n)),
        formula::Value::Bool(b) => Some(if *b { "TRUE" } else { "FALSE" }.to_string()),
        formula::Value::Err(e) => Some((*e).to_string()),
        _ => None,
    }
}

fn check_criteria(c: &ValidationCriteria, v: &formula::Value) -> bool {
    match c.kind {
        CriteriaKind::Number => match v {
            formula::Value::Num(n) => {
                n.is_finite()
                    && c.min.is_none_or(|m| *n >= m)
                    && c.max.is_none_or(|m| *n <= m)
                    && (c.integer != Some(true) || n.fract() == 0.0)
            }
            _ => false,
        },
        CriteriaKind::List => {
            let Some(t) = text_form(v) else {
                return false;
            };
            c.values
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .any(|entry| entry == &t)
        }
        CriteriaKind::Text => {
            // Errors never satisfy text bounds (module doc); `text_form`
            // maps them to literal error text for `list` only.
            if matches!(v, formula::Value::Err(_)) {
                return false;
            }
            let Some(t) = text_form(v) else {
                return false;
            };
            let n = t.chars().count() as u64;
            c.min_length.is_none_or(|m| n >= u64::from(m))
                && c.max_length.is_none_or(|m| n <= u64::from(m))
        }
    }
}

/// Human-readable expectation for `validateCell` results; entry previews are
/// truncated so a 512-value list cannot produce an unbounded payload.
fn expected_text(c: &ValidationCriteria) -> String {
    match c.kind {
        CriteriaKind::Number => {
            let mut s = if c.integer == Some(true) {
                "an integer".to_string()
            } else {
                "a number".to_string()
            };
            match (c.min, c.max) {
                (Some(lo), Some(hi)) => s += &format!(" between {lo} and {hi}"),
                (Some(lo), None) => s += &format!(" >= {lo}"),
                (None, Some(hi)) => s += &format!(" <= {hi}"),
                (None, None) => {}
            }
            s
        }
        CriteriaKind::List => {
            let values = c.values.as_deref().unwrap_or(&[]);
            let mut s = "one of: ".to_string();
            for (i, v) in values.iter().take(8).enumerate() {
                if i > 0 {
                    s.push_str(", ");
                }
                let truncated: String = v.chars().take(80).collect();
                s.push('"');
                s.push_str(&truncated);
                if truncated.len() < v.len() {
                    s.push('…');
                }
                s.push('"');
            }
            if values.len() > 8 {
                s += &format!(" (+{} more)", values.len() - 8);
            }
            s
        }
        CriteriaKind::Text => {
            let mut s = "text".to_string();
            match (c.min_length, c.max_length) {
                (Some(lo), Some(hi)) => s += &format!(" with length {lo}..={hi} characters"),
                (Some(lo), None) => s += &format!(" with at least {lo} characters"),
                (None, Some(hi)) => s += &format!(" with at most {hi} characters"),
                (None, None) => {}
            }
            s
        }
    }
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped rule comes
/// back only while it still satisfies every invariant `restore` enforces —
/// bound sheet exists, canonical on-sheet range within the cell cap, valid
/// criteria, unique id, and no overlap with rules already present. Rules on
/// other sheets cannot have been created for the removed sheet while it was
/// gone (sheet ids are never recycled), so overlap here is defensive only.
pub(super) fn readd_ok(doc: &Workbook, rule: &ValidationRule) -> bool {
    if doc.validations.len() >= MAX_VALIDATIONS {
        return false;
    }
    if doc.validations.iter().any(|r| r.id == rule.id) {
        return false;
    }
    if !doc.sheets.iter().any(|s| s.id == rule.sheet) {
        return false;
    }
    if !valid_criteria(&rule.criteria) {
        return false;
    }
    let coords = match rule_coords(&rule.range) {
        Some(c) => c,
        None => return false,
    };
    if name_ops::canonical_refers_to(coords) != rule.range || cell_count(coords) > MAX_GET_RANGE_CELLS as u64 {
        return false;
    }
    !doc.validations.iter().any(|r| {
        r.sheet == rule.sheet
            && rule_coords(&r.range).is_some_and(|rc| intersects(rc, coords))
    })
}

impl TallyEngine {
    /// Sheet index a validation op targets: payload `sheet` (name or index)
    /// or the active sheet when absent/null.
    fn validation_sheet_index(&self, p: &Value) -> Result<usize, EngineError> {
        match p.get("sheet") {
            None | Some(Value::Null) => Ok(self.doc.active),
            Some(v) => self.resolve_sheet(v),
        }
    }

    /// JSON view of one rule with its bound sheet's *current* name resolved.
    fn rule_json(&self, r: &ValidationRule) -> Result<Value, EngineError> {
        let sheet = self
            .doc
            .sheets
            .iter()
            .find(|s| s.id == r.sheet)
            .map(|s| s.name.clone());
        Ok(json!({
            "id": r.id,
            "sheet": sheet,
            "sheet_id": r.sheet,
            "range": r.range,
            "criteria": serde_json::to_value(&r.criteria)?,
        }))
    }

    /// `setValidation {sheet?, range:{from,to}, rule:{kind,…}}` — create or
    /// replace the rule for an exact sheet+range. Partial overlaps with a
    /// different range reject; identical sheet+range+criteria is eventless.
    pub(super) fn op_set_validation(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let rect = Rect::read(Self::field(p, "range")?)?;
        let coords: Rect4 = rect.coords();
        let range = name_ops::canonical_refers_to(coords);
        let idx = self.validation_sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let raw_rule = Self::field(p, "rule")?;
        let mut criteria: ValidationCriteria = serde_json::from_value(raw_rule.clone())
            .map_err(|e| EngineError::invalid(format!("invalid validation rule: {e}")))?;
        if !valid_criteria(&criteria) {
            return Err(EngineError::validation(format!(
                "invalid {:?} validation criteria",
                criteria.kind
            )));
        }
        // `integer:false` is the absent case; normalize so stored rules stay
        // canonical and identical re-submissions compare equal.
        if criteria.integer == Some(false) {
            criteria.integer = None;
        }
        if let Some(pos) = self
            .doc
            .validations
            .iter()
            .position(|r| r.sheet == sheet_id && r.range == range)
        {
            let existing = self.doc.validations[pos].clone();
            if existing.criteria == criteria {
                return Ok(Self::readonly(json!({ "rule": self.rule_json(&existing)? })));
            }
            self.journal.record(UndoEntry::Reset {
                prev: self.doc.clone(),
            });
            self.doc.validations[pos].criteria = criteria;
            let rule = self.doc.validations[pos].clone();
            return Ok(Self::changed(json!({ "rule": self.rule_json(&rule)? })));
        }
        for r in &self.doc.validations {
            if r.sheet == sheet_id
                && rule_coords(&r.range).is_some_and(|rc| intersects(rc, coords))
            {
                return Err(EngineError::validation(
                    "validation range overlaps an existing rule",
                ));
            }
        }
        if self.doc.validations.len() >= MAX_VALIDATIONS {
            return Err(EngineError::out_of_bounds(format!(
                "validation rule limit of {MAX_VALIDATIONS} reached"
            )));
        }
        let id = self.doc.next_validation;
        self.doc.next_validation = self
            .doc
            .next_validation
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("validation id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let rule = ValidationRule {
            id,
            sheet: sheet_id,
            range,
            criteria,
        };
        self.doc.validations.push(rule.clone());
        Ok(Self::changed(json!({ "rule": self.rule_json(&rule)? })))
    }

    /// `clearValidation` — exactly one of `id` (rule handle) or
    /// `range:{from,to}` (+ optional `sheet`, default active) removing every
    /// rule on that sheet intersecting the rectangle. `sheet` alongside `id`
    /// rejects rather than being silently ignored.
    pub(super) fn op_clear_validation(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let has_id = p.get("id").is_some_and(|v| !v.is_null());
        let has_range = p.get("range").is_some_and(|v| !v.is_null());
        // `sheet` only applies to the `range` selector; with `id` it would be
        // silently ignored, so reject the mix instead.
        let has_sheet = p.get("sheet").is_some_and(|v| !v.is_null());
        match (has_id, has_range) {
            (true, false) if has_sheet => Err(EngineError::invalid(
                "clearValidation 'sheet' requires the 'range' selector",
            )),
            (true, false) => {
                let id = p
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
                let pos = self
                    .doc
                    .validations
                    .iter()
                    .position(|r| r.id == id)
                    .ok_or_else(|| EngineError::not_found(format!("no validation rule {id}")))?;
                self.journal.record(UndoEntry::Reset {
                    prev: self.doc.clone(),
                });
                self.doc.validations.remove(pos);
                Ok(Self::changed(json!({ "cleared": 1 })))
            }
            (false, true) => {
                let rect = Rect::read(Self::field(p, "range")?)?;
                let coords: Rect4 = rect.coords();
                let idx = self.validation_sheet_index(p)?;
                let sheet_id = self.doc.sheets[idx].id;
                let mut hits = Vec::new();
                for (i, r) in self.doc.validations.iter().enumerate() {
                    if r.sheet == sheet_id
                        && rule_coords(&r.range).is_some_and(|rc| intersects(rc, coords))
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
                    self.doc.validations.remove(*i);
                }
                Ok(Self::changed(json!({ "cleared": hits.len() })))
            }
            _ => Err(EngineError::invalid(
                "clearValidation requires exactly one of 'id' or 'range'",
            )),
        }
    }

    /// `validateCell {sheet?, addr}` (a `cell` alias is accepted) — silent
    /// read reporting `{valid}` plus the covering `rule`, `expected` text and
    /// the `actual` computed value when a rule applies.
    pub(super) fn op_validate_cell(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.validation_sheet_index(p)?;
        // Explicit `null` counts as absent, matching `sheet?:` handling.
        let s = ["addr", "cell"]
            .iter()
            .filter_map(|k| p.get(*k))
            .find(|v| !v.is_null())
            .and_then(Value::as_str)
            .ok_or_else(|| EngineError::invalid("validateCell requires 'addr'"))?;
        let (c, r) = parse_addr(s)
            .ok_or_else(|| EngineError::validation(format!("invalid cell address '{s}'")))?;
        if !formula::on_sheet(c, r) {
            return Err(EngineError::out_of_bounds(format!(
                "cell address '{s}' is past the sheet (XFD1048576)"
            )));
        }
        let addr = fmt_addr(c, r);
        let sheet = &self.doc.sheets[idx];
        let Some(rule) = self.doc.validations.iter().find(|v| {
            v.sheet == sheet.id && rule_coords(&v.range).is_some_and(|rc| contains(rc, c, r))
        }) else {
            return Ok(Self::readonly(json!({ "valid": true })));
        };
        // Blank means *no stored raw*: a cell holding a formula that computes
        // to Empty is not blank and must satisfy the criteria like any other
        // value (its text form is absent, so every kind rejects it).
        let has_raw = sheet
            .cell_raw(&addr)
            .is_some_and(|raw| !raw.is_empty());
        let mut ev = self.evaluator_for(idx);
        let computed = ev.eval_cell(&addr);
        let valid = if has_raw {
            check_criteria(&rule.criteria, &computed)
        } else {
            true
        };
        let mut out = serde_json::Map::new();
        out.insert("valid".to_string(), json!(valid));
        out.insert("rule".to_string(), self.rule_json(rule)?);
        out.insert(
            "expected".to_string(),
            json!(expected_text(&rule.criteria)),
        );
        out.insert("actual".to_string(), computed.to_json());
        Ok(Self::readonly(Value::Object(out)))
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
    fn set_cell(e: &mut TallyEngine, addr: &str, value: &str) {
        data(e, "setCell", json!({"addr":addr,"value":value}));
    }
    fn rules(e: &mut TallyEngine) -> Vec<Value> {
        let d = data(e, "describe", json!({}));
        d["validations"].as_array().cloned().unwrap_or_default()
    }
    fn validate(e: &mut TallyEngine, p: Value) -> Value {
        data(e, "validateCell", p)
    }

    #[test]
    fn criteria_invariants() {
        let num = |min: Option<f64>, max: Option<f64>, integer: Option<bool>| ValidationCriteria {
            kind: CriteriaKind::Number,
            min,
            max,
            integer,
            values: None,
            min_length: None,
            max_length: None,
        };
        assert!(valid_criteria(&num(None, None, None)));
        assert!(valid_criteria(&num(Some(1.0), Some(2.0), Some(true))));
        assert!(!valid_criteria(&num(Some(5.0), Some(1.0), None)));
        assert!(!valid_criteria(&ValidationCriteria {
            values: Some(vec!["x".into()]),
            ..num(None, None, None)
        }));
        let list = |values: Vec<String>| ValidationCriteria {
            kind: CriteriaKind::List,
            min: None,
            max: None,
            integer: None,
            values: Some(values),
            min_length: None,
            max_length: None,
        };
        assert!(valid_criteria(&list(vec!["a".into(), "b".into()])));
        assert!(!valid_criteria(&list(vec![])));
        assert!(!valid_criteria(&list(vec!["".into()])));
        assert!(!valid_criteria(&list(vec!["x".repeat(8193)])));
        assert!(!valid_criteria(&ValidationCriteria {
            min: Some(0.0),
            ..list(vec!["a".into()])
        }));
        let text = |lo: Option<u32>, hi: Option<u32>| ValidationCriteria {
            kind: CriteriaKind::Text,
            min: None,
            max: None,
            integer: None,
            values: None,
            min_length: lo,
            max_length: hi,
        };
        assert!(valid_criteria(&text(Some(1), Some(10))));
        assert!(valid_criteria(&text(None, Some(10))));
        assert!(!valid_criteria(&text(None, None)));
        assert!(!valid_criteria(&text(Some(0), None)));
        assert!(!valid_criteria(&text(Some(9), Some(3))));
        assert!(!valid_criteria(&text(Some(1), Some(70_000))));
        assert!(!valid_criteria(&ValidationCriteria {
            integer: Some(true),
            ..text(Some(1), None)
        }));
    }

    #[test]
    fn set_and_validate_number_list_text() {
        let mut e = TallyEngine::new();
        set_cell(&mut e, "A1", "5");
        set_cell(&mut e, "A2", "5.5");
        set_cell(&mut e, "A3", "hello");
        set_cell(&mut e, "A4", "=1/0");
        // Number rule with bounds + integer flag.
        let r = data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"A2"},"rule":{"kind":"number","min":1,"max":10,"integer":true}}),
        );
        assert_eq!(r["rule"]["id"], json!(1));
        assert_eq!(r["rule"]["range"], json!("A1:A2"));
        assert_eq!(r["rule"]["sheet"], json!("Sheet1"));
        assert_eq!(
            validate(&mut e, json!({"addr":"A1"})),
            json!({"valid":true,"rule":{"id":1,"sheet":"Sheet1","sheet_id":0,"range":"A1:A2","criteria":{"kind":"number","min":1.0,"max":10.0,"integer":true}},"expected":"an integer between 1 and 10","actual":5.0})
        );
        let bad = validate(&mut e, json!({"addr":"A2"}));
        assert_eq!(bad["valid"], json!(false));
        assert_eq!(bad["actual"], json!(5.5));
        // Uncovered cell and error cell outside the range are plain valid.
        assert_eq!(validate(&mut e, json!({"addr":"B9"})), json!({"valid":true}));
        assert_eq!(validate(&mut e, json!({"addr":"A4"}))["valid"], json!(true));
        // `cell` alias and explicit sheet param both work.
        assert_eq!(
            validate(&mut e, json!({"sheet":"Sheet1","cell":"a1"}))["valid"],
            json!(true)
        );
        // List rule on another range: exact case-sensitive text match.
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A3","to":"A3"},"rule":{"kind":"list","values":["hello","world"]}}),
        );
        assert_eq!(validate(&mut e, json!({"addr":"A3"}))["valid"], json!(true));
        set_cell(&mut e, "A3", "HELLO");
        assert_eq!(validate(&mut e, json!({"addr":"A3"}))["valid"], json!(false));
        // Numbers match list entries via their canonical text form.
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A5","to":"A5"},"rule":{"kind":"list","values":["42","x"]}}),
        );
        set_cell(&mut e, "A5", "42");
        assert_eq!(validate(&mut e, json!({"addr":"A5"}))["valid"], json!(true));
        set_cell(&mut e, "A5", "42.0");
        // fmt_num canonical form decides; "42.0" raw computes to 42 → still matches.
        assert_eq!(validate(&mut e, json!({"addr":"A5"}))["valid"], json!(true));
        // Text-length rule.
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A6","to":"A6"},"rule":{"kind":"text","min_length":3,"max_length":5}}),
        );
        set_cell(&mut e, "A6", "abcd");
        assert_eq!(validate(&mut e, json!({"addr":"A6"}))["valid"], json!(true));
        set_cell(&mut e, "A6", "ab");
        assert_eq!(validate(&mut e, json!({"addr":"A6"}))["valid"], json!(false));
        // Blank cells pass every criteria kind.
        assert_eq!(validate(&mut e, json!({"addr":"A7"})), json!({"valid":true}));
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A7","to":"A7"},"rule":{"kind":"number","min":100}}),
        );
        assert_eq!(validate(&mut e, json!({"addr":"A7"}))["valid"], json!(true));
        // Read-only: no journal entry — undo still targets the last setCell.
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 4);
        assert_eq!(
            data(&mut e, "getCell", json!({"addr":"A6"}))["raw"],
            json!("ab")
        );
    }

    #[test]
    fn error_and_computed_empty_never_pass_bounds() {
        let mut e = TallyEngine::new();
        set_cell(&mut e, "A1", "=1/0"); // computes to #DIV/0!
        set_cell(&mut e, "A2", "=B2"); // B2 is empty → computes to Empty
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"text","min_length":1,"max_length":10}}),
        );
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A2","to":"A2"},"rule":{"kind":"number","min":0}}),
        );
        // Error values never satisfy text bounds (docs), even though their
        // text form ("#DIV/0!", 6 chars) would fit min_length..=max_length.
        let err = validate(&mut e, json!({"addr":"A1"}));
        assert_eq!(err["valid"], json!(false));
        assert_eq!(err["actual"], json!("#DIV/0!"));
        // A stored formula computing to Empty is not blank: it fails the
        // number rule instead of passing like a cell with no stored raw.
        let empty = validate(&mut e, json!({"addr":"A2"}));
        assert_eq!(empty["valid"], json!(false));
        assert_eq!(empty["actual"], Value::Null);
        // ...while a truly blank covered cell still passes (ignore-blank).
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A3","to":"A3"},"rule":{"kind":"text","min_length":1}}),
        );
        assert_eq!(validate(&mut e, json!({"addr":"A3"}))["valid"], json!(true));
        // `list` still matches a literal error-text entry.
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A4","to":"A4"},"rule":{"kind":"list","values":["#DIV/0!"]}}),
        );
        set_cell(&mut e, "A4", "=1/0");
        assert_eq!(validate(&mut e, json!({"addr":"A4"}))["valid"], json!(true));
    }

    #[test]
    fn payload_null_and_selector_edges() {
        let mut e = TallyEngine::new();
        set_cell(&mut e, "A1", "x");
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"text","min_length":1}}),
        );
        // Explicit null addr/cell count as absent like `sheet:null`: the
        // `cell` alias still resolves when `addr` is null.
        assert_eq!(
            validate(&mut e, json!({"addr":null,"cell":"A1"}))["valid"],
            json!(true)
        );
        // `sheet` alongside `id` rejects rather than being ignored.
        assert_eq!(
            apply_err(&mut e, "clearValidation", json!({"id":1,"sheet":"Sheet1"})).code,
            ErrorCode::InvalidCommand
        );
        // A null `sheet` with `id` is still the absent case.
        assert_eq!(
            data(&mut e, "clearValidation", json!({"id":1,"sheet":null}))["cleared"],
            json!(1)
        );
    }

    #[test]
    fn overlap_replace_and_noop_semantics() {
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"C3"},"rule":{"kind":"list","values":["x"]}}),
        );
        let before = e.snapshot().unwrap();
        // Partial overlap rejects atomically.
        for p in [
            json!({"range":{"from":"B2","to":"D4"},"rule":{"kind":"list","values":["y"]}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"number","min":0}}),
        ] {
            assert_eq!(
                apply_err(&mut e, "setValidation", p).code,
                ErrorCode::Validation
            );
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Identical rule re-submission is eventless and journal-free.
        let noop = apply(
            &mut e,
            "setValidation",
            json!({"range":{"from":"C3","to":"A1"},"rule":{"kind":"list","values":["x"]}}),
        );
        assert!(noop.events.is_empty());
        assert_eq!(rules(&mut e).len(), 1);
        // Same sheet+range with different criteria replaces in place, same id.
        let r = data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"C3"},"rule":{"kind":"text","min_length":1}}),
        );
        assert_eq!(r["rule"]["id"], json!(1));
        assert_eq!(rules(&mut e)[0]["criteria"]["kind"], json!("text"));
        // `integer:false` normalizes away so it compares equal to absent.
        let noop2 = apply(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"C3"},"rule":{"kind":"text","min_length":1}}),
        );
        assert!(noop2.events.is_empty());
        // Adjacent non-overlapping ranges on the same sheet coexist.
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"D1","to":"D1"},"rule":{"kind":"number","max":9}}),
        );
        assert_eq!(rules(&mut e).len(), 2);
        // Rules on different sheets may overlap freely.
        data(&mut e, "addSheet", json!({"name":"Other"}));
        data(
            &mut e,
            "setValidation",
            json!({"sheet":"Other","range":{"from":"A1","to":"C3"},"rule":{"kind":"list","values":["z"]}}),
        );
        assert_eq!(rules(&mut e).len(), 3);
        // validateCell resolves the rule bound to the queried sheet: Other's
        // list rule vs Sheet1's replaced text rule at the same address.
        let on_other = validate(&mut e, json!({"sheet":"Other","addr":"A1"}));
        assert_eq!(on_other["rule"]["criteria"]["kind"], json!("list"));
        assert_eq!(on_other["rule"]["sheet"], json!("Other"));
        let on_main = validate(&mut e, json!({"sheet":"Sheet1","addr":"A1"}));
        assert_eq!(on_main["rule"]["criteria"]["kind"], json!("text"));
        assert_eq!(on_main["rule"]["sheet"], json!("Sheet1"));
    }

    #[test]
    fn set_validation_payload_validation() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        for (p, code) in [
            (json!({"range":{"from":"A1","to":"A1"}}), ErrorCode::InvalidCommand), // missing rule
            (json!({"rule":{"kind":"list","values":["a"]}}), ErrorCode::InvalidCommand), // missing range
            (
                json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"bogus"}}),
                ErrorCode::InvalidCommand,
            ),
            (
                json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"list","values":[]}}),
                ErrorCode::Validation,
            ),
            (
                json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"list","values":["a"],"min":1}}),
                ErrorCode::Validation,
            ),
            (
                json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"number","min":5,"max":1}}),
                ErrorCode::Validation,
            ),
            (
                json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"text"}}),
                ErrorCode::Validation,
            ),
            (
                json!({"range":{"from":"A1","to":"XFE1"},"rule":{"kind":"number"}}),
                ErrorCode::OutOfBounds,
            ),
            (
                json!({"sheet":"Missing","range":{"from":"A1","to":"A1"},"rule":{"kind":"number"}}),
                ErrorCode::NotFound,
            ),
        ] {
            assert_eq!(apply_err(&mut e, "setValidation", p).code, code);
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn clear_validation_by_id_and_range() {
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"B2"},"rule":{"kind":"number","min":0}}),
        );
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"D1","to":"D1"},"rule":{"kind":"list","values":["q"]}}),
        );
        // Range clear removes only intersecting rules on the target sheet.
        let r = data(
            &mut e,
            "clearValidation",
            json!({"range":{"from":"A1","to":"A1"}}),
        );
        assert_eq!(r["cleared"], json!(1));
        assert_eq!(rules(&mut e).len(), 1);
        // Clearing an empty area is eventless.
        let noop = apply(
            &mut e,
            "clearValidation",
            json!({"range":{"from":"Z9","to":"Z9"}}),
        );
        assert!(noop.events.is_empty());
        assert_eq!(noop.data["cleared"], json!(0));
        // By id; unknown id is not_found; both/neither selectors invalid.
        let r = data(&mut e, "clearValidation", json!({"id":2}));
        assert_eq!(r["cleared"], json!(1));
        assert!(rules(&mut e).is_empty());
        assert_eq!(
            apply_err(&mut e, "clearValidation", json!({"id":2})).code,
            ErrorCode::NotFound
        );
        for p in [
            json!({}),
            json!({"id":1,"range":{"from":"A1","to":"A1"}}),
            json!({"id":"x"}),
        ] {
            assert!(e.apply(Command::new("clearValidation", p)).is_err());
        }
        // Journal order: set, set, clear-range, clear-id. Undo restores the
        // id-cleared rule, then the range-cleared one, then the second set.
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 2);
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 1);
    }

    #[test]
    fn undo_redo_validation_ops() {
        let mut e = TallyEngine::new();
        set_cell(&mut e, "A1", "3");
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"number","min":0,"max":10}}),
        );
        // Replace criteria, then clear by id.
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"number","min":5}}),
        );
        assert_eq!(
            validate(&mut e, json!({"addr":"A1"}))["valid"],
            json!(false)
        );
        assert!(e.undo().unwrap()); // undo replace → min 0..10 again
        assert_eq!(
            validate(&mut e, json!({"addr":"A1"}))["valid"],
            json!(true)
        );
        assert!(e.undo().unwrap()); // undo set → no rules
        assert!(rules(&mut e).is_empty());
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(rules(&mut e)[0]["criteria"]["min"], json!(5.0));
        data(&mut e, "clearValidation", json!({"id":1}));
        assert!(rules(&mut e).is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 1);
        assert!(e.redo().unwrap());
        assert!(rules(&mut e).is_empty());
    }

    #[test]
    fn remove_sheet_cascades_rules_and_undo_restores() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(
            &mut e,
            "setValidation",
            json!({"sheet":"Data","range":{"from":"A1","to":"A1"},"rule":{"kind":"list","values":["a"]}}),
        );
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"B2","to":"B2"},"rule":{"kind":"number","max":3}}),
        );
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert_eq!(rules(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 2);
        // Re-admitted rules append at the end; `describe` exposes the stored
        // rule where `sheet` is the bound sheet id (Data = 1).
        assert!(rules(&mut e).iter().any(|r| r["sheet"] == json!(1)));
        assert!(e.redo().unwrap());
        assert_eq!(rules(&mut e).len(), 1);
        // Undoing addSheet also drops rules bound to the added sheet.
        let mut e2 = TallyEngine::new();
        data(&mut e2, "addSheet", json!({"name":"Temp"}));
        data(
            &mut e2,
            "setValidation",
            json!({"sheet":"Temp","range":{"from":"A1","to":"A1"},"rule":{"kind":"number"}}),
        );
        assert!(e2.undo().unwrap()); // undo setValidation
        assert!(e2.undo().unwrap()); // undo addSheet → sheet + nothing left
        assert!(rules(&mut e2).is_empty());
        assert_eq!(
            data(&mut e2, "workbook", json!({}))["sheets"].as_array().unwrap().len(),
            1
        );
        assert!(e2.redo().unwrap());
        assert!(e2.redo().unwrap());
        assert_eq!(rules(&mut e2).len(), 1);
    }

    #[test]
    fn hostile_restore_rejects_bad_rules_atomically() {
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"B2"},"rule":{"kind":"list","values":["a","b"]}}),
        );
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"D1","to":"D1"},"rule":{"kind":"number","min":0}}),
        );
        let saved = e.snapshot().unwrap();
        // Validations are durable post-release state → schema:2 wrapper.
        let payload: Value = serde_json::from_slice(decode_envelope(&saved).unwrap().1).unwrap();
        assert_eq!(payload["kind"], json!("tally"));
        assert_eq!(payload["schema"], json!(2));
        assert_eq!(payload["document"]["validations"].as_array().unwrap().len(), 2);
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), saved);
        // A formats-only document still emits schema:1.
        let mut e3 = TallyEngine::new();
        data(&mut e3, "setFormat", json!({"cells":["A1"],"format":{"bold":true}}));
        let p3: Value = serde_json::from_slice(decode_envelope(&e3.snapshot().unwrap()).unwrap().1).unwrap();
        assert_eq!(p3["schema"], json!(1));

        let before = e.snapshot().unwrap();
        let doc = payload.clone();
        let mut cases: Vec<Value> = Vec::new();
        // Unknown criteria kind / stray fields for the kind.
        let mut bad = doc.clone();
        bad["document"]["validations"][0]["criteria"] = json!({"kind":"date","min":"2020-01-01"});
        cases.push(bad);
        let mut bad = doc.clone();
        bad["document"]["validations"][0]["criteria"] = json!({"kind":"list","values":["a"],"bogus":1});
        cases.push(bad);
        let mut bad = doc.clone();
        bad["document"]["validations"][0]["criteria"] = json!({"kind":"list","values":["a"],"min":0});
        cases.push(bad);
        // Missing sheet, duplicate id, overlapping rules, bad range, oversize.
        let mut bad = doc.clone();
        bad["document"]["validations"][0]["sheet"] = json!(99);
        cases.push(bad);
        let mut bad = doc.clone();
        bad["document"]["validations"][1]["id"] = json!(1);
        cases.push(bad);
        let mut bad = doc.clone();
        bad["document"]["validations"][1]["range"] = json!("A1:B2");
        cases.push(bad);
        let mut bad = doc.clone();
        bad["document"]["validations"][0]["range"] = json!("not a range");
        cases.push(bad);
        let mut bad = doc.clone();
        bad["document"]["validations"][0]["range"] = json!("A1:XFD1048576");
        cases.push(bad);
        // Over the rule-count bound.
        let mut bad = doc.clone();
        bad["document"]["validations"] = Value::Array(
            (0..=MAX_VALIDATIONS)
                .map(|i| json!({"id":i+1,"sheet":0,"range":"A1","criteria":{"kind":"number"}}))
                .collect(),
        );
        cases.push(bad);
        for bad in cases {
            let bytes = encode_envelope(&serde_json::to_vec(&bad).unwrap());
            assert!(e.restore(&bytes).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Non-canonical stored range is re-canonicalized on restore.
        let mut fixed = doc.clone();
        fixed["document"]["validations"][0]["range"] = json!("b2:a1");
        e.restore(&encode_envelope(&serde_json::to_vec(&fixed).unwrap()))
            .unwrap();
        assert_eq!(rules(&mut e)[0]["range"], json!("A1:B2"));
        // schema:1 wrapped docs still restore (no validations inside).
        let mut e4 = TallyEngine::new();
        data(&mut e4, "defineName", json!({"name":"N","refers_to":"A1"}));
        let s4 = e4.snapshot().unwrap();
        let mut p4: Value = serde_json::from_slice(decode_envelope(&s4).unwrap().1).unwrap();
        assert_eq!(p4["schema"], json!(1));
        e.restore(&s4).unwrap();
        // Schemas beyond the accepted 1–7 range must fail closed.
        p4["schema"] = json!(8);
        assert!(e.restore(&encode_envelope(&serde_json::to_vec(&p4).unwrap())).is_err());
    }

    #[test]
    fn protection_guards_validation_mutations_only() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Other"}));
        data(
            &mut e,
            "setValidation",
            json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"number","min":0}}),
        );
        data(
            &mut e,
            "setValidation",
            json!({"sheet":"Other","range":{"from":"A1","to":"A1"},"rule":{"kind":"number","min":0}}),
        );
        data(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        // Mutations targeting the protected sheet reject; the other sheet's
        // rule and the read op stay allowed.
        for p in [
            json!({"range":{"from":"B1","to":"B1"},"rule":{"kind":"number"}}),
            json!({"sheet":0,"range":{"from":"B1","to":"B1"},"rule":{"kind":"number"}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"text","min_length":1}}), // replace on protected
            json!({"id":1}),
            json!({"range":{"from":"A1","to":"A1"}}),
        ] {
            let op = if p.get("id").is_some() || (p.get("range").is_some() && p.get("rule").is_none()) {
                "clearValidation"
            } else {
                "setValidation"
            };
            assert!(e.apply(Command::new(op, p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.apply(Command::new("validateCell", json!({"addr":"A1"}))).is_ok());
        data(
            &mut e,
            "clearValidation",
            json!({"sheet":"Other","range":{"from":"A1","to":"A1"}}),
        );
        assert_eq!(rules(&mut e).len(), 1);
        data(&mut e, "protectSheet", json!({"sheet":0,"protected":false}));
        data(&mut e, "clearValidation", json!({"id":1}));
        assert!(rules(&mut e).is_empty());
    }
}
