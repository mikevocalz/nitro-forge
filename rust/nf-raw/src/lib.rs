//! nf-raw: host-side RAW provider producing bounded RGBA8 previews.
//!
//! This crate is the "provider outside photo-engine" described in
//! `docs/completion/reports/P10-raw-decoder-decision.md`. It wraps LibRaw
//! 0.22.3 (CDDL-1.0 route) through a small C ABI shim (`src/raw_shim.cpp`,
//! `src/ffi.rs`, `src/nf_raw.h`). `photo-engine` stays
//! `#![forbid(unsafe_code)]` and I/O-free; this crate does the native decode
//! on the caller's worker thread and returns owned pixels that a host can
//! feed to `processPreview` / `nf_v1_apply_binary`.
//!
//! Output contract (matches `processPreview` in packages/photo/rust):
//! packed straight-alpha sRGB RGBA8, `width * height * 4` bytes, at most
//! [`MAX_PREVIEW_PIXELS`] pixels and [`MAX_PREVIEW_SIDE`] per side.
//!
//! Platform status: **macOS arm64 proven** (see README.md). iOS, Android,
//! visionOS, Quest, PICO and WASM builds are NOT yet implemented; see the
//! README for the exact build requirements per target.

mod ffi;
#[cfg(test)]
mod tests;

use std::ffi::CStr;
use std::fmt;
use std::sync::atomic::AtomicBool;

/// Maximum RAW input size accepted by probe/decode (prototype cap).
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;
/// Maximum RAW pixel count (raw_width * raw_height) accepted after open and
/// after unpack (prototype cap: 40 MP).
pub const MAX_RAW_PIXELS: u64 = 40_000_000;
/// LibRaw raw-memory budget passed to `rawparams.max_raw_memory_mb`.
pub const MAX_RAW_MEMORY_MB: u32 = 256;
/// Output preview bound matching photo-engine's `processPreview` limits.
pub const MAX_PREVIEW_PIXELS: u64 = 1_048_576;
pub const MAX_PREVIEW_SIDE: u32 = 4096;

/// Metadata describing a probed RAW file. `width`/`height` are the raw
/// (unrotated, uncropped) sensor dimensions in pixels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawInfo {
    pub make: String,
    pub model: String,
    /// Coarse container class: `"dng"` or `"raw"`.
    pub format: String,
    pub width: u32,
    pub height: u32,
}

/// Owned RGBA8 preview plus the metadata of the source RAW.
#[derive(Clone, Debug)]
pub struct RawPreview {
    /// Packed RGBA8, `width * height * 4` bytes, straight alpha (all 255).
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub info: RawInfo,
}

/// Failure detail returned by the native layer: LibRaw error code plus the
/// `libraw_strerror` message captured at the failing stage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LibRawFailure {
    pub code: i32,
    pub message: String,
}

/// Typed provider errors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RawError {
    /// Input failed local validation (empty, >64 MiB, bad arguments).
    InvalidInput(&'static str),
    /// A documented budget was exceeded (RAW pixels, preview pixels/side).
    LimitExceeded(LibRawFailure),
    /// `open_buffer`/identify stage failed.
    Probe(LibRawFailure),
    /// LibRaw reports the file/format as unsupported.
    Unsupported(LibRawFailure),
    /// unpack/dcraw_process/mem-image stage failed.
    Decode(LibRawFailure),
    /// The cooperative cancel flag fired (LibRaw -100010).
    Cancelled,
    /// Allocation failure inside the decoder or preview expansion.
    Oom(LibRawFailure),
}

impl fmt::Display for RawError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RawError::InvalidInput(r) => write!(f, "invalid RAW input: {r}"),
            RawError::LimitExceeded(e) => {
                write!(f, "RAW limit exceeded ({}): {}", e.code, e.message)
            }
            RawError::Probe(e) => write!(f, "RAW probe failed ({}): {}", e.code, e.message),
            RawError::Unsupported(e) => {
                write!(f, "unsupported RAW ({}): {}", e.code, e.message)
            }
            RawError::Decode(e) => write!(f, "RAW decode failed ({}): {}", e.code, e.message),
            RawError::Cancelled => write!(f, "RAW decode cancelled"),
            RawError::Oom(e) => write!(f, "RAW out of memory ({}): {}", e.code, e.message),
        }
    }
}

impl std::error::Error for RawError {}

// LibRaw error codes (libraw/libraw_const.h).
const LIBRAW_SUCCESS: i32 = 0;
const LIBRAW_FILE_UNSUPPORTED: i32 = -2;
const LIBRAW_UNSUFFICIENT_MEMORY: i32 = -100007;
const LIBRAW_MEMPOOL_OVERFLOW: i32 = -100013;
const LIBRAW_CANCELLED_BY_CALLBACK: i32 = -100010;
const LIBRAW_TOO_BIG: i32 = -100012;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    Probe,
    Decode,
}

fn map_error(code: i32, message: String, stage: Stage) -> RawError {
    let failure = LibRawFailure { code, message };
    match code {
        LIBRAW_CANCELLED_BY_CALLBACK => RawError::Cancelled,
        LIBRAW_FILE_UNSUPPORTED => RawError::Unsupported(failure),
        LIBRAW_TOO_BIG => RawError::LimitExceeded(failure),
        LIBRAW_UNSUFFICIENT_MEMORY | LIBRAW_MEMPOOL_OVERFLOW => RawError::Oom(failure),
        _ => match stage {
            Stage::Probe => RawError::Probe(failure),
            Stage::Decode => RawError::Decode(failure),
        },
    }
}

fn check_input(bytes: &[u8]) -> Result<(), RawError> {
    if bytes.is_empty() {
        return Err(RawError::InvalidInput("input is empty"));
    }
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(RawError::InvalidInput("input exceeds 64 MiB"));
    }
    Ok(())
}

fn blank_info() -> ffi::RawInfoC {
    ffi::RawInfoC {
        make: [0; 64],
        model: [0; 64],
        format: [0; 32],
        width: 0,
        height: 0,
        preview_width: 0,
        preview_height: 0,
    }
}

fn cstr(buf: &[u8]) -> String {
    // SAFETY: the shim zero-fills the info struct and strncpy's at most
    // size-1 bytes per field, so every field is NUL-terminated in-bounds.
    let c = unsafe { CStr::from_ptr(buf.as_ptr() as *const i8) };
    c.to_string_lossy().into_owned()
}

fn read_err(buf: &[i8]) -> String {
    if buf.first() == Some(&0) || buf.is_empty() {
        return String::new();
    }
    // SAFETY: the shim NUL-terminates err within errlen bytes.
    let c = unsafe { CStr::from_ptr(buf.as_ptr()) };
    c.to_string_lossy().into_owned()
}

fn to_info(c: &ffi::RawInfoC) -> RawInfo {
    RawInfo {
        make: cstr(&c.make),
        model: cstr(&c.model),
        format: cstr(&c.format),
        width: c.width,
        height: c.height,
    }
}

/// Parse RAW metadata without decoding pixels. This is still synchronous
/// CPU work inside LibRaw's identify pass; run it on a worker for large
/// files rather than the UI thread.
pub fn probe(bytes: &[u8]) -> Result<RawInfo, RawError> {
    check_input(bytes)?;
    let mut info = blank_info();
    let mut err = [0i8; 256];
    // SAFETY: `bytes` is valid for the call; `info`/`err` are correctly
    // sized out-params; the shim writes at most errlen-1 bytes + NUL.
    let code = unsafe {
        ffi::nf_raw_probe(bytes.as_ptr(), bytes.len(), &mut info, err.as_mut_ptr(), err.len())
    };
    if code != LIBRAW_SUCCESS {
        return Err(map_error(code, read_err(&err), Stage::Probe));
    }
    Ok(to_info(&info))
}

/// Decode a bounded RGBA8 sRGB preview.
///
/// * `bytes` — immutable RAW bytes (≤ [`MAX_INPUT_BYTES`]).
/// * `max_pixels` — output `width * height` cap; must be in
///   `1..=MAX_PREVIEW_PIXELS` (the engine's processPreview budget).
/// * `cancel` — cooperative flag. LibRaw's progress callback polls it at
///   stage boundaries (identify, load_raw start/end, preprocess, demosaic
///   tiles, postprocess); decoder inner loops without callback coverage
///   cannot cancel mid-call. On cancel the decoder is dropped via RAII and
///   [`RawError::Cancelled`] is returned.
///
/// Runs synchronously on the calling thread; run on an exclusive worker,
/// never the UI thread.
pub fn decode_preview(
    bytes: &[u8],
    max_pixels: u64,
    cancel: &AtomicBool,
) -> Result<RawPreview, RawError> {
    check_input(bytes)?;
    if max_pixels == 0 || max_pixels > MAX_PREVIEW_PIXELS {
        return Err(RawError::InvalidInput("max_pixels must be in 1..=1_048_576"));
    }

    let mut info = blank_info();
    let mut err = [0i8; 256];
    let mut out: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;
    let cancel_ctx = ffi::CancelCtx::new(cancel);
    let (ctx, poll) = cancel_ctx.parts();

    // SAFETY: `bytes` is valid for the call; out-params are correctly sized;
    // `ctx` points at the caller's `AtomicBool`, which outlives this
    // synchronous call and is only loaded (never written) by the callback.
    let code = unsafe {
        ffi::nf_raw_decode(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            ctx,
            poll,
            &mut info,
            &mut out,
            &mut out_len,
            err.as_mut_ptr(),
            err.len(),
        )
    };
    if code != LIBRAW_SUCCESS {
        // The shim guarantees *out stays null on failure.
        debug_assert!(out.is_null());
        return Err(map_error(code, read_err(&err), Stage::Decode));
    }
    // SAFETY: on success `out`/`out_len` describe a malloc'd RGBA8 buffer of
    // exactly out_len bytes owned by the shim; copy it into a Vec and
    // immediately release the native allocation.
    let rgba = unsafe {
        let slice = std::slice::from_raw_parts(out, out_len);
        let owned = slice.to_vec();
        ffi::nf_raw_free(out);
        owned
    };
    Ok(RawPreview {
        width: info.preview_width,
        height: info.preview_height,
        info: to_info(&info),
        rgba,
    })
}
