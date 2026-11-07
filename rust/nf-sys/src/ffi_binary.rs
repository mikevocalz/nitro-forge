//! Additive binary/task ABI. The existing v1 result layout is unchanged.
use crate::ffi_v1_parts::{
    nf_v1_free_command_result, ok, read_command, serialize_error, NfV1CommandResult,
};
use crate::{NfBytes, NULL_BYTES};
use ignition_core::{EngineError, TaskContext};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[repr(C)]
pub struct NfBinaryResult {
    pub command: NfV1CommandResult,
    pub output: NfBytes,
}

#[no_mangle]
pub extern "C" fn nf_task_create() -> *mut TaskContext {
    Box::into_raw(Box::new(TaskContext::new()))
}
/// # Safety
/// `task` must remain live for this call; its owner must join all users before freeing it.
#[no_mangle]
pub unsafe extern "C" fn nf_task_cancel(task: *const TaskContext) {
    if let Some(task) = task.as_ref() {
        task.cancel();
    }
}
/// # Safety
/// `task` must remain live for this call.
#[no_mangle]
pub unsafe extern "C" fn nf_task_progress(task: *const TaskContext) -> f32 {
    task.as_ref().map_or(0.0, TaskContext::progress)
}
/// # Safety
/// Free exactly once, after all worker and observer calls finish.
#[no_mangle]
pub unsafe extern "C" fn nf_task_free(task: *mut TaskContext) {
    if !task.is_null() {
        drop(Box::from_raw(task));
    }
}

/// Copies borrowed input into the command before entering an engine; all returned memory is Rust-owned.
/// # Safety
/// All buffers must be readable for their declared lengths. A non-null task must remain live until return.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_apply_binary(
    handle: i64,
    op: *const u8,
    op_len: usize,
    payload: *const u8,
    payload_len: usize,
    version: u32,
    input: *const u8,
    input_len: usize,
    has_input: u8,
    task: *const TaskContext,
) -> NfBinaryResult {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut command = read_command(op, op_len, payload, payload_len, version)?;
        if has_input > 1
            || input_len > crate::dispatch::MAX_BINARY_BYTES
            || (input.is_null() && input_len > 0)
            || (has_input == 0 && input_len > 0)
        {
            return Err(EngineError::invalid("invalid binary input buffer"));
        }
        command.binary_output = true;
        if has_input == 1 {
            command.input = Some(if input_len == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(input, input_len).to_vec()
            });
        }
        let mut result = crate::ffi_v1::with_v1_engine(handle, move |engine| {
            crate::dispatch::run_command(engine, command, task.as_ref())
        })?;
        let output = result.output.take();
        let command = ok(result)?;
        let output = output.map_or(NULL_BYTES, |bytes| {
            let mut bytes = bytes.into_boxed_slice();
            let result = NfBytes {
                ptr: bytes.as_mut_ptr(),
                len: bytes.len(),
            };
            std::mem::forget(bytes);
            result
        });
        Ok::<_, EngineError>(NfBinaryResult { command, output })
    }));
    match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => NfBinaryResult {
            command: serialize_error(error),
            output: NULL_BYTES,
        },
        Err(_) => NfBinaryResult {
            command: serialize_error(EngineError::internal("panic in binary command")),
            output: NULL_BYTES,
        },
    }
}
/// # Safety
/// Free one result from nf_v1_apply_binary exactly once.
#[no_mangle]
pub unsafe extern "C" fn nf_v1_free_binary_result(result: NfBinaryResult) {
    nf_v1_free_command_result(result.command);
    crate::nf_free_bytes(result.output);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;
    unsafe fn run(
        handle: i64,
        op: &str,
        payload: &str,
        input: Option<&[u8]>,
        task: *const TaskContext,
    ) -> NfBinaryResult {
        nf_v1_apply_binary(
            handle,
            op.as_ptr(),
            op.len(),
            payload.as_ptr(),
            payload.len(),
            1,
            input.map_or(std::ptr::null(), |b| b.as_ptr()),
            input.map_or(0, |b| b.len()),
            u8::from(input.is_some()),
            task,
        )
    }
    #[test]
    fn motion_registered_factory_returns_real_binary_rgba() {
        unsafe {
            let mut error=std::ptr::null_mut();
            let kind=std::ffi::CString::new("motion").unwrap();
            let handle=crate::ffi_v1::nf_v1_open(kind.as_ptr().cast(),6,&mut error);
            assert!(handle>0);assert!(error.is_null());
            for(op,payload)in [("new",r#"{"width":1,"height":1}"#),("addShapeLayer",r#"{"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[7,8,9,255]}}"#)]{
                let result=run(handle,op,payload,None,std::ptr::null());assert!(result.command.error_json.is_null());nf_v1_free_binary_result(result);
            }
            let result=run(handle,"renderFrame",r#"{"time_s":0}"#,None,std::ptr::null());
            assert!(result.command.error_json.is_null());assert_eq!(std::slice::from_raw_parts(result.output.ptr,result.output.len),&[7,8,9,255]);nf_v1_free_binary_result(result);
            let rejected=run(handle,"renderFrame",r#"{"time_s":0}"#,Some(&[1]),std::ptr::null());assert!(!rejected.command.error_json.is_null());nf_v1_free_binary_result(rejected);
            assert_eq!(crate::ffi_v1::nf_v1_close(handle),1);
        }
    }

    #[test]
    fn photo_registered_factory_rejects_unsupported_binary_without_mutation() {
        unsafe {
            let mut error=std::ptr::null_mut();
            let kind=std::ffi::CString::new("photo").unwrap();
            let handle=crate::ffi_v1::nf_v1_open(kind.as_ptr().cast(), 5, &mut error);
            assert!(handle>0); assert!(error.is_null());
            let before=run(handle,"__snapshot","{}",None,std::ptr::null());
            assert!(before.command.error_json.is_null());
            let bytes=std::slice::from_raw_parts(before.output.ptr,before.output.len).to_vec();
            nf_v1_free_binary_result(before);
            let rejected=run(handle,"describe","{}",Some(&[1,2,3]),std::ptr::null());
            assert!(!rejected.command.error_json.is_null());
            nf_v1_free_binary_result(rejected);
            let after=run(handle,"__snapshot","{}",None,std::ptr::null());
            assert!(after.command.error_json.is_null());
            assert_eq!(std::slice::from_raw_parts(after.output.ptr,after.output.len),bytes);
            nf_v1_free_binary_result(after);
            assert_eq!(crate::ffi_v1::nf_v1_close(handle),1);
        }
    }

    #[test]
    fn binary_ffi_uses_raw_output_and_cancelled_mutations_stay_atomic() {
        unsafe {
            let kind = "tally";
            let h = crate::ffi_v1::nf_v1_open(kind.as_ptr(), kind.len(), std::ptr::null_mut());
            assert!(h > 0);
            let before = run(h, "__snapshot", "{}", None, std::ptr::null());
            assert!(before.command.error_json.is_null());
            let snapshot =
                std::slice::from_raw_parts(before.output.ptr, before.output.len).to_vec();
            assert_eq!(&snapshot[..4], b"NFD1");
            nf_v1_free_binary_result(before);
            let task = nf_task_create();
            nf_task_cancel(task);
            let rejected = run(h, "setCell", r#"{"addr":"A1","value":"9"}"#, None, task);
            assert!(CStr::from_ptr(rejected.command.error_json)
                .to_str()
                .unwrap()
                .contains("cancelled"));
            nf_v1_free_binary_result(rejected);
            nf_task_free(task);
            let after = run(h, "__snapshot", "{}", None, std::ptr::null());
            assert_eq!(
                std::slice::from_raw_parts(after.output.ptr, after.output.len),
                snapshot
            );
            nf_v1_free_binary_result(after);
            let invalid = run(h, "new", "{}", Some(&[1]), std::ptr::null());
            assert!(!invalid.command.error_json.is_null());
            nf_v1_free_binary_result(invalid);
            assert_eq!(crate::ffi_v1::nf_v1_close(h), 1);
        }
    }
    #[test]
    fn raw_prism_pixels_round_trip_without_base64() {
        unsafe {
            let h = crate::ffi_v1::nf_v1_open(b"prism".as_ptr(), 5, std::ptr::null_mut());
            let r = run(
                h,
                "new",
                r#"{"width":1,"height":1}"#,
                None,
                std::ptr::null(),
            );
            assert!(r.command.error_json.is_null());
            nf_v1_free_binary_result(r);
            let r = run(h, "addRasterLayer", "{}", None, std::ptr::null());
            let data: serde_json::Value =
                serde_json::from_str(CStr::from_ptr(r.command.data_json).to_str().unwrap())
                    .unwrap();
            let id = data["layer_id"].as_u64().unwrap();
            nf_v1_free_binary_result(r);
            let r = run(
                h,
                "drawPixels",
                &format!(r#"{{"id":{id},"x":0,"y":0,"w":1,"h":1}}"#),
                Some(&[1, 2, 3, 255]),
                std::ptr::null(),
            );
            assert!(r.command.error_json.is_null());
            nf_v1_free_binary_result(r);
            let r = run(h, "flatten", "{}", None, std::ptr::null());
            assert!(r.command.error_json.is_null());
            assert_eq!(
                std::slice::from_raw_parts(r.output.ptr, r.output.len),
                [1, 2, 3, 255]
            );
            assert!(!CStr::from_ptr(r.command.data_json)
                .to_str()
                .unwrap()
                .contains("pixels_b64"));
            nf_v1_free_binary_result(r);
            crate::ffi_v1::nf_v1_close(h);
        }
    }
}
