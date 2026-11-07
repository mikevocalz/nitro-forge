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
