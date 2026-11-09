//! Fixed-order vec/mat helpers for the scene engine. No external geometry
//! crate (B0 open point 5 left `glam`/`nalgebra` unchosen; ~150 lines cover
//! v1 needs, same call scene-render made). All math is f32 in a fixed
//! evaluation order — deterministic for a pinned toolchain/target; f32 libm
//! (`sin`/`cos`/`sqrt`) is not correctly-rounded, so cross-target bit parity
//! is not claimed (same caveat as `rust/scene-render`).

pub type V3 = [f32; 3];
/// Row-major 4x4, column-vector convention (`m * [x,y,z,1]`).
pub type M4 = [[f32; 4]; 4];
/// Row-major 3x3.
pub type M3 = [[f32; 3]; 3];

pub const IDENTITY: M4 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
];

/// Row-major 3x3 identity (rotation-only transforms).
pub const IDENTITY_M3: M3 = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
];

pub fn v3_sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn v3_add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn v3_scale(a: V3, s: f32) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub fn v3_dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn v3_cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn v3_len(a: V3) -> f32 {
    v3_dot(a, a).sqrt()
}
pub fn v3_norm(a: V3) -> V3 {
    let l = v3_len(a);
    if l > 0.0 && l.is_finite() {
        v3_scale(a, 1.0 / l)
    } else {
        [0.0, 0.0, 0.0]
    }
}

pub fn m4_mul(a: &M4, b: &M4) -> M4 {
    let mut out = [[0.0f32; 4]; 4];
    for i in 0..4 {
        for j in 0..4 {
            out[i][j] = a[i][0] * b[0][j]
                + a[i][1] * b[1][j]
                + a[i][2] * b[2][j]
                + a[i][3] * b[3][j];
        }
    }
    out
}

/// Transform a point (implicit w = 1) by a row-major 4x4.
pub fn m4_mul_v3(m: &M4, v: V3) -> V3 {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3],
    ]
}

/// Transform a direction (no translation) by the upper 3x3.
pub fn m4_mul_dir(m: &M4, v: V3) -> V3 {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

/// Euler degrees `[x, y, z]` → rotation matrix. Documented order: the X
/// rotation is applied first, then Y, then Z about the node's own axes —
/// i.e. `R = Rz · Ry · Rx` (fixed-order composition, deterministic).
pub fn euler_to_mat3(deg: V3) -> M3 {
    let (sx, cx) = (deg[0].to_radians().sin(), deg[0].to_radians().cos());
    let (sy, cy) = (deg[1].to_radians().sin(), deg[1].to_radians().cos());
    let (sz, cz) = (deg[2].to_radians().sin(), deg[2].to_radians().cos());
    // Rx
    let rx = [[1.0, 0.0, 0.0], [0.0, cx, -sx], [0.0, sx, cx]];
    // Ry
    let ry = [[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]];
    // Rz
    let rz = [[cz, -sz, 0.0], [sz, cz, 0.0], [0.0, 0.0, 1.0]];
    m3_mul(&m3_mul(&rz, &ry), &rx)
}

/// M3 · V3.
pub fn m3_mul_v(m: &M3, v: V3) -> V3 {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

pub fn m3_mul(a: &M3, b: &M3) -> M3 {
    let mut out = [[0.0f32; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
    }
    out
}

/// Local TRS matrix `T · R · S`: scale first, then rotate, then translate.
pub fn trs_to_m4(t: V3, rotation_deg: V3, s: V3) -> M4 {
    let r = euler_to_mat3(rotation_deg);
    let mut m = IDENTITY;
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = r[i][j] * s[j];
        }
        m[i][3] = t[i];
    }
    m
}

/// Inverse-transpose of the upper 3x3 — the correct normal transform under
/// non-uniform scale. Returns `None` for a (near-)singular linear part;
/// callers fall back to the raw upper 3x3.
pub fn normal_matrix(m: &M4) -> Option<M3> {
    let a = [
        [m[0][0], m[0][1], m[0][2]],
        [m[1][0], m[1][1], m[1][2]],
        [m[2][0], m[2][1], m[2][2]],
    ];
    let det = a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    if !(det.is_finite() && det.abs() > 1e-20) {
        return None;
    }
    // A^-T = cofactor(A)/det: out[i][j] is the cofactor of a[i][j], i.e.
    // (-1)^(i+j) times the minor removing ROW i and COLUMN j.
    let inv_det = 1.0 / det;
    let mut out = [[0.0f32; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            let (r1, r2) = ((i + 1) % 3, (i + 2) % 3);
            let (c1, c2) = ((j + 1) % 3, (j + 2) % 3);
            let minor = a[r1][c1] * a[r2][c2] - a[r1][c2] * a[r2][c1];
            let sign = if (i + j) % 2 == 0 { 1.0 } else { -1.0 };
            out[i][j] = sign * minor * inv_det;
        }
    }
    Some(out)
}

/// Möller–Trumbore ray/triangle intersection. `t` along the (normalized)
/// ray; returns `(t, u, v)` barycentrics or `None`. Both sides of the
/// triangle are hit — picking is a selection operation, not a cull.
pub fn ray_triangle(
    origin: V3,
    dir: V3,
    a: V3,
    b: V3,
    c: V3,
) -> Option<(f32, f32, f32)> {
    const EPS: f32 = 1e-9;
    let e1 = v3_sub(b, a);
    let e2 = v3_sub(c, a);
    let p = v3_cross(dir, e2);
    let det = v3_dot(e1, p);
    if det.abs() <= EPS {
        return None;
    }
    let inv = 1.0 / det;
    let tvec = v3_sub(origin, a);
    let u = v3_dot(tvec, p) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = v3_cross(tvec, e1);
    let v = v3_dot(dir, q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let t = v3_dot(e2, q) * inv;
    if t <= 0.0 || !t.is_finite() {
        return None;
    }
    Some((t, u, v))
}
