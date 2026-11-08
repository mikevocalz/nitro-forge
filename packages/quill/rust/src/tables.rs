//! Tables (P12 slices 7-A/7-B): block-model tables with per-cell paragraph lists.
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
//! Scope: insert/delete, row/column insert/delete, cell text replacement,
//! rectangular cell merge/unmerge, and read ops. Slice D added in-cell
//! find/replace coverage (`findText` reports cell-qualified matches and
//! `replaceText` rewrites cell paragraphs) plus `text`/`layout` cell
//! coverage through the `table_text` serialization. Table styling,
//! nested tables, in-cell `changeCase`/`applyStyle` (both are `Pos`
//! anchored and cannot address cells), and DOCX table import/export
//! remain deferred (see docs/ENGINE_OPS.md).
//!
//! Merge model (slice C): `Table.merges` is a registry of rectangular
//! regions `{row,col,rows,cols}` in grid coordinates — the dense
//! row-major `cells` grid stays 1:1 with `rows*cols`. The anchor (top-left)
//! cell keeps its content; every covered cell is reset to the canonical
//! empty paragraph at merge time (Excel semantics: covered content is
//! discarded, `setCellText` rejects covered cells, and unmerge leaves them
//! empty). Merge rects must be in-bounds, cover ≥2 cells, and never
//! overlap; restore validation enforces all of it plus the rule that
//! covered cells are pristine empty paragraphs.
//!
//! Schema: no bump. Every snapshot tier deserializes `Block.kind` through
//! the `BlockKind` enum, so a schema≤3 reader fails closed on the unknown
//! `"table"` variant rather than silently dropping the payload — the same
//! guarantee a schema:4 wrapper would give. `Table.merges` is
//! serde-optional and omitted when empty, so merge-free snapshots stay
//! byte-identical; a slice-A/B reader's `deny_unknown_fields` `Table`
//! fails closed only on snapshots that actually carry merges — the same
//! precedent as `comments`/`sections` on the schema:3 document state.

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

/// One merged region: the rectangle of grid cells anchored at
/// (`row`,`col`) extending `rows`x`cols`. The anchor cell keeps its
/// content; all other cells in the rect are covered (canonical empty
/// paragraphs, unwritable via `setCellText`). At least 2 cells per rect
/// and no two rects may overlap — both enforced by `validate_table`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TableMerge {
    pub row: usize,
    pub col: usize,
    pub rows: usize,
    pub cols: usize,
}

/// The table payload carried by a `kind:"table"` block. `cells` is row-major
/// with exactly `rows * cols` entries; `merges` lists the merged regions
/// (empty for an unmerged table and omitted from snapshots then).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Table {
    pub rows: usize,
    pub cols: usize,
    pub cells: Vec<TableCell>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merges: Vec<TableMerge>,
}

/// Full table validation for restore and staged op results: the
/// kind/payload invariant, dimension and cell-count bounds, per-cell block
/// limits, the document-wide cell-block budget, and the cell-block rules.
/// A `kind:"table"` block carries nothing but its payload: empty `inlines`
/// (so only offset 0 is a valid `Pos` on it), no `style_id` (`setBlockStyle`
/// rejects tables, so a reference is unreachable by design), and no `list`
/// membership. Cell paragraphs are strict `para` blocks with no `style_id`,
/// `list` or stray `table` payload; their inlines get the same restore
/// validation as top-level inlines (`setCellText` only ever writes
/// default-style text and no op can reach inside a cell):
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
    // Merge registry: every rect is in-bounds, covers at least 2 cells,
    // and no two rects overlap (a second rect touching any cell of an
    // earlier one — anchor included — rejects). Covered cells must be
    // pristine empty paragraphs: `mergeTableCells` resets them and
    // `setCellText` rejects covered cells, so content there is
    // unreachable by ops and only a hostile snapshot could smuggle it in.
    let mut covered = vec![false; expected];
    for m in &table.merges {
        if m.rows == 0
            || m.cols == 0
            || m.rows.saturating_mul(m.cols) < 2
            || m.row >= table.rows
            || m.col >= table.cols
            || m.row.saturating_add(m.rows) > table.rows
            || m.col.saturating_add(m.cols) > table.cols
        {
            return Err(EngineError::validation(
                "table merges must be in-bounds rectangles of at least 2 cells",
            ));
        }
        for r in m.row..m.row + m.rows {
            for c in m.col..m.col + m.cols {
                let i = r * table.cols + c;
                if covered[i] {
                    return Err(EngineError::validation("overlapping table merges"));
                }
                covered[i] = true;
                if !(r == m.row && c == m.col) {
                    let cell = &table.cells[i];
                    if cell.blocks.len() != 1
                        || cell.blocks[0].kind != BlockKind::Para
                        || !cell.blocks[0].inlines.is_empty()
                    {
                        return Err(EngineError::validation(
                            "cells covered by a table merge must be empty",
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Whether grid cell (`row`,`col`) lies inside merge rect `m` — anchor
/// and covered cells alike.
fn merge_covers(m: &TableMerge, row: usize, col: usize) -> bool {
    row >= m.row && row < m.row + m.rows && col >= m.col && col < m.col + m.cols
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

/// Row/column structural-op position: the documented `row`/`col` key, with
/// `index`/`at` accepted as aliases (mirroring `insertTable`'s `index`/`at`
/// pair). Precedence when several spellings appear: canonical `row`/`col`,
/// then `index`, then `at`; a missing position rejects.
fn table_axis_position(p: &Value, key: &str) -> Result<usize, EngineError> {
    if let Some(v) = p.get(key) {
        return as_usize(v, key);
    }
    for alias in ["index", "at"] {
        if let Some(v) = p.get(alias) {
            return as_usize(v, alias);
        }
    }
    Err(EngineError::invalid(format!("payload missing '{key}'")))
}

/// One grid point for the merge ops: canonical flat
/// `{prefix}_row`/`{prefix}_col` keys, or a `{prefix}: {row, col}` object
/// alias (the shape the TypeScript wrapper sends).
fn cell_point(p: &Value, prefix: &str) -> Result<(usize, usize), EngineError> {
    if let Some(v) = p.get(prefix) {
        if v.is_object() {
            return Ok((
                as_usize(field(v, "row")?, "row")?,
                as_usize(field(v, "col")?, "col")?,
            ));
        }
    }
    let row_key = format!("{prefix}_row");
    let col_key = format!("{prefix}_col");
    Ok((
        as_usize(field(p, &row_key)?, &row_key)?,
        as_usize(field(p, &col_key)?, &col_key)?,
    ))
}

/// One cell in the shape `setCellText` produces for empty content: a
/// single empty `para` block.
fn empty_cell() -> TableCell {
    TableCell {
        blocks: vec![Block::empty(BlockKind::Para)],
    }
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

/// Serialized plain text of a whole table for the `text`/`layout` ops:
/// rows joined by `'\n'`, cells within a row `'\t'`-separated, each
/// cell's own paragraphs `'\n'`-joined via `cell_text` — so a
/// multi-paragraph cell is indistinguishable from extra row breaks in
/// the flat serialization (documented in docs/ENGINE_OPS.md). Covered
/// merge cells contribute their empty text like every other read.
pub(super) fn table_text(table: &Table) -> String {
    (0..table.rows)
        .map(|r| {
            (0..table.cols)
                .map(|c| cell_text(&table.cells[r * table.cols + c]))
                .collect::<Vec<_>>()
                .join("\t")
        })
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
        let cells = (0..rows * cols).map(|_| empty_cell()).collect();
        let table = Block {
            kind: BlockKind::Table,
            list: None,
            style_id: None,
            table: Some(Table {
                rows,
                cols,
                cells,
                merges: Vec::new(),
            }),
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
        let revisions_before = self.revisions.clone();
        self.remap_bookmarks_insert_block(index);
        self.remap_comments_insert_block(index);
        self.remap_sections_insert_block(index);
        self.remap_revisions_insert_block(index);
        self.record_undo(
            0,
            old,
            self.blocks.clone(),
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
            ),
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
        let revisions_before = self.revisions.clone();
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
        // Revision anchors behave like comment endpoints: a mark on the
        // deleted table block clamps to the deletion point, later anchors
        // shift down one.
        for r in &mut self.revisions {
            for a in [&mut r.from, &mut r.to] {
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
            Collections::anchors(
                bookmarks_before,
                comments_before,
                sections_before,
                revisions_before,
            ),
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
        // Covered cells are hidden inside a merged region; only the
        // anchor cell carries the region's content.
        if table
            .merges
            .iter()
            .any(|m| merge_covers(m, row, col) && (m.row != row || m.col != col))
        {
            return Err(EngineError::validation(
                "cell is covered by a merged region; edit its anchor cell",
            ));
        }
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

    /// Commit a rebuilt `Table` onto block `index`: stage the new block on
    /// a candidate block list, run the same `validate_tables` gate restore
    /// uses (dimension/cell-count bounds plus the document-wide cell-block
    /// budget), then splice it in and record one block-splice undo entry.
    /// The table stays a single top-level block, so no anchor collection
    /// can move and none is remapped — identical to `setCellText`.
    fn commit_table(&mut self, index: usize, new_table: Table) -> Result<(), EngineError> {
        let old = self.blocks[index].clone();
        let mut new = old.clone();
        new.table = Some(new_table);
        let mut candidate = self.blocks.clone();
        candidate[index] = new.clone();
        validate_tables(&candidate)?;
        self.blocks[index] = new.clone();
        self.record_undo(index, vec![old], vec![new], Collections::default());
        Ok(())
    }

    /// `insertTableRow {block,row}` — inserts one row of `cols` fresh
    /// cells (one empty paragraph each, the `setCellText` empty shape)
    /// before row `row` (0..=rows; `rows` appends). `index`/`at` are
    /// accepted aliases for `row`. Bounds: the table must stay within
    /// `TABLE_ROWS_MAX`; new cell blocks count against the document-wide
    /// cell-block budget via the staged `validate_tables` call.
    pub(super) fn op_insert_table_row(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let pos = table_axis_position(p, "row")?;
        let table = self.blocks[index]
            .table
            .as_ref()
            .expect("table block validated");
        if table.rows >= TABLE_ROWS_MAX {
            return Err(EngineError::validation("table row limit reached"));
        }
        if pos > table.rows {
            return Err(EngineError::out_of_bounds(format!(
                "row index {pos} out of range ({} rows)",
                table.rows
            )));
        }
        // Merge interaction: a merge wholly at/below the insertion point
        // shifts down one row; an insertion strictly inside a merge's row
        // span would cut the region, so it rejects. Inserting exactly at
        // the merge's top edge or just past its bottom edge is clean.
        let mut merges = table.merges.clone();
        for m in &mut merges {
            if m.row >= pos {
                m.row += 1;
            } else if pos < m.row + m.rows {
                return Err(EngineError::validation(
                    "cannot insert a row through a merged region",
                ));
            }
        }
        let (rows, cols) = (table.rows, table.cols);
        let mut cells = Vec::with_capacity((rows + 1) * cols);
        cells.extend_from_slice(&table.cells[..pos * cols]);
        cells.extend((0..cols).map(|_| empty_cell()));
        cells.extend_from_slice(&table.cells[pos * cols..]);
        self.commit_table(
            index,
            Table {
                rows: rows + 1,
                cols,
                cells,
                merges,
            },
        )?;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `deleteTableRow {block,row}` — removes row `row` and its `cols`
    /// cells. The table must keep at least one row; `row` out of range
    /// rejects. Deleting a row discards its cell content — content ops
    /// are destructive by contract.
    pub(super) fn op_delete_table_row(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let pos = table_axis_position(p, "row")?;
        let table = self.blocks[index]
            .table
            .as_ref()
            .expect("table block validated");
        if pos >= table.rows {
            return Err(EngineError::out_of_bounds(format!(
                "row {pos} out of range ({} rows)",
                table.rows
            )));
        }
        if table.rows == 1 {
            return Err(EngineError::validation(
                "table must keep at least one row",
            ));
        }
        // Merge interaction: deleting a row a merge covers would cut the
        // region, so it rejects; merges wholly below the deleted row
        // shift up one (merges wholly above are untouched — no merge can
        // span the deleted row without covering it).
        let mut merges = Vec::with_capacity(table.merges.len());
        for m in &table.merges {
            if m.row <= pos && pos < m.row + m.rows {
                return Err(EngineError::validation(
                    "cannot delete a row through a merged region",
                ));
            }
            let mut m = m.clone();
            if m.row > pos {
                m.row -= 1;
            }
            merges.push(m);
        }
        let (rows, cols) = (table.rows, table.cols);
        let mut cells = Vec::with_capacity((rows - 1) * cols);
        cells.extend_from_slice(&table.cells[..pos * cols]);
        cells.extend_from_slice(&table.cells[(pos + 1) * cols..]);
        self.commit_table(
            index,
            Table {
                rows: rows - 1,
                cols,
                cells,
                merges,
            },
        )?;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `insertTableColumn {block,col}` — inserts one column of `rows`
    /// fresh cells before column `col` (0..=cols; `cols` appends).
    /// `index`/`at` are accepted aliases for `col`. Bounds mirror
    /// `insertTableRow`: `TABLE_COLS_MAX` cap plus the cell-block budget.
    pub(super) fn op_insert_table_column(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let pos = table_axis_position(p, "col")?;
        let table = self.blocks[index]
            .table
            .as_ref()
            .expect("table block validated");
        if table.cols >= TABLE_COLS_MAX {
            return Err(EngineError::validation("table column limit reached"));
        }
        if pos > table.cols {
            return Err(EngineError::out_of_bounds(format!(
                "column index {pos} out of range ({} cols)",
                table.cols
            )));
        }
        // Merge interaction mirrors insertTableRow on the column axis.
        let mut merges = table.merges.clone();
        for m in &mut merges {
            if m.col >= pos {
                m.col += 1;
            } else if pos < m.col + m.cols {
                return Err(EngineError::validation(
                    "cannot insert a column through a merged region",
                ));
            }
        }
        let (rows, cols) = (table.rows, table.cols);
        let mut cells = Vec::with_capacity(rows * (cols + 1));
        for r in 0..rows {
            let row = &table.cells[r * cols..(r + 1) * cols];
            cells.extend_from_slice(&row[..pos]);
            cells.push(empty_cell());
            cells.extend_from_slice(&row[pos..]);
        }
        self.commit_table(
            index,
            Table {
                rows,
                cols: cols + 1,
                cells,
                merges,
            },
        )?;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `deleteTableColumn {block,col}` — removes column `col` and its
    /// `rows` cells. The table must keep at least one column; `col` out
    /// of range rejects. Cell content in the column is discarded.
    pub(super) fn op_delete_table_column(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let pos = table_axis_position(p, "col")?;
        let table = self.blocks[index]
            .table
            .as_ref()
            .expect("table block validated");
        if pos >= table.cols {
            return Err(EngineError::out_of_bounds(format!(
                "column {pos} out of range ({} cols)",
                table.cols
            )));
        }
        if table.cols == 1 {
            return Err(EngineError::validation(
                "table must keep at least one column",
            ));
        }
        // Merge interaction mirrors deleteTableRow on the column axis.
        let mut merges = Vec::with_capacity(table.merges.len());
        for m in &table.merges {
            if m.col <= pos && pos < m.col + m.cols {
                return Err(EngineError::validation(
                    "cannot delete a column through a merged region",
                ));
            }
            let mut m = m.clone();
            if m.col > pos {
                m.col -= 1;
            }
            merges.push(m);
        }
        let (rows, cols) = (table.rows, table.cols);
        let mut cells = Vec::with_capacity(rows * (cols - 1));
        for r in 0..rows {
            let row = &table.cells[r * cols..(r + 1) * cols];
            cells.extend_from_slice(&row[..pos]);
            cells.extend_from_slice(&row[pos + 1..]);
        }
        self.commit_table(
            index,
            Table {
                rows,
                cols: cols - 1,
                cells,
                merges,
            },
        )?;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `mergeTableCells {block, from, to}` — merges the rectangular region
    /// between two grid points (either order; the top-left cell is the
    /// anchor and keeps its content). `from`/`to` are `{row,col}` objects
    /// or flat `from_row`/`from_col`/`to_row`/`to_col` keys. The region
    /// must cover at least 2 cells, stay in bounds, and not overlap an
    /// existing merge; every covered cell is reset to the canonical empty
    /// paragraph (covered content is discarded, matching spreadsheet
    /// merge semantics — undo restores it). One undo entry via
    /// `commit_table`.
    pub(super) fn op_merge_table_cells(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let (fr, fc) = cell_point(p, "from")?;
        let (tr, tc) = cell_point(p, "to")?;
        let table = self.blocks[index]
            .table
            .as_ref()
            .expect("table block validated");
        for (r, c) in [(fr, fc), (tr, tc)] {
            if r >= table.rows || c >= table.cols {
                return Err(EngineError::out_of_bounds(format!(
                    "cell ({r},{c}) out of range ({}x{} table)",
                    table.rows, table.cols
                )));
            }
        }
        let (r1, c1) = (fr.min(tr), fc.min(tc));
        let (r2, c2) = (fr.max(tr), fc.max(tc));
        if r1 == r2 && c1 == c2 {
            return Err(EngineError::validation(
                "merge must cover at least 2 cells",
            ));
        }
        let mut new_table = table.clone();
        let cols = new_table.cols;
        for r in r1..=r2 {
            for c in c1..=c2 {
                if r == r1 && c == c1 {
                    continue;
                }
                new_table.cells[r * cols + c] = empty_cell();
            }
        }
        new_table.merges.push(TableMerge {
            row: r1,
            col: c1,
            rows: r2 - r1 + 1,
            cols: c2 - c1 + 1,
        });
        // Overlap/bounds of the new rect is enforced by the staged
        // validate_tables call inside commit_table — a rejected merge
        // leaves the document untouched.
        self.commit_table(index, new_table)?;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `unmergeTableCells {block,row,col}` — removes the merge whose
    /// region contains cell (`row`,`col`) (anchor or covered; either
    /// identifies the region). Covered cells were reset to empty
    /// paragraphs at merge time, so unmerge restores them as ordinary
    /// empty cells; the anchor keeps its content. Rejects when the cell
    /// is not part of a merged region.
    pub(super) fn op_unmerge_table_cells(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let index = self.table_block_index(p)?;
        let row = as_usize(field(p, "row")?, "row")?;
        let col = as_usize(field(p, "col")?, "col")?;
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
        let Some(mi) = table
            .merges
            .iter()
            .position(|m| merge_covers(m, row, col))
        else {
            return Err(EngineError::validation(
                "cell is not part of a merged region",
            ));
        };
        let mut new_table = table.clone();
        new_table.merges.remove(mi);
        self.commit_table(index, new_table)?;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `listTables` — read-only; table blocks in document order, each
    /// with its merge registry so hosts can render spans without a
    /// second call.
    pub(super) fn op_list_tables(&self) -> Result<CommandResult, EngineError> {
        let arr: Vec<Value> = self
            .blocks
            .iter()
            .enumerate()
            .filter_map(|(i, b)| {
                b.table.as_ref().map(|t| {
                    json!({
                        "block": i,
                        "rows": t.rows,
                        "cols": t.cols,
                        "merges": t.merges,
                    })
                })
            })
            .collect();
        Ok(Self::read_only(json!({ "tables": arr })))
    }

    /// `describeTable {block}` — read-only; dimensions, the merge
    /// registry, and each cell's plain text as a row-major `cells` grid
    /// of strings (covered cells report their empty text).
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
            "merges": table.merges,
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
        assert_eq!(
            lt["tables"],
            json!([{"block": 2, "rows": 2, "cols": 2, "merges": []}])
        );
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
                merges: Vec::new(),
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
            merges: Vec::new(),
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

    // -- row/column structural ops (slice B) ---------------------------------

    #[test]
    fn insert_table_row_shifts_cells_and_appends() {
        let mut e = fixture(); // 2x2 table at block 2
        apply(&mut e, "setCellText", json!({"block":2,"row":0,"col":1,"text":"keep"}));
        // Insert before row 0: existing content shifts down one row.
        apply(&mut e, "insertTableRow", json!({"block":2,"row":0}));
        let d = describe_table(&mut e, 2);
        assert_eq!(d["rows"], 3);
        assert_eq!(d["cols"], 2);
        assert_eq!(d["cells"], json!([["",""],["","keep"],["",""]]));
        // `index` alias works and appends after the last row when equal.
        apply(&mut e, "insertTableRow", json!({"block":2,"index":3}));
        let d = describe_table(&mut e, 2);
        assert_eq!(d["rows"], 4);
        assert_eq!(d["cells"][3], json!(["",""]));
        // New cells are strict empty paragraphs.
        let cell = &e.blocks[2].table.as_ref().unwrap().cells[0];
        assert_eq!(cell.blocks.len(), 1);
        assert_eq!(cell.blocks[0].kind, BlockKind::Para);
        assert!(cell.blocks[0].inlines.is_empty());
    }

    #[test]
    fn delete_table_row_removes_cells_and_content() {
        let mut e = fixture();
        apply(&mut e, "setCellText", json!({"block":2,"row":1,"col":1,"text":"gone"}));
        apply(&mut e, "deleteTableRow", json!({"block":2,"row":1}));
        let d = describe_table(&mut e, 2);
        assert_eq!(d["rows"], 1);
        assert_eq!(d["cells"], json!([["",""]]));
        assert_eq!(e.blocks[2].table.as_ref().unwrap().cells.len(), 2);
    }

    #[test]
    fn row_ops_bounds_min_dims_and_atomic_rejects() {
        let mut e = fixture();
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"block":2,"row":3}),   // past the append position (rows=2)
            json!({"block":0,"row":0}),   // not a table
            json!({"block":9,"row":0}),
            json!({"block":2}),           // missing position
            json!({"block":2,"row":"x"}),
        ] {
            assert!(e.apply(cmd("insertTableRow", payload.clone())).is_err(), "{payload}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // When both spellings appear the documented `row` key wins.
        apply(&mut e, "insertTableRow", json!({"block":2,"row":2,"index":0}));
        assert_eq!(describe_table(&mut e, 2)["rows"], 3);
        // deleteTableRow bounds: row 3 out of range on the now-3-row table.
        assert!(err(&mut e, "deleteTableRow", json!({"block":2,"row":3})).code == ErrorCode::OutOfBounds);
        // Min dims: deleting the last row or last column rejects. A 1x2
        // table may lose one column (leaving 1x1) but never its last row.
        let mut one = engine();
        insert_table(&mut one, 0, 1, 2);
        let before1 = one.snapshot().unwrap();
        assert!(err(&mut one, "deleteTableRow", json!({"block":0,"row":0})).code == ErrorCode::Validation);
        assert_eq!(one.snapshot().unwrap(), before1);
        apply(&mut one, "deleteTableColumn", json!({"block":0,"col":0}));
        assert_eq!(describe_table(&mut one, 0)["cols"], 1);
        let after_delete = one.snapshot().unwrap();
        assert!(err(&mut one, "deleteTableColumn", json!({"block":0,"col":0})).code == ErrorCode::Validation);
        assert!(err(&mut one, "deleteTableRow", json!({"block":0,"row":0})).code == ErrorCode::Validation);
        assert_eq!(one.snapshot().unwrap(), after_delete);
        // Dimension caps.
        let mut maxed = engine();
        insert_table(&mut maxed, 0, TABLE_ROWS_MAX, 1);
        let before2 = maxed.snapshot().unwrap();
        assert!(err(&mut maxed, "insertTableRow", json!({"block":0,"row":64})).code == ErrorCode::Validation);
        assert_eq!(maxed.snapshot().unwrap(), before2);
        let mut maxedc = engine();
        insert_table(&mut maxedc, 0, 1, TABLE_COLS_MAX);
        assert!(err(&mut maxedc, "insertTableColumn", json!({"block":0,"col":26})).code == ErrorCode::Validation);
    }

    #[test]
    fn insert_table_column_shifts_cells_per_row() {
        let mut e = fixture();
        apply(&mut e, "setCellText", json!({"block":2,"row":0,"col":1,"text":"right"}));
        apply(&mut e, "setCellText", json!({"block":2,"row":1,"col":0,"text":"bl"}));
        // Insert before column 1: column 1 content moves to column 2.
        apply(&mut e, "insertTableColumn", json!({"block":2,"col":1}));
        let d = describe_table(&mut e, 2);
        assert_eq!(d["rows"], 2);
        assert_eq!(d["cols"], 3);
        assert_eq!(d["cells"], json!([["","","right"],["bl","",""]]));
        // Append at cols; `at` alias.
        apply(&mut e, "insertTableColumn", json!({"block":2,"at":3}));
        assert_eq!(describe_table(&mut e, 2)["cols"], 4);
    }

    #[test]
    fn delete_table_column_removes_cells_and_content() {
        let mut e = fixture();
        apply(&mut e, "setCellText", json!({"block":2,"row":0,"col":0,"text":"gone"}));
        apply(&mut e, "setCellText", json!({"block":2,"row":1,"col":1,"text":"stay"}));
        apply(&mut e, "deleteTableColumn", json!({"block":2,"col":0}));
        let d = describe_table(&mut e, 2);
        assert_eq!(d["cols"], 1);
        assert_eq!(d["cells"], json!([[""],["stay"]]));
        assert!(err(&mut e, "deleteTableColumn", json!({"block":2,"col":1})).code == ErrorCode::OutOfBounds);
    }

    #[test]
    fn row_column_ops_enforce_cell_block_budget() {
        // Nearly saturate the document-wide cell-block budget, then a row
        // insert that would overflow must reject atomically. A 60x26 table
        // (below the 64-row cap so inserts stay legal) with 1015 cells at
        // the 64-block cap totals 65505 blocks; one row insert (+26) fits,
        // the second overflows 65536.
        let mut e = engine();
        let mut cells = Vec::with_capacity(60 * TABLE_COLS_MAX);
        for i in 0..60 * TABLE_COLS_MAX {
            let n = if i < 1015 { CELL_BLOCKS_MAX } else { 1 };
            cells.push(TableCell {
                blocks: vec![Block::empty(BlockKind::Para); n],
            });
        }
        e.blocks = vec![Block {
            kind: BlockKind::Table,
            list: None,
            style_id: None,
            table: Some(Table {
                rows: 60,
                cols: TABLE_COLS_MAX,
                cells,
                merges: Vec::new(),
            }),
            inlines: Vec::new(),
        }];
        apply(&mut e, "insertTableRow", json!({"block":0,"row":60}));
        let before = e.snapshot().unwrap();
        let er = err(&mut e, "insertTableRow", json!({"block":0,"row":61}));
        assert_eq!(er.code, ErrorCode::Validation);
        assert_eq!(e.snapshot().unwrap(), before);
        // The rejected write changed nothing: the snapshot still restores.
        let mut r = engine();
        r.restore(&before).unwrap();
    }

    #[test]
    fn row_column_ops_undo_redo_and_snapshot() {
        let mut e = fixture();
        apply(&mut e, "setCellText", json!({"block":2,"row":0,"col":0,"text":"hi"}));
        apply(&mut e, "insertTableRow", json!({"block":2,"row":0}));
        apply(&mut e, "insertTableColumn", json!({"block":2,"col":0}));
        let full = e.snapshot().unwrap();
        assert_eq!(describe_table(&mut e, 2)["cells"][1][1], "hi");
        // Three undos: column, row, setCellText — table back to 2x2 empty.
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert_eq!(describe_table(&mut e, 2)["rows"], 2);
        assert_eq!(describe_table(&mut e, 2)["cells"][0][0], "");
        while e.redo().unwrap() {}
        assert_eq!(e.snapshot().unwrap(), full);
        assert_eq!(describe_table(&mut e, 2)["cells"][1][1], "hi");
        // Deletes undo too: row then column removal restores content.
        apply(&mut e, "deleteTableRow", json!({"block":2,"row":0}));
        assert!(e.undo().unwrap());
        assert_eq!(describe_table(&mut e, 2)["rows"], 3);
        // Snapshot round-trip preserves the rebuilt grid.
        let bytes = e.snapshot().unwrap();
        let mut r = engine();
        r.restore(&bytes).unwrap();
        assert_eq!(r.snapshot().unwrap(), bytes);
        assert_eq!(describe_table(&mut r, 2)["cells"][1][1], "hi");
    }

    #[test]
    fn row_column_ops_do_not_move_anchors() {
        // Structural row/col edits keep the table a single block, so
        // bookmarks/comments/sections anchored on or after it never move.
        let mut e = fixture();
        apply(&mut e, "insertBlock", json!({"index": 3})); // [AA,BB,T,para]
        apply(&mut e, "addBookmark", json!({"name":"bm","pos":{"block":3,"offset":0}}));
        apply(&mut e, "insertTableRow", json!({"block":2,"row":0}));
        apply(&mut e, "deleteTableColumn", json!({"block":2,"col":1}));
        let bms = apply(&mut e, "listBookmarks", json!({})).data;
        assert_eq!(bms["bookmarks"][0]["pos"]["block"], 3);
        assert_eq!(describe_table(&mut e, 2)["rows"], 3);
        assert_eq!(describe_table(&mut e, 2)["cols"], 1);
    }

    // -- cell merge/unmerge (slice C) ----------------------------------------

    fn merge_cells(
        e: &mut QuillEngine,
        block: usize,
        from: (usize, usize),
        to: (usize, usize),
    ) -> CommandResult {
        apply(
            e,
            "mergeTableCells",
            json!({
                "block": block,
                "from": {"row": from.0, "col": from.1},
                "to": {"row": to.0, "col": to.1},
            }),
        )
    }

    fn unmerge_cell(e: &mut QuillEngine, block: usize, row: usize, col: usize) -> CommandResult {
        apply(
            e,
            "unmergeTableCells",
            json!({"block": block, "row": row, "col": col}),
        )
    }

    /// A 3x3 table at block 0 with distinct text in every cell.
    fn merged_fixture() -> QuillEngine {
        let mut e = engine();
        insert_table(&mut e, 0, 3, 3);
        for r in 0..3 {
            for c in 0..3 {
                apply(
                    &mut e,
                    "setCellText",
                    json!({"block":0,"row":r,"col":c,"text":format!("c{r}{c}")}),
                );
            }
        }
        e
    }

    #[test]
    fn merge_table_cells_builds_registry_and_discards_covered_content() {
        let mut e = merged_fixture();
        let r = merge_cells(&mut e, 0, (1, 1), (2, 0)); // reversed corners normalize
        assert_eq!(r.data["ok"], true);
        let d = describe_table(&mut e, 0);
        assert_eq!(d["merges"], json!([{"row":1,"col":0,"rows":2,"cols":2}]));
        // Anchor (top-left of the rect) keeps its text; covered cells are
        // empty in the grid and their old content is gone.
        assert_eq!(d["cells"][1][0], "c10");
        assert_eq!(d["cells"][1][1], "");
        assert_eq!(d["cells"][1][2], "c12");
        assert_eq!(d["cells"][2][0], "");
        assert_eq!(d["cells"][2][1], "");
        assert_eq!(d["cells"][2][2], "c22");
        // The dense grid is untouched: still rows*cols cells.
        let table = &e.blocks[0].table.as_ref().unwrap();
        assert_eq!(table.cells.len(), 9);
        // listTables exposes the registry too.
        assert_eq!(
            list_tables(&mut e)["tables"][0]["merges"],
            json!([{"row":1,"col":0,"rows":2,"cols":2}])
        );
        // Flat key spelling is accepted as an alias.
        let mut e2 = merged_fixture();
        apply(
            &mut e2,
            "mergeTableCells",
            json!({"block":0,"from_row":0,"from_col":2,"to_row":1,"to_col":2}),
        );
        assert_eq!(describe_table(&mut e2, 0)["merges"][0]["cols"], 1);
    }

    #[test]
    fn merge_table_cells_rejects_bad_regions_atomically() {
        let mut e = merged_fixture();
        let before = e.snapshot().unwrap();
        for payload in [
            // single cell
            json!({"block":0,"from":{"row":0,"col":0},"to":{"row":0,"col":0}}),
            // out of bounds endpoints
            json!({"block":0,"from":{"row":0,"col":0},"to":{"row":3,"col":0}}),
            json!({"block":0,"from":{"row":-1,"col":0},"to":{"row":1,"col":1}}),
            // missing keys / wrong types
            json!({"block":0,"from":{"row":0}}),
            json!({"block":0,"to":{"row":1,"col":1}}),
            json!({"block":0,"from":{"row":"x","col":0},"to":{"row":1,"col":1}}),
            json!({"block":9,"from":{"row":0,"col":0},"to":{"row":1,"col":1}}),
            json!({"block":1,"from":{"row":0,"col":0},"to":{"row":1,"col":1}}), // not a table
        ] {
            assert!(e.apply(cmd("mergeTableCells", payload.clone())).is_err(), "{payload}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Overlapping an existing merge rejects and changes nothing.
        merge_cells(&mut e, 0, (0, 0), (1, 1));
        let before = e.snapshot().unwrap();
        assert!(err(&mut e, "mergeTableCells", json!({
            "block":0,"from":{"row":1,"col":1},"to":{"row":2,"col":2}
        }))
        .code == ErrorCode::Validation);
        // A rect fully inside the existing merge also overlaps.
        assert!(err(&mut e, "mergeTableCells", json!({
            "block":0,"from":{"row":0,"col":0},"to":{"row":0,"col":1}
        }))
        .code == ErrorCode::Validation);
        assert_eq!(e.snapshot().unwrap(), before);
        // Adjacent (non-overlapping) merges are fine.
        apply(
            &mut e,
            "mergeTableCells",
            json!({"block":0,"from":{"row":0,"col":2},"to":{"row":2,"col":2}}),
        );
        assert_eq!(describe_table(&mut e, 0)["merges"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn unmerge_table_cells_restores_empty_covered_cells() {
        let mut e = merged_fixture();
        merge_cells(&mut e, 0, (0, 0), (1, 1));
        // Unmerge by naming a covered cell.
        unmerge_cell(&mut e, 0, 1, 1);
        let d = describe_table(&mut e, 0);
        assert_eq!(d["merges"], json!([]));
        // Covered cells come back as ordinary (empty) cells; the anchor
        // keeps its content — covered content was discarded at merge.
        assert_eq!(d["cells"][0][0], "c00");
        assert_eq!(d["cells"][1][1], "");
        assert_eq!(d["cells"][1][0], "");
        // Unmerge by naming the anchor works too; unmerged cells reject.
        merge_cells(&mut e, 0, (2, 2), (2, 1)); // horizontal merge, anchor left
        unmerge_cell(&mut e, 0, 2, 2); // covered cell identifies the region
        assert_eq!(describe_table(&mut e, 0)["merges"], json!([]));
        let before = e.snapshot().unwrap();
        assert!(err(&mut e, "unmergeTableCells", json!({"block":0,"row":0,"col":0}))
            .code == ErrorCode::Validation);
        assert!(err(&mut e, "unmergeTableCells", json!({"block":0,"row":9,"col":0}))
            .code == ErrorCode::OutOfBounds);
        assert!(err(&mut e, "unmergeTableCells", json!({"block":0,"row":0}))
            .code == ErrorCode::InvalidCommand);
        assert_eq!(e.snapshot().unwrap(), before);
        // After unmerge the formerly covered cells are writable again.
        apply(&mut e, "setCellText", json!({"block":0,"row":1,"col":1,"text":"back"}));
        assert_eq!(describe_table(&mut e, 0)["cells"][1][1], "back");
    }

    #[test]
    fn set_cell_text_rejects_covered_cells() {
        let mut e = merged_fixture();
        merge_cells(&mut e, 0, (0, 0), (1, 1));
        let before = e.snapshot().unwrap();
        for (r, c) in [(0, 1), (1, 0), (1, 1)] {
            assert!(err(&mut e, "setCellText", json!({
                "block":0,"row":r,"col":c,"text":"x"
            }))
            .code == ErrorCode::Validation);
        }
        assert_eq!(e.snapshot().unwrap(), before);
        // The anchor cell stays editable.
        apply(&mut e, "setCellText", json!({"block":0,"row":0,"col":0,"text":"anchor"}));
        assert_eq!(describe_table(&mut e, 0)["cells"][0][0], "anchor");
    }

    #[test]
    fn structural_ops_shift_or_reject_through_merges() {
        let mut e = merged_fixture();
        merge_cells(&mut e, 0, (1, 0), (2, 1)); // rows 1-2, cols 0-1
        // Inserting a row strictly inside the merge's row span rejects.
        let before = e.snapshot().unwrap();
        assert!(err(&mut e, "insertTableRow", json!({"block":0,"row":2}))
            .code == ErrorCode::Validation);
        assert_eq!(e.snapshot().unwrap(), before);
        // Inserting at the merge's top edge shifts the whole merge down.
        apply(&mut e, "insertTableRow", json!({"block":0,"row":1}));
        assert_eq!(
            describe_table(&mut e, 0)["merges"],
            json!([{"row":2,"col":0,"rows":2,"cols":2}])
        );
        // Inserting past the merge's bottom edge leaves it alone.
        apply(&mut e, "insertTableRow", json!({"block":0,"row":4}));
        assert_eq!(
            describe_table(&mut e, 0)["merges"],
            json!([{"row":2,"col":0,"rows":2,"cols":2}])
        );
        // Deleting a covered row rejects; deleting a row below shifts up.
        assert!(err(&mut e, "deleteTableRow", json!({"block":0,"row":3}))
            .code == ErrorCode::Validation);
        apply(&mut e, "deleteTableRow", json!({"block":0,"row":0})); // above merge
        assert_eq!(
            describe_table(&mut e, 0)["merges"],
            json!([{"row":1,"col":0,"rows":2,"cols":2}])
        );
        // Column ops behave the same on the column axis.
        assert!(err(&mut e, "insertTableColumn", json!({"block":0,"col":1}))
            .code == ErrorCode::Validation);
        apply(&mut e, "insertTableColumn", json!({"block":0,"col":0}));
        assert_eq!(
            describe_table(&mut e, 0)["merges"],
            json!([{"row":1,"col":1,"rows":2,"cols":2}])
        );
        assert!(err(&mut e, "deleteTableColumn", json!({"block":0,"col":2}))
            .code == ErrorCode::Validation);
        apply(&mut e, "deleteTableColumn", json!({"block":0,"col":0}));
        assert_eq!(
            describe_table(&mut e, 0)["merges"],
            json!([{"row":1,"col":0,"rows":2,"cols":2}])
        );
        // Every intermediate state still restores cleanly.
        let mut r = engine();
        r.restore(&e.snapshot().unwrap()).unwrap();
    }

    #[test]
    fn merge_unmerge_undo_redo() {
        let mut e = merged_fixture();
        merge_cells(&mut e, 0, (0, 0), (1, 1));
        unmerge_cell(&mut e, 0, 1, 0);
        assert_eq!(describe_table(&mut e, 0)["merges"], json!([]));
        let full = e.snapshot().unwrap();
        // Undo unmerge → merge back; undo merge → covered content returns.
        assert!(e.undo().unwrap());
        assert_eq!(
            describe_table(&mut e, 0)["merges"],
            json!([{"row":0,"col":0,"rows":2,"cols":2}])
        );
        assert_eq!(describe_table(&mut e, 0)["cells"][1][1], "");
        assert!(e.undo().unwrap());
        assert_eq!(describe_table(&mut e, 0)["merges"], json!([]));
        assert_eq!(describe_table(&mut e, 0)["cells"][1][1], "c11");
        while e.redo().unwrap() {}
        assert_eq!(e.snapshot().unwrap(), full);
        assert_eq!(
            describe_table(&mut e, 0)["merges"],
            json!([])
        );
    }

    #[test]
    fn snapshot_round_trip_preserves_merges() {
        let mut e = merged_fixture();
        merge_cells(&mut e, 0, (0, 1), (2, 2));
        // Flat key spelling, non-overlapping region in column 0.
        apply(&mut e, "mergeTableCells", json!({
            "block":0,"from_row":0,"from_col":0,"to_row":1,"to_col":0
        }));
        let bytes = e.snapshot().unwrap();
        let mut r = engine();
        r.restore(&bytes).unwrap();
        assert_eq!(r.blocks, e.blocks);
        assert_eq!(r.snapshot().unwrap(), bytes);
        assert_eq!(
            describe_table(&mut r, 0)["merges"],
            json!([
                {"row":0,"col":1,"rows":3,"cols":2},
                {"row":0,"col":0,"rows":2,"cols":1}
            ])
        );
        // A merge-free table omits the key entirely (byte-identical
        // pre-slice-C payloads).
        let mut p = engine();
        insert_table(&mut p, 0, 1, 1);
        let bytes2 = p.snapshot().unwrap();
        let (_f, payload) = decode_envelope(&bytes2).unwrap();
        let text = String::from_utf8(payload.to_vec()).unwrap();
        assert!(!text.contains("merges"));
    }

    #[test]
    fn hostile_merge_snapshots_reject() {
        let mut e = merged_fixture();
        merge_cells(&mut e, 0, (0, 0), (1, 1));
        let bytes = e.snapshot().unwrap();
        let (_fmt, payload) = decode_envelope(&bytes).unwrap();
        let value: Value = serde_json::from_slice(payload).unwrap();
        let blocks = if value.get("document").is_some() {
            value["document"]["blocks"].clone()
        } else {
            value["blocks"].clone()
        };
        assert_eq!(blocks[0]["table"]["merges"][0]["rows"], 2);

        let cases: Vec<Value> = vec![
            // overlapping merges
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][0]["table"]["merges"] = json!([
                    {"row":0,"col":0,"rows":2,"cols":2},
                    {"row":1,"col":1,"rows":2,"cols":2}
                ]);
                serde_json::to_value(v).unwrap()
            },
            // out-of-bounds merge
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][0]["table"]["merges"] = json!([
                    {"row":2,"col":2,"rows":2,"cols":2}
                ]);
                serde_json::to_value(v).unwrap()
            },
            // 1x1 merge (covers a single cell — meaningless)
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][0]["table"]["merges"] = json!([
                    {"row":0,"col":0,"rows":1,"cols":1}
                ]);
                serde_json::to_value(v).unwrap()
            },
            // zero-extent merge
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][0]["table"]["merges"] = json!([
                    {"row":0,"col":0,"rows":0,"cols":2}
                ]);
                serde_json::to_value(v).unwrap()
            },
            // covered cell smuggling content (cell (0,1) is covered by the
            // real merge; give it text)
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][0]["table"]["cells"][1]["blocks"][0]["inlines"] =
                    json!([{"text":"sneaky","style":{}}]);
                serde_json::to_value(v).unwrap()
            },
            // unknown field inside a merge rect (deny_unknown_fields)
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][0]["table"]["merges"][0]["extra"] = json!(1);
                serde_json::to_value(v).unwrap()
            },
            // huge extent that would overflow naive row+rows arithmetic
            {
                let mut v = value.clone();
                let doc = if v.get("document").is_some() { &mut v["document"] } else { &mut v };
                doc["blocks"][0]["table"]["merges"] = json!([
                    {"row":0,"col":0,"rows":u64::MAX,"cols":2}
                ]);
                serde_json::to_value(v).unwrap()
            },
        ];
        for (i, v) in cases.iter().enumerate() {
            let bytes = encode_envelope(&serde_json::to_vec(v).unwrap());
            let mut e2 = engine();
            assert!(e2.restore(&bytes).is_err(), "case {i} must reject");
            assert_eq!(e2.snapshot().unwrap(), engine().snapshot().unwrap());
        }
    }

    // -- slice D: in-cell find/replace + text/layout coverage -----------------

    fn find(e: &mut QuillEngine, payload: Value) -> CommandResult {
        apply(e, "findText", payload)
    }

    /// ["top foo" para, 2x2 table, "tail" para] with "foo"-bearing cells:
    /// (0,0) "foo bar", (0,1) "foo", (1,0) three paragraphs "x"/"foo y"/
    /// "foo", (1,1) empty.
    fn find_fixture() -> QuillEngine {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"top foo"}));
        insert_table(&mut e, 1, 2, 2);
        apply(&mut e, "insertBlock", json!({"index": 2}));
        apply(&mut e, "insertText", json!({"at":{"block":2,"offset":0},"text":"tail"}));
        apply(&mut e, "setCellText", json!({"block":1,"row":0,"col":0,"text":"foo bar"}));
        apply(&mut e, "setCellText", json!({"block":1,"row":0,"col":1,"text":"foo"}));
        apply(&mut e, "setCellText", json!({"block":1,"row":1,"col":0,"text":"x\nfoo y\nfoo"}));
        e
    }

    #[test]
    fn find_text_reports_cell_matches_with_cell_positions() {
        let mut e = find_fixture();
        let r = find(&mut e, json!({"query": "foo"}));
        assert_eq!(r.data["count"], 1);
        assert_eq!(r.data["cell_count"], 4);
        assert_eq!(r.data["matches"][0]["from"]["block"], 0);
        let cell = r.data["cell_matches"].as_array().unwrap();
        // Row-major order: (0,0), (0,1), then (1,0)'s second paragraph.
        assert_eq!(
            cell[0],
            json!({
                "from": {"block":1,"row":0,"col":0,"cell_block":0,"offset":0},
                "to":   {"block":1,"row":0,"col":0,"cell_block":0,"offset":3},
                "text": "foo",
            })
        );
        assert_eq!(cell[1]["from"]["row"], 0);
        assert_eq!(cell[1]["from"]["col"], 1);
        assert_eq!(cell[2]["from"]["row"], 1);
        assert_eq!(cell[2]["from"]["col"], 0);
        // The match sits in the cell's second paragraph ("x"/"foo y").
        assert_eq!(cell[2]["from"]["cell_block"], 1);
        assert_eq!(cell[2]["from"]["offset"], 0);
        // The fourth match sits in the cell's third paragraph.
        assert_eq!(cell[3]["from"]["cell_block"], 2);
        assert_eq!(cell[3]["from"]["offset"], 0);
        assert_eq!(cell[3]["text"], "foo");
        // Case sensitivity applies inside cells too.
        let r = find(&mut e, json!({"query": "FOO", "case_sensitive": true}));
        assert_eq!(r.data["cell_count"], 0);
        let r = find(&mut e, json!({"query": "FOO"}));
        assert_eq!(r.data["cell_count"], 4);
    }

    #[test]
    fn find_text_cell_coverage_follows_block_range_rules() {
        let mut e = find_fixture(); // table at block 1
        // Collapsed on the table block: no cell matches.
        let r = find(
            &mut e,
            json!({"query":"foo","from":{"block":1,"offset":0},"to":{"block":1,"offset":0}}),
        );
        assert_eq!(r.data["cell_count"], 0);
        // Ending at the table's position still covers it (deleteRange's
        // inclusive to-block convention); starting at it covers it too.
        let r = find(
            &mut e,
            json!({"query":"foo","from":{"block":0,"offset":0},"to":{"block":1,"offset":0}}),
        );
        assert_eq!(r.data["cell_count"], 4);
        let r = find(
            &mut e,
            json!({"query":"foo","from":{"block":1,"offset":0},"to":{"block":2,"offset":4}}),
        );
        assert_eq!(r.data["cell_count"], 4);
        // A range starting after the table excludes its cells.
        let r = find(
            &mut e,
            json!({"query":"foo","from":{"block":2,"offset":0}}),
        );
        assert_eq!(r.data["cell_count"], 0);
        assert_eq!(r.data["count"], 0);
    }

    #[test]
    fn replace_text_rewrites_cell_paragraphs_with_undo() {
        let mut e = engine();
        insert_table(&mut e, 0, 2, 2);
        apply(&mut e, "setCellText", json!({"block":0,"row":0,"col":0,"text":"foo x foo"}));
        apply(&mut e, "setCellText", json!({"block":0,"row":1,"col":1,"text":"foo"}));
        apply(&mut e, "addBookmark", json!({"name":"bm","pos":{"block":0,"offset":0}}));
        let r = apply(&mut e, "replaceText", json!({"query":"foo","replacement":"bar"}));
        assert_eq!(r.data["replaced"], 3);
        let d = describe_table(&mut e, 0);
        assert_eq!(d["cells"][0][0], "bar x bar");
        assert_eq!(d["cells"][1][1], "bar");
        // Cell paragraphs keep their block structure (no new blocks, so
        // the cell-block budget cannot grow).
        let cell = &e.blocks[0].table.as_ref().unwrap().cells[0];
        assert_eq!(cell.blocks.len(), 1);
        assert_eq!(block_text(&cell.blocks[0]), "bar x bar");
        // A bookmark on the table block cannot move: cell edits are
        // invisible to Pos-anchored collections.
        let bms = apply(&mut e, "listBookmarks", json!({})).data;
        assert_eq!(bms["bookmarks"][0]["pos"], json!({"block":0,"offset":0}));
        // One undo restores every cell at once.
        assert!(e.undo().unwrap());
        assert_eq!(describe_table(&mut e, 0)["cells"][0][0], "foo x foo");
        assert_eq!(describe_table(&mut e, 0)["cells"][1][1], "foo");
        assert!(e.redo().unwrap());
        assert_eq!(describe_table(&mut e, 0)["cells"][0][0], "bar x bar");
        // Identical replacement is eventless even with cell matches.
        let before = e.snapshot().unwrap();
        let r = apply(&mut e, "replaceText", json!({"query":"bar","replacement":"bar"}));
        assert_eq!(r.data["replaced"], 0);
        assert!(r.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);
        // Snapshot round-trip preserves the rewritten cells.
        let bytes = e.snapshot().unwrap();
        let mut r2 = engine();
        r2.restore(&bytes).unwrap();
        assert_eq!(describe_table(&mut r2, 0)["cells"][0][0], "bar x bar");
    }

    #[test]
    fn replace_text_cell_matches_respect_range_and_merges() {
        let mut e = find_fixture(); // table at block 1
        // Collapsed on the table: nothing to replace.
        let r = apply(
            &mut e,
            "replaceText",
            json!({"query":"foo","replacement":"z",
                   "from":{"block":1,"offset":0},"to":{"block":1,"offset":0}}),
        );
        assert_eq!(r.data["replaced"], 0);
        assert_eq!(describe_table(&mut e, 1)["cells"][0][0], "foo bar");
        // Range covering only the tail block leaves cells untouched.
        let r = apply(
            &mut e,
            "replaceText",
            json!({"query":"foo","replacement":"z","from":{"block":2,"offset":0}}),
        );
        assert_eq!(r.data["replaced"], 0);
        // Whole-document replace hits top-level and cell matches; `replaced`
        // counts both.
        let r = apply(&mut e, "replaceText", json!({"query":"foo","replacement":"z"}));
        assert_eq!(r.data["replaced"], 5);
        assert_eq!(block_text(&e.blocks[0]), "top z");
        assert_eq!(describe_table(&mut e, 1)["cells"][0][0], "z bar");
        assert_eq!(describe_table(&mut e, 1)["cells"][1][0], "x\nz y\nz");
        // Merge-covered cells are canonical empty paragraphs: they can
        // never match, and the anchor cell edits normally.
        let mut m = engine();
        insert_table(&mut m, 0, 2, 2);
        apply(&mut m, "setCellText", json!({"block":0,"row":0,"col":0,"text":"foo"}));
        apply(&mut m, "setCellText", json!({"block":0,"row":0,"col":1,"text":"foo"}));
        merge_cells(&mut m, 0, (0, 0), (0, 1)); // covered (0,1) content discarded
        let r = find(&mut m, json!({"query":"foo"}));
        assert_eq!(r.data["cell_count"], 1);
        assert_eq!(r.data["cell_matches"][0]["from"]["col"], 0);
        let r = apply(&mut m, "replaceText", json!({"query":"foo","replacement":"bar"}));
        assert_eq!(r.data["replaced"], 1);
        let d = describe_table(&mut m, 0);
        assert_eq!(d["cells"][0][0], "bar");
        assert_eq!(d["cells"][0][1], "");
        assert_eq!(d["merges"], json!([{"row":0,"col":0,"rows":1,"cols":2}]));
    }

    #[test]
    fn text_and_layout_cover_cell_content() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"top"}));
        insert_table(&mut e, 1, 2, 2);
        apply(&mut e, "setCellText", json!({"block":1,"row":0,"col":0,"text":"a\nb"}));
        apply(&mut e, "setCellText", json!({"block":1,"row":0,"col":1,"text":"c"}));
        apply(&mut e, "setCellText", json!({"block":1,"row":1,"col":1,"text":"d"}));
        // Unbounded text: the table serializes rows '\n'-joined with cells
        // '\t'-separated (a multi-paragraph cell reads as extra breaks).
        let r = apply(&mut e, "text", json!({}));
        assert_eq!(r.data["text"], "top\na\nb\tc\n\td");
        // A range covering the table reports the same serialization.
        let r = apply(
            &mut e,
            "text",
            json!({"from":{"block":1,"offset":0},"to":{"block":1,"offset":0}}),
        );
        // Collapsed on the table: empty, like any collapsed range.
        assert_eq!(r.data["text"], "");
        let r = apply(
            &mut e,
            "text",
            json!({"from":{"block":0,"offset":0},"to":{"block":1,"offset":0}}),
        );
        assert_eq!(r.data["text"], "top\na\nb\tc\n\td");
        // layout wraps the same serialization: lines carry the table's
        // block index with char spans into it.
        let r = apply(&mut e, "layout", json!({"page_width": 200.0, "font_size": 10.0}));
        let lines: Vec<Value> = r.data["pages"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|p| p["lines"].as_array().unwrap().iter().cloned())
            .collect();
        let table_lines: Vec<&Value> = lines
            .iter()
            .filter(|l| l.get("block").and_then(Value::as_u64) == Some(1))
            .collect();
        assert!(!table_lines.is_empty());
        // The serialization is 9 chars, so every table line span fits it.
        assert!(table_lines
            .iter()
            .all(|l| l.get("end").and_then(Value::as_u64).unwrap() <= 9));
    }
}
