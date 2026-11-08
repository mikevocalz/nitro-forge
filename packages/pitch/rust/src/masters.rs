//! Slide masters, layouts, placeholder definitions and apply/bind
//! (P14 slices 8a + apply/bind).
//!
//! STORAGE + BINDING: the engine stores and validates master / layout /
//! placeholder definitions, the slide→layout binding (`Slide.layout_id`)
//! and the object→placeholder content binding (`Obj.placeholder_id`,
//! P14 apply/bind slice). It does NOT materialize master or layout
//! content onto slides: masters carry no object payloads, so there is
//! nothing to copy — "apply" is DERIVED resolution at read time. The
//! `slideLayout` read resolves the chain slide → layout → master →
//! deck theme into effective chrome (bound layout/master/theme, the
//! effective background `slide.background ?? master.background`, and
//! each layout placeholder with the z-ordered ids of the slide objects
//! bound to it). Placeholder `inherit_theme` flags resolve against the
//! deck-bound theme (`deck_theme`); the engine exposes the bound theme
//! and never maps theme slots onto object styles itself — hosts own
//! slot→style application. No pixels are produced anywhere.
//!
//! Model (bounded, mirrors the pinned NYC-Tron `MasterLayoutEditor`
//! contract): masters and layouts are FLAT deck-level collections on
//! `PitchState`; a layout carries `master_id` back-reference (PowerPoint
//! style ownership) rather than nesting, so `removeMaster` cascades to its
//! layouts explicitly. Placeholders live on layouts (NYC-Tron edits
//! placeholders per layout) as typed regions `{kind,x,y,w,h,label,
//! inherit_theme}`; `kind` is the bounded NYC-Tron catalog
//! `title|body|image|media|date|footer|pageNumber`. NYC-Tron layout
//! `parentId` inheritance is NOT modeled — deferred; `describe` never
//! emits it.
//!
//! Identities: master/layout/placeholder ids share the document `next_id`
//! space (same as slides/objects/strokes/ink), so restore uniqueness is one
//! deck-wide set. `Slide.layout_id` is `Option<u64>`; `setSlideLayout`
//! binds a slide to an existing layout (`layout:null` clears). Removing a
//! layout clears every slide binding to it; removing a master cascade-
//! removes its layouts and clears the bindings to those layouts. Slides
//! themselves are unaffected by master/layout removal beyond the cleared
//! `layout_id` reference. `Obj.placeholder_id` (apply/bind) references a
//! placeholder of the slide's CURRENT bound layout — placeholder ids are
//! deck-unique so a tag can never resolve on another layout;
//! `setObjectPlaceholder` (`placeholder:null` clears) is the only writer.
//! Rebinding a slide's layout, removing a placeholder, or removing the
//! bound layout/master clears the affected object tags; slide object
//! content is otherwise untouched.

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
        match slide.layout_id {
            Some(layout_id) => {
                let Some(layout) = state.layouts.iter().find(|l| l.id == layout_id)
                else {
                    return Err(EngineError::validation(
                        "slide references a missing layout",
                    ));
                };
                // Object placeholder tags (apply/bind) must resolve on the
                // slide's bound layout; placeholder ids are deck-unique.
                for object in &slide.objects {
                    if let Some(placeholder_id) = object.placeholder_id {
                        if !layout.placeholders.iter().any(|p| p.id == placeholder_id) {
                            return Err(EngineError::validation(
                                "object references a placeholder outside the slide's layout",
                            ));
                        }
                    }
                }
            }
            None => {
                for object in &slide.objects {
                    if object.placeholder_id.is_some() {
                        return Err(EngineError::validation(
                            "object placeholder binding without a slide layout",
                        ));
                    }
                }
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
                    // The bound layout is gone, so every object placeholder
                    // tag on the slide dangles; clear them with the binding.
                    for object in &mut slide.objects {
                        object.placeholder_id = None;
                    }
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
            // the layout reference and object placeholder tags are cleared.
            for slide in &mut next.slides {
                if slide.layout_id == Some(id) {
                    slide.layout_id = None;
                    for object in &mut slide.objects {
                        object.placeholder_id = None;
                    }
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
            let previous = next.slides[si].layout_id;
            next.slides[si].layout_id = layout_id;
            if previous != layout_id {
                // Placeholder ids are deck-unique to one layout, so any
                // rebind (or clear) invalidates every object tag on the
                // slide; tags on slides whose binding is unchanged survive.
                for object in &mut next.slides[si].objects {
                    object.placeholder_id = None;
                }
            }
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
            // Objects tagged to the removed placeholder lose the tag on
            // every slide bound to this layout; object content is kept.
            for slide in &mut next.slides {
                if slide.layout_id == Some(layout_id) {
                    for object in &mut slide.objects {
                        if object.placeholder_id == Some(placeholder_id) {
                            object.placeholder_id = None;
                        }
                    }
                }
            }
        }
        "setObjectPlaceholder" => {
            let slide_id = req_u64(p, "slide")?;
            let si = slide_index(&next, slide_id)?;
            let object_id = req_u64(p, "object")?;
            let oi = next.slides[si]
                .objects
                .iter()
                .position(|o| o.id == object_id)
                .ok_or_else(|| {
                    EngineError::not_found(format!("no object with id {object_id}"))
                })?;
            // Connectors carry no geometry or content payload, so they can
            // never be a placeholder's stored content.
            if next.slides[si].objects[oi].kind == ObjKind::Connector {
                return Err(EngineError::validation(
                    "connector objects cannot bind to placeholders",
                ));
            }
            let placeholder = match p.get("placeholder") {
                None | Some(Value::Null) => None,
                Some(v) => {
                    let id = v.as_u64().ok_or_else(|| {
                        EngineError::invalid("placeholder must be a placeholder id or null")
                    })?;
                    // The tag must resolve on the slide's CURRENT bound
                    // layout: placeholder ids are deck-unique, so a valid
                    // tag can only ever reference that layout's regions.
                    let bound = next.slides[si].layout_id.ok_or_else(|| {
                        EngineError::validation("slide has no layout binding")
                    })?;
                    let li = layout_index(&next, bound)?;
                    if !next.layouts[li].placeholders.iter().any(|ph| ph.id == id) {
                        return Err(EngineError::not_found(format!(
                            "no placeholder with id {id} on the slide's layout"
                        )));
                    }
                    Some(id)
                }
            };
            next.slides[si].objects[oi].placeholder_id = placeholder;
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

/// `slideLayout` read (P14 apply/bind): the slide's DERIVED layout
/// resolution — the bound `SlideLayout`, its `SlideMaster`, the
/// deck-bound `DeckTheme`, the effective background
/// (`slide.background ?? master.background`) and every layout
/// placeholder extended with `objects`: the z-ordered ids of the slide
/// objects bound to it via `Obj.placeholder_id`. Unbound slides resolve
/// to `layout`/`master`/`placeholders` empty with `background` falling
/// back to the slide's own color; the deck theme is deck-level and is
/// reported regardless of binding. `inherit_theme` placeholders resolve
/// against the reported `theme` — the engine maps no theme slots onto
/// object styles itself. Read-only: no journal entry, no events, no
/// state change, no snapshot impact.
pub(super) fn slide_layout(
    state: &PitchState,
    slide_index: usize,
) -> Result<CommandResult, EngineError> {
    let slide = &state.slides[slide_index];
    let layout = slide
        .layout_id
        .and_then(|id| state.layouts.iter().find(|l| l.id == id));
    let master = layout.and_then(|l| state.masters.iter().find(|m| m.id == l.master_id));
    let theme = state
        .deck_theme
        .and_then(|id| state.themes.iter().find(|t| t.id == id));
    let background = slide.background.or_else(|| master.and_then(|m| m.background));
    let mut placeholders = Vec::new();
    if let Some(layout) = layout {
        for placeholder in &layout.placeholders {
            let mut value = serde_json::to_value(placeholder)
                .map_err(|e| EngineError::serialization(e.to_string()))?;
            let objects: Vec<u64> = slide
                .objects
                .iter()
                .filter(|o| o.placeholder_id == Some(placeholder.id))
                .map(|o| o.id)
                .collect();
            value["objects"] = json!(objects);
            placeholders.push(value);
        }
    }
    Ok(ro(json!({
        "slide": slide.id,
        "layout_id": slide.layout_id,
        "layout": layout,
        "master_id": layout.map(|l| l.master_id),
        "master": master,
        "theme_id": state.deck_theme,
        "theme": theme,
        "background": background,
        "placeholders": placeholders,
    })))
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

    // -- apply/bind slice ----------------------------------------------------

    fn slide(e: &PitchEngine) -> u64 {
        e.state.slides[0].id
    }

    fn text_object(e: &mut PitchEngine, slide_id: u64) -> u64 {
        id_of(
            &call(
                e,
                "addText",
                json!({"slide":slide_id,"x":10,"y":10,"w":200,"h":40,"text":"Hello"}),
            ),
            "object_id",
        )
    }

    #[test]
    fn slide_layout_read_resolves_bind_chain_and_effective_background() {
        let mut e = PitchEngine::new();
        let s = slide(&e);
        let m = master(&mut e, "Corporate");
        call(&mut e, "setMasterBackground", json!({"id":m,"color":[1,2,3,255]}));
        let l = layout(&mut e, m, "Title Slide");
        let title_ph = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l,"kind":"title","x":40,"y":20,"w":880,"h":80,"label":"Deck title","inherit_theme":true}),
            ),
            "placeholder_id",
        );
        let body_ph = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l,"kind":"body","x":40,"y":120,"w":880,"h":300,"label":"Body"}),
            ),
            "placeholder_id",
        );
        let t = id_of(
            &call(&mut e, "addTheme", json!({"name":"Brand","fonts":{"major_latin":"Inter"}})),
            "theme_id",
        );
        call(&mut e, "setDeckTheme", json!({"theme":t}));
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l}));
        let title_obj = text_object(&mut e, s);
        let body_obj = text_object(&mut e, s);
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":title_obj,"placeholder":title_ph}),
        );
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":body_obj,"placeholder":body_ph}),
        );

        let d = call(&mut e, "slideLayout", json!({"slide":s})).data;
        assert_eq!(d["slide"], s);
        assert_eq!(d["layout_id"], l);
        assert_eq!(d["layout"]["name"], "Title Slide");
        assert_eq!(d["master_id"], m);
        assert_eq!(d["master"]["name"], "Corporate");
        assert_eq!(d["theme_id"], t);
        assert_eq!(d["theme"]["name"], "Brand");
        // Effective background: slide has none, so the master's wins.
        assert_eq!(d["background"], json!([1, 2, 3, 255]));
        assert_eq!(d["placeholders"].as_array().unwrap().len(), 2);
        assert_eq!(d["placeholders"][0]["id"], title_ph);
        assert_eq!(d["placeholders"][0]["kind"], "title");
        assert_eq!(d["placeholders"][0]["inherit_theme"], true);
        assert_eq!(d["placeholders"][0]["objects"], json!([title_obj]));
        assert_eq!(d["placeholders"][1]["objects"], json!([body_obj]));

        // describe exposes the stored binding on the object verbatim.
        let described = call(&mut e, "describe", json!({})).data;
        assert_eq!(
            described["slides"][0]["objects"][0]["placeholder_id"],
            title_ph
        );

        // Bound objects force the schema:8 wrapper; restore round-trips.
        let bytes = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&bytes).unwrap();
        let wrapped: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(wrapped["schema"], 8);
        let mut re = PitchEngine::new();
        re.restore(&bytes).unwrap();
        assert_eq!(re.snapshot().unwrap(), bytes);
        assert_eq!(re.state.slides[0].objects[0].placeholder_id, Some(title_ph));

        // slideLayout is read-only: no journal entry, no events.
        let before = e.snapshot().unwrap();
        let r = call(&mut e, "slideLayout", json!({"slide":s}));
        assert!(r.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);

        // Undo peels the last bind (body object); redo restores it.
        assert!(e.undo().unwrap());
        assert_eq!(e.state.slides[0].objects[1].placeholder_id, None);
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, Some(title_ph));
        assert!(e.redo().unwrap());
        assert_eq!(e.state.slides[0].objects[1].placeholder_id, Some(body_ph));

        // A slide-level background overrides the master in the resolution.
        call(&mut e, "setBackground", json!({"slide":s,"color":[9,9,9,255]}));
        let d = call(&mut e, "slideLayout", json!({"slide":s})).data;
        assert_eq!(d["background"], json!([9, 9, 9, 255]));
    }

    #[test]
    fn unbound_slide_layout_read_is_graceful() {
        let mut e = PitchEngine::new();
        let s = slide(&e);
        let d = call(&mut e, "slideLayout", json!({"slide":s})).data;
        assert_eq!(d["layout_id"], Value::Null);
        assert_eq!(d["layout"], Value::Null);
        assert_eq!(d["master"], Value::Null);
        assert_eq!(d["theme"], Value::Null);
        assert_eq!(d["background"], Value::Null);
        assert_eq!(d["placeholders"], json!([]));
        // Deck theme is deck-level: reported even without a layout binding.
        let t = id_of(&call(&mut e, "addTheme", json!({"name":"T"})), "theme_id");
        call(&mut e, "setDeckTheme", json!({"theme":t}));
        let d = call(&mut e, "slideLayout", json!({"slide":s})).data;
        assert_eq!(d["theme_id"], t);
        assert_eq!(d["layout_id"], Value::Null);
        assert!(e.apply(Command::new("slideLayout", json!({"slide":999}))).is_err());
    }

    #[test]
    fn placeholder_binding_validates_atomically_and_cascades() {
        let mut e = PitchEngine::new();
        let s = slide(&e);
        let m = master(&mut e, "M");
        let l1 = layout(&mut e, m, "L1");
        let l2 = layout(&mut e, m, "L2");
        let ph1 = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l1,"kind":"title","x":0,"y":0,"w":10,"h":10,"label":"T"}),
            ),
            "placeholder_id",
        );
        let ph2 = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l2,"kind":"body","x":0,"y":0,"w":10,"h":10,"label":"B"}),
            ),
            "placeholder_id",
        );
        let obj = text_object(&mut e, s);
        let before = e.snapshot().unwrap();

        // Rejections leave state untouched.
        for p in [
            json!({"slide":999,"object":obj,"placeholder":null}),
            json!({"slide":s,"object":999,"placeholder":null}),
            json!({"slide":s,"object":obj,"placeholder":"x"}),
        ] {
            assert!(e.apply(Command::new("setObjectPlaceholder", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Unbound slide cannot take a placeholder tag.
        assert!(e
            .apply(Command::new(
                "setObjectPlaceholder",
                json!({"slide":s,"object":obj,"placeholder":ph1})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);

        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l1}));
        // A placeholder on a DIFFERENT layout rejects (deck-unique ids).
        assert!(e
            .apply(Command::new(
                "setObjectPlaceholder",
                json!({"slide":s,"object":obj,"placeholder":ph2})
            ))
            .is_err());
        assert_eq!(
            e.state.slides[0].objects[0].placeholder_id,
            None
        );
        // Unknown placeholder on the bound layout rejects.
        assert!(e
            .apply(Command::new(
                "setObjectPlaceholder",
                json!({"slide":s,"object":obj,"placeholder":424242})
            ))
            .is_err());

        // Bind, then equal re-tag is an eventless no-op.
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":obj,"placeholder":ph1}),
        );
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, Some(ph1));
        let bound = e.snapshot().unwrap();
        let noop = call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":obj,"placeholder":ph1}),
        );
        assert!(noop.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), bound);

        // Rebinding the slide to another layout clears the tag.
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l2}));
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, None);
        assert_eq!(e.state.slides[0].layout_id, Some(l2));
        // ...and the tag can move to the new layout's placeholder.
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":obj,"placeholder":ph2}),
        );
        // Clearing the layout binding clears tags too.
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":null}));
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, None);

        // removePlaceholder clears tags on slides bound to that layout.
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l1}));
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":obj,"placeholder":ph1}),
        );
        call(&mut e, "removePlaceholder", json!({"layout":l1,"id":ph1}));
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, None);
        assert_eq!(e.state.slides[0].layout_id, Some(l1));

        // removeLayout clears binding + tags in one undo entry. ph2
        // belongs to l2, so rebind before tagging.
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l2}));
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":obj,"placeholder":ph2}),
        );
        call(&mut e, "removeLayout", json!({"id":l2}));
        assert_eq!(e.state.slides[0].layout_id, None);
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, None);
        assert!(e.undo().unwrap());
        assert_eq!(e.state.slides[0].layout_id, Some(l2));
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, Some(ph2));

        // removeMaster cascades layouts and clears tags.
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l1}));
        call(
            &mut e,
            "addPlaceholder",
            json!({"layout":l1,"kind":"body","x":0,"y":0,"w":5,"h":5,"label":"B2"}),
        );
        let ph_b = e.state.layouts[0].placeholders[0].id;
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":obj,"placeholder":ph_b}),
        );
        call(&mut e, "removeMaster", json!({"id":m}));
        assert!(e.state.layouts.is_empty());
        assert_eq!(e.state.slides[0].layout_id, None);
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, None);
        assert!(e.undo().unwrap());
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, Some(ph_b));
    }

    #[test]
    fn connector_objects_cannot_bind_placeholders() {
        let mut e = PitchEngine::new();
        let s = slide(&e);
        let m = master(&mut e, "M");
        let l = layout(&mut e, m, "L");
        let ph = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l,"kind":"body","x":0,"y":0,"w":10,"h":10,"label":"B"}),
            ),
            "placeholder_id",
        );
        let a = text_object(&mut e, s);
        let b = text_object(&mut e, s);
        let conn = id_of(
            &call(
                &mut e,
                "addConnector",
                json!({"slide":s,"from":{"type":"free","x":0,"y":0},"to":{"type":"bound","object_id":a,"side":"center"}}),
            ),
            "object_id",
        );
        let _ = b;
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l}));
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new(
                "setObjectPlaceholder",
                json!({"slide":s,"object":conn,"placeholder":ph})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        // Clearing is rejected too: connectors can never carry the tag,
        // so there is nothing to clear (kind check precedes payload parse).
        assert!(e
            .apply(Command::new(
                "setObjectPlaceholder",
                json!({"slide":s,"object":conn,"placeholder":null})
            ))
            .is_err());
    }

    #[test]
    fn hostile_restore_rejects_dangling_placeholder_bindings() {
        let mut e = PitchEngine::new();
        let s = slide(&e);
        let m = master(&mut e, "M");
        let l = layout(&mut e, m, "L");
        let ph = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l,"kind":"title","x":0,"y":0,"w":10,"h":10,"label":"T"}),
            ),
            "placeholder_id",
        );
        let obj = text_object(&mut e, s);
        // A second layout with its own placeholder: a real placeholder id
        // that is NOT on the slide's bound layout.
        let l2 = layout(&mut e, m, "Other");
        let ph_other = id_of(
            &call(
                &mut e,
                "addPlaceholder",
                json!({"layout":l2,"kind":"body","x":0,"y":0,"w":10,"h":10,"label":"O"}),
            ),
            "placeholder_id",
        );
        call(&mut e, "setSlideLayout", json!({"slide":s,"layout":l}));
        call(
            &mut e,
            "setObjectPlaceholder",
            json!({"slide":s,"object":obj,"placeholder":ph}),
        );
        let good = e.snapshot().unwrap();

        let mut doc = serde_json::to_value(&e.state).unwrap();
        let cases: Vec<(&str, Value)> = vec![
            // Tag without a slide layout binding.
            ("tag without layout", {
                let mut d = doc.clone();
                d["slides"][0].as_object_mut().unwrap().remove("layout_id");
                d
            }),
            // Tag referencing a placeholder of a DIFFERENT layout.
            ("tag on wrong layout", {
                let mut d = doc.clone();
                d["slides"][0]["objects"][0]["placeholder_id"] = json!(ph_other);
                d
            }),
            ("unknown placeholder tag", {
                let mut d = doc.clone();
                d["slides"][0]["objects"][0]["placeholder_id"] = json!(424242);
                d
            }),
        ];
        for (why, document) in cases {
            let payload = json!({"kind":"pitch","schema":8,"document":document});
            let bytes = encode_envelope(&serde_json::to_vec(&payload).unwrap());
            assert!(e.restore(&bytes).is_err(), "{why} accepted");
            assert_eq!(e.snapshot().unwrap(), good, "{why} mutated state");
        }
        // The good snapshot still restores.
        e.restore(&good).unwrap();
        assert_eq!(e.state.slides[0].objects[0].placeholder_id, Some(ph));
    }
}
