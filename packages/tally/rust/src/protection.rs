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
            // Names are workbook metadata but each is bound to one sheet, so
            // mutating a name is treated like editing that sheet: defineName
            // guards its target sheet, updateName/removeName guard the name's
            // current sheet (updateName also guards an explicitly requested
            // new target). Unknown names fall through — the op reports
            // not_found. listNames/functionCatalog are reads and ungated.
            "defineName" => {
                let idx = match p.get("sheet") {
                    Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                    _ => self.doc.active,
                };
                self.doc.sheets[idx].is_protected
            }
            "updateName" | "removeName" => {
                let sheet_id = p
                    .get("name")
                    .and_then(Value::as_str)
                    .and_then(|n| self.name_sheet_id(n));
                let current = sheet_id.is_some_and(|id| {
                    self.doc
                        .sheets
                        .iter()
                        .any(|s| s.id == id && s.is_protected)
                });
                let retarget = if op == "updateName" {
                    match p.get("sheet") {
                        Some(v) if !v.is_null() => self
                            .resolve_sheet(v)
                            .map(|i| self.doc.sheets[i].is_protected)
                            .unwrap_or(false),
                        _ => false,
                    }
                } else {
                    false
                };
                current || retarget
            }
            // Sheet-bound rule tables follow the same rule as names:
            // each rule is bound to one sheet, so setValidation/
            // setConditionalFormat guard their target sheet and
            // clearValidation/clearConditionalFormat guard the rule's
            // sheet (by id) or the target sheet (by range). Unknown ids
            // fall through — the op reports not_found. The get/evaluate/
            // validate reads are ungated.
            // `importCsv`/`importTsv` write cells on their target sheet
            // (payload `sheet`, default active) — same bound-sheet rule.
            "setValidation" | "setConditionalFormat" | "setFilter" | "sortRange"
            | "importCsv" | "importTsv" | "insertRows" | "deleteRows"
            | "insertCols" | "deleteCols" | "mergeCells" | "unmergeCells" => {
                let idx = match p.get("sheet") {
                    Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                    _ => self.doc.active,
                };
                self.doc.sheets[idx].is_protected
            }
            "clearFilter" => match p.get("id").and_then(Value::as_u64) {
                Some(id) => self
                    .doc
                    .filters
                    .iter()
                    .find(|r| r.id == id)
                    .is_some_and(|r| {
                        self.doc
                            .sheets
                            .iter()
                            .any(|s| s.id == r.sheet && s.is_protected)
                    }),
                None => {
                    let idx = match p.get("sheet") {
                        Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                        _ => self.doc.active,
                    };
                    self.doc.sheets[idx].is_protected
                }
            },
            "clearValidation" => match p.get("id").and_then(Value::as_u64) {
                Some(id) => self
                    .doc
                    .validations
                    .iter()
                    .find(|r| r.id == id)
                    .is_some_and(|r| {
                        self.doc
                            .sheets
                            .iter()
                            .any(|s| s.id == r.sheet && s.is_protected)
                    }),
                None => {
                    let idx = match p.get("sheet") {
                        Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                        _ => self.doc.active,
                    };
                    self.doc.sheets[idx].is_protected
                }
            },
            "clearConditionalFormat" => match p.get("id").and_then(Value::as_u64) {
                Some(id) => self
                    .doc
                    .conditional_formats
                    .iter()
                    .find(|r| r.id == id)
                    .is_some_and(|r| {
                        self.doc
                            .sheets
                            .iter()
                            .any(|s| s.id == r.sheet && s.is_protected)
                    }),
                None => {
                    let idx = match p.get("sheet") {
                        Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                        _ => self.doc.active,
                    };
                    self.doc.sheets[idx].is_protected
                }
            },
            // Charts and sparklines are workbook metadata bound to one
            // sheet: insertChart/setSparkline guard their target sheet,
            // updateChart/removeChart/clearSparkline-by-id guard the
            // stored spec's sheet, clearSparkline-by-target guards the
            // resolved sheet. Unknown ids fall through — the op reports
            // not_found. listCharts/listSparklines are ungated reads.
            "insertChart" | "setSparkline" => {
                let idx = match p.get("sheet") {
                    Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                    _ => self.doc.active,
                };
                self.doc.sheets[idx].is_protected
            }
            "updateChart" | "removeChart" => p
                .get("id")
                .and_then(Value::as_u64)
                .and_then(|id| {
                    self.doc
                        .charts
                        .iter()
                        .find(|c| c.id == id)
                        .map(|c| c.sheet)
                })
                .is_some_and(|sheet_id| {
                    self.doc
                        .sheets
                        .iter()
                        .any(|s| s.id == sheet_id && s.is_protected)
                }),
            "clearSparkline" => match p.get("id").and_then(Value::as_u64) {
                Some(id) => self
                    .doc
                    .sparklines
                    .iter()
                    .find(|s| s.id == id)
                    .is_some_and(|s| {
                        self.doc
                            .sheets
                            .iter()
                            .any(|sh| sh.id == s.sheet && sh.is_protected)
                    }),
                None => {
                    let idx = match p.get("sheet") {
                        Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                        _ => self.doc.active,
                    };
                    self.doc.sheets[idx].is_protected
                }
            },
            // Named views are workbook metadata bound to one sheet:
            // saveSheetView guards its target sheet, setSheetView guards
            // the view's bound sheet (or the resolved sheet for the
            // `view:null` clear), removeSheetView guards the stored
            // view's sheet. Unknown ids fall through — the op reports
            // not_found. listSheetViews is an ungated read.
            "saveSheetView" => {
                let idx = match p.get("sheet") {
                    Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                    _ => self.doc.active,
                };
                self.doc.sheets[idx].is_protected
            }
            "setSheetView" => match p.get("view") {
                Some(v) if !v.is_null() => v
                    .as_u64()
                    .and_then(|id| self.doc.views.iter().find(|vw| vw.id == id))
                    .is_some_and(|vw| {
                        self.doc
                            .sheets
                            .iter()
                            .any(|s| s.id == vw.sheet && s.is_protected)
                    }),
                _ => {
                    let idx = match p.get("sheet") {
                        Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                        _ => self.doc.active,
                    };
                    self.doc.sheets[idx].is_protected
                }
            },
            "removeSheetView" => p
                .get("id")
                .and_then(Value::as_u64)
                .and_then(|id| self.doc.views.iter().find(|vw| vw.id == id))
                .is_some_and(|vw| {
                    self.doc
                        .sheets
                        .iter()
                        .any(|s| s.id == vw.sheet && s.is_protected)
                }),
            // Comments are workbook metadata bound to one sheet:
            // addComment guards its target sheet, the id-addressed
            // mutations guard the stored comment's sheet. Unknown ids
            // fall through — the op reports not_found. listComments is an
            // ungated read.
            "addComment" => {
                let idx = match p.get("sheet") {
                    Some(v) if !v.is_null() => self.resolve_sheet(v)?,
                    _ => self.doc.active,
                };
                self.doc.sheets[idx].is_protected
            }
            "updateComment" | "removeComment" | "resolveComment" | "reopenComment" => p
                .get("id")
                .and_then(Value::as_u64)
                .and_then(|id| self.doc.comments.iter().find(|c| c.id == id))
                .is_some_and(|c| {
                    self.doc
                        .sheets
                        .iter()
                        .any(|s| s.id == c.sheet && s.is_protected)
                }),
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
            ("setValidation", json!({"range":{"from":"A1","to":"A1"},"rule":{"kind":"list","values":["a"]}})),
            ("clearValidation", json!({"range":{"from":"A1","to":"A1"}})),
            ("clearValidation", json!({"id":1})),
            ("setConditionalFormat", json!({"range":{"from":"A1","to":"A1"},"rule":{"criteria":">1","format":{"bold":true}}})),
            ("clearConditionalFormat", json!({"range":{"from":"A1","to":"A1"}})),
            ("clearConditionalFormat", json!({"id":1})),
            ("sortRange", json!({"range":{"from":"A1","to":"A2"},"keys":[{"offset":0}]})),
            ("setFilter", json!({"range":{"from":"A1","to":"A1"},"criteria":">1"})),
            ("clearFilter", json!({"range":{"from":"A1","to":"A1"}})),
            ("clearFilter", json!({"id":1})),
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
    fn name_ops_guard_their_bound_sheet() {
        let mut e = TallyEngine::new();
        apply(&mut e, "addSheet", json!({"name":"Other"}));
        apply(&mut e, "defineName", json!({"name":"OnProtected","refers_to":"A1"}));
        apply(&mut e, "defineName", json!({"name":"OnOther","sheet":"Other","refers_to":"A1"}));
        apply(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        // Names bound to the protected sheet (or defaulting to the active
        // protected sheet) reject mutations; reads stay allowed.
        for (op, p) in [
            ("updateName", json!({"name":"OnProtected","refers_to":"B2"})),
            ("removeName", json!({"name":"OnProtected"})),
            ("defineName", json!({"name":"New","refers_to":"A1"})),
            ("defineName", json!({"name":"New2","sheet":0,"refers_to":"A1"})),
            // Retargeting an unprotected name onto the protected sheet.
            ("updateName", json!({"name":"OnOther","sheet":0})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), before, "{op}");
        }
        assert!(e.apply(Command::new("listNames", json!({}))).is_ok());
        assert!(e.apply(Command::new("functionCatalog", json!({}))).is_ok());
        // Names bound to the unprotected sheet still mutate fine.
        apply(&mut e, "updateName", json!({"name":"OnOther","refers_to":"B2"}));
        apply(&mut e, "removeName", json!({"name":"OnOther"}));
        assert_eq!(e.doc.names.len(), 1);
    }

    #[test]
    fn view_ops_guard_their_bound_sheet() {
        let mut e = TallyEngine::new();
        apply(&mut e, "addSheet", json!({"name":"Other"}));
        apply(&mut e, "saveSheetView", json!({"name":"V0"}));
        apply(&mut e, "saveSheetView", json!({"name":"V1","sheet":"Other"}));
        apply(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("saveSheetView", json!({"name":"Nope"})),
            ("saveSheetView", json!({"name":"Nope","sheet":0})),
            ("setSheetView", json!({"view":1})),
            ("setSheetView", json!({"view":null})),
            ("setSheetView", json!({"view":null,"sheet":"Sheet1"})),
            ("removeSheetView", json!({"id":1})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), before, "{op}");
        }
        // Views bound to the unprotected sheet still mutate fine; reads
        // stay ungated.
        assert!(e.apply(Command::new("listSheetViews", json!({}))).is_ok());
        apply(&mut e, "setSheetView", json!({"view":2}));
        apply(&mut e, "removeSheetView", json!({"id":2}));
        apply(&mut e, "saveSheetView", json!({"name":"OnOther","sheet":"Other"}));
    }

    #[test]
    fn comment_ops_guard_their_bound_sheet() {
        let mut e = TallyEngine::new();
        apply(&mut e, "addSheet", json!({"name":"Other"}));
        apply(&mut e, "addComment", json!({"cell":"A1","body":"on sheet1"}));
        apply(&mut e, "addComment", json!({"sheet":"Other","cell":"A1","body":"on other"}));
        apply(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("addComment", json!({"cell":"B1","body":"nope"})),
            ("addComment", json!({"sheet":0,"cell":"B1","body":"nope"})),
            ("updateComment", json!({"id":1,"body":"nope"})),
            ("removeComment", json!({"id":1})),
            ("resolveComment", json!({"id":1})),
            ("reopenComment", json!({"id":1})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op}");
            assert_eq!(e.snapshot().unwrap(), before, "{op}");
        }
        // Comments bound to the unprotected sheet still mutate; reads stay
        // ungated.
        assert!(e.apply(Command::new("listComments", json!({}))).is_ok());
        apply(&mut e, "updateComment", json!({"id":2,"body":"edited"}));
        apply(&mut e, "resolveComment", json!({"id":2}));
        apply(&mut e, "reopenComment", json!({"id":2}));
        apply(&mut e, "removeComment", json!({"id":2}));
        apply(&mut e, "addComment", json!({"sheet":"Other","cell":"C1","body":"ok"}));
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
