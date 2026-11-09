//! nf-sys — stable C ABI over ignition_core::SessionRegistry.
//!
//! The Nitro-generated C++ side of `@nitro-forge/ignition` calls these symbols.
//! Text crosses as UTF-8 JSON; snapshots cross as raw bytes (call `nf_free_bytes`
//! to release). Strings returned by `nf_apply`/`nf_snapshot_json` are
//! heap-allocated; release them with `nf_free_string`.
//!
//! Ownership: the registry owns engines; handles are the only reference.
//! Threading: all functions take the registry lock — callers may invoke from
//! any thread, and the native layer must serialize per-handle (documented in
//! docs/ARCHITECTURE.md §2).

// New v1 transport is separate: legacy nf_* entrypoints remain available.
mod dispatch;
mod ffi_binary;
mod ffi_v1;
mod ffi_v1_parts;
mod session_registry;
#[cfg(test)]
mod batch_tests;

use ignition_core::{
    base64_decode,
    Command, Engine, EngineError, EngineKind, ErrorCode, SessionRegistry,
};
use std::ffi::{c_char, c_void, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};

fn factory(kind: EngineKind) -> Option<Box<dyn Engine>> {
    match kind {
        EngineKind::Prism => Some(Box::new(prism_engine::PrismEngine::new(0, 0))),
        EngineKind::Cadence => Some(Box::new(cadence_engine::CadenceEngine::new())),
        EngineKind::Splice => Some(Box::new(splice_engine::SpliceEngine::new())),
        EngineKind::Folio => Some(Box::new(folio_engine::FolioEngine::new())),
        EngineKind::Pitch => Some(Box::new(pitch_engine::PitchEngine::new())),
        EngineKind::Tally => Some(Box::new(tally_engine::TallyEngine::new())),
        EngineKind::Quill => Some(Box::new(quill_engine::QuillEngine::new())),
        EngineKind::Photo => Some(Box::new(photo_engine::PhotoEngine::new())),
        EngineKind::Motion => Some(Box::new(motion_engine::MotionEngine::new())),
        EngineKind::Design => Some(Box::new(design_engine::DesignEngine::new())),
        EngineKind::Draft => Some(Box::new(draft_engine::DraftEngine::new())),
        EngineKind::Scene => Some(Box::new(scene_engine::SceneEngine::new())),
    }
}

fn registry() -> &'static Mutex<SessionRegistry> {
    static REG: OnceLock<Mutex<SessionRegistry>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(SessionRegistry::new()))
}

/// Poison-tolerant lock: if an engine panicked while holding the registry,
/// the poisoned mutex would otherwise turn every subsequent call into a
/// panic → abort across the FFI boundary. The registry itself is still
/// sound (dead handles were closed), so we recover it.
fn reg_lock() -> std::sync::MutexGuard<'static, SessionRegistry> {
    registry().lock().unwrap_or_else(|e| e.into_inner())
}

/// Write an error string to a caller-provided out-param, tolerating NULL.
unsafe fn set_err(out_err: *mut *mut c_char, e: EngineError) {
    if !out_err.is_null() {
        *out_err = error_json(e).into_raw();
    }
}

fn error_json(e: EngineError) -> CString {
    CString::new(serde_json::to_string(&e).unwrap()).unwrap()
}

fn ok_json(v: serde_json::Value) -> CString {
    CString::new(serde_json::to_string(&v).unwrap()).unwrap()
}

unsafe fn read_str<'a>(s: *const c_char) -> Result<&'a str, EngineError> {
    if s.is_null() {
        return Err(EngineError::invalid("null string argument"));
    }
    CStr::from_ptr(s)
        .to_str()
        .map_err(|_| EngineError::invalid("argument is not valid UTF-8"))
}

/// Open an engine. `kind` is one of: prism cadence splice folio pitch tally quill photo motion design draft scene.
/// Returns a handle > 0, or 0 on failure (writes an error string to
/// `*out_err`, free with nf_free_string).
#[no_mangle]
pub unsafe extern "C" fn nf_open(kind: *const c_char, out_err: *mut *mut c_char) -> i64 {
    let kind = match read_str(kind) {
        Ok(s) => s,
        Err(e) => {
            set_err(out_err, e);
            return 0;
        }
    };
    let Some(k) = EngineKind::parse(kind) else {
        set_err(out_err, EngineError::invalid(format!("unknown engine '{kind}'")));
        return 0;
    };
    match factory(k) {
        Some(e) => reg_lock().open(e) as i64,
        None => {
            set_err(
                out_err,
                EngineError::unsupported(format!("engine '{kind}' not linked")),
            );
            0
        }
    }
}

/// Apply a JSON command. Returns a JSON string:
///   {"ok":true,"data":…,"events":[…]}  or  {"ok":false,"error":{…}}
/// Always returns a non-null string the caller must free with nf_free_string.
/// Returns null only on panic before the response could be built.
#[no_mangle]
pub unsafe extern "C" fn nf_apply(handle: i64, command_json: *const c_char) -> *mut c_char {
    let result = catch_unwind(AssertUnwindSafe(|| -> CString {
        let cmd_str = match read_str(command_json) {
            Ok(s) => s.to_owned(),
            Err(e) => return error_json(e),
        };
        let cmd: Command = match serde_json::from_str(&cmd_str) {
            Ok(c) => c,
            Err(e) => return error_json(e.into()),
        };
        let mut reg = reg_lock();
        let engine = match reg.require_mut(handle as u64) {
            Ok(e) => e,
            Err(e) => return error_json(e),
        };
        let out = match cmd.op.as_str() {
            ignition_core::OP_UNDO => engine
                .undo()
                .map(|u| serde_json::json!({"ok":true,"data":{"undone":u}})),
            ignition_core::OP_REDO => engine
                .redo()
                .map(|r| serde_json::json!({"ok":true,"data":{"redone":r}})),
            ignition_core::OP_SNAPSHOT => engine.snapshot().map(|b| {
                serde_json::json!({"ok":true,"data":{"bytes":ignition_core::base64_encode(&b)}})
            }),
            _ => engine
                .apply(cmd)
                .map(|r| serde_json::json!({"ok":true,"data":r.data,"events":r.events})),
        };
        match out {
            Ok(v) => ok_json(v),
            Err(e) => {
                if !e.recoverable {
                    reg.close(handle as u64);
                }
                ok_json(serde_json::json!({"ok":false,"error":e}))
            }
        }
    }));
    match result {
        Ok(s) => s.into_raw(),
        Err(_) => {
            reg_lock().close(handle as u64);
            error_json(EngineError {
                code: ErrorCode::Internal,
                message: "engine panicked; session closed".into(),
                recoverable: false,
            })
            .into_raw()
        }
    }
}

/// Opaque byte buffer returned by nf_snapshot. Free with nf_free_bytes.
#[repr(C)]
pub struct NfBytes {
    pub ptr: *mut u8,
    pub len: usize,
}

const NULL_BYTES: NfBytes = NfBytes {
    ptr: std::ptr::null_mut(),
    len: 0,
};

/// Serialize a document to the NFD1 envelope. On failure returns
/// {ptr:null,len:0} and writes an error string to *out_err.
/// The returned buffer is a boxed slice — release with nf_free_bytes.
#[no_mangle]
pub unsafe extern "C" fn nf_snapshot(handle: i64, out_err: *mut *mut c_char) -> NfBytes {
    match catch_unwind(AssertUnwindSafe(|| {
        let reg = reg_lock();
        let engine = match reg.require(handle as u64) {
            Ok(e) => e,
            Err(e) => {
                set_err(out_err, e);
                return NULL_BYTES;
            }
        };
        match engine.snapshot() {
            Ok(b) => {
                // Box the exact slice so free doesn't depend on Vec capacity.
                let boxed: Box<[u8]> = b.into_boxed_slice();
                let len = boxed.len();
                let ptr = Box::into_raw(boxed) as *mut u8;
                NfBytes { ptr, len }
            }
            Err(e) => {
                set_err(out_err, e);
                NULL_BYTES
            }
        }
    })) {
        Ok(b) => b,
        Err(_) => {
            reg_lock().close(handle as u64);
            set_err(
                out_err,
                EngineError::internal("engine panicked in snapshot; session closed"),
            );
            NULL_BYTES
        }
    }
}

/// Restore a document from envelope bytes. Returns null on success, or a
/// heap error string (free with nf_free_string) on failure.
#[no_mangle]
pub unsafe extern "C" fn nf_restore(handle: i64, ptr: *const u8, len: usize) -> *mut c_char {
    if ptr.is_null() || len == 0 {
        return error_json(EngineError::invalid("restore requires non-empty bytes")).into_raw();
    }
    let data = std::slice::from_raw_parts(ptr, len).to_vec();
    match catch_unwind(AssertUnwindSafe(|| {
        let mut reg = reg_lock();
        let engine = match reg.require_mut(handle as u64) {
            Ok(e) => e,
            Err(e) => return error_json(e).into_raw(),
        };
        match engine.restore(&data) {
            Ok(()) => std::ptr::null_mut(),
            Err(e) => error_json(e).into_raw(),
        }
    })) {
        Ok(p) => p,
        Err(_) => {
            reg_lock().close(handle as u64);
            error_json(EngineError::internal("engine panicked in restore; session closed"))
                .into_raw()
        }
    }
}

/// Restore from a base64 string instead of raw bytes (convenience for hosts
/// where keeping a byte buffer alive across the boundary is awkward).
#[no_mangle]
pub unsafe extern "C" fn nf_restore_b64(handle: i64, b64: *const c_char) -> *mut c_char {
    let s = match read_str(b64) {
        Ok(s) => s,
        Err(e) => return error_json(e).into_raw(),
    };
    match base64_decode(s) {
        Ok(bytes) => nf_restore(handle, bytes.as_ptr(), bytes.len()),
        Err(e) => error_json(e).into_raw(),
    }
}

/// Close a document. Returns 1 if a live engine was dropped, else 0.
#[no_mangle]
pub unsafe extern "C" fn nf_close(handle: i64) -> i32 {
    catch_unwind(AssertUnwindSafe(|| reg_lock().close(handle as u64) as i32))
        .unwrap_or(0)
}

/// Free a string returned by this library.
#[no_mangle]
pub unsafe extern "C" fn nf_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// Free a byte buffer returned by nf_snapshot (a boxed slice).
#[no_mangle]
pub unsafe extern "C" fn nf_free_bytes(b: NfBytes) {
    if !b.ptr.is_null() && b.len > 0 {
        drop(Box::<[u8]>::from_raw(std::slice::from_raw_parts_mut(
            b.ptr, b.len,
        )));
    }
}

/// For hosts that need a null-terminated pointer to allocated byte memory
/// without Vec layout knowledge — copies `len` bytes into a malloc'd block.
#[no_mangle]
pub unsafe extern "C" fn nf_alloc_copy(ptr: *const c_void, len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    std::ptr::copy_nonoverlapping(ptr as *const u8, v.as_mut_ptr(), len);
    v.set_len(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn ffi_open_apply_snapshot_restore_close() {
        unsafe {
            let mut err: *mut c_char = std::ptr::null_mut();
            let kind = CString::new("tally").unwrap();
            let h = nf_open(kind.as_ptr(), &mut err);
            assert!(h > 0, "open failed: {:?}", CStr::from_ptr(err));

            let cmd = CString::new(r#"{"op":"new","payload":{}}"#).unwrap();
            let res = CStr::from_ptr(nf_apply(h, cmd.as_ptr())).to_str().unwrap().to_owned();
            assert!(res.contains("\"ok\":true"), "{res}");

            let cmd = CString::new(
                r#"{"op":"setCell","payload":{"addr":"A1","value":"42"}}"#,
            )
            .unwrap();
            let res = CStr::from_ptr(nf_apply(h, cmd.as_ptr())).to_str().unwrap().to_owned();
            assert!(res.contains("\"ok\":true"), "{res}");

            let snap = nf_snapshot(h, &mut err);
            assert!(!snap.ptr.is_null() && snap.len > 9);
            let bytes = std::slice::from_raw_parts(snap.ptr, snap.len).to_vec();
            nf_free_bytes(snap);

            // mutate, then restore to snapshot
            let cmd = CString::new(
                r#"{"op":"setCell","payload":{"addr":"A1","value":"7"}}"#,
            )
            .unwrap();
            let res_ptr = nf_apply(h, cmd.as_ptr());
            nf_free_string(res_ptr);
            let errp = nf_restore(h, bytes.as_ptr(), bytes.len());
            assert!(errp.is_null(), "restore failed");

            let cmd = CString::new(r#"{"op":"getCell","payload":{"addr":"A1"}}"#).unwrap();
            let res = CStr::from_ptr(nf_apply(h, cmd.as_ptr())).to_str().unwrap().to_owned();
            assert!(res.contains("42"), "{res}");

            assert_eq!(nf_close(h), 1);
            assert_eq!(nf_close(h), 0);
        }
    }
}
