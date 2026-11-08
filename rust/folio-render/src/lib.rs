//! folio-render — host-side read-only PDF render/text service for Folio.
//!
//! This is **not** an `ignition_core::Engine`: no `EngineKind`, no
//! `Command`/`Journal`, no `NFD1` snapshot. Per
//! `docs/completion/reports/P15-folio-render-admission.md` it is a sibling
//! host service that is fed serialized document bytes (the folio engine's
//! `save`/`open` output) and answers read queries: `open`, `renderPage`,
//! `textPage`, `search`, `pageInfo`. The sole writer remains
//! `folio-engine` (lopdf); pdfium is the Chrome PDF engine behind a
//! run-time-bound shared library.
//!
//! Backend: pdfium via `pdfium-render` 0.9.x (runtime binding, WASM-capable
//! in principle). hayro remains a feature-gated hedge for a later slice —
//! it is deliberately not implemented here.
//!
//! Bounds (fail-closed, mirroring the admission record §5):
//! input PDF ≤ 64 MiB, page count ≤ 4096, render ≤ 4096 px per side and
//! ≤ 32 MiB decoded RGBA, query ≤ 4096 chars, all emitted coordinates
//! finite. Cancellation is per-request only: the JSON-lines host
//! processes one frame at a time, so a host that stops reading gets a
//! wedged worker at worst — there is no mid-render abort in this slice.

pub mod pdfium;

use ignition_core::{base64_decode, base64_encode, EngineError, FrameRequest, FrameResponse};
use pdfium_render::prelude::*;
use serde_json::{json, Value};
use std::collections::HashMap;

// ---- Bounds (P15-folio-render-admission.md §5) ----

/// Maximum accepted PDF input size.
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024; // 64 MiB
/// Maximum page count of an opened document.
pub const MAX_PAGES: usize = 4096;
/// Maximum rendered dimension per side, in pixels.
pub const MAX_RENDER_DIM: u32 = 4096;
/// Maximum decoded RGBA payload of one render, in bytes.
pub const MAX_RENDER_BYTES: usize = 32 * 1024 * 1024; // 32 MiB
/// Maximum search query length, in chars.
pub const MAX_QUERY_CHARS: usize = 4096;
/// Maximum text items returned by one `textPage` call.
pub const MAX_TEXT_ITEMS: usize = 100_000;
/// Maximum search hits returned across all pages of one `search` call.
pub const MAX_SEARCH_HITS: usize = 1024;
/// Maximum links reported by one `pageInfo` call.
pub const MAX_PAGE_LINKS: usize = 1024;
/// Default render scale when neither `scale` nor `dpi` is given (72 dpi = 1.0).
pub const DEFAULT_SCALE: f32 = 1.0;
/// Hard ceiling on caller-requested render scale.
pub const MAX_SCALE: f32 = 16.0;

fn invalid(msg: impl Into<String>) -> EngineError {
    EngineError::invalid(msg)
}

fn out_of_bounds(msg: impl Into<String>) -> EngineError {
    EngineError::out_of_bounds(msg)
}

fn internal(msg: impl Into<String>) -> EngineError {
    EngineError::internal(msg)
}

fn map_pdfium(e: PdfiumError) -> EngineError {
    match e {
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
            EngineError::validation("pdfium rejected the supplied password")
        }
        PdfiumError::PageIndexOutOfBounds
        | PdfiumError::TextSegmentIndexOutOfBounds
        | PdfiumError::CharIndexOutOfBounds => out_of_bounds(e.to_string()),
        PdfiumError::LoadLibraryError(_) => internal(format!("pdfium library load failed: {e}")),
        other => EngineError::validation(format!("pdfium: {other}")),
    }
}

fn map_unavailable(e: pdfium::PdfiumUnavailable) -> EngineError {
    EngineError::unsupported(format!("{e}; set FOLIO_PDFIUM_LIBRARY or FOLIO_PDFIUM_DIR (see rust/folio-render/README.md)"))
}

// ---- Service ----

/// One open document session. `PdfDocument<'static>` borrows the shared
/// process-wide `Pdfium` (a `&'static` from the service's `OnceLock`), so
/// sessions may live as long as needed; each `RenderService` keeps its
/// own handle map.
pub struct RenderDocument {
    doc: PdfDocument<'static>,
    page_count: usize,
}

/// The folio-render service: owns open document sessions and answers the
/// read-only op set. Single-threaded by contract — hosts must not share
/// one `RenderService` across threads without external synchronization.
pub struct RenderService {
    sessions: HashMap<u64, RenderDocument>,
    next_handle: u64,
}

impl RenderService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_handle: 1,
        }
    }

    /// Open PDF bytes for read queries. `password` unlocks encrypted
    /// documents. Returns `{handle, pages, page_sizes, encrypted}`.
    pub fn open(&mut self, bytes: Vec<u8>, password: Option<&str>) -> Result<Value, EngineError> {
        if bytes.len() > MAX_INPUT_BYTES {
            return Err(out_of_bounds(format!(
                "input PDF is {} bytes; limit is {MAX_INPUT_BYTES}",
                bytes.len()
            )));
        }
        if bytes.len() < 5 || !bytes.starts_with(b"%PDF-") {
            return Err(invalid("input is not a PDF (missing %PDF- header)"));
        }
        let pdfium = pdfium::pdfium().map_err(map_unavailable)?;
        let doc = pdfium
            .load_pdf_from_byte_vec(bytes, password)
            .map_err(map_pdfium)?;
        let pages = doc.pages();
        let page_count = pages.len();
        if page_count < 0 || page_count as usize > MAX_PAGES {
            return Err(out_of_bounds(format!(
                "document has {page_count} pages; limit is {MAX_PAGES}"
            )));
        }
        let encrypted = doc
            .permissions()
            .security_handler_revision()
            .map(|r| r != PdfSecurityHandlerRevision::Unprotected)
            .unwrap_or(false);
        let page_sizes = pages
            .page_sizes()
            .map_err(map_pdfium)?
            .iter()
            .map(|r| {
                json!({
                    "width": r.width().value,
                    "height": r.height().value,
                })
            })
            .collect::<Vec<_>>();
        let handle = self.next_handle;
        self.next_handle += 1;
        self.sessions.insert(
            handle,
            RenderDocument {
                doc,
                page_count: page_count as usize,
            },
        );
        Ok(json!({
            "handle": handle,
            "pages": page_count,
            "page_sizes": page_sizes,
            "encrypted": encrypted,
        }))
    }

    fn close(&mut self, handle: u64) -> Value {
        json!({ "closed": self.sessions.remove(&handle).is_some() })
    }

    fn session(&self, handle: u64) -> Result<&RenderDocument, EngineError> {
        self.sessions
            .get(&handle)
            .ok_or_else(|| EngineError::not_found(format!("no open document for handle {handle}")))
    }

    fn page_index(payload: &Value) -> Result<PdfPageIndex, EngineError> {
        let page = payload
            .get("page")
            .and_then(Value::as_i64)
            .ok_or_else(|| invalid("op requires payload.page (0-based index)"))?;
        if page < 0 || page > i32::MAX as i64 {
            return Err(out_of_bounds(format!("page index {page} out of range")));
        }
        Ok(page as PdfPageIndex)
    }

    fn get_page<'a>(doc: &'a RenderDocument, index: PdfPageIndex) -> Result<PdfPage<'a>, EngineError> {
        if index < 0 || index as usize >= doc.page_count {
            return Err(out_of_bounds(format!(
                "page {index} out of range (document has {} pages)",
                doc.page_count
            )));
        }
        doc.doc.pages().get(index).map_err(map_pdfium)
    }

    fn render_page(&self, handle: u64, payload: &Value) -> Result<Value, EngineError> {
        let doc = self.session(handle)?;
        let index = Self::page_index(payload)?;
        let page = Self::get_page(doc, index)?;

        // Scale: explicit `scale`, else `dpi`/72, else DEFAULT_SCALE.
        let mut scale = if let Some(s) = payload.get("scale").and_then(Value::as_f64) {
            if !s.is_finite() || s <= 0.0 {
                return Err(invalid("scale must be a positive finite number"));
            }
            s as f32
        } else if let Some(dpi) = payload.get("dpi").and_then(Value::as_f64) {
            if !dpi.is_finite() || dpi <= 0.0 {
                return Err(invalid("dpi must be a positive finite number"));
            }
            (dpi as f32) / 72.0
        } else {
            DEFAULT_SCALE
        };
        if scale > MAX_SCALE {
            return Err(out_of_bounds(format!(
                "scale {scale} exceeds limit {MAX_SCALE}"
            )));
        }
        if let Some(max_dim) = payload.get("max_dim").and_then(Value::as_u64) {
            if max_dim == 0 || max_dim > MAX_RENDER_DIM as u64 {
                return Err(out_of_bounds(format!(
                    "max_dim {max_dim} outside 1..={MAX_RENDER_DIM}"
                )));
            }
        }
        let format = match payload.get("format").and_then(Value::as_str) {
            None | Some("png") => RenderFormat::Png,
            Some("raw") => RenderFormat::Raw,
            Some(other) => {
                return Err(invalid(format!(
                    "unknown render format '{other}' (expected png|raw)"
                )))
            }
        };

        let w_pt = page.width().value;
        let h_pt = page.height().value;
        if !w_pt.is_finite() || !h_pt.is_finite() || w_pt <= 0.0 || h_pt <= 0.0 {
            return Err(internal("page has non-finite or non-positive size"));
        }
        let max_dim = payload
            .get("max_dim")
            .and_then(Value::as_u64)
            .unwrap_or(MAX_RENDER_DIM as u64) as u32;

        // Clamp scale so both axes fit max_dim and the decoded RGBA
        // payload stays within MAX_RENDER_BYTES.
        let dim_cap = (max_dim as f32).min(MAX_RENDER_DIM as f32);
        scale = scale.min(dim_cap / w_pt.max(h_pt));
        // RGBA is 4 bytes/px: w*h*s^2*4 <= MAX_RENDER_BYTES.
        let pixel_budget_scale = (MAX_RENDER_BYTES as f64 / (4.0 * w_pt as f64 * h_pt as f64)).sqrt();
        if pixel_budget_scale.is_finite() {
            scale = scale.min(pixel_budget_scale as f32);
        }
        if scale <= 0.0 || !scale.is_finite() {
            return Err(out_of_bounds("render scale underflowed to zero"));
        }

        let config = PdfRenderConfig::new()
            .scale_page_by_factor(scale)
            .set_maximum_width(dim_cap as Pixels)
            .set_maximum_height(dim_cap as Pixels)
            .render_annotations(true)
            .render_form_data(true);
        let bitmap = page.render_with_config(&config).map_err(map_pdfium)?;
        let width = bitmap.width();
        let height = bitmap.height();
        let decoded = width as usize * height as usize * 4;
        if width <= 0
            || height <= 0
            || width as u32 > MAX_RENDER_DIM
            || height as u32 > MAX_RENDER_DIM
            || decoded > MAX_RENDER_BYTES
        {
            return Err(out_of_bounds(format!(
                "render produced {width}x{height} ({decoded} bytes decoded); limits are {MAX_RENDER_DIM}px/side, {MAX_RENDER_BYTES} bytes"
            )));
        }
        let rgba = bitmap.as_rgba_bytes();
        if rgba.len() != decoded {
            return Err(internal("pdfium returned an unexpected bitmap size"));
        }
        match format {
            RenderFormat::Raw => Ok(json!({
                "format": "raw",
                "width": width,
                "height": height,
                "stride": width * 4,
                "bytes_b64": base64_encode(&rgba),
            })),
            RenderFormat::Png => {
                let png = encode_png_rgba(&rgba, width as u32, height as u32)
                    .map_err(|e| internal(format!("PNG encode failed: {e}")))?;
                Ok(json!({
                    "format": "png",
                    "width": width,
                    "height": height,
                    "bytes_b64": base64_encode(&png),
                }))
            }
        }
    }

    fn text_page(&self, handle: u64, payload: &Value) -> Result<Value, EngineError> {
        let doc = self.session(handle)?;
        let index = Self::page_index(payload)?;
        let page = Self::get_page(doc, index)?;
        let text = page.text().map_err(map_pdfium)?;
        let segments = text.segments();
        let mut items = Vec::new();
        for seg in segments.iter() {
            if items.len() >= MAX_TEXT_ITEMS {
                return Err(out_of_bounds(format!(
                    "page exceeds {MAX_TEXT_ITEMS} text items"
                )));
            }
            let b = seg.bounds();
            let mut item = json!({
                "text": seg.text(),
                "bbox": [b.left().value, b.bottom().value, b.width().value, b.height().value],
            });
            // Font/size come from the segment's first character; pdfium
            // merges same-line same-font runs into one segment, so the
            // first char's metrics describe the whole item.
            if let Ok(chars) = seg.chars() {
                if let Ok(first) = chars.first() {
                    item["font"] = json!(first.font_name());
                    item["size"] = json!(first.scaled_font_size().value);
                }
            }
            items.push(item);
        }
        Ok(json!({ "items": items }))
    }

    fn search(&self, handle: u64, payload: &Value) -> Result<Value, EngineError> {
        let doc = self.session(handle)?;
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("search requires payload.query"))?;
        if query.chars().count() > MAX_QUERY_CHARS {
            return Err(out_of_bounds(format!(
                "query exceeds {MAX_QUERY_CHARS} chars"
            )));
        }
        if query.trim().is_empty() {
            return Err(invalid("search query is empty"));
        }
        // `pages` is an optional array of 0-based page indices; absent =
        // every page in order.
        let pages: Vec<PdfPageIndex> = match payload.get("pages") {
            None | Some(Value::Null) => (0..doc.page_count as PdfPageIndex).collect(),
            Some(Value::Array(list)) => {
                let mut out = Vec::with_capacity(list.len());
                for v in list {
                    let p = v
                        .as_i64()
                        .ok_or_else(|| invalid("search pages must be an array of integers"))?;
                    if p < 0 || p as usize >= doc.page_count {
                        return Err(out_of_bounds(format!(
                            "search page {p} out of range ({} pages)",
                            doc.page_count
                        )));
                    }
                    out.push(p as PdfPageIndex);
                }
                out
            }
            Some(_) => {
                return Err(invalid("search pages must be an array of integers"));
            }
        };
        let options = PdfSearchOptions::new();
        let mut hits = Vec::new();
        'pages: for index in pages {
            let page = Self::get_page(doc, index)?;
            let text = page.text().map_err(map_pdfium)?;
            let search = text.search(query, &options).map_err(map_pdfium)?;
            for found in search.iter(PdfSearchDirection::SearchForward) {
                if hits.len() >= MAX_SEARCH_HITS {
                    break 'pages;
                }
                // Union the bounds of every segment the match spans.
                let mut bbox: Option<[f32; 4]> = None;
                let mut context = String::new();
                for seg in found.iter() {
                    let b = seg.bounds();
                    let r = [
                        b.left().value,
                        b.bottom().value,
                        b.left().value + b.width().value,
                        b.bottom().value + b.height().value,
                    ];
                    bbox = Some(match bbox {
                        None => r,
                        Some(u) => [
                            u[0].min(r[0]),
                            u[1].min(r[1]),
                            u[2].max(r[2]),
                            u[3].max(r[3]),
                        ],
                    });
                    context.push_str(&seg.text());
                }
                let Some([x0, y0, x1, y1]) = bbox else { continue };
                hits.push(json!({
                    "page": index,
                    "bbox": [x0, y0, x1 - x0, y1 - y0],
                    "context": context,
                }));
            }
        }
        Ok(json!({ "hits": hits, "truncated": hits.len() >= MAX_SEARCH_HITS }))
    }

    fn page_info(&self, handle: u64, payload: &Value) -> Result<Value, EngineError> {
        let doc = self.session(handle)?;
        let index = Self::page_index(payload)?;
        let page = Self::get_page(doc, index)?;
        let rotation = page.rotation().map_err(map_pdfium)?;
        let rotate = match rotation {
            PdfPageRenderRotation::None => 0,
            PdfPageRenderRotation::Degrees90 => 90,
            PdfPageRenderRotation::Degrees180 => 180,
            PdfPageRenderRotation::Degrees270 => 270,
        };
        let size = page.page_size();
        let mut links = Vec::new();
        for link in page.links().iter() {
            if links.len() >= MAX_PAGE_LINKS {
                break;
            }
            let Ok(rect) = link.rect() else { continue };
            let mut entry = json!({
                "rect": [
                    rect.left().value,
                    rect.bottom().value,
                    rect.width().value,
                    rect.height().value,
                ],
            });
            if let Some(action) = link.action() {
                if let Some(uri) = action.as_uri_action() {
                    if let Ok(u) = uri.uri() {
                        entry["uri"] = json!(u);
                    }
                }
            }
            if entry.get("uri").is_none() {
                if let Some(dest) = link.destination() {
                    if let Ok(p) = dest.page_index() {
                        entry["dest"] = json!({ "page": p });
                    }
                }
            }
            links.push(entry);
        }
        Ok(json!({
            "size": { "width": size.width().value, "height": size.height().value },
            "rotate": rotate,
            "links": links,
        }))
    }

    /// Dispatch one protocol frame. `open` carries document bytes in the
    /// payload rather than referencing a handle.
    pub fn handle_frame(&mut self, req: &FrameRequest) -> FrameResponse {
        let id = req.id;
        let result = match req.op.as_str() {
            "open" => self.open_op(req),
            "close" => Ok(self.close(req.handle)),
            "renderPage" => self.render_page(req.handle, &req.payload),
            "textPage" => self.text_page(req.handle, &req.payload),
            "search" => self.search(req.handle, &req.payload),
            "pageInfo" => self.page_info(req.handle, &req.payload),
            "describe" => Ok(json!({
                "service": "folio-render",
                "backend": "pdfium",
                "version": env!("CARGO_PKG_VERSION"),
                "bounds": {
                    "max_input_bytes": MAX_INPUT_BYTES,
                    "max_pages": MAX_PAGES,
                    "max_render_dim": MAX_RENDER_DIM,
                    "max_render_bytes": MAX_RENDER_BYTES,
                    "max_query_chars": MAX_QUERY_CHARS,
                },
            })),
            other => Err(invalid(format!("unknown folio-render op '{other}'"))),
        };
        match result {
            Ok(data) => FrameResponse {
                id,
                ok: true,
                data: Some(data),
                events: vec![],
                error: None,
            },
            Err(e) => FrameResponse {
                id,
                ok: false,
                data: None,
                events: vec![],
                error: Some(e),
            },
        }
    }

    fn open_op(&mut self, req: &FrameRequest) -> Result<Value, EngineError> {
        let b64 = req
            .payload
            .get("bytes_b64")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("open requires payload.bytes_b64"))?;
        let bytes = base64_decode(b64)?;
        let password = req
            .payload
            .get("password")
            .and_then(Value::as_str)
            .map(str::to_string);
        self.open(bytes, password.as_deref())
    }
}

impl Default for RenderService {
    fn default() -> Self {
        Self::new()
    }
}

enum RenderFormat {
    Png,
    Raw,
}

/// PNG-encode RGBA8 pixels. Uses the `image` crate (already a transitive
/// dep of pdfium-render) with only the `png` codec enabled.
fn encode_png_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| "bitmap buffer size mismatch".to_string())?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

/// Run the JSON-lines protocol on stdin/stdout until EOF — same wire
/// shape as `nf-cli` (`{"id","handle","op","payload"}` →
/// `{"id","ok","data"|"error"}`). One frame at a time; pdfium work is
/// synchronous on this thread.
pub fn run_stdio(service: &mut RenderService) -> std::io::Result<()> {
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<FrameRequest>(&line) {
            Ok(req) => {
                let id = req.id;
                match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    service.handle_frame(&req)
                })) {
                    Ok(r) => r,
                    Err(_) => FrameResponse {
                        id,
                        ok: false,
                        data: None,
                        events: vec![],
                        error: Some(EngineError {
                            code: ignition_core::ErrorCode::Internal,
                            message: "folio-render panicked; session closed".into(),
                            recoverable: false,
                        }),
                    },
                }
            }
            Err(e) => FrameResponse {
                id: 0,
                ok: false,
                data: None,
                events: vec![],
                error: Some(EngineError::serialization(e.to_string())),
            },
        };
        writeln!(out, "{}", serde_json::to_string(&resp).unwrap())?;
        out.flush()?;
    }
    Ok(())
}
