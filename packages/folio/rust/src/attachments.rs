//! File attachment operations: `listAttachments`, `getAttachment`,
//! `addFileAttachment` (docs/ENGINE_OPS.md §folio-engine, P15 Slice D /
//! F-8).
//!
//! Semantics:
//! - Attachments live in the catalog `/Names`→`/EmbeddedFiles` name tree:
//!   leaf nodes carry flat `/Names [ (key) filespec … ]` arrays, branch
//!   nodes carry `/Kids`. Keys are PDF text strings; values are
//!   `/Filespec` dictionaries (`/F`, `/UF`, `/EF << /F embeddedfile >>`,
//!   optional `/Desc`).
//! - Reads walk the whole tree (both `/Names` pairs and `/Kids`
//!   children, cycle-safe, depth ≤16, ≤256 node visits, ≤4096 pairs)
//!   and preserve every pair verbatim. Non-string keys or ragged
//!   `/Names` arrays reject with Validation — the rebuild used by
//!   `addFileAttachment` must never silently drop entries.
//! - `listAttachments` reports `{name, size, description}` per pair:
//!   `size` is the embedded stream's `/Params` `/Size` (declared
//!   uncompressed length) or `null` when absent — raw `/Length` is
//!   never substituted because it may be a compressed length.
//!   `description` decodes `/Desc` when present.
//! - `getAttachment {name}` resolves the `/Filespec`→`/EF`→`/F` stream,
//!   decodes it (`get_plain_content`, so `/Filter` streams decompress)
//!   and returns the bytes (base64 `bytes_b64`, or binary output when
//!   requested). Decoded payloads are capped at 64 MiB; larger
//!   attachments reject rather than materialize unboundedly.
//! - `addFileAttachment {name, data_b64|binary, description?, page?,
//!   rect?}` appends an `/EmbeddedFile` stream (`/Type /EmbeddedFile`,
//!   `/Params << /Size /CheckSum(MD5) >>`), a `/Filespec` dictionary,
//!   and the name-tree entry. `page`+`rect` additionally create a
//!   `/FileAttachment` annotation on that page (`/FS` → filespec,
//!   `/Rect` from the same positive-nonempty ±1 000 000 rule as other
//!   geometry ops). No appearance stream is generated — viewers render
//!   their default file-attachment icon or nothing.
//! - Name-tree writes rebuild the tree as a single sorted leaf: every
//!   existing pair is re-emitted in ascending key order plus the new
//!   pair, stored in one new leaf dictionary that replaces
//!   `/EmbeddedFiles`. Multi-leaf `/Limits` bookkeeping is not
//!   maintained (single-leaf trees need none); the old nodes become
//!   unreachable and are pruned with `page_ops::prune_unreachable`,
//!   which — like `removeBookmark` — also drops pre-existing orphans.
//!   Names must be unique: a duplicate rejects with Validation.
//! - Bounds: `name` non-empty ≤255 UTF-8 bytes without ASCII control
//!   characters; `description` ≤2048 UTF-16 code units; decoded data
//!   ≤25 MiB; at most 4096 name-tree pairs total.
//! - All three ops reject encrypted documents with Unsupported: name
//!   keys, `/F`, `/UF`, `/Desc` and annot `/Contents` are ciphertext
//!   strings, and a plaintext `/EmbeddedFile` stream written into an
//!   encrypted file would save unencrypted — `decrypt` first.
//! - `addFileAttachment` is mutating: all validation and tree surgery
//!   run on a cloned document, then one journal entry and one
//!   `document:changed`. There is no equal/no-op case — a duplicate
//!   name always rejects, so every accepted add is a real change.
use super::*;
use lopdf::Dictionary;
use std::collections::HashSet;

/// Decoded attachment payload cap for `addFileAttachment` (25 MiB).
const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
/// Decoded extraction cap for `getAttachment` (64 MiB).
const MAX_EXTRACT_BYTES: usize = 64 * 1024 * 1024;
/// Attachment name cap in UTF-8 bytes.
const MAX_NAME_BYTES: usize = 255;
/// `/Desc` cap in UTF-16 code units (same convention as outline titles).
const MAX_DESC_UTF16: usize = 2048;
/// Name-tree pairs `listAttachments` reports and `addFileAttachment`
/// preserves; larger trees reject rather than truncate.
const MAX_ATTACHMENT_ENTRIES: usize = 4096;
/// Recursion cap walking `/Names`→`/EmbeddedFiles` `/Kids`.
const MAX_NAME_TREE_DEPTH: usize = 16;
/// Node-visit cap for the same walk (cycle-safe via visited ids).
const MAX_NAME_TREE_NODES: usize = 256;

/// Resolve an object (reference or inline) to its dictionary.
fn dict_of<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Dictionary> {
    match object {
        Object::Dictionary(dict) => Some(dict),
        Object::Reference(id) => doc.get_object(*id).ok()?.as_dict().ok(),
        _ => None,
    }
}

/// One `/Names` key/value pair, kept as raw objects so the rebuild can
/// re-emit them verbatim.
struct NamePair {
    key: Object,
    value: Object,
}

/// Walk an `/EmbeddedFiles` name-tree node collecting `(key, value)`
/// pairs. Follows `/Names` arrays and `/Kids` children; cycle-safe via
/// visited indirect ids; bounded by depth, node visits and pair count.
fn collect_name_pairs(
    doc: &Document,
    dict: &Dictionary,
    depth: usize,
    seen: &mut HashSet<ObjectId>,
    nodes: &mut usize,
    out: &mut Vec<NamePair>,
) -> Result<(), EngineError> {
    if depth > MAX_NAME_TREE_DEPTH {
        return Err(EngineError::validation("attachment name tree too deep"));
    }
    *nodes += 1;
    if *nodes > MAX_NAME_TREE_NODES {
        return Err(EngineError::validation("attachment name tree too large"));
    }
    if let Some(items) = dict.get(b"Names").ok().and_then(|o| o.as_array().ok()) {
        if items.len() % 2 != 0 {
            return Err(EngineError::validation(
                "attachment name tree has a ragged /Names array",
            ));
        }
        for pair in items.chunks_exact(2) {
            if out.len() >= MAX_ATTACHMENT_ENTRIES {
                return Err(EngineError::validation("attachment limit exceeded"));
            }
            out.push(NamePair {
                key: pair[0].clone(),
                value: pair[1].clone(),
            });
        }
    }
    if let Some(kids) = dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()) {
        for kid in kids {
            if let Some(sub) = dict_of(doc, kid) {
                // Indirect kids are cycle-guarded; inline dicts cannot
                // reference themselves through the object map.
                if let Ok(id) = kid.as_reference() {
                    if !seen.insert(id) {
                        continue;
                    }
                }
                collect_name_pairs(doc, sub, depth + 1, seen, nodes, out)?;
            }
        }
    }
    Ok(())
}

/// All `/EmbeddedFiles` name-tree pairs in the document. Empty when the
/// catalog has no `/Names`→`/EmbeddedFiles` dictionary. Rejects ragged
/// arrays and oversized trees rather than returning partial data.
fn embedded_file_pairs(doc: &Document) -> Result<Vec<NamePair>, EngineError> {
    let mut out = Vec::new();
    let Ok(catalog) = doc.catalog() else {
        return Ok(out);
    };
    let Some(names) = catalog.get(b"Names").ok().and_then(|o| dict_of(doc, o)) else {
        return Ok(out);
    };
    let Some(ef) = names
        .get(b"EmbeddedFiles")
        .ok()
        .and_then(|o| dict_of(doc, o))
    else {
        return Ok(out);
    };
    let mut seen = HashSet::new();
    let mut nodes = 0usize;
    collect_name_pairs(doc, ef, 0, &mut seen, &mut nodes, &mut out)?;
    Ok(out)
}

/// Decode a name-tree key; non-string keys yield `None`.
fn pair_name(pair: &NamePair) -> Option<String> {
    lopdf::decode_text_string(&pair.key).ok()
}

/// Resolve a `/Filespec` object to its embedded-file stream object.
fn filespec_stream<'a>(doc: &'a Document, spec: &'a Object) -> Option<&'a Stream> {
    let spec_dict = dict_of(doc, spec)?;
    let ef = spec_dict.get(b"EF").ok().and_then(|o| dict_of(doc, o))?;
    let f = ef.get(b"F").ok()?;
    match doc.dereference(f).ok()?.1 {
        Object::Stream(stream) => Some(stream),
        _ => None,
    }
}

/// `/Desc` of a filespec dictionary, decoded when present.
fn filespec_description(doc: &Document, spec: &Object) -> Value {
    dict_of(doc, spec)
        .and_then(|d| d.get(b"Desc").ok())
        .and_then(|o| lopdf::decode_text_string(o).ok())
        .map(Value::from)
        .unwrap_or(Value::Null)
}

/// Declared uncompressed size: `/Params` `/Size`, else `null`. The raw
/// stream `/Length` is deliberately not substituted — it may describe
/// filtered (compressed) bytes.
fn stream_declared_size(stream: &Stream) -> Value {
    stream
        .dict
        .get(b"Params")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|p| p.get(b"Size").ok())
        .and_then(|o| o.as_i64().ok())
        .map(|n| json!(n))
        .unwrap_or(Value::Null)
}

/// Structural attachment count for `describe`: pairs are counted
/// without materializing names, still bounded by the same caps.
pub(super) fn attachment_count(doc: &Document) -> Result<usize, EngineError> {
    embedded_file_pairs(doc).map(|v| v.len())
}

/// Validate an attachment `name`: non-empty, ≤255 UTF-8 bytes, no ASCII
/// control characters (they have no place in a file name and only ever
/// appear in hostile payloads).
fn req_attachment_name(p: &Value) -> Result<String, EngineError> {
    let name = req_str(p, "name")?;
    if name.is_empty() {
        return Err(EngineError::validation("'name' must be non-empty"));
    }
    if name.len() > MAX_NAME_BYTES {
        return Err(EngineError::validation(format!(
            "'name' must be at most {MAX_NAME_BYTES} UTF-8 bytes"
        )));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(EngineError::validation(
            "'name' must not contain control characters",
        ));
    }
    Ok(name.to_string())
}

/// Optional `description` → `/Desc` text string, ≤2048 UTF-16 units.
fn opt_description(p: &Value) -> Result<Option<String>, EngineError> {
    match p.get("description") {
        None | Some(Value::Null) => Ok(None),
        Some(_) => {
            let d = req_str(p, "description")?;
            if d.encode_utf16().count() > MAX_DESC_UTF16 {
                return Err(EngineError::validation(format!(
                    "'description' must be at most {MAX_DESC_UTF16} UTF-16 code units"
                )));
            }
            Ok(Some(d.to_string()))
        }
    }
}

impl FolioEngine {
    /// `listAttachments {}` → `{attachments:[{name,size,description}]}`.
    /// Read-only, silent; rejects encrypted documents (keys and `/Desc`
    /// are ciphertext — `decrypt` first).
    pub(super) fn op_list_attachments(&self) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "attachments cannot be listed on encrypted documents; decrypt first",
            ));
        }
        let pairs = embedded_file_pairs(&self.doc)?;
        let mut attachments = Vec::with_capacity(pairs.len());
        for pair in &pairs {
            let name = pair_name(pair).unwrap_or_default();
            let size = filespec_stream(&self.doc, &pair.value)
                .map(stream_declared_size)
                .unwrap_or(Value::Null);
            attachments.push(json!({
                "name": name,
                "size": size,
                "description": filespec_description(&self.doc, &pair.value),
            }));
        }
        Ok(ro(json!({ "attachments": attachments })))
    }

    /// `getAttachment {name}` → `{name, size}` + `bytes_b64` (or binary
    /// output). Read-only; the `/Filespec`→`/EF`→`/F` stream is decoded
    /// (`/Filter` decompression applied) and capped at 64 MiB.
    pub(super) fn op_get_attachment(
        &self,
        cmd: &Command,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "attachments cannot be read on encrypted documents; decrypt first",
            ));
        }
        let name = req_str(p, "name")?;
        let pairs = embedded_file_pairs(&self.doc)?;
        let pair = pairs
            .iter()
            .find(|pair| pair_name(pair).as_deref() == Some(name))
            .ok_or_else(|| EngineError::not_found("attachment not found"))?;
        let stream = filespec_stream(&self.doc, &pair.value)
            .ok_or_else(|| EngineError::not_found("attachment has no embedded file stream"))?;
        let bytes = stream.get_plain_content().map_err(ser_err)?;
        if bytes.len() > MAX_EXTRACT_BYTES {
            return Err(EngineError::validation(format!(
                "attachment exceeds the {MAX_EXTRACT_BYTES} byte extraction limit"
            )));
        }
        Ok(ro(json!({
            "name": name,
            "size": bytes.len(),
        }))
        .with_bytes(cmd, "bytes_b64", bytes))
    }

    /// `addFileAttachment {name, data_b64|binary input, description?,
    /// page?, rect?}` → `{ok, name}`. Mutating; rejects encrypted
    /// documents, duplicate names, oversized payloads and malformed
    /// name trees. `page` requires `rect`; both together add a
    /// `/FileAttachment` annotation.
    pub(super) fn op_add_file_attachment(
        &mut self,
        cmd: &mut Command,
    ) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "attachments cannot be added to encrypted documents; decrypt first",
            ));
        }
        // Binary sidecar or base64 payload — resolved before the payload
        // borrow below so `bytes_input` can take `&mut Command`.
        let data = cmd.bytes_input("data_b64", b64_decode)?;
        if data.len() > MAX_ATTACHMENT_BYTES {
            return Err(EngineError::validation(format!(
                "attachment data must be at most {MAX_ATTACHMENT_BYTES} bytes decoded"
            )));
        }
        let p = &cmd.payload;
        let name = req_attachment_name(p)?;
        let description = opt_description(p)?;
        let page = match p.get("page") {
            None | Some(Value::Null) => None,
            Some(v) => Some(
                v.as_u64()
                    .ok_or_else(|| EngineError::invalid("'page' must be a non-negative integer"))?,
            ),
        };
        let rect = match (page.is_some(), p.get("rect")) {
            (false, None | Some(Value::Null)) => None,
            (true, None | Some(Value::Null)) => {
                return Err(EngineError::invalid(
                    "'rect' is required when 'page' is given",
                ))
            }
            (false, Some(_)) => return Err(EngineError::invalid("'rect' requires 'page'")),
            (true, Some(_)) => Some(markup::checked_rect(req_rect(p)?)?),
        };

        // Validate against the committed document before staging:
        // duplicate names, tree caps and the annotation destination.
        let pairs = embedded_file_pairs(&self.doc)?;
        if pairs.len() >= MAX_ATTACHMENT_ENTRIES {
            return Err(EngineError::validation("attachment limit exceeded"));
        }
        if pairs
            .iter()
            .any(|pair| pair_name(pair).as_deref() == Some(name.as_str()))
        {
            return Err(EngineError::validation(format!(
                "attachment '{name}' already exists"
            )));
        }
        // Non-string keys would be unrepresentable in the sorted rebuild.
        if pairs
            .iter()
            .any(|pair| !matches!(pair.key, Object::String(..)))
        {
            return Err(EngineError::unsupported(
                "embedded-files name tree contains non-string keys",
            ));
        }
        let page_id = match page {
            Some(n) => Some(self.page_id(n)?),
            None => None,
        };

        // --- staged clone: every fallible step runs on `next` ----------
        let mut next = self.doc.clone();

        // EmbeddedFile stream with declared size and MD5 checksum.
        let checksum = md5::compute(&data).0;
        let ef_stream = Stream::new(
            dictionary! {
                "Type" => "EmbeddedFile",
                "Params" => dictionary! {
                    "Size" => data.len() as i64,
                    "CheckSum" => Object::string_literal(checksum.to_vec()),
                },
            },
            data,
        );
        let ef_id = next.add_object(Object::Stream(ef_stream));

        // Filespec dictionary.
        let mut spec = dictionary! {
            "Type" => "Filespec",
            "F" => lopdf::text_string(&name),
            "UF" => lopdf::text_string(&name),
            "EF" => dictionary! { "F" => ef_id },
        };
        if let Some(d) = &description {
            spec.set("Desc", lopdf::text_string(d));
        }
        let spec_id = next.add_object(Object::Dictionary(spec));

        // Rebuild the name tree as one sorted leaf holding every
        // existing pair plus the new one. The key object uses the same
        // text-string encoding as `/F`/`/UF`; sorting compares the raw
        // string bytes, matching how readers order name trees.
        let key_obj = lopdf::text_string(&name);
        let key_bytes = match &key_obj {
            Object::String(bytes, _) => bytes.clone(),
            _ => name.clone().into_bytes(),
        };
        let mut all: Vec<(Vec<u8>, Object, Object)> = pairs
            .into_iter()
            .map(|pair| {
                let key_bytes = match &pair.key {
                    Object::String(bytes, _) => bytes.clone(),
                    _ => Vec::new(), // unreachable: non-string keys rejected
                };
                (key_bytes, pair.key, pair.value)
            })
            .collect();
        all.push((key_bytes, key_obj, Object::Reference(spec_id)));
        all.sort_by(|a, b| a.0.cmp(&b.0));
        let names_array: Vec<Object> = all.into_iter().flat_map(|(_, k, v)| [k, v]).collect();
        let leaf_id = next.add_object(Object::Dictionary(dictionary! {
            "Names" => Object::Array(names_array),
        }));

        // Ensure catalog /Names exists (indirect), then point its
        // /EmbeddedFiles entry at the new leaf. The state is resolved
        // first so no borrow of `next` is live across `add_object`.
        enum NamesState {
            Ref(ObjectId),
            Inline,
            Missing,
        }
        let state = {
            let catalog = next.catalog().map_err(ser_err)?;
            match catalog.get(b"Names") {
                Ok(Object::Reference(id)) => NamesState::Ref(*id),
                Ok(Object::Dictionary(_)) => NamesState::Inline,
                Err(_) => NamesState::Missing,
                Ok(_) => {
                    return Err(EngineError::validation(
                        "catalog /Names is not a dictionary",
                    ))
                }
            }
        };
        let names_id = match state {
            NamesState::Ref(id) => id,
            NamesState::Inline => {
                // Normalize the inline dict to an indirect object so the
                // /EmbeddedFiles slot is mutable via the object map.
                // Semantically identical.
                let inline = next
                    .catalog()
                    .and_then(|c| c.get(b"Names").cloned())
                    .map_err(ser_err)?;
                let id = next.add_object(inline);
                next.catalog_mut()
                    .map_err(ser_err)?
                    .set("Names", Object::Reference(id));
                id
            }
            NamesState::Missing => {
                let id = next.add_object(Object::Dictionary(dictionary! {}));
                next.catalog_mut()
                    .map_err(ser_err)?
                    .set("Names", Object::Reference(id));
                id
            }
        };
        next.get_object_mut(names_id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?
            .set("EmbeddedFiles", Object::Reference(leaf_id));

        // Optional /FileAttachment annotation.
        if let (Some(pid), Some([x1, y1, x2, y2])) = (page_id, rect) {
            let loc = annots_loc(&next, pid)?;
            let mut annot = dictionary! {
                "Type" => "Annot",
                "Subtype" => "FileAttachment",
                "Rect" => Object::Array(vec![
                    Object::Real(x1),
                    Object::Real(y1),
                    Object::Real(x2),
                    Object::Real(y2),
                ]),
                "FS" => Object::Reference(spec_id),
            };
            if let Some(d) = &description {
                annot.set("Contents", lopdf::text_string(d));
            }
            ink_link::attach(&mut next, pid, &loc, annot)?;
        }

        // Old name-tree nodes are now unreachable; prune them (and any
        // pre-existing orphans, same documented sweep as removeBookmark).
        page_ops::prune_unreachable(&mut next);

        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({ "ok": true, "name": name })))
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

    fn engine() -> FolioEngine {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({ "pages": 1 }));
        e
    }

    fn b64(bytes: &[u8]) -> String {
        crate::b64_encode(bytes)
    }

    fn add(e: &mut FolioEngine, name: &str, data: &[u8]) -> Value {
        apply(
            e,
            "addFileAttachment",
            json!({ "name": name, "data_b64": b64(data) }),
        )
    }

    #[test]
    fn add_list_get_round_trip() {
        let mut e = engine();
        let payload = b"hello attachment";
        let d = add(&mut e, "notes.txt", payload);
        assert_eq!(d["ok"], true);
        assert_eq!(d["name"], "notes.txt");

        let list = apply(&mut e, "listAttachments", json!({}));
        let atts = list["attachments"].as_array().unwrap();
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0]["name"], "notes.txt");
        assert_eq!(atts[0]["size"], payload.len() as i64);
        assert_eq!(atts[0]["description"], Value::Null);

        let got = apply(&mut e, "getAttachment", json!({ "name": "notes.txt" }));
        assert_eq!(got["size"], payload.len());
        let bytes = crate::b64_decode(got["bytes_b64"].as_str().unwrap()).unwrap();
        assert_eq!(bytes, payload);
    }

    #[test]
    fn description_and_pushpin_annotation() {
        let mut e = engine();
        let d = apply(
            &mut e,
            "addFileAttachment",
            json!({
                "name": "spec.pdf",
                "data_b64": b64(b"%PDF-fake"),
                "description": "the spec",
                "page": 0,
                "rect": [10.0, 20.0, 30.0, 40.0],
            }),
        );
        assert_eq!(d["ok"], true);
        let list = apply(&mut e, "listAttachments", json!({}));
        assert_eq!(list["attachments"][0]["description"], "the spec");
        let annots = apply(&mut e, "listAnnotations", json!({ "page": 0 }));
        let annot = &annots["annots"][0];
        assert_eq!(annot["subtype"], "FileAttachment");
        assert_eq!(annot["rect"], json!([10.0, 20.0, 30.0, 40.0]));
    }

    #[test]
    fn duplicate_name_rejects_and_preserves_state() {
        let mut e = engine();
        add(&mut e, "a.txt", b"one");
        let before = e.serialize_doc().unwrap();
        let err = apply_err(
            &mut e,
            "addFileAttachment",
            json!({ "name": "a.txt", "data_b64": b64(b"two") }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(e.serialize_doc().unwrap(), before);
        // Different name with same bytes is fine.
        add(&mut e, "b.txt", b"one");
        assert_eq!(
            apply(&mut e, "listAttachments", json!({}))["attachments"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn name_and_payload_validation() {
        let mut e = engine();
        for bad in [
            json!({ "name": "", "data_b64": "" }),
            json!({ "name": "x".repeat(256), "data_b64": "" }),
            json!({ "name": "bad\u{7}name", "data_b64": "" }),
            json!({ "name": "ok.txt" }), // missing data
            json!({ "name": "ok.txt", "data_b64": "!!!not-b64!!!" }),
            json!({ "name": "ok.txt", "data_b64": "", "page": 0 }), // rect required
            json!({ "name": "ok.txt", "data_b64": "", "rect": [0, 0, 1, 1] }), // page required
            json!({ "name": "ok.txt", "data_b64": "", "page": 9, "rect": [0, 0, 1, 1] }), // page oob
            json!({ "name": "ok.txt", "data_b64": "", "page": 0, "rect": [0, 0, -1, 1] }), // bad rect
        ] {
            let err = apply_err(&mut e, "addFileAttachment", bad.clone());
            assert!(
                matches!(
                    err.code,
                    ignition_core::ErrorCode::Validation
                        | ignition_core::ErrorCode::InvalidCommand
                        | ignition_core::ErrorCode::OutOfBounds
                        | ignition_core::ErrorCode::Serialization
                ),
                "{bad} -> {err:?}"
            );
        }
        assert_eq!(
            apply(&mut e, "listAttachments", json!({}))["attachments"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn payload_cap_is_25_mib_decoded() {
        let mut e = engine();
        let too_big = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
        let err = apply_err(
            &mut e,
            "addFileAttachment",
            json!({ "name": "big.bin", "data_b64": b64(&too_big) }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // Exactly at the cap is admitted.
        let exact = vec![7u8; MAX_ATTACHMENT_BYTES];
        apply(
            &mut e,
            "addFileAttachment",
            json!({ "name": "exact.bin", "data_b64": b64(&exact) }),
        );
        let got = apply(&mut e, "getAttachment", json!({ "name": "exact.bin" }));
        assert_eq!(got["size"], MAX_ATTACHMENT_BYTES as u64);
    }

    #[test]
    fn binary_sidecar_input_works() {
        let mut e = engine();
        let cmd = Command::new("addFileAttachment", json!({ "name": "raw.bin" }))
            .with_binary(Some(b"raw-bytes".to_vec()));
        let r = e.apply(cmd).unwrap();
        assert_eq!(r.data["ok"], true);
        let got = apply(&mut e, "getAttachment", json!({ "name": "raw.bin" }));
        assert_eq!(
            crate::b64_decode(got["bytes_b64"].as_str().unwrap()).unwrap(),
            b"raw-bytes"
        );
        // Both sources at once reject.
        let err = e
            .apply(
                Command::new("addFileAttachment", json!({ "name": "x", "data_b64": "" }))
                    .with_binary(Some(vec![1])),
            )
            .unwrap_err();
        assert_eq!(err.code, ignition_core::ErrorCode::InvalidCommand);
    }

    #[test]
    fn encrypted_documents_reject_all_attachment_ops() {
        let mut e = engine();
        add(&mut e, "a.txt", b"data");
        apply(&mut e, "encrypt", json!({ "password": "pw" }));
        for op in ["listAttachments", "getAttachment"] {
            let err = apply_err(&mut e, op, json!({ "name": "a.txt" }));
            assert_eq!(err.code, ignition_core::ErrorCode::Unsupported, "{op}");
        }
        let err = apply_err(
            &mut e,
            "addFileAttachment",
            json!({ "name": "b.txt", "data_b64": "" }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
    }

    #[test]
    fn undo_redo_restores_attachment_state() {
        let mut e = engine();
        add(&mut e, "a.txt", b"one");
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "listAttachments", json!({}))["attachments"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert!(e.redo().unwrap());
        assert_eq!(
            apply(&mut e, "listAttachments", json!({}))["attachments"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn attachments_survive_save_and_reopen() {
        let mut e = engine();
        apply(
            &mut e,
            "addFileAttachment",
            json!({
                "name": "keep me.txt",
                "data_b64": b64(b"persisted"),
                "description": "round trip",
            }),
        );
        let saved = apply(&mut e, "save", json!({}));
        let mut e2 = engine();
        apply(&mut e2, "open", json!({ "bytes_b64": saved["bytes_b64"] }));
        let list = apply(&mut e2, "listAttachments", json!({}));
        let att = &list["attachments"][0];
        assert_eq!(att["name"], "keep me.txt");
        assert_eq!(att["description"], "round trip");
        let got = apply(&mut e2, "getAttachment", json!({ "name": "keep me.txt" }));
        assert_eq!(
            crate::b64_decode(got["bytes_b64"].as_str().unwrap()).unwrap(),
            b"persisted"
        );
    }

    #[test]
    fn second_add_preserves_first_attachment() {
        let mut e = engine();
        add(&mut e, "a.txt", b"aaa");
        add(&mut e, "b.txt", b"bbb");
        let list = apply(&mut e, "listAttachments", json!({}));
        let names: Vec<&str> = list["attachments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["a.txt", "b.txt"]);
        // Sorted order in the tree: a before b regardless of insertion.
        let got_a = apply(&mut e, "getAttachment", json!({ "name": "a.txt" }));
        assert_eq!(got_a["size"], 3);
    }

    /// Document whose `/Names`→`/EmbeddedFiles` tree has a `/Kids` cycle
    /// and a pre-existing multi-level structure.
    fn hostile_tree_doc() -> Document {
        let mut doc = crate::build_blank_doc(1);
        let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        // ef root -> kids -> [kid1 -> kids -> [ef root]] cycle.
        let ef_id = doc.new_object_id();
        let kid_id = doc.new_object_id();
        doc.objects.insert(
            ef_id,
            Object::Dictionary(dictionary! {
                "Kids" => vec![Object::Reference(kid_id)],
            }),
        );
        doc.objects.insert(
            kid_id,
            Object::Dictionary(dictionary! {
                "Kids" => vec![Object::Reference(ef_id)],
                "Names" => vec![
                    lopdf::text_string("old.txt"),
                    Object::Null,
                ],
            }),
        );
        doc.get_object_mut(catalog_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(
                "Names",
                dictionary! {
                    "EmbeddedFiles" => Object::Reference(ef_id),
                },
            );
        doc
    }

    #[test]
    fn cyclic_name_tree_is_bounded_and_lists() {
        let mut e = engine();
        e.doc = hostile_tree_doc();
        // The cycle is cut by the visited set; the one real pair lists.
        let list = apply(&mut e, "listAttachments", json!({}));
        let atts = list["attachments"].as_array().unwrap();
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0]["name"], "old.txt");
        // filespec is Null → no stream → size null, still listed.
        assert_eq!(atts[0]["size"], Value::Null);
        // Adding rebuilds the tree: the cycle is gone afterwards.
        add(&mut e, "new.txt", b"new");
        let list = apply(&mut e, "listAttachments", json!({}));
        assert_eq!(list["attachments"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn non_string_name_tree_key_blocks_add_but_not_list() {
        let mut doc = crate::build_blank_doc(1);
        let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_object_mut(catalog_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(
                "Names",
                dictionary! {
                    "EmbeddedFiles" => dictionary! {
                        "Names" => vec![
                            Object::Name(b"notastring".to_vec()),
                            Object::Null,
                        ],
                    },
                },
            );
        let mut e = engine();
        e.doc = doc;
        let list = apply(&mut e, "listAttachments", json!({}));
        assert_eq!(list["attachments"].as_array().unwrap().len(), 1);
        let err = apply_err(
            &mut e,
            "addFileAttachment",
            json!({ "name": "x.txt", "data_b64": "" }),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
    }

    #[test]
    fn get_attachment_missing_and_specless() {
        let mut e = engine();
        let err = apply_err(&mut e, "getAttachment", json!({ "name": "nope" }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        // Filespec without /EF stream → NotFound, not a crash.
        let catalog_id = e.doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let spec_id = e.doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Filespec",
            "F" => lopdf::text_string("ghost.txt"),
        }));
        e.doc
            .get_object_mut(catalog_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(
                "Names",
                dictionary! {
                    "EmbeddedFiles" => dictionary! {
                        "Names" => vec![
                            lopdf::text_string("ghost.txt"),
                            Object::Reference(spec_id),
                        ],
                    },
                },
            );
        let err = apply_err(&mut e, "getAttachment", json!({ "name": "ghost.txt" }));
        assert_eq!(err.code, ignition_core::ErrorCode::NotFound);
        // ...but it still lists.
        let list = apply(&mut e, "listAttachments", json!({}));
        assert_eq!(list["attachments"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn describe_reports_attachment_count() {
        let mut e = engine();
        add(&mut e, "a.txt", b"1");
        add(&mut e, "b.txt", b"2");
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["attachment_count"], 2);
    }
}
