//! Persistent bounded 2D motion. Prism owns rasterization/compositing.
mod assets;
mod curve;
mod effects;
mod expressions;
mod graph;
mod particles;
mod path;
mod transform3d;
use assets::RasterAsset;
use curve::{evaluate, Key};
use effects::{apply_effects, LayerEffect};
use expressions::{Env as ExprEnv, PropertyExpr};
use graph::{Binding, Graph, GraphNode};
use particles::{ParticleEmitter, ParticleSprite};
use path::MotionPath;
use transform3d::Transform3D;
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
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
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
    /// 3D orientation/depth channels (slice G1): X/Y euler degrees and view
    /// depth. Curves on these require `Layer.transform3d`; `rotation` stays
    /// the Z-axis roll. Wire names are `rx`/`ry`/`z`.
    Rx,
    Ry,
    Z,
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
            // Absent transform3d reads as identity; validate rejects 3D
            // curves without one, so this only serves defensive paths.
            Self::Rx => l.transform3d.map_or(0., |t| t.rx),
            Self::Ry => l.transform3d.map_or(0., |t| t.ry),
            Self::Z => l.transform3d.map_or(0., |t| t.z),
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
            Self::Rx => l.transform3d.get_or_insert_with(Transform3D::default).rx = v,
            Self::Ry => l.transform3d.get_or_insert_with(Transform3D::default).ry = v,
            Self::Z => l.transform3d.get_or_insert_with(Transform3D::default).z = v,
        }
    }
    /// 3D channels require `Layer.transform3d` (validated); used to strip
    /// them atomically when the 3D transform is cleared.
    fn is_3d(self) -> bool {
        matches!(self, Self::Rx | Self::Ry | Self::Z)
    }
    /// Every bindable scalar property, in declaration order (slice D
    /// expressions and the eval resolver iterate this set).
    const ALL: [Self; 12] = [
        Self::Tx,
        Self::Ty,
        Self::Sx,
        Self::Sy,
        Self::Rotation,
        Self::Ox,
        Self::Oy,
        Self::Opacity,
        Self::PathProgress,
        Self::Rx,
        Self::Ry,
        Self::Z,
    ];
    /// Dense slot for per-evaluation memo tables.
    fn index(self) -> usize {
        match self {
            Self::Tx => 0,
            Self::Ty => 1,
            Self::Sx => 2,
            Self::Sy => 3,
            Self::Rotation => 4,
            Self::Ox => 5,
            Self::Oy => 6,
            Self::Opacity => 7,
            Self::PathProgress => 8,
            Self::Rx => 9,
            Self::Ry => 10,
            Self::Z => 11,
        }
    }
    /// Wire name → property (the same serde names curves/expressions use).
    pub(crate) fn from_name(s: &str) -> Option<Self> {
        serde_json::from_value(Value::String(s.to_string())).ok()
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
    /// Deterministic particle emitter layer (slice F); content is the
    /// optional `emitter` spec, rasterized per frame with no sim state.
    Particles,
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
    /// Deterministic particle emitter (slice F), present only on
    /// `kind:"particles"` layers; `None` renders an empty layer.
    /// Additive serde default keeps schema at 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    emitter: Option<ParticleEmitter>,
    /// Authored base arc-length progress along `path` (0..=1); a
    /// `path_progress` curve overrides it at evaluation. Validate rejects
    /// nonzero values and `path_progress` curves when `path` is absent.
    #[serde(default, skip_serializing_if = "is_zero_f64")]
    path_progress: f64,
    /// Optional 3D orientation/depth (slice G1): `rx`/`ry` euler degrees and
    /// `z` view depth; `rotation` remains the Z roll. Presence marks the
    /// layer 3D-enabled and is required by `rx`/`ry`/`z` curves. Storage and
    /// evaluation only — `renderFrame` ignores it until G2 projection
    /// rendering. Additive serde default keeps schema at 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transform3d: Option<Transform3D>,
    /// Bounded scalar expressions (slice D): at most one per property,
    /// mutually exclusive with that property's curve — `setExpression`
    /// clears the curve and `setPropertyKeys` clears the expression in the
    /// same journal entry (last write wins). Sources are UTF-8 text
    /// re-parsed at op time and on restore; evaluation resolves each
    /// property as expression → curve → base. Additive serde default keeps
    /// schema at 2; expression-free layers serialize identically.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    expressions: Vec<PropertyExpr>,
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
    /// Bounded scalar value node graph (slice I): a document-global f64 DAG
    /// plus `(layer, property)` bindings, mutually exclusive with curves
    /// and expressions on the same cell. Additive serde default keeps
    /// schema at 2; graph-free documents serialize byte-identically.
    #[serde(default, skip_serializing_if = "Graph::is_default")]
    graph: Graph,
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
            graph: Graph::default(),
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
/// Serialize evaluated layers for the `evaluate` op, adding the read-only
/// `projected_transform` orthographic affine to layers carrying a
/// `transform3d`. The field is compute-on-read only — it is never stored,
/// never part of `describe`/snapshots, and never affects `renderFrame`.
fn evaluated_json(layers: &[Layer]) -> Result<Vec<Value>, EngineError> {
    layers
        .iter()
        .map(|l| {
            let mut v = serde_json::to_value(l)?;
            if let Some(t3) = &l.transform3d {
                let p = transform3d::projected_affine(&l.transform, t3);
                v["projected_transform"] = json!({
                    "a": p[0], "b": p[1], "c": p[2],
                    "d": p[3], "e": p[4], "f": p[5],
                });
            }
            Ok(v)
        })
        .collect()
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
    /// Rational frame rate as f64 (`num/den`); expression `fps`/`frame`.
    fps: f64,
    layers: &'a [Arc<Layer>],
}
fn rate_fps(rate: &Rate) -> f64 {
    f64::from(rate.num) / f64::from(rate.den)
}
impl State {
    fn comp_view(&self, comp: Option<u64>) -> Result<CompView<'_>, EngineError> {
        match comp {
            None => Ok(CompView {
                width: self.width,
                height: self.height,
                duration_s: self.duration_s,
                fps: rate_fps(&self.frame_rate),
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
                    fps: rate_fps(&c.frame_rate),
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
    let (mut total_layers, mut curves, mut count, mut emitters) =
        (0usize, 0usize, 0usize, 0usize);
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
            if l.emitter.is_some() {
                emitters += 1;
            }
        }
    }
    if total_layers > 128 {
        return Err(bad("motion total layer budget exceeded"));
    }
    if emitters > particles::MAX_EMITTERS {
        return Err(bad("particle emitter budget exceeded"));
    }
    // Pass 2: per-layer content, transform, curves and parent references.
    for &(key, width, height, duration_s, layers) in &views {
        let members = &comp_members[&key];
        // Asset-backed layers, layers with a non-empty effect stack and
        // particle layers all materialize a canvas-sized raster upload in
        // the ephemeral Prism scene at render (see `stage_effects` and the
        // particles arm of `stage_content`), so they share one logical
        // canvas-storage budget; a layer that is several of these counts
        // once.
        let canvas_rasters = layers
            .iter()
            .filter(|l| {
                l.asset_id.is_some()
                    || !l.effects.is_empty()
                    || l.kind == Some(LayerKind::Particles)
            })
            .count();
        if canvas_rasters > assets::MAX_RASTER_LAYERS
            || u64::from(width) * u64::from(height) * 4 * canvas_rasters as u64
                > assets::MAX_CANVAS_STORAGE
        {
            return Err(bad("logical raster layer canvas storage exceeds budget"));
        }
        // Per-composition alive-particle budget: the sum of each emitter's
        // worst-case alive count must stay within one frame's sprite cap.
        let mut sprite_budget = 0usize;
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
            if let Some(emitter) = &l.emitter {
                if l.kind != Some(LayerKind::Particles) {
                    return Err(bad("particle emitter requires a particles layer"));
                }
                if !emitter.valid() {
                    return Err(bad("invalid particle emitter"));
                }
                if let ParticleSprite::Asset { asset_id } = emitter.sprite {
                    if !s.assets.contains_key(&asset_id) {
                        return Err(bad("particle sprite references unknown asset"));
                    }
                }
                sprite_budget = sprite_budget
                    .checked_add(emitter.alive_bound())
                    .filter(|v| *v <= particles::MAX_COMP_SPRITES)
                    .ok_or_else(|| bad("particle sprite budget exceeded"))?;
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
            // 3D curves require the transform3d they animate; the transform
            // itself re-checks its own bounds for hostile restores.
            if l.transform3d.is_none()
                && l.curves.iter().any(|c| c.property.is_3d())
            {
                return Err(bad("3D curves require a transform3d"));
            }
            if let Some(t3) = &l.transform3d {
                if !t3.valid() {
                    return Err(bad("invalid 3D transform"));
                }
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
                // A particles layer's only content is its optional emitter;
                // shape/asset/comp payloads on it (or an emitter on another
                // kind) fall through to the catch-all rejection.
                (Some(LayerKind::Particles), None, None, None) => {}
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
    // Pass 2c: bounded expressions (slice D). Per layer: unique properties,
    // kind gates (3D needs transform3d, path_progress needs path), mutual
    // exclusion with that property's curve, source cap and a full re-parse
    // (hostile restores reject, never partially parse). References must
    // name layers in the same composition; the whole-document
    // `(layer, property)` dependency graph must be acyclic — self
    // references included.
    let mut expr_edges: BTreeMap<(u64, Property), Vec<(u64, Property)>> = BTreeMap::new();
    let mut expr_cells: BTreeSet<(u64, Property)> = BTreeSet::new();
    for &(key, _, _, _, layers) in &views {
        let members = &comp_members[&key];
        for l in layers {
            let mut expr_props = BTreeSet::new();
            for e in &l.expressions {
                if !expr_props.insert(e.property) {
                    return Err(bad("duplicate property expression"));
                }
                if e.property.is_3d() && l.transform3d.is_none() {
                    return Err(bad("3D expressions require a transform3d"));
                }
                if e.property == Property::PathProgress && l.path.is_none() {
                    return Err(bad("path progress requires a motion path"));
                }
                if l.curves.iter().any(|c| c.property == e.property) {
                    return Err(bad("property cannot have both keys and an expression"));
                }
                if e.source.len() > expressions::MAX_SOURCE_BYTES {
                    return Err(bad("expression source exceeds budget"));
                }
                let ast = expressions::parse(&e.source).map_err(|_| bad("invalid expression"))?;
                expr_cells.insert((l.id, e.property));
                for r in ast.references() {
                    let target = r.0.unwrap_or(l.id);
                    if !members.contains_key(&target) {
                        return Err(bad(
                            "expression references a layer outside its composition",
                        ));
                    }
                    expr_edges
                        .entry((l.id, e.property))
                        .or_default()
                        .push((target, r.1));
                }
            }
        }
    }
    // Iterative DFS over the `(layer, property)` dependency graph. The
    // longest reference chain scales with document content (up to the
    // layer budget times the property count), so recursion here would
    // grow the call stack on hostile restores; an explicit stack keeps
    // the check heap-bounded instead. `visiting` is the on-path gray set
    // — re-reaching a node still on the path is a cycle — and `done` is
    // the fully-explored black memo shared across start nodes. Frames
    // are `(node, exiting)`: first visits push the exit marker, then
    // every not-yet-done dependency.
    let mut visiting = BTreeSet::new();
    let mut done = BTreeSet::new();
    for &start in expr_edges.keys().chain(expr_cells.iter()) {
        if done.contains(&start) {
            continue;
        }
        let mut stack: Vec<((u64, Property), bool)> = vec![(start, false)];
        while let Some((node, exiting)) = stack.pop() {
            if exiting {
                visiting.remove(&node);
                done.insert(node);
                continue;
            }
            if done.contains(&node) {
                continue;
            }
            if !visiting.insert(node) {
                return Err(bad("cyclic expression dependency"));
            }
            stack.push((node, true));
            if let Some(next) = expr_edges.get(&node) {
                for &dep in next {
                    if !done.contains(&dep) {
                        stack.push((dep, false));
                    }
                }
            }
        }
    }
    // Pass 2d: bounded scalar value graph (slice I). Structural checks
    // (caps, ids, kind/pin/param shape, edge targets, acyclicity, binding
    // shape) live in graph::validate_structure; here the graph is checked
    // against document state — property source layers must exist, binding
    // layers must exist with the same kind gates as curves/expressions, and
    // a binding is mutually exclusive with that property's curve AND
    // expression (hostile restores reject rather than pick a winner).
    graph::validate_structure(&s.graph).map_err(bad)?;
    {
        // Global layer lookup across every composition for graph refs.
        let find_layer = |layer_id: u64| -> Option<&Layer> {
            comp_members
                .values()
                .find_map(|members| members.get(&layer_id).copied())
        };
        for node in &s.graph.nodes {
            if node.kind == graph::NodeKind::Property {
                let layer_id = node
                    .params
                    .and_then(|p| p.layer)
                    .ok_or_else(|| bad("property node requires a layer"))?;
                if find_layer(layer_id).is_none() {
                    return Err(bad("graph property source references unknown layer"));
                }
            }
        }
        for b in &s.graph.bindings {
            let layer = find_layer(b.layer)
                .ok_or_else(|| bad("graph binding references unknown layer"))?;
            if b.property.is_3d() && layer.transform3d.is_none() {
                return Err(bad("3D graph bindings require a transform3d"));
            }
            if b.property == Property::PathProgress && layer.path.is_none() {
                return Err(bad("path progress graph binding requires a motion path"));
            }
            if layer.curves.iter().any(|c| c.property == b.property)
                || layer.expressions.iter().any(|e| e.property == b.property)
            {
                return Err(bad(
                    "property cannot have both keys/expression and a graph binding",
                ));
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
/// Per-`evaluated_layers`-call resolver for expression/curve/base property
/// values (slice D). `(layer, property)` cells resolve memoized so
/// `this.<prop>`/`layer(<id>).<prop>` references see the same resolved value
/// everywhere; `busy` is a defensive cycle backstop — `validate` already
/// proves the expression dependency graph acyclic, so it is unreachable on
/// admitted state.
struct ExprResolver<'a> {
    layers: &'a [Arc<Layer>],
    by_id: BTreeMap<u64, usize>,
    env: ExprEnv,
    values: Vec<[f64; 12]>,
    done: Vec<[bool; 12]>,
    busy: Vec<[bool; 12]>,
}
impl<'a> ExprResolver<'a> {
    fn new(layers: &'a [Arc<Layer>], duration_s: f64, fps: f64, time: f64) -> Self {
        Self {
            layers,
            by_id: layers.iter().enumerate().map(|(i, l)| (l.id, i)).collect(),
            env: ExprEnv {
                time,
                frame: (time * fps).floor(),
                fps,
                duration: duration_s,
            },
            values: vec![[0.; 12]; layers.len()],
            done: vec![[false; 12]; layers.len()],
            busy: vec![[false; 12]; layers.len()],
        }
    }
    /// Resolve one `(layer, property)` cell. Two-phase iterative walk over
    /// the expression dependency graph: phase 1 collects the transitive
    /// expression cells in dependencies-first (post-order) sequence on an
    /// explicit stack — resolving curve/base cells inline — and phase 2
    /// evaluates the collected cells in that order. Recursion depth
    /// therefore never scales with the reference-chain length: the old
    /// recursive `resolve` → `eval_node` → `resolve_ref` cycle nested one
    /// AST-depth frame set per `layer()` hop, so a long chain multiplied
    /// onto the stack even though each piece was individually bounded.
    /// `busy` remains the defensive cycle backstop — `validate` already
    /// proves the graph acyclic, so it is unreachable on admitted state.
    fn resolve(&mut self, index: usize, property: Property) -> Result<f64, EngineError> {
        let slot = property.index();
        if self.done[index][slot] {
            return Ok(self.values[index][slot]);
        }
        if self.busy[index][slot] {
            return Ok(0.);
        }
        type Cell = (usize, Property);
        let mut order: Vec<Cell> = Vec::new();
        let mut emitted: BTreeSet<Cell> = BTreeSet::new();
        let mut onpath: BTreeSet<Cell> = BTreeSet::new();
        // Frames are `(cell, exiting)`: first visits mark `onpath`, push
        // the exit marker, then every not-yet-resolved dependency; exit
        // frames append the cell to `order` after its deps.
        let mut stack: Vec<(Cell, bool)> = vec![((index, property), false)];
        while let Some((cell, exiting)) = stack.pop() {
            let (ci, cp) = cell;
            if exiting {
                onpath.remove(&cell);
                emitted.insert(cell);
                order.push(cell);
                continue;
            }
            let cslot = cp.index();
            if self.done[ci][cslot] || emitted.contains(&cell) || onpath.contains(&cell) {
                continue;
            }
            let has_expr = self.layers[ci]
                .expressions
                .iter()
                .any(|e| e.property == cp);
            if !has_expr {
                // Curve/base cells never reference other cells, so they
                // resolve inline with no ordering constraints. A failure
                // on the requested cell propagates; on a referenced cell
                // it resolves to 0.0 exactly like `resolve_ref` did.
                match self.resolve_non_expr(ci, cp) {
                    Ok(value) => {
                        self.done[ci][cslot] = true;
                        self.values[ci][cslot] = value;
                    }
                    Err(e) => {
                        if (ci, cp) == (index, property) {
                            return Err(e);
                        }
                        self.done[ci][cslot] = true;
                        self.values[ci][cslot] = 0.;
                    }
                }
                continue;
            }
            onpath.insert(cell);
            stack.push((cell, true));
            // Push every referenced cell. Expression deps land earlier in
            // `order` through post-order; non-expression deps resolve
            // inline when their own frame pops. `this` references resolve
            // to the owner cell itself, which `onpath` already holds.
            let layer = &self.layers[ci];
            if let Some(expr) = layer.expressions.iter().find(|e| e.property == cp) {
                if let Ok(ast) = expressions::parse(&expr.source) {
                    let owner = layer.id;
                    for &(oid, prop) in ast.references() {
                        let dep_index = match oid {
                            None => self.by_id.get(&owner).copied(),
                            Some(id) => self.by_id.get(&id).copied(),
                        };
                        if let Some(di) = dep_index {
                            let dep = (di, prop);
                            if !self.done[di][prop.index()]
                                && !emitted.contains(&dep)
                                && !onpath.contains(&dep)
                            {
                                stack.push((dep, false));
                            }
                        }
                    }
                }
            }
        }
        // Phase 2: evaluate expression cells dependencies-first. Every
        // expression dep is already `done` when its referrers run; `this`/
        // self edges and defensive cycle paths resolve to 0.0 through
        // `cell_value`/`busy` exactly like the old recursive guard.
        for &(ci, cp) in &order {
            let cslot = cp.index();
            let layer = &self.layers[ci];
            let parsed = layer
                .expressions
                .iter()
                .find(|e| e.property == cp)
                .and_then(|e| expressions::parse(&e.source).ok());
            let value = match parsed {
                Some(ast) => {
                    self.busy[ci][cslot] = true;
                    let env = self.env;
                    let owner = layer.id;
                    let raw = ast.eval(&env, owner, &mut |id, prop| {
                        self.cell_value(id, prop)
                    });
                    self.busy[ci][cslot] = false;
                    // Property boundary: non-finite (including the defensive
                    // step-cap NaN) resolves to 0.0; finite clamps into the
                    // property's existing bounds. Evaluation never fails.
                    let (lo, hi) = cp.bounds();
                    if raw.is_finite() {
                        raw.clamp(lo, hi)
                    } else {
                        0.
                    }
                }
                // Unreachable on validated state; defensive 0.0.
                None => 0.,
            };
            self.done[ci][cslot] = true;
            self.values[ci][cslot] = value;
        }
        Ok(self.values[index][slot])
    }
    /// Curve/base resolution for a `(layer, property)` cell with no
    /// expression — the non-recursive tail of `resolve`. Resolution order
    /// is expression → curve → base, matching the documented precedence.
    fn resolve_non_expr(&mut self, index: usize, property: Property) -> Result<f64, EngineError> {
        let layer = &self.layers[index];
        if let Some(curve) = layer.curves.iter().find(|c| c.property == property) {
            let (min, max) = property.bounds();
            evaluate(
                &curve.keys,
                property.read(layer),
                self.env.time,
                self.env.duration,
                min,
                max,
            )
            .map_err(bad)
        } else {
            Ok(property.read(layer))
        }
    }
    /// Referenced-cell read used by `Ast::eval`: `layer(<id>).<prop>` and
    /// `this.<prop>` targets. Memoized cells return their stored value;
    /// curve/base cells resolve inline; unknown ids and expression cells
    /// that were not ordered ahead of the evaluating cell (only reachable
    /// through a cycle `validate` already rejects) resolve to 0.0 —
    /// evaluation never fails.
    fn cell_value(&mut self, id: u64, property: Property) -> f64 {
        let Some(&index) = self.by_id.get(&id) else {
            return 0.;
        };
        let slot = property.index();
        if self.done[index][slot] {
            return self.values[index][slot];
        }
        if self.busy[index][slot] {
            return 0.;
        }
        if self.layers[index]
            .expressions
            .iter()
            .any(|e| e.property == property)
        {
            // Expression dep out of order: defensive cycle path,
            // unreachable on validated state.
            return 0.;
        }
        match self.resolve_non_expr(index, property) {
            Ok(value) => {
                self.done[index][slot] = true;
                self.values[index][slot] = value;
                value
            }
            Err(_) => 0.,
        }
    }
}
/// Per-call graph evaluator (slice I). Built once per `evaluate`/
/// `renderFrame` with the root time; it precomputes every composition's
/// local env and eagerly evaluates the whole DAG once per comp context
/// (≤16 comps × ≤512 O(1) node evals — trivially inside budget). Node
/// evaluation is a flat iterative pass over the Kahn topo order: no
/// recursion whose depth scales with document content. `property` sources
/// read pre-binding curve/base values in the referenced layer's OWN comp
/// context, which keeps the graph acyclic across the layer boundary.
struct GraphEval<'a> {
    /// Kahn order (ascending-id ties); nodes absent here are a defensive
    /// cycle remainder and evaluate to 0.0.
    topo: Vec<u64>,
    nodes: BTreeMap<u64, &'a GraphNode>,
    /// `(layer, property)` → bound node id (validate guarantees unique).
    bindings: BTreeMap<(u64, Property), u64>,
    /// Comp key (None = root) → local env.
    envs: BTreeMap<Option<u64>, graph::CompEnv>,
    /// Comp key → that comp's layers.
    comp_layers: BTreeMap<Option<u64>, &'a [Arc<Layer>]>,
    /// Layer id → (comp key, index into that comp's layer slice).
    layer_pos: BTreeMap<u64, (Option<u64>, usize)>,
    /// Precomputed node values per comp context.
    tables: BTreeMap<Option<u64>, BTreeMap<u64, f64>>,
}
impl<'a> GraphEval<'a> {
    fn new(state: &'a State, root_time: f64) -> Self {
        let root_fps = rate_fps(&state.frame_rate);
        let mut envs = BTreeMap::new();
        let mut comp_layers = BTreeMap::new();
        let mut layer_pos = BTreeMap::new();
        envs.insert(
            None,
            graph::CompEnv {
                time: root_time,
                frame: (root_time * root_fps).floor(),
                fps: root_fps,
                duration: state.duration_s,
            },
        );
        comp_layers.insert(None, state.layers.as_slice());
        for (index, l) in state.layers.iter().enumerate() {
            layer_pos.insert(l.id, (None, index));
        }
        for (id, comp) in &state.compositions {
            // Same duration-scaled local time `comp_local_time`/`evaluate`
            // and the nested render path already use for curves.
            let local = (root_time * comp.duration_s / state.duration_s)
                .clamp(0., comp.duration_s);
            let fps = rate_fps(&comp.frame_rate);
            envs.insert(
                Some(*id),
                graph::CompEnv {
                    time: local,
                    frame: (local * fps).floor(),
                    fps,
                    duration: comp.duration_s,
                },
            );
            comp_layers.insert(Some(*id), comp.layers.as_slice());
            for (index, l) in comp.layers.iter().enumerate() {
                layer_pos.insert(l.id, (Some(*id), index));
            }
        }
        let nodes: BTreeMap<u64, &GraphNode> =
            state.graph.nodes.iter().map(|n| (n.id, n)).collect();
        let bindings: BTreeMap<(u64, Property), u64> = state
            .graph
            .bindings
            .iter()
            .map(|b| ((b.layer, b.property), b.node))
            .collect();
        let mut eval = Self {
            topo: graph::topo_order(&state.graph.nodes),
            nodes,
            bindings,
            envs,
            comp_layers,
            layer_pos,
            tables: BTreeMap::new(),
        };
        // Eager per-comp tables: every comp env is known up front, and the
        // ≤16×512 worst case is trivial next to a single rasterized frame.
        let comps: Vec<Option<u64>> = eval.envs.keys().copied().collect();
        for comp in comps {
            let table = eval.compute_table(comp);
            eval.tables.insert(comp, table);
        }
        eval
    }
    /// Pre-binding property read for `property` source nodes: the layer's
    /// curve evaluated at its own comp's local time, else the stored base
    /// value. Expressions and graph bindings are never consulted, so graph
    /// evaluation cannot cycle through layer state. Mirrors
    /// `ExprResolver::resolve_non_expr` including the sx/sy sign rule.
    fn property_value(&self, layer_id: u64, property: Property) -> f64 {
        let Some(&(comp, index)) = self.layer_pos.get(&layer_id) else {
            return 0.;
        };
        let Some(layers) = self.comp_layers.get(&comp) else {
            return 0.;
        };
        let Some(layer) = layers.get(index) else {
            return 0.;
        };
        let base = property.read(layer);
        if let Some(curve) = layer.curves.iter().find(|c| c.property == property) {
            let env = self.envs[&comp];
            let (mut min, mut max) = property.bounds();
            if matches!(property, Property::Sx | Property::Sy) {
                if base > 0. {
                    min = 1e-6
                } else {
                    max = -1e-6
                }
            }
            curve::evaluate(&curve.keys, base, env.time, env.duration, min, max)
                .unwrap_or(0.)
        } else {
            base
        }
    }
    /// Evaluate every node once for one comp context, in topo order.
    /// Iterative by construction; the op counter is a defensive backstop
    /// that saturates remaining nodes to 0.0 (unreachable: ≤512 nodes).
    fn compute_table(&self, comp: Option<u64>) -> BTreeMap<u64, f64> {
        let env = self.envs[&comp];
        let mut values: BTreeMap<u64, f64> = BTreeMap::new();
        let mut ops = 0u32;
        let mut saturated = false;
        for &id in &self.topo {
            let Some(node) = self.nodes.get(&id) else {
                continue;
            };
            if saturated {
                values.insert(id, 0.);
                continue;
            }
            // Resolve every declared pin: edge refs read already-evaluated
            // topo predecessors (a missing entry is the defensive cycle
            // remainder → 0.0), const literals pass through.
            let mut pins: Vec<(&str, f64)> = Vec::with_capacity(node.inputs.len());
            for (name, edge) in &node.inputs {
                ops += 1;
                let v = match edge {
                    graph::EdgeRef::Const(c) => c.value,
                    graph::EdgeRef::Node(r) => values.get(&r.node).copied().unwrap_or(0.),
                };
                pins.push((name.as_str(), v));
            }
            ops += 1;
            if ops > graph::MAX_OPS {
                saturated = true;
                values.insert(id, 0.);
                continue;
            }
            let get = |name: &str| {
                pins.iter()
                    .find(|(k, _)| *k == name)
                    .map(|(_, v)| *v)
                    .unwrap_or(0.)
            };
            let mut prop = |layer: u64, property: Property| self.property_value(layer, property);
            values.insert(id, graph::eval_kind(node.kind, node.params, &get, &env, &mut prop));
        }
        values
    }
    /// Sanitized bound value for `(layer, property)` in comp `comp`, or
    /// None when the cell is unbound. Non-finite → 0.0, finite → clamped
    /// to the property bounds — identical to the expression boundary.
    fn bound_value(&self, comp: Option<u64>, layer: u64, property: Property) -> Option<f64> {
        let node = *self.bindings.get(&(layer, property))?;
        let raw = *self.tables.get(&comp)?.get(&node)?;
        let (lo, hi) = property.bounds();
        Some(if raw.is_finite() { raw.clamp(lo, hi) } else { 0. })
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
    /// Evaluate one composition's layers at a local time. Curves and
    /// expressions resolve against that composition's own duration, frame
    /// rate and local time; `this`/`layer()` references resolve through the
    /// shared per-call memo so results are order-independent and seek-safe.
    fn evaluated_layers(
        &self,
        layers: &[Arc<Layer>],
        duration_s: f64,
        fps: f64,
        time: f64,
        graph: Option<(&GraphEval, Option<u64>)>,
    ) -> Result<Vec<Layer>, EngineError> {
        if !time.is_finite() || time < 0. || time > duration_s {
            return Err(bad("time outside composition"));
        }
        let mut resolver = ExprResolver::new(layers, duration_s, fps, time);
        let mut out_layers = Vec::with_capacity(layers.len());
        for (index, l) in layers.iter().enumerate() {
            let mut out = (**l).clone();
            for property in Property::ALL {
                // Graph bindings (slice I) are a third mutually-exclusive
                // value source applied at the same point curve/expression
                // values land; the sanitized node output wins the cell.
                if let Some((eval, comp)) = graph {
                    if let Some(value) = eval.bound_value(comp, l.id, property) {
                        property.write(&mut out, value);
                        continue;
                    }
                }
                if l.curves.iter().any(|c| c.property == property)
                    || l.expressions.iter().any(|e| e.property == property)
                {
                    let value = resolver.resolve(index, property)?;
                    property.write(&mut out, value)
                }
            }
            out.curves.clear();
            // Expressions are cleared from evaluated output like curves:
            // resolved values land in the same fields and `describe` remains
            // the verbatim expression view.
            out.expressions.clear();
            // Motion path (slice E): the evaluated progress selects an
            // arc-length point whose offset adds to tx/ty in the layer's
            // transform space; auto_orient adds the tangent angle to
            // rotation. Runs after curves and expressions so path_progress
            // animation wins and tx/ty/rotation compose with (never replace)
            // the path offset.
            if let Some(mpath) = &out.path {
                let (px, py, deg) =
                    mpath.sample_at(out.path_progress).map_err(|_| bad("invalid motion path"))?;
                let orient = mpath.auto_orient;
                // Path nodes/handles are each bounded ±1e7, so sampled
                // offsets can reach ~±2e7; adding to an evaluated base
                // that is itself ±1e7 could push tx/ty/rotation past
                // Prism's transform bound and fail setLayerTransform on
                // an otherwise valid document. Saturate at the shared
                // ±1e7 bound instead — extreme paths visibly distort at
                // the boundary, a documented limitation like the
                // parent-compose shear/bounds case.
                out.transform.tx = (out.transform.tx + px).clamp(-1e7, 1e7);
                out.transform.ty = (out.transform.ty + py).clamp(-1e7, 1e7);
                if orient {
                    out.transform.rotation = (out.transform.rotation + deg).clamp(-1e7, 1e7);
                }
            }
            out_layers.push(out);
        }
        Ok(out_layers)
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
        graph: Option<&GraphEval>,
    ) -> Result<(), EngineError> {
        if let Some(c) = ctx {
            c.checkpoint()?
        }
        let layer = if l.effects.is_empty() {
            self.stage_content(prism, view, l, by_id, time, ctx, depth, graph)?
        } else {
            self.stage_effects(prism, view, l, by_id, time, ctx, depth, graph)?
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
                let mask =
                    self.matte_mask(view, matte, by_id, time, ctx, depth, matte_depth, graph)?;
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
        graph: Option<&GraphEval>,
    ) -> Result<u64, EngineError> {
        // Particles bake the effective affine (own transform plus parent
        // chain, shear included — no decompose needed) into per-particle
        // canvas positions and sprite scale, so the uploaded raster pins
        // the identity transform below.
        let transform = if l.kind == Some(LayerKind::Particles) {
            Transform::default()
        } else if l.parent_id.is_some() {
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
                    fps: rate_fps(&comp.frame_rate),
                    layers: &comp.layers,
                };
                let pixels = self.render_comp(
                    &child_view,
                    child_time,
                    ctx,
                    depth + 1,
                    graph,
                    Some(comp_id),
                )?;
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
            Some(LayerKind::Particles) => {
                // Deterministic per-frame raster: particle positions are a
                // pure function of (seed, spec, time) — no sim state — so
                // seeking backward or forward recomputes identical output.
                let affine = effective_affine(l, by_id)?;
                let pixels = particles::render(
                    l.emitter.as_ref(),
                    &self.state.assets,
                    &affine,
                    view.width,
                    view.height,
                    time,
                    ctx,
                )?;
                let added = prism.apply(Command::new("addRasterLayer", json!({})))?;
                let id = added
                    .data["layer_id"]
                    .as_u64()
                    .ok_or_else(|| bad("Prism raster layer returned no ID"))?;
                prism.apply(
                    Command::new(
                        "drawPixels",
                        json!({"id":id,"x":0,"y":0,"w":view.width,"h":view.height}),
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
        graph: Option<&GraphEval>,
    ) -> Result<u64, EngineError> {
        let mut offscreen = prism_engine::PrismEngine::new(view.width, view.height);
        self.stage_content(&mut offscreen, view, l, by_id, time, ctx, depth, graph)?;
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
        graph: Option<&GraphEval>,
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
            graph,
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
        graph: Option<&GraphEval>,
        comp: Option<u64>,
    ) -> Result<Vec<u8>, EngineError> {
        if depth > MAX_COMP_DEPTH {
            return Err(bad("composition nesting depth exceeded"));
        }
        let layers = self.evaluated_layers(
            view.layers,
            view.duration_s,
            view.fps,
            time,
            graph.map(|g| (g, comp)),
        )?;
        let by_id: BTreeMap<u64, &Layer> = layers.iter().map(|l| (l.id, l)).collect();
        let mut prism = prism_engine::PrismEngine::new(view.width, view.height);
        for l in &layers {
            // matte_depth restarts at every composition boundary, so the
            // worst case is MAX_COMP_DEPTH comp renders each taking up to
            // MAX_MATTE_DEPTH matte hops (transient mask buffers included).
            self.stage_layer(&mut prism, view, l, &by_id, time, ctx, depth, 0, true, graph)?;
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
        let ge = GraphEval::new(&self.state, time);
        let bytes = self.render_comp(&view, time, ctx, 0, Some(&ge), None)?;
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
            let ge = GraphEval::new(&self.state, t);
            let root = self.evaluated_layers(
                &self.state.layers,
                self.state.duration_s,
                rate_fps(&self.state.frame_rate),
                t,
                Some((&ge, None)),
            )?;
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
                        "layers": evaluated_json(&self.evaluated_layers(
                            &comp.layers,
                            comp.duration_s,
                            rate_fps(&comp.frame_rate),
                            local,
                            Some((&ge, Some(*id))),
                        )?)?,
                    }),
                );
            }
            return Ok(CommandResult::read_only(
                json!({"layers":evaluated_json(&root)?,"compositions":compositions}),
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
                    // `layer(<id>)` expression refs are same-composition, so
                    // they remap to the copy's fresh identities like
                    // parent/matte links; `this` refs need no rewrite.
                    for e in &mut nl.expressions {
                        e.source = expressions::remap_layer_refs(&e.source, &layer_ids)
                            .map_err(|_| bad("invalid expression"))?;
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
                // Graph bindings are document-global; the duplicated
                // composition's layers inherit the same (layer,property)→
                // node bindings under their fresh identities, the
                // parent_id/matte remap precedent. `property` source-node
                // params keep reading the original layers — nodes are
                // shared, never duplicated. The ≤128 binding cap is
                // re-checked by validate, so an over-full graph rejects
                // the whole duplication atomically.
                let inherited: Vec<Binding> = next
                    .graph
                    .bindings
                    .iter()
                    .filter_map(|b| {
                        layer_ids.get(&b.layer).map(|&nid| Binding {
                            layer: nid,
                            property: b.property,
                            node: b.node,
                        })
                    })
                    .collect();
                next.graph.bindings.extend(inherited);
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
                    transform3d: None,
                    emitter: None,
                    transform: Transform::default(),
                    opacity: 1.,
                    expressions: vec![],
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
                    // A path_progress expression without a path violates the
                    // same gate, so it clears in the same atomic write; the
                    // slice-I graph binding on that cell drops with them.
                    nl.expressions
                        .retain(|e| e.property != Property::PathProgress);
                    next.graph.bindings.retain(|b| {
                        b.layer != layer_id || b.property != Property::PathProgress
                    });
                }
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setParticleEmitter" => {
                let layer_id = id(p, "layer")?;
                // `emitter:null` (or absent) clears the spec, leaving an
                // empty particles layer; otherwise a full emitter spec.
                let emitter = match p.get("emitter") {
                    None | Some(Value::Null) => None,
                    Some(v) => {
                        let e: ParticleEmitter = serde_json::from_value(v.clone())
                            .map_err(|_| bad("invalid particle emitter"))?;
                        if !e.valid() {
                            return Err(bad("invalid particle emitter"));
                        }
                        if let ParticleSprite::Asset { asset_id } = e.sprite {
                            if !next.assets.contains_key(&asset_id) {
                                return Err(bad("particle sprite references unknown asset"));
                            }
                        }
                        Some(e)
                    }
                };
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                if arc.kind != Some(LayerKind::Particles) {
                    return Err(bad("particle emitter requires a particles layer"));
                }
                let mut nl = (*arc).clone();
                nl.emitter = emitter;
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setLayer3D" => {
                let layer_id = id(p, "layer")?;
                // `transform3d:null` (or absent) clears the 3D transform and
                // any rx/ry/z curves atomically — the setMotionPath precedent;
                // otherwise a full Transform3D replacement whose absent fields
                // default to 0 (identity orientation/depth).
                let t3 = match p.get("transform3d") {
                    None | Some(Value::Null) => None,
                    Some(v) => {
                        let t: Transform3D = serde_json::from_value(v.clone())
                            .map_err(|_| bad("invalid transform3d"))?;
                        if !t.valid() {
                            return Err(bad("invalid transform3d"));
                        }
                        Some(t)
                    }
                };
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut nl = (*arc).clone();
                nl.transform3d = t3;
                if nl.transform3d.is_none() {
                    nl.curves.retain(|c| !c.property.is_3d());
                    // rx/ry/z expressions require transform3d too; they
                    // clear atomically with it like the curves do, and so
                    // do slice-I graph bindings on those cells.
                    nl.expressions.retain(|e| !e.property.is_3d());
                    next.graph
                        .bindings
                        .retain(|b| b.layer != layer_id || !b.property.is_3d());
                }
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setExpression" => {
                let layer_id = id(p, "layer")?;
                let property: Property = serde_json::from_value(
                    p.get("property")
                        .cloned()
                        .ok_or_else(|| bad("property required"))?,
                )?;
                // `source` is required: a string ≤4KiB to set/replace, or
                // explicit null to clear. Absent rejects.
                let source = match p.get("source") {
                    None => return Err(bad("source required")),
                    Some(Value::Null) => None,
                    Some(v) => Some(
                        v.as_str()
                            .ok_or_else(|| bad("source must be a string or null"))?,
                    ),
                };
                let (comp_key, i) =
                    locate_layer(&next, layer_id).ok_or_else(|| bad("unknown layer"))?;
                let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                if arc.locked {
                    return Err(bad("layer is locked"));
                }
                let mut nl = (*arc).clone();
                match source {
                    None => {
                        nl.expressions.retain(|e| e.property != property);
                    }
                    Some(source) => {
                        // Parse now so malformed input rejects before any
                        // state change; validate() re-checks caps, kind
                        // gates, mutual exclusion and dependency acyclicity.
                        expressions::parse(source).map_err(|_| bad("invalid expression"))?;
                        if let Some(existing) =
                            nl.expressions.iter_mut().find(|e| e.property == property)
                        {
                            existing.source = source.to_string();
                        } else {
                            nl.expressions.push(PropertyExpr {
                                property,
                                source: source.to_string(),
                            });
                        }
                        // Ownership rule: an expression and a curve never
                        // coexist on one (layer, property) — the curve clears
                        // in this same journal entry. A slice-I graph
                        // binding on the same cell drops atomically too.
                        nl.curves.retain(|c| c.property != property);
                        next.graph
                            .bindings
                            .retain(|b| b.layer != layer_id || b.property != property);
                    }
                }
                comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
            }
            "setGraph" => {
                // Full replacement of graph nodes and bindings (the
                // setLayerEffects/setPropertyKeys precedent — no
                // incremental add/remove/connect ops). Payload is
                // `{nodes?,bindings?}` or null; absent fields clear.
                let mut graph = match p {
                    Value::Null => Graph::default(),
                    Value::Object(object) => {
                        if object
                            .keys()
                            .any(|k| !["nodes", "bindings"].contains(&k.as_str()))
                        {
                            return Err(bad("unknown setGraph field"));
                        }
                        let nodes = match p.get("nodes") {
                            None | Some(Value::Null) => Vec::new(),
                            Some(v) => serde_json::from_value::<Vec<GraphNode>>(v.clone())
                                .map_err(|_| bad("invalid graph nodes"))?,
                        };
                        let bindings = match p.get("bindings") {
                            None | Some(Value::Null) => Vec::new(),
                            Some(v) => serde_json::from_value::<Vec<Binding>>(v.clone())
                                .map_err(|_| bad("invalid graph bindings"))?,
                        };
                        Graph {
                            nodes,
                            bindings,
                            next_node_id: next.graph.next_node_id,
                        }
                    }
                    _ => return Err(bad("setGraph payload must be an object or null")),
                };
                // Locked-layer bindings reject before any clear; unknown
                // layers and kind gates are re-checked by validate().
                for b in &graph.bindings {
                    let (comp_key, i) =
                        locate_layer(&next, b.layer).ok_or_else(|| bad("unknown layer"))?;
                    if comp_layers(&next, comp_key).unwrap()[i].locked {
                        return Err(bad("layer is locked"));
                    }
                }
                // Mutual exclusion, last-write-wins: each binding atomically
                // clears a conflicting curve and expression on its
                // (layer, property) inside this same journal entry.
                for b in &graph.bindings {
                    if let Some((comp_key, i)) = locate_layer(&next, b.layer) {
                        let arc = comp_layers(&next, comp_key).unwrap()[i].clone();
                        let mut nl = (*arc).clone();
                        nl.curves.retain(|c| c.property != b.property);
                        nl.expressions.retain(|e| e.property != b.property);
                        comp_layers_mut(&mut next, comp_key).unwrap()[i] = Arc::new(nl);
                    }
                }
                // Advance the monotonic counter past the largest supplied
                // id; ids themselves are client-chosen within the safe
                // range and uniqueness is validated below.
                if let Some(max_id) = graph.nodes.iter().map(|n| n.id).max() {
                    let needed = max_id
                        .checked_add(1)
                        .filter(|v| *v <= SAFE_ID)
                        .ok_or_else(|| bad("graph identity exhausted"))?;
                    if needed > graph.next_node_id {
                        graph.next_node_id = needed;
                    }
                }
                next.graph = graph;
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
                    transform3d: None,
                    emitter: None,
                    transform: Transform::default(),
                    opacity: 1.,
                    expressions: vec![],
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
                    transform3d: None,
                    emitter: None,
                    transform: Transform::default(),
                    opacity: 1.,
                    expressions: vec![],
                    curves: vec![],
                }));
                data = json!({"layer_id":layer});
            }
            "addParticlesLayer" => {
                let into = State::comp_arg(p, "comp")?;
                let layer = next.next_layer_id;
                next.next_layer_id = layer
                    .checked_add(1)
                    .ok_or_else(|| bad("layer identity exhausted"))?;
                let name = opt_string(p, "name", "Particles")?;
                let layers = comp_layers_mut(&mut next, into)
                    .ok_or_else(|| bad("unknown composition"))?;
                layers.push(Arc::new(Layer {
                    id: layer,
                    name,
                    visible: true,
                    locked: false,
                    kind: Some(LayerKind::Particles),
                    shape: None,
                    asset_id: None,
                    comp_id: None,
                    parent_id: None,
                    blend: None,
                    clipped: false,
                    matte: None,
                    effects: vec![],
                    path: None,
                    path_progress: 0.,
                    transform3d: None,
                    emitter: None,
                    transform: Transform::default(),
                    opacity: 1.,
                    expressions: vec![],
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
                    .any(|l| {
                        l.asset_id == Some(asset_id)
                            || l.emitter
                                .as_ref()
                                .and_then(|e| e.sprite.asset_id())
                                == Some(asset_id)
                    });
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
                    // Last-write-wins: writing keys for a property clears its
                    // expression in the same journal entry (slice D), and a
                    // slice-I graph binding on the same cell drops too.
                    layer.expressions.retain(|e| e.property != property);
                    next.graph
                        .bindings
                        .retain(|b| b.layer != layer_id || b.property != property);
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
#[cfg(test)]
mod particles_tests;
#[cfg(test)]
mod transform3d_tests;
#[cfg(test)]
mod expression_tests;
#[cfg(test)]
mod graph_tests;
