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
    }
}

fn registry() -> &'static Mutex<SessionRegistry> {
    static REG: OnceLock<Mutex<SessionRegistry>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(SessionRegistry::new()))
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

/// Open an engine. `kind` is one of: prism cadence splice folio pitch tally quill.
/// Returns a handle > 0, or 0 on failure (writes an error string to
/// `*out_err`, free with nf_free_string).
#[no_mangle]
pub unsafe extern "C" fn nf_open(kind: *const c_char, out_err: *mut *mut c_char) -> i64 {
    let kind = match read_str(kind) {
        Ok(s) => s,
        Err(e) => {
            *out_err = error_json(e).into_raw();
            return 0;
        }
    };
    let Some(k) = EngineKind::parse(kind) else {
        *out_err = error_json(EngineError::invalid(format!("unknown engine '{kind}'"))).into_raw();
        return 0;
    };
    match factory(k) {
        Some(e) => registry().lock().unwrap().open(e) as i64,
        None => {
            *out_err = error_json(EngineError::unsupported(format!(
                "engine '{kind}' not linked"
            )))
            .into_raw();
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
        let mut reg = registry().lock().unwrap();
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
            registry().lock().unwrap().close(handle as u64);
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

/// Serialize a document to the NFD1 envelope. On failure returns
/// {ptr:null,len:0} and writes an error string to *out_err.
#[no_mangle]
pub unsafe extern "C" fn nf_snapshot(handle: i64, out_err: *mut *mut c_char) -> NfBytes {
    let reg = registry().lock().unwrap();
    let engine = match reg.require(handle as u64) {
        Ok(e) => e,
        Err(e) => {
            *out_err = error_json(e).into_raw();
            return NfBytes {
                ptr: std::ptr::null_mut(),
                len: 0,
            };
        }
    };
    match engine.snapshot() {
        Ok(mut b) => {
            let buf = NfBytes {
                ptr: b.as_mut_ptr(),
                len: b.len(),
            };
            std::mem::forget(b);
            buf
        }
        Err(e) => {
            *out_err = error_json(e).into_raw();
            NfBytes {
                ptr: std::ptr::null_mut(),
                len: 0,
            }
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
    let data = std::slice::from_raw_parts(ptr, len);
    let mut reg = registry().lock().unwrap();
    let engine = match reg.require_mut(handle as u64) {
        Ok(e) => e,
        Err(e) => return error_json(e).into_raw(),
    };
    match engine.restore(data) {
        Ok(()) => std::ptr::null_mut(),
        Err(e) => error_json(e).into_raw(),
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
    registry().lock().unwrap().close(handle as u64) as i32
}

/// Free a string returned by this library.
#[no_mangle]
pub unsafe extern "C" fn nf_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// Free a byte buffer returned by nf_snapshot.
#[no_mangle]
pub unsafe extern "C" fn nf_free_bytes(b: NfBytes) {
    if !b.ptr.is_null() && b.len > 0 {
        drop(Vec::from_raw_parts(b.ptr, b.len, b.len));
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
