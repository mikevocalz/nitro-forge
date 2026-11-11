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
//! - Encryption: `encrypt`/`decrypt` drive `lopdf`'s Standard security
//!   handler at V4/R4 (AES-128, `StdCF` crypt filter). lopdf's `load_mem`
//!   auto-decrypts documents whose user *or* owner password is empty, so
//!   `open`/`restore` only ever surface `encrypted: true` for documents that
//!   actually require a password; `decrypt` is the only way to unlock those.
//!   Encrypted documents keep their ciphertext in memory until `decrypt` —
//!   content ops (`pageText`, annotation listing) on them read ciphertext and
//!   are not meaningful. Passwords are capped at 127 UTF-8 bytes; lopdf
//!   truncates the effective key material to 32 bytes per PDF spec.
//! - lopdf 0.36 limitation: `Document::decrypt` derives the file key from the
//!   *user* password even when the supplied password only matches /O, so
//!   `decrypt` (and `open {password}`) rejects owner-only passwords with
//!   `unsupported` up front (detected via `PasswordAlgorithm`) instead of
//!   failing mid-decrypt.
//! - `encrypt` needs a trailer `/ID` for key derivation; documents that lack
//!   one get a random 16-byte ID before encrypting.
//! - Encryption reconciliation (slice F): EVERY mutating op and every op
//!   that decodes strings/streams rejects encrypted documents — objects or
//!   strings added while ciphertext is live would save as plaintext inside
//!   an encrypted file, and ciphertext strings decode to garbage. The only
//!   exceptions are the document-lifecycle ops (`new`, `open`, `encrypt`,
//!   `decrypt`) plus structural reads that never touch string/stream
//!   contents (`pageCount`, `listPageInfo`, `save`, `info`, `describe`).
//!   `open` accepts an optional user `password` that decrypts during load;
//!   snapshots of encrypted documents serialize their ciphertext and
//!   `restore` leaves the document encrypted until `decrypt`.
//! - `insertPageImage` embeds an image XObject and appends a `q cm /Do Q`
//!   content stream — it never rewrites existing content, so inline
//!   `BI`…`EI` images and foreign stream quirks survive untouched. Three
//!   honest input formats: `jpeg` (DCTDecode passthrough — the engine reads
//!   only the SOF header for dimensions, never decodes pixels), `png`
//!   (real decode: 8-bit non-interlaced gray/RGB/gray+alpha/RGBA;
//!   palette, 16-bit and interlaced PNGs reject; alpha is discarded), and
//!   `raw` (unfiltered 8-bpc DeviceRGB/DeviceGray samples). See
//!   `page_image.rs` and ENGINE_OPS.md for the full contract.
//! - Signature listing (`listSignatures`) reports signature-dictionary
//!   contents only — `/ByteRange` is a shape check, never cryptographic
//!   verification (see `signatures.rs`). File attachments
//!   (`listAttachments`/`getAttachment`/`addFileAttachment`) manage the
//!   `/Names`→`/EmbeddedFiles` tree; writes rebuild it as a single
//!   sorted leaf and reject encrypted documents like other structural
//!   ops (see `attachments.rs`).
//! - Page ops (`movePage`/`deletePage`/`duplicatePage`/`insertBlankPage`)
//!   rewrite the page tree flat under the root `/Pages` node after
//!   materializing inheritable page attributes, and collect objects that
//!   become unreachable; `duplicatePage` shares `/Contents`/`/Resources`
//!   but deep-copies annotations. Structural ops reject encrypted
//!   documents (lopdf ciphertext is keyed by object id, so cloned objects
//!   would not decrypt) — see `page_ops.rs` and ENGINE_OPS.md.

mod annotation_edit;
mod attachments;
mod compare;
mod forms;
mod ink_link;
mod markup;
mod comments;
mod outlines;
mod page_image;
mod page_ops;
mod redact;
mod signatures;

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal, TaskContext,
};
use lopdf::content::Content;
use lopdf::dictionary;
use lopdf::encryption::crypt_filters::{Aes128CryptFilter, CryptFilter};
use lopdf::encryption::PasswordAlgorithm;
use lopdf::{Document, EncryptionState, EncryptionVersion, Object, ObjectId, Permissions, Stream};
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

const JOURNAL_CAPACITY: usize = 8;
const LETTER_W: i64 = 612;
const LETTER_H: i64 = 792;
const MAX_PAGES: u64 = 10_000;
/// lopdf revision-4 passwords are PDFDocEncoding strings capped at 127 bytes
/// by the spec; the file key itself only consumes the first 32.
const MAX_PASSWORD_BYTES: usize = 127;

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

/// Raw `/Annots` array items — indirect references and inline dictionaries
/// alike, in page order. Unlike `annot_ids` nothing is filtered out, so a
/// caller that rewrites the array (`duplicatePage`) preserves every entry.
fn annot_entries(doc: &Document, page_id: ObjectId) -> Result<Vec<Object>, EngineError> {
    match annots_loc(doc, page_id)? {
        AnnotsLoc::Missing => Ok(Vec::new()),
        AnnotsLoc::Inline => {
            let page = doc
                .get_object(page_id)
                .and_then(|o| o.as_dict())
                .map_err(ser_err)?;
            Ok(page
                .get(b"Annots")
                .and_then(|o| o.as_array())
                .map_err(ser_err)?
                .clone())
        }
        AnnotsLoc::Ref(r) => Ok(doc
            .get_object(r)
            .and_then(|o| o.as_array())
            .map_err(ser_err)?
            .clone()),
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
// Encryption helpers (lopdf Standard security handler, V4/R4 AES-128).
// ---------------------------------------------------------------------------

/// Non-empty password, capped at [`MAX_PASSWORD_BYTES`] UTF-8 bytes.
fn req_password(p: &Value, k: &str) -> Result<String, EngineError> {
    let s = req_str(p, k)?;
    if s.is_empty() {
        return Err(EngineError::validation(format!("'{k}' must be non-empty")));
    }
    if s.len() > MAX_PASSWORD_BYTES {
        return Err(EngineError::validation(format!(
            "'{k}' must be at most {MAX_PASSWORD_BYTES} bytes"
        )));
    }
    Ok(s.to_string())
}

/// Optional password field: absent/null → `None`, otherwise validated like
/// [`req_password`].
fn opt_password(p: &Value, k: &str) -> Result<Option<String>, EngineError> {
    match p.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => req_password(p, k).map(Some),
    }
}

/// `permissions` is an optional array of permission names; absent/null means
/// all permissions (lopdf's `Permissions::default()`).
fn req_permissions(p: &Value) -> Result<Permissions, EngineError> {
    let Some(v) = p.get("permissions") else {
        return Ok(Permissions::all());
    };
    if v.is_null() {
        return Ok(Permissions::all());
    }
    let arr = v
        .as_array()
        .ok_or_else(|| EngineError::invalid("'permissions' must be an array of permission names"))?;
    let mut perms = Permissions::empty();
    for item in arr {
        let name = item
            .as_str()
            .ok_or_else(|| EngineError::invalid("'permissions' entries must be strings"))?;
        let flag = match name.to_ascii_lowercase().as_str() {
            "print" => Permissions::PRINTABLE,
            "modify" => Permissions::MODIFIABLE,
            "copy" => Permissions::COPYABLE,
            "annotate" => Permissions::ANNOTABLE,
            "fill" => Permissions::FILLABLE,
            "accessibility" | "copyforaccessibility" => Permissions::COPYABLE_FOR_ACCESSIBILITY,
            "assemble" => Permissions::ASSEMBLABLE,
            "printhighquality" => Permissions::PRINTABLE_IN_HIGH_QUALITY,
            other => {
                return Err(EngineError::validation(format!(
                    "unknown permission '{other}' (expected print|modify|copy|annotate|fill|accessibility|assemble|printHighQuality)"
                )))
            }
        };
        perms |= flag;
    }
    Ok(perms)
}

/// lopdf key derivation (revision ≤ 4) requires a trailer `/ID`; documents
/// built by `new` or lacking one get a fresh random 16-byte identifier.
fn ensure_file_id(doc: &mut Document) {
    if doc.trailer.get(b"ID").is_ok() {
        return;
    }
    let mut bytes = [0u8; 16];
    rand::rng().fill(&mut bytes);
    doc.trailer.set(
        "ID",
        Object::Array(vec![
            Object::string_literal(bytes.to_vec()),
            Object::string_literal(bytes.to_vec()),
        ]),
    );
}

/// Map lopdf failures onto typed engine errors. Wrong passwords and
/// encrypt-state violations are recoverable validation failures; anything
/// else is treated like other serialization-level pdf problems.
fn lopdf_err(e: lopdf::Error) -> EngineError {
    match e {
        lopdf::Error::AlreadyEncrypted => {
            EngineError::validation("document is already encrypted")
        }
        lopdf::Error::NotEncrypted => EngineError::validation("document is not encrypted"),
        lopdf::Error::Decryption(d) => dec_err(d),
        other => ser_err(other),
    }
}

fn dec_err(d: lopdf::encryption::DecryptionError) -> EngineError {
    match d {
        lopdf::encryption::DecryptionError::IncorrectPassword => {
            EngineError::validation("incorrect password")
        }
        other => EngineError::validation(format!("pdf decryption failed: {other}")),
    }
}

/// Shared decrypt path for the `decrypt` op and `open {password}`.
/// Authenticates first so a wrong password is a typed Validation and an
/// owner-only password is Unsupported (lopdf 0.36 cannot derive the file
/// key from /O) — both before any mutation, keeping the op atomic.
fn decrypt_doc(doc: &mut Document, password: &str) -> Result<(), EngineError> {
    let algorithm = PasswordAlgorithm::try_from(&*doc).map_err(lopdf_err)?;
    let sanitized = algorithm
        .sanitize_password(password)
        .map_err(dec_err)?;
    if algorithm
        .authenticate_user_password(doc, &sanitized)
        .is_err()
    {
        return if algorithm
            .authenticate_owner_password(doc, &sanitized)
            .is_ok()
        {
            Err(EngineError::unsupported(
                "password matches the owner password only; lopdf cannot derive the file key from an owner password, supply the user password",
            ))
        } else {
            Err(EngineError::validation("incorrect password"))
        };
    }
    doc.decrypt(password).map_err(lopdf_err)
}

/// Uniform encryption gate for content ops: on a ciphertext document,
/// strings/streams written now would serialize as plaintext inside an
/// encrypted file, and string reads return ciphertext. Structural reads
/// that never touch string/stream contents stay allowed.
fn reject_encrypted(doc: &Document, what: &str) -> Result<(), EngineError> {
    if doc.is_encrypted() {
        return Err(EngineError::unsupported(format!(
            "{what} is not supported on encrypted documents; decrypt first"
        )));
    }
    Ok(())
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
            "has_forms": forms::doc_has_forms(&self.doc),
            "signature_count": signatures::signature_count(&self.doc)?,
            "attachment_count": attachments::attachment_count(&self.doc)?,
            "encrypted": self.doc.is_encrypted(),
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
        &["open", "addFileAttachment", "comparePdf", "insertPageImage"]
    }

    /// `save` checks for cancellation before serializing and again before
    /// handing back the bytes. Other ops run to completion once started.
    fn apply_long(&mut self, cmd: Command, ctx: &TaskContext) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, Some(ctx));
        }
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
            return self.apply_batch(cmd, None);
        }
        if cmd.v != 1 {
            return Err(EngineError::unsupported(format!(
                "command version {} is not supported (only v1)",
                cmd.v
            )));
        }
        // Routed before the payload borrow: the op resolves its byte
        // input through `Command::bytes_input`, which needs `&mut cmd`.
        if cmd.op == "addFileAttachment" {
            return self.op_add_file_attachment(&mut cmd);
        }
        if cmd.op == "comparePdf" {
            return self.op_compare_pdf(&mut cmd);
        }
        if cmd.op == "insertPageImage" {
            return self.op_insert_page_image(&mut cmd);
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
                // Optional user password unlocks during load; read before
                // `bytes_input` takes `&mut cmd`.
                let password = opt_password(p, "password")?;
                let bytes = cmd.bytes_input("bytes_b64", b64_decode)?;
                // lopdf auto-decrypts documents whose user or owner password is
                // empty; anything still flagged here genuinely needs `decrypt`
                // (or the `password` field, which runs the same path).
                let mut doc = Document::load_mem(&bytes).map_err(lopdf_err)?;
                if doc.is_encrypted() {
                    if let Some(pw) = &password {
                        // Failure leaves `self` untouched — `doc` is local.
                        decrypt_doc(&mut doc, pw)?;
                    }
                }
                let pages = doc.get_pages().len();
                let encrypted = doc.is_encrypted();
                self.journal.record(self.doc.clone());
                self.doc = doc;
                Ok(CommandResult::data(json!({
                    "pages": pages,
                    "encrypted": encrypted,
                })))
            }
            "encrypt" => {
                if self.doc.is_encrypted() {
                    return Err(EngineError::validation("document is already encrypted"));
                }
                let password = req_password(p, "password")?;
                let owner_password = opt_password(p, "owner_password")?.unwrap_or_else(|| password.clone());
                let permissions = req_permissions(p)?;
                let encrypt_metadata = match p.get("encrypt_metadata") {
                    None | Some(Value::Null) => true,
                    Some(v) => v
                        .as_bool()
                        .ok_or_else(|| EngineError::invalid("'encrypt_metadata' must be a boolean"))?,
                };
                // Work on a clone so a mid-encrypt failure cannot corrupt state.
                let mut doc = self.doc.clone();
                ensure_file_id(&mut doc);
                let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes128CryptFilter);
                let state = EncryptionState::try_from(EncryptionVersion::V4 {
                    document: &doc,
                    encrypt_metadata,
                    crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
                    stream_filter: b"StdCF".to_vec(),
                    string_filter: b"StdCF".to_vec(),
                    owner_password: &owner_password,
                    user_password: &password,
                    permissions,
                })
                .map_err(lopdf_err)?;
                doc.encrypt(&state).map_err(lopdf_err)?;
                self.journal.record(self.doc.clone());
                self.doc = doc;
                Ok(CommandResult::data(json!({ "ok": true, "encrypted": true })))
            }
            "decrypt" => {
                if !self.doc.is_encrypted() {
                    return Err(EngineError::validation("document is not encrypted"));
                }
                let password = req_password(p, "password")?;
                // Authenticate before cloning/mutating so a wrong or
                // owner-only password is a typed, atomic failure.
                let mut doc = self.doc.clone();
                decrypt_doc(&mut doc, &password)?;
                self.journal.record(self.doc.clone());
                self.doc = doc;
                Ok(CommandResult::data(json!({ "ok": true, "encrypted": false })))
            }
            "addAnnotation" => {
                reject_encrypted(&self.doc, "annotation creation")?;
                let page = req_u64(p, "page")?;
                let page_id = self.page_id(page)?;
                let rect = req_rect(p)?;
                let contents = req_str(p, "contents")?;
                if contents.encode_utf16().count() > 32767 {
                    return Err(EngineError::validation("annotation contents exceeds 32767 UTF-16 units"));
                }
                let metadata = if p.get("author").is_some() || p.get("modified").is_some() { Some(comments::metadata(p)?) } else { None };
                let subtype = match p.get("subtype").and_then(Value::as_str) {
                    None => "Text",
                    Some(s) if s.eq_ignore_ascii_case("text") => "Text",
                    Some(s) if s.eq_ignore_ascii_case("highlight") => "Highlight",
                    Some(s) if s.eq_ignore_ascii_case("underline") => "Underline",
                    Some(s) if s.eq_ignore_ascii_case("strikeout") => "StrikeOut",
                    Some(s) if s.eq_ignore_ascii_case("square") => "Square",
                    Some(s) if s.eq_ignore_ascii_case("circle") => "Circle",
                    Some(s) => {
                        return Err(EngineError::validation(format!(
                            "unsupported annotation subtype '{s}' (expected Text|Highlight|Underline|StrikeOut|Square|Circle)"
                        )))
                    }
                };
                let quad = markup::quad(rect, subtype != "Text")?;
                let shape_version = if matches!(subtype, "Square" | "Circle") { Some(markup::shape_version(&self.doc.version)?) } else { None };
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
                let mut annot = dictionary! {
                    "Type" => "Annot",
                    "Subtype" => subtype,
                    "Rect" => Object::Array(pdf_rect),
                    "Contents" => lopdf::text_string(contents),
                };
                if let Some(quad) = quad.filter(|_| matches!(subtype, "Highlight" | "Underline" | "StrikeOut")) { annot.set("QuadPoints", Object::Array(quad)); }
                if let Some((author, modified)) = metadata { annot.set("T", lopdf::text_string(&author)); annot.set("M", lopdf::text_string(&modified)); }
                if let Some(version) = shape_version {
                    self.doc.version = version;
                    annot.set("BS", dictionary! {"Type"=>"Border", "W"=>1, "S"=>"S"});
                    annot.set("C", vec![Object::Integer(0)]);
                    annot.set("IC", Vec::<Object>::new());
                }
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
            "addInkAnnotation" => self.op_add_ink(p),
            "addLinkAnnotation" => self.op_add_link(p),
            "setAnnotationContents" => self.op_set_annotation_contents(p),
            "removeAnnotation" => self.op_remove_comment_tree(p),
            "addAnnotationReply" => self.op_comment_reply(p, false),
            "setAnnotationReview" => self.op_comment_reply(p, true),
            "listCommentThreads" => self.op_list_comment_threads(p),
            "rotatePage" => {
                reject_encrypted(&self.doc, "page rotation")?;
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
            "movePage" => self.op_move_page(p),
            "deletePage" => self.op_delete_page(p),
            "duplicatePage" => self.op_duplicate_page(p),
            "insertBlankPage" => self.op_insert_blank(p),
            "addBookmark" => self.op_add_bookmark(p),
            "removeBookmark" => self.op_remove_bookmark(p),
            "fillFormField" => self.op_fill_form_field(p),
            "redactRect" => self.op_redact_rect(p),
            "comparePdf" => Err(EngineError::unsupported(
                "comparePdf is dispatched before payload binding",
            )),
            "insertPageImage" => Err(EngineError::unsupported(
                "insertPageImage is dispatched before payload binding",
            )),
            "addFileAttachment" => Err(EngineError::unsupported(
                "addFileAttachment is dispatched before payload binding",
            )),
            // --- read-only ---------------------------------------------------
            "pageCount" => Ok(ro(json!({ "pages": self.page_count() }))),
            "pageText" => {
                let page = req_u64(p, "page")?;
                let page_id = self.page_id(page)?;
                let text = extract_page_text(&self.doc, page_id)?;
                Ok(ro(json!({ "text": text })))
            }
            "listAnnotations" => {
                reject_encrypted(&self.doc, "annotation listing")?;
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
                    let mut entry = json!({
                        "id": id.0,
                        "subtype": subtype,
                        "rect": rect,
                        "contents": contents,
                    });
                    // Link annotations: surface the URI action and any
                    // explicit destination when they decode cheaply.
                    if let Ok(action) = dict.get(b"A").and_then(|o| o.as_dict()) {
                        if let Ok(uri) = action
                            .get(b"URI")
                            .and_then(lopdf::decode_text_string)
                        {
                            entry["uri"] = json!(uri);
                        }
                    }
                    if let Ok(dest) = dict.get(b"Dest") {
                        match dest {
                            Object::String(..) => {
                                if let Ok(s) = lopdf::decode_text_string(dest) {
                                    entry["dest"] = json!(s);
                                }
                            }
                            Object::Name(n) => {
                                entry["dest"] =
                                    json!(String::from_utf8_lossy(n).into_owned());
                            }
                            Object::Array(items) => {
                                let nums: Option<Vec<f64>> =
                                    items.iter().map(obj_f64).collect();
                                if let Some(nums) = nums {
                                    entry["dest"] = json!(nums);
                                }
                            }
                            _ => {}
                        }
                    }
                    annots.push(entry);
                }
                Ok(ro(json!({ "annots": annots })))
            }
            "save" => self.op_save(&cmd, None),
            "listPageInfo" => self.op_list_page_info(),
            "listOutlines" => self.op_list_outlines(),
            "listFormFields" => self.op_list_form_fields(),
            "listSignatures" => self.op_list_signatures(),
            "listAttachments" => self.op_list_attachments(),
            "getAttachment" => self.op_get_attachment(&cmd, p),
            "info" => Ok(ro(json!({
                "pages": self.page_count(),
                "has_annots": self.has_annots()?,
                "encrypted": self.doc.is_encrypted(),
            }))),
            "describe" => Ok(ro(self.describe()?)),
            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn apply_batch(
        &mut self,
        cmd: Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let batch = ignition_core::parse_batch(cmd)?;
        let staged = Self { doc: self.doc.clone(), journal: Journal::new(1) };
        let (staged, result) = match ctx {
            Some(ctx) => ignition_core::execute_batch_with_ctx(staged, batch, ctx)?,
            None => ignition_core::execute_batch(staged, batch)?,
        };
        if result.events.iter().any(|event| event.kind == "document:changed") {
            self.journal.record(self.doc.clone());
            self.doc = staged.doc;
        }
        Ok(result)
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
        let doc = Document::load_mem(&bytes).map_err(lopdf_err)?;
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

    // --- encryption ---------------------------------------------------------

    fn new_doc(pages: u64) -> FolioEngine {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": pages }));
        e
    }

    fn saved_b64(e: &mut FolioEngine) -> String {
        apply(e, "save", json!({}))["bytes_b64"].as_str().unwrap().to_string()
    }

    #[test]
    fn encrypt_save_reopen_requires_password() {
        let mut e = new_doc(2);
        let d = apply(&mut e, "encrypt", json!({ "password": "user-secret" }));
        assert_eq!(d["encrypted"], true);
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], true);
        assert_eq!(apply(&mut e, "describe", json!({}))["encrypted"], true);

        // Saved bytes are still a PDF but reopen as encrypted.
        let b64 = saved_b64(&mut e);
        let bytes = b64_decode(&b64).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        let mut e2 = FolioEngine::new();
        let d = apply(&mut e2, "open", json!({ "bytes_b64": b64 }));
        assert_eq!(d["pages"], 2);
        assert_eq!(d["encrypted"], true);
        assert_eq!(apply(&mut e2, "info", json!({}))["encrypted"], true);

        // Wrong password: typed error, document stays encrypted and usable.
        let err = apply_err(&mut e2, "decrypt", json!({ "password": "nope" }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(apply(&mut e2, "info", json!({}))["encrypted"], true);

        // Right password unlocks; the plaintext round-trips.
        let d = apply(&mut e2, "decrypt", json!({ "password": "user-secret" }));
        assert_eq!(d["encrypted"], false);
        assert_eq!(apply(&mut e2, "info", json!({}))["encrypted"], false);
        assert_eq!(apply(&mut e2, "pageCount", json!({}))["pages"], 2);
        let b64 = saved_b64(&mut e2);
        let mut e3 = FolioEngine::new();
        let d = apply(&mut e3, "open", json!({ "bytes_b64": b64 }));
        assert_eq!(d["encrypted"], false);
    }

    #[test]
    fn decrypt_owner_only_password_is_unsupported_not_corrupting() {
        let mut e = new_doc(1);
        apply(
            &mut e,
            "encrypt",
            json!({ "password": "user-pw", "owner_password": "owner-pw" }),
        );
        // lopdf 0.36 cannot derive the file key from an owner password; the
        // op must reject cleanly and leave the document encrypted.
        let err = apply_err(&mut e, "decrypt", json!({ "password": "owner-pw" }));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], true);
        // The user password still unlocks.
        apply(&mut e, "decrypt", json!({ "password": "user-pw" }));
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], false);
    }

    #[test]
    fn encrypt_validates_password_and_state() {
        let mut e = new_doc(1);
        for bad in [
            json!({}),
            json!({ "password": "" }),
            json!({ "password": "x".repeat(MAX_PASSWORD_BYTES + 1) }),
            json!({ "password": "pw", "owner_password": "" }),
            json!({ "password": "pw", "permissions": "all" }),
            json!({ "password": "pw", "permissions": ["print", "bogus"] }),
            json!({ "password": "pw", "encrypt_metadata": "yes" }),
        ] {
            let err = apply_err(&mut e, "encrypt", bad.clone());
            assert!(
                matches!(
                    err.code,
                    ignition_core::ErrorCode::Validation | ignition_core::ErrorCode::InvalidCommand
                ),
                "{bad} -> {err:?}"
            );
        }
        // Nothing was recorded or mutated by the rejected ops.
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], false);
        assert_eq!(e.journal.undo_len(), 1); // only `new`

        apply(&mut e, "encrypt", json!({ "password": "pw" }));
        // Already-encrypted rejects; decrypt on a plain doc rejects too.
        let err = apply_err(&mut e, "encrypt", json!({ "password": "pw2" }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        let mut plain = new_doc(1);
        let err = apply_err(&mut plain, "decrypt", json!({ "password": "pw" }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    #[test]
    fn encrypt_permissions_restrict_trailer_p_value() {
        let mut e = new_doc(1);
        apply(
            &mut e,
            "encrypt",
            json!({ "password": "pw", "permissions": ["print"] }),
        );
        // /P grants bit 2 (print) but clears copy (bit 4), modify (bit 3), etc.
        let enc = e.doc.get_encrypted().expect("encrypt dict");
        let p = enc.get(b"P").unwrap().as_i64().unwrap();
        assert_eq!(p & (1 << 2), 1 << 2, "print bit set: {p:#x}");
        assert_eq!(p & (1 << 3), 0, "modify bit clear: {p:#x}");
        assert_eq!(p & (1 << 4), 0, "copy bit clear: {p:#x}");
        assert_eq!(p & (1 << 5), 0, "annotate bit clear: {p:#x}");

        // Default (no permissions field) grants everything lopdf knows.
        let mut e2 = new_doc(1);
        apply(&mut e2, "encrypt", json!({ "password": "pw" }));
        let enc = e2.doc.get_encrypted().expect("encrypt dict");
        let p = enc.get(b"P").unwrap().as_i64().unwrap();
        assert_eq!(p & (1 << 4), 1 << 4, "copy bit set: {p:#x}");
    }

    #[test]
    fn encrypted_snapshot_round_trips() {
        let mut e = new_doc(1);
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [0, 0, 1, 1], "contents": "secret-note" }),
        );
        apply(&mut e, "encrypt", json!({ "password": "snap-pw" }));
        let snap = e.snapshot().unwrap();

        let mut e2 = FolioEngine::new();
        e2.restore(&snap).unwrap();
        assert_eq!(apply(&mut e2, "info", json!({}))["encrypted"], true);
        apply(&mut e2, "decrypt", json!({ "password": "snap-pw" }));
        let list = apply(&mut e2, "listAnnotations", json!({ "page": 0 }));
        assert_eq!(list["annots"][0]["contents"], "secret-note");
    }

    #[test]
    fn undo_restores_prior_encryption_state() {
        let mut e = new_doc(1);
        apply(&mut e, "encrypt", json!({ "password": "pw" }));
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], true);

        assert!(e.undo().unwrap()); // un-encrypt
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], false);
        // The pre-encryption document still saves as plaintext.
        let b64 = saved_b64(&mut e);
        let mut e2 = FolioEngine::new();
        let d = apply(&mut e2, "open", json!({ "bytes_b64": b64 }));
        assert_eq!(d["encrypted"], false);

        assert!(e.redo().unwrap()); // re-encrypt
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], true);
        apply(&mut e, "decrypt", json!({ "password": "pw" }));
        assert!(e.undo().unwrap()); // un-decrypt
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], true);
    }

    // --- slice F: encryption reconciliation ---------------------------------

    #[test]
    fn open_password_unlocks_during_load() {
        let mut e = new_doc(2);
        apply(&mut e, "encrypt", json!({ "password": "open-pw" }));
        let b64 = saved_b64(&mut e);

        // password field decrypts inside `open` — one step, encrypted:false.
        let mut e2 = FolioEngine::new();
        let d = apply(&mut e2, "open", json!({ "bytes_b64": b64, "password": "open-pw" }));
        assert_eq!(d["pages"], 2);
        assert_eq!(d["encrypted"], false);
        assert_eq!(apply(&mut e2, "info", json!({}))["encrypted"], false);

        // Wrong password: typed Validation, `open` fails atomically — the
        // engine keeps its previous document.
        let mut e3 = FolioEngine::new();
        apply(&mut e3, "new", json!({ "pages": 5 }));
        let err = apply_err(
            &mut e3,
            "open",
            json!({ "bytes_b64": b64, "password": "wrong" }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(apply(&mut e3, "pageCount", json!({}))["pages"], 5);

        // No password still reports encrypted:true (unchanged contract).
        let mut e4 = FolioEngine::new();
        let d = apply(&mut e4, "open", json!({ "bytes_b64": b64 }));
        assert_eq!(d["encrypted"], true);

        // Password on an unencrypted document is ignored.
        let plain = saved_b64(&mut new_doc(1));
        let mut e5 = FolioEngine::new();
        let d = apply(&mut e5, "open", json!({ "bytes_b64": plain, "password": "anything" }));
        assert_eq!(d["encrypted"], false);
        assert_eq!(d["pages"], 1);

        // Owner-only password through `open` hits the same Unsupported
        // classification as `decrypt`.
        let mut e6 = new_doc(1);
        apply(
            &mut e6,
            "encrypt",
            json!({ "password": "user-pw", "owner_password": "owner-pw" }),
        );
        let b64 = saved_b64(&mut e6);
        let mut e7 = FolioEngine::new();
        let err = apply_err(
            &mut e7,
            "open",
            json!({ "bytes_b64": b64, "password": "owner-pw" }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        // And the user password still opens it.
        let mut e8 = FolioEngine::new();
        let d = apply(&mut e8, "open", json!({ "bytes_b64": b64, "password": "user-pw" }));
        assert_eq!(d["encrypted"], false);
    }

    #[test]
    fn mutating_and_string_read_ops_reject_encrypted() {
        let mut e = new_doc(1);
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [0, 0, 1, 1], "contents": "note" }),
        );
        apply(&mut e, "encrypt", json!({ "password": "pw" }));
        let undo_len = e.journal.undo_len();

        // Every mutating op and every string/stream-decoding read rejects.
        let cases: Vec<(&str, Value)> = vec![
            ("addAnnotation", json!({"page":0,"rect":[0,0,1,1],"contents":"x"})),
            ("addInkAnnotation", json!({"page":0,"paths":[[[0,0],[1,1]]]})),
            ("addLinkAnnotation", json!({"page":0,"rect":[0,0,1,1],"uri":"https://example.com"})),
            ("setAnnotationContents", json!({"page":0,"id":1,"contents":"x"})),
            ("removeAnnotation", json!({"page":0,"id":1})),
            ("addAnnotationReply", json!({"page":0,"id":1,"contents":"r","author":"a","modified":"D:20240101000000Z"})),
            ("setAnnotationReview", json!({"page":0,"id":1,"resolved":true,"author":"a","modified":"D:20240101000000Z"})),
            ("rotatePage", json!({"page":0,"degrees":90})),
            ("listAnnotations", json!({"page":0})),
            ("listCommentThreads", json!({"page":0})),
        ];
        for (op, payload) in cases {
            let err = apply_err(&mut e, op, payload);
            assert_eq!(
                err.code,
                ignition_core::ErrorCode::Unsupported,
                "{op} should reject encrypted docs"
            );
        }
        // Structural/content ops gated in earlier slices still hold.
        // (`movePage`/`deletePage` no-op paths stay eventless by design.)
        for (op, payload) in [
            ("duplicatePage", json!({"page":0})),
            ("insertBlankPage", json!({"index":1})),
            ("fillFormField", json!({"page":0,"field":"f","value":"v"})),
            ("redactRect", json!({"page":0,"rect":[0,0,1,1]})),
        ] {
            let err = apply_err(&mut e, op, payload);
            assert_eq!(err.code, ignition_core::ErrorCode::Unsupported, "{op}");
        }
        // Nothing recorded, nothing mutated.
        assert_eq!(e.journal.undo_len(), undo_len);
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], true);

        // Allowed ops still work on the ciphertext document.
        assert!(apply(&mut e, "pageCount", json!({}))["pages"].is_number());
        assert!(apply(&mut e, "listPageInfo", json!({}))["pages"].is_array());
        assert!(apply(&mut e, "save", json!({}))["bytes_b64"].is_string());
        assert!(apply(&mut e, "describe", json!({}))["encrypted"].is_boolean());
    }
}
