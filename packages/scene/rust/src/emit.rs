//! Read-side scene evaluation: `bounds` (world AABB), `pick`
//! (ray→triangle selection) and `renderFrame` (canonical scene
//! description for the host-side `scene-render` service). All three are
//! read-only — no journal entry, no events — and all iterate in
//! deterministic BTreeMap id order over fully-visible node chains.

use crate::codec::{decode_mesh, invalid, out_of_bounds};
use crate::math::{m4_mul_dir, m4_mul_v3, normal_matrix, ray_triangle, v3_len, v3_norm, V3};
use crate::{chain_visible, world_matrices, LightKind, NodeKind, State, CameraType};
use ignition_core::{CommandResult, EngineError};
use serde_json::{json, Value};

fn read_only(data: Value) -> CommandResult {
    CommandResult::read_only(data)
}

/// Visible mesh nodes in deterministic id order: (node_id, mesh_id, world).
fn visible_mesh_nodes<'a>(
    s: &'a State,
    worlds: &std::collections::BTreeMap<u64, crate::math::M4>,
) -> Vec<(u64, u64, crate::math::M4)> {
    let mut out = Vec::new();
    for (id, n) in &s.nodes {
        if n.kind == NodeKind::Mesh && n.mesh != 0 && chain_visible(s, *id) {
            if let Some(m) = worlds.get(id) {
                out.push((*id, n.mesh, *m));
            }
        }
    }
    out
}

/// `bounds` → world-space AABB over every visible mesh vertex, or null.
pub fn bounds(s: &State) -> Result<CommandResult, EngineError> {
    let worlds = world_matrices(s);
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    let mut any = false;
    for (_nid, mid, world) in visible_mesh_nodes(s, &worlds) {
        let Some(mesh) = s.meshes.get(&mid) else { continue };
        let textured = s
            .materials
            .get(&mesh.material)
            .map(|m| m.texture.is_some())
            .unwrap_or(false);
        let d = decode_mesh(
            &mesh.positions_b64,
            mesh.normals_b64.as_deref(),
            mesh.uvs_b64.as_deref(),
            mesh.indices_b64.as_deref(),
            textured,
            crate::MAX_VERTICES_PER_MESH,
            "mesh",
        )?;
        for v in d.positions.chunks_exact(3) {
            let w = m4_mul_v3(&world, [v[0], v[1], v[2]]);
            for i in 0..3 {
                min[i] = min[i].min(w[i]);
                max[i] = max[i].max(w[i]);
            }
            any = true;
        }
    }
    if !any {
        return Ok(read_only(json!({"bounds": Value::Null})));
    }
    Ok(read_only(json!({
        "bounds": {"min": min, "max": max}
    })))
}

/// `pick` → nearest ray/triangle hit over visible mesh geometry.
/// Payload `{origin:[x,y,z], direction:[x,y,z]}`; direction need not be
/// unit length (normalized internally; zero rejects). Both faces hit —
/// picking is selection, not culling. Returns the closest `t` along the
/// ray with world-space point and geometric face normal.
pub fn pick(s: &State, p: &Value) -> Result<CommandResult, EngineError> {
    let origin = vec3(p, "origin")?;
    let dir = vec3(p, "direction")?;
    if v3_len(dir) == 0.0 {
        return Err(invalid("pick direction must be non-zero"));
    }
    let dir = v3_norm(dir);
    let worlds = world_matrices(s);
    let mut best: Option<(f32, u64, u64, usize, V3, V3)> = None;
    let mut tested = 0usize;
    for (nid, mid, world) in visible_mesh_nodes(s, &worlds) {
        let Some(mesh) = s.meshes.get(&mid) else { continue };
        let textured = s
            .materials
            .get(&mesh.material)
            .map(|m| m.texture.is_some())
            .unwrap_or(false);
        let d = decode_mesh(
            &mesh.positions_b64,
            mesh.normals_b64.as_deref(),
            mesh.uvs_b64.as_deref(),
            mesh.indices_b64.as_deref(),
            textured,
            crate::MAX_VERTICES_PER_MESH,
            "mesh",
        )?;
        let verts = d.positions.len() / 3;
        // World-space vertex cache for this mesh.
        let mut wpos = Vec::with_capacity(d.positions.len());
        for v in d.positions.chunks_exact(3) {
            let w = m4_mul_v3(&world, [v[0], v[1], v[2]]);
            wpos.extend_from_slice(&w);
        }
        let tri_count = match &d.indices {
            Some(ix) => ix.len() / 3,
            None => verts / 3,
        };
        tested += tri_count;
        if tested > crate::MAX_PICK_TRIANGLES {
            return Err(out_of_bounds(format!(
                "pick tests {tested} triangles; limit is {}",
                crate::MAX_PICK_TRIANGLES
            )));
        }
        for t in 0..tri_count {
            let (i0, i1, i2) = match &d.indices {
                Some(ix) => (
                    ix[t * 3] as usize,
                    ix[t * 3 + 1] as usize,
                    ix[t * 3 + 2] as usize,
                ),
                None => (t * 3, t * 3 + 1, t * 3 + 2),
            };
            let a = [wpos[i0 * 3], wpos[i0 * 3 + 1], wpos[i0 * 3 + 2]];
            let b = [wpos[i1 * 3], wpos[i1 * 3 + 1], wpos[i1 * 3 + 2]];
            let c = [wpos[i2 * 3], wpos[i2 * 3 + 1], wpos[i2 * 3 + 2]];
            if let Some((dist, _u, _v)) = ray_triangle(origin, dir, a, b, c) {
                let closer = best.as_ref().map(|(bt, ..)| dist < *bt).unwrap_or(true);
                if closer {
                    let e1 = crate::math::v3_sub(b, a);
                    let e2 = crate::math::v3_sub(c, a);
                    let n = crate::math::v3_norm(crate::math::v3_cross(e1, e2));
                    let point = crate::math::v3_add(
                        origin,
                        crate::math::v3_scale(dir, dist),
                    );
                    best = Some((dist, nid, mid, t, point, n));
                }
            }
        }
    }
    match best {
        None => Ok(read_only(json!({
            "hit": Value::Null,
            "triangles_tested": tested
        }))),
        Some((dist, nid, mid, tri, point, n)) => Ok(read_only(json!({
            "hit": {
                "node_id": nid,
                "mesh_id": mid,
                "triangle": tri,
                "distance": dist,
                "point": point,
                "normal": n,
            },
            "triangles_tested": tested
        }))),
    }
}

fn vec3(p: &Value, key: &str) -> Result<V3, EngineError> {
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

// ---- renderFrame: canonical scene description for scene-render ----

/// Resolve the camera: explicit `camera` payload object passes through
/// (the service validates it); `camera_node` picks a camera node; with
/// neither, the lowest-id visible camera node is used. Errors when no
/// camera resolves or a node camera's up is parallel to its forward.
fn resolve_camera(s: &State, p: &Value, worlds: &std::collections::BTreeMap<u64, crate::math::M4>) -> Result<Value, EngineError> {
    if let Some(c) = p.get("camera") {
        if c.is_object() {
            return Ok(c.clone());
        }
        return Err(invalid("'camera' must be an object"));
    }
    let node_id = match p.get("camera_node") {
        None | Some(Value::Null) => None,
        Some(v) => Some(
            v.as_u64()
                .ok_or_else(|| invalid("'camera_node' must be a node id"))?,
        ),
    };
    let pick_node = |id: u64| -> Option<&crate::Node> {
        s.nodes.get(&id).filter(|n| {
            n.kind == NodeKind::Camera && n.camera.is_some() && chain_visible(s, id)
        })
    };
    let chosen = match node_id {
        Some(id) => pick_node(id).ok_or_else(|| {
            EngineError::not_found("camera_node is not a visible camera node")
        })?,
        None => s
            .nodes
            .iter()
            .find(|(id, n)| {
                n.kind == NodeKind::Camera
                    && n.camera.is_some()
                    && chain_visible(s, **id)
            })
            .map(|(_, n)| n)
            .ok_or_else(|| invalid("scene has no visible camera node"))?,
    };
    let world = worlds
        .get(&chosen.id)
        .ok_or_else(|| invalid("camera node has no world transform"))?;
    let cam = chosen.camera.as_ref().unwrap();
    let position = [world[0][3], world[1][3], world[2][3]];
    // Camera looks down local -Z, up is local +Y (documented convention).
    let forward = v3_norm(m4_mul_dir(world, [0.0, 0.0, -1.0]));
    let up = v3_norm(m4_mul_dir(world, [0.0, 1.0, 0.0]));
    if v3_len(forward) == 0.0 || v3_len(up) == 0.0
        || forward.iter().zip(up.iter()).map(|(a, b)| a * b).sum::<f32>().abs() > 0.99999
    {
        return Err(invalid(
            "camera node orientation is degenerate (forward parallel to up)",
        ));
    }
    let target = crate::math::v3_add(position, forward);
    let mut out = json!({
        "position": position,
        "target": target,
        "up": up,
        "near": cam.near,
        "far": cam.far,
    });
    match cam.kind {
        CameraType::Perspective => {
            out["type"] = json!("perspective");
            out["fov_y_degrees"] = json!(cam.fov_y_degrees);
        }
        CameraType::Orthographic => {
            out["type"] = json!("orthographic");
            out["half_height"] = json!(cam.half_height);
        }
    }
    Ok(out)
}

/// `renderFrame` → the canonical `scene-render` `render` payload.
/// Payload `{width, height, format?, camera_node?|camera?, textures?,
/// background?}`. The engine NEVER rasterizes: the returned object is
/// submitted unchanged to the scene-render service by the host. Mesh
/// nodes emit in id order with world-transformed attributes; materials
/// are re-indexed in first-use order; `textures` pass through by name
/// (pixels are host-side) and every material texture reference must
/// resolve or the read fails.
pub fn render_frame(s: &State, p: &Value) -> Result<CommandResult, EngineError> {
    let width = p
        .get("width")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("renderFrame requires 'width'"))?;
    let height = p
        .get("height")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("renderFrame requires 'height'"))?;
    if width == 0
        || height == 0
        || width > crate::MAX_RENDER_DIM
        || height > crate::MAX_RENDER_DIM
        || width as usize * height as usize * 4 > 32 * 1024 * 1024
    {
        return Err(out_of_bounds(format!(
            "renderFrame dimensions {width}x{height} outside service limits"
        )));
    }
    let format = match p.get("format") {
        None | Some(Value::Null) => "raw".to_string(),
        Some(Value::String(f)) if f == "raw" || f == "png" => f.clone(),
        Some(_) => return Err(invalid("'format' must be 'raw' or 'png'")),
    };
    let worlds = world_matrices(s);
    let camera = resolve_camera(s, p, &worlds)?;

    // Lights: visible light nodes in id order, world-transformed.
    let mut lights = Vec::new();
    for (id, n) in &s.nodes {
        if n.kind != NodeKind::Light || !chain_visible(s, *id) {
            continue;
        }
        let Some(lp) = &n.light else { continue };
        let world = worlds.get(id).copied().unwrap_or(crate::math::IDENTITY);
        match lp.kind {
            LightKind::Ambient => lights.push(json!({
                "type": "ambient",
                "color": lp.color,
                "intensity": lp.intensity,
            })),
            LightKind::Directional => {
                // Direction the light travels: local `direction` rotated
                // by the world linear part (scale does not skew direction
                // after normalization).
                let d = v3_norm(m4_mul_dir(&world, lp.direction));
                lights.push(json!({
                    "type": "directional",
                    "direction": d,
                    "color": lp.color,
                    "intensity": lp.intensity,
                }));
            }
            LightKind::Point => {
                let pos = [world[0][3], world[1][3], world[2][3]];
                let mut l = json!({
                    "type": "point",
                    "position": pos,
                    "color": lp.color,
                    "intensity": lp.intensity,
                });
                if let Some(r) = lp.range {
                    l["range"] = json!(r);
                }
                lights.push(l);
            }
        }
        if lights.len() > crate::MAX_LIGHTS_EMIT {
            return Err(out_of_bounds(format!(
                "scene has more than {} visible lights",
                crate::MAX_LIGHTS_EMIT
            )));
        }
    }

    // Textures: host-supplied pixel payloads pass through by name.
    let mut textures = serde_json::Map::new();
    if let Some(t) = p.get("textures") {
        let obj = t.as_object().ok_or_else(|| {
            invalid("'textures' must be an object mapping names to RGBA8 images")
        })?;
        for (name, tv) in obj {
            if name.is_empty() || name.len() > 256 {
                return Err(invalid("texture names must be 1..=256 bytes"));
            }
            let entry = tv.as_object().ok_or_else(|| {
                invalid(format!("textures.{name} must be an object"))
            })?;
            for key in ["width", "height", "bytes_b64"] {
                if !entry.contains_key(key) {
                    return Err(invalid(format!("textures.{name} requires '{key}'")));
                }
            }
            textures.insert(name.clone(), tv.clone());
        }
    }

    // Meshes: world-transform attributes; materials re-indexed by
    // first use in emission order.
    let mut material_index: std::collections::BTreeMap<u64, usize> = Default::default();
    let mut materials_out: Vec<Value> = Vec::new();
    let mut meshes_out: Vec<Value> = Vec::new();
    for (nid, mid, world) in visible_mesh_nodes(s, &worlds) {
        let Some(mesh) = s.meshes.get(&mid) else { continue };
        let Some(mat) = s.materials.get(&mesh.material) else {
            return Err(invalid(format!("mesh {mid} references missing material")));
        };
        let mat_idx = *material_index.entry(mesh.material).or_insert_with(|| {
            materials_out.push(json!({
                "color": mat.color,
                "metallic": mat.metallic,
                "roughness": mat.roughness,
                "specular": mat.specular,
                "emission": mat.emission,
                "texture": mat.texture,
                "texture_filter": mat.texture_filter,
                "double_sided": mat.double_sided,
            }));
            materials_out.len() - 1
        });
        // A referenced texture name must resolve in the supplied set.
        if let Some(tname) = &mat.texture {
            if !textures.contains_key(tname) {
                return Err(invalid(format!(
                    "material {} texture '{tname}' not supplied in renderFrame.textures",
                    mat.id
                )));
            }
        }
        let textured = mat.texture.is_some();
        let d = decode_mesh(
            &mesh.positions_b64,
            mesh.normals_b64.as_deref(),
            mesh.uvs_b64.as_deref(),
            mesh.indices_b64.as_deref(),
            textured,
            crate::MAX_VERTICES_PER_MESH,
            "mesh",
        )?;
        // Transform positions; normals via inverse-transpose (falls back
        // to the raw linear part if singular — unreachable for valid
        // non-zero-scale TRS but kept fail-safe).
        let nm = normal_matrix(&world);
        let mut wpos = Vec::with_capacity(d.positions.len());
        for v in d.positions.chunks_exact(3) {
            let w = m4_mul_v3(&world, [v[0], v[1], v[2]]);
            wpos.extend_from_slice(&w);
        }
        let positions_b64 = crate::codec::encode_f32(&wpos);
        let normals_b64 = match &d.normals {
            None => Value::Null,
            Some(n) => {
                let mut wn = Vec::with_capacity(n.len());
                let mut ok = true;
                for v in n.chunks_exact(3) {
                    let t = match &nm {
                        Some(m) => crate::math::m3_mul_v(m, [v[0], v[1], v[2]]),
                        None => crate::math::m4_mul_dir(&world, [v[0], v[1], v[2]]),
                    };
                    let l = v3_len(t);
                    if !(l.is_finite() && l > 1e-20) {
                        ok = false;
                        break;
                    }
                    wn.extend_from_slice(&v3_norm(t));
                }
                if !ok {
                    return Err(invalid(format!(
                        "node {nid} normal transform degenerates (singular scale chain)"
                    )));
                }
                Value::String(crate::codec::encode_f32(&wn))
            }
        };
        let uvs_b64 = match &d.uvs {
            None => Value::Null,
            Some(u) => Value::String(crate::codec::encode_f32(u)),
        };
        let indices_b64 = match &d.indices {
            None => Value::Null,
            Some(ix) => Value::String(crate::codec::encode_u32(ix)),
        };
        meshes_out.push(json!({
            "positions_b64": positions_b64,
            "normals_b64": normals_b64,
            "uvs_b64": uvs_b64,
            "indices_b64": indices_b64,
            "material": mat_idx,
        }));
    }

    let mut scene = json!({
        "width": width,
        "height": height,
        "format": format,
        "camera": camera,
        "lights": lights,
        "materials": materials_out,
        "textures": Value::Object(textures),
        "meshes": meshes_out,
    });
    if let Some(b) = p.get("background") {
        // Pass through; the service validates the color form.
        scene["background"] = b.clone();
    }
    Ok(read_only(scene))
}
