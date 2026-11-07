//! PDF outline (bookmark) operations: `listOutlines`, `addBookmark`,
//! `removeBookmark` (docs/ENGINE_OPS.md §folio-engine, P15 Slice C / F-4).
//!
//! Semantics:
//! - Outlines live in the catalog's `/Outlines` dictionary: an outline
//!   root (`/Type /Outlines`, `/First`, `/Last`, `/Count`) whose items are
//!   indirect dictionaries linked through `/Parent`, `/Prev`, `/Next`,
//!   `/First`, `/Last` and carry `/Title` plus an explicit
//!   `/Dest [page /Fit]` array.
//! - lopdf 0.36's `Bookmark`/`build_outline` helpers were evaluated and
//!   rejected: they keep a parallel `bookmark_table` that must be kept in
//!   sync, emit `/A << /S /GoTo >>` action objects instead of `/Dest`,
//!   only materialize a whole tree at build time (no incremental
//!   insert/remove of single items), compute `/Count` as direct-child
//!   counts rather than the spec's visible-descendant count, and cannot
//!   delete items. The ops below hand-build and maintain the
//!   indirect-object tree directly.
//! - Item identity is the outline item dictionary's object id, reported
//!   as `id` (the object number `.0`, u64) — the same convention as
//!   `annot_id`. Ids are stable across sibling adds/removes because
//!   neither these ops nor the page ops renumber objects. Foreign-PDF
//!   items stored as inline (non-indirect) dictionaries cannot be
//!   addressed: `listOutlines` reports `id: null` for them, and the
//!   mutating ops reject any document whose outline tree contains an
//!   inline item rather than risk corrupting nested dict values.
//! - `listOutlines` is read-only and silent. On encrypted documents it
//!   rejects with Unsupported: lopdf's `encrypt` rewrites strings in
//!   place, so every `/Title` is ciphertext and would decode to garbage.
//!   `addBookmark`/`removeBookmark` reject encrypted documents for the
//!   same reason page ops do — objects added to an encrypted document
//!   would carry plaintext strings that readers cannot decrypt — so
//!   `decrypt` first.
//! - `addBookmark` appends the new item as the *last* child of `parent`
//!   (or top-level when `parent` is absent) and recomputes every `/Count`
//!   in the tree, preserving each item's open/closed sign. `removeBookmark`
//!   unlinks the item and its whole descendant subtree, deletes the
//!   objects, repairs neighbour and scope `/First`//`/Last`//`/Next`//
//!   `/Prev` links, recounts, then prunes every trailer-unreachable
//!   object (e.g. `/A` action dicts only the removed items referenced,
//!   plus any orphans that pre-date the op). After
//!   unlinking it scans the whole document for any surviving reference
//!   into the removed set and rejects Unsupported rather than commit a
//!   dangling link — the same fail-closed posture as comment deletion.
//! - Mutations never trust an item's raw `/Prev`, `/Next`, `/Parent`,
//!   or a scope's raw `/Last`: the walk records each scope's first/last
//!   child and each item's parent/sibling links in `/First`→`/Next`
//!   traversal order, and every link repair is written from that walked
//!   truth. `/Prev` and `/Last` are never traversed, so a forged or stale
//!   value cannot redirect a rewrite into an unrelated object.
//! - Page destinations keep the page's stable object id, so `movePage`,
//!   `duplicatePage` and `insertBlankPage` keep outlines valid (the dest
//!   follows the object, and `listOutlines` resolves the *current* page
//!   index). `deletePage` never scrubs outline dests: the `/Dest` page
//!   reference keeps the deleted page reachable as an orphaned
//!   `/Type /Page` ghost (identical to named destinations — see the
//!   page-ops paragraph in ENGINE_OPS.md), and `listOutlines` reports
//!   `page: null` for it. `removeBookmark` ends with
//!   `page_ops::prune_unreachable`, which drops *every* object no longer
//!   reachable from the trailer — including orphans that pre-date the
//!   op, not only objects the removed items referenced.
//! - Bounds: titles are non-empty and ≤ 2048 UTF-16 code units; a
//!   document may hold at most 4096 outline items; top-level items sit
//!   at depth 0 and the deepest admitted item is depth 64, so a chain
//!   can be 65 items deep; every walk is cycle-safe. Named-destination
//!   collection is capped at 4096 entries — names past the cap simply
//!   fail to resolve. All mutation runs on the cloned document and
//!   commits only after every fallible step succeeded — one journal
//!   undo entry and one `document:changed` per mutating op.
use super::*;
use std::collections::{BTreeSet, HashMap, HashSet};

/// Total outline items a document may hold (mutations reject beyond this).
const MAX_OUTLINE_ITEMS: usize = 4096;
/// Maximum outline nesting depth admitted by reads and writes.
const MAX_OUTLINE_DEPTH: usize = 64;
/// `/Title` cap in UTF-16 code units (well under the 32767 text-string limit).
const MAX_TITLE_UTF16: usize = 2048;
/// Recursion cap resolving `/Dest` reference/name chains.
const MAX_DEST_DEPTH: usize = 8;
/// Recursion cap walking `/Names`→`/Dests` name trees.
const MAX_NAME_TREE_DEPTH: usize = 16;
/// Cap on named destinations collected per document — a hostile
/// `/Names`→`/Dests` tree cannot make `listOutlines` allocate an
/// unbounded map; names past the cap fail to resolve and are reported
/// as unresolved destination names.
const MAX_NAMED_DESTS: usize = 4096;

/// One decoded outline item for `listOutlines`.
struct OutlineNode {
    /// Item dictionary object id; `None` for inline foreign dictionaries.
    id: Option<ObjectId>,
    title: String,
    /// 0-based page index the `/Dest` resolves to, when decodable.
    page: Option<u32>,
    /// Explicit-destination tail (`/Fit` + coordinates) as JSON, when the
    /// dest is an array; the raw name/string when it stays unresolved.
    dest: Option<Value>,
    children: Vec<OutlineNode>,
}

/// Owning scope of one walked outline level: the catalog `/Outlines`
/// root, a parent item dictionary, or an inline (non-indirect) item.
/// Inline scopes record no links — mutations reject inline trees anyway.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Scope {
    Root,
    Item(ObjectId),
    Inline,
}

/// Walked sibling/parent relationships for one indirect outline item,
/// derived solely from `/First`→`/Next` traversal order — never from the
/// item's own `/Prev`, `/Next` or `/Parent` claims, which a malformed
/// document can forge.
#[derive(Clone, Copy)]
struct ItemLinks {
    /// Owning scope: `None` = the outline root.
    parent: Option<ObjectId>,
    /// Previous walked sibling in the same scope (`None` = first child).
    prev: Option<ObjectId>,
    /// Next walked sibling in the same scope (`None` = last child).
    next: Option<ObjectId>,
}

/// Result of walking the catalog `/Outlines` tree once.
struct OutlineWalk {
    /// Top-level items as a nested tree (for `listOutlines`).
    tree: Vec<OutlineNode>,
    /// Item object number (`.0` as u64) → full object id, for `id` payloads.
    by_number: HashMap<u64, ObjectId>,
    /// Item object id → nesting depth (top-level = 0).
    depths: HashMap<ObjectId, usize>,
    /// Every referenced outline item dictionary id (for link repair checks).
    ids: HashSet<ObjectId>,
    /// Item id → walked parent/sibling links (authoritative for repairs).
    links: HashMap<ObjectId, ItemLinks>,
    /// Scope → first walked child id (authoritative `/First` value).
    scope_first: HashMap<Scope, ObjectId>,
    /// Scope → last walked child id (authoritative `/Last` value).
    scope_last: HashMap<Scope, ObjectId>,
    /// True when any item was an inline (non-indirect) dictionary.
    inline: bool,
    /// Total item count visited (referenced + inline).
    total: usize,
}

/// Resolve an object to a dictionary, following one reference level.
fn dict_of<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a lopdf::Dictionary> {
    match object {
        Object::Dictionary(dict) => Some(dict),
        Object::Reference(id) => doc.get_object(*id).ok()?.as_dict().ok(),
        _ => None,
    }
}

/// 0-based page index per page object id, from the `/Kids` order.
fn page_index_map(doc: &Document) -> HashMap<ObjectId, u32> {
    doc.get_pages()
        .into_iter()
        .map(|(num, id)| (id, num - 1))
        .collect()
}

/// Collect named destinations from the catalog `/Dests` dictionary and the
/// `/Names`→`/Dests` name tree into `name → destination object`.
fn named_destinations(doc: &Document) -> HashMap<Vec<u8>, Object> {
    let mut map = HashMap::new();
    let Ok(catalog) = doc.catalog() else {
        return map;
    };
    if let Some(dests) = catalog
        .get(b"Dests")
        .ok()
        .and_then(|o| dict_of(doc, o))
    {
        for (key, value) in dests.iter() {
            if map.len() >= MAX_NAMED_DESTS {
                break;
            }
            map.insert(key.clone(), value.clone());
        }
    }
    if let Some(names) = catalog
        .get(b"Names")
        .ok()
        .and_then(|o| dict_of(doc, o))
    {
        if let Some(dests) = names.get(b"Dests").ok().and_then(|o| dict_of(doc, o)) {
            collect_name_tree(doc, dests, 0, &mut map);
        }
    }
    map
}

fn collect_name_tree(
    doc: &Document,
    dict: &lopdf::Dictionary,
    depth: usize,
    map: &mut HashMap<Vec<u8>, Object>,
) {
    if depth > MAX_NAME_TREE_DEPTH {
        return;
    }
    if map.len() >= MAX_NAMED_DESTS {
        return;
    }
    if let Some(items) = dict.get(b"Names").ok().and_then(|o| o.as_array().ok()) {
        for pair in items.chunks(2) {
            if map.len() >= MAX_NAMED_DESTS {
                return;
            }
            if let [key, value] = pair {
                if let Object::String(name, _) = key {
                    map.insert(name.clone(), value.clone());
                }
            }
        }
    }
    if let Some(kids) = dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()) {
        for kid in kids {
            if map.len() >= MAX_NAMED_DESTS {
                return;
            }
            if let Some(sub) = dict_of(doc, kid) {
                collect_name_tree(doc, sub, depth + 1, map);
            }
        }
    }
}

/// JSON rendering of one explicit-destination element (fit type name,
/// coordinate numbers, nested arrays).
fn dest_element_json(object: &Object) -> Value {
    match object {
        Object::Name(name) => json!(String::from_utf8_lossy(name)),
        Object::String(bytes, _) => json!(String::from_utf8_lossy(bytes)),
        Object::Integer(i) => json!(i),
        Object::Real(f) => json!(f),
        Object::Array(items) => json!(items.iter().map(dest_element_json).collect::<Vec<_>>()),
        _ => Value::Null,
    }
}

/// Decode a `/Dest` or `/A`→`/D` value into `(page_index, dest_json)`.
/// Explicit arrays resolve their first element (a page object reference)
/// through `page_map`; string/name destinations go through `named`.
fn decode_dest(
    doc: &Document,
    dest: &Object,
    page_map: &HashMap<ObjectId, u32>,
    named: &HashMap<Vec<u8>, Object>,
    depth: usize,
) -> (Option<u32>, Option<Value>) {
    if depth > MAX_DEST_DEPTH {
        return (None, None);
    }
    match dest {
        Object::Reference(id) => match doc.get_object(*id) {
            Ok(object) => decode_dest(doc, object, page_map, named, depth + 1),
            Err(_) => (None, None),
        },
        Object::Array(items) => {
            let page = items
                .first()
                .and_then(|o| o.as_reference().ok())
                .and_then(|id| page_map.get(&id).copied());
            let tail: Vec<Value> = items.iter().skip(1).map(dest_element_json).collect();
            (page, if tail.is_empty() { None } else { Some(json!(tail)) })
        }
        Object::String(key, _) => match named.get(key) {
            Some(target) => decode_dest(doc, target, page_map, named, depth + 1),
            None => (None, Some(json!(String::from_utf8_lossy(key)))),
        },
        Object::Name(name) => match named.get(name) {
            Some(target) => decode_dest(doc, target, page_map, named, depth + 1),
            None => (None, Some(json!(String::from_utf8_lossy(name)))),
        },
        _ => (None, None),
    }
}

/// Walk one sibling chain (`/First` then `/Next` links) at `depth`,
/// appending decoded nodes to the walk and returning the level's items.
/// `scope` is the level's owner; indirect items record their walked
/// parent/sibling links and the scope's first/last child so mutations
/// can repair structure without trusting `/Prev` or `/Last`.
/// Cycle-safe via `visited`; fails closed past the item/depth caps.
#[allow(clippy::too_many_arguments)]
fn walk_level(
    doc: &Document,
    first: &Object,
    depth: usize,
    visited: &mut HashSet<ObjectId>,
    page_map: &HashMap<ObjectId, u32>,
    named: &HashMap<Vec<u8>, Object>,
    walk: &mut OutlineWalk,
    scope: Scope,
) -> Result<Vec<OutlineNode>, EngineError> {
    let mut level = Vec::new();
    let mut level_ids: Vec<ObjectId> = Vec::new();
    let mut current = Some(first.clone());
    while let Some(object) = current {
        if walk.total >= MAX_OUTLINE_ITEMS {
            return Err(EngineError::validation("outline item limit exceeded"));
        }
        if depth > MAX_OUTLINE_DEPTH {
            return Err(EngineError::validation("outline nesting too deep"));
        }
        walk.total += 1;
        let (dict, item_id) = match &object {
            Object::Reference(id) => {
                if !visited.insert(*id) {
                    break; // sibling cycle — stop this level
                }
                match doc.get_object(*id).and_then(Object::as_dict) {
                    Ok(d) => (d, Some(*id)),
                    Err(_) => break, // dangling reference ends the level
                }
            }
            Object::Dictionary(d) => {
                walk.inline = true;
                (d, None)
            }
            _ => break,
        };
        let mut node = OutlineNode {
            id: item_id,
            title: String::new(),
            page: None,
            dest: None,
            children: Vec::new(),
        };
        // /Title may be an indirect string — dereference before decoding.
        if let Ok(title) = dict.get_deref(b"Title", doc) {
            node.title = lopdf::decode_text_string(title).unwrap_or_default();
        }
        let dest = dict.get(b"Dest").ok().or_else(|| {
            dict.get(b"A")
                .ok()
                .and_then(|o| dict_of(doc, o))
                .and_then(|action| action.get(b"D").ok())
        });
        if let Some(dest) = dest {
            let (page, tail) = decode_dest(doc, dest, page_map, named, 0);
            node.page = page;
            node.dest = tail;
        }
        if let Some(id) = item_id {
            walk.by_number.insert(id.0 as u64, id);
            walk.depths.insert(id, depth);
            walk.ids.insert(id);
            level_ids.push(id);
        }
        if let Ok(first_child) = dict.get(b"First") {
            let child_scope = match item_id {
                Some(id) => Scope::Item(id),
                None => Scope::Inline,
            };
            node.children = walk_level(
                doc,
                first_child,
                depth + 1,
                visited,
                page_map,
                named,
                walk,
                child_scope,
            )?;
        }
        level.push(node);
        current = dict.get(b"Next").ok().cloned();
    }
    // Record the scope's walked first/last child and each indirect
    // item's walked siblings — the authoritative structure mutations
    // repair against (raw `/Prev`//`/Last` are never consulted).
    if scope != Scope::Inline {
        if let Some(&first_id) = level_ids.first() {
            walk.scope_first.insert(scope, first_id);
        }
        if let Some(&last_id) = level_ids.last() {
            walk.scope_last.insert(scope, last_id);
        }
        let parent = match scope {
            Scope::Item(id) => Some(id),
            _ => None,
        };
        for (i, id) in level_ids.iter().enumerate() {
            walk.links.insert(
                *id,
                ItemLinks {
                    parent,
                    prev: i.checked_sub(1).and_then(|j| level_ids.get(j)).copied(),
                    next: level_ids.get(i + 1).copied(),
                },
            );
        }
    }
    Ok(level)
}

/// Walk the catalog `/Outlines` tree once. Missing, malformed or empty
/// roots yield an empty walk rather than an error — `listOutlines`
/// reports `[]` and mutations create the root on demand.
fn read_outline_tree(doc: &Document) -> Result<OutlineWalk, EngineError> {
    let mut walk = OutlineWalk {
        tree: Vec::new(),
        by_number: HashMap::new(),
        depths: HashMap::new(),
        ids: HashSet::new(),
        links: HashMap::new(),
        scope_first: HashMap::new(),
        scope_last: HashMap::new(),
        inline: false,
        total: 0,
    };
    let Ok(catalog) = doc.catalog() else {
        return Ok(walk);
    };
    let Ok(outlines) = catalog.get(b"Outlines") else {
        return Ok(walk);
    };
    let Some(root) = dict_of(doc, outlines) else {
        return Ok(walk);
    };
    let Ok(first) = root.get(b"First") else {
        return Ok(walk);
    };
    let page_map = page_index_map(doc);
    let named = named_destinations(doc);
    let mut visited = HashSet::new();
    walk.tree = walk_level(
        doc,
        first,
        0,
        &mut visited,
        &page_map,
        &named,
        &mut walk,
        Scope::Root,
    )?;
    Ok(walk)
}

/// Where the catalog's `/Outlines` entry currently lives.
enum RootAction {
    Missing,
    /// `/Outlines` is an inline dictionary inside the catalog.
    Inline(lopdf::Dictionary),
    /// `/Outlines` is an indirect reference to a dictionary.
    Ref(ObjectId),
    /// Present but neither a dictionary nor a dictionary reference.
    Bad,
}

fn outline_root_action(doc: &Document) -> RootAction {
    let Ok(catalog) = doc.catalog() else {
        return RootAction::Missing;
    };
    match catalog.get(b"Outlines") {
        Err(_) => RootAction::Missing,
        Ok(Object::Reference(id)) => {
            if doc.get_object(*id).and_then(Object::as_dict).is_ok() {
                RootAction::Ref(*id)
            } else {
                RootAction::Bad
            }
        }
        Ok(Object::Dictionary(dict)) => RootAction::Inline(dict.clone()),
        Ok(_) => RootAction::Bad,
    }
}

/// Ensure the catalog `/Outlines` entry is an indirect dictionary and
/// return its object id, creating or normalizing it on `doc` (always a
/// clone about to be committed, never the live document).
fn ensure_outline_root(doc: &mut Document) -> Result<ObjectId, EngineError> {
    match outline_root_action(doc) {
        RootAction::Ref(id) => Ok(id),
        RootAction::Inline(dict) => {
            let id = doc.add_object(Object::Dictionary(dict));
            doc.catalog_mut()
                .map_err(ser_err)?
                .set("Outlines", Object::Reference(id));
            Ok(id)
        }
        RootAction::Missing => {
            let id = doc.add_object(Object::Dictionary(dictionary! {
                "Type" => "Outlines",
            }));
            doc.catalog_mut()
                .map_err(ser_err)?
                .set("Outlines", Object::Reference(id));
            Ok(id)
        }
        RootAction::Bad => Err(EngineError::validation(
            "catalog /Outlines is not a dictionary",
        )),
    }
}

/// Visible-descendant count contributed by the sibling chain starting at
/// `first`: each item contributes 1 plus, when the item is open (its
/// `/Count` is absent or non-negative), its own visible descendants.
/// Records each item's new `/Count` magnitude — signed negative when the
/// item is closed, `None` (remove `/Count`) for leaves — into `counts`.
/// Fails closed on cycles; only called on trees the walk already bounded.
fn chain_visible(
    doc: &Document,
    first: &Object,
    depth: usize,
    visited: &mut HashSet<ObjectId>,
    counts: &mut HashMap<ObjectId, Option<i64>>,
) -> Result<i64, EngineError> {
    if depth > MAX_OUTLINE_DEPTH + 8 {
        return Err(EngineError::validation("outline nesting too deep"));
    }
    let mut total = 0i64;
    let mut current = Some(first.clone());
    while let Some(object) = current {
        let Object::Reference(id) = object else {
            break; // non-indirect entries end the chain (mutations reject them earlier)
        };
        if !visited.insert(id) {
            return Err(EngineError::validation("outline tree contains a cycle"));
        }
        let dict = doc
            .get_object(id)
            .and_then(Object::as_dict)
            .map_err(ser_err)?;
        let closed = matches!(dict.get(b"Count"), Ok(Object::Integer(c)) if *c < 0);
        let child_visible = match dict.get(b"First") {
            Ok(first_child) => chain_visible(doc, first_child, depth + 1, visited, counts)?,
            Err(_) => 0,
        };
        counts.insert(
            id,
            if child_visible == 0 {
                None
            } else {
                Some(if closed { -child_visible } else { child_visible })
            },
        );
        total += 1 + if closed { 0 } else { child_visible };
        current = dict.get(b"Next").ok().cloned();
    }
    Ok(total)
}

/// Recompute every item `/Count` and the root `/Count` (total visible
/// items) for the tree under `root_id`, preserving open/closed signs.
/// Runs on the cloned document before commit.
fn recount_counts(doc: &mut Document, root_id: ObjectId) -> Result<(), EngineError> {
    let root_first = {
        let root = doc
            .get_object(root_id)
            .and_then(Object::as_dict)
            .map_err(ser_err)?;
        root.get(b"First").ok().cloned()
    };
    let mut counts = HashMap::new();
    let mut visited = HashSet::new();
    let total = match &root_first {
        Some(first) => chain_visible(doc, first, 0, &mut visited, &mut counts)?,
        None => 0,
    };
    for (id, value) in counts {
        let dict = doc
            .get_object_mut(id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?;
        match value {
            Some(count) => dict.set("Count", Object::Integer(count)),
            None => {
                dict.remove(b"Count");
            }
        }
    }
    {
        let root = doc
            .get_object_mut(root_id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?;
        // An empty outline omits the root `/Count` rather than writing 0 —
        // `/Count` counts *visible* items and readers treat an absent or
        // zero count identically, but omitting matches how producers
        // serialize an empty `/Outlines` root.
        if total == 0 {
            root.remove(b"Count");
        } else {
            root.set("Count", Object::Integer(total));
        }
    }
    Ok(())
}

/// Collect the object ids of the item `target` and all its descendants
/// (the whole subtree removed with it) — never its `/Next` siblings.
/// Every position must be an indirect dictionary — inline items were
/// rejected by the walk.
fn collect_subtree(
    doc: &Document,
    target: ObjectId,
    remove: &mut BTreeSet<ObjectId>,
) -> Result<(), EngineError> {
    fn chain(
        doc: &Document,
        first: &Object,
        remove: &mut BTreeSet<ObjectId>,
        depth: usize,
    ) -> Result<(), EngineError> {
        if depth > MAX_OUTLINE_DEPTH + 8 {
            return Err(EngineError::validation("outline nesting too deep"));
        }
        let mut current = Some(first.clone());
        while let Some(object) = current {
            let id = match &object {
                Object::Reference(id) => *id,
                Object::Dictionary(_) => {
                    return Err(EngineError::unsupported(
                        "outline tree contains inline item dictionaries",
                    ));
                }
                _ => break,
            };
            if !remove.insert(id) {
                return Err(EngineError::validation("outline tree contains a cycle"));
            }
            let dict = doc
                .get_object(id)
                .and_then(Object::as_dict)
                .map_err(|_| EngineError::validation("outline item reference does not resolve"))?;
            if let Ok(first_child) = dict.get(b"First") {
                chain(doc, first_child, remove, depth + 1)?;
            }
            current = dict.get(b"Next").ok().cloned();
        }
        Ok(())
    }
    remove.insert(target);
    let dict = doc
        .get_object(target)
        .and_then(Object::as_dict)
        .map_err(|_| EngineError::validation("outline item reference does not resolve"))?;
    if let Ok(first_child) = dict.get(b"First") {
        chain(doc, first_child, remove, 1)?;
    }
    Ok(())
}

/// True when any object still references an id in `remove`. Run after
/// unlinking and deletion on the staged clone: a surviving reference
/// means the removal would leave a dangling link, so the op rejects.
fn external_ref_remains(
    doc: &Document,
    remove: &BTreeSet<ObjectId>,
) -> Result<bool, EngineError> {
    let mut work = 0usize;
    for object in doc.objects.values() {
        if comments::references_removed(object, remove, 0, &mut work)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn node_json(node: &OutlineNode) -> Value {
    let mut entry = json!({
        "id": node.id.map(|id| json!(id.0)).unwrap_or(Value::Null),
        "title": node.title,
        "page": node.page,
    });
    if let Some(dest) = &node.dest {
        entry["dest"] = dest.clone();
    }
    entry["children"] = json!(node.children.iter().map(node_json).collect::<Vec<_>>());
    entry
}

impl FolioEngine {
    /// `listOutlines {}` → `{outlines:[{id,title,page,dest?,children}]}`.
    /// Read-only, silent. `id` is the item dictionary's object number
    /// (`null` for inline foreign items); `page` is the 0-based page index
    /// the `/Dest` resolves to, `null` when unresolvable (named dests that
    /// do not decode, remote go-to actions, deleted-page ghosts).
    /// Rejects encrypted documents: every `/Title` is ciphertext.
    pub(super) fn op_list_outlines(&self) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "outline titles are encrypted; decrypt the document first",
            ));
        }
        let walk = read_outline_tree(&self.doc)?;
        Ok(ro(json!({
            "outlines": walk.tree.iter().map(node_json).collect::<Vec<_>>(),
        })))
    }

    /// `addBookmark {title, page, parent?}` → `{ok, id}`. Appends a new
    /// outline item as the last child of `parent` (an existing item id)
    /// or at the top level when `parent` is absent. `page` is the
    /// 0-based page index the `/Dest [page /Fit]` targets. `id` is the new
    /// item dictionary's object number — stable for `removeBookmark`.
    pub(super) fn op_add_bookmark(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "outline mutation is not supported on encrypted documents; decrypt first",
            ));
        }
        let title = req_str(p, "title")?;
        if title.trim().is_empty() {
            return Err(EngineError::validation("'title' must be non-empty"));
        }
        if title.encode_utf16().count() > MAX_TITLE_UTF16 {
            return Err(EngineError::validation(format!(
                "'title' must be at most {MAX_TITLE_UTF16} UTF-16 code units"
            )));
        }
        let page_id = self.page_id(req_u64(p, "page")?)?;
        let parent_number = match p.get("parent") {
            None | Some(Value::Null) => None,
            Some(v) => Some(v.as_u64().ok_or_else(|| {
                EngineError::invalid("'parent' must be a non-negative integer")
            })?),
        };
        // Validate the whole request against the committed document before
        // journaling or creating objects: tree walk (inline items, caps),
        // parent existence and the depth the new item would land at.
        let walk = read_outline_tree(&self.doc)?;
        if walk.inline {
            return Err(EngineError::unsupported(
                "outline tree contains inline item dictionaries",
            ));
        }
        if walk.total >= MAX_OUTLINE_ITEMS {
            return Err(EngineError::validation("outline item limit exceeded"));
        }
        let parent_id = match parent_number {
            None => None,
            Some(raw) => {
                let id = *walk
                    .by_number
                    .get(&raw)
                    .ok_or_else(|| EngineError::not_found("outline item not found"))?;
                if walk.depths[&id] + 1 > MAX_OUTLINE_DEPTH {
                    return Err(EngineError::validation(
                        "outline nesting depth limit exceeded",
                    ));
                }
                Some(id)
            }
        };

        let mut next = self.doc.clone();
        let root_id = ensure_outline_root(&mut next)?;
        let scope_id = parent_id.unwrap_or(root_id);
        let scope_key = match parent_id {
            None => Scope::Root,
            Some(id) => Scope::Item(id),
        };
        // The append point is the scope's last *walked* child — the raw
        // `/Last` backlink is never traversed and may be missing, stale
        // or forged, so it plays no part in the decision.
        let last = walk.scope_last.get(&scope_key).copied();
        if last.is_none() {
            // The walk saw this scope as empty, so `/First`→`/Next`
            // reaches nothing. A `/Last` (or inline-dict) pointer could
            // still hide a chain readers never traverse; appending would
            // overwrite `/First`//`/Last` and orphan it, so reject.
            let scope = next
                .get_object(scope_id)
                .and_then(Object::as_dict)
                .map_err(ser_err)?;
            let hidden = scope
                .get(b"Last")
                .map(|o| matches!(o, Object::Reference(_) | Object::Dictionary(_)))
                .unwrap_or(false);
            if hidden {
                return Err(EngineError::validation(
                    "outline scope has an unreachable /Last chain",
                ));
            }
        }
        let mut item = dictionary! {
            "Title" => lopdf::text_string(title),
            "Parent" => scope_id,
            "Dest" => vec![
                Object::Reference(page_id),
                Object::Name(b"Fit".to_vec()),
            ],
        };
        if let Some(last_id) = last {
            item.set("Prev", Object::Reference(last_id));
        }
        let item_id = next.add_object(Object::Dictionary(item));
        if let Some(last_id) = last {
            next.get_object_mut(last_id)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?
                .set("Next", Object::Reference(item_id));
        }
        {
            let scope = next
                .get_object_mut(scope_id)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?;
            if last.is_none() {
                scope.set("First", Object::Reference(item_id));
            }
            scope.set("Last", Object::Reference(item_id));
        }
        recount_counts(&mut next, root_id)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({ "ok": true, "id": item_id.0 })))
    }

    /// `removeBookmark {id}` → `{ok}`. Removes the outline item `id` and
    /// its whole descendant subtree: neighbour `/Next`//`/Prev` and scope
    /// `/First`//`/Last` links are repaired from the walked `/First`→`/Next`
    /// order (raw `/Prev`/`/Last` backlinks are never trusted), `/Count`s
    /// recomputed, the objects deleted and every trailer-unreachable
    /// object pruned — including orphans that pre-date the op.
    /// Rejects when a surviving object still references the removed set
    /// (dangling-link guard), when the staged re-walk loses any
    /// previously reachable item, when the tree holds inline items, or
    /// when `id` is unknown.
    pub(super) fn op_remove_bookmark(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "outline mutation is not supported on encrypted documents; decrypt first",
            ));
        }
        let raw = req_u64(p, "id")?;
        let walk = read_outline_tree(&self.doc)?;
        if walk.inline {
            return Err(EngineError::unsupported(
                "outline tree contains inline item dictionaries",
            ));
        }
        let target_id = *walk
            .by_number
            .get(&raw)
            .ok_or_else(|| EngineError::not_found("outline item not found"))?;
        let mut remove = BTreeSet::new();
        collect_subtree(&self.doc, target_id, &mut remove)?;

        let mut next = self.doc.clone();
        let root_id = ensure_outline_root(&mut next)?;
        // Siblings, parent scope and edge position all come from the
        // walked `/First`→`/Next` order recorded in `walk.links` — the
        // item's raw `/Prev`//`/Next`//`/Parent` are never consulted, so
        // forged backlinks cannot redirect a rewrite into an unrelated
        // object or orphan a sibling subtree.
        let links = walk.links.get(&target_id).copied().ok_or_else(|| {
            EngineError::validation("outline item is not part of the walked tree")
        })?;
        let scope_key = links.parent.map_or(Scope::Root, Scope::Item);
        let scope_id = links.parent.unwrap_or(root_id);
        let prev_sib = links.prev;
        let next_sib = links.next;
        // Repair the neighbours' mutual links and re-stamp their
        // `/Parent` with the walked scope (a forged `/Parent` on an edge
        // sibling would otherwise dangle once the target is deleted).
        if let Some(prev) = prev_sib {
            let dict = next
                .get_object_mut(prev)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?;
            match next_sib {
                Some(following) => dict.set("Next", Object::Reference(following)),
                None => {
                    dict.remove(b"Next");
                }
            }
            dict.set("Parent", Object::Reference(scope_id));
        }
        if let Some(following) = next_sib {
            let dict = next
                .get_object_mut(following)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?;
            match prev_sib {
                Some(prev) => dict.set("Prev", Object::Reference(prev)),
                None => {
                    dict.remove(b"Prev");
                }
            }
            dict.set("Parent", Object::Reference(scope_id));
        }
        // Rewrite the scope's `/First`//`/Last` from walked truth — not
        // only when the target sat on an edge. A stale `/Last` pointing
        // at the removed item would otherwise dangle, and a stale `/Last`
        // pointing anywhere else is corrected for free.
        let walked_first = walk.scope_first.get(&scope_key).copied();
        let walked_last = walk.scope_last.get(&scope_key).copied();
        let new_first = if walked_first == Some(target_id) {
            next_sib
        } else {
            walked_first
        };
        let new_last = if walked_last == Some(target_id) {
            prev_sib
        } else {
            walked_last
        };
        {
            let dict = next
                .get_object_mut(scope_id)
                .and_then(Object::as_dict_mut)
                .map_err(ser_err)?;
            match new_first {
                Some(first) => dict.set("First", Object::Reference(first)),
                None => {
                    dict.remove(b"First");
                }
            }
            match new_last {
                Some(last) => dict.set("Last", Object::Reference(last)),
                None => {
                    dict.remove(b"Last");
                }
            }
        }
        for id in &remove {
            next.objects.remove(id);
        }
        // Dangling-link guard: any surviving reference into the removed
        // set (an /OpenAction, a named destination, a stray /Next we did
        // not own) rejects the whole op before commit.
        if external_ref_remains(&next, &remove)? {
            return Err(EngineError::unsupported(
                "external reference prevents outline removal",
            ));
        }
        recount_counts(&mut next, root_id)?;
        // Postcondition: re-walk the staged tree and require every
        // previously reachable item id to survive except the intended
        // removal set — catches any repair that orphaned a subtree.
        let after = read_outline_tree(&next)?;
        let expected: HashSet<ObjectId> = walk
            .ids
            .iter()
            .filter(|id| !remove.contains(*id))
            .copied()
            .collect();
        if after.ids != expected {
            return Err(EngineError::validation(
                "outline repair would orphan reachable items",
            ));
        }
        page_ops::prune_unreachable(&mut next);
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({ "ok": true })))
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

    fn outlines(e: &mut FolioEngine) -> Value {
        apply(e, "listOutlines", json!({}))["outlines"].clone()
    }

    #[test]
    fn add_and_list_nested_outlines() {
        let mut e = engine(3);
        assert_eq!(outlines(&mut e), json!([]));
        let a = apply(
            &mut e,
            "addBookmark",
            json!({ "title": "Chapter 1", "page": 0 }),
        )["id"]
            .as_u64()
            .unwrap();
        let b = apply(
            &mut e,
            "addBookmark",
            json!({ "title": "Section 1.1", "page": 1, "parent": a }),
        )["id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addBookmark",
            json!({ "title": "Section 1.2", "page": 2, "parent": a }),
        );
        apply(
            &mut e,
            "addBookmark",
            json!({ "title": "Chapter 2", "page": 2 }),
        );
        let tree = outlines(&mut e);
        assert_eq!(tree.as_array().unwrap().len(), 2);
        let first = &tree[0];
        assert_eq!(first["title"], "Chapter 1");
        assert_eq!(first["id"], a);
        assert_eq!(first["page"], 0);
        let kids = first["children"].as_array().unwrap();
        assert_eq!(kids.len(), 2);
        assert_eq!(kids[0]["title"], "Section 1.1");
        assert_eq!(kids[0]["id"], b);
        assert_eq!(kids[0]["page"], 1);
        assert_eq!(kids[1]["title"], "Section 1.2");
        assert_eq!(tree[1]["title"], "Chapter 2");
        // The outline root /Count equals the total visible item count.
        let walk = read_outline_tree(&e.doc).unwrap();
        assert_eq!(walk.total, 4);
        let RootAction::Ref(root_id) = outline_root_action(&e.doc) else {
            panic!("expected indirect outline root")
        };
        let count = e
            .doc
            .get_object(root_id)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Count")
            .unwrap()
            .as_i64()
            .unwrap();
        assert_eq!(count, 4);
        // The parent item carries /Count = its visible descendants.
        let parent_count = e
            .doc
            .get_object((a as u32, 0))
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Count")
            .unwrap()
            .as_i64()
            .unwrap();
        assert_eq!(parent_count, 2);
    }

    #[test]
    fn outlines_survive_save_open_and_page_moves() {
        let mut e = engine(3);
        apply(&mut e, "addBookmark", json!({ "title": "First", "page": 0 }));
        apply(&mut e, "addBookmark", json!({ "title": "Second", "page": 2 }));
        // movePage keeps object ids: the bookmark to old page 0 now
        // reports index 2, old page 2 reports index 1.
        apply(&mut e, "movePage", json!({ "from": 0, "to": 2 }));
        let tree = outlines(&mut e);
        assert_eq!(tree[0]["page"], 2);
        assert_eq!(tree[1]["page"], 1);
        // Round-trip through real PDF bytes.
        let b64 = saved_b64(&mut e);
        let mut e2 = reopen(&b64);
        let tree2 = outlines(&mut e2);
        assert_eq!(tree2[0]["title"], "First");
        assert_eq!(tree2[0]["page"], 2);
        assert_eq!(tree2[1]["title"], "Second");
        assert_eq!(tree2[1]["page"], 1);
        // The saved ids still resolve for removal after reopen.
        let id = tree2[0]["id"].as_u64().unwrap();
        apply(&mut e2, "removeBookmark", json!({ "id": id }));
        let tree3 = outlines(&mut e2);
        assert_eq!(tree3.as_array().unwrap().len(), 1);
        assert_eq!(tree3[0]["title"], "Second");
    }

    #[test]
    fn remove_bookmark_drops_subtree_and_repairs_links() {
        let mut e = engine(2);
        let a = apply(&mut e, "addBookmark", json!({ "title": "A", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addBookmark",
            json!({ "title": "A.1", "page": 0, "parent": a }),
        );
        apply(
            &mut e,
            "addBookmark",
            json!({ "title": "A.2", "page": 1, "parent": a }),
        );
        let b = apply(&mut e, "addBookmark", json!({ "title": "B", "page": 1 }))["id"]
            .as_u64()
            .unwrap();
        // Removing A removes A.1/A.2 with it; B becomes the only top-level.
        apply(&mut e, "removeBookmark", json!({ "id": a }));
        let tree = outlines(&mut e);
        assert_eq!(tree.as_array().unwrap().len(), 1);
        assert_eq!(tree[0]["title"], "B");
        assert_eq!(tree[0]["id"], b);
        // Root and B's links are consistent: B has no Prev/Next.
        let walk = read_outline_tree(&e.doc).unwrap();
        assert_eq!(walk.total, 1);
        // Unknown ids and wrong types reject.
        let err = apply_err(&mut e, "removeBookmark", json!({ "id": a }));
        assert!(matches!(err.code, ignition_core::ErrorCode::NotFound));
        let err = apply_err(&mut e, "removeBookmark", json!({ "id": "x" }));
        assert!(matches!(err.code, ignition_core::ErrorCode::InvalidCommand));
        // Removing the last item leaves an empty (but valid) tree.
        apply(&mut e, "removeBookmark", json!({ "id": b }));
        assert_eq!(outlines(&mut e), json!([]));
        let b64 = saved_b64(&mut e);
        let mut e2 = reopen(&b64);
        assert_eq!(outlines(&mut e2), json!([]));
    }

    #[test]
    fn undo_redo_restores_outline_tree() {
        let mut e = engine(2);
        let before = outlines(&mut e);
        assert_eq!(before, json!([]));
        apply(&mut e, "addBookmark", json!({ "title": "Keep", "page": 0 }));
        apply(
            &mut e,
            "addBookmark",
            json!({ "title": "Drop", "page": 1 }),
        );
        assert_eq!(outlines(&mut e).as_array().unwrap().len(), 2);
        assert!(e.undo().unwrap());
        assert_eq!(outlines(&mut e).as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(outlines(&mut e), json!([]));
        assert!(e.redo().unwrap());
        assert_eq!(outlines(&mut e).as_array().unwrap().len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(outlines(&mut e).as_array().unwrap().len(), 2);
    }

    #[test]
    fn add_bookmark_validates_payload() {
        let mut e = engine(2);
        for p in [
            json!({ "title": "", "page": 0 }),
            json!({ "title": "   ", "page": 0 }),
            json!({ "title": "x".repeat(2049), "page": 0 }),
            json!({ "title": "ok", "page": 5 }),
            json!({ "title": "ok", "page": 0, "parent": 999 }),
            json!({ "title": "ok", "page": 0, "parent": -1 }),
            json!({ "page": 0 }),
            json!({ "title": "ok" }),
        ] {
            assert!(
                e.apply(Command::new("addBookmark", p)).is_err(),
                "payload should reject"
            );
        }
        assert_eq!(outlines(&mut e), json!([]));
        // Non-ASCII titles round-trip through PDF text strings.
        let id = apply(
            &mut e,
            "addBookmark",
            json!({ "title": "Chapitre élan 😀", "page": 1 }),
        )["id"]
            .as_u64()
            .unwrap();
        let tree = outlines(&mut e);
        assert_eq!(tree[0]["title"], "Chapitre élan 😀");
        assert_eq!(tree[0]["page"], 1);
        let b64 = saved_b64(&mut e);
        let mut e2 = reopen(&b64);
        assert_eq!(outlines(&mut e2)[0]["title"], "Chapitre élan 😀");
        apply(&mut e2, "removeBookmark", json!({ "id": id }));
        assert_eq!(outlines(&mut e2), json!([]));
    }

    #[test]
    fn outline_depth_is_bounded() {
        let mut e = engine(1);
        let mut parent: Option<u64> = None;
        // Nest until the depth cap rejects.
        let mut added = 0usize;
        for _ in 0..(MAX_OUTLINE_DEPTH + 4) {
            let mut payload = json!({ "title": "n", "page": 0 });
            if let Some(p) = parent {
                payload["parent"] = json!(p);
            }
            match e.apply(Command::new("addBookmark", payload)) {
                Ok(r) => {
                    parent = Some(r.data["id"].as_u64().unwrap());
                    added += 1;
                }
                Err(err) => {
                    assert!(matches!(
                        err.code,
                        ignition_core::ErrorCode::Validation
                    ));
                    break;
                }
            }
        }
        assert!(added <= MAX_OUTLINE_DEPTH + 1, "added {added}");
        assert!(added >= MAX_OUTLINE_DEPTH, "added {added}");
    }

    #[test]
    fn encrypted_documents_reject_outline_ops() {
        let mut e = engine(1);
        apply(&mut e, "addBookmark", json!({ "title": "Top", "page": 0 }));
        let id = outlines(&mut e)[0]["id"].as_u64().unwrap();
        apply(
            &mut e,
            "encrypt",
            json!({ "password": "pw", "permissions": ["print"] }),
        );
        for (op, p) in [
            ("listOutlines", json!({})),
            ("addBookmark", json!({ "title": "x", "page": 0 })),
            ("removeBookmark", json!({ "id": id })),
        ] {
            let err = apply_err(&mut e, op, p);
            assert!(
                matches!(err.code, ignition_core::ErrorCode::Unsupported),
                "{op} -> {err:?}"
            );
        }
        // decrypt restores full outline functionality.
        apply(&mut e, "decrypt", json!({ "password": "pw" }));
        assert_eq!(outlines(&mut e)[0]["title"], "Top");
        apply(&mut e, "removeBookmark", json!({ "id": id }));
        assert_eq!(outlines(&mut e), json!([]));
    }

    #[test]
    fn delete_bookmarked_page_leaves_dangling_dest_documented() {
        let mut e = engine(2);
        apply(&mut e, "addBookmark", json!({ "title": "Gone", "page": 0 }));
        apply(&mut e, "deletePage", json!({ "page": 0 }));
        let tree = outlines(&mut e);
        assert_eq!(tree.as_array().unwrap().len(), 1);
        assert_eq!(tree[0]["title"], "Gone");
        // The deleted page object survives as a ghost kept alive by the
        // outline /Dest; it no longer resolves to a page index.
        assert_eq!(tree[0]["page"], Value::Null);
        // And the outline itself is still removable.
        let id = tree[0]["id"].as_u64().unwrap();
        apply(&mut e, "removeBookmark", json!({ "id": id }));
        assert_eq!(outlines(&mut e), json!([]));
    }

    #[test]
    fn hostile_cycle_and_inline_items_are_contained() {
        let mut e = engine(1);
        let a = apply(&mut e, "addBookmark", json!({ "title": "A", "page": 0 }))["id"]
            .as_u64()
            .unwrap() as u32;
        let b = apply(&mut e, "addBookmark", json!({ "title": "B", "page": 0 }))["id"]
            .as_u64()
            .unwrap() as u32;
        // Forge a /Next cycle between the two items directly in the doc.
        {
            let da = e.doc.get_object_mut((a, 0)).unwrap();
            da.as_dict_mut()
                .unwrap()
                .set("Next", Object::Reference((b, 0)));
            let db = e.doc.get_object_mut((b, 0)).unwrap();
            db.as_dict_mut()
                .unwrap()
                .set("Next", Object::Reference((a, 0)));
        }
        // listOutlines must terminate (visited-set break) — returns both.
        let tree = outlines(&mut e);
        assert_eq!(tree.as_array().unwrap().len(), 2);
        // Mutations on the cyclic tree fail closed — B's forged /Next
        // still references the removed item, so the dangling-link guard
        // rejects with Unsupported and state stays intact.
        let err = apply_err(&mut e, "removeBookmark", json!({ "id": a }));
        assert!(matches!(
            err.code,
            ignition_core::ErrorCode::Unsupported
        ));
        assert_eq!(outlines(&mut e).as_array().unwrap().len(), 2);

        // Inline (non-indirect) item: list reports id null, mutations reject.
        let mut e2 = engine(1);
        let inline = dictionary! {
            "Title" => lopdf::text_string("Inline"),
        };
        let root_id = ensure_outline_root(&mut e2.doc).unwrap();
        e2.doc
            .get_object_mut(root_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("First", Object::Dictionary(inline));
        let tree = outlines(&mut e2);
        assert_eq!(tree[0]["id"], Value::Null);
        assert_eq!(tree[0]["title"], "Inline");
        let err = apply_err(
            &mut e2,
            "addBookmark",
            json!({ "title": "x", "page": 0 }),
        );
        assert!(matches!(err.code, ignition_core::ErrorCode::Unsupported));
        let err = apply_err(&mut e2, "removeBookmark", json!({ "id": 1 }));
        assert!(matches!(err.code, ignition_core::ErrorCode::Unsupported));
    }

    /// Object number (`.0`) of the catalog `/Outlines` root.
    fn root_num(e: &FolioEngine) -> u64 {
        let RootAction::Ref(id) = outline_root_action(&e.doc) else {
            panic!("expected indirect outline root")
        };
        id.0 as u64
    }

    fn root_dict(e: &mut FolioEngine) -> lopdf::Dictionary {
        e.doc
            .get_object((root_num(e) as u32, 0))
            .unwrap()
            .as_dict()
            .unwrap()
            .clone()
    }

    fn set_root(e: &mut FolioEngine, key: &str, value: Object) {
        e.doc
            .get_object_mut((root_num(e) as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(key, value);
    }

    fn item_dict(e: &mut FolioEngine, num: u64) -> lopdf::Dictionary {
        e.doc
            .get_object((num as u32, 0))
            .unwrap()
            .as_dict()
            .unwrap()
            .clone()
    }

    fn set_item(e: &mut FolioEngine, num: u64, key: &str, value: Object) {
        e.doc
            .get_object_mut((num as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(key, value);
    }

    fn ref_of(dict: &lopdf::Dictionary, key: &str) -> Option<u64> {
        dict.get(key.as_bytes())
            .ok()
            .and_then(|o| o.as_reference().ok())
            .map(|id| id.0 as u64)
    }

    #[test]
    fn add_bookmark_uses_walked_last_not_untrusted_last() {
        let mut e = engine(1);
        let a = apply(&mut e, "addBookmark", json!({ "title": "A", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        let b = apply(&mut e, "addBookmark", json!({ "title": "B", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        // Stale /Last pointing at the first item: the append must still
        // land after the walked last child (B) and rewrite /Last.
        set_root(&mut e, "Last", Object::Reference((a as u32, 0)));
        let c = apply(&mut e, "addBookmark", json!({ "title": "C", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        let tree = outlines(&mut e);
        let titles: Vec<&str> = tree
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["title"].as_str().unwrap())
            .collect();
        assert_eq!(titles, ["A", "B", "C"]);
        let root = root_dict(&mut e);
        assert_eq!(ref_of(&root, "Last"), Some(c));
        assert_eq!(ref_of(&item_dict(&mut e, b), "Next"), Some(c));
        assert_eq!(ref_of(&item_dict(&mut e, c), "Prev"), Some(b));
        // Missing /Last: same correct append, /Last rewritten.
        e.doc
            .get_object_mut((root_num(&e) as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .remove(b"Last");
        let d = apply(&mut e, "addBookmark", json!({ "title": "D", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        assert_eq!(outlines(&mut e).as_array().unwrap().len(), 4);
        assert_eq!(ref_of(&root_dict(&mut e), "Last"), Some(d));
        // Wrong-type /Last (not a reference): ignored and rewritten.
        set_root(&mut e, "Last", Object::Integer(7));
        apply(&mut e, "addBookmark", json!({ "title": "E", "page": 0 }));
        let tree = outlines(&mut e);
        assert_eq!(tree.as_array().unwrap().len(), 5);
        let root = root_dict(&mut e);
        assert!(ref_of(&root, "Last").is_some());
    }

    #[test]
    fn add_bookmark_rejects_hidden_last_chain_on_empty_scope() {
        let mut e = engine(1);
        // Orphan item reachable only through the root's untrusted /Last.
        let orphan = e
            .doc
            .add_object(Object::Dictionary(dictionary! {
                "Title" => lopdf::text_string("Hidden"),
            }));
        let root_id = ensure_outline_root(&mut e.doc).unwrap();
        e.doc
            .get_object_mut(root_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Last", Object::Reference(orphan));
        let err = apply_err(
            &mut e,
            "addBookmark",
            json!({ "title": "x", "page": 0 }),
        );
        assert!(matches!(err.code, ignition_core::ErrorCode::Validation));
        assert_eq!(outlines(&mut e), json!([]));
        // Same guard on a nested scope: parent with /Last but no /First.
        let mut e2 = engine(1);
        let p = apply(&mut e2, "addBookmark", json!({ "title": "P", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        let orphan2 = e2
            .doc
            .add_object(Object::Dictionary(dictionary! {
                "Title" => lopdf::text_string("Hidden"),
            }));
        set_item(&mut e2, p, "Last", Object::Reference(orphan2));
        let err = apply_err(
            &mut e2,
            "addBookmark",
            json!({ "title": "x", "page": 0, "parent": p }),
        );
        assert!(matches!(err.code, ignition_core::ErrorCode::Validation));
    }

    #[test]
    fn remove_bookmark_ignores_forged_prev_and_next() {
        let mut e = engine(1);
        let x = apply(&mut e, "addBookmark", json!({ "title": "X", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        let y = apply(&mut e, "addBookmark", json!({ "title": "Y", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        let s = apply(&mut e, "addBookmark", json!({ "title": "S", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        // Forge S's backlinks: /Prev claims X (skipping Y) and /Next
        // claims Y (a backward edge). Walked truth is Y→S.
        set_item(&mut e, s, "Prev", Object::Reference((x as u32, 0)));
        set_item(&mut e, s, "Next", Object::Reference((y as u32, 0)));
        apply(&mut e, "removeBookmark", json!({ "id": s }));
        let tree = outlines(&mut e);
        let titles: Vec<&str> = tree
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["title"].as_str().unwrap())
            .collect();
        // Y must survive — the forged /Prev must not cause X's /Next to
        // be deleted (which would orphan Y).
        assert_eq!(titles, ["X", "Y"]);
        let x_dict = item_dict(&mut e, x);
        assert_eq!(ref_of(&x_dict, "Next"), Some(y));
        let y_dict = item_dict(&mut e, y);
        assert_eq!(ref_of(&y_dict, "Prev"), Some(x));
        assert_eq!(ref_of(&y_dict, "Next"), None);
        assert_eq!(ref_of(&root_dict(&mut e), "Last"), Some(y));
    }

    #[test]
    fn remove_bookmark_first_middle_last_and_nested() {
        let mut e = engine(2);
        let p = apply(&mut e, "addBookmark", json!({ "title": "P", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        let c1 = apply(
            &mut e,
            "addBookmark",
            json!({ "title": "C1", "page": 0, "parent": p }),
        )["id"]
            .as_u64()
            .unwrap();
        let c2 = apply(
            &mut e,
            "addBookmark",
            json!({ "title": "C2", "page": 1, "parent": p }),
        )["id"]
            .as_u64()
            .unwrap();
        let c3 = apply(
            &mut e,
            "addBookmark",
            json!({ "title": "C3", "page": 1, "parent": p }),
        )["id"]
            .as_u64()
            .unwrap();
        // Remove the middle child.
        apply(&mut e, "removeBookmark", json!({ "id": c2 }));
        let kids = outlines(&mut e)[0]["children"].as_array().unwrap().clone();
        assert_eq!(kids.len(), 2);
        assert_eq!(kids[0]["title"], "C1");
        assert_eq!(kids[1]["title"], "C3");
        assert_eq!(ref_of(&item_dict(&mut e, c1), "Next"), Some(c3));
        assert_eq!(ref_of(&item_dict(&mut e, c3), "Prev"), Some(c1));
        // Remove the first child.
        apply(&mut e, "removeBookmark", json!({ "id": c1 }));
        let p_dict = item_dict(&mut e, p);
        assert_eq!(ref_of(&p_dict, "First"), Some(c3));
        assert_eq!(ref_of(&item_dict(&mut e, c3), "Prev"), None);
        // Remove the last child — scope keeps no child pointers.
        apply(&mut e, "removeBookmark", json!({ "id": c3 }));
        let p_dict = item_dict(&mut e, p);
        assert_eq!(ref_of(&p_dict, "First"), None);
        assert_eq!(ref_of(&p_dict, "Last"), None);
        // Removing the parent leaves the tree empty and consistent.
        apply(&mut e, "removeBookmark", json!({ "id": p }));
        assert_eq!(outlines(&mut e), json!([]));
        let root = root_dict(&mut e);
        assert_eq!(ref_of(&root, "First"), None);
        assert_eq!(ref_of(&root, "Last"), None);
        assert!(root.get(b"Count").is_err(), "empty root omits /Count");
    }

    #[test]
    fn closed_items_keep_negative_count_through_mutations() {
        let mut e = engine(1);
        let p = apply(&mut e, "addBookmark", json!({ "title": "P", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addBookmark",
            json!({ "title": "C1", "page": 0, "parent": p }),
        );
        // Mark P closed, then add another child: recount preserves the
        // negative sign and magnitudes the *visible* descendant count.
        set_item(&mut e, p, "Count", Object::Integer(-1));
        apply(
            &mut e,
            "addBookmark",
            json!({ "title": "C2", "page": 0, "parent": p }),
        );
        let count = item_dict(&mut e, p)
            .get(b"Count")
            .unwrap()
            .as_i64()
            .unwrap();
        assert_eq!(count, -2);
        // The root /Count counts only visible items: closed P contributes
        // itself but hides its two children → total 1.
        let root = root_dict(&mut e);
        assert_eq!(root.get(b"Count").unwrap().as_i64().unwrap(), 1);
    }

    #[test]
    fn action_go_to_dests_list_and_remove() {
        let mut e = engine(2);
        let a = apply(&mut e, "addBookmark", json!({ "title": "A", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        let b = apply(&mut e, "addBookmark", json!({ "title": "B", "page": 1 }))["id"]
            .as_u64()
            .unwrap();
        // Rewrite A's /Dest as an /A << /S /GoTo /D […] >> action —
        // listOutlines must resolve it identically.
        let page0 = e
            .doc
            .get_pages()
            .into_iter()
            .find(|(n, _)| *n == 1)
            .map(|(_, id)| id)
            .unwrap();
        let action = dictionary! {
            "S" => "GoTo",
            "D" => vec![Object::Reference(page0), Object::Name(b"Fit".to_vec())],
        };
        {
            let dict = e
                .doc
                .get_object_mut((a as u32, 0))
                .unwrap()
                .as_dict_mut()
                .unwrap();
            dict.remove(b"Dest");
            dict.set("A", Object::Dictionary(action));
        }
        let tree = outlines(&mut e);
        assert_eq!(tree[0]["page"], 0);
        assert_eq!(tree[0]["dest"], json!(["Fit"]));
        assert_eq!(tree[1]["page"], 1);
        // Mixed removal: the /A-carrying item and a /Dest item both go.
        apply(&mut e, "removeBookmark", json!({ "id": a }));
        let tree = outlines(&mut e);
        assert_eq!(tree.as_array().unwrap().len(), 1);
        assert_eq!(tree[0]["id"], b);
        apply(&mut e, "removeBookmark", json!({ "id": b }));
        assert_eq!(outlines(&mut e), json!([]));
    }

    #[test]
    fn unresolved_named_dest_reports_bare_string() {
        let mut e = engine(1);
        let a = apply(&mut e, "addBookmark", json!({ "title": "A", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        // Point /Dest at a named destination that does not exist: the
        // engine emits the unresolved name as a bare JSON string.
        set_item(
            &mut e,
            a,
            "Dest",
            Object::String(b"NoSuchDest".to_vec(), lopdf::StringFormat::Literal),
        );
        let tree = outlines(&mut e);
        assert_eq!(tree[0]["page"], Value::Null);
        assert_eq!(tree[0]["dest"], json!("NoSuchDest"));
    }

    #[test]
    fn indirect_title_strings_decode() {
        let mut e = engine(1);
        let a = apply(&mut e, "addBookmark", json!({ "title": "Direct", "page": 0 }))["id"]
            .as_u64()
            .unwrap();
        // Replace /Title with an indirect reference to a string object.
        let sid = e.doc.add_object(Object::String(
            b"Indirect Title".to_vec(),
            lopdf::StringFormat::Literal,
        ));
        set_item(&mut e, a, "Title", Object::Reference(sid));
        assert_eq!(outlines(&mut e)[0]["title"], "Indirect Title");
        // And it survives a save → open round-trip.
        let b64 = saved_b64(&mut e);
        let mut e2 = reopen(&b64);
        assert_eq!(outlines(&mut e2)[0]["title"], "Indirect Title");
    }
}
