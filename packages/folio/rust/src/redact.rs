//! Structural redaction: `redactRect {page, rect}` (P15 Slice E / F-9).
//!
//! What this op honestly removes, all in default PDF user space (the same
//! space `addAnnotation` rects and `listPageInfo` mediaboxes use):
//!
//! - **Annotations** whose `/Rect` intersects `rect` (closed intersection —
//!   touching edges count). Reply/state descendants linked through `/IRT`
//!   and `/Popup` targets of removed annotations are removed with their
//!   primary. Annots without a decodable `/Rect` are retained (the engine
//!   cannot prove they intersect). Inline (non-indirect) annotation
//!   dictionaries are dropped from the `/Annots` array but have no object
//!   to delete. Removal fails closed: if anything outside the page's
//!   `/Annots` still references a removed annotation (a form field's
//!   `/AcroForm` entry, another page, an orphan `/Popup` chain), the whole
//!   op rejects rather than leaving dangling references.
//! - **Image XObjects** whose EVERY placement on the page is fully
//!   contained in `rect`. Placement is proven from the content stream:
//!   `q`/`Q`/`cm` graphics-state tracking resolves each `/ImN Do` through
//!   the effective `/Resources` (inherited through `/Parent`), the image's
//!   `/Matrix` and the accumulated CTM to a bounding box in default user
//!   space. An image is removed only when all of its placements are direct
//!   page-content `Do` ops inside `rect`; any placement that extends
//!   outside the rect (partial overlap included), any placement inside a
//!   form XObject (form streams may be shared and are never rewritten),
//!   any placement in a content stream shared with another page, or an
//!   image that is never drawn all retain the image. Removal deletes the
//!   `Do` operations (the stream is re-encoded unfiltered) and the
//!   `/XObject` resource entry — but only when the resource chain is
//!   provably exclusive to this page; otherwise the draws are still
//!   removed while the object stays reachable, reported separately as
//!   `image_draws_removed`. Text operators and vector path-painting ops
//!   are NEVER touched.
//! - **Document metadata**: `/PieceInfo` and `/Metadata` (XMP) on every
//!   page and the catalog, and the trailer `/Info` dictionary reference.
//!   Scrubbing is document-wide, not page-scoped.
//!
//! What is NOT removed — the honesty contract:
//!
//! - **Text and vector content under the rect is NOT provable.** lopdf
//!   exposes no glyph positions, so `Tj`/`TJ` strings and path painting
//!   ops cannot be located spatially. They remain byte-identical in the
//!   content stream. Hosts must render/verify redaction visually (the
//!   deferred `folio-render` pdfium service) or reject this op for
//!   text-bearing redaction.
//! - `/Rotate` does not transform the comparison: annotation `/Rect`s and
//!   content-stream coordinates already live in unrotated default user
//!   space, so a redaction rect is interpreted the same way on rotated
//!   pages. `MediaBox` origin offsets need no normalization (all
//!   coordinates share one space). `/UserUnit` is ignored — it scales
//!   device output only, never user-space coordinates.
//! - Encrypted documents reject with Unsupported (consistent with every
//!   other structural folio op): ciphertext is keyed by object id and the
//!   whole-document journal would restore inconsistent state. `decrypt`
//!   first.
//! - Undo restores the entire pre-redaction `lopdf::Document` — that is
//!   the engine contract. Hosts MUST warn users that undo resurrects the
//!   redacted content; in-engine redaction is not a security boundary.
use super::*;
use lopdf::content::Operation;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// Cap on `/Annots` entries inspected on the redacted page.
const MAX_REDACT_ANNOTS: usize = 10_000;
/// Cap on total content operations decoded across streams and forms.
const MAX_CONTENT_OPS: usize = 300_000;
/// Form XObject recursion depth and visit caps.
const MAX_FORM_DEPTH: usize = 8;
const MAX_FORMS: usize = 1_000;
/// Cap on reported id/reason lists; counts stay exact.
const MAX_LISTED: usize = 256;

// ---------------------------------------------------------------------------
// Geometry (default user space, f64)
// ---------------------------------------------------------------------------

/// PDF matrix `[a b c d e f]` as a 3x3 with column-vector convention:
/// `p' = M × p`. `cm` concatenates as `CTM × M` (the new matrix applies in
/// the current user space); image `/Matrix` and form `/Matrix` compose the
/// same way.
#[derive(Clone, Copy)]
struct Matrix {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}

const IDENTITY: Matrix = Matrix {
    a: 1.0,
    b: 0.0,
    c: 0.0,
    d: 1.0,
    e: 0.0,
    f: 0.0,
};

impl Matrix {
    /// `self × rhs` — apply `rhs` first, then `self`.
    fn mul(self, rhs: Matrix) -> Matrix {
        Matrix {
            a: self.a * rhs.a + self.c * rhs.b,
            b: self.b * rhs.a + self.d * rhs.b,
            c: self.a * rhs.c + self.c * rhs.d,
            d: self.b * rhs.c + self.d * rhs.d,
            e: self.a * rhs.e + self.c * rhs.f + self.e,
            f: self.b * rhs.e + self.d * rhs.f + self.f,
        }
    }
    fn point(self, x: f64, y: f64) -> (f64, f64) {
        (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)
    }
}

fn matrix_of(objects: &[Object]) -> Option<Matrix> {
    if objects.len() != 6 {
        return None;
    }
    let mut v = [0.0; 6];
    for (i, o) in objects.iter().enumerate() {
        let f = obj_f64(o)?;
        if !f.is_finite() {
            return None;
        }
        v[i] = f;
    }
    Some(Matrix {
        a: v[0],
        b: v[1],
        c: v[2],
        d: v[3],
        e: v[4],
        f: v[5],
    })
}

/// `/Rect`-style `[x1, y1, x2, y2]` corners normalized so x1<=x2, y1<=y2.
fn rect_corners(dict: &lopdf::Dictionary) -> Option<[f64; 4]> {
    let arr = dict.get(b"Rect").ok()?.as_array().ok()?;
    if arr.len() != 4 {
        return None;
    }
    let mut v = [0.0; 4];
    for (i, o) in arr.iter().enumerate() {
        let f = obj_f64(o)?;
        if !f.is_finite() {
            return None;
        }
        v[i] = f;
    }
    Some([v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])])
}

/// Closed intersection: touching edges count as intersecting (conservative
/// for redaction — an annotation flush against the rect edge is removed).
fn rects_intersect(a: [f64; 4], b: [f64; 4]) -> bool {
    a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/// Axis-aligned bbox of the unit image square under `m`, as [x1,y1,x2,y2].
fn image_bbox(m: Matrix) -> [f64; 4] {
    let pts = [
        m.point(0.0, 0.0),
        m.point(1.0, 0.0),
        m.point(1.0, 1.0),
        m.point(0.0, 1.0),
    ];
    let mut x1 = f64::INFINITY;
    let mut y1 = f64::INFINITY;
    let mut x2 = f64::NEG_INFINITY;
    let mut y2 = f64::NEG_INFINITY;
    for (x, y) in pts {
        x1 = x1.min(x);
        y1 = y1.min(y);
        x2 = x2.max(x);
        y2 = y2.max(y);
    }
    [x1, y1, x2, y2]
}

fn bbox_contained(b: [f64; 4], r: [f64; 4]) -> bool {
    b.iter().all(|v| v.is_finite())
        && b[0] >= r[0]
        && b[1] >= r[1]
        && b[2] <= r[2]
        && b[3] <= r[3]
}

fn ref_target(dict: &lopdf::Dictionary, key: &[u8]) -> Option<ObjectId> {
    dict.get(key).ok().and_then(|o| o.as_reference().ok())
}

// ---------------------------------------------------------------------------
// Annotation planning (read phase on the committed document)
// ---------------------------------------------------------------------------

struct AnnotEntry {
    /// Slot index inside the raw `/Annots` array.
    slot: usize,
    /// Indirect object id, when the entry is a reference.
    id: Option<ObjectId>,
    /// Cloned dictionary for refs and inline dicts; `None` for entries
    /// that are neither (dangling refs, non-dict objects) — always retained.
    dict: Option<lopdf::Dictionary>,
}

fn page_annot_entries(doc: &Document, page_id: ObjectId) -> Result<Vec<AnnotEntry>, EngineError> {
    let raw = annot_entries(doc, page_id)?;
    if raw.len() > MAX_REDACT_ANNOTS {
        return Err(EngineError::validation(format!(
            "page has more than {MAX_REDACT_ANNOTS} annotations"
        )));
    }
    let mut out = Vec::with_capacity(raw.len());
    for (i, entry) in raw.iter().enumerate() {
        let (id, dict) = match entry {
            Object::Reference(r) => (
                Some(*r),
                doc.get_object(*r).and_then(Object::as_dict).ok().cloned(),
            ),
            Object::Dictionary(inline) => (None, Some(inline.clone())),
            _ => (None, None),
        };
        out.push(AnnotEntry {
            slot: i,
            id,
            dict,
        });
    }
    Ok(out)
}

struct AnnotPlan {
    /// `/Annots` array slot indices to drop.
    remove_slots: BTreeSet<usize>,
    /// Indirect annotation object ids to delete.
    remove_ids: BTreeSet<ObjectId>,
    removed_ids: Vec<ObjectId>,
    retained_ids: Vec<ObjectId>,
    retained_count: usize,
}

fn plan_annotation_removal(
    doc: &Document,
    page_id: ObjectId,
    rect: [f64; 4],
) -> Result<AnnotPlan, EngineError> {
    let entries = page_annot_entries(doc, page_id)?;
    let mut remove_slots: BTreeSet<usize> = BTreeSet::new();
    let mut remove_ids: BTreeSet<ObjectId> = BTreeSet::new();
    let mut retained_ids = Vec::new();
    for entry in &entries {
        let hit = entry
            .dict
            .as_ref()
            .and_then(rect_corners)
            .is_some_and(|r| rects_intersect(r, rect));
        if hit {
            remove_slots.insert(entry.slot);
            if let Some(id) = entry.id {
                remove_ids.insert(id);
            }
        } else if let Some(id) = entry.id {
            retained_ids.push(id);
        }
    }
    // Expand through comment links: a surviving reply whose /IRT or /Popup
    // names a removed annotation must go too, and a removed annotation's
    // own /Popup target is removed with it (its /Parent would dangle).
    // Fixpoint over the page's annotation set; links to objects outside
    // the set are left for the external-reference scan to reject.
    loop {
        let before = remove_ids.len() + remove_slots.len();
        for entry in &entries {
            if remove_slots.contains(&entry.slot) {
                continue;
            }
            let Some(dict) = &entry.dict else { continue };
            let linked = [&b"IRT"[..], &b"Popup"[..]]
                .iter()
                .filter_map(|k| ref_target(dict, k))
                .any(|t| remove_ids.contains(&t));
            if linked {
                remove_slots.insert(entry.slot);
                if let Some(id) = entry.id {
                    remove_ids.insert(id);
                }
            }
        }
        // /Popup targets of removed annotations join the removal set when
        // they are page annots; anything else is an external reference the
        // scan below rejects.
        let ids: Vec<ObjectId> = remove_ids.iter().copied().collect();
        for id in ids {
            if let Ok(dict) = doc.get_object(id).and_then(Object::as_dict) {
                if let Some(target) = ref_target(dict, b"Popup") {
                    if let Some(entry) = entries.iter().find(|e| e.id == Some(target)) {
                        remove_slots.insert(entry.slot);
                        remove_ids.insert(target);
                    }
                }
            }
        }
        if remove_ids.len() + remove_slots.len() == before {
            break;
        }
    }
    // Fail closed on references from outside the removable region: every
    // object except the removed annot dicts, this page's /Annots array
    // object, and the page dict's /Annots key itself is scanned with the
    // same bounded walker `removeAnnotation` uses.
    if !remove_ids.is_empty() {
        let annots_array = match annots_loc(doc, page_id)? {
            AnnotsLoc::Ref(id) => Some(id),
            _ => None,
        };
        let mut work = 0usize;
        for (id, object) in &doc.objects {
            if remove_ids.contains(id) || Some(*id) == annots_array {
                continue;
            }
            if *id == page_id {
                let dict = object.as_dict().map_err(ser_err)?;
                for (key, value) in dict.iter() {
                    if key.as_slice() != b"Annots"
                        && comments::references_removed(value, &remove_ids, 0, &mut work)?
                    {
                        return Err(EngineError::unsupported(
                            "external reference prevents annotation redaction",
                        ));
                    }
                }
            } else if comments::references_removed(object, &remove_ids, 0, &mut work)? {
                return Err(EngineError::unsupported(
                    "external reference prevents annotation redaction",
                ));
            }
        }
    }
    // A second page sharing this page's /Annots array object would keep
    // dangling entries the scan above cannot see (the array object is
    // excluded globally). Reject explicitly.
    for (num, other) in doc.get_pages() {
        if other == page_id {
            continue;
        }
        let _ = num;
        for entry in annot_entries(doc, other)? {
            if let Ok(r) = entry.as_reference() {
                if remove_ids.contains(&r) {
                    return Err(EngineError::unsupported(
                        "annotation is shared with another page's /Annots",
                    ));
                }
            }
        }
    }
    let mut removed_ids: Vec<ObjectId> = remove_ids.iter().copied().collect();
    removed_ids.sort();
    retained_ids.retain(|id| !remove_ids.contains(id));
    retained_ids.sort();
    retained_ids.dedup();
    let retained_count = entries.len() - remove_slots.len();
    Ok(AnnotPlan {
        remove_slots,
        remove_ids,
        removed_ids,
        retained_ids,
        retained_count,
    })
}

// ---------------------------------------------------------------------------
// Image XObject analysis (read phase)
// ---------------------------------------------------------------------------

/// Where the effective `/Resources` dict for the page was found.
struct ResLocation {
    /// Object id of the dict holding the `/Resources` key.
    owner: ObjectId,
    /// `Some(id)` when `/Resources` is an indirect dictionary.
    res_ref: Option<ObjectId>,
    /// True when resources came from an ancestor `/Pages` node.
    inherited: bool,
}

fn page_resources(doc: &Document, page_id: ObjectId) -> Result<Option<ResLocation>, EngineError> {
    let mut seen = HashSet::new();
    let mut current = Some(page_id);
    for _ in 0..page_ops::MAX_TREE_DEPTH {
        let Some(id) = current else { return Ok(None) };
        if !seen.insert(id) {
            return Ok(None);
        }
        let dict = doc.get_object(id).and_then(Object::as_dict).map_err(ser_err)?;
        if dict.has(b"Resources") {
            let res_ref = dict
                .get(b"Resources")
                .ok()
                .and_then(|o| o.as_reference().ok());
            return Ok(Some(ResLocation {
                owner: id,
                res_ref,
                inherited: id != page_id,
            }));
        }
        current = dict
            .get(b"Parent")
            .ok()
            .and_then(|o| o.as_reference().ok());
    }
    Ok(None)
}

/// Resolve a resources location to its dictionary (indirect or inline in
/// the owner dict).
fn resources_dict<'a>(
    doc: &'a Document,
    loc: &ResLocation,
) -> Result<Option<&'a lopdf::Dictionary>, EngineError> {
    match loc.res_ref {
        Some(id) => doc.get_object(id).and_then(Object::as_dict).map(Some).map_err(ser_err),
        None => Ok(doc
            .get_object(loc.owner)
            .and_then(Object::as_dict)
            .map_err(ser_err)?
            .get(b"Resources")
            .ok()
            .and_then(|o| o.as_dict().ok())),
    }
}

/// The `/XObject` dictionary inside a resources dictionary: indirect id or
/// inline dictionary.
enum XobjDict {
    Ref(ObjectId, lopdf::Dictionary),
    Inline(lopdf::Dictionary),
}

fn xobject_dict(doc: &Document, loc: &ResLocation) -> Result<Option<XobjDict>, EngineError> {
    let Some(res) = resources_dict(doc, loc)? else {
        return Ok(None);
    };
    let Ok(xo) = res.get(b"XObject") else {
        return Ok(None);
    };
    match xo {
        Object::Reference(id) => Ok(Some(XobjDict::Ref(
            *id,
            doc.get_object(*id).and_then(Object::as_dict).map_err(ser_err)?.clone(),
        ))),
        Object::Dictionary(inline) => Ok(Some(XobjDict::Inline(inline.clone()))),
        _ => Ok(None),
    }
}

/// name bytes → raw object for every entry of an XObject dict.
fn xobj_map(dict: &lopdf::Dictionary) -> HashMap<Vec<u8>, Object> {
    dict.iter()
        .map(|(k, v)| (k.as_slice().to_vec(), v.clone()))
        .collect()
}

#[derive(Clone, Copy)]
struct Placement {
    nested: bool,
    contained: bool,
    /// The `Do` lives in a content stream shared with another page.
    locked: bool,
    stream: ObjectId,
    op_index: usize,
}

struct ScanState {
    budget: usize,
    complete: bool,
    forms_visited: HashSet<ObjectId>,
    forms_count: usize,
    /// Inline (non-indirect) image XObjects seen — count only, never ids.
    inline_images: usize,
}

fn decode_ops(data: &[u8]) -> Result<Vec<Operation>, EngineError> {
    Content::decode(data).map(|c| c.operations).map_err(ser_err)
}

/// Resolve a `Do` target object: record image placements, recurse into
/// form XObjects. `parent_xobjs` is the enclosing resource map a form
/// inherits when it declares no `/Resources` of its own.
#[allow(clippy::too_many_arguments)]
fn handle_do(
    doc: &Document,
    target: &Object,
    ctm: Matrix,
    rect: [f64; 4],
    locked_streams: &HashSet<ObjectId>,
    stream_id: ObjectId,
    op_index: usize,
    out: &mut HashMap<ObjectId, Vec<Placement>>,
    state: &mut ScanState,
    parent_xobjs: &HashMap<Vec<u8>, Object>,
    depth: usize,
) -> Result<(), EngineError> {
    let (xobj_id, stream) = match target {
        Object::Reference(id) => match doc.get_object(*id).map_err(ser_err)? {
            Object::Stream(s) => (*id, s.clone()),
            _ => return Ok(()),
        },
        Object::Stream(s) => {
            // Inline image XObject: visible but has no object id to remove.
            let subtype = s
                .dict
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                .unwrap_or(b"");
            if subtype == b"Image" {
                state.inline_images += 1;
            }
            return Ok(());
        }
        _ => return Ok(()),
    };
    let subtype = stream
        .dict
        .get(b"Subtype")
        .ok()
        .and_then(|o| o.as_name().ok())
        .unwrap_or(b"");
    match subtype {
        b"Image" => {
            let image_matrix = stream
                .dict
                .get(b"Matrix")
                .ok()
                .and_then(|o| o.as_array().ok())
                .and_then(|a| matrix_of(a))
                .unwrap_or(IDENTITY);
            let bbox = image_bbox(ctm.mul(image_matrix));
            out.entry(xobj_id).or_default().push(Placement {
                nested: depth > 0,
                contained: bbox_contained(bbox, rect),
                locked: locked_streams.contains(&stream_id),
                stream: stream_id,
                op_index,
            });
            Ok(())
        }
        b"Form" => {
            if depth >= MAX_FORM_DEPTH || state.forms_count >= MAX_FORMS {
                state.complete = false;
                return Ok(());
            }
            if !state.forms_visited.insert(xobj_id) {
                // Cyclic form reference: placements cannot be proven.
                state.complete = false;
                return Ok(());
            }
            state.forms_count += 1;
            let inner_xobjs = form_xobjs(doc, &stream)?.unwrap_or_else(|| parent_xobjs.clone());
            let form_matrix = stream
                .dict
                .get(b"Matrix")
                .ok()
                .and_then(|o| o.as_array().ok())
                .and_then(|a| matrix_of(a))
                .unwrap_or(IDENTITY);
            let inner_ctm = ctm.mul(form_matrix);
            let data = stream.get_plain_content().map_err(ser_err)?;
            let ops = decode_ops(&data)?;
            walk_ops(
                doc, &ops, inner_ctm, rect, locked_streams, xobj_id, &inner_xobjs, out, state,
                depth + 1,
            )
        }
        _ => Ok(()),
    }
}

/// `/XObject` name→object map declared by a form XObject's own
/// `/Resources`, when present.
fn form_xobjs(
    doc: &Document,
    stream: &lopdf::Stream,
) -> Result<Option<HashMap<Vec<u8>, Object>>, EngineError> {
    let res_dict = match stream.dict.get(b"Resources") {
        Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_dict).map_err(ser_err)?,
        Ok(Object::Dictionary(d)) => d,
        _ => return Ok(None),
    };
    let xo_dict = match res_dict.get(b"XObject") {
        Ok(Object::Reference(id)) => doc.get_object(*id).and_then(Object::as_dict).map_err(ser_err)?,
        Ok(Object::Dictionary(d)) => d,
        _ => return Ok(None),
    };
    Ok(Some(xobj_map(xo_dict)))
}

/// Walk decoded operations tracking CTM; shared by page streams (depth 0)
/// and form streams. `stream_id` is the object the ops belong to — for
/// form streams it is the form's id (used only for the `locked` flag and
/// reporting; form placements are always `nested`).
#[allow(clippy::too_many_arguments)]
fn walk_ops(
    doc: &Document,
    ops: &[Operation],
    mut ctm: Matrix,
    rect: [f64; 4],
    locked_streams: &HashSet<ObjectId>,
    stream_id: ObjectId,
    xobjs: &HashMap<Vec<u8>, Object>,
    out: &mut HashMap<ObjectId, Vec<Placement>>,
    state: &mut ScanState,
    depth: usize,
) -> Result<(), EngineError> {
    let mut stack: Vec<Matrix> = Vec::new();
    for (op_index, op) in ops.iter().enumerate() {
        state.budget = state.budget.saturating_sub(1);
        if state.budget == 0 {
            state.complete = false;
            return Ok(());
        }
        match op.operator.as_str() {
            "q" => stack.push(ctm),
            "Q" => {
                if let Some(m) = stack.pop() {
                    ctm = m;
                }
            }
            "cm" => {
                if let Some(m) = matrix_of(&op.operands) {
                    ctm = ctm.mul(m);
                }
            }
            "Do" => {
                let Some(name) = op.operands.first().and_then(|o| o.as_name().ok()) else {
                    continue;
                };
                let Some(target) = xobjs.get(name) else {
                    continue;
                };
                handle_do(
                    doc, target, ctm, rect, locked_streams, stream_id, op_index, out, state,
                    xobjs, depth,
                )?;
                if !state.complete {
                    return Ok(());
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Content stream ids used by more than one page — their bytes cannot be
/// rewritten without affecting the other page.
fn shared_content_streams(doc: &Document) -> HashSet<ObjectId> {
    let mut counts: HashMap<ObjectId, usize> = HashMap::new();
    for (_, pid) in doc.get_pages() {
        for sid in doc.get_page_contents(pid) {
            *counts.entry(sid).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .filter(|(_, n)| *n > 1)
        .map(|(id, _)| id)
        .collect()
}

struct ImagePlan {
    /// Image id → Do operations to strip (all direct, contained, unlocked).
    strip: HashMap<ObjectId, Vec<(ObjectId, usize)>>,
    /// Fully removed image object ids.
    removed_ids: Vec<ObjectId>,
    /// Images whose draws were stripped but whose object stays reachable
    /// (shared resource chain).
    draw_removed_ids: Vec<ObjectId>,
    /// Retained image id → reason.
    retained: BTreeMap<ObjectId, &'static str>,
    /// Holder paths for `removed_ids` (needed by the mutation phase).
    holders: HashMap<ObjectId, Vec<HolderPath>>,
    /// Inline image XObjects encountered (count only).
    inline_images: usize,
    /// Set when content analysis could not prove every placement.
    analysis_incomplete: bool,
}

fn analyze_images(
    doc: &Document,
    page_id: ObjectId,
    rect: [f64; 4],
) -> Result<ImagePlan, EngineError> {
    let mut plan = ImagePlan {
        strip: HashMap::new(),
        removed_ids: Vec::new(),
        draw_removed_ids: Vec::new(),
        retained: BTreeMap::new(),
        holders: HashMap::new(),
        inline_images: 0,
        analysis_incomplete: false,
    };
    let Some(loc) = page_resources(doc, page_id)? else {
        return Ok(plan);
    };
    let Some(xo) = xobject_dict(doc, &loc)? else {
        return Ok(plan);
    };
    // Collect indirect image XObjects and their holder paths.
    let mut cands: HashMap<ObjectId, Cand> = HashMap::new();
    let (xo_ref, xo_dict) = match &xo {
        XobjDict::Ref(id, d) => (Some(*id), d),
        XobjDict::Inline(d) => (None, d),
    };
    let res_container = loc.res_ref.unwrap_or(loc.owner);
    for (_name, value) in xo_dict.iter() {
        let Object::Reference(img_id) = value else { continue };
        let Ok(Object::Stream(stream)) = doc.get_object(*img_id) else {
            continue;
        };
        let subtype = stream
            .dict
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name().ok())
            .unwrap_or(b"");
        if subtype != b"Image" {
            continue;
        }
        // Object id whose dictionary holds this name→image entry.
        let entry_holder = xo_ref.unwrap_or(res_container);
        cands.entry(*img_id).or_insert_with(|| Cand { holders: Vec::new() }).holders.push(HolderPath {
            entry_holder,
            xobj_ref: xo_ref,
            res_ref: loc.res_ref,
            inherited: loc.inherited,
            owner: loc.owner,
            page_id,
        });
    }
    // No early return on empty `cands`: form XObjects can nest images that
    // are not page-level candidates, and the content scan below is what
    // discovers them for honest retained reporting.
    // Content scan: placements per image id.
    let xobjs = xobj_map(xo_dict);
    let locked = shared_content_streams(doc);
    let mut placements: HashMap<ObjectId, Vec<Placement>> = HashMap::new();
    let mut state = ScanState {
        budget: MAX_CONTENT_OPS,
        complete: true,
        forms_visited: HashSet::new(),
        forms_count: 0,
        inline_images: 0,
    };
    let mut scan_failed = false;
    for sid in doc.get_page_contents(page_id) {
        let Ok(stream) = doc.get_object(sid).and_then(Object::as_stream) else {
            continue;
        };
        let data = match stream.get_plain_content() {
            Ok(d) => d,
            Err(_) => {
                scan_failed = true;
                break;
            }
        };
        let ops = match decode_ops(&data) {
            Ok(o) => o,
            Err(_) => {
                scan_failed = true;
                break;
            }
        };
        if walk_ops(
            doc, &ops, IDENTITY, rect, &locked, sid, &xobjs, &mut placements, &mut state, 0,
        )
        .is_err()
        {
            scan_failed = true;
            break;
        }
        if !state.complete {
            break;
        }
    }
    plan.inline_images = state.inline_images;
    plan.analysis_incomplete = scan_failed || !state.complete;
    if plan.analysis_incomplete {
        for id in cands.keys() {
            plan.retained.insert(*id, "analysis_incomplete");
        }
        return Ok(plan);
    }
    // Classify each image. Images reachable only through a form XObject's
    // own resources are not page-level candidates: their draws can never
    // be proven fully removable here, so they are always reported retained.
    let mut strip: HashMap<ObjectId, Vec<(ObjectId, usize)>> = HashMap::new();
    let mut all_ids: BTreeSet<ObjectId> = cands.keys().copied().collect();
    all_ids.extend(placements.keys().copied());
    for img_id in all_ids {
        let ps = placements.get(&img_id).cloned().unwrap_or_default();
        let reason = if ps.is_empty() {
            Some("not_drawn")
        } else if ps.iter().any(|p| !p.contained) {
            Some("extends_outside_rect")
        } else if ps.iter().any(|p| p.nested) {
            Some("drawn_inside_form")
        } else if ps.iter().any(|p| p.locked) {
            Some("shared_content_stream")
        } else {
            None
        };
        match reason {
            Some(r) => {
                plan.retained.insert(img_id, r);
            }
            None => {
                // Non-candidate ids cannot reach this branch in practice
                // (a direct, contained, unlocked placement implies the image
                // sits in the page's own XObject dict), but guard anyway:
                // only candidates may have draws stripped or entries removed.
                if !cands.contains_key(&img_id) {
                    plan.retained.insert(img_id, "drawn_inside_form");
                    continue;
                }
                for p in ps {
                    strip
                        .entry(img_id)
                        .or_default()
                        .push((p.stream, p.op_index));
                }
            }
        }
    }
    // Exclusivity: the resource entry may be removed only when the chain
    // image → holder → (xobject dict) → resources dict → page is provably
    // private to this page. Otherwise draws are stripped but the object
    // stays reachable through the shared chain.
    let referrers = object_referrers(doc, &referrer_candidates(&cands));
    for (img_id, ops) in strip {
        plan.strip.insert(img_id, ops);
        if image_entry_exclusive(doc, img_id, &cands[&img_id].holders, &referrers) {
            plan.holders.insert(img_id, cands[&img_id].holders.clone());
            plan.removed_ids.push(img_id);
        } else {
            plan.draw_removed_ids.push(img_id);
        }
    }
    plan.removed_ids.sort();
    plan.draw_removed_ids.sort();
    Ok(plan)
}

/// How one name→image entry sits in the resource chain, for the later
/// exclusivity check and entry removal.
#[derive(Clone)]
struct HolderPath {
    /// Object id whose dictionary directly contains the name→image entry:
    /// the `/XObject` dict when indirect, else the resources container.
    entry_holder: ObjectId,
    /// `/XObject` dict id when indirect.
    xobj_ref: Option<ObjectId>,
    /// Resources dict id when indirect.
    res_ref: Option<ObjectId>,
    /// Resources resolved through an ancestor `/Pages` node.
    inherited: bool,
    /// Dict id holding the `/Resources` key.
    owner: ObjectId,
    page_id: ObjectId,
}

struct Cand {
    holders: Vec<HolderPath>,
}

/// Every object id that could appear in an image's resource chain.
fn referrer_candidates(cands: &HashMap<ObjectId, Cand>) -> HashSet<ObjectId> {
    let mut set = HashSet::new();
    for cand in cands.values() {
        for h in &cand.holders {
            set.insert(h.entry_holder);
            if let Some(x) = h.xobj_ref {
                set.insert(x);
            }
            if let Some(r) = h.res_ref {
                set.insert(r);
            }
            set.insert(h.owner);
            set.insert(h.page_id);
        }
        set.extend(cands.keys().copied());
    }
    set
}

/// Single pass over `doc.objects`: for every candidate id, the set of
/// object ids that reference it.
fn object_referrers(doc: &Document, candidates: &HashSet<ObjectId>) -> HashMap<ObjectId, HashSet<ObjectId>> {
    let mut out: HashMap<ObjectId, HashSet<ObjectId>> = HashMap::new();
    if candidates.is_empty() || doc.objects.len() > 200_000 {
        return out;
    }
    let mut refs = Vec::new();
    for (id, object) in &doc.objects {
        refs.clear();
        page_ops::collect_refs(object, &mut refs);
        for r in &refs {
            if candidates.contains(r) {
                out.entry(*r).or_default().insert(*id);
            }
        }
    }
    out
}

fn sole_referrer(
    referrers: &HashMap<ObjectId, HashSet<ObjectId>>,
    id: ObjectId,
    expected: ObjectId,
) -> bool {
    referrers
        .get(&id)
        .is_some_and(|s| s.len() == 1 && s.contains(&expected))
}

/// Can the `/XObject` name entry for `img` be deleted without affecting
/// any other page or object? Requires: not inherited resources, the image
/// referenced only by its entry holder, the holder only by the resources
/// container, and the resources dict only by this page.
fn image_entry_exclusive(
    doc: &Document,
    img: ObjectId,
    holders: &[HolderPath],
    referrers: &HashMap<ObjectId, HashSet<ObjectId>>,
) -> bool {
    // Every name under which the image is reachable must sit in the same
    // exclusive chain; multiple holders mean shared exposure.
    let first = &holders[0];
    if holders.iter().any(|h| {
        h.inherited || h.owner != first.owner || h.entry_holder != first.entry_holder
    }) {
        return false;
    }
    if first.inherited {
        return false;
    }
    // img's only referrer is the dict holding the name entry.
    if !sole_referrer(referrers, img, first.entry_holder) {
        return false;
    }
    if let Some(xo) = first.xobj_ref {
        // /XObject dict referenced only by the resources container.
        let res_container = first.res_ref.unwrap_or(first.owner);
        if xo != first.entry_holder || !sole_referrer(referrers, xo, res_container) {
            return false;
        }
    }
    if let Some(rd) = first.res_ref {
        // Resources dict referenced only by the page dict.
        if !sole_referrer(referrers, rd, first.page_id) {
            return false;
        }
    }
    // When /XObject is inline inside an indirect resources dict, the
    // entry holder IS the resources dict — already covered above.
    let _ = doc;
    true
}

// ---------------------------------------------------------------------------
// Mutation phase (on a cloned document)
// ---------------------------------------------------------------------------

/// Drop the planned `/Annots` slots and delete the removed annotation
/// objects. The `/Annots` array keeps its shape (inline array or indirect
/// object); an emptied array stays as an empty array.
fn apply_annot_removal(next: &mut Document, page_id: ObjectId, plan: &AnnotPlan) -> Result<(), EngineError> {
    let kept: Vec<Object> = annot_entries(next, page_id)?
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !plan.remove_slots.contains(i))
        .map(|(_, o)| o)
        .collect();
    match annots_loc(next, page_id)? {
        AnnotsLoc::Inline => {
            next.get_object_mut(page_id)
                .and_then(Object::as_dict_mut)
                .and_then(|d| d.get_mut(b"Annots"))
                .and_then(Object::as_array_mut)
                .map_err(ser_err)?
                .clone_from(&kept);
        }
        AnnotsLoc::Ref(array) => {
            *next
                .get_object_mut(array)
                .and_then(Object::as_array_mut)
                .map_err(ser_err)? = kept;
        }
        AnnotsLoc::Missing => {}
    }
    for id in &plan.remove_ids {
        next.objects.remove(id);
    }
    Ok(())
}

/// Strip the planned `Do` operations from each affected content stream and
/// re-encode it unfiltered (`set_plain_content` drops `/Filter` and
/// `/DecodeParms`). Streams proven non-shared during analysis are the only
/// ones touched.
fn apply_image_strip(next: &mut Document, plan: &ImagePlan) -> Result<(), EngineError> {
    // Group op indices by stream.
    let mut by_stream: HashMap<ObjectId, BTreeSet<usize>> = HashMap::new();
    for ops in plan.strip.values() {
        for (stream, idx) in ops {
            by_stream.entry(*stream).or_default().insert(*idx);
        }
    }
    for (stream_id, drop_idx) in by_stream {
        let data = {
            let stream = next.get_object(stream_id).and_then(Object::as_stream).map_err(ser_err)?;
            stream.get_plain_content().map_err(ser_err)?
        };
        let ops = decode_ops(&data)?;
        let kept: Vec<Operation> = ops
            .into_iter()
            .enumerate()
            .filter(|(i, _)| !drop_idx.contains(i))
            .map(|(_, op)| op)
            .collect();
        let encoded = Content {
            operations: kept,
        }
        .encode()
        .map_err(ser_err)?;
        if let Object::Stream(stream) = next.get_object_mut(stream_id).map_err(ser_err)? {
            stream.set_plain_content(encoded);
        }
    }
    Ok(())
}

/// Remove every `/XObject` name entry that resolves to `img`, following
/// the recorded holder path. Only called for images whose chain was proven
/// exclusive to this page.
fn remove_xobject_entries(
    next: &mut Document,
    img: ObjectId,
    holders: &[HolderPath],
) -> Result<(), EngineError> {
    for h in holders {
        if let Some(xo_id) = h.xobj_ref {
            // Indirect /XObject dict: drop all names → img.
            let dict = next.get_object_mut(xo_id).and_then(Object::as_dict_mut).map_err(ser_err)?;
            let names: Vec<Vec<u8>> = dict
                .iter()
                .filter(|(_, v)| matches!(v, Object::Reference(r) if *r == img))
                .map(|(k, _)| k.as_slice().to_vec())
                .collect();
            for name in names {
                dict.remove(&name);
            }
        } else if let Some(rd) = h.res_ref {
            // Inline /XObject dict inside an indirect resources dict.
            let rd_dict = next.get_object_mut(rd).and_then(Object::as_dict_mut).map_err(ser_err)?;
            if let Ok(xo) = rd_dict.get_mut(b"XObject").and_then(Object::as_dict_mut) {
                let names: Vec<Vec<u8>> = xo
                    .iter()
                    .filter(|(_, v)| matches!(v, Object::Reference(r) if *r == img))
                    .map(|(k, _)| k.as_slice().to_vec())
                    .collect();
                for name in names {
                    xo.remove(&name);
                }
            }
        } else {
            // Fully inline chain inside the page dict.
            let page = next.get_object_mut(h.owner).and_then(Object::as_dict_mut).map_err(ser_err)?;
            if let Ok(res) = page.get_mut(b"Resources").and_then(Object::as_dict_mut) {
                if let Ok(xo) = res.get_mut(b"XObject").and_then(Object::as_dict_mut) {
                    let names: Vec<Vec<u8>> = xo
                        .iter()
                        .filter(|(_, v)| matches!(v, Object::Reference(r) if *r == img))
                        .map(|(k, _)| k.as_slice().to_vec())
                        .collect();
                    for name in names {
                        xo.remove(&name);
                    }
                }
            }
        }
    }
    Ok(())
}

/// Scrub document metadata on `doc`: `/PieceInfo` and `/Metadata` on every
/// page and the catalog, trailer `/Info`. Returns key → removal count.
fn scrub_metadata(doc: &mut Document) -> BTreeMap<String, usize> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut bump = |key: &str, n: usize| {
        if n > 0 {
            *counts.entry(key.to_string()).or_default() += n;
        }
    };
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for pid in page_ids {
        let mut n_piece = 0usize;
        let mut n_meta = 0usize;
        if let Ok(d) = doc.get_object_mut(pid).and_then(Object::as_dict_mut) {
            n_piece += usize::from(d.remove(b"PieceInfo").is_some());
            n_meta += usize::from(d.remove(b"Metadata").is_some());
        }
        bump("PieceInfo", n_piece);
        bump("Metadata", n_meta);
    }
    if let Ok(catalog) = doc.catalog_mut() {
        let n_piece = usize::from(catalog.remove(b"PieceInfo").is_some());
        let n_meta = usize::from(catalog.remove(b"Metadata").is_some());
        bump("PieceInfo", n_piece);
        bump("Metadata", n_meta);
    }
    if doc.trailer.remove(b"Info").is_some() {
        bump("Info", 1);
    }
    counts
}

/// Would `scrub_metadata` remove anything? Read-phase check so a no-op
/// redaction stays eventless.
fn metadata_present(doc: &Document) -> bool {
    if doc.trailer.get(b"Info").is_ok() {
        return true;
    }
    if let Ok(catalog) = doc.catalog() {
        if catalog.has(b"Metadata") || catalog.has(b"PieceInfo") {
            return true;
        }
    }
    doc.get_pages().into_values().any(|pid| {
        doc.get_object(pid)
            .and_then(Object::as_dict)
            .map(|d| d.has(b"PieceInfo") || d.has(b"Metadata"))
            .unwrap_or(false)
    })
}

fn capped_u64s(ids: &[ObjectId]) -> (Vec<u64>, bool) {
    let total = ids.len();
    let out: Vec<u64> = ids.iter().take(MAX_LISTED).map(|id| id.0 as u64).collect();
    (out, total > MAX_LISTED)
}

fn redact_report(
    annot: &AnnotPlan,
    images: &ImagePlan,
    metadata: &BTreeMap<String, usize>,
) -> Value {
    let (removed_annot_ids, removed_trunc) = capped_u64s(&annot.removed_ids);
    let (retained_annot_ids, retained_trunc) = capped_u64s(&annot.retained_ids);
    let (removed_img_ids, removed_img_trunc) = capped_u64s(&images.removed_ids);
    let (draw_img_ids, draw_trunc) = capped_u64s(&images.draw_removed_ids);
    let mut retained_reasons = serde_json::Map::new();
    let mut reasons_truncated = false;
    for (i, (id, reason)) in images.retained.iter().enumerate() {
        if i >= MAX_LISTED {
            reasons_truncated = true;
            break;
        }
        retained_reasons.insert(id.0.to_string(), json!(reason));
    }
    json!({
        "ok": true,
        "removed": {
            "annotations": annot.remove_slots.len(),
            "annotation_ids": removed_annot_ids,
            "annotation_ids_truncated": removed_trunc,
            "images": images.removed_ids.len(),
            "image_ids": removed_img_ids,
            "image_ids_truncated": removed_img_trunc,
            "image_draws_removed": images.draw_removed_ids.len(),
            "image_draw_ids": draw_img_ids,
            "image_draw_ids_truncated": draw_trunc,
            "metadata": metadata,
        },
        "retained": {
            "annotations": annot.retained_count,
            "annotation_ids": retained_annot_ids,
            "annotation_ids_truncated": retained_trunc,
            "images": images.retained.len(),
            "image_reasons": Value::Object(retained_reasons),
            "image_reasons_truncated": reasons_truncated,
            "inline_images": images.inline_images,
        },
        "content_note": "text and vector page content are never removed: glyph-level redaction is not provable without glyph positions (see docs/ENGINE_OPS.md)",
    })
}

impl FolioEngine {
    /// `redactRect {page, rect}` → structural redaction report. Mutating;
    /// one undo entry restores the whole pre-redaction document. See the
    /// module docs for exactly what is and is not removed.
    pub(super) fn op_redact_rect(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if self.doc.is_encrypted() {
            return Err(EngineError::unsupported(
                "redaction is not supported on encrypted documents; decrypt first",
            ));
        }
        let page = req_u64(p, "page")?;
        let page_id = self.page_id(page)?;
        // Same positive/nondegenerate/±1e6 rule as shape and link annots.
        let rect = {
            let r = markup::checked_rect(req_rect(p)?)?;
            [r[0] as f64, r[1] as f64, r[2] as f64, r[3] as f64]
        };
        // Read phase: everything fallible resolves against self.doc.
        let annot_plan = plan_annotation_removal(&self.doc, page_id, rect)?;
        let image_plan = analyze_images(&self.doc, page_id, rect)?;
        let meta_present = metadata_present(&self.doc);
        if annot_plan.remove_slots.is_empty()
            && image_plan.strip.is_empty()
            && !meta_present
        {
            // Nothing intersects and no metadata exists: eventless no-op.
            return Ok(ro(redact_report(&annot_plan, &image_plan, &BTreeMap::new())));
        }
        // Mutation phase on a clone; any failure discards it untouched.
        let mut next = self.doc.clone();
        apply_annot_removal(&mut next, page_id, &annot_plan)?;
        apply_image_strip(&mut next, &image_plan)?;
        for (img, holders) in &image_plan.holders {
            if image_plan.removed_ids.contains(img) {
                remove_xobject_entries(&mut next, *img, holders)?;
            }
        }
        let metadata = scrub_metadata(&mut next);
        page_ops::prune_unreachable(&mut next);
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(redact_report(
            &annot_plan,
            &image_plan,
            &metadata,
        )))
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
    fn stream_plain(doc: &Document, id: ObjectId) -> Result<Vec<u8>, EngineError> {
        doc.get_object(id)
            .and_then(Object::as_stream)
            .map_err(ser_err)?
            .get_plain_content()
            .map_err(ser_err)
    }

    // -- annotation redaction -------------------------------------------------

    #[test]
    fn redact_rect_removes_intersecting_annots_and_reports_retained() {
        let mut e = engine(1);
        let inside = apply(
            &mut e,
            "addAnnotation",
            json!({"page":0,"rect":[100,100,50,50],"contents":"inside","subtype":"Text"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let outside = apply(
            &mut e,
            "addAnnotation",
            json!({"page":0,"rect":[400,400,50,50],"contents":"outside"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        // Edge-touching counts as intersecting.
        let edge = apply(
            &mut e,
            "addAnnotation",
            json!({"page":0,"rect":[200,120,10,10],"contents":"edge"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let d = apply(
            &mut e,
            "redactRect",
            json!({"page":0,"rect":[90,90,120,120]}),
        );
        assert_eq!(d["removed"]["annotations"], 2);
        assert_eq!(d["removed"]["annotation_ids"], json!([inside, edge]));
        assert_eq!(d["retained"]["annotations"], 1);
        assert_eq!(d["retained"]["annotation_ids"], json!([outside]));
        let list = apply(&mut e, "listAnnotations", json!({"page":0}));
        assert_eq!(list["annots"].as_array().unwrap().len(), 1);
        assert_eq!(list["annots"][0]["id"], outside);
        // Undo restores the whole pre-redaction document.
        let snap = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({"page":0}))["annots"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        e.restore(&snap).unwrap();
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({"page":0}))["annots"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn redact_rect_removes_reply_descendants_with_primary() {
        let mut e = engine(1);
        let primary = apply(
            &mut e,
            "addAnnotation",
            json!({"page":0,"rect":[10,10,50,50],"contents":"root","subtype":"Highlight","author":"A","modified":"D:20261107120000Z"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let reply = apply(
            &mut e,
            "addAnnotationReply",
            json!({"page":0,"id":primary,"contents":"reply","author":"B","modified":"D:20261107120100Z"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let d = apply(
            &mut e,
            "redactRect",
            json!({"page":0,"rect":[0,0,612,792]}),
        );
        assert_eq!(d["removed"]["annotations"], 2);
        assert!(d["removed"]["annotation_ids"]
            .as_array()
            .unwrap()
            .contains(&json!(primary)));
        assert!(d["removed"]["annotation_ids"]
            .as_array()
            .unwrap()
            .contains(&json!(reply)));
        // Comment graph stays valid: zero threads, no dangling IRT.
        let threads = apply(&mut e, "listCommentThreads", json!({"page":0}));
        assert!(threads["threads"].as_array().unwrap().is_empty());
        // Saved PDF reopens cleanly.
        let b64 = saved_b64(&mut e);
        let mut e2 = FolioEngine::new();
        apply(&mut e2, "open", json!({"bytes_b64": b64}));
        assert!(apply(&mut e2, "listCommentThreads", json!({"page":0}))["threads"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn redact_rect_rejects_form_widget_external_reference() {
        let mut e = engine(1);
        // Hand-build a widget annotation referenced by /AcroForm /Fields.
        let page = e.page_id(0).unwrap();
        let widget = e.doc.add_object(Object::Dictionary(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => lopdf::text_string("field.name"),
            "Rect" => vec![Object::Real(10.0), Object::Real(10.0), Object::Real(110.0), Object::Real(30.0)],
        }));
        // Push into /Annots.
        e.doc
            .get_object_mut(page)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Annots", vec![Object::Reference(widget)]);
        let catalog = e.doc.catalog_mut().unwrap();
        catalog.set("AcroForm", dictionary! { "Fields" => vec![Object::Reference(widget)] });
        let before = e.snapshot().unwrap();
        let err = apply_err(
            &mut e,
            "redactRect",
            json!({"page":0,"rect":[0,0,200,200]}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn redact_rect_validates_payload_and_state() {
        let mut e = engine(1);
        let before = e.snapshot().unwrap();
        for p in [
            json!({"page":5,"rect":[0,0,1,1]}),
            json!({"page":0,"rect":[0,0,-1,1]}),
            json!({"page":0,"rect":[0,0,0,1]}),
            json!({"page":0,"rect":[0,0,1e30,1]}),
            json!({"page":0,"rect":[0,0,1]}),
            json!({"page":0}),
        ] {
            assert!(e.apply(Command::new("redactRect", p.clone())).is_err(), "{p}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Encrypted documents reject.
        apply(&mut e, "encrypt", json!({"password":"pw"}));
        let err = apply_err(&mut e, "redactRect", json!({"page":0,"rect":[0,0,1,1]}));
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
    }

    #[test]
    fn redact_rect_noop_is_eventless() {
        let mut e = engine(1);
        let before_undo = e.journal.undo_len();
        let result = e
            .apply(Command::new(
                "redactRect",
                json!({"page":0,"rect":[0,0,1,1]}),
            ))
            .unwrap();
        assert!(result.events.is_empty());
        assert_eq!(e.journal.undo_len(), before_undo);
        assert_eq!(result.data["removed"]["annotations"], 0);
        assert_eq!(result.data["retained"]["annotations"], 0);
    }

    // -- image XObject redaction ----------------------------------------------

    fn add_image(doc: &mut Document) -> ObjectId {
        doc.add_object(Object::Stream(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 1,
                "Height" => 1,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            vec![0u8],
        )))
    }

    /// One page: /ImIn drawn at [50,50]-[150,150], /ImOut at
    /// [500,500]-[600,600], /ImPart straddling [140,140]-[240,240], plus a
    /// text op and a vector rect that must survive untouched.
    fn image_engine() -> (FolioEngine, ObjectId, ObjectId, ObjectId) {
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        let im_in = add_image(&mut doc);
        let im_out = add_image(&mut doc);
        let im_part = add_image(&mut doc);
        let xo_id = doc.add_object(Object::Dictionary(dictionary! {
            "ImIn" => im_in,
            "ImOut" => im_out,
            "ImPart" => im_part,
        }));
        let content = Stream::new(
            dictionary! {},
            b"q 100 0 0 100 50 50 cm /ImIn Do Q\nq 100 0 0 100 500 500 cm /ImOut Do Q\nq 100 0 0 100 140 140 cm /ImPart Do Q\nBT /F1 12 Tf 10 700 Td (secret) Tj ET\n0 0 612 792 re S".to_vec(),
        );
        let cid = doc.add_object(Object::Stream(content));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Contents", Object::Reference(cid));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set(
                "Resources",
                dictionary! { "XObject" => xo_id },
            );
        let mut e = FolioEngine::new();
        e.doc = doc;
        (e, im_in, im_out, im_part)
    }

    #[test]
    fn redact_rect_removes_contained_image_and_keeps_partial_and_outside() {
        let (mut e, im_in, im_out, im_part) = image_engine();
        // rect is [x, y, w, h] → covers [40,40]-[220,220]: ImIn
        // [50,50,150,150] fully inside; ImPart [140,140,240,240] straddles
        // the edge; ImOut [500,500,600,600] far outside.
        let d = apply(
            &mut e,
            "redactRect",
            json!({"page":0,"rect":[40,40,180,180]}),
        );
        assert_eq!(d["removed"]["images"], 1);
        assert_eq!(d["removed"]["image_ids"], json!([im_in.0]));
        assert_eq!(d["retained"]["images"], 2);
        let reasons = d["retained"]["image_reasons"].as_object().unwrap();
        assert_eq!(reasons[&im_out.0.to_string()], "extends_outside_rect");
        assert_eq!(reasons[&im_part.0.to_string()], "extends_outside_rect");
        // The image object and its Do are gone; text/vector ops remain.
        assert!(!e.doc.objects.contains_key(&im_in));
        assert!(e.doc.objects.contains_key(&im_out));
        assert!(e.doc.objects.contains_key(&im_part));
        let page = e.page_id(0).unwrap();
        let text = extract_page_text(&e.doc, page).unwrap();
        assert_eq!(text, "secret");
        let content_ids = e.doc.get_page_contents(page);
        let data = stream_plain(&e.doc, content_ids[0]).unwrap();
        let ops = decode_ops(&data).unwrap();
        let dos: Vec<String> = ops
            .iter()
            .filter(|o| o.operator == "Do")
            .map(|o| {
                String::from_utf8_lossy(o.operands[0].as_name().unwrap()).into_owned()
            })
            .collect();
        assert_eq!(dos, vec!["ImOut".to_string(), "ImPart".to_string()]);
        assert!(ops.iter().any(|o| o.operator == "re"));
        // Saved PDF still parses and reports the same state.
        let b64 = saved_b64(&mut e);
        let reloaded = Document::load_mem(&b64_decode(&b64).unwrap()).unwrap();
        assert!(!reloaded.objects.contains_key(&im_in));
    }

    #[test]
    fn redact_rect_shared_resources_keeps_image_object() {
        // Same /Resources dict on two pages → entry removal unsafe; draws
        // on the redacted page are still stripped, object retained.
        let mut doc = build_blank_doc(2);
        let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        let im = add_image(&mut doc);
        let xo_id = doc.add_object(Object::Dictionary(dictionary! {
            "Im" => im,
        }));
        let res_id = doc.add_object(Object::Dictionary(dictionary! {
            "XObject" => xo_id,
        }));
        // Each page gets its OWN content stream (only /Resources is
        // shared) so the page-0 draw can be stripped while page 1 keeps
        // its byte-identical copy.
        let mut cids = Vec::new();
        for _ in &pages {
            cids.push(doc.add_object(Object::Stream(Stream::new(
                dictionary! {},
                b"q 100 0 0 100 50 50 cm /Im Do Q".to_vec(),
            ))));
        }
        for (pid, cid) in pages.iter().zip(cids.iter()) {
            let d = doc.get_object_mut(*pid).unwrap().as_dict_mut().unwrap();
            d.set("Contents", Object::Reference(*cid));
            d.set("Resources", Object::Reference(res_id));
        }
        let mut e = FolioEngine::new();
        e.doc = doc;
        let d = apply(
            &mut e,
            "redactRect",
            json!({"page":0,"rect":[0,0,612,792]}),
        );
        assert_eq!(d["removed"]["images"], 0);
        assert_eq!(d["removed"]["image_draws_removed"], 1);
        assert_eq!(d["removed"]["image_draw_ids"], json!([im.0]));
        assert!(e.doc.objects.contains_key(&im));
        // Page 1 untouched: its Do survives.
        let page1 = e.page_id(1).unwrap();
        let cids = e.doc.get_page_contents(page1);
        let data = stream_plain(&e.doc, cids[0]).unwrap();
        let ops = decode_ops(&data).unwrap();
        assert_eq!(ops.iter().filter(|o| o.operator == "Do").count(), 1);
    }

    #[test]
    fn redact_rect_image_inside_form_xobject_is_retained() {
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        let im = add_image(&mut doc);
        // Form XObject drawing the image, invoked by the page.
        let form_content = Stream::new(dictionary! {}, b"q 100 0 0 100 50 50 cm /Im Do Q".to_vec());
        let form_id = doc.add_object(Object::Stream(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)],
                "Resources" => dictionary! { "XObject" => dictionary! { "Im" => im } },
            },
            form_content.content.clone(),
        )));
        let _ = form_content;
        let xo_id = doc.add_object(Object::Dictionary(dictionary! {
            "Fm" => form_id,
        }));
        let content = Stream::new(dictionary! {}, b"/Fm Do".to_vec());
        let cid = doc.add_object(Object::Stream(content));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Contents", Object::Reference(cid));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Resources", dictionary! { "XObject" => xo_id });
        let mut e = FolioEngine::new();
        e.doc = doc;
        let d = apply(
            &mut e,
            "redactRect",
            json!({"page":0,"rect":[0,0,612,792]}),
        );
        assert_eq!(d["removed"]["images"], 0);
        assert_eq!(d["retained"]["image_reasons"][im.0.to_string()], "drawn_inside_form");
        assert!(e.doc.objects.contains_key(&im));
    }

    // -- metadata scrubbing ----------------------------------------------------

    #[test]
    fn redact_rect_scrubs_pieceinfo_xmp_and_info() {
        let mut doc = build_blank_doc(1);
        let page_id = *doc.get_pages().values().next().unwrap();
        let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        // Page /PieceInfo + /Metadata, catalog /Metadata (XMP), trailer /Info.
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("PieceInfo", dictionary! { "app" => dictionary! {} });
        let xmp_id = doc.add_object(Object::Stream(Stream::new(
            dictionary! { "Type" => "Metadata", "Subtype" => "XML" },
            b"<x:xmpmeta>secret</x:xmpmeta>".to_vec(),
        )));
        doc.get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Metadata", Object::Reference(xmp_id));
        doc.get_object_mut(catalog_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Metadata", Object::Reference(xmp_id));
        let info_id = doc.add_object(Object::Dictionary(dictionary! {
            "Title" => lopdf::text_string("classified"),
        }));
        doc.trailer.set("Info", info_id);

        let mut e = FolioEngine::new();
        e.doc = doc;
        let d = apply(
            &mut e,
            "redactRect",
            json!({"page":0,"rect":[0,0,1,1]}),
        );
        let meta = d["removed"]["metadata"].as_object().unwrap();
        assert_eq!(meta["PieceInfo"], 1);
        assert_eq!(meta["Metadata"], 2);
        assert_eq!(meta["Info"], 1);
        // Verify on the committed document: keys gone, objects pruned.
        let page = e.page_id(0).unwrap();
        let pd = e.doc.get_object(page).unwrap().as_dict().unwrap();
        assert!(pd.get(b"PieceInfo").is_err());
        assert!(pd.get(b"Metadata").is_err());
        let catalog = e.doc.catalog().unwrap();
        assert!(catalog.get(b"Metadata").is_err());
        assert!(e.doc.trailer.get(b"Info").is_err());
        assert!(!e.doc.objects.contains_key(&xmp_id));
        assert!(!e.doc.objects.contains_key(&info_id));
        // Saved bytes reopen without the metadata.
        let b64 = saved_b64(&mut e);
        let reloaded = Document::load_mem(&b64_decode(&b64).unwrap()).unwrap();
        assert!(reloaded.trailer.get(b"Info").is_err());
    }
}
