//! Constraint read surface. C1/C2 store and validate h/v anchors, extent
//! bounds, the aspect-lock flag and parent-or-sibling `relative_to` targets
//! on absolute children; `layout::evaluate_report` solves them
//! automatically during `evaluateLayout`/`renderFrame`/`exportSlice`/
//! `describeHandoff`, preserving the margins measured from unconstrained
//! geometry. `scale` anchors remain rejected (proportional scaling is still
//! deferred). This op reports the stored set plus the live solve outcome
//! computed against the current effective state.
use crate::{layout::ConstraintSolve, model::*};
use ignition_core::EngineError;
use serde_json::{json, Value};
use std::collections::BTreeSet;
/// Read op: stored constraints for every node that carries them, optionally
/// filtered to one node id. Silent like `listBindings` — an absent filter or
/// an unknown id simply yields fewer entries. Each node's `constraints`
/// object serializes exactly the stored fields (absent optional fields are
/// omitted), including the C2 `min_width`/`max_width`/`min_height`/
/// `max_height`/`aspect_locked` members when present.
///
/// `solve` is the live [`ConstraintSolve`] from evaluating the effective
/// (binding-resolved, unexpanded) state; `None` means layout evaluation
/// currently fails, so enforcement status is honestly `"unavailable"`.
pub fn describe(
    s: &State,
    p: &Value,
    solve: Option<&ConstraintSolve>,
) -> Result<Value, EngineError> {
    if let Some(obj) = p.as_object() {
        if obj.keys().any(|k| k != "id") {
            return Err(bad("unknown constraint filter field"));
        }
    }
    let node_filter = p
        .get("id")
        .map(|v| v.as_u64().ok_or_else(|| bad("expected integer id")))
        .transpose()?;
    let unsatisfied: BTreeSet<u64> = solve
        .map(|s| s.unsatisfied.iter().copied().collect())
        .unwrap_or_default();
    let nodes: Vec<Value> = s
        .nodes
        .values()
        .filter(|n| node_filter.is_none_or(|id| n.id == id))
        .filter_map(|n| {
            n.constraints.as_ref().map(|c| {
                json!({
                    "node_id": n.id,
                    "constraints": c,
                    "enforced": solve.is_some(),
                    "satisfied": solve.is_some() && !unsatisfied.contains(&n.id),
                })
            })
        })
        .collect();
    let solve_info = match solve {
        Some(s) => json!({
            "status": if s.unsatisfied.is_empty() { "solved" } else { "partial" },
            "constrained": s.constrained,
            "unsatisfied": s.unsatisfied,
        }),
        None => json!({"status": "unavailable"}),
    };
    Ok(json!({
        "solving": "evaluateLayout",
        "solve": solve_info,
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
        "notes": [
            "anchors pin flush to the reference edge/midpoint/span (no inset margins exist in the contract); unsatisfied nodes (cycles, bound/aspect conflicts) keep their unconstrained box and are listed in solve.unsatisfied",
            "x/y variable bindings set the baseline geometry first; constraints then override on the axes they anchor",
        ],
        "nodes": nodes,
    }))
}
