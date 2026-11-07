use crate::{commands, constraints, model::*, render, snaps};
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
        || state.snaps.center
        || state.snaps.nearest_circle
        || state.snaps.tangent
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
}
impl Engine for DraftEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Draft
    }
    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            let batch = ignition_core::parse_batch(cmd)?;
            let staged = Self {
                state: self.state.clone(),
                journal: Journal::new(1),
                revision: self.revision,
                in_batch: true,
            };
            let (staged, mut result) = ignition_core::execute_batch(staged, batch)?;
            if staged.state != self.state {
                let revision = self.next_revision()?;
                self.journal.record(self.state.clone());
                self.state = staged.state;
                self.revision = revision
            } else {
                result.events.clear()
            }
            return Ok(result);
        }
        if cmd.v != 1 || cmd.input.is_some() {
            return Err(bad("unsupported command version or binary input"));
        }
        if self.in_batch && matches!(cmd.op.as_str(), "describe" | "evaluate" | "querySnap") {
            return Err(bad(
                "revision-bearing reads are unavailable inside an atomic batch",
            ));
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            "executeCommand" => {
                fields(p, &["command"])?;
                let text: String = get(p, "command")?;
                return self.execute_command(&text);
            }
            "describe" => {
                fields(p, &[])?;
                let mut value = serde_json::to_value(&*self.state)?;
                for key in ["circles", "arcs"] {
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
                return Ok(CommandResult::read_only(
                    json!({"points":self.state.points,"segments":self.state.segments,"circles":self.state.circles,"arcs":self.state.arcs,"order":self.state.order,"source_revision":self.revision}),
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
                    return Err(bad("point is locked or belongs to a locked segment"));
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
                    &["a", "b", "name", "color", "width", "visible", "locked"],
                )?;
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
                        "id", "a", "b", "name", "color", "width", "visible", "locked",
                    ],
                )?;
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
                        "id", "a", "b", "name", "color", "width", "visible", "locked",
                    ],
                )?;
                next.segments.insert(id, Arc::new(segment));
            }
            "removeSegment" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                if next.segment(id)?.locked {
                    return Err(bad("segment is locked"));
                }
                if next.constraints.values().any(|c|matches!(c.definition,Definition::Horizontal{segment}|Definition::Vertical{segment}if segment==id)){return Err(bad("segment is referenced by a constraint"))}
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
                        "center", "radius", "name", "color", "width", "visible", "locked",
                    ],
                )?;
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
                    ],
                )?;
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
                    ],
                )?;
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
                    ],
                )?;
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
                    ],
                )?;
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
                    ],
                )?;
                next.arcs.insert(id, Arc::new(a));
            }
            "removeCircle" | "removeArc" => {
                fields(p, &["id"])?;
                let id = get(p, "id")?;
                if cmd.op == "removeCircle" {
                    if next
                        .circles
                        .get(&id)
                        .ok_or_else(|| bad("unknown circle"))?
                        .locked
                    {
                        return Err(bad("circle is locked"));
                    }
                    next.circles.remove(&id);
                } else {
                    if next.arcs.get(&id).ok_or_else(|| bad("unknown arc"))?.locked {
                        return Err(bad("arc is locked"));
                    }
                    next.arcs.remove(&id);
                }
                next.order.retain(|v| *v != id);
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
            "solve" => {
                fields(p, &["tolerance"])?;
                let mut solved = constraints::solve(&next, optional(p, "tolerance", 1e-7)?)?;
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
                solved.report.applied = next != *self.state;
                data = serde_json::to_value(solved.report)?;
            }
            _ => return Err(EngineError::unsupported("unknown draft operation")),
        }
        self.publish(next, data)
    }
    fn apply_long(
        &mut self,
        cmd: Command,
        ctx: &TaskContext,
    ) -> Result<CommandResult, EngineError> {
        ctx.checkpoint()?;
        let result = if cmd.op == "renderFrame" {
            if cmd.v != 1 || cmd.input.is_some() {
                return Err(bad("invalid render command"));
            }
            render::render(&self.state, &cmd, Some(ctx))?
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
