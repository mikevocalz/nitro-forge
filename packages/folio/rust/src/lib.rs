//! folio-engine — Nitro-Forge PDF document engine.
//!
//! Wraps a real `lopdf::Document`. Ops are defined in docs/ENGINE_OPS.md
//! (section `folio-engine`). The engine owns the whole PDF in memory: bytes
//! cross the boundary only via `open`/`save`/`snapshot`/`restore`.
//!
//! Notes on intentional limitations:
//! - `pageText` is lossy by design: it concatenates the literal strings of
//!   `Tj`, `TJ`, `'` and `"` text-showing operators in the page's decoded
//!   content stream. It ignores font encodings, positioning, kerning offsets
//!   and marked-content ordering, so it is suitable for search/extraction of
//!   simply-encoded PDFs only.
//! - `listAnnotations` reports `/Rect` in the same `[x, y, w, h]` convention
//!   used by `addAnnotation` (PDF `/Rect` is `[x1, y1, x2, y2]`; the engine
//!   converts on the way out).
//! - Snapshot state is the serialized PDF itself (`save_to` bytes, base64)
//!   inside the standard NFD1 envelope; `restore` re-parses it with
//!   `Document::load_mem` and leaves the engine untouched on any failure.
//! - Undo entries are whole `lopdf::Document` clones (spec: capacity 8).
//! - `new {pages}` is capped at 10_000 pages to keep a malformed command from
//!   allocating unbounded object graphs.

mod annotation_edit;

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal, TaskContext,
};
use lopdf::content::Content;
use lopdf::dictionary;
use lopdf::{Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const JOURNAL_CAPACITY: usize = 8;
const LETTER_W: i64 = 612;
const LETTER_H: i64 = 792;
const MAX_PAGES: u64 = 10_000;

// ---------------------------------------------------------------------------
// base64 — ignition_core::protocol is a private module, so the same codec is
// reproduced here (byte-identical to protocol::base64_encode/decode).
// ---------------------------------------------------------------------------
const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64_ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(B64_ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64_ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn b64_decode(s: &str) -> Result<Vec<u8>, EngineError> {
    let mut table = [255u8; 256];
    for (i, &c) in B64_ALPHABET.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let s = s.trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        let v = table[c as usize];
        if v == 255 {
            return Err(EngineError::serialization("invalid base64 payload"));
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Snapshot state — the whole document serialized as PDF bytes.
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotState {
    pdf_b64: String,
}

/// Build a valid PDF with `n` blank US-Letter pages (catalog → pages → page
/// objects with empty content streams), entirely through the lopdf object
/// model.
fn build_blank_doc(n: u64) -> Document {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let content = Stream::new(dictionary! {}, Vec::new());
        let content_id = doc.add_object(Object::Stream(content));
        let page = dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(LETTER_W),
                Object::Integer(LETTER_H),
            ],
            "Resources" => dictionary! {},
            "Contents" => content_id,
        };
        let page_id = doc.add_object(Object::Dictionary(page));
        kids.push(Object::Reference(page_id));
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => Object::Array(kids),
            "Count" => Object::Integer(n as i64),
        }),
    );
    let catalog_id = doc.add_object(Object::Dictionary(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    }));
    doc.trailer.set("Root", catalog_id);
    doc
}

fn ser_err(e: impl std::fmt::Display) -> EngineError {
    EngineError::serialization(format!("pdf: {e}"))
}

fn obj_f64(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(f) => Some(*f as f64),
        _ => None,
    }
}

fn obj_string(o: &Object) -> Option<String> {
    match o {
        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).into_owned()),
        _ => None,
    }
}

/// Where a page's `/Annots` array lives.
enum AnnotsLoc {
    Missing,
    /// `/Annots` is an inline array inside the page dict.
    Inline,
    /// `/Annots` is an indirect reference to an array object.
    Ref(ObjectId),
}

fn annots_loc(doc: &Document, page_id: ObjectId) -> Result<AnnotsLoc, EngineError> {
    let page = doc
        .get_object(page_id)
        .and_then(|o| o.as_dict())
        .map_err(ser_err)?;
    match page.get(b"Annots") {
        Ok(Object::Reference(r)) => Ok(AnnotsLoc::Ref(*r)),
        Ok(Object::Array(_)) => Ok(AnnotsLoc::Inline),
        _ => Ok(AnnotsLoc::Missing),
    }
}

fn annot_ids(doc: &Document, page_id: ObjectId) -> Result<Vec<ObjectId>, EngineError> {
    match annots_loc(doc, page_id)? {
        AnnotsLoc::Missing => Ok(Vec::new()),
        AnnotsLoc::Inline => {
            let page = doc
                .get_object(page_id)
                .and_then(|o| o.as_dict())
                .map_err(ser_err)?;
            let items = page
                .get(b"Annots")
                .and_then(|o| o.as_array())
                .map_err(ser_err)?;
            Ok(items
                .iter()
                .filter_map(|o| o.as_reference().ok())
                .collect())
        }
        AnnotsLoc::Ref(r) => {
            let items = doc
                .get_object(r)
                .and_then(|o| o.as_array())
                .map_err(ser_err)?;
            Ok(items
                .iter()
                .filter_map(|o| o.as_reference().ok())
                .collect())
        }
    }
}

/// Extract literal strings from `Tj` / `TJ` / `'` / `"` operators in the
/// page's decompressed content stream. Lossy — see module docs.
fn extract_page_text(doc: &Document, page_id: ObjectId) -> Result<String, EngineError> {
    let data = doc.get_page_content(page_id).map_err(ser_err)?;
    let content = Content::decode(&data).map_err(ser_err)?;
    let mut out = String::new();
    for op in &content.operations {
        match op.operator.as_str() {
            "Tj" | "'" => {
                if let Some(s) = op.operands.first().and_then(obj_string) {
                    out.push_str(&s);
                }
            }
            "TJ" => {
                if let Some(Object::Array(items)) = op.operands.first() {
                    for item in items {
                        if let Some(s) = obj_string(item) {
                            out.push_str(&s);
                        }
                    }
                }
            }
            "\"" => {
                if let Some(s) = op.operands.get(2).and_then(obj_string) {
                    out.push_str(&s);
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------
fn field<'a>(p: &'a Value, k: &str) -> Result<&'a Value, EngineError> {
    p.get(k)
        .ok_or_else(|| EngineError::invalid(format!("missing field '{k}'")))
}

fn req_u64(p: &Value, k: &str) -> Result<u64, EngineError> {
    field(p, k)?
        .as_u64()
        .ok_or_else(|| EngineError::invalid(format!("field '{k}' must be a non-negative integer")))
}

fn req_f64(p: &Value, k: &str) -> Result<f64, EngineError> {
    let v = field(p, k)?
        .as_f64()
        .ok_or_else(|| EngineError::invalid(format!("field '{k}' must be a number")))?;
    if !v.is_finite() {
        return Err(EngineError::validation(format!("field '{k}' must be finite")));
    }
    Ok(v)
}

fn req_str<'a>(p: &'a Value, k: &str) -> Result<&'a str, EngineError> {
    field(p, k)?
        .as_str()
        .ok_or_else(|| EngineError::invalid(format!("field '{k}' must be a string")))
}

fn req_rect(p: &Value) -> Result<[f64; 4], EngineError> {
    let arr = field(p, "rect")?
        .as_array()
        .ok_or_else(|| EngineError::invalid("'rect' must be [x, y, w, h]"))?;
    if arr.len() != 4 {
        return Err(EngineError::invalid("'rect' must have exactly 4 elements"));
    }
    let mut out = [0.0; 4];
    for (i, v) in arr.iter().enumerate() {
        let f = v
            .as_f64()
            .ok_or_else(|| EngineError::invalid("'rect' elements must be numbers"))?;
        if !f.is_finite() {
            return Err(EngineError::validation("'rect' elements must be finite"));
        }
        out[i] = f;
    }
    Ok(out)
}

fn ro(data: Value) -> CommandResult {
    CommandResult {
        events: vec![],
        data,
        output: None,
    }
}

// ---------------------------------------------------------------------------
// FolioEngine
// ---------------------------------------------------------------------------
pub struct FolioEngine {
    doc: Document,
    journal: Journal<Document>,
}

impl FolioEngine {
    /// Engine with an empty (zero-page) but structurally valid document.
    pub fn new() -> Self {
        Self {
            doc: build_blank_doc(0),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    fn page_id(&self, page: u64) -> Result<ObjectId, EngineError> {
        let pages = self.doc.get_pages();
        // lopdf page numbers are 1-based; the API is 0-based. Use checked
        // conversion: a huge `page` must be OutOfBounds, not an overflow or
        // a truncated alias of page 0.
        let num = u32::try_from(page).ok().and_then(|p| p.checked_add(1));
        num.and_then(|n| pages.get(&n).copied()).ok_or_else(|| {
            EngineError::out_of_bounds(format!(
                "page {page} out of range (document has {} pages)",
                pages.len()
            ))
        })
    }

    fn page_count(&self) -> usize {
        self.doc.get_pages().len()
    }

    fn serialize_doc(&self) -> Result<Vec<u8>, EngineError> {
        let mut doc = self.doc.clone();
        let mut buf = Vec::new();
        doc.save_to(&mut buf).map_err(ser_err)?;
        Ok(buf)
    }

    fn has_annots(&self) -> Result<bool, EngineError> {
        for (_, pid) in self.doc.get_pages() {
            if !annot_ids(&self.doc, pid)?.is_empty() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn describe(&self) -> Result<Value, EngineError> {
        let mut details = Vec::new();
        for (num, pid) in self.doc.get_pages() {
            let dict = self
                .doc
                .get_object(pid)
                .and_then(|o| o.as_dict())
                .map_err(ser_err)?;
            let rotate = dict
                .get(b"Rotate")
                .ok()
                .and_then(obj_f64)
                .unwrap_or(0.0);
            let annots = annot_ids(&self.doc, pid)?.len();
            details.push(json!({
                "index": num - 1,
                "rotate": rotate,
                "annots": annots,
            }));
        }
        Ok(json!({
            "pages": details.len(),
            "has_annots": details.iter().any(|d| d["annots"].as_u64().unwrap_or(0) > 0),
            "page_details": details,
        }))
    }
}

impl FolioEngine {
    /// `save {}` → `{size}` plus the PDF as `bytes_b64` or binary output.
    /// Read-only. As a task: stage 1 serializes (progress 0.5), stage 2
    /// returns the bytes; cancellation between stages returns nothing.
    fn op_save(&self, cmd: &Command, ctx: Option<&TaskContext>) -> Result<CommandResult, EngineError> {
        let bytes = self.serialize_doc()?;
        if let Some(ctx) = ctx {
            ctx.set_progress(0.5);
            ctx.checkpoint()?;
        }
        Ok(ro(json!({ "size": bytes.len() })).with_bytes(cmd, "bytes_b64", bytes))
    }
}

impl Default for FolioEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for FolioEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Folio
    }

    fn binary_input_ops(&self) -> &'static [&'static str] {
        &["open"]
    }

    /// `save` checks for cancellation before serializing and again before
    /// handing back the bytes. Other ops run to completion once started.
    fn apply_long(&mut self, cmd: Command, ctx: &TaskContext) -> Result<CommandResult, EngineError> {
        ctx.checkpoint()?;
        let result = if cmd.op == "save" && cmd.v == 1 {
            self.op_save(&cmd, Some(ctx))
        } else {
            self.apply(cmd)
        }?;
        ctx.set_progress(1.0);
        Ok(result)
    }

    fn apply(&mut self, mut cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            let batch = ignition_core::parse_batch(cmd)?;
            let staged = Self { doc: self.doc.clone(), journal: Journal::new(1) };
            let (staged, result) = ignition_core::execute_batch(staged, batch)?;
            if result.events.iter().any(|event| event.kind == "document:changed") {
                self.journal.record(self.doc.clone());
                self.doc = staged.doc;
            }
            return Ok(result);
        }
        if cmd.v != 1 {
            return Err(EngineError::unsupported(format!(
                "command version {} is not supported (only v1)",
                cmd.v
            )));
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            // --- mutating ----------------------------------------------------
            "new" => {
                let pages = match p.get("pages") {
                    None | Some(Value::Null) => 1,
                    Some(v) => v.as_u64().ok_or_else(|| {
                        EngineError::invalid("'pages' must be a non-negative integer")
                    })?,
                };
                if pages > MAX_PAGES {
                    return Err(EngineError::validation(format!(
                        "'pages' must be <= {MAX_PAGES}"
                    )));
                }
                self.journal.record(self.doc.clone());
                self.doc = build_blank_doc(pages);
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            "open" => {
                let bytes = cmd.bytes_input("bytes_b64", b64_decode)?;
                let doc = Document::load_mem(&bytes).map_err(ser_err)?;
                let pages = doc.get_pages().len();
                self.journal.record(self.doc.clone());
                self.doc = doc;
                Ok(CommandResult::data(json!({
                    "pages": pages,
                    "encrypted": false,
                })))
            }
            "addAnnotation" => {
                let page = req_u64(p, "page")?;
                let page_id = self.page_id(page)?;
                let rect = req_rect(p)?;
                let contents = req_str(p, "contents")?;
                let subtype = match p.get("subtype").and_then(Value::as_str) {
                    None => "Text",
                    Some(s) if s.eq_ignore_ascii_case("text") => "Text",
                    Some(s) if s.eq_ignore_ascii_case("highlight") => "Highlight",
                    Some(s) => {
                        return Err(EngineError::validation(format!(
                            "unsupported annotation subtype '{s}' (expected Text|Highlight)"
                        )))
                    }
                };
                // PDF /Rect is [x1, y1, x2, y2]; payload is [x, y, w, h].
                let pdf_rect = vec![
                    Object::Real(rect[0] as f32),
                    Object::Real(rect[1] as f32),
                    Object::Real((rect[0] + rect[2]) as f32),
                    Object::Real((rect[1] + rect[3]) as f32),
                ];
                // Resolve and validate the annots destination *before*
                // recording the journal entry or creating the object, so a
                // failure leaves both undo and the document untouched.
                let loc = annots_loc(&self.doc, page_id)?;
                match loc {
                    AnnotsLoc::Inline => {
                        self.doc
                            .get_object(page_id)
                            .and_then(|o| o.as_dict())
                            .map_err(ser_err)?
                            .get(b"Annots")
                            .and_then(|o| o.as_array())
                            .map_err(ser_err)?;
                    }
                    AnnotsLoc::Ref(r) => {
                        self.doc
                            .get_object(r)
                            .and_then(|o| o.as_array())
                            .map_err(ser_err)?;
                    }
                    AnnotsLoc::Missing => {
                        self.doc
                            .get_object(page_id)
                            .and_then(|o| o.as_dict())
                            .map_err(ser_err)?;
                    }
                }
                self.journal.record(self.doc.clone());
                let annot = dictionary! {
                    "Type" => "Annot",
                    "Subtype" => subtype,
                    "Rect" => Object::Array(pdf_rect),
                    "Contents" => lopdf::text_string(contents),
                };
                let annot_id = self.doc.add_object(Object::Dictionary(annot));
                match loc {
                    AnnotsLoc::Inline => {
                        let page_dict = self
                            .doc
                            .get_object_mut(page_id)
                            .and_then(|o| o.as_dict_mut())
                            .map_err(ser_err)?;
                        page_dict
                            .get_mut(b"Annots")
                            .and_then(|o| o.as_array_mut())
                            .map_err(ser_err)?
                            .push(Object::Reference(annot_id));
                    }
                    AnnotsLoc::Ref(r) => {
                        self.doc
                            .get_object_mut(r)
                            .and_then(|o| o.as_array_mut())
                            .map_err(ser_err)?
                            .push(Object::Reference(annot_id));
                    }
                    AnnotsLoc::Missing => {
                        self.doc
                            .get_object_mut(page_id)
                            .and_then(|o| o.as_dict_mut())
                            .map_err(ser_err)?
                            .set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
                    }
                }
                Ok(CommandResult::data(json!({ "annot_id": annot_id.0 })))
            }
            "setAnnotationContents" => self.op_set_annotation_contents(p),
            "removeAnnotation" => {
                let page = req_u64(p, "page")?;
                let page_id = self.page_id(page)?;
                let id = req_u64(p, "id")?;
                let loc = annots_loc(&self.doc, page_id)?;
                // Confirm the annotation exists (read-only) before recording
                // an undo entry — a NotFound must not consume an undo slot.
                let exists = match loc {
                    AnnotsLoc::Inline => self
                        .doc
                        .get_object(page_id)
                        .and_then(|o| o.as_dict())
                        .ok()
                        .and_then(|d| d.get(b"Annots").ok())
                        .and_then(|o| o.as_array().ok())
                        .map(|a| {
                            a.iter().any(|o| {
                                matches!(o, Object::Reference(r) if u64::from(r.0) == id)
                            })
                        })
                        .unwrap_or(false),
                    AnnotsLoc::Ref(r) => self
                        .doc
                        .get_object(r)
                        .and_then(|o| o.as_array())
                        .ok()
                        .map(|a| {
                            a.iter().any(|o| {
                                matches!(o, Object::Reference(r) if u64::from(r.0) == id)
                            })
                        })
                        .unwrap_or(false),
                    AnnotsLoc::Missing => false,
                };
                if !exists {
                    return Err(EngineError::not_found(format!(
                        "no annotation with id {id} on page {page}"
                    )));
                }
                self.journal.record(self.doc.clone());
                let removed = match loc {
                    AnnotsLoc::Inline => {
                        let page_dict = self
                            .doc
                            .get_object_mut(page_id)
                            .and_then(|o| o.as_dict_mut())
                            .map_err(ser_err)?;
                        let arr = page_dict
                            .get_mut(b"Annots")
                            .and_then(|o| o.as_array_mut())
                            .map_err(ser_err)?;
                        match arr.iter().position(|o| {
                            matches!(o, Object::Reference(r) if u64::from(r.0) == id)
                        }) {
                            Some(i) => Some(arr.remove(i)),
                            None => None,
                        }
                    }
                    AnnotsLoc::Ref(r) => {
                        let arr = self
                            .doc
                            .get_object_mut(r)
                            .and_then(|o| o.as_array_mut())
                            .map_err(ser_err)?;
                        match arr.iter().position(|o| {
                            matches!(o, Object::Reference(r) if u64::from(r.0) == id)
                        }) {
                            Some(i) => Some(arr.remove(i)),
                            None => None,
                        }
                    }
                    AnnotsLoc::Missing => None,
                };
                match removed {
                    Some(Object::Reference(annot_id)) => {
                        self.doc.objects.remove(&annot_id);
                        Ok(CommandResult::data(json!({ "ok": true })))
                    }
                    _ => Err(EngineError::not_found(format!(
                        "no annotation with id {id} on page {page}"
                    ))),
                }
            }
            "rotatePage" => {
                let page = req_u64(p, "page")?;
                let page_id = self.page_id(page)?;
                let degrees = req_f64(p, "degrees")?;
                if degrees % 90.0 != 0.0 {
                    return Err(EngineError::validation(
                        "'degrees' must be a multiple of 90",
                    ));
                }
                let norm = ((degrees % 360.0) + 360.0) % 360.0;
                self.journal.record(self.doc.clone());
                self.doc
                    .get_object_mut(page_id)
                    .and_then(|o| o.as_dict_mut())
                    .map_err(ser_err)?
                    .set("Rotate", Object::Integer(norm as i64));
                Ok(CommandResult::data(json!({ "ok": true })))
            }
            // --- read-only ---------------------------------------------------
            "pageCount" => Ok(ro(json!({ "pages": self.page_count() }))),
            "pageText" => {
                let page = req_u64(p, "page")?;
                let page_id = self.page_id(page)?;
                let text = extract_page_text(&self.doc, page_id)?;
                Ok(ro(json!({ "text": text })))
            }
            "listAnnotations" => {
                let page = req_u64(p, "page")?;
                let page_id = self.page_id(page)?;
                let ids = annot_ids(&self.doc, page_id)?;
                let mut annots = Vec::with_capacity(ids.len());
                for id in ids {
                    let dict = match self.doc.get_object(id).and_then(|o| o.as_dict()) {
                        Ok(d) => d,
                        Err(_) => continue, // dangling reference — skip
                    };
                    let subtype = match dict.get(b"Subtype") {
                        Ok(Object::Name(n)) => String::from_utf8_lossy(n).into_owned(),
                        _ => String::new(),
                    };
                    let rect = match dict.get(b"Rect").ok().and_then(|o| o.as_array().ok()) {
                        Some(a) if a.len() == 4 => {
                            let x1 = obj_f64(&a[0]).unwrap_or(0.0);
                            let y1 = obj_f64(&a[1]).unwrap_or(0.0);
                            let x2 = obj_f64(&a[2]).unwrap_or(0.0);
                            let y2 = obj_f64(&a[3]).unwrap_or(0.0);
                            // Report [x, y, w, h] to match the addAnnotation payload.
                            json!([x1, y1, x2 - x1, y2 - y1])
                        }
                        _ => json!(null),
                    };
                    let contents = dict
                        .get(b"Contents")
                        .ok()
                        .and_then(|o| lopdf::decode_text_string(o).ok())
                        .unwrap_or_default();
                    annots.push(json!({
                        "id": id.0,
                        "subtype": subtype,
                        "rect": rect,
                        "contents": contents,
                    }));
                }
                Ok(ro(json!({ "annots": annots })))
            }
            "save" => self.op_save(&cmd, None),
            "info" => Ok(ro(json!({
                "pages": self.page_count(),
                "has_annots": self.has_annots()?,
            }))),
            "describe" => Ok(ro(self.describe()?)),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let state = SnapshotState {
            pdf_b64: b64_encode(&self.serialize_doc()?),
        };
        let payload = serde_json::to_vec(&state)?;
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(data)?;
        let state: SnapshotState = serde_json::from_slice(payload)?;
        let bytes = b64_decode(&state.pdf_b64)?;
        let doc = Document::load_mem(&bytes).map_err(ser_err)?;
        // Only commit after every decode step succeeded.
        self.doc = doc;
        // A replacement document cannot reuse the previous document history.
        self.journal = Journal::new(JOURNAL_CAPACITY);
        Ok(())
    }

    fn undo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_undo() {
            Some(prev) => {
                let current = std::mem::replace(&mut self.doc, prev);
                self.journal.push_redo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn redo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_redo() {
            Some(next) => {
                let current = std::mem::replace(&mut self.doc, next);
                self.journal.push_undo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cmd(op: &str, payload: Value) -> Command {
        Command::new(op, payload)
    }

    fn apply(e: &mut FolioEngine, op: &str, payload: Value) -> Value {
        e.apply(cmd(op, payload)).expect(op).data
    }

    fn apply_err(e: &mut FolioEngine, op: &str, payload: Value) -> EngineError {
        e.apply(cmd(op, payload)).unwrap_err()
    }

    #[test]
    fn new_engine_has_zero_pages() {
        let mut e = FolioEngine::new();
        let d = apply(&mut e, "pageCount", json!({}));
        assert_eq!(d["pages"], 0);
        let d = apply(&mut e, "info", json!({}));
        assert_eq!(d["pages"], 0);
        assert_eq!(d["has_annots"], false);
    }

    #[test]
    fn new_builds_valid_pdf_round_tripping_through_load_mem() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 3 }));
        let saved = apply(&mut e, "save", json!({}));
        let bytes = b64_decode(saved["bytes_b64"].as_str().unwrap()).unwrap();
        assert!(bytes.starts_with(b"%PDF-"), "not a PDF: {:?}", &bytes[..8]);
        let reloaded = Document::load_mem(&bytes).expect("our output must parse");
        assert_eq!(reloaded.get_pages().len(), 3);
        // MediaBox is US Letter.
        let (_, pid) = reloaded.get_pages().into_iter().next().unwrap();
        let dict = reloaded.get_object(pid).unwrap().as_dict().unwrap();
        let media = dict.get(b"MediaBox").unwrap().as_array().unwrap();
        assert_eq!(obj_f64(&media[2]), Some(612.0));
        assert_eq!(obj_f64(&media[3]), Some(792.0));
    }

    #[test]
    fn new_default_pages_and_cap() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({}));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 1);
        let err = apply_err(&mut e, "new", json!({ "pages": MAX_PAGES + 1 }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    #[test]
    fn open_rejects_corrupt_bytes_with_serialization() {
        let mut e = FolioEngine::new();
        for bad in ["not-base64!!!", b64_encode(b"garbage").as_str()] {
            let err = apply_err(&mut e, "open", json!({ "bytes_b64": bad }));
            assert_eq!(err.code, ignition_core::ErrorCode::Serialization, "{bad}");
        }
        // State intact: still a working doc.
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 0);
    }

    #[test]
    fn open_own_save_round_trip() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 2 }));
        let saved = apply(&mut e, "save", json!({}));
        let mut e2 = FolioEngine::new();
        let d = apply(&mut e2, "open", json!({ "bytes_b64": saved["bytes_b64"] }));
        assert_eq!(d["pages"], 2);
        assert_eq!(d["encrypted"], false);
    }

    #[test]
    fn annotations_add_list_remove() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 1 }));
        let d = apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [10.0, 20.0, 100.0, 50.0], "contents": "hello" }),
        );
        let id = d["annot_id"].as_u64().unwrap();
        let d = apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [0.0, 0.0, 5.0, 5.0], "contents": "hl", "subtype": "highlight" }),
        );
        let id2 = d["annot_id"].as_u64().unwrap();
        assert_ne!(id, id2);

        let list = apply(&mut e, "listAnnotations", json!({ "page": 0 }));
        let annots = list["annots"].as_array().unwrap();
        assert_eq!(annots.len(), 2);
        let first = &annots[0];
        assert_eq!(first["id"], id);
        assert_eq!(first["subtype"], "Text");
        assert_eq!(first["contents"], "hello");
        assert_eq!(first["rect"], json!([10.0, 20.0, 100.0, 50.0]));
        assert_eq!(annots[1]["subtype"], "Highlight");

        // Annotations persist through save → load.
        let saved = apply(&mut e, "save", json!({}));
        let bytes = b64_decode(saved["bytes_b64"].as_str().unwrap()).unwrap();
        let reloaded = Document::load_mem(&bytes).unwrap();
        let mut e2 = FolioEngine::new();
        e2.doc = reloaded;
        let list2 = apply(&mut e2, "listAnnotations", json!({ "page": 0 }));
        assert_eq!(list2["annots"].as_array().unwrap().len(), 2);

        apply(&mut e, "removeAnnotation", json!({ "page": 0, "id": id }));
        let list = apply(&mut e, "listAnnotations", json!({ "page": 0 }));
        assert_eq!(list["annots"].as_array().unwrap().len(), 1);
        let err = apply_err(&mut e, "removeAnnotation", json!({ "page": 0, "id": id }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
    }

    #[test]
    fn annotation_validates_page_and_subtype() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 1 }));
        let err = apply_err(
            &mut e,
            "addAnnotation",
            json!({ "page": 9, "rect": [0, 0, 1, 1], "contents": "x" }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        let err = apply_err(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [0, 0, 1, 1], "contents": "x", "subtype": "Squiggly" }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // Failed ops must not record undo / mutate.
        assert_eq!(e.journal.undo_len(), 1); // only `new`
    }

    #[test]
    fn rotate_page_multiples_of_90() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 1 }));
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 450 }));
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["page_details"][0]["rotate"], 90.0);
        let err = apply_err(&mut e, "rotatePage", json!({ "page": 0, "degrees": 45 }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        let err = apply_err(&mut e, "rotatePage", json!({ "page": 4, "degrees": 90 }));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
        // Survives save → load.
        let saved = apply(&mut e, "save", json!({}));
        let mut e2 = FolioEngine::new();
        apply(&mut e2, "open", json!({ "bytes_b64": saved["bytes_b64"] }));
        let d = apply(&mut e2, "describe", json!({}));
        assert_eq!(d["page_details"][0]["rotate"], 90.0);
    }

    #[test]
    fn page_text_extracts_tj_and_array_ops() {
        // Hand-build a one-page doc whose content stream uses Tj and TJ.
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        let content = Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf (Hello) Tj [(Wor) 30 (ld)] TJ (done) ' ET".to_vec(),
        );
        let cid = doc.add_object(Object::Stream(content));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Contents", Object::Reference(cid));
        let mut e = FolioEngine::new();
        e.doc = doc;
        let d = apply(&mut e, "pageText", json!({ "page": 0 }));
        assert_eq!(d["text"], "HelloWorlddone");
    }

    #[test]
    fn page_text_via_saved_pdf() {
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        let content = Stream::new(dictionary! {}, b"(Visible) Tj".to_vec());
        let cid = doc.add_object(Object::Stream(content));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Contents", Object::Reference(cid));
        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        let mut e = FolioEngine::new();
        apply(&mut e, "open", json!({ "bytes_b64": b64_encode(&buf) }));
        let d = apply(&mut e, "pageText", json!({ "page": 0 }));
        assert_eq!(d["text"], "Visible");
    }

    #[test]
    fn undo_redo_chain() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 2 }));
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [0, 0, 1, 1], "contents": "a" }),
        );
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 90 }));

        assert!(e.undo().unwrap()); // un-rotate
        assert_eq!(apply(&mut e, "describe", json!({}))["page_details"][0]["rotate"], 0.0);
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({ "page": 0 }))["annots"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(e.undo().unwrap()); // un-annotate
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({ "page": 0 }))["annots"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert!(e.undo().unwrap()); // un-new → zero-page doc
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 0);
        assert!(!e.undo().unwrap());

        assert!(e.redo().unwrap());
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 2);
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(apply(&mut e, "describe", json!({}))["page_details"][0]["rotate"], 90.0);
        assert!(!e.redo().unwrap());
    }

    #[test]
    fn new_apply_clears_redo() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 1 }));
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 90 }));
        assert!(e.undo().unwrap());
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 180 }));
        assert!(!e.redo().unwrap());
    }

    #[test]
    fn journal_capacity_is_eight() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 1 }));
        for i in 0..10 {
            apply(
                &mut e,
                "addAnnotation",
                json!({ "page": 0, "rect": [i, 0, 1, 1], "contents": format!("a{i}") }),
            );
        }
        assert_eq!(e.journal.undo_len(), JOURNAL_CAPACITY);
        // 8 undos then empty.
        for _ in 0..8 {
            assert!(e.undo().unwrap());
        }
        assert!(!e.undo().unwrap());
        // Oldest two mutations were evicted: first annots remain.
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({ "page": 0 }))["annots"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn snapshot_restore_describe_equality() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 3 }));
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 1, "rect": [1, 2, 3, 4], "contents": "snap", "subtype": "highlight" }),
        );
        apply(&mut e, "rotatePage", json!({ "page": 2, "degrees": 270 }));
        let before = apply(&mut e, "describe", json!({}));
        let snap = e.snapshot().unwrap();

        let mut e2 = FolioEngine::new();
        e2.restore(&snap).unwrap();
        let after = apply(&mut e2, "describe", json!({}));
        assert_eq!(before, after);
        // Continue mutating after restore.
        apply(&mut e2, "rotatePage", json!({ "page": 0, "degrees": 90 }));
        assert_eq!(apply(&mut e2, "pageCount", json!({}))["pages"], 3);
    }

    #[test]
    fn restore_rejects_garbage_and_preserves_state() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 2 }));
        for bad in [
            &b""[..],
            b"XXXX________",
            &encode_envelope(b"{\"pdf_b64\":\"!!!\"}")[..],
        ] {
            assert!(e.restore(bad).is_err());
        }
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 2);
    }

    #[test]
    fn unknown_op_and_version() {
        let mut e = FolioEngine::new();
        let err = apply_err(&mut e, "explode", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
        let err = e
            .apply(Command {
                v: 2,
                op: "new".into(),
                payload: json!({}),
                input: None, binary_output: false,
            })
            .unwrap_err();
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
    }

    #[test]
    fn read_only_ops_record_no_undo() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 1 }));
        let before = e.journal.undo_len();
        apply(&mut e, "pageCount", json!({}));
        apply(&mut e, "pageText", json!({ "page": 0 }));
        apply(&mut e, "listAnnotations", json!({ "page": 0 }));
        apply(&mut e, "save", json!({}));
        apply(&mut e, "info", json!({}));
        apply(&mut e, "describe", json!({}));
        assert_eq!(e.journal.undo_len(), before);
    }
}
