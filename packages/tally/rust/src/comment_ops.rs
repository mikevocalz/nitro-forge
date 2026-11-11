//! Durable workbook-level cell/range-anchored comments and the
//! `addComment`/`updateComment`/`removeComment`/`resolveComment`/
//! `reopenComment`/`listComments` ops.
//!
//! Model decision (workbook-persisted, mirroring the rule/spec tables): a
//! comment is a **workbook-level entry** bound to one sheet by durable sheet
//! id — `Comment = { id, sheet: sheet-id, anchor, author?, body, resolved? }`
//! where `anchor` is a canonical `"A1"`/`"A1:B2"` refers_to string (single
//! cell or bounded rectangle, under the shared 16,384-cell cap). At most
//! `MAX_COMMENTS` per workbook; `body` is required non-blank bounded plain
//! text; `author` is an optional bounded display token; `resolved` is a
//! durable flag flipped by `resolveComment`/`reopenComment`.
//!
//! Single-entry, not threaded: NYC-Tron's `CommentThread` carries `replies`,
//! but the engine stores one body per anchor — a thread is a host-side
//! grouping of entries (or a deferred `replies` field), matching the quill
//! comments precedent. No timestamps (the engine is I/O-free with no
//! clock), no mention model.
//!
//! **Anchor semantics are static coordinates**: `anchor` names grid
//! coordinates, not content. `setCell`/`clearCell`/`setRange`/`fillRange`/
//! `fillSeries`/`setFormat`/`clearFormat`/`sortRange` and the filter table
//! never move it — `sortRange` permutes cell contents but a comment stays
//! on the coordinates it was placed on (the honest simple choice; Excel
//! comments likewise stay on their cells when rows are sorted is NOT
//! claimed — this engine documents coordinates, full stop). Row/column
//! insert/delete ops are deferred entirely (backlog), so there is nothing
//! to remap against; when they land, anchors need an explicit remap
//! decision then.
//!
//! `addComment {sheet?,cell|range,author?,body,resolved?}` attaches one
//! entry (`cell` a single address, `range` a `{from,to}` rectangle —
//! exactly one required, canonicalized like the sparkline target).
//! `updateComment {id,author?,body?}` patches author (`null` clears) and/or
//! body; absent fields keep values, an equal patch or no fields is
//! eventless. `removeComment {id}` deletes. `resolveComment`/`reopenComment`
//! `{id}` flip `resolved`; already in the target state is eventless. All
//! mutations record one whole-document undo entry; `removeSheet`
//! cascade-drops the sheet's comments into the same undo entry and undo
//! re-admits each only while it still satisfies the restore invariants
//! (`readd_ok`). `duplicateSheet` does not copy comments (they are bound to
//! the source sheet id) and `moveSheet`/`renameSheet` do not retarget them.
//!
//! `listComments {sheet?,cell?,range?}` is a silent read returning
//! `{id,sheet,sheet_id,anchor,author?,body,resolved}` with the bound
//! sheet's current name resolved. `sheet` (name or index, default: all
//! sheets listed) filters by bound sheet; `cell`/`range` (exactly one,
//! default: no anchor filter) narrow to comments whose anchor *contains*
//! the cell — a single-cell anchor equals it, a range anchor covers it —
//! or *intersects* the range, evaluated on the resolved sheet (default
//! active) since addresses are sheet-relative.
//!
//! Protection: comments are workbook metadata bound to a sheet, so
//! `addComment` guards its target sheet and the id-addressed mutations
//! guard the stored comment's sheet exactly like the other rule tables
//! (see `protection.rs`); `listComments` is ungated.
use super::range_ops::Rect;
use super::*;

/// Maximum comments per workbook.
pub const MAX_COMMENTS: usize = 1024;
/// Comment `body` bound in UTF-8 bytes (plain text, host-rendered).
pub const MAX_COMMENT_BODY_LEN: usize = 8192;
/// Comment `author` bound in UTF-8 bytes.
pub const MAX_COMMENT_AUTHOR_LEN: usize = 128;

/// One durable comment: `id` is a workbook-unique handle, `sheet` the
/// bound sheet id, `anchor` a canonical `"A1"`/`"A1:B2"` coordinate string,
/// `author` an optional bounded display token, `body` required non-blank
/// bounded text, `resolved` the durable open/resolved flag.
/// `deny_unknown_fields` keeps deferred fields (thread replies, mentions,
/// timestamps) from being silently dropped out of hostile payloads.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Comment {
    pub id: u64,
    pub sheet: u64,
    pub anchor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub body: String,
    #[serde(default)]
    pub resolved: bool,
}

/// Inclusive 0-based rectangle of a stored canonical anchor.
fn anchor_coords(anchor: &str) -> Option<name_ops::RefersCoords> {
    name_ops::parse_refers_to(anchor).ok()
}

fn cell_count(coords: name_ops::RefersCoords) -> u64 {
    u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
}

/// Canonical in-cap anchor: parses, re-canonicalizes and caps at the
/// shared 16,384-cell bound.
fn anchor_ok(anchor: &str) -> bool {
    anchor_coords(anchor).is_some_and(|c| {
        name_ops::canonical_refers_to(c) == anchor && cell_count(c) <= MAX_GET_RANGE_CELLS
    })
}

/// Author legality shared by ops and hostile restore: non-blank, bounded,
/// no control characters.
fn valid_author(author: &str) -> bool {
    !author.trim().is_empty()
        && author.len() <= MAX_COMMENT_AUTHOR_LEN
        && !author.chars().any(|c| c.is_control())
}

/// Body legality shared by ops and hostile restore: non-blank, bounded.
fn valid_body(body: &str) -> bool {
    !body.trim().is_empty() && body.len() <= MAX_COMMENT_BODY_LEN
}

/// Field-level check shared by hostile-restore (after canonicalization)
/// and undo re-admission: legal author/body, canonical in-cap anchor.
/// Bound-sheet existence and id uniqueness are checked by the caller.
pub(super) fn stored_ok(c: &Comment) -> bool {
    anchor_ok(&c.anchor)
        && c.author.as_deref().is_none_or(valid_author)
        && valid_body(&c.body)
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped comment
/// comes back only while it still satisfies every invariant `restore`
/// enforces — bound sheet exists, unique id, under the cap, stored fields
/// valid. Comments cannot be created for a sheet while it is gone (sheet
/// ids are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, comment: &Comment) -> bool {
    doc.comments.len() < MAX_COMMENTS
        && !doc.comments.iter().any(|c| c.id == comment.id)
        && doc.sheets.iter().any(|s| s.id == comment.sheet)
        && stored_ok(comment)
}

impl TallyEngine {
    /// JSON view of one comment with its bound sheet's *current* name
    /// resolved.
    fn comment_json(&self, c: &Comment) -> Result<Value, EngineError> {
        let sheet = self
            .doc
            .sheets
            .iter()
            .find(|s| s.id == c.sheet)
            .map(|s| s.name.clone());
        let mut out = serde_json::Map::new();
        out.insert("id".to_string(), json!(c.id));
        out.insert("sheet".to_string(), json!(sheet));
        out.insert("sheet_id".to_string(), json!(c.sheet));
        out.insert("anchor".to_string(), json!(c.anchor));
        if let Some(author) = &c.author {
            out.insert("author".to_string(), json!(author));
        }
        out.insert("body".to_string(), json!(c.body));
        out.insert("resolved".to_string(), json!(c.resolved));
        Ok(Value::Object(out))
    }

    /// Canonical anchor string for `addComment`/`listComments`: exactly one
    /// of `cell` (a single address) or `range` (`{from,to}`), mirroring the
    /// sparkline target selector.
    fn comment_anchor(&self, p: &Value) -> Result<String, EngineError> {
        let has_cell = p.get("cell").is_some_and(|v| !v.is_null());
        let has_range = p.get("range").is_some_and(|v| !v.is_null());
        match (has_cell, has_range) {
            (true, false) => Ok(Self::addr_field(p, "cell")?),
            (false, true) => {
                let rect = Rect::read(Self::field(p, "range")?)?;
                Ok(name_ops::canonical_refers_to(rect.coords()))
            }
            _ => Err(EngineError::invalid(
                "comment anchor requires exactly one of 'cell' or 'range'",
            )),
        }
    }

    /// `addComment {sheet?,cell|range,author?,body,resolved?}` — attach one
    /// comment to a cell or range anchor on the resolved sheet (default
    /// active). Ids are engine-assigned; there is no eventless path.
    pub(super) fn op_add_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let anchor = self.comment_anchor(p)?;
        let author = match p.get("author") {
            Some(v) if v.is_null() => None,
            Some(v) => {
                let a = v
                    .as_str()
                    .ok_or_else(|| EngineError::invalid("'author' must be a string"))?;
                if !valid_author(a) {
                    return Err(EngineError::validation(format!(
                        "comment author must be 1-{MAX_COMMENT_AUTHOR_LEN} bytes without control characters"
                    )));
                }
                Some(a.to_string())
            }
            None => None,
        };
        let body = Self::str_field(p, "body")?;
        if !valid_body(body) {
            return Err(EngineError::validation(format!(
                "comment body must be 1-{MAX_COMMENT_BODY_LEN} bytes of non-blank text"
            )));
        }
        let resolved = match p.get("resolved") {
            Some(v) => v
                .as_bool()
                .ok_or_else(|| EngineError::invalid("'resolved' must be a bool"))?,
            None => false,
        };
        if self.doc.comments.len() >= MAX_COMMENTS {
            return Err(EngineError::out_of_bounds(format!(
                "comment limit of {MAX_COMMENTS} reached"
            )));
        }
        let id = self.doc.next_comment;
        self.doc.next_comment = self
            .doc
            .next_comment
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("comment id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let comment = Comment {
            id,
            sheet: sheet_id,
            anchor,
            author,
            body: body.to_string(),
            resolved,
        };
        self.doc.comments.push(comment.clone());
        Ok(Self::changed(json!({
            "comment": self.comment_json(&comment)?
        })))
    }

    /// `updateComment {id,author?,body?}` — patch author (`null` clears)
    /// and/or body; absent fields keep their values. Anchors are not
    /// re-pointable (coordinates are static). No fields or an equal patch
    /// is eventless.
    pub(super) fn op_update_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .comments
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no comment {id}")))?;
        let mut updated = self.doc.comments[pos].clone();
        let mut touched = false;
        if let Some(v) = p.get("author") {
            touched = true;
            updated.author = if v.is_null() {
                None
            } else {
                let a = v
                    .as_str()
                    .ok_or_else(|| EngineError::invalid("'author' must be a string"))?;
                if !valid_author(a) {
                    return Err(EngineError::validation(format!(
                        "comment author must be 1-{MAX_COMMENT_AUTHOR_LEN} bytes without control characters"
                    )));
                }
                Some(a.to_string())
            };
        }
        if let Some(v) = p.get("body") {
            touched = true;
            let b = v
                .as_str()
                .ok_or_else(|| EngineError::invalid("'body' must be a string"))?;
            if !valid_body(b) {
                return Err(EngineError::validation(format!(
                    "comment body must be 1-{MAX_COMMENT_BODY_LEN} bytes of non-blank text"
                )));
            }
            updated.body = b.to_string();
        }
        if !touched || updated == self.doc.comments[pos] {
            return Ok(Self::readonly(json!({
                "comment": self.comment_json(&self.doc.comments[pos].clone())?
            })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.comments[pos] = updated.clone();
        Ok(Self::changed(json!({
            "comment": self.comment_json(&updated)?
        })))
    }

    /// `removeComment {id}` — delete one comment; unknown ids reject.
    pub(super) fn op_remove_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .comments
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no comment {id}")))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.comments.remove(pos);
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// `resolveComment {id}` / `reopenComment {id}` — flip the durable
    /// `resolved` flag; already in the target state is eventless.
    pub(super) fn op_resolve_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.set_comment_resolved(p, true)
    }

    pub(super) fn op_reopen_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.set_comment_resolved(p, false)
    }

    fn set_comment_resolved(&mut self, p: &Value, resolved: bool) -> Result<CommandResult, EngineError> {
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .comments
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no comment {id}")))?;
        if self.doc.comments[pos].resolved == resolved {
            return Ok(Self::readonly(json!({
                "comment": self.comment_json(&self.doc.comments[pos].clone())?
            })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.comments[pos].resolved = resolved;
        Ok(Self::changed(json!({
            "comment": self.comment_json(&self.doc.comments[pos].clone())?
        })))
    }

    /// `listComments {sheet?,cell?,range?}` — silent read; `sheet` absent
    /// lists every comment, present filters to that sheet. `cell`/`range`
    /// (exactly one, mutually exclusive) narrow to anchors containing the
    /// cell or intersecting the range on the resolved sheet (default
    /// active).
    pub(super) fn op_list_comments(&self, p: &Value) -> Result<CommandResult, EngineError> {
        // Optional anchor filter: exactly one of cell/range when present.
        let anchor_filter = match (
            p.get("cell").is_some_and(|v| !v.is_null()),
            p.get("range").is_some_and(|v| !v.is_null()),
        ) {
            (true, false) => {
                let (c, r) = Self::addr_coords(p, "cell")?;
                Some((c, r, c, r))
            }
            (false, true) => {
                let rect = Rect::read(Self::field(p, "range")?)?;
                Some(rect.coords())
            }
            (false, false) => None,
            (true, true) => {
                return Err(EngineError::invalid(
                    "listComments 'cell' and 'range' cannot be combined",
                ))
            }
        };
        // Resolve the sheet scope: explicit `sheet`, else the active sheet
        // when an anchor filter is given, else every sheet.
        let sheet_filter: Option<u64> = match p.get("sheet") {
            None | Some(Value::Null) => {
                if anchor_filter.is_some() {
                    Some(self.doc.sheets[self.doc.active].id)
                } else {
                    None
                }
            }
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                Some(self.doc.sheets[idx].id)
            }
        };
        let mut out = Vec::new();
        for c in &self.doc.comments {
            if sheet_filter.is_some_and(|id| id != c.sheet) {
                continue;
            }
            if let Some((fc0, fr0, fc1, fr1)) = anchor_filter {
                let Some((ac0, ar0, ac1, ar1)) = anchor_coords(&c.anchor) else {
                    continue;
                };
                // `cell` queries are 1x1 rects: containment and
                // intersection coincide, so one overlap test serves both.
                if ac0 > fc1 || fc0 > ac1 || ar0 > fr1 || fr0 > ar1 {
                    continue;
                }
            }
            out.push(self.comment_json(c)?);
        }
        Ok(Self::readonly(json!({ "comments": out })))
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
    fn comments(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "listComments", json!({}))["comments"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn add(e: &mut TallyEngine, p: Value) -> Value {
        data(e, "addComment", p)["comment"].clone()
    }

    #[test]
    fn add_update_resolve_remove_roundtrip() {
        let mut e = TallyEngine::new();
        let c = add(
            &mut e,
            json!({"cell":"B2","author":"Ada","body":"check this"}),
        );
        assert_eq!(c["id"], json!(1));
        assert_eq!(c["anchor"], json!("B2"));
        assert_eq!(c["sheet"], json!("Sheet1"));
        assert_eq!(c["author"], json!("Ada"));
        assert_eq!(c["body"], json!("check this"));
        assert_eq!(c["resolved"], json!(false));
        assert!(c.get("sheet_id").is_some());
        // describe exposes the stored table.
        let d = data(&mut e, "describe", json!({}));
        assert_eq!(d["comments"].as_array().unwrap().len(), 1);
        assert_eq!(comments(&mut e).len(), 1);

        // Range anchor canonicalizes endpoint order and $ markers.
        let c2 = add(
            &mut e,
            json!({"range":{"from":"$d$4","to":"c$3"},"body":"range note"}),
        );
        assert_eq!(c2["id"], json!(2));
        assert_eq!(c2["anchor"], json!("C3:D4"));
        assert!(c2.get("author").is_none()); // absent author omitted

        // resolved flag at add time.
        let c3 = add(&mut e, json!({"cell":"A1","body":"done","resolved":true}));
        assert_eq!(c3["resolved"], json!(true));

        // updateComment partial patch; author:null clears; equal is eventless.
        let r = data(&mut e, "updateComment", json!({"id":1,"body":"revised"}));
        assert_eq!(r["comment"]["body"], json!("revised"));
        assert_eq!(r["comment"]["author"], json!("Ada")); // untouched
        let noop = apply(&mut e, "updateComment", json!({"id":1}));
        assert!(noop.events.is_empty());
        let noop = apply(&mut e, "updateComment", json!({"id":1,"body":"revised"}));
        assert!(noop.events.is_empty());
        let r = data(&mut e, "updateComment", json!({"id":1,"author":null}));
        assert!(r["comment"].get("author").is_none());

        // resolve/reopen with eventless repeats.
        let r = data(&mut e, "resolveComment", json!({"id":2}));
        assert_eq!(r["comment"]["resolved"], json!(true));
        let noop = apply(&mut e, "resolveComment", json!({"id":2}));
        assert!(noop.events.is_empty());
        let r = data(&mut e, "reopenComment", json!({"id":2}));
        assert_eq!(r["comment"]["resolved"], json!(false));

        // removeComment; unknown ids reject.
        let r = data(&mut e, "removeComment", json!({"id":3}));
        assert_eq!(r["ok"], json!(true));
        assert_eq!(comments(&mut e).len(), 2);
        assert_eq!(
            apply_err(&mut e, "removeComment", json!({"id":3})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "resolveComment", json!({"id":99})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "updateComment", json!({"id":99,"body":"x"})).code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn add_comment_payload_validation_is_atomic() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        for (p, code) in [
            // missing anchor / body
            (json!({"body":"x"}), ErrorCode::InvalidCommand),
            (json!({"cell":"A1"}), ErrorCode::InvalidCommand),
            // both cell and range / neither via nulls
            (json!({"cell":"A1","range":{"from":"A1","to":"A1"},"body":"x"}), ErrorCode::InvalidCommand),
            (json!({"cell":null,"range":null,"body":"x"}), ErrorCode::InvalidCommand),
            // bad anchor addresses / over-cap range
            (json!({"cell":"A0","body":"x"}), ErrorCode::Validation),
            (json!({"cell":"XFE1","body":"x"}), ErrorCode::OutOfBounds),
            (json!({"range":{"from":"A1","to":"A16385"},"body":"x"}), ErrorCode::OutOfBounds),
            // bad body / author / resolved
            (json!({"cell":"A1","body":""}), ErrorCode::Validation),
            (json!({"cell":"A1","body":"   "}), ErrorCode::Validation),
            (json!({"cell":"A1","body":"x".repeat(MAX_COMMENT_BODY_LEN + 1)}), ErrorCode::Validation),
            (json!({"cell":"A1","body":"x","author":""}), ErrorCode::Validation),
            (json!({"cell":"A1","body":"x","author":"a\nb"}), ErrorCode::Validation),
            (json!({"cell":"A1","body":"x","author":"y".repeat(MAX_COMMENT_AUTHOR_LEN + 1)}), ErrorCode::Validation),
            (json!({"cell":"A1","body":"x","resolved":"yes"}), ErrorCode::InvalidCommand),
            (json!({"cell":"A1","body":42}), ErrorCode::InvalidCommand),
            // missing sheet
            (json!({"sheet":"Missing","cell":"A1","body":"x"}), ErrorCode::NotFound),
        ] {
            assert_eq!(apply_err(&mut e, "addComment", p.clone()).code, code, "{p}");
            assert_eq!(e.snapshot().unwrap(), before, "{p} mutated");
        }
        // Cap: MAX_COMMENTS entries then out_of_bounds.
        for i in 0..MAX_COMMENTS {
            add(&mut e, json!({"cell":format!("A{}", i + 1),"body":"x"}));
        }
        assert_eq!(
            apply_err(&mut e, "addComment", json!({"cell":"Z9","body":"x"})).code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn list_comments_filters() {
        let mut e = TallyEngine::new();
        add(&mut e, json!({"cell":"B2","body":"on B2"}));
        add(&mut e, json!({"range":{"from":"C3","to":"D4"},"body":"on range"}));
        add(&mut e, json!({"cell":"B2","body":"second on B2","author":"Bo"}));
        data(&mut e, "addSheet", json!({"name":"Other"}));
        add(&mut e, json!({"sheet":"Other","cell":"B2","body":"other sheet"}));

        // No filter: all four, doc order.
        assert_eq!(comments(&mut e).len(), 4);
        // Sheet filter.
        assert_eq!(
            data(&mut e, "listComments", json!({"sheet":"Other"}))["comments"]
                .as_array().unwrap().len(),
            1
        );
        // cell filter on active sheet (Sheet1 is still active? addSheet
        // does not switch active — active stays Sheet1).
        let on_b2 = data(&mut e, "listComments", json!({"cell":"B2"}))["comments"]
            .as_array().unwrap().clone();
        assert_eq!(on_b2.len(), 2); // both Sheet1 B2 comments; Other's excluded
        // range filter intersects the C3:D4 anchor.
        let hit = data(
            &mut e,
            "listComments",
            json!({"range":{"from":"D4","to":"E5"}}),
        )["comments"]
        .as_array().unwrap().clone();
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0]["body"], json!("on range"));
        // cell inside the range anchor also matches (containment).
        let inside = data(&mut e, "listComments", json!({"cell":"C4"}))["comments"]
            .as_array().unwrap().clone();
        assert_eq!(inside.len(), 1);
        assert_eq!(inside[0]["body"], json!("on range"));
        // cell+range together reject; bad sheet rejects; reads are
        // eventless.
        let r = apply(&mut e, "listComments", json!({}));
        assert!(r.events.is_empty());
        assert!(e
            .apply(Command::new(
                "listComments",
                json!({"cell":"A1","range":{"from":"A1","to":"A1"}}),
            ))
            .is_err());
        assert_eq!(
            apply_err(&mut e, "listComments", json!({"sheet":"Missing"})).code,
            ErrorCode::NotFound
        );
        assert_eq!(
            apply_err(&mut e, "listComments", json!({"cell":"A0"})).code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn undo_redo_and_sheet_removal_cascade() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        add(&mut e, json!({"cell":"A1","body":"on sheet1"}));
        add(&mut e, json!({"sheet":"Data","cell":"A1","body":"on data"}));
        assert_eq!(comments(&mut e).len(), 2);
        // Undo the second add.
        assert!(e.undo().unwrap());
        assert_eq!(comments(&mut e).len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(comments(&mut e).len(), 2);
        // update + resolve undo individually.
        data(&mut e, "updateComment", json!({"id":1,"body":"edited"}));
        assert!(e.undo().unwrap());
        assert_eq!(comments(&mut e)[0]["body"], json!("on sheet1"));
        data(&mut e, "resolveComment", json!({"id":1}));
        assert!(e.undo().unwrap());
        assert_eq!(comments(&mut e)[0]["resolved"], json!(false));
        // Removing Data cascade-drops its comment into the same undo entry.
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert_eq!(comments(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(comments(&mut e).len(), 2);
        assert!(comments(&mut e).iter().any(|c| c["sheet"] == json!("Data")));
        assert!(e.redo().unwrap());
        assert_eq!(comments(&mut e).len(), 1);
        // Undoing addSheet drops comments bound to the added sheet too.
        let mut e2 = TallyEngine::new();
        data(&mut e2, "addSheet", json!({"name":"Temp"}));
        add(&mut e2, json!({"sheet":"Temp","cell":"A1","body":"temp"}));
        assert!(e2.undo().unwrap()); // undo addComment
        assert!(e2.undo().unwrap()); // undo addSheet
        assert!(comments(&mut e2).is_empty());
        assert!(e2.redo().unwrap());
        assert!(e2.redo().unwrap());
        assert_eq!(comments(&mut e2).len(), 1);
    }

    #[test]
    fn snapshot_roundtrip_and_hostile_restore() {
        let mut e = TallyEngine::new();
        add(&mut e, json!({"cell":"b2","author":"Ada","body":"note","resolved":true}));
        add(&mut e, json!({"range":{"from":"C3","to":"D4"},"body":"range"}));
        let saved = e.snapshot().unwrap();
        // schema:7 wrapper (comments are the newest table).
        let (_tag, payload) = decode_envelope(&saved).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["kind"], json!("tally"));
        assert_eq!(v["schema"], json!(7));
        let mut e2 = TallyEngine::new();
        e2.restore(&saved).unwrap();
        let cs = comments(&mut e2);
        assert_eq!(cs.len(), 2);
        assert_eq!(cs[0]["anchor"], json!("B2")); // canonicalized on restore too
        assert_eq!(cs[0]["resolved"], json!(true));
        assert_eq!(cs[1]["anchor"], json!("C3:D4"));
        // next_comment repaired above max id: a third add gets id 3.
        let c = data(&mut e2, "addComment", json!({"cell":"A1","body":"x"}))["comment"].clone();
        assert_eq!(c["id"], json!(3));

        // Hostile restores fail closed and atomically.
        let doc = json!({
            "next_sheet":1,
            "next_comment":1,
            "sheets":[{"id":0,"name":"S","cells":{}}],
            "active":0,
            "comments":[{"id":1,"sheet":0,"anchor":"A1","body":"ok"}]
        });
        let good = json!({"kind":"tally","schema":7,"document":doc});
        let mut e3 = TallyEngine::new();
        e3.restore(&encode_envelope(&serde_json::to_vec(&good).unwrap())).unwrap();
        assert_eq!(comments(&mut e3).len(), 1);
        // Non-canonical-but-parseable anchors re-canonicalize on restore
        // like every other refers_to table.
        let mut flipped = doc.clone();
        flipped["comments"][0]["anchor"] = json!("B2:A1");
        let mut e4 = TallyEngine::new();
        e4.restore(&encode_envelope(
            &serde_json::to_vec(&json!({"kind":"tally","schema":7,"document":flipped})).unwrap(),
        ))
        .unwrap();
        assert_eq!(comments(&mut e4)[0]["anchor"], json!("A1:B2"));

        let base = data(&mut e3, "describe", json!({}));
        let hostile = [
            // comments under a lower schema
            json!({"kind":"tally","schema":6,"document":doc}),
            // bare workbook carrying comments
            doc.clone(),
            // duplicate ids
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":2,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[
                    {"id":1,"sheet":0,"anchor":"A1","body":"a"},
                    {"id":1,"sheet":0,"anchor":"B1","body":"b"}
                ]}}),
            // missing sheet binding
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":9,"anchor":"A1","body":"a"}]}}),
            // unparseable / off-sheet / over-cap anchors
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":0,"anchor":"A0","body":"a"}]}}),
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":0,"anchor":"A1048577","body":"a"}]}}),
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":0,"anchor":"A1:XFD1048576","body":"a"}]}}),
            // blank / oversized body, bad author, non-bool resolved
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":0,"anchor":"A1","body":"  "}]}}),
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":0,"anchor":"A1","body":"a","author":"x".repeat(MAX_COMMENT_AUTHOR_LEN + 1)}]}}),
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":0,"anchor":"A1","body":"a","resolved":"yes"}]}}),
            // unknown fields reject (deny_unknown_fields: replies etc.)
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":[{"id":1,"sheet":0,"anchor":"A1","body":"a","replies":[]}]}}),
            // over-cap table
            json!({"kind":"tally","schema":7,"document":{
                "next_sheet":1,"next_comment":1,
                "sheets":[{"id":0,"name":"S","cells":{}}],"active":0,
                "comments":(0..=MAX_COMMENTS).map(|i| json!({
                    "id":i as u64 + 1,"sheet":0,"anchor":"A1","body":"x"
                })).collect::<Vec<_>>()}}),
        ];
        for payload in hostile {
            let bytes = encode_envelope(&serde_json::to_vec(&payload).unwrap());
            assert!(e3.restore(&bytes).is_err(), "accepted {payload}");
            assert_eq!(data(&mut e3, "describe", json!({})), base, "state mutated by {payload}");
        }
    }
}
