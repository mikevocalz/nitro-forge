//! Brush/stroke pipeline for Prism (P06 slice, per
//! `docs/completion/reports/P-prism-brush-ink-decision.md`).
//!
//! Three stages, all pure deterministic computation — no I/O, no clock:
//!
//! 1. **Stroke modeling** (`model_segments`): a batch reimplementation of the
//!    google/ink-stroke-modeler pipeline structure — wobble smoothing
//!    (time-windowed weighted moving average blended by speed), position
//!    modeling (pen tip as a mass on a damped spring dragged by a corrected
//!    anchor), stylus-state interpolation (project the modeled tip onto the
//!    raw input polyline and interpolate pressure/tilt/orientation), and
//!    end-of-stroke settling. Implemented from the published algorithm
//!    structure of `ink_stroke_modeler` (Apache-2.0, pinned-commit behavioral
//!    reference — no code was copied; see the decision record). Loop
//!    contraction mitigation and the Kalman predictor are NOT implemented;
//!    `predict` is a simple damped velocity lookahead instead.
//! 2. **Brush model** (`Brush`): document-level presets — size, opacity,
//!    flow, spacing, hardness, color — plus dynamics coefficients mapping
//!    normalized pressure/velocity/tilt to size/opacity/flow multipliers,
//!    and a taper envelope over stroke arc length.
//! 3. **Dab generation** (`generate_dabs`): dabs placed along each modeled
//!    segment at `spacing * size` intervals, parameters resolved per dab,
//!    then stamped through `raster::blend_pixel` src-over coverage.
//!
//! Budgets (decision record §5): ≤ [`MAX_SAMPLES`] input samples per op,
//! ≤ [`MAX_BRUSHES`] brushes per document, ≤ [`MAX_DABS`] dabs per stroke,
//! ≤ [`MAX_MODEL_OUTPUTS`] modeled points per stroke, and ≤
//! [`MAX_STROKE_PIXELS`] dab-stamp pixel visits per `paintStroke`. All
//! validation happens before any mutation, keeping `apply` atomic.

use std::collections::VecDeque;

use ignition_core::{EngineError, TaskContext};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::model::MAX_COORD;
use crate::raster;
use crate::{RenderTask, CHECKPOINT_EVERY_PX};

// -- budgets ---------------------------------------------------------------

/// Input samples per `modelStroke`/`paintStroke` call (decision §5).
pub const MAX_SAMPLES: usize = 4096;
/// Brushes per document (decision §5).
pub const MAX_BRUSHES: usize = 64;
/// Dabs per stroke commit (decision §5).
pub const MAX_DABS: usize = 262_144;
/// Modeled output points per stroke; upsampling cannot exceed this.
pub const MAX_MODEL_OUTPUTS: usize = 32768;
/// Lookahead points `predict` may emit.
pub const MAX_PREDICT_STEPS: u32 = 64;
/// Total dab-stamp pixel visits allowed per `paintStroke` — the same
/// ceiling as the canvas pixel budget (`MAX_PIXELS` in lib.rs). A dab's
/// clipped bounding box is the unit: overlapping dabs count once per visit,
/// so a dense stroke over the whole canvas can exceed it. Enforced by
/// [`stamp_pixel_work`] before any mutation; see docs/ENGINE_OPS.md.
pub const MAX_STROKE_PIXELS: u64 = crate::MAX_PIXELS;

// -- small vec math ---------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
struct V2 {
    x: f64,
    y: f64,
}

impl V2 {
    fn add(self, o: V2) -> V2 {
        V2 { x: self.x + o.x, y: self.y + o.y }
    }
    fn sub(self, o: V2) -> V2 {
        V2 { x: self.x - o.x, y: self.y - o.y }
    }
    fn scale(self, s: f64) -> V2 {
        V2 { x: self.x * s, y: self.y * s }
    }
    fn dot(self, o: V2) -> f64 {
        self.x * o.x + self.y * o.y
    }
    fn mag(self) -> f64 {
        self.x.hypot(self.y)
    }
    fn dist(self, o: V2) -> f64 {
        self.sub(o).mag()
    }
    fn lerp(self, o: V2, t: f64) -> V2 {
        self.add(o.sub(self).scale(t))
    }
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// `start + (end - start) * clamp01(amount)` — same as ink's `Interp`.
fn interp_f64(start: f64, end: f64, amount: f64) -> f64 {
    start + (end - start) * clamp01(amount)
}

/// Ratio of `(value - start)` to `(end - start)` clamped to [0,1]; 1 when
/// `value > start` and `start == end`, else 0 — same as ink's `Normalize01`.
fn normalize01(start: f64, end: f64, value: f64) -> f64 {
    if start == end {
        return if value > start { 1.0 } else { 0.0 };
    }
    clamp01((value - start) / (end - start))
}

/// Ratio of the projection of `point - a` onto `b - a` — ink's
/// `NearestPointOnSegment`, clamped to the segment.
fn nearest_point_on_segment(a: V2, b: V2, point: V2) -> f64 {
    let seg = b.sub(a);
    let d = seg.dot(seg);
    if d == 0.0 {
        return 0.0;
    }
    clamp01(point.sub(a).dot(seg) / d)
}

/// Angular lerp around the shorter arc, normalized to [0, 2π) — ink's
/// `InterpAngle`.
fn interp_angle(start: f64, end: f64, amount: f64) -> f64 {
    const TWO_PI: f64 = std::f64::consts::TAU;
    // `rem_euclid` is O(1) and total for any finite input — a `while`
    // subtract loop here would hang on hostile angles (e.g. an
    // `orientation` of 1e10 passed straight to `model_stroke`).
    let norm = |a: f64| a.rem_euclid(TWO_PI);
    let (mut s, mut e) = (norm(start), norm(end));
    let delta = e - s;
    if delta < -std::f64::consts::PI {
        e += TWO_PI;
    } else if delta > std::f64::consts::PI {
        e -= TWO_PI;
    }
    s = norm(s);
    norm(interp_f64(s, e, amount))
}

// -- input samples ----------------------------------------------------------

/// One raw stylus sample. `t` is **seconds** (f64); `x`/`y` are canvas
/// pixels. `pressure`/`tilt`/`orientation` are optional — absent or negative
/// values model as "unknown" (-1), mirroring ink's convention. `contact`
/// defaults to true; `false` ends the current stroke segment (pen lift).
#[derive(Debug, Clone, PartialEq)]
pub struct StrokeSample {
    pub t: f64,
    pub x: f64,
    pub y: f64,
    /// -1 = unknown.
    pub pressure: f64,
    /// -1 = unknown; radians when known, normalized to [0, 2π) by
    /// [`parse_samples`].
    pub tilt: f64,
    /// -1 = unknown; radians when known, normalized to [0, 2π) by
    /// [`parse_samples`].
    pub orientation: f64,
    pub contact: bool,
}

#[derive(Deserialize)]
struct SampleWire {
    t: f64,
    x: f64,
    y: f64,
    #[serde(default)]
    pressure: Option<f64>,
    #[serde(default)]
    tilt: Option<f64>,
    #[serde(default)]
    orientation: Option<f64>,
    #[serde(default)]
    contact: Option<bool>,
}

fn opt_state(v: Option<f64>, what: &str) -> Result<f64, EngineError> {
    match v {
        None => Ok(-1.0),
        Some(x) if x.is_finite() && x >= 0.0 => Ok(x),
        Some(_) => Err(EngineError::validation(format!(
            "sample {what} must be a finite number >= 0"
        ))),
    }
}

/// Stylus angles (`tilt`, `orientation`): same domain as [`opt_state`],
/// then wrapped into `[0, 2π)`. `orientation` is periodic so the wrap is
/// lossless; `tilt` is normalized over π/2 downstream and saturates anyway,
/// so bounding it here only rejects meaningless magnitudes. Either way the
/// modeler never sees an unbounded angle — defense in depth behind the
/// O(1) `rem_euclid` in [`interp_angle`].
fn opt_angle(v: Option<f64>, what: &str) -> Result<f64, EngineError> {
    match opt_state(v, what)? {
        x if x < 0.0 => Ok(x),
        x => Ok(x.rem_euclid(std::f64::consts::TAU)),
    }
}

/// Parse and validate the `samples` array. Enforces ≤ [`MAX_SAMPLES`],
/// finite coordinates within [`MAX_COORD`], non-decreasing `t`, and sane
/// stylus-state ranges. Fully validated before any modeling happens.
pub fn parse_samples(v: Option<&Value>) -> Result<Vec<StrokeSample>, EngineError> {
    let arr = v
        .and_then(Value::as_array)
        .ok_or_else(|| EngineError::invalid("field 'samples' must be an array"))?;
    if arr.is_empty() {
        return Err(EngineError::validation("samples must not be empty"));
    }
    if arr.len() > MAX_SAMPLES {
        return Err(EngineError::validation(format!(
            "samples exceeds the {MAX_SAMPLES} per-op budget"
        )));
    }
    let mut out = Vec::with_capacity(arr.len());
    let mut prev_t = f64::NEG_INFINITY;
    for (i, item) in arr.iter().enumerate() {
        let w: SampleWire = serde_json::from_value(item.clone()).map_err(|_| {
            EngineError::invalid(format!("sample {i} is not a valid sample object"))
        })?;
        if !w.t.is_finite() || w.t < 0.0 {
            return Err(EngineError::validation(format!(
                "sample {i} t must be a finite number >= 0 seconds"
            )));
        }
        if w.t < prev_t {
            return Err(EngineError::validation(format!(
                "sample {i} t goes backwards in time"
            )));
        }
        prev_t = w.t;
        if !w.x.is_finite() || !w.y.is_finite() || w.x.abs() > MAX_COORD || w.y.abs() > MAX_COORD {
            return Err(EngineError::validation(format!(
                "sample {i} x/y must be finite within ±{MAX_COORD}"
            )));
        }
        out.push(StrokeSample {
            t: w.t,
            x: w.x,
            y: w.y,
            pressure: opt_state(w.pressure, "pressure").map_err(|_| {
                EngineError::validation(format!("sample {i} pressure must be finite >= 0"))
            })?,
            tilt: opt_angle(w.tilt, "tilt")?,
            orientation: opt_angle(w.orientation, "orientation")?,
            contact: w.contact.unwrap_or(true),
        });
    }
    Ok(out)
}

// -- model parameters -------------------------------------------------------

/// Tunable stroke-model parameters. Defaults follow the ink-stroke-modeler
/// README tuning for px/second inputs; every field may be overridden per op.
#[derive(Debug, Clone, PartialEq)]
pub struct StrokeParams {
    /// Wobble smoothing enabled.
    pub smoothing: bool,
    /// Wobble averaging window, seconds.
    pub smoothing_timeout: f64,
    /// Speed (px/s) at/below which full smoothing applies.
    pub smoothing_speed_floor: f64,
    /// Speed (px/s) at/above which no smoothing applies.
    pub smoothing_speed_ceiling: f64,
    /// Minimum modeled output rate, outputs per second.
    pub min_output_rate: f64,
    /// Pen-tip mass / spring constant (s²).
    pub spring_mass_constant: f64,
    /// Velocity drag ratio (1/s).
    pub drag_constant: f64,
    /// End-of-stroke settling stop distance, px.
    pub end_of_stroke_stopping_distance: f64,
    /// End-of-stroke settling iteration cap.
    pub end_of_stroke_max_iterations: u32,
}

impl Default for StrokeParams {
    fn default() -> Self {
        StrokeParams {
            smoothing: true,
            smoothing_timeout: 0.04,
            smoothing_speed_floor: 2.0,
            smoothing_speed_ceiling: 30.0,
            min_output_rate: 240.0,
            spring_mass_constant: 11.0 / 32400.0,
            drag_constant: 72.0,
            end_of_stroke_stopping_distance: 0.01,
            end_of_stroke_max_iterations: 20,
        }
    }
}

#[derive(Deserialize)]
struct ParamsWire {
    #[serde(default)]
    smoothing: Option<bool>,
    #[serde(default)]
    smoothing_timeout: Option<f64>,
    #[serde(default)]
    smoothing_speed_floor: Option<f64>,
    #[serde(default)]
    smoothing_speed_ceiling: Option<f64>,
    #[serde(default)]
    min_output_rate: Option<f64>,
    #[serde(default)]
    spring_mass_constant: Option<f64>,
    #[serde(default)]
    drag_constant: Option<f64>,
    #[serde(default)]
    end_of_stroke_stopping_distance: Option<f64>,
    #[serde(default)]
    end_of_stroke_max_iterations: Option<u32>,
}

/// `params` is optional; present fields override [`StrokeParams::default`].
pub fn parse_params(v: Option<&Value>) -> Result<StrokeParams, EngineError> {
    let mut p = StrokeParams::default();
    let Some(v) = v else { return Ok(p) };
    let w: ParamsWire = serde_json::from_value(v.clone())
        .map_err(|_| EngineError::invalid("field 'params' is not a valid params object"))?;
    if let Some(b) = w.smoothing {
        p.smoothing = b;
    }
    macro_rules! pos {
        ($name:literal, $val:expr, $lo:expr, $hi:expr, $field:ident) => {
            if let Some(x) = $val {
                if !x.is_finite() || x < $lo || x > $hi {
                    return Err(EngineError::validation(format!(
                        "params.{} must be within {}..={}",
                        $name, $lo, $hi
                    )));
                }
                p.$field = x;
            }
        };
    }
    pos!("smoothing_timeout", w.smoothing_timeout, 0.0, 10.0, smoothing_timeout);
    pos!("smoothing_speed_floor", w.smoothing_speed_floor, 0.0, 1.0e6, smoothing_speed_floor);
    pos!("smoothing_speed_ceiling", w.smoothing_speed_ceiling, 0.0, 1.0e6, smoothing_speed_ceiling);
    if p.smoothing_speed_floor > p.smoothing_speed_ceiling {
        return Err(EngineError::validation(
            "params.smoothing_speed_floor must be <= smoothing_speed_ceiling",
        ));
    }
    pos!("min_output_rate", w.min_output_rate, 1.0, 100_000.0, min_output_rate);
    pos!("spring_mass_constant", w.spring_mass_constant, 1.0e-9, 1.0e6, spring_mass_constant);
    pos!("drag_constant", w.drag_constant, 0.0, 1.0e6, drag_constant);
    pos!("end_of_stroke_stopping_distance", w.end_of_stroke_stopping_distance, 1.0e-6, MAX_COORD, end_of_stroke_stopping_distance);
    if let Some(n) = w.end_of_stroke_max_iterations {
        if n == 0 || n > 10_000 {
            return Err(EngineError::validation(
                "params.end_of_stroke_max_iterations must be in 1..=10000",
            ));
        }
        p.end_of_stroke_max_iterations = n;
    }
    Ok(p)
}

// -- modeled output ---------------------------------------------------------

/// One modeled stroke point. Stylus fields are `None` when unknown.
#[derive(Debug, Clone, PartialEq)]
pub struct ModeledPoint {
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub pressure: Option<f64>,
    pub tilt: Option<f64>,
    pub orientation: Option<f64>,
    /// Index of the contact segment this point belongs to.
    pub segment: usize,
    /// Modeled tip speed, px/s.
    pub speed: f64,
}

impl ModeledPoint {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "t": self.t,
            "x": self.x,
            "y": self.y,
            "pressure": self.pressure,
            "tilt": self.tilt,
            "orientation": self.orientation,
            "segment": self.segment,
            "speed": self.speed,
        })
    }
}

// -- stage 1: wobble smoother ------------------------------------------------

struct WobbleSample {
    position: V2,
    /// position * duration of the segment that produced it.
    weighted_position: V2,
    distance: f64,
    duration: f64,
    time: f64,
}

/// Time-windowed weighted moving average blended toward the raw position by
/// speed — ink's `WobbleSmoother`, batch form.
struct WobbleSmoother {
    enabled: bool,
    timeout: f64,
    speed_floor: f64,
    speed_ceiling: f64,
    samples: VecDeque<WobbleSample>,
    weighted_position_sum: V2,
    distance_sum: f64,
    duration_sum: f64,
}

impl WobbleSmoother {
    fn new(params: &StrokeParams, position: V2, time: f64) -> Self {
        let mut s = WobbleSmoother {
            enabled: params.smoothing,
            timeout: params.smoothing_timeout,
            speed_floor: params.smoothing_speed_floor,
            speed_ceiling: params.smoothing_speed_ceiling,
            samples: VecDeque::new(),
            weighted_position_sum: V2 { x: 0.0, y: 0.0 },
            distance_sum: 0.0,
            duration_sum: 0.0,
        };
        s.samples.push_back(WobbleSample {
            position,
            weighted_position: position.scale(0.0),
            distance: 0.0,
            duration: 0.0,
            time,
        });
        s
    }

    fn update(&mut self, position: V2, time: f64) -> V2 {
        if !self.enabled {
            return position;
        }
        let dt = time - self.samples.back().map(|s| s.time).unwrap_or(time);
        let prev_pos = self.samples.back().map(|s| s.position).unwrap_or(position);
        let sample = WobbleSample {
            position,
            weighted_position: position.scale(dt),
            distance: position.dist(prev_pos),
            duration: dt,
            time,
        };
        self.weighted_position_sum =
            self.weighted_position_sum.add(sample.weighted_position);
        self.distance_sum += sample.distance;
        self.duration_sum += sample.duration;
        self.samples.push_back(sample);
        let cutoff = time - self.timeout;
        while self
            .samples
            .front()
            .is_some_and(|s| s.time < cutoff)
        {
            let front = self.samples.pop_front().unwrap();
            self.weighted_position_sum =
                self.weighted_position_sum.sub(front.weighted_position);
            self.distance_sum -= front.distance;
            self.duration_sum -= front.duration;
        }
        if self.duration_sum <= 0.0 {
            return position;
        }
        let avg_position = self.weighted_position_sum.scale(1.0 / self.duration_sum);
        let avg_speed = self.distance_sum / self.duration_sum;
        let t = normalize01(self.speed_floor, self.speed_ceiling, avg_speed);
        avg_position.lerp(position, t)
    }
}

// -- stage 2: position modeler (damped spring) -------------------------------

#[derive(Clone, Copy)]
struct TipState {
    position: V2,
    velocity: V2,
    acceleration: V2,
    time: f64,
}

struct PositionModeler {
    spring_mass_constant: f64,
    drag_constant: f64,
    state: TipState,
}

impl PositionModeler {
    fn new(position: V2, time: f64, params: &StrokeParams) -> Self {
        PositionModeler {
            spring_mass_constant: params.spring_mass_constant,
            drag_constant: params.drag_constant,
            state: TipState {
                position,
                velocity: V2 { x: 0.0, y: 0.0 },
                acceleration: V2 { x: 0.0, y: 0.0 },
                time,
            },
        }
    }

    /// `accel = (anchor - pos)/mc - drag·vel`; semi-implicit Euler step —
    /// ink's `PositionModeler::Update`.
    fn update(&mut self, anchor: V2, time: f64) -> TipState {
        let dt = time - self.state.time;
        let accel = anchor
            .sub(self.state.position)
            .scale(1.0 / self.spring_mass_constant)
            .sub(self.state.velocity.scale(self.drag_constant));
        self.state.acceleration = accel;
        self.state.velocity = self.state.velocity.add(accel.scale(dt));
        self.state.position = self.state.position.add(self.state.velocity.scale(dt));
        self.state.time = time;
        self.state
    }

    /// Outputs per gap between inputs: `ceil(dt * min_output_rate)` — ink's
    /// `NumberOfStepsBetweenInputs` (angle-based upsampling not implemented).
    fn steps_between(&self, start_t: f64, end_t: f64, min_output_rate: f64) -> usize {
        ((end_t - start_t) * min_output_rate).ceil().max(0.0) as usize
    }

    /// Linear anchor interpolation, `i/n` for i in 1..=n — ink's
    /// `UpdateAlongLinearPath`.
    fn update_along_linear_path(
        &mut self,
        start_anchor: V2,
        start_time: f64,
        end_anchor: V2,
        end_time: f64,
        n: usize,
        out: &mut Vec<TipState>,
    ) {
        for i in 1..=n {
            let f = i as f64 / n as f64;
            let anchor = start_anchor.lerp(end_anchor, f);
            let t = interp_f64(start_time, end_time, f);
            out.push(self.update(anchor, t));
        }
    }

    /// Settle onto the final anchor with shrinking steps — ink's
    /// `ModelEndOfStroke`.
    fn model_end_of_stroke(
        &mut self,
        anchor: V2,
        delta_time: f64,
        max_iterations: u32,
        stop_distance: f64,
        out: &mut Vec<TipState>,
    ) {
        let mut dt = delta_time;
        for _ in 0..max_iterations {
            let previous = self.state;
            let candidate = self.update(anchor, previous.time + dt);
            if previous.position.dist(candidate.position) < stop_distance {
                return;
            }
            let t = nearest_point_on_segment(previous.position, candidate.position, anchor);
            if t < 1.0 {
                // Overshot the anchor: retry with a smaller step.
                dt *= 0.5;
                self.state = previous;
                continue;
            }
            out.push(candidate);
            if candidate.position.dist(anchor) < stop_distance {
                return;
            }
        }
    }
}

// -- stage 3: stylus state modeler -------------------------------------------

#[derive(Clone, Copy)]
struct StylusEntry {
    position: V2,
    pressure: f64,
    tilt: f64,
    orientation: f64,
}

/// Projects modeled tip positions onto the raw-input polyline and
/// interpolates pressure/tilt/orientation — ink's `StylusStateModeler`,
/// closest-point projection only (`use_stroke_normal_projection` not
/// implemented in v1).
struct StylusStateModeler {
    entries: VecDeque<StylusEntry>,
    /// No-backtrack projection cursor.
    segment_index: usize,
    ratio: f64,
}

impl StylusStateModeler {
    fn new() -> Self {
        StylusStateModeler {
            entries: VecDeque::new(),
            segment_index: 0,
            ratio: 0.0,
        }
    }

    fn update(&mut self, position: V2, _time: f64, s: &StrokeSample) {
        self.entries.push_back(StylusEntry {
            position,
            pressure: s.pressure,
            tilt: s.tilt,
            orientation: s.orientation,
        });
    }

    /// Closest-point projection with no backtracking (ink's
    /// `ProjectToClosestPoint`), then field interpolation between the two
    /// entries bracketing the projected segment.
    fn project(&mut self, tip: V2) -> (Option<f64>, Option<f64>, Option<f64>) {
        if self.entries.len() < 2 {
            let e = match self.entries.front() {
                Some(e) => *e,
                None => return (None, None, None),
            };
            return (
                (e.pressure >= 0.0).then_some(e.pressure),
                (e.tilt >= 0.0).then_some(e.tilt),
                (e.orientation >= 0.0).then_some(e.orientation),
            );
        }
        let n = self.entries.len();
        let mut best: Option<(usize, f64, f64)> = None; // (seg, ratio, dist)
        let mut min_dist = f64::INFINITY;
        for i in 0..n - 1 {
            let a = self.entries[i].position;
            let b = self.entries[i + 1].position;
            let r = nearest_point_on_segment(a, b, tip);
            // Ignore a projection that would backtrack.
            if i == self.segment_index && r < self.ratio {
                continue;
            }
            let d = tip.dist(a.lerp(b, r));
            if d <= min_dist {
                best = Some((i, r, d));
                min_dist = d;
            }
        }
        let Some((seg, ratio, _)) = best else {
            // Fall back to the previous projection point.
            let i = self.segment_index.min(n - 2);
            return self.interpolate_at(i, self.ratio);
        };
        self.segment_index = seg;
        self.ratio = ratio;
        // Discard segments the projection can no longer reach.
        while self.segment_index > 0 {
            self.segment_index -= 1;
            self.entries.pop_front();
        }
        self.interpolate_at(0, ratio)
    }

    /// Interpolate stylus fields between entries 0 and 1 at `ratio`.
    /// ink's `InterpResult`: a field interpolates only when present on BOTH
    /// endpoints, else it is unknown.
    fn interpolate_at(&self, i: usize, ratio: f64) -> (Option<f64>, Option<f64>, Option<f64>) {
        let (Some(a), Some(b)) = (self.entries.get(i), self.entries.get(i + 1)) else {
            let e = self.entries.front();
            return match e {
                Some(e) => (
                    (e.pressure >= 0.0).then_some(e.pressure),
                    (e.tilt >= 0.0).then_some(e.tilt),
                    (e.orientation >= 0.0).then_some(e.orientation),
                ),
                None => (None, None, None),
            };
        };
        let pressure = if a.pressure >= 0.0 && b.pressure >= 0.0 {
            Some(interp_f64(a.pressure, b.pressure, ratio))
        } else {
            None
        };
        let tilt = if a.tilt >= 0.0 && b.tilt >= 0.0 {
            Some(interp_f64(a.tilt, b.tilt, ratio))
        } else {
            None
        };
        let orientation = if a.orientation >= 0.0 && b.orientation >= 0.0 {
            Some(interp_angle(a.orientation, b.orientation, ratio))
        } else {
            None
        };
        (pressure, tilt, orientation)
    }
}

// -- stage 4: batch pipeline -------------------------------------------------

/// `predict` lookahead: emit `steps` points continuing the last modeled
/// velocity with exponential drag decay. NOT ink's Kalman predictor — a
/// simple deterministic lookahead for hosts that want a few points past the
/// last sample.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PredictSpec {
    pub steps: u32,
    /// Seconds between lookahead points; defaults to `1 / min_output_rate`.
    pub interval: Option<f64>,
}

/// Model all contact segments of `samples`.
///
/// Returns `(segments, predicted)`: one `Vec<ModeledPoint>` per contact run
/// (pen-down..pen-up), plus optional lookahead points extending the final
/// segment when `predict` is given.
///
/// Errors (`Validation`) when the modeled output would exceed
/// [`MAX_MODEL_OUTPUTS`] — hostile timestamps cannot allocate unboundedly.
pub fn model_stroke(
    samples: &[StrokeSample],
    params: &StrokeParams,
    predict: Option<PredictSpec>,
    ctx: Option<&TaskContext>,
) -> Result<(Vec<Vec<ModeledPoint>>, Vec<ModeledPoint>), EngineError> {
    // Split into contact runs.
    let mut runs: Vec<&[StrokeSample]> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    while i <= samples.len() {
        let in_contact = i < samples.len() && samples[i].contact;
        let prev_contact = i > 0 && samples[i - 1].contact;
        if in_contact != prev_contact || i == samples.len() {
            if prev_contact {
                runs.push(&samples[start..i]);
            }
            start = i;
        }
        i += 1;
    }

    let mut segments: Vec<Vec<ModeledPoint>> = Vec::with_capacity(runs.len());
    let mut predicted: Vec<ModeledPoint> = Vec::new();
    let mut total = 0usize;
    let task = RenderTask::new(ctx, samples.len() as u64);

    for (seg_idx, run) in runs.iter().enumerate() {
        let mut points = model_segment(run, seg_idx, params, &mut total)?;
        task.tick(seg_idx, 1, seg_idx as f32 / runs.len().max(1) as f32)?;
        // Lookahead only extends the final segment.
        if seg_idx + 1 == runs.len() {
            if let Some(spec) = predict {
                predicted = lookahead(&points, spec, params, &mut total)?;
            }
        }
        segments.push(std::mem::take(&mut points));
    }
    Ok((segments, predicted))
}

/// Model one contact run: down → moves → up, mirroring ink's
/// `ProcessDownEvent`/`ProcessMoveEvent`/`ProcessUpEvent`.
fn model_segment(
    run: &[StrokeSample],
    seg_idx: usize,
    params: &StrokeParams,
    total: &mut usize,
) -> Result<Vec<ModeledPoint>, EngineError> {
    let mut out: Vec<ModeledPoint> = Vec::new();
    let first = &run[0];
    let pos = |s: &StrokeSample| V2 { x: s.x, y: s.y };

    let mut wobble = WobbleSmoother::new(params, pos(first), first.t);
    let mut position = PositionModeler::new(pos(first), first.t, params);
    let mut stylus = StylusStateModeler::new();
    stylus.update(pos(first), first.t, first);

    // Down event: uncorrected position, raw stylus state.
    *total += 1;
    if *total > MAX_MODEL_OUTPUTS {
        return Err(too_long());
    }
    out.push(ModeledPoint {
        t: first.t,
        x: first.x,
        y: first.y,
        pressure: (first.pressure >= 0.0).then_some(first.pressure),
        tilt: (first.tilt >= 0.0).then_some(first.tilt),
        orientation: (first.orientation >= 0.0).then_some(first.orientation),
        segment: seg_idx,
        speed: 0.0,
    });

    let mut last_input_t = first.t;
    let mut last_corrected = pos(first);
    let n = run.len();
    for (k, s) in run.iter().enumerate().skip(1) {
        let is_up = k + 1 == n;
        if is_up {
            // Up event: raw (un-smoothed) position.
            stylus.update(pos(s), s.t, s);
            let steps = position.steps_between(last_input_t, s.t, params.min_output_rate);
            check_budget(*total, steps)?;
            let mut tips = Vec::with_capacity(steps);
            position.update_along_linear_path(
                last_corrected,
                last_input_t,
                pos(s),
                s.t,
                steps,
                &mut tips,
            );
            position.model_end_of_stroke(
                pos(s),
                1.0 / params.min_output_rate,
                params.end_of_stroke_max_iterations,
                params.end_of_stroke_stopping_distance,
                &mut tips,
            );
            emit_modeled(&mut out, &mut stylus, &tips, seg_idx, total)?;
        } else {
            // Move event: wobble-corrected anchor.
            let corrected = wobble.update(pos(s), s.t);
            stylus.update(corrected, s.t, s);
            let steps = position.steps_between(last_input_t, s.t, params.min_output_rate);
            check_budget(*total, steps)?;
            let mut tips = Vec::with_capacity(steps);
            position.update_along_linear_path(
                last_corrected,
                last_input_t,
                corrected,
                s.t,
                steps,
                &mut tips,
            );
            emit_modeled(&mut out, &mut stylus, &tips, seg_idx, total)?;
            last_corrected = corrected;
            last_input_t = s.t;
        }
    }
    Ok(out)
}

fn too_long() -> EngineError {
    EngineError::validation(format!(
        "modeled stroke exceeds the {MAX_MODEL_OUTPUTS} output budget"
    ))
}

fn check_budget(total: usize, steps: usize) -> Result<(), EngineError> {
    if total.saturating_add(steps) > MAX_MODEL_OUTPUTS {
        return Err(too_long());
    }
    Ok(())
}

/// Project each tip state onto the raw-input polyline and emit a modeled
/// point — ink's `ModelStylus` (loop-contraction mitigation not implemented;
/// its interpolation value is 1, i.e. unmitigated spring output).
fn emit_modeled(
    out: &mut Vec<ModeledPoint>,
    stylus: &mut StylusStateModeler,
    tips: &[TipState],
    seg_idx: usize,
    total: &mut usize,
) -> Result<(), EngineError> {
    for tip in tips {
        *total += 1;
        if *total > MAX_MODEL_OUTPUTS {
            return Err(too_long());
        }
        let (pressure, tilt, orientation) = stylus.project(tip.position);
        out.push(ModeledPoint {
            t: tip.time,
            x: tip.position.x,
            y: tip.position.y,
            pressure,
            tilt,
            orientation,
            segment: seg_idx,
            speed: tip.velocity.mag(),
        });
    }
    Ok(())
}

/// Velocity lookahead past the last modeled point of the final segment.
fn lookahead(
    points: &[ModeledPoint],
    spec: PredictSpec,
    params: &StrokeParams,
    total: &mut usize,
) -> Result<Vec<ModeledPoint>, EngineError> {
    let mut out = Vec::new();
    if spec.steps == 0 || points.is_empty() {
        return Ok(out);
    }
    if spec.steps > MAX_PREDICT_STEPS {
        return Err(EngineError::validation(format!(
            "predict.steps exceeds the {MAX_PREDICT_STEPS} cap"
        )));
    }
    let last = points.last().unwrap();
    // Recover velocity direction from the tail of the modeled path.
    let dir = if points.len() >= 2 {
        let prev = &points[points.len() - 2];
        let dt = (last.t - prev.t).max(1e-9);
        V2 {
            x: (last.x - prev.x) / dt,
            y: (last.y - prev.y) / dt,
        }
    } else {
        V2 { x: 0.0, y: 0.0 }
    };
    let h = spec
        .interval
        .unwrap_or(1.0 / params.min_output_rate)
        .max(1e-6);
    let mut vel = dir;
    let drag_decay = (1.0 - params.drag_constant * h).clamp(0.0, 1.0);
    let mut pos = V2 { x: last.x, y: last.y };
    let mut t = last.t;
    for _ in 0..spec.steps {
        *total += 1;
        if *total > MAX_MODEL_OUTPUTS {
            return Err(too_long());
        }
        pos = pos.add(vel.scale(h));
        vel = vel.scale(drag_decay);
        t += h;
        out.push(ModeledPoint {
            t,
            x: pos.x,
            y: pos.y,
            pressure: last.pressure,
            tilt: last.tilt,
            orientation: last.orientation,
            segment: last.segment,
            speed: vel.mag(),
        });
    }
    Ok(out)
}

/// Parse the optional `predict` field: `true`, a step count, or
/// `{steps?, interval?}`.
pub fn parse_predict(v: Option<&Value>) -> Result<Option<PredictSpec>, EngineError> {
    let Some(v) = v else { return Ok(None) };
    if v.is_boolean() {
        return Ok(if v.as_bool().unwrap() {
            Some(PredictSpec { steps: 8, interval: None })
        } else {
            None
        });
    }
    if let Some(n) = v.as_u64() {
        if n == 0 || n > MAX_PREDICT_STEPS as u64 {
            return Err(EngineError::validation(format!(
                "predict step count must be in 1..={MAX_PREDICT_STEPS}"
            )));
        }
        return Ok(Some(PredictSpec { steps: n as u32, interval: None }));
    }
    if let Some(obj) = v.as_object() {
        let steps = match obj.get("steps") {
            None => 8u32,
            Some(Value::Number(n)) => {
                let n = n.as_u64().ok_or_else(|| {
                    EngineError::invalid("predict.steps must be an integer")
                })?;
                if n == 0 || n > MAX_PREDICT_STEPS as u64 {
                    return Err(EngineError::validation(format!(
                        "predict.steps must be in 1..={MAX_PREDICT_STEPS}"
                    )));
                }
                n as u32
            }
            Some(_) => {
                return Err(EngineError::invalid("predict.steps must be an integer"))
            }
        };
        let interval = match obj.get("interval") {
            None | Some(Value::Null) => None,
            Some(Value::Number(n)) => {
                let f = n.as_f64().ok_or_else(|| {
                    EngineError::invalid("predict.interval must be a number")
                })?;
                if !f.is_finite() || f <= 0.0 || f > 60.0 {
                    return Err(EngineError::validation(
                        "predict.interval must be in (0, 60] seconds",
                    ));
                }
                Some(f)
            }
            Some(_) => {
                return Err(EngineError::invalid("predict.interval must be a number"))
            }
        };
        return Ok(Some(PredictSpec { steps, interval }));
    }
    Err(EngineError::invalid(
        "predict must be true, a step count, or {steps?, interval?}",
    ))
}

// -- stage 5: brush model ----------------------------------------------------

/// Dynamics coefficients mapping normalized inputs to parameter
/// multipliers. Each coefficient is in -1..=1; 0 disables that response.
/// Normalized inputs: pressure/tilt in 0..=1 (unknown → 0.5), velocity
/// saturating at `size * 10` px/s. Effective value =
/// `base * clamp(1 + Σ coef·(2·input − 1), 0.05, 8.0)` for size,
/// `clamp(…, 0, 2)` scaled into 0..=1 for opacity/flow.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BrushDynamics {
    #[serde(default)]
    pub size_pressure: f64,
    #[serde(default)]
    pub size_velocity: f64,
    #[serde(default)]
    pub size_tilt: f64,
    #[serde(default)]
    pub opacity_pressure: f64,
    #[serde(default)]
    pub opacity_velocity: f64,
    #[serde(default)]
    pub flow_pressure: f64,
    #[serde(default)]
    pub flow_velocity: f64,
}

impl Default for BrushDynamics {
    fn default() -> Self {
        BrushDynamics {
            size_pressure: 0.0,
            size_velocity: 0.0,
            size_tilt: 0.0,
            opacity_pressure: 0.0,
            opacity_velocity: 0.0,
            flow_pressure: 0.0,
            flow_velocity: 0.0,
        }
    }
}

/// Taper envelope over stroke arc length: size and opacity ramp 0→1 across
/// the first `start` fraction and 1→0 across the last `end` fraction.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BrushTaper {
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
}

impl Default for BrushTaper {
    fn default() -> Self {
        BrushTaper { start: 0.0, end: 0.0 }
    }
}

/// A document-level brush preset (≤ [`MAX_BRUSHES`] per document).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Brush {
    pub id: u64,
    pub name: String,
    /// Base dab diameter, px.
    #[serde(default = "default_brush_size")]
    pub size: f64,
    /// Master alpha multiplier, 0..=1.
    #[serde(default = "default_one")]
    pub opacity: f64,
    /// Per-dab alpha multiplier, 0..=1 (multiplies with opacity).
    #[serde(default = "default_one")]
    pub flow: f64,
    /// Dab spacing as a fraction of `size`, 0..=1 (0 = every modeled point).
    #[serde(default = "default_spacing")]
    pub spacing: f64,
    /// Fraction of the dab radius at full coverage, 0..=1.
    #[serde(default = "default_hardness")]
    pub hardness: f64,
    /// Straight RGBA dab color.
    #[serde(default = "default_color")]
    pub color: [u8; 4],
    #[serde(default)]
    pub dynamics: BrushDynamics,
    #[serde(default)]
    pub taper: BrushTaper,
}

fn default_brush_size() -> f64 {
    20.0
}
fn default_one() -> f64 {
    1.0
}
fn default_spacing() -> f64 {
    0.25
}
fn default_hardness() -> f64 {
    0.8
}
fn default_color() -> [u8; 4] {
    [0, 0, 0, 255]
}

impl Brush {
    /// Fields shared by `addBrush`/`setBrush`/inline `brush` payloads.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.name.is_empty() || self.name.len() > 1024 {
            return Err(EngineError::validation("brush name must be 1..=1024 bytes"));
        }
        let range = |v: f64, lo: f64, hi: f64, what: &str| -> Result<(), EngineError> {
            if !v.is_finite() || v < lo || v > hi {
                return Err(EngineError::validation(format!(
                    "brush {what} must be within {lo}..={hi}"
                )));
            }
            Ok(())
        };
        range(self.size, 0.1, 4096.0, "size")?;
        range(self.opacity, 0.0, 1.0, "opacity")?;
        range(self.flow, 0.0, 1.0, "flow")?;
        range(self.spacing, 0.0, 1.0, "spacing")?;
        range(self.hardness, 0.0, 1.0, "hardness")?;
        for (name, d) in [
            ("size_pressure", self.dynamics.size_pressure),
            ("size_velocity", self.dynamics.size_velocity),
            ("size_tilt", self.dynamics.size_tilt),
            ("opacity_pressure", self.dynamics.opacity_pressure),
            ("opacity_velocity", self.dynamics.opacity_velocity),
            ("flow_pressure", self.dynamics.flow_pressure),
            ("flow_velocity", self.dynamics.flow_velocity),
        ] {
            range(d, -1.0, 1.0, &format!("dynamics.{name}"))?;
        }
        range(self.taper.start, 0.0, 1.0, "taper.start")?;
        range(self.taper.end, 0.0, 1.0, "taper.end")?;
        if self.taper.start + self.taper.end > 1.0 {
            return Err(EngineError::validation(
                "brush taper.start + taper.end must be <= 1",
            ));
        }
        Ok(())
    }
}

/// Optional brush fields for `addBrush`/`setBrush`/inline `brush`.
/// Missing fields take the brush defaults (addBrush) or keep current values
/// (setBrush merge).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BrushPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub opacity: Option<f64>,
    #[serde(default)]
    pub flow: Option<f64>,
    #[serde(default)]
    pub spacing: Option<f64>,
    #[serde(default)]
    pub hardness: Option<f64>,
    #[serde(default)]
    pub color: Option<[u8; 4]>,
    #[serde(default)]
    pub dynamics: Option<BrushDynamics>,
    #[serde(default)]
    pub taper: Option<BrushTaper>,
}

/// Parse a brush patch object. Unknown fields are ignored (consistent with
/// the rest of the op surface); every present field is type-checked.
pub fn parse_brush_patch(v: Option<&Value>) -> Result<BrushPatch, EngineError> {
    let Some(v) = v else {
        return Ok(BrushPatch::default());
    };
    serde_json::from_value(v.clone())
        .map_err(|_| EngineError::invalid("brush fields are not a valid brush object"))
}

/// Build a new brush from a patch + engine-assigned id.
pub fn brush_from_patch(id: u64, patch: BrushPatch, default_name: String) -> Result<Brush, EngineError> {
    let b = Brush {
        id,
        name: patch.name.unwrap_or(default_name),
        size: patch.size.unwrap_or_else(default_brush_size),
        opacity: patch.opacity.unwrap_or_else(default_one),
        flow: patch.flow.unwrap_or_else(default_one),
        spacing: patch.spacing.unwrap_or_else(default_spacing),
        hardness: patch.hardness.unwrap_or_else(default_hardness),
        color: patch.color.unwrap_or_else(default_color),
        dynamics: patch.dynamics.unwrap_or_default(),
        taper: patch.taper.unwrap_or_default(),
    };
    // Re-validate through the typed path so serde defaults can't smuggle
    // out-of-range values (f64 fields deserialize unchecked).
    b.validate()?;
    Ok(b)
}

/// Merge a patch into an existing brush (setBrush semantics).
pub fn brush_apply_patch(b: &Brush, patch: BrushPatch) -> Result<Brush, EngineError> {
    let mut next = b.clone();
    if let Some(n) = patch.name {
        next.name = n;
    }
    if let Some(v) = patch.size {
        next.size = v;
    }
    if let Some(v) = patch.opacity {
        next.opacity = v;
    }
    if let Some(v) = patch.flow {
        next.flow = v;
    }
    if let Some(v) = patch.spacing {
        next.spacing = v;
    }
    if let Some(v) = patch.hardness {
        next.hardness = v;
    }
    if let Some(v) = patch.color {
        next.color = v;
    }
    if let Some(v) = patch.dynamics {
        next.dynamics = v;
    }
    if let Some(v) = patch.taper {
        next.taper = v;
    }
    next.validate()?;
    Ok(next)
}

// -- stage 6: dab generation -------------------------------------------------

/// One brush dab: center, outer radius, full-coverage radius, and the
/// combined per-dab alpha (`opacity_eff * flow_eff`, 0..=1).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Dab {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub inner: f64,
    pub alpha: f64,
    /// 0..=1 edge hardness already folded into `inner`/`radius`.
    pub hardness: f64,
}

/// Normalized dynamics inputs for one dab.
struct DynInputs {
    pressure: f64,
    tilt: f64,
    velocity: f64,
}

fn smoothstep(x: f64) -> f64 {
    let x = clamp01(x);
    x * x * (3.0 - 2.0 * x)
}

/// Resolve effective dab parameters for one arc position. Deterministic
/// algebra over the brush preset — no host involvement (decision §3).
fn resolve_dab(
    brush: &Brush,
    inputs: &DynInputs,
    taper_u: f64,
) -> (f64, f64, f64) {
    let d = &brush.dynamics;
    let p = inputs.pressure;
    let v = inputs.velocity;
    let t = inputs.tilt;
    let size_f = 1.0
        + d.size_pressure * (2.0 * p - 1.0)
        + d.size_velocity * (2.0 * v - 1.0)
        + d.size_tilt * (2.0 * t - 1.0);
    let opacity_f = 1.0 + d.opacity_pressure * (2.0 * p - 1.0) + d.opacity_velocity * (2.0 * v - 1.0);
    let flow_f = 1.0 + d.flow_pressure * (2.0 * p - 1.0) + d.flow_velocity * (2.0 * v - 1.0);

    // Taper envelope over normalized arc position.
    let mut env: f64 = 1.0;
    if brush.taper.start > 0.0 && taper_u < brush.taper.start {
        env = env.min(smoothstep(taper_u / brush.taper.start));
    }
    if brush.taper.end > 0.0 && taper_u > 1.0 - brush.taper.end {
        env = env.min(smoothstep((1.0 - taper_u) / brush.taper.end));
    }

    let size = (brush.size * size_f.clamp(0.05, 8.0) * env).clamp(0.1, 4096.0);
    let opacity = (brush.opacity * opacity_f.clamp(0.0, 2.0) * env).clamp(0.0, 1.0);
    let flow = (brush.flow * flow_f.clamp(0.0, 2.0)).clamp(0.0, 1.0);
    (size, opacity, flow)
}

/// Interpolated attributes at arc distance `s` along one modeled segment.
/// `vi` is a monotonic cursor into `cum` — positions are visited in
/// increasing arc order, so the scan is amortized O(1) per dab.
/// Returns `(x, y, DynInputs)` with `velocity` still in raw px/s.
fn attrs_at(
    pts: &[ModeledPoint],
    cum: &[f64],
    s: f64,
    vi: &mut usize,
) -> (f64, f64, DynInputs) {
    // `i` may range over 0..=len-2 (the last segment ends at the final
    // vertex), so the cursor advances while the NEXT vertex is still behind s.
    while *vi + 1 <= pts.len().saturating_sub(2) && cum[*vi + 1] < s {
        *vi += 1;
    }
    let i = (*vi).min(pts.len().saturating_sub(2));
    let (a, b) = if pts.len() >= 2 {
        (&pts[i], &pts[i + 1])
    } else {
        (&pts[0], &pts[0])
    };
    let seg_len = (cum[i + 1] - cum[i]).max(1e-9);
    let f = clamp01((s - cum[i]) / seg_len);
    let x = interp_f64(a.x, b.x, f);
    let y = interp_f64(a.y, b.y, f);
    let lerp_opt = |x: Option<f64>, y: Option<f64>| -> f64 {
        match (x, y) {
            (Some(x), Some(y)) => interp_f64(x, y, f),
            (Some(x), None) | (None, Some(x)) => x,
            (None, None) => 0.5,
        }
    };
    let pressure = lerp_opt(a.pressure, b.pressure);
    let tilt_raw = lerp_opt(a.tilt, b.tilt);
    // tilt is radians; normalize against π/2 (stylus tilt range).
    let tilt = clamp01(tilt_raw / (std::f64::consts::FRAC_PI_2));
    let speed = interp_f64(a.speed, b.speed, f);
    (x, y, DynInputs { pressure, tilt, velocity: speed })
}

/// Generate all dabs for a modeled stroke. The dab-count budget is checked
/// per segment from an upper-bound estimate BEFORE allocating positions, so
/// hostile geometry cannot hang or exhaust memory; the exact count is
/// re-checked at the end. Returns `Validation` over [`MAX_DABS`].
pub fn generate_dabs(
    segments: &[Vec<ModeledPoint>],
    brush: &Brush,
) -> Result<Vec<Dab>, EngineError> {
    let mut dabs: Vec<Dab> = Vec::new();
    let spacing_px = brush.spacing * brush.size;
    for pts in segments {
        if pts.is_empty() {
            continue;
        }
        // Cumulative arc length.
        let mut cum = Vec::with_capacity(pts.len());
        cum.push(0.0);
        for w in pts.windows(2) {
            let d = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
            cum.push(cum.last().unwrap() + d);
        }
        let total_len = *cum.last().unwrap();
        // Upper-bound dab estimate for this segment; reject early.
        let est = if spacing_px > 0.0 {
            (total_len / spacing_px).ceil() as usize + 3
        } else {
            pts.len()
        };
        if dabs.len().saturating_add(est) > MAX_DABS {
            return Err(EngineError::validation(format!(
                "stroke produces more than {MAX_DABS} dabs"
            )));
        }
        if total_len <= 0.0 {
            // Degenerate segment: one dab at the point, mid-taper.
            let inp = DynInputs {
                pressure: pts[0].pressure.unwrap_or(0.5),
                tilt: clamp01(pts[0].tilt.unwrap_or(0.0) / (std::f64::consts::FRAC_PI_2)),
                velocity: 0.0,
            };
            dabs.push(make_dab(brush, inp, 0.5, pts[0].x, pts[0].y)?);
            continue;
        }
        // Arc positions: every spacing_px, plus the exact stroke end when the
        // last grid point is meaningfully short of it. spacing == 0 puts a
        // dab on every modeled vertex.
        let mut positions: Vec<f64> = Vec::with_capacity(est.min(MAX_DABS));
        if spacing_px <= 0.0 {
            positions.extend_from_slice(&cum);
        } else {
            let mut s = 0.0;
            while s < total_len {
                positions.push(s);
                s += spacing_px;
            }
            let last = *positions.last().unwrap_or(&0.0);
            if total_len - last > spacing_px * 0.25 {
                positions.push(total_len);
            }
        }
        let mut vi = 0usize;
        for &s in &positions {
            let (x, y, mut inp) = attrs_at(pts, &cum, s, &mut vi);
            // Velocity saturates at 10 brush diameters per second
            // (documented in ENGINE_OPS.md).
            inp.velocity = clamp01(inp.velocity / (brush.size * 10.0));
            let u = s / total_len;
            dabs.push(make_dab(brush, inp, u, x, y)?);
        }
    }
    if dabs.len() > MAX_DABS {
        return Err(EngineError::validation(format!(
            "stroke produces {} dabs, exceeding the {MAX_DABS} budget",
            dabs.len()
        )));
    }
    Ok(dabs)
}

fn make_dab(
    brush: &Brush,
    inp: DynInputs,
    taper_u: f64,
    x: f64,
    y: f64,
) -> Result<Dab, EngineError> {
    let (size, opacity, flow) = resolve_dab(brush, &inp, taper_u);
    let radius = size / 2.0;
    let inner = radius * brush.hardness;
    Ok(Dab {
        x,
        y,
        radius,
        inner,
        alpha: opacity * flow,
        hardness: brush.hardness,
    })
}

/// Axis-aligned bounds of all dabs, or `None` when empty.
pub fn dabs_bounds(dabs: &[Dab]) -> Option<(f64, f64, f64, f64)> {
    let mut b: Option<(f64, f64, f64, f64)> = None;
    for d in dabs {
        let e = (
            d.x - d.radius,
            d.y - d.radius,
            d.x + d.radius,
            d.y + d.radius,
        );
        b = Some(match b {
            None => e,
            Some((x0, y0, x1, y1)) => {
                (x0.min(e.0), y0.min(e.1), x1.max(e.2), y1.max(e.3))
            }
        });
    }
    b
}

/// Exact count of pixels `stamp_dabs` will visit for `dabs` clipped to the
/// destination rect `(dst_ox, dst_oy, dst_w, dst_h)` — every pixel inside a
/// dab's clipped bounding box is examined (the circle/coverage tests run
/// inside), so this sum is the true work unit behind [`MAX_STROKE_PIXELS`].
/// Callers must run this before mutating; it is the same clip math
/// `stamp_dabs` uses, so it cannot underestimate.
pub fn stamp_pixel_work(
    dabs: &[Dab],
    dst_w: usize,
    dst_h: usize,
    dst_ox: usize,
    dst_oy: usize,
) -> u64 {
    let mut work = 0u64;
    for dab in dabs {
        if dab.alpha <= 0.0 {
            continue;
        }
        let x0 = ((dab.x - dab.radius).floor() as i64).max(dst_ox as i64);
        let y0 = ((dab.y - dab.radius).floor() as i64).max(dst_oy as i64);
        let x1 = ((dab.x + dab.radius).ceil() as i64).min((dst_ox + dst_w) as i64);
        let y1 = ((dab.y + dab.radius).ceil() as i64).min((dst_oy + dst_h) as i64);
        if x1 <= x0 || y1 <= y0 {
            continue;
        }
        work = work.saturating_add(((x1 - x0) as u64).saturating_mul((y1 - y0) as u64));
    }
    work
}

/// Stamp dabs into `dst` (a `dst_w * dst_h` RGBA region whose pixel (0,0)
/// sits at canvas `(dst_ox, dst_oy)`). Src-over via `raster::blend_pixel`;
/// checkpoints every [`CHECKPOINT_EVERY_PX`] *examined* pixels so
/// cancellation stays responsive even when coverage or the selection gates
/// most of them out.
///
/// `selection`, when present, is a canvas-sized coverage mask already
/// pulled back into this buffer's coordinate space (see
/// `select::pullback_coverage`); `sel_stride` is the canvas width used to
/// index it. Each stamped pixel's alpha is additionally scaled by the
/// selection value at that texel — the same gate `floodFill` applies.
///
/// Callers must enforce [`MAX_STROKE_PIXELS`] via [`stamp_pixel_work`]
/// before calling; this function does not re-check the budget.
pub fn stamp_dabs(
    dst: &mut [u8],
    dst_w: usize,
    dst_h: usize,
    dst_ox: usize,
    dst_oy: usize,
    dabs: &[Dab],
    color: [u8; 4],
    selection: Option<&[u8]>,
    sel_stride: usize,
    task: &mut RenderTask,
) -> Result<(), EngineError> {
    let src = [color[0], color[1], color[2], color[3]];
    let mut done_px = 0usize;
    let total_dabs = dabs.len().max(1) as f32;
    for (di, dab) in dabs.iter().enumerate() {
        // Pixel bbox of this dab, clipped to the destination rect.
        let x0 = ((dab.x - dab.radius).floor() as i64).max(dst_ox as i64);
        let y0 = ((dab.y - dab.radius).floor() as i64).max(dst_oy as i64);
        let x1 = ((dab.x + dab.radius).ceil() as i64).min((dst_ox + dst_w) as i64);
        let y1 = ((dab.y + dab.radius).ceil() as i64).min((dst_oy + dst_h) as i64);
        if x1 <= x0 || y1 <= y0 || dab.alpha <= 0.0 {
            task.progress(di as f32 / total_dabs);
            continue;
        }
        let r2 = dab.radius * dab.radius;
        let denom = (dab.radius - dab.inner).max(1e-9);
        for py in y0..y1 {
            let cy = py as f64 + 0.5;
            for px in x0..x1 {
                done_px += 1;
                task.tick(done_px, CHECKPOINT_EVERY_PX, di as f32 / total_dabs)?;
                let cx = px as f64 + 0.5;
                let d2 = (cx - dab.x) * (cx - dab.x) + (cy - dab.y) * (cy - dab.y);
                if d2 > r2 {
                    continue;
                }
                let d = d2.sqrt();
                let coverage = if dab.hardness >= 1.0 || dab.inner >= dab.radius {
                    1.0
                } else if d <= dab.inner {
                    1.0
                } else {
                    ((dab.radius - d) / denom).clamp(0.0, 1.0)
                };
                if coverage <= 0.0 {
                    continue;
                }
                let alpha = match selection {
                    Some(sel) => {
                        let si = py as usize * sel_stride + px as usize;
                        coverage * dab.alpha * sel.get(si).copied().unwrap_or(0) as f64 / 255.0
                    }
                    None => coverage * dab.alpha,
                };
                if alpha <= 0.0 {
                    continue;
                }
                let lx = (px as usize) - dst_ox;
                let ly = (py as usize) - dst_oy;
                if lx >= dst_w || ly >= dst_h {
                    continue;
                }
                let o = (ly * dst_w + lx) * 4;
                if o + 4 <= dst.len() {
                    raster::blend_pixel(&mut dst[o..o + 4], &src, alpha);
                }
            }
        }
        task.progress(di as f32 / total_dabs);
    }
    Ok(())
}

// -- stage 7: eraser stamping -------------------------------------------------
//
// Erasers reuse the dab model and the same clipped-bbox pixel-work accounting
// as [`stamp_dabs`], but composite destination-out instead of src-over: each
// covered pixel's alpha is multiplied by `1 - erase`, where
// `erase = coverage * dab.alpha * color_alpha * selection` (all factors in
// 0..=1). Color channels are left untouched — for straight-alpha pixels that
// is exactly the W3C destination-out composite (premultiplied color scales
// with alpha, so the straight color is unchanged). Pixels that are already
// transparent cannot change, which is what makes fully-erased regions
// eventless no-ops.

/// Shared dab loop for both erase targets. Visits exactly the pixels
/// [`stamp_dabs`] would examine (same clipped bboxes, same circle/hardness
/// coverage, same selection gate), calls `apply(pixel, erase)` for each
/// covered pixel, and returns how many pixels `apply` actually changed.
/// Checkpoints every [`CHECKPOINT_EVERY_PX`] *examined* pixels, identical to
/// `stamp_dabs`. Callers must enforce [`MAX_STROKE_PIXELS`] via
/// [`stamp_pixel_work`] first.
fn erase_dabs_inner(
    dst: &mut [u8],
    px_size: usize,
    dst_w: usize,
    dst_h: usize,
    dst_ox: usize,
    dst_oy: usize,
    dabs: &[Dab],
    color_alpha: f64,
    selection: Option<&[u8]>,
    sel_stride: usize,
    task: &mut RenderTask,
    mut apply: impl FnMut(&mut [u8], f64) -> bool,
) -> Result<usize, EngineError> {
    let mut changed = 0usize;
    let mut done_px = 0usize;
    let total_dabs = dabs.len().max(1) as f32;
    for (di, dab) in dabs.iter().enumerate() {
        let x0 = ((dab.x - dab.radius).floor() as i64).max(dst_ox as i64);
        let y0 = ((dab.y - dab.radius).floor() as i64).max(dst_oy as i64);
        let x1 = ((dab.x + dab.radius).ceil() as i64).min((dst_ox + dst_w) as i64);
        let y1 = ((dab.y + dab.radius).ceil() as i64).min((dst_oy + dst_h) as i64);
        if x1 <= x0 || y1 <= y0 || dab.alpha <= 0.0 {
            task.progress(di as f32 / total_dabs);
            continue;
        }
        let r2 = dab.radius * dab.radius;
        let denom = (dab.radius - dab.inner).max(1e-9);
        for py in y0..y1 {
            let cy = py as f64 + 0.5;
            for px in x0..x1 {
                done_px += 1;
                task.tick(done_px, CHECKPOINT_EVERY_PX, di as f32 / total_dabs)?;
                let cx = px as f64 + 0.5;
                let d2 = (cx - dab.x) * (cx - dab.x) + (cy - dab.y) * (cy - dab.y);
                if d2 > r2 {
                    continue;
                }
                let d = d2.sqrt();
                let coverage = if dab.hardness >= 1.0 || dab.inner >= dab.radius {
                    1.0
                } else if d <= dab.inner {
                    1.0
                } else {
                    ((dab.radius - d) / denom).clamp(0.0, 1.0)
                };
                if coverage <= 0.0 {
                    continue;
                }
                let erase = match selection {
                    Some(sel) => {
                        let si = py as usize * sel_stride + px as usize;
                        coverage
                            * dab.alpha
                            * color_alpha
                            * sel.get(si).copied().unwrap_or(0) as f64
                            / 255.0
                    }
                    None => coverage * dab.alpha * color_alpha,
                };
                if erase <= 0.0 {
                    continue;
                }
                let lx = (px as usize) - dst_ox;
                let ly = (py as usize) - dst_oy;
                if lx >= dst_w || ly >= dst_h {
                    continue;
                }
                let o = (ly * dst_w + lx) * px_size;
                if o + px_size <= dst.len() && apply(&mut dst[o..o + px_size], erase) {
                    changed += 1;
                }
            }
        }
        task.progress(di as f32 / total_dabs);
    }
    Ok(changed)
}

/// Pixel eraser: destination-out erase of a straight-alpha RGBA buffer
/// (same layout/coordinate conventions as [`stamp_dabs`]). `color_alpha` is
/// the brush color's alpha normalized to 0..=1 and multiplies the erase
/// strength exactly like `paintStroke` treats it as paint strength. Returns
/// the number of pixels whose alpha changed — 0 means the stroke was a
/// true no-op and callers should stay eventless.
pub fn erase_dabs_rgba(
    dst: &mut [u8],
    dst_w: usize,
    dst_h: usize,
    dst_ox: usize,
    dst_oy: usize,
    dabs: &[Dab],
    color_alpha: f64,
    selection: Option<&[u8]>,
    sel_stride: usize,
    task: &mut RenderTask,
) -> Result<usize, EngineError> {
    erase_dabs_inner(
        dst,
        4,
        dst_w,
        dst_h,
        dst_ox,
        dst_oy,
        dabs,
        color_alpha,
        selection,
        sel_stride,
        task,
        |px, erase| {
            let e = erase.clamp(0.0, 1.0);
            let na = (px[3] as f64 * (1.0 - e)).round().clamp(0.0, 255.0) as u8;
            if na != px[3] {
                px[3] = na;
                true
            } else {
                false
            }
        },
    )
}

/// Mask eraser: destination-out erase of a single-channel alpha buffer
/// (`w*h` bytes, same indexing as a layer mask — canvas space). Returns the
/// number of mask bytes that changed.
pub fn erase_dabs_alpha(
    dst: &mut [u8],
    dst_w: usize,
    dst_h: usize,
    dst_ox: usize,
    dst_oy: usize,
    dabs: &[Dab],
    color_alpha: f64,
    selection: Option<&[u8]>,
    sel_stride: usize,
    task: &mut RenderTask,
) -> Result<usize, EngineError> {
    erase_dabs_inner(
        dst,
        1,
        dst_w,
        dst_h,
        dst_ox,
        dst_oy,
        dabs,
        color_alpha,
        selection,
        sel_stride,
        task,
        |px, erase| {
            let e = erase.clamp(0.0, 1.0);
            let na = (px[0] as f64 * (1.0 - e)).round().clamp(0.0, 255.0) as u8;
            if na != px[0] {
                px[0] = na;
                true
            } else {
                false
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(t: f64, x: f64, y: f64) -> StrokeSample {
        StrokeSample {
            t,
            x,
            y,
            pressure: 0.5,
            tilt: -1.0,
            orientation: -1.0,
            contact: true,
        }
    }

    #[test]
    fn straight_line_models_close_to_input() {
        // 10 samples over 0.1s moving 5px each in x — well under speed ceiling.
        let samples: Vec<StrokeSample> = (0..10)
            .map(|i| sample(i as f64 * 0.01, i as f64 * 5.0, 10.0))
            .collect();
        let (segs, pred) = model_stroke(&samples, &StrokeParams::default(), None, None).unwrap();
        assert_eq!(segs.len(), 1);
        assert!(pred.is_empty());
        assert!(segs[0].len() > 10, "upsampling should add points: {}", segs[0].len());
        // Every modeled point stays near the y=10 line and within the x range.
        for p in &segs[0] {
            assert!((p.y - 10.0).abs() < 2.0, "y drifted: {}", p.y);
            assert!(p.x >= -1.0 && p.x <= 50.0);
        }
        // Last modeled point lands near the final input.
        let last = segs[0].last().unwrap();
        assert!((last.x - 45.0).abs() < 3.0, "end x {}", last.x);
    }

    #[test]
    fn deterministic_same_input_same_output() {
        let samples: Vec<StrokeSample> = (0..20)
            .map(|i| {
                let t = i as f64 * 0.008;
                StrokeSample {
                    t,
                    x: (i as f64 * 3.0) + (i as f64 * 0.7).sin() * 2.0,
                    y: 20.0 + (i as f64 * 1.3).cos() * 3.0,
                    pressure: (0.3 + 0.4 * (i as f64 * 0.5).sin()).max(0.0),
                    ..sample(t, 0.0, 0.0)
                }
            })
            .collect();
        let a = model_stroke(&samples, &StrokeParams::default(), Some(PredictSpec { steps: 4, interval: None }), None).unwrap();
        let b = model_stroke(&samples, &StrokeParams::default(), Some(PredictSpec { steps: 4, interval: None }), None).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.1.len(), 4);
    }

    #[test]
    fn contact_breaks_segments() {
        let mut samples: Vec<StrokeSample> = (0..5)
            .map(|i| sample(i as f64 * 0.01, i as f64 * 4.0, 0.0))
            .collect();
        samples.push(StrokeSample { contact: false, ..sample(0.05, 16.0, 0.0) });
        samples.extend((0..5).map(|i| sample(0.06 + i as f64 * 0.01, 30.0 + i as f64 * 4.0, 50.0)));
        let (segs, _) = model_stroke(&samples, &StrokeParams::default(), None, None).unwrap();
        assert_eq!(segs.len(), 2);
        assert!(segs.iter().all(|s| !s.is_empty()));
    }

    #[test]
    fn pressure_interpolates_along_stroke() {
        // Rising pressure 0 → 1 across a straight stroke.
        let samples: Vec<StrokeSample> = (0..11)
            .map(|i| StrokeSample {
                t: i as f64 * 0.01,
                x: i as f64 * 5.0,
                y: 0.0,
                pressure: i as f64 / 10.0,
                tilt: 0.0,
                orientation: 0.0,
                contact: true,
            })
            .collect();
        let (segs, _) = model_stroke(&samples, &StrokeParams::default(), None, None).unwrap();
        let pts = &segs[0];
        let first_p = pts.iter().find_map(|p| p.pressure).unwrap_or(0.0);
        let last_p = pts.iter().rev().find_map(|p| p.pressure).unwrap_or(1.0);
        assert!(last_p > first_p, "pressure should rise: {first_p} → {last_p}");
    }

    #[test]
    fn sample_budget_enforced() {
        let mut v = vec![json!({"t":0.0,"x":0.0,"y":0.0}); MAX_SAMPLES + 1];
        // Build through parse_samples to hit the cap.
        let samples_json = Value::Array(
            (0..=MAX_SAMPLES)
                .map(|i| json!({"t": i as f64 * 0.001, "x": i as f64, "y": 0.0}))
                .collect(),
        );
        assert!(parse_samples(Some(&samples_json)).is_err());
        let _ = &mut v;
    }

    #[test]
    fn brush_patch_defaults_and_validation() {
        let b = brush_from_patch(7, BrushPatch::default(), "P".into()).unwrap();
        assert_eq!(b.size, 20.0);
        assert_eq!(b.spacing, 0.25);
        assert!(b.validate().is_ok());
        let bad = BrushPatch { size: Some(-1.0), ..Default::default() };
        assert!(brush_from_patch(7, bad, "P".into()).is_err());
        let bad_taper = BrushPatch {
            taper: Some(BrushTaper { start: 0.8, end: 0.8 }),
            ..Default::default()
        };
        assert!(brush_from_patch(7, bad_taper, "P".into()).is_err());
    }

    #[test]
    fn dabs_respect_spacing_and_cap() {
        let brush = brush_from_patch(1, BrushPatch::default(), "B".into()).unwrap();
        // Straight 100px segment, spacing 0.25*20=5px → ~21 dabs.
        let pts: Vec<ModeledPoint> = (0..11)
            .map(|i| ModeledPoint {
                t: i as f64 * 0.01,
                x: i as f64 * 10.0,
                y: 0.0,
                pressure: Some(0.5),
                tilt: None,
                orientation: None,
                segment: 0,
                speed: 1000.0,
            })
            .collect();
        let dabs = generate_dabs(&[pts], &brush).unwrap();
        assert!(dabs.len() >= 18 && dabs.len() <= 24, "{}", dabs.len());
        // Sorted along x.
        for w in dabs.windows(2) {
            assert!(w[1].x >= w[0].x);
        }
    }

    #[test]
    fn taper_shrinks_end_dabs() {
        let patch = BrushPatch {
            size: Some(20.0),
            taper: Some(BrushTaper { start: 0.2, end: 0.2 }),
            ..Default::default()
        };
        let brush = brush_from_patch(1, patch, "B".into()).unwrap();
        let pts: Vec<ModeledPoint> = (0..11)
            .map(|i| ModeledPoint {
                t: i as f64 * 0.01,
                x: i as f64 * 10.0,
                y: 0.0,
                pressure: Some(0.5),
                tilt: None,
                orientation: None,
                segment: 0,
                speed: 0.0,
            })
            .collect();
        let dabs = generate_dabs(&[pts], &brush).unwrap();
        let first = dabs.first().unwrap().radius;
        let mid = dabs[dabs.len() / 2].radius;
        let last = dabs.last().unwrap().radius;
        assert!(first < mid && last < mid, "taper: {first} {mid} {last}");
    }

    #[test]
    fn stamp_dabs_blends_src_over() {
        // 8x8 canvas region, one big soft dab.
        let mut buf = vec![0u8; 8 * 8 * 4];
        let dab = Dab { x: 4.5, y: 4.5, radius: 3.0, inner: 0.0, alpha: 1.0, hardness: 0.0 };
        let mut task = RenderTask::new(None, 1);
        stamp_dabs(&mut buf, 8, 8, 0, 0, &[dab], [255, 0, 0, 255], None, 8, &mut task).unwrap();
        let center = (4 * 8 + 4) * 4;
        assert_eq!(&buf[center..center + 4], &[255, 0, 0, 255]);
        // Corner untouched.
        assert_eq!(&buf[0..4], &[0, 0, 0, 0]);
        // Edge pixel partially covered (center (2.5,4.5), d=2 of r=3).
        let edge = (4 * 8 + 2) * 4;
        assert!(buf[edge + 3] > 0 && buf[edge + 3] < 255);
    }

    #[test]
    fn hostile_orientation_wraps_instead_of_hanging() {
        // Regression: `interp_angle` used to normalize with `while` loops —
        // orientation 1e10 spun forever. `rem_euclid` + parse-time wrapping
        // make any finite angle O(1); 1e15 must model quickly with sane
        // (wrapped) output.
        let v = json!([
            {"t": 0.0, "x": 0.0, "y": 0.0, "orientation": 1e15, "tilt": 1e15},
            {"t": 0.01, "x": 5.0, "y": 0.0, "orientation": 1e15, "tilt": 1e15},
        ]);
        let samples = parse_samples(Some(&v)).unwrap();
        assert!(samples.iter().all(|s| {
            (0.0..std::f64::consts::TAU).contains(&s.orientation) && s.orientation >= 0.0
                && (0.0..std::f64::consts::TAU).contains(&s.tilt)
        }));
        let (segs, _) = model_stroke(&samples, &StrokeParams::default(), None, None).unwrap();
        for p in segs.iter().flatten() {
            if let Some(o) = p.orientation {
                assert!((0.0..std::f64::consts::TAU).contains(&o), "orientation {o}");
            }
            if let Some(t) = p.tilt {
                assert!(t.is_finite() && t >= 0.0);
            }
        }
        // interp_angle itself is total for any finite input.
        assert!(interp_angle(1e15, -1e15, 0.5).is_finite());
        assert!(interp_angle(f64::MAX, f64::MIN_POSITIVE, 0.25).is_finite());
    }

    #[test]
    fn stamp_pixel_work_matches_stamp_visit_count() {
        let dab = Dab { x: 4.5, y: 4.5, radius: 3.0, inner: 0.0, alpha: 1.0, hardness: 0.0 };
        // 8x8 dst: bbox x 2..7 (floor 1.5→1? compute: 4.5-3=1.5 floor 1, 4.5+3=7.5 ceil 8 → clipped 0..8)
        let work = stamp_pixel_work(&[dab], 8, 8, 0, 0);
        assert_eq!(work, 7 * 7, "bbox 1..8 x 1..8");
        // Off-dst dab contributes nothing; zero-alpha dab is skipped.
        let far = Dab { x: 100.0, y: 100.0, ..dab };
        let ghost = Dab { alpha: 0.0, ..dab };
        assert_eq!(stamp_pixel_work(&[far, ghost], 8, 8, 0, 0), 0);
    }

    #[test]
    fn hostile_params_rejected() {
        let p = json!({"min_output_rate": -1.0});
        assert!(parse_params(Some(&p)).is_err());
        let p = json!({"spring_mass_constant": 0.0});
        assert!(parse_params(Some(&p)).is_err());
        let p = json!({"smoothing_speed_floor": 50.0, "smoothing_speed_ceiling": 10.0});
        assert!(parse_params(Some(&p)).is_err());
    }
}
