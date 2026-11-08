//! Splice engine — the video timeline model for Nitro-Forge.
//!
//! Pure timeline state: media sources, video/audio tracks, and clips that
//! reference source sub-spans at a playback speed. No media decoding — the
//! `renderPlan` op produces the ordered, resolved clip list an encoder would
//! consume.
//!
//! Contracts: docs/ARCHITECTURE.md + docs/ENGINE_OPS.md (`splice-engine`).
//!
//! Every mutating op is one undo step. Ops that touch several clips (ripple,
//! roll, slide, insert/overwrite placement, `batch`) edit a copy of the
//! document, check the whole-document invariants on the copy, and only then
//! record the journal entry and swap the copy in, so a rejected op leaves the
//! document byte-for-byte unchanged.

mod annotations;
mod timeline_edits;
mod track_ops;
mod transitions;

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Event, Journal, TaskContext,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub use annotations::{LoopRange, Marker};
pub use transitions::{Transition, TransitionKind};

const JOURNAL_CAPACITY: usize = 64;
/// Upper bound on the ops one `batch` may carry.
const MAX_BATCH_OPS: usize = 256;
const DEFAULT_FPS: f64 = 30.0;
const MIN_SPEED: f64 = 0.1;
const MAX_SPEED: f64 = 10.0;
/// Clip gain bounds in dB — the same range cadence clips use (`gain_db`).
const MIN_CLIP_GAIN_DB: f64 = -60.0;
const MAX_CLIP_GAIN_DB: f64 = 12.0;
/// Stereo pan bounds: -1 = hard left, 0 = center, 1 = hard right (cadence's
/// track `pan` convention).
const MIN_PAN: f64 = -1.0;
const MAX_PAN: f64 = 1.0;
/// Most speed keys one clip may carry.
const MAX_SPEED_KEYS: usize = 256;
/// Tolerance for float comparisons on timeline boundaries.
const EPS: f64 = 1e-9;
/// Longest timeline or source position Splice accepts (about 115 days). Far
/// past any real edit, and small enough that `start + len` never rounds away
/// a clip's length.
const MAX_TIME_S: f64 = 1e7;
/// Ids cross into JavaScript as numbers, so they stay within its safe integers.
const MAX_ID: u64 = (1 << 53) - 1;
/// Longest track name, in characters.
const MAX_TRACK_NAME_CHARS: usize = 120;

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Video,
    Audio,
    /// Picture composited above the video tracks (picture-in-picture, titles
    /// rendered to media). Holds ordinary source clips.
    Overlay,
}

impl TrackKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "video" => Some(Self::Video),
            "audio" => Some(Self::Audio),
            "overlay" => Some(Self::Overlay),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Overlay => "overlay",
        }
    }

    /// Video and overlay tracks carry pictures; audio tracks carry sound.
    fn is_visual(self) -> bool {
        matches!(self, Self::Video | Self::Overlay)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Source {
    pub name: String,
    pub duration_s: f64,
}

/// One keyframed speed sample. `t_s` is source-relative media seconds (the
/// same domain as `in_s`/`out_s`); `speed` is media seconds consumed per
/// timeline second at that media point. Speed interpolates linearly between
/// neighbouring keys and holds the end key's value outside the keyed range.
/// Keys outside `[in_s, out_s]` are inert until a trim reveals them.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SpeedKey {
    pub t_s: f64,
    pub speed: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub id: u64,
    pub source_id: u64,
    /// Timeline placement (seconds).
    pub timeline_start_s: f64,
    /// Source span (seconds, source-relative).
    pub in_s: f64,
    pub out_s: f64,
    /// Constant playback speed. Governs the clip only while `speed_keys` is
    /// empty; `setSpeed` flattens a keyframed clip back to this field.
    pub speed: f64,
    /// Keyframed speed curve over media time, sorted by `t_s`. Empty means
    /// constant speed — the legacy behaviour, and the only shape older
    /// snapshots carry (the field is skipped when empty, so constant-speed
    /// documents serialize byte-identically to before).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub speed_keys: Vec<SpeedKey>,
    /// Clip gain in dB, `MIN_CLIP_GAIN_DB..=MAX_CLIP_GAIN_DB`; 0 dB is unity —
    /// the same convention cadence clips use. Mix metadata only: Splice has
    /// no decoder or mixer, so nothing applies it yet; `renderPlan` exposes it
    /// for a future mixer the way `muted`/`track_active` already are. Skipped
    /// at the neutral 0 dB so default clips keep their legacy bytes.
    #[serde(default, skip_serializing_if = "is_neutral_gain_db")]
    pub gain_db: f64,
    /// Stereo pan, `MIN_PAN..=MAX_PAN`; 0 is center. Same storage-only note
    /// as `gain_db`.
    #[serde(default, skip_serializing_if = "is_neutral_pan")]
    pub pan: f64,
}

fn is_neutral_gain_db(v: &f64) -> bool {
    *v == 0.0
}

fn is_neutral_pan(v: &f64) -> bool {
    *v == 0.0
}

impl Clip {
    /// Timeline footprint of the media span `[a, b]`: the integral of
    /// `dt / speed(t)` — how many timeline seconds `b - a` media seconds
    /// occupy under this clip's speed curve. Exact per key segment.
    fn span_len(&self, a: f64, b: f64) -> f64 {
        span_len(&self.speed_keys, self.speed, a, b)
    }

    /// Timeline footprint: media span consumed at the clip's speed curve.
    fn timeline_len(&self) -> f64 {
        self.span_len(self.in_s, self.out_s)
    }

    fn timeline_end(&self) -> f64 {
        self.timeline_start_s + self.timeline_len()
    }
}

/// Playback speed at media time `t` for a key set + constant fallback.
pub(crate) fn speed_at(keys: &[SpeedKey], speed: f64, t: f64) -> f64 {
    if keys.is_empty() {
        return speed;
    }
    if t <= keys[0].t_s {
        return keys[0].speed;
    }
    if t >= keys[keys.len() - 1].t_s {
        return keys[keys.len() - 1].speed;
    }
    // keys are sorted by t_s; find the segment containing t.
    let i = keys.partition_point(|k| k.t_s <= t).saturating_sub(1);
    let (a, b) = (keys[i], keys[i + 1]);
    let f = (t - a.t_s) / (b.t_s - a.t_s);
    a.speed + (b.speed - a.speed) * f
}

/// Timeline seconds that the media interval `[a, b]` occupies: the integral
/// of `1 / speed(t)` over media time. Speed is piecewise linear in `t`, so
/// each piece integrates in closed form (`h * ln(sb/sa) / (sb - sa)`, with
/// `h / s` at constant speed). Requires `a <= b` and sorted keys.
pub(crate) fn span_len(keys: &[SpeedKey], speed: f64, a: f64, b: f64) -> f64 {
    if keys.is_empty() {
        return (b - a) / speed;
    }
    // Knots: the interval ends plus every key strictly inside (a, b).
    let mut knots: Vec<(f64, f64)> = Vec::with_capacity(keys.len() + 2);
    knots.push((a, speed_at(keys, speed, a)));
    for k in keys {
        if k.t_s > a && k.t_s < b {
            knots.push((k.t_s, k.speed));
        }
    }
    knots.push((b, speed_at(keys, speed, b)));
    let mut total = 0.0;
    for w in knots.windows(2) {
        let (t0, s0) = w[0];
        let (t1, s1) = w[1];
        let h = t1 - t0;
        if h <= 0.0 {
            continue;
        }
        total += if (s1 - s0).abs() <= f64::EPSILON * s0.max(s1) {
            h / s0
        } else {
            // ∫ dt / (s0 + (s1-s0)(t-t0)/h) = h * ln(s1/s0) / (s1 - s0)
            h * ((s1 - s0) / s0).ln_1p() / (s1 - s0)
        };
    }
    total
}

/// Media time reached after playing `offset` timeline seconds starting at
/// media time `t0` (signed: negative offsets search backward). Inverts
/// `span_len`: finds `t1` with `∫_{t0}^{t1} dt / speed(t) = offset`. Speed is
/// bounded in `MIN_SPEED..=MAX_SPEED`, so `t1 - t0` always lands in
/// `[offset * MIN_SPEED, offset * MAX_SPEED]` and bisection converges
/// quickly. Constant-speed clips take the exact closed form.
pub(crate) fn media_for_offset(
    keys: &[SpeedKey],
    speed: f64,
    t0: f64,
    offset: f64,
) -> f64 {
    if keys.is_empty() {
        return t0 + offset * speed;
    }
    // F(t) = ∫_{t0}^{t} du / speed(u) is strictly increasing in t.
    let lo = (t0 + offset * MIN_SPEED).min(t0 + offset * MAX_SPEED);
    let hi = (t0 + offset * MIN_SPEED).max(t0 + offset * MAX_SPEED);
    // Signed integral helper: F(t) = ∫_{t0}^{t} du / speed(u), positive
    // when t > t0 and strictly increasing in t.
    let signed = |t: f64| -> f64 {
        if t >= t0 {
            span_len(keys, speed, t0, t)
        } else {
            -span_len(keys, speed, t, t0)
        }
    };
    let mut lo_t = lo;
    let mut hi_t = hi;
    // F(lo) <= offset <= F(hi) by the speed bounds; 200 iterations is far
    // past f64 precision on any allowed range.
    for _ in 0..200 {
        let mid = lo_t + (hi_t - lo_t) / 2.0;
        if signed(mid) < offset {
            lo_t = mid;
        } else {
            hi_t = mid;
        }
    }
    lo_t + (hi_t - lo_t) / 2.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: u64,
    pub kind: TrackKind,
    /// Display name. Absent until `renameTrack`; hosts show their own default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// A locked track refuses every edit to its clips and transitions, and
    /// ripple edits on other tracks leave it in place.
    #[serde(default)]
    pub locked: bool,
    /// Video/overlay only: excluded from the picture (`renderPlan.track_active`).
    #[serde(default)]
    pub hidden: bool,
    /// Audio only.
    #[serde(default)]
    pub muted: bool,
    /// Audio only. While any audio track is soloed, only soloed tracks play.
    #[serde(default)]
    pub solo: bool,
    #[serde(default)]
    pub clips: Vec<Clip>,
    #[serde(default)]
    pub transitions: Vec<Transition>,
}

impl Track {
    fn new(id: u64, kind: TrackKind) -> Self {
        Self {
            id,
            kind,
            name: None,
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
            clips: Vec::new(),
            transitions: Vec::new(),
        }
    }

    fn sort_clips(&mut self) {
        self.clips
            .sort_by(|a, b| a.timeline_start_s.total_cmp(&b.timeline_start_s));
    }

    fn clip(&self, id: u64) -> Option<&Clip> {
        self.clips.iter().find(|c| c.id == id)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Doc {
    fps: f64,
    next_id: u64,
    sources: BTreeMap<u64, Source>,
    tracks: Vec<Track>,
    #[serde(default)]
    markers: Vec<Marker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    loop_range: Option<LoopRange>,
}

impl Doc {
    fn fresh(fps: f64) -> Self {
        Self {
            fps,
            next_id: 1,
            sources: BTreeMap::new(),
            tracks: Vec::new(),
            markers: Vec::new(),
            loop_range: None,
        }
    }

    fn require_track(&self, id: u64) -> Result<usize, EngineError> {
        self.track_index(id)
            .ok_or_else(|| EngineError::not_found(format!("no track {id}")))
    }

    fn require_clip(&self, id: u64) -> Result<(usize, usize), EngineError> {
        self.clip_location(id)
            .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))
    }

    fn require_unlocked(&self, track_idx: usize) -> Result<(), EngineError> {
        let t = &self.tracks[track_idx];
        if t.locked {
            return Err(EngineError::validation(format!("track {} is locked", t.id)));
        }
        Ok(())
    }

    fn source_of(&self, clip: &Clip) -> Result<&Source, EngineError> {
        self.sources
            .get(&clip.source_id)
            .ok_or_else(|| EngineError::internal("clip references missing source"))
    }

    /// Whether audio track `t` is heard / visual track `t` is seen.
    fn track_active(&self, t: &Track) -> bool {
        if t.kind.is_visual() {
            return !t.hidden;
        }
        let any_solo = self
            .tracks
            .iter()
            .any(|o| o.kind == TrackKind::Audio && o.solo);
        if any_solo {
            t.solo
        } else {
            !t.muted
        }
    }

    /// Split the clip at `(track_idx, clip_idx)` at timeline time `at`, which
    /// must be strictly inside it. The left half keeps the id; the right half
    /// gets a new one, which is returned. A transition on the clip's tail
    /// follows the right half, so it stays on the same cut.
    fn split_at(&mut self, track_idx: usize, clip_idx: usize, at: f64) -> Result<u64, EngineError> {
        let clip = &self.tracks[track_idx].clips[clip_idx];
        let (start, end) = (clip.timeline_start_s, clip.timeline_end());
        if at <= start + EPS || at >= end - EPS {
            return Err(EngineError::validation(
                "at_s must be strictly inside the clip's timeline span",
            ));
        }
        // Media point `at` timeline seconds into the clip. With speed keys
        // this inverts the footprint integral; constant clips keep the exact
        // `in + dt * speed` form.
        let split_media = media_for_offset(&clip.speed_keys, clip.speed, clip.in_s, at - start);
        let split_speed = speed_at(&clip.speed_keys, clip.speed, split_media);
        // The curve is media-anchored, so both halves keep the keys on their
        // side of the cut. A boundary key at the split point preserves the
        // interpolated speed exactly on both sides.
        let mut left_keys: Vec<SpeedKey> = clip
            .speed_keys
            .iter()
            .filter(|k| k.t_s < split_media)
            .copied()
            .collect();
        left_keys.push(SpeedKey {
            t_s: split_media,
            speed: split_speed,
        });
        let mut right_keys: Vec<SpeedKey> = clip
            .speed_keys
            .iter()
            .filter(|k| k.t_s > split_media)
            .copied()
            .collect();
        right_keys.insert(
            0,
            SpeedKey {
                t_s: split_media,
                speed: split_speed,
            },
        );
        let left_id = clip.id;
        let right_id = self.alloc_id();
        let track = &mut self.tracks[track_idx];
        let clip = &mut track.clips[clip_idx];
        let right = Clip {
            id: right_id,
            source_id: clip.source_id,
            timeline_start_s: at,
            in_s: split_media,
            out_s: clip.out_s,
            speed: clip.speed,
            speed_keys: if clip.speed_keys.is_empty() {
                Vec::new()
            } else {
                right_keys
            },
            // Mix fields are per-clip metadata, not media geometry: both
            // halves inherit them (same as cadence's splitClip copying gain).
            gain_db: clip.gain_db,
            pan: clip.pan,
        };
        clip.out_s = split_media;
        clip.speed_keys = if clip.speed_keys.is_empty() {
            Vec::new()
        } else {
            left_keys
        };
        track.clips.insert(clip_idx + 1, right);
        for t in &mut track.transitions {
            if t.left_id == left_id {
                t.left_id = right_id;
            }
        }
        Ok(right_id)
    }

    /// Clip invariants: starts >= 0, spans inside their sources, speeds in
    /// range, no overlaps on a track. Multi-clip ops run this on their
    /// working copy before committing. Transitions are not checked here: a
    /// clip edit that breaks one drops it (`transitions::prune`) rather than
    /// failing; see `validate_transitions`.
    fn validate(&self) -> Result<(), EngineError> {
        for t in &self.tracks {
            let mut clips: Vec<&Clip> = t.clips.iter().collect();
            clips.sort_by(|a, b| a.timeline_start_s.total_cmp(&b.timeline_start_s));
            for c in &clips {
                if c.timeline_start_s < -EPS {
                    return Err(EngineError::validation(format!(
                        "clip {} would start before 0",
                        c.id
                    )));
                }
                check_speed(c.speed)?;
                check_speed_keys(c)?;
                check_gain_db(c.gain_db)?;
                check_pan(c.pan)?;
                check_span(c.in_s, c.out_s, self.source_of(c)?)?;
                if c.timeline_end() > MAX_TIME_S {
                    return Err(EngineError::out_of_bounds(format!(
                        "clip {} would end past {MAX_TIME_S} s",
                        c.id
                    )));
                }
            }
            for w in clips.windows(2) {
                if w[1].timeline_start_s < w[0].timeline_end() - EPS {
                    return Err(EngineError::validation(format!(
                        "clips {} and {} would overlap on track {}",
                        w[0].id, w[1].id, t.id
                    )));
                }
            }
        }
        Ok(())
    }

    /// Every transition fits its cut, one per cut (used by transition ops
    /// and `restore`).
    fn validate_transitions(&self) -> Result<(), EngineError> {
        for t in &self.tracks {
            for (i, tr) in t.transitions.iter().enumerate() {
                if t.transitions[..i]
                    .iter()
                    .any(|o| o.left_id == tr.left_id && o.right_id == tr.right_id)
                {
                    return Err(EngineError::validation("that cut already has a transition"));
                }
                transitions::check(self, t, &t.transitions, tr)?;
            }
        }
        Ok(())
    }

    /// Everything a snapshot must satisfy beyond the clip and transition
    /// invariants: rate, source lengths, unique ids below `next_id`, header
    /// flags that fit the track kind, marker and loop-range bounds.
    fn validate_restored(&self) -> Result<(), EngineError> {
        if !(self.fps.is_finite() && self.fps > 0.0) {
            return Err(EngineError::validation("fps must be > 0"));
        }
        if self.next_id > MAX_ID {
            return Err(EngineError::validation("next_id is out of range"));
        }
        let mut ids = std::collections::BTreeSet::new();
        let mut claim = |id: u64| -> Result<(), EngineError> {
            if id >= self.next_id || !ids.insert(id) {
                return Err(EngineError::validation(format!("id {id} is duplicated or not below next_id")));
            }
            Ok(())
        };
        for (id, s) in &self.sources {
            claim(*id)?;
            check_duration(s.duration_s)?;
        }
        for t in &self.tracks {
            claim(t.id)?;
            if t.kind == TrackKind::Audio && t.hidden {
                return Err(EngineError::validation("hidden is set on an audio track"));
            }
            if t.kind != TrackKind::Audio && (t.muted || t.solo) {
                return Err(EngineError::validation("muted or solo is set on a video or overlay track"));
            }
            if let Some(name) = &t.name {
                if name.trim().is_empty() || name.chars().count() > MAX_TRACK_NAME_CHARS {
                    return Err(EngineError::validation("track name is empty or too long"));
                }
            }
            for c in &t.clips {
                claim(c.id)?;
            }
            for x in &t.transitions {
                claim(x.id)?;
            }
        }
        for m in &self.markers {
            claim(m.id)?;
            annotations::check_marker(m)?;
        }
        if let Some(r) = self.loop_range {
            annotations::check_loop(r.in_s, r.out_s)?;
        }
        Ok(())
    }

    /// Snap positions that float math left a hair below 0 and re-sort clips.
    fn normalize(&mut self) {
        for t in &mut self.tracks {
            for c in &mut t.clips {
                if c.timeline_start_s < 0.0 && c.timeline_start_s > -EPS {
                    c.timeline_start_s = 0.0;
                }
                if c.in_s < 0.0 && c.in_s > -EPS {
                    c.in_s = 0.0;
                }
            }
            t.sort_clips();
        }
    }

    fn alloc_id(&mut self) -> u64 {
        let id = self.next_id;
        // `restore` keeps next_id at or below MAX_ID, so this never saturates
        // in practice; saturating keeps it panic-free regardless.
        self.next_id = self.next_id.saturating_add(1);
        id
    }

    fn track_index(&self, id: u64) -> Option<usize> {
        self.tracks.iter().position(|t| t.id == id)
    }

    fn clip_location(&self, id: u64) -> Option<(usize, usize)> {
        for (ti, t) in self.tracks.iter().enumerate() {
            if let Some(ci) = t.clips.iter().position(|c| c.id == id) {
                return Some((ti, ci));
            }
        }
        None
    }

    /// Would a clip occupying [start, start+len) on `track_idx` overlap an
    /// existing clip? `exclude` skips the clip being edited.
    fn overlaps(&self, track_idx: usize, start: f64, len: f64, exclude: Option<u64>) -> bool {
        let end = start + len;
        self.tracks[track_idx].clips.iter().any(|c| {
            Some(c.id) != exclude
                && start < c.timeline_end() - EPS
                && c.timeline_start_s < end - EPS
        })
    }

    fn track_end(&self, track_idx: usize) -> f64 {
        self.tracks[track_idx]
            .clips
            .iter()
            .map(Clip::timeline_end)
            .fold(0.0, f64::max)
    }

    fn source_in_use(&self, source_id: u64) -> bool {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .any(|c| c.source_id == source_id)
    }
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

fn req_u64(p: &Value, key: &str) -> Result<u64, EngineError> {
    p.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
}

fn req_f64(p: &Value, key: &str) -> Result<f64, EngineError> {
    p.get(key)
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite())
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
}

fn opt_f64(p: &Value, key: &str) -> Result<Option<f64>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|f| f.is_finite())
            .map(Some)
            .ok_or_else(|| EngineError::invalid(format!("invalid '{key}'"))),
    }
}

fn opt_str(p: &Value, key: &str) -> Result<Option<String>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_str()
            .map(|s| Some(s.to_string()))
            .ok_or_else(|| EngineError::invalid(format!("invalid '{key}'"))),
    }
}

fn check_duration(duration_s: f64) -> Result<(), EngineError> {
    if duration_s <= 0.0 {
        return Err(EngineError::validation("duration_s must be > 0"));
    }
    if duration_s > MAX_TIME_S {
        return Err(EngineError::out_of_bounds(format!(
            "duration_s must be at most {MAX_TIME_S}"
        )));
    }
    Ok(())
}

fn check_speed(speed: f64) -> Result<(), EngineError> {
    if !(MIN_SPEED..=MAX_SPEED).contains(&speed) {
        return Err(EngineError::validation(format!(
            "speed must be in {MIN_SPEED}..={MAX_SPEED}"
        )));
    }
    Ok(())
}

/// Speed-key invariants for one clip: bounded count, media-time positions
/// within range, speeds in range, strictly increasing `t_s` (the stored
/// order `speed_at`/`span_len` rely on). Keys outside the clip's media span
/// are allowed — they are inert data a later trim can reveal.
fn check_speed_keys(c: &Clip) -> Result<(), EngineError> {
    if c.speed_keys.len() > MAX_SPEED_KEYS {
        return Err(EngineError::validation(format!(
            "clip {} has more than {MAX_SPEED_KEYS} speed keys",
            c.id
        )));
    }
    let mut prev = f64::NEG_INFINITY;
    for k in &c.speed_keys {
        if !(k.t_s.is_finite() && k.t_s >= 0.0 && k.t_s <= MAX_TIME_S) {
            return Err(EngineError::validation(format!(
                "clip {} speed key time must be within 0..={MAX_TIME_S}",
                c.id
            )));
        }
        if k.t_s <= prev {
            return Err(EngineError::validation(format!(
                "clip {} speed keys must have strictly increasing t_s",
                c.id
            )));
        }
        prev = k.t_s;
        check_speed(k.speed)?;
    }
    Ok(())
}

fn check_gain_db(gain_db: f64) -> Result<(), EngineError> {
    if !(gain_db.is_finite() && (MIN_CLIP_GAIN_DB..=MAX_CLIP_GAIN_DB).contains(&gain_db)) {
        return Err(EngineError::validation(format!(
            "gain_db must be in {MIN_CLIP_GAIN_DB}..={MAX_CLIP_GAIN_DB}"
        )));
    }
    Ok(())
}

fn check_pan(pan: f64) -> Result<(), EngineError> {
    if !(pan.is_finite() && (MIN_PAN..=MAX_PAN).contains(&pan)) {
        return Err(EngineError::validation(format!(
            "pan must be in {MIN_PAN}..={MAX_PAN}"
        )));
    }
    Ok(())
}

/// Validate a clip's source span against its source duration.
fn check_span(in_s: f64, out_s: f64, src: &Source) -> Result<(), EngineError> {
    if in_s < 0.0 {
        return Err(EngineError::validation("in_s must be >= 0"));
    }
    if !(in_s < out_s) {
        return Err(EngineError::validation("in_s must be < out_s"));
    }
    if out_s > src.duration_s + EPS {
        return Err(EngineError::out_of_bounds(format!(
            "out_s exceeds source duration {}",
            src.duration_s
        )));
    }
    Ok(())
}

/// Parse a `speed_keys` payload field: an array of `{t_s, speed}` in any
/// order (sorted here), at most `MAX_SPEED_KEYS`, media times within
/// `0..=MAX_TIME_S`, speeds within the `setSpeed` range, no duplicate `t_s`.
fn req_speed_keys(p: &Value, key: &str) -> Result<Vec<SpeedKey>, EngineError> {
    let arr = p
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))?;
    if arr.len() > MAX_SPEED_KEYS {
        return Err(EngineError::out_of_bounds(format!(
            "{key} takes at most {MAX_SPEED_KEYS} entries"
        )));
    }
    let mut keys = Vec::with_capacity(arr.len());
    for item in arr {
        let t_s = item
            .get("t_s")
            .and_then(Value::as_f64)
            .filter(|f| f.is_finite())
            .ok_or_else(|| EngineError::invalid(format!("invalid '{key}' entry")))?;
        let speed = item
            .get("speed")
            .and_then(Value::as_f64)
            .filter(|f| f.is_finite())
            .ok_or_else(|| EngineError::invalid(format!("invalid '{key}' entry")))?;
        check_speed(speed)?;
        if !(t_s >= 0.0 && t_s <= MAX_TIME_S) {
            return Err(EngineError::out_of_bounds(format!(
                "{key} t_s must be within 0..={MAX_TIME_S}"
            )));
        }
        keys.push(SpeedKey { t_s, speed });
    }
    keys.sort_by(|a, b| a.t_s.total_cmp(&b.t_s));
    if keys.windows(2).any(|w| w[0].t_s == w[1].t_s) {
        return Err(EngineError::validation(format!(
            "{key} has duplicate t_s values"
        )));
    }
    Ok(keys)
}

/// Optional `speed_keys` field: absent/null means no keys (constant speed).
fn opt_speed_keys(p: &Value) -> Result<Vec<SpeedKey>, EngineError> {
    match p.get("speed_keys") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(_) => req_speed_keys(p, "speed_keys"),
    }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/// Video timeline engine. See ENGINE_OPS.md § `splice-engine`.
pub struct SpliceEngine {
    doc: Doc,
    /// Whole-doc snapshots as undo entries (capacity 64).
    journal: Journal<Doc>,
}

impl SpliceEngine {
    pub fn new() -> Self {
        Self {
            doc: Doc::fresh(DEFAULT_FPS),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    fn record(&mut self) {
        self.journal.record(self.doc.clone());
    }

    fn changed(data: Value, structural: bool) -> CommandResult {
        let mut events = vec![Event::new("document:changed", Value::Null)];
        if structural {
            events.push(Event::new("timeline:changed", Value::Null));
        }
        CommandResult { events, data, output: None }
    }

    fn read_only(data: Value) -> CommandResult {
        CommandResult {
            events: vec![],
            data,
            output: None,
        }
    }
}

impl Default for SpliceEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SpliceEngine {
    fn apply_op(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.v != 1 {
            return Err(EngineError::unsupported(format!(
                "unsupported command version {}",
                cmd.v
            )));
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            // ---- lifecycle -------------------------------------------------
            "new" => {
                let fps = opt_f64(p, "fps")?.unwrap_or(DEFAULT_FPS);
                if fps <= 0.0 {
                    return Err(EngineError::validation("fps must be > 0"));
                }
                self.record();
                self.doc = Doc::fresh(fps);
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "describe" => Ok(Self::read_only(serde_json::to_value(&self.doc)?)),

            // ---- sources ---------------------------------------------------
            "addSource" => {
                let duration = req_f64(p, "duration_s")?;
                check_duration(duration)?;
                let name = opt_str(p, "name")?;
                self.record();
                let id = self.doc.alloc_id();
                let name = name.unwrap_or_else(|| format!("Source {}", self.doc.sources.len() + 1));
                self.doc.sources.insert(id, Source { name, duration_s: duration });
                Ok(Self::changed(json!({ "source_id": id }), false))
            }
            "removeSource" => {
                let id = req_u64(p, "id")?;
                if !self.doc.sources.contains_key(&id) {
                    return Err(EngineError::not_found(format!("no source {id}")));
                }
                if self.doc.source_in_use(id) {
                    return Err(EngineError::validation(
                        "source is referenced by a clip",
                    ));
                }
                self.record();
                self.doc.sources.remove(&id);
                Ok(Self::changed(json!({ "ok": true }), false))
            }

            // ---- tracks ----------------------------------------------------
            "addTrack" => {
                let kind = match p.get("kind").and_then(Value::as_str) {
                    Some(s) => TrackKind::parse(s).ok_or_else(|| {
                        EngineError::validation("kind must be \"video\", \"audio\" or \"overlay\"")
                    })?,
                    None => return Err(EngineError::invalid("missing or invalid 'kind'")),
                };
                self.record();
                let id = self.doc.alloc_id();
                self.doc.tracks.push(Track::new(id, kind));
                Ok(Self::changed(json!({ "track_id": id }), true))
            }
            "removeTrack" => {
                let id = req_u64(p, "id")?;
                let idx = self.doc.require_track(id)?;
                self.doc.require_unlocked(idx)?;
                self.record();
                self.doc.tracks.remove(idx);
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "setTrackFlags" | "renameTrack" | "moveTrack" => {
                let mut next = self.doc.clone();
                match track_ops::apply(&mut next, cmd.op.as_str(), p)? {
                    Some(data) => Ok(self.commit(next, data, true)),
                    None => Ok(Self::read_only(json!({ "ok": true, "changed": false }))),
                }
            }

            // ---- multi-clip edits (ripple, roll, slip, slide) --------------
            "rippleDelete" | "rippleTrim" | "rollEdit" | "slipClip" | "slideClip" => {
                let mut next = self.doc.clone();
                let data = timeline_edits::apply(&mut next, cmd.op.as_str(), p)?;
                next.normalize();
                next.validate()?;
                Ok(self.commit(next, data, true))
            }

            // ---- transitions -----------------------------------------------
            "addTransition" | "setTransition" | "removeTransition" => {
                let mut next = self.doc.clone();
                let data = transitions::apply(&mut next, cmd.op.as_str(), p)?;
                next.validate_transitions()?;
                Ok(self.commit(next, data, true))
            }

            // ---- markers and loop range ------------------------------------
            "addMarker" | "updateMarker" | "removeMarker" | "setLoopRange" | "clearLoopRange" => {
                let mut next = self.doc.clone();
                let data = annotations::apply(&mut next, cmd.op.as_str(), p)?;
                Ok(self.commit(next, data, false))
            }

            // ---- batch -----------------------------------------------------
            "batch" => self.batch(p, None),

            // ---- clips -----------------------------------------------------
            "addClip" => {
                let track_id = req_u64(p, "track")?;
                let source_id = req_u64(p, "source")?;
                let in_s = req_f64(p, "in_s")?;
                let out_s = req_f64(p, "out_s")?;
                let speed = opt_f64(p, "speed")?.unwrap_or(1.0);
                check_speed(speed)?;
                let speed_keys = opt_speed_keys(p)?;
                let ti = self
                    .doc
                    .track_index(track_id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {track_id}")))?;
                let src = self
                    .doc
                    .sources
                    .get(&source_id)
                    .ok_or_else(|| EngineError::not_found(format!("no source {source_id}")))?;
                check_span(in_s, out_s, src)?;
                let start = opt_f64(p, "start_s")?.unwrap_or_else(|| self.doc.track_end(ti));
                if start < 0.0 {
                    return Err(EngineError::validation("start_s must be >= 0"));
                }
                self.doc.require_unlocked(ti)?;
                let placement = timeline_edits::Placement::parse(p)?;
                let mut next = self.doc.clone();
                let id = next.alloc_id();
                let clip = Clip {
                    id,
                    source_id,
                    timeline_start_s: start,
                    in_s,
                    out_s,
                    speed,
                    speed_keys,
                    gain_db: 0.0,
                    pan: 0.0,
                };
                let created = timeline_edits::place(
                    &mut next,
                    ti,
                    clip,
                    placement,
                    "clip overlaps an existing clip on this track",
                )?;
                Ok(self.commit(next, json!({ "clip_id": id, "created": created }), true))
            }
            "removeClip" => {
                let id = req_u64(p, "id")?;
                let (ti, ci) = self.doc.require_clip(id)?;
                self.doc.require_unlocked(ti)?;
                self.record();
                self.doc.tracks[ti].clips.remove(ci);
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "moveClip" => {
                let id = req_u64(p, "id")?;
                let start = req_f64(p, "start_s")?;
                if start < 0.0 {
                    return Err(EngineError::validation("start_s must be >= 0"));
                }
                let (ti, ci) = self.doc.require_clip(id)?;
                self.doc.require_unlocked(ti)?;
                let target = match p.get("track") {
                    None | Some(Value::Null) => ti,
                    Some(_) => {
                        let to = self.doc.require_track(req_u64(p, "track")?)?;
                        self.doc.require_unlocked(to)?;
                        if self.doc.tracks[to].kind.is_visual()
                            != self.doc.tracks[ti].kind.is_visual()
                        {
                            return Err(EngineError::validation(
                                "audio clips move between audio tracks; video and overlay clips between video and overlay tracks",
                            ));
                        }
                        to
                    }
                };
                let placement = timeline_edits::Placement::parse(p)?;
                let mut next = self.doc.clone();
                let mut clip = next.tracks[ti].clips.remove(ci);
                clip.timeline_start_s = start;
                let created = timeline_edits::place(
                    &mut next,
                    target,
                    clip,
                    placement,
                    "move would overlap an existing clip on this track",
                )?;
                Ok(self.commit(next, json!({ "ok": true, "created": created }), true))
            }
            "trimClip" => {
                let id = req_u64(p, "id")?;
                let in_s = opt_f64(p, "in_s")?;
                let out_s = opt_f64(p, "out_s")?;
                if in_s.is_none() && out_s.is_none() {
                    return Err(EngineError::invalid(
                        "trimClip requires at least one of 'in_s', 'out_s'",
                    ));
                }
                let (ti, ci) = self.doc.require_clip(id)?;
                self.doc.require_unlocked(ti)?;
                let clip = &self.doc.tracks[ti].clips[ci];
                let new_in = in_s.unwrap_or(clip.in_s);
                let new_out = out_s.unwrap_or(clip.out_s);
                let src = self
                    .doc
                    .sources
                    .get(&clip.source_id)
                    .ok_or_else(|| EngineError::internal("clip references missing source"))?;
                check_span(new_in, new_out, src)?;
                // Trimming the in-point shifts where the clip's media starts;
                // the timeline start stays fixed and the footprint changes.
                // With speed keys the footprint is the curve's integral over
                // the new media span, not `(out - in) / speed`.
                let new_len = clip.span_len(new_in, new_out);
                let start = clip.timeline_start_s;
                if self.doc.overlaps(ti, start, new_len, Some(id)) {
                    return Err(EngineError::validation(
                        "trim would overlap an existing clip on this track",
                    ));
                }
                self.record();
                let clip = &mut self.doc.tracks[ti].clips[ci];
                clip.in_s = new_in;
                clip.out_s = new_out;
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "splitClip" => {
                let id = req_u64(p, "id")?;
                let at = req_f64(p, "at_s")?;
                let (ti, ci) = self.doc.require_clip(id)?;
                self.doc.require_unlocked(ti)?;
                // split_at validates before it changes anything.
                let mut next = self.doc.clone();
                let right_id = next.split_at(ti, ci, at)?;
                Ok(self.commit(next, json!({ "left_id": id, "right_id": right_id }), true))
            }
            "setSpeed" => {
                let id = req_u64(p, "id")?;
                let speed = req_f64(p, "speed")?;
                check_speed(speed)?;
                let (ti, ci) = self.doc.require_clip(id)?;
                self.doc.require_unlocked(ti)?;
                let clip = &self.doc.tracks[ti].clips[ci];
                // setSpeed means "constant speed": it replaces any speed keys
                // (documented in ENGINE_OPS.md). The footprint is then the
                // plain `(out - in) / speed`.
                let new_len = (clip.out_s - clip.in_s) / speed;
                let start = clip.timeline_start_s;
                if self.doc.overlaps(ti, start, new_len, Some(id)) {
                    return Err(EngineError::validation(
                        "speed change would overlap an existing clip on this track",
                    ));
                }
                if clip.speed == speed && clip.speed_keys.is_empty() {
                    return Ok(Self::read_only(json!({ "ok": true, "changed": false })));
                }
                self.record();
                let clip = &mut self.doc.tracks[ti].clips[ci];
                clip.speed = speed;
                clip.speed_keys.clear();
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "setSpeedKeys" => {
                let id = req_u64(p, "id")?;
                let keys = req_speed_keys(p, "keys")?;
                let (ti, ci) = self.doc.require_clip(id)?;
                self.doc.require_unlocked(ti)?;
                let clip = &self.doc.tracks[ti].clips[ci];
                // Full replace. An empty `keys` array returns the clip to
                // constant `speed`. The footprint is the integral of
                // 1/speed over the media span under the new curve.
                if clip.speed_keys == keys {
                    return Ok(Self::read_only(json!({ "ok": true, "changed": false })));
                }
                let new_len = span_len(&keys, clip.speed, clip.in_s, clip.out_s);
                let start = clip.timeline_start_s;
                if self.doc.overlaps(ti, start, new_len, Some(id)) {
                    return Err(EngineError::validation(
                        "speed keys would overlap an existing clip on this track",
                    ));
                }
                self.record();
                self.doc.tracks[ti].clips[ci].speed_keys = keys;
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "setClipMix" => {
                let id = req_u64(p, "id")?;
                let gain_db = opt_f64(p, "gain_db")?;
                let pan = opt_f64(p, "pan")?;
                if gain_db.is_none() && pan.is_none() {
                    return Err(EngineError::invalid(
                        "setClipMix requires at least one of 'gain_db', 'pan'",
                    ));
                }
                if let Some(g) = gain_db {
                    check_gain_db(g)?;
                }
                if let Some(v) = pan {
                    check_pan(v)?;
                }
                let (ti, ci) = self.doc.require_clip(id)?;
                self.doc.require_unlocked(ti)?;
                let clip = &self.doc.tracks[ti].clips[ci];
                let new_gain = gain_db.unwrap_or(clip.gain_db);
                let new_pan = pan.unwrap_or(clip.pan);
                if new_gain == clip.gain_db && new_pan == clip.pan {
                    return Ok(Self::read_only(json!({ "ok": true, "changed": false })));
                }
                self.record();
                let clip = &mut self.doc.tracks[ti].clips[ci];
                clip.gain_db = new_gain;
                clip.pan = new_pan;
                // Mix metadata only: the timeline footprint is unchanged, so
                // this is a document change, not a timeline change.
                Ok(Self::changed(json!({ "ok": true }), false))
            }

            // ---- queries ---------------------------------------------------
            "duration" => {
                let seconds = self
                    .doc
                    .tracks
                    .iter()
                    .enumerate()
                    .map(|(i, _)| self.doc.track_end(i))
                    .fold(0.0, f64::max);
                Ok(Self::read_only(json!({ "seconds": seconds })))
            }
            "timeline" => Ok(Self::read_only(serde_json::to_value(&self.doc)?)),
            "renderPlan" => {
                let tracks: Vec<Value> = self
                    .doc
                    .tracks
                    .iter()
                    .map(|t| {
                        let mut clips: Vec<&Clip> = t.clips.iter().collect();
                        clips.sort_by(|a, b| a.timeline_start_s.total_cmp(&b.timeline_start_s));
                        Value::Array(
                            clips
                                .into_iter()
                                .map(|c| {
                                    json!({
                                        "clip_id": c.id,
                                        "track_id": t.id,
                                        "track_kind": t.kind.as_str(),
                                        "track_active": self.doc.track_active(t),
                                        "source_id": c.source_id,
                                        "timeline_start_s": c.timeline_start_s,
                                        "timeline_end_s": c.timeline_end(),
                                        "in_s": c.in_s,
                                        "out_s": c.out_s,
                                        "speed": c.speed,
                                        // Keyframed speed curve (media-time
                                        // keys); empty = constant `speed`.
                                        "speed_keys": c.speed_keys,
                                        // Per-clip mix metadata for a future
                                        // mixer; 0 dB / center pan are unity.
                                        "gain_db": c.gain_db,
                                        "pan": c.pan,
                                    })
                                })
                                .collect(),
                        )
                    })
                    .collect();
                let transitions: Vec<Value> = self
                    .doc
                    .tracks
                    .iter()
                    .map(|t| Value::Array(transitions::plan(t)))
                    .collect();
                Ok(Self::read_only(
                    json!({ "tracks": tracks, "transitions": transitions }),
                ))
            }

            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    /// Record the current document as one undo entry, then install `next`.
    fn commit(&mut self, next: Doc, data: Value, structural: bool) -> CommandResult {
        self.record();
        self.doc = next;
        Self::changed(data, structural)
    }

    /// `batch {ops:[{op,payload}]}`: run every op on a scratch engine; commit
    /// all of them as one undo entry, or none if any op fails. With `ctx`
    /// each op runs through `apply_long` on a scoped slice of the task's
    /// progress, so cancellation lands between ops or inside a long one.
    fn batch(&mut self, p: &Value, ctx: Option<&TaskContext>) -> Result<CommandResult, EngineError> {
        let ops = p
            .get("ops")
            .and_then(Value::as_array)
            .ok_or_else(|| EngineError::invalid("missing or invalid 'ops'"))?;
        if ops.is_empty() {
            return Err(EngineError::validation("batch needs at least one op"));
        }
        if ops.len() > MAX_BATCH_OPS {
            return Err(EngineError::validation(format!(
                "batch takes at most {MAX_BATCH_OPS} ops"
            )));
        }
        let mut scratch = SpliceEngine {
            doc: self.doc.clone(),
            journal: Journal::new(1),
        };
        let total = ops.len();
        let mut results = Vec::with_capacity(total);
        let mut structural = false;
        for (i, item) in ops.iter().enumerate() {
            let op = item
                .get("op")
                .and_then(Value::as_str)
                .ok_or_else(|| EngineError::invalid(format!("ops[{i}]: missing or invalid 'op'")))?;
            if matches!(op, "batch" | "new") {
                return Err(EngineError::validation(format!(
                    "ops[{i}]: '{op}' cannot run inside a batch"
                )));
            }
            let payload = item.get("payload").cloned().unwrap_or_else(|| json!({}));
            let command = Command::new(op, payload);
            let applied = match ctx {
                Some(ctx) => {
                    ctx.checkpoint()?;
                    let step = ctx.scoped(
                        i as f32 / total as f32,
                        (i + 1) as f32 / total as f32,
                    );
                    scratch.apply_long(command, &step)
                }
                None => scratch.apply(command),
            };
            let r = applied
                .map_err(|e| EngineError::new(e.code, format!("ops[{i}] {op}: {}", e.message)))?;
            structural |= r.events.iter().any(|e| e.kind == "timeline:changed");
            results.push(r.data);
        }
        let data = json!({ "results": results });
        if scratch.doc == self.doc {
            // Nothing changed (read-only or no-op ops): no undo entry, no event.
            return Ok(Self::read_only(data));
        }
        Ok(self.commit(scratch.doc, data, structural))
    }
}

impl Engine for SpliceEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Splice
    }

    /// Runs the op, then drops transitions the edit invalidated (clips no
    /// longer adjacent, or too little media left for the overlap). The drop
    /// is part of the same undo entry, and the ids are returned as
    /// `removed_transitions`.
    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        let mut result = self.apply_op(cmd)?;
        if result.events.iter().any(|e| e.kind == "timeline:changed") {
            let removed = transitions::prune(&mut self.doc);
            if !removed.is_empty() {
                if let Value::Object(map) = &mut result.data {
                    map.insert("removed_transitions".into(), json!(removed));
                }
            }
        }
        Ok(result)
    }

    fn apply_batch(
        &mut self,
        cmd: Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let batch = ignition_core::parse_batch(cmd)?;
        let staged = Self { doc: self.doc.clone(), journal: Journal::new(1) };
        let (staged, result) = match ctx {
            Some(ctx) => ignition_core::execute_batch_with_ctx(staged, batch, ctx)?,
            None => ignition_core::execute_batch(staged, batch)?,
        };
        if result.events.iter().any(|event| event.kind == "document:changed") {
            self.journal.record(self.doc.clone());
            self.doc = staged.doc;
        }
        Ok(result)
    }

    /// `__batch` forwards to `apply_batch`; the engine's own `batch` op runs
    /// its plan on a scratch engine with per-op cancellation and progress.
    fn apply_long(&mut self, cmd: Command, ctx: &TaskContext) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, Some(ctx));
        }
        ctx.checkpoint()?;
        let result = if cmd.op == "batch" {
            self.batch(&cmd.payload, Some(ctx))?
        } else {
            self.apply(cmd)?
        };
        ctx.set_progress(1.0);
        Ok(result)
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let payload = serde_json::to_vec(&self.doc)?;
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_fmt, payload) = decode_envelope(data)?;
        let mut doc: Doc = serde_json::from_slice(payload)?;
        // A stale snapshot can carry next_id below live ids → collisions.
        let max_id = doc
            .sources
            .keys()
            .copied()
            .chain(doc.tracks.iter().map(|t| t.id))
            .chain(doc.tracks.iter().flat_map(|t| t.clips.iter().map(|c| c.id)))
            .chain(doc.tracks.iter().flat_map(|t| t.transitions.iter().map(|x| x.id)))
            .chain(doc.markers.iter().map(|m| m.id))
            .max()
            .unwrap_or(0);
        doc.next_id = doc.next_id.max(max_id.saturating_add(1));
        // A well-formed envelope can still carry an inconsistent timeline.
        doc.validate_restored()?;
        doc.validate()?;
        doc.validate_transitions()?;
        self.doc = doc;
        self.journal = Journal::new(JOURNAL_CAPACITY);
        Ok(())
    }

    fn undo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_undo() {
            Some(prev) => {
                let current = std::mem::replace(&mut self.doc, prev);
                self.journal.push_redo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn redo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_redo() {
            Some(next) => {
                let current = std::mem::replace(&mut self.doc, next);
                self.journal.push_undo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;
    use serde_json::json;

    fn eng() -> SpliceEngine {
        SpliceEngine::new()
    }

    fn apply(e: &mut SpliceEngine, op: &str, payload: Value) -> Result<Value, EngineError> {
        e.apply(Command::new(op, payload)).map(|r| r.data)
    }

    fn apply_full(
        e: &mut SpliceEngine,
        op: &str,
        payload: Value,
    ) -> Result<CommandResult, EngineError> {
        e.apply(Command::new(op, payload))
    }

    fn expect_err(e: &mut SpliceEngine, op: &str, payload: Value) -> EngineError {
        e.apply(Command::new(op, payload)).unwrap_err()
    }

    fn describe(e: &SpliceEngine) -> Value {
        serde_json::to_value(&e.doc).unwrap()
    }

    /// Engine with one 10s source (id returned) and one video track.
    fn setup(e: &mut SpliceEngine) -> (u64, u64) {
        let sid = apply(e, "addSource", json!({"duration_s": 10.0, "name": "a.mov"}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        let tid = apply(e, "addTrack", json!({"kind": "video"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        (sid, tid)
    }

    // ---- basics ------------------------------------------------------------

    #[test]
    fn new_defaults() {
        let mut e = eng();
        assert_eq!(describe(&e)["fps"], 30.0);
        apply(&mut e, "new", json!({"fps": 24.0})).unwrap();
        assert_eq!(describe(&e)["fps"], 24.0);
        assert_eq!(e.kind(), EngineKind::Splice);
        let before = describe(&e);
        expect_err(&mut e, "new", json!({"fps": 0.0}));
        expect_err(&mut e, "new", json!({"fps": -24.0}));
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn unknown_op_and_bad_version() {
        let mut e = eng();
        assert_eq!(
            expect_err(&mut e, "nope", json!({})).code,
            ErrorCode::InvalidCommand
        );
        let mut cmd = Command::new("describe", json!({}));
        cmd.v = 99;
        assert_eq!(e.apply(cmd).unwrap_err().code, ErrorCode::Unsupported);
    }

    // ---- sources ------------------------------------------------------------

    #[test]
    fn source_lifecycle() {
        let mut e = eng();
        let before = describe(&e);
        expect_err(&mut e, "addSource", json!({"duration_s": 0.0}));
        expect_err(&mut e, "addSource", json!({"duration_s": -2.0}));
        expect_err(&mut e, "addSource", json!({}));
        assert_eq!(describe(&e), before);

        let sid = apply(&mut e, "addSource", json!({"duration_s": 5.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert_eq!(describe(&e)["sources"][sid.to_string()]["duration_s"], 5.0);

        let err = expect_err(&mut e, "removeSource", json!({"id": 777}));
        assert_eq!(err.code, ErrorCode::NotFound);

        // referenced source cannot be removed
        let tid = apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0}),
        )
        .unwrap();
        let before = describe(&e);
        let err = expect_err(&mut e, "removeSource", json!({"id": sid}));
        assert_eq!(err.code, ErrorCode::Validation);
        assert_eq!(describe(&e), before);
    }

    // ---- tracks -------------------------------------------------------------

    #[test]
    fn track_lifecycle() {
        let mut e = eng();
        expect_err(&mut e, "addTrack", json!({}));
        expect_err(&mut e, "addTrack", json!({"kind": "subtitle"}));
        let v = apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        let a = apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        assert_ne!(v, a);
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 2);
        assert_eq!(describe(&e)["tracks"][1]["kind"], "audio");
        let err = expect_err(&mut e, "removeTrack", json!({"id": 55}));
        assert_eq!(err.code, ErrorCode::NotFound);
        apply(&mut e, "removeTrack", json!({"id": v})).unwrap();
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 2);
    }

    // ---- clips ---------------------------------------------------------------

    #[test]
    fn add_clip_validates_and_appends() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        // bad spans
        for bad in [
            json!({"track": tid, "source": sid, "in_s": 5.0, "out_s": 2.0}),  // in>=out
            json!({"track": tid, "source": sid, "in_s": -1.0, "out_s": 2.0}), // negative in
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 11.0}), // past source end
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0, "speed": 0.0}),
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0, "speed": 11.0}),
            json!({"track": 999, "source": sid, "in_s": 0.0, "out_s": 2.0}),
            json!({"track": tid, "source": 999, "in_s": 0.0, "out_s": 2.0}),
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0, "start_s": -1.0}),
        ] {
            let before = describe(&e);
            expect_err(&mut e, "addClip", bad);
            assert_eq!(describe(&e), before);
        }
        // default start_s = end of track (0 on empty)
        let c1 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // second clip appends at end of track → start 4.0
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 1.0, "out_s": 3.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["clips"][1]["timeline_start_s"], 4.0);
        // overlap rejected
        let before = describe(&e);
        expect_err(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0, "start_s": 3.5}),
        );
        assert_eq!(describe(&e), before);
        // explicit gap start ok
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0, "start_s": 10.0}),
        )
        .unwrap();
        // speed affects footprint: 2s media at 2x = 1s timeline len
        let _ = (c1, c2);
    }

    #[test]
    fn move_clip_overlap() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap();
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        let before = describe(&e);
        expect_err(&mut e, "moveClip", json!({"id": c2, "start_s": 3.0}));
        expect_err(&mut e, "moveClip", json!({"id": c2, "start_s": -5.0}));
        assert_eq!(describe(&e), before);
        apply(&mut e, "moveClip", json!({"id": c2, "start_s": 8.0})).unwrap();
        assert_eq!(
            describe(&e)["tracks"][0]["clips"][1]["timeline_start_s"],
            8.0
        );
        let err = expect_err(&mut e, "moveClip", json!({"id": 42, "start_s": 0.0}));
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn trim_clip() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 2.0, "out_s": 6.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "trimClip", json!({"id": c, "in_s": 3.0})).unwrap();
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["clips"][0]["in_s"], 3.0);
        assert_eq!(d["tracks"][0]["clips"][0]["out_s"], 6.0);
        // duration now 3s
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            3.0
        );
        // invalid trims leave state unchanged
        for bad in [
            json!({"id": c, "out_s": 3.0}),   // out <= in
            json!({"id": c, "out_s": 20.0}),  // beyond source
            json!({"id": c, "in_s": -0.5}),
            json!({"id": c}),                 // nothing to trim
        ] {
            let before = describe(&e);
            expect_err(&mut e, "trimClip", bad);
            assert_eq!(describe(&e), before);
        }
        // trim growth overlapping a neighbor rejected
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap(); // starts at 3.0, len 2 → ends 5
        let before = describe(&e);
        expect_err(&mut e, "trimClip", json!({"id": c, "out_s": 8.0})); // would end at 8-3=5? no: in=3,out=8 → len5, start0 → overlap c2 at 3..5
        assert_eq!(describe(&e), before);
        expect_err(&mut e, "removeClip", json!({"id": 987}));
        apply(&mut e, "removeClip", json!({"id": c2})).unwrap();
    }

    #[test]
    fn split_clip() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 8.0, "speed": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // timeline len = (8-0)/2 = 4s → clip spans 0..4
        let r = apply(&mut e, "splitClip", json!({"id": c, "at_s": 1.0})).unwrap();
        let left = r["left_id"].as_u64().unwrap();
        let right = r["right_id"].as_u64().unwrap();
        assert_eq!(left, c);
        assert_ne!(right, c);
        let d = describe(&e);
        let clips = &d["tracks"][0]["clips"];
        // split at t=1s → media point = in + 1*speed = 2.0
        assert_eq!(clips[0]["id"], left);
        assert_eq!(clips[0]["in_s"], 0.0);
        assert_eq!(clips[0]["out_s"], 2.0);
        assert_eq!(clips[1]["id"], right);
        assert_eq!(clips[1]["in_s"], 2.0);
        assert_eq!(clips[1]["out_s"], 8.0);
        assert_eq!(clips[1]["timeline_start_s"], 1.0);
        assert_eq!(clips[1]["speed"], 2.0);
        // splits outside the clip rejected
        for bad in [0.0, -1.0, 4.0, 10.0, 1.0_f64.min(0.0)] {
            let before = describe(&e);
            expect_err(&mut e, "splitClip", json!({"id": c, "at_s": bad}));
            assert_eq!(describe(&e), before);
        }
        // boundary of right half also rejected (strictly inside)
        let before = describe(&e);
        expect_err(&mut e, "splitClip", json!({"id": right, "at_s": 4.0}));
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn set_speed() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setSpeed", json!({"id": c, "speed": 2.0})).unwrap();
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            2.0
        );
        // speed growth overlapping a neighbor rejected
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0}),
        )
        .unwrap(); // at t=2.0
        let before = describe(&e);
        expect_err(&mut e, "setSpeed", json!({"id": c, "speed": 0.5})); // len 8 > 2 gap
        expect_err(&mut e, "setSpeed", json!({"id": c, "speed": 0.05}));
        expect_err(&mut e, "setSpeed", json!({"id": c, "speed": 20.0}));
        assert_eq!(describe(&e), before);
    }

    // ---- queries -------------------------------------------------------------

    #[test]
    fn duration_and_timeline_and_render_plan() {
        let mut e = eng();
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            0.0
        );
        let (sid, tid) = setup(&mut e);
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0, "start_s": 2.0}),
        )
        .unwrap();
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 4.0, "out_s": 6.0, "start_s": 10.0, "speed": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // clip2: 2s media at 2x → 1s footprint → timeline ends 11.0
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            11.0
        );
        let tl = apply(&mut e, "timeline", json!({})).unwrap();
        assert_eq!(tl["tracks"].as_array().unwrap().len(), 1);
        assert_eq!(tl["sources"][sid.to_string()]["name"], "a.mov");

        let plan = apply(&mut e, "renderPlan", json!({})).unwrap();
        let clips = plan["tracks"][0].as_array().unwrap();
        assert_eq!(clips.len(), 2);
        // ordered by timeline position
        assert_eq!(clips[0]["timeline_start_s"], 2.0);
        assert_eq!(clips[0]["timeline_end_s"], 6.0);
        assert_eq!(clips[1]["clip_id"], c2);
        assert_eq!(clips[1]["timeline_start_s"], 10.0);
        assert_eq!(clips[1]["timeline_end_s"], 11.0);
        assert_eq!(clips[1]["in_s"], 4.0);
        assert_eq!(clips[1]["out_s"], 6.0);
        assert_eq!(clips[1]["speed"], 2.0);
    }

    #[test]
    fn events_emitted() {
        let mut e = eng();
        let r = apply_full(&mut e, "addTrack", json!({"kind": "video"})).unwrap();
        let kinds: Vec<&str> = r.events.iter().map(|e| e.kind.as_str()).collect();
        assert!(kinds.contains(&"document:changed"));
        assert!(kinds.contains(&"timeline:changed"));
        // read-only emits nothing
        let r = apply_full(&mut e, "duration", json!({})).unwrap();
        assert!(r.events.is_empty());
        let r = apply_full(&mut e, "renderPlan", json!({})).unwrap();
        assert!(r.events.is_empty());
    }

    // ---- undo / snapshot ------------------------------------------------------

    #[test]
    fn undo_redo_chain() {
        let mut e = eng();
        assert_eq!(e.undo().unwrap(), false);
        assert_eq!(e.redo().unwrap(), false);
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "splitClip", json!({"id": c, "at_s": 2.0})).unwrap();
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 2);
        assert!(e.undo().unwrap()); // undo split
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap()); // undo addClip
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 0);
        assert!(e.undo().unwrap()); // undo addTrack
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 0);
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 2);
        // new apply clears redo
        assert!(e.undo().unwrap());
        apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap();
        assert_eq!(e.redo().unwrap(), false);
    }

    #[test]
    fn read_only_ops_record_no_undo() {
        let mut e = eng();
        apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap();
        apply(&mut e, "describe", json!({})).unwrap();
        apply(&mut e, "duration", json!({})).unwrap();
        apply(&mut e, "timeline", json!({})).unwrap();
        apply(&mut e, "renderPlan", json!({})).unwrap();
        assert!(e.undo().unwrap()); // undoes addTrack only
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 0);
        assert_eq!(e.undo().unwrap(), false);
    }

    #[test]
    fn snapshot_restore_describe_equality() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 1.0, "out_s": 5.0, "speed": 1.5, "start_s": 0.5}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "splitClip", json!({"id": c, "at_s": 1.0})).unwrap();
        apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap();
        let snap = e.snapshot().unwrap();
        let before = describe(&e);
        let mut e2 = eng();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&e2), before);
        // keep mutating after restore (ids continue from restored next_id)
        let new_src = apply(&mut e2, "addSource", json!({"duration_s": 3.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert!(new_src > sid);
    }

    #[test]
    fn restore_rejects_garbage() {
        let mut e = eng();
        apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap();
        let before = describe(&e);
        for bad in [
            &b""[..],
            b"NFD1\x00\x03\x00\x00\x00ab",
            b"XXXX\x00\x00\x00\x00\x00",
        ] {
            assert!(e.restore(bad).is_err());
            assert_eq!(describe(&e), before);
        }
        let wrong_shape = encode_envelope(b"12345");
        assert!(e.restore(&wrong_shape).is_err());
        assert_eq!(describe(&e), before);
    }

    // ---- batch ---------------------------------------------------------------

    #[test]
    fn batch_is_all_or_nothing_and_one_undo_step() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let a = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        let b = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 2.0, "out_s": 4.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        let r = apply_full(
            &mut e,
            "batch",
            json!({"ops": [
                {"op": "setSpeed", "payload": {"id": a, "speed": 2.0}},
                {"op": "moveClip", "payload": {"id": b, "start_s": 1.0}},
                {"op": "addMarker", "payload": {"time_s": 0.5}},
            ]}),
        )
        .unwrap();
        assert_eq!(r.data["results"].as_array().unwrap().len(), 3);
        assert!(r.data["results"][2]["marker_id"].is_u64());
        assert!(r.events.iter().any(|ev| ev.kind == "timeline:changed"));
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["clips"][0]["speed"], 2.0);
        assert_eq!(d["tracks"][0]["clips"][1]["timeline_start_s"], 1.0);
        // One undo reverts all three.
        assert!(e.undo().unwrap());
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["clips"][0]["speed"], 1.0);
        assert_eq!(d["markers"], json!([]));
        // A failing op leaves the document and journal untouched.
        let before = describe(&e);
        let err = expect_err(
            &mut e,
            "batch",
            json!({"ops": [
                {"op": "removeClip", "payload": {"id": a}},
                {"op": "moveClip", "payload": {"id": a, "start_s": 0.0}},
            ]}),
        );
        assert_eq!(err.code, ErrorCode::NotFound);
        assert!(err.message.starts_with("ops[1] moveClip:"), "{}", err.message);
        assert_eq!(describe(&e), before);
        for bad in [
            json!({"ops": []}),
            json!({}),
            json!({"ops": [{"op": "new"}]}),
            json!({"ops": [{"op": "batch", "payload": {"ops": []}}]}),
            json!({"ops": [{"payload": {}}]}),
        ] {
            assert!(e.apply(Command::new("batch", bad)).is_err());
            assert_eq!(describe(&e), before);
        }
        // undo now reaches the second addClip, proving no failed batch recorded.
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn task_batch_op_is_cancellable_and_reports_progress() {
        use ignition_core::TaskContext;
        let mut e = eng();
        setup(&mut e);
        let before = describe(&e);
        let ctx = TaskContext::new();
        ctx.cancel();
        let err = e
            .apply_long(
                Command::new(
                    "batch",
                    json!({"ops": [{"op": "addMarker", "payload": {"time_s": 1.0}}]}),
                ),
                &ctx,
            )
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::Cancelled);
        assert_eq!(describe(&e), before);

        // An uncancelled task batch commits once and reports full progress.
        let ctx = TaskContext::new();
        let r = e
            .apply_long(
                Command::new(
                    "batch",
                    json!({"ops": [
                        {"op": "addMarker", "payload": {"time_s": 1.0}},
                        {"op": "setLoopRange", "payload": {"in_s": 0.5, "out_s": 3.0}},
                    ]}),
                ),
                &ctx,
            )
            .unwrap();
        assert_eq!(r.data["results"].as_array().unwrap().len(), 2);
        assert_eq!(ctx.progress(), 1.0);
        assert!(e.undo().unwrap(), "task batch recorded no undo entry");
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn snapshot_carries_flags_markers_transitions_and_loop() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let l = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 2.0, "out_s": 4.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        let r = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 4.0, "out_s": 6.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        apply(&mut e, "addTransition", json!({"left": l, "right": r, "kind": "cross_dissolve", "duration_s": 1.0})).unwrap();
        apply(&mut e, "addMarker", json!({"time_s": 1.0, "name": "Intro"})).unwrap();
        apply(&mut e, "setLoopRange", json!({"in_s": 0.5, "out_s": 3.0})).unwrap();
        apply(&mut e, "renameTrack", json!({"id": tid, "name": "A-roll"})).unwrap();
        apply(&mut e, "setTrackFlags", json!({"id": tid, "locked": true})).unwrap();
        let snap = e.snapshot().unwrap();
        let mut e2 = eng();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&e2), describe(&e));
        // Ids continue past markers and transitions too.
        let m = apply(&mut e2, "addMarker", json!({"time_s": 2.0})).unwrap()["marker_id"].as_u64().unwrap();
        assert!(m >= describe(&e)["next_id"].as_u64().unwrap());
    }

    #[test]
    fn restore_rejects_an_inconsistent_timeline() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0})).unwrap();
        let mut doc = describe(&e);
        // Second clip overlapping the first: well-formed JSON, broken timeline.
        let mut dup = doc["tracks"][0]["clips"][0].clone();
        dup["id"] = json!(99);
        dup["timeline_start_s"] = json!(1.0);
        doc["tracks"][0]["clips"].as_array_mut().unwrap().push(dup);
        let bytes = encode_envelope(&serde_json::to_vec(&doc).unwrap());
        let before = describe(&e);
        assert_eq!(e.restore(&bytes).unwrap_err().code, ErrorCode::Validation);
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn restore_rejects_broken_snapshot_fields() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let l = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 2.0, "out_s": 4.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        let r = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 4.0, "out_s": 6.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        apply(&mut e, "addTransition", json!({"left": l, "right": r, "kind": "cross_dissolve", "duration_s": 1.0})).unwrap();
        apply(&mut e, "addMarker", json!({"time_s": 1.0})).unwrap();
        let good = describe(&e);
        apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap();
        let with_audio = describe(&e);
        type Breaker = fn(&mut Value);
        let breakers: [(&str, Breaker); 9] = [
            ("next_id past 2^53", |d| d["next_id"] = json!(u64::MAX)),
            ("duplicate clip id", |d| {
                let first = d["tracks"][0]["clips"][0]["id"].clone();
                d["tracks"][0]["clips"][1]["id"] = first;
            }),
            ("fps 0", |d| d["fps"] = json!(0.0)),
            ("source duration 0", |d| {
                let k = d["sources"].as_object().unwrap().keys().next().unwrap().clone();
                d["sources"][k]["duration_s"] = json!(0.0);
            }),
            ("hidden audio", |d| d["tracks"][1]["hidden"] = json!(true)),
            ("solo video", |d| d["tracks"][0]["solo"] = json!(true)),
            ("negative marker", |d| d["markers"][0]["time_s"] = json!(-1.0)),
            ("reversed loop", |d| d["loop_range"] = json!({"in_s": 3.0, "out_s": 1.0})),
            ("two transitions on one cut", |d| {
                let mut dup = d["tracks"][0]["transitions"][0].clone();
                let next = d["next_id"].as_u64().unwrap();
                dup["id"] = json!(next);
                d["next_id"] = json!(next + 1);
                d["tracks"][0]["transitions"].as_array_mut().unwrap().push(dup);
            }),
        ];
        let before = describe(&e);
        for (what, brk) in breakers {
            let mut doc = with_audio.clone();
            brk(&mut doc);
            let bytes = encode_envelope(&serde_json::to_vec(&doc).unwrap());
            assert!(e.restore(&bytes).is_err(), "{what} was accepted");
            assert_eq!(describe(&e), before, "{what}");
        }
        // The untouched documents restore.
        for doc in [good, with_audio] {
            e.restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap())).unwrap();
        }
    }

    #[test]
    fn huge_positions_are_out_of_bounds() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let before = describe(&e);
        for (op, p) in [
            ("addClip", json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0, "start_s": 1.7e308})),
            ("addSource", json!({"duration_s": 1e300})),
            ("addMarker", json!({"time_s": 1e12})),
            ("setLoopRange", json!({"in_s": 0.0, "out_s": 1e12})),
        ] {
            assert_eq!(expect_err(&mut e, op, p).code, ErrorCode::OutOfBounds, "{op}");
            assert_eq!(describe(&e), before, "{op}");
        }
    }

    #[test]
    fn unchanged_batch_records_nothing() {
        let mut e = eng();
        let (_, tid) = setup(&mut e);
        let r = apply_full(
            &mut e,
            "batch",
            json!({"ops": [{"op": "describe"}, {"op": "setTrackFlags", "payload": {"id": tid, "locked": false}}]}),
        )
        .unwrap();
        assert!(r.events.is_empty());
        assert_eq!(r.data["results"].as_array().unwrap().len(), 2);
        assert!(e.undo().unwrap()); // addTrack
        assert!(e.undo().unwrap()); // addSource
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn roll_back_to_the_first_media_frame_is_accepted() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        // Right clip at speed 3 with its in-point 0.3 s into the media: rolling
        // the cut 0.1 s earlier puts the in-point at 0.3 - 0.1 * 3, which is
        // -5.6e-17 in floating point.
        let l = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 5.0, "out_s": 6.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        let r = apply(&mut e, "addClip", json!({"track": tid, "source": sid, "in_s": 0.3, "out_s": 3.3, "speed": 3.0}))
            .unwrap()["clip_id"].as_u64().unwrap();
        apply(&mut e, "rollEdit", json!({"left": l, "right": r, "delta_s": -0.1})).unwrap();
        assert_eq!(describe(&e)["tracks"][0]["clips"][1]["in_s"], 0.0);
    }

    // ---- keyframed speed (speed_keys) --------------------------------------

    /// Clip JSON helpers over the `timeline` read.
    fn clip_json(e: &mut SpliceEngine, track: usize, index: usize) -> Value {
        apply(e, "timeline", json!({})).unwrap()["tracks"][track]["clips"][index].clone()
    }

    /// 4 s of media (0..4) with speed ramping 1→2: footprint = 4·ln2 ≈ 2.7726.
    fn keyed_clip(e: &mut SpliceEngine, sid: u64, tid: u64) -> u64 {
        let c = apply(
            e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(
            e,
            "setSpeedKeys",
            json!({"id": c, "keys": [{"t_s": 0.0, "speed": 1.0}, {"t_s": 4.0, "speed": 2.0}]}),
        )
        .unwrap();
        c
    }

    #[test]
    fn speed_keys_set_replace_clear_and_bounds() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // Constant clips carry no speed_keys field at all (legacy bytes).
        assert!(clip_json(&mut e, 0, 0).get("speed_keys").is_none());
        // Unsorted input is accepted and stored sorted.
        apply(
            &mut e,
            "setSpeedKeys",
            json!({"id": c, "keys": [
                {"t_s": 4.0, "speed": 2.0},
                {"t_s": 0.0, "speed": 1.0},
            ]}),
        )
        .unwrap();
        let d = clip_json(&mut e, 0, 0);
        assert_eq!(d["speed_keys"][0]["t_s"], 0.0);
        assert_eq!(d["speed_keys"][1]["speed"], 2.0);
        // Footprint = ∫₀⁴ dt/(1+t/4) = 4·ln2.
        let secs = apply(&mut e, "duration", json!({})).unwrap()["seconds"]
            .as_f64()
            .unwrap();
        assert!((secs - 4.0 * 2.0f64.ln()).abs() < 1e-9, "{secs}");
        // renderPlan carries the curve for hosts.
        let plan = apply(&mut e, "renderPlan", json!({})).unwrap();
        assert_eq!(plan["tracks"][0][0]["speed_keys"].as_array().unwrap().len(), 2);
        // Rejected payloads leave state untouched.
        let before = describe(&e);
        for bad in [
            json!({"id": c, "keys": [{"t_s": 0.0, "speed": 0.05}]}),
            json!({"id": c, "keys": [{"t_s": 0.0, "speed": 11.0}]}),
            json!({"id": c, "keys": [{"t_s": -1.0, "speed": 1.0}]}),
            json!({"id": c, "keys": [{"t_s": 0.0, "speed": 1.0}, {"t_s": 0.0, "speed": 2.0}]}),
            json!({"id": c, "keys": "fast"}),
            json!({"id": c}),
            json!({"id": 999, "keys": []}),
        ] {
            expect_err(&mut e, "setSpeedKeys", bad);
            assert_eq!(describe(&e), before);
        }
        // Equal write is eventless and records no undo.
        let r = apply_full(
            &mut e,
            "setSpeedKeys",
            json!({"id": c, "keys": [{"t_s": 0.0, "speed": 1.0}, {"t_s": 4.0, "speed": 2.0}]}),
        )
        .unwrap();
        assert!(r.events.is_empty());
        assert_eq!(r.data["changed"], false);
        // keys:[] returns to constant speed (footprint back to 4 s).
        apply(&mut e, "setSpeedKeys", json!({"id": c, "keys": []})).unwrap();
        assert!(clip_json(&mut e, 0, 0).get("speed_keys").is_none());
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            4.0
        );
        // setSpeed on a keyed clip flattens it to constant speed. (The doc
        // now holds two clips: c at 0..4 and the keyed clip appended at 4.)
        let k = keyed_clip(&mut e, sid, tid);
        apply(&mut e, "setSpeed", json!({"id": k, "speed": 2.0})).unwrap();
        assert!(clip_json(&mut e, 0, 1).get("speed_keys").is_none());
        // k spans 4..6 at 2x over 4 media-s; c still ends at 4.
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            6.0
        );
    }

    #[test]
    fn speed_keys_footprint_and_split() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = keyed_clip(&mut e, sid, tid);
        // Split at t=2 s of playback: media point solves 4·ln(1+m/4)=2.
        let m = 4.0 * (0.5f64.exp() - 1.0);
        let r = apply(&mut e, "splitClip", json!({"id": c, "at_s": 2.0})).unwrap();
        let left = clip_json(&mut e, 0, 0);
        let right = clip_json(&mut e, 0, 1);
        assert!((left["out_s"].as_f64().unwrap() - m).abs() < 1e-6);
        assert!((right["in_s"].as_f64().unwrap() - m).abs() < 1e-6);
        assert_eq!(right["timeline_start_s"], 2.0);
        // Each half keeps its side of the curve plus a shared boundary key.
        assert_eq!(left["speed_keys"].as_array().unwrap().len(), 2);
        assert_eq!(right["speed_keys"].as_array().unwrap().len(), 2);
        let bk = &left["speed_keys"][1];
        assert!((bk["t_s"].as_f64().unwrap() - m).abs() < 1e-6);
        assert!((bk["speed"].as_f64().unwrap() - (1.0 + m / 4.0)).abs() < 1e-6);
        // Footprints sum back to the whole: left ends at 2.0, right ends at
        // 4·ln2 ≈ 2.7726.
        let plan = apply(&mut e, "renderPlan", json!({})).unwrap();
        let clips = plan["tracks"][0].as_array().unwrap();
        let l_end = clips[0]["timeline_end_s"].as_f64().unwrap();
        let r_end = clips[1]["timeline_end_s"].as_f64().unwrap();
        assert!((l_end - 2.0).abs() < 1e-6, "{l_end}");
        assert!((r_end - 4.0 * 2.0f64.ln()).abs() < 1e-6, "{r_end}");
        let _ = r;
    }

    #[test]
    fn speed_keys_trim_move_ripple() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = keyed_clip(&mut e, sid, tid);
        // trimClip out_s=2: footprint = ∫₀² dt/(1+t/4) = 4·ln(1.5).
        apply(&mut e, "trimClip", json!({"id": c, "out_s": 2.0})).unwrap();
        let secs = apply(&mut e, "duration", json!({})).unwrap()["seconds"]
            .as_f64()
            .unwrap();
        assert!((secs - 4.0 * 1.5f64.ln()).abs() < 1e-9, "{secs}");
        // moveClip keeps the curve and footprint.
        apply(&mut e, "moveClip", json!({"id": c, "start_s": 10.0})).unwrap();
        assert_eq!(clip_json(&mut e, 0, 0)["timeline_start_s"], 10.0);
        assert_eq!(clip_json(&mut e, 0, 0)["speed_keys"].as_array().unwrap().len(), 2);
        // A second clip blocks a footprint-growing key change.
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0, "start_s": 12.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // c ends at 10 + 4ln1.5 ≈ 11.62; keys slowing it to ~0.1..1 grow it past 12.
        let before = describe(&e);
        expect_err(
            &mut e,
            "setSpeedKeys",
            json!({"id": c, "keys": [{"t_s": 0.0, "speed": 0.1}, {"t_s": 2.0, "speed": 0.1}]}),
        );
        assert_eq!(describe(&e), before);
        // rippleDelete removes it and closes the gap: c2 (at 12) shifts left
        // by the deleted footprint 4·ln(3/2) ≈ 1.6219.
        let gap = 12.0 - 10.0 - secs;
        apply(&mut e, "rippleDelete", json!({"id": c})).unwrap();
        assert_eq!(clip_json(&mut e, 0, 0)["id"], c2);
        assert!((clip_json(&mut e, 0, 0)["timeline_start_s"].as_f64().unwrap() - (12.0 - secs)).abs() < 1e-6);
        assert!(gap > 0.0);
    }

    #[test]
    fn speed_keys_roll_slip_slide_ripple_trim() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        // Two touching clips: keyed left (0..4 media, ramp 1→2, footprint
        // 4ln2 ≈ 2.7726), constant right.
        let l = keyed_clip(&mut e, sid, tid);
        let l_end = 4.0 * 2.0f64.ln();
        let r = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 5.0, "out_s": 7.0, "start_s": l_end}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // rollEdit +0.25: left tail extends by media 0.25 timeline-s cost at
        // its tail speed (2.0 held past the last key) → out_s += 0.5.
        apply(&mut e, "rollEdit", json!({"left": l, "right": r, "delta_s": 0.25})).unwrap();
        let lj = clip_json(&mut e, 0, 0);
        assert!((lj["out_s"].as_f64().unwrap() - 4.5).abs() < 1e-6);
        let rj = clip_json(&mut e, 0, 1);
        assert!((rj["in_s"].as_f64().unwrap() - 5.25).abs() < 1e-6);
        assert!((rj["timeline_start_s"].as_f64().unwrap() - (l_end + 0.25)).abs() < 1e-6);
        // slipClip on the keyed clip must preserve footprint: reject.
        let before = describe(&e);
        let err = expect_err(&mut e, "slipClip", json!({"id": l, "delta_s": 0.5}));
        assert_eq!(err.code, ErrorCode::Validation);
        assert_eq!(describe(&e), before);
        // rippleTrim tail +0.5 on the keyed clip: the tail speed is the held
        // last-key value 2.0, so out_s += 0.5 * 2.0 = 1.0 → 5.5.
        apply(&mut e, "rippleTrim", json!({"id": l, "edge": "tail", "delta_s": 0.5})).unwrap();
        let lj = clip_json(&mut e, 0, 0);
        assert!((lj["out_s"].as_f64().unwrap() - 5.5).abs() < 1e-6);
        // slideClip on the constant right clip adjusts the keyed left tail:
        // it gives back 0.25 timeline-s at tail speed 2.0 → out_s -= 0.5.
        apply(&mut e, "slideClip", json!({"id": r, "delta_s": -0.25})).unwrap();
        let lj = clip_json(&mut e, 0, 0);
        assert!((lj["out_s"].as_f64().unwrap() - 5.0).abs() < 1e-6);
    }

    #[test]
    fn speed_keys_undo_redo_snapshot_hostile_restore() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = keyed_clip(&mut e, sid, tid);
        assert!(e.undo().unwrap()); // undo setSpeedKeys
        assert!(clip_json(&mut e, 0, 0).get("speed_keys").is_none());
        assert!(e.redo().unwrap());
        assert_eq!(clip_json(&mut e, 0, 0)["speed_keys"].as_array().unwrap().len(), 2);
        // Snapshot round-trips the curve.
        let snap = e.snapshot().unwrap();
        let mut e2 = eng();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&e2), describe(&e));
        // Hostile restores: each broken speed_keys shape is rejected and the
        // live document is untouched.
        let good = describe(&e);
        let breakers: Vec<(&str, Value)> = vec![
            ("unsorted keys", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["speed_keys"] = json!([
                    {"t_s": 4.0, "speed": 2.0},
                    {"t_s": 0.0, "speed": 1.0},
                ]);
                d
            }),
            ("duplicate t_s", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["speed_keys"] = json!([
                    {"t_s": 1.0, "speed": 1.0},
                    {"t_s": 1.0, "speed": 2.0},
                ]);
                d
            }),
            ("speed out of range", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["speed_keys"] = json!([{"t_s": 0.0, "speed": 42.0}]);
                d
            }),
            ("negative t_s", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["speed_keys"] = json!([{"t_s": -0.5, "speed": 1.0}]);
                d
            }),
            ("too many keys", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["speed_keys"] = json!(
                    (0..300).map(|i| json!({"t_s": i as f64, "speed": 1.0})).collect::<Vec<_>>()
                );
                d
            }),
            ("missing speed", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["speed_keys"] = json!([{"t_s": 0.0}]);
                d
            }),
        ];
        for (what, doc) in breakers {
            let bytes = encode_envelope(&serde_json::to_vec(&doc).unwrap());
            assert!(e.restore(&bytes).is_err(), "{what} was accepted");
            assert_eq!(describe(&e), good, "{what}");
        }
        // A legacy clip payload without speed_keys still restores.
        let mut legacy = good.clone();
        legacy["tracks"][0]["clips"][0].as_object_mut().unwrap().remove("speed_keys");
        e.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
            .unwrap();
        let _ = c;
    }

    #[test]
    fn speed_keys_add_clip_batch_and_transition() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        // addClip accepts speed_keys directly.
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0,
                   "speed_keys": [{"t_s": 0.0, "speed": 2.0}, {"t_s": 4.0, "speed": 2.0}]}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // Constant 2x via keys: footprint exactly 2 s.
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            2.0
        );
        // batch carries setSpeedKeys as one undo step.
        apply(
            &mut e,
            "batch",
            json!({"ops": [
                {"op": "setSpeedKeys", "payload": {"id": c, "keys": [{"t_s": 0.0, "speed": 1.0}]}},
                {"op": "addMarker", "payload": {"time_s": 1.0}},
            ]}),
        )
        .unwrap();
        assert_eq!(clip_json(&mut e, 0, 0)["speed_keys"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(clip_json(&mut e, 0, 0)["speed_keys"].as_array().unwrap().len(), 2);
        // Transitions still validate against keyed clips: two keyed clips
        // touching with enough handle.
        let l2 = keyed_clip(&mut e, sid, tid);
        // l2 starts at track end; add a keyed right neighbour touching it.
        let plan = apply(&mut e, "renderPlan", json!({})).unwrap();
        let l2_end = plan["tracks"][0]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["clip_id"] == l2)
            .unwrap()["timeline_end_s"]
            .as_f64()
            .unwrap();
        let r2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 5.0, "out_s": 7.0, "start_s": l2_end,
                   "speed_keys": [{"t_s": 5.0, "speed": 1.0}, {"t_s": 7.0, "speed": 1.0}]}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addTransition",
            json!({"left": l2, "right": r2, "kind": "cross_dissolve", "duration_s": 1.0}),
        )
        .unwrap();
    }

    // ---- per-clip mix (gain_db / pan) --------------------------------------

    #[test]
    fn clip_mix_defaults_are_legacy_bytes() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap();
        // Neutral mix fields are skipped entirely: the clip serializes
        // exactly as it did before the fields existed.
        let clip = clip_json(&mut e, 0, 0);
        assert!(clip.get("gain_db").is_none());
        assert!(clip.get("pan").is_none());
        let snap = e.snapshot().unwrap();
        let payload = decode_envelope(&snap).unwrap().1;
        let raw = String::from_utf8(payload.to_vec()).unwrap();
        assert!(!raw.contains("gain_db") && !raw.contains("\"pan\""), "{raw}");
    }

    #[test]
    fn set_clip_mix_patch_bounds_and_noop() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        let before = describe(&e);
        for bad in [
            json!({"id": c}),                                  // nothing to set
            json!({"id": c, "gain_db": "loud"}),               // wrong type
            json!({"id": c, "gain_db": 13.0}),                 // above +12 dB
            json!({"id": c, "gain_db": -61.0}),                // below -60 dB
            json!({"id": c, "gain_db": 1e300}),                // not finite-range
            json!({"id": c, "pan": 1.5}),
            json!({"id": c, "pan": -1.5}),
            json!({"id": 999, "gain_db": 0.0}),
        ] {
            expect_err(&mut e, "setClipMix", bad);
            assert_eq!(describe(&e), before);
        }
        // Partial patch: gain only, then pan only; the other field keeps its
        // value (and its serde-skipped neutral state).
        apply(&mut e, "setClipMix", json!({"id": c, "gain_db": -6.0})).unwrap();
        let clip = clip_json(&mut e, 0, 0);
        assert_eq!(clip["gain_db"], -6.0);
        assert!(clip.get("pan").is_none());
        apply(&mut e, "setClipMix", json!({"id": c, "pan": 0.5})).unwrap();
        let clip = clip_json(&mut e, 0, 0);
        assert_eq!(clip["gain_db"], -6.0);
        assert_eq!(clip["pan"], 0.5);
        // renderPlan exposes both for a future mixer.
        let plan = apply(&mut e, "renderPlan", json!({})).unwrap();
        let pc = &plan["tracks"][0][0];
        assert_eq!(pc["gain_db"], -6.0);
        assert_eq!(pc["pan"], 0.5);
        // Identical write is an eventless read-only result recording no undo.
        let r = apply_full(
            &mut e,
            "setClipMix",
            json!({"id": c, "gain_db": -6.0, "pan": 0.5}),
        )
        .unwrap();
        assert!(r.events.is_empty());
        assert_eq!(r.data["changed"], false);
        // One undo reverts the whole mix (the two setClipMix ops are two
        // entries; the second undo reaches the first).
        assert!(e.undo().unwrap());
        let clip = clip_json(&mut e, 0, 0);
        assert_eq!(clip["gain_db"], -6.0);
        assert!(clip.get("pan").is_none());
        assert!(e.undo().unwrap());
        assert!(clip_json(&mut e, 0, 0).get("gain_db").is_none());
        assert!(e.undo().unwrap()); // addClip
        assert!(e.undo().unwrap()); // addTrack
        assert!(e.undo().unwrap()); // addSource
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn clip_mix_survives_structural_ops() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 8.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "setClipMix",
            json!({"id": c, "gain_db": -3.0, "pan": -1.0}),
        )
        .unwrap();
        // splitClip: both halves inherit the mix.
        apply(&mut e, "splitClip", json!({"id": c, "at_s": 4.0})).unwrap();
        for i in 0..2 {
            let clip = clip_json(&mut e, 0, i);
            assert_eq!(clip["gain_db"], -3.0, "half {i}");
            assert_eq!(clip["pan"], -1.0, "half {i}");
        }
        // insert placement splitting a straddling clip keeps mix on both
        // pieces (split_at is shared).
        let other = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0, "start_s": 20.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "setClipMix",
            json!({"id": other, "gain_db": 6.0, "pan": 1.0}),
        )
        .unwrap();
        // Default mode rejects the overlap; overwrite splits the straddling
        // clip and both surviving halves keep the mix.
        let before = describe(&e);
        expect_err(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0, "start_s": 21.0}),
        );
        assert_eq!(describe(&e), before);
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0,
                   "start_s": 21.0, "mode": "overwrite"}),
        )
        .unwrap();
        // other (20..24) was split at 21 and 23: three pieces — head 20..21,
        // tail 23..24 — both must carry gain 6 / pan 1.
        let clips = apply(&mut e, "timeline", json!({})).unwrap()["tracks"][0]["clips"]
            .as_array()
            .unwrap()
            .clone();
        let pieces: Vec<&Value> = clips
            .iter()
            .filter(|c| c["gain_db"] == 6.0)
            .collect();
        assert_eq!(pieces.len(), 2, "{clips:?}");
        for p in &pieces {
            assert_eq!(p["pan"], 1.0);
        }
        // moveClip / trimClip / rippleDelete keep mix on surviving clips.
        // The moved head lands at 30 s, last in time order.
        let head = pieces[0]["id"].as_u64().unwrap();
        apply(&mut e, "moveClip", json!({"id": head, "start_s": 30.0})).unwrap();
        let n = apply(&mut e, "timeline", json!({})).unwrap()["tracks"][0]["clips"]
            .as_array()
            .unwrap()
            .len();
        assert_eq!(clip_json(&mut e, 0, n - 1)["gain_db"], 6.0);
        apply(&mut e, "trimClip", json!({"id": head, "out_s": 0.5})).unwrap();
        assert_eq!(clip_json(&mut e, 0, n - 1)["gain_db"], 6.0);
        apply(&mut e, "rippleDelete", json!({"id": head})).unwrap();
        // The remaining piece still carries its mix.
        let clips = apply(&mut e, "timeline", json!({})).unwrap()["tracks"][0]["clips"]
            .as_array()
            .unwrap()
            .clone();
        let tail = clips.iter().find(|c| c["pan"] == 1.0).unwrap();
        assert_eq!(tail["gain_db"], 6.0);
    }

    #[test]
    fn clip_mix_undo_snapshot_and_hostile_restore() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setClipMix", json!({"id": c, "gain_db": -12.0, "pan": 1.0})).unwrap();
        // Snapshot round-trip preserves the mix.
        let snap = e.snapshot().unwrap();
        let mut e2 = eng();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&e2), describe(&e));
        // Hostile restores: out-of-range mix values are rejected and the live
        // document is untouched.
        let good = describe(&e);
        let breakers: Vec<(&str, Value)> = vec![
            ("gain_db above range", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["gain_db"] = json!(12.5);
                d
            }),
            ("gain_db below range", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["gain_db"] = json!(-60.5);
                d
            }),
            ("gain_db non-numeric", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["gain_db"] = json!("loud");
                d
            }),
            ("pan above range", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["pan"] = json!(1.0001);
                d
            }),
            ("pan below range", {
                let mut d = good.clone();
                d["tracks"][0]["clips"][0]["pan"] = json!(-2.0);
                d
            }),
        ];
        for (what, doc) in breakers {
            let bytes = encode_envelope(&serde_json::to_vec(&doc).unwrap());
            assert!(e.restore(&bytes).is_err(), "{what} was accepted");
            assert_eq!(describe(&e), good, "{what}");
        }
        // Boundary values restore fine; a legacy clip without the fields
        // restores to neutral mix.
        let mut edge = good.clone();
        edge["tracks"][0]["clips"][0]["gain_db"] = json!(12.0);
        edge["tracks"][0]["clips"][0]["pan"] = json!(-1.0);
        e.restore(&encode_envelope(&serde_json::to_vec(&edge).unwrap())).unwrap();
        let mut legacy = good.clone();
        let clip = legacy["tracks"][0]["clips"][0].as_object_mut().unwrap();
        clip.remove("gain_db");
        clip.remove("pan");
        e.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
            .unwrap();
        assert!(clip_json(&mut e, 0, 0).get("gain_db").is_none());
        assert!(clip_json(&mut e, 0, 0).get("pan").is_none());
    }

    #[test]
    fn ids_monotonic_across_ops() {
        let mut e = eng();
        let (sid, _) = setup(&mut e);
        let s2 = apply(&mut e, "addSource", json!({"duration_s": 1.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert!(s2 > sid);
        // undo returns to prior next_id per spec ("restore of prior value")
        assert!(e.undo().unwrap());
        let s3 = apply(&mut e, "addSource", json!({"duration_s": 1.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert_eq!(s3, s2);
    }
}
