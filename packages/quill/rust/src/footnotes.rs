//! Footnotes and endnotes (P12 slice 8, first half): reference marks in the
//! block stream plus note bodies stored as document-level records.
//!
//! Model decision — document-level records, not inline markers. A footnote
//! is `{id, at, kind, body}` where `at` is a single live `{block,offset}`
//! anchor (the `CommentAnchor` shape revisions already reuse) marking where
//! the reference sits in the text flow. The note body is plain text stored
//! on the record — it is NOT part of the block stream, so `text`,
//! `findText`, `layout`, `blocks`, `describe` and DOCX export never see it
//! (note-body rendering is a host/consumer concern, same as comments).
//! Rich/multi-paragraph note bodies are deferred; the body cap matches the
//! comment body bound.
//!
//! `kind` is `"footnote"` or `"endnote"`; the only difference is placement
//! semantics for consumers — footnotes render at page bottom, endnotes at
//! document end. Both share one collection, one anchor model and one
//! numbering rule: `listFootnotes` numbers each kind independently in
//! document (anchor) order, so the engine stores no numbers at all.
//!
//! Anchor gravity is bookmark-like right gravity: the mark attaches to the
//! character after it, so text inserted exactly at the anchor lands before
//! the reference. Every position-moving op re-maps anchors through the same
//! machinery comments/revisions use (`map_pos_*` helpers); `replaceText`
//! re-anchors through per-block match spans and `changeCase` through the
//! per-scalar offset table. Unlike bookmarks, anchors never drop: a delete
//! that covers the anchor clamps it to the deletion start (comment-endpoint
//! semantics), so a note body is never silently lost — `removeFootnote`
//! deletes it explicitly. Anchors cannot be re-pointed by an op.
//!
//! Scope bounds: at most `FOOTNOTES_MAX` notes, bodies at most
//! `FOOTNOTE_BODY_MAX` chars (empty allowed — a bare reference is legal),
//! ids are unique tokens (explicit `id` or engine-generated `fn-N`).
//! Snapshots carry footnotes inside the schema:3 wrapper's
//! `deny_unknown_fields` document, so schema:3-era readers fail closed on
//! the `footnotes` key — no schema bump, same precedent as comments,
//! sections and revisions. No DOCX footnote/endnote interop.

use super::comments::CommentAnchor;
use super::*;
use serde::{Deserialize, Serialize};

/// Bound on stored footnotes/endnotes so snapshots stay small.
pub const FOOTNOTES_MAX: usize = 1024;
/// Note bodies are plain text; cap matches the comment body bound.
const FOOTNOTE_BODY_MAX: usize = 8192;

/// Placement kind: `footnote` renders at page bottom, `endnote` at document
/// end. Numbering is per-kind in document order (see `listFootnotes`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FootnoteKind {
    Footnote,
    Endnote,
}

impl FootnoteKind {
    fn as_str(self) -> &'static str {
        match self {
            FootnoteKind::Footnote => "footnote",
            FootnoteKind::Endnote => "endnote",
        }
    }
}

/// One footnote/endnote: unique `id`, a live `at` anchor marking the
/// reference position, `kind`, and a plain-text `body` (may be empty).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Footnote {
    pub id: String,
    pub at: CommentAnchor,
    pub kind: FootnoteKind,
    pub body: String,
}

fn anchor_pos(a: &CommentAnchor) -> Pos {
    Pos {
        block: a.block,
        offset: a.offset,
    }
}

fn anchor_of(p: Pos) -> CommentAnchor {
    CommentAnchor {
        block: p.block,
        offset: p.offset,
    }
}

/// Field-level validation shared by ops and restore: id token, body bound,
/// in-range anchor on a text-bearing (non-table, non-toc, non-bibliography)
/// block. `blocks` is the final block list. Table, toc, and bibliography
/// blocks are rejected because
/// their only valid `Pos` is offset 0 and no reference mark can live
/// inside cell text or field data — both are `Pos`-unreachable (same rule
/// `insertText` applies).
fn validate_footnote(f: &Footnote, blocks: &[Block]) -> Result<(), EngineError> {
    validate_style_token(&f.id, "footnote id")?;
    if f.body.chars().count() > FOOTNOTE_BODY_MAX {
        return Err(EngineError::validation(format!(
            "footnote body must be at most {FOOTNOTE_BODY_MAX} characters"
        )));
    }
    let Some(b) = blocks.get(f.at.block) else {
        return Err(EngineError::out_of_bounds(format!(
            "footnote '{}' anchor block {} out of range ({} blocks)",
            f.id,
            f.at.block,
            blocks.len()
        )));
    };
    if b.kind == BlockKind::Table {
        return Err(EngineError::validation(format!(
            "footnote '{}' anchor must not sit on a table block",
            f.id
        )));
    }
    if b.kind == BlockKind::Toc {
        return Err(EngineError::validation(format!(
            "footnote '{}' anchor must not sit on a toc field block",
            f.id
        )));
    }
    if b.kind == BlockKind::Bibliography {
        return Err(EngineError::validation(format!(
            "footnote '{}' anchor must not sit on a bibliography field block",
            f.id
        )));
    }
    if f.at.offset > block_len(b) {
        return Err(EngineError::out_of_bounds(format!(
            "footnote '{}' anchor offset {} out of range (block {} has {} chars)",
            f.id,
            f.at.offset,
            f.at.block,
            block_len(b)
        )));
    }
    Ok(())
}

/// Full footnote validation for restore: count, id uniqueness, and every
/// note's fields/anchor against the final block list. Runs before live
/// state is replaced.
pub fn validate_footnotes(footnotes: &[Footnote], blocks: &[Block]) -> Result<(), EngineError> {
    if footnotes.len() > FOOTNOTES_MAX {
        return Err(EngineError::validation("too many footnotes"));
    }
    let mut seen = std::collections::HashSet::with_capacity(footnotes.len());
    for f in footnotes {
        validate_footnote(f, blocks)?;
        if !seen.insert(f.id.as_str()) {
            return Err(EngineError::validation(format!(
                "duplicate footnote id '{}'",
                f.id
            )));
        }
    }
    Ok(())
}

/// Sort key shared by `listFootnotes` numbering and output order.
fn footnote_sort_key(f: &Footnote) -> (usize, usize, &str) {
    (f.at.block, f.at.offset, f.id.as_str())
}

fn parse_kind(v: &Value) -> Result<FootnoteKind, EngineError> {
    match as_str(v, "kind")? {
        "footnote" => Ok(FootnoteKind::Footnote),
        "endnote" => Ok(FootnoteKind::Endnote),
        other => Err(EngineError::validation(format!(
            "unknown footnote kind '{other}' (expected \"footnote\" or \"endnote\")"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Engine ops
// ---------------------------------------------------------------------------

impl QuillEngine {
    fn find_footnote(&self, id: &str) -> Result<usize, EngineError> {
        self.footnotes
            .iter()
            .position(|f| f.id == id)
            .ok_or_else(|| EngineError::validation(format!("unknown footnote '{id}'")))
    }

    /// `addFootnote {at, body?, kind?, id?}` — anchors a footnote/endnote
    /// reference at `at` (`pos`/`anchor` accepted aliases, same as
    /// bookmarks). `kind` is `"footnote"` (default) or `"endnote"`; `body`
    /// is optional plain text ≤8192 chars (empty allowed); `id` is an
    /// optional unique token — absent, the engine assigns the smallest
    /// unused `fn-N`. At most 1024 notes. Anchors on table, toc field, or
    /// bibliography field blocks reject.
    pub(super) fn op_add_footnote(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let at = bookmark_pos(p)?;
        self.check_pos(at)?;
        if self.blocks[at.block].kind == BlockKind::Table {
            return Err(EngineError::validation(
                "cannot anchor a footnote on a table block",
            ));
        }
        if self.blocks[at.block].kind == BlockKind::Toc {
            return Err(EngineError::validation(
                "cannot anchor a footnote on a toc field block",
            ));
        }
        if self.blocks[at.block].kind == BlockKind::Bibliography {
            return Err(EngineError::validation(
                "cannot anchor a footnote on a bibliography field block",
            ));
        }
        let kind = match p.get("kind") {
            Some(v) if v.is_null() => FootnoteKind::Footnote,
            Some(v) => parse_kind(v)?,
            None => FootnoteKind::Footnote,
        };
        let body = match p.get("body") {
            Some(v) if v.is_null() => String::new(),
            Some(v) => as_str(v, "body")?.to_string(),
            None => String::new(),
        };
        let id = match p.get("id") {
            Some(v) if v.is_null() => None,
            Some(v) => Some(as_str(v, "id")?.to_string()),
            None => None,
        };
        let id = match id {
            Some(id) => {
                validate_style_token(&id, "footnote id")?;
                if self.footnotes.iter().any(|f| f.id == id) {
                    return Err(EngineError::validation(format!(
                        "footnote '{id}' already exists"
                    )));
                }
                id
            }
            None => (1..)
                .map(|i| format!("fn-{i}"))
                .find(|candidate| !self.footnotes.iter().any(|f| f.id == *candidate))
                .expect("footnote id space exhausted below FOOTNOTES_MAX"),
        };
        let footnote = Footnote {
            id: id.clone(),
            at: anchor_of(at),
            kind,
            body,
        };
        validate_footnote(&footnote, &self.blocks)?;
        if self.footnotes.len() >= FOOTNOTES_MAX {
            return Err(EngineError::validation("footnote limit reached"));
        }
        let before = self.footnotes.clone();
        self.footnotes.push(footnote);
        self.record_undo(0, Vec::new(), Vec::new(), Collections::footnotes(before));
        Ok(CommandResult::data(json!({
            "ok": true,
            "id": id,
            "kind": kind.as_str(),
        })))
    }

    /// `updateFootnote {id, body?, kind?}` — replaces the named fields;
    /// `kind` moves the note between the footnote/endnote sequences.
    /// `body:null` clears the body to empty. Anchors are not re-pointable.
    /// No effective change → eventless.
    pub(super) fn op_update_footnote(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = as_str(field(p, "id")?, "id")?;
        let index = self.find_footnote(id)?;
        let mut updated = self.footnotes[index].clone();
        let mut touched = false;
        if let Some(v) = p.get("body") {
            touched = true;
            updated.body = if v.is_null() {
                String::new()
            } else {
                as_str(v, "body")?.to_string()
            };
        }
        if let Some(v) = p.get("kind") {
            touched = true;
            updated.kind = if v.is_null() {
                FootnoteKind::Footnote
            } else {
                parse_kind(v)?
            };
        }
        if !touched {
            return Ok(Self::read_only(json!({ "ok": true, "id": id })));
        }
        validate_footnote(&updated, &self.blocks)?;
        if updated == self.footnotes[index] {
            return Ok(Self::read_only(json!({ "ok": true, "id": id })));
        }
        let before = self.footnotes.clone();
        self.footnotes[index] = updated;
        self.record_undo(0, Vec::new(), Vec::new(), Collections::footnotes(before));
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `removeFootnote {id}` — deletes the note; unknown ids reject.
    pub(super) fn op_remove_footnote(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = as_str(field(p, "id")?, "id")?;
        let index = self.find_footnote(id)?;
        let before = self.footnotes.clone();
        self.footnotes.remove(index);
        self.record_undo(0, Vec::new(), Vec::new(), Collections::footnotes(before));
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `listFootnotes` — read-only; sorted by anchor position then id, each
    /// entry carrying its resolved `number`. Footnotes and endnotes number
    /// independently in document order (1-based), matching Word's separate
    /// sequences; the engine stores no numbers.
    pub(super) fn op_list_footnotes(&self) -> Result<CommandResult, EngineError> {
        let mut sorted: Vec<&Footnote> = self.footnotes.iter().collect();
        sorted.sort_by(|a, b| footnote_sort_key(a).cmp(&footnote_sort_key(b)));
        let mut next_footnote = 1usize;
        let mut next_endnote = 1usize;
        let arr: Vec<Value> = sorted
            .iter()
            .map(|f| {
                let number = match f.kind {
                    FootnoteKind::Footnote => {
                        let n = next_footnote;
                        next_footnote += 1;
                        n
                    }
                    FootnoteKind::Endnote => {
                        let n = next_endnote;
                        next_endnote += 1;
                        n
                    }
                };
                json!({
                    "id": f.id,
                    "at": { "block": f.at.block, "offset": f.at.offset },
                    "kind": f.kind.as_str(),
                    "number": number,
                    "body": f.body,
                })
            })
            .collect();
        Ok(Self::read_only(json!({ "footnotes": arr })))
    }

    // -- footnote anchor remapping -------------------------------------------
    //
    // The `at` anchor is a single right-gravity mark (bookmark semantics:
    // `map_pos_insert`/`map_pos_split` with `left = false`, `map_pos_delete`
    // clamps like a comment endpoint and never drops). Every mapper below
    // mirrors the bookmark rules; the shared `map_pos_*` helpers live in
    // comments.rs.

    /// `insertText` at `at` inserting `text` (already validated).
    pub(super) fn remap_footnotes_insert_text(&mut self, at: Pos, text: &str) {
        if self.footnotes.is_empty() {
            return;
        }
        let added = text.bytes().filter(|&b| b == b'\n').count();
        let plain = text.chars().count();
        let last_len = text.rsplit('\n').next().map_or(0, |s| s.chars().count());
        for f in &mut self.footnotes {
            f.at = anchor_of(Self::map_pos_insert(
                anchor_pos(&f.at),
                at,
                added,
                last_len,
                plain,
                false,
            ));
        }
    }

    /// `deleteRange` from `from` to `to` (already validated, from != to).
    /// Anchors inside the deleted span clamp to `from` — the note survives
    /// rather than dropping silently.
    pub(super) fn remap_footnotes_delete(&mut self, from: Pos, to: Pos) {
        if self.footnotes.is_empty() {
            return;
        }
        for f in &mut self.footnotes {
            f.at = anchor_of(Self::map_pos_delete(anchor_pos(&f.at), from, to));
        }
    }

    /// `splitBlock` at `at`: a mark at the split point moves to the tail
    /// block's start (right gravity, same as a bookmark).
    pub(super) fn remap_footnotes_split(&mut self, at: Pos) {
        if self.footnotes.is_empty() {
            return;
        }
        for f in &mut self.footnotes {
            f.at = anchor_of(Self::map_pos_split(anchor_pos(&f.at), at, false));
        }
    }

    /// `mergeBlock` at `index` (same mapping as bookmarks).
    pub(super) fn remap_footnotes_merge(&mut self, index: usize, head_len: usize) {
        if self.footnotes.is_empty() {
            return;
        }
        for f in &mut self.footnotes {
            f.at = anchor_of(Self::map_pos_merge(anchor_pos(&f.at), index, head_len));
        }
    }

    /// `insertBlock`/`insertTable` at `index`: anchors at or after it shift
    /// one block.
    pub(super) fn remap_footnotes_insert_block(&mut self, index: usize) {
        if self.footnotes.is_empty() {
            return;
        }
        for f in &mut self.footnotes {
            if f.at.block >= index {
                f.at.block += 1;
            }
        }
    }

    /// `replaceText` re-anchoring through one block's `(start,end)` match
    /// spans — bookmark right gravity via `remap_offset_through_matches`.
    pub(super) fn remap_footnotes_replace_block(
        footnotes: &mut [Footnote],
        block: usize,
        span: &[(usize, usize)],
        repl_len: usize,
    ) {
        for f in footnotes.iter_mut() {
            if f.at.block == block {
                f.at.offset = remap_offset_through_matches(f.at.offset, span, repl_len);
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

    fn apply(e: &mut QuillEngine, op: &str, payload: Value) -> CommandResult {
        e.apply(Command::new(op, payload)).unwrap()
    }

    fn err(e: &mut QuillEngine, op: &str, payload: Value) -> EngineError {
        e.apply(Command::new(op, payload)).unwrap_err()
    }

    fn insert(e: &mut QuillEngine, block: usize, offset: usize, t: &str) {
        apply(
            e,
            "insertText",
            json!({"at":{"block":block,"offset":offset},"text":t}),
        );
    }

    fn notes(e: &mut QuillEngine) -> Value {
        apply(e, "listFootnotes", json!({})).data
    }

    #[test]
    fn add_list_update_remove_round_trip() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello world");
        let r = apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":5},"body":"first note"}),
        );
        assert_eq!(r.data["id"], "fn-1");
        assert_eq!(r.data["kind"], "footnote");
        let r = apply(
            &mut e,
            "addFootnote",
            json!({"pos":{"block":0,"offset":11},"kind":"endnote","body":"end"}),
        );
        assert_eq!(r.data["id"], "fn-2");
        let listed = notes(&mut e);
        let arr = listed["footnotes"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        // Sorted by anchor; numbers are per-kind.
        assert_eq!(arr[0]["id"], "fn-1");
        assert_eq!(arr[0]["number"], 1);
        assert_eq!(arr[0]["kind"], "footnote");
        assert_eq!(arr[0]["at"], json!({"block":0,"offset":5}));
        assert_eq!(arr[0]["body"], "first note");
        assert_eq!(arr[1]["id"], "fn-2");
        assert_eq!(arr[1]["number"], 1);
        assert_eq!(arr[1]["kind"], "endnote");

        // updateFootnote patches body/kind; eventless when unchanged.
        let noop = apply(
            &mut e,
            "updateFootnote",
            json!({"id":"fn-1","body":"first note"}),
        );
        assert!(noop.events.is_empty());
        apply(
            &mut e,
            "updateFootnote",
            json!({"id":"fn-1","kind":"endnote","body":"moved"}),
        );
        let listed = notes(&mut e);
        let arr = listed["footnotes"].as_array().unwrap();
        // List order is anchor order: fn-1 (offset 5) precedes fn-2
        // (offset 11); both are endnotes now so they share one sequence.
        assert_eq!(arr[0]["id"], "fn-1");
        assert_eq!(arr[0]["number"], 1);
        assert_eq!(arr[0]["kind"], "endnote");
        assert_eq!(arr[0]["body"], "moved");
        assert_eq!(arr[1]["id"], "fn-2");
        assert_eq!(arr[1]["number"], 2);
        assert_eq!(arr[1]["kind"], "endnote");

        apply(&mut e, "removeFootnote", json!({"id":"fn-1"}));
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"].as_array().unwrap().len(), 1);
        assert!(err(&mut e, "removeFootnote", json!({"id":"fn-1"}))
            .message
            .contains("unknown footnote"));
    }

    #[test]
    fn explicit_id_and_validation() {
        let mut e = engine();
        insert(&mut e, 0, 0, "text");
        let r = apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":2},"id":"my-note","body":"b"}),
        );
        assert_eq!(r.data["id"], "my-note");
        assert!(err(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":0},"id":"my-note"})
        )
        .message
        .contains("already exists"));
        // Bad kind, bad anchor, table anchor, oversized body all reject
        // without mutating.
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"at":{"block":0,"offset":0},"kind":"margin"}),
            json!({"at":{"block":9,"offset":0}}),
            json!({"at":{"block":0,"offset":99}}),
            json!({"at":{"block":0,"offset":0},"body":"x".repeat(8193)}),
            json!({"at":{"block":0,"offset":0},"id":"bad\u{7}id"}),
        ] {
            assert!(e.apply(Command::new("addFootnote", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Table anchor rejects.
        apply(&mut e, "insertTable", json!({"index":1,"rows":1,"cols":1}));
        assert!(e
            .apply(Command::new(
                "addFootnote",
                json!({"at":{"block":1,"offset":0}})
            ))
            .is_err());
    }

    #[test]
    fn bibliography_field_anchor_rejects() {
        let mut e = engine();
        insert(&mut e, 0, 0, "text");
        apply(&mut e, "insertBibliography", json!({"index":1}));
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new(
                "addFootnote",
                json!({"at":{"block":1,"offset":0}})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn anchors_remap_through_insert_delete_split_merge() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abcdef");
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":3},"body":"n"}),
        );
        // Right gravity: insert exactly at the anchor lands before the mark.
        insert(&mut e, 0, 3, "XY");
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":0,"offset":5}));
        // Insert with newline moves the mark into the tail block.
        insert(&mut e, 0, 0, "p\nq");
        let listed = notes(&mut e);
        // "p\nq" at 0 splits: tail "qXYcdef" lands in block 1; anchor was at
        // old offset 5 (> at.offset 0) → block 1, offset last_len(1) + 5 = 6.
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":1,"offset":6}));
        // Delete a span covering the anchor clamps it to the deletion start
        // (the note survives rather than dropping).
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":1,"offset":0},"to":{"block":1,"offset":8}}),
        );
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":1,"offset":0}));
        // Split/merge move the mark across block boundaries.
        apply(&mut e, "insertBlock", json!({"index":2}));
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"]["block"], 1);
        apply(&mut e, "splitBlock", json!({"at":{"block":1,"offset":0}}));
        let listed = notes(&mut e);
        // Mark at offset 0 == split point → right gravity moves to tail block.
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":2,"offset":0}));
        apply(&mut e, "mergeBlock", json!({"index":2}));
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":1,"offset":0}));
    }

    #[test]
    fn anchors_remap_through_replace_range_and_replace_text() {
        let mut e = engine();
        insert(&mut e, 0, 0, "one two three");
        // Anchor sits just before "three" (offset 8).
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":8},"body":"n"}),
        );
        // replaceRange deletes "two" (offsets 4..7) and inserts "2": the
        // anchor shifts left by 2 then right by 1, staying before "three".
        apply(
            &mut e,
            "replaceRange",
            json!({"from":{"block":0,"offset":4},"to":{"block":0,"offset":7},"text":"2"}),
        );
        // "one 2 three": "three" now starts at offset 6.
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":0,"offset":6}));
        // replaceText match starting exactly at the anchor: right gravity
        // lands the mark just after the replacement.
        apply(
            &mut e,
            "replaceText",
            json!({"query":"three","replacement":"3"}),
        );
        // "one 2 3" (len 7): mark at end.
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":0,"offset":7}));
        // A match before the anchor shifts it left by the length delta.
        apply(
            &mut e,
            "replaceText",
            json!({"query":"one","replacement":"1"}),
        );
        // "1 2 3" (len 5).
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":0,"offset":5}));
    }

    #[test]
    fn anchors_remap_through_change_case_and_delete_table() {
        let mut e = engine();
        // ß uppercases to SS (expansion): anchor after it shifts +1.
        e.blocks[0].inlines = vec![Inline {
            text: "aßc".to_string(),
            style: Style::default(),
        }];
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":3},"body":"n"}),
        );
        apply(
            &mut e,
            "changeCase",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"mode":"upper"}),
        );
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":0,"offset":4}));
        // deleteTable shifts anchors past the removed block down one.
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":4},"text":"\n"}),
        );
        apply(&mut e, "insertTable", json!({"index":1,"rows":1,"cols":1}));
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":2,"offset":0},"body":"m"}),
        );
        apply(&mut e, "deleteTable", json!({"block":1}));
        let listed = notes(&mut e);
        let arr = listed["footnotes"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        // fn-2 sat on block 2 → shifts to block 1.
        let second = arr.iter().find(|f| f["id"] == "fn-2").unwrap();
        assert_eq!(second["at"]["block"], 1);
    }

    #[test]
    fn undo_redo_and_batch() {
        let mut e = engine();
        insert(&mut e, 0, 0, "text");
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":2},"body":"n"}),
        );
        let snap = e.snapshot().unwrap();
        // undo removes the note; redo restores it.
        assert!(e.undo().unwrap());
        assert_eq!(notes(&mut e)["footnotes"].as_array().unwrap().len(), 0);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), snap);
        // An edit that moves the anchor is one undo entry restoring both
        // blocks and the note list.
        insert(&mut e, 0, 0, "ab");
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":0,"offset":4}));
        assert!(e.undo().unwrap());
        let listed = notes(&mut e);
        assert_eq!(listed["footnotes"][0]["at"], json!({"block":0,"offset":2}));
        // Batch: add + edit atomically; one undo restores both.
        e.apply(Command::new(
            "__batch",
            json!({"commands":[
                {"op":"addFootnote","payload":{"at":{"block":0,"offset":1},"body":"b1"}},
                {"op":"addFootnote","payload":{"at":{"block":0,"offset":3},"kind":"endnote","body":"b2"}}
            ]}),
        ))
        .unwrap();
        // fn-1 from earlier plus the two batched notes.
        assert_eq!(notes(&mut e)["footnotes"].as_array().unwrap().len(), 3);
        assert!(e.undo().unwrap());
        assert_eq!(notes(&mut e)["footnotes"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn new_and_import_clear_footnotes() {
        let mut e = engine();
        insert(&mut e, 0, 0, "text");
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":1},"body":"n"}),
        );
        apply(&mut e, "new", json!({}));
        assert_eq!(notes(&mut e)["footnotes"].as_array().unwrap().len(), 0);
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":0},"body":"n"}),
        );
        // importDocx replaces the document and its collections.
        let bytes = docx::export_docx(&e.blocks).unwrap();
        e.apply(Command::new(
            "importDocx",
            json!({"bytes_b64": base64_encode(&bytes)}),
        ))
        .unwrap();
        assert_eq!(notes(&mut e)["footnotes"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn snapshot_schema3_round_trip_and_stray_rejection() {
        let mut e = engine();
        insert(&mut e, 0, 0, "text");
        apply(
            &mut e,
            "addFootnote",
            json!({"at":{"block":0,"offset":2},"kind":"endnote","body":"n"}),
        );
        let bytes = e.snapshot().unwrap();
        let payload = decode_envelope(&bytes).unwrap().1;
        let v: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(v["kind"], "quill");
        assert_eq!(v["schema"], 3);
        assert!(v["document"]["footnotes"].is_array());
        let mut re = engine();
        re.restore(&bytes).unwrap();
        let listed = notes(&mut re);
        assert_eq!(listed["footnotes"].as_array().unwrap().len(), 1);
        assert_eq!(listed["footnotes"][0]["kind"], "endnote");
        // Footnotes are omitted when empty: earlier schema:3 payloads stay
        // byte-identical.
        let mut e2 = engine();
        insert(&mut e2, 0, 0, "plain");
        apply(
            &mut e2,
            "addBookmark",
            json!({"name":"b","pos":{"block":0,"offset":1}}),
        );
        let bytes2 = e2.snapshot().unwrap();
        let payload2 = decode_envelope(&bytes2).unwrap().1;
        let v2: Value = serde_json::from_slice(payload2).unwrap();
        assert!(v2["document"].get("footnotes").is_none());
        // Stray `footnotes` keys reject on schema:2 and legacy payloads.
        for doc in [
            json!({"kind":"quill","schema":2,"document":{"blocks":[],"footnotes":[]}}),
            json!({"blocks":[],"footnotes":[]}),
        ] {
            let mut e3 = engine();
            assert!(e3
                .restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap()))
                .is_err());
        }
    }

    #[test]
    fn snapshot_rejects_hostile_footnotes() {
        let mut e = engine();
        insert(&mut e, 0, 0, "text");
        let good = e.snapshot().unwrap();
        // Craft schema:3 payloads with hostile footnote entries.
        let base = |footnotes: Value| {
            json!({
                "kind":"quill","schema":3,
                "document":{
                    "blocks":[{"kind":"para","inlines":[{"text":"text","style":{}}]}],
                    "bookmarks":[],
                    "footnotes":footnotes
                }
            })
        };
        let cases = [
            // duplicate ids
            base(json!([
                {"id":"a","at":{"block":0,"offset":0},"kind":"footnote","body":""},
                {"id":"a","at":{"block":0,"offset":1},"kind":"footnote","body":""}
            ])),
            // anchor out of range
            base(json!([
                {"id":"a","at":{"block":5,"offset":0},"kind":"footnote","body":""}
            ])),
            // offset past block end
            base(json!([
                {"id":"a","at":{"block":0,"offset":9},"kind":"footnote","body":""}
            ])),
            // bad kind
            base(json!([
                {"id":"a","at":{"block":0,"offset":0},"kind":"margin","body":""}
            ])),
            // oversized body
            base(json!([
                {"id":"a","at":{"block":0,"offset":0},"kind":"footnote","body":"x".repeat(8193)}
            ])),
            // anchor on a table block
            base(json!([
                {"id":"a","at":{"block":0,"offset":0},"kind":"footnote","body":"","extra":1}
            ])),
            // unknown field
            base(json!([
                {"id":"a","at":{"block":0,"offset":0},"kind":"footnote","body":"","surprise":true}
            ])),
        ];
        for doc in cases {
            let mut e3 = engine();
            assert!(
                e3.restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap()))
                    .is_err(),
                "hostile payload accepted: {doc}"
            );
        }
        // A valid footnote-on-table anchor also rejects (table block at 0).
        let table_doc = json!({
            "kind":"quill","schema":3,
            "document":{
                "blocks":[{"kind":"table","inlines":[],"table":{"rows":1,"cols":1,"cells":[{"blocks":[{"kind":"para","inlines":[]}]}]}}],
                "bookmarks":[],
                "footnotes":[{"id":"a","at":{"block":0,"offset":0},"kind":"footnote","body":""}]
            }
        });
        let mut e4 = engine();
        assert!(e4
            .restore(&encode_envelope(&serde_json::to_vec(&table_doc).unwrap()))
            .is_err());
        // Sanity: the good snapshot still restores.
        let mut e5 = engine();
        e5.restore(&good).unwrap();
    }
}
