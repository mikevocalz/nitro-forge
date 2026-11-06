//! A structured FFI command boundary for Nitro v1 native classes.
//! This avoids C++ JSON injection and avoids a second C++ JSON parser.

use ignition_core::{Command, CommandResult, EngineError, COMMAND_VERSION};
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

pub(crate) fn empty() -> NfV1CommandResult {
    NfV1CommandResult {
        data_json: ptr::null_mut(),
        events: ptr::null_mut(),
        event_count: 0,
        error_json: ptr::null_mut(),
    }
}

pub(crate) fn serialize_error(error: EngineError) -> NfV1CommandResult {
    let mut result = empty();
    result.error_json = super::error_json(error).into_raw();
    result
}

/// Convert a result into owned C strings. Fallible instead of panicking:
/// this runs inside `catch_unwind`, and nothing is leaked when one string
/// fails, because raw pointers are only taken after every conversion succeeds.
pub(crate) fn ok(result: CommandResult) -> Result<NfV1CommandResult, EngineError> {
    let c_string = |text: String, what: &str| {
        CString::new(text).map_err(|_| EngineError::internal(format!("{what} contains a NUL byte")))
    };
    let data = c_string(result.data.to_string(), "result data")?;
    let mut events = Vec::with_capacity(result.events.len());
    for event in result.events {
        let detail = if event.detail.is_null() {
            None
        } else {
            Some(c_string(event.detail.to_string(), "event detail")?)
        };
        events.push((c_string(event.kind, "event kind")?, detail));
    }
    let mut out = empty();
    out.data_json = data.into_raw();
    if !events.is_empty() {
        let items: Vec<NfV1Event> = events
            .into_iter()
            .map(|(kind, detail)| NfV1Event {
                kind: kind.into_raw(),
                detail_json: detail.map_or(ptr::null_mut(), CString::into_raw),
            })
            .collect();
        let boxed = items.into_boxed_slice();
        out.event_count = boxed.len();
        out.events = Box::into_raw(boxed) as *mut NfV1Event;
    }
    Ok(out)
}

/// Parse the op name and JSON payload shared by every structured v1 entry
/// point (apply_parts, apply_binary, task_start).
///
/// # Safety
/// op is readable for op_len bytes; payload is readable for payload_len bytes
/// when payload_len > 0.
pub(crate) unsafe fn read_command(
    op: *const u8,
    op_len: usize,
    payload: *const u8,
    payload_len: usize,
    version: u32,
) -> Result<Command, EngineError> {
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
    let mut command = Command::new(name, value);
    command.v = if version == 0 {
        COMMAND_VERSION
    } else {
        version
    };
    Ok(command)
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
    handle: i64,
    op: *const u8,
    op_len: usize,
    payload: *const u8,
    payload_len: usize,
    version: u32,
) -> NfV1CommandResult {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let command = read_command(op, op_len, payload, payload_len, version)?;
        super::ffi_v1::with_v1_engine(handle, move |engine| {
            crate::dispatch::run_command(engine, command, None)
        })
        .and_then(ok)
    }));
    match outcome {
        Ok(Ok(value)) => value,
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
            unsafe {
                drop(CString::from_raw(ptr));
            }
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
    use super::super::ffi_v1::{nf_v1_close, nf_v1_open};
    use super::*;
    use ignition_core::Event;
    use std::ffi::CStr;

    #[test]
    fn event_kind_with_nul_is_an_error_not_a_panic() {
        let bad = CommandResult {
            output: None,
            data: serde_json::json!({"ok":true}),
            events: vec![
                Event {
                    kind: "document:changed".into(),
                    detail: serde_json::Value::Null,
                },
                Event {
                    kind: "bad\0kind".into(),
                    detail: serde_json::Value::Null,
                },
            ],
        };
        let error = ok(bad).err().expect("NUL kind must be rejected");
        assert!(serde_json::to_string(&error)
            .unwrap()
            .contains("event kind contains a NUL byte"));
        let good = ok(CommandResult {
            output: None,
            data: serde_json::json!({"x":"a\0b"}),
            events: vec![Event {
                kind: "k".into(),
                detail: serde_json::json!({"d":1}),
            }],
        })
        .expect("JSON text escapes NUL");
        assert_eq!(good.event_count, 1);
        unsafe { nf_v1_free_command_result(good) };
    }

    #[test]
    fn structured_payload_keeps_json_scope_and_owned_event_memory() {
        unsafe {
            let mut err: *mut c_char = ptr::null_mut();
            let h = nf_v1_open(b"tally".as_ptr(), 5, &mut err);
            assert!(h > 0 && err.is_null());
            let result = nf_v1_apply_parts(h, b"new".as_ptr(), 3, b"{}".as_ptr(), 2, 1);
            assert!(result.error_json.is_null());
            assert!(!result.data_json.is_null());
            assert_eq!(result.event_count, 1);
            nf_v1_free_command_result(result);

            let payload = br#"{"addr":"A1","value":"42"}"#;
            let result = nf_v1_apply_parts(
                h,
                b"setCell".as_ptr(),
                7,
                payload.as_ptr(),
                payload.len(),
                1,
            );
            assert!(result.error_json.is_null());
            assert_eq!(result.event_count, 1);
            let event = &*result.events;
            assert_eq!(
                CStr::from_ptr(event.kind).to_str().unwrap(),
                "document:changed"
            );
            nf_v1_free_command_result(result);

            let value = br#"{"addr":"A1"}"#;
            let result =
                nf_v1_apply_parts(h, b"getCell".as_ptr(), 7, value.as_ptr(), value.len(), 1);
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
            let result = nf_v1_apply_parts(
                h,
                b"new".as_ptr(),
                3,
                injection.as_ptr(),
                injection.len(),
                1,
            );
            assert!(!result.error_json.is_null());
            nf_v1_free_command_result(result);
            let result = nf_v1_apply_parts(h, ptr::null(), 5, ptr::null(), 0, 1);
            assert!(!result.error_json.is_null());
            nf_v1_free_command_result(result);
            assert_eq!(nf_v1_close(h), 1);
        }
    }
}
