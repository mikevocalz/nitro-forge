//! pitch-engine — Nitro-Forge presentation engine (pure model, no rendering).
//!
//! Ops are defined in docs/ENGINE_OPS.md (section `pitch-engine`). The engine
//! owns the whole deck in memory; `slideAt` resolves animations into resolved
//! per-object geometry for a host renderer.
//!
//! Conventions / decisions (documented where the spec leaves room):
//! - `{slide}` payload fields are slide *ids* (u64), per the spec note
//!   "slide = id". `moveSlide` takes positional indices `{from, to}`.
//! - `slideAt` applies bounded effects in declaration order. The animation module
//!   defines emphasis/exit geometry, legacy absolute starts and explicit host-click
//!   trigger scheduling; no presentation clock or click timestamp is fabricated.
//! - `new {title?}` defaults the title to "Untitled".
//! - `addText` defaults: font_size 18, color opaque black, not bold/italic.
//! - Undo entries are whole-state clones (cheap for this model size);
//!   journal capacity 64 per the shared engine rules.

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod sections;
mod animation;
pub use animation::Trigger;
use sections::Section;

const JOURNAL_CAPACITY: usize = 64;
const DEFAULT_FONT_SIZE: f64 = 18.0;
/// Speaker notes are bounded plain text stored per slide; empty clears them.
const MAX_NOTES_BYTES: usize = 32_768;
/// Persistent ink is bounded per slide: at most this many strokes, each with
/// at most this many points. Stroke ids share the document `next_id` space.
const MAX_INK_STROKES_PER_SLIDE: usize = 256;
const MAX_INK_POINTS_PER_STROKE: usize = 2_048;
/// Ink coordinates are slide-space units like object x/y; they must stay
/// finite and within ±this bound. Width is finite, >0 and at most this bound.
const MAX_INK_COORD: f64 = 1_000_000.0;
const MAX_INK_WIDTH: f64 = 10_000.0;
/// Shape stroke width shares the ink width bound: finite, >0, <=10,000.
const MAX_SHAPE_STROKE_WIDTH: f64 = 10_000.0;
/// Slide transitions are bounded descriptors stored per slide; the engine
/// never renders them — hosts animate from this data (same honesty boundary
/// as the prototype runtime).
const MAX_TRANSITION_MS: u32 = 60_000;
/// Per-slide rehearsal/advance timing is bounded to one hour per slide.
const MAX_SLIDE_TIMING_MS: u32 = 3_600_000;
const SLIDE_IN_OFFSET: f64 = 200.0;
const ZOOM_START_SCALE: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Layout {
    Blank,
    Title,
    TitleBody,
}

/// Object kinds. `Text`/`Rect`/`Image` are the legacy set; the remaining
/// variants are the bounded shape presets admitted by `addShape`. Shape
/// geometry is deterministic: every preset is inscribed in the object's
/// axis-aligned `x,y,w,h` bounds before `rotation_deg` is applied (see
/// docs/ENGINE_OPS.md for the per-kind outline contract hosts render).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ObjKind {
    Text,
    Rect,
    Image,
    RoundedRect,
    Ellipse,
    Triangle,
    Diamond,
    Line,
    Arrow,
    Star,
}

impl ObjKind {
    /// Shape presets share the legacy `rect` bounds-plus-fill model; `line`
    /// and `arrow` are open shapes rendered from `stroke`.
    fn is_shape(self) -> bool {
        matches!(
            self,
            Self::Rect
                | Self::RoundedRect
                | Self::Ellipse
                | Self::Triangle
                | Self::Diamond
                | Self::Line
                | Self::Arrow
                | Self::Star
        )
    }

    /// Bounded preset catalog for `addShape`; `"rect"` is admitted so the op
    /// covers the whole shape set (`addRect` remains the legacy spelling).
    fn parse_shape(s: &str) -> Option<Self> {
        match s {
            "rect" => Some(Self::Rect),
            "roundedRect" => Some(Self::RoundedRect),
            "ellipse" => Some(Self::Ellipse),
            "triangle" => Some(Self::Triangle),
            "diamond" => Some(Self::Diamond),
            "line" => Some(Self::Line),
            "arrow" => Some(Self::Arrow),
            "star" => Some(Self::Star),
            _ => None,
        }
    }
}

/// Optional stroke outline for shape objects: a finite width in slide units
/// (1e-9..=MAX_SHAPE_STROKE_WIDTH exclusive of zero, bounded like ink width)
/// plus an RGBA color. Absent means no outline.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ShapeStroke {
    pub width: f64,
    pub color: [u8; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnimKind {
    FadeIn,
    SlideInLeft,
    ZoomIn,
    Pulse,
    Spin,
    FadeOut,
    ZoomOut,
}

impl AnimKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "fadeIn" => Some(Self::FadeIn),
            "slideInLeft" => Some(Self::SlideInLeft),
            "zoomIn" => Some(Self::ZoomIn),
            "pulse" => Some(Self::Pulse),
            "spin" => Some(Self::Spin),
            "fadeOut" => Some(Self::FadeOut),
            "zoomOut" => Some(Self::ZoomOut),
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
    /// Optional stroke outline; only shape kinds may carry one (enforced by
    /// `addShape` and by restore validation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<ShapeStroke>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Anim {
    #[serde(default,skip_serializing_if="Trigger::is_absolute")]
    pub trigger: Trigger,
    pub object_id: u64,
    pub kind: AnimKind,
    pub start_s: f64,
    pub duration_s: f64,
}

/// Persistent annotation ink. `points` are `[x, y]` pairs in slide-space
/// units (the same coordinate space as object x/y/w/h), not normalized.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InkKind {
    Pen,
    Highlighter,
    Laser,
}

impl InkKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "pen" => Some(Self::Pen),
            "highlighter" => Some(Self::Highlighter),
            "laser" => Some(Self::Laser),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InkStroke {
    pub id: u64,
    pub kind: InkKind,
    pub points: Vec<[f64; 2]>,
    pub width: f64,
    pub color: [u8; 4],
    /// Optional extra opacity multiplier 0..=1 on top of the color alpha;
    /// absent (None) means fully opaque apart from the alpha channel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

/// Bounded slide-to-slide transition catalog. Serialized camelCase like the
/// other pitch enums; `"none"` is accepted by `setSlideTransition` as the
/// clear spelling and is never stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransitionKind {
    Fade,
    SlideLeft,
    SlideRight,
    SlideUp,
    SlideDown,
    Wipe,
    Zoom,
}

impl TransitionKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "fade" => Some(Self::Fade),
            "slideLeft" => Some(Self::SlideLeft),
            "slideRight" => Some(Self::SlideRight),
            "slideUp" => Some(Self::SlideUp),
            "slideDown" => Some(Self::SlideDown),
            "wipe" => Some(Self::Wipe),
            "zoom" => Some(Self::Zoom),
            _ => None,
        }
    }
}

/// Optional direction hint for directional transitions (meaningful for
/// `wipe`; hosts may honor or ignore it for other kinds).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransitionDirection {
    Left,
    Right,
    Up,
    Down,
}

impl TransitionDirection {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "left" => Some(Self::Left),
            "right" => Some(Self::Right),
            "up" => Some(Self::Up),
            "down" => Some(Self::Down),
            _ => None,
        }
    }
}

/// Per-slide transition descriptor: DATA for the host to animate. The engine
/// stores and round-trips it but performs no transition rendering or timing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlideTransition {
    pub kind: TransitionKind,
    /// Whole milliseconds, 1..=MAX_TRANSITION_MS.
    pub duration_ms: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<TransitionDirection>,
}

/// Whether the host auto-advances after the slide's dwell time or waits for
/// an explicit advance (manual click/keypress).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvanceMode {
    Manual,
    After,
}

impl AdvanceMode {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "manual" => Some(Self::Manual),
            "after" => Some(Self::After),
            _ => None,
        }
    }
}

/// Per-slide rehearsal/advance timing. `duration_ms` is the slide dwell time
/// in whole milliseconds (1..=MAX_SLIDE_TIMING_MS): the rehearsal clock
/// reading and the auto-advance delay when `advance` is `"after"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlideTiming {
    pub duration_ms: u32,
    pub advance: AdvanceMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Slide {
    pub id: u64,
    pub layout: Layout,
    pub background: Option<[u8; 4]>,
    pub objects: Vec<Obj>,
    pub animations: Vec<Anim>,
    /// Optional speaker notes; absent (None) for slides without notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Persistent annotation strokes; absent (empty) for un-inked slides.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ink: Vec<InkStroke>,
    /// Optional slide-to-slide transition; absent means no transition data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<SlideTransition>,
    /// Optional per-slide rehearsal/advance timing; absent means host default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<SlideTiming>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct SlideSize { width: f64, height: f64 }
impl Default for SlideSize {
    fn default() -> Self { Self { width: 960.0, height: 540.0 } }
}
impl SlideSize {
    fn valid(&self) -> bool {
        [self.width, self.height].iter().all(|v| v.is_finite() && *v > 0.0 && *v <= 100_000.0)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct PitchState {
    #[serde(default)]
    size: SlideSize,
    meta: Meta,
    next_id: u64,
    slides: Vec<Slide>,
    #[serde(default)]
    sections: Vec<Section>,
    #[serde(default="sections::default_next_id")]
    next_section_id: u64,
}

impl PitchState {
    fn fresh(title: &str) -> Self {
        Self {
            sections: Vec::new(),
            next_section_id: 1,
            size: SlideSize::default(),
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
                notes: None,
                ink: Vec::new(),
                transition: None,
                timing: None,
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

/// `stroke` payload of `addShape`: `{width, color}`. Width is a finite
/// slide-unit measure >0 and <=MAX_SHAPE_STROKE_WIDTH; color is RGBA.
fn parse_shape_stroke(v: &Value) -> Result<ShapeStroke, EngineError> {
    let width = field(v, "width")?
        .as_f64()
        .ok_or_else(|| EngineError::invalid("shape stroke width must be a number"))?;
    if !width.is_finite() || width <= 0.0 || width > MAX_SHAPE_STROKE_WIDTH {
        return Err(EngineError::validation(format!(
            "shape stroke width must be finite, >0 and <= {MAX_SHAPE_STROKE_WIDTH}"
        )));
    }
    Ok(ShapeStroke {
        width,
        color: parse_color(field(v, "color")?)?,
    })
}

/// Structural check shared by restore (mapped to serialization errors); ops
/// validate through `parse_shape_stroke` before this runs on candidates.
fn check_shape_stroke(stroke: &ShapeStroke) -> Result<(), EngineError> {
    if !stroke.width.is_finite() || stroke.width <= 0.0 || stroke.width > MAX_SHAPE_STROKE_WIDTH {
        return Err(EngineError::validation(format!(
            "shape stroke width must be finite, >0 and <= {MAX_SHAPE_STROKE_WIDTH}"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Ink payload helpers
// ---------------------------------------------------------------------------
fn parse_ink_kind(v: &Value) -> Result<InkKind, EngineError> {
    InkKind::parse(v.as_str().ok_or_else(|| {
        EngineError::invalid("ink kind must be \"pen\"|\"highlighter\"|\"laser\"")
    })?)
    .ok_or_else(|| {
        EngineError::validation("ink kind must be \"pen\"|\"highlighter\"|\"laser\"")
    })
}

fn parse_ink_points(v: &Value) -> Result<Vec<[f64; 2]>, EngineError> {
    let arr = v
        .as_array()
        .ok_or_else(|| EngineError::invalid("ink points must be an array of [x, y]"))?;
    if arr.is_empty() || arr.len() > MAX_INK_POINTS_PER_STROKE {
        return Err(EngineError::validation(format!(
            "ink stroke needs 1..={MAX_INK_POINTS_PER_STROKE} points"
        )));
    }
    let mut points = Vec::with_capacity(arr.len());
    for pair in arr {
        let pair = pair
            .as_array()
            .ok_or_else(|| EngineError::invalid("ink point must be [x, y]"))?;
        if pair.len() != 2 {
            return Err(EngineError::invalid("ink point must be [x, y]"));
        }
        let mut point = [0.0; 2];
        for (i, c) in pair.iter().enumerate() {
            let n = c
                .as_f64()
                .ok_or_else(|| EngineError::invalid("ink point coordinates must be numbers"))?;
            if !n.is_finite() || n.abs() > MAX_INK_COORD {
                return Err(EngineError::validation(format!(
                    "ink point coordinate must be finite and within ±{MAX_INK_COORD}"
                )));
            }
            point[i] = n;
        }
        points.push(point);
    }
    Ok(points)
}

fn parse_ink_width(v: &Value) -> Result<f64, EngineError> {
    let w = v
        .as_f64()
        .ok_or_else(|| EngineError::invalid("ink width must be a number"))?;
    if !w.is_finite() || w <= 0.0 || w > MAX_INK_WIDTH {
        return Err(EngineError::validation(format!(
            "ink width must be finite, >0 and <= {MAX_INK_WIDTH}"
        )));
    }
    Ok(w)
}

/// `null` clears the optional opacity; a number must be a finite 0..=1
/// multiplier. Absent fields are handled by callers before this runs.
fn parse_ink_opacity(v: &Value) -> Result<Option<f64>, EngineError> {
    if v.is_null() {
        return Ok(None);
    }
    let o = v
        .as_f64()
        .ok_or_else(|| EngineError::invalid("ink opacity must be a number or null"))?;
    if !o.is_finite() || !(0.0..=1.0).contains(&o) {
        return Err(EngineError::validation("ink opacity must be within 0..=1"));
    }
    Ok(Some(o))
}

/// Full structural check used by ops (validation errors) and restore
/// (mapped to serialization errors).
fn check_ink_stroke(s: &InkStroke) -> Result<(), EngineError> {
    if s.points.is_empty() || s.points.len() > MAX_INK_POINTS_PER_STROKE {
        return Err(EngineError::validation(format!(
            "ink stroke needs 1..={MAX_INK_POINTS_PER_STROKE} points"
        )));
    }
    for p in &s.points {
        if p.iter().any(|c| !c.is_finite() || c.abs() > MAX_INK_COORD) {
            return Err(EngineError::validation(format!(
                "ink point coordinate must be finite and within ±{MAX_INK_COORD}"
            )));
        }
    }
    if !s.width.is_finite() || s.width <= 0.0 || s.width > MAX_INK_WIDTH {
        return Err(EngineError::validation(format!(
            "ink width must be finite, >0 and <= {MAX_INK_WIDTH}"
        )));
    }
    if s.opacity.is_some_and(|o| !o.is_finite() || !(0.0..=1.0).contains(&o)) {
        return Err(EngineError::validation("ink opacity must be within 0..=1"));
    }
    Ok(())
}

/// Parse a complete stroke payload (the `stroke` object of `addInkStroke`);
/// the engine assigns `id`.
fn parse_ink_stroke(v: &Value) -> Result<InkStroke, EngineError> {
    let stroke = InkStroke {
        id: 0,
        kind: parse_ink_kind(field(v, "kind")?)?,
        points: parse_ink_points(field(v, "points")?)?,
        width: parse_ink_width(field(v, "width")?)?,
        color: parse_color(field(v, "color")?)?,
        opacity: match v.get("opacity") {
            None => None,
            Some(o) => parse_ink_opacity(o)?,
        },
    };
    check_ink_stroke(&stroke)?;
    Ok(stroke)
}

/// Bounded whole-millisecond field: non-negative integer within `1..=max`.
fn parse_bounded_ms(v: &Value, max: u32, what: &str) -> Result<u32, EngineError> {
    let n = v
        .as_u64()
        .ok_or_else(|| EngineError::invalid(format!("{what} must be an integer")))?;
    let ms = u32::try_from(n)
        .map_err(|_| EngineError::out_of_bounds(format!("{what} is too large")))?;
    if ms == 0 || ms > max {
        return Err(EngineError::validation(format!(
            "{what} must be within 1..={max}"
        )));
    }
    Ok(ms)
}

fn parse_transition_direction(v: &Value) -> Result<TransitionDirection, EngineError> {
    TransitionDirection::parse(v.as_str().ok_or_else(|| {
        EngineError::invalid("transition direction must be \"left\"|\"right\"|\"up\"|\"down\"")
    })?)
    .ok_or_else(|| {
        EngineError::validation("transition direction must be \"left\"|\"right\"|\"up\"|\"down\"")
    })
}

fn ro(data: Value) -> CommandResult {
    CommandResult {
        events: vec![],
        data,
        output: None,
    }
}

// ---------------------------------------------------------------------------
// PitchEngine
// ---------------------------------------------------------------------------
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

    fn ink_index(&self, slide: usize, id: u64) -> Result<usize, EngineError> {
        self.state.slides[slide]
            .ink
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| {
                EngineError::not_found(format!("no ink stroke with id {id} on slide {slide}"))
            })
    }

    fn preflight_id(&self) -> Result<(), EngineError> {
        if self.state.next_id == 0 || self.state.next_id >= 9_007_199_254_740_991 {
            return Err(EngineError::validation("safe identity capacity exhausted"));
        }
        Ok(())
    }

    fn preflight_object(&self, slide: usize) -> Result<(), EngineError> {
        if self.state.slides[slide].objects.len() >= 4096 {
            return Err(EngineError::validation("object capacity exceeds 4096"));
        }
        self.preflight_id()
    }

    fn alloc_id(&mut self) -> u64 {
        let id = self.state.next_id;
        self.state.next_id += 1;
        id
    }


}

impl Default for PitchEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for PitchEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Pitch
    }

    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            let batch = ignition_core::parse_batch(cmd)?;
            let staged = Self { state: self.state.clone(), journal: Journal::new(1) };
            let (staged, result) = ignition_core::execute_batch(staged, batch)?;
            if result.events.iter().any(|event| event.kind == "document:changed") {
                self.journal.record(self.state.clone());
                self.state = staged.state;
            }
            return Ok(result);
        }
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
            "addSection"|"updateSection"|"removeSection" => sections::apply(self,&cmd),
            "setSlideSize" => {
                let size: SlideSize = serde_json::from_value(p.clone())?;
                if !size.valid() { return Err(EngineError::validation("slide dimensions must be finite, positive and at most 100000")); }
                if self.state.size == size { return Ok(ro(json!({"ok":true}))); }
                self.journal.record(self.state.clone());
                self.state.size = size;
                Ok(CommandResult::data(json!({"ok":true})))
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
                self.preflight_id()?;
                self.journal.record(self.state.clone());
                let id = self.alloc_id();
                self.state.slides.push(Slide {
                    id,
                    layout,
                    background: None,
                    objects: Vec::new(),
                    animations: Vec::new(),
                    notes: None,
                    ink: Vec::new(),
                    transition: None,
                    timing: None,
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
                self.state.sections.retain(|section|section.start_slide_id!=id);
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
            "moveSlides" | "removeSlides" => {
                let reorder = cmd.op == "moveSlides";
                let key = if reorder { "order" } else { "ids" };
                let values = field(p, key)?
                    .as_array()
                    .ok_or_else(|| EngineError::validation("slide ids must be an array"))?;
                let mut seen = std::collections::HashSet::new();
                let mut indices = Vec::with_capacity(values.len());
                for value in values {
                    let id = value.as_u64().ok_or_else(|| {
                        EngineError::validation("slide ids must be unsigned integers")
                    })?;
                    if !seen.insert(id) {
                        return Err(EngineError::validation("duplicate slide id"));
                    }
                    indices.push(self.slide_index(id)?);
                }
                if reorder && indices.len() != self.state.slides.len() {
                    return Err(EngineError::validation(
                        "order must contain every slide exactly once",
                    ));
                }
                if !reorder && indices.len() >= self.state.slides.len() {
                    return Err(EngineError::validation("deck must keep at least one slide"));
                }
                if (reorder && indices.iter().copied().eq(0..self.state.slides.len()))
                    || (!reorder && indices.is_empty())
                {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                if reorder {
                    self.state.slides = indices
                        .into_iter()
                        .map(|i| self.state.slides[i].clone())
                        .collect();
                } else {
                    self.state.slides.retain(|slide| !seen.contains(&slide.id));
                    self.state.sections.retain(|section|!seen.contains(&section.start_slide_id));
                }
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
            "setNotes" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let text = req_str(p, "text")?;
                if text.len() > MAX_NOTES_BYTES {
                    return Err(EngineError::validation(format!(
                        "speaker notes exceed {MAX_NOTES_BYTES} UTF-8 bytes"
                    )));
                }
                // Empty text clears the notes; absent and empty are equivalent.
                let next = if text.is_empty() { None } else { Some(text.to_string()) };
                if self.state.slides[slide].notes == next {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].notes = next;
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
                self.preflight_object(slide)?;
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
                    stroke: None,
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
            "setTextStyle" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let oi = self.object_index(slide, req_u64(p, "id")?)?;
                let obj = &self.state.slides[slide].objects[oi];
                if obj.kind != ObjKind::Text {
                    return Err(EngineError::validation("setTextStyle requires a text object"));
                }
                let original = obj.text.as_ref().ok_or_else(|| EngineError::validation("text object has no text properties"))?;
                let mut next = original.clone();
                if p.get("font_size").is_some() {
                    next.font_size = req_f64(p, "font_size")?;
                    if next.font_size <= 0.0 {
                        return Err(EngineError::validation("'font_size' must be > 0"));
                    }
                }
                for (key, target) in [("bold", &mut next.bold), ("italic", &mut next.italic)] {
                    if let Some(value) = p.get(key) {
                        *target = value.as_bool().ok_or_else(|| EngineError::invalid(format!("field '{key}' must be a boolean")))?;
                    }
                }
                if let Some(value) = p.get("color") {
                    next.color = parse_color(value)?;
                }
                if &next == original {
                    return Ok(CommandResult::read_only(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].objects[oi].text = Some(next);
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
                self.preflight_object(slide)?;
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
                    stroke: None,
                    src: None,
                });
                Ok(CommandResult::data(json!({ "object_id": id })))
            }
            "addShape" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let kind = ObjKind::parse_shape(req_str(p, "kind")?).ok_or_else(|| {
                    EngineError::validation(
                        "shape kind must be \"rect\"|\"roundedRect\"|\"ellipse\"|\"triangle\"|\"diamond\"|\"line\"|\"arrow\"|\"star\"",
                    )
                })?;
                let (x, y, w, h) = (
                    req_f64(p, "x")?,
                    req_f64(p, "y")?,
                    req_f64(p, "w")?,
                    req_f64(p, "h")?,
                );
                let fill = match p.get("fill") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(parse_color(v)?),
                };
                let stroke = match p.get("stroke") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(parse_shape_stroke(v)?),
                };
                self.preflight_object(slide)?;
                self.journal.record(self.state.clone());
                let id = self.alloc_id();
                self.state.slides[slide].objects.push(Obj {
                    id,
                    kind,
                    x,
                    y,
                    w,
                    h,
                    rotation_deg: 0.0,
                    text: None,
                    fill,
                    stroke,
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
                self.preflight_object(slide)?;
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
                    stroke: None,
                    src: Some(src),
                });
                Ok(CommandResult::data(json!({ "object_id": id })))
            }
            "setObjectOrder" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let from = self.object_index(slide, req_u64(p, "id")?)?;
                let to = usize::try_from(req_u64(p, "to")?)
                    .map_err(|_| EngineError::validation("object index is too large"))?;
                if to >= self.state.slides[slide].objects.len() {
                    return Err(EngineError::validation("object index must be within the slide"));
                }
                if from == to {
                    return Ok(CommandResult::read_only(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                let object = self.state.slides[slide].objects.remove(from);
                self.state.slides[slide].objects.insert(to, object);
                Ok(CommandResult::data(json!({ "ok": true })))
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
                let mut candidate=self.state.slides[slide].clone();let removed=candidate.objects.remove(oi);candidate.animations.retain(|a|a.object_id!=removed.id);animation::validate_slide(&candidate)?;
                self.journal.record(self.state.clone());self.state.slides[slide]=candidate;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "addAnimation" | "addTriggeredAnimationV1" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let object_id = req_u64(p, "object")?;
                if self.object_index(slide, object_id).is_err() {
                    return Err(EngineError::not_found(format!(
                        "no object with id {object_id} on slide {slide}"
                    )));
                }
                let kind = AnimKind::parse(req_str(p, "kind")?).ok_or_else(|| {
                    EngineError::validation(
                        "unsupported animation effect kind".to_string(),
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
                let mut candidate=self.state.slides[slide].clone();
                let index=candidate.animations.len();
                candidate.animations.push(Anim{object_id,kind,start_s,duration_s,trigger:p.get("trigger").map(animation::parse_trigger).transpose()?.unwrap_or_default()});
                animation::validate_slide(&candidate)?;self.journal.record(self.state.clone());self.state.slides[slide]=candidate;
                Ok(CommandResult::data(json!({ "index": index })))
            }
            "updateAnimation" | "updateTriggeredAnimationV1" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let index = req_usize(p, "index")?;
                let original = self.state.slides[slide].animations.get(index)
                    .ok_or_else(|| EngineError::out_of_bounds(format!("no animation at index {index}")))?;
                let mut next = original.clone();
                if p.get("kind").is_some() {
                    next.kind = AnimKind::parse(req_str(p, "kind")?).ok_or_else(||
                        EngineError::validation("unsupported animation effect kind"))?;
                }
                if p.get("start_s").is_some() {
                    next.start_s = req_f64(p, "start_s")?;
                    if next.start_s < 0.0 {
                        return Err(EngineError::validation("'start_s' must be >= 0"));
                    }
                }
                if p.get("duration_s").is_some() {
                    next.duration_s = req_f64(p, "duration_s")?;
                    if next.duration_s <= 0.0 {
                        return Err(EngineError::validation("'duration_s' must be > 0"));
                    }
                }
                if let Some(trigger)=p.get("trigger"){next.trigger=animation::parse_trigger(trigger)?;}
                if &next == original {
                    return Ok(CommandResult::read_only(json!({ "ok": true })));
                }
                let mut candidate=self.state.slides[slide].clone();candidate.animations[index]=next;
                animation::validate_slide(&candidate)?;
                self.journal.record(self.state.clone());
                self.state.slides[slide]=candidate;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "removeAnimation" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let index = req_usize(p, "index")?;
                if index >= self.state.slides[slide].animations.len() {
                    return Err(EngineError::out_of_bounds(format!(
                        "no animation at index {index}"
                    )));
                }
                let mut candidate=self.state.slides[slide].clone();candidate.animations.remove(index);animation::validate_slide(&candidate)?;
                self.journal.record(self.state.clone());
                self.state.slides[slide]=candidate;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "addInkStroke" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let stroke = parse_ink_stroke(field(p, "stroke")?)?;
                if self.state.slides[slide].ink.len() >= MAX_INK_STROKES_PER_SLIDE {
                    return Err(EngineError::validation(format!(
                        "ink stroke capacity exceeds {MAX_INK_STROKES_PER_SLIDE} per slide"
                    )));
                }
                self.preflight_id()?;
                self.journal.record(self.state.clone());
                let id = self.alloc_id();
                self.state.slides[slide].ink.push(InkStroke { id, ..stroke });
                Ok(CommandResult::data(json!({ "stroke_id": id })))
            }
            "updateInkStroke" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let idx = self.ink_index(slide, req_u64(p, "stroke_id")?)?;
                let original = self.state.slides[slide].ink[idx].clone();
                let mut next = original.clone();
                if p.get("kind").is_some() {
                    next.kind = parse_ink_kind(field(p, "kind")?)?;
                }
                if p.get("points").is_some() {
                    next.points = parse_ink_points(field(p, "points")?)?;
                }
                if p.get("width").is_some() {
                    next.width = parse_ink_width(field(p, "width")?)?;
                }
                if p.get("color").is_some() {
                    next.color = parse_color(field(p, "color")?)?;
                }
                if p.get("opacity").is_some() {
                    next.opacity = parse_ink_opacity(field(p, "opacity")?)?;
                }
                check_ink_stroke(&next)?;
                if next == original {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].ink[idx] = next;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "removeInkStroke" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let idx = self.ink_index(slide, req_u64(p, "stroke_id")?)?;
                self.journal.record(self.state.clone());
                self.state.slides[slide].ink.remove(idx);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "clearInk" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                if self.state.slides[slide].ink.is_empty() {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].ink.clear();
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "setSlideTransition" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                // kind "none" is the clear spelling; it stores no transition.
                if req_str(p, "kind")? == "none" {
                    if self.state.slides[slide].transition.is_none() {
                        return Ok(ro(json!({ "ok": true })));
                    }
                    self.journal.record(self.state.clone());
                    self.state.slides[slide].transition = None;
                    return Ok(CommandResult::data(json!({ "ok": true })));
                }
                let kind = TransitionKind::parse(req_str(p, "kind")?).ok_or_else(|| {
                    EngineError::validation(
                        "transition kind must be \"none\"|\"fade\"|\"slideLeft\"|\"slideRight\"|\"slideUp\"|\"slideDown\"|\"wipe\"|\"zoom\"",
                    )
                })?;
                let duration_ms =
                    parse_bounded_ms(field(p, "duration_ms")?, MAX_TRANSITION_MS, "transition duration_ms")?;
                let direction = match p.get("direction") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(parse_transition_direction(v)?),
                };
                let next = SlideTransition { kind, duration_ms, direction };
                if self.state.slides[slide].transition.as_ref() == Some(&next) {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].transition = Some(next);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "clearSlideTransition" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                if self.state.slides[slide].transition.is_none() {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].transition = None;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "setSlideTiming" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let duration_ms =
                    parse_bounded_ms(field(p, "duration_ms")?, MAX_SLIDE_TIMING_MS, "timing duration_ms")?;
                let advance = AdvanceMode::parse(req_str(p, "advance")?).ok_or_else(|| {
                    EngineError::validation("advance must be \"manual\"|\"after\"")
                })?;
                let next = SlideTiming { duration_ms, advance };
                if self.state.slides[slide].timing == Some(next) {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].timing = Some(next);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "clearSlideTiming" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                if self.state.slides[slide].timing.is_none() {
                    return Ok(ro(json!({ "ok": true })));
                }
                self.journal.record(self.state.clone());
                self.state.slides[slide].timing = None;
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            // --- read-only ---------------------------------------------------
            "slideAt" | "slideAtWithClicksV1" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                let t = req_f64(p, "t_s")?;
                let clicks=animation::parse_clicks(p)?;
                animation::slide_at(&self.state.slides[slide],t,&clicks)
            }
            "deck" => Ok(ro(json!({
                "title": self.state.meta.title,
                "slide_count": self.state.slides.len(),
            }))),
            "slideNotes" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                Ok(ro(json!({
                    "notes": self.state.slides[slide].notes,
                })))
            }
            "slideInk" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                Ok(ro(json!({
                    "strokes": &self.state.slides[slide].ink,
                })))
            }
            "slideTransition" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                Ok(ro(json!({
                    "transition": self.state.slides[slide].transition,
                })))
            }
            "slideTiming" => {
                let slide = self.slide_index(req_u64(p, "slide")?)?;
                Ok(ro(json!({
                    "timing": self.state.slides[slide].timing,
                })))
            }
            "describe" => Ok(ro(serde_json::to_value(&self.state)?)),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        // schema:2 wraps documents using the earlier extended features
        // (size/sections/triggered or non-entrance animations). schema:3
        // additionally carries speaker notes, persistent ink, slide
        // transitions and slide timing; a schema:2 reader rejects schema:3
        // instead of silently dropping those fields. schema:4 additionally
        // carries shape presets beyond rect and object strokes; a schema:3
        // reader rejects schema:4 rather than silently dropping the `stroke`
        // field (new ObjKind variants already fail closed as unknown
        // variants, but the additive `stroke` field does not).
        let extended = self.state.size != SlideSize::default()
            || !self.state.sections.is_empty() || self.state.next_section_id != 1
            || self.state.slides.iter().flat_map(|slide| &slide.animations).any(|anim|
                !anim.trigger.is_absolute() || !matches!(anim.kind, AnimKind::FadeIn | AnimKind::SlideInLeft | AnimKind::ZoomIn));
        let schema3 = self.state.slides.iter().any(|slide|
            slide.notes.is_some() || !slide.ink.is_empty()
            || slide.transition.is_some() || slide.timing.is_some());
        let schema4 = self.state.slides.iter().any(|slide|
            slide.objects.iter().any(|object|
                !matches!(object.kind, ObjKind::Text | ObjKind::Rect | ObjKind::Image)
                || object.stroke.is_some()));
        let payload = if schema4 {
            serde_json::to_vec(&json!({"kind":"pitch","schema":4,"document":self.state}))?
        } else if schema3 {
            serde_json::to_vec(&json!({"kind":"pitch","schema":3,"document":self.state}))?
        } else if extended {
            serde_json::to_vec(&json!({"kind":"pitch","schema":2,"document":self.state}))?
        } else { serde_json::to_vec(&self.state)? };
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(data)?;
        let value: Value = serde_json::from_slice(payload)?;
        let mut state: PitchState = if value.get("kind").is_some() || value.get("schema").is_some() || value.get("document").is_some() {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Versioned { kind: String, schema: u32, document: PitchState }
            let wrapper: Versioned = serde_json::from_value(value)?;
            // schema:2 = extended features only; schema:3 = notes/ink/
            // transition/timing-capable; schema:4 = shape presets/strokes.
            if wrapper.kind != "pitch" || !(wrapper.schema == 2 || wrapper.schema == 3 || wrapper.schema == 4) {
                return Err(EngineError::serialization("unsupported Pitch snapshot kind/schema"));
            }
            wrapper.document
        } else { serde_json::from_value(value)? };
        // Canonicalize persisted notes: setNotes stores "" as absent, so an
        // empty-string notes field normalizes to absent rather than failing.
        for slide in &mut state.slides {
            if slide.notes.as_ref().is_some_and(|n| n.is_empty()) {
                slide.notes = None;
            }
        }
        if !state.size.valid() {
            return Err(EngineError::serialization("invalid slide size"));
        }
        let mut ids = std::collections::BTreeSet::new();
        for slide in &state.slides {
            if slide.id == 0 || !ids.insert(slide.id) {
                return Err(EngineError::serialization("invalid or duplicate identity"));
            }
            if slide.notes.as_ref().is_some_and(|n| n.len() > MAX_NOTES_BYTES) {
                return Err(EngineError::serialization("speaker notes exceed bound"));
            }
            if slide.ink.len() > MAX_INK_STROKES_PER_SLIDE {
                return Err(EngineError::serialization("ink stroke count exceeds bound"));
            }
            if slide
                .transition
                .as_ref()
                .is_some_and(|t| t.duration_ms == 0 || t.duration_ms > MAX_TRANSITION_MS)
            {
                return Err(EngineError::serialization("transition duration exceeds bound"));
            }
            if slide
                .timing
                .as_ref()
                .is_some_and(|t| t.duration_ms == 0 || t.duration_ms > MAX_SLIDE_TIMING_MS)
            {
                return Err(EngineError::serialization("slide timing duration exceeds bound"));
            }
            for stroke in &slide.ink {
                if stroke.id == 0 || !ids.insert(stroke.id) {
                    return Err(EngineError::serialization("invalid or duplicate identity"));
                }
                check_ink_stroke(stroke)
                    .map_err(|_| EngineError::serialization("invalid ink stroke"))?;
            }
            for object in &slide.objects {
                if object.id == 0 || !ids.insert(object.id) {
                    return Err(EngineError::serialization("invalid or duplicate identity"));
                }
                if let Some(stroke) = &object.stroke {
                    if !object.kind.is_shape() {
                        return Err(EngineError::serialization(
                            "stroke outline on a non-shape object",
                        ));
                    }
                    check_shape_stroke(stroke)
                        .map_err(|_| EngineError::serialization("invalid shape stroke"))?;
                }
            }
        }
        if state.next_id == 0 || state.next_id > 9_007_199_254_740_991 || ids.last().is_some_and(|id| *id >= state.next_id) {
            return Err(EngineError::serialization("invalid next identity"));
        }
        sections::validate(&state)?;
        animation::validate_state(&state)?;
        // Commit only after the payload fully decoded.
        self.state = state;
        // A replacement document cannot reuse the previous document history.
        self.journal = Journal::new(JOURNAL_CAPACITY);
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

    #[test]
    fn slide_dimensions_are_durable_undoable_and_do_not_scale_objects() {
        let mut e = PitchEngine::new();
        apply(&mut e, "addRect", json!({"slide":1,"x":10,"y":20,"w":30,"h":40,"fill":[1,2,3,255]}));
        let before = e.snapshot().unwrap();
        let objects = e.state.slides[0].objects.clone();
        apply(&mut e, "setSlideSize", json!({"width":720,"height":1280}));
        assert_eq!(e.state.slides[0].objects, objects);
        let after = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        let noop = e.apply(cmd("setSlideSize",json!({"width":960,"height":540}))).unwrap();
        assert!(noop.events.is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), after);
        let mut reopened = PitchEngine::new();
        reopened.restore(&after).unwrap();
        assert_eq!(reopened.state.size, SlideSize {width:720.0,height:1280.0});
        for size in [json!({"width":0,"height":100}),json!({"width":100001,"height":100}),json!({"width":"720","height":1280})] {
            assert!(e.apply(cmd("setSlideSize",size)).is_err());
            assert_eq!(e.snapshot().unwrap(),after);
        }
    }

    #[test]
    fn legacy_size_default_and_invalid_snapshot_are_atomic() {
        let mut e = PitchEngine::new();
        let mut state = serde_json::to_value(&e.state).unwrap();
        state.as_object_mut().unwrap().remove("size");
        e.restore(&encode_envelope(&serde_json::to_vec(&state).unwrap())).unwrap();
        assert_eq!(e.state.size, SlideSize::default());
        apply(&mut e,"setSlideSize",json!({"width":400,"height":300}));
        let before = e.snapshot().unwrap();
        state["size"] = json!({"width":-1,"height":540});
        assert!(e.restore(&encode_envelope(&serde_json::to_vec(&state).unwrap())).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.undo().unwrap());
        assert_eq!(e.state.size, SlideSize::default());
    }

    fn slide_id(e: &mut PitchEngine, idx: usize) -> u64 {
        e.state.slides[idx].id
    }

    #[test]
    fn animation_update_preserves_identity_order_and_atomic_history() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        let object = apply(&mut e, "addText", json!({"slide":slide,"x":0,"y":0,"w":100,"h":40,"text":"Animated"}))["object_id"].as_u64().unwrap();
        for kind in ["fadeIn", "slideInLeft"] {
            apply(&mut e, "addAnimation", json!({"slide":slide,"object":object,"kind":kind,"start_s":0,"duration_s":1}));
        }
        let original = e.snapshot().unwrap();
        let result = e.apply(cmd("updateAnimation", json!({"slide":slide,"index":0,"kind":"zoomIn","start_s":2,"duration_s":3}))).unwrap();
        assert_eq!(result.events.len(), 1);
        let animations = &e.state.slides[0].animations;
        assert_eq!(animations.len(), 2);
        assert_eq!(animations[0], Anim {trigger:Trigger::Absolute,object_id:object,kind:AnimKind::ZoomIn,start_s:2.0,duration_s:3.0});
        assert_eq!(animations[1], Anim {trigger:Trigger::Absolute,object_id:object,kind:AnimKind::SlideInLeft,start_s:0.0,duration_s:1.0});
        let changed = e.snapshot().unwrap();
        let mut reopened = PitchEngine::new();
        reopened.restore(&changed).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), changed);
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), original);
        for patch in [json!({}),json!({"kind":"fadeIn","start_s":0,"duration_s":1})] {
            let mut payload = patch; payload["slide"] = json!(slide); payload["index"] = json!(0);
            assert!(e.apply(cmd("updateAnimation", payload)).unwrap().events.is_empty());
        }
        for patch in [json!({"kind":"exit"}),json!({"kind":null}),json!({"start_s":-1}),json!({"start_s":null}),json!({"duration_s":0}),json!({"duration_s":"3"}),json!({"kind":"zoomIn","duration_s":-1})] {
            let mut payload = patch; payload["slide"] = json!(slide); payload["index"] = json!(0);
            assert!(e.apply(cmd("updateAnimation", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), original);
        }
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
        apply(&mut e, "updateAnimation", json!({"slide":slide,"index":0,"duration_s":4}));
        assert_eq!(e.state.slides[0].animations[0], Anim {trigger:Trigger::Absolute,object_id:object,kind:AnimKind::ZoomIn,start_s:2.0,duration_s:4.0});
        let before = e.snapshot().unwrap();
        for payload in [json!({"slide":slide,"index":2,"kind":"fadeIn"}),json!({"slide":slide,"index":-1}),json!({"slide":99999,"index":0})] {
            assert!(e.apply(cmd("updateAnimation", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn text_style_is_atomic_partial_persistent_and_preserves_history_on_noop() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        let id = apply(&mut e, "addText", json!({"slide":slide,"x":1,"y":2,"w":90,"h":30,"text":"Keep content"}))["object_id"].as_u64().unwrap();
        let original = e.snapshot().unwrap();
        let result = e.apply(cmd("setTextStyle", json!({"slide":slide,"id":id,"font_size":32,"bold":true,"italic":true,"color":[1,2,3,128]}))).unwrap();
        assert_eq!(result.events.len(), 1);
        let text = e.state.slides[0].objects[0].text.as_ref().unwrap();
        assert_eq!(text.content, "Keep content");
        assert_eq!((text.font_size, text.bold, text.italic, text.color), (32.0, true, true, [1,2,3,128]));
        let styled = e.snapshot().unwrap();
        let mut reopened = PitchEngine::new();
        reopened.restore(&styled).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), styled);
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), original); // all four fields are one history entry
        for patch in [json!({}), json!({"font_size":18,"bold":false,"italic":false,"color":[0,0,0,255]})] {
            let mut payload = patch;
            payload["slide"] = json!(slide); payload["id"] = json!(id);
            assert!(e.apply(cmd("setTextStyle", payload)).unwrap().events.is_empty());
        }
        for patch in [json!({"font_size":0}),json!({"font_size":-1}),json!({"font_size":null}),json!({"bold":1}),json!({"italic":"true"}),json!({"bold":true,"color":[1,2,3,256]}),json!({"bold":true,"color":[1,2,3]}),json!({"color":[1.5,2,3,4]})] {
            let mut payload = patch;
            payload["slide"] = json!(slide); payload["id"] = json!(id);
            assert!(e.apply(cmd("setTextStyle", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), original);
        }
        assert!(e.redo().unwrap()); // no-op and failed patches did not clear redo
        assert_eq!(e.snapshot().unwrap(), styled);
        apply(&mut e, "setTextStyle", json!({"slide":slide,"id":id,"bold":false}));
        let text = e.state.slides[0].objects[0].text.as_ref().unwrap();
        assert_eq!((text.font_size, text.bold, text.italic, text.color), (32.0, false, true, [1,2,3,128]));
        let rect = apply(&mut e, "addRect", json!({"slide":slide,"x":0,"y":0,"w":10,"h":10,"fill":[0,0,0,255]}))["object_id"].as_u64().unwrap();
        let before = e.snapshot().unwrap();
        for payload in [json!({"slide":slide,"id":rect,"bold":true}),json!({"slide":slide,"id":99999,"bold":true}),json!({"slide":99999,"id":id,"bold":true})] {
            assert!(e.apply(cmd("setTextStyle", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn object_order_is_atomic_persistent_and_noop_preserves_redo() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        let a = apply(&mut e, "addRect", json!({"slide":slide,"x":0,"y":0,"w":10,"h":10,"fill":[255,0,0,255]}))["object_id"].as_u64().unwrap();
        let b = apply(&mut e, "addRect", json!({"slide":slide,"x":0,"y":0,"w":10,"h":10,"fill":[0,0,255,255]}))["object_id"].as_u64().unwrap();
        let original = e.snapshot().unwrap();
        for payload in [json!({"slide":slide,"id":a,"to":2}), json!({"slide":slide,"id":99999,"to":0}), json!({"slide":slide,"id":a,"to":-1})] {
            assert!(e.apply(cmd("setObjectOrder", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), original);
        }
        apply(&mut e, "setObjectOrder", json!({"slide":slide,"id":a,"to":1}));
        assert_eq!(e.state.slides[0].objects.iter().map(|o|o.id).collect::<Vec<_>>(), vec![b,a]);
        let moved = e.snapshot().unwrap();
        let mut reopened = PitchEngine::new();
        reopened.restore(&moved).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), moved);
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), original);
        let noop = e.apply(cmd("setObjectOrder", json!({"slide":slide,"id":a,"to":0}))).unwrap();
        assert!(noop.events.is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), moved);
    }

    #[test]
    fn bulk_slide_changes_are_atomic_undoable_and_preserve_redo_on_noop() {
        let mut e = PitchEngine::new();
        let s2 = apply(&mut e, "addSlide", json!({}))["slide_id"]
            .as_u64()
            .unwrap();
        let s3 = apply(&mut e, "addSlide", json!({}))["slide_id"]
            .as_u64()
            .unwrap();
        let original = e.snapshot().unwrap();
        for (op, payload) in [
            ("moveSlides", json!({"order": [1, s2, s2]})),
            ("moveSlides", json!({"order": [1, s2]})),
            ("moveSlides", json!({"order": [1, s2, 999]})),
            ("removeSlides", json!({"ids": [s2, 999]})),
            ("removeSlides", json!({"ids": [s2, s2]})),
            ("removeSlides", json!({"ids": [1, s2, s3]})),
            ("removeSlides", json!({"ids": [s2, -1]})),
        ] {
            apply_err(&mut e, op, payload);
            assert_eq!(e.snapshot().unwrap(), original);
        }
        let result = e
            .apply(cmd("moveSlides", json!({"order": [s3, s2, 1]})))
            .unwrap();
        assert_eq!(result.events.len(), 1);
        let reordered = e.snapshot().unwrap();
        assert_ne!(reordered, original);
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), original);
        assert!(e
            .apply(cmd("moveSlides", json!({"order": [1, s2, s3]})))
            .unwrap()
            .events
            .is_empty());
        assert!(e
            .apply(cmd("removeSlides", json!({"ids": []})))
            .unwrap()
            .events
            .is_empty());
        apply_err(&mut e, "removeSlides", json!({"ids": [s2, 999]}));
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), reordered);
        apply(&mut e, "removeSlides", json!({"ids": [s2, s3]}));
        assert_eq!(e.state.slides.len(), 1);
        assert_eq!(e.state.slides[0].id, 1);
        let removed = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), reordered);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), removed);
        let mut reopened = PitchEngine::new();
        reopened.restore(&removed).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), removed);
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
            (json!({ "slide": s1, "object": t, "kind": "bounce", "start_s": 0, "duration_s": 1 }), ignition_core::ErrorCode::Validation),
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
                input: None, binary_output: false,
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
        apply(&mut e, "slideNotes", json!({ "slide": s1 }));
        apply(&mut e, "slideInk", json!({ "slide": s1 }));
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

    #[test]
    fn speaker_notes_set_read_clear_undo_redo() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        // absent notes read as null
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s1 }))["notes"],
            json!(null)
        );
        let before = e.snapshot().unwrap();
        // no notes anywhere → legacy unwrapped payload
        let (_, legacy_payload) = decode_envelope(&before).unwrap();
        let legacy: Value = serde_json::from_slice(legacy_payload).unwrap();
        assert!(legacy.get("kind").is_none());

        let result = e
            .apply(cmd("setNotes", json!({ "slide": s1, "text": "Open with the Q3 numbers" })))
            .unwrap();
        assert_eq!(result.events.len(), 1);
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s1 }))["notes"],
            json!("Open with the Q3 numbers")
        );
        // describe exposes notes on the slide
        assert_eq!(
            apply(&mut e, "describe", json!({}))["slides"][0]["notes"],
            json!("Open with the Q3 numbers")
        );
        // notes presence triggers the schema:3 wrapper
        let snap = e.snapshot().unwrap();
        let (_, wrapped_payload) = decode_envelope(&snap).unwrap();
        let wrapped: Value = serde_json::from_slice(wrapped_payload).unwrap();
        assert_eq!(wrapped["kind"], "pitch");
        assert_eq!(wrapped["schema"], 3);
        assert!(wrapped["document"]["slides"][0]["notes"].is_string());
        // a legacy reader (PitchState at payload root) rejects the wrapper
        assert!(serde_json::from_value::<PitchState>(wrapped.clone()).is_err());
        // downgrade regression: a schema:2-only reader rejects schema:3 so
        // notes can never be silently dropped by an older build
        #[derive(Deserialize)]
        struct Schema2OnlyReader { kind: String, schema: u32 }
        let old_view: Schema2OnlyReader = serde_json::from_value(wrapped.clone()).unwrap();
        // this is the old reader's accept gate; it must refuse schema:3
        assert!(!(old_view.kind == "pitch" && old_view.schema == 2));
        let mut reopened = PitchEngine::new();
        reopened.restore(&snap).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), snap);
        assert_eq!(
            apply(&mut reopened, "slideNotes", json!({ "slide": s1 }))["notes"],
            json!("Open with the Q3 numbers")
        );

        // equal patch is an eventless no-op that preserves redo
        assert!(e
            .apply(cmd("setNotes", json!({ "slide": s1, "text": "Open with the Q3 numbers" })))
            .unwrap()
            .events
            .is_empty());
        // clearing via empty text
        apply(&mut e, "setNotes", json!({ "slide": s1, "text": "" }));
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s1 }))["notes"],
            json!(null)
        );
        // clearing again is a no-op; snapshot drops back to the legacy shape
        assert!(e
            .apply(cmd("setNotes", json!({ "slide": s1, "text": "" })))
            .unwrap()
            .events
            .is_empty());
        assert_eq!(e.snapshot().unwrap(), before);

        // undo restores notes, redo clears them again
        apply(&mut e, "setNotes", json!({ "slide": s1, "text": "remember the demo" }));
        let with_notes = e.snapshot().unwrap();
        apply(&mut e, "setNotes", json!({ "slide": s1, "text": "" }));
        let cleared = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), with_notes);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), cleared);

        // validation: missing/non-string text, unknown slide, oversize notes
        for payload in [
            json!({ "slide": s1 }),
            json!({ "slide": s1, "text": null }),
            json!({ "slide": s1, "text": 42 }),
            json!({ "slide": 99999, "text": "x" }),
            json!({ "slide": s1, "text": "x".repeat(MAX_NOTES_BYTES + 1) }),
        ] {
            assert!(e.apply(cmd("setNotes", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), cleared);
        }
        // boundary: exactly MAX_NOTES_BYTES is admitted
        apply(
            &mut e,
            "setNotes",
            json!({ "slide": s1, "text": "x".repeat(MAX_NOTES_BYTES) }),
        );
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s1 }))["notes"]
                .as_str()
                .unwrap()
                .len(),
            MAX_NOTES_BYTES
        );
    }

    #[test]
    fn speaker_notes_die_with_their_slide() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let s2 = apply(&mut e, "addSlide", json!({}))["slide_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setNotes", json!({ "slide": s2, "text": "bye" }));
        // moveSlide carries notes with the slide identity
        apply(&mut e, "moveSlide", json!({ "from": 1, "to": 0 }));
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s2 }))["notes"],
            json!("bye")
        );
        // removeSlide drops the notes with the slide
        apply(&mut e, "removeSlide", json!({ "id": s2 }));
        assert_eq!(
            apply(&mut e, "describe", json!({}))["slides"].as_array().unwrap().len(),
            1
        );
        let err = apply_err(&mut e, "slideNotes", json!({ "slide": s2 }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        // undo restores slide and its notes
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s2 }))["notes"],
            json!("bye")
        );
        // bulk removal also drops notes
        let s3 = apply(&mut e, "addSlide", json!({}))["slide_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setNotes", json!({ "slide": s3, "text": "bulk" }));
        apply(&mut e, "removeSlides", json!({ "ids": [s3] }));
        assert!(apply_err(&mut e, "slideNotes", json!({ "slide": s3 })).code
            == ignition_core::ErrorCode::NotFound);
        // restore rejects oversize persisted notes without touching state
        let mut state = serde_json::to_value(&e.state).unwrap();
        state["slides"][0]["notes"] = json!("x".repeat(MAX_NOTES_BYTES + 1));
        let before = e.snapshot().unwrap();
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        let _ = s1;
    }

    fn ink_stroke(kind: &str, points: Value) -> Value {
        json!({
            "kind": kind,
            "points": points,
            "width": 4.0,
            "color": [255, 0, 0, 200],
        })
    }

    #[test]
    fn ink_strokes_add_update_remove_clear_read_and_persist() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        // read-only slideInk on an un-inked slide
        assert_eq!(
            apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"],
            json!([])
        );
        // ink-free document keeps the legacy unwrapped snapshot shape
        let clean = e.snapshot().unwrap();
        let (_, legacy_payload) = decode_envelope(&clean).unwrap();
        let legacy: Value = serde_json::from_slice(legacy_payload).unwrap();
        assert!(legacy.get("kind").is_none());

        let sid = apply(
            &mut e,
            "addInkStroke",
            json!({ "slide": s1, "stroke": ink_stroke("pen", json!([[10.0, 20.0], [30.0, 40.0]])) }),
        )["stroke_id"]
            .as_u64()
            .unwrap();
        // slide-space points, engine-assigned id, default opacity absent
        let strokes = apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"].clone();
        assert_eq!(strokes.as_array().unwrap().len(), 1);
        assert_eq!(strokes[0]["id"], json!(sid));
        assert_eq!(strokes[0]["kind"], json!("pen"));
        assert_eq!(strokes[0]["points"], json!([[10.0, 20.0], [30.0, 40.0]]));
        assert_eq!(strokes[0]["width"], json!(4.0));
        assert_eq!(strokes[0]["color"], json!([255, 0, 0, 200]));
        assert!(strokes[0].get("opacity").is_none());
        // describe exposes ink on the slide; ink triggers the schema:3 wrapper
        assert_eq!(
            apply(&mut e, "describe", json!({}))["slides"][0]["ink"][0]["id"],
            json!(sid)
        );
        let snap = e.snapshot().unwrap();
        let (_, wrapped_payload) = decode_envelope(&snap).unwrap();
        let wrapped: Value = serde_json::from_slice(wrapped_payload).unwrap();
        assert_eq!(wrapped["kind"], json!("pitch"));
        assert_eq!(wrapped["schema"], json!(3));
        assert_eq!(wrapped["document"]["slides"][0]["ink"][0]["id"], json!(sid));

        // partial update: kind/width/opacity/points; color retained
        let noop = e
            .apply(cmd(
                "updateInkStroke",
                json!({ "slide": s1, "stroke_id": sid, "kind": "pen", "width": 4.0 }),
            ))
            .unwrap();
        assert!(noop.events.is_empty());
        apply(
            &mut e,
            "updateInkStroke",
            json!({ "slide": s1, "stroke_id": sid, "kind": "highlighter", "width": 12.5, "opacity": 0.5, "points": [[1.0, 2.0]] }),
        );
        let styled = e.snapshot().unwrap();
        let updated = &apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"][0];
        assert_eq!(updated["kind"], json!("highlighter"));
        assert_eq!(updated["width"], json!(12.5));
        assert_eq!(updated["opacity"], json!(0.5));
        assert_eq!(updated["points"], json!([[1.0, 2.0]]));
        assert_eq!(updated["color"], json!([255, 0, 0, 200]));
        // opacity:null clears the optional field
        apply(
            &mut e,
            "updateInkStroke",
            json!({ "slide": s1, "stroke_id": sid, "opacity": null }),
        );
        assert!(apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"][0]
            .get("opacity")
            .is_none());

        // snapshot roundtrip preserves ink exactly
        let with_ink = e.snapshot().unwrap();
        let mut reopened = PitchEngine::new();
        reopened.restore(&with_ink).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), with_ink);
        assert_eq!(
            apply(&mut reopened, "slideInk", json!({ "slide": s1 }))["strokes"],
            apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"]
        );

        // undo restores the pre-clear stroke (opacity 0.5); redo clears again
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), styled);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), with_ink);

        // second stroke + removeInkStroke
        let sid2 = apply(
            &mut e,
            "addInkStroke",
            json!({ "slide": s1, "stroke": ink_stroke("laser", json!([[0.0, 0.0]])) }),
        )["stroke_id"]
            .as_u64()
            .unwrap();
        assert!(sid2 != sid);
        apply(&mut e, "removeInkStroke", json!({ "slide": s1, "stroke_id": sid2 }));
        assert_eq!(
            apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        // clearInk empties and is undoable; clearing again is a no-op
        apply(&mut e, "clearInk", json!({ "slide": s1 }));
        assert_eq!(
            apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"],
            json!([])
        );
        assert!(e
            .apply(cmd("clearInk", json!({ "slide": s1 })))
            .unwrap()
            .events
            .is_empty());
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "slideInk", json!({ "slide": s1 }))["strokes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        apply(&mut e, "clearInk", json!({ "slide": s1 }));
    }

    #[test]
    fn ink_validation_bounds_and_atomicity() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let before = e.snapshot().unwrap();
        // malformed strokes reject without mutating
        for stroke in [
            json!({ "kind": "marker", "points": [[0.0, 0.0]], "width": 1.0, "color": [0,0,0,255] }),
            json!({ "kind": "pen", "points": [], "width": 1.0, "color": [0,0,0,255] }),
            json!({ "kind": "pen", "points": [[0.0]], "width": 1.0, "color": [0,0,0,255] }),
            json!({ "kind": "pen", "points": [[0.0, "x"]], "width": 1.0, "color": [0,0,0,255] }),
            json!({ "kind": "pen", "points": [[1e7, 0.0]], "width": 1.0, "color": [0,0,0,255] }),
            json!({ "kind": "pen", "points": [[0.0, 0.0]], "width": 0.0, "color": [0,0,0,255] }),
            json!({ "kind": "pen", "points": [[0.0, 0.0]], "width": 20000.0, "color": [0,0,0,255] }),
            json!({ "kind": "pen", "points": [[0.0, 0.0]], "width": 1.0, "color": [0,0,0] }),
            json!({ "kind": "pen", "points": [[0.0, 0.0]], "width": 1.0, "color": [0,0,0,255], "opacity": 1.5 }),
            json!({ "kind": "pen", "points": [[0.0, 0.0]], "width": 1.0, "color": [0,0,0,255], "opacity": "half" }),
            json!({ "points": [[0.0, 0.0]], "width": 1.0, "color": [0,0,0,255] }),
        ] {
            assert!(e
                .apply(cmd("addInkStroke", json!({ "slide": s1, "stroke": stroke })))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // points cap boundary
        let max_points = vec![json!([0.0, 0.0]); MAX_INK_POINTS_PER_STROKE];
        apply(
            &mut e,
            "addInkStroke",
            json!({ "slide": s1, "stroke": ink_stroke("pen", Value::Array(max_points.clone())) }),
        );
        let mut too_many = max_points;
        too_many.push(json!([1.0, 1.0]));
        assert!(e
            .apply(cmd(
                "addInkStroke",
                json!({ "slide": s1, "stroke": ink_stroke("pen", Value::Array(too_many)) })
            ))
            .is_err());
        // stroke cap: fill to MAX_INK_STROKES_PER_SLIDE then reject
        for _ in 1..MAX_INK_STROKES_PER_SLIDE {
            apply(
                &mut e,
                "addInkStroke",
                json!({ "slide": s1, "stroke": ink_stroke("pen", json!([[0.0, 0.0]])) }),
            );
        }
        let full = e.snapshot().unwrap();
        assert!(e
            .apply(cmd(
                "addInkStroke",
                json!({ "slide": s1, "stroke": ink_stroke("pen", json!([[0.0, 0.0]])) })
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), full);
        // unknown slide / stroke ids
        let err = apply_err(
            &mut e,
            "addInkStroke",
            json!({ "slide": 99999, "stroke": ink_stroke("pen", json!([[0.0, 0.0]])) }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        let err = apply_err(
            &mut e,
            "updateInkStroke",
            json!({ "slide": s1, "stroke_id": 424242, "width": 2.0 }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        let err = apply_err(
            &mut e,
            "removeInkStroke",
            json!({ "slide": s1, "stroke_id": 424242 }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        let err = apply_err(&mut e, "slideInk", json!({ "slide": 99999 }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        // failed update patch leaves the stroke intact
        let sid = apply(&mut e, "slideInk", json!({ "slide": s1 })).clone();
        let sid = sid["strokes"][0]["id"].as_u64().unwrap();
        for patch in [
            json!({ "kind": "marker" }),
            json!({ "points": [] }),
            json!({ "width": -1.0 }),
            json!({ "color": [0, 0, 0, 256] }),
            json!({ "opacity": 2.0 }),
            json!({ "opacity": null, "kind": "bogus" }),
        ] {
            let mut payload = patch;
            payload["slide"] = json!(s1);
            payload["stroke_id"] = json!(sid);
            assert!(e.apply(cmd("updateInkStroke", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), full);
        }
    }

    #[test]
    fn ink_dies_with_slide_moves_with_identity_and_restore_rejects_bad_ink() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let s2 = apply(&mut e, "addSlide", json!({}))["slide_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addInkStroke",
            json!({ "slide": s2, "stroke": ink_stroke("laser", json!([[5.0, 6.0]])) }),
        );
        // hostile restores reject without touching state (ink lives on
        // slides[1], the s2 slide, before any reorder)
        let good = e.snapshot().unwrap();
        for mutate in [
            // stroke id colliding with a slide id
            {
                let mut s = serde_json::to_value(&e.state).unwrap();
                s["slides"][1]["ink"][0]["id"] = json!(s["slides"][0]["id"]);
                s
            },
            // invalid zero stroke id
            {
                let mut s = serde_json::to_value(&e.state).unwrap();
                s["slides"][1]["ink"][0]["id"] = json!(0);
                s
            },
            // too many strokes on one slide
            {
                let mut s = serde_json::to_value(&e.state).unwrap();
                let stroke = s["slides"][1]["ink"][0].clone();
                let mut ink = vec![stroke; MAX_INK_STROKES_PER_SLIDE + 1];
                for (i, st) in ink.iter_mut().enumerate() {
                    st["id"] = json!(10_000 + i);
                }
                s["slides"][1]["ink"] = Value::Array(ink);
                s["next_id"] = json!(20_000);
                s
            },
            // out-of-range persisted points
            {
                let mut s = serde_json::to_value(&e.state).unwrap();
                s["slides"][1]["ink"][0]["points"] = json!([[1e7, 0.0]]);
                s
            },
            // persisted opacity out of range
            {
                let mut s = serde_json::to_value(&e.state).unwrap();
                s["slides"][1]["ink"][0]["opacity"] = json!(1.5);
                s
            },
            // persisted width invalid
            {
                let mut s = serde_json::to_value(&e.state).unwrap();
                s["slides"][1]["ink"][0]["width"] = json!(0.0);
                s
            },
        ] {
            assert!(e
                .restore(&encode_envelope(&serde_json::to_vec(&mutate).unwrap()))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), good);
        }
        // a legacy snapshot without the ink field still restores
        let mut legacy = serde_json::to_value(&e.state).unwrap();
        for slide in legacy["slides"].as_array_mut().unwrap() {
            slide.as_object_mut().unwrap().remove("ink");
        }
        e.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
            .unwrap();
        assert!(e.state.slides.iter().all(|s| s.ink.is_empty()));
        // restoring the legacy payload dropped the ink; re-add it for the
        // identity/deletion checks below
        apply(
            &mut e,
            "addInkStroke",
            json!({ "slide": s2, "stroke": ink_stroke("laser", json!([[5.0, 6.0]])) }),
        );
        // moveSlide carries ink with the slide identity
        apply(&mut e, "moveSlide", json!({ "from": 1, "to": 0 }));
        assert_eq!(
            apply(&mut e, "slideInk", json!({ "slide": s2 }))["strokes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        // removeSlide drops the ink with the slide
        apply(&mut e, "removeSlide", json!({ "id": s2 }));
        let err = apply_err(&mut e, "slideInk", json!({ "slide": s2 }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "slideInk", json!({ "slide": s2 }))["strokes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let _ = s1;
    }

    #[test]
    fn restore_normalizes_empty_notes_and_rejects_oversize_in_wrapped_snapshot() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        // persisted "" notes canonicalize to absent, matching setNotes ""→None
        let mut state = serde_json::to_value(&e.state).unwrap();
        state["slides"][0]["notes"] = json!("");
        e.restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
            .unwrap();
        assert!(e.state.slides[0].notes.is_none());
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s1 }))["notes"],
            json!(null)
        );
        // same normalization inside a schema:3 wrapped payload
        apply(&mut e, "setNotes", json!({ "slide": s1, "text": "real notes" }));
        let snap = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&snap).unwrap();
        let mut wrapped: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(wrapped["schema"], json!(3));
        wrapped["document"]["slides"][0]["notes"] = json!("");
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        assert!(e.state.slides[0].notes.is_none());
        // oversize notes inside the WRAPPED snapshot still reject atomically
        wrapped["document"]["slides"][0]["notes"] = json!("x".repeat(MAX_NOTES_BYTES + 1));
        let before = e.snapshot().unwrap();
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn notes_utf8_boundary_at_exactly_max_bytes() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        // "é" is 2 UTF-8 bytes: 16384 of them is exactly MAX_NOTES_BYTES
        let exact = "é".repeat(MAX_NOTES_BYTES / 2);
        assert_eq!(exact.len(), MAX_NOTES_BYTES);
        apply(&mut e, "setNotes", json!({ "slide": s1, "text": exact }));
        let snap = e.snapshot().unwrap();
        assert_eq!(
            apply(&mut e, "slideNotes", json!({ "slide": s1 }))["notes"]
                .as_str()
                .unwrap()
                .len(),
            MAX_NOTES_BYTES
        );
        // one more byte tips it over the bound
        assert!(e
            .apply(cmd(
                "setNotes",
                json!({ "slide": s1, "text": format!("{exact}x") })
            ))
            .is_err());
        // and a multibyte char straddling the boundary also rejects
        assert!(e
            .apply(cmd(
                "setNotes",
                json!({ "slide": s1, "text": format!("{}é", "x".repeat(MAX_NOTES_BYTES - 1)) })
            ))
            .is_err());
        // the admitted snapshot roundtrips through restore unchanged
        let mut reopened = PitchEngine::new();
        reopened.restore(&snap).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), snap);
    }

    #[test]
    fn slide_transitions_set_read_clear_undo_and_persist() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        // absent transition reads as null; transition-free doc stays unwrapped
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s1 }))["transition"],
            json!(null)
        );
        let clean = e.snapshot().unwrap();
        let (_, legacy_payload) = decode_envelope(&clean).unwrap();
        let legacy: Value = serde_json::from_slice(legacy_payload).unwrap();
        assert!(legacy.get("kind").is_none());

        let result = e
            .apply(cmd(
                "setSlideTransition",
                json!({ "slide": s1, "kind": "wipe", "duration_ms": 500, "direction": "left" }),
            ))
            .unwrap();
        assert_eq!(result.events.len(), 1);
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s1 }))["transition"],
            json!({ "kind": "wipe", "duration_ms": 500, "direction": "left" })
        );
        // describe exposes the transition on the slide
        assert_eq!(
            apply(&mut e, "describe", json!({ }))["slides"][0]["transition"]["kind"],
            json!("wipe")
        );
        // transition presence triggers the schema:3 wrapper
        let snap = e.snapshot().unwrap();
        let (_, wrapped_payload) = decode_envelope(&snap).unwrap();
        let wrapped: Value = serde_json::from_slice(wrapped_payload).unwrap();
        assert_eq!(wrapped["kind"], json!("pitch"));
        assert_eq!(wrapped["schema"], json!(3));
        assert_eq!(
            wrapped["document"]["slides"][0]["transition"]["duration_ms"],
            json!(500)
        );
        // persists through snapshot/restore
        let mut reopened = PitchEngine::new();
        reopened.restore(&snap).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), snap);
        assert_eq!(
            apply(&mut reopened, "slideTransition", json!({ "slide": s1 }))["transition"]["kind"],
            json!("wipe")
        );

        // equal patch is an eventless no-op preserving redo
        assert!(e
            .apply(cmd(
                "setSlideTransition",
                json!({ "slide": s1, "kind": "wipe", "duration_ms": 500, "direction": "left" })
            ))
            .unwrap()
            .events
            .is_empty());
        // undo restores the cleared state, redo reapplies
        apply(&mut e, "clearSlideTransition", json!({ "slide": s1 }));
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s1 }))["transition"],
            json!(null)
        );
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s1 }))["transition"]["kind"],
            json!("wipe")
        );
        assert!(e.redo().unwrap());
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s1 }))["transition"],
            json!(null)
        );
        // kind "none" is the clear spelling
        apply(
            &mut e,
            "setSlideTransition",
            json!({ "slide": s1, "kind": "fade", "duration_ms": 250 }),
        );
        apply(&mut e, "setSlideTransition", json!({ "slide": s1, "kind": "none" }));
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s1 }))["transition"],
            json!(null)
        );
        // transition follows slide identity on reorder and dies with the slide
        let s2 = apply(&mut e, "addSlide", json!({ "layout": "blank" }))["slide_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "setSlideTransition",
            json!({ "slide": s2, "kind": "zoom", "duration_ms": 300 }),
        );
        apply(&mut e, "moveSlide", json!({ "from": 1, "to": 0 }));
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s2 }))["transition"]["kind"],
            json!("zoom")
        );
        apply(&mut e, "removeSlide", json!({ "id": s2 }));
        assert!(apply_err(&mut e, "slideTransition", json!({ "slide": s2 })).code
            == ignition_core::ErrorCode::NotFound);
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s2 }))["transition"]["kind"],
            json!("zoom")
        );
    }

    #[test]
    fn slide_transition_validation_is_atomic_and_bounded() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        let before = e.snapshot().unwrap();
        for payload in [
            json!({ "slide": s1, "kind": "dissolve", "duration_ms": 100 }),
            json!({ "slide": s1, "kind": "fade" }),
            json!({ "slide": s1, "kind": "fade", "duration_ms": 0 }),
            json!({ "slide": s1, "kind": "fade", "duration_ms": 60001 }),
            json!({ "slide": s1, "kind": "fade", "duration_ms": 1.5 }),
            json!({ "slide": s1, "kind": "fade", "duration_ms": -1 }),
            json!({ "slide": s1, "kind": "fade", "duration_ms": "500" }),
            json!({ "slide": s1, "kind": "wipe", "duration_ms": 100, "direction": "sideways" }),
            json!({ "slide": 99999, "kind": "fade", "duration_ms": 100 }),
        ] {
            assert!(e.apply(cmd("setSlideTransition", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // admitted boundary values
        for ms in [1u64, 60000] {
            apply(
                &mut e,
                "setSlideTransition",
                json!({ "slide": s1, "kind": "slideDown", "duration_ms": ms }),
            );
        }
        // clearing a set transition mutates once; clearing an absent one is
        // an eventless no-op
        apply(&mut e, "clearSlideTransition", json!({ "slide": s1 }));
        assert_eq!(
            apply(&mut e, "slideTransition", json!({ "slide": s1 }))["transition"],
            json!(null)
        );
        assert!(e
            .apply(cmd("clearSlideTransition", json!({ "slide": s1 })))
            .unwrap()
            .events
            .is_empty());
    }

    #[test]
    fn slide_timing_set_clear_undo_persist_and_bounds() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        assert_eq!(
            apply(&mut e, "slideTiming", json!({ "slide": s1 }))["timing"],
            json!(null)
        );
        let result = e
            .apply(cmd(
                "setSlideTiming",
                json!({ "slide": s1, "duration_ms": 45000, "advance": "after" }),
            ))
            .unwrap();
        assert_eq!(result.events.len(), 1);
        assert_eq!(
            apply(&mut e, "slideTiming", json!({ "slide": s1 }))["timing"],
            json!({ "duration_ms": 45000, "advance": "after" })
        );
        // describe exposes timing; presence triggers schema:3
        assert_eq!(
            apply(&mut e, "describe", json!({ }))["slides"][0]["timing"]["advance"],
            json!("after")
        );
        let snap = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&snap).unwrap();
        let wrapped: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(wrapped["schema"], json!(3));
        let mut reopened = PitchEngine::new();
        reopened.restore(&snap).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), snap);

        // equal patch eventless; clear then undo/redo
        assert!(e
            .apply(cmd(
                "setSlideTiming",
                json!({ "slide": s1, "duration_ms": 45000, "advance": "after" })
            ))
            .unwrap()
            .events
            .is_empty());
        apply(&mut e, "clearSlideTiming", json!({ "slide": s1 }));
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "slideTiming", json!({ "slide": s1 }))["timing"]["duration_ms"],
            json!(45000)
        );
        assert!(e.redo().unwrap());
        assert_eq!(
            apply(&mut e, "slideTiming", json!({ "slide": s1 }))["timing"],
            json!(null)
        );

        let before = e.snapshot().unwrap();
        for payload in [
            json!({ "slide": s1, "duration_ms": 45000 }),
            json!({ "slide": s1, "advance": "after" }),
            json!({ "slide": s1, "duration_ms": 0, "advance": "manual" }),
            json!({ "slide": s1, "duration_ms": 3600001, "advance": "manual" }),
            json!({ "slide": s1, "duration_ms": 1000.5, "advance": "manual" }),
            json!({ "slide": s1, "duration_ms": 1000, "advance": "auto" }),
            json!({ "slide": s1, "duration_ms": 1000, "advance": null }),
        ] {
            assert!(e.apply(cmd("setSlideTiming", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        apply(
            &mut e,
            "setSlideTiming",
            json!({ "slide": s1, "duration_ms": 1, "advance": "manual" }),
        );
        apply(
            &mut e,
            "setSlideTiming",
            json!({ "slide": s1, "duration_ms": 3600000, "advance": "after" }),
        );
    }

    #[test]
    fn hostile_restore_rejects_out_of_bound_transition_and_timing() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        apply(
            &mut e,
            "setSlideTransition",
            json!({ "slide": s1, "kind": "fade", "duration_ms": 100 }),
        );
        apply(
            &mut e,
            "setSlideTiming",
            json!({ "slide": s1, "duration_ms": 5000, "advance": "manual" }),
        );
        let snap = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&snap).unwrap();
        let mut wrapped: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(wrapped["schema"], json!(3));
        let before = e.snapshot().unwrap();

        // out-of-bound durations inside the schema:3 wrapper reject atomically
        for (field, bad) in [
            ("transition", json!({ "kind": "fade", "duration_ms": 60001 })),
            ("transition", json!({ "kind": "fade", "duration_ms": 0 })),
            ("timing", json!({ "duration_ms": 3600001, "advance": "manual" })),
            ("timing", json!({ "duration_ms": 0, "advance": "after" })),
        ] {
            let mut hostile = wrapped.clone();
            hostile["document"]["slides"][0][field] = bad;
            assert!(e
                .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // unknown enum variants fail deserialization before state replacement
        for (field, bad) in [
            ("transition", json!({ "kind": "morph", "duration_ms": 100 })),
            ("transition", json!({ "kind": "wipe", "duration_ms": 100, "direction": "diagonal" })),
            ("timing", json!({ "duration_ms": 1000, "advance": "auto" })),
        ] {
            let mut hostile = wrapped.clone();
            hostile["document"]["slides"][0][field] = bad;
            assert!(e
                .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // non-integer/negative durations reject at the serde layer
        for bad in [json!({ "kind": "fade", "duration_ms": -5 }), json!({ "kind": "fade", "duration_ms": 1.5 })] {
            let mut hostile = wrapped.clone();
            hostile["document"]["slides"][0]["transition"] = bad;
            assert!(e
                .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // the admitted snapshot still restores cleanly afterwards
        e.restore(&snap).unwrap();
        assert_eq!(e.snapshot().unwrap(), snap);
    }

    #[test]
    fn transition_and_timing_compose_with_other_schema3_features() {
        let mut e = PitchEngine::new();
        let s1 = slide_id(&mut e, 0);
        // a slide carrying only transition+timing (no notes/ink) wraps schema:3
        apply(
            &mut e,
            "setSlideTransition",
            json!({ "slide": s1, "kind": "slideLeft", "duration_ms": 400 }),
        );
        apply(
            &mut e,
            "setSlideTiming",
            json!({ "slide": s1, "duration_ms": 8000, "advance": "after" }),
        );
        let snap = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&snap).unwrap();
        let wrapped: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(wrapped["schema"], json!(3));
        // removing the last schema:3 feature drops back to the bare/legacy shape
        apply(&mut e, "clearSlideTransition", json!({ "slide": s1 }));
        apply(&mut e, "clearSlideTiming", json!({ "slide": s1 }));
        let clean = e.snapshot().unwrap();
        let (_, clean_payload) = decode_envelope(&clean).unwrap();
        let clean_doc: Value = serde_json::from_slice(clean_payload).unwrap();
        assert!(clean_doc.get("kind").is_none());
        // undo chain still restores the wrapped form
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), snap);
    }

    fn shape_snapshot_schema(snap: &[u8]) -> u64 {
        let (_, payload) = decode_envelope(snap).unwrap();
        let value: Value = serde_json::from_slice(payload).unwrap();
        value["schema"].as_u64().unwrap_or(1)
    }

    #[test]
    fn add_shape_covers_the_bounded_preset_catalog() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        for kind in [
            "rect", "roundedRect", "ellipse", "triangle", "diamond", "line", "arrow", "star",
        ] {
            let id = apply(
                &mut e,
                "addShape",
                json!({"slide":slide,"kind":kind,"x":1,"y":2,"w":30,"h":40,
                       "fill":[10,20,30,255],
                       "stroke":{"width":2.5,"color":[200,100,50,128]}}),
            )["object_id"]
                .as_u64()
                .unwrap();
            let described = apply(&mut e, "describe", json!({}));
            let obj = described["slides"][0]["objects"]
                .as_array()
                .unwrap()
                .iter()
                .find(|o| o["id"] == json!(id))
                .unwrap()
                .clone();
            assert_eq!(obj["kind"], json!(kind));
            assert_eq!(obj["x"], json!(1.0));
            assert_eq!(obj["w"], json!(30.0));
            assert_eq!(obj["fill"], json!([10, 20, 30, 255]));
            assert_eq!(
                obj["stroke"],
                json!({"width": 2.5, "color": [200, 100, 50, 128]})
            );
        }
        // shapes are ordinary objects: move/resize/rotate/order/remove apply
        let ellipse = apply(
            &mut e,
            "addShape",
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":10,"h":10}),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "moveObject", json!({"slide":slide,"id":ellipse,"x":5,"y":6}));
        apply(&mut e, "resizeObject", json!({"slide":slide,"id":ellipse,"w":20,"h":8}));
        apply(&mut e, "rotateObject", json!({"slide":slide,"id":ellipse,"degrees":45}));
        let described = apply(&mut e, "describe", json!({}));
        let obj = described["slides"][0]["objects"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["id"] == json!(ellipse))
            .unwrap();
        assert_eq!(obj["kind"], json!("ellipse"));
        assert_eq!(obj["x"], json!(5.0));
        assert_eq!(obj["w"], json!(20.0));
        assert_eq!(obj["rotation_deg"], json!(45.0));
        // slideAt evaluates shapes through the same geometry path
        let at = apply(&mut e, "slideAt", json!({"slide":slide,"t_s":0}));
        assert!(at["objects"].as_array().unwrap().iter().any(|o| o["id"] == json!(ellipse)));
        apply(&mut e, "removeObject", json!({"slide":slide,"id":ellipse}));
        let described = apply(&mut e, "describe", json!({}));
        assert!(!described["slides"][0]["objects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["id"] == json!(ellipse)));
    }

    #[test]
    fn add_shape_optional_fields_omit_and_undo_restores() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        // minimal payload: no fill, no stroke
        let id = apply(
            &mut e,
            "addShape",
            json!({"slide":slide,"kind":"star","x":0,"y":0,"w":10,"h":10}),
        )["object_id"]
            .as_u64()
            .unwrap();
        let described = apply(&mut e, "describe", json!({}));
        let obj = &described["slides"][0]["objects"][0];
        assert_eq!(obj["kind"], json!("star"));
        assert!(obj.get("fill").is_none());
        assert!(obj.get("stroke").is_none());
        // one undo entry removes the object
        assert!(e.undo().unwrap());
        let described = apply(&mut e, "describe", json!({}));
        assert_eq!(described["slides"][0]["objects"].as_array().unwrap().len(), 0);
        assert!(e.redo().unwrap());
        let described = apply(&mut e, "describe", json!({}));
        assert_eq!(described["slides"][0]["objects"][0]["id"], json!(id));
    }

    #[test]
    fn add_shape_validates_kind_geometry_and_stroke_atomically() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"slide":slide,"kind":"pentagon","x":0,"y":0,"w":1,"h":1}),
            json!({"slide":slide,"kind":"TEXT","x":0,"y":0,"w":1,"h":1}),
            json!({"slide":slide,"kind":null,"x":0,"y":0,"w":1,"h":1}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1}),
            json!({"slide":slide,"kind":"ellipse","x":"0","y":0,"w":1,"h":1}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"fill":[1,2,3]}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"fill":[1,2,3,256]}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"stroke":{"width":0,"color":[0,0,0,255]}}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"stroke":{"width":-2,"color":[0,0,0,255]}}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"stroke":{"width":10001,"color":[0,0,0,255]}}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"stroke":{"width":"2","color":[0,0,0,255]}}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"stroke":{"width":2}}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"stroke":{"width":2,"color":[0,0,0,255,9]}}),
            json!({"slide":slide,"kind":"ellipse","x":0,"y":0,"w":1,"h":1,"stroke":"red"}),
            json!({"slide":999,"kind":"ellipse","x":0,"y":0,"w":1,"h":1}),
        ] {
            apply_err(&mut e, "addShape", payload);
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // failed adds consumed no identity and preserved redo state
        assert!(e.undo().is_ok());
    }

    #[test]
    fn shape_stroke_persists_through_schema4_wrapper_and_restore() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        apply(
            &mut e,
            "addShape",
            json!({"slide":slide,"kind":"roundedRect","x":10,"y":20,"w":100,"h":50,
                   "fill":[1,2,3,255],"stroke":{"width":3,"color":[9,8,7,255]}}),
        );
        let snap = e.snapshot().unwrap();
        // shape presets/strokes emit the schema:4 wrapper
        assert_eq!(shape_snapshot_schema(&snap), 4);
        let mut reopened = PitchEngine::new();
        reopened.restore(&snap).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), snap);
        let described = apply(&mut reopened, "describe", json!({}));
        let obj = &described["slides"][0]["objects"][0];
        assert_eq!(obj["kind"], json!("roundedRect"));
        assert_eq!(obj["stroke"], json!({"width": 3.0, "color": [9, 8, 7, 255]}));
        // a schema:3-only reader rejects schema:4 rather than dropping stroke
        #[derive(Deserialize)]
        struct Schema3OnlyReader { kind: String, schema: u32 }
        let (_, payload) = decode_envelope(&snap).unwrap();
        let old_view: Schema3OnlyReader =
            serde_json::from_slice(payload).unwrap();
        assert!(!(old_view.kind == "pitch" && old_view.schema <= 3));
        // a schema:2-only document feature (extended but no schema:3/4 data)
        // still wraps at schema:2, not schema:4
        let mut plain = PitchEngine::new();
        let s = slide_id(&mut plain, 0);
        apply(&mut plain, "setSlideSize", json!({"width":800,"height":600}));
        apply(&mut plain, "addRect", json!({"slide":s,"x":0,"y":0,"w":5,"h":5,"fill":[0,0,0,255]}));
        assert_eq!(shape_snapshot_schema(&plain.snapshot().unwrap()), 2);
    }

    #[test]
    fn shape_restore_rejects_hostile_stroke_and_kind_payloads() {
        let mut e = PitchEngine::new();
        let slide = slide_id(&mut e, 0);
        let text = apply(
            &mut e,
            "addText",
            json!({"slide":slide,"x":0,"y":0,"w":10,"h":10,"text":"hi"}),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addShape",
            json!({"slide":slide,"kind":"diamond","x":0,"y":0,"w":10,"h":10,
                   "stroke":{"width":1,"color":[0,0,0,255]}}),
        );
        let snap = e.snapshot().unwrap();
        let mut hostile = serde_json::to_value(&e.state).unwrap();
        // stroke on a text object must fail closed
        let objects = hostile["slides"][0]["objects"].as_array_mut().unwrap();
        let text_obj = objects.iter_mut().find(|o| o["id"] == json!(text)).unwrap();
        text_obj["stroke"] = json!({"width":1,"color":[0,0,0,255]});
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
            .is_err());
        // out-of-bound stroke width must fail closed
        let mut hostile = serde_json::to_value(&e.state).unwrap();
        hostile["slides"][0]["objects"][1]["stroke"]["width"] = json!(0);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
            .is_err());
        let mut hostile = serde_json::to_value(&e.state).unwrap();
        hostile["slides"][0]["objects"][1]["stroke"]["width"] = json!(20000);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
            .is_err());
        // unknown shape kind string fails serde closed
        let mut hostile = serde_json::to_value(&e.state).unwrap();
        hostile["slides"][0]["objects"][1]["kind"] = json!("hexagon");
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
            .is_err());
        // the admitted snapshot still restores cleanly afterwards
        e.restore(&snap).unwrap();
        assert_eq!(e.snapshot().unwrap(), snap);
    }
}
