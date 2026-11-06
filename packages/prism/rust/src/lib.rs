//! prism-engine — raster/vector document engine for Nitro-Forge Prism.
//!
//! Implements `ignition_core::Engine` per docs/ARCHITECTURE.md and the
//! `prism-engine` op surface in docs/ENGINE_OPS.md. Pure Rust: no I/O, no
//! async, no `unsafe`. Raster layers hold a canvas-sized RGBA buffer behind
//! `Arc` so structural undo entries are cheap.

mod b64;
mod geom;
mod colors;
mod model;
mod ops;
mod raster;
mod render;
mod select;
mod vector;
#[cfg(test)]
mod tests_v2;

use std::sync::Arc;

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal,
};
use serde_json::{json, Value};

use model::{Artboard, Content, DocWire, Layer, Shape, ShapeKind};
use colors::DocColors;
use raster::Filter;

/// Journal depth per ENGINE_OPS.md ("capacity 64").
const JOURNAL_CAPACITY: usize = 64;
/// Only command schema v1 is accepted (ARCHITECTURE.md §"Versioning").
const COMMAND_VERSION: u32 = 1;
/// Canvas ceiling: 2^28 pixels = 1 GiB of RGBA. Larger requests are rejected
/// with `Validation` so a hostile payload cannot trigger a giant allocation.
const MAX_PIXELS: u64 = 1 << 28;

/// Prior document state recorded before structural mutations. `Vec<Layer>`
/// clones are cheap: raster pixels are `Arc`.
#[derive(Debug)]
struct DocState {
    width: u32,
    height: u32,
    next_id: u64,
    layers: Vec<Layer>,
    artboards: Vec<Artboard>,
    selection: Option<Arc<Vec<u8>>>,
    selected: Vec<u64>,
    colors: DocColors,
}

/// Undo entries, recorded before mutation (ENGINE_OPS.md, prism "Undo"):
/// structural ops snapshot the whole layer stack; pixel ops snapshot only the
/// `{layer_id, rect, prev}` region about to be overwritten.
#[derive(Debug)]
enum UndoEntry {
    Doc(DocState),
    Pixels {
        layer_id: u64,
        x: u32,
        y: u32,
        w: u32,
        h: u32,
        prev: Vec<u8>,
    },
    /// Prior document palette (setColors / swapColors / clearRecentColors).
    Colors(DocColors),
}

pub struct PrismEngine {
    width: u32,
    height: u32,
    next_id: u64,
    layers: Vec<Layer>,
    artboards: Vec<Artboard>,
    /// Pixel selection, canvas-sized `w*h` alpha; `None` = nothing selected.
    selection: Option<Arc<Vec<u8>>>,
    /// Object selection (layer ids), in selection order.
    selected: Vec<u64>,
    colors: DocColors,
    journal: Journal<UndoEntry>,
}

impl PrismEngine {
    /// Host-facing constructor. `width`/`height` may be zero (blank canvas);
    /// every op still behaves without panicking.
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            next_id: 1,
            layers: Vec::new(),
            artboards: Vec::new(),
            selection: None,
            selected: Vec::new(),
            colors: DocColors::default(),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    // -- state helpers ------------------------------------------------------

    fn capture(&self) -> DocState {
        DocState {
            width: self.width,
            height: self.height,
            next_id: self.next_id,
            layers: self.layers.clone(),
            artboards: self.artboards.clone(),
            selection: self.selection.clone(),
            selected: self.selected.clone(),
            colors: self.colors.clone(),
        }
    }

    fn set_state(&mut self, s: DocState) {
        self.width = s.width;
        self.height = s.height;
        self.next_id = s.next_id;
        self.layers = s.layers;
        self.artboards = s.artboards;
        self.selection = s.selection;
        self.selected = s.selected;
        self.colors = s.colors;
    }

    /// Canvas buffer length (`w*h*4`), 0 on overflow — callers guard.
    fn pixel_len(&self) -> usize {
        (self.width as u64)
            .checked_mul(self.height as u64)
            .and_then(|n| n.checked_mul(4))
            .and_then(|n| usize::try_from(n).ok())
            .unwrap_or(0)
    }

    fn alloc_id(&mut self) -> u64 {
        // Snapshots could carry a stale next_id; skip in-use ids defensively.
        while self.layers.iter().any(|l| l.id == self.next_id)
            || self.artboards.iter().any(|a| a.id == self.next_id)
        {
            self.next_id = self.next_id.saturating_add(1);
        }
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        id
    }

    fn layer_index(&self, id: u64) -> Result<usize, EngineError> {
        self.layers
            .iter()
            .position(|l| l.id == id)
            .ok_or_else(|| EngineError::not_found(format!("layer {id} not found")))
    }

    /// Index of a raster layer — `NotFound` if absent, `Validation` if the
    /// layer is a shape.
    fn raster_index(&self, id: u64) -> Result<usize, EngineError> {
        let idx = self.layer_index(id)?;
        if !self.layers[idx].is_raster() {
            return Err(EngineError::validation(format!(
                "layer {id} is a shape layer, not raster"
            )));
        }
        Ok(idx)
    }

    fn raster_ref(&self, idx: usize) -> Option<&Vec<u8>> {
        match self.layers.get(idx) {
            Some(Layer {
                content: Content::Raster(px),
                ..
            }) => Some(px.as_ref()),
            _ => None,
        }
    }

    fn raster_mut(&mut self, idx: usize) -> Option<&mut Vec<u8>> {
        match self.layers.get_mut(idx) {
            Some(Layer {
                content: Content::Raster(px),
                ..
            }) => Some(Arc::make_mut(px)),
            _ => None,
        }
    }

    fn to_wire(&self) -> DocWire {
        DocWire {
            width: self.width,
            height: self.height,
            next_id: self.next_id,
            layers: self.layers.iter().map(Layer::to_wire).collect(),
            artboards: self.artboards.clone(),
            selected: self.selected.clone(),
            selection_b64: self.selection.as_ref().map(|s| b64::encode(s)),
            colors: self.colors.clone(),
        }
    }

    // -- payload helpers ----------------------------------------------------

    fn field<'a>(p: &'a Value, key: &str) -> Result<&'a Value, EngineError> {
        p.get(key)
            .ok_or_else(|| EngineError::invalid(format!("missing field '{key}'")))
    }

    fn req_f64(p: &Value, key: &str) -> Result<f64, EngineError> {
        Self::field(p, key)?
            .as_f64()
            .ok_or_else(|| EngineError::invalid(format!("field '{key}' must be a number")))
    }

    fn req_u64(p: &Value, key: &str) -> Result<u64, EngineError> {
        Self::field(p, key)?
            .as_u64()
            .ok_or_else(|| EngineError::invalid(format!("field '{key}' must be a u64")))
    }

    fn req_bool(p: &Value, key: &str) -> Result<bool, EngineError> {
        Self::field(p, key)?
            .as_bool()
            .ok_or_else(|| EngineError::invalid(format!("field '{key}' must be a bool")))
    }

    fn req_id(p: &Value) -> Result<u64, EngineError> {
        Self::req_u64(p, "id")
    }

    fn req_name(p: &Value) -> Result<String, EngineError> {
        Self::field(p, "name")?
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| EngineError::invalid("field 'name' must be a string"))
    }

    fn opt_name(p: &Value) -> Result<Option<String>, EngineError> {
        match p.get("name") {
            None => Ok(None),
            Some(v) => v
                .as_str()
                .map(|s| Some(s.to_string()))
                .ok_or_else(|| EngineError::invalid("field 'name' must be a string")),
        }
    }

    /// `[r,g,b,a]` — wrong shape is `InvalidCommand`, out-of-range `Validation`.
    fn req_color(p: &Value, key: &str) -> Result<[u8; 4], EngineError> {
        let arr = Self::field(p, key)?
            .as_array()
            .ok_or_else(|| EngineError::invalid(format!("field '{key}' must be an array")))?;
        if arr.len() != 4 {
            return Err(EngineError::invalid(format!(
                "field '{key}' must have exactly 4 channels"
            )));
        }
        let mut out = [0u8; 4];
        for (i, c) in arr.iter().enumerate() {
            let Some(n) = c.as_u64() else {
                return Err(EngineError::invalid(format!(
                    "channel {i} of '{key}' must be an integer"
                )));
            };
            if n > 255 {
                return Err(EngineError::validation(format!(
                    "channel {i} of '{key}' out of range 0..=255"
                )));
            }
            out[i] = n as u8;
        }
        Ok(out)
    }

    /// `{width,height}` used by `new`/`resize`; u32-bounded, >0, and within
    /// the pixel ceiling.
    fn req_dims(p: &Value) -> Result<(u32, u32), EngineError> {
        let w = Self::req_u64(p, "width")?;
        let h = Self::req_u64(p, "height")?;
        let w = u32::try_from(w)
            .map_err(|_| EngineError::validation("width too large"))?;
        let h = u32::try_from(h)
            .map_err(|_| EngineError::validation("height too large"))?;
        Self::check_dims(w, h)?;
        Ok((w, h))
    }

    fn check_dims(w: u32, h: u32) -> Result<(), EngineError> {
        if w == 0 || h == 0 {
            return Err(EngineError::validation(
                "width and height must be at least 1",
            ));
        }
        if (w as u64).saturating_mul(h as u64) > MAX_PIXELS {
            return Err(EngineError::validation("canvas too large"));
        }
        Ok(())
    }

    fn parse_shape(v: &Value) -> Result<Shape, EngineError> {
        let kind = Self::field(v, "kind")?
            .as_str()
            .ok_or_else(|| EngineError::invalid("shape.kind must be a string"))?;
        let kind = match kind {
            "rect" => ShapeKind::Rect,
            "ellipse" => ShapeKind::Ellipse,
            other => {
                return Err(EngineError::validation(format!(
                    "unknown shape kind '{other}'"
                )))
            }
        };
        let shape = Shape {
            kind,
            x: Self::req_f64(v, "x")?,
            y: Self::req_f64(v, "y")?,
            w: Self::req_f64(v, "w")?,
            h: Self::req_f64(v, "h")?,
            fill: Self::req_color(v, "fill")?,
        };
        shape.validate()?;
        Ok(shape)
    }

    // -- op handlers --------------------------------------------------------

    /// `new {width,height}` — reset to a blank document. Records undo.
    fn op_new(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let (w, h) = Self::req_dims(p)?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        self.width = w;
        self.height = h;
        self.next_id = 1;
        self.layers.clear();
        self.artboards.clear();
        self.selection = None;
        self.selected.clear();
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `resize {width,height}` — raster layers crop/pad with transparent.
    fn op_resize(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let (w, h) = Self::req_dims(p)?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        let (sw, sh) = (self.width as usize, self.height as usize);
        let (dw, dh) = (w as usize, h as usize);
        for layer in &mut self.layers {
            if let Content::Raster(px) = &mut layer.content {
                let resized = raster::resize_canvas(px, sw, sh, dw, dh);
                *px = Arc::new(resized);
            }
            if let Some(mask) = &mut layer.mask {
                mask.alpha = Arc::new(ops::resize_alpha(&mask.alpha, sw, sh, dw, dh));
            }
        }
        if let Some(sel) = &self.selection {
            self.selection = Some(Arc::new(ops::resize_alpha(sel, sw, sh, dw, dh)));
        }
        self.width = w;
        self.height = h;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `addRasterLayer {name?}` — transparent, on top of the stack.
    fn op_add_raster_layer(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let name = Self::opt_name(p)?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        let id = self.alloc_id();
        let layer = Layer::new(
            id,
            name.unwrap_or_else(|| format!("Layer {id}")),
            Content::Raster(Arc::new(vec![0u8; self.pixel_len()])),
        );
        self.layers.push(layer);
        Ok(CommandResult::data(json!({ "layer_id": id })))
    }

    /// `addShape {shape, name?}`.
    fn op_add_shape(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let shape = Self::parse_shape(Self::field(p, "shape")?)?;
        let name = Self::opt_name(p)?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        let id = self.alloc_id();
        self.layers.push(Layer::new(
            id,
            name.unwrap_or_else(|| format!("Shape {id}")),
            Content::Shape(shape),
        ));
        Ok(CommandResult::data(json!({ "layer_id": id })))
    }

    /// Relative translation and axis-aligned resize, anchored at the top-left.
    /// Validate computed bounds before touching the document or its history.
    fn op_transform_shape(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        self.ensure_unlocked(idx)?;
        let mut shape = match &self.layers[idx].content {
            Content::Shape(shape) => shape.clone(),
            _ => {
                return Err(EngineError::validation("transformShape requires a shape layer"));
            }
        };
        let dx = Self::req_f64(p, "dx")?;
        let dy = Self::req_f64(p, "dy")?;
        let scale_x = Self::req_f64(p, "scale_x")?;
        let scale_y = Self::req_f64(p, "scale_y")?;
        if !dx.is_finite() || !dy.is_finite() || !scale_x.is_finite()
            || !scale_y.is_finite() || scale_x <= 0.0 || scale_y <= 0.0 {
            return Err(EngineError::validation("translation must be finite and scales positive and finite"));
        }
        shape.x += dx;
        shape.y += dy;
        shape.w *= scale_x;
        shape.h *= scale_y;
        shape.validate()?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        self.layers[idx].content = Content::Shape(shape);
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `setShapeFill {id,color}` — edits only the fill, preserving geometry and identity.
    fn op_set_shape_fill(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        self.ensure_unlocked(idx)?;
        let color = Self::req_color(p, "color")?;
        if !matches!(self.layers[idx].content, Content::Shape(_)) {
            return Err(EngineError::validation("setShapeFill requires a shape layer"));
        }
        self.journal.record(UndoEntry::Doc(self.capture()));
        if let Content::Shape(shape) = &mut self.layers[idx].content {
            shape.fill = color;
        }
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `removeLayer {id}`.
    fn op_remove_layer(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        self.ensure_unlocked(idx)?;
        let id = self.layers[idx].id;
        let doomed = self.subtree_ids(id);
        self.journal.record(UndoEntry::Doc(self.capture()));
        self.layers.retain(|l| !doomed.contains(&l.id));
        self.selected.retain(|s| !doomed.contains(s));
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `moveLayer {id,to_index}` — index 0 = bottom.
    fn op_move_layer(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let to = usize::try_from(Self::req_u64(p, "to_index")?)
            .map_err(|_| EngineError::out_of_bounds("to_index too large"))?;
        if to >= self.layers.len() {
            return Err(EngineError::out_of_bounds(format!(
                "to_index {to} out of range ({} layers)",
                self.layers.len()
            )));
        }
        self.journal.record(UndoEntry::Doc(self.capture()));
        let layer = self.layers.remove(idx);
        self.layers.insert(to, layer);
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `renameLayer {id,name}`.
    fn op_rename_layer(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let name = Self::req_name(p)?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        self.layers[idx].name = name;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `setLayerOpacity {id,opacity}` — 0..=1 else `Validation`.
    fn op_set_opacity(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let opacity = Self::req_f64(p, "opacity")?;
        if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
            return Err(EngineError::validation("opacity must be in 0..=1"));
        }
        self.ensure_unlocked(idx)?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        self.layers[idx].opacity = opacity;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `setLayerVisible {id,visible}`.
    fn op_set_visible(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let visible = Self::req_bool(p, "visible")?;
        self.journal.record(UndoEntry::Doc(self.capture()));
        self.layers[idx].visible = visible;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `drawPixels {id,x,y,w,h,data_b64}` — real src-over blend, clipped to
    /// canvas. `data` is `w*h*4` RGBA. Raster layers only. The pixels may
    /// instead arrive as the command's binary input, with `data_b64` omitted.
    fn op_draw_pixels(&mut self, cmd: &mut Command) -> Result<CommandResult, EngineError> {
        let p = &cmd.payload;
        let idx = self.raster_index(Self::req_id(p)?)?;
        self.ensure_unlocked(idx)?;
        let x = Self::req_f64(p, "x")?;
        let y = Self::req_f64(p, "y")?;
        let w = Self::req_f64(p, "w")?;
        let h = Self::req_f64(p, "h")?;
        if !x.is_finite() || !y.is_finite() {
            return Err(EngineError::validation("x/y must be finite"));
        }
        if x.fract() != 0.0
            || y.fract() != 0.0
            || x.abs() > i64::MAX as f64
            || y.abs() > i64::MAX as f64
        {
            return Err(EngineError::validation("x/y must be integers"));
        }
        if !w.is_finite() || !h.is_finite() || w <= 0.0 || h <= 0.0 {
            return Err(EngineError::validation("w/h must be positive"));
        }
        if w.fract() != 0.0 || h.fract() != 0.0 || w > i64::MAX as f64 || h > i64::MAX as f64 {
            return Err(EngineError::validation("w/h must be integers"));
        }
        let data = cmd.bytes_input("data_b64", |text| {
            b64::decode(text).map_err(|_| EngineError::validation("data_b64 is not valid base64"))
        })?;
        let expected = (w as u128) * (h as u128) * 4;
        if expected != data.len() as u128 {
            return Err(EngineError::validation(format!(
                "pixel data length {} does not equal w*h*4 ({expected})",
                data.len()
            )));
        }

        // Clip the destination rect to the canvas.
        let (xi, yi) = (x as i64, y as i64);
        let (wi, hi) = (w as i64, h as i64);
        let x0 = xi.max(0);
        let y0 = yi.max(0);
        let x1 = xi.saturating_add(wi).min(self.width as i64);
        let y1 = yi.saturating_add(hi).min(self.height as i64);
        if x1 <= x0 || y1 <= y0 {
            // Fully off-canvas: success, nothing mutated — no undo entry and
            // no document:changed event.
            return Ok(CommandResult {
                events: Vec::new(),
                data: json!({ "ok": true }),
                output: None,
            });
        }
        let (cx, cy) = (x0 as u32, y0 as u32);
        let (cw, ch) = ((x1 - x0) as u32, (y1 - y0) as u32);

        // Record the pixel region about to be overwritten (immutable read —
        // the copy, not the Arc, goes into the journal).
        let buf = self
            .raster_ref(idx)
            .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        let prev = raster::read_region(
            buf,
            self.width as usize,
            cx as usize,
            cy as usize,
            cw as usize,
            ch as usize,
        );
        self.journal.record(UndoEntry::Pixels {
            layer_id: self.layers[idx].id,
            x: cx,
            y: cy,
            w: cw,
            h: ch,
            prev,
        });

        let canvas_w = self.width as usize;
        let buf = self
            .raster_mut(idx)
            .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        let src_w = wi as usize;
        for cy_i in y0..y1 {
            let sy = (cy_i - yi) as usize;
            for cx_i in x0..x1 {
                let sx = (cx_i - xi) as usize;
                let so = (sy * src_w + sx) * 4;
                let src = [data[so], data[so + 1], data[so + 2], data[so + 3]];
                let d = (cy_i as usize * canvas_w + cx_i as usize) * 4;
                if d + 4 <= buf.len() {
                    raster::blend_pixel(&mut buf[d..d + 4], &src, 1.0);
                }
            }
        }
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `fillLayer {id,color:[r,g,b,a]}` — set every pixel (not blended).
    fn op_fill_layer(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.raster_index(Self::req_id(p)?)?;
        let color = Self::req_color(p, "color")?;
        self.ensure_unlocked(idx)?;
        self.record_full_layer_pixels(idx)?;
        let buf = self
            .raster_mut(idx)
            .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        for px in buf.chunks_exact_mut(4) {
            px.copy_from_slice(&color);
        }
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `applyFilter {id,filter:{type,amount?}}` — grayscale / invert /
    /// brightness (amount -1..=1). Raster only.
    fn op_apply_filter(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.raster_index(Self::req_id(p)?)?;
        let f = Self::field(p, "filter")?;
        let ty = Self::field(f, "type")?
            .as_str()
            .ok_or_else(|| EngineError::invalid("filter.type must be a string"))?;
        let filter = match ty {
            "grayscale" => Filter::Grayscale,
            "invert" => Filter::Invert,
            "brightness" => {
                let amount = match f.get("amount") {
                    None => 0.0,
                    Some(v) => v
                        .as_f64()
                        .ok_or_else(|| EngineError::invalid("filter.amount must be a number"))?,
                };
                if !amount.is_finite() || !(-1.0..=1.0).contains(&amount) {
                    return Err(EngineError::validation(
                        "brightness amount must be in -1..=1",
                    ));
                }
                Filter::Brightness(amount)
            }
            other => {
                return Err(EngineError::validation(format!(
                    "unknown filter type '{other}'"
                )))
            }
        };
        self.ensure_unlocked(idx)?;
        self.record_full_layer_pixels(idx)?;
        let buf = self
            .raster_mut(idx)
            .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        raster::apply_filter(buf, &filter);
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `flatten {}` — composite bottom→top honoring opacity/visible; shapes
    /// rasterized. Read-only: no undo entry, no `document:changed`. A binary
    /// command gets the RGBA bytes as output instead of `pixels_b64`.
    fn op_flatten(&self, cmd: &Command) -> Result<CommandResult, EngineError> {
        let pixels = self.scene().flatten();
        Ok(CommandResult::read_only(json!({
            "width": self.width,
            "height": self.height,
        }))
        .with_bytes(cmd, "pixels_b64", pixels))
    }

    /// `getLayer {id}` — the layer object. Read-only.
    fn op_get_layer(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let wire = self.layers[idx].to_wire();
        let data = serde_json::to_value(&wire)
            .map_err(|e| EngineError::internal(e.to_string()))?;
        Ok(CommandResult {
            output: None,
            events: Vec::new(),
            data,
        })
    }

    /// `describe` — complete document state. Read-only.
    // -- document colors (C-01) -------------------------------------------

    fn opt_color(p: &Value, key: &str) -> Result<Option<[u8; 4]>, EngineError> {
        match p.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(_) => Self::req_color(p, key).map(Some),
        }
    }

    /// Commit a new palette, recording the old one. `None` means the op
    /// changed nothing: no undo entry and no `document:changed`.
    fn commit_colors(&mut self, next: Option<DocColors>) -> CommandResult {
        let Some(next) = next else {
            return CommandResult {
                output: None,
                events: Vec::new(),
                data: json!({ "ok": true, "changed": false }),
            };
        };
        let prev = std::mem::replace(&mut self.colors, next);
        self.journal.record(UndoEntry::Colors(prev));
        CommandResult::data(json!({ "ok": true, "changed": true }))
    }

    fn op_set_colors(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let fg = Self::opt_color(p, "foreground")?;
        let bg = Self::opt_color(p, "background")?;
        if fg.is_none() && bg.is_none() {
            return Err(EngineError::invalid(
                "setColors needs 'foreground' and/or 'background'",
            ));
        }
        let remember = match p.get("remember") {
            None | Some(Value::Null) => true,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err(EngineError::invalid("field 'remember' must be a boolean")),
        };
        let next = self.colors.committed(fg, bg, remember);
        Ok(self.commit_colors(next))
    }

    fn op_swap_colors(&mut self) -> Result<CommandResult, EngineError> {
        let next = self.colors.swapped();
        Ok(self.commit_colors(next))
    }

    fn op_clear_recent_colors(&mut self) -> Result<CommandResult, EngineError> {
        let next = (!self.colors.recent.is_empty()).then(|| DocColors {
            recent: Vec::new(),
            ..self.colors.clone()
        });
        Ok(self.commit_colors(next))
    }

    fn op_get_colors(&self) -> Result<CommandResult, EngineError> {
        let data =
            serde_json::to_value(&self.colors).map_err(|e| EngineError::internal(e.to_string()))?;
        Ok(CommandResult {
            output: None,
            events: Vec::new(),
            data,
        })
    }

    fn op_describe(&self) -> Result<CommandResult, EngineError> {
        let data = serde_json::to_value(self.to_wire())
            .map_err(|e| EngineError::internal(e.to_string()))?;
        Ok(CommandResult {
            output: None,
            events: Vec::new(),
            data,
        })
    }

    /// Record a full-canvas pixel-region undo entry for raster layer `idx`.
    fn record_full_layer_pixels(&mut self, idx: usize) -> Result<(), EngineError> {
        let buf = self
            .raster_ref(idx)
            .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        let prev = raster::read_region(
            buf,
            self.width as usize,
            0,
            0,
            self.width as usize,
            self.height as usize,
        );
        self.journal.record(UndoEntry::Pixels {
            layer_id: self.layers[idx].id,
            x: 0,
            y: 0,
            w: self.width,
            h: self.height,
            prev,
        });
        Ok(())
    }

    /// Shared inverse for undo and redo of a pixel-region entry: swap the
    /// recorded region with the current one, returning the entry that
    /// inverts back.
    fn invert_pixels(&mut self, entry: UndoEntry) -> UndoEntry {
        let UndoEntry::Pixels {
            layer_id,
            x,
            y,
            w,
            h,
            prev,
        } = entry
        else {
            return entry;
        };
        let Some(idx) = self.layers.iter().position(|l| l.id == layer_id) else {
            // Impossible under LIFO ordering; keep the entry so the stacks
            // stay symmetric.
            return UndoEntry::Pixels {
                layer_id,
                x,
                y,
                w,
                h,
                prev,
            };
        };
        let cw = self.width as usize;
        let ch_canvas = self.height as usize;
        let region_fits = (x as usize).saturating_add(w as usize) <= cw
            && (y as usize).saturating_add(h as usize) <= ch_canvas;
        let Some(buf) = self.raster_mut(idx) else {
            return UndoEntry::Pixels {
                layer_id,
                x,
                y,
                w,
                h,
                prev,
            };
        };
        if !region_fits || buf.len() < cw.saturating_mul(ch_canvas).saturating_mul(4) {
            return UndoEntry::Pixels {
                layer_id,
                x,
                y,
                w,
                h,
                prev,
            };
        }
        let cur = raster::read_region(buf, cw, x as usize, y as usize, w as usize, h as usize);
        raster::write_region(buf, cw, x as usize, y as usize, w as usize, h as usize, &prev);
        UndoEntry::Pixels {
            layer_id,
            x,
            y,
            w,
            h,
            prev: cur,
        }
    }
}

impl Engine for PrismEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Prism
    }

    fn binary_input_ops(&self) -> &'static [&'static str] {
        &["drawPixels"]
    }

    fn apply(&mut self, mut cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.v != COMMAND_VERSION {
            return Err(EngineError::unsupported(format!(
                "unsupported command version {}",
                cmd.v
            )));
        }
        match cmd.op.as_str() {
            "new" => self.op_new(&cmd.payload),
            "resize" => self.op_resize(&cmd.payload),
            "addRasterLayer" => self.op_add_raster_layer(&cmd.payload),
            "addShape" => self.op_add_shape(&cmd.payload),
            "setShapeFill" => self.op_set_shape_fill(&cmd.payload),
            "transformShape" => self.op_transform_shape(&cmd.payload),
            "removeLayer" => self.op_remove_layer(&cmd.payload),
            "moveLayer" => self.op_move_layer(&cmd.payload),
            "renameLayer" => self.op_rename_layer(&cmd.payload),
            "setLayerOpacity" => self.op_set_opacity(&cmd.payload),
            "setLayerVisible" => self.op_set_visible(&cmd.payload),
            "drawPixels" => self.op_draw_pixels(&mut cmd),
            "fillLayer" => self.op_fill_layer(&cmd.payload),
            "applyFilter" => self.op_apply_filter(&cmd.payload),
            "flatten" => self.op_flatten(&cmd),
            "getLayer" => self.op_get_layer(&cmd.payload),
            "describe" => self.op_describe(),
            "setColors" => self.op_set_colors(&cmd.payload),
            "swapColors" => self.op_swap_colors(),
            "clearRecentColors" => self.op_clear_recent_colors(),
            "getColors" => self.op_get_colors(),
            other => self.apply_v2(other, &cmd.payload),
        }
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let bytes = serde_json::to_vec(&self.to_wire())?;
        Ok(encode_envelope(&bytes))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_fmt, payload) = decode_envelope(data)?;
        let wire: DocWire = serde_json::from_slice(payload)?;
        // Enforce the same pixel ceiling as new/resize — a crafted snapshot
        // must not be able to trigger an unbounded raster allocation.
        Self::check_dims(wire.width, wire.height)
            .map_err(|e| EngineError::serialization(format!("snapshot {e}")))?;
        // Decode into a scratch state first — self stays untouched on error.
        let pixel_len = (wire.width as u64)
            .checked_mul(wire.height as u64)
            .and_then(|n| n.checked_mul(4))
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| EngineError::serialization("canvas too large in snapshot"))?;
        let mut layers = Vec::with_capacity(wire.layers.len());
        for lw in wire.layers {
            layers.push(Layer::from_wire(lw, pixel_len)?);
        }
        ops::validate_tree(&layers)?;
        for a in &wire.artboards {
            a.validate()
                .map_err(|_| EngineError::serialization("invalid artboard in snapshot"))?;
        }
        let selection = match &wire.selection_b64 {
            None => None,
            Some(s) => {
                let bytes = b64::decode(s)?;
                if bytes.len() != pixel_len / 4 {
                    return Err(EngineError::serialization(
                        "selection length does not match canvas",
                    ));
                }
                Some(Arc::new(bytes))
            }
        };
        let selected: Vec<u64> = wire
            .selected
            .into_iter()
            .filter(|id| layers.iter().any(|l| l.id == *id))
            .collect();
        self.width = wire.width;
        self.height = wire.height;
        self.next_id = wire.next_id;
        self.layers = layers;
        self.artboards = wire.artboards;
        self.selection = selection;
        self.selected = selected;
        self.colors = wire.colors.normalized();
        // Undo entries refer to pre-restore state; the document is replaced.
        self.journal = Journal::new(JOURNAL_CAPACITY);
        Ok(())
    }

    fn undo(&mut self) -> Result<bool, EngineError> {
        let Some(entry) = self.journal.pop_undo() else {
            return Ok(false);
        };
        match entry {
            UndoEntry::Doc(prev) => {
                let cur = self.capture();
                self.set_state(prev);
                self.journal.push_redo(UndoEntry::Doc(cur));
            }
            pixels @ UndoEntry::Pixels { .. } => {
                let inverse = self.invert_pixels(pixels);
                self.journal.push_redo(inverse);
            }
            UndoEntry::Colors(prev) => {
                let cur = std::mem::replace(&mut self.colors, prev);
                self.journal.push_redo(UndoEntry::Colors(cur));
            }
        }
        Ok(true)
    }

    fn redo(&mut self) -> Result<bool, EngineError> {
        let Some(entry) = self.journal.pop_redo() else {
            return Ok(false);
        };
        match entry {
            UndoEntry::Doc(prev) => {
                let cur = self.capture();
                self.set_state(prev);
                self.journal.push_undo(UndoEntry::Doc(cur));
            }
            pixels @ UndoEntry::Pixels { .. } => {
                let inverse = self.invert_pixels(pixels);
                self.journal.push_undo(inverse);
            }
            UndoEntry::Colors(prev) => {
                let cur = std::mem::replace(&mut self.colors, prev);
                self.journal.push_undo(UndoEntry::Colors(cur));
            }
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // -- helpers ------------------------------------------------------------

    fn eng() -> PrismEngine {
        PrismEngine::new(4, 4)
    }

    fn cmd(op: &str, payload: Value) -> Command {
        Command::new(op, payload)
    }

    fn apply(e: &mut PrismEngine, op: &str, payload: Value) -> CommandResult {
        e.apply(cmd(op, payload)).expect("apply failed")
    }

    fn apply_err(e: &mut PrismEngine, op: &str, payload: Value) -> EngineError {
        e.apply(cmd(op, payload)).expect_err("expected error")
    }

    fn describe(e: &mut PrismEngine) -> Value {
        apply(e, "describe", json!({})).data
    }

    /// Decode the raster pixel bytes of layer `id` out of `describe`.
    fn layer_pixels(e: &mut PrismEngine, id: u64) -> Vec<u8> {
        let d = describe(e);
        let layers = d["layers"].as_array().unwrap();
        let layer = layers
            .iter()
            .find(|l| l["id"].as_u64() == Some(id))
            .expect("layer missing");
        b64::decode(layer["content"]["pixels_b64"].as_str().unwrap()).unwrap()
    }

    fn pixel(buf: &[u8], width: usize, x: usize, y: usize) -> [u8; 4] {
        let o = (y * width + x) * 4;
        [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]
    }

    fn flatten_pixels(e: &mut PrismEngine) -> Vec<u8> {
        let r = apply(e, "flatten", json!({}));
        b64::decode(r.data["pixels_b64"].as_str().unwrap()).unwrap()
    }

    fn add_raster(e: &mut PrismEngine) -> u64 {
        apply(e, "addRasterLayer", json!({})).data["layer_id"]
            .as_u64()
            .unwrap()
    }

    fn fill(e: &mut PrismEngine, id: u64, color: [u8; 4]) {
        apply(e, "fillLayer", json!({"id": id, "color": color}));
    }

    #[test]
    fn shape_fill_preserves_identity_geometry_and_round_trips() {
        for kind in ["rect", "ellipse"] {
            let mut e = eng();
            let id = apply(&mut e, "addShape", json!({"name": "art", "shape": {
                "kind": kind, "x": 0, "y": 0, "w": 4, "h": 4, "fill": [255,0,0,255]
            }})).data["layer_id"].as_u64().unwrap();
            let before = e.snapshot().unwrap();
            apply(&mut e, "setShapeFill", json!({"id": id, "color": [0,128,255,255]}));
            let after = e.snapshot().unwrap();
            let layer = apply(&mut e, "getLayer", json!({"id": id})).data;
            assert_eq!(layer["name"], "art");
            assert_eq!(layer["content"]["shape"]["kind"], kind);
            assert_eq!(layer["content"]["shape"]["w"], 4.0);
            assert_eq!(pixel(&flatten_pixels(&mut e), 4, 2, 2), [0,128,255,255]);
            assert!(e.undo().unwrap());
            assert_eq!(e.snapshot().unwrap(), before);
            assert!(e.redo().unwrap());
            assert_eq!(e.snapshot().unwrap(), after);
            let mut restored = eng();
            restored.restore(&after).unwrap();
            assert_eq!(restored.snapshot().unwrap(), after);
            assert_eq!(flatten_pixels(&mut restored), flatten_pixels(&mut e));
        }
    }

    #[test]
    fn invalid_shape_fill_is_atomic_and_keeps_redo() {
        let mut e = eng();
        let raster = add_raster(&mut e);
        let id = apply(&mut e, "addShape", json!({"shape": {
            "kind": "rect", "x": 0, "y": 0, "w": 4, "h": 4, "fill": [255,0,0,255]
        }})).data["layer_id"].as_u64().unwrap();
        apply(&mut e, "setShapeFill", json!({"id": id, "color": [0,0,255,0]}));
        assert_eq!(pixel(&flatten_pixels(&mut e), 4, 2, 2), [0,0,0,0]);
        let after = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"id": raster, "color": [0,0,0,255]}),
            json!({"id": 999, "color": [0,0,0,255]}),
            json!({"id": id, "color": [0,0,256,255]}),
            json!({"id": id, "color": [0,0,-1,255]}),
            json!({"id": id, "color": [0,0,1.5,255]}),
            json!({"id": id, "color": [0,0,0]}),
            json!({"id": id}),
        ] {
            apply_err(&mut e, "setShapeFill", payload);
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), after);
    }

    #[test]
    fn shape_transform_pixels_identity_history_and_restore() {
        for kind in ["rect", "ellipse"] {
            let mut e = eng();
            let id = apply(&mut e, "addShape", json!({"name": "art", "shape": {
                "kind": kind, "x": 0, "y": 0, "w": 1, "h": 1, "fill": [0,128,255,255]
            }})).data["layer_id"].as_u64().unwrap();
            let before = e.snapshot().unwrap();
            let original = apply(&mut e, "getLayer", json!({"id": id})).data;
            let result = apply(&mut e, "transformShape", json!({
                "id": id, "dx": 1, "dy": 1, "scale_x": 2, "scale_y": 2
            }));
            assert!(result.events.iter().any(|ev| ev.kind == "document:changed"));
            let transformed = apply(&mut e, "getLayer", json!({"id": id})).data;
            let mut expected = original;
            expected["content"]["shape"]["x"] = json!(1.0);
            expected["content"]["shape"]["y"] = json!(1.0);
            expected["content"]["shape"]["w"] = json!(2.0);
            expected["content"]["shape"]["h"] = json!(2.0);
            assert_eq!(transformed, expected);
            assert_eq!(pixel(&flatten_pixels(&mut e), 4, 0, 0), [0,0,0,0]);
            assert_eq!(pixel(&flatten_pixels(&mut e), 4, 1, 1), [0,128,255,255]);
            let after = e.snapshot().unwrap();
            assert!(e.undo().unwrap());
            assert_eq!(e.snapshot().unwrap(), before);
            assert!(e.redo().unwrap());
            assert_eq!(e.snapshot().unwrap(), after);
            let mut restored = eng();
            restored.restore(&after).unwrap();
            assert_eq!(restored.snapshot().unwrap(), after);
            assert_eq!(flatten_pixels(&mut restored), flatten_pixels(&mut e));
            // Off-canvas translation is valid, with rendering clipped to canvas.
            apply(&mut e, "transformShape", json!({
                "id": id, "dx": -10, "dy": -10, "scale_x": 1, "scale_y": 1
            }));
            assert!(flatten_pixels(&mut e).iter().all(|channel| *channel == 0));
        }
    }

    #[test]
    fn invalid_shape_transform_preserves_state_and_redo() {
        let mut e = eng();
        let raster = add_raster(&mut e);
        let id = apply(&mut e, "addShape", json!({"shape": {
            "kind": "rect", "x": 1e7, "y": 1e7, "w": 1e7, "h": 1e7,
            "fill": [255,0,0,255]
        }})).data["layer_id"].as_u64().unwrap();
        apply(&mut e, "transformShape", json!({
            "id": id, "dx": 0, "dy": 0, "scale_x": 0.5, "scale_y": 0.5
        }));
        let after = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        let before = e.snapshot().unwrap();
        let base = json!({"id": id, "dx": 0, "dy": 0, "scale_x": 1, "scale_y": 1});
        for (key, value) in [
            ("id", json!(raster)), ("id", json!(999)),
            ("dx", json!(1e308)), ("dy", json!(1e308)),
            ("scale_x", json!(2)), ("scale_y", json!(2)),
            ("scale_x", json!(0)), ("scale_y", json!(-1)),
            ("dx", Value::Null), ("scale_y", json!("1")),
        ] {
            let mut payload = base.clone();
            payload[key] = value;
            apply_err(&mut e, "transformShape", payload);
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), after);
    }

    // -- construction / new / describe --------------------------------------

    #[test]
    fn new_blank_document() {
        let mut e = eng();
        let d = describe(&mut e);
        assert_eq!(d["width"], 4);
        assert_eq!(d["height"], 4);
        assert_eq!(d["next_id"], 1);
        assert_eq!(d["layers"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn new_op_resets_document() {
        let mut e = eng();
        add_raster(&mut e);
        let r = apply(&mut e, "new", json!({"width": 2, "height": 3}));
        assert_eq!(r.data["ok"], true);
        let d = describe(&mut e);
        assert_eq!(d["width"], 2);
        assert_eq!(d["height"], 3);
        assert_eq!(d["next_id"], 1);
        assert_eq!(d["layers"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn new_rejects_bad_dims_and_preserves_state() {
        let mut e = eng();
        add_raster(&mut e);
        let before = describe(&mut e);
        let err = apply_err(&mut e, "new", json!({"width": 0, "height": 4}));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        let err = apply_err(&mut e, "new", json!({"width": 4}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
        let err = apply_err(&mut e, "new", json!({"width": 70000, "height": 70000}));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn describe_is_read_only() {
        let mut e = eng();
        let r = apply(&mut e, "describe", json!({}));
        assert!(r.events.is_empty(), "describe must not emit events");
        assert!(!e.undo().unwrap(), "describe must not record undo");
    }

    // -- layer ops ----------------------------------------------------------

    #[test]
    fn add_raster_layer() {
        let mut e = eng();
        let id = add_raster(&mut e);
        assert_eq!(id, 1);
        let d = describe(&mut e);
        let l = &d["layers"][0];
        assert_eq!(l["id"], 1);
        assert_eq!(l["name"], "Layer 1");
        assert_eq!(l["opacity"], 1.0);
        assert_eq!(l["visible"], true);
        assert_eq!(l["content"]["type"], "raster");
        let px = b64::decode(l["content"]["pixels_b64"].as_str().unwrap()).unwrap();
        assert_eq!(px.len(), 4 * 4 * 4);
        assert!(px.iter().all(|&b| b == 0), "new layer must be transparent");
    }

    #[test]
    fn add_raster_layer_custom_name_and_ids_increment() {
        let mut e = eng();
        let a = apply(&mut e, "addRasterLayer", json!({"name": "bg"})).data["layer_id"]
            .as_u64()
            .unwrap();
        let b = add_raster(&mut e);
        assert_eq!((a, b), (1, 2));
        let d = describe(&mut e);
        assert_eq!(d["layers"][0]["name"], "bg");
        assert_eq!(d["next_id"], 3);
    }

    #[test]
    fn add_shape_rect() {
        let mut e = eng();
        let r = apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 1.0, "y": 1.0, "w": 2.0, "h": 2.0,
                             "fill": [255, 0, 0, 255]}, "name": "box"}),
        );
        let id = r.data["layer_id"].as_u64().unwrap();
        let l = apply(&mut e, "getLayer", json!({"id": id})).data;
        assert_eq!(l["name"], "box");
        assert_eq!(l["content"]["type"], "shape");
        assert_eq!(l["content"]["shape"]["kind"], "rect");
        assert_eq!(l["content"]["shape"]["fill"], json!([255, 0, 0, 255]));
    }

    #[test]
    fn add_shape_validation() {
        let mut e = eng();
        let before = describe(&mut e);
        // unknown kind
        let err = apply_err(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "triangle", "x": 0, "y": 0, "w": 1, "h": 1,
                             "fill": [0, 0, 0, 255]}}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // non-positive w
        let err = apply_err(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 0, "h": 1,
                             "fill": [0, 0, 0, 255]}}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // bad fill arity
        let err = apply_err(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1,
                             "fill": [0, 0, 0]}}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
        // channel out of range
        let err = apply_err(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1,
                             "fill": [0, 0, 300, 255]}}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn remove_layer() {
        let mut e = eng();
        let id = add_raster(&mut e);
        apply(&mut e, "removeLayer", json!({"id": id}));
        assert_eq!(describe(&mut e)["layers"].as_array().unwrap().len(), 0);
        let before = describe(&mut e);
        let err = apply_err(&mut e, "removeLayer", json!({"id": id}));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn move_layer_reorders() {
        let mut e = eng();
        let a = add_raster(&mut e);
        let b = add_raster(&mut e);
        let c = add_raster(&mut e);
        // stack bottom→top: a,b,c. Move a to top (index 2).
        apply(&mut e, "moveLayer", json!({"id": a, "to_index": 2}));
        let ids: Vec<u64> = describe(&mut e)["layers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["id"].as_u64().unwrap())
            .collect();
        assert_eq!(ids, vec![b, c, a]);
        // Move c to bottom.
        apply(&mut e, "moveLayer", json!({"id": c, "to_index": 0}));
        let ids: Vec<u64> = describe(&mut e)["layers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["id"].as_u64().unwrap())
            .collect();
        assert_eq!(ids, vec![c, b, a]);
    }

    #[test]
    fn move_layer_out_of_bounds_preserves_state() {
        let mut e = eng();
        let a = add_raster(&mut e);
        let before = describe(&mut e);
        let err = apply_err(&mut e, "moveLayer", json!({"id": a, "to_index": 5}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        let err = apply_err(&mut e, "moveLayer", json!({"id": a, "to_index": 1}));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn rename_layer() {
        let mut e = eng();
        let id = add_raster(&mut e);
        apply(&mut e, "renameLayer", json!({"id": id, "name": "hero"}));
        assert_eq!(
            apply(&mut e, "getLayer", json!({"id": id})).data["name"],
            "hero"
        );
        let err = apply_err(&mut e, "renameLayer", json!({"id": 99, "name": "x"}));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        let err = apply_err(&mut e, "renameLayer", json!({"id": id, "name": 5}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
    }

    #[test]
    fn set_layer_opacity() {
        let mut e = eng();
        let id = add_raster(&mut e);
        apply(&mut e, "setLayerOpacity", json!({"id": id, "opacity": 0.5}));
        assert_eq!(
            apply(&mut e, "getLayer", json!({"id": id})).data["opacity"],
            0.5
        );
        let before = describe(&mut e);
        for bad in [json!(-0.1), json!(1.5)] {
            let err = apply_err(
                &mut e,
                "setLayerOpacity",
                json!({"id": id, "opacity": bad}),
            );
            assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        }
        assert_eq!(describe(&mut e), before);
    }

    #[test]
    fn set_layer_visible() {
        let mut e = eng();
        let id = add_raster(&mut e);
        apply(&mut e, "setLayerVisible", json!({"id": id, "visible": false}));
        assert_eq!(
            apply(&mut e, "getLayer", json!({"id": id})).data["visible"],
            false
        );
        let err = apply_err(&mut e, "setLayerVisible", json!({"id": id, "visible": "no"}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
    }

    // -- drawPixels ---------------------------------------------------------

    #[test]
    fn draw_pixels_opaque() {
        let mut e = eng();
        let id = add_raster(&mut e);
        // 2x2 opaque red at (1,1).
        let data = vec![255u8, 0, 0, 255].repeat(4);
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 1, "y": 1, "w": 2, "h": 2,
                   "data_b64": b64::encode(&data)}),
        );
        let px = layer_pixels(&mut e, id);
        assert_eq!(pixel(&px, 4, 1, 1), [255, 0, 0, 255]);
        assert_eq!(pixel(&px, 4, 2, 2), [255, 0, 0, 255]);
        assert_eq!(pixel(&px, 4, 0, 0), [0, 0, 0, 0]);
        assert_eq!(pixel(&px, 4, 3, 3), [0, 0, 0, 0]);
    }

    #[test]
    fn draw_pixels_src_over_blend() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [0, 0, 255, 255]); // opaque blue
        // 1x1 alpha=128 red at (0,0): sa=128/255 → r = 255*sa = 128,
        // b = 255*(1-sa) = 127, a = 255.
        let data = vec![255u8, 0, 0, 128];
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 0, "y": 0, "w": 1, "h": 1,
                   "data_b64": b64::encode(&data)}),
        );
        let px = layer_pixels(&mut e, id);
        assert_eq!(pixel(&px, 4, 0, 0), [128, 0, 127, 255]);
        assert_eq!(pixel(&px, 4, 1, 0), [0, 0, 255, 255]); // untouched
    }

    #[test]
    fn draw_pixels_transparent_source_is_noop() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [10, 20, 30, 255]);
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 0, "y": 0, "w": 1, "h": 1,
                   "data_b64": b64::encode(&[9, 9, 9, 0])}),
        );
        assert_eq!(pixel(&layer_pixels(&mut e, id), 4, 0, 0), [10, 20, 30, 255]);
    }

    #[test]
    fn draw_pixels_clipped_negative_origin() {
        let mut e = eng();
        let id = add_raster(&mut e);
        // 2x2 red at (-1,-1) — only the bottom-right source pixel lands.
        let data = vec![255u8, 0, 0, 255].repeat(4);
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": -1, "y": -1, "w": 2, "h": 2,
                   "data_b64": b64::encode(&data)}),
        );
        let px = layer_pixels(&mut e, id);
        assert_eq!(pixel(&px, 4, 0, 0), [255, 0, 0, 255]);
        assert_eq!(pixel(&px, 4, 1, 0), [0, 0, 0, 0]);
        assert_eq!(pixel(&px, 4, 0, 1), [0, 0, 0, 0]);
    }

    #[test]
    fn draw_pixels_clipped_past_edge() {
        let mut e = eng();
        let id = add_raster(&mut e);
        // 4x2 green at (3,3) on a 4x4 canvas → only (3,3) receives src (0,0).
        let data = vec![0u8, 255, 0, 255].repeat(8);
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 3, "y": 3, "w": 4, "h": 2,
                   "data_b64": b64::encode(&data)}),
        );
        let px = layer_pixels(&mut e, id);
        assert_eq!(pixel(&px, 4, 3, 3), [0, 255, 0, 255]);
        assert_eq!(pixel(&px, 4, 2, 3), [0, 0, 0, 0]);
    }

    #[test]
    fn draw_pixels_fully_off_canvas_is_noop() {
        let mut e = eng();
        let id = add_raster(&mut e);
        let data = vec![255u8, 0, 0, 255].repeat(4);
        let r = apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 100, "y": 0, "w": 2, "h": 2,
                   "data_b64": b64::encode(&data)}),
        );
        assert_eq!(r.data["ok"], true);
        // A real draw afterwards, then a single undo, must revert the real
        // draw — proving the off-canvas call recorded no phantom entry.
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 0, "y": 0, "w": 1, "h": 1,
                   "data_b64": b64::encode(&data[0..4])}),
        );
        assert_eq!(pixel(&layer_pixels(&mut e, id), 4, 0, 0), [255, 0, 0, 255]);
        assert!(e.undo().unwrap());
        assert_eq!(pixel(&layer_pixels(&mut e, id), 4, 0, 0), [0, 0, 0, 0]);
        // Next undo removes the layer itself (addRasterLayer's entry).
        assert!(e.undo().unwrap());
        assert_eq!(describe(&mut e)["layers"].as_array().unwrap().len(), 0);
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn draw_pixels_errors_preserve_state() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [1, 2, 3, 255]);
        let sid = apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1,
                             "fill": [0, 0, 0, 255]}}),
        )
        .data["layer_id"]
        .as_u64()
        .unwrap();
        let before = describe(&mut e);

        // wrong data length
        let err = apply_err(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 0, "y": 0, "w": 2, "h": 2,
                   "data_b64": b64::encode(&[0u8; 8])}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // invalid base64
        let err = apply_err(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 0, "y": 0, "w": 1, "h": 1, "data_b64": "!!!"}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // shape layer
        let err = apply_err(
            &mut e,
            "drawPixels",
            json!({"id": sid, "x": 0, "y": 0, "w": 1, "h": 1,
                   "data_b64": b64::encode(&[0u8; 4])}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // missing layer
        let err = apply_err(
            &mut e,
            "drawPixels",
            json!({"id": 99, "x": 0, "y": 0, "w": 1, "h": 1,
                   "data_b64": b64::encode(&[0u8; 4])}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        // zero w
        let err = apply_err(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 0, "y": 0, "w": 0, "h": 1,
                   "data_b64": b64::encode(&[])}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // missing field
        let err = apply_err(&mut e, "drawPixels", json!({"id": id}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
        assert_eq!(describe(&mut e), before);
    }

    // -- fillLayer ----------------------------------------------------------

    #[test]
    fn fill_layer() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [7, 8, 9, 200]);
        let px = layer_pixels(&mut e, id);
        assert!(px.chunks_exact(4).all(|p| p == [7, 8, 9, 200]));
    }

    #[test]
    fn fill_layer_rejects_shape() {
        let mut e = eng();
        let sid = apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "ellipse", "x": 0, "y": 0, "w": 2, "h": 2,
                             "fill": [0, 0, 0, 255]}}),
        )
        .data["layer_id"]
        .as_u64()
        .unwrap();
        let err = apply_err(&mut e, "fillLayer", json!({"id": sid, "color": [0,0,0,255]}));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    // -- applyFilter --------------------------------------------------------

    #[test]
    fn filter_grayscale() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [100, 150, 200, 255]);
        apply(&mut e, "applyFilter", json!({"id": id, "filter": {"type": "grayscale"}}));
        // luma = 0.299*100 + 0.587*150 + 0.114*200 = 140.75 → 141
        let px = layer_pixels(&mut e, id);
        assert!(px.chunks_exact(4).all(|p| p == [141, 141, 141, 255]));
    }

    #[test]
    fn filter_invert() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [10, 20, 30, 128]);
        apply(&mut e, "applyFilter", json!({"id": id, "filter": {"type": "invert"}}));
        let px = layer_pixels(&mut e, id);
        assert!(px.chunks_exact(4).all(|p| p == [245, 235, 225, 128]));
    }

    #[test]
    fn filter_brightness() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [100, 200, 250, 255]);
        apply(
            &mut e,
            "applyFilter",
            json!({"id": id, "filter": {"type": "brightness", "amount": 0.5}}),
        );
        // +127.5 → round → +128, clamped at 255
        let px = layer_pixels(&mut e, id);
        assert!(px.chunks_exact(4).all(|p| p == [228, 255, 255, 255]));
        apply(
            &mut e,
            "applyFilter",
            json!({"id": id, "filter": {"type": "brightness", "amount": -1.0}}),
        );
        let px = layer_pixels(&mut e, id);
        assert!(px.chunks_exact(4).all(|p| p == [0, 0, 0, 255]));
    }

    #[test]
    fn filter_errors_preserve_state() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [10, 10, 10, 255]);
        let before = describe(&mut e);
        let err = apply_err(
            &mut e,
            "applyFilter",
            json!({"id": id, "filter": {"type": "sepia"}}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        let err = apply_err(
            &mut e,
            "applyFilter",
            json!({"id": id, "filter": {"type": "brightness", "amount": 2.0}}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        let err = apply_err(
            &mut e,
            "applyFilter",
            json!({"id": id, "filter": {"amount": 0.5}}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
        assert_eq!(describe(&mut e), before);
    }

    // -- flatten ------------------------------------------------------------

    #[test]
    fn flatten_empty_is_transparent() {
        let mut e = eng();
        let r = apply(&mut e, "flatten", json!({}));
        assert!(r.events.is_empty(), "flatten is read-only");
        assert_eq!(r.data["width"], 4);
        assert_eq!(r.data["height"], 4);
        let px = b64::decode(r.data["pixels_b64"].as_str().unwrap()).unwrap();
        assert_eq!(px, vec![0u8; 4 * 4 * 4]);
    }

    #[test]
    fn flatten_composites_with_opacity() {
        let mut e = eng();
        let bottom = add_raster(&mut e);
        fill(&mut e, bottom, [255, 0, 0, 255]); // opaque red
        let top = add_raster(&mut e);
        fill(&mut e, top, [0, 0, 255, 255]); // opaque blue
        apply(&mut e, "setLayerOpacity", json!({"id": top, "opacity": 0.5}));
        let px = flatten_pixels(&mut e);
        // blue at 50% over red → r=128, b=128, a=255
        assert!(px.chunks_exact(4).all(|p| p == [128, 0, 128, 255]));
    }

    #[test]
    fn flatten_skips_invisible() {
        let mut e = eng();
        let bottom = add_raster(&mut e);
        fill(&mut e, bottom, [255, 0, 0, 255]);
        let top = add_raster(&mut e);
        fill(&mut e, top, [0, 255, 0, 255]);
        apply(&mut e, "setLayerVisible", json!({"id": top, "visible": false}));
        let px = flatten_pixels(&mut e);
        assert!(px.chunks_exact(4).all(|p| p == [255, 0, 0, 255]));
    }

    #[test]
    fn flatten_rasterizes_rect() {
        let mut e = eng();
        apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 1, "y": 1, "w": 2, "h": 2,
                             "fill": [255, 0, 0, 255]}}),
        );
        let px = flatten_pixels(&mut e);
        for y in 0..4 {
            for x in 0..4 {
                let covered = (1..3).contains(&x) && (1..3).contains(&y);
                assert_eq!(
                    pixel(&px, 4, x, y),
                    if covered { [255, 0, 0, 255] } else { [0, 0, 0, 0] },
                    "pixel ({x},{y})"
                );
            }
        }
    }

    #[test]
    fn flatten_rasterizes_ellipse() {
        let mut e = eng();
        apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "ellipse", "x": 0, "y": 0, "w": 4, "h": 4,
                             "fill": [0, 255, 0, 255]}}),
        );
        let px = flatten_pixels(&mut e);
        // center= (2,2), rx=ry=2; pixel-center coverage → diamond of 12 px.
        let expected = [
            [false, true, true, false],
            [true, true, true, true],
            [true, true, true, true],
            [false, true, true, false],
        ];
        for y in 0..4 {
            for x in 0..4 {
                assert_eq!(
                    pixel(&px, 4, x, y),
                    if expected[y][x] { [0, 255, 0, 255] } else { [0, 0, 0, 0] },
                    "pixel ({x},{y})"
                );
            }
        }
    }

    #[test]
    fn flatten_shape_opacity_and_partial_alpha() {
        let mut e = eng();
        let sid = apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1,
                             "fill": [255, 0, 0, 128]}}),
        )
        .data["layer_id"]
        .as_u64()
        .unwrap();
        apply(&mut e, "setLayerOpacity", json!({"id": sid, "opacity": 0.5}));
        let px = flatten_pixels(&mut e);
        // src alpha 128 * 0.5 → ~0.251 → out alpha = 64 (0.25098*255)
        let p = pixel(&px, 4, 0, 0);
        assert_eq!(p[0], 255);
        assert_eq!(p[3], 64);
        assert_eq!(pixel(&px, 4, 1, 0), [0, 0, 0, 0]);
    }

    // -- getLayer / describe --------------------------------------------------

    #[test]
    fn get_layer_returns_object() {
        let mut e = eng();
        let id = add_raster(&mut e);
        let l = apply(&mut e, "getLayer", json!({"id": id})).data;
        assert_eq!(l["id"], id);
        assert_eq!(l["content"]["type"], "raster");
        let err = apply_err(&mut e, "getLayer", json!({"id": 42}));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
    }

    // -- protocol-level errors ------------------------------------------------

    #[test]
    fn unknown_op_is_invalid() {
        let mut e = eng();
        let err = apply_err(&mut e, "explode", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
    }

    #[test]
    fn unsupported_command_version() {
        let mut e = eng();
        let err = e
            .apply(Command {
                v: 2,
                op: "describe".into(),
                payload: json!({}),
                input: None, binary_output: false,
            })
            .unwrap_err();
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
    }

    #[test]
    fn mutating_ops_emit_document_changed() {
        let mut e = eng();
        let r = apply(&mut e, "addRasterLayer", json!({}));
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));
    }

    // -- resize ---------------------------------------------------------------

    #[test]
    fn resize_crops_and_pads() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [255, 0, 0, 255]);
        apply(&mut e, "resize", json!({"width": 2, "height": 2}));
        assert_eq!(layer_pixels(&mut e, id).len(), 2 * 2 * 4);
        assert!(flatten_pixels(&mut e)
            .chunks_exact(4)
            .all(|p| p == [255, 0, 0, 255]));
        // Grow back — new area is transparent, top-left 2x2 kept.
        apply(&mut e, "resize", json!({"width": 4, "height": 4}));
        let px = flatten_pixels(&mut e);
        assert_eq!(pixel(&px, 4, 0, 0), [255, 0, 0, 255]);
        assert_eq!(pixel(&px, 4, 1, 1), [255, 0, 0, 255]);
        assert_eq!(pixel(&px, 4, 2, 0), [0, 0, 0, 0]);
        assert_eq!(pixel(&px, 4, 0, 2), [0, 0, 0, 0]);
        assert_eq!(pixel(&px, 4, 3, 3), [0, 0, 0, 0]);
    }

    #[test]
    fn resize_keeps_shapes() {
        let mut e = eng();
        apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1,
                             "fill": [9, 9, 9, 255]}}),
        );
        apply(&mut e, "resize", json!({"width": 8, "height": 8}));
        let px = flatten_pixels(&mut e);
        assert_eq!(pixel(&px, 8, 0, 0), [9, 9, 9, 255]);
    }

    // -- undo / redo ----------------------------------------------------------

    #[test]
    fn undo_redo_add_layer() {
        let mut e = eng();
        let id = add_raster(&mut e);
        assert!(e.undo().unwrap());
        assert_eq!(describe(&mut e)["layers"].as_array().unwrap().len(), 0);
        assert!(e.redo().unwrap());
        let d = describe(&mut e);
        assert_eq!(d["layers"][0]["id"], id);
        assert_eq!(d["next_id"], 2);
    }

    #[test]
    fn undo_restores_drawn_region_only() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [255, 0, 0, 255]);
        let data = vec![0u8, 0, 255, 255].repeat(4);
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 1, "y": 1, "w": 2, "h": 2,
                   "data_b64": b64::encode(&data)}),
        );
        assert!(e.undo().unwrap());
        let px = layer_pixels(&mut e, id);
        assert!(px.chunks_exact(4).all(|p| p == [255, 0, 0, 255]));
        assert!(e.redo().unwrap());
        let px = layer_pixels(&mut e, id);
        assert_eq!(pixel(&px, 4, 1, 1), [0, 0, 255, 255]);
        assert_eq!(pixel(&px, 4, 2, 2), [0, 0, 255, 255]);
        assert_eq!(pixel(&px, 4, 0, 0), [255, 0, 0, 255]);
    }

    #[test]
    fn undo_fill_and_filter() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [1, 2, 3, 255]);
        fill(&mut e, id, [9, 9, 9, 255]);
        apply(&mut e, "applyFilter", json!({"id": id, "filter": {"type": "invert"}}));
        assert!(e.undo().unwrap()); // undo invert
        assert!(layer_pixels(&mut e, id)
            .chunks_exact(4)
            .all(|p| p == [9, 9, 9, 255]));
        assert!(e.undo().unwrap()); // undo second fill
        assert!(layer_pixels(&mut e, id)
            .chunks_exact(4)
            .all(|p| p == [1, 2, 3, 255]));
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert!(layer_pixels(&mut e, id)
            .chunks_exact(4)
            .all(|p| p == [246, 246, 246, 255]));
    }

    #[test]
    fn undo_remove_layer_restores_pixels() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [5, 6, 7, 255]);
        apply(&mut e, "removeLayer", json!({"id": id}));
        assert!(e.undo().unwrap());
        let px = layer_pixels(&mut e, id);
        assert!(px.chunks_exact(4).all(|p| p == [5, 6, 7, 255]));
    }

    #[test]
    fn undo_resize_restores_canvas() {
        let mut e = eng();
        let id = add_raster(&mut e);
        fill(&mut e, id, [255, 0, 0, 255]);
        apply(&mut e, "resize", json!({"width": 2, "height": 2}));
        assert!(e.undo().unwrap());
        let d = describe(&mut e);
        assert_eq!(d["width"], 4);
        assert_eq!(layer_pixels(&mut e, id).len(), 4 * 4 * 4);
    }

    #[test]
    fn undo_chain_and_redo_chain() {
        let mut e = eng();
        let a = add_raster(&mut e);
        let _b = add_raster(&mut e);
        apply(&mut e, "moveLayer", json!({"id": a, "to_index": 1}));
        apply(&mut e, "renameLayer", json!({"id": a, "name": "x"}));
        apply(&mut e, "setLayerOpacity", json!({"id": a, "opacity": 0.25}));
        let full = describe(&mut e);
        // 5 mutations recorded (add, add, move, rename, opacity).
        for _ in 0..5 {
            assert!(e.undo().unwrap());
        }
        assert!(!e.undo().unwrap());
        assert_eq!(describe(&mut e)["layers"].as_array().unwrap().len(), 0);
        for _ in 0..5 {
            assert!(e.redo().unwrap());
        }
        assert!(!e.redo().unwrap());
        assert_eq!(describe(&mut e), full);
    }

    #[test]
    fn new_mutation_clears_redo() {
        let mut e = eng();
        add_raster(&mut e);
        assert!(e.undo().unwrap());
        add_raster(&mut e); // new op clears redo
        assert!(!e.redo().unwrap());
    }

    #[test]
    fn undo_new_restores_prior_document() {
        let mut e = eng();
        let id = add_raster(&mut e);
        apply(&mut e, "new", json!({"width": 2, "height": 2}));
        assert_eq!(describe(&mut e)["layers"].as_array().unwrap().len(), 0);
        assert!(e.undo().unwrap());
        let d = describe(&mut e);
        assert_eq!(d["width"], 4);
        assert_eq!(d["layers"][0]["id"], id);
    }

    #[test]
    fn undo_on_empty_stack_is_false_not_error() {
        let mut e = eng();
        assert!(!e.undo().unwrap());
        assert!(!e.redo().unwrap());
    }

    // -- snapshot / restore ---------------------------------------------------

    #[test]
    fn snapshot_restore_round_trip() {
        let mut e = eng();
        let a = add_raster(&mut e);
        fill(&mut e, a, [255, 0, 0, 255]);
        let data = vec![0u8, 255, 0, 128].repeat(2);
        apply(
            &mut e,
            "drawPixels",
            json!({"id": a, "x": 0, "y": 0, "w": 2, "h": 1,
                   "data_b64": b64::encode(&data)}),
        );
        apply(
            &mut e,
            "addShape",
            json!({"shape": {"kind": "ellipse", "x": 1, "y": 1, "w": 2, "h": 2,
                             "fill": [0, 0, 255, 200]}, "name": "dot"}),
        );
        apply(&mut e, "setLayerOpacity", json!({"id": a, "opacity": 0.75}));
        let snap = e.snapshot().unwrap();
        let before = describe(&mut e);

        // Restore into the same engine.
        e.restore(&snap).unwrap();
        assert_eq!(describe(&mut e), before);
        // And into a differently-sized fresh engine.
        let mut other = PrismEngine::new(1, 1);
        other.restore(&snap).unwrap();
        assert_eq!(describe(&mut other), before);

        // Further mutation works after restore.
        let id = add_raster(&mut e);
        fill(&mut e, id, [1, 1, 1, 255]);
        assert_eq!(describe(&mut e)["layers"].as_array().unwrap().len(), 3);
        // Re-snapshot is still valid.
        let snap2 = e.snapshot().unwrap();
        let mut e2 = PrismEngine::new(4, 4);
        e2.restore(&snap2).unwrap();
        assert_eq!(describe(&mut e2), describe(&mut e));
    }

    #[test]
    fn restore_rejects_garbage() {
        let mut e = eng();
        let id = add_raster(&mut e);
        let before = describe(&mut e);
        for bad in [
            &b""[..],
            b"NFD",
            b"XXXX\x00\x00\x00\x00\x00",
            b"NFD1\x00\x03\x00\x00\x00ab", // truncated payload
            b"NFD1\x07\x00\x00\x00\x00",   // bad format tag
        ] {
            assert!(e.restore(bad).is_err(), "accepted garbage: {bad:?}");
        }
        // Well-formed envelope, bogus JSON.
        let bad_json = encode_envelope(b"{not json");
        assert!(e.restore(&bad_json).is_err());
        // Well-formed envelope, JSON of wrong shape.
        let wrong = encode_envelope(b"\"hello\"");
        assert!(e.restore(&wrong).is_err());
        // Well-formed envelope, pixel buffer length mismatch.
        let forged = encode_envelope(
            br#"{"width":2,"height":2,"next_id":1,"layers":[{"id":1,"name":"x","opacity":1.0,"visible":true,"content":{"type":"raster","pixels_b64":"AAAA"}}]}"#,
        );
        assert!(e.restore(&forged).is_err());
        // State untouched throughout.
        let d = describe(&mut e);
        assert_eq!(d, before);
        assert_eq!(d["layers"][0]["id"], id);
    }

    #[test]
    fn restore_clears_journal() {
        let mut e = eng();
        add_raster(&mut e);
        let snap = e.snapshot().unwrap();
        add_raster(&mut e);
        e.restore(&snap).unwrap();
        assert!(!e.undo().unwrap(), "journal must reset on restore");
        assert!(!e.redo().unwrap());
    }

    #[test]
    fn snapshot_survives_large_round_trip() {
        let mut e = PrismEngine::new(16, 16);
        let id = add_raster(&mut e);
        // draw a full-canvas gradient
        let mut data = vec![0u8; 16 * 16 * 4];
        for (i, px) in data.chunks_exact_mut(4).enumerate() {
            px[0] = (i % 256) as u8;
            px[1] = ((i * 7) % 256) as u8;
            px[2] = ((i * 13) % 256) as u8;
            px[3] = 255;
        }
        apply(
            &mut e,
            "drawPixels",
            json!({"id": id, "x": 0, "y": 0, "w": 16, "h": 16,
                   "data_b64": b64::encode(&data)}),
        );
        let snap = e.snapshot().unwrap();
        let mut e2 = PrismEngine::new(1, 1);
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&mut e2), describe(&mut e));
        assert_eq!(flatten_pixels(&mut e2), flatten_pixels(&mut e));
    }

    // -- atomicity across a mixed sequence ------------------------------------

    #[test]
    fn errors_mid_sequence_leave_everything_intact() {
        let mut e = eng();
        let a = add_raster(&mut e);
        fill(&mut e, a, [3, 3, 3, 255]);
        apply(&mut e, "setLayerOpacity", json!({"id": a, "opacity": 0.5}));
        let before = describe(&mut e);
        let undo_depth_before = {
            // count via successive undos is destructive; snapshot instead
            e.snapshot().unwrap()
        };
        // A spread of invalid commands.
        let _ = apply_err(&mut e, "setLayerOpacity", json!({"id": a, "opacity": 9}));
        let _ = apply_err(&mut e, "removeLayer", json!({"id": 123}));
        let _ = apply_err(&mut e, "moveLayer", json!({"id": a, "to_index": 9}));
        let _ = apply_err(&mut e, "renameLayer", json!({"id": a}));
        let _ = apply_err(&mut e, "fillLayer", json!({"id": a, "color": [1,2,3]}));
        let _ = apply_err(&mut e, "bogus", json!({}));
        assert_eq!(describe(&mut e), before);
        // Undo still walks the real history: opacity → fill → add.
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        assert!(!e.undo().unwrap());
        drop(undo_depth_before);
    }

    // -- document colors (C-01) -------------------------------------------

    #[test]
    fn set_colors_commits_records_and_undoes() {
        let mut e = eng();
        let r = apply(
            &mut e,
            "setColors",
            json!({"foreground": [10, 20, 30, 255]}),
        );
        assert!(r.events.iter().any(|ev| ev.kind == "document:changed"));
        let c = apply(&mut e, "getColors", json!({})).data;
        assert_eq!(c["foreground"], json!([10, 20, 30, 255]));
        assert_eq!(c["recent"], json!([[10, 20, 30, 255]]));
        assert_eq!(
            describe(&mut e)["colors"]["foreground"],
            json!([10, 20, 30, 255])
        );
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "getColors", json!({})).data["foreground"],
            json!([0, 0, 0, 255])
        );
        assert!(e.redo().unwrap());
        assert_eq!(
            apply(&mut e, "getColors", json!({})).data["foreground"],
            json!([10, 20, 30, 255])
        );
    }

    #[test]
    fn set_colors_is_atomic_on_bad_channel() {
        let mut e = eng();
        let before = apply(&mut e, "getColors", json!({})).data;
        let err = apply_err(
            &mut e,
            "setColors",
            json!({"foreground": [1, 2, 3, 255], "background": [1, 2, 300, 255]}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(apply(&mut e, "getColors", json!({})).data, before);
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn set_colors_requires_a_color_and_unchanged_commit_records_nothing() {
        let mut e = eng();
        let err = apply_err(&mut e, "setColors", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
        let r = apply(
            &mut e,
            "setColors",
            json!({"foreground": [0, 0, 0, 255], "remember": false}),
        );
        assert_eq!(r.data["changed"], json!(false));
        assert!(r.events.is_empty());
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn swap_and_clear_recent_are_single_undo_steps() {
        let mut e = eng();
        apply(&mut e, "setColors", json!({"background": [9, 9, 9, 255]}));
        apply(&mut e, "swapColors", json!({}));
        let c = apply(&mut e, "getColors", json!({})).data;
        assert_eq!(c["foreground"], json!([9, 9, 9, 255]));
        assert_eq!(c["background"], json!([0, 0, 0, 255]));
        apply(&mut e, "clearRecentColors", json!({}));
        assert_eq!(
            apply(&mut e, "getColors", json!({})).data["recent"],
            json!([])
        );
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "getColors", json!({})).data["recent"],
            json!([[9, 9, 9, 255]])
        );
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "getColors", json!({})).data["foreground"],
            json!([0, 0, 0, 255])
        );
    }

    #[test]
    fn colors_survive_snapshot_and_old_snapshots_get_defaults() {
        let mut e = eng();
        apply(&mut e, "setColors", json!({"foreground": [1, 2, 3, 4]}));
        let bytes = e.snapshot().unwrap();
        let mut f = eng();
        f.restore(&bytes).unwrap();
        assert_eq!(
            apply(&mut f, "getColors", json!({})).data["foreground"],
            json!([1, 2, 3, 4])
        );

        let legacy = encode_envelope(br#"{"width":2,"height":2,"next_id":1,"layers":[]}"#);
        let mut g = eng();
        g.restore(&legacy).unwrap();
        let c = apply(&mut g, "getColors", json!({})).data;
        assert_eq!(c["foreground"], json!([0, 0, 0, 255]));
        assert_eq!(c["background"], json!([255, 255, 255, 255]));
    }
}
