//! Persistent bounded 2D motion. Prism owns rasterization/compositing.
mod assets;
mod curve;
mod effects;
mod path;
use assets::RasterAsset;
use curve::{evaluate, Key};
use effects::{apply_effects, LayerEffect};
use path::MotionPath;
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
/// Snapshot schema written by this version; restore accepts 1..=SCHEMA_VERSION.
const SCHEMA_VERSION: u32 = 2;
const MAX_COMPOSITIONS: usize = 16;
/// Longest chain of nested compositions below the root composition.
const MAX_COMP_DEPTH: usize = 8;
/// Longest matte reference chain rendered within one composition.
const MAX_MATTE_DEPTH: usize = 8;
/// Largest accepted matte feather radius in pixels.
const MAX_MATTE_FEATHER: f64 = 64.;
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
    /// Arc-length progress along `Layer.path` (slice E); wire name keeps the
    /// snake_case convention of the transform properties.
    #[serde(rename = "path_progress")]
    PathProgress,
}
impl Property {
    fn bounds(self) -> (f64, f64) {
        match self {
            Self::Opacity | Self::PathProgress => (0., 1.),
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
            Self::PathProgress => l.path_progress,
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
            Self::PathProgress => l.path_progress = v,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Curve {
    property: Property,
    keys: Arc<Vec<Key>>,
}
/// W3C Compositing Level 1 blend modes; wire names match Prism's kebab-case
/// `BlendMode` exactly so they pass through to `setLayerBlend` unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Add,
}
impl BlendMode {
    fn parse(s: &str) -> Option<Self> {
        serde_json::from_value(Value::String(s.to_string())).ok()
    }
    /// Prism `setLayerBlend` payload name (identical kebab-case names).
    fn prism_name(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Multiply => "multiply",
            Self::Screen => "screen",
            Self::Overlay => "overlay",
            Self::Darken => "darken",
            Self::Lighten => "lighten",
            Self::ColorDodge => "color-dodge",
            Self::ColorBurn => "color-burn",
            Self::HardLight => "hard-light",
            Self::SoftLight => "soft-light",
            Self::Difference => "difference",
            Self::Exclusion => "exclusion",
            Self::Add => "add",
        }
    }
}
/// Track-matte source modes; wire names are kebab-case like `BlendMode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum MatteMode {
    Alpha,
    AlphaInverted,
    Luma,
    LumaInverted,
}
/// A layer matte: another layer in the same composition supplies the mask.
/// `feather` is the bounded edge falloff in pixels (0..=64); `enabled=false`
/// stores the matte without applying it at render time.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LayerMatte {
    source_layer: u64,
    mode: MatteMode,
    #[serde(default)]
    feather: f64,
    #[serde(default = "matte_enabled_default")]
    enabled: bool,
}
fn matte_enabled_default() -> bool {
    true
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum LayerKind {
    Shape,
    Raster,
    Comp,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Layer {
    id: u64,
    name: String,
    visible: bool,
    locked: bool,
    /// Content kind; absent only in schema:1 snapshots (inferred on restore).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    kind: Option<LayerKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shape: Option<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    asset_id: Option<u64>,
    /// Composition instantiated by a `comp` layer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    comp_id: Option<u64>,
    /// Transform parent: another layer in the same composition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_id: Option<u64>,
    /// W3C blend mode against the layers below in the same composition;
    /// absent means normal. `"normal"`/`null` both clear to absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    blend: Option<BlendMode>,
    /// Clipping mask: the layer renders only through the alpha of the
    /// nearest unclipped sibling below it in the same composition (Prism
    /// `clipped`; consecutive clipped layers share that base's alpha).
    #[serde(default, skip_serializing_if = "is_false")]
    clipped: bool,
    /// Track matte supplied by another layer in the same composition; absent
    /// means no matte. Additive serde default keeps schema at 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    matte: Option<LayerMatte>,
    /// Bounded CPU effect stack (slice C), applied in order to the layer's
    /// rendered canvas-space RGBA after its transform and before opacity,
    /// blend, clipping and matte composite it. Additive serde default keeps
    /// schema at 2; empty stacks serialize identically to effect-free layers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    effects: Vec<LayerEffect>,
    /// Optional motion path (slice E): one Prism-style node subpath in the
    /// layer's transform space. `path_progress` curves select the arc-length
    /// position; the sampled offset adds to evaluated `tx`/`ty` and, when
    /// `path.auto_orient` is set, the tangent angle adds to `rotation`.
    /// Additive serde default keeps schema at 2; path-free layers serialize
    /// identically to pre-E snapshots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<MotionPath>,
    /// Authored base arc-length progress along `path` (0..=1); a
    /// `path_progress` curve overrides it at evaluation. Validate rejects
    /// nonzero values and `path_progress` curves when `path` is absent.
    #[serde(default, skip_serializing_if = "is_zero_f64")]
    path_progress: f64,
    transform: Transform,
    opacity: f64,
    curves: Vec<Curve>,
}
/// A nested composition. The root composition is the document header plus
/// `State::layers`; entries here are referenced by `comp` layers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Composition {
    id: u64,
    name: String,
    width: u32,
    height: u32,
    duration_s: f64,
    frame_rate: Rate,
    layers: Vec<Arc<Layer>>,
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
    compositions: BTreeMap<u64, Composition>,
    #[serde(
        default = "initial_comp_id",
        skip_serializing_if = "is_initial_comp_id"
    )]
    next_comp_id: u64,
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
            schema: SCHEMA_VERSION,
            title: "Untitled".into(),
            width: 640,
            height: 360,
            duration_s: 10.,
            frame_rate: Rate { num: 30, den: 1 },
            next_layer_id: 1,
            next_key_id: 1,
            layers: vec![],
            compositions: BTreeMap::new(),
            next_comp_id: 1,
            assets: BTreeMap::new(),
            next_asset_id: 1,
        }
    }
}
fn initial_comp_id() -> u64 {
    1
}
fn is_initial_comp_id(id: &u64) -> bool {
    *id == 1
}
fn is_false(v: &bool) -> bool {
    !*v
}
fn is_zero_f64(v: &f64) -> bool {
    *v == 0.
}
/// schema:1 snapshots predate `kind`; infer it from the content source.
/// Hostile or inconsistent explicit kinds are left for `validate` to reject.
fn normalize_layers(state: &mut State) {
    let all = state
        .layers
        .iter_mut()
        .chain(
            state
                .compositions
                .values_mut()
                .flat_map(|c| c.layers.iter_mut()),
        );
    for layer in all {
        if layer.kind.is_none() {
            Arc::make_mut(layer).kind = Some(if layer.comp_id.is_some() {
                LayerKind::Comp
            } else if layer.asset_id.is_some() {
                LayerKind::Raster
            } else {
                LayerKind::Shape
            });
        }
    }
}
/// State equality ignoring the schema marker (mutations bump it to current).
fn content_eq(a: &State, b: &State) -> bool {
    if a.schema == b.schema {
        a == b
    } else {
        let mut x = a.clone();
        x.schema = b.schema;
        x == *b
    }
}
/// `x' = a·x + c·y + e`, `y' = b·x + d·y + f`; mirrors Prism's affine model.
#[derive(Clone, Copy, Debug)]
struct Affine {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}
impl Affine {
    /// `self · other` — apply `other` first, then `self`.
    fn then_after(&self, other: &Affine) -> Affine {
        Affine {
            a: self.a * other.a + self.c * other.b,
            b: self.b * other.a + self.d * other.b,
            c: self.a * other.c + self.c * other.d,
            d: self.b * other.c + self.d * other.d,
            e: self.a * other.e + self.c * other.f + self.e,
            f: self.b * other.e + self.d * other.f + self.f,
        }
    }
}
fn transform_affine(t: &Transform) -> Affine {
    if *t == Transform::default() {
        return Affine {
            a: 1.,
            b: 0.,
            c: 0.,
            d: 1.,
            e: 0.,
            f: 0.,
        };
    }
    let (s, c) = t.rotation.to_radians().sin_cos();
    let a = c * t.sx;
    let b = s * t.sx;
    let cc = -s * t.sy;
    let d = c * t.sy;
    Affine {
        a,
        b,
        c: cc,
        d,
        e: t.tx + t.ox - (a * t.ox + cc * t.oy),
        f: t.ty + t.oy - (b * t.ox + d * t.oy),
    }
}
/// Decompose a skew-free affine into a pivot-less Transform (pivot folded in).
fn decompose(m: &Affine) -> Option<Transform> {
    let sx = m.a.hypot(m.b);
    if sx < 1e-9 || !sx.is_finite() {
        return None;
    }
    let sy = m.d * m.a - m.b * m.c;
    let sy = sy / sx;
    if sy.abs() < 1e-9
        || !sy.is_finite()
        || (m.a * m.c + m.b * m.d).abs() / (sx * sy.abs()) > 1e-6
    {
        return None;
    }
    Some(Transform {
        tx: m.e,
        ty: m.f,
        sx,
        sy,
        rotation: m.b.atan2(m.a).to_degrees(),
        ox: 0.,
        oy: 0.,
    })
}
/// Effective affine of a layer: parent chain transforms compose outermost-first.
/// Only the transform inherits; opacity/visibility/curves stay per-layer.
fn effective_affine<'a>(
    layer: &Layer,
    by_id: &BTreeMap<u64, &'a Layer>,
) -> Result<Affine, EngineError> {
    let mut acc = transform_affine(&layer.transform);
    let mut seen = BTreeSet::new();
    let mut current = layer.parent_id;
    while let Some(pid) = current {
        if !seen.insert(pid) {
            return Err(bad("layer parent cycle"));
        }
        let parent = by_id
            .get(&pid)
            .ok_or_else(|| bad("layer parent must be a layer in the same composition"))?;
        acc = transform_affine(&parent.transform).then_after(&acc);
        current = parent.parent_id;
    }
    Ok(acc)
}
/// Read-only view of one composition's render-relevant fields.
struct CompView<'a> {
    width: u32,
    height: u32,
    duration_s: f64,
    layers: &'a [Arc<Layer>],
}
impl State {
    fn comp_view(&self, comp: Option<u64>) -> Result<CompView<'_>, EngineError> {
        match comp {
            None => Ok(CompView {
                width: self.width,
                height: self.height,
                duration_s: self.duration_s,
                layers: &self.layers,
            }),
            Some(id) => {
                let c = self
                    .compositions
                    .get(&id)
                    .ok_or_else(|| bad("unknown composition"))?;
                Ok(CompView {
                    width: c.width,
                    height: c.height,
                    duration_s: c.duration_s,
                    layers: &c.layers,
                })
            }
        }
    }
    /// Composition selector used by ops: `None`/0 is the root composition.
    fn comp_arg(p: &Value, name: &str) -> Result<Option<u64>, EngineError> {
        match p.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => {
                let id = v
                    .as_u64()
                    .ok_or_else(|| bad("composition must be an integer id"))?;
                Ok((id != 0).then_some(id))
            }
        }
    }
}
fn valid_rate(rate: &Rate) -> bool {
    rate.num != 0
        && rate.num <= 240000
        && rate.den != 0
        && rate.den <= 1001
        && (1.0..=240.0).contains(&(f64::from(rate.num) / f64::from(rate.den)))
}
fn valid_dims(width: u32, height: u32) -> bool {
    width != 0
        && height != 0
        && width <= 4096
        && height <= 4096
        && u64::from(width) * u64::from(height) <= 1_048_576
}
fn valid_duration(duration_s: f64) -> bool {
    duration_s.is_finite() && duration_s > 0. && duration_s <= 604800.
}
fn validate(s: &State) -> Result<(), EngineError> {
    if s.kind != "motion"
        || !(1..=SCHEMA_VERSION).contains(&s.schema)
        || s.title.len() > 512
        || !valid_dims(s.width, s.height)
        || !valid_duration(s.duration_s)
        || s.compositions.len() > MAX_COMPOSITIONS
        || !valid_rate(&s.frame_rate)
        || s.next_layer_id == 0
        || s.next_key_id == 0
        || s.next_comp_id == 0
        || s.next_layer_id > SAFE_ID
        || s.next_key_id > SAFE_ID
        || s.next_comp_id > SAFE_ID
    {
        return Err(bad("invalid motion header or budget"));
    }
    for (&id, comp) in &s.compositions {
        if id != comp.id
            || comp.id == 0
            || comp.id >= s.next_comp_id
            || comp.name.len() > 512
            || !valid_dims(comp.width, comp.height)
            || !valid_duration(comp.duration_s)
            || !valid_rate(&comp.frame_rate)
        {
            return Err(bad("invalid composition identity or budget"));
        }
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
    // Composition views: key 0 is the root, other keys are composition ids.
    let mut views: Vec<(u64, u32, u32, f64, &[Arc<Layer>])> = vec![(
        0,
        s.width,
        s.height,
        s.duration_s,
        s.layers.as_slice(),
    )];
    for (id, comp) in &s.compositions {
        views.push((
            *id,
            comp.width,
            comp.height,
            comp.duration_s,
            comp.layers.as_slice(),
        ));
    }
    // Pass 1: globally unique layer/key identities, per-comp id sets, budgets.
    let (mut ids, mut keys) = (BTreeSet::new(), BTreeSet::new());
    let mut comp_members: BTreeMap<u64, BTreeMap<u64, &Layer>> = BTreeMap::new();
    let (mut total_layers, mut curves, mut count) = (0usize, 0usize, 0usize);
    for &(key, _, _, _, layers) in &views {
        let members = comp_members.entry(key).or_default();
        for l in layers {
            if l.id == 0
                || l.id >= s.next_layer_id
                || !ids.insert(l.id)
                || l.name.len() > 512
                || members.insert(l.id, &**l).is_some()
            {
                return Err(bad("invalid layer identity"));
            }
            total_layers += 1;
        }
    }
    if total_layers > 128 {
        return Err(bad("motion total layer budget exceeded"));
    }
    // Pass 2: per-layer content, transform, curves and parent references.
    for &(key, width, height, duration_s, layers) in &views {
        let members = &comp_members[&key];
        // Asset-backed layers and layers with a non-empty effect stack both
        // materialize a canvas-sized raster upload in the ephemeral Prism
        // scene at render (see `stage_effects`), so they share one logical
        // canvas-storage budget; a layer that is both counts once.
        let canvas_rasters = layers
            .iter()
            .filter(|l| l.asset_id.is_some() || !l.effects.is_empty())
            .count();
        if canvas_rasters > assets::MAX_RASTER_LAYERS
            || u64::from(width) * u64::from(height) * 4 * canvas_rasters as u64
                > assets::MAX_CANVAS_STORAGE
        {
            return Err(bad("logical raster layer canvas storage exceeds budget"));
        }
        for (index, l) in layers.iter().enumerate() {
            // Layers are bottom-to-top; a clipped layer needs a sibling below
            // to clip to (Prism `setClipped` parity).
            if l.clipped && index == 0 {
                return Err(bad("clipped layer requires a sibling below it"));
            }
            if let Some(matte) = l.matte {
                if !matte.feather.is_finite() || !(0.0..=MAX_MATTE_FEATHER).contains(&matte.feather)
                {
                    return Err(bad("invalid matte feather"));
                }
                if matte.source_layer == l.id || !members.contains_key(&matte.source_layer) {
                    return Err(bad(
                        "matte source must be another layer in the same composition",
                    ));
                }
            }
            if l.effects.len() > effects::MAX_EFFECTS
                || l.effects.iter().any(|e| !e.valid())
            {
                return Err(bad("invalid layer effect stack"));
            }
            if let Some(mpath) = &l.path {
                mpath.validate().map_err(|_| bad("invalid motion path"))?;
            } else if l.path_progress != 0.
                || l.curves
                    .iter()
                    .any(|c| c.property == Property::PathProgress)
            {
                return Err(bad("path progress requires a motion path"));
            }
            match (l.kind, &l.shape, l.asset_id, l.comp_id) {
                (Some(LayerKind::Shape), Some(sh), None, None) => {
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
                (Some(LayerKind::Raster), None, Some(id), None) => {
                    let asset = s
                        .assets
                        .get(&id)
                        .ok_or_else(|| bad("raster layer references unknown asset"))?;
                    if asset.width > width || asset.height > height {
                        return Err(bad(
                            "referenced raster asset must fit composition dimensions",
                        ));
                    }
                }
                (Some(LayerKind::Comp), None, None, Some(id)) => {
                    let comp = s
                        .compositions
                        .get(&id)
                        .ok_or_else(|| bad("comp layer references unknown composition"))?;
                    if comp.width > width || comp.height > height {
                        return Err(bad(
                            "referenced composition must fit containing composition dimensions",
                        ));
                    }
                }
                _ => {
                    return Err(bad(
                        "layer kind must match exactly one shape, raster asset or composition",
                    ))
                }
            }
            if let Some(pid) = l.parent_id {
                if pid == l.id || !members.contains_key(&pid) {
                    return Err(bad("layer parent must be another layer in the same composition"));
                }
                // Parent chains are acyclic and bounded by the comp's layer count.
                let mut seen = BTreeSet::new();
                let mut cursor = Some(pid);
                while let Some(id) = cursor {
                    if !seen.insert(id) {
                        return Err(bad("layer parent cycle"));
                    }
                    cursor = members[&id].parent_id;
                }
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
                Property::PathProgress,
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
                evaluate(&c.keys, c.property.read(l), 0., duration_s, min, max)
                    .map_err(bad)?;
            }
        }
    }
    // Pass 2b: matte chains are acyclic and bounded so render recursion
    // terminates. Sources are already proven same-composition above, and the
    // check covers every matte edge including disabled ones.
    for &(_, _, _, _, layers) in &views {
        let matte_of: BTreeMap<u64, u64> = layers
            .iter()
            .filter_map(|l| l.matte.map(|m| (l.id, m.source_layer)))
            .collect();
        for &start in matte_of.keys() {
            let mut seen = BTreeSet::from([start]);
            let mut cursor = matte_of[&start];
            let mut hops = 1usize;
            while matte_of.contains_key(&cursor) {
                if hops >= MAX_MATTE_DEPTH || !seen.insert(cursor) {
                    return Err(bad("cyclic or over-deep matte chain"));
                }
                hops += 1;
                cursor = matte_of[&cursor];
            }
        }
    }
    // Pass 3: composition reference graph is acyclic with bounded depth.
    // Node keys match `views`: 0 is the root, other keys are composition ids.
    let mut edges: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    for (key, _, _, _, layers) in &views {
        let mut refs: Vec<u64> = layers
            .iter()
            .filter(|l| l.kind == Some(LayerKind::Comp))
            .filter_map(|l| l.comp_id)
            .collect();
        refs.sort_unstable();
        refs.dedup();
        edges.insert(*key, refs);
    }
    let mut depth_memo: BTreeMap<u64, usize> = BTreeMap::new();
    fn depth(
        node: u64,
        edges: &BTreeMap<u64, Vec<u64>>,
        memo: &mut BTreeMap<u64, usize>,
        visiting: &mut BTreeSet<u64>,
    ) -> Result<usize, EngineError> {
        if let Some(d) = memo.get(&node) {
            return Ok(*d);
        }
        if !visiting.insert(node) {
            return Err(bad("cyclic composition reference"));
        }
        let mut deepest = 0usize;
        for &child in &edges[&node] {
            deepest = deepest.max(depth(child, edges, memo, visiting)?);
        }
        visiting.remove(&node);
        // Root contributes no depth; each composition level adds one.
        let d = if node == 0 { deepest } else { deepest + 1 };
        memo.insert(node, d);
        Ok(d)
    }
    let mut visiting = BTreeSet::new();
    for &node in edges.keys() {
        let d = depth(node, &edges, &mut depth_memo, &mut visiting)?;
        if node != 0 && d > MAX_COMP_DEPTH {
            return Err(bad("composition nesting depth exceeded"));
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
/// Locate a layer by its globally unique id. Returns (composition, index)
/// where `None` is the root composition.
fn locate_layer(s: &State, layer: u64) -> Option<(Option<u64>, usize)> {
    if let Some(i) = s.layers.iter().position(|l| l.id == layer) {
        return Some((None, i));
    }
    for (id, comp) in &s.compositions {
        if let Some(i) = comp.layers.iter().position(|l| l.id == layer) {
            return Some((Some(*id), i));
        }
    }
    None
}
fn comp_layers<'a>(s: &'a State, comp: Option<u64>) -> Option<&'a [Arc<Layer>]> {
    match comp {
        None => Some(s.layers.as_slice()),
        Some(id) => s.compositions.get(&id).map(|c| c.layers.as_slice()),
    }
}
fn comp_layers_mut<'a>(s: &'a mut State, comp: Option<u64>) -> Option<&'a mut Vec<Arc<Layer>>> {
    match comp {
        None => Some(&mut s.layers),
        Some(id) => s.compositions.get_mut(&id).map(|c| &mut c.layers),
    }
}
/// Orphaned transform children of a removed/reparented layer keep their
/// local transform but lose the parent link.
fn clear_parent_links(layers: &mut [Arc<Layer>], parent: u64) {
    for l in layers.iter_mut() {
        if l.parent_id == Some(parent) {
            Arc::make_mut(l).parent_id = None;
        }
    }
}
/// True when following `from`'s matte chain reaches `target`, meaning a new
/// `target -> from` matte edge would close a cycle. Chains are already valid
/// in `next`, so the walk terminates; `seen` is a defensive backstop.
fn matte_reaches(layers: &[Arc<Layer>], from: u64, target: u64) -> bool {
    let mut seen = BTreeSet::new();
    let mut cursor = Some(from);
    while let Some(id) = cursor {
        if id == target {
            return true;
        }
        if !seen.insert(id) {
            return false;
        }
        cursor = layers
            .iter()
            .find(|l| l.id == id)
            .and_then(|l| l.matte.map(|m| m.source_layer));
    }
    false
}
fn opt_string(p: &Value, name: &str, default: &str) -> Result<String, EngineError> {
    p.get(name)
        .map(|v| v.as_str().ok_or_else(|| bad("name must be a string")))
        .transpose()
        .map(|v| v.unwrap_or(default).to_string())
}
fn opt_u32(p: &Value, name: &str, default: u32) -> Result<u32, EngineError> {
    match p.get(name) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => serde_json::from_value(v.clone())
            .map_err(|_| bad("expected an integer within range")),
    }
}
fn opt_f64(p: &Value, name: &str, default: f64) -> Result<f64, EngineError> {
    match p.get(name) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v
            .as_f64()
            .ok_or_else(|| bad("expected a finite number")),
    }
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
    /// Evaluate one composition's layers at a local time. Curves resolve
    /// against that composition's own duration.
    fn evaluated_layers(
        &self,
        layers: &[Arc<Layer>],
        duration_s: f64,
        time: f64,
    ) -> Result<Vec<Layer>, EngineError> {
        if !time.is_finite() || time < 0. || time > duration_s {
            return Err(bad("time outside composition"));
        }
        layers
            .iter()
            .map(|l| {
                let mut out = (**l).clone();
                for c in &l.curves {
                    let (min, max) = c.property.bounds();
                    let value = evaluate(
                        &c.keys,
                        c.property.read(l),
                        time,
                        duration_s,
                        min,
                        max,
                    )
                    .map_err(bad)?;
                    c.property.write(&mut out, value)
                }
                out.curves.clear();
                // Motion path (slice E): the evaluated progress selects an
                // arc-length point whose offset adds to tx/ty in the layer's
                // transform space; auto_orient adds the tangent angle to
                // rotation. Runs after curves so path_progress keys win and
                // tx/ty keys compose with (never replace) the path offset.
                if let Some(mpath) = &out.path {
                    let (px, py, deg) =
                        mpath.sample_at(out.path_progress).map_err(|_| bad("invalid motion path"))?;
                    let orient = mpath.auto_orient;
                    out.transform.tx += px;
                    out.transform.ty += py;
                    if orient {
                        out.transform.rotation += deg;
                    }
                }
                Ok(out)
            })
            .collect()
    }
    /// Local time inside `comp` for a root-composition time `time`.
    /// Nested time maps proportionally through each composition's duration:
    /// child_time = parent_time * child.duration_s / parent.duration_s,
    /// which telescopes to time * comp.duration_s / root.duration_s and is
    /// clamped to the composition duration. No wrap or offset exists.
    fn comp_local_time(&self, comp: &Composition, time: f64) -> f64 {
        (time * comp.duration_s / self.state.duration_s).clamp(0., comp.duration_s)
    }
    /// Stage one evaluated layer into `prism`. `siblings` enables blend and
    /// clipping, which only make sense inside the flat composition scene;
    /// matte-source renders pass false because a lone staged layer has no
    /// siblings — its transform parents, opacity, visibility and its own
    /// matte still apply, and comp layers still recurse.
    /// `matte_depth` counts matte hops already taken to reach this layer.
    #[allow(clippy::too_many_arguments)]
    fn stage_layer(
        &self,
        prism: &mut prism_engine::PrismEngine,
        view: &CompView,
        l: &Layer,
        by_id: &BTreeMap<u64, &Layer>,
        time: f64,
        ctx: Option<&TaskContext>,
        depth: usize,
        matte_depth: usize,
        siblings: bool,
    ) -> Result<(), EngineError> {
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        let layer = if l.effects.is_empty() {
            self.stage_content(prism, view, l, by_id, time, ctx, depth)?
        } else {
            self.stage_effects(prism, view, l, by_id, time, ctx, depth)?
        };
        prism.apply(Command::new(
            "setLayerOpacity",
            json!({"id":layer,"opacity":l.opacity}),
        ))?;
        prism.apply(Command::new(
            "setLayerVisible",
            json!({"id":layer,"visible":l.visible}),
        ))?;
        if siblings {
            if let Some(blend) = l.blend {
                prism.apply(Command::new(
                    "setLayerBlend",
                    json!({"id":layer,"blend":blend.prism_name()}),
                ))?;
            }
            if l.clipped {
                prism.apply(Command::new(
                    "setClipped",
                    json!({"id":layer,"clipped":true}),
                ))?;
            }
        }
        if let Some(matte) = l.matte {
            // An invisible layer composites to nothing in Prism anyway, so
            // the matte mask render (a full-scene pass over the source) is
            // skipped entirely for hidden targets.
            if matte.enabled && l.visible {
                let mask = self.matte_mask(view, matte, by_id, time, ctx, depth, matte_depth)?;
                // Prism masks are canvas-space alpha: paint the derived mask
                // over an empty mask, then feather it inside Prism.
                prism.apply(Command::new("addMask", json!({"id":layer,"fill":"hide"})))?;
                prism.apply(Command::new(
                    "paintMask",
                    json!({
                        "id":layer,"x":0,"y":0,
                        "w":view.width,"h":view.height,
                        "data_b64":ignition_core::base64_encode(&mask),
                    }),
                ))?;
                if matte.feather > 0. {
                    prism.apply(Command::new(
                        "refineMask",
                        json!({"id":layer,"feather":matte.feather}),
                    ))?;
                }
            }
        }
        Ok(())
    }
    /// Stage one layer's content (shape/raster/comp subtree) plus its
    /// evaluated transform — including `parent_id` inheritance — into
    /// `prism`, and return the Prism layer id. Opacity, visibility, blend,
    /// clipping and matte are composite-stage concerns handled by the caller.
    #[allow(clippy::too_many_arguments)]
    fn stage_content(
        &self,
        prism: &mut prism_engine::PrismEngine,
        view: &CompView,
        l: &Layer,
        by_id: &BTreeMap<u64, &Layer>,
        time: f64,
        ctx: Option<&TaskContext>,
        depth: usize,
    ) -> Result<u64, EngineError> {
        let transform = if l.parent_id.is_some() {
            decompose(&effective_affine(l, by_id)?)
                .ok_or_else(|| bad("layer parent transform chain requires shear"))?
        } else {
            l.transform.clone()
        };
        let result = match l.kind {
            Some(LayerKind::Shape) => {
                let shape = l
                    .shape
                    .as_ref()
                    .ok_or_else(|| bad("shape layer lost shape"))?;
                prism.apply(Command::new("addShape", json!({"shape":shape})))?
            }
            Some(LayerKind::Raster) => {
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
            }
            Some(LayerKind::Comp) => {
                let comp_id = l
                    .comp_id
                    .ok_or_else(|| bad("comp layer lost composition"))?;
                let comp = self
                    .state
                    .compositions
                    .get(&comp_id)
                    .ok_or_else(|| bad("missing composition"))?;
                // Local time maps proportionally through each composition's
                // duration: child = parent_time * child.duration / parent.duration.
                let child_time =
                    (time * comp.duration_s / view.duration_s).clamp(0., comp.duration_s);
                let child_view = CompView {
                    width: comp.width,
                    height: comp.height,
                    duration_s: comp.duration_s,
                    layers: &comp.layers,
                };
                let pixels = self.render_comp(&child_view, child_time, ctx, depth + 1)?;
                let added = prism.apply(Command::new("addRasterLayer", json!({})))?;
                let id = added.data["layer_id"]
                    .as_u64()
                    .ok_or_else(|| bad("Prism raster layer returned no ID"))?;
                prism.apply(
                    Command::new(
                        "drawPixels",
                        json!({"id":id,"x":0,"y":0,"w":comp.width,"h":comp.height}),
                    )
                    .with_binary(Some(pixels)),
                )?;
                added
            }
            None => return Err(bad("layer kind missing")),
        };
        let layer = result
            .data["layer_id"]
            .as_u64()
            .ok_or_else(|| bad("Prism did not return a layer"))?;
        prism.apply(Command::new(
            "setTransformOrigin",
            json!({"id":layer,"ox":transform.ox,"oy":transform.oy}),
        ))?;
        prism.apply(Command::new(
            "setLayerTransform",
            json!({"id":layer,"transform":transform}),
        ))?;
        Ok(layer)
    }
    /// Rasterize-then-process path for a layer with a non-empty effect stack:
    /// the layer's content and evaluated transform render into an ephemeral
    /// canvas-sized Prism scene, the CPU effect passes run in stack order on
    /// the flattened straight RGBA, and the result uploads into the parent
    /// scene as a raster layer at canvas origin with identity transform.
    /// Ordering: effects run AFTER the layer's own render (content +
    /// transform, baked into canvas space) and BEFORE opacity, blend,
    /// clipping and matte, which still composite in the parent scene exactly
    /// as for effect-free layers. Effects therefore force rasterization of
    /// every kind — shape, raster and comp layers alike — at containing
    /// composition dimensions, bounded by the 1-megapixel canvas cap.
    #[allow(clippy::too_many_arguments)]
    fn stage_effects(
        &self,
        prism: &mut prism_engine::PrismEngine,
        view: &CompView,
        l: &Layer,
        by_id: &BTreeMap<u64, &Layer>,
        time: f64,
        ctx: Option<&TaskContext>,
        depth: usize,
    ) -> Result<u64, EngineError> {
        let mut offscreen = prism_engine::PrismEngine::new(view.width, view.height);
        self.stage_content(&mut offscreen, view, l, by_id, time, ctx, depth)?;
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        let mut pixels = offscreen
            .apply(Command::new("flatten", json!({})).with_binary(None))?
            .output
            .ok_or_else(|| bad("Prism did not return RGBA"))?;
        apply_effects(
            &mut pixels,
            view.width as usize,
            view.height as usize,
            &l.effects,
            ctx,
        )?;
        let added = prism.apply(Command::new("addRasterLayer", json!({})))?;
        let layer = added
            .data["layer_id"]
            .as_u64()
            .ok_or_else(|| bad("Prism raster layer returned no ID"))?;
        prism.apply(
            Command::new(
                "drawPixels",
                json!({
                    "id":layer,"x":0,"y":0,
                    "w":view.width,"h":view.height,
                }),
            )
            .with_binary(Some(pixels)),
        )?;
        // The transform is already baked into the pixels; pin the raster to
        // the identity transform/origin the composite tail expects.
        prism.apply(Command::new(
            "setTransformOrigin",
            json!({"id":layer,"ox":0,"oy":0}),
        ))?;
        prism.apply(Command::new(
            "setLayerTransform",
            json!({"id":layer,"transform":Transform::default()}),
        ))?;
        Ok(layer)
    }
    /// Render the matte source layer's subtree standalone into an ephemeral
    /// scene and derive the canvas-space mask for `matte.mode`. Alpha modes
    /// read the flattened alpha channel; luma modes read premultiplied
    /// Rec.601 luminance (transparent pixels contribute 0), inverted modes
    /// complement the derived value. `matte_depth` bounds the chain.
    #[allow(clippy::too_many_arguments)]
    fn matte_mask(
        &self,
        view: &CompView,
        matte: LayerMatte,
        by_id: &BTreeMap<u64, &Layer>,
        time: f64,
        ctx: Option<&TaskContext>,
        depth: usize,
        matte_depth: usize,
    ) -> Result<Vec<u8>, EngineError> {
        if matte_depth >= MAX_MATTE_DEPTH {
            return Err(bad("matte chain depth exceeded"));
        }
        let source = by_id
            .get(&matte.source_layer)
            .copied()
            .ok_or_else(|| bad("matte source layer missing"))?;
        let mut prism = prism_engine::PrismEngine::new(view.width, view.height);
        self.stage_layer(
            &mut prism,
            view,
            source,
            by_id,
            time,
            ctx,
            depth,
            matte_depth + 1,
            false,
        )?;
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        let flat = prism
            .apply(Command::new("flatten", json!({})).with_binary(None))?
            .output
            .ok_or_else(|| bad("Prism did not return RGBA"))?;
        let mut mask = Vec::with_capacity(view.width as usize * view.height as usize);
        for px in flat.chunks_exact(4) {
            let value = match matte.mode {
                MatteMode::Alpha => f64::from(px[3]),
                MatteMode::AlphaInverted => 255. - f64::from(px[3]),
                MatteMode::Luma | MatteMode::LumaInverted => {
                    let lum = 0.299 * f64::from(px[0])
                        + 0.587 * f64::from(px[1])
                        + 0.114 * f64::from(px[2]);
                    let v = (lum * f64::from(px[3]) / 255.).round();
                    if matte.mode == MatteMode::LumaInverted {
                        255. - v
                    } else {
                        v
                    }
                }
            };
            mask.push(value.round().clamp(0., 255.) as u8);
        }
        Ok(mask)
    }
    /// Render one composition to packed RGBA at local `time`. `comp` layers
    /// recurse into their own ephemeral Prism scene at their own dimensions;
    /// the flattened child frame is uploaded into this scene as raster pixels.
    fn render_comp(
        &self,
        view: &CompView,
        time: f64,
        ctx: Option<&TaskContext>,
        depth: usize,
    ) -> Result<Vec<u8>, EngineError> {
        if depth > MAX_COMP_DEPTH {
            return Err(bad("composition nesting depth exceeded"));
        }
        let layers = self.evaluated_layers(view.layers, view.duration_s, time)?;
        let by_id: BTreeMap<u64, &Layer> = layers.iter().map(|l| (l.id, l)).collect();
        let mut prism = prism_engine::PrismEngine::new(view.width, view.height);
        for l in &layers {
            // matte_depth restarts at every composition boundary, so the
            // worst case is MAX_COMP_DEPTH comp renders each taking up to
            // MAX_MATTE_DEPTH matte hops (transient mask buffers included).
            self.stage_layer(&mut prism, view, l, &by_id, time, ctx, depth, 0, true)?;
        }
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        let result = prism.apply(Command::new("flatten", json!({})).with_binary(None))?;
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        result
            .output
            .ok_or_else(|| bad("Prism did not return RGBA"))
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
        if !time.is_finite() || time < 0. || time > self.state.duration_s {
            return Err(bad("time outside composition"));
        }
        let view = self.state.comp_view(None)?;
        let bytes = self.render_comp(&view, time, ctx, 0)?;
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
            next.schema = SCHEMA_VERSION;
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
            if value.get("compositions").is_none() {
                value["compositions"] = json!({});
            }
            value["next_comp_id"] = json!(self.state.next_comp_id);
            return Ok(CommandResult::read_only(value));
        }
        if cmd.op == "evaluate" {
            let t = p
                .get("time_s")
                .and_then(Value::as_f64)
                .ok_or_else(|| bad("time_s required"))?;
            if !t.is_finite() || t < 0. || t > self.state.duration_s {
                return Err(bad("time outside composition"));
            }
            let root = self
                .evaluated_layers(&self.state.layers, self.state.duration_s, t)?;
            // Each nested composition is evaluated independently at its
            // duration-scaled local time (the same mapping renderFrame uses
            // per instance; multiple instances share one reported evaluation).
            let mut compositions = serde_json::Map::new();
            for (id, comp) in &self.state.compositions {
                let local = self.comp_local_time(comp, t);
                compositions.insert(
                    id.to_string(),
                    json!({
                        "id": comp.id,
                        "name": comp.name,
                        "width": comp.width,
                        "height": comp.height,
                        "duration_s": comp.duration_s,
                        "frame_rate": comp.frame_rate,
                        "layers": self.evaluated_layers(&comp.layers, comp.duration_s, local)?,
                    }),
                );
            }
            return Ok(CommandResult::read_only(
                json!({"layers":root,"compositions":compositions}),
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
            "addComposition" => {
                let id = next.next_comp_id;
                next.next_comp_id = id
                    .checked_add(1)
                    .ok_or_else(|| bad("composition identity exhausted"))?;
                let name = opt_string(p, "name", "Composition")?;
                let width = opt_u32(p, "width", 640)?;
                let height = opt_u32(p, "height", 360)?;
                let duration_s = opt_f64(p, "duration_s", next.duration_s)?;
                next.compositions.insert(
                    id,
                    Composition {
                        id,
                        name,
                        width,
                        height,
                        duration_s,
                        frame_rate: next.frame_rate.clone(),
                        layers: vec![],
                    },
                );
                data = json!({"comp_id":id});
            }
            "duplicateComposition" => {
                let id = id(p, "id")?;
                let src = next
                    .compositions
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| bad("unknown composition"))?;
                let new_id = next.next_comp_id;
                next.next_comp_id = new_id
                    .checked_add(1)
                    .ok_or_else(|| bad("composition identity exhausted"))?;
                // Fresh layer/key identities; parent links are remapped inside
                // the copy and composition references still target the same comps.
                let mut layer_ids = BTreeMap::new();
                for l in &src.layers {
                    let nid = next.next_layer_id;
                    next.next_layer_id = nid
                        .checked_add(1)
                        .ok_or_else(|| bad("layer identity exhausted"))?;
                    layer_ids.insert(l.id, nid);
                }
                let mut layers = Vec::with_capacity(src.layers.len());
                for l in &src.layers {
                    let mut nl = (**l).clone();
                    nl.id = layer_ids[&l.id];
                    nl.parent_id = nl
                        .parent_id
                        .map(|pid| {
                            layer_ids
                                .get(&pid)
                                .copied()
                                .ok_or_else(|| bad("layer parent outside duplicated composition"))
                        })
                        .transpose()?;
                    // Matte sources are same-composition layers, so they
                    // remap to the copy's fresh identities like parent links.
                    if let Some(matte) = nl.matte.as_mut() {
                        matte.source_layer = layer_ids
                            .get(&matte.source_layer)
                            .copied()
                            .ok_or_else(|| {
                                bad("matte source outside duplicated composition")
                            })?;
                    }
                    for c in &mut nl.curves {
                        for k in Arc::make_mut(&mut c.keys).iter_mut() {
                            k.id = next.next_key_id;
                            next.next_key_id = next
                                .next_key_id
                                .checked_add(1)
                                .ok_or_else(|| bad("key identity exhausted"))?;
                        }
                    }
                    layers.push(Arc::new(nl));
                }
                let mut name = format!("{} copy", src.name);
                while name.len() > 512 {
                    name.pop();
                }
                next.compositions.insert(
                    new_id,
                    Composition {
                        id: new_id,
                        name,
                        width: src.width,
                        height: src.height,
                        duration_s: src.duration_s,
                        frame_rate: src.frame_rate.clone(),
                        layers,
                    },
                );
                data = json!({"comp_id":new_id});
            }
            "removeComposition" => {
                let comp_id = id(p, "id")?;
                if !next.compositions.contains_key(&comp_id) {
                    return Err(bad("unknown composition"));
                }
                let referenced = next
                    .layers
                    .iter()
                    .chain(
                        next.compositions
                            .values()
                            .flat_map(|c| c.layers.iter()),
                    )
                    .any(|l| l.comp_id == Some(comp_id));
                if referenced {
                    return Err(bad("composition remains referenced by a comp layer"));
                }
                next.compositions.remove(&comp_id);
            }
            "addCompLayer" => {
                let comp_id = id(p, "comp")?;
                if !next.compositions.contains_key(&comp_id) {
                    return Err(bad("unknown composition"));
                }
                let into = State::comp_arg(p, "into")?;
                let layer = next.next_layer_id;
                next.next_layer_id = layer
                    .checked_add(1)
                    .ok_or_else(|| bad("layer identity exhausted"))?;
                let name = opt_string(p, "name", "Composition layer")?;
                let layers = comp_layers_mut(&mut next, into)
                    .ok_or_else(|| bad("unknown composition"))?;
                layers.push(Arc::new(Layer {
                    id: layer,
                    name,
                    visible: true,
                    locked: false,
                    kind: Some(LayerKind::Comp),
                    shape: None,
                    asset_id: None,
                    comp_id: Some(comp_id),
                    parent_id: None,
                    blend: None,
                    clipped: false,
                    matte: None,
                    effects: vec![],
                    path: None,
                    path_progress: 0.,
                    transform: Transform::default(),
                    opacity: 1.,
                    curves: vec![],
                }));
                data = json!({"layer_id":layer});
            }
            "setLayerParent" => {
                let layer_id = id(p, "layer")?;
                let parent = match p.get("parent") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(
                        v.as_u64()
                            .ok_or_else(|| bad("parent must be a layer id or null"))?,
                    ),
                };
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut nl = (*arc).clone();
                nl.parent_id = parent;
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "reparentLayer" => {
                if p.get("comp").is_none() {
                    return Err(bad("comp required (0 selects the root composition)"));
                }
                let layer_id = id(p, "layer")?;
                let target = State::comp_arg(p, "comp")?;
                let index = p
                    .get("index")
                    .and_then(Value::as_u64)
                    .and_then(|v| usize::try_from(v).ok())
                    .ok_or_else(|| bad("index must be a nonnegative integer"))?;
                let (src_key, src_i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, src_key).unwrap()[src_i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut removed = comp_layers_mut(&mut next, src_key)
                    .unwrap()
                    .remove(src_i);
                if src_key != target {
                    // The transform parent and former children stay behind in the
                    // source composition; their links cannot cross compositions.
                    clear_parent_links(
                        comp_layers_mut(&mut next, src_key).unwrap(),
                        layer_id,
                    );
                    Arc::make_mut(&mut removed).parent_id = None;
                }
                let dest = comp_layers_mut(&mut next, target)
                    .ok_or_else(|| bad("unknown composition"))?;
                if index > dest.len() {
                    return Err(bad("index out of bounds"));
                }
                dest.insert(index, removed);
            }
            "setLayerBlend" => {
                let layer_id = id(p, "layer")?;
                // `null` and `"normal"` both clear to the default (absent).
                let blend = match p.get("blend") {
                    None | Some(Value::Null) => None,
                    Some(v) => {
                        let s = v
                            .as_str()
                            .ok_or_else(|| bad("blend must be a W3C mode name or null"))?;
                        match BlendMode::parse(s) {
                            Some(BlendMode::Normal) => None,
                            Some(mode) => Some(mode),
                            None => return Err(bad("unknown blend mode")),
                        }
                    }
                };
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut nl = (*arc).clone();
                nl.blend = blend;
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setLayerClipped" => {
                let layer_id = id(p, "layer")?;
                let clipped = p
                    .get("clipped")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| bad("clipped must be a boolean"))?;
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut nl = (*arc).clone();
                nl.clipped = clipped;
                // validate() rejects a clipped layer with no sibling below.
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setLayerMatte" => {
                let layer_id = id(p, "layer")?;
                // `matte:null` (or absent) clears; otherwise a full matte object.
                let matte = match p.get("matte") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(
                        serde_json::from_value::<LayerMatte>(v.clone())
                            .map_err(|_| bad("invalid matte"))?,
                    ),
                };
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                if let Some(matte) = matte {
                    if matte.source_layer == layer_id {
                        return Err(bad("layer cannot matte itself"));
                    }
                    let layers = comp_layers(&next, comp_key).unwrap();
                    if !layers.iter().any(|l| l.id == matte.source_layer) {
                        return Err(bad(
                            "matte source must be a layer in the same composition",
                        ));
                    }
                    if matte_reaches(layers, matte.source_layer, layer_id) {
                        return Err(bad("matte chain would cycle"));
                    }
                }
                let mut nl = (*arc).clone();
                nl.matte = matte;
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setLayerEffects" => {
                let layer_id = id(p, "layer")?;
                // `effects:null` (or absent/[]) clears the stack; otherwise a
                // full replacement array of typed effect objects.
                let stack = match p.get("effects") {
                    None | Some(Value::Null) => Vec::new(),
                    Some(v) => serde_json::from_value::<Vec<LayerEffect>>(v.clone())
                        .map_err(|_| bad("invalid effects"))?,
                };
                if stack.len() > effects::MAX_EFFECTS
                    || stack.iter().any(|e| !e.valid())
                {
                    return Err(bad("invalid layer effect stack"));
                }
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut nl = (*arc).clone();
                nl.effects = stack;
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setMotionPath" => {
                let layer_id = id(p, "layer")?;
                // `path:null` (or absent) clears the path, its progress base
                // and any `path_progress` curve in one atomic write;
                // otherwise a full MotionPath replacement. The stored
                // `path_progress` base and `path_progress` curve survive a
                // path replacement so progress keys keep animating.
                let path = match p.get("path") {
                    None | Some(Value::Null) => None,
                    Some(v) => {
                        let mpath: MotionPath = serde_json::from_value(v.clone())
                            .map_err(|_| bad("invalid motion path"))?;
                        mpath.validate().map_err(|_| bad("invalid motion path"))?;
                        Some(mpath)
                    }
                };
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut nl = (*arc).clone();
                nl.path = path;
                if nl.path.is_none() {
                    nl.path_progress = 0.;
                    nl.curves.retain(|c| c.property != Property::PathProgress);
                }
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "addShapeLayer" => {
                let shape: Shape = serde_json::from_value(
                    p.get("shape")
                        .cloned()
                        .ok_or_else(|| bad("shape required"))?,
                )?;
                let name = opt_string(p, "name", "Layer")?;
                let into = State::comp_arg(p, "comp")?;
                let layer = next.next_layer_id;
                next.next_layer_id = layer
                    .checked_add(1)
                    .ok_or_else(|| bad("layer identity exhausted"))?;
                let layers = comp_layers_mut(&mut next, into)
                    .ok_or_else(|| bad("unknown composition"))?;
                layers.push(Arc::new(Layer {
                    id: layer,
                    name,
                    visible: true,
                    locked: false,
                    kind: Some(LayerKind::Shape),
                    shape: Some(shape),
                    asset_id: None,
                    comp_id: None,
                    parent_id: None,
                    blend: None,
                    clipped: false,
                    matte: None,
                    effects: vec![],
                    path: None,
                    path_progress: 0.,
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
                let into = State::comp_arg(p, "comp")?;
                let layer = next.next_layer_id;
                next.next_layer_id = layer
                    .checked_add(1)
                    .ok_or_else(|| bad("layer identity exhausted"))?;
                let name = opt_string(p, "name", "Raster layer")?;
                let layers = comp_layers_mut(&mut next, into)
                    .ok_or_else(|| bad("unknown composition"))?;
                layers.push(Arc::new(Layer {
                    id: layer,
                    name,
                    visible: true,
                    locked: false,
                    kind: Some(LayerKind::Raster),
                    shape: None,
                    asset_id: Some(asset_id),
                    comp_id: None,
                    parent_id: None,
                    blend: None,
                    clipped: false,
                    matte: None,
                    effects: vec![],
                    path: None,
                    path_progress: 0.,
                    transform: Transform::default(),
                    opacity: 1.,
                    curves: vec![],
                }));
                data = json!({"layer_id":layer});
            }
            "removeRasterAsset" => {
                let asset_id = id(p, "id")?;
                let referenced = next
                    .layers
                    .iter()
                    .chain(
                        next.compositions
                            .values()
                            .flat_map(|c| c.layers.iter()),
                    )
                    .any(|l| l.asset_id == Some(asset_id));
                if referenced {
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
                let order_set: BTreeSet<u64> = order.iter().copied().collect();
                if order_set.len() != order.len() {
                    return Err(bad("order must be an exact permutation"));
                }
                // The id set uniquely identifies one composition (layer ids are
                // globally unique); the root is tried first for compatibility.
                let mut found: Option<Option<u64>> = None;
                let mut ambiguous = false;
                for key in std::iter::once(None).chain(next.compositions.keys().map(|id| Some(*id)))
                {
                    let layers = comp_layers(&next, key).unwrap();
                    if layers.iter().map(|l| l.id).collect::<BTreeSet<_>>() == order_set {
                        if found.is_some() {
                            ambiguous = true;
                        }
                        found = Some(key);
                    }
                }
                if ambiguous || found.is_none() {
                    return Err(bad("order must be an exact permutation"));
                }
                let key = found.unwrap();
                let current = comp_layers(&next, key).unwrap();
                let mut layers = Vec::with_capacity(order.len());
                for id in order {
                    layers.push(
                        current
                            .iter()
                            .find(|l| l.id == id)
                            .ok_or_else(|| bad("unknown layer"))?
                            .clone(),
                    )
                }
                *comp_layers_mut(&mut next, key).unwrap() = layers;
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
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                // Clone the Arc out so `next` stays borrowable for key ids.
                let l = comp_layers(&next, comp_key).unwrap()[i].clone();
                if cmd.op == "removeLayer" {
                    if l.locked {
                        return Err(bad("layer is locked"));
                    }
                    comp_layers_mut(&mut next, comp_key).unwrap().remove(i);
                    clear_parent_links(
                        comp_layers_mut(&mut next, comp_key).unwrap(),
                        layer_id,
                    );
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
                    let merged = merge(
                        &*l,
                        &patch,
                        &[
                            "name",
                            "visible",
                            "locked",
                            "shape",
                            "transform",
                            "opacity",
                            "asset_id",
                        ],
                    )?;
                    comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(merged);
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
                    let mut layer = (*l).clone();
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
                    comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(layer);
                }
            }
            _ => return Err(EngineError::unsupported("unknown motion operation")),
        }
        next.schema = SCHEMA_VERSION;
        validate(&next)?;
        if content_eq(&next, &self.state) {
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
        if !content_eq(&staged.state, &self.state) {
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
        let mut next: State = serde_json::from_value(wire)?;
        // Only schema:1 payloads lack `kind`; schema:2 writers always emit it,
        // so a missing kind there is hostile input for `validate` to reject.
        if next.schema == 1 {
            normalize_layers(&mut next);
        }
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
mod blend_tests;
#[cfg(test)]
mod matte_tests;
#[cfg(test)]
mod effects_tests;
#[cfg(test)]
mod raster_tests;
#[cfg(test)]
mod comp_tests;
#[cfg(test)]
mod path_tests;
