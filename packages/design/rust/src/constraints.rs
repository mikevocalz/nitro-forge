//! Constraint-anchor read surface. C1 stores and validates h/v anchors on
//! absolute children but does not solve them: `evaluateLayout`/`renderFrame`
//! ignore `Node.constraints`, so every reported entry carries
//! `enforced:false` and `solving` is `"storage-only"`. x/y variable bindings
//! still overlay evaluated position independently; there is no conflict
//! because anchors are not yet applied to geometry.
use crate::model::*;
use ignition_core::EngineError;
use serde_json::{json, Value};
/// Read op: stored constraints for every node that carries them, optionally
/// filtered to one node id. Silent like `listBindings` — an absent filter or
/// an unknown id simply yields fewer entries.
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
                    "constraints": {
                        "horizontal": c.horizontal,
                        "vertical": c.vertical,
                        "relative_to": c.relative_to,
                    },
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
        },
        "rejected": ["scale", "non-parent relative_to"],
        "nodes": nodes,
    }))
}
