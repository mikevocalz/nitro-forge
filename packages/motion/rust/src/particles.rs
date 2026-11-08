//! Deterministic particle emitters (slice F).
//!
//! An emitter is a pure function of `(seed, spec, composition-local time)`:
//! there is no simulated state anywhere in the document, so `evaluate(t)`
//! and `renderFrame(t)` are seek-safe by construction — jumping backward or
//! forward recomputes identical output for identical input.
//!
//! Emission model: particles are born on a uniform grid at `rate` births per
//! second. Birth index `n` (u64, `n = 0, 1, 2, ...`) occurs at
//! `t_birth = n / rate`; a particle is alive while its age
//! `tau = t - t_birth` lies in `0..=lifetime_s`. At time `t` the alive index
//! window is `n_min = ceil((t - lifetime) * rate)` (clamped at 0) through
//! `n_max = floor(t * rate)`, which contains at most `rate * lifetime + 1`
//! indices — `validate` bounds that product at 511 so at most
//! [`MAX_SPRITES`] (512) particles are ever alive per emitter per frame.
//!
//! Per-particle attributes are closed-form, not integrated: birth position
//! is uniform in the spawn rect, velocity is `speed_i` along
//! `angle_deg +/- spread_deg/2`, and position integrates the constant
//! acceleration analytically as
//! `p(tau) = spawn + v * tau + 0.5 * gravity * tau^2`.
//! `speed_i`, the spawn point, the size multiplier and the spawn angle all
//! derive from a splitmix64-style hash of `(seed, n, channel)`, so every
//! particle is reproducible from its index alone.
//!
//! Rendering: particles rasterize on the CPU into a canvas-sized
//! straight-alpha RGBA buffer (4x4 supersampled shape masks, nearest-neighbor
//! asset sprites) which uploads through the normal `addRasterLayer` +
//! `drawPixels` path with an identity transform — the layer's effective
//! affine (own transform plus `parent_id` chain, shear included) is baked
//! into particle positions and sprite scale at stamp time. Sprite
//! *orientation* is not rotated: axis-aligned sprites take their x/y draw
//! sizes from the affine's column norms, a documented approximation.
//! Sprites stamp in ascending birth-index order (oldest first), and a
//! deterministic stamped-pixel budget bounds worst-case raster cost.
use crate::assets::RasterAsset;
use crate::Affine;
use ignition_core::{EngineError, TaskContext};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;

fn bad(message: &str) -> EngineError {
    EngineError::validation(message)
}
/// Largest accepted alive-particle count per emitter per frame.
pub const MAX_SPRITES: usize = 512;
/// Largest accepted `rate * lifetime_s` product (alive window minus one).
const MAX_ALIVE_PRODUCT: f64 = (MAX_SPRITES - 1) as f64;
/// Largest accepted emitter count per document.
pub const MAX_EMITTERS: usize = 64;
/// Largest summed alive-particle bound across one composition's emitters.
pub const MAX_COMP_SPRITES: usize = MAX_SPRITES;
/// Emitter parameter bounds (see `ParticleEmitter::valid`).
pub const MAX_RATE: f64 = 8192.;
pub const MAX_LIFETIME_S: f64 = 3600.;
pub const MAX_SPEED: f64 = 1e5;
pub const MAX_SPRITE_DIM: f64 = 512.;
pub const MAX_SPAWN_COORD: f64 = 1e7;
const MAX_ANGLE: f64 = 1e6;
const MAX_ACCEL: f64 = 1e5;
/// Supersample grid per sprite pixel for mask coverage.
const SUB: usize = 4;
/// Total stamped canvas pixels one emitter may consume per frame, as a
/// multiple of the canvas area; later (younger) particles drop out
/// deterministically once the budget is spent.
const STAMP_BUDGET_FACTOR: usize = 8;

fn finite_bounded(v: f64, limit: f64) -> bool {
    v.is_finite() && v.abs() <= limit
}

/// Sprite geometry kind for shape sprites; wire names are lowercase.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpriteShape {
    Rect,
    Ellipse,
}
/// What each particle draws: a bounded axis-aligned shape or an existing
/// immutable raster asset stamped at its natural size. Wire form is an
/// internally tagged object `{"kind":"shape",...}` / `{"kind":"asset",...}`;
/// `Deserialize` is hand-rolled so unknown kinds/fields reject (same
/// precedent as `LayerEffect`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ParticleSprite {
    /// `width`/`height` are the sprite's draw size in layer-local units
    /// before the layer affine and per-particle size curves scale them.
    Shape {
        shape: SpriteShape,
        width: f64,
        height: f64,
        fill: [u8; 4],
    },
    /// Stamps `asset_id`'s pixels at the asset's natural pixel size.
    Asset { asset_id: u64 },
}
impl ParticleSprite {
    /// Asset referenced by this sprite, if any (used by reference checks).
    pub fn asset_id(&self) -> Option<u64> {
        match self {
            Self::Shape { .. } => None,
            Self::Asset { asset_id } => Some(*asset_id),
        }
    }
}
impl<'de> Deserialize<'de> for ParticleSprite {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("particle sprite must be an object"))?;
        let kind = object
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("particle sprite kind must be a string"))?;
        let allowed: &[&str] = match kind {
            "shape" => &["kind", "shape", "width", "height", "fill"],
            "asset" => &["kind", "asset_id"],
            _ => {
                return Err(serde::de::Error::custom("unknown particle sprite kind"));
            }
        };
        if let Some(key) = object.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(serde::de::Error::custom(format!(
                "unknown particle sprite field {key}"
            )));
        }
        match kind {
            "shape" => Ok(Self::Shape {
                shape: serde_json::from_value(
                    object
                        .get("shape")
                        .cloned()
                        .ok_or_else(|| serde::de::Error::custom("shape sprite needs a shape"))?,
                )
                .map_err(serde::de::Error::custom)?,
                width: object
                    .get("width")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| serde::de::Error::custom("sprite width must be a number"))?,
                height: object
                    .get("height")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| serde::de::Error::custom("sprite height must be a number"))?,
                fill: serde_json::from_value(
                    object
                        .get("fill")
                        .cloned()
                        .ok_or_else(|| serde::de::Error::custom("shape sprite needs a fill"))?,
                )
                .map_err(serde::de::Error::custom)?,
            }),
            "asset" => Ok(Self::Asset {
                asset_id: object
                    .get("asset_id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| serde::de::Error::custom("asset sprite needs an asset_id"))?,
            }),
            _ => unreachable!("kind allowlist above"),
        }
    }
}
/// Optional spawn rectangle in the layer's transform space; absent selects
/// the containing composition's canvas rect mapped into local space.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpawnRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
fn rate_default() -> f64 {
    30.
}
fn lifetime_default() -> f64 {
    1.
}
fn angle_default() -> f64 {
    -90.
}
fn spread_default() -> f64 {
    45.
}
fn speed_default() -> f64 {
    120.
}
fn fade_default() -> f64 {
    0.25
}
/// Bounded deterministic emitter spec stored on `kind:"particles"` layers.
/// All fields are serde-defaulted except `sprite`, so snapshots stay small
/// and hostile payloads still face `valid()` on restore.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParticleEmitter {
    /// PRNG seed for every per-particle hash; different seeds decorrelate
    /// spawn points, angles, speeds and size jitter.
    #[serde(default)]
    pub seed: u64,
    /// Births per second, 0..=8192. `rate * lifetime_s <= 511` keeps the
    /// alive window within [`MAX_SPRITES`]; rate 0 emits nothing.
    #[serde(default = "rate_default")]
    pub rate: f64,
    /// Particle lifetime in seconds, 0 < lifetime <= 3600.
    #[serde(default = "lifetime_default")]
    pub lifetime_s: f64,
    /// Central emission direction in degrees (y-down canvas convention,
    /// same as `rotation`); -90 shoots upward.
    #[serde(default = "angle_default")]
    pub angle_deg: f64,
    /// Full cone width in degrees around `angle_deg`, 0..=360.
    #[serde(default = "spread_default")]
    pub spread_deg: f64,
    /// Initial speed in layer-local units/second, 0..=1e5.
    #[serde(default = "speed_default")]
    pub speed: f64,
    /// Per-particle speed variation fraction, 0..=1 (0 = uniform speed).
    #[serde(default)]
    pub speed_jitter: f64,
    /// Constant acceleration `[x, y]` in local units/s^2, each |.|<=1e5.
    #[serde(default)]
    pub gravity: [f64; 2],
    /// Spawn rectangle in layer-local units; absent = the containing
    /// composition's canvas rect mapped into local space.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spawn: Option<SpawnRect>,
    /// What each alive particle draws (required).
    pub sprite: ParticleSprite,
    /// Per-particle size variation fraction, 0..=1.
    #[serde(default)]
    pub size_jitter: f64,
    /// Linear size growth over the particle's life: multiplier is
    /// `1 + grow * tau/lifetime`, -0.9..=8.
    #[serde(default)]
    pub grow: f64,
    /// Fraction of lifetime (0..=0.5) spent in linear fade-in and fade-out.
    #[serde(default = "fade_default")]
    pub fade: f64,
}
impl ParticleEmitter {
    /// Parameter bounds enforced at op time and inside `validate` so hostile
    /// restores cannot carry out-of-range values. Asset *existence* is a
    /// document-level check performed by the caller.
    pub fn valid(&self) -> bool {
        self.rate.is_finite()
            && (0.0..=MAX_RATE).contains(&self.rate)
            && self.lifetime_s.is_finite()
            && self.lifetime_s > 0.
            && self.lifetime_s <= MAX_LIFETIME_S
            && finite_bounded(self.angle_deg, MAX_ANGLE)
            && self.spread_deg.is_finite()
            && (0.0..=360.0).contains(&self.spread_deg)
            && self.speed.is_finite()
            && (0.0..=MAX_SPEED).contains(&self.speed)
            && self.speed_jitter.is_finite()
            && (0.0..=1.0).contains(&self.speed_jitter)
            && self.gravity.iter().all(|g| finite_bounded(*g, MAX_ACCEL))
            && self.size_jitter.is_finite()
            && (0.0..=1.0).contains(&self.size_jitter)
            && self.grow.is_finite()
            && (-0.9..=8.0).contains(&self.grow)
            && self.fade.is_finite()
            && (0.0..=0.5).contains(&self.fade)
            && self.rate * self.lifetime_s <= MAX_ALIVE_PRODUCT
            && self.spawn.is_none_or(|r| {
                finite_bounded(r.x, MAX_SPAWN_COORD)
                    && finite_bounded(r.y, MAX_SPAWN_COORD)
                    && r.w.is_finite()
                    && r.h.is_finite()
                    && r.w > 0.
                    && r.h > 0.
                    && r.w <= MAX_SPAWN_COORD
                    && r.h <= MAX_SPAWN_COORD
            })
            && match &self.sprite {
                ParticleSprite::Shape { width, height, .. } => {
                    width.is_finite()
                        && height.is_finite()
                        && *width > 0.
                        && *height > 0.
                        && *width <= MAX_SPRITE_DIM
                        && *height <= MAX_SPRITE_DIM
                }
                ParticleSprite::Asset { asset_id } => *asset_id != 0,
            }
    }
    /// Upper bound on simultaneously alive particles at any time `t`.
    /// `validate` keeps this at [`MAX_SPRITES`]; the cap is defensive for
    /// sums computed before per-emitter validity is known.
    pub fn alive_bound(&self) -> usize {
        if self.rate <= 0. {
            0
        } else {
            ((self.rate * self.lifetime_s).ceil() as usize + 1).min(MAX_SPRITES)
        }
    }
}
/// splitmix64-style integer hash -> [0,1). Mixing `(seed, index, channel)`
/// gives each particle independent deterministic attributes; identical
/// inputs always produce identical floats within one engine build (the
/// integer hash and closed-form math are platform-exact; trig/hypot in
/// the render path use platform libm, so cross-platform bit-identity is
/// not claimed).
fn rand01(seed: u64, index: u64, channel: u64) -> f64 {
    let mut z = seed
        .wrapping_add(index.wrapping_mul(0x9E37_79B9_7F4A_7C15))
        .wrapping_add(channel.wrapping_mul(0xBF58_476D_1CE4_E5B9));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 * (1.0 / 9007199254740992.0)
}
/// Spawn rect in layer-local space. Explicit `spawn` passes through;
/// absent maps the containing canvas rect through the inverse affine and
/// takes the axis-aligned bounds of the four mapped corners (a superset
/// under rotation — deterministic and conservative).
pub(crate) fn spawn_local(
    e: &ParticleEmitter,
    affine: &Affine,
    cw: f64,
    ch: f64,
) -> (f64, f64, f64, f64) {
    if let Some(r) = e.spawn {
        return (r.x, r.y, r.w, r.h);
    }
    let det = affine.a * affine.d - affine.b * affine.c;
    if !det.is_finite() || det.abs() < 1e-9 {
        return (0., 0., cw, ch);
    }
    let inv = |x: f64, y: f64| {
        (
            (affine.d * (x - affine.e) - affine.c * (y - affine.f)) / det,
            (-affine.b * (x - affine.e) + affine.a * (y - affine.f)) / det,
        )
    };
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (cx, cy) in [(0., 0.), (cw, 0.), (0., ch), (cw, ch)] {
        let (x, y) = inv(cx, cy);
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    (min_x, min_y, max_x - min_x, max_y - min_y)
}
enum ResolvedSprite<'a> {
    Shape {
        shape: SpriteShape,
        width: f64,
        height: f64,
        fill: [u8; 4],
    },
    Asset(&'a RasterAsset),
}
/// Stamp one sprite centered at canvas point `(cx, cy)` with draw size
/// `(dw, dh)`. `mask` selects the coverage shape (asset sprites always use
/// the rect mask); `alpha_mul` carries the lifetime fade. Consumes `budget`
/// stamped canvas pixels; oversized sprites that exceed the remaining
/// budget are skipped whole so the drop rule stays deterministic.
#[allow(clippy::too_many_arguments)]
fn stamp_sprite(
    buf: &mut [u8],
    w: usize,
    h: usize,
    cx: f64,
    cy: f64,
    dw: f64,
    dh: f64,
    ellipse: bool,
    sprite: &ResolvedSprite,
    alpha_mul: f64,
    budget: &mut usize,
) {
    let (w_f, h_f) = (w as f64, h as f64);
    let x0 = cx - dw * 0.5;
    let y0 = cy - dh * 0.5;
    let x1 = x0 + dw;
    let y1 = y0 + dh;
    if !(x1 > 0. && y1 > 0. && x0 < w_f && y0 < h_f) {
        return;
    }
    let px0 = x0.floor().max(0.) as usize;
    let py0 = y0.floor().max(0.) as usize;
    let px1 = (x1.ceil() as usize).min(w);
    let py1 = (y1.ceil() as usize).min(h);
    if px0 >= px1 || py0 >= py1 {
        return;
    }
    let area = (px1 - px0) * (py1 - py0);
    if area > *budget {
        return;
    }
    *budget -= area;
    for py in py0..py1 {
        for px in px0..px1 {
            let mut covered = 0u32;
            for sy in 0..SUB {
                for sx in 0..SUB {
                    let sx_p = px as f64 + (sx as f64 + 0.5) / SUB as f64;
                    let sy_p = py as f64 + (sy as f64 + 0.5) / SUB as f64;
                    let inside = if ellipse {
                        let nx = (sx_p - cx) / (dw * 0.5);
                        let ny = (sy_p - cy) / (dh * 0.5);
                        nx * nx + ny * ny <= 1.
                    } else {
                        (sx_p - cx).abs() <= dw * 0.5 && (sy_p - cy).abs() <= dh * 0.5
                    };
                    covered += inside as u32;
                }
            }
            if covered == 0 {
                continue;
            }
            let coverage = covered as f64 / (SUB * SUB) as f64;
            // Source color/alpha at the pixel center.
            let (r, g, b, a) = match sprite {
                ResolvedSprite::Shape { fill, .. } => (
                    f64::from(fill[0]) / 255.,
                    f64::from(fill[1]) / 255.,
                    f64::from(fill[2]) / 255.,
                    f64::from(fill[3]) / 255.,
                ),
                ResolvedSprite::Asset(asset) => {
                    // Nearest texel: canvas pixel center -> sprite-local
                    // fraction -> texel. `dw`/`dh` are the on-canvas draw
                    // size; source dims come from the asset.
                    let fx = ((px as f64 + 0.5 - x0) / dw * f64::from(asset.width))
                        .floor()
                        .clamp(0., f64::from(asset.width) - 1.)
                        as usize;
                    let fy = ((py as f64 + 0.5 - y0) / dh * f64::from(asset.height))
                        .floor()
                        .clamp(0., f64::from(asset.height) - 1.)
                        as usize;
                    let i = (fy * asset.width as usize + fx) * 4;
                    (
                        f64::from(asset.pixels[i]) / 255.,
                        f64::from(asset.pixels[i + 1]) / 255.,
                        f64::from(asset.pixels[i + 2]) / 255.,
                        f64::from(asset.pixels[i + 3]) / 255.,
                    )
                }
            };
            let sa = (a * coverage * alpha_mul).clamp(0., 1.);
            if sa <= 0. {
                continue;
            }
            let di = (py * w + px) * 4;
            let da = f64::from(buf[di + 3]) / 255.;
            let oa = sa + da * (1. - sa);
            if oa <= 0. {
                continue;
            }
            let ks = sa / oa;
            let kd = da * (1. - sa) / oa;
            for (c, s) in [r, g, b].into_iter().enumerate() {
                let v = s * ks + (f64::from(buf[di + c]) / 255.) * kd;
                buf[di + c] = (v * 255.).round().clamp(0., 255.) as u8;
            }
            buf[di + 3] = (oa * 255.).round().clamp(0., 255.) as u8;
        }
    }
}
/// Rasterize one emitter into packed straight-alpha RGBA at `time_s`.
/// `affine` is the layer's effective canvas transform (own transform plus
/// `parent_id` chain); `width`/`height` are the containing composition's
/// canvas dimensions. Deterministic: identical inputs always produce
/// identical bytes; no state is read or written.
pub fn render(
    emitter: Option<&ParticleEmitter>,
    assets: &BTreeMap<u64, Arc<RasterAsset>>,
    affine: &Affine,
    width: u32,
    height: u32,
    time_s: f64,
    ctx: Option<&TaskContext>,
) -> Result<Vec<u8>, EngineError> {
    let (w, h) = (width as usize, height as usize);
    let mut buf = vec![0u8; w.saturating_mul(h).saturating_mul(4)];
    let Some(e) = emitter else {
        return Ok(buf);
    };
    if w == 0 || h == 0 || !time_s.is_finite() || e.rate <= 0. {
        return Ok(buf);
    }
    let sprite = match &e.sprite {
        ParticleSprite::Shape {
            shape,
            width,
            height,
            fill,
        } => ResolvedSprite::Shape {
            shape: *shape,
            width: *width,
            height: *height,
            fill: *fill,
        },
        ParticleSprite::Asset { asset_id } => ResolvedSprite::Asset(
            assets
                .get(asset_id)
                .ok_or_else(|| bad("particle sprite references unknown asset"))?,
        ),
    };
    let (sx, sy, sw, sh) = spawn_local(e, affine, w as f64, h as f64);
    if !(sw.is_finite() && sh.is_finite() && sw > 0. && sh > 0.) {
        return Ok(buf);
    }
    // Alive birth-index window; both bounds are derived from the same
    // f64 arithmetic every call, so the window is deterministic.
    let n_min = {
        let v = (time_s - e.lifetime_s) * e.rate;
        if v <= 0. {
            0
        } else {
            v.ceil() as u64
        }
    };
    let n_max = (time_s * e.rate).floor() as u64;
    if n_min > n_max {
        return Ok(buf);
    }
    let scale_x = affine.a.hypot(affine.b);
    let scale_y = affine.c.hypot(affine.d);
    let mut budget = STAMP_BUDGET_FACTOR.saturating_mul(w).saturating_mul(h);
    let mut alive = 0usize;
    let mut ticks = 0u32;
    for n in n_min..=n_max {
        if alive >= MAX_SPRITES || budget == 0 {
            break;
        }
        ticks += 1;
        if ticks % 64 == 0 {
            if let Some(c) = ctx {
                c.checkpoint()?;
            }
        }
        let tau = time_s - n as f64 / e.rate;
        if !(0. ..=e.lifetime_s).contains(&tau) {
            continue;
        }
        alive += 1;
        // Lifetime fade: linear ramps over `fade` fraction of life at both
        // ends; fade 0 means constant opacity for the whole life.
        let life_frac = tau / e.lifetime_s;
        let win = e.fade * e.lifetime_s;
        let alpha_mul = if win > 0. {
            (tau / win).min((e.lifetime_s - tau) / win).clamp(0., 1.)
        } else {
            1.
        };
        if alpha_mul <= 0. {
            continue;
        }
        let u_sx = rand01(e.seed, n, 0);
        let u_sy = rand01(e.seed, n, 1);
        let u_ang = rand01(e.seed, n, 2);
        let u_spd = rand01(e.seed, n, 3);
        let u_size = rand01(e.seed, n, 4);
        let angle = (e.angle_deg + e.spread_deg * (2. * u_ang - 1.)).to_radians();
        let speed = (e.speed * (1. + e.speed_jitter * (2. * u_spd - 1.))).max(0.);
        let size_mult = (1. + e.grow * life_frac) * (1. + e.size_jitter * (2. * u_size - 1.));
        if !(size_mult.is_finite() && size_mult > 0.) {
            continue;
        }
        let lx = sx + sw * u_sx + angle.cos() * speed * tau + 0.5 * e.gravity[0] * tau * tau;
        let ly = sy + sh * u_sy + angle.sin() * speed * tau + 0.5 * e.gravity[1] * tau * tau;
        let cx = affine.a * lx + affine.c * ly + affine.e;
        let cy = affine.b * lx + affine.d * ly + affine.f;
        if !(cx.is_finite() && cy.is_finite()) {
            continue;
        }
        let (bw, bh) = match &sprite {
            ResolvedSprite::Shape { width, height, .. } => (*width, *height),
            ResolvedSprite::Asset(asset) => (f64::from(asset.width), f64::from(asset.height)),
        };
        let dw = bw * scale_x * size_mult;
        let dh = bh * scale_y * size_mult;
        if !(dw.is_finite() && dh.is_finite() && dw >= 0.25 && dh >= 0.25) {
            continue;
        }
        let ellipse = matches!(
            &sprite,
            ResolvedSprite::Shape {
                shape: SpriteShape::Ellipse,
                ..
            }
        );
        stamp_sprite(
            &mut buf,
            w,
            h,
            cx,
            cy,
            dw,
            dh,
            ellipse,
            &sprite,
            alpha_mul,
            &mut budget,
        );
    }
    Ok(buf)
}
