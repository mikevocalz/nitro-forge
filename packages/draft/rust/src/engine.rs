use crate::{commands, constraints, dimensions, model::*, profiles, render, snaps};
use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal, TaskContext,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, sync::Arc};
const HISTORY: usize = 16;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExtendedSnapshot<T> {
    kind: String,
    schema: u32,
    document: T,
}
fn requires_matching_reader(state: &State) -> bool {
    !state.circles.is_empty()
        || !state.arcs.is_empty()
        || !state.layers.is_empty()
        || !state.hatches.is_empty()
        || !state.dimensions.is_empty()
        || !state.sheets.is_empty()
        || !state.viewports.is_empty()
        || !state.blocks.is_empty()
        || !state.inserts.is_empty()
        || state.segments.values().any(|s| s.layer != 0)
        || state.circles.values().any(|c| c.layer != 0)
        || state.arcs.values().any(|a| a.layer != 0)
        || state.snaps.center
        || state.snaps.nearest_circle
        || state.snaps.tangent
        // Slice-A5 nonlinear constraint kinds are new persisted semantics;
        // linear kinds stay legacy schema1.
        || state
            .constraints
            .values()
            .any(|c| c.definition.nonlinear())
}

fn get<T: DeserializeOwned>(p: &Value, key: &str) -> Result<T, EngineError> {
    Ok(serde_json::from_value(
        p.get(key)
            .cloned()
            .ok_or_else(|| bad("required payload field missing"))?,
    )?)
}
fn optional<T: DeserializeOwned>(p: &Value, key: &str, default: T) -> Result<T, EngineError> {
    match p.get(key) {
        Some(v) => Ok(serde_json::from_value(v.clone())?),
        None => Ok(default),
    }
}
fn fields(p: &Value, allowed: &[&str]) -> Result<(), EngineError> {
    let o = p
        .as_object()
        .ok_or_else(|| bad("payload must be an object"))?;
    if o.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(bad("unsupported payload field"));
    }
    Ok(())
}
/// Resolve a hatch boundary payload: exactly one of explicit `loops`
/// (world-space point polygons) or `boundary_ids` (segment/circle/arc ids
/// traced once into sampled loops; optional `tolerance` in world units).
fn hatch_loops(s: &State, p: &Value) -> Result<Vec<Vec<[f64; 2]>>, EngineError> {
    match (p.get("loops").is_some(), p.get("boundary_ids").is_some()) {
        (true, true) | (false, false) => {
            Err(bad("hatch requires exactly one of loops or boundary_ids"))
        }
        (true, false) => {
            if p.get("tolerance").is_some() {
                return Err(bad("tolerance requires boundary_ids"));
            }
            Ok(serde_json::from_value(p["loops"].clone())?)
        }
        (false, true) => {
            let ids: Vec<u64> = serde_json::from_value(p["boundary_ids"].clone())?;
            let tolerance = optional(p, "tolerance", profiles::DEFAULT_TOLERANCE)?;
            Ok(profiles::boundary(s, &ids, tolerance)?
                .into_iter()
                .map(|poly| poly.into_iter().map(|(x, y)| [x, y]).collect())
                .collect())
        }
    }
}
/// True when any constraint references circle/arc `id`: `radius` and
/// `concentric` name curve entities directly; `tangent` mentions both
/// participants and `id` being a curve makes the mention a curve reference
/// (ids are unique across collections, so a segment participant can never
/// collide).
fn curve_referenced(s: &State, id: u64) -> bool {
    s.constraints.values().any(|c| match c.definition {
        Definition::Radius { entity, .. } => entity == id,
        Definition::Concentric { a, b } | Definition::Tangent { a, b, .. } => a == id || b == id,
        _ => false,
    })
}
fn patch<T: Serialize + DeserializeOwned>(
    current: &T,
    p: &Value,
    allowed: &[&str],
) -> Result<T, EngineError> {
    fields(p, allowed)?;
    let mut next = serde_json::to_value(current)?;
    for (k, v) in p.as_object().unwrap() {
        if k != "id" {
            next[k] = v.clone()
        }
    }
    Ok(serde_json::from_value(next)?)
}
pub struct DraftEngine {
    state: Arc<State>,
    journal: Journal<Arc<State>>,
    revision: u64,
    in_batch: bool,
}
impl Default for DraftEngine {
    fn default() -> Self {
        Self::new()
    }
}
impl DraftEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(State::default()),
            journal: Journal::new(HISTORY),
            revision: 0,
            in_batch: false,
        }
    }
    fn next_revision(&self) -> Result<u64, EngineError> {
        self.revision
            .checked_add(1)
            .filter(|v| *v <= SAFE_ID)
            .ok_or_else(|| bad("source revision budget exhausted"))
    }
    fn publish(&mut self, next: State, data: Value) -> Result<CommandResult, EngineError> {
        next.validate()?;
        if next == *self.state {
            return Ok(CommandResult::read_only(data));
        }
        let revision = self.next_revision()?;
        self.journal.record(self.state.clone());
        self.state = Arc::new(next);
        self.revision = revision;
        Ok(CommandResult::data(data))
    }
    fn execute_command(&mut self, text: &str) -> Result<CommandResult, EngineError> {
        match commands::parse(text)? {
            commands::Plan::Command {
                op,
                payload,
                message,
            } => {
                // Re-enter the authoritative operation, retaining locks, batch/read guards and history.
                let mut result = self.apply(Command::new(op, payload))?;
                if op == "solve" && result.data["status"] == "inconsistent" {
                    return Err(bad(&format!("Linear solve inconsistent: {}", result.data)));
                }
                let message = if op == "solve" {
                    format!(
                        "Linear solve: {}",
                        result.data["status"].as_str().unwrap_or("unknown")
                    )
                } else {
                    message.to_string()
                };
                result.data = json!({"message":message,"result":result.data});
                Ok(result)
            }
            commands::Plan::Circular {
                center,
                radius,
                arc,
            } => {
                let mut staged = Self {
                    state: self.state.clone(),
                    journal: Journal::new(1),
                    revision: self.revision,
                    in_batch: true,
                };
                let center = staged
                    .apply(Command::new(
                        "addPoint",
                        json!({"x":center[0],"y":center[1]}),
                    ))?
                    .data["point_id"]
                    .as_u64()
                    .ok_or_else(|| bad("center creation returned no ID"))?;
                let mut payload = json!({"center":center,"radius":radius});
                let op = if let Some((start, sweep)) = arc {
                    payload["start_deg"] = json!(start);
                    payload["sweep_deg"] = json!(sweep);
                    "addArc"
                } else {
                    "addCircle"
                };
                let result = staged.apply(Command::new(op, payload))?;
                self.publish((*staged.state).clone(),json!({"message":if arc.is_some(){"Arc created"}else{"Circle created"},"result":{"center_id":center,"entity":result.data}}))
            }
            commands::Plan::Line { a, b } => {
                let mut staged = Self {
                    state: self.state.clone(),
                    journal: Journal::new(1),
                    revision: self.revision,
                    in_batch: true,
                };
                let first = staged
                    .apply(Command::new("addPoint", json!({"x":a[0],"y":a[1]})))?
                    .data["point_id"]
                    .as_u64()
                    .ok_or_else(|| bad("point operation returned no identity"))?;
                let second = staged
                    .apply(Command::new("addPoint", json!({"x":b[0],"y":b[1]})))?
                    .data["point_id"]
                    .as_u64()
                    .ok_or_else(|| bad("point operation returned no identity"))?;
                let segment = staged
                    .apply(Command::new("addSegment", json!({"a":first,"b":second})))?
                    .data["segment_id"]
                    .as_u64()
                    .ok_or_else(|| bad("segment operation returned no identity"))?;
                self.publish((*staged.state).clone(),json!({"message":"Line created","result":{"point_ids":[first,second],"segment_id":segment}}))
            }
        }
    }
    /// `solve` op: the linear Gaussian stage runs first and is untouched;
    /// when any enabled slice-A5 nonlinear constraint exists, the bounded
    /// LM pass then refines the post-linear geometry against ALL enabled
    /// constraints (linear kinds contribute exact rows) and only a fully
    /// converged result publishes point/radius updates. `ctx` is `Some` only
    /// on the `apply_long` path so cancellation reaches the iteration loop.
    fn solve_apply(
        &mut self,
        p: &Value,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        fields(p, &["tolerance"])?;
        let tolerance = optional(p, "tolerance", 1e-7)?;
        let mut next = (*self.state).clone();
        let solved = constraints::solve(&next, tolerance)?;
        if solved.report.status == "inconsistent" {
            return Ok(CommandResult::read_only(serde_json::to_value(
                solved.report,
            )?));
        }
        for (id, x, y) in solved.points {
            if next.point_fixed(id) {
                continue;
            }
            if !coord(x) || !coord(y) {
                return Err(bad("solved coordinates exceed world budget"));
            }
            let point = Arc::make_mut(
                next.points
                    .get_mut(&id)
                    .ok_or_else(|| bad("solver lost point identity"))?,
            );
            point.x = x;
            point.y = y;
        }
        let mut report = serde_json::to_value(&solved.report)?;
        if next
            .constraints
            .values()
            .any(|c| c.enabled && c.definition.nonlinear())
        {
            let nl = constraints::solve_nonlinear(&next, tolerance, ctx)?;
            if nl.report.status == "solved" {
                for (id, x, y) in &nl.points {
                    if next.point_fixed(*id) {
                        continue;
                    }
                    if !coord(*x) || !coord(*y) {
                        return Err(bad("solved coordinates exceed world budget"));
                    }
                    let point = Arc::make_mut(
                        next.points
                            .get_mut(id)
                            .ok_or_else(|| bad("solver lost point identity"))?,
                    );
                    point.x = *x;
                    point.y = *y;
                }
                for (id, radius) in &nl.radii {
                    if let Some(c) = next.circles.get_mut(id) {
                        Arc::make_mut(c).radius = *radius;
                    } else if let Some(a) = next.arcs.get_mut(id) {
                        Arc::make_mut(a).radius = *radius;
                    } else {
                        return Err(bad("solver lost curve identity"));
                    }
                }
            }
            // Merge the nonlinear stage into the shared report: the top-level
            // status/residual/unsatisfied fields cover both stages while
            // rank/dof/scope keep describing the linear coordinate matrix.
            if nl.report.status == "unconverged" {
                report["status"] = json!("unconverged");
            }
            let mut unsat: Vec<u64> = report["unsatisfied_constraints"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_u64()).collect())
                .unwrap_or_default();
            unsat.extend(nl.report.unsatisfied_constraints.iter().copied());
            unsat.sort_unstable();
            unsat.dedup();
            report["unsatisfied_constraints"] = json!(unsat);
            let linear_residual = report["residual"].as_f64().unwrap_or(0.);
            report["residual"] = json!(linear_residual.max(nl.report.residual));
            report["nonlinear"] = json!({
                "status": nl.report.status,
                "iterations": nl.report.iterations,
                "residual": nl.report.residual,
                "unsatisfied_constraints": nl.report.unsatisfied_constraints,
            });
        }
        report["applied"] = json!(next != *self.state);
        self.publish(next, report)
    }
}
impl Engine for DraftEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Draft
    }
    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        if cmd.v != 1 || cmd.input.is_some() {
            return Err(bad("unsupported command version or binary input"));
        }
        if self.in_batch
            && matches!(
                cmd.op.as_str(),
                "describe" | "evaluate" | "querySnap" | "findProfiles"
            )
        {
            return Err(bad(
                "revision-bearing reads are unavailable inside an atomic batch",
            ));
        }
        let p = &cmd.payload;
        // `solve` owns its clone/publish so `apply_long` can pass a task
        // context into the nonlinear pass without a second dispatch layer.
        if cmd.op == "solve" {
            return self.solve_apply(p, None);
        }
        match cmd.op.as_str() {
            "executeCommand" => {
                fields(p, &["command"])?;
                let text: String = get(p, "command")?;
                return self.execute_command(&text);
            }
            "describe" => {
                fields(p, &[])?;
                let mut value = serde_json::to_value(&*self.state)?;
                for key in [
                    "circles",
                    "arcs",
                    "hatches",
                    "dimensions",
                    "sheets",
                    "viewports",
                    "blocks",
                    "inserts",
                ] {
                    if value.get(key).is_none() {
                        value[key] = json!({})
                    }
                }
                for (key, enabled) in [
                    ("center", self.state.snaps.center),
                    ("nearest_circle", self.state.snaps.nearest_circle),
                    ("tangent", self.state.snaps.tangent),
                ] {
                    value["snaps"][key] = json!(enabled)
                }
                value["source_revision"] = json!(self.revision);
                return Ok(CommandResult::read_only(value));
            }
            "evaluate" => {
                fields(p, &[])?;
                let mut evaluated = serde_json::Map::new();
                for (id, d) in &self.state.dimensions {
                    let mut value = serde_json::to_value(&**d)?;
                    match dimensions::measure(&self.state, d)? {
                        Some(m) => {
                            value["status"] = json!("linked");
                            value["measured"] = json!({"value":m.value,"lines":m.lines});
                        }
                        None => {
                            value["status"] = json!("orphaned");
                            value["measured"] = Value::Null;
                        }
                    }
                    evaluated.insert(id.to_string(), value);
                }
                return Ok(CommandResult::read_only(
                    json!({"points":self.state.points,"segments":self.state.segments,"circles":self.state.circles,"arcs":self.state.arcs,"hatches":self.state.hatches,"dimensions":evaluated,"sheets":self.state.sheets,"viewports":self.state.viewports,"blocks":self.state.blocks,"inserts":self.state.inserts,"order":self.state.order,"source_revision":self.revision}),
                ));
            }
            "querySnap" => {
                fields(p, &["x", "y", "tolerance", "anchor"])?;
                let candidate = snaps::query(
                    &self.state,
                    get(p, "x")?,
                    get(p, "y")?,
                    get(p, "tolerance")?,
                    optional(p, "anchor", None)?,
                )?;
                return Ok(CommandResult::read_only(
                    json!({"candidate":candidate,"source_revision":self.revision}),
                ));
            }
            "findProfiles" => {
                fields(p, &["tolerance"])?;
                let profiles = profiles::find(
                    &self.state,
                    optional(p, "tolerance", profiles::DEFAULT_TOLERANCE)?,
                )?;
                return Ok(CommandResult::read_only(
                    json!({"profiles":profiles,"source_revision":self.revision}),
                ));
            }
            "renderFrame" => return render::render(&self.state, &cmd, None),
            _ => {}
        }
        let mut next = (*self.state).clone();
        let mut data = json!({"ok":true});
        match cmd.op.as_str() {
            "new" => {
                fields(p, &["units"])?;
                next = State::default();
                next.units = optional(p, "units", "mm".to_string())?;
            }
            "addPoint" => {
                fields(p, &["x", "y", "locked"])?;
                let id = next.allocate()?;
                next.points.insert(
                    id,
                    Arc::new(Point {
                        id,
                        x: get(p, "x")?,
                        y: get(p, "y")?,
                        locked: optional(p, "locked", false)?,
                    }),
                );
                data = json!({"point_id":id});
            }
            "updatePoint" => {
                let id = get(p, "id")?;
                let point = next.point(id)?;
                fields(p, &["id", "x", "y", "locked"])?;
                if next.point_fixed(id)
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad(
                        "point is locked or belongs to a locked entity or layer",
                    ));
                }
                let point = patch(point, p, &["id", "x", "y", "locked"])?;
                next.points.insert(id, Arc::new(point));
            }
            "removePoint" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                next.point(id)?;
                if next.point_fixed(id)
                    || next.segments.values().any(|s| s.a == id || s.b == id)
                    || next.circles.values().any(|c| c.center == id)
                    || next.arcs.values().any(|a| a.center == id)
                {
                    return Err(bad("point is locked or referenced by geometry"));
                }
                for c in next.constraints.values() {
                    if next.definition_points(&c.definition)?.contains(&id) {
                        return Err(bad("point is referenced by a constraint"));
                    }
                }
                next.points.remove(&id);
            }
            "addSegment" => {
                fields(
                    p,
                    &[
                        "a", "b", "name", "color", "width", "visible", "locked", "layer", "block",
                    ],
                )?;
                let block: u64 = optional(p, "block", 0)?;
                if block != 0 && !next.blocks.contains_key(&block) {
                    return Err(bad("unknown block"));
                }
                let id = next.allocate()?;
                next.segments.insert(
                    id,
                    Arc::new(Segment {
                        id,
                        a: get(p, "a")?,
                        b: get(p, "b")?,
                        name: optional(p, "name", "Segment".into())?,
                        color: optional(p, "color", [0, 0, 0, 255])?,
                        width: optional(p, "width", 1.)?,
                        visible: optional(p, "visible", true)?,
                        locked: optional(p, "locked", false)?,
                        layer: optional(p, "layer", 0)?,
                        block,
                    }),
                );
                next.order.push(id);
                data = json!({"segment_id":id});
            }
            "updateSegment" => {
                let id = get(p, "id")?;
                let segment = next.segment(id)?;
                fields(
                    p,
                    &[
                        "id", "a", "b", "name", "color", "width", "visible", "locked", "layer",
                        "block",
                    ],
                )?;
                if next.layer_locked(segment.layer)
                    && p.as_object().unwrap().keys().any(|k| k.as_str() != "id")
                {
                    return Err(bad("segment is on a locked layer"));
                }
                if segment.locked
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad("segment is locked"));
                }
                let segment = patch(
                    segment,
                    p,
                    &[
                        "id", "a", "b", "name", "color", "width", "visible", "locked", "layer",
                        "block",
                    ],
                )?;
                if segment.block != 0 && !next.blocks.contains_key(&segment.block) {
                    return Err(bad("unknown block"));
                }
                next.segments.insert(id, Arc::new(segment));
            }
            "removeSegment" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                let segment = next.segment(id)?;
                if segment.locked {
                    return Err(bad("segment is locked"));
                }
                if next.layer_locked(segment.layer) {
                    return Err(bad("segment is on a locked layer"));
                }
                if next.constraints.values().any(|c|match c.definition{
                    Definition::Horizontal{segment}|Definition::Vertical{segment}if segment==id=>true,
                    Definition::Perpendicular{a,b}|Definition::Parallel{a,b}|Definition::Equal{a,b}if a==id||b==id=>true,
                    Definition::Midpoint{segment:s,..}if s==id=>true,
                    // `id` is a segment here, so any tangent mention is a
                    // segment participant (ids are unique across collections).
                    Definition::Tangent{a,b,..}if a==id||b==id=>true,
                    _=>false}){return Err(bad("segment is referenced by a constraint"))}
                next.segments.remove(&id);
                next.order.retain(|v| *v != id);
            }
            "setSegmentOrder" => {
                fields(p, &["order"])?;
                let order: Vec<u64> = get(p, "order")?;
                if order.len() != next.segments.len()
                    || order.iter().copied().collect::<BTreeSet<_>>()
                        != next.segments.keys().copied().collect()
                {
                    return Err(bad("segment order must contain every segment once"));
                }
                let mut replacement = order.into_iter();
                for id in &mut next.order {
                    if next.segments.contains_key(id) {
                        *id = replacement
                            .next()
                            .ok_or_else(|| bad("segment order lost a slot"))?;
                    }
                }
            }
            "setEntityOrder" => {
                fields(p, &["order"])?;
                next.order = get(p, "order")?;
            }
            "addCircle" => {
                fields(
                    p,
                    &[
                        "center", "radius", "name", "color", "width", "visible", "locked", "layer",
                        "block",
                    ],
                )?;
                let block: u64 = optional(p, "block", 0)?;
                if block != 0 && !next.blocks.contains_key(&block) {
                    return Err(bad("unknown block"));
                }
                let id = next.allocate()?;
                next.circles.insert(
                    id,
                    Arc::new(Circle {
                        id,
                        center: get(p, "center")?,
                        radius: get(p, "radius")?,
                        name: optional(p, "name", "Circle".into())?,
                        color: optional(p, "color", [0, 0, 0, 255])?,
                        width: optional(p, "width", 1.)?,
                        visible: optional(p, "visible", true)?,
                        locked: optional(p, "locked", false)?,
                        layer: optional(p, "layer", 0)?,
                        block,
                    }),
                );
                next.order.push(id);
                data = json!({"circle_id":id});
            }
            "addArc" => {
                fields(
                    p,
                    &[
                        "center",
                        "radius",
                        "start_deg",
                        "sweep_deg",
                        "name",
                        "color",
                        "width",
                        "visible",
                        "locked",
                        "layer",
                        "block",
                    ],
                )?;
                let block: u64 = optional(p, "block", 0)?;
                if block != 0 && !next.blocks.contains_key(&block) {
                    return Err(bad("unknown block"));
                }
                let id = next.allocate()?;
                next.arcs.insert(
                    id,
                    Arc::new(ArcEntity {
                        id,
                        center: get(p, "center")?,
                        radius: get(p, "radius")?,
                        start_deg: get(p, "start_deg")?,
                        sweep_deg: get(p, "sweep_deg")?,
                        name: optional(p, "name", "Arc".into())?,
                        color: optional(p, "color", [0, 0, 0, 255])?,
                        width: optional(p, "width", 1.)?,
                        visible: optional(p, "visible", true)?,
                        locked: optional(p, "locked", false)?,
                        layer: optional(p, "layer", 0)?,
                        block,
                    }),
                );
                next.order.push(id);
                data = json!({"arc_id":id});
            }
            "updateCircle" => {
                let id = get(p, "id")?;
                let c = next.circles.get(&id).ok_or_else(|| bad("unknown circle"))?;
                fields(
                    p,
                    &[
                        "id", "center", "radius", "name", "color", "width", "visible", "locked",
                        "layer", "block",
                    ],
                )?;
                if next.layer_locked(c.layer)
                    && p.as_object().unwrap().keys().any(|k| k.as_str() != "id")
                {
                    return Err(bad("circle is on a locked layer"));
                }
                if c.locked
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad("circle is locked"));
                }
                let c = patch(
                    &**c,
                    p,
                    &[
                        "id", "center", "radius", "name", "color", "width", "visible", "locked",
                        "layer", "block",
                    ],
                )?;
                if c.block != 0 && !next.blocks.contains_key(&c.block) {
                    return Err(bad("unknown block"));
                }
                next.circles.insert(id, Arc::new(c));
            }
            "updateArc" => {
                let id = get(p, "id")?;
                let a = next.arcs.get(&id).ok_or_else(|| bad("unknown arc"))?;
                fields(
                    p,
                    &[
                        "id",
                        "center",
                        "radius",
                        "start_deg",
                        "sweep_deg",
                        "name",
                        "color",
                        "width",
                        "visible",
                        "locked",
                        "layer",
                        "block",
                    ],
                )?;
                if next.layer_locked(a.layer)
                    && p.as_object().unwrap().keys().any(|k| k.as_str() != "id")
                {
                    return Err(bad("arc is on a locked layer"));
                }
                if a.locked
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad("arc is locked"));
                }
                let a = patch(
                    &**a,
                    p,
                    &[
                        "id",
                        "center",
                        "radius",
                        "start_deg",
                        "sweep_deg",
                        "name",
                        "color",
                        "width",
                        "visible",
                        "locked",
                        "layer",
                        "block",
                    ],
                )?;
                if a.block != 0 && !next.blocks.contains_key(&a.block) {
                    return Err(bad("unknown block"));
                }
                next.arcs.insert(id, Arc::new(a));
            }
            "removeCircle" | "removeArc" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                if cmd.op == "removeCircle" {
                    let c = next.circles.get(&id).ok_or_else(|| bad("unknown circle"))?;
                    if c.locked {
                        return Err(bad("circle is locked"));
                    }
                    if next.layer_locked(c.layer) {
                        return Err(bad("circle is on a locked layer"));
                    }
                    if curve_referenced(&next, id) {
                        return Err(bad("circle is referenced by a constraint"));
                    }
                    next.circles.remove(&id);
                } else {
                    let a = next.arcs.get(&id).ok_or_else(|| bad("unknown arc"))?;
                    if a.locked {
                        return Err(bad("arc is locked"));
                    }
                    if next.layer_locked(a.layer) {
                        return Err(bad("arc is on a locked layer"));
                    }
                    if curve_referenced(&next, id) {
                        return Err(bad("arc is referenced by a constraint"));
                    }
                    next.arcs.remove(&id);
                }
                next.order.retain(|v| *v != id);
            }
            "addLayer" => {
                fields(p, &["name", "color", "visible", "locked"])?;
                let name: String = get(p, "name")?;
                if name.is_empty()
                    || name.len() > 512
                    || name == "0"
                    || next.layers.values().any(|l| l.name == name)
                {
                    return Err(bad("invalid or duplicate layer name"));
                }
                let id = next.allocate()?;
                next.layers.insert(
                    id,
                    Arc::new(Layer {
                        id,
                        name,
                        color: optional(p, "color", None)?,
                        visible: optional(p, "visible", true)?,
                        locked: optional(p, "locked", false)?,
                    }),
                );
                data = json!({"layer_id":id});
            }
            "updateLayer" => {
                fields(p, &["id", "name", "color", "visible", "locked"])?;
                let id = get(p, "id")?;
                if id == 0 {
                    return Err(bad("default layer 0 is reserved"));
                }
                if !next.layers.contains_key(&id) {
                    return Err(bad("unknown layer"));
                }
                if let Some(name) = p.get("name") {
                    let name: String = serde_json::from_value(name.clone())?;
                    if name.is_empty()
                        || name.len() > 512
                        || name == "0"
                        || next.layers.values().any(|l| l.id != id && l.name == name)
                    {
                        return Err(bad("invalid or duplicate layer name"));
                    }
                }
                let layer = next.layers.get(&id).ok_or_else(|| bad("unknown layer"))?;
                let layer = patch(&**layer, p, &["id", "name", "color", "visible", "locked"])?;
                next.layers.insert(id, Arc::new(layer));
            }
            "removeLayer" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                if id == 0 {
                    return Err(bad("default layer 0 cannot be removed"));
                }
                if !next.layers.contains_key(&id) {
                    return Err(bad("unknown layer"));
                }
                let referenced = next.segments.values().any(|s| s.layer == id)
                    || next.circles.values().any(|c| c.layer == id)
                    || next.arcs.values().any(|a| a.layer == id)
                    || next.hatches.values().any(|h| h.layer == id)
                    || next.dimensions.values().any(|d| d.layer == id)
                    || next.inserts.values().any(|i| i.layer == id);
                if referenced {
                    return Err(bad("layer still contains entities"));
                }
                next.layers.remove(&id);
            }
            "addHatch" => {
                fields(
                    p,
                    &[
                        "name",
                        "pattern",
                        "color",
                        "angle",
                        "scale",
                        "width",
                        "visible",
                        "locked",
                        "layer",
                        "loops",
                        "boundary_ids",
                        "tolerance",
                    ],
                )?;
                let loops = hatch_loops(&next, p)?;
                let id = next.allocate()?;
                next.hatches.insert(
                    id,
                    Arc::new(Hatch {
                        id,
                        name: optional(p, "name", "Hatch".into())?,
                        pattern: optional(p, "pattern", "ansi31".into())?,
                        color: optional(p, "color", [0, 0, 0, 255])?,
                        angle: optional(p, "angle", 0.)?,
                        scale: optional(p, "scale", 1.)?,
                        width: optional(p, "width", 1.)?,
                        visible: optional(p, "visible", true)?,
                        locked: optional(p, "locked", false)?,
                        layer: optional(p, "layer", 0)?,
                        loops,
                    }),
                );
                data = json!({"hatch_id":id});
            }
            "updateHatch" => {
                let id = get(p, "id")?;
                let hatch = next.hatches.get(&id).ok_or_else(|| bad("unknown hatch"))?;
                fields(
                    p,
                    &[
                        "id",
                        "name",
                        "pattern",
                        "color",
                        "angle",
                        "scale",
                        "width",
                        "visible",
                        "locked",
                        "layer",
                        "loops",
                        "boundary_ids",
                        "tolerance",
                    ],
                )?;
                if next.layer_locked(hatch.layer)
                    && p.as_object().unwrap().keys().any(|k| k.as_str() != "id")
                {
                    return Err(bad("hatch is on a locked layer"));
                }
                if hatch.locked
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad("hatch is locked"));
                }
                let mut owned = p.clone();
                if owned.get("boundary_ids").is_some() {
                    if owned.get("loops").is_some() {
                        return Err(bad("provide loops or boundary_ids, not both"));
                    }
                    let resolved = hatch_loops(&next, &owned)?;
                    let obj = owned.as_object_mut().unwrap();
                    obj.remove("boundary_ids");
                    obj.remove("tolerance");
                    obj.insert("loops".to_string(), serde_json::to_value(resolved)?);
                } else if owned.get("tolerance").is_some() {
                    return Err(bad("tolerance requires boundary_ids"));
                }
                let hatch = patch(
                    &**hatch,
                    &owned,
                    &[
                        "id", "name", "pattern", "color", "angle", "scale", "width", "visible",
                        "locked", "layer", "loops",
                    ],
                )?;
                next.hatches.insert(id, Arc::new(hatch));
            }
            "removeHatch" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                let hatch = next.hatches.get(&id).ok_or_else(|| bad("unknown hatch"))?;
                if hatch.locked {
                    return Err(bad("hatch is locked"));
                }
                if next.layer_locked(hatch.layer) {
                    return Err(bad("hatch is on a locked layer"));
                }
                next.hatches.remove(&id);
            }
            "addDimension" => {
                fields(
                    p,
                    &[
                        "kind", "points", "entity", "axis", "name", "color", "width", "visible",
                        "locked", "layer",
                    ],
                )?;
                let id = next.allocate()?;
                let dim = Dimension {
                    id,
                    kind: get(p, "kind")?,
                    points: optional(p, "points", Vec::new())?,
                    entity: optional(p, "entity", 0)?,
                    axis: optional(p, "axis", None)?,
                    name: optional(p, "name", "Dimension".into())?,
                    color: optional(p, "color", [0, 0, 0, 255])?,
                    width: optional(p, "width", 1.)?,
                    visible: optional(p, "visible", true)?,
                    locked: optional(p, "locked", false)?,
                    layer: optional(p, "layer", 0)?,
                };
                if !next.dimension_resolves(&dim) {
                    return Err(bad("dimension reference does not resolve"));
                }
                next.dimensions.insert(id, Arc::new(dim));
                data = json!({"dimension_id":id});
            }
            "updateDimension" => {
                let id = get(p, "id")?;
                let dim = next
                    .dimensions
                    .get(&id)
                    .ok_or_else(|| bad("unknown dimension"))?;
                fields(
                    p,
                    &[
                        "id", "kind", "points", "entity", "axis", "name", "color", "width",
                        "visible", "locked", "layer",
                    ],
                )?;
                if next.layer_locked(dim.layer)
                    && p.as_object().unwrap().keys().any(|k| k.as_str() != "id")
                {
                    return Err(bad("dimension is on a locked layer"));
                }
                if dim.locked
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad("dimension is locked"));
                }
                let dim = patch(
                    &**dim,
                    p,
                    &[
                        "id", "kind", "points", "entity", "axis", "name", "color", "width",
                        "visible", "locked", "layer",
                    ],
                )?;
                // Reference-bearing fields must resolve at write time, but
                // style-only edits on an already-orphaned dimension stay
                // allowed so hosts can restyle or hide it.
                let relinks = ["kind", "points", "entity", "axis"]
                    .iter()
                    .any(|k| p.get(*k).is_some());
                if relinks && !next.dimension_resolves(&dim) {
                    return Err(bad("dimension reference does not resolve"));
                }
                next.dimensions.insert(id, Arc::new(dim));
            }
            "removeDimension" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                let dim = next
                    .dimensions
                    .get(&id)
                    .ok_or_else(|| bad("unknown dimension"))?;
                if dim.locked {
                    return Err(bad("dimension is locked"));
                }
                if next.layer_locked(dim.layer) {
                    return Err(bad("dimension is on a locked layer"));
                }
                next.dimensions.remove(&id);
            }
            "addSheet" => {
                fields(
                    p,
                    &[
                        "name",
                        "width",
                        "height",
                        "margin_top",
                        "margin_right",
                        "margin_bottom",
                        "margin_left",
                    ],
                )?;
                let name: String = get(p, "name")?;
                if name.is_empty()
                    || name.len() > 512
                    || next.sheets.values().any(|s| s.name == name)
                {
                    return Err(bad("invalid or duplicate sheet name"));
                }
                let id = next.allocate()?;
                next.sheets.insert(
                    id,
                    Arc::new(Sheet {
                        id,
                        name,
                        width: get(p, "width")?,
                        height: get(p, "height")?,
                        margin_top: optional(p, "margin_top", 10.)?,
                        margin_right: optional(p, "margin_right", 10.)?,
                        margin_bottom: optional(p, "margin_bottom", 10.)?,
                        margin_left: optional(p, "margin_left", 10.)?,
                    }),
                );
                data = json!({"sheet_id":id});
            }
            "updateSheet" => {
                fields(
                    p,
                    &[
                        "id",
                        "name",
                        "width",
                        "height",
                        "margin_top",
                        "margin_right",
                        "margin_bottom",
                        "margin_left",
                    ],
                )?;
                let id = get(p, "id")?;
                if !next.sheets.contains_key(&id) {
                    return Err(bad("unknown sheet"));
                }
                if let Some(name) = p.get("name") {
                    let name: String = serde_json::from_value(name.clone())?;
                    if name.is_empty()
                        || name.len() > 512
                        || next.sheets.values().any(|s| s.id != id && s.name == name)
                    {
                        return Err(bad("invalid or duplicate sheet name"));
                    }
                }
                let sheet = next.sheets.get(&id).ok_or_else(|| bad("unknown sheet"))?;
                let sheet = patch(
                    &**sheet,
                    p,
                    &[
                        "id",
                        "name",
                        "width",
                        "height",
                        "margin_top",
                        "margin_right",
                        "margin_bottom",
                        "margin_left",
                    ],
                )?;
                next.sheets.insert(id, Arc::new(sheet));
            }
            "removeSheet" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                if !next.sheets.contains_key(&id) {
                    return Err(bad("unknown sheet"));
                }
                if next.viewports.values().any(|v| v.sheet == id) {
                    return Err(bad("sheet still contains viewports"));
                }
                next.sheets.remove(&id);
            }
            "addViewport" => {
                fields(
                    p,
                    &[
                        "sheet", "x", "y", "width", "height", "center_x", "center_y", "scale",
                        "name", "visible", "locked",
                    ],
                )?;
                let sheet: u64 = get(p, "sheet")?;
                if !next.sheets.contains_key(&sheet) {
                    return Err(bad("unknown sheet"));
                }
                let id = next.allocate()?;
                next.viewports.insert(
                    id,
                    Arc::new(ViewportEntity {
                        id,
                        sheet,
                        name: optional(p, "name", "Viewport".into())?,
                        x: get(p, "x")?,
                        y: get(p, "y")?,
                        width: get(p, "width")?,
                        height: get(p, "height")?,
                        center_x: get(p, "center_x")?,
                        center_y: get(p, "center_y")?,
                        scale: get(p, "scale")?,
                        visible: optional(p, "visible", true)?,
                        locked: optional(p, "locked", false)?,
                    }),
                );
                data = json!({"viewport_id":id});
            }
            "updateViewport" => {
                let id = get(p, "id")?;
                let viewport = next
                    .viewports
                    .get(&id)
                    .ok_or_else(|| bad("unknown viewport"))?;
                fields(
                    p,
                    &[
                        "id", "sheet", "x", "y", "width", "height", "center_x", "center_y",
                        "scale", "name", "visible", "locked",
                    ],
                )?;
                if viewport.locked
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad("viewport is locked"));
                }
                let viewport = patch(
                    &**viewport,
                    p,
                    &[
                        "id", "sheet", "x", "y", "width", "height", "center_x", "center_y",
                        "scale", "name", "visible", "locked",
                    ],
                )?;
                next.viewports.insert(id, Arc::new(viewport));
            }
            "removeViewport" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                let viewport = next
                    .viewports
                    .get(&id)
                    .ok_or_else(|| bad("unknown viewport"))?;
                if viewport.locked {
                    return Err(bad("viewport is locked"));
                }
                next.viewports.remove(&id);
            }
            "addBlock" => {
                fields(p, &["name", "base_x", "base_y"])?;
                let name: String = get(p, "name")?;
                if name.is_empty()
                    || name.len() > 512
                    || next.blocks.values().any(|b| b.name == name)
                {
                    return Err(bad("invalid or duplicate block name"));
                }
                let id = next.allocate()?;
                next.blocks.insert(
                    id,
                    Arc::new(Block {
                        id,
                        name,
                        base_x: optional(p, "base_x", 0.)?,
                        base_y: optional(p, "base_y", 0.)?,
                    }),
                );
                data = json!({"block_id":id});
            }
            "updateBlock" => {
                fields(p, &["id", "name", "base_x", "base_y"])?;
                let id = get(p, "id")?;
                if !next.blocks.contains_key(&id) {
                    return Err(bad("unknown block"));
                }
                if let Some(name) = p.get("name") {
                    let name: String = serde_json::from_value(name.clone())?;
                    if name.is_empty()
                        || name.len() > 512
                        || next.blocks.values().any(|b| b.id != id && b.name == name)
                    {
                        return Err(bad("invalid or duplicate block name"));
                    }
                }
                let block = next.blocks.get(&id).ok_or_else(|| bad("unknown block"))?;
                let block = patch(&**block, p, &["id", "name", "base_x", "base_y"])?;
                next.blocks.insert(id, Arc::new(block));
            }
            "removeBlock" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                if !next.blocks.contains_key(&id) {
                    return Err(bad("unknown block"));
                }
                // Strong references only: members (`block`), inserts
                // targeting it (`block`) and member inserts (`parent`) must
                // be cleared first — no silent reassignment (layer precedent).
                let referenced = next.segments.values().any(|e| e.block == id)
                    || next.circles.values().any(|e| e.block == id)
                    || next.arcs.values().any(|e| e.block == id)
                    || next
                        .inserts
                        .values()
                        .any(|i| i.block == id || i.parent == id);
                if referenced {
                    return Err(bad("block still contains members or inserts"));
                }
                next.blocks.remove(&id);
            }
            "addInsert" => {
                fields(
                    p,
                    &[
                        "block",
                        "parent",
                        "x",
                        "y",
                        "scale",
                        "rotation_deg",
                        "name",
                        "visible",
                        "locked",
                        "layer",
                    ],
                )?;
                let block: u64 = get(p, "block")?;
                if !next.blocks.contains_key(&block) {
                    return Err(bad("unknown block"));
                }
                let parent: u64 = optional(p, "parent", 0)?;
                if parent != 0 && !next.blocks.contains_key(&parent) {
                    return Err(bad("unknown parent block"));
                }
                let id = next.allocate()?;
                next.inserts.insert(
                    id,
                    Arc::new(InsertEntity {
                        id,
                        block,
                        parent,
                        name: optional(p, "name", "Insert".into())?,
                        x: get(p, "x")?,
                        y: get(p, "y")?,
                        scale: optional(p, "scale", 1.)?,
                        rotation_deg: optional(p, "rotation_deg", 0.)?,
                        visible: optional(p, "visible", true)?,
                        locked: optional(p, "locked", false)?,
                        layer: optional(p, "layer", 0)?,
                    }),
                );
                data = json!({"insert_id":id});
            }
            "updateInsert" => {
                let id = get(p, "id")?;
                let insert = next.inserts.get(&id).ok_or_else(|| bad("unknown insert"))?;
                fields(
                    p,
                    &[
                        "id",
                        "block",
                        "parent",
                        "x",
                        "y",
                        "scale",
                        "rotation_deg",
                        "name",
                        "visible",
                        "locked",
                        "layer",
                    ],
                )?;
                if next.layer_locked(insert.layer)
                    && p.as_object().unwrap().keys().any(|k| k.as_str() != "id")
                {
                    return Err(bad("insert is on a locked layer"));
                }
                if insert.locked
                    && p.as_object()
                        .unwrap()
                        .keys()
                        .any(|k| !["id", "locked"].contains(&k.as_str()))
                {
                    return Err(bad("insert is locked"));
                }
                let insert = patch(
                    &**insert,
                    p,
                    &[
                        "id",
                        "block",
                        "parent",
                        "x",
                        "y",
                        "scale",
                        "rotation_deg",
                        "name",
                        "visible",
                        "locked",
                        "layer",
                    ],
                )?;
                if !next.blocks.contains_key(&insert.block) {
                    return Err(bad("unknown block"));
                }
                if insert.parent != 0 && !next.blocks.contains_key(&insert.parent) {
                    return Err(bad("unknown parent block"));
                }
                // Cyclic/deep nesting is rejected by final validation.
                next.inserts.insert(id, Arc::new(insert));
            }
            "removeInsert" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                let insert = next.inserts.get(&id).ok_or_else(|| bad("unknown insert"))?;
                if insert.locked {
                    return Err(bad("insert is locked"));
                }
                if next.layer_locked(insert.layer) {
                    return Err(bad("insert is on a locked layer"));
                }
                next.inserts.remove(&id);
            }
            "setSnapSettings" => {
                next.snaps = patch(
                    &next.snaps,
                    p,
                    &[
                        "grid",
                        "spacing",
                        "origin_x",
                        "origin_y",
                        "endpoint",
                        "midpoint",
                        "projection",
                        "intersection",
                        "ortho",
                        "polar",
                        "polar_increment",
                        "center",
                        "nearest_circle",
                        "tangent",
                    ],
                )?;
            }
            "addConstraint" => {
                fields(p, &["definition", "enabled"])?;
                let id = next.allocate()?;
                next.constraints.insert(
                    id,
                    Arc::new(Constraint {
                        id,
                        enabled: optional(p, "enabled", true)?,
                        definition: get(p, "definition")?,
                    }),
                );
                data = json!({"constraint_id":id});
            }
            "updateConstraint" => {
                fields(p, &["id", "definition", "enabled"])?;
                let id = get(p, "id")?;
                let constraint = next
                    .constraints
                    .get(&id)
                    .ok_or_else(|| bad("unknown constraint"))?;
                let constraint = patch(&**constraint, p, &["id", "definition", "enabled"])?;
                next.constraints.insert(id, Arc::new(constraint));
            }
            "removeConstraint" => {
                fields(p, &["id"])?;
                if next.constraints.remove(&get(p, "id")?).is_none() {
                    return Err(bad("unknown constraint"));
                }
            }
            _ => return Err(EngineError::unsupported("unknown draft operation")),
        }
        self.publish(next, data)
    }
    fn apply_batch(
        &mut self,
        cmd: Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let batch = ignition_core::parse_batch(cmd)?;
        let staged = Self {
            state: self.state.clone(),
            journal: Journal::new(1),
            revision: self.revision,
            in_batch: true,
        };
        let (staged, mut result) = match ctx {
            Some(ctx) => ignition_core::execute_batch_with_ctx(staged, batch, ctx)?,
            None => ignition_core::execute_batch(staged, batch)?,
        };
        if staged.state != self.state {
            let revision = self.next_revision()?;
            self.journal.record(self.state.clone());
            self.state = staged.state;
            self.revision = revision
        } else {
            result.events.clear()
        }
        Ok(result)
    }
    fn apply_long(
        &mut self,
        cmd: Command,
        ctx: &TaskContext,
    ) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, Some(ctx));
        }
        ctx.checkpoint()?;
        let result = if cmd.op == "renderFrame" {
            if cmd.v != 1 || cmd.input.is_some() {
                return Err(bad("invalid render command"));
            }
            render::render(&self.state, &cmd, Some(ctx))?
        } else if cmd.op == "solve" {
            if cmd.v != 1 || cmd.input.is_some() {
                return Err(bad("unsupported command version or binary input"));
            }
            self.solve_apply(&cmd.payload, Some(ctx))?
        } else {
            self.apply(cmd)?
        };
        ctx.set_progress(1.);
        Ok(result)
    }
    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let payload = if requires_matching_reader(&self.state) {
            serde_json::to_vec(&ExtendedSnapshot {
                kind: "draft".to_owned(),
                schema: 2,
                document: &*self.state,
            })?
        } else {
            serde_json::to_vec(&*self.state)?
        };
        Ok(encode_envelope(&payload))
    }
    fn restore(&mut self, bytes: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(bytes)?;
        if payload.len() > MAX_BYTES {
            return Err(bad("draft state exceeds 8 MiB"));
        }
        let value: Value = serde_json::from_slice(payload)?;
        let state = if value.get("document").is_some() || value.get("schema") == Some(&json!(2)) {
            let wrapped: ExtendedSnapshot<State> = serde_json::from_value(value)?;
            if wrapped.kind != "draft" || wrapped.schema != 2 {
                return Err(bad("unsupported draft snapshot wrapper"));
            }
            wrapped.document
        } else {
            let state: State = serde_json::from_value(value)?;
            if requires_matching_reader(&state) {
                return Err(bad("extended draft snapshot requires schema2 wrapper"));
            }
            state
        };
        state.validate()?;
        let revision = self.next_revision()?;
        self.state = Arc::new(state);
        self.journal = Journal::new(HISTORY);
        self.revision = revision;
        Ok(())
    }
    fn undo(&mut self) -> Result<bool, EngineError> {
        let revision = self.next_revision()?;
        if let Some(previous) = self.journal.pop_undo() {
            let current = std::mem::replace(&mut self.state, previous);
            self.journal.push_redo(current);
            self.revision = revision;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn redo(&mut self) -> Result<bool, EngineError> {
        let revision = self.next_revision()?;
        if let Some(next) = self.journal.pop_redo() {
            let current = std::mem::replace(&mut self.state, next);
            self.journal.push_undo(current);
            self.revision = revision;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
