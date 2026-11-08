//! Bounded CPU RGBA effect passes for Motion layer stacks (slice C).
//! Effects run on the layer's rendered straight-alpha canvas buffer after
//! rasterization; see `stage_effects` in lib.rs for the render ordering.
//! All passes are synchronous, allocation-bounded by the canvas cap, and
//! checkpoint the render task so `renderFrame` stays cancellable.
use ignition_core::{EngineError, TaskContext};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Largest accepted effect count per layer.
pub const MAX_EFFECTS: usize = 16;
/// Largest accepted gaussian-blur radius in pixels.
pub const MAX_BLUR_RADIUS: f64 = 64.;
/// Checkpoint cadence for long per-pixel passes.
const CHECKPOINT_PX: usize = 1 << 18;

/// One typed effect-stack entry. Wire form is an internally tagged object:
/// `{"kind":"invert"}`, `{"kind":"brightness","amount":0.5}`,
/// `{"kind":"contrast","amount":1.2}`, `{"kind":"gaussian-blur","radius_px":4}`,
/// `{"kind":"fill","color":[r,g,b,a],"opacity":0.8}` (`opacity` optional,
/// defaults 1). `Deserialize` is hand-rolled so unknown kinds and unknown
/// fields reject instead of being silently dropped (serde ignores extra
/// fields on internally tagged enums).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LayerEffect {
    /// RGB = 255 - RGB; alpha untouched (hidden RGB still processed).
    Invert,
    /// ITU-R 601 luma on RGB; alpha untouched.
    Grayscale,
    /// Additive brightness, `amount` in -1..=1 scaled by 255 (Prism parity).
    Brightness { amount: f64 },
    /// Linear-light contrast around the 0.18 pivot, `amount` factor 0..=4
    /// (photo develop math precedent).
    Contrast { amount: f64 },
    /// Approximate gaussian: three separable box-blur iterations on
    /// premultiplied RGBA, `radius_px` in 0..=64 (0 skips the pass).
    GaussianBlur { radius_px: f64 },
    /// Replace RGB with `color` and scale alpha by `color[3]`, then lerp the
    /// whole pixel toward that filled result by `opacity` (0..=1, default 1;
    /// omitted from snapshots when it is the default).
    Fill {
        color: [u8; 4],
        #[serde(skip_serializing_if = "is_one")]
        opacity: f64,
    },
}
fn one() -> f64 {
    1.0
}
fn is_one(v: &f64) -> bool {
    *v == 1.0
}
impl LayerEffect {
    /// Parameter bounds; enforced both at op time and inside `validate` so
    /// hostile restores cannot carry out-of-range values.
    pub fn valid(&self) -> bool {
        match self {
            Self::Invert | Self::Grayscale => true,
            Self::Brightness { amount } => amount.is_finite() && (-1.0..=1.0).contains(amount),
            Self::Contrast { amount } => amount.is_finite() && (0.0..=4.0).contains(amount),
            Self::GaussianBlur { radius_px } => {
                radius_px.is_finite() && (0.0..=MAX_BLUR_RADIUS).contains(radius_px)
            }
            Self::Fill { opacity, .. } => opacity.is_finite() && (0.0..=1.0).contains(opacity),
        }
    }
}
fn field_f64<E: serde::de::Error>(
    object: &serde_json::Map<String, Value>,
    name: &str,
) -> Result<f64, E> {
    object
        .get(name)
        .and_then(Value::as_f64)
        .ok_or_else(|| E::custom("effect parameter must be a finite number"))
}
fn field_color<E: serde::de::Error>(object: &serde_json::Map<String, Value>) -> Result<[u8; 4], E> {
    let array = object
        .get("color")
        .and_then(Value::as_array)
        .ok_or_else(|| E::custom("fill color must be a four channel array"))?;
    if array.len() != 4 {
        return Err(E::custom("fill color must be a four channel array"));
    }
    let mut color = [0u8; 4];
    for (slot, value) in color.iter_mut().zip(array) {
        *slot = value
            .as_u64()
            .and_then(|v| u8::try_from(v).ok())
            .ok_or_else(|| E::custom("fill color channels must be bytes"))?;
    }
    Ok(color)
}
impl<'de> Deserialize<'de> for LayerEffect {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("effect must be an object"))?;
        let kind = object
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("effect kind must be a string"))?;
        let allowed: &[&str] = match kind {
            "invert" | "grayscale" => &["kind"],
            "brightness" | "contrast" => &["kind", "amount"],
            "gaussian-blur" => &["kind", "radius_px"],
            "fill" => &["kind", "color", "opacity"],
            _ => return Err(serde::de::Error::custom("unknown effect kind")),
        };
        if let Some(key) = object.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(serde::de::Error::custom(format!(
                "unknown effect field {key}"
            )));
        }
        match kind {
            "invert" => Ok(Self::Invert),
            "grayscale" => Ok(Self::Grayscale),
            "brightness" => Ok(Self::Brightness {
                amount: field_f64(object, "amount")?,
            }),
            "contrast" => Ok(Self::Contrast {
                amount: field_f64(object, "amount")?,
            }),
            "gaussian-blur" => Ok(Self::GaussianBlur {
                radius_px: field_f64(object, "radius_px")?,
            }),
            "fill" => {
                let opacity = match object.get("opacity") {
                    None => one(),
                    Some(v) => v
                        .as_f64()
                        .ok_or_else(|| serde::de::Error::custom("fill opacity must be a number"))?,
                };
                Ok(Self::Fill {
                    color: field_color(object)?,
                    opacity,
                })
            }
            _ => unreachable!("kind allowlist above"),
        }
    }
}
fn srgba_to_linear(value: u8) -> f64 {
    let value = f64::from(value) / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}
fn linear_to_srgba(value: f64) -> u8 {
    let value = value.clamp(0.0, 1.0);
    let value = if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    };
    (value * 255.0).round().clamp(0.0, 255.0) as u8
}
/// Apply one channel-local pass over packed RGBA; alpha is never touched.
fn pixel_pass(
    buf: &mut [u8],
    ctx: Option<&TaskContext>,
    f: impl Fn(&mut [u8]),
) -> Result<(), EngineError> {
    for (index, px) in buf.chunks_exact_mut(4).enumerate() {
        if index % CHECKPOINT_PX == 0 {
            if let Some(c) = ctx {
                c.checkpoint()?;
            }
        }
        f(px)
    }
    Ok(())
}
/// Separable box blur over interleaved premultiplied f32 RGBA pixels.
/// `horizontal` blurs along x within each row, otherwise along y; edge
/// pixels clamp (extend), matching Prism's mask feather.
#[allow(clippy::too_many_arguments)]
fn box_blur(
    src: &[f32],
    dst: &mut [f32],
    w: usize,
    h: usize,
    r: usize,
    horizontal: bool,
    ctx: Option<&TaskContext>,
) -> Result<(), EngineError> {
    let (outer, inner) = if horizontal { (h, w) } else { (w, h) };
    let idx = |o: usize, i: usize, c: usize| {
        if horizontal {
            (o * w + i) * 4 + c
        } else {
            (i * w + o) * 4 + c
        }
    };
    let norm = 1.0 / (2 * r + 1) as f32;
    let mut rows = 0usize;
    for o in 0..outer {
        for c in 0..4 {
            let mut acc = 0f32;
            for k in 0..=2 * r {
                let i = k.saturating_sub(r).min(inner - 1);
                acc += src[idx(o, i, c)];
            }
            for i in 0..inner {
                dst[idx(o, i, c)] = acc * norm;
                let add = (i + r + 1).min(inner - 1);
                let rem = i.saturating_sub(r);
                acc += src[idx(o, add, c)] - src[idx(o, rem, c)];
            }
        }
        rows += 1;
        if rows % 64 == 0 {
            if let Some(c) = ctx {
                c.checkpoint()?;
            }
        }
    }
    Ok(())
}
/// Approximate gaussian blur: premultiply, three box-blur iterations
/// (horizontal+vertical each), then unpremultiply. Alpha blurs like color so
/// soft edges keep their coverage; transparent pixels contribute nothing.
fn gaussian_blur(
    buf: &mut [u8],
    w: usize,
    h: usize,
    radius_px: f64,
    ctx: Option<&TaskContext>,
) -> Result<(), EngineError> {
    let pixels = w.saturating_mul(h);
    if pixels == 0 || radius_px <= 0. {
        return Ok(());
    }
    let mut a = vec![0f32; pixels * 4];
    let mut b = vec![0f32; pixels * 4];
    for (px, src) in a.chunks_exact_mut(4).zip(buf.chunks_exact(4)) {
        let alpha = f32::from(src[3]) / 255.;
        px[0] = f32::from(src[0]) * alpha;
        px[1] = f32::from(src[1]) * alpha;
        px[2] = f32::from(src[2]) * alpha;
        px[3] = f32::from(src[3]);
    }
    // Same radius derivation as Prism's approximate gaussian feather.
    let r = ((radius_px / 3.).round() as usize).max(1);
    for _ in 0..3 {
        box_blur(&a, &mut b, w, h, r, true, ctx)?;
        box_blur(&b, &mut a, w, h, r, false, ctx)?;
    }
    for (px, dst) in a.chunks_exact(4).zip(buf.chunks_exact_mut(4)) {
        let alpha = px[3] / 255.;
        for c in 0..3 {
            dst[c] = if alpha > 1e-6 {
                (px[c] / alpha).round().clamp(0., 255.) as u8
            } else {
                0
            };
        }
        dst[3] = px[3].round().clamp(0., 255.) as u8;
    }
    Ok(())
}
/// Apply the stack in order to packed straight-alpha RGBA `buf` of `w*h`.
/// Callers guarantee `buf.len() == w*h*4`; effects were validated already.
pub fn apply_effects(
    buf: &mut [u8],
    w: usize,
    h: usize,
    effects: &[LayerEffect],
    ctx: Option<&TaskContext>,
) -> Result<(), EngineError> {
    for effect in effects {
        match effect {
            LayerEffect::Invert => pixel_pass(buf, ctx, |px| {
                for c in 0..3 {
                    px[c] = 255 - px[c];
                }
            })?,
            LayerEffect::Grayscale => pixel_pass(buf, ctx, |px| {
                let y = (0.299 * f64::from(px[0])
                    + 0.587 * f64::from(px[1])
                    + 0.114 * f64::from(px[2]))
                .round()
                .clamp(0., 255.) as u8;
                px[0] = y;
                px[1] = y;
                px[2] = y;
            })?,
            LayerEffect::Brightness { amount } => {
                let delta = amount * 255.;
                pixel_pass(buf, ctx, |px| {
                    for c in 0..3 {
                        px[c] = (f64::from(px[c]) + delta).round().clamp(0., 255.) as u8;
                    }
                })?
            }
            LayerEffect::Contrast { amount } => {
                let factor = *amount;
                pixel_pass(buf, ctx, |px| {
                    for c in 0..3 {
                        let linear = srgba_to_linear(px[c]);
                        px[c] = linear_to_srgba((linear - 0.18) * factor + 0.18);
                    }
                })?
            }
            LayerEffect::GaussianBlur { radius_px } => gaussian_blur(buf, w, h, *radius_px, ctx)?,
            LayerEffect::Fill { color, opacity } => {
                let op = *opacity;
                pixel_pass(buf, ctx, |px| {
                    let alpha = f64::from(px[3]);
                    let filled = [
                        color[0],
                        color[1],
                        color[2],
                        (f64::from(color[3]) * alpha / 255.).round() as u8,
                    ];
                    for c in 0..4 {
                        let v = f64::from(px[c]) * (1. - op) + f64::from(filled[c]) * op;
                        px[c] = v.round().clamp(0., 255.) as u8;
                    }
                })?
            }
        }
        if let Some(c) = ctx {
            c.checkpoint()?;
        }
    }
    Ok(())
}
