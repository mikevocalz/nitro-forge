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

pub(crate) fn bounded_snapshot(engine:&mut dyn Engine)->Result<Vec<u8>,EngineError>{
 let bytes=engine.snapshot()?;if bytes.len()>MAX_SNAPSHOT_BYTES{return Err(EngineError::validation("native snapshot exceeds 256 MiB"));}Ok(bytes)
}

fn registry() -> &'static ConcurrentSessions {
    static REGISTRY: OnceLock<ConcurrentSessions> = OnceLock::new();
    REGISTRY.get_or_init(ConcurrentSessions::new)
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
            registry().with_engine(handle, |engine| crate::dispatch::run_command(engine,cmd,None).map(|result|serde_json::json!({"ok":true,"data":result.data,"events":result.events})))
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
            if bytes.len() > MAX_SNAPSHOT_BYTES {
                set_err(
                    out_err,
                    EngineError::validation("native snapshot exceeds 256 MiB"),
                );
                return NULL_BYTES;
            }
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

    /// F3 E-35 and I-15 ops reach the engines through the generic v1 C ABI
    /// with no new symbols: Cadence markers (batch undo as one step,
    /// snapshot round-trip), `detectBeats` sensitivity validation, and a
    /// Tally pivot filter with no values.
    #[test]
    fn v1_ffi_carries_cadence_markers_and_tally_all_filter() {
        unsafe {
            let mut error: *mut c_char = std::ptr::null_mut();
            let h = nf_v1_open(b"cadence".as_ptr(), 7, &mut error);
            assert!(h > 0 && error.is_null());
            let added = apply(
                h,
                r#"{"op":"addMarkers","payload":{"markers":[{"ticks":0},{"ticks":960},{"ticks":1920}]}}"#,
            );
            assert_eq!(added["ok"], true, "{added}");
            assert_eq!(added["data"]["marker_ids"].as_array().unwrap().len(), 3);
            let list = |h| apply(h, r#"{"op":"listMarkers","payload":{}}"#)["data"]["markers"]
                .as_array()
                .unwrap()
                .len();
            assert_eq!(list(h), 3);
            let snapshot = nf_v1_snapshot(h, &mut error);
            assert!(error.is_null());
            let bytes = std::slice::from_raw_parts(snapshot.ptr, snapshot.len).to_vec();
            nf_free_bytes(snapshot);
            assert_eq!(apply(h, r#"{"op":"__undo"}"#)["data"]["undone"], true);
            assert_eq!(list(h), 0, "one undo removes the whole batch");
            assert_eq!(apply(h, r#"{"op":"__redo"}"#)["data"]["redone"], true);
            assert_eq!(list(h), 3);
            assert_eq!(apply(h, r#"{"op":"__undo"}"#)["data"]["undone"], true);
            assert!(nf_v1_restore(h, bytes.as_ptr(), bytes.len()).is_null());
            assert_eq!(list(h), 3);
            let bad = apply(
                h,
                r#"{"op":"detectBeats","payload":{"from_ticks":0,"to_ticks":960,"sample_rate":8000,"sensitivity":1.5}}"#,
            );
            assert_eq!(bad["ok"], false);
            assert_eq!(bad["error"]["code"], "validation");
            assert_eq!(nf_v1_close(h), 1);

            let t = nf_v1_open(b"tally".as_ptr(), 5, &mut error);
            assert!(t > 0 && error.is_null());
            assert_eq!(apply(t, r#"{"op":"new","payload":{}}"#)["ok"], true);
            let pivot = apply(
                t,
                r#"{"op":"insertPivot","payload":{"pivot":{"source":{"range":{"from":"A1","to":"B2"}},"values":[{"field":1,"agg":"sum"}],"filters":[{"field":0,"values":[]}]}}}"#,
            );
            assert_eq!(pivot["ok"], true, "{pivot}");
            assert_eq!(pivot["data"]["pivot"]["filters"][0]["values"], serde_json::json!([]));
            assert_eq!(nf_v1_close(t), 1);
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
