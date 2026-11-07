//! Atomic range writes: validate and stage everything before recording undo.
use super::*;
use formula::{SHEET_MAX_COLUMNS, SHEET_MAX_ROWS};

fn off_sheet() -> EngineError {
    EngineError::out_of_bounds("range extends past the sheet (XFD1048576)")
}

#[derive(Clone, Copy)]
pub(super) struct Rect {
    c0: u32,
    r0: u32,
    c1: u32,
    r1: u32,
}
impl Rect {
    pub(super) fn read(p: &Value) -> Result<Self, EngineError> {
        let (c0, r0) = TallyEngine::addr_coords(p, "from")?;
        let (c1, r1) = TallyEngine::addr_coords(p, "to")?;
        let rect = Self {
            c0: c0.min(c1),
            r0: r0.min(r1),
            c1: c0.max(c1),
            r1: r0.max(r1),
        };
        if rect.c1 >= SHEET_MAX_COLUMNS || rect.r1 >= SHEET_MAX_ROWS {
            return Err(off_sheet());
        }
        let count =
            (u64::from(rect.c1 - rect.c0) + 1).saturating_mul(u64::from(rect.r1 - rect.r0) + 1);
        if count > MAX_GET_RANGE_CELLS {
            return Err(EngineError::out_of_bounds("range exceeds 16384 cells"));
        }
        Ok(rect)
    }
    fn contains(self, c: u32, r: u32) -> bool {
        c >= self.c0 && c <= self.c1 && r >= self.r0 && r <= self.r1
    }
    /// Canonical "A1" addresses of every cell in the rectangle, row-major.
    /// `read` caps the count at `MAX_GET_RANGE_CELLS`.
    pub(super) fn addrs(self) -> Vec<String> {
        let mut out = Vec::with_capacity(
            ((u64::from(self.c1 - self.c0) + 1) * (u64::from(self.r1 - self.r0) + 1)) as usize,
        );
        for r in self.r0..=self.r1 {
            for c in self.c0..=self.c1 {
                out.push(fmt_addr(c, r));
            }
        }
        out
    }
}

impl TallyEngine {
    fn commit_cells(&mut self, staged: Vec<(String, String)>) -> CommandResult {
        let staged: Vec<_> = staged
            .into_iter()
            .filter(|(addr, raw)| {
                self.active_sheet()
                    .cells
                    .get(addr)
                    .map(|cell| cell.raw.as_str())
                    .unwrap_or("")
                    != raw
            })
            .collect();
        let count = staged.len();
        if count == 0 {
            return Self::readonly(json!({"changed":0}));
        }
        let cells = staged
            .iter()
            .map(|(addr, _)| {
                (
                    addr.clone(),
                    self.active_sheet().cells.get(addr).map(|c| c.raw.clone()),
                )
            })
            .collect();
        self.journal.record(UndoEntry::Cells {
            sheet: self.active_sheet().id,
            cells,
        });
        let sheet = self.active_sheet_mut();
        for (addr, raw) in staged {
            if raw.is_empty() {
                sheet.cells.remove(&addr);
            } else {
                sheet.cells.insert(addr, Cell { raw });
            }
        }
        Self::changed(json!({"changed":count}))
    }

    pub(super) fn op_set_range(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let (c0, r0) = Self::addr_coords(p, "from")?;
        let rows = Self::field(p, "values")?
            .as_array()
            .ok_or_else(|| EngineError::invalid("values must be a rectangular array of strings"))?;
        let width = rows
            .first()
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        if rows.is_empty() || width == 0 {
            return Err(EngineError::validation("values must be nonempty"));
        }
        if rows.len().saturating_mul(width) > MAX_GET_RANGE_CELLS as usize {
            return Err(EngineError::out_of_bounds("range exceeds 16384 cells"));
        }
        if u64::from(c0) + width as u64 > u64::from(SHEET_MAX_COLUMNS)
            || u64::from(r0) + rows.len() as u64 > u64::from(SHEET_MAX_ROWS)
        {
            return Err(off_sheet());
        }
        let mut staged = Vec::with_capacity(rows.len() * width);
        for (r, row) in rows.iter().enumerate() {
            let row = row
                .as_array()
                .filter(|row| row.len() == width)
                .ok_or_else(|| EngineError::validation("values must be rectangular"))?;
            for (c, value) in row.iter().enumerate() {
                let raw = value
                    .as_str()
                    .ok_or_else(|| EngineError::validation("range values must be strings"))?;
                staged.push((fmt_addr(c0 + c as u32, r0 + r as u32), raw.to_string()));
            }
        }
        Ok(self.commit_cells(staged))
    }

    pub(super) fn op_fill_range(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let source = Rect::read(Self::field(p, "source")?)?;
        let target = Rect::read(Self::field(p, "target")?)?;
        if !target.contains(source.c0, source.r0) || !target.contains(source.c1, source.r1) {
            return Err(EngineError::validation(
                "fill target must contain its source",
            ));
        }
        let width = i64::from(source.c1 - source.c0) + 1;
        let height = i64::from(source.r1 - source.r0) + 1;
        let mut staged = Vec::new();
        for r in target.r0..=target.r1 {
            for c in target.c0..=target.c1 {
                if source.contains(c, r) {
                    continue;
                }
                let sc = source.c0 + (i64::from(c) - i64::from(source.c0)).rem_euclid(width) as u32;
                let sr =
                    source.r0 + (i64::from(r) - i64::from(source.r0)).rem_euclid(height) as u32;
                let raw = self
                    .active_sheet()
                    .cells
                    .get(&fmt_addr(sc, sr))
                    .map(|cell| cell.raw.as_str())
                    .unwrap_or("");
                let raw = formula::shift_references(
                    raw,
                    i64::from(c) - i64::from(sc),
                    i64::from(r) - i64::from(sr),
                )
                .map_err(|_| {
                    EngineError::validation("cannot fill a formula with invalid tokens")
                })?;
                staged.push((fmt_addr(c, r), raw));
            }
        }
        Ok(self.commit_cells(staged))
    }

    /// `fillSeries {source:{from,to},target:{from,to},step?}` — linear series.
    ///
    /// The source must be a single row or a single column (a 1x1 source picks
    /// its axis from the target's one-dimensional extension). Every source
    /// cell must hold a numeric literal: raws that parse as a finite `f64`
    /// and are not formulas. Formulas, text, booleans and empty cells reject
    /// the whole op before any mutation. `step` is an optional finite JSON
    /// number; without it the step is inferred as
    /// `(last - first) / (count - 1)` along the axis, so inference needs at
    /// least two source cells. The first source cell anchors the series:
    /// `value(i) = first + step * (i - i_first)` where `i` is the column
    /// index for a row source or the row index for a column source. Target
    /// cells inside the source are skipped; every other target cell gets a
    /// literal number (via `fmt_num`), never a formula — matching how
    /// `setRange`/`fillRange` store raw strings. The target must contain the
    /// source and may not widen perpendicular to the axis. A computed value
    /// that is not finite rejects the op atomically. Date serials are not
    /// supported: series are numeric-only because `formula.rs` has no date
    /// serial helpers.
    pub(super) fn op_fill_series(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let source = Rect::read(Self::field(p, "source")?)?;
        let target = Rect::read(Self::field(p, "target")?)?;
        if !target.contains(source.c0, source.r0) || !target.contains(source.c1, source.r1) {
            return Err(EngineError::validation(
                "fill target must contain its source",
            ));
        }
        let sw = source.c1 - source.c0 + 1;
        let sh = source.r1 - source.r0 + 1;
        // `true` = horizontal (single-row source, fill along columns).
        let horizontal = if sh == 1 && sw > 1 {
            true
        } else if sw == 1 && sh > 1 {
            false
        } else if sw == 1 && sh == 1 {
            let tw = target.c1 - target.c0 + 1;
            let th = target.r1 - target.r0 + 1;
            if tw > 1 && th == 1 {
                true
            } else if th > 1 && tw == 1 {
                false
            } else {
                return Err(EngineError::validation(
                    "a single-cell series source needs a one-cell-wide or one-cell-tall target",
                ));
            }
        } else {
            return Err(EngineError::validation(
                "series source must be a single row or a single column",
            ));
        };
        // The target may extend only along the fill axis.
        if horizontal {
            if target.r0 != source.r0 || target.r1 != source.r1 {
                return Err(EngineError::validation(
                    "series target must not widen perpendicular to a row source",
                ));
            }
        } else if target.c0 != source.c0 || target.c1 != source.c1 {
            return Err(EngineError::validation(
                "series target must not widen perpendicular to a column source",
            ));
        }
        let n = if horizontal { sw } else { sh } as usize;
        let mut values = Vec::with_capacity(n);
        for i in 0..n {
            let (c, r) = if horizontal {
                (source.c0 + i as u32, source.r0)
            } else {
                (source.c0, source.r0 + i as u32)
            };
            let addr = fmt_addr(c, r);
            let raw = self
                .active_sheet()
                .cells
                .get(&addr)
                .map(|cell| cell.raw.as_str())
                .unwrap_or("");
            match raw.trim().parse::<f64>() {
                Ok(v) if v.is_finite() => values.push(v),
                _ => {
                    return Err(EngineError::validation(format!(
                        "series source cell {addr} is not a numeric literal"
                    )))
                }
            }
        }
        let step = match p.get("step") {
            None | Some(Value::Null) => {
                if n < 2 {
                    return Err(EngineError::validation(
                        "cannot infer a series step from fewer than two numeric cells; pass step",
                    ));
                }
                (values[n - 1] - values[0]) / (n as f64 - 1.0)
            }
            Some(v) => v
                .as_f64()
                .filter(|s| s.is_finite())
                .ok_or_else(|| EngineError::validation("step must be a finite number"))?,
        };
        let base_index = if horizontal {
            i64::from(source.c0)
        } else {
            i64::from(source.r0)
        };
        let mut staged = Vec::new();
        for r in target.r0..=target.r1 {
            for c in target.c0..=target.c1 {
                if source.contains(c, r) {
                    continue;
                }
                let i = if horizontal {
                    i64::from(c)
                } else {
                    i64::from(r)
                };
                let value = values[0] + step * (i - base_index) as f64;
                if !value.is_finite() {
                    return Err(EngineError::validation(
                        "series value is not finite",
                    ));
                }
                staged.push((fmt_addr(c, r), formula::fmt_num(value)));
            }
        }
        Ok(self.commit_cells(staged))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(e: &mut TallyEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn raw(e: &mut TallyEngine, addr: &str) -> Value {
        run(e, "getCell", json!({"addr":addr})).data["raw"].clone()
    }
    #[test]
    fn paste_is_atomic_and_undoable() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"B2","value":"old"}));
        let before = e.snapshot().unwrap();
        let result = run(
            &mut e,
            "setRange",
            json!({"from":"A1","values":[["2","=A1*3"],["x",""]]}),
        );
        assert_eq!(result.data["changed"], 4);
        assert_eq!(result.events.len(), 1);
        assert_eq!(
            run(&mut e, "getCell", json!({"addr":"B1"})).data["computed"],
            6.0
        );
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(raw(&mut e, "B2"), "");
        let after = e.snapshot().unwrap();
        for values in [
            json!([["ok"], ["bad", "shape"]]),
            json!([["ok", 9]]),
            json!([]),
        ] {
            assert!(e
                .apply(Command::new(
                    "setRange",
                    json!({"from":"A1","values":values})
                ))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), after);
        }
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn fill_shifts_locks_and_repeats_from_original_source() {
        let mut e = TallyEngine::new();
        run(
            &mut e,
            "setRange",
            json!({"from":"B2","values":[["=A1+$A1+A$1+$A$1","10"],["=A2","20"]]}),
        );
        let before = e.snapshot().unwrap();
        run(
            &mut e,
            "fillRange",
            json!({"source":{"from":"B2","to":"C3"},"target":{"from":"A1","to":"E5"}}),
        );
        assert_eq!(raw(&mut e, "B4"), "=A3+$A3+A$1+$A$1");
        assert_eq!(raw(&mut e, "D2"), "=C1+$A1+C$1+$A$1");
        assert_eq!(raw(&mut e, "A1"), "20");
        assert_eq!(raw(&mut e, "B1"), "=#REF!");
        let after = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), after);
        let mut reopened = TallyEngine::new();
        reopened.restore(&after).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), after);
    }
    #[test]
    fn rejects_invalid_fill_without_losing_redo() {
        let mut e = TallyEngine::new();
        run(
            &mut e,
            "setRange",
            json!({"from":"A1","values":[["=A1","=\\"]]}),
        );
        run(&mut e, "setCell", json!({"addr":"Z9","value":"9"}));
        e.undo().unwrap();
        let before = e.snapshot().unwrap();
        for p in [
            json!({"source":{"from":"A1","to":"B1"},"target":{"from":"A1","to":"B2"}}),
            json!({"source":{"from":"A1","to":"B1"},"target":{"from":"C1","to":"C2"}}),
            json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"Z9999"}}),
        ] {
            assert!(e.apply(Command::new("fillRange", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        assert_eq!(raw(&mut e, "Z9"), "9");
    }
    #[test]
    fn no_op_preserves_redo_and_has_no_events() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        e.undo().unwrap();
        assert!(
            run(&mut e, "setRange", json!({"from":"A1","values":[[""]]}))
                .events
                .is_empty()
        );
        assert!(e.redo().unwrap());
    }
    #[test]
    fn reference_lexer_preserves_nonreferences() {
        assert_eq!(
            formula::shift_references("=SUM(A1:$B$2)+1E3+LOG10(A1)+foo_A1+\"A1 東京\"", 1, 2)
                .unwrap(),
            "=SUM(B3:$B$2)+1E3+LOG10(B3)+foo_A1+\"A1 東京\""
        );
        assert_eq!(
            formula::shift_references("=\"a\"\"A1\"&A1", -1, 0).unwrap(),
            "=\"a\"\"A1\"&#REF!"
        );
    }
    #[test]
    fn blank_source_clears_target_on_active_sheet_only() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A2","value":"keep"}));
        run(&mut e, "addSheet", json!({"name":"Second"}));
        run(&mut e, "setActive", json!({"sheet":1}));
        run(&mut e, "setCell", json!({"addr":"A2","value":"clear"}));
        run(
            &mut e,
            "fillRange",
            json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"A2"}}),
        );
        assert_eq!(raw(&mut e, "A2"), "");
        e.undo().unwrap();
        assert_eq!(raw(&mut e, "A2"), "clear");
        run(&mut e, "setActive", json!({"sheet":0}));
        assert_eq!(raw(&mut e, "A2"), "keep");
    }
    #[test]
    fn paste_limits_and_address_overflow_are_atomic() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        for p in [
            json!({"from":"A1","values":[vec!["x";16385]]}),
            json!({"from":"A4294967295","values":[["a"],["b"]]}),
            json!({"from":fmt_addr(u32::MAX,0),"values":[["a","b"]]}),
        ] {
            assert!(e.apply(Command::new("setRange", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(!e.undo().unwrap());
        run(
            &mut e,
            "setRange",
            json!({"from":"A1","values":[vec!["x";16384]]}),
        );
        assert_eq!(raw(&mut e, "XFD1"), "x");
        e.undo().unwrap();
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn series_fill_infers_steps_and_writes_literals() {
        let mut e = TallyEngine::new();
        run(
            &mut e,
            "setRange",
            json!({"from":"A1","values":[["1"],["3"],["5"]]}),
        );
        let before = e.snapshot().unwrap();
        // Inferred step 2 continues down; source cells are untouched.
        let result = run(
            &mut e,
            "fillSeries",
            json!({"source":{"from":"A1","to":"A3"},"target":{"from":"A1","to":"A6"}}),
        );
        assert_eq!(result.data["changed"], 3);
        assert_eq!(result.events.len(), 1);
        assert_eq!(raw(&mut e, "A4"), "7");
        assert_eq!(raw(&mut e, "A5"), "9");
        assert_eq!(raw(&mut e, "A6"), "11");
        assert_eq!(
            run(&mut e, "getCell", json!({"addr":"A4"})).data["computed"],
            7.0
        );
        // Horizontal row source, explicit step overrides inference.
        run(
            &mut e,
            "setRange",
            json!({"from":"C1","values":[["10","20","30"]]}),
        );
        run(
            &mut e,
            "fillSeries",
            json!({"source":{"from":"C1","to":"E1"},"target":{"from":"C1","to":"G1"},"step":5}),
        );
        assert_eq!(raw(&mut e, "F1"), "25");
        assert_eq!(raw(&mut e, "G1"), "30");
        // Single-cell source works only with an explicit step.
        run(&mut e, "setCell", json!({"addr":"J1","value":"7"}));
        run(
            &mut e,
            "fillSeries",
            json!({"source":{"from":"J1","to":"J1"},"target":{"from":"J1","to":"J4"},"step":2}),
        );
        assert_eq!(raw(&mut e, "J2"), "9");
        assert_eq!(raw(&mut e, "J3"), "11");
        assert_eq!(raw(&mut e, "J4"), "13");
        // Extension above the source uses negative offsets.
        run(&mut e, "setCell", json!({"addr":"L5","value":"4"}));
        run(&mut e, "setCell", json!({"addr":"L6","value":"6"}));
        run(
            &mut e,
            "fillSeries",
            json!({"source":{"from":"L5","to":"L6"},"target":{"from":"L3","to":"L6"}}),
        );
        assert_eq!(raw(&mut e, "L3"), "0");
        assert_eq!(raw(&mut e, "L4"), "2");
        // Undo the eight writes after `before`, one entry each; redo reapplies.
        let filled = e.snapshot().unwrap();
        for _ in 0..8 {
            assert!(e.undo().unwrap());
        }
        assert_eq!(e.snapshot().unwrap(), before);
        for _ in 0..8 {
            assert!(e.redo().unwrap());
        }
        assert_eq!(e.snapshot().unwrap(), filled);
    }
    #[test]
    fn series_fill_rejects_without_mutation() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        run(&mut e, "setCell", json!({"addr":"A2","value":"3"}));
        run(&mut e, "setCell", json!({"addr":"B1","value":"x"}));
        run(&mut e, "setCell", json!({"addr":"B2","value":"=A1+1"}));
        run(&mut e, "setCell", json!({"addr":"D1","value":"0"}));
        run(&mut e, "setCell", json!({"addr":"D2","value":"1"}));
        let before = e.snapshot().unwrap();
        let bad = [
            // Non-numeric literal, formula and empty source cells.
            json!({"source":{"from":"B1","to":"B2"},"target":{"from":"B1","to":"B4"},"step":1}),
            json!({"source":{"from":"A1","to":"C1"},"target":{"from":"A1","to":"C1"}}),
            // Single cell cannot infer a step.
            json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"A3"}}),
            // 2-D source and perpendicular-widening targets.
            json!({"source":{"from":"A1","to":"B2"},"target":{"from":"A1","to":"C3"},"step":1}),
            json!({"source":{"from":"A1","to":"A2"},"target":{"from":"A1","to":"B2"},"step":1}),
            json!({"source":{"from":"A1","to":"B1"},"target":{"from":"A1","to":"A3"},"step":1}),
            // Non-finite or non-number step.
            json!({"source":{"from":"A1","to":"A2"},"target":{"from":"A1","to":"A4"},"step":"x"}),
            // Non-finite result rejects the whole op.
            json!({"source":{"from":"D1","to":"D2"},"target":{"from":"D1","to":"D4"},"step":1e308}),
        ];
        for p in bad {
            assert!(e.apply(Command::new("fillSeries", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Bounds still apply through the shared rectangle reader.
        assert!(e
            .apply(Command::new(
                "fillSeries",
                json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"A1048577"},"step":1})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn series_fill_zero_change_is_eventless() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        run(&mut e, "setCell", json!({"addr":"A2","value":"2"}));
        run(&mut e, "setCell", json!({"addr":"A3","value":"3"}));
        let result = run(
            &mut e,
            "fillSeries",
            json!({"source":{"from":"A1","to":"A2"},"target":{"from":"A1","to":"A3"}}),
        );
        assert_eq!(result.data["changed"], 0);
        assert!(result.events.is_empty());
    }
    #[test]
    fn references_and_writes_stay_on_the_sheet() {
        // Last row/column shift off the sheet; locked axes do not move.
        assert_eq!(formula::shift_references("=A1048576", 0, 1).unwrap(), "=#REF!");
        assert_eq!(formula::shift_references("=XFD1", 1, 0).unwrap(), "=#REF!");
        assert_eq!(formula::shift_references("=A$1048576", 0, 1).unwrap(), "=A$1048576");
        assert_eq!(formula::shift_references("=$XFD1", 1, 0).unwrap(), "=$XFD1");
        assert_eq!(formula::shift_references("=A1048575", 0, 1).unwrap(), "=A1048576");
        // A range with one endpoint off the sheet becomes a single #REF!.
        assert_eq!(formula::shift_references("=SUM(A1:A3)+A2", 0, -1).unwrap(), "=SUM(#REF!)+A1");
        assert_eq!(
            formula::shift_references("=SUM( A1 : $B$2 )", 1, 1).unwrap(),
            "=SUM( B2 : $B$2 )"
        );
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"C2","value":"=SUM(C1:C3)"}));
        run(
            &mut e,
            "fillRange",
            json!({"source":{"from":"C2","to":"C2"},"target":{"from":"C1","to":"C2"}}),
        );
        let c1 = run(&mut e, "getCell", json!({"addr":"C1"})).data;
        assert_eq!(c1["raw"], "=SUM(#REF!)");
        assert_eq!(c1["computed"], "#REF!");
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("setRange", json!({"from":"A1048576","values":[["a"],["b"]]})),
            ("setRange", json!({"from":"XFD1","values":[["a","b"]]})),
            ("setRange", json!({"from":"XFE1","values":[["a"]]})),
            (
                "fillRange",
                json!({"source":{"from":"A1048570","to":"A1048570"},"target":{"from":"A1048570","to":"A1048577"}}),
            ),
            (
                "fillRange",
                json!({"source":{"from":"XFD1","to":"XFD1"},"target":{"from":"XFD1","to":"XFE1"}}),
            ),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op} wrote off the sheet");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        run(&mut e, "setRange", json!({"from":"XFD1048575","values":[["=XFD1048575"],["x"]]}));
        assert_eq!(raw(&mut e, "XFD1048576"), "x");
        run(
            &mut e,
            "fillRange",
            json!({"source":{"from":"XFD1048575","to":"XFD1048575"},"target":{"from":"XFD1048575","to":"XFD1048576"}}),
        );
        assert_eq!(raw(&mut e, "XFD1048576"), "=XFD1048576");
    }
}
