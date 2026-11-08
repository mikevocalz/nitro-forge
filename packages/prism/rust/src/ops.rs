//! Canvas/layers op surface added for the B cluster: transforms, object
//! and pixel selection, groups, lock, blend, clipping, masks, thumbnails,
//! artboards, vector paths, booleans and region fill.
//!
//! Every mutating op parses and validates its whole payload, then records
//! exactly one undo entry, then mutates. A failed op leaves the document and
//! journal untouched.

use std::collections::HashSet;
use std::sync::Arc;

use ignition_core::{CommandResult, EngineError};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::b64;
use crate::geom::{Affine, Rect};
use crate::model::{
    Artboard, BlendMode, BoolOp, Content, FillRule, Layer, Mask, Node, NodeKind, Paint, PaintOrder, PathData,
    Stroke, Subpath, Transform, MAX_COORD,
};
use crate::raster;
use crate::render::{self, Scene};
use crate::select::{self, Combine, Region};
use crate::stroke;
use crate::vector;
use crate::{PrismEngine, RenderTask, UndoEntry, MAX_PIXELS, CHECKPOINT_EVERY_PX};

const MAX_RADIUS: f64 = 250.0;

/// Linear-part tolerance for the `crop` raster-transform check: affine
/// coefficients within this of the identity count as untransformed.
const CROP_RASTER_LINEAR_EPS: f64 = 1e-9;

/// Crop/pad a `w*h` alpha buffer, top-left aligned.
pub(crate) fn resize_alpha(buf: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<u8> {
    let mut out = vec![0u8; dw * dh];
    for r in 0..sh.min(dh) {
        let n = sw.min(dw);
        if (r + 1) * sw <= buf.len() {
            out[r * dw..r * dw + n].copy_from_slice(&buf[r * sw..r * sw + n]);
        }
    }
    out
}

/// Crop a `sw*sh` alpha buffer to `(dx, dy, dw, dh)`, zero outside.
/// Checkpoints every `CHECKPOINT_EVERY_PX` rows when `task` has a context.
pub(crate) fn crop_alpha(
    buf: &[u8],
    sw: usize,
    sh: usize,
    dx: i64,
    dy: i64,
    dw: usize,
    dh: usize,
    task: &mut RenderTask,
) -> Result<Vec<u8>, EngineError> {
    let mut out = vec![0u8; dw.saturating_mul(dh)];
    for r in 0..dh as i64 {
        task.tick(r as usize, CHECKPOINT_EVERY_PX, r as f32 / dh.max(1) as f32)?;
        let sy = dy + r;
        if sy < 0 || sy >= sh as i64 {
            continue;
        }
        for c in 0..dw as i64 {
            let sx = dx + c;
            if sx < 0 || sx >= sw as i64 {
                continue;
            }
            let s = sy as usize * sw + sx as usize;
            if s < buf.len() {
                out[r as usize * dw + c as usize] = buf[s];
            }
        }
    }
    Ok(out)
}

/// Translate the coordinate fields of a gradient paint; solids are untouched.
fn shift_paint(p: &mut Paint, sx: f64, sy: f64) {
    match p {
        Paint::Solid { .. } => {}
        Paint::Linear { x0, y0, x1, y1, .. } => {
            *x0 -= sx;
            *y0 -= sy;
            *x1 -= sx;
            *y1 -= sy;
        }
        Paint::Radial { cx, cy, fx, fy, .. } => {
            *cx -= sx;
            *cy -= sy;
            if let (Some(fx), Some(fy)) = (fx, fy) {
                *fx -= sx;
                *fy -= sy;
            }
        }
    }
}

/// Snapshot tree invariants: unique ids, parents exist and are containers,
/// boolean children are vector layers, no cycles.
pub(crate) fn validate_tree(layers: &[Layer]) -> Result<(), EngineError> {
    let bad = |m: &str| EngineError::serialization(format!("layer tree: {m}"));
    let mut ids = HashSet::new();
    for l in layers {
        if !ids.insert(l.id) {
            return Err(bad("duplicate layer id"));
        }
    }
    for l in layers {
        let mut p = l.parent;
        let mut steps = 0;
        while let Some(pid) = p {
            steps += 1;
            if steps > layers.len() || pid == l.id {
                return Err(bad("cycle"));
            }
            let Some(parent) = layers.iter().find(|x| x.id == pid) else {
                return Err(bad("missing parent"));
            };
            if steps == 1 {
                match parent.content {
                    Content::Group => {}
                    Content::Boolean { .. } if l.is_vector() => {}
                    _ => return Err(bad("parent is not a container")),
                }
            }
            p = parent.parent;
        }
    }
    Ok(())
}

fn finite(v: f64) -> bool {
    v.is_finite() && v.abs() <= MAX_COORD
}

/// Decompose a skew-free affine into a Transform with pivot (0,0).
fn decompose(m: &Affine) -> Option<Transform> {
    let sx = m.a.hypot(m.b);
    if sx < 1e-9 {
        return None;
    }
    let sy = m.det() / sx;
    if sy.abs() < 1e-9 || (m.a * m.c + m.b * m.d).abs() / (sx * sy.abs()) > 1e-6 {
        return None;
    }
    let t = Transform {
        tx: m.e,
        ty: m.f,
        sx,
        sy,
        rotation: m.b.atan2(m.a).to_degrees(),
        ox: 0.0,
        oy: 0.0,
    };
    t.validate().ok().map(|_| t)
}

fn ok() -> Result<CommandResult, EngineError> {
    Ok(CommandResult::data(json!({ "ok": true })))
}

fn read(data: Value) -> Result<CommandResult, EngineError> {
    Ok(CommandResult { output: None, events: Vec::new(), data })
}

fn parse<T: DeserializeOwned>(v: &Value, what: &str) -> Result<T, EngineError> {
    serde_json::from_value(v.clone()).map_err(|e| EngineError::invalid(format!("{what}: {e}")))
}

fn req_str<'a>(p: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    PrismEngine::field(p, key)?
        .as_str()
        .ok_or_else(|| EngineError::invalid(format!("field '{key}' must be a string")))
}

fn opt_f64(p: &Value, key: &str) -> Result<Option<f64>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_f64()
            .map(Some)
            .ok_or_else(|| EngineError::invalid(format!("field '{key}' must be a number"))),
    }
}

fn req_coord(p: &Value, key: &str) -> Result<f64, EngineError> {
    let v = PrismEngine::req_f64(p, key)?;
    if !finite(v) {
        return Err(EngineError::validation(format!("{key} must be finite")));
    }
    Ok(v)
}

fn req_index(p: &Value, key: &str) -> Result<usize, EngineError> {
    usize::try_from(PrismEngine::req_u64(p, key)?).map_err(|_| EngineError::out_of_bounds(format!("{key} too large")))
}

fn req_radius(p: &Value, key: &str, min: f64) -> Result<f64, EngineError> {
    let v = opt_f64(p, key)?.unwrap_or(0.0);
    if !v.is_finite() || v < min || v > MAX_RADIUS {
        return Err(EngineError::validation(format!("{key} must be in {min}..={MAX_RADIUS}")));
    }
    Ok(v)
}

fn req_ids(p: &Value, key: &str) -> Result<Vec<u64>, EngineError> {
    let arr = PrismEngine::field(p, key)?
        .as_array()
        .ok_or_else(|| EngineError::invalid(format!("field '{key}' must be an array")))?;
    let mut out = Vec::with_capacity(arr.len());
    let mut seen = HashSet::new();
    for v in arr {
        let id = v.as_u64().ok_or_else(|| EngineError::invalid(format!("'{key}' entries must be u64")))?;
        if !seen.insert(id) {
            return Err(EngineError::validation(format!("duplicate id {id} in '{key}'")));
        }
        out.push(id);
    }
    Ok(out)
}

fn req_max(p: &Value) -> Result<usize, EngineError> {
    let m = PrismEngine::req_u64(p, "max")?;
    if !(1..=1024).contains(&m) {
        return Err(EngineError::validation("max must be in 1..=1024"));
    }
    Ok(m as usize)
}

fn req_tolerance(p: &Value) -> Result<u8, EngineError> {
    let t = match p.get("tolerance") {
        None => 32,
        Some(v) => v.as_u64().ok_or_else(|| EngineError::invalid("tolerance must be an integer"))?,
    };
    u8::try_from(t).map_err(|_| EngineError::validation("tolerance must be in 0..=255"))
}

fn opt_bool(p: &Value, key: &str, default: bool) -> Result<bool, EngineError> {
    match p.get(key) {
        None => Ok(default),
        Some(v) => v.as_bool().ok_or_else(|| EngineError::invalid(format!("field '{key}' must be a bool"))),
    }
}

fn combine_mode(p: &Value) -> Result<Combine, EngineError> {
    match p.get("mode") {
        None => Ok(Combine::Replace),
        Some(v) => {
            let s = v.as_str().ok_or_else(|| EngineError::invalid("mode must be a string"))?;
            Combine::parse(s).ok_or_else(|| EngineError::validation(format!("unknown selection mode '{s}'")))
        }
    }
}

fn thumb(
    px: &[u8],
    w: usize,
    h: usize,
    max: usize,
    task: &mut RenderTask,
) -> Result<CommandResult, EngineError> {
    let (out, tw, th) = render::fit(px, w, h, max, task)?;
    read(json!({ "width": tw, "height": th, "pixels_b64": b64::encode(&out) }))
}

impl PrismEngine {
    pub(crate) fn scene(&self) -> Scene<'_> {
        Scene { layers: &self.layers, w: self.width as usize, h: self.height as usize }
    }

    fn record(&mut self) {
        self.journal.record(UndoEntry::Doc(self.capture()));
    }

    /// `Validation` when the layer or any ancestor is locked.
    pub(crate) fn ensure_unlocked(&self, idx: usize) -> Result<(), EngineError> {
        let mut cur = Some(&self.layers[idx]);
        let mut steps = 0;
        while let Some(l) = cur {
            if l.locked {
                return Err(EngineError::validation(if l.id == self.layers[idx].id {
                    format!("layer {} is locked", l.id)
                } else {
                    format!("layer {} is inside locked group {}", self.layers[idx].id, l.id)
                }));
            }
            steps += 1;
            if steps > self.layers.len() {
                break;
            }
            cur = l.parent.and_then(|p| self.layers.iter().find(|x| x.id == p));
        }
        Ok(())
    }

    /// `id` plus every descendant id.
    pub(crate) fn subtree_ids(&self, id: u64) -> HashSet<u64> {
        let mut out = HashSet::from([id]);
        loop {
            let before = out.len();
            for l in &self.layers {
                if l.parent.is_some_and(|p| out.contains(&p)) {
                    out.insert(l.id);
                }
            }
            if out.len() == before {
                return out;
            }
        }
    }

    fn is_ancestor(&self, ancestor: u64, id: u64) -> bool {
        let mut p = self.layers.iter().find(|l| l.id == id).and_then(|l| l.parent);
        let mut steps = 0;
        while let Some(pid) = p {
            if pid == ancestor {
                return true;
            }
            steps += 1;
            if steps > self.layers.len() {
                return false;
            }
            p = self.layers.iter().find(|l| l.id == pid).and_then(|l| l.parent);
        }
        false
    }

    fn indices(&self, ids: &[u64]) -> Result<Vec<usize>, EngineError> {
        ids.iter().map(|&id| self.layer_index(id)).collect()
    }

    fn require_selection(&self) -> Result<&Arc<Vec<u8>>, EngineError> {
        self.selection.as_ref().ok_or_else(|| EngineError::validation("nothing is selected"))
    }

    fn set_selection(&mut self, mask: Vec<u8>) {
        self.selection = if select::is_empty(&mask) { None } else { Some(Arc::new(mask)) };
    }

    fn canvas_point(&self, p: &Value) -> Result<(usize, usize), EngineError> {
        let x = req_coord(p, "x")?;
        let y = req_coord(p, "y")?;
        if x < 0.0 || y < 0.0 || x >= self.width as f64 || y >= self.height as f64 {
            return Err(EngineError::out_of_bounds(format!("point ({x}, {y}) is outside the canvas")));
        }
        Ok((x as usize, y as usize))
    }

    /// Canvas-space bounds or a `Validation` naming the empty layer.
    fn bounds_of(&self, idx: usize) -> Result<Rect, EngineError> {
        self.scene()
            .bounds(&self.layers[idx])
            .map(|(_, r)| r)
            .ok_or_else(|| EngineError::validation(format!("layer {} has no content", self.layers[idx].id)))
    }

    /// Move a layer by a canvas-space delta, converting through its
    /// ancestors' transforms.
    fn translated_transform(&self, idx: usize, dx: f64, dy: f64) -> Result<Transform, EngineError> {
        let parent = self.scene().parent_affine(&self.layers[idx]);
        let inverse = parent.invert().ok_or_else(|| EngineError::validation("ancestor transform cannot be inverted"))?;
        let (lx, ly) = inverse.apply_vec(dx, dy);
        let mut next = self.layers[idx].transform;
        next.tx += lx;
        next.ty += ly;
        next.validate()?;
        Ok(next)
    }

    pub(crate) fn apply_v2(
        &mut self,
        op: &str,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        match op {
            "setLayerTransform" => self.op_set_layer_transform(p),
            "translateLayers" => self.op_translate_layers(p),
            "setTransformOrigin" => self.op_set_transform_origin(p),
            "layerBounds" => self.op_layer_bounds(p),
            "hitTest" => self.op_hit_test(p),
            "alignLayers" => self.op_align_layers(p),
            "distributeLayers" => self.op_distribute_layers(p),
            "selectLayers" => self.op_select_layers(p),
            "selectRegion" => self.op_select_region(p, ctx),
            "selectAll" => self.op_select_all(),
            "deselect" => self.op_deselect(),
            "invertSelection" => self.op_invert_selection(),
            "magicWand" => self.op_magic_wand(p, ctx),
            "modifySelection" => self.op_modify_selection(p, ctx),
            "getSelection" => self.op_get_selection(),
            "groupLayers" => self.op_group_layers(p),
            "ungroupLayer" => self.op_ungroup_layer(p),
            "duplicateLayer" => self.op_duplicate_layer(p),
            "setLayerParent" => self.op_set_layer_parent(p),
            "setLayerLocked" => self.op_set_layer_locked(p),
            "setLayerBlend" => self.op_set_layer_blend(p),
            "setClipped" => self.op_set_clipped(p),
            "layerThumbnail" => self.op_layer_thumbnail(p, ctx),
            "renderRegion" => self.op_render_region(p, ctx),
            "addMask" => self.op_add_mask(p),
            "removeMask" => self.op_remove_mask(p),
            "setMaskEnabled" => self.op_set_mask_enabled(p),
            "invertMask" => self.op_invert_mask(p),
            "paintMask" => self.op_paint_mask(p, ctx),
            "refineMask" => self.op_refine_mask(p, ctx),
            "maskThumbnail" => self.op_mask_thumbnail(p, ctx),
            "addArtboard" => self.op_add_artboard(p),
            "removeArtboard" => self.op_remove_artboard(p),
            "updateArtboard" => self.op_update_artboard(p),
            "moveArtboard" => self.op_move_artboard(p),
            "artboardThumbnail" => self.op_artboard_thumbnail(p, ctx),
            "addPath" => self.op_add_path(p),
            "setPathNodes" => self.op_set_path_nodes(p),
            "setPathNode" => self.op_set_path_node(p),
            "insertPathNode" => self.op_insert_path_node(p),
            "removePathNode" => self.op_remove_path_node(p),
            "setNodeKind" => self.op_set_node_kind(p),
            "setSubpathClosed" => self.op_set_subpath_closed(p),
            "setFill" => self.op_set_fill(p),
            "setStroke" => self.op_set_stroke(p),
            "setFillRule" => self.op_set_fill_rule(p),
            "setPaintOrder" => self.op_set_paint_order(p),
            "convertToPath" => self.op_convert_to_path(p),
            "booleanLayers" => self.op_boolean_layers(p),
            "setBooleanOp" => self.op_set_boolean_op(p),
            "rasterizeLayer" => self.op_rasterize_layer(p, ctx),
            "floodFill" => self.op_flood_fill(p, ctx),
            "crop" => self.op_crop(p, ctx),
            "samplePixels" => self.op_sample_pixels(p, ctx),
            "modelStroke" => self.op_model_stroke(p, ctx),
            "addBrush" => self.op_add_brush(p),
            "setBrush" => self.op_set_brush(p),
            "removeBrush" => self.op_remove_brush(p),
            "listBrushes" => self.op_list_brushes(),
            "paintStroke" => self.op_paint_stroke(p, ctx),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    // -- transform ----------------------------------------------------------

    fn op_set_layer_transform(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let t = Self::field(p, "transform")?;
        if !t.is_object() {
            return Err(EngineError::invalid("transform must be an object"));
        }
        let mut nt = self.layers[idx].transform;
        for (key, slot) in [
            ("tx", &mut nt.tx),
            ("ty", &mut nt.ty),
            ("sx", &mut nt.sx),
            ("sy", &mut nt.sy),
            ("rotation", &mut nt.rotation),
        ] {
            if let Some(v) = opt_f64(t, key)? {
                *slot = v;
            }
        }
        nt.validate()?;
        self.ensure_unlocked(idx)?;
        self.record();
        self.layers[idx].transform = nt;
        ok()
    }

    fn op_translate_layers(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let ids = req_ids(p, "ids")?;
        if ids.is_empty() {
            return Err(EngineError::validation("ids must not be empty"));
        }
        let dx = req_coord(p, "dx")?;
        let dy = req_coord(p, "dy")?;
        let idxs = self.indices(&ids)?;
        for &i in &idxs {
            self.ensure_unlocked(i)?;
        }
        // A layer whose ancestor also moves is carried by that ancestor.
        let moving: Vec<usize> = idxs
            .into_iter()
            .filter(|&i| !ids.iter().any(|&a| self.is_ancestor(a, self.layers[i].id)))
            .collect();
        let staged = moving.into_iter().map(|i| self.translated_transform(i, dx, dy).map(|t| (i, t)))
            .collect::<Result<Vec<_>, _>>()?;
        self.record();
        for (i, transform) in staged {
            self.layers[i].transform = transform;
        }
        ok()
    }

    fn op_set_transform_origin(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let ox = req_coord(p, "ox")?;
        let oy = req_coord(p, "oy")?;
        self.ensure_unlocked(idx)?;
        let t = self.layers[idx].transform;
        let a = t.affine();
        // Keep the rendered result fixed: t' = t + (I - A)(o - o').
        let (dx, dy) = (t.ox - ox, t.oy - oy);
        let (ax, ay) = a.apply_vec(dx, dy);
        let nt = Transform { tx: t.tx + dx - ax, ty: t.ty + dy - ay, ox, oy, ..t };
        nt.validate()?;
        self.record();
        self.layers[idx].transform = nt;
        ok()
    }

    fn op_layer_bounds(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let idxs = match p.get("ids") {
            None | Some(Value::Null) => (0..self.layers.len()).collect(),
            Some(_) => self.indices(&req_ids(p, "ids")?)?,
        };
        let scene = self.scene();
        let list: Vec<Value> = idxs
            .into_iter()
            .map(|i| {
                let l = &self.layers[i];
                match scene.bounds(l) {
                    None => json!({ "id": l.id, "empty": true }),
                    Some((c, r)) => json!({
                        "id": l.id, "x": r.x, "y": r.y, "w": r.w, "h": r.h,
                        "corners": c.iter().map(|(x, y)| json!([x, y])).collect::<Vec<_>>(),
                    }),
                }
            })
            .collect();
        read(json!({ "bounds": list }))
    }

    fn op_hit_test(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let x = req_coord(p, "x")?;
        let y = req_coord(p, "y")?;
        let scene = self.scene();
        let mut parent: Option<u64> = None;
        let mut base = Affine::IDENTITY;
        let mut top: Option<u64> = None;
        let mut leaf: Option<u64> = None;
        loop {
            let kids: Vec<&Layer> = scene.children(parent).collect();
            let hit = kids.into_iter().rev().find(|l| scene.alpha_at(l, &base, x, y) > 0);
            let Some(l) = hit else { break };
            if top.is_none() {
                top = Some(l.id);
            }
            leaf = Some(l.id);
            if matches!(l.content, Content::Group) {
                base = base.then_after(&l.transform.affine());
                parent = Some(l.id);
            } else {
                break;
            }
        }
        read(json!({ "layer_id": leaf, "top_level_id": top }))
    }

    fn op_align_layers(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let ids = req_ids(p, "ids")?;
        let align = req_str(p, "align")?;
        if !["left", "hcenter", "right", "top", "vcenter", "bottom"].contains(&align) {
            return Err(EngineError::validation(format!("unknown align '{align}'")));
        }
        let idxs = self.indices(&ids)?;
        if idxs.is_empty() {
            return Err(EngineError::validation("ids must not be empty"));
        }
        let rects: Vec<Rect> = idxs.iter().map(|&i| self.bounds_of(i)).collect::<Result<_, _>>()?;
        let target = match p.get("to") {
            None => Value::String("selection".into()),
            Some(v) => v.clone(),
        };
        let to = if target.as_str() == Some("selection") {
            if rects.len() < 2 {
                return Err(EngineError::validation("aligning to the selection needs at least two layers"));
            }
            rects.iter().skip(1).fold(rects[0], |a, r| a.union(r))
        } else if target.as_str() == Some("canvas") {
            Rect { x: 0.0, y: 0.0, w: self.width as f64, h: self.height as f64 }
        } else if let Some(aid) = target.get("artboard").and_then(Value::as_u64) {
            let a = self
                .artboards
                .iter()
                .find(|a| a.id == aid)
                .ok_or_else(|| EngineError::not_found(format!("artboard {aid} not found")))?;
            Rect { x: a.x, y: a.y, w: a.w, h: a.h }
        } else {
            return Err(EngineError::validation("to must be \"selection\", \"canvas\" or {\"artboard\": id}"));
        };
        for &i in &idxs {
            self.ensure_unlocked(i)?;
        }
        let mut staged = Vec::with_capacity(idxs.len());
        for (&i, r) in idxs.iter().zip(&rects) {
            let (dx, dy) = match align {
                "left" => (to.x - r.x, 0.0),
                "hcenter" => (to.x + to.w / 2.0 - (r.x + r.w / 2.0), 0.0),
                "right" => (to.right() - r.right(), 0.0),
                "top" => (0.0, to.y - r.y),
                "vcenter" => (0.0, to.y + to.h / 2.0 - (r.y + r.h / 2.0)),
                _ => (0.0, to.bottom() - r.bottom()),
            };
            staged.push((i, self.translated_transform(i, dx, dy)?));
        }
        self.record();
        for (i, transform) in staged {
            self.layers[i].transform = transform;
        }
        ok()
    }

    fn op_distribute_layers(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let ids = req_ids(p, "ids")?;
        let horizontal = match req_str(p, "axis")? {
            "horizontal" => true,
            "vertical" => false,
            other => return Err(EngineError::validation(format!("unknown axis '{other}'"))),
        };
        let centers = match p.get("mode").and_then(Value::as_str).unwrap_or("spacing") {
            "centers" => true,
            "spacing" => false,
            other => return Err(EngineError::validation(format!("unknown distribute mode '{other}'"))),
        };
        let spacing = opt_f64(p, "spacing")?;
        if spacing.is_some_and(|s| !finite(s)) {
            return Err(EngineError::validation("spacing must be finite"));
        }
        if ids.len() < 3 && spacing.is_none() {
            return Err(EngineError::validation("distributing needs at least three layers"));
        }
        if ids.len() < 2 {
            return Err(EngineError::validation("distributing needs at least two layers"));
        }
        let idxs = self.indices(&ids)?;
        let mut items: Vec<(usize, f64, f64)> = idxs
            .iter()
            .map(|&i| {
                self.bounds_of(i).map(|r| if horizontal { (i, r.x, r.w) } else { (i, r.y, r.h) })
            })
            .collect::<Result<_, _>>()?;
        for &i in &idxs {
            self.ensure_unlocked(i)?;
        }
        items.sort_by(|a, b| (a.1 + a.2 / 2.0).total_cmp(&(b.1 + b.2 / 2.0)));
        let n = items.len();
        let mut targets = Vec::with_capacity(n);
        if centers && spacing.is_none() {
            let c0 = items[0].1 + items[0].2 / 2.0;
            let c1 = items[n - 1].1 + items[n - 1].2 / 2.0;
            for (k, it) in items.iter().enumerate() {
                targets.push(c0 + (c1 - c0) * k as f64 / (n - 1) as f64 - it.2 / 2.0);
            }
        } else {
            let gap = spacing.unwrap_or_else(|| {
                let span = items[n - 1].1 + items[n - 1].2 - items[0].1;
                let total: f64 = items.iter().map(|i| i.2).sum();
                (span - total) / (n - 1) as f64
            });
            let mut at = items[0].1;
            for it in &items {
                targets.push(at);
                at += it.2 + gap;
            }
        }
        let mut staged = Vec::with_capacity(items.len());
        for (it, t) in items.iter().zip(targets) {
            let d = t - it.1;
            let transform = if horizontal {
                self.translated_transform(it.0, d, 0.0)?
            } else {
                self.translated_transform(it.0, 0.0, d)?
            };
            staged.push((it.0, transform));
        }
        self.record();
        for (i, transform) in staged {
            self.layers[i].transform = transform;
        }
        ok()
    }

    // -- selection ----------------------------------------------------------

    fn op_select_layers(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let ids = req_ids(p, "ids")?;
        self.indices(&ids)?;
        let mode = p.get("mode").and_then(Value::as_str).unwrap_or("replace");
        let mut next = self.selected.clone();
        match mode {
            "replace" => next = ids,
            "add" => next.extend(ids.into_iter().filter(|i| !self.selected.contains(i))),
            "remove" => next.retain(|i| !ids.contains(i)),
            "toggle" => {
                for id in ids {
                    if let Some(pos) = next.iter().position(|&x| x == id) {
                        next.remove(pos);
                    } else {
                        next.push(id);
                    }
                }
            }
            other => return Err(EngineError::validation(format!("unknown selection mode '{other}'"))),
        }
        self.record();
        self.selected = next;
        ok()
    }

    fn parse_region(v: &Value) -> Result<Region, EngineError> {
        let kind = req_str(v, "kind")?;
        match kind {
            "rect" | "ellipse" => {
                let (x, y, w, h) = (req_coord(v, "x")?, req_coord(v, "y")?, req_coord(v, "w")?, req_coord(v, "h")?);
                if w <= 0.0 || h <= 0.0 {
                    return Err(EngineError::validation("region w/h must be positive"));
                }
                Ok(if kind == "rect" { Region::Rect { x, y, w, h } } else { Region::Ellipse { x, y, w, h } })
            }
            "polygon" => {
                let pts: Vec<[f64; 2]> = parse(Self::field(v, "points")?, "points")?;
                if pts.len() < 3 {
                    return Err(EngineError::validation("a polygon needs at least three points"));
                }
                if pts.len() > 100_000 {
                    return Err(EngineError::validation("polygon has too many points"));
                }
                if pts.iter().any(|p| !finite(p[0]) || !finite(p[1])) {
                    return Err(EngineError::validation("polygon points must be finite"));
                }
                Ok(Region::Polygon(pts.into_iter().map(|p| (p[0], p[1])).collect()))
            }
            other => Err(EngineError::validation(format!("unknown region kind '{other}'"))),
        }
    }

    fn op_select_region(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let region = Self::parse_region(Self::field(p, "shape")?)?;
        let mode = combine_mode(p)?;
        let feather = req_radius(p, "feather", 0.0)?;
        let (w, h) = (self.width as usize, self.height as usize);
        // Units: rasterize, feather, combine — all computed before the
        // selection is committed, so cancellation leaves state untouched.
        let mut task = RenderTask::new(ctx, 3);
        let mut mask = select::rasterize(&region, w, h, &mut task)?;
        task.step_done();
        mask = select::feather(&mask, w, h, feather, &mut task)?;
        task.step_done();
        let next = select::combine(self.selection.as_deref().map(|v| v.as_slice()), &mask, mode, &mut task)?;
        self.record();
        self.set_selection(next);
        ok()
    }

    fn op_select_all(&mut self) -> Result<CommandResult, EngineError> {
        self.record();
        self.set_selection(vec![255u8; self.width as usize * self.height as usize]);
        ok()
    }

    fn op_deselect(&mut self) -> Result<CommandResult, EngineError> {
        if self.selection.is_none() {
            return read(json!({ "ok": true }));
        }
        self.record();
        self.selection = None;
        ok()
    }

    fn op_invert_selection(&mut self) -> Result<CommandResult, EngineError> {
        let n = self.width as usize * self.height as usize;
        let next: Vec<u8> = match &self.selection {
            None => vec![255u8; n],
            Some(s) => s.iter().map(|v| 255 - v).collect(),
        };
        self.record();
        self.set_selection(next);
        ok()
    }

    /// Render units a `sample_buffer` call will consume: a composite sample
    /// flattens the whole scene, a layer sample renders that subtree.
    fn sample_units(&self, p: &Value, default_layer: Option<usize>) -> Result<u64, EngineError> {
        let which = p.get("sample");
        let layer_idx = match which {
            None => default_layer,
            Some(Value::String(s)) if s == "composite" => None,
            Some(Value::String(s)) if s == "layer" => {
                Some(default_layer.ok_or_else(|| EngineError::validation("sample \"layer\" needs a target layer"))?)
            }
            Some(v) => match v.get("layer").and_then(Value::as_u64) {
                Some(id) => Some(self.layer_index(id)?),
                None => return Err(EngineError::validation("sample must be \"composite\", \"layer\" or {\"layer\": id}")),
            },
        };
        Ok(match layer_idx {
            None => self.layers.len() as u64,
            Some(i) => self.subtree_ids(self.layers[i].id).len() as u64,
        })
    }

    /// RGBA sample buffer for magic wand / flood fill.
    fn sample_buffer(
        &self,
        p: &Value,
        default_layer: Option<usize>,
        task: &mut RenderTask,
    ) -> Result<Vec<u8>, EngineError> {
        let scene = self.scene();
        let which = p.get("sample");
        let layer_idx = match which {
            None => default_layer,
            Some(Value::String(s)) if s == "composite" => None,
            Some(Value::String(s)) if s == "layer" => {
                Some(default_layer.ok_or_else(|| EngineError::validation("sample \"layer\" needs a target layer"))?)
            }
            Some(v) => match v.get("layer").and_then(Value::as_u64) {
                Some(id) => Some(self.layer_index(id)?),
                None => return Err(EngineError::validation("sample must be \"composite\", \"layer\" or {\"layer\": id}")),
            },
        };
        Ok(match layer_idx {
            None => scene.flatten_ctx(task)?,
            Some(i) => {
                let l = &self.layers[i];
                scene.render_layer_ctx(l, &scene.parent_affine(l), task)?
            }
        })
    }

    fn op_magic_wand(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let (x, y) = self.canvas_point(p)?;
        let tol = req_tolerance(p)?;
        let contiguous = opt_bool(p, "contiguous", true)?;
        let mode = combine_mode(p)?;
        // Units: sample render + color region + combine.
        let mut task = RenderTask::new(ctx, self.sample_units(p, None)? + 2);
        let buf = self.sample_buffer(p, None, &mut task)?;
        let (w, h) = (self.width as usize, self.height as usize);
        let region = select::color_region(&buf, w, h, x, y, tol, contiguous, &mut task)?;
        task.step_done();
        let next = select::combine(self.selection.as_deref().map(|v| v.as_slice()), &region, mode, &mut task)?;
        self.record();
        self.set_selection(next);
        ok()
    }

    fn op_modify_selection(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let op = req_str(p, "op")?;
        let radius = req_radius(p, "radius", 0.0)?;
        let cur = self.require_selection()?.clone();
        let (w, h) = (self.width as usize, self.height as usize);
        let mut task = RenderTask::new(ctx, 1);
        let next = match op {
            "grow" => select::grow(&cur, w, h, radius, &mut task)?,
            "shrink" => select::grow(&cur, w, h, -radius, &mut task)?,
            "feather" => select::feather(&cur, w, h, radius, &mut task)?,
            "smooth" => select::smooth(&cur, w, h, radius, &mut task)?,
            other => return Err(EngineError::validation(format!("unknown selection op '{other}'"))),
        };
        self.record();
        self.set_selection(next);
        ok()
    }

    fn op_get_selection(&self) -> Result<CommandResult, EngineError> {
        let (w, h) = (self.width as usize, self.height as usize);
        match self.selection.as_ref().and_then(|s| select::bounds(s, w, h).map(|b| (s, b))) {
            None => read(json!({ "empty": true })),
            Some((s, (x, y, bw, bh))) => read(json!({
                "bounds": { "x": x, "y": y, "w": bw, "h": bh },
                "mask_b64": b64::encode(s),
                "width": w,
                "height": h,
            })),
        }
    }
}

impl PrismEngine {
    // -- groups, lock, blend, clipping ---------------------------------------

    /// Common parent of `idxs`, or `Validation` if they are not siblings.
    fn common_parent(&self, idxs: &[usize]) -> Result<Option<u64>, EngineError> {
        let parent = self.layers[idxs[0]].parent;
        if idxs.iter().any(|&i| self.layers[i].parent != parent) {
            return Err(EngineError::validation("layers must share the same parent"));
        }
        Ok(parent)
    }

    /// Insert a new container above the topmost member and adopt members.
    fn wrap(&mut self, idxs: &[usize], content: Content, name: String, parent: Option<u64>) -> u64 {
        let ids: Vec<u64> = idxs.iter().map(|&i| self.layers[i].id).collect();
        let top = *idxs.iter().max().unwrap_or(&0);
        let id = self.alloc_id();
        let mut layer = Layer::new(id, name, content);
        layer.parent = parent;
        self.layers.insert(top + 1, layer);
        for l in &mut self.layers {
            if ids.contains(&l.id) {
                l.parent = Some(id);
                l.clipped = false;
            }
        }
        id
    }

    fn op_group_layers(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let ids = req_ids(p, "ids")?;
        if ids.is_empty() {
            return Err(EngineError::validation("ids must not be empty"));
        }
        let name = Self::opt_name(p)?;
        let idxs = self.indices(&ids)?;
        let parent = self.common_parent(&idxs)?;
        if let Some(pid) = parent {
            if let Some(pi) = self.layers.iter().position(|l| l.id == pid) {
                if matches!(self.layers[pi].content, Content::Boolean { .. }) {
                    return Err(EngineError::validation("boolean operands cannot be grouped; release them first"));
                }
                self.ensure_unlocked(pi)?;
            }
        }
        for &i in &idxs {
            self.ensure_unlocked(i)?;
        }
        self.record();
        let n = self.layers.iter().filter(|l| l.is_container()).count() + 1;
        let id = self.wrap(&idxs, Content::Group, name.unwrap_or_else(|| format!("Group {n}")), parent);
        Ok(CommandResult::data(json!({ "layer_id": id })))
    }

    fn op_ungroup_layer(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let gidx = self.layer_index(Self::req_id(p)?)?;
        let group = self.layers[gidx].clone();
        if !group.is_container() {
            return Err(EngineError::validation(format!("layer {} is not a group or boolean", group.id)));
        }
        if group.mask.is_some() {
            return Err(EngineError::validation("apply or remove the group's mask before ungrouping"));
        }
        self.ensure_unlocked(gidx)?;
        let g_aff = group.transform.affine();
        let mut moved: Vec<Layer> = Vec::new();
        for l in self.layers.iter().filter(|l| l.parent == Some(group.id)) {
            let mut c = l.clone();
            if !g_aff.is_identity() {
                let m = g_aff.then_after(&c.transform.affine());
                c.transform = decompose(&m).ok_or_else(|| {
                    EngineError::validation(format!(
                        "ungrouping would skew layer {}; reset the group's scale or rotation first",
                        c.id
                    ))
                })?;
            }
            c.parent = group.parent;
            c.opacity *= group.opacity;
            moved.push(c);
        }
        self.record();
        let ids: HashSet<u64> = moved.iter().map(|l| l.id).collect();
        self.layers.retain(|l| !ids.contains(&l.id));
        let at = self.layers.iter().position(|l| l.id == group.id).unwrap_or(self.layers.len());
        self.layers.remove(at);
        for (k, l) in moved.into_iter().enumerate() {
            self.layers.insert(at + k, l);
        }
        self.selected.retain(|&s| s != group.id);
        ok()
    }

    fn op_set_layer_parent(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let id = self.layers[idx].id;
        let parent = match Self::field(p, "parent")? {
            Value::Null => None,
            v => Some(v.as_u64().ok_or_else(|| EngineError::invalid("parent must be a layer id or null"))?),
        };
        self.ensure_unlocked(idx)?;
        if let Some(pid) = parent {
            let pi = self.layer_index(pid)?;
            if pid == id || self.is_ancestor(id, pid) {
                return Err(EngineError::validation("a layer cannot be moved inside itself"));
            }
            match self.layers[pi].content {
                Content::Group => {}
                Content::Boolean { .. } if self.layers[idx].is_vector() => {}
                Content::Boolean { .. } => {
                    return Err(EngineError::validation("only shape and path layers can be boolean operands"))
                }
                _ => return Err(EngineError::validation(format!("layer {pid} is not a group"))),
            }
            self.ensure_unlocked(pi)?;
        }
        // Keep the layer where it is on screen.
        let scene = self.scene();
        let effective = scene.effective_affine(&self.layers[idx]);
        let new_parent_aff = match parent {
            None => Affine::IDENTITY,
            Some(pid) => {
                let pl = &self.layers[self.layer_index(pid)?];
                scene.effective_affine(pl)
            }
        };
        let local = new_parent_aff
            .invert()
            .map(|inv| inv.then_after(&effective))
            .ok_or_else(|| EngineError::validation("target group has a degenerate transform"))?;
        let transform = if local == self.layers[idx].transform.affine() {
            self.layers[idx].transform
        } else {
            decompose(&local).ok_or_else(|| {
                EngineError::validation("moving this layer would skew it; reset the target group's scale first")
            })?
        };
        self.record();
        let mut layer = self.layers.remove(idx);
        layer.parent = parent;
        layer.transform = transform;
        layer.clipped = false;
        match parent {
            None => self.layers.push(layer),
            Some(pid) => {
                let at = self.layers.iter().position(|l| l.id == pid).unwrap_or(self.layers.len());
                self.layers.insert(at, layer);
            }
        }
        ok()
    }

    /// `duplicateLayer {id,name?}` — deep copy of the layer and, for groups
    /// and booleans, its whole subtree. Every copied member gets a fresh id
    /// and parent links are remapped; the copy keeps the source's position
    /// rules (stack order, transform, mask, blend, lock, clipping) and sits
    /// directly above the source among its siblings. `name` renames only the
    /// copied root; the default is `"<name> copy"`. Object selection is left
    /// untouched. Duplication does not edit the source, so a locked layer may
    /// be duplicated (the copy stays locked). One undo entry.
    fn op_duplicate_layer(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let name = Self::opt_name(p)?;
        let root_id = self.layers[idx].id;
        let subtree = self.subtree_ids(root_id);
        // Vec order is the stack order inside every parent, so copying the
        // members in their existing order preserves all internal stacking.
        let members: Vec<Layer> = self
            .layers
            .iter()
            .filter(|l| subtree.contains(&l.id))
            .cloned()
            .collect();
        self.record();
        let mut remap = std::collections::HashMap::with_capacity(members.len());
        for m in &members {
            remap.insert(m.id, self.alloc_id());
        }
        let new_root = remap[&root_id];
        let mut copies: Vec<Layer> = members
            .into_iter()
            .map(|mut l| {
                let old = l.id;
                l.id = remap[&old];
                l.parent = l.parent.map(|pid| remap.get(&pid).copied().unwrap_or(pid));
                if old == root_id {
                    let n = name.clone().unwrap_or_else(|| format!("{} copy", l.name));
                    l.name = n;
                }
                l
            })
            .collect();
        let at = idx + 1;
        for (k, l) in copies.drain(..).enumerate() {
            self.layers.insert(at + k, l);
        }
        Ok(CommandResult::data(json!({ "layer_id": new_root })))
    }

    fn op_set_layer_locked(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let locked = Self::req_bool(p, "locked")?;
        self.record();
        self.layers[idx].locked = locked;
        ok()
    }

    fn op_set_layer_blend(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let s = req_str(p, "blend")?;
        let blend = BlendMode::parse(s).ok_or_else(|| EngineError::validation(format!("unknown blend mode '{s}'")))?;
        self.ensure_unlocked(idx)?;
        self.record();
        self.layers[idx].blend = blend;
        ok()
    }

    fn op_set_clipped(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let clipped = Self::req_bool(p, "clipped")?;
        let layer = &self.layers[idx];
        if clipped {
            let parent = layer.parent;
            if let Some(pid) = parent {
                if self.layers.iter().any(|l| l.id == pid && matches!(l.content, Content::Boolean { .. })) {
                    return Err(EngineError::validation("boolean operands cannot clip"));
                }
            }
            let below = self.layers[..idx].iter().any(|l| l.parent == parent);
            if !below {
                return Err(EngineError::validation("the bottom layer has nothing to clip to"));
            }
        }
        self.ensure_unlocked(idx)?;
        self.record();
        self.layers[idx].clipped = clipped;
        ok()
    }

    // -- thumbnails ----------------------------------------------------------

    fn op_layer_thumbnail(
        &self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let max = req_max(p)?;
        let scene = self.scene();
        let l = &self.layers[idx];
        // Units: one render_layer call per layer in the subtree, plus the
        // thumbnail fit pass.
        let mut task = RenderTask::new(ctx, self.subtree_ids(l.id).len() as u64 + 1);
        let px = scene.render_layer_ctx(l, &scene.parent_affine(l), &mut task)?;
        thumb(&px, scene.w, scene.h, max, &mut task)
    }

    /// `x,y,w,h` region of the flattened composite. Units: scene layers +
    /// crop + fit.
    fn region_pixels(
        &self,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        task: &mut RenderTask,
    ) -> Result<(Vec<u8>, usize, usize), EngineError> {
        if ![x, y, w, h].iter().all(|v| finite(*v)) || w <= 0.0 || h <= 0.0 {
            return Err(EngineError::validation("region must be finite with positive size"));
        }
        let (x0, y0) = (x.floor() as i64, y.floor() as i64);
        let (rw, rh) = (((x + w).ceil() as i64 - x0) as usize, ((y + h).ceil() as i64 - y0) as usize);
        if (rw as u64).saturating_mul(rh as u64) > MAX_PIXELS {
            return Err(EngineError::validation("region too large"));
        }
        let scene = self.scene();
        let flat = scene.flatten_ctx(task)?;
        task.step_done();
        let px = render::crop(&flat, scene.w, scene.h, x0, y0, rw, rh, task)?;
        task.step_done();
        Ok((px, rw, rh))
    }

    fn op_render_region(
        &self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let max = req_max(p)?;
        let (x, y, w, h) = (req_coord(p, "x")?, req_coord(p, "y")?, req_coord(p, "w")?, req_coord(p, "h")?);
        let mut task = RenderTask::new(ctx, self.layers.len() as u64 + 2);
        let (px, rw, rh) = self.region_pixels(x, y, w, h, &mut task)?;
        thumb(&px, rw, rh, max, &mut task)
    }

    // -- masks ---------------------------------------------------------------

    fn mask_index(&self, p: &Value) -> Result<usize, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        if self.layers[idx].mask.is_none() {
            return Err(EngineError::validation(format!("layer {} has no mask", self.layers[idx].id)));
        }
        Ok(idx)
    }

    fn mask_mut(&mut self, idx: usize) -> &mut Mask {
        self.layers[idx].mask.as_mut().expect("mask checked by mask_index")
    }

    fn op_add_mask(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        if self.layers[idx].mask.is_some() {
            return Err(EngineError::validation(format!("layer {} already has a mask", self.layers[idx].id)));
        }
        let n = self.width as usize * self.height as usize;
        let alpha = match p.get("fill").and_then(Value::as_str).unwrap_or("reveal") {
            "reveal" => vec![255u8; n],
            "hide" => vec![0u8; n],
            "selection" => self.require_selection()?.to_vec(),
            other => return Err(EngineError::validation(format!("unknown mask fill '{other}'"))),
        };
        self.ensure_unlocked(idx)?;
        self.record();
        self.layers[idx].mask = Some(Mask { alpha: Arc::new(alpha), enabled: true, inverted: false });
        ok()
    }

    fn op_remove_mask(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.mask_index(p)?;
        let apply = opt_bool(p, "apply", false)?;
        if apply && !self.layers[idx].is_raster() {
            return Err(EngineError::validation("only raster layers can apply a mask; rasterize the layer first"));
        }
        self.ensure_unlocked(idx)?;
        self.record();
        let mask = self.layers[idx].mask.take().expect("mask checked");
        if apply {
            if let Some(buf) = self.raster_mut(idx) {
                for (i, px) in buf.chunks_exact_mut(4).enumerate() {
                    px[3] = ((px[3] as u32 * mask.value(i) as u32 + 127) / 255) as u8;
                }
            }
        }
        ok()
    }

    fn op_set_mask_enabled(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.mask_index(p)?;
        let enabled = Self::req_bool(p, "enabled")?;
        self.ensure_unlocked(idx)?;
        self.record();
        self.mask_mut(idx).enabled = enabled;
        ok()
    }

    fn op_invert_mask(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.mask_index(p)?;
        self.ensure_unlocked(idx)?;
        self.record();
        let m = self.mask_mut(idx);
        m.inverted = !m.inverted;
        ok()
    }

    fn op_paint_mask(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let idx = self.mask_index(p)?;
        let x = req_coord(p, "x")?;
        let y = req_coord(p, "y")?;
        let w = Self::req_u64(p, "w")?;
        let h = Self::req_u64(p, "h")?;
        if w == 0 || h == 0 || x.fract() != 0.0 || y.fract() != 0.0 {
            return Err(EngineError::validation("x/y must be integers and w/h positive"));
        }
        if w.saturating_mul(h) > MAX_PIXELS {
            return Err(EngineError::validation("mask patch too large"));
        }
        let data = b64::decode(req_str(p, "data_b64")?)
            .map_err(|_| EngineError::validation("data_b64 is not valid base64"))?;
        if data.len() as u64 != w * h {
            return Err(EngineError::validation("data_b64 length must equal w*h"));
        }
        let mode = match p.get("mode").and_then(Value::as_str).unwrap_or("replace") {
            "replace" => 0,
            "add" => 1,
            "subtract" => 2,
            other => return Err(EngineError::validation(format!("unknown paint mode '{other}'"))),
        };
        self.ensure_unlocked(idx)?;
        let (cw, ch) = (self.width as i64, self.height as i64);
        let (xi, yi, wi, hi) = (x as i64, y as i64, w as i64, h as i64);
        if xi + wi <= 0 || yi + hi <= 0 || xi >= cw || yi >= ch {
            return read(json!({ "ok": true }));
        }
        let mut task = RenderTask::new(ctx, 1);
        if ctx.is_some() {
            // Cancellable path: patch a scratch copy of the mask and commit
            // only after the last checkpoint.
            let mut next = self.layers[idx]
                .mask
                .as_ref()
                .expect("mask checked by mask_index")
                .alpha
                .as_ref()
                .clone();
            Self::paint_mask_rect(&mut next, cw as usize, xi, yi, wi, hi, &data, mode, &mut task)?;
            task.checkpoint()?;
            self.record();
            self.mask_mut(idx).alpha = Arc::new(next);
            return ok();
        }
        self.record();
        let alpha = Arc::make_mut(&mut self.mask_mut(idx).alpha);
        Self::paint_mask_rect(alpha, cw as usize, xi, yi, wi, hi, &data, mode, &mut task)?;
        ok()
    }

    /// Apply a `w*h` mask patch at `(x, y)` with `mode` (0 replace,
    /// 1 add/max, 2 subtract), checkpointing every
    /// `CHECKPOINT_EVERY_PX` pixels when `task` has a context.
    #[allow(clippy::too_many_arguments)]
    fn paint_mask_rect(
        alpha: &mut [u8],
        cw: usize,
        xi: i64,
        yi: i64,
        wi: i64,
        hi: i64,
        data: &[u8],
        mode: i32,
        task: &mut RenderTask,
    ) -> Result<(), EngineError> {
        let ch = alpha.len() / cw.max(1);
        let (x0, x1) = (xi.max(0), (xi + wi).min(cw as i64));
        let (y0, y1) = (yi.max(0), (yi + hi).min(ch as i64));
        let total = ((x1 - x0) * (y1 - y0)).max(1) as f32;
        let mut done = 0usize;
        for r in y0..y1 {
            for c in x0..x1 {
                let src = data[((r - yi) * wi + (c - xi)) as usize];
                let d = &mut alpha[(r * cw as i64 + c) as usize];
                *d = match mode {
                    0 => src,
                    1 => (*d).max(src),
                    _ => ((*d as u32 * (255 - src as u32) + 127) / 255) as u8,
                };
                done += 1;
                task.tick(done, crate::CHECKPOINT_EVERY_PX, done as f32 / total)?;
            }
        }
        Ok(())
    }

    fn op_refine_mask(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let idx = self.mask_index(p)?;
        let feather = req_radius(p, "feather", 0.0)?;
        let grow = req_radius(p, "grow", -MAX_RADIUS)?;
        self.ensure_unlocked(idx)?;
        let (w, h) = (self.width as usize, self.height as usize);
        let cur = self.layers[idx].mask.as_ref().expect("mask checked").alpha.clone();
        // Units: grow, then feather — both produce `next` before commit.
        let mut task = RenderTask::new(ctx, 2);
        let grown = select::grow(&cur, w, h, grow, &mut task)?;
        task.step_done();
        let next = select::feather(&grown, w, h, feather, &mut task)?;
        self.record();
        self.mask_mut(idx).alpha = Arc::new(next);
        ok()
    }

    fn op_mask_thumbnail(
        &self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let idx = self.mask_index(p)?;
        let max = req_max(p)?;
        let m = self.layers[idx].mask.as_ref().expect("mask checked");
        let gray: Vec<u8> = (0..m.alpha.len())
            .flat_map(|i| {
                let v = if m.inverted { 255 - m.alpha[i] } else { m.alpha[i] };
                [v, v, v, 255]
            })
            .collect();
        let mut task = RenderTask::new(ctx, 1);
        thumb(&gray, self.width as usize, self.height as usize, max, &mut task)
    }

    // -- artboards -----------------------------------------------------------

    fn artboard_index(&self, id: u64) -> Result<usize, EngineError> {
        self.artboards
            .iter()
            .position(|a| a.id == id)
            .ok_or_else(|| EngineError::not_found(format!("artboard {id} not found")))
    }

    fn op_add_artboard(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let name = Self::opt_name(p)?;
        let mut a = Artboard {
            id: 0,
            name: name.unwrap_or_else(|| format!("Artboard {}", self.artboards.len() + 1)),
            x: req_coord(p, "x")?,
            y: req_coord(p, "y")?,
            w: req_coord(p, "w")?,
            h: req_coord(p, "h")?,
        };
        a.validate()?;
        self.record();
        a.id = self.alloc_id();
        let id = a.id;
        self.artboards.push(a);
        Ok(CommandResult::data(json!({ "artboard_id": id })))
    }

    fn op_remove_artboard(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let i = self.artboard_index(Self::req_id(p)?)?;
        self.record();
        self.artboards.remove(i);
        ok()
    }

    fn op_update_artboard(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let i = self.artboard_index(Self::req_id(p)?)?;
        let mut a = self.artboards[i].clone();
        if let Some(n) = Self::opt_name(p)? {
            a.name = n;
        }
        for (key, slot) in [("x", &mut a.x), ("y", &mut a.y), ("w", &mut a.w), ("h", &mut a.h)] {
            if let Some(v) = opt_f64(p, key)? {
                *slot = v;
            }
        }
        a.validate()?;
        self.record();
        self.artboards[i] = a;
        ok()
    }

    fn op_move_artboard(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let i = self.artboard_index(Self::req_id(p)?)?;
        let to = req_index(p, "to_index")?;
        if to >= self.artboards.len() {
            return Err(EngineError::out_of_bounds(format!("to_index {to} out of range")));
        }
        self.record();
        let a = self.artboards.remove(i);
        self.artboards.insert(to, a);
        ok()
    }

    fn op_artboard_thumbnail(
        &self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let i = self.artboard_index(Self::req_id(p)?)?;
        let max = req_max(p)?;
        let a = &self.artboards[i];
        let mut task = RenderTask::new(ctx, self.layers.len() as u64 + 2);
        let (px, w, h) = self.region_pixels(a.x, a.y, a.w, a.h, &mut task)?;
        thumb(&px, w, h, max, &mut task)
    }
}

impl PrismEngine {
    // -- vector paths --------------------------------------------------------

    fn opt_paint(p: &Value, key: &str) -> Result<Option<Paint>, EngineError> {
        match p.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => {
                let paint: Paint = parse(v, key)?;
                paint.validate()?;
                Ok(Some(paint))
            }
        }
    }

    fn opt_stroke(p: &Value) -> Result<Option<Stroke>, EngineError> {
        match p.get("stroke") {
            None | Some(Value::Null) => Ok(None),
            Some(v) => {
                let s: Stroke = parse(v, "stroke")?;
                s.validate()?;
                Ok(Some(s))
            }
        }
    }

    fn req_subpaths(v: &Value) -> Result<Vec<Subpath>, EngineError> {
        let subpaths: Vec<Subpath> = parse(v, "subpaths")?;
        crate::model::validate_subpaths(&subpaths)?;
        Ok(subpaths)
    }

    fn req_node(p: &Value) -> Result<Node, EngineError> {
        let node: Node = parse(Self::field(p, "node")?, "node")?;
        node.validate()?;
        Ok(node)
    }

    /// Index of an unlocked path layer.
    fn path_index(&self, p: &Value) -> Result<usize, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        if !matches!(self.layers[idx].content, Content::Path(_)) {
            return Err(EngineError::validation(format!(
                "layer {} is a {} layer, not a path",
                self.layers[idx].id,
                self.layers[idx].kind_name()
            )));
        }
        self.ensure_unlocked(idx)?;
        Ok(idx)
    }

    fn path_ref(&self, idx: usize) -> &PathData {
        match &self.layers[idx].content {
            Content::Path(p) => p,
            _ => unreachable!("path_index checked the kind"),
        }
    }

    fn path_mut(&mut self, idx: usize) -> &mut PathData {
        match &mut self.layers[idx].content {
            Content::Path(p) => p,
            _ => unreachable!("path_index checked the kind"),
        }
    }

    fn subpath_at(&self, idx: usize, p: &Value) -> Result<usize, EngineError> {
        let s = req_index(p, "subpath")?;
        if s >= self.path_ref(idx).subpaths.len() {
            return Err(EngineError::out_of_bounds(format!("subpath {s} out of range")));
        }
        Ok(s)
    }

    fn op_add_path(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let path_v = Self::field(p, "path")?;
        let subpaths = Self::req_subpaths(Self::field(path_v, "subpaths")?)?;
        let fill_rule: FillRule = match p.get("fill_rule") {
            None => FillRule::Nonzero,
            Some(v) => parse(v, "fill_rule")?,
        };
        let data = PathData {
            subpaths,
            fill: Self::opt_paint(p, "fill")?,
            stroke: Self::opt_stroke(p)?,
            fill_rule,
            paint_order: PaintOrder::FillStroke,
        };
        let name = Self::opt_name(p)?;
        self.record();
        let id = self.alloc_id();
        self.layers.push(Layer::new(id, name.unwrap_or_else(|| format!("Path {id}")), Content::Path(data)));
        Ok(CommandResult::data(json!({ "layer_id": id })))
    }

    fn op_set_path_nodes(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let subpaths = Self::req_subpaths(Self::field(p, "subpaths")?)?;
        self.record();
        self.path_mut(idx).subpaths = subpaths;
        ok()
    }

    fn op_set_path_node(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let s = self.subpath_at(idx, p)?;
        let i = req_index(p, "index")?;
        if i >= self.path_ref(idx).subpaths[s].nodes.len() {
            return Err(EngineError::out_of_bounds(format!("node {i} out of range")));
        }
        let node = Self::req_node(p)?;
        self.record();
        self.path_mut(idx).subpaths[s].nodes[i] = node;
        ok()
    }

    fn op_insert_path_node(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let s = self.subpath_at(idx, p)?;
        let i = req_index(p, "index")?;
        let len = self.path_ref(idx).subpaths[s].nodes.len();
        if i > len {
            return Err(EngineError::out_of_bounds(format!("insert index {i} out of range")));
        }
        let node = Self::req_node(p)?;
        if self.path_ref(idx).subpaths.iter().map(|sp| sp.nodes.len()).sum::<usize>() >= crate::model::MAX_PATH_NODES {
            return Err(EngineError::validation("path has too many nodes"));
        }
        self.record();
        self.path_mut(idx).subpaths[s].nodes.insert(i, node);
        ok()
    }

    fn op_remove_path_node(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let s = self.subpath_at(idx, p)?;
        let i = req_index(p, "index")?;
        let path = self.path_ref(idx);
        if i >= path.subpaths[s].nodes.len() {
            return Err(EngineError::out_of_bounds(format!("node {i} out of range")));
        }
        if path.subpaths.len() == 1 && path.subpaths[0].nodes.len() == 1 {
            return Err(EngineError::validation("a path keeps at least one node; remove the layer instead"));
        }
        self.record();
        let path = self.path_mut(idx);
        path.subpaths[s].nodes.remove(i);
        if path.subpaths[s].nodes.is_empty() {
            path.subpaths.remove(s);
        }
        ok()
    }

    fn op_set_node_kind(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let s = self.subpath_at(idx, p)?;
        let i = req_index(p, "index")?;
        let kind: NodeKind = parse(Self::field(p, "kind")?, "kind")?;
        let sp = &self.path_ref(idx).subpaths[s];
        let n = sp.nodes.len();
        if i >= n {
            return Err(EngineError::out_of_bounds(format!("node {i} out of range")));
        }
        let mut node = sp.nodes[i].clone();
        let neighbor = |k: isize| -> Option<&Node> {
            let j = i as isize + k;
            if (0..n as isize).contains(&j) {
                sp.nodes.get(j as usize)
            } else if sp.closed && n > 1 {
                sp.nodes.get(j.rem_euclid(n as isize) as usize)
            } else {
                None
            }
        };
        if kind != NodeKind::Corner {
            if node.in_handle.is_none() && node.out_handle.is_none() {
                // Derive handles from the neighbors' direction.
                let prev = neighbor(-1).map(|p| (p.x, p.y)).unwrap_or((node.x, node.y));
                let next = neighbor(1).map(|q| (q.x, q.y)).unwrap_or((node.x, node.y));
                let (dx, dy) = (next.0 - prev.0, next.1 - prev.1);
                let l = dx.hypot(dy);
                if l > 1e-9 {
                    let (ux, uy) = (dx / l, dy / l);
                    let lin = ((node.x - prev.0).hypot(node.y - prev.1) / 3.0).max(1.0);
                    let lout = ((next.0 - node.x).hypot(next.1 - node.y) / 3.0).max(1.0);
                    node.in_handle = Some([-ux * lin, -uy * lin]);
                    node.out_handle = Some([ux * lout, uy * lout]);
                }
            } else {
                let base = node.in_handle.map(|h| [-h[0], -h[1]]).or(node.out_handle).unwrap_or([0.0, 0.0]);
                let bl = base[0].hypot(base[1]);
                if bl > 1e-9 {
                    let u = [base[0] / bl, base[1] / bl];
                    let lin = node.in_handle.map_or(bl, |h| h[0].hypot(h[1]));
                    let lout = match kind {
                        NodeKind::Symmetric => lin,
                        _ => node.out_handle.map_or(bl, |h| h[0].hypot(h[1])),
                    };
                    node.in_handle = Some([-u[0] * lin, -u[1] * lin]);
                    node.out_handle = Some([u[0] * lout, u[1] * lout]);
                }
            }
        }
        node.kind = kind;
        node.validate()?;
        self.record();
        self.path_mut(idx).subpaths[s].nodes[i] = node;
        ok()
    }

    fn op_set_subpath_closed(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let s = self.subpath_at(idx, p)?;
        let closed = Self::req_bool(p, "closed")?;
        self.record();
        self.path_mut(idx).subpaths[s].closed = closed;
        ok()
    }

    fn op_set_fill(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let fill = Self::opt_paint(p, "fill")?;
        match (&self.layers[idx].content, &fill) {
            (Content::Path(_) | Content::Boolean { .. }, _) => {}
            (Content::Shape(_), Some(Paint::Solid { .. })) => {}
            (Content::Shape(_), _) => {
                return Err(EngineError::validation(
                    "shape layers take a solid fill; convertToPath for gradients or no fill",
                ))
            }
            (_, _) => {
                return Err(EngineError::validation(format!(
                    "layer {} is a {} layer and has no fill",
                    self.layers[idx].id,
                    self.layers[idx].kind_name()
                )))
            }
        }
        self.ensure_unlocked(idx)?;
        self.record();
        match &mut self.layers[idx].content {
            Content::Path(path) => path.fill = fill,
            Content::Boolean { fill: f, .. } => *f = fill,
            Content::Shape(s) => {
                if let Some(Paint::Solid { color }) = fill {
                    s.fill = color;
                }
            }
            _ => {}
        }
        ok()
    }

    fn op_set_stroke(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let stroke = Self::opt_stroke(p)?;
        self.record();
        self.path_mut(idx).stroke = stroke;
        ok()
    }

    fn op_set_fill_rule(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let rule: FillRule = parse(Self::field(p, "rule")?, "rule")?;
        self.record();
        self.path_mut(idx).fill_rule = rule;
        ok()
    }

    fn op_set_paint_order(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.path_index(p)?;
        let order: PaintOrder = parse(Self::field(p, "order")?, "order")?;
        self.record();
        self.path_mut(idx).paint_order = order;
        ok()
    }

    fn op_convert_to_path(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let Content::Shape(shape) = &self.layers[idx].content else {
            return Err(EngineError::validation(format!(
                "layer {} is a {} layer; only shapes convert to paths",
                self.layers[idx].id,
                self.layers[idx].kind_name()
            )));
        };
        let data = PathData {
            subpaths: vector::shape_to_subpaths(shape),
            fill: Some(Paint::solid(shape.fill)),
            stroke: None,
            fill_rule: FillRule::Nonzero,
            paint_order: PaintOrder::FillStroke,
        };
        self.ensure_unlocked(idx)?;
        self.record();
        self.layers[idx].content = Content::Path(data);
        ok()
    }

    fn op_boolean_layers(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let ids = req_ids(p, "ids")?;
        if ids.len() < 2 {
            return Err(EngineError::validation("a boolean needs at least two shape or path layers"));
        }
        let op: BoolOp = parse(Self::field(p, "op")?, "op")?;
        let name = Self::opt_name(p)?;
        let mut idxs = self.indices(&ids)?;
        idxs.sort_unstable();
        let parent = self.common_parent(&idxs)?;
        for &i in &idxs {
            if !self.layers[i].is_vector() {
                return Err(EngineError::validation(format!(
                    "layer {} is a {} layer; booleans take shapes and paths",
                    self.layers[i].id,
                    self.layers[i].kind_name()
                )));
            }
            self.ensure_unlocked(i)?;
        }
        if let Some(pid) = parent {
            if self.layers.iter().any(|l| l.id == pid && matches!(l.content, Content::Boolean { .. })) {
                return Err(EngineError::validation("booleans cannot nest inside another boolean"));
            }
        }
        let bottom = &self.layers[idxs[0]];
        let fill = match &bottom.content {
            Content::Shape(s) => Some(Paint::solid(s.fill)),
            Content::Path(pd) => pd.fill.clone(),
            _ => None,
        };
        self.record();
        let label = match op {
            BoolOp::Union => "Union",
            BoolOp::Subtract => "Subtract",
            BoolOp::Intersect => "Intersect",
            BoolOp::Exclude => "Exclude",
        };
        let id = self.wrap(&idxs, Content::Boolean { op, fill }, name.unwrap_or_else(|| label.to_string()), parent);
        Ok(CommandResult::data(json!({ "layer_id": id })))
    }

    fn op_set_boolean_op(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        let op: BoolOp = parse(Self::field(p, "op")?, "op")?;
        if !matches!(self.layers[idx].content, Content::Boolean { .. }) {
            return Err(EngineError::validation(format!("layer {} is not a boolean", self.layers[idx].id)));
        }
        self.ensure_unlocked(idx)?;
        self.record();
        if let Content::Boolean { op: o, .. } = &mut self.layers[idx].content {
            *o = op;
        }
        ok()
    }

    fn op_rasterize_layer(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let idx = self.layer_index(Self::req_id(p)?)?;
        if self.layers[idx].is_raster() {
            return Err(EngineError::validation(format!("layer {} is already raster", self.layers[idx].id)));
        }
        self.ensure_unlocked(idx)?;
        // Render in the parent's space with the layer's own transform baked
        // in; mask, opacity, blend and clipping stay on the layer.
        let mut probe = self.layers[idx].clone();
        probe.mask = None;
        // Units: one render_layer call per layer in the subtree.
        let mut task = RenderTask::new(ctx, self.subtree_ids(probe.id).len() as u64);
        let pixels = self.scene().render_layer_ctx(&probe, &Affine::IDENTITY, &mut task)?;
        let id = self.layers[idx].id;
        let mut doomed = self.subtree_ids(id);
        doomed.remove(&id);
        self.record();
        let l = &mut self.layers[idx];
        l.content = Content::Raster(Arc::new(pixels));
        l.transform = Transform::default();
        self.layers.retain(|l| !doomed.contains(&l.id));
        self.selected.retain(|s| !doomed.contains(s));
        ok()
    }

    // -- document crop -------------------------------------------------------

    /// `crop {x,y,w,h}` — offset-crop the document. Intersection semantics:
    /// the rect is rounded outward to whole pixels, then intersected with
    /// the canvas; a rect that misses it is `OutOfBounds`, and cropping to
    /// the full canvas is a read-only no-op.
    ///
    /// Content stored in layer coordinates (shape bounds, path nodes,
    /// gradient geometry) is shifted by `-s`, where `s` is the canvas delta
    /// pulled back through each layer's effective transform — so the
    /// rendered image is preserved exactly while transforms themselves stay
    /// untouched. Raster layers resample through a texel grid pinned to the
    /// buffer's own extent, which only matches the rendered image when the
    /// layer's effective affine (own transform composed with group
    /// ancestors) has an identity linear part: translation and
    /// identity-scale rasters crop pixel-exactly, while any rotation, skew,
    /// or non-unit scale would silently drop texels — those layers reject
    /// the whole crop with `Validation` before anything mutates. Masks and
    /// the pixel selection live in canvas space and are cropped at the
    /// pixel offset; artboards shift by the canvas delta and may leave the
    /// canvas. One undo entry. Like `resize`, this is a document-level op:
    /// locked layers are not consulted.
    fn op_crop(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let x = req_coord(p, "x")?;
        let y = req_coord(p, "y")?;
        let w = req_coord(p, "w")?;
        let h = req_coord(p, "h")?;
        if w <= 0.0 || h <= 0.0 {
            return Err(EngineError::validation("crop w/h must be positive"));
        }
        let (cw, ch) = (self.width as i64, self.height as i64);
        let ix0 = (x.floor() as i64).max(0);
        let iy0 = (y.floor() as i64).max(0);
        let ix1 = ((x + w).ceil() as i64).min(cw);
        let iy1 = ((y + h).ceil() as i64).min(ch);
        if ix1 <= ix0 || iy1 <= iy0 {
            return Err(EngineError::out_of_bounds(
                "crop region does not intersect the canvas",
            ));
        }
        let (nw, nh) = ((ix1 - ix0) as u32, (iy1 - iy0) as u32);
        Self::check_dims(nw, nh)?;
        if ix0 == 0 && iy0 == 0 && nw == self.width && nh == self.height {
            return read(json!({ "ok": true }));
        }
        let (sw, sh) = (self.width as usize, self.height as usize);
        let (dw, dh) = (nw as usize, nh as usize);
        let (dx, dy) = (ix0 as f64, iy0 as f64);

        // Phase 1 — compute every new buffer and validate every shifted
        // coordinate before touching the document or the journal. `s` is
        // the content-space shift for each layer: the canvas delta pulled
        // back through its effective (ancestor-inclusive) transform.
        let scene = self.scene();
        let mut shifts: Vec<(f64, f64)> = Vec::with_capacity(self.layers.len());
        for l in &self.layers {
            let e = scene.effective_affine(l);
            let Some(inv) = e.invert() else {
                return Err(EngineError::validation(format!(
                    "layer {} has a degenerate transform",
                    l.id
                )));
            };
            let (sx, sy) = inv.apply_vec(dx, dy);
            if !sx.is_finite() || !sy.is_finite() {
                return Err(EngineError::validation(format!(
                    "layer {} content shift is not representable",
                    l.id
                )));
            }
            // The raster resample below pins its texel grid to the buffer's
            // own [0,w)×[0,h) extent; that equals the rendered window only
            // when the effective affine's linear part is the identity. A
            // scaled, rotated, or skewed raster (including via a group
            // ancestor) would lose texels, so reject the whole crop here —
            // still in phase 1, before the journal or any state changes.
            if matches!(l.content, Content::Raster(_))
                && ((e.a - 1.0).abs() > CROP_RASTER_LINEAR_EPS
                    || e.b.abs() > CROP_RASTER_LINEAR_EPS
                    || e.c.abs() > CROP_RASTER_LINEAR_EPS
                    || (e.d - 1.0).abs() > CROP_RASTER_LINEAR_EPS)
            {
                return Err(EngineError::validation(format!(
                    "crop does not support transformed raster layers (layer {} has rotation, skew, or non-unit scale)",
                    l.id
                )));
            }
            shifts.push((sx, sy));
        }
        let work_units = self
            .layers
            .iter()
            .filter(|l| matches!(l.content, Content::Raster(_)) || l.mask.is_some())
            .count() as u64
            + 1;
        let mut task = RenderTask::new(ctx, work_units);
        let mut rasters: Vec<(usize, Vec<u8>)> = Vec::new();
        let mut masks: Vec<(usize, Vec<u8>)> = Vec::new();
        for (i, l) in self.layers.iter().enumerate() {
            let (sx, sy) = shifts[i];
            match &l.content {
                Content::Raster(px) => {
                    let buf =
                        raster::resample_translated(px, sw, sh, sx, sy, dw, dh, &mut task)?;
                    rasters.push((i, buf));
                }
                Content::Shape(s) => {
                    if !finite(s.x - sx) || !finite(s.y - sy) {
                        return Err(EngineError::validation(format!(
                            "cropping layer {} exceeds coordinate bounds",
                            l.id
                        )));
                    }
                }
                Content::Path(path) => {
                    for sp in &path.subpaths {
                        for n in &sp.nodes {
                            if !finite(n.x - sx) || !finite(n.y - sy) {
                                return Err(EngineError::validation(format!(
                                    "cropping layer {} exceeds coordinate bounds",
                                    l.id
                                )));
                            }
                        }
                    }
                    for paint in path
                        .fill
                        .iter()
                        .chain(path.stroke.iter().map(|s| &s.paint))
                    {
                        let mut q = paint.clone();
                        shift_paint(&mut q, sx, sy);
                        q.validate()?;
                    }
                }
                Content::Boolean {
                    fill: Some(f), ..
                } => {
                    let mut q = f.clone();
                    shift_paint(&mut q, sx, sy);
                    q.validate()?;
                }
                _ => {}
            }
            if let Some(m) = &l.mask {
                masks.push((
                    i,
                    crop_alpha(&m.alpha, sw, sh, ix0, iy0, dw, dh, &mut task)?,
                ));
            }
        }
        task.step_done();
        // Artboards and the pixel selection live in canvas space.
        let mut artboards = self.artboards.clone();
        for a in &mut artboards {
            a.x -= dx;
            a.y -= dy;
            a.validate()
                .map_err(|_| EngineError::validation("cropping an artboard exceeds coordinate bounds"))?;
        }
        let selection = match &self.selection {
            None => None,
            Some(s) => {
                let c = crop_alpha(s, sw, sh, ix0, iy0, dw, dh, &mut task)?;
                (!select::is_empty(&c)).then_some(c)
            }
        };
        task.checkpoint()?;

        // Phase 2 — commit. Nothing below can fail, so a cancelled task
        // (which can only error in phase 1) leaves the document untouched.
        self.record();
        self.width = nw;
        self.height = nh;
        for (i, buf) in rasters {
            self.layers[i].content = Content::Raster(Arc::new(buf));
        }
        for (i, alpha) in masks {
            if let Some(m) = &mut self.layers[i].mask {
                m.alpha = Arc::new(alpha);
            }
        }
        for (i, &(sx, sy)) in shifts.iter().enumerate() {
            match &mut self.layers[i].content {
                Content::Shape(s) => {
                    s.x -= sx;
                    s.y -= sy;
                }
                Content::Path(path) => {
                    for sp in &mut path.subpaths {
                        for n in &mut sp.nodes {
                            n.x -= sx;
                            n.y -= sy;
                        }
                    }
                    if let Some(f) = &mut path.fill {
                        shift_paint(f, sx, sy);
                    }
                    if let Some(st) = &mut path.stroke {
                        shift_paint(&mut st.paint, sx, sy);
                    }
                }
                Content::Boolean {
                    fill: Some(f), ..
                } => shift_paint(f, sx, sy),
                _ => {}
            }
        }
        self.artboards = artboards;
        self.selection = selection.map(Arc::new);
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    // -- pixel sampling ---------------------------------------------------------

    /// `samplePixels {x,y,radius?}` — composite RGBA at a document-space
    /// point, read through the real render pipeline (transforms, blend
    /// modes, masks, groups). `radius` (0..=250, default 0) box-averages a
    /// square region around the point in premultiplied alpha, so
    /// translucent composites keep their color. Points outside the canvas
    /// sample as transparent. Read-only: no undo entry, no events.
    fn op_sample_pixels(
        &self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let transparent = || read(json!({ "r": 0, "g": 0, "b": 0, "a": 0 }));
        let x = req_coord(p, "x")?;
        let y = req_coord(p, "y")?;
        let radius = req_radius(p, "radius", 0.0)?;
        let (w, h) = (self.width as usize, self.height as usize);
        if w == 0 || h == 0 {
            return transparent();
        }
        // Pixels touched by the closed box [x±r]×[y±r], clipped to canvas.
        let x0 = ((x - radius).floor() as i64).max(0);
        let y0 = ((y - radius).floor() as i64).max(0);
        let x1 = (((x + radius).floor() as i64) + 1).min(w as i64);
        let y1 = (((y + radius).floor() as i64) + 1).min(h as i64);
        if x1 <= x0 || y1 <= y0 {
            return transparent();
        }
        let mut task = RenderTask::new(ctx, self.layers.len() as u64 + 1);
        let flat = self.scene().flatten_ctx(&mut task)?;
        task.step_done();
        // Average in premultiplied space: accumulate rgb*a and a
        // separately, then un-premultiply by the summed alpha. Averaging
        // straight-alpha channels independently would darken translucent
        // composites toward transparent black.
        let mut acc = [0f64; 4];
        let mut n = 0f64;
        for py in y0..y1 {
            for px in x0..x1 {
                let o = ((py as usize) * w + px as usize) * 4;
                let a = flat[o + 3] as f64 / 255.0;
                for c in 0..3 {
                    acc[c] += flat[o + c] as f64 * a;
                }
                acc[3] += a;
                n += 1.0;
            }
        }
        if acc[3] <= 1e-12 {
            return transparent();
        }
        let channel = |c: usize| (acc[c] / acc[3]).round().clamp(0.0, 255.0) as u8;
        let alpha = (acc[3] / n * 255.0).round().clamp(0.0, 255.0) as u8;
        read(json!({ "r": channel(0), "g": channel(1), "b": channel(2), "a": alpha }))
    }

    // -- region fill ---------------------------------------------------------

    fn op_flood_fill(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let idx = self.raster_index(Self::req_id(p)?)?;
        let (x, y) = self.canvas_point(p)?;
        let color = Self::req_color(p, "color")?;
        let tol = req_tolerance(p)?;
        let contiguous = opt_bool(p, "contiguous", true)?;
        self.ensure_unlocked(idx)?;
        let transform = self.scene().effective_affine(&self.layers[idx]);
        if transform.invert().is_none() {
            return Err(EngineError::validation("raster transform cannot be inverted"));
        }
        // Units: sample render + color region + coverage pullback + blend.
        let mut task = RenderTask::new(ctx, self.sample_units(p, Some(idx))? + 3);
        let buf = self.sample_buffer(p, Some(idx), &mut task)?;
        let (w, h) = (self.width as usize, self.height as usize);
        let mut region = select::color_region(&buf, w, h, x, y, tol, contiguous, &mut task)?;
        if let Some(sel) = &self.selection {
            let total = region.len().max(1) as f32;
            for (i, (r, s)) in region.iter_mut().zip(sel.iter()).enumerate() {
                task.tick(i, crate::CHECKPOINT_EVERY_PX, i as f32 / total)?;
                *r = ((*r as u32 * *s as u32 + 127) / 255) as u8;
            }
        }
        task.step_done();
        // Region and selection are canvas-space. Pull their coverage back
        // through the complete layer/ancestor transform before editing pixels.
        let region = if transform.is_identity() {
            region
        } else {
            select::pullback_coverage(&region, w, h, &transform, &mut task)?
        };
        task.step_done();
        if select::is_empty(&region) {
            return read(json!({ "ok": true, "filled": 0 }));
        }
        if ctx.is_some() {
            // Cancellable path: blend into a scratch copy of the layer and
            // commit only after the last checkpoint.
            let mut work = self
                .raster_ref(idx)
                .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?
                .clone();
            let filled = Self::blend_region(&mut work, &region, &color, &mut task)?;
            task.checkpoint()?;
            self.record_full_layer_pixels(idx)?;
            self.layers[idx].content = Content::Raster(Arc::new(work));
            return Ok(CommandResult::data(json!({ "ok": true, "filled": filled })));
        }
        self.record_full_layer_pixels(idx)?;
        let target = self.raster_mut(idx).ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        let filled = Self::blend_region(target, &region, &color, &mut task)?;
        Ok(CommandResult::data(json!({ "ok": true, "filled": filled })))
    }

    /// Blend `color` into `target` (canvas-sized RGBA) weighted by `region`
    /// coverage, checkpointing every `CHECKPOINT_EVERY_PX` pixels.
    fn blend_region(
        target: &mut [u8],
        region: &[u8],
        color: &[u8; 4],
        task: &mut RenderTask,
    ) -> Result<u64, EngineError> {
        let total = region.len().max(1) as f32;
        let mut filled = 0u64;
        for (i, &cov) in region.iter().enumerate() {
            task.tick(i, crate::CHECKPOINT_EVERY_PX, i as f32 / total)?;
            if cov > 0 {
                raster::blend_pixel(&mut target[i * 4..i * 4 + 4], color, cov as f64 / 255.0);
                filled += 1;
            }
        }
        Ok(filled)
    }

    // -- brush / stroke ops (P06, per P-prism-brush-ink-decision) -----------

    /// `modelStroke {samples, params?, predict?}` — run the stroke-modeler
    /// pipeline and return modeled (+ optional lookahead) points. Pure,
    /// read-only, eventless.
    fn op_model_stroke(
        &self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let samples = stroke::parse_samples(p.get("samples"))?;
        let params = stroke::parse_params(p.get("params"))?;
        let predict = stroke::parse_predict(p.get("predict"))?;
        let (segments, predicted) = stroke::model_stroke(&samples, &params, predict, ctx)?;
        let modeled: Vec<Value> = segments
            .iter()
            .flatten()
            .map(stroke::ModeledPoint::to_json)
            .collect();
        let predicted_json: Vec<Value> =
            predicted.iter().map(stroke::ModeledPoint::to_json).collect();
        Ok(CommandResult {
            output: None,
            events: Vec::new(),
            data: json!({ "modeled": modeled, "predicted": predicted_json }),
        })
    }

    /// `addBrush {name?, size?, opacity?, flow?, spacing?, hardness?,
    /// color?, dynamics?, taper?}` — flat brush fields; missing fields take
    /// preset defaults. <= [`stroke::MAX_BRUSHES`] per document.
    fn op_add_brush(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if self.brushes.len() >= stroke::MAX_BRUSHES {
            return Err(EngineError::validation(format!(
                "document already has the maximum of {} brushes",
                stroke::MAX_BRUSHES
            )));
        }
        let patch = stroke::parse_brush_patch(Some(p))?;
        // Validate the patch fully before touching history or the id
        // counter — a rejected brush must leave the document untouched.
        stroke::brush_from_patch(0, patch.clone(), "Brush".to_string())?;
        self.record();
        let id = self.alloc_id();
        let brush = stroke::brush_from_patch(id, patch, format!("Brush {id}"))?;
        self.brushes.push(brush);
        Ok(CommandResult::data(json!({ "brush_id": id })))
    }

    /// `setBrush {id, ...patch}` — partial merge; identical result records
    /// nothing (`changed:false`, no undo, no event).
    fn op_set_brush(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = Self::req_u64(p, "id")?;
        let idx = self
            .brushes
            .iter()
            .position(|b| b.id == id)
            .ok_or_else(|| EngineError::not_found(format!("brush {id} not found")))?;
        let patch = stroke::parse_brush_patch(Some(p))?;
        let next = stroke::brush_apply_patch(&self.brushes[idx], patch)?;
        if next == self.brushes[idx] {
            return Ok(CommandResult {
                output: None,
                events: Vec::new(),
                data: json!({ "ok": true, "changed": false }),
            });
        }
        self.record();
        self.brushes[idx] = next;
        Ok(CommandResult::data(json!({ "ok": true, "changed": true })))
    }

    /// `removeBrush {id}`.
    fn op_remove_brush(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = Self::req_u64(p, "id")?;
        let idx = self
            .brushes
            .iter()
            .position(|b| b.id == id)
            .ok_or_else(|| EngineError::not_found(format!("brush {id} not found")))?;
        self.record();
        self.brushes.remove(idx);
        ok()
    }

    /// `listBrushes {}` — the document brush table. Read-only.
    fn op_list_brushes(&self) -> Result<CommandResult, EngineError> {
        let brushes = serde_json::to_value(&self.brushes)
            .map_err(|e| EngineError::internal(e.to_string()))?;
        Ok(CommandResult {
            output: None,
            events: Vec::new(),
            data: json!({ "brushes": brushes }),
        })
    }

    /// `paintStroke {id, brush_id?|brush?, samples, params?, commit?}` —
    /// model the samples, resolve dabs through the brush, and stamp them
    /// src-over onto a raster layer. One undo entry (pixel region) per
    /// committed stroke; `commit:false` is a read-only dry run returning the
    /// dab count and bounds. Exactly one of `brush_id`/`brush` is required.
    fn op_paint_stroke(
        &mut self,
        p: &Value,
        ctx: Option<&ignition_core::TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let idx = self.raster_index(Self::req_id(p)?)?;
        self.ensure_unlocked(idx)?;
        let has_id = p.get("brush_id").is_some_and(|v| !v.is_null());
        let has_inline = p.get("brush").is_some_and(|v| !v.is_null());
        if has_id == has_inline {
            return Err(EngineError::invalid(
                "paintStroke needs exactly one of 'brush_id' or 'brush'",
            ));
        }
        let brush = if has_id {
            let bid = Self::req_u64(p, "brush_id")?;
            self.brushes
                .iter()
                .find(|b| b.id == bid)
                .cloned()
                .ok_or_else(|| EngineError::not_found(format!("brush {bid} not found")))?
        } else {
            let patch = stroke::parse_brush_patch(p.get("brush"))?;
            stroke::brush_from_patch(0, patch, "brush".to_string())?
        };
        let samples = stroke::parse_samples(p.get("samples"))?;
        let params = stroke::parse_params(p.get("params"))?;
        let commit = match p.get("commit") {
            None | Some(Value::Null) => true,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err(EngineError::invalid("field 'commit' must be a boolean")),
        };

        let (segments, _) = stroke::model_stroke(&samples, &params, None, ctx)?;
        let dabs = stroke::generate_dabs(&segments, &brush)?;
        let dab_count = dabs.len();
        let Some((bx0, by0, bx1, by1)) = stroke::dabs_bounds(&dabs) else {
            return Ok(CommandResult {
                output: None,
                events: Vec::new(),
                data: json!({ "ok": true, "dabs": 0 }),
            });
        };
        // Clip the dab bounds to the canvas, same integer-rect semantics as
        // drawPixels.
        let x0 = (bx0.floor() as i64).max(0);
        let y0 = (by0.floor() as i64).max(0);
        let x1 = (bx1.ceil() as i64).min(self.width as i64);
        let y1 = (by1.ceil() as i64).min(self.height as i64);
        if x1 <= x0 || y1 <= y0 {
            return Ok(CommandResult {
                output: None,
                events: Vec::new(),
                data: json!({ "ok": true, "dabs": dab_count }),
            });
        }
        let (cx, cy) = (x0 as u32, y0 as u32);
        let (cw, ch) = ((x1 - x0) as u32, (y1 - y0) as u32);
        if !commit {
            return Ok(CommandResult {
                output: None,
                events: Vec::new(),
                data: json!({
                    "dabs": dab_count,
                    "bounds": { "x": cx, "y": cy, "w": cw, "h": ch },
                }),
            });
        }

        let canvas_w = self.width as usize;
        let canvas_h = self.height as usize;
        let buf = self
            .raster_ref(idx)
            .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        let prev = raster::read_region(
            buf,
            canvas_w,
            cx as usize,
            cy as usize,
            cw as usize,
            ch as usize,
        );
        let mut task = RenderTask::new(ctx, 1);
        if ctx.is_some() {
            // Cancellable path: stamp into a scratch copy of the region,
            // checkpointing per dab pixel batch, then commit once.
            let mut work = prev.clone();
            stroke::stamp_dabs(
                &mut work,
                cw as usize,
                ch as usize,
                cx as usize,
                cy as usize,
                &dabs,
                brush.color,
                &mut task,
            )?;
            task.checkpoint()?;
            self.journal.record(UndoEntry::Pixels {
                layer_id: self.layers[idx].id,
                x: cx,
                y: cy,
                w: cw,
                h: ch,
                prev,
            });
            let buf = self
                .raster_mut(idx)
                .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
            raster::write_region(
                buf,
                canvas_w,
                cx as usize,
                cy as usize,
                cw as usize,
                ch as usize,
                &work,
            );
            return Ok(CommandResult::data(json!({ "ok": true, "dabs": dab_count })));
        }

        self.journal.record(UndoEntry::Pixels {
            layer_id: self.layers[idx].id,
            x: cx,
            y: cy,
            w: cw,
            h: ch,
            prev,
        });
        let buf = self
            .raster_mut(idx)
            .ok_or_else(|| EngineError::internal("raster layer missing buffer"))?;
        stroke::stamp_dabs(
            buf,
            canvas_w,
            canvas_h,
            0,
            0,
            &dabs,
            brush.color,
            &mut task,
        )?;
        Ok(CommandResult::data(json!({ "ok": true, "dabs": dab_count })))
    }
}

