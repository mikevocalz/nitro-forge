//! Structural PDF comparison: `comparePdf {bytes_b64}` (P15 Slice E / F-12).
//!
//! Read-only, eventless. Loads the other PDF with `Document::load_mem`
//! (the same parser `open` uses) and diffs the two documents at the
//! structural level the engine can prove:
//!
//! - **Pages**: count, per-index `mediabox`/`rotate`/`annots_count`/
//!   `has_contents`, the per-page annotation multiset (subtype, rect,
//!   contents MD5 — object ids are never compared), and extracted text.
//! - **Form fields**: the `listFormFields` projection minus the widget
//!   object number (unstable across files).
//! - **Outlines**: the `listOutlines` tree minus item object ids.
//! - **Attachments** and **signature fields**: name/detail multisets.
//!
//! Honesty notes:
//! - `structural_identical` means the compared projections are equal; it
//!   is NOT a byte or semantic proof — unmodeled PDF features (structure
//!   trees, optional content, output intents, page labels, embedded
//!   files' bytes beyond name/size/description, signature cryptographic
//!   validity) are outside the diff.
//! - The annotation multiset signature is deliberately narrow: `/Subtype`
//!   + `/Rect` + MD5 of decoded `/Contents` only. `/T` author, `/C`
//!   color, `/F` flags, `/QuadPoints`, `/IRT` reply links, `/Popup`,
//!   `/M` dates and every other key are ignored — two annotations
//!   differing only in those report as identical.
//! - Signature-field diffs reuse `listSignatures`, whose `/ByteRange`
//!   integers are raw file-position offsets. Byte ranges depend on
//!   serialization layout, so two semantically identical signed PDFs
//!   saved differently can diff conservatively (a false difference is
//!   possible; a missed one is not claimed either way — the offsets are
//!   compared verbatim, never verified against file bytes).
//! - Text comparison is inherently **lossy**: it reuses `pageText`'s
//!   literal-string extraction, which ignores font encodings, positioning
//!   and marked-content ordering. `text.differing_pages` is a hint, not
//!   proof of content change; pages whose streams fail to decode land in
//!   `text.unknown_pages` instead.
//! - Both documents must be unencrypted (`Unsupported` otherwise) — the
//!   same gate every folio structural read applies.
//! - Work is bounded: >10 000 pages, >100 000 annotations or >100 000
//!   objects rejects with Validation rather than scanning unboundedly.
use super::*;
use md5::Digest as _;
use std::collections::BTreeMap;

const MAX_COMPARE_PAGES: usize = 10_000;
const MAX_COMPARE_ANNOTS: usize = 100_000;
const MAX_COMPARE_OBJECTS: usize = 100_000;
const MAX_LISTED: usize = 256;

/// Per-document structural signature.
struct DocSig {
    pages: Vec<PageSig>,
    fields: Vec<Value>,
    outlines: Vec<Value>,
    attachments: Vec<Value>,
    signatures: Vec<Value>,
}

struct PageSig {
    index: usize,
    mediabox: Option<Vec<f64>>,
    rotate: f64,
    annots_count: usize,
    has_contents: bool,
    annots: Vec<Value>,
    text: Option<String>,
}

fn md5_hex(s: &str) -> String {
    let d = md5::Md5::digest(s.as_bytes());
    format!("{d:x}")
}

/// Annotation signature: subtype + `[x,y,w,h]` rect + MD5 of decoded
/// `/Contents`. No object ids — they differ across files.
fn annot_signature(doc: &Document, entry: &Object) -> Value {
    let dict = match entry {
        Object::Reference(id) => match doc.get_object(*id).and_then(Object::as_dict) {
            Ok(d) => d,
            Err(_) => return json!({"unreadable": true}),
        },
        Object::Dictionary(d) => d,
        _ => return json!({"unreadable": true}),
    };
    let subtype = dict
        .get(b"Subtype")
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).into_owned());
    let rect = dict
        .get(b"Rect")
        .ok()
        .and_then(|o| o.as_array().ok())
        .filter(|a| a.len() == 4)
        .and_then(|a| a.iter().map(obj_f64).collect::<Option<Vec<f64>>>().map(|v| {
            json!([v[0], v[1], v[2] - v[0], v[3] - v[1]])
        }));
    let contents = dict
        .get(b"Contents")
        .ok()
        .and_then(|o| lopdf::decode_text_string(o).ok())
        .map(|s| md5_hex(&s));
    json!({
        "subtype": subtype,
        "rect": rect,
        "contents_md5": contents,
    })
}

fn page_signature(doc: &Document, num: u32, pid: ObjectId) -> Result<PageSig, EngineError> {
    let entries = annot_entries(doc, pid)?;
    if entries.len() > MAX_COMPARE_ANNOTS {
        return Err(EngineError::validation("annotation scan limit exceeded"));
    }
    let annots: Vec<Value> = entries.iter().map(|e| annot_signature(doc, e)).collect();
    let mediabox = page_ops::inherited(doc, pid, b"MediaBox")
        .and_then(|o| o.as_array().ok())
        .filter(|a| a.len() == 4)
        .and_then(|a| a.iter().map(obj_f64).collect::<Option<Vec<f64>>>());
    let rotate = page_ops::inherited(doc, pid, b"Rotate")
        .and_then(obj_f64)
        .unwrap_or(0.0);
    let text = extract_page_text(doc, pid).ok();
    Ok(PageSig {
        index: (num - 1) as usize,
        mediabox,
        rotate,
        annots_count: annots.len(),
        // Same ciphertext caveat as listPageInfo: callers only reach here
        // on unencrypted documents, so presence is decidable.
        has_contents: !doc.get_page_content(pid).map_err(ser_err)?.is_empty(),
        annots,
        text,
    })
}

/// Strip unstable object-id fields from op projections so two files can be
/// compared by content.
fn clean_fields(fields: &Value) -> Vec<Value> {
    fields
        .as_array()
        .map(|a| {
            a.iter()
                .map(|f| {
                    let mut o = f.as_object().cloned().unwrap_or_default();
                    o.remove("annot");
                    Value::Object(o)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn clean_signatures(sigs: &Value) -> Vec<Value> {
    sigs
        .as_array()
        .map(|a| {
            a.iter()
                .map(|f| {
                    let mut o = f.as_object().cloned().unwrap_or_default();
                    o.remove("annot");
                    Value::Object(o)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Recursively strip `id` from outline items (object numbers are
/// file-local).
fn clean_outline(item: &Value) -> Value {
    let Some(obj) = item.as_object() else {
        return item.clone();
    };
    let mut out = obj.clone();
    out.remove("id");
    if let Some(children) = out.remove("children") {
        out.insert(
            "children".into(),
            children
                .as_array()
                .map(|a| Value::Array(a.iter().map(clean_outline).collect()))
                .unwrap_or(children),
        );
    }
    Value::Object(out)
}

fn clean_outlines(outlines: &Value) -> Vec<Value> {
    outlines
        .as_array()
        .map(|a| a.iter().map(clean_outline).collect())
        .unwrap_or_default()
}

/// Build the structural signature for `doc`. Reuses the engine's bounded
/// read ops through a scratch engine so caps and encrypted-gates stay
/// identical to the public surface.
fn signature_for(doc: &Document) -> Result<DocSig, EngineError> {
    let page_count = doc.get_pages().len();
    if page_count > MAX_COMPARE_PAGES {
        return Err(EngineError::validation(format!(
            "compare supports at most {MAX_COMPARE_PAGES} pages"
        )));
    }
    if doc.objects.len() > MAX_COMPARE_OBJECTS {
        return Err(EngineError::validation("compare object scan limit exceeded"));
    }
    let scratch = FolioEngine {
        doc: doc.clone(),
        journal: Journal::new(1),
    };
    let fields = clean_fields(&scratch.op_list_form_fields()?.data["fields"]);
    let outlines = clean_outlines(&scratch.op_list_outlines()?.data["outlines"]);
    let attachments = scratch.op_list_attachments()?.data["attachments"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let signatures = clean_signatures(&scratch.op_list_signatures()?.data["signatures"]);
    let mut pages = Vec::with_capacity(page_count);
    let mut annot_total = 0usize;
    for (num, pid) in doc.get_pages() {
        let sig = page_signature(doc, num, pid)?;
        annot_total = annot_total.saturating_add(sig.annots.len());
        if annot_total > MAX_COMPARE_ANNOTS {
            return Err(EngineError::validation("annotation scan limit exceeded"));
        }
        pages.push(sig);
    }
    Ok(DocSig {
        pages,
        fields,
        outlines,
        attachments,
        signatures,
    })
}

// ---------------------------------------------------------------------------
// Multiset diff
// ---------------------------------------------------------------------------

/// Multiset difference by canonical JSON key. `added` = in `other` only,
/// `removed` = in `current` only (diff direction current → other).
fn multiset_diff(current: &[Value], other: &[Value]) -> (Vec<Value>, Vec<Value>, usize, usize) {
    let mut counts: BTreeMap<String, (usize, Vec<Value>)> = BTreeMap::new();
    for v in current {
        let key = serde_json::to_string(v).unwrap_or_default();
        counts.entry(key).or_insert_with(|| (0, vec![v.clone()])).0 += 1;
    }
    let mut added = Vec::new();
    let mut added_total = 0usize;
    let mut removed = Vec::new();
    let mut removed_total = 0usize;
    for v in other {
        let key = serde_json::to_string(v).unwrap_or_default();
        match counts.get_mut(&key) {
            Some((n, _)) if *n > 0 => *n -= 1,
            _ => {
                added_total += 1;
                if added.len() < MAX_LISTED {
                    added.push(v.clone());
                }
            }
        }
    }
    for (_, (n, sample)) in counts {
        if n > 0 {
            removed_total += n;
            if removed.len() < MAX_LISTED {
                removed.push(sample[0].clone());
            }
        }
    }
    (added, removed, added_total, removed_total)
}

fn capped_indices(indices: &[usize]) -> (Vec<usize>, bool) {
    (indices.iter().take(MAX_LISTED).copied().collect(), indices.len() > MAX_LISTED)
}

fn diff_signatures(cur: &DocSig, oth: &DocSig) -> Value {
    let n_cur = cur.pages.len();
    let n_oth = oth.pages.len();
    let shared = n_cur.min(n_oth);
    let mut only_current: Vec<usize> = (shared..n_cur).map(|i| cur.pages[i].index).collect();
    let mut only_other: Vec<usize> = (shared..n_oth).map(|i| oth.pages[i].index).collect();
    only_current.sort_unstable();
    only_other.sort_unstable();

    let mut page_changes = Vec::new();
    let mut differing_text = Vec::new();
    let mut unknown_text = Vec::new();
    for i in 0..shared {
        let a = &cur.pages[i];
        let b = &oth.pages[i];
        let mut fields = Vec::new();
        if a.mediabox != b.mediabox {
            fields.push("mediabox");
        }
        if a.rotate != b.rotate {
            fields.push("rotate");
        }
        if a.annots_count != b.annots_count || a.annots != b.annots {
            fields.push("annotations");
        }
        if a.has_contents != b.has_contents {
            fields.push("has_contents");
        }
        match (&a.text, &b.text) {
            (Some(x), Some(y)) if x != y => differing_text.push(a.index),
            (None, _) | (_, None) => unknown_text.push(a.index),
            _ => {}
        }
        if !fields.is_empty() {
            page_changes.push(json!({ "index": a.index, "fields": fields }));
        }
    }
    // Pages beyond the shared prefix also have un-compared text.
    for i in shared..n_cur.max(n_oth) {
        let sig = if i < n_cur { &cur.pages[i] } else { &oth.pages[i] };
        if sig.text.is_none() {
            unknown_text.push(sig.index);
        }
    }

    let (ann_added, ann_removed, ann_added_n, ann_removed_n) =
        multiset_diff(&cur.pages.iter().flat_map(|p| p.annots.iter().map(|a| {
            let mut o = a.as_object().cloned().unwrap_or_default();
            o.insert("page".into(), json!(p.index));
            Value::Object(o)
        })).collect::<Vec<_>>(),
        &oth.pages.iter().flat_map(|p| p.annots.iter().map(|a| {
            let mut o = a.as_object().cloned().unwrap_or_default();
            o.insert("page".into(), json!(p.index));
            Value::Object(o)
        })).collect::<Vec<_>>());
    let (fld_added, fld_removed, fld_added_n, fld_removed_n) =
        multiset_diff(&cur.fields, &oth.fields);
    let (out_added, out_removed, out_added_n, out_removed_n) =
        multiset_diff(&cur.outlines, &oth.outlines);
    let (att_added, att_removed, att_added_n, att_removed_n) =
        multiset_diff(&cur.attachments, &oth.attachments);
    let (sig_added, sig_removed, sig_added_n, sig_removed_n) =
        multiset_diff(&cur.signatures, &oth.signatures);

    let (oc, oc_trunc) = capped_indices(&only_current);
    let (oo, oo_trunc) = capped_indices(&only_other);
    let page_changes_total = page_changes.len();
    let page_changes: Vec<Value> = page_changes.into_iter().take(MAX_LISTED).collect();
    let (dt, dt_trunc) = capped_indices(&differing_text);
    let (ut, ut_trunc) = capped_indices(&unknown_text);

    let differences_empty = oc.is_empty()
        && oo.is_empty()
        && page_changes.is_empty()
        && ann_added.is_empty()
        && ann_removed.is_empty()
        && fld_added.is_empty()
        && fld_removed.is_empty()
        && out_added.is_empty()
        && out_removed.is_empty()
        && att_added.is_empty()
        && att_removed.is_empty()
        && sig_added.is_empty()
        && sig_removed.is_empty();
    // Multiset totals decide identity even when display lists truncated.
    let structural_identical = n_cur == n_oth
        && differences_empty
        && ann_added_n == 0
        && ann_removed_n == 0
        && fld_added_n == 0
        && fld_removed_n == 0
        && out_added_n == 0
        && out_removed_n == 0
        && att_added_n == 0
        && att_removed_n == 0
        && sig_added_n == 0
        && sig_removed_n == 0;

    json!({
        "pages": { "current": n_cur, "other": n_oth },
        "structural_identical": structural_identical,
        "differences": {
            "only_in_current": oc,
            "only_in_current_total": only_current.len(),
            "only_in_current_truncated": oc_trunc,
            "only_in_other": oo,
            "only_in_other_total": only_other.len(),
            "only_in_other_truncated": oo_trunc,
            "page_changes": page_changes,
            "page_changes_total": page_changes_total,
            "page_changes_truncated": page_changes_total > MAX_LISTED,
            "annotations_added": ann_added,
            "annotations_added_total": ann_added_n,
            "annotations_removed": ann_removed,
            "annotations_removed_total": ann_removed_n,
            "form_fields_added": fld_added,
            "form_fields_added_total": fld_added_n,
            "form_fields_removed": fld_removed,
            "form_fields_removed_total": fld_removed_n,
            "outlines_added": out_added,
            "outlines_added_total": out_added_n,
            "outlines_removed": out_removed,
            "outlines_removed_total": out_removed_n,
            "attachments_added": att_added,
            "attachments_added_total": att_added_n,
            "attachments_removed": att_removed,
            "attachments_removed_total": att_removed_n,
            "signatures_added": sig_added,
            "signatures_added_total": sig_added_n,
            "signatures_removed": sig_removed,
            "signatures_removed_total": sig_removed_n,
        },
        "text": {
            "differing_pages": dt,
            "differing_pages_total": differing_text.len(),
            "differing_pages_truncated": dt_trunc,
            "unknown_pages": ut,
            "unknown_pages_total": unknown_text.len(),
            "unknown_pages_truncated": ut_trunc,
            "note": "lossy pageText extraction (literal strings only, no glyph positions); differing_pages is a hint, not proof",
        },
    })
}

impl FolioEngine {
    /// `comparePdf {bytes_b64 | binary input}` → structural diff of the
    /// current document against another PDF's bytes. Read-only; the other
    /// document is parsed but never installed. See module docs.
    pub(super) fn op_compare_pdf(&mut self, cmd: &mut Command) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "comparePdf is not supported on encrypted documents; decrypt first",
            ));
        }
        let bytes = cmd.bytes_input("bytes_b64", b64_decode)?;
        let other = Document::load_mem(&bytes).map_err(lopdf_err)?;
        if other.is_encrypted() {
            return Err(EngineError::unsupported(
                "comparePdf requires an unencrypted other document",
            ));
        }
        let cur = signature_for(&self.doc)?;
        let oth = signature_for(&other)?;
        Ok(ro(diff_signatures(&cur, &oth)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(e: &mut FolioEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).expect(op).data
    }
    fn apply_err(e: &mut FolioEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }
    fn engine(pages: u64) -> FolioEngine {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": pages }));
        e
    }
    fn saved_b64(e: &mut FolioEngine) -> String {
        apply(e, "save", json!({}))["bytes_b64"].as_str().unwrap().to_string()
    }
    fn doc_bytes(doc: &Document) -> String {
        let scratch = FolioEngine {
            doc: doc.clone(),
            journal: Journal::new(1),
        };
        b64_encode(&scratch.serialize_doc().unwrap())
    }
    fn compare(e: &mut FolioEngine, other_b64: &str) -> Value {
        apply(e, "comparePdf", json!({ "bytes_b64": other_b64 }))
    }
    /// Set (or replace) a page's single content stream with `ops` text.
    fn set_page_text(doc: &mut Document, page_index: usize, text: &str) {
        let pid = doc.get_pages()[&(page_index as u32 + 1)];
        let content = format!("BT /F1 12 Tf 10 700 Td ({text}) Tj ET");
        let cids = doc.get_page_contents(pid);
        if let Some(&cid) = cids.first() {
            doc.get_object_mut(cid)
                .unwrap()
                .as_stream_mut()
                .unwrap()
                .set_content(content.into_bytes());
        }
    }
    /// Add a minimal widget field annotation to a page of `doc`.
    fn add_widget(doc: &mut Document, ft: &str, name: &str, value: &str) {
        let pid = *doc.get_pages().values().next().unwrap();
        let wid = doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => ft,
            "T" => lopdf::text_string(name),
            "V" => lopdf::text_string(value),
            "Rect" => vec![
                Object::Integer(10), Object::Integer(700),
                Object::Integer(110), Object::Integer(720),
            ],
            "P" => pid,
        }));
        let page = doc.get_object_mut(pid).unwrap().as_dict_mut().unwrap();
        if !page.has(b"Annots") {
            page.set("Annots", Object::Array(vec![]));
        }
        page.get_mut(b"Annots")
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(Object::Reference(wid));
    }

    #[test]
    fn compare_identical_documents_are_structurally_identical() {
        let mut e = engine(1);
        let b64 = saved_b64(&mut e);
        let d = compare(&mut e, &b64);
        assert_eq!(d["structural_identical"], true);
        assert_eq!(d["pages"], json!({"current": 1, "other": 1}));
        let diffs = &d["differences"];
        for k in [
            "annotations_added_total", "annotations_removed_total",
            "form_fields_added_total", "form_fields_removed_total",
            "outlines_added_total", "outlines_removed_total",
            "only_in_current_total", "only_in_other_total",
        ] {
            assert_eq!(diffs[k], 0, "{k}");
        }
        assert_eq!(d["text"]["differing_pages_total"], 0);
        assert!(d["text"]["note"].as_str().unwrap().contains("lossy"));
    }

    #[test]
    fn compare_detects_annotation_page_and_outline_changes() {
        let mut cur = engine(1);
        let mut other = engine(2);
        apply(&mut other, "addAnnotation", json!({
            "page": 0, "rect": [10, 10, 20, 20], "contents": "note"
        }));
        apply(&mut other, "addBookmark", json!({ "title": "Chap", "page": 1 }));
        let b64 = saved_b64(&mut other);
        let d = compare(&mut cur, &b64);
        assert_eq!(d["structural_identical"], false);
        assert_eq!(d["differences"]["only_in_other"], json!([1]));
        assert_eq!(d["differences"]["annotations_added_total"], 1);
        assert_eq!(d["differences"]["outlines_added_total"], 1);
        // Reverse direction: current gains nothing, other loses nothing.
        let b64_cur = saved_b64(&mut cur);
        let d2 = compare(&mut other, &b64_cur);
        assert_eq!(d2["differences"]["annotations_removed_total"], 1);
        assert_eq!(d2["differences"]["only_in_current"], json!([1]));
    }

    #[test]
    fn compare_detects_form_field_and_signature_changes() {
        let mut cur = engine(1);
        let mut other_doc = build_blank_doc(1);
        add_widget(&mut other_doc, "Tx", "name", "old");
        add_widget(&mut other_doc, "Sig", "signature", "");
        let b64 = doc_bytes(&other_doc);
        let d = compare(&mut cur, &b64);
        assert_eq!(d["structural_identical"], false);
        let diffs = &d["differences"];
        assert_eq!(diffs["form_fields_added_total"], 2);
        assert_eq!(diffs["signatures_added_total"], 1);
        let added = diffs["form_fields_added"].as_array().unwrap();
        assert!(added.iter().any(|f| f["name"] == "name" && f["v"] == "old"));
        assert!(added.iter().all(|f| f.get("annot").is_none()));
    }

    #[test]
    fn compare_detects_attachment_changes() {
        let mut cur = engine(1);
        let mut other = engine(1);
        other
            .apply(
                Command::new("addFileAttachment", json!({ "name": "a.txt", "data_b64": "aGk=" }))
                    .with_binary(None),
            )
            .unwrap();
        let b64 = saved_b64(&mut other);
        let d = compare(&mut cur, &b64);
        assert_eq!(d["structural_identical"], false);
        assert_eq!(d["differences"]["attachments_added_total"], 1);
    }

    #[test]
    fn compare_text_difference_is_a_lossy_hint_not_identity() {
        // Same structure, different page text: structural_identical stays
        // true while text.differing_pages reports the page.
        let mut cur = engine(1);
        let mut cur_doc = cur.doc.clone();
        set_page_text(&mut cur_doc, 0, "hello");
        cur.doc = cur_doc;
        let mut other_doc = build_blank_doc(1);
        set_page_text(&mut other_doc, 0, "world");
        let b64 = doc_bytes(&other_doc);
        let d = compare(&mut cur, &b64);
        assert_eq!(d["structural_identical"], true, "{d}");
        assert_eq!(d["text"]["differing_pages"], json!([0]));
        assert_eq!(d["text"]["differing_pages_total"], 1);
    }

    #[test]
    fn compare_is_read_only_and_validates_input() {
        let mut e = engine(1);
        let b64 = saved_b64(&mut e);
        let before = e.snapshot().unwrap();
        let undo = e.journal.undo_len();
        // Binary sidecar input works like bytes_b64.
        let raw = b64_decode(&b64).unwrap();
        let r = e
            .apply(Command::new("comparePdf", json!({})).with_binary(Some(raw)))
            .unwrap();
        assert!(r.events.is_empty());
        assert_eq!(r.data["structural_identical"], true);
        assert_eq!(e.journal.undo_len(), undo);
        assert_eq!(e.snapshot().unwrap(), before);
        // Hostile inputs reject without touching state.
        for p in [
            json!({}),
            json!({"bytes_b64": "!!!not-base64!!!"}),
            json!({"bytes_b64": ""}),
        ] {
            assert!(e.apply(Command::new("comparePdf", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Garbage that decodes but is not a PDF.
        let garbage = b64_encode(b"this is not a pdf at all");
        assert!(e
            .apply(Command::new("comparePdf", json!({ "bytes_b64": garbage })))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn compare_rejects_encrypted_documents() {
        let mut e = engine(1);
        let b64 = saved_b64(&mut e);
        apply(&mut e, "encrypt", json!({ "password": "pw" }));
        let err = apply_err(&mut e, "comparePdf", json!({ "bytes_b64": b64 }));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        // An encrypted *other* document rejects too.
        let mut o = engine(1);
        apply(&mut o, "encrypt", json!({ "password": "pw" }));
        let enc_b64 = apply(&mut o, "save", json!({}))["bytes_b64"]
            .as_str()
            .unwrap()
            .to_string();
        let mut plain = engine(1);
        let err = apply_err(&mut plain, "comparePdf", json!({ "bytes_b64": enc_b64 }));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
    }
}
