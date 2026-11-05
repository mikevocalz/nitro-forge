//! Nitro v1-specific C ABI. Commands and snapshots are length-bounded.
//! Each document is synchronized independently via ConcurrentSessions.

use super::{error_json, factory, ok_json, set_err, NfBytes, NULL_BYTES};
use crate::session_registry::ConcurrentSessions;
use ignition_core::{Command, Engine, EngineError, EngineKind, OP_REDO, OP_SNAPSHOT, OP_UNDO};
use std::ffi::{c_char, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

const MAX_COMMAND_BYTES: usize = 32 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: usize = 256 * 1024 * 1024;

fn registry() -> &'static ConcurrentSessions {
    static REGISTRY: OnceLock<ConcurrentSessions> = OnceLock::new();
    REGISTRY.get_or_init(ConcurrentSessions::new)
}

/// Snapshot with the 256 MiB cap applied. Every snapshot path (the dedicated
/// export and the `__snapshot` op through either apply entry point) uses this,
/// so JS cannot bypass the cap by sending the op name.
pub(super) fn bounded_snapshot(engine: &mut dyn Engine) -> Result<Vec<u8>, EngineError> {
    bounded_snapshot_within(engine, MAX_SNAPSHOT_BYTES)
}

fn bounded_snapshot_within(engine: &mut dyn Engine, max: usize) -> Result<Vec<u8>, EngineError> {
    let bytes = engine.snapshot()?;
    if bytes.len() > max {
        return Err(EngineError::validation("native snapshot exceeds 256 MiB"));
    }
    Ok(bytes)
}

/// Share the exact same session registry with structured v1 command frames.
pub(super) fn with_v1_engine<T>(
    handle: i64,
    operation: impl FnOnce(&mut dyn Engine) -> Result<T, EngineError>,
) -> Result<T, EngineError> {
    registry().with_engine(handle, operation)
}

fn error_frame(error: EngineError) -> CString {
    ok_json(serde_json::json!({"ok":false,"error":error}))
}

/// Create a Rust engine and return its opaque signed 64-bit native handle.
/// A positive handle is never exposed as a JavaScript number in the v1 API.
///
/// # Safety
/// kind must point to exactly kind_len readable bytes. If out_err is non-null,
/// it must be writable. Caller frees errors using nf_free_string.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_open(
    kind: *const u8,
    kind_len: usize,
    out_err: *mut *mut c_char,
) -> i64 {
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<i64, EngineError> {
        if kind.is_null() || kind_len == 0 || kind_len > 32 {
            return Err(EngineError::invalid("invalid native engine kind buffer"));
        }
        let text = std::str::from_utf8(std::slice::from_raw_parts(kind, kind_len))
            .map_err(|_| EngineError::invalid("engine kind is not UTF-8"))?;
        let parsed = EngineKind::parse(text)
            .ok_or_else(|| EngineError::invalid(format!("unknown engine '{text}'")))?;
        let engine = factory(parsed)
            .ok_or_else(|| EngineError::unsupported(format!("engine '{text}' not linked")))?;
        registry().open(engine)
    }));
    match result {
        Ok(Ok(handle)) => handle,
        Ok(Err(error)) => {
            set_err(out_err, error);
            0
        }
        Err(_) => {
            set_err(
                out_err,
                EngineError::internal("panic opening native engine"),
            );
            0
        }
    }
}

/// Atomically apply a JSON command and return an explicit success/error frame.
/// Always free the returned string with nf_free_string.
///
/// # Safety
/// bytes must point to exactly len readable bytes until this call returns.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_apply(handle: i64, bytes: *const u8, len: usize) -> *mut c_char {
    let result = catch_unwind(AssertUnwindSafe(
        || -> Result<serde_json::Value, EngineError> {
            if bytes.is_null() || len == 0 || len > MAX_COMMAND_BYTES {
                return Err(EngineError::invalid(
                    "native command missing or exceeds 32 MiB",
                ));
            }
            let input = std::slice::from_raw_parts(bytes, len);
            let cmd: Command = serde_json::from_slice(input)
                .map_err(|error| EngineError::invalid(format!("invalid command JSON: {error}")))?;
            registry().with_engine(handle, |engine| match cmd.op.as_str() {
            OP_UNDO => engine.undo().map(|undone|
                serde_json::json!({"ok":true,"data":{"undone":undone},"events":[]})),
            OP_REDO => engine.redo().map(|redone|
                serde_json::json!({"ok":true,"data":{"redone":redone},"events":[]})),
            OP_SNAPSHOT => bounded_snapshot(engine).map(|snapshot|
                serde_json::json!({"ok":true,"data":{"bytes":ignition_core::base64_encode(&snapshot)},"events":[]})),
            _ => engine.apply(cmd).map(|result|
                serde_json::json!({"ok":true,"data":result.data,"events":result.events})),
        })
        },
    ));
    match result {
        Ok(Ok(value)) => ok_json(value).into_raw(),
        Ok(Err(error)) => error_frame(error).into_raw(),
        Err(_) => error_frame(EngineError::internal("panic applying native command")).into_raw(),
    }
}

/// Serialize the document as NFD1 bytes, with an exact boxed-slice allocation.
/// Free the result exactly once with nf_free_bytes.
///
/// # Safety
/// out_err must be writable if non-null; returned errors are freed by
/// nf_free_string and returned byte allocations by nf_free_bytes.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_snapshot(handle: i64, out_err: *mut *mut c_char) -> NfBytes {
    let result = catch_unwind(AssertUnwindSafe(|| {
        registry().with_engine(handle, bounded_snapshot)
    }));
    match result {
        Ok(Ok(bytes)) => {
            let boxed = bytes.into_boxed_slice();
            let len = boxed.len();
            let ptr = Box::into_raw(boxed) as *mut u8;
            NfBytes { ptr, len }
        }
        Ok(Err(error)) => {
            set_err(out_err, error);
            NULL_BYTES
        }
        Err(_) => {
            set_err(
                out_err,
                EngineError::internal("panic snapshotting native engine"),
            );
            NULL_BYTES
        }
    }
}

/// Restore NFD1 bytes, or return an allocated JSON error; null means success.
///
/// # Safety
/// bytes must reference exactly len readable bytes. Caller frees any
/// returned error string via nf_free_string.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_restore(handle: i64, bytes: *const u8, len: usize) -> *mut c_char {
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<(), EngineError> {
        if bytes.is_null() || len == 0 || len > MAX_SNAPSHOT_BYTES {
            return Err(EngineError::invalid("snapshot missing or exceeds 256 MiB"));
        }
        let input = std::slice::from_raw_parts(bytes, len);
        registry().with_engine(handle, |engine| engine.restore(input))
    }));
    match result {
        Ok(Ok(())) => std::ptr::null_mut(),
        Ok(Err(error)) => error_json(error).into_raw(),
        Err(_) => error_json(EngineError::internal("panic restoring native engine")).into_raw(),
    }
}

/// Estimated heap bytes owned by one document (live state plus undo journal),
/// for the host's GC memory-pressure hint. Returns 0 for an invalid or closed
/// handle and after a caught panic; 0 never means "free".
///
/// Takes only this document's lock, never allocates, and is safe to call
/// often. It still waits behind an in-flight command on the same document,
/// so hosts call it from their document worker, not the JS thread.
#[no_mangle]
pub extern "C" fn nf_v1_document_size(handle: i64) -> usize {
    catch_unwind(AssertUnwindSafe(|| {
        registry()
            .with_engine(handle, |engine| Ok(engine.heap_size_estimate()))
            .unwrap_or(0)
    }))
    .unwrap_or(0)
}

/// Close waits for in-flight document work and returns true exactly once.
#[no_mangle]
pub extern "C" fn nf_v1_close(handle: i64) -> i32 {
    catch_unwind(AssertUnwindSafe(|| registry().close(handle) as i32)).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::super::{nf_free_bytes, nf_free_string};
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn snapshot_cap_applies_to_every_snapshot_path() {
        let mut engine = factory(EngineKind::Tally).expect("tally engine linked");
        let size = bounded_snapshot(engine.as_mut())
            .expect("small snapshot passes")
            .len();
        assert!(size > 0);
        let error = bounded_snapshot_within(engine.as_mut(), size - 1).unwrap_err();
        assert!(serde_json::to_string(&error).unwrap().contains("256 MiB"));
        assert_eq!(
            bounded_snapshot_within(engine.as_mut(), size)
                .unwrap()
                .len(),
            size
        );
    }

    unsafe fn apply(handle: i64, command: &str) -> serde_json::Value {
        let raw = nf_v1_apply(handle, command.as_ptr(), command.len());
        assert!(!raw.is_null());
        let result = serde_json::from_str(CStr::from_ptr(raw).to_str().unwrap()).unwrap();
        nf_free_string(raw);
        result
    }

    #[test]
    fn v1_ffi_open_edit_binary_snapshot_restore_close() {
        unsafe {
            let mut error: *mut c_char = std::ptr::null_mut();
            let h = nf_v1_open(b"tally".as_ptr(), 5, &mut error);
            assert!(h > 0 && error.is_null());
            assert_eq!(apply(h, r#"{"op":"new","payload":{}}"#)["ok"], true);
            assert_eq!(
                apply(
                    h,
                    r#"{"op":"setCell","payload":{"addr":"A1","value":"42"}}"#
                )["ok"],
                true
            );
            let snapshot = nf_v1_snapshot(h, &mut error);
            assert!(error.is_null());
            assert!(snapshot.len > 9 && !snapshot.ptr.is_null());
            let bytes = std::slice::from_raw_parts(snapshot.ptr, snapshot.len).to_vec();
            nf_free_bytes(snapshot);
            assert_eq!(
                apply(h, r#"{"op":"setCell","payload":{"addr":"A1","value":"8"}}"#)["ok"],
                true
            );
            assert!(nf_v1_restore(h, bytes.as_ptr(), bytes.len()).is_null());
            let restored = apply(h, r#"{"op":"getCell","payload":{"addr":"A1"}}"#);
            assert_eq!(restored["ok"], true);
            assert_eq!(restored["data"]["computed"].as_f64(), Some(42.0));
            assert_eq!(nf_v1_close(h), 1);
            assert_eq!(nf_v1_close(h), 0);
        }
    }

    #[test]
    fn document_size_tracks_edits_and_is_zero_once_closed() {
        unsafe {
            let mut error: *mut c_char = std::ptr::null_mut();
            let h = nf_v1_open(b"tally".as_ptr(), 5, &mut error);
            assert!(h > 0 && error.is_null());
            let empty = nf_v1_document_size(h);
            assert!(empty > 0, "a live tally document owns heap");
            let value = "x".repeat(64 * 1024);
            let command =
                format!(r#"{{"op":"setCell","payload":{{"addr":"A1","value":"{value}"}}}}"#);
            assert_eq!(apply(h, &command)["ok"], true);
            let edited = nf_v1_document_size(h);
            assert!(
                edited >= empty + value.len(),
                "64 KiB cell must be counted: {empty} -> {edited}"
            );
            assert_eq!(nf_v1_document_size(h), edited, "query must not mutate");
            // Shrinking the cell keeps the 64 KiB value alive in the undo
            // journal, so the estimate must not drop back to the empty size.
            assert_eq!(
                apply(h, r#"{"op":"setCell","payload":{"addr":"A1","value":"1"}}"#)["ok"],
                true
            );
            assert!(
                nf_v1_document_size(h) >= empty + value.len(),
                "undo journal must be counted"
            );
            assert_eq!(nf_v1_close(h), 1);
            assert_eq!(nf_v1_document_size(h), 0);
            assert_eq!(nf_v1_document_size(0), 0);
            assert_eq!(nf_v1_document_size(-7), 0);
        }
    }

    #[test]
    fn every_linked_engine_reports_a_measured_size() {
        for name in [
            "prism", "cadence", "splice", "folio", "pitch", "tally", "quill",
        ] {
            let kind = EngineKind::parse(name).expect("known engine kind");
            let engine = factory(kind).expect("engine linked into nf-sys");
            assert!(
                engine.heap_size_estimate() > 0,
                "{name} relies on the unmeasured default of 0"
            );
        }
    }

    #[test]
    fn v1_ffi_rejects_corrupt_inputs_and_closed_handles() {
        unsafe {
            let mut error: *mut c_char = std::ptr::null_mut();
            assert_eq!(nf_v1_open(std::ptr::null(), 9, &mut error), 0);
            assert!(!error.is_null());
            nf_free_string(error);
            error = std::ptr::null_mut();
            let h = nf_v1_open(b"prism".as_ptr(), 5, &mut error);
            assert!(h > 0);
            assert_eq!(apply(h, "not json")["ok"], false);
            assert_eq!(apply(h, r#"{"op":"invalid-command"}"#)["ok"], false);
            assert_eq!(nf_v1_close(h), 1);
            assert_eq!(apply(h, r#"{"op":"describe"}"#)["ok"], false);
            let err = nf_v1_restore(h, std::ptr::null(), 0);
            assert!(!err.is_null());
            nf_free_string(err);
            assert_eq!(nf_v1_close(-1), 0);
        }
    }
}
