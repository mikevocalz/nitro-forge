//! Delimited text import/export (`importCsv`/`importTsv`, `exportCsv`/
//! `exportTsv`). Engines are I/O-free, so the op payload carries the file
//! *text* — never a path — and export returns the text in `data`.
//!
//! Semantics documented for reviewers:
//! * One parser serves both delimiters (`,` for CSV, `\t` for TSV). Fields
//!   follow RFC 4180 quoting: a field opening with `"` reads to its closing
//!   quote, `""` inside is a literal quote, and embedded CR/LF are allowed.
//!   After a closing quote only the delimiter, a record break or EOF may
//!   follow — anything else rejects the whole import. A `"` appearing
//!   inside an *unquoted* field is kept literally (lenient, like Excel).
//! * Record breaks accept CRLF, LF and lone CR. One leading UTF-8 BOM is
//!   stripped. A completely empty line (zero characters before the break)
//!   produces no row at all — blank lines are skipped, matching Excel —
//!   while a line of delimiters (`",,"`) is a real row of empty fields.
//! * There is no header handling: every parsed row is data, written
//!   verbatim starting at `at` (default `A1`) on `sheet` (default active).
//!   Hosts that want a header row skipped choose the anchor or drop the
//!   row themselves.
//! * Field text is stored as raw cell text exactly like `setRange`: `=`-
//!   prefixed fields become formulas, numeric-looking text computes as
//!   numbers, and empty fields clear the target cell. Rows are ragged —
//!   each row writes only its own fields; cells to the right of a short
//!   row's last field are untouched.
//! * Import is atomic: the text is size-checked, fully parsed and fully
//!   bounds-checked before `commit_cells_on_sheet` stages the write, so a
//!   malformed or oversized file mutates nothing and journals nothing.
//!   One undo entry covers the whole import.
//! * Export is a silent read of computed values over a rectangle — the
//!   explicit `range` or, absent that, the bounding box of the sheet's
//!   used cells. Both are capped at the shared 16,384-cell bound; a used
//!   rectangle larger than that rejects with `out_of_bounds` (pass an
//!   explicit `range`). Quoting mirrors RFC 4180: a field is quoted when
//!   it contains the delimiter, a quote or a line break, `"` escapes as
//!   `""`, rows join with CRLF and the text ends with a trailing CRLF.
//!   Number/boolean/error values export in their display text form
//!   (`fmt_num`, `TRUE`/`FALSE`, the `#…!` literal); empty cells export
//!   as empty fields. Number formats are ignored — this is the computed
//!   value, not the formatted display.

use super::range_ops::Rect;
use super::*;
use formula::{fmt_addr, fmt_num, parse_addr, on_sheet, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS};

/// Import payload cap: the file text travels inside one JSON command.
const MAX_IMPORT_TEXT_BYTES: usize = 16 * 1024 * 1024;
/// Total parsed fields one import may write (sparse `",,,…"` rows are the
/// hostile case — the byte cap alone would allow ~8M empty fields).
const MAX_IMPORT_CELLS: u64 = 1_048_576;

fn off_sheet() -> EngineError {
    EngineError::out_of_bounds("import extends past the sheet (XFD1048576)")
}

/// Parse delimited text into rows of field strings. `delim` is the ASCII
/// field separator (`,` or `\t`). Strict about quoted-field structure;
/// see the module docs for the documented leniencies.
fn parse_delimited(text: &str, delim: u8) -> Result<Vec<Vec<String>>, EngineError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let b = text.as_bytes();
    let n = b.len();
    let mut i = 0usize;
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut total_cells: u64 = 0u64;
    while i < n {
        // A record break at the record start is a blank line: skip it.
        if b[i] == b'\n' {
            i += 1;
            continue;
        }
        if b[i] == b'\r' {
            i += if i + 1 < n && b[i + 1] == b'\n' { 2 } else { 1 };
            continue;
        }
        let mut row: Vec<String> = Vec::new();
        loop {
            let mut field = String::new();
            if i < n && b[i] == b'"' {
                i += 1;
                let mut seg = i;
                let mut closed = false;
                while i < n {
                    if b[i] == b'"' {
                        if i + 1 < n && b[i + 1] == b'"' {
                            field.push_str(&text[seg..i]);
                            field.push('"');
                            i += 2;
                            seg = i;
                        } else {
                            field.push_str(&text[seg..i]);
                            i += 1;
                            closed = true;
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
                if !closed {
                    return Err(EngineError::validation(
                        "unterminated quoted field in import text",
                    ));
                }
                if i < n && b[i] != delim && b[i] != b'\n' && b[i] != b'\r' {
                    return Err(EngineError::validation(
                        "unexpected data after closing quote in import text",
                    ));
                }
            } else {
                let start = i;
                while i < n && b[i] != delim && b[i] != b'\n' && b[i] != b'\r' {
                    i += 1;
                }
                field.push_str(&text[start..i]);
            }
            total_cells += 1;
            if total_cells > MAX_IMPORT_CELLS {
                return Err(EngineError::out_of_bounds(format!(
                    "import exceeds the {MAX_IMPORT_CELLS}-cell budget"
                )));
            }
            row.push(field);
            if i >= n {
                break;
            }
            match b[i] {
                d if d == delim => {
                    i += 1;
                    // A trailing delimiter at EOF still yields its empty field.
                }
                b'\n' => {
                    i += 1;
                    break;
                }
                b'\r' => {
                    i += if i + 1 < n && b[i + 1] == b'\n' { 2 } else { 1 };
                    break;
                }
                _ => unreachable!("field scan stops only at delimiter or break"),
            }
        }
        rows.push(row);
        if rows.len() as u64 > u64::from(SHEET_MAX_ROWS) {
            return Err(EngineError::out_of_bounds(
                "import exceeds the sheet row count",
            ));
        }
    }
    Ok(rows)
}

/// RFC 4180 field quoting: quote when the field holds the delimiter, a
/// quote or a line break; `"` escapes as `""`.
fn export_field(field: &str, delim: u8) -> String {
    let needs_quotes = field
        .bytes()
        .any(|b| b == delim || b == b'"' || b == b'\n' || b == b'\r');
    if !needs_quotes {
        return field.to_string();
    }
    let mut out = String::with_capacity(field.len() + 2);
    out.push('"');
    for ch in field.chars() {
        if ch == '"' {
            out.push_str("\"\"");
        } else {
            out.push(ch);
        }
    }
    out.push('"');
    out
}

/// Display text of a computed value for export: numbers via `fmt_num`,
/// booleans `TRUE`/`FALSE`, errors their literal, empty the empty string.
fn export_text(v: &formula::Value) -> String {
    match v {
        formula::Value::Empty => String::new(),
        formula::Value::Num(n) if n.is_finite() => fmt_num(*n),
        formula::Value::Num(_) => formula::ERR_NUM.to_string(),
        formula::Value::Str(s) => s.clone(),
        formula::Value::Bool(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        formula::Value::Err(e) => (*e).to_string(),
        // `eval_cell` scalarizes range results to `#VALUE!`; a `List`
        // here would be an engine bug, not user input.
        formula::Value::List(_) => formula::ERR_VALUE.to_string(),
    }
}

impl TallyEngine {
    /// Shared body of `importCsv`/`importTsv`; `delim` is `b','` or `b'\t'`.
    pub(super) fn op_import_delimited(
        &mut self,
        p: &Value,
        delim: u8,
    ) -> Result<CommandResult, EngineError> {
        let text = Self::str_field(p, "text")?;
        if text.len() > MAX_IMPORT_TEXT_BYTES {
            return Err(EngineError::validation(format!(
                "import text exceeds the {} MiB limit",
                MAX_IMPORT_TEXT_BYTES / (1024 * 1024)
            )));
        }
        let index = self.sheet_index(p)?;
        let (c0, r0) = match p.get("at") {
            None | Some(Value::Null) => (0, 0),
            Some(_) => Self::addr_coords(p, "at")?,
        };
        let rows = parse_delimited(text, delim)?;
        if rows.is_empty() {
            return Ok(Self::readonly(json!({ "changed": 0, "rows": 0 })));
        }
        let row_count = rows.len() as u64;
        if u64::from(r0) + row_count > u64::from(SHEET_MAX_ROWS) {
            return Err(off_sheet());
        }
        let max_width = rows.iter().map(Vec::len).max().unwrap_or(0) as u64;
        if u64::from(c0) + max_width > u64::from(SHEET_MAX_COLUMNS) {
            return Err(off_sheet());
        }
        // Pre-filter against current raws so the staged write (and the undo
        // entry built from it) only carries cells that actually change —
        // sparse `",,,…"` imports over an empty sheet stay small.
        let sheet = &self.doc.sheets[index];
        let mut staged: Vec<(String, String)> = Vec::new();
        for (ri, row) in rows.iter().enumerate() {
            for (ci, raw) in row.iter().enumerate() {
                let addr = fmt_addr(c0 + ci as u32, r0 + ri as u32);
                let current = sheet
                    .cells
                    .get(&addr)
                    .map(|cell| cell.raw.as_str())
                    .unwrap_or("");
                if current != raw {
                    staged.push((addr, raw.clone()));
                }
            }
        }
        let mut result = self.commit_cells_on_sheet(index, staged);
        if let Value::Object(map) = &mut result.data {
            map.insert("rows".to_string(), json!(row_count));
        }
        Ok(result)
    }

    /// Shared body of `exportCsv`/`exportTsv`; `delim` is `b','` or `b'\t'`.
    pub(super) fn op_export_delimited(
        &self,
        p: &Value,
        delim: u8,
    ) -> Result<CommandResult, EngineError> {
        let index = self.sheet_index(p)?;
        let sheet = &self.doc.sheets[index];
        let (c0, r0, c1, r1) = match p.get("range") {
            None | Some(Value::Null) => {
                // Bounding box of the used cells; an empty sheet exports "".
                let mut bounds: Option<(u32, u32, u32, u32)> = None;
                for key in sheet.cells.keys() {
                    if let Some((c, r)) = parse_addr(key).filter(|&(c, r)| on_sheet(c, r)) {
                        bounds = Some(match bounds {
                            None => (c, r, c, r),
                            Some((bc0, br0, bc1, br1)) => {
                                (bc0.min(c), br0.min(r), bc1.max(c), br1.max(r))
                            }
                        });
                    }
                }
                match bounds {
                    None => {
                        return Ok(Self::readonly(
                            json!({ "text": "", "rows": 0, "cols": 0 }),
                        ))
                    }
                    Some(b) => b,
                }
            }
            Some(range) => {
                let rect = Rect::read(range)?;
                rect.coords()
            }
        };
        let width = u64::from(c1 - c0) + 1;
        let height = u64::from(r1 - r0) + 1;
        if width.saturating_mul(height) > MAX_GET_RANGE_CELLS {
            return Err(EngineError::out_of_bounds(format!(
                "export range {width}x{height} exceeds the {MAX_GET_RANGE_CELLS}-cell limit; \
                 pass a smaller explicit range"
            )));
        }
        let mut ev = self.evaluator_for(index);
        let mut out = String::new();
        for r in r0..=r1 {
            let mut first = true;
            for c in c0..=c1 {
                if !first {
                    out.push(delim as char);
                }
                first = false;
                let v = ev.eval_cell(&fmt_addr(c, r));
                out.push_str(&export_field(&export_text(&v), delim));
            }
            out.push_str("\r\n");
        }
        Ok(Self::readonly(json!({
            "text": out,
            "rows": height,
            "cols": width,
        })))
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
    fn raw(e: &mut TallyEngine, addr: &str) -> Value {
        apply(e, "getCell", json!({"addr": addr})).data["raw"].clone()
    }
    fn computed(e: &mut TallyEngine, addr: &str) -> Value {
        apply(e, "getCell", json!({"addr": addr})).data["computed"].clone()
    }

    #[test]
    fn import_csv_writes_verbatim_and_types_like_setcell() {
        let mut e = TallyEngine::new();
        let r = apply(
            &mut e,
            "importCsv",
            json!({"text": "name,qty,ok\napples,3,=1+1\n\"say \"\"hi\"\"\",2.5,TRUE"}),
        );
        assert_eq!(r.data["changed"], 9);
        assert_eq!(r.data["rows"], 3);
        assert_eq!(r.events.len(), 1);
        assert_eq!(raw(&mut e, "A1"), "name");
        assert_eq!(raw(&mut e, "C2"), "=1+1");
        assert_eq!(computed(&mut e, "C2"), 2.0);
        assert_eq!(computed(&mut e, "B3"), 2.5);
        assert_eq!(computed(&mut e, "C3"), "TRUE");
        assert_eq!(raw(&mut e, "A3"), "say \"hi\"");
    }

    #[test]
    fn import_tsv_uses_tab_delimiter() {
        let mut e = TallyEngine::new();
        apply(&mut e, "importTsv", json!({"text": "a\tb\n1\t2"}));
        assert_eq!(raw(&mut e, "A1"), "a");
        assert_eq!(raw(&mut e, "B2"), "2");
        // A comma inside a TSV field is literal text, not a separator.
        apply(&mut e, "importTsv", json!({"text": "x,y\tz", "at": "D1"}));
        assert_eq!(raw(&mut e, "D1"), "x,y");
        assert_eq!(raw(&mut e, "E1"), "z");
    }

    #[test]
    fn import_handles_crlf_lf_cr_embedded_newlines_and_bom() {
        let mut e = TallyEngine::new();
        let text = "\u{feff}a,b\r\n\"line1\nline2\",c\rd,e\nf,g";
        apply(&mut e, "importCsv", json!({"text": text}));
        assert_eq!(raw(&mut e, "A1"), "a");
        assert_eq!(raw(&mut e, "A2"), "line1\nline2");
        assert_eq!(raw(&mut e, "B2"), "c");
        assert_eq!(raw(&mut e, "A3"), "d");
        assert_eq!(raw(&mut e, "B3"), "e");
        assert_eq!(raw(&mut e, "A4"), "f");
        assert_eq!(raw(&mut e, "B4"), "g");
    }

    #[test]
    fn import_skips_blank_lines_but_keeps_delimiter_rows() {
        let mut e = TallyEngine::new();
        apply(&mut e, "importCsv", json!({"text": "a\n\n\r\n,,\nb"}));
        assert_eq!(raw(&mut e, "A1"), "a");
        // The ",," row is three empty fields: it clears/writes nothing
        // visible but occupies row 2 — "b" lands on row 3.
        assert_eq!(raw(&mut e, "A2"), "");
        assert_eq!(raw(&mut e, "A3"), "b");
        assert_eq!(raw(&mut e, "C2"), "");
    }

    #[test]
    fn import_is_ragged_and_empty_fields_clear() {
        let mut e = TallyEngine::new();
        apply(&mut e, "setCell", json!({"addr":"C1","value":"old"}));
        apply(&mut e, "setCell", json!({"addr":"B2","value":"old"}));
        // Row 1 has 3 fields (last empty → clears C1); row 2 has 1 field,
        // leaving B2 untouched.
        apply(&mut e, "importCsv", json!({"text": "a,b,\nx"}));
        assert_eq!(raw(&mut e, "A1"), "a");
        assert_eq!(raw(&mut e, "C1"), "");
        assert_eq!(raw(&mut e, "A2"), "x");
        assert_eq!(raw(&mut e, "B2"), "old");
    }

    #[test]
    fn import_at_anchor_and_sheet_params() {
        let mut e = TallyEngine::new();
        apply(&mut e, "addSheet", json!({"name":"Data"}));
        apply(
            &mut e,
            "importCsv",
            json!({"text": "v\n1", "sheet": "Data", "at": "C3"}),
        );
        // Target sheet got the cells; active sheet stayed empty.
        assert_eq!(raw(&mut e, "A1"), "");
        apply(&mut e, "setActive", json!({"sheet": "Data"}));
        assert_eq!(raw(&mut e, "C3"), "v");
        assert_eq!(computed(&mut e, "C4"), 1.0);
    }

    #[test]
    fn import_rejects_malformed_and_oversized_atomically() {
        let mut e = TallyEngine::new();
        apply(&mut e, "setCell", json!({"addr":"A1","value":"keep"}));
        let before = e.snapshot().unwrap();
        for text in [
            "\"unterminated",
            "\"a\"x,b",
            "a,\"b\nc", // unterminated after embedded newline
        ] {
            let err = apply_err(&mut e, "importCsv", json!({"text": text}));
            assert_eq!(err.code, ErrorCode::Validation, "{text:?}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Anchor at the last row with two rows of data → out of bounds.
        let err = apply_err(
            &mut e,
            "importCsv",
            json!({"text": "a\nb", "at": "A1048576"}),
        );
        assert_eq!(err.code, ErrorCode::OutOfBounds);
        // Anchor at XFD with two columns → out of bounds.
        let err = apply_err(
            &mut e,
            "importCsv",
            json!({"text": "a,b", "at": "XFD1"}),
        );
        assert_eq!(err.code, ErrorCode::OutOfBounds);
        // Text cap.
        let big = "x".repeat(MAX_IMPORT_TEXT_BYTES + 1);
        let err = apply_err(&mut e, "importCsv", json!({"text": big}));
        assert_eq!(err.code, ErrorCode::Validation);
        // Bad anchor / missing text.
        assert!(apply_err(&mut e, "importCsv", json!({"text": "a", "at": "Q0"})).code
            == ErrorCode::Validation);
        assert!(apply_err(&mut e, "importCsv", json!({})).code == ErrorCode::InvalidCommand);
        assert_eq!(e.snapshot().unwrap(), before);
        // The rejects journaled nothing: the only undoable entry is the
        // setCell that seeded the sheet.
        let mut depth = 0;
        while e.undo().unwrap() {
            depth += 1;
        }
        assert_eq!(depth, 1);
    }

    #[test]
    fn import_undo_restores_and_empty_import_is_readonly() {
        let mut e = TallyEngine::new();
        apply(&mut e, "setCell", json!({"addr":"A1","value":"old"}));
        let before = e.snapshot().unwrap();
        // Empty/blank-only text imports nothing: readonly, no event.
        for text in ["", "\n", "\u{feff}"] {
            let r = apply(&mut e, "importCsv", json!({"text": text}));
            assert!(r.events.is_empty());
            assert_eq!(r.data["changed"], 0);
            assert_eq!(e.snapshot().unwrap(), before);
        }
        apply(&mut e, "importCsv", json!({"text": "new,2"}));
        assert_eq!(raw(&mut e, "A1"), "new");
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(raw(&mut e, "B1"), "2");
    }

    #[test]
    fn import_respects_sheet_protection() {
        let mut e = TallyEngine::new();
        apply(&mut e, "addSheet", json!({"name":"Other"}));
        apply(&mut e, "protectSheet", json!({"sheet": 0, "protected": true}));
        let before = e.snapshot().unwrap();
        for p in [
            json!({"text": "a"}),
            json!({"text": "a", "sheet": 0}),
            json!({"text": "a", "sheet": "Sheet1"}),
        ] {
            assert!(apply_err(&mut e, "importCsv", p).code == ErrorCode::Validation);
        }
        // Explicit unprotected sheet still imports.
        apply(&mut e, "importCsv", json!({"text": "ok", "sheet": "Other"}));
        apply(&mut e, "setActive", json!({"sheet": "Other"}));
        assert_eq!(raw(&mut e, "A1"), "ok");
        // The protected sheet was untouched.
        apply(&mut e, "setActive", json!({"sheet": 0}));
        assert_eq!(raw(&mut e, "A1"), "");
    }

    #[test]
    fn export_csv_emits_computed_values_with_quoting() {
        let mut e = TallyEngine::new();
        apply(&mut e, "setRange", json!({"from":"A1","values":[["name","total","note"],["say \"hi\"","=2*21","x"],["","pad ","y"]]}));
        let r = apply(&mut e, "exportCsv", json!({}));
        assert_eq!(r.events.len(), 0);
        assert_eq!(r.data["rows"], 3);
        assert_eq!(r.data["cols"], 3);
        assert_eq!(
            r.data["text"],
            "name,total,note\r\n\"say \"\"hi\"\"\",42,x\r\n,pad ,y\r\n"
        );
        // TSV switches the delimiter; embedded tab forces quoting.
        apply(&mut e, "setCell", json!({"addr":"A4","value":"p\tq"}));
        let r = apply(&mut e, "exportTsv", json!({}));
        assert_eq!(
            r.data["text"],
            "name\ttotal\tnote\r\n\"say \"\"hi\"\"\"\t42\tx\r\n\tpad \ty\r\n\"p\tq\"\t\t\r\n"
        );
    }

    #[test]
    fn export_respects_explicit_range_empty_and_sparse_sheets() {
        let mut e = TallyEngine::new();
        // Empty sheet → empty text, no error.
        let r = apply(&mut e, "exportCsv", json!({}));
        assert_eq!(r.data["text"], "");
        assert_eq!(r.data["rows"], 0);
        apply(&mut e, "setCell", json!({"addr":"B2","value":"5"}));
        apply(&mut e, "setCell", json!({"addr":"D4","value":"=B2*2"}));
        // Default = bounding box of used cells = B2:D4 (3x3).
        let r = apply(&mut e, "exportCsv", json!({}));
        assert_eq!(r.data["rows"], 3);
        assert_eq!(r.data["cols"], 3);
        assert_eq!(
            r.data["text"],
            "5,,\r\n,,\r\n,,10\r\n"
        );
        // Explicit range narrows it; reversed bounds normalize.
        let r = apply(&mut e, "exportCsv", json!({"range":{"from":"D4","to":"B2"}}));
        assert_eq!(r.data["text"], "5,,\r\n,,\r\n,,10\r\n");
        // Sparse sheet: bounding box exceeds the cell cap → reject.
        apply(&mut e, "setCell", json!({"addr":"XFD1048576","value":"edge"}));
        let err = apply_err(&mut e, "exportCsv", json!({}));
        assert_eq!(err.code, ErrorCode::OutOfBounds);
        // An explicit in-cap range still works on the same sheet.
        let r = apply(&mut e, "exportCsv", json!({"range":{"from":"XFD1048576","to":"XFD1048576"}}));
        assert_eq!(r.data["text"], "edge\r\n");
        // Non-active sheet via `sheet`.
        apply(&mut e, "addSheet", json!({"name":"Second"}));
        apply(&mut e, "importCsv", json!({"text":"s1", "sheet":"Second"}));
        let r = apply(&mut e, "exportCsv", json!({"sheet":"Second"}));
        assert_eq!(r.data["text"], "s1\r\n");
    }

    #[test]
    fn csv_round_trip_preserves_values() {
        let mut e = TallyEngine::new();
        apply(
            &mut e,
            "setRange",
            json!({"from":"A1","values":[["a","b,c","d\"e"],["=1+2","","tail "]]}),
        );
        let exported = apply(&mut e, "exportCsv", json!({})).data["text"]
            .as_str()
            .unwrap()
            .to_string();
        let mut e2 = TallyEngine::new();
        apply(&mut e2, "importCsv", json!({"text": exported}));
        // Export writes *computed* values, so the formula re-imports as the
        // literal "3" (a number), not as `=1+2` — documented semantics.
        assert_eq!(raw(&mut e2, "A2"), "3");
        assert_eq!(computed(&mut e2, "A2"), 3.0);
        assert_eq!(raw(&mut e2, "B1"), "b,c");
        assert_eq!(raw(&mut e2, "C1"), "d\"e");
        assert_eq!(raw(&mut e2, "C2"), "tail ");
        assert_eq!(raw(&mut e2, "B2"), "");
    }

    #[test]
    fn import_unicode_and_control_heavy_fields() {
        let mut e = TallyEngine::new();
        apply(
            &mut e,
            "importCsv",
            json!({"text": "名前,値\n\"日本語,テスト\",42\nemoji 😀,ok"}),
        );
        assert_eq!(raw(&mut e, "A1"), "名前");
        assert_eq!(raw(&mut e, "A2"), "日本語,テスト");
        assert_eq!(computed(&mut e, "B2"), 42.0);
        assert_eq!(raw(&mut e, "A3"), "emoji 😀");
    }
}
