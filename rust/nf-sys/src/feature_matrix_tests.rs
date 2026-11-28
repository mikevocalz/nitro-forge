//! Behaviour under each engine feature set. Every test here adapts its
//! expectations to `cfg!(feature = ...)`, so the same file checks:
//!
//! - the default build (`cargo test -p nf-sys`): all 12 engines;
//! - `--no-default-features --features prism`: Prism only;
//! - `--no-default-features --features tally`: one other engine only;
//! - `--no-default-features`: no engine at all (the crate must still build).
//!
//! CI runs each combination; see `.github/workflows/ignition-v1-integration.yml`.

use crate::engines::{factory, is_linked, linked_kinds};
use crate::ffi_v1::{nf_v1_close, nf_v1_engine_linked, nf_v1_open, nf_v1_resident_bytes};
use crate::{nf_free_string, nf_open};
use ignition_core::{EngineError, EngineKind, ErrorCode};
use std::ffi::{c_char, CStr, CString};

fn expected_linked() -> Vec<EngineKind> {
    EngineKind::ALL
        .into_iter()
        .filter(|kind| match kind {
            EngineKind::Prism => cfg!(feature = "prism"),
            EngineKind::Cadence => cfg!(feature = "cadence"),
            EngineKind::Splice => cfg!(feature = "splice"),
            EngineKind::Folio => cfg!(feature = "folio"),
            EngineKind::Pitch => cfg!(feature = "pitch"),
            EngineKind::Tally => cfg!(feature = "tally"),
            EngineKind::Quill => cfg!(feature = "quill"),
            EngineKind::Photo => cfg!(feature = "photo"),
            EngineKind::Motion => cfg!(feature = "motion"),
            EngineKind::Design => cfg!(feature = "design"),
            EngineKind::Draft => cfg!(feature = "draft"),
            EngineKind::Scene => cfg!(feature = "scene"),
        })
        .collect()
}

/// Open through the v1 C ABI; Ok(handle) or the decoded error JSON.
fn v1_open(kind: &str) -> Result<i64, EngineError> {
    unsafe {
        let mut error: *mut c_char = std::ptr::null_mut();
        let handle = nf_v1_open(kind.as_ptr(), kind.len(), &mut error);
        if handle > 0 {
            assert!(error.is_null());
            return Ok(handle);
        }
        assert!(!error.is_null(), "open of '{kind}' failed without an error");
        let decoded = serde_json::from_str(CStr::from_ptr(error).to_str().unwrap()).unwrap();
        nf_free_string(error);
        Err(decoded)
    }
}

#[test]
fn default_build_links_every_engine() {
    if cfg!(feature = "all") {
        assert_eq!(linked_kinds(), EngineKind::ALL.to_vec());
    }
    assert_eq!(linked_kinds(), expected_linked());
}

#[test]
fn each_kind_opens_or_fails_with_a_typed_not_linked_error() {
    for kind in EngineKind::ALL {
        let name = kind.as_str();
        assert_eq!(factory(kind).is_some(), is_linked(kind), "{name}");
        match v1_open(name) {
            Ok(handle) => {
                assert!(is_linked(kind), "{name} opened but is not linked");
                assert_eq!(nf_v1_close(handle), 1);
            }
            Err(error) => {
                assert!(!is_linked(kind), "{name} is linked but failed: {error:?}");
                assert_eq!(error.code, ErrorCode::Unsupported, "{name}");
                assert!(
                    error.recoverable,
                    "{name}: opening another engine still works"
                );
                assert!(
                    error
                        .message
                        .contains(&format!("engine '{name}' not linked in this build")),
                    "{}",
                    error.message
                );
            }
        }
    }
}

#[test]
fn not_linked_error_names_what_this_build_does_link() {
    let Some(missing) = EngineKind::ALL.into_iter().find(|kind| !is_linked(*kind)) else {
        return; // full build: nothing is missing
    };
    let error = v1_open(missing.as_str()).unwrap_err();
    let linked: Vec<&str> = expected_linked().iter().map(EngineKind::as_str).collect();
    let listed = if linked.is_empty() {
        "none".to_owned()
    } else {
        linked.join(", ")
    };
    assert!(
        error.message.contains(&format!("(linked: {listed})")),
        "{}",
        error.message
    );
}

#[test]
fn legacy_open_reports_the_same_not_linked_error() {
    for kind in EngineKind::ALL.into_iter().filter(|kind| !is_linked(*kind)) {
        unsafe {
            let mut error: *mut c_char = std::ptr::null_mut();
            let name = CString::new(kind.as_str()).unwrap();
            assert_eq!(nf_open(name.as_ptr(), &mut error), 0);
            let decoded: EngineError =
                serde_json::from_str(CStr::from_ptr(error).to_str().unwrap()).unwrap();
            nf_free_string(error);
            assert_eq!(decoded.code, ErrorCode::Unsupported);
            assert!(decoded.message.contains("not linked in this build"));
        }
    }
}

#[test]
fn engine_linked_query_distinguishes_linked_missing_and_unknown() {
    unsafe {
        for kind in EngineKind::ALL {
            let name = kind.as_str();
            let expected = i32::from(is_linked(kind));
            assert_eq!(
                nf_v1_engine_linked(name.as_ptr(), name.len()),
                expected,
                "{name}"
            );
        }
        assert_eq!(nf_v1_engine_linked(b"nope".as_ptr(), 4), -1);
        assert_eq!(nf_v1_engine_linked(std::ptr::null(), 5), -1);
        assert_eq!(nf_v1_engine_linked(b"\xff".as_ptr(), 1), -1);
        // An unknown kind is still `invalid`, not `unsupported`.
        assert_eq!(v1_open("nope").unwrap_err().code, ErrorCode::InvalidCommand);
    }
}

#[test]
fn resident_bytes_is_zero_for_invalid_and_closed_handles() {
    assert_eq!(nf_v1_resident_bytes(0), 0);
    assert_eq!(nf_v1_resident_bytes(-7), 0);
    assert_eq!(nf_v1_resident_bytes(i64::MAX), 0);
    if let Some(kind) = linked_kinds().first() {
        let handle = v1_open(kind.as_str()).unwrap();
        assert_eq!(nf_v1_close(handle), 1);
        assert_eq!(nf_v1_resident_bytes(handle), 0);
    }
}

#[cfg(feature = "prism")]
#[test]
fn prism_resident_bytes_tracks_canvas_pixels() {
    use crate::ffi_v1_parts::{nf_v1_apply_parts, nf_v1_free_command_result};
    unsafe {
        let handle = v1_open("prism").unwrap();
        let run = |op: &str, payload: &str| {
            let result = nf_v1_apply_parts(
                handle,
                op.as_ptr(),
                op.len(),
                payload.as_ptr(),
                payload.len(),
                1,
            );
            assert!(result.error_json.is_null(), "{op}");
            nf_v1_free_command_result(result);
        };
        run("new", r#"{"width":256,"height":256}"#);
        let blank = nf_v1_resident_bytes(handle);
        run("addRasterLayer", "{}");
        let layered = nf_v1_resident_bytes(handle);
        assert!(layered >= blank + 256 * 256 * 4, "{blank} -> {layered}");
        assert_eq!(nf_v1_close(handle), 1);
    }
}

/// Engines without their own accounting report the last envelope size.
#[cfg(feature = "tally")]
#[test]
fn tally_resident_bytes_falls_back_to_the_last_envelope() {
    use crate::ffi_v1::{nf_v1_restore, nf_v1_snapshot};
    use crate::ffi_v1_parts::{nf_v1_apply_parts, nf_v1_free_command_result};
    use crate::nf_free_bytes;
    unsafe {
        let handle = v1_open("tally").unwrap();
        let run = |op: &str, payload: &str| {
            let result = nf_v1_apply_parts(
                handle,
                op.as_ptr(),
                op.len(),
                payload.as_ptr(),
                payload.len(),
                1,
            );
            assert!(result.error_json.is_null(), "{op}");
            nf_v1_free_command_result(result);
        };
        run("new", "{}");
        assert_eq!(nf_v1_resident_bytes(handle), 0, "nothing seen yet");
        run(
            "setCell",
            r#"{"addr":"A1","value":"a long enough cell value"}"#,
        );
        let mut error: *mut c_char = std::ptr::null_mut();
        let snapshot = nf_v1_snapshot(handle, &mut error);
        assert!(error.is_null());
        let bytes = std::slice::from_raw_parts(snapshot.ptr, snapshot.len).to_vec();
        nf_free_bytes(snapshot);
        assert_eq!(nf_v1_resident_bytes(handle), bytes.len() as u64);

        let other = v1_open("tally").unwrap();
        run("setCell", r#"{"addr":"B2","value":"x"}"#);
        assert!(nf_v1_restore(other, bytes.as_ptr(), bytes.len()).is_null());
        assert_eq!(nf_v1_resident_bytes(other), bytes.len() as u64);
        // A rejected restore leaves the recorded size alone.
        let bad = nf_v1_restore(other, b"junk".as_ptr(), 4);
        assert!(!bad.is_null());
        nf_free_string(bad);
        assert_eq!(nf_v1_resident_bytes(other), bytes.len() as u64);
        assert_eq!(nf_v1_close(other), 1);
        assert_eq!(nf_v1_close(handle), 1);
    }
}
