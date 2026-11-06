//! Alpha-mask math shared by the pixel selection and layer masks: region
//! rasterization, combine modes, feathering, grow/shrink (exact Euclidean
//! distance transform), and color-range region growing for the magic wand
//! and flood fill.

use crate::geom::Affine;
use crate::model::{FillRule, Node, NodeKind, Shape, ShapeKind, Subpath};
use crate::vector;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Combine {
    Replace,
    Add,
    Subtract,
    Intersect,
}

impl Combine {
    pub fn parse(s: &str) -> Option<Combine> {
        Some(match s {
            "replace" => Combine::Replace,
            "add" => Combine::Add,
            "subtract" => Combine::Subtract,
            "intersect" => Combine::Intersect,
            _ => return None,
        })
    }
}

/// Region shapes accepted by `selectRegion`.
#[derive(Debug, Clone)]
pub enum Region {
    Rect { x: f64, y: f64, w: f64, h: f64 },
    Ellipse { x: f64, y: f64, w: f64, h: f64 },
    Polygon(Vec<(f64, f64)>),
}

/// Anti-aliased `w*h` alpha for a region.
pub fn rasterize(region: &Region, w: usize, h: usize) -> Vec<u8> {
    let subpaths: Vec<Subpath> = match region {
        Region::Rect { x, y, w: rw, h: rh } => vector::shape_to_subpaths(&Shape {
            kind: ShapeKind::Rect,
            x: *x,
            y: *y,
            w: *rw,
            h: *rh,
            fill: [0; 4],
        }),
        Region::Ellipse { x, y, w: rw, h: rh } => vector::shape_to_subpaths(&Shape {
            kind: ShapeKind::Ellipse,
            x: *x,
            y: *y,
            w: *rw,
            h: *rh,
            fill: [0; 4],
        }),
        Region::Polygon(pts) => vec![Subpath {
            closed: true,
            nodes: pts
                .iter()
                .map(|&(x, y)| Node { x, y, in_handle: None, out_handle: None, kind: NodeKind::Corner })
                .collect(),
        }],
    };
    let polys = vector::flatten(&subpaths, &Affine::IDENTITY);
    vector::fill_coverage(&polys, FillRule::Nonzero, w, h)
        .into_iter()
        .map(|c| (c * 255.0).round().clamp(0.0, 255.0) as u8)
        .collect()
}

/// Combine `new` into `cur` (`None` = nothing selected).
pub fn combine(cur: Option<&[u8]>, new: &[u8], mode: Combine) -> Vec<u8> {
    let zero = vec![0u8; new.len()];
    let cur = cur.unwrap_or(&zero);
    cur.iter()
        .zip(new)
        .map(|(&a, &b)| match mode {
            Combine::Replace => b,
            Combine::Add => a.max(b),
            Combine::Subtract => ((a as u32 * (255 - b as u32) + 127) / 255) as u8,
            Combine::Intersect => a.min(b),
        })
        .collect()
}

pub fn is_empty(mask: &[u8]) -> bool {
    mask.iter().all(|&v| v == 0)
}

/// Bounding box of non-zero alpha: `(x, y, w, h)`.
pub fn bounds(mask: &[u8], w: usize, h: usize) -> Option<(usize, usize, usize, usize)> {
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] > 0 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    (x0 != usize::MAX).then(|| (x0, y0, x1 - x0 + 1, y1 - y0 + 1))
}

fn box_blur_pass(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize, horizontal: bool) {
    let (outer, inner) = if horizontal { (h, w) } else { (w, h) };
    let idx = |o: usize, i: usize| if horizontal { o * w + i } else { i * w + o };
    let norm = 1.0 / (2 * r + 1) as f32;
    for o in 0..outer {
        let mut acc = 0f32;
        // Edge pixels extend (clamp-to-edge).
        for k in 0..=2 * r {
            let i = k.saturating_sub(r).min(inner - 1);
            acc += src[idx(o, i)];
        }
        for i in 0..inner {
            dst[idx(o, i)] = acc * norm;
            let add = (i + r + 1).min(inner - 1);
            let rem = i.saturating_sub(r);
            acc += src[idx(o, add)] - src[idx(o, rem)];
        }
    }
}

/// Approximate Gaussian feather: three separable box blurs.
pub fn feather(mask: &[u8], w: usize, h: usize, radius: f64) -> Vec<u8> {
    if radius <= 0.0 || w == 0 || h == 0 {
        return mask.to_vec();
    }
    let r = ((radius / 3.0).round() as usize).max(1);
    let mut a: Vec<f32> = mask.iter().map(|&v| v as f32).collect();
    let mut b = vec![0f32; a.len()];
    for _ in 0..3 {
        box_blur_pass(&a, &mut b, w, h, r, true);
        box_blur_pass(&b, &mut a, w, h, r, false);
    }
    a.into_iter().map(|v| v.round().clamp(0.0, 255.0) as u8).collect()
}

/// 1D squared distance transform (Felzenszwalb–Huttenlocher).
fn edt_1d(f: &[f64], d: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    let n = f.len();
    let mut k = 0usize;
    v[0] = 0;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        loop {
            let p = v[k];
            let s = ((f[q] + (q * q) as f64) - (f[p] + (p * p) as f64)) / (2.0 * q as f64 - 2.0 * p as f64);
            if s <= z[k] && k > 0 {
                k -= 1;
                continue;
            }
            if s <= z[k] {
                // k == 0: replace the only parabola.
                v[0] = q;
                z[0] = f64::NEG_INFINITY;
                z[1] = f64::INFINITY;
                break;
            }
            k += 1;
            v[k] = q;
            z[k] = s;
            z[k + 1] = f64::INFINITY;
            break;
        }
    }
    k = 0;
    for q in 0..n {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let p = v[k];
        d[q] = (q as f64 - p as f64).powi(2) + f[p];
    }
}

/// Squared Euclidean distance from every pixel to the nearest pixel where
/// `seed` is true.
fn distance_sq(seed: &[bool], w: usize, h: usize) -> Vec<f64> {
    const INF: f64 = 1e20;
    let mut grid: Vec<f64> = seed.iter().map(|&s| if s { 0.0 } else { INF }).collect();
    let n = w.max(h);
    let mut f = vec![0.0; n];
    let mut d = vec![0.0; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0; n + 1];
    for x in 0..w {
        for y in 0..h {
            f[y] = grid[y * w + x];
        }
        edt_1d(&f[..h], &mut d[..h], &mut v[..h], &mut z[..h + 1]);
        for y in 0..h {
            grid[y * w + x] = d[y];
        }
    }
    for y in 0..h {
        f[..w].copy_from_slice(&grid[y * w..y * w + w]);
        edt_1d(&f[..w], &mut d[..w], &mut v[..w], &mut z[..w + 1]);
        grid[y * w..y * w + w].copy_from_slice(&d[..w]);
    }
    grid
}

/// Grow (`radius > 0`) or shrink (`radius < 0`) the region at the 50%
/// threshold. The result is hard-edged; feather afterwards to soften.
pub fn grow(mask: &[u8], w: usize, h: usize, radius: f64) -> Vec<u8> {
    if radius == 0.0 || w == 0 || h == 0 {
        return mask.to_vec();
    }
    let on: Vec<bool> = mask.iter().map(|&v| v >= 128).collect();
    if radius > 0.0 {
        let dist = distance_sq(&on, w, h);
        let r2 = radius * radius;
        dist.iter().map(|&d| if d <= r2 { 255 } else { 0 }).collect()
    } else {
        let off: Vec<bool> = on.iter().map(|b| !b).collect();
        if off.iter().all(|b| !b) {
            // Everything selected: shrink from the canvas edge.
            let r = (-radius).ceil() as usize;
            return (0..w * h)
                .map(|i| {
                    let (x, y) = (i % w, i / w);
                    let edge = x.min(y).min(w - 1 - x).min(h - 1 - y);
                    if edge >= r { 255 } else { 0 }
                })
                .collect();
        }
        let dist = distance_sq(&off, w, h);
        let r2 = radius * radius;
        dist.iter().zip(&on).map(|(&d, &o)| if o && d > r2 { 255 } else { 0 }).collect()
    }
}

/// Pixels whose RGBA is within `tolerance` (max channel difference) of the
/// seed, either connected to the seed (4-neighborhood) or anywhere.
pub fn color_region(rgba: &[u8], w: usize, h: usize, x: usize, y: usize, tolerance: u8, contiguous: bool) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    if x >= w || y >= h || rgba.len() < w * h * 4 {
        return out;
    }
    let s = (y * w + x) * 4;
    let seed = [rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]];
    let close = |i: usize| {
        let o = i * 4;
        (0..4).all(|c| rgba[o + c].abs_diff(seed[c]) <= tolerance)
    };
    if !contiguous {
        for (i, v) in out.iter_mut().enumerate() {
            if close(i) {
                *v = 255;
            }
        }
        return out;
    }
    let mut stack = vec![y * w + x];
    out[y * w + x] = 255;
    while let Some(i) = stack.pop() {
        let (cx, cy) = (i % w, i / w);
        let mut push = |j: usize| {
            if out[j] == 0 && close(j) {
                out[j] = 255;
                stack.push(j);
            }
        };
        if cx > 0 {
            push(i - 1);
        }
        if cx + 1 < w {
            push(i + 1);
        }
        if cy > 0 {
            push(i - w);
        }
        if cy + 1 < h {
            push(i + w);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_region_and_combine_modes() {
        let a = rasterize(&Region::Rect { x: 0.0, y: 0.0, w: 2.0, h: 2.0 }, 4, 4);
        let b = rasterize(&Region::Rect { x: 1.0, y: 1.0, w: 2.0, h: 2.0 }, 4, 4);
        assert_eq!(a[0], 255);
        assert_eq!(a[2], 0);
        let add = combine(Some(&a), &b, Combine::Add);
        assert_eq!(add[2 * 4 + 2], 255);
        let sub = combine(Some(&a), &b, Combine::Subtract);
        assert_eq!(sub[4 + 1], 0);
        assert_eq!(sub[0], 255);
        let int = combine(Some(&a), &b, Combine::Intersect);
        assert_eq!(int.iter().filter(|&&v| v == 255).count(), 1);
    }

    #[test]
    fn grow_and_shrink_by_distance() {
        let mut m = vec![0u8; 81];
        m[4 * 9 + 4] = 255;
        let g = grow(&m, 9, 9, 2.0);
        assert_eq!(g[4 * 9 + 6], 255);
        assert_eq!(g[4 * 9 + 7], 0);
        assert_eq!(g[6 * 9 + 6], 0, "corner at distance 2.83 stays out");
        let s = grow(&g, 9, 9, -1.0);
        assert_eq!(s[4 * 9 + 4], 255);
        assert_eq!(s[4 * 9 + 6], 0);
    }

    #[test]
    fn color_region_contiguous_vs_global() {
        // 3x1: red, blue, red
        let px = [255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255];
        assert_eq!(color_region(&px, 3, 1, 0, 0, 0, true), vec![255, 0, 0]);
        assert_eq!(color_region(&px, 3, 1, 0, 0, 0, false), vec![255, 0, 255]);
    }

    #[test]
    fn feather_softens_edges() {
        let mut m = vec![0u8; 100];
        for y in 0..10 {
            for x in 0..5 {
                m[y * 10 + x] = 255;
            }
        }
        let f = feather(&m, 10, 10, 3.0);
        assert!(f[5 * 10 + 4] < 255 && f[5 * 10 + 5] > 0);
    }
}

/// Pull canvas coverage into raster-local texels. Sampling the mask once per
/// local pixel avoids repeated blending when a transformed pixel spans several
/// canvas pixels. Bilinear coverage preserves feathered/partial selections.
pub fn pullback_coverage(canvas: &[u8], w: usize, h: usize, local_to_canvas: &Affine) -> Vec<u8> {
    let mut local = vec![0; w * h];
    for y in 0..h {
        for x in 0..w {
            let (cx, cy) = local_to_canvas.apply(x as f64 + 0.5, y as f64 + 0.5);
            if !cx.is_finite() || !cy.is_finite() || cx < 0.0 || cy < 0.0 || cx >= w as f64 || cy >= h as f64 {
                continue;
            }
            let fx = (cx - 0.5).clamp(0.0, (w - 1) as f64);
            let fy = (cy - 0.5).clamp(0.0, (h - 1) as f64);
            let (x0, y0) = (fx.floor() as usize, fy.floor() as usize);
            let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
            let (tx, ty) = (fx - x0 as f64, fy - y0 as f64);
            let coverage = canvas[y0 * w + x0] as f64 * (1.0 - tx) * (1.0 - ty)
                + canvas[y0 * w + x1] as f64 * tx * (1.0 - ty)
                + canvas[y1 * w + x0] as f64 * (1.0 - tx) * ty
                + canvas[y1 * w + x1] as f64 * tx * ty;
            local[y * w + x] = coverage.round().clamp(0.0, 255.0) as u8;
        }
    }
    local
}
