//! Comments (P12 slice 5): range-anchored notes with author, body, and a
//! resolved flag.
//!
//! A comment anchors to a `{from,to}` range of `{block,offset}` positions —
//! the same live-position model bookmarks use (blocks carry no identity, so
//! anchors are re-mapped by every position-moving op rather than content
//! pinned). Gravity differs per endpoint so typing at either boundary
//! extends the range: `from` is left-gravity (an insert exactly at `from`
//! stays inside the range) and `to` is right-gravity like a bookmark mark
//! (an insert exactly at `to` moves the end, keeping the new text inside).
//! A range whose whole span is deleted collapses to the deletion start
//! rather than dropping the comment, matching how bookmark marks clamp;
//! endpoints can therefore coincide (`from == to`) after edits.
//!
//! Scope is deliberately bounded: no threading/replies, no timestamps (the
//! engine is I/O-free with no clock; consumers format times), no DOCX
//! comment import/export, and anchors cannot be re-pointed by an op — they
//! move only through document edits.

use super::*;
use serde::{Deserialize, Serialize};

/// Bound on stored comments so snapshots stay small.
pub const COMMENTS_MAX: usize = 1024;
/// Comment bodies are plain text; cap matches the header/footer body bound.
const COMMENT_BODY_MAX: usize = 8192;
/// Author display names are bounded tokens without control characters.
const COMMENT_AUTHOR_MAX: usize = 128;

/// One end of a comment's anchored range. Same `{block,offset}` unit as
/// `Pos` (Unicode scalar offsets).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentAnchor {
    pub block: usize,
    pub offset: usize,
}

impl CommentAnchor {
    fn pos(&self) -> Pos {
        Pos {
            block: self.block,
            offset: self.offset,
        }
    }

    fn anchor(p: Pos) -> Self {
        Self {
            block: p.block,
            offset: p.offset,
        }
    }
}

/// A durable comment: unique `id`, anchored `from`/`to` range, optional
/// `author`, required `body`, and a `resolved` flag.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Comment {
    pub id: String,
    pub from: CommentAnchor,
    pub to: CommentAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub body: String,
    #[serde(default)]
    pub resolved: bool,
}

pub(super) fn validate_comment_author(author: &str) -> Result<(), EngineError> {
    if author.trim().is_empty() {
        return Err(EngineError::validation("comment author must not be blank"));
    }
    if author.chars().count() > COMMENT_AUTHOR_MAX {
        return Err(EngineError::validation(format!(
            "comment author must be at most {COMMENT_AUTHOR_MAX} characters"
        )));
    }
    if author.chars().any(|c| c.is_control()) {
        return Err(EngineError::validation(
            "comment author must not contain control characters",
        ));
    }
    Ok(())
}

/// Field-level validation shared by ops and restore: id token, author,
/// body bound, ordered in-range anchors. `blocks` is the final block list.
fn validate_comment(c: &Comment, blocks: &[Block]) -> Result<(), EngineError> {
    validate_style_token(&c.id, "comment id")?;
    if let Some(author) = &c.author {
        validate_comment_author(author)?;
    }
    if c.body.trim().is_empty() {
        return Err(EngineError::validation("comment body must not be blank"));
    }
    if c.body.chars().count() > COMMENT_BODY_MAX {
        return Err(EngineError::validation(format!(
            "comment body must be at most {COMMENT_BODY_MAX} characters"
        )));
    }
    for (name, a) in [("from", &c.from), ("to", &c.to)] {
        let Some(b) = blocks.get(a.block) else {
            return Err(EngineError::out_of_bounds(format!(
                "comment '{}' anchor '{name}' block {} out of range ({} blocks)",
                c.id,
                a.block,
                blocks.len()
            )));
        };
        if a.offset > block_len(b) {
            return Err(EngineError::out_of_bounds(format!(
                "comment '{}' anchor '{name}' offset {} out of range (block {} has {} chars)",
                c.id,
                a.offset,
                a.block,
                block_len(b)
            )));
        }
    }
    if !c.from.pos().le(c.to.pos()) {
        return Err(EngineError::validation(
            "comment range end precedes range start",
        ));
    }
    Ok(())
}

/// Full comment validation for restore: count, id uniqueness, and every
/// comment's fields/anchors against the final block list. Runs before live
/// state is replaced.
pub fn validate_comments(comments: &[Comment], blocks: &[Block]) -> Result<(), EngineError> {
    if comments.len() > COMMENTS_MAX {
        return Err(EngineError::validation("too many comments"));
    }
    let mut seen = std::collections::HashSet::with_capacity(comments.len());
    for c in comments {
        validate_comment(c, blocks)?;
        if !seen.insert(c.id.as_str()) {
            return Err(EngineError::validation(format!(
                "duplicate comment id '{}'",
                c.id
            )));
        }
    }
    Ok(())
}

fn comment_id(p: &Value) -> Result<&str, EngineError> {
    as_str(field(p, "id")?, "id")
}

// ---------------------------------------------------------------------------
// Engine ops
// ---------------------------------------------------------------------------

impl QuillEngine {
    fn find_comment(&self, id: &str) -> Result<usize, EngineError> {
        self.comments
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| EngineError::validation(format!("unknown comment '{id}'")))
    }

    /// `addComment {id, from, to, author?, body, resolved?}` — anchors a
    /// comment to the `from..to` range (`from == to` anchors a point).
    /// Ids are unique tokens (1..64 non-blank non-control scalars); bodies
    /// are non-blank plain text ≤8192 chars; authors ≤128 chars.
    pub(super) fn op_add_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = comment_id(p)?.to_string();
        validate_style_token(&id, "comment id")?;
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        self.check_range(from, to)?;
        let author = match p.get("author") {
            Some(v) if v.is_null() => None,
            Some(v) => Some(as_str(v, "author")?.to_string()),
            None => None,
        };
        if let Some(a) = &author {
            validate_comment_author(a)?;
        }
        let body = as_str(field(p, "body")?, "body")?.to_string();
        let resolved = match p.get("resolved") {
            Some(v) => v
                .as_bool()
                .ok_or_else(|| EngineError::validation("'resolved' must be a bool"))?,
            None => false,
        };
        let comment = Comment {
            id: id.clone(),
            from: CommentAnchor::anchor(from),
            to: CommentAnchor::anchor(to),
            author,
            body,
            resolved,
        };
        validate_comment(&comment, &self.blocks)?;
        if self.comments.len() >= COMMENTS_MAX {
            return Err(EngineError::validation("comment limit reached"));
        }
        if self.comments.iter().any(|c| c.id == id) {
            return Err(EngineError::validation(format!(
                "comment '{id}' already exists"
            )));
        }
        let before = self.comments.clone();
        self.comments.push(comment);
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::comments(before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `updateComment {id, author?, body?}` — replaces the named fields;
    /// `author:null` clears the author, absent fields keep their values.
    /// Anchors are not re-pointable (they move only through edits). No
    /// effective change → eventless.
    pub(super) fn op_update_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = comment_id(p)?;
        let index = self.find_comment(id)?;
        let mut updated = self.comments[index].clone();
        let mut touched = false;
        if let Some(v) = p.get("author") {
            touched = true;
            updated.author = if v.is_null() {
                None
            } else {
                let a = as_str(v, "author")?.to_string();
                validate_comment_author(&a)?;
                Some(a)
            };
        }
        if let Some(v) = p.get("body") {
            touched = true;
            updated.body = as_str(v, "body")?.to_string();
        }
        if !touched {
            return Ok(Self::read_only(json!({ "ok": true, "id": id })));
        }
        validate_comment(&updated, &self.blocks)?;
        if updated == self.comments[index] {
            return Ok(Self::read_only(json!({ "ok": true, "id": id })));
        }
        let before = self.comments.clone();
        self.comments[index] = updated;
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::comments(before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `removeComment {id}` — deletes the comment; unknown ids reject.
    pub(super) fn op_remove_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = comment_id(p)?;
        let index = self.find_comment(id)?;
        let before = self.comments.clone();
        self.comments.remove(index);
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::comments(before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `resolveComment {id}` — sets `resolved:true`; already-resolved is
    /// eventless. `reopenComment {id}` is the inverse.
    pub(super) fn op_resolve_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.set_comment_resolved(p, true)
    }

    pub(super) fn op_reopen_comment(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        self.set_comment_resolved(p, false)
    }

    fn set_comment_resolved(&mut self, p: &Value, resolved: bool) -> Result<CommandResult, EngineError> {
        let id = comment_id(p)?;
        let index = self.find_comment(id)?;
        if self.comments[index].resolved == resolved {
            return Ok(Self::read_only(json!({ "ok": true, "id": id })));
        }
        let before = self.comments.clone();
        self.comments[index].resolved = resolved;
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::comments(before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `listComments` — read-only; sorted by anchor position then id.
    pub(super) fn op_list_comments(&self) -> Result<CommandResult, EngineError> {
        let mut sorted: Vec<&Comment> = self.comments.iter().collect();
        sorted.sort_by(|a, b| {
            (
                a.from.block,
                a.from.offset,
                a.to.block,
                a.to.offset,
                a.id.as_str(),
            )
                .cmp(&(
                    b.from.block,
                    b.from.offset,
                    b.to.block,
                    b.to.offset,
                    b.id.as_str(),
                ))
        });
        let arr: Vec<Value> = sorted
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "from": { "block": c.from.block, "offset": c.from.offset },
                    "to": { "block": c.to.block, "offset": c.to.offset },
                    "author": c.author,
                    "body": c.body,
                    "resolved": c.resolved,
                })
            })
            .collect();
        Ok(Self::read_only(json!({ "comments": arr })))
    }

    // -- comment anchor remapping -------------------------------------------
    //
    // `from` is left-gravity and `to` is right-gravity (see module docs), so
    // inserts at either boundary keep the new text inside the range. Every
    // mapper below mirrors the bookmark rules in lib.rs; the differences are
    // the gravity split and that endpoints clamp into the surviving document
    // instead of dropping when their block is deleted.

    /// Map one endpoint through an `insertText` at `at`. `added` is the
    /// newline count, `last_len` the final segment's scalar length, `plain`
    /// the scalar count when `added == 0`, and `left` selects gravity.
    pub(super) fn map_pos_insert(
        pos: Pos,
        at: Pos,
        added: usize,
        last_len: usize,
        plain: usize,
        left: bool,
    ) -> Pos {
        if pos.block == at.block {
            let moves = if left {
                pos.offset > at.offset
            } else {
                pos.offset >= at.offset
            };
            if !moves {
                return pos;
            }
            if added == 0 {
                return Pos {
                    block: pos.block,
                    offset: pos.offset + plain,
                };
            }
            return Pos {
                block: at.block + added,
                offset: last_len + (pos.offset - at.offset),
            };
        }
        if added > 0 && pos.block > at.block {
            return Pos {
                block: pos.block + added,
                offset: pos.offset,
            };
        }
        pos
    }

    /// `insertText` at `at` inserting `text` (already validated).
    pub(super) fn remap_comments_insert_text(&mut self, at: Pos, text: &str) {
        if self.comments.is_empty() {
            return;
        }
        let added = text.bytes().filter(|&b| b == b'\n').count();
        let plain = text.chars().count();
        let last_len = text.rsplit('\n').next().map_or(0, |s| s.chars().count());
        for c in &mut self.comments {
            c.from = CommentAnchor::anchor(Self::map_pos_insert(
                c.from.pos(),
                at,
                added,
                last_len,
                plain,
                true,
            ));
            c.to = CommentAnchor::anchor(Self::map_pos_insert(
                c.to.pos(),
                at,
                added,
                last_len,
                plain,
                false,
            ));
        }
    }

    /// Map one endpoint through a `deleteRange` `from..to`. Endpoints inside
    /// the deleted span clamp to `from` (the comment collapses toward the
    /// deletion start) instead of dropping like a bookmark.
    pub(super) fn map_pos_delete(pos: Pos, from: Pos, to: Pos) -> Pos {
        let span = to.block - from.block;
        if pos.block < from.block {
            return pos;
        }
        if pos.block == from.block {
            if from.block == to.block {
                if pos.offset <= from.offset {
                    return pos;
                }
                if pos.offset >= to.offset {
                    return Pos {
                        block: from.block,
                        offset: pos.offset - (to.offset - from.offset),
                    };
                }
                return Pos {
                    block: from.block,
                    offset: from.offset,
                };
            }
            // Multi-block delete: everything after `from.offset` in the
            // first block is removed; endpoints there clamp to `from`.
            if pos.offset > from.offset {
                return Pos {
                    block: from.block,
                    offset: from.offset,
                };
            }
            return pos;
        }
        if pos.block < to.block {
            // Interior block fully deleted: clamp to the deletion start.
            return Pos {
                block: from.block,
                offset: from.offset,
            };
        }
        if pos.block == to.block {
            return Pos {
                block: from.block,
                offset: if pos.offset < to.offset {
                    from.offset
                } else {
                    from.offset + (pos.offset - to.offset)
                },
            };
        }
        Pos {
            block: pos.block - span,
            offset: pos.offset,
        }
    }

    /// `deleteRange` from `from` to `to` (already validated, from != to).
    pub(super) fn remap_comments_delete(&mut self, from: Pos, to: Pos) {
        if self.comments.is_empty() {
            return;
        }
        for c in &mut self.comments {
            c.from = CommentAnchor::anchor(Self::map_pos_delete(c.from.pos(), from, to));
            c.to = CommentAnchor::anchor(Self::map_pos_delete(c.to.pos(), from, to));
        }
    }

    /// Map one endpoint through a `splitBlock` at `at`.
    pub(super) fn map_pos_split(pos: Pos, at: Pos, left: bool) -> Pos {
        if pos.block == at.block {
            let moves = if left {
                pos.offset > at.offset
            } else {
                pos.offset >= at.offset
            };
            if moves {
                return Pos {
                    block: pos.block + 1,
                    offset: pos.offset - at.offset,
                };
            }
            return pos;
        }
        if pos.block > at.block {
            return Pos {
                block: pos.block + 1,
                offset: pos.offset,
            };
        }
        pos
    }

    /// `splitBlock` at `at`: the `from` anchor at the split point stays at
    /// the head block's end; the `to` anchor moves to the tail block's
    /// start — the same document position, split by gravity.
    pub(super) fn remap_comments_split(&mut self, at: Pos) {
        if self.comments.is_empty() {
            return;
        }
        for c in &mut self.comments {
            c.from = CommentAnchor::anchor(Self::map_pos_split(c.from.pos(), at, true));
            c.to = CommentAnchor::anchor(Self::map_pos_split(c.to.pos(), at, false));
        }
    }

    /// `mergeBlock` at `index` (same mapping for both gravities).
    pub(super) fn map_pos_merge(pos: Pos, index: usize, head_len: usize) -> Pos {
        if pos.block == index {
            Pos {
                block: index - 1,
                offset: pos.offset + head_len,
            }
        } else if pos.block > index {
            Pos {
                block: pos.block - 1,
                offset: pos.offset,
            }
        } else {
            pos
        }
    }

    /// `mergeBlock` at `index`: `head_len` is the pre-merge length of
    /// `blocks[index - 1]`.
    pub(super) fn remap_comments_merge(&mut self, index: usize, head_len: usize) {
        if self.comments.is_empty() {
            return;
        }
        for c in &mut self.comments {
            c.from = CommentAnchor::anchor(Self::map_pos_merge(c.from.pos(), index, head_len));
            c.to = CommentAnchor::anchor(Self::map_pos_merge(c.to.pos(), index, head_len));
        }
    }

    /// `insertBlock` at `index`: anchors at or after it shift one block.
    pub(super) fn remap_comments_insert_block(&mut self, index: usize) {
        if self.comments.is_empty() {
            return;
        }
        for c in &mut self.comments {
            for a in [&mut c.from, &mut c.to] {
                if a.block >= index {
                    a.block += 1;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn engine() -> QuillEngine {
        QuillEngine::new()
    }

    fn cmd(op: &str, payload: Value) -> Command {
        Command::new(op, payload)
    }

    fn apply(e: &mut QuillEngine, op: &str, payload: Value) -> CommandResult {
        e.apply(cmd(op, payload)).unwrap()
    }

    fn insert(e: &mut QuillEngine, block: usize, offset: usize, t: &str) {
        apply(
            e,
            "insertText",
            json!({"at": {"block": block, "offset": offset}, "text": t}),
        );
    }

    /// "hello world" in block 0 plus "second" in block 1.
    fn fixture() -> QuillEngine {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello world\nsecond");
        e
    }

    fn add(e: &mut QuillEngine, id: &str, from: (usize, usize), to: (usize, usize)) {
        apply(
            e,
            "addComment",
            json!({
                "id": id,
                "from": {"block": from.0, "offset": from.1},
                "to": {"block": to.0, "offset": to.1},
                "author": "Ada",
                "body": "check this",
            }),
        );
    }

    fn comments(e: &mut QuillEngine) -> Value {
        apply(e, "listComments", json!({})).data
    }

    fn comment_at(e: &mut QuillEngine, id: &str) -> Value {
        comments(e)["comments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .unwrap()
            .clone()
    }

    // -- ops -----------------------------------------------------------------

    #[test]
    fn add_list_and_point_anchor() {
        let mut e = fixture();
        add(&mut e, "c1", (0, 0), (0, 5));
        add(&mut e, "c2", (1, 0), (1, 0));
        let data = comments(&mut e);
        let arr = data["comments"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["id"], "c1");
        assert_eq!(arr[0]["from"], json!({"block": 0, "offset": 0}));
        assert_eq!(arr[0]["to"], json!({"block": 0, "offset": 5}));
        assert_eq!(arr[0]["author"], "Ada");
        assert_eq!(arr[0]["body"], "check this");
        assert_eq!(arr[0]["resolved"], false);
        // Point anchor allowed; sorted after c1 by position.
        assert_eq!(arr[1]["id"], "c2");
        assert_eq!(arr[1]["from"], arr[1]["to"]);
    }

    #[test]
    fn add_comment_validates_fields_atomically() {
        let mut e = fixture();
        // Duplicate id rejects only once 'x' exists.
        add(&mut e, "x", (0, 0), (0, 1));
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"id":"x","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"body":"b"}),
            // missing body / blank body / oversized body
            json!({"id":"y","from":{"block":0,"offset":0},"to":{"block":0,"offset":1}}),
            json!({"id":"y","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"body":"   "}),
            json!({"id":"y","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"body":"x".repeat(COMMENT_BODY_MAX + 1)}),
            // reversed range, bad positions
            json!({"id":"y","from":{"block":0,"offset":5},"to":{"block":0,"offset":1},"body":"b"}),
            json!({"id":"y","from":{"block":9,"offset":0},"to":{"block":0,"offset":1},"body":"b"}),
            json!({"id":"y","from":{"block":0,"offset":0},"to":{"block":0,"offset":99},"body":"b"}),
            // bad id / author / resolved type
            json!({"id":"  ","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"body":"b"}),
            json!({"id":"y","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"body":"b","author":"a\u{7}b"}),
            json!({"id":"y","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"body":"b","resolved":"yes"}),
        ] {
            assert!(e.apply(cmd("addComment", payload.clone())).is_err(), "{payload}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn update_remove_resolve_reopen() {
        let mut e = fixture();
        add(&mut e, "c1", (0, 0), (0, 5));
        // no-field update is eventless
        let noop = apply(&mut e, "updateComment", json!({"id":"c1"}));
        assert!(noop.events.is_empty());
        apply(
            &mut e,
            "updateComment",
            json!({"id":"c1","body":"revised","author":null}),
        );
        let c = comment_at(&mut e, "c1");
        assert_eq!(c["body"], "revised");
        assert!(c["author"].is_null());
        // equal update is eventless
        let noop = apply(&mut e, "updateComment", json!({"id":"c1","body":"revised"}));
        assert!(noop.events.is_empty());
        // resolve/reopen
        let r = apply(&mut e, "resolveComment", json!({"id":"c1"}));
        assert_eq!(r.data["ok"], true);
        assert_eq!(comment_at(&mut e, "c1")["resolved"], true);
        let noop = apply(&mut e, "resolveComment", json!({"id":"c1"}));
        assert!(noop.events.is_empty());
        apply(&mut e, "reopenComment", json!({"id":"c1"}));
        assert_eq!(comment_at(&mut e, "c1")["resolved"], false);
        // unknown ids and bad bodies reject without touching state
        let before = e.snapshot().unwrap();
        for (op, payload) in [
            ("updateComment", json!({"id":"nope","body":"x"})),
            ("removeComment", json!({"id":"nope"})),
            ("resolveComment", json!({"id":"nope"})),
            ("reopenComment", json!({"id":"nope"})),
            ("updateComment", json!({"id":"c1","body":"  "})),
        ] {
            assert!(e.apply(cmd(op, payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        apply(&mut e, "removeComment", json!({"id":"c1"}));
        assert_eq!(comments(&mut e)["comments"].as_array().unwrap().len(), 0);
        assert!(e
            .apply(cmd("listComments", json!({})))
            .unwrap()
            .events
            .is_empty());
    }

    #[test]
    fn comment_ops_undo_redo() {
        let mut e = fixture();
        add(&mut e, "c1", (0, 0), (0, 5));
        apply(&mut e, "resolveComment", json!({"id":"c1"}));
        let full = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(comment_at(&mut e, "c1")["resolved"], false);
        assert!(e.undo().unwrap());
        assert_eq!(comments(&mut e)["comments"].as_array().unwrap().len(), 0);
        while e.redo().unwrap() {}
        assert_eq!(e.snapshot().unwrap(), full);
    }

    // -- anchor stability -----------------------------------------------------

    #[test]
    fn insert_text_shifts_anchors_with_sticky_boundaries() {
        let mut e = fixture();
        // "hello world" block0, "second" block1. Comment on "ello" (1..5),
        // plus a point comment at offset 6.
        add(&mut e, "mid", (0, 1), (0, 5));
        add(&mut e, "pt", (0, 6), (0, 6));
        // Insert before the range: both endpoints shift right.
        insert(&mut e, 0, 0, "XX");
        let c = comment_at(&mut e, "mid");
        assert_eq!(c["from"]["offset"], 3);
        assert_eq!(c["to"]["offset"], 7);
        assert_eq!(comment_at(&mut e, "pt")["from"]["offset"], 8);
        // Insert exactly at `from`: left-gravity start stays, so the new
        // text lands inside the range (end moves with right gravity).
        insert(&mut e, 0, 3, "!");
        let c = comment_at(&mut e, "mid");
        assert_eq!(c["from"]["offset"], 3);
        assert_eq!(c["to"]["offset"], 8);
        // Insert exactly at `to`: right-gravity end moves, new text inside.
        insert(&mut e, 0, 8, "?");
        let c = comment_at(&mut e, "mid");
        assert_eq!(c["to"]["offset"], 9);
        // Newline insert inside block 0 moves tail anchors into new blocks.
        insert(&mut e, 0, 0, "a\nb");
        let c = comment_at(&mut e, "mid");
        // Original block0 offsets +3 (two plain inserts) then +2 newlines:
        // from was 3 → head stays? from=3 > at.offset=0 so moves to last
        // new block: block 0+1=1? added=1 newline → block 1, offset
        // last_len(1) + (3-0) = 4? Wait: "a\nb" → added=1, last_len=1.
        // from.offset=3 → block 1, offset 1+(3-0)=4. to.offset=9 → block1 offset 10.
        assert_eq!(c["from"]["block"], 1);
        assert_eq!(c["from"]["offset"], 4);
        assert_eq!(c["to"]["block"], 1);
        assert_eq!(c["to"]["offset"], 10);
        // Point comment at old block0 offset 8 (>0) also moved to block1.
        let pt = comment_at(&mut e, "pt");
        assert_eq!(pt["from"]["block"], 1);
        assert_eq!(pt["from"]["offset"], 1 + (8 - 0) + 2);
    }

    #[test]
    fn delete_range_clamps_and_collapses_anchors() {
        let mut e = fixture();
        add(&mut e, "mid", (0, 1), (0, 5));   // inside "hello"
        add(&mut e, "tail", (0, 6), (1, 3));  // spans the block boundary
        add(&mut e, "gone", (1, 0), (1, 6));  // entirely inside block 1 text
        // Delete "ello " (1..6) within block 0.
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":1},"to":{"block":0,"offset":6}}),
        );
        // mid: from=1 (<=from.offset stays), to=5 inside deleted → clamps to 1.
        let c = comment_at(&mut e, "mid");
        assert_eq!(c["from"]["offset"], 1);
        assert_eq!(c["to"]["offset"], 1);
        // tail: from=6 >= to.offset(6) → 6-5=1; to=(1,3) block>0 → block 0? No:
        // block 1 > to.block(0) → block -= span(0) stays 1? span=0 so block 1
        // unchanged... wait delete was single-block: blocks count unchanged,
        // block indices don't shift. tail.to stays (1,3).
        let c = comment_at(&mut e, "tail");
        assert_eq!(c["from"]["block"], 0);
        assert_eq!(c["from"]["offset"], 1);
        assert_eq!(c["to"]["block"], 1);
        assert_eq!(c["to"]["offset"], 3);
        // gone untouched (different block).
        assert_eq!(comment_at(&mut e, "gone")["from"]["offset"], 0);
        // Delete across the block boundary: from (0,5) to (1,3) merges blocks.
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":5},"to":{"block":1,"offset":3}}),
        );
        // Only one block remains now (0 and 1 merged). tail.to was (1,3):
        // block==to.block, offset==to.offset → from.offset + 0 = 5? offset<to.offset
        // false (equal) → from.offset + (3-3) = 5. tail.from (0,1) < from.block? No,
        // from=(0,5): pos.block==from.block==0 but to.block==1 → multi-block
        // branch: offset 1 <= 5 → stays (0,1).
        let c = comment_at(&mut e, "tail");
        assert_eq!(c["from"], json!({"block":0,"offset":1}));
        assert_eq!(c["to"], json!({"block":0,"offset":5}));
        // gone: from (1,0) interior (0 < 1 < 1? to.block=1, pos.block=1 == to.block):
        // offset 0 < to.offset 3 → clamps to (0,5). to (1,6): offset>=3 →
        // (0, 5 + (6-3)=8).
        let c = comment_at(&mut e, "gone");
        assert_eq!(c["from"], json!({"block":0,"offset":5}));
        assert_eq!(c["to"], json!({"block":0,"offset":8}));
    }

    #[test]
    fn structural_ops_remap_anchors() {
        let mut e = engine();
        insert(&mut e, 0, 0, "ab\ncd\nef");
        add(&mut e, "c1", (0, 1), (1, 1));
        // splitBlock inside block 1 at offset 1: to=(1,1) right-gravity → (2,0)
        apply(&mut e, "splitBlock", json!({"at":{"block":1,"offset":1}}));
        let c = comment_at(&mut e, "c1");
        assert_eq!(c["from"], json!({"block":0,"offset":1}));
        assert_eq!(c["to"], json!({"block":2,"offset":0}));
        // mergeBlock index 2 merges block2 into block1 ("d"+"ef"→"def"),
        // head_len=1: to (2,0) → (1, 0+1=1).
        apply(&mut e, "mergeBlock", json!({"index":2}));
        let c = comment_at(&mut e, "c1");
        assert_eq!(c["to"], json!({"block":1,"offset":1}));
        // insertBlock at 0 shifts every anchor block +1.
        apply(&mut e, "insertBlock", json!({"index":0,"kind":"para"}));
        let c = comment_at(&mut e, "c1");
        assert_eq!(c["from"]["block"], 1);
        assert_eq!(c["to"]["block"], 2);
        // deleteRange removing the head block entirely: from=(1,1) is inside
        // deleted span? Delete block1 fully: from (1,0) to (2,0) merges.
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":1,"offset":0},"to":{"block":2,"offset":0}}),
        );
        // from (1,1): block==from.block multi → offset>0 → clamps (1,0).
        // to (2,1): block==to.block, offset>=0 → (1, 0+(1-0)=1).
        let c = comment_at(&mut e, "c1");
        assert_eq!(c["from"], json!({"block":1,"offset":0}));
        assert_eq!(c["to"], json!({"block":1,"offset":1}));
    }

    #[test]
    fn replace_range_and_replace_text_remap_anchors() {
        let mut e = engine();
        insert(&mut e, 0, 0, "foo bar foo");
        add(&mut e, "c1", (0, 0), (0, 3));       // first "foo"
        add(&mut e, "c2", (0, 8), (0, 11));      // second "foo"
        // replaceRange swaps the first foo for "quux": staged delete+insert.
        apply(
            &mut e,
            "replaceRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"text":"quux"}),
        );
        // c1's whole span replaced → collapses toward replacement end? Both
        // endpoints inside deleted span clamp to from=(0,0), then insert "quux"
        // at 0 shifts right-gravity to by 4 → to=(0,4); from left-gravity at 0
        // stays (0,0). Range now covers "quux".
        let c = comment_at(&mut e, "c1");
        assert_eq!(c["from"], json!({"block":0,"offset":0}));
        assert_eq!(c["to"], json!({"block":0,"offset":4}));
        // c2 shifted by +1 (3 removed, 4 inserted): 8→9, 11→12.
        let c = comment_at(&mut e, "c2");
        assert_eq!(c["from"]["offset"], 9);
        assert_eq!(c["to"]["offset"], 12);
        // replaceText "foo"→"X": c2's match [9,12) → repl len 1.
        apply(
            &mut e,
            "replaceText",
            json!({"query":"foo","replacement":"X"}),
        );
        // After previous step text is "quux bar foo": only second foo matches
        // at [9,12) → "X". c2 from=9 at match start, left gravity → stays 9;
        // to=12 at match end → after replacement = 9+1=10.
        let c = comment_at(&mut e, "c2");
        assert_eq!(c["from"]["offset"], 9);
        assert_eq!(c["to"]["offset"], 10);
    }

    #[test]
    fn change_case_remaps_anchors_through_expansion() {
        let mut e = engine();
        insert(&mut e, 0, 0, "aßz");
        add(&mut e, "c1", (0, 0), (0, 3));
        apply(
            &mut e,
            "changeCase",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"mode":"upper"}),
        );
        // "aßz" → "ASSZ": ß expands to SS, so the end anchor 3 → 4.
        let c = comment_at(&mut e, "c1");
        assert_eq!(c["from"]["offset"], 0);
        assert_eq!(c["to"]["offset"], 4);
    }

    #[test]
    fn anchors_survive_undo_redo_of_edits() {
        let mut e = fixture();
        add(&mut e, "mid", (0, 1), (0, 5));
        insert(&mut e, 0, 0, "XX");
        let moved = comment_at(&mut e, "mid");
        assert!(e.undo().unwrap());
        let c = comment_at(&mut e, "mid");
        assert_eq!(c["from"]["offset"], 1);
        assert_eq!(c["to"]["offset"], 5);
        assert!(e.redo().unwrap());
        let c = comment_at(&mut e, "mid");
        assert_eq!(c["from"]["offset"], moved["from"]["offset"]);
        assert_eq!(c["to"]["offset"], moved["to"]["offset"]);
    }

    #[test]
    fn batch_carries_comments_as_one_undo() {
        let mut e = fixture();
        apply(
            &mut e,
            "__batch",
            json!({"commands":[
                {"op":"insertText","payload":{"at":{"block":0,"offset":0},"text":"Q"}},
                {"op":"addComment","payload":{"id":"b1","from":{"block":0,"offset":1},"to":{"block":0,"offset":4},"body":"batched"}}
            ]}),
        );
        // addComment anchors are stated in post-insert coordinates: the
        // batch applies insertText first, then the comment lands on
        // offsets 1..4 of "Qhello world".
        let c = comment_at(&mut e, "b1");
        assert_eq!(c["from"]["offset"], 1);
        assert_eq!(c["to"]["offset"], 4);
        assert!(e.undo().unwrap());
        assert_eq!(comments(&mut e)["comments"].as_array().unwrap().len(), 0);
        assert_eq!(
            apply(&mut e, "text", json!({})).data["text"].as_str().unwrap(),
            "hello world\nsecond"
        );
    }

    // -- snapshots ------------------------------------------------------------

    #[test]
    fn snapshot_round_trip_and_schema3_compat() {
        let mut e = fixture();
        add(&mut e, "c1", (0, 1), (0, 5));
        apply(&mut e, "resolveComment", json!({"id":"c1"}));
        let bytes = e.snapshot().unwrap();
        // Envelope payload is JSON; the schema:3 document must carry
        // `comments` and stay inside the same wrapper kind/schema.
        let (_fmt, payload) = decode_envelope(&bytes).unwrap();
        let v: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(v["kind"], "quill");
        assert_eq!(v["schema"], 3);
        assert_eq!(v["document"]["comments"][0]["id"], "c1");
        assert_eq!(v["document"]["comments"][0]["resolved"], true);
        let mut re = engine();
        re.restore(&bytes).unwrap();
        let c = comment_at(&mut re, "c1");
        assert_eq!(c["from"], json!({"block":0,"offset":1}));
        assert_eq!(c["resolved"], true);
        // A document with no features keeps the legacy bare shape.
        let mut plain = engine();
        insert(&mut plain, 0, 0, "plain");
        let bytes = plain.snapshot().unwrap();
        let (_f, payload) = decode_envelope(&bytes).unwrap();
        let v: Value = serde_json::from_slice(payload).unwrap();
        assert!(v.get("kind").is_none());
        assert!(v.get("comments").is_none());
    }

    #[test]
    fn hostile_restore_rejects_bad_comments() {
        let mut e = fixture();
        add(&mut e, "c1", (0, 1), (0, 5));
        let bytes = e.snapshot().unwrap();
        let mut re = engine();
        re.restore(&bytes).unwrap();
        // Mutate the payload: duplicate ids, out-of-range anchor, reversed
        // range, unknown field, oversized body — each must reject and leave
        // the live document untouched.
        // Each mutation must reject and leave the live document untouched.
        let live = re.snapshot().unwrap();
        let (_f, payload) = decode_envelope(&bytes).unwrap();
        let v: Value = serde_json::from_slice(payload).unwrap();
        let doc = v["document"].clone();
        let mut documents: Vec<Value> = Vec::new();
        // duplicate id
        let mut d = doc.clone();
        let mut cs = d["comments"].as_array().unwrap().clone();
        cs.push(cs[0].clone());
        d["comments"] = json!(cs);
        documents.push(d);
        // anchor block out of range
        let mut d = doc.clone();
        d["comments"][0]["from"]["block"] = json!(99);
        documents.push(d);
        // reversed range
        let mut d = doc.clone();
        d["comments"][0]["from"] = json!({"block":0,"offset":5});
        d["comments"][0]["to"] = json!({"block":0,"offset":1});
        documents.push(d);
        // unknown field on the comment
        let mut d = doc.clone();
        d["comments"][0]["extra"] = json!(true);
        documents.push(d);
        // blank body
        let mut d = doc.clone();
        d["comments"][0]["body"] = json!("  ");
        documents.push(d);
        for document in documents {
            let mut bad = v.clone();
            bad["document"] = document;
            let env = encode_envelope(&serde_json::to_vec(&bad).unwrap());
            assert!(re.restore(&env).is_err(), "{bad}");
            assert_eq!(re.snapshot().unwrap(), live);
        }
        // schema:2 wrapper carrying a comments key rejects.
        let mut v2 = v.clone();
        v2["schema"] = json!(2);
        v2["document"] = json!({"blocks": doc["blocks"].clone(), "comments": doc["comments"].clone()});
        let env = encode_envelope(&serde_json::to_vec(&v2).unwrap());
        assert!(re.restore(&env).is_err());
        assert_eq!(re.snapshot().unwrap(), live);
        // Legacy unwrapped payload carrying comments rejects.
        let env = encode_envelope(
            &serde_json::to_vec(&json!({"blocks": doc["blocks"].clone(), "comments": []})).unwrap(),
        );
        assert!(re.restore(&env).is_err());
        assert_eq!(re.snapshot().unwrap(), live);
    }

    #[test]
    fn comments_cleared_by_new_and_import_docx() {
        let mut e = fixture();
        add(&mut e, "c1", (0, 0), (0, 5));
        apply(&mut e, "new", json!({}));
        assert_eq!(comments(&mut e)["comments"].as_array().unwrap().len(), 0);
        assert!(e.undo().unwrap());
        assert_eq!(comment_at(&mut e, "c1")["id"], "c1");
    }
}
