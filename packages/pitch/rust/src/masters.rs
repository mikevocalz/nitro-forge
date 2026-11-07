//! Slide masters, layouts and placeholder definitions (P14 slice 8a).
//!
//! DATA ONLY — HONESTY BOUNDARY: the engine stores and validates master /
//! layout / placeholder definitions plus the slide→layout binding
//! (`Slide.layout_id`). It does NOT render master content onto slides,
//! resolve placeholders into objects, or apply layout formatting — that is
//! the later apply/bind slice. Hosts read `describe` output as data.
//!
//! Model (bounded, mirrors the pinned NYC-Tron `MasterLayoutEditor`
//! contract): masters and layouts are FLAT deck-level collections on
//! `PitchState`; a layout carries `master_id` back-reference (PowerPoint
//! style ownership) rather than nesting, so `removeMaster` cascades to its
//! layouts explicitly. Placeholders live on layouts (NYC-Tron edits
//! placeholders per layout) as typed regions `{kind,x,y,w,h,label,
//! inherit_theme}`; `kind` is the bounded NYC-Tron catalog
//! `title|body|image|media|date|footer|pageNumber`. NYC-Tron layout
//! `parentId` inheritance is NOT modeled in this slice — deferred to the
//! apply/bind slice; `describe` never emits it.
//!
//! Identities: master/layout/placeholder ids share the document `next_id`
//! space (same as slides/objects/strokes/ink), so restore uniqueness is one
//! deck-wide set. `Slide.layout_id` is `Option<u64>`; `setSlideLayout`
//! binds a slide to an existing layout (`layout:null` clears). Removing a
//! layout clears every slide binding to it; removing a master cascade-
//! removes its layouts and clears the bindings to those layouts. Slides
//! themselves are unaffected by master/layout removal beyond the cleared
//! `layout_id` reference.

use super::*;
use std::collections::BTreeSet;

/// Bounded master count per deck.
const MAX_MASTERS: usize = 64;
/// Bounded layout count per deck (NYC-Tron editor caps at 512; the engine
/// stays tighter because layouts are deck-global here, not per-master).
const MAX_LAYOUTS: usize = 256;
/// Bounded placeholder regions per layout.
const MAX_PLACEHOLDERS_PER_LAYOUT: usize = 64;
/// Master/layout names and placeholder labels: 1..=128 UTF-8 bytes,
/// non-blank after trimming (same rule as section labels, tighter bound).
const MAX_NAME_BYTES: usize = 128;
/// Placeholder bounds are real regions: x/y are finite slide-space
/// coordinates within ±1,000,000 (same bound as connector endpoints);
/// w/h are finite, >0 and <=1,000,000 (same rule as media object bounds,
/// plus an upper magnitude bound).
const MAX_PLACEHOLDER_COORD: f64 = 1_000_000.0;

/// Bounded placeholder kind catalog mirroring the NYC-Tron
/// `MasterPlaceholder.kind` contract. Serialized camelCase; `"pageNumber"`
/// is the footer page-number region.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaceholderKind {
    Title,
    Body,
    Image,
    Media,
    Date,
    Footer,
    PageNumber,
}

impl PlaceholderKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "title" => Some(Self::Title),
            "body" => Some(Self::Body),
            "image" => Some(Self::Image),
            "media" => Some(Self::Media),
            "date" => Some(Self::Date),
            "footer" => Some(Self::Footer),
            "pageNumber" => Some(Self::PageNumber),
            _ => None,
        }
    }
}

/// Typed placeholder region stored on a layout. `x,y,w,h` are slide-space
/// units like object bounds (pre-rotation axis-aligned); `label` is the
/// host-facing region name (NYC-Tron `MasterPlaceholder.label`); 
/// `inherit_theme` mirrors NYC-Tron's `inheritTheme` flag — DATA ONLY, the
/// engine does not resolve theme inheritance in this slice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Placeholder {
    pub id: u64,
    pub kind: PlaceholderKind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub label: String,
    #[serde(default)]
    pub inherit_theme: bool,
}

/// A named slide layout belonging to one master (`master_id` must resolve).
/// `placeholders` are the typed regions hosts use when the later apply/bind
/// slice instantiates layout content onto slides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlideLayout {
    pub id: u64,
    pub master_id: u64,
    pub name: String,
    #[serde(default)]
    pub placeholders: Vec<Placeholder>,
}

/// A named slide master: the deck-level identity/layouts anchor. `background`
/// is an optional RGBA canvas color DATA for the host; the engine does not
/// paint it in this slice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlideMaster {
    pub id: u64,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<[u8; 4]>,
}

fn check_name(name: &str, what: &str) -> Result<(), EngineError> {
    if name.trim().is_empty() || name.len() > MAX_NAME_BYTES {
        return Err(EngineError::validation(format!(
            "{what} must be non-blank and <= {MAX_NAME_BYTES} UTF-8 bytes"
        )));
    }
    Ok(())
}

fn check_placeholder_bounds(p: &Placeholder) -> Result<(), EngineError> {
    if ![p.x, p.y].iter().all(|v| v.is_finite() && v.abs() <= MAX_PLACEHOLDER_COORD) {
        return Err(EngineError::validation(format!(
            "placeholder x/y must be finite and within ±{MAX_PLACEHOLDER_COORD}"
        )));
    }
    if !p.w.is_finite() || !p.h.is_finite() || p.w <= 0.0 || p.h <= 0.0
        || p.w > MAX_PLACEHOLDER_COORD || p.h > MAX_PLACEHOLDER_COORD
    {
        return Err(EngineError::validation(format!(
            "placeholder w/h must be finite, >0 and <= {MAX_PLACEHOLDER_COORD}"
        )));
    }
    check_name(&p.label, "placeholder label")
}

/// Full structural check shared by ops (validation errors, run on the
/// staged candidate) and restore (propagated like sections::validate).
/// Id UNIQUENESS across the whole id space is enforced by the caller's
/// shared `ids` set in restore; ops allocate from `next_id` so duplicates
/// are unreachable there. This check covers counts, names, bounds,
/// master/layout/placeholder referential integrity and slide bindings.
pub(super) fn validate(state: &PitchState) -> Result<(), EngineError> {
    if state.masters.len() > MAX_MASTERS {
        return Err(EngineError::validation(format!(
            "master count exceeds {MAX_MASTERS}"
        )));
    }
    if state.layouts.len() > MAX_LAYOUTS {
        return Err(EngineError::validation(format!(
            "layout count exceeds {MAX_LAYOUTS}"
        )));
    }
    let mut master_ids = BTreeSet::new();
    for master in &state.masters {
        if master.id == 0 || !master_ids.insert(master.id) {
            return Err(EngineError::validation("invalid or duplicate master identity"));
        }
        check_name(&master.name, "master name")?;
    }
    let mut layout_ids = BTreeSet::new();
    let mut placeholder_ids = BTreeSet::new();
    for layout in &state.layouts {
        if layout.id == 0 || !layout_ids.insert(layout.id) {
            return Err(EngineError::validation("invalid or duplicate layout identity"));
        }
        if !master_ids.contains(&layout.master_id) {
            return Err(EngineError::validation(
                "layout references a missing master",
            ));
        }
        check_name(&layout.name, "layout name")?;
        if layout.placeholders.len() > MAX_PLACEHOLDERS_PER_LAYOUT {
            return Err(EngineError::validation(format!(
                "placeholder count exceeds {MAX_PLACEHOLDERS_PER_LAYOUT} per layout"
            )));
        }
        for placeholder in &layout.placeholders {
            if placeholder.id == 0 || !placeholder_ids.insert(placeholder.id) {
                return Err(EngineError::validation(
                    "invalid or duplicate placeholder identity",
                ));
            }
            check_placeholder_bounds(placeholder)?;
        }
    }
    for slide in &state.slides {
        if let Some(layout_id) = slide.layout_id {
            if !layout_ids.contains(&layout_id) {
                return Err(EngineError::validation(
                    "slide references a missing layout",
                ));
            }
        }
    }
    Ok(())
}

/// Allocate a document id from the shared `next_id` space on the staged
/// state; mirrors `PitchEngine::preflight_id` bounds.
fn alloc_id(next: &mut PitchState) -> Result<u64, EngineError> {
    if next.next_id == 0 || next.next_id >= 9_007_199_254_740_991 {
        return Err(EngineError::validation("safe identity capacity exhausted"));
    }
    let id = next.next_id;
    next.next_id += 1;
    Ok(id)
}

fn layout_index(next: &PitchState, id: u64) -> Result<usize, EngineError> {
    next.layouts
        .iter()
        .position(|l| l.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no layout with id {id}")))
}

fn master_index(next: &PitchState, id: u64) -> Result<usize, EngineError> {
    next.masters
        .iter()
        .position(|m| m.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no master with id {id}")))
}

fn slide_index(next: &PitchState, id: u64) -> Result<usize, EngineError> {
    next.slides
        .iter()
        .position(|s| s.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no slide with id {id}")))
}

fn placeholder_index(layout: &SlideLayout, id: u64) -> Result<usize, EngineError> {
    layout
        .placeholders
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no placeholder with id {id}")))
}

/// Optional RGBA color payload field: absent or `null` clears to None.
fn opt_color(p: &Value, key: &str) -> Result<Option<[u8; 4]>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => parse_color(v).map(Some),
    }
}

fn parse_placeholder_kind(p: &Value) -> Result<PlaceholderKind, EngineError> {
    PlaceholderKind::parse(req_str(p, "kind")?).ok_or_else(|| {
        EngineError::validation(
            "placeholder kind must be \"title\"|\"body\"|\"image\"|\"media\"|\"date\"|\"footer\"|\"pageNumber\"",
        )
    })
}

fn parse_placeholder_geometry(p: &Value) -> Result<(f64, f64, f64, f64), EngineError> {
    Ok((
        req_f64(p, "x")?,
        req_f64(p, "y")?,
        req_f64(p, "w")?,
        req_f64(p, "h")?,
    ))
}

fn parse_inherit_theme(p: &Value) -> Result<bool, EngineError> {
    p.get("inherit_theme")
        .map(|v| {
            v.as_bool().ok_or_else(|| {
                EngineError::invalid("placeholder inherit_theme must be a boolean")
            })
        })
        .transpose()
        .map(|b| b.unwrap_or(false))
}

pub(super) fn apply(engine: &mut PitchEngine, cmd: &Command) -> Result<CommandResult, EngineError> {
    let p = &cmd.payload;
    let mut next = engine.state.clone();
    let mut data = json!({"ok":true});
    match cmd.op.as_str() {
        "addMaster" => {
            let name = req_str(p, "name")?.to_string();
            let background = opt_color(p, "background")?;
            let id = alloc_id(&mut next)?;
            next.masters.push(SlideMaster { id, name, background });
            data = json!({"master_id":id});
        }
        "renameMaster" => {
            let id = req_u64(p, "id")?;
            let index = master_index(&next, id)?;
            next.masters[index].name = req_str(p, "name")?.to_string();
        }
        "setMasterBackground" => {
            let id = req_u64(p, "id")?;
            let index = master_index(&next, id)?;
            next.masters[index].background = opt_color(p, "color")?;
        }
        "removeMaster" => {
            let id = req_u64(p, "id")?;
            let index = master_index(&next, id)?;
            next.masters.remove(index);
            // Cascade: the master's layouts die with it; slide bindings to
            // those layouts are cleared (slide content is untouched).
            let removed_layouts: std::collections::BTreeSet<u64> = next
                .layouts
                .iter()
                .filter(|l| l.master_id == id)
                .map(|l| l.id)
                .collect();
            next.layouts.retain(|l| l.master_id != id);
            for slide in &mut next.slides {
                if slide.layout_id.is_some_and(|lid| removed_layouts.contains(&lid)) {
                    slide.layout_id = None;
                }
            }
        }
        "addLayout" => {
            let master_id = req_u64(p, "master")?;
            master_index(&next, master_id)?;
            let name = req_str(p, "name")?.to_string();
            let id = alloc_id(&mut next)?;
            next.layouts.push(SlideLayout {
                id,
                master_id,
                name,
                placeholders: Vec::new(),
            });
            data = json!({"layout_id":id});
        }
        "renameLayout" => {
            let id = req_u64(p, "id")?;
            let index = layout_index(&next, id)?;
            next.layouts[index].name = req_str(p, "name")?.to_string();
        }
        "removeLayout" => {
            let id = req_u64(p, "id")?;
            let index = layout_index(&next, id)?;
            next.layouts.remove(index);
            // Slides bound to the removed layout keep their content; only
            // the layout reference is cleared.
            for slide in &mut next.slides {
                if slide.layout_id == Some(id) {
                    slide.layout_id = None;
                }
            }
        }
        "setSlideLayout" => {
            let slide_id = req_u64(p, "slide")?;
            let si = slide_index(&next, slide_id)?;
            let layout_id = match p.get("layout") {
                None | Some(Value::Null) => None,
                Some(v) => {
                    let id = v
                        .as_u64()
                        .ok_or_else(|| EngineError::invalid("layout must be a layout id or null"))?;
                    layout_index(&next, id)?;
                    Some(id)
                }
            };
            next.slides[si].layout_id = layout_id;
        }
        "addPlaceholder" => {
            let layout_id = req_u64(p, "layout")?;
            let li = layout_index(&next, layout_id)?;
            let (x, y, w, h) = parse_placeholder_geometry(p)?;
            let placeholder = Placeholder {
                id: 0,
                kind: parse_placeholder_kind(p)?,
                x,
                y,
                w,
                h,
                label: req_str(p, "label")?.to_string(),
                inherit_theme: parse_inherit_theme(p)?,
            };
            let id = alloc_id(&mut next)?;
            next.layouts[li].placeholders.push(Placeholder { id, ..placeholder });
            data = json!({"placeholder_id":id});
        }
        "updatePlaceholder" => {
            let layout_id = req_u64(p, "layout")?;
            let li = layout_index(&next, layout_id)?;
            let placeholder_id = req_u64(p, "id")?;
            let pi = placeholder_index(&next.layouts[li], placeholder_id)?;
            let target = &mut next.layouts[li].placeholders[pi];
            if p.get("kind").is_some() {
                target.kind = parse_placeholder_kind(p)?;
            }
            if p.get("x").is_some() {
                target.x = req_f64(p, "x")?;
            }
            if p.get("y").is_some() {
                target.y = req_f64(p, "y")?;
            }
            if p.get("w").is_some() {
                target.w = req_f64(p, "w")?;
            }
            if p.get("h").is_some() {
                target.h = req_f64(p, "h")?;
            }
            if p.get("label").is_some() {
                target.label = req_str(p, "label")?.to_string();
            }
            if p.get("inherit_theme").is_some() {
                target.inherit_theme = p
                    .get("inherit_theme")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| {
                        EngineError::invalid("placeholder inherit_theme must be a boolean")
                    })?;
            }
        }
        "removePlaceholder" => {
            let layout_id = req_u64(p, "layout")?;
            let li = layout_index(&next, layout_id)?;
            let placeholder_id = req_u64(p, "id")?;
            let pi = placeholder_index(&next.layouts[li], placeholder_id)?;
            next.layouts[li].placeholders.remove(pi);
        }
        _ => return Err(EngineError::unsupported("unknown master/layout operation")),
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

    fn master(e: &mut PitchEngine, name: &str) -> u64 {
        id_of(&call(e, "addMaster", json!({"name":name})), "master_id")
    }

    fn layout(e: &mut PitchEngine, master: u64, name: &str) -> u64 {
        id_of(
            &call(e, "addLayout", json!({"master":master,"name":name})),
            "layout_id",
        )
    }

    #[test]
    fn master_layout_placeholder_crud_roundtrips_through_snapshot() {
        let mut e = PitchEngine::new();
        let m = master(&mut e, "Corporate");
        let l = layout(&mut e, m, "Title Slide");
        let ph = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l,"kind":"title","x":40,"y":20,"w":880,"h":80,"label":"Deck title","inherit_theme":true}),
            ),
            "placeholder_id",
        );
        // describe exposes the stored definitions as data.
        let d = call(&mut e, "describe", json!({})).data;
        assert_eq!(d["masters"][0]["name"], "Corporate");
        assert_eq!(d["layouts"][0]["master_id"], m);
        assert_eq!(d["layouts"][0]["placeholders"][0]["kind"], "title");
        assert_eq!(d["layouts"][0]["placeholders"][0]["inherit_theme"], true);

        let bytes = e.snapshot().unwrap();
        // Masters/layouts force the schema:4 wrapper; a fresh engine must
        // round-trip the exact bytes.
        let mut re = PitchEngine::new();
        re.restore(&bytes).unwrap();
        assert_eq!(re.snapshot().unwrap(), bytes);
        assert_eq!(re.state.masters.len(), 1);
        assert_eq!(re.state.layouts[0].placeholders[0].id, ph);

        // Rename + patch + remove chains stay consistent.
        call(&mut e, "renameMaster", json!({"id":m,"name":"Brand"}));
        call(&mut e, "renameLayout", json!({"id":l,"name":"Cover"}));
        call(&mut e, "updatePlaceholder", json!({"layout":l,"id":ph,"kind":"body","h":120}));
        assert_eq!(e.state.layouts[0].placeholders[0].kind, PlaceholderKind::Body);
        assert_eq!(e.state.layouts[0].placeholders[0].h, 120.0);
        call(&mut e, "removePlaceholder", json!({"layout":l,"id":ph}));
        assert!(e.state.layouts[0].placeholders.is_empty());
        call(&mut e, "removeLayout", json!({"id":l}));
        assert!(e.state.layouts.is_empty());
        call(&mut e, "removeMaster", json!({"id":m}));
        assert!(e.state.masters.is_empty());
    }

    #[test]
    fn slide_layout_binding_clears_on_layout_and_master_removal() {
        let mut e = PitchEngine::new();
        let slide = e.state.slides[0].id;
        let m = master(&mut e, "M");
        let l = layout(&mut e, m, "L");
        call(&mut e, "setSlideLayout", json!({"slide":slide,"layout":l}));
        assert_eq!(e.state.slides[0].layout_id, Some(l));
        // Equal rebind is an eventless no-op preserving redo.
        let before = e.snapshot().unwrap();
        let noop = call(&mut e, "setSlideLayout", json!({"slide":slide,"layout":l}));
        assert!(noop.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);
        // null clears.
        call(&mut e, "setSlideLayout", json!({"slide":slide,"layout":null}));
        assert_eq!(e.state.slides[0].layout_id, None);
        call(&mut e, "setSlideLayout", json!({"slide":slide,"layout":l}));
        // removeLayout clears the binding but keeps the slide.
        call(&mut e, "removeLayout", json!({"id":l}));
        assert_eq!(e.state.slides.len(), 1);
        assert_eq!(e.state.slides[0].layout_id, None);
        // Cascade through the master path too.
        let l2 = layout(&mut e, m, "L2");
        call(&mut e, "setSlideLayout", json!({"slide":slide,"layout":l2}));
        call(&mut e, "removeMaster", json!({"id":m}));
        assert!(e.state.layouts.is_empty());
        assert_eq!(e.state.slides[0].layout_id, None);
        // Undo restores the whole cascade in one step.
        assert!(e.undo().unwrap());
        assert_eq!(e.state.slides[0].layout_id, Some(l2));
        assert_eq!(e.state.layouts.len(), 1);
    }

    #[test]
    fn master_ops_validate_atomically_and_bound_counts() {
        let mut e = PitchEngine::new();
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("addMaster", json!({"name":""})),
            ("addMaster", json!({"name":"   "})),
            ("addMaster", json!({"name":"x".repeat(129)})),
            ("addMaster", json!({"name":"ok","background":[1,2,3]})),
            ("addMaster", json!({"name":"ok","background":[256,0,0,255]})),
            ("renameMaster", json!({"id":999,"name":"x"})),
            ("setMasterBackground", json!({"id":999,"color":null})),
            ("removeMaster", json!({"id":999})),
            ("addLayout", json!({"master":999,"name":"x"})),
            ("addLayout", json!({"master":1,"name":""})),
            ("renameLayout", json!({"id":999,"name":"x"})),
            ("removeLayout", json!({"id":999})),
            ("setSlideLayout", json!({"slide":999,"layout":null})),
            ("setSlideLayout", json!({"slide":1,"layout":999})),
            ("setSlideLayout", json!({"slide":1,"layout":"x"})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op} should fail");
            assert_eq!(e.snapshot().unwrap(), before, "{op} mutated state");
        }
        // Caps: 64 masters, 256 layouts, 64 placeholders per layout.
        for i in 0..64 {
            master(&mut e, &format!("M{i}"));
        }
        assert!(err(&mut e, "addMaster", json!({"name":"one too many"}))
            .to_string()
            .contains("master count"));
        let m = e.state.masters[0].id;
        for i in 0..256 {
            layout(&mut e, m, &format!("L{i}"));
        }
        assert!(err(&mut e, "addLayout", json!({"master":m,"name":"overflow"}))
            .to_string()
            .contains("layout count"));
        let l = e.state.layouts[0].id;
        for i in 0..64 {
            call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l,"kind":"body","x":0,"y":0,"w":10,"h":10,"label":format!("P{i}")}),
            );
        }
        assert!(err(
            &mut e,
            "addPlaceholder",
            json!({"layout":l,"kind":"body","x":0,"y":0,"w":10,"h":10,"label":"overflow"})
        )
        .to_string()
        .contains("placeholder count"));
    }

    #[test]
    fn placeholder_bounds_kinds_and_patch_validation() {
        let mut e = PitchEngine::new();
        let m = master(&mut e, "M");
        let l = layout(&mut e, m, "L");
        for (p, why) in [
            (json!({"layout":l,"kind":"bogus","x":0,"y":0,"w":1,"h":1,"label":"a"}), "kind"),
            (json!({"layout":l,"kind":"title","x":"0","y":0,"w":1,"h":1,"label":"a"}), "x"),
            (json!({"layout":l,"kind":"title","x":0,"y":0,"w":0,"h":1,"label":"a"}), "w"),
            (json!({"layout":l,"kind":"title","x":0,"y":0,"w":-1,"h":1,"label":"a"}), "w"),
            (json!({"layout":l,"kind":"title","x":0,"y":0,"w":1,"h":1,"label":""}), "label"),
            (json!({"layout":l,"kind":"title","x":0,"y":0,"w":1,"h":1,"label":"x".repeat(129)}), "label"),
            (json!({"layout":l,"kind":"title","x":2_000_000.0,"y":0,"w":1,"h":1,"label":"a"}), "x bound"),
            (json!({"layout":l,"kind":"title","x":0,"y":0,"w":1,"h":1,"label":"a","inherit_theme":"yes"}), "inherit_theme"),
            (json!({"layout":999,"kind":"title","x":0,"y":0,"w":1,"h":1,"label":"a"}), "missing layout"),
        ] {
            assert!(e.apply(Command::new("addPlaceholder", p)).is_err(), "{why} accepted");
        }
        let ph = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l,"kind":"date","x":-5,"y":-5,"w":50,"h":20,"label":"Date"}),
            ),
            "placeholder_id",
        );
        for (op, p) in [
            ("updatePlaceholder", json!({"layout":l,"id":999,"kind":"body"})),
            ("updatePlaceholder", json!({"layout":l,"id":ph,"w":-3})),
            ("updatePlaceholder", json!({"layout":l,"id":ph,"label":""})),
            ("updatePlaceholder", json!({"layout":l,"id":ph,"inherit_theme":1})),
            ("removePlaceholder", json!({"layout":l,"id":999})),
            ("removePlaceholder", json!({"layout":999,"id":ph})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err(), "{op} accepted");
        }
        // Every bounded kind is admitted.
        for kind in ["title","body","image","media","date","footer","pageNumber"] {
            call(&mut e, "addPlaceholder",
                json!({"layout":l,"kind":kind,"x":0,"y":0,"w":10,"h":10,"label":kind}));
        }
    }

    #[test]
    fn hostile_restore_rejects_bad_masters_without_touching_state() {
        let mut e = PitchEngine::new();
        let m = master(&mut e, "M");
        let l = layout(&mut e, m, "L");
        let slide = e.state.slides[0].id;
        call(&mut e, "setSlideLayout", json!({"slide":slide,"layout":l}));
        let good = e.snapshot().unwrap();

        // Craft hostile payloads by mutating the serialized document.
        let mut doc = serde_json::to_value(&e.state).unwrap();
        let cases: Vec<(&str, Value)> = vec![
            ("layout missing master", {
                let mut d = doc.clone();
                d["layouts"][0]["master_id"] = json!(9999);
                d
            }),
            ("slide missing layout", {
                let mut d = doc.clone();
                d["slides"][0]["layout_id"] = json!(9999);
                d
            }),
            ("duplicate master id", {
                let mut d = doc.clone();
                let dup = d["masters"][0].clone();
                d["masters"].as_array_mut().unwrap().push(dup);
                d
            }),
            ("bad placeholder bounds", {
                let mut d = doc.clone();
                d["layouts"][0]["placeholders"] = json!([{
                    "id": 999999, "kind": "title", "x": 0.0, "y": 0.0,
                    "w": -1.0, "h": 5.0, "label": "bad"
                }]);
                d["next_id"] = json!(1000000);
                d
            }),
            ("master over cap", {
                let mut d = doc.clone();
                d["masters"] = json!(vec![d["masters"][0].clone(); 65]);
                // Distinct valid ids and a live master reference so only the
                // count bound rejects.
                for (i, m) in d["masters"].as_array_mut().unwrap().iter_mut().enumerate() {
                    m["id"] = json!(5000 + i);
                }
                d["layouts"][0]["master_id"] = json!(5000);
                d["next_id"] = json!(6000);
                d
            }),
            ("blank master name", {
                let mut d = doc.clone();
                d["masters"][0]["name"] = json!("   ");
                d
            }),
        ];
        for (why, document) in cases {
            let payload = json!({"kind":"pitch","schema":4,"document":document});
            let bytes = encode_envelope(&serde_json::to_vec(&payload).unwrap());
            assert!(e.restore(&bytes).is_err(), "{why} accepted");
            assert_eq!(e.snapshot().unwrap(), good, "{why} mutated state");
        }
        // A legacy (pre-masters) snapshot still restores with empty collections.
        let mut legacy = serde_json::to_value(&e.state).unwrap();
        legacy.as_object_mut().unwrap().remove("masters");
        legacy.as_object_mut().unwrap().remove("layouts");
        legacy["slides"][0].as_object_mut().unwrap().remove("layout_id");
        let bytes = encode_envelope(&serde_json::to_vec(&legacy).unwrap());
        e.restore(&bytes).unwrap();
        assert!(e.state.masters.is_empty() && e.state.layouts.is_empty());
        assert_eq!(e.state.slides[0].layout_id, None);
        // Snapshots now re-emit the (empty) collections; restore stayed total.
        assert!(e.snapshot().is_ok());
    }

    #[test]
    fn undo_redo_and_equal_ops_preserve_history() {
        let mut e = PitchEngine::new();
        let m = master(&mut e, "M");
        let l = layout(&mut e, m, "L");
        let before = e.snapshot().unwrap();
        // Equal renames/background clears are eventless no-ops.
        for (op, p) in [
            ("renameMaster", json!({"id":m,"name":"M"})),
            ("setMasterBackground", json!({"id":m,"color":null})),
        ] {
            let r = call(&mut e, op, p);
            assert!(r.events.is_empty(), "{op} emitted events");
        }
        assert_eq!(e.snapshot().unwrap(), before);
        call(&mut e, "renameMaster", json!({"id":m,"name":"M2"}));
        let changed = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
        let _ = l;
    }
}
