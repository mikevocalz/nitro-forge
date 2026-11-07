//! Tables (P12 slice 7-A): block-model tables with per-cell paragraph lists.
//!
//! A table is a single block of kind `"table"` in the top-level block stream;
//! its `table` payload holds a dense row-major grid of cells, and each cell
//! holds its own list of paragraph blocks. Because the table is one block,
//! every position-anchored collection (bookmarks `{block,offset}` marks,
//! comment `from`/`to` anchors, section `block` boundaries) keeps working
//! unchanged: a table block has empty inlines, so only offset 0 is a valid
//! position on it, and cell text is unreachable by `Pos` — cell edits go
//! through `setCellText` and never move top-level anchors.
//!
//! Scope is deliberately bounded: insert/delete, cell text replacement, and
//! read ops only. Row/column insert/delete, cell merge, table styling,
//! nested tables, in-cell find/replace, `text`/`layout` cell coverage, and
//! DOCX table import/export are deferred (see docs/ENGINE_OPS.md).
//!
//! Schema: no bump. Every snapshot tier deserializes `Block.kind` through
//! the `BlockKind` enum, so a schema≤3 reader fails closed on the unknown
//! `"table"` variant rather than silently dropping the payload — the same
//! guarantee a schema:4 wrapper would give.

use super::*;
use serde::{Deserialize, Serialize};

/// Table dimension bounds: 1..=64 rows and 1..=26 columns (≤1664 cells).
pub const TABLE_ROWS_MAX: usize = 64;
pub const TABLE_COLS_MAX: usize = 26;
/// Bound on table blocks per document so snapshots stay small.
pub const TABLES_MAX: usize = 256;
/// Paragraph blocks allowed inside one cell.
pub const CELL_BLOCKS_MAX: usize = 64;
/// Paragraph blocks across all cells of all tables in one document.
pub const CELL_BLOCKS_TOTAL_MAX: usize = 65536;
/// `setCellText` payload bound (plain text, `\n` splits paragraphs).
const CELL_TEXT_MAX: usize = 8192;

/// One table cell: an ordered list of plain `para` blocks (never empty,
/// never another kind, never list members, never styled, never carrying a
/// `table` payload — see `validate_tables`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TableCell {
    pub blocks: Vec<Block>,
}

/// The table payload carried by a `kind:"table"` block. `cells` is row-major
/// with exactly `rows * cols` entries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Table {
    pub rows: usize,
    pub cols: usize,
    pub cells: Vec<TableCell>,
}

/// Full table validation for restore and staged op results: the
/// kind/payload invariant, dimension and cell-count bounds, per-cell block
/// limits, the document-wide cell-block budget, and the cell-block rules.
/// A `kind:"table"` block carries nothing but its payload: empty `inlines`
/// (so only offset 0 is a valid `Pos` on it), no `style_id` (`setBlockStyle`
/// rejects tables, so a reference is unreachable by design), and no `list`
/// membership. Cell paragraphs are plain default-style `para` blocks only:
/// `setCellText` builds `Block::empty(Para)` paragraphs and cell blocks are
/// unreachable by `Pos`, so no op can give them another kind, a `style_id`,
/// list membership, or a stray `table` payload — all rejected here because
/// a cell block's own `table` payload would escape `all_blocks` traversal
/// and bypass inline-style and `style_id` validation on restore.
pub fn validate_tables(blocks: &[Block]) -> Result<(), EngineError> {
    let mut tables = 0usize;
    let mut cell_blocks_total = 0usize;
    for b in blocks {
        match (&b.kind, &b.table) {
            (BlockKind::Table, Some(table)) => {
                tables += 1;
                if tables > TABLES_MAX {
                    return Err(EngineError::validation("table limit reached"));
                }
                if !b.inlines.is_empty() {
                    return Err(EngineError::validation(
                        "table blocks must not carry inlines",
                    ));
                }
                if b.style_id.is_some() {
                    return Err(EngineError::validation(
                        "table blocks cannot carry a style_id",
                    ));
                }
                if b.list.is_some() {
                    return Err(EngineError::validation(
                        "table blocks cannot be list members",
                    ));
                }
                validate_table(table, &mut cell_blocks_total)?;
            }
            (BlockKind::Table, None) => {
                return Err(EngineError::validation(
                    "table block is missing its table payload",
                ));
            }
            (_, Some(_)) => {
                return Err(EngineError::validation(
                    "non-table block carries a table payload",
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_table(table: &Table, total: &mut usize) -> Result<(), EngineError> {
    if table.rows == 0
        || table.rows > TABLE_ROWS_MAX
        || table.cols == 0
        || table.cols > TABLE_COLS_MAX
    {
        return Err(EngineError::validation(format!(
            "table dimensions must be 1..={TABLE_ROWS_MAX} rows and 1..={TABLE_COLS_MAX} cols"
        )));
    }
    // rows*cols <= 1664 by the bounds above, so this cannot overflow.
    let expected = table.rows * table.cols;
    if table.cells.len() != expected {
        return Err(EngineError::validation(format!(
            "table has {} cells, expected {expected} ({}x{})",
            table.cells.len(),
            table.rows,
            table.cols
        )));
    }
    for cell in &table.cells {
        if cell.blocks.is_empty() || cell.blocks.len() > CELL_BLOCKS_MAX {
            return Err(EngineError::validation(format!(
                "table cells must contain 1..={CELL_BLOCKS_MAX} blocks"
            )));
        }
        *total += cell.blocks.len();
        if *total > CELL_BLOCKS_TOTAL_MAX {
            return Err(EngineError::validation("table cell block budget exceeded"));
        }
        for cb in &cell.blocks {
            // Cell blocks are strictly plain `para` paragraphs: `setCellText`
            // is the only op that writes them and it only produces `Para`,
            // so headings/quotes/list kinds (with or without list metadata)
            // and nested tables are all unreachable by design.
            if cb.kind != BlockKind::Para {
                return Err(EngineError::validation(
                    "table cells may only contain paragraph blocks",
                ));
            }
            if cb.list.is_some() {
                return Err(EngineError::validation(
                    "list membership inside table cells is not supported",
                ));
            }
            if cb.style_id.is_some() {
                return Err(EngineError::validation(
                    "named styles are not supported inside table cells",
                ));
            }
            // A stray payload on a cell block would hide its inner blocks
            // from `all_blocks`, bypassing inline-style and `style_id`
            // validation on restore.
            if cb.table.is_some() {
                return Err(EngineError::validation(
                    "table cell blocks must not carry a table payload",
                ));
            }
        }
    }
    Ok(())
}

fn table_dim(v: &Value, name: &str, max: usize) -> Result<usize, EngineError> {
    let n = as_usize(v, name)?;
    if n == 0 || n > max {
        return Err(EngineError::validation(format!("'{name}' must be 1..={max}")));
    }
    Ok(n)
}

/// `index` is the documented payload key; `at` is an accepted alias
/// (mirroring `insertBlock`'s position argument).
fn table_index(p: &Value) -> Result<usize, EngineError> {
    for key in ["index", "at"] {
        if let Some(v) = p.get(key) {
            return as_usize(v, key);
        }
    }
    Err(EngineError::invalid("payload missing 'index'"))
}

/// Plain text of a cell: its blocks joined with `\n` (same convention as
/// the `text` op across top-level blocks).
fn cell_text(cell: &TableCell) -> String {
    cell.blocks
        .iter()
        .map(block_text)
        .collect::<Vec<_>>()
        .join("\n")
}

impl QuillEngine {
    /// Resolve `{block}` to the index of a table block.
    fn table_block_index(&self, p: &Value) -> Result<usize, EngineError> {
        let index = as_usize(field(p, "block")?, "block")?;
        match self.blocks.get(index) {
            Some(b) if b.kind == BlockKind::Table => Ok(index),
            Some(_) => Err(EngineError::validation(format!(
                "block {index} is not a table"
            ))),
            None => Err(EngineError::out_of_bounds(format!(
                "block {index} out of range ({} blocks)",
                self.blocks.len()
            ))),
        }
    }

    /// `insertTable {index, rows, cols}` — inserts one `kind:"table"` block
    /// at `index` (0..=block count) whose `rows`x`cols` grid gives every
    /// cell a single empty paragraph. Bounds: rows 1..=64, cols 1..=26,
    /// at most 256 table blocks per document. Anchor remapping is identical
    /// to `insertBlock`: marks and boundaries at or after `index` shift one
    /// block because the table occupies exactly one slot in the stream.
    pub(super) fn op_insert_table(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = table_index(p)?;
        let rows = table_dim(field(p, "rows")?, "rows", TABLE_ROWS_MAX)?;
        let cols = table_dim(field(p, "cols")?, "cols", TABLE_COLS_MAX)?;
        if index > self.blocks.len() {
            return Err(EngineError::out_of_bounds(format!(
                "index {index} out of range ({} blocks)",
                self.blocks.len()
            )));
        }
        if self
            .blocks
            .iter()
            .filter(|b| b.kind == BlockKind::Table)
            .count()
            >= TABLES_MAX
        {
            return Err(EngineError::validation("table limit reached"));
        }
        let cells = (0..rows * cols)
            .map(|_| TableCell {
                blocks: vec![Block::empty(BlockKind::Para)],
            })
            .collect();
        let table = Block {
            kind: BlockKind::Table,
            list: None,
            style_id: None,
            table: Some(Table { rows, cols, cells }),
            inlines: Vec::new(),
        };
        let mut next = self.blocks.clone();
        next.insert(index, table);
        lists::validate(&next)?;
        validate_tables(&next)?;
        let old = std::mem::replace(&mut self.blocks, next);
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        self.remap_bookmarks_insert_block(index);
        self.remap_comments_insert_block(index);
        self.remap_sections_insert_block(index);
        self.record_undo(
            0,
            old,
            self.blocks.clone(),
            Collections::anchors(bookmarks_before, comments_before, sections_before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "block_index": index })))
    }

    /// `deleteTable {block}` — removes the table block entirely. Anchors
    /// behave like a single-block `deleteRange`: bookmarks whose mark sat on
    /// the table block are removed, comment endpoints there collapse to the
    /// deletion point, and a section boundary starting on the table merges
    /// into the previous section (the first section's block-0 boundary
    /// always survives). The document must keep at least one block.
    pub(super) fn op_delete_table(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        if self.blocks.len() == 1 {
            return Err(EngineError::validation(
                "cannot delete the document's only block",
            ));
        }
        // Deletion point for clamped comment endpoints, computed before the
        // splice: the start of the following block, or the end of the
        // previous block when the table is last.
        let clamp = if index + 1 < self.blocks.len() {
            Pos {
                block: index,
                offset: 0,
            }
        } else {
            Pos {
                block: index - 1,
                offset: block_len(&self.blocks[index - 1]),
            }
        };
        let old = self.blocks.remove(index);
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        let sections_before = self.sections.clone();
        // Remaps interpret stored (pre-delete) block indices.
        self.bookmarks.retain(|b| b.block != index);
        for bm in &mut self.bookmarks {
            if bm.block > index {
                bm.block -= 1;
            }
        }
        for c in &mut self.comments {
            for a in [&mut c.from, &mut c.to] {
                if a.block == index {
                    a.block = clamp.block;
                    a.offset = clamp.offset;
                } else if a.block > index {
                    a.block -= 1;
                }
            }
        }
        let mut kept = Vec::with_capacity(self.sections.len());
        for mut s in std::mem::take(&mut self.sections) {
            if s.block == index && index != 0 {
                // Boundary's anchor block deleted: merge into previous.
                continue;
            }
            if s.block > index {
                s.block -= 1;
            }
            kept.push(s);
        }
        self.sections = kept;
        self.record_undo(
            index,
            vec![old],
            Vec::new(),
            Collections::anchors(bookmarks_before, comments_before, sections_before),
        );
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `setCellText {block, row, col, text}` — replaces one cell's block
    /// list with plain paragraphs: `text` splits on `\n` into at most
    /// `CELL_BLOCKS_MAX` `para` blocks of at most `CELL_TEXT_MAX` total
    /// chars, each carrying a single default-style inline (empty text
    /// yields one empty paragraph, so a cell is never empty). Cell content
    /// is unreachable by `Pos`, so top-level anchors cannot move; this is
    /// one undo entry restoring the whole table block.
    pub(super) fn op_set_cell_text(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let row = as_usize(field(p, "row")?, "row")?;
        let col = as_usize(field(p, "col")?, "col")?;
        let text = as_str(field(p, "text")?, "text")?;
        let table = self.blocks[index]
            .table
            .as_ref()
            .expect("table block validated");
        if row >= table.rows || col >= table.cols {
            return Err(EngineError::out_of_bounds(format!(
                "cell ({row},{col}) out of range ({}x{} table)",
                table.rows, table.cols
            )));
        }
        if text.chars().count() > CELL_TEXT_MAX {
            return Err(EngineError::validation(format!(
                "cell text must be at most {CELL_TEXT_MAX} characters"
            )));
        }
        let segments: Vec<&str> = text.split('\n').collect();
        if segments.len() > CELL_BLOCKS_MAX {
            return Err(EngineError::validation(format!(
                "cell text must produce at most {CELL_BLOCKS_MAX} paragraphs"
            )));
        }
        let cell_index = row * table.cols + col;
        let old = self.blocks[index].clone();
        let mut new = old.clone();
        let cell = &mut new.table.as_mut().expect("table block").cells[cell_index];
        cell.blocks = segments
            .iter()
            .map(|seg| {
                let mut b = Block::empty(BlockKind::Para);
                if !seg.is_empty() {
                    b.inlines = vec![Inline {
                        text: seg.to_string(),
                        style: Style::default(),
                    }];
                }
                b
            })
            .collect();
        if new == old {
            return Ok(Self::read_only(json!({ "ok": true })));
        }
        // Re-validate the candidate before committing: a cell may grow to
        // CELL_BLOCKS_MAX blocks, so repeated setCellText calls could push
        // the document-wide cell-block budget past what restore accepts.
        let mut candidate = self.blocks.clone();
        candidate[index] = new.clone();
        validate_tables(&candidate)?;
        self.blocks[index] = new.clone();
        self.record_undo(index, vec![old], vec![new], Collections::default());
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `listTables` — read-only; table blocks in document order.
    pub(super) fn op_list_tables(&self) -> Result<CommandResult, EngineError> {
        let arr: Vec<Value> = self
            .blocks
            .iter()
            .enumerate()
            .filter_map(|(i, b)| {
                b.table.as_ref().map(|t| {
                    json!({ "block": i, "rows": t.rows, "cols": t.cols })
                })
            })
            .collect();
        Ok(Self::read_only(json!({ "tables": arr })))
    }

    /// `describeTable {block}` — read-only; dimensions plus each cell's
    /// plain text as a row-major `cells` grid of strings.
    pub(super) fn op_describe_table(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let table = self.blocks[index].table.as_ref().expect("table block");
        let cells: Vec<Vec<String>> = (0..table.rows)
            .map(|r| {
                (0..table.cols)
                    .map(|c| cell_text(&table.cells[r * table.cols + c]))
                    .collect()
            })
            .collect();
        Ok(Self::read_only(json!({
            "block": index,
            "rows": table.rows,
            "cols": table.cols,
            "cells": cells,
        })))
    }
}

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

    fn insert_table(e: &mut QuillEngine, index: usize, rows: usize, cols: usize) -> CommandResult {
        apply(
            e,
            "insertTable",
            json!({"index": index, "rows": rows, "cols": cols}),
        )
    }

    fn describe_table(e: &mut QuillEngine, block: usize) -> Value {
        apply(e, "describeTable", json!({"block": block})).data
    }

    fn list_tables(e: &mut QuillEngine) -> Value {
        apply(e, "listTables", json!({})).data
    }

    /// Two paragraphs "AA"/"BB" then a 2x2 table at index 2.
    fn fixture() -> QuillEngine {
        let mut e = engine();
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":0},"text":"AA\nBB"}),
        );
        insert_table(&mut e, 2, 2, 2);
        e
    }

    // -- model & ops ---------------------------------------------------------

    #[test]
    fn insert_table_builds_grid_of_empty_paragraphs() {
        let mut e = fixture();
        let d = describe_table(&mut e, 2);
        assert_eq!(d["rows"], 2);
        assert_eq!(d["cols"], 2);
        assert_eq!(
            d["cells"],
            json!([["", ""], ["", ""]])
        );
        let block = &e.blocks[2];
        assert_eq!(block.kind, BlockKind::Table);
        assert_eq!(block.inlines, Vec::<Inline>::new());
        let table = block.table.as_ref().unwrap();
        assert_eq!(table.cells.len(), 4);
        for cell in &table.cells {
            assert_eq!(cell.blocks.len(), 1);
            assert_eq!(cell.blocks[0].kind, BlockKind::Para);
            assert!(cell.blocks[0].inlines.is_empty());
        }
        let lt = list_tables(&mut e);
        assert_eq!(lt["tables"], json!([{"block": 2, "rows": 2, "cols": 2}]));
    }

    #[test]
    fn insert_table_at_ends_and_alias() {
        let mut e = engine();
        let r = insert_table(&mut e, 0, 1, 1);
        assert_eq!(r.data["block_index"], 0);
        assert_eq!(e.blocks.len(), 2);
        // `at` alias works; appending at the end is allowed.
        apply(&mut e, "insertTable", json!({"at": 2, "rows": 1, "cols": 1}));
        assert_eq!(list_tables(&mut e)["tables"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn insert_table_bounds_and_atomic_rejects() {
        let mut e = fixture();
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"index":0,"rows":0,"cols":1}),
            json!({"index":0,"rows":65,"cols":1}),
            json!({"index":0,"rows":1,"cols":0}),
            json!({"index":0,"rows":1,"cols":27}),
            json!({"index":0,"rows":2.5,"cols":1}),
            json!({"index":4,"rows":1,"cols":1}), // only 3 blocks + table = 3? fixture has 3 blocks
            json!({"index":0,"rows":1}),          // missing cols
        ] {
            assert!(e.apply(cmd("insertTable", payload.clone())).is_err(), "{payload}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn set_cell_text_replaces_cell_blocks() {
        let mut e = fixture();
        let r = apply(
            &mut e,
            "setCellText",
            json!({"block":2,"row":1,"col":0,"text":"one\ntwo"}),
        );
        assert_eq!(r.data["ok"], true);
        let d = describe_table(&mut e, 2);
        assert_eq!(d["cells"][1][0], "one\ntwo");
        assert_eq!(d["cells"][0][0], "");
        let cell = &e.blocks[2].table.as_ref().unwrap().cells[2].blocks;
        assert_eq!(cell.len(), 2);
        assert_eq!(block_text(&cell[0]), "one");
        assert_eq!(block_text(&cell[1]), "two");
        // Equal content is eventless.
        let noop = apply(
            &mut e,
            "setCellText",
            json!({"block":2,"row":1,"col":0,"text":"one\ntwo"}),
        );
        assert!(noop.events.is_empty());
        // Empty text resets to a single empty paragraph.
        apply(&mut e, "setCellText", json!({"block":2,"row":0,"col":1,"text":""}));
        assert_eq!(describe_table(&mut e, 2)["cells"][0][1], "");
    }

    #[test]
    fn set_cell_text_bounds_and_atomic_rejects() {
        let mut e = fixture();
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"block":2,"row":2,"col":0,"text":"x"}),
            json!({"block":2,"row":0,"col":2,"text":"x"}),
            json!({"block":0,"row":0,"col":0,"text":"x"}), // not a table
            json!({"block":9,"row":0,"col":0,"text":"x"}),
            json!({"block":2,"row":0,"col":0,"text":"x".repeat(CELL_TEXT_MAX + 1)}),
            json!({"block":2,"row":0,"col":0,"text":"a\n".repeat(CELL_BLOCKS_MAX)}),
        ] {
            assert!(e.apply(cmd("setCellText", payload.clone())).is_err(), "{payload}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn set_cell_text_enforces_document_cell_block_budget() {
        // A max-size table starts at 1664 cell blocks (one empty paragraph
        // per cell); each setCellText can grow a cell to CELL_BLOCKS_MAX
        // blocks, so the op must re-validate the document-wide budget
        // instead of committing a snapshot restore would reject.
        let mut e = engine();
        insert_table(&mut e, 0, TABLE_ROWS_MAX, TABLE_COLS_MAX);
        let initial = TABLE_ROWS_MAX * TABLE_COLS_MAX;
        let headroom = CELL_BLOCKS_TOTAL_MAX - initial;
        let expected = headroom / (CELL_BLOCKS_MAX - 1);
        let mut filled = 0usize;
        let mut rejected = None;
        for cell in 0..initial {
            let payload = json!({
                "block": 0,
                "row": cell / TABLE_COLS_MAX,
                "col": cell % TABLE_COLS_MAX,
                // 64 '\n'-separated segments → 64 paragraph blocks.
                "text": "a\n".repeat(CELL_BLOCKS_MAX - 1),
            });
            match e.apply(cmd("setCellText", payload)) {
                Ok(_) => filled += 1,
                Err(er) => {
                    rejected = Some(er);
                    break;
                }
            }
        }
        let er = rejected.expect("setCellText must eventually hit the cell-block budget");
        assert_eq!(er.code, ErrorCode::Validation);
        assert_eq!(filled, expected);
        // The rejected write changed nothing: the target cell is still
        // empty and the resulting snapshot restores cleanly.
        let d = describe_table(&mut e, 0);
        assert_eq!(d["cells"][filled / TABLE_COLS_MAX][filled % TABLE_COLS_MAX], "");
        let bytes = e.snapshot().unwrap();
        let mut r = engine();
        r.restore(&bytes).unwrap();
    }

    #[test]
    fn delete_table_removes_block() {
        let mut e = fixture();
        let r = apply(&mut e, "deleteTable", json!({"block": 2}));
        assert_eq!(r.data["ok"], true);
        assert_eq!(e.blocks.len(), 2);
        assert_eq!(list_tables(&mut e)["tables"].as_array().unwrap().len(), 0);
        assert!(err(&mut e, "describeTable", json!({"block": 2})).code == ErrorCode::OutOfBounds);
        assert!(err(&mut e, "describeTable", json!({"block": 0})).code == ErrorCode::Validation);
        // Deleting a non-table or missing block rejects.
        assert!(err(&mut e, "deleteTable", json!({"block": 0})).code == ErrorCode::Validation);
        assert!(err(&mut e, "deleteTable", json!({"block": 9})).code == ErrorCode::OutOfBounds);
    }

    #[test]
    fn cannot_delete_the_only_block() {
        // A document whose sole block is a table cannot be emptied.
        let mut one = engine();
        one.blocks = vec![Block {
            kind: BlockKind::Table,
            list: None,
            style_id: None,
            table: Some(Table {
                rows: 1,
                cols: 1,
                cells: vec![TableCell {
                    blocks: vec![Block::empty(BlockKind::Para)],
                }],
            }),
            inlines: Vec::new(),
        }];
        assert!(err(&mut one, "deleteTable", json!({"block": 0})).code == ErrorCode::Validation);
        assert_eq!(one.blocks.len(), 1);
    }

    // -- position stability ---------------------------------------------------

    #[test]
    fn insert_table_shifts_anchors_like_insert_block() {
        let mut e = fixture();
        // Bookmark and comment anchored after the insertion point.
        apply(&mut e, "addBookmark", json!({"name":"bm","pos":{"block":2,"offset":0}}));
        apply(
            &mut e,
            "addComment",
            json!({"id":"c1","from":{"block":0,"offset":0},"to":{"block":2,"offset":0},"body":"note"}),
        );
        apply(&mut e, "insertSection", json!({"at": 1}));
        insert_table(&mut e, 1, 1, 1); // table now at index 1
        let bms = apply(&mut e, "listBookmarks", json!({})).data;
        assert_eq!(bms["bookmarks"][0]["pos"]["block"], 3);
        let comments = apply(&mut e, "listComments", json!({})).data;
        assert_eq!(comments["comments"][0]["to"]["block"], 3);
        let secs = apply(&mut e, "listSections", json!({})).data;
        let blocks: Vec<u64> = secs["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["block"].as_u64().unwrap())
            .collect();
        assert_eq!(blocks, vec![0, 2]);
        // In-cell edits cannot move top-level anchors at all.
        apply(&mut e, "setCellText", json!({"block":1,"row":0,"col":0,"text":"cell"}));
        let bms2 = apply(&mut e, "listBookmarks", json!({})).data;
        assert_eq!(bms2["bookmarks"][0]["pos"]["block"], 3);
    }

    #[test]
    fn delete_table_remaps_anchors() {
        let mut e = fixture();
        apply(&mut e, "insertBlock", json!({"index": 3})); // [AA,BB,T,para]
        apply(&mut e, "addBookmark", json!({"name":"on-table","pos":{"block":2,"offset":0}}));
        apply(&mut e, "addBookmark", json!({"name":"after","pos":{"block":3,"offset":0}}));
        apply(
            &mut e,
            "addComment",
            json!({"id":"c1","from":{"block":2,"offset":0},"to":{"block":2,"offset":0},"body":"x"}),
        );
        apply(&mut e, "insertSection", json!({"at": 2}));
        apply(&mut e, "deleteTable", json!({"block": 2}));
        // The bookmark on the deleted table block is removed; the one after
        // it shifts down; the comment endpoint clamps to the deletion point
        // (start of the block that followed the table, now index 2); the
        // section boundary that started on the table merges away.
        let bms = apply(&mut e, "listBookmarks", json!({})).data;
        let names: Vec<&str> = bms["bookmarks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["after"]);
        assert_eq!(bms["bookmarks"][0]["pos"]["block"], 2);
        let comments = apply(&mut e, "listComments", json!({})).data;
        assert_eq!(comments["comments"][0]["from"], json!({"block":2,"offset":0}));
        let secs = apply(&mut e, "listSections", json!({})).data;
        let blocks: Vec<u64> = secs["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["block"].as_u64().unwrap())
            .collect();
        assert_eq!(blocks, vec![0]);
    }

    #[test]
    fn delete_table_last_block_clamps_comment_to_previous_end() {
        let mut e = fixture();
        apply(
            &mut e,
            "addComment",
            json!({"id":"c1","from":{"block":2,"offset":0},"to":{"block":2,"offset":0},"body":"x"}),
        );
        apply(&mut e, "deleteTable", json!({"block": 2}));
        let comments = apply(&mut e, "listComments", json!({})).data;
        assert_eq!(comments["comments"][0]["from"], json!({"block":1,"offset":2}));
    }

    // -- structural guards ----------------------------------------------------

    #[test]
    fn text_and_structure_ops_reject_table_blocks() {
        let mut e = fixture(); // [AA, BB, table@2]
        // insertText/splitBlock/mergeBlock/setBlockKind on the table reject.
        assert!(err(&mut e, "insertText", json!({"at":{"block":2,"offset":0},"text":"x"})).code == ErrorCode::Validation);
        assert!(err(&mut e, "splitBlock", json!({"at":{"block":2,"offset":0}})).code == ErrorCode::Validation);
        assert!(err(&mut e, "mergeBlock", json!({"index":2})).code == ErrorCode::Validation);
        assert!(err(&mut e, "mergeBlock", json!({"index":3})).code == ErrorCode::OutOfBounds);
        assert!(err(&mut e, "setBlockKind", json!({"block":2,"kind":"para"})).code == ErrorCode::Validation);
        // A collapsed deleteRange on the table is a harmless no-op (the
        // engine's existing collapsed-range path; it does not error).
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":2,"offset":0},"to":{"block":2,"offset":0}}),
        );
        assert_eq!(list_tables(&mut e)["tables"].as_array().unwrap().len(), 1);
        // A deleteRange starting on the table rejects; one spanning it from
        // a normal block deletes it like any other covered block.
        apply(&mut e, "insertBlock", json!({"index": 3})); // [AA,BB,T,para]
        assert!(err(
            &mut e,
            "deleteRange",
            json!({"from":{"block":2,"offset":0},"to":{"block":3,"offset":0}})
        )
        .code == ErrorCode::Validation);
        let mut e2 = fixture();
        apply(
            &mut e2,
            "deleteRange",
            json!({"from":{"block":1,"offset":0},"to":{"block":2,"offset":0}}),
        );
        assert_eq!(list_tables(&mut e2)["tables"].as_array().unwrap().len(), 0);
        // deleteRange leaves the merged survivor: [AA, empty para].
        assert_eq!(block_count(&mut e2), 2);
    }

    fn block_count(e: &mut QuillEngine) -> usize {
        e.blocks.len()
    }

    #[test]
    fn list_ops_cannot_corrupt_table_blocks() {
        let mut e = fixture();
        let before = e.snapshot().unwrap();
        // setListKind over a range containing the table must reject atomically.
        assert!(e
            .apply(cmd(
                "setListKind",
                json!({"first":1,"last":2,"kind":"numbered"})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        // setListKind "none" over the same range is a no-op-safe path? It
        // still rewrites list fields only — table survives.
        let r = apply(&mut e, "setListKind", json!({"first":1,"last":2,"kind":"none"}));
        assert_eq!(r.data["ok"], true);
        assert_eq!(list_tables(&mut e)["tables"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn export_docx_rejects_tables() {
        let mut e = fixture();
        let er = err(&mut e, "exportDocx", json!({}));
        assert_eq!(er.code, ErrorCode::Validation);
    }

    // -- undo/redo ------------------------------------------------------------

    #[test]
    fn table_ops_undo_redo() {
        let mut e = fixture();
        apply(&mut e, "setCellText", json!({"block":2,"row":0,"col":0,"text":"hi"}));
        let full = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(describe_table(&mut e, 2)["cells"][0][0], "");
        assert!(e.undo().unwrap()); // delete? no — undo setCellText then nothing else yet
        // Second undo removes the table insert.
        assert_eq!(e.blocks.len(), 2);
        while e.redo().unwrap() {}
        assert_eq!(e.snapshot().unwrap(), full);
        assert_eq!(describe_table(&mut e, 2)["cells"][0][0], "hi");
        // deleteTable undoes too.
        apply(&mut e, "deleteTable", json!({"block": 2}));
        assert!(e.undo().unwrap());
        assert_eq!(list_tables(&mut e)["tables"].as_array().unwrap().len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(list_tables(&mut e)["tables"].as_array().unwrap().len(), 0);
    }

    // -- snapshots ------------------------------------------------------------

    #[test]
    fn snapshot_round_trip_preserves_tables() {
        let mut e = fixture();
        apply(&mut e, "setCellText", json!({"block":2,"row":1,"col":1,"text":"cell"}));
        apply(&mut e, "addBookmark", json!({"name":"bm","pos":{"block":0,"offset":1}}));
        let bytes = e.snapshot().unwrap();
        let mut r = engine();
        r.restore(&bytes).unwrap();
        assert_eq!(r.blocks, e.blocks);
        assert_eq!(r.snapshot().unwrap(), bytes);
        assert_eq!(describe_table(&mut r, 2)["cells"][1][1], "cell");
    }

    #[test]
    fn hostile_table_snapshots_reject() {
        let e = fixture();
        let bytes = e.snapshot().unwrap();
        let (_fmt, payload) = decode_envelope(&bytes).unwrap();
        let value: Value = serde_json::from_slice(payload).unwrap();
        // The fixture has no v3 features, so the payload may be legacy or
        // schema:2 — locate the blocks array either way.
        let blocks = if value.get("document").is_some() {
            value["document"]["blocks"].clone()
        } else {
            value["blocks"].clone()
        };
        assert_eq!(blocks[2]["kind"], "table");

        let cases: Vec<Value> = vec![
            // cells length mismatch
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"].as_array_mut().unwrap().pop();
                serde_json::to_value(v).unwrap()
            },
            // nested table inside a cell
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"kind":"table","table":{"rows":1,"cols":1,"cells":[{"blocks":[{"kind":"para","inlines":[]}]}]}}));
                serde_json::to_value(v).unwrap()
            },
            // list membership inside a cell
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"][0]["list"] =
                    json!({"level":0,"definition":{"id":1,"kind":"bullet","levels":[]}});
                serde_json::to_value(v).unwrap()
            },
            // table kind without payload
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2].as_object_mut().unwrap().remove("table");
                serde_json::to_value(v).unwrap()
            },
            // payload on a non-table block
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                let t = doc["blocks"][2]["table"].clone();
                doc["blocks"][0]["table"] = t;
                serde_json::to_value(v).unwrap()
            },
            // zero rows
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["rows"] = json!(0);
                serde_json::to_value(v).unwrap()
            },
            // cell paragraph carrying a style_id (no op can set one)
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"][0]["style_id"] =
                    json!("ghost");
                serde_json::to_value(v).unwrap()
            },
            // out-of-range font_size on an inline inside a cell paragraph
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"][0]["inlines"] =
                    json!([{"text":"x","style":{"font_size":2000}}]);
                serde_json::to_value(v).unwrap()
            },
            // stray table payload on a cell paragraph hiding an invalid
            // inline style — the payload's inner blocks escape all_blocks,
            // so only the cell-block payload check can reject this
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"][0]["table"] = json!({
                    "rows":1,"cols":1,
                    "cells":[{"blocks":[{"kind":"para","inlines":[{"text":"x","style":{"font_size":2000}}]}]}]
                });
                serde_json::to_value(v).unwrap()
            },
            // stray (otherwise valid) table payload on a cell paragraph —
            // the kind⇔payload invariant holds inside cells too
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"][0]["table"] = json!({
                    "rows":1,"cols":1,
                    "cells":[{"blocks":[{"kind":"para","inlines":[]}]}]
                });
                serde_json::to_value(v).unwrap()
            },
            // nonempty inlines smuggled onto the table block itself —
            // Pos offsets would become valid and text ops would see them
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["inlines"] = json!([{"text":"smuggled","style":{}}]);
                serde_json::to_value(v).unwrap()
            },
            // style_id on the table block (unknown id — validate_tables
            // rejects before validate_styles even resolves the reference)
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["style_id"] = json!("ghost");
                serde_json::to_value(v).unwrap()
            },
            // cell block with a non-para kind: heading
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"][0]["kind"] = json!("h1");
                serde_json::to_value(v).unwrap()
            },
            // cell block with kind "list" but no list metadata —
            // lists::validate only walks top-level blocks
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][2]["table"]["cells"][0]["blocks"][0]["kind"] = json!("list");
                serde_json::to_value(v).unwrap()
            },
        ];
        for (i, v) in cases.iter().enumerate() {
            let bytes = encode_envelope(&serde_json::to_vec(v).unwrap());
            let mut e2 = engine();
            assert!(e2.restore(&bytes).is_err(), "case {i} must reject");
            assert_eq!(e2.snapshot().unwrap(), engine().snapshot().unwrap());
        }
        // Pre-table readers fail closed: their BlockKind enum lacks the
        // "table" variant, so deserializing the payload's kind strings
        // against the old variant set errors instead of dropping content.
        #[derive(Deserialize)]
        enum OldKind {
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
        assert!(serde_json::from_value::<OldKind>(json!("table")).is_err());
        assert!(serde_json::from_value::<OldKind>(json!("para")).is_ok());
    }

    #[test]
    fn validate_tables_rejects_stray_fields_on_table_block() {
        // `setBlockStyle` rejects table blocks, so `style_id`/`list`/`inlines`
        // on one are unreachable by design. validate_tables must reject them
        // outright — validate_styles alone would happily resolve a
        // style_id that names a real paragraph style.
        let table = || Table {
            rows: 1,
            cols: 1,
            cells: vec![TableCell {
                blocks: vec![Block::empty(BlockKind::Para)],
            }],
        };
        let block = |style_id: Option<&str>, inlines: Vec<Inline>| Block {
            kind: BlockKind::Table,
            list: None,
            style_id: style_id.map(str::to_string),
            table: Some(table()),
            inlines,
        };
        // Baseline: a clean table block validates.
        assert!(validate_tables(&[block(None, Vec::new())]).is_ok());
        // style_id rejects even though nothing here proves it dangles —
        // the reference is unreachable by design, not merely unresolvable.
        assert!(validate_tables(&[block(Some("any-style"), Vec::new())]).is_err());
        // Smuggled inlines would make Pos offsets >0 valid on a table.
        assert!(validate_tables(&[block(
            None,
            vec![Inline {
                text: "x".to_string(),
                style: Style::default(),
            }]
        )])
        .is_err());
        // List membership on a table block (lists::validate also rejects
        // this, but validate_tables stays self-contained for staged calls).
        let mut listed = block(None, Vec::new());
        listed.list = Some(ListItem {
            level: 0,
            definition: std::sync::Arc::new(lists::definition(1, lists::ListKind::Bullet)),
        });
        assert!(validate_tables(&[listed]).is_err());
    }
}
