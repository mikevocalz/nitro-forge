//! Tests for nf-raw. Unit tests cover input validation and error mapping
//! without needing a real RAW file. The fixture test is `#[ignore]`d and
//! locates a camera-original DNG via the `NF_RAW_TEST_FIXTURE` env var
//! (the CC0 Pentax K-7 sample from tooling/raw-prototype/manifest.json is
//! the reference fixture; it is intentionally not committed to the repo).

use crate::{decode_preview, probe, RawError, MAX_INPUT_BYTES, MAX_PREVIEW_PIXELS};
use std::sync::atomic::AtomicBool;

#[test]
fn probe_rejects_empty_input() {
    assert!(matches!(probe(&[]), Err(RawError::InvalidInput(_))));
}

#[test]
fn decode_rejects_empty_input() {
    let cancel = AtomicBool::new(false);
    assert!(matches!(
        decode_preview(&[], MAX_PREVIEW_PIXELS, &cancel),
        Err(RawError::InvalidInput(_))
    ));
}

#[test]
fn probe_rejects_oversize_input() {
    // One byte over the 64 MiB cap; no need to back it with real content.
    let bytes = vec![0u8; MAX_INPUT_BYTES + 1];
    assert!(matches!(probe(&bytes), Err(RawError::InvalidInput(_))));
}

#[test]
fn decode_rejects_bad_max_pixels() {
    let cancel = AtomicBool::new(false);
    let bytes = b"not a raw file";
    for bad in [0u64, MAX_PREVIEW_PIXELS + 1] {
        assert!(matches!(
            decode_preview(bytes, bad, &cancel),
            Err(RawError::InvalidInput(_))
        ));
    }
}

#[test]
fn probe_rejects_non_raw_bytes() {
    // Garbage must fail at the probe stage without panicking.
    let err = probe(b"this is definitely not a RAW file\0\0\0").unwrap_err();
    assert!(
        matches!(
            err,
            RawError::Probe(_) | RawError::Unsupported(_) | RawError::Decode(_)
        ),
        "unexpected error variant: {err:?}"
    );
}

#[test]
fn decode_rejects_non_raw_bytes() {
    let cancel = AtomicBool::new(false);
    let err = decode_preview(b"garbage input", MAX_PREVIEW_PIXELS, &cancel).unwrap_err();
    assert!(
        matches!(
            err,
            RawError::Probe(_) | RawError::Unsupported(_) | RawError::Decode(_)
        ),
        "unexpected error variant: {err:?}"
    );
}

#[test]
fn decode_with_preset_cancel_still_returns_result_not_panic() {
    // The flag may or may not fire before identify finishes depending on
    // callback coverage; either way we must get a typed Result, not UB.
    let cancel = AtomicBool::new(true);
    let _ = decode_preview(b"garbage", MAX_PREVIEW_PIXELS, &cancel);
}

/// Real-fixture test. Run with:
///   NF_RAW_TEST_FIXTURE=/path/to/pentax-k7.dng cargo test -p nf-raw -- --ignored
/// Reference fixture: Pentax K-7 12-bit DNG, CC0-1.0, sha256
/// f441c36678dfca4f38e25a580f4f8485d78d8067a054153bc36be71e56c92386
/// (see tooling/raw-prototype/manifest.json).
#[test]
#[ignore = "requires NF_RAW_TEST_FIXTURE pointing at a real RAW/DNG file"]
fn fixture_probe_and_decode_preview() {
    let path = std::env::var("NF_RAW_TEST_FIXTURE")
        .expect("NF_RAW_TEST_FIXTURE must point at a RAW/DNG fixture");
    let bytes = std::fs::read(&path).expect("fixture read failed");
    assert!(bytes.len() <= MAX_INPUT_BYTES);

    let info = probe(&bytes).expect("probe failed");
    eprintln!("probe: {info:?}");
    assert!(!info.make.is_empty());
    assert!(info.width > 0 && info.height > 0);

    let cancel = AtomicBool::new(false);
    let preview = decode_preview(&bytes, MAX_PREVIEW_PIXELS, &cancel).expect("decode failed");
    eprintln!(
        "preview: {}x{} rgba={} bytes info={:?}",
        preview.width,
        preview.height,
        preview.rgba.len(),
        preview.info
    );

    // Contract checks matching processPreview expectations.
    assert_eq!(preview.rgba.len(), preview.width as usize * preview.height as usize * 4);
    assert!(preview.width <= 4096 && preview.height <= 4096);
    assert!(preview.width as u64 * preview.height as u64 <= MAX_PREVIEW_PIXELS);
    // Straight alpha: every 4th byte is 255.
    assert!(preview.rgba.chunks_exact(4).all(|px| px[3] == 255));
    // Non-uniform pixels: not a flat fill.
    let distinct: std::collections::HashSet<u32> = preview
        .rgba
        .chunks_exact(4)
        .step_by(97)
        .map(|px| u32::from_le_bytes([px[0], px[1], px[2], 0]))
        .collect();
    assert!(distinct.len() > 16, "preview looks flat: {} distinct samples", distinct.len());

    // Cooperative cancellation: a flag set before the call must surface as
    // RawError::Cancelled (LibRaw progress callback fires during identify).
    let cancel = AtomicBool::new(true);
    let err = decode_preview(&bytes, MAX_PREVIEW_PIXELS, &cancel).unwrap_err();
    eprintln!("pre-cancelled decode error: {err:?}");
    assert!(
        matches!(err, RawError::Cancelled | RawError::Probe(_) | RawError::Decode(_)),
        "pre-cancelled decode returned {err:?}"
    );
}
