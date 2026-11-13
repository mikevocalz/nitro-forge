//! Op-level tests for routing, inserts, groups, automation, batch velocity,
//! MIDI channel, metronome and the analysis ops.

use crate::CadenceEngine;
use ignition_core::{encode_envelope, Command, Engine, EngineError, ErrorCode};
use serde_json::{json, Value};

fn apply(e: &mut CadenceEngine, op: &str, p: Value) -> Result<Value, EngineError> {
    e.apply(Command::new(op, p)).map(|r| r.data)
}

fn ok(e: &mut CadenceEngine, op: &str, p: Value) -> Value {
    apply(e, op, p.clone()).unwrap_or_else(|err| panic!("{op} {p}: {err:?}"))
}

fn describe(e: &mut CadenceEngine) -> Value {
    ok(e, "describe", json!({}))
}

/// Rejects with `code` and leaves the document unchanged.
fn rejects(e: &mut CadenceEngine, op: &str, p: Value, code: ErrorCode) {
    let before = describe(e);
    let err = apply(e, op, p.clone()).expect_err("expected rejection");
    assert_eq!(err.code, code, "{op} {p}: {}", err.message);
    assert_eq!(describe(e), before, "{op} {p} mutated on error");
}

fn undo_depth(e: &mut CadenceEngine) -> usize {
    let mut n = 0;
    while e.undo().unwrap() {
        n += 1;
    }
    for _ in 0..n {
        e.redo().unwrap();
    }
    n
}

/// Track with one clip [0, 960) holding A4 at full velocity.
fn tone_track(e: &mut CadenceEngine) -> (u64, u64) {
    let t = ok(e, "addTrack", json!({}))["track_id"].as_u64().unwrap();
    let c = ok(e, "addClip", json!({"track": t, "start_ticks": 0, "length_ticks": 960}))["clip_id"]
        .as_u64()
        .unwrap();
    ok(e, "addNote", json!({"clip": c, "pitch": 69, "velocity": 127, "start_ticks": 0, "length_ticks": 960}));
    (t, c)
}

fn bus(e: &mut CadenceEngine) -> u64 {
    ok(e, "addTrack", json!({"kind": "bus"}))["track_id"].as_u64().unwrap()
}

fn peaks(e: &mut CadenceEngine) -> (f64, f64) {
    // Per-channel peaks of the middle of the note, past attack and release.
    let r = ok(e, "render", json!({"from_ticks": 240, "to_ticks": 720, "sample_rate": 8000}));
    let bytes = b64(r["samples_b64"].as_str().unwrap());
    let f: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let (mut l, mut rr) = (0f64, 0f64);
    for i in 0..f.len() / 2 {
        l = l.max(f[i * 2].abs() as f64);
        rr = rr.max(f[i * 2 + 1].abs() as f64);
    }
    (l, rr)
}

fn b64(s: &str) -> Vec<u8> {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in s.trim_end_matches('=').as_bytes() {
        acc = (acc << 6) | A.iter().position(|&x| x == c).unwrap() as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

const CENTRE: f64 = std::f64::consts::FRAC_1_SQRT_2;

// ---- routing --------------------------------------------------------------

#[test]
fn track_routed_to_a_bus_reaches_the_master_through_it() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let b = bus(&mut e);
    assert_eq!(describe(&mut e)["tracks"][1]["kind"], "bus");
    assert_eq!(describe(&mut e)["tracks"][1]["name"], "Bus 1");
    ok(&mut e, "setTrackOutput", json!({"id": t, "output": b}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02, "through bus {l}");
    // Bus fader scales everything routed into it.
    ok(&mut e, "setTrackGain", json!({"id": b, "volume": 0.5}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE * 0.5).abs() < 0.02, "bus at half {l}");
    // A muted bus silences its inputs.
    ok(&mut e, "setMuted", json!({"id": b, "muted": true}));
    assert_eq!(peaks(&mut e), (0.0, 0.0));
    // Back to the master.
    ok(&mut e, "setTrackOutput", json!({"id": t, "output": null}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02);
}

#[test]
fn bus_pan_is_balance() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let b = bus(&mut e);
    ok(&mut e, "setTrackOutput", json!({"id": t, "output": b}));
    ok(&mut e, "setTrackPan", json!({"id": b, "pan": 0.5}));
    let (l, r) = peaks(&mut e);
    // Balance keeps the near side and halves the far side.
    assert!((r - CENTRE).abs() < 0.02, "right {r}");
    assert!((l - CENTRE * 0.5).abs() < 0.02, "left {l}");
}

#[test]
fn sends_add_post_fader_signal_to_the_bus() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let b = bus(&mut e);
    ok(&mut e, "setSend", json!({"track": t, "bus": b, "level": 0.5}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE * 1.5).abs() < 0.03, "dry plus half send {l}");
    ok(&mut e, "setSend", json!({"track": t, "bus": b, "level": 1.0}));
    assert_eq!(describe(&mut e)["tracks"][0]["sends"], json!([{"bus": b, "level": 1.0}]));
    ok(&mut e, "removeSend", json!({"track": t, "bus": b}));
    assert_eq!(describe(&mut e)["tracks"][0]["sends"], json!([]));
    rejects(&mut e, "removeSend", json!({"track": t, "bus": b}), ErrorCode::NotFound);
}

#[test]
fn routing_rejects_invalid_targets() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let b = bus(&mut e);
    let b2 = bus(&mut e);
    rejects(&mut e, "setTrackOutput", json!({"id": t, "output": t}), ErrorCode::Validation);
    rejects(&mut e, "setTrackOutput", json!({"id": t, "output": 999}), ErrorCode::NotFound);
    rejects(&mut e, "setTrackOutput", json!({"id": b, "output": b2}), ErrorCode::Validation);
    rejects(&mut e, "setTrackOutput", json!({"id": t}), ErrorCode::InvalidCommand);
    rejects(&mut e, "setSend", json!({"track": t, "bus": b, "level": 1.5}), ErrorCode::Validation);
    rejects(&mut e, "setSend", json!({"track": b, "bus": b2, "level": 0.5}), ErrorCode::Validation);
    rejects(&mut e, "addClip", json!({"track": b, "start_ticks": 0, "length_ticks": 10}), ErrorCode::Validation);
}

#[test]
fn removing_a_bus_reroutes_its_inputs_in_one_step() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let b = bus(&mut e);
    ok(&mut e, "setTrackOutput", json!({"id": t, "output": b}));
    ok(&mut e, "setSend", json!({"track": t, "bus": b, "level": 0.3}));
    let routed = describe(&mut e);
    ok(&mut e, "removeTrack", json!({"id": b}));
    let d = describe(&mut e);
    assert_eq!(d["tracks"][0]["output"], Value::Null);
    assert_eq!(d["tracks"][0]["sends"], json!([]));
    assert!(e.undo().unwrap());
    assert_eq!(describe(&mut e), routed);
}

// ---- inserts --------------------------------------------------------------

#[test]
fn insert_lifecycle_and_order() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let g = ok(&mut e, "addInsert", json!({"track": t, "kind": "gain"}))["insert_id"].as_u64().unwrap();
    let q = ok(&mut e, "addInsert", json!({"track": t, "kind": "eq", "index": 0}))["insert_id"].as_u64().unwrap();
    let ins = |e: &mut CadenceEngine| describe(e)["tracks"][0]["inserts"].clone();
    assert_eq!(ins(&mut e)[0]["id"], q);
    assert_eq!(ins(&mut e)[0]["kind"], "eq");
    assert_eq!(ins(&mut e)[0]["params"]["bands"].as_array().unwrap().len(), 3);
    ok(&mut e, "moveInsert", json!({"id": q, "index": 1}));
    assert_eq!(ins(&mut e)[1]["id"], q);
    ok(&mut e, "setInsertBypass", json!({"id": g, "bypassed": true}));
    assert_eq!(ins(&mut e)[0]["bypassed"], true);
    ok(&mut e, "removeInsert", json!({"id": g}));
    assert_eq!(ins(&mut e).as_array().unwrap().len(), 1);
    rejects(&mut e, "removeInsert", json!({"id": g}), ErrorCode::NotFound);
    rejects(&mut e, "moveInsert", json!({"id": q, "index": 1}), ErrorCode::OutOfBounds);
    rejects(&mut e, "addInsert", json!({"track": t, "kind": "reverb"}), ErrorCode::Validation);
    rejects(&mut e, "addInsert", json!({"track": t, "kind": "gain", "index": 5}), ErrorCode::OutOfBounds);
    // Insert ids survive a snapshot without colliding with new ids.
    let snap = e.snapshot().unwrap();
    let mut e2 = CadenceEngine::new();
    e2.restore(&snap).unwrap();
    let id = ok(&mut e2, "addTrack", json!({}))["track_id"].as_u64().unwrap();
    assert!(id > q);
}

#[test]
fn insert_cap() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    for _ in 0..crate::mixer_model::MAX_INSERTS {
        ok(&mut e, "addInsert", json!({"track": t, "kind": "gain"}));
    }
    rejects(&mut e, "addInsert", json!({"track": t, "kind": "gain"}), ErrorCode::Validation);
}

#[test]
fn insert_params_validate_atomically_and_reach_the_render() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let g = ok(&mut e, "addInsert", json!({"track": t, "kind": "gain", "params": {"gain_db": -6.0206}}))["insert_id"]
        .as_u64()
        .unwrap();
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE * 0.5).abs() < 0.02, "-6 dB insert {l}");
    ok(&mut e, "setInsertBypass", json!({"id": g, "bypassed": true}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02, "bypassed {l}");
    rejects(&mut e, "setInsertParams", json!({"id": g, "params": {"gain_db": 40}}), ErrorCode::Validation);
    rejects(&mut e, "setInsertParams", json!({"id": g, "params": {"gian_db": 1}}), ErrorCode::Validation);
    rejects(&mut e, "setInsertParams", json!({"id": g, "params": 3}), ErrorCode::InvalidCommand);

    let c = ok(&mut e, "addInsert", json!({"track": t, "kind": "compressor"}))["insert_id"].as_u64().unwrap();
    // One bad field in a batch of good ones changes nothing.
    rejects(&mut e, "setInsertParams", json!({"id": c, "params": {"ratio": 4, "attack_ms": 0}}), ErrorCode::Validation);
    ok(&mut e, "setInsertParams", json!({"id": c, "params": {"ratio": 4, "threshold_db": -30}}));
    let p = &describe(&mut e)["tracks"][0]["inserts"][1]["params"];
    assert_eq!(p["ratio"], 4.0);
    assert_eq!(p["threshold_db"], -30.0);
    assert_eq!(p["knee_db"], 6.0, "untouched fields keep their value");

    let q = ok(&mut e, "addInsert", json!({"track": t, "kind": "eq"}))["insert_id"].as_u64().unwrap();
    rejects(
        &mut e,
        "setInsertParams",
        json!({"id": q, "params": {"bands": [{"type": "notch", "freq_hz": 100}]}}),
        ErrorCode::Validation,
    );
    rejects(
        &mut e,
        "setInsertParams",
        json!({"id": q, "params": {"bands": [{"type": "peak", "freq_hz": 5}]}}),
        ErrorCode::Validation,
    );
}

#[test]
fn eq_response_and_dynamics_curve_are_read_only() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let q = ok(
        &mut e,
        "addInsert",
        json!({"track": t, "kind": "eq", "params": {"bands": [{"type": "peak", "freq_hz": 1000, "gain_db": 6, "q": 1}]}}),
    )["insert_id"]
        .as_u64()
        .unwrap();
    let c = ok(&mut e, "addInsert", json!({"track": t, "kind": "compressor"}))["insert_id"].as_u64().unwrap();
    let depth = undo_depth(&mut e);
    let r = ok(&mut e, "eqResponse", json!({"id": q, "points": 3}));
    let pts = r["points"].as_array().unwrap();
    assert_eq!(pts.len(), 3);
    assert_eq!(pts[0]["hz"], 20.0);
    assert_eq!(pts[2]["hz"], 20000.0);
    let mid = ok(&mut e, "eqResponse", json!({"id": q, "points": 513}));
    let peak = mid["points"].as_array().unwrap().iter().map(|p| p["db"].as_f64().unwrap()).fold(f64::MIN, f64::max);
    assert!((peak - 6.0).abs() < 0.05, "peak {peak}");
    let curve = ok(&mut e, "dynamicsCurve", json!({"id": c}));
    let pts = curve["points"].as_array().unwrap();
    assert_eq!(pts.len(), 61);
    assert_eq!(pts[0], json!({"in_db": -60.0, "out_db": -60.0}));
    // Defaults: threshold -18, ratio 3 → 0 dBFS in comes out at -12.
    assert_eq!(pts[60]["out_db"], -12.0);
    rejects(&mut e, "eqResponse", json!({"id": c}), ErrorCode::Validation);
    rejects(&mut e, "dynamicsCurve", json!({"id": q}), ErrorCode::Validation);
    rejects(&mut e, "eqResponse", json!({"id": q, "points": 1}), ErrorCode::Validation);
    assert_eq!(undo_depth(&mut e), depth, "read-only ops recorded undo");
}

#[test]
fn presets_list_and_apply_as_one_step() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    let list = ok(&mut e, "insertPresets", json!({"kind": "compressor"}));
    let ids: Vec<&str> = list["presets"].as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"vocal-level"));
    assert_eq!(list["presets"][0]["kind"], "compressor");
    let c = ok(&mut e, "addInsert", json!({"track": t, "kind": "compressor"}))["insert_id"].as_u64().unwrap();
    let before = describe(&mut e);
    ok(&mut e, "applyInsertPreset", json!({"id": c, "preset": "limiter"}));
    assert_eq!(describe(&mut e)["tracks"][0]["inserts"][0]["params"]["ratio"], 20.0);
    assert!(e.undo().unwrap());
    assert_eq!(describe(&mut e), before);
    // A preset from another kind is not found on this insert.
    rejects(&mut e, "applyInsertPreset", json!({"id": c, "preset": "telephone"}), ErrorCode::NotFound);
    rejects(&mut e, "insertPresets", json!({"kind": "flanger"}), ErrorCode::Validation);
}

// ---- groups and solo -------------------------------------------------------

#[test]
fn group_solo_and_mute_set_every_member_in_one_step() {
    let mut e = CadenceEngine::new();
    let (a, _) = tone_track(&mut e);
    let (b, _) = tone_track(&mut e);
    let (c, _) = tone_track(&mut e);
    ok(&mut e, "setTrackGroup", json!({"id": a, "group": " Drums "}));
    ok(&mut e, "setTrackGroup", json!({"id": b, "group": "Drums"}));
    assert_eq!(describe(&mut e)["tracks"][0]["group"], "Drums");
    let before = describe(&mut e);
    assert_eq!(ok(&mut e, "setGroupSolo", json!({"group": "Drums", "solo": true}))["tracks"], 2);
    let d = describe(&mut e);
    assert_eq!(d["tracks"][0]["solo"], true);
    assert_eq!(d["tracks"][1]["solo"], true);
    assert_eq!(d["tracks"][2]["solo"], false);
    assert!(e.undo().unwrap());
    assert_eq!(describe(&mut e), before);
    ok(&mut e, "setGroupMuted", json!({"group": "Drums", "muted": true}));
    assert_eq!(describe(&mut e)["tracks"][1]["muted"], true);
    rejects(&mut e, "setGroupSolo", json!({"group": "Keys", "solo": true}), ErrorCode::NotFound);
    rejects(&mut e, "setTrackGroup", json!({"id": c, "group": ""}), ErrorCode::Validation);
    rejects(&mut e, "setTrackGroup", json!({"id": c, "group": "x".repeat(65)}), ErrorCode::Validation);
    ok(&mut e, "setTrackGroup", json!({"id": a, "group": null}));
    assert_eq!(describe(&mut e)["tracks"][0]["group"], Value::Null);
}

#[test]
fn solo_safe_keeps_a_track_audible_under_another_solo() {
    let mut e = CadenceEngine::new();
    let (a, _) = tone_track(&mut e);
    let (b, _) = tone_track(&mut e);
    ok(&mut e, "setSolo", json!({"id": a, "solo": true}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02, "only the soloed track {l}");
    ok(&mut e, "setSoloSafe", json!({"id": b, "safe": true}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE * 2.0).abs() < 0.04, "soloed plus solo-safe {l}");
    // Solo-safe does not override mute.
    ok(&mut e, "setMuted", json!({"id": b, "muted": true}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02);
    rejects(&mut e, "setSoloSafe", json!({"id": b}), ErrorCode::InvalidCommand);
}

#[test]
fn soloing_a_bus_keeps_its_sources_audible() {
    let mut e = CadenceEngine::new();
    let (a, _) = tone_track(&mut e);
    let (_b, _) = tone_track(&mut e);
    let bus = bus(&mut e);
    ok(&mut e, "setTrackOutput", json!({"id": a, "output": bus}));
    ok(&mut e, "setSolo", json!({"id": bus, "solo": true}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02, "only the bus and its source {l}");
}

// ---- automation -------------------------------------------------------------

#[test]
fn automation_points_stay_sorted_and_validated() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    assert_eq!(ok(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 480, "value": 0.5}))["index"], 0);
    assert_eq!(ok(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 0, "value": 1.0}))["index"], 0);
    assert_eq!(ok(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 960, "value": 0.0}))["index"], 2);
    let lane = |e: &mut CadenceEngine| describe(e)["tracks"][0]["automation"]["gain"].clone();
    assert_eq!(lane(&mut e)["mode"], "off");
    assert_eq!(lane(&mut e)["points"][1], json!({"ticks": 480, "value": 0.5}));
    rejects(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 480, "value": 0.2}), ErrorCode::Validation);
    rejects(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 10, "value": 1.2}), ErrorCode::Validation);
    rejects(&mut e, "addAutomationPoint", json!({"track": t, "param": "pan", "ticks": 10, "value": -1.5}), ErrorCode::Validation);
    rejects(&mut e, "addAutomationPoint", json!({"track": t, "param": "tilt", "ticks": 10, "value": 0}), ErrorCode::Validation);
    ok(&mut e, "moveAutomationPoint", json!({"track": t, "param": "gain", "index": 1, "ticks": 500, "value": 0.25}));
    assert_eq!(lane(&mut e)["points"][1], json!({"ticks": 500, "value": 0.25}));
    rejects(&mut e, "moveAutomationPoint", json!({"track": t, "param": "gain", "index": 1, "ticks": 960, "value": 0.2}), ErrorCode::Validation);
    rejects(&mut e, "moveAutomationPoint", json!({"track": t, "param": "gain", "index": 9, "ticks": 10, "value": 0.2}), ErrorCode::OutOfBounds);
    ok(&mut e, "removeAutomationPoint", json!({"track": t, "param": "gain", "index": 0}));
    assert_eq!(lane(&mut e)["points"].as_array().unwrap().len(), 2);
    rejects(&mut e, "setAutomationMode", json!({"track": t, "param": "gain", "mode": "touch"}), ErrorCode::Validation);
}

#[test]
fn read_mode_automation_drives_the_render() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    ok(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 0, "value": 0.25}));
    // Off: the fader (1.0) still rules.
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02);
    ok(&mut e, "setAutomationMode", json!({"track": t, "param": "gain", "mode": "read"}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE * 0.25).abs() < 0.02, "automated gain {l}");
    // Pan automation hard right empties the left channel.
    ok(&mut e, "addAutomationPoint", json!({"track": t, "param": "pan", "ticks": 0, "value": 1.0}));
    ok(&mut e, "setAutomationMode", json!({"track": t, "param": "pan", "mode": "read"}));
    let (l, r) = peaks(&mut e);
    assert!(l < 1e-6 && r > 0.2, "pan automation l {l} r {r}");
}

#[test]
fn automation_ramps_between_points() {
    let mut e = CadenceEngine::new();
    let (t, _) = tone_track(&mut e);
    ok(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 0, "value": 0.0}));
    ok(&mut e, "addAutomationPoint", json!({"track": t, "param": "gain", "ticks": 960, "value": 1.0}));
    ok(&mut e, "setAutomationMode", json!({"track": t, "param": "gain", "mode": "read"}));
    let m = ok(&mut e, "meter", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 8000, "window_ms": 100}));
    let pk: Vec<f64> = m["master"]["peak"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert_eq!(pk.len(), 5);
    assert!(pk.windows(2).all(|w| w[1] > w[0]), "rising ramp {pk:?}");
}

// ---- notes ---------------------------------------------------------------------

#[test]
fn set_velocities_is_atomic_and_one_undo_step() {
    let mut e = CadenceEngine::new();
    let (_, c) = tone_track(&mut e);
    ok(&mut e, "addNote", json!({"clip": c, "pitch": 60, "start_ticks": 0, "length_ticks": 240}));
    ok(&mut e, "addNote", json!({"clip": c, "pitch": 62, "start_ticks": 240, "length_ticks": 240}));
    let before = describe(&mut e);
    ok(&mut e, "setVelocities", json!({"clip": c, "changes": [{"index": 0, "velocity": 10}, {"index": 2, "velocity": 30}]}));
    let notes = describe(&mut e)["tracks"][0]["clips"][0]["notes"].clone();
    assert_eq!(notes[0]["velocity"], 10);
    assert_eq!(notes[1]["velocity"], 100);
    assert_eq!(notes[2]["velocity"], 30);
    assert!(e.undo().unwrap());
    assert_eq!(describe(&mut e), before);
    for (bad, code) in [
        (json!({"clip": c, "changes": [{"index": 0, "velocity": 10}, {"index": 7, "velocity": 1}]}), ErrorCode::OutOfBounds),
        (json!({"clip": c, "changes": [{"index": 0, "velocity": 10}, {"index": 1, "velocity": 128}]}), ErrorCode::Validation),
        (json!({"clip": c, "changes": [{"index": 1, "velocity": 1}, {"index": 1, "velocity": 2}]}), ErrorCode::Validation),
        (json!({"clip": c, "changes": []}), ErrorCode::Validation),
        (json!({"clip": c}), ErrorCode::InvalidCommand),
        (json!({"clip": 4242, "changes": [{"index": 0, "velocity": 1}]}), ErrorCode::NotFound),
    ] {
        rejects(&mut e, "setVelocities", bad, code);
    }
}

#[test]
fn notes_carry_a_midi_channel() {
    let mut e = CadenceEngine::new();
    let (_, c) = tone_track(&mut e);
    assert_eq!(describe(&mut e)["tracks"][0]["clips"][0]["notes"][0]["channel"], 0);
    ok(&mut e, "addNote", json!({"clip": c, "pitch": 36, "channel": 9, "start_ticks": 0, "length_ticks": 120}));
    assert_eq!(describe(&mut e)["tracks"][0]["clips"][0]["notes"][1]["channel"], 9);
    ok(&mut e, "setNoteChannel", json!({"clip": c, "index": 0, "channel": 15}));
    assert_eq!(describe(&mut e)["tracks"][0]["clips"][0]["notes"][0]["channel"], 15);
    rejects(&mut e, "setNoteChannel", json!({"clip": c, "index": 0, "channel": 16}), ErrorCode::Validation);
    rejects(&mut e, "addNote", json!({"clip": c, "pitch": 60, "channel": -1, "start_ticks": 0, "length_ticks": 10}), ErrorCode::Validation);
    rejects(&mut e, "setNoteChannel", json!({"clip": c, "index": 5, "channel": 1}), ErrorCode::OutOfBounds);
}

// ---- clip split / gain / mute ------------------------------------------------------

#[test]
fn split_clip_cuts_notes_at_the_boundary() {
    let mut e = CadenceEngine::new();
    let (_, c) = tone_track(&mut e);
    ok(&mut e, "addNote", json!({"clip": c, "pitch": 60, "start_ticks": 240, "length_ticks": 480}));
    ok(&mut e, "addNote", json!({"clip": c, "pitch": 62, "start_ticks": 480, "length_ticks": 240}));
    ok(&mut e, "addNote", json!({"clip": c, "pitch": 64, "start_ticks": 720, "length_ticks": 240}));
    ok(&mut e, "setClipGain", json!({"id": c, "gain_db": -6.0}));
    let before = describe(&mut e);
    let r = ok(&mut e, "splitClip", json!({"id": c, "at_ticks": 480}));
    let right = r["right_id"].as_u64().unwrap();
    assert_eq!(r["left_id"], c);
    let clips = describe(&mut e)["tracks"][0]["clips"].clone();
    let arr = clips.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["id"], c);
    assert_eq!(arr[0]["start_ticks"], 0);
    assert_eq!(arr[0]["length_ticks"], 480);
    assert_eq!(arr[0]["gain_db"], -6.0, "gain copies to the split");
    // tone_track's A4 runs the whole clip, so it is cut in two as well; the
    // left half keeps [0,480) of it plus the left piece of the 240..720 note.
    assert_eq!(
        arr[0]["notes"],
        json!([
            {"pitch": 69, "velocity": 127, "start_ticks": 0, "length_ticks": 480, "channel": 0},
            {"pitch": 60, "velocity": 100, "start_ticks": 240, "length_ticks": 240, "channel": 0},
        ])
    );
    assert_eq!(arr[1]["id"], right);
    assert_eq!(arr[1]["start_ticks"], 480);
    assert_eq!(arr[1]["length_ticks"], 480);
    assert_eq!(arr[1]["gain_db"], -6.0);
    // Right halves of both spanning notes start at 0; later notes shift by 480.
    assert_eq!(
        arr[1]["notes"],
        json!([
            {"pitch": 69, "velocity": 127, "start_ticks": 0, "length_ticks": 480, "channel": 0},
            {"pitch": 60, "velocity": 100, "start_ticks": 0, "length_ticks": 240, "channel": 0},
            {"pitch": 62, "velocity": 100, "start_ticks": 0, "length_ticks": 240, "channel": 0},
            {"pitch": 64, "velocity": 100, "start_ticks": 240, "length_ticks": 240, "channel": 0},
        ])
    );
    // One undo step restores the whole clip.
    assert!(e.undo().unwrap());
    assert_eq!(describe(&mut e), before);
    // Splitting again at the same boundary point of the right clip works.
    let r2 = ok(&mut e, "splitClip", json!({"id": c, "at_ticks": 480}));
    ok(&mut e, "splitClip", json!({"id": r2["right_id"], "at_ticks": 720}));
    assert_eq!(describe(&mut e)["tracks"][0]["clips"].as_array().unwrap().len(), 3);
    for bad in [json!({"id": c, "at_ticks": 0}), json!({"id": c, "at_ticks": 960}), json!({"id": c, "at_ticks": 2000})] {
        rejects(&mut e, "splitClip", bad, ErrorCode::Validation);
    }
    rejects(&mut e, "splitClip", json!({"id": 4242, "at_ticks": 480}), ErrorCode::NotFound);
    rejects(&mut e, "splitClip", json!({"id": c}), ErrorCode::InvalidCommand);
}

#[test]
fn split_clip_on_an_audio_clip_and_empty_clip() {
    let mut e = CadenceEngine::new();
    let t = ok(&mut e, "addTrack", json!({"kind": "audio"}))["track_id"].as_u64().unwrap();
    let c = ok(&mut e, "addClip", json!({"track": t, "start_ticks": 100, "length_ticks": 400}))["clip_id"]
        .as_u64()
        .unwrap();
    let r = ok(&mut e, "splitClip", json!({"id": c, "at_ticks": 300}));
    let clips = describe(&mut e)["tracks"][0]["clips"].clone();
    assert_eq!(clips[0]["start_ticks"], 100);
    assert_eq!(clips[0]["length_ticks"], 200);
    assert_eq!(clips[1]["start_ticks"], 300);
    assert_eq!(clips[1]["length_ticks"], 200);
    assert_eq!(clips[1]["id"], r["right_id"]);
    // An empty clip still splits; a clip cannot split at its own edges.
    let m = ok(&mut e, "addTrack", json!({}))["track_id"].as_u64().unwrap();
    let e1 = ok(&mut e, "addClip", json!({"track": m, "start_ticks": 0, "length_ticks": 100}))["clip_id"]
        .as_u64()
        .unwrap();
    ok(&mut e, "splitClip", json!({"id": e1, "at_ticks": 50}));
    rejects(&mut e, "splitClip", json!({"id": e1, "at_ticks": 100}), ErrorCode::Validation);
}

#[test]
fn clip_gain_and_mute_reach_the_render_and_meter() {
    let mut e = CadenceEngine::new();
    let (_, c) = tone_track(&mut e);
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02, "unity {l}");
    ok(&mut e, "setClipGain", json!({"id": c, "gain_db": -6.0206}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE * 0.5).abs() < 0.02, "-6 dB clip {l}");
    ok(&mut e, "setClipMute", json!({"id": c, "muted": true}));
    assert_eq!(peaks(&mut e), (0.0, 0.0), "muted clip is silent");
    // The meter sees the same silence.
    let m = ok(&mut e, "meter", json!({"from_ticks": 240, "to_ticks": 720, "sample_rate": 8000}));
    assert_eq!(m["tracks"][0]["max_peak"], 0.0);
    // One undo each; gain survives a mute toggle.
    ok(&mut e, "setClipMute", json!({"id": c, "muted": false}));
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE * 0.5).abs() < 0.02, "unmuted keeps gain {l}");
    // Three undo steps: unmute, mute, gain — back to the untouched clip.
    assert!(e.undo().unwrap());
    assert!(e.undo().unwrap());
    assert!(e.undo().unwrap());
    let (l, _) = peaks(&mut e);
    assert!((l - CENTRE).abs() < 0.02, "undo restores unity {l}");
    for (bad, code) in [
        (json!({"id": c, "gain_db": 13}), ErrorCode::Validation),
        (json!({"id": c, "gain_db": -61}), ErrorCode::Validation),
        (json!({"id": c, "gain_db": "loud"}), ErrorCode::InvalidCommand),
        (json!({"id": 999, "gain_db": 0}), ErrorCode::NotFound),
        (json!({"id": c}), ErrorCode::InvalidCommand),
    ] {
        rejects(&mut e, "setClipGain", bad, code);
    }
    rejects(&mut e, "setClipMute", json!({"id": c}), ErrorCode::InvalidCommand);
    rejects(&mut e, "setClipMute", json!({"id": 999, "muted": true}), ErrorCode::NotFound);
}

#[test]
fn clip_gain_defaults_on_pre_field_snapshots() {
    let old = json!({
        "tempo_bpm": 120.0, "time_sig": [4, 4], "ppq": 960, "playhead_ticks": 0, "next_id": 3,
        "tracks": [{"id": 1, "name": "Keys", "kind": "midi", "volume": 1.0, "pan": 0.0, "muted": false, "solo": false,
            "clips": [{"id": 2, "start_ticks": 0, "length_ticks": 960,
                "notes": [{"pitch": 60, "velocity": 100, "start_ticks": 0, "length_ticks": 240}]}]}]
    });
    let mut e = CadenceEngine::new();
    e.restore(&encode_envelope(&serde_json::to_vec(&old).unwrap())).unwrap();
    let clip = describe(&mut e)["tracks"][0]["clips"][0].clone();
    assert_eq!(clip["gain_db"], 0.0);
    assert_eq!(clip["muted"], false);
}

// ---- metronome ------------------------------------------------------------------

#[test]
fn metronome_clicks_only_when_enabled_and_requested() {
    let mut e = CadenceEngine::new();
    let range = json!({"from_ticks": 0, "to_ticks": 3840, "sample_rate": 8000, "include_metronome": true});
    let silent = |e: &mut CadenceEngine, p: Value| {
        let r = ok(e, "render", p);
        b64(r["samples_b64"].as_str().unwrap()).iter().all(|&b| b == 0)
    };
    assert!(silent(&mut e, range.clone()), "disabled metronome is silent");
    ok(&mut e, "setMetronome", json!({"enabled": true, "volume": 0.8}));
    assert_eq!(describe(&mut e)["metronome"], json!({"enabled": true, "volume": 0.8}));
    assert!(!silent(&mut e, range.clone()));
    // Bounces leave the click out unless asked.
    assert!(silent(&mut e, json!({"from_ticks": 0, "to_ticks": 3840, "sample_rate": 8000})));
    // Four beats in a 4/4 bar: four click onsets.
    let m = ok(&mut e, "meter", json!({"from_ticks": 0, "to_ticks": 3840, "sample_rate": 8000, "window_ms": 50, "include_metronome": true}));
    let pk: Vec<f64> = m["master"]["peak"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let onsets = pk.windows(2).filter(|w| w[0] < 0.01 && w[1] > 0.1).count() + usize::from(pk[0] > 0.1);
    assert_eq!(onsets, 4, "{pk:?}");
    rejects(&mut e, "setMetronome", json!({"enabled": true, "volume": 2}), ErrorCode::Validation);
    rejects(&mut e, "setMetronome", json!({}), ErrorCode::InvalidCommand);
}

// ---- analysis ---------------------------------------------------------------------

#[test]
fn meter_reports_each_track_and_the_master() {
    let mut e = CadenceEngine::new();
    let (a, _) = tone_track(&mut e);
    let (b, _) = tone_track(&mut e);
    ok(&mut e, "setMuted", json!({"id": b, "muted": true}));
    let depth = undo_depth(&mut e);
    let m = ok(&mut e, "meter", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 8000}));
    assert_eq!(m["window_frames"], 400);
    let tracks = m["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 2);
    assert_eq!(tracks[0]["id"], a);
    assert!((tracks[0]["max_peak"].as_f64().unwrap() - CENTRE).abs() < 0.02);
    assert_eq!(tracks[1]["max_peak"], 0.0, "muted track meters silence");
    assert_eq!(m["master"]["clipped"], false);
    assert_eq!(undo_depth(&mut e), depth);
    rejects(&mut e, "meter", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 8000, "window_ms": 1}), ErrorCode::Validation);
    rejects(&mut e, "meter", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 100}), ErrorCode::Validation);
    rejects(&mut e, "meter", json!({"from_ticks": 0, "to_ticks": 3_840_000, "sample_rate": 48000, "window_ms": 5}), ErrorCode::Validation);
}

#[test]
fn loudness_and_spectrogram_ops() {
    let mut e = CadenceEngine::new();
    tone_track(&mut e);
    let l = ok(&mut e, "loudness", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000}));
    assert!(l["integrated_lufs"].as_f64().unwrap() < 0.0);
    assert!(l["momentary_lufs"].as_array().unwrap().len() >= 1);
    let s = ok(&mut e, "spectrogram", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000, "fft_size": 1024, "bands": 16}));
    assert_eq!(s["bands_hz"].as_array().unwrap().len(), 16);
    assert!(s["frames"].as_array().unwrap().len() > 10);
    rejects(&mut e, "spectrogram", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000, "fft_size": 1000}), ErrorCode::Validation);
    rejects(&mut e, "spectrogram", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000, "hop": 0}), ErrorCode::Validation);
    rejects(&mut e, "spectrogram", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000, "bands": 4}), ErrorCode::Validation);
}

#[test]
fn detect_beats_finds_the_metronome_pulse() {
    let mut e = CadenceEngine::new();
    ok(&mut e, "setMetronome", json!({"enabled": true, "volume": 1.0}));
    let depth = undo_depth(&mut e);
    // Eight beats at 120 BPM in the 4 s range; the click sitting on the
    // first STFT frame edge can be missed, so assert the pulse, not a count.
    let r = ok(
        &mut e,
        "detectBeats",
        json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000, "include_metronome": true}),
    );
    let onsets = r["onsets_seconds"].as_array().unwrap();
    assert!(onsets.len() >= 4, "{r}");
    let times: Vec<f64> = onsets.iter().map(|v| v.as_f64().unwrap()).collect();
    for w in times.windows(2) {
        assert!((w[1] - w[0] - 0.5).abs() < 0.15, "beat spacing {times:?}");
    }
    let bpm = r["estimated_bpm"].as_f64().unwrap();
    assert!((80.0..=160.0).contains(&bpm), "bpm {bpm}");
    // Without the metronome requested the mix is silent: no onsets, no bpm.
    let silent = ok(&mut e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000}));
    assert_eq!(silent["onsets_seconds"].as_array().unwrap().len(), 0);
    assert!(silent["estimated_bpm"].is_null());
    assert_eq!(undo_depth(&mut e), depth, "read-only op recorded undo");
    rejects(&mut e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 100}), ErrorCode::Validation);
    rejects(&mut e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000, "fft_size": 1000}), ErrorCode::Validation);
    rejects(&mut e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000, "hop": 0}), ErrorCode::Validation);
    // hop 1 over ~2.6 s at 8 kHz exceeds the frame cap before any FFT runs.
    rejects(
        &mut e,
        "detectBeats",
        json!({"from_ticks": 0, "to_ticks": 5000, "sample_rate": 8000, "fft_size": 256, "hop": 1}),
        ErrorCode::Validation,
    );
}

#[test]
fn detect_beats_on_a_steady_tone_has_no_pulse() {
    let mut e = CadenceEngine::new();
    tone_track(&mut e);
    let r = ok(&mut e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 8000}));
    // One attack transient at most; below the four-onset floor for bpm.
    assert!(r["onsets_seconds"].as_array().unwrap().len() <= 1, "{r}");
    assert!(r["estimated_bpm"].is_null());
}

// ---- detectBeats sensitivity (E-35) --------------------------------------------------

/// Sixteen A5 notes an eighth apart over 4 s at 120 BPM, alternating
/// velocity 127 (on the beat) and `quiet` (between beats).
fn accent_doc(quiet: u64) -> CadenceEngine {
    let mut e = CadenceEngine::new();
    let t = ok(&mut e, "addTrack", json!({}))["track_id"].as_u64().unwrap();
    let c = ok(&mut e, "addClip", json!({"track": t, "start_ticks": 0, "length_ticks": 7680}))["clip_id"]
        .as_u64()
        .unwrap();
    for i in 0..16u64 {
        let v = if i % 2 == 0 { 127 } else { quiet };
        ok(&mut e, "addNote", json!({"clip": c, "pitch": 81, "velocity": v, "start_ticks": i * 480, "length_ticks": 96}));
    }
    e
}

/// Output recorded from `detectBeats` at master `0ad4ed2`+F3 proposals
/// (`1167e13`), before `sensitivity` existed. Sensitivity omitted and 0.5
/// must reproduce every one exactly.
#[test]
fn sensitivity_half_reproduces_the_recorded_pre_sensitivity_output() {
    let metro = |sr: u64, fft: Option<u64>, hop: Option<u64>| {
        let mut p = json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": sr, "include_metronome": true});
        if let Some(f) = fft {
            p["fft_size"] = json!(f);
        }
        if let Some(h) = hop {
            p["hop"] = json!(h);
        }
        p
    };
    let mut clicks = CadenceEngine::new();
    ok(&mut clicks, "setMetronome", json!({"enabled": true, "volume": 1.0}));
    let mut tone = CadenceEngine::new();
    tone_track(&mut tone);
    let mut accent = accent_doc(12);
    let golden: Vec<(u8, Value, Value)> = vec![
        (0, metro(8000, None, None), json!({"estimated_bpm":117.2,"hop_seconds":0.064,"onsets_seconds":[0.512,1.024,1.472,1.984,2.496,3.008,3.52]})),
        (0, metro(48000, Some(2048), Some(512)), json!({"estimated_bpm":119.7,"hop_seconds":0.010666666666666666,"onsets_seconds":[0.491,0.992,1.493,1.995,2.496,2.997,3.499]})),
        (0, metro(8000, Some(256), Some(64)), json!({"estimated_bpm":60.0,"hop_seconds":0.008,"onsets_seconds":[0.496,1.0,1.496,2.0,2.496,3.0,3.496]})),
        (1, json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 8000}), json!({"estimated_bpm":null,"hop_seconds":0.064,"onsets_seconds":[]})),
        (2, json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000}), json!({"estimated_bpm":117.2,"hop_seconds":0.064,"onsets_seconds":[0.512,1.024,1.536,1.984,2.496,3.008,3.52]})),
    ];
    for (which, payload, expected) in golden {
        let e = match which {
            0 => &mut clicks,
            1 => &mut tone,
            _ => &mut accent,
        };
        assert_eq!(ok(e, "detectBeats", payload.clone()), expected, "omitted {payload}");
        let mut half = payload.clone();
        half["sensitivity"] = json!(0.5);
        assert_eq!(ok(e, "detectBeats", half), expected, "0.5 {payload}");
    }
}

#[test]
fn sensitivity_moves_the_onset_threshold() {
    // With quiet notes at velocity 30 the default threshold keeps only the
    // seven loud beats; sensitivity 1.0 also admits the quiet notes.
    let mut e = accent_doc(30);
    let depth = undo_depth(&mut e);
    let count = |e: &mut CadenceEngine, s: f64| {
        ok(e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000, "sensitivity": s}))
            ["onsets_seconds"]
            .as_array()
            .unwrap()
            .len()
    };
    let (low, mid, high) = (count(&mut e, 0.0), count(&mut e, 0.5), count(&mut e, 1.0));
    assert!(low <= mid && mid <= high, "{low} {mid} {high}");
    assert_eq!(mid, 7, "default finds the loud beats only");
    assert!(high >= 14, "1.0 finds the quiet notes too: {high}");
    assert!(low < mid, "0.0 is stricter than the default: {low}");
    assert_eq!(undo_depth(&mut e), depth, "read-only op recorded undo");
    for bad in [json!(1.5), json!(-0.1)] {
        rejects(&mut e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000, "sensitivity": bad}), ErrorCode::Validation);
    }
    rejects(&mut e, "detectBeats", json!({"from_ticks": 0, "to_ticks": 7680, "sample_rate": 8000, "sensitivity": "high"}), ErrorCode::InvalidCommand);
}

// ---- markers (E-35) ------------------------------------------------------------------

fn markers(e: &mut CadenceEngine) -> Vec<Value> {
    ok(e, "listMarkers", json!({}))["markers"].as_array().unwrap().clone()
}

#[test]
fn add_markers_is_one_undo_step_and_round_trips() {
    let mut e = CadenceEngine::new();
    let depth = undo_depth(&mut e);
    let r = ok(
        &mut e,
        "addMarkers",
        json!({"markers": [{"ticks": 1920}, {"ticks": 0, "name": " Intro "}, {"ticks": 960, "length_ticks": 480, "note": "fill"}, {"ticks": 2880}]}),
    );
    let ids: Vec<u64> = r["marker_ids"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap()).collect();
    assert_eq!(ids.len(), 4);
    assert_eq!(undo_depth(&mut e), depth + 1, "batch is one undo step");
    let m = markers(&mut e);
    // Listed by ticks; ids follow input order; default names count up.
    let ticks: Vec<u64> = m.iter().map(|v| v["ticks"].as_u64().unwrap()).collect();
    assert_eq!(ticks, vec![0, 960, 1920, 2880]);
    assert_eq!(m[0]["id"], ids[1]);
    assert_eq!(m[0]["name"], "Intro");
    assert_eq!(m[2]["name"], "Marker 1");
    assert_eq!(m[3]["name"], "Marker 4");
    assert_eq!(m[1]["length_ticks"], 480);
    assert_eq!(m[1]["note"], "fill");
    assert!(m[0].get("note").is_none());

    assert!(e.undo().unwrap());
    assert!(markers(&mut e).is_empty());
    assert!(e.redo().unwrap());
    assert_eq!(markers(&mut e), m);

    // Save and load.
    let snap = e.snapshot().unwrap();
    let mut e2 = CadenceEngine::new();
    e2.restore(&snap).unwrap();
    assert_eq!(markers(&mut e2), m);
    // A new id after restore does not collide with a marker id.
    let next = ok(&mut e2, "addMarker", json!({"ticks": 10}))["marker_id"].as_u64().unwrap();
    assert!(ids.iter().all(|&i| i < next));
}

#[test]
fn update_and_remove_marker() {
    let mut e = CadenceEngine::new();
    let id = ok(&mut e, "addMarker", json!({"ticks": 960, "note": "x"}))["marker_id"].as_u64().unwrap();
    let other = ok(&mut e, "addMarker", json!({"ticks": 1920}))["marker_id"].as_u64().unwrap();
    let depth = undo_depth(&mut e);
    ok(&mut e, "updateMarker", json!({"id": id, "ticks": 2880, "name": "Drop"}));
    assert_eq!(undo_depth(&mut e), depth + 1);
    let m = markers(&mut e);
    // The id is kept and the list re-sorts by ticks.
    assert_eq!(m[0]["id"], other);
    assert_eq!(m[1]["id"], id);
    assert_eq!(m[1]["ticks"], 2880);
    assert_eq!(m[1]["name"], "Drop");
    assert_eq!(m[1]["note"], "x");
    // null clears the note; an unchanged patch records nothing.
    ok(&mut e, "updateMarker", json!({"id": id, "note": null}));
    assert!(markers(&mut e)[1].get("note").is_none());
    let depth = undo_depth(&mut e);
    ok(&mut e, "updateMarker", json!({"id": id, "ticks": 2880}));
    assert_eq!(undo_depth(&mut e), depth, "no-op update recorded undo");
    assert!(e.undo().unwrap());
    assert_eq!(markers(&mut e)[1]["note"], "x");

    ok(&mut e, "removeMarker", json!({"id": other}));
    assert_eq!(markers(&mut e).len(), 1);
    assert!(e.undo().unwrap());
    assert_eq!(markers(&mut e).len(), 2);
}

#[test]
fn marker_ops_validate_before_mutating() {
    let mut e = CadenceEngine::new();
    let id = ok(&mut e, "addMarker", json!({"ticks": 0}))["marker_id"].as_u64().unwrap();
    let max = (1u64 << 53) - 1;
    let long = "n".repeat(121);
    let note = "n".repeat(2001);
    for (op, p, code) in [
        ("addMarker", json!({}), ErrorCode::InvalidCommand),
        ("addMarker", json!({"ticks": -1}), ErrorCode::Validation),
        ("addMarker", json!({"ticks": max, "length_ticks": 1}), ErrorCode::OutOfBounds),
        ("addMarker", json!({"ticks": 0, "name": "  "}), ErrorCode::Validation),
        ("addMarker", json!({"ticks": 0, "name": long}), ErrorCode::Validation),
        ("addMarker", json!({"ticks": 0, "note": note}), ErrorCode::Validation),
        ("addMarker", json!({"ticks": 0, "seconds": 1}), ErrorCode::InvalidCommand),
        ("addMarkers", json!({"markers": []}), ErrorCode::Validation),
        ("addMarkers", json!({}), ErrorCode::InvalidCommand),
        // One bad entry rejects the whole batch.
        ("addMarkers", json!({"markers": [{"ticks": 0}, {"ticks": 0, "name": ""}]}), ErrorCode::Validation),
        ("updateMarker", json!({"id": id}), ErrorCode::InvalidCommand),
        ("updateMarker", json!({"id": 999, "ticks": 1}), ErrorCode::NotFound),
        ("updateMarker", json!({"id": id, "name": null}), ErrorCode::Validation),
        ("updateMarker", json!({"id": id, "bogus": 1}), ErrorCode::InvalidCommand),
        ("removeMarker", json!({"id": 999}), ErrorCode::NotFound),
    ] {
        rejects(&mut e, op, p, code);
    }
    let too_many: Vec<Value> = (0..8192).map(|i| json!({"ticks": i})).collect();
    rejects(&mut e, "addMarkers", json!({"markers": too_many}), ErrorCode::OutOfBounds);
    let fill: Vec<Value> = (0..8191).map(|i| json!({"ticks": i})).collect();
    ok(&mut e, "addMarkers", json!({"markers": fill}));
    rejects(&mut e, "addMarker", json!({"ticks": 0}), ErrorCode::OutOfBounds);
}

#[test]
fn restore_validates_markers_and_accepts_saves_without_them() {
    let mut e = CadenceEngine::new();
    ok(&mut e, "addMarker", json!({"ticks": 0}));
    let doc = describe(&mut e);
    let before = doc.clone();
    for mutate in [
        |d: &mut Value| d["markers"][0]["name"] = json!(""),
        |d: &mut Value| d["markers"][0]["ticks"] = json!(1u64 << 53),
        |d: &mut Value| d["markers"][0]["extra"] = json!(1),
        |d: &mut Value| d["markers"][0]["id"] = json!(0),
        |d: &mut Value| d["markers"][0]["id"] = json!(1u64 << 53),
        |d: &mut Value| d["markers"] = json!([d["markers"][0].clone(), d["markers"][0].clone()]),
    ] {
        let mut bad = doc.clone();
        mutate(&mut bad);
        assert!(e.restore(&encode_envelope(&serde_json::to_vec(&bad).unwrap())).is_err());
        assert_eq!(describe(&mut e), before);
    }
    // A project saved before markers existed has no `markers` key.
    let mut old = doc.clone();
    old.as_object_mut().unwrap().remove("markers");
    e.restore(&encode_envelope(&serde_json::to_vec(&old).unwrap())).unwrap();
    assert!(markers(&mut e).is_empty());
    // A marker-less project still saves without the key.
    let bytes = e.snapshot().unwrap();
    let (_t, payload) = ignition_core::decode_envelope(&bytes).unwrap();
    let saved: Value = serde_json::from_slice(payload).unwrap();
    assert!(saved.get("markers").is_none());
}

#[test]
fn restored_markers_are_sorted_by_ticks_then_id_before_commit() {
    let mut e = CadenceEngine::new();
    ok(&mut e, "addMarkers", json!({"markers": [{"ticks": 960}, {"ticks": 0}, {"ticks": 960}]}));
    let expected = markers(&mut e);
    let mut reordered = describe(&mut e);
    reordered["markers"].as_array_mut().unwrap().reverse();
    e.restore(&encode_envelope(&serde_json::to_vec(&reordered).unwrap())).unwrap();
    assert_eq!(markers(&mut e), expected);
    assert!(!e.undo().unwrap(), "successful restore resets history");
}

#[test]
fn marker_id_exhaustion_rejects_before_journal_or_document_mutation() {
    let mut e = CadenceEngine::new();
    let max_id = (1u64 << 53) - 1;
    let mut restored = describe(&mut e);
    restored["next_id"] = json!(max_id);
    e.restore(&encode_envelope(&serde_json::to_vec(&restored).unwrap())).unwrap();
    rejects(&mut e, "addMarkers", json!({"markers": [{"ticks": 0}, {"ticks": 1}]}), ErrorCode::OutOfBounds);
    assert_eq!(ok(&mut e, "addMarker", json!({"ticks": 0}))["marker_id"], max_id);
    rejects(&mut e, "addMarker", json!({"ticks": 1}), ErrorCode::OutOfBounds);
    assert!(e.undo().unwrap());
    assert!(markers(&mut e).is_empty());
    assert!(e.redo().unwrap());
    assert_eq!(markers(&mut e)[0]["id"], max_id);
}

// ---- compatibility -------------------------------------------------------------------

#[test]
fn snapshots_from_before_the_mixer_fields_restore() {
    let old = json!({
        "tempo_bpm": 120.0, "time_sig": [4, 4], "ppq": 960, "playhead_ticks": 0, "next_id": 3,
        "tracks": [{"id": 1, "name": "Keys", "kind": "midi", "volume": 1.0, "pan": 0.0, "muted": false, "solo": false,
            "clips": [{"id": 2, "start_ticks": 0, "length_ticks": 960,
                "notes": [{"pitch": 60, "velocity": 100, "start_ticks": 0, "length_ticks": 240}]}]}]
    });
    let mut e = CadenceEngine::new();
    e.restore(&encode_envelope(&serde_json::to_vec(&old).unwrap())).unwrap();
    let d = describe(&mut e);
    assert_eq!(d["metronome"]["enabled"], false);
    assert_eq!(d["tracks"][0]["output"], Value::Null);
    assert_eq!(d["tracks"][0]["inserts"], json!([]));
    assert_eq!(d["tracks"][0]["automation"]["gain"]["mode"], "off");
    assert_eq!(d["tracks"][0]["clips"][0]["notes"][0]["channel"], 0);
}

// ---- renderStems -----------------------------------------------------------------

#[test]
fn render_stems_returns_one_post_fader_stem_per_track_and_bus() {
    let mut e = CadenceEngine::new();
    let (a, _) = tone_track(&mut e);
    let (b, _) = tone_track(&mut e);
    ok(&mut e, "setMuted", json!({"id": b, "muted": true}));
    let bus = bus(&mut e);
    ok(&mut e, "setTrackOutput", json!({"id": a, "output": bus}));
    ok(&mut e, "setTrackGain", json!({"id": bus, "volume": 0.5}));
    let depth = undo_depth(&mut e);
    let r = ok(&mut e, "renderStems", json!({"from_ticks": 240, "to_ticks": 720, "sample_rate": 8000}));
    assert_eq!(r["frames"], 2000);
    assert_eq!(r["channels"], 2);
    // Document order: track a, track b, bus.
    assert_eq!(r["stems"], json!([{"id": a}, {"id": b}, {"id": bus}]));
    let bytes = b64(r["stems_b64"].as_str().unwrap());
    assert_eq!(bytes.len(), 3 * 2000 * 8, "three stereo f32 stems");
    let f: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let peak = |stem: usize| -> f64 {
        let base = stem * 2000 * 2;
        (0..2000).fold(0f64, |m, i| m.max(f[base + i * 2].abs() as f64).max(f[base + i * 2 + 1].abs() as f64))
    };
    // Track a sounds through its own stem; muted b is silent; the bus stem
    // carries a's signal at the bus fader.
    assert!((peak(0) - CENTRE).abs() < 0.02, "stem a {}", peak(0));
    assert_eq!(peak(1), 0.0, "muted stem b");
    assert!((peak(2) - CENTRE * 0.5).abs() < 0.02, "bus stem {}", peak(2));
    // Read-only: no undo entries, no events recorded by `ok`.
    assert_eq!(undo_depth(&mut e), depth);
    rejects(&mut e, "renderStems", json!({"from_ticks": 720, "to_ticks": 240, "sample_rate": 8000}), ErrorCode::Validation);
    rejects(&mut e, "renderStems", json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 0}), ErrorCode::Validation);
}

#[test]
fn task_render_stems_matches_sync_output() {
    use ignition_core::{base64_decode, TaskContext};
    let mut e = CadenceEngine::new();
    tone_track(&mut e);
    let payload = json!({"from_ticks":0,"to_ticks":960,"sample_rate":48000});
    let before = e.snapshot().unwrap();
    let legacy = e.apply(Command::new("renderStems",payload.clone())).unwrap();
    let context = TaskContext::new();
    let task = e.apply_long(Command::new("renderStems",payload).with_binary(None), &context).unwrap();
    assert_eq!(task.output.unwrap(), base64_decode(legacy.data["stems_b64"].as_str().unwrap()).unwrap());
    assert_eq!(context.progress(),1.0);
    assert_eq!(e.snapshot().unwrap(),before);
}

#[test]
fn task_render_can_cancel_inside_synthesis(){
 use ignition_core::{Engine,TaskContext};
 let mut e=CadenceEngine::new();
 let track=e.apply(Command::new("addTrack",json!({"kind":"midi"}))).unwrap().data["track_id"].as_u64().unwrap();
 let clip=e.apply(Command::new("addClip",json!({"track":track,"start_ticks":0,"length_ticks":57600}))).unwrap().data["clip_id"].as_u64().unwrap();
 e.apply(Command::new("addNote",json!({"clip":clip,"pitch":69,"velocity":100,"start_ticks":0,"length_ticks":57600}))).unwrap();
 let before=e.snapshot().unwrap();let ctx=TaskContext::new();let observer=ctx.clone();
 let worker=std::thread::spawn(move||{let result=e.apply_long(Command::new("render",json!({"from_ticks":0,"to_ticks":57600,"sample_rate":48000})).with_binary(None),&ctx);(e,result)});
 while observer.progress()==0.0 && !worker.is_finished(){std::thread::yield_now();}
 observer.cancel();let (e,result)=worker.join().unwrap();assert_eq!(result.unwrap_err().code,ignition_core::ErrorCode::Cancelled);assert_eq!(e.snapshot().unwrap(),before);
}

#[test]
fn task_batch_render_step_can_cancel_inside_synthesis(){
 use ignition_core::{Engine,TaskContext};
 let mut e=CadenceEngine::new();
 let track=e.apply(Command::new("addTrack",json!({"kind":"midi"}))).unwrap().data["track_id"].as_u64().unwrap();
 let clip=e.apply(Command::new("addClip",json!({"track":track,"start_ticks":0,"length_ticks":57600}))).unwrap().data["clip_id"].as_u64().unwrap();
 e.apply(Command::new("addNote",json!({"clip":clip,"pitch":69,"velocity":100,"start_ticks":0,"length_ticks":57600}))).unwrap();
 let before=e.snapshot().unwrap();let ctx=TaskContext::new();let observer=ctx.clone();
 // A render step inside __batch must reach apply_long so synthesis checkpoints
 // observe the task context instead of running uninterruptible.
 let worker=std::thread::spawn(move||{let result=e.apply_long(Command::new("__batch",json!({"commands":[{"op":"render","payload":{"from_ticks":0,"to_ticks":57600,"sample_rate":48000}}]})),&ctx);(e,result)});
 while observer.progress()==0.0 && !worker.is_finished(){std::thread::yield_now();}
 observer.cancel();let (e,result)=worker.join().unwrap();assert_eq!(result.unwrap_err().code,ignition_core::ErrorCode::Cancelled);assert_eq!(e.snapshot().unwrap(),before);
}

#[test]
fn task_and_legacy_render_keep_identical_effect_output() {
    use ignition_core::{base64_decode, TaskContext};
    let mut e = CadenceEngine::new();
    let (track, _) = tone_track(&mut e);
    ok(&mut e, "addInsert", json!({"track":track,"kind":"eq"}));
    ok(&mut e, "addInsert", json!({"track":track,"kind":"compressor"}));
    let payload = json!({"from_ticks":0,"to_ticks":960,"sample_rate":48000});
    let before = e.snapshot().unwrap();
    let legacy = e.apply(Command::new("render",payload.clone())).unwrap();
    let context = TaskContext::new();
    let task = e.apply_long(Command::new("render",payload).with_binary(None), &context).unwrap();
    assert_eq!(task.output.unwrap(), base64_decode(legacy.data["samples_b64"].as_str().unwrap()).unwrap());
    assert_eq!(context.progress(),1.0);
    assert_eq!(e.snapshot().unwrap(),before);
}
