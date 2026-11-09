#![forbid(unsafe_code)]
//! scene-engine — the P17 Track-B scene document engine (tag 11,
//! `docs/completion/reports/P17-3d-backend-decision.md` B0 item 1).
//!
//! Pure Rust, synchronous, single-threaded, `Send`-only, I/O-free
//! `ignition_core::Engine`. The engine owns *document state only*: the
//! scene graph (group/layer/mesh/camera/light nodes with TRS transforms),
//! mesh geometry (custom f32le/u32le base64 blobs or generated
//! primitives), PBR-state materials (semantic channels stored, shading is
//! the host rasterizer's admitted Phong approximation — not PBR), and
//! bounded `Journal` undo + `NFD1` snapshots. It never rasterizes:
//! `renderFrame` emits the canonical scene description that the host
//! submits unchanged to the `scene-render` service (the B0 "engine owns
//! state, host owns pixels" split, same as draft→Prism paths and
//! folio→folio-render). Texture pixels stay host-side — materials
//! reference textures by name only.
//!
//! Conventions (fixed, documented in docs/ENGINE_OPS.md):
//! - Right-handed world, +Y up. Node rotation is euler degrees
//!   `[x,y,z]` composed `R = Rz·Ry·Rx` (X applied first). Local matrix is
//!   `T·R·S`; world = parent chain product, root parent id 0.
//! - Cameras look down their local -Z with local +Y up; a camera node's
//!   world translation is the view position.
//! - Directional lights emit along their local `direction` vector
//!   (default `[0,-1,0]`, normalized, rotation-only transform — the
//!   direction the light *travels*, matching scene-render). Point lights
//!   sit at the node's world position; ambient ignores the transform.
//! - `visible:false` on a node or any ancestor excludes the subtree from
//!   `bounds`, `pick` and `renderFrame` emission.
//! - Determinism: fixed BTreeMap id order everywhere, f32 fixed-order
//!   math, no hash iteration, no threading. f32 libm is not
//!   correctly-rounded — cross-target bit parity is not claimed.

mod codec;
mod emit;
mod math;
mod primitives;

use codec::{bad, decode_mesh, invalid, opt_b64_field, out_of_bounds, req_b64_field};
use ignition_core::{
    decode_envelope, encode_envelope, parse_batch, execute_batch, execute_batch_with_ctx,
    Command, CommandResult, Engine, EngineError, EngineKind, Journal, TaskContext, OP_BATCH,
};
use math::{m4_mul, trs_to_m4, v3_len, v3_norm, V3};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

// ---- Bounds (8 MiB state cap per ARCHITECTURE; service caps mirrored) ----

const MAX_STATE_BYTES: usize = 8 * 1024 * 1024;
const HISTORY: usize = 32;
const MAX_ID: u64 = 9_007_199_254_740_991;
const MAX_NODES: usize = 4096;
const MAX_MESHES: usize = 1024;
const MAX_MATERIALS: usize = 1024;
const MAX_VERTICES_PER_MESH: usize = 100_000;
const MAX_VERTICES_TOTAL: usize = 500_000;
const MAX_NAME: usize = 128;
const MAX_TEXTURE_NAME: usize = 256;
const MAX_LIGHTS_EMIT: usize = 16; // scene-render MAX_LIGHTS
const MAX_RENDER_DIM: u64 = 4096;
const MAX_PICK_TRIANGLES: usize = 1_000_000;

// ---- Document model ----

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transform {
    #[serde(default = "zero3")]
    pub translation: [f32; 3],
    #[serde(default = "zero3")]
    pub rotation_deg: [f32; 3],
    #[serde(default = "one3")]
    pub scale: [f32; 3],
}
fn zero3() -> [f32; 3] {
    [0.0, 0.0, 0.0]
}
fn one3() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}
impl Default for Transform {
    fn default() -> Self {
        Self {
            translation: zero3(),
            rotation_deg: zero3(),
            scale: one3(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Group,
    Layer,
    Mesh,
    Camera,
    Light,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CameraType {
    Perspective,
    Orthographic,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraParams {
    #[serde(rename = "type")]
    pub kind: CameraType,
    /// Perspective vertical fov in degrees (0,180); unused for ortho.
    #[serde(default = "default_fov")]
    pub fov_y_degrees: f32,
    /// Orthographic half-height in world units; unused for perspective.
    #[serde(default = "default_half_height")]
    pub half_height: f32,
    #[serde(default = "default_near")]
    pub near: f32,
    #[serde(default = "default_far")]
    pub far: f32,
}
fn default_fov() -> f32 {
    60.0
}
fn default_half_height() -> f32 {
    1.0
}
fn default_near() -> f32 {
    0.1
}
fn default_far() -> f32 {
    1000.0
}
impl Default for CameraParams {
    fn default() -> Self {
        Self {
            kind: CameraType::Perspective,
            fov_y_degrees: default_fov(),
            half_height: default_half_height(),
            near: default_near(),
            far: default_far(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LightKind {
    Ambient,
    Directional,
    Point,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LightParams {
    #[serde(rename = "type")]
    pub kind: LightKind,
    /// Linear-space RGB, components 0..=1.
    #[serde(default = "white3")]
    pub color: [f32; 3],
    #[serde(default = "one_f32")]
    pub intensity: f32,
    /// Directional only: local-space direction the light travels
    /// (normalized at write; default shines down -Y).
    #[serde(default = "down3", skip_serializing_if = "is_down3")]
    pub direction: [f32; 3],
    /// Point only: optional world-unit cutoff range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<f32>,
}
fn white3() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}
fn one_f32() -> f32 {
    1.0
}
fn down3() -> [f32; 3] {
    [0.0, -1.0, 0.0]
}
fn is_down3(d: &[f32; 3]) -> bool {
    *d == down3()
}
impl Default for LightParams {
    fn default() -> Self {
        Self {
            kind: LightKind::Directional,
            color: white3(),
            intensity: one_f32(),
            direction: down3(),
            range: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: u64,
    pub kind: NodeKind,
    #[serde(default)]
    pub name: String,
    /// Parent node id; 0 = scene root.
    #[serde(default)]
    pub parent: u64,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default = "yes")]
    pub visible: bool,
    /// kind=mesh: referenced mesh id (required, must exist).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub mesh: u64,
    /// kind=camera: camera parameters (required).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<CameraParams>,
    /// kind=light: light parameters (required).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light: Option<LightParams>,
}
fn yes() -> bool {
    true
}
fn is_zero(v: &u64) -> bool {
    *v == 0
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Material {
    pub id: u64,
    #[serde(default)]
    pub name: String,
    /// Linear-space base color, components 0..=1 (matches the service's
    /// float-array color form; `#RRGGBB` input is converted at write).
    #[serde(default = "grey")]
    pub color: [f32; 3],
    #[serde(default)]
    pub metallic: f32,
    #[serde(default = "half")]
    pub roughness: f32,
    #[serde(default = "white3")]
    pub specular: [f32; 3],
    #[serde(default = "black3")]
    pub emission: [f32; 3],
    /// Host-side texture reference by name — pixels never enter state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub texture: Option<String>,
    #[serde(default = "bilinear_filter", skip_serializing_if = "is_bilinear")]
    pub texture_filter: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub double_sided: bool,
}
fn grey() -> [f32; 3] {
    [0.8, 0.8, 0.8]
}
fn half() -> f32 {
    0.5
}
fn black3() -> [f32; 3] {
    [0.0, 0.0, 0.0]
}
fn is_bilinear(s: &str) -> bool {
    s == "bilinear"
}
fn bilinear_filter() -> String {
    "bilinear".into()
}
fn is_false(b: &bool) -> bool {
    !*b
}
impl Default for Material {
    fn default() -> Self {
        Self {
            id: 0,
            name: String::new(),
            color: grey(),
            metallic: 0.0,
            roughness: half(),
            specular: white3(),
            emission: black3(),
            texture: None,
            texture_filter: "bilinear".into(),
            double_sided: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mesh {
    pub id: u64,
    #[serde(default)]
    pub name: String,
    /// Referenced material id (required, must exist).
    pub material: u64,
    /// Canonical base64 of little-endian f32 triples (xyz per vertex).
    pub positions_b64: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normals_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uvs_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indices_b64: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    kind: String,
    schema: u32,
    #[serde(default)]
    name: String,
    /// Monotonic content revision, bumped once per committed mutation.
    #[serde(default)]
    revision: u64,
    #[serde(default = "one_id")]
    next_id: u64,
    #[serde(default)]
    nodes: BTreeMap<u64, Node>,
    #[serde(default)]
    meshes: BTreeMap<u64, Mesh>,
    #[serde(default)]
    materials: BTreeMap<u64, Material>,
}
fn one_id() -> u64 {
    1
}
impl Default for State {
    fn default() -> Self {
        Self {
            kind: "scene".into(),
            schema: 1,
            name: String::new(),
            revision: 0,
            next_id: 1,
            nodes: BTreeMap::new(),
            meshes: BTreeMap::new(),
            materials: BTreeMap::new(),
        }
    }
}

// ---- Validation ----

fn finite3(v: &[f32; 3], what: &str) -> Result<(), EngineError> {
    if v.iter().any(|x| !x.is_finite()) {
        return Err(bad(format!("{what} components must be finite")));
    }
    Ok(())
}

fn bounded_name(s: &str, what: &str) -> Result<(), EngineError> {
    if s.len() > MAX_NAME
        || s.chars().any(|c| c.is_control())
    {
        return Err(bad(format!("{what} must be <= {MAX_NAME} bytes without control characters")));
    }
    Ok(())
}

fn validate_transform(t: &Transform, what: &str) -> Result<(), EngineError> {
    finite3(&t.translation, &format!("{what}.translation"))?;
    finite3(&t.rotation_deg, &format!("{what}.rotation_deg"))?;
    finite3(&t.scale, &format!("{what}.scale"))?;
    if t.translation.iter().any(|x| x.abs() > 1e9) {
        return Err(bad(format!("{what}.translation components must be within ±1e9")));
    }
    if t.rotation_deg.iter().any(|x| x.abs() > 1e6) {
        return Err(bad(format!("{what}.rotation_deg components must be within ±1e6")));
    }
    for &s in &t.scale {
        if !(s.is_finite() && s.abs() >= 1e-6 && s.abs() <= 1e6) {
            return Err(bad(format!(
                "{what}.scale components must be finite within ±[1e-6, 1e6] and non-zero"
            )));
        }
    }
    Ok(())
}

fn validate_camera(c: &CameraParams, what: &str) -> Result<(), EngineError> {
    for (name, v) in [
        ("fov_y_degrees", c.fov_y_degrees),
        ("half_height", c.half_height),
        ("near", c.near),
        ("far", c.far),
    ] {
        if !v.is_finite() {
            return Err(bad(format!("{what}.{name} must be finite")));
        }
    }
    match c.kind {
        CameraType::Perspective => {
            if !(c.fov_y_degrees > 0.0 && c.fov_y_degrees < 180.0) {
                return Err(bad(format!("{what}.fov_y_degrees must be in (0, 180)")));
            }
        }
        CameraType::Orthographic => {
            if !(c.half_height > 0.0) {
                return Err(bad(format!("{what}.half_height must be positive")));
            }
        }
    }
    if !(c.near > 0.0 && c.far > c.near) {
        return Err(bad(format!("{what} requires 0 < near < far")));
    }
    Ok(())
}

fn validate_light(l: &LightParams, what: &str) -> Result<(), EngineError> {
    finite3(&l.color, &format!("{what}.color"))?;
    if l.color.iter().any(|c| !(0.0..=1.0).contains(c)) {
        return Err(bad(format!("{what}.color components must be in 0..=1")));
    }
    if !l.intensity.is_finite() || l.intensity < 0.0 {
        return Err(bad(format!("{what}.intensity must be finite >= 0")));
    }
    let max_intensity = match l.kind {
        LightKind::Point => 1e9,
        _ => 1e6,
    };
    if l.intensity > max_intensity {
        return Err(bad(format!("{what}.intensity exceeds {max_intensity}")));
    }
    match l.kind {
        LightKind::Directional => {
            finite3(&l.direction, &format!("{what}.direction"))?;
            if v3_len(l.direction) == 0.0 {
                return Err(bad(format!("{what}.direction must be non-zero")));
            }
            if l.range.is_some() {
                return Err(bad(format!("{what}.range only applies to point lights")));
            }
        }
        LightKind::Point => {
            if let Some(r) = l.range {
                if !(r.is_finite() && r > 0.0) {
                    return Err(bad(format!("{what}.range must be positive finite")));
                }
            }
        }
        LightKind::Ambient => {
            if l.range.is_some() {
                return Err(bad(format!("{what}.range only applies to point lights")));
            }
        }
    }
    Ok(())
}

fn validate_material(m: &Material, what: &str) -> Result<(), EngineError> {
    bounded_name(&m.name, &format!("{what}.name"))?;
    for (key, c) in [
        ("color", &m.color),
        ("specular", &m.specular),
        ("emission", &m.emission),
    ] {
        finite3(c, &format!("{what}.{key}"))?;
        if c.iter().any(|x| !(0.0..=1.0).contains(x)) {
            return Err(bad(format!("{what}.{key} components must be in 0..=1")));
        }
    }
    for (key, v, lo, hi) in [
        ("metallic", m.metallic, 0.0f32, 1.0f32),
        ("roughness", m.roughness, 0.0f32, 1.0f32),
    ] {
        if !v.is_finite() || !(lo..=hi).contains(&v) {
            return Err(bad(format!("{what}.{key} must be finite in [0, 1]")));
        }
    }
    if let Some(t) = &m.texture {
        if t.is_empty()
            || t.len() > MAX_TEXTURE_NAME
            || !t.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        {
            return Err(bad(format!(
                "{what}.texture must be a 1..={MAX_TEXTURE_NAME} byte asset name"
            )));
        }
    }
    if m.texture_filter != "nearest" && m.texture_filter != "bilinear" {
        return Err(bad(format!(
            "{what}.texture_filter must be 'nearest' or 'bilinear'"
        )));
    }
    Ok(())
}

/// Full document validation — runs on every mutation and on restore.
/// Checks counts, identities, references, transform/camera/light/material
/// bounds, mesh geometry (decoded) and the 8 MiB encoded-state cap.
fn validate(s: &State) -> Result<(), EngineError> {
    if s.kind != "scene" || s.schema != 1 {
        return Err(bad("expected scene schema 1"));
    }
    bounded_name(&s.name, "name")?;
    if s.next_id == 0
        || s.next_id > MAX_ID
        || s.revision > MAX_ID
        || s.nodes.len() > MAX_NODES
        || s.meshes.len() > MAX_MESHES
        || s.materials.len() > MAX_MATERIALS
    {
        return Err(bad("scene limits exceeded"));
    }
    for (id, m) in &s.materials {
        if *id != m.id || *id >= s.next_id {
            return Err(bad("invalid material identity"));
        }
        validate_material(m, &format!("materials[{id}]"))?;
    }
    let mut total_verts = 0usize;
    for (id, m) in &s.meshes {
        if *id != m.id || *id >= s.next_id {
            return Err(bad("invalid mesh identity"));
        }
        bounded_name(&m.name, &format!("meshes[{id}].name"))?;
        if !s.materials.contains_key(&m.material) {
            return Err(bad(format!("meshes[{id}].material references unknown material")));
        }
        let textured = s
            .materials
            .get(&m.material)
            .map(|mat| mat.texture.is_some())
            .unwrap_or(false);
        let d = decode_mesh(
            &m.positions_b64,
            m.normals_b64.as_deref(),
            m.uvs_b64.as_deref(),
            m.indices_b64.as_deref(),
            textured,
            MAX_VERTICES_PER_MESH,
            &format!("meshes[{id}]"),
        )?;
        total_verts += d.positions.len() / 3;
        if total_verts > MAX_VERTICES_TOTAL {
            return Err(out_of_bounds(format!(
                "scene exceeds {MAX_VERTICES_TOTAL} mesh vertices"
            )));
        }
    }
    // Parent graph: every parent exists (or is 0) and the chain is acyclic.
    for (id, n) in &s.nodes {
        if *id != n.id || *id >= s.next_id {
            return Err(bad("invalid node identity"));
        }
        bounded_name(&n.name, &format!("nodes[{id}].name"))?;
        validate_transform(&n.transform, &format!("nodes[{id}].transform"))?;
        if n.parent != 0 && !s.nodes.contains_key(&n.parent) {
            return Err(bad(format!("nodes[{id}].parent references unknown node")));
        }
        // Acyclicity + depth bound: walk ancestors; a repeat or a chain
        // longer than the node count is a cycle.
        let mut seen = BTreeSet::new();
        let mut cur = n.parent;
        while cur != 0 {
            if !seen.insert(cur) || seen.len() > s.nodes.len() {
                return Err(bad(format!("nodes[{id}] sits in a parent cycle")));
            }
            cur = s.nodes.get(&cur).map(|p| p.parent).unwrap_or(0);
        }
        match n.kind {
            NodeKind::Mesh => {
                if n.mesh == 0 || !s.meshes.contains_key(&n.mesh) {
                    return Err(bad(format!("nodes[{id}] mesh reference invalid")));
                }
                if n.camera.is_some() || n.light.is_some() {
                    return Err(bad(format!("nodes[{id}] carries mismatched payload")));
                }
            }
            NodeKind::Camera => {
                let c = n
                    .camera
                    .as_ref()
                    .ok_or_else(|| bad(format!("nodes[{id}] camera node requires camera params")))?;
                validate_camera(c, &format!("nodes[{id}].camera"))?;
                if n.mesh != 0 || n.light.is_some() {
                    return Err(bad(format!("nodes[{id}] carries mismatched payload")));
                }
            }
            NodeKind::Light => {
                let l = n
                    .light
                    .as_ref()
                    .ok_or_else(|| bad(format!("nodes[{id}] light node requires light params")))?;
                validate_light(l, &format!("nodes[{id}].light"))?;
                if n.mesh != 0 || n.camera.is_some() {
                    return Err(bad(format!("nodes[{id}] carries mismatched payload")));
                }
            }
            NodeKind::Group | NodeKind::Layer => {
                if n.mesh != 0 || n.camera.is_some() || n.light.is_some() {
                    return Err(bad(format!("nodes[{id}] carries mismatched payload")));
                }
            }
        }
    }
    if serde_json::to_vec(s)?.len() > MAX_STATE_BYTES {
        return Err(bad("scene encoded state exceeds 8 MiB"));
    }
    Ok(())
}

// ---- World-transform evaluation ----

/// World matrix per node id (only reachable, acyclic nodes — validation
/// guarantees both). Iterative parent-chain walk; deterministic.
pub(crate) fn world_matrices(s: &State) -> BTreeMap<u64, math::M4> {
    let mut out = BTreeMap::new();
    for &id in s.nodes.keys() {
        // Collect chain node→…→root, then multiply root→node.
        let mut chain = Vec::new();
        let mut cur = id;
        loop {
            let Some(n) = s.nodes.get(&cur) else { break };
            chain.push(n);
            if n.parent == 0 {
                break;
            }
            cur = n.parent;
        }
        let mut m = math::IDENTITY;
        for n in chain.iter().rev() {
            m = m4_mul(&m, &trs_to_m4(n.transform.translation, n.transform.rotation_deg, n.transform.scale));
        }
        out.insert(id, m);
    }
    out
}

/// True when the node and every ancestor is visible.
fn chain_visible(s: &State, id: u64) -> bool {
    let mut cur = Some(id);
    while let Some(cid) = cur {
        match s.nodes.get(&cid) {
            Some(n) => {
                if !n.visible {
                    return false;
                }
                cur = if n.parent == 0 { None } else { Some(n.parent) };
            }
            None => return false,
        }
    }
    true
}

// ---- Payload helpers ----

fn text<'a>(p: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    p.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("'{key}' must be a string")))
}
fn u64_field(p: &Value, key: &str) -> Result<u64, EngineError> {
    p.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid(format!("'{key}' must be an integer id")))
}
fn vec3_field(p: &Value, key: &str) -> Result<V3, EngineError> {
    let v = p
        .get(key)
        .ok_or_else(|| invalid(format!("'{key}' must be [x,y,z]")))?;
    let a = v
        .as_array()
        .ok_or_else(|| invalid(format!("'{key}' must be [x,y,z]")))?;
    if a.len() != 3 {
        return Err(invalid(format!("'{key}' must have 3 components")));
    }
    let mut out = [0.0f32; 3];
    for (i, c) in out.iter_mut().enumerate() {
        let f = a[i]
            .as_f64()
            .ok_or_else(|| invalid(format!("'{key}' components must be numbers")))?;
        if !f.is_finite() {
            return Err(invalid(format!("'{key}' components must be finite")));
        }
        *c = f as f32;
    }
    Ok(out)
}
fn optional_vec3(p: &Value, key: &str) -> Result<Option<V3>, EngineError> {
    if p.get(key).is_none() || p.get(key) == Some(&Value::Null) {
        return Ok(None);
    }
    vec3_field(p, key).map(Some)
}
fn f32_field(p: &Value, key: &str, default: f32, min: f32, max: f32) -> Result<f32, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => {
            let f = v
                .as_f64()
                .ok_or_else(|| invalid(format!("'{key}' must be a number")))?;
            if !f.is_finite() || f < min as f64 || f > max as f64 {
                return Err(invalid(format!("'{key}' must be finite in [{min}, {max}]")));
            }
            Ok(f as f32)
        }
    }
}
fn color_field(p: &Value, key: &str, default: V3) -> Result<V3, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::String(s)) => {
            let hex = s.strip_prefix('#').ok_or_else(|| {
                invalid(format!("'{key}' color string must start with '#'"))
            })?;
            if hex.len() != 6 && hex.len() != 8 {
                return Err(invalid(format!("'{key}' hex color must be #RRGGBB or #RRGGBBAA")));
            }
            if !hex.is_ascii() {
                return Err(invalid(format!("'{key}' bad hex color")));
            }
            let byte = |i: usize| -> Result<f32, EngineError> {
                u8::from_str_radix(&hex[i..i + 2], 16)
                    .map(|b| b as f32 / 255.0)
                    .map_err(|_| invalid(format!("'{key}' bad hex color")))
            };
            // sRGB → linear, same conversion the service applies.
            let lin = |c: f32| {
                if c <= 0.04045 {
                    c / 12.92
                } else {
                    ((c + 0.055) / 1.055).powf(2.4)
                }
            };
            Ok([lin(byte(0)?), lin(byte(2)?), lin(byte(4)?)])
        }
        Some(v) => {
            let a = v
                .as_array()
                .ok_or_else(|| invalid(format!("'{key}' must be a color")))?;
            if a.len() != 3 && a.len() != 4 {
                return Err(invalid(format!("'{key}' color must have 3 or 4 components")));
            }
            let mut out = [0.0f32; 3];
            for (i, c) in out.iter_mut().enumerate() {
                let f = a[i]
                    .as_f64()
                    .ok_or_else(|| invalid(format!("'{key}' color components must be numbers")))?;
                if !f.is_finite() || !(0.0..=1.0).contains(&f) {
                    return Err(invalid(format!(
                        "'{key}' color components must be finite in 0..=1"
                    )));
                }
                *c = f as f32;
            }
            Ok(out)
        }
    }
}

/// Transform fields may be given flat (`translation`, `rotation_deg`,
/// `scale`) or nested under a `"transform"` object; flat keys win on
/// conflict. Partial patches merge onto `base`.
fn transform_patch(p: &Value, base: &Transform) -> Result<Transform, EngineError> {
    if let Some(v) = p.get("transform") {
        if !v.is_object() {
            return Err(invalid("'transform' must be an object"));
        }
    }
    let mut merged = serde_json::Map::new();
    if let Some(obj) = p.get("transform").and_then(Value::as_object) {
        for (k, v) in obj {
            merged.insert(k.clone(), v.clone());
        }
    }
    for k in ["translation", "rotation_deg", "scale"] {
        if let Some(v) = p.get(k) {
            merged.insert(k.to_string(), v.clone());
        }
    }
    let mp = Value::Object(merged);
    let mut t = *base;
    if let Some(v) = optional_vec3(&mp, "translation")? {
        t.translation = v;
    }
    if let Some(v) = optional_vec3(&mp, "rotation_deg")? {
        t.rotation_deg = v;
    }
    if let Some(v) = optional_vec3(&mp, "scale")? {
        t.scale = v;
    }
    validate_transform(&t, "transform")?;
    Ok(t)
}

fn parse_camera_params(p: &Value) -> Result<CameraParams, EngineError> {
    let kind = match p.get("type").and_then(Value::as_str) {
        None | Some("perspective") => CameraType::Perspective,
        Some("orthographic") => CameraType::Orthographic,
        Some(other) => {
            return Err(invalid(format!(
                "camera.type '{other}' unknown (expected perspective|orthographic)"
            )))
        }
    };
    let c = CameraParams {
        kind,
        fov_y_degrees: f32_field(p, "fov_y_degrees", default_fov(), 0.001, 179.999)?,
        half_height: f32_field(p, "half_height", default_half_height(), f32::MIN_POSITIVE, 1e9)?,
        near: f32_field(p, "near", default_near(), f32::MIN_POSITIVE, 1e9)?,
        far: f32_field(p, "far", default_far(), f32::MIN_POSITIVE, 1e12)?,
    };
    validate_camera(&c, "camera")?;
    Ok(c)
}

fn parse_light_params(p: &Value) -> Result<LightParams, EngineError> {
    let kind = match p.get("type").and_then(Value::as_str) {
        Some("ambient") => LightKind::Ambient,
        Some("directional") => LightKind::Directional,
        Some("point") => LightKind::Point,
        Some(other) => {
            return Err(invalid(format!(
                "light.type '{other}' unknown (expected ambient|directional|point)"
            )))
        }
        None => {
            return Err(invalid("light requires 'type' (ambient|directional|point)"))
        }
    };
    let mut direction = down3();
    if let Some(d) = optional_vec3(p, "direction")? {
        direction = v3_norm(d);
        if v3_len(direction) == 0.0 {
            return Err(invalid("light.direction must be non-zero"));
        }
    }
    let range = match p.get("range") {
        None | Some(Value::Null) => None,
        Some(_) => Some(f32_field(p, "range", 0.0, f32::MIN_POSITIVE, 1e9)?),
    };
    let l = LightParams {
        kind,
        color: color_field(p, "color", white3())?,
        intensity: f32_field(p, "intensity", 1.0, 0.0, 1e9)?,
        direction,
        range,
    };
    validate_light(&l, "light")?;
    Ok(l)
}

fn parse_material_patch(p: &Value, base: &Material) -> Result<Material, EngineError> {
    let mut m = base.clone();
    if let Some(v) = p.get("name") {
        m.name = v
            .as_str()
            .ok_or_else(|| invalid("'name' must be a string"))?
            .to_string();
    }
    m.color = color_field(p, "color", m.color)?;
    m.metallic = f32_field(p, "metallic", m.metallic, 0.0, 1.0)?;
    m.roughness = f32_field(p, "roughness", m.roughness, 0.0, 1.0)?;
    m.specular = color_field(p, "specular", m.specular)?;
    m.emission = color_field(p, "emission", m.emission)?;
    match p.get("texture") {
        None => {}
        Some(Value::Null) => m.texture = None,
        Some(Value::String(s)) => m.texture = Some(s.clone()),
        Some(_) => return Err(invalid("'texture' must be a string name or null")),
    }
    if let Some(v) = p.get("texture_filter") {
        m.texture_filter = v
            .as_str()
            .ok_or_else(|| invalid("'texture_filter' must be a string"))?
            .to_string();
    }
    if let Some(v) = p.get("double_sided") {
        m.double_sided = v
            .as_bool()
            .ok_or_else(|| invalid("'double_sided' must be a boolean"))?;
    }
    validate_material(&m, "material")?;
    Ok(m)
}

fn alloc(s: &mut State, what: &str) -> Result<u64, EngineError> {
    let id = s.next_id;
    s.next_id = id
        .checked_add(1)
        .filter(|n| *n <= MAX_ID)
        .ok_or_else(|| bad(format!("{what} id space exhausted")))?;
    Ok(id)
}

// ---- Engine ----

pub struct SceneEngine {
    state: Arc<State>,
    journal: Journal<Arc<State>>,
}
impl Default for SceneEngine {
    fn default() -> Self {
        Self::new()
    }
}
impl SceneEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(State::default()),
            journal: Journal::new(HISTORY),
        }
    }
    /// Commit `next` if it differs: bump revision, journal the previous
    /// state, emit `document:changed`. Identical content is a read-only
    /// no-op (no journal entry, no event).
    fn replace(&mut self, mut next: State, data: Value) -> Result<CommandResult, EngineError> {
        next.revision = self.state.revision;
        if *self.state == next {
            return Ok(CommandResult::read_only(data));
        }
        next.revision = self.state.revision.checked_add(1).ok_or_else(|| {
            EngineError::out_of_bounds("scene revision exhausted")
        })?;
        validate(&next)?;
        self.journal.record(Arc::clone(&self.state));
        self.state = Arc::new(next);
        Ok(CommandResult::data(data))
    }
}

impl Engine for SceneEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Scene
    }

    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        if cmd.v != 1 {
            return Err(EngineError::unsupported("unsupported scene command version"));
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            "describe" => Ok(CommandResult::read_only(serde_json::to_value(
                &*self.state,
            )?)),
            "bounds" => crate::emit::bounds(&self.state),
            "pick" => crate::emit::pick(&self.state, p),
            "renderFrame" => crate::emit::render_frame(&self.state, p),
            _ => {
                // Structural clone; mutations below edit `next` then commit.
                let mut next = (*self.state).clone();
                let data = match cmd.op.as_str() {
                    "new" => {
                        next = State {
                            name: p
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            ..State::default()
                        };
                        bounded_name(&next.name, "name")?;
                        json!({"ok":true})
                    }
                    "addNode" => {
                        let kind = match text(p, "kind")? {
                            "group" => NodeKind::Group,
                            "layer" => NodeKind::Layer,
                            "mesh" => NodeKind::Mesh,
                            "camera" => NodeKind::Camera,
                            "light" => NodeKind::Light,
                            other => {
                                return Err(invalid(format!(
                                    "node kind '{other}' unknown (expected group|layer|mesh|camera|light)"
                                )))
                            }
                        };
                        if next.nodes.len() >= MAX_NODES {
                            return Err(out_of_bounds(format!("nodes exceed {MAX_NODES}")));
                        }
                        let parent = match p.get("parent") {
                            None | Some(Value::Null) => 0,
                            Some(_) => u64_field(p, "parent")?,
                        };
                        if parent != 0 && !next.nodes.contains_key(&parent) {
                            return Err(EngineError::not_found("parent node not found"));
                        }
                        let transform = transform_patch(p, &Transform::default())?;
                        let visible = match p.get("visible") {
                            None | Some(Value::Null) => true,
                            Some(v) => v
                                .as_bool()
                                .ok_or_else(|| invalid("'visible' must be a boolean"))?,
                        };
                        let name = p
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        bounded_name(&name, "name")?;
                        let (mesh, camera, light) = match kind {
                            NodeKind::Mesh => {
                                let m = u64_field(p, "mesh")?;
                                if !next.meshes.contains_key(&m) {
                                    return Err(EngineError::not_found("mesh not found"));
                                }
                                (m, None, None)
                            }
                            NodeKind::Camera => {
                                let cobj = p
                                    .get("camera")
                                    .ok_or_else(|| invalid("camera node requires 'camera' params"))?;
                                (0, Some(parse_camera_params(cobj)?), None)
                            }
                            NodeKind::Light => {
                                let lobj = p
                                    .get("light")
                                    .ok_or_else(|| invalid("light node requires 'light' params"))?;
                                (0, None, Some(parse_light_params(lobj)?))
                            }
                            _ => (0, None, None),
                        };
                        let id = alloc(&mut next, "node")?;
                        next.nodes.insert(
                            id,
                            Node {
                                id,
                                kind,
                                name,
                                parent,
                                transform,
                                visible,
                                mesh,
                                camera,
                                light,
                            },
                        );
                        json!({"node_id": id})
                    }
                    "updateNode" => {
                        let id = u64_field(p, "id")?;
                        let n = next
                            .nodes
                            .get(&id)
                            .ok_or_else(|| EngineError::not_found("node not found"))?
                            .clone();
                        let mut n = n;
                        if let Some(v) = p.get("name") {
                            n.name = v
                                .as_str()
                                .ok_or_else(|| invalid("'name' must be a string"))?
                                .to_string();
                            bounded_name(&n.name, "name")?;
                        }
                        if let Some(v) = p.get("visible") {
                            n.visible = v
                                .as_bool()
                                .ok_or_else(|| invalid("'visible' must be a boolean"))?;
                        }
                        if p.get("parent").is_some() && p.get("parent") != Some(&Value::Null) {
                            let parent = u64_field(p, "parent")?;
                            if parent != 0 {
                                if !next.nodes.contains_key(&parent) {
                                    return Err(EngineError::not_found("parent node not found"));
                                }
                                // Reparenting must not create a cycle:
                                // walk from the proposed parent up; reaching
                                // `id` means `id` is its own ancestor.
                                let mut cur = parent;
                                let mut hops = 0usize;
                                while cur != 0 {
                                    if cur == id {
                                        return Err(bad("reparenting would create a cycle"));
                                    }
                                    cur = next.nodes.get(&cur).map(|x| x.parent).unwrap_or(0);
                                    hops += 1;
                                    if hops > next.nodes.len() {
                                        return Err(bad("parent chain is cyclic"));
                                    }
                                }
                            }
                            n.parent = parent;
                        }
                        next.nodes.insert(id, n);
                        json!({"ok":true})
                    }
                    "setTransform" => {
                        let id = u64_field(p, "id")?;
                        let n = next
                            .nodes
                            .get(&id)
                            .ok_or_else(|| EngineError::not_found("node not found"))?
                            .clone();
                        let t = transform_patch(p, &n.transform)?;
                        let mut n = n;
                        n.transform = t;
                        next.nodes.insert(id, n);
                        json!({"ok":true})
                    }
                    "removeNode" => {
                        let id = u64_field(p, "id")?;
                        if !next.nodes.contains_key(&id) {
                            return Err(EngineError::not_found("node not found"));
                        }
                        // Remove the whole subtree, ascending id order for
                        // determinism (children may have any id).
                        let mut doomed: Vec<u64> = Vec::new();
                        let mut stack = vec![id];
                        while let Some(cur) = stack.pop() {
                            doomed.push(cur);
                            for (cid, n) in &next.nodes {
                                if n.parent == cur {
                                    stack.push(*cid);
                                }
                            }
                        }
                        doomed.sort_unstable();
                        for d in doomed {
                            next.nodes.remove(&d);
                        }
                        json!({"ok":true})
                    }
                    "duplicateNode" => {
                        let id = u64_field(p, "id")?;
                        if !next.nodes.contains_key(&id) {
                            return Err(EngineError::not_found("node not found"));
                        }
                        // Collect subtree in ascending old-id order.
                        let mut members: Vec<u64> = Vec::new();
                        let mut stack = vec![id];
                        while let Some(cur) = stack.pop() {
                            members.push(cur);
                            for (cid, n) in &next.nodes {
                                if n.parent == cur {
                                    stack.push(*cid);
                                }
                            }
                        }
                        members.sort_unstable();
                        if next.nodes.len() + members.len() > MAX_NODES {
                            return Err(out_of_bounds(format!("nodes exceed {MAX_NODES}")));
                        }
                        // Pass 1: allocate every new id up front so parent
                        // remapping works regardless of id ordering.
                        let mut map = BTreeMap::new();
                        for &old in &members {
                            map.insert(old, alloc(&mut next, "node")?);
                        }
                        // Pass 2: clone with remapped ids/parents.
                        let root_parent = next.nodes.get(&id).unwrap().parent;
                        let mut new_nodes = Vec::with_capacity(members.len());
                        for &old in &members {
                            let mut n = next.nodes.get(&old).unwrap().clone();
                            n.id = map[&old];
                            n.parent = if old == id {
                                root_parent
                            } else {
                                map[&n.parent]
                            };
                            if old == id {
                                if let Some(v) = p.get("name").and_then(Value::as_str) {
                                    n.name = v.to_string();
                                    bounded_name(&n.name, "name")?;
                                }
                            }
                            new_nodes.push(n);
                        }
                        for n in new_nodes {
                            next.nodes.insert(n.id, n);
                        }
                        json!({"node_id": map[&id], "count": members.len()})
                    }
                    "addMaterial" => {
                        if next.materials.len() >= MAX_MATERIALS {
                            return Err(out_of_bounds(format!("materials exceed {MAX_MATERIALS}")));
                        }
                        let id = alloc(&mut next, "material")?;
                        let mut m = Material {
                            id,
                            ..Material::default()
                        };
                        m = parse_material_patch(p, &m)?;
                        next.materials.insert(id, m);
                        json!({"material_id": id})
                    }
                    "updateMaterial" => {
                        let id = u64_field(p, "id")?;
                        let m = next
                            .materials
                            .get(&id)
                            .ok_or_else(|| EngineError::not_found("material not found"))?
                            .clone();
                        let m = parse_material_patch(p, &m)?;
                        next.materials.insert(id, m);
                        json!({"ok":true})
                    }
                    "removeMaterial" => {
                        let id = u64_field(p, "id")?;
                        if next.materials.remove(&id).is_none() {
                            return Err(EngineError::not_found("material not found"));
                        }
                        json!({"ok":true})
                    }
                    "addMesh" | "updateMesh" => {
                        let geometry_keys = [
                            "positions_b64",
                            "normals_b64",
                            "uvs_b64",
                            "indices_b64",
                        ];
                        let is_add = cmd.op == "addMesh";
                        let (id, mut m) = if is_add {
                            if next.meshes.len() >= MAX_MESHES {
                                return Err(out_of_bounds(format!("meshes exceed {MAX_MESHES}")));
                            }
                            let mid = alloc(&mut next, "mesh")?;
                            (
                                mid,
                                Mesh {
                                    id: mid,
                                    name: String::new(),
                                    material: 0,
                                    positions_b64: String::new(),
                                    normals_b64: None,
                                    uvs_b64: None,
                                    indices_b64: None,
                                },
                            )
                        } else {
                            let mid = u64_field(p, "id")?;
                            let m = next
                                .meshes
                                .get(&mid)
                                .ok_or_else(|| EngineError::not_found("mesh not found"))?
                                .clone();
                            (mid, m)
                        };
                        // Material: explicit `material` id wins; on addMesh
                        // an omitted material takes the lowest-id material.
                        // Every mesh must reference an existing material —
                        // there is no implicit default material.
                        if p.get("material").is_some() && p.get("material") != Some(&Value::Null) {
                            m.material = u64_field(p, "material")?;
                        } else if is_add {
                            m.material = next.materials.keys().next().copied().unwrap_or(0);
                        }
                        if !next.materials.contains_key(&m.material) {
                            return Err(EngineError::not_found(
                                "material not found (meshes require an existing material)",
                            ));
                        }
                        if let Some(v) = p.get("name") {
                            m.name = v
                                .as_str()
                                .ok_or_else(|| invalid("'name' must be a string"))?
                                .to_string();
                            bounded_name(&m.name, "name")?;
                        }
                        // Geometry: any supplied geometry key replaces the
                        // WHOLE attribute set (missing optionals become
                        // absent); `positions_b64` is then required.
                        let touches_geometry =
                            geometry_keys.iter().any(|k| p.get(*k).is_some());
                        if touches_geometry || is_add {
                            m.positions_b64 = codec::canon_b64(
                                req_b64_field(p, "positions_b64")?,
                                "positions_b64",
                            )?;
                            m.normals_b64 = opt_b64_field(p, "normals_b64")?
                                .map(|s| codec::canon_b64(s, "normals_b64"))
                                .transpose()?;
                            m.uvs_b64 = opt_b64_field(p, "uvs_b64")?
                                .map(|s| codec::canon_b64(s, "uvs_b64"))
                                .transpose()?;
                            m.indices_b64 = opt_b64_field(p, "indices_b64")?
                                .map(|s| codec::canon_b64(s, "indices_b64"))
                                .transpose()?;
                        }
                        // Validate the assembled mesh now (decode + rules).
                        let textured = next
                            .materials
                            .get(&m.material)
                            .map(|mat| mat.texture.is_some())
                            .unwrap_or(false);
                        decode_mesh(
                            &m.positions_b64,
                            m.normals_b64.as_deref(),
                            m.uvs_b64.as_deref(),
                            m.indices_b64.as_deref(),
                            textured,
                            MAX_VERTICES_PER_MESH,
                            "mesh",
                        )?;
                        next.meshes.insert(id, m);
                        if is_add {
                            json!({"mesh_id": id})
                        } else {
                            json!({"ok":true})
                        }
                    }
                    "removeMesh" => {
                        let id = u64_field(p, "id")?;
                        if next.meshes.remove(&id).is_none() {
                            return Err(EngineError::not_found("mesh not found"));
                        }
                        json!({"ok":true})
                    }
                    "setMaterial" => {
                        let mesh_id = u64_field(p, "mesh")?;
                        let mat_id = u64_field(p, "material")?;
                        let m = next
                            .meshes
                            .get_mut(&mesh_id)
                            .ok_or_else(|| EngineError::not_found("mesh not found"))?;
                        if !next.materials.contains_key(&mat_id) {
                            return Err(EngineError::not_found("material not found"));
                        }
                        m.material = mat_id;
                        json!({"ok":true})
                    }
                    "addMeshPrimitive" => {
                        let kind = text(p, "kind")?;
                        let (positions_b64, normals_b64, uvs_b64, indices_b64) =
                            primitives::primitive_b64(kind, p)?;
                        if next.meshes.len() >= MAX_MESHES {
                            return Err(out_of_bounds(format!("meshes exceed {MAX_MESHES}")));
                        }
                        let mid = alloc(&mut next, "mesh")?;
                        let material = match p.get("material") {
                            None | Some(Value::Null) => next
                                .materials
                                .keys()
                                .next()
                                .copied()
                                .unwrap_or(0),
                            Some(_) => u64_field(p, "material")?,
                        };
                        if !next.materials.contains_key(&material) {
                            return Err(EngineError::not_found(
                                "material not found (meshes require an existing material)",
                            ));
                        }
                        let name = p
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        bounded_name(&name, "name")?;
                        let m = Mesh {
                            id: mid,
                            name,
                            material,
                            positions_b64,
                            normals_b64: Some(normals_b64),
                            uvs_b64: Some(uvs_b64),
                            indices_b64: Some(indices_b64),
                        };
                        // Primitive output is trusted but still run the
                        // shared geometry validation for uniformity.
                        let textured = next
                            .materials
                            .get(&material)
                            .map(|mat| mat.texture.is_some())
                            .unwrap_or(false);
                        decode_mesh(
                            &m.positions_b64,
                            m.normals_b64.as_deref(),
                            m.uvs_b64.as_deref(),
                            m.indices_b64.as_deref(),
                            textured,
                            MAX_VERTICES_PER_MESH,
                            "mesh",
                        )?;
                        next.meshes.insert(mid, m);
                        json!({"mesh_id": mid})
                    }
                    _ => return Err(EngineError::invalid("unknown scene operation")),
                };
                self.replace(next, data)
            }
        }
    }

    fn apply_batch(&mut self, cmd: Command, ctx: Option<&TaskContext>) -> Result<CommandResult, EngineError> {
        let batch = parse_batch(cmd)?;
        let staged = Self {
            state: Arc::clone(&self.state),
            journal: Journal::new(1),
        };
        let (staged, result) = match ctx {
            Some(ctx) => execute_batch_with_ctx(staged, batch, ctx)?,
            None => execute_batch(staged, batch)?,
        };
        if result.events.iter().any(|e| e.kind == "document:changed") {
            self.journal.record(Arc::clone(&self.state));
            self.state = staged.state;
        }
        Ok(result)
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        Ok(encode_envelope(&serde_json::to_vec(&*self.state)?))
    }
    fn restore(&mut self, bytes: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(bytes)?;
        if payload.len() > MAX_STATE_BYTES {
            return Err(bad("scene encoded state exceeds 8 MiB"));
        }
        let next: State = serde_json::from_slice(payload)?;
        validate(&next)?;
        self.state = Arc::new(next);
        self.journal = Journal::new(HISTORY);
        Ok(())
    }
    fn undo(&mut self) -> Result<bool, EngineError> {
        if let Some(previous) = self.journal.pop_undo() {
            let current = std::mem::replace(&mut self.state, previous);
            self.journal.push_redo(current);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn redo(&mut self) -> Result<bool, EngineError> {
        if let Some(next) = self.journal.pop_redo() {
            let current = std::mem::replace(&mut self.state, next);
            self.journal.push_undo(current);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests;
