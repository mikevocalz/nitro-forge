//! Thin FFI declarations for the nf_raw_shim C ABI (src/raw_shim.cpp).
//! Unsafe in this crate lives in three places: this module (the extern
//! "C" progress trampoline), src/lib.rs (FFI call sites and CStr/slice
//! handling around the shim boundary), and the native shim itself.

use std::ffi::c_void;
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, Ordering};

/// Mirrors `nf_raw_info_t` in src/nf_raw.h. Field order and sizes must match.
#[repr(C)]
pub(crate) struct RawInfoC {
    pub make: [u8; 64],
    pub model: [u8; 64],
    pub format: [u8; 32],
    pub width: u32,
    pub height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
}

pub(crate) type PollFn = extern "C" fn(*mut c_void) -> i32;

extern "C" {
    pub(crate) fn nf_raw_probe(
        data: *const u8,
        len: usize,
        info: *mut RawInfoC,
        err: *mut c_char,
        errlen: usize,
    ) -> i32;

    pub(crate) fn nf_raw_decode(
        data: *const u8,
        len: usize,
        max_pixels: u64,
        cancel_ctx: *mut c_void,
        cancel_poll: PollFn,
        info: *mut RawInfoC,
        out: *mut *mut u8,
        out_len: *mut usize,
        err: *mut c_char,
        errlen: usize,
    ) -> i32;

    pub(crate) fn nf_raw_free(p: *mut u8);
}

/// Progress-callback trampoline: LibRaw calls this on the decoding thread;
/// it only performs an atomic load on the caller-owned flag.
extern "C" fn poll_cancel(ctx: *mut c_void) -> i32 {
    // SAFETY: ctx is always a `*const AtomicBool` produced by `cancel_ctx`
    // below and outlives the synchronous decode call. Only `.load()` is used.
    unsafe { (*(ctx as *const AtomicBool)).load(Ordering::Relaxed) as i32 }
}

/// Opaque cancellation context handed to the shim. The shim stores the raw
/// pointer and only dereferences it through `POLL_CANCEL` on the same thread.
pub(crate) struct CancelCtx<'a> {
    flag: &'a AtomicBool,
}

impl<'a> CancelCtx<'a> {
    pub(crate) fn new(flag: &'a AtomicBool) -> Self {
        Self { flag }
    }

    /// Returns the (ctx, poll) pair expected by `nf_raw_decode`.
    pub(crate) fn parts(&self) -> (*mut c_void, PollFn) {
        (self.flag as *const AtomicBool as *mut c_void, poll_cancel)
    }
}
