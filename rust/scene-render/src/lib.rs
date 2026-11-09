//! scene-render — host-side deterministic CPU rasterizer for the P17
//! Track-B scene engine (decision `docs/completion/reports/
//! P17-3d-backend-decision.md`, tier 1).
//!
//! This is **not** an `ignition_core::Engine`: no `EngineKind`, no
//! `Command`/`Journal`, no `NFD1` snapshot, no mutations. It is a
//! sibling host service, stateless per call: the scene engine (a future
//! engine kind, tag 11 — not yet admitted) emits a canonical scene
//! description (world-space triangles + material params + camera +
//! texture bytes by name) and this service answers `render` and
//! `describe` over a stdin/stdout JSON-lines protocol (same wire shape
//! as `nf-cli`/`folio-render`).
//!
//! Tier 1 is the ONLY deterministic reference path: a fixed-order
//! software rasterizer — view-space near/far clipping,
//! perspective-correct barycentric interpolation, z-buffer, per-pixel
//! Lambert/Blinn-Phong shading, nearest/bilinear texture sampling.
//! wgpu/GPU preview (tier 2) is explicitly deferred and, per the B0
//! decision, would be display-only and never parity-claimed anyway.
//!
//! Determinism contract: identical scene JSON produces byte-identical
//! RGBA/PNG on every target. All math is f32 in a fixed evaluation
//! order; there are no hash-map iterations in the render path, no
//! threading, no SIMD-dependent reordering and no float fast-math.
//!
//! Honest v1 scope (per B0): world-space triangle meshes only — node
//! transforms, scene graph, primitive generation, cameras-as-nodes,
//! PBR node graphs, UV packing, baking, glTF/OBJ import, shadows, IBL,
//! transparency/blending, texture alpha, and any GPU path are all
//! deferred. PBR material channels (`metallic`/`roughness`/`specular`)
//! are *stored state* mapped onto the admitted Phong approximation —
//! this is not PBR shading and photoreal output is not claimed.
//!
//! Color space: `"#RRGGBB[AA]"` colors are sRGB and are converted to
//! linear at parse; `[r,g,b(,a)]` float arrays are already linear.
//! Texture texels are sRGB and decode to linear at sample time. The
//! framebuffer accumulates linear light and gamma-encodes once at
//! output. Alpha is ignored everywhere: output is opaque RGBA (alpha
//! 255).
//!
//! Bounds (fail-closed, mirroring the B0 proposed service caps —
//! decision open point 7, implemented here pending sign-off):
//! output ≤ 4096 px per side and ≤ 32 MiB decoded RGBA; ≤ 1,000,000
//! triangles per render; ≤ 3,000,000 vertices per scene (500,000 per
//! mesh); ≤ 4096 meshes; ≤ 1024 materials; ≤ 16 lights; ≤ 256
//! textures totaling ≤ 64 MiB decoded RGBA8; protocol frame ≤ 256 MiB
//! raw (rejected before JSON parse). All coordinates must be finite.
//! Cancellation is per-request only: the JSON-lines host processes one
//! frame at a time; `TaskContext` checkpoints exist in the library API
//! for a future cancellable host.

use ignition_core::{
    base64_decode, base64_encode, EngineError, FrameRequest, FrameResponse, TaskContext,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::BufRead;

// ---- Bounds (B0 open point 7 proposed caps) ----

/// Maximum rendered dimension per side, in pixels.
pub const MAX_OUTPUT_DIM: u32 = 4096;
/// Maximum decoded RGBA payload of one render, in bytes (32 MiB).
pub const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
/// Maximum triangles submitted to the rasterizer per render call.
pub const MAX_TRIANGLES: usize = 1_000_000;
/// Maximum vertices across all meshes per render call.
pub const MAX_VERTICES_PER_SCENE: usize = 3_000_000;
/// Maximum vertices in one mesh.
pub const MAX_VERTICES_PER_MESH: usize = 500_000;
/// Maximum meshes per scene.
pub const MAX_MESHES: usize = 4096;
/// Maximum materials per scene.
pub const MAX_MATERIALS: usize = 1024;
/// Maximum lights per scene (ambient + directional + point combined).
pub const MAX_LIGHTS: usize = 16;
/// Maximum texture entries per scene.
pub const MAX_TEXTURES: usize = 256;
/// Maximum decoded RGBA8 bytes across all textures per render call.
pub const MAX_TEXTURE_BYTES: usize = 64 * 1024 * 1024; // 64 MiB
/// Maximum texture dimension per side, in texels.
pub const MAX_TEXTURE_DIM: u32 = 4096;
/// Maximum accepted JSON-lines frame size, in bytes. Sized so the
/// worst-case legitimate frame fits: 64 MiB texture payload → ~85.4
/// MiB base64, plus world-space vertex/index attributes and JSON
/// overhead. Enforced on the raw line *before* serde parsing and
/// base64 decoding so hostile frames cannot force a large decode
/// allocation.
pub const MAX_FRAME_BYTES: usize = 256 * 1024 * 1024; // 256 MiB

fn invalid(msg: impl Into<String>) -> EngineError {
    EngineError::invalid(msg)
}

fn out_of_bounds(msg: impl Into<String>) -> EngineError {
    EngineError::out_of_bounds(msg)
}

fn internal(msg: impl Into<String>) -> EngineError {
    EngineError::internal(msg)
}

// ---- Small vector/matrix math (fixed order, no external dep) ----

type V3 = [f32; 3];
type V2 = [f32; 2];
/// Row-major 4x4.
type M4 = [[f32; 4]; 4];

fn v3_sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn v3_add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn v3_scale(a: V3, s: f32) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn v3_dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn v3_cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn v3_len(a: V3) -> f32 {
    v3_dot(a, a).sqrt()
}
fn v3_norm(a: V3) -> V3 {
    let l = v3_len(a);
    if l > 0.0 && l.is_finite() {
        v3_scale(a, 1.0 / l)
    } else {
        [0.0, 0.0, 0.0]
    }
}

fn m4_mul(a: &M4, b: &M4) -> M4 {
    let mut out = [[0.0f32; 4]; 4];
    for r in 0..4 {
        for c in 0..4 {
            out[r][c] =
                a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c] + a[r][3] * b[3][c];
        }
    }
    out
}

fn m4_mul_v4(m: &M4, v: [f32; 4]) -> [f32; 4] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3] * v[3],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3] * v[3],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3] * v[3],
        m[3][0] * v[0] + m[3][1] * v[1] + m[3][2] * v[2] + m[3][3] * v[3],
    ]
}

/// Look-at view matrix (world → view). Camera looks down view-space -Z,
/// +Y up, right-handed. `forward = normalize(target - position)`.
fn look_at_view(eye: V3, target: V3, up: V3) -> Result<M4, EngineError> {
    let f = v3_norm(v3_sub(target, eye));
    if v3_len(f) == 0.0 {
        return Err(invalid("camera position and target coincide"));
    }
    let s = v3_norm(v3_cross(f, up));
    if v3_len(s) == 0.0 {
        return Err(invalid("camera up vector is parallel to view direction"));
    }
    let u = v3_cross(s, f);
    // Rows are the camera basis vectors; translation maps eye to origin.
    Ok([
        [s[0], s[1], s[2], -v3_dot(s, eye)],
        [u[0], u[1], u[2], -v3_dot(u, eye)],
        [-f[0], -f[1], -f[2], v3_dot(f, eye)],
        [0.0, 0.0, 0.0, 1.0],
    ])
}

fn perspective_proj(
    fov_y_degrees: f32,
    aspect: f32,
    near: f32,
    far: f32,
) -> Result<M4, EngineError> {
    if !(fov_y_degrees > 0.0 && fov_y_degrees < 180.0) {
        return Err(invalid("camera fov_y_degrees must be in (0, 180)"));
    }
    if !(aspect > 0.0 && aspect.is_finite()) {
        return Err(invalid("camera aspect must be positive finite"));
    }
    if !(near > 0.0 && far > near && far.is_finite()) {
        return Err(invalid("camera near/far must satisfy 0 < near < far"));
    }
    let focal = 1.0 / (fov_y_degrees.to_radians() * 0.5).tan();
    // OpenGL-style: z_ndc maps -near → -1, -far → +1; clip w = -z_view.
    Ok([
        [focal / aspect, 0.0, 0.0, 0.0],
        [0.0, focal, 0.0, 0.0],
        [0.0, 0.0, (far + near) / (near - far), (2.0 * far * near) / (near - far)],
        [0.0, 0.0, -1.0, 0.0],
    ])
}

/// Orthographic projection. `half_height` is the half-extent of the view
/// volume along view-space Y; X half-extent derives from the output
/// aspect. Depth maps view z ∈ [-far, -near] to ndc [-1, +1].
fn ortho_proj(half_height: f32, aspect: f32, near: f32, far: f32) -> Result<M4, EngineError> {
    if !(half_height > 0.0 && half_height.is_finite()) {
        return Err(invalid("camera half_height must be positive finite"));
    }
    if !(aspect > 0.0 && aspect.is_finite()) {
        return Err(invalid("camera aspect must be positive finite"));
    }
    if !(near > 0.0 && far > near && far.is_finite()) {
        return Err(invalid("camera near/far must satisfy 0 < near < far"));
    }
    let half_width = half_height * aspect;
    Ok([
        [1.0 / half_width, 0.0, 0.0, 0.0],
        [0.0, 1.0 / half_height, 0.0, 0.0],
        [0.0, 0.0, -2.0 / (far - near), -(far + near) / (far - near)],
        [0.0, 0.0, 0.0, 1.0],
    ])
}

// ---- Color helpers ----

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// Parse a color: `"#RRGGBB"` / `"#RRGGBBAA"` (sRGB, alpha ignored) or
/// `[r, g, b]` / `[r, g, b, a]` floats in 0..=1 (linear). Returns linear
/// RGB. Non-finite or out-of-range components reject.
fn parse_color(v: &Value, what: &str) -> Result<[f32; 3], EngineError> {
    match v {
        Value::String(s) => {
            let hex = s.strip_prefix('#').ok_or_else(|| {
                invalid(format!("{what}: color string must start with '#'"))
            })?;
            if hex.len() != 6 && hex.len() != 8 {
                return Err(invalid(format!(
                    "{what}: hex color must be #RRGGBB or #RRGGBBAA"
                )));
            }
            let byte = |i: usize| -> Result<f32, EngineError> {
                u8::from_str_radix(&hex[i..i + 2], 16)
                    .map(|b| b as f32 / 255.0)
                    .map_err(|_| invalid(format!("{what}: bad hex color '{s}'")))
            };
            Ok([
                srgb_to_linear(byte(0)?),
                srgb_to_linear(byte(2)?),
                srgb_to_linear(byte(4)?),
            ])
        }
        Value::Array(a) => {
            if a.len() != 3 && a.len() != 4 {
                return Err(invalid(format!(
                    "{what}: color array must have 3 or 4 components"
                )));
            }
            let mut out = [0.0f32; 3];
            for (i, c) in out.iter_mut().enumerate() {
                let f = a[i]
                    .as_f64()
                    .ok_or_else(|| invalid(format!("{what}: color components must be numbers")))?;
                if !f.is_finite() || !(0.0..=1.0).contains(&f) {
                    return Err(invalid(format!(
                        "{what}: color components must be finite in 0..=1"
                    )));
                }
                *c = f as f32;
            }
            Ok(out)
        }
        _ => Err(invalid(format!(
            "{what}: color must be a '#RRGGBB' string or [r,g,b] array"
        ))),
    }
}

fn color_field(
    obj: &Value,
    key: &str,
    default: [f32; 3],
    what: &str,
) -> Result<[f32; 3], EngineError> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => parse_color(v, &format!("{what}.{key}")),
    }
}

fn float_field(
    obj: &Value,
    key: &str,
    default: f32,
    min: f32,
    max: f32,
    what: &str,
) -> Result<f32, EngineError> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => {
            let f = v
                .as_f64()
                .ok_or_else(|| invalid(format!("{what}.{key} must be a number")))?;
            if !f.is_finite() || f < min as f64 || f > max as f64 {
                return Err(invalid(format!(
                    "{what}.{key} must be finite in [{min}, {max}]"
                )));
            }
            Ok(f as f32)
        }
    }
}

fn vec3_field(obj: &Value, key: &str, what: &str) -> Result<V3, EngineError> {
    let v = obj
        .get(key)
        .ok_or_else(|| invalid(format!("{what} requires '{key}'")))?;
    let a = v
        .as_array()
        .ok_or_else(|| invalid(format!("{what}.{key} must be [x,y,z]")))?;
    if a.len() != 3 {
        return Err(invalid(format!("{what}.{key} must have 3 components")));
    }
    let mut out = [0.0f32; 3];
    for (i, c) in out.iter_mut().enumerate() {
        let f = a[i]
            .as_f64()
            .ok_or_else(|| invalid(format!("{what}.{key} components must be numbers")))?;
        if !f.is_finite() {
            return Err(invalid(format!("{what}.{key} components must be finite")));
        }
        *c = f as f32;
    }
    Ok(out)
}

/// Decode a little-endian f32 attribute blob. Returns flat floats;
/// caller checks the per-vertex component count. Non-finite values
/// reject — hostile NaN/Inf vertex data must not reach the rasterizer.
fn decode_f32_blob(b64: &str, what: &str) -> Result<Vec<f32>, EngineError> {
    let bytes = base64_decode(b64).map_err(|e| invalid(format!("{what}: {e}")))?;
    if bytes.len() % 4 != 0 {
        return Err(invalid(format!("{what}: byte length must be a multiple of 4")));
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for c in bytes.chunks_exact(4) {
        let f = f32::from_le_bytes([c[0], c[1], c[2], c[3]]);
        if !f.is_finite() {
            return Err(invalid(format!("{what}: non-finite vertex data")));
        }
        out.push(f);
    }
    Ok(out)
}

fn decode_u32_blob(b64: &str, what: &str) -> Result<Vec<u32>, EngineError> {
    let bytes = base64_decode(b64).map_err(|e| invalid(format!("{what}: {e}")))?;
    if bytes.len() % 4 != 0 {
        return Err(invalid(format!("{what}: byte length must be a multiple of 4")));
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for c in bytes.chunks_exact(4) {
        out.push(u32::from_le_bytes([c[0], c[1], c[2], c[3]]));
    }
    Ok(out)
}

// ---- Scene description types ----

#[derive(Clone, Copy)]
struct Material {
    /// Linear-space base color (albedo). Multiplied by the albedo
    /// texture when `texture` is set.
    base: [f32; 3],
    metallic: f32,
    roughness: f32,
    /// Linear-space specular tint. Effective specular color is
    /// `lerp(specular, base, metallic) * (1 - roughness)` — a Phong
    /// approximation of PBR state, not PBR shading.
    specular: [f32; 3],
    /// Unlit linear-space emission added after lighting.
    emission: [f32; 3],
    /// Index into `Scene::textures`, or `usize::MAX`.
    texture: usize,
    bilinear: bool,
    double_sided: bool,
}

impl Default for Material {
    fn default() -> Self {
        Material {
            base: [0.8, 0.8, 0.8],
            metallic: 0.0,
            roughness: 0.5,
            specular: [1.0, 1.0, 1.0],
            emission: [0.0, 0.0, 0.0],
            texture: usize::MAX,
            bilinear: true,
            double_sided: false,
        }
    }
}

enum Light {
    Ambient { color: [f32; 3], intensity: f32 },
    Directional { dir: V3, color: [f32; 3], intensity: f32 },
    Point { pos: V3, color: [f32; 3], intensity: f32, range: Option<f32> },
}

struct Texture {
    width: u32,
    height: u32,
    /// Straight RGBA8, `width * height * 4` bytes. Alpha is ignored by
    /// the v1 shading model (opaque surfaces only).
    rgba: Vec<u8>,
}

impl Texture {
    fn sample(&self, u: f32, v: f32, bilinear: bool) -> [f32; 3] {
        // Clamp UVs to the texel domain; no wrap modes in v1.
        let u = u.clamp(0.0, 1.0);
        let v = v.clamp(0.0, 1.0);
        let w = self.width as usize;
        if !bilinear {
            let ix = ((u * self.width as f32) as usize).min(w - 1);
            let iy = ((v * self.height as f32) as usize).min(self.height as usize - 1);
            return Self::texel(&self.rgba, w, ix, iy);
        }
        // Bilinear over texel centers: texel (i,j) center sits at
        // ((i+0.5)/w, (j+0.5)/h).
        let fx = u * self.width as f32 - 0.5;
        let fy = v * self.height as f32 - 0.5;
        let x0f = fx.floor();
        let y0f = fy.floor();
        let tx = fx - x0f;
        let ty = fy - y0f;
        let x0 = (x0f as i64).clamp(0, self.width as i64 - 1) as usize;
        let y0 = (y0f as i64).clamp(0, self.height as i64 - 1) as usize;
        let x1 = (x0 + 1).min(self.width as usize - 1);
        let y1 = (y0 + 1).min(self.height as usize - 1);
        let c00 = Self::texel(&self.rgba, w, x0, y0);
        let c10 = Self::texel(&self.rgba, w, x1, y0);
        let c01 = Self::texel(&self.rgba, w, x0, y1);
        let c11 = Self::texel(&self.rgba, w, x1, y1);
        let mut out = [0.0f32; 3];
        for c in 0..3 {
            let top = c00[c] * (1.0 - tx) + c10[c] * tx;
            let bot = c01[c] * (1.0 - tx) + c11[c] * tx;
            out[c] = top * (1.0 - ty) + bot * ty;
        }
        out
    }

    fn texel(rgba: &[u8], stride: usize, x: usize, y: usize) -> [f32; 3] {
        let i = (y * stride + x) * 4;
        // Texture bytes are sRGB-encoded; decode to linear for shading.
        [
            srgb_to_linear(rgba[i] as f32 / 255.0),
            srgb_to_linear(rgba[i + 1] as f32 / 255.0),
            srgb_to_linear(rgba[i + 2] as f32 / 255.0),
        ]
    }
}

struct Mesh {
    /// Flat world-space positions, 3 f32 per vertex.
    positions: Vec<f32>,
    /// Flat world-space normals, 3 f32 per vertex; `None` → flat
    /// per-face geometric normals.
    normals: Option<Vec<f32>>,
    /// Flat UVs, 2 f32 per vertex.
    uvs: Option<Vec<f32>>,
    /// Triangle indices, 3 per triangle; `None` → sequential
    /// non-indexed triangles over `positions`.
    indices: Option<Vec<u32>>,
    material: usize,
}

impl Mesh {
    fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    fn triangle_count(&self) -> usize {
        match &self.indices {
            Some(ix) => ix.len() / 3,
            None => self.vertex_count() / 3,
        }
    }
}

struct Scene {
    width: u32,
    height: u32,
    /// world → view transform.
    view: M4,
    /// proj * view, used for vertex projection.
    mvp: M4,
    /// Camera world-space position (for the view direction in shading).
    camera_pos: V3,
    /// View-space near/far clip distances (positive).
    clip_near: f32,
    clip_far: f32,
    /// True for orthographic cameras (clip w == 1 for every vertex).
    orthographic: bool,
    /// Linear-space background color.
    background: [f32; 3],
    lights: Vec<Light>,
    materials: Vec<Material>,
    textures: Vec<Texture>,
    meshes: Vec<Mesh>,
    triangle_count: usize,
}

// ---- Scene parsing / validation ----

fn parse_mesh(v: &Value, index: usize, material_count: usize) -> Result<Mesh, EngineError> {
    let what = format!("meshes[{index}]");
    let positions_b64 = v
        .get("positions_b64")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{what} requires 'positions_b64' (f32le xyz triples)")))?;
    let positions = decode_f32_blob(positions_b64, &format!("{what}.positions_b64"))?;
    if positions.len() % 3 != 0 {
        return Err(invalid(format!(
            "{what}.positions_b64 length must be a multiple of 3 floats"
        )));
    }
    let verts = positions.len() / 3;
    if verts == 0 {
        return Err(invalid(format!("{what} has no vertices")));
    }
    if verts > MAX_VERTICES_PER_MESH {
        return Err(out_of_bounds(format!(
            "{what} has {verts} vertices; per-mesh limit is {MAX_VERTICES_PER_MESH}"
        )));
    }

    let normals = match v.get("normals_b64") {
        None | Some(Value::Null) => None,
        Some(Value::String(b64)) => {
            let n = decode_f32_blob(b64, &format!("{what}.normals_b64"))?;
            if n.len() != positions.len() {
                return Err(invalid(format!(
                    "{what}.normals_b64 must have the same float count as positions_b64"
                )));
            }
            // Every vertex normal must be non-zero: a zero normal would
            // silently black out shading.
            for t in n.chunks_exact(3) {
                if v3_len([t[0], t[1], t[2]]) == 0.0 {
                    return Err(invalid(format!("{what}.normals_b64 contains a zero normal")));
                }
            }
            Some(n)
        }
        Some(_) => return Err(invalid(format!("{what}.normals_b64 must be a base64 string"))),
    };

    let uvs = match v.get("uvs_b64") {
        None | Some(Value::Null) => None,
        Some(Value::String(b64)) => {
            let u = decode_f32_blob(b64, &format!("{what}.uvs_b64"))?;
            if u.len() != verts * 2 {
                return Err(invalid(format!(
                    "{what}.uvs_b64 must have exactly 2 floats per vertex"
                )));
            }
            Some(u)
        }
        Some(_) => return Err(invalid(format!("{what}.uvs_b64 must be a base64 string"))),
    };

    let indices = match v.get("indices_b64") {
        None | Some(Value::Null) => {
            if verts % 3 != 0 {
                return Err(invalid(format!(
                    "{what} without indices_b64 requires a vertex count divisible by 3"
                )));
            }
            None
        }
        Some(Value::String(b64)) => {
            let ix = decode_u32_blob(b64, &format!("{what}.indices_b64"))?;
            if ix.len() % 3 != 0 {
                return Err(invalid(format!(
                    "{what}.indices_b64 length must be a multiple of 3"
                )));
            }
            for &i in ix.iter() {
                if i as usize >= verts {
                    return Err(out_of_bounds(format!(
                        "{what}.indices_b64 references vertex {i} (mesh has {verts})"
                    )));
                }
            }
            Some(ix)
        }
        Some(_) => return Err(invalid(format!("{what}.indices_b64 must be a base64 string"))),
    };

    let material = match v.get("material") {
        None | Some(Value::Null) => 0usize,
        Some(Value::Number(n)) => {
            let m = n.as_u64().ok_or_else(|| {
                invalid(format!("{what}.material must be a non-negative integer"))
            })?;
            if m as usize >= material_count {
                return Err(out_of_bounds(format!(
                    "{what}.material {m} out of range ({material_count} materials)"
                )));
            }
            m as usize
        }
        Some(_) => return Err(invalid(format!("{what}.material must be an integer index"))),
    };

    Ok(Mesh {
        positions,
        normals,
        uvs,
        indices,
        material,
    })
}

fn parse_material(v: &Value, index: usize) -> Result<Material, EngineError> {
    let what = format!("materials[{index}]");
    if !v.is_object() {
        return Err(invalid(format!("{what} must be an object")));
    }
    Ok(Material {
        base: color_field(v, "color", Material::default().base, &what)?,
        metallic: float_field(v, "metallic", 0.0, 0.0, 1.0, &what)?,
        roughness: float_field(v, "roughness", 0.5, 0.0, 1.0, &what)?,
        specular: color_field(v, "specular", [1.0, 1.0, 1.0], &what)?,
        emission: color_field(v, "emission", [0.0, 0.0, 0.0], &what)?,
        texture: usize::MAX, // resolved against `textures` after parse
        bilinear: match v.get("texture_filter") {
            None | Some(Value::Null) => true,
            Some(Value::String(s)) if s == "bilinear" => true,
            Some(Value::String(s)) if s == "nearest" => false,
            Some(_) => {
                return Err(invalid(format!(
                    "{what}.texture_filter must be 'nearest' or 'bilinear'"
                )))
            }
        },
        double_sided: match v.get("double_sided") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err(invalid(format!("{what}.double_sided must be a boolean"))),
        },
    })
}

fn parse_light(v: &Value, index: usize) -> Result<Light, EngineError> {
    let what = format!("lights[{index}]");
    let ty = v
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{what} requires 'type' (ambient|directional|point)")))?;
    match ty {
        "ambient" => Ok(Light::Ambient {
            color: color_field(v, "color", [1.0, 1.0, 1.0], &what)?,
            intensity: float_field(v, "intensity", 1.0, 0.0, 1e6, &what)?,
        }),
        "directional" => {
            let dir = vec3_field(v, "direction", &what)?;
            if v3_len(dir) == 0.0 {
                return Err(invalid(format!("{what}.direction must be non-zero")));
            }
            Ok(Light::Directional {
                dir: v3_norm(dir),
                color: color_field(v, "color", [1.0, 1.0, 1.0], &what)?,
                intensity: float_field(v, "intensity", 1.0, 0.0, 1e6, &what)?,
            })
        }
        "point" => {
            let range = match v.get("range") {
                None | Some(Value::Null) => None,
                Some(_) => Some(float_field(
                    v,
                    "range",
                    0.0,
                    f32::MIN_POSITIVE,
                    1e9,
                    &what,
                )?),
            };
            Ok(Light::Point {
                pos: vec3_field(v, "position", &what)?,
                color: color_field(v, "color", [1.0, 1.0, 1.0], &what)?,
                intensity: float_field(v, "intensity", 1.0, 0.0, 1e9, &what)?,
                range,
            })
        }
        other => Err(invalid(format!(
            "{what}.type '{other}' unknown (expected ambient|directional|point)"
        ))),
    }
}

fn parse_scene(payload: &Value) -> Result<Scene, EngineError> {
    let what = "scene";
    let width = payload
        .get("width")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("render requires payload.width (pixels)"))?;
    let height = payload
        .get("height")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("render requires payload.height (pixels)"))?;
    if width == 0
        || height == 0
        || width > MAX_OUTPUT_DIM as u64
        || height > MAX_OUTPUT_DIM as u64
    {
        return Err(out_of_bounds(format!(
            "render dimensions {width}x{height} outside 1..={MAX_OUTPUT_DIM}"
        )));
    }
    if width as usize * height as usize * 4 > MAX_OUTPUT_BYTES {
        return Err(out_of_bounds(format!(
            "render {width}x{height} exceeds {MAX_OUTPUT_BYTES} decoded RGBA bytes"
        )));
    }

    let cam = payload
        .get("camera")
        .ok_or_else(|| invalid("render requires payload.camera"))?;
    let cam_what = "camera";
    let position = vec3_field(cam, "position", cam_what)?;
    let target = vec3_field(cam, "target", cam_what)?;
    let up = vec3_field(cam, "up", cam_what)?;
    let near = float_field(cam, "near", 0.1, f32::MIN_POSITIVE, 1e9, cam_what)?;
    let far = float_field(cam, "far", 1000.0, f32::MIN_POSITIVE, 1e12, cam_what)?;
    if !(far > near) {
        return Err(invalid("camera requires 0 < near < far"));
    }
    let aspect = width as f32 / height as f32;
    let view = look_at_view(position, target, up)?;
    let (proj, orthographic) = match cam.get("type").and_then(Value::as_str) {
        None | Some("perspective") => (
            perspective_proj(
                float_field(cam, "fov_y_degrees", 60.0, 0.001, 179.999, cam_what)?,
                aspect,
                near,
                far,
            )?,
            false,
        ),
        Some("orthographic") => (
            ortho_proj(
                float_field(cam, "half_height", 1.0, f32::MIN_POSITIVE, 1e9, cam_what)?,
                aspect,
                near,
                far,
            )?,
            true,
        ),
        Some(other) => {
            return Err(invalid(format!(
                "camera.type '{other}' unknown (expected perspective|orthographic)"
            )))
        }
    };
    let mvp = m4_mul(&proj, &view);

    let background = color_field(payload, "background", [0.0, 0.0, 0.0], what)?;

    // Textures first: materials reference them by name.
    let mut textures = Vec::new();
    let mut texture_map = HashMap::new();
    let mut texture_bytes_total = 0usize;
    if let Some(t) = payload.get("textures") {
        let obj = t.as_object().ok_or_else(|| {
            invalid("textures must be an object mapping names to RGBA8 images")
        })?;
        if obj.len() > MAX_TEXTURES {
            return Err(out_of_bounds(format!(
                "textures has {} entries; limit is {MAX_TEXTURES}",
                obj.len()
            )));
        }
        for (name, tv) in obj {
            if name.is_empty() || name.len() > 256 {
                return Err(invalid("texture names must be 1..=256 bytes"));
            }
            let tw = tv
                .get("width")
                .and_then(Value::as_u64)
                .ok_or_else(|| invalid(format!("textures.{name} requires 'width'")))?;
            let th = tv
                .get("height")
                .and_then(Value::as_u64)
                .ok_or_else(|| invalid(format!("textures.{name} requires 'height'")))?;
            if tw == 0
                || th == 0
                || tw > MAX_TEXTURE_DIM as u64
                || th > MAX_TEXTURE_DIM as u64
                || tw as usize * th as usize > (MAX_OUTPUT_BYTES / 4) as usize
            {
                return Err(out_of_bounds(format!(
                    "textures.{name} dimensions {tw}x{th} outside limits"
                )));
            }
            let format = tv.get("format").and_then(Value::as_str).unwrap_or("rgba8");
            if format != "rgba8" {
                return Err(invalid(format!(
                    "textures.{name}.format '{format}' unsupported (only rgba8)"
                )));
            }
            let b64 = tv
                .get("bytes_b64")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("textures.{name} requires 'bytes_b64'")))?;
            let rgba = base64_decode(b64).map_err(|e| invalid(format!("textures.{name}: {e}")))?;
            let expect = tw as usize * th as usize * 4;
            if rgba.len() != expect {
                return Err(invalid(format!(
                    "textures.{name} decoded to {} bytes; expected {expect} for {tw}x{th} rgba8",
                    rgba.len()
                )));
            }
            texture_bytes_total += rgba.len();
            if texture_bytes_total > MAX_TEXTURE_BYTES {
                return Err(out_of_bounds(format!(
                    "decoded texture set exceeds {MAX_TEXTURE_BYTES} bytes"
                )));
            }
            texture_map.insert(name.clone(), textures.len());
            textures.push(Texture {
                width: tw as u32,
                height: th as u32,
                rgba,
            });
        }
    }

    // Materials: parse, then resolve `texture` name → index.
    let mut materials = Vec::new();
    if let Some(m) = payload.get("materials") {
        let arr = m.as_array().ok_or_else(|| invalid("materials must be an array"))?;
        if arr.len() > MAX_MATERIALS {
            return Err(out_of_bounds(format!(
                "materials has {} entries; limit is {MAX_MATERIALS}",
                arr.len()
            )));
        }
        for (i, mv) in arr.iter().enumerate() {
            materials.push(parse_material(mv, i)?);
        }
        for (i, mv) in arr.iter().enumerate() {
            match mv.get("texture") {
                None | Some(Value::Null) => {}
                Some(Value::String(name)) => {
                    let idx = *texture_map.get(name).ok_or_else(|| {
                        invalid(format!("materials[{i}].texture '{name}' not in textures"))
                    })?;
                    materials[i].texture = idx;
                }
                Some(_) => {
                    return Err(invalid(format!(
                        "materials[{i}].texture must be a string name"
                    )))
                }
            }
        }
    }
    if materials.is_empty() {
        materials.push(Material::default());
    }

    // Lights.
    let mut lights = Vec::new();
    if let Some(l) = payload.get("lights") {
        let arr = l
            .as_array()
            .ok_or_else(|| invalid("lights must be an array"))?;
        if arr.len() > MAX_LIGHTS {
            return Err(out_of_bounds(format!(
                "lights has {} entries; limit is {MAX_LIGHTS}",
                arr.len()
            )));
        }
        for (i, lv) in arr.iter().enumerate() {
            lights.push(parse_light(lv, i)?);
        }
    }

    // Meshes.
    let mut meshes = Vec::new();
    let mut total_verts = 0usize;
    let mut total_tris = 0usize;
    if let Some(ms) = payload.get("meshes") {
        let arr = ms.as_array().ok_or_else(|| invalid("meshes must be an array"))?;
        if arr.len() > MAX_MESHES {
            return Err(out_of_bounds(format!(
                "meshes has {} entries; limit is {MAX_MESHES}",
                arr.len()
            )));
        }
        for (i, mv) in arr.iter().enumerate() {
            let mesh = parse_mesh(mv, i, materials.len())?;
            // A textured material needs per-vertex UVs; fail closed
            // rather than silently sampling (0,0).
            if materials[mesh.material].texture != usize::MAX && mesh.uvs.is_none() {
                return Err(invalid(format!(
                    "meshes[{i}] uses a textured material but has no uvs_b64"
                )));
            }
            total_verts += mesh.vertex_count();
            total_tris += mesh.triangle_count();
            if total_verts > MAX_VERTICES_PER_SCENE {
                return Err(out_of_bounds(format!(
                    "scene exceeds {MAX_VERTICES_PER_SCENE} vertices"
                )));
            }
            if total_tris > MAX_TRIANGLES {
                return Err(out_of_bounds(format!(
                    "scene exceeds {MAX_TRIANGLES} triangles"
                )));
            }
            meshes.push(mesh);
        }
    }

    Ok(Scene {
        width: width as u32,
        height: height as u32,
        view,
        mvp,
        camera_pos: position,
        clip_near: near,
        clip_far: far,
        orthographic,
        background,
        lights,
        materials,
        textures,
        meshes,
        triangle_count: total_tris,
    })
}

// ---- Rasterizer ----

/// One vertex of a source triangle, carrying everything the fragment
/// stage needs. `view` is the view-space position; clip w derives from
/// it (`-view.z` for perspective, 1 for orthographic).
#[derive(Clone, Copy)]
struct ClipVert {
    view: V3,
    world: V3,
    normal: V3,
    uv: V2,
}

#[derive(Clone, Copy)]
struct ProjectedVert {
    sx: f32,
    sy: f32,
    z_ndc: f32,
    /// 1 / clip_w — the perspective-correction weight.
    inv_w: f32,
    world: V3,
    normal: V3,
    uv: V2,
}

/// Clip a triangle against the view-space slab `-far <= z <= -near`
/// (Sutherland–Hodgman, two planes) and fan-triangulate the result.
/// Returns an empty vec when nothing survives.
fn clip_tri(tri: &[ClipVert; 3], near: f32, far: f32) -> Vec<[ClipVert; 3]> {
    let mut poly: Vec<ClipVert> = tri.to_vec();
    // (plane z value, keep z <= plane) then (plane, keep z >= plane).
    for (bound, keep_below) in [(-near, true), (-far, false)] {
        let inside = |v: &ClipVert| {
            if keep_below {
                v.view[2] <= bound
            } else {
                v.view[2] >= bound
            }
        };
        if poly.iter().all(|v| inside(v)) {
            continue;
        }
        let mut out: Vec<ClipVert> = Vec::with_capacity(poly.len() + 1);
        let n = poly.len();
        for i in 0..n {
            let a = poly[i];
            let b = poly[(i + 1) % n];
            let ain = inside(&a);
            let bin = inside(&b);
            if ain {
                out.push(a);
            }
            if ain != bin {
                let dz = b.view[2] - a.view[2];
                if dz == 0.0 {
                    continue;
                }
                let t = ((bound - a.view[2]) / dz).clamp(0.0, 1.0);
                if !t.is_finite() {
                    continue;
                }
                let lerp3 = |x: V3, y: V3| -> V3 {
                    [
                        x[0] + t * (y[0] - x[0]),
                        x[1] + t * (y[1] - x[1]),
                        x[2] + t * (y[2] - x[2]),
                    ]
                };
                out.push(ClipVert {
                    view: [
                        a.view[0] + t * (b.view[0] - a.view[0]),
                        a.view[1] + t * (b.view[1] - a.view[1]),
                        bound,
                    ],
                    world: lerp3(a.world, b.world),
                    normal: lerp3(a.normal, b.normal),
                    uv: [
                        a.uv[0] + t * (b.uv[0] - a.uv[0]),
                        a.uv[1] + t * (b.uv[1] - a.uv[1]),
                    ],
                });
            }
        }
        poly = out;
        if poly.len() < 3 {
            return Vec::new();
        }
    }
    let mut tris = Vec::with_capacity(poly.len() - 2);
    for i in 1..poly.len() - 1 {
        tris.push([poly[0], poly[i], poly[i + 1]]);
    }
    tris
}

fn project_vert(v: &ClipVert, mvp: &M4, w_px: f32, h_px: f32, ortho: bool) -> Option<ProjectedVert> {
    let clip = m4_mul_v4(mvp, [v.view[0], v.view[1], v.view[2], 1.0]);
    // For perspective, clip.w = -view.z > 0 after near clipping. For
    // ortho, clip.w == 1.
    let w = if ortho { 1.0 } else { clip[3] };
    if !(w > 0.0) || !w.is_finite() {
        return None;
    }
    let inv_w = 1.0 / w;
    let nx = clip[0] * inv_w;
    let ny = clip[1] * inv_w;
    let nz = clip[2] * inv_w;
    if !nx.is_finite() || !ny.is_finite() || !nz.is_finite() {
        return None;
    }
    Some(ProjectedVert {
        sx: (nx + 1.0) * 0.5 * w_px,
        // Screen y is down: +y view up maps to decreasing pixel row.
        sy: (1.0 - ny) * 0.5 * h_px,
        z_ndc: nz,
        inv_w,
        world: v.world,
        normal: v.normal,
        uv: v.uv,
    })
}

fn shade_pixel(
    scene: &Scene,
    mat: &Material,
    pos: V3,
    normal: V3,
    uv: V2,
) -> [f32; 3] {
    // Base albedo: material color × texture (sRGB texture decoded to
    // linear at sample time).
    let mut base = mat.base;
    if mat.texture != usize::MAX {
        let tex = &scene.textures[mat.texture];
        let t = tex.sample(uv[0], uv[1], mat.bilinear);
        base = [base[0] * t[0], base[1] * t[1], base[2] * t[2]];
    }
    let kd = 1.0 - mat.metallic;
    let view_dir = v3_norm(v3_sub(scene.camera_pos, pos));
    let n = v3_norm(normal);
    // Phong approximation of the PBR channels: metals tint the specular
    // with albedo; roughness kills specular and widens the lobe.
    let spec_rgb = [
        (mat.specular[0] * (1.0 - mat.metallic) + base[0] * mat.metallic)
            * (1.0 - mat.roughness),
        (mat.specular[1] * (1.0 - mat.metallic) + base[1] * mat.metallic)
            * (1.0 - mat.roughness),
        (mat.specular[2] * (1.0 - mat.metallic) + base[2] * mat.metallic)
            * (1.0 - mat.roughness),
    ];
    let shininess = 1.0 + 255.0 * (1.0 - mat.roughness) * (1.0 - mat.roughness);

    let mut out = mat.emission;
    for light in &scene.lights {
        match light {
            Light::Ambient { color, intensity } => {
                for c in 0..3 {
                    out[c] += color[c] * intensity * base[c] * kd;
                }
            }
            Light::Directional { dir, color, intensity } => {
                // `dir` is the direction the light travels; L points
                // from the surface toward the light.
                let l = v3_scale(*dir, -1.0);
                let diff = v3_dot(n, l).max(0.0);
                if diff <= 0.0 {
                    continue;
                }
                let h = v3_norm(v3_add(l, view_dir));
                let spec = v3_dot(n, h).max(0.0).powf(shininess);
                for c in 0..3 {
                    out[c] +=
                        color[c] * intensity * (base[c] * kd * diff + spec_rgb[c] * spec);
                }
            }
            Light::Point { pos: lp, color, intensity, range } => {
                let to_light = v3_sub(*lp, pos);
                let d = v3_len(to_light);
                if d == 0.0 {
                    continue;
                }
                if let Some(r) = range {
                    if d > *r {
                        continue;
                    }
                }
                let l = v3_scale(to_light, 1.0 / d);
                let diff = v3_dot(n, l).max(0.0);
                if diff <= 0.0 {
                    continue;
                }
                // Fixed attenuation: intensity / (1 + d²), hard `range`
                // cutoff when supplied. Documented, not physical.
                let att = intensity / (1.0 + d * d);
                let h = v3_norm(v3_add(l, view_dir));
                let spec = v3_dot(n, h).max(0.0).powf(shininess);
                for c in 0..3 {
                    out[c] +=
                        color[c] * att * (base[c] * kd * diff + spec_rgb[c] * spec);
                }
            }
        }
    }
    out
}

/// Render `scene` to straight-alpha RGBA8 (alpha always 255 — v1 is
/// opaque). Deterministic: fixed mesh/triangle/pixel order.
/// `pub(crate)`: the service boundary is `handle_frame`; a future
/// cancellable host can widen this together with `parse_scene`.
pub(crate) fn render_scene(scene: &Scene, ctx: &TaskContext) -> Result<Vec<u8>, EngineError> {
    let w = scene.width as usize;
    let h = scene.height as usize;
    // Framebuffer accumulates LINEAR light; gamma-encode once at the
    // end. Background is stored linear too.
    let mut color = vec![[0.0f32; 3]; w * h];
    for px in color.iter_mut() {
        *px = scene.background;
    }
    let mut depth = vec![f32::INFINITY; w * h];

    let w_f = scene.width as f32;
    let h_f = scene.height as f32;
    let mut tris_since_checkpoint = 0usize;

    for mesh in &scene.meshes {
        ctx.checkpoint()?;
        let mat = &scene.materials[mesh.material];
        let has_normals = mesh.normals.is_some();
        let tri_count = mesh.triangle_count();
        for t in 0..tri_count {
            if tris_since_checkpoint >= 4096 {
                ctx.checkpoint()?;
                tris_since_checkpoint = 0;
            }
            tris_since_checkpoint += 1;
            let (i0, i1, i2) = match &mesh.indices {
                Some(ix) => (
                    ix[t * 3] as usize,
                    ix[t * 3 + 1] as usize,
                    ix[t * 3 + 2] as usize,
                ),
                None => (t * 3, t * 3 + 1, t * 3 + 2),
            };
            let idxs = [i0, i1, i2];
            let mut world = [[0.0f32; 3]; 3];
            let mut normal_attr = [[0.0f32; 3]; 3];
            let mut uv_attr = [[0.0f32; 2]; 3];
            for (k, &vi) in idxs.iter().enumerate() {
                world[k] = [
                    mesh.positions[vi * 3],
                    mesh.positions[vi * 3 + 1],
                    mesh.positions[vi * 3 + 2],
                ];
                if let Some(n) = &mesh.normals {
                    normal_attr[k] = [n[vi * 3], n[vi * 3 + 1], n[vi * 3 + 2]];
                }
                if let Some(u) = &mesh.uvs {
                    uv_attr[k] = [u[vi * 2], u[vi * 2 + 1]];
                }
            }
            // Flat normal when the mesh carries none: geometric face
            // normal in world space, constant across clipped pieces.
            let face_n = if has_normals {
                [0.0, 0.0, 0.0]
            } else {
                v3_norm(v3_cross(
                    v3_sub(world[1], world[0]),
                    v3_sub(world[2], world[0]),
                ))
            };
            let clip_tri_v: [ClipVert; 3] = std::array::from_fn(|k| ClipVert {
                view: {
                    let v = m4_mul_v4(&scene.view, [world[k][0], world[k][1], world[k][2], 1.0]);
                    [v[0], v[1], v[2]]
                },
                world: world[k],
                normal: if has_normals { normal_attr[k] } else { face_n },
                uv: uv_attr[k],
            });
            let sub_tris = clip_tri(&clip_tri_v, scene.clip_near, scene.clip_far);
            for sub in &sub_tris {
                let mut pv = [ProjectedVert {
                    sx: 0.0,
                    sy: 0.0,
                    z_ndc: 0.0,
                    inv_w: 0.0,
                    world: [0.0; 3],
                    normal: [0.0; 3],
                    uv: [0.0; 2],
                }; 3];
                let mut ok = true;
                for (k, sv) in sub.iter().enumerate() {
                    match project_vert(sv, &scene.mvp, w_f, h_f, scene.orthographic) {
                        Some(p) => pv[k] = p,
                        None => {
                            ok = false;
                            break;
                        }
                    }
                }
                if !ok {
                    continue;
                }
                raster_tri(scene, mat, &pv, &mut color, &mut depth);
            }
        }
    }

    // Encode once: linear → sRGB → u8, alpha 255 (opaque v1).
    let mut rgba = vec![0u8; w * h * 4];
    for (i, px) in color.iter().enumerate() {
        rgba[i * 4] = (linear_to_srgb(px[0].clamp(0.0, 1.0)) * 255.0).round() as u8;
        rgba[i * 4 + 1] = (linear_to_srgb(px[1].clamp(0.0, 1.0)) * 255.0).round() as u8;
        rgba[i * 4 + 2] = (linear_to_srgb(px[2].clamp(0.0, 1.0)) * 255.0).round() as u8;
        rgba[i * 4 + 3] = 255;
    }
    Ok(rgba)
}

fn raster_tri(
    scene: &Scene,
    mat: &Material,
    pv: &[ProjectedVert; 3],
    color: &mut [[f32; 3]],
    depth: &mut [f32],
) {
    let w = scene.width as usize;
    let h = scene.height as usize;
    // Screen-space signed area (y down). Front faces — CCW as seen from
    // the camera in a right-handed world — wind clockwise on screen
    // (negative area). Backfaces are culled unless double-sided.
    let area2 = (pv[1].sx - pv[0].sx) * (pv[2].sy - pv[0].sy)
        - (pv[2].sx - pv[0].sx) * (pv[1].sy - pv[0].sy);
    if area2 == 0.0 || !area2.is_finite() {
        return;
    }
    let front = area2 < 0.0;
    if !front && !mat.double_sided {
        return;
    }
    let min_x = pv[0].sx.min(pv[1].sx).min(pv[2].sx);
    let max_x = pv[0].sx.max(pv[1].sx).max(pv[2].sx);
    let min_y = pv[0].sy.min(pv[1].sy).min(pv[2].sy);
    let max_y = pv[0].sy.max(pv[1].sy).max(pv[2].sy);
    let x0 = (min_x.floor() as i64).max(0);
    let x1 = (max_x.ceil() as i64).min(w as i64 - 1);
    let y0 = (min_y.floor() as i64).max(0);
    let y1 = (max_y.ceil() as i64).min(h as i64 - 1);
    if x0 > x1 || y0 > y1 {
        return;
    }
    // Barycentric weights via edge functions. The edge starting at v_i
    // yields the weight of vertex i+2 (mod 3); the mapping below keeps
    // λ_k attached to pv[k]. λ are ≥ 0 inside regardless of winding.
    let inv_area = 1.0 / area2;
    for py in y0..=y1 {
        let fy = py as f32 + 0.5;
        for px in x0..=x1 {
            let fx = px as f32 + 0.5;
            // e01 = edge(v0→v1) gives weight of v2; e12 gives v0;
            // e20 gives v1.
            let e01 = (pv[1].sx - pv[0].sx) * (fy - pv[0].sy)
                - (pv[1].sy - pv[0].sy) * (fx - pv[0].sx);
            let e12 = (pv[2].sx - pv[1].sx) * (fy - pv[1].sy)
                - (pv[2].sy - pv[1].sy) * (fx - pv[1].sx);
            let e20 = (pv[0].sx - pv[2].sx) * (fy - pv[2].sy)
                - (pv[0].sy - pv[2].sy) * (fx - pv[2].sx);
            let l2 = e01 * inv_area;
            let l0 = e12 * inv_area;
            let l1 = e20 * inv_area;
            // Small negative epsilon keeps shared edges deterministic:
            // coverage is a pure function of the input, and depth ties
            // resolve by strict `<` in submission order.
            const EPS: f32 = -1e-6;
            if l0 < EPS || l1 < EPS || l2 < EPS {
                continue;
            }
            let iw0 = pv[0].inv_w;
            let iw1 = pv[1].inv_w;
            let iw2 = pv[2].inv_w;
            let den = l0 * iw0 + l1 * iw1 + l2 * iw2;
            if !(den > 0.0) || !den.is_finite() {
                continue;
            }
            // Perspective-correct depth: numerator interpolates
            // z_ndc (= z_clip / w) linearly; denominator is the
            // interpolated 1/w. For ortho (w == 1) this reduces to
            // plain barycentric z.
            let z = (l0 * pv[0].z_ndc + l1 * pv[1].z_ndc + l2 * pv[2].z_ndc) / den;
            let idx = py as usize * w + px as usize;
            if !(z < depth[idx]) {
                continue;
            }
            depth[idx] = z;
            // Perspective-correct attribute interpolation.
            let mut pos = [0.0f32; 3];
            let mut nrm = [0.0f32; 3];
            let mut uv = [0.0f32; 2];
            for c in 0..3 {
                pos[c] = (l0 * iw0 * pv[0].world[c]
                    + l1 * iw1 * pv[1].world[c]
                    + l2 * iw2 * pv[2].world[c])
                    / den;
                nrm[c] = (l0 * iw0 * pv[0].normal[c]
                    + l1 * iw1 * pv[1].normal[c]
                    + l2 * iw2 * pv[2].normal[c])
                    / den;
            }
            uv[0] = (l0 * iw0 * pv[0].uv[0]
                + l1 * iw1 * pv[1].uv[0]
                + l2 * iw2 * pv[2].uv[0])
                / den;
            uv[1] = (l0 * iw0 * pv[0].uv[1]
                + l1 * iw1 * pv[1].uv[1]
                + l2 * iw2 * pv[2].uv[1])
                / den;
            // Flip the shading normal toward the viewer when it faces
            // away — reachable on double-sided materials and on
            // grazing interpolated normals.
            let to_cam = v3_sub(scene.camera_pos, pos);
            if v3_dot(nrm, to_cam) < 0.0 {
                nrm = v3_scale(nrm, -1.0);
            }
            color[idx] = shade_pixel(scene, mat, pos, nrm, uv);
        }
    }
}

// ---- PNG output ----

fn encode_png_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, EngineError> {
    if rgba.len() != width as usize * height as usize * 4 {
        return Err(internal("RGBA buffer size does not match dimensions"));
    }
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Balanced);
        // Deterministic: fixed encoder settings + pinned deflate backend.
        let mut writer = encoder
            .write_header()
            .map_err(|e| internal(format!("PNG header failed: {e}")))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| internal(format!("PNG encode failed: {e}")))?;
    }
    Ok(out)
}

// ---- Service ----

/// The scene-render service: stateless — every `render` carries the
/// complete canonical scene description. Single-threaded by contract.
pub struct SceneRenderService {
    _private: (),
}

impl SceneRenderService {
    pub fn new() -> Self {
        Self { _private: () }
    }

    /// Dispatch one protocol frame. `render` carries the scene
    /// description in the payload; `describe` reports capabilities.
    /// `handle` is ignored (stateless service).
    pub fn handle_frame(&self, req: &FrameRequest) -> FrameResponse {
        let id = req.id;
        let result = match req.op.as_str() {
            "render" => self.render_op(&req.payload),
            "describe" => Ok(json!({
                "service": "scene-render",
                "tier": 1,
                "backend": "cpu-raster",
                "version": env!("CARGO_PKG_VERSION"),
                "deterministic": true,
                "bounds": {
                    "max_output_dim": MAX_OUTPUT_DIM,
                    "max_output_bytes": MAX_OUTPUT_BYTES,
                    "max_triangles": MAX_TRIANGLES,
                    "max_vertices_per_scene": MAX_VERTICES_PER_SCENE,
                    "max_vertices_per_mesh": MAX_VERTICES_PER_MESH,
                    "max_meshes": MAX_MESHES,
                    "max_materials": MAX_MATERIALS,
                    "max_lights": MAX_LIGHTS,
                    "max_textures": MAX_TEXTURES,
                    "max_texture_bytes": MAX_TEXTURE_BYTES,
                    "max_texture_dim": MAX_TEXTURE_DIM,
                    "max_frame_bytes": MAX_FRAME_BYTES,
                },
                "deferred": [
                    "wgpu/gpu preview tier",
                    "scene-graph engine (tag 11)",
                    "primitive mesh generation",
                    "shadows/ibl/post-processing",
                    "transparency/blending/texture alpha",
                    "glTF/OBJ import",
                    "baking/UV packing"
                ],
            })),
            other => Err(invalid(format!("unknown scene-render op '{other}'"))),
        };
        match result {
            Ok(data) => FrameResponse {
                id,
                ok: true,
                data: Some(data),
                events: vec![],
                error: None,
            },
            Err(e) => FrameResponse {
                id,
                ok: false,
                data: None,
                events: vec![],
                error: Some(e),
            },
        }
    }

    fn render_op(&self, payload: &Value) -> Result<Value, EngineError> {
        let scene = parse_scene(payload)?;
        let format = match payload.get("format").and_then(Value::as_str) {
            None | Some("raw") => "raw",
            Some("png") => "png",
            Some(other) => {
                return Err(invalid(format!(
                    "unknown render format '{other}' (expected raw|png)"
                )))
            }
        };
        let rgba = render_scene(&scene, &TaskContext::new())?;
        let stats = json!({
            "meshes": scene.meshes.len(),
            "triangles": scene.triangle_count,
            "materials": scene.materials.len(),
            "lights": scene.lights.len(),
            "textures": scene.textures.len(),
        });
        match format {
            "raw" => Ok(json!({
                "format": "raw",
                "width": scene.width,
                "height": scene.height,
                "stride": scene.width * 4,
                "bytes_b64": base64_encode(&rgba),
                "stats": stats,
            })),
            _ => {
                let png = encode_png_rgba(&rgba, scene.width, scene.height)?;
                Ok(json!({
                    "format": "png",
                    "width": scene.width,
                    "height": scene.height,
                    "bytes_b64": base64_encode(&png),
                    "stats": stats,
                }))
            }
        }
    }
}

impl Default for SceneRenderService {
    fn default() -> Self {
        Self::new()
    }
}

/// Best-effort `id` recovery from a frame rejected before JSON parsing.
fn extract_frame_id(line: &str) -> Option<u64> {
    let pos = line.find("\"id\"")?;
    let rest = line[pos + 4..].trim_start().strip_prefix(':')?.trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// Read one `\n`-terminated line, keeping at most `max` bytes of it.
/// Same contract as folio-render's `read_frame_line`: returns
/// `(bytes, truncated)`; overlong lines are drained through their
/// newline so framing stays intact.
fn read_frame_line<R: BufRead>(
    reader: &mut R,
    max: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut buf = Vec::new();
    let mut truncated = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            break;
        }
        let nl = chunk.iter().position(|&b| b == b'\n');
        let end = nl.map(|i| i + 1).unwrap_or(chunk.len());
        if !truncated {
            let room = max.saturating_sub(buf.len());
            if end <= room {
                buf.extend_from_slice(&chunk[..end]);
            } else {
                buf.extend_from_slice(&chunk[..room]);
                truncated = true;
            }
        }
        reader.consume(end);
        if nl.is_some() {
            break;
        }
    }
    Ok((buf, truncated))
}

/// Run the JSON-lines protocol on stdin/stdout until EOF — same wire
/// shape as `nf-cli` (`{"id","handle","op","payload"}` →
/// `{"id","ok","data"|"error"}`). One frame at a time; rendering is
/// synchronous on this thread. Frames are capped at
/// [`MAX_FRAME_BYTES`] raw bytes before parsing; a panic is converted
/// into a non-recoverable internal error, matching `nf-cli`.
pub fn run_stdio(service: &SceneRenderService) -> std::io::Result<()> {
    use std::io::Write;
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut reader = stdin.lock();
    loop {
        let (line_bytes, truncated) = read_frame_line(&mut reader, MAX_FRAME_BYTES)?;
        if line_bytes.is_empty() && !truncated {
            break;
        }
        let line = String::from_utf8_lossy(&line_bytes);
        if line.trim().is_empty() && !truncated {
            continue;
        }
        let resp = if truncated {
            FrameResponse {
                id: extract_frame_id(&line).unwrap_or(0),
                ok: false,
                data: None,
                events: vec![],
                error: Some(out_of_bounds(format!(
                    "frame exceeds {MAX_FRAME_BYTES} bytes"
                ))),
            }
        } else {
            match serde_json::from_str::<FrameRequest>(&line) {
                Ok(req) => {
                    let id = req.id;
                    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        service.handle_frame(&req)
                    })) {
                        Ok(r) => r,
                        Err(_) => FrameResponse {
                            id,
                            ok: false,
                            data: None,
                            events: vec![],
                            error: Some(EngineError {
                                code: ignition_core::ErrorCode::Internal,
                                message: "scene-render panicked".into(),
                                recoverable: false,
                            }),
                        },
                    }
                }
                Err(e) => FrameResponse {
                    id: extract_frame_id(&line).unwrap_or(0),
                    ok: false,
                    data: None,
                    events: vec![],
                    error: Some(EngineError::serialization(e.to_string())),
                },
            }
        };
        writeln!(out, "{}", serde_json::to_string(&resp).unwrap())?;
        out.flush()?;
    }
    Ok(())
}
