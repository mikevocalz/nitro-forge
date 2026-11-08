//! Minimal real `.xlsx` export/import (P12-P14 backlog item 10, XLSX half).
//!
//! A `.xlsx` is a ZIP package of XML parts. Like `csv_ops`/`docx.rs`, the
//! engine is I/O-free: `exportXlsx` returns the archive bytes through the
//! binary-output sidecar (`bytes_b64` for JSON-only callers) and
//! `importXlsx` takes them through `bytes_b64` or `Command.input` (the op is
//! listed in `binary_input_ops`).
//!
//! Export coverage (the honest subset):
//! * Every sheet, in order, with its name. Sheet names must satisfy the
//!   Excel rules (1–31 chars, none of `[]:*?/\`, no leading/trailing `'`) —
//!   a workbook containing an invalid name rejects the whole export rather
//!   than silently renaming.
//! * Cell contents: formulas are written as real `<f>` elements with the
//!   computed value cached in `<v>`; literals are typed from the same
//!   `scalar_from_raw` classification evaluation uses (finite-number text →
//!   number, everything else → inline string). Errors export as `t="e"`,
//!   booleans as `t="b"`, formula string results as `t="str"`.
//! * Stored formats map to `styles.xml`: `bold`/`italic` → fonts,
//!   `fill` (`#RRGGBB`) → solid fills, `border` (style/color/sides) →
//!   borders; `number_format` is **not** translated — it is a
//!   host-interpreted preset/custom pattern with no defined XLSX mapping
//!   (same deferral as `exportCsv` ignoring formats).
//! * Merged regions export as `<mergeCells>`.
//!
//! Export bounds: at most `MAX_XLSX_CELLS` cell/style entries across the
//! whole workbook (cells plus format-only addresses); ZIP entries are
//! deflate-compressed by the `zip` crate.
//!
//! Import coverage:
//! * `xl/workbook.xml` + `xl/_rels/workbook.xml.rels` resolve every
//!   `<sheet>` (name + `r:id` → worksheet target). `xl/sharedStrings.xml`
//!   is read when present; `xl/styles.xml` and every other part
//!   (theme, drawings, comments, pivots, tables, defined names, data
//!   validation, conditional formats, protection, column widths/row
//!   heights, hidden state, cached formula values) is **ignored** —
//!   documented data loss, matching the CSV import precedent of storing
//!   typed text verbatim.
//! * Cell types admitted: numbers (`t="n"`/absent), shared strings
//!   (`t="s"`), inline strings (`t="inlineStr"`), formula string results
//!   (`t="str"`), booleans (`t="b"` → `TRUE`/`FALSE` raw, which compute as
//!   text — the same literal model `setCell` bools already have) and
//!   errors (`t="e"` → stored as the `=#…!` error-literal formula so the
//!   computed value keeps its error type). `<f>` elements become `=…`
//!   raws; `t="shared"|"array"|"dataTable"` formulas, ISO-8601 `t="d"`
//!   cells and unknown `t` values reject the whole import. Cells without
//!   an `r` attribute take positional interpretation (row/column cursors).
//! * `<mergeCells>` regions import into `Sheet.merges` after the same
//!   normalization/overlap/cap checks `restore` enforces.
//! * The import **replaces the whole workbook** (like `importDocx`
//!   replaces the document): sheet order/names/cells/merges carry over,
//!   every other workbook-level table starts empty, `active` follows the
//!   workbook view's `activeTab` (clamped). One `Reset` undo entry covers
//!   it; any protected sheet rejects the op up front (same rule as `new`).
//!
//! Hostile-input bounds (zip-bomb discipline, same as folio's lopdf and
//! quill's docx caps): ≤4096 archive entries, each read part ≤128 MiB
//! uncompressed (checked via the central directory *and* enforced by
//! `take()` while streaming), ≤256 MiB total uncompressed across all read
//! parts, ≤1,048,576 shared strings, ≤1024 sheets, ≤1,048,576 imported
//! cells. Any violation rejects before mutation — the op is atomic.
use super::*;
use format_ops::{BorderSide, BorderStyle, CellFormat};
use formula::{fmt_addr, fmt_num, on_sheet, parse_addr, Evaluator, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

/// Archive entry-count cap (real workbooks carry a handful of parts).
const MAX_XLSX_ENTRIES: usize = 4096;
/// Per-part uncompressed cap (worksheet/sharedStrings/workbook XML).
const MAX_PART_BYTES: u64 = 128 * 1024 * 1024;
/// Total uncompressed cap across every part the importer reads.
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
/// Shared-string table cap.
const MAX_SHARED_STRINGS: usize = 1_048_576;
/// Imported-sheet cap.
const MAX_XLSX_SHEETS: usize = 1024;
/// Imported-cell cap (same budget as delimited import).
const MAX_IMPORT_XLSX_CELLS: u64 = 1_048_576;
/// Export cell/style-entry cap across the whole workbook.
const MAX_XLSX_CELLS: u64 = 1_048_576;

const ERR_LITERALS: [&str; 6] = [
    formula::ERR_DIV0,
    formula::ERR_VALUE,
    formula::ERR_REF,
    formula::ERR_NAME,
    formula::ERR_NUM,
    formula::ERR_CYCLE,
];

fn local_name(qname: &[u8]) -> &[u8] {
    match qname.iter().rposition(|b| *b == b':') {
        Some(i) => &qname[i + 1..],
        None => qname,
    }
}

/// First attribute whose local name matches `key`, XML-unescaped.
fn attr_val(e: &BytesStart<'_>, key: &[u8]) -> Option<String> {
    for a in e.attributes().flatten() {
        if local_name(a.key.as_ref()) == key {
            return a.unescape_value().ok().map(|v| v.into_owned());
        }
    }
    None
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn esc_attr(s: &str) -> String {
    esc(s).replace('"', "&quot;")
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Excel sheet-name rules: 1–31 chars, none of `[]:*?/\`, no leading or
/// trailing apostrophe.
fn xlsx_name_ok(name: &str) -> bool {
    let n = name.chars().count();
    n >= 1
        && n <= 31
        && !name.starts_with('\'')
        && !name.ends_with('\'')
        && !name
            .chars()
            .any(|c| matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\'))
}

/// Border style → OOXML `style` attribute (the serde names already match).
fn border_style_str(s: BorderStyle) -> &'static str {
    match s {
        BorderStyle::Thin => "thin",
        BorderStyle::Medium => "medium",
        BorderStyle::Thick => "thick",
        BorderStyle::Dashed => "dashed",
        BorderStyle::Dotted => "dotted",
    }
}

/// Workbook-global style table: deduped fonts/fills/borders and one `xf`
/// per distinct (font, fill, border) triple actually referenced.
#[derive(Default)]
struct StyleTable {
    fonts: Vec<String>,
    font_ids: BTreeMap<(bool, bool), usize>,
    fills: Vec<String>,
    fill_ids: BTreeMap<Option<String>, usize>,
    borders: Vec<String>,
    border_ids: BTreeMap<String, usize>,
    /// (font_id, fill_id, border_id) → xf index in `cellXfs`.
    xfs: BTreeMap<(usize, usize, usize), usize>,
}

impl StyleTable {
    fn new() -> Self {
        let mut t = StyleTable::default();
        t.fonts.push("<font><sz val=\"11\"/><name val=\"Calibri\"/></font>".to_string());
        t.font_ids.insert((false, false), 0);
        t.fills.push("<fill><patternFill patternType=\"none\"/></fill>".to_string());
        t.fills.push("<fill><patternFill patternType=\"gray125\"/></fill>".to_string());
        t.fill_ids.insert(None, 0);
        t.borders.push("<border><left/><right/><top/><bottom/><diagonal/></border>".to_string());
        t.border_ids.insert(String::new(), 0);
        t
    }

    fn font_id(&mut self, bold: bool, italic: bool) -> usize {
        if let Some(&i) = self.font_ids.get(&(bold, italic)) {
            return i;
        }
        let mut f = String::from("<font>");
        if bold {
            f.push_str("<b/>");
        }
        if italic {
            f.push_str("<i/>");
        }
        f.push_str("</font>");
        let i = self.fonts.len();
        self.fonts.push(f);
        self.font_ids.insert((bold, italic), i);
        i
    }

    fn fill_id(&mut self, fill: &Option<String>) -> usize {
        if let Some(&i) = self.fill_ids.get(fill) {
            return i;
        }
        let i = self.fills.len();
        let xml = match fill {
            Some(color) => format!(
                "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF{}\"/><bgColor indexed=\"64\"/></patternFill></fill>",
                esc_attr(color.trim_start_matches('#'))
            ),
            None => "<fill><patternFill patternType=\"none\"/></fill>".to_string(),
        };
        self.fills.push(xml);
        self.fill_ids.insert(fill.clone(), i);
        i
    }

    fn border_id(&mut self, border: &Option<format_ops::Border>) -> usize {
        let key = border
            .as_ref()
            .map(|b| format!("{:?}", b))
            .unwrap_or_default();
        if let Some(&i) = self.border_ids.get(&key) {
            return i;
        }
        let i = self.borders.len();
        let xml = match border {
            None => "<border><left/><right/><top/><bottom/><diagonal/></border>".to_string(),
            Some(b) => {
                let mut s = String::from("<border>");
                for side in [BorderSide::Left, BorderSide::Right, BorderSide::Top, BorderSide::Bottom] {
                    let name = match side {
                        BorderSide::Left => "left",
                        BorderSide::Right => "right",
                        BorderSide::Top => "top",
                        BorderSide::Bottom => "bottom",
                    };
                    if b.sides.contains(&side) {
                        s.push_str(&format!(
                            "<{name} style=\"{}\"><color rgb=\"FF{}\"/></{name}>",
                            border_style_str(b.style),
                            esc_attr(b.color.trim_start_matches('#'))
                        ));
                    } else {
                        s.push_str(&format!("<{name}/>"));
                    }
                }
                s.push_str("<diagonal/></border>");
                s
            }
        };
        self.borders.push(xml);
        self.border_ids.insert(key, i);
        i
    }

    /// `xf` index for a stored format; `0` (the default) when the format
    /// carries nothing styles.xml can express (`number_format` only).
    fn xf_id(&mut self, fmt: &CellFormat) -> usize {
        let f = self.font_id(fmt.bold.unwrap_or(false), fmt.italic.unwrap_or(false));
        let l = self.fill_id(&fmt.fill);
        let b = self.border_id(&fmt.border);
        if let Some(&i) = self.xfs.get(&(f, l, b)) {
            return i;
        }
        let i = self.xfs.len() + 1; // xf 0 is the default, emitted separately
        self.xfs.insert((f, l, b), i);
        i
    }

    fn needed(&self) -> bool {
        self.xfs.len() > 0
    }

    fn styles_xml(&self) -> String {
        let mut s = String::new();
        s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        s.push_str("<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
        s.push_str(&format!("<fonts count=\"{}\">", self.fonts.len()));
        for f in &self.fonts {
            s.push_str(f);
        }
        s.push_str("</fonts>");
        s.push_str(&format!("<fills count=\"{}\">", self.fills.len()));
        for f in &self.fills {
            s.push_str(f);
        }
        s.push_str("</fills>");
        s.push_str(&format!("<borders count=\"{}\">", self.borders.len()));
        for b in &self.borders {
            s.push_str(b);
        }
        s.push_str("</borders>");
        s.push_str("<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellStyleXfs>");
        s.push_str(&format!("<cellXfs count=\"{}\">", self.xfs.len() + 1));
        s.push_str("<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>");
        // Emit xfs in index order.
        let mut ordered: Vec<(usize, (usize, usize, usize))> =
            self.xfs.iter().map(|(k, v)| (*v, *k)).collect();
        ordered.sort_by_key(|(i, _)| *i);
        for (_, (f, l, b)) in ordered {
            s.push_str(&format!(
                "<xf numFmtId=\"0\" fontId=\"{f}\" fillId=\"{l}\" borderId=\"{b}\" xfId=\"0\"{af}{al}{ab}/>",
                af = if f != 0 { " applyFont=\"1\"" } else { "" },
                al = if l != 0 { " applyFill=\"1\"" } else { "" },
                ab = if b != 0 { " applyBorder=\"1\"" } else { "" },
            ));
        }
        s.push_str("</cellXfs>");
        s.push_str("<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>");
        s.push_str("<dxfs count=\"0\"/><tableStyles count=\"0\" defaultTableStyle=\"TableStyleMedium9\" defaultPivotStyle=\"PivotStyleLight16\"/>");
        s.push_str("</styleSheet>");
        s
    }
}

/// `<c>` attributes + children for a formula cell: `t` lives on `<c>` in
/// OOXML, so this variant takes the type before `<f>`.
fn formula_cell_xml(addr: &str, raw_body: &str, v: &formula::Value, s_attr: &str) -> String {
    let mut s = String::new();
    s.push_str("<c r=\"");
    s.push_str(addr);
    s.push('"');
    s.push_str(s_attr);
    match v {
        formula::Value::Empty => {}
        formula::Value::Num(n) if n.is_finite() => {}
        formula::Value::Num(_) => s.push_str(" t=\"e\""),
        formula::Value::Str(_) => s.push_str(" t=\"str\""),
        formula::Value::Bool(_) => s.push_str(" t=\"b\""),
        formula::Value::Err(_) | formula::Value::List(_) => s.push_str(" t=\"e\""),
    }
    s.push('>');
    s.push_str("<f>");
    s.push_str(&esc(raw_body));
    s.push_str("</f>");
    match v {
        formula::Value::Empty => {}
        formula::Value::Num(n) if n.is_finite() => {
            s.push_str("<v>");
            s.push_str(&fmt_num(*n));
            s.push_str("</v>");
        }
        formula::Value::Num(_) => {
            s.push_str("<v>");
            s.push_str(formula::ERR_NUM);
            s.push_str("</v>");
        }
        formula::Value::Str(t) => {
            s.push_str("<v>");
            s.push_str(&esc(t));
            s.push_str("</v>");
        }
        formula::Value::Bool(b) => {
            s.push_str("<v>");
            s.push_str(if *b { "1" } else { "0" });
            s.push_str("</v>");
        }
        formula::Value::Err(e) => {
            s.push_str("<v>");
            s.push_str(e);
            s.push_str("</v>");
        }
        formula::Value::List(_) => {
            s.push_str("<v>");
            s.push_str(formula::ERR_VALUE);
            s.push_str("</v>");
        }
    }
    s.push_str("</c>");
    s
}

fn content_types_xml(sheet_count: usize, has_styles: bool) -> String {
    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    s.push_str("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
    s.push_str("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>");
    s.push_str("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
    s.push_str("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>");
    if has_styles {
        s.push_str("<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
    }
    for i in 1..=sheet_count {
        s.push_str(&format!(
            "<Override PartName=\"/xl/worksheets/sheet{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
        ));
    }
    s.push_str("</Types>");
    s
}

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#;

fn workbook_xml(names: &[String]) -> String {
    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    s.push_str("<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
    for (i, name) in names.iter().enumerate() {
        s.push_str(&format!(
            "<sheet name=\"{}\" sheetId=\"{}\" r:id=\"rId{}\"/>",
            esc_attr(name),
            i + 1,
            i + 1
        ));
    }
    s.push_str("</sheets></workbook>");
    s
}

fn workbook_rels_xml(sheet_count: usize, has_styles: bool) -> String {
    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    s.push_str("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
    for i in 1..=sheet_count {
        s.push_str(&format!(
            "<Relationship Id=\"rId{i}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{i}.xml\"/>"
        ));
    }
    if has_styles {
        s.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
            sheet_count + 1
        ));
    }
    s.push_str("</Relationships>");
    s
}

impl TallyEngine {
    /// `exportXlsx {}` → whole-workbook `.xlsx` bytes as `bytes_b64`, or as
    /// binary output for binary-capable hosts. Read-only.
    pub(super) fn op_export_xlsx(&self, cmd: &Command) -> Result<CommandResult, EngineError> {
        for s in &self.doc.sheets {
            if !xlsx_name_ok(&s.name) {
                return Err(EngineError::validation(format!(
                    "sheet name '{}' is not a valid XLSX sheet name (1-31 chars, none of []:*?/\\, no leading/trailing apostrophe)",
                    s.name
                )));
            }
        }
        // Union of content and format addresses per sheet; cap the total.
        let mut total: u64 = 0;
        for sheet in &self.doc.sheets {
            let mut addrs: BTreeMap<String, ()> = BTreeMap::new();
            for a in sheet.cells.keys() {
                addrs.insert(a.clone(), ());
            }
            for a in sheet.formats.keys() {
                addrs.insert(a.clone(), ());
            }
            total += addrs.len() as u64;
        }
        if total > MAX_XLSX_CELLS {
            return Err(EngineError::out_of_bounds(format!(
                "workbook has {total} cell/style entries, over the {MAX_XLSX_CELLS} XLSX export limit"
            )));
        }
        // First pass: collect the style table (needs every format).
        let mut styles = StyleTable::new();
        let mut xf_maps: Vec<BTreeMap<String, usize>> = Vec::with_capacity(self.doc.sheets.len());
        for (si, sheet) in self.doc.sheets.iter().enumerate() {
            let mut m = BTreeMap::new();
            for (addr, fmt) in &sheet.formats {
                let i = styles.xf_id(fmt);
                if i != 0 {
                    m.insert(addr.clone(), i);
                }
            }
            xf_maps.push(m);
            let _ = si;
        }
        let has_styles = styles.needed();

        let cursor = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut put = |name: &str, body: &str| -> Result<(), EngineError> {
            zip.start_file(name, opts)
                .map_err(|e| EngineError::internal(format!("xlsx zip error: {e}")))?;
            zip.write_all(body.as_bytes())
                .map_err(|e| EngineError::internal(format!("xlsx zip error: {e}")))?;
            Ok(())
        };
        let names: Vec<String> = self.doc.sheets.iter().map(|s| s.name.clone()).collect();
        put("[Content_Types].xml", &content_types_xml(names.len(), has_styles))?;
        put("_rels/.rels", ROOT_RELS)?;
        put("xl/workbook.xml", &workbook_xml(&names))?;
        put(
            "xl/_rels/workbook.xml.rels",
            &workbook_rels_xml(names.len(), has_styles),
        )?;
        if has_styles {
            put("xl/styles.xml", &styles.styles_xml())?;
        }
        for (i, sheet) in self.doc.sheets.iter().enumerate() {
            // Build the sheet part with a fresh evaluator for cached values.
            let mut ev = self.evaluator_for(i);
            let xml = sheet_xml_full(sheet, &xf_maps[i], &mut ev);
            put(&format!("xl/worksheets/sheet{}.xml", i + 1), &xml)?;
        }
        let cursor = zip
            .finish()
            .map_err(|e| EngineError::internal(format!("xlsx zip error: {e}")))?;
        let bytes = cursor.into_inner();
        Ok(CommandResult::read_only(json!({ "size": bytes.len(), "sheets": names.len() }))
            .with_bytes(cmd, "bytes_b64", bytes))
    }

    /// `importXlsx {bytes_b64}` or binary sidecar → whole-workbook replace.
    /// Atomic: parse/validate fully, then one `Reset` undo entry.
    pub(super) fn op_import_xlsx(&mut self, cmd: &mut Command) -> Result<CommandResult, EngineError> {
        let bytes = cmd.bytes_input("bytes_b64", base64_decode)?;
        let (sheets, active) = import_xlsx(&bytes)?;
        let sheet_count = sheets.len();
        let cell_count: usize = sheets.iter().map(|s| s.cells.len()).sum();
        let merge_count: usize = sheets.iter().map(|s| s.merges.len()).sum();
        let doc = Workbook {
            next_sheet: sheet_count as u64,
            sheets: sheets
                .into_iter()
                .enumerate()
                .map(|(i, s)| Sheet {
                    id: i as u64,
                    name: s.name,
                    cells: s.cells,
                    formats: BTreeMap::new(),
                    tone: None,
                    is_protected: false,
                    active_view: None,
                    merges: s.merges,
                })
                .collect(),
            active,
            names: Vec::new(),
            validations: Vec::new(),
            next_validation: 1,
            conditional_formats: Vec::new(),
            next_conditional: 1,
            filters: Vec::new(),
            next_filter: 1,
            charts: Vec::new(),
            next_chart: 1,
            sparklines: Vec::new(),
            next_sparkline: 1,
            views: Vec::new(),
            next_view: 1,
            comments: Vec::new(),
            next_comment: 1,
            pivots: Vec::new(),
            next_pivot: 1,
            tables: Vec::new(),
            next_table: 1,
        };
        let prev = std::mem::replace(&mut self.doc, doc);
        self.journal.record(UndoEntry::Reset { prev });
        Ok(Self::changed(json!({
            "ok": true,
            "sheets": sheet_count,
            "cells": cell_count,
            "merges": merge_count,
        })))
    }
}

/// Full sheet-part builder (formula cells need `t` on `<c>`, handled by
/// `formula_cell_xml`).
fn sheet_xml_full(
    sheet: &Sheet,
    xf: &BTreeMap<String, usize>,
    ev: &mut Evaluator<'_, Sheet>,
) -> String {
    let mut cells: Vec<(u32, u32, &str)> = Vec::new();
    for (addr, _) in &sheet.cells {
        if let Some((c, r)) = parse_addr(addr).filter(|&(c, r)| on_sheet(c, r)) {
            cells.push((r, c, addr.as_str()));
        }
    }
    for addr in sheet.formats.keys() {
        if !sheet.cells.contains_key(addr) {
            if let Some((c, r)) = parse_addr(addr).filter(|&(c, r)| on_sheet(c, r)) {
                cells.push((r, c, addr.as_str()));
            }
        }
    }
    cells.sort_unstable();

    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    s.push_str("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
    let mut cur_row: Option<u32> = None;
    for (r, c, addr) in cells {
        if cur_row != Some(r) {
            if cur_row.is_some() {
                s.push_str("</row>");
            }
            s.push_str(&format!("<row r=\"{}\">", r + 1));
            cur_row = Some(r);
        }
        let mut s_attr = String::new();
        if let Some(&i) = xf.get(addr) {
            if i != 0 {
                s_attr = format!(" s=\"{i}\"");
            }
        }
        let cell = sheet.cells.get(addr);
        match cell {
            Some(cell) if cell.raw.starts_with('=') => {
                let v = ev.eval_cell(addr);
                s.push_str(&formula_cell_xml(addr, &cell.raw[1..], &v, &s_attr));
            }
            Some(cell) => {
                let raw = cell.raw.as_str();
                // Same classification evaluation applies (`scalar_from_raw`).
                let numeric = raw.trim().parse::<f64>().ok().filter(|n| n.is_finite());
                s.push_str("<c r=\"");
                s.push_str(&fmt_addr(c, r));
                s.push('"');
                s.push_str(&s_attr);
                match numeric {
                    Some(n) => {
                        s.push('>');
                        s.push_str("<v>");
                        s.push_str(&fmt_num(n));
                        s.push_str("</v></c>");
                    }
                    None => {
                        s.push_str(" t=\"inlineStr\"><is><t xml:space=\"preserve\">");
                        s.push_str(&esc(raw));
                        s.push_str("</t></is></c>");
                    }
                }
            }
            None => {
                // Format-only cell: styled empty.
                s.push_str("<c r=\"");
                s.push_str(&fmt_addr(c, r));
                s.push('"');
                s.push_str(&s_attr);
                s.push_str("/>");
            }
        }
    }
    if cur_row.is_some() {
        s.push_str("</row>");
    }
    s.push_str("</sheetData>");
    if !sheet.merges.is_empty() {
        s.push_str(&format!("<mergeCells count=\"{}\">", sheet.merges.len()));
        for m in &sheet.merges {
            s.push_str(&format!(
                "<mergeCell ref=\"{}:{}\"/>",
                fmt_addr(m.c0, m.r0),
                fmt_addr(m.c1, m.r1)
            ));
        }
        s.push_str("</mergeCells>");
    }
    s.push_str("</worksheet>");
    s
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/// One imported sheet (name + cells + merges; the engine assigns ids).
pub(super) struct XlsxSheet {
    pub name: String,
    pub cells: BTreeMap<String, Cell>,
    pub merges: Vec<MergeRegion>,
}

struct RelTarget {
    worksheet: bool,
    target: String,
    external: bool,
}

/// Read one zip member with the part cap; `total` accumulates the
/// uncompressed budget across parts.
fn read_part<'a>(
    archive: &mut zip::ZipArchive<Cursor<&'a [u8]>>,
    name: &str,
    total: &mut u64,
) -> Result<String, EngineError> {
    let mut file = archive.by_name(name).map_err(|_| {
        EngineError::serialization(format!("xlsx missing part '{name}'"))
    })?;
    let size = file.size();
    if size > MAX_PART_BYTES {
        return Err(EngineError::out_of_bounds(format!(
            "xlsx part '{name}' exceeds the {} MiB limit",
            MAX_PART_BYTES / (1024 * 1024)
        )));
    }
    if *total + size > MAX_TOTAL_BYTES {
        return Err(EngineError::out_of_bounds(
            "xlsx uncompressed parts exceed the 256 MiB total limit",
        ));
    }
    *total += size;
    let mut buf = Vec::new();
    file.by_ref()
        .take(MAX_PART_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| EngineError::serialization(format!("xlsx part '{name}' unreadable: {e}")))?;
    if buf.len() as u64 > MAX_PART_BYTES {
        return Err(EngineError::out_of_bounds(format!(
            "xlsx part '{name}' exceeds the {} MiB limit",
            MAX_PART_BYTES / (1024 * 1024)
        )));
    }
    String::from_utf8(buf)
        .map_err(|_| EngineError::serialization(format!("xlsx part '{name}' is not UTF-8")))
}

fn parse_workbook(xml: &str) -> Result<(Vec<(String, String)>, usize), EngineError> {
    let mut r = Reader::from_str(xml);
    let mut sheets: Vec<(String, String)> = Vec::new();
    let mut active = 0usize;
    let mut seen_names = std::collections::BTreeSet::new();
    loop {
        match r
            .read_event()
            .map_err(|e| EngineError::serialization(format!("malformed workbook.xml: {e}")))?
        {
            Event::Eof => break,
            Event::Start(e) | Event::Empty(e) => match local_name(e.name().as_ref()) {
                b"sheet" => {
                    let name = attr_val(&e, b"name")
                        .ok_or_else(|| EngineError::validation("xlsx sheet missing name"))?;
                    if name.is_empty() {
                        return Err(EngineError::validation("xlsx sheet name is empty"));
                    }
                    if !seen_names.insert(name.to_lowercase()) {
                        return Err(EngineError::validation(format!(
                            "xlsx has duplicate sheet name '{name}'"
                        )));
                    }
                    // `r:id` — local name "id"; the only id-carrying attr on
                    // `<sheet>` is the relationship id.
                    let rid = attr_val(&e, b"id")
                        .ok_or_else(|| EngineError::validation("xlsx sheet missing r:id"))?;
                    sheets.push((name, rid));
                    if sheets.len() > MAX_XLSX_SHEETS {
                        return Err(EngineError::out_of_bounds(format!(
                            "xlsx has more than {MAX_XLSX_SHEETS} sheets"
                        )));
                    }
                }
                b"workbookView" => {
                    if let Some(v) = attr_val(&e, b"activeTab") {
                        if let Ok(i) = v.parse::<usize>() {
                            active = i;
                        }
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    if sheets.is_empty() {
        return Err(EngineError::validation("xlsx workbook has no sheets"));
    }
    let active = active.min(sheets.len() - 1);
    Ok((sheets, active))
}

fn parse_rels(xml: &str) -> Result<BTreeMap<String, RelTarget>, EngineError> {
    let mut r = Reader::from_str(xml);
    let mut map = BTreeMap::new();
    loop {
        match r
            .read_event()
            .map_err(|e| EngineError::serialization(format!("malformed workbook rels: {e}")))?
        {
            Event::Eof => break,
            Event::Start(e) | Event::Empty(e) if local_name(e.name().as_ref()) == b"Relationship" => {
                let id = attr_val(&e, b"Id")
                    .ok_or_else(|| EngineError::validation("relationship missing Id"))?;
                let target = attr_val(&e, b"Target")
                    .ok_or_else(|| EngineError::validation("relationship missing Target"))?;
                let ty = attr_val(&e, b"Type").unwrap_or_default();
                let external = attr_val(&e, b"TargetMode").as_deref() == Some("External");
                map.insert(
                    id,
                    RelTarget {
                        worksheet: ty.ends_with("/worksheet"),
                        target,
                        external,
                    },
                );
            }
            _ => {}
        }
    }
    Ok(map)
}

/// Resolve a relationship `Target` (relative to `xl/`) to a package path.
fn resolve_target(target: &str) -> Result<String, EngineError> {
    let joined = if let Some(abs) = target.strip_prefix('/') {
        abs.to_string()
    } else {
        format!("xl/{target}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in joined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(EngineError::validation(
                        "xlsx relationship target escapes the package",
                    ));
                }
            }
            s => parts.push(s),
        }
    }
    if parts.is_empty() {
        return Err(EngineError::validation("xlsx relationship target is empty"));
    }
    Ok(parts.join("/"))
}

fn parse_shared_strings(xml: &str) -> Result<Vec<String>, EngineError> {
    let mut r = Reader::from_str(xml);
    let mut out: Vec<String> = Vec::new();
    let mut in_si = false;
    let mut in_t = false;
    let mut in_rph = false;
    let mut cur = String::new();
    loop {
        match r
            .read_event()
            .map_err(|e| EngineError::serialization(format!("malformed sharedStrings.xml: {e}")))?
        {
            Event::Eof => break,
            Event::Start(e) => match local_name(e.name().as_ref()) {
                b"si" if !in_si => in_si = true,
                b"t" if in_si => in_t = true,
                b"rPh" if in_si => in_rph = true,
                _ => {}
            },
            Event::End(e) => match local_name(e.name().as_ref()) {
                b"si" if in_si => {
                    in_si = false;
                    in_t = false;
                    out.push(std::mem::take(&mut cur));
                    if out.len() > MAX_SHARED_STRINGS {
                        return Err(EngineError::out_of_bounds(format!(
                            "xlsx sharedStrings exceeds {MAX_SHARED_STRINGS} entries"
                        )));
                    }
                }
                b"t" => in_t = false,
                b"rPh" => in_rph = false,
                _ => {}
            },
            Event::Text(e) if in_si && in_t && !in_rph => {
                if let Ok(t) = e.unescape() {
                    cur.push_str(&t);
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

/// Per-cell accumulation while streaming `sheetData`.
#[derive(Default)]
struct CellAcc {
    /// Cell type attribute (`s`, `inlineStr`, `str`, `b`, `e`, `n`, or "").
    t: String,
    /// `<f>` text (None = no formula element seen).
    f: Option<String>,
    /// `<v>` text.
    v: String,
    /// `<is>` inline-string text.
    is: String,
    in_is: bool,
    in_rph: bool,
}

/// Parse one worksheet part into cells + merges.
#[allow(unused_assignments)] // finish_cell! resets state; the tail call writes are intentionally dead
fn parse_sheet(
    xml: &str,
    shared: &[String],
    cell_budget: &mut u64,
) -> Result<(BTreeMap<String, Cell>, Vec<MergeRegion>), EngineError> {
    let mut r = Reader::from_str(xml);
    let mut cells: BTreeMap<String, Cell> = BTreeMap::new();
    let mut merges: Vec<MergeRegion> = Vec::new();
    let mut in_sheetdata = false;
    let mut in_c = false;
    let mut acc = CellAcc::default();
    let mut cell_addr: Option<(u32, u32)> = None;
    // Positional fallbacks for producers that omit `r`.
    let mut row_cursor: Option<u32> = None;
    let mut col_cursor: u32 = 0;
    let mut in_f = false;
    let mut in_v = false;

    macro_rules! finish_cell {
        () => {{
            if let Some((c, r)) = cell_addr {
                let raw = cell_raw(&acc, shared)?;
                if let Some(raw) = raw {
                    *cell_budget += 1;
                    if *cell_budget > MAX_IMPORT_XLSX_CELLS {
                        return Err(EngineError::out_of_bounds(format!(
                            "xlsx import exceeds the {MAX_IMPORT_XLSX_CELLS}-cell budget"
                        )));
                    }
                    cells.insert(fmt_addr(c, r), Cell { raw });
                }
            }
            acc = CellAcc::default();
            cell_addr = None;
            in_f = false;
            in_v = false;
        }};
    }

    loop {
        let event = r
            .read_event()
            .map_err(|e| EngineError::serialization(format!("malformed worksheet XML: {e}")))?;
        match event {
            Event::Eof => break,
            Event::Start(e) => {
                let qname = e.name();
                let name = local_name(qname.as_ref());
                if !in_c {
                    match name {
                        b"sheetData" => in_sheetdata = true,
                        b"row" if in_sheetdata => {
                            row_cursor = Some(match attr_val(&e, b"r") {
                                Some(v) => {
                                    let n: u64 = v.parse().map_err(|_| {
                                        EngineError::validation("xlsx row r is not an integer")
                                    })?;
                                    if n == 0 || n > u64::from(SHEET_MAX_ROWS) {
                                        return Err(EngineError::validation(
                                            "xlsx row r out of range",
                                        ));
                                    }
                                    (n - 1) as u32
                                }
                                None => row_cursor.map(|p| p + 1).unwrap_or(0),
                            });
                            col_cursor = 0;
                        }
                        b"mergeCell" => {
                            let reference = attr_val(&e, b"ref").ok_or_else(|| {
                                EngineError::validation("xlsx mergeCell missing ref")
                            })?;
                            merges.push(parse_merge_ref(&reference)?);
                            if merges.len() > struct_ops::MAX_MERGES {
                                return Err(EngineError::out_of_bounds(format!(
                                    "xlsx merges exceed {}",
                                    struct_ops::MAX_MERGES
                                )));
                            }
                        }
                        b"c" if in_sheetdata => {
                            in_c = true;
                            acc.t = attr_val(&e, b"t").unwrap_or_default();
                            cell_addr = match attr_val(&e, b"r") {
                                Some(v) => {
                                    let (c, rr) = parse_addr(&v).ok_or_else(|| {
                                        EngineError::validation(format!(
                                            "xlsx cell ref '{v}' is invalid"
                                        ))
                                    })?;
                                    if !on_sheet(c, rr) {
                                        return Err(EngineError::out_of_bounds(format!(
                                            "xlsx cell '{v}' is past the sheet"
                                        )));
                                    }
                                    Some((c, rr))
                                }
                                None => {
                                    let rr = row_cursor.ok_or_else(|| {
                                        EngineError::validation(
                                            "xlsx cell without r outside a row",
                                        )
                                    })?;
                                    let c = col_cursor;
                                    if c >= SHEET_MAX_COLUMNS {
                                        return Err(EngineError::out_of_bounds(
                                            "xlsx row overflows the column limit",
                                        ));
                                    }
                                    Some((c, rr))
                                }
                            };
                            if let Some((c, _)) = cell_addr {
                                col_cursor = c + 1;
                            }
                        }
                        _ => {}
                    }
                } else {
                    match name {
                        b"f" => {
                            // Shared/array/dataTable formulas have no cell
                            // text on followers — reject rather than lose.
                            if let Some(t) = attr_val(&e, b"t") {
                                if t != "normal" {
                                    return Err(EngineError::unsupported(format!(
                                        "xlsx formula type '{t}' is not supported"
                                    )));
                                }
                            }
                            acc.f = Some(String::new());
                            in_f = true;
                        }
                        b"v" => in_v = true,
                        b"is" => acc.in_is = true,
                        b"rPh" => acc.in_rph = true,
                        _ => {}
                    }
                }
            }
            Event::Empty(e) => {
                let qname = e.name();
                let name = local_name(qname.as_ref());
                if !in_c && in_sheetdata && name == b"c" {
                    // Self-closing cell: styled-only, no content — skip.
                } else if !in_c {
                    match name {
                        b"sheetData" => in_sheetdata = true,
                        b"mergeCell" => {
                            let reference = attr_val(&e, b"ref").ok_or_else(|| {
                                EngineError::validation("xlsx mergeCell missing ref")
                            })?;
                            merges.push(parse_merge_ref(&reference)?);
                            if merges.len() > struct_ops::MAX_MERGES {
                                return Err(EngineError::out_of_bounds(format!(
                                    "xlsx merges exceed {}",
                                    struct_ops::MAX_MERGES
                                )));
                            }
                        }
                        b"row" => {
                            row_cursor = Some(match attr_val(&e, b"r") {
                                Some(v) => {
                                    let n: u64 = v.parse().map_err(|_| {
                                        EngineError::validation("xlsx row r is not an integer")
                                    })?;
                                    if n == 0 || n > u64::from(SHEET_MAX_ROWS) {
                                        return Err(EngineError::validation(
                                            "xlsx row r out of range",
                                        ));
                                    }
                                    (n - 1) as u32
                                }
                                None => row_cursor.map(|p| p + 1).unwrap_or(0),
                            });
                            col_cursor = 0;
                        }
                        _ => {}
                    }
                } else {
                    match name {
                        b"f" => {
                            if let Some(t) = attr_val(&e, b"t") {
                                if t != "normal" {
                                    return Err(EngineError::unsupported(format!(
                                        "xlsx formula type '{t}' is not supported"
                                    )));
                                }
                            }
                            // `<f/>` with no text → empty formula → reject
                            // at finalize via cell_raw.
                            acc.f = Some(String::new());
                            in_f = false;
                        }
                        b"v" | b"is" | b"rPh" => {}
                        _ => {}
                    }
                }
            }
            Event::Text(e) => {
                if in_c {
                    if in_f {
                        if let Ok(t) = e.unescape() {
                            if let Some(f) = &mut acc.f {
                                f.push_str(&t);
                            }
                        }
                    } else if in_v {
                        if let Ok(t) = e.unescape() {
                            acc.v.push_str(&t);
                        }
                    } else if acc.in_is && !acc.in_rph {
                        if let Ok(t) = e.unescape() {
                            acc.is.push_str(&t);
                        }
                    }
                }
            }
            Event::End(e) => {
                let qname = e.name();
                let name = local_name(qname.as_ref());
                if in_c {
                    match name {
                        b"f" => in_f = false,
                        b"v" => in_v = false,
                        b"is" => acc.in_is = false,
                        b"rPh" => acc.in_rph = false,
                        b"c" => {
                            finish_cell!();
                            in_c = false;
                        }
                        _ => {}
                    }
                } else if in_sheetdata {
                    match name {
                        b"sheetData" => in_sheetdata = false,
                        b"row" => {}
                        _ => {}
                    }
                } else {
                    match name {
                        b"mergeCell" => {}
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    // A file truncated mid-cell still finalizes what it has; malformed XML
    // already errored above.
    if in_c {
        finish_cell!();
    }

    // Merge regions: normalize + field checks + pairwise overlap.
    for m in &mut merges {
        if m.c0 > m.c1 {
            std::mem::swap(&mut m.c0, &mut m.c1);
        }
        if m.r0 > m.r1 {
            std::mem::swap(&mut m.r0, &mut m.r1);
        }
        if !struct_ops::merge_ok(m) {
            return Err(EngineError::validation("xlsx merge region is invalid"));
        }
    }
    for i in 0..merges.len() {
        for j in (i + 1)..merges.len() {
            let (a, b) = (&merges[i], &merges[j]);
            if a.c0 <= b.c1 && b.c0 <= a.c1 && a.r0 <= b.r1 && b.r0 <= a.r1 {
                return Err(EngineError::validation("xlsx merge regions overlap"));
            }
        }
    }
    Ok((cells, merges))
}

/// `"A1:B2"` → normalized `MergeRegion` (0-based inclusive).
fn parse_merge_ref(reference: &str) -> Result<MergeRegion, EngineError> {
    let (a, b) = reference.split_once(':').ok_or_else(|| {
        EngineError::validation(format!("xlsx merge ref '{reference}' is not a range"))
    })?;
    let (c0, r0) = parse_addr(a)
        .ok_or_else(|| EngineError::validation(format!("xlsx merge ref '{reference}' is invalid")))?;
    let (c1, r1) = parse_addr(b)
        .ok_or_else(|| EngineError::validation(format!("xlsx merge ref '{reference}' is invalid")))?;
    if !on_sheet(c0, r0) || !on_sheet(c1, r1) {
        return Err(EngineError::out_of_bounds(format!(
            "xlsx merge '{reference}' is past the sheet"
        )));
    }
    Ok(MergeRegion {
        c0: c0.min(c1),
        r0: r0.min(r1),
        c1: c0.max(c1),
        r1: r0.max(r1),
    })
}

/// Final raw text for one accumulated cell, or `None` to skip it.
fn cell_raw(acc: &CellAcc, shared: &[String]) -> Result<Option<String>, EngineError> {
    if let Some(f) = &acc.f {
        if f.is_empty() {
            return Err(EngineError::validation("xlsx cell has an empty formula"));
        }
        return Ok(Some(format!("={f}")));
    }
    match acc.t.as_str() {
        "" | "n" => {
            let v = acc.v.trim();
            if v.is_empty() {
                return Ok(None);
            }
            match v.parse::<f64>() {
                Ok(n) if n.is_finite() => Ok(Some(v.to_string())),
                _ => Err(EngineError::validation(format!(
                    "xlsx numeric cell value '{v}' is not a finite number"
                ))),
            }
        }
        "s" => {
            let idx: usize = acc.v.trim().parse().map_err(|_| {
                EngineError::validation("xlsx shared-string index is not an integer")
            })?;
            let s = shared.get(idx).ok_or_else(|| {
                EngineError::validation("xlsx shared-string index out of range")
            })?;
            if s.is_empty() {
                Ok(None)
            } else {
                Ok(Some(s.clone()))
            }
        }
        "inlineStr" => {
            if acc.is.is_empty() {
                Ok(None)
            } else {
                Ok(Some(acc.is.clone()))
            }
        }
        "str" => {
            if acc.v.is_empty() {
                Ok(None)
            } else {
                Ok(Some(acc.v.clone()))
            }
        }
        "b" => match acc.v.trim() {
            "1" | "true" | "TRUE" => Ok(Some("TRUE".to_string())),
            "0" | "false" | "FALSE" => Ok(Some("FALSE".to_string())),
            other => Err(EngineError::validation(format!(
                "xlsx boolean cell value '{other}' is not 0/1"
            ))),
        },
        "e" => {
            let v = acc.v.trim();
            if ERR_LITERALS.contains(&v) {
                Ok(Some(format!("={v}")))
            } else {
                Err(EngineError::validation(format!(
                    "xlsx error cell value '{v}' is not a known error literal"
                )))
            }
        }
        other => Err(EngineError::unsupported(format!(
            "xlsx cell type '{other}' is not supported"
        ))),
    }
}

/// Decode `.xlsx` bytes into `(sheets, active_index)`. Fully validates
/// before returning; the caller commits atomically.
pub fn import_xlsx(bytes: &[u8]) -> Result<(Vec<XlsxSheet>, usize), EngineError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| EngineError::serialization(format!("invalid xlsx zip: {e}")))?;
    if archive.len() > MAX_XLSX_ENTRIES {
        return Err(EngineError::out_of_bounds(format!(
            "xlsx archive has {} entries, over the {MAX_XLSX_ENTRIES} limit",
            archive.len()
        )));
    }
    let mut total: u64 = 0;
    let workbook = read_part(&mut archive, "xl/workbook.xml", &mut total)?;
    let (sheet_refs, active) = parse_workbook(&workbook)?;
    let rels_xml = read_part(&mut archive, "xl/_rels/workbook.xml.rels", &mut total)?;
    let rels = parse_rels(&rels_xml)?;
    // sharedStrings is optional; probe first so the ZipFile borrow ends
    // before read_part re-borrows the archive.
    enum Probe {
        Present,
        Absent,
    }
    let probe = match archive.by_name("xl/sharedStrings.xml") {
        Ok(_) => Probe::Present,
        Err(zip::result::ZipError::FileNotFound) => Probe::Absent,
        Err(e) => {
            return Err(EngineError::serialization(format!(
                "xlsx sharedStrings.xml unreadable: {e}"
            )))
        }
    };
    let shared = match probe {
        Probe::Present => {
            let xml = read_part(&mut archive, "xl/sharedStrings.xml", &mut total)?;
            parse_shared_strings(&xml)?
        }
        Probe::Absent => Vec::new(),
    };
    let mut sheets = Vec::with_capacity(sheet_refs.len());
    let mut cell_budget: u64 = 0;
    for (name, rid) in &sheet_refs {
        let rel = rels.get(rid).ok_or_else(|| {
            EngineError::validation(format!("xlsx sheet '{name}' references missing rel '{rid}'"))
        })?;
        if !rel.worksheet {
            return Err(EngineError::unsupported(format!(
                "xlsx sheet '{name}' is not a worksheet"
            )));
        }
        if rel.external {
            return Err(EngineError::unsupported(format!(
                "xlsx sheet '{name}' targets an external part"
            )));
        }
        let path = resolve_target(&rel.target)?;
        let xml = read_part(&mut archive, &path, &mut total)?;
        let (cells, merges) = parse_sheet(&xml, &shared, &mut cell_budget)?;
        sheets.push(XlsxSheet {
            name: name.clone(),
            cells,
            merges,
        });
    }
    Ok((sheets, active))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::Engine;

    fn apply(e: &mut TallyEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn apply_err(e: &mut TallyEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }
    fn raw(e: &mut TallyEngine, addr: &str) -> Value {
        apply(e, "getCell", json!({"addr": addr})).data["raw"].clone()
    }
    fn computed(e: &mut TallyEngine, addr: &str) -> Value {
        apply(e, "getCell", json!({"addr": addr})).data["computed"].clone()
    }
    /// Hand-built minimal workbook (no sharedStrings, inline strings).
    fn fixture_xlsx() -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut put = |name: &str, body: &str| {
            zip.start_file(name, opts).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        };
        put("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
        put("xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Data\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"Second\" sheetId=\"2\" r:id=\"rId2\"/></sheets><bookViews><workbookView activeTab=\"1\"/></bookViews></workbook>");
        put("xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/></Relationships>");
        put("xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>name</t></is></c><c r=\"B1\"><v>42</v></c></row><row r=\"2\"><c r=\"A2\"><f>B1*2</f><v>84</v></c><c r=\"B2\" t=\"b\"><v>1</v></c><c r=\"C2\" t=\"e\"><v>#DIV/0!</v></c></row></sheetData><mergeCells count=\"1\"><mergeCell ref=\"A4:B5\"/></mergeCells></worksheet>");
        put("xl/worksheets/sheet2.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>other</t></is></c></row></sheetData></worksheet>");
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn import_xlsx_replaces_workbook_with_sheets_cells_merges() {
        let mut e = TallyEngine::new();
        apply(&mut e, "setCell", json!({"addr":"Z9","value":"old"}));
        let r = apply(&mut e, "importXlsx", json!({"bytes_b64": crate::base64_encode(&fixture_xlsx())}));
        assert_eq!(r.data["sheets"], 2);
        assert!(r.data["cells"].as_u64().unwrap() >= 5);
        // Whole-workbook replace: old content gone, sheets by XLSX name.
        assert_eq!(raw(&mut e, "Z9"), "");
        // activeTab=1 → "Second" is active; switch to Data.
        assert_eq!(
            apply(&mut e, "workbook", json!({})).data["active"],
            json!(1)
        );
        apply(&mut e, "setActive", json!({"sheet": "Data"}));
        assert_eq!(raw(&mut e, "A1"), "name");
        assert_eq!(computed(&mut e, "B1"), 42.0);
        assert_eq!(raw(&mut e, "A2"), "=B1*2");
        assert_eq!(computed(&mut e, "A2"), 84.0);
        assert_eq!(raw(&mut e, "B2"), "TRUE");
        assert_eq!(computed(&mut e, "C2"), "#DIV/0!");
        // Merge imported.
        let merges = apply(&mut e, "listMergedCells", json!({})).data["merges"].clone();
        assert_eq!(merges.as_array().unwrap().len(), 1);
        assert_eq!(merges[0]["from"], "A4");
        // Second sheet content.
        apply(&mut e, "setActive", json!({"sheet": "Second"}));
        assert_eq!(raw(&mut e, "A1"), "other");
        // Three undo entries sit above the import's Reset (two setActive
        // calls); popping them plus the Reset restores the pre-import
        // workbook — old Sheet1 with Z9.
        for _ in 0..3 {
            assert!(e.undo().unwrap());
        }
        assert_eq!(raw(&mut e, "Z9"), "old");
        assert_eq!(
            apply(&mut e, "workbook", json!({})).data["sheets"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        // Redo walks back to the imported workbook.
        assert!(e.redo().unwrap()); // Reset → imported doc
        assert!(e.redo().unwrap()); // setActive Data
        assert!(e.redo().unwrap()); // setActive Second
        apply(&mut e, "setActive", json!({"sheet": "Data"}));
        assert_eq!(raw(&mut e, "A1"), "name");
    }

    #[test]
    fn import_xlsx_shared_strings_and_positional_cells() {
        let xml = r#"<worksheet xmlns="x"><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>7</v></c></row></sheetData></worksheet>"#;
        let shared = "<sst xmlns=\"x\"><si><t>alpha</t></si><si><r><t>beta</t></r><r><t>gamma</t></r></si></sst>";
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        for (n, b) in [
            ("xl/workbook.xml", "<workbook xmlns:r=\"x\"><sheets><sheet name=\"S\" r:id=\"rId1\"/></sheets></workbook>"),
            ("xl/_rels/workbook.xml.rels", "<Relationships><Relationship Id=\"rId1\" Type=\"http://x/worksheet\" Target=\"worksheets/s1.xml\"/></Relationships>"),
            ("xl/sharedStrings.xml", shared),
            ("xl/worksheets/s1.xml", xml),
        ] {
            zip.start_file(n, opts).unwrap();
            zip.write_all(b.as_bytes()).unwrap();
        }
        let bytes = zip.finish().unwrap().into_inner();
        let mut e = TallyEngine::new();
        apply(&mut e, "importXlsx", json!({"bytes_b64": crate::base64_encode(&bytes)}));
        // Positional cells (no r attrs): A1=alpha, B1=betagamma, A2=7.
        assert_eq!(raw(&mut e, "A1"), "alpha");
        assert_eq!(raw(&mut e, "B1"), "betagamma");
        assert_eq!(computed(&mut e, "A2"), 7.0);
    }

    #[test]
    fn export_xlsx_round_trips_values_formulas_formats_merges() {
        let mut e = TallyEngine::new();
        apply(&mut e, "setCell", json!({"addr":"A1","value":"item"}));
        apply(&mut e, "setCell", json!({"addr":"B1","value":3}));
        apply(&mut e, "setCell", json!({"addr":"A2","value":"=B1*2"}));
        apply(&mut e, "setCell", json!({"addr":"B2","value":"note & <tag>"}));
        apply(&mut e, "setFormat", json!({"cells":["A1"],"format":{"bold":true,"fill":"#FF0000"}}));
        apply(&mut e, "mergeCells", json!({"range":{"from":"D1","to":"E2"}}));
        let r = apply(&mut e, "exportXlsx", json!({}));
        let bytes_b64 = r.data["bytes_b64"].as_str().unwrap().to_string();
        // Decode via import into a fresh engine.
        let mut e2 = TallyEngine::new();
        apply(&mut e2, "importXlsx", json!({"bytes_b64": bytes_b64}));
        assert_eq!(raw(&mut e2, "A1"), "item");
        assert_eq!(computed(&mut e2, "B1"), 3.0);
        assert_eq!(raw(&mut e2, "A2"), "=B1*2");
        assert_eq!(computed(&mut e2, "A2"), 6.0);
        assert_eq!(raw(&mut e2, "B2"), "note & <tag>");
        let fmt = apply(&mut e2, "getCell", json!({"addr":"A1"})).data;
        // Formats are exported to styles.xml but NOT imported (documented).
        assert!(fmt.get("format").is_none());
        let merges = apply(&mut e2, "listMergedCells", json!({})).data["merges"].clone();
        assert_eq!(merges.as_array().unwrap().len(), 1);
        assert_eq!(merges[0]["from"], "D1");
        // Inspect the archive parts directly.
        let bytes = crate::base64_decode(&bytes_b64).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(&bytes[..])).unwrap();
        let mut styles = String::new();
        zip.by_name("xl/styles.xml").unwrap().read_to_string(&mut styles).unwrap();
        assert!(styles.contains("<b/>") && styles.contains("FF0000"));
        let mut sheet = String::new();
        zip.by_name("xl/worksheets/sheet1.xml").unwrap().read_to_string(&mut sheet).unwrap();
        assert!(sheet.contains("<f>B1*2</f><v>6</v>"));
        assert!(sheet.contains("t=\"inlineStr\""));
    }

    #[test]
    fn export_xlsx_rejects_invalid_sheet_names() {
        let mut e = TallyEngine::new();
        apply(&mut e, "renameSheet", json!({"sheet":0,"to":"Bad/Name"}));
        let err = apply_err(&mut e, "exportXlsx", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    #[test]
    fn import_xlsx_rejects_hostile_and_malformed_atomically() {
        let mut e = TallyEngine::new();
        apply(&mut e, "setCell", json!({"addr":"A1","value":"keep"}));
        let before = e.snapshot().unwrap();
        for bad in [
            b"not a zip".to_vec(),
            fixture_xlsx()[..20].to_vec(), // truncated
        ] {
            apply_err(&mut e, "importXlsx", json!({"bytes_b64": crate::base64_encode(&bad)}));
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Formula with shared type rejects.
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("xl/workbook.xml", opts).unwrap();
        zip.write_all(b"<workbook><sheets><sheet name=\"S\" r:id=\"rId1\"/></sheets></workbook>").unwrap();
        zip.start_file("xl/_rels/workbook.xml.rels", opts).unwrap();
        zip.write_all(b"<Relationships><Relationship Id=\"rId1\" Type=\"http://x/worksheet\" Target=\"worksheets/s1.xml\"/></Relationships>").unwrap();
        zip.start_file("xl/worksheets/s1.xml", opts).unwrap();
        zip.write_all(b"<worksheet><sheetData><row><c r=\"A1\"><f t=\"shared\" si=\"0\">B1</f></c></row></sheetData></worksheet>").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let err = apply_err(&mut e, "importXlsx", json!({"bytes_b64": crate::base64_encode(&bytes)}));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        assert_eq!(e.snapshot().unwrap(), before);
        // Unknown cell type rejects.
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("xl/workbook.xml", opts).unwrap();
        zip.write_all(b"<workbook><sheets><sheet name=\"S\" r:id=\"rId1\"/></sheets></workbook>").unwrap();
        zip.start_file("xl/_rels/workbook.xml.rels", opts).unwrap();
        zip.write_all(b"<Relationships><Relationship Id=\"rId1\" Type=\"http://x/worksheet\" Target=\"worksheets/s1.xml\"/></Relationships>").unwrap();
        zip.start_file("xl/worksheets/s1.xml", opts).unwrap();
        zip.write_all(b"<worksheet><sheetData><row><c r=\"A1\" t=\"d\"><v>2020-01-01</v></c></row></sheetData></worksheet>").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let err = apply_err(&mut e, "importXlsx", json!({"bytes_b64": crate::base64_encode(&bytes)}));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        assert_eq!(e.snapshot().unwrap(), before);
        assert_eq!(raw(&mut e, "A1"), "keep");
    }

    #[test]
    fn import_xlsx_respects_sheet_protection() {
        let mut e = TallyEngine::new();
        apply(&mut e, "protectSheet", json!({"sheet":0,"protected":true}));
        let before = e.snapshot().unwrap();
        let err = apply_err(&mut e, "importXlsx", json!({"bytes_b64": crate::base64_encode(&fixture_xlsx())}));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn import_xlsx_binary_sidecar_and_b64_mutex() {
        // Binary sidecar path (the nf_v1_apply_binary equivalent at the
        // Command level): no bytes_b64 field needed.
        let mut e = TallyEngine::new();
        e.apply(Command::new("importXlsx", json!({})).with_binary(Some(fixture_xlsx())))
            .unwrap();
        // activeTab=1 → "Second" is active and holds "other" at A1.
        assert_eq!(raw(&mut e, "A1"), "other");
        // bytes_b64 and the binary sidecar together reject.
        let mut e2 = TallyEngine::new();
        let err = e2
            .apply(
                Command::new("importXlsx", json!({"bytes_b64": "eA=="}))
                    .with_binary(Some(fixture_xlsx())),
            )
            .unwrap_err();
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
    }
}
