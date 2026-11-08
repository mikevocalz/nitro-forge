//! Mail merge (P12 slice 8, third part): `{{name}}` merge-field tokens in
//! block text plus record payloads supplied per command.
//!
//! Model decision — fields are plain text, not stored state. A merge field
//! is the literal token `{{name}}` inside a block's inline text (the same
//! way Word stores a MERGEFIELD as field-code text). There is no field
//! collection and no snapshot state: `listMergeFields` is a live scan like
//! `listToc`, so fields survive every existing op untouched — edits move,
//! split, or delete them exactly like any other text, and no anchor
//! machinery is needed for the fields themselves.
//!
//! Token grammar: `{{`, then the first `}}`, with the inner text trimmed;
//! the name must be 1..=64 chars with no `{`, `}`, or control characters
//! (interior spaces are allowed, so `{{ first name }}` names `first
//! name`). `{{`, `}}`, or blank/over-long/brace-containing inners are
//! literal text, never fields. Names match record keys exactly —
//! case-sensitive, no folding. Tokens never span blocks, paragraphs, or
//! the table cell serialization separators (`\n`/`\t` are control
//! characters a name cannot contain), and a token may span inline-run
//! boundaries inside one block.
//!
//! Records are data-source rows supplied in the op payload — the engine
//! is I/O-free, so it never reads CSV/DB; hosts parse sources and pass
//! records in. A record is a JSON object mapping field names to string
//! values (≤256 fields, values ≤8192 chars, no newlines — multi-paragraph
//! merge values are deferred, matching the `replaceText` rule). Field
//! names absent from a record merge as the empty string and are reported
//! in `missing`; record keys that match no document field are ignored
//! (Word's unused-column semantics). `previewMerge` is the read-only
//! multi-record text preview; `runMerge` is the mutating single-record
//! fill — it substitutes every token in an optional `Pos` range as one
//! atomic staged edit with one undo entry, covering table cells under the
//! same range-coverage rule `findText`/`replaceText` apply. Merge is
//! single-pass: substituted values are never rescanned for new tokens.
//! Replacement text inherits the style of the token's first scalar, like
//! `replaceText`. No DOCX mail-merge (`w:fldSimple`/`MERGEFIELD`)
//! interop.

use super::tables::table_text_map;
use super::*;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Merge-field names are 1..=64 non-control scalars without braces.
const MERGE_NAME_MAX: usize = 64;
/// Record values are single-line plain text; cap matches note bodies.
const MERGE_VALUE_MAX: usize = 8192;
/// Fields accepted per record so hostile payloads stay bounded.
const MERGE_RECORD_FIELDS_MAX: usize = 256;
/// Records accepted per `previewMerge` call.
const MERGE_RECORDS_MAX: usize = 1024;

fn valid_merge_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= MERGE_NAME_MAX
        && !name.chars().any(|c| c == '{' || c == '}' || c.is_control())
}

/// One `{{name}}` token: `start`/`end` are Unicode scalar offsets within
/// the scanned text (`end` exclusive) and `name` the trimmed field name.
struct MergeToken {
    start: usize,
    end: usize,
    name: String,
}

/// Scan `text` for merge-field tokens, left to right, non-overlapping.
/// An invalid `{{...}}` span is literal text and scanning resumes just
/// after its `{{`, so a later `{{` inside it can still open a token.
fn scan_merge_tokens(text: &str) -> Vec<MergeToken> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 1 < n {
        if chars[i] == '{' && chars[i + 1] == '{' {
            let mut k = i + 2;
            let mut close = None;
            while k + 1 < n {
                if chars[k] == '}' && chars[k + 1] == '}' {
                    close = Some(k);
                    break;
                }
                k += 1;
            }
            let Some(c) = close else { break };
            let inner: String = chars[i + 2..c].iter().collect();
            let name = inner.trim();
            if valid_merge_name(name) {
                out.push(MergeToken {
                    start: i,
                    end: c + 2,
                    name: name.to_string(),
                });
                i = c + 2;
            } else {
                i += 2;
            }
            continue;
        }
        i += 1;
    }
    out
}

/// Plain text with every token replaced by `record`'s value (missing
/// fields become empty). Single-pass: inserted values are not rescanned.
fn merge_plain(text: &str, record: &HashMap<String, String>) -> String {
    let tokens = scan_merge_tokens(text);
    if tokens.is_empty() {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut pos = 0usize;
    for t in &tokens {
        out.extend(chars[pos..t.start].iter());
        if let Some(v) = record.get(&t.name) {
            out.push_str(v);
        }
        pos = t.end;
    }
    out.extend(chars[pos..].iter());
    out
}

/// The `text`-op serialization of one block with fields merged: table
/// blocks keep the row/`\n`-cell/`\t`/paragraph serialization with each
/// cell paragraph merged individually.
fn merge_block_text(b: &Block, record: &HashMap<String, String>) -> String {
    match &b.table {
        Some(t) => table_text_map(t, |cb| merge_plain(&block_text(cb), record)),
        None => merge_plain(&block_text(b), record),
    }
}

/// Whole-document merged text — identical shape to the `text` op with no
/// range: blocks joined by `\n`, tables in their cell serialization.
fn merge_document_text(blocks: &[Block], record: &HashMap<String, String>) -> String {
    blocks
        .iter()
        .map(|b| merge_block_text(b, record))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Document-order field census: `{name, occurrences}` in first-appearance
/// order plus the total token count. Scans each block's `text`-op
/// serialization — tokens cannot span the `\n`/`\t` separators (control
/// characters are illegal in names), so this equals scanning every text
/// unit separately.
fn merge_field_census(blocks: &[Block]) -> (Vec<(String, usize)>, usize) {
    let mut order: Vec<String> = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut total = 0usize;
    for b in blocks {
        for t in scan_merge_tokens(&block_content_text(b)) {
            total += 1;
            let entry = counts.entry(t.name.clone()).or_insert(0);
            *entry += 1;
            if *entry == 1 {
                order.push(t.name.clone());
            }
        }
    }
    let fields = order
        .iter()
        .map(|n| (n.clone(), counts[n.as_str()]))
        .collect();
    (fields, total)
}

/// One located field token for `runMerge`. `cell` mirrors `TextMatch`:
/// `Some((row,col,cell_block))` inside a table cell paragraph.
struct MergeMatch {
    block: usize,
    cell: Option<(usize, usize, usize)>,
    start: usize,
    end: usize,
    name: String,
}

/// All field tokens within the `Pos` range under the same coverage rules
/// `find_matches` applies: per-block clipping on text blocks, and a
/// table's cell paragraphs searched whole iff the range covers the table
/// index without collapsing on it. Document order throughout.
fn merge_matches(blocks: &[Block], from: Pos, to: Pos) -> Vec<MergeMatch> {
    let mut out = Vec::new();
    for (bi, b) in blocks
        .iter()
        .enumerate()
        .take(to.block + 1)
        .skip(from.block)
    {
        if let Some(table) = &b.table {
            if from.block == bi && to.block == bi {
                continue;
            }
            for r in 0..table.rows {
                for c in 0..table.cols {
                    let cell = &table.cells[r * table.cols + c];
                    for (cbi, cb) in cell.blocks.iter().enumerate() {
                        for t in scan_merge_tokens(&block_text(cb)) {
                            out.push(MergeMatch {
                                block: bi,
                                cell: Some((r, c, cbi)),
                                start: t.start,
                                end: t.end,
                                name: t.name,
                            });
                        }
                    }
                }
            }
            continue;
        }
        let s = if bi == from.block { from.offset } else { 0 };
        let e = if bi == to.block {
            to.offset
        } else {
            block_len(b)
        };
        if e <= s {
            continue;
        }
        for t in scan_merge_tokens(&block_text(b)) {
            if t.start >= s && t.end <= e {
                out.push(MergeMatch {
                    block: bi,
                    cell: None,
                    start: t.start,
                    end: t.end,
                    name: t.name,
                });
            }
        }
    }
    out
}

/// Validate one record object: keys are canonical merge-field names
/// (already trimmed, grammar-checked) and values single-line strings.
fn parse_merge_record(v: &Value, what: &str) -> Result<HashMap<String, String>, EngineError> {
    let obj = v
        .as_object()
        .ok_or_else(|| EngineError::invalid(format!("'{what}' must be an object")))?;
    if obj.len() > MERGE_RECORD_FIELDS_MAX {
        return Err(EngineError::validation(format!(
            "'{what}' has too many fields (max {MERGE_RECORD_FIELDS_MAX})"
        )));
    }
    let mut record = HashMap::with_capacity(obj.len());
    for (key, val) in obj {
        if key.trim() != key.as_str() || !valid_merge_name(key) {
            return Err(EngineError::validation(format!(
                "'{what}' field name '{key}' is not a valid merge field name"
            )));
        }
        let s = val
            .as_str()
            .ok_or_else(|| EngineError::invalid(format!("'{what}.{key}' must be a string")))?;
        if s.chars().count() > MERGE_VALUE_MAX {
            return Err(EngineError::validation(format!(
                "'{what}.{key}' must be at most {MERGE_VALUE_MAX} characters"
            )));
        }
        if s.contains('\n') || s.contains('\r') {
            return Err(EngineError::validation(format!(
                "'{what}.{key}' must not contain newlines; merge values are single-line"
            )));
        }
        record.insert(key.clone(), s.to_string());
    }
    Ok(record)
}

/// Distinct field names (document order) that `record` does not define.
fn missing_fields(matches: &[MergeMatch], record: &HashMap<String, String>) -> Vec<String> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut out = Vec::new();
    for m in matches {
        if !record.contains_key(&m.name) && seen.insert(m.name.as_str()) {
            out.push(m.name.clone());
        }
    }
    out
}

/// Generalized per-block anchor remap for replacements of differing
/// lengths: `spans` are ascending, non-overlapping `(start,end,repl_len)`
/// scalar spans within one block. `left` gives comment-`from` gravity —
/// an offset exactly at a span start stays before the replacement;
/// every other offset strictly inside or at the end lands after it.
fn remap_offset_through_spans(offset: usize, spans: &[(usize, usize, usize)], left: bool) -> usize {
    let mut delta = 0isize;
    for &(s, e, r) in spans {
        if offset < s {
            break;
        }
        let ns = s as isize + delta;
        if offset < e {
            if left && offset == s {
                return ns as usize;
            }
            return (ns + r as isize) as usize;
        }
        delta += r as isize - (e - s) as isize;
    }
    (offset as isize + delta) as usize
}

impl QuillEngine {
    /// `listMergeFields` — read-only live scan for `{{name}}` tokens in
    /// document order of first appearance. `occurrences` totals every
    /// token; fields in table cell text count like any other text.
    pub(super) fn op_list_merge_fields(&self) -> Result<CommandResult, EngineError> {
        let (fields, occurrences) = merge_field_census(&self.blocks);
        let arr: Vec<Value> = fields
            .iter()
            .map(|(name, n)| json!({ "name": name, "occurrences": n }))
            .collect();
        Ok(Self::read_only(json!({
            "fields": arr,
            "occurrences": occurrences,
        })))
    }

    /// `previewMerge {records:[{field:value},...]}` — read-only. Each
    /// record is merged over the whole document (the `text`-op
    /// serialization, tables included) and reported as
    /// `{index,text,missing}` where `missing` lists the document's field
    /// names the record does not define, in first-appearance order.
    /// At most 1024 records; see module docs for the record grammar.
    pub(super) fn op_preview_merge(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let records_v = p
            .get("records")
            .ok_or_else(|| EngineError::invalid("payload missing 'records'"))?;
        let arr = records_v
            .as_array()
            .ok_or_else(|| EngineError::invalid("'records' must be an array"))?;
        if arr.len() > MERGE_RECORDS_MAX {
            return Err(EngineError::validation(format!(
                "too many records (max {MERGE_RECORDS_MAX})"
            )));
        }
        let (fields, occurrences) = merge_field_census(&self.blocks);
        let mut results = Vec::with_capacity(arr.len());
        for (i, rv) in arr.iter().enumerate() {
            let record = parse_merge_record(rv, "record")?;
            let text = merge_document_text(&self.blocks, &record);
            let missing: Vec<&String> = fields
                .iter()
                .map(|(name, _)| name)
                .filter(|n| !record.contains_key(*n))
                .collect();
            results.push(json!({
                "index": i,
                "text": text,
                "missing": missing,
            }));
        }
        let field_arr: Vec<Value> = fields
            .iter()
            .map(|(name, n)| json!({ "name": name, "occurrences": n }))
            .collect();
        Ok(Self::read_only(json!({
            "results": results,
            "fields": field_arr,
            "occurrences": occurrences,
        })))
    }

    /// `runMerge {record:{field:value,...}, from?, to?}` — substitute every
    /// merge-field token in the optional `Pos` range (default whole
    /// document, `findText`/`replaceText` coverage rules for tables) with
    /// the record's values as one atomic staged edit: one journal entry,
    /// one `document:changed`. Missing fields merge as empty text and are
    /// reported; record keys matching no field are ignored. Replacement
    /// text inherits the token's first-scalar style and cannot contain
    /// newlines (values are validated single-line). No tokens in range →
    /// eventless `{replaced:0}`.
    pub(super) fn op_run_merge(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let record = parse_merge_record(field(p, "record")?, "record")?;
        // Same range parsing as findText/replaceText: optional `from`/`to`
        // Pos bounds defaulting to document start/end.
        let doc_start = Pos {
            block: 0,
            offset: 0,
        };
        let doc_end = self.blocks.last().map_or(doc_start, |b| Pos {
            block: self.blocks.len() - 1,
            offset: block_len(b),
        });
        let (from, to) = match (p.get("from"), p.get("to")) {
            (None, None) => (doc_start, doc_end),
            (fv, tv) => {
                let from = match fv {
                    Some(v) => parse_pos(v)?,
                    None => doc_start,
                };
                let to = match tv {
                    Some(v) => parse_pos(v)?,
                    None => doc_end,
                };
                (from, to)
            }
        };
        // Validate positions against the live block list (table blocks
        // only accept offset 0, same as every Pos consumer).
        self.check_range(from, to)?;
        let matches = merge_matches(&self.blocks, from, to);
        if matches.is_empty() {
            return Ok(Self::read_only(json!({
                "ok": true,
                "replaced": 0,
                "missing": [],
            })));
        }
        let missing = missing_fields(&matches, &record);

        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        let revisions_before = self.revisions.clone();
        let footnotes_before = self.footnotes.clone();
        let citations_before = self.citations.clone();
        let mut staged = Self {
            blocks: self.blocks.clone(),
            bookmarks: self.bookmarks.clone(),
            comments: self.comments.clone(),
            styles: self.styles.clone(),
            sections: self.sections.clone(),
            revisions: self.revisions.clone(),
            tracking: self.tracking.clone(),
            footnotes: self.footnotes.clone(),
            citations: self.citations.clone(),
            sources: self.sources.clone(),
            fonts: self.fonts.clone(),
            journal: Journal::new(1),
        };

        // Top-level matches grouped by block, applied right-to-left per
        // block so earlier scalar offsets stay valid (replaceText rule).
        let top: Vec<&MergeMatch> = matches.iter().filter(|m| m.cell.is_none()).collect();
        let mut i = 0;
        while i < top.len() {
            let bi = top[i].block;
            let mut j = i;
            let mut per: Vec<&MergeMatch> = Vec::new();
            while j < top.len() && top[j].block == bi {
                per.push(top[j]);
                j += 1;
            }
            per.sort_by(|a, b| b.start.cmp(&a.start));
            for m in per {
                let repl = record.get(&m.name).cloned().unwrap_or_default();
                let style = style_at(&staged.blocks[bi], m.start + 1);
                let b = &mut staged.blocks[bi];
                let (head, _mid, tail) = split3(&b.inlines, m.start, m.end);
                let mut inlines = head;
                if !repl.is_empty() {
                    inlines.push(Inline { text: repl, style });
                }
                inlines.extend(tail);
                b.inlines = normalize_inlines(inlines);
            }
            i = j;
        }

        // In-cell matches: document order reversed applies each cell
        // paragraph's tokens right-to-left; cell edits cannot move any
        // Pos-anchored collection.
        for m in matches.iter().rev() {
            let Some((row, col, cbi)) = m.cell else {
                continue;
            };
            let repl = record.get(&m.name).cloned().unwrap_or_default();
            let table_block = &mut staged.blocks[m.block];
            let table = table_block
                .table
                .as_mut()
                .expect("cell match implies a table block");
            let cols = table.cols;
            let b = &mut table.cells[row * cols + col].blocks[cbi];
            let style = style_at(b, m.start + 1);
            let (head, _mid, tail) = split3(&b.inlines, m.start, m.end);
            let mut inlines = head;
            if !repl.is_empty() {
                inlines.push(Inline { text: repl, style });
            }
            inlines.extend(tail);
            b.inlines = normalize_inlines(inlines);
        }

        // Re-anchor every Pos collection through the per-block replacement
        // spans. Each span carries its own replacement length since
        // different fields merge to different values. Bookmark/footnote
        // right gravity, comment `from` left / `to` right, revision
        // gravity per kind — identical rules to replaceText.
        if !staged.bookmarks.is_empty()
            || !staged.comments.is_empty()
            || !staged.revisions.is_empty()
            || !staged.footnotes.is_empty()
            || !staged.citations.is_empty()
        {
            let mut i = 0;
            while i < top.len() {
                let bi = top[i].block;
                let mut j = i;
                let mut span: Vec<(usize, usize, usize)> = Vec::new();
                while j < top.len() && top[j].block == bi {
                    let m = top[j];
                    let repl_len = record.get(&m.name).map_or(0, |v| v.chars().count());
                    span.push((m.start, m.end, repl_len));
                    j += 1;
                }
                span.sort_by(|a, b| a.0.cmp(&b.0));
                for bm in staged.bookmarks.iter_mut().filter(|b| b.block == bi) {
                    bm.offset = remap_offset_through_spans(bm.offset, &span, false);
                }
                for c in staged.comments.iter_mut() {
                    if c.from.block == bi {
                        c.from.offset = remap_offset_through_spans(c.from.offset, &span, true);
                    }
                    if c.to.block == bi {
                        c.to.offset = remap_offset_through_spans(c.to.offset, &span, false);
                    }
                }
                for r in staged.revisions.iter_mut() {
                    let fl = matches!(r.kind, RevisionKind::Ins);
                    if r.from.block == bi {
                        r.from.offset = remap_offset_through_spans(r.from.offset, &span, fl);
                    }
                    if r.to.block == bi {
                        r.to.offset = remap_offset_through_spans(r.to.offset, &span, false);
                    }
                }
                for f in staged.footnotes.iter_mut() {
                    if f.at.block == bi {
                        f.at.offset = remap_offset_through_spans(f.at.offset, &span, false);
                    }
                }
                for c in staged.citations.iter_mut() {
                    if c.at.block == bi {
                        c.at.offset = remap_offset_through_spans(c.at.offset, &span, false);
                    }
                }
                i = j;
            }
        }

        lists::validate(&staged.blocks)?;
        validate_tables(&staged.blocks)?;
        validate_toc(&staged.blocks)?;
        validate_bibliography(&staged.blocks)?;
        // Eventless when every substitution reproduced the token text
        // verbatim (a record value equal to its own `{{name}}` literal).
        if staged.blocks == self.blocks {
            return Ok(Self::read_only(json!({
                "ok": true,
                "replaced": 0,
                "missing": missing,
            })));
        }
        let replaced = matches.len();
        self.bookmarks = staged.bookmarks;
        self.comments = staged.comments;
        self.sections = staged.sections;
        self.revisions = staged.revisions;
        self.footnotes = staged.footnotes;
        self.citations = staged.citations;
        self.sources = staged.sources;
        self.record_undo(
            0,
            self.blocks.clone(),
            staged.blocks.clone(),
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
                footnotes_before,
                citations_before,
            ),
        );
        self.blocks = staged.blocks;
        Ok(CommandResult::data(json!({
            "ok": true,
            "replaced": replaced,
            "missing": missing,
        })))
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

    fn text(e: &mut QuillEngine) -> String {
        apply(e, "text", json!({})).data["text"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn fields(e: &mut QuillEngine) -> Value {
        apply(e, "listMergeFields", json!({})).data
    }

    #[test]
    fn token_grammar_edge_cases() {
        // Literal braces, blanks, unterminated and brace-containing
        // inners are not fields; valid tokens scan left-to-right.
        let tokens = scan_merge_tokens("a {{name}} b {{ first name }} c");
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].name, "name");
        assert_eq!(tokens[1].name, "first name");
        let literals = [
            "{{}}".to_string(),
            "{{ }}".to_string(),
            "{{".to_string(),
            "{{name".to_string(),
            "{{a{b}}".to_string(),
            "{{a}b}}".to_string(),
            "{{{name}}}".to_string(),
            "{{".to_string() + &"x".repeat(70) + "}}",
        ];
        for literal in &literals {
            assert!(scan_merge_tokens(literal).is_empty(), "{literal}");
        }
        // Adjacent tokens and rescan after an invalid span.
        let tokens = scan_merge_tokens("{{a}}{{b}}");
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].name, "a");
        assert_eq!(tokens[1].name, "b");
        let tokens = scan_merge_tokens("{{bad{inner}}{{ok}}");
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].name, "ok");
    }

    #[test]
    fn list_merge_fields_counts_and_order() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Hi {{name}}, meet {{city}}. Bye {{name}}.");
        insert(&mut e, 0, 41, "\nNext {{city}} and {{name}}.");
        let r = fields(&mut e);
        let arr = r["fields"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        // First-appearance order: name, then city.
        assert_eq!(arr[0]["name"], "name");
        assert_eq!(arr[0]["occurrences"], 3);
        assert_eq!(arr[1]["name"], "city");
        assert_eq!(arr[1]["occurrences"], 2);
        assert_eq!(r["occurrences"], 5);
        // Read-only: no events and no undo entry of its own — only the
        // two setup inserts sit on the journal.
        let r = apply(&mut e, "listMergeFields", json!({}));
        assert!(r.events.is_empty());
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn preview_merge_reports_text_and_missing() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Dear {{name}}, your city is {{city}}.");
        let r = apply(
            &mut e,
            "previewMerge",
            json!({"records":[
                {"name":"Ada","city":"NYC","extra":"ignored"},
                {"name":"Bob"},
            ]}),
        );
        assert!(r.events.is_empty());
        let results = r.data["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0]["text"].as_str().unwrap(),
            "Dear Ada, your city is NYC."
        );
        assert_eq!(results[0]["missing"], json!([]));
        assert_eq!(
            results[1]["text"].as_str().unwrap(),
            "Dear Bob, your city is ."
        );
        assert_eq!(results[1]["missing"], json!(["city"]));
        assert_eq!(r.data["occurrences"], 2);
        // Record grammar validation.
        assert!(err(
            &mut e,
            "previewMerge",
            json!({"records":[{"name":"x","city":7}]})
        )
        .message
        .contains("must be a string"));
        assert!(err(
            &mut e,
            "previewMerge",
            json!({"records":[{"bad key ":"x"}]})
        )
        .message
        .contains("valid merge field name"));
        assert!(err(&mut e, "previewMerge", json!({"records":"x"}))
            .message
            .contains("must be an array"));
        assert!(err(&mut e, "previewMerge", json!({}))
            .message
            .contains("missing 'records'"));
        assert!(
            err(&mut e, "previewMerge", json!({"records":[{"name":"a\nb"}]}))
                .message
                .contains("newlines")
        );
    }

    #[test]
    fn run_merge_substitutes_and_undoes() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Hello {{name}}, you live in {{city}}.");
        let r = apply(
            &mut e,
            "runMerge",
            json!({"record":{"name":"Ada","city":"Oslo"}}),
        );
        assert_eq!(r.data["replaced"], 2);
        assert_eq!(r.data["missing"], json!([]));
        assert_eq!(text(&mut e), "Hello Ada, you live in Oslo.");
        // One undo restores the template.
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "Hello {{name}}, you live in {{city}}.");
        assert!(e.redo().unwrap());
        assert_eq!(text(&mut e), "Hello Ada, you live in Oslo.");
    }

    #[test]
    fn run_merge_missing_and_extra_fields() {
        let mut e = engine();
        insert(&mut e, 0, 0, "{{a}}-{{b}}");
        let r = apply(&mut e, "runMerge", json!({"record":{"a":"1","unused":"z"}}));
        assert_eq!(r.data["replaced"], 2);
        assert_eq!(r.data["missing"], json!(["b"]));
        assert_eq!(text(&mut e), "1-");
    }

    #[test]
    fn run_merge_range_and_eventless() {
        let mut e = engine();
        insert(&mut e, 0, 0, "{{a}} one\n{{a}} two\n{{a}} three");
        // Range covering only the second block.
        let r = apply(
            &mut e,
            "runMerge",
            json!({
                "record":{"a":"X"},
                "from":{"block":1,"offset":0},
                "to":{"block":1,"offset":7},
            }),
        );
        assert_eq!(r.data["replaced"], 1);
        assert_eq!(text(&mut e), "{{a}} one\nX two\n{{a}} three");
        // No tokens in range → eventless.
        let r = apply(
            &mut e,
            "runMerge",
            json!({
                "record":{"a":"Y"},
                "from":{"block":0,"offset":0},
                "to":{"block":0,"offset":4},
            }),
        );
        assert!(r.events.is_empty());
        assert_eq!(r.data["replaced"], 0);
        // Bad ranges reject and leave the document untouched.
        let before = text(&mut e);
        assert!(err(
            &mut e,
            "runMerge",
            json!({"record":{"a":"Y"},"from":{"block":9,"offset":0}})
        )
        .message
        .contains("out of range"));
        assert!(err(
            &mut e,
            "runMerge",
            json!({"record":{"a":"Y"},"from":{"block":2,"offset":0},"to":{"block":1,"offset":0}})
        )
        .message
        .contains("precedes"));
        assert_eq!(text(&mut e), before);
        // Missing record rejects.
        assert!(err(&mut e, "runMerge", json!({}))
            .message
            .contains("missing 'record'"));
    }

    #[test]
    fn run_merge_preserves_styles_and_anchors() {
        let mut e = engine();
        insert(&mut e, 0, 0, "pre {{name}} post");
        apply(
            &mut e,
            "applyStyle",
            json!({"from":{"block":0,"offset":4},"to":{"block":0,"offset":12},"style":{"bold":true}}),
        );
        apply(
            &mut e,
            "addBookmark",
            json!({"name":"bm","pos":{"block":0,"offset":14}}),
        );
        apply(
            &mut e,
            "addComment",
            json!({"id":"c1","from":{"block":0,"offset":14},"to":{"block":0,"offset":17},"body":"note"}),
        );
        apply(&mut e, "runMerge", json!({"record":{"name":"A"}}));
        assert_eq!(text(&mut e), "pre A post");
        // Bookmark/comment anchors remapped through the shorter value
        // (delta -7: the 8-char token became 1 char).
        let bms = apply(&mut e, "listBookmarks", json!({})).data;
        assert_eq!(bms["bookmarks"][0]["pos"]["offset"], 7);
        let cs = apply(&mut e, "listComments", json!({})).data;
        assert_eq!(cs["comments"][0]["from"]["offset"], 7);
        assert_eq!(cs["comments"][0]["to"]["offset"], 10);
        // The replacement kept the token's bold style.
        let blocks = apply(&mut e, "blocks", json!({})).data;
        let inls = blocks["blocks"][0]["inlines"].as_array().unwrap();
        let bold = inls
            .iter()
            .find(|i| i["text"].as_str() == Some("A"))
            .expect("merged inline");
        assert_eq!(bold["style"]["bold"], true);
        // Undo restores text, bookmark and comment anchors.
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "pre {{name}} post");
        let bms = apply(&mut e, "listBookmarks", json!({})).data;
        assert_eq!(bms["bookmarks"][0]["pos"]["offset"], 14);
    }

    #[test]
    fn run_merge_covers_table_cells() {
        let mut e = engine();
        insert(&mut e, 0, 0, "before");
        apply(&mut e, "insertTable", json!({"index":1,"rows":1,"cols":2}));
        apply(
            &mut e,
            "setCellText",
            json!({"block":1,"row":0,"col":0,"text":"{{name}}"}),
        );
        apply(
            &mut e,
            "setCellText",
            json!({"block":1,"row":0,"col":1,"text":"{{city}}"}),
        );
        // Range covering the table block merges cell text.
        let r = apply(
            &mut e,
            "runMerge",
            json!({"record":{"name":"Ada","city":"Oslo"}}),
        );
        assert_eq!(r.data["replaced"], 2);
        let t = apply(&mut e, "describeTable", json!({"block":1})).data;
        assert_eq!(t["cells"], json!([["Ada", "Oslo"]]));
        // Collapsed-on-table range covers nothing.
        let r = apply(
            &mut e,
            "runMerge",
            json!({"record":{"name":"X"},"from":{"block":1,"offset":0},"to":{"block":1,"offset":0}}),
        );
        assert!(r.events.is_empty());
        assert_eq!(r.data["replaced"], 0);
    }

    #[test]
    fn preview_and_run_merge_in_cells_and_multi_block() {
        let mut e = engine();
        insert(&mut e, 0, 0, "one {{a}}");
        insert(&mut e, 0, 9, "\ntwo {{b}}");
        let r = apply(
            &mut e,
            "previewMerge",
            json!({"records":[{"a":"1","b":"2"}]}),
        );
        assert_eq!(r.data["results"][0]["text"], "one 1\ntwo 2");
    }
}
