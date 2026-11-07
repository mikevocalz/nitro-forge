//! Durable per-cell formats: number format, font weight/style, fill color and
//! borders.
//!
//! Formats live in `Sheet.formats`, a `BTreeMap` keyed by canonical "A1"
//! address, independent of cell contents: `setCell`/`clearCell`/`setRange`/
//! `fillRange` never touch them, `clearFormat` never touches raws, and an
//! address may hold a format with no content (formatted empty cells, as in
//! spreadsheets). Formatting is metadata only — evaluation always reads raw
//! values, so formulas are unaffected; rendering a `number_format` pattern
//! into locale-aware display text is a host/display-layer concern.
//!
//! `setFormat` applies a patch: each present key sets its attribute, an
//! explicit `null` clears that attribute, and absent keys are untouched. A
//! cell whose merged format ends up with no attributes loses its map entry.
//! `clearFormat` removes stored formats outright. Both accept either
//! `{range:{from,to}}` (shared `Rect` reader, ≤16384 cells, on-sheet) or
//! `{cells:["A1",…]}` (deduped, same cap). Writes are protection-checked by
//! the caller like every other active-sheet mutation.
use super::range_ops::Rect;
use super::*;
use std::collections::BTreeSet;

/// Bound on `number_format` strings. Preset ids ("general", "date",
/// "currency", …) and custom patterns share one opaque, host-interpreted
/// token; the engine only enforces shape, never renders it.
pub const MAX_NUMBER_FORMAT_LEN: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BorderSide {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BorderStyle {
    Thin,
    Medium,
    Thick,
    Dashed,
    Dotted,
}

/// One border spec applied to `sides` (deduped, canonical `top,right,bottom,
/// left` order — `canonicalize` enforces it).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Border {
    pub style: BorderStyle,
    /// `#RRGGBB`.
    pub color: String,
    pub sides: Vec<BorderSide>,
}

/// Stored per-cell format. Every attribute is optional; an all-`None` format
/// is never stored (ops drop it, restore skips it).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellFormat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// `#RRGGBB` fill color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<Border>,
}

impl CellFormat {
    pub fn is_empty(&self) -> bool {
        self.number_format.is_none()
            && self.bold.is_none()
            && self.italic.is_none()
            && self.fill.is_none()
            && self.border.is_none()
    }
}

fn valid_number_format(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_NUMBER_FORMAT_LEN
        && s.bytes().all(|b| b.is_ascii_graphic() || b == b' ')
        && !s.contains(['"', '\\', '{', '}'])
}

fn valid_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s.bytes().skip(1).all(|b| b.is_ascii_hexdigit())
}

fn border_shape_ok(border: &Border) -> bool {
    valid_color(&border.color) && !border.sides.is_empty() && border.sides.len() <= 4 && {
        let unique: BTreeSet<_> = border.sides.iter().collect();
        unique.len() == border.sides.len()
    }
}

/// Field-level validation for formats arriving via `restore`. Ops validate
/// while parsing; stored formats must keep every invariant ops enforce.
/// Border sides may arrive in any order — `canonicalize` sorts them, the same
/// way restore normalizes cell keys.
pub fn valid_format(f: &CellFormat) -> bool {
    f.number_format.as_deref().is_none_or(valid_number_format)
        && f.fill.as_deref().is_none_or(valid_color)
        && f.border.as_ref().is_none_or(border_shape_ok)
}

/// Restore-time normalization: sort border sides into canonical order.
/// Duplicates are rejected by `valid_format` before this runs.
pub fn canonicalize(f: &mut CellFormat) {
    if let Some(b) = &mut f.border {
        b.sides.sort();
        b.sides.dedup();
    }
}

/// Parsed `setFormat` patch: outer `Option` = key present, inner `Option` =
/// explicit `null` clears the attribute.
#[derive(Default)]
struct AttrPatch {
    number_format: Option<Option<String>>,
    bold: Option<Option<bool>>,
    italic: Option<Option<bool>>,
    fill: Option<Option<String>>,
    border: Option<Option<Border>>,
}

fn bool_patch(v: &Value, name: &str) -> Result<Option<bool>, EngineError> {
    match v {
        Value::Null => Ok(None),
        Value::Bool(b) => Ok(Some(*b)),
        _ => Err(EngineError::validation(format!(
            "format field '{name}' must be a boolean or null"
        ))),
    }
}

fn parse_patch(v: &Value) -> Result<AttrPatch, EngineError> {
    let obj = v
        .as_object()
        .ok_or_else(|| EngineError::invalid("format must be an object"))?;
    let mut patch = AttrPatch::default();
    for (key, val) in obj {
        match key.as_str() {
            "number_format" => {
                patch.number_format = Some(match val {
                    Value::Null => None,
                    Value::String(s) if valid_number_format(s) => Some(s.clone()),
                    _ => {
                        return Err(EngineError::validation(
                            "number_format must be a bounded format string or null",
                        ))
                    }
                });
            }
            "bold" => patch.bold = Some(bool_patch(val, "bold")?),
            "italic" => patch.italic = Some(bool_patch(val, "italic")?),
            "fill" => {
                patch.fill = Some(match val {
                    Value::Null => None,
                    Value::String(s) if valid_color(s) => Some(s.clone()),
                    _ => {
                        return Err(EngineError::validation(
                            "fill must be a #RRGGBB color or null",
                        ))
                    }
                });
            }
            "border" => {
                patch.border = Some(match val {
                    Value::Null => None,
                    other => {
                        let mut b: Border =
                            serde_json::from_value(other.clone()).map_err(|_| {
                                EngineError::validation(
                                    "border must be {style,color,sides} or null",
                                )
                            })?;
                        if !border_shape_ok(&b) {
                            return Err(EngineError::validation(
                                "border needs a #RRGGBB color and 1-4 unique sides",
                            ));
                        }
                        b.sides.sort();
                        b.sides.dedup();
                        Some(b)
                    }
                });
            }
            other => {
                return Err(EngineError::validation(format!(
                    "unknown format field '{other}'"
                )))
            }
        }
    }
    Ok(patch)
}

fn apply_patch(fmt: &mut CellFormat, patch: &AttrPatch) {
    if let Some(v) = &patch.number_format {
        fmt.number_format = v.clone();
    }
    if let Some(v) = &patch.bold {
        fmt.bold = *v;
    }
    if let Some(v) = &patch.italic {
        fmt.italic = *v;
    }
    if let Some(v) = &patch.fill {
        fmt.fill = v.clone();
    }
    if let Some(v) = &patch.border {
        fmt.border = v.clone();
    }
}

impl TallyEngine {
    /// Exactly one of `range` ({from,to} via the shared `Rect` reader) or
    /// `cells` (deduped address list) selects the target addresses.
    fn format_targets(p: &Value) -> Result<Vec<String>, EngineError> {
        match (p.get("range"), p.get("cells")) {
            (Some(range), None) => Ok(Rect::read(range)?.addrs()),
            (None, Some(cells)) => {
                let cells = cells
                    .as_array()
                    .ok_or_else(|| EngineError::invalid("'cells' must be an array of addresses"))?;
                if cells.is_empty() {
                    return Err(EngineError::validation("'cells' must be nonempty"));
                }
                let mut addrs = BTreeSet::new();
                for v in cells {
                    let s = v.as_str().ok_or_else(|| {
                        EngineError::validation("'cells' entries must be address strings")
                    })?;
                    let (c, r) = parse_addr(s).ok_or_else(|| {
                        EngineError::validation(format!("invalid cell address '{s}'"))
                    })?;
                    if !formula::on_sheet(c, r) {
                        return Err(EngineError::out_of_bounds(format!(
                            "cell address '{s}' is past the sheet (XFD1048576)"
                        )));
                    }
                    addrs.insert(fmt_addr(c, r));
                }
                if addrs.len() > MAX_GET_RANGE_CELLS as usize {
                    return Err(EngineError::out_of_bounds("range exceeds 16384 cells"));
                }
                Ok(addrs.into_iter().collect())
            }
            _ => Err(EngineError::invalid(
                "format ops require exactly one of 'range' or 'cells'",
            )),
        }
    }

    /// Apply a validated patch to every target; one undo entry, one event.
    /// Cells whose merged format is unchanged are skipped entirely.
    pub(super) fn op_set_format(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let patch = parse_patch(Self::field(p, "format")?)?;
        let addrs = Self::format_targets(p)?;
        let sheet_id = self.active_sheet().id;
        let mut journal_cells = Vec::new();
        let mut applied = Vec::new();
        for addr in addrs {
            let cur = self.active_sheet().formats.get(&addr).cloned();
            let mut merged = cur.clone().unwrap_or_default();
            apply_patch(&mut merged, &patch);
            let new = if merged.is_empty() {
                None
            } else {
                Some(merged)
            };
            if new != cur {
                journal_cells.push((addr.clone(), cur));
                applied.push((addr, new));
            }
        }
        let changed = applied.len();
        if changed == 0 {
            return Ok(Self::readonly(json!({ "changed": 0 })));
        }
        self.journal.record(UndoEntry::Formats {
            sheet: sheet_id,
            cells: journal_cells,
        });
        let sheet = self.active_sheet_mut();
        for (addr, new) in applied {
            match new {
                Some(f) => {
                    sheet.formats.insert(addr, f);
                }
                None => {
                    sheet.formats.remove(&addr);
                }
            }
        }
        Ok(Self::changed(json!({ "changed": changed })))
    }

    /// Remove stored formats from every target; raws are untouched.
    pub(super) fn op_clear_format(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let addrs = Self::format_targets(p)?;
        let sheet_id = self.active_sheet().id;
        let mut journal_cells = Vec::new();
        for addr in &addrs {
            if let Some(prev) = self.active_sheet().formats.get(addr).cloned() {
                journal_cells.push((addr.clone(), Some(prev)));
            }
        }
        let changed = journal_cells.len();
        if changed == 0 {
            return Ok(Self::readonly(json!({ "changed": 0 })));
        }
        self.journal.record(UndoEntry::Formats {
            sheet: sheet_id,
            cells: journal_cells,
        });
        let sheet = self.active_sheet_mut();
        for addr in &addrs {
            sheet.formats.remove(addr);
        }
        Ok(Self::changed(json!({ "changed": changed })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(e: &mut TallyEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }

    fn cell(e: &mut TallyEngine, addr: &str) -> Value {
        run(e, "getCell", json!({ "addr": addr })).data
    }

    /// The `format` member of a getCell result, or null when absent.
    fn fmt(e: &mut TallyEngine, addr: &str) -> Value {
        cell(e, addr).get("format").cloned().unwrap_or(Value::Null)
    }

    #[test]
    fn set_patch_merge_and_clear() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"42"}));
        let r = run(
            &mut e,
            "setFormat",
            json!({"range":{"from":"A1","to":"B2"},"format":{"number_format":"currency","bold":true}}),
        );
        assert_eq!(r.data["changed"], 4);
        assert_eq!(r.events.len(), 1);
        assert_eq!(
            fmt(&mut e, "A1"),
            json!({"number_format":"currency","bold":true})
        );
        // Formatting never changes evaluation: raw value and computed stay put.
        assert_eq!(cell(&mut e, "A1")["computed"], json!(42.0));
        assert_eq!(cell(&mut e, "A1")["raw"], json!("42"));
        // Unformatted cells in the range expose no format key at all.
        let range = run(&mut e, "getRange", json!({"from":"A1","to":"C1"})).data;
        assert_eq!(range["cells"][0][0]["format"]["bold"], json!(true));
        assert!(range["cells"][0][2].get("format").is_none());
        // Patch semantics: bold:null clears, italic sets, others untouched.
        run(
            &mut e,
            "setFormat",
            json!({"cells":["A1"],"format":{"bold":null,"italic":true}}),
        );
        assert_eq!(
            fmt(&mut e, "A1"),
            json!({"number_format":"currency","italic":true})
        );
        // Clearing the last attribute drops the map entry entirely.
        run(
            &mut e,
            "setFormat",
            json!({"cells":["A1"],"format":{"number_format":null,"italic":null}}),
        );
        assert_eq!(fmt(&mut e, "A1"), Value::Null);
        // clearFormat removes formats but keeps contents.
        run(
            &mut e,
            "clearFormat",
            json!({"range":{"from":"A1","to":"B2"}}),
        );
        assert_eq!(fmt(&mut e, "B2"), Value::Null);
        assert_eq!(cell(&mut e, "A1")["raw"], json!("42"));
    }

    #[test]
    fn border_and_fill_formats() {
        let mut e = TallyEngine::new();
        run(
            &mut e,
            "setFormat",
            json!({"cells":["C3"],"format":{
                "fill":"#FF8800",
                "border":{"style":"thin","color":"#112233","sides":["bottom","top"]}
            }}),
        );
        assert_eq!(
            fmt(&mut e, "C3"),
            json!({"fill":"#FF8800","border":{"style":"thin","color":"#112233","sides":["top","bottom"]}})
        );
        // Replacing the border replaces the whole object.
        run(
            &mut e,
            "setFormat",
            json!({"cells":["C3"],"format":{"border":{"style":"dashed","color":"#000000","sides":["left"]}}}),
        );
        assert_eq!(
            fmt(&mut e, "C3")["border"],
            json!({"style":"dashed","color":"#000000","sides":["left"]})
        );
    }

    #[test]
    fn targets_cells_dedupe_and_bounds() {
        let mut e = TallyEngine::new();
        // Duplicate and unordered cells collapse; changed counts unique cells.
        let r = run(
            &mut e,
            "setFormat",
            json!({"cells":["B2","a1","B2","$A$1"],"format":{"bold":true}}),
        );
        assert_eq!(r.data["changed"], 2);
        assert_eq!(fmt(&mut e, "A1")["bold"], json!(true));
        assert_eq!(fmt(&mut e, "B2")["bold"], json!(true));
        // Exactly one of range/cells is required.
        let before = e.snapshot().unwrap();
        for p in [
            json!({"format":{"bold":true}}),
            json!({"range":{"from":"A1","to":"A1"},"cells":["A1"],"format":{"bold":true}}),
            json!({"cells":[],"format":{"bold":true}}),
            json!({"cells":["A1",5],"format":{"bold":true}}),
            json!({"cells":"A1","format":{"bold":true}}),
        ] {
            assert!(e.apply(Command::new("setFormat", p.clone())).is_err());
            assert!(e.apply(Command::new("clearFormat", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Off-sheet and oversized targets reject atomically.
        for p in [
            json!({"range":{"from":"A1048576","to":"A1048577"},"format":{"bold":true}}),
            json!({"range":{"from":"XFD1","to":"XFE1"},"format":{"bold":true}}),
            json!({"cells":["XFE1"],"format":{"bold":true}}),
            json!({"range":{"from":"A1","to":"A16385"},"format":{"bold":true}}),
            json!({"range":{"from":"A1","to":"A1"},"format":{"bold":true},"cells":["A1"]}),
        ] {
            assert!(e.apply(Command::new("setFormat", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // clearFormat honors the same targets.
        let r = run(&mut e, "clearFormat", json!({"cells":["a1"]}));
        assert_eq!(r.data["changed"], 1);
        assert_eq!(fmt(&mut e, "A1"), Value::Null);
    }

    #[test]
    fn invalid_patches_reject_without_mutation_or_redo_loss() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"1"}));
        run(&mut e, "setCell", json!({"addr":"Z9","value":"9"}));
        e.undo().unwrap(); // clear redo, leave Z9 write undoable
        let before = e.snapshot().unwrap();
        let bad = [
            json!({"cells":["A1"],"format":{"unknown":1}}),
            json!({"cells":["A1"],"format":{"fill":"red"}}),
            json!({"cells":["A1"],"format":{"fill":"#12345"}}),
            json!({"cells":["A1"],"format":{"number_format":""}}),
            json!({"cells":["A1"],"format":{"number_format":"a".repeat(65)}}),
            json!({"cells":["A1"],"format":{"number_format":"has\"quote"}}),
            json!({"cells":["A1"],"format":{"bold":"yes"}}),
            json!({"cells":["A1"],"format":"bold"}),
            json!({"cells":["A1"],"format":{"border":{"style":"huge","color":"#000000","sides":["top"]}}}),
            json!({"cells":["A1"],"format":{"border":{"style":"thin","color":"red","sides":["top"]}}}),
            json!({"cells":["A1"],"format":{"border":{"style":"thin","color":"#000000","sides":[]}}}),
            json!({"cells":["A1"],"format":{"border":{"style":"thin","color":"#000000","sides":["top","top"]}}}),
            json!({"cells":["A1"],"format":{"border":{"style":"thin","color":"#000000","sides":["diagonal"]}}}),
            json!({"cells":["A1"]}), // missing format field
        ];
        for p in bad {
            assert!(
                e.apply(Command::new("setFormat", p.clone())).is_err(),
                "{p}"
            );
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // No-op patches are eventless and preserve redo.
        let noop = run(&mut e, "setFormat", json!({"cells":["A1"],"format":{}}));
        assert_eq!(noop.data["changed"], 0);
        assert!(noop.events.is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(cell(&mut e, "Z9")["raw"], json!("9"));
    }

    #[test]
    fn undo_redo_formats() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"7"}));
        run(
            &mut e,
            "setFormat",
            json!({"range":{"from":"A1","to":"A2"},"format":{"bold":true,"fill":"#ABCDEF"}}),
        );
        run(
            &mut e,
            "setFormat",
            json!({"cells":["A1"],"format":{"italic":true}}),
        );
        let formatted = e.snapshot().unwrap();

        // Each format op is a single journal entry; undo peels them in order.
        assert!(e.undo().unwrap()); // un-patch A1
        assert_eq!(fmt(&mut e, "A1"), json!({"bold":true,"fill":"#ABCDEF"}));
        assert_eq!(fmt(&mut e, "A2"), json!({"bold":true,"fill":"#ABCDEF"}));
        assert!(e.undo().unwrap()); // un-range format
        assert_eq!(fmt(&mut e, "A1"), Value::Null);
        assert!(e.undo().unwrap()); // un-setCell
        assert_eq!(cell(&mut e, "A1")["raw"], json!(""));
        assert_eq!(e.undo().unwrap(), false);

        // Redo rebuilds cell + formats exactly.
        while e.redo().unwrap() {}
        assert_eq!(e.snapshot().unwrap(), formatted);

        // clearFormat is undoable and restores prior formats exactly.
        run(&mut e, "clearFormat", json!({"cells":["A1","A2"]}));
        assert_eq!(fmt(&mut e, "A2"), Value::Null);
        let cleared = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), formatted);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), cleared);

        // Four mutations (setCell + two setFormat + clearFormat) → four undo
        // entries; formats ride their own entries, not the cell journal.
        let mut depth = 0;
        while e.undo().unwrap() {
            depth += 1;
        }
        assert_eq!(depth, 4);
    }

    #[test]
    fn content_ops_do_not_touch_formats() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        run(
            &mut e,
            "setFormat",
            json!({"cells":["A1"],"format":{"bold":true}}),
        );
        // Overwrite, clear and range/fill writes leave the format alone.
        run(&mut e, "setCell", json!({"addr":"A1","value":"=1+1"}));
        assert_eq!(fmt(&mut e, "A1")["bold"], json!(true));
        assert_eq!(cell(&mut e, "A1")["computed"], json!(2.0));
        run(&mut e, "clearCell", json!({"addr":"A1"}));
        assert_eq!(fmt(&mut e, "A1")["bold"], json!(true));
        assert_eq!(cell(&mut e, "A1")["raw"], json!(""));
        run(&mut e, "setRange", json!({"from":"A1","values":[["9"]]}));
        run(
            &mut e,
            "fillRange",
            json!({"source":{"from":"A1","to":"A1"},"target":{"from":"A1","to":"A2"}}),
        );
        assert_eq!(fmt(&mut e, "A2"), Value::Null); // fill copies raws, not formats
        assert_eq!(fmt(&mut e, "A1")["bold"], json!(true));
        // Formats are per-sheet like cells.
        run(&mut e, "addSheet", json!({"name":"Two"}));
        run(&mut e, "setActive", json!({"sheet":"Two"}));
        assert_eq!(fmt(&mut e, "A1"), Value::Null);
    }

    #[test]
    fn snapshot_wraps_for_formats_and_restores() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"3.14"}));
        run(
            &mut e,
            "setFormat",
            json!({"cells":["A1"],"format":{"number_format":"percent","fill":"#00FF00"}}),
        );
        let snap = e.snapshot().unwrap();
        let (_tag, payload) = decode_envelope(&snap).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(v["kind"], json!("tally"));
        assert_eq!(v["schema"], json!(1));
        assert_eq!(
            v["document"]["sheets"][0]["formats"]["A1"]["fill"],
            json!("#00FF00")
        );
        // describe exposes the formats map.
        let d = run(&mut e, "describe", json!({})).data;
        assert_eq!(
            d["sheets"][0]["formats"]["A1"]["number_format"],
            json!("percent")
        );
        // Round-trip through a fresh engine.
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        assert_eq!(fmt(&mut e2, "A1"), fmt(&mut e, "A1"));
        assert_eq!(e2.snapshot().unwrap(), snap);
        // Undo history does not survive restore; new ops still journal.
        assert!(!e2.undo().unwrap());
        run(&mut e2, "clearFormat", json!({"cells":["A1"]}));
        assert!(e2.undo().unwrap());
        assert_eq!(fmt(&mut e2, "A1")["fill"], json!("#00FF00"));
    }

    #[test]
    fn legacy_snapshots_default_to_no_formats() {
        let legacy = json!({"next_sheet":1,"sheets":[{"id":0,"name":"L","cells":{"A1":{"raw":"1"}}}],"active":0});
        let mut e = TallyEngine::new();
        e.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
            .unwrap();
        assert!(e.doc.sheets[0].formats.is_empty());
        assert_eq!(fmt(&mut e, "A1"), Value::Null);
        // A snapshot without formats keeps the legacy bare payload.
        let snap = e.snapshot().unwrap();
        let (_tag, payload) = decode_envelope(&snap).unwrap();
        let v: Value = serde_json::from_slice(&payload).unwrap();
        assert!(v.get("kind").is_none());
        assert!(v["sheets"][0].get("formats").is_none());
    }

    #[test]
    fn hostile_restore_rejects_bad_formats_atomically() {
        let mut e = TallyEngine::new();
        run(&mut e, "setCell", json!({"addr":"A1","value":"5"}));
        let before = e.snapshot().unwrap();
        let base = json!({"next_sheet":1,"sheets":[{"id":0,"name":"S","cells":{},"formats":{}}],"active":0});
        let bad_formats = [
            // Off-sheet and unparseable format keys.
            json!({"A1048577":{"bold":true}}),
            json!({"ZZZ":{"bold":true}}),
            // Invalid attribute values and unknown fields.
            json!({"A1":{"fill":"red"}}),
            json!({"A1":{"fill":"#12345"}}),
            json!({"A1":{"bold":"yes"}}),
            json!({"A1":{"number_format":""}}),
            json!({"A1":{"number_format":"x".repeat(65)}}),
            json!({"A1":{"unknown":1}}),
            // Malformed borders: bad style/color, empty or duplicate sides,
            // missing fields.
            json!({"A1":{"border":{"style":"huge","color":"#000000","sides":["top"]}}}),
            json!({"A1":{"border":{"style":"thin","color":"red","sides":["top"]}}}),
            json!({"A1":{"border":{"style":"thin","color":"#000000","sides":[]}}}),
            json!({"A1":{"border":{"style":"thin","color":"#000000","sides":["top","top"]}}}),
            json!({"A1":{"border":{"style":"thin","color":"#000000"}}}),
        ];
        for formats in bad_formats {
            let mut doc = base.clone();
            doc["sheets"][0]["formats"] = formats.clone();
            let bytes = encode_envelope(&serde_json::to_vec(&doc).unwrap());
            assert!(e.restore(&bytes).is_err(), "accepted {formats}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Unsorted border sides normalize to canonical order; an empty format
        // object is dropped rather than stored.
        let mut doc = base.clone();
        doc["sheets"][0]["formats"] = json!({
            "B2":{"border":{"style":"thin","color":"#000000","sides":["left","top"]}},
            "C3":{}
        });
        e.restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap()))
            .unwrap();
        let sides = &e.doc.sheets[0].formats["B2"].border.as_ref().unwrap().sides;
        assert_eq!(sides, &vec![BorderSide::Top, BorderSide::Left]);
        assert!(!e.doc.sheets[0].formats.contains_key("C3"));
    }
}
