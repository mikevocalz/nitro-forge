//! AcroForm widget operations: `listFormFields` and `fillFormField`
//! (docs/ENGINE_OPS.md §folio-engine, P15 Slice C / F-5 + F-6).
//!
//! Semantics:
//! - Widgets are discovered by walking each page's `/Annots` array — the
//!   same source `listAnnotations` uses — not the catalog `/AcroForm`
//!   `/Fields` tree. An entry counts as a widget when `/Subtype` is
//!   `/Widget`, or when `/Subtype` is absent and the dictionary carries
//!   `/FT` (a merged field/widget missing its subtype). Fields whose
//!   widgets never appear in a page `/Annots` array are not listed:
//!   they have no on-page presence.
//! - Field attributes are inheritable per ISO 32000-1: `/FT`, `/V`, `/Ff`
//!   and `/T` partial names resolve by walking the widget's `/Parent`
//!   chain leaf→root and taking the nearest defined value. The flattened
//!   name joins every `/T` on the chain (root→leaf) with `.`.
//! - `/V` is written on the *field* dictionary, never assumed to be the
//!   widget: the target is the first chain node (widget first) carrying
//!   any field key (`/T`, `/FT`, `/V`, `/Ff`, `/Opt`, `/Kids`, `/DA`,
//!   `/Q`). For a merged field/widget that is the widget dict itself;
//!   for a separate widget kid it is the parent field dict, so filling
//!   through one widget updates every widget of the field. Field dicts
//!   stored inline (non-indirect) reject with Unsupported — lopdf has
//!   no path mutation into nested inline dictionaries.
//! - `fillFormField` takes exactly one of `field` (the flattened name
//!   from `listFormFields`, matched per page) or `annot` (the widget's
//!   `/Annots` object number). `/FT` must resolve to `Tx`, `Ch` or `Btn`;
//!   `Sig` rejects, and so do pushbuttons (`/Ff` bit 16) and fields with
//!   no resolvable `/FT`.
//! - `Tx`/`Ch` write `/V` as a PDF text string (`lopdf::text_string`,
//!   PDFDocEncoding or UTF-16BE). Choice fields get a single string
//!   only — `/I` index arrays and multi-select are not written, and
//!   `/Opt` membership is not validated.
//! - `Btn` writes `/V` as a *name*. Values `""`, `off`, `false`, `no`,
//!   `0` (case-insensitive) map to `/Off`; every other value is used
//!   verbatim as the on-state name (lopdf escapes it on write). Check
//!   boxes (radio bit clear) set that name as `/V` and mirror it into
//!   `/AS` on the field's widget dictionaries. Radio groups (bit 15,
//!   mask 0x8000) interpret `value` as the on-state name: at least one
//!   kid widget's `/AP`→`/N` dictionary must contain that name, the
//!   field `/V` is set to it, the matching kid's `/AS` takes the name
//!   and every sibling widget kid's `/AS` becomes `/Off`. Radio widgets
//!   without `/AP` appearance states cannot be addressed and reject.
//!   `/AS` is written only on indirect widget dictionaries; inline ones
//!   are skipped (they cannot be mutated through lopdf's object map).
//! - Both ops reject encrypted documents with Unsupported. `lopdf`'s
//!   `encrypt` rewrites strings in place, so `/T` names and `Tx`/`Ch`
//!   `/V` values are ciphertext (listFormFields would report garbage),
//!   and a new plaintext `/V` string written post-encryption would save
//!   as plaintext inside an encrypted file. `decrypt` first.
//! - On every successful fill the AcroForm dict gets
//!   `/NeedAppearances true` (created when absent) because the engine
//!   never regenerates appearance streams — viewers that honor
//!   NeedAppearances repaint fields; others may show stale appearances.
//! - Bounds: ≤10 000 listed fields per call, field hierarchies ≤64
//!   links, values ≤32 767 UTF-16 code units (`Tx`/`Ch`) or ≤1024 UTF-8
//!   bytes (`Btn` names). Traversal is cycle-safe; every fallible step
//!   runs before the journal records, and the mutation commits a cloned
//!   document — one undo entry, one `document:changed`. Filling the
//!   current value is an eventless no-op.
use super::*;
use lopdf::Dictionary;
use std::collections::HashSet;

/// Maximum widget rows `listFormFields` reports (and `fillFormField` scans).
const MAX_FORM_FIELDS: usize = 10_000;
/// Maximum `/Parent` chain hops when resolving field attributes.
const MAX_FIELD_DEPTH: usize = 64;
/// `/V` cap for `Tx`/`Ch` text strings, in UTF-16 code units.
const MAX_FIELD_VALUE_UTF16: usize = 32_767;
/// `Btn` on-state name cap in UTF-8 bytes.
const MAX_BUTTON_VALUE_BYTES: usize = 1024;
/// `/Ff` bit 15 (mask 0x8000): radio button group.
const FF_RADIO: i64 = 1 << 15;
/// `/Ff` bit 16 (mask 0x10000): pushbutton — not fillable.
const FF_PUSHBUTTON: i64 = 1 << 16;
/// Dictionary keys that mark a chain node as a field rather than a
/// pure widget annotation. `/T` alone is deliberately excluded: it is
/// also the annotation title key, so it only counts as a last resort.
const FIELD_KEYS: [&[u8]; 7] = [b"FT", b"V", b"Ff", b"Opt", b"Kids", b"DA", b"Q"];

/// One link in a widget's `/Parent` chain, leaf (the widget) first.
/// `dict` is a clone so callers can inspect it after the borrow ends;
/// `id` is the indirect object id when the dictionary is indirect.
struct ChainNode {
    id: Option<ObjectId>,
    dict: Dictionary,
}

/// A page `/Annots` entry recognized as a form widget, with its resolved
/// field chain.
struct WidgetEntry {
    /// The `/Annots` array item's reference id (`.0` reported as `annot`);
    /// `None` for inline dictionaries, which cannot be targeted by id.
    annot_id: Option<u64>,
    /// Widget dict first, then `/Parent` ancestors leaf→root.
    chain: Vec<ChainNode>,
}

/// Resolve an object (reference or inline) to its dictionary without
/// cloning. Follows reference chains via `Document::dereference`.
fn resolve_dict<'a>(
    doc: &'a Document,
    object: &'a Object,
) -> Option<(Option<ObjectId>, &'a Dictionary)> {
    let (id, resolved) = doc.dereference(object).ok()?;
    resolved.as_dict().ok().map(|d| (id, d))
}

/// Widget-annotation test for `/Annots` entries: `/Subtype /Widget`,
/// or no `/Subtype` with `/FT` present (merged field/widget missing
/// its subtype). `/T` alone never qualifies — it is also the
/// annotation title key on ordinary annotations.
fn annot_is_widget(doc: &Document, dict: &Dictionary) -> bool {
    match dict
        .get_deref(b"Subtype", doc)
        .ok()
        .and_then(|o| o.as_name().ok())
    {
        Some(b"Widget") => true,
        Some(_) => false,
        // No subtype: only /FT marks a field/widget — /T alone is the
        // annotation title and /Rect+/Parent appear on comment annots.
        None => dict.has(b"FT"),
    }
}

/// Build the `/Parent` chain for one widget dictionary object.
/// Leaf first; cycle-safe via visited ids plus the depth cap.
fn widget_chain(doc: &Document, widget: &Object) -> Result<Vec<ChainNode>, EngineError> {
    let Some((wid, wdict)) = resolve_dict(doc, widget) else {
        return Err(EngineError::validation("widget annotation is not a dictionary"));
    };
    let mut chain = vec![ChainNode {
        id: wid,
        dict: wdict.clone(),
    }];
    let mut seen: HashSet<ObjectId> = wid.into_iter().collect();
    loop {
        if chain.len() > MAX_FIELD_DEPTH {
            return Err(EngineError::validation("form field hierarchy too deep"));
        }
        let parent = match chain.last().unwrap().dict.get(b"Parent") {
            Ok(o) => o.clone(),
            Err(_) => break,
        };
        let Some((pid, pdict)) = resolve_dict(doc, &parent) else {
            break; // missing or non-dictionary parent ends the chain
        };
        if let Some(id) = pid {
            if !seen.insert(id) {
                break; // parent cycle — stop here
            }
        }
        chain.push(ChainNode {
            id: pid,
            dict: pdict.clone(),
        });
    }
    Ok(chain)
}

/// First value for `key` walking the chain leaf→root, with indirect
/// references inside the dictionaries dereferenced.
fn chain_get<'a>(doc: &'a Document, chain: &'a [ChainNode], key: &[u8]) -> Option<&'a Object> {
    chain
        .iter()
        .find_map(|node| node.dict.get_deref(key, doc).ok())
}

/// First chain node (leaf→root) that looks like a field dictionary:
/// carries one of the strong field keys, or `/T` as a last resort.
fn field_node_index(chain: &[ChainNode]) -> Option<usize> {
    if let Some(i) = chain
        .iter()
        .position(|n| FIELD_KEYS.iter().any(|k| n.dict.has(k)))
    {
        return Some(i);
    }
    chain.iter().position(|n| n.dict.has(b"T"))
}

/// Flattened field name: every `/T` on the chain, root→leaf, joined
/// with `.`. Missing or undecodable partial names are skipped.
fn flattened_name(doc: &Document, chain: &[ChainNode]) -> String {
    let mut parts = Vec::new();
    for node in chain.iter().rev() {
        if let Ok(t) = node.dict.get_deref(b"T", doc) {
            if let Ok(s) = lopdf::decode_text_string(t) {
                if !s.is_empty() {
                    parts.push(s);
                }
            }
        }
    }
    parts.join(".")
}

/// `/FT` name resolved leaf→root (`"Tx"`, `"Btn"`, `"Ch"`, `"Sig"`, or
/// whatever name a foreign document used).
fn field_type(doc: &Document, chain: &[ChainNode]) -> Option<String> {
    chain_get(doc, chain, b"FT")
        .and_then(|o| o.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
}

/// `/Ff` flags resolved leaf→root.
fn field_flags(doc: &Document, chain: &[ChainNode]) -> Option<i64> {
    chain_get(doc, chain, b"Ff")
        .and_then(|o| o.as_i64().ok())
}

/// `/V` decoded for reporting: text strings decode, names report their
/// bytes lossily, arrays recurse (multi-select choice values), anything
/// else (signature dictionaries, numbers) reports null.
fn field_value_json(doc: &Document, chain: &[ChainNode]) -> Value {
    let Some(v) = chain_get(doc, chain, b"V") else {
        return Value::Null;
    };
    match v {
        Object::String(..) => lopdf::decode_text_string(v)
            .map(Value::from)
            .unwrap_or(Value::Null),
        Object::Name(n) => json!(String::from_utf8_lossy(n)),
        Object::Array(items) => json!(items
            .iter()
            .map(|item| match item {
                Object::String(..) => lopdf::decode_text_string(item)
                    .map(Value::from)
                    .unwrap_or(Value::Null),
                Object::Name(n) => json!(String::from_utf8_lossy(n)),
                _ => Value::Null,
            })
            .collect::<Vec<_>>()),
        _ => Value::Null,
    }
}

/// `/Rect` of the widget dict (chain node 0) as `[x, y, w, h]`, matching
/// the `listAnnotations` convention; null when absent or malformed.
fn widget_rect(chain: &[ChainNode]) -> Value {
    let rect = match chain[0].dict.get(b"Rect").ok().and_then(|o| o.as_array().ok()) {
        Some(a) if a.len() == 4 => a,
        _ => return Value::Null,
    };
    let (Some(x1), Some(y1), Some(x2), Some(y2)) = (
        obj_f64(&rect[0]),
        obj_f64(&rect[1]),
        obj_f64(&rect[2]),
        obj_f64(&rect[3]),
    ) else {
        return Value::Null;
    };
    json!([x1, y1, x2 - x1, y2 - y1])
}

/// All widget entries on one page, in `/Annots` order. Cycle-safe,
/// capped at `MAX_FORM_FIELDS`; duplicate indirect references are
/// reported once.
fn page_widget_entries(doc: &Document, page_id: ObjectId) -> Result<Vec<WidgetEntry>, EngineError> {
    let entries = annot_entries(doc, page_id)?;
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for entry in &entries {
        if out.len() >= MAX_FORM_FIELDS {
            return Err(EngineError::validation("form field limit exceeded"));
        }
        let Some((_, dict)) = resolve_dict(doc, entry) else {
            continue; // dangling or non-dictionary annot — skip
        };
        if !annot_is_widget(doc, dict) {
            continue;
        }
        // Dedupe by the /Annots item's own reference (one hop, the same
        // id `annot` reports); inline dictionaries always count.
        let annot_ref = entry.as_reference().ok();
        if let Some(id) = annot_ref {
            if !seen.insert(id) {
                continue;
            }
        }
        let chain = widget_chain(doc, entry)?;
        out.push(WidgetEntry {
            annot_id: annot_ref.map(|id| id.0 as u64),
            chain,
        });
    }
    Ok(out)
}

/// True when the document has any AcroForm `/Fields` entry or any
/// widget annotation — the cheap `describe.has_forms` probe.
pub(super) fn doc_has_forms(doc: &Document) -> bool {
    if let Ok(catalog) = doc.catalog() {
        if let Ok(af) = catalog.get_deref(b"AcroForm", doc) {
            if let Ok(dict) = af.as_dict() {
                if let Ok(fields) = dict.get_deref(b"Fields", doc) {
                    if fields.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                        return true;
                    }
                }
            }
        }
    }
    for (_, page_id) in doc.get_pages() {
        let Ok(entries) = annot_entries(doc, page_id) else {
            continue;
        };
        for entry in &entries {
            if let Some((_, dict)) = resolve_dict(doc, entry) {
                if annot_is_widget(doc, dict) {
                    return true;
                }
            }
        }
    }
    false
}

/// `/Kids` of a field dictionary resolved to widget dictionaries.
/// Returns `(ObjectId, Dictionary)` pairs for indirect kids only —
/// inline kids cannot be mutated and are skipped for `/AS` writes but
/// still inspected for radio appearance-state matching.
fn field_widget_kids(
    doc: &Document,
    field: &Dictionary,
) -> Vec<(Option<ObjectId>, Dictionary)> {
    let mut kids = Vec::new();
    let Ok(kids_obj) = field.get_deref(b"Kids", doc) else {
        return kids;
    };
    let Ok(array) = kids_obj.as_array() else {
        return kids;
    };
    for kid in array {
        if let Some((id, dict)) = resolve_dict(doc, kid) {
            // A kid is a widget when it is explicitly `/Subtype /Widget`
            // or looks like a bare widget annotation (geometry, no
            // field keys, no `/Kids`). Sub-fields carrying `/FT`, `/T`,
            // `/V` etc. are not widgets and never receive `/AS`.
            let explicit = dict
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                == Some(b"Widget");
            let bare = dict.has(b"Rect")
                && !dict.has(b"Kids")
                && !dict.has(b"T")
                && FIELD_KEYS.iter().all(|k| !dict.has(k));
            if explicit || bare {
                kids.push((id, dict.clone()));
            }
        }
    }
    kids
}

/// On-state names of one widget's `/AP`→`/N` dictionary (every key
/// except `/Off`). Empty when the widget has no usable appearance
/// states — radio groups need these to map a value to a kid.
fn widget_on_states(doc: &Document, widget: &Dictionary) -> Vec<Vec<u8>> {
    let Some(ap) = widget.get_deref(b"AP", doc).ok().and_then(|o| o.as_dict().ok()) else {
        return Vec::new();
    };
    let Some(normal) = ap.get(b"N").ok().and_then(|o| resolve_dict(doc, o).map(|(_, d)| d)) else {
        return Vec::new();
    };
    normal
        .iter()
        .filter(|(key, _)| key.as_slice() != b"Off")
        .map(|(key, _)| key.clone())
        .collect()
}

/// `Btn` off-values, matched case-insensitively.
fn is_button_off(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "" | "off" | "false" | "no" | "0")
}

impl FolioEngine {
    /// `listFormFields {}` → `{fields:[{page,name,ft,v,ff,rect,signature,annot}]}`.
    /// Read-only; rejects encrypted documents (names and values are
    /// ciphertext — `decrypt` first).
    pub(super) fn op_list_form_fields(&self) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "form fields cannot be listed on encrypted documents; decrypt first",
            ));
        }
        let mut fields = Vec::new();
        for (num, page_id) in self.doc.get_pages() {
            for entry in page_widget_entries(&self.doc, page_id)? {
                let ft = field_type(&self.doc, &entry.chain);
                let ff = field_flags(&self.doc, &entry.chain);
                fields.push(json!({
                    "page": num - 1,
                    "name": flattened_name(&self.doc, &entry.chain),
                    "ft": ft,
                    "v": field_value_json(&self.doc, &entry.chain),
                    "ff": ff,
                    "rect": widget_rect(&entry.chain),
                    "signature": ft.as_deref() == Some("Sig"),
                    "annot": entry.annot_id,
                }));
                if fields.len() >= MAX_FORM_FIELDS {
                    return Err(EngineError::validation("form field limit exceeded"));
                }
            }
        }
        Ok(ro(json!({ "fields": fields })))
    }

    /// `fillFormField {page, field|annot, value}` → `{ok}`.
    /// Mutating; one undo entry and one `document:changed` per real
    /// change. Equal-value fills are eventless.
    #[allow(clippy::too_many_lines)]
    pub(super) fn op_fill_form_field(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "form fields cannot be filled on encrypted documents; decrypt first",
            ));
        }
        let page = req_u64(p, "page")?;
        let page_id = self.page_id(page)?;
        let value = req_str(p, "value")?;
        let has_field = p.get("field").is_some();
        let has_annot = p.get("annot").is_some();
        if has_field == has_annot {
            return Err(EngineError::invalid(
                "exactly one of 'field' or 'annot' is required",
            ));
        }
        let entries = page_widget_entries(&self.doc, page_id)?;
        let target = if has_annot {
            let id = req_u64(p, "annot")?;
            entries
                .iter()
                .position(|e| e.annot_id == Some(id))
                .ok_or_else(|| EngineError::not_found("widget annotation not found on this page"))?
        } else {
            let name = req_str(p, "field")?;
            let matches: Vec<usize> = entries
                .iter()
                .enumerate()
                .filter(|(_, e)| flattened_name(&self.doc, &e.chain) == name)
                .map(|(i, _)| i)
                .collect();
            match matches.len() {
                0 => {
                    return Err(EngineError::not_found(
                        "no form field with that name on this page",
                    ))
                }
                1 => matches[0],
                _ => {
                    return Err(EngineError::validation(format!(
                        "form field name '{name}' is ambiguous on this page ({} widgets); target one with 'annot'",
                        matches.len()
                    )))
                }
            }
        };
        let entry = &entries[target];
        let ft = field_type(&self.doc, &entry.chain)
            .ok_or_else(|| EngineError::validation("form field has no resolvable /FT"))?;
        if ft == "Sig" {
            return Err(EngineError::validation(
                "signature fields cannot be filled",
            ));
        }
        let ff = field_flags(&self.doc, &entry.chain).unwrap_or(0);
        if ff & FF_PUSHBUTTON != 0 {
            return Err(EngineError::validation("pushbutton fields cannot be filled"));
        }
        let field_idx = field_node_index(&entry.chain).ok_or_else(|| {
            EngineError::validation("widget has no field dictionary in its /Parent chain")
        })?;
        let field_node = &entry.chain[field_idx];
        let Some(field_id) = field_node.id else {
            return Err(EngineError::unsupported(
                "inline field dictionaries cannot be filled; the field must be an indirect object",
            ));
        };

        // Resolve everything fallible against the live document before
        // cloning: new /V object, /AS updates, and the equal-value check.
        let (v_object, as_updates, current_equal) = match ft.as_str() {
            "Tx" | "Ch" => {
                if value.encode_utf16().count() > MAX_FIELD_VALUE_UTF16 {
                    return Err(EngineError::validation(format!(
                        "field value exceeds {MAX_FIELD_VALUE_UTF16} UTF-16 code units"
                    )));
                }
                let current = chain_get(&self.doc, &entry.chain, b"V")
                    .and_then(|o| lopdf::decode_text_string(o).ok());
                (
                    lopdf::text_string(value),
                    Vec::new(),
                    current.as_deref() == Some(value),
                )
            }
            "Btn" => {
                if value.len() > MAX_BUTTON_VALUE_BYTES {
                    return Err(EngineError::validation(format!(
                        "button field value exceeds {MAX_BUTTON_VALUE_BYTES} bytes"
                    )));
                }
                let off = is_button_off(value);
                let name_bytes: Vec<u8> = if off {
                    b"Off".to_vec()
                } else {
                    value.as_bytes().to_vec()
                };
                let radio = ff & FF_RADIO != 0;
                // /AS targets: every indirect widget kid of the field,
                // the field dict itself when it doubles as a widget
                // (merged field/widget), and the addressed widget.
                // Inline dictionaries cannot be mutated through lopdf's
                // object map and are skipped — /V remains authoritative.
                let field_dict = self
                    .doc
                    .get_object(field_id)
                    .and_then(Object::as_dict)
                    .map_err(ser_err)?;
                let kids = field_widget_kids(&self.doc, field_dict);
                let field_is_widget = annot_is_widget(&self.doc, field_dict);
                let mut as_targets: Vec<ObjectId> =
                    kids.iter().filter_map(|(id, _)| *id).collect();
                if field_is_widget {
                    as_targets.push(field_id);
                }
                if let Some(wid) = entry.chain[0].id {
                    as_targets.push(wid);
                }
                as_targets.sort();
                as_targets.dedup();

                let mut updates: Vec<(ObjectId, Vec<u8>)> = Vec::new();
                if radio && !off {
                    // The value names one kid's on-state. Kids are
                    // matched through their /AP→/N dictionaries; a
                    // merged field/widget may carry /AP itself. An
                    // inline (non-indirect) match still sets /V — it
                    // just cannot receive /AS.
                    let mut any_states = false;
                    let mut found = false;
                    let mut matched: Option<ObjectId> = None;
                    for (kid_id, kid_dict) in &kids {
                        let states = widget_on_states(&self.doc, kid_dict);
                        if !states.is_empty() {
                            any_states = true;
                        }
                        if states.iter().any(|s| s == &name_bytes) {
                            found = true;
                            matched = *kid_id;
                        }
                    }
                    if field_is_widget {
                        let states = widget_on_states(&self.doc, field_dict);
                        if !states.is_empty() {
                            any_states = true;
                        }
                        if states.iter().any(|s| s == &name_bytes) {
                            found = true;
                            matched = Some(field_id);
                        }
                    }
                    if !any_states {
                        return Err(EngineError::validation(
                            "radio field widgets have no /AP appearance states to select",
                        ));
                    }
                    if !found {
                        return Err(EngineError::validation(format!(
                            "no radio widget has an appearance state named '{value}'"
                        )));
                    }
                    for target_id in &as_targets {
                        updates.push((
                            *target_id,
                            if matched == Some(*target_id) {
                                name_bytes.clone()
                            } else {
                                b"Off".to_vec()
                            },
                        ));
                    }
                } else {
                    // Checkbox (or radio /Off): every widget takes the
                    // same state name.
                    for target_id in &as_targets {
                        updates.push((*target_id, name_bytes.clone()));
                    }
                }
                let current = chain_get(&self.doc, &entry.chain, b"V")
                    .and_then(|o| o.as_name().ok())
                    .map(|n| n.to_vec());
                (
                    Object::Name(name_bytes.clone()),
                    updates,
                    current.as_deref() == Some(name_bytes.as_slice()),
                )
            }
            other => {
                return Err(EngineError::validation(format!(
                    "unsupported field type '{other}' (expected Tx|Ch|Btn)"
                )))
            }
        };
        if current_equal {
            return Ok(ro(json!({ "ok": true })));
        }

        let mut next = self.doc.clone();
        next.get_object_mut(field_id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?
            .set("V", v_object);
        for (widget_id, state) in &as_updates {
            next.get_object_mut(*widget_id)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?
                .set("AS", Object::Name(state.clone()));
        }
        set_need_appearances(&mut next)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({ "ok": true })))
    }
}

/// Set `/NeedAppearances true` on the catalog's `/AcroForm` dictionary,
/// creating an indirect AcroForm dict when the catalog lacks one.
/// Runs on the cloned document about to be committed.
fn set_need_appearances(doc: &mut Document) -> Result<(), EngineError> {
    enum Loc {
        Missing,
        Inline,
        Ref(ObjectId),
        Bad,
    }
    let loc = {
        let catalog = doc.catalog().map_err(ser_err)?;
        match catalog.get(b"AcroForm") {
            Err(_) => Loc::Missing,
            Ok(Object::Reference(id)) => {
                if doc.get_object(*id).and_then(Object::as_dict).is_ok() {
                    Loc::Ref(*id)
                } else {
                    Loc::Bad
                }
            }
            Ok(Object::Dictionary(_)) => Loc::Inline,
            Ok(_) => Loc::Bad,
        }
    };
    match loc {
        Loc::Ref(id) => {
            doc.get_object_mut(id)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?
                .set("NeedAppearances", Object::Boolean(true));
        }
        Loc::Inline => {
            doc.catalog_mut()
                .map_err(ser_err)?
                .get_mut(b"AcroForm")
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?
                .set("NeedAppearances", Object::Boolean(true));
        }
        Loc::Missing => {
            let id = doc.add_object(Object::Dictionary(dictionary! {
                "NeedAppearances" => true,
            }));
            doc.catalog_mut()
                .map_err(ser_err)?
                .set("AcroForm", Object::Reference(id));
        }
        Loc::Bad => {
            return Err(EngineError::validation(
                "catalog /AcroForm is not a dictionary",
            ))
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(e: &mut FolioEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).unwrap().data
    }
    fn apply_err(e: &mut FolioEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }

    /// Append `dict` as an indirect object and register it in the
    /// page's `/Annots` array; returns the annot object id.
    fn add_annot(doc: &mut Document, page_id: ObjectId, dict: Dictionary) -> ObjectId {
        let id = doc.add_object(Object::Dictionary(dict));
        let page = doc
            .get_object_mut(page_id)
            .and_then(Object::as_dict_mut)
            .unwrap();
        match page.get_mut(b"Annots") {
            Ok(Object::Array(items)) => items.push(Object::Reference(id)),
            _ => page.set("Annots", Object::Array(vec![Object::Reference(id)])),
        }
        id
    }

    fn widget_base() -> Dictionary {
        dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "Rect" => vec![
                Object::Real(10.0),
                Object::Real(700.0),
                Object::Real(210.0),
                Object::Real(720.0),
            ],
            "P" => Object::Null, // patched per page below
        }
    }

    /// One-page document exercising every field kind:
    /// merged Tx, merged Btn checkbox, Btn radio group (two widget
    /// kids), Ch, Sig, a separate field+widget Tx, a two-level name
    /// hierarchy, plus one ordinary Text annot that must be ignored.
    fn form_engine() -> FolioEngine {
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        let mut annots_field_ids = Vec::new();

        // Merged text field.
        let mut d = widget_base();
        d.set("FT", "Tx");
        d.set("T", lopdf::text_string("name"));
        d.set("V", lopdf::text_string("old"));
        d.set("Ff", 0);
        d.set("P", Object::Reference(page_id));
        add_annot(&mut doc, page_id, d);

        // Merged checkbox.
        let mut d = widget_base();
        d.set("FT", "Btn");
        d.set("T", lopdf::text_string("agree"));
        d.set("V", Object::Name(b"Yes".to_vec()));
        d.set("Ff", 0);
        d.set("P", Object::Reference(page_id));
        add_annot(&mut doc, page_id, d);

        // Radio group: field dict + two widget kids with /AP states.
        let radio = doc.new_object_id();
        let mut kids = Vec::new();
        for (state, rect_y) in [("A", 660.0), ("B", 640.0)] {
            let mut w = widget_base();
            w.set("Rect", vec![
                Object::Real(10.0),
                Object::Real(rect_y),
                Object::Real(30.0),
                Object::Real(rect_y + 20.0),
            ]);
            w.remove(b"P");
            w.set("Parent", Object::Reference(radio));
            w.set(
                "AP",
                dictionary! {
                    "N" => dictionary! {
                        state => Object::Null,
                        "Off" => Object::Null,
                    },
                },
            );
            let wid = add_annot(&mut doc, page_id, w);
            kids.push(Object::Reference(wid));
        }
        doc.objects.insert(
            radio,
            Object::Dictionary(dictionary! {
                "FT" => "Btn",
                "T" => lopdf::text_string("choice"),
                "V" => Object::Name(b"A".to_vec()),
                "Ff" => 32768,
                "Kids" => Object::Array(kids),
            }),
        );
        annots_field_ids.push(radio);

        // Choice field.
        let mut d = widget_base();
        d.set("FT", "Ch");
        d.set("T", lopdf::text_string("pick"));
        d.set("V", lopdf::text_string("a"));
        d.set("Opt", vec![lopdf::text_string("a"), lopdf::text_string("b")]);
        d.set("P", Object::Reference(page_id));
        add_annot(&mut doc, page_id, d);

        // Signature field.
        let mut d = widget_base();
        d.set("FT", "Sig");
        d.set("T", lopdf::text_string("signature"));
        d.set("P", Object::Reference(page_id));
        add_annot(&mut doc, page_id, d);

        // Separate field dict + widget kid (Tx).
        let field = doc.new_object_id();
        let mut w = widget_base();
        w.remove(b"P");
        w.set("Parent", Object::Reference(field));
        let wid = add_annot(&mut doc, page_id, w);
        doc.objects.insert(
            field,
            Object::Dictionary(dictionary! {
                "FT" => "Tx",
                "T" => lopdf::text_string("address"),
                "V" => lopdf::text_string(""),
                "Kids" => vec![Object::Reference(wid)],
            }),
        );
        annots_field_ids.push(field);

        // Two-level hierarchy: form1.child.
        let grandparent = doc.new_object_id();
        let child = doc.new_object_id();
        let mut w = widget_base();
        w.remove(b"P");
        w.set("Parent", Object::Reference(child));
        let wid = add_annot(&mut doc, page_id, w);
        doc.objects.insert(
            child,
            Object::Dictionary(dictionary! {
                "T" => lopdf::text_string("child"),
                "FT" => "Tx",
                "V" => lopdf::text_string("deep"),
                "Parent" => Object::Reference(grandparent),
                "Kids" => vec![Object::Reference(wid)],
            }),
        );
        doc.objects.insert(
            grandparent,
            Object::Dictionary(dictionary! {
                "T" => lopdf::text_string("form1"),
            }),
        );
        annots_field_ids.push(child);
        annots_field_ids.push(grandparent);

        // Ordinary text annot — must not be listed as a field.
        let mut d = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Text",
            "Rect" => vec![
                Object::Real(1.0), Object::Real(1.0),
                Object::Real(5.0), Object::Real(5.0),
            ],
            "Contents" => lopdf::text_string("note"),
        };
        d.set("P", Object::Reference(page_id));
        add_annot(&mut doc, page_id, d);

        // AcroForm for realism.
        let catalog = doc.catalog_mut().unwrap();
        catalog.set(
            "AcroForm",
            dictionary! {
                "Fields" => Object::Array(
                    annots_field_ids.iter().map(|id| Object::Reference(*id)).collect(),
                ),
                "NeedAppearances" => false,
            },
        );

        let mut e = FolioEngine::new();
        e.doc = doc;
        e
    }

    fn fields(e: &mut FolioEngine) -> Vec<Value> {
        apply(e, "listFormFields", json!({}))["fields"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn list_reports_every_field_kind() {
        let mut e = form_engine();
        let rows = fields(&mut e);
        // 8 widgets: name, agree, 2× choice, pick, signature, address,
        // form1.child — the Text annot is excluded.
        assert_eq!(rows.len(), 8, "{rows:?}");
        let by_name = |n: &str| rows.iter().find(|r| r["name"] == n).unwrap().clone();
        let name = by_name("name");
        assert_eq!(name["ft"], "Tx");
        assert_eq!(name["v"], "old");
        assert_eq!(name["ff"], 0);
        assert_eq!(name["rect"], json!([10.0, 700.0, 200.0, 20.0]));
        assert_eq!(name["signature"], false);
        assert!(name["annot"].as_u64().unwrap() > 0);
        assert_eq!(name["page"], 0);

        let agree = by_name("agree");
        assert_eq!(agree["ft"], "Btn");
        assert_eq!(agree["v"], "Yes");

        let choice_rows: Vec<&Value> = rows.iter().filter(|r| r["name"] == "choice").collect();
        assert_eq!(choice_rows.len(), 2);
        assert_eq!(choice_rows[0]["ft"], "Btn");
        assert_eq!(choice_rows[0]["ff"], 32768);
        assert_eq!(choice_rows[0]["v"], "A");

        assert_eq!(by_name("pick")["ft"], "Ch");
        assert_eq!(by_name("pick")["v"], "a");
        let sig = by_name("signature");
        assert_eq!(sig["ft"], "Sig");
        assert_eq!(sig["signature"], true);
        assert_eq!(by_name("address")["v"], "");
        assert_eq!(by_name("form1.child")["v"], "deep");
        assert!(rows.iter().all(|r| r["name"] != "note"));
    }

    #[test]
    fn fill_text_field_sets_v_needappearances_and_undoes() {
        let mut e = form_engine();
        let undo_len = e.journal.undo_len();
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "name", "value": "new value"}),
        );
        let rows = fields(&mut e);
        assert_eq!(rows.iter().find(|r| r["name"] == "name").unwrap()["v"], "new value");
        // /NeedAppearances flipped on the AcroForm dict.
        let catalog = e.doc.catalog().unwrap();
        let af = catalog.get_deref(b"AcroForm", &e.doc).unwrap();
        let af = af.as_dict().unwrap();
        assert_eq!(
            af.get(b"NeedAppearances").unwrap().as_bool().unwrap(),
            true
        );
        assert_eq!(e.journal.undo_len(), undo_len + 1);
        assert!(e.undo().unwrap());
        assert_eq!(
            fields(&mut e)
                .iter()
                .find(|r| r["name"] == "name")
                .unwrap()["v"],
            "old"
        );
        assert!(e.redo().unwrap());
        assert_eq!(
            fields(&mut e)
                .iter()
                .find(|r| r["name"] == "name")
                .unwrap()["v"],
            "new value"
        );
    }

    #[test]
    fn fill_by_annot_targets_widget_and_writes_field_dict() {
        let mut e = form_engine();
        let rows = fields(&mut e);
        let annot = rows
            .iter()
            .find(|r| r["name"] == "address")
            .unwrap()["annot"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "annot": annot, "value": "1 Main St"}),
        );
        assert_eq!(
            fields(&mut e)
                .iter()
                .find(|r| r["name"] == "address")
                .unwrap()["v"],
            "1 Main St"
        );
        // The /V landed on the field dict, not the widget kid: find the
        // field via the widget's /Parent and check it holds /V while
        // the widget dict itself does not.
        let page_id = e.page_id(0).unwrap();
        let entries = annot_entries(&e.doc, page_id).unwrap();
        for entry in entries {
            let Some((_, dict)) = resolve_dict(&e.doc, &entry) else { continue };
            if dict.get(b"Parent").is_ok() {
                // widget kid of the address field
                let parent = dict.get(b"Parent").unwrap();
                let (_, pdict) = resolve_dict(&e.doc, parent).unwrap();
                if pdict.get(b"T").ok().and_then(|o| lopdf::decode_text_string(o).ok()).as_deref() == Some("address") {
                    assert!(pdict.get(b"V").is_ok());
                    assert!(dict.get(b"V").is_err(), "widget kid must not carry /V");
                }
            }
        }
    }

    #[test]
    fn fill_checkbox_maps_off_and_names() {
        let mut e = form_engine();
        let before = e.journal.undo_len();
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "agree", "value": "Off"}),
        );
        assert_eq!(
            fields(&mut e)
                .iter()
                .find(|r| r["name"] == "agree")
                .unwrap()["v"],
            "Off"
        );
        // Equal fill is eventless: no journal entry, no document:changed.
        let result = e
            .apply(Command::new(
                "fillFormField",
                json!({"page": 0, "field": "agree", "value": "Off"}),
            ))
            .unwrap();
        assert!(result.events.is_empty());
        assert_eq!(e.journal.undo_len(), before + 1);
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "agree", "value": "Yes"}),
        );
        assert_eq!(
            fields(&mut e)
                .iter()
                .find(|r| r["name"] == "agree")
                .unwrap()["v"],
            "Yes"
        );
        // lowercase off variants also clear
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "agree", "value": "false"}),
        );
        assert_eq!(
            fields(&mut e)
                .iter()
                .find(|r| r["name"] == "agree")
                .unwrap()["v"],
            "Off"
        );
    }

    #[test]
    fn fill_radio_selects_matching_kid_and_off() {
        let mut e = form_engine();
        let rows = fields(&mut e);
        // Two widgets share the name "choice" — fill by field is ambiguous.
        let err = apply_err(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "choice", "value": "B"}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // Target the second radio widget by annot id.
        let annots: Vec<u64> = rows
            .iter()
            .filter(|r| r["name"] == "choice")
            .map(|r| r["annot"].as_u64().unwrap())
            .collect();
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "annot": annots[1], "value": "B"}),
        );
        let rows = fields(&mut e);
        assert!(rows
            .iter()
            .filter(|r| r["name"] == "choice")
            .all(|r| r["v"] == "B"));
        // Verify /AS on the two widget dicts: B-kid gets /B, A-kid /Off.
        let radio_id = {
            // find radio field id via catalog AcroForm? easier: scan objects
            // for the dict with /Ff 32768
            e.doc
                .objects
                .iter()
                .find(|(_, o)| {
                    o.as_dict()
                        .map(|d| {
                            d.get(b"Ff").ok().and_then(|f| f.as_i64().ok()) == Some(32768)
                        })
                        .unwrap_or(false)
                })
                .map(|(id, _)| *id)
                .unwrap()
        };
        let radio = e.doc.get_object(radio_id).unwrap().as_dict().unwrap();
        let kids = radio.get(b"Kids").unwrap().as_array().unwrap();
        let mut states = Vec::new();
        for k in kids {
            let kid = e.doc.get_object(k.as_reference().unwrap()).unwrap().as_dict().unwrap();
            states.push(
                kid.get(b"AS")
                    .unwrap()
                    .as_name()
                    .unwrap()
                    .to_vec(),
            );
        }
        states.sort();
        assert_eq!(states, vec![b"B".to_vec(), b"Off".to_vec()]);
        // /Off clears the group.
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "annot": annots[0], "value": "off"}),
        );
        assert!(fields(&mut e)
            .iter()
            .filter(|r| r["name"] == "choice")
            .all(|r| r["v"] == "Off"));
    }

    #[test]
    fn fill_rejects_sig_unknown_ambiguous_and_missing() {
        let mut e = form_engine();
        let before = e.snapshot().unwrap();
        for (p, code) in [
            (json!({"page":0,"field":"signature","value":"x"}), ignition_core::ErrorCode::Validation),
            (json!({"page":0,"field":"nope","value":"x"}), ignition_core::ErrorCode::NotFound),
            (json!({"page":0,"annot":99999,"value":"x"}), ignition_core::ErrorCode::NotFound),
            (json!({"page":0,"field":"name","annot":1,"value":"x"}), ignition_core::ErrorCode::InvalidCommand),
            (json!({"page":0,"field":"name"}), ignition_core::ErrorCode::InvalidCommand),
            (json!({"page":0,"field":"name","value":42}), ignition_core::ErrorCode::InvalidCommand),
            (json!({"page":9,"field":"name","value":"x"}), ignition_core::ErrorCode::OutOfBounds),
        ] {
            let err = apply_err(&mut e, "fillFormField", p.clone());
            assert_eq!(err.code, code, "{p}");
        }
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn encrypted_documents_reject_list_and_fill() {
        let mut e = form_engine();
        apply(&mut e, "encrypt", json!({"password": "pw"}));
        let err = apply_err(&mut e, "listFormFields", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        let err = apply_err(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "name", "value": "x"}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        // describe still reports has_forms on the encrypted doc.
        let d = apply(&mut e, "describe", json!({}));
        assert_eq!(d["has_forms"], true);
        assert_eq!(d["encrypted"], true);
    }

    #[test]
    fn describe_reports_has_forms() {
        let mut e = form_engine();
        assert_eq!(apply(&mut e, "describe", json!({}))["has_forms"], true);
        let mut plain = FolioEngine::new();
        apply(&mut plain, "new", json!({"pages": 1}));
        assert_eq!(apply(&mut plain, "describe", json!({}))["has_forms"], false);
    }

    #[test]
    fn parent_cycle_and_hostile_dicts_do_not_hang_or_panic() {
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        // Cyclic field parents A<->B.
        let a = doc.new_object_id();
        let b = doc.new_object_id();
        doc.objects.insert(
            a,
            Object::Dictionary(dictionary! {
                "FT" => "Tx",
                "T" => lopdf::text_string("cyc"),
                "Parent" => Object::Reference(b),
            }),
        );
        doc.objects.insert(
            b,
            Object::Dictionary(dictionary! {
                "T" => lopdf::text_string("b"),
                "Parent" => Object::Reference(a),
            }),
        );
        let mut w = widget_base();
        w.set("Parent", Object::Reference(a));
        w.remove(b"P");
        add_annot(&mut doc, page_id, w);
        // Hostile entries: dangling ref, integer object, non-dict parent.
        let bad_ref = Object::Reference(doc.new_object_id());
        let page = doc.get_object_mut(page_id).unwrap().as_dict_mut().unwrap();
        page.get_mut(b"Annots").unwrap().as_array_mut().unwrap().push(bad_ref);
        let int_id = doc.add_object(Object::Integer(7));
        let page = doc.get_object_mut(page_id).unwrap().as_dict_mut().unwrap();
        page.get_mut(b"Annots").unwrap().as_array_mut().unwrap().push(Object::Reference(int_id));
        let mut w2 = widget_base();
        w2.set("Parent", Object::Reference(int_id)); // parent is an integer
        w2.set("T", Object::Integer(5)); // /T not a string
        w2.set("Rect", Object::Integer(9)); // malformed rect
        w2.remove(b"P");
        add_annot(&mut doc, page_id, w2);

        let mut e = FolioEngine::new();
        e.doc = doc;
        let rows = fields(&mut e);
        assert_eq!(rows.len(), 2, "{rows:?}");
        assert_eq!(rows[0]["name"], "b.cyc");
        assert_eq!(rows[0]["ft"], "Tx");
        assert_eq!(rows[1]["rect"], Value::Null);
        // Fill still resolves through the cycle (field node = widget? no:
        // widget w2 has no field keys except bad /T -> field node is w2).
        let annot = rows[1]["annot"].as_u64().unwrap();
        let err = apply_err(
            &mut e,
            "fillFormField",
            json!({"page": 0, "annot": annot, "value": "x"}),
        );
        // w2's chain: widget -> int (stops). No field keys -> /FT missing
        // -> validation, state untouched.
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    #[test]
    fn fill_value_bounds_and_unicode() {
        let mut e = form_engine();
        // Unicode text round-trips through PDF text strings.
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "name", "value": "東京 😀"}),
        );
        assert_eq!(
            fields(&mut e)
                .iter()
                .find(|r| r["name"] == "name")
                .unwrap()["v"],
            "東京 😀"
        );
        // Oversize text rejected before mutation.
        let before = e.snapshot().unwrap();
        let err = apply_err(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "name", "value": "x".repeat(MAX_FIELD_VALUE_UTF16 + 1)}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn form_fields_survive_save_open() {
        let mut e = form_engine();
        apply(
            &mut e,
            "fillFormField",
            json!({"page": 0, "field": "name", "value": "persisted"}),
        );
        let saved = apply(&mut e, "save", json!({}));
        let mut e2 = FolioEngine::new();
        apply(&mut e2, "open", json!({"bytes_b64": saved["bytes_b64"]}));
        let rows = fields(&mut e2);
        assert_eq!(rows.len(), 8);
        assert_eq!(
            rows.iter().find(|r| r["name"] == "name").unwrap()["v"],
            "persisted"
        );
        assert_eq!(
            rows.iter().find(|r| r["name"] == "form1.child").unwrap()["v"],
            "deep"
        );
        // Fill on the reopened doc too.
        apply(
            &mut e2,
            "fillFormField",
            json!({"page": 0, "field": "pick", "value": "b"}),
        );
        assert_eq!(
            fields(&mut e2)
                .iter()
                .find(|r| r["name"] == "pick")
                .unwrap()["v"],
            "b"
        );
    }

    #[test]
    fn field_cap_rejects() {
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        for i in 0..=MAX_FORM_FIELDS {
            let mut d = widget_base();
            d.set("FT", "Tx");
            d.set("T", lopdf::text_string(&format!("f{i}")));
            d.set("P", Object::Reference(page_id));
            add_annot(&mut doc, page_id, d);
        }
        let mut e = FolioEngine::new();
        e.doc = doc;
        let err = apply_err(&mut e, "listFormFields", json!({}));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }
}
