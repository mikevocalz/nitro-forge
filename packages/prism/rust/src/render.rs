//! Document compositing: the layer tree (groups, boolean containers),
//! clipping runs, blend modes, masks and transforms; plus thumbnails, bounds
//! and point hit-testing.

use crate::geom::{Affine, Rect};
use crate::model::{BlendMode, BoolOp, Content, FillRule, Layer, PaintOrder, Paint};
use crate::raster;
use crate::vector::{self, Polyline, Sampler};

/// Read-only view over the document used by every render entry point.
pub struct Scene<'a> {
    pub layers: &'a [Layer],
    pub w: usize,
    pub h: usize,
}

fn blend_channel(mode: BlendMode, cb: f64, cs: f64) -> f64 {
    match mode {
        BlendMode::Normal => cs,
        BlendMode::Multiply => cb * cs,
        BlendMode::Screen => cb + cs - cb * cs,
        BlendMode::Overlay => blend_channel(BlendMode::HardLight, cs, cb),
        BlendMode::Darken => cb.min(cs),
        BlendMode::Lighten => cb.max(cs),
        BlendMode::ColorDodge => {
            if cb == 0.0 {
                0.0
            } else if cs >= 1.0 {
                1.0
            } else {
                (cb / (1.0 - cs)).min(1.0)
            }
        }
        BlendMode::ColorBurn => {
            if cb >= 1.0 {
                1.0
            } else if cs <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - cb) / cs).min(1.0)
            }
        }
        BlendMode::HardLight => {
            if cs <= 0.5 {
                cb * 2.0 * cs
            } else {
                let s = 2.0 * cs - 1.0;
                cb + s - cb * s
            }
        }
        BlendMode::SoftLight => {
            if cs <= 0.5 {
                cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
            } else {
                let d = if cb <= 0.25 { ((16.0 * cb - 12.0) * cb + 4.0) * cb } else { cb.sqrt() };
                cb + (2.0 * cs - 1.0) * (d - cb)
            }
        }
        BlendMode::Difference => (cb - cs).abs(),
        BlendMode::Exclusion => cb + cs - 2.0 * cb * cs,
        BlendMode::Add => (cb + cs).min(1.0),
    }
}

/// Composite one straight-alpha pixel. Normal source-over keeps the exact
/// arithmetic of [`raster::blend_pixel`] so existing documents render
/// byte-identically. `atop` keeps the destination alpha (clipping).
pub fn composite_pixel(dst: &mut [u8], src: &[u8], mode: BlendMode, opacity: f64, atop: bool) {
    if mode == BlendMode::Normal && !atop {
        raster::blend_pixel(dst, &[src[0], src[1], src[2], src[3]], opacity);
        return;
    }
    let sa = (src[3] as f64 / 255.0) * opacity;
    if sa <= 0.0 {
        return;
    }
    let da = dst[3] as f64 / 255.0;
    if atop && da <= 0.0 {
        return;
    }
    let out_a = if atop { da } else { sa + da * (1.0 - sa) };
    for c in 0..3 {
        let cs = src[c] as f64 / 255.0;
        let cb = dst[c] as f64 / 255.0;
        let mixed = (1.0 - da) * cs + da * blend_channel(mode, cb, cs);
        let premult = if atop {
            mixed * sa * da + cb * da * (1.0 - sa)
        } else {
            mixed * sa + cb * da * (1.0 - sa)
        };
        dst[c] = (premult / out_a * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    dst[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
}

fn composite_into(dst: &mut [u8], src: &[u8], mode: BlendMode, opacity: f64, atop: bool) {
    for (d, s) in dst.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
        if s[3] != 0 {
            composite_pixel(d, s, mode, opacity, atop);
        }
    }
}

impl<'a> Scene<'a> {
    pub fn children(&self, parent: Option<u64>) -> impl Iterator<Item = &'a Layer> + '_ {
        self.layers.iter().filter(move |l| l.parent == parent)
    }

    /// Product of the transforms of `layer`'s ancestors (not its own).
    pub fn parent_affine(&self, layer: &Layer) -> Affine {
        let mut chain = Vec::new();
        let mut p = layer.parent;
        let mut guard = 0;
        while let Some(pid) = p {
            guard += 1;
            if guard > self.layers.len() {
                break;
            }
            match self.layers.iter().find(|l| l.id == pid) {
                Some(l) => {
                    chain.push(l.transform.affine());
                    p = l.parent;
                }
                None => break,
            }
        }
        chain.iter().rev().fold(Affine::IDENTITY, |acc, m| acc.then_after(m))
    }

    pub fn effective_affine(&self, layer: &Layer) -> Affine {
        self.parent_affine(layer).then_after(&layer.transform.affine())
    }

    /// Full composite of the visible document.
    pub fn flatten(&self) -> Vec<u8> {
        let mut out = vec![0u8; self.w * self.h * 4];
        self.render_children(None, &Affine::IDENTITY, &mut out);
        out
    }

    fn render_children(&self, parent: Option<u64>, base: &Affine, out: &mut [u8]) {
        let kids: Vec<&Layer> = self.children(parent).collect();
        let mut i = 0;
        while i < kids.len() {
            let head = kids[i];
            let mut j = i + 1;
            while j < kids.len() && kids[j].clipped {
                j += 1;
            }
            if head.visible {
                if j == i + 1 && head.blend == BlendMode::Normal {
                    // Fast path: no clipping run.
                    let buf = self.render_layer(head, base);
                    composite_into(out, &buf, head.blend, head.opacity, false);
                } else {
                    let mut buf = self.render_layer(head, base);
                    for clip in &kids[i + 1..j] {
                        if clip.visible {
                            let cb = self.render_layer(clip, base);
                            composite_into(&mut buf, &cb, clip.blend, clip.opacity, true);
                        }
                    }
                    composite_into(out, &buf, head.blend, head.opacity, false);
                }
            }
            i = j;
        }
    }

    /// One layer alone (content, transform, mask), straight RGBA; opacity
    /// and blend are applied by the caller.
    pub fn render_layer(&self, layer: &Layer, base: &Affine) -> Vec<u8> {
        let (w, h) = (self.w, self.h);
        let m = base.then_after(&layer.transform.affine());
        let mut buf = vec![0u8; w * h * 4];
        match &layer.content {
            Content::Raster(px) => sample_raster(px, w, h, &m, &mut buf),
            Content::Shape(shape) => {
                let inv = m.invert();
                if let Some(inv) = inv {
                    for py in 0..h {
                        for pxx in 0..w {
                            let (x, y) = inv.apply(pxx as f64 + 0.5, py as f64 + 0.5);
                            if raster::shape_covers(shape, x, y) {
                                let o = (py * w + pxx) * 4;
                                buf[o..o + 4].copy_from_slice(&shape.fill);
                            }
                        }
                    }
                }
            }
            Content::Path(path) => {
                let polys = vector::flatten(&path.subpaths, &m);
                let fill = path.fill.as_ref().map(|p| (vector::fill_coverage(&polys, path.fill_rule, w, h), p));
                let stroke = path
                    .stroke
                    .as_ref()
                    .map(|s| (vector::stroke_coverage(&polys, s, m.mean_scale(), w, h), &s.paint));
                let order: [Option<(Vec<f32>, &Paint)>; 2] = match path.paint_order {
                    PaintOrder::FillStroke => [fill, stroke],
                    PaintOrder::StrokeFill => [stroke, fill],
                };
                for (cov, paint) in order.into_iter().flatten() {
                    paint_coverage(&mut buf, &cov, paint, &m, w);
                }
            }
            Content::Group => self.render_children(Some(layer.id), &m, &mut buf),
            Content::Boolean { op, fill } => {
                let cov = self.boolean_coverage(layer.id, *op, &m);
                let paint = fill.clone().unwrap_or(Paint::solid([0, 0, 0, 255]));
                paint_coverage(&mut buf, &cov, &paint, &m, w);
            }
        }
        if let Some(mask) = &layer.mask {
            for (i, px) in buf.chunks_exact_mut(4).enumerate() {
                let v = mask.value(i) as u32;
                px[3] = ((px[3] as u32 * v + 127) / 255) as u8;
            }
        }
        buf
    }

    /// Geometry of a vector operand in canvas space (fill polygons).
    fn operand_polys(&self, layer: &Layer, m: &Affine) -> Option<(Vec<Polyline>, FillRule)> {
        match &layer.content {
            Content::Shape(s) => Some((vector::flatten(&vector::shape_to_subpaths(s), m), FillRule::Nonzero)),
            Content::Path(p) => Some((vector::flatten(&p.subpaths, m), p.fill_rule)),
            _ => None,
        }
    }

    fn boolean_coverage(&self, id: u64, op: BoolOp, m: &Affine) -> Vec<f32> {
        let mut acc: Option<Vec<f32>> = None;
        for operand in self.children(Some(id)) {
            if !operand.visible {
                continue;
            }
            let om = m.then_after(&operand.transform.affine());
            let Some((polys, rule)) = self.operand_polys(operand, &om) else { continue };
            let cov = vector::fill_coverage(&polys, rule, self.w, self.h);
            acc = Some(match acc {
                None => cov,
                Some(a) => a
                    .iter()
                    .zip(&cov)
                    .map(|(&a, &b)| match op {
                        BoolOp::Union => a.max(b),
                        BoolOp::Subtract => a * (1.0 - b),
                        BoolOp::Intersect => a.min(b),
                        BoolOp::Exclude => (a + b - 2.0 * a * b).clamp(0.0, 1.0),
                    })
                    .collect(),
            });
        }
        acc.unwrap_or_else(|| vec![0.0; self.w * self.h])
    }

    /// Content bounds in canvas space (transformed corners + AABB).
    pub fn bounds(&self, layer: &Layer) -> Option<([(f64, f64); 4], Rect)> {
        let base = self.parent_affine(layer);
        self.bounds_with(layer, &base)
    }

    fn bounds_with(&self, layer: &Layer, base: &Affine) -> Option<([(f64, f64); 4], Rect)> {
        let m = base.then_after(&layer.transform.affine());
        match &layer.content {
            Content::Raster(px) => {
                let mut alpha = Vec::with_capacity(self.w * self.h);
                alpha.extend(px.chunks_exact(4).map(|p| p[3]));
                let (x, y, w, h) = crate::select::bounds(&alpha, self.w, self.h)?;
                Some(Rect { x: x as f64, y: y as f64, w: w as f64, h: h as f64 }.transformed(&m))
            }
            Content::Shape(s) => Some(Rect { x: s.x, y: s.y, w: s.w, h: s.h }.transformed(&m)),
            Content::Path(p) => {
                let polys = vector::flatten(&p.subpaths, &Affine::IDENTITY);
                let pts: Vec<(f64, f64)> = polys.iter().flat_map(|pl| pl.pts.iter().copied()).collect();
                let mut r = Rect::from_points(&pts)?;
                if let Some(s) = &p.stroke {
                    let hw = s.width / 2.0;
                    r = Rect { x: r.x - hw, y: r.y - hw, w: r.w + 2.0 * hw, h: r.h + 2.0 * hw };
                }
                Some(r.transformed(&m))
            }
            Content::Group | Content::Boolean { .. } => {
                let mut acc: Option<Rect> = None;
                for kid in self.children(Some(layer.id)) {
                    if let Some((_, r)) = self.bounds_with(kid, &m) {
                        acc = Some(acc.map_or(r, |a| a.union(&r)));
                    }
                }
                let r = acc?;
                Some((r.corners(), r))
            }
        }
    }

    /// Alpha (0..=255) a layer contributes at canvas point `(x, y)`,
    /// ignoring layer opacity. Used by `hitTest`.
    pub fn alpha_at(&self, layer: &Layer, base: &Affine, x: f64, y: f64) -> u8 {
        if !layer.visible {
            return 0;
        }
        let m = base.then_after(&layer.transform.affine());
        let a = match &layer.content {
            Content::Raster(px) => m.invert().map_or(0, |inv| {
                let (cx, cy) = inv.apply(x, y);
                if cx < 0.0 || cy < 0.0 || cx >= self.w as f64 || cy >= self.h as f64 {
                    0
                } else {
                    px.get(((cy as usize) * self.w + cx as usize) * 4 + 3).copied().unwrap_or(0)
                }
            }),
            Content::Shape(s) => m.invert().map_or(0, |inv| {
                let (cx, cy) = inv.apply(x, y);
                if raster::shape_covers(s, cx, cy) { s.fill[3] } else { 0 }
            }),
            Content::Path(p) => {
                let polys = vector::flatten(&p.subpaths, &m);
                let filled = p.fill.is_some() && vector::point_in_fill(&polys, p.fill_rule, x, y);
                let stroked = p
                    .stroke
                    .as_ref()
                    .is_some_and(|s| vector::point_on_stroke(&polys, s.width * m.mean_scale() / 2.0, x, y));
                if filled || stroked { 255 } else { 0 }
            }
            Content::Group => self.children(Some(layer.id)).map(|k| self.alpha_at(k, &m, x, y)).max().unwrap_or(0),
            Content::Boolean { op, .. } => {
                let mut acc: Option<bool> = None;
                for k in self.children(Some(layer.id)) {
                    let km = m.then_after(&k.transform.affine());
                    let Some((polys, rule)) = self.operand_polys(k, &km) else { continue };
                    let hit = vector::point_in_fill(&polys, rule, x, y);
                    acc = Some(match (acc, op) {
                        (None, _) => hit,
                        (Some(a), BoolOp::Union) => a || hit,
                        (Some(a), BoolOp::Subtract) => a && !hit,
                        (Some(a), BoolOp::Intersect) => a && hit,
                        (Some(a), BoolOp::Exclude) => a != hit,
                    });
                }
                if acc.unwrap_or(false) { 255 } else { 0 }
            }
        };
        match &layer.mask {
            Some(mask) if x >= 0.0 && y >= 0.0 && (x as usize) < self.w && (y as usize) < self.h => {
                ((a as u32 * mask.value(y as usize * self.w + x as usize) as u32) / 255) as u8
            }
            _ => a,
        }
    }
}

fn paint_coverage(buf: &mut [u8], cov: &[f32], paint: &Paint, m: &Affine, w: usize) {
    let sampler = Sampler::new(paint, m);
    for (i, &c) in cov.iter().enumerate() {
        if c <= 0.0 {
            continue;
        }
        let (x, y) = ((i % w) as f64 + 0.5, (i / w) as f64 + 0.5);
        let mut col = sampler.at(x, y);
        col[3] = (col[3] as f32 * c.min(1.0)).round() as u8;
        raster::blend_pixel(&mut buf[i * 4..i * 4 + 4], &col, 1.0);
    }
}

/// Resample a canvas-sized raster through `m` (bilinear, premultiplied).
fn sample_raster(px: &[u8], w: usize, h: usize, m: &Affine, out: &mut [u8]) {
    if m.is_identity() {
        let n = px.len().min(out.len());
        out[..n].copy_from_slice(&px[..n]);
        return;
    }
    let Some(inv) = m.invert() else { return };
    // Integer translations stay pixel-exact.
    if m.a == 1.0 && m.b == 0.0 && m.c == 0.0 && m.d == 1.0 && m.e.fract() == 0.0 && m.f.fract() == 0.0 {
        let (dx, dy) = (m.e as i64, m.f as i64);
        for y in 0..h as i64 {
            let sy = y - dy;
            if sy < 0 || sy >= h as i64 {
                continue;
            }
            for x in 0..w as i64 {
                let sx = x - dx;
                if sx < 0 || sx >= w as i64 {
                    continue;
                }
                let s = ((sy as usize) * w + sx as usize) * 4;
                let d = ((y as usize) * w + x as usize) * 4;
                out[d..d + 4].copy_from_slice(&px[s..s + 4]);
            }
        }
        return;
    }
    let fetch = |x: i64, y: i64| -> [f64; 4] {
        if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
            return [0.0; 4];
        }
        let o = ((y as usize) * w + x as usize) * 4;
        let a = px[o + 3] as f64 / 255.0;
        [px[o] as f64 * a, px[o + 1] as f64 * a, px[o + 2] as f64 * a, a]
    };
    for y in 0..h {
        for x in 0..w {
            let (sx, sy) = inv.apply(x as f64 + 0.5, y as f64 + 0.5);
            let (fx, fy) = (sx - 0.5, sy - 0.5);
            let (x0, y0) = (fx.floor() as i64, fy.floor() as i64);
            let (tx, ty) = (fx - x0 as f64, fy - y0 as f64);
            let p = [fetch(x0, y0), fetch(x0 + 1, y0), fetch(x0, y0 + 1), fetch(x0 + 1, y0 + 1)];
            let wts = [(1.0 - tx) * (1.0 - ty), tx * (1.0 - ty), (1.0 - tx) * ty, tx * ty];
            let mut acc = [0.0; 4];
            for k in 0..4 {
                for c in 0..4 {
                    acc[c] += p[k][c] * wts[k];
                }
            }
            if acc[3] <= 0.0 {
                continue;
            }
            let o = (y * w + x) * 4;
            for c in 0..3 {
                out[o + c] = (acc[c] / acc[3]).round().clamp(0.0, 255.0) as u8;
            }
            out[o + 3] = (acc[3] * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// Crop `src` (`sw*sh` RGBA) to the integer region, transparent outside.
pub fn crop(src: &[u8], sw: usize, sh: usize, x: i64, y: i64, w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h * 4];
    for r in 0..h as i64 {
        let sy = y + r;
        if sy < 0 || sy >= sh as i64 {
            continue;
        }
        for c in 0..w as i64 {
            let sx = x + c;
            if sx < 0 || sx >= sw as i64 {
                continue;
            }
            let s = ((sy as usize) * sw + sx as usize) * 4;
            let d = ((r as usize) * w + c as usize) * 4;
            out[d..d + 4].copy_from_slice(&src[s..s + 4]);
        }
    }
    out
}

/// Area-average downscale to fit inside `max × max`, keeping aspect ratio.
/// Images already inside the box are returned as-is (never upscaled).
pub fn fit(src: &[u8], w: usize, h: usize, max: usize) -> (Vec<u8>, usize, usize) {
    if w == 0 || h == 0 {
        return (Vec::new(), 0, 0);
    }
    if w <= max && h <= max {
        return (src.to_vec(), w, h);
    }
    let s = (max as f64 / w as f64).min(max as f64 / h as f64);
    let tw = ((w as f64 * s).round() as usize).max(1);
    let th = ((h as f64 * s).round() as usize).max(1);
    let mut out = vec![0u8; tw * th * 4];
    for ty in 0..th {
        let y0 = ty * h / th;
        let y1 = ((ty + 1) * h / th).max(y0 + 1);
        for tx in 0..tw {
            let x0 = tx * w / tw;
            let x1 = ((tx + 1) * w / tw).max(x0 + 1);
            let mut acc = [0f64; 4];
            let mut n = 0f64;
            for y in y0..y1 {
                for x in x0..x1 {
                    let o = (y * w + x) * 4;
                    let a = src[o + 3] as f64;
                    acc[0] += src[o] as f64 * a;
                    acc[1] += src[o + 1] as f64 * a;
                    acc[2] += src[o + 2] as f64 * a;
                    acc[3] += a;
                    n += 1.0;
                }
            }
            let o = (ty * tw + tx) * 4;
            if acc[3] > 0.0 {
                for c in 0..3 {
                    out[o + c] = (acc[c] / acc[3]).round().clamp(0.0, 255.0) as u8;
                }
            }
            out[o + 3] = (acc[3] / n).round().clamp(0.0, 255.0) as u8;
        }
    }
    (out, tw, th)
}
