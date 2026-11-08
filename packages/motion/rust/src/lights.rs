//! Per-composition lighting rigs (slice G3a): bounded `Light[]` storage,
//! validation and a per-layer uniform lambert+ambient multiply over the
//! layer's rasterized straight-alpha RGBA.
//!
//! Layers are flat RGBA — there are no normal maps and no per-pixel
//! geometry — so under the G1/G2 orthographic model a layer's surface
//! normal is constant: `N = RotY(ry)·RotX(rx)·ẑ`, computable from the
//! evaluated `transform3d` alone (`layer_normal`). Each lit layer gets one
//! shade factor per channel,
//! `factor_c = Σ_lights color_l,c · intensity_l · response_l` where
//! `response` is `1` for ambient lights and `max(0, N·L̂)` for directional
//! lights, applied as a straight-RGB multiply at the post-transform /
//! pre-opacity stage (after the layer's effect stack). Alpha is untouched.
//!
//! Only `transform3d`-enabled layers are lit: a composition light rig over
//! layers without `transform3d` changes nothing (their normal is undefined
//! in this model — they are simply unlit). Specular, normal maps, shadows
//! and per-light shadowing are deferred per the G2/G3 decision record.
use ignition_core::{EngineError, TaskContext};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Largest accepted light count per composition.
pub const MAX_LIGHTS: usize = 8;
/// Checkpoint cadence for the per-pixel multiply.
const CHECKPOINT_PX: usize = 1 << 18;
/// Direction vector component bound (normalized at evaluation anyway).
const MAX_DIRECTION: f64 = 1e7;

/// One light in a composition rig. Wire form is an internally tagged
/// object: `{"type":"directional","direction":[x,y,z],"color":[r,g,b],
/// "intensity":1}` or `{"type":"ambient","color":[r,g,b],"intensity":1}`.
/// `direction` is the vector FROM the layer's surface TOWARD the light
/// (the lambert `L` directly, normalized at evaluation); a flat layer
/// facing the viewer (`N = +Z`) is fully lit by `direction:[0,0,1]` and
/// unlit by `[0,0,-1]`. `color` channels and `intensity` are 0..=1
/// weights; combined factors may exceed 1 and clip at byte conversion.
/// `Deserialize` is hand-rolled so unknown kinds/fields reject (the
/// `LayerEffect` precedent).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Light {
    /// Directional light: `color·intensity·max(0, N·L̂)` per channel.
    Directional {
        direction: [f64; 3],
        color: [f64; 3],
        intensity: f64,
    },
    /// Ambient light: flat `color·intensity` per channel, no direction.
    Ambient {
        color: [f64; 3],
        intensity: f64,
    },
}
impl Light {
    /// Parameter bounds enforced at op time and inside `validate` so
    /// hostile restores cannot carry out-of-range values.
    pub fn valid(&self) -> bool {
        match self {
            Self::Directional {
                direction,
                color,
                intensity,
            } => {
                direction
                    .iter()
                    .all(|v| v.is_finite() && v.abs() <= MAX_DIRECTION)
                    && direction.iter().any(|v| v.abs() > 1e-12)
                    && color.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v))
                    && intensity.is_finite()
                    && (0.0..=1.0).contains(intensity)
            }
            Self::Ambient { color, intensity } => {
                color.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v))
                    && intensity.is_finite()
                    && (0.0..=1.0).contains(intensity)
            }
        }
    }
}
fn field_vec3<E: serde::de::Error>(
    object: &serde_json::Map<String, Value>,
    name: &str,
) -> Result<[f64; 3], E> {
    let array = object
        .get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| E::custom("light vector must be a three channel array"))?;
    if array.len() != 3 {
        return Err(E::custom("light vector must be a three channel array"));
    }
    let mut out = [0f64; 3];
    for (slot, value) in out.iter_mut().zip(array) {
        *slot = value
            .as_f64()
            .ok_or_else(|| E::custom("light vector channels must be numbers"))?;
    }
    Ok(out)
}
fn field_intensity<E: serde::de::Error>(
    object: &serde_json::Map<String, Value>,
) -> Result<f64, E> {
    object
        .get("intensity")
        .and_then(Value::as_f64)
        .ok_or_else(|| E::custom("light intensity must be a number"))
}
impl<'de> Deserialize<'de> for Light {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("light must be an object"))?;
        let kind = object
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("light type must be a string"))?;
        let allowed: &[&str] = match kind {
            "directional" => &["type", "direction", "color", "intensity"],
            "ambient" => &["type", "color", "intensity"],
            _ => return Err(serde::de::Error::custom("unknown light type")),
        };
        if let Some(key) = object.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(serde::de::Error::custom(format!("unknown light field {key}")));
        }
        match kind {
            "directional" => Ok(Self::Directional {
                direction: field_vec3(object, "direction")?,
                color: field_vec3(object, "color")?,
                intensity: field_intensity(object)?,
            }),
            "ambient" => Ok(Self::Ambient {
                color: field_vec3(object, "color")?,
                intensity: field_intensity(object)?,
            }),
            _ => unreachable!("type allowlist above"),
        }
    }
}
/// Surface normal of a `transform3d` layer in view space:
/// `N = RotY(ry)·RotX(rx)·ẑ = (cos rx·sin ry, -sin rx, cos rx·cos ry)` —
/// the same `RotY(ry)·RotX(rx)` chain `projected_affine` projects through,
/// so the normal is consistent with the rendered orientation by
/// construction. Angles are degrees, matching `Transform3D`.
pub fn layer_normal(rx_deg: f64, ry_deg: f64) -> [f64; 3] {
    let (srx, crx) = rx_deg.to_radians().sin_cos();
    let (sry, cry) = ry_deg.to_radians().sin_cos();
    [crx * sry, -srx, crx * cry]
}
/// Per-channel shade factor for one layer: ambient contributes
/// `color·intensity` flat; directional contributes
/// `color·intensity·max(0, N·L̂)`. Pure function of the rig and normal —
/// deterministic and seek-safe.
pub fn shade(lights: &[Light], normal: [f64; 3]) -> [f64; 3] {
    let mut factor = [0f64; 3];
    for light in lights {
        match light {
            Light::Ambient { color, intensity } => {
                for c in 0..3 {
                    factor[c] += color[c] * intensity;
                }
            }
            Light::Directional {
                direction,
                color,
                intensity,
            } => {
                let len = (direction[0] * direction[0]
                    + direction[1] * direction[1]
                    + direction[2] * direction[2])
                .sqrt();
                if !len.is_finite() || len <= 1e-12 {
                    continue;
                }
                let ndl = (normal[0] * direction[0] / len
                    + normal[1] * direction[1] / len
                    + normal[2] * direction[2] / len)
                    .max(0.);
                for c in 0..3 {
                    factor[c] += color[c] * intensity * ndl;
                }
            }
        }
    }
    factor
}
/// Multiply packed straight-alpha RGBA `buf` (`w*h` pixels) RGB channels by
/// the rig's shade factor for `normal`. Alpha and hidden-RGB semantics
/// match the other CPU passes (RGB is scaled even at alpha 0). A rig whose
/// factor is exactly `[1,1,1]` (e.g. a single white ambient light at full
/// intensity) leaves the buffer byte-identical.
pub fn apply(
    buf: &mut [u8],
    w: usize,
    h: usize,
    lights: &[Light],
    normal: [f64; 3],
    ctx: Option<&TaskContext>,
) -> Result<(), EngineError> {
    if lights.is_empty() {
        return Ok(());
    }
    let factor = shade(lights, normal);
    if factor == [1., 1., 1.] {
        return Ok(());
    }
    for (index, px) in buf[..w.saturating_mul(h).saturating_mul(4)]
        .chunks_exact_mut(4)
        .enumerate()
    {
        if index % CHECKPOINT_PX == 0 {
            if let Some(c) = ctx {
                c.checkpoint()?;
            }
        }
        for c in 0..3 {
            px[c] = (f64::from(px[c]) * factor[c]).round().clamp(0., 255.) as u8;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn normal_matches_the_projected_rotation_chain() {
        assert_eq!(layer_normal(0., 0.), [0., 0., 1.]);
        // ry = 90° turns the layer plane to face +X.
        let n = layer_normal(0., 90.);
        assert!((n[0] - 1.).abs() < 1e-12 && n[2].abs() < 1e-12);
        // rx = 90° tips the top edge away: normal faces -Y.
        let n = layer_normal(90., 0.);
        assert!((n[1] + 1.).abs() < 1e-12 && n[0].abs() < 1e-12 && n[2].abs() < 1e-12);
    }
    #[test]
    fn shade_is_lambert_times_color_times_intensity() {
        let front = [0., 0., 1.];
        let rig = [Light::Directional {
            direction: [0., 0., 1.],
            color: [1., 0.5, 0.],
            intensity: 0.5,
        }];
        let f = shade(&rig, front);
        assert!((f[0] - 0.5).abs() < 1e-12 && (f[1] - 0.25).abs() < 1e-12 && f[2] == 0.);
        // Light from behind contributes nothing without ambient.
        let rig = [Light::Directional {
            direction: [0., 0., -1.],
            color: [1., 1., 1.],
            intensity: 1.,
        }];
        assert_eq!(shade(&rig, front), [0., 0., 0.]);
        // Ambient adds flat regardless of normal.
        let rig = [
            Light::Ambient {
                color: [1., 1., 1.],
                intensity: 0.25,
            },
            Light::Directional {
                direction: [0., 0., 1.],
                color: [1., 1., 1.],
                intensity: 0.5,
            },
        ];
        let f = shade(&rig, front);
        assert!((f[0] - 0.75).abs() < 1e-12);
        assert_eq!(shade(&rig, [1., 0., 0.])[0], 0.25);
    }
    #[test]
    fn hostile_light_payloads_reject() {
        for bad in [
            json!({"type":"spot","color":[1,1,1],"intensity":1}),
            json!({"type":"ambient","color":[1,1],"intensity":1}),
            json!({"type":"ambient","color":[1,1,1],"intensity":1,"direction":[0,0,1]}),
            json!({"type":"directional","color":[1,1,1],"intensity":1}),
            json!({"type":"directional","direction":[0,0,0],"color":[1,1,1],"intensity":1}),
            json!({"type":"ambient","color":[2,0,0],"intensity":1}),
            json!({"type":"ambient","color":[0,0,0],"intensity":-0.5}),
            json!({"type":"ambient","color":[0,0,0],"intensity":f64::INFINITY}),
        ] {
            assert!(
                serde_json::from_value::<Light>(bad.clone()).is_err()
                    || !serde_json::from_value::<Light>(bad.clone())
                        .map(|l| l.valid())
                        .unwrap_or(false),
                "accepted {bad}"
            );
        }
    }
    #[test]
    fn apply_multiplies_rgb_and_preserves_alpha() {
        // 2x1: red opaque + green half-transparent.
        let mut buf = vec![200, 100, 50, 255, 10, 20, 30, 128];
        let rig = [Light::Ambient {
            color: [0.5, 0.5, 0.5],
            intensity: 1.,
        }];
        apply(&mut buf, 2, 1, &rig, [0., 0., 1.], None).unwrap();
        assert_eq!(&buf[..4], &[100, 50, 25, 255]);
        assert_eq!(&buf[4..8], &[5, 10, 15, 128]);
        // Identity factor leaves bytes untouched.
        let mut same = vec![1, 2, 3, 4];
        let rig = [Light::Ambient {
            color: [1., 1., 1.],
            intensity: 1.,
        }];
        apply(&mut same, 1, 1, &rig, [0., 0., 1.], None).unwrap();
        assert_eq!(same, vec![1, 2, 3, 4]);
        // Empty rig is a no-op even with a black normal.
        let mut untouched = vec![9, 9, 9, 9];
        apply(&mut untouched, 1, 1, &[], [0., 0., 0.], None).unwrap();
        assert_eq!(untouched, vec![9, 9, 9, 9]);
    }
}
