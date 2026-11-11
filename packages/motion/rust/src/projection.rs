//! G2 orthographic 3D raster resampling: the evaluated `projected_transform`
//! affine (slice G1) applied to a layer's canvas-space content buffer on the
//! CPU, then uploaded through the same `addRasterLayer`+`drawPixels` path
//! effects/mattes/particles already use. See
//! `docs/completion/reports/P11-motion-g23-decisions.md` — Option A was
//! chosen: motion-side affine resampling, `z` inert, no camera, no
//! perspective, no depth sort, nearest-neighbor filtering (aliasing on
//! minification is a documented limitation, no mipmaps).
//!
//! Under the G1 orthographic model (view axis = layer-local Z) the
//! projection of a rotated plane is always affine — rotation, non-uniform
//! scale AND shear — so a single inverse-mapped nearest tap per destination
//! pixel is exact math for the admitted model, not an approximation of a
//! projective warp. True perspective/camera/depth (the deferred "G2b")
//! needs per-pixel homography plus depth buffering and is out of scope.
use crate::particles::{self, ParticleEmitter, SpawnRect};
use crate::transform3d::projected_affine;
use crate::{Affine, Layer};
use ignition_core::{EngineError, TaskContext};
use std::collections::{BTreeMap, BTreeSet};

fn bad(message: &str) -> EngineError {
    EngineError::validation(message)
}
/// Checkpoint cadence for the per-pixel resample loop.
const CHECKPOINT_PX: usize = 1 << 18;
/// Relative singularity threshold on the affine's linear part: degenerate
/// when |det| <= EPS * ||L||_F^2, which is scale-invariant (a uniformly
/// scaled layer keeps the same ratio). This catches the edge-on cases
/// (rx or ry = ±90° collapses the projected plane to zero area) without
/// rejecting legitimately tiny scales — sx/sy are already bounded away
/// from 0 at 1e-6, giving a smallest legit ratio near 1e-12·scale² terms
/// that still clears the threshold.
const SINGULAR_EPS: f64 = 1e-12;

fn affine6(p: [f64; 6]) -> Affine {
    Affine {
        a: p[0],
        b: p[1],
        c: p[2],
        d: p[3],
        e: p[4],
        f: p[5],
    }
}
/// Effective projected affine of a layer: its own
/// `projected_affine(transform, transform3d)` composed through the
/// `parent_id` chain, where each ancestor contributes its own projected
/// affine (identity-3D ancestors reduce to their plain 2D affine, so the
/// chain generalizes `effective_affine`). A 3D ancestor's orientation
/// therefore propagates to 3D descendants; non-3D layers never take this
/// path and are unaffected by a parent's `transform3d`. Mirrors
/// `effective_affine`'s cycle/missing-parent errors.
pub fn effective_projected(
    layer: &Layer,
    by_id: &BTreeMap<u64, &Layer>,
) -> Result<Affine, EngineError> {
    let t3 = layer.transform3d.unwrap_or_default();
    let mut acc = affine6(projected_affine(&layer.transform, &t3));
    let mut seen = BTreeSet::new();
    let mut current = layer.parent_id;
    while let Some(pid) = current {
        if !seen.insert(pid) {
            return Err(bad("layer parent cycle"));
        }
        let parent = by_id
            .get(&pid)
            .ok_or_else(|| bad("layer parent must be a layer in the same composition"))?;
        let pt = parent.transform3d.unwrap_or_default();
        acc = affine6(projected_affine(&parent.transform, &pt)).then_after(&acc);
        current = parent.parent_id;
    }
    Ok(acc)
}
/// Nearest-neighbor affine resample of packed straight-alpha RGBA `src`
/// (`sw`x`sh`) into a `sw`x`sh` destination through `m`
/// (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`). Each destination pixel
/// center is inverse-mapped and the containing source texel copied;
/// out-of-range taps produce transparent black. A (near-)singular linear
/// part — the edge-on projection cases — yields an all-transparent buffer:
/// a zero-area projection honestly contributes zero pixels. Identity `m`
/// reproduces `src` byte-for-byte.
pub fn resample(
    src: &[u8],
    sw: usize,
    sh: usize,
    m: &Affine,
    ctx: Option<&TaskContext>,
) -> Result<Vec<u8>, EngineError> {
    let (w, h) = (sw, sh);
    let mut dst = vec![0u8; w.saturating_mul(h).saturating_mul(4)];
    let (a, b, c, d, e, f) = (m.a, m.b, m.c, m.d, m.e, m.f);
    let det = a * d - b * c;
    let fro = a * a + b * b + c * c + d * d;
    if !det.is_finite() || !fro.is_finite() || fro <= 0. || det.abs() <= SINGULAR_EPS * fro {
        return Ok(dst);
    }
    // Inverse linear part: [x;y] = 1/det · [d -c; -b a] · (q - t).
    let ia = d / det;
    let ib = -c / det;
    let ic = -b / det;
    let idd = a / det;
    let (wf, hf) = (w as f64, h as f64);
    let mut ticks = 0usize;
    for y in 0..h {
        for x in 0..w {
            ticks += 1;
            if ticks % CHECKPOINT_PX == 0 {
                if let Some(c) = ctx {
                    c.checkpoint()?;
                }
            }
            let qx = x as f64 + 0.5 - e;
            let qy = y as f64 + 0.5 - f;
            let sx = ia * qx + ib * qy;
            let sy = ic * qx + idd * qy;
            // floor() of the source-space point selects the containing texel;
            // the !(..) form also rejects NaN from non-finite intermediates.
            let tx = sx.floor();
            let ty = sy.floor();
            if !(tx >= 0. && tx < wf && ty >= 0. && ty < hf) {
                continue;
            }
            let si = ((ty as usize) * w + tx as usize) * 4;
            let di = (y * w + x) * 4;
            dst[di..di + 4].copy_from_slice(&src[si..si + 4]);
        }
    }
    Ok(dst)
}
/// Clone `emitter` with `spawn` resolved into layer-local coordinates for
/// the identity-affine staging a 3D resample uses: the default canvas
/// spawn rect maps through the inverse of the layer's projected affine
/// `m` (the same `spawn_local` math the 2D path applies with the effective
/// affine), and an explicit spawn rect passes through unchanged. Sprite
/// *scale* is intentionally not baked — the resample carries it, at the
/// documented nearest-neighbor aliasing cost.
pub fn emitter_in_local_space(
    emitter: &ParticleEmitter,
    m: &Affine,
    canvas_w: f64,
    canvas_h: f64,
) -> ParticleEmitter {
    let mut e = emitter.clone();
    let (x, y, w, h) = particles::spawn_local(&e, m, canvas_w, canvas_h);
    e.spawn = Some(SpawnRect { x, y, w, h });
    e
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_resample_is_byte_identical() {
        let src: Vec<u8> = (0..4 * 3 * 4).map(|i| (i % 251) as u8).collect();
        let m = Affine {
            a: 1.,
            b: 0.,
            c: 0.,
            d: 1.,
            e: 0.,
            f: 0.,
        };
        assert_eq!(resample(&src, 4, 3, &m, None).unwrap(), src);
    }
    #[test]
    fn translation_and_scale_map_pixels_deterministically() {
        // 4x1 src: [A,B,C,D]; translate +2 then the dst sees A at x=2.
        let src = vec![
            255, 0, 0, 255, // x=0 red
            0, 255, 0, 255, // x=1 green
            0, 0, 255, 255, // x=2 blue
            9, 9, 9, 9, // x=3
        ];
        // dst is 6 wide; m maps local->canvas with tx=+2.
        let m = Affine {
            a: 1.,
            b: 0.,
            c: 0.,
            d: 1.,
            e: 2.,
            f: 0.,
        };
        // resample requires dst dims == src dims, so the shifted content is
        // verified on a 6x1 canvas whose first 4 px hold the authored rect.
        let mut wide = vec![0u8; 6 * 4];
        wide[..src.len()].copy_from_slice(&src);
        // Content authored at x=0..4 shifted right 2 lands at dst x=2..6 —
        // but only x<6 fits; verify via inverse mapping on the padded src.
        let out = resample(&wide, 6, 1, &m, None).unwrap();
        // dst x=2 samples src x=0 (red), x=3 -> src1 (green), x=4 -> src2
        // (blue), x=5 -> src3 (9,9,9,9); x=0,1 sample negative -> transparent.
        assert_eq!(&out[8..12], &[255, 0, 0, 255]);
        assert_eq!(&out[12..16], &[0, 255, 0, 255]);
        assert_eq!(&out[16..20], &[0, 0, 255, 255]);
        assert_eq!(&out[20..24], &[9, 9, 9, 9]);
        assert_eq!(&out[0..4], &[0, 0, 0, 0]);
        // Scale x by 0.5: dst x samples src 2x+... verify compress direction:
        // m: x' = 0.5 x  => src_x = 2*(dst center)-ish; dst x=0 -> src ~0.5->0? floor(2*(0.5))=1? compute: sx = (px+0.5-e)/0.5 with e=0 -> for px=0: 1.0 -> floor 1.
        let m2 = Affine {
            a: 0.5,
            b: 0.,
            c: 0.,
            d: 1.,
            e: 0.,
            f: 0.,
        };
        let out2 = resample(&wide, 6, 1, &m2, None).unwrap();
        // px=0 -> sx=1.0 -> src x=1 (green); px=1 -> sx=3.0 -> src x=3.
        assert_eq!(&out2[0..4], &[0, 255, 0, 255]);
        assert_eq!(&out2[4..8], &[9, 9, 9, 9]);
    }
    #[test]
    fn singular_projection_is_transparent_not_garbage() {
        // rx=90° collapse: linear part [[1,0],[0,~0]] -> det ~ 0.
        let m = Affine {
            a: 1.,
            b: 0.,
            c: 0.,
            d: 1e-17,
            e: 0.,
            f: 0.,
        };
        let src = vec![255u8; 4 * 4 * 4];
        let out = resample(&src, 4, 4, &m, None).unwrap();
        assert!(out.iter().all(|v| *v == 0));
    }
}
