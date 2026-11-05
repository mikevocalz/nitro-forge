//! Atomic range writes: validate and stage everything before recording undo.
use super::*;

#[derive(Clone, Copy)]
struct Rect {
    c0: u32,
    r0: u32,
    c1: u32,
    r1: u32,
}
impl Rect {
    fn read(p: &Value) -> Result<Self, EngineError> {
        let (c0, r0) = TallyEngine::addr_coords(p, "from")?;
        let (c1, r1) = TallyEngine::addr_coords(p, "to")?;
        let rect = Self {
            c0: c0.min(c1),
            r0: r0.min(r1),
            c1: c0.max(c1),
            r1: r0.max(r1),
        };
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
        if u64::from(c0) + width as u64 - 1 > u64::from(u32::MAX)
            || u64::from(r0) + rows.len() as u64 > u64::from(u32::MAX)
        {
            return Err(EngineError::out_of_bounds("range exceeds address bounds"));
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
}
