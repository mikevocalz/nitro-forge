//! Components, variants and materialized instances. An instance node stores
//! only `InstanceSpec { component, variant, overrides }`; its rendered
//! subtree is produced here as a deterministic, read-only expansion at
//! `evaluateLayout`/`renderFrame`/`describeComponents` time and is never
//! persisted. Expansion clones the component subtree under fresh synthetic
//! ids (`>= SAFE_ID`), applies the selected variant's property bundle and
//! then the instance's own overrides, and recurses into nested instances.
//! Bounds: [`MAX_EXPANSION_DEPTH`] instance nesting levels and
//! [`MAX_EXPANDED_NODES`] total cloned nodes per expansion; validated state
//! already rejects component reference cycles, so these caps bound every
//! acyclic document. `detachInstance` is the only path that persists an
//! expansion, and it writes ordinary nodes through the normal op pipeline.
use crate::model::*;
use ignition_core::EngineError;
use serde_json::{json, Value};
use std::{borrow::Cow, collections::BTreeMap, sync::Arc};
/// Maximum instance nesting depth expanded per read (component → instance →
/// component …). Deeper chains fail reads with an honest error while
/// mutations remain possible so the document can be repaired.
pub const MAX_EXPANSION_DEPTH: usize = 8;
/// Maximum cloned nodes materialized by one expansion, across all
/// instances in the document.
pub const MAX_EXPANDED_NODES: usize = 16384;
/// First synthetic id; real node ids are always `< next_id <= SAFE_ID`.
const SYNTH_BASE: u64 = SAFE_ID;
fn is_instance(s: &State) -> bool {
    s.nodes.values().any(|n| n.kind == Kind::Instance)
}
/// Return a state view with every instance expanded into ordinary cloned
/// nodes. Borrowed when the document has no instances. The expanded state is
/// transient: synthetic descendant ids are `>= SAFE_ID`, instance nodes keep
/// their real ids and gain the component root's `children`/`layout`, and
/// expanded `kind` values stay `component`/`instance` so `evaluateLayout`
/// boxes and `renderFrame` shapes remain honest about provenance.
pub fn expand(s: &State) -> Result<Cow<'_, State>, EngineError> {
    if !is_instance(s) {
        return Ok(Cow::Borrowed(s));
    }
    let mut nodes = s.nodes.clone();
    // Document order is the stored tree's DFS pre-order, so expansion is
    // deterministic for a given state.
    let mut order = vec![];
    let mut stack = vec![1u64];
    while let Some(id) = stack.pop() {
        let n = &nodes[&id];
        if n.kind == Kind::Instance {
            order.push(id);
        }
        for child in n.children.iter().rev() {
            stack.push(*child);
        }
    }
    let mut next_synth = SYNTH_BASE;
    let mut budget = MAX_EXPANDED_NODES;
    for inst in order {
        expand_instance(&s.nodes, &mut nodes, inst, 1, &mut next_synth, &mut budget)?;
    }
    let mut out = s.clone();
    out.nodes = nodes;
    Ok(Cow::Owned(out))
}
/// Clone `component`'s subtree under `inst` in `nodes`, wire the instance's
/// children/layout from the component root, apply variant + instance
/// overrides, and recurse into nested instance clones. `depth` counts
/// instance nesting; `budget` is the shared cloned-node allowance.
///
/// `orig` is the pre-expansion node map (`s.nodes`): template ids, template
/// children and clone sources are always read from it, never from `nodes`.
/// `nodes` is mutated in place — earlier instances in document order (and
/// in-place expansion of instances stored inside component subtrees) would
/// otherwise leak their synthetic children into a later instance's template
/// walk and clone the already-expanded subtree a second time.
fn expand_instance(
    orig: &BTreeMap<u64, Arc<Node>>,
    nodes: &mut BTreeMap<u64, Arc<Node>>,
    inst_id: u64,
    depth: usize,
    next_synth: &mut u64,
    budget: &mut usize,
) -> Result<(), EngineError> {
    if depth > MAX_EXPANSION_DEPTH {
        return Err(bad("instance expansion depth exceeded"));
    }
    let spec = nodes[&inst_id]
        .instance
        .clone()
        .ok_or_else(|| bad("expanded node is not an instance"))?;
    // Snapshot the component root's template data from the pristine map
    // before mutating `nodes`.
    let (comp_children, comp_layout, comp_variants) = {
        let comp = orig
            .get(&spec.component)
            .ok_or_else(|| bad("instance references unknown component"))?;
        if comp.kind != Kind::Component {
            return Err(bad("instance target is not a component"));
        }
        (
            comp.children.clone(),
            comp.layout.clone(),
            comp.variants.clone(),
        )
    };
    // Collect the component subtree in DFS pre-order over `orig`, excluding
    // the root: the instance node itself plays the component root's role.
    // Walking the stored tree keeps stored instance leaves leaf-shaped —
    // their expansion output lives only in `nodes`.
    let mut template_ids = vec![];
    let mut stack: Vec<u64> = comp_children.iter().rev().copied().collect();
    while let Some(id) = stack.pop() {
        template_ids.push(id);
        let n = &orig[&id];
        for child in n.children.iter().rev() {
            stack.push(*child);
        }
    }
    if template_ids.len() + 1 > *budget {
        return Err(bad("instance expansion node budget exceeded"));
    }
    *budget -= template_ids.len();
    // First pass: clone every descendant under a fresh synthetic id.
    let mut map: BTreeMap<u64, u64> = BTreeMap::new();
    let mut nested = vec![];
    for tid in &template_ids {
        let clone_id = alloc_synth(next_synth)?;
        let mut clone = orig[tid].as_ref().clone();
        clone.id = clone_id;
        clone.children = vec![];
        // Instance clones keep their spec; they expand in the second pass.
        if clone.kind == Kind::Instance {
            nested.push(clone_id);
        }
        map.insert(*tid, clone_id);
        nodes.insert(clone_id, Arc::new(clone));
    }
    // Second pass: restore child links through the id map, and retarget
    // `constraints.relative_to` the same way — a clone's parent-or-sibling
    // reference names template ids that must resolve inside this expansion
    // (the component root id lands on the instance node itself).
    for tid in &template_ids {
        let clone_id = map[tid];
        let children: Vec<u64> = orig[tid]
            .children
            .iter()
            .map(|c| map[c])
            .collect();
        let clone = Arc::make_mut(nodes.get_mut(&clone_id).unwrap());
        clone.children = children;
        if let Some(c) = &mut clone.constraints {
            if let Some(r) = c.relative_to {
                c.relative_to = Some(if r == spec.component {
                    inst_id
                } else {
                    *map.get(&r).ok_or_else(|| {
                        bad("constraint target outside component subtree")
                    })?
                });
            }
        }
    }
    // Cloned `component` nodes keep their variant bundles, but those
    // overrides still name template ids. Retarget them at this expansion's
    // clones so the expanded form is self-consistent — `detachInstance`
    // then re-identifies them through its own map like every other field.
    // Instance specs are NOT retargeted: their overrides are interpreted
    // against their own component's template when the nested clone expands.
    for tid in &template_ids {
        if orig[tid].kind != Kind::Component || orig[tid].variants.is_empty() {
            continue;
        }
        let clone_id = map[tid];
        let clone = Arc::make_mut(nodes.get_mut(&clone_id).unwrap());
        for variant in &mut clone.variants {
            for ov in &mut variant.properties {
                ov.node = *map.get(&ov.node).ok_or_else(|| {
                    bad("variant override target outside component subtree")
                })?;
            }
        }
    }
    // The instance node becomes the materialized root: it inherits the
    // component root's flow layout and child list (synthetic ids), while
    // its own geometry/fill/visibility remain the root-level overrides
    // established at creation.
    {
        let inst = Arc::make_mut(nodes.get_mut(&inst_id).unwrap());
        inst.children = comp_children.iter().map(|c| map[c]).collect();
        inst.layout = comp_layout;
    }
    // Overrides: variant properties first, instance overrides second, so
    // instance values win on (node, path) conflicts. A target of the
    // component root id lands on the instance node itself.
    let mut overrides: Vec<NodeOverride> = vec![];
    if let Some(name) = &spec.variant {
        let variant = comp_variants
            .iter()
            .find(|v| &v.name == name)
            .ok_or_else(|| bad("instance variant does not exist on component"))?;
        overrides.extend(variant.properties.iter().cloned());
    }
    overrides.extend(spec.overrides.iter().cloned());
    for ov in &overrides {
        let target = if ov.node == spec.component {
            inst_id
        } else {
            *map.get(&ov.node)
                .ok_or_else(|| bad("override target is outside the component subtree"))?
        };
        apply_override(nodes.get_mut(&target).ok_or_else(|| {
            bad("override target does not exist")
        })?, ov)?;
    }
    // Nested instances expand after their clones are wired, in clone
    // (document) order.
    for nid in nested {
        expand_instance(orig, nodes, nid, depth + 1, next_synth, budget)?;
    }
    Ok(())
}
fn remap_children(
    children: &[u64],
    id_map: &BTreeMap<u64, u64>,
) -> Result<Vec<u64>, EngineError> {
    children
        .iter()
        .map(|c| {
            id_map
                .get(c)
                .copied()
                .ok_or_else(|| bad("expanded child missing from detach map"))
        })
        .collect()
}
fn alloc_synth(next: &mut u64) -> Result<u64, EngineError> {
    let id = next.checked_add(1).ok_or_else(|| bad("synthetic id exhausted"))?;
    *next = id;
    Ok(id)
}
/// Apply one validated override to a materialized node. Defensive: callers
/// run `validate` first, so mismatched path/value pairs cannot appear; the
/// match still fails closed rather than writing a wrong field.
fn apply_override(slot: &mut Arc<Node>, ov: &NodeOverride) -> Result<(), EngineError> {
    let n = Arc::make_mut(slot);
    match (&ov.path, &ov.value) {
        (OverridePath::Name, OverrideValue::Text(v)) => n.name = v.clone(),
        (OverridePath::Fill, OverrideValue::Color(v)) => n.fill = *v,
        (OverridePath::X, OverrideValue::Number(v)) => n.x = *v,
        (OverridePath::Y, OverrideValue::Number(v)) => n.y = *v,
        (OverridePath::Width, OverrideValue::Number(v)) => n.width = *v,
        (OverridePath::Height, OverrideValue::Number(v)) => n.height = *v,
        (OverridePath::Visible, OverrideValue::Flag(v)) => n.visible = *v,
        (OverridePath::Locked, OverrideValue::Flag(v)) => n.locked = *v,
        (OverridePath::Text, OverrideValue::Text(v)) => {
            let text = n
                .text
                .as_mut()
                .ok_or_else(|| bad("text override requires a text node"))?;
            text.content = v.clone();
        }
        _ => return Err(bad("override value does not match its path")),
    }
    Ok(())
}
/// Persist one instance's expansion as ordinary nodes: the instance node
/// becomes a `Frame` keeping its id and expanded (override-applied) fields,
/// and every expanded descendant is re-identified under fresh `next_id`
/// values. Nested expanded instances detach to frames the same way, and
/// variant bundles cloned onto nested `component` nodes have their override
/// targets re-identified through the same map so they still resolve inside
/// the detached subtree. Bindings do not follow clones (they key on node
/// id); overrides are baked because detachment is exactly the
/// materialization step. Expansion runs over the whole document (bounded by
/// the read caps), not just the detached cone — acceptable because detach
/// is a rare explicit op. Returns the full next state for the caller's
/// validate/layout/journal pipeline.
pub fn detach(s: &State, inst_id: u64) -> Result<State, EngineError> {
    let node = s
        .nodes
        .get(&inst_id)
        .ok_or_else(|| bad("unknown node"))?;
    if node.kind != Kind::Instance {
        return Err(bad("detach requires an instance node"));
    }
    let expanded = expand(s)?;
    let exp = expanded.into_owned();
    // Collect the expanded subtree in pre-order; every descendant carries a
    // synthetic id (`>= SAFE_ID`), the instance root keeps its real id.
    let mut exp_ids = vec![];
    let mut stack: Vec<u64> = exp.nodes[&inst_id].children.iter().rev().copied().collect();
    while let Some(id) = stack.pop() {
        exp_ids.push(id);
        for child in exp.nodes[&id].children.iter().rev() {
            stack.push(*child);
        }
    }
    let mut out = s.clone();
    let mut id_map: BTreeMap<u64, u64> = BTreeMap::new();
    for exp_id in &exp_ids {
        let new_id = out.next_id;
        out.next_id = out
            .next_id
            .checked_add(1)
            .ok_or_else(|| bad("identity exhausted"))?;
        id_map.insert(*exp_id, new_id);
    }
    // The instance root becomes a plain frame carrying the expanded fields
    // (variant + override results), with children remapped to real ids.
    {
        let mut root = (**exp.nodes.get(&inst_id).unwrap()).clone();
        root.kind = Kind::Frame;
        root.instance = None;
        root.children = remap_children(&root.children, &id_map)?;
        out.nodes.insert(inst_id, Arc::new(root));
    }
    for exp_id in &exp_ids {
        let src = &exp.nodes[exp_id];
        let mut clone = (**src).clone();
        clone.id = id_map[exp_id];
        clone.children = remap_children(&src.children, &id_map)?;
        // A cloned `component` node keeps its variant bundles; their
        // override targets still name template ids, so re-target them at
        // the detached clones (the whole component subtree was cloned, so
        // every target resolves through `id_map`). `constraints.relative_to`
        // on clones names synthetic expansion ids and remaps the same way;
        // real-id targets (the instance root's own parent/sibling scope)
        // stay untouched.
        for variant in &mut clone.variants {
            for ov in &mut variant.properties {
                ov.node = *id_map.get(&ov.node).ok_or_else(|| {
                    bad("variant override target outside detached subtree")
                })?;
            }
        }
        if let Some(c) = &mut clone.constraints {
            if let Some(r) = c.relative_to {
                if r >= SAFE_ID {
                    c.relative_to = Some(*id_map.get(&r).ok_or_else(|| {
                        bad("constraint target outside detached subtree")
                    })?);
                }
            }
        }
        if clone.kind == Kind::Instance {
            clone.kind = Kind::Frame;
            clone.instance = None;
        }
        out.nodes.insert(clone.id, Arc::new(clone));
    }
    Ok(out)
}
/// Read op: component definitions with their variant names, and instance
/// nodes with their resolved component/variant/override payloads. When the
/// document expansion currently exceeds a read bound, every instance reports
/// that reason as `unavailable_reason` (the NYC-Tron `unavailableReason`
/// contract field) instead of the op failing outright.
pub fn describe(s: &State) -> Result<Value, EngineError> {
    let expansion_error = match expand(s) {
        Ok(_) => None,
        Err(e) => Some(e.message),
    };
    let components: Vec<Value> = s
        .nodes
        .values()
        .filter(|n| n.kind == Kind::Component)
        .map(|n| {
            json!({
                "id": n.id,
                "name": n.name,
                "variants": n.variants.iter().map(|v| json!({
                    "name": v.name,
                    "properties": v.properties,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    let instances: Vec<Value> = s
        .nodes
        .values()
        .filter(|n| n.kind == Kind::Instance)
        .map(|n| {
            let spec = n.instance.as_ref();
            let mut entry = json!({
                "id": n.id,
                "name": n.name,
                "component": spec.map(|sp| sp.component),
                "variant": spec.and_then(|sp| sp.variant.clone()),
                "overrides": spec.map(|sp| sp.overrides.clone()).unwrap_or_default(),
            });
            if let Some(reason) = &expansion_error {
                entry["unavailable_reason"] = json!(reason);
            }
            entry
        })
        .collect();
    Ok(json!({
        "expansion": {
            "max_depth": MAX_EXPANSION_DEPTH,
            "max_nodes": MAX_EXPANDED_NODES,
            "persisted": false,
        },
        "components": components,
        "instances": instances,
    }))
}
