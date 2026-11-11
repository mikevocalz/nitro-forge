//! Paragraph-level formatting: alignment, indents, and tab stops
//! (P12 slice 9). Storage-only — no layout engine consumes these values.
//!
//! A `ParagraphFormat` rides on `Block::format` (`Option`, absent means
//! default/unstyled). Because `Block` has no `deny_unknown_fields`, old
//! readers silently ignore the field — snapshots carrying any format
//! therefore emit the `schema:4` wrapper, which schema≤3 readers reject
//! (`schema != 2`/`!= 3`). Named `"paragraph"` styles may carry the same
//! grammar under `properties.paragraph`; `setBlockStyle` copies it onto
//! the block's format with the same snapshot semantics as inline props.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use ignition_core::EngineError;

/// Indent/tab-stop positions are twips (1/20 pt), matching the list-level
/// `indent_twips`/`hanging_twips` grammar and the DOCX `w:ind`/`w:tabs`
/// subset. Bound matches the list-level cap: 31680 twips (22 in).
pub const INDENT_MAX_TWIPS: i64 = 31680;
/// Bound on stored tab stops per paragraph.
pub const TAB_STOPS_MAX: usize = 64;

/// Paragraph alignment — the DOCX `w:jc` subset. `"justify"` covers DOCX
/// `both`; `start`/`end`/`distribute`/`mediumKashida` etc. are deferred.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParagraphAlignment {
    Left,
    Center,
    Right,
    Justify,
}

/// Tab-stop alignment — the DOCX `w:tabs/w:tab@w:val` subset minus `bar`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TabAlignment {
    Left,
    Center,
    Right,
    Decimal,
}

/// Tab leader — the DOCX `w:tabs/w:tab@w:leader` subset. Absent means no
/// leader (DOCX `none`); `"none"` itself is not an admitted value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TabLeader {
    Dot,
    Hyphen,
    Underscore,
    Heavy,
}

/// One tab stop: `position` in twips from the left margin (0..=31680),
/// strictly increasing across the list. `leader` is optional.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TabStop {
    pub position: u32,
    pub alignment: TabAlignment,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leader: Option<TabLeader>,
}

/// Stored paragraph format on `Block::format`. Every field is optional;
/// an all-`None` value is canonicalized away to `None` by ops, so
/// `"format":{}` never appears in engine-emitted snapshots.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParagraphFormat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<ParagraphAlignment>,
    /// Left indent in twips, 0..=31680.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_left: Option<u32>,
    /// Right indent in twips, 0..=31680.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_right: Option<u32>,
    /// First-line indent in twips, -31680..=31680. Positive is a first-line
    /// indent; negative is a hanging indent (DOCX `w:hanging`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_first: Option<i64>,
    /// Tab stops, strictly increasing positions, at most 64.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tabs: Option<Vec<TabStop>>,
}

impl ParagraphFormat {
    /// True when every field is unset — the canonical `None` state.
    pub fn is_empty(&self) -> bool {
        self.alignment.is_none()
            && self.indent_left.is_none()
            && self.indent_right.is_none()
            && self.indent_first.is_none()
            && self.tabs.is_none()
    }
}

/// Partial paragraph-format update, shared by `setParagraphFormat`'s flat
/// payload fields and a named style's `properties.paragraph` object.
/// Present key with a value sets, present key with `null` clears, absent
/// key is untouched. `tabs` replaces the whole stop list (`[]` or `null`
/// clears). Unknown keys are ignored, matching the `applyStyle` patch
/// grammar.
#[derive(Default)]
pub struct ParagraphFormatPatch {
    pub alignment: Option<Option<ParagraphAlignment>>,
    pub indent_left: Option<Option<u32>>,
    pub indent_right: Option<Option<u32>>,
    pub indent_first: Option<Option<i64>>,
    pub tabs: Option<Option<Vec<TabStop>>>,
}

fn invalid(msg: impl Into<String>) -> EngineError {
    EngineError::invalid(msg.into())
}

fn validation(msg: impl Into<String>) -> EngineError {
    EngineError::validation(msg.into())
}

/// Non-negative twips bound check shared by left/right indents and tab
/// positions. Accepts JSON integers (or integral floats, matching
/// `as_usize` leniency elsewhere in the engine).
fn parse_u32_twips(v: &Value, name: &str) -> Result<u32, EngineError> {
    let n = if let Some(u) = v.as_u64() {
        u as i128
    } else if let Some(f) = v.as_f64() {
        if f.fract() != 0.0 || f < 0.0 {
            return Err(invalid(format!("'{name}' must be a non-negative integer")));
        }
        f as i128
    } else {
        return Err(invalid(format!("'{name}' must be a non-negative integer")));
    };
    if n > INDENT_MAX_TWIPS as i128 {
        return Err(validation(format!(
            "'{name}' must be at most {INDENT_MAX_TWIPS} twips"
        )));
    }
    Ok(n as u32)
}

/// Signed twips for `indent_first` (negative = hanging).
fn parse_i64_twips(v: &Value, name: &str) -> Result<i64, EngineError> {
    let n = if let Some(i) = v.as_i64() {
        i as i128
    } else if let Some(u) = v.as_u64() {
        u as i128
    } else if let Some(f) = v.as_f64() {
        if f.fract() != 0.0 {
            return Err(invalid(format!("'{name}' must be an integer")));
        }
        f as i128
    } else {
        return Err(invalid(format!("'{name}' must be an integer")));
    };
    // Range-compare rather than abs(): a hostile magnitude can saturate to
    // the integer type's minimum, whose abs() would overflow.
    if n > INDENT_MAX_TWIPS as i128 || n < -(INDENT_MAX_TWIPS as i128) {
        return Err(validation(format!(
            "'{name}' must be within -{INDENT_MAX_TWIPS}..={INDENT_MAX_TWIPS} twips"
        )));
    }
    Ok(n as i64)
}

fn parse_alignment(v: &Value, name: &str) -> Result<ParagraphAlignment, EngineError> {
    serde_json::from_value(v.clone()).map_err(|_| {
        validation(format!(
            "{name} must be \"left\", \"center\", \"right\", or \"justify\""
        ))
    })
}

/// Validate a complete stored tab-stop list: count bound and strictly
/// increasing in-bounds positions. Runs on op input and on restore.
fn validate_tab_stops(tabs: &[TabStop]) -> Result<(), EngineError> {
    if tabs.len() > TAB_STOPS_MAX {
        return Err(validation(format!(
            "at most {TAB_STOPS_MAX} tab stops are supported"
        )));
    }
    let mut prev: Option<u32> = None;
    for t in tabs {
        if t.position > INDENT_MAX_TWIPS as u32 {
            return Err(validation(format!(
                "tab stop position must be at most {INDENT_MAX_TWIPS} twips"
            )));
        }
        if prev.is_some_and(|p| t.position <= p) {
            return Err(validation(
                "tab stop positions must be strictly increasing",
            ));
        }
        prev = Some(t.position);
    }
    Ok(())
}

/// Parse one tab-stop object strictly (`deny_unknown_fields`, typed
/// enums) then run the list-level checks.
fn parse_tab_stop(v: &Value) -> Result<TabStop, EngineError> {
    let stop: TabStop = serde_json::from_value(v.clone())
        .map_err(|_| validation("invalid tab stop (position/alignment/leader)"))?;
    Ok(stop)
}

impl ParagraphFormatPatch {
    /// Parse the format fields out of a JSON object (`setParagraphFormat`'s
    /// payload or a style's `properties.paragraph` value). Unknown keys are
    /// ignored; present-but-malformed known keys reject.
    pub fn parse(v: &Value) -> Result<Self, EngineError> {
        let obj = v
            .as_object()
            .ok_or_else(|| invalid("paragraph format must be an object"))?;
        let mut p = ParagraphFormatPatch::default();
        if let Some(val) = obj.get("alignment") {
            p.alignment = Some(if val.is_null() {
                None
            } else {
                Some(parse_alignment(val, "alignment")?)
            });
        }
        let opt_u32 = |name: &str, slot: &mut Option<Option<u32>>| -> Result<(), EngineError> {
            if let Some(val) = obj.get(name) {
                *slot = Some(if val.is_null() {
                    None
                } else {
                    Some(parse_u32_twips(val, name)?)
                });
            }
            Ok(())
        };
        opt_u32("indent_left", &mut p.indent_left)?;
        opt_u32("indent_right", &mut p.indent_right)?;
        if let Some(val) = obj.get("indent_first") {
            p.indent_first = Some(if val.is_null() {
                None
            } else {
                Some(parse_i64_twips(val, "indent_first")?)
            });
        }
        if let Some(val) = obj.get("tabs") {
            p.tabs = Some(if val.is_null() {
                None
            } else {
                let arr = val
                    .as_array()
                    .ok_or_else(|| invalid("'tabs' must be an array or null"))?;
                let mut stops = Vec::with_capacity(arr.len());
                for el in arr {
                    stops.push(parse_tab_stop(el)?);
                }
                validate_tab_stops(&stops)?;
                Some(stops)
            });
        }
        // Tab-stop alignment/leader enums and the `position` integer type
        // are enforced by serde inside `parse_tab_stop`; the list-level
        // count/increasing/bounds rules run in `validate_tab_stops`.
        Ok(p)
    }

    pub fn is_empty(&self) -> bool {
        self.alignment.is_none()
            && self.indent_left.is_none()
            && self.indent_right.is_none()
            && self.indent_first.is_none()
            && self.tabs.is_none()
    }

    /// Merge this patch into a block's `format` slot. Sets/clones values,
    /// clears on explicit null, leaves absent fields untouched, and
    /// canonicalizes an all-empty result back to `None`.
    pub fn apply(&self, slot: &mut Option<ParagraphFormat>) {
        if self.is_empty() {
            return;
        }
        let f = slot.get_or_insert_with(ParagraphFormat::default);
        if let Some(v) = self.alignment {
            f.alignment = v;
        }
        if let Some(v) = self.indent_left {
            f.indent_left = v;
        }
        if let Some(v) = self.indent_right {
            f.indent_right = v;
        }
        if let Some(v) = self.indent_first {
            f.indent_first = v;
        }
        if let Some(v) = &self.tabs {
            f.tabs = v.clone().filter(|t| !t.is_empty());
        }
        if f.is_empty() {
            *slot = None;
        }
    }
}

/// Full validation of a stored `ParagraphFormat` on restore: scalar bounds
/// and tab-stop rules. Enum fields are already typed by serde.
pub fn validate_format(f: &ParagraphFormat) -> Result<(), EngineError> {
    // Ops canonicalize all-empty formats (and empty tab lists) back to
    // `None`; a stored degenerate value can only come from a crafted
    // snapshot, so reject it rather than admit a state the engine never emits.
    if f.is_empty() || f.tabs.as_ref().is_some_and(|t| t.is_empty()) {
        return Err(validation("empty paragraph format"));
    }
    if let Some(v) = f.indent_left {
        if v > INDENT_MAX_TWIPS as u32 {
            return Err(validation(format!(
                "indent_left must be at most {INDENT_MAX_TWIPS} twips"
            )));
        }
    }
    if let Some(v) = f.indent_right {
        if v > INDENT_MAX_TWIPS as u32 {
            return Err(validation(format!(
                "indent_right must be at most {INDENT_MAX_TWIPS} twips"
            )));
        }
    }
    if let Some(v) = f.indent_first {
        // Range-compare: i64::MIN.abs() would overflow on hostile input.
        if v > INDENT_MAX_TWIPS || v < -INDENT_MAX_TWIPS {
            return Err(validation(format!(
                "indent_first must be within -{INDENT_MAX_TWIPS}..={INDENT_MAX_TWIPS} twips"
            )));
        }
    }
    if let Some(tabs) = &f.tabs {
        validate_tab_stops(tabs)?;
    }
    Ok(())
}

/// True when a named style's `properties` object carries a non-null
/// `paragraph` key — the paragraph-format patch grammar. Used for the
/// schema:4 emission gate and the schema<4 hostile-restore rejection.
pub fn style_has_paragraph_props(properties: &Value) -> bool {
    properties
        .get("paragraph")
        .is_some_and(|v| !v.is_null())
}

/// Extract and validate the `properties.paragraph` patch of a style def.
/// Returns `None` when absent or null; rejects malformed grammar.
pub fn style_paragraph_patch(properties: &Value) -> Result<Option<ParagraphFormatPatch>, EngineError> {
    match properties.get("paragraph") {
        Some(v) if !v.is_null() => {
            let patch = ParagraphFormatPatch::parse(v)?;
            Ok(if patch.is_empty() { None } else { Some(patch) })
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn patch_sets_clears_and_leaves_absent_untouched() {
        let mut slot: Option<ParagraphFormat> = None;
        ParagraphFormatPatch::parse(&json!({
            "alignment": "center",
            "indent_left": 720,
            "tabs": [{"position": 1440, "alignment": "right", "leader": "dot"}]
        }))
        .unwrap()
        .apply(&mut slot);
        let f = slot.as_ref().unwrap();
        assert_eq!(f.alignment, Some(ParagraphAlignment::Center));
        assert_eq!(f.indent_left, Some(720));
        assert_eq!(f.indent_right, None);
        assert_eq!(f.tabs.as_ref().unwrap().len(), 1);
        assert_eq!(f.tabs.as_ref().unwrap()[0].leader, Some(TabLeader::Dot));

        // Absent keys untouched; explicit nulls clear.
        ParagraphFormatPatch::parse(&json!({
            "indent_right": 360,
            "alignment": null
        }))
        .unwrap()
        .apply(&mut slot);
        let f = slot.as_ref().unwrap();
        assert_eq!(f.alignment, None);
        assert_eq!(f.indent_left, Some(720));
        assert_eq!(f.indent_right, Some(360));

        // Clearing everything canonicalizes back to None.
        ParagraphFormatPatch::parse(&json!({
            "indent_left": null,
            "indent_right": null,
            "tabs": null
        }))
        .unwrap()
        .apply(&mut slot);
        assert!(slot.is_none());
    }

    #[test]
    fn bounds_and_grammar_reject() {
        for bad in [
            json!({"alignment": "middle"}),
            json!({"indent_left": -1}),
            json!({"indent_left": 31681}),
            json!({"indent_right": 40000}),
            json!({"indent_first": 31681}),
            json!({"indent_first": -31681}),
            json!({"tabs": "nope"}),
            json!({"tabs": [{"position": 100, "alignment": "decimal"}, {"position": 100, "alignment": "left"}]}),
            json!({"tabs": [{"position": 31681, "alignment": "left"}]}),
            json!({"tabs": [{"position": 100, "alignment": "bogus"}]}),
            json!({"tabs": [{"position": 100, "alignment": "left", "bogus": 1}]}),
            json!({"tabs": [{"alignment": "left"}]}),
        ] {
            assert!(
                ParagraphFormatPatch::parse(&bad).is_err(),
                "expected reject: {bad}"
            );
        }
        // Too many stops.
        let many: Vec<Value> = (0..=TAB_STOPS_MAX as u32)
            .map(|i| json!({"position": i * 100, "alignment": "left"}))
            .collect();
        assert!(ParagraphFormatPatch::parse(&json!({"tabs": many})).is_err());
        // Empty tabs array clears rather than storing []).
        let mut slot = Some(ParagraphFormat {
            tabs: Some(vec![TabStop {
                position: 100,
                alignment: TabAlignment::Left,
                leader: None,
            }]),
            ..ParagraphFormat::default()
        });
        ParagraphFormatPatch::parse(&json!({"tabs": []}))
            .unwrap()
            .apply(&mut slot);
        assert!(slot.is_none());
    }

    #[test]
    fn stored_format_validates_on_restore_grammar() {
        let ok = ParagraphFormat {
            alignment: Some(ParagraphAlignment::Justify),
            indent_left: Some(720),
            indent_right: Some(360),
            indent_first: Some(-360),
            tabs: Some(vec![
                TabStop {
                    position: 720,
                    alignment: TabAlignment::Decimal,
                    leader: Some(TabLeader::Heavy),
                },
                TabStop {
                    position: 1440,
                    alignment: TabAlignment::Center,
                    leader: None,
                },
            ]),
        };
        validate_format(&ok).unwrap();
        // deny_unknown_fields on the stored structs.
        assert!(serde_json::from_value::<ParagraphFormat>(json!({
            "bogus": 1
        }))
        .is_err());
        assert!(serde_json::from_value::<TabStop>(json!({
            "position": 1,
            "alignment": "left",
            "bogus": 1
        }))
        .is_err());
        // Out-of-bounds stored values reject.
        let bad = ParagraphFormat {
            indent_left: Some(99999),
            ..ParagraphFormat::default()
        };
        assert!(validate_format(&bad).is_err());
        let bad_tabs = ParagraphFormat {
            tabs: Some(vec![
                TabStop {
                    position: 200,
                    alignment: TabAlignment::Left,
                    leader: None,
                },
                TabStop {
                    position: 100,
                    alignment: TabAlignment::Left,
                    leader: None,
                },
            ]),
            ..ParagraphFormat::default()
        };
        assert!(validate_format(&bad_tabs).is_err());
    }

    #[test]
    fn style_paragraph_props_gate() {
        assert!(style_has_paragraph_props(&json!({
            "bold": true,
            "paragraph": {"alignment": "center"}
        })));
        assert!(!style_has_paragraph_props(&json!({"bold": true})));
        assert!(!style_has_paragraph_props(&json!({"paragraph": null})));
        assert!(!style_has_paragraph_props(&json!("not an object")));
        let patch = style_paragraph_patch(&json!({
            "paragraph": {"indent_left": 720, "tabs": null}
        }))
        .unwrap()
        .unwrap();
        assert_eq!(patch.indent_left, Some(Some(720)));
        assert_eq!(patch.tabs, Some(None));
        assert!(style_paragraph_patch(&json!({"paragraph": null}))
            .unwrap()
            .is_none());
        assert!(style_paragraph_patch(&json!({"paragraph": {"alignment": "bad"}})).is_err());
    }
}

#[cfg(test)]
mod engine_tests {
    use super::*;
    use crate::QuillEngine;
    use ignition_core::{decode_envelope, encode_envelope, Command, CommandResult, Engine};
    use serde_json::json;

    fn engine() -> QuillEngine {
        QuillEngine::new()
    }

    fn apply(e: &mut QuillEngine, op: &str, payload: Value) -> CommandResult {
        e.apply(Command::new(op, payload)).unwrap()
    }

    fn format_of(e: &QuillEngine, block: usize) -> Option<&ParagraphFormat> {
        e.blocks[block].format.as_ref()
    }

    #[test]
    fn set_alignment_indent_and_tabs_then_partial_clear() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"hello"}));
        let r = apply(
            &mut e,
            "setParagraphFormat",
            json!({"block":0,"alignment":"center","indent_left":720,
                   "indent_first":-360,
                   "tabs":[{"position":1440,"alignment":"right","leader":"dot"},
                           {"position":2880,"alignment":"decimal"}]}),
        );
        assert_eq!(r.data["ok"], true);
        let f = format_of(&e, 0).unwrap();
        assert_eq!(f.alignment, Some(ParagraphAlignment::Center));
        assert_eq!(f.indent_left, Some(720));
        assert_eq!(f.indent_right, None);
        assert_eq!(f.indent_first, Some(-360));
        assert_eq!(f.tabs.as_ref().unwrap().len(), 2);
        // describe/blocks expose the stored format.
        let described = apply(&mut e, "describe", json!({}));
        assert_eq!(described.data["blocks"][0]["format"]["alignment"], "center");
        assert_eq!(
            described.data["blocks"][0]["format"]["tabs"][0]["leader"],
            "dot"
        );

        // Partial patch: absent keys untouched, explicit null clears.
        apply(
            &mut e,
            "setParagraphFormat",
            json!({"block":0,"indent_right":360,"alignment":null}),
        );
        let f = format_of(&e, 0).unwrap();
        assert_eq!(f.alignment, None);
        assert_eq!(f.indent_left, Some(720));
        assert_eq!(f.indent_right, Some(360));
        assert_eq!(f.indent_first, Some(-360));
        assert_eq!(f.tabs.as_ref().unwrap().len(), 2);

        // Clearing everything canonicalizes format away entirely.
        apply(
            &mut e,
            "setParagraphFormat",
            json!({"block":0,"indent_left":null,"indent_right":null,
                   "indent_first":null,"tabs":null}),
        );
        assert!(format_of(&e, 0).is_none());
        let described = apply(&mut e, "describe", json!({}));
        assert!(described.data["blocks"][0].get("format").is_none());
    }

    #[test]
    fn equal_writes_and_empty_patches_are_eventless() {
        let mut e = engine();
        // No format fields at all.
        let r = apply(&mut e, "setParagraphFormat", json!({"block":0}));
        assert!(r.events.is_empty());
        let snap = e.snapshot().unwrap();
        // Setting then re-setting the same value.
        apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"right"}));
        let r = apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"right"}));
        assert!(r.events.is_empty());
        // Clearing an unset field is also eventless.
        let r = apply(&mut e, "setParagraphFormat", json!({"block":0,"indent_left":null}));
        assert!(r.events.is_empty());
        // The eventless calls left state untouched since the real write.
        assert_ne!(e.snapshot().unwrap(), snap);
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Right));
    }

    #[test]
    fn bounds_and_table_blocks_reject_atomically() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"x"}));
        let before = e.snapshot().unwrap();
        for bad in [
            json!({"block":0,"alignment":"middle"}),
            json!({"block":0,"indent_left":31681}),
            json!({"block":0,"indent_left":-5}),
            json!({"block":0,"indent_first":40000}),
            json!({"block":0,"indent_first":-1e30}),
            json!({"block":0,"indent_left":1e30}),
            json!({"block":0,"tabs":[{"position":200,"alignment":"left"},{"position":100,"alignment":"left"}]}),
            json!({"block":0,"tabs":[{"position":1,"alignment":"bar"}]}),
            json!({"block":0,"tabs":[{"position":1.5,"alignment":"left"}]}),
            json!({"block":9,"alignment":"center"}),
        ] {
            assert!(e.apply(Command::new("setParagraphFormat", bad.clone())).is_err(), "{bad}");
            assert_eq!(e.snapshot().unwrap(), before, "state changed on {bad}");
        }
        // Table blocks reject.
        apply(&mut e, "insertTable", json!({"index":1,"rows":1,"cols":1}));
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new(
                "setParagraphFormat",
                json!({"block":1,"alignment":"center"})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn undo_redo_restores_format() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"abc"}));
        apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"justify","indent_left":720}));
        let formatted = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert!(format_of(&e, 0).is_none());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), formatted);
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Justify));
    }

    #[test]
    fn format_rides_splits_merges_and_inserts() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"abcdef"}));
        apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"center"}));
        // \n-split carries format to both halves.
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":3},"text":"\n"}));
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Center));
        assert_eq!(format_of(&e, 1).unwrap().alignment, Some(ParagraphAlignment::Center));
        // splitBlock likewise.
        apply(&mut e, "splitBlock", json!({"at":{"block":0,"offset":1}}));
        assert_eq!(e.blocks.len(), 3);
        assert!(e.blocks.iter().all(|b| b.format.is_some()));
        // mergeBlock keeps the head block's format.
        apply(&mut e, "mergeBlock", json!({"index":1}));
        assert_eq!(e.blocks.len(), 2);
        assert!(e.blocks.iter().all(|b| b.format.is_some()));
        // deleteRange across blocks keeps the head (first) block's format.
        apply(
            &mut e,
            "setParagraphFormat",
            json!({"block":1,"alignment":"right","indent_left":null}),
        );
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":1,"offset":1}}),
        );
        assert_eq!(e.blocks.len(), 1);
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Center));
    }

    #[test]
    fn snapshot_emits_schema4_and_round_trips() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"styled"}));
        apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"center","tabs":[{"position":720,"alignment":"left"}]}));
        let bytes = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&bytes).unwrap();
        let v: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(v["kind"], "quill");
        assert_eq!(v["schema"], 4);
        assert_eq!(v["document"]["blocks"][0]["format"]["alignment"], "center");
        // Bookmarks empty: schema:3 collections still serialize.
        assert_eq!(v["document"]["bookmarks"], json!([]));

        let mut re = engine();
        re.restore(&bytes).unwrap();
        assert_eq!(re.snapshot().unwrap(), bytes);
        assert_eq!(format_of(&re, 0).unwrap().alignment, Some(ParagraphAlignment::Center));

        // Without format the same document stays on the legacy shape.
        let mut plain = engine();
        apply(&mut plain, "insertText", json!({"at":{"block":0,"offset":0},"text":"plain"}));
        let plain_bytes = plain.snapshot().unwrap();
        let (_, p2) = decode_envelope(&plain_bytes).unwrap();
        let v2: Value = serde_json::from_slice(p2).unwrap();
        assert!(v2.get("kind").is_none(), "expected unwrapped legacy payload");
    }

    #[test]
    fn hostile_restore_rejects_mislabeled_and_invalid_formats() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"x"}));
        apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"center"}));
        let bytes = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&bytes).unwrap();
        let good: Value = serde_json::from_slice(payload).unwrap();

        let mut re = engine();
        let before = re.snapshot().unwrap();
        // schema:3 relabel of a format-carrying payload rejects.
        let mut mislabeled = good.clone();
        mislabeled["schema"] = json!(3);
        assert!(re
            .restore(&encode_envelope(&serde_json::to_vec(&mislabeled).unwrap()))
            .is_err());
        // Out-of-bounds indent inside schema:4 rejects.
        let mut bad = good.clone();
        bad["document"]["blocks"][0]["format"]["indent_left"] = json!(99999);
        assert!(re
            .restore(&encode_envelope(&serde_json::to_vec(&bad).unwrap()))
            .is_err());
        // Stray key inside format rejects (deny_unknown_fields).
        let mut bad = good.clone();
        bad["document"]["blocks"][0]["format"]["bogus"] = json!(1);
        assert!(re
            .restore(&encode_envelope(&serde_json::to_vec(&bad).unwrap()))
            .is_err());
        // Unsorted tab stops reject.
        let mut bad = good.clone();
        bad["document"]["blocks"][0]["format"]["tabs"] = json!([
            {"position": 500, "alignment": "left"},
            {"position": 100, "alignment": "left"}
        ]);
        assert!(re
            .restore(&encode_envelope(&serde_json::to_vec(&bad).unwrap()))
            .is_err());
        // Format on a table block rejects via validate_tables.
        let mut e2 = engine();
        apply(&mut e2, "insertTable", json!({"index":0,"rows":1,"cols":1}));
        let tbytes = e2.snapshot().unwrap();
        let (_, tp) = decode_envelope(&tbytes).unwrap();
        let mut tv: Value = serde_json::from_slice(tp).unwrap();
        // insertTable alone emits legacy {blocks:[...]} — add format smuggled in.
        tv["blocks"][0]["format"] = json!({"alignment":"center"});
        let mut e3 = engine();
        assert!(e3
            .restore(&encode_envelope(&serde_json::to_vec(&tv).unwrap()))
            .is_err());
        // Cell paragraph carrying format rejects.
        let mut cv: Value = serde_json::from_slice(tp).unwrap();
        cv["blocks"][0]["table"]["cells"][0]["blocks"][0]["format"] =
            json!({"alignment":"center"});
        assert!(e3
            .restore(&encode_envelope(&serde_json::to_vec(&cv).unwrap()))
            .is_err());
        // Style properties.paragraph inside schema:3 rejects; schema:4 accepts.
        let mut e4 = engine();
        apply(&mut e4, "defineStyle", json!({
            "id":"p1","name":"P1","kind":"paragraph",
            "properties":{"paragraph":{"alignment":"center"}}
        }));
        let sbytes = e4.snapshot().unwrap();
        let (_, sp) = decode_envelope(&sbytes).unwrap();
        let sv: Value = serde_json::from_slice(sp).unwrap();
        assert_eq!(sv["schema"], 4, "style paragraph props require schema:4");
        let mut s3 = sv.clone();
        s3["schema"] = json!(3);
        assert!(e3
            .restore(&encode_envelope(&serde_json::to_vec(&s3).unwrap()))
            .is_err());
        assert_eq!(re.snapshot().unwrap(), before);
    }

    #[test]
    fn named_style_paragraph_props_apply_with_precedence() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"abc"}));
        // Direct format first, then a style whose paragraph patch merges.
        apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"left","indent_left":720}));
        apply(&mut e, "defineStyle", json!({
            "id":"centered","name":"Centered","kind":"paragraph",
            "properties":{"bold":true,"paragraph":{"alignment":"center","indent_right":360}}
        }));
        apply(&mut e, "setBlockStyle", json!({"block":0,"style_id":"centered"}));
        let f = format_of(&e, 0).unwrap();
        // Style's present keys win; absent keys (indent_left) untouched.
        assert_eq!(f.alignment, Some(ParagraphAlignment::Center));
        assert_eq!(f.indent_left, Some(720));
        assert_eq!(f.indent_right, Some(360));
        // Inline stamp still happens.
        assert!(e.blocks[0].inlines[0].style.bold);
        // updateStyle never propagates to already-styled content.
        apply(&mut e, "updateStyle", json!({
            "id":"centered","properties":{"paragraph":{"alignment":"right"}}
        }));
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Center));
        // Clearing the reference leaves stamped format in place.
        apply(&mut e, "setBlockStyle", json!({"block":0,"style_id":null}));
        assert!(format_of(&e, 0).is_some());
        // Character styles cannot carry paragraph props.
        assert!(e
            .apply(Command::new(
                "defineStyle",
                json!({"id":"c1","name":"C1","kind":"character",
                       "properties":{"paragraph":{"alignment":"center"}}})
            ))
            .is_err());
        // Malformed paragraph grammar rejects on define.
        assert!(e
            .apply(Command::new(
                "defineStyle",
                json!({"id":"p2","name":"P2","kind":"paragraph",
                       "properties":{"paragraph":{"indent_left":99999}}})
            ))
            .is_err());
    }

    #[test]
    fn batch_and_replace_range_preserve_format() {
        let mut e = engine();
        apply(&mut e, "insertText", json!({"at":{"block":0,"offset":0},"text":"hello world"}));
        apply(&mut e, "setParagraphFormat", json!({"block":0,"alignment":"center"}));
        // replaceRange rebuilds blocks — format survives.
        apply(
            &mut e,
            "replaceRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":5},"text":"goodbye"}),
        );
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Center));
        // changeCase preserves format.
        apply(
            &mut e,
            "changeCase",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":7},"mode":"upper"}),
        );
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Center));
        // A batch mixing format + text edits undoes as one entry.
        apply(&mut e, "setParagraphFormat", json!({"block":0,"indent_left":360}));
        e.undo().unwrap();
        assert_eq!(format_of(&e, 0).unwrap().alignment, Some(ParagraphAlignment::Center));
        assert_eq!(format_of(&e, 0).unwrap().indent_left, None);
    }
}
