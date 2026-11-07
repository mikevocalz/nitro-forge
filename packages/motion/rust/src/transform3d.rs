//! Bounded layer 3D transform model (slice G1): storage, scalar-curve
//! evaluation and an honest orthographic read-back projection. There is no
//! 3D rasterizer — `renderFrame` ignores `transform3d` entirely until slice
//! G2 lands true projection rendering.
//!
//! `Transform3D` is the minimal After-Effects-like orientation/depth subset:
//! `rx`/`ry` are X/Y euler rotations in degrees and `z` is depth along the
//! view axis. The existing `transform.rotation` field remains the Z-axis
//! roll, `tx`/`ty` remain position X/Y and `sx`/`sy`/`ox`/`oy` are
//! unchanged, so a 3D layer needs no new position, scale, roll or anchor
//! fields. Presence of `transform3d` marks a layer as 3D-enabled; `rx`, `ry`
//! and `z` are ordinary scalar curve properties (no angle wrapping — the
//! same ±1e7 bound as `rotation`/`tx`).
//!
//! `evaluate` reports each 3D layer's evaluated `{rx,ry,z}` plus a read-only
//! `projected_transform`: the orthographic projection (view axis = the
//! layer's local Z, depth dropped) of the layer's *local* transform — the
//! evaluated 2D transform extended into 3D, then rotated about the anchor
//! point by `RotY(ry)·RotX(rx)` — as a 2×3 affine `{a,b,c,d,e,f}` where
//! `x' = a·x + c·y + e` and `y' = b·x + d·y + f`. The projected affine can
//! carry shear that the pivoted `Transform` fields cannot express, so it is
//! reported as raw coefficients rather than folded into `transform`. `z`
//! does not affect the orthographic projection, and the 2D `rotation` roll
//! composes inside the pre-tilt transform (it is not re-ordered into the
//! 3D euler chain); both are documented G1 limitations reserved for the G2
//! camera/projection design. Parent composition stays local-only exactly
//! like the existing 2D `transform` report.
use crate::{transform_affine, Transform};
use serde::{Deserialize, Serialize};

/// Same absolute bound as the 2D transform's translation/origin/rotation
/// fields; angles are bounded, not wrapped.
pub const MAX_3D: f64 = 1e7;

/// Optional per-layer 3D orientation/depth. `rx`/`ry` rotate the layer's
/// plane about its anchor in degrees; `z` is depth toward the viewer.
/// Additive serde defaults keep snapshot schema at 2.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transform3D {
    /// X euler rotation in degrees.
    #[serde(default)]
    pub rx: f64,
    /// Y euler rotation in degrees.
    #[serde(default)]
    pub ry: f64,
    /// Depth along the view axis; positive toward the viewer. No render or
    /// projection effect until G2 — orthographic projection drops z.
    #[serde(default)]
    pub z: f64,
}

impl Transform3D {
    pub fn valid(&self) -> bool {
        [self.rx, self.ry, self.z]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= MAX_3D)
    }
}

/// Orthographic projection of the layer's local transform with `t3d`
/// orientation, returned as a 2×3 affine `[a,b,c,d,e,f]`:
/// `x' = a·x + c·y + e`, `y' = b·x + d·y + f` (the same coefficient layout
/// as `transform_affine`). The map is `screen = anchor + P·RotY(ry)·RotX(rx)·(T2D(p) - anchor)`
/// where `anchor` is the pivot's position after the 2D transform; `z` never
/// reaches the screen under orthographic projection.
pub fn projected_affine(t2d: &Transform, t3d: &Transform3D) -> [f64; 6] {
    let j = transform_affine(t2d);
    let (srx, crx) = t3d.rx.to_radians().sin_cos();
    let (sry, cry) = t3d.ry.to_radians().sin_cos();
    // Only the top two rows of R3D = RotY(ry)·RotX(rx) reach the screen:
    // r00 = cry, r01 = sry·srx, r10 = 0, r11 = crx (r02/r12 multiply z = 0).
    let r00 = cry;
    let r01 = sry * srx;
    let r11 = crx;
    // Pivot position in the containing composition's 2D space: the 2D
    // transform lands (ox,oy) at (tx+ox, ty+oy).
    let ax = j.a * t2d.ox + j.c * t2d.oy + j.e;
    let ay = j.b * t2d.ox + j.d * t2d.oy + j.f;
    [
        r00 * j.a + r01 * j.b,
        r11 * j.b,
        r00 * j.c + r01 * j.d,
        r11 * j.d,
        ax + r00 * (j.e - ax) + r01 * (j.f - ay),
        ay + r11 * (j.f - ay),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_orientation_projects_to_the_2d_affine() {
        let t2d = Transform::default();
        let p = projected_affine(&t2d, &Transform3D::default());
        assert_eq!(p, [1., 0., 0., 1., 0., 0.]);
    }
    #[test]
    fn edge_on_rotations_collapse_the_projected_axis() {
        let t2d = Transform::default();
        // rx = 90°: the layer plane is edge-on to the view axis, so the
        // projected y coefficient vanishes (a horizontal line, not an error).
        let p = projected_affine(&t2d, &Transform3D { rx: 90., ry: 0., z: 0. });
        assert!((p[0] - 1.).abs() < 1e-12 && p[3].abs() < 1e-12);
        // ry = 90° collapses the projected x coefficient instead.
        let p = projected_affine(&t2d, &Transform3D { rx: 0., ry: 90., z: 0. });
        assert!(p[0].abs() < 1e-12 && (p[3] - 1.).abs() < 1e-12);
    }
    #[test]
    fn combined_tilt_produces_shear_the_2d_transform_cannot_express() {
        let t2d = Transform::default();
        let p = projected_affine(
            &t2d,
            &Transform3D { rx: 30., ry: 45., z: 7. },
        );
        // a' = cos(ry), c' = sin(ry)·sin(rx): nonzero off-diagonal shear.
        let (sry, cry) = 45f64.to_radians().sin_cos();
        let (srx, _) = 30f64.to_radians().sin_cos();
        assert!((p[0] - cry).abs() < 1e-12);
        assert!((p[2] - sry * srx).abs() < 1e-12);
        // z is depth only: it never enters the orthographic coefficients.
        let q = projected_affine(&t2d, &Transform3D { rx: 30., ry: 45., z: -9e6 });
        assert_eq!(p, q);
    }
}
