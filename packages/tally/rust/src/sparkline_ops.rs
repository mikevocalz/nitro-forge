//! Durable workbook-level sparkline specs and the
//! `setSparkline`/`clearSparkline`/`listSparklines` ops.
//!
//! Model decision: sparklines are **workbook-level entries** bound to one
//! sheet by durable sheet id, like `NamedRange`s and the rule tables —
//! `SparklineSpec = { id, sheet: sheet-id, target, data, kind }` where
//! `target` is the canonical `"A1"`/`"A1:B2"` anchor cell range the
//! sparkline is drawn in and `data` the canonical `"A1"`/`"A1:B2"` source
//! range it summarizes (both reuse `name_ops::parse_refers_to`, capped at
//! the shared 16,384-cell bound). `kind` is a bounded enum
//! (`line`/`column`/`bar`/`winloss`). At most `MAX_SPARKLINES` per
//! workbook.
//!
//! One spec covers one `target` per sheet: `setSparkline` on an identical
//! sheet+target with the same `data`+`kind` is an eventless no-op; the
//! same target with a different spec replaces in place keeping the id
//! (the edit path — there is no separate update op). `clearSparkline`
//! takes exactly one of `id` or a `cell`/`range` target selector (+
//! optional `sheet`, default active); `sheet` alongside `id` and `cell`
//! alongside `range` reject like the `clear*` mixed-selector precedent.
//! `removeSheet` cascade-drops the sheet's sparklines into the same undo
//! entry, mirroring names/validation/conditional/filter rules.
//!
//! **Rendering stays host-side**: the engine stores and returns the
//! bounded spec only — it never evaluates the data range, computes
//! sparkline geometry or draws pixels. `describe`/`listSparklines` expose
//! the stored spec; a host reads cell values through `getRange`/`getCell`
//! and renders. Whether one spec's `target` range means "same sparkline
//! repeated per cell" or a grouped display is a host decision; the engine
//! only guarantees the stored bounds.
//!
//! Protection: sparklines are workbook metadata bound to a sheet, so
//! mutations are guarded by the bound/target sheet exactly like name/rule
//! ops (see `protection.rs`); `listSparklines` is ungated.
use super::range_ops::Rect;
use super::*;

/// Maximum sparkline specs per workbook.
pub const MAX_SPARKLINES: usize = 256;

/// Bounded sparkline kinds; rendering is host-side.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SparklineKind {
    Line,
    Column,
    Bar,
    Winloss,
}

/// One durable sparkline spec: `id` is a workbook-unique handle, `sheet`
/// the bound sheet id, `target`/`data` canonical `"A1"`/`"A1:B2"` ranges.
/// `deny_unknown_fields` keeps deferred NYC-Tron sparkline fields from
/// being silently dropped out of hostile payloads.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SparklineSpec {
    pub id: u64,
    pub sheet: u64,
    pub target: String,
    pub data: String,
    pub kind: SparklineKind,
}

/// Inclusive 0-based rectangle of a stored canonical range.
fn spec_coords(range: &str) -> Option<name_ops::RefersCoords> {
    name_ops::parse_refers_to(range).ok()
}

fn cell_count(coords: name_ops::RefersCoords) -> u64 {
    u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
}

fn range_ok(range: &str) -> bool {
    spec_coords(range).is_some_and(|c| {
        name_ops::canonical_refers_to(c) == range && cell_count(c) <= MAX_GET_RANGE_CELLS
    })
}

/// Field-level check shared by hostile-restore (after canonicalization)
/// and undo re-admission.
pub(super) fn stored_ok(s: &SparklineSpec) -> bool {
    range_ok(&s.target) && range_ok(&s.data)
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped spec
/// comes back only while it still satisfies every invariant `restore`
/// enforces — bound sheet exists, unique id, under the cap, canonical
/// in-cap target/data. Specs cannot be created for a sheet while it is
/// gone (sheet ids are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, spec: &SparklineSpec) -> bool {
    doc.sparklines.len() < MAX_SPARKLINES
        && !doc.sparklines.iter().any(|s| s.id == spec.id)
        && doc.sheets.iter().any(|s| s.id == spec.sheet)
        && stored_ok(spec)
}

impl TallyEngine {
    /// JSON view of one spec with its bound sheet's *current* name
    /// resolved.
    fn sparkline_json(&self, s: &SparklineSpec) -> Result<Value, EngineError> {
        let sheet = self
            .doc
            .sheets
            .iter()
            .find(|sh| sh.id == s.sheet)
            .map(|sh| sh.name.clone());
        Ok(json!({
            "id": s.id,
            "sheet": sheet,
            "sheet_id": s.sheet,
            "target": s.target,
            "data": s.data,
            "kind": serde_json::to_value(s.kind)?,
        }))
    }

    /// Canonical target string for `setSparkline`/`clearSparkline`: exactly
    /// one of `cell` (a single address) or `range` (`{from,to}`).
    fn sparkline_target(&self, p: &Value) -> Result<String, EngineError> {
        let has_cell = p.get("cell").is_some_and(|v| !v.is_null());
        let has_range = p.get("range").is_some_and(|v| !v.is_null());
        match (has_cell, has_range) {
            (true, false) => {
                let addr = Self::addr_field(p, "cell")?;
                Ok(addr)
            }
            (false, true) => {
                let rect = Rect::read(Self::field(p, "range")?)?;
                Ok(name_ops::canonical_refers_to(rect.coords()))
            }
            _ => Err(EngineError::invalid(
                "sparkline target requires exactly one of 'cell' or 'range'",
            )),
        }
    }

    /// `setSparkline {sheet?, cell|range, data:{from,to}, kind}` — attach a
    /// sparkline spec to a cell or range anchor. Identical
    /// sheet+target+data+kind is eventless; same sheet+target with a
    /// different spec replaces in place keeping the id.
    pub(super) fn op_set_sparkline(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let target = self.sparkline_target(p)?;
        let rect = Rect::read(Self::field(p, "data")?)?;
        let data_range = name_ops::canonical_refers_to(rect.coords());
        let kind: SparklineKind = serde_json::from_value(
            Self::field(p, "kind")?.clone(),
        )
        .map_err(|e| EngineError::invalid(format!("invalid sparkline kind: {e}")))?;
        if let Some(pos) = self
            .doc
            .sparklines
            .iter()
            .position(|s| s.sheet == sheet_id && s.target == target)
        {
            let existing = self.doc.sparklines[pos].clone();
            if existing.data == data_range && existing.kind == kind {
                return Ok(Self::readonly(json!({
                    "sparkline": self.sparkline_json(&existing)?
                })));
            }
            self.journal.record(UndoEntry::Reset {
                prev: self.doc.clone(),
            });
            let mut next = existing.clone();
            next.data = data_range;
            next.kind = kind;
            self.doc.sparklines[pos] = next.clone();
            return Ok(Self::changed(json!({
                "sparkline": self.sparkline_json(&next)?
            })));
        }
        if self.doc.sparklines.len() >= MAX_SPARKLINES {
            return Err(EngineError::out_of_bounds(format!(
                "sparkline limit of {MAX_SPARKLINES} reached"
            )));
        }
        let id = self.doc.next_sparkline;
        self.doc.next_sparkline = self
            .doc
            .next_sparkline
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("sparkline id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let spec = SparklineSpec {
            id,
            sheet: sheet_id,
            target,
            data: data_range,
            kind,
        };
        self.doc.sparklines.push(spec.clone());
        Ok(Self::changed(json!({
            "sparkline": self.sparkline_json(&spec)?
        })))
    }

    /// `clearSparkline` — exactly one of `id` or a `cell`/`range` target
    /// selector (+ optional `sheet`, default active) removing every spec on
    /// that sheet with that target. `sheet`/`cell`/`range` alongside `id`
    /// reject rather than being silently ignored.
    pub(super) fn op_clear_sparkline(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let has_id = p.get("id").is_some_and(|v| !v.is_null());
        let has_target = p.get("cell").is_some_and(|v| !v.is_null())
            || p.get("range").is_some_and(|v| !v.is_null());
        let has_sheet = p.get("sheet").is_some_and(|v| !v.is_null());
        match (has_id, has_target) {
            (true, true) => Err(EngineError::invalid(
                "clearSparkline 'id' cannot be combined with 'cell' or 'range'",
            )),
            (true, false) if has_sheet => Err(EngineError::invalid(
                "clearSparkline 'id' cannot be combined with 'sheet', 'cell' or 'range'",
            )),
            (true, false) => {
                let id = p
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
                let pos = self
                    .doc
                    .sparklines
                    .iter()
                    .position(|s| s.id == id)
                    .ok_or_else(|| EngineError::not_found(format!("no sparkline {id}")))?;
                self.journal.record(UndoEntry::Reset {
                    prev: self.doc.clone(),
                });
                self.doc.sparklines.remove(pos);
                Ok(Self::changed(json!({ "cleared": 1 })))
            }
            (false, true) => {
                let target = self.sparkline_target(p)?;
                let idx = self.sheet_index(p)?;
                let sheet_id = self.doc.sheets[idx].id;
                let mut hits = Vec::new();
                for (i, s) in self.doc.sparklines.iter().enumerate() {
                    if s.sheet == sheet_id && s.target == target {
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
                    self.doc.sparklines.remove(*i);
                }
                Ok(Self::changed(json!({ "cleared": hits.len() })))
            }
            (false, false) => Err(EngineError::invalid(
                "clearSparkline requires 'id' or a 'cell'/'range' target",
            )),
        }
    }

    /// `listSparklines {sheet?}` — silent read; `sheet` absent lists every
    /// spec in the workbook, present filters to that sheet.
    pub(super) fn op_list_sparklines(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let specs: Vec<&SparklineSpec> = match p.get("sheet") {
            None | Some(Value::Null) => self.doc.sparklines.iter().collect(),
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                let sheet_id = self.doc.sheets[idx].id;
                self.doc
                    .sparklines
                    .iter()
                    .filter(|s| s.sheet == sheet_id)
                    .collect()
            }
        };
        let mut out = Vec::with_capacity(specs.len());
        for s in specs {
            out.push(self.sparkline_json(s)?);
        }
        Ok(Self::readonly(json!({ "sparklines": out })))
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
    fn specs(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "listSparklines", json!({}))["sparklines"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn set(e: &mut TallyEngine, p: Value) -> Value {
        data(e, "setSparkline", p)["sparkline"].clone()
    }

    #[test]
    fn set_replace_clear_roundtrip() {
        let mut e = TallyEngine::new();
        let s = set(
            &mut e,
            json!({"cell":"C3","data":{"from":"A1","to":"A5"},"kind":"line"}),
        );
        assert_eq!(s["id"], json!(1));
        assert_eq!(s["target"], json!("C3"));
        assert_eq!(s["data"], json!("A1:A5"));
        assert_eq!(s["sheet"], json!("Sheet1"));
        // describe exposes the stored spec.
        let d = data(&mut e, "describe", json!({}));
        assert_eq!(d["sparklines"].as_array().unwrap().len(), 1);
        // Identical resubmission is eventless (canonical target forms too).
        let noop = apply(
            &mut e,
            "setSparkline",
            json!({"cell":"$c$3","data":{"from":"A5","to":"A1"},"kind":"line"}),
        );
        assert!(noop.events.is_empty());
        assert_eq!(specs(&mut e).len(), 1);
        // Same target, different spec replaces in place keeping the id.
        let s2 = set(
            &mut e,
            json!({"cell":"C3","data":{"from":"A1","to":"A5"},"kind":"column"}),
        );
        assert_eq!(s2["id"], json!(1));
        assert_eq!(s2["kind"], json!("column"));
        assert_eq!(specs(&mut e).len(), 1);
        // A range target is a distinct anchor.
        set(
            &mut e,
            json!({"range":{"from":"D1","to":"E2"},"data":{"from":"A1","to":"A1"},"kind":"bar"}),
        );
        assert_eq!(specs(&mut e).len(), 2);
        // listSparklines sheet filter.
        data(&mut e, "addSheet", json!({"name":"Other"}));
        assert_eq!(
            data(&mut e, "listSparklines", json!({"sheet":"Other"}))["sparklines"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            data(&mut e, "listSparklines", json!({"sheet":"Sheet1"}))["sparklines"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        // clearSparkline by target selector and by id.
        let r = data(
            &mut e,
            "clearSparkline",
            json!({"cell":"C3"}),
        );
        assert_eq!(r["cleared"], json!(1));
        let noop = apply(&mut e, "clearSparkline", json!({"cell":"Z9"}));
        assert!(noop.events.is_empty());
        assert_eq!(noop.data["cleared"], json!(0));
        let r = data(&mut e, "clearSparkline", json!({"id":2}));
        assert_eq!(r["cleared"], json!(1));
        assert!(specs(&mut e).is_empty());
        assert_eq!(
            apply_err(&mut e, "clearSparkline", json!({"id":2})).code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn set_sparkline_payload_validation_is_atomic() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        for (p, code) in [
            // missing target / data / kind
            (json!({"data":{"from":"A1","to":"A1"},"kind":"line"}), ErrorCode::InvalidCommand),
            (json!({"cell":"A1","kind":"line"}), ErrorCode::InvalidCommand),
            (json!({"cell":"A1","data":{"from":"A1","to":"A1"}}), ErrorCode::InvalidCommand),
            // both cell and range
            (json!({"cell":"A1","range":{"from":"A1","to":"A1"},"data":{"from":"A1","to":"A1"},"kind":"line"}), ErrorCode::InvalidCommand),
            // bad kind / bad addresses / over-cap ranges
            (json!({"cell":"A1","data":{"from":"A1","to":"A1"},"kind":"pie"}), ErrorCode::InvalidCommand),
            (json!({"cell":"A0","data":{"from":"A1","to":"A1"},"kind":"line"}), ErrorCode::Validation),
            (json!({"cell":"A1","data":{"from":"A1","to":"XFE1"},"kind":"line"}), ErrorCode::OutOfBounds),
            (json!({"cell":"A1","data":{"from":"A1","to":"A16385"},"kind":"line"}), ErrorCode::OutOfBounds),
            (json!({"range":{"from":"A1","to":"XFD1048576"},"data":{"from":"A1","to":"A1"},"kind":"line"}), ErrorCode::OutOfBounds),
            // missing sheet
            (json!({"sheet":"Missing","cell":"A1","data":{"from":"A1","to":"A1"},"kind":"line"}), ErrorCode::NotFound),
        ] {
            assert_eq!(apply_err(&mut e, "setSparkline", p.clone()).code, code, "{p}");
            assert_eq!(e.snapshot().unwrap(), before, "{p} mutated");
        }
        // Cap: 256 specs then out_of_bounds.
        for i in 0..MAX_SPARKLINES {
            set(
                &mut e,
                json!({"cell":format!("A{}",i+1),"data":{"from":"B1","to":"B1"},"kind":"line"}),
            );
        }
        assert_eq!(
            apply_err(
                &mut e,
                "setSparkline",
                json!({"cell":"Z9","data":{"from":"B1","to":"B1"},"kind":"line"})
            )
            .code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn clear_sparkline_selector_edges() {
        let mut e = TallyEngine::new();
        set(&mut e, json!({"cell":"A1","data":{"from":"B1","to":"B2"},"kind":"line"}));
        // id + selectors reject; neither rejects.
        for p in [
            json!({"id":1,"cell":"A1"}),
            json!({"id":1,"sheet":"Sheet1"}),
            json!({"sheet":"Sheet1"}),
        ] {
            assert!(e.apply(Command::new("clearSparkline", p.clone())).is_err(), "{p}");
        }
        // cell + range together reject as a mixed target.
        assert!(e
            .apply(Command::new(
                "clearSparkline",
                json!({"cell":"A1","range":{"from":"A1","to":"A1"}}),
            ))
            .is_err());
        // range selector clears the spec bound to that target.
        let r = data(
            &mut e,
            "clearSparkline",
            json!({"range":{"from":"A1","to":"A1"}}),
        );
        assert_eq!(r["cleared"], json!(1));
        assert!(specs(&mut e).is_empty());
    }

    #[test]
    fn undo_redo_and_sheet_removal_cascade() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        set(&mut e, json!({"cell":"A1","data":{"from":"B1","to":"B1"},"kind":"line"}));
        set(
            &mut e,
            json!({"sheet":"Data","cell":"C3","data":{"from":"B1","to":"B1"},"kind":"bar"}),
        );
        assert_eq!(specs(&mut e).len(), 2);
        // Undo the second set.
        assert!(e.undo().unwrap());
        assert_eq!(specs(&mut e).len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(specs(&mut e).len(), 2);
        // Removing Data cascade-drops its spec into the same undo entry.
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert_eq!(specs(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(specs(&mut e).len(), 2);
        assert!(specs(&mut e).iter().any(|s| s["sheet_id"] == json!(1)));
        assert!(e.redo().unwrap());
        assert_eq!(specs(&mut e).len(), 1);
        // Undoing addSheet drops specs bound to the added sheet too.
        let mut e2 = TallyEngine::new();
        data(&mut e2, "addSheet", json!({"name":"Temp"}));
        set(
            &mut e2,
            json!({"sheet":"Temp","cell":"A1","data":{"from":"B1","to":"B1"},"kind":"line"}),
        );
        assert!(e2.undo().unwrap()); // undo setSparkline
        assert!(e2.undo().unwrap()); // undo addSheet
        assert!(specs(&mut e2).is_empty());
    }

    #[test]
    fn hostile_restore_validates_sparklines() {
        let mut e = TallyEngine::new();
        set(&mut e, json!({"cell":"A1","data":{"from":"B1","to":"B2"},"kind":"line"}));
        set(&mut e, json!({"cell":"D4","data":{"from":"B1","to":"B1"},"kind":"winloss"}));
        let snap = e.snapshot().unwrap();
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        assert_eq!(specs(&mut e2).len(), 2);
        let doc = data(&mut e, "describe", json!({}));
        let before = data(&mut e, "describe", json!({}));
        let mutates: Vec<Box<dyn Fn(&mut Value)>> = vec![
            // duplicate id
            Box::new(|d| d["sparklines"][1]["id"] = json!(1)),
            // missing sheet
            Box::new(|d| d["sparklines"][0]["sheet"] = json!(99)),
            // unparseable target/data
            Box::new(|d| d["sparklines"][0]["target"] = json!("nope")),
            Box::new(|d| d["sparklines"][0]["data"] = json!("A1:B2:C3")),
            // over-cap range
            Box::new(|d| d["sparklines"][0]["data"] = json!("A1:XFD1048576")),
            // unknown spec field (deny_unknown_fields)
            Box::new(|d| d["sparklines"][0]["deferred"] = json!(true)),
            // over-cap count
            Box::new(|d| {
                let mut list = d["sparklines"].as_array().unwrap().clone();
                for i in 0..300 {
                    let mut s = list[0].clone();
                    s["id"] = json!(100 + i);
                    s["target"] = json!(format!("Z{}", i + 1));
                    list.push(s);
                }
                d["sparklines"] = json!(list);
            }),
        ];
        for mutate in mutates {
            let mut bad = doc.clone();
            mutate(&mut bad);
            let wrapped = json!({"kind":"tally","schema":5,"document":bad});
            assert!(
                e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap())).is_err()
            );
            assert_eq!(data(&mut e, "describe", json!({})), before);
        }
        // next_sparkline repair.
        let mut repaired = doc.clone();
        repaired["next_sparkline"] = json!(1);
        let wrapped = json!({"kind":"tally","schema":5,"document":repaired});
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        let d = data(&mut e, "describe", json!({}));
        assert!(d["next_sparkline"].as_u64().unwrap() > 1);
    }
}
