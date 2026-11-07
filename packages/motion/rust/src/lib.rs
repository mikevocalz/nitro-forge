//! Persistent bounded 2D motion. Prism owns rasterization/compositing.
mod assets;
mod curve;
use assets::RasterAsset;
use curve::{evaluate, Key};
use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal, TaskContext,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
const HISTORY: usize = 16;
const MAX_BYTES: usize = 16 * 1024 * 1024;
const SAFE_ID: u64 = 9_007_199_254_740_991;
fn bad(message: &str) -> EngineError {
    EngineError::validation(message)
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Transform {
    tx: f64,
    ty: f64,
    sx: f64,
    sy: f64,
    rotation: f64,
    ox: f64,
    oy: f64,
}
impl Default for Transform {
    fn default() -> Self {
        Self {
            tx: 0.,
            ty: 0.,
            sx: 1.,
            sy: 1.,
            rotation: 0.,
            ox: 0.,
            oy: 0.,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Shape {
    kind: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    fill: [u8; 4],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Property {
    Tx,
    Ty,
    Sx,
    Sy,
    Rotation,
    Ox,
    Oy,
    Opacity,
}
impl Property {
    fn bounds(self) -> (f64, f64) {
        match self {
            Self::Opacity => (0., 1.),
            Self::Sx | Self::Sy => (-1e4, 1e4),
            _ => (-1e7, 1e7),
        }
    }
    fn read(self, l: &Layer) -> f64 {
        match self {
            Self::Tx => l.transform.tx,
            Self::Ty => l.transform.ty,
            Self::Sx => l.transform.sx,
            Self::Sy => l.transform.sy,
            Self::Rotation => l.transform.rotation,
            Self::Ox => l.transform.ox,
            Self::Oy => l.transform.oy,
            Self::Opacity => l.opacity,
        }
    }
    fn write(self, l: &mut Layer, v: f64) {
        match self {
            Self::Tx => l.transform.tx = v,
            Self::Ty => l.transform.ty = v,
            Self::Sx => l.transform.sx = v,
            Self::Sy => l.transform.sy = v,
            Self::Rotation => l.transform.rotation = v,
            Self::Ox => l.transform.ox = v,
            Self::Oy => l.transform.oy = v,
            Self::Opacity => l.opacity = v,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Curve {
    property: Property,
    keys: Arc<Vec<Key>>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Layer {
    id: u64,
    name: String,
    visible: bool,
    locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shape: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    asset_id: Option<u64>,
    transform: Transform,
    opacity: f64,
    curves: Vec<Curve>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rate {
    num: u32,
    den: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    kind: String,
    schema: u32,
    title: String,
    width: u32,
    height: u32,
    duration_s: f64,
    frame_rate: Rate,
    next_layer_id: u64,
    next_key_id: u64,
    layers: Vec<Arc<Layer>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    assets: BTreeMap<u64, Arc<RasterAsset>>,
    #[serde(
        default = "assets::initial_asset_id",
        skip_serializing_if = "assets::is_initial_asset_id"
    )]
    next_asset_id: u64,
}
impl Default for State {
    fn default() -> Self {
        Self {
            kind: "motion".into(),
            schema: 1,
            title: "Untitled".into(),
            width: 640,
            height: 360,
            duration_s: 10.,
            frame_rate: Rate { num: 30, den: 1 },
            next_layer_id: 1,
            next_key_id: 1,
            layers: vec![],
            assets: BTreeMap::new(),
            next_asset_id: 1,
        }
    }
}
fn validate(s: &State) -> Result<(), EngineError> {
    if s.kind != "motion"
        || s.schema != 1
        || s.title.len() > 512
        || s.width == 0
        || s.height == 0
        || s.width > 4096
        || s.height > 4096
        || u64::from(s.width) * u64::from(s.height) > 1_048_576
        || !s.duration_s.is_finite()
        || s.duration_s <= 0.
        || s.duration_s > 604800.
        || s.layers.len() > 128
        || s.frame_rate.num == 0
        || s.frame_rate.num > 240000
        || s.frame_rate.den == 0
        || s.frame_rate.den > 1001
        || !(1.0..=240.0).contains(&(f64::from(s.frame_rate.num) / f64::from(s.frame_rate.den)))
        || s.next_layer_id == 0
        || s.next_key_id == 0
        || s.next_layer_id > SAFE_ID
        || s.next_key_id > SAFE_ID
    {
        return Err(bad("invalid motion header or budget"));
    }
    if s.assets.len() > assets::MAX_ASSETS || s.next_asset_id == 0 || s.next_asset_id > SAFE_ID {
        return Err(bad("invalid raster asset counter/count"));
    }
    let mut decoded_bytes = 0usize;
    for (&id, asset) in &s.assets {
        if id != asset.id
            || id == 0
            || id >= s.next_asset_id
            || asset.format != assets::FORMAT
            || asset.pixels.len() != assets::expected(asset.width, asset.height)?
        {
            return Err(bad("invalid raster asset identity, format or bytes"));
        }
        decoded_bytes = decoded_bytes
            .checked_add(asset.pixels.len())
            .filter(|v| *v <= assets::MAX_RGBA)
            .ok_or_else(|| bad("decoded raster asset total exceeds 4 MiB"))?;
    }
    let raster_count = s.layers.iter().filter(|l| l.asset_id.is_some()).count();
    if raster_count > assets::MAX_RASTER_LAYERS
        || u64::from(s.width) * u64::from(s.height) * 4 * raster_count as u64
            > assets::MAX_CANVAS_STORAGE
    {
        return Err(bad("logical raster layer canvas storage exceeds budget"));
    }
    let (mut ids, mut keys) = (BTreeSet::new(), BTreeSet::new());
    let (mut count, mut curves) = (0, 0);
    for l in &s.layers {
        if l.id == 0 || l.id >= s.next_layer_id || !ids.insert(l.id) || l.name.len() > 512 {
            return Err(bad("invalid layer identity"));
        }
        match (&l.shape, l.asset_id) {
            (Some(sh), None) => {
                if !["rect", "ellipse"].contains(&sh.kind.as_str())
                    || ![sh.x, sh.y, sh.w, sh.h]
                        .iter()
                        .all(|v| v.is_finite() && v.abs() <= 1e7)
                    || sh.w <= 0.
                    || sh.h <= 0.
                {
                    return Err(bad("invalid shape"));
                }
            }
            (None, Some(id)) => {
                let asset = s
                    .assets
                    .get(&id)
                    .ok_or_else(|| bad("raster layer references unknown asset"))?;
                if asset.width > s.width || asset.height > s.height {
                    return Err(bad(
                        "referenced raster asset must fit composition dimensions",
                    ));
                }
            }
            _ => return Err(bad("layer requires exactly one shape or raster asset")),
        }
        for p in [
            Property::Tx,
            Property::Ty,
            Property::Sx,
            Property::Sy,
            Property::Rotation,
            Property::Ox,
            Property::Oy,
            Property::Opacity,
        ] {
            let (min, max) = p.bounds();
            let v = p.read(l);
            if !v.is_finite()
                || v < min
                || v > max
                || matches!(p, Property::Sx | Property::Sy) && v.abs() < 1e-6
            {
                return Err(bad("invalid transform or opacity"));
            }
        }
        let mut properties = Vec::new();
        for c in &l.curves {
            if properties.contains(&c.property) {
                return Err(bad("duplicate property curve"));
            }
            properties.push(c.property);
            curves += 1;
            count += c.keys.len();
            for k in c.keys.iter() {
                if k.id == 0 || k.id >= s.next_key_id || !keys.insert(k.id) {
                    return Err(bad("invalid key identity"));
                }
            }
            let (mut min, mut max) = c.property.bounds();
            if matches!(c.property, Property::Sx | Property::Sy) {
                if c.property.read(l) > 0. {
                    min = 1e-6
                } else {
                    max = -1e-6
                }
            }
            evaluate(&c.keys, c.property.read(l), 0., s.duration_s, min, max).map_err(bad)?;
        }
    }
    if curves > 128 || count > 100000 || serde_json::to_vec(s)?.len() > MAX_BYTES {
        return Err(bad("motion total state budget exceeded"));
    }
    Ok(())
}
fn id(p: &Value, name: &str) -> Result<u64, EngineError> {
    p.get(name)
        .and_then(Value::as_u64)
        .ok_or_else(|| bad("missing integer identity"))
}
fn merge<T: Serialize + serde::de::DeserializeOwned>(
    value: &T,
    patch: &Value,
    allowed: &[&str],
) -> Result<T, EngineError> {
    let mut data = serde_json::to_value(value)?;
    let object = patch
        .as_object()
        .ok_or_else(|| bad("expected patch object"))?;
    for (k, v) in object {
        if allowed.contains(&k.as_str()) {
            data[k] = v.clone()
        } else {
            return Err(bad("unknown patch field"));
        }
    }
    Ok(serde_json::from_value(data)?)
}
pub struct MotionEngine {
    state: Arc<State>,
    journal: Journal<Arc<State>>,
}
impl Default for MotionEngine {
    fn default() -> Self {
        Self::new()
    }
}
impl MotionEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(State::default()),
            journal: Journal::new(HISTORY),
        }
    }
    fn evaluated(&self, time: f64) -> Result<Vec<Layer>, EngineError> {
        if !time.is_finite() || time < 0. || time > self.state.duration_s {
            return Err(bad("time outside composition"));
        }
        self.state
            .layers
            .iter()
            .map(|l| {
                let mut out = (**l).clone();
                for c in &l.curves {
                    let (min, max) = c.property.bounds();
                    let value = evaluate(
                        &c.keys,
                        c.property.read(l),
                        time,
                        self.state.duration_s,
                        min,
                        max,
                    )
                    .map_err(bad)?;
                    c.property.write(&mut out, value)
                }
                out.curves.clear();
                Ok(out)
            })
            .collect()
    }
    fn render(
        &self,
        cmd: &Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        let time = cmd
            .payload
            .get("time_s")
            .and_then(Value::as_f64)
            .ok_or_else(|| bad("time_s must be finite"))?;
        let layers = self.evaluated(time)?;
        let mut prism = prism_engine::PrismEngine::new(self.state.width, self.state.height);
        for l in layers {
            if let Some(c) = ctx {
                c.checkpoint()?
            }
            let result = if let Some(shape) = &l.shape {
                prism.apply(Command::new("addShape", json!({"shape":shape})))?
            } else {
                let asset = self
                    .state
                    .assets
                    .get(&l.asset_id.ok_or_else(|| bad("raster layer lost asset"))?)
                    .ok_or_else(|| bad("missing raster asset"))?;
                let added = prism.apply(Command::new("addRasterLayer", json!({})))?;
                let id = added.data["layer_id"]
                    .as_u64()
                    .ok_or_else(|| bad("Prism raster layer returned no ID"))?;
                prism.apply(
                    Command::new(
                        "drawPixels",
                        json!({"id":id,"x":0,"y":0,"w":asset.width,"h":asset.height}),
                    )
                    .with_binary(Some((*asset.pixels).clone())),
                )?;
                added
            };
            let layer = result.data["layer_id"]
                .as_u64()
                .ok_or_else(|| bad("Prism did not return a layer"))?;
            prism.apply(Command::new(
                "setTransformOrigin",
                json!({"id":layer,"ox":l.transform.ox,"oy":l.transform.oy}),
            ))?;
            prism.apply(Command::new(
                "setLayerTransform",
                json!({"id":layer,"transform":l.transform}),
            ))?;
            prism.apply(Command::new(
                "setLayerOpacity",
                json!({"id":layer,"opacity":l.opacity}),
            ))?;
            prism.apply(Command::new(
                "setLayerVisible",
                json!({"id":layer,"visible":l.visible}),
            ))?;
        }
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        let result = prism.apply(Command::new("flatten", json!({})).with_binary(None))?;
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        let bytes = result
            .output
            .ok_or_else(|| bad("Prism did not return RGBA"))?;
        Ok(
            CommandResult::read_only(json!({"width":self.state.width,"height":self.state.height}))
                .with_bytes(cmd, "pixels_b64", bytes),
        )
    }
}
impl Engine for MotionEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Motion
    }
    fn binary_input_ops(&self) -> &'static [&'static str] {
        &["addRasterAsset"]
    }
    fn apply(&mut self, mut cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            return self.apply_batch(cmd, None);
        }
        if cmd.v != 1 {
            return Err(bad("unsupported command version"));
        }
        if cmd.input.is_some() && cmd.op != "addRasterAsset" {
            return Err(bad("binary input is supported only for addRasterAsset"));
        }
        if cmd.op == "addRasterAsset" {
            let fields = cmd
                .payload
                .as_object()
                .ok_or_else(|| bad("raster input must be an object"))?;
            if fields
                .keys()
                .any(|key| !["width", "height", "format", "pixels_b64"].contains(&key.as_str()))
            {
                return Err(bad("unsupported raster input field"));
            }
            let width: u32 = serde_json::from_value(
                cmd.payload
                    .get("width")
                    .cloned()
                    .ok_or_else(|| bad("width required"))?,
            )?;
            let height: u32 = serde_json::from_value(
                cmd.payload
                    .get("height")
                    .cloned()
                    .ok_or_else(|| bad("height required"))?,
            )?;
            if cmd.payload.get("format").and_then(Value::as_str) != Some(assets::FORMAT) {
                return Err(bad("raster assets require rgba8-straight-srgb format"));
            }
            let length = assets::expected(width, height)?;
            if self.state.assets.len() >= assets::MAX_ASSETS
                || self
                    .state
                    .assets
                    .values()
                    .map(|asset| asset.pixels.len())
                    .sum::<usize>()
                    .checked_add(length)
                    .is_none_or(|v| v > assets::MAX_RGBA)
            {
                return Err(bad("raster asset count/decoded budget exceeded"));
            }
            if let Some(input) = &cmd.input {
                if input.len() != length {
                    return Err(bad("binary RGBA length does not match dimensions"));
                }
            }
            let pixels = cmd.bytes_input("pixels_b64", |text| assets::decode(text, length))?;
            if pixels.len() != length {
                return Err(bad("RGBA length does not match dimensions"));
            }
            let mut next = (*self.state).clone();
            let id = next.next_asset_id;
            next.next_asset_id = id
                .checked_add(1)
                .ok_or_else(|| bad("asset identity exhausted"))?;
            next.assets.insert(
                id,
                Arc::new(RasterAsset {
                    id,
                    width,
                    height,
                    format: assets::FORMAT.into(),
                    pixels: Arc::new(pixels),
                }),
            );
            validate(&next)?;
            self.journal.record(self.state.clone());
            self.state = Arc::new(next);
            return Ok(CommandResult::data(json!({"asset_id":id})));
        }
        let p = &cmd.payload;
        if cmd.op == "describe" {
            let mut value = serde_json::to_value(&*self.state)?;
            if value.get("assets").is_none() {
                value["assets"] = json!({});
            }
            value["next_asset_id"] = json!(self.state.next_asset_id);
            return Ok(CommandResult::read_only(value));
        }
        if cmd.op == "evaluate" {
            let t = p
                .get("time_s")
                .and_then(Value::as_f64)
                .ok_or_else(|| bad("time_s required"))?;
            return Ok(CommandResult::read_only(
                json!({"layers":self.evaluated(t)?}),
            ));
        }
        if cmd.op == "readRasterAsset" {
            let asset = self
                .state
                .assets
                .get(&id(p, "id")?)
                .ok_or_else(|| bad("unknown raster asset"))?;
            return Ok(CommandResult::read_only(json!({"id":asset.id,"width":asset.width,"height":asset.height,"format":asset.format})).with_bytes(&cmd,"pixels_b64",(*asset.pixels).clone()));
        }
        if cmd.op == "renderFrame" {
            return self.render(&cmd, None);
        }
        let mut next = (*self.state).clone();
        let mut data = json!({"ok":true});
        match cmd.op.as_str() {
            "new" => {
                next = merge(
                    &State::default(),
                    p,
                    &["title", "width", "height", "duration_s", "frame_rate"],
                )?;
            }
            "setComposition" => {
                // Merge only header values: immutable asset buffers must remain Arc-shared.
                #[derive(Serialize, Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Header {
                    title: String,
                    width: u32,
                    height: u32,
                    duration_s: f64,
                    frame_rate: Rate,
                }
                let header = Header {
                    title: next.title.clone(),
                    width: next.width,
                    height: next.height,
                    duration_s: next.duration_s,
                    frame_rate: next.frame_rate.clone(),
                };
                let header = merge(
                    &header,
                    p,
                    &["title", "width", "height", "duration_s", "frame_rate"],
                )?;
                next.title = header.title;
                next.width = header.width;
                next.height = header.height;
                next.duration_s = header.duration_s;
                next.frame_rate = header.frame_rate;
            }
            "addShapeLayer" => {
                let shape: Shape = serde_json::from_value(
                    p.get("shape")
                        .cloned()
                        .ok_or_else(|| bad("shape required"))?,
                )?;
                let name = p
                    .get("name")
                    .map(|v| v.as_str().ok_or_else(|| bad("name must be a string")))
                    .transpose()?
                    .unwrap_or("Layer")
                    .to_string();
                let layer = next.next_layer_id;
                next.next_layer_id = layer.checked_add(1).ok_or_else(|| bad("id overflow"))?;
                next.layers.push(Arc::new(Layer {
                    id: layer,
                    name,
                    visible: true,
                    locked: false,
                    shape: Some(shape),
                    asset_id: None,
                    transform: Transform::default(),
                    opacity: 1.,
                    curves: vec![],
                }));
                data = json!({"layer_id":layer});
            }
            "addRasterLayer" => {
                let asset_id = id(p, "asset_id")?;
                if !next.assets.contains_key(&asset_id) {
                    return Err(bad("unknown raster asset"));
                }
                let layer = next.next_layer_id;
                next.next_layer_id = layer
                    .checked_add(1)
                    .ok_or_else(|| bad("layer identity exhausted"))?;
                let name = p
                    .get("name")
                    .map(|v| v.as_str().ok_or_else(|| bad("name must be a string")))
                    .transpose()?
                    .unwrap_or("Raster layer")
                    .to_string();
                next.layers.push(Arc::new(Layer {
                    id: layer,
                    name,
                    visible: true,
                    locked: false,
                    shape: None,
                    asset_id: Some(asset_id),
                    transform: Transform::default(),
                    opacity: 1.,
                    curves: vec![],
                }));
                data = json!({"layer_id":layer});
            }
            "removeRasterAsset" => {
                let asset_id = id(p, "id")?;
                if next.layers.iter().any(|l| l.asset_id == Some(asset_id)) {
                    return Err(bad("raster asset remains referenced by a layer"));
                }
                if next.assets.remove(&asset_id).is_none() {
                    return Err(bad("unknown raster asset"));
                }
            }
            "setLayerOrder" => {
                let order: Vec<u64> = serde_json::from_value(
                    p.get("order")
                        .cloned()
                        .ok_or_else(|| bad("order required"))?,
                )?;
                if order.len() != next.layers.len()
                    || order.iter().collect::<BTreeSet<_>>().len() != order.len()
                {
                    return Err(bad("order must be an exact permutation"));
                }
                let mut layers = Vec::new();
                for id in order {
                    layers.push(
                        next.layers
                            .iter()
                            .find(|l| l.id == id)
                            .ok_or_else(|| bad("unknown layer"))?
                            .clone(),
                    )
                }
                next.layers = layers;
            }
            "updateLayer" | "removeLayer" | "setPropertyKeys" => {
                let layer_id = id(
                    p,
                    if cmd.op == "setPropertyKeys" {
                        "layer"
                    } else {
                        "id"
                    },
                )?;
                let i = next
                    .layers
                    .iter()
                    .position(|l| l.id == layer_id)
                    .ok_or_else(|| bad("unknown layer"))?;
                let l = &next.layers[i];
                if cmd.op == "removeLayer" {
                    if l.locked {
                        return Err(bad("layer is locked"));
                    }
                    next.layers.remove(i);
                } else if cmd.op == "updateLayer" {
                    if p.get("shape").is_some() && l.shape.is_none()
                        || p.get("asset_id").is_some() && l.asset_id.is_none()
                    {
                        return Err(bad("layer content kind cannot change via updateLayer"));
                    }
                    if l.locked
                        && p.as_object().is_some_and(|o| {
                            o.keys().any(|k| !["id", "locked"].contains(&k.as_str()))
                        })
                    {
                        return Err(bad("layer is locked"));
                    }
                    let mut patch = p.clone();
                    patch
                        .as_object_mut()
                        .ok_or_else(|| bad("expected patch object"))?
                        .remove("id");
                    if let Some(t) = p.get("transform") {
                        patch["transform"] = serde_json::to_value(merge(
                            &l.transform,
                            t,
                            &["tx", "ty", "sx", "sy", "rotation", "ox", "oy"],
                        )?)?
                    }
                    next.layers[i] = Arc::new(merge(
                        &**l,
                        &patch,
                        &["name", "visible", "locked", "shape", "transform", "opacity"],
                    )?);
                } else {
                    if l.locked {
                        return Err(bad("layer is locked"));
                    }
                    let property: Property = serde_json::from_value(
                        p.get("property")
                            .cloned()
                            .ok_or_else(|| bad("property required"))?,
                    )?;
                    let input = p
                        .get("keys")
                        .and_then(Value::as_array)
                        .ok_or_else(|| bad("keys required"))?;
                    if input.len() > 10000 {
                        return Err(bad("curve key budget exceeded"));
                    }
                    let allowed: BTreeSet<u64> = l
                        .curves
                        .iter()
                        .filter(|c| c.property == property)
                        .flat_map(|c| c.keys.iter().map(|k| k.id))
                        .collect();
                    let mut keys = Vec::new();
                    for item in input {
                        let mut value = item.clone();
                        let object = value
                            .as_object_mut()
                            .ok_or_else(|| bad("each key must be an object"))?;
                        if !object.contains_key("id") {
                            object.insert("id".to_string(), json!(next.next_key_id));
                            next.next_key_id = next
                                .next_key_id
                                .checked_add(1)
                                .ok_or_else(|| bad("id overflow"))?
                        } else if !allowed.contains(&id(&value, "id")?) {
                            return Err(bad("key identity belongs to another curve"));
                        }
                        keys.push(serde_json::from_value(value)?)
                    }
                    data = json!({"key_ids":keys.iter().map(|k:&Key|k.id).collect::<Vec<_>>()});
                    let mut layer = (**l).clone();
                    if keys.is_empty() {
                        layer.curves.retain(|c| c.property != property)
                    } else if let Some(curve) =
                        layer.curves.iter_mut().find(|c| c.property == property)
                    {
                        curve.keys = Arc::new(keys)
                    } else {
                        layer.curves.push(Curve {
                            property,
                            keys: Arc::new(keys),
                        })
                    }
                    next.layers[i] = Arc::new(layer);
                }
            }
            _ => return Err(EngineError::unsupported("unknown motion operation")),
        }
        validate(&next)?;
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
        if staged.state != self.state {
            self.journal.record(self.state.clone());
            self.state = staged.state
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
            self.render(&cmd, Some(ctx))?
        } else {
            self.apply(cmd)?
        };
        ctx.set_progress(1.);
        Ok(result)
    }
    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        Ok(encode_envelope(&serde_json::to_vec(&*self.state)?))
    }
    fn restore(&mut self, bytes: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(bytes)?;
        if payload.len() > MAX_BYTES {
            return Err(bad("state exceeds budget"));
        }
        let wire: Value = serde_json::from_slice(payload)?;
        assets::preflight(&wire)?;
        let next: State = serde_json::from_value(wire)?;
        validate(&next)?;
        self.state = Arc::new(next);
        self.journal = Journal::new(HISTORY);
        Ok(())
    }
    fn undo(&mut self) -> Result<bool, EngineError> {
        if let Some(old) = self.journal.pop_undo() {
            let now = std::mem::replace(&mut self.state, old);
            self.journal.push_redo(now);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn redo(&mut self) -> Result<bool, EngineError> {
        if let Some(next) = self.journal.pop_redo() {
            let now = std::mem::replace(&mut self.state, next);
            self.journal.push_undo(now);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn layer(e: &mut MotionEngine) -> u64 {
        call(
            e,
            "addShapeLayer",
            json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,0,0,255]}}),
        )
        .data["layer_id"]
            .as_u64()
            .unwrap()
    }
    fn keys() -> Value {
        json!([{"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},{"time":1,"value":1,"interpolation":"linear","in_handle":null,"out_handle":null}])
    }
    #[test]
    fn real_rgba_json_binary_history_and_snapshot() {
        let mut e = MotionEngine::new();
        call(&mut e, "new", json!({"width":2,"height":1,"duration_s":1}));
        let id = layer(&mut e);
        let baseline = e.snapshot().unwrap();
        let assigned = call(
            &mut e,
            "setPropertyKeys",
            json!({"layer":id,"property":"tx","keys":keys()}),
        );
        assert_eq!(assigned.events.len(), 1);
        let animated = e.snapshot().unwrap();
        for (t, expected) in [
            (0., vec![255, 0, 0, 255, 0, 0, 0, 0]),
            (1., vec![0, 0, 0, 0, 255, 0, 0, 255]),
        ] {
            let r = e
                .apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
                .unwrap();
            assert!(r.events.is_empty());
            assert_eq!(r.output.unwrap(), expected);
        }
        let r = call(&mut e, "renderFrame", json!({"time_s":0}));
        assert!(r.data["pixels_b64"].is_string());
        assert!(r.output.is_none());
        assert_eq!(e.snapshot().unwrap(), animated);
        let mut reopened = MotionEngine::new();
        reopened.restore(&animated).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), animated);
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), baseline);
        assert!(call(&mut e, "setComposition", json!({"width":2}))
            .events
            .is_empty());
        assert!(e
            .apply(Command::new("setComposition", json!({"width":0})))
            .is_err());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), animated);
        for bytes in [
            vec![],
            pitch_engine_free_foreign(),
            encode_envelope(br#"{"kind":"motion","schema":2}"#),
        ] {
            assert!(e.restore(&bytes).is_err());
            assert_eq!(e.snapshot().unwrap(), animated)
        }
    }
    fn pitch_engine_free_foreign() -> Vec<u8> {
        encode_envelope(br#"{"kind":"photo","schema":1}"#)
    }
    #[test]
    fn pivoted_mirror_batch_and_corrupt_restore_are_real_and_atomic() {
        let mut e = MotionEngine::new();
        call(&mut e, "new", json!({"width":3,"height":1}));
        let id = layer(&mut e);
        let before = e.snapshot().unwrap();
        call(
            &mut e,
            ignition_core::OP_BATCH,
            json!({"commands":[
                {"op":"updateLayer","payload":{"id":id,"transform":{"sx":-1,"ox":0.5,"tx":1}}},
                {"op":"updateLayer","payload":{"id":id,"name":"Mirror"}}
            ]}),
        );
        let rendered = e
            .apply(Command::new("renderFrame", json!({"time_s":0})).with_binary(None))
            .unwrap();
        assert_eq!(
            rendered.output.unwrap(),
            vec![0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]
        );
        let mirrored = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), mirrored);
        let mut malformed = serde_json::to_value(&*e.state).unwrap();
        malformed["next_layer_id"] = json!(id);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&malformed).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), mirrored);
        let cancel_batch = call(
            &mut e,
            ignition_core::OP_BATCH,
            json!({"commands":[{"op":"updateLayer","payload":{"id":id,"name":"Temporary"}},{"op":"updateLayer","payload":{"id":id,"name":"Mirror"}}]}),
        );
        assert!(cancel_batch.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), mirrored);
    }

    #[test]
    fn budgets_and_sixteen_entry_history_are_bounded() {
        let mut e = MotionEngine::new();
        let id = layer(&mut e);
        for index in 0..20 {
            call(
                &mut e,
                "updateLayer",
                json!({"id":id,"name":format!("Name {index}")}),
            );
        }
        let mut count = 0;
        while e.undo().unwrap() {
            count += 1;
        }
        assert_eq!(count, 16);
        let before = e.snapshot().unwrap();
        let many = vec![
            json!({"time":0,"value":0,"interpolation":"hold","in_handle":null,"out_handle":null});
            10001
        ];
        assert!(e
            .apply(Command::new(
                "setPropertyKeys",
                json!({"layer":id,"property":"tx","keys":many})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        let mut state = (*e.state).clone();
        state.layers = vec![state.layers[0].clone(); 129];
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        let mut state = (*e.state).clone();
        Arc::make_mut(&mut state.layers[0]).name = "x".repeat(MAX_BYTES);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn accepted_coordinate_limits_match_prism_public_render_operations() {
        let mut e = MotionEngine::new();
        call(&mut e, "new", json!({"width":1,"height":1}));
        let id = layer(&mut e);
        call(
            &mut e,
            "updateLayer",
            json!({"id":id,"transform":{"tx":1e7,"ox":1e7,"rotation":1e7}}),
        );
        assert!(e
            .apply(Command::new("renderFrame", json!({"time_s":0})))
            .is_ok());
        let before = e.snapshot().unwrap();
        for patch in [
            json!({"transform":{"tx":1e7+1.}}),
            json!({"transform":{"oy":1e7+1.}}),
            json!({"shape":{"kind":"rect","x":1e7+1.,"y":0,"w":1,"h":1,"fill":[255,0,0,255]}}),
        ] {
            let mut payload = patch;
            payload["id"] = json!(id);
            assert!(e.apply(Command::new("updateLayer", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn malformed_key_values_never_panic_or_change_state_or_redo() {
        use std::panic::{catch_unwind, AssertUnwindSafe};
        let mut e = MotionEngine::new();
        let layer_id = layer(&mut e);
        let original = e.snapshot().unwrap();
        call(
            &mut e,
            "updateLayer",
            json!({"id":layer_id,"name":"Redo target"}),
        );
        let changed = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        for invalid in [
            Value::Null,
            json!(true),
            json!(false),
            json!(0),
            json!(-1),
            json!(1.5),
            json!("key"),
            json!([]),
            json!([{}]),
            json!({}),
        ] {
            // Also exercise failure after a valid new key was staged locally.
            for items in [
                json!([invalid.clone()]),
                json!([{"time":0,"value":0,"interpolation":"hold","in_handle":null,"out_handle":null},invalid.clone()]),
            ] {
                let response = catch_unwind(AssertUnwindSafe(|| {
                    e.apply(Command::new(
                        "setPropertyKeys",
                        json!({"layer":layer_id,"property":"tx","keys":items}),
                    ))
                }));
                assert!(response.is_ok(), "malformed key panicked: {invalid}");
                assert!(
                    response.unwrap().is_err(),
                    "malformed key succeeded: {invalid}"
                );
                assert_eq!(e.snapshot().unwrap(), original);
                assert!(e.redo().unwrap());
                assert_eq!(e.snapshot().unwrap(), changed);
                assert!(e.undo().unwrap());
                assert_eq!(e.snapshot().unwrap(), original);
            }
        }
    }

    #[test]
    fn validation_batch_and_cancel_preserve_state() {
        let mut e = MotionEngine::new();
        let id = layer(&mut e);
        let baseline = e.snapshot().unwrap();
        for (op, p) in [
            (
                "setPropertyKeys",
                json!({"layer":id,"property":"tx","keys":[{"id":99,"time":0,"value":0,"interpolation":"hold","in_handle":null,"out_handle":null}]}),
            ),
            ("setComposition", json!({"width":4096,"height":4096})),
            ("setLayerOrder", json!({"order":[id,id]})),
            ("updateLayer", json!({"id":id,"transform":{"sx":0}})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err());
            assert_eq!(e.snapshot().unwrap(), baseline)
        }
        let ctx = TaskContext::new();
        ctx.cancel();
        assert!(e
            .apply_long(Command::new("renderFrame", json!({"time_s":0})), &ctx)
            .is_err());
        assert_eq!(e.snapshot().unwrap(), baseline);
        let batch = json!({"commands":[{"op":"updateLayer","payload":{"id":id,"opacity":0.5}},{"op":"setComposition","payload":{"height":0}}]});
        assert!(e
            .apply(Command::new(ignition_core::OP_BATCH, batch))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), baseline);
    }
}
#[cfg(test)]
mod raster_tests;
