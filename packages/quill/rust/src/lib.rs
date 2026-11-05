//! quill-engine — rich-text document engine for Nitro-Forge (Quill).
//!
//! Document model: an ordered list of blocks; each block carries a kind and a
//! list of inline runs. Positions are `{block, offset}` where `offset` is a
//! char index into the block's concatenated inline text. Ranges are
//! `{from, to}` with `to` exclusive. See `docs/ENGINE_OPS.md` for the
//! authoritative op contract.

#![forbid(unsafe_code)]

mod docx;

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    saturating_sum, HeapSize, Journal,
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
    #[serde(default)]
    pub inlines: Vec<Inline>,
}

impl Block {
    fn empty(kind: BlockKind) -> Self {
        Self {
            kind,
            inlines: Vec::new(),
        }
    }
}

#[derive(Serialize)]
struct SnapshotRef<'a> {
    blocks: &'a [Block],
}

#[derive(Deserialize)]
struct DocState {
    blocks: Vec<Block>,
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
    v.as_f64().ok_or_else(|| {
        EngineError::invalid(format!("'{name}' must be a number"))
    })
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
    BlockKind::parse(s)
        .ok_or_else(|| EngineError::validation(format!("unknown block kind '{s}'")))
}

/// A partial style: only fields present in the `applyStyle` payload mutate.
#[derive(Default)]
struct StylePatch {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    color: Option<Option<String>>,
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
                *slot = Some(val.as_bool().ok_or_else(|| {
                    EngineError::invalid(format!("style.{name} must be a bool"))
                })?);
            }
            Ok(())
        };
        flag("bold", &mut p.bold)?;
        flag("italic", &mut p.italic)?;
        flag("underline", &mut p.underline)?;
        flag("strike", &mut p.strike)?;
        let opt_str = |name: &str,
                           slot: &mut Option<Option<String>>|
         -> Result<(), EngineError> {
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
        opt_str("link", &mut p.link)?;
        Ok(p)
    }

    fn is_empty(&self) -> bool {
        self.bold.is_none()
            && self.italic.is_none()
            && self.underline.is_none()
            && self.strike.is_none()
            && self.color.is_none()
            && self.link.is_none()
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
        if let Some(v) = &self.color {
            s.color = v.clone();
        }
        if let Some(v) = &self.link {
            s.link = v.clone();
        }
    }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

impl HeapSize for Style {
    fn heap_size(&self) -> usize {
        self.color.heap_size().saturating_add(self.link.heap_size())
    }
}

impl HeapSize for Inline {
    fn heap_size(&self) -> usize {
        self.text.heap_size().saturating_add(self.style.heap_size())
    }
}

impl HeapSize for Block {
    fn heap_size(&self) -> usize {
        self.inlines.heap_size()
    }
}

impl HeapSize for UndoEntry {
    fn heap_size(&self) -> usize {
        self.removed.heap_size().saturating_add(self.inserted.heap_size())
    }
}

pub struct QuillEngine {
    blocks: Vec<Block>,
    journal: Journal<UndoEntry>,
}

impl QuillEngine {
    pub fn new() -> Self {
        Self {
            blocks: vec![Block::empty(BlockKind::Para)],
            journal: Journal::new(JOURNAL_CAPACITY),
        }
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
            return Err(EngineError::validation(
                "range end precedes range start",
            ));
        }
        Ok(())
    }

    fn read_only(data: Value) -> CommandResult {
        CommandResult {
            events: Vec::new(),
            data,
        }
    }

    // -- ops --------------------------------------------------------------

    fn op_new(&mut self) -> Result<CommandResult, EngineError> {
        let old = std::mem::replace(&mut self.blocks, vec![Block::empty(BlockKind::Para)]);
        self.journal.record(UndoEntry {
            index: 0,
            removed: old,
            inserted: self.blocks.clone(),
        });
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_describe(&self) -> Result<CommandResult, EngineError> {
        Ok(Self::read_only(serde_json::to_value(SnapshotRef {
            blocks: &self.blocks,
        })?))
    }

    fn op_insert_text(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let at = parse_pos(field(p, "at")?)?;
        let text = as_str(field(p, "text")?, "text")?.to_string();
        self.check_pos(at)?;
        if text.is_empty() {
            return Ok(CommandResult::data(json!({ "ok": true })));
        }

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
                    inlines: normalize_inlines(std::mem::take(&mut head)),
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
            inlines: normalize_inlines(head),
        });

        let inserted = out.clone();
        self.blocks.splice(at.block..at.block + 1, out);
        self.journal.record(UndoEntry {
            index: at.block,
            removed: vec![old],
            inserted,
        });
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_delete_range(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        self.check_range(from, to)?;
        if from == to {
            return Ok(CommandResult::data(json!({ "deleted_text": "" })));
        }

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
                inlines: normalize_inlines(inlines),
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
                inlines: normalize_inlines(inlines),
            }];
        }

        self.blocks
            .splice(from.block..=to.block, new_span.iter().cloned());
        self.journal.record(UndoEntry {
            index: from.block,
            removed,
            inserted: new_span,
        });
        Ok(CommandResult::data(json!({ "deleted_text": deleted_text })))
    }

    fn op_apply_style(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        let patch = StylePatch::parse(field(p, "style")?)?;
        self.check_range(from, to)?;
        if from == to || patch.is_empty() {
            return Ok(CommandResult::data(json!({ "ok": true })));
        }

        let removed: Vec<Block> = self.blocks[from.block..=to.block].to_vec();
        let mut new_span: Vec<Block> = Vec::with_capacity(removed.len());
        for (i, b) in self.blocks[from.block..=to.block].iter().enumerate() {
            let bi = from.block + i;
            let s = if bi == from.block { from.offset } else { 0 };
            let e = if bi == to.block { to.offset } else { block_len(b) };
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
                inlines: normalize_inlines(inlines),
            });
        }

        self.blocks
            .splice(from.block..=to.block, new_span.iter().cloned());
        self.journal.record(UndoEntry {
            index: from.block,
            removed,
            inserted: new_span,
        });
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
        if b.kind == kind {
            return Ok(CommandResult::data(json!({ "ok": true })));
        }
        let old = b.clone();
        let mut new = old.clone();
        new.kind = kind;
        self.blocks[index] = new.clone();
        self.journal.record(UndoEntry {
            index,
            removed: vec![old],
            inserted: vec![new],
        });
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
        self.blocks.insert(index, Block::empty(kind));
        self.journal.record(UndoEntry {
            index: 0,
            removed: old,
            inserted: self.blocks.clone(),
        });
        Ok(CommandResult::data(json!({ "block_index": index })))
    }

    fn op_split_block(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let at = parse_pos(field(p, "at")?)?;
        self.check_pos(at)?;
        let old = self.blocks[at.block].clone();
        let (head, tail) = split_inlines(&old.inlines, at.offset);
        let new_span = vec![
            Block {
                kind: old.kind,
                inlines: normalize_inlines(head),
            },
            Block {
                kind: old.kind,
                inlines: normalize_inlines(tail),
            },
        ];
        self.blocks
            .splice(at.block..at.block + 1, new_span.iter().cloned());
        self.journal.record(UndoEntry {
            index: at.block,
            removed: vec![old],
            inserted: new_span,
        });
        Ok(CommandResult::data(json!({ "new_block_index": at.block + 1 })))
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
        let removed: Vec<Block> = self.blocks[index - 1..=index].to_vec();
        let mut inlines = self.blocks[index - 1].inlines.clone();
        inlines.extend(self.blocks[index].inlines.iter().cloned());
        let merged = vec![Block {
            kind: self.blocks[index - 1].kind,
            inlines: normalize_inlines(inlines),
        }];
        self.blocks.splice(index - 1..=index, merged.iter().cloned());
        self.journal.record(UndoEntry {
            index: index - 1,
            removed,
            inserted: merged,
        });
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    fn op_text(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let (from, to) = match (p.get("from"), p.get("to")) {
            (None, None) => (None, None),
            (fv, tv) => {
                let from = match fv {
                    Some(v) => parse_pos(v)?,
                    None => Pos { block: 0, offset: 0 },
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
                .map(block_text)
                .collect::<Vec<_>>()
                .join("\n"),
            (Some(from), Some(to)) if from.block == to.block => {
                block_text_slice(&self.blocks[from.block], from.offset, to.offset)
            }
            (Some(from), Some(to)) => {
                let first = &self.blocks[from.block];
                let last = &self.blocks[to.block];
                let mut parts =
                    vec![block_text_slice(first, from.offset, block_len(first))];
                for b in &self.blocks[from.block + 1..to.block] {
                    parts.push(block_text(b));
                }
                parts.push(block_text_slice(last, 0, to.offset));
                parts.join("\n")
            }
            _ => unreachable!(),
        };
        Ok(Self::read_only(json!({ "text": text })))
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

        // Wrap each block greedily into {start,end} char spans.
        let mut pages: Vec<Value> = Vec::new();
        let mut cur_lines: Vec<Value> = Vec::new();
        let mut remaining = page_height;

        for (bi, b) in self.blocks.iter().enumerate() {
            let eff = font_size * b.kind.font_mult();
            let advance = eff * GLYPH_EM;
            let max_chars = (page_width / advance).floor() as usize;
            let max_chars = max_chars.max(1);
            let line_height = eff * LINE_SPACING;

            let spans = wrap_block(&block_text(b), max_chars);
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

    fn op_export_docx(&self) -> Result<CommandResult, EngineError> {
        let bytes = docx::export_docx(&self.blocks)?;
        Ok(Self::read_only(json!({
            "bytes_b64": base64_encode(&bytes)
        })))
    }

    fn op_import_docx(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let b64 = as_str(field(p, "bytes_b64")?, "bytes_b64")?;
        let bytes = base64_decode(b64)?;
        let blocks = docx::import_docx(&bytes)?;
        let old = std::mem::replace(&mut self.blocks, blocks);
        self.journal.record(UndoEntry {
            index: 0,
            removed: old,
            inserted: self.blocks.clone(),
        });
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
    /// Undo entries are inverse diffs, so they are walked directly.
    fn heap_size_estimate(&self) -> usize {
        // The engine itself lives in a host-owned Box.
        saturating_sum([
            std::mem::size_of::<Self>(),
            self.blocks.heap_size(),
            self.journal.reserved_bytes(),
            saturating_sum(self.journal.entries().map(HeapSize::heap_size)),
        ])
    }

    fn kind(&self) -> EngineKind {
        EngineKind::Quill
    }

    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
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
            "applyStyle" => self.op_apply_style(&cmd.payload),
            "setBlockKind" => self.op_set_block_kind(&cmd.payload),
            "insertBlock" => self.op_insert_block(&cmd.payload),
            "splitBlock" => self.op_split_block(&cmd.payload),
            "mergeBlock" => self.op_merge_block(&cmd.payload),
            "text" => self.op_text(&cmd.payload),
            "blocks" => self.op_blocks(),
            "layout" => self.op_layout(&cmd.payload),
            "exportDocx" => self.op_export_docx(),
            "importDocx" => self.op_import_docx(&cmd.payload),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let payload = serde_json::to_vec(&SnapshotRef {
            blocks: &self.blocks,
        })?;
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_fmt, payload) = decode_envelope(data)?;
        let state: DocState = serde_json::from_slice(payload)?;
        let mut blocks = state.blocks;
        if blocks.is_empty() {
            blocks.push(Block::empty(BlockKind::Para));
        }
        self.blocks = blocks;
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

// ---------------------------------------------------------------------------
// Minimal base64 (ignition_core::protocol is crate-private)
// ---------------------------------------------------------------------------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
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
        assert_eq!(
            d["blocks"],
            json!([{ "kind": "para", "inlines": [] }])
        );
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
        let r = apply(
            &mut e,
            "setBlockKind",
            json!({"block": 0, "kind": "h1"}),
        );
        assert_eq!(r.data["ok"], true);
        assert_eq!(describe(&mut e)["blocks"][0]["kind"], "h1");

        let r = apply(
            &mut e,
            "insertBlock",
            json!({"index": 1, "kind": "quote"}),
        );
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
            err(&mut e, "insertText", json!({"at": {"block": 0, "offset": 0}})).code,
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
        apply(
            &mut e,
            "setBlockKind",
            json!({"block": 0, "kind": "h1"}),
        );
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
        assert_eq!(
            describe(&mut e)["blocks"].as_array().unwrap().len(),
            10
        );
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

    // -- DOCX round-trip -----------------------------------------------------

    #[test]
    fn docx_round_trip_preserves_text_kinds_and_flags() {
        let mut e = engine();
        insert(&mut e, 0, 0, "Title Here");
        apply(
            &mut e,
            "setBlockKind",
            json!({"block": 0, "kind": "h1"}),
        );
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
        apply(
            &mut e,
            "setBlockKind",
            json!({"block": 2, "kind": "list"}),
        );
        apply(
            &mut e,
            "insertBlock",
            json!({"index": 3, "kind": "quote"}),
        );
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
        assert_eq!(
            describe(&mut e)["blocks"].as_array().unwrap().len(),
            2
        );
        assert!(e.undo().unwrap());
        assert_eq!(
            describe(&mut e)["blocks"].as_array().unwrap().len(),
            1
        );
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
        apply(
            &mut e,
            "setBlockKind",
            json!({"block": 1, "kind": "h2"}),
        );
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
}
