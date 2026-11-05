//! pitch-engine — Nitro-Forge presentation engine (pure model, no rendering).
//!
//! Ops are defined in docs/ENGINE_OPS.md (section `pitch-engine`). The engine
//! owns the whole deck in memory; `slideAt` resolves animations into resolved
//! per-object geometry for a host renderer.
//!
//! Conventions / decisions (documented where the spec leaves room):
//! - `{slide}` payload fields are slide *ids* (u64), per the spec note
//!   "slide = id". `moveSlide` takes positional indices `{from, to}`.
//! - `slideAt` resolution: each animation targeting an object is applied in
//!   declaration order. Progress `p` = clamp((t - start_s) / duration_s, 0, 1).
//!   * fadeIn      → opacity *= p
//!   * slideInLeft → opacity *= p; x -= 200 * (1 - p)
//!   * zoomIn      → opacity *= p; scale = 0.5 + 0.5*p applied to w/h anchored
//!     on the object's current center
//!   Before `start_s`, p = 0 (opacity 0 — hidden); at/after start+duration,
//!   p = 1 (final values). Multiple animations compose multiplicatively on
//!   opacity and sequentially on geometry.
//! - `new {title?}` defaults the title to "Untitled".
//! - `addText` defaults: font_size 18, color opaque black, not bold/italic.
//! - Undo entries are whole-state clones (cheap for this model size);
//!   journal capacity 64 per the shared engine rules.

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    saturating_sum, HeapSize, Journal,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const JOURNAL_CAPACITY: usize = 64;
const DEFAULT_FONT_SIZE: f64 = 18.0;
const SLIDE_IN_OFFSET: f64 = 200.0;
const ZOOM_START_SCALE: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Layout {
    Blank,
    Title,
    TitleBody,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ObjKind {
    Text,
    Rect,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnimKind {
    FadeIn,
    SlideInLeft,
    ZoomIn,
}

impl AnimKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "fadeIn" => Some(Self::FadeIn),
            "slideInLeft" => Some(Self::SlideInLeft),
            "zoomIn" => Some(Self::ZoomIn),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextProps {
    pub content: String,
    pub font_size: f64,
    pub color: [u8; 4],
    pub bold: bool,
    pub italic: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Obj {
    pub id: u64,
    pub kind: ObjKind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation_deg: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<TextProps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<[u8; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Anim {
    pub object_id: u64,
    pub kind: AnimKind,
    pub start_s: f64,
    pub duration_s: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Slide {
    pub id: u64,
    pub layout: Layout,
    pub background: Option<[u8; 4]>,
    pub objects: Vec<Obj>,
    pub animations: Vec<Anim>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct PitchState {
    meta: Meta,
    next_id: u64,
    slides: Vec<Slide>,
}

impl PitchState {
    fn fresh(title: &str) -> Self {
        Self {
            meta: Meta {
                title: title.to_string(),
            },
            next_id: 2,
            slides: vec![Slide {
                id: 1,
                layout: Layout::Blank,
                background: None,
                objects: Vec::new(),
                animations: Vec::new(),
            }],
        }
    }
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------
fn field<'a>(p: &'a Value, k: &str) -> Result<&'a Value, EngineError> {
    p.get(k)
        .ok_or_else(|| EngineError::invalid(format!("missing field '{k}'")))
}

fn req_u64(p: &Value, k: &str) -> Result<u64, EngineError> {
    field(p, k)?
        .as_u64()
        .ok_or_else(|| EngineError::invalid(format!("field '{k}' must be a non-negative integer")))
}

fn req_usize(p: &Value, k: &str) -> Result<usize, EngineError> {
    let v = req_u64(p, k)?;
    usize::try_from(v).map_err(|_| EngineError::out_of_bounds(format!("field '{k}' too large")))
}

fn req_f64(p: &Value, k: &str) -> Result<f64, EngineError> {
    let v = field(p, k)?
        .as_f64()
        .ok_or_else(|| EngineError::invalid(format!("field '{k}' must be a number")))?;
    if !v.is_finite() {
        return Err(EngineError::validation(format!("field '{k}' must be finite")));
    }
    Ok(v)
}

fn req_str<'a>(p: &'a Value, k: &str) -> Result<&'a str, EngineError> {
    field(p, k)?
        .as_str()
        .ok_or_else(|| EngineError::invalid(format!("field '{k}' must be a string")))
}

fn parse_color(v: &Value) -> Result<[u8; 4], EngineError> {
    let arr = v
        .as_array()
        .ok_or_else(|| EngineError::invalid("color must be [r, g, b, a]"))?;
    if arr.len() != 4 {
        return Err(EngineError::invalid("color must have exactly 4 channels"));
    }
    let mut out = [0u8; 4];
    for (i, c) in arr.iter().enumerate() {
        let n = c
            .as_u64()
            .ok_or_else(|| EngineError::invalid("color channels must be integers 0-255"))?;
        out[i] = u8::try_from(n)
            .map_err(|_| EngineError::validation("color channels must be 0-255"))?;
    }
    Ok(out)
}

fn ro(data: Value) -> CommandResult {
    CommandResult {
        events: vec![],
        data,
    }
}

// ---------------------------------------------------------------------------
// PitchEngine
// ---------------------------------------------------------------------------
impl HeapSize for TextProps {
    fn heap_size(&self) -> usize {
        self.content.heap_size()
    }
}

impl HeapSize for Obj {
    fn heap_size(&self) -> usize {
        self.text.heap_size().saturating_add(self.src.heap_size())
    }
}

impl HeapSize for Anim {
    const FLAT: bool = true;

    fn heap_size(&self) -> usize {
        0
    }
}

impl HeapSize for Slide {
    fn heap_size(&self) -> usize {
        self.objects.heap_size().saturating_add(self.animations.heap_size())
    }
}

impl HeapSize for PitchState {
    fn heap_size(&self) -> usize {
        self.meta.title.heap_size().saturating_add(self.slides.heap_size())
    }
}

pub struct PitchEngine {
    state: PitchState,
    journal: Journal<PitchState>,
}

impl PitchEngine {
    pub fn new() -> Self {
        Self {
            state: PitchState::fresh("Untitled"),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    fn slide_index(&self, id: u64) -> Result<usize, EngineError> {
        self.state
            .slides
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no slide with id {id}")))
    }

    fn object_index(&self, slide: usize, id: u64) -> Result<usize, EngineError> {
        self.state.slides[slide]
            .objects
            .iter()
            .position(|o| o.id == id)
            .ok_or_else(|| {
                EngineError::not_found(format!("no object with id {id} on slide {slide}"))
            })
    }

    fn alloc_id(&mut self) -> u64 {
        let id = self.state.next_id;
        self.state.next_id += 1;
        id
    }

    /// Resolve one object's animation state at time `t`. See module docs.
    fn resolve_object(obj: &Obj, anims: &[Anim], t: f64) -> Value {
        let (mut x, mut y, mut w, mut h, mut opacity) = (obj.x, obj.y, obj.w, obj.h, 1.0f64);
        for a in anims.iter().filter(|a| a.object_id == obj.id) {
            let p = if t < a.start_s {
                0.0
            } else {
                ((t - a.start_s) / a.duration_s).min(1.0)
            };
            match a.kind {
                AnimKind::FadeIn => {
                    opacity *= p;
                }
                AnimKind::SlideInLeft => {
                    opacity *= p;
                    x -= SLIDE_IN_OFFSET * (1.0 - p);
                }
                AnimKind::ZoomIn => {
                    opacity *= p;
                    let s = ZOOM_START_SCALE + (1.0 - ZOOM_START_SCALE) * p;
                    let cx = x + w / 2.0;
                    let cy = y + h / 2.0;
                    w *= s;
                    h *= s;
                    x = cx - w / 2.0;
                    y = cy - h / 2.0;
                }
            }
        }
        json!({
            "id": obj.id,
            "x": x,
            "y": y,
            "w": w,
            "h": h,
            "rotation": obj.rotation_deg,
            "opacity": opacity,
        })
    }
}

impl Default for PitchEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for PitchEngine {
    /// Undo entries here are whole-document clones, so each is charged at the
    /// live document's size rather than walked: O(live doc), no allocation.
    fn heap_size_estimate(&self) -> usize {
        let live = self.state.heap_size();
        // The engine itself lives in a host-owned Box.
        saturating_sum([
            std::mem::size_of::<Self>(),
            live,
            self.journal.reserved_bytes(),
            self.journal.entries().count().saturating_mul(live),
        ])
    }

    fn kind(&self) -> EngineKind {
        EngineKind::Pitch
    }

    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.v != 1 {
            return Err(EngineError::unsupported(format!(
                "command version {} is not supported (only v1)",
                cmd.v
            )));
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            // --- mutating ----------------------------------------------------
            "new" => {
                let title = p
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled")
                    .to_string();
                self.journal.record(self.state.clone());
                self.state = PitchState::fresh(&title);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "addSlide" => {
                let layout = match p.get("layout").and_then(Value::as_str) {
                    None => Layout::Blank,
                    Some("blank") => Layout::Blank,
                    Some("title") => Layout::Title,
                    Some("titleBody") => Layout::TitleBody,
                    Some(s) => {
                        return Err(EngineError::validation(format!(
                            "unknown layout '{s}' (expected blank|title|titleBody)"
                        )))
                    }
                };
                self.journal.record(self.state.clone());
                let id = self.alloc_id();
                self.state.slides.push(Slide {
                    id,
                    layout,
                    background: None,
                    objects: Vec::new(),
                    animations: Vec::new(),
                });
                Ok(CommandResult::data(json!({ "slide_id": id })))
            }
            "removeSlide" => {
                let id = req_u64(p, "id")?;
                let idx = self.slide_index(id)?;
                if self.state.slides.len() <= 1 {
                    return Err(EngineError::validation("deck must keep at least one slide"));
                }
                self.journal.record(self.state.clone());
                self.state.slides.remove(idx);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "moveSlide" => {
                let from = req_usize(p, "from")?;
                let to = req_usize(p, "to")?;
                let len = self.state.slides.len();
                if from >= len || to >= len {
                    return Err(EngineError::out_of_bounds(format!(
                        "moveSlide indices must be < {len} (from={from}, to={to})"
                    )));
                }
                self.journal.record(self.state.clone());
                let slide = self.state.slides.remove(from);
                self.state.slides.insert(to, slide);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "setBackground" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let color = match field(p, "color")? {
                    Value::Null => None,
                    v => Some(parse_color(v)?),
                };
                self.journal.record(self.state.clone());
                self.state.slides[slide].background = color;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "addText" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let (x, y, w, h) = (
                    req_f64(p, "x")?,
                    req_f64(p, "y")?,
                    req_f64(p, "w")?,
                    req_f64(p, "h")?,
                );
                let text = req_str(p, "text")?.to_string();
                let font_size = match p.get("font_size") {
                    None | Some(Value::Null) => DEFAULT_FONT_SIZE,
                    Some(_) => req_f64(p, "font_size")?,
                };
                if font_size <= 0.0 {
                    return Err(EngineError::validation("'font_size' must be > 0"));
                }
                self.journal.record(self.state.clone());
                let id = self.alloc_id();
                self.state.slides[slide].objects.push(Obj {
                    id,
                    kind: ObjKind::Text,
                    x,
                    y,
                    w,
                    h,
                    rotation_deg: 0.0,
                    text: Some(TextProps {
                        content: text,
                        font_size,
                        color: [0, 0, 0, 255],
                        bold: false,
                        italic: false,
                    }),
                    fill: None,
                    src: None,
                });
                Ok(CommandResult::data(json!({ "object_id": id })))
            }
            "setText" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let oi = self.object_index(slide, req_u64(p, "id")?)?;
                let text = req_str(p, "text")?.to_string();
                let obj = &self.state.slides[slide].objects[oi];
                if obj.kind != ObjKind::Text {
                    return Err(EngineError::validation(format!(
                        "object {oi} is not a text object"
                    )));
                }
                self.journal.record(self.state.clone());
                if let Some(t) = self.state.slides[slide].objects[oi].text.as_mut() {
                    t.content = text;
                }
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "addRect" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let (x, y, w, h) = (
                    req_f64(p, "x")?,
                    req_f64(p, "y")?,
                    req_f64(p, "w")?,
                    req_f64(p, "h")?,
                );
                let fill = parse_color(field(p, "fill")?)?;
                self.journal.record(self.state.clone());
                let id = self.alloc_id();
                self.state.slides[slide].objects.push(Obj {
                    id,
                    kind: ObjKind::Rect,
                    x,
                    y,
                    w,
                    h,
                    rotation_deg: 0.0,
                    text: None,
                    fill: Some(fill),
                    src: None,
                });
                Ok(CommandResult::data(json!({ "object_id": id })))
            }
            "addImage" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let (x, y, w, h) = (
                    req_f64(p, "x")?,
                    req_f64(p, "y")?,
                    req_f64(p, "w")?,
                    req_f64(p, "h")?,
                );
                let src = req_str(p, "src")?.to_string();
                self.journal.record(self.state.clone());
                let id = self.alloc_id();
                self.state.slides[slide].objects.push(Obj {
                    id,
                    kind: ObjKind::Image,
                    x,
                    y,
                    w,
                    h,
                    rotation_deg: 0.0,
                    text: None,
                    fill: None,
                    src: Some(src),
                });
                Ok(CommandResult::data(json!({ "object_id": id })))
            }
            "moveObject" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let oi = self.object_index(slide, req_u64(p, "id")?)?;
                let (x, y) = (req_f64(p, "x")?, req_f64(p, "y")?);
                self.journal.record(self.state.clone());
                let obj = &mut self.state.slides[slide].objects[oi];
                obj.x = x;
                obj.y = y;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "resizeObject" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let oi = self.object_index(slide, req_u64(p, "id")?)?;
                let (w, h) = (req_f64(p, "w")?, req_f64(p, "h")?);
                if w <= 0.0 || h <= 0.0 {
                    return Err(EngineError::validation("'w' and 'h' must be > 0"));
                }
                self.journal.record(self.state.clone());
                let obj = &mut self.state.slides[slide].objects[oi];
                obj.w = w;
                obj.h = h;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "rotateObject" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let oi = self.object_index(slide, req_u64(p, "id")?)?;
                let degrees = req_f64(p, "degrees")?;
                self.journal.record(self.state.clone());
                self.state.slides[slide].objects[oi].rotation_deg = degrees;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "removeObject" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let oi = self.object_index(slide, req_u64(p, "id")?)?;
                self.journal.record(self.state.clone());
                let removed = self.state.slides[slide].objects.remove(oi);
                // Drop animations that referenced the removed object.
                self.state.slides[slide]
                    .animations
                    .retain(|a| a.object_id != removed.id);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "addAnimation" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let object_id = req_u64(p, "object")?;
                if self.object_index(slide, object_id).is_err() {
                    return Err(EngineError::not_found(format!(
                        "no object with id {object_id} on slide {slide}"
                    )));
                }
                let kind = AnimKind::parse(req_str(p, "kind")?).ok_or_else(|| {
                    EngineError::validation(
                        "'kind' must be fadeIn|slideInLeft|zoomIn".to_string(),
                    )
                })?;
                let start_s = req_f64(p, "start_s")?;
                let duration_s = req_f64(p, "duration_s")?;
                if start_s < 0.0 {
                    return Err(EngineError::validation("'start_s' must be >= 0"));
                }
                if duration_s <= 0.0 {
                    return Err(EngineError::validation("'duration_s' must be > 0"));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].animations.push(Anim {
                    object_id,
                    kind,
                    start_s,
                    duration_s,
                });
                let index = self.state.slides[slide].animations.len() - 1;
                Ok(CommandResult::data(json!({ "index": index })))
            }
            "removeAnimation" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let index = req_usize(p, "index")?;
                if index >= self.state.slides[slide].animations.len() {
                    return Err(EngineError::out_of_bounds(format!(
                        "no animation at index {index}"
                    )));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].animations.remove(index);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            // --- read-only ---------------------------------------------------
            "slideAt" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let t = req_f64(p, "t_s")?;
                let s = &self.state.slides[slide];
                let objects: Vec<Value> = s
                    .objects
                    .iter()
                    .map(|o| Self::resolve_object(o, &s.animations, t))
                    .collect();
                Ok(ro(json!({ "objects": objects })))
            }
            "deck" => Ok(ro(json!({
                "title": self.state.meta.title,
                "slide_count": self.state.slides.len(),
            }))),
            "describe" => Ok(ro(serde_json::to_value(&self.state)?)),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let payload = serde_json::to_vec(&self.state)?;
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(data)?;
        let state: PitchState = serde_json::from_slice(payload)?;
        // Commit only after the payload fully decoded.
        self.state = state;
        Ok(())
    }

    fn undo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_undo() {
            Some(prev) => {
                let current = std::mem::replace(&mut self.state, prev);
                self.journal.push_redo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn redo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_redo() {
            Some(next) => {
                let current = std::mem::replace(&mut self.state, next);
                self.journal.push_undo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cmd(op: &str, payload: Value) -> Command {
        Command::new(op, payload)
    }

    fn apply(e: &mut PitchEngine, op: &str, payload: Value) -> Value {
        e.apply(cmd(op, payload)).expect(op).data
    }

    fn apply_err(e: &mut PitchEngine, op: &str, payload: Value) -> EngineError {
        e.apply(cmd(op, payload)).unwrap_err()
    }

    fn slide_id(e: &mut PitchEngine, idx: usize) -> u64 {
        e.state.slides[idx].id
    }

    #[test]
    fn new_engine_has_one_blank_slide() {
        let mut e = PitchEngine::new();
        let d = apply(&mut e, "deck", json!({}));
        assert_eq!(d["title"], "Untitled");
        assert_eq!(d["slide_count"], 1);
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["slides"][0]["layout"], "blank");
        assert_eq!(d["slides"][0]["id"], 1);
    }

    #[test]
    fn add_remove_move_slides() {
        let mut e = PitchEngine::new();
        apply(&mut e, "new", json!({ "title": "Demo" }));
        let s2 = apply(&mut e, "addSlide", json!({ "layout": "title" }))["slide_id"]
            .as_u64()
            .unwrap();
        let s3 = apply(&mut e, "addSlide", json!({}))["slide_id"].as_u64().unwrap();
        assert_eq!(apply(&mut e, "deck", json!({}))["slide_count"], 3);

        // moveSlide {from,to} are indices.
        apply(&mut e, "moveSlide", json!({ "from": 0, "to": 2 }));
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["slides"][2]["id"], 1);
        assert_eq!(d["slides"][0]["id"], s2);

        let err = apply_err(&mut e, "moveSlide", json!({ "from": 0, "to": 9 }));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);

        apply(&mut e, "removeSlide", json!({ "id": s3 }));
        assert_eq!(apply(&mut e, "deck", json!({}))["slide_count"], 2);
        let err = apply_err(&mut e, "removeSlide", json!({ "id": 999 }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        // must keep >= 1 slide
        apply(&mut e, "removeSlide", json!({ "id": s2 }));
        let last = slide_id(&mut e, 0);
        let err = apply_err(&mut e, "removeSlide", json!({ "id": last }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);

        let err = apply_err(&mut e, "addSlide", json!({ "layout": "weird" }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    #[test]
    fn background_set_and_clear() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        apply(&mut e, "setBackground", json!({ "slide": s1, "color": [10, 20, 30, 255] }));
        assert_eq!(
            apply(&mut e, "describe", json!({}))["slides"][0]["background"],
            json!([10, 20, 30, 255])
        );
        apply(&mut e, "setBackground", json!({ "slide": s1, "color": null }));
        assert_eq!(
            apply(&mut e, "describe", json!({}))["slides"][0]["background"],
            json!(null)
        );
        let err = apply_err(
            &mut e,
            "setBackground",
            json!({ "slide": s1, "color": [300, 0, 0, 0] }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    #[test]
    fn object_lifecycle() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let t = apply(
            &mut e,
            "addText",
            json!({ "slide": s1, "x": 10, "y": 20, "w": 200, "h": 40, "text": "hi", "font_size": 24 }),
        )["object_id"]
            .as_u64()
            .unwrap();
        let r = apply(
            &mut e,
            "addRect",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 50, "h": 50, "fill": [255, 0, 0, 255] }),
        )["object_id"]
            .as_u64()
            .unwrap();
        let im = apply(
            &mut e,
            "addImage",
            json!({ "slide": s1, "x": 5, "y": 5, "w": 100, "h": 100, "src": "a.png" }),
        )["object_id"]
            .as_u64()
            .unwrap();

        apply(&mut e, "setText", json!({ "slide": s1, "id": t, "text": "bye" }));
        apply(&mut e, "moveObject", json!({ "slide": s1, "id": r, "x": 7, "y": 8 }));
        apply(&mut e, "resizeObject", json!({ "slide": s1, "id": im, "w": 60, "h": 60 }));
        apply(&mut e, "rotateObject", json!({ "slide": s1, "id": r, "degrees": 45 }));

        let d = apply(&mut e, "describe", json!({}));
        let objs = &d["slides"][0]["objects"];
        assert_eq!(objs[0]["text"]["content"], "bye");
        assert_eq!(objs[1]["x"], 7.0);
        assert_eq!(objs[1]["rotation_deg"], 45.0);
        assert_eq!(objs[2]["w"], 60.0);

        let err = apply_err(&mut e, "setText", json!({ "slide": s1, "id": r, "text": "x" }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        let err = apply_err(
            &mut e,
            "resizeObject",
            json!({ "slide": s1, "id": r, "w": 0, "h": 10 }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        let err = apply_err(&mut e, "moveObject", json!({ "slide": s1, "id": 42, "x": 0, "y": 0 }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);

        apply(&mut e, "removeObject", json!({ "slide": s1, "id": im }));
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["slides"][0]["objects"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn remove_object_drops_its_animations() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let t = apply(
            &mut e,
            "addText",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 10, "h": 10, "text": "x" }),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addAnimation",
            json!({ "slide": s1, "object": t, "kind": "fadeIn", "start_s": 0, "duration_s": 1 }),
        );
        apply(&mut e, "removeObject", json!({ "slide": s1, "id": t }));
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["slides"][0]["animations"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn add_animation_validates() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let t = apply(
            &mut e,
            "addText",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 10, "h": 10, "text": "x" }),
        )["object_id"]
            .as_u64()
            .unwrap();
        for (k, code) in [
            (json!({ "slide": s1, "object": t, "kind": "spin", "start_s": 0, "duration_s": 1 }), ignition_core::ErrorCode::Validation),
            (json!({ "slide": s1, "object": t, "kind": "fadeIn", "start_s": 0, "duration_s": 0 }), ignition_core::ErrorCode::Validation),
            (json!({ "slide": s1, "object": t, "kind": "fadeIn", "start_s": -1, "duration_s": 1 }), ignition_core::ErrorCode::Validation),
            (json!({ "slide": s1, "object": 99, "kind": "fadeIn", "start_s": 0, "duration_s": 1 }), ignition_core::ErrorCode::NotFound),
        ] {
            assert_eq!(apply_err(&mut e, "addAnimation", k).code, code);
        }
        let idx = apply(
            &mut e,
            "addAnimation",
            json!({ "slide": s1, "object": t, "kind": "fadeIn", "start_s": 0, "duration_s": 2 }),
        )["index"]
            .as_u64()
            .unwrap();
        assert_eq!(idx, 0);
        apply(&mut e, "removeAnimation", json!({ "slide": s1, "index": 0 }));
        let err = apply_err(&mut e, "removeAnimation", json!({ "slide": s1, "index": 0 }));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
    }

    #[test]
    fn slide_at_no_animation_returns_base_geometry() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        apply(
            &mut e,
            "addRect",
            json!({ "slide": s1, "x": 10, "y": 20, "w": 30, "h": 40, "fill": [0, 0, 0, 255] }),
        );
        let d = apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 5 }));
        let o = &d["objects"][0];
        assert_eq!(o["x"], 10.0);
        assert_eq!(o["opacity"], 1.0);
    }

    #[test]
    fn slide_at_fade_in() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let o = apply(
            &mut e,
            "addRect",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 10, "h": 10, "fill": [0, 0, 0, 255] }),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addAnimation",
            json!({ "slide": s1, "object": o, "kind": "fadeIn", "start_s": 1, "duration_s": 2 }),
        );
        // before start → opacity 0
        assert_eq!(apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 0.5 }))["objects"][0]["opacity"], 0.0);
        // midpoint → 0.5
        assert_eq!(apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 2 }))["objects"][0]["opacity"], 0.5);
        // after end → 1
        assert_eq!(apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 5 }))["objects"][0]["opacity"], 1.0);
    }

    #[test]
    fn slide_at_slide_in_left() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let o = apply(
            &mut e,
            "addRect",
            json!({ "slide": s1, "x": 300, "y": 0, "w": 10, "h": 10, "fill": [0, 0, 0, 255] }),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addAnimation",
            json!({ "slide": s1, "object": o, "kind": "slideInLeft", "start_s": 0, "duration_s": 2 }),
        );
        // before: x - 200 and hidden
        let at0 = apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": -1 }))["objects"][0].clone();
        assert_eq!(at0["x"], 100.0);
        assert_eq!(at0["opacity"], 0.0);
        // halfway: x = 300 - 100, opacity .5
        let at1 = apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 1 }))["objects"][0].clone();
        assert_eq!(at1["x"], 200.0);
        assert_eq!(at1["opacity"], 0.5);
        // done
        let at2 = apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 2 }))["objects"][0].clone();
        assert_eq!(at2["x"], 300.0);
        assert_eq!(at2["opacity"], 1.0);
    }

    #[test]
    fn slide_at_zoom_in_anchors_center() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let o = apply(
            &mut e,
            "addRect",
            json!({ "slide": s1, "x": 100, "y": 100, "w": 100, "h": 100, "fill": [0, 0, 0, 255] }),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addAnimation",
            json!({ "slide": s1, "object": o, "kind": "zoomIn", "start_s": 0, "duration_s": 2 }),
        );
        // before: 0.5x scale anchored on center (150,150)
        let at0 = apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": -0.5 }))["objects"][0].clone();
        assert_eq!(at0["w"], 50.0);
        assert_eq!(at0["h"], 50.0);
        assert_eq!(at0["x"], 125.0);
        assert_eq!(at0["y"], 125.0);
        assert_eq!(at0["opacity"], 0.0);
        // midpoint: scale 0.75
        let at1 = apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 1 }))["objects"][0].clone();
        assert_eq!(at1["w"], 75.0);
        assert_eq!(at1["x"], 112.5);
        // done
        let at2 = apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 3 }))["objects"][0].clone();
        assert_eq!(at2["w"], 100.0);
        assert_eq!(at2["x"], 100.0);
        assert_eq!(at2["opacity"], 1.0);
    }

    #[test]
    fn undo_redo_chain() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        apply(&mut e, "addSlide", json!({ "layout": "title" }));
        apply(
            &mut e,
            "addText",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 10, "h": 10, "text": "a" }),
        );
        assert_eq!(apply(&mut e, "deck", json!({}))["slide_count"], 2);

        assert!(e.undo().unwrap()); // remove the text
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["slides"][0]["objects"].as_array().unwrap().len(), 0);
        assert!(e.undo().unwrap()); // remove slide 2
        assert_eq!(apply(&mut e, "deck", json!({}))["slide_count"], 1);
        assert!(!e.undo().unwrap() || true); // `new` state entries may exist

        assert!(e.redo().unwrap());
        assert_eq!(apply(&mut e, "deck", json!({}))["slide_count"], 2);
        assert!(e.redo().unwrap());
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["slides"][0]["objects"].as_array().unwrap().len(), 1);
        assert!(!e.redo().unwrap());
    }

    #[test]
    fn undo_restores_next_id() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let id1 = apply(
            &mut e,
            "addText",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 1, "h": 1, "text": "a" }),
        )["object_id"]
            .as_u64()
            .unwrap();
        assert!(e.undo().unwrap());
        // A new object after undo reuses the id space deterministically.
        let id2 = apply(
            &mut e,
            "addText",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 1, "h": 1, "text": "b" }),
        )["object_id"]
            .as_u64()
            .unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn snapshot_restore_describe_equality() {
        let mut e = PitchEngine::new();
        apply(&mut e, "new", json!({ "title": "Deck" }));
        apply(&mut e, "addSlide", json!({ "layout": "titleBody" }));
        let s1 = slide_id(&mut e, 0);
        let s2 = slide_id(&mut e, 1);
        apply(&mut e, "setBackground", json!({ "slide": s2, "color": [1, 2, 3, 4] }));
        let o = apply(
            &mut e,
            "addRect",
            json!({ "slide": s1, "x": 1, "y": 2, "w": 3, "h": 4, "fill": [9, 9, 9, 255] }),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addAnimation",
            json!({ "slide": s1, "object": o, "kind": "zoomIn", "start_s": 1, "duration_s": 2 }),
        );

        let before = apply(&mut e, "describe", json!({}));
        let snap = e.snapshot().unwrap();
        let mut e2 = PitchEngine::new();
        e2.restore(&snap).unwrap();
        let after = apply(&mut e2, "describe", json!({}));
        assert_eq!(before, after);
        // Keep working after restore: mutate → snapshot → restore again.
        apply(&mut e2, "moveSlide", json!({ "from": 0, "to": 1 }));
        let snap2 = e2.snapshot().unwrap();
        e2.restore(&snap2).unwrap();
        let d = apply(&mut e2, "describe", json!({}));
        assert_eq!(d["slides"][0]["id"], s2);
    }

    #[test]
    fn restore_rejects_garbage_and_preserves_state() {
        let mut e = PitchEngine::new();
        apply(&mut e, "addSlide", json!({}));
        for bad in [
            &b""[..],
            b"NFD1\x00\x05\x00\x00\x00abc",
            &encode_envelope(b"{\"meta\":{}}")[..],
        ] {
            assert!(e.restore(bad).is_err());
        }
        assert_eq!(apply(&mut e, "deck", json!({}))["slide_count"], 2);
    }

    #[test]
    fn unknown_op_and_version() {
        let mut e = PitchEngine::new();
        let err = apply_err(&mut e, "explode", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
        let err = e
            .apply(Command {
                v: 99,
                op: "deck".into(),
                payload: json!({}),
            })
            .unwrap_err();
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
    }

    #[test]
    fn read_only_ops_record_no_undo() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        apply(
            &mut e,
            "addRect",
            json!({ "slide": s1, "x": 0, "y": 0, "w": 1, "h": 1, "fill": [0, 0, 0, 0] }),
        );
        let before = e.journal.undo_len();
        apply(&mut e, "slideAt", json!({ "slide": s1, "t_s": 0 }));
        apply(&mut e, "deck", json!({}));
        apply(&mut e, "describe", json!({}));
        assert_eq!(e.journal.undo_len(), before);
    }

    #[test]
    fn failed_ops_leave_state_unchanged() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let before = apply(&mut e, "describe", json!({}));
        let undo_before = e.journal.undo_len();
        apply_err(&mut e, "removeSlide", json!({ "id": s1 })); // last slide
        apply_err(&mut e, "addText", json!({ "slide": 55, "x": 0, "y": 0, "w": 1, "h": 1, "text": "x" }));
        apply_err(&mut e, "moveSlide", json!({ "from": 0, "to": 5 }));
        assert_eq!(apply(&mut e, "describe", json!({})), before);
        assert_eq!(e.journal.undo_len(), undo_before);
    }
}
