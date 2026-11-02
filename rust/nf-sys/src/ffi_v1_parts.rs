//! A structured FFI command boundary for Nitro v1 native classes.
//! This avoids C++ JSON injection and avoids a second C++ JSON parser.

use ignition_core::{Command, CommandResult, EngineError, Event, COMMAND_VERSION, OP_REDO, OP_SNAPSHOT, OP_UNDO};
use std::ffi::{c_char, CString};
use std::ptr;

const MAX_COMMAND_BYTES: usize = 32 * 1024 * 1024;

#[repr(C)]
pub struct NfV1Event {
    pub kind: *mut c_char,
    pub detail_json: *mut c_char,
}

#[repr(C)]
pub struct NfV1CommandResult {
    pub data_json: *mut c_char,
    pub events: *mut NfV1Event,
    pub event_count: usize,
    pub error_json: *mut c_char,
}

fn empty() -> NfV1CommandResult {
    NfV1CommandResult {
        data_json: ptr::null_mut(), events: ptr::null_mut(),
        event_count: 0, error_json: ptr::null_mut(),
    }
}

fn serialize_error(error: EngineError) -> NfV1CommandResult {
    let mut result = empty();
    result.error_json = super::error_json(error).into_raw();
    result
}

fn ok(result: CommandResult) -> NfV1CommandResult {
    let mut out = empty();
    out.data_json = CString::new(result.data.to_string()).unwrap().into_raw();
    if !result.events.is_empty() {
        let items: Vec<NfV1Event> = result.events.into_iter().map(|event| NfV1Event {
            kind: CString::new(event.kind).unwrap().into_raw(),
            detail_json: if event.detail.is_null() { ptr::null_mut() }
                else { CString::new(event.detail.to_string()).unwrap().into_raw() },
        }).collect();
        let boxed = items.into_boxed_slice();
        out.event_count = boxed.len();
        out.events = Box::into_raw(boxed) as *mut NfV1Event;
    }
    out
}

/// Consumes exactly one versioned command, with its op and JSON payload
/// supplied as separately bounded UTF-8 inputs.
///
/// # Safety
/// op is readable for op_len bytes; payload is readable for payload_len bytes
/// when payload_len > 0. The returned allocation must be freed exactly once
/// using nf_v1_free_command_result.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_apply_parts(
    handle: i64, op: *const u8, op_len: usize,
    payload: *const u8, payload_len: usize, version: u32,
) -> NfV1CommandResult {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if op.is_null() || op_len == 0 || op_len > 128 {
            return Err(EngineError::invalid("invalid native operation name"));
        }
        if payload_len > MAX_COMMAND_BYTES || (payload.is_null() && payload_len > 0) {
            return Err(EngineError::invalid("payload exceeds 32 MiB or is null"));
        }
        let name = std::str::from_utf8(std::slice::from_raw_parts(op, op_len))
            .map_err(|_| EngineError::invalid("operation is not UTF-8"))?;
        let value = if payload_len == 0 {
            serde_json::Value::Null
        } else {
            serde_json::from_slice(std::slice::from_raw_parts(payload, payload_len))
                .map_err(|e| EngineError::invalid(format!("invalid payload JSON: {e}")))?
        };
        let command = Command {
            op: name.to_owned(),
            v: if version == 0 { COMMAND_VERSION } else { version },
            payload: value,
        };
        super::ffi_v1::with_v1_engine(handle, move |engine| match command.op.as_str() {
            OP_UNDO => engine.undo().map(|undone| CommandResult {
                data: serde_json::json!({"undone":undone}), events: vec![],
            }),
            OP_REDO => engine.redo().map(|redone| CommandResult {
                data: serde_json::json!({"redone":redone}), events: vec![],
            }),
            OP_SNAPSHOT => engine.snapshot().map(|snapshot| CommandResult {
                data: serde_json::json!({"bytes":ignition_core::base64_encode(&snapshot)}),
                events: vec![],
            }),
            _ => engine.apply(command),
        })
    }));
    match outcome {
        Ok(Ok(value)) => ok(value),
        Ok(Err(error)) => serialize_error(error),
        Err(_) => serialize_error(EngineError::internal("panic translating native command")),
    }
}

/// Release every string and event-array allocation returned from apply_parts.
///
/// # Safety
/// Accept only a result returned by nf_v1_apply_parts, once. Do not pass
/// fabricated or previously released pointers.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_free_command_result(value: NfV1CommandResult) {
    fn free_string(ptr: *mut c_char) {
        if !ptr.is_null() {
            unsafe { drop(CString::from_raw(ptr)); }
        }
    }
    free_string(value.data_json);
    free_string(value.error_json);
    if !value.events.is_null() && value.event_count > 0 {
        let events = std::slice::from_raw_parts_mut(value.events, value.event_count);
        for item in events.iter_mut() {
            free_string(item.kind);
            free_string(item.detail_json);
        }
        drop(Box::<[NfV1Event]>::from_raw(events));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::ffi_v1::{nf_v1_close, nf_v1_open};
    use std::ffi::CStr;

    #[test]
    fn structured_payload_keeps_json_scope_and_owned_event_memory() {
        unsafe {
            let mut err: *mut c_char = ptr::null_mut();
            let h = nf_v1_open(b"tally".as_ptr(), 5, &mut err);
            assert!(h > 0 && err.is_null());
            let result = nf_v1_apply_parts(h, b"new".as_ptr(), 3,
                b"{}".as_ptr(), 2, 1);
            assert!(result.error_json.is_null());
            assert!(!result.data_json.is_null());
            assert_eq!(result.event_count, 1);
            nf_v1_free_command_result(result);

            let payload = br#"{"addr":"A1","value":"42"}"#;
            let result = nf_v1_apply_parts(h, b"setCell".as_ptr(), 7,
                payload.as_ptr(), payload.len(), 1);
            assert!(result.error_json.is_null());
            assert_eq!(result.event_count, 1);
            let event = &*result.events;
            assert_eq!(CStr::from_ptr(event.kind).to_str().unwrap(), "document:changed");
            nf_v1_free_command_result(result);

            let value = br#"{"addr":"A1"}"#;
            let result = nf_v1_apply_parts(h, b"getCell".as_ptr(), 7,
                value.as_ptr(), value.len(), 1);
            assert!(result.error_json.is_null());
            assert_eq!(result.event_count, 0);
            let json: serde_json::Value =
                serde_json::from_str(CStr::from_ptr(result.data_json).to_str().unwrap()).unwrap();
            assert_eq!(json["computed"].as_f64(), Some(42.0));
            nf_v1_free_command_result(result);
            assert_eq!(nf_v1_close(h), 1);
        }
    }

    #[test]
    fn rejects_payload_injection_and_invalid_op_without_corrupting_session() {
        unsafe {
            let mut err: *mut c_char = ptr::null_mut();
            let h = nf_v1_open(b"tally".as_ptr(), 5, &mut err);
            assert!(h > 0);
            let injection = br#"{},"v":1"#;
            let result = nf_v1_apply_parts(h, b"new".as_ptr(), 3,
                injection.as_ptr(), injection.len(), 1);
            assert!(!result.error_json.is_null());
            nf_v1_free_command_result(result);
            let result = nf_v1_apply_parts(h, ptr::null(), 5, ptr::null(), 0, 1);
            assert!(!result.error_json.is_null());
            nf_v1_free_command_result(result);
            assert_eq!(nf_v1_close(h), 1);
        }
    }
}
