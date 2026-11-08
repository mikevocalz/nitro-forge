//! Workbook-level named ranges and the `functionCatalog` read op.
//!
//! Model decision (documented in `docs/ENGINE_OPS.md`): names are
//! **workbook-scoped entries**, each bound to exactly one sheet by durable
//! sheet id — the NYC-Tron/Excel "workbook name with optional sheet scope"
//! collapsed to the only scope a bare identifier can resolve to: names
//! resolve only inside formulas on their bound sheet. `Sheet!name` does
//! not exist in the grammar — cross-sheet references qualify cell/range
//! addresses, not names. `refers_to` is a canonical same-sheet
//! rectangle `"A1"` or `"A1:B2"` (normalized, `$` markers dropped, endpoints
//! ordered). Names do not support whole-row/column refs or formula targets.
//!
//! Name validation is a documented subset of Excel's rules: ASCII
//! `[A-Za-z_][A-Za-z0-9_]*`, ≤64 chars, not cell-ref shaped in the
//! tokenizer's `$?[A-Za-z]+$?[0-9]+` shape regardless of grid bounds
//! (`A1`, `A0`, `ZZZZZZZZ1` all lex as refs), not R1C1-shaped (`R1`, `C1`,
//! `R1C1`), not a `functionCatalog` name (`SUM`, `IF`, … — `=NAME` would
//! resolve the name while `=NAME(...)` calls the function), not the single
//! letters `R`/`C`, and not `TRUE`/`FALSE` (formula literals). The charset
//! mirrors the tokenizer's word characters: `.` or `$` could never
//! round-trip through `=name`. Uniqueness is case-insensitive across the
//! whole workbook.
//!
//! Formula integration: the evaluator resolves a bare identifier to its
//! target when the formula's sheet matches the name's sheet — including
//! formulas reached through `Sheet!` cross-sheet references, which keep
//! resolving names on their own sheet; names bound to other sheets
//! evaluate to `#NAME?`. `COUNTIF`/`SUMIF` accept a name in place of
//! their range argument.
//!
//! Protection: names are workbook metadata but each is bound to a sheet, so
//! `check_protection` treats define/update/remove like edits to that sheet
//! (see `protection.rs`). `listNames`/`functionCatalog` are read-only.
use super::*;
use formula::parse_addr;
use std::collections::HashMap;

/// Maximum number of named ranges per workbook.
pub const MAX_NAMES: usize = 256;
/// Maximum name length in bytes (names are ASCII-only, so bytes == chars).
pub const MAX_NAME_LEN: usize = 64;

/// Inclusive 0-based rectangle parsed from a canonical `refers_to` string.
pub(super) type RefersCoords = (u32, u32, u32, u32);

/// R1C1-shaped check for the documented name subset: `R<n>`, `C<n>`,
/// `R<n>C<m>` (any case) collide with R1C1-style references.
fn r1c1_shaped(name: &str) -> bool {
    let b = name.as_bytes();
    if b.len() < 2 {
        // Bare "R"/"C" are reserved by the same rule.
        return matches!(name.to_ascii_uppercase().as_str(), "R" | "C");
    }
    let digits = |s: &[u8]| !s.is_empty() && s.iter().all(u8::is_ascii_digit);
    if digits(&b[1..]) {
        // "R5" / "C5"
        return matches!(b[0].to_ascii_uppercase(), b'R' | b'C');
    }
    // "R<n>C<m>"
    if b[0].eq_ignore_ascii_case(&b'R') {
        let mut i = 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i > 1 && i < b.len() && b[i].eq_ignore_ascii_case(&b'C') {
            return digits(&b[i + 1..]);
        }
    }
    false
}

/// Whether `name` is a legal defined-name in the documented subset.
pub(super) fn valid_name(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return false;
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    // Charset mirrors the formula tokenizer's word characters (`.` splits a
    // token and fails lexing → `#NAME?`; `$` is ref syntax): a name outside
    // it could never round-trip through `=name`.
    if !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return false;
    }
    if name.eq_ignore_ascii_case("TRUE") || name.eq_ignore_ascii_case("FALSE") {
        return false;
    }
    // Function names are callable as `NAME(...)` while a bare `=NAME` would
    // resolve the defined name — ambiguous, so reserved (the catalog also
    // covers TRUE/FALSE, already rejected above as literals).
    if formula::FUNCTION_CATALOG
        .iter()
        .any(|f| f.name.eq_ignore_ascii_case(name))
    {
        return false;
    }
    // Cell-ref shaped in the tokenizer's `$?[A-Za-z]+$?[0-9]+` sense —
    // bounds-independent, so `A0`/`ZZZZZZZZ1` reject too — or R1C1 shaped.
    !formula::is_ref_word(name) && !r1c1_shaped(name)
}

/// Parse `"A1"` or `"A1:B2"` (either endpoint order, `$` allowed) into
/// normalized inclusive 0-based coords inside the sheet.
pub(super) fn parse_refers_to(s: &str) -> Result<RefersCoords, EngineError> {
    let bad = || EngineError::validation(format!("invalid refers_to '{s}'"));
    let (a, b) = match s.split_once(':') {
        Some((x, y)) => (x.trim(), y.trim()),
        None => (s.trim(), s.trim()),
    };
    let endpoint = |t: &str| -> Result<(u32, u32), EngineError> {
        let (c, r) = parse_addr(t).ok_or_else(bad)?;
        if !formula::on_sheet(c, r) {
            return Err(EngineError::out_of_bounds(format!(
                "refers_to '{s}' is past the sheet (XFD1048576)"
            )));
        }
        Ok((c, r))
    };
    let (c0, r0) = endpoint(a)?;
    let (c1, r1) = endpoint(b)?;
    Ok((c0.min(c1), r0.min(r1), c0.max(c1), r0.max(r1)))
}

/// Canonical stored form of `refers_to`: `"A1"` for a single cell,
/// `"A1:B2"` otherwise.
pub(super) fn canonical_refers_to(coords: RefersCoords) -> String {
    let (c0, r0, c1, r1) = coords;
    if c0 == c1 && r0 == r1 {
        fmt_addr(c0, r0)
    } else {
        format!("{}:{}", fmt_addr(c0, r0), fmt_addr(c1, r1))
    }
}

/// Parse a stored `refers_to` back to coords; `None` only for snapshots
/// written before validation existed (restore re-validates, so this is a
/// defensive path).
pub(super) fn refers_coords(refers_to: &str) -> Option<RefersCoords> {
    parse_refers_to(refers_to).ok()
}

/// Build the evaluator's name table: uppercase name → resolved target.
/// Names whose stored `refers_to` fails to parse are skipped (they cannot
/// exist post-validation; skipping is the fail-safe).
pub(super) fn name_table(names: &[NamedRange]) -> HashMap<String, formula::NameTarget> {
    names
        .iter()
        .filter_map(|n| {
            let (c0, r0, c1, r1) = refers_coords(&n.refers_to)?;
            Some((
                n.name.to_ascii_uppercase(),
                formula::NameTarget {
                    sheet: n.sheet,
                    c0,
                    r0,
                    c1,
                    r1,
                },
            ))
        })
        .collect()
}

impl TallyEngine {
    /// Position of `name` in `doc.names`, case-insensitive.
    pub(super) fn find_name(&self, name: &str) -> Option<usize> {
        self.doc
            .names
            .iter()
            .position(|n| n.name.eq_ignore_ascii_case(name))
    }

    /// Sheet id a name is bound to (for `check_protection`); `None` when the
    /// name does not exist.
    pub(super) fn name_sheet_id(&self, name: &str) -> Option<u64> {
        self.find_name(name).map(|i| self.doc.names[i].sheet)
    }

    /// JSON view of one name with its *current* sheet name resolved.
    fn name_json(&self, n: &NamedRange) -> Value {
        let sheet_name = self
            .doc
            .sheets
            .iter()
            .find(|s| s.id == n.sheet)
            .map(|s| s.name.clone());
        json!({
            "name": n.name,
            "sheet": sheet_name,
            "sheet_id": n.sheet,
            "refers_to": n.refers_to,
        })
    }

    fn resolve_name_sheet(
        &self,
        p: &Value,
        existing: Option<&NamedRange>,
    ) -> Result<u64, EngineError> {
        match p.get("sheet") {
            None | Some(Value::Null) => match existing {
                Some(n) => Ok(n.sheet),
                None => Ok(self.doc.sheets[self.doc.active].id),
            },
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                Ok(self.doc.sheets[idx].id)
            }
        }
    }

    pub(super) fn op_define_name(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let name = Self::str_field(p, "name")?;
        if !valid_name(name) {
            return Err(EngineError::validation(format!(
                "invalid defined name '{name}'"
            )));
        }
        if self.doc.names.len() >= MAX_NAMES {
            return Err(EngineError::out_of_bounds(format!(
                "named range limit of {MAX_NAMES} reached"
            )));
        }
        if self.find_name(name).is_some() {
            return Err(EngineError::validation(format!(
                "name '{name}' already exists"
            )));
        }
        let coords = parse_refers_to(Self::str_field(p, "refers_to")?)?;
        let sheet = self.resolve_name_sheet(p, None)?;
        let entry = NamedRange {
            name: name.to_string(),
            sheet,
            refers_to: canonical_refers_to(coords),
        };
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.names.push(entry);
        let out = self.name_json(&self.doc.names[self.doc.names.len() - 1]);
        Ok(Self::changed(json!({ "name": out })))
    }

    pub(super) fn op_update_name(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let name = Self::str_field(p, "name")?;
        let idx = self
            .find_name(name)
            .ok_or_else(|| EngineError::not_found(format!("no name '{name}'")))?;
        let has_sheet = p.get("sheet").is_some_and(|v| !v.is_null());
        // `refers_to: null` counts as absent (same convention as `sheet`):
        // alone it fails the at-least-one-field check below, alongside a
        // real field it is ignored.
        let has_refers = p.get("refers_to").is_some_and(|v| !v.is_null());
        if !has_sheet && !has_refers {
            return Err(EngineError::validation(
                "updateName requires 'sheet' and/or 'refers_to'",
            ));
        }
        let existing = self.doc.names[idx].clone();
        let sheet = self.resolve_name_sheet(p, Some(&existing))?;
        let refers_to = match p.get("refers_to") {
            Some(Value::Null) | None => existing.refers_to.clone(),
            Some(v) => {
                let v = v
                    .as_str()
                    .ok_or_else(|| EngineError::invalid("'refers_to' must be a string"))?;
                canonical_refers_to(parse_refers_to(v)?)
            }
        };
        if sheet == existing.sheet && refers_to == existing.refers_to {
            return Ok(Self::readonly(json!({ "ok": true })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.names[idx] = NamedRange {
            name: existing.name,
            sheet,
            refers_to,
        };
        let out = self.name_json(&self.doc.names[idx]);
        Ok(Self::changed(json!({ "name": out })))
    }

    pub(super) fn op_remove_name(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let name = Self::str_field(p, "name")?;
        let idx = self
            .find_name(name)
            .ok_or_else(|| EngineError::not_found(format!("no name '{name}'")))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.names.remove(idx);
        Ok(Self::changed(json!({ "ok": true })))
    }

    pub(super) fn op_list_names(&self) -> Result<CommandResult, EngineError> {
        let names: Vec<Value> = self.doc.names.iter().map(|n| self.name_json(n)).collect();
        Ok(Self::readonly(json!({ "names": names })))
    }

    pub(super) fn op_function_catalog(&self) -> Result<CommandResult, EngineError> {
        let functions: Vec<Value> = formula::FUNCTION_CATALOG
            .iter()
            .map(|f| {
                json!({
                    "name": f.name,
                    "min_args": f.min_args,
                    "max_args": f.max_args,
                    "signature": f.signature,
                })
            })
            .collect();
        Ok(Self::readonly(json!({ "functions": functions })))
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
    fn names(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "listNames", json!({}))["names"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn name_validation_subset() {
        for ok in [
            "MyRange",
            "_x",
            "ab_c9",
            "Q1_sales",
            "R2D2",
            "Revenue",
            "data_2024",
        ] {
            assert!(valid_name(ok), "{ok} should be valid");
        }
        for bad in [
            "",
            "A1",
            "a1",
            "ZZZ999",
            // Ref-shaped in the tokenizer's sense even outside grid bounds —
            // these would lex as `Ref` and evaluate to `#REF!`.
            "A0",
            "ZZZZZZZZ1",
            "XFD1048576",
            // `.` is not a word character: `=a.b` fails lexing.
            "a.b",
            // Function-catalog names are reserved (bare `=SUM` would resolve
            // the name while `=SUM(...)` calls the function).
            "SUM",
            "sum",
            "CountIf",
            "$A$1",
            "R1C1",
            "r1c1",
            "C1",
            "R1",
            "R",
            "C",
            "TRUE",
            "false",
            "has space",
            "hy-phen",
            "uni☃",
            &"x".repeat(65),
            "9lives",
            ".dot",
        ] {
            assert!(!valid_name(bad), "{bad} should be invalid");
        }
    }

    #[test]
    fn refers_to_parse_and_canonicalize() {
        assert_eq!(parse_refers_to("A1").unwrap(), (0, 0, 0, 0));
        assert_eq!(parse_refers_to("b2:a1").unwrap(), (0, 0, 1, 1));
        assert_eq!(parse_refers_to("$C$3:D4").unwrap(), (2, 2, 3, 3));
        assert_eq!(canonical_refers_to((0, 0, 0, 0)), "A1");
        assert_eq!(canonical_refers_to((0, 0, 1, 1)), "A1:B2");
        for bad in ["", "A", "1A", "A0", "A1048577", "A:XFD", "A1:B2:C3", "A1:"] {
            assert!(parse_refers_to(bad).is_err(), "{bad} should fail");
        }
        assert_eq!(
            parse_refers_to("A1048577").unwrap_err().code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn define_list_update_remove_roundtrip() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"B2","value":"5"}));
        let r = data(
            &mut e,
            "defineName",
            json!({"name":"MyRange","refers_to":"b2:a1","sheet":"Sheet1"}),
        );
        assert_eq!(
            r["name"],
            json!({"name":"MyRange","sheet":"Sheet1","sheet_id":0,"refers_to":"A1:B2"})
        );
        assert_eq!(
            names(&mut e),
            vec![json!({"name":"MyRange","sheet":"Sheet1","sheet_id":0,"refers_to":"A1:B2"})]
        );
        // Case-insensitive lookup; update refers_to and retarget sheet.
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(
            &mut e,
            "updateName",
            json!({"name":"myrange","refers_to":"B2","sheet":"Data"}),
        );
        assert_eq!(
            names(&mut e)[0],
            json!({"name":"MyRange","sheet":"Data","sheet_id":1,"refers_to":"B2"})
        );
        // Same-value update is a silent no-op.
        let noop = apply(
            &mut e,
            "updateName",
            json!({"name":"MyRange","refers_to":"B2","sheet":1}),
        );
        assert!(noop.events.is_empty());
        data(&mut e, "removeName", json!({"name":"MYRANGE"}));
        assert!(names(&mut e).is_empty());
        assert_eq!(
            apply_err(&mut e, "removeName", json!({"name":"MyRange"})).code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn define_name_validation_and_atomicity() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        for (p, code) in [
            (json!({"name":"A1","refers_to":"A1"}), ErrorCode::Validation),
            (
                json!({"name":"has space","refers_to":"A1"}),
                ErrorCode::Validation,
            ),
            (
                json!({"name":"Ok","refers_to":"A1:B2:C3"}),
                ErrorCode::Validation,
            ),
            (
                json!({"name":"Ok","refers_to":"A1:XFD1048577"}),
                ErrorCode::OutOfBounds,
            ),
            (
                json!({"name":"Ok","refers_to":"A1","sheet":"Missing"}),
                ErrorCode::NotFound,
            ),
            (json!({"refers_to":"A1"}), ErrorCode::InvalidCommand),
        ] {
            assert_eq!(apply_err(&mut e, "defineName", p).code, code);
        }
        assert_eq!(e.snapshot().unwrap(), before);
        data(
            &mut e,
            "defineName",
            json!({"name":"First","refers_to":"A1"}),
        );
        assert_eq!(
            apply_err(
                &mut e,
                "defineName",
                json!({"name":"FIRST","refers_to":"B2"})
            )
            .code,
            ErrorCode::Validation
        );
        assert_eq!(
            apply_err(&mut e, "updateName", json!({"name":"First"})).code,
            ErrorCode::Validation
        );
        // `refers_to: null` counts as absent: alone it is a validation
        // error; alongside a real field it is ignored.
        assert_eq!(
            apply_err(
                &mut e,
                "updateName",
                json!({"name":"First","refers_to":null})
            )
            .code,
            ErrorCode::Validation
        );
        let r = apply(
            &mut e,
            "updateName",
            json!({"name":"First","sheet":0,"refers_to":null}),
        );
        assert!(r.events.is_empty());
        assert_eq!(
            apply_err(
                &mut e,
                "updateName",
                json!({"name":"Nope","refers_to":"A1"})
            )
            .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn name_ops_undo_redo_and_snapshot_roundtrip() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"2"}));
        data(&mut e, "setCell", json!({"addr":"A2","value":"3"}));
        data(
            &mut e,
            "defineName",
            json!({"name":"Vals","refers_to":"A1:A2"}),
        );
        data(
            &mut e,
            "updateName",
            json!({"name":"Vals","refers_to":"A1:B2"}),
        );
        let saved = e.snapshot().unwrap();
        // Wrapped payload: names are durable post-release state.
        let payload: Value = serde_json::from_slice(decode_envelope(&saved).unwrap().1).unwrap();
        assert_eq!(payload["kind"], json!("tally"));
        assert_eq!(payload["schema"], json!(1));
        assert!(payload["document"]["names"].is_array());
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), saved);
        assert_eq!(names(&mut reopened).len(), 1);
        // Undo update → back to A1:A2; undo define → empty; redo both.
        assert!(e.undo().unwrap());
        assert_eq!(names(&mut e)[0]["refers_to"], json!("A1:A2"));
        assert!(e.undo().unwrap());
        assert!(names(&mut e).is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(names(&mut e)[0]["refers_to"], json!("A1:A2"));
        assert!(e.redo().unwrap());
        assert_eq!(names(&mut e)[0]["refers_to"], json!("A1:B2"));
        // removeName undo/redo.
        data(&mut e, "removeName", json!({"name":"Vals"}));
        assert!(names(&mut e).is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(names(&mut e)[0]["name"], json!("Vals"));
        assert!(e.redo().unwrap());
        assert!(names(&mut e).is_empty());
    }

    #[test]
    fn names_resolve_in_formulas() {
        let mut e = TallyEngine::new();
        data(&mut e, "setCell", json!({"addr":"A1","value":"2"}));
        data(&mut e, "setCell", json!({"addr":"A2","value":"3"}));
        data(&mut e, "setCell", json!({"addr":"B1","value":"4"}));
        data(
            &mut e,
            "defineName",
            json!({"name":"Vals","refers_to":"A1:B2"}),
        );
        data(
            &mut e,
            "defineName",
            json!({"name":"TopLeft","refers_to":"A1"}),
        );
        // Case-insensitive; range name feeds aggregates, cell name feeds scalars.
        data(&mut e, "setCell", json!({"addr":"C1","value":"=sum(vals)"}));
        assert_eq!(
            data(&mut e, "getCell", json!({"addr":"C1"}))["computed"],
            json!(9.0)
        );
        data(
            &mut e,
            "setCell",
            json!({"addr":"C2","value":"=topleft*10"}),
        );
        assert_eq!(
            data(&mut e, "getCell", json!({"addr":"C2"}))["computed"],
            json!(20.0)
        );
        // Ad-hoc evaluate resolves names too; COUNTIF accepts a name range.
        data(&mut e, "setCell", json!({"addr":"D1","value":"x"}));
        data(&mut e, "setCell", json!({"addr":"D2","value":"y"}));
        data(
            &mut e,
            "defineName",
            json!({"name":"Letters","refers_to":"D1:D2"}),
        );
        assert_eq!(
            data(
                &mut e,
                "evaluate",
                json!({"formula":"=COUNTIF(Letters,\"x\")"})
            )["value"],
            json!(1.0)
        );
        // A name bound to another sheet does not resolve here.
        data(&mut e, "addSheet", json!({"name":"Other"}));
        data(
            &mut e,
            "defineName",
            json!({"name":"Elsewhere","sheet":"Other","refers_to":"A1"}),
        );
        data(&mut e, "setActive", json!({"sheet":"Sheet1"}));
        assert_eq!(
            data(&mut e, "evaluate", json!({"formula":"=Elsewhere"}))["value"],
            json!("#NAME?")
        );
        // Removing the name turns formulas back into #NAME? (live evaluation).
        data(&mut e, "removeName", json!({"name":"Vals"}));
        assert_eq!(
            data(&mut e, "getCell", json!({"addr":"C1"}))["computed"],
            json!("#NAME?")
        );
    }

    #[test]
    fn remove_sheet_cascades_names_and_undo_restores() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(
            &mut e,
            "defineName",
            json!({"name":"OnData","sheet":"Data","refers_to":"A1:B2"}),
        );
        data(
            &mut e,
            "defineName",
            json!({"name":"OnMain","refers_to":"C3"}),
        );
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert_eq!(names(&mut e).len(), 1);
        assert_eq!(names(&mut e)[0]["name"], json!("OnMain"));
        assert!(e.undo().unwrap());
        assert_eq!(names(&mut e).len(), 2);
        assert!(e.redo().unwrap());
        assert_eq!(names(&mut e).len(), 1);
    }

    #[test]
    fn hostile_restore_rejects_bad_names_atomically() {
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "defineName",
            json!({"name":"Good","refers_to":"A1"}),
        );
        let saved = e.snapshot().unwrap();
        let mut doc: Value = serde_json::from_slice(decode_envelope(&saved).unwrap().1).unwrap();
        let before = e.snapshot().unwrap();
        let mut bad = doc.clone();
        bad["document"]["names"][0]["name"] = json!("A1");
        let bytes = encode_envelope(&serde_json::to_vec(&bad).unwrap());
        assert!(e.restore(&bytes).is_err());
        assert_eq!(e.snapshot().unwrap(), before);

        let mut bad = doc.clone();
        bad["document"]["names"][0]["refers_to"] = json!("A1048577");
        let bytes = encode_envelope(&serde_json::to_vec(&bad).unwrap());
        assert!(e.restore(&bytes).is_err());
        assert_eq!(e.snapshot().unwrap(), before);

        let mut bad = doc.clone();
        bad["document"]["names"][0]["sheet"] = json!(99);
        let bytes = encode_envelope(&serde_json::to_vec(&bad).unwrap());
        assert!(e.restore(&bytes).is_err());
        assert_eq!(e.snapshot().unwrap(), before);

        // Case-insensitive duplicate name.
        let mut bad = doc.clone();
        bad["document"]["names"]
            .as_array_mut()
            .unwrap()
            .push(json!({"name":"good","sheet":0,"refers_to":"B2"}));
        let bytes = encode_envelope(&serde_json::to_vec(&bad).unwrap());
        assert!(e.restore(&bytes).is_err());
        assert_eq!(e.snapshot().unwrap(), before);

        // Over the name-count bound.
        let mut bad = doc.clone();
        bad["document"]["names"] = Value::Array(
            (0..=MAX_NAMES)
                .map(|i| json!({"name":format!("nm_{i}"),"sheet":0,"refers_to":"A1"}))
                .collect(),
        );
        let bytes = encode_envelope(&serde_json::to_vec(&bad).unwrap());
        assert!(e.restore(&bytes).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        // refers_to is re-canonicalized on restore (reversed endpoints fix up).
        doc["document"]["names"][0]["refers_to"] = json!("B2:A1");
        e.restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap()))
            .unwrap();
        assert_eq!(names(&mut e)[0]["refers_to"], json!("A1:B2"));
    }

    #[test]
    fn function_catalog_is_read_only_and_bounded() {
        let mut e = TallyEngine::new();
        let r = apply(&mut e, "functionCatalog", json!({}));
        assert!(r.events.is_empty());
        let fns = r.data["functions"].as_array().unwrap();
        let names: std::collections::BTreeSet<_> =
            fns.iter().map(|f| f["name"].as_str().unwrap()).collect();
        for expected in [
            "SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "COUNTIF", "SUMIF", "IF", "ROUND",
            "ABS", "CONCAT", "TRUE", "FALSE",
        ] {
            assert!(names.contains(expected), "missing {expected}");
        }
        assert_eq!(fns.len(), formula::FUNCTION_CATALOG.len());
        let sumif = fns.iter().find(|f| f["name"] == "SUMIF").unwrap();
        assert_eq!(sumif["min_args"], json!(2));
        assert_eq!(sumif["max_args"], json!(3));
        let sum = fns.iter().find(|f| f["name"] == "SUM").unwrap();
        assert_eq!(sum["max_args"], Value::Null);
        // Read-only: no journal entry, redo history untouched.
        assert!(!e.undo().unwrap());
    }
}
