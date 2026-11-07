//! Persisted editing protection; not encryption, authentication or a password lock.
use super::*;

impl TallyEngine {
    pub(super) fn check_protection(&self, op: &str, p: &Value) -> Result<(), EngineError> {
        let protected = match op {
            "setCell" | "clearCell" | "setRange" | "fillRange" | "fillSeries" | "setFormat"
            | "clearFormat" => self.active_sheet().is_protected,
            "renameSheet" | "removeSheet" | "duplicateSheet" | "moveSheet" | "setSheetColor" => {
                self.doc.sheets[self.resolve_sheet(Self::field(p, "sheet")?)?].is_protected
            }
            "new" => self.doc.sheets.iter().any(|s| s.is_protected),
            _ => false,
        };
        if protected {
            return Err(EngineError::validation("sheet is protected; unprotect it before editing"));
        }
        Ok(())
    }

    pub(super) fn op_protect_sheet(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.resolve_sheet(Self::field(p, "sheet")?)?;
        let protected = Self::field(p, "protected")?.as_bool()
            .ok_or_else(|| EngineError::validation("protected must be a boolean"))?;
        if self.doc.sheets[index].is_protected == protected {
            return Ok(Self::readonly(json!({"ok":true})));
        }
        self.journal.record(UndoEntry::Reset { prev: self.doc.clone() });
        self.doc.sheets[index].is_protected = protected;
        Ok(Self::changed(json!({"ok":true})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn apply(e: &mut TallyEngine, op: &str, p: Value) { e.apply(Command::new(op, p)).unwrap(); }

    #[test]
    fn batch_enforces_protection_and_rolls_back_prior_staged_writes() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        let batch = json!({"commands":[
            {"op":"setCell","payload":{"addr":"A1","value":"staged"}},
            {"op":"protectSheet","payload":{"sheet":0,"protected":true}},
            {"op":"setCell","payload":{"addr":"A2","value":"blocked"}}
        ]});
        assert!(e.apply(Command::new(ignition_core::OP_BATCH,batch)).is_err());
        assert_eq!(e.snapshot().unwrap(),before);
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn every_protected_write_rejects_without_state_or_history_changes() {
        let mut e = TallyEngine::new();
        apply(&mut e, "addSheet", json!({"name":"Other"}));
        apply(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let protected = e.snapshot().unwrap();
        let writes = [
            ("setCell", json!({"addr":"A1","value":"x"})),
            ("clearCell", json!({"addr":"A1"})),
            ("setRange", json!({"from":"A1","values":[["x"]]})),
            ("fillRange", json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"A2"}})),
            ("fillSeries", json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"A2"},"step":1})),
            ("setFormat", json!({"range":{"from":"A1","to":"A1"},"format":{"bold":true}})),
            ("clearFormat", json!({"cells":["A1"]})),
            ("renameSheet", json!({"sheet":0,"to":"Renamed"})),
            ("removeSheet", json!({"sheet":0})),
            ("duplicateSheet", json!({"sheet":0})),
            ("moveSheet", json!({"sheet":0,"toIndex":1})),
            ("setSheetColor", json!({"sheet":0,"tone":"info"})),
            ("new", json!({})),
        ];
        for (op, p) in writes {
            assert!(e.apply(Command::new(op,p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), protected, "{op}");
        }
        let noop = e.apply(Command::new("protectSheet",json!({"sheet":0,"protected":true}))).unwrap();
        assert!(noop.events.is_empty());
        assert!(e.undo().unwrap());
        assert!(!e.doc.sheets[0].is_protected);
        assert!(e.redo().unwrap());
        assert!(e.doc.sheets[0].is_protected);
        apply(&mut e, "setActive", json!({"sheet":1}));
        apply(&mut e, "setCell", json!({"addr":"A1","value":"allowed"}));
        apply(&mut e, "protectSheet", json!({"sheet":0,"protected":false}));
        apply(&mut e, "setActive", json!({"sheet":0}));
        apply(&mut e, "setCell", json!({"addr":"A1","value":"unlocked"}));
    }

    #[test]
    fn protection_roundtrips_and_invalid_restore_is_atomic() {
        let mut e = TallyEngine::new();
        apply(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let protected = e.snapshot().unwrap();
        let mut reopened = TallyEngine::new();
        reopened.restore(&protected).unwrap();
        assert!(reopened.doc.sheets[0].is_protected);
        let mut legacy = json!({"next_sheet":1,"sheets":[{"id":0,"name":"Legacy","cells":{}}],"active":0});
        reopened.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap())).unwrap();
        assert!(!reopened.doc.sheets[0].is_protected);
        let before = reopened.snapshot().unwrap();
        legacy["sheets"][0]["is_protected"] = json!("true");
        assert!(reopened.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap())).is_err());
        assert_eq!(reopened.snapshot().unwrap(), before);
        assert!(e.apply(Command::new("protectSheet",json!({"sheet":0,"protected":1}))).is_err());
        assert_eq!(e.snapshot().unwrap(), protected);
    }
}
