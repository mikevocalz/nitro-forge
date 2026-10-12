//! Document model: layers, shapes, and the wire format shared by `describe`,
//! `getLayer`, `flatten` snapshots, and `snapshot`/`restore`.
//!
//! Internal raster pixels live behind `Arc<Vec<u8>>` so that structural undo
//! entries (prior `Vec<Layer>`) are cheap pointer copies, not deep clones.

use std::sync::Arc;

use ignition_core::EngineError;
use serde::{Deserialize, Serialize};

use crate::b64;

/// Shape primitives. Serialized as `"rect"` / `"ellipse"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rect,
    Ellipse,
}

/// A vector shape: bounds in canvas coordinates plus an RGBA fill.
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
        if !self.x.is_finite() || !self.y.is_finite() {
            return Err(EngineError::validation("shape x/y must be finite"));
        }
        if !self.w.is_finite() || !self.h.is_finite() || self.w <= 0.0 || self.h <= 0.0 {
            return Err(EngineError::validation("shape w/h must be positive and finite"));
        }
        Ok(())
    }
}

/// Layer payload. `Raster` holds a canvas-sized RGBA buffer (`w*h*4`),
/// shared cheaply via `Arc`.
#[derive(Debug, Clone, PartialEq)]
pub enum Content {
    Raster(Arc<Vec<u8>>),
    Shape(Shape),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Layer {
    pub id: u64,
    pub name: String,
    pub opacity: f64,
    pub visible: bool,
    pub content: Content,
}

impl Layer {
    pub fn is_raster(&self) -> bool {
        matches!(self.content, Content::Raster(_))
    }
}

// ---------------------------------------------------------------------------
// Wire format — exactly the JSON described in ENGINE_OPS.md.
// ---------------------------------------------------------------------------

/// `{"width":…,"height":…,"next_id":…,"layers":[…]}`
#[derive(Debug, Serialize, Deserialize)]
pub struct DocWire {
    pub width: u32,
    pub height: u32,
    pub next_id: u64,
    pub layers: Vec<LayerWire>,
}

/// `{"id":…,"name":…,"opacity":…,"visible":…,"content":{…}}`
#[derive(Debug, Serialize, Deserialize)]
pub struct LayerWire {
    pub id: u64,
    pub name: String,
    pub opacity: f64,
    pub visible: bool,
    pub content: ContentWire,
}

/// Internally tagged on `"type"`:
/// `{"type":"raster","pixels_b64":"…"}` or `{"type":"shape","shape":{…}}`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentWire {
    Raster { pixels_b64: String },
    Shape { shape: Shape },
}

impl Layer {
    pub fn to_wire(&self) -> LayerWire {
        let content = match &self.content {
            Content::Raster(px) => ContentWire::Raster {
                pixels_b64: b64::encode(px),
            },
            Content::Shape(s) => ContentWire::Shape { shape: s.clone() },
        };
        LayerWire {
            id: self.id,
            name: self.name.clone(),
            opacity: self.opacity,
            visible: self.visible,
            content,
        }
    }

    /// Decode a wire layer, validating invariants (pixel buffer length,
    /// opacity domain, shape sanity). Errors are `Serialization` — this is
    /// only reached from `restore`.
    pub fn from_wire(w: LayerWire, pixel_len: usize) -> Result<Layer, EngineError> {
        if !w.opacity.is_finite() || !(0.0..=1.0).contains(&w.opacity) {
            return Err(EngineError::serialization(
                "layer opacity outside 0..=1 in snapshot",
            ));
        }
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
                shape.validate().map_err(|_| {
                    EngineError::serialization("invalid shape geometry in snapshot")
                })?;
                Content::Shape(shape)
            }
        };
        Ok(Layer {
            id: w.id,
            name: w.name,
            opacity: w.opacity,
            visible: w.visible,
            content,
        })
    }
}
