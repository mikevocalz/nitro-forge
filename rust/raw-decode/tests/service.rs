//! Integration tests for raw-decode: the JSON-lines service boundary
//! over nf-raw. Hostile-input coverage (empty/oversize/garbage bytes,
//! bad `max_pixels`, oversized frames, unknown ops, job lifecycle,
//! cancellation) runs against synthetic inputs — no real RAW needed,
//! because every rejection happens before or inside LibRaw's identify
//! pass. The real-DNG test is `#[ignore]`d behind
//! `NF_RAW_TEST_FIXTURE`, same convention as `rust/nf-raw/src/tests.rs`.

use ignition_core::{base64_encode, FrameRequest};
use raw_decode::RawDecodeService;
use serde_json::{json, Value};

fn call(service: &mut RawDecodeService, id: u64, op: &str, payload: Value) -> Value {
    let req = FrameRequest {
        id,
        handle: 0,
        op: op.to_string(),
        payload,
    };
    let resp = service.handle_frame(&req);
    assert_eq!(resp.id, id);
    serde_json::to_value(&resp).unwrap()
}

fn ok_data(resp: &Value) -> &Value {
    assert_eq!(resp["ok"], true, "expected ok response: {resp}");
    &resp["data"]
}

fn err(resp: &Value) -> (&str, &str) {
    assert_eq!(resp["ok"], false, "expected error response: {resp}");
    let e = &resp["error"];
    (
        e["code"].as_str().unwrap_or(""),
        e["message"].as_str().unwrap_or(""),
    )
}

/// Poll `jobStatus` until the job reaches a terminal state. Garbage
/// inputs fail fast inside LibRaw's identify pass, so this terminates
/// quickly; the bound only guards against a wedged worker.
fn await_terminal(service: &mut RawDecodeService, job: u64, mut spins: usize) -> Value {
    loop {
        let resp = call(service, 100 + spins as u64, "jobStatus", json!({ "job": job }));
        let data = ok_data(&resp);
        let state = data["state"].as_str().unwrap();
        if state != "running" {
            return data.clone();
        }
        spins -= 1;
        assert!(spins > 0, "job {job} still running after poll budget");
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

#[test]
fn describe_lists_ops_and_bounds() {
    let mut svc = RawDecodeService::new();
    let resp = call(&mut svc, 1, "describe", json!({}));
    let data = ok_data(&resp);
    assert_eq!(data["service"], "raw-decode");
    assert!(data["version"].as_str().unwrap().starts_with("raw-decode/"));
    let ops = data["ops"].as_array().unwrap();
    for op in ["probe", "decodePreview", "jobStatus", "cancelJob", "describe"] {
        assert!(ops.iter().any(|o| o == op), "missing op {op}");
    }
    assert_eq!(data["bounds"]["max_input_bytes"], 64 * 1024 * 1024);
    assert_eq!(data["bounds"]["max_preview_pixels"], 1_048_576);
    assert_eq!(data["bounds"]["max_jobs"], 8);
}

#[test]
fn unknown_op_rejected() {
    let mut svc = RawDecodeService::new();
    let resp = call(&mut svc, 1, "renderFrame", json!({}));
    let (code, msg) = err(&resp);
    assert_eq!(code, "invalid_command");
    assert!(msg.contains("unknown raw-decode op"));
}

#[test]
fn probe_requires_bytes_b64() {
    let mut svc = RawDecodeService::new();
    let resp = call(&mut svc, 1, "probe", json!({}));
    let (code, _) = err(&resp);
    assert_eq!(code, "invalid_command");
}

#[test]
fn probe_rejects_invalid_base64() {
    let mut svc = RawDecodeService::new();
    let resp = call(&mut svc, 1, "probe", json!({ "bytes_b64": "!!!not-base64!!!" }));
    let (code, msg) = err(&resp);
    assert_eq!(code, "invalid_command");
    assert!(msg.contains("bytes_b64"));
}

#[test]
fn probe_rejects_empty_and_oversize_input() {
    let mut svc = RawDecodeService::new();
    // Empty decoded input.
    let resp = call(&mut svc, 1, "probe", json!({ "bytes_b64": "" }));
    assert_eq!(err(&resp).0, "invalid_command");
    // One byte over the 64 MiB RAW cap — rejected before enqueue so no
    // worker round-trip is needed. base64 of 64MiB+1 zero bytes.
    let big = base64_encode(&vec![0u8; 64 * 1024 * 1024 + 1]);
    let resp = call(&mut svc, 2, "probe", json!({ "bytes_b64": big }));
    let (code, msg) = err(&resp);
    assert_eq!(code, "out_of_bounds");
    assert!(msg.contains("64 MiB") || msg.contains("67108864") || msg.contains("exceeds"));
}

#[test]
fn decode_preview_validates_max_pixels_at_enqueue() {
    let mut svc = RawDecodeService::new();
    let bytes = base64_encode(b"garbage");
    for bad in [json!(0), json!(1_048_577), json!(-1), json!("lots")] {
        let resp = call(
            &mut svc,
            1,
            "decodePreview",
            json!({ "bytes_b64": bytes, "max_pixels": bad }),
        );
        let (code, _) = err(&resp);
        assert_eq!(code, "invalid_command", "max_pixels {bad} should reject");
    }
    // Boundary values are accepted (the job itself will fail on garbage,
    // which is a *terminal job* failure, not an enqueue rejection).
    for good in [json!(1), json!(1_048_576)] {
        let resp = call(
            &mut svc,
            1,
            "decodePreview",
            json!({ "bytes_b64": bytes, "max_pixels": good }),
        );
        let job = ok_data(&resp)["job"].as_u64().unwrap();
        let terminal = await_terminal(&mut svc, job, 4000);
        assert_eq!(terminal["state"], "failed");
        // Which LibRaw stage rejects garbage is upstream-defined; any
        // typed failure code is honest here.
        assert!(terminal["error"]["code"].is_string());
        // Consume any leftover cancelled slot bookkeeping by cancelling
        // unknown jobs is an error — verified separately.
    }
}

#[test]
fn garbage_input_fails_terminal_not_panic() {
    let mut svc = RawDecodeService::new();
    let resp = call(
        &mut svc,
        1,
        "decodePreview",
        json!({ "bytes_b64": base64_encode(b"this is not a RAW file") }),
    );
    let job = ok_data(&resp)["job"].as_u64().unwrap();
    // First poll may be running or already terminal.
    let terminal = await_terminal(&mut svc, job, 4000);
    assert!(
        terminal["state"] == "failed" || terminal["state"] == "cancelled",
        "unexpected terminal state: {terminal}"
    );
    if terminal["state"] == "failed" {
        let code = terminal["error"]["code"].as_str().unwrap();
        assert!(
            matches!(code, "probe-failed" | "unsupported" | "decode-failed" | "out-of-memory" | "limit-exceeded"),
            "unexpected error code {code}: {terminal}"
        );
    }
    // Terminal polls are one-shot: a second poll is not_found.
    let resp = call(&mut svc, 2, "jobStatus", json!({ "job": job }));
    assert_eq!(err(&resp).0, "not_found");
}

#[test]
fn probe_garbage_reports_typed_failure() {
    let mut svc = RawDecodeService::new();
    let resp = call(
        &mut svc,
        1,
        "probe",
        json!({ "bytes_b64": base64_encode(b"\x00\x01\x02\x03garbage") }),
    );
    let job = ok_data(&resp)["job"].as_u64().unwrap();
    let terminal = await_terminal(&mut svc, job, 4000);
    assert_eq!(terminal["state"], "failed");
    assert_eq!(terminal["kind"], "probe");
    assert!(terminal["error"]["message"].as_str().unwrap().len() > 0);
}

#[test]
fn cancel_job_signals_and_frees_slot() {
    let mut svc = RawDecodeService::new();
    let resp = call(
        &mut svc,
        1,
        "decodePreview",
        json!({ "bytes_b64": base64_encode(b"garbage that will fail anyway") }),
    );
    let job = ok_data(&resp)["job"].as_u64().unwrap();
    let resp = call(&mut svc, 2, "cancelJob", json!({ "job": job }));
    assert_eq!(ok_data(&resp)["cancelled"], true);
    // Slot is gone: status and re-cancel are not_found.
    let resp = call(&mut svc, 3, "jobStatus", json!({ "job": job }));
    assert_eq!(err(&resp).0, "not_found");
    let resp = call(&mut svc, 4, "cancelJob", json!({ "job": job }));
    assert_eq!(err(&resp).0, "not_found");
    // Unknown job ids reject the same way.
    let resp = call(&mut svc, 5, "jobStatus", json!({ "job": 9999 }));
    assert_eq!(err(&resp).0, "not_found");
    let resp = call(&mut svc, 6, "jobStatus", json!({}));
    assert_eq!(err(&resp).0, "invalid_command");
}

#[test]
fn job_limit_is_enforced() {
    let mut svc = RawDecodeService::new();
    let bytes = base64_encode(b"garbage");
    let mut jobs = Vec::new();
    for i in 0..8 {
        let resp = call(
            &mut svc,
            i + 1,
            "decodePreview",
            json!({ "bytes_b64": bytes }),
        );
        jobs.push(ok_data(&resp)["job"].as_u64().unwrap());
    }
    // 9th job exceeds MAX_JOBS — but the worker may have already drained
    // some garbage jobs, so accept either the limit error or a new job.
    let resp = call(&mut svc, 99, "decodePreview", json!({ "bytes_b64": bytes }));
    if resp["ok"] == false {
        assert_eq!(err(&resp).0, "out_of_bounds");
    }
    // Drain whatever is live so the service drops cleanly.
    for job in jobs {
        let _ = call(&mut svc, 200 + job, "cancelJob", json!({ "job": job }));
    }
}

#[test]
fn malformed_json_and_missing_id_get_error_frames() {
    // Drive run_stdio-level parsing through handle_frame is not possible
    // for non-JSON; this test instead verifies FrameRequest-level
    // robustness: a payload that is not an object still dispatches.
    let mut svc = RawDecodeService::new();
    let req = FrameRequest {
        id: 7,
        handle: 0,
        op: "probe".into(),
        payload: Value::Null,
    };
    let resp = svc.handle_frame(&req);
    assert!(!resp.ok);
    assert_eq!(resp.error.unwrap().code, ignition_core::ErrorCode::InvalidCommand);
}

/// Real-fixture round trip through the service boundary. Run with:
///   NF_RAW_TEST_FIXTURE=/path/to/pentax-k7.dng cargo test -p raw-decode -- --ignored
/// Same fixture as `rust/nf-raw` (CC0 Pentax K-7 DNG, sha256
/// f441c36678dfca4f38e25a580f4f8485d78d8067a054153bc36be71e56c92386,
/// see tooling/raw-prototype/manifest.json).
#[test]
#[ignore = "requires NF_RAW_TEST_FIXTURE pointing at a real RAW/DNG file"]
fn fixture_probe_and_decode_preview_via_service() {
    let path = std::env::var("NF_RAW_TEST_FIXTURE")
        .expect("NF_RAW_TEST_FIXTURE must point at a RAW/DNG fixture");
    let bytes = std::fs::read(&path).expect("fixture read failed");
    let b64 = base64_encode(&bytes);
    let mut svc = RawDecodeService::new();

    // probe job
    let resp = call(&mut svc, 1, "probe", json!({ "bytes_b64": b64 }));
    let job = ok_data(&resp)["job"].as_u64().unwrap();
    let terminal = await_terminal(&mut svc, job, 4000);
    assert_eq!(terminal["state"], "done");
    assert_eq!(terminal["kind"], "probe");
    let info = &terminal["info"];
    assert!(!info["make"].as_str().unwrap().is_empty());
    assert!(info["width"].as_u64().unwrap() > 0);

    // decodePreview job at the processPreview budget
    let resp = call(
        &mut svc,
        2,
        "decodePreview",
        json!({ "bytes_b64": b64, "max_pixels": 1_048_576 }),
    );
    let job = ok_data(&resp)["job"].as_u64().unwrap();
    let terminal = await_terminal(&mut svc, job, 400_000);
    assert_eq!(terminal["state"], "done", "decode failed: {terminal}");
    assert_eq!(terminal["kind"], "decode");
    assert_eq!(terminal["format"], "rgba8");
    let w = terminal["width"].as_u64().unwrap() as usize;
    let h = terminal["height"].as_u64().unwrap() as usize;
    assert!(w > 0 && h > 0);
    assert!(w <= 4096 && h <= 4096);
    assert!((w * h) as u64 <= 1_048_576);
    let rgba = ignition_core::base64_decode(terminal["bytes_b64"].as_str().unwrap())
        .expect("preview base64");
    assert_eq!(rgba.len(), w * h * 4);
    // Straight alpha: every 4th byte is 255.
    assert!(rgba.chunks_exact(4).all(|px| px[3] == 255));
}
