//! Durable worksheet ordering and semantic tab colors.
use super::*;

pub(super) fn valid_tone(tone: Option<&str>) -> bool {
    matches!(tone, None | Some("primary" | "accent" | "success" | "info" | "muted"))
}

impl TallyEngine {
    pub(super) fn op_move_sheet(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = self.resolve_sheet(Self::field(p, "sheet")?)?;
        let to = Self::field(p, "toIndex")?.as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .filter(|&n| n < self.doc.sheets.len())
            .ok_or_else(|| EngineError::validation("toIndex must be an in-range integer"))?;
        if from == to {
            return Ok(Self::readonly(json!({ "ok": true })));
        }
        {
            self.journal.record(UndoEntry::Reset { prev: self.doc.clone() });
            let active_id = self.doc.sheets[self.doc.active].id;
            let sheet = self.doc.sheets.remove(from);
            self.doc.sheets.insert(to, sheet);
            self.doc.active = self.doc.sheets.iter().position(|s| s.id == active_id).unwrap();
        }
        Ok(Self::changed(json!({ "ok": true })))
    }

    pub(super) fn op_set_sheet_color(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.resolve_sheet(Self::field(p, "sheet")?)?;
        let tone = match Self::field(p, "tone")? {
            Value::Null => None,
            Value::String(s) => Some(s.as_str()),
            _ => return Err(EngineError::validation("tone must be a semantic color or null")),
        };
        if !valid_tone(tone) {
            return Err(EngineError::validation("unknown sheet tone"));
        }
        let tone = tone.map(str::to_owned);
        if self.doc.sheets[index].tone == tone {
            return Ok(Self::readonly(json!({ "ok": true })));
        }
        {
            self.journal.record(UndoEntry::Reset { prev: self.doc.clone() });
            self.doc.sheets[index].tone = tone;
        }
        Ok(Self::changed(json!({ "ok": true })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(engine: &mut TallyEngine, op: &str, payload: Value) {
        engine.apply(Command::new(op, payload)).unwrap();
    }

    #[test]
    fn reorder_preserves_active_sheet_cells_and_undo_redo() {
        let mut engine = TallyEngine::new();
        apply(&mut engine, "setCell", json!({"addr":"A1","value":"active"}));
        apply(&mut engine, "addSheet", json!({"name":"Other"}));
        let before = engine.snapshot().unwrap();
        apply(&mut engine, "moveSheet", json!({"sheet":0,"toIndex":1}));
        assert_eq!(engine.doc.active, 1);
        assert_eq!(engine.active_sheet().name, "Sheet1");
        assert_eq!(engine.active_sheet().cells["A1"].raw, "active");
        let moved = engine.snapshot().unwrap();
        assert!(engine.undo().unwrap());
        assert_eq!(engine.snapshot().unwrap(), before);
        assert!(engine.redo().unwrap());
        assert_eq!(engine.snapshot().unwrap(), moved);
        apply(&mut engine, "moveSheet", json!({"sheet":"Other","toIndex":1}));
        assert_eq!(engine.doc.active, 0);
        assert_eq!(engine.active_sheet().name, "Sheet1");
    }

    #[test]
    fn same_value_requests_preserve_redo_and_invalid_moves_are_atomic() {
        let mut engine = TallyEngine::new();
        apply(&mut engine, "setSheetColor", json!({"sheet":0,"tone":"accent"}));
        assert!(engine.undo().unwrap());
        let before = engine.snapshot().unwrap();
        let moved = engine.apply(Command::new("moveSheet", json!({"sheet":0,"toIndex":0}))).unwrap();
        let colored = engine.apply(Command::new("setSheetColor", json!({"sheet":0,"tone":null}))).unwrap();
        assert!(moved.events.is_empty());
        assert!(colored.events.is_empty());
        for to in [json!(-1), json!(1), json!(0.5), json!("0")] {
            assert!(engine.apply(Command::new("moveSheet", json!({"sheet":0,"toIndex":to}))).is_err());
            assert_eq!(engine.snapshot().unwrap(), before);
        }
        assert!(engine.redo().unwrap());
        assert_eq!(engine.doc.sheets[0].tone.as_deref(), Some("accent"));
        assert!(engine.undo().unwrap());
        assert!(!engine.undo().unwrap());
    }

    #[test]
    fn legacy_snapshot_defaults_tone_and_current_color_roundtrips() {
        let legacy = json!({"next_sheet":1,"sheets":[{"id":0,"name":"Legacy","cells":{}}],"active":0});
        let mut engine = TallyEngine::new();
        engine.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap())).unwrap();
        assert_eq!(engine.doc.sheets[0].tone, None);
        apply(&mut engine, "setSheetColor", json!({"sheet":"Legacy","tone":"success"}));
        let saved = engine.snapshot().unwrap();
        let mut reopened = TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(reopened.doc.sheets[0].tone.as_deref(), Some("success"));
        let mut invalid = legacy;
        invalid["sheets"][0]["tone"] = json!("arbitrary-css");
        assert!(reopened.restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap())).is_err());
        assert_eq!(reopened.snapshot().unwrap(), saved);
    }
}
