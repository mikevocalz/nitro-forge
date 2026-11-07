#![forbid(unsafe_code)]
//! Fixed-size design hierarchy/layout. Prism owns actual rasterization.
mod layout;
mod model;
mod sizing;
use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal, TaskContext,
};
use model::*;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
fn id(p: &Value, key: &str) -> Result<u64, EngineError> {
    p.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| bad("expected integer node identity"))
}
fn merge<T: Serialize + DeserializeOwned>(
    current: &T,
    p: &Value,
    allowed: &[&str],
) -> Result<T, EngineError> {
    let object = p.as_object().ok_or_else(|| bad("expected patch object"))?;
    let mut next = serde_json::to_value(current)?;
    for (k, v) in object {
        if !allowed.contains(&k.as_str()) {
            return Err(bad("unknown patch field"));
        }
        next[k] = v.clone();
    }
    Ok(serde_json::from_value(next)?)
}
pub struct DesignEngine {
    state: Arc<State>,
    journal: Journal<Arc<State>>,
}
impl Default for DesignEngine {
    fn default() -> Self {
        Self::new()
    }
}
impl DesignEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(State::default()),
            journal: Journal::new(16),
        }
    }
    fn read_axis_sizing(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let node_id = id(p, "id")?;
        let node = self
            .state
            .nodes
            .get(&node_id)
            .ok_or_else(|| bad("unknown node"))?;
        let sizes = sizing::evaluate(&self.state)?;
        let unavailable = if node_id == 1 {
            Some("Root canvas sizing uses setComposition".to_string())
        } else {
            self.state.editable(node_id, false).err().map(|e| e.message)
        };
        let axis_info = |axis: Axis| -> Value {
            let capability = |mode: SizeMode| -> Result<(), EngineError> {
                if let Some(reason) = &unavailable {
                    return Err(bad(reason));
                }
                let mut next = (*self.state).clone();
                let n = Arc::make_mut(next.nodes.get_mut(&node_id).unwrap());
                if axis == Axis::X {
                    n.sizing.x = mode;
                } else {
                    n.sizing.y = mode;
                }
                validate(&next)?;
                layout::evaluate(&next)?;
                Ok(())
            };
            let hug = capability(SizeMode::Hug);
            let fill = capability(SizeMode::Fill);
            let current_mode = sizing::mode(node, axis);
            let resolved = sizes.values[&(node_id, axis)];
            let value = if current_mode == SizeMode::Fixed {
                sizing::authored(node, axis)
            } else {
                resolved
            };
            let mut info = json!({"mode":current_mode,"value":value,"fixedValue":sizing::authored(node,axis),"resolvedValue":resolved,"canHug":hug.is_ok(),"canFill":fill.is_ok()});
            if let Some(reason) = &unavailable {
                info["unavailableReason"] = json!(reason);
            }
            if let Err(error) = hug {
                info["hugReason"] = json!(error.message);
            }
            if let Err(error) = fill {
                info["fillReason"] = json!(error.message);
            }
            info
        };
        Ok(CommandResult::read_only(
            json!({"x":axis_info(Axis::X),"y":axis_info(Axis::Y)}),
        ))
    }
    fn render(
        &self,
        cmd: &Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let boxes = layout::evaluate(&self.state)?;
        let root = &self.state.nodes[&1];
        let mut prism = prism_engine::PrismEngine::new(root.width as u32, root.height as u32);
        for b in boxes {
            if let Some(c) = ctx {
                c.checkpoint()?;
            }
            if !b.visible {
                continue;
            }
            // Text nodes are layout boxes only: `renderable:false` in
            // evaluateLayout and no glyphs here. The fill still draws as a
            // plain rect background; real text rendering is a Prism/font gate.
            let kind = if b.kind == Kind::Ellipse {
                "ellipse"
            } else {
                "rect"
            };
            prism.apply(Command::new("addShape",json!({"shape":{"kind":kind,"x":b.x,"y":b.y,"w":b.width,"h":b.height,"fill":b.fill}})))?;
        }
        if let Some(c) = ctx {
            c.checkpoint()?;
        }
        let pixels = prism
            .apply(Command::new("flatten", json!({})).with_binary(None))?
            .output
            .ok_or_else(|| bad("Prism did not return RGBA"))?;
        if let Some(c) = ctx {
            c.checkpoint()?;
        }
        Ok(
            CommandResult::read_only(
                json!({"width":root.width as u32,"height":root.height as u32}),
            )
            .with_bytes(cmd, "pixels_b64", pixels),
        )
    }
}
impl Engine for DesignEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Design
    }
    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        if cmd.v != 1 || cmd.input.is_some() {
            return Err(bad("design requires v1 and no binary input"));
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            "describe" => {
                return Ok(CommandResult::read_only(serde_json::to_value(
                    &*self.state,
                )?))
            }
            "evaluateLayout" => {
                return Ok(CommandResult::read_only(
                    json!({"boxes":layout::evaluate(&self.state)?}),
                ))
            }
            "renderFrame" => return self.render(&cmd, None),
            _ => {}
        }
        if cmd.op == "readAxisSizing" {
            return self.read_axis_sizing(p);
        }
        let mut next = (*self.state).clone();
        let mut data = json!({"ok":true});
        match cmd.op.as_str() {
            "new" | "setComposition" => {
                if cmd.op == "new" {
                    next = State::default();
                } else {
                    next.editable(1, false)?;
                }
                let object = p
                    .as_object()
                    .ok_or_else(|| bad("expected composition object"))?;
                for (k, v) in object {
                    match k.as_str() {
                        "title" => {
                            next.title = v
                                .as_str()
                                .ok_or_else(|| bad("title must be string"))?
                                .into()
                        }
                        "width" | "height" => {
                            let number = v
                                .as_f64()
                                .ok_or_else(|| bad("canvas size must be numeric"))?;
                            let root = Arc::make_mut(next.nodes.get_mut(&1).unwrap());
                            if k == "width" {
                                root.width = number;
                            } else {
                                root.height = number;
                            }
                        }
                        _ => return Err(bad("unknown composition field")),
                    }
                }
            }
            "addFrame" | "addShape" => {
                let parent = id(p, "parent")?;
                next.editable(parent, false)?;
                if next.nodes[&parent].kind != Kind::Frame {
                    return Err(bad("parent must be a frame"));
                }
                let node_id = next.next_id;
                next.next_id = node_id
                    .checked_add(1)
                    .ok_or_else(|| bad("identity exhausted"))?;
                let mut patch = p
                    .as_object()
                    .ok_or_else(|| bad("expected node object"))?
                    .clone();
                patch.remove("parent");
                let mut node = Node::frame(node_id, 100., 100.);
                if cmd.op == "addShape" {
                    let kind = patch
                        .remove("kind")
                        .ok_or_else(|| bad("shape kind required"))?;
                    node.kind = serde_json::from_value(kind)?;
                    if node.kind == Kind::Frame {
                        return Err(bad("use addFrame for frame nodes"));
                    }
                }
                node = merge(
                    &node,
                    &Value::Object(patch),
                    &["name", "x", "y", "width", "height", "fill", "visible"],
                )?;
                next.nodes.insert(node_id, Arc::new(node));
                Arc::make_mut(next.nodes.get_mut(&parent).unwrap())
                    .children
                    .push(node_id);
                data = json!({"node_id":node_id});
            }
            "addText" => {
                // `parent` is optional and defaults to the root canvas, unlike
                // addFrame/addShape which require it explicitly.
                let parent = match p.get("parent") {
                    Some(v) => v
                        .as_u64()
                        .ok_or_else(|| bad("expected integer parent"))?,
                    None => 1,
                };
                next.editable(parent, false)?;
                if next.nodes[&parent].kind != Kind::Frame {
                    return Err(bad("parent must be a frame"));
                }
                let node_id = next.next_id;
                next.next_id = node_id
                    .checked_add(1)
                    .ok_or_else(|| bad("identity exhausted"))?;
                let object = p
                    .as_object()
                    .ok_or_else(|| bad("expected node object"))?;
                let content = object
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| bad("text content must be a string"))?;
                let mut style = TextStyle {
                    content: content.into(),
                    ..Default::default()
                };
                // `style` carries font fields only; content is top-level so it
                // cannot be set twice.
                if let Some(sv) = object.get("style") {
                    style = merge(
                        &style,
                        sv,
                        &[
                            "font_family",
                            "font_size",
                            "font_weight",
                            "font_style",
                        ],
                    )?;
                }
                let mut patch = object.clone();
                for k in ["parent", "content", "style"] {
                    patch.remove(k);
                }
                let mut node = Node::frame(node_id, 100., 100.);
                node.kind = Kind::Text;
                node.name = "Text".into();
                node.text = Some(style);
                node = merge(
                    &node,
                    &Value::Object(patch),
                    &["name", "x", "y", "width", "height", "fill", "visible"],
                )?;
                next.nodes.insert(node_id, Arc::new(node));
                Arc::make_mut(next.nodes.get_mut(&parent).unwrap())
                    .children
                    .push(node_id);
                data = json!({"node_id":node_id});
            }
            "updateNode" => {
                let node_id = id(p, "id")?;
                let mut patch = p
                    .as_object()
                    .ok_or_else(|| bad("expected patch object"))?
                    .clone();
                patch.remove("id");
                // `text` counts toward the patch length so a combined
                // locked+text patch is not mistaken for a lock-only unlock.
                let unlock = patch.len() == 1 && patch.contains_key("locked");
                // `text` is a partial TextStyle patch (or null), merged over
                // the node's current style; handled after the node merge.
                let text_patch = patch.remove("text");
                next.editable(node_id, unlock)?;
                if node_id == 1
                    && patch
                        .keys()
                        .any(|k| ["x", "y", "width", "height"].contains(&k.as_str()))
                {
                    return Err(bad("root geometry uses setComposition"));
                }
                let node = next
                    .nodes
                    .get(&node_id)
                    .ok_or_else(|| bad("unknown node"))?;
                if (patch.contains_key("width") && node.sizing.x != SizeMode::Fixed)
                    || (patch.contains_key("height") && node.sizing.y != SizeMode::Fixed)
                {
                    return Err(bad("switch to fixed sizing before editing a fixed extent"));
                }
                let mut changed = merge(
                    &**node,
                    &Value::Object(patch),
                    &[
                        "name", "x", "y", "width", "height", "fill", "visible", "locked",
                    ],
                )?;
                if let Some(tv) = text_patch {
                    if changed.kind != Kind::Text {
                        return Err(bad("text style requires a text node"));
                    }
                    match tv {
                        // Reserved: a text node cannot exist without a style
                        // and non-text nodes reject `text` above, so clearing
                        // can never validate. Reject explicitly.
                        Value::Null => return Err(bad("text style cannot be cleared")),
                        Value::Object(_) => {
                            let current = changed.text.clone().unwrap_or_default();
                            changed.text = Some(merge(
                                &current,
                                &tv,
                                &[
                                    "content",
                                    "font_family",
                                    "font_size",
                                    "font_weight",
                                    "font_style",
                                ],
                            )?);
                        }
                        _ => return Err(bad("text patch must be an object or null")),
                    }
                }
                next.nodes.insert(node_id, Arc::new(changed));
            }
            "setAxisSizing" => {
                if p.as_object().is_none_or(|o| {
                    o.keys()
                        .any(|k| !["id", "axis", "mode", "value"].contains(&k.as_str()))
                }) {
                    return Err(bad("unknown sizing field"));
                }
                let node_id = id(p, "id")?;
                next.editable(node_id, false)?;
                if node_id == 1 {
                    return Err(bad("root canvas sizing uses setComposition"));
                }
                let axis: Axis = serde_json::from_value(
                    p.get("axis").cloned().ok_or_else(|| bad("axis required"))?,
                )?;
                let mode: SizeMode = serde_json::from_value(
                    p.get("mode").cloned().ok_or_else(|| bad("mode required"))?,
                )?;
                let value = p
                    .get("value")
                    .map(|v| {
                        v.as_f64()
                            .ok_or_else(|| bad("sizing value must be numeric"))
                    })
                    .transpose()?;
                if mode != SizeMode::Fixed && value.is_some() {
                    return Err(bad("only fixed sizing accepts a numeric value"));
                }
                let value = if mode == SizeMode::Fixed
                    && value.is_none()
                    && sizing::mode(&self.state.nodes[&node_id], axis) != SizeMode::Fixed
                {
                    Some(sizing::evaluate(&self.state)?.values[&(node_id, axis)])
                } else {
                    value
                };
                let node = Arc::make_mut(next.nodes.get_mut(&node_id).unwrap());
                match axis {
                    Axis::X => {
                        node.sizing.x = mode;
                        if let Some(v) = value {
                            node.width = v;
                        }
                    }
                    Axis::Y => {
                        node.sizing.y = mode;
                        if let Some(v) = value {
                            node.height = v;
                        }
                    }
                }
            }
            "setFrameLayout" => {
                let node_id = id(p, "id")?;
                next.editable(node_id, false)?;
                let node = Arc::make_mut(next.nodes.get_mut(&node_id).unwrap());
                if node.kind != Kind::Frame {
                    return Err(bad("layout requires a frame"));
                }
                node.layout = serde_json::from_value(
                    p.get("layout")
                        .cloned()
                        .ok_or_else(|| bad("layout required (or null for absolute)"))?,
                )?;
            }
            "setChildOrder" => {
                let parent = id(p, "parent")?;
                next.editable(parent, false)?;
                let order: Vec<u64> = serde_json::from_value(
                    p.get("order")
                        .cloned()
                        .ok_or_else(|| bad("order required"))?,
                )?;
                let n = &next.nodes[&parent];
                let mut a = n.children.clone();
                let mut b = order.clone();
                a.sort();
                b.sort();
                if a != b {
                    return Err(bad("order must be an exact child permutation"));
                }
                Arc::make_mut(next.nodes.get_mut(&parent).unwrap()).children = order;
            }
            "reparentNode" => {
                let node_id = id(p, "id")?;
                let parent = id(p, "parent")?;
                next.editable(node_id, false)?;
                next.editable(parent, false)?;
                if node_id == 1
                    || next.nodes[&parent].kind != Kind::Frame
                    || next.subtree(node_id).contains(&parent)
                {
                    return Err(bad("invalid parent or cycle"));
                }
                let old = next
                    .parent(node_id)
                    .ok_or_else(|| bad("missing old parent"))?;
                next.editable(old, false)?;
                let index = usize::try_from(id(p, "index")?).map_err(|_| bad("index too large"))?;
                Arc::make_mut(next.nodes.get_mut(&old).unwrap())
                    .children
                    .retain(|id| *id != node_id);
                let dest = Arc::make_mut(next.nodes.get_mut(&parent).unwrap());
                if index > dest.children.len() {
                    return Err(bad("child index out of range"));
                }
                dest.children.insert(index, node_id);
            }
            "removeNode" => {
                let node_id = id(p, "id")?;
                next.editable(node_id, false)?;
                if node_id == 1 {
                    return Err(bad("cannot remove root"));
                }
                let all = next.subtree(node_id);
                for id in &all {
                    next.editable(*id, false)?;
                }
                let parent = next.parent(node_id).ok_or_else(|| bad("missing parent"))?;
                Arc::make_mut(next.nodes.get_mut(&parent).unwrap())
                    .children
                    .retain(|id| *id != node_id);
                for id in all {
                    next.nodes.remove(&id);
                }
            }
            _ => return Err(EngineError::unsupported("unsupported design operation")),
        }
        validate(&next)?;
        layout::evaluate(&next)?;
        if next == *self.state {
            return Ok(CommandResult::read_only(data));
        }
        self.journal.record(self.state.clone());
        self.state = Arc::new(next);
        Ok(CommandResult::data(data))
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
        };
        let (staged, mut result) = match ctx {
            Some(ctx) => ignition_core::execute_batch_with_ctx(staged, batch, ctx)?,
            None => ignition_core::execute_batch(staged, batch)?,
        };
        if self.state != staged.state {
            self.journal.record(self.state.clone());
            self.state = staged.state;
        } else {
            result.events.clear();
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
            self.render(&cmd, Some(ctx))?
        } else {
            self.apply(cmd)?
        };
        ctx.set_progress(1.);
        Ok(result)
    }
    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        // Presence-triggered versioning (quill/pitch/draft precedent): the
        // schema:2 wrapper `{kind:"design",schema:2,document:<state>}` is
        // emitted only when schema-2 features (text nodes) exist, so
        // schema:1-only documents stay byte-identical and old readers fail
        // closed on `kind:"text"`/`text` instead of silently dropping them.
        let payload = if requires_wrapper(&self.state) {
            serde_json::to_vec(&json!({
                "kind": "design",
                "schema": 2,
                "document": &*self.state,
            }))?
        } else {
            serde_json::to_vec(&*self.state)?
        };
        Ok(encode_envelope(&payload))
    }
    fn restore(&mut self, bytes: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(bytes)?;
        if payload.len() > MAX_BYTES {
            return Err(bad("design state exceeds budget"));
        }
        let value: Value = serde_json::from_slice(payload)?;
        let next: State = if value.get("document").is_some() {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Wrapper {
                kind: String,
                schema: u32,
                document: State,
            }
            let wrapper: Wrapper = serde_json::from_value(value)?;
            if wrapper.kind != "design" || wrapper.schema != 2 {
                return Err(bad("unsupported design snapshot wrapper"));
            }
            wrapper.document
        } else {
            let state: State = serde_json::from_value(value)?;
            if requires_wrapper(&state) {
                return Err(bad("extended design snapshot requires schema2 wrapper"));
            }
            state
        };
        validate(&next)?;
        layout::evaluate(&next)?;
        self.state = Arc::new(next);
        self.journal = Journal::new(16);
        Ok(())
    }
    fn undo(&mut self) -> Result<bool, EngineError> {
        if let Some(prior) = self.journal.pop_undo() {
            let current = std::mem::replace(&mut self.state, prior);
            self.journal.push_redo(current);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn redo(&mut self) -> Result<bool, EngineError> {
        if let Some(next) = self.journal.pop_redo() {
            let current = std::mem::replace(&mut self.state, next);
            self.journal.push_undo(current);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
#[cfg(test)]
mod tests;
