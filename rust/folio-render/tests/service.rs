//! Integration tests for folio-render against the real pdfium library.
//!
//! These tests RUN only when a pdfium shared library resolves (see
//! `rust/folio-render/README.md`: `FOLIO_PDFIUM_LIBRARY`,
//! `FOLIO_PDFIUM_DIR`, or `rust/folio-render/lib/`). On hosts without one
//! they print a skip notice and pass — that is a platform NOT-RUN, not a
//! failure. On the macOS arm64 dev host they exercise the real dylib.

use folio_render::{pdfium, RenderService};
use ignition_core::{base64_encode, ErrorCode, FrameRequest};
use serde_json::{json, Value};

/// Build a minimal one-page PDF with a Helvetica text run.
fn minimal_pdf(text: &str) -> Vec<u8> {
    let stream = format!("BT /F1 24 Tf 100 700 Td ({text}) Tj ET");
    let objs: Vec<Vec<u8>> = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_vec(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec(),
        format!("<< /Length {} >>\nstream\n{}\nendstream", stream.len(), stream).into_bytes(),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n", objs.len() + 1).as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for off in &offsets {
        out.extend_from_slice(format!("{:010} 00000 n \n", off).as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objs.len() + 1,
            xref
        )
        .as_bytes(),
    );
    out
}

fn pdfium_available() -> bool {
    if let Err(e) = pdfium::pdfium() {
        eprintln!("SKIP: pdfium library not resolvable ({e})");
        return false;
    }
    true
}

fn call(svc: &mut RenderService, id: u64, handle: u64, op: &str, payload: Value) -> Value {
    let res = svc.handle_frame(&FrameRequest {
        id,
        handle,
        op: op.to_string(),
        payload,
    });
    assert!(res.ok, "op {op} failed: {:?}", res.error);
    res.data.unwrap()
}

fn call_err(svc: &mut RenderService, handle: u64, op: &str, payload: Value) -> ErrorCode {
    let res = svc.handle_frame(&FrameRequest {
        id: 99,
        handle,
        op: op.to_string(),
        payload,
    });
    assert!(!res.ok, "op {op} unexpectedly succeeded");
    res.error.unwrap().code
}

#[test]
fn open_reports_pages_and_is_not_encrypted() {
    if !pdfium_available() {
        return;
    }
    let mut svc = RenderService::new();
    let data = call(
        &mut svc,
        1,
        0,
        "open",
        json!({ "bytes_b64": base64_encode(&minimal_pdf("Hello World")) }),
    );
    assert_eq!(data["pages"], 1);
    assert_eq!(data["encrypted"], false);
    assert_eq!(data["page_sizes"][0]["width"], 612.0);
    assert_eq!(data["page_sizes"][0]["height"], 792.0);
    let handle = data["handle"].as_u64().unwrap();
    assert_eq!(call(&mut svc, 2, handle, "close", json!({}))["closed"], true);
}

#[test]
fn text_page_returns_positioned_runs() {
    if !pdfium_available() {
        return;
    }
    let mut svc = RenderService::new();
    let handle = call(
        &mut svc,
        1,
        0,
        "open",
        json!({ "bytes_b64": base64_encode(&minimal_pdf("Hello World")) }),
    )["handle"]
        .as_u64()
        .unwrap();
    let data = call(&mut svc, 2, handle, "textPage", json!({ "page": 0 }));
    let items = data["items"].as_array().unwrap();
    assert!(!items.is_empty());
    let first = &items[0];
    assert_eq!(first["text"], "Hello World");
    assert_eq!(first["font"], "Helvetica");
    assert_eq!(first["size"], 24.0);
    let bbox = first["bbox"].as_array().unwrap();
    assert_eq!(bbox.len(), 4);
    // Text sits near x=100pt, baseline y=700pt on a 612x792 page.
    assert!(bbox[0].as_f64().unwrap() > 90.0 && bbox[0].as_f64().unwrap() < 115.0);
    assert!(bbox[1].as_f64().unwrap() > 690.0);
    for v in bbox {
        assert!(v.as_f64().unwrap().is_finite());
    }
}

#[test]
fn search_finds_hits_with_page_and_bbox() {
    if !pdfium_available() {
        return;
    }
    let mut svc = RenderService::new();
    let handle = call(
        &mut svc,
        1,
        0,
        "open",
        json!({ "bytes_b64": base64_encode(&minimal_pdf("Hello World")) }),
    )["handle"]
        .as_u64()
        .unwrap();
    let data = call(&mut svc, 2, handle, "search", json!({ "query": "hello" }));
    let hits = data["hits"].as_array().unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0]["page"], 0);
    assert!(hits[0]["context"].as_str().unwrap().contains("Hello"));
    assert_eq!(hits[0]["bbox"].as_array().unwrap().len(), 4);
    // Absent term yields no hits.
    let none = call(&mut svc, 3, handle, "search", json!({ "query": "zzz-no-match" }));
    assert_eq!(none["hits"].as_array().unwrap().len(), 0);
}

#[test]
fn page_info_reports_size_rotation_links() {
    if !pdfium_available() {
        return;
    }
    let mut svc = RenderService::new();
    let handle = call(
        &mut svc,
        1,
        0,
        "open",
        json!({ "bytes_b64": base64_encode(&minimal_pdf("Hi")) }),
    )["handle"]
        .as_u64()
        .unwrap();
    let info = call(&mut svc, 2, handle, "pageInfo", json!({ "page": 0 }));
    assert_eq!(info["size"]["width"], 612.0);
    assert_eq!(info["size"]["height"], 792.0);
    assert_eq!(info["rotate"], 0);
    assert!(info["links"].as_array().unwrap().is_empty());
}

#[test]
fn render_page_png_and_raw_produce_real_pixels() {
    if !pdfium_available() {
        return;
    }
    let mut svc = RenderService::new();
    let handle = call(
        &mut svc,
        1,
        0,
        "open",
        json!({ "bytes_b64": base64_encode(&minimal_pdf("Hello World")) }),
    )["handle"]
        .as_u64()
        .unwrap();
    // scale 0.5 on 612x792pt -> 306x396 px.
    let png = call(
        &mut svc,
        2,
        handle,
        "renderPage",
        json!({ "page": 0, "scale": 0.5, "format": "png" }),
    );
    assert_eq!(png["format"], "png");
    assert_eq!(png["width"], 306);
    assert_eq!(png["height"], 396);
    let png_bytes = ignition_core::base64_decode(png["bytes_b64"].as_str().unwrap()).unwrap();
    assert_eq!(&png_bytes[0..8], b"\x89PNG\r\n\x1a\n");
    assert!(png_bytes.len() > 1000);

    let raw = call(
        &mut svc,
        3,
        handle,
        "renderPage",
        json!({ "page": 0, "scale": 0.25, "format": "raw" }),
    );
    assert_eq!(raw["format"], "raw");
    let rgba = ignition_core::base64_decode(raw["bytes_b64"].as_str().unwrap()).unwrap();
    let w = raw["width"].as_u64().unwrap() as usize;
    let h = raw["height"].as_u64().unwrap() as usize;
    assert_eq!(raw["stride"].as_u64().unwrap() as usize, w * 4);
    assert_eq!(rgba.len(), w * h * 4);
    // Page is mostly white; text pixels are dark. At least one dark pixel
    // must exist — proves real rasterization, not a blank fill.
    assert!(rgba.chunks_exact(4).any(|px| px[0] < 128 && px[1] < 128 && px[2] < 128));
}

#[test]
fn bounds_and_errors_fail_closed() {
    if !pdfium_available() {
        return;
    }
    let mut svc = RenderService::new();
    // Corrupt input is rejected before pdfium sees it.
    let bad = svc.handle_frame(&FrameRequest {
        id: 1,
        handle: 0,
        op: "open".into(),
        payload: json!({ "bytes_b64": base64_encode(b"not a pdf at all") }),
    });
    assert!(!bad.ok);
    let handle = call(
        &mut svc,
        2,
        0,
        "open",
        json!({ "bytes_b64": base64_encode(&minimal_pdf("Bounds")) }),
    )["handle"]
        .as_u64()
        .unwrap();
    // Page index out of range.
    assert_eq!(
        call_err(&mut svc, handle, "textPage", json!({ "page": 5 })),
        ErrorCode::OutOfBounds
    );
    // Empty query.
    assert_eq!(
        call_err(&mut svc, handle, "search", json!({ "query": "  " })),
        ErrorCode::InvalidCommand
    );
    // Absurd scale.
    assert_eq!(
        call_err(&mut svc, handle, "renderPage", json!({ "page": 0, "scale": 1e9 })),
        ErrorCode::OutOfBounds
    );
    // Search on a page index that does not exist.
    assert_eq!(
        call_err(&mut svc, handle, "search", json!({ "query": "x", "pages": [9] })),
        ErrorCode::OutOfBounds
    );
    // Closed handle is gone.
    call(&mut svc, 3, handle, "close", json!({}));
    assert_eq!(
        call_err(&mut svc, handle, "pageInfo", json!({ "page": 0 })),
        ErrorCode::NotFound
    );
}

#[test]
fn session_cap_is_enforced() {
    if !pdfium_available() {
        return;
    }
    let mut svc = RenderService::new();
    let b64 = base64_encode(&minimal_pdf("Session cap"));
    let mut handles = Vec::new();
    for i in 0..folio_render::MAX_SESSIONS {
        let data = call(
            &mut svc,
            i as u64 + 1,
            0,
            "open",
            json!({ "bytes_b64": b64 }),
        );
        handles.push(data["handle"].as_u64().unwrap());
    }
    // The next open exceeds MAX_SESSIONS and fails closed.
    let res = svc.handle_frame(&FrameRequest {
        id: 999,
        handle: 0,
        op: "open".into(),
        payload: json!({ "bytes_b64": b64 }),
    });
    assert!(!res.ok);
    assert_eq!(res.error.unwrap().code, ErrorCode::OutOfBounds);
    // Existing sessions remain usable; closing frees a slot.
    let info = call(&mut svc, 1000, handles[0], "pageInfo", json!({ "page": 0 }));
    assert_eq!(info["size"]["width"], 612.0);
    call(&mut svc, 1001, handles[0], "close", json!({}));
    let again = call(&mut svc, 1002, 0, "open", json!({ "bytes_b64": b64 }));
    assert!(again["handle"].as_u64().unwrap() > 0);
}
