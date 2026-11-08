//! quill-engine — rich-text document engine for Nitro-Forge (Quill).
//!
//! Document model: an ordered list of blocks; each block carries a kind and a
//! list of inline runs. Positions are `{block, offset}` where `offset` is a
//! char index into the block's concatenated inline text. Ranges are
//! `{from, to}` with `to` exclusive. See `docs/ENGINE_OPS.md` for the
//! authoritative op contract.

#![forbid(unsafe_code)]

mod docx;
mod lists;
mod numbering;
use lists::ListItem;
mod change_case;
mod comments;
use comments::{validate_comments, Comment};
mod footnotes;
use footnotes::{validate_footnotes, Footnote};
mod citations;
use citations::{
    validate_bibliography, validate_citations, validate_sources, BibliographyField, Citation,
    CitationSource,
};
mod merge;
mod toc;
use toc::{validate_toc, TocField};
mod revisions;
use revisions::{validate_revisions, Revision, RevisionKind, TrackChanges};
mod sections;
use sections::{default_sections, is_default_sections, validate_sections, Section};
mod tables;
use tables::{validate_tables, Table};
mod format;
use format::{
    style_has_paragraph_props, style_paragraph_patch, validate_format, ParagraphFormat,
    ParagraphFormatPatch,
};
mod fonts;
use fonts::{FontInfo, FontRegistry};

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal, TaskContext,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const JOURNAL_CAPACITY: usize = 64;
/// Fallback page aspect ratio (ISO A-series) when `layout.page_height` absent.
const A_SERIES_RATIO: f64 = 1.4142;
/// Estimated glyph advance as a fraction of the effective font size.
const GLYPH_EM: f64 = 0.5;
/// Line height as a multiple of the effective font size.
const LINE_SPACING: f64 = 1.4;

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlockKind {
    #[serde(rename = "para")]
    Para,
    #[serde(rename = "h1")]
    H1,
    #[serde(rename = "h2")]
    H2,
    #[serde(rename = "h3")]
    H3,
    #[serde(rename = "list")]
    List,
    #[serde(rename = "quote")]
    Quote,
    /// A table block: `inlines` stays empty and `Block::table` carries the
    /// grid. Deliberately absent from `BlockKind::parse`, so `setBlockKind`
    /// and `insertBlock` cannot create tables — only `insertTable` does.
    /// Pre-table readers fail closed on the unknown serde variant, which is
    /// why tables need no snapshot schema bump.
    #[serde(rename = "table")]
    Table,
    /// A table-of-contents field block: `inlines` stays empty and
    /// `Block::toc` carries `{from_level,to_level,entries}`. Deliberately
    /// absent from `BlockKind::parse`, so `setBlockKind`/`insertBlock`
    /// cannot create toc fields — only `insertToc` does (and
    /// `setBlockKind` can convert one back to a text kind, dropping the
    /// payload). Same fail-closed serde-variant precedent as `"table"`:
    /// pre-toc readers reject the unknown variant, so no schema bump.
    #[serde(rename = "toc")]
    Toc,
    /// A bibliography field block: `inlines` stays empty and
    /// `Block::bibliography` carries `{sort,entries}` — a cached scan of
    /// the cited `sources`. Same fail-closed serde-variant precedent as
    /// `"table"`/`"toc"`: pre-bibliography readers reject the unknown
    /// variant, so no schema bump; only `insertBibliography` creates one
    /// (`setBlockKind` can convert it back to a text kind, dropping the
    /// payload).
    #[serde(rename = "bibliography")]
    Bibliography,
}

impl BlockKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "para" => Some(Self::Para),
            "h1" => Some(Self::H1),
            "h2" => Some(Self::H2),
            "h3" => Some(Self::H3),
            "list" => Some(Self::List),
            "quote" => Some(Self::Quote),
            _ => None,
        }
    }

    /// Multiplier applied to the layout font size for this block kind.
    fn font_mult(self) -> f64 {
        match self {
            Self::H1 => 1.4,
            Self::H2 => 1.25,
            Self::H3 => 1.1,
            _ => 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Style {
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub strike: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Inline {
    pub text: String,
    #[serde(default)]
    pub style: Style,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Block {
    pub kind: BlockKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<ListItem>,
    /// Named paragraph-style reference (`styles[].id` where `kind` is
    /// `"paragraph"`). `None` for unstyled blocks; absent from legacy
    /// snapshots, which restore as unstyled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
    #[serde(default)]
    pub inlines: Vec<Inline>,
    /// Table payload, present exactly when `kind == BlockKind::Table`
    /// (enforced by `tables::validate_tables` on restore and by op guards).
    /// Cell blocks are reachable only through table ops, never through `Pos`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<Table>,
    /// TOC field payload, present exactly when `kind == BlockKind::Toc`
    /// (enforced by `toc::validate_toc` on restore and by op guards).
    /// Entries are a cached scan snapshot — `listToc` is the live read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toc: Option<TocField>,
    /// Bibliography field payload, present exactly when
    /// `kind == BlockKind::Bibliography` (enforced by
    /// `citations::validate_bibliography` on restore and by op guards).
    /// Entries are a cached scan snapshot — `listBibliography` is the
    /// live read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bibliography: Option<BibliographyField>,
    /// Paragraph-level formatting (alignment, indents, tab stops — P12
    /// slice 9). `Block` has no `deny_unknown_fields`, so old readers
    /// silently ignore this field: any snapshot carrying it emits the
    /// `schema:4` wrapper, which schema≤3 readers reject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ParagraphFormat>,
}

impl Block {
    fn empty(kind: BlockKind) -> Self {
        Self {
            kind,
            list: None,
            style_id: None,
            inlines: Vec::new(),
            table: None,
            toc: None,
            bibliography: None,
            format: None,
        }
    }
}

/// A named zero-width mark at a `{block, offset}` position (Unicode scalar
/// offsets, same unit as `Pos`). Bookmarks have right gravity: a mark stays
/// attached to the character after it, so text inserted exactly at a bookmark
/// lands before the mark. `remap_bookmarks_*` defines the per-op rules.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Bookmark {
    name: String,
    block: usize,
    offset: usize,
}

#[derive(Serialize)]
struct SnapshotRef<'a> {
    blocks: &'a [Block],
}

/// schema:3 document payload: legacy blocks plus the bookmark and named
/// style collections. `styles` is omitted when empty so bookmark-only
/// schema:3 snapshots stay byte-identical to the bookmark-era shape.
#[derive(Serialize)]
struct Schema3DocSnapshotRef<'a> {
    blocks: &'a [Block],
    bookmarks: &'a [Bookmark],
    #[serde(skip_serializing_if = "<[StyleDef]>::is_empty")]
    styles: &'a [StyleDef],
    /// Omitted for the single default section so bookmark/style-only
    /// schema:3 payloads stay byte-identical; schema:3 already gates
    /// pre-feature readers, so no schema:4 bump is needed. `comments` is
    /// omitted when empty for the same reason — a schema:3-era reader's
    /// `deny_unknown_fields` document state fails closed on the key.
    #[serde(skip_serializing_if = "is_default_sections")]
    sections: &'a [Section],
    #[serde(skip_serializing_if = "<[Comment]>::is_empty")]
    comments: &'a [Comment],
    /// Omitted when empty for the same reason as `comments`; `revisions`,
    /// `tracking` and `footnotes` ride the schema:3 `deny_unknown_fields`
    /// document, so schema:3-era readers fail closed on any of those keys —
    /// no schema bump.
    #[serde(skip_serializing_if = "<[Revision]>::is_empty")]
    revisions: &'a [Revision],
    #[serde(skip_serializing_if = "Option::is_none")]
    tracking: &'a Option<TrackChanges>,
    #[serde(skip_serializing_if = "<[Footnote]>::is_empty")]
    footnotes: &'a [Footnote],
    /// Omitted when empty for the same reason as `footnotes`;
    /// `citations`/`sources` ride the schema:3 `deny_unknown_fields`
    /// document, so schema:3-era readers fail closed on those keys — no
    /// schema bump.
    #[serde(skip_serializing_if = "<[Citation]>::is_empty")]
    citations: &'a [Citation],
    #[serde(skip_serializing_if = "<[CitationSource]>::is_empty")]
    sources: &'a [CitationSource],
}

#[derive(Serialize)]
struct Schema3SnapshotRef<'a> {
    kind: &'static str,
    schema: u32,
    document: Schema3DocSnapshotRef<'a>,
}

#[derive(Deserialize)]
struct DocState {
    blocks: Vec<Block>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Schema3DocState {
    blocks: Vec<Block>,
    // `bookmarks` stays required (schema:3 was born with it); `styles` is
    // optional so bookmark-era schema:3 snapshots still restore. `sections`
    // is optional for the same reason — absent means the single default
    // section; an explicit empty list fails validation rather than
    // silently meaning "no sections".
    bookmarks: Vec<Bookmark>,
    #[serde(default)]
    styles: Vec<StyleDef>,
    #[serde(default)]
    sections: Option<Vec<Section>>,
    // `comments` is optional like `styles`/`sections`: absent means no
    // comments, and the key only appears in payloads emitted by readers
    // that understand it (schema:3-era readers fail closed on it).
    #[serde(default)]
    comments: Vec<Comment>,
    // `revisions`/`tracking`/`footnotes`/`citations`/`sources` are
    // optional for the same reason: absent means none.
    #[serde(default)]
    revisions: Vec<Revision>,
    #[serde(default)]
    tracking: Option<TrackChanges>,
    #[serde(default)]
    footnotes: Vec<Footnote>,
    #[serde(default)]
    citations: Vec<Citation>,
    #[serde(default)]
    sources: Vec<CitationSource>,
}

#[derive(Serialize)]
struct ListSnapshotRef<'a> {
    kind: &'static str,
    schema: u32,
    document: SnapshotRef<'a>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrappedDocState {
    kind: String,
    schema: u32,
    document: Value,
}

// ---------------------------------------------------------------------------
// Positions & undo
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Pos {
    block: usize,
    offset: usize,
}

impl Pos {
    fn le(self, other: Pos) -> bool {
        (self.block, self.offset) <= (other.block, other.offset)
    }
}

/// Splice-based undo entry: replaces `inserted` blocks at `index` with
/// `removed` on undo, and the reverse on redo. For structural ops `index` is 0
/// and both vectors hold the entire prior/next block list.
struct UndoEntry {
    index: usize,
    removed: Vec<Block>,
    inserted: Vec<Block>,
    /// `(before, after)` bookmark lists for ops that can move bookmarks;
    /// `None` for ops that cannot (style/kind/list-metadata edits), whose
    /// undo/redo leaves the live bookmark list untouched.
    bookmarks: Option<(Vec<Bookmark>, Vec<Bookmark>)>,
    /// `(before, after)` named-style definition lists for style ops; `None`
    /// leaves the live style list untouched on undo/redo.
    styles: Option<(Vec<StyleDef>, Vec<StyleDef>)>,
    /// `(before, after)` section lists for ops that can move or edit
    /// section boundaries/settings; `None` leaves the live section list
    /// untouched on undo/redo.
    sections: Option<(Vec<Section>, Vec<Section>)>,
    /// `(before, after)` comment lists for ops that can move anchors or
    /// edit comments; `None` leaves the live comment list untouched.
    comments: Option<(Vec<Comment>, Vec<Comment>)>,
    /// `(before, after)` revision lists for ops that can move anchors,
    /// record revisions, or resolve them; `None` leaves the live revision
    /// list untouched.
    revisions: Option<(Vec<Revision>, Vec<Revision>)>,
    /// `(before, after)` track-changes settings for `setTrackChanges`;
    /// `None` leaves the live setting untouched.
    tracking: Option<(Option<TrackChanges>, Option<TrackChanges>)>,
    /// `(before, after)` footnote/endnote lists for ops that can move
    /// anchors or edit notes; `None` leaves the live list untouched.
    footnotes: Option<(Vec<Footnote>, Vec<Footnote>)>,
    /// `(before, after)` citation lists for ops that can move anchors or
    /// edit citations; `None` leaves the live list untouched.
    citations: Option<(Vec<Citation>, Vec<Citation>)>,
    /// `(before, after)` bibliography-source lists for source ops (and
    /// the removeSource citation cascade); `None` leaves it untouched.
    sources: Option<(Vec<CitationSource>, Vec<CitationSource>)>,
}

/// Before-images for the document-level collections an op can move or
/// replace. A `None` field leaves that collection untouched on undo/redo.
#[derive(Default)]
struct Collections {
    bookmarks: Option<Vec<Bookmark>>,
    comments: Option<Vec<Comment>>,
    styles: Option<Vec<StyleDef>>,
    sections: Option<Vec<Section>>,
    revisions: Option<Vec<Revision>>,
    /// Before-image of the track-changes setting (`None` inside means
    /// tracking was disabled); outer `None` leaves it untouched.
    tracking: Option<Option<TrackChanges>>,
    /// Before-image of the footnote/endnote list; outer `None` leaves it
    /// untouched.
    footnotes: Option<Vec<Footnote>>,
    /// Before-image of the citation list; outer `None` leaves it
    /// untouched.
    citations: Option<Vec<Citation>>,
    /// Before-image of the bibliography-source list; outer `None` leaves
    /// it untouched.
    sources: Option<Vec<CitationSource>>,
}

impl Collections {
    /// Bookmark, comment, section, revision, footnote, and citation
    /// lists move together through every block-count-changing or
    /// position-moving op. Sources never move with block edits.
    fn anchors(
        bookmarks: Vec<Bookmark>,
        comments: Vec<Comment>,
        sections: Vec<Section>,
        revisions: Vec<Revision>,
        footnotes: Vec<Footnote>,
        citations: Vec<Citation>,
    ) -> Self {
        Self {
            bookmarks: Some(bookmarks),
            comments: Some(comments),
            sections: Some(sections),
            revisions: Some(revisions),
            footnotes: Some(footnotes),
            citations: Some(citations),
            ..Default::default()
        }
    }

    fn bookmarks(bookmarks: Vec<Bookmark>) -> Self {
        Self {
            bookmarks: Some(bookmarks),
            ..Default::default()
        }
    }

    fn comments(comments: Vec<Comment>) -> Self {
        Self {
            comments: Some(comments),
            ..Default::default()
        }
    }

    fn styles(styles: Vec<StyleDef>) -> Self {
        Self {
            styles: Some(styles),
            ..Default::default()
        }
    }

    fn sections(sections: Vec<Section>) -> Self {
        Self {
            sections: Some(sections),
            ..Default::default()
        }
    }

    fn footnotes(footnotes: Vec<Footnote>) -> Self {
        Self {
            footnotes: Some(footnotes),
            ..Default::default()
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn all(
        bookmarks: Vec<Bookmark>,
        comments: Vec<Comment>,
        styles: Vec<StyleDef>,
        sections: Vec<Section>,
        revisions: Vec<Revision>,
        tracking: Option<TrackChanges>,
        footnotes: Vec<Footnote>,
        citations: Vec<Citation>,
        sources: Vec<CitationSource>,
    ) -> Self {
        Self {
            bookmarks: Some(bookmarks),
            comments: Some(comments),
            styles: Some(styles),
            sections: Some(sections),
            revisions: Some(revisions),
            tracking: Some(tracking),
            footnotes: Some(footnotes),
            citations: Some(citations),
            sources: Some(sources),
        }
    }
}

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

fn block_len(b: &Block) -> usize {
    b.inlines.iter().map(|i| i.text.chars().count()).sum()
}

fn block_text(b: &Block) -> String {
    b.inlines.iter().map(|i| i.text.as_str()).collect()
}

fn block_text_slice(b: &Block, start: usize, end: usize) -> String {
    b.inlines
        .iter()
        .flat_map(|i| i.text.chars())
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

/// Plain text of one block for the `text`/`layout` reads. Table blocks
/// serialize their cell grid via `tables::table_text` (rows `'\n'`-joined,
/// cells `'\t'`-separated); every other block concatenates its inline
/// text. `layout` line spans and the joined `text` output index this
/// serialization — for a table they address the serialized cell text,
/// never a `Pos` offset (a table block's only valid `Pos` offset is 0).
fn block_content_text(b: &Block) -> String {
    match &b.table {
        Some(t) => tables::table_text(t),
        None => block_text(b),
    }
}

fn split_str_at_char(s: &str, idx: usize) -> (String, String) {
    match s.char_indices().nth(idx) {
        Some((byte, _)) => (s[..byte].to_string(), s[byte..].to_string()),
        None => (s.to_string(), String::new()),
    }
}

/// Split a run list at a char offset into (head, tail); the inline containing
/// the boundary is split in two, both halves keeping their style.
fn split_inlines(inlines: &[Inline], offset: usize) -> (Vec<Inline>, Vec<Inline>) {
    let mut head = Vec::new();
    let mut tail = Vec::new();
    let mut pos = 0usize;
    for inl in inlines {
        let n = inl.text.chars().count();
        if pos + n <= offset {
            head.push(inl.clone());
        } else if pos >= offset {
            tail.push(inl.clone());
        } else {
            let (a, b) = split_str_at_char(&inl.text, offset - pos);
            if !a.is_empty() {
                head.push(Inline {
                    text: a,
                    style: inl.style.clone(),
                });
            }
            if !b.is_empty() {
                tail.push(Inline {
                    text: b,
                    style: inl.style.clone(),
                });
            }
        }
        pos += n;
    }
    (head, tail)
}

/// Split into (head, middle, tail) at char offsets `s` and `e` (s <= e).
fn split3(inlines: &[Inline], s: usize, e: usize) -> (Vec<Inline>, Vec<Inline>, Vec<Inline>) {
    let (head, rest) = split_inlines(inlines, s);
    let (mid, tail) = split_inlines(&rest, e - s);
    (head, mid, tail)
}

/// Drop empty runs and merge adjacent runs with identical style.
fn normalize_inlines(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut out: Vec<Inline> = Vec::new();
    for inl in inlines {
        if inl.text.is_empty() {
            continue;
        }
        if let Some(last) = out.last_mut() {
            if last.style == inl.style {
                last.text.push_str(&inl.text);
                continue;
            }
        }
        out.push(inl);
    }
    out
}

/// Style of the char to the left of `offset` (offset>0), else of the char to
/// the right (offset==0), else default for an empty block.
fn style_at(b: &Block, offset: usize) -> Style {
    if block_len(b) == 0 {
        return Style::default();
    }
    let target = if offset == 0 { 0 } else { offset - 1 };
    let mut pos = 0usize;
    for inl in &b.inlines {
        let n = inl.text.chars().count();
        if target < pos + n {
            return inl.style.clone();
        }
        pos += n;
    }
    b.inlines
        .last()
        .map(|i| i.style.clone())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

/// Bookmark names are 1..=64 non-blank Unicode scalars without control
/// characters; names are unique per document (exact, case-sensitive match).
const BOOKMARK_NAME_MAX: usize = 64;
/// Bound on stored bookmarks so snapshots stay small.
const BOOKMARKS_MAX: usize = 1024;

fn validate_bookmark_name(name: &str) -> Result<(), EngineError> {
    if name.trim().is_empty() {
        return Err(EngineError::validation("bookmark name must not be blank"));
    }
    if name.chars().count() > BOOKMARK_NAME_MAX {
        return Err(EngineError::validation(format!(
            "bookmark name must be at most {BOOKMARK_NAME_MAX} characters"
        )));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(EngineError::validation(
            "bookmark name must not contain control characters",
        ));
    }
    Ok(())
}

/// Full bookmark validation for restore: names, uniqueness, bounds against
/// the final block list. Runs before live state is replaced.
fn validate_bookmarks(bookmarks: &[Bookmark], blocks: &[Block]) -> Result<(), EngineError> {
    if bookmarks.len() > BOOKMARKS_MAX {
        return Err(EngineError::validation("too many bookmarks"));
    }
    let mut seen = std::collections::HashSet::with_capacity(bookmarks.len());
    for bm in bookmarks {
        validate_bookmark_name(&bm.name)?;
        if !seen.insert(bm.name.as_str()) {
            return Err(EngineError::validation(format!(
                "duplicate bookmark name '{}'",
                bm.name
            )));
        }
        let Some(b) = blocks.get(bm.block) else {
            return Err(EngineError::out_of_bounds(format!(
                "bookmark '{}' block {} out of range ({} blocks)",
                bm.name,
                bm.block,
                blocks.len()
            )));
        };
        if bm.offset > block_len(b) {
            return Err(EngineError::out_of_bounds(format!(
                "bookmark '{}' offset {} out of range (block {} has {} chars)",
                bm.name,
                bm.offset,
                bm.block,
                block_len(b)
            )));
        }
    }
    Ok(())
}

/// `pos` is the documented payload key; `at`/`anchor` are accepted aliases.
fn bookmark_pos(p: &Value) -> Result<Pos, EngineError> {
    for key in ["pos", "at", "anchor"] {
        if let Some(v) = p.get(key) {
            return parse_pos(v);
        }
    }
    Err(EngineError::invalid("payload missing 'pos'"))
}

/// New offset for a right-gravity mark after each `(start,end)` match in
/// `matches` (ascending, non-overlapping scalar spans) is replaced by `repl`
/// chars. A mark at or inside a match's span lands just after the
/// replacement, matching delete-then-insert composition.
fn remap_offset_through_matches(offset: usize, matches: &[(usize, usize)], repl: usize) -> usize {
    let mut delta = 0isize;
    for &(s, e) in matches {
        if offset < s {
            break;
        }
        let ns = s as isize + delta;
        if offset < e {
            return (ns + repl as isize) as usize;
        }
        delta += repl as isize - (e - s) as isize;
    }
    (offset as isize + delta) as usize
}

/// Gravity-aware variant of `remap_offset_through_matches` for comment
/// anchors in `replaceText`. `left` (the `from` endpoint) keeps an offset
/// exactly at a match start *before* the replacement so the replacement
/// text lands inside the range; `right` (the `to` endpoint) matches
/// bookmark behavior. Offsets strictly inside a match land after the
/// replacement for both gravities.
fn remap_comment_offset(
    offset: usize,
    matches: &[(usize, usize)],
    repl: usize,
    left: bool,
) -> usize {
    let mut delta = 0isize;
    for &(s, e) in matches {
        if offset < s {
            break;
        }
        let ns = s as isize + delta;
        if offset < e {
            if left && offset == s {
                return ns as usize;
            }
            return (ns + repl as isize) as usize;
        }
        delta += repl as isize - (e - s) as isize;
    }
    (offset as isize + delta) as usize
}

// ---------------------------------------------------------------------------
// Named styles
// ---------------------------------------------------------------------------
//
// A named style is a durable document-level definition
// `{id, name, kind, properties}` where `kind` is `"paragraph"` or
// `"character"` and `properties` is a partial inline-style object using the
// exact `applyStyle` grammar (including null-clears). Styles are snapshot
// bundles, not live formatting: applying one copies its properties at that
// moment, and later `updateStyle`/`removeStyle` calls never rewrite content
// that was already styled. Paragraph styles additionally leave a
// `style_id` reference on the block for consumers (and future DOCX pStyle
// mapping); character styles leave no reference — only the copied inline
// properties.

/// Style ids and names share the bookmark bounds: 1..=64 non-blank
/// non-control Unicode scalars.
const STYLE_NAME_MAX: usize = 64;
/// Bound on stored style definitions so snapshots stay small.
const STYLES_MAX: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum NamedStyleKind {
    Paragraph,
    Character,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StyleDef {
    id: String,
    name: String,
    kind: NamedStyleKind,
    /// Validated partial style object (same grammar as `applyStyle`'s
    /// `style` payload). Stored verbatim and revalidated on every use and
    /// on restore, so a hostile snapshot cannot smuggle invalid properties.
    properties: Value,
}

fn validate_style_token(value: &str, what: &str) -> Result<(), EngineError> {
    if value.trim().is_empty() {
        return Err(EngineError::validation(format!(
            "style {what} must not be blank"
        )));
    }
    if value.chars().count() > STYLE_NAME_MAX {
        return Err(EngineError::validation(format!(
            "style {what} must be at most {STYLE_NAME_MAX} characters"
        )));
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(EngineError::validation(format!(
            "style {what} must not contain control characters"
        )));
    }
    Ok(())
}

/// Top-level blocks plus every table-cell block. Cell blocks cannot nest
/// tables (`tables::validate_tables` rejects them), so depth is one.
fn all_blocks(blocks: &[Block]) -> impl Iterator<Item = &Block> {
    blocks.iter().flat_map(|b| {
        std::iter::once(b).chain(
            b.table
                .iter()
                .flat_map(|t| t.cells.iter().flat_map(|c| c.blocks.iter())),
        )
    })
}

/// Full style validation for restore: ids, names, property grammar, and
/// every `Block::style_id` reference (must name a paragraph style). Runs
/// before live state is replaced.
fn validate_styles(styles: &[StyleDef], blocks: &[Block]) -> Result<(), EngineError> {
    if styles.len() > STYLES_MAX {
        return Err(EngineError::validation("too many styles"));
    }
    let mut seen = std::collections::HashSet::with_capacity(styles.len());
    for def in styles {
        validate_style_token(&def.id, "id")?;
        validate_style_token(&def.name, "name")?;
        if !seen.insert(def.id.as_str()) {
            return Err(EngineError::validation(format!(
                "duplicate style id '{}'",
                def.id
            )));
        }
        // Rejects non-object properties and out-of-range style fields.
        StylePatch::parse(&def.properties)?;
        // `properties.paragraph` is the paragraph-format patch grammar
        // (P12 slice 9); it is only meaningful on paragraph-kind styles.
        // Parsing validates the grammar and bounds; the result is not
        // stored — style defs keep `properties` verbatim.
        if def.kind == NamedStyleKind::Character && style_has_paragraph_props(&def.properties) {
            return Err(EngineError::validation(
                "character styles cannot carry paragraph properties",
            ));
        }
        style_paragraph_patch(&def.properties)?;
    }
    for block in all_blocks(blocks) {
        if let Some(id) = &block.style_id {
            let Some(def) = styles.iter().find(|d| &d.id == id) else {
                return Err(EngineError::validation(format!(
                    "block references unknown style '{id}'"
                )));
            };
            if def.kind != NamedStyleKind::Paragraph {
                return Err(EngineError::validation(format!(
                    "block references character style '{id}'"
                )));
            }
        }
    }
    Ok(())
}

/// `id` is the documented payload key; `style_id`/`style` are accepted
/// aliases for the apply/set ops.
fn style_id_field(p: &Value) -> Result<&str, EngineError> {
    for key in ["style_id", "id", "style"] {
        if let Some(v) = p.get(key) {
            return as_str(v, key);
        }
    }
    Err(EngineError::invalid("payload missing 'style_id'"))
}

// ---------------------------------------------------------------------------
// Find / replace
// ---------------------------------------------------------------------------

/// Parsed `findText`/`replaceText` search parameters. Positions are Unicode
/// scalar offsets; matches never span block boundaries.
struct FindQuery {
    chars: Vec<char>,
    case_sensitive: bool,
    from: Pos,
    to: Pos,
}

fn parse_find_query(p: &Value, blocks: &[Block]) -> Result<FindQuery, EngineError> {
    let query = as_str(field(p, "query")?, "query")?;
    if query.is_empty() {
        return Err(EngineError::validation("query must not be empty"));
    }
    let case_sensitive = match p.get("case_sensitive") {
        Some(v) => v
            .as_bool()
            .ok_or_else(|| EngineError::validation("'case_sensitive' must be a bool"))?,
        None => false,
    };
    let doc_start = Pos {
        block: 0,
        offset: 0,
    };
    let doc_end = blocks.last().map_or(doc_start, |b| Pos {
        block: blocks.len() - 1,
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
    if blocks.is_empty() {
        return Err(EngineError::validation("document has no blocks"));
    }
    // Validate positions against the live block list without an engine.
    for pos in [from, to] {
        let Some(b) = blocks.get(pos.block) else {
            return Err(EngineError::out_of_bounds(format!(
                "block {} out of range ({} blocks)",
                pos.block,
                blocks.len()
            )));
        };
        let len = block_len(b);
        if pos.offset > len {
            return Err(EngineError::out_of_bounds(format!(
                "offset {} out of range (block {} has {} chars)",
                pos.offset, pos.block, len
            )));
        }
    }
    if !from.le(to) {
        return Err(EngineError::validation("range end precedes range start"));
    }
    Ok(FindQuery {
        chars: query.chars().collect(),
        case_sensitive,
        from,
        to,
    })
}

/// Per-scalar case-insensitive equality using default Unicode lowercase
/// mappings. A scalar whose lowercase expands to multiple scalars never
/// equals a single other scalar, keeping offsets unambiguous.
fn scalar_eq(a: char, b: char, ignore_case: bool) -> bool {
    if ignore_case {
        a.to_lowercase().eq(b.to_lowercase())
    } else {
        a == b
    }
}

/// Non-overlapping matches of `q` inside `hay[s..e]`; returns (start,end)
/// scalar offsets, `end` exclusive.
fn find_in_chars(
    hay: &[char],
    s: usize,
    e: usize,
    q: &[char],
    ignore_case: bool,
) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    if q.is_empty() || e.saturating_sub(s) < q.len() {
        return out;
    }
    let mut i = s;
    while i + q.len() <= e {
        let mut j = 0;
        while j < q.len() && scalar_eq(hay[i + j], q[j], ignore_case) {
            j += 1;
        }
        if j == q.len() {
            out.push((i, i + q.len()));
            i += q.len();
        } else {
            i += 1;
        }
    }
    out
}

/// One search match. `cell` is `Some((row, col, cell_block))` when the
/// match lives inside a table cell's paragraph block — `block` is then
/// the table block's index and `start`/`end` are scalar offsets within
/// that cell paragraph. Like top-level matches, cell matches never span
/// a block boundary: not a cell paragraph, not a cell, not the table.
#[derive(Clone, Copy)]
struct TextMatch {
    block: usize,
    cell: Option<(usize, usize, usize)>,
    start: usize,
    end: usize,
}

/// All non-overlapping matches across `blocks` within the query range.
/// Returns matches in document order (a table's cell matches appear at
/// the table block's position, row-major). Top-level matches are
/// `(block, start, end)` scalar offsets confined to a single block; cell
/// matches carry their `(row, col, cell_block)` qualifiers.
fn find_matches(blocks: &[Block], q: &FindQuery) -> Vec<TextMatch> {
    let mut out = Vec::new();
    let ignore_case = !q.case_sensitive;
    for (bi, b) in blocks
        .iter()
        .enumerate()
        .take(q.to.block + 1)
        .skip(q.from.block)
    {
        if let Some(table) = &b.table {
            // A table block's only valid Pos is {bi,0}, so there is no
            // intra-table clipping: the cell grid is searched whole when
            // the range covers the block index — the same inclusive
            // block coverage `deleteRange` applies to its `to` endpoint.
            // A range collapsed on the table itself ({bi,0}..{bi,0})
            // covers nothing, matching empty-range behavior elsewhere.
            if q.from.block == bi && q.to.block == bi {
                continue;
            }
            for r in 0..table.rows {
                for c in 0..table.cols {
                    let cell = &table.cells[r * table.cols + c];
                    for (cbi, cb) in cell.blocks.iter().enumerate() {
                        let hay: Vec<char> = block_text(cb).chars().collect();
                        for (ms, me) in find_in_chars(&hay, 0, hay.len(), &q.chars, ignore_case) {
                            out.push(TextMatch {
                                block: bi,
                                cell: Some((r, c, cbi)),
                                start: ms,
                                end: me,
                            });
                        }
                    }
                }
            }
            continue;
        }
        let s = if bi == q.from.block { q.from.offset } else { 0 };
        let e = if bi == q.to.block {
            q.to.offset
        } else {
            block_len(b)
        };
        if e <= s {
            continue;
        }
        let hay: Vec<char> = block_text(b).chars().collect();
        for (ms, me) in find_in_chars(&hay, s, e, &q.chars, ignore_case) {
            out.push(TextMatch {
                block: bi,
                cell: None,
                start: ms,
                end: me,
            });
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

fn field<'a>(p: &'a Value, key: &str) -> Result<&'a Value, EngineError> {
    p.get(key)
        .ok_or_else(|| EngineError::invalid(format!("payload missing '{key}'")))
}

fn as_usize(v: &Value, name: &str) -> Result<usize, EngineError> {
    if let Some(u) = v.as_u64() {
        return Ok(u as usize);
    }
    if let Some(f) = v.as_f64() {
        if f >= 0.0 && f.fract() == 0.0 {
            return Ok(f as usize);
        }
    }
    Err(EngineError::invalid(format!(
        "'{name}' must be a non-negative integer"
    )))
}

fn as_f64(v: &Value, name: &str) -> Result<f64, EngineError> {
    v.as_f64()
        .ok_or_else(|| EngineError::invalid(format!("'{name}' must be a number")))
}

fn as_str<'a>(v: &'a Value, name: &str) -> Result<&'a str, EngineError> {
    v.as_str()
        .ok_or_else(|| EngineError::invalid(format!("'{name}' must be a string")))
}

fn parse_pos(v: &Value) -> Result<Pos, EngineError> {
    Ok(Pos {
        block: as_usize(field(v, "block")?, "block")?,
        offset: as_usize(field(v, "offset")?, "offset")?,
    })
}

fn parse_kind(v: &Value) -> Result<BlockKind, EngineError> {
    let s = as_str(v, "kind")?;
    BlockKind::parse(s).ok_or_else(|| EngineError::validation(format!("unknown block kind '{s}'")))
}

fn validate_highlight(value: &str) -> Result<(), EngineError> {
    if value.len() != 7
        || !value.starts_with('#')
        || !value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        return Err(EngineError::validation(
            "highlight must be an exact #RRGGBB color",
        ));
    }
    Ok(())
}

fn validate_font_size(value: f64) -> Result<(), EngineError> {
    if !value.is_finite() || !(1.0..=1638.0).contains(&value) || (value * 2.0).fract() != 0.0 {
        return Err(EngineError::validation(
            "font_size must be 1..1638 points in half-point increments",
        ));
    }
    Ok(())
}

fn validate_font_family(value: &str) -> Result<(), EngineError> {
    if value.trim().is_empty()
        || value.chars().count() > 128
        || value
            .chars()
            .any(|c| c.is_control() || c == '\u{fffe}' || c == '\u{ffff}')
    {
        return Err(EngineError::validation(
            "font_family must contain 1..128 non-control characters and cannot be blank",
        ));
    }
    Ok(())
}

/// A partial style: only fields present in the `applyStyle` payload mutate.
#[derive(Default)]
struct StylePatch {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    color: Option<Option<String>>,
    highlight: Option<Option<String>>,
    font_family: Option<Option<String>>,
    font_size: Option<Option<f64>>,
    link: Option<Option<String>>,
}

impl StylePatch {
    fn parse(v: &Value) -> Result<Self, EngineError> {
        let obj = v
            .as_object()
            .ok_or_else(|| EngineError::invalid("'style' must be an object"))?;
        let mut p = StylePatch::default();
        let flag = |name: &str, slot: &mut Option<bool>| -> Result<(), EngineError> {
            if let Some(val) = obj.get(name) {
                *slot =
                    Some(val.as_bool().ok_or_else(|| {
                        EngineError::invalid(format!("style.{name} must be a bool"))
                    })?);
            }
            Ok(())
        };
        flag("bold", &mut p.bold)?;
        flag("italic", &mut p.italic)?;
        flag("underline", &mut p.underline)?;
        flag("strike", &mut p.strike)?;
        let opt_str = |name: &str, slot: &mut Option<Option<String>>| -> Result<(), EngineError> {
            if let Some(val) = obj.get(name) {
                if val.is_null() {
                    *slot = Some(None);
                } else if let Some(s) = val.as_str() {
                    *slot = Some(Some(s.to_string()));
                } else {
                    return Err(EngineError::invalid(format!(
                        "style.{name} must be a string or null"
                    )));
                }
            }
            Ok(())
        };
        opt_str("color", &mut p.color)?;
        opt_str("highlight", &mut p.highlight)?;
        if let Some(Some(value)) = &p.highlight {
            validate_highlight(value)?;
        }
        opt_str("link", &mut p.link)?;
        opt_str("font_family", &mut p.font_family)?;
        if let Some(Some(family)) = &p.font_family {
            validate_font_family(family)?;
        }
        if let Some(size) = obj.get("font_size") {
            p.font_size = Some(if size.is_null() {
                None
            } else {
                let value = size.as_f64().ok_or_else(|| {
                    EngineError::invalid("style.font_size must be a number or null")
                })?;
                validate_font_size(value)?;
                Some(value)
            });
        }
        Ok(p)
    }

    fn is_empty(&self) -> bool {
        self.bold.is_none()
            && self.italic.is_none()
            && self.underline.is_none()
            && self.strike.is_none()
            && self.color.is_none()
            && self.highlight.is_none()
            && self.link.is_none()
            && self.font_family.is_none()
            && self.font_size.is_none()
    }

    fn apply(&self, s: &mut Style) {
        if let Some(v) = self.bold {
            s.bold = v;
        }
        if let Some(v) = self.italic {
            s.italic = v;
        }
        if let Some(v) = self.underline {
            s.underline = v;
        }
        if let Some(v) = self.strike {
            s.strike = v;
        }
        if let Some(v) = &self.highlight {
            s.highlight = v.clone();
        }
        if let Some(v) = &self.color {
            s.color = v.clone();
        }
        if let Some(v) = self.font_size {
            s.font_size = v;
        }
        if let Some(v) = &self.font_family {
            s.font_family = v.clone();
        }
        if let Some(v) = &self.link {
            s.link = v.clone();
        }
    }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

pub struct QuillEngine {
    blocks: Vec<Block>,
    bookmarks: Vec<Bookmark>,
    comments: Vec<Comment>,
    styles: Vec<StyleDef>,
    sections: Vec<Section>,
    revisions: Vec<Revision>,
    /// `Some` while track changes is enabled; carries the default author
    /// stamped on auto-recorded revisions.
    tracking: Option<TrackChanges>,
    /// Footnotes/endnotes anchored to live `{block,offset}` positions.
    footnotes: Vec<Footnote>,
    /// In-text citations anchored to live `{block,offset}` positions and
    /// naming `sources` ids.
    citations: Vec<Citation>,
    /// Bibliography source records; bibliography field entries are caches
    /// scanned from these plus `citations`.
    sources: Vec<CitationSource>,
    /// Session font table (`registerFont`/`removeFont`/`listFonts` and the
    /// `layout` `font` parameter). Deliberately NOT document state: bytes
    /// never enter snapshots, the journal, or `new`/`restore` — see
    /// `fonts.rs` module docs and the decision record.
    fonts: FontRegistry,
    journal: Journal<UndoEntry>,
}

impl QuillEngine {
    pub fn new() -> Self {
        Self {
            blocks: vec![Block::empty(BlockKind::Para)],
            bookmarks: Vec::new(),
            comments: Vec::new(),
            styles: Vec::new(),
            sections: default_sections(),
            revisions: Vec::new(),
            tracking: None,
            footnotes: Vec::new(),
            citations: Vec::new(),
            sources: Vec::new(),
            fonts: FontRegistry::default(),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    /// Record one undo entry. `before` carries the live before-images of the
    /// document-level collections the op can move or replace; a `None`
    /// field leaves that collection untouched on undo/redo.
    fn record_undo(
        &mut self,
        index: usize,
        removed: Vec<Block>,
        inserted: Vec<Block>,
        before: Collections,
    ) {
        let bookmarks = before
            .bookmarks
            .map(|before| (before, self.bookmarks.clone()));
        let comments = before
            .comments
            .map(|before| (before, self.comments.clone()));
        let styles = before.styles.map(|before| (before, self.styles.clone()));
        let sections = before
            .sections
            .map(|before| (before, self.sections.clone()));
        let revisions = before
            .revisions
            .map(|before| (before, self.revisions.clone()));
        let tracking = before
            .tracking
            .map(|before| (before, self.tracking.clone()));
        let footnotes = before
            .footnotes
            .map(|before| (before, self.footnotes.clone()));
        let citations = before
            .citations
            .map(|before| (before, self.citations.clone()));
        let sources = before.sources.map(|before| (before, self.sources.clone()));
        self.journal.record(UndoEntry {
            index,
            removed,
            inserted,
            bookmarks,
            comments,
            styles,
            sections,
            revisions,
            tracking,
            footnotes,
            citations,
            sources,
        });
    }

    fn check_pos(&self, p: Pos) -> Result<(), EngineError> {
        let Some(b) = self.blocks.get(p.block) else {
            return Err(EngineError::out_of_bounds(format!(
                "block {} out of range ({} blocks)",
                p.block,
                self.blocks.len()
            )));
        };
        let len = block_len(b);
        if p.offset > len {
            return Err(EngineError::out_of_bounds(format!(
                "offset {} out of range (block {} has {} chars)",
                p.offset, p.block, len
            )));
        }
        Ok(())
    }

    fn check_range(&self, from: Pos, to: Pos) -> Result<(), EngineError> {
        self.check_pos(from)?;
        self.check_pos(to)?;
        if !from.le(to) {
            return Err(EngineError::validation("range end precedes range start"));
        }
        Ok(())
    }

    fn read_only(data: Value) -> CommandResult {
        CommandResult {
            events: Vec::new(),
            data,
            output: None,
        }
    }

    // -- ops --------------------------------------------------------------

    fn op_new(&mut self) -> Result<CommandResult, EngineError> {
        let old = std::mem::replace(&mut self.blocks, vec![Block::empty(BlockKind::Para)]);
        let bookmarks_before = std::mem::take(&mut self.bookmarks);
        let comments_before = std::mem::take(&mut self.comments);
        let styles_before = std::mem::take(&mut self.styles);
        let sections_before = std::mem::replace(&mut self.sections, default_sections());
        let revisions_before = std::mem::take(&mut self.revisions);
        let tracking_before = std::mem::take(&mut self.tracking);
        let footnotes_before = std::mem::take(&mut self.footnotes);
        let citations_before = std::mem::take(&mut self.citations);
        let sources_before = std::mem::take(&mut self.sources);
        self.record_undo(
            0,
            old,
            self.blocks.clone(),
            Collections::all(
                bookmarks_before,
                comments_before,
                styles_before,
                sections_before,
                revisions_before,
                tracking_before,
                footnotes_before,
                citations_before,
                sources_before,
            ),
        );
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_describe(&self) -> Result<CommandResult, EngineError> {
        Ok(Self::read_only(serde_json::to_value(SnapshotRef {
            blocks: &self.blocks,
        })?))
    }

    fn validate_list_splice(
        &self,
        index: usize,
        count: usize,
        inserted: &[Block],
    ) -> Result<(), EngineError> {
        let mut next = self.blocks.clone();
        next.splice(index..index + count, inserted.iter().cloned());
        lists::validate(&next)?;
        // Splices preserve kind/payload pairs by construction, but the
        // candidate still goes through the same field-block gates restore
        // uses.
        validate_toc(&next)?;
        validate_bibliography(&next)
    }
    fn op_insert_text(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let at = parse_pos(field(p, "at")?)?;
        let text = as_str(field(p, "text")?, "text")?.to_string();
        self.check_pos(at)?;
        if self.blocks[at.block].kind == BlockKind::Table {
            return Err(EngineError::validation(
                "cannot insert text into a table block; use setCellText",
            ));
        }
        if self.blocks[at.block].kind == BlockKind::Toc {
            return Err(EngineError::validation(
                "cannot insert text into a toc field block",
            ));
        }
        if self.blocks[at.block].kind == BlockKind::Bibliography {
            return Err(EngineError::validation(
                "cannot insert text into a bibliography field block",
            ));
        }
        if text.is_empty() {
            return Ok(CommandResult::data(json!({ "ok": true })));
        }
        // Validate revision attribution before mutating so a bad `author`/
        // `time` rejects the whole op.
        let attr = self.revision_attr(p)?;

        let old = self.blocks[at.block].clone();
        let (mut head, tail) = split_inlines(&old.inlines, at.offset);
        let style = style_at(&old, at.offset);
        let kind = old.kind;

        // '\n' splits the block; the tail inlines land in the last new block.
        let mut out: Vec<Block> = Vec::new();
        for (i, seg) in text.split('\n').enumerate() {
            if i > 0 {
                out.push(Block {
                    kind,
                    list: old.list.clone(),
                    style_id: old.style_id.clone(),
                    inlines: normalize_inlines(std::mem::take(&mut head)),
                    table: None,
                    toc: None,
                    bibliography: None,
                    format: old.format.clone(),
                });
            }
            if !seg.is_empty() {
                head.push(Inline {
                    text: seg.to_string(),
                    style: style.clone(),
                });
            }
        }
        head.extend(tail);
        out.push(Block {
            kind,
            list: old.list.clone(),
            style_id: old.style_id.clone(),
            inlines: normalize_inlines(head),
            table: None,
            toc: None,
            bibliography: None,
            format: old.format.clone(),
        });

        let inserted = out.clone();
        self.validate_list_splice(at.block, 1, &out)?;
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        let revisions_before = self.revisions.clone();
        let footnotes_before = self.footnotes.clone();
        let citations_before = self.citations.clone();
        self.blocks.splice(at.block..at.block + 1, out);
        self.remap_bookmarks_insert_text(at, &text);
        self.remap_comments_insert_text(at, &text);
        self.remap_sections_insert_text(at, &text);
        self.remap_revisions_insert_text(at, &text);
        self.remap_footnotes_insert_text(at, &text);
        self.remap_citations_insert_text(at, &text);
        self.remap_toc_insert_text(at, &text);
        // The inserted range ends after the final segment: with `\n`s the
        // last segment lands in block `at.block + added` at `last_len`,
        // otherwise the insert is `plain` chars past `at`.
        let added = text.bytes().filter(|&b| b == b'\n').count();
        let last_len = text.rsplit('\n').next().map_or(0, |s| s.chars().count());
        let to = if added == 0 {
            Pos {
                block: at.block,
                offset: at.offset + text.chars().count(),
            }
        } else {
            Pos {
                block: at.block + added,
                offset: last_len,
            }
        };
        self.track_revision(RevisionKind::Ins, at, to, None, &attr);
        self.record_undo(
            at.block,
            vec![old],
            inserted,
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
                footnotes_before,
                citations_before,
            ),
        );
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_delete_range(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        self.check_range(from, to)?;
        if from == to {
            return Ok(CommandResult::data(json!({ "deleted_text": "" })));
        }
        // A range starting on a table block would merge the surviving tail
        // into a table-kind block with no payload; cell content is only
        // reachable through table ops. Ranges that merely cover a table
        // (start on a normal block) delete it like any covered block.
        // A toc field block rejects as a range start for the same reason —
        // merging survivors into a toc-kind block would put text on a
        // payload block; covering ranges still delete the field.
        if self.blocks[from.block].kind == BlockKind::Table {
            return Err(EngineError::validation(
                "cannot deleteRange from a table block; use deleteTable",
            ));
        }
        if self.blocks[from.block].kind == BlockKind::Toc {
            return Err(EngineError::validation(
                "cannot deleteRange from a toc field block",
            ));
        }
        if self.blocks[from.block].kind == BlockKind::Bibliography {
            return Err(EngineError::validation(
                "cannot deleteRange from a bibliography field block",
            ));
        }
        let attr = self.revision_attr(p)?;

        let removed: Vec<Block> = self.blocks[from.block..=to.block].to_vec();
        let deleted_text;
        let new_span: Vec<Block>;

        if from.block == to.block {
            let b = &self.blocks[from.block];
            deleted_text = block_text_slice(b, from.offset, to.offset);
            let (head, _mid, tail) = split3(&b.inlines, from.offset, to.offset);
            let mut inlines = head;
            inlines.extend(tail);
            new_span = vec![Block {
                kind: b.kind,
                list: b.list.clone(),
                style_id: b.style_id.clone(),
                inlines: normalize_inlines(inlines),
                table: b.table.clone(),
                toc: b.toc.clone(),
                bibliography: b.bibliography.clone(),
                format: b.format.clone(),
            }];
        } else {
            let first = &self.blocks[from.block];
            let last = &self.blocks[to.block];
            let (head, _) = split_inlines(&first.inlines, from.offset);
            let (_, tail) = split_inlines(&last.inlines, to.offset);

            let mut parts = vec![block_text_slice(first, from.offset, block_len(first))];
            for b in &self.blocks[from.block + 1..to.block] {
                parts.push(block_text(b));
            }
            parts.push(block_text_slice(last, 0, to.offset));
            deleted_text = parts.join("\n");

            let mut inlines = head;
            inlines.extend(tail);
            // The surviving head/tail merge into a single block keeping the
            // kind of the block where the range started.
            new_span = vec![Block {
                kind: first.kind,
                list: first.list.clone(),
                style_id: first.style_id.clone(),
                inlines: normalize_inlines(inlines),
                table: first.table.clone(),
                toc: first.toc.clone(),
                bibliography: first.bibliography.clone(),
                format: first.format.clone(),
            }];
        }

        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        let revisions_before = self.revisions.clone();
        let footnotes_before = self.footnotes.clone();
        let citations_before = self.citations.clone();
        self.blocks
            .splice(from.block..=to.block, new_span.iter().cloned());
        self.remap_bookmarks_delete(from, to);
        self.remap_comments_delete(from, to);
        self.remap_sections_delete(from, to);
        self.remap_revisions_delete(from, to);
        self.remap_footnotes_delete(from, to);
        self.remap_citations_delete(from, to);
        self.remap_toc_delete(from, to);
        // The deletion collapses to its start; the deleted plain text is
        // stored on the record so `rejectRevision` can restore it.
        let point = Pos {
            block: from.block,
            offset: from.offset,
        };
        self.track_revision(
            RevisionKind::Del,
            point,
            point,
            Some(deleted_text.clone()),
            &attr,
        );
        self.record_undo(
            from.block,
            removed,
            new_span,
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
                footnotes_before,
                citations_before,
            ),
        );
        Ok(CommandResult::data(json!({ "deleted_text": deleted_text })))
    }

    /// Replace `from..to` with `text` as one command and one undo entry, so a
    /// selection replace never leaves the deletion applied without the insert.
    fn op_replace_range(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        let text = as_str(field(p, "text")?, "text")?.to_owned();
        self.check_range(from, to)?;
        // Attribution is validated up front; the staged ops re-validate it
        // through their own payloads before mutating the stage.
        let _attr = self.revision_attr(p)?;
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
        let mut deleted = String::new();
        if from != to {
            deleted = staged.op_delete_range(p)?.data["deleted_text"]
                .as_str()
                .unwrap_or_default()
                .into();
        }
        if !text.is_empty() {
            // Forward author/time so the staged insert records the same
            // attribution the delete did.
            let mut payload = json!({"at":{"block":from.block,"offset":from.offset},"text":text});
            if let Some(v) = p.get("author") {
                payload["author"] = v.clone();
            }
            if let Some(v) = p.get("time") {
                payload["time"] = v.clone();
            }
            staged.op_insert_text(&payload)?;
        }
        lists::validate(&staged.blocks)?;
        // Defense-in-depth: the staged candidate goes through the same
        // table/field gates restore uses, matching replaceText.
        validate_tables(&staged.blocks)?;
        validate_toc(&staged.blocks)?;
        validate_bibliography(&staged.blocks)?;
        let data = json!({"deleted_text":deleted});
        if staged.blocks == self.blocks && staged.revisions == self.revisions {
            return Ok(Self::read_only(data));
        }
        self.bookmarks = staged.bookmarks;
        self.comments = staged.comments;
        self.styles = staged.styles;
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
        Ok(CommandResult::data(data))
    }

    /// `(removed, new_span)` for applying `patch` over `from..to` without
    /// mutating. Shared by `applyStyle` and `applyNamedStyle`.
    fn style_span(&self, from: Pos, to: Pos, patch: &StylePatch) -> (Vec<Block>, Vec<Block>) {
        let removed: Vec<Block> = self.blocks[from.block..=to.block].to_vec();
        let mut new_span: Vec<Block> = Vec::with_capacity(removed.len());
        for (i, b) in self.blocks[from.block..=to.block].iter().enumerate() {
            let bi = from.block + i;
            let s = if bi == from.block { from.offset } else { 0 };
            let e = if bi == to.block {
                to.offset
            } else {
                block_len(b)
            };
            if s == e {
                new_span.push(b.clone());
                continue;
            }
            let (head, mid, tail) = split3(&b.inlines, s, e);
            let mut inlines = head;
            for mut inl in mid {
                patch.apply(&mut inl.style);
                inlines.push(inl);
            }
            inlines.extend(tail);
            new_span.push(Block {
                kind: b.kind,
                list: b.list.clone(),
                style_id: b.style_id.clone(),
                inlines: normalize_inlines(inlines),
                table: b.table.clone(),
                toc: b.toc.clone(),
                bibliography: b.bibliography.clone(),
                format: b.format.clone(),
            });
        }
        (removed, new_span)
    }

    fn op_apply_style(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        let patch = StylePatch::parse(field(p, "style")?)?;
        self.check_range(from, to)?;
        if from == to || patch.is_empty() {
            return Ok(CommandResult::data(json!({ "ok": true })));
        }
        let (removed, new_span) = self.style_span(from, to, &patch);
        self.blocks
            .splice(from.block..=to.block, new_span.iter().cloned());
        self.record_undo(from.block, removed, new_span, Collections::default());
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_set_block_kind(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = as_usize(field(p, "block")?, "block")?;
        let kind = parse_kind(field(p, "kind")?)?;
        let Some(b) = self.blocks.get(index) else {
            return Err(EngineError::out_of_bounds(format!(
                "block {index} out of range"
            )));
        };
        if b.kind == BlockKind::Table {
            return Err(EngineError::validation(
                "cannot change a table block's kind; use deleteTable",
            ));
        }
        if b.kind == kind {
            return Ok(CommandResult::data(json!({ "ok": true })));
        }
        let old = b.clone();
        let mut new = old.clone();
        new.kind = kind;
        // Leaving `toc`/`bibliography` drops the field payload
        // (kind⇔payload invariant); entering is impossible — `parse`
        // never yields those kinds.
        new.toc = None;
        new.bibliography = None;
        if kind != BlockKind::List {
            new.list = None;
        }
        self.validate_list_splice(index, 1, std::slice::from_ref(&new))?;
        self.blocks[index] = new.clone();
        self.record_undo(index, vec![old], vec![new], Collections::default());
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_insert_block(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = as_usize(field(p, "index")?, "index")?;
        let kind = match p.get("kind") {
            Some(v) => parse_kind(v)?,
            None => BlockKind::Para,
        };
        if index > self.blocks.len() {
            return Err(EngineError::out_of_bounds(format!(
                "index {index} out of range ({} blocks)",
                self.blocks.len()
            )));
        }
        let old = self.blocks.clone();
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        let revisions_before = self.revisions.clone();
        let footnotes_before = self.footnotes.clone();
        let citations_before = self.citations.clone();
        let mut next = old.clone();
        next.insert(index, Block::empty(kind));
        lists::validate(&next)?;
        self.blocks = next;
        self.remap_bookmarks_insert_block(index);
        self.remap_comments_insert_block(index);
        self.remap_sections_insert_block(index);
        self.remap_revisions_insert_block(index);
        self.remap_footnotes_insert_block(index);
        self.remap_citations_insert_block(index);
        self.remap_toc_insert_block(index);
        self.record_undo(
            0,
            old,
            self.blocks.clone(),
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
                footnotes_before,
                citations_before,
            ),
        );
        Ok(CommandResult::data(json!({ "block_index": index })))
    }

    fn op_split_block(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let at = parse_pos(field(p, "at")?)?;
        self.check_pos(at)?;
        if self.blocks[at.block].kind == BlockKind::Table {
            return Err(EngineError::validation("cannot split a table block"));
        }
        if self.blocks[at.block].kind == BlockKind::Toc {
            return Err(EngineError::validation("cannot split a toc field block"));
        }
        if self.blocks[at.block].kind == BlockKind::Bibliography {
            return Err(EngineError::validation(
                "cannot split a bibliography field block",
            ));
        }
        let old = self.blocks[at.block].clone();
        let (head, tail) = split_inlines(&old.inlines, at.offset);
        let new_span = vec![
            Block {
                kind: old.kind,
                list: old.list.clone(),
                style_id: old.style_id.clone(),
                inlines: normalize_inlines(head),
                table: old.table.clone(),
                toc: old.toc.clone(),
                bibliography: old.bibliography.clone(),
                format: old.format.clone(),
            },
            Block {
                kind: old.kind,
                list: old.list.clone(),
                style_id: old.style_id.clone(),
                inlines: normalize_inlines(tail),
                table: old.table.clone(),
                toc: old.toc.clone(),
                bibliography: old.bibliography.clone(),
                format: old.format.clone(),
            },
        ];
        self.validate_list_splice(at.block, 1, &new_span)?;
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        let revisions_before = self.revisions.clone();
        let footnotes_before = self.footnotes.clone();
        let citations_before = self.citations.clone();
        self.blocks
            .splice(at.block..at.block + 1, new_span.iter().cloned());
        self.remap_bookmarks_split(at);
        self.remap_comments_split(at);
        self.remap_sections_split(at);
        self.remap_revisions_split(at);
        self.remap_footnotes_split(at);
        self.remap_citations_split(at);
        self.remap_toc_split(at);
        self.record_undo(
            at.block,
            vec![old],
            new_span,
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
                footnotes_before,
                citations_before,
            ),
        );
        Ok(CommandResult::data(
            json!({ "new_block_index": at.block + 1 }),
        ))
    }

    fn op_merge_block(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = as_usize(field(p, "index")?, "index")?;
        if index >= self.blocks.len() {
            return Err(EngineError::out_of_bounds(format!(
                "index {index} out of range ({} blocks)",
                self.blocks.len()
            )));
        }
        if index == 0 {
            return Err(EngineError::validation(
                "block 0 has no previous block to merge into",
            ));
        }
        if self.blocks[index - 1].kind == BlockKind::Table
            || self.blocks[index].kind == BlockKind::Table
        {
            return Err(EngineError::validation(
                "cannot merge a table block; use deleteTable",
            ));
        }
        // A toc/bibliography field cannot merge: the survivor would either
        // keep field kind with text inlines (payload invariant) or
        // silently drop the field. Convert via setBlockKind or delete via
        // a covering range.
        if self.blocks[index - 1].kind == BlockKind::Toc
            || self.blocks[index].kind == BlockKind::Toc
        {
            return Err(EngineError::validation("cannot merge a toc field block"));
        }
        if self.blocks[index - 1].kind == BlockKind::Bibliography
            || self.blocks[index].kind == BlockKind::Bibliography
        {
            return Err(EngineError::validation(
                "cannot merge a bibliography field block",
            ));
        }
        let removed: Vec<Block> = self.blocks[index - 1..=index].to_vec();
        let head_len = block_len(&self.blocks[index - 1]);
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        let revisions_before = self.revisions.clone();
        let footnotes_before = self.footnotes.clone();
        let citations_before = self.citations.clone();
        let mut inlines = self.blocks[index - 1].inlines.clone();
        inlines.extend(self.blocks[index].inlines.iter().cloned());
        let merged = vec![Block {
            kind: self.blocks[index - 1].kind,
            list: self.blocks[index - 1].list.clone(),
            style_id: self.blocks[index - 1].style_id.clone(),
            inlines: normalize_inlines(inlines),
            table: self.blocks[index - 1].table.clone(),
            toc: self.blocks[index - 1].toc.clone(),
            bibliography: self.blocks[index - 1].bibliography.clone(),
            format: self.blocks[index - 1].format.clone(),
        }];
        self.blocks
            .splice(index - 1..=index, merged.iter().cloned());
        self.remap_bookmarks_merge(index, head_len);
        self.remap_comments_merge(index, head_len);
        self.remap_sections_merge(index);
        self.remap_revisions_merge(index, head_len);
        self.remap_footnotes_merge(index, head_len);
        self.remap_citations_merge(index, head_len);
        self.remap_toc_merge(index);
        self.record_undo(
            index - 1,
            removed,
            merged,
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
                footnotes_before,
                citations_before,
            ),
        );
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_text(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let (from, to) = match (p.get("from"), p.get("to")) {
            (None, None) => (None, None),
            (fv, tv) => {
                let from = match fv {
                    Some(v) => parse_pos(v)?,
                    None => Pos {
                        block: 0,
                        offset: 0,
                    },
                };
                let to = match tv {
                    Some(v) => parse_pos(v)?,
                    None => {
                        let last = self.blocks.len() - 1;
                        Pos {
                            block: last,
                            offset: block_len(&self.blocks[last]),
                        }
                    }
                };
                self.check_range(from, to)?;
                (Some(from), Some(to))
            }
        };

        let text = match (from, to) {
            (None, None) => self
                .blocks
                .iter()
                .map(block_content_text)
                .collect::<Vec<_>>()
                .join("\n"),
            (Some(from), Some(to)) if from.block == to.block => {
                block_text_slice(&self.blocks[from.block], from.offset, to.offset)
            }
            (Some(from), Some(to)) => {
                let first = &self.blocks[from.block];
                let last = &self.blocks[to.block];
                // A covered table block has no Pos-reachable offsets (its
                // only valid position is offset 0), so it contributes its
                // full cell serialization — the same text the unbounded
                // `text` read reports for it.
                let mut parts = vec![if first.kind == BlockKind::Table {
                    block_content_text(first)
                } else {
                    block_text_slice(first, from.offset, block_len(first))
                }];
                for b in &self.blocks[from.block + 1..to.block] {
                    parts.push(block_content_text(b));
                }
                parts.push(if last.kind == BlockKind::Table {
                    block_content_text(last)
                } else {
                    block_text_slice(last, 0, to.offset)
                });
                parts.join("\n")
            }
            _ => unreachable!(),
        };
        Ok(Self::read_only(json!({ "text": text })))
    }

    /// `findText {query, from?, to?, case_sensitive?}` — read-only search.
    /// Top-level matches are per-block, non-overlapping, and reported as
    /// `{from:Pos,to:Pos,text}` with scalar offsets in `matches`/`count`
    /// (unchanged shape). Matches inside table cells cannot be expressed
    /// as `Pos` — a table block's only valid position is offset 0 — so
    /// they are reported separately in `cell_matches`/`cell_count` as
    /// `{from,to,text}` where each endpoint is a cell-qualified position
    /// `{block,row,col,cell_block,offset}`: `block` is the table block's
    /// index, `row`/`col` the grid cell, `cell_block` the paragraph index
    /// within the cell, and `offset` the scalar offset inside it. Cell
    /// matches obey the same range rule as `deleteRange` block coverage:
    /// a table's cells are searched iff the query's block range includes
    /// the table's index and is not collapsed on it.
    fn op_find_text(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let q = parse_find_query(p, &self.blocks)?;
        let matches = find_matches(&self.blocks, &q);
        let mut top: Vec<Value> = Vec::new();
        let mut cell: Vec<Value> = Vec::new();
        for m in &matches {
            match m.cell {
                None => top.push(json!({
                    "from": {"block": m.block, "offset": m.start},
                    "to": {"block": m.block, "offset": m.end},
                    "text": block_text_slice(&self.blocks[m.block], m.start, m.end),
                })),
                Some((row, col, cbi)) => {
                    let table = self.blocks[m.block]
                        .table
                        .as_ref()
                        .expect("cell match implies a table block");
                    let b = &table.cells[row * table.cols + col].blocks[cbi];
                    let pos = |offset: usize| {
                        json!({
                            "block": m.block,
                            "row": row,
                            "col": col,
                            "cell_block": cbi,
                            "offset": offset,
                        })
                    };
                    cell.push(json!({
                        "from": pos(m.start),
                        "to": pos(m.end),
                        "text": block_text_slice(b, m.start, m.end),
                    }));
                }
            }
        }
        let count = top.len();
        let cell_count = cell.len();
        Ok(Self::read_only(json!({
            "matches": top,
            "count": count,
            "cell_matches": cell,
            "cell_count": cell_count,
        })))
    }

    /// `replaceText {query, replacement, from?, to?, case_sensitive?}` —
    /// replace every non-overlapping match in the range as one atomic
    /// command: one journal entry, one `document:changed`, staged validation
    /// before mutation. `replacement` inherits the style of the first matched
    /// scalar; it must not contain newlines (matches never span blocks).
    /// Matches inside table cells rewrite the cell's paragraph inlines in
    /// place — cell text stays strict `para` blocks, the document-wide
    /// cell-block budget cannot grow (no block is added or removed), and
    /// merge-covered cells are canonical empty paragraphs so they can
    /// never match. Zero matches or an unchanged document is eventless;
    /// `replaced` counts applied edits including in-cell ones.
    fn op_replace_text(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let replacement = as_str(field(p, "replacement")?, "replacement")?;
        if replacement.contains('\n') || replacement.contains('\r') {
            return Err(EngineError::validation(
                "replacement must not contain newlines; matches never span blocks",
            ));
        }
        let q = parse_find_query(p, &self.blocks)?;
        let matches = find_matches(&self.blocks, &q);
        if matches.is_empty() {
            return Ok(Self::read_only(json!({ "replaced": 0 })));
        }
        // Cell matches are applied on the staged clone below; anchor
        // remapping only ever sees top-level matches because cell edits
        // cannot move `Pos`-anchored collections.
        let top: Vec<TextMatch> = matches
            .iter()
            .copied()
            .filter(|m| m.cell.is_none())
            .collect();

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
        // Group consecutive matches by block (find_matches is block-ordered),
        // then apply each block's matches right-to-left so earlier scalar
        // offsets stay valid.
        let mut i = 0;
        while i < top.len() {
            let bi = top[i].block;
            let mut j = i;
            let mut per: Vec<(usize, usize)> = Vec::new();
            while j < top.len() && top[j].block == bi {
                per.push((top[j].start, top[j].end));
                j += 1;
            }
            per.sort_by(|a, b| b.0.cmp(&a.0));
            for (s, e) in per {
                // Style of the first matched scalar: style_at(b, s+1) reads
                // the char at index s.
                let style = style_at(&staged.blocks[bi], s + 1);
                let b = &mut staged.blocks[bi];
                let (head, _mid, tail) = split3(&b.inlines, s, e);
                let mut inlines = head;
                if !replacement.is_empty() {
                    inlines.push(Inline {
                        text: replacement.to_string(),
                        style,
                    });
                }
                inlines.extend(tail);
                b.inlines = normalize_inlines(inlines);
            }
            i = j;
        }

        // In-cell matches: find_matches emits them in (block, row, col,
        // cell_block, start) order, so iterating in reverse applies each
        // cell paragraph's matches right-to-left and earlier offsets in
        // every paragraph stay valid.
        for m in matches.iter().rev() {
            let Some((row, col, cbi)) = m.cell else {
                continue;
            };
            let table_block = &mut staged.blocks[m.block];
            let table = table_block
                .table
                .as_mut()
                .expect("cell match implies a table block");
            let cols = table.cols;
            let b = &mut table.cells[row * cols + col].blocks[cbi];
            // Same style inheritance as top-level: the first matched
            // scalar's style (cell paragraphs are strict `para` blocks,
            // but restore-validated inlines may carry styles).
            let style = style_at(b, m.start + 1);
            let (head, _mid, tail) = split3(&b.inlines, m.start, m.end);
            let mut inlines = head;
            if !replacement.is_empty() {
                inlines.push(Inline {
                    text: replacement.to_string(),
                    style,
                });
            }
            inlines.extend(tail);
            b.inlines = normalize_inlines(inlines);
        }

        // Re-anchor bookmarks through the top-level replacements: a mark
        // at or inside a match's span lands just after the replacement
        // text. Cell matches never appear here — they cannot move a
        // `Pos`-anchored collection.
        if !staged.bookmarks.is_empty() {
            let repl_len = replacement.chars().count();
            let mut i = 0;
            while i < top.len() {
                let bi = top[i].block;
                let mut j = i;
                let mut span: Vec<(usize, usize)> = Vec::new();
                while j < top.len() && top[j].block == bi {
                    span.push((top[j].start, top[j].end));
                    j += 1;
                }
                for bm in staged.bookmarks.iter_mut().filter(|b| b.block == bi) {
                    bm.offset = remap_offset_through_matches(bm.offset, &span, repl_len);
                }
                i = j;
            }
        }

        // Comment endpoints re-anchor through the same per-block match
        // spans. `from` keeps left gravity (a start exactly at a match
        // start stays before the replacement); `to` keeps bookmark
        // right gravity. Endpoints inside a match land after the
        // replacement, same as bookmarks.
        if !staged.comments.is_empty() {
            let repl_len = replacement.chars().count();
            let mut i = 0;
            while i < top.len() {
                let bi = top[i].block;
                let mut j = i;
                let mut span: Vec<(usize, usize)> = Vec::new();
                while j < top.len() && top[j].block == bi {
                    span.push((top[j].start, top[j].end));
                    j += 1;
                }
                for c in staged.comments.iter_mut() {
                    if c.from.block == bi {
                        c.from.offset = remap_comment_offset(c.from.offset, &span, repl_len, true);
                    }
                    if c.to.block == bi {
                        c.to.offset = remap_comment_offset(c.to.offset, &span, repl_len, false);
                    }
                }
                i = j;
            }
        }

        // Revision anchors re-anchor through the same per-block match
        // spans with the same gravity rules as everywhere else: `ins`
        // keeps comment gravity (`from` left, `to` right); collapsed `del`
        // points keep right gravity.
        if !staged.revisions.is_empty() {
            let repl_len = replacement.chars().count();
            let mut i = 0;
            while i < top.len() {
                let bi = top[i].block;
                let mut j = i;
                let mut span: Vec<(usize, usize)> = Vec::new();
                while j < top.len() && top[j].block == bi {
                    span.push((top[j].start, top[j].end));
                    j += 1;
                }
                for r in staged.revisions.iter_mut() {
                    let (fl, tl) = match r.kind {
                        RevisionKind::Ins => (true, false),
                        RevisionKind::Del => (false, false),
                    };
                    if r.from.block == bi {
                        r.from.offset = remap_comment_offset(r.from.offset, &span, repl_len, fl);
                    }
                    if r.to.block == bi {
                        r.to.offset = remap_comment_offset(r.to.offset, &span, repl_len, tl);
                    }
                }
                i = j;
            }
        }

        // Footnote anchors re-anchor through the same per-block match
        // spans with bookmark right gravity (a mark inside or at a match
        // lands just after the replacement).
        if !staged.footnotes.is_empty() {
            let repl_len = replacement.chars().count();
            let mut i = 0;
            while i < top.len() {
                let bi = top[i].block;
                let mut j = i;
                let mut span: Vec<(usize, usize)> = Vec::new();
                while j < top.len() && top[j].block == bi {
                    span.push((top[j].start, top[j].end));
                    j += 1;
                }
                Self::remap_footnotes_replace_block(&mut staged.footnotes, bi, &span, repl_len);
                i = j;
            }
        }

        // Citation anchors re-anchor through the same per-block match
        // spans with bookmark right gravity.
        if !staged.citations.is_empty() {
            let repl_len = replacement.chars().count();
            let mut i = 0;
            while i < top.len() {
                let bi = top[i].block;
                let mut j = i;
                let mut span: Vec<(usize, usize)> = Vec::new();
                while j < top.len() && top[j].block == bi {
                    span.push((top[j].start, top[j].end));
                    j += 1;
                }
                Self::remap_citations_replace_block(&mut staged.citations, bi, &span, repl_len);
                i = j;
            }
        }

        lists::validate(&staged.blocks)?;
        // In-cell edits only rewrite existing cell-paragraph inlines, but
        // the staged candidate still goes through the same table/field
        // gates restore uses, matching every other cell mutation.
        validate_tables(&staged.blocks)?;
        validate_toc(&staged.blocks)?;
        validate_bibliography(&staged.blocks)?;
        // `replaced` counts applied edits: the eventless no-change path
        // (replacement identical to every match) applied nothing.
        if staged.blocks == self.blocks {
            return Ok(Self::read_only(json!({ "replaced": 0 })));
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
        Ok(CommandResult::data(json!({ "replaced": replaced })))
    }

    // -- bookmark ops -------------------------------------------------------

    /// `addBookmark {name, pos}` — `pos`/`at`/`anchor` all accepted. Names
    /// are unique, 1..64 non-blank non-control scalars.
    fn op_add_bookmark(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let name = as_str(field(p, "name")?, "name")?.to_string();
        validate_bookmark_name(&name)?;
        let at = bookmark_pos(p)?;
        self.check_pos(at)?;
        if self.bookmarks.len() >= BOOKMARKS_MAX {
            return Err(EngineError::validation("bookmark limit reached"));
        }
        if self.bookmarks.iter().any(|b| b.name == name) {
            return Err(EngineError::validation(format!(
                "bookmark '{name}' already exists"
            )));
        }
        let before = self.bookmarks.clone();
        self.bookmarks.push(Bookmark {
            name: name.clone(),
            block: at.block,
            offset: at.offset,
        });
        self.record_undo(0, Vec::new(), Vec::new(), Collections::bookmarks(before));
        Ok(CommandResult::data(json!({ "ok": true, "name": name })))
    }

    /// `removeBookmark {name}` or `{pos}` — exactly one selector required;
    /// supplying both rejects rather than silently preferring `name`.
    fn op_remove_bookmark(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let has_pos = ["pos", "at", "anchor"].iter().any(|k| p.get(*k).is_some());
        if p.get("name").is_some() && has_pos {
            return Err(EngineError::validation(
                "removeBookmark takes exactly one selector: 'name' or 'pos'",
            ));
        }
        let index = if p.get("name").is_some() {
            let name = as_str(field(p, "name")?, "name")?;
            self.bookmarks
                .iter()
                .position(|b| b.name == name)
                .ok_or_else(|| EngineError::validation(format!("unknown bookmark '{name}'")))?
        } else {
            let at = bookmark_pos(p)?;
            self.check_pos(at)?;
            self.bookmarks
                .iter()
                .position(|b| b.block == at.block && b.offset == at.offset)
                .ok_or_else(|| EngineError::validation("no bookmark at that position"))?
        };
        let before = self.bookmarks.clone();
        let removed = self.bookmarks.remove(index);
        self.record_undo(0, Vec::new(), Vec::new(), Collections::bookmarks(before));
        Ok(CommandResult::data(
            json!({ "ok": true, "name": removed.name }),
        ))
    }

    /// `listBookmarks` — read-only; sorted by document position then name.
    fn op_list_bookmarks(&self) -> Result<CommandResult, EngineError> {
        let mut sorted: Vec<&Bookmark> = self.bookmarks.iter().collect();
        sorted.sort_by(|a, b| {
            (a.block, a.offset, a.name.as_str()).cmp(&(b.block, b.offset, b.name.as_str()))
        });
        let arr: Vec<Value> = sorted
            .iter()
            .map(|b| {
                json!({
                    "name": b.name,
                    "pos": { "block": b.block, "offset": b.offset },
                })
            })
            .collect();
        Ok(Self::read_only(json!({ "bookmarks": arr })))
    }

    // -- bookmark position remapping -----------------------------------------
    //
    // Bookmarks are right-gravity marks: a mark at `{block, offset}` stays
    // attached to the character after it. Text inserted exactly at a mark
    // lands before the mark. A mark whose following text is deleted clamps
    // to the deletion start; a mark whose whole block is deleted is removed.

    /// `insertText` at `at` inserting `text` (already validated).
    fn remap_bookmarks_insert_text(&mut self, at: Pos, text: &str) {
        if self.bookmarks.is_empty() {
            return;
        }
        let added = text.bytes().filter(|&b| b == b'\n').count();
        if added == 0 {
            let n = text.chars().count();
            for bm in &mut self.bookmarks {
                if bm.block == at.block && bm.offset >= at.offset {
                    bm.offset += n;
                }
            }
            return;
        }
        // The tail of the split block lands in the last new block after the
        // final inserted segment.
        let last_len = text.rsplit('\n').next().map_or(0, |s| s.chars().count());
        for bm in &mut self.bookmarks {
            if bm.block == at.block {
                if bm.offset >= at.offset {
                    bm.block = at.block + added;
                    bm.offset = last_len + (bm.offset - at.offset);
                }
            } else if bm.block > at.block {
                bm.block += added;
            }
        }
    }

    /// `deleteRange` from `from` to `to` (already validated, from != to).
    fn remap_bookmarks_delete(&mut self, from: Pos, to: Pos) {
        if self.bookmarks.is_empty() {
            return;
        }
        let span = to.block - from.block;
        let mut kept = Vec::with_capacity(self.bookmarks.len());
        for mut bm in std::mem::take(&mut self.bookmarks) {
            if bm.block < from.block {
                kept.push(bm);
            } else if bm.block == from.block && from.block == to.block {
                if bm.offset <= from.offset {
                    kept.push(bm);
                } else if bm.offset >= to.offset {
                    bm.offset -= to.offset - from.offset;
                    kept.push(bm);
                } else {
                    bm.offset = from.offset;
                    kept.push(bm);
                }
            } else if bm.block == from.block {
                // Multi-block delete: everything after `from.offset` in the
                // first block is removed; marks there clamp to `from`.
                if bm.offset > from.offset {
                    bm.offset = from.offset;
                }
                kept.push(bm);
            } else if bm.block < to.block {
                // Interior block fully deleted: the bookmark is removed.
            } else if bm.block == to.block {
                bm.block = from.block;
                bm.offset = if bm.offset < to.offset {
                    from.offset
                } else {
                    from.offset + (bm.offset - to.offset)
                };
                kept.push(bm);
            } else {
                bm.block -= span;
                kept.push(bm);
            }
        }
        self.bookmarks = kept;
    }

    /// `splitBlock` at `at`: marks at or after the split point move to the
    /// start of the new tail block (they stay before the same character).
    fn remap_bookmarks_split(&mut self, at: Pos) {
        for bm in &mut self.bookmarks {
            if bm.block == at.block {
                if bm.offset >= at.offset {
                    bm.block += 1;
                    bm.offset -= at.offset;
                }
            } else if bm.block > at.block {
                bm.block += 1;
            }
        }
    }

    /// `mergeBlock` at `index`: `head_len` is the pre-merge length of
    /// `blocks[index - 1]`. Marks in the merged-away block shift by it.
    fn remap_bookmarks_merge(&mut self, index: usize, head_len: usize) {
        for bm in &mut self.bookmarks {
            if bm.block == index {
                bm.block = index - 1;
                bm.offset += head_len;
            } else if bm.block > index {
                bm.block -= 1;
            }
        }
    }

    /// `insertBlock` at `index`: marks at or after it shift one block.
    fn remap_bookmarks_insert_block(&mut self, index: usize) {
        for bm in &mut self.bookmarks {
            if bm.block >= index {
                bm.block += 1;
            }
        }
    }

    // -- named style ops -----------------------------------------------------

    fn find_style(&self, id: &str) -> Option<&StyleDef> {
        self.styles.iter().find(|d| d.id == id)
    }

    /// `defineStyle {id, name, kind, properties}` — `kind` is
    /// `"paragraph"` or `"character"`; `properties` uses the `applyStyle`
    /// grammar. Ids are unique.
    fn op_define_style(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = as_str(field(p, "id")?, "id")?.to_string();
        let name = as_str(field(p, "name")?, "name")?.to_string();
        let kind: NamedStyleKind = serde_json::from_value(field(p, "kind")?.clone())
            .map_err(|_| EngineError::validation("kind must be \"paragraph\" or \"character\""))?;
        let properties = field(p, "properties")?.clone();
        validate_style_token(&id, "id")?;
        validate_style_token(&name, "name")?;
        StylePatch::parse(&properties)?;
        if kind == NamedStyleKind::Character && style_has_paragraph_props(&properties) {
            return Err(EngineError::validation(
                "character styles cannot carry paragraph properties",
            ));
        }
        style_paragraph_patch(&properties)?;
        if self.styles.len() >= STYLES_MAX {
            return Err(EngineError::validation("style limit reached"));
        }
        if self.find_style(&id).is_some() {
            return Err(EngineError::validation(format!(
                "style '{id}' already exists"
            )));
        }
        let before = self.styles.clone();
        self.styles.push(StyleDef {
            id: id.clone(),
            name,
            kind,
            properties,
        });
        self.record_undo(0, Vec::new(), Vec::new(), Collections::styles(before));
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `updateStyle {id, name?, properties?}` — replaces the named fields;
    /// absent fields keep their values. Never propagates to content that
    /// already applied the style.
    fn op_update_style(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = as_str(field(p, "id")?, "id")?;
        let index = self
            .styles
            .iter()
            .position(|d| d.id == id)
            .ok_or_else(|| EngineError::validation(format!("unknown style '{id}'")))?;
        let mut updated = self.styles[index].clone();
        if let Some(v) = p.get("name") {
            updated.name = as_str(v, "name")?.to_string();
            validate_style_token(&updated.name, "name")?;
        }
        if let Some(v) = p.get("properties") {
            StylePatch::parse(v)?;
            if self.styles[index].kind == NamedStyleKind::Character && style_has_paragraph_props(v)
            {
                return Err(EngineError::validation(
                    "character styles cannot carry paragraph properties",
                ));
            }
            style_paragraph_patch(v)?;
            updated.properties = v.clone();
        }
        if p.get("name").is_none() && p.get("properties").is_none() {
            return Ok(Self::read_only(json!({ "ok": true, "id": id })));
        }
        if updated == self.styles[index] {
            return Ok(Self::read_only(json!({ "ok": true, "id": id })));
        }
        let before = self.styles.clone();
        self.styles[index] = updated;
        self.record_undo(0, Vec::new(), Vec::new(), Collections::styles(before));
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `removeStyle {id}` — deletes the definition and clears `style_id`
    /// references on blocks that used it, atomically in one undo entry.
    /// Properties already copied onto inlines are ordinary direct
    /// formatting and are not reverted.
    fn op_remove_style(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = as_str(field(p, "id")?, "id")?;
        let index = self
            .styles
            .iter()
            .position(|d| d.id == id)
            .ok_or_else(|| EngineError::validation(format!("unknown style '{id}'")))?;
        let before_styles = self.styles.clone();
        self.styles.remove(index);
        let referenced = self
            .blocks
            .iter()
            .any(|b| b.style_id.as_deref() == Some(id));
        if referenced {
            let old_blocks = self.blocks.clone();
            for b in &mut self.blocks {
                if b.style_id.as_deref() == Some(id) {
                    b.style_id = None;
                }
            }
            self.record_undo(
                0,
                old_blocks,
                self.blocks.clone(),
                Collections {
                    styles: Some(before_styles),
                    ..Default::default()
                },
            );
        } else {
            self.record_undo(
                0,
                Vec::new(),
                Vec::new(),
                Collections::styles(before_styles),
            );
        }
        Ok(CommandResult::data(json!({ "ok": true, "id": id })))
    }

    /// `listStyles` — read-only; definitions sorted by id.
    fn op_list_styles(&self) -> Result<CommandResult, EngineError> {
        let mut sorted: Vec<&StyleDef> = self.styles.iter().collect();
        sorted.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(Self::read_only(json!({ "styles": sorted })))
    }

    /// `applyNamedStyle {style_id, from, to}` — copies a `"character"`
    /// style's properties onto the inlines in range, using the same
    /// re-split/patch rules as `applyStyle`. Properties present in the
    /// style overwrite the matching inline properties (null clears, as in
    /// `applyStyle`); properties absent from the style leave existing
    /// inline values untouched. The application is a snapshot copy: no
    /// link back to the definition remains.
    fn op_apply_named_style(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = style_id_field(p)?;
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        let def = self
            .find_style(id)
            .ok_or_else(|| EngineError::validation(format!("unknown style '{id}'")))?;
        if def.kind != NamedStyleKind::Character {
            return Err(EngineError::validation(format!(
                "style '{id}' is a paragraph style; use setBlockStyle"
            )));
        }
        let patch = StylePatch::parse(&def.properties)?;
        self.check_range(from, to)?;
        if from == to || patch.is_empty() {
            return Ok(Self::read_only(json!({ "ok": true })));
        }
        let (removed, new_span) = self.style_span(from, to, &patch);
        self.blocks
            .splice(from.block..=to.block, new_span.iter().cloned());
        self.record_undo(from.block, removed, new_span, Collections::default());
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `setBlockStyle {block, style_id}` — `style_id` must name a
    /// `"paragraph"` style; `null` clears the reference. Setting stamps the
    /// style's properties onto every inline in the block (same snapshot
    /// semantics as `applyNamedStyle`) and records the reference;
    /// clearing only removes the reference and never reverts stamped
    /// properties.
    fn op_set_block_style(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = as_usize(field(p, "block")?, "block")?;
        let style_id = {
            let mut found = None;
            for key in ["style_id", "id", "style"] {
                if let Some(v) = p.get(key) {
                    found = Some(v);
                    break;
                }
            }
            match found {
                Some(v) if v.is_null() => None,
                Some(v) => Some(as_str(v, "style_id")?.to_string()),
                None => {
                    return Err(EngineError::invalid(
                        "payload missing 'style_id' (string or null)",
                    ))
                }
            }
        };
        let Some(old) = self.blocks.get(index).cloned() else {
            return Err(EngineError::out_of_bounds(format!(
                "block {index} out of range"
            )));
        };
        if old.kind == BlockKind::Table {
            return Err(EngineError::validation(
                "cannot apply a block style to a table block",
            ));
        }
        if old.kind == BlockKind::Toc {
            return Err(EngineError::validation(
                "cannot apply a block style to a toc field block",
            ));
        }
        if old.kind == BlockKind::Bibliography {
            return Err(EngineError::validation(
                "cannot apply a block style to a bibliography field block",
            ));
        }
        // `properties.paragraph` (P12 slice 9) patches the block's paragraph
        // format with the same present-wins/absent-untouched snapshot
        // semantics as the inline stamp below.
        let (patch, paragraph_patch) = match &style_id {
            Some(id) => {
                let def = self
                    .find_style(id)
                    .ok_or_else(|| EngineError::validation(format!("unknown style '{id}'")))?;
                if def.kind != NamedStyleKind::Paragraph {
                    return Err(EngineError::validation(format!(
                        "style '{id}' is a character style; use applyNamedStyle"
                    )));
                }
                (
                    Some(StylePatch::parse(&def.properties)?),
                    style_paragraph_patch(&def.properties)?,
                )
            }
            None => (None, None),
        };
        let mut new = old.clone();
        new.style_id = style_id;
        if let Some(patch) = &patch {
            if !patch.is_empty() {
                for inl in &mut new.inlines {
                    patch.apply(&mut inl.style);
                }
                new.inlines = normalize_inlines(new.inlines);
            }
        }
        if let Some(paragraph_patch) = &paragraph_patch {
            paragraph_patch.apply(&mut new.format);
        }
        if new == old {
            return Ok(Self::read_only(json!({ "ok": true })));
        }
        self.blocks[index] = new.clone();
        self.record_undo(index, vec![old], vec![new], Collections::default());
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `setParagraphFormat {block, alignment?, indent_left?, indent_right?,
    /// indent_first?, tabs?}` — partial patch on one block's paragraph
    /// format (P12 slice 9). Alignment is `"left"|"center"|"right"|
    /// "justify"`; indents and tab positions are twips (indents
    /// 0..=31680, `indent_first` -31680..=31680 with negative meaning
    /// hanging); `tabs` is a list of `{position,alignment,leader?}` stops
    /// (≤64, strictly increasing positions ≤31680 twips, leader one of
    /// `dot|hyphen|underscore|heavy`). Present keys set, `null` clears,
    /// absent keys are untouched; `tabs:[]` or `tabs:null` clears the stop
    /// list. Rejects table blocks (their cells hold strict plain paras no
    /// op can address) and out-of-range blocks; equal values are eventless.
    /// Storage-only: no layout consumes the values yet.
    fn op_set_paragraph_format(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = as_usize(field(p, "block")?, "block")?;
        let patch = ParagraphFormatPatch::parse(p)?;
        let Some(old) = self.blocks.get(index).cloned() else {
            return Err(EngineError::out_of_bounds(format!(
                "block {index} out of range"
            )));
        };
        if old.kind == BlockKind::Table {
            return Err(EngineError::validation(
                "cannot format a table block; cell paragraph formatting is not supported",
            ));
        }
        if old.kind == BlockKind::Toc {
            return Err(EngineError::validation("cannot format a toc field block"));
        }
        if old.kind == BlockKind::Bibliography {
            return Err(EngineError::validation(
                "cannot format a bibliography field block",
            ));
        }
        if patch.is_empty() {
            return Ok(Self::read_only(json!({ "ok": true })));
        }
        let mut new = old.clone();
        patch.apply(&mut new.format);
        if new == old {
            return Ok(Self::read_only(json!({ "ok": true })));
        }
        self.blocks[index] = new.clone();
        self.record_undo(index, vec![old], vec![new], Collections::default());
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_blocks(&self) -> Result<CommandResult, EngineError> {
        Ok(Self::read_only(serde_json::to_value(SnapshotRef {
            blocks: &self.blocks,
        })?))
    }

    fn op_layout(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let page_width = as_f64(field(p, "page_width")?, "page_width")?;
        let font_size = as_f64(field(p, "font_size")?, "font_size")?;
        let page_height = match p.get("page_height") {
            Some(v) => as_f64(v, "page_height")?,
            None => page_width * A_SERIES_RATIO,
        };
        if page_width <= 0.0 || !page_width.is_finite() {
            return Err(EngineError::validation("page_width must be positive"));
        }
        if font_size <= 0.0 || !font_size.is_finite() {
            return Err(EngineError::validation("font_size must be positive"));
        }
        if page_height <= 0.0 || !page_height.is_finite() {
            return Err(EngineError::validation("page_height must be positive"));
        }

        // Optional real-font measurement: `font` names a family admitted via
        // `registerFont`. Absent or null keeps the legacy 0.5em estimate
        // byte-identically. One face measures the whole call — per-run
        // family/size resolution is deferred (fonts.rs module docs).
        let measure =
            match p.get("font") {
                None | Some(Value::Null) => None,
                Some(v) => {
                    let name = as_str(v, "font")?;
                    let face = self.fonts.find(name).ok_or_else(|| {
                        EngineError::validation(format!(
                            "font '{name}' is not registered; call registerFont first"
                        ))
                    })?;
                    Some(fonts::FaceMeasure::open(face).ok_or_else(|| {
                        EngineError::internal("registered font failed to re-parse")
                    })?)
                }
            };
        // char → advance in font units, memoized across blocks.
        let mut advance_cache: std::collections::HashMap<char, f64> =
            std::collections::HashMap::new();

        // Wrap each block greedily into {start,end} char spans.
        let mut pages: Vec<Value> = Vec::new();
        let mut cur_lines: Vec<Value> = Vec::new();
        let mut remaining = page_height;

        for (bi, b) in self.blocks.iter().enumerate() {
            let eff = font_size * b.kind.font_mult();
            let line_height = eff * LINE_SPACING;

            // Cell paragraphs wrap with the same greedy approximation as
            // top-level blocks; line spans index the block's
            // `block_content_text` serialization (for a table, the
            // `tables::table_text` cell grid — `layout` models no cell
            // geometry).
            let text = block_content_text(b);
            let spans = match &measure {
                None => {
                    let advance = eff * GLYPH_EM;
                    let max_chars = (page_width / advance).floor() as usize;
                    wrap_block(&text, max_chars.max(1))
                }
                Some(m) => {
                    let chars: Vec<char> = text.chars().collect();
                    let scale = eff / m.units_per_em();
                    // Shaped path: one harfrust pass over the whole block
                    // text (GSUB+GPOS: kerning, ligatures, complex-script
                    // reordering), with each glyph's x_advance folded back
                    // onto its cluster's first char so the greedy wrap
                    // keeps contiguous char spans. Shaped output is not
                    // prefix-additive under reordering/ligatures, so the
                    // prefix is reconstructed per char rather than queried
                    // per candidate line. `None` (shape error/panic) falls
                    // back to the slice-1 unshaped per-char advances.
                    let byte_offsets: Vec<usize> =
                        text.char_indices().map(|(i, _)| i).collect();
                    let shaped = m.shape_char_advances(&text, &byte_offsets);
                    let mut prefix = Vec::with_capacity(chars.len() + 1);
                    prefix.push(0.0f64);
                    let mut acc = 0.0f64;
                    match shaped {
                        Some(advances) => {
                            debug_assert_eq!(advances.len(), chars.len());
                            for &units in &advances {
                                acc += units * scale;
                                prefix.push(acc);
                            }
                        }
                        None => {
                            for &c in &chars {
                                let units = *advance_cache
                                    .entry(c)
                                    .or_insert_with(|| m.advance_units(c));
                                acc += units * scale;
                                prefix.push(acc);
                            }
                        }
                    }
                    wrap_block_measured(&chars, &prefix, page_width)
                }
            };
            let block_height = spans.len() as f64 * line_height;

            // A block that doesn't fit the remaining page height starts on a
            // fresh page (unless the page is already empty).
            if !cur_lines.is_empty() && block_height > remaining {
                pages.push(json!({ "lines": cur_lines }));
                cur_lines = Vec::new();
                remaining = page_height;
            }
            for (s, e) in spans {
                if cur_lines.is_empty() && line_height > remaining && !pages.is_empty() {
                    // shouldn't happen since remaining == page_height here
                }
                if line_height > remaining && !cur_lines.is_empty() {
                    pages.push(json!({ "lines": cur_lines }));
                    cur_lines = Vec::new();
                    remaining = page_height;
                }
                cur_lines.push(json!({ "block": bi, "start": s, "end": e }));
                remaining -= line_height;
            }
        }
        if !cur_lines.is_empty() {
            pages.push(json!({ "lines": cur_lines }));
        }
        Ok(Self::read_only(json!({ "pages": pages })))
    }

    /// `registerFont {family, face_index?, bytes_b64}`, or the font file as
    /// binary input. Admits one font face into the session registry that
    /// `layout {font}` measures with (P-font-glyph-backend-decision). The
    /// registry is session state, not document state: no journal entry, no
    /// snapshot bytes, `new`/`restore`/`undo` do not touch it — see
    /// `fonts.rs`. Re-registering an identical
    /// `(family, sha256, face_index)` is an idempotent read-only no-op.
    fn op_register_font(&mut self, cmd: &mut Command) -> Result<CommandResult, EngineError> {
        let family = as_str(field(&cmd.payload, "family")?, "family")?.to_owned();
        let face_index = match cmd.payload.get("face_index") {
            None | Some(Value::Null) => 0u32,
            Some(v) => {
                let n = as_usize(v, "face_index")?;
                u32::try_from(n)
                    .map_err(|_| EngineError::validation("face_index must fit in u32"))?
            }
        };
        let bytes = cmd.bytes_input("bytes_b64", base64_decode)?;
        let info: FontInfo = self.fonts.register(&family, face_index, bytes)?;
        let data = serde_json::to_value(&info)?;
        if info.registered {
            Ok(CommandResult::data(data))
        } else {
            Ok(Self::read_only(data))
        }
    }

    /// `removeFont {sha256}` — drops every face registered from those
    /// bytes (all families/face indices sharing the content hash).
    fn op_remove_font(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let sha = as_str(field(p, "sha256")?, "sha256")?;
        if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(EngineError::validation(
                "sha256 must be 64 hexadecimal characters",
            ));
        }
        let removed = self.fonts.remove(sha);
        if removed > 0 {
            Ok(CommandResult::data(json!({ "removed": removed })))
        } else {
            Ok(Self::read_only(json!({ "removed": 0 })))
        }
    }

    /// `listFonts` — read-only census of the session registry.
    fn op_list_fonts(&self) -> Result<CommandResult, EngineError> {
        let fonts: Vec<Value> = self
            .fonts
            .faces()
            .iter()
            .map(|f| {
                json!({
                    "family": f.family,
                    "sha256": f.sha256,
                    "face_index": f.face_index,
                    "units_per_em": f.units_per_em,
                    "num_glyphs": f.num_glyphs,
                })
            })
            .collect();
        Ok(Self::read_only(json!({ "fonts": fonts })))
    }

    /// `exportDocx {}` → `.docx` bytes as `bytes_b64`, or as binary output.
    /// As a task: stage 1 builds the archive (progress 0.5), stage 2 returns
    /// it; cancellation between stages returns nothing. Read-only.
    /// DOCX table export is deferred: documents containing table blocks
    /// reject rather than silently dropping cell content.
    fn op_export_docx(
        &self,
        cmd: &Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        if self.blocks.iter().any(|b| {
            matches!(
                b.kind,
                BlockKind::Table | BlockKind::Toc | BlockKind::Bibliography
            )
        }) {
            return Err(EngineError::validation(
                "DOCX export does not support tables or field blocks yet",
            ));
        }
        let bytes = docx::export_docx(&self.blocks)?;
        if let Some(ctx) = ctx {
            ctx.set_progress(0.5);
            ctx.checkpoint()?;
        }
        Ok(Self::read_only(json!({ "size": bytes.len() })).with_bytes(cmd, "bytes_b64", bytes))
    }

    /// `importDocx {bytes_b64}`, or the `.docx` as binary input.
    fn op_import_docx(&mut self, cmd: &mut Command) -> Result<CommandResult, EngineError> {
        let bytes = cmd.bytes_input("bytes_b64", base64_decode)?;
        let blocks = docx::import_docx(&bytes)?;
        lists::validate(&blocks)?;
        let old = std::mem::replace(&mut self.blocks, blocks);
        let bookmarks_before = std::mem::take(&mut self.bookmarks);
        // DOCX comment import is deferred; an imported document gets no
        // comments.
        let comments_before = std::mem::take(&mut self.comments);
        let styles_before = std::mem::take(&mut self.styles);
        // DOCX sectPr import is deferred; an imported document gets the
        // single default section.
        let sections_before = std::mem::replace(&mut self.sections, default_sections());
        // Revision tracking does not survive a wholesale DOCX replace:
        // imported documents start untracked with no pending revisions.
        let revisions_before = std::mem::take(&mut self.revisions);
        let tracking_before = std::mem::take(&mut self.tracking);
        // DOCX footnote import is deferred; an imported document gets no
        // footnotes/endnotes.
        let footnotes_before = std::mem::take(&mut self.footnotes);
        // DOCX citation/bibliography import is deferred the same way.
        let citations_before = std::mem::take(&mut self.citations);
        let sources_before = std::mem::take(&mut self.sources);
        self.record_undo(
            0,
            old,
            self.blocks.clone(),
            Collections::all(
                bookmarks_before,
                comments_before,
                styles_before,
                sections_before,
                revisions_before,
                tracking_before,
                footnotes_before,
                citations_before,
                sources_before,
            ),
        );
        Ok(CommandResult::data(serde_json::to_value(SnapshotRef {
            blocks: &self.blocks,
        })?))
    }
}

impl Default for QuillEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for QuillEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Quill
    }

    fn binary_input_ops(&self) -> &'static [&'static str] {
        &["importDocx", "registerFont"]
    }

    /// `exportDocx` checks for cancellation between building and returning
    /// the archive. Other ops run to completion once started.
    fn apply_long(
        &mut self,
        cmd: Command,
        ctx: &TaskContext,
    ) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, Some(ctx));
        }
        ctx.checkpoint()?;
        let result = if cmd.op == "exportDocx" && cmd.v == 1 {
            self.op_export_docx(&cmd, Some(ctx))
        } else {
            self.apply(cmd)
        }?;
        ctx.set_progress(1.0);
        Ok(result)
    }

    fn apply(&mut self, mut cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        if cmd.v != 1 {
            return Err(EngineError::unsupported(format!(
                "command version {} not supported",
                cmd.v
            )));
        }
        match cmd.op.as_str() {
            "new" => self.op_new(),
            "describe" => self.op_describe(),
            "insertText" => self.op_insert_text(&cmd.payload),
            "deleteRange" => self.op_delete_range(&cmd.payload),
            "replaceRange" => self.op_replace_range(&cmd.payload),
            "applyStyle" => self.op_apply_style(&cmd.payload),
            "changeCase" => self.op_change_case(&cmd.payload),
            "setListKind" | "setListFormat" | "shiftListLevel" => {
                self.op_lists(&cmd.op, &cmd.payload)
            }
            "setBlockKind" => self.op_set_block_kind(&cmd.payload),
            "insertBlock" => self.op_insert_block(&cmd.payload),
            "splitBlock" => self.op_split_block(&cmd.payload),
            "mergeBlock" => self.op_merge_block(&cmd.payload),
            "text" => self.op_text(&cmd.payload),
            "findText" => self.op_find_text(&cmd.payload),
            "replaceText" => self.op_replace_text(&cmd.payload),
            "addBookmark" => self.op_add_bookmark(&cmd.payload),
            "removeBookmark" => self.op_remove_bookmark(&cmd.payload),
            "listBookmarks" => self.op_list_bookmarks(),
            "insertSection" => self.op_insert_section(&cmd.payload),
            "removeSection" => self.op_remove_section(&cmd.payload),
            "setPageSetup" => self.op_set_page_setup(&cmd.payload),
            "setHeaderFooter" => self.op_set_header_footer(&cmd.payload),
            "listSections" => self.op_list_sections(),
            "defineStyle" => self.op_define_style(&cmd.payload),
            "updateStyle" => self.op_update_style(&cmd.payload),
            "removeStyle" => self.op_remove_style(&cmd.payload),
            "listStyles" => self.op_list_styles(),
            "addComment" => self.op_add_comment(&cmd.payload),
            "updateComment" => self.op_update_comment(&cmd.payload),
            "removeComment" => self.op_remove_comment(&cmd.payload),
            "resolveComment" => self.op_resolve_comment(&cmd.payload),
            "reopenComment" => self.op_reopen_comment(&cmd.payload),
            "listComments" => self.op_list_comments(),
            "addFootnote" => self.op_add_footnote(&cmd.payload),
            "updateFootnote" => self.op_update_footnote(&cmd.payload),
            "removeFootnote" => self.op_remove_footnote(&cmd.payload),
            "listFootnotes" => self.op_list_footnotes(),
            "insertToc" => self.op_insert_toc(&cmd.payload),
            "updateToc" => self.op_update_toc(&cmd.payload),
            "refreshToc" => self.op_refresh_toc(&cmd.payload),
            "listToc" => self.op_list_toc(&cmd.payload),
            "listMergeFields" => self.op_list_merge_fields(),
            "previewMerge" => self.op_preview_merge(&cmd.payload),
            "runMerge" => self.op_run_merge(&cmd.payload),
            "addSource" => self.op_add_source(&cmd.payload),
            "updateSource" => self.op_update_source(&cmd.payload),
            "removeSource" => self.op_remove_source(&cmd.payload),
            "listSources" => self.op_list_sources(),
            "addCitation" => self.op_add_citation(&cmd.payload),
            "updateCitation" => self.op_update_citation(&cmd.payload),
            "removeCitation" => self.op_remove_citation(&cmd.payload),
            "listCitations" => self.op_list_citations(),
            "insertBibliography" => self.op_insert_bibliography(&cmd.payload),
            "updateBibliography" => self.op_update_bibliography(&cmd.payload),
            "refreshBibliography" => self.op_refresh_bibliography(&cmd.payload),
            "listBibliography" => self.op_list_bibliography(&cmd.payload),
            "setTrackChanges" => self.op_set_track_changes(&cmd.payload),
            "listRevisions" => self.op_list_revisions(),
            "acceptRevision" => self.op_revision_decision(&cmd.payload, true),
            "rejectRevision" => self.op_revision_decision(&cmd.payload, false),
            "acceptAllRevisions" => self.op_revision_decision_all(&cmd.payload, true),
            "rejectAllRevisions" => self.op_revision_decision_all(&cmd.payload, false),
            "applyNamedStyle" => self.op_apply_named_style(&cmd.payload),
            "setBlockStyle" => self.op_set_block_style(&cmd.payload),
            "setParagraphFormat" => self.op_set_paragraph_format(&cmd.payload),
            "insertTable" => self.op_insert_table(&cmd.payload),
            "deleteTable" => self.op_delete_table(&cmd.payload),
            "setCellText" => self.op_set_cell_text(&cmd.payload),
            "insertTableRow" => self.op_insert_table_row(&cmd.payload),
            "deleteTableRow" => self.op_delete_table_row(&cmd.payload),
            "insertTableColumn" => self.op_insert_table_column(&cmd.payload),
            "deleteTableColumn" => self.op_delete_table_column(&cmd.payload),
            "listTables" => self.op_list_tables(),
            "describeTable" => self.op_describe_table(&cmd.payload),
            "mergeTableCells" => self.op_merge_table_cells(&cmd.payload),
            "unmergeTableCells" => self.op_unmerge_table_cells(&cmd.payload),
            "blocks" => self.op_blocks(),
            "layout" => self.op_layout(&cmd.payload),
            "registerFont" => self.op_register_font(&mut cmd),
            "removeFont" => self.op_remove_font(&cmd.payload),
            "listFonts" => self.op_list_fonts(),
            "exportDocx" => self.op_export_docx(&cmd, None),
            "importDocx" => self.op_import_docx(&mut cmd),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn apply_batch(
        &mut self,
        cmd: Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let batch = ignition_core::parse_batch(cmd)?;
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let styles_before = self.styles.clone();
        let sections_before = self.sections.clone();
        let revisions_before = self.revisions.clone();
        let tracking_before = self.tracking.clone();
        let footnotes_before = self.footnotes.clone();
        let citations_before = self.citations.clone();
        let sources_before = self.sources.clone();
        let staged = Self {
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
        let (staged, result) = match ctx {
            Some(ctx) => ignition_core::execute_batch_with_ctx(staged, batch, ctx)?,
            None => ignition_core::execute_batch(staged, batch)?,
        };
        // Every step validated its own candidate, but the committed block
        // list still goes through the same gates restore applies before it
        // can replace live state.
        lists::validate(&staged.blocks)?;
        validate_tables(&staged.blocks)?;
        validate_toc(&staged.blocks)?;
        validate_bibliography(&staged.blocks)?;
        if result
            .events
            .iter()
            .any(|event| event.kind == "document:changed")
        {
            let inserted = staged.blocks.clone();
            let removed = self.blocks.clone();
            self.bookmarks = staged.bookmarks;
            self.comments = staged.comments;
            self.styles = staged.styles;
            self.sections = staged.sections;
            self.revisions = staged.revisions;
            self.tracking = staged.tracking;
            self.footnotes = staged.footnotes;
            self.citations = staged.citations;
            self.sources = staged.sources;
            // Font ops inside a batch commit with the rest of the staged
            // session state; they carry no undo entry (session state).
            self.fonts = staged.fonts;
            self.record_undo(
                0,
                removed,
                inserted,
                Collections::all(
                    bookmarks_before,
                    comments_before,
                    styles_before,
                    sections_before,
                    revisions_before,
                    tracking_before,
                    footnotes_before,
                    citations_before,
                    sources_before,
                ),
            );
            self.blocks = staged.blocks;
        }
        Ok(result)
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let document = SnapshotRef {
            blocks: &self.blocks,
        };
        // Legacy readers ignore unknown Block fields. Removing root blocks makes
        // them reject numbered metadata instead of silently losing it.
        // Bookmarks, comments, named styles, sections, revisions, footnotes,
        // and the track-changes setting require the schema:3 wrapper so
        // pre-feature readers fail closed on `schema != 2`/`!= 3` rather than
        // silently dropping them (the schema:3 document is
        // `deny_unknown_fields`, so `comments`/`revisions`/`tracking`/
        // `footnotes` keys also fail schema:3-era readers closed — no
        // schema:4 bump for those).
        // `styles`/`sections`/`comments`/`revisions`/`tracking`/`footnotes`/
        // `citations`/`sources` are omitted from the document when
        // empty/default, keeping earlier schema:3 payloads byte-identical.
        //
        // Paragraph formatting (P12 slice 9) is different: `Block` itself
        // has no `deny_unknown_fields`, so schema≤3 readers would silently
        // drop a `format` field — the same reason `list` needed schema:2.
        // Any block carrying `format`, or any style def whose
        // `properties.paragraph` is non-null, therefore emits schema:4
        // (same document shape as schema:3; schema≤3 readers reject on the
        // version). Restore rejects v4 features inside schema<4 payloads.
        let needs_v3 = !self.bookmarks.is_empty()
            || !self.comments.is_empty()
            || !self.styles.is_empty()
            || !self.revisions.is_empty()
            || !self.footnotes.is_empty()
            || !self.citations.is_empty()
            || !self.sources.is_empty()
            || self.tracking.is_some()
            || !is_default_sections(&self.sections)
            || self.blocks.iter().any(|b| b.style_id.is_some());
        // schema:4 is emitted only for paragraph-format features; a doc
        // with bookmarks/comments/styles/sections but no format stays on
        // schema:3 byte-identically (schema:4's document carries the same
        // collections, so mixed documents lose nothing).
        let needs_v4 = self.blocks.iter().any(|b| b.format.is_some())
            || self
                .styles
                .iter()
                .any(|d| style_has_paragraph_props(&d.properties));
        let payload = if needs_v4 {
            serde_json::to_vec(&Schema3SnapshotRef {
                kind: "quill",
                schema: 4,
                document: Schema3DocSnapshotRef {
                    blocks: &self.blocks,
                    bookmarks: &self.bookmarks,
                    styles: &self.styles,
                    sections: &self.sections,
                    comments: &self.comments,
                    revisions: &self.revisions,
                    tracking: &self.tracking,
                    footnotes: &self.footnotes,
                    citations: &self.citations,
                    sources: &self.sources,
                },
            })?
        } else if needs_v3 {
            serde_json::to_vec(&Schema3SnapshotRef {
                kind: "quill",
                schema: 3,
                document: Schema3DocSnapshotRef {
                    blocks: &self.blocks,
                    bookmarks: &self.bookmarks,
                    styles: &self.styles,
                    sections: &self.sections,
                    comments: &self.comments,
                    revisions: &self.revisions,
                    tracking: &self.tracking,
                    footnotes: &self.footnotes,
                    citations: &self.citations,
                    sources: &self.sources,
                },
            })?
        } else if self.blocks.iter().any(|block| block.list.is_some()) {
            serde_json::to_vec(&ListSnapshotRef {
                kind: "quill",
                schema: 2,
                document,
            })?
        } else {
            serde_json::to_vec(&document)?
        };
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_fmt, payload) = decode_envelope(data)?;
        let value: Value = serde_json::from_slice(payload)?;
        let wrapped = value.as_object().is_some_and(|object| {
            ["kind", "schema", "document"]
                .iter()
                .any(|key| object.contains_key(*key))
        });
        // 0 = unwrapped legacy payload; otherwise the wrapper's schema.
        let mut schema_level = 0u32;
        let (
            state_blocks,
            bookmarks,
            comments,
            styles,
            sections,
            revisions,
            tracking,
            footnotes,
            citations,
            sources,
        ): (
            Vec<Block>,
            Vec<Bookmark>,
            Vec<Comment>,
            Vec<StyleDef>,
            Vec<Section>,
            Vec<Revision>,
            Option<TrackChanges>,
            Vec<Footnote>,
            Vec<Citation>,
            Vec<CitationSource>,
        ) = if wrapped {
            let wrapper: WrappedDocState = serde_json::from_value(value)?;
            if wrapper.kind != "quill" {
                return Err(EngineError::unsupported(
                    "unsupported Quill snapshot kind/schema",
                ));
            }
            schema_level = wrapper.schema;
            match wrapper.schema {
                2 => {
                    // A schema:2 document has neither bookmark, style, nor
                    // section fields; reject strays rather than silently
                    // dropping.
                    if wrapper.document.as_object().is_some_and(|o| {
                        o.contains_key("bookmarks")
                            || o.contains_key("comments")
                            || o.contains_key("styles")
                            || o.contains_key("sections")
                            || o.contains_key("revisions")
                            || o.contains_key("tracking")
                            || o.contains_key("footnotes")
                            || o.contains_key("citations")
                            || o.contains_key("sources")
                    }) {
                        return Err(EngineError::unsupported(
                            "unsupported Quill snapshot kind/schema",
                        ));
                    }
                    let doc: DocState = serde_json::from_value(wrapper.document)?;
                    (
                        doc.blocks,
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                        default_sections(),
                        Vec::new(),
                        None,
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                    )
                }
                3 | 4 => {
                    let doc: Schema3DocState = serde_json::from_value(wrapper.document)?;
                    // Absent `sections` means the single default section;
                    // an explicit list (even empty) is validated strictly.
                    let sections = doc.sections.unwrap_or_else(default_sections);
                    (
                        doc.blocks,
                        doc.bookmarks,
                        doc.comments,
                        doc.styles,
                        sections,
                        doc.revisions,
                        doc.tracking,
                        doc.footnotes,
                        doc.citations,
                        doc.sources,
                    )
                }
                _ => {
                    return Err(EngineError::unsupported(
                        "unsupported Quill snapshot kind/schema",
                    ))
                }
            }
        } else {
            if value.as_object().is_some_and(|o| {
                o.contains_key("bookmarks")
                    || o.contains_key("comments")
                    || o.contains_key("styles")
                    || o.contains_key("sections")
                    || o.contains_key("revisions")
                    || o.contains_key("tracking")
                    || o.contains_key("footnotes")
                    || o.contains_key("citations")
                    || o.contains_key("sources")
            }) {
                return Err(EngineError::unsupported(
                    "unsupported Quill snapshot kind/schema",
                ));
            }
            let doc: DocState = serde_json::from_value(value)?;
            (
                doc.blocks,
                Vec::new(),
                Vec::new(),
                Vec::new(),
                default_sections(),
                Vec::new(),
                None,
                Vec::new(),
                Vec::new(),
                Vec::new(),
            )
        };
        // Paragraph formatting (P12 slice 9) requires schema:4: schema≤3
        // and legacy readers silently drop `Block.format`, and schema≤3
        // readers would drop `properties.paragraph` semantics. A payload
        // carrying either under an older version is mislabeled or hostile —
        // reject rather than silently accept it.
        if schema_level < 4
            && (state_blocks.iter().any(|b| b.format.is_some())
                || styles
                    .iter()
                    .any(|d| style_has_paragraph_props(&d.properties)))
        {
            return Err(EngineError::unsupported(
                "unsupported Quill snapshot kind/schema",
            ));
        }
        lists::validate(&state_blocks)?;
        validate_tables(&state_blocks)?;
        validate_toc(&state_blocks)?;
        validate_bibliography(&state_blocks)?;
        for block in all_blocks(&state_blocks) {
            if let Some(format) = &block.format {
                validate_format(format)?;
            }
            for inline in &block.inlines {
                if let Some(highlight) = &inline.style.highlight {
                    validate_highlight(highlight)?;
                }
                if let Some(size) = inline.style.font_size {
                    validate_font_size(size)?;
                }
                if let Some(family) = &inline.style.font_family {
                    validate_font_family(family)?;
                }
            }
        }
        let mut blocks = state_blocks;
        if blocks.is_empty() {
            blocks.push(Block::empty(BlockKind::Para));
        }
        validate_bookmarks(&bookmarks, &blocks)?;
        validate_comments(&comments, &blocks)?;
        validate_styles(&styles, &blocks)?;
        validate_sections(&sections, &blocks)?;
        validate_revisions(&revisions, &blocks)?;
        validate_footnotes(&footnotes, &blocks)?;
        // Sources validate before citations: citation `source` fields must
        // name an existing source id.
        validate_sources(&sources)?;
        validate_citations(&citations, &sources, &blocks)?;
        if let Some(t) = &tracking {
            if let Some(author) = &t.author {
                comments::validate_comment_author(author)?;
            }
        }
        self.blocks = blocks;
        self.bookmarks = bookmarks;
        self.comments = comments;
        self.styles = styles;
        self.sections = sections;
        self.revisions = revisions;
        self.tracking = tracking;
        self.footnotes = footnotes;
        self.citations = citations;
        self.sources = sources;
        self.journal = Journal::new(JOURNAL_CAPACITY);
        Ok(())
    }

    fn undo(&mut self) -> Result<bool, EngineError> {
        let Some(entry) = self.journal.pop_undo() else {
            return Ok(false);
        };
        let end = (entry.index + entry.inserted.len()).min(self.blocks.len());
        self.blocks
            .splice(entry.index..end, entry.removed.iter().cloned());
        let bookmarks = entry.bookmarks.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = bookmarks {
            self.bookmarks = before;
        }
        let comments = entry.comments.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = comments {
            self.comments = before;
        }
        let styles = entry.styles.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = styles {
            self.styles = before;
        }
        let sections = entry.sections.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = sections {
            self.sections = before;
        }
        let revisions = entry.revisions.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = revisions {
            self.revisions = before;
        }
        let tracking = entry.tracking.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = tracking {
            self.tracking = before;
        }
        let footnotes = entry.footnotes.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = footnotes {
            self.footnotes = before;
        }
        let citations = entry.citations.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = citations {
            self.citations = before;
        }
        let sources = entry.sources.as_ref().map(|(before, _)| before.clone());
        if let Some(before) = sources {
            self.sources = before;
        }
        self.journal.push_redo(entry);
        Ok(true)
    }

    fn redo(&mut self) -> Result<bool, EngineError> {
        let Some(entry) = self.journal.pop_redo() else {
            return Ok(false);
        };
        let end = (entry.index + entry.removed.len()).min(self.blocks.len());
        self.blocks
            .splice(entry.index..end, entry.inserted.iter().cloned());
        let bookmarks = entry.bookmarks.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = bookmarks {
            self.bookmarks = after;
        }
        let comments = entry.comments.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = comments {
            self.comments = after;
        }
        let styles = entry.styles.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = styles {
            self.styles = after;
        }
        let sections = entry.sections.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = sections {
            self.sections = after;
        }
        let revisions = entry.revisions.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = revisions {
            self.revisions = after;
        }
        let tracking = entry.tracking.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = tracking {
            self.tracking = after;
        }
        let footnotes = entry.footnotes.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = footnotes {
            self.footnotes = after;
        }
        let citations = entry.citations.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = citations {
            self.citations = after;
        }
        let sources = entry.sources.as_ref().map(|(_, after)| after.clone());
        if let Some(after) = sources {
            self.sources = after;
        }
        self.journal.push_undo(entry);
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// Greedy word wrap
// ---------------------------------------------------------------------------

/// Greedy word wrap over `text` with `max` chars per line. Returns (start,end)
/// char spans covering the whole text; an empty text yields a single (0,0)
/// line. Words longer than `max` are hard-broken.
fn wrap_block(text: &str, max: usize) -> Vec<(usize, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    if n == 0 {
        return vec![(0, 0)];
    }
    let mut lines = Vec::new();
    let mut pos = 0usize;
    while pos < n {
        let mut used = 0usize; // chars on this line incl. interior spaces
        let mut last_end = pos; // end (exclusive) of last word that fits
        let mut scan = pos;
        while scan < n {
            let mut k = scan;
            while k < n && chars[k] == ' ' {
                k += 1;
            }
            let spaces = k - scan;
            if k == n {
                // only trailing spaces left — consume if they fit
                if used + spaces <= max {
                    last_end = n;
                }
                break;
            }
            let mut wend = k;
            while wend < n && chars[wend] != ' ' {
                wend += 1;
            }
            let needed = spaces + (wend - k);
            if used + needed <= max {
                used += needed;
                last_end = wend;
                scan = wend;
            } else {
                // Word doesn't fit: absorb the separator spaces into this
                // line if they fit so the next line starts at the word.
                if used + spaces <= max && spaces > 0 {
                    last_end = k;
                }
                break;
            }
        }
        if last_end == pos {
            // First word alone overflows — hard-break at `max` chars.
            let e = (pos + max).min(n);
            lines.push((pos, e));
            pos = e;
        } else {
            lines.push((pos, last_end));
            pos = last_end;
        }
    }
    lines
}

/// `wrap_block` on real advance widths. `chars`/`prefix` describe the same
/// text: `prefix[i]` is the summed advance (points) of the first `i`
/// chars, so `prefix[b] - prefix[a]` is the width of chars `a..b`.
/// Greedy word wrap with identical span semantics — `' '` is the only
/// separator, overlong words hard-break, spans stay contiguous — except
/// the fit test is `width <= max_width` instead of a char count. A single
/// char wider than `max_width` still occupies its own line so the walk
/// always progresses.
fn wrap_block_measured(chars: &[char], prefix: &[f64], max_width: f64) -> Vec<(usize, usize)> {
    let n = chars.len();
    debug_assert_eq!(prefix.len(), n + 1);
    if n == 0 {
        return vec![(0, 0)];
    }
    let width = |a: usize, b: usize| prefix[b] - prefix[a];
    let mut lines = Vec::new();
    let mut pos = 0usize;
    while pos < n {
        let mut last_end = pos; // end (exclusive) of last word that fits
        let mut scan = pos;
        while scan < n {
            let mut k = scan;
            while k < n && chars[k] == ' ' {
                k += 1;
            }
            let spaces = k - scan;
            if k == n {
                // only trailing spaces left — consume if they fit
                if width(pos, n) <= max_width {
                    last_end = n;
                }
                break;
            }
            let mut wend = k;
            while wend < n && chars[wend] != ' ' {
                wend += 1;
            }
            if width(pos, wend) <= max_width {
                last_end = wend;
                scan = wend;
            } else {
                // Word doesn't fit: absorb the separator spaces into this
                // line if they fit so the next line starts at the word.
                if spaces > 0 && width(pos, k) <= max_width {
                    last_end = k;
                }
                break;
            }
        }
        if last_end == pos {
            // First word alone overflows — hard-break at the widest
            // prefix that fits, always at least one char.
            let mut e = pos + 1;
            while e < n && width(pos, e + 1) <= max_width {
                e += 1;
            }
            lines.push((pos, e));
            pos = e;
        } else {
            lines.push((pos, last_end));
            pos = last_end;
        }
    }
    lines
}

// ---------------------------------------------------------------------------
// Minimal base64 (ignition_core::protocol is crate-private)
// ---------------------------------------------------------------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

#[cfg(test)]
fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn base64_decode(s: &str) -> Result<Vec<u8>, EngineError> {
    let mut table = [255u8; 256];
    for (i, &c) in B64.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let s = s.trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        let v = table[c as usize];
        if v == 255 {
            return Err(EngineError::serialization("invalid base64 in bytes_b64"));
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;
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

    fn err(e: &mut QuillEngine, op: &str, payload: Value) -> EngineError {
        e.apply(cmd(op, payload)).unwrap_err()
    }

    fn text(e: &mut QuillEngine) -> String {
        apply(e, "text", json!({})).data["text"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn describe(e: &mut QuillEngine) -> Value {
        apply(e, "describe", json!({})).data
    }

    fn insert(e: &mut QuillEngine, block: usize, offset: usize, t: &str) {
        apply(
            e,
            "insertText",
            json!({"at": {"block": block, "offset": offset}, "text": t}),
        );
    }

    // -- basics -----------------------------------------------------------

    #[test]
    fn new_gives_one_empty_para() {
        let mut e = engine();
        let d = describe(&mut e);
        assert_eq!(d["blocks"], json!([{ "kind": "para", "inlines": [] }]));
        let r = apply(&mut e, "new", json!({}));
        assert_eq!(r.data["ok"], true);
    }

    #[test]
    fn unknown_op_and_bad_version() {
        let mut e = engine();
        let er = err(&mut e, "bogus", json!({}));
        assert_eq!(er.code, ErrorCode::InvalidCommand);
        let er = e
            .apply(Command {
                v: 2,
                op: "text".into(),
                payload: json!({}),
                input: None,
                binary_output: false,
            })
            .unwrap_err();
        assert_eq!(er.code, ErrorCode::Unsupported);
    }

    #[test]
    fn insert_text_basic_and_empty_noop() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello");
        assert_eq!(text(&mut e), "hello");
        insert(&mut e, 0, 5, " world");
        insert(&mut e, 0, 0, ">>");
        assert_eq!(text(&mut e), ">>hello world");
        // empty insert is a no-op but still ok
        let r = apply(
            &mut e,
            "insertText",
            json!({"at": {"block": 0, "offset": 0}, "text": ""}),
        );
        assert_eq!(r.data["ok"], true);
        assert_eq!(text(&mut e), ">>hello world");
    }

    #[test]
    fn insert_text_splits_inline_and_inherits_left_style() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abcdef");
        // bold the middle "cd"
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 2},
                "to": {"block": 0, "offset": 4},
                "style": {"bold": true}
            }),
        );
        // insert inside bold run → inherits bold
        insert(&mut e, 0, 3, "X");
        let d = describe(&mut e);
        let inls = d["blocks"][0]["inlines"].as_array().unwrap();
        // expected: "ab"(plain) "c"(bold) "X"(bold) "d"(bold merged) "ef"(plain)
        let texts: Vec<&str> = inls.iter().map(|i| i["text"].as_str().unwrap()).collect();
        // "X" inherits bold from "c"; adjacent same-style runs normalize-merged
        assert_eq!(texts, vec!["ab", "cXd", "ef"]);
        assert_eq!(inls[1]["style"]["bold"], true);
        assert_eq!(inls[0]["style"]["bold"], false);
    }

    #[test]
    fn insert_at_zero_inherits_right_style() {
        let mut e = engine();
        insert(&mut e, 0, 0, "zz");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 0},
                "to": {"block": 0, "offset": 2},
                "style": {"italic": true}
            }),
        );
        insert(&mut e, 0, 0, "Q");
        let d = describe(&mut e);
        let inls = d["blocks"][0]["inlines"].as_array().unwrap();
        // "Q" inherits italic from char to the right → merged into one run
        assert_eq!(inls.len(), 1);
        assert_eq!(inls[0]["text"], "Qzz");
        assert_eq!(inls[0]["style"]["italic"], true);
    }

    #[test]
    fn insert_newline_splits_block_carrying_tail() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello world");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 6},
                "to": {"block": 0, "offset": 11},
                "style": {"bold": true}
            }),
        );
        insert(&mut e, 0, 5, "\n");
        assert_eq!(text(&mut e), "hello\n world");
        let d = describe(&mut e);
        assert_eq!(d["blocks"].as_array().unwrap().len(), 2);
        // tail keeps its run structure: " " plain + "world" bold
        let b1 = d["blocks"][1]["inlines"].as_array().unwrap();
        assert_eq!(b1[0]["text"], " ");
        assert_eq!(b1[0]["style"]["bold"], false);
        assert_eq!(b1[1]["text"], "world");
        assert_eq!(b1[1]["style"]["bold"], true);
        // multi-newline inserts create intermediate empty blocks
        insert(&mut e, 0, 5, "a\n\nb");
        let d = describe(&mut e);
        let kinds: Vec<&str> = d["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, vec!["para", "para", "para", "para"]);
        assert_eq!(text(&mut e), "helloa\n\nb\n world");
    }

    // -- delete -----------------------------------------------------------

    #[test]
    fn delete_within_block_splits_and_merges() {
        let mut e = engine();
        insert(&mut e, 0, 0, "aabbcc");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 2},
                "to": {"block": 0, "offset": 4},
                "style": {"bold": true}
            }),
        );
        // delete "ab" + part of bold "b"
        let r = apply(
            &mut e,
            "deleteRange",
            json!({
                "from": {"block": 0, "offset": 1},
                "to": {"block": 0, "offset": 3}
            }),
        );
        assert_eq!(r.data["deleted_text"], "ab");
        assert_eq!(text(&mut e), "abcc");
        let d = describe(&mut e);
        let inls = d["blocks"][0]["inlines"].as_array().unwrap();
        let texts: Vec<&str> = inls.iter().map(|i| i["text"].as_str().unwrap()).collect();
        let bolds: Vec<bool> = inls
            .iter()
            .map(|i| i["style"]["bold"].as_bool().unwrap())
            .collect();
        assert_eq!(texts, vec!["a", "b", "cc"]);
        assert_eq!(bolds, vec![false, true, false]);
    }

    #[test]
    fn delete_across_blocks_merges_survivors() {
        let mut e = engine();
        insert(&mut e, 0, 0, "AAA");
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 3}}),
        );
        insert(&mut e, 1, 0, "BBB");
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 1, "offset": 3}}),
        );
        insert(&mut e, 2, 0, "CCC");
        assert_eq!(text(&mut e), "AAA\nBBB\nCCC");
        // delete from mid-block0 to mid-block2 → whole block1 removed, merge
        let r = apply(
            &mut e,
            "deleteRange",
            json!({
                "from": {"block": 0, "offset": 1},
                "to": {"block": 2, "offset": 2}
            }),
        );
        assert_eq!(r.data["deleted_text"], "AA\nBBB\nCC");
        assert_eq!(text(&mut e), "AC");
        let d = describe(&mut e);
        assert_eq!(d["blocks"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn delete_to_block_start_merges() {
        let mut e = engine();
        insert(&mut e, 0, 0, "ab");
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 2}}),
        );
        insert(&mut e, 1, 0, "cd");
        apply(
            &mut e,
            "deleteRange",
            json!({
                "from": {"block": 0, "offset": 1},
                "to": {"block": 1, "offset": 0}
            }),
        );
        assert_eq!(text(&mut e), "acd");
    }

    // -- applyStyle ---------------------------------------------------------

    #[test]
    fn apply_style_across_blocks_and_partial_fields() {
        let mut e = engine();
        insert(&mut e, 0, 0, "one");
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 3}}),
        );
        insert(&mut e, 1, 0, "two");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 1},
                "to": {"block": 1, "offset": 2},
                "style": {"bold": true, "color": "#ff0000"}
            }),
        );
        let d = describe(&mut e);
        // block0: "o" plain + "ne" bold
        let b0 = d["blocks"][0]["inlines"].as_array().unwrap();
        assert_eq!(b0[0]["text"], "o");
        assert_eq!(b0[0]["style"]["bold"], false);
        assert_eq!(b0[1]["text"], "ne");
        assert_eq!(b0[1]["style"]["bold"], true);
        assert_eq!(b0[1]["style"]["color"], "#ff0000");
        // block1: "tw" bold + "o" plain
        let b1 = d["blocks"][1]["inlines"].as_array().unwrap();
        assert_eq!(b1[0]["text"], "tw");
        assert_eq!(b1[0]["style"]["bold"], true);
        assert_eq!(b1[1]["text"], "o");
        assert_eq!(b1[1]["style"]["bold"], false);
        // clearing a flag works
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 1},
                "to": {"block": 0, "offset": 3},
                "style": {"bold": false, "color": null}
            }),
        );
        let d = describe(&mut e);
        let b0 = d["blocks"][0]["inlines"].as_array().unwrap();
        assert_eq!(b0.len(), 1);
        assert_eq!(b0[0]["style"]["bold"], false);
        assert!(b0[0]["style"].get("color").is_none());
    }

    // -- structural ---------------------------------------------------------

    #[test]
    fn structural_ops() {
        let mut e = engine();
        insert(&mut e, 0, 0, "para one");
        let r = apply(&mut e, "setBlockKind", json!({"block": 0, "kind": "h1"}));
        assert_eq!(r.data["ok"], true);
        assert_eq!(describe(&mut e)["blocks"][0]["kind"], "h1");

        let r = apply(&mut e, "insertBlock", json!({"index": 1, "kind": "quote"}));
        assert_eq!(r.data["block_index"], 1);
        assert_eq!(describe(&mut e)["blocks"][1]["kind"], "quote");

        insert(&mut e, 1, 0, "quoted");
        let r = apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 1, "offset": 3}}),
        );
        assert_eq!(r.data["new_block_index"], 2);
        assert_eq!(text(&mut e), "para one\nquo\nted");

        apply(&mut e, "mergeBlock", json!({"index": 2}));
        assert_eq!(text(&mut e), "para one\nquoted");
        assert_eq!(describe(&mut e)["blocks"][1]["kind"], "quote");

        // bad kind + bad index
        assert_eq!(
            err(&mut e, "setBlockKind", json!({"block": 0, "kind": "nope"})).code,
            ErrorCode::Validation
        );
        assert_eq!(
            err(&mut e, "insertBlock", json!({"index": 99})).code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(
            err(&mut e, "mergeBlock", json!({"index": 0})).code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn merge_block_joins_inlines() {
        let mut e = engine();
        insert(&mut e, 0, 0, "ab");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 0},
                "to": {"block": 0, "offset": 2},
                "style": {"bold": true}
            }),
        );
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 2}}),
        );
        insert(&mut e, 1, 0, "cd");
        apply(&mut e, "mergeBlock", json!({"index": 1}));
        let d = describe(&mut e);
        let inls = d["blocks"][0]["inlines"].as_array().unwrap();
        assert_eq!(inls.len(), 2);
        assert_eq!(inls[0]["text"], "ab");
        assert_eq!(inls[0]["style"]["bold"], true);
        assert_eq!(inls[1]["text"], "cd");
    }

    // -- range extraction ---------------------------------------------------

    #[test]
    fn text_op_full_and_range() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello");
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 5}}),
        );
        insert(&mut e, 1, 0, "world");
        assert_eq!(text(&mut e), "hello\nworld");
        let r = apply(
            &mut e,
            "text",
            json!({
                "from": {"block": 0, "offset": 2},
                "to": {"block": 1, "offset": 3}
            }),
        );
        assert_eq!(r.data["text"], "llo\nwor");
    }

    // -- validation keeps state ----------------------------------------------

    #[test]
    fn invalid_positions_leave_state_unchanged() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        let before = describe(&mut e);
        assert_eq!(
            err(
                &mut e,
                "insertText",
                json!({"at": {"block": 5, "offset": 0}, "text": "x"})
            )
            .code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(
            err(
                &mut e,
                "deleteRange",
                json!({
                    "from": {"block": 0, "offset": 2},
                    "to": {"block": 0, "offset": 1}
                })
            )
            .code,
            ErrorCode::Validation
        );
        assert_eq!(
            err(
                &mut e,
                "deleteRange",
                json!({
                    "from": {"block": 0, "offset": 0},
                    "to": {"block": 0, "offset": 99}
                })
            )
            .code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(
            err(
                &mut e,
                "insertText",
                json!({"at": {"block": 0, "offset": 0}})
            )
            .code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(describe(&mut e), before);
    }

    // -- layout -------------------------------------------------------------

    #[test]
    fn layout_greedy_wrap() {
        let mut e = engine();
        // font_size 10 → advance 5px; page_width 100 → 20 chars/line
        insert(&mut e, 0, 0, "the quick brown fox jumps over the lazy dog");
        let r = apply(
            &mut e,
            "layout",
            json!({"page_width": 100.0, "font_size": 10.0}),
        );
        let pages = r.data["pages"].as_array().unwrap();
        assert_eq!(pages.len(), 1);
        let lines = pages[0]["lines"].as_array().unwrap();
        // 43 chars, 20/line, wrapped at word boundaries
        assert!(lines.len() >= 3);
        let first = &lines[0];
        assert_eq!(first["block"], 0);
        assert_eq!(first["start"], 0);
        // "the quick brown fox " = 20 chars (with trailing space) fits exactly
        assert_eq!(first["end"], 20);
        // all spans contiguous and within text length
        let mut prev_end = 0;
        for l in lines {
            assert_eq!(l["start"], prev_end);
            prev_end = l["end"].as_u64().unwrap() as usize;
        }
        assert_eq!(prev_end, 43);
    }

    #[test]
    fn layout_long_word_hard_breaks_and_headings_are_wider() {
        let mut e = engine();
        insert(&mut e, 0, 0, "supercalifragilistic");
        apply(&mut e, "setBlockKind", json!({"block": 0, "kind": "h1"}));
        // h1: eff=14, advance=7 → 100/7 ≈ 14 chars/line
        let r = apply(
            &mut e,
            "layout",
            json!({"page_width": 100.0, "font_size": 10.0}),
        );
        let lines = r.data["pages"][0]["lines"].as_array().unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["end"], 14);
        assert_eq!(lines[1]["start"], 14);
        assert_eq!(lines[1]["end"], 20);
    }

    #[test]
    fn layout_paginates_long_document() {
        let mut e = engine();
        // 10 short paragraphs
        for _ in 0..9 {
            insert(&mut e, 0, 0, "line\n");
        }
        insert(&mut e, 9, 0, "line");
        assert_eq!(describe(&mut e)["blocks"].as_array().unwrap().len(), 10);
        // font 10 para: line_height 14; page_height 50 → 3 lines/page
        let r = apply(
            &mut e,
            "layout",
            json!({
                "page_width": 200.0, "font_size": 10.0, "page_height": 50.0
            }),
        );
        let pages = r.data["pages"].as_array().unwrap();
        assert_eq!(pages.len(), 4);
        assert_eq!(pages[0]["lines"].as_array().unwrap().len(), 3);
        assert_eq!(pages[3]["lines"].as_array().unwrap().len(), 1);
        // blocks keep their page: each line references the right block index
        let all: Vec<u64> = pages
            .iter()
            .flat_map(|p| {
                p["lines"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|l| l["block"].as_u64().unwrap())
                    .collect::<Vec<_>>()
            })
            .collect();
        assert_eq!(all, vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }

    #[test]
    fn layout_default_page_height_uses_a_series_ratio() {
        let mut e = engine();
        insert(&mut e, 0, 0, "x");
        // page_height = 200*1.4142 = 282.84 → 20 lines of height 14 fit
        let r = apply(
            &mut e,
            "layout",
            json!({"page_width": 200.0, "font_size": 10.0}),
        );
        assert_eq!(r.data["pages"].as_array().unwrap().len(), 1);
        assert_eq!(
            err(
                &mut e,
                "layout",
                json!({"page_width": 0.0, "font_size": 10.0})
            )
            .code,
            ErrorCode::Validation
        );
    }

    // -- fonts (session registry + measured layout) -------------------------

    /// Deterministic test face (tests/fixtures/nftestmono.ttf, generated —
    /// no third-party font bytes): upem 1000; advances in font units are
    /// space=250, 'i'=200, 'W'=1000, 'm'=800, digits=600, other printable
    /// ASCII=500, .notdef=500.
    fn test_font_bytes() -> &'static [u8] {
        include_bytes!("../tests/fixtures/nftestmono.ttf")
    }

    fn register_test_font(e: &mut QuillEngine) -> CommandResult {
        apply(
            e,
            "registerFont",
            json!({
                "family": "NFTestMono",
                "bytes_b64": base64_encode(test_font_bytes()),
            }),
        )
    }

    #[test]
    fn register_font_reports_identity_and_dedups() {
        let mut e = engine();
        let r = register_test_font(&mut e);
        assert_eq!(r.data["registered"], true);
        assert_eq!(r.data["family"], "NFTestMono");
        assert_eq!(r.data["face_index"], 0);
        assert_eq!(r.data["units_per_em"], 1000);
        assert_eq!(r.data["num_glyphs"], 97);
        assert_eq!(r.data["sha256"].as_str().unwrap().len(), 64);
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));

        // Identical triple → idempotent no-op, no event.
        let r2 = e
            .apply(cmd(
                "registerFont",
                json!({
                    "family": "NFTestMono",
                    "bytes_b64": base64_encode(test_font_bytes()),
                }),
            ))
            .unwrap();
        assert_eq!(r2.data["registered"], false);
        assert!(r2.events.is_empty());

        let lf = apply(&mut e, "listFonts", json!({}));
        let fonts = lf.data["fonts"].as_array().unwrap();
        assert_eq!(fonts.len(), 1);
        assert_eq!(fonts[0]["family"], "NFTestMono");
        assert_eq!(fonts[0]["units_per_em"], 1000);
    }

    #[test]
    fn register_font_validates_payload_and_bytes() {
        let mut e = engine();
        // Missing family / bad family.
        assert_eq!(
            err(
                &mut e,
                "registerFont",
                json!({"bytes_b64": base64_encode(test_font_bytes())})
            )
            .code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            err(
                &mut e,
                "registerFont",
                json!({"family": "  ", "bytes_b64": base64_encode(test_font_bytes())})
            )
            .code,
            ErrorCode::Validation
        );
        // Empty and garbage bytes.
        assert!(err(
            &mut e,
            "registerFont",
            json!({"family": "X", "bytes_b64": ""})
        )
        .message
        .contains("empty"));
        assert!(err(
            &mut e,
            "registerFont",
            json!({"family": "X", "bytes_b64": base64_encode(b"this is not a font")})
        )
        .message
        .contains("not a recognized font"));
        // Truncated real font fails closed.
        assert!(
            err(
                &mut e,
                "registerFont",
                json!({"family": "X", "bytes_b64": base64_encode(&test_font_bytes()[..64])})
            )
            .code
                == ErrorCode::Validation
        );
        // face_index past the single face in the file.
        assert!(err(
            &mut e,
            "registerFont",
            json!({"family": "X", "face_index": 1, "bytes_b64": base64_encode(test_font_bytes())})
        )
        .code
            == ErrorCode::Validation);
        // Oversized face rejects before parsing.
        let big = vec![0u8; fonts::MAX_FONT_FACE_BYTES + 1];
        assert!(err(
            &mut e,
            "registerFont",
            json!({"family": "X", "bytes_b64": base64_encode(&big)})
        )
        .message
        .contains("byte limit"));
        // Nothing registered along the way.
        let lf = apply(&mut e, "listFonts", json!({}));
        assert_eq!(lf.data["fonts"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn register_font_swallows_hostile_parse_panics_as_validation() {
        // Bit-flipped variants of a real font must error or register —
        // never panic (a panic would fail this test outright).
        for offset in [0usize, 4, 12, 100, 500, 2000] {
            let mut e = engine();
            let mut bytes = test_font_bytes().to_vec();
            if offset < bytes.len() {
                bytes[offset] ^= 0xFF;
            }
            let _ = e.apply(cmd(
                "registerFont",
                json!({"family": format!("F{offset}"), "bytes_b64": base64_encode(&bytes)}),
            ));
        }
        // Registry face cap: 64 distinct families over the same bytes.
        let mut e = engine();
        for i in 0..fonts::MAX_FONT_FACES {
            apply(
                &mut e,
                "registerFont",
                json!({"family": format!("F{i}"), "bytes_b64": base64_encode(test_font_bytes())}),
            );
        }
        assert_eq!(
            err(
                &mut e,
                "registerFont",
                json!({"family": "Overflow", "bytes_b64": base64_encode(test_font_bytes())})
            )
            .code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn remove_font_drops_all_faces_for_hash() {
        let mut e = engine();
        register_test_font(&mut e);
        // Same bytes under a second family → two faces, one hash.
        apply(
            &mut e,
            "registerFont",
            json!({"family": "Alias", "bytes_b64": base64_encode(test_font_bytes())}),
        );
        assert_eq!(
            apply(&mut e, "listFonts", json!({})).data["fonts"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let sha = apply(&mut e, "listFonts", json!({})).data["fonts"][0]["sha256"]
            .as_str()
            .unwrap()
            .to_owned();
        let r = apply(&mut e, "removeFont", json!({"sha256": sha}));
        assert_eq!(r.data["removed"], 2);
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));
        // Removing again is a read-only no-op; bad hashes reject.
        assert_eq!(
            apply(&mut e, "removeFont", json!({"sha256": sha})).data["removed"],
            0
        );
        assert_eq!(
            err(&mut e, "removeFont", json!({"sha256": "zz"})).code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn fonts_are_session_state_not_document_state() {
        let mut e = engine();
        register_test_font(&mut e);
        insert(&mut e, 0, 0, "doc text");
        let snap = e.snapshot().unwrap();

        // Snapshot → restore into a fresh engine: no fonts carry over.
        let mut e2 = engine();
        e2.restore(&snap).unwrap();
        assert_eq!(
            apply(&mut e2, "listFonts", json!({})).data["fonts"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        // And the restored doc rejects the font name (registry is empty).
        assert_eq!(
            err(
                &mut e2,
                "layout",
                json!({"page_width": 100.0, "font_size": 10.0, "font": "NFTestMono"})
            )
            .code,
            ErrorCode::Validation
        );

        // Undo does not touch the registry either: undoing the text edit
        // leaves the font registered.
        let mut e3 = engine();
        insert(&mut e3, 0, 0, "x");
        register_test_font(&mut e3);
        assert!(e3.undo().unwrap());
        assert_eq!(
            apply(&mut e3, "listFonts", json!({})).data["fonts"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn layout_with_font_uses_real_advances() {
        let mut e = engine();
        register_test_font(&mut e);
        // 'W' = 1000 units → 10pt at font_size 10 (upem 1000), but the
        // fixture's GPOS kern ('W'+'W' −300, on the pair's first glyph)
        // shapes "WWWW" to per-char advances 7/7/7/10pt: three W's (21pt)
        // fit a 25pt line where two unshaped W's (20pt) were the old max.
        // Stub mode would give every char 5pt; shaped metrics give W ~7-10pt.
        insert(&mut e, 0, 0, "WWWW");
        let measured = apply(
            &mut e,
            "layout",
            json!({"page_width": 25.0, "font_size": 10.0, "font": "NFTestMono"}),
        );
        let lines = measured.data["pages"][0]["lines"].as_array().unwrap();
        assert_eq!(lines.len(), 2, "three shaped W's (21pt) fit, four (31pt) do not");
        assert_eq!(lines[0]["end"], 3);
        assert_eq!(lines[1]["start"], 3);
        assert_eq!(lines[1]["end"], 4);

        // Same call without `font` keeps the 0.5em estimate: 4 chars × 5pt
        // = 20pt ≤ 25 → a single line.
        let stub = apply(
            &mut e,
            "layout",
            json!({"page_width": 25.0, "font_size": 10.0}),
        );
        assert_eq!(stub.data["pages"][0]["lines"].as_array().unwrap().len(), 1);
        // Explicit null font is the same estimate.
        let nul = apply(
            &mut e,
            "layout",
            json!({"page_width": 25.0, "font_size": 10.0, "font": null}),
        );
        assert_eq!(nul.data["pages"][0]["lines"].as_array().unwrap().len(), 1);
        // Unknown family and non-string font reject without touching state.
        assert_eq!(
            err(
                &mut e,
                "layout",
                json!({"page_width": 25.0, "font_size": 10.0, "font": "Nope"})
            )
            .code,
            ErrorCode::Validation
        );
        assert_eq!(
            err(
                &mut e,
                "layout",
                json!({"page_width": 25.0, "font_size": 10.0, "font": 5})
            )
            .code,
            ErrorCode::InvalidCommand
        );
    }

    #[test]
    fn layout_font_word_wrap_and_hard_break() {
        let mut e = engine();
        register_test_font(&mut e);
        // A=5pt, space=2.5pt at font_size 10. "A A A" = 20pt total.
        insert(&mut e, 0, 0, "A A A");
        let r = apply(
            &mut e,
            "layout",
            json!({"page_width": 12.0, "font_size": 10.0, "page_height": 1000.0, "font": "NFTestMono"}),
        );
        let lines = r.data["pages"][0]["lines"].as_array().unwrap();
        // "A A" would be 12.5pt > 12 → each line holds "A " (7.5pt) and the
        // next word starts the next line: spans (0,2),(2,4),(4,5).
        let spans: Vec<(u64, u64)> = lines
            .iter()
            .map(|l| (l["start"].as_u64().unwrap(), l["end"].as_u64().unwrap()))
            .collect();
        assert_eq!(spans, vec![(0, 2), (2, 4), (4, 5)]);

        // A single over-wide word hard-breaks at the widest fitting prefix.
        let mut e2 = engine();
        register_test_font(&mut e2);
        insert(&mut e2, 0, 0, "WWWW");
        let r = apply(
            &mut e2,
            "layout",
            json!({"page_width": 5.0, "font_size": 10.0, "page_height": 1000.0, "font": "NFTestMono"}),
        );
        let lines = r.data["pages"][0]["lines"].as_array().unwrap();
        // Each W is 10pt > 5pt: every char still gets its own line.
        assert_eq!(lines.len(), 4);
        for (i, l) in lines.iter().enumerate() {
            assert_eq!(l["start"].as_u64().unwrap(), i as u64);
            assert_eq!(l["end"].as_u64().unwrap(), i as u64 + 1);
        }
    }

    #[test]
    fn layout_font_paginates_and_covers_headings_and_tables() {
        let mut e = engine();
        register_test_font(&mut e);
        // h1 'W's are wider still (eff = 14pt → shaped advances
        // 9.8/9.8/9.8/14pt after the W+W kern). Three fit a 30pt line
        // (29.4pt), four do not (43.4pt).
        insert(&mut e, 0, 0, "WWWW");
        apply(&mut e, "setBlockKind", json!({"block": 0, "kind": "h1"}));
        let r = apply(
            &mut e,
            "layout",
            json!({"page_width": 30.0, "font_size": 10.0, "font": "NFTestMono"}),
        );
        // h1 shaped WWW = 29.4pt ≤ 30 → same 2-line split, now (0,3),(3,4).
        let lines = r.data["pages"][0]["lines"].as_array().unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["end"], 3);

        // Table block: serialized cell text measures with the same face;
        // unmapped control chars (\n, \t) take the .notdef advance.
        apply(
            &mut e,
            "insertTable",
            json!({"index": 1, "rows": 1, "cols": 1}),
        );
        apply(
            &mut e,
            "setCellText",
            json!({"block": 1, "row": 0, "col": 0, "text": "AA"}),
        );
        let r = apply(
            &mut e,
            "layout",
            json!({"page_width": 100.0, "font_size": 10.0, "font": "NFTestMono"}),
        );
        assert!(r.data["pages"].is_array());
    }

    #[test]
    fn font_advance_units_match_fixture_metrics() {
        use fonts::FaceMeasure;
        let mut reg = fonts::FontRegistry::default();
        reg.register("NFTestMono", 0, test_font_bytes().to_vec())
            .unwrap();
        let face = reg.find("NFTestMono").unwrap();
        let m = FaceMeasure::open(face).unwrap();
        assert_eq!(m.units_per_em(), 1000.0);
        assert_eq!(m.advance_units('A'), 500.0);
        assert_eq!(m.advance_units('W'), 1000.0);
        assert_eq!(m.advance_units('i'), 200.0);
        assert_eq!(m.advance_units(' '), 250.0);
        assert_eq!(m.advance_units('1'), 600.0);
        // Outside the fixture's ASCII cmap → .notdef advance (500).
        assert_eq!(m.advance_units('\u{20AC}'), 500.0);
        // Control chars likewise fall back to .notdef.
        assert_eq!(m.advance_units('\n'), 500.0);
        assert_eq!(m.advance_units('\t'), 500.0);
    }

    /// Shaped (harfrust) per-char advances for the fixture: GPOS kern
    /// 'W'+'W' −300 units lands on the FIRST glyph of each pair, GSUB liga
    /// 'f'+'i' → 'f_i' (600 units) collapses two chars into one cluster.
    #[test]
    fn shaped_advances_apply_kern_and_liga() {
        use fonts::FaceMeasure;
        let mut reg = fonts::FontRegistry::default();
        reg.register("NFTestMono", 0, test_font_bytes().to_vec())
            .unwrap();
        let face = reg.find("NFTestMono").unwrap();
        let m = FaceMeasure::open(face).unwrap();
        let adv = |text: &str| {
            let offs: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
            m.shape_char_advances(text, &offs).unwrap()
        };
        // Unshaped would be [1000; 4]; kerned pairs give 700 on W0..W2.
        assert_eq!(adv("WWWW"), vec![700.0, 700.0, 700.0, 1000.0]);
        // 'fi' ligates: full 600-unit advance on 'f', nothing on 'i'.
        assert_eq!(adv("fi"), vec![600.0, 0.0]);
        // No kern pair, no ligature: identical to unshaped hmtx advances.
        assert_eq!(adv("To"), vec![500.0, 500.0]);
        assert_eq!(adv("A A"), vec![500.0, 250.0, 500.0]);
        // Shaping is deterministic across calls.
        assert_eq!(adv("WWWW"), adv("WWWW"));
    }

    /// `layout {font}` wraps on SHAPED advances: the 'W'+'W' kern and the
    /// 'fi' ligature change line breaks vs the unshaped hmtx prefix.
    #[test]
    fn layout_with_font_uses_shaped_advances() {
        let mut e = engine();
        register_test_font(&mut e);

        // Kern: "WWWW" shapes to per-char advances 7/7/7/10pt at font 10 —
        // three W's (21pt) fit a 25pt line where unshaped metrics allowed
        // only two (20pt; three unshaped = 30pt).
        insert(&mut e, 0, 0, "WWWW");
        let r = apply(
            &mut e,
            "layout",
            json!({"page_width": 25.0, "font_size": 10.0, "font": "NFTestMono"}),
        );
        let spans: Vec<(u64, u64)> = r.data["pages"][0]["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| (l["start"].as_u64().unwrap(), l["end"].as_u64().unwrap()))
            .collect();
        assert_eq!(spans, vec![(0, 3), (3, 4)]);

        // Ligature: "fi" shapes to a single 600-unit glyph → 6pt at font
        // 10; unshaped f+i would be 7pt. At page_width 8 the shaped word
        // fits one line while the 0.5em stub estimate (10pt) hard-breaks.
        let mut e2 = engine();
        register_test_font(&mut e2);
        insert(&mut e2, 0, 0, "fi");
        let r = apply(
            &mut e2,
            "layout",
            json!({"page_width": 8.0, "font_size": 10.0, "page_height": 1000.0, "font": "NFTestMono"}),
        );
        let lines = r.data["pages"][0]["lines"].as_array().unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["start"], 0);
        assert_eq!(lines[0]["end"], 2);
        let stub = apply(
            &mut e2,
            "layout",
            json!({"page_width": 8.0, "font_size": 10.0, "page_height": 1000.0}),
        );
        assert_eq!(stub.data["pages"][0]["lines"].as_array().unwrap().len(), 2);
    }

    // -- DOCX round-trip -----------------------------------------------------

    #[test]
    fn docx_round_trip_preserves_text_kinds_and_flags() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Title Here");
        apply(&mut e, "setBlockKind", json!({"block": 0, "kind": "h1"}));
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 10}}),
        );
        insert(&mut e, 1, 0, "plain and ");
        insert(&mut e, 1, 10, "bold");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 1, "offset": 10},
                "to": {"block": 1, "offset": 14},
                "style": {"bold": true, "italic": true}
            }),
        );
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 1, "offset": 14}}),
        );
        insert(&mut e, 2, 0, "item one");
        apply(&mut e, "setBlockKind", json!({"block": 2, "kind": "list"}));
        apply(&mut e, "insertBlock", json!({"index": 3, "kind": "quote"}));
        insert(&mut e, 3, 0, "struck & <tagged>");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 3, "offset": 0},
                "to": {"block": 3, "offset": 6},
                "style": {"strike": true, "underline": true}
            }),
        );
        let before = describe(&mut e);

        let exported = apply(&mut e, "exportDocx", json!({}));
        let b64 = exported.data["bytes_b64"].as_str().unwrap();
        let bytes = base64_decode(b64).unwrap();
        assert_eq!(&bytes[0..2], b"PK", "not a zip file");

        let mut e2 = engine();
        let imported = apply(&mut e2, "importDocx", json!({"bytes_b64": b64}));
        assert!(imported.data["blocks"].as_array().unwrap().len() >= 4);
        assert_eq!(describe(&mut e2), before);
        assert_eq!(text(&mut e2), text(&mut e));
    }

    #[test]
    fn import_docx_rejects_malformed() {
        let mut e = engine();
        insert(&mut e, 0, 0, "keep me");
        let before = describe(&mut e);

        // not base64
        assert_eq!(
            err(&mut e, "importDocx", json!({"bytes_b64": "!!!"})).code,
            ErrorCode::Serialization
        );
        // valid b64, not a zip
        let b64 = base64_encode(b"not a zip");
        assert_eq!(
            err(&mut e, "importDocx", json!({"bytes_b64": b64})).code,
            ErrorCode::Serialization
        );
        // zip missing word/document.xml
        let mut cur = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut cur);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("foo.txt", o).unwrap();
            use std::io::Write;
            z.write_all(b"hi").unwrap();
            z.finish().unwrap();
        }
        let b64 = base64_encode(cur.get_ref());
        assert_eq!(
            err(&mut e, "importDocx", json!({"bytes_b64": b64})).code,
            ErrorCode::Serialization
        );
        // state untouched on failure
        assert_eq!(describe(&mut e), before);
    }

    // -- undo/redo ------------------------------------------------------------

    #[test]
    fn replace_range_is_one_undo_step() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello foo world");
        let before = describe(&mut e);
        let r = apply(
            &mut e,
            "replaceRange",
            json!({"from": {"block":0,"offset":6}, "to": {"block":0,"offset":9}, "text": "bar"}),
        );
        assert_eq!(r.data["deleted_text"], "foo");
        assert_eq!(text(&mut e), "hello bar world");
        let after = describe(&mut e);
        assert!(e.undo().unwrap());
        assert_eq!(
            describe(&mut e),
            before,
            "one undo restores the original text"
        );
        assert!(e.redo().unwrap());
        assert_eq!(describe(&mut e), after);
    }

    #[test]
    fn replace_range_across_blocks_with_newlines_undoes_atomically() {
        let mut e = engine();
        insert(&mut e, 0, 0, "one\ntwo\nthree");
        let before = describe(&mut e);
        apply(
            &mut e,
            "replaceRange",
            json!({"from": {"block":0,"offset":1}, "to": {"block":2,"offset":2}, "text": "X\nY\nZ\nW"}),
        );
        assert_eq!(text(&mut e), "oX\nY\nZ\nWree");
        assert!(e.undo().unwrap());
        assert_eq!(describe(&mut e), before);
        assert!(e.redo().unwrap());
        assert_eq!(text(&mut e), "oX\nY\nZ\nWree");
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap(), "the setup insert is still its own entry");
        assert_eq!(text(&mut e), "");
    }

    #[test]
    fn replace_range_pure_insert_and_pure_delete_record_one_entry() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(
            &mut e,
            "replaceRange",
            json!({"from": {"block":0,"offset":1}, "to": {"block":0,"offset":1}, "text": "Z"}),
        );
        assert_eq!(text(&mut e), "aZbc");
        apply(
            &mut e,
            "replaceRange",
            json!({"from": {"block":0,"offset":0}, "to": {"block":0,"offset":2}, "text": ""}),
        );
        assert_eq!(text(&mut e), "bc");
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "aZbc");
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "abc");
    }

    #[test]
    fn replace_range_rejects_bad_input_without_mutating() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        let before = describe(&mut e);
        for payload in [
            json!({"from": {"block":0,"offset":2}, "to": {"block":0,"offset":1}, "text": "x"}),
            json!({"from": {"block":0,"offset":0}, "to": {"block":5,"offset":0}, "text": "x"}),
            json!({"from": {"block":0,"offset":0}, "to": {"block":0,"offset":1}, "text": 7}),
            json!({"from": {"block":0,"offset":0}, "to": {"block":0,"offset":1}}),
        ] {
            err(&mut e, "replaceRange", payload);
            assert_eq!(describe(&mut e), before);
        }
        assert!(e.undo().unwrap(), "only the setup insert is recorded");
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn undo_redo_text_edits() {
        let mut e = engine();
        assert_eq!(e.undo().unwrap(), false);
        insert(&mut e, 0, 0, "abc");
        insert(&mut e, 0, 3, "def");
        assert_eq!(text(&mut e), "abcdef");
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "abc");
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "");
        assert_eq!(e.undo().unwrap(), false);
        assert!(e.redo().unwrap());
        assert_eq!(text(&mut e), "abc");
        assert!(e.redo().unwrap());
        assert_eq!(text(&mut e), "abcdef");
        assert_eq!(e.redo().unwrap(), false);
    }

    #[test]
    fn undo_restores_deleted_cross_block_span() {
        let mut e = engine();
        insert(&mut e, 0, 0, "AAA\nBBB\nCCC");
        assert_eq!(describe(&mut e)["blocks"].as_array().unwrap().len(), 3);
        apply(
            &mut e,
            "deleteRange",
            json!({
                "from": {"block": 0, "offset": 1},
                "to": {"block": 2, "offset": 2}
            }),
        );
        assert_eq!(text(&mut e), "AC");
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "AAA\nBBB\nCCC");
        assert!(e.redo().unwrap());
        assert_eq!(text(&mut e), "AC");
    }

    #[test]
    fn undo_redo_structural_and_new() {
        let mut e = engine();
        insert(&mut e, 0, 0, "x");
        apply(&mut e, "insertBlock", json!({"index": 1}));
        assert_eq!(describe(&mut e)["blocks"].as_array().unwrap().len(), 2);
        assert!(e.undo().unwrap());
        assert_eq!(describe(&mut e)["blocks"].as_array().unwrap().len(), 1);
        apply(&mut e, "new", json!({}));
        assert_eq!(text(&mut e), "");
        // undo of `new` restores the previous document
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "x");
        // a new apply clears redo
        insert(&mut e, 0, 1, "y");
        assert_eq!(e.redo().unwrap(), false);
    }

    // -- snapshot / restore ----------------------------------------------------

    #[test]
    fn snapshot_restore_round_trip() {
        let mut e = engine();
        insert(&mut e, 0, 0, "persist me\nsecond block");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 0},
                "to": {"block": 0, "offset": 7},
                "style": {"underline": true, "color": "#00ff00", "link": "https://x"}
            }),
        );
        apply(&mut e, "setBlockKind", json!({"block": 1, "kind": "h2"}));
        let before = describe(&mut e);
        let snap = e.snapshot().unwrap();
        assert_eq!(&snap[0..4], b"NFD1");

        let mut e2 = engine();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&mut e2), before);
        // keep mutating after restore
        insert(&mut e2, 1, 12, "!");
        assert_eq!(text(&mut e2), "persist me\nsecond block!");

        // corrupted/foreign snapshots are rejected
        assert!(e2.restore(b"junk").is_err());
        let mut bad = snap.clone();
        *bad.last_mut().unwrap() ^= 0xff;
        assert!(e2.restore(&bad).is_err());
        assert_eq!(text(&mut e2), "persist me\nsecond block!");
    }

    #[test]
    fn utf8_offsets_count_chars_not_bytes() {
        let mut e = engine();
        insert(&mut e, 0, 0, "héllo wörld");
        insert(&mut e, 0, 2, "X");
        assert_eq!(text(&mut e), "héXllo wörld");
        let r = apply(
            &mut e,
            "deleteRange",
            json!({
                "from": {"block": 0, "offset": 0},
                "to": {"block": 0, "offset": 3}
            }),
        );
        assert_eq!(r.data["deleted_text"], "héX");
    }

    fn font_style_payload(family: Value) -> Value {
        json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"style":{"font_family":family}})
    }

    #[test]
    fn font_family_set_clear_and_undo_preserve_other_style() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(
            &mut e,
            "applyStyle",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"style":{"bold":true}}),
        );
        apply(&mut e, "applyStyle", font_style_payload(json!("Aptos")));
        assert_eq!(
            e.blocks[0].inlines[0].style.font_family.as_deref(),
            Some("Aptos")
        );
        apply(&mut e, "applyStyle", font_style_payload(Value::Null));
        assert!(e.blocks[0].inlines[0].style.bold);
        assert_eq!(e.blocks[0].inlines[0].style.font_family, None);
        assert!(e.undo().unwrap());
        assert_eq!(
            e.blocks[0].inlines[0].style.font_family.as_deref(),
            Some("Aptos")
        );
        assert!(e.undo().unwrap());
        assert_eq!(e.blocks[0].inlines[0].style.font_family, None);
        assert!(e.redo().unwrap());
        assert_eq!(
            e.blocks[0].inlines[0].style.font_family.as_deref(),
            Some("Aptos")
        );
    }

    #[test]
    fn invalid_font_patch_preserves_document_and_redo_history() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(&mut e, "applyStyle", font_style_payload(json!("Aptos")));
        assert!(e.undo().unwrap());
        let before = e.snapshot().unwrap();
        for family in [
            json!(""),
            json!("   "),
            json!("bad\nfont"),
            json!("x".repeat(129)),
            json!(42),
            json!("\u{fffe}"),
        ] {
            let mut payload = font_style_payload(family);
            payload["style"]["italic"] = json!(true);
            assert!(e.apply(cmd("applyStyle", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        assert_eq!(
            e.blocks[0].inlines[0].style.font_family.as_deref(),
            Some("Aptos")
        );
        assert!(!e.blocks[0].inlines[0].style.italic);
    }

    #[test]
    fn font_snapshot_legacy_default_and_invalid_restore_are_atomic() {
        let mut e = engine();
        let legacy = encode_envelope(serde_json::to_vec(&json!({"blocks":[{"kind":"para","inlines":[{"text":"abc","style":{"bold":true}}]}]})).unwrap().as_slice());
        e.restore(&legacy).unwrap();
        assert_eq!(e.blocks[0].inlines[0].style.font_family, None);
        apply(&mut e, "applyStyle", font_style_payload(json!("Aptos")));
        let snapshot = e.snapshot().unwrap();
        let mut restored = engine();
        restored.restore(&snapshot).unwrap();
        assert_eq!(restored.blocks, e.blocks);
        let bad = encode_envelope(serde_json::to_vec(&json!({"blocks":[{"kind":"para","inlines":[{"text":"replacement","style":{"font_family":"\u{0}"}}]}]})).unwrap().as_slice());
        assert!(e.restore(&bad).is_err());
        assert_eq!(e.snapshot().unwrap(), snapshot);
        assert!(e.undo().unwrap());
        assert_eq!(e.blocks[0].inlines[0].style.font_family, None);
    }

    #[test]
    fn font_docx_escaped_family_roundtrip_and_clear() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        let family = "A&B \"Quoted\" <Family>";
        apply(&mut e, "applyStyle", font_style_payload(json!(family)));
        let bytes = docx::export_docx(&e.blocks).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        let mut xml = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("word/document.xml").unwrap(), &mut xml)
            .unwrap();
        assert!(xml.contains("A&amp;B &quot;Quoted&quot; &lt;Family&gt;"));
        assert_eq!(docx::import_docx(&bytes).unwrap(), e.blocks);
        apply(&mut e, "applyStyle", font_style_payload(Value::Null));
        let cleared = docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap();
        assert_eq!(cleared[0].inlines[0].style.font_family, None);
        assert_eq!(cleared, e.blocks);
    }

    fn font_size_payload(size: Value) -> Value {
        json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"style":{"font_size":size}})
    }

    #[test]
    fn font_size_clear_undo_and_exact_docx_half_points() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(&mut e, "applyStyle", font_style_payload(json!("Aptos")));
        for size in [1.0, 10.5, 1638.0] {
            apply(&mut e, "applyStyle", font_size_payload(json!(size)));
            let imported = docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap();
            assert_eq!(imported, e.blocks);
            assert_eq!(imported[0].inlines[0].style.font_size, Some(size));
        }
        let snapshot = e.snapshot().unwrap();
        let mut restored = engine();
        restored.restore(&snapshot).unwrap();
        assert_eq!(restored.blocks, e.blocks);
        apply(&mut e, "applyStyle", font_size_payload(Value::Null));
        let imported = docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap();
        assert_eq!(imported[0].inlines[0].style.font_size, None);
        assert_eq!(
            imported[0].inlines[0].style.font_family.as_deref(),
            Some("Aptos")
        );
        assert!(e.undo().unwrap());
        assert_eq!(e.blocks[0].inlines[0].style.font_size, Some(1638.0));
        assert!(e.redo().unwrap());
        assert_eq!(e.blocks[0].inlines[0].style.font_size, None);
    }

    #[test]
    fn invalid_size_patch_and_restore_preserve_state_and_history() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(&mut e, "applyStyle", font_size_payload(json!(10.5)));
        assert!(e.undo().unwrap());
        let before = e.snapshot().unwrap();
        for size in [
            json!(0),
            json!(-1),
            json!(1638.5),
            json!(10.25),
            json!("12"),
        ] {
            let mut payload = font_size_payload(size.clone());
            payload["style"]["italic"] = json!(true);
            assert!(e.apply(cmd("applyStyle", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
            let bad = encode_envelope(serde_json::to_vec(&json!({"blocks":[{"kind":"para","inlines":[{"text":"other","style":{"font_size":size}}]}]})).unwrap().as_slice());
            assert!(e.restore(&bad).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        assert_eq!(e.blocks[0].inlines[0].style.font_size, Some(10.5));
        assert!(!e.blocks[0].inlines[0].style.italic);
        let legacy = encode_envelope(
            serde_json::to_vec(
                &json!({"blocks":[{"kind":"para","inlines":[{"text":"old","style":{}}]}]}),
            )
            .unwrap()
            .as_slice(),
        );
        e.restore(&legacy).unwrap();
        assert_eq!(e.blocks[0].inlines[0].style.font_size, None);
    }

    fn highlight_payload(color: Value) -> Value {
        json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"style":{"highlight":color}})
    }

    #[test]
    fn highlight_roundtrip_snapshot_clear_and_history_preserve_font() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(&mut e, "applyStyle", font_size_payload(json!(10.5)));
        apply(&mut e, "applyStyle", highlight_payload(json!("#12aBcF")));
        let snapshot = e.snapshot().unwrap();
        let mut restored = engine();
        restored.restore(&snapshot).unwrap();
        assert_eq!(restored.blocks, e.blocks);
        assert_eq!(
            docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap(),
            e.blocks
        );
        apply(&mut e, "applyStyle", highlight_payload(Value::Null));
        assert_eq!(e.blocks[0].inlines[0].style.highlight, None);
        assert_eq!(e.blocks[0].inlines[0].style.font_size, Some(10.5));
        assert_eq!(
            docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap(),
            e.blocks
        );
        assert!(e.undo().unwrap());
        assert_eq!(
            e.blocks[0].inlines[0].style.highlight.as_deref(),
            Some("#12aBcF")
        );
        assert!(e.redo().unwrap());
        assert_eq!(e.blocks[0].inlines[0].style.highlight, None);
    }

    #[test]
    fn invalid_highlight_patch_and_restore_are_atomic_and_keep_redo() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(&mut e, "applyStyle", highlight_payload(json!("#123456")));
        assert!(e.undo().unwrap());
        let before = e.snapshot().unwrap();
        for color in [
            json!("yellow"),
            json!("#fff"),
            json!("#12345z"),
            json!("#12345678"),
            json!(""),
            json!(7),
        ] {
            let mut payload = highlight_payload(color.clone());
            payload["style"]["bold"] = json!(true);
            assert!(e.apply(cmd("applyStyle", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
            let bad = encode_envelope(serde_json::to_vec(&json!({"blocks":[{"kind":"para","inlines":[{"text":"other","style":{"highlight":color}}]}]})).unwrap().as_slice());
            assert!(e.restore(&bad).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        assert_eq!(
            e.blocks[0].inlines[0].style.highlight.as_deref(),
            Some("#123456")
        );
        assert!(!e.blocks[0].inlines[0].style.bold);
        let legacy = encode_envelope(
            serde_json::to_vec(
                &json!({"blocks":[{"kind":"para","inlines":[{"text":"old","style":{}}]}]}),
            )
            .unwrap()
            .as_slice(),
        );
        e.restore(&legacy).unwrap();
        assert_eq!(e.blocks[0].inlines[0].style.highlight, None);
    }

    // -- findText / replaceText ------------------------------------------------

    fn find(e: &mut QuillEngine, payload: Value) -> CommandResult {
        apply(e, "findText", payload)
    }

    #[test]
    fn find_text_case_insensitive_by_default_and_sensitive_on_request() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Foo foo FOO");
        let r = find(&mut e, json!({"query": "foo"}));
        assert_eq!(r.data["count"], 3);
        assert_eq!(r.events.len(), 0, "read-only op emits no events");
        let matches = r.data["matches"].as_array().unwrap();
        assert_eq!(matches[0]["from"]["offset"], 0);
        assert_eq!(matches[0]["to"]["offset"], 3);
        assert_eq!(matches[0]["text"], "Foo");
        let r = find(&mut e, json!({"query": "foo", "case_sensitive": true}));
        assert_eq!(r.data["count"], 1);
        assert_eq!(r.data["matches"][0]["from"]["offset"], 4);
        // non-bool flag rejects as payload validation, like sibling ops
        assert_eq!(
            err(
                &mut e,
                "findText",
                json!({"query": "x", "case_sensitive": "yes"})
            )
            .code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn find_text_range_bounded_and_empty_query_rejected() {
        let mut e = engine();
        insert(&mut e, 0, 0, "one two one");
        let r = find(
            &mut e,
            json!({
                "query": "one",
                "from": {"block": 0, "offset": 4},
                "to": {"block": 0, "offset": 11}
            }),
        );
        assert_eq!(r.data["count"], 1);
        assert_eq!(r.data["matches"][0]["from"]["offset"], 8);
        // a match clipped by the range end is not reported
        let r = find(
            &mut e,
            json!({
                "query": "one",
                "from": {"block": 0, "offset": 0},
                "to": {"block": 0, "offset": 2}
            }),
        );
        assert_eq!(r.data["count"], 0);
        // empty query and inverted range reject, state unchanged
        let before = describe(&mut e);
        assert_eq!(
            err(&mut e, "findText", json!({"query": ""})).code,
            ErrorCode::Validation
        );
        assert_eq!(
            err(
                &mut e,
                "findText",
                json!({
                    "query": "x",
                    "from": {"block": 0, "offset": 5},
                    "to": {"block": 0, "offset": 1}
                })
            )
            .code,
            ErrorCode::Validation
        );
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn find_text_matches_across_blocks_but_never_spans_them() {
        let mut e = engine();
        insert(&mut e, 0, 0, "cat");
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 3}}),
        );
        insert(&mut e, 1, 0, "dog cat");
        // "cat" exists in block0 and inside block1 — two per-block matches
        let r = find(&mut e, json!({"query": "cat"}));
        assert_eq!(r.data["count"], 2);
        assert_eq!(r.data["matches"][0]["from"]["block"], 0);
        assert_eq!(r.data["matches"][1]["from"]["block"], 1);
        assert_eq!(r.data["matches"][1]["from"]["offset"], 4);
        // "t\nd"-style cross-block text never matches: query "catdog" absent
        let r = find(&mut e, json!({"query": "catdog"}));
        assert_eq!(r.data["count"], 0);
        // range starting mid-document finds only later blocks
        let r = find(
            &mut e,
            json!({
                "query": "cat",
                "from": {"block": 1, "offset": 0}
            }),
        );
        assert_eq!(r.data["count"], 1);
        assert_eq!(r.data["matches"][0]["from"]["block"], 1);
    }

    #[test]
    fn replace_text_all_matches_one_undo_entry() {
        let mut e = engine();
        insert(&mut e, 0, 0, "foo bar foo baz foo");
        let before = describe(&mut e);
        let r = apply(
            &mut e,
            "replaceText",
            json!({"query": "foo", "replacement": "qux"}),
        );
        assert_eq!(r.data["replaced"], 3);
        assert_eq!(text(&mut e), "qux bar qux baz qux");
        assert_eq!(r.events.len(), 1);
        let after = describe(&mut e);
        assert!(e.undo().unwrap());
        assert_eq!(describe(&mut e), before, "single undo restores all");
        assert!(e.redo().unwrap());
        assert_eq!(describe(&mut e), after);
    }

    #[test]
    fn replace_text_case_and_range_and_style_inheritance() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Foo foo");
        apply(
            &mut e,
            "applyStyle",
            json!({
                "from": {"block": 0, "offset": 4},
                "to": {"block": 0, "offset": 7},
                "style": {"bold": true}
            }),
        );
        // case-insensitive replace across a styled run: replacement inherits
        // each match's own first-char style
        let r = apply(
            &mut e,
            "replaceText",
            json!({"query": "foo", "replacement": "X"}),
        );
        assert_eq!(r.data["replaced"], 2);
        assert_eq!(text(&mut e), "X X");
        let d = describe(&mut e);
        let inls = d["blocks"][0]["inlines"].as_array().unwrap();
        // "X "(plain) + "X"(bold) + trailing space? text is "X X": plain X,
        // space, bold X? second match was bold "foo" → its X is bold.
        let bolds: Vec<bool> = inls
            .iter()
            .map(|i| i["style"]["bold"].as_bool().unwrap())
            .collect();
        assert_eq!(bolds, vec![false, true]);
        assert_eq!(inls[1]["text"], "X");
    }

    #[test]
    fn replace_text_respects_range_bounds() {
        let mut e = engine();
        insert(&mut e, 0, 0, "foo foo foo");
        let r = apply(
            &mut e,
            "replaceText",
            json!({
                "query": "foo",
                "replacement": "X",
                "from": {"block": 0, "offset": 4},
                "to": {"block": 0, "offset": 7}
            }),
        );
        assert_eq!(r.data["replaced"], 1);
        assert_eq!(text(&mut e), "foo X foo");
        // multi-block range: matches only inside [from,to)
        insert(&mut e, 0, 9, "\nfoo");
        let r = apply(
            &mut e,
            "replaceText",
            json!({
                "query": "foo",
                "replacement": "Y",
                "from": {"block": 1, "offset": 0}
            }),
        );
        assert_eq!(r.data["replaced"], 1);
        assert_eq!(text(&mut e), "foo X foo\nY");
    }

    #[test]
    fn replace_text_empty_match_set_and_newline_replacement_rejected() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        // zero matches: eventless, no journal entry
        let r = apply(
            &mut e,
            "replaceText",
            json!({"query": "zzz", "replacement": "q"}),
        );
        assert_eq!(r.data["replaced"], 0);
        assert_eq!(r.events.len(), 0);
        assert!(e.undo().unwrap(), "only the setup insert is undoable");
        assert!(!e.undo().unwrap());
        // newline replacement rejects without mutating
        let before = describe(&mut e);
        assert_eq!(
            err(
                &mut e,
                "replaceText",
                json!({"query": "a", "replacement": "x\ny"})
            )
            .code,
            ErrorCode::Validation
        );
        assert_eq!(
            err(
                &mut e,
                "replaceText",
                json!({"query": "", "replacement": "x"})
            )
            .code,
            ErrorCode::Validation
        );
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn replace_text_delete_only_and_snapshot_restore_unaffected() {
        let mut e = engine();
        insert(&mut e, 0, 0, "a1b1c");
        let r = apply(
            &mut e,
            "replaceText",
            json!({"query": "1", "replacement": ""}),
        );
        assert_eq!(r.data["replaced"], 2);
        assert_eq!(text(&mut e), "abc");
        // snapshot/restore round-trips the replaced document identically
        let snap = e.snapshot().unwrap();
        let mut e2 = engine();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&mut e2), describe(&mut e));
        // find works after restore too
        let r = find(&mut e2, json!({"query": "b"}));
        assert_eq!(r.data["count"], 1);
    }

    #[test]
    fn replace_text_identical_replacement_reports_zero_and_stays_eventless() {
        let mut e = engine();
        insert(&mut e, 0, 0, "foo bar foo");
        let before = describe(&mut e);
        // replacement identical to every match: matches exist but no edit
        // is applied, so `replaced` is 0 and nothing is journaled/emitted
        let r = apply(
            &mut e,
            "replaceText",
            json!({"query": "foo", "replacement": "foo"}),
        );
        assert_eq!(r.data["replaced"], 0);
        assert_eq!(r.events.len(), 0);
        assert_eq!(describe(&mut e), before);
        assert!(e.undo().unwrap(), "only the setup insert is undoable");
        assert!(!e.undo().unwrap());
    }

    // -- bookmarks ------------------------------------------------------------

    fn bookmarks(e: &mut QuillEngine) -> Value {
        apply(e, "listBookmarks", json!({})).data["bookmarks"].clone()
    }

    fn bookmark_at(e: &mut QuillEngine, name: &str) -> Value {
        bookmarks(e)
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["name"] == name)
            .cloned()
            .unwrap_or(Value::Null)
    }

    #[test]
    fn bookmark_add_list_remove_and_validation() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello world");
        let r = apply(
            &mut e,
            "addBookmark",
            json!({"name": "mid", "pos": {"block": 0, "offset": 6}}),
        );
        assert_eq!(r.data["name"], "mid");
        assert_eq!(r.events.len(), 1, "mutating op emits document:changed");
        // read-only list emits nothing and does not journal
        let r = apply(&mut e, "listBookmarks", json!({}));
        assert_eq!(r.events.len(), 0);
        assert_eq!(
            r.data["bookmarks"],
            json!([{ "name": "mid", "pos": { "block": 0, "offset": 6 } }])
        );
        // listBookmarks recorded no entry: the next undo pops addBookmark
        assert!(e.undo().unwrap());
        assert!(bookmark_at(&mut e, "mid").is_null());
        assert!(e.redo().unwrap());
        assert_eq!(bookmark_at(&mut e, "mid")["pos"]["offset"], 6);
        // pos aliases at/anchor
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "end", "at": {"block": 0, "offset": 11}}),
        );
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "start", "anchor": {"block": 0, "offset": 0}}),
        );
        // sorted by position then name
        let list = bookmarks(&mut e);
        let names: Vec<&str> = list
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["start", "mid", "end"]);

        // duplicate name rejects, state unchanged
        let before = bookmarks(&mut e);
        assert_eq!(
            err(
                &mut e,
                "addBookmark",
                json!({"name": "mid", "pos": {"block": 0, "offset": 0}})
            )
            .code,
            ErrorCode::Validation
        );
        assert_eq!(bookmarks(&mut e), before);
        // name validation
        for name in [
            json!(""),
            json!("   "),
            json!("a\nb"),
            json!("x".repeat(65)),
            json!(7),
        ] {
            assert!(e
                .apply(cmd(
                    "addBookmark",
                    json!({"name": name, "pos": {"block": 0, "offset": 0}})
                ))
                .is_err());
        }
        // missing pos / out-of-range pos reject
        assert_eq!(
            err(&mut e, "addBookmark", json!({"name": "x"})).code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            err(
                &mut e,
                "addBookmark",
                json!({"name": "x", "pos": {"block": 9, "offset": 0}})
            )
            .code,
            ErrorCode::OutOfBounds
        );
        assert_eq!(
            err(
                &mut e,
                "addBookmark",
                json!({"name": "x", "pos": {"block": 0, "offset": 99}})
            )
            .code,
            ErrorCode::OutOfBounds
        );

        // remove by name and by pos
        let r = apply(&mut e, "removeBookmark", json!({"name": "mid"}));
        assert_eq!(r.data["name"], "mid");
        assert!(bookmark_at(&mut e, "mid").is_null());
        let r = apply(
            &mut e,
            "removeBookmark",
            json!({"pos": {"block": 0, "offset": 11}}),
        );
        assert_eq!(r.data["name"], "end");
        assert_eq!(
            err(&mut e, "removeBookmark", json!({"name": "ghost"})).code,
            ErrorCode::Validation
        );
        assert_eq!(
            err(
                &mut e,
                "removeBookmark",
                json!({"pos": {"block": 0, "offset": 3}})
            )
            .code,
            ErrorCode::Validation
        );
        // both selectors at once reject rather than silently preferring name
        for extra in [
            json!({"pos": {"block": 0, "offset": 0}}),
            json!({"at": {"block": 0, "offset": 0}}),
            json!({"anchor": {"block": 0, "offset": 0}}),
        ] {
            let mut payload = json!({"name": "start"});
            payload
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert_eq!(
                err(&mut e, "removeBookmark", payload).code,
                ErrorCode::Validation
            );
        }
        assert_eq!(bookmarks(&mut e).as_array().unwrap().len(), 1);
    }

    #[test]
    fn bookmarks_shift_with_insert_text() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello world");
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "w", "pos": {"block": 0, "offset": 6}}),
        );
        // insert before the mark shifts it
        insert(&mut e, 0, 0, "XX");
        assert_eq!(bookmark_at(&mut e, "w")["pos"]["offset"], 8);
        // insert exactly at the mark: right gravity keeps it after inserted text
        insert(&mut e, 0, 8, "AB");
        assert_eq!(bookmark_at(&mut e, "w")["pos"]["offset"], 10);
        assert_eq!(text(&mut e), "XXhello ABworld");
        // newline insert moves the mark into the tail block after the last segment
        insert(&mut e, 0, 0, "a\nb");
        let bm = bookmark_at(&mut e, "w");
        assert_eq!(bm["pos"]["block"], 1);
        assert_eq!(bm["pos"]["offset"], 11); // last seg "b" (1) + old offset 10
        assert_eq!(text(&mut e), "a\nbXXhello ABworld");
        // undo restores the pre-insert position
        assert!(e.undo().unwrap());
        let bm = bookmark_at(&mut e, "w");
        assert_eq!(bm["pos"]["block"], 0);
        assert_eq!(bm["pos"]["offset"], 10);
        assert!(e.redo().unwrap());
        assert_eq!(bookmark_at(&mut e, "w")["pos"]["block"], 1);
    }

    #[test]
    fn bookmarks_survive_delete_split_merge_and_block_insert() {
        let mut e = engine();
        insert(&mut e, 0, 0, "AAA\nBBB\nCCC");
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "b0", "pos": {"block": 0, "offset": 3}}),
        );
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "b1", "pos": {"block": 1, "offset": 1}}),
        );
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "b2", "pos": {"block": 2, "offset": 3}}),
        );
        // split block 2 at offset 1: mark at end (offset 3) moves to tail block
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 2, "offset": 1}}),
        );
        let bm = bookmark_at(&mut e, "b2");
        assert_eq!(bm["pos"]["block"], 3);
        assert_eq!(bm["pos"]["offset"], 2);
        // merge blocks 2 and 3 back: mark returns to block 2 offset 1+2=3
        apply(&mut e, "mergeBlock", json!({"index": 3}));
        let bm = bookmark_at(&mut e, "b2");
        assert_eq!(bm["pos"]["block"], 2);
        assert_eq!(bm["pos"]["offset"], 3);
        // insert a block before block 1: later marks shift
        apply(&mut e, "insertBlock", json!({"index": 1}));
        assert_eq!(bookmark_at(&mut e, "b1")["pos"]["block"], 2);
        assert_eq!(bookmark_at(&mut e, "b2")["pos"]["block"], 3);
        // same-block delete shifts offsets
        apply(
            &mut e,
            "deleteRange",
            json!({"from": {"block": 0, "offset": 0}, "to": {"block": 0, "offset": 1}}),
        );
        assert_eq!(bookmark_at(&mut e, "b0")["pos"]["offset"], 2);
    }

    #[test]
    fn bookmarks_clamp_or_drop_on_cross_block_delete() {
        let mut e = engine();
        insert(&mut e, 0, 0, "AAA\nBBB\nCCC\nDDD");
        for (name, block, offset) in [
            ("edge-from", 0usize, 1usize),
            ("past-from", 0, 3),
            ("inside", 1, 2),
            ("edge-to", 2, 0),
            ("past-to", 2, 3),
            ("after", 3, 1),
        ] {
            apply(
                &mut e,
                "addBookmark",
                json!({"name": name, "pos": {"block": block, "offset": offset}}),
            );
        }
        // delete from mid-block0 to start of block2: blocks 1 and the head of
        // block2's range are consumed; survivors merge into block 0.
        apply(
            &mut e,
            "deleteRange",
            json!({
                "from": {"block": 0, "offset": 1},
                "to": {"block": 2, "offset": 0}
            }),
        );
        assert_eq!(text(&mut e), "ACCC\nDDD");
        // edge-from keeps its position; past-from clamps to the deletion start
        assert_eq!(
            bookmark_at(&mut e, "edge-from")["pos"],
            json!({"block": 0, "offset": 1})
        );
        assert_eq!(
            bookmark_at(&mut e, "past-from")["pos"],
            json!({"block": 0, "offset": 1})
        );
        // interior block bookmark is removed entirely
        assert!(bookmark_at(&mut e, "inside").is_null());
        // marks in the last deleted block clamp to / shift from the merge point
        assert_eq!(
            bookmark_at(&mut e, "edge-to")["pos"],
            json!({"block": 0, "offset": 1})
        );
        assert_eq!(
            bookmark_at(&mut e, "past-to")["pos"],
            json!({"block": 0, "offset": 4})
        );
        // later blocks shift down by the removed span
        assert_eq!(
            bookmark_at(&mut e, "after")["pos"],
            json!({"block": 1, "offset": 1})
        );
        // undo restores every bookmark at its original position
        assert!(e.undo().unwrap());
        assert_eq!(
            bookmark_at(&mut e, "inside")["pos"],
            json!({"block": 1, "offset": 2})
        );
        assert_eq!(
            bookmark_at(&mut e, "past-to")["pos"],
            json!({"block": 2, "offset": 3})
        );
        assert_eq!(
            bookmark_at(&mut e, "after")["pos"],
            json!({"block": 3, "offset": 1})
        );
        assert!(e.redo().unwrap());
        assert!(bookmark_at(&mut e, "inside").is_null());
    }

    #[test]
    fn bookmarks_track_replace_range_and_replace_text() {
        let mut e = engine();
        insert(&mut e, 0, 0, "foo bar foo");
        for (name, offset) in [("before", 0usize), ("early", 1), ("mid", 5), ("after", 8)] {
            apply(
                &mut e,
                "addBookmark",
                json!({"name": name, "pos": {"block": 0, "offset": offset}}),
            );
        }
        // replaceRange "bar" -> "bazaar": the mark inside the range lands
        // after the replacement; marks after it shift by +3.
        apply(
            &mut e,
            "replaceRange",
            json!({
                "from": {"block": 0, "offset": 4},
                "to": {"block": 0, "offset": 7},
                "text": "bazaar"
            }),
        );
        assert_eq!(text(&mut e), "foo bazaar foo");
        assert_eq!(bookmark_at(&mut e, "before")["pos"]["offset"], 0);
        assert_eq!(bookmark_at(&mut e, "early")["pos"]["offset"], 1);
        assert_eq!(bookmark_at(&mut e, "mid")["pos"]["offset"], 10);
        assert_eq!(bookmark_at(&mut e, "after")["pos"]["offset"], 11);
        // replaceText "foo" -> "quux": marks at/inside each match land after
        // the replacement text; untouched marks shift by the length delta.
        apply(
            &mut e,
            "replaceText",
            json!({"query": "foo", "replacement": "quux"}),
        );
        assert_eq!(text(&mut e), "quux bazaar quux");
        assert_eq!(bookmark_at(&mut e, "before")["pos"]["offset"], 4);
        assert_eq!(bookmark_at(&mut e, "early")["pos"]["offset"], 4);
        assert_eq!(bookmark_at(&mut e, "mid")["pos"]["offset"], 11);
        assert_eq!(bookmark_at(&mut e, "after")["pos"]["offset"], 16);
        // one undo restores both the text and every bookmark position
        assert!(e.undo().unwrap());
        assert_eq!(text(&mut e), "foo bazaar foo");
        assert_eq!(bookmark_at(&mut e, "mid")["pos"]["offset"], 10);
        assert_eq!(bookmark_at(&mut e, "after")["pos"]["offset"], 11);
        assert!(e.undo().unwrap());
        assert_eq!(bookmark_at(&mut e, "early")["pos"]["offset"], 1);
        assert_eq!(bookmark_at(&mut e, "mid")["pos"]["offset"], 5);
    }

    #[test]
    fn bookmarks_track_change_case_expansion() {
        let mut e = engine();
        e.blocks[0].inlines = vec![Inline {
            text: "aßz".into(),
            style: Style::default(),
        }];
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "end", "pos": {"block": 0, "offset": 3}}),
        );
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "mid", "pos": {"block": 0, "offset": 2}}),
        );
        apply(
            &mut e,
            "changeCase",
            json!({"from": {"block": 0, "offset": 0}, "to": {"block": 0, "offset": 3}, "mode": "upper"}),
        );
        assert_eq!(text(&mut e), "ASSZ");
        // ß expands to SS: end mark 3 -> 4, mid mark 2 -> 3
        assert_eq!(bookmark_at(&mut e, "end")["pos"]["offset"], 4);
        assert_eq!(bookmark_at(&mut e, "mid")["pos"]["offset"], 3);
    }

    #[test]
    fn bookmark_undo_redo_and_new_import_clear() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "x", "pos": {"block": 0, "offset": 1}}),
        );
        apply(&mut e, "removeBookmark", json!({"name": "x"}));
        assert_eq!(bookmarks(&mut e).as_array().unwrap().len(), 0);
        assert!(e.undo().unwrap(), "undo of remove restores the bookmark");
        assert_eq!(bookmark_at(&mut e, "x")["pos"]["offset"], 1);
        assert!(e.undo().unwrap(), "undo of add removes it again");
        assert!(bookmark_at(&mut e, "x").is_null());
        assert!(e.redo().unwrap());
        assert_eq!(bookmark_at(&mut e, "x")["pos"]["offset"], 1);
        assert!(e.redo().unwrap());
        assert!(
            bookmark_at(&mut e, "x").is_null(),
            "redo of remove drops it"
        );
        // `new` clears bookmarks but undo restores them
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "x", "pos": {"block": 0, "offset": 1}}),
        );
        apply(&mut e, "new", json!({}));
        assert!(bookmark_at(&mut e, "x").is_null());
        assert!(e.undo().unwrap());
        assert_eq!(bookmark_at(&mut e, "x")["pos"]["offset"], 1);
    }

    #[test]
    fn bookmark_snapshot_schema3_round_trip_and_legacy_restore() {
        let mut e = engine();
        insert(&mut e, 0, 0, "persist\nsecond");
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "here", "pos": {"block": 1, "offset": 3}}),
        );
        let snap = e.snapshot().unwrap();
        let payload: Value = serde_json::from_slice(&decode_envelope(&snap).unwrap().1).unwrap();
        assert_eq!(payload["kind"], "quill");
        assert_eq!(payload["schema"], 3);
        assert!(payload.get("blocks").is_none(), "no root blocks field");

        let mut e2 = engine();
        e2.restore(&snap).unwrap();
        assert_eq!(
            bookmark_at(&mut e2, "here")["pos"],
            json!({"block": 1, "offset": 3})
        );
        // edits after restore keep tracking
        insert(&mut e2, 1, 0, "XX");
        assert_eq!(bookmark_at(&mut e2, "here")["pos"]["offset"], 5);

        // legacy bare payload restores with no bookmarks
        let legacy = encode_envelope(
            serde_json::to_vec(
                &json!({"blocks":[{"kind":"para","inlines":[{"text":"old","style":{}}]}]}),
            )
            .unwrap()
            .as_slice(),
        );
        let mut e3 = engine();
        e3.restore(&legacy).unwrap();
        assert_eq!(bookmarks(&mut e3).as_array().unwrap().len(), 0);

        // schema:2 wrapper restores with no bookmarks
        let schema2 = encode_envelope(
            serde_json::to_vec(&json!({
                "kind": "quill", "schema": 2,
                "document": {"blocks": [{"kind":"para","inlines":[{"text":"l2","style":{}}]}]}
            }))
            .unwrap()
            .as_slice(),
        );
        let mut e4 = engine();
        e4.restore(&schema2).unwrap();
        assert_eq!(text(&mut e4), "l2");
        assert_eq!(bookmarks(&mut e4).as_array().unwrap().len(), 0);
    }

    #[test]
    fn bookmark_snapshot_rejects_hostile_and_future_payloads() {
        let mut e = engine();
        insert(&mut e, 0, 0, "keep");
        let before = e.snapshot().unwrap();
        let wrap = |schema: u32, document: Value| {
            encode_envelope(
                serde_json::to_vec(&json!({
                    "kind": "quill", "schema": schema, "document": document
                }))
                .unwrap()
                .as_slice(),
            )
        };
        let one_block = || json!([{"kind":"para","inlines":[{"text":"x","style":{}}]}]);
        // schema:4 and wrong kind reject
        assert!(e.restore(&wrap(4, json!({"blocks": one_block()}))).is_err());
        let wrong_kind = encode_envelope(
            serde_json::to_vec(&json!({
                "kind": "folio", "schema": 3,
                "document": {"blocks": one_block(), "bookmarks": []}
            }))
            .unwrap()
            .as_slice(),
        );
        assert!(e.restore(&wrong_kind).is_err());
        // schema:2 carrying bookmarks rejects rather than dropping them
        assert!(e
            .restore(&wrap(
                2,
                json!({"blocks": one_block(), "bookmarks": [{"name":"a","block":0,"offset":0}]})
            ))
            .is_err());
        // unwrapped payload with a stray bookmarks key rejects
        let stray = encode_envelope(
            serde_json::to_vec(&json!({
                "blocks": one_block(),
                "bookmarks": [{"name":"a","block":0,"offset":0}]
            }))
            .unwrap()
            .as_slice(),
        );
        assert!(e.restore(&stray).is_err());
        // schema:3 hostile documents reject
        for document in [
            // out-of-range block
            json!({"blocks": one_block(), "bookmarks": [{"name":"a","block":7,"offset":0}]}),
            // offset past block length
            json!({"blocks": one_block(), "bookmarks": [{"name":"a","block":0,"offset":9}]}),
            // duplicate names
            json!({"blocks": one_block(), "bookmarks": [
                {"name":"a","block":0,"offset":0},{"name":"a","block":0,"offset":1}]}),
            // blank / control / overlong names
            json!({"blocks": one_block(), "bookmarks": [{"name":" ","block":0,"offset":0}]}),
            json!({"blocks": one_block(), "bookmarks": [{"name":"a\nb","block":0,"offset":0}]}),
            json!({"blocks": one_block(), "bookmarks": [{"name":"x".repeat(65),"block":0,"offset":0}]}),
            // stray keys inside a bookmark reject (deny_unknown_fields)
            json!({"blocks": one_block(), "bookmarks": [{"name":"a","block":0,"offset":0,"junk":1}]}),
            // missing bookmark fields reject
            json!({"blocks": one_block(), "bookmarks": [{"name":"a","block":0}]}),
            // missing bookmarks field is not a schema:3 document
            json!({"blocks": one_block()}),
        ] {
            assert!(e.restore(&wrap(3, document)).is_err());
            assert_eq!(e.snapshot().unwrap(), before, "state untouched");
        }
    }

    #[test]
    fn bookmark_batch_and_import_docx_semantics() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        // batch: bookmark ops compose with text edits in one undo entry
        let r = e
            .apply(Command::new(
                ignition_core::OP_BATCH,
                json!({"commands": [
                    {"op": "addBookmark", "payload": {"name": "b", "pos": {"block": 0, "offset": 1}}},
                    {"op": "insertText", "payload": {"at": {"block": 0, "offset": 0}, "text": "Z"}}
                ]}),
            ))
            .unwrap();
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));
        assert_eq!(bookmark_at(&mut e, "b")["pos"]["offset"], 2);
        assert!(e.undo().unwrap());
        assert!(bookmark_at(&mut e, "b").is_null());
        assert_eq!(text(&mut e), "abc");
        // importDocx replaces the document and clears bookmarks; undo restores
        apply(
            &mut e,
            "addBookmark",
            json!({"name": "b", "pos": {"block": 0, "offset": 0}}),
        );
        let bytes = docx::export_docx(&e.blocks).unwrap();
        apply(
            &mut e,
            "importDocx",
            json!({"bytes_b64": base64_encode(&bytes)}),
        );
        assert_eq!(bookmarks(&mut e).as_array().unwrap().len(), 0);
        assert!(e.undo().unwrap());
        assert_eq!(bookmark_at(&mut e, "b")["pos"]["offset"], 0);
    }

    // -- named styles ---------------------------------------------------------

    fn define(e: &mut QuillEngine, id: &str, kind: &str, properties: Value) {
        apply(
            e,
            "defineStyle",
            json!({"id": id, "name": id, "kind": kind, "properties": properties}),
        );
    }

    fn styles(e: &mut QuillEngine) -> Value {
        apply(e, "listStyles", json!({})).data["styles"].clone()
    }

    fn block_style_id(e: &mut QuillEngine, block: usize) -> Value {
        describe(e)["blocks"][block]["style_id"].clone()
    }

    #[test]
    fn define_update_remove_list_styles_and_validation() {
        let mut e = engine();
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 0);
        define(&mut e, "emph", "character", json!({"italic": true}));
        define(
            &mut e,
            "title",
            "paragraph",
            json!({"bold": true, "font_size": 18.0}),
        );
        let list = styles(&mut e);
        assert_eq!(list.as_array().unwrap().len(), 2);
        // sorted by id: emph before title
        assert_eq!(list[0]["id"], "emph");
        assert_eq!(list[0]["kind"], "character");
        assert_eq!(list[1]["properties"]["font_size"], 18.0);

        // updateStyle replaces named fields only
        apply(
            &mut e,
            "updateStyle",
            json!({"id": "emph", "name": "Emphasis", "properties": {"bold": true}}),
        );
        let list = styles(&mut e);
        assert_eq!(list[0]["name"], "Emphasis");
        assert_eq!(list[0]["properties"], json!({"bold": true}));
        // no-field update is eventless
        let r = apply(&mut e, "updateStyle", json!({"id": "emph"}));
        assert!(r.events.is_empty());

        // validation: dup id, bad kind, bad properties, unknown id
        assert_eq!(
            err(
                &mut e,
                "defineStyle",
                json!({"id": "emph", "name": "x", "kind": "character", "properties": {}}),
            )
            .code,
            ErrorCode::Validation
        );
        assert!(
            err(
                &mut e,
                "defineStyle",
                json!({"id": "s", "name": "x", "kind": "section", "properties": {}}),
            )
            .code
                == ErrorCode::Validation
        );
        assert!(err(
            &mut e,
            "defineStyle",
            json!({"id": "s", "name": "x", "kind": "character", "properties": {"font_size": 99999}}),
        )
        .code
            == ErrorCode::Validation);
        assert!(
            err(
                &mut e,
                "defineStyle",
                json!({"id": " ", "name": "x", "kind": "character", "properties": {}}),
            )
            .code
                == ErrorCode::Validation
        );
        assert!(err(&mut e, "updateStyle", json!({"id": "ghost"})).code == ErrorCode::Validation);
        assert!(err(&mut e, "removeStyle", json!({"id": "ghost"})).code == ErrorCode::Validation);

        // undo chain: remove → update → define ×2 all replay
        apply(&mut e, "removeStyle", json!({"id": "emph"}));
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 2);
        assert!(e.undo().unwrap());
        assert_eq!(styles(&mut e)[0]["name"], "emph");
        assert!(e.undo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 0);
        assert!(e.redo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 1);
    }

    #[test]
    fn apply_named_style_copies_properties_with_precedence() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abcdef");
        // pre-existing italic on "cd"
        apply(
            &mut e,
            "applyStyle",
            json!({"from":{"block":0,"offset":2},"to":{"block":0,"offset":4},"style":{"italic":true}}),
        );
        define(
            &mut e,
            "emph",
            "character",
            json!({"bold": true, "color": "#ff0000"}),
        );
        let r = apply(
            &mut e,
            "applyNamedStyle",
            json!({"style_id": "emph", "from": {"block":0,"offset":1}, "to": {"block":0,"offset":5}}),
        );
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));
        let d = describe(&mut e);
        let inls = d["blocks"][0]["inlines"].as_array().unwrap();
        // runs split at the pre-existing italic boundary: a|b|cd|e|f
        let seg = |t: &str| {
            inls.iter()
                .find(|i| i["text"].as_str() == Some(t))
                .unwrap()
                .clone()
        };
        assert_eq!(seg("a")["style"]["bold"], false);
        assert_eq!(seg("b")["style"]["bold"], true);
        assert_eq!(seg("b")["style"]["color"], "#ff0000");
        assert_eq!(seg("cd")["style"]["italic"], true);
        assert_eq!(seg("cd")["style"]["bold"], true);
        assert_eq!(seg("e")["style"]["bold"], true);
        assert_eq!(seg("f")["style"]["bold"], false);

        // undo restores pre-application inline styles in one step
        assert!(e.undo().unwrap());
        let d = describe(&mut e);
        let inls = d["blocks"][0]["inlines"].as_array().unwrap();
        assert!(inls.iter().all(|i| i["style"]["bold"] != true));
        assert!(e.redo().unwrap());

        // kind mismatch and unknown id reject; state unchanged
        define(&mut e, "hd", "paragraph", json!({"bold": true}));
        let before = e.snapshot().unwrap();
        assert!(err(
            &mut e,
            "applyNamedStyle",
            json!({"style_id": "hd", "from": {"block":0,"offset":0}, "to": {"block":0,"offset":1}}),
        )
        .code
            == ErrorCode::Validation);
        assert!(err(
            &mut e,
            "applyNamedStyle",
            json!({"style_id": "ghost", "from": {"block":0,"offset":0}, "to": {"block":0,"offset":1}}),
        )
        .code
            == ErrorCode::Validation);
        // out-of-bounds range rejects
        assert!(err(
            &mut e,
            "applyNamedStyle",
            json!({"style_id": "emph", "from": {"block":0,"offset":0}, "to": {"block":9,"offset":0}}),
        )
        .code
            == ErrorCode::OutOfBounds);
        // collapsed range is eventless
        let r = apply(
            &mut e,
            "applyNamedStyle",
            json!({"style_id": "emph", "from": {"block":0,"offset":2}, "to": {"block":0,"offset":2}}),
        );
        assert!(r.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn set_block_style_references_and_stamps() {
        let mut e = engine();
        insert(&mut e, 0, 0, "hello");
        apply(&mut e, "insertBlock", json!({"index": 1}));
        insert(&mut e, 1, 0, "world");
        define(
            &mut e,
            "title",
            "paragraph",
            json!({"bold": true, "font_size": 18.0}),
        );
        define(&mut e, "emph", "character", json!({"italic": true}));
        apply(
            &mut e,
            "setBlockStyle",
            json!({"block": 0, "style_id": "title"}),
        );
        assert_eq!(block_style_id(&mut e, 0), "title");
        assert!(block_style_id(&mut e, 1).is_null());
        let d = describe(&mut e);
        assert_eq!(d["blocks"][0]["inlines"][0]["style"]["bold"], true);
        assert_eq!(d["blocks"][0]["inlines"][0]["style"]["font_size"], 18.0);
        assert_eq!(d["blocks"][1]["inlines"][0]["style"]["bold"], false);

        // character style id rejects on setBlockStyle; unknown id rejects
        let before = e.snapshot().unwrap();
        assert!(
            err(
                &mut e,
                "setBlockStyle",
                json!({"block": 0, "style_id": "emph"}),
            )
            .code
                == ErrorCode::Validation
        );
        assert!(
            err(
                &mut e,
                "setBlockStyle",
                json!({"block": 0, "style_id": "ghost"}),
            )
            .code
                == ErrorCode::Validation
        );
        assert!(
            err(
                &mut e,
                "setBlockStyle",
                json!({"block": 9, "style_id": "title"}),
            )
            .code
                == ErrorCode::OutOfBounds
        );
        assert_eq!(e.snapshot().unwrap(), before);

        // split inherits the paragraph reference on both halves; merge keeps head
        apply(
            &mut e,
            "splitBlock",
            json!({"at": {"block": 0, "offset": 2}}),
        );
        assert_eq!(block_style_id(&mut e, 0), "title");
        assert_eq!(block_style_id(&mut e, 1), "title");
        apply(&mut e, "mergeBlock", json!({"index": 1}));
        assert_eq!(block_style_id(&mut e, 0), "title");
        assert_eq!(describe(&mut e)["blocks"].as_array().unwrap().len(), 2);

        // undo/redo of setBlockStyle restores reference and stamped props
        assert!(e.undo().unwrap()); // merge undone
        assert!(e.undo().unwrap()); // split undone
        assert_eq!(block_style_id(&mut e, 0), "title");
        assert!(e.undo().unwrap()); // setBlockStyle undone
        assert!(block_style_id(&mut e, 0).is_null());
        assert_eq!(
            describe(&mut e)["blocks"][0]["inlines"][0]["style"]["bold"],
            false
        );
        assert!(e.redo().unwrap());
        assert_eq!(block_style_id(&mut e, 0), "title");

        // clearing with null drops only the reference, not stamped props
        apply(
            &mut e,
            "setBlockStyle",
            json!({"block": 0, "style_id": null}),
        );
        assert!(block_style_id(&mut e, 0).is_null());
        assert_eq!(
            describe(&mut e)["blocks"][0]["inlines"][0]["style"]["bold"],
            true
        );

        // removeStyle clears dangling block references atomically
        apply(
            &mut e,
            "setBlockStyle",
            json!({"block": 0, "style_id": "title"}),
        );
        apply(&mut e, "removeStyle", json!({"id": "title"}));
        assert!(block_style_id(&mut e, 0).is_null());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 1);
        // undo restores both the definition and the block reference
        assert!(e.undo().unwrap());
        assert_eq!(block_style_id(&mut e, 0), "title");
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 2);
    }

    #[test]
    fn styles_persist_through_snapshot_and_new_clears() {
        let mut e = engine();
        insert(&mut e, 0, 0, "styled");
        define(&mut e, "emph", "character", json!({"italic": true}));
        define(&mut e, "title", "paragraph", json!({"bold": true}));
        apply(
            &mut e,
            "applyNamedStyle",
            json!({"style_id": "emph", "from": {"block":0,"offset":0}, "to": {"block":0,"offset":6}}),
        );
        apply(
            &mut e,
            "setBlockStyle",
            json!({"block": 0, "style_id": "title"}),
        );
        let bytes = e.snapshot().unwrap();
        // schema:3 wrapper now carries styles alongside bookmarks
        let payload = decode_envelope(&bytes).unwrap().1;
        let v: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(v["schema"], 3);
        assert_eq!(v["document"]["styles"].as_array().unwrap().len(), 2);

        let mut re = engine();
        re.restore(&bytes).unwrap();
        assert_eq!(styles(&mut re).as_array().unwrap().len(), 2);
        assert_eq!(block_style_id(&mut re, 0), "title");
        assert_eq!(
            describe(&mut re)["blocks"][0]["inlines"][0]["style"]["italic"],
            true
        );
        // describe/blocks round-trip: snapshot of restored equals original
        assert_eq!(re.snapshot().unwrap(), bytes);

        // `new` clears styles and references; undo restores them
        apply(&mut e, "new", json!({}));
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 0);
        assert!(block_style_id(&mut e, 0).is_null());
        assert!(e.undo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 2);
        assert_eq!(block_style_id(&mut e, 0), "title");
    }

    #[test]
    fn style_snapshot_rejects_hostile_and_future_payloads() {
        let mut e = engine();
        insert(&mut e, 0, 0, "x");
        let before = e.snapshot().unwrap();
        let wrap = |schema: u32, document: Value| {
            encode_envelope(
                serde_json::to_vec(&json!({
                    "kind": "quill", "schema": schema, "document": document
                }))
                .unwrap()
                .as_slice(),
            )
        };
        let one_block = || json!([{"kind":"para","inlines":[{"text":"x","style":{}}]}]);
        let good_style =
            || json!({"id":"s1","name":"S","kind":"character","properties":{"bold":true}});
        // schema:2 carrying styles rejects rather than dropping them
        assert!(e
            .restore(&wrap(
                2,
                json!({"blocks": one_block(), "styles": [good_style()]})
            ))
            .is_err());
        // unwrapped payload with a stray styles key rejects
        let stray = encode_envelope(
            serde_json::to_vec(&json!({
                "blocks": one_block(),
                "styles": [good_style()]
            }))
            .unwrap()
            .as_slice(),
        );
        assert!(e.restore(&stray).is_err());
        // schema:3 hostile style documents reject and leave state untouched
        let styled_block =
            || json!([{"kind":"para","style_id":"s1","inlines":[{"text":"x","style":{}}]}]);
        for document in [
            // duplicate ids
            json!({"blocks": one_block(), "bookmarks": [], "styles": [good_style(), good_style()]}),
            // blank id / control-char name
            json!({"blocks": one_block(), "bookmarks": [], "styles": [
                {"id":" ","name":"S","kind":"character","properties":{}}]}),
            json!({"blocks": one_block(), "bookmarks": [], "styles": [
                {"id":"s2","name":"a\nb","kind":"character","properties":{}}]}),
            // unknown kind
            json!({"blocks": one_block(), "bookmarks": [], "styles": [
                {"id":"s3","name":"S","kind":"section","properties":{}}]}),
            // stray def field (deny_unknown_fields)
            json!({"blocks": one_block(), "bookmarks": [], "styles": [
                {"id":"s4","name":"S","kind":"character","properties":{},"junk":1}]}),
            // invalid properties (font_size out of range)
            json!({"blocks": one_block(), "bookmarks": [], "styles": [
                {"id":"s5","name":"S","kind":"character","properties":{"font_size":99999}}]}),
            // properties not an object
            json!({"blocks": one_block(), "bookmarks": [], "styles": [
                {"id":"s6","name":"S","kind":"character","properties":"bold"}]}),
            // block references unknown style
            json!({"blocks": styled_block(), "bookmarks": [], "styles": []}),
            // block references a character style
            json!({"blocks": styled_block(), "bookmarks": [], "styles": [good_style()]}),
            // over the style cap
            json!({"blocks": one_block(), "bookmarks": [], "styles": (0..257)
                .map(|i| json!({"id":format!("s{i}"),"name":"S","kind":"character","properties":{}}))
                .collect::<Vec<_>>()}),
        ] {
            assert!(e.restore(&wrap(3, document)).is_err());
            assert_eq!(e.snapshot().unwrap(), before, "state untouched");
        }
        // a well-formed schema:3 styles document restores
        let ok = wrap(
            3,
            json!({"blocks": one_block(), "bookmarks": [], "styles": [
                {"id":"s1","name":"S","kind":"paragraph","properties":{"bold":true}}]}),
        );
        e.restore(&ok).unwrap();
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 1);
    }

    #[test]
    fn style_ops_compose_in_batch_and_import_docx_clears() {
        let mut e = engine();
        insert(&mut e, 0, 0, "abc");
        let r = e
            .apply(Command::new(
                ignition_core::OP_BATCH,
                json!({"commands": [
                    {"op": "defineStyle", "payload": {"id": "emph", "name": "Emph", "kind": "character", "properties": {"italic": true}}},
                    {"op": "applyNamedStyle", "payload": {"style_id": "emph", "from": {"block": 0, "offset": 0}, "to": {"block": 0, "offset": 3}}}
                ]}),
            ))
            .unwrap();
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 1);
        assert_eq!(
            describe(&mut e)["blocks"][0]["inlines"][0]["style"]["italic"],
            true
        );
        // one undo entry restores both the definition and the inline style
        assert!(e.undo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 0);
        assert_eq!(
            describe(&mut e)["blocks"][0]["inlines"][0]["style"]["italic"],
            false
        );
        assert!(e.redo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 1);

        // importDocx replaces the document and clears styles; undo restores
        define(&mut e, "para", "paragraph", json!({"bold": true}));
        apply(
            &mut e,
            "setBlockStyle",
            json!({"block": 0, "style_id": "para"}),
        );
        let bytes = docx::export_docx(&e.blocks).unwrap();
        apply(
            &mut e,
            "importDocx",
            json!({"bytes_b64": base64_encode(&bytes)}),
        );
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 0);
        assert!(block_style_id(&mut e, 0).is_null());
        assert!(e.undo().unwrap());
        assert_eq!(styles(&mut e).as_array().unwrap().len(), 2);
        assert_eq!(block_style_id(&mut e, 0), "para");
    }
}
