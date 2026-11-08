//! pdfium backend for `folio-render` — the only native-code touchpoint.
//!
//! `pdfium-render` binds to a pdfium shared library at *run time*
//! (dlopen-style). The library is never committed to this repository; its
//! location is resolved by [`resolve_pdfium_library_path`] and documented
//! in `rust/folio-render/README.md`.
//!
//! pdfium objects are not thread-safe by default; the service keeps every
//! session on the thread that opened it (the JSON-lines host is
//! single-threaded). `pdfium-render`'s `thread_safe` feature marks the
//! wrapper types `Send`/`Sync`, but this service deliberately does not
//! rely on that — one worker, one document at a time per handle.

use pdfium_render::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Process-wide pdfium bindings. `Pdfium::bind_to_library` may only be
/// called once per process (the crate stores bindings in a `OnceLock`
/// internally and errors on a second call), so every `RenderService`
/// shares this single initialization.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

/// The pdfium shared library could not be located or loaded.
#[derive(Debug)]
pub struct PdfiumUnavailable(pub String);

impl std::fmt::Display for PdfiumUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "pdfium library unavailable: {}", self.0)
    }
}

impl std::error::Error for PdfiumUnavailable {}

/// Environment variable naming the pdfium shared library file directly
/// (e.g. `/tmp/folio-pdfium/lib/libpdfium.dylib`).
pub const ENV_LIBRARY_PATH: &str = "FOLIO_PDFIUM_LIBRARY";
/// Environment variable naming a directory that contains the platform
/// pdfium library file (`libpdfium.dylib` / `libpdfium.so` / `pdfium.dll`).
pub const ENV_LIBRARY_DIR: &str = "FOLIO_PDFIUM_DIR";

/// Candidate library locations, first hit wins:
///
/// 1. `$FOLIO_PDFIUM_LIBRARY` — full path to the library file.
/// 2. `$FOLIO_PDFIUM_DIR/<platform library name>` — e.g.
///    `libpdfium.dylib`, `libpdfium.so`, `pdfium.dll`.
/// 3. `<crate>/lib/<platform library name>` — the documented local
///    drop-in spot (never committed; see README). Uses the compile-time
///    manifest dir so it resolves regardless of process cwd.
/// 4. `rust/folio-render/lib/<platform library name>` relative to the
///    process working directory — same spot for repo-root invocations.
/// 5. The platform library name alone, resolved through the OS loader
///    search path (dlopen semantics).
pub fn resolve_pdfium_library_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var(ENV_LIBRARY_PATH) {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }
    let name = Pdfium::pdfium_platform_library_name();
    if let Ok(dir) = std::env::var(ENV_LIBRARY_DIR) {
        let p = PathBuf::from(dir).join(&name);
        if p.is_file() {
            return Some(p);
        }
    }
    let manifest_local = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("lib")
        .join(&name);
    if manifest_local.is_file() {
        return Some(manifest_local);
    }
    let cwd_local = Path::new("rust/folio-render/lib").join(&name);
    if cwd_local.is_file() {
        return Some(cwd_local);
    }
    // Fall through to loader search: pass the bare file name.
    Some(PathBuf::from(&name))
}

/// Returns the shared [`Pdfium`] instance, initializing it on first use.
pub fn pdfium() -> Result<&'static Pdfium, PdfiumUnavailable> {
    if let Some(p) = PDFIUM.get() {
        return Ok(p);
    }
    let path = resolve_pdfium_library_path()
        .ok_or_else(|| PdfiumUnavailable("no candidate library path".into()))?;
    let bindings = Pdfium::bind_to_library(&path)
        .map_err(|e| PdfiumUnavailable(format!("{}: {e}", path.display())))?;
    let pdfium = Pdfium::new(bindings);
    Ok(PDFIUM.get_or_init(|| pdfium))
}
