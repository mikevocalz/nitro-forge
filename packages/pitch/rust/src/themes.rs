//! Deck themes: named color/font slot bundles (P14 slice 9).
//!
//! DATA ONLY — HONESTY BOUNDARY: the engine stores and validates named
//! deck themes plus the deck→theme binding (`PitchState.deck_theme`). It
//! does NOT resolve theme slots onto objects, masters, layouts or
//! placeholders, and it performs no color/font substitution — hosts read
//! `describe` output as data and own any application. Placeholder
//! `inherit_theme` flags (masters.rs) and master/layout backgrounds stay
//! independent stored data; nothing in this module rewrites them.
//!
//! Model (bounded, mirrors the pinned NYC-Tron
//! `ThemeAndTemplateGallery` contract): the gallery's `kind:"theme"`
//! presets are host-supplied catalog entries, so the engine keeps a flat
//! deck-level collection of named themes — `id`, `name`, sparse
//! `colors`/`fonts` slot maps. Color slots follow the OOXML theme color
//! roles (`dk1|lt1|dk2|lt2|accent1..accent6|hlink|fol_hlink`); font slots
//! are the OOXML major/minor latin typefaces (`major_latin|minor_latin`).
//! Slots are sparse: an absent slot means "no theme value stored", never
//! an implicit default. NYC-Tron `kind:"template"` presets (a bundled
//! theme + master/layout set) are DEFERRED — masters/layouts/placeholders
//! are separate validated collections and the apply/bind slice does not
//! exist yet, so a template bundle has no honest semantics to store; see
//! docs/ENGINE_OPS.md.
//!
//! Identities: theme ids share the document `next_id` space (same as
//! slides/objects/masters/layouts/placeholders). `deck_theme` is
//! `Option<u64>`; `setDeckTheme` binds a slide deck to an existing theme
//! (`theme:null` clears). `removeTheme` on the bound theme clears the
//! binding; removing an unbound theme leaves `deck_theme` untouched.

use super::*;
use std::collections::BTreeMap;

/// Bounded theme count per deck (the NYC-Tron gallery catalog itself is
/// host-side; the engine stores only deck-owned themes).
const MAX_THEMES: usize = 32;
/// Theme names and font family names: 1..=128 UTF-8 bytes, non-blank
/// after trimming (same rule as master/layout names).
const MAX_THEME_NAME_BYTES: usize = 128;

/// Bounded theme color slot catalog — the OOXML theme color roles.
/// Serialized snake_case; sparse maps store only slots the theme sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeColorSlot {
    Dk1,
    Lt1,
    Dk2,
    Lt2,
    Accent1,
    Accent2,
    Accent3,
    Accent4,
    Accent5,
    Accent6,
    Hlink,
    FolHlink,
}

impl ThemeColorSlot {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "dk1" => Some(Self::Dk1),
            "lt1" => Some(Self::Lt1),
            "dk2" => Some(Self::Dk2),
            "lt2" => Some(Self::Lt2),
            "accent1" => Some(Self::Accent1),
            "accent2" => Some(Self::Accent2),
            "accent3" => Some(Self::Accent3),
            "accent4" => Some(Self::Accent4),
            "accent5" => Some(Self::Accent5),
            "accent6" => Some(Self::Accent6),
            "hlink" => Some(Self::Hlink),
            "fol_hlink" => Some(Self::FolHlink),
            _ => None,
        }
    }
}

/// Bounded theme font slot catalog — the OOXML major/minor latin
/// typefaces (heading vs body font roles). Values are font family names,
/// stored as data only; the engine never resolves or measures fonts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeFontSlot {
    MajorLatin,
    MinorLatin,
}

impl ThemeFontSlot {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "major_latin" => Some(Self::MajorLatin),
            "minor_latin" => Some(Self::MinorLatin),
            _ => None,
        }
    }
}

/// A named deck theme: sparse color/font slot maps. `colors`/`fonts`
/// hold only the slots the theme explicitly sets; absent slots are data
/// absence, not defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeckTheme {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub colors: BTreeMap<ThemeColorSlot, [u8; 4]>,
    #[serde(default)]
    pub fonts: BTreeMap<ThemeFontSlot, String>,
}

fn check_theme_name(name: &str) -> Result<(), EngineError> {
    if name.trim().is_empty() || name.len() > MAX_THEME_NAME_BYTES {
        return Err(EngineError::validation(format!(
            "theme name must be non-blank and <= {MAX_THEME_NAME_BYTES} UTF-8 bytes"
        )));
    }
    Ok(())
}

fn check_font_name(font: &str) -> Result<(), EngineError> {
    if font.trim().is_empty() || font.len() > MAX_THEME_NAME_BYTES {
        return Err(EngineError::validation(format!(
            "theme font must be non-blank and <= {MAX_THEME_NAME_BYTES} UTF-8 bytes"
        )));
    }
    Ok(())
}

/// Full structural check shared by ops (validation errors, run on the
/// staged candidate) and restore (propagated like masters::validate).
/// Id UNIQUENESS across the whole id space is enforced by the caller's
/// shared `ids` set in restore; ops allocate from `next_id` so duplicates
/// are unreachable there. Color/font slot keys are typed enums, so a
/// hostile restore cannot smuggle unknown slots — serde rejects them as
/// unknown variants before this runs. This check covers counts, names,
/// font bounds and the deck→theme binding.
pub(super) fn validate(state: &PitchState) -> Result<(), EngineError> {
    if state.themes.len() > MAX_THEMES {
        return Err(EngineError::validation(format!(
            "theme count exceeds {MAX_THEMES}"
        )));
    }
    let mut theme_ids = std::collections::BTreeSet::new();
    for theme in &state.themes {
        if theme.id == 0 || !theme_ids.insert(theme.id) {
            return Err(EngineError::validation("invalid or duplicate theme identity"));
        }
        check_theme_name(&theme.name)?;
        for font in theme.fonts.values() {
            check_font_name(font)?;
        }
    }
    if let Some(bound) = state.deck_theme {
        if !theme_ids.contains(&bound) {
            return Err(EngineError::validation(
                "deck theme references a missing theme",
            ));
        }
    }
    Ok(())
}

/// Allocate a document id from the shared `next_id` space on the staged
/// state; mirrors masters::alloc_id.
fn alloc_id(next: &mut PitchState) -> Result<u64, EngineError> {
    if next.next_id == 0 || next.next_id >= 9_007_199_254_740_991 {
        return Err(EngineError::validation("safe identity capacity exhausted"));
    }
    let id = next.next_id;
    next.next_id += 1;
    Ok(id)
}

fn theme_index(next: &PitchState, id: u64) -> Result<usize, EngineError> {
    next.themes
        .iter()
        .position(|t| t.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no theme with id {id}")))
}

/// `colors`/`fonts` payload fields on `addTheme`: an object mapping slot
/// names to values. Absent means an empty map.
fn parse_color_map(v: Option<&Value>) -> Result<BTreeMap<ThemeColorSlot, [u8; 4]>, EngineError> {
    let mut out = BTreeMap::new();
    let Some(v) = v else { return Ok(out) };
    let obj = v
        .as_object()
        .ok_or_else(|| EngineError::invalid("theme colors must be an object of slot → [r,g,b,a]"))?;
    for (key, value) in obj {
        let slot = ThemeColorSlot::parse(key).ok_or_else(|| {
            EngineError::validation(format!(
                "unknown theme color slot '{key}' (expected dk1|lt1|dk2|lt2|accent1..accent6|hlink|fol_hlink)"
            ))
        })?;
        out.insert(slot, parse_color(value)?);
    }
    Ok(out)
}

fn parse_font_map(v: Option<&Value>) -> Result<BTreeMap<ThemeFontSlot, String>, EngineError> {
    let mut out = BTreeMap::new();
    let Some(v) = v else { return Ok(out) };
    let obj = v
        .as_object()
        .ok_or_else(|| EngineError::invalid("theme fonts must be an object of slot → font name"))?;
    for (key, value) in obj {
        let slot = ThemeFontSlot::parse(key).ok_or_else(|| {
            EngineError::validation(format!(
                "unknown theme font slot '{key}' (expected major_latin|minor_latin)"
            ))
        })?;
        let font = value
            .as_str()
            .ok_or_else(|| EngineError::invalid("theme font values must be strings"))?;
        check_font_name(font)?;
        out.insert(slot, font.to_string());
    }
    Ok(out)
}

pub(super) fn apply(engine: &mut PitchEngine, cmd: &Command) -> Result<CommandResult, EngineError> {
    let p = &cmd.payload;
    let mut next = engine.state.clone();
    let mut data = json!({"ok":true});
    match cmd.op.as_str() {
        "addTheme" => {
            let name = req_str(p, "name")?.to_string();
            let colors = parse_color_map(p.get("colors"))?;
            let fonts = parse_font_map(p.get("fonts"))?;
            let id = alloc_id(&mut next)?;
            next.themes.push(DeckTheme { id, name, colors, fonts });
            data = json!({"theme_id":id});
        }
        "renameTheme" => {
            let id = req_u64(p, "id")?;
            let index = theme_index(&next, id)?;
            next.themes[index].name = req_str(p, "name")?.to_string();
        }
        "setThemeColor" => {
            let id = req_u64(p, "id")?;
            let index = theme_index(&next, id)?;
            let slot_name = req_str(p, "slot")?;
            let slot = ThemeColorSlot::parse(&slot_name).ok_or_else(|| {
                EngineError::validation(
                    "theme color slot must be dk1|lt1|dk2|lt2|accent1..accent6|hlink|fol_hlink",
                )
            })?;
            match p.get("color") {
                None | Some(Value::Null) => {
                    next.themes[index].colors.remove(&slot);
                }
                Some(v) => {
                    next.themes[index].colors.insert(slot, parse_color(v)?);
                }
            }
        }
        "setThemeFont" => {
            let id = req_u64(p, "id")?;
            let index = theme_index(&next, id)?;
            let slot_name = req_str(p, "slot")?;
            let slot = ThemeFontSlot::parse(&slot_name).ok_or_else(|| {
                EngineError::validation("theme font slot must be major_latin|minor_latin")
            })?;
            match p.get("font") {
                None | Some(Value::Null) => {
                    next.themes[index].fonts.remove(&slot);
                }
                Some(v) => {
                    let font = v
                        .as_str()
                        .ok_or_else(|| EngineError::invalid("theme font must be a string"))?;
                    check_font_name(font)?;
                    next.themes[index].fonts.insert(slot, font.to_string());
                }
            }
        }
        "removeTheme" => {
            let id = req_u64(p, "id")?;
            let index = theme_index(&next, id)?;
            next.themes.remove(index);
            // The deck binding follows the theme: removing the bound theme
            // clears `deck_theme`; other bindings are untouched.
            if next.deck_theme == Some(id) {
                next.deck_theme = None;
            }
        }
        "setDeckTheme" => {
            let theme = match p.get("theme") {
                None | Some(Value::Null) => None,
                Some(v) => {
                    let id = v
                        .as_u64()
                        .ok_or_else(|| EngineError::invalid("theme must be a theme id or null"))?;
                    theme_index(&next, id)?;
                    Some(id)
                }
            };
            next.deck_theme = theme;
        }
        _ => return Err(EngineError::unsupported("unknown theme operation")),
    }
    validate(&next)?;
    if next == engine.state {
        return Ok(ro(data));
    }
    engine.journal.record(engine.state.clone());
    engine.state = next;
    Ok(CommandResult::data(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(e: &mut PitchEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }

    fn err(e: &mut PitchEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }

    fn id_of(result: &CommandResult, key: &str) -> u64 {
        result.data[key].as_u64().unwrap()
    }

    fn theme(e: &mut PitchEngine, name: &str) -> u64 {
        id_of(&call(e, "addTheme", json!({"name":name})), "theme_id")
    }

    #[test]
    fn theme_crud_binding_and_snapshot_roundtrip() {
        let mut e = PitchEngine::new();
        let t = id_of(
            &call(
                &mut e,
                "addTheme",
                json!({
                    "name":"Brand",
                    "colors":{"accent1":[10,20,30,255],"dk1":[1,2,3,255]},
                    "fonts":{"major_latin":"Inter","minor_latin":"Inter"}
                }),
            ),
            "theme_id",
        );
        call(
            &mut e,
            "setThemeColor",
            json!({"id":t,"slot":"accent2","color":[200,100,50,255]}),
        );
        call(
            &mut e,
            "setThemeFont",
            json!({"id":t,"slot":"minor_latin","font":"Georgia"}),
        );
        call(&mut e, "renameTheme", json!({"id":t,"name":"Brand v2"}));
        call(&mut e, "setDeckTheme", json!({"theme":t}));

        let stored = &e.state.themes[0];
        assert_eq!(stored.name, "Brand v2");
        assert_eq!(stored.colors[&ThemeColorSlot::Accent1], [10, 20, 30, 255]);
        assert_eq!(stored.colors[&ThemeColorSlot::Accent2], [200, 100, 50, 255]);
        assert_eq!(stored.fonts[&ThemeFontSlot::MinorLatin], "Georgia");
        assert_eq!(e.state.deck_theme, Some(t));

        // describe exposes themes and the binding as data.
        let d = call(&mut e, "describe", json!({})).data;
        assert_eq!(d["themes"][0]["name"], "Brand v2");
        assert_eq!(d["themes"][0]["colors"]["accent1"], json!([10, 20, 30, 255]));
        assert_eq!(d["themes"][0]["fonts"]["minor_latin"], "Georgia");
        assert_eq!(d["deck_theme"], t);

        // Theme state forces the schema:6 wrapper; a fresh engine must
        // round-trip the exact bytes.
        let bytes = e.snapshot().unwrap();
        let wrapped: Value = serde_json::from_slice(&decode_envelope(&bytes).unwrap().1).unwrap();
        assert_eq!(wrapped["schema"], 6);
        let mut re = PitchEngine::new();
        re.restore(&bytes).unwrap();
        assert_eq!(re.snapshot().unwrap(), bytes);
        assert_eq!(re.state.themes.len(), 1);
        assert_eq!(re.state.deck_theme, Some(t));
    }

    #[test]
    fn theme_equal_ops_are_eventless_and_undo_redo_covers_them() {
        let mut e = PitchEngine::new();
        let t = theme(&mut e, "T");
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("renameTheme", json!({"id":t,"name":"T"})),
            ("setThemeColor", json!({"id":t,"slot":"accent1","color":null})),
            ("setThemeFont", json!({"id":t,"slot":"major_latin","font":null})),
            ("setDeckTheme", json!({"theme":null})),
        ] {
            let r = call(&mut e, op, p);
            assert!(r.events.is_empty(), "{op} emitted events");
        }
        assert_eq!(e.snapshot().unwrap(), before);

        call(&mut e, "setDeckTheme", json!({"theme":t}));
        call(&mut e, "setThemeColor", json!({"id":t,"slot":"dk1","color":[9,9,9,255]}));
        let changed = e.snapshot().unwrap();
        // Two mutations → two journal entries; each undo peels one.
        assert!(e.undo().unwrap());
        assert_eq!(e.state.deck_theme, Some(t));
        assert!(e.state.themes[0].colors.is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
    }

    #[test]
    fn remove_bound_theme_clears_deck_binding() {
        let mut e = PitchEngine::new();
        let a = theme(&mut e, "A");
        let b = theme(&mut e, "B");
        call(&mut e, "setDeckTheme", json!({"theme":a}));
        call(&mut e, "removeTheme", json!({"id":b}));
        assert_eq!(e.state.deck_theme, Some(a));
        call(&mut e, "removeTheme", json!({"id":a}));
        assert_eq!(e.state.deck_theme, None);
        assert!(e.state.themes.is_empty());
    }

    #[test]
    fn theme_ops_validate_atomically_and_bound_counts() {
        let mut e = PitchEngine::new();
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("addTheme", json!({"name":""})),
            ("addTheme", json!({"name":"   "})),
            ("addTheme", json!({"name":"x".repeat(129)})),
            ("addTheme", json!({"name":"ok","colors":{"bogus":[0,0,0,255]}})),
            ("addTheme", json!({"name":"ok","colors":{"accent1":[256,0,0,255]}})),
            ("addTheme", json!({"name":"ok","colors":{"accent1":[0,0,0]}})),
            ("addTheme", json!({"name":"ok","fonts":{"bogus":"Inter"}})),
            ("addTheme", json!({"name":"ok","fonts":{"major_latin":""}})),
            ("addTheme", json!({"name":"ok","fonts":{"minor_latin":"x".repeat(129)}})),
            ("addTheme", json!({"name":"ok","fonts":{"major_latin":42}})),
            ("renameTheme", json!({"id":999,"name":"x"})),
            ("renameTheme", json!({"id":1,"name":""})),
            ("setThemeColor", json!({"id":999,"slot":"dk1","color":null})),
            ("setThemeColor", json!({"id":1,"slot":"bogus","color":null})),
            ("setThemeColor", json!({"id":1,"slot":"dk1","color":[1,2,3]})),
            ("setThemeFont", json!({"id":999,"slot":"major_latin","font":null})),
            ("setThemeFont", json!({"id":1,"slot":"bogus","font":"x"})),
            ("setThemeFont", json!({"id":1,"slot":"major_latin","font":"  "})),
            ("setThemeFont", json!({"id":1,"slot":"major_latin","font":7})),
            ("removeTheme", json!({"id":999})),
            ("setDeckTheme", json!({"theme":999})),
            ("setDeckTheme", json!({"theme":"x"})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op} should fail");
            assert_eq!(e.snapshot().unwrap(), before, "{op} mutated state");
        }
        // Cap: 32 themes.
        for i in 0..32 {
            theme(&mut e, &format!("T{i}"));
        }
        assert!(err(&mut e, "addTheme", json!({"name":"overflow"}))
            .to_string()
            .contains("theme count"));
    }

    #[test]
    fn hostile_restore_rejects_bad_themes_without_touching_state() {
        let mut e = PitchEngine::new();
        let t = theme(&mut e, "T");
        call(&mut e, "setDeckTheme", json!({"theme":t}));
        let good = e.snapshot().unwrap();

        let mut doc = serde_json::to_value(&e.state).unwrap();
        let cases: Vec<(&str, Value)> = vec![
            ("deck theme missing", {
                let mut d = doc.clone();
                d["deck_theme"] = json!(9999);
                d
            }),
            ("duplicate theme id", {
                let mut d = doc.clone();
                let dup = d["themes"][0].clone();
                d["themes"].as_array_mut().unwrap().push(dup);
                d
            }),
            ("blank theme name", {
                let mut d = doc.clone();
                d["themes"][0]["name"] = json!("   ");
                d
            }),
            ("oversize theme name", {
                let mut d = doc.clone();
                d["themes"][0]["name"] = json!("x".repeat(129));
                d
            }),
            ("blank font name", {
                let mut d = doc.clone();
                d["themes"][0]["fonts"] = json!({"major_latin":"  "});
                d
            }),
            ("unknown color slot", {
                let mut d = doc.clone();
                d["themes"][0]["colors"] = json!({"chart accent 1":[0,0,0,255]});
                d
            }),
            ("theme over cap", {
                let mut d = doc.clone();
                d["themes"] = json!(vec![d["themes"][0].clone(); 33]);
                for (i, t) in d["themes"].as_array_mut().unwrap().iter_mut().enumerate() {
                    t["id"] = json!(5000 + i);
                }
                d["deck_theme"] = json!(5000);
                d["next_id"] = json!(6000);
                d
            }),
        ];
        for (why, document) in cases {
            let payload = json!({"kind":"pitch","schema":6,"document":document});
            let bytes = encode_envelope(&serde_json::to_vec(&payload).unwrap());
            assert!(e.restore(&bytes).is_err(), "{why} accepted");
            assert_eq!(e.snapshot().unwrap(), good, "{why} mutated state");
        }
        // Pre-theme snapshots still restore with empty collections and no
        // binding; a schema:5-labeled wrapper is still accepted.
        let mut legacy = serde_json::to_value(&e.state).unwrap();
        legacy.as_object_mut().unwrap().remove("themes");
        legacy.as_object_mut().unwrap().remove("deck_theme");
        let bytes = encode_envelope(&serde_json::to_vec(&legacy).unwrap());
        e.restore(&bytes).unwrap();
        assert!(e.state.themes.is_empty());
        assert_eq!(e.state.deck_theme, None);
    }

    #[test]
    fn new_resets_themes_and_schema6_only_when_themes_exist() {
        let mut e = PitchEngine::new();
        let t = theme(&mut e, "T");
        call(&mut e, "setDeckTheme", json!({"theme":t}));
        let wrapped: Value = serde_json::from_slice(&decode_envelope(&e.snapshot().unwrap()).unwrap().1).unwrap();
        assert_eq!(wrapped["schema"], 6);
        // `new` drops themes, so the next snapshot leaves the schema:6 tier.
        call(&mut e, "new", json!({"title":"Fresh"}));
        assert!(e.state.themes.is_empty());
        assert_eq!(e.state.deck_theme, None);
        let bare = serde_json::from_slice::<Value>(&decode_envelope(&e.snapshot().unwrap()).unwrap().1).unwrap();
        assert!(bare.get("schema").is_none());
    }
}
