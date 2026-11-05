//! Document model: layers, shapes, vector paths, masks, artboards and the
//! wire format shared by `describe`, `getLayer`, `flatten` snapshots, and
//! `snapshot`/`restore`.
//!
//! Internal raster pixels, masks and the pixel selection live behind
//! `Arc<Vec<u8>>` so that structural undo entries (prior `Vec<Layer>`) are
//! cheap pointer copies, not deep clones. Fields added after the first wire
//! version carry `#[serde(default)]`, so older snapshots still restore.

use std::sync::Arc;

use ignition_core::EngineError;
use serde::{Deserialize, Serialize};

use crate::b64;

/// Upper bound on any coordinate or length the engine accepts, so geometry
/// math can never overflow into infinities.
pub const MAX_COORD: f64 = 1.0e7;

fn finite(v: f64) -> bool {
    v.is_finite() && v.abs() <= MAX_COORD
}

/// Shape primitives. Serialized as `"rect"` / `"ellipse"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rect,
    Ellipse,
}

/// A vector shape: bounds in content coordinates plus an RGBA fill.
/// `w` and `h` must be > 0; all coordinates must be finite.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    pub kind: ShapeKind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub fill: [u8; 4],
}

impl Shape {
    /// Semantic validation beyond what serde can express.
    pub fn validate(&self) -> Result<(), EngineError> {
        if !finite(self.x) || !finite(self.y) {
            return Err(EngineError::validation("shape x/y must be finite"));
        }
        if !finite(self.w) || !finite(self.h) || self.w <= 0.0 || self.h <= 0.0 {
            return Err(EngineError::validation("shape w/h must be positive and finite"));
        }
        Ok(())
    }
}

/// Separable and non-separable-free blend modes (W3C Compositing Level 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Add,
}

impl BlendMode {
    pub fn parse(s: &str) -> Option<BlendMode> {
        serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
    }
}

/// Layer transform. A content point `p` lands on the canvas at
/// `t + o + R(rotation)·S(sx,sy)·(p - o)`, where `o = (ox, oy)` is the pivot
/// in content coordinates. Identity by default.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Transform {
    pub tx: f64,
    pub ty: f64,
    pub sx: f64,
    pub sy: f64,
    /// Degrees, clockwise in canvas space (y down).
    pub rotation: f64,
    pub ox: f64,
    pub oy: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Transform { tx: 0.0, ty: 0.0, sx: 1.0, sy: 1.0, rotation: 0.0, ox: 0.0, oy: 0.0 }
    }
}

impl Transform {
    pub fn is_identity(&self) -> bool {
        *self == Transform::default()
    }

    pub fn validate(&self) -> Result<(), EngineError> {
        for v in [self.tx, self.ty, self.ox, self.oy, self.rotation] {
            if !finite(v) {
                return Err(EngineError::validation("transform values must be finite"));
            }
        }
        for s in [self.sx, self.sy] {
            if !s.is_finite() || s.abs() < 1e-6 || s.abs() > 1e4 {
                return Err(EngineError::validation(
                    "transform scale must be non-zero and within ±10000",
                ));
            }
        }
        Ok(())
    }
}

/// A canvas-space alpha mask (`w*h` bytes). 255 reveals, 0 hides.
#[derive(Debug, Clone, PartialEq)]
pub struct Mask {
    pub alpha: Arc<Vec<u8>>,
    pub enabled: bool,
    pub inverted: bool,
}

impl Mask {
    /// Effective mask value at byte offset `i` (0..=255), honoring
    /// `enabled` and `inverted`.
    pub fn value(&self, i: usize) -> u8 {
        if !self.enabled {
            return 255;
        }
        let v = self.alpha.get(i).copied().unwrap_or(0);
        if self.inverted {
            255 - v
        } else {
            v
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoolOp {
    Union,
    Subtract,
    Intersect,
    Exclude,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    #[default]
    Corner,
    Smooth,
    Symmetric,
}

/// A path node. Handles are offsets from the node: `in` leads into the node
/// from the previous segment, `out` leaves toward the next one. A segment
/// with neither handle is a straight line; otherwise it is a cubic Bézier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub x: f64,
    pub y: f64,
    #[serde(rename = "in", default, skip_serializing_if = "Option::is_none")]
    pub in_handle: Option<[f64; 2]>,
    #[serde(rename = "out", default, skip_serializing_if = "Option::is_none")]
    pub out_handle: Option<[f64; 2]>,
    #[serde(default)]
    pub kind: NodeKind,
}

impl Node {
    pub fn validate(&self) -> Result<(), EngineError> {
        let mut vals = vec![self.x, self.y];
        if let Some(h) = self.in_handle {
            vals.extend(h);
        }
        if let Some(h) = self.out_handle {
            vals.extend(h);
        }
        if vals.iter().all(|v| finite(*v)) {
            Ok(())
        } else {
            Err(EngineError::validation("path node coordinates must be finite"))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Subpath {
    #[serde(default)]
    pub closed: bool,
    pub nodes: Vec<Node>,
}

/// Node budget per path, so a hostile payload cannot stall rasterization.
pub const MAX_PATH_NODES: usize = 100_000;

pub fn validate_subpaths(subpaths: &[Subpath]) -> Result<(), EngineError> {
    if subpaths.is_empty() {
        return Err(EngineError::validation("a path needs at least one subpath"));
    }
    let mut total = 0usize;
    for (i, sp) in subpaths.iter().enumerate() {
        if sp.nodes.is_empty() {
            return Err(EngineError::validation(format!("subpath {i} has no nodes")));
        }
        total += sp.nodes.len();
        for n in &sp.nodes {
            n.validate()?;
        }
    }
    if total > MAX_PATH_NODES {
        return Err(EngineError::validation("path has too many nodes"));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stop {
    pub offset: f64,
    pub color: [u8; 4],
}

/// Fill or stroke paint. Gradient coordinates are in content space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Paint {
    Solid {
        color: [u8; 4],
    },
    Linear {
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
        stops: Vec<Stop>,
    },
    Radial {
        cx: f64,
        cy: f64,
        r: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fx: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fy: Option<f64>,
        stops: Vec<Stop>,
    },
}

fn validate_stops(stops: &[Stop]) -> Result<(), EngineError> {
    if stops.len() < 2 {
        return Err(EngineError::validation("a gradient needs at least two stops"));
    }
    if stops.len() > 256 {
        return Err(EngineError::validation("a gradient has at most 256 stops"));
    }
    let mut last = 0.0;
    for s in stops {
        if !s.offset.is_finite() || !(0.0..=1.0).contains(&s.offset) {
            return Err(EngineError::validation("stop offsets must be in 0..=1"));
        }
        if s.offset < last {
            return Err(EngineError::validation("stop offsets must not decrease"));
        }
        last = s.offset;
    }
    Ok(())
}

impl Paint {
    pub fn validate(&self) -> Result<(), EngineError> {
        match self {
            Paint::Solid { .. } => Ok(()),
            Paint::Linear { x0, y0, x1, y1, stops } => {
                if ![*x0, *y0, *x1, *y1].iter().all(|v| finite(*v)) {
                    return Err(EngineError::validation("gradient points must be finite"));
                }
                validate_stops(stops)
            }
            Paint::Radial { cx, cy, r, fx, fy, stops } => {
                if ![*cx, *cy, *r].iter().all(|v| finite(*v)) || *r <= 0.0 {
                    return Err(EngineError::validation(
                        "radial gradient needs a finite center and a positive radius",
                    ));
                }
                if fx.is_some() != fy.is_some() {
                    return Err(EngineError::validation("focal point needs both fx and fy"));
                }
                if let (Some(fx), Some(fy)) = (fx, fy) {
                    if !finite(*fx) || !finite(*fy) {
                        return Err(EngineError::validation("focal point must be finite"));
                    }
                    if ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt() >= *r {
                        return Err(EngineError::validation(
                            "focal point must lie strictly inside the gradient circle",
                        ));
                    }
                }
                validate_stops(stops)
            }
        }
    }

    pub fn solid(color: [u8; 4]) -> Paint {
        Paint::Solid { color }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LineJoin {
    #[default]
    Miter,
    Round,
    Bevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LineCap {
    #[default]
    Butt,
    Round,
    Square,
}

fn default_miter() -> f64 {
    4.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub paint: Paint,
    pub width: f64,
    #[serde(default)]
    pub join: LineJoin,
    #[serde(default)]
    pub cap: LineCap,
    #[serde(default = "default_miter")]
    pub miter_limit: f64,
    #[serde(default)]
    pub dash: Vec<f64>,
    #[serde(default)]
    pub dash_offset: f64,
}

impl Stroke {
    pub fn validate(&self) -> Result<(), EngineError> {
        self.paint.validate()?;
        if !finite(self.width) || self.width <= 0.0 {
            return Err(EngineError::validation("stroke width must be positive"));
        }
        if !self.miter_limit.is_finite() || self.miter_limit < 1.0 || self.miter_limit > 1000.0 {
            return Err(EngineError::validation("miter_limit must be in 1..=1000"));
        }
        if self.dash.len() > 64 {
            return Err(EngineError::validation("dash pattern has at most 64 entries"));
        }
        if self.dash.iter().any(|d| !finite(*d) || *d < 0.0) {
            return Err(EngineError::validation("dash lengths must be finite and non-negative"));
        }
        if !self.dash.is_empty() && self.dash.iter().sum::<f64>() <= 0.0 {
            return Err(EngineError::validation("dash pattern must have a positive total length"));
        }
        if !finite(self.dash_offset) {
            return Err(EngineError::validation("dash_offset must be finite"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum FillRule {
    #[default]
    Nonzero,
    Evenodd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PaintOrder {
    #[default]
    FillStroke,
    StrokeFill,
}

/// A vector path layer's payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathData {
    pub subpaths: Vec<Subpath>,
    #[serde(default)]
    pub fill: Option<Paint>,
    #[serde(default)]
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub fill_rule: FillRule,
    #[serde(default)]
    pub paint_order: PaintOrder,
}

impl PathData {
    pub fn validate(&self) -> Result<(), EngineError> {
        validate_subpaths(&self.subpaths)?;
        if let Some(p) = &self.fill {
            p.validate()?;
        }
        if let Some(s) = &self.stroke {
            s.validate()?;
        }
        Ok(())
    }
}

/// Layer payload. `Raster` holds a canvas-sized RGBA buffer (`w*h*4`),
/// shared cheaply via `Arc`. `Group` and `Boolean` own children through the
/// children's `parent` field; a boolean's children are its editable operands.
#[derive(Debug, Clone, PartialEq)]
pub enum Content {
    Raster(Arc<Vec<u8>>),
    Shape(Shape),
    Group,
    Path(PathData),
    Boolean { op: BoolOp, fill: Option<Paint> },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Layer {
    pub id: u64,
    pub name: String,
    pub opacity: f64,
    pub visible: bool,
    pub locked: bool,
    pub blend: BlendMode,
    pub parent: Option<u64>,
    pub clipped: bool,
    pub transform: Transform,
    pub mask: Option<Mask>,
    pub content: Content,
}

impl Layer {
    pub fn new(id: u64, name: String, content: Content) -> Layer {
        Layer {
            id,
            name,
            opacity: 1.0,
            visible: true,
            locked: false,
            blend: BlendMode::Normal,
            parent: None,
            clipped: false,
            transform: Transform::default(),
            mask: None,
            content,
        }
    }

    pub fn is_raster(&self) -> bool {
        matches!(self.content, Content::Raster(_))
    }

    pub fn is_container(&self) -> bool {
        matches!(self.content, Content::Group | Content::Boolean { .. })
    }

    /// Shapes and paths can be boolean operands.
    pub fn is_vector(&self) -> bool {
        matches!(self.content, Content::Shape(_) | Content::Path(_))
    }

    pub fn kind_name(&self) -> &'static str {
        match self.content {
            Content::Raster(_) => "raster",
            Content::Shape(_) => "shape",
            Content::Group => "group",
            Content::Path(_) => "path",
            Content::Boolean { .. } => "boolean",
        }
    }
}

/// A named page/board region in canvas coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Artboard {
    pub id: u64,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Artboard {
    pub fn validate(&self) -> Result<(), EngineError> {
        if ![self.x, self.y].iter().all(|v| finite(*v)) {
            return Err(EngineError::validation("artboard x/y must be finite"));
        }
        if !finite(self.w) || !finite(self.h) || self.w <= 0.0 || self.h <= 0.0 {
            return Err(EngineError::validation("artboard w/h must be positive"));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Wire format — exactly the JSON described in ENGINE_OPS.md.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct DocWire {
    pub width: u32,
    pub height: u32,
    pub next_id: u64,
    pub layers: Vec<LayerWire>,
    #[serde(default)]
    pub artboards: Vec<Artboard>,
    #[serde(default)]
    pub selected: Vec<u64>,
    /// Pixel selection, `w*h` alpha bytes; absent when nothing is selected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_b64: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MaskWire {
    pub enabled: bool,
    pub inverted: bool,
    pub mask_b64: String,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LayerWire {
    pub id: u64,
    pub name: String,
    pub opacity: f64,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub blend: BlendMode,
    #[serde(default)]
    pub parent: Option<u64>,
    #[serde(default)]
    pub clipped: bool,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub mask: Option<MaskWire>,
    pub content: ContentWire,
}

/// Internally tagged on `"type"`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentWire {
    Raster { pixels_b64: String },
    Shape { shape: Shape },
    Group,
    Path { path: PathData },
    Boolean { op: BoolOp, #[serde(default)] fill: Option<Paint> },
}

impl Layer {
    pub fn to_wire(&self) -> LayerWire {
        let content = match &self.content {
            Content::Raster(px) => ContentWire::Raster { pixels_b64: b64::encode(px) },
            Content::Shape(s) => ContentWire::Shape { shape: s.clone() },
            Content::Group => ContentWire::Group,
            Content::Path(p) => ContentWire::Path { path: p.clone() },
            Content::Boolean { op, fill } => ContentWire::Boolean { op: *op, fill: fill.clone() },
        };
        LayerWire {
            id: self.id,
            name: self.name.clone(),
            opacity: self.opacity,
            visible: self.visible,
            locked: self.locked,
            blend: self.blend,
            parent: self.parent,
            clipped: self.clipped,
            transform: self.transform,
            mask: self.mask.as_ref().map(|m| MaskWire {
                enabled: m.enabled,
                inverted: m.inverted,
                mask_b64: b64::encode(&m.alpha),
            }),
            content,
        }
    }

    /// Decode a wire layer, validating invariants (pixel buffer length,
    /// opacity domain, geometry sanity). Errors are `Serialization` — this
    /// is only reached from `restore`. Parent links are checked by the caller.
    pub fn from_wire(w: LayerWire, pixel_len: usize) -> Result<Layer, EngineError> {
        if !w.opacity.is_finite() || !(0.0..=1.0).contains(&w.opacity) {
            return Err(EngineError::serialization("layer opacity outside 0..=1 in snapshot"));
        }
        let bad = |what: &str| EngineError::serialization(format!("invalid {what} in snapshot"));
        w.transform.validate().map_err(|_| bad("transform"))?;
        let content = match w.content {
            ContentWire::Raster { pixels_b64 } => {
                let bytes = b64::decode(&pixels_b64)?;
                if bytes.len() != pixel_len {
                    return Err(EngineError::serialization(format!(
                        "raster layer pixel length {} does not match canvas {}",
                        bytes.len(),
                        pixel_len
                    )));
                }
                Content::Raster(Arc::new(bytes))
            }
            ContentWire::Shape { shape } => {
                shape.validate().map_err(|_| bad("shape geometry"))?;
                Content::Shape(shape)
            }
            ContentWire::Group => Content::Group,
            ContentWire::Path { path } => {
                path.validate().map_err(|_| bad("path"))?;
                Content::Path(path)
            }
            ContentWire::Boolean { op, fill } => {
                if let Some(f) = &fill {
                    f.validate().map_err(|_| bad("boolean fill"))?;
                }
                Content::Boolean { op, fill }
            }
        };
        let mask = match w.mask {
            None => None,
            Some(m) => {
                let alpha = b64::decode(&m.mask_b64)?;
                if alpha.len() != pixel_len / 4 {
                    return Err(EngineError::serialization("mask length does not match canvas"));
                }
                Some(Mask { alpha: Arc::new(alpha), enabled: m.enabled, inverted: m.inverted })
            }
        };
        Ok(Layer {
            id: w.id,
            name: w.name,
            opacity: w.opacity,
            visible: w.visible,
            locked: w.locked,
            blend: w.blend,
            parent: w.parent,
            clipped: w.clipped,
            transform: w.transform,
            mask,
            content,
        })
    }
}
