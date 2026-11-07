//! Page-tree operations: `movePage`, `deletePage`, `duplicatePage`,
//! `insertBlankPage` and the read-only `listPageInfo`
//! (docs/ENGINE_OPS.md §folio-engine, P15 Slice B / F-3a).
//!
//! Semantics:
//! - The document's page order is the depth-first `/Kids` order under the
//!   catalog's `/Pages` root (`lopdf`'s `get_pages` order). Every structural
//!   op rewrites that root's `/Kids` as a flat array of page references and
//!   reparents each page to the root, so intermediate `/Pages` nodes are
//!   dropped. Before reparenting, inheritable page attributes (`/MediaBox`,
//!   `/CropBox`, `/Rotate`, `/Resources`, `/UserUnit` — ISO 32000-1
//!   §7.7.3.4 and Table 30) that a page does not define itself are
//!   materialized onto it from its ancestor chain, so flattening cannot
//!   change any page's effective attributes.
//! - Structural ops reject encrypted documents outright: lopdf's
//!   `Document::encrypt` rewrites strings and streams in place keyed by
//!   object id, so objects cloned under fresh ids (a duplicated page or its
//!   annotations) would carry ciphertext that decrypts to garbage under the
//!   new id. `decrypt` first, then reorder.
//! - Before rewriting `/Kids`, the page iterator's yield is compared
//!   against a full recursive `/Kids` walk; a malformed tree that hides
//!   subtrees from `get_pages` (untyped or inline nodes) rejects with
//!   Validation rather than silently dropping pages.
//! - After the rewrite, objects that are no longer reachable from the
//!   trailer are removed: lopdf's writer emits every object in
//!   `doc.objects`, so orphaned `/Pages` nodes, a deleted page's exclusive
//!   contents/annots and replaced `/Annots` arrays would otherwise persist
//!   as dead bytes in every `save`. Objects still referenced elsewhere
//!   (shared content streams, shared `/Resources`, annots referenced by
//!   surviving pages) are kept.
//! - `duplicatePage` clones the page dictionary and each annotation into
//!   fresh indirect objects with fresh ids; `/Contents` streams,
//!   `/Resources` and all other referenced objects are shared with the
//!   source page. Intra-page annotation links (`/IRT`, `/Popup`, and
//!   `/Parent` when it names another annotation) are remapped into the
//!   copied set; a widget `/Parent` field reference stays shared. An
//!   annotation whose `/IRT` or `/Popup` points outside the page's
//!   annotation set rejects the whole op rather than producing a broken
//!   comment graph. Inline (non-reference) annotation dictionaries are
//!   preserved as inline entries in the copy's `/Annots` array. The copy's
//!   page dict drops `/StructParents` and `/B`, which must not be shared
//!   verbatim with the source (see ENGINE_OPS.md for the remaining
//!   shared/stale keys).
use super::*;
use std::collections::{HashMap, HashSet};

/// Maximum `/Parent` chain hops when resolving inheritable attributes or
/// checking annotation links (matches lopdf's page-tree depth limit).
const MAX_TREE_DEPTH: usize = 256;

/// Ordered page object ids; position `i` is the 0-based page index.
fn ordered_pages(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

/// The catalog's `/Pages` root as an indirect object id. Structural ops
/// require the standard indirect root; documents with an inline or missing
/// root reject cleanly instead of being half-rewritten.
fn pages_root(doc: &Document) -> Result<ObjectId, EngineError> {
    let catalog = doc.catalog().map_err(ser_err)?;
    catalog
        .get(b"Pages")
        .and_then(Object::as_reference)
        .map_err(|_| EngineError::validation("document catalog has no indirect /Pages root"))
}

/// 0-based page index bounds check shared by the page ops.
fn page_index(raw: u64, len: usize, field: &str) -> Result<usize, EngineError> {
    let index = usize::try_from(raw)
        .map_err(|_| EngineError::out_of_bounds(format!("'{field}' is too large")))?;
    if index >= len {
        return Err(EngineError::out_of_bounds(format!(
            "'{field}' {raw} out of range (document has {len} pages)"
        )));
    }
    Ok(index)
}

/// Walk the `/Parent` chain from `start` (the node itself included) and
/// return the first value stored under `key`. Bounded and cycle-safe;
/// returns `None` when no ancestor defines the key.
fn inherited<'a>(doc: &'a Document, start: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut seen = HashSet::new();
    let mut current = Some(start);
    for _ in 0..MAX_TREE_DEPTH {
        let id = current?;
        if !seen.insert(id) {
            return None;
        }
        let dict = doc.get_object(id).and_then(Object::as_dict).ok()?;
        if let Ok(value) = dict.get(key) {
            return Some(value);
        }
        current = dict.get(b"Parent").ok().and_then(|o| o.as_reference().ok());
    }
    None
}

/// Copy each inheritable page attribute the page does not define itself
/// from its ancestor chain. Must run while the page's original `/Parent`
/// chain is still intact, i.e. before reparenting to the flat root.
fn materialize_inherited(doc: &mut Document, page_id: ObjectId) -> Result<(), EngineError> {
    for key in [
        &b"MediaBox"[..],
        &b"CropBox"[..],
        &b"Rotate"[..],
        &b"Resources"[..],
        // /UserUnit is inheritable too (ISO 32000-1 Table 30, PDF 1.6).
        &b"UserUnit"[..],
    ] {
        let present = doc
            .get_object(page_id)
            .and_then(Object::as_dict)
            .map_err(ser_err)?
            .has(key);
        if present {
            continue;
        }
        let Some(value) = inherited(doc, page_id, key).cloned() else {
            continue;
        };
        doc.get_object_mut(page_id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?
            .set(key, value);
    }
    Ok(())
}

/// Collect every object id referenced inside `object` (arrays, dictionaries
/// and stream dictionaries; references themselves are not followed here).
fn collect_refs(object: &Object, out: &mut Vec<ObjectId>) {
    match object {
        Object::Reference(id) => out.push(*id),
        Object::Array(items) => {
            for item in items {
                collect_refs(item, out);
            }
        }
        Object::Dictionary(dict) => {
            for (_, value) in dict.iter() {
                collect_refs(value, out);
            }
        }
        Object::Stream(stream) => {
            for (_, value) in stream.dict.iter() {
                collect_refs(value, out);
            }
        }
        _ => {}
    }
}

/// Object ids reachable from the trailer — exactly what a saved PDF needs.
fn reachable_objects(doc: &Document) -> HashSet<ObjectId> {
    let mut seen = HashSet::new();
    let mut stack = Vec::new();
    for (_, value) in doc.trailer.iter() {
        collect_refs(value, &mut stack);
    }
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        if let Some(object) = doc.objects.get(&id) {
            collect_refs(object, &mut stack);
        }
    }
    seen
}

/// Drop objects no longer reachable from the trailer. Skipped entirely
/// when the trailer has no indirect `/Root` so a malformed document can
/// never lose its whole object table to the sweep.
pub(super) fn prune_unreachable(doc: &mut Document) {
    if doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .is_err()
    {
        return;
    }
    let keep = reachable_objects(doc);
    doc.objects.retain(|id, _| keep.contains(id));
}

/// Count the terminal `/Kids` descendants under the `/Pages` `root`: every
/// node reached through `/Kids` arrays — by reference or inline dictionary,
/// whatever its `/Type` — that does not itself carry a non-empty `/Kids`
/// array. `get_pages` (lopdf's `PageTreeIter`) only yields indirect kids
/// typed `/Page` and only descends into `/Pages` nodes, so a subtree hung
/// off an untyped or inline node is invisible to it; comparing this count
/// against the iterator's yield before a rewrite fails closed on such
/// malformed trees instead of silently dropping pages. Reference cycles
/// are cut by `seen`; nesting beyond [`MAX_TREE_DEPTH`] saturates to
/// `usize::MAX` so the comparison rejects rather than undercounts.
fn count_tree_leaves(doc: &Document, root: ObjectId) -> usize {
    fn dict_of<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a lopdf::Dictionary> {
        match object {
            Object::Dictionary(dict) => Some(dict),
            Object::Reference(id) => doc.get_object(*id).ok()?.as_dict().ok(),
            _ => None,
        }
    }
    fn kids_of(dict: &lopdf::Dictionary) -> Option<&[Object]> {
        dict.get(b"Kids")
            .ok()?
            .as_array()
            .ok()
            .map(Vec::as_slice)
    }
    fn walk(
        doc: &Document,
        kids: &[Object],
        seen: &mut HashSet<ObjectId>,
        depth: usize,
    ) -> usize {
        if depth > MAX_TREE_DEPTH {
            return usize::MAX;
        }
        let mut total = 0usize;
        for kid in kids {
            let contribution = match kid {
                Object::Reference(id) => {
                    if seen.contains(id) {
                        0
                    } else {
                        seen.insert(*id);
                        match dict_of(doc, kid).and_then(kids_of) {
                            Some(sub) if !sub.is_empty() => walk(doc, sub, seen, depth + 1),
                            // Referenced leaf — a page, an untyped node, or
                            // a non-dictionary object; the iterator cannot
                            // yield it but it occupies a /Kids slot.
                            _ => 1,
                        }
                    }
                }
                Object::Dictionary(inline) => match kids_of(inline) {
                    Some(sub) if !sub.is_empty() => walk(doc, sub, seen, depth + 1),
                    _ => 1,
                },
                // Non-dictionary kid: skipped by the page iterator, counted
                // here so the guard sees the discrepancy.
                _ => 1,
            };
            total = total.saturating_add(contribution);
        }
        total
    }
    let kids = doc
        .get_object(root)
        .and_then(Object::as_dict)
        .ok()
        .and_then(|d| d.get(b"Kids").ok())
        .and_then(|o| o.as_array().ok())
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut seen = HashSet::new();
    seen.insert(root);
    walk(doc, kids, &mut seen, 0)
}

/// Make `order` (page object ids in the desired sequence) the document's
/// page order: materialize inheritable attributes, rewrite the root
/// `/Pages` node's `/Kids`/`/Count` flat, reparent every page to the root,
/// then collect unreachable objects. All fallible lookups run on `doc`
/// before the caller commits it, so failures leave the engine untouched.
fn apply_page_order(doc: &mut Document, order: &[ObjectId]) -> Result<(), EngineError> {
    // lopdf's `encrypt` rewrites strings and streams in place keyed by
    // object id; structural ops clone page/annotation objects under fresh
    // ids, which would carry ciphertext that decrypts to garbage. Refuse
    // on encrypted documents — `decrypt` first.
    if doc.is_encrypted() {
        return Err(EngineError::unsupported(
            "structural page ops are not supported on encrypted documents; decrypt first",
        ));
    }
    let root = pages_root(doc)?;
    // Fail closed when the page iterator and a full /Kids walk disagree:
    // rewriting /Kids from `order` would otherwise drop the unvisited
    // subtrees. `doc` here is the pre-rewrite tree, so `get_pages` yields
    // exactly the pages `order` was built from (minus pages an insert or
    // duplicate is about to add, which are not in the tree yet either).
    let walked = count_tree_leaves(doc, root);
    let visited = doc.get_pages().len();
    if walked != visited {
        return Err(EngineError::validation(format!(
            "malformed page tree: /Kids walk finds {walked} terminal entries but the page iterator yields {visited}; refusing to rewrite"
        )));
    }
    for &page_id in order {
        materialize_inherited(doc, page_id)?;
    }
    let kids: Vec<Object> = order.iter().map(|&id| Object::Reference(id)).collect();
    {
        let root_dict = doc
            .get_object_mut(root)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?;
        root_dict.set("Kids", Object::Array(kids));
        root_dict.set("Count", Object::Integer(order.len() as i64));
    }
    for &page_id in order {
        doc.get_object_mut(page_id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?
            .set("Parent", Object::Reference(root));
    }
    prune_unreachable(doc);
    Ok(())
}

impl FolioEngine {
    /// Stage a new page order on a cloned document, then record undo and
    /// commit — the same whole-Document clone commit every mutating op uses.
    fn commit_page_order(&mut self, order: Vec<ObjectId>) -> Result<CommandResult, EngineError> {
        let mut next = self.doc.clone();
        apply_page_order(&mut next, &order)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `movePage {from, to}` → `{ok}`. Both are 0-based page indices;
    /// the page at `from` is removed and reinserted so it lands at `to`.
    pub(super) fn op_move_page(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = req_u64(p, "from")?;
        let to = req_u64(p, "to")?;
        let mut order = ordered_pages(&self.doc);
        let from = page_index(from, order.len(), "from")?;
        let to = page_index(to, order.len(), "to")?;
        if from == to {
            // Moving a page onto itself changes nothing; stay eventless
            // and record no undo entry.
            return Ok(ro(json!({ "ok": true })));
        }
        let id = order.remove(from);
        order.insert(to, id);
        self.commit_page_order(order)
    }

    /// `deletePage {page}` → `{ok}`. 0-based index; refuses to remove the
    /// last remaining page (a PDF must keep ≥1 page). Objects reachable
    /// only through the deleted page are collected by the order rewrite.
    pub(super) fn op_delete_page(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let page = req_u64(p, "page")?;
        let mut order = ordered_pages(&self.doc);
        let index = page_index(page, order.len(), "page")?;
        if order.len() <= 1 {
            return Err(EngineError::validation(
                "cannot delete the last remaining page",
            ));
        }
        order.remove(index);
        self.commit_page_order(order)
    }

    /// `insertBlankPage {index}` → `{ok, page}`. Inserts a blank US-Letter
    /// page (empty content stream, empty resources) at `index`, where
    /// `0..=page_count` is valid and `page_count` appends.
    pub(super) fn op_insert_blank(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let raw = req_u64(p, "index")?;
        let mut order = ordered_pages(&self.doc);
        let index =
            usize::try_from(raw).map_err(|_| EngineError::out_of_bounds("'index' is too large"))?;
        if index > order.len() {
            return Err(EngineError::out_of_bounds(format!(
                "'index' {index} out of range (0..={})",
                order.len()
            )));
        }
        let mut next = self.doc.clone();
        let root = pages_root(&next)?;
        let content_id = next.add_object(Object::Stream(Stream::new(dictionary! {}, Vec::new())));
        let page_dict = dictionary! {
            "Type" => "Page",
            "Parent" => root,
            "MediaBox" => vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(LETTER_W),
                Object::Integer(LETTER_H),
            ],
            "Resources" => dictionary! {},
            "Contents" => content_id,
        };
        let page_id = next.add_object(Object::Dictionary(page_dict));
        order.insert(index, page_id);
        apply_page_order(&mut next, &order)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({ "ok": true, "page": index })))
    }

    /// `duplicatePage {page}` → `{ok, page}` — the 0-based index of the
    /// copy, inserted immediately after the source. See the module docs
    /// for the sharing semantics: content streams and resources are shared,
    /// annotations are deep-copied with fresh ids.
    pub(super) fn op_duplicate_page(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let page = req_u64(p, "page")?;
        let mut order = ordered_pages(&self.doc);
        let index = page_index(page, order.len(), "page")?;
        let source = order[index];

        // Validate everything against the committed document before any
        // object is created: the page dict, every annotation dict (indirect
        // references and inline dictionaries alike), and that no annotation
        // links outside the page's own annotation set. Inline dicts have
        // no object id, so they cannot be link targets — `annot_set` covers
        // exactly the indirect ids.
        let source_dict = self
            .doc
            .get_object(source)
            .and_then(Object::as_dict)
            .map_err(ser_err)?
            .clone();
        let entries = annot_entries(&self.doc, source)?;
        let source_annots: Vec<ObjectId> =
            entries.iter().filter_map(|o| o.as_reference().ok()).collect();
        let annot_set: HashSet<ObjectId> = source_annots.iter().copied().collect();
        for entry in &entries {
            let (dict, label) = match entry {
                Object::Reference(id) => (
                    self.doc
                        .get_object(*id)
                        .and_then(Object::as_dict)
                        .map_err(ser_err)?,
                    format!("annotation {id:?}"),
                ),
                Object::Dictionary(inline) => (inline, "an inline annotation".to_string()),
                _ => continue,
            };
            for key in [&b"IRT"[..], &b"Popup"[..]] {
                if let Ok(Object::Reference(target)) = dict.get(key) {
                    if !annot_set.contains(target) {
                        return Err(EngineError::validation(format!(
                            "{label} links outside the page's annotation set via /{}",
                            String::from_utf8_lossy(key)
                        )));
                    }
                }
            }
        }

        let mut next = self.doc.clone();
        // Fresh annotation objects so the copy's annots are independent of
        // the source's (editing or deleting one cannot touch the other).
        let mut annot_map: HashMap<ObjectId, ObjectId> =
            HashMap::with_capacity(source_annots.len());
        for annot_id in &source_annots {
            let dict = next
                .get_object(*annot_id)
                .and_then(Object::as_dict)
                .map_err(ser_err)?
                .clone();
            let new_id = next.add_object(Object::Dictionary(dict));
            annot_map.insert(*annot_id, new_id);
        }
        // Remap intra-page annotation links into the copied set. `/Parent`
        // only remaps when it names another annotation — a widget's field
        // parent is shared on purpose.
        for &new_id in annot_map.values() {
            let dict = next
                .get_object_mut(new_id)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?;
            for key in [&b"IRT"[..], &b"Popup"[..], &b"Parent"[..]] {
                let remap = match dict.get(key) {
                    Ok(Object::Reference(target)) => annot_map.get(target).copied(),
                    _ => None,
                };
                if let Some(mapped) = remap {
                    dict.set(key, Object::Reference(mapped));
                }
            }
        }
        // The copy's `/Annots` array preserves the source's entry order and
        // entry kinds: indirect annotations become references to the fresh
        // copies (intra-page links already remapped above); inline
        // dictionaries are deep-copied as inline entries with the same
        // top-level link remap; anything else is carried verbatim.
        let new_annots: Vec<Object> = entries
            .iter()
            .map(|entry| match entry {
                Object::Reference(id) => Object::Reference(annot_map[id]),
                Object::Dictionary(inline) => {
                    let mut dict = inline.clone();
                    for key in [&b"IRT"[..], &b"Popup"[..], &b"Parent"[..]] {
                        let remap = match dict.get(key) {
                            Ok(Object::Reference(target)) => annot_map.get(target).copied(),
                            _ => None,
                        };
                        if let Some(mapped) = remap {
                            dict.set(key, Object::Reference(mapped));
                        }
                    }
                    Object::Dictionary(dict)
                }
                other => other.clone(),
            })
            .collect();
        // The page copy: same dictionary (shared `/Contents`, `/Resources`
        // and every other reference) except keys that must not be shared
        // verbatim — `/StructParents` would alias the copy into the
        // source's structure-parent index (wrong MCID mapping in tagged
        // PDFs) and `/B` bead arrays would chain the copy into the source's
        // thread beads — plus a fresh `/Annots` array, never the source's
        // array object. The source `/Parent` is left in place so
        // `apply_page_order` materializes the same inheritable attributes
        // before reparenting to the root. `/PieceInfo`, `/Tabs`, `/AA` and
        // `/Metadata` are still copied verbatim (shared/stale — documented
        // in ENGINE_OPS.md).
        let mut page_dict = source_dict;
        page_dict.remove(b"StructParents");
        page_dict.remove(b"B");
        if entries.is_empty() {
            // Drop `/Annots` entirely so the copy cannot share an indirect
            // (possibly empty) annots array object with the source.
            page_dict.remove(b"Annots");
        } else {
            page_dict.set("Annots", Object::Array(new_annots));
        }
        let new_page = next.add_object(Object::Dictionary(page_dict));
        // Copied annotations belong to the new page; only rewrite `/P`
        // where the source annotation actually carried one. Inline
        // annotation dictionaries live inside the page's `/Annots` array
        // and get the same treatment.
        for &annot_id in annot_map.values() {
            let dict = next
                .get_object_mut(annot_id)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?;
            if dict.has(b"P") {
                dict.set("P", Object::Reference(new_page));
            }
        }
        if let Ok(items) = next
            .get_object_mut(new_page)
            .and_then(Object::as_dict_mut)
            .and_then(|d| d.get_mut(b"Annots"))
            .and_then(Object::as_array_mut)
        {
            for item in items.iter_mut() {
                if let Ok(dict) = item.as_dict_mut() {
                    if dict.has(b"P") {
                        dict.set("P", Object::Reference(new_page));
                    }
                }
            }
        }
        order.insert(index + 1, new_page);
        apply_page_order(&mut next, &order)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(
            json!({ "ok": true, "page": index + 1 }),
        ))
    }

    /// `listPageInfo {}` → `{pages:[{index, mediabox, rotate, annots_count,
    /// has_contents}]}`. Read-only. `mediabox` is `[x1, y1, x2, y2]` or
    /// `null` when no ancestor defines one; `rotate` resolves through the
    /// inheritable `/Parent` chain and defaults to 0. `has_contents` is
    /// `null` on encrypted documents (content streams are ciphertext).
    pub(super) fn op_list_page_info(&self) -> Result<CommandResult, EngineError> {
        let mut pages = Vec::new();
        for (num, page_id) in self.doc.get_pages() {
            let mediabox = match inherited(&self.doc, page_id, b"MediaBox") {
                Some(Object::Array(items)) if items.len() == 4 => {
                    items.iter().map(obj_f64).collect::<Option<Vec<f64>>>()
                }
                _ => None,
            };
            let rotate = inherited(&self.doc, page_id, b"Rotate")
                .and_then(obj_f64)
                .unwrap_or(0.0);
            pages.push(json!({
                "index": num - 1,
                "mediabox": mediabox,
                "rotate": rotate,
                "annots_count": annot_ids(&self.doc, page_id)?.len(),
                // Decompressed content bytes: a page whose /Contents is an
                // empty stream (e.g. insertBlankPage) reports false. On an
                // encrypted document the stream bytes are ciphertext, so
                // presence cannot be determined without the password —
                // report null rather than a possibly-wrong boolean.
                "has_contents": if self.doc.is_encrypted() {
                    Value::Null
                } else {
                    json!(!self
                        .doc
                        .get_page_content(page_id)
                        .map_err(ser_err)?
                        .is_empty())
                },
            }));
        }
        Ok(ro(json!({ "pages": pages })))
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
        apply(e, "save", json!({}))["bytes_b64"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn reopen(b64: &str) -> FolioEngine {
        let mut e = FolioEngine::new();
        apply(&mut e, "open", json!({ "bytes_b64": b64 }));
        e
    }

    /// Rotate is the cheapest per-page marker `describe` reports per index.
    fn rotates(e: &mut FolioEngine) -> Vec<f64> {
        apply(e, "describe", json!({}))["page_details"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["rotate"].as_f64().unwrap())
            .collect()
    }

    #[test]
    fn move_page_reorders_and_round_trips_save_open() {
        let mut e = engine(4);
        // Mark pages 0..3 with distinct rotations.
        for (i, deg) in [90.0, 180.0, 270.0, 0.0].iter().enumerate() {
            apply(&mut e, "rotatePage", json!({ "page": i, "degrees": deg }));
        }
        assert_eq!(rotates(&mut e), vec![90.0, 180.0, 270.0, 0.0]);

        apply(&mut e, "movePage", json!({ "from": 0, "to": 2 }));
        assert_eq!(rotates(&mut e), vec![180.0, 270.0, 90.0, 0.0]);
        apply(&mut e, "movePage", json!({ "from": 3, "to": 0 }));
        assert_eq!(rotates(&mut e), vec![0.0, 180.0, 270.0, 90.0]);

        // The reordered tree is a real saved PDF that reopens identically.
        let b64 = saved_b64(&mut e);
        let mut e2 = reopen(&b64);
        assert_eq!(rotates(&mut e2), vec![0.0, 180.0, 270.0, 90.0]);
        // And the /Pages root is flat: one Kids level under the catalog root.
        let pages = ordered_pages(&e2.doc);
        assert_eq!(pages.len(), 4);
        let root = pages_root(&e2.doc).unwrap();
        let kids = e2
            .doc
            .get_object(root)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Kids")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(kids.len(), 4);
    }

    #[test]
    fn move_page_bounds_and_state_preservation() {
        let mut e = engine(2);
        let before = e.journal.undo_len();
        for p in [
            json!({ "from": 2, "to": 0 }),
            json!({ "from": 0, "to": 2 }),
            json!({ "from": -1, "to": 0 }),
            json!({ "from": 0.5, "to": 0 }),
            json!({ "from": 0 }),
        ] {
            let err = apply_err(&mut e, "movePage", p.clone());
            assert!(
                matches!(
                    err.code,
                    ignition_core::ErrorCode::OutOfBounds
                        | ignition_core::ErrorCode::InvalidCommand
                ),
                "{p} -> {err:?}"
            );
        }
        assert_eq!(e.journal.undo_len(), before);
        assert_eq!(rotates(&mut e).len(), 2);
    }

    #[test]
    fn delete_page_removes_and_protects_last_page() {
        let mut e = engine(3);
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 1, "rect": [0, 0, 5, 5], "contents": "doomed" }),
        );
        apply(&mut e, "rotatePage", json!({ "page": 2, "degrees": 90 }));

        apply(&mut e, "deletePage", json!({ "page": 1 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 2);
        // Surviving pages keep identity: old page 2 is now index 1.
        assert_eq!(rotates(&mut e), vec![0.0, 90.0]);
        // The deleted page's annotation is gone with it.
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({ "page": 1 }))["annots"]
                .as_array()
                .unwrap()
                .len(),
            0
        );

        // Round-trip through real PDF bytes.
        let mut e2 = reopen(&saved_b64(&mut e));
        assert_eq!(rotates(&mut e2), vec![0.0, 90.0]);
        apply(&mut e2, "deletePage", json!({ "page": 0 }));
        assert_eq!(apply(&mut e2, "pageCount", json!({}))["pages"], 1);

        // Last-page floor: one page left, delete must reject and preserve state.
        let before = e2.snapshot().unwrap();
        let err = apply_err(&mut e2, "deletePage", json!({ "page": 0 }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        assert_eq!(e2.snapshot().unwrap(), before);
        let err = apply_err(&mut e2, "deletePage", json!({ "page": 7 }));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
    }

    #[test]
    fn delete_page_frees_exclusive_objects_but_keeps_shared() {
        let mut e = engine(2);
        // Duplicate shares the content stream; deleting either page must keep
        // the stream alive for the survivor.
        apply(&mut e, "duplicatePage", json!({ "page": 0 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 3);
        apply(&mut e, "deletePage", json!({ "page": 1 }));
        let saved = saved_b64(&mut e);
        let reloaded = Document::load_mem(&b64_decode(&saved).unwrap()).unwrap();
        assert_eq!(reloaded.get_pages().len(), 2);
        // The survivors still open and report page info cleanly.
        let mut e2 = reopen(&saved);
        let info = apply(&mut e2, "listPageInfo", json!({}));
        assert_eq!(info["pages"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn duplicate_page_clones_annots_and_shares_contents() {
        let mut e = engine(2);
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 90 }));
        let annot = apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [1, 2, 3, 4], "contents": "copy me", "subtype": "Text" }),
        );
        let src_annot = annot["annot_id"].as_u64().unwrap();

        let d = apply(&mut e, "duplicatePage", json!({ "page": 0 }));
        assert_eq!(d["page"], 1);
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 3);
        assert_eq!(rotates(&mut e), vec![90.0, 90.0, 0.0]);

        // The copy has its own annotation object id.
        let copy_annots = apply(&mut e, "listAnnotations", json!({ "page": 1 }));
        let copy_rows = copy_annots["annots"].as_array().unwrap();
        assert_eq!(copy_rows.len(), 1);
        let copy_id = copy_rows[0]["id"].as_u64().unwrap();
        assert_ne!(copy_id, src_annot);
        assert_eq!(copy_rows[0]["contents"], "copy me");

        // Editing the copy's annotation leaves the source untouched.
        apply(
            &mut e,
            "setAnnotationContents",
            json!({ "page": 1, "id": copy_id, "contents": "edited copy" }),
        );
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({ "page": 0 }))["annots"][0]["contents"],
            "copy me"
        );

        // Deleting the copy removes only its annotation subtree.
        apply(
            &mut e,
            "removeAnnotation",
            json!({ "page": 1, "id": copy_id }),
        );
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({ "page": 0 }))["annots"]
                .as_array()
                .unwrap()
                .len(),
            1
        );

        // Real PDF round-trip preserves the duplicated page and its annots.
        let mut e2 = reopen(&saved_b64(&mut e));
        assert_eq!(apply(&mut e2, "pageCount", json!({}))["pages"], 3);
        assert_eq!(rotates(&mut e2), vec![90.0, 90.0, 0.0]);
        assert_eq!(
            apply(&mut e2, "listAnnotations", json!({ "page": 0 }))["annots"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let err = apply_err(&mut e2, "duplicatePage", json!({ "page": 9 }));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
    }

    #[test]
    fn insert_blank_page_positions_and_bounds() {
        let mut e = engine(2);
        let d = apply(&mut e, "insertBlankPage", json!({ "index": 1 }));
        assert_eq!(d["page"], 1);
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 3);
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 90 }));
        apply(&mut e, "rotatePage", json!({ "page": 2, "degrees": 270 }));
        assert_eq!(rotates(&mut e), vec![90.0, 0.0, 270.0]);

        // Append at the end and prepend at the front.
        apply(&mut e, "insertBlankPage", json!({ "index": 3 }));
        apply(&mut e, "insertBlankPage", json!({ "index": 0 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 5);

        // Blank pages report letter MediaBox, no annots, no contents.
        // Order is now [blank, A(90), blank, B(270), blank].
        let info = apply(&mut e, "listPageInfo", json!({}));
        let pages = info["pages"].as_array().unwrap();
        assert_eq!(pages.len(), 5);
        assert_eq!(pages[0]["mediabox"], json!([0.0, 0.0, 612.0, 792.0]));
        assert_eq!(pages[0]["has_contents"], false); // empty stream decodes to nothing
        assert_eq!(pages[0]["annots_count"], 0);
        assert_eq!(pages[0]["rotate"], 0.0);
        assert_eq!(pages[2]["rotate"], 0.0);
        assert_eq!(pages[1]["rotate"], 90.0);
        assert_eq!(pages[3]["rotate"], 270.0);

        for bad in [json!({ "index": 6 }), json!({ "index": -1 }), json!({})] {
            let err = apply_err(&mut e, "insertBlankPage", bad.clone());
            assert!(
                matches!(
                    err.code,
                    ignition_core::ErrorCode::OutOfBounds
                        | ignition_core::ErrorCode::InvalidCommand
                ),
                "{bad} -> {err:?}"
            );
        }

        // Undo restores the exact prior order.
        assert!(e.undo().unwrap());
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 4);
        let mut e2 = reopen(&saved_b64(&mut e));
        assert_eq!(apply(&mut e2, "pageCount", json!({}))["pages"], 4);
    }

    #[test]
    fn list_page_info_reports_fields_and_inherited_attributes() {
        let mut e = engine(2);
        // Give page 0 real content bytes so has_contents is true; page 1's
        // empty stream reports false.
        let page0 = ordered_pages(&e.doc)[0];
        let content_id = e.doc.add_object(Object::Stream(Stream::new(
            dictionary! {},
            b"(Visible) Tj".to_vec(),
        )));
        e.doc
            .get_object_mut(page0)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Contents", Object::Reference(content_id));
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 1, "rect": [0, 0, 5, 5], "contents": "x" }),
        );
        apply(&mut e, "rotatePage", json!({ "page": 1, "degrees": 90 }));
        let info = apply(&mut e, "listPageInfo", json!({}));
        let pages = info["pages"].as_array().unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0]["index"], 0);
        assert_eq!(pages[0]["mediabox"], json!([0.0, 0.0, 612.0, 792.0]));
        assert_eq!(pages[0]["rotate"], 0.0);
        assert_eq!(pages[0]["annots_count"], 0);
        assert_eq!(pages[0]["has_contents"], true);
        assert_eq!(pages[1]["annots_count"], 1);
        assert_eq!(pages[1]["rotate"], 90.0);
        assert_eq!(pages[1]["has_contents"], false);

        // Read-only: no undo entry, no event.
        let before = e.journal.undo_len();
        let result = e.apply(Command::new("listPageInfo", json!({}))).unwrap();
        assert!(result.events.is_empty());
        assert_eq!(e.journal.undo_len(), before);

        // Inherited MediaBox: strip the page's own entry, hang it on the
        // /Pages root, and confirm ops still report it after flattening.
        let root = pages_root(&e.doc).unwrap();
        let page1 = ordered_pages(&e.doc)[1];
        let mb = e
            .doc
            .get_object(page1)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"MediaBox")
            .unwrap()
            .clone();
        e.doc
            .get_object_mut(page1)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .remove(b"MediaBox");
        e.doc
            .get_object_mut(root)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("MediaBox", mb);
        let info = apply(&mut e, "listPageInfo", json!({}));
        assert_eq!(
            info["pages"][1]["mediabox"],
            json!([0.0, 0.0, 612.0, 792.0])
        );
        // A structural op materializes the inherited value before flattening.
        apply(&mut e, "movePage", json!({ "from": 1, "to": 0 }));
        let info = apply(&mut e, "listPageInfo", json!({}));
        assert_eq!(
            info["pages"][0]["mediabox"],
            json!([0.0, 0.0, 612.0, 792.0])
        );
    }

    #[test]
    fn insert_blank_page_into_empty_document() {
        // FolioEngine::new() starts with a valid zero-page document.
        let mut e = FolioEngine::new();
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 0);
        let d = apply(&mut e, "insertBlankPage", json!({ "index": 0 }));
        assert_eq!(d["page"], 0);
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 1);
        // movePage/deletePage on the single page still bounds/floor-check.
        let err = apply_err(&mut e, "deletePage", json!({ "page": 0 }));
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        apply(&mut e, "insertBlankPage", json!({ "index": 1 }));
        apply(&mut e, "movePage", json!({ "from": 1, "to": 0 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 2);
    }

    #[test]
    fn page_ops_undo_redo_and_snapshot_round_trip() {
        let mut e = engine(3);
        apply(&mut e, "insertBlankPage", json!({ "index": 1 }));
        apply(&mut e, "duplicatePage", json!({ "page": 0 }));
        apply(&mut e, "movePage", json!({ "from": 3, "to": 0 }));
        apply(&mut e, "deletePage", json!({ "page": 2 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 4);

        let snap = e.snapshot().unwrap();
        let mut restored = FolioEngine::new();
        restored.restore(&snap).unwrap();
        assert_eq!(
            apply(&mut restored, "listPageInfo", json!({})),
            apply(&mut e, "listPageInfo", json!({}))
        );

        // Undo the whole chain back to the original 3-page doc.
        for _ in 0..4 {
            assert!(e.undo().unwrap());
        }
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 3);
        for _ in 0..4 {
            assert!(e.redo().unwrap());
        }
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 4);
        assert_eq!(rotates(&mut e).len(), 4);
    }

    #[test]
    fn hostile_restore_is_unaffected_by_page_ops() {
        // A snapshot taken before page ops restores byte-identically and the
        // engine keeps working afterwards.
        let mut e = engine(2);
        let snap = e.snapshot().unwrap();
        apply(&mut e, "movePage", json!({ "from": 0, "to": 1 }));
        apply(&mut e, "deletePage", json!({ "page": 0 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 1);
        e.restore(&snap).unwrap();
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 2);
        // Journal was reset by restore; page ops still work.
        apply(&mut e, "insertBlankPage", json!({ "index": 2 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 3);
    }

    #[test]
    fn structural_page_ops_reject_encrypted_documents() {
        let mut e = engine(2);
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [0, 0, 5, 5], "contents": "secret" }),
        );
        apply(&mut e, "encrypt", json!({ "password": "pw" }));
        assert!(e.doc.is_encrypted());
        let before = e.snapshot().unwrap();
        let undo_before = e.journal.undo_len();

        // Every structural op rejects atomically: lopdf encrypts strings
        // and streams in place keyed by object id, so cloned page/annot
        // objects under fresh ids would carry undecryptable ciphertext.
        for (op, p) in [
            ("movePage", json!({ "from": 0, "to": 1 })),
            ("deletePage", json!({ "page": 0 })),
            ("duplicatePage", json!({ "page": 0 })),
            ("insertBlankPage", json!({ "index": 1 })),
        ] {
            let err = apply_err(&mut e, op, p);
            assert_eq!(
                err.code,
                ignition_core::ErrorCode::Unsupported,
                "{op} -> {err:?}"
            );
        }
        assert_eq!(e.snapshot().unwrap(), before);
        assert_eq!(e.journal.undo_len(), undo_before);
        assert!(e.doc.is_encrypted());
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 2);

        // listPageInfo stays useful read-only on encrypted docs: mediabox,
        // rotate and annots_count are structural, but has_contents is null
        // because content streams are ciphertext.
        let info = apply(&mut e, "listPageInfo", json!({}));
        let pages = info["pages"].as_array().unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0]["mediabox"], json!([0.0, 0.0, 612.0, 792.0]));
        assert_eq!(pages[0]["annots_count"], 1);
        assert_eq!(pages[0]["has_contents"], Value::Null);
        assert!(pages[1]["has_contents"].is_null());

        // After decrypt the same ops work again.
        apply(&mut e, "decrypt", json!({ "password": "pw" }));
        apply(&mut e, "movePage", json!({ "from": 0, "to": 1 }));
        assert_eq!(apply(&mut e, "pageCount", json!({}))["pages"], 2);
    }

    #[test]
    fn move_page_same_index_is_eventless_noop() {
        let mut e = engine(2);
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 90 }));
        let before = e.journal.undo_len();
        let result = e
            .apply(Command::new("movePage", json!({ "from": 1, "to": 1 })))
            .unwrap();
        assert!(result.events.is_empty());
        assert_eq!(e.journal.undo_len(), before);
        assert_eq!(rotates(&mut e), vec![90.0, 0.0]);
        // Out-of-range indices still bounds-check even when from == to.
        let err = apply_err(&mut e, "movePage", json!({ "from": 5, "to": 5 }));
        assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds);
    }

    #[test]
    fn user_unit_is_materialized_before_flatten() {
        let mut e = engine(2);
        // /UserUnit is inheritable (ISO 32000-1 Table 30); hang it on the
        // /Pages root so both pages inherit it, then flatten.
        let root = pages_root(&e.doc).unwrap();
        e.doc
            .get_object_mut(root)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("UserUnit", Object::Real(2.0));
        apply(&mut e, "movePage", json!({ "from": 0, "to": 1 }));
        for page_id in ordered_pages(&e.doc) {
            let dict = e.doc.get_object(page_id).unwrap().as_dict().unwrap();
            assert_eq!(obj_f64(dict.get(b"UserUnit").unwrap()), Some(2.0));
        }
    }

    #[test]
    fn duplicate_page_strips_struct_parents_and_beads() {
        let mut e = engine(2);
        let source = ordered_pages(&e.doc)[0];
        {
            let dict = e
                .doc
                .get_object_mut(source)
                .unwrap()
                .as_dict_mut()
                .unwrap();
            dict.set("StructParents", Object::Integer(3));
            dict.set("B", Object::Array(vec![]));
            // /PieceInfo is copied verbatim (shared/stale — documented).
            dict.set("PieceInfo", Object::Dictionary(dictionary! {}));
        }
        apply(&mut e, "duplicatePage", json!({ "page": 0 }));
        let pages = ordered_pages(&e.doc);
        assert_eq!(pages.len(), 3);
        let copy = e.doc.get_object(pages[1]).unwrap().as_dict().unwrap();
        // The copy must not alias the source's structure-parent index or
        // bead chain.
        assert!(!copy.has(b"StructParents"));
        assert!(!copy.has(b"B"));
        // Other page keys still copy verbatim.
        assert!(copy.has(b"PieceInfo"));
        // The source is untouched.
        let src = e.doc.get_object(pages[0]).unwrap().as_dict().unwrap();
        assert!(src.has(b"StructParents"));
        assert!(src.has(b"B"));
    }

    #[test]
    fn duplicate_page_preserves_inline_annotations() {
        let mut e = engine(1);
        let page = ordered_pages(&e.doc)[0];
        // An indirect annotation plus an inline annotation dictionary in
        // the same /Annots array; the inline one links back to the
        // indirect one via /IRT and carries /P.
        apply(
            &mut e,
            "addAnnotation",
            json!({ "page": 0, "rect": [0, 0, 5, 5], "contents": "indirect" }),
        );
        let indirect_id = e
            .doc
            .get_object(page)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Annots")
            .unwrap()
            .as_array()
            .unwrap()[0]
            .as_reference()
            .unwrap();
        let inline = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Text",
            "Rect" => vec![
                Object::Integer(1), Object::Integer(1),
                Object::Integer(6), Object::Integer(6),
            ],
            "Contents" => Object::string_literal("inline"),
            "IRT" => Object::Reference(indirect_id),
            "P" => Object::Reference(page),
        };
        e.doc
            .get_object_mut(page)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(
                "Annots",
                Object::Array(vec![
                    Object::Reference(indirect_id),
                    Object::Dictionary(inline),
                ]),
            );

        apply(&mut e, "duplicatePage", json!({ "page": 0 }));
        let pages = ordered_pages(&e.doc);
        assert_eq!(pages.len(), 2);
        let copy_annots = e
            .doc
            .get_object(pages[1])
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Annots")
            .unwrap()
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(copy_annots.len(), 2);
        // First entry: reference to the copied indirect annotation.
        let copied_ref = copy_annots[0].as_reference().unwrap();
        assert_ne!(copied_ref, indirect_id);
        // Second entry: the inline dict, preserved as a dictionary with
        // /IRT remapped to the copy and /P pointing at the new page.
        let inline_copy = copy_annots[1].as_dict().unwrap();
        assert_eq!(
            obj_string(inline_copy.get(b"Contents").unwrap()).as_deref(),
            Some("inline")
        );
        assert_eq!(
            inline_copy.get(b"IRT").unwrap().as_reference().unwrap(),
            copied_ref
        );
        assert_eq!(
            inline_copy.get(b"P").unwrap().as_reference().unwrap(),
            pages[1]
        );
    }

    #[test]
    fn page_tree_guard_rejects_malformed_kids() {
        // An intermediate node without /Type is invisible to lopdf's
        // PageTreeIter (it only descends into /Pages), so page 0 would be
        // silently dropped by a flat rewrite. The /Kids walk counts it and
        // the op must reject instead.
        let mut e = engine(2);
        let pages = ordered_pages(&e.doc);
        let root = pages_root(&e.doc).unwrap();
        let mid = e.doc.add_object(Object::Dictionary(dictionary! {
            "Kids" => Object::Array(vec![Object::Reference(pages[0])]),
            "Count" => Object::Integer(1),
            "Parent" => root,
        }));
        {
            let root_dict = e
                .doc
                .get_object_mut(root)
                .unwrap()
                .as_dict_mut()
                .unwrap();
            root_dict.set(
                "Kids",
                Object::Array(vec![
                    Object::Reference(mid),
                    Object::Reference(pages[1]),
                ]),
            );
        }
        // get_pages sees only page 1; the walk sees 2 terminal entries.
        assert_eq!(e.doc.get_pages().len(), 1);
        assert_eq!(count_tree_leaves(&e.doc, root), 2);

        let before = e.snapshot().unwrap();
        let undo_before = e.journal.undo_len();
        for (op, p) in [
            ("deletePage", json!({ "page": 0 })),
            ("duplicatePage", json!({ "page": 0 })),
            ("insertBlankPage", json!({ "index": 0 })),
        ] {
            let err = apply_err(&mut e, op, p);
            assert_eq!(err.code, ignition_core::ErrorCode::Validation, "{op} -> {err:?}");
        }
        assert_eq!(e.snapshot().unwrap(), before);
        assert_eq!(e.journal.undo_len(), undo_before);
    }

    #[test]
    fn page_tree_guard_allows_well_formed_nested_pages() {
        // A properly typed intermediate /Pages node is still visited by
        // the iterator, so the counts agree and the op flattens normally.
        let mut e = engine(2);
        apply(&mut e, "rotatePage", json!({ "page": 0, "degrees": 90 }));
        let pages = ordered_pages(&e.doc);
        let root = pages_root(&e.doc).unwrap();
        let mid = e.doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => Object::Array(vec![Object::Reference(pages[0])]),
            "Count" => Object::Integer(1),
            "Parent" => root,
        }));
        e.doc
            .get_object_mut(pages[0])
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Parent", Object::Reference(mid));
        {
            let root_dict = e
                .doc
                .get_object_mut(root)
                .unwrap()
                .as_dict_mut()
                .unwrap();
            root_dict.set(
                "Kids",
                Object::Array(vec![
                    Object::Reference(mid),
                    Object::Reference(pages[1]),
                ]),
            );
        }
        assert_eq!(e.doc.get_pages().len(), 2);
        assert_eq!(count_tree_leaves(&e.doc, root), 2);

        apply(&mut e, "movePage", json!({ "from": 0, "to": 1 }));
        assert_eq!(rotates(&mut e), vec![0.0, 90.0]);
        // The intermediate node was flattened away and collected.
        assert!(!e.doc.objects.contains_key(&mid));
        let root_dict = e.doc.get_object(root).unwrap().as_dict().unwrap();
        assert_eq!(
            root_dict.get(b"Kids").unwrap().as_array().unwrap().len(),
            2
        );
    }
}
