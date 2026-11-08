//! splice-render — host-side deterministic timeline compositor and audio
//! mixer for Splice.
//!
//! This is **not** an `ignition_core::Engine`: no `EngineKind`, no
//! `Command`/`Journal`, no `NFD1` snapshot, no document mutations. Per
//! `docs/completion/reports/P08-splice-compositor-decision.md` it is a
//! sibling host provider in the `folio-render`/`nf-raw`/`nf-color` family:
//! the caller feeds it the splice engine's `renderPlan` output plus
//! host-resolved decoded media (RGBA8 stills from `MediaDecoder`,
//! interleaved f32 PCM), and it returns bounded, deterministic RGBA8
//! frames (straight alpha, sRGB — the `MediaEncoder`/Motion pixel
//! contract) and mixed interleaved f32 PCM for the encoder provider.
//!
//! v1 scope (decision record §"Scope of v1"):
//! - clip stacking in `renderPlan` track order (bottom → top; audio
//!   tracks carry no picture), per-clip fit-to-frame (`fit` letterbox /
//!   `fill` crop — a host render parameter, not engine state);
//! - `track_active` visibility (hidden/muted/solo already resolved by
//!   the engine into the plan);
//! - constant-`speed` and `speed_keys` retime by inverting the
//!   media-time integral `∫ dt/speed(t)` at each output timestamp;
//!   nearest-source-frame selection (no frame blending — that is
//!   effects-tier work);
//! - the eight transition kinds evaluated parametrically inside their
//!   `start_s..end_s` windows;
//! - audio mix: per-clip `gain_db`/`pan`, `cross_fade` equal-power
//!   ramps, mixed to interleaved stereo f32 at a caller-chosen rate;
//! - a host-side render cache (D-28) keyed by
//!   (snapshot salt, media salt, time, size, fit, provider version).
//!
//! Determinism: fixed operation order, nearest/bilinear sampling only,
//! no platform SIMD math, no threading. The same inputs produce
//! byte-identical output on a given build; floating-point results are
//! IEEE-754 deterministic for a fixed operation order.
//!
//! Bounds (fail-closed, folio-render style): canvas ≤ 1920×1080, source
//! frames ≤ 4096 px/side and ≤ 64 MiB decoded each, ≤ 64 sources and
//! ≤ 256 MiB decoded RGBA per call, ≤ 4096 plan clips/transitions,
//! ≤ 60 s per `renderRange`/`mixAudio` call, ≤ 30 fps, ≤ 1800 frames
//! per job, ≤ 4 live jobs, PCM sources ≤ 128 MiB each, cache ≤ 64
//! entries / ≤ 256 MiB, JSON-lines frames ≤ 256 MiB.

use ignition_core::{base64_decode, base64_encode, EngineError, ErrorCode, FrameRequest, FrameResponse};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::BufRead;

// ---- Bounds ------------------------------------------------------------

/// Provider version folded into every render-cache key.
pub const PROVIDER_VERSION: &str = concat!("splice-render/", env!("CARGO_PKG_VERSION"));
/// Maximum canvas width in pixels (v1 ceiling: 1080p class).
pub const MAX_OUTPUT_WIDTH: u32 = 1920;
/// Maximum canvas height in pixels.
pub const MAX_OUTPUT_HEIGHT: u32 = 1080;
/// Maximum decoded source frame dimension per side.
pub const MAX_SOURCE_DIM: u32 = 4096;
/// Maximum decoded RGBA bytes of one source frame.
pub const MAX_SOURCE_FRAME_BYTES: usize = 64 * 1024 * 1024; // 64 MiB
/// Maximum decoded frames supplied per video source.
pub const MAX_FRAMES_PER_SOURCE: usize = 4096;
/// Maximum video sources per call.
pub const MAX_SOURCES: usize = 64;
/// Maximum total decoded RGBA bytes across all video sources per call.
pub const MAX_SOURCE_TOTAL_BYTES: usize = 256 * 1024 * 1024; // 256 MiB
/// Maximum decoded PCM bytes of one audio source.
pub const MAX_PCM_SOURCE_BYTES: usize = 128 * 1024 * 1024; // 128 MiB
/// Maximum total decoded PCM bytes across all audio sources per call.
pub const MAX_PCM_TOTAL_BYTES: usize = 256 * 1024 * 1024; // 256 MiB
/// Maximum clips across the whole plan.
pub const MAX_PLAN_CLIPS: usize = 4096;
/// Maximum transitions across the whole plan.
pub const MAX_PLAN_TRANSITIONS: usize = 4096;
/// Maximum tracks in the plan.
pub const MAX_PLAN_TRACKS: usize = 64;
/// Maximum `speed_keys` per clip (engine bound).
pub const MAX_SPEED_KEYS: usize = 256;
/// Maximum seconds composited by one `renderRange` job.
pub const MAX_RANGE_SECONDS: f64 = 60.0;
/// Maximum output frame rate for `renderRange`.
pub const MAX_RANGE_FPS: f64 = 30.0;
/// Maximum frames emitted by one `renderRange` job.
pub const MAX_RANGE_FRAMES: usize = 1800;
/// Maximum simultaneously live `renderRange` jobs.
pub const MAX_JOBS: usize = 4;
/// Maximum seconds mixed by one `mixAudio` call.
pub const MAX_MIX_SECONDS: f64 = 60.0;
/// Minimum `mixAudio` output sample rate.
pub const MIN_MIX_SAMPLE_RATE: u32 = 8000;
/// Maximum `mixAudio` output sample rate.
pub const MAX_MIX_SAMPLE_RATE: u32 = 96_000;
/// Maximum audio source sample rate accepted from the decoder.
pub const MAX_SOURCE_SAMPLE_RATE: u32 = 192_000;
/// Minimum audio source sample rate accepted from the decoder.
pub const MIN_SOURCE_SAMPLE_RATE: u32 = 8_000;
/// Render-cache entry cap.
pub const MAX_CACHE_ENTRIES: usize = 64;
/// Render-cache byte cap (RGBA payloads).
pub const MAX_CACHE_BYTES: usize = 256 * 1024 * 1024; // 256 MiB
/// Maximum accepted JSON-lines frame size, in bytes. Sized below the
/// folio-render precedent: large renders should use the library API or
/// chunked `renderRange` calls; the JSON-lines service is for tests and
/// small/non-Rust consumers.
pub const MAX_FRAME_BYTES: usize = 256 * 1024 * 1024; // 256 MiB
/// Default `mixAudio` output sample rate.
pub const DEFAULT_MIX_SAMPLE_RATE: u32 = 48_000;

fn invalid(msg: impl Into<String>) -> EngineError {
    EngineError::invalid(msg)
}

fn out_of_bounds(msg: impl Into<String>) -> EngineError {
    EngineError::out_of_bounds(msg)
}

/// Honest decode-failure propagation: the plan references media the
/// caller did not supply (or supplied empty). Matches the decision
/// record's per-frame `decode-failed` contract.
fn decode_failed(msg: impl Into<String>) -> EngineError {
    EngineError::new(ErrorCode::NotFound, format!("decode-failed: {}", msg.into()))
}

fn finite(v: f64) -> bool {
    v.is_finite()
}

// ---- Plan model ---------------------------------------------------------
//
// Mirrors the splice engine's `renderPlan` output exactly:
// `{tracks: [[clip refs]], transitions: [[per track]]}` where clip refs
// carry `clip_id, track_id, track_kind, track_active, source_id,
// timeline_start_s, timeline_end_s, in_s, out_s, speed, speed_keys,
// gain_db, pan` and transitions carry `kind, left_clip_id,
// right_clip_id, cut_s, start_s, end_s, duration_s`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrackKind {
    Video,
    Audio,
    Overlay,
}

impl TrackKind {
    fn parse(s: &str) -> Result<Self, EngineError> {
        match s {
            "video" => Ok(Self::Video),
            "audio" => Ok(Self::Audio),
            "overlay" => Ok(Self::Overlay),
            other => Err(invalid(format!("unknown track_kind '{other}'"))),
        }
    }
    fn is_visual(self) -> bool {
        matches!(self, Self::Video | Self::Overlay)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransKind {
    CrossDissolve,
    DipToBlack,
    DipToWhite,
    WipeLeft,
    WipeRight,
    PushLeft,
    PushRight,
    CrossFade,
}

impl TransKind {
    fn parse(s: &str) -> Result<Self, EngineError> {
        match s {
            "cross_dissolve" => Ok(Self::CrossDissolve),
            "dip_to_black" => Ok(Self::DipToBlack),
            "dip_to_white" => Ok(Self::DipToWhite),
            "wipe_left" => Ok(Self::WipeLeft),
            "wipe_right" => Ok(Self::WipeRight),
            "push_left" => Ok(Self::PushLeft),
            "push_right" => Ok(Self::PushRight),
            "cross_fade" => Ok(Self::CrossFade),
            other => Err(invalid(format!("unknown transition kind '{other}'"))),
        }
    }
    fn is_visual(self) -> bool {
        !matches!(self, Self::CrossFade)
    }
}

#[derive(Debug, Clone, Copy)]
struct SpeedKey {
    t: f64, // media seconds (source-relative, the in_s/out_s domain)
    speed: f64,
}

#[derive(Debug, Clone)]
struct Clip {
    id: u64,
    source: u64,
    active: bool,
    start: f64, // timeline_start_s
    end: f64,   // timeline_end_s
    in_s: f64,
    out_s: f64,
    speed: f64,
    keys: Vec<SpeedKey>,
    gain_db: f64,
    pan: f64,
}

#[derive(Debug, Clone, Copy)]
struct Transition {
    kind: TransKind,
    left: u64,
    right: u64,
    start: f64,
    end: f64,
    duration: f64,
}

impl Transition {
    fn progress(&self, t: f64) -> f64 {
        if self.duration <= 0.0 {
            return 1.0;
        }
        ((t - self.start) / self.duration).clamp(0.0, 1.0)
    }
}

#[derive(Debug)]
struct Track {
    kind: Option<TrackKind>, // from clip refs; None for empty tracks
    clips: Vec<Clip>,
    transitions: Vec<Transition>,
}

#[derive(Debug)]
struct Plan {
    tracks: Vec<Track>,
}

fn req_f64(v: &Value, key: &str) -> Result<f64, EngineError> {
    v.get(key)
        .and_then(Value::as_f64)
        .filter(|x| finite(*x))
        .ok_or_else(|| invalid(format!("plan field '{key}' must be a finite number")))
}

fn req_u64(v: &Value, key: &str) -> Result<u64, EngineError> {
    v.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid(format!("plan field '{key}' must be a non-negative integer")))
}

fn req_bool(v: &Value, key: &str) -> Result<bool, EngineError> {
    v.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid(format!("plan field '{key}' must be a boolean")))
}

fn check_time(v: f64, what: &str) -> Result<f64, EngineError> {
    if !finite(v) || v < 0.0 || v > 1e8 {
        return Err(out_of_bounds(format!("{what} {v} outside 0..=1e8")));
    }
    Ok(v)
}

fn parse_plan(plan: &Value) -> Result<Plan, EngineError> {
    let tracks_v = plan
        .get("tracks")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("plan requires a 'tracks' array"))?;
    if tracks_v.len() > MAX_PLAN_TRACKS {
        return Err(out_of_bounds(format!(
            "plan has {} tracks; limit is {MAX_PLAN_TRACKS}",
            tracks_v.len()
        )));
    }
    let trans_v = plan
        .get("transitions")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("plan requires a 'transitions' array"))?;
    if trans_v.len() != tracks_v.len() {
        return Err(invalid("plan 'transitions' must parallel 'tracks'"));
    }

    let mut total_clips = 0usize;
    let mut total_trans = 0usize;
    let mut tracks = Vec::with_capacity(tracks_v.len());
    for (ti, tv) in tracks_v.iter().enumerate() {
        let clips_v = tv
            .as_array()
            .ok_or_else(|| invalid(format!("plan track {ti} must be an array of clip refs")))?;
        total_clips += clips_v.len();
        if total_clips > MAX_PLAN_CLIPS {
            return Err(out_of_bounds(format!(
                "plan exceeds {MAX_PLAN_CLIPS} clips"
            )));
        }
        let mut kind: Option<TrackKind> = None;
        let mut clips = Vec::with_capacity(clips_v.len());
        for cv in clips_v {
            let ck = TrackKind::parse(
                cv.get("track_kind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("clip ref requires track_kind"))?,
            )?;
            if let Some(k) = kind {
                if k != ck {
                    return Err(invalid(format!(
                        "plan track {ti} mixes track kinds {k:?} and {ck:?}"
                    )));
                }
            } else {
                kind = Some(ck);
            }
            let speed = req_f64(cv, "speed")?;
            if !(0.1..=10.0).contains(&speed) {
                return Err(out_of_bounds(format!("clip speed {speed} outside 0.1..=10")));
            }
            let start = check_time(req_f64(cv, "timeline_start_s")?, "timeline_start_s")?;
            let end = check_time(req_f64(cv, "timeline_end_s")?, "timeline_end_s")?;
            if end <= start {
                return Err(validation_msg(format!(
                    "clip {} has empty timeline footprint",
                    req_u64(cv, "clip_id")?
                )));
            }
            let in_s = check_time(req_f64(cv, "in_s")?, "in_s")?;
            let out_s = check_time(req_f64(cv, "out_s")?, "out_s")?;
            if out_s <= in_s {
                return Err(validation_msg("clip has out_s <= in_s"));
            }
            let gain_db = cv.get("gain_db").and_then(Value::as_f64).unwrap_or(0.0);
            let pan = cv.get("pan").and_then(Value::as_f64).unwrap_or(0.0);
            if !finite(gain_db) || !(-60.0..=12.0).contains(&gain_db) {
                return Err(out_of_bounds(format!("gain_db {gain_db} outside -60..=12")));
            }
            if !finite(pan) || !(-1.0..=1.0).contains(&pan) {
                return Err(out_of_bounds(format!("pan {pan} outside -1..=1")));
            }
            let mut keys = Vec::new();
            if let Some(kv) = cv.get("speed_keys") {
                let arr = kv
                    .as_array()
                    .ok_or_else(|| invalid("speed_keys must be an array"))?;
                if arr.len() > MAX_SPEED_KEYS {
                    return Err(out_of_bounds(format!(
                        "speed_keys exceeds {MAX_SPEED_KEYS} entries"
                    )));
                }
                for k in arr {
                    let t = req_f64(k, "t_s")?;
                    let s = req_f64(k, "speed")?;
                    check_time(t, "speed key t_s")?;
                    if !(0.1..=10.0).contains(&s) {
                        return Err(out_of_bounds(format!(
                            "speed key speed {s} outside 0.1..=10"
                        )));
                    }
                    keys.push(SpeedKey { t, speed: s });
                }
                // Engine stores keys sorted by t_s; a hostile plan with
                // duplicates or disorder is rejected fail-closed.
                for w in keys.windows(2) {
                    if w[1].t <= w[0].t {
                        return Err(validation_msg("speed_keys must be strictly increasing in t_s"));
                    }
                }
            }
            clips.push(Clip {
                id: req_u64(cv, "clip_id")?,
                source: req_u64(cv, "source_id")?,
                active: req_bool(cv, "track_active")?,
                start,
                end,
                in_s,
                out_s,
                speed,
                keys,
                gain_db,
                pan,
            });
        }
        // Transitions for this track.
        let tarr = trans_v[ti]
            .as_array()
            .ok_or_else(|| invalid(format!("plan transitions[{ti}] must be an array")))?;
        total_trans += tarr.len();
        if total_trans > MAX_PLAN_TRANSITIONS {
            return Err(out_of_bounds(format!(
                "plan exceeds {MAX_PLAN_TRANSITIONS} transitions"
            )));
        }
        let mut transitions = Vec::with_capacity(tarr.len());
        for tv2 in tarr {
            let tkind = TransKind::parse(
                tv2.get("kind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("transition requires kind"))?,
            )?;
            // Kind must match the owning track's media class: visual
            // kinds on video/overlay, cross_fade on audio. The track
            // kind comes from its clip refs (`kind`); a transition on a
            // track with no clips is meaningless and rejected.
            let Some(tk) = kind else {
                return Err(invalid("transition on a track with no clips"));
            };
            let ok = match tk {
                TrackKind::Audio => tkind == TransKind::CrossFade,
                _ => tkind.is_visual(),
            };
            if !ok {
                return Err(invalid(format!(
                    "transition kind '{}' is not valid on a {tk:?} track",
                    trans_kind_str(tkind)
                )));
            }
            let start = check_time(req_f64(tv2, "start_s")?, "transition start_s")?;
            let end = check_time(req_f64(tv2, "end_s")?, "transition end_s")?;
            let dur = req_f64(tv2, "duration_s")?;
            if !finite(dur) || dur <= 0.0 {
                return Err(out_of_bounds("transition duration_s must be positive"));
            }
            if end <= start {
                return Err(validation_msg("transition has end_s <= start_s"));
            }
            transitions.push(Transition {
                kind: tkind,
                left: req_u64(tv2, "left_clip_id")?,
                right: req_u64(tv2, "right_clip_id")?,
                start,
                end,
                duration: dur,
            });
        }
        tracks.push(Track {
            kind,
            clips,
            transitions,
        });
    }
    Ok(Plan { tracks })
}

fn validation_msg(msg: impl Into<String>) -> EngineError {
    EngineError::validation(msg)
}

fn trans_kind_str(k: TransKind) -> &'static str {
    match k {
        TransKind::CrossDissolve => "cross_dissolve",
        TransKind::DipToBlack => "dip_to_black",
        TransKind::DipToWhite => "dip_to_white",
        TransKind::WipeLeft => "wipe_left",
        TransKind::WipeRight => "wipe_right",
        TransKind::PushLeft => "push_left",
        TransKind::PushRight => "push_right",
        TransKind::CrossFade => "cross_fade",
    }
}

// ---- Retime: invert the media-time integral ----------------------------
//
// `speed_keys` are media-anchored `{t_s, speed}` samples: `speed` is
// media seconds consumed per timeline second at media time `t_s`.
// Timeline position of media time m is `E(m) = ∫_{in_s}^{m} du / speed(u)`.
// `SpeedMap` precomputes the piecewise-linear-speed segments over
// `[in_s, out_s]` and inverts E analytically (ln for linear speed, exact
// constant-speed shortcut). Outside the keyed range the end key's value
// holds, matching the engine. Beyond the clip's media window (transition
// handles) the boundary speed holds, so heads/tails extrapolate.

#[derive(Debug, Clone, Copy)]
struct Seg {
    u0: f64,
    u1: f64,
    s0: f64,
    s1: f64,
    e0: f64,  // timeline seconds elapsed at u0 (from clip in_s)
    elen: f64, // timeline seconds this segment spans
}

#[derive(Debug)]
struct SpeedMap {
    lo: f64,
    hi: f64,
    constant: Option<f64>, // Some(speed) for constant-speed clips
    speed_fn: Vec<SpeedKey>, // keyed clips only
    segs: Vec<Seg>,
}

impl SpeedMap {
    fn build(clip: &Clip) -> Self {
        if clip.keys.is_empty() {
            return Self {
                lo: clip.in_s,
                hi: clip.out_s,
                constant: Some(clip.speed),
                speed_fn: Vec::new(),
                segs: Vec::new(),
            };
        }
        let lo = clip.in_s;
        let hi = clip.out_s;
        // Breakpoints: clip bounds plus every key strictly inside.
        let mut pts = vec![lo, hi];
        for k in &clip.keys {
            if k.t > lo && k.t < hi {
                pts.push(k.t);
            }
        }
        pts.sort_by(|a, b| a.total_cmp(b));
        pts.dedup();
        let eval = |u: f64| -> f64 {
            let keys = &clip.keys;
            if u <= keys[0].t {
                return keys[0].speed;
            }
            if u >= keys[keys.len() - 1].t {
                return keys[keys.len() - 1].speed;
            }
            // Linear interpolation between neighbouring keys.
            let mut i = 0;
            while i + 1 < keys.len() && keys[i + 1].t < u {
                i += 1;
            }
            let a = keys[i];
            let b = keys[i + 1];
            if b.t <= a.t {
                return b.speed;
            }
            let f = (u - a.t) / (b.t - a.t);
            a.speed + (b.speed - a.speed) * f
        };
        let mut segs = Vec::with_capacity(pts.len().saturating_sub(1));
        let mut e0 = 0.0f64;
        for w in pts.windows(2) {
            let (u0, u1) = (w[0], w[1]);
            if u1 <= u0 {
                continue;
            }
            let s0 = eval(u0);
            let s1 = eval(u1);
            let k = (s1 - s0) / (u1 - u0);
            let elen = if k.abs() < 1e-12 {
                (u1 - u0) / s0
            } else {
                ((s1 / s0).ln()) / k
            };
            segs.push(Seg {
                u0,
                u1,
                s0,
                s1,
                e0,
                elen,
            });
            e0 += elen;
        }
        Self {
            lo,
            hi,
            constant: None,
            speed_fn: clip.keys.clone(),
            segs,
        }
    }

    fn total_timeline(&self) -> f64 {
        if let Some(s) = self.constant {
            return (self.hi - self.lo) / s;
        }
        self.segs.last().map(|s| s.e0 + s.elen).unwrap_or(0.0)
    }

    /// Boundary speed at media time u (holds end keys outside range).
    fn speed_at(&self, u: f64) -> f64 {
        if let Some(s) = self.constant {
            return s;
        }
        let keys = &self.speed_fn;
        if u <= keys[0].t {
            return keys[0].speed;
        }
        if u >= keys[keys.len() - 1].t {
            return keys[keys.len() - 1].speed;
        }
        let mut i = 0;
        while i + 1 < keys.len() && keys[i + 1].t < u {
            i += 1;
        }
        let a = keys[i];
        let b = keys[i + 1];
        if b.t <= a.t {
            return b.speed;
        }
        a.speed + (b.speed - a.speed) * ((u - a.t) / (b.t - a.t))
    }

    /// Media time (source seconds) at `dt` timeline seconds past the
    /// clip's timeline start. Extrapolates with the boundary speed
    /// outside `[0, total]` so transition head/tail handles resolve.
    fn media_time(&self, dt: f64) -> f64 {
        if let Some(s) = self.constant {
            return self.lo + dt * s;
        }
        let total = self.total_timeline();
        if self.segs.is_empty() {
            return self.hi;
        }
        if dt <= 0.0 {
            return self.lo + dt * self.speed_at(self.lo);
        }
        if dt >= total {
            return self.hi + (dt - total) * self.speed_at(self.hi);
        }
        // Find the segment containing dt (linear walk; ≤256 segs).
        for (si, seg) in self.segs.iter().enumerate() {
            let is_last = si + 1 == self.segs.len();
            if dt < seg.e0 + seg.elen || is_last {
                let rem = dt - seg.e0;
                let du = seg.u1 - seg.u0;
                let k = (seg.s1 - seg.s0) / du;
                let m = if k.abs() < 1e-12 {
                    seg.u0 + rem * seg.s0
                } else {
                    // s(m) = s0 * exp(k * rem); m = u0 + (s(m)-s0)/k
                    let sm = seg.s0 * (k * rem).exp();
                    seg.u0 + (sm - seg.s0) / k
                };
                return m.clamp(seg.u0, seg.u1);
            }
        }
        self.hi
    }
}

/// Monotonic cursor version of `media_time` for the audio mixer, which
/// walks samples in order. `idx` only advances.
struct SpeedCursor<'a> {
    map: &'a SpeedMap,
    idx: usize,
}

impl<'a> SpeedCursor<'a> {
    fn new(map: &'a SpeedMap) -> Self {
        Self { map, idx: 0 }
    }

    fn media_time(&mut self, dt: f64) -> f64 {
        if self.map.constant.is_some() {
            return self.map.media_time(dt);
        }
        let total = self.map.total_timeline();
        if dt <= 0.0 {
            return self.map.lo + dt * self.map.speed_at(self.map.lo);
        }
        if dt >= total {
            return self.map.hi + (dt - total) * self.map.speed_at(self.map.hi);
        }
        if self.map.segs.is_empty() {
            return self.map.hi;
        }
        while self.idx + 1 < self.map.segs.len()
            && dt >= self.map.segs[self.idx].e0 + self.map.segs[self.idx].elen
        {
            self.idx += 1;
        }
        let seg = self.map.segs[self.idx];
        let rem = dt - seg.e0;
        let du = seg.u1 - seg.u0;
        let k = (seg.s1 - seg.s0) / du;
        let m = if k.abs() < 1e-12 {
            seg.u0 + rem * seg.s0
        } else {
            let sm = seg.s0 * (k * rem).exp();
            seg.u0 + (sm - seg.s0) / k
        };
        m.clamp(seg.u0, seg.u1)
    }
}

// ---- Decoded media inputs ----------------------------------------------

struct VFrame {
    t: f64,          // media seconds this still represents
    px: Vec<u8>,     // RGBA8, len == w*h*4
}

struct VSource {
    w: u32,
    h: u32,
    frames: Vec<VFrame>, // sorted by t (stable)
}

struct ASource {
    rate: u32,
    channels: u32, // 1 or 2
    media_start: f64,
    media_end: f64,
    samples: Vec<f32>, // interleaved, len == span_frames*channels
}

fn parse_u64_key(key: &str) -> Result<u64, EngineError> {
    key.parse::<u64>()
        .map_err(|_| invalid(format!("source key '{key}' is not a u64 id")))
}

/// Parse the `sources` object of a video payload:
/// `{ "<id>": {width,height,frames:[{t_s,bytes_b64}]} }`.
fn parse_video_sources(v: Option<&Value>) -> Result<HashMap<u64, VSource>, EngineError> {
    let mut out = HashMap::new();
    let Some(obj) = v else { return Ok(out) };
    let map = obj
        .as_object()
        .ok_or_else(|| invalid("sources must be an object keyed by source_id"))?;
    if map.len() > MAX_SOURCES {
        return Err(out_of_bounds(format!(
            "{} video sources; limit is {MAX_SOURCES}",
            map.len()
        )));
    }
    let mut total_bytes = 0usize;
    for (key, sv) in map {
        let id = parse_u64_key(key)?;
        let w = sv
            .get("width")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid(format!("source {id} requires width")))? as u32;
        let h = sv
            .get("height")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid(format!("source {id} requires height")))? as u32;
        if w == 0 || h == 0 || w > MAX_SOURCE_DIM || h > MAX_SOURCE_DIM {
            return Err(out_of_bounds(format!(
                "source {id} dimensions {w}x{h} outside 1..={MAX_SOURCE_DIM}"
            )));
        }
        let frame_len = w as usize * h as usize * 4;
        if frame_len > MAX_SOURCE_FRAME_BYTES {
            return Err(out_of_bounds(format!(
                "source {id} frame is {frame_len} bytes; limit is {MAX_SOURCE_FRAME_BYTES}"
            )));
        }
        let frames_v = sv
            .get("frames")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid(format!("source {id} requires a frames array")))?;
        if frames_v.len() > MAX_FRAMES_PER_SOURCE {
            return Err(out_of_bounds(format!(
                "source {id} has {} frames; limit is {MAX_FRAMES_PER_SOURCE}",
                frames_v.len()
            )));
        }
        total_bytes += frames_v.len() * frame_len;
        if total_bytes > MAX_SOURCE_TOTAL_BYTES {
            return Err(out_of_bounds(format!(
                "decoded video sources exceed {MAX_SOURCE_TOTAL_BYTES} bytes"
            )));
        }
        let mut frames = Vec::with_capacity(frames_v.len());
        for fv in frames_v {
            let t = fv
                .get("t_s")
                .and_then(Value::as_f64)
                .filter(|x| finite(*x) && *x >= 0.0)
                .ok_or_else(|| invalid(format!("source {id} frame requires t_s >= 0")))?;
            let b64 = fv
                .get("bytes_b64")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("source {id} frame requires bytes_b64")))?;
            let px = base64_decode(b64)?;
            if px.len() != frame_len {
                return Err(invalid(format!(
                    "source {id} frame at t={t} is {} bytes; expected {frame_len} (RGBA8 {w}x{h})",
                    px.len()
                )));
            }
            frames.push(VFrame { t, px });
        }
        // Stable sort by media time; equal timestamps keep input order.
        frames.sort_by(|a, b| a.t.total_cmp(&b.t));
        out.insert(id, VSource { w, h, frames });
    }
    Ok(out)
}

/// Parse the `sources` object of an audio payload:
/// `{ "<id>": {sample_rate,channels,media_start_s,media_end_s,pcm_b64} }`
/// where `pcm_b64` is little-endian interleaved f32 covering
/// `[media_start_s, media_end_s)` at `sample_rate`.
fn parse_audio_sources(v: Option<&Value>) -> Result<HashMap<u64, ASource>, EngineError> {
    let mut out = HashMap::new();
    let Some(obj) = v else { return Ok(out) };
    let map = obj
        .as_object()
        .ok_or_else(|| invalid("sources must be an object keyed by source_id"))?;
    if map.len() > MAX_SOURCES {
        return Err(out_of_bounds(format!(
            "{} audio sources; limit is {MAX_SOURCES}",
            map.len()
        )));
    }
    let mut total_bytes = 0usize;
    for (key, sv) in map {
        let id = parse_u64_key(key)?;
        let rate = sv
            .get("sample_rate")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid(format!("audio source {id} requires sample_rate")))? as u32;
        if !(MIN_SOURCE_SAMPLE_RATE..=MAX_SOURCE_SAMPLE_RATE).contains(&rate) {
            return Err(out_of_bounds(format!(
                "audio source {id} sample_rate {rate} outside {MIN_SOURCE_SAMPLE_RATE}..={MAX_SOURCE_SAMPLE_RATE}"
            )));
        }
        let channels = sv
            .get("channels")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid(format!("audio source {id} requires channels")))? as u32;
        if channels != 1 && channels != 2 {
            return Err(invalid(format!(
                "audio source {id} channels must be 1 or 2"
            )));
        }
        let media_start = sv
            .get("media_start_s")
            .and_then(Value::as_f64)
            .filter(|x| finite(*x) && *x >= 0.0)
            .ok_or_else(|| invalid(format!("audio source {id} requires media_start_s >= 0")))?;
        let media_end = sv
            .get("media_end_s")
            .and_then(Value::as_f64)
            .filter(|x| finite(*x) && *x > media_start)
            .ok_or_else(|| invalid(format!("audio source {id} requires media_end_s > media_start_s")))?;
        let span = media_end - media_start;
        if span > 3600.0 {
            return Err(out_of_bounds(format!(
                "audio source {id} span {span}s exceeds 3600s"
            )));
        }
        let expected_frames = (span * rate as f64).round() as usize;
        let expected_bytes = expected_frames
            .checked_mul(channels as usize)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| out_of_bounds(format!("audio source {id} size overflow")))?;
        if expected_bytes > MAX_PCM_SOURCE_BYTES {
            return Err(out_of_bounds(format!(
                "audio source {id} PCM is {expected_bytes} bytes; limit is {MAX_PCM_SOURCE_BYTES}"
            )));
        }
        total_bytes += expected_bytes;
        if total_bytes > MAX_PCM_TOTAL_BYTES {
            return Err(out_of_bounds(format!(
                "decoded audio sources exceed {MAX_PCM_TOTAL_BYTES} bytes"
            )));
        }
        let b64 = sv
            .get("pcm_b64")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid(format!("audio source {id} requires pcm_b64")))?;
        let bytes = base64_decode(b64)?;
        if bytes.len() != expected_bytes {
            return Err(invalid(format!(
                "audio source {id} PCM is {} bytes; expected {expected_bytes} ({} frames x {channels}ch f32)",
                bytes.len(),
                expected_frames
            )));
        }
        if bytes.len() % 4 != 0 {
            return Err(invalid(format!("audio source {id} PCM not f32-aligned")));
        }
        let mut samples = Vec::with_capacity(bytes.len() / 4);
        for c in bytes.chunks_exact(4) {
            samples.push(f32::from_le_bytes([c[0], c[1], c[2], c[3]]));
        }
        out.insert(
            id,
            ASource {
                rate,
                channels,
                media_start,
                media_end,
                samples,
            },
        );
    }
    Ok(out)
}

// ---- Video compositing ---------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fit {
    Fit,  // letterbox: whole frame visible, bars transparent
    Fill, // cover: frame fills canvas, overflow cropped
}

impl Fit {
    fn parse(s: Option<&str>) -> Result<Self, EngineError> {
        match s {
            None | Some("fit") => Ok(Self::Fit),
            Some("fill") => Ok(Self::Fill),
            Some(other) => Err(invalid(format!("unknown fit '{other}' (expected fit|fill)"))),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct RectF {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
}

/// Fit a `sw`x`sh` source into the `cw`x`ch` canvas. Returns the dest
/// rect in canvas pixel coordinates (may extend past edges for `fill`).
fn fit_rect(sw: u32, sh: u32, cw: u32, ch: u32, fit: Fit, dx: f32, dy: f32) -> RectF {
    let (sw, sh, cw, ch) = (sw as f32, sh as f32, cw as f32, ch as f32);
    let scale = match fit {
        Fit::Fit => (cw / sw).min(ch / sh),
        Fit::Fill => (cw / sw).max(ch / sh),
    };
    let w = sw * scale;
    let h = sh * scale;
    RectF {
        x0: (cw - w) * 0.5 + dx,
        y0: (ch - h) * 0.5 + dy,
        x1: (cw - w) * 0.5 + dx + w,
        y1: (ch - h) * 0.5 + dy + h,
    }
}

/// Bilinear sample of an RGBA8 frame at fractional pixel coords
/// `(u, v)` already in `[0, dim-1]` space. Edge-replicating.
fn sample_bilinear(px: &[u8], w: usize, h: usize, u: f32, v: f32) -> [f32; 4] {
    let (w, h) = (w as f32, h as f32);
    let u = u.clamp(0.0, (w - 1.0).max(0.0));
    let v = v.clamp(0.0, (h - 1.0).max(0.0));
    let x0 = u.floor() as usize;
    let y0 = v.floor() as usize;
    let x1 = (x0 + 1).min(w as usize - 1);
    let y1 = (y0 + 1).min(h as usize - 1);
    let fx = u - x0 as f32;
    let fy = v - y0 as f32;
    let mut out = [0.0f32; 4];
    // Deterministic fixed-order accumulation: top row then bottom row,
    // left then right, channel 0..4.
    let idx = |x: usize, y: usize| (y * w as usize + x) * 4;
    let w00 = (1.0 - fx) * (1.0 - fy);
    let w10 = fx * (1.0 - fy);
    let w01 = (1.0 - fx) * fy;
    let w11 = fx * fy;
    let p00 = &px[idx(x0, y0)..idx(x0, y0) + 4];
    let p10 = &px[idx(x1, y0)..idx(x1, y0) + 4];
    let p01 = &px[idx(x0, y1)..idx(x0, y1) + 4];
    let p11 = &px[idx(x1, y1)..idx(x1, y1) + 4];
    for c in 0..4 {
        out[c] = (p00[c] as f32 * w00
            + p10[c] as f32 * w10
            + p01[c] as f32 * w01
            + p11[c] as f32 * w11)
            / 255.0;
    }
    out
}

/// Source-over composite of straight-alpha RGBA8. `dst` is the canvas.
/// `sa` is the source alpha already multiplied by coverage `mult`.
#[inline]
fn over_pixel(dst: &mut [u8], doff: usize, s: [f32; 4], sa: f32) {
    if sa <= 0.0 {
        return;
    }
    let da = dst[doff + 3] as f32 / 255.0;
    let out_a = sa + da * (1.0 - sa);
    if out_a <= 0.0 {
        dst[doff..doff + 4].copy_from_slice(&[0, 0, 0, 0]);
        return;
    }
    let k = da * (1.0 - sa) / out_a;
    let ks = sa / out_a;
    for c in 0..3 {
        let v = s[c] * ks + (dst[doff + c] as f32 / 255.0) * k;
        dst[doff + c] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    }
    dst[doff + 3] = (out_a.clamp(0.0, 1.0) * 255.0).round() as u8;
}

/// Composite one decoded source frame into the canvas.
///
/// `rect` is the fitted dest rect (already including any transition
/// offset). `mult` is a global alpha multiplier (transition coverage).
/// `mask`, when present, returns a per-dest-pixel multiplier in
/// `[0,1]` (wipe hard edge).
#[allow(clippy::too_many_arguments)]
fn blit(
    dst: &mut [u8],
    cw: u32,
    ch: u32,
    src: &VSource,
    frame: &VFrame,
    rect: RectF,
    mult: f32,
    mask: Option<&dyn Fn(u32, u32) -> f32>,
) {
    if mult <= 0.0 || rect.x1 <= rect.x0 || rect.y1 <= rect.y0 {
        return;
    }
    let (sw, sh) = (src.w as usize, src.h as usize);
    let sx = (rect.x1 - rect.x0) / sw as f32; // dest px per src px
    let sy = (rect.y1 - rect.y0) / sh as f32;
    let px0 = rect.x0.floor().max(0.0) as u32;
    let py0 = rect.y0.floor().max(0.0) as u32;
    let px1 = (rect.x1.ceil() as u32).min(cw);
    let py1 = (rect.y1.ceil() as u32).min(ch);
    if px0 >= px1 || py0 >= py1 {
        return;
    }
    for py in py0..py1 {
        for px in px0..px1 {
            let m = match mask {
                Some(f) => f(px, py),
                None => 1.0,
            };
            if m <= 0.0 {
                continue;
            }
            let cx = px as f32 + 0.5;
            let cy = py as f32 + 0.5;
            let u = (cx - rect.x0) / sx;
            let v = (cy - rect.y0) / sy;
            // Edge-replication is handled by sample_bilinear's clamp;
            // dest pixels outside the rect never reach this point.
            let s = sample_bilinear(&frame.px, sw, sh, u, v);
            let sa = (s[3] * mult * m).clamp(0.0, 1.0);
            let off = ((py * cw + px) * 4) as usize;
            over_pixel(dst, off, s, sa);
        }
    }
}

fn clip_map(clip: &Clip) -> SpeedMap {
    SpeedMap::build(clip)
}

/// Nearest-frame selection: the supplied still whose `t_s` is closest
/// to media time `m`. Ties resolve to the earlier frame (stable,
/// deterministic).
fn nearest_frame<'a>(src: &'a VSource, m: f64) -> Result<&'a VFrame, EngineError> {
    if src.frames.is_empty() {
        return Err(decode_failed("source has zero decoded frames"));
    }
    // Candidates around the insertion point of m in the sorted frames.
    let idx = src.frames.partition_point(|f| f.t < m);
    let mut best_i = idx.min(src.frames.len() - 1);
    let best_d = (src.frames[best_i].t - m).abs();
    if idx > 0 {
        let d = (src.frames[idx - 1].t - m).abs();
        // `<=` makes exact ties resolve to the earlier frame.
        if d <= best_d {
            best_i = idx - 1;
        }
    }
    Ok(&src.frames[best_i])
}

/// Draw one clip at program time `t`. `dx`/`dy` shift the fitted dest
/// rect in canvas pixels (push transitions); `mult` is a global alpha
/// multiplier (transition coverage); `mask`, when present, returns a
/// per-dest-pixel multiplier in `[0,1]` (wipe hard edge).
#[allow(clippy::too_many_arguments)]
fn draw_clip(
    canvas: &mut [u8],
    cw: u32,
    ch: u32,
    sources: &HashMap<u64, VSource>,
    clip: &Clip,
    t: f64,
    fit: Fit,
    dx: f32,
    dy: f32,
    mult: f32,
    mask: Option<&dyn Fn(u32, u32) -> f32>,
) -> Result<(), EngineError> {
    let src = sources.get(&clip.source).ok_or_else(|| {
        decode_failed(format!("no decoded frames supplied for source {}", clip.source))
    })?;
    if src.frames.is_empty() {
        return Err(decode_failed(format!(
            "source {} has zero decoded frames",
            clip.source
        )));
    }
    let map = clip_map(clip);
    let dt = t - clip.start;
    let m = map.media_time(dt);
    let frame = nearest_frame(src, m)?;
    let rect = fit_rect(src.w, src.h, cw, ch, fit, dx, dy);
    blit(canvas, cw, ch, src, frame, rect, mult, mask);
    Ok(())
}

/// Composite one program frame at timeline `t`.
fn composite(
    plan: &Plan,
    sources: &HashMap<u64, VSource>,
    cw: u32,
    ch: u32,
    t: f64,
    fit: Fit,
) -> Result<Vec<u8>, EngineError> {
    let mut canvas = vec![0u8; cw as usize * ch as usize * 4];
    let mut dip: Option<(f32, [f32; 4])> = None; // (q, color rgba 0..1)

    for trk in &plan.tracks {
        if !trk.kind.map(TrackKind::is_visual).unwrap_or(false) {
            continue;
        }
        // track_active is resolved per clip by the engine (hidden →
        // false); an inactive track contributes nothing, including its
        // transition pair.
        if !trk.clips.iter().any(|c| c.active) {
            continue;
        }
        // Active transition on this track, if any.
        let tr = trk.transitions.iter().find(|x| t >= x.start && t < x.end);
        // Locate the pair clips.
        let (left_clip, right_clip) = match tr {
            Some(tn) => (
                trk.clips.iter().find(|c| c.id == tn.left),
                trk.clips.iter().find(|c| c.id == tn.right),
            ),
            None => (None, None),
        };

        // Draw helper closure state: non-pair active clips first.
        for c in &trk.clips {
            if !c.active {
                continue;
            }
            let in_pair = tr.is_some()
                && (Some(c.id) == tr.map(|x| x.left) || Some(c.id) == tr.map(|x| x.right));
            if in_pair {
                continue;
            }
            if t < c.start || t >= c.end {
                continue;
            }
            draw_clip(&mut canvas, cw, ch, sources, c, t, fit, 0.0, 0.0, 1.0, None)?;
        }

        if let Some(tn) = tr {
            let p = tn.progress(t) as f32;
            let Some(lc) = left_clip else {
                return Err(decode_failed(format!(
                    "transition references missing left clip {}",
                    tn.left
                )));
            };
            let Some(rc) = right_clip else {
                return Err(decode_failed(format!(
                    "transition references missing right clip {}",
                    tn.right
                )));
            };
            if !lc.active || !rc.active {
                return Err(decode_failed(format!(
                    "transition {} pair clip is inactive",
                    tn.left
                )));
            }
            match tn.kind {
                TransKind::CrossDissolve => {
                    // Outgoing at full strength; incoming alpha ramps
                    // 0→1. For opaque sources this is exactly the
                    // symmetric cross-fade (p·R + (1-p)·L).
                    draw_clip(&mut canvas, cw, ch, sources, lc, t, fit, 0.0, 0.0, 1.0, None)?;
                    draw_clip(&mut canvas, cw, ch, sources, rc, t, fit, 0.0, 0.0, p, None)?;
                }
                TransKind::DipToBlack | TransKind::DipToWhite => {
                    draw_clip(&mut canvas, cw, ch, sources, lc, t, fit, 0.0, 0.0, 1.0, None)?;
                    draw_clip(&mut canvas, cw, ch, sources, rc, t, fit, 0.0, 0.0, p, None)?;
                    // Dip the whole composited frame toward the color at
                    // q = sin(pi·p): 0 at both ends, 1 at the midpoint.
                    let q = ((std::f64::consts::PI * p as f64).sin()) as f32;
                    let color = if tn.kind == TransKind::DipToBlack {
                        [0.0, 0.0, 0.0, 1.0]
                    } else {
                        [1.0, 1.0, 1.0, 1.0]
                    };
                    if dip.map(|(dq, _)| q > dq).unwrap_or(true) {
                        dip = Some((q, color));
                    }
                }
                TransKind::WipeLeft | TransKind::WipeRight => {
                    draw_clip(&mut canvas, cw, ch, sources, lc, t, fit, 0.0, 0.0, 1.0, None)?;
                    // Hard-edge reveal: incoming visible where the
                    // normalized x position is inside the wipe front.
                    let left_edge = tn.kind == TransKind::WipeLeft;
                    let mask = move |px: u32, _py: u32| -> f32 {
                        let fx = (px as f32 + 0.5) / cw as f32;
                        let inside = if left_edge { fx < p } else { fx > 1.0 - p };
                        if inside { 1.0 } else { 0.0 }
                    };
                    draw_clip(
                        &mut canvas,
                        cw,
                        ch,
                        sources,
                        rc,
                        t,
                        fit,
                        0.0,
                        0.0,
                        1.0,
                        Some(&mask),
                    )?;
                }
                TransKind::PushLeft | TransKind::PushRight => {
                    // Geometric translate: outgoing slides out, incoming
                    // slides in. push_left: left exits toward -x, right
                    // enters from +x.
                    let dir: f32 = if tn.kind == TransKind::PushLeft { -1.0 } else { 1.0 };
                    draw_clip(
                        &mut canvas, cw, ch, sources, lc, t, fit,
                        dir * p * cw as f32, 0.0, 1.0, None,
                    )?;
                    draw_clip(
                        &mut canvas, cw, ch, sources, rc, t, fit,
                        -dir * (1.0 - p) * cw as f32, 0.0, 1.0, None,
                    )?;
                }
                TransKind::CrossFade => {
                    return Err(invalid("cross_fade is an audio-only transition kind"));
                }
            }
        }
    }

    // Dip-to-color post pass over the whole composited frame.
    if let Some((q, color)) = dip {
        if q > 0.0 {
            for px in canvas.chunks_exact_mut(4) {
                let d = [
                    px[0] as f32 / 255.0,
                    px[1] as f32 / 255.0,
                    px[2] as f32 / 255.0,
                    px[3] as f32 / 255.0,
                ];
                // Color-over with alpha q (straight alpha).
                let sa = q;
                let da = d[3];
                let out_a = sa + da * (1.0 - sa);
                if out_a <= 0.0 {
                    px.copy_from_slice(&[0, 0, 0, 0]);
                    continue;
                }
                for c in 0..3 {
                    let v = (color[c] * sa + d[c] * da * (1.0 - sa)) / out_a;
                    px[c] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                }
                px[3] = (out_a.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
    }

    Ok(canvas)
}

// ---- Audio mixing ---------------------------------------------------------
//
// `gain_db` → linear gain `10^(db/20)`; `pan` uses a balance law:
// pan = -1 → left only, +1 → right only, 0 → both unity,
// intermediate → linear taper on the opposite side only
// (left = 1 - max(pan,0), right = 1 + min(pan,0)). `cross_fade`
// transitions apply equal-power sin/cos gain ramps across their
// window. Sources supply PCM already at their own rate; the mixer
// resamples by evaluating the media-time function per output sample
// with linear interpolation (deterministic; DECISION: "resampling at
// ingest" is the host's job for anything fancier).

fn db_to_gain(db: f64) -> f32 {
    (10f64.powf(db / 20.0)) as f32
}

fn pan_gains(pan: f64) -> (f32, f32) {
    let p = pan.clamp(-1.0, 1.0) as f32;
    let left = if p > 0.0 { 1.0 - p } else { 1.0 };
    let right = if p < 0.0 { 1.0 + p } else { 1.0 };
    (left, right)
}

/// Mix the audio tracks of `plan` over `[start_s, start_s+duration_s)`
/// into interleaved stereo f32 at `rate`.
fn mix_audio(
    plan: &Plan,
    sources: &HashMap<u64, ASource>,
    start_s: f64,
    duration_s: f64,
    rate: u32,
) -> Result<Vec<f32>, EngineError> {
    if !(MIN_MIX_SAMPLE_RATE..=MAX_MIX_SAMPLE_RATE).contains(&rate) {
        return Err(out_of_bounds(format!(
            "sample_rate {rate} outside {MIN_MIX_SAMPLE_RATE}..={MAX_MIX_SAMPLE_RATE}"
        )));
    }
    if !finite(duration_s) || duration_s <= 0.0 || duration_s > MAX_MIX_SECONDS {
        return Err(out_of_bounds(format!(
            "duration_s {duration_s} outside 0..={MAX_MIX_SECONDS}"
        )));
    }
    if !finite(start_s) || start_s < 0.0 {
        return Err(out_of_bounds("start_s must be >= 0"));
    }
    let n = (duration_s * rate as f64).round() as usize;
    if n == 0 {
        return Ok(Vec::new());
    }
    if n > (MAX_MIX_SECONDS * MAX_MIX_SAMPLE_RATE as f64) as usize {
        return Err(out_of_bounds("mix length exceeds bounds"));
    }
    let mut acc = vec![0.0f32; n * 2];

    for trk in &plan.tracks {
        if trk.kind != Some(TrackKind::Audio) {
            continue;
        }
        for clip in &trk.clips {
            if !clip.active {
                continue;
            }
            // Effective play range: the clip's own timeline span, extended
            // over any cross_fade window it belongs to — the same head/
            // tail handle extrapolation the video path uses, so both
            // sides of the fade actually overlap.
            let mut eff_start = clip.start;
            let mut eff_end = clip.end;
            for tn in &trk.transitions {
                if tn.kind == TransKind::CrossFade
                    && (tn.left == clip.id || tn.right == clip.id)
                {
                    eff_start = eff_start.min(tn.start);
                    eff_end = eff_end.max(tn.end);
                }
            }
            // Timeline overlap with the requested span.
            let tau0 = eff_start.max(start_s);
            let tau1 = eff_end.min(start_s + duration_s);
            if tau1 <= tau0 {
                continue;
            }
            let src = sources.get(&clip.source).ok_or_else(|| {
                decode_failed(format!("no PCM supplied for audio source {}", clip.source))
            })?;
            let map = clip_map(clip);
            // Coverage: the media range actually consumed — including
            // transition head/tail handles — must be inside the supplied
            // PCM span (fail-closed, honest decode-failed).
            let m_lo = map.media_time(eff_start - clip.start);
            let m_hi = map.media_time(eff_end - clip.start);
            let (need_lo, need_hi) = if m_lo <= m_hi { (m_lo, m_hi) } else { (m_hi, m_lo) };
            if need_lo < src.media_start || need_hi > src.media_end {
                return Err(decode_failed(format!(
                    "audio source {} PCM covers [{}, {}] but clip {} needs [{}, {}]",
                    clip.source, src.media_start, src.media_end, clip.id, need_lo, need_hi
                )));
            }
            let mut cursor = SpeedCursor::new(&map);
            let gain = db_to_gain(clip.gain_db);
            let (gl, gr) = pan_gains(clip.pan);
            let n_src = src.samples.len() / src.channels as usize;
            let rate_f = rate as f64;
            let src_rate_f = src.rate as f64;

            let i0 = (((tau0 - start_s) * rate_f).ceil() as i64).clamp(0, n as i64) as usize;
            let i1 = (((tau1 - start_s) * rate_f).ceil() as i64).clamp(0, n as i64) as usize;
            for i in i0..i1.min(n) {
                let tau = start_s + i as f64 / rate_f;
                let dt = tau - clip.start;
                let m = cursor.media_time(dt);
                // Media time → source sample position.
                let pos = (m - src.media_start) * src_rate_f;
                if !(pos >= -1.0 && pos <= n_src as f64) {
                    continue; // outside supplied PCM: silence (coverage checked above)
                }
                let pos = pos.clamp(0.0, (n_src - 1) as f64);
                let s0 = pos.floor() as usize;
                let s1 = (s0 + 1).min(n_src - 1);
                let frac = (pos - s0 as f64) as f32;
                let ch = src.channels as usize;
                let read = |frame: usize, c: usize| -> f32 { src.samples[frame * ch + c] };
                let l0 = read(s0, 0);
                let l1 = read(s1, 0);
                let l = l0 + (l1 - l0) * frac;
                let r = if ch == 2 {
                    let r0 = read(s0, 1);
                    let r1 = read(s1, 1);
                    r0 + (r1 - r0) * frac
                } else {
                    l // mono upmixes to both channels
                };
                // cross_fade equal-power ramp if a transition covers tau.
                let mut cf = 1.0f32;
                for tn in &trk.transitions {
                    if tn.kind != TransKind::CrossFade || tau < tn.start || tau >= tn.end {
                        continue;
                    }
                    let p = tn.progress(tau) as f32;
                    let half = std::f32::consts::FRAC_PI_2;
                    if clip.id == tn.left {
                        cf *= (p * half).cos();
                    } else if clip.id == tn.right {
                        cf *= (p * half).sin();
                    }
                }
                let g = gain * cf;
                acc[i * 2] += l * g * gl;
                acc[i * 2 + 1] += r * g * gr;
            }
        }
    }
    Ok(acc)
}

// ---- Service --------------------------------------------------------------

struct CacheEntry {
    bytes: Vec<u8>,
}

struct RenderJob {
    plan: Plan,
    sources: HashMap<u64, VSource>,
    width: u32,
    height: u32,
    fps: f64,
    start_s: f64,
    frames: usize,
    next: usize,
    fit: Fit,
    snapshot: Option<String>,
    media: Option<String>,
}

/// The splice-render service: stateless compositor plus a bounded
/// render cache and a bounded set of `renderRange` jobs. Single-threaded
/// by contract — hosts must not share one `RenderService` across threads
/// without external synchronization.
pub struct RenderService {
    cache: HashMap<String, CacheEntry>,
    cache_order: VecDeque<String>,
    cache_bytes: usize,
    jobs: HashMap<u64, RenderJob>,
    next_job: u64,
}

impl RenderService {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            cache_order: VecDeque::new(),
            cache_bytes: 0,
            jobs: HashMap::new(),
            next_job: 1,
        }
    }

    fn cache_key(
        snapshot: Option<&str>,
        media: Option<&str>,
        t: f64,
        w: u32,
        h: u32,
        fit: Fit,
    ) -> String {
        format!(
            "{}|{}|{:016x}|{}x{}|{}|{}",
            snapshot.unwrap_or(""),
            media.unwrap_or(""),
            t.to_bits(),
            w,
            h,
            match fit {
                Fit::Fit => "fit",
                Fit::Fill => "fill",
            },
            PROVIDER_VERSION
        )
    }

    fn cache_get(&self, key: &str) -> Option<Vec<u8>> {
        self.cache.get(key).map(|e| e.bytes.clone())
    }

    #[allow(clippy::too_many_arguments)]
    fn cache_put(
        cache: &mut HashMap<String, CacheEntry>,
        order: &mut VecDeque<String>,
        used: &mut usize,
        key: String,
        bytes: Vec<u8>,
    ) {
        if bytes.len() > MAX_CACHE_BYTES {
            return;
        }
        if cache.contains_key(&key) {
            return;
        }
        // Evict oldest until the new entry fits.
        while *used + bytes.len() > MAX_CACHE_BYTES || cache.len() >= MAX_CACHE_ENTRIES {
            let Some(old) = order.pop_front() else { break };
            if let Some(e) = cache.remove(&old) {
                *used -= e.bytes.len();
            }
        }
        *used += bytes.len();
        cache.insert(key.clone(), CacheEntry { bytes });
        order.push_back(key);
    }

    fn cache_store(&mut self, key: String, bytes: Vec<u8>) {
        Self::cache_put(&mut self.cache, &mut self.cache_order, &mut self.cache_bytes, key, bytes);
    }

    /// Render (or fetch from cache) one RGBA8 frame.
    fn render_one(
        &mut self,
        plan_v: &Value,
        sources_v: Option<&Value>,
        w: u32,
        h: u32,
        t: f64,
        fit: Fit,
        snapshot: Option<&str>,
        media: Option<&str>,
    ) -> Result<(Vec<u8>, bool), EngineError> {
        let key = Self::cache_key(snapshot, media, t, w, h, fit);
        if let Some(hit) = self.cache_get(&key) {
            return Ok((hit, true));
        }
        let plan = parse_plan(plan_v)?;
        let sources = parse_video_sources(sources_v)?;
        let px = composite(&plan, &sources, w, h, t, fit)?;
        self.cache_store(key, px.clone());
        Ok((px, false))
    }

    fn dims(payload: &Value) -> Result<(u32, u32), EngineError> {
        let w = payload
            .get("width")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("requires payload.width"))? as u32;
        let h = payload
            .get("height")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("requires payload.height"))? as u32;
        if w == 0 || h == 0 || w > MAX_OUTPUT_WIDTH || h > MAX_OUTPUT_HEIGHT {
            return Err(out_of_bounds(format!(
                "canvas {w}x{h} outside 1..={MAX_OUTPUT_WIDTH}x{MAX_OUTPUT_HEIGHT}"
            )));
        }
        Ok((w, h))
    }

    fn plan_ref<'a>(payload: &'a Value) -> Result<&'a Value, EngineError> {
        payload
            .get("plan")
            .ok_or_else(|| invalid("requires payload.plan (renderPlan output)"))
    }

    fn opt_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
        payload.get(key).and_then(Value::as_str)
    }

    fn render_frame(&mut self, payload: &Value) -> Result<Value, EngineError> {
        let (w, h) = Self::dims(payload)?;
        let t = payload
            .get("time_s")
            .and_then(Value::as_f64)
            .filter(|x| finite(*x) && *x >= 0.0)
            .ok_or_else(|| invalid("requires payload.time_s >= 0"))?;
        if t > 1e8 {
            return Err(out_of_bounds("time_s exceeds 1e8"));
        }
        let fit = Fit::parse(Self::opt_str(payload, "fit"))?;
        let plan = Self::plan_ref(payload)?;
        let sources = payload.get("sources");
        let (px, cached) = self.render_one(
            plan,
            sources,
            w,
            h,
            t,
            fit,
            Self::opt_str(payload, "snapshot"),
            Self::opt_str(payload, "media"),
        )?;
        Ok(json!({
            "width": w,
            "height": h,
            "time_s": t,
            "bytes_b64": base64_encode(&px),
            "cached": cached,
        }))
    }

    fn render_range(&mut self, payload: &Value) -> Result<Value, EngineError> {
        if self.jobs.len() >= MAX_JOBS {
            return Err(out_of_bounds(format!(
                "job limit reached ({MAX_JOBS}); drop a job first"
            )));
        }
        let (w, h) = Self::dims(payload)?;
        let fps = payload
            .get("fps")
            .and_then(Value::as_f64)
            .filter(|x| finite(*x) && *x > 0.0)
            .ok_or_else(|| invalid("renderRange requires payload.fps > 0"))?;
        if fps > MAX_RANGE_FPS {
            return Err(out_of_bounds(format!("fps {fps} exceeds {MAX_RANGE_FPS}")));
        }
        let start_s = payload
            .get("start_s")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if !finite(start_s) || start_s < 0.0 {
            return Err(out_of_bounds("start_s must be >= 0"));
        }
        let duration_s = payload
            .get("duration_s")
            .and_then(Value::as_f64)
            .filter(|x| finite(*x) && *x > 0.0)
            .ok_or_else(|| invalid("renderRange requires payload.duration_s > 0"))?;
        if duration_s > MAX_RANGE_SECONDS {
            return Err(out_of_bounds(format!(
                "duration_s {duration_s} exceeds {MAX_RANGE_SECONDS}"
            )));
        }
        let fit = Fit::parse(Self::opt_str(payload, "fit"))?;
        let plan = parse_plan(Self::plan_ref(payload)?)?;
        let sources = parse_video_sources(payload.get("sources"))?;
        let frames = ((duration_s * fps).round() as usize).clamp(1, MAX_RANGE_FRAMES);
        if (duration_s * fps).round() as usize > MAX_RANGE_FRAMES {
            return Err(out_of_bounds(format!(
                "range produces more than {MAX_RANGE_FRAMES} frames"
            )));
        }
        let job_id = self.next_job;
        self.next_job += 1;
        self.jobs.insert(
            job_id,
            RenderJob {
                plan,
                sources,
                width: w,
                height: h,
                fps,
                start_s,
                frames,
                next: 0,
                fit,
                snapshot: Self::opt_str(payload, "snapshot").map(str::to_string),
                media: Self::opt_str(payload, "media").map(str::to_string),
            },
        );
        Ok(json!({
            "job": job_id,
            "frames": frames,
            "width": w,
            "height": h,
            "fps": fps,
            "start_s": start_s,
            "end_s": start_s + frames as f64 / fps,
        }))
    }

    fn next_frame(&mut self, payload: &Value) -> Result<Value, EngineError> {
        let job_id = payload
            .get("job")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("nextFrame requires payload.job"))?;
        // Phase 1: immutable job borrow — compute the frame (or fetch it
        // from the cache). The job's parsed plan/sources are used
        // directly; no re-parse per frame.
        let (px, cached, t, idx, w, h) = {
            let Some(job) = self.jobs.get(&job_id) else {
                return Err(EngineError::not_found(format!("no render job {job_id}")));
            };
            if job.next >= job.frames {
                // Handled below with a mutable borrow.
                (Vec::new(), false, 0.0, usize::MAX, 0, 0)
            } else {
                let idx = job.next;
                let t = job.start_s + idx as f64 / job.fps;
                let key = Self::cache_key(
                    job.snapshot.as_deref(),
                    job.media.as_deref(),
                    t,
                    job.width,
                    job.height,
                    job.fit,
                );
                let (px, cached) = if let Some(hit) = self.cache.get(&key) {
                    (hit.bytes.clone(), true)
                } else {
                    let px = composite(&job.plan, &job.sources, job.width, job.height, t, job.fit)?;
                    Self::cache_put(
                        &mut self.cache,
                        &mut self.cache_order,
                        &mut self.cache_bytes,
                        key,
                        px.clone(),
                    );
                    (px, false)
                };
                (px, cached, t, idx, job.width, job.height)
            }
        };
        if idx == usize::MAX {
            self.jobs.remove(&job_id);
            return Ok(json!({ "done": true }));
        }
        let done = {
            let job = self.jobs.get_mut(&job_id).unwrap();
            job.next += 1;
            job.next >= job.frames
        };
        Ok(json!({
            "job": job_id,
            "index": idx,
            "time_s": t,
            "width": w,
            "height": h,
            "bytes_b64": base64_encode(&px),
            "cached": cached,
            "done": done,
        }))
    }

    fn drop_job(&mut self, payload: &Value) -> Result<Value, EngineError> {
        let job_id = payload
            .get("job")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("dropJob requires payload.job"))?;
        Ok(json!({ "dropped": self.jobs.remove(&job_id).is_some() }))
    }

    fn mix_audio_op(&mut self, payload: &Value) -> Result<Value, EngineError> {
        let plan = parse_plan(Self::plan_ref(payload)?)?;
        let sources = parse_audio_sources(payload.get("sources"))?;
        let start_s = payload
            .get("start_s")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let duration_s = payload
            .get("duration_s")
            .and_then(Value::as_f64)
            .filter(|x| finite(*x) && *x > 0.0)
            .ok_or_else(|| invalid("mixAudio requires payload.duration_s > 0"))?;
        let rate = payload
            .get("sample_rate")
            .and_then(Value::as_u64)
            .map(|r| r as u32)
            .unwrap_or(DEFAULT_MIX_SAMPLE_RATE);
        let pcm = mix_audio(&plan, &sources, start_s, duration_s, rate)?;
        let mut bytes = Vec::with_capacity(pcm.len() * 4);
        for s in &pcm {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        Ok(json!({
            "sample_rate": rate,
            "channels": 2,
            "frames": pcm.len() / 2,
            "duration_s": duration_s,
            "bytes_b64": base64_encode(&bytes),
        }))
    }

    fn clear_cache(&mut self) -> Value {
        self.cache.clear();
        self.cache_order.clear();
        self.cache_bytes = 0;
        json!({ "cleared": true })
    }

    /// Dispatch one protocol frame.
    pub fn handle_frame(&mut self, req: &FrameRequest) -> FrameResponse {
        let id = req.id;
        let result = match req.op.as_str() {
            "renderFrame" => self.render_frame(&req.payload),
            "renderRange" => self.render_range(&req.payload),
            "nextFrame" => self.next_frame(&req.payload),
            "dropJob" => self.drop_job(&req.payload),
            "mixAudio" => self.mix_audio_op(&req.payload),
            "clearCache" => Ok(self.clear_cache()),
            "describe" => Ok(json!({
                "service": "splice-render",
                "backend": "software-raster",
                "version": PROVIDER_VERSION,
                "ops": ["renderFrame", "renderRange", "nextFrame", "dropJob", "mixAudio", "clearCache", "describe"],
                "bounds": {
                    "max_output_width": MAX_OUTPUT_WIDTH,
                    "max_output_height": MAX_OUTPUT_HEIGHT,
                    "max_source_dim": MAX_SOURCE_DIM,
                    "max_source_frame_bytes": MAX_SOURCE_FRAME_BYTES,
                    "max_frames_per_source": MAX_FRAMES_PER_SOURCE,
                    "max_sources": MAX_SOURCES,
                    "max_source_total_bytes": MAX_SOURCE_TOTAL_BYTES,
                    "max_pcm_source_bytes": MAX_PCM_SOURCE_BYTES,
                    "max_pcm_total_bytes": MAX_PCM_TOTAL_BYTES,
                    "max_plan_clips": MAX_PLAN_CLIPS,
                    "max_plan_transitions": MAX_PLAN_TRANSITIONS,
                    "max_plan_tracks": MAX_PLAN_TRACKS,
                    "max_speed_keys": MAX_SPEED_KEYS,
                    "max_range_seconds": MAX_RANGE_SECONDS,
                    "max_range_fps": MAX_RANGE_FPS,
                    "max_range_frames": MAX_RANGE_FRAMES,
                    "max_jobs": MAX_JOBS,
                    "max_mix_seconds": MAX_MIX_SECONDS,
                    "min_mix_sample_rate": MIN_MIX_SAMPLE_RATE,
                    "max_mix_sample_rate": MAX_MIX_SAMPLE_RATE,
                    "max_cache_entries": MAX_CACHE_ENTRIES,
                    "max_cache_bytes": MAX_CACHE_BYTES,
                    "max_frame_bytes": MAX_FRAME_BYTES,
                },
            })),
            other => Err(invalid(format!("unknown splice-render op '{other}'"))),
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
}

impl Default for RenderService {
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
/// Same semantics as folio-render's `read_frame_line`.
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
/// shape as `nf-cli`/`folio-render`
/// (`{"id","handle","op","payload"}` → `{"id","ok","data"|"error"}`).
/// One frame at a time; rendering is synchronous on this thread. Frames
/// are capped at [`MAX_FRAME_BYTES`] raw bytes before parsing; a panic
/// drops all live render jobs, matching `nf-cli`'s session-safety rule.
pub fn run_stdio(service: &mut RenderService) -> std::io::Result<()> {
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
                        Err(_) => {
                            service.jobs.clear();
                            FrameResponse {
                                id,
                                ok: false,
                                data: None,
                                events: vec![],
                                error: Some(EngineError {
                                    code: ErrorCode::Internal,
                                    message: "splice-render panicked; jobs dropped".into(),
                                    recoverable: false,
                                }),
                            }
                        }
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
