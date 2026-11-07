//! Variables, modes and property bindings. Bindings are a read/render-time
//! overlay: [`effective`] produces a patched copy of the state for layout,
//! sizing and raster evaluation while the stored document keeps authored
//! values, so undo/history/snapshots never bake resolved numbers into nodes.
use crate::model::*;
use ignition_core::EngineError;
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

/// Channel clamp for fill bindings: round to the nearest u8 and saturate.
fn channel(v: f64) -> u8 {
    v.round().clamp(0., 255.) as u8
}
/// Space clamp for gap/padding bindings, mirroring the authored 0..100000 bound.
fn space(v: f64) -> f64 {
    v.clamp(0., 100000.)
}
/// Resolve one binding to its numeric value in the active mode, or `None`
/// when the variable is missing, has no value in the mode, or resolves to a
/// non-number literal (unreachable for validated state; defensive only).
fn binding_number(s: &State, b: &Binding, mode: &str) -> Option<f64> {
    let v = s.variables.get(&b.variable_id)?;
    match resolve_mode_value(s, v, mode) {
        Ok(Literal::Number { value }) if value.is_finite() => Some(value),
        _ => None,
    }
}
/// Memoized [`resolve_mode_value`] for read paths that resolve many
/// (variable, mode) pairs in one call. Every successfully resolved hop is
/// cached under its own `(variable_id, mode)` key, so a dense document of
/// alias chains stays linear instead of re-walking shared suffixes per
/// variable. Errors are never cached: validated state cannot produce them,
/// and an error's message is position-specific anyway.
fn resolve_cached(
    s: &State,
    variable: &Variable,
    mode: &str,
    memo: &mut BTreeMap<(String, String), Literal>,
) -> Result<Literal, EngineError> {
    let key = (variable.id.clone(), mode.to_string());
    if let Some(literal) = memo.get(&key) {
        return Ok(literal.clone());
    }
    let mut seen = BTreeSet::from([variable.id.clone()]);
    let mut visited = vec![variable.id.clone()];
    let mut current_var = variable;
    let mut current = variable
        .values
        .get(mode)
        .ok_or_else(|| bad("variable has no value in this mode"))?;
    let result = loop {
        match current {
            VarValue::Number { value } if valid_number(*value) => {
                if current_var.var_type == VarType::Number {
                    break Ok(Literal::Number { value: *value });
                }
                break Err(bad("variable literal kind does not match its type"));
            }
            VarValue::String { value } if value.len() <= MAX_STRING_VALUE_BYTES => {
                if current_var.var_type == VarType::String {
                    break Ok(Literal::String {
                        value: value.clone(),
                    });
                }
                break Err(bad("variable literal kind does not match its type"));
            }
            VarValue::Boolean { value } => {
                if current_var.var_type == VarType::Boolean {
                    break Ok(Literal::Boolean { value: *value });
                }
                break Err(bad("variable literal kind does not match its type"));
            }
            VarValue::Alias { variable_id } => {
                if !valid_symbol_id(variable_id) || !seen.insert(variable_id.clone()) {
                    break Err(bad("variable aliases must not form a cycle"));
                }
                let Some(target) = s.variables.get(variable_id) else {
                    break Err(bad("alias target does not exist"));
                };
                if target.var_type != current_var.var_type {
                    break Err(bad("alias target must have the same variable type"));
                }
                if let Some(literal) = memo.get(&(variable_id.clone(), mode.to_string())) {
                    break Ok(literal.clone());
                }
                let Some(next) = target.values.get(mode) else {
                    break Err(bad("alias has no value in this mode"));
                };
                current = next;
                current_var = target;
                visited.push(variable_id.clone());
            }
            _ => break Err(bad("variable value exceeds bounds")),
        }
    };
    // Every visited variable shares the chain's type and resolves to the same
    // terminal literal in this mode, so the result is valid for all of them.
    if let Ok(literal) = &result {
        for id in visited {
            memo.insert((id, mode.to_string()), literal.clone());
        }
    }
    result
}
/// [`binding_number`] against the shared per-call resolution memo.
fn binding_number_cached(
    s: &State,
    b: &Binding,
    mode: &str,
    memo: &mut BTreeMap<(String, String), Literal>,
) -> Option<f64> {
    let v = s.variables.get(&b.variable_id)?;
    match resolve_cached(s, v, mode, memo) {
        Ok(Literal::Number { value }) if value.is_finite() => Some(value),
        _ => None,
    }
}
/// Return a state view with every resolvable binding applied. Borrowed when
/// there is nothing to overlay (no bindings or no active mode), so the common
/// case pays nothing. Patched fields: fill channels (rounded/clamped),
/// layout gap/padding (clamped to authored bounds), local x/y, and width/
/// height only while the matching sizing axis stays `fixed` — a later hug/fill
/// switch leaves the binding dormant instead of invalid.
pub fn effective(s: &State) -> Cow<'_, State> {
    if s.bindings.is_empty() {
        return Cow::Borrowed(s);
    }
    let Some(mode) = s.active_mode.as_deref() else {
        return Cow::Borrowed(s);
    };
    let patches: Vec<(u64, BindPath, f64)> = s
        .bindings
        .iter()
        .filter_map(|b| binding_number(s, b, mode).map(|n| (b.node_id, b.path, n)))
        .collect();
    if patches.is_empty() {
        return Cow::Borrowed(s);
    }
    let mut next = s.clone();
    for (node_id, path, value) in patches {
        let Some(slot) = next.nodes.get_mut(&node_id) else {
            continue;
        };
        let n = Arc::make_mut(slot);
        match path {
            BindPath::FillR => n.fill[0] = channel(value),
            BindPath::FillG => n.fill[1] = channel(value),
            BindPath::FillB => n.fill[2] = channel(value),
            BindPath::FillA => n.fill[3] = channel(value),
            BindPath::Gap => {
                if let Some(l) = n.layout.as_mut() {
                    l.gap = space(value);
                }
            }
            BindPath::PaddingTop => {
                if let Some(l) = n.layout.as_mut() {
                    l.padding_top = space(value);
                }
            }
            BindPath::PaddingRight => {
                if let Some(l) = n.layout.as_mut() {
                    l.padding_right = space(value);
                }
            }
            BindPath::PaddingBottom => {
                if let Some(l) = n.layout.as_mut() {
                    l.padding_bottom = space(value);
                }
            }
            BindPath::PaddingLeft => {
                if let Some(l) = n.layout.as_mut() {
                    l.padding_left = space(value);
                }
            }
            BindPath::X => n.x = value,
            BindPath::Y => n.y = value,
            BindPath::Width if n.sizing.x == SizeMode::Fixed => n.width = value,
            BindPath::Height if n.sizing.y == SizeMode::Fixed => n.height = value,
            _ => {}
        }
    }
    Cow::Owned(next)
}
/// Read op: modes, active mode, per-variable raw values plus resolved
/// literals per mode and alias/coverage diagnostics, and bindings with their
/// active-mode resolved numbers.
pub fn describe(s: &State) -> Result<Value, EngineError> {
    let active = s.active_mode.as_deref();
    // One memo shared across every variable/mode resolution and binding read
    // keeps dense alias documents linear per call.
    let mut memo = BTreeMap::new();
    let mut variables = Vec::with_capacity(s.variables.len());
    for v in s.variables.values() {
        let mut resolved = serde_json::Map::new();
        let mut problems = Vec::new();
        for mode in v.values.keys() {
            match resolve_cached(s, v, mode, &mut memo) {
                Ok(literal) => {
                    resolved.insert(mode.clone(), serde_json::to_value(&literal)?);
                }
                Err(e) => problems.push(format!("{mode}: {}", e.message)),
            }
        }
        if let Some(m) = active {
            if !v.values.contains_key(m) {
                problems.push(format!("no value in active mode '{m}'"));
            }
        }
        variables.push(json!({
            "id": v.id,
            "name": v.name,
            "type": v.var_type,
            "values": v.values,
            "resolved": resolved,
            "problems": problems,
        }));
    }
    let bindings: Vec<Value> = s
        .bindings
        .iter()
        .map(|b| {
            let resolved = active.and_then(|m| binding_number_cached(s, b, m, &mut memo));
            json!({
                "node_id": b.node_id,
                "path": b.path,
                "variable_id": b.variable_id,
                "resolved": resolved,
            })
        })
        .collect();
    Ok(json!({
        "modes": s.modes,
        "active_mode": s.active_mode,
        "variables": variables,
        "bindings": bindings,
    }))
}
/// Read op: bindings, optionally filtered to one node.
pub fn list(s: &State, p: &Value) -> Result<Value, EngineError> {
    if let Some(obj) = p.as_object() {
        if obj.keys().any(|k| k != "node_id") {
            return Err(bad("unknown binding filter field"));
        }
    }
    let node_filter = p
        .get("node_id")
        .map(|v| {
            v.as_u64()
                .ok_or_else(|| bad("expected integer node_id"))
        })
        .transpose()?;
    let active = s.active_mode.as_deref();
    let bindings: Vec<Value> = s
        .bindings
        .iter()
        .filter(|b| node_filter.is_none_or(|id| b.node_id == id))
        .map(|b| {
            json!({
                "node_id": b.node_id,
                "path": b.path,
                "variable_id": b.variable_id,
                "resolved": active.and_then(|m| binding_number(s, b, m)),
            })
        })
        .collect();
    Ok(json!({"bindings": bindings}))
}
