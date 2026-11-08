//! Dev-handoff read and export-slice manifest (slice F, NYC-Tron L-12
//! `DevHandoffInspector` storage scope and L-15 `MultiExportSlices`
//! membership scope). Everything here is a pure deterministic read: no
//! clocks, no mutation, no journal entries, no events.
//!
//! `describeHandoff` projects the document into the handoff contract —
//! spacing (evaluated layout measurements), typography (text styles),
//! assets (none are admitted, so the list is always empty) and deterministic
//! structural "code hints" per node. It is NOT a code generator: hints are
//! canonical descriptions of stored state, tagged with the engine's
//! `state_revision` so hosts can detect staleness. Real handoff integration
//! and any L-06 reusable-styles surface stay host-side/deferred.
//!
//! `exportSlice` renders one frame/component subtree — screen membership is
//! the prototype catalog's screen set, which is always a subset of
//! frame/component nodes — to raw RGBA8 through the same Prism flatten path
//! as `renderFrame`, plus a JSON manifest describing the slice's nodes,
//! styles and measurements. There is no PNG/SVG/vector encoder; per-slice
//! output format and presets remain host-side. Slice scale is an optional
//! bounded multiplier ([`MIN_SLICE_SCALE`]..=[`MAX_SLICE_SCALE`], default
//! 1) because the engine must pick a pixel size to rasterize; everything
//! else about delivery format stays with the host.
use crate::model::*;
use crate::{components, layout, variables};
use ignition_core::EngineError;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
/// Measurement cap for `describeHandoff`: the first N evaluated boxes in
/// document DFS order are returned with `truncated:true` beyond it. The
/// engine's own bounds (1024 stored nodes + 16384 expansion clones) still
/// apply upstream, so truncation only affects extreme documents.
pub const MAX_HANDOFF_BOXES: usize = 8192;
/// Snippet cap: one deterministic hint per stored node, first N in DFS
/// order, with `snippets_truncated`/`snippets_total` reporting the rest.
pub const MAX_HANDOFF_SNIPPETS: usize = 512;
/// Manifest node cap for `exportSlice`; the raster itself is never
/// truncated — only the descriptive node list.
pub const MAX_EXPORT_MANIFEST_NODES: usize = 4096;
/// UTF-8 byte cap for text content previews in handoff nodes/typography.
const CONTENT_PREVIEW_BYTES: usize = 256;
/// Character cap for the one-line hint embedded in each snippet.
const HINT_PREVIEW_CHARS: usize = 48;
/// Optional `exportSlice` scale bounds. The engine needs a concrete pixel
/// size; hosts pick the multiplier within this range (default 1).
pub const MIN_SLICE_SCALE: f64 = 0.25;
pub const MAX_SLICE_SCALE: f64 = 4.0;
/// Slice raster budget: the same 1_048_576-pixel output ceiling the root
/// canvas validation enforces, applied to `ceil(w*scale) * ceil(h*scale)`.
pub const MAX_SLICE_PIXELS: u64 = 1_048_576;
/// Stored-node DFS pre-order (same traversal `components::expand` uses),
/// with each node's parent and depth for handoff projections.
fn stored_order(s: &State) -> (Vec<u64>, BTreeMap<u64, (Option<u64>, usize)>) {
    let mut order = vec![];
    let mut info = BTreeMap::new();
    let mut stack = vec![(1u64, None, 0usize)];
    while let Some((id, parent, depth)) = stack.pop() {
        order.push(id);
        info.insert(id, (parent, depth));
        let n = &s.nodes[&id];
        for child in n.children.iter().rev() {
            stack.push((*child, Some(id), depth + 1));
        }
    }
    (order, info)
}
/// Bounded text projection: full font fields, content preview truncated at
/// a char boundary plus exact byte length and a truncation flag.
fn text_json(t: &TextStyle) -> Value {
    let bytes = t.content.as_bytes();
    let mut end = CONTENT_PREVIEW_BYTES.min(bytes.len());
    while end > 0 && !t.content.is_char_boundary(end) {
        end -= 1;
    }
    json!({
        "content": &t.content[..end],
        "content_bytes": t.content.len(),
        "content_truncated": end < t.content.len(),
        "font_family": t.font_family,
        "font_size": t.font_size,
        "font_weight": t.font_weight,
        "font_style": t.font_style,
    })
}
fn num(v: f64) -> Value {
    // f64 Display is the shortest round-trip form; validated state keeps
    // every emitted number finite, so this stays deterministic.
    json!(v)
}
/// One node's handoff/manifest entry. `b` is the evaluated layout box
/// (authoritative geometry); `origin` optionally rebases x/y to slice
/// coordinates for export manifests. Optional feature fields appear only
/// when present, mirroring the stored-state serialization style.
fn node_json(
    n: &Node,
    b: &layout::BoxNode,
    parent: Option<u64>,
    depth: usize,
    origin: Option<(f64, f64)>,
) -> Value {
    let (ox, oy) = origin.unwrap_or((0., 0.));
    let mut v = json!({
        "id": n.id,
        "parent": parent,
        "depth": depth,
        "kind": n.kind,
        "name": n.name,
        "x": num(b.x - ox),
        "y": num(b.y - oy),
        "width": num(b.width),
        "height": num(b.height),
        "fill": n.fill,
        "visible": b.visible,
        "renderable": b.renderable,
    });
    if n.sizing != Sizing::default() {
        v["sizing"] = json!(n.sizing);
    }
    if let Some(l) = &n.layout {
        v["layout"] = json!(l);
    }
    if let Some(t) = &n.text {
        v["text"] = text_json(t);
    }
    if let Some(c) = &n.constraints {
        v["constraints"] = json!(c);
    }
    if let Some(spec) = &n.instance {
        v["instance"] = json!({
            "component": spec.component,
            "variant": spec.variant,
            "overrides": spec.overrides.len(),
        });
    }
    if !n.variants.is_empty() {
        v["variants"] = json!(n.variants.len());
    }
    v
}
/// Serde tag of an enum value (`"row"`, `"space-between"`, …) for hint
/// strings, matching the lowercase/kebab-case JSON spellings.
fn tag<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|x| x.as_str().map(str::to_string))
        .unwrap_or_default()
}
/// Deterministic one-line structural hint per node kind — a "code hint"
/// in the L-12 sense (what a developer needs to know), never generated
/// source. Numbers use the same shortest-round-trip formatting as the
/// JSON projections.
fn hint(n: &Node, b: &layout::BoxNode) -> String {
    // f64 Display is the shortest round-trip form; validated state keeps
    // every emitted number finite, so hints stay deterministic.
    let size = format!("{}x{}", b.width, b.height);
    let fill = format!(
        "rgba({},{},{},{})",
        n.fill[0], n.fill[1], n.fill[2], n.fill[3]
    );
    match n.kind {
        Kind::Text => {
            let t = n.text.as_ref().expect("validated text node");
            let preview: String = t.content.chars().take(HINT_PREVIEW_CHARS).collect();
            format!(
                "text \"{preview}\" {} {} weight={} style={}",
                t.font_family,
                t.font_size,
                t.font_weight,
                tag(&t.font_style)
            )
        }
        Kind::Instance => {
            let spec = n.instance.as_ref().expect("validated instance node");
            let variant = spec
                .variant
                .as_deref()
                .map(|v| format!(" variant=\"{v}\""))
                .unwrap_or_default();
            format!(
                "instance of component {}{variant} overrides={} {size} {fill}",
                spec.component,
                spec.overrides.len()
            )
        }
        Kind::Component => {
            let layout_hint = n
                .layout
                .as_ref()
                .map(|l| {
                    format!(
                        " autolayout {} gap={} pad={},{},{},{}",
                        tag(&l.direction),
                        l.gap,
                        l.padding_top,
                        l.padding_right,
                        l.padding_bottom,
                        l.padding_left
                    )
                })
                .unwrap_or_else(|| " absolute".into());
            format!(
                "component \"{}\" {} variants={} children={}{}",
                n.name,
                size,
                n.variants.len(),
                n.children.len(),
                layout_hint
            )
        }
        Kind::Frame => {
            let layout_hint = n
                .layout
                .as_ref()
                .map(|l| {
                    format!(
                        " autolayout {} gap={} pad={},{},{},{} align={} justify={}",
                        tag(&l.direction),
                        l.gap,
                        l.padding_top,
                        l.padding_right,
                        l.padding_bottom,
                        l.padding_left,
                        tag(&l.align),
                        tag(&l.justify)
                    )
                })
                .unwrap_or_else(|| " absolute".into());
            format!(
                "frame \"{}\" {} children={}{}",
                n.name,
                size,
                n.children.len(),
                layout_hint
            )
        }
        Kind::Rect | Kind::Ellipse => format!("{} {} {}", tag(&n.kind), size, fill),
    }
}
/// Read op `describeHandoff`: the bounded L-12 projection. Runs the same
/// variables→expansion→layout pipeline as `evaluateLayout`, so expansion
/// bound failures propagate honestly. Output is deterministic: nodes and
/// snippets follow stored DFS order, measurements follow evaluated box
/// order, every optional field is presence-gated.
pub fn describe(s: &State, revision: u64) -> Result<Value, EngineError> {
    let effective = variables::effective(s);
    let expanded = components::expand(&effective)?;
    let boxes = layout::evaluate(&expanded)?;
    let by_id: BTreeMap<u64, &layout::BoxNode> = boxes.iter().map(|b| (b.id, b)).collect();
    let root = &s.nodes[&1];
    let (order, info) = stored_order(s);
    let mut nodes = Vec::with_capacity(order.len());
    let mut typography = vec![];
    let mut snippets = vec![];
    let mut snippets_total = 0usize;
    for id in &order {
        let n = &s.nodes[id];
        let Some(b) = by_id.get(id).copied() else {
            continue;
        };
        let (parent, depth) = info[id];
        nodes.push(node_json(n, b, parent, depth, None));
        if n.kind == Kind::Text {
            typography.push(json!({
                "node": n.id,
                "name": n.name,
                "box": {"x": num(b.x), "y": num(b.y), "width": num(b.width), "height": num(b.height)},
                "text": text_json(n.text.as_ref().expect("validated text node")),
            }));
        }
        if snippets.len() < MAX_HANDOFF_SNIPPETS {
            snippets.push(json!({
                "node": n.id,
                "state_revision": revision,
                "hint": hint(n, b),
            }));
        }
        snippets_total += 1;
    }
    let screens: Vec<Value> = s
        .prototype
        .screens
        .iter()
        .filter_map(|sc| {
            let n = s.nodes.get(&sc.node)?;
            let mut v = json!({
                "node": sc.node,
                "name": n.name,
                "kind": n.kind,
                "entry": sc.entry,
            });
            if let Some(b) = by_id.get(&sc.node) {
                v["box"] = json!({"x": num(b.x), "y": num(b.y), "width": num(b.width), "height": num(b.height)});
            }
            Some(v)
        })
        .collect();
    let total_boxes = boxes.len();
    let truncated = total_boxes > MAX_HANDOFF_BOXES;
    let measurements: Vec<Value> = boxes
        .iter()
        .take(MAX_HANDOFF_BOXES)
        .map(|b| serde_json::to_value(b).expect("layout box serializes"))
        .collect();
    Ok(json!({
        "state_revision": revision,
        "title": s.title,
        "canvas": {"node": 1, "width": num(root.width), "height": num(root.height)},
        "units": "document",
        "screens": screens,
        "nodes": nodes,
        "measurements": {
            "total": total_boxes,
            "truncated": truncated,
            "boxes": measurements,
        },
        "typography": typography,
        "assets": [],
        "snippets": snippets,
        "snippets_total": snippets_total,
        "snippets_truncated": snippets_total > MAX_HANDOFF_SNIPPETS,
        "deferred": [
            "PNG/SVG/vector export encoders do not exist; exportSlice returns raw RGBA8 plus a JSON manifest only",
            "snippets are deterministic structural hints, not generated code",
            "no image or asset nodes are admitted; assets is always empty",
            "export presets, per-slice output formats and multi-slice batching are host-side",
            "presence is collaboration transport only and never engine state",
        ],
    }))
}
/// Expanded-state subtree membership for one slice root: every descendant
/// id reachable through `children`, bounded by the expansion node budget.
pub fn subtree_members(expanded: &State, root: u64) -> Result<BTreeSet<u64>, EngineError> {
    let mut members = BTreeSet::new();
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        if !members.insert(id) {
            continue;
        }
        if members.len() > MAX_EXPANDED_LIMIT {
            return Err(bad("export slice subtree exceeds node budget"));
        }
        if let Some(n) = expanded.nodes.get(&id) {
            for child in &n.children {
                stack.push(*child);
            }
        }
    }
    Ok(members)
}
/// Stored-node count plus expansion-clone bound: the largest subtree a
/// validated document can materialize for one read.
const MAX_EXPANDED_LIMIT: usize = 1024 + 16384 + 1;
/// Parent/depth map for the slice subtree in the expanded state, used by
/// the manifest's node entries.
pub fn subtree_info(expanded: &State, root: u64) -> BTreeMap<u64, (Option<u64>, usize)> {
    let mut info = BTreeMap::new();
    let mut stack = vec![(root, None, 0usize)];
    while let Some((id, parent, depth)) = stack.pop() {
        if info.contains_key(&id) {
            continue;
        }
        info.insert(id, (parent, depth));
        if let Some(n) = expanded.nodes.get(&id) {
            for child in n.children.iter().rev() {
                stack.push((*child, Some(id), depth + 1));
            }
        }
    }
    info
}
/// Slice manifest node list builder: evaluated boxes filtered to the
/// subtree, joined with expanded-state node data, rebased to the slice
/// origin and capped at [`MAX_EXPORT_MANIFEST_NODES`].
pub fn manifest_nodes(
    expanded: &State,
    boxes: &[&layout::BoxNode],
    info: &BTreeMap<u64, (Option<u64>, usize)>,
    origin: (f64, f64),
) -> (Vec<Value>, usize, bool) {
    let total = boxes.len();
    let truncated = total > MAX_EXPORT_MANIFEST_NODES;
    let nodes = boxes
        .iter()
        .take(MAX_EXPORT_MANIFEST_NODES)
        .filter_map(|b| {
            let n = expanded.nodes.get(&b.id)?;
            let (parent, depth) = info.get(&b.id).copied().unwrap_or((None, 0));
            Some(node_json(n, b, parent, depth, Some(origin)))
        })
        .collect();
    (nodes, total, truncated)
}
