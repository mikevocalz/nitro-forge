//! Pixel math: src-over compositing, filters, shape rasterization, and
//! canvas-region helpers. All functions are panic-free for any buffer
//! contents; callers guarantee region bounds before calling read/write.

use ignition_core::EngineError;

use crate::model::{Shape, ShapeKind};
use crate::{RenderTask, CHECKPOINT_EVERY_PX};

/// Source-over alpha blend of one straight-alpha RGBA `src` pixel onto `dst`
/// (a 4-byte slice), with the source alpha pre-scaled by `opacity` (0..=1).
///
/// out_a = sa + da(1-sa); out_c = (sc*sa + dc*da(1-sa)) / out_a.
pub fn blend_pixel(dst: &mut [u8], src: &[u8; 4], opacity: f64) {
    if dst.len() < 4 {
        return;
    }
    let sa = (src[3] as f64 / 255.0) * opacity;
    if sa <= 0.0 {
        return; // fully transparent source leaves dst untouched
    }
    let da = dst[3] as f64 / 255.0;
    let inv = 1.0 - sa;
    let out_a = sa + da * inv;
    if out_a <= 0.0 {
        dst[0] = 0;
        dst[1] = 0;
        dst[2] = 0;
        dst[3] = 0;
        return;
    }
    for c in 0..3 {
        let s = src[c] as f64 * sa;
        let d = dst[c] as f64 * da * inv;
        dst[c] = ((s + d) / out_a).round().clamp(0.0, 255.0) as u8;
    }
    dst[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
}

/// Whether the pixel with center `(px, py)` is covered by `shape`.
/// Rect covers `[x, x+w) x [y, y+h)`; ellipse covers points where
/// `((px-cx)/rx)^2 + ((py-cy)/ry)^2 <= 1` with center at the shape's center.
pub fn shape_covers(shape: &Shape, px: f64, py: f64) -> bool {
    match shape.kind {
        ShapeKind::Rect => {
            px >= shape.x && px < shape.x + shape.w && py >= shape.y && py < shape.y + shape.h
        }
        ShapeKind::Ellipse => {
            let rx = shape.w / 2.0;
            let ry = shape.h / 2.0;
            if rx <= 0.0 || ry <= 0.0 {
                return false;
            }
            let dx = (px - (shape.x + rx)) / rx;
            let dy = (py - (shape.y + ry)) / ry;
            dx * dx + dy * dy <= 1.0
        }
    }
}

/// Per-channel filters applied in place to an RGBA buffer. Alpha is never
/// touched. Checkpoints every `CHECKPOINT_EVERY_PX` pixels when `task` has
/// a context.
pub enum Filter {
    Grayscale,
    Invert,
    Brightness(f64), // amount -1..=1, scaled by 255
}

pub fn apply_filter(
    buf: &mut [u8],
    filter: &Filter,
    task: &mut RenderTask,
) -> Result<(), EngineError> {
    let total = (buf.len() / 4).max(1) as f32;
    for (i, px) in buf.chunks_exact_mut(4).enumerate() {
        task.tick(i, CHECKPOINT_EVERY_PX, i as f32 / total)?;
        match filter {
            Filter::Grayscale => {
                // ITU-R 601 luma coefficients.
                let y = (0.299 * px[0] as f64
                    + 0.587 * px[1] as f64
                    + 0.114 * px[2] as f64)
                    .round()
                    .clamp(0.0, 255.0) as u8;
                px[0] = y;
                px[1] = y;
                px[2] = y;
            }
            Filter::Invert => {
                px[0] = 255 - px[0];
                px[1] = 255 - px[1];
                px[2] = 255 - px[2];
            }
            Filter::Brightness(amount) => {
                let delta = amount * 255.0;
                for c in 0..3 {
                    px[c] = (px[c] as f64 + delta).round().clamp(0.0, 255.0) as u8;
                }
            }
        }
    }
    Ok(())
}

/// Copy a `w*h` pixel region out of a canvas-sized buffer. Assumes
/// `x+w <= canvas_w`, `y*h` rows fit, and `buf` is at least
/// `canvas_w * canvas_h * 4` — callers clip first. Out-of-range rows are
/// defensively returned as transparent so no input can panic.
pub fn read_region(
    buf: &[u8],
    canvas_w: usize,
    x: usize,
    y: usize,
    w: usize,
    h: usize,
) -> Vec<u8> {
    let row_len = w.saturating_mul(4);
    let mut out = Vec::with_capacity(row_len.saturating_mul(h));
    for r in 0..h {
        let off = (y + r).saturating_mul(canvas_w).saturating_mul(4) + x.saturating_mul(4);
        let end = off.saturating_add(row_len);
        if end <= buf.len() {
            out.extend_from_slice(&buf[off..end]);
        } else {
            out.resize(out.len() + row_len, 0);
        }
    }
    out
}

/// Write a `w*h` region of `src` (must be `w*h*4` bytes) into a canvas-sized
/// buffer at `(x, y)`. Rows that do not fit are skipped.
pub fn write_region(
    buf: &mut [u8],
    canvas_w: usize,
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    src: &[u8],
) {
    let row_len = w.saturating_mul(4);
    for r in 0..h {
        let src_off = r.saturating_mul(row_len);
        let src_end = src_off.saturating_add(row_len);
        if src_end > src.len() {
            break;
        }
        let dst_off = (y + r).saturating_mul(canvas_w).saturating_mul(4) + x.saturating_mul(4);
        let dst_end = dst_off.saturating_add(row_len);
        if dst_end <= buf.len() {
            buf[dst_off..dst_end].copy_from_slice(&src[src_off..src_end]);
        }
    }
}

/// Resample `src` (`sw*sh` RGBA) translated by `(tx, ty)` source pixels into
/// a `dw*dh` buffer: `out[x,y]` reads `src` at `(x + tx, y + ty)` with
/// premultiplied bilinear filtering, transparent outside. Integer offsets
/// are pixel-exact, so `crop` on untransformed content is lossless.
pub fn resample_translated(
    src: &[u8],
    sw: usize,
    sh: usize,
    tx: f64,
    ty: f64,
    dw: usize,
    dh: usize,
    task: &mut RenderTask,
) -> Result<Vec<u8>, EngineError> {
    let mut out = vec![0u8; dw.saturating_mul(dh).saturating_mul(4)];
    if dw == 0 || dh == 0 || sw == 0 || sh == 0 {
        return Ok(out);
    }
    let fetch = |x: i64, y: i64| -> [f64; 4] {
        if x < 0 || y < 0 || x >= sw as i64 || y >= sh as i64 {
            return [0.0; 4];
        }
        let o = ((y as usize) * sw + x as usize) * 4;
        if o + 4 > src.len() {
            return [0.0; 4];
        }
        let a = src[o + 3] as f64 / 255.0;
        [src[o] as f64 * a, src[o + 1] as f64 * a, src[o + 2] as f64 * a, a]
    };
    let total = (dw * dh).max(1) as f32;
    for y in 0..dh {
        for x in 0..dw {
            let i = y * dw + x;
            task.tick(i, CHECKPOINT_EVERY_PX, i as f32 / total)?;
            // Texel k covers continuous coords [k + 0.5, k + 1.5): sample the
            // destination center shifted by the translation, then drop the
            // half-texel origin exactly like render::sample_raster.
            let fx = x as f64 + tx;
            let fy = y as f64 + ty;
            let (x0, y0) = (fx.floor() as i64, fy.floor() as i64);
            let (txf, tyf) = (fx - x0 as f64, fy - y0 as f64);
            let p = [
                fetch(x0, y0),
                fetch(x0 + 1, y0),
                fetch(x0, y0 + 1),
                fetch(x0 + 1, y0 + 1),
            ];
            let wts = [
                (1.0 - txf) * (1.0 - tyf),
                txf * (1.0 - tyf),
                (1.0 - txf) * tyf,
                txf * tyf,
            ];
            let mut acc = [0.0; 4];
            for k in 0..4 {
                for c in 0..4 {
                    acc[c] += p[k][c] * wts[k];
                }
            }
            if acc[3] <= 0.0 {
                continue;
            }
            let o = i * 4;
            for c in 0..3 {
                out[o + c] = (acc[c] / acc[3]).round().clamp(0.0, 255.0) as u8;
            }
            out[o + 3] = (acc[3] * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    Ok(out)
}

/// Crop/pad a canvas buffer to new dimensions, top-left aligned, padding
/// with transparent black.
pub fn resize_canvas(buf: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<u8> {
    let mut out = vec![0u8; dw.saturating_mul(dh).saturating_mul(4)];
    let copy_w = sw.min(dw);
    let copy_h = sh.min(dh);
    for r in 0..copy_h {
        let src_off = r.saturating_mul(sw).saturating_mul(4);
        let src_end = src_off.saturating_add(copy_w.saturating_mul(4));
        let dst_off = r.saturating_mul(dw).saturating_mul(4);
        let dst_end = dst_off.saturating_add(copy_w.saturating_mul(4));
        if src_end <= buf.len() && dst_end <= out.len() {
            out[dst_off..dst_end].copy_from_slice(&buf[src_off..src_end]);
        }
    }
    out
}
