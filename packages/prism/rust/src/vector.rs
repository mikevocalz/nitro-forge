//! Vector rasterization: Bézier flattening, anti-aliased fills (4×4
//! supersampled scanlines with nonzero/even-odd winding), strokes with
//! joins, caps and dashes, gradient paint, and shape-to-path conversion.
//!
//! Everything works in canvas space: callers pass the layer's effective
//! affine, control points are transformed (affine maps Béziers exactly), and
//! paint is sampled by inverse-mapping pixel centers into content space.

use crate::geom::Affine;
use crate::model::{FillRule, LineCap, LineJoin, Node, NodeKind, Paint, Shape, ShapeKind, Stop, Stroke, Subpath};

pub type Pt = (f64, f64);

/// A flattened subpath in canvas space.
pub struct Polyline {
    pub pts: Vec<Pt>,
    pub closed: bool,
}

fn add(a: Pt, b: Pt) -> Pt {
    (a.0 + b.0, a.1 + b.1)
}
fn sub(a: Pt, b: Pt) -> Pt {
    (a.0 - b.0, a.1 - b.1)
}
fn scale(a: Pt, s: f64) -> Pt {
    (a.0 * s, a.1 * s)
}
fn dot(a: Pt, b: Pt) -> f64 {
    a.0 * b.0 + a.1 * b.1
}
fn cross(a: Pt, b: Pt) -> f64 {
    a.0 * b.1 - a.1 * b.0
}
fn len(a: Pt) -> f64 {
    a.0.hypot(a.1)
}
fn dist(a: Pt, b: Pt) -> f64 {
    len(sub(a, b))
}

fn cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: &mut Vec<Pt>) {
    let poly = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
    let n = ((poly * 2.0).sqrt().ceil() as usize).clamp(1, 256);
    for i in 1..=n {
        let t = i as f64 / n as f64;
        let mt = 1.0 - t;
        let a = mt * mt * mt;
        let b = 3.0 * mt * mt * t;
        let c = 3.0 * mt * t * t;
        let d = t * t * t;
        out.push((
            a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
            a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
        ));
    }
}

fn segment(from: &Node, to: &Node, m: &Affine, out: &mut Vec<Pt>) {
    let p0 = m.apply(from.x, from.y);
    let p3 = m.apply(to.x, to.y);
    if from.out_handle.is_none() && to.in_handle.is_none() {
        out.push(p3);
        return;
    }
    let h0 = from.out_handle.unwrap_or([0.0, 0.0]);
    let h3 = to.in_handle.unwrap_or([0.0, 0.0]);
    let p1 = m.apply(from.x + h0[0], from.y + h0[1]);
    let p2 = m.apply(to.x + h3[0], to.y + h3[1]);
    cubic(p0, p1, p2, p3, out);
}

/// Flatten subpaths through `m` into canvas-space polylines.
pub fn flatten(subpaths: &[Subpath], m: &Affine) -> Vec<Polyline> {
    subpaths
        .iter()
        .map(|sp| {
            let mut pts = Vec::with_capacity(sp.nodes.len() * 4);
            if let Some(first) = sp.nodes.first() {
                pts.push(m.apply(first.x, first.y));
                for w in sp.nodes.windows(2) {
                    segment(&w[0], &w[1], m, &mut pts);
                }
                if sp.closed && sp.nodes.len() > 1 {
                    segment(&sp.nodes[sp.nodes.len() - 1], first, m, &mut pts);
                    // The closing segment ends on the first point; drop the
                    // duplicate so joins see the true corner.
                    if pts.len() > 1 && dist(pts[0], pts[pts.len() - 1]) < 1e-9 {
                        pts.pop();
                    }
                }
            }
            Polyline { pts, closed: sp.closed }
        })
        .collect()
}

/// Shape rect/ellipse as a closed path in content space (ellipse: four
/// cubic arcs, κ = 0.5523).
pub fn shape_to_subpaths(s: &Shape) -> Vec<Subpath> {
    let node = |x: f64, y: f64, i: Option<[f64; 2]>, o: Option<[f64; 2]>, kind| Node {
        x,
        y,
        in_handle: i,
        out_handle: o,
        kind,
    };
    let nodes = match s.kind {
        ShapeKind::Rect => vec![
            node(s.x, s.y, None, None, NodeKind::Corner),
            node(s.x + s.w, s.y, None, None, NodeKind::Corner),
            node(s.x + s.w, s.y + s.h, None, None, NodeKind::Corner),
            node(s.x, s.y + s.h, None, None, NodeKind::Corner),
        ],
        ShapeKind::Ellipse => {
            const K: f64 = 0.552_284_749_8;
            let (rx, ry) = (s.w / 2.0, s.h / 2.0);
            let (cx, cy) = (s.x + rx, s.y + ry);
            let (kx, ky) = (rx * K, ry * K);
            vec![
                node(cx, cy - ry, Some([-kx, 0.0]), Some([kx, 0.0]), NodeKind::Symmetric),
                node(cx + rx, cy, Some([0.0, -ky]), Some([0.0, ky]), NodeKind::Symmetric),
                node(cx, cy + ry, Some([kx, 0.0]), Some([-kx, 0.0]), NodeKind::Symmetric),
                node(cx - rx, cy, Some([0.0, ky]), Some([0.0, -ky]), NodeKind::Symmetric),
            ]
        }
    };
    vec![Subpath { closed: true, nodes }]
}

// -- fills ------------------------------------------------------------------

const SS: usize = 4; // samples per axis

fn inside(rule: FillRule, winding: i32) -> bool {
    match rule {
        FillRule::Nonzero => winding != 0,
        FillRule::Evenodd => winding % 2 != 0,
    }
}

/// Anti-aliased fill coverage (0..=1 per pixel) of closed polygons.
pub fn fill_coverage(polys: &[Polyline], rule: FillRule, w: usize, h: usize) -> Vec<f32> {
    let mut cov = vec![0f32; w * h];
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    let (mut ymin, mut ymax) = (f64::INFINITY, f64::NEG_INFINITY);
    for p in polys {
        let n = p.pts.len();
        if n < 2 {
            continue;
        }
        for i in 0..n {
            let a = p.pts[i];
            let b = p.pts[(i + 1) % n];
            if a.1 != b.1 {
                edges.push((a, b));
                ymin = ymin.min(a.1.min(b.1));
                ymax = ymax.max(a.1.max(b.1));
            }
        }
    }
    if edges.is_empty() || w == 0 || h == 0 {
        return cov;
    }
    let r0 = ymin.floor().max(0.0) as usize;
    let r1 = (ymax.ceil().max(0.0) as usize).min(h);
    let weight = 1.0 / (SS * SS) as f32;
    let mut xs: Vec<(f64, i32)> = Vec::new();
    let max_k = (w * SS) as i64;
    for row in r0..r1 {
        for sy in 0..SS {
            let y = row as f64 + (sy as f64 + 0.5) / SS as f64;
            xs.clear();
            for &(a, b) in &edges {
                let (lo, hi, dir) = if a.1 < b.1 { (a, b, 1) } else { (b, a, -1) };
                if y >= lo.1 && y < hi.1 {
                    let t = (y - lo.1) / (hi.1 - lo.1);
                    xs.push((lo.0 + t * (hi.0 - lo.0), dir));
                }
            }
            xs.sort_by(|p, q| p.0.total_cmp(&q.0));
            let mut wind = 0;
            for i in 0..xs.len() {
                wind += xs[i].1;
                if i + 1 >= xs.len() || !inside(rule, wind) {
                    continue;
                }
                let (xa, xb) = (xs[i].0, xs[i + 1].0);
                let k0 = ((xa * SS as f64) - 0.5).ceil().max(0.0) as i64;
                let k1 = (((xb * SS as f64) - 0.5).ceil() as i64).min(max_k);
                let base = row * w;
                let mut k = k0;
                while k < k1 {
                    cov[base + (k as usize) / SS] += weight;
                    k += 1;
                }
            }
        }
    }
    cov
}

/// Winding test of one point (hit-testing).
pub fn point_in_fill(polys: &[Polyline], rule: FillRule, x: f64, y: f64) -> bool {
    let mut wind = 0;
    for p in polys {
        let n = p.pts.len();
        if n < 2 {
            continue;
        }
        for i in 0..n {
            let a = p.pts[i];
            let b = p.pts[(i + 1) % n];
            if a.1 == b.1 {
                continue;
            }
            let (lo, hi, dir) = if a.1 < b.1 { (a, b, 1) } else { (b, a, -1) };
            if y >= lo.1 && y < hi.1 {
                let t = (y - lo.1) / (hi.1 - lo.1);
                if lo.0 + t * (hi.0 - lo.0) < x {
                    wind += dir;
                }
            }
        }
    }
    inside(rule, wind)
}

// -- strokes ----------------------------------------------------------------

fn clamp01(v: f64) -> f32 {
    v.clamp(0.0, 1.0) as f32
}

struct Raster<'a> {
    cov: &'a mut [f32],
    w: usize,
    h: usize,
}

impl Raster<'_> {
    fn each(&mut self, x0: f64, y0: f64, x1: f64, y1: f64, mut f: impl FnMut(Pt) -> f32) {
        let px0 = x0.floor().max(0.0) as usize;
        let py0 = y0.floor().max(0.0) as usize;
        let px1 = (x1.ceil().max(0.0) as usize).min(self.w);
        let py1 = (y1.ceil().max(0.0) as usize).min(self.h);
        for py in py0..py1 {
            for px in px0..px1 {
                let c = f((px as f64 + 0.5, py as f64 + 0.5));
                let slot = &mut self.cov[py * self.w + px];
                if c > *slot {
                    *slot = c;
                }
            }
        }
    }

    fn seg(&mut self, p: Pt, q: Pt, hw: f64) {
        let l = dist(p, q);
        if l < 1e-9 {
            return;
        }
        let u = scale(sub(q, p), 1.0 / l);
        let pad = hw + 1.0;
        self.each(p.0.min(q.0) - pad, p.1.min(q.1) - pad, p.0.max(q.0) + pad, p.1.max(q.1) + pad, |c| {
            let d = sub(c, p);
            let t = dot(d, u);
            let perp = cross(u, d).abs();
            clamp01(hw - perp + 0.5) * clamp01(t.min(l - t) + 0.5)
        });
    }

    fn disk(&mut self, c0: Pt, r: f64) {
        self.each(c0.0 - r - 1.0, c0.1 - r - 1.0, c0.0 + r + 1.0, c0.1 + r + 1.0, |c| clamp01(r - dist(c, c0) + 0.5));
    }

    fn convex(&mut self, poly: &[Pt]) {
        let n = poly.len();
        let mut area = 0.0;
        for i in 0..n {
            area += cross(poly[i], poly[(i + 1) % n]);
        }
        if area.abs() < 1e-12 {
            return;
        }
        let sign = area.signum();
        let xs = poly.iter().map(|p| p.0);
        let ys = poly.iter().map(|p| p.1);
        let x0 = xs.clone().fold(f64::INFINITY, f64::min) - 1.0;
        let x1 = xs.fold(f64::NEG_INFINITY, f64::max) + 1.0;
        let y0 = ys.clone().fold(f64::INFINITY, f64::min) - 1.0;
        let y1 = ys.fold(f64::NEG_INFINITY, f64::max) + 1.0;
        self.each(x0, y0, x1, y1, |c| {
            let mut m = f64::INFINITY;
            for i in 0..n {
                let a = poly[i];
                let b = poly[(i + 1) % n];
                let e = sub(b, a);
                let el = len(e);
                if el < 1e-12 {
                    continue;
                }
                m = m.min(sign * cross(e, sub(c, a)) / el);
            }
            clamp01(m + 0.5)
        });
    }

    fn join(&mut self, v: Pt, d0: Pt, d1: Pt, hw: f64, join: LineJoin, limit: f64) {
        let c = cross(d0, d1);
        let dp = dot(d0, d1);
        if c.abs() < 1e-9 && dp > 0.0 {
            return; // collinear
        }
        if join == LineJoin::Round {
            self.disk(v, hw);
            return;
        }
        if c.abs() < 1e-9 {
            return; // full reversal: butt ends meet
        }
        let side = if c > 0.0 { -1.0 } else { 1.0 };
        let n0 = scale((-d0.1, d0.0), side * hw);
        let n1 = scale((-d1.1, d1.0), side * hw);
        let a = add(v, n0);
        let b = add(v, n1);
        if join == LineJoin::Miter {
            let cos_phi = dot((-d0.1, d0.0), (-d1.1, d1.0)).clamp(-1.0, 1.0);
            let ratio = (2.0 / (1.0 + cos_phi)).sqrt();
            if ratio.is_finite() && ratio <= limit {
                let bis = add(n0, n1);
                let bl = len(bis);
                if bl > 1e-12 {
                    let tip = add(v, scale(bis, hw * ratio / bl));
                    self.convex(&[v, a, tip, b]);
                    return;
                }
            }
        }
        self.convex(&[v, a, b]);
    }
}

fn unit(a: Pt, b: Pt) -> Option<Pt> {
    let d = sub(b, a);
    let l = len(d);
    (l > 1e-9).then(|| scale(d, 1.0 / l))
}

fn stroke_piece(r: &mut Raster, pts: &[Pt], closed: bool, hw: f64, s: &Stroke) {
    // Drop consecutive duplicates so directions are defined.
    let mut p: Vec<Pt> = Vec::with_capacity(pts.len());
    for &q in pts {
        if p.last().is_none_or(|l| dist(*l, q) > 1e-9) {
            p.push(q);
        }
    }
    if p.len() == 1 {
        // A zero-length subpath draws a dot only with round/square caps.
        match s.cap {
            LineCap::Round => r.disk(p[0], hw),
            LineCap::Square => r.convex(&[
                (p[0].0 - hw, p[0].1 - hw),
                (p[0].0 + hw, p[0].1 - hw),
                (p[0].0 + hw, p[0].1 + hw),
                (p[0].0 - hw, p[0].1 + hw),
            ]),
            LineCap::Butt => {}
        }
        return;
    }
    let n = p.len();
    let segs = if closed { n } else { n - 1 };
    for i in 0..segs {
        r.seg(p[i], p[(i + 1) % n], hw);
    }
    let joins: Vec<usize> = if closed { (0..n).collect() } else { (1..n - 1).collect() };
    for i in joins {
        let prev = p[(i + n - 1) % n];
        let next = p[(i + 1) % n];
        if let (Some(d0), Some(d1)) = (unit(prev, p[i]), unit(p[i], next)) {
            r.join(p[i], d0, d1, hw, s.join, s.miter_limit);
        }
    }
    if !closed {
        for (end, inner) in [(p[0], p[1]), (p[n - 1], p[n - 2])] {
            match s.cap {
                LineCap::Butt => {}
                LineCap::Round => r.disk(end, hw),
                LineCap::Square => {
                    if let Some(u) = unit(inner, end) {
                        r.seg(end, add(end, scale(u, hw)), hw);
                    }
                }
            }
        }
    }
}

/// Split a polyline into "on" dash pieces.
fn dashes(pts: &[Pt], closed: bool, pattern: &[f64], offset: f64) -> Vec<Vec<Pt>> {
    let mut pat: Vec<f64> = pattern.to_vec();
    if pat.len() % 2 == 1 {
        pat.extend_from_slice(pattern);
    }
    let total: f64 = pat.iter().sum();
    let mut path: Vec<Pt> = pts.to_vec();
    if closed && !pts.is_empty() {
        path.push(pts[0]);
    }
    let mut idx = 0usize;
    let mut left = pat[0];
    let mut on = true;
    // Advance by the offset.
    let mut off = offset.rem_euclid(total);
    while off > 0.0 {
        if off >= left {
            off -= left;
            idx = (idx + 1) % pat.len();
            left = pat[idx];
            on = !on;
        } else {
            left -= off;
            off = 0.0;
        }
    }
    let mut out: Vec<Vec<Pt>> = Vec::new();
    let mut cur: Vec<Pt> = if on && !path.is_empty() { vec![path[0]] } else { Vec::new() };
    let mut guard = 0usize;
    for w in path.windows(2) {
        let (mut a, b) = (w[0], w[1]);
        let mut seg_left = dist(a, b);
        while seg_left > 1e-12 {
            guard += 1;
            if guard > 2_000_000 {
                return out;
            }
            let step = seg_left.min(left);
            let t = step / seg_left;
            let pnt = (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
            if on {
                cur.push(pnt);
            }
            a = pnt;
            seg_left -= step;
            left -= step;
            if left <= 1e-12 {
                if on && cur.len() > 1 {
                    out.push(std::mem::take(&mut cur));
                }
                cur.clear();
                idx = (idx + 1) % pat.len();
                left = pat[idx];
                on = !on;
                if on {
                    cur.push(a);
                }
            }
        }
    }
    if on && cur.len() > 1 {
        out.push(cur);
    }
    out
}

/// Anti-aliased stroke coverage. `width_scale` maps content stroke width
/// to canvas pixels (the affine's mean scale).
pub fn stroke_coverage(polys: &[Polyline], s: &Stroke, width_scale: f64, w: usize, h: usize) -> Vec<f32> {
    let mut cov = vec![0f32; w * h];
    let hw = s.width * width_scale / 2.0;
    let mut r = Raster { cov: &mut cov, w, h };
    for p in polys {
        if p.pts.is_empty() {
            continue;
        }
        if s.dash.is_empty() {
            stroke_piece(&mut r, &p.pts, p.closed && p.pts.len() > 2, hw, s);
        } else {
            let pattern: Vec<f64> = s.dash.iter().map(|d| d * width_scale).collect();
            for piece in dashes(&p.pts, p.closed, &pattern, s.dash_offset * width_scale) {
                stroke_piece(&mut r, &piece, false, hw, s);
            }
        }
    }
    cov
}

/// Distance-based stroke hit test.
pub fn point_on_stroke(polys: &[Polyline], hw: f64, x: f64, y: f64) -> bool {
    let c = (x, y);
    for p in polys {
        let n = p.pts.len();
        if n == 1 && dist(p.pts[0], c) <= hw {
            return true;
        }
        let segs = if p.closed { n } else { n.saturating_sub(1) };
        for i in 0..segs {
            let a = p.pts[i];
            let b = p.pts[(i + 1) % n];
            let ab = sub(b, a);
            let l2 = dot(ab, ab);
            let t = if l2 > 0.0 { (dot(sub(c, a), ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
            if dist(add(a, scale(ab, t)), c) <= hw {
                return true;
            }
        }
    }
    false
}

// -- paint ------------------------------------------------------------------

fn lerp_stops(stops: &[Stop], t: f64) -> [u8; 4] {
    let t = t.clamp(0.0, 1.0);
    let first = &stops[0];
    if t <= first.offset {
        return first.color;
    }
    for w in stops.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        if t <= b.offset {
            let span = b.offset - a.offset;
            let k = if span <= 0.0 { 1.0 } else { (t - a.offset) / span };
            let mut out = [0u8; 4];
            for i in 0..4 {
                out[i] = (a.color[i] as f64 + (b.color[i] as f64 - a.color[i] as f64) * k)
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
            return out;
        }
    }
    stops[stops.len() - 1].color
}

/// Evaluates a paint at canvas pixel centers.
pub struct Sampler<'a> {
    paint: &'a Paint,
    inv: Affine,
}

impl<'a> Sampler<'a> {
    pub fn new(paint: &'a Paint, m: &Affine) -> Sampler<'a> {
        Sampler { paint, inv: m.invert().unwrap_or(Affine::IDENTITY) }
    }

    pub fn at(&self, cx: f64, cy: f64) -> [u8; 4] {
        match self.paint {
            Paint::Solid { color } => *color,
            Paint::Linear { x0, y0, x1, y1, stops } => {
                let (x, y) = self.inv.apply(cx, cy);
                let d = (x1 - x0, y1 - y0);
                let l2 = dot(d, d);
                if l2 <= 0.0 {
                    return stops[stops.len() - 1].color;
                }
                lerp_stops(stops, dot((x - x0, y - y0), d) / l2)
            }
            Paint::Radial { cx: gx, cy: gy, r, fx, fy, stops } => {
                let (x, y) = self.inv.apply(cx, cy);
                let f = (fx.unwrap_or(*gx), fy.unwrap_or(*gy));
                let q = (x - f.0, y - f.1);
                let e = (gx - f.0, gy - f.1);
                let a = dot(e, e) - r * r; // < 0: focal strictly inside
                let b = -2.0 * dot(q, e);
                let c = dot(q, q);
                let disc = (b * b - 4.0 * a * c).max(0.0);
                let t = if a.abs() < 1e-12 { 0.0 } else { (-b - disc.sqrt()) / (2.0 * a) };
                lerp_stops(stops, t)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, s: f64) -> Polyline {
        Polyline { pts: vec![(x, y), (x + s, y), (x + s, y + s), (x, y + s)], closed: true }
    }

    #[test]
    fn fill_square_exact_pixels() {
        let c = fill_coverage(&[square(1.0, 1.0, 2.0)], FillRule::Nonzero, 4, 4);
        assert_eq!(c[5], 1.0);
        assert_eq!(c[10], 1.0);
        assert_eq!(c[0], 0.0);
        assert_eq!(c[15], 0.0);
    }

    #[test]
    fn fill_half_pixel_is_half_covered() {
        let c = fill_coverage(&[square(0.5, 0.0, 1.0)], FillRule::Nonzero, 2, 1);
        assert!((c[0] - 0.5).abs() < 1e-6 && (c[1] - 0.5).abs() < 1e-6, "{c:?}");
    }

    #[test]
    fn evenodd_punches_hole() {
        let polys = [square(0.0, 0.0, 6.0), square(2.0, 2.0, 2.0)];
        let nz = fill_coverage(&polys, FillRule::Nonzero, 6, 6);
        let eo = fill_coverage(&polys, FillRule::Evenodd, 6, 6);
        assert_eq!(nz[2 * 6 + 2], 1.0);
        assert_eq!(eo[2 * 6 + 2], 0.0);
        assert_eq!(eo[0], 1.0);
    }

    #[test]
    fn stroke_caps_differ() {
        let line = [Polyline { pts: vec![(2.0, 5.0), (8.0, 5.0)], closed: false }];
        let mk = |cap| Stroke {
            paint: Paint::solid([0, 0, 0, 255]),
            width: 2.0,
            join: LineJoin::Miter,
            cap,
            miter_limit: 4.0,
            dash: vec![],
            dash_offset: 0.0,
        };
        let butt = stroke_coverage(&line, &mk(LineCap::Butt), 1.0, 10, 10);
        let square = stroke_coverage(&line, &mk(LineCap::Square), 1.0, 10, 10);
        assert_eq!(butt[4 * 10 + 1], 0.0, "butt ends at x=2");
        assert_eq!(square[4 * 10 + 1], 1.0, "square cap extends by half width");
        assert_eq!(butt[4 * 10 + 5], 1.0);
    }

    #[test]
    fn dashes_leave_gaps() {
        let line = [Polyline { pts: vec![(0.0, 2.0), (12.0, 2.0)], closed: false }];
        let s = Stroke {
            paint: Paint::solid([0, 0, 0, 255]),
            width: 2.0,
            join: LineJoin::Miter,
            cap: LineCap::Butt,
            miter_limit: 4.0,
            dash: vec![2.0, 2.0],
            dash_offset: 0.0,
        };
        let c = stroke_coverage(&line, &s, 1.0, 12, 4);
        assert_eq!(c[12 + 0], 1.0);
        assert_eq!(c[12 + 2], 0.0);
        assert_eq!(c[12 + 4], 1.0);
    }

    #[test]
    fn miter_fills_corner_bevel_does_not() {
        let corner = [Polyline { pts: vec![(2.0, 8.0), (2.0, 2.0), (8.0, 2.0)], closed: false }];
        let mk = |join| Stroke {
            paint: Paint::solid([0, 0, 0, 255]),
            width: 2.0,
            join,
            cap: LineCap::Butt,
            miter_limit: 4.0,
            dash: vec![],
            dash_offset: 0.0,
        };
        let miter = stroke_coverage(&corner, &mk(LineJoin::Miter), 1.0, 10, 10);
        let bevel = stroke_coverage(&corner, &mk(LineJoin::Bevel), 1.0, 10, 10);
        // Outer corner pixel (1,1) center (1.5,1.5).
        assert_eq!(miter[10 + 1], 1.0);
        assert!(bevel[10 + 1] < 1.0);
    }

    #[test]
    fn linear_and_radial_paint() {
        let lin = Paint::Linear {
            x0: 0.0,
            y0: 0.0,
            x1: 10.0,
            y1: 0.0,
            stops: vec![Stop { offset: 0.0, color: [0, 0, 0, 255] }, Stop { offset: 1.0, color: [200, 0, 0, 255] }],
        };
        let s = Sampler::new(&lin, &Affine::IDENTITY);
        assert_eq!(s.at(5.0, 3.0), [100, 0, 0, 255]);
        assert_eq!(s.at(-5.0, 0.0), [0, 0, 0, 255]);
        let rad = Paint::Radial {
            cx: 0.0,
            cy: 0.0,
            r: 10.0,
            fx: None,
            fy: None,
            stops: vec![Stop { offset: 0.0, color: [0, 0, 0, 255] }, Stop { offset: 1.0, color: [0, 200, 0, 255] }],
        };
        let s = Sampler::new(&rad, &Affine::IDENTITY);
        assert_eq!(s.at(5.0, 0.0), [0, 100, 0, 255]);
        assert_eq!(s.at(0.0, 20.0), [0, 200, 0, 255]);
        let focal = Paint::Radial {
            cx: 0.0,
            cy: 0.0,
            r: 10.0,
            fx: Some(5.0),
            fy: Some(0.0),
            stops: vec![Stop { offset: 0.0, color: [0, 0, 0, 255] }, Stop { offset: 1.0, color: [0, 0, 200, 255] }],
        };
        let s = Sampler::new(&focal, &Affine::IDENTITY);
        assert_eq!(s.at(5.0, 0.0), [0, 0, 0, 255], "t=0 at the focal point");
        assert_eq!(s.at(-10.0, 0.0), [0, 0, 200, 255], "t=1 on the circle");
    }

    #[test]
    fn ellipse_path_matches_area() {
        let s = Shape { kind: ShapeKind::Ellipse, x: 0.0, y: 0.0, w: 20.0, h: 20.0, fill: [0, 0, 0, 255] };
        let polys = flatten(&shape_to_subpaths(&s), &Affine::IDENTITY);
        let c = fill_coverage(&polys, FillRule::Nonzero, 20, 20);
        let area: f32 = c.iter().sum();
        let expect = std::f32::consts::PI * 100.0;
        assert!((area - expect).abs() / expect < 0.01, "{area} vs {expect}");
    }
}
