//! Mixer document types: sends, insert effects, automation lanes and the
//! metronome. Every field has a serde default so snapshots written before
//! these existed still restore.

use ignition_core::EngineError;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Most insert slots one track or bus may hold.
pub const MAX_INSERTS: usize = 8;
/// Most bands one EQ insert may hold.
pub const MAX_EQ_BANDS: usize = 8;
/// Longest group name, in bytes.
pub const MAX_GROUP_NAME: usize = 64;

/// A post-fader send from a source track to a bus.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Send {
    pub bus: u64,
    /// Linear send level, 0..=1.
    pub level: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EqBandType {
    Peak,
    LowShelf,
    HighShelf,
    LowPass,
    HighPass,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EqBand {
    #[serde(rename = "type")]
    pub band_type: EqBandType,
    pub freq_hz: f64,
    /// Ignored by low/high pass bands, which have no gain.
    pub gain_db: f64,
    pub q: f64,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompressorParams {
    pub threshold_db: f64,
    pub ratio: f64,
    pub knee_db: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub makeup_db: f64,
}

/// What an insert slot does. Serialized as `{"kind": ..., "params": ...}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "params", rename_all = "snake_case")]
pub enum Effect {
    Gain { gain_db: f64 },
    Eq { bands: Vec<EqBand> },
    Compressor(CompressorParams),
}

impl Effect {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Effect::Gain { .. } => "gain",
            Effect::Eq { .. } => "eq",
            Effect::Compressor(_) => "compressor",
        }
    }

    /// Default effect for a kind name, or `None` for an unknown kind.
    pub fn default_for(kind: &str) -> Option<Effect> {
        match kind {
            "gain" => Some(Effect::Gain { gain_db: 0.0 }),
            "eq" => Some(Effect::Eq {
                bands: vec![
                    EqBand { band_type: EqBandType::LowShelf, freq_hz: 120.0, gain_db: 0.0, q: 0.71, enabled: true },
                    EqBand { band_type: EqBandType::Peak, freq_hz: 1000.0, gain_db: 0.0, q: 1.0, enabled: true },
                    EqBand { band_type: EqBandType::HighShelf, freq_hz: 8000.0, gain_db: 0.0, q: 0.71, enabled: true },
                ],
            }),
            "compressor" => Some(Effect::Compressor(CompressorParams {
                threshold_db: -18.0,
                ratio: 3.0,
                knee_db: 6.0,
                attack_ms: 10.0,
                release_ms: 120.0,
                makeup_db: 0.0,
            })),
            _ => None,
        }
    }

    /// Merge `params` into this effect, validating every field. Unknown keys
    /// are rejected so a typo cannot be silently dropped. On error `self` is
    /// unchanged.
    pub fn merged(&self, params: &Value) -> Result<Effect, EngineError> {
        let obj = params
            .as_object()
            .ok_or_else(|| EngineError::invalid("params must be an object"))?;
        let mut next = self.clone();
        match &mut next {
            Effect::Gain { gain_db } => {
                only_keys(obj, &["gain_db"])?;
                if let Some(v) = obj.get("gain_db") {
                    *gain_db = ranged(v, "gain_db", -24.0, 24.0)?;
                }
            }
            Effect::Eq { bands } => {
                only_keys(obj, &["bands"])?;
                if let Some(v) = obj.get("bands") {
                    *bands = parse_bands(v)?;
                }
            }
            Effect::Compressor(c) => {
                only_keys(
                    obj,
                    &["threshold_db", "ratio", "knee_db", "attack_ms", "release_ms", "makeup_db"],
                )?;
                if let Some(v) = obj.get("threshold_db") {
                    c.threshold_db = ranged(v, "threshold_db", -60.0, 0.0)?;
                }
                if let Some(v) = obj.get("ratio") {
                    c.ratio = ranged(v, "ratio", 1.0, 20.0)?;
                }
                if let Some(v) = obj.get("knee_db") {
                    c.knee_db = ranged(v, "knee_db", 0.0, 24.0)?;
                }
                if let Some(v) = obj.get("attack_ms") {
                    c.attack_ms = ranged(v, "attack_ms", 0.1, 200.0)?;
                }
                if let Some(v) = obj.get("release_ms") {
                    c.release_ms = ranged(v, "release_ms", 5.0, 2000.0)?;
                }
                if let Some(v) = obj.get("makeup_db") {
                    c.makeup_db = ranged(v, "makeup_db", 0.0, 24.0)?;
                }
            }
        }
        Ok(next)
    }
}

fn only_keys(obj: &Map<String, Value>, allowed: &[&str]) -> Result<(), EngineError> {
    match obj.keys().find(|k| !allowed.contains(&k.as_str())) {
        Some(k) => Err(EngineError::validation(format!(
            "unknown param '{k}' (expected one of {})",
            allowed.join(", ")
        ))),
        None => Ok(()),
    }
}

fn ranged(v: &Value, key: &str, min: f64, max: f64) -> Result<f64, EngineError> {
    let f = v
        .as_f64()
        .filter(|f| f.is_finite())
        .ok_or_else(|| EngineError::invalid(format!("invalid '{key}'")))?;
    if !(min..=max).contains(&f) {
        return Err(EngineError::validation(format!("{key} must be in {min}..={max}")));
    }
    Ok(f)
}

fn parse_bands(v: &Value) -> Result<Vec<EqBand>, EngineError> {
    let arr = v
        .as_array()
        .ok_or_else(|| EngineError::invalid("bands must be an array"))?;
    if arr.len() > MAX_EQ_BANDS {
        return Err(EngineError::validation(format!("an EQ holds at most {MAX_EQ_BANDS} bands")));
    }
    arr.iter()
        .map(|b| {
            let o = b
                .as_object()
                .ok_or_else(|| EngineError::invalid("each band must be an object"))?;
            only_keys(o, &["type", "freq_hz", "gain_db", "q", "enabled"])?;
            let band_type: EqBandType = serde_json::from_value(
                o.get("type").cloned().unwrap_or(Value::Null),
            )
            .map_err(|_| {
                EngineError::validation(
                    "band type must be peak, low_shelf, high_shelf, low_pass or high_pass",
                )
            })?;
            let freq_hz = ranged(o.get("freq_hz").unwrap_or(&Value::Null), "freq_hz", 20.0, 20000.0)?;
            let gain_db = match o.get("gain_db") {
                None => 0.0,
                Some(g) => ranged(g, "gain_db", -24.0, 24.0)?,
            };
            let q = match o.get("q") {
                None => 0.71,
                Some(q) => ranged(q, "q", 0.1, 18.0)?,
            };
            let enabled = match o.get("enabled") {
                None => true,
                Some(e) => e.as_bool().ok_or_else(|| EngineError::invalid("invalid 'enabled'"))?,
            };
            Ok(EqBand { band_type, freq_hz, gain_db, q, enabled })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Insert {
    pub id: u64,
    pub bypassed: bool,
    #[serde(flatten)]
    pub effect: Effect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutomationMode {
    /// Points are kept but the fader/pan value is used.
    #[default]
    Off,
    /// Render follows the points.
    Read,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationPoint {
    /// Absolute timeline position.
    pub ticks: u64,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AutomationLane {
    #[serde(default)]
    pub mode: AutomationMode,
    /// Sorted by `ticks`, no two points at the same tick.
    #[serde(default)]
    pub points: Vec<AutomationPoint>,
}

impl AutomationLane {
    /// Value at `ticks`: linear between points, held before the first and
    /// after the last. `None` when the lane does not drive the render.
    pub fn value_at(&self, ticks: f64) -> Option<f64> {
        if self.mode != AutomationMode::Read || self.points.is_empty() {
            return None;
        }
        let pts = &self.points;
        if ticks <= pts[0].ticks as f64 {
            return Some(pts[0].value);
        }
        let last = &pts[pts.len() - 1];
        if ticks >= last.ticks as f64 {
            return Some(last.value);
        }
        let i = pts.partition_point(|p| (p.ticks as f64) <= ticks);
        let (a, b) = (&pts[i - 1], &pts[i]);
        let t = (ticks - a.ticks as f64) / (b.ticks - a.ticks) as f64;
        Some(a.value + (b.value - a.value) * t)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TrackAutomation {
    #[serde(default)]
    pub gain: AutomationLane,
    #[serde(default)]
    pub pan: AutomationLane,
}

/// Which automatable parameter a lane drives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutomationParam {
    Gain,
    Pan,
}

impl AutomationParam {
    pub fn parse(s: &str) -> Result<Self, EngineError> {
        match s {
            "gain" => Ok(Self::Gain),
            "pan" => Ok(Self::Pan),
            _ => Err(EngineError::validation("param must be \"gain\" or \"pan\"")),
        }
    }

    pub fn range(self) -> (f64, f64) {
        match self {
            Self::Gain => (0.0, 1.0),
            Self::Pan => (-1.0, 1.0),
        }
    }
}

impl TrackAutomation {
    pub fn lane(&self, p: AutomationParam) -> &AutomationLane {
        match p {
            AutomationParam::Gain => &self.gain,
            AutomationParam::Pan => &self.pan,
        }
    }
    pub fn lane_mut(&mut self, p: AutomationParam) -> &mut AutomationLane {
        match p {
            AutomationParam::Gain => &mut self.gain,
            AutomationParam::Pan => &mut self.pan,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Metronome {
    pub enabled: bool,
    /// Linear click level, 0..=1.
    pub volume: f64,
}

impl Default for Metronome {
    fn default() -> Self {
        Self { enabled: false, volume: 0.5 }
    }
}
