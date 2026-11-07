//! Atomic row sort: `sortRange` reorders whole rows inside a rectangle by
//! computed key-cell values.
//!
//! Semantics (documented for reviewers):
//! * The range is a rectangle; **rows** within it are permuted, never
//!   deleted or duplicated. Every column of the range moves together, so a
//!   row's cells stay on the same row relative to each other. Cells outside
//!   the range — including other columns of the same sheet rows — are
//!   untouched, and so are `formats` (address-keyed display metadata that
//!   does not move with contents, like a paste of raw text).
//! * `has_header:true` treats the range's first row as a header: it stays
//!   in place and only the remaining rows are permuted.
//! * Keys are `{column:"B"}` (column letter inside the range) or
//!   `{offset:n}` (0-based column offset from the range's left edge), plus
//!   optional `ascending` (default `true`). Up to `MAX_SORT_KEYS` keys;
//!   earlier keys dominate, later keys break ties, and the sort is **stable**
//!   — rows equal on every key keep their original order.
//! * Sort keys compare **computed** cell values (formulas included), not
//!   raw text. The documented total order groups values by class —
//!   empty < finite number < text < boolean < error — and the class order
//!   is **fixed in both directions** (descending never promotes booleans
//!   above numbers or empties above numbers). Within a class: numbers
//!   compare numerically (`partial_cmp`), text compares by Unicode
//!   `to_lowercase()` then byte order — the same collation the formula
//!   `=`/`<` comparisons use, not a locale-aware collation — booleans
//!   `false < true`. Error values (`#DIV/0!`, `#CYCLE!`, non-finite
//!   numbers, anything non-scalar) always sort **last in both
//!   directions**; equal errors fall through to the next key.
//!   `ascending:false` inverts only the within-class comparison.
//! * **Formula-reference behavior (the honest subset): formulas move
//!   verbatim.** A cell's raw text — including `=A1` references — is copied
//!   to its new row *without* `shift_references` rewriting. After a sort,
//!   `=A1` still points at address `A1`, which may now hold a different
//!   row's content. This differs from Excel (which adjusts references on
//!   sort) and is deliberate: rewriting every reference would need the
//!   full dependency graph, and verbatim moves are predictable, atomic and
//!   undoable. Hosts that need Excel-style reference adjustment must not
//!   rely on `sortRange` for it.
//! * Atomicity: everything is validated and staged before mutation; any
//!   error leaves the document untouched. Changed cells record one undo
//!   entry against the **resolved target sheet** (payload `sheet`, name or
//!   index, default active) via `commit_cells_on_sheet` — prior-value
//!   lookup, the undo entry's sheet id and the mutation all follow that
//!   sheet, so sorting a non-active sheet never reads from or writes to
//!   the active one — and `document:changed` emits once.
//! * Work bound: each key-cell evaluation and each key-level comparison
//!   charges one unit of the evaluator's shared 1,000,000-step conditional
//!   allowance (`Evaluator::charge_work`) **as it runs** — comparisons
//!   spend through the evaluator inside the sort comparator, so allowance
//!   exhaustion aborts the op before any mutation (fail-closed; the
//!   `#NUM!` exhaustion maps to a validation error). Duplicate resolved
//!   key columns are dropped before evaluation — a later key on a column
//!   an earlier key already decided can never change the outcome — and
//!   text keys are lowercased once at evaluation time, not per
//!   comparison. Because effective keys never exceed the range width and
//!   `rows × width ≤ 16,384` cells, the worst case — roughly
//!   `n·⌈log₂n⌉` row comparisons × `width` key examinations, at most
//!   ~229k units for a single-column 16,384-row range — stays far under
//!   the allowance; charging during the sort remains the fail-closed
//!   defense if that bound is ever wrong.
//!
//! Protection: `sortRange` mutates cells, so it is guarded by the target
//! sheet exactly like `setRange` (payload `sheet`, default active).
use super::filter_ops::column_index;
use super::range_ops::Rect;
use super::*;
use std::cmp::Ordering;

/// Maximum sort keys per `sortRange` call.
pub const MAX_SORT_KEYS: usize = 16;

/// A key-cell value normalized once at evaluation time. Text arrives
/// already `to_lowercase()`d — the collation `cmp_in_class` applies — so
/// comparisons never re-allocate, and every non-scalar (errors,
/// non-finite numbers, lists) collapses to `Err`, which always sorts last
/// in both directions.
enum SortKeyVal {
    Empty,
    Num(f64),
    Text(String),
    Bool(bool),
    Err,
}

fn sort_val(v: &formula::Value) -> SortKeyVal {
    match v {
        formula::Value::Empty => SortKeyVal::Empty,
        formula::Value::Num(n) if n.is_finite() => SortKeyVal::Num(*n),
        formula::Value::Str(s) => SortKeyVal::Text(s.to_lowercase()),
        formula::Value::Bool(b) => SortKeyVal::Bool(*b),
        _ => SortKeyVal::Err,
    }
}

/// Rank of a computed value for sorting. Errors (and anything that cannot
/// produce a scalar — non-finite numbers, lists) share the top rank so they
/// always sort last regardless of direction.
fn rank(v: &SortKeyVal) -> u8 {
    match v {
        SortKeyVal::Empty => 0,
        SortKeyVal::Num(_) => 1,
        SortKeyVal::Text(_) => 2,
        SortKeyVal::Bool(_) => 3,
        SortKeyVal::Err => 4,
    }
}

/// In-class comparison for two same-rank, non-error values. Text is
/// pre-lowercased, so this is a plain byte-order compare.
fn cmp_in_class(a: &SortKeyVal, b: &SortKeyVal) -> Ordering {
    match (a, b) {
        (SortKeyVal::Num(x), SortKeyVal::Num(y)) => {
            x.partial_cmp(y).unwrap_or(Ordering::Equal)
        }
        (SortKeyVal::Text(x), SortKeyVal::Text(y)) => x.cmp(y),
        (SortKeyVal::Bool(x), SortKeyVal::Bool(y)) => x.cmp(y),
        _ => Ordering::Equal,
    }
}

/// Compare two rows' key values, charging the shared conditional
/// allowance through `ev` **per key examined** so work is spent during
/// the sort, not accounted after it. Returns `Ordering::Greater` whenever
/// `a` must sort after `b`; `Err(())` reports allowance exhaustion (the
/// `#NUM!` error value). Class rank is never inverted (errors always
/// last); `ascending` inverts only the within-class comparison.
fn cmp_rows(
    a: &[SortKeyVal],
    b: &[SortKeyVal],
    asc: &[bool],
    ev: &mut Evaluator<'_, Sheet>,
) -> Result<Ordering, ()> {
    for ((va, vb), &ascending) in a.iter().zip(b.iter()).zip(asc.iter()) {
        ev.charge_work(1).map_err(|_| ())?;
        let ra = rank(va);
        let rb = rank(vb);
        if ra != rb {
            return Ok(ra.cmp(&rb));
        }
        if ra == 4 {
            continue; // both errors: fall through to the next key
        }
        let ord = cmp_in_class(va, vb);
        if ord != Ordering::Equal {
            return Ok(if ascending { ord } else { ord.reverse() });
        }
    }
    Ok(Ordering::Equal)
}

/// One parsed sort key: absolute 0-based column plus direction.
struct SortKey {
    col: u32,
    ascending: bool,
}

impl TallyEngine {
    /// `sortRange {sheet?, range:{from,to}, keys:[{column|offset,
    /// ascending?}], has_header?}` — stable row permutation by computed
    /// key values; see module docs for the documented semantics.
    pub(super) fn op_sort_range(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let rect = Rect::read(Self::field(p, "range")?)?;
        let (c0, r0, c1, r1) = rect.coords();
        let width = c1 - c0 + 1;
        let idx = self.sheet_index(p)?;
        let raw_keys = Self::field(p, "keys")?
            .as_array()
            .ok_or_else(|| EngineError::invalid("'keys' must be an array"))?;
        if raw_keys.is_empty() {
            return Err(EngineError::validation("'keys' must be nonempty"));
        }
        if raw_keys.len() > MAX_SORT_KEYS {
            return Err(EngineError::out_of_bounds(format!(
                "sort key limit of {MAX_SORT_KEYS} exceeded"
            )));
        }
        let mut keys = Vec::with_capacity(raw_keys.len());
        for k in raw_keys {
            let has_col = k.get("column").is_some_and(|v| !v.is_null());
            let has_off = k.get("offset").is_some_and(|v| !v.is_null());
            if has_col == has_off {
                return Err(EngineError::invalid(
                    "each sort key needs exactly one of 'column' or 'offset'",
                ));
            }
            let col = if has_col {
                let letters = k
                    .get("column")
                    .and_then(Value::as_str)
                    .ok_or_else(|| EngineError::invalid("'column' must be a column letter"))?;
                let c = column_index(letters)
                    .ok_or_else(|| EngineError::validation(format!("invalid column '{letters}'")))?;
                if c < c0 || c > c1 {
                    return Err(EngineError::validation(
                        "sort key column must lie inside the sort range",
                    ));
                }
                c
            } else {
                let off = k
                    .get("offset")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| EngineError::invalid("'offset' must be a non-negative integer"))?;
                if off >= u64::from(width) {
                    return Err(EngineError::validation(
                        "sort key offset must lie inside the sort range",
                    ));
                }
                c0 + off as u32
            };
            let ascending = match k.get("ascending") {
                None | Some(Value::Null) => true,
                Some(v) => v
                    .as_bool()
                    .ok_or_else(|| EngineError::invalid("'ascending' must be a boolean"))?,
            };
            keys.push(SortKey { col, ascending });
        }
        // A later key on an already-resolved column is semantically inert:
        // the first key on that column decides whenever the values differ,
        // and equal values make every same-column key compare Equal. Drop
        // duplicates (first occurrence wins, direction included) so the
        // effective key count — and its per-comparison work charge —
        // reflects what the sort actually examines.
        let mut seen_cols = std::collections::HashSet::new();
        keys.retain(|key| seen_cols.insert(key.col));
        let has_header = match p.get("has_header") {
            None | Some(Value::Null) => false,
            Some(v) => v
                .as_bool()
                .ok_or_else(|| EngineError::invalid("'has_header' must be a boolean"))?,
        };
        let height = r1 - r0 + 1;
        let (data_r0, data_rows) = if has_header && height > 1 {
            (r0 + 1, height - 1)
        } else {
            (r0, height)
        };
        if data_rows < 2 {
            return Ok(Self::readonly(json!({ "changed": 0, "sorted_rows": 0 })));
        }
        let n = data_rows as usize;
        let k = keys.len();
        let asc: Vec<bool> = keys.iter().map(|key| key.ascending).collect();
        // Evaluate every key cell once against the pre-sort state, normalize
        // each to a `SortKeyVal` (text lowercased once here, not per
        // comparison), and stage the permutation; nothing mutates until
        // `commit_cells_on_sheet`.
        let staged = {
            let mut ev = self.evaluator_for(idx);
            let mut keyvals: Vec<Vec<SortKeyVal>> = Vec::with_capacity(n);
            for i in 0..n {
                let row = data_r0 + i as u32;
                let mut vals = Vec::with_capacity(k);
                for key in &keys {
                    if ev.charge_work(1).is_err() {
                        return Err(EngineError::validation(
                            "sort evaluation exceeded the work allowance",
                        ));
                    }
                    vals.push(sort_val(&ev.eval_cell(&fmt_addr(key.col, row))));
                }
                keyvals.push(vals);
            }
            // Stable permutation: `sort_by` keeps original order on ties.
            // `sort_by` cannot return errors, so the comparator spends the
            // shared allowance *during* the sort through `ev` — one unit
            // per key examined — and the first exhaustion flags
            // `exhausted`, after which comparisons short-circuit to Equal;
            // the op then rejects before any mutation.
            let mut order: Vec<usize> = (0..n).collect();
            let mut exhausted = false;
            order.sort_by(|&a, &b| {
                if exhausted {
                    return Ordering::Equal;
                }
                match cmp_rows(&keyvals[a], &keyvals[b], &asc, &mut ev) {
                    Ok(ord) => ord,
                    Err(()) => {
                        exhausted = true;
                        Ordering::Equal
                    }
                }
            });
            if exhausted {
                return Err(EngineError::validation(
                    "sort comparison exceeded the work allowance",
                ));
            }
            // Stage the permutation: destination row `data_r0 + p` receives
            // the raw contents of source row `data_r0 + order[p]`, verbatim
            // (no reference rewriting — see module docs).
            let sheet = &self.doc.sheets[idx];
            let mut staged = Vec::with_capacity(width as usize * n);
            for (p, &src) in order.iter().enumerate() {
                let src_row = data_r0 + src as u32;
                let dst_row = data_r0 + p as u32;
                for c in c0..=c1 {
                    let raw = sheet
                        .cells
                        .get(&fmt_addr(c, src_row))
                        .map(|cell| cell.raw.clone())
                        .unwrap_or_default();
                    staged.push((fmt_addr(c, dst_row), raw));
                }
            }
            staged
        };
        // Commit against the resolved target sheet (`idx`), not the active
        // sheet: `sheet_index` already validated the payload's `sheet`, and
        // `check_protection` guarded that same sheet.
        let mut result = self.commit_cells_on_sheet(idx, staged);
        if let Value::Object(map) = &mut result.data {
            map.insert("sorted_rows".to_string(), json!(n));
        }
        Ok(result)
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
    fn raw(e: &mut TallyEngine, addr: &str) -> Value {
        data(e, "getCell", json!({"addr": addr}))["raw"].clone()
    }
    fn raws(e: &mut TallyEngine, col: u32, rows: u32) -> Vec<String> {
        (0..rows)
            .map(|r| {
                raw(e, &fmt_addr(col, r))
                    .as_str()
                    .unwrap_or("")
                    .to_string()
            })
            .collect()
    }

    /// Column A rows 1..=n get the given raw values.
    fn seed_col(e: &mut TallyEngine, rows: &[&str]) {
        for (i, v) in rows.iter().enumerate() {
            data(
                e,
                "setCell",
                json!({"addr": fmt_addr(0, i as u32), "value": v}),
            );
        }
    }

    fn sort(e: &mut TallyEngine, keys: Value) -> Value {
        data(
            e,
            "sortRange",
            json!({"range":{"from":"A1","to":"A9"},"keys":keys}),
        )
    }

    #[test]
    fn class_order_ties_and_descending() {
        let mut e = TallyEngine::new();
        seed_col(
            &mut e,
            &[
                "30", "apple", "=1/0", "10", "", "=2+3", "=TRUE", "5", "banana",
            ],
        );
        // Ascending: empty, numbers (stable 5-tie: "=2+3" row6 before
        // "5" row8), text (lowercase collation), boolean, error last.
        sort(&mut e, json!([{"offset":0}]));
        assert_eq!(
            raws(&mut e, 0, 9),
            vec![
                "", "=2+3", "5", "10", "30", "apple", "banana", "=TRUE", "=1/0"
            ]
        );
        // Descending inverts within-class order only: class order (empty,
        // number, text, boolean, error) and error-last are unchanged, and
        // the 5-tie keeps stable order.
        sort(&mut e, json!([{"offset":0, "ascending": false}]));
        assert_eq!(
            raws(&mut e, 0, 9),
            vec![
                "", "30", "10", "=2+3", "5", "banana", "apple", "=TRUE", "=1/0"
            ]
        );
    }

    #[test]
    fn multi_key_ties_and_header() {
        let mut e = TallyEngine::new();
        // Two columns: A = group, B = value.
        let rows: [(&str, &str); 4] = [("b", "2"), ("a", "9"), ("b", "1"), ("a", "5")];
        for (i, (a, b)) in rows.iter().enumerate() {
            data(&mut e, "setCell", json!({"addr": fmt_addr(0, i as u32), "value": a}));
            data(&mut e, "setCell", json!({"addr": fmt_addr(1, i as u32), "value": b}));
        }
        // Sort A1:B4 by A asc then B desc.
        data(
            &mut e,
            "sortRange",
            json!({"range":{"from":"A1","to":"B4"},
                   "keys":[{"column":"A"},{"column":"B","ascending":false}]}),
        );
        assert_eq!(raws(&mut e, 0, 4), vec!["a", "a", "b", "b"]);
        assert_eq!(raws(&mut e, 1, 4), vec!["9", "5", "2", "1"]);

        // Header row stays put.
        let mut e2 = TallyEngine::new();
        for (i, v) in ["name", "c", "a", "b"].iter().enumerate() {
            data(&mut e2, "setCell", json!({"addr": fmt_addr(0, i as u32), "value": v}));
        }
        data(
            &mut e2,
            "sortRange",
            json!({"range":{"from":"A1","to":"A4"},"keys":[{"offset":0}],"has_header":true}),
        );
        assert_eq!(raw(&mut e2, "A1"), json!("name"));
        assert_eq!(raws(&mut e2, 0, 4), vec!["name", "a", "b", "c"]);
    }

    #[test]
    fn formulas_move_verbatim_without_ref_rewriting() {
        let mut e = TallyEngine::new();
        // B-column formulas reference A-column cells; after sorting the
        // range the formula text must be unchanged (still "=A1"/"=A2"),
        // now evaluating against the new occupants of those addresses.
        data(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        data(&mut e, "setCell", json!({"addr":"A2","value":"3"}));
        data(&mut e, "setCell", json!({"addr":"B1","value":"=A1"}));
        data(&mut e, "setCell", json!({"addr":"B2","value":"=A2"}));
        data(
            &mut e,
            "sortRange",
            json!({"range":{"from":"A1","to":"B2"},"keys":[{"column":"A","ascending":false}]}),
        );
        // Row order swapped by the A key (3 before 1): the whole row —
        // A and B cells — moved together; formulas moved verbatim.
        assert_eq!(raw(&mut e, "A1"), json!("3"));
        assert_eq!(raw(&mut e, "A2"), json!("1"));
        assert_eq!(raw(&mut e, "B1"), json!("=A2")); // was row 2's formula
        assert_eq!(raw(&mut e, "B2"), json!("=A1")); // was row 1's formula
        // The moved "=A2" now reads the new A2 (1), not its old value 3 —
        // verbatim moves do not rewrite references (module docs).
        assert_eq!(
            data(&mut e, "getCell", json!({"addr":"B1"}))["computed"],
            json!(1.0)
        );
    }

    #[test]
    fn undo_redo_restore_prior_order() {
        let mut e = TallyEngine::new();
        seed_col(&mut e, &["3", "1", "2"]);
        let before = e.snapshot().unwrap();
        let r = sort(&mut e, json!([{"offset":0}]));
        assert_eq!(r["sorted_rows"], json!(9));
        // Empties sort first (fixed class order): six blanks, then 1,2,3.
        assert_eq!(
            raws(&mut e, 0, 9),
            vec!["", "", "", "", "", "", "1", "2", "3"]
        );
        let after = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), after);
        // Snapshot round-trip keeps sorted state.
        let mut reopened = TallyEngine::new();
        reopened.restore(&after).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), after);
    }

    #[test]
    fn validation_is_atomic() {
        let mut e = TallyEngine::new();
        seed_col(&mut e, &["2", "1"]);
        let before = e.snapshot().unwrap();
        for p in [
            json!({"range":{"from":"A1","to":"A2"},"keys":[]}),
            json!({"range":{"from":"A1","to":"A2"}}),
            json!({"range":{"from":"A1","to":"A2"},"keys":[{"offset":0,"column":"A"}]}),
            json!({"range":{"from":"A1","to":"A2"},"keys":[{"offset":5}]}),
            json!({"range":{"from":"A1","to":"A2"},"keys":[{"column":"Z"}]}),
            json!({"range":{"from":"A1","to":"A2"},"keys":[{"offset":0,"ascending":"yes"}]}),
            json!({"range":{"from":"A1","to":"A2"},"keys":[{"offset":0}],"has_header":"yes"}),
        ] {
            assert!(e.apply(Command::new("sortRange", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Too many keys.
        let keys: Vec<Value> = (0..=MAX_SORT_KEYS)
            .map(|i| json!({"offset":0,"ascending":i % 2 == 0}))
            .collect();
        assert_eq!(
            apply_err(
                &mut e,
                "sortRange",
                json!({"range":{"from":"A1","to":"A2"},"keys":keys})
            )
            .code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn no_op_and_outside_cells_untouched() {
        let mut e = TallyEngine::new();
        // Already sorted → eventless, redo preserved.
        seed_col(&mut e, &["1", "2"]);
        data(&mut e, "setCell", json!({"addr":"Z9","value":"9"}));
        e.undo().unwrap();
        let r = apply(
            &mut e,
            "sortRange",
            json!({"range":{"from":"A1","to":"A2"},"keys":[{"offset":0}]}),
        );
        assert!(r.events.is_empty());
        assert!(e.redo().unwrap());

        // Two-column range sorts by key column only; other columns move
        // with their row, and cells outside the range stay put.
        let mut e2 = TallyEngine::new();
        for (i, (a, b)) in [("x", "1"), ("y", "2")].iter().enumerate() {
            data(&mut e2, "setCell", json!({"addr": fmt_addr(0, i as u32), "value": a}));
            data(&mut e2, "setCell", json!({"addr": fmt_addr(1, i as u32), "value": b}));
        }
        data(&mut e2, "setCell", json!({"addr":"C1","value":"keep"}));
        data(&mut e2, "setCell", json!({"addr":"C2","value":"stay"}));
        data(
            &mut e2,
            "sortRange",
            json!({"range":{"from":"A1","to":"B2"},"keys":[{"column":"B","ascending":false}]}),
        );
        assert_eq!(raw(&mut e2, "A1"), json!("y"));
        assert_eq!(raw(&mut e2, "B1"), json!("2"));
        assert_eq!(raw(&mut e2, "A2"), json!("x"));
        assert_eq!(raw(&mut e2, "B2"), json!("1"));
        assert_eq!(raw(&mut e2, "C1"), json!("keep"));
        assert_eq!(raw(&mut e2, "C2"), json!("stay"));
    }

    #[test]
    fn sort_commits_to_the_resolved_sheet_not_the_active_one() {
        let mut e = TallyEngine::new();
        // Active Sheet1 holds sentinel data that must not move.
        seed_col(&mut e, &["s1a", "s1b", "s1c", "s1d"]);
        data(&mut e, "addSheet", json!({"name":"Data"}));
        // Seed Sheet2 while it is active, then return to Sheet1.
        data(&mut e, "setActive", json!({"sheet":"Data"}));
        seed_col(&mut e, &["3", "1", "2"]);
        data(&mut e, "setActive", json!({"sheet":0}));
        let sheet1_before = e.doc.sheets[0].cells.clone();
        let sheet2_raw = |e: &TallyEngine, addr: &str| {
            e.doc.sheets[1]
                .cells
                .get(addr)
                .map(|c| c.raw.as_str())
                .unwrap_or("")
                .to_string()
        };
        let r = data(
            &mut e,
            "sortRange",
            json!({"sheet":"Data","range":{"from":"A1","to":"A3"},"keys":[{"offset":0}]}),
        );
        assert_eq!(r["sorted_rows"], json!(3));
        // Sheet2 permuted; Sheet1 byte-identical.
        assert_eq!(e.doc.sheets[0].cells, sheet1_before);
        assert_eq!(sheet2_raw(&e, "A1"), "1");
        assert_eq!(sheet2_raw(&e, "A2"), "2");
        assert_eq!(sheet2_raw(&e, "A3"), "3");
        // Undo/redo restore Sheet2's row order and still leave Sheet1 alone.
        assert!(e.undo().unwrap());
        assert_eq!(e.doc.sheets[0].cells, sheet1_before);
        assert_eq!(sheet2_raw(&e, "A1"), "3");
        assert_eq!(sheet2_raw(&e, "A2"), "1");
        assert_eq!(sheet2_raw(&e, "A3"), "2");
        assert!(e.redo().unwrap());
        assert_eq!(sheet2_raw(&e, "A1"), "1");
    }

    #[test]
    fn sort_on_unprotected_sheet_ignores_protected_active() {
        let mut e = TallyEngine::new();
        seed_col(&mut e, &["2", "1"]);
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(&mut e, "setActive", json!({"sheet":"Data"}));
        seed_col(&mut e, &["b", "a"]);
        data(&mut e, "setActive", json!({"sheet":0}));
        data(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let sheet1_before = e.doc.sheets[0].cells.clone();
        // The payload targets unprotected Sheet2: the sort must succeed
        // there even though the *active* Sheet1 is protected — the guard
        // and the mutation both follow the resolved sheet.
        let r = data(
            &mut e,
            "sortRange",
            json!({"sheet":"Data","range":{"from":"A1","to":"A2"},"keys":[{"offset":0}]}),
        );
        assert_eq!(r["sorted_rows"], json!(2));
        assert_eq!(e.doc.sheets[0].cells, sheet1_before);
        data(&mut e, "setActive", json!({"sheet":"Data"}));
        assert_eq!(raws(&mut e, 0, 2), vec!["a", "b"]);
    }

    #[test]
    fn sort_rejects_a_protected_target_sheet() {
        let mut e = TallyEngine::new();
        seed_col(&mut e, &["1", "2"]);
        data(&mut e, "addSheet", json!({"name":"Data"}));
        data(&mut e, "setActive", json!({"sheet":"Data"}));
        seed_col(&mut e, &["b", "a"]);
        data(&mut e, "protectSheet", json!({"sheet":"Data","protected":true}));
        data(&mut e, "setActive", json!({"sheet":0}));
        // Protected Sheet2 rejects even though the active Sheet1 is not.
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new(
                "sortRange",
                json!({"sheet":"Data","range":{"from":"A1","to":"A2"},"keys":[{"offset":0}]})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        // And the default (active-sheet) target still guards Sheet1.
        data(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new(
                "sortRange",
                json!({"range":{"from":"A1","to":"A2"},"keys":[{"offset":0}]})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn duplicate_key_columns_dedupe_first_wins() {
        let mut e = TallyEngine::new();
        seed_col(&mut e, &["b", "a", "c"]);
        // The second key resolves to the same column as the first; it is
        // inert, so the first key's ascending direction decides — the
        // result is ascending, not the duplicate's descending.
        sort(&mut e, json!([{"offset":0},{"column":"A","ascending":false}]));
        assert_eq!(
            raws(&mut e, 0, 9),
            vec!["", "", "", "", "", "", "a", "b", "c"]
        );
    }
}
