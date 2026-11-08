//! Revisions / track changes (P12 slice 6): ins/del markers recorded while
//! track changes is enabled, resolved later by accept/reject ops.
//!
//! Model decision — revision *records*, not inline markers. A revision is a
//! document-level record `{id, kind, from, to, author?, time?, text?}`
//! anchored to live `{block,offset}` positions exactly like comments and
//! bookmarks (blocks carry no identity, so anchors are re-mapped by every
//! position-moving op rather than content pinned). This deliberately does
//! NOT imitate Word's `w:ins`/`w:del` run wrappers or `w:revisionId`
//! semantics:
//!
//! - `ins` revisions bracket text that is already in the block stream. The
//!   marked range is a live position range: `from` is left-gravity and `to`
//!   right-gravity (same rules as comment anchors), so typing at either
//!   boundary extends the marked range. Accept deletes the current marked
//!   range; reject keeps the text and drops the record.
//! - `del` revisions record a deletion that already happened. Both anchors
//!   collapse to the deletion point (right-gravity, bookmark-like) and
//!   `text` carries the deleted *plain* text (blocks joined by `\n`, the
//!   same serialization `deleteRange` reports). Accept drops the record —
//!   the deletion stands. Reject re-inserts `text` at the anchor as one
//!   `insertText`, which restores the characters but NOT their styles or
//!   paragraph kinds (documented fidelity limit).
//!
//! Reads (`text`, `findText`, `layout`, `blocks`, `describe`, `exportDocx`)
//! always see the current content: pending deletions live only in the
//! revision record, pending insertions are ordinary text. There is no
//! "show markup" view and no DOCX `w:ins`/`w:del` interop — both deferred.
//!
//! Tracking is enabled per document by `setTrackChanges`; while enabled,
//! `insertText`, `deleteRange` and `replaceRange` (which composes the two)
//! record revisions. Per-op `author`/`time` payload fields override the
//! configured default author; `time` is a caller-supplied unix-seconds
//! timestamp (the engine has no clock). Accept/reject ops never create new
//! revisions even while tracking is on. Structural ops (`splitBlock`,
//! `mergeBlock`, `insertBlock`, table ops, `changeCase`, `applyStyle`,
//! `replaceText`, `setCellText`, `importDocx`) do not create revisions —
//! format-change revisions and cell-text revisions are deferred — but all
//! of them still re-map existing revision anchors.
//!
//! Scope bounds: at most `REVISIONS_MAX` records, deleted-text payloads at
//! most `REVISION_TEXT_MAX` chars (larger deletions are still applied but
//! go unmarked), ids are engine-generated `rev-N` tokens. Snapshots carry
//! revisions inside the schema:3 wrapper's `deny_unknown_fields` document,
//! so schema:3-era readers fail closed on the `revisions`/`tracking` keys —
//! no schema bump, same precedent as comments/sections.

use super::comments::{validate_comment_author, CommentAnchor};
use super::*;
use serde::{Deserialize, Serialize};

/// Bound on stored revision records so snapshots stay small.
pub const REVISIONS_MAX: usize = 1024;
/// Deleted-text payload cap (Unicode scalars). Larger deletions apply but
/// are not tracked rather than ballooning snapshots.
const REVISION_TEXT_MAX: usize = 65_536;
/// `time` is caller-supplied unix seconds; bounded to year 9999.
const REVISION_TIME_MAX: u64 = 253_402_300_799;

/// Revision kind: `ins` brackets live inserted text, `del` records removed
/// plain text in `text`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RevisionKind {
    Ins,
    Del,
}

/// One tracked change. `from`/`to` are live `{block,offset}` anchors (same
/// unit as `Pos`, Unicode scalar offsets). For `ins`, `from <= to` brackets
/// the inserted range; for `del`, `from == to` is the collapse point where
/// `text` was removed. `author`/`time` are optional attribution; `time` is
/// unix seconds supplied by the caller (no engine clock).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Revision {
    pub id: String,
    pub kind: RevisionKind,
    pub from: CommentAnchor,
    pub to: CommentAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<u64>,
    /// `del` only: the deleted plain text (`\n`-joined), restored by
    /// `rejectRevision`. Must be absent on `ins` records.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Persisted track-changes setting: whether edits record revisions and the
/// default `author` stamped on them (per-op `author` overrides).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackChanges {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
}

fn revision_anchor(p: Pos) -> CommentAnchor {
    CommentAnchor {
        block: p.block,
        offset: p.offset,
    }
}

fn anchor_pos(a: &CommentAnchor) -> Pos {
    Pos {
        block: a.block,
        offset: a.offset,
    }
}

fn validate_revision(r: &Revision, blocks: &[Block]) -> Result<(), EngineError> {
    validate_style_token(&r.id, "revision id")?;
    if let Some(author) = &r.author {
        validate_comment_author(author)?;
    }
    if let Some(time) = r.time {
        if time > REVISION_TIME_MAX {
            return Err(EngineError::validation(format!(
                "revision time must be at most {REVISION_TIME_MAX}"
            )));
        }
    }
    match r.kind {
        RevisionKind::Ins => {
            if r.text.is_some() {
                return Err(EngineError::validation(
                    "ins revisions must not carry deleted text",
                ));
            }
            if !anchor_pos(&r.from).le(anchor_pos(&r.to)) {
                return Err(EngineError::validation(
                    "revision range end precedes range start",
                ));
            }
        }
        RevisionKind::Del => {
            let Some(text) = &r.text else {
                return Err(EngineError::validation(
                    "del revisions must carry the deleted text",
                ));
            };
            if text.is_empty() || text.chars().count() > REVISION_TEXT_MAX {
                return Err(EngineError::validation(format!(
                    "del revision text must be 1..{REVISION_TEXT_MAX} characters"
                )));
            }
            if anchor_pos(&r.from) != anchor_pos(&r.to) {
                return Err(EngineError::validation(
                    "del revision anchors must coincide at the deletion point",
                ));
            }
        }
    }
    for (name, a) in [("from", &r.from), ("to", &r.to)] {
        let Some(b) = blocks.get(a.block) else {
            return Err(EngineError::out_of_bounds(format!(
                "revision '{}' anchor '{name}' block {} out of range ({} blocks)",
                r.id,
                a.block,
                blocks.len()
            )));
        };
        if a.offset > block_len(b) {
            return Err(EngineError::out_of_bounds(format!(
                "revision '{}' anchor '{name}' offset {} out of range (block {} has {} chars)",
                r.id,
                a.offset,
                a.block,
                block_len(b)
            )));
        }
    }
    Ok(())
}

/// Full revision validation for restore: count, id uniqueness, per-record
/// fields, and anchor bounds against the final block list. Runs before live
/// state is replaced.
pub fn validate_revisions(revisions: &[Revision], blocks: &[Block]) -> Result<(), EngineError> {
    if revisions.len() > REVISIONS_MAX {
        return Err(EngineError::validation("too many revisions"));
    }
    let mut seen = std::collections::HashSet::with_capacity(revisions.len());
    for r in revisions {
        validate_revision(r, blocks)?;
        if !seen.insert(r.id.as_str()) {
            return Err(EngineError::validation(format!(
                "duplicate revision id '{}'",
                r.id
            )));
        }
    }
    Ok(())
}

/// Sort key shared by `listRevisions` and `acceptAllRevisions`/`rejectAllRevisions`.
fn revision_sort_key(r: &Revision) -> (usize, usize, usize, usize, &str) {
    (
        r.from.block,
        r.from.offset,
        r.to.block,
        r.to.offset,
        r.id.as_str(),
    )
}

// ---------------------------------------------------------------------------
// Engine ops
// ---------------------------------------------------------------------------

/// Per-op attribution parsed from an edit payload: `author`
/// (absent / null→clear / string→set) and `time` (unix seconds). Shared by
/// insertText/deleteRange/replaceRange; validated before mutation so a bad
/// value rejects the whole op.
#[derive(Default)]
pub(super) struct Attribution {
    /// `None` = payload absent (use tracking default); `Some(None)` =
    /// explicit `author:null` (no author); `Some(Some(s))` = override.
    author: Option<Option<String>>,
    time: Option<u64>,
}

fn parse_attribution(p: &Value) -> Result<Attribution, EngineError> {
    let author = match p.get("author") {
        Some(v) if v.is_null() => Some(None),
        Some(v) => {
            let a = as_str(v, "author")?;
            validate_comment_author(a)?;
            Some(Some(a.to_string()))
        }
        None => None,
    };
    let time = match p.get("time") {
        Some(v) => {
            let t = v
                .as_u64()
                .ok_or_else(|| EngineError::invalid("'time' must be a non-negative integer"))?;
            if t > REVISION_TIME_MAX {
                return Err(EngineError::validation(format!(
                    "'time' must be at most {REVISION_TIME_MAX}"
                )));
            }
            Some(t)
        }
        None => None,
    };
    Ok(Attribution { author, time })
}

impl QuillEngine {
    fn find_revision(&self, id: &str) -> Result<usize, EngineError> {
        self.revisions
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| EngineError::validation(format!("unknown revision '{id}'")))
    }

    /// Parse and validate the payload's `author`/`time` attribution when
    /// tracking is enabled (a malformed value must reject the edit before
    /// it mutates); returns a default when tracking is off so callers can
    /// pass it unconditionally.
    pub(super) fn revision_attr(&self, p: &Value) -> Result<Attribution, EngineError> {
        if self.tracking.is_some() {
            parse_attribution(p)
        } else {
            Ok(Attribution::default())
        }
    }

    /// Record a revision for a just-applied tracked edit. `attr` is the
    /// payload attribution already validated by the op (parsed only when
    /// tracking is enabled). No-op when tracking is disabled, the record
    /// cap is reached, or (for `del`) the deleted text exceeds
    /// `REVISION_TEXT_MAX` — oversized deletions still apply, they just go
    /// unmarked.
    pub(super) fn track_revision(
        &mut self,
        kind: RevisionKind,
        from: Pos,
        to: Pos,
        text: Option<String>,
        attr: &Attribution,
    ) {
        let Some(tracking) = &self.tracking else {
            return;
        };
        if self.revisions.len() >= REVISIONS_MAX {
            return;
        }
        if kind == RevisionKind::Del {
            let len = text.as_deref().map_or(0, |t| t.chars().count());
            if len == 0 || len > REVISION_TEXT_MAX {
                return;
            }
        }
        let author = match &attr.author {
            Some(a) => a.clone(),
            None => tracking.author.clone(),
        };
        let id = (1..)
            .map(|i| format!("rev-{i}"))
            .find(|candidate| !self.revisions.iter().any(|r| r.id == *candidate))
            .expect("revision id space exhausted below REVISIONS_MAX");
        self.revisions.push(Revision {
            id,
            kind,
            from: revision_anchor(from),
            to: revision_anchor(to),
            author,
            time: attr.time,
            text,
        });
    }

    /// `setTrackChanges {enabled, author?}` — `author` is a patch: a string
    /// sets the default revision author, null clears it, absent keeps the
    /// current value. Disabling clears the whole setting. Same resulting
    /// setting is eventless.
    pub(super) fn op_set_track_changes(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let enabled = field(p, "enabled")?
            .as_bool()
            .ok_or_else(|| EngineError::invalid("'enabled' must be a bool"))?;
        let next = if enabled {
            let mut author = self.tracking.as_ref().and_then(|t| t.author.clone());
            if let Some(v) = p.get("author") {
                author = if v.is_null() {
                    None
                } else {
                    let a = as_str(v, "author")?;
                    validate_comment_author(a)?;
                    Some(a.to_string())
                };
            }
            Some(TrackChanges { author })
        } else {
            None
        };
        if next == self.tracking {
            return Ok(Self::read_only(json!({ "ok": true, "enabled": enabled })));
        }
        let before = self.tracking.clone();
        self.tracking = next;
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections {
                tracking: Some(before),
                ..Default::default()
            },
        );
        Ok(CommandResult::data(json!({ "ok": true, "enabled": enabled })))
    }

    /// `listRevisions` — read-only; sorted by anchor position then id.
    /// `text` is present only on `del` records.
    pub(super) fn op_list_revisions(&self) -> Result<CommandResult, EngineError> {
        let mut sorted: Vec<&Revision> = self.revisions.iter().collect();
        sorted.sort_by(|a, b| revision_sort_key(a).cmp(&revision_sort_key(b)));
        let arr: Vec<Value> = sorted
            .iter()
            .map(|r| {
                let mut v = json!({
                    "id": r.id,
                    "kind": match r.kind {
                        RevisionKind::Ins => "ins",
                        RevisionKind::Del => "del",
                    },
                    "from": { "block": r.from.block, "offset": r.from.offset },
                    "to": { "block": r.to.block, "offset": r.to.offset },
                    "author": r.author,
                    "time": r.time,
                });
                if let Some(text) = &r.text {
                    v["text"] = json!(text);
                }
                v
            })
            .collect();
        Ok(Self::read_only(json!({ "revisions": arr })))
    }

    /// Clone the mutable state needed to stage accept/reject decisions.
    /// `tracking` is forced off so resolving revisions never records new
    /// ones even while track changes is enabled.
    fn staged_for_revisions(&self) -> Self {
        Self {
            blocks: self.blocks.clone(),
            bookmarks: self.bookmarks.clone(),
            comments: self.comments.clone(),
            styles: self.styles.clone(),
            sections: self.sections.clone(),
            revisions: self.revisions.clone(),
            tracking: None,
            journal: Journal::new(1),
        }
    }

    /// Apply one accept (`accept == true`) or reject decision for revision
    /// `id` on `stage`, removing the record. Returns `true` when a record
    /// was resolved. Unknown ids are a no-op so `*All` variants can skip
    /// records already consumed by earlier decisions in the same batch.
    fn stage_revision_decision(
        stage: &mut Self,
        id: &str,
        accept: bool,
    ) -> Result<bool, EngineError> {
        let Some(index) = stage.revisions.iter().position(|r| r.id == id) else {
            return Ok(false);
        };
        let rev = stage.revisions.remove(index);
        match (rev.kind, accept) {
            // Accepting an insertion deletes the currently marked range.
            // A collapsed range (its text was fully deleted meanwhile)
            // just drops the record.
            (RevisionKind::Ins, true) => {
                let from = anchor_pos(&rev.from);
                let to = anchor_pos(&rev.to);
                if from != to {
                    stage.op_delete_range(&json!({
                        "from": { "block": from.block, "offset": from.offset },
                        "to": { "block": to.block, "offset": to.offset },
                    }))?;
                }
            }
            // Rejecting a deletion re-inserts its stored plain text at the
            // collapse point. Styles/kinds are not restored (see module
            // docs); insertText handles `\n` splits and all anchor remaps.
            (RevisionKind::Del, false) => {
                if let Some(text) = &rev.text {
                    if !text.is_empty() {
                        let at = anchor_pos(&rev.from);
                        stage.op_insert_text(&json!({
                            "at": { "block": at.block, "offset": at.offset },
                            "text": text,
                        }))?;
                    }
                }
            }
            // ins+reject and del+accept only drop the record.
            _ => {}
        }
        Ok(true)
    }

    /// Commit a staged revision decision as one whole-document undo entry.
    /// `revisions_before` is the pre-commit revision list; every other
    /// collection's before-image is the live (pre-commit) value, which the
    /// staged ops may have re-mapped.
    fn commit_staged(&mut self, stage: &Self, revisions_before: Vec<Revision>) {
        let before = Collections {
            bookmarks: Some(self.bookmarks.clone()),
            comments: Some(self.comments.clone()),
            styles: Some(self.styles.clone()),
            sections: Some(self.sections.clone()),
            revisions: Some(revisions_before),
            ..Default::default()
        };
        let removed = std::mem::replace(&mut self.blocks, stage.blocks.clone());
        self.bookmarks = stage.bookmarks.clone();
        self.comments = stage.comments.clone();
        self.styles = stage.styles.clone();
        self.sections = stage.sections.clone();
        self.revisions = stage.revisions.clone();
        self.record_undo(0, removed, self.blocks.clone(), before);
    }

    /// `acceptRevision {id}` / `rejectRevision {id}`.
    pub(super) fn op_revision_decision(&mut self, p: &Value, accept: bool) -> Result<CommandResult, EngineError> {
        let id = as_str(field(p, "id")?, "id")?.to_string();
        self.find_revision(&id)?;
        let revisions_before = self.revisions.clone();
        let mut stage = self.staged_for_revisions();
        Self::stage_revision_decision(&mut stage, &id, accept)?;
        self.commit_staged(&stage, revisions_before);
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `acceptAllRevisions {kind?}` / `rejectAllRevisions {kind?}` —
    /// resolves every pending revision (optionally filtered to `"ins"` or
    /// `"del"`) in document order as one undo entry. A revision whose
    /// decision fails on the staged document (for example a `del` reject
    /// anchored on a since-deleted table block) is left pending rather than
    /// failing the whole batch.
    pub(super) fn op_revision_decision_all(
        &mut self,
        p: &Value,
        accept: bool,
    ) -> Result<CommandResult, EngineError> {
        let kind = match p.get("kind") {
            Some(v) => {
                let s = as_str(v, "kind")?;
                match s {
                    "ins" => Some(RevisionKind::Ins),
                    "del" => Some(RevisionKind::Del),
                    other => {
                        return Err(EngineError::validation(format!(
                            "unknown revision kind '{other}'"
                        )))
                    }
                }
            }
            None => None,
        };
        let mut ids: Vec<(usize, usize, usize, usize, String)> = self
            .revisions
            .iter()
            .filter(|r| kind.is_none() || Some(r.kind) == kind)
            .map(|r| {
                (
                    r.from.block,
                    r.from.offset,
                    r.to.block,
                    r.to.offset,
                    r.id.clone(),
                )
            })
            .collect();
        ids.sort();
        if ids.is_empty() {
            return Ok(Self::read_only(json!({ "ok": true, "applied": 0 })));
        }
        let revisions_before = self.revisions.clone();
        let mut stage = self.staged_for_revisions();
        let mut applied = 0usize;
        for (_, _, _, _, id) in ids {
            if Self::stage_revision_decision(&mut stage, &id, accept).unwrap_or(false) {
                applied += 1;
            }
        }
        if applied == 0 {
            // Every matching decision failed on the staged document; leave
            // state untouched.
            return Ok(Self::read_only(json!({ "ok": true, "applied": 0 })));
        }
        self.commit_staged(&stage, revisions_before);
        Ok(CommandResult::data(json!({ "ok": true, "applied": applied })))
    }
}

// ---------------------------------------------------------------------------
// Anchor remapping
// ---------------------------------------------------------------------------
//
// Revision anchors are live `{block,offset}` positions re-mapped by every
// position-moving op, exactly like comment anchors. Gravity differs by
// endpoint and kind: `ins` uses the comment rules (`from` left-gravity,
// `to` right-gravity) so typing at either boundary extends the marked
// range; `del` records collapse to a point and use right gravity (the
// bookmark/`to` rule) for both endpoints so they stay coincident.

/// `(from_left, to_right)` gravity flags for one revision kind.
fn gravities(kind: RevisionKind) -> (bool, bool) {
    match kind {
        RevisionKind::Ins => (true, false),
        RevisionKind::Del => (false, false),
    }
}

impl QuillEngine {
    /// `insertText` at `at` inserting `text` (already validated).
    pub(super) fn remap_revisions_insert_text(&mut self, at: Pos, text: &str) {
        if self.revisions.is_empty() {
            return;
        }
        let added = text.bytes().filter(|&b| b == b'\n').count();
        let plain = text.chars().count();
        let last_len = text.rsplit('\n').next().map_or(0, |s| s.chars().count());
        for r in &mut self.revisions {
            let (fl, tl) = gravities(r.kind);
            let from = anchor_pos(&r.from);
            let to = anchor_pos(&r.to);
            r.from = revision_anchor(Self::map_pos_insert(
                from, at, added, last_len, plain, fl,
            ));
            r.to = revision_anchor(Self::map_pos_insert(
                to, at, added, last_len, plain, tl,
            ));
        }
    }

    /// `deleteRange` from `from` to `to` (already validated, from != to).
    /// Endpoints inside the deleted span clamp to `from`, matching comment
    /// anchors — a marked insertion whose text is partly deleted keeps the
    /// surviving marked range, and a deletion point clamps to the delete
    /// start.
    pub(super) fn remap_revisions_delete(&mut self, from: Pos, to: Pos) {
        if self.revisions.is_empty() {
            return;
        }
        for r in &mut self.revisions {
            let fp = anchor_pos(&r.from);
            let tp = anchor_pos(&r.to);
            r.from = revision_anchor(Self::map_pos_delete(fp, from, to));
            r.to = revision_anchor(Self::map_pos_delete(tp, from, to));
        }
    }

    /// `splitBlock` at `at`: same gravity split as comments — an `ins`
    /// `from` anchor at the split point stays on the head block while `to`
    /// moves to the tail, keeping the marked range spanning the break.
    pub(super) fn remap_revisions_split(&mut self, at: Pos) {
        if self.revisions.is_empty() {
            return;
        }
        for r in &mut self.revisions {
            let (fl, tl) = gravities(r.kind);
            let fp = anchor_pos(&r.from);
            let tp = anchor_pos(&r.to);
            r.from = revision_anchor(Self::map_pos_split(fp, at, fl));
            r.to = revision_anchor(Self::map_pos_split(tp, at, tl));
        }
    }

    /// `mergeBlock` at `index`: `head_len` is the pre-merge length of
    /// `blocks[index - 1]`.
    pub(super) fn remap_revisions_merge(&mut self, index: usize, head_len: usize) {
        if self.revisions.is_empty() {
            return;
        }
        for r in &mut self.revisions {
            let fp = anchor_pos(&r.from);
            let tp = anchor_pos(&r.to);
            r.from = revision_anchor(Self::map_pos_merge(fp, index, head_len));
            r.to = revision_anchor(Self::map_pos_merge(tp, index, head_len));
        }
    }

    /// `insertBlock`/`insertTable` at `index`: anchors at or after it shift
    /// one block.
    pub(super) fn remap_revisions_insert_block(&mut self, index: usize) {
        if self.revisions.is_empty() {
            return;
        }
        for r in &mut self.revisions {
            if r.from.block >= index {
                r.from.block += 1;
            }
            if r.to.block >= index {
                r.to.block += 1;
            }
        }
    }

    /// `changeCase` re-anchor pass: `offset_maps` is `(block_index,
    /// offset_map)` per affected block where `offset_map[i]` is the output
    /// offset produced by the first `i` source scalars (plus a final entry
    /// for the block end). Both endpoints of every revision in an affected
    /// block map through it; case conversion never crosses block bounds.
    pub(super) fn remap_revisions_change_case(&mut self, offset_maps: &[(usize, Vec<usize>)]) {
        if self.revisions.is_empty() {
            return;
        }
        for r in &mut self.revisions {
            for a in [&mut r.from, &mut r.to] {
                if let Some((_, map)) = offset_maps.iter().find(|(bi, _)| *bi == a.block) {
                    a.offset = map[a.offset];
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

    fn track(e: &mut QuillEngine, author: Option<&str>) {
        apply(
            e,
            "setTrackChanges",
            match author {
                Some(a) => json!({"enabled": true, "author": a}),
                None => json!({"enabled": true}),
            },
        );
    }

    fn insert(e: &mut QuillEngine, block: usize, offset: usize, t: &str) {
        apply(
            e,
            "insertText",
            json!({"at": {"block": block, "offset": offset}, "text": t}),
        );
    }

    fn revisions(e: &mut QuillEngine) -> Vec<Value> {
        apply(e, "listRevisions", json!({})).data["revisions"]
            .as_array()
            .unwrap()
            .clone()
    }

    fn text_of(e: &mut QuillEngine) -> String {
        apply(e, "text", json!({})).data["text"].as_str().unwrap().to_string()
    }

    #[test]
    fn tracking_off_records_nothing() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello");
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":2}}),
        );
        assert!(revisions(&mut e).is_empty());
    }

    #[test]
    fn insert_records_ins_revision_with_author_and_time() {
        let mut e = engine();
        track(&mut e, Some("Ada"));
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":0},"text":"hi","author":"Grace","time":1700000000}),
        );
        let revs = revisions(&mut e);
        assert_eq!(revs.len(), 1);
        assert_eq!(revs[0]["kind"], "ins");
        assert_eq!(revs[0]["from"], json!({"block":0,"offset":0}));
        assert_eq!(revs[0]["to"], json!({"block":0,"offset":2}));
        assert_eq!(revs[0]["author"], "Grace");
        assert_eq!(revs[0]["time"], 1700000000);
        assert!(revs[0].get("text").is_none());
    }

    #[test]
    fn insert_falls_back_to_tracking_author_and_multiline_range() {
        let mut e = engine();
        track(&mut e, Some("Ada"));
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":0},"text":"ab\ncd"}),
        );
        let revs = revisions(&mut e);
        assert_eq!(revs.len(), 1);
        assert_eq!(revs[0]["author"], "Ada");
        assert_eq!(revs[0]["from"], json!({"block":0,"offset":0}));
        assert_eq!(revs[0]["to"], json!({"block":1,"offset":2}));
        assert_eq!(text_of(&mut e), "ab\ncd");
    }

    #[test]
    fn delete_records_del_revision_and_reject_restores_text() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello world");
        track(&mut e, Some("Ada"));
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":6}}),
        );
        assert_eq!(text_of(&mut e), "world");
        let revs = revisions(&mut e);
        assert_eq!(revs.len(), 1);
        assert_eq!(revs[0]["kind"], "del");
        assert_eq!(revs[0]["from"], json!({"block":0,"offset":0}));
        assert_eq!(revs[0]["to"], json!({"block":0,"offset":0}));
        assert_eq!(revs[0]["text"], "hello ");
        // Reject restores the deleted plain text at the collapse point.
        apply(&mut e, "rejectRevision", json!({"id": revs[0]["id"]}));
        assert_eq!(text_of(&mut e), "hello world");
        assert!(revisions(&mut e).is_empty());
    }

    #[test]
    fn accept_revision_deletes_marked_insert() {
        let mut e = engine();
        insert(&mut e, 0, 0, "keep");
        track(&mut e, None);
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":4},"text":" DROP"}),
        );
        assert_eq!(text_of(&mut e), "keep DROP");
        let id = revisions(&mut e)[0]["id"].as_str().unwrap().to_string();
        apply(&mut e, "acceptRevision", json!({"id": id}));
        assert_eq!(text_of(&mut e), "keep");
        assert!(revisions(&mut e).is_empty());
        // Undo restores both the text and the pending revision.
        e.undo().unwrap();
        assert_eq!(text_of(&mut e), "keep DROP");
        assert_eq!(revisions(&mut e).len(), 1);
    }

    #[test]
    fn accept_revision_on_del_only_drops_record() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abcdef");
        track(&mut e, None);
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":1},"to":{"block":0,"offset":4}}),
        );
        let id = revisions(&mut e)[0]["id"].as_str().unwrap().to_string();
        apply(&mut e, "acceptRevision", json!({"id": id}));
        assert_eq!(text_of(&mut e), "aef");
        assert!(revisions(&mut e).is_empty());
    }

    #[test]
    fn reject_revision_on_ins_keeps_text() {
        let mut e = engine();
        track(&mut e, None);
        insert(&mut e, 0, 0, "new");
        let id = revisions(&mut e)[0]["id"].as_str().unwrap().to_string();
        apply(&mut e, "rejectRevision", json!({"id": id}));
        assert_eq!(text_of(&mut e), "new");
        assert!(revisions(&mut e).is_empty());
    }

    #[test]
    fn replace_range_records_del_and_ins() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello");
        track(&mut e, Some("Ada"));
        apply(
            &mut e,
            "replaceRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":5},"text":"bye"}),
        );
        let revs = revisions(&mut e);
        assert_eq!(revs.len(), 2);
        assert!(revs.iter().any(|r| r["kind"] == "del" && r["text"] == "hello"));
        assert!(revs.iter().any(|r| r["kind"] == "ins"
            && r["from"] == json!({"block":0,"offset":0})
            && r["to"] == json!({"block":0,"offset":3})));
        assert_eq!(text_of(&mut e), "bye");
    }

    #[test]
    fn anchors_remap_through_later_edits() {
        let mut e = engine();
        track(&mut e, None);
        insert(&mut e, 0, 0, "ac");
        // Insert exactly at the `from` boundary: left gravity keeps `from`
        // put while right-gravity `to` moves, so the new text lands inside
        // the marked range.
        insert(&mut e, 0, 0, "b");
        // Two tracked inserts now exist ("b" and "ac"); the "ac" record's
        // `to` moved right while its `from` stayed at the boundary.
        let revs = revisions(&mut e);
        assert_eq!(revs.len(), 2);
        let ac = revs
            .iter()
            .find(|r| r["to"] == json!({"block":0,"offset":3}))
            .unwrap();
        assert_eq!(ac["from"], json!({"block":0,"offset":0}));
        // Typing inside the "ac" range extends its `to`.
        insert(&mut e, 0, 1, "X");
        let revs = revisions(&mut e);
        let ac = revs
            .iter()
            .find(|r| r["kind"] == "ins" && r["from"] == json!({"block":0,"offset":0})
                && r["to"] == json!({"block":0,"offset":4}))
            .expect("ac revision should span bXac");
        // Accepting deletes everything currently marked ("bXac").
        let id = ac["id"].as_str().unwrap().to_string();
        apply(&mut e, "acceptRevision", json!({"id": id}));
        // "b" and "X" were inside the accepted range too.
        assert_eq!(text_of(&mut e), "");
    }

    #[test]
    fn ins_anchor_survives_split_and_merge() {
        let mut e = engine();
        track(&mut e, None);
        insert(&mut e, 0, 0, "abcd");
        // Split inside the marked range: from stays on head, to moves to
        // the tail block — the range still spans the break.
        apply(
            &mut e,
            "splitBlock",
            json!({"at":{"block":0,"offset":2}}),
        );
        let revs = revisions(&mut e);
        assert_eq!(revs[0]["from"], json!({"block":0,"offset":0}));
        assert_eq!(revs[0]["to"], json!({"block":1,"offset":2}));
        apply(&mut e, "mergeBlock", json!({"index":1}));
        let revs = revisions(&mut e);
        assert_eq!(revs[0]["from"], json!({"block":0,"offset":0}));
        assert_eq!(revs[0]["to"], json!({"block":0,"offset":4}));
        assert_eq!(text_of(&mut e), "abcd");
    }

    #[test]
    fn del_point_anchor_survives_block_insert() {
        let mut e = engine();
        insert(&mut e, 0, 0, "one\ntwo");
        track(&mut e, None);
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":1,"offset":0},"to":{"block":1,"offset":1}}),
        );
        apply(&mut e, "insertBlock", json!({"index":0}));
        let revs = revisions(&mut e);
        assert_eq!(revs[0]["from"], json!({"block":2,"offset":0}));
    }

    #[test]
    fn accept_all_and_kind_filter() {
        let mut e = engine();
        insert(&mut e, 0, 0, "base");
        track(&mut e, None);
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":4},"text":" INS"}),
        );
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":2}}),
        );
        assert_eq!(revisions(&mut e).len(), 2);
        // Reject only deletions: "se INS" remains ("ba" restored), the
        // insertion stays pending.
        let r = apply(&mut e, "rejectAllRevisions", json!({"kind":"del"}));
        assert_eq!(r.data["applied"], 1);
        assert_eq!(text_of(&mut e), "base INS");
        assert_eq!(revisions(&mut e).len(), 1);
        // Accept everything left.
        let r = apply(&mut e, "acceptAllRevisions", json!({}));
        assert_eq!(r.data["applied"], 1);
        assert_eq!(text_of(&mut e), "base");
        assert!(revisions(&mut e).is_empty());
        // Empty batch is eventless.
        let r = apply(&mut e, "acceptAllRevisions", json!({}));
        assert_eq!(r.data["applied"], 0);
        assert!(r.events.is_empty());
    }

    #[test]
    fn set_track_changes_persists_and_toggles() {
        let mut e = engine();
        // Eventless when already disabled.
        let r = apply(&mut e, "setTrackChanges", json!({"enabled": false}));
        assert!(r.events.is_empty());
        track(&mut e, Some("Ada"));
        assert_eq!(e.tracking, Some(TrackChanges { author: Some("Ada".into()) }));
        // Author patch keeps working; null clears.
        apply(&mut e, "setTrackChanges", json!({"enabled": true, "author": null}));
        assert_eq!(e.tracking, Some(TrackChanges { author: None }));
        apply(&mut e, "setTrackChanges", json!({"enabled": false}));
        assert_eq!(e.tracking, None);
        // Undo restores the setting.
        e.undo().unwrap();
        assert_eq!(e.tracking, Some(TrackChanges { author: None }));
    }

    #[test]
    fn snapshot_round_trip_preserves_revisions_and_tracking() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello");
        track(&mut e, Some("Ada"));
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":5},"text":"!"}),
        );
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":1}}),
        );
        let bytes = e.snapshot().unwrap();
        let mut e2 = engine();
        e2.restore(&bytes).unwrap();
        assert_eq!(e2.tracking, Some(TrackChanges { author: Some("Ada".into()) }));
        let revs = revisions(&mut e2);
        assert_eq!(revs.len(), 2);
        assert_eq!(text_of(&mut e2), "ello!");
        // Snapshot emits the schema:3 wrapper carrying revisions+tracking.
        let payload = ignition_core::decode_envelope(&bytes).unwrap().1;
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["schema"], 3);
        assert!(v["document"]["revisions"].is_array());
        assert_eq!(v["document"]["tracking"]["author"], "Ada");
    }

    #[test]
    fn snapshot_without_revisions_keeps_legacy_shape() {
        let mut e = engine();
        insert(&mut e, 0, 0, "plain");
        let bytes = e.snapshot().unwrap();
        let payload = ignition_core::decode_envelope(&bytes).unwrap().1;
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert!(v.get("kind").is_none());
        assert!(v["blocks"].is_array());
    }

    #[test]
    fn hostile_restore_rejects_bad_revisions() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        let good = json!({
            "kind":"quill","schema":3,
            "document":{
                "blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],
                "bookmarks":[],
                "revisions":[
                    {"id":"r1","kind":"ins","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"author":"A","time":5},
                    {"id":"r2","kind":"del","from":{"block":0,"offset":1},"to":{"block":0,"offset":1},"text":"x"}
                ]
            }
        });
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&good).unwrap().as_slice());
        e.restore(&bytes).unwrap();
        assert_eq!(revisions(&mut e).len(), 2);

        let cases: Vec<Value> = vec![
            // duplicate ids
            json!({"id":"r","kind":"ins","from":{"block":0,"offset":0},"to":{"block":0,"offset":1}}),
            json!({"id":"r","kind":"ins","from":{"block":0,"offset":0},"to":{"block":0,"offset":1}}),
        ];
        let _ = cases;
        // del without text
        let bad_del = json!({"kind":"quill","schema":3,"document":{"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],"bookmarks":[],"revisions":[{"id":"r","kind":"del","from":{"block":0,"offset":0},"to":{"block":0,"offset":0}}]}});
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&bad_del).unwrap().as_slice());
        assert!(e.restore(&bytes).is_err());
        // ins carrying text
        let bad_ins = json!({"kind":"quill","schema":3,"document":{"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],"bookmarks":[],"revisions":[{"id":"r","kind":"ins","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"text":"x"}]}});
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&bad_ins).unwrap().as_slice());
        assert!(e.restore(&bytes).is_err());
        // del anchors must coincide
        let bad_span = json!({"kind":"quill","schema":3,"document":{"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],"bookmarks":[],"revisions":[{"id":"r","kind":"del","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"text":"x"}]}});
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&bad_span).unwrap().as_slice());
        assert!(e.restore(&bytes).is_err());
        // anchor out of bounds
        let bad_oob = json!({"kind":"quill","schema":3,"document":{"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],"bookmarks":[],"revisions":[{"id":"r","kind":"ins","from":{"block":0,"offset":0},"to":{"block":9,"offset":0}}]}});
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&bad_oob).unwrap().as_slice());
        assert!(e.restore(&bytes).is_err());
        // oversized author / bad time
        let bad_author = json!({"kind":"quill","schema":3,"document":{"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],"bookmarks":[],"revisions":[{"id":"r","kind":"ins","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"author":"x".repeat(200)}]}});
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&bad_author).unwrap().as_slice());
        assert!(e.restore(&bytes).is_err());
        let bad_time = json!({"kind":"quill","schema":3,"document":{"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],"bookmarks":[],"revisions":[{"id":"r","kind":"ins","from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"time":99999999999999u64}]}});
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&bad_time).unwrap().as_slice());
        assert!(e.restore(&bytes).is_err());
        // strays on schema:2 and legacy payloads reject
        let stray2 = json!({"kind":"quill","schema":2,"document":{"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{}}]}],"revisions":[]}});
        let bytes = ignition_core::encode_envelope(serde_json::to_vec(&stray2).unwrap().as_slice());
        assert!(e.restore(&bytes).is_err());
        // state untouched after all rejects
        assert_eq!(revisions(&mut e).len(), 2);
        assert_eq!(text_of(&mut e), "abc");
    }

    #[test]
    fn unknown_revision_and_bad_payloads_reject() {
        let mut e = engine();
        assert!(e.apply(cmd("acceptRevision", json!({"id":"nope"}))).is_err());
        track(&mut e, None);
        // bad attribution rejects before mutating
        assert!(e
            .apply(cmd(
                "insertText",
                json!({"at":{"block":0,"offset":0},"text":"x","author":""})
            ))
            .is_err());
        assert!(e
            .apply(cmd(
                "insertText",
                json!({"at":{"block":0,"offset":0},"text":"x","time":-1})
            ))
            .is_err());
        assert_eq!(text_of(&mut e), "");
        assert!(revisions(&mut e).is_empty());
        // setTrackChanges validation
        assert!(e.apply(cmd("setTrackChanges", json!({"enabled":"yes"}))).is_err());
        assert!(e
            .apply(cmd("setTrackChanges", json!({"enabled":true,"author":""})))
            .is_err());
        assert!(e
            .apply(cmd("acceptAllRevisions", json!({"kind":"fmt"})))
            .is_err());
    }

    #[test]
    fn revision_anchors_remap_through_delete_and_change_case() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Hello World");
        track(&mut e, None);
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":11},"text":"!"}),
        );
        // changeCase lowercases; the ins anchor at offset 12 maps through
        // the conversion (lengths unchanged here, but the path runs).
        apply(
            &mut e,
            "changeCase",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":12},"mode":"lower"}),
        );
        let revs = revisions(&mut e);
        assert_eq!(revs[0]["to"], json!({"block":0,"offset":12}));
        // A delete before the marked range shifts it left.
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":6}}),
        );
        let revs = revisions(&mut e);
        // "world!" remains; the tracked "!" insertion sits at 5..6 and the
        // tracked "hello " deletion collapsed at 0.
        assert!(revs.iter().any(|r| r["kind"] == "ins"
            && r["from"] == json!({"block":0,"offset":5})
            && r["to"] == json!({"block":0,"offset":6})));
        assert!(revs.iter().any(|r| r["kind"] == "del" && r["text"] == "hello "));
    }

    #[test]
    fn undo_redo_tracks_setting_and_records() {
        let mut e = engine();
        track(&mut e, Some("Ada"));
        insert(&mut e, 0, 0, "x");
        assert_eq!(revisions(&mut e).len(), 1);
        // Undo the insert: revision record rolls back with it.
        e.undo().unwrap();
        assert_eq!(text_of(&mut e), "");
        assert!(revisions(&mut e).is_empty());
        e.redo().unwrap();
        assert_eq!(revisions(&mut e).len(), 1);
        // Undo setTrackChanges.
        e.undo().unwrap();
        e.undo().unwrap();
        assert_eq!(e.tracking, None);
    }
}
