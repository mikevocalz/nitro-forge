//! Deterministic primitive mesh generators (B1/B2 scope): box, plane,
//! sphere, cylinder, torus in mesh-local space, +Y up, right-handed,
//! outward-facing winding (counter-clockwise seen from outside — the same
//! front-face convention `scene-render`'s rasterizer culls against).
//! All loops run in fixed order over f32 `sin`/`cos`; libm is not
//! correctly-rounded, so cross-target bit parity is not claimed (same
//! caveat as `rust/scene-render`). Segment counts are bounded (2..=256).

use crate::codec::{encode_f32, encode_u32};
use crate::math::V3;

pub struct Geometry {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
}

impl Geometry {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
    /// Encode into the canonical b64 fields `Mesh` stores.
    pub fn into_b64(self) -> (String, String, String, String) {
        (
            encode_f32(&self.positions),
            encode_f32(&self.normals),
            encode_f32(&self.uvs),
            encode_u32(&self.indices),
        )
    }
}

fn push_v(g: &mut Geometry, p: V3, n: V3, uv: [f32; 2]) {
    g.positions.extend_from_slice(&p);
    g.normals.extend_from_slice(&n);
    g.uvs.extend_from_slice(&uv);
}

fn tri(g: &mut Geometry, a: u32, b: u32, c: u32) {
    g.indices.extend_from_slice(&[a, b, c]);
}

/// Box centered on the origin, `size` = full extents per axis. 24 verts
/// (4 per face, flat normals), 36 indices, per-face 0..1 UVs.
pub fn box_mesh(size: V3) -> Geometry {
    let mut g = Geometry {
        positions: vec![],
        normals: vec![],
        uvs: vec![],
        indices: vec![],
    };
    let h = [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5];
    // (normal, tangent-u axis, tangent-v axis, half extents along n/u/v)
    let faces: [(V3, V3, V3, [f32; 3]); 6] = [
        ([1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [h[0], h[2], h[1]]),
        ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [h[0], h[2], h[1]]),
        ([0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [h[1], h[0], h[2]]),
        ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [h[1], h[0], h[2]]),
        ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [h[2], h[0], h[1]]),
        ([0.0, 0.0, -1.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [h[2], h[0], h[1]]),
    ];
    for (n, u_axis, v_axis, he) in faces {
        let base = g.vertex_count() as u32;
        // Four corners: (-u-v), (+u-v), (+u+v), (-u+v) in the face plane.
        for (su, sv) in [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            let p = [
                n[0] * he[0] + u_axis[0] * su * he[1] + v_axis[0] * sv * he[2],
                n[1] * he[0] + u_axis[1] * su * he[1] + v_axis[1] * sv * he[2],
                n[2] * he[0] + u_axis[2] * su * he[1] + v_axis[2] * sv * he[2],
            ];
            push_v(&mut g, p, n, [(su + 1.0) * 0.5, (sv + 1.0) * 0.5]);
        }
        // Winding chosen so the face normal points outward (verified by
        // the renderFrame integration test against scene-render).
        tri(&mut g, base, base + 1, base + 2);
        tri(&mut g, base, base + 2, base + 3);
    }
    g
}

/// Ground plane in XZ (`y = 0`), `width` along X, `depth` along Z,
/// `+Y` normals. `wseg`/`dseg` quads per side (1..=256).
pub fn plane_mesh(width: f32, depth: f32, wseg: u32, dseg: u32) -> Geometry {
    let mut g = Geometry {
        positions: vec![],
        normals: vec![],
        uvs: vec![],
        indices: vec![],
    };
    for j in 0..=dseg {
        for i in 0..=wseg {
            let x = (i as f32 / wseg as f32 - 0.5) * width;
            let z = (j as f32 / dseg as f32 - 0.5) * depth;
            push_v(&mut g, [x, 0.0, z], [0.0, 1.0, 0.0], [i as f32 / wseg as f32, j as f32 / dseg as f32]);
        }
    }
    let stride = wseg + 1;
    for j in 0..dseg {
        for i in 0..wseg {
            let a = j * stride + i;
            let b = a + 1;
            let c = a + stride;
            let d = c + 1;
            tri(&mut g, a, c, b);
            tri(&mut g, b, c, d);
        }
    }
    g
}

/// UV sphere: `lat` rings pole-to-pole, `lon` sectors around Y.
/// `(lat + 1) * (lon + 1)` verts — poles are duplicated per sector
/// (degenerate zero-area triangles at the caps, skipped by the
/// rasterizer). Radius `r`, normals = normalized position.
pub fn sphere_mesh(radius: f32, lat: u32, lon: u32) -> Geometry {
    let mut g = Geometry {
        positions: vec![],
        normals: vec![],
        uvs: vec![],
        indices: vec![],
    };
    for i in 0..=lat {
        let phi = std::f32::consts::PI * i as f32 / lat as f32;
        let (sp, cp) = phi.sin_cos();
        for j in 0..=lon {
            let theta = 2.0 * std::f32::consts::PI * j as f32 / lon as f32;
            let (st, ct) = theta.sin_cos();
            let p = [radius * sp * st, radius * cp, radius * sp * ct];
            let n = [p[0] / radius, p[1] / radius, p[2] / radius];
            push_v(&mut g, p, n, [j as f32 / lon as f32, i as f32 / lat as f32]);
        }
    }
    let stride = lon + 1;
    for i in 0..lat {
        for j in 0..lon {
            let a = i * stride + j;
            let b = a + 1;
            let c = a + stride;
            let d = c + 1;
            tri(&mut g, a, c, b);
            tri(&mut g, b, c, d);
        }
    }
    g
}

/// Cylinder along Y centered on the origin: `radius`, `height`,
/// `radial` side segments. Includes top/bottom cap fans. Side UVs wrap
/// u around the circumference; cap UVs map the disc to 0..1.
pub fn cylinder_mesh(radius: f32, height: f32, radial: u32) -> Geometry {
    let mut g = Geometry {
        positions: vec![],
        normals: vec![],
        uvs: vec![],
        indices: vec![],
    };
    let hh = height * 0.5;
    // Rings: bottom (y=-hh) then top (y=+hh), `radial + 1` verts each for
    // the UV seam. Side normals point radially outward.
    for (ring, y) in [(-hh, 0.0f32), (hh, 1.0f32)] {
        for j in 0..=radial {
            let theta = 2.0 * std::f32::consts::PI * j as f32 / radial as f32;
            let (st, ct) = theta.sin_cos();
            push_v(
                &mut g,
                [radius * ct, ring, radius * st],
                [ct, 0.0, st],
                [j as f32 / radial as f32, y],
            );
        }
    }
    let stride = radial + 1;
    for j in 0..radial {
        let a = j;
        let b = j + 1;
        let c = stride + j;
        let d = stride + j + 1;
        tri(&mut g, a, c, b);
        tri(&mut g, b, c, d);
    }
    // Cap centers + fans. Bottom center index, top center index.
    let bottom_center = g.vertex_count() as u32;
    push_v(&mut g, [0.0, -hh, 0.0], [0.0, -1.0, 0.0], [0.5, 0.5]);
    let top_center = g.vertex_count() as u32;
    push_v(&mut g, [0.0, hh, 0.0], [0.0, 1.0, 0.0], [0.5, 0.5]);
    for j in 0..radial {
        let a = j;
        let b = j + 1;
        // Bottom cap faces -Y; top cap faces +Y (verified winding).
        tri(&mut g, bottom_center, a, b);
        tri(&mut g, top_center, stride + b, stride + a);
    }
    // Planar cap UVs for the ring verts (overwrite the seam v values).
    // Ring verts currently carry u = j/radial, v = 0/1; remap to disc.
    for ring in 0..2 {
        for j in 0..=radial {
            let theta = 2.0 * std::f32::consts::PI * j as f32 / radial as f32;
            let (st, ct) = theta.sin_cos();
            let vi = (ring * stride as usize + j as usize) * 2;
            g.uvs[vi] = 0.5 + 0.5 * ct;
            g.uvs[vi + 1] = 0.5 + 0.5 * st;
        }
    }
    g
}

/// Torus in the XZ plane (axis +Y): `major_radius` ring radius,
/// `minor_radius` tube radius, `major`/`minor` segment counts.
pub fn torus_mesh(major: f32, minor: f32, major_seg: u32, minor_seg: u32) -> Geometry {
    let mut g = Geometry {
        positions: vec![],
        normals: vec![],
        uvs: vec![],
        indices: vec![],
    };
    for i in 0..=major_seg {
        let u = 2.0 * std::f32::consts::PI * i as f32 / major_seg as f32;
        let (su, cu) = u.sin_cos();
        for j in 0..=minor_seg {
            let v = 2.0 * std::f32::consts::PI * j as f32 / minor_seg as f32;
            let (sv, cv) = v.sin_cos();
            let r = major + minor * cv;
            let p = [r * su, minor * sv, r * cu];
            let n = [cv * su, sv, cv * cu];
            push_v(
                &mut g,
                p,
                n,
                [i as f32 / major_seg as f32, j as f32 / minor_seg as f32],
            );
        }
    }
    let stride = minor_seg + 1;
    for i in 0..major_seg {
        for j in 0..minor_seg {
            let a = i * stride + j;
            let b = a + 1;
            let c = a + stride;
            let d = c + 1;
            tri(&mut g, a, c, b);
            tri(&mut g, b, c, d);
        }
    }
    g
}

/// Dispatch on the `kind` payload string. Returns the encoded b64 fields.
pub fn primitive_b64(kind: &str, params: &serde_json::Value) -> Result<(String, String, String, String), ignition_core::EngineError> {
    use ignition_core::EngineError;
    let invalid = |m: &str| EngineError::invalid(m.to_string());
    let f = |key: &str, default: f32, min: f32, max: f32| -> Result<f32, EngineError> {
        match params.get(key) {
            None | Some(serde_json::Value::Null) => Ok(default),
            Some(v) => {
                let x = v.as_f64().ok_or_else(|| invalid(&format!("'{key}' must be a number")))?;
                if !x.is_finite() || x < min as f64 || x > max as f64 {
                    return Err(invalid(&format!("'{key}' must be finite in [{min}, {max}]")));
                }
                Ok(x as f32)
            }
        }
    };
    let seg = |key: &str, default: u32| -> Result<u32, EngineError> {
        match params.get(key) {
            None | Some(serde_json::Value::Null) => Ok(default),
            Some(v) => {
                let x = v.as_u64().ok_or_else(|| invalid(&format!("'{key}' must be an integer")))?;
                if !(2..=256).contains(&x) {
                    return Err(invalid(&format!("'{key}' must be an integer in 2..=256")));
                }
                Ok(x as u32)
            }
        }
    };
    let vec3 = |key: &str, default: V3| -> Result<V3, EngineError> {
        match params.get(key) {
            None | Some(serde_json::Value::Null) => Ok(default),
            Some(v) => {
                let a = v
                    .as_array()
                    .ok_or_else(|| invalid(&format!("'{key}' must be [x,y,z]")))?;
                if a.len() != 3 {
                    return Err(invalid(&format!("'{key}' must have 3 components")));
                }
                let mut out = [0.0f32; 3];
                for (i, c) in out.iter_mut().enumerate() {
                    let x = a[i]
                        .as_f64()
                        .ok_or_else(|| invalid(&format!("'{key}' components must be numbers")))?;
                    if !x.is_finite() || x.abs() > 1e6 {
                        return Err(invalid(&format!(
                            "'{key}' components must be finite within ±1e6"
                        )));
                    }
                    *c = x as f32;
                }
                if out.iter().any(|x| *x == 0.0) {
                    return Err(invalid(&format!("'{key}' components must be non-zero")));
                }
                Ok(out)
            }
        }
    };
    let g = match kind {
        "box" => box_mesh(vec3("size", [1.0, 1.0, 1.0])?),
        "plane" => plane_mesh(
            f("width", 1.0, 1e-6, 1e6)?,
            f("depth", 1.0, 1e-6, 1e6)?,
            seg("width_segments", 1)?,
            seg("depth_segments", 1)?,
        ),
        "sphere" => sphere_mesh(
            f("radius", 1.0, 1e-6, 1e6)?,
            seg("latitude_segments", 32)?,
            seg("longitude_segments", 32)?,
        ),
        "cylinder" => cylinder_mesh(
            f("radius", 0.5, 1e-6, 1e6)?,
            f("height", 1.0, 1e-6, 1e6)?,
            seg("radial_segments", 32)?,
        ),
        "torus" => torus_mesh(
            f("major_radius", 1.0, 1e-6, 1e6)?,
            f("minor_radius", 0.25, 1e-6, 1e6)?,
            seg("major_segments", 32)?,
            seg("minor_segments", 16)?,
        ),
        other => {
            return Err(EngineError::invalid(format!(
                "unknown primitive kind '{other}' (expected box|plane|sphere|cylinder|torus)"
            )))
        }
    };
    Ok(g.into_b64())
}
