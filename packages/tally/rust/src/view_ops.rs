//! Durable workbook-level named sheet views and the
//! `saveSheetView`/`setSheetView`/`removeSheetView`/`listSheetViews` ops.
//!
//! Model decision (workbook-persisted, mirroring the rule tables): a view is
//! a **workbook-level entry** bound to one sheet by durable sheet id —
//! `SheetView = { id, sheet: sheet-id, name, filters: [ViewFilter] }` where
//! each `ViewFilter = { range, column?, criteria }` is a *spec* (no rule id)
//! captured from the sheet's `FilterRule`s at save time. Names are unique
//! case-insensitively **per sheet**; at most `MAX_VIEWS` per workbook and
//! `MAX_VIEW_FILTERS` specs per view.
//!
//! What a view captures — the honest subset: the engine's only durable
//! view-ish state is the **filter table** (row visibility is derived live
//! from computed values; see `filter_ops`). Scroll position, zoom, frozen
//! panes/splits, column widths and sort order are NOT engine state — sorts
//! are destructive cell mutations (`sortRange`) and the rest are host view
//! state — so views capture filter specs only. Applying a view
//! (`setSheetView`) replaces the bound sheet's filter rules with the
//! captured specs under fresh rule ids and records the selection durably
//! as `Sheet.active_view`; `setSheetView {view:null}` clears the selection
//! without touching filters. If the engine later owns frozen panes or
//! column geometry, views extend the same way.
//!
//! `saveSheetView` captures the sheet's *current* filter specs: an existing
//! view with the same case-insensitive name on the same sheet is updated
//! in place (keeping its id — the `setValidation` replace precedent), and
//! an identical capture is eventless. `setSheetView` is eventless when the
//! sheet's filters already equal the view's specs and the view is already
//! the sheet's active view. `removeSheetView` clears `active_view`
//! references to the removed view. `removeSheet` cascade-drops the sheet's
//! views into the same undo entry; undo re-admits each dropped view only
//! while it still satisfies the invariants `restore` enforces (`readd_ok`)
//! and sweeps any `active_view` left pointing at a view that did not come
//! back. `duplicateSheet` does not copy views and clears `active_view` on
//! the copy (views are bound to the source sheet id).
//!
//! Protection: views are workbook metadata bound to a sheet, so mutations
//! are guarded by the bound/target sheet exactly like name/rule ops (see
//! `protection.rs`); `listSheetViews` is ungated.
use super::filter_ops::column_index;
use super::*;

/// Maximum named views per workbook.
pub const MAX_VIEWS: usize = 256;
/// Maximum captured filter specs per view. `saveSheetView` rejects sheets
/// carrying more filter rules than this rather than silently truncating.
pub const MAX_VIEW_FILTERS: usize = 64;
/// View `name` bound in UTF-8 bytes.
pub const MAX_VIEW_NAME_LEN: usize = 128;

/// One captured filter spec: a canonical `"A1"`/`"A1:B2"` range, an
/// optional canonical column letter inside it, and a COUNTIF-style
/// criteria string — the `FilterRule` fields minus the rule `id`.
/// `deny_unknown_fields` keeps deferred NYC-Tron view fields from being
/// silently dropped out of hostile payloads.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewFilter {
    pub range: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    pub criteria: String,
}

/// One durable named view: `id` is a workbook-unique handle, `sheet` the
/// bound sheet id, `name` unique case-insensitively among that sheet's
/// views, `filters` the captured specs applied by `setSheetView`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetView {
    pub id: u64,
    pub sheet: u64,
    pub name: String,
    pub filters: Vec<ViewFilter>,
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

/// Field-level check for one captured spec, shared by op-time capture
/// validation and hostile-restore checks: canonical in-cap range, parseable
/// criteria, in-range column when present.
fn spec_ok(f: &ViewFilter) -> bool {
    range_ok(&f.range)
        && formula::CriteriaMatcher::is_valid(&f.criteria)
        && match &f.column {
            None => true,
            Some(col) => spec_coords(&f.range)
                .and_then(|c| column_index(col).map(|i| (i, c)))
                .is_some_and(|(i, c)| i >= c.0 && i <= c.2),
        }
}

/// View-name legality: nonempty, bounded.
pub(super) fn valid_view_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= MAX_VIEW_NAME_LEN
}

/// Field-level check shared by hostile-restore (after canonicalization)
/// and undo re-admission: legal name, bounded spec count, every captured
/// spec valid. Bound-sheet existence and per-sheet name uniqueness are
/// checked by the caller.
pub(super) fn stored_ok(v: &SheetView) -> bool {
    valid_view_name(&v.name)
        && v.filters.len() <= MAX_VIEW_FILTERS
        && v.filters.iter().all(spec_ok)
}

/// Case-insensitive view-name uniqueness within one sheet's view set.
fn name_free(doc: &Workbook, sheet: u64, name: &str, except_id: Option<u64>) -> bool {
    !doc.views.iter().any(|v| {
        v.sheet == sheet
            && Some(v.id) != except_id
            && v.name.eq_ignore_ascii_case(name)
    })
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped view
/// comes back only while it still satisfies every invariant `restore`
/// enforces — bound sheet exists, unique id, per-sheet name free, under
/// the cap, stored spec valid. Views cannot be created for a sheet while
/// it is gone (sheet ids are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, view: &SheetView) -> bool {
    doc.views.len() < MAX_VIEWS
        && !doc.views.iter().any(|v| v.id == view.id)
        && doc.sheets.iter().any(|s| s.id == view.sheet)
        && name_free(doc, view.sheet, &view.name, None)
        && stored_ok(view)
}

impl TallyEngine {
    /// JSON view of one view with its bound sheet's *current* name
    /// resolved and `active` marking the sheet's `active_view`.
    fn view_json(&self, v: &SheetView) -> Result<Value, EngineError> {
        let sheet = self
            .doc
            .sheets
            .iter()
            .find(|s| s.id == v.sheet)
            .map(|s| s.name.clone());
        let active = self
            .doc
            .sheets
            .iter()
            .any(|s| s.id == v.sheet && s.active_view == Some(v.id));
        let mut out = serde_json::Map::new();
        out.insert("id".to_string(), json!(v.id));
        out.insert("sheet".to_string(), json!(sheet));
        out.insert("sheet_id".to_string(), json!(v.sheet));
        out.insert("name".to_string(), json!(v.name));
        out.insert("filters".to_string(), serde_json::to_value(&v.filters)?);
        out.insert("active".to_string(), json!(active));
        Ok(Value::Object(out))
    }

    /// The sheet's current filter rules as captured specs, in doc order.
    fn current_specs(&self, sheet_id: u64) -> Vec<ViewFilter> {
        self.doc
            .filters
            .iter()
            .filter(|r| r.sheet == sheet_id)
            .map(|r| ViewFilter {
                range: r.range.clone(),
                column: r.column.clone(),
                criteria: r.criteria.clone(),
            })
            .collect()
    }

    /// `saveSheetView {sheet?, name}` — capture the resolved sheet's
    /// current filter specs into a named view. An existing view with the
    /// same case-insensitive name on the same sheet is updated in place
    /// (keeping its id); an identical capture is eventless.
    pub(super) fn op_save_sheet_view(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let name = Self::str_field(p, "name")?;
        if !valid_view_name(name) {
            return Err(EngineError::validation(format!(
                "view name must be 1-{MAX_VIEW_NAME_LEN} bytes"
            )));
        }
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let specs = self.current_specs(sheet_id);
        if specs.len() > MAX_VIEW_FILTERS {
            return Err(EngineError::out_of_bounds(format!(
                "sheet has {} filter rules; views capture at most {MAX_VIEW_FILTERS}",
                specs.len()
            )));
        }
        // Every captured spec comes from the validated rule table, but
        // re-check anyway so a stored-rule invariant drift can never
        // produce an unrestorable view.
        for f in &specs {
            if !spec_ok(f) {
                return Err(EngineError::validation(
                    "sheet filter rules cannot be captured into a view",
                ));
            }
        }
        if let Some(pos) = self
            .doc
            .views
            .iter()
            .position(|v| v.sheet == sheet_id && v.name.eq_ignore_ascii_case(name))
        {
            if self.doc.views[pos].filters == specs {
                return Ok(Self::readonly(json!({
                    "view": self.view_json(&self.doc.views[pos].clone())?
                })));
            }
            self.journal.record(UndoEntry::Reset {
                prev: self.doc.clone(),
            });
            self.doc.views[pos].filters = specs;
            return Ok(Self::changed(json!({
                "view": self.view_json(&self.doc.views[pos].clone())?
            })));
        }
        if !name_free(&self.doc, sheet_id, name, None) {
            // Unreachable: names are unique per sheet and the same-sheet
            // twin was handled above; kept as a defensive check.
            return Err(EngineError::validation(format!(
                "view name '{name}' already exists on this sheet"
            )));
        }
        if self.doc.views.len() >= MAX_VIEWS {
            return Err(EngineError::out_of_bounds(format!(
                "view limit of {MAX_VIEWS} reached"
            )));
        }
        let id = self.doc.next_view;
        self.doc.next_view = self
            .doc
            .next_view
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("view id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let view = SheetView {
            id,
            sheet: sheet_id,
            name: name.to_string(),
            filters: specs,
        };
        self.doc.views.push(view.clone());
        Ok(Self::changed(json!({ "view": self.view_json(&view)? })))
    }

    /// `setSheetView {view, sheet?}` — `view` is a view id applying its
    /// captured specs to the bound sheet (replacing that sheet's filter
    /// rules with fresh ids and recording `Sheet.active_view`), or `null`
    /// clearing the resolved sheet's selection without touching filters.
    /// `sheet` only applies to the `null` form; alongside a view id it
    /// rejects like the `clear*` mixed-selector precedent.
    pub(super) fn op_set_sheet_view(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        if !p.as_object().is_some_and(|o| o.contains_key("view")) {
            return Err(EngineError::invalid("missing payload field 'view'"));
        }
        match p.get("view") {
            Some(Value::Null) => {
                let idx = self.sheet_index(p)?;
                let sheet_id = self.doc.sheets[idx].id;
                if self.doc.sheets[idx].active_view.is_none() {
                    return Ok(Self::readonly(json!({ "view": null })));
                }
                self.journal.record(UndoEntry::Reset {
                    prev: self.doc.clone(),
                });
                if let Some(s) = self.sheet_by_id_mut(sheet_id) {
                    s.active_view = None;
                }
                Ok(Self::changed(json!({ "view": null })))
            }
            Some(v) => {
                if p.get("sheet").is_some_and(|s| !s.is_null()) {
                    return Err(EngineError::invalid(
                        "setSheetView 'sheet' is not allowed alongside a view id",
                    ));
                }
                let id = v
                    .as_u64()
                    .ok_or_else(|| EngineError::invalid("'view' must be a view id or null"))?;
                let view = self
                    .doc
                    .views
                    .iter()
                    .find(|v| v.id == id)
                    .cloned()
                    .ok_or_else(|| EngineError::not_found(format!("no sheet view {id}")))?;
                let sheet_idx = self
                    .doc
                    .sheets
                    .iter()
                    .position(|s| s.id == view.sheet)
                    .ok_or_else(|| {
                        EngineError::serialization("view references a missing sheet")
                    })?;
                // Eventless when the sheet already carries exactly the
                // view's specs (same order) and the view is active.
                if self.doc.sheets[sheet_idx].active_view == Some(id)
                    && self.current_specs(view.sheet) == view.filters
                {
                    return Ok(Self::readonly(json!({
                        "view": self.view_json(&view)?
                    })));
                }
                // The replacement must keep the workbook inside the filter
                // cap: other sheets' rules stay, this sheet's are swapped.
                let removed = self
                    .doc
                    .filters
                    .iter()
                    .filter(|r| r.sheet == view.sheet)
                    .count();
                let projected = self.doc.filters.len() - removed + view.filters.len();
                if projected > filter_ops::MAX_FILTERS {
                    return Err(EngineError::out_of_bounds(format!(
                        "applying the view would exceed the {}-rule filter limit",
                        filter_ops::MAX_FILTERS
                    )));
                }
                // Pre-flight the id space before journaling.
                let needed = view.filters.len() as u64;
                let next_id = if needed == 0 {
                    self.doc.next_filter
                } else {
                    self.doc
                        .next_filter
                        .checked_add(needed)
                        .ok_or_else(|| EngineError::validation("filter id space exhausted"))?
                };
                self.journal.record(UndoEntry::Reset {
                    prev: self.doc.clone(),
                });
                self.doc.filters.retain(|r| r.sheet != view.sheet);
                let mut id = self.doc.next_filter;
                for spec in &view.filters {
                    self.doc.filters.push(FilterRule {
                        id,
                        sheet: view.sheet,
                        range: spec.range.clone(),
                        column: spec.column.clone(),
                        criteria: spec.criteria.clone(),
                    });
                    id += 1;
                }
                self.doc.next_filter = next_id;
                if let Some(s) = self.sheet_by_id_mut(view.sheet) {
                    s.active_view = Some(view.id);
                }
                Ok(Self::changed(json!({ "view": self.view_json(&view)? })))
            }
            _ => Err(EngineError::invalid("'view' must be a view id or null")),
        }
    }

    /// `removeSheetView {id}` — remove one view and clear any sheet's
    /// `active_view` pointing at it.
    pub(super) fn op_remove_sheet_view(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .views
            .iter()
            .position(|v| v.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no sheet view {id}")))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.views.remove(pos);
        for s in &mut self.doc.sheets {
            if s.active_view == Some(id) {
                s.active_view = None;
            }
        }
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// `listSheetViews {sheet?}` — silent read; `sheet` absent lists every
    /// view in the workbook, present filters to that sheet.
    pub(super) fn op_list_sheet_views(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let views: Vec<&SheetView> = match p.get("sheet") {
            None | Some(Value::Null) => self.doc.views.iter().collect(),
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                let sheet_id = self.doc.sheets[idx].id;
                self.doc
                    .views
                    .iter()
                    .filter(|v| v.sheet == sheet_id)
                    .collect()
            }
        };
        let mut out = Vec::with_capacity(views.len());
        for v in views {
            out.push(self.view_json(v)?);
        }
        Ok(Self::readonly(json!({ "views": out })))
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
    fn views(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "listSheetViews", json!({}))["views"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn filters(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "getFilters", json!({}))["rules"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn save(e: &mut TallyEngine, name: &str) -> Value {
        data(e, "saveSheetView", json!({"name":name}))["view"].clone()
    }

    #[test]
    fn save_apply_list_remove_roundtrip() {
        let mut e = TallyEngine::new();
        data(&mut e, "setRange", json!({"from":"A1","values":[["1"],["2"],["3"]]}));
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A3"},"column":"A","criteria":">1"}),
        );
        let v = save(&mut e, "Big only");
        assert_eq!(v["id"], json!(1));
        assert_eq!(v["name"], json!("Big only"));
        assert_eq!(v["sheet"], json!("Sheet1"));
        assert_eq!(v["filters"][0]["criteria"], json!(">1"));
        assert_eq!(v["filters"][0]["column"], json!("A"));
        assert!(v["filters"][0].get("id").is_none()); // spec, not a rule
        assert_eq!(v["active"], json!(false));
        // listSheetViews sheet filter + describe exposure.
        assert_eq!(views(&mut e).len(), 1);
        data(&mut e, "addSheet", json!({"name":"Other"}));
        assert_eq!(
            data(&mut e, "listSheetViews", json!({"sheet":"Other"}))["views"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        // Apply: filters are replaced with fresh rule ids, selection sticks.
        let applied = data(&mut e, "setSheetView", json!({"view":1}));
        assert_eq!(applied["view"]["active"], json!(true));
        let rules = filters(&mut e);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0]["criteria"], json!(">1"));
        // Re-applying the same view is eventless.
        let noop = apply(&mut e, "setSheetView", json!({"view":1}));
        assert!(noop.events.is_empty());
        // Diverge: add a second filter, then re-apply restores the spec.
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"B1","to":"B3"},"criteria":"*"}),
        );
        assert_eq!(filters(&mut e).len(), 2);
        data(&mut e, "setSheetView", json!({"view":1}));
        assert_eq!(filters(&mut e).len(), 1);
        // view:null clears only the selection.
        let cleared = data(&mut e, "setSheetView", json!({"view":null}));
        assert_eq!(cleared["view"], Value::Null);
        assert_eq!(views(&mut e)[0]["active"], json!(false));
        assert_eq!(filters(&mut e).len(), 1);
        // removeSheetView; unknown id not_found; sheet alongside id rejects.
        assert_eq!(
            apply_err(&mut e, "setSheetView", json!({"view":1,"sheet":"Sheet1"})).code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            apply_err(&mut e, "setSheetView", json!({"view":99})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "removeSheetView", json!({"id":99})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            data(&mut e, "removeSheetView", json!({"id":1}))["ok"],
            json!(true)
        );
        assert!(views(&mut e).is_empty());
    }

    #[test]
    fn save_sheet_view_update_in_place_and_bounds() {
        let mut e = TallyEngine::new();
        // Empty-filter capture is legal (a "no filters" view).
        let v = save(&mut e, "Clean");
        assert_eq!(v["filters"].as_array().unwrap().len(), 0);
        // Same name same sheet updates in place, keeping the id.
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A2"},"criteria":">0"}),
        );
        let v2 = save(&mut e, "clean"); // case-insensitive twin
        assert_eq!(v2["id"], v["id"]);
        assert_eq!(v2["filters"].as_array().unwrap().len(), 1);
        // Identical recapture is eventless.
        let noop = apply(&mut e, "saveSheetView", json!({"name":"CLEAN"}));
        assert!(noop.events.is_empty());
        // Same name on a different sheet is a distinct view.
        data(&mut e, "addSheet", json!({"name":"Two"}));
        data(&mut e, "setActive", json!({"sheet":"Two"}));
        let v3 = save(&mut e, "Clean");
        assert_ne!(v3["id"], v["id"]);
        assert_eq!(v3["sheet"], json!("Two"));
        // Payload validation is atomic.
        let before = e.snapshot().unwrap();
        for (p, code) in [
            (json!({"name":""}), ErrorCode::Validation),
            (json!({"name":"x".repeat(129)}), ErrorCode::Validation),
            (json!({"name":5}), ErrorCode::InvalidCommand),
            (json!({}), ErrorCode::InvalidCommand),
        ] {
            assert_eq!(apply_err(&mut e, "saveSheetView", p.clone()).code, code, "{p}");
            assert_eq!(e.snapshot().unwrap(), before, "{p} mutated");
        }
        // >64 filters on a sheet cannot be captured.
        for i in 0..65u32 {
            data(
                &mut e,
                "setFilter",
                json!({"range":{"from":"A1","to":"A1"},"column":"A","criteria":format!(">{i}")}),
            );
        }
        // The 65 rules all landed on "Two" (the active sheet); the capture
        // cap rejects rather than silently truncating.
        let before_big = e.snapshot().unwrap();
        assert_eq!(
            apply_err(&mut e, "saveSheetView", json!({"name":"Big","sheet":"Two"})).code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(e.snapshot().unwrap(), before_big);
    }

    #[test]
    fn undo_redo_and_sheet_removal_cascade() {
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A3"},"criteria":">1"}),
        );
        save(&mut e, "V1");
        // Undo the save drops the view; redo restores it.
        assert!(e.undo().unwrap());
        assert!(views(&mut e).is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(views(&mut e).len(), 1);
        // Apply, then diverge with a filter; undo restores pre-apply state.
        let before_apply = e.snapshot().unwrap();
        data(&mut e, "setSheetView", json!({"view":1}));
        assert_eq!(filters(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before_apply);
        assert!(e.redo().unwrap());
        // Removing the bound sheet cascade-drops its view into the same
        // undo entry; undo re-admits it with the sheet.
        data(&mut e, "addSheet", json!({"name":"Keep"}));
        data(&mut e, "setActive", json!({"sheet":"Keep"}));
        save(&mut e, "OnKeep");
        assert_eq!(views(&mut e).len(), 2);
        data(&mut e, "removeSheet", json!({"sheet":"Keep"}));
        assert_eq!(views(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(views(&mut e).len(), 2);
        assert!(views(&mut e).iter().any(|v| v["name"] == json!("OnKeep")));
        assert!(e.redo().unwrap());
        assert_eq!(views(&mut e).len(), 1);
        // Undoing addSheet drops views bound to the added sheet too.
        let mut e2 = TallyEngine::new();
        data(&mut e2, "addSheet", json!({"name":"Temp"}));
        data(&mut e2, "setActive", json!({"sheet":"Temp"}));
        save(&mut e2, "TempView");
        assert!(e2.undo().unwrap()); // undo saveSheetView
        assert!(e2.undo().unwrap()); // undo addSheet
        assert!(views(&mut e2).is_empty());
    }

    #[test]
    fn hostile_restore_validates_views() {
        let mut e = TallyEngine::new();
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A3"},"column":"A","criteria":">1"}),
        );
        save(&mut e, "V1");
        data(&mut e, "setSheetView", json!({"view":1}));
        let snap = e.snapshot().unwrap();
        // Round-trip preserves the view and the active selection.
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["views"].as_array().unwrap()[0]["name"], json!("V1"));
        assert_eq!(d["sheets"][0]["active_view"], json!(1));
        let mut e3 = TallyEngine::new();
        e3.restore(&snap).unwrap();
        let listed = data(&mut e3, "listSheetViews", json!({}));
        assert_eq!(listed["views"][0]["active"], json!(true));
        // Crafted payloads fail closed and atomically.
        let doc = data(&mut e, "describe", json!({}));
        let before = e.snapshot().unwrap();
        let mutates: Vec<Box<dyn Fn(&mut Value)>> = vec![
            // duplicate id
            Box::new(|d| {
                let twin = d["views"][0].clone();
                d["views"].as_array_mut().unwrap().push(twin);
            }),
            // missing sheet
            Box::new(|d| d["views"][0]["sheet"] = json!(99)),
            // empty / oversized name
            Box::new(|d| d["views"][0]["name"] = json!("")),
            Box::new(|d| d["views"][0]["name"] = json!("x".repeat(129))),
            // duplicate name on the same sheet
            Box::new(|d| {
                let mut twin = d["views"][0].clone();
                twin["id"] = json!(2);
                d["views"].as_array_mut().unwrap().push(twin);
            }),
            // bad spec range
            Box::new(|d| d["views"][0]["filters"][0]["range"] = json!("nope")),
            // over-cap spec range
            Box::new(|d| d["views"][0]["filters"][0]["range"] = json!("A1:XFD1048576")),
            // bad criteria
            Box::new(|d| d["views"][0]["filters"][0]["criteria"] = json!(">")),
            // column outside the spec range
            Box::new(|d| d["views"][0]["filters"][0]["column"] = json!("Z")),
            // unknown view field (deny_unknown_fields)
            Box::new(|d| d["views"][0]["deferred"] = json!(true)),
            // unknown filter-spec field
            Box::new(|d| d["views"][0]["filters"][0]["id"] = json!(7)),
            // active_view pointing at a missing view
            Box::new(|d| d["sheets"][0]["active_view"] = json!(42)),
            // more captured specs than the per-view cap
            Box::new(|d| {
                d["views"][0]["filters"] = json!(
                    (0..65)
                        .map(|i| json!({"range":"A1:A3","column":"A","criteria":format!(">{i}")}))
                        .collect::<Vec<_>>()
                );
            }),
        ];
        for mutate in mutates {
            let mut bad = doc.clone();
            mutate(&mut bad);
            // views require schema:6 — wrap at the introduced schema so
            // only the field-level check can reject.
            let wrapped = json!({"kind":"tally","schema":6,"document":bad});
            assert!(
                e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap())).is_err(),
                "accepted {wrapped}"
            );
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Non-canonical stored ranges/columns are re-canonicalized on
        // restore, like every other table.
        let mut fixed = doc.clone();
        fixed["views"][0]["filters"][0]["range"] = json!("a3:a1");
        fixed["views"][0]["filters"][0]["column"] = json!("a");
        let wrapped = json!({"kind":"tally","schema":6,"document":fixed});
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        let d = data(&mut e, "describe", json!({}));
        assert_eq!(d["views"][0]["filters"][0]["range"], json!("A1:A3"));
        assert_eq!(d["views"][0]["filters"][0]["column"], json!("A"));
        // next_view repair: id space below max+1 is bumped.
        let mut repaired = doc.clone();
        repaired["next_view"] = json!(1);
        let wrapped = json!({"kind":"tally","schema":6,"document":repaired});
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        let d = data(&mut e, "describe", json!({}));
        assert!(d["next_view"].as_u64().unwrap() > 1);
    }

    #[test]
    fn set_sheet_view_payload_edges() {
        let mut e = TallyEngine::new();
        save(&mut e, "V");
        let before = e.snapshot().unwrap();
        for (p, code) in [
            (json!({}), ErrorCode::InvalidCommand), // missing 'view'
            (json!({"view":"1"}), ErrorCode::InvalidCommand),
            (json!({"view":1.5}), ErrorCode::InvalidCommand),
            (json!({"view":null,"sheet":"Nope"}), ErrorCode::NotFound),
        ] {
            assert_eq!(apply_err(&mut e, "setSheetView", p.clone()).code, code, "{p}");
            assert_eq!(e.snapshot().unwrap(), before, "{p} mutated");
        }
        // view:null on a sheet with no selection is eventless.
        let noop = apply(&mut e, "setSheetView", json!({"view":null}));
        assert!(noop.events.is_empty());
        // Applying an empty-filter view clears the sheet's filters.
        data(
            &mut e,
            "setFilter",
            json!({"range":{"from":"A1","to":"A2"},"criteria":">0"}),
        );
        assert_eq!(filters(&mut e).len(), 1);
        data(&mut e, "setSheetView", json!({"view":1}));
        assert!(filters(&mut e).is_empty());
        assert_eq!(views(&mut e)[0]["active"], json!(true));
    }
}
