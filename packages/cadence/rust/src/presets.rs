//! Factory presets for the built-in insert effects. Names are stable ids;
//! the labels are for display. Applying one replaces the insert's params.

use crate::mixer_model::{CompressorParams, EqBand, EqBandType, Effect};
use crate::req_str;
use ignition_core::EngineError;
use serde_json::{json, Value};

struct Preset {
    id: &'static str,
    label: &'static str,
    effect: fn() -> Effect,
}

fn band(t: EqBandType, freq_hz: f64, gain_db: f64, q: f64) -> EqBand {
    EqBand { band_type: t, freq_hz, gain_db, q, enabled: true }
}

fn comp(threshold_db: f64, ratio: f64, knee_db: f64, attack_ms: f64, release_ms: f64, makeup_db: f64) -> Effect {
    Effect::Compressor(CompressorParams { threshold_db, ratio, knee_db, attack_ms, release_ms, makeup_db })
}

const PRESETS: &[(&str, &[Preset])] = &[
    ("eq", &[
        Preset { id: "flat", label: "Flat", effect: || Effect::default_for("eq").expect("eq default") },
        Preset { id: "vocal-presence", label: "Vocal presence", effect: || Effect::Eq { bands: vec![
            band(EqBandType::HighPass, 90.0, 0.0, 0.71),
            band(EqBandType::Peak, 300.0, -2.5, 1.2),
            band(EqBandType::Peak, 3500.0, 3.0, 1.0),
            band(EqBandType::HighShelf, 10000.0, 2.0, 0.71),
        ] } },
        Preset { id: "bass-tighten", label: "Bass tighten", effect: || Effect::Eq { bands: vec![
            band(EqBandType::HighPass, 35.0, 0.0, 0.71),
            band(EqBandType::Peak, 80.0, 2.0, 1.0),
            band(EqBandType::Peak, 250.0, -3.0, 1.4),
            band(EqBandType::LowPass, 8000.0, 0.0, 0.71),
        ] } },
        Preset { id: "telephone", label: "Telephone", effect: || Effect::Eq { bands: vec![
            band(EqBandType::HighPass, 400.0, 0.0, 0.9),
            band(EqBandType::Peak, 1500.0, 4.0, 1.0),
            band(EqBandType::LowPass, 3200.0, 0.0, 0.9),
        ] } },
    ]),
    ("compressor", &[
        Preset { id: "gentle", label: "Gentle glue", effect: || comp(-18.0, 2.0, 8.0, 30.0, 200.0, 2.0) },
        Preset { id: "vocal-level", label: "Vocal leveler", effect: || comp(-22.0, 3.5, 6.0, 8.0, 120.0, 4.0) },
        Preset { id: "drum-punch", label: "Drum punch", effect: || comp(-16.0, 4.0, 3.0, 25.0, 80.0, 3.0) },
        Preset { id: "limiter", label: "Brickwall-ish limit", effect: || comp(-3.0, 20.0, 0.0, 0.1, 50.0, 0.0) },
    ]),
    ("gain", &[
        Preset { id: "unity", label: "Unity", effect: || Effect::Gain { gain_db: 0.0 } },
        Preset { id: "minus-6", label: "-6 dB pad", effect: || Effect::Gain { gain_db: -6.0 } },
        Preset { id: "plus-6", label: "+6 dB boost", effect: || Effect::Gain { gain_db: 6.0 } },
    ]),
];

fn for_kind(kind: &str) -> Option<&'static [Preset]> {
    PRESETS.iter().find(|(k, _)| *k == kind).map(|(_, p)| *p)
}

/// `insertPresets {kind}` → `{presets: [{id, label, kind, params}]}`.
pub fn list(p: &Value) -> Result<Value, EngineError> {
    let kind = req_str(p, "kind")?;
    let presets = for_kind(kind)
        .ok_or_else(|| EngineError::validation("kind must be \"gain\", \"eq\" or \"compressor\""))?;
    let items: Vec<Value> = presets
        .iter()
        .map(|pr| {
            let mut v = serde_json::to_value((pr.effect)()).unwrap_or(Value::Null);
            v["id"] = json!(pr.id);
            v["label"] = json!(pr.label);
            v
        })
        .collect();
    Ok(json!({ "presets": items }))
}

/// Preset effect by kind and id.
pub fn find(kind: &str, id: &str) -> Option<Effect> {
    for_kind(kind)?.iter().find(|p| p.id == id).map(|p| (p.effect)())
}
