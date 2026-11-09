//! Mesh geometry codec: little-endian f32/u32 blobs carried as canonical
//! base64 inside document state — the same wire shape `scene-render`
//! consumes, so `renderFrame` can pass attributes through unchanged when
//! a mesh node sits at the identity transform and re-encode transformed
//! copies otherwise. Validation mirrors `rust/scene-render`'s
//! `parse_mesh` rules so the engine fails at write time instead of
//! letting an invalid description reach the rasterizer.

use ignition_core::{base64_decode, base64_encode, EngineError};
use serde_json::Value;

pub fn bad(msg: impl Into<String>) -> EngineError {
    EngineError::validation(msg)
}
pub fn invalid(msg: impl Into<String>) -> EngineError {
    EngineError::invalid(msg)
}
pub fn out_of_bounds(msg: impl Into<String>) -> EngineError {
    EngineError::out_of_bounds(msg)
}

/// Canonical base64 of raw bytes (re-encoded so state has one spelling).
pub fn b64(bytes: &[u8]) -> String {
    base64_encode(bytes)
}

fn decode_f32(b64s: &str, what: &str) -> Result<Vec<f32>, EngineError> {
    let bytes = base64_decode(b64s).map_err(|e| invalid(format!("{what}: {e}")))?;
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

fn decode_u32(b64s: &str, what: &str) -> Result<Vec<u32>, EngineError> {
    let bytes = base64_decode(b64s).map_err(|e| invalid(format!("{what}: {e}")))?;
    if bytes.len() % 4 != 0 {
        return Err(invalid(format!("{what}: byte length must be a multiple of 4")));
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for c in bytes.chunks_exact(4) {
        out.push(u32::from_le_bytes([c[0], c[1], c[2], c[3]]));
    }
    Ok(out)
}

/// Encode a flat f32 slice as canonical f32le base64.
pub fn encode_f32(v: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for f in v {
        bytes.extend_from_slice(&f.to_le_bytes());
    }
    b64(&bytes)
}

pub fn encode_u32(v: &[u32]) -> String {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for i in v {
        bytes.extend_from_slice(&i.to_le_bytes());
    }
    b64(&bytes)
}

/// One mesh's decoded geometry.
pub struct Decoded {
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub indices: Option<Vec<u32>>,
}

/// Decode and fully validate one mesh's geometry fields. `max_vertices`
/// is the per-mesh cap; `material_has_texture` enforces the service rule
/// that textured materials require UVs.
pub fn decode_mesh(
    positions_b64: &str,
    normals_b64: Option<&str>,
    uvs_b64: Option<&str>,
    indices_b64: Option<&str>,
    textured: bool,
    max_vertices: usize,
    what: &str,
) -> Result<Decoded, EngineError> {
    let positions = decode_f32(positions_b64, &format!("{what}.positions_b64"))?;
    if positions.len() % 3 != 0 {
        return Err(invalid(format!(
            "{what}.positions_b64 length must be a multiple of 3 floats"
        )));
    }
    let verts = positions.len() / 3;
    if verts == 0 {
        return Err(invalid(format!("{what} has no vertices")));
    }
    if verts > max_vertices {
        return Err(out_of_bounds(format!(
            "{what} has {verts} vertices; per-mesh limit is {max_vertices}"
        )));
    }

    let normals = match normals_b64 {
        None => None,
        Some(b64s) => {
            let n = decode_f32(b64s, &format!("{what}.normals_b64"))?;
            if n.len() != positions.len() {
                return Err(invalid(format!(
                    "{what}.normals_b64 must have the same float count as positions_b64"
                )));
            }
            for t in n.chunks_exact(3) {
                if t[0] * t[0] + t[1] * t[1] + t[2] * t[2] == 0.0 {
                    return Err(invalid(format!(
                        "{what}.normals_b64 contains a zero normal"
                    )));
                }
            }
            Some(n)
        }
    };

    let uvs = match uvs_b64 {
        None => None,
        Some(b64s) => {
            let u = decode_f32(b64s, &format!("{what}.uvs_b64"))?;
            if u.len() != verts * 2 {
                return Err(invalid(format!(
                    "{what}.uvs_b64 must have exactly 2 floats per vertex"
                )));
            }
            Some(u)
        }
    };
    if textured && uvs.is_none() {
        return Err(invalid(format!(
            "{what} uses a textured material but has no uvs_b64"
        )));
    }

    let indices = match indices_b64 {
        None => {
            if verts % 3 != 0 {
                return Err(invalid(format!(
                    "{what} without indices_b64 requires a vertex count divisible by 3"
                )));
            }
            None
        }
        Some(b64s) => {
            let ix = decode_u32(b64s, &format!("{what}.indices_b64"))?;
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
    };

    Ok(Decoded {
        positions,
        normals,
        uvs,
        indices,
    })
}

/// Decode base64 and re-encode canonically — one spelling per blob in
/// state, so snapshots are byte-stable.
pub fn canon_b64(s: &str, what: &str) -> Result<String, EngineError> {
    let bytes = base64_decode(s).map_err(|e| invalid(format!("{what}: {e}")))?;
    Ok(b64(&bytes))
}

/// Read an optional base64 string field from a JSON payload.
pub fn opt_b64_field<'a>(p: &'a Value, key: &str) -> Result<Option<&'a str>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(invalid(format!("'{key}' must be a base64 string"))),
    }
}

/// Read a required base64 string field from a JSON payload.
pub fn req_b64_field<'a>(p: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    p.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("'{key}' requires a base64 string")))
}
