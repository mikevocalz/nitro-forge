//! Durable conditional-format rules and the match-reporting read ops.
//!
//! Model decision (mirrors `validation_ops`/`name_ops`): rules are
//! **workbook-level entries** bound to one sheet by durable sheet id —
//! `ConditionalRule = { id, sheet: sheet-id, range, criteria, format }`
//! where `range` is a canonical `"A1"`/`"A1:B2"` (reuses
//! `name_ops::parse_refers_to`, capped at the shared 16,384-cell bound) and
//! `id` is a workbook-unique `u64` handle for `clearConditionalFormat`.
//! Unlike validation rules, conditional rules **may overlap** on one sheet:
//! several rules can cover the same cell and `evaluateConditionalFormats`
//! reports every match in creation order — precedence/merge is host-side.
//! Removing a sheet cascade-drops its rules into the same undo entry, and
//! undo re-admits each dropped rule only while it still satisfies the
//! invariants `restore` enforces (`readd_ok`).
//!
//! Criteria reuse the COUNTIF/SUMIF matcher in `formula::conditional`:
//! `">=3"`, `"<>apple"`, `"a*"`, `""` etc. — numbers compare numbers only,
//! text supports `*`/`?`/`~` wildcards ASCII-case-insensitively, and
//! relational non-numeric text rejects at set time. Evaluation runs against
//! **computed** cell values (the same evaluator formulas use), so results
//! track edits, undo and reopen live.
//!
//! Honest scope: the engine stores rules and reports which rules match which
//! cells — it does **not** render or merge styles. `format` is a bounded
//! style payload (`bold`, `italic`, `underline`, `color`, `fill`; `color`
//! and `fill` are `#RRGGBB`) for the host to apply; deferred loudly are the
//! NYC-Tron `kind` variants (`formula`, `color-scale`, `icon-set`,
//! `data-bar`), `styleId` host style references, `enabled`/`stopIfTrue`
//! rule ordering semantics, and any pixel output.
//!
//! Protection: rules are workbook metadata bound to a sheet, so mutations
//! are guarded by the bound sheet exactly like name/validation ops (see
//! `protection.rs`); all read ops are ungated.
use super::range_ops::Rect;
use super::*;

/// Maximum conditional-format rules per workbook (matches the NYC-Tron
/// `ConditionalFormatRules` roster cap of 256).
pub const MAX_CONDITIONAL_RULES: usize = 256;

/// Stored style payload for one rule. Every attribute optional; at least
/// one must be present (enforced by `valid_conditional_format`). This is a
/// deliberately small subset of `CellFormat`: no `number_format` or
/// `border`, plus `underline`/`color` which `CellFormat` lacks.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionalFormat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    /// `#RRGGBB` font color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// `#RRGGBB` background fill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
}

impl ConditionalFormat {
    pub fn is_empty(&self) -> bool {
        self.bold.is_none()
            && self.italic.is_none()
            && self.underline.is_none()
            && self.color.is_none()
            && self.fill.is_none()
    }
}

/// Field-level validation shared by op parsing and hostile-restore checks:
/// at least one attribute, `#RRGGBB` colors.
pub(super) fn valid_conditional_format(f: &ConditionalFormat) -> bool {
    !f.is_empty()
        && f.color.as_deref().is_none_or(format_ops::valid_color)
        && f.fill.as_deref().is_none_or(format_ops::valid_color)
}

/// One durable rule: `id` is a workbook-unique handle, `sheet` the bound
/// sheet id, `range` a canonical `"A1"`/`"A1:B2"`. `deny_unknown_fields`
/// keeps deferred NYC-Tron fields (`enabled`, `stopIfTrue`, `styleId`,
/// `kind`) from being silently dropped out of hostile payloads.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionalRule {
    pub id: u64,
    pub sheet: u64,
    pub range: String,
    /// COUNTIF-style criteria string (see module docs).
    pub criteria: String,
    pub format: ConditionalFormat,
}

/// Inclusive 0-based rectangle shared with `name_ops`/`validation_ops`.
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
/// conditional formats (restore re-validates, so this is defensive).
fn rule_coords(range: &str) -> Option<Rect4> {
    name_ops::parse_refers_to(range).ok()
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped rule
/// comes back only while it still satisfies every invariant `restore`
/// enforces — bound sheet exists, canonical on-sheet range within the cell
/// cap, parseable criteria, valid format, unique id, under the cap. Rules
/// on other sheets cannot have been created for the removed sheet while it
/// was gone (sheet ids are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, rule: &ConditionalRule) -> bool {
    if doc.conditional_formats.len() >= MAX_CONDITIONAL_RULES {
        return false;
    }
    if doc.conditional_formats.iter().any(|r| r.id == rule.id) {
        return false;
    }
    if !doc.sheets.iter().any(|s| s.id == rule.sheet) {
        return false;
    }
    if !formula::CriteriaMatcher::is_valid(&rule.criteria) {
        return false;
    }
    if !valid_conditional_format(&rule.format) {
        return false;
    }
    let coords = match rule_coords(&rule.range) {
        Some(c) => c,
        None => return false,
    };
    name_ops::canonical_refers_to(coords) == rule.range
        && cell_count(coords) <= MAX_GET_RANGE_CELLS
}

/// `setConditionalFormat` rule payload: `{criteria, format}`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RuleInput {
    criteria: String,
    format: ConditionalFormat,
}

/// Normalize a parsed format: `false` booleans carry no style, so they
/// collapse to absent and stored rules stay canonical (identical
/// re-submissions compare equal and stay eventless). Shared by the op path
/// and hostile-restore validation so a crafted `{"bold":false}` cannot
/// restore a non-canonical rule that re-serialization would rewrite.
pub(super) fn normalize_format(f: &mut ConditionalFormat) {
    for flag in [&mut f.bold, &mut f.italic, &mut f.underline] {
        if *flag == Some(false) {
            *flag = None;
        }
    }
}

fn err_literal(v: &formula::Value) -> &'static str {
    match v {
        formula::Value::Err(e) => e,
        _ => formula::ERR_VALUE,
    }
}

impl TallyEngine {
    /// Sheet index a conditional-format op targets: payload `sheet` (name
    /// or index) or the active sheet when absent/null.
    fn conditional_sheet_index(&self, p: &Value) -> Result<usize, EngineError> {
        match p.get("sheet") {
            None | Some(Value::Null) => Ok(self.doc.active),
            Some(v) => self.resolve_sheet(v),
        }
    }

    /// JSON view of one rule with its bound sheet's *current* name resolved.
    fn conditional_rule_json(&self, r: &ConditionalRule) -> Result<Value, EngineError> {
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
            "criteria": r.criteria,
            "format": serde_json::to_value(&r.format)?,
        }))
    }

    /// `setConditionalFormat {sheet?, range:{from,to}, rule:{criteria,
    /// format}}` — append a rule. An identical existing rule (same sheet,
    /// range, criteria and format) is an eventless no-op; overlaps with
    /// other rules are allowed (see module docs).
    pub(super) fn op_set_conditional_format(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let rect = Rect::read(Self::field(p, "range")?)?;
        let range = name_ops::canonical_refers_to(rect.coords());
        let idx = self.conditional_sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let mut input: RuleInput = serde_json::from_value(Self::field(p, "rule")?.clone())
            .map_err(|e| EngineError::invalid(format!("invalid conditional rule: {e}")))?;
        if !formula::CriteriaMatcher::is_valid(&input.criteria) {
            return Err(EngineError::validation(format!(
                "invalid conditional criteria '{}'",
                input.criteria
            )));
        }
        normalize_format(&mut input.format);
        if !valid_conditional_format(&input.format) {
            return Err(EngineError::validation(
                "conditional format needs at least one of bold/italic/underline/color/fill",
            ));
        }
        if let Some(existing) = self.doc.conditional_formats.iter().find(|r| {
            r.sheet == sheet_id
                && r.range == range
                && r.criteria == input.criteria
                && r.format == input.format
        }) {
            return Ok(Self::readonly(json!({
                "rule": self.conditional_rule_json(existing)?
            })));
        }
        if self.doc.conditional_formats.len() >= MAX_CONDITIONAL_RULES {
            return Err(EngineError::out_of_bounds(format!(
                "conditional rule limit of {MAX_CONDITIONAL_RULES} reached"
            )));
        }
        let id = self.doc.next_conditional;
        self.doc.next_conditional = self
            .doc
            .next_conditional
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("conditional rule id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let rule = ConditionalRule {
            id,
            sheet: sheet_id,
            range,
            criteria: input.criteria,
            format: input.format,
        };
        self.doc.conditional_formats.push(rule.clone());
        Ok(Self::changed(json!({
            "rule": self.conditional_rule_json(&rule)?
        })))
    }

    /// `clearConditionalFormat` — exactly one of `id` (rule handle) or
    /// `range:{from,to}` (+ optional `sheet`, default active) removing every
    /// rule on that sheet intersecting the rectangle.
    pub(super) fn op_clear_conditional_format(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let has_id = p.get("id").is_some_and(|v| !v.is_null());
        let has_range = p.get("range").is_some_and(|v| !v.is_null());
        // `sheet` only applies to the `range` selector; with `id` it would be
        // silently ignored, so reject the mix instead (mirrors clearValidation).
        let has_sheet = p.get("sheet").is_some_and(|v| !v.is_null());
        match (has_id, has_range) {
            (true, false) if has_sheet => Err(EngineError::invalid(
                "clearConditionalFormat 'sheet' requires the 'range' selector",
            )),
            (true, false) => {
                let id = p
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
                let pos = self
                    .doc
                    .conditional_formats
                    .iter()
                    .position(|r| r.id == id)
                    .ok_or_else(|| EngineError::not_found(format!("no conditional rule {id}")))?;
                self.journal.record(UndoEntry::Reset {
                    prev: self.doc.clone(),
                });
                self.doc.conditional_formats.remove(pos);
                Ok(Self::changed(json!({ "cleared": 1 })))
            }
            (false, true) => {
                let rect = Rect::read(Self::field(p, "range")?)?;
                let coords: Rect4 = rect.coords();
                let idx = self.conditional_sheet_index(p)?;
                let sheet_id = self.doc.sheets[idx].id;
                let mut hits = Vec::new();
                for (i, r) in self.doc.conditional_formats.iter().enumerate() {
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
                    self.doc.conditional_formats.remove(*i);
                }
                Ok(Self::changed(json!({ "cleared": hits.len() })))
            }
            _ => Err(EngineError::invalid(
                "clearConditionalFormat requires exactly one of 'id' or 'range'",
            )),
        }
    }

    /// `getConditionalFormats {sheet?}` — silent read; `sheet` absent lists
    /// every rule in the workbook, present filters to that sheet.
    pub(super) fn op_get_conditional_formats(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let rules: Vec<&ConditionalRule> = match p.get("sheet") {
            None | Some(Value::Null) => self.doc.conditional_formats.iter().collect(),
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                let sheet_id = self.doc.sheets[idx].id;
                self.doc
                    .conditional_formats
                    .iter()
                    .filter(|r| r.sheet == sheet_id)
                    .collect()
            }
        };
        let mut out = Vec::with_capacity(rules.len());
        for r in rules {
            out.push(self.conditional_rule_json(r)?);
        }
        Ok(Self::readonly(json!({ "rules": out })))
    }

    /// `evaluateConditionalFormats {sheet?, range:{from,to}}` — silent read
    /// reporting, per cell in the rectangle, the computed value and every
    /// rule on that sheet whose range covers the cell and whose criteria
    /// the computed value satisfies. This reports **matches only** — it
    /// does not apply, merge or render any style; formatting is host-side.
    /// Error-valued cells report their error literal and never match.
    pub(super) fn op_evaluate_conditional_formats(
        &self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let rect = Rect::read(Self::field(p, "range")?)?;
        let coords: Rect4 = rect.coords();
        let idx = self.conditional_sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        // Only rules intersecting the query rect can match a cell inside it.
        // `armed` keeps (rule index, coords, matcher) in doc order so match
        // results preserve rule creation order.
        let mut armed: Vec<(usize, Rect4, formula::CriteriaMatcher)> = Vec::new();
        for (i, r) in self.doc.conditional_formats.iter().enumerate() {
            if r.sheet != sheet_id {
                continue;
            }
            let Some(rc) = rule_coords(&r.range) else {
                continue;
            };
            if !intersects(rc, coords) {
                continue;
            }
            let matcher = formula::CriteriaMatcher::parse(&r.criteria).map_err(|_| {
                EngineError::serialization("stored conditional criteria failed to parse")
            })?;
            armed.push((i, rc, matcher));
        }
        let mut ev = self.evaluator_for(idx);
        let mut cells = Vec::new();
        for addr in rect.addrs() {
            let (c, r) = parse_addr(&addr)
                .ok_or_else(|| EngineError::serialization("internal address error"))?;
            let value = ev.eval_cell(&addr);
            let mut matched_rules = Vec::new();
            for (rule_idx, rc, matcher) in &armed {
                if !contains(*rc, c, r) {
                    continue;
                }
                match ev.match_value(&value, matcher) {
                    Ok(true) => matched_rules.push(*rule_idx),
                    Ok(false) => {}
                    Err(e) => {
                        return Err(EngineError::validation(format!(
                            "conditional evaluation failed: {}",
                            err_literal(&e)
                        )))
                    }
                }
            }
            let mut out = serde_json::Map::new();
            out.insert("addr".to_string(), json!(addr));
            out.insert("computed".to_string(), value.to_json());
            let mut rule_jsons = Vec::with_capacity(matched_rules.len());
            for i in matched_rules {
                rule_jsons.push(self.conditional_rule_json(&self.doc.conditional_formats[i])?);
            }
            out.insert("matches".to_string(), json!(rule_jsons));
            cells.push(Value::Object(out));
        }
        Ok(Self::readonly(json!({ "cells": cells })))
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
    fn set_rule(e: &mut TallyEngine, range: (&str, &str), criteria: &str, format: Value) -> Value {
        data(
            e,
            "setConditionalFormat",
            json!({
                "range": {"from": range.0, "to": range.1},
                "rule": {"criteria": criteria, "format": format},
            }),
        )["rule"]
            .clone()
    }
    fn rules(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "getConditionalFormats", json!({}))["rules"]
            .as_array()
            .unwrap()
            .clone()
    }
    /// `matches` id list for one addr from evaluateConditionalFormats.
    fn matched_ids(e: &mut TallyEngine, from: &str, to: &str, addr: &str) -> Vec<u64> {
        let cells = data(
            e,
            "evaluateConditionalFormats",
            json!({"range": {"from": from, "to": to}}),
        )["cells"]
            .as_array()
            .unwrap()
            .clone();
        let cell = cells
            .iter()
            .find(|c| c["addr"] == json!(addr))
            .unwrap_or_else(|| panic!("{addr} missing from {cells:?}"));
        cell["matches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].as_u64().unwrap())
            .collect()
    }

    #[test]
    fn set_list_clear_by_id_and_range() {
        let mut e = TallyEngine::new();
        let r1 = set_rule(&mut e, ("A1", "A3"), ">=10", json!({"bold": true}));
        assert_eq!(r1["id"], json!(1));
        assert_eq!(r1["range"], json!("A1:A3"));
        assert_eq!(r1["sheet"], json!("Sheet1"));
        assert_eq!(r1["sheet_id"], json!(0));
        assert_eq!(r1["format"], json!({"bold": true}));
        // Overlapping rules on the same sheet are allowed (unlike validation).
        let r2 = set_rule(&mut e, ("A2", "B2"), "apple*", json!({"fill": "#FF0000"}));
        assert_eq!(r2["id"], json!(2));
        assert_eq!(rules(&mut e).len(), 2);
        // Identical re-submission is eventless and returns the existing rule.
        let before = e.snapshot().unwrap();
        let dup = apply(
            &mut e,
            "setConditionalFormat",
            json!({"range":{"from":"B2","to":"A2"},"rule":{"criteria":"apple*","format":{"fill":"#FF0000"}}}),
        );
        assert!(dup.events.is_empty());
        assert_eq!(dup.data["rule"]["id"], json!(2));
        assert_eq!(e.snapshot().unwrap(), before);
        // clearConditionalFormat by range removes every intersecting rule.
        let cleared = data(
            &mut e,
            "clearConditionalFormat",
            json!({"range": {"from": "A2", "to": "A2"}}),
        );
        assert_eq!(cleared["cleared"], json!(2));
        assert!(rules(&mut e).is_empty());
        // clear by id; missing id is not_found.
        set_rule(&mut e, ("C1", "C1"), "TRUE", json!({"italic": true}));
        let id = rules(&mut e)[0]["id"].as_u64().unwrap();
        assert_eq!(
            data(&mut e, "clearConditionalFormat", json!({"id": id}))["cleared"],
            json!(1)
        );
        assert_eq!(
            apply_err(&mut e, "clearConditionalFormat", json!({"id": id})).code,
            ErrorCode::NotFound
        );
        // Exactly one of id/range is required.
        for p in [
            json!({}),
            json!({"id": 1, "range": {"from": "A1", "to": "A1"}}),
        ] {
            assert!(e.apply(Command::new("clearConditionalFormat", p)).is_err());
        }
    }

    #[test]
    fn clear_conditional_format_rejects_sheet_alongside_id() {
        let mut e = TallyEngine::new();
        set_rule(&mut e, ("A1", "A1"), ">1", json!({"bold": true}));
        let id = rules(&mut e)[0]["id"].as_u64().unwrap();
        // `sheet` only applies to the `range` selector — alongside `id` it
        // would be silently ignored, so it rejects (mirrors clearValidation).
        // An explicit `sheet: null` counts as absent and is allowed.
        assert_eq!(
            apply_err(
                &mut e,
                "clearConditionalFormat",
                json!({"id": id, "sheet": "Sheet1"})
            )
            .code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(rules(&mut e).len(), 1);
        assert_eq!(
            data(
                &mut e,
                "clearConditionalFormat",
                json!({"id": id, "sheet": null})
            )["cleared"],
            json!(1)
        );
    }

    #[test]
    fn evaluate_charges_work_per_candidate_and_bounds_rule_cell_product() {
        let mut e = TallyEngine::new();
        // 256 rules (the cap) all covering A1:A16384; the query covers
        // A1:A8192, so 256 × 8192 = 2,097,152 candidate rule-cell
        // evaluations exceed the shared 1,000,000 conditional allowance.
        // Every candidate is charged one unit even when the criteria is a
        // bare numeric comparison against empty cells (no pattern work), so
        // the op must fail with #NUM! rather than serialize millions of
        // match reports.
        for i in 0..MAX_CONDITIONAL_RULES {
            set_rule(
                &mut e,
                ("A1", "A16384"),
                &format!(">={i}"),
                json!({"bold": true}),
            );
        }
        let err = apply_err(
            &mut e,
            "evaluateConditionalFormats",
            json!({"range": {"from": "A1", "to": "A8192"}}),
        );
        assert_eq!(err.code, ErrorCode::Validation);
        assert!(err.message.contains("#NUM!"), "{err:?}");
        // A smaller product still succeeds: 64 rules over A1:A64 is
        // 4,096 candidates, far under the allowance.
        let mut small = TallyEngine::new();
        for i in 0..64 {
            set_rule(
                &mut small,
                ("A1", "A64"),
                &format!(">={i}"),
                json!({"bold": true}),
            );
        }
        let cells = data(
            &mut small,
            "evaluateConditionalFormats",
            json!({"range": {"from": "A1", "to": "A64"}}),
        )["cells"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(cells.len(), 64);
    }

    #[test]
    fn criteria_kinds_match_computed_values() {
        let mut e = TallyEngine::new();
        for (addr, raw) in [
            ("A1", "5"),
            ("A2", "=A1*2"),
            ("A3", "apple"),
            ("A4", "Application"),
            ("A5", ""),
            ("B1", "=1/0"),
        ] {
            data(&mut e, "setCell", json!({"addr": addr, "value": raw}));
        }
        set_rule(&mut e, ("A1", "A5"), ">=10", json!({"bold": true}));
        set_rule(&mut e, ("A1", "A5"), "app*", json!({"italic": true}));
        set_rule(&mut e, ("A1", "A5"), "", json!({"underline": true}));
        set_rule(&mut e, ("A1", "A5"), "=TRUE", json!({"color": "#00FF00"}));
        // A1=5 no match; A2==10 matches rule 1; A3/A4 match rule 2
        // (ASCII-case-insensitive); A5 empty matches the "" rule; B1's
        // #DIV/0! never matches any rule but still reports computed.
        assert_eq!(matched_ids(&mut e, "A1", "A5", "A1"), Vec::<u64>::new());
        assert_eq!(matched_ids(&mut e, "A1", "B5", "A2"), vec![1]);
        assert_eq!(matched_ids(&mut e, "A1", "B5", "A3"), vec![2]);
        assert_eq!(matched_ids(&mut e, "A1", "B5", "A4"), vec![2]);
        assert_eq!(matched_ids(&mut e, "A1", "B5", "A5"), vec![3]);
        assert_eq!(matched_ids(&mut e, "A1", "B5", "B1"), Vec::<u64>::new());
        let cells = data(
            &mut e,
            "evaluateConditionalFormats",
            json!({"range": {"from": "B1", "to": "B1"}}),
        )["cells"]
            .clone();
        assert_eq!(cells[0]["computed"], json!("#DIV/0!"));
        assert_eq!(cells[0]["matches"], json!([]));
    }

    #[test]
    fn evaluate_uses_live_computed_values_and_sheet_param() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        set_rule(&mut e, ("A1", "A1"), ">5", json!({"bold": true}));
        assert_eq!(matched_ids(&mut e, "A1", "A1", "A1"), Vec::<u64>::new());
        data(&mut e, "setCell", json!({"addr":"A1","value":"9"}));
        assert_eq!(matched_ids(&mut e, "A1", "A1", "A1"), vec![1]);
        // Rules on another sheet do not leak; sheet param resolves names.
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(
            &mut e,
            "setConditionalFormat",
            json!({"sheet":"Data","range":{"from":"A1","to":"A1"},"rule":{"criteria":">0","format":{"fill":"#0000FF"}}}),
        );
        assert_eq!(rules(&mut e).len(), 2);
        let data_rules = data(&mut e, "getConditionalFormats", json!({"sheet":"Data"}))["rules"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(data_rules.len(), 1);
        assert_eq!(data_rules[0]["sheet_id"], json!(1));
        // evaluate on Sheet1 still reports only its own rule.
        let cells = data(
            &mut e,
            "evaluateConditionalFormats",
            json!({"sheet": 0, "range": {"from": "A1", "to": "A1"}}),
        )["cells"]
            .clone();
        assert_eq!(cells[0]["matches"].as_array().unwrap().len(), 1);
        assert_eq!(cells[0]["matches"][0]["id"], json!(1));
    }

    #[test]
    fn invalid_payloads_reject_atomically() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        let before = e.snapshot().unwrap();
        for p in [
            // Bad criteria: relational non-numeric text, overlong string.
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">apple","format":{"bold":true}}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":"x".repeat(256),"format":{"bold":true}}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{}}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":false}}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"fill":"red"}}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"number_format":"n"}}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1"}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"format":{"bold":true}}}),
            json!({"range":{"from":"A1","to":"A1"}}),
            json!({"range":{"from":"A1","to":"XFE1"},"rule":{"criteria":">1","format":{"bold":true}}}),
            json!({"range":{"from":"A1","to":"A16385"},"rule":{"criteria":">1","format":{"bold":true}}}),
            json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}},"sheet":"Missing"}),
        ] {
            assert!(e.apply(Command::new("setConditionalFormat", p.clone())).is_err(), "{p}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e
            .apply(Command::new(
                "evaluateConditionalFormats",
                json!({"range": {"from": "A1", "to": "XFE1"}})
            ))
            .is_err());
        assert!(e
            .apply(Command::new("getConditionalFormats", json!({"sheet": "Missing"})))
            .is_err());
    }

    #[test]
    fn undo_redo_remove_sheet_cascade_and_snapshot_roundtrip() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"7"}));
        set_rule(&mut e, ("A1", "A1"), ">5", json!({"bold": true, "fill": "#123456"}));
        set_rule(&mut e, ("B1", "B1"), "x", json!({"underline": true}));
        let saved = e.snapshot().unwrap();
        // Conditional rules emit the schema:3 wrapper (schema:4 is the
        // filters tier, schema:2 validations-only, schema:1 the legacy
        // wrapper).
        let payload: Value = serde_json::from_slice(decode_envelope(&saved).unwrap().1).unwrap();
        assert_eq!(payload["kind"], json!("tally"));
        assert_eq!(payload["schema"], json!(3));
        assert_eq!(payload["document"]["conditional_formats"].as_array().unwrap().len(), 2);
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), saved);
        assert_eq!(rules(&mut reopened).len(), 2);
        assert_eq!(matched_ids(&mut reopened, "A1", "A1", "A1"), vec![1]);
        // Undo/redo the second rule, then the first.
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert!(rules(&mut e).is_empty());
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(rules(&mut e).len(), 2);
        // removeSheet cascade-drops the sheet's rules; undo re-admits them.
        data(&mut e, "addSheet", json!({"name":"Tmp"}));
        data(
            &mut e,
            "setConditionalFormat",
            json!({"sheet":"Tmp","range":{"from":"A1","to":"A1"},"rule":{"criteria":">0","format":{"color":"#FFFFFF"}}}),
        );
        assert_eq!(rules(&mut e).len(), 3);
        data(&mut e, "removeSheet", json!({"sheet":"Tmp"}));
        assert_eq!(rules(&mut e).len(), 2);
        assert!(e.undo().unwrap());
        assert_eq!(rules(&mut e).len(), 3);
        assert!(e.redo().unwrap());
        assert_eq!(rules(&mut e).len(), 2);
    }

    #[test]
    fn hostile_restore_rejects_bad_rules_atomically() {
        let mut e = TallyEngine::new();
        set_rule(&mut e, ("A1", "A1"), ">1", json!({"bold": true}));
        let good = e.snapshot().unwrap();
        let payload: Value = serde_json::from_slice(decode_envelope(&good).unwrap().1).unwrap();
        let mut bad = payload.clone();
        // Schemas beyond the accepted 1–10 range must fail closed.
        let mut v4 = payload.clone();
        v4["schema"] = json!(11);
        assert!(e.restore(&encode_envelope(&serde_json::to_vec(&v4).unwrap())).is_err());
        assert_eq!(e.snapshot().unwrap(), good);
        let rule = |mut r: Value| {
            r["document"]["conditional_formats"] = json!([r["document"]["conditional_formats"][0].clone()]);
            r
        };
        for mutate in [
            // duplicate id
            Box::new(|mut d: Value| {
                let r = d["document"]["conditional_formats"][0].clone();
                d["document"]["conditional_formats"]
                    .as_array_mut()
                    .unwrap()
                    .push(r);
                d
            }) as Box<dyn Fn(Value) -> Value>,
            // missing sheet
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["sheet"] = json!(99);
                d
            }),
            // unparseable criteria / invalid format / bad range
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["criteria"] = json!(">apple");
                d
            }),
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["format"] = json!({});
                d
            }),
            // Non-canonical `false` booleans normalize to absent on restore;
            // {"bold":false} alone leaves an empty format and must reject.
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["format"] = json!({"bold": false});
                d
            }),
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["format"]["fill"] = json!("red");
                d
            }),
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["range"] = json!("not a range");
                d
            }),
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["range"] = json!("A1:XFD1048576");
                d
            }),
            // Deferred/unknown rule fields reject (deny_unknown_fields) —
            // they must not be silently dropped out of hostile payloads.
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["enabled"] = json!(false);
                d
            }),
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["stopIfTrue"] = json!(true);
                d
            }),
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["kind"] = json!("formula");
                d
            }),
            Box::new(|mut d: Value| {
                d["document"]["conditional_formats"][0]["styleId"] = json!("s1");
                d
            }),
            // over the rule cap
            Box::new(|mut d: Value| {
                let r = d["document"]["conditional_formats"][0].clone();
                let arr = d["document"]["conditional_formats"]
                    .as_array_mut()
                    .unwrap();
                for i in 1..=MAX_CONDITIONAL_RULES {
                    let mut copy = r.clone();
                    copy["id"] = json!(1000 + i);
                    arr.push(copy);
                }
                d
            }),
        ] {
            let mutated = mutate(bad.clone());
            assert!(
                e.restore(&encode_envelope(&serde_json::to_vec(&mutated).unwrap())).is_err(),
                "{mutated}"
            );
            assert_eq!(e.snapshot().unwrap(), good);
            bad = payload.clone();
        }
        let _ = rule;
    }

    #[test]
    fn hostile_restore_normalizes_format_booleans() {
        let mut e = TallyEngine::new();
        set_rule(&mut e, ("A1", "A1"), ">1", json!({"bold": true}));
        let good = e.snapshot().unwrap();
        let payload: Value = serde_json::from_slice(decode_envelope(&good).unwrap().1).unwrap();
        // `false` booleans carry no style: restore applies the same
        // normalization as the op path, so {"bold":false,"fill":…} stores
        // canonically as {"fill":…} instead of rejecting or drifting.
        let mut p = payload.clone();
        p["document"]["conditional_formats"][0]["format"] =
            json!({"bold": false, "italic": false, "fill": "#FF0000"});
        e.restore(&encode_envelope(&serde_json::to_vec(&p).unwrap()))
            .unwrap();
        assert_eq!(rules(&mut e)[0]["format"], json!({"fill": "#FF0000"}));
        // Re-saving emits the canonical form and snapshot round-trips
        // byte-identically — identical-resubmission equality is preserved.
        let saved = e.snapshot().unwrap();
        let mut e2 = TallyEngine::new();
        e2.restore(&saved).unwrap();
        assert_eq!(e2.snapshot().unwrap(), saved);
        // An op resubmitting the non-canonical form dedupes eventlessly
        // against the normalized stored rule.
        let before = e.snapshot().unwrap();
        let dup = apply(
            &mut e,
            "setConditionalFormat",
            json!({
                "range": {"from": "A1", "to": "A1"},
                "rule": {"criteria": ">1", "format": {"bold": false, "fill": "#FF0000"}}
            }),
        );
        assert!(dup.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);
        // State after all this still restores cleanly.
        e.restore(&good).unwrap();
        assert_eq!(rules(&mut e)[0]["format"], json!({"bold": true}));
    }
}
