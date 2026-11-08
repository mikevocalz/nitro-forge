//! Integration tests for splice-render: real composites of generated
//! RGBA8 frames through every transition kind, speed-keys retime,
//! audio mix levels, render-cache hit/miss, and hostile bounds.
//!
//! All inputs are synthetic — solid-color RGBA8 frames and constant
//! PCM — so every expectation is exact, not approximate.

use ignition_core::{base64_decode, base64_encode, ErrorCode, FrameRequest};
use serde_json::{json, Value};
use splice_render::RenderService;

// ---- fixture helpers ------------------------------------------------------

const W: u32 = 4;
const H: u32 = 4;

fn solid(r: u8, g: u8, b: u8) -> Vec<u8> {
    let mut px = Vec::with_capacity((W * H * 4) as usize);
    for _ in 0..W * H {
        px.extend_from_slice(&[r, g, b, 255]);
    }
    px
}

fn frame(t: f64, px: &[u8]) -> Value {
    json!({ "t_s": t, "bytes_b64": base64_encode(px) })
}

fn vsource(frames: Vec<Value>) -> Value {
    json!({ "width": W, "height": H, "frames": frames })
}

fn clip(
    id: u64,
    source: u64,
    start: f64,
    end: f64,
    in_s: f64,
    out_s: f64,
) -> Value {
    json!({
        "clip_id": id,
        "track_id": 1,
        "track_kind": "video",
        "track_active": true,
        "source_id": source,
        "timeline_start_s": start,
        "timeline_end_s": end,
        "in_s": in_s,
        "out_s": out_s,
        "speed": 1.0,
        "speed_keys": [],
        "gain_db": 0.0,
        "pan": 0.0,
    })
}

fn aclip(
    id: u64,
    source: u64,
    start: f64,
    end: f64,
    in_s: f64,
    out_s: f64,
) -> Value {
    let mut c = clip(id, source, start, end, in_s, out_s);
    c["track_kind"] = json!("audio");
    c
}

fn plan(tracks: Vec<Vec<Value>>, transitions: Vec<Vec<Value>>) -> Value {
    json!({ "tracks": tracks, "transitions": transitions })
}

fn trans(kind: &str, left: u64, right: u64, start: f64, end: f64, dur: f64) -> Value {
    json!({
        "transition_id": 1,
        "kind": kind,
        "left_clip_id": left,
        "right_clip_id": right,
        "cut_s": (start + end) / 2.0,
        "start_s": start,
        "end_s": end,
        "duration_s": dur,
    })
}

fn call(svc: &mut RenderService, id: u64, op: &str, payload: Value) -> Value {
    let res = svc.handle_frame(&FrameRequest {
        id,
        handle: 0,
        op: op.to_string(),
        payload,
    });
    assert!(res.ok, "op {op} failed: {:?}", res.error);
    res.data.unwrap()
}

fn call_err(svc: &mut RenderService, op: &str, payload: Value) -> ErrorCode {
    let res = svc.handle_frame(&FrameRequest {
        id: 99,
        handle: 0,
        op: op.to_string(),
        payload,
    });
    assert!(!res.ok, "op {op} unexpectedly succeeded");
    res.error.unwrap().code
}

/// Unique media salt per call: the render cache is keyed by caller
/// salts, so tests that vary the plan/sources must vary the salt too
/// (that is the documented contract — the salt identifies the decoded
/// inputs).
fn render(svc: &mut RenderService, plan: &Value, sources: Value, t: f64) -> Vec<u8> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let salt = N.fetch_add(1, Ordering::Relaxed);
    let data = call(
        svc,
        1,
        "renderFrame",
        json!({
            "width": W, "height": H, "time_s": t,
            "snapshot": "snap", "media": format!("m{salt}"),
            "plan": plan, "sources": sources,
        }),
    );
    base64_decode(data["bytes_b64"].as_str().unwrap()).unwrap()
}

fn px(frame: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [frame[i], frame[i + 1], frame[i + 2], frame[i + 3]]
}

fn uniform(frame: &[u8]) -> [u8; 4] {
    px(frame, 0, 0)
}

// ---- tests -----------------------------------------------------------------

#[test]
fn describe_reports_service_and_bounds() {
    let mut svc = RenderService::new();
    let d = call(&mut svc, 1, "describe", json!({}));
    assert_eq!(d["service"], "splice-render");
    assert!(d["bounds"]["max_output_width"].as_u64().unwrap() >= 1920);
    assert!(d["version"].as_str().unwrap().contains("splice-render/"));
}

#[test]
fn single_clip_composites_source_pixels() {
    let mut svc = RenderService::new();
    let red = solid(200, 10, 10);
    let p = plan(
        vec![vec![clip(1, 7, 0.0, 2.0, 0.0, 2.0)]],
        vec![vec![]],
    );
    let src = json!({ "7": vsource(vec![frame(0.0, &red), frame(1.0, &red), frame(2.0, &red)]) });
    let f = render(&mut svc, &p, src, 1.0);
    assert_eq!(uniform(&f), [200, 10, 10, 255]);
    // Every pixel identical.
    for y in 0..H {
        for x in 0..W {
            assert_eq!(px(&f, x, y), [200, 10, 10, 255]);
        }
    }
}

#[test]
fn inactive_track_produces_transparent_frame() {
    let mut svc = RenderService::new();
    let red = solid(200, 10, 10);
    let mut c = clip(1, 7, 0.0, 2.0, 0.0, 2.0);
    c["track_active"] = json!(false);
    let p = plan(vec![vec![c]], vec![vec![]]);
    let src = json!({ "7": vsource(vec![frame(0.0, &red)]) });
    let f = render(&mut svc, &p, src, 0.5);
    assert_eq!(uniform(&f), [0, 0, 0, 0]);
}

#[test]
fn overlay_track_stacks_above_video() {
    let mut svc = RenderService::new();
    let red = solid(200, 0, 0);
    let blue = solid(0, 0, 200);
    // Track order is stack order: video bottom, overlay top.
    let p = plan(
        vec![
            vec![clip(1, 7, 0.0, 1.0, 0.0, 1.0)],
            {
                let mut c = clip(2, 8, 0.0, 1.0, 0.0, 1.0);
                c["track_kind"] = json!("overlay");
                c["track_id"] = json!(2);
                vec![c]
            },
        ],
        vec![vec![], vec![]],
    );
    let src = json!({
        "7": vsource(vec![frame(0.0, &red)]),
        "8": vsource(vec![frame(0.0, &blue)]),
    });
    let f = render(&mut svc, &p, src, 0.5);
    assert_eq!(uniform(&f), [0, 0, 200, 255]);
}

#[test]
fn fit_letterboxes_and_fill_crops() {
    let mut svc = RenderService::new();
    // 4x2 source (half height) into 4x4 canvas.
    let mut wide = Vec::new();
    for _ in 0..4 * 2 {
        wide.extend_from_slice(&[10, 200, 10, 255]);
    }
    let mut c = clip(1, 7, 0.0, 1.0, 0.0, 1.0);
    let p = plan(vec![vec![c.clone()]], vec![vec![]]);
    let src = json!({
        "7": { "width": 4, "height": 2, "frames": [frame(0.0, &wide)] }
    });
    let f = render(&mut svc, &p, src.clone(), 0.5);
    // fit: rows 0 and 3 transparent, rows 1-2 green.
    assert_eq!(px(&f, 0, 0)[3], 0);
    assert_eq!(px(&f, 0, 3)[3], 0);
    assert_eq!(px(&f, 0, 1), [10, 200, 10, 255]);
    // fill: covers whole canvas (crop left/right), all rows green.
    let data = call(
        &mut svc,
        2,
        "renderFrame",
        json!({
            "width": W, "height": H, "time_s": 0.5, "fit": "fill",
            "snapshot": "snap2", "media": "m2",
            "plan": p, "sources": src,
        }),
    );
    let ff = base64_decode(data["bytes_b64"].as_str().unwrap()).unwrap();
    assert_eq!(px(&ff, 0, 0), [10, 200, 10, 255]);
    assert_eq!(px(&ff, 3, 3), [10, 200, 10, 255]);
    let _ = &mut c;
}

#[test]
fn constant_speed_and_speed_keys_retime() {
    let mut svc = RenderService::new();
    let red = solid(200, 0, 0);
    let green = solid(0, 200, 0);
    // Frames at media t=0 (red), t=1 (green).
    let src = json!({
        "7": vsource(vec![frame(0.0, &red), frame(1.0, &green)])
    });
    // Constant speed 1: clip media [0,1] → timeline [0,1].
    let p = plan(vec![vec![clip(1, 7, 0.0, 1.0, 0.0, 1.0)]], vec![vec![]]);
    assert_eq!(uniform(&render(&mut svc, &p, src.clone(), 0.4)), [200, 0, 0, 255]);
    assert_eq!(uniform(&render(&mut svc, &p, src.clone(), 0.6)), [0, 200, 0, 255]);

    // speed = 2: timeline len 0.5; at T=0.4 media = 0.8 → nearest t=1? |0.8-1|=0.2 < |0.8-0| → green.
    let mut c2 = clip(1, 7, 0.0, 0.5, 0.0, 1.0);
    c2["speed"] = json!(2.0);
    let p2 = plan(vec![vec![c2]], vec![vec![]]);
    assert_eq!(uniform(&render(&mut svc, &p2, src.clone(), 0.4)), [0, 200, 0, 255]);
    // At T=0.1 media=0.2 → red.
    assert_eq!(uniform(&render(&mut svc, &p2, src.clone(), 0.1)), [200, 0, 0, 255]);

    // speed_keys: keys [{t_s:0,speed:1},{t_s:1,speed:3}] on media [0,1].
    // speed(u) = 1+2u; E(m) = 0.5·ln(1+2m). Timeline len = 0.5·ln3 ≈ 0.5493.
    // At dt = 0.5·ln2 ≈ 0.3466 → m = 0.5 exactly.
    // Dense stills around m=0.5 so nearest-frame picks the middle one.
    let blue = solid(0, 0, 200);
    let src3 = json!({
        "7": vsource(vec![
            frame(0.0, &red), frame(0.4, &red), frame(0.5, &green),
            frame(0.6, &blue), frame(1.0, &blue),
        ])
    });
    let mut c3 = clip(1, 7, 0.0, 0.5 * 3.0f64.ln(), 0.0, 1.0);
    c3["speed_keys"] = json!([{ "t_s": 0.0, "speed": 1.0 }, { "t_s": 1.0, "speed": 3.0 }]);
    let p3 = plan(vec![vec![c3]], vec![vec![]]);
    let t_hit = 0.5 * 2.0f64.ln();
    assert_eq!(uniform(&render(&mut svc, &p3, src3, t_hit)), [0, 200, 0, 255]);
    // Early in the clip media ≈ 0 → red.
    let mut c4 = clip(1, 7, 0.0, 1.0, 0.0, 1.0);
    c4["speed_keys"] = json!([{ "t_s": 0.0, "speed": 1.0 }, { "t_s": 1.0, "speed": 3.0 }]);
    let p4 = plan(vec![vec![c4]], vec![vec![]]);
    assert_eq!(uniform(&render(&mut svc, &p4, src, 0.05)), [200, 0, 0, 255]);
}

/// Two-clip transition fixture: left clip media [0,1] on timeline [0,1),
/// right clip media [1,2] on timeline [1,2), cut at 1.0, window
/// [0.5, 1.5). All frames solid so nearest-frame choice is irrelevant.
fn transition_plan(kind: &str) -> (Value, Value) {
    let left = clip(11, 21, 0.0, 1.0, 0.0, 1.0);
    let right = clip(12, 22, 1.0, 2.0, 1.0, 2.0);
    let p = plan(
        vec![vec![left, right]],
        vec![vec![trans(kind, 11, 12, 0.5, 1.5, 1.0)]],
    );
    let red = solid(220, 20, 20);
    let blue = solid(20, 20, 220);
    // Dense stills so extrapolated handle media times always resolve.
    let src = json!({
        "21": vsource(vec![
            frame(0.0, &red), frame(0.5, &red), frame(1.0, &red),
            frame(1.5, &red), frame(2.0, &red),
        ]),
        "22": vsource(vec![
            frame(0.0, &blue), frame(0.5, &blue), frame(1.0, &blue),
            frame(1.5, &blue), frame(2.0, &blue),
        ]),
    });
    (p, src)
}

#[test]
fn cross_dissolve_blends_at_midpoint() {
    let mut svc = RenderService::new();
    let (p, src) = transition_plan("cross_dissolve");
    // Before window: pure left.
    assert_eq!(uniform(&render(&mut svc, &p, src.clone(), 0.4)), [220, 20, 20, 255]);
    // Midpoint p=0.5: ~50/50 red+blue.
    let f = render(&mut svc, &p, src.clone(), 1.0);
    let u = uniform(&f);
    assert!(u[0] > 90 && u[0] < 170, "red channel {u:?}");
    assert!(u[2] > 90 && u[2] < 170, "blue channel {u:?}");
    assert!((u[0] as i32 - u[2] as i32).abs() <= 2, "symmetric blend {u:?}");
    // After window: pure right.
    assert_eq!(uniform(&render(&mut svc, &p, src, 1.6)), [20, 20, 220, 255]);
}

#[test]
fn dip_to_black_and_white_reach_full_color_at_center() {
    let mut svc = RenderService::new();
    let (pb, srcb) = transition_plan("dip_to_black");
    let (pw, srcw) = transition_plan("dip_to_white");
    // p=0.5 → q = sin(pi/2) = 1 → pure color.
    assert_eq!(uniform(&render(&mut svc, &pb, srcb, 1.0)), [0, 0, 0, 255]);
    assert_eq!(uniform(&render(&mut svc, &pw, srcw, 1.0)), [255, 255, 255, 255]);
    // Quarter point of the window: T=0.75 → p=0.25 → q = sin(pi/4) ≈ 0.707.
    let f = render(&mut svc, &pb, transition_plan("dip_to_black").1, 0.75);
    let u = uniform(&f);
    assert!(u[0] < 80 && u[3] == 255, "dip black quarter {u:?}");
}

#[test]
fn wipe_left_and_right_are_hard_edge_reveals() {
    let mut svc = RenderService::new();
    let (pl, srcl) = transition_plan("wipe_left");
    let (pr, srcr) = transition_plan("wipe_right");
    // p=0.5 on a 4px canvas: wipe_left shows right on px 0,1 and left on 2,3.
    let f = render(&mut svc, &pl, srcl, 1.0);
    assert_eq!(px(&f, 0, 0), [20, 20, 220, 255]);
    assert_eq!(px(&f, 1, 0), [20, 20, 220, 255]);
    assert_eq!(px(&f, 2, 0), [220, 20, 20, 255]);
    assert_eq!(px(&f, 3, 0), [220, 20, 20, 255]);
    // wipe_right mirrors.
    let f = render(&mut svc, &pr, srcr, 1.0);
    assert_eq!(px(&f, 0, 0), [220, 20, 20, 255]);
    assert_eq!(px(&f, 1, 0), [220, 20, 20, 255]);
    assert_eq!(px(&f, 2, 0), [20, 20, 220, 255]);
    assert_eq!(px(&f, 3, 0), [20, 20, 220, 255]);
}

#[test]
fn push_left_and_right_translate_both_clips() {
    let mut svc = RenderService::new();
    // p=0.25 at T=0.75: push_left shifts left -1px, right +3px on 4px canvas.
    let (pl, srcl) = transition_plan("push_left");
    let f = render(&mut svc, &pl, srcl, 0.75);
    // Left (red) rect covers x∈[-1,3) → px 0,1,2 red; right (blue) x∈[3,7) → px 3 blue.
    assert_eq!(px(&f, 0, 0), [220, 20, 20, 255]);
    assert_eq!(px(&f, 2, 0), [220, 20, 20, 255]);
    assert_eq!(px(&f, 3, 0), [20, 20, 220, 255]);
    // push_right mirrors: left +1px, right -3px → px0 blue, px1-3 red.
    let (pr, srcr) = transition_plan("push_right");
    let f = render(&mut svc, &pr, srcr, 0.75);
    assert_eq!(px(&f, 0, 0), [20, 20, 220, 255]);
    assert_eq!(px(&f, 1, 0), [220, 20, 20, 255]);
    assert_eq!(px(&f, 3, 0), [220, 20, 20, 255]);
}

#[test]
fn cross_fade_kind_is_rejected_on_visual_tracks() {
    let mut svc = RenderService::new();
    let (mut p, _) = transition_plan("cross_dissolve");
    p["transitions"][0][0]["kind"] = json!("cross_fade");
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": W, "height": H, "time_s": 1.0,
            "plan": p, "sources": {},
        })),
        ErrorCode::InvalidCommand
    );
}

// ---- audio -----------------------------------------------------------------

fn pcm_const(frames: usize, channels: usize, v: f32) -> String {
    let mut bytes = Vec::with_capacity(frames * channels * 4);
    for _ in 0..frames * channels {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    base64_encode(&bytes)
}

fn asource(rate: u32, ch: usize, start: f64, end: f64, pcm: String) -> Value {
    json!({
        "sample_rate": rate, "channels": ch,
        "media_start_s": start, "media_end_s": end, "pcm_b64": pcm,
    })
}

fn pcm_bytes(data: &Value) -> Vec<f32> {
    let bytes = base64_decode(data["bytes_b64"].as_str().unwrap()).unwrap();
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

#[test]
fn audio_mix_applies_gain_pan_and_crossfade() {
    let mut svc = RenderService::new();
    let rate = 8000u32;
    let span = 2.0f64; // 2 s of media at rate → 16000 frames
    let n = (span * rate as f64) as usize;
    // Clip A: media [0,1] timeline [0,1), constant 0.5, gain +6dB, pan right.
    let mut a = aclip(1, 7, 0.0, 1.0, 0.0, 1.0);
    a["gain_db"] = json!(6.0);
    a["pan"] = json!(1.0);
    // Clip B: media [1,2] timeline [1,2), constant -0.25, center pan.
    let b = aclip(2, 8, 1.0, 2.0, 1.0, 2.0);
    let mut b2 = b.clone();
    b2["gain_db"] = json!(-12.0); // 10^(-12/20) ≈ 0.2512 → -0.25*0.2512? use raw instead
    let _ = b2;
    let p = plan(
        vec![vec![a, b]],
        vec![vec![trans("cross_fade", 1, 2, 0.5, 1.5, 1.0)]],
    );
    // Source 7: constant 0.5 over [0,2); source 8: constant -0.5 over [0,2).
    // 2 s at 8000 Hz = 16000 stereo frames.
    let src = json!({
        "7": asource(rate, 2, 0.0, 2.0, pcm_const(n, 2, 0.5)),
        "8": asource(rate, 2, 0.0, 2.0, pcm_const(n, 2, -0.5)),
    });
    let out = call(
        &mut svc,
        1,
        "mixAudio",
        json!({
            "plan": p, "start_s": 0.0, "duration_s": 2.0,
            "sample_rate": rate, "sources": src,
        }),
    );
    assert_eq!(out["channels"], 2);
    assert_eq!(out["frames"], 16000);
    let s = pcm_bytes(&out);
    // Clip A alone region (τ=0.25, before fade window): gain≈1.9953, pan=1 → right only.
    let i = (0.25 * rate as f64) as usize;
    let expect_a = 0.5 * 10f32.powf(6.0 / 20.0);
    assert!((s[i * 2] - 0.0).abs() < 1e-3, "pan-right left {}", s[i * 2]);
    assert!((s[i * 2 + 1] - expect_a).abs() < 1e-3, "right {}", s[i * 2 + 1]);
    // Clip B alone region (τ=1.75): -0.5 both channels.
    let j = (1.75 * rate as f64) as usize;
    assert!((s[j * 2] - (-0.5)).abs() < 1e-3);
    assert!((s[j * 2 + 1] - (-0.5)).abs() < 1e-3);
    // Crossfade at τ=0.75 → p=0.25 → equal-power gains cos(π/8)/sin(π/8).
    // Clip A (left): 0.5·1.9953·cos(π/8) on the right channel only (pan=1);
    // clip B (right): -0.5·sin(π/8) on both channels.
    let k = (0.75 * rate as f64) as usize;
    let p_f = 0.25f32;
    let half = std::f32::consts::FRAC_PI_2;
    let cf_l = (p_f * half).cos();
    let cf_r = (p_f * half).sin();
    let gain_a = 10f32.powf(6.0 / 20.0);
    let exp_r = 0.5 * gain_a * cf_l - 0.5 * cf_r;
    assert!((s[k * 2 + 1] - exp_r).abs() < 2e-3, "fade right {} vs {exp_r}", s[k * 2 + 1]);
    // Left channel: only clip B (clip A is panned hard right) → -0.5·cf_r.
    assert!((s[k * 2] - (-0.5 * cf_r)).abs() < 2e-3, "fade left {}", s[k * 2]);
}

#[test]
fn audio_silence_when_track_inactive_and_coverage_enforced() {
    let mut svc = RenderService::new();
    let rate = 8000u32;
    let n = 8000usize;
    let mut a = aclip(1, 7, 0.0, 1.0, 0.0, 1.0);
    a["track_active"] = json!(false);
    let p = plan(vec![vec![a]], vec![vec![]]);
    let src = json!({ "7": asource(rate, 2, 0.0, 1.0, pcm_const(n, 2, 0.9)) });
    let out = call(
        &mut svc,
        1,
        "mixAudio",
        json!({ "plan": p, "duration_s": 1.0, "sample_rate": rate, "sources": src.clone() }),
    );
    assert!(pcm_bytes(&out).iter().all(|v| *v == 0.0));

    // PCM span too short → honest decode-failed.
    let mut a2 = aclip(1, 7, 0.0, 1.0, 0.0, 1.0);
    a2["track_active"] = json!(true);
    let p2 = plan(vec![vec![a2]], vec![vec![]]);
    let src_short = json!({ "7": asource(rate, 2, 0.0, 0.5, pcm_const(4000, 2, 0.5)) });
    assert_eq!(
        call_err(&mut svc, "mixAudio", json!({
            "plan": p2, "duration_s": 1.0, "sample_rate": rate, "sources": src_short,
        })),
        ErrorCode::NotFound
    );
    let _ = src;
}

// ---- cache -----------------------------------------------------------------

#[test]
fn render_cache_hits_and_misses() {
    let mut svc = RenderService::new();
    let red = solid(200, 0, 0);
    let p = plan(vec![vec![clip(1, 7, 0.0, 2.0, 0.0, 2.0)]], vec![vec![]]);
    let src = json!({ "7": vsource(vec![frame(0.0, &red)]) });
    let payload = |t: f64| {
        json!({
            "width": W, "height": H, "time_s": t,
            "snapshot": "s1", "media": "m1",
            "plan": p, "sources": src,
        })
    };
    let d1 = call(&mut svc, 1, "renderFrame", payload(0.5));
    assert_eq!(d1["cached"], false);
    let d2 = call(&mut svc, 2, "renderFrame", payload(0.5));
    assert_eq!(d2["cached"], true);
    assert_eq!(d1["bytes_b64"], d2["bytes_b64"]);
    // Different time → miss.
    let d3 = call(&mut svc, 3, "renderFrame", payload(0.7));
    assert_eq!(d3["cached"], false);
    // clearCache → miss again.
    call(&mut svc, 4, "clearCache", json!({}));
    let d4 = call(&mut svc, 5, "renderFrame", payload(0.5));
    assert_eq!(d4["cached"], false);
}

#[test]
fn render_range_job_streams_frames() {
    let mut svc = RenderService::new();
    let red = solid(200, 0, 0);
    let p = plan(vec![vec![clip(1, 7, 0.0, 1.0, 0.0, 1.0)]], vec![vec![]]);
    let src = json!({ "7": vsource(vec![frame(0.0, &red)]) });
    let job = call(
        &mut svc,
        1,
        "renderRange",
        json!({
            "width": W, "height": H, "fps": 10.0, "duration_s": 0.5,
            "plan": p, "sources": src,
        }),
    );
    assert_eq!(job["frames"], 5);
    let jid = job["job"].as_u64().unwrap();
    let mut last_done = false;
    for i in 0..5 {
        let f = call(&mut svc, 10 + i, "nextFrame", json!({ "job": jid }));
        assert_eq!(f["index"], i);
        last_done = f["done"].as_bool().unwrap();
        assert_eq!(uniform(&base64_decode(f["bytes_b64"].as_str().unwrap()).unwrap()), [200, 0, 0, 255]);
    }
    assert!(last_done);
    // Job is exhausted; another pull returns done and frees it.
    let d = call(&mut svc, 20, "nextFrame", json!({ "job": jid }));
    assert_eq!(d["done"], true);
    assert_eq!(
        call_err(&mut svc, "nextFrame", json!({ "job": jid })),
        ErrorCode::NotFound
    );
}

// ---- hostile bounds ---------------------------------------------------------

#[test]
fn hostile_bounds_fail_closed() {
    let mut svc = RenderService::new();
    let red = solid(200, 0, 0);
    let p = plan(vec![vec![clip(1, 7, 0.0, 1.0, 0.0, 1.0)]], vec![vec![]]);
    let src = json!({ "7": vsource(vec![frame(0.0, &red)]) });

    // Huge canvas.
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": 99999, "height": 4, "time_s": 0.0, "plan": p, "sources": src,
        })),
        ErrorCode::OutOfBounds
    );
    // Zero dimension.
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": 0, "height": 4, "time_s": 0.0, "plan": p, "sources": src,
        })),
        ErrorCode::OutOfBounds
    );
    // Negative time.
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": 4, "height": 4, "time_s": -1.0, "plan": p, "sources": src,
        })),
        ErrorCode::InvalidCommand
    );
    // Absurd range duration / fps.
    assert_eq!(
        call_err(&mut svc, "renderRange", json!({
            "width": 4, "height": 4, "fps": 30.0, "duration_s": 3600.0,
            "plan": p, "sources": src,
        })),
        ErrorCode::OutOfBounds
    );
    assert_eq!(
        call_err(&mut svc, "renderRange", json!({
            "width": 4, "height": 4, "fps": 240.0, "duration_s": 1.0,
            "plan": p, "sources": src,
        })),
        ErrorCode::OutOfBounds
    );
    // mixAudio absurd duration / rate.
    assert_eq!(
        call_err(&mut svc, "mixAudio", json!({
            "plan": p, "duration_s": 600.0, "sample_rate": 48000, "sources": {},
        })),
        ErrorCode::OutOfBounds
    );
    // Plan with too many clips.
    let mut clips = Vec::new();
    for i in 0..5000u64 {
        clips.push(clip(i, 7, i as f64, i as f64 + 1.0, 0.0, 1.0));
    }
    let big = plan(vec![clips], vec![vec![]]);
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": 4, "height": 4, "time_s": 0.0, "plan": big, "sources": src,
        })),
        ErrorCode::OutOfBounds
    );
    // Unknown op.
    assert_eq!(
        call_err(&mut svc, "bogusOp", json!({})),
        ErrorCode::InvalidCommand
    );
    // Missing decoded source → honest decode-failed.
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": 4, "height": 4, "time_s": 0.0, "plan": p, "sources": {},
        })),
        ErrorCode::NotFound
    );
    // Wrong frame byte length.
    let bad = json!({ "7": { "width": 4, "height": 4, "frames": [
        { "t_s": 0.0, "bytes_b64": base64_encode(&[0u8; 16]) }
    ]}});
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": 4, "height": 4, "time_s": 0.0, "plan": p, "sources": bad,
        })),
        ErrorCode::InvalidCommand
    );
    // Invalid transition kind.
    let mut badp = plan(vec![vec![clip(1, 7, 0.0, 1.0, 0.0, 1.0), clip(2, 7, 1.0, 2.0, 1.0, 2.0)]], vec![vec![]]);
    badp["transitions"][0] = json!([trans("warp_speed", 1, 2, 0.5, 1.5, 1.0)]);
    assert_eq!(
        call_err(&mut svc, "renderFrame", json!({
            "width": 4, "height": 4, "time_s": 1.0, "plan": badp, "sources": src,
        })),
        ErrorCode::InvalidCommand
    );
}

#[test]
fn output_is_deterministic() {
    let mut svc = RenderService::new();
    let red = solid(200, 0, 0);
    let p = plan(vec![vec![clip(1, 7, 0.0, 1.0, 0.0, 1.0)]], vec![vec![]]);
    let src = json!({ "7": vsource(vec![frame(0.0, &red), frame(0.5, &red)]) });
    // Different snapshot salts bypass the cache; bytes must be identical.
    let a = call(&mut svc, 1, "renderFrame", json!({
        "width": W, "height": H, "time_s": 0.3, "snapshot": "a", "media": "m",
        "plan": p, "sources": src,
    }));
    let b = call(&mut svc, 2, "renderFrame", json!({
        "width": W, "height": H, "time_s": 0.3, "snapshot": "b", "media": "m",
        "plan": p, "sources": src,
    }));
    assert_eq!(a["bytes_b64"], b["bytes_b64"]);
}
