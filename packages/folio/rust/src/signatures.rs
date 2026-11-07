//! Signature field inspection: `listSignatures` (docs/ENGINE_OPS.md
//! §folio-engine, P15 Slice D / F-7).
//!
//! Semantics:
//! - Signature fields are `/FT /Sig` form fields. They are collected from
//!   two sources and deduplicated by field dictionary object id:
//!   1. every page's `/Annots` widget entries whose `/Parent`-resolved
//!      `/FT` is `Sig` (the same traversal `listFormFields` uses, so a
//!      field with several widgets reports once, at its first widget in
//!      page order); and
//!   2. the catalog `/AcroForm` `/Fields` tree walked recursively through
//!      `/Kids`, catching signature fields whose widgets never appear on
//!      a page — those report `page: null, annot: null`.
//! - `/V` on a signature field is the signature dictionary. When it
//!   resolves to a dictionary the op reports what is honestly knowable
//!   from the parsed object model: `/ByteRange` (the four integers when
//!   present and integral, plus a shape check), `/SubFilter`, `/Name`
//!   (signer), `/M` (signing time), `/Reason`, `/ContactInfo`,
//!   `/Location` and `/Type` (e.g. `DocTimeStamp`). `signed` is true only
//!   when `/V` resolves to a dictionary; an absent or non-dictionary
//!   `/V` reports `signed: false` and null detail fields.
//! - HONESTY BOUNDARY: there is no cryptographic verification. lopdf
//!   parses objects, not CMS/PKCS#7, and `/ByteRange` offsets refer to
//!   byte positions in the serialized file — the engine never rewrites
//!   the file, but it also cannot confirm the covered bytes still match
//!   what was signed (any later edit invalidates the signature without
//!   changing the dictionary). `byte_range_well_formed` only checks the
//!   array's shape: four non-negative integers with the second pair
//!   starting at or after the end of the first. Byte ranges are never
//!   validated against file bytes.
//! - `listSignatures` rejects encrypted documents with Unsupported:
//!   `/T`, `/Name`, `/M`, `/Reason` and friends are ciphertext strings
//!   under lopdf's in-place encryption and would decode to garbage —
//!   `decrypt` first. `describe`'s `signature_count` is a structural
//!   count only and stays meaningful on encrypted documents because
//!   `/FT` is a name object (names are never encrypted).
//! - Bounds: at most 10 000 signature entries, `/Parent` chains capped
//!   at 64 links (inherited from the forms walker), the `/Fields` walk
//!   is cycle-safe with a 4096-node visit cap and depth 32. Traversal
//!   is read-only, silent, and fails closed rather than returning a
//!   partial list.
use super::*;
use forms::{ChainNode, WidgetEntry};
use std::collections::{HashMap, HashSet};

/// Maximum signature entries `listSignatures` reports.
const MAX_SIGNATURES: usize = 10_000;
/// Maximum `/AcroForm` `/Fields` objects visited by the catalog pass.
const MAX_FIELD_NODES: usize = 4096;
/// Maximum `/Kids` recursion depth in the `/Fields` walk.
const MAX_FIELDS_DEPTH: usize = 32;

/// One deduplicated signature field.
struct SigEntry {
    /// Field dictionary object id used for dedupe; `None` for inline
    /// dictionaries, which are always reported (they cannot be shared
    /// between the widget and catalog passes anyway).
    key: Option<ObjectId>,
    /// Flattened `/T` name (root→leaf, `.`-joined).
    name: String,
    /// 0-based page of the first widget found, when any.
    page: Option<u32>,
    /// `/Annots` object number of that widget, when indirect.
    annot: Option<u64>,
    /// Widget dict first, then `/Parent` ancestors — used for `/V` lookup.
    chain: Vec<ChainNode>,
}

/// Dedupe key for one collected signature field: the field-identity
/// node's object id when indirect, else the chain root's id.
fn entry_key(chain: &[ChainNode]) -> Option<ObjectId> {
    forms::field_node_index(chain)
        .and_then(|i| chain[i].id)
        .or_else(|| chain.first().and_then(|n| n.id))
}

/// Insert `entry` into `entries`, skipping when `key` was already
/// reported. Keyless (inline) entries always append.
fn push_entry(entries: &mut Vec<SigEntry>, keyed: &mut HashMap<ObjectId, ()>, entry: SigEntry) {
    if let Some(k) = entry.key {
        if keyed.insert(k, ()).is_some() {
            return;
        }
    }
    entries.push(entry);
}

/// Catalog pass: walk `/AcroForm` `/Fields` (and `/Kids` recursively) for
/// signature fields not already found through page widgets.
fn catalog_signature_entries(
    doc: &Document,
    entries: &mut Vec<SigEntry>,
    keyed: &mut HashMap<ObjectId, ()>,
) -> Result<(), EngineError> {
    let Ok(catalog) = doc.catalog() else {
        return Ok(());
    };
    let Ok(af) = catalog.get_deref(b"AcroForm", doc) else {
        return Ok(());
    };
    let Ok(fields) = af
        .as_dict()
        .and_then(|d| d.get_deref(b"Fields", doc))
        .and_then(|o| o.as_array())
    else {
        return Ok(());
    };
    let mut stack: Vec<(Object, usize)> = fields.iter().cloned().map(|o| (o, 0)).collect();
    let mut seen: HashSet<ObjectId> = HashSet::new();
    let mut visited = 0usize;
    while let Some((object, depth)) = stack.pop() {
        visited += 1;
        if visited > MAX_FIELD_NODES {
            return Err(EngineError::validation("form field hierarchy too large"));
        }
        if depth > MAX_FIELDS_DEPTH {
            return Err(EngineError::validation("form field hierarchy too deep"));
        }
        // Cycle guard on indirect objects; inline dictionaries cannot
        // cycle back to themselves through the object map.
        if let Ok(id) = object.as_reference() {
            if !seen.insert(id) {
                continue;
            }
        }
        let Ok(chain) = forms::widget_chain(doc, &object) else {
            continue; // non-dictionary field entry — skip
        };
        // /Kids must be collected before `chain` moves into the entry.
        let kids: Vec<Object> = chain
            .first()
            .and_then(|n| n.dict.get_deref(b"Kids", doc).ok())
            .and_then(|o| o.as_array().ok())
            .map(|a| a.clone())
            .unwrap_or_default();
        if forms::field_type(doc, &chain).as_deref() == Some("Sig") {
            if entries.len() >= MAX_SIGNATURES {
                return Err(EngineError::validation("signature field limit exceeded"));
            }
            push_entry(
                entries,
                keyed,
                SigEntry {
                    key: entry_key(&chain),
                    name: forms::flattened_name(doc, &chain),
                    page: None,
                    annot: None,
                    chain,
                },
            );
        }
        // Recurse into /Kids of the resolved dictionary (chain root is
        // the field/widget dict itself). Widget annots resolve back to
        // the same field key and dedupe away.
        for kid in kids.into_iter().rev() {
            stack.push((kid, depth + 1));
        }
    }
    Ok(())
}

/// Collect every signature field: page widgets first (page order), then
/// catalog `/Fields` entries not already covered.
fn collect_signatures(doc: &Document) -> Result<Vec<SigEntry>, EngineError> {
    let mut entries = Vec::new();
    let mut keyed = HashMap::new();
    for (num, page_id) in doc.get_pages() {
        for entry in forms::page_widget_entries(doc, page_id)? {
            let WidgetEntry { annot_id, chain } = entry;
            if forms::field_type(doc, &chain).as_deref() != Some("Sig") {
                continue;
            }
            if entries.len() >= MAX_SIGNATURES {
                return Err(EngineError::validation("signature field limit exceeded"));
            }
            push_entry(
                &mut entries,
                &mut keyed,
                SigEntry {
                    key: entry_key(&chain),
                    name: forms::flattened_name(doc, &chain),
                    page: Some(num - 1),
                    annot: annot_id,
                    chain,
                },
            );
        }
    }
    catalog_signature_entries(doc, &mut entries, &mut keyed)?;
    Ok(entries)
}

/// Decode a signature-dictionary string entry (`/Name`, `/M`, `/Reason`,
/// `/ContactInfo`, `/Location`). Missing or undecodable → null.
fn sig_text(dict: &lopdf::Dictionary, key: &[u8]) -> Value {
    dict.get(key)
        .ok()
        .and_then(|o| lopdf::decode_text_string(o).ok())
        .map(Value::from)
        .unwrap_or(Value::Null)
}

/// `/ByteRange` reporting: the four integers when the array holds only
/// integers (sign included — malformed values still report), `null`
/// otherwise. `well_formed` additionally requires exactly four
/// non-negative integers whose second pair starts at or after the end
/// of the first — a shape check only, never a byte-level verification.
fn byte_range(dict: &lopdf::Dictionary) -> (Value, bool) {
    let Some(items) = dict.get(b"ByteRange").ok().and_then(|o| o.as_array().ok()) else {
        return (Value::Null, false);
    };
    let nums: Option<Vec<i64>> = items.iter().map(|o| o.as_i64().ok()).collect();
    let Some(nums) = nums else {
        return (Value::Null, false);
    };
    let well_formed = nums.len() == 4
        && nums.iter().all(|n| *n >= 0)
        && (nums[0] as i128 + nums[1] as i128) <= nums[2] as i128;
    (json!(nums), well_formed)
}

/// Signature name object (`/SubFilter`, `/Type`) as a lossy string.
fn sig_name(dict: &lopdf::Dictionary, key: &[u8]) -> Value {
    dict.get(key)
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|n| json!(String::from_utf8_lossy(n)))
        .unwrap_or(Value::Null)
}

/// One `listSignatures` row.
fn signature_json(doc: &Document, entry: &SigEntry) -> Value {
    let name = entry.name.as_str();
    let page = entry.page;
    let annot = entry.annot;
    // `/V` resolves leaf→root like every inheritable field attribute.
    let unsigned = || {
        json!({
            "name": name,
            "page": page,
            "annot": annot,
            "signed": false,
            "byte_range": Value::Null,
            "byte_range_well_formed": false,
            "sub_filter": Value::Null,
            "signer": Value::Null,
            "date": Value::Null,
            "reason": Value::Null,
            "contact": Value::Null,
            "location": Value::Null,
            "signature_type": Value::Null,
        })
    };
    let Some(v) = forms::chain_get(doc, &entry.chain, b"V") else {
        return unsigned();
    };
    let Ok((_, resolved)) = doc.dereference(v) else {
        return unsigned();
    };
    let Ok(sig) = resolved.as_dict() else {
        return unsigned();
    };
    let (range, well_formed) = byte_range(sig);
    json!({
        "name": name,
        "page": page,
        "annot": annot,
        "signed": true,
        "byte_range": range,
        "byte_range_well_formed": well_formed,
        "sub_filter": sig_name(sig, b"SubFilter"),
        "signer": sig_text(sig, b"Name"),
        "date": sig_text(sig, b"M"),
        "reason": sig_text(sig, b"Reason"),
        "contact": sig_text(sig, b"ContactInfo"),
        "location": sig_text(sig, b"Location"),
        "signature_type": sig_name(sig, b"Type"),
    })
}

/// Structural signature count for `describe` — the same collection
/// `listSignatures` reports, minus payload decoding. Errors propagate:
/// a document too hostile for the bounded walk fails `describe` rather
/// than reporting a silently truncated count.
pub(super) fn signature_count(doc: &Document) -> Result<usize, EngineError> {
    collect_signatures(doc).map(|v| v.len())
}

impl FolioEngine {
    /// `listSignatures {}` → `{signatures:[…]}`. Read-only, silent.
    /// Rejects encrypted documents (field names and signature strings
    /// are ciphertext — `decrypt` first).
    pub(super) fn op_list_signatures(&self) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "signature fields cannot be listed on encrypted documents; decrypt first",
            ));
        }
        let entries = collect_signatures(&self.doc)?;
        let signatures = entries
            .iter()
            .map(|e| signature_json(&self.doc, e))
            .collect::<Vec<_>>();
        Ok(ro(json!({ "signatures": signatures })))
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

    fn set_acroform_fields(doc: &mut Document, fields: Vec<Object>) {
        let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_object_mut(catalog_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(
                "AcroForm",
                dictionary! {
                    "Fields" => Object::Array(fields),
                },
            );
    }

    /// Document with: a signed merged Sig widget, an unsigned merged Sig
    /// widget, and a catalog-only Sig field with no widget anywhere.
    fn signed_doc() -> Document {
        let mut doc = crate::build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();

        // Signed signature dictionary.
        let sig_id = doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Sig",
            "Filter" => "Adobe.PPKLite",
            "SubFilter" => "adbe.pkcs7.detached",
            "Name" => lopdf::text_string("Alice Signer"),
            "M" => lopdf::text_string("D:20260101120000Z"),
            "Reason" => lopdf::text_string("I approve"),
            "ContactInfo" => lopdf::text_string("alice@example.com"),
            "Location" => lopdf::text_string("New York"),
            "ByteRange" => vec![
                Object::Integer(0), Object::Integer(100),
                Object::Integer(200), Object::Integer(300),
            ],
        }));

        let rect = || {
            vec![
                Object::Real(10.0),
                Object::Real(700.0),
                Object::Real(110.0),
                Object::Real(720.0),
            ]
        };
        let base = |t: &str, v: Option<Object>| {
            let mut d = dictionary! {
                "Type" => "Annot",
                "Subtype" => "Widget",
                "Rect" => rect(),
                "FT" => "Sig",
                "T" => lopdf::text_string(t),
                "P" => Object::Reference(page_id),
            };
            if let Some(v) = v {
                d.set("V", v);
            }
            d
        };

        let signed_widget = base("sig.signed", Some(Object::Reference(sig_id)));
        let signed_id = doc.add_object(Object::Dictionary(signed_widget));
        let page = doc.get_object_mut(page_id).unwrap().as_dict_mut().unwrap();
        page.set("Annots", Object::Array(vec![Object::Reference(signed_id)]));

        let unsigned_widget = base("sig.unsigned", None);
        let unsigned_id = doc.add_object(Object::Dictionary(unsigned_widget));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .get_mut(b"Annots")
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(Object::Reference(unsigned_id));

        // Catalog-only signature field: in /Fields, no widget on any page.
        let orphan = doc.add_object(Object::Dictionary(dictionary! {
            "FT" => "Sig",
            "T" => lopdf::text_string("sig.orphan"),
            "V" => Object::Reference(sig_id),
        }));

        set_acroform_fields(
            &mut doc,
            vec![
                Object::Reference(signed_id),
                Object::Reference(unsigned_id),
                Object::Reference(orphan),
            ],
        );
        doc
    }

    #[test]
    fn lists_signed_unsigned_and_catalog_only_signatures() {
        let mut e = engine();
        e.doc = signed_doc();
        let d = apply(&mut e, "listSignatures", json!({}));
        let sigs = d["signatures"].as_array().unwrap();
        assert_eq!(sigs.len(), 3);

        let signed = sigs.iter().find(|s| s["name"] == "sig.signed").unwrap();
        assert_eq!(signed["signed"], true);
        assert_eq!(signed["page"], 0);
        assert!(signed["annot"].is_number());
        assert_eq!(signed["byte_range"], json!([0, 100, 200, 300]));
        assert_eq!(signed["byte_range_well_formed"], true);
        assert_eq!(signed["sub_filter"], "adbe.pkcs7.detached");
        assert_eq!(signed["signer"], "Alice Signer");
        assert_eq!(signed["date"], "D:20260101120000Z");
        assert_eq!(signed["reason"], "I approve");
        assert_eq!(signed["contact"], "alice@example.com");
        assert_eq!(signed["location"], "New York");
        assert_eq!(signed["signature_type"], "Sig");

        let unsigned = sigs.iter().find(|s| s["name"] == "sig.unsigned").unwrap();
        assert_eq!(unsigned["signed"], false);
        assert_eq!(unsigned["page"], 0);
        assert_eq!(unsigned["byte_range"], Value::Null);
        assert_eq!(unsigned["byte_range_well_formed"], false);

        let orphan = sigs.iter().find(|s| s["name"] == "sig.orphan").unwrap();
        assert_eq!(orphan["page"], Value::Null);
        assert_eq!(orphan["annot"], Value::Null);
        // The orphan shares the same /V signature dictionary.
        assert_eq!(orphan["signed"], true);
        assert_eq!(orphan["signer"], "Alice Signer");
    }

    #[test]
    fn malformed_byte_range_reports_shape_only() {
        let mut doc = crate::build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        let sig_id = doc.add_object(Object::Dictionary(dictionary! {
            "SubFilter" => "adbe.pkcs7.detached",
            "ByteRange" => vec![
                Object::Integer(0), Object::Integer(100),
                Object::Integer(50), Object::Integer(300), // overlaps pair 1
            ],
        }));
        let widget = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "Rect" => vec![
                Object::Real(0.0), Object::Real(0.0),
                Object::Real(10.0), Object::Real(10.0),
            ],
            "FT" => "Sig",
            "T" => lopdf::text_string("sig.bad"),
            "V" => Object::Reference(sig_id),
        };
        let wid = doc.add_object(Object::Dictionary(widget));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Annots", Object::Array(vec![Object::Reference(wid)]));
        set_acroform_fields(&mut doc, vec![Object::Reference(wid)]);

        let mut e = engine();
        e.doc = doc;
        let d = apply(&mut e, "listSignatures", json!({}));
        let sig = &d["signatures"][0];
        assert_eq!(sig["byte_range"], json!([0, 100, 50, 300]));
        assert_eq!(sig["byte_range_well_formed"], false);
        // Non-dict /V is unsigned.
        let sig2_id = e.doc.add_object(Object::Dictionary(dictionary! {
            "FT" => "Sig",
            "T" => lopdf::text_string("sig.vstring"),
            "V" => lopdf::text_string("not a dict"),
        }));
        // Attach it as a second field via /Fields only.
        let catalog_id = e.doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let af = e
            .doc
            .get_object_mut(catalog_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .get_mut(b"AcroForm")
            .unwrap()
            .as_dict_mut()
            .unwrap();
        af.get_mut(b"Fields")
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(Object::Reference(sig2_id));
        let d = apply(&mut e, "listSignatures", json!({}));
        let v = d["signatures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "sig.vstring")
            .unwrap();
        assert_eq!(v["signed"], false);
    }

    #[test]
    fn list_signatures_rejects_encrypted_and_records_no_undo() {
        let mut e = engine();
        e.doc = signed_doc();
        apply(&mut e, "encrypt", json!({ "password": "pw" }));
        let err = apply_err(&mut e, "listSignatures", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);

        let mut plain = engine();
        plain.doc = signed_doc();
        let before = plain.journal.undo_len();
        apply(&mut plain, "listSignatures", json!({}));
        assert_eq!(plain.journal.undo_len(), before);
    }

    #[test]
    fn describe_reports_signature_count() {
        let mut e = engine();
        e.doc = signed_doc();
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["signature_count"], 3);
        let mut empty = engine();
        let d = apply(&mut empty, "describe", json!({}));
        assert_eq!(d["signature_count"], 0);
    }

    #[test]
    fn signatures_survive_save_and_reopen() {
        let mut e = engine();
        e.doc = signed_doc();
        let saved = apply(&mut e, "save", json!({}));
        let mut e2 = engine();
        apply(&mut e2, "open", json!({ "bytes_b64": saved["bytes_b64"] }));
        let d = apply(&mut e2, "listSignatures", json!({}));
        assert_eq!(d["signatures"].as_array().unwrap().len(), 3);
        let signed = d["signatures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "sig.signed")
            .unwrap();
        assert_eq!(signed["signer"], "Alice Signer");
    }
}
