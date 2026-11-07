//! Constraint read surface. C1/C2 store and validate h/v anchors, extent
//! bounds, the aspect-lock flag and parent-or-sibling `relative_to` targets
//! on absolute children but do not solve them: `evaluateLayout`/`renderFrame`
//! ignore `Node.constraints`, so every reported entry carries
//! `enforced:false` and `solving` is `"storage-only"`. x/y variable bindings
//! still overlay evaluated position independently; there is no conflict
//! because constraints are not yet applied to geometry.
use crate::model::*;
use ignition_core::EngineError;
use serde_json::{json, Value};
/// Read op: stored constraints for every node that carries them, optionally
/// filtered to one node id. Silent like `listBindings` — an absent filter or
/// an unknown id simply yields fewer entries. Each node's `constraints`
/// object serializes exactly the stored fields (absent optional fields are
/// omitted), including the C2 `min_width`/`max_width`/`min_height`/
/// `max_height`/`aspect_locked` members when present.
pub fn describe(s: &State, p: &Value) -> Result<Value, EngineError> {
    if let Some(obj) = p.as_object() {
        if obj.keys().any(|k| k != "id") {
            return Err(bad("unknown constraint filter field"));
        }
    }
    let node_filter = p
        .get("id")
        .map(|v| v.as_u64().ok_or_else(|| bad("expected integer id")))
        .transpose()?;
    let nodes: Vec<Value> = s
        .nodes
        .values()
        .filter(|n| node_filter.is_none_or(|id| n.id == id))
        .filter_map(|n| {
            n.constraints.as_ref().map(|c| {
                json!({
                    "node_id": n.id,
                    "constraints": c,
                    "enforced": false,
                })
            })
        })
        .collect();
    Ok(json!({
        "solving": "storage-only",
        "accepted": {
            "horizontal": ["left", "right", "center", "stretch"],
            "vertical": ["top", "bottom", "center", "stretch"],
            "relative_to": ["parent", "sibling"],
            "extent_bounds": "finite, 0..=1e7 per axis, min<=max when both present",
        },
        "rejected": [
            "scale anchors",
            "relative_to outside the parent/sibling scope",
            "non-finite, negative or >1e7 extent bounds",
            "min exceeding max on the same axis",
        ],
        "nodes": nodes,
    }))
}
