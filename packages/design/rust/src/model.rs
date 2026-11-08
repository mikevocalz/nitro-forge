use ignition_core::EngineError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
pub const SAFE_ID: u64 = 9_007_199_254_740_991;
/// UTF-8 byte cap for text-node content (64 KiB).
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
/// UTF-8 byte cap for the text font family name.
pub const MAX_FONT_FAMILY_BYTES: usize = 256;
/// UTF-8 byte cap for variable and mode identifiers.
pub const MAX_SYMBOL_ID_BYTES: usize = 128;
/// UTF-8 byte cap for variable and mode display names.
pub const MAX_SYMBOL_NAME_BYTES: usize = 256;
/// UTF-8 byte cap for string variable values (mirrors the UI field cap).
pub const MAX_STRING_VALUE_BYTES: usize = 64 * 1024;
/// Maximum absolute magnitude admitted for number variable literals.
pub const MAX_VARIABLE_NUMBER: f64 = 1e9;
/// Bound on stored design variables.
pub const MAX_VARIABLES: usize = 1024;
/// Bound on stored modes.
pub const MAX_MODES: usize = 128;
/// Bound on node property bindings.
pub const MAX_BINDINGS: usize = 4096;
/// Bound on variant bundles stored on one component.
pub const MAX_VARIANTS: usize = 64;
/// Bound on override entries in one instance spec or variant bundle;
/// `validate_override_set` enforces it for both call sites.
pub const MAX_OVERRIDES: usize = 256;
/// Upper magnitude admitted for C2 constraint extent bounds (min/max
/// width/height), matching the node geometry size bound.
pub const MAX_CONSTRAINT_EXTENT: f64 = 1e7;
/// Prototype catalog bounds, mirroring the NYC-Tron forge/design control
/// contracts: screens ≤512 (PrototypeConnectionTool frame cap), hotspots
/// and interactions ≤4096, transitions ≤256.
pub const MAX_SCREENS: usize = 512;
pub const MAX_HOTSPOTS: usize = 4096;
pub const MAX_INTERACTIONS: usize = 4096;
pub const MAX_TRANSITIONS: usize = 256;
/// Trigger delay cap in milliseconds (InteractionTriggerEditor max).
pub const MAX_DELAY_MS: u64 = 86_400_000;
/// Transition duration cap in milliseconds (InteractionTriggerEditor max).
pub const MAX_TRANSITION_MS: u64 = 600_000;
/// Comment catalog bounds (slice G), matching the NYC-Tron
/// `CommentsThreadPanel` roster guard: ≤1024 threads, ≤1024 replies per
/// thread, body ≤64KiB per entry.
pub const MAX_COMMENT_THREADS: usize = 1024;
pub const MAX_COMMENT_REPLIES: usize = 1024;
pub const MAX_COMMENT_BODY_BYTES: usize = 64 * 1024;
/// UTF-8 byte cap for comment thread/reply ids (panel allows ≤256).
pub const MAX_COMMENT_ID_BYTES: usize = 256;
/// UTF-8 byte cap for optional author and time-label display strings.
pub const MAX_COMMENT_META_BYTES: usize = 256;
/// Normalized hotspot geometry admits a tiny float epsilon so 0.1+0.9-style
/// authored regions that land on the boundary are not rejected.
pub const HOTSPOT_EPSILON: f64 = 1e-9;
/// Shared hop budget for whole-document alias validation; exceeding it
/// rejects the candidate so hostile snapshots cannot force unbounded walks.
pub const MAX_ALIAS_HOPS: usize = 1_000_000;
pub fn bad(s: &str) -> EngineError {
    EngineError::validation(s)
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Frame,
    Rect,
    Ellipse,
    /// Layout box only: glyphs are a Prism/font-metrics gate. `renderFrame`
    /// draws the node's fill as a plain rect background and no text.
    Text,
    /// Reusable definition node (NYC-Tron `component`): frame-like — it owns
    /// children and an optional flow layout — and renders on canvas like a
    /// frame. Its subtree is the template that `Kind::Instance` nodes expand.
    Component,
    /// Materialized-instance reference (NYC-Tron `instance`): a leaf node
    /// storing `instance.component` + optional `variant` + `overrides`. Its
    /// rendered subtree exists only as a deterministic read-time expansion;
    /// the expanded form is never persisted.
    Instance,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Row,
    Column,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Start,
    Center,
    End,
    Stretch,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Justify {
    Start,
    Center,
    End,
    SpaceBetween,
}
fn is_false(value: &bool) -> bool {
    !*value
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    pub direction: Direction,
    #[serde(default, skip_serializing_if = "is_false")]
    pub wrap: bool,
    pub gap: f64,
    pub padding_top: f64,
    pub padding_right: f64,
    pub padding_bottom: f64,
    pub padding_left: f64,
    pub align: Align,
    pub justify: Justify,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SizeMode {
    #[default]
    Fixed,
    Hug,
    Fill,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sizing {
    pub x: SizeMode,
    pub y: SizeMode,
}
impl Sizing {
    fn is_fixed(&self) -> bool {
        *self == Self::default()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    X,
    Y,
}
impl Axis {
    pub fn other(self) -> Self {
        match self {
            Self::X => Self::Y,
            Self::Y => Self::X,
        }
    }
}
/// NYC-Tron `DesignConstraints.horizontal` anchor set. `Scale` parses so
/// hostile input deserializes, but `validate` rejects it in C1: proportional
/// scaling is solver work deferred to a later slice.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HorizontalAnchor {
    Left,
    Right,
    Center,
    Stretch,
    Scale,
}
/// NYC-Tron `DesignConstraints.vertical` anchor set; same C1 `Scale` caveat.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerticalAnchor {
    Top,
    Bottom,
    Center,
    Stretch,
    Scale,
}
/// Responsive constraints stored on absolute children only (the NYC-Tron
/// `DesignConstraints` contract). C1 admitted the h/v anchors; C2 adds
/// bounded min/max extents, the `aspect_locked` flag and parent-or-sibling
/// `relative_to` targets. `layout::evaluate_report` solves them
/// automatically: anchors pin the child's edge/midpoint/span flush to the
/// reference box (the contract stores no inset margins), bounds clamp
/// extents and `aspect_locked` derives the ratio from evaluated geometry —
/// unsatisfied nodes keep their unconstrained box and are reported, never
/// silently dropped. `scale` anchors remain
/// rejected. `relative_to` maps NYC-Tron `relativeToId` to the engine's
/// numeric node id; absent means the parent frame.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeConstraints {
    pub horizontal: HorizontalAnchor,
    pub vertical: VerticalAnchor,
    /// Optional lower extent bound per axis in document units; finite,
    /// 0..=MAX_CONSTRAINT_EXTENT, and <= the matching max when both exist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f64>,
    /// NYC-Tron `aspectLocked`: asks a future solver to preserve the current
    /// width/height ratio. No ratio is stored; the solver derives it from
    /// geometry at enforcement time.
    #[serde(default, skip_serializing_if = "is_false")]
    pub aspect_locked: bool,
    /// NYC-Tron `relativeToId` as a numeric node id: the parent frame or a
    /// sibling (a node sharing the same parent). Absent means the parent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_to: Option<u64>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextFontStyle {
    Normal,
    Italic,
}
/// Bounded text style. `content` is the only payload-bearing field; every
/// field is validated in `State::validate` via `TextStyle::valid`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextStyle {
    pub content: String,
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u16,
    pub font_style: TextFontStyle,
}
impl Default for TextStyle {
    fn default() -> Self {
        Self {
            content: String::new(),
            font_family: "sans-serif".into(),
            font_size: 16.,
            font_weight: 400,
            font_style: TextFontStyle::Normal,
        }
    }
}
impl TextStyle {
    pub fn valid(&self) -> bool {
        self.content.len() <= MAX_TEXT_BYTES
            && self
                .content
                .chars()
                .all(|c| c == '\n' || c == '\t' || !c.is_control())
            && !self.font_family.is_empty()
            && self.font_family.len() <= MAX_FONT_FAMILY_BYTES
            && !self.font_family.chars().any(char::is_control)
            && self.font_size.is_finite()
            && self.font_size > 0.
            && self.font_size <= 1e4
            && (1..=1000).contains(&self.font_weight)
    }
}
/// Bounded set of node properties an instance override or component variant
/// may set on a template node. `text` sets only the content string of a
/// `Kind::Text` target; font style stays authored on the template.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverridePath {
    Name,
    Fill,
    X,
    Y,
    Width,
    Height,
    Visible,
    Locked,
    Text,
}
/// Scalar payload for an [`OverridePath`]. Untagged JSON keeps the NYC-Tron
/// `onOverride(id, string|number|boolean)` shape plus the engine's `[r,g,b,a]`
/// fill quadruple; `validate` enforces the path↔value pairing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OverrideValue {
    Flag(bool),
    Number(f64),
    Text(String),
    Color([u8; 4]),
}
/// One property override aimed at a node inside a component subtree.
/// `node` is the template node id: the component root id targets the
/// expanded instance root, any descendant id targets that clone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeOverride {
    pub node: u64,
    pub path: OverridePath,
    pub value: OverrideValue,
}
/// Named override bundle stored on a component (NYC-Tron variant picker:
/// `onPropertyChange` selects one of these by name). Multi-axis variant
/// properties are deferred; a variant is a flat named set.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentVariant {
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<NodeOverride>,
}
/// Instance payload stored on `Kind::Instance` nodes only. `component`
/// names the `Kind::Component` node; `variant` selects one of its
/// `variants` by name; `overrides` apply after variant properties, so
/// instance-level values win on `(node, path)` conflicts.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstanceSpec {
    pub component: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<NodeOverride>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: u64,
    pub kind: Kind,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub fill: [u8; 4],
    pub visible: bool,
    pub locked: bool,
    pub children: Vec<u64>,
    pub layout: Option<Layout>,
    #[serde(default, skip_serializing_if = "Sizing::is_fixed")]
    pub sizing: Sizing,
    /// Present only on `Kind::Text` nodes; its presence is what triggers the
    /// schema:2 snapshot wrapper (see `requires_wrapper`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextStyle>,
    /// Responsive anchors; meaningful only on absolute children (parent
    /// without flow layout), enforced by `validate`. Presence also triggers
    /// the schema:2 snapshot wrapper.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<NodeConstraints>,
    /// Named variant bundles; meaningful only on `Kind::Component` nodes.
    /// Presence triggers the schema:2 snapshot wrapper.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<ComponentVariant>,
    /// Component reference + variant + overrides; meaningful only on
    /// `Kind::Instance` nodes. Presence triggers the schema:2 wrapper.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance: Option<InstanceSpec>,
}
impl Node {
    pub fn frame(id: u64, width: f64, height: f64) -> Self {
        Self {
            id,
            kind: Kind::Frame,
            name: "Frame".into(),
            x: 0.,
            y: 0.,
            width,
            height,
            fill: [0, 0, 0, 0],
            visible: true,
            locked: false,
            children: vec![],
            layout: None,
            sizing: Sizing::default(),
            text: None,
            constraints: None,
            variants: vec![],
            instance: None,
        }
    }
}
/// Declared variable type; every per-mode value must resolve to this type.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VarType {
    Number,
    String,
    Boolean,
}
/// Per-mode variable value: a typed literal or an alias to another variable.
/// Serialized `{kind:"number"|"string"|"boolean"|"alias", ...}` mirroring the
/// NYC-Tron `DesignVariableValue` contract (engine fields are snake_case).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum VarValue {
    Number { value: f64 },
    String { value: String },
    Boolean { value: bool },
    Alias { variable_id: String },
}
/// A fully resolved literal; aliases never appear here.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Literal {
    Number { value: f64 },
    String { value: String },
    Boolean { value: bool },
}
/// Closed set of node properties a variable may bind. Every path resolves to
/// a single number at read/render time; bindings never bake into nodes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindPath {
    FillR,
    FillG,
    FillB,
    FillA,
    Gap,
    PaddingTop,
    PaddingRight,
    PaddingBottom,
    PaddingLeft,
    X,
    Y,
    Width,
    Height,
}
/// A named collection of per-mode values. `values` is sparse: a variable may
/// legitimately have no value in some modes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Variable {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub var_type: VarType,
    #[serde(default)]
    pub values: BTreeMap<String, VarValue>,
}
/// Named value collection switch; at most [`MAX_MODES`] are stored.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mode {
    pub id: String,
    pub name: String,
}
/// Binds one node property path to a number variable. Stored on `State`, not
/// on the node, so resolution stays a read/render-time overlay.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub node_id: u64,
    pub path: BindPath,
    pub variable_id: String,
}
/// NYC-Tron `PrototypeInteraction.trigger` set (InteractionTriggerEditor).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrototypeTrigger {
    Tap,
    Press,
    Hover,
    Drag,
    Timer,
}
/// NYC-Tron `PrototypeInteraction.action` set.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PrototypeAction {
    Navigate,
    Overlay,
    Back,
    CloseOverlay,
    SetVariable,
}
/// Bounded transition kinds the host runtime can schedule. `Slide`
/// requires `direction`; the other kinds ignore it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionKind {
    Instant,
    Dissolve,
    Slide,
    SmartAnimate,
}
/// Bounded easing set; the host maps these onto its animation clock —
/// the engine stores the choice only and never runs a clock.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionEasing {
    #[default]
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
}
/// Slide direction for `TransitionKind::Slide`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlideDirection {
    Left,
    Right,
    Up,
    Down,
}
/// What an interaction acts on. `navigate`/`overlay` target a registered
/// screen node; `set-variable` targets a design variable; `back` and
/// `close-overlay` carry no target. Serialized `{"kind":"screen","node":N}`
/// / `{"kind":"variable","id":"..."}` — a typed engine mapping of the
/// NYC-Tron string `destinationId` contract.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PrototypeTarget {
    Screen { node: u64 },
    Variable { id: String },
}
/// A screen is a durable reference to a `Frame` or `Component` node plus
/// the FlowOverview `entry` flag. The label is derived live from the node
/// name at read time, so renames propagate without rewriting the catalog.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrototypeScreen {
    pub node: u64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub entry: bool,
}
/// A trigger region normalized to 0..=1 inside its screen's box
/// (PrototypeHotspot/PrototypeFrameTarget contract geometry). `x`,`y` are
/// the region origin, `width`/`height` the extents; the region must stay
/// inside the unit square.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrototypeHotspot {
    pub id: String,
    pub screen: u64,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
/// A named transition preset: bounded kind/easing/direction plus a default
/// duration. Interactions reference one by id and may override its
/// duration with their own `duration_ms`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrototypeTransition {
    pub id: String,
    pub label: String,
    pub kind: TransitionKind,
    #[serde(default)]
    pub easing: TransitionEasing,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<SlideDirection>,
    #[serde(default)]
    pub duration_ms: u64,
}
/// NYC-Tron `PrototypeInteraction` as durable document state, attached to
/// exactly one of `hotspot` (a hotspot id) or `screen` (a registered screen
/// node — screen-level triggers such as timers need no region). `delay_ms`
/// is the trigger delay the host schedules; `duration_ms` optionally
/// overrides the referenced transition's duration. `value` is an engine
/// extension carrying the literal a `set-variable` action writes; it must
/// be a non-alias literal matching the target variable's type.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrototypeInteraction {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hotspot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen: Option<u64>,
    pub trigger: PrototypeTrigger,
    #[serde(default)]
    pub delay_ms: u64,
    pub action: PrototypeAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<PrototypeTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<VarValue>,
}
/// The whole prototype catalog. Empty collections are omitted from
/// snapshots so schema:1-only documents stay byte-identical; any content
/// triggers the schema:2 wrapper via `requires_wrapper`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrototypeState {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub screens: Vec<PrototypeScreen>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hotspots: Vec<PrototypeHotspot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interactions: Vec<PrototypeInteraction>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<PrototypeTransition>,
}
impl PrototypeState {
    pub fn is_empty(&self) -> bool {
        self.screens.is_empty()
            && self.hotspots.is_empty()
            && self.interactions.is_empty()
            && self.transitions.is_empty()
    }
}
/// Comment pin anchor (slice G, NYC-Tron L-14 `CommentPins` contract): a
/// point in document units. Pins are canvas positions, not node
/// attachments — layout changes do not move them and node deletion cannot
/// orphan them, so no remap machinery exists. Hosts convert between
/// viewport and document space; the engine stores document space only.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentAnchor {
    pub x: f64,
    pub y: f64,
}
/// One comment body: a thread's opening entry or a reply. `author` and
/// `time_label` are optional host-supplied display strings — the engine is
/// I/O-free and keeps no clock, so `time_label` is stored verbatim (the
/// NYC-Tron panel contract calls it "already formatted by the app").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentEntry {
    pub id: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_label: Option<String>,
}
/// A comment thread pinned at a document-space point. `resolved` is the
/// durable open/resolved flag the panel's filter reads; replies are
/// append-only (no per-reply edit/delete in the contract).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentThread {
    pub id: String,
    pub anchor: CommentAnchor,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_label: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub resolved: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub replies: Vec<CommentEntry>,
}
/// The whole comment catalog. Empty state is omitted from snapshots so
/// schema:1-only documents stay byte-identical; any thread triggers the
/// schema:2 wrapper via `requires_wrapper`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentCatalog {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub threads: Vec<CommentThread>,
}
impl CommentCatalog {
    pub fn is_empty(&self) -> bool {
        self.threads.is_empty()
    }
}
pub(crate) fn valid_symbol_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_SYMBOL_ID_BYTES && !s.chars().any(char::is_control)
}
fn valid_symbol_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_SYMBOL_NAME_BYTES
        && !s.chars().any(char::is_control)
}
pub(crate) fn valid_number(v: f64) -> bool {
    v.is_finite() && v.abs() <= MAX_VARIABLE_NUMBER
}
/// Resolve a variable's value in `mode`, following alias chains. Mirrors the
/// NYC-Tron `validateAlias` contract: every hop target must exist, share the
/// root variable's type, and carry a value in this mode; the chain must end
/// in a literal of the root type. Chain length is bounded by the variable
/// count because a repeated id is a cycle.
pub fn resolve_mode_value(
    s: &State,
    variable: &Variable,
    mode: &str,
) -> Result<Literal, EngineError> {
    let mut seen = BTreeSet::from([variable.id.clone()]);
    let mut current_var = variable;
    let mut current = variable
        .values
        .get(mode)
        .ok_or_else(|| bad("variable has no value in this mode"))?;
    loop {
        match current {
            VarValue::Number { value } if valid_number(*value) => {
                return if current_var.var_type == VarType::Number {
                    Ok(Literal::Number { value: *value })
                } else {
                    Err(bad("variable literal kind does not match its type"))
                };
            }
            VarValue::String { value } if value.len() <= MAX_STRING_VALUE_BYTES => {
                return if current_var.var_type == VarType::String {
                    Ok(Literal::String {
                        value: value.clone(),
                    })
                } else {
                    Err(bad("variable literal kind does not match its type"))
                };
            }
            VarValue::Boolean { value } => {
                return if current_var.var_type == VarType::Boolean {
                    Ok(Literal::Boolean { value: *value })
                } else {
                    Err(bad("variable literal kind does not match its type"))
                };
            }
            VarValue::Alias { variable_id } => {
                if !valid_symbol_id(variable_id) || !seen.insert(variable_id.clone()) {
                    return Err(bad("variable aliases must not form a cycle"));
                }
                let target = s
                    .variables
                    .get(variable_id)
                    .ok_or_else(|| bad("alias target does not exist"))?;
                if target.var_type != current_var.var_type {
                    return Err(bad("alias target must have the same variable type"));
                }
                current = target
                    .values
                    .get(mode)
                    .ok_or_else(|| bad("alias has no value in this mode"))?;
                current_var = target;
            }
            _ => return Err(bad("variable value exceeds bounds")),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub kind: String,
    pub schema: u32,
    pub title: String,
    pub next_id: u64,
    pub nodes: BTreeMap<u64, Arc<Node>>,
    /// Design variables keyed by id; empty collections are omitted from
    /// snapshots so schema:1-only documents stay byte-identical.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub variables: BTreeMap<String, Variable>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modes: Vec<Mode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bindings: Vec<Binding>,
    /// Prototype catalog (screens/hotspots/interactions/transitions).
    /// Presence triggers the schema:2 snapshot wrapper; empty state is
    /// omitted so schema:1-only documents stay byte-identical.
    #[serde(default, skip_serializing_if = "PrototypeState::is_empty")]
    pub prototype: PrototypeState,
    /// Comment threads/pins (slice G). Presence triggers the schema:2
    /// snapshot wrapper; empty state is omitted so schema:1-only documents
    /// stay byte-identical.
    #[serde(default, skip_serializing_if = "CommentCatalog::is_empty")]
    pub comments: CommentCatalog,
}
impl Default for State {
    fn default() -> Self {
        Self {
            kind: "design".into(),
            schema: 1,
            title: "Untitled".into(),
            next_id: 2,
            nodes: BTreeMap::from([(1, Arc::new(Node::frame(1, 640., 360.)))]),
            variables: BTreeMap::new(),
            modes: vec![],
            active_mode: None,
            bindings: vec![],
            prototype: PrototypeState::default(),
            comments: CommentCatalog::default(),
        }
    }
}
impl State {
    pub fn parent(&self, id: u64) -> Option<u64> {
        self.nodes
            .values()
            .find(|n| n.children.contains(&id))
            .map(|n| n.id)
    }
    pub fn editable(&self, id: u64, unlock: bool) -> Result<(), EngineError> {
        let mut current = Some(id);
        let mut first = true;
        while let Some(i) = current {
            let n = self.nodes.get(&i).ok_or_else(|| bad("unknown node"))?;
            if n.locked && !(first && unlock) {
                return Err(bad("node or ancestor is locked"));
            }
            first = false;
            current = self.parent(i);
        }
        Ok(())
    }
    pub fn subtree(&self, id: u64) -> Vec<u64> {
        let mut ids = vec![id];
        let mut offset = 0;
        while offset < ids.len() {
            ids.extend(self.nodes[&ids[offset]].children.iter().copied());
            offset += 1;
        }
        ids
    }
}
/// Schema-2 features (text nodes, constraints, variables/modes/bindings)
/// require the versioned snapshot wrapper so schema:1 documents stay
/// byte-identical and old readers fail closed on the unknown `kind:"text"`
/// node variant, `text`/`constraints` fields, or the new state collections.
pub fn requires_wrapper(s: &State) -> bool {
    s.nodes.values().any(|n| {
        n.kind == Kind::Text
            || n.text.is_some()
            || n.constraints.is_some()
            || n.kind == Kind::Component
            || n.kind == Kind::Instance
            || n.instance.is_some()
            || !n.variants.is_empty()
    })
        || !s.variables.is_empty()
        || !s.modes.is_empty()
        || s.active_mode.is_some()
        || !s.bindings.is_empty()
        || !s.prototype.is_empty()
        || !s.comments.is_empty()
}
/// Whole-document variable/mode/binding validation. Alias chains are checked
/// per stored (variable, mode) entry with a shared hop budget and a memo of
/// already-proven (variable, mode) resolutions so dense documents stay
/// linear-ish; exceeding [`MAX_ALIAS_HOPS`] rejects the candidate.
fn validate_alias_entry(
    s: &State,
    root: &Variable,
    mode: &str,
    memo: &mut BTreeMap<(String, String), ()>,
    hops: &mut usize,
) -> Result<(), EngineError> {
    let mut seen = BTreeSet::from([root.id.clone()]);
    let mut visited = vec![root.id.clone()];
    let mut current_var = root;
    let mut current = current_var
        .values
        .get(mode)
        .ok_or_else(|| bad("variable has no value in this mode"))?;
    loop {
        *hops = hops.checked_sub(1).ok_or_else(|| {
            bad("alias validation budget exceeded")
        })?;
        match current {
            VarValue::Number { value } if valid_number(*value) => {
                if current_var.var_type != VarType::Number {
                    return Err(bad("variable literal kind does not match its type"));
                }
                break;
            }
            VarValue::String { value } if value.len() <= MAX_STRING_VALUE_BYTES => {
                if current_var.var_type != VarType::String {
                    return Err(bad("variable literal kind does not match its type"));
                }
                break;
            }
            VarValue::Boolean { value: _ } => {
                if current_var.var_type != VarType::Boolean {
                    return Err(bad("variable literal kind does not match its type"));
                }
                break;
            }
            VarValue::Alias { variable_id } => {
                if !valid_symbol_id(variable_id) || !seen.insert(variable_id.clone()) {
                    return Err(bad("variable aliases must not form a cycle"));
                }
                let target = s
                    .variables
                    .get(variable_id)
                    .ok_or_else(|| bad("alias target does not exist"))?;
                if target.var_type != current_var.var_type {
                    return Err(bad("alias target must have the same variable type"));
                }
                if memo.contains_key(&(variable_id.clone(), mode.to_string())) {
                    break;
                }
                current = target
                    .values
                    .get(mode)
                    .ok_or_else(|| bad("alias has no value in this mode"))?;
                current_var = target;
                visited.push(variable_id.clone());
            }
            _ => return Err(bad("variable value exceeds bounds")),
        }
    }
    for id in visited {
        memo.insert((id, mode.to_string()), ());
    }
    Ok(())
}
pub fn validate_variables(s: &State) -> Result<(), EngineError> {
    if s.variables.len() > MAX_VARIABLES
        || s.modes.len() > MAX_MODES
        || s.bindings.len() > MAX_BINDINGS
    {
        return Err(bad("variable, mode or binding budget exceeded"));
    }
    let mut mode_ids = BTreeSet::new();
    for m in &s.modes {
        if !valid_symbol_id(&m.id) || !valid_symbol_name(&m.name) || !mode_ids.insert(&m.id) {
            return Err(bad("invalid or duplicate mode"));
        }
    }
    if let Some(active) = &s.active_mode {
        if !mode_ids.contains(active) {
            return Err(bad("active mode does not exist"));
        }
    }
    let mut memo = BTreeMap::new();
    let mut hops = MAX_ALIAS_HOPS;
    for (key, v) in &s.variables {
        if key != &v.id || !valid_symbol_id(&v.id) || !valid_symbol_name(&v.name) {
            return Err(bad("invalid variable identity"));
        }
        for (mode, value) in &v.values {
            if !mode_ids.contains(mode) {
                return Err(bad("variable value references unknown mode"));
            }
            match value {
                VarValue::Alias { variable_id } if !valid_symbol_id(variable_id) => {
                    return Err(bad("invalid alias target"));
                }
                VarValue::Number { value } if !valid_number(*value) => {
                    return Err(bad("variable number out of bounds"));
                }
                VarValue::String { value } if value.len() > MAX_STRING_VALUE_BYTES => {
                    return Err(bad("variable string out of bounds"));
                }
                _ => {}
            }
            validate_alias_entry(s, v, mode, &mut memo, &mut hops)?;
        }
    }
    let mut seen = BTreeSet::new();
    for b in &s.bindings {
        if !seen.insert((b.node_id, b.path)) {
            return Err(bad("duplicate variable binding"));
        }
        let n = s
            .nodes
            .get(&b.node_id)
            .ok_or_else(|| bad("binding references unknown node"))?;
        let v = s
            .variables
            .get(&b.variable_id)
            .ok_or_else(|| bad("binding references unknown variable"))?;
        if v.var_type != VarType::Number {
            return Err(bad("only number variables can bind properties"));
        }
        // Context-dependent rules (fixed sizing for width/height, absolute
        // placement for x/y, root canvas geometry) are enforced at bind time
        // only; a later layout or sizing change leaves the binding dormant
        // rather than invalid.
        let applicable = match b.path {
            BindPath::FillR | BindPath::FillG | BindPath::FillB | BindPath::FillA => true,
            // Root width/height would bypass the setComposition canvas budget
            // through the effective overlay; the authored canvas is fixed.
            BindPath::Width | BindPath::Height => b.node_id != 1,
            BindPath::Gap
            | BindPath::PaddingTop
            | BindPath::PaddingRight
            | BindPath::PaddingBottom
            | BindPath::PaddingLeft => n.kind == Kind::Frame,
            BindPath::X | BindPath::Y => b.node_id != 1,
        };
        if !applicable {
            return Err(bad("binding path is not applicable to this node"));
        }
    }
    Ok(())
}
/// Prototype catalog validation (slice E). Runs inside whole-document
/// `validate`, so hostile restores face the same referential and bound
/// rules as mutations. Screens must name existing Frame/Component nodes;
/// hotspots stay inside the unit square of a registered screen;
/// interactions attach to exactly one hotspot or screen and their target
/// must match the action (`navigate`/`overlay` → registered screen,
/// `set-variable` → existing variable with a type-matching literal value,
/// `back`/`close-overlay` → no target); transitions are a bounded
/// kind/easing/direction set with slide requiring a direction.
fn validate_prototype(s: &State) -> Result<(), EngineError> {
    let p = &s.prototype;
    if p.screens.len() > MAX_SCREENS
        || p.hotspots.len() > MAX_HOTSPOTS
        || p.interactions.len() > MAX_INTERACTIONS
        || p.transitions.len() > MAX_TRANSITIONS
    {
        return Err(bad("prototype catalog budget exceeded"));
    }
    let mut screen_nodes = BTreeSet::new();
    for sc in &p.screens {
        let n = s
            .nodes
            .get(&sc.node)
            .ok_or_else(|| bad("prototype screen references unknown node"))?;
        if !matches!(n.kind, Kind::Frame | Kind::Component) {
            return Err(bad("prototype screen must be a frame or component"));
        }
        if !screen_nodes.insert(sc.node) {
            return Err(bad("duplicate prototype screen"));
        }
    }
    let mut hotspot_ids = BTreeSet::new();
    for h in &p.hotspots {
        if !valid_symbol_id(&h.id)
            || !valid_symbol_name(&h.label)
            || !hotspot_ids.insert(h.id.as_str())
        {
            return Err(bad("invalid or duplicate prototype hotspot"));
        }
        if !screen_nodes.contains(&h.screen) {
            return Err(bad("hotspot references unknown prototype screen"));
        }
        let inside = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
        if !inside(h.x)
            || !inside(h.y)
            || !h.width.is_finite()
            || !h.height.is_finite()
            || h.width <= 0.
            || h.height <= 0.
            || h.width > 1.
            || h.height > 1.
            || h.x + h.width > 1. + HOTSPOT_EPSILON
            || h.y + h.height > 1. + HOTSPOT_EPSILON
        {
            return Err(bad("hotspot geometry must stay inside the unit square"));
        }
    }
    let mut transition_ids = BTreeSet::new();
    for t in &p.transitions {
        if !valid_symbol_id(&t.id)
            || !valid_symbol_name(&t.label)
            || !transition_ids.insert(t.id.as_str())
        {
            return Err(bad("invalid or duplicate prototype transition"));
        }
        if t.duration_ms > MAX_TRANSITION_MS {
            return Err(bad("transition duration exceeds bound"));
        }
        match (t.kind, t.direction) {
            (TransitionKind::Slide, None) => {
                return Err(bad("slide transition requires a direction"));
            }
            (TransitionKind::Slide, Some(_)) => {}
            (_, Some(_)) => {
                return Err(bad("direction is only valid on slide transitions"));
            }
            _ => {}
        }
    }
    let mut interaction_ids = BTreeSet::new();
    for i in &p.interactions {
        if !valid_symbol_id(&i.id) || !interaction_ids.insert(i.id.as_str()) {
            return Err(bad("invalid or duplicate prototype interaction"));
        }
        // Exactly one attachment: a hotspot region or a screen-level trigger.
        match (&i.hotspot, i.screen) {
            (Some(h), None) if hotspot_ids.contains(h.as_str()) => {}
            (None, Some(n)) if screen_nodes.contains(&n) => {}
            (None, None) | (Some(_), Some(_)) => {
                return Err(bad("interaction requires exactly one hotspot or screen"));
            }
            _ => return Err(bad("interaction references unknown hotspot or screen")),
        }
        if i.delay_ms > MAX_DELAY_MS
            || i.duration_ms.is_some_and(|d| d > MAX_TRANSITION_MS)
        {
            return Err(bad("interaction timing exceeds bound"));
        }
        if let Some(tid) = &i.transition {
            if !valid_symbol_id(tid) || !transition_ids.contains(tid.as_str()) {
                return Err(bad("interaction references unknown transition"));
            }
        }
        match i.action {
            PrototypeAction::Navigate | PrototypeAction::Overlay => {
                match &i.target {
                    Some(PrototypeTarget::Screen { node }) if screen_nodes.contains(node) => {}
                    _ => {
                        return Err(bad(
                            "navigate/overlay interactions require a screen target",
                        ));
                    }
                }
                if i.value.is_some() {
                    return Err(bad("only set-variable interactions carry a value"));
                }
            }
            PrototypeAction::SetVariable => {
                let Some(PrototypeTarget::Variable { id }) = &i.target else {
                    return Err(bad("set-variable interactions require a variable target"));
                };
                let v = s
                    .variables
                    .get(id)
                    .ok_or_else(|| bad("set-variable target does not exist"))?;
                if let Some(value) = &i.value {
                    // Literal-only: an alias has no meaning as a runtime
                    // assignment payload, and the literal must match the
                    // variable's declared type and scalar bounds.
                    let ok = match (value, v.var_type) {
                        (VarValue::Number { value }, VarType::Number) => valid_number(*value),
                        (VarValue::String { value }, VarType::String) => {
                            value.len() <= MAX_STRING_VALUE_BYTES
                        }
                        (VarValue::Boolean { .. }, VarType::Boolean) => true,
                        _ => false,
                    };
                    if !ok {
                        return Err(bad(
                            "set-variable value must be a literal matching the variable type",
                        ));
                    }
                }
            }
            PrototypeAction::Back | PrototypeAction::CloseOverlay => {
                if i.target.is_some() || i.value.is_some() {
                    return Err(bad("back/close-overlay interactions carry no target or value"));
                }
            }
        }
    }
    Ok(())
}
/// Comment body rule shared by thread bodies and reply bodies: non-empty,
/// ≤64KiB UTF-8, and only `\n`/`\t` control characters admitted (same rule
/// as text-node content).
fn valid_comment_body(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_COMMENT_BODY_BYTES
        && s.chars().all(|c| c == '\n' || c == '\t' || !c.is_control())
}
/// Optional display strings (author, time label): bounded, no control
/// characters. Empty strings are admitted — the panel treats them as
/// absent.
fn valid_comment_meta(s: &str) -> bool {
    s.len() <= MAX_COMMENT_META_BYTES && !s.chars().any(char::is_control)
}
/// Comment catalog validation (slice G). Runs inside whole-document
/// `validate`, so hostile restores face the same identity, anchor, body
/// and reply rules as mutations. Threads pin to document-space points —
/// there is no node reference to dangle, and layout changes never move a
/// pin.
fn validate_comments(s: &State) -> Result<(), EngineError> {
    let c = &s.comments;
    if c.threads.len() > MAX_COMMENT_THREADS {
        return Err(bad("comment thread budget exceeded"));
    }
    let mut thread_ids = BTreeSet::new();
    for t in &c.threads {
        if t.id.is_empty()
            || t.id.len() > MAX_COMMENT_ID_BYTES
            || t.id.chars().any(char::is_control)
            || !thread_ids.insert(t.id.as_str())
        {
            return Err(bad("invalid or duplicate comment thread id"));
        }
        if !t.anchor.x.is_finite()
            || !t.anchor.y.is_finite()
            || t.anchor.x.abs() > 1e6
            || t.anchor.y.abs() > 1e6
        {
            return Err(bad("comment anchor exceeds bounds"));
        }
        if !valid_comment_body(&t.body) {
            return Err(bad("comment body exceeds bounds"));
        }
        if t.author.as_deref().is_some_and(|a| !valid_comment_meta(a))
            || t.time_label
                .as_deref()
                .is_some_and(|l| !valid_comment_meta(l))
        {
            return Err(bad("comment author or time label exceeds bounds"));
        }
        if t.replies.len() > MAX_COMMENT_REPLIES {
            return Err(bad("comment reply budget exceeded"));
        }
        let mut reply_ids = BTreeSet::new();
        for r in &t.replies {
            if r.id.is_empty()
                || r.id.len() > MAX_COMMENT_ID_BYTES
                || r.id.chars().any(char::is_control)
                || !reply_ids.insert(r.id.as_str())
            {
                return Err(bad("invalid or duplicate comment reply id"));
            }
            if !valid_comment_body(&r.body) {
                return Err(bad("comment reply body exceeds bounds"));
            }
            if r.author.as_deref().is_some_and(|a| !valid_comment_meta(a))
                || r.time_label
                    .as_deref()
                    .is_some_and(|l| !valid_comment_meta(l))
            {
                return Err(bad("comment author or time label exceeds bounds"));
            }
        }
    }
    Ok(())
}
/// Path↔value pairing for [`NodeOverride`]; `validate_override_set`
/// enforces the per-path scalar bounds on top of this shape check.
fn override_value_matches(path: OverridePath, v: &OverrideValue) -> bool {
    matches!(
        (path, v),
        (OverridePath::Name | OverridePath::Text, OverrideValue::Text(_))
            | (OverridePath::Fill, OverrideValue::Color(_))
            | (
                OverridePath::X
                    | OverridePath::Y
                    | OverridePath::Width
                    | OverridePath::Height,
                OverrideValue::Number(_)
            )
            | (OverridePath::Visible | OverridePath::Locked, OverrideValue::Flag(_))
    )
}
/// True when `target` is `root` itself or a descendant of `root` in the
/// stored tree. Walks the parent map with the same depth bound as tree
/// validation so hostile input cannot force an unbounded climb.
fn override_target_in_subtree(
    target: u64,
    root: u64,
    parents: &BTreeMap<u64, u64>,
) -> bool {
    let mut cursor = Some(target);
    for _ in 0..=64 {
        let Some(id) = cursor else { return false };
        if id == root {
            return true;
        }
        cursor = parents.get(&id).copied();
    }
    false
}
/// Validate one override set (instance `overrides` or a component
/// variant's `properties`) against the subtree rooted at `component_id`.
/// Every `node` target must be the component root or a descendant, the
/// value must match its path's scalar kind and bounds, `text` overrides
/// require a text target, and `(node, path)` pairs must be unique.
fn validate_override_set(
    s: &State,
    overrides: &[NodeOverride],
    component_id: u64,
    parents: &BTreeMap<u64, u64>,
) -> Result<(), EngineError> {
    if overrides.len() > MAX_OVERRIDES {
        return Err(bad("override budget exceeded"));
    }
    let mut seen = BTreeSet::new();
    for ov in overrides {
        if !seen.insert((ov.node, ov.path)) {
            return Err(bad("duplicate instance override target"));
        }
        if !override_target_in_subtree(ov.node, component_id, parents) {
            return Err(bad("override target is outside the component subtree"));
        }
        let target = s
            .nodes
            .get(&ov.node)
            .ok_or_else(|| bad("override target does not exist"))?;
        if !override_value_matches(ov.path, &ov.value) {
            return Err(bad("override value does not match its path"));
        }
        match (&ov.path, &ov.value) {
            (OverridePath::Name, OverrideValue::Text(v))
                if v.len() > 512 || v.chars().any(char::is_control) =>
            {
                return Err(bad("override name exceeds bounds"));
            }
            (OverridePath::Text, OverrideValue::Text(v)) => {
                if v.len() > MAX_TEXT_BYTES
                    || !v.chars().all(|c| c == '\n' || c == '\t' || !c.is_control())
                {
                    return Err(bad("override text exceeds bounds"));
                }
                if target.kind != Kind::Text {
                    return Err(bad("text override requires a text target"));
                }
            }
            (OverridePath::X | OverridePath::Y, OverrideValue::Number(v))
                if !v.is_finite() || v.abs() > 1e6 =>
            {
                return Err(bad("override position exceeds bounds"));
            }
            (OverridePath::Width | OverridePath::Height, OverrideValue::Number(v))
                if !v.is_finite() || *v <= 0. || *v > 1e7 =>
            {
                return Err(bad("override size exceeds bounds"));
            }
            _ => {}
        }
    }
    Ok(())
}
pub fn validate(s: &State) -> Result<(), EngineError> {
    if s.kind != "design"
        || s.schema != 1
        || s.title.len() > 512
        || s.title.chars().any(char::is_control)
        || s.next_id < 2
        || s.next_id > SAFE_ID
        || s.nodes.is_empty()
        || s.nodes.len() > 1024
    {
        return Err(bad("invalid design header or node budget"));
    }
    let root = s.nodes.get(&1).ok_or_else(|| bad("missing root frame"))?;
    if root.kind != Kind::Frame
        || root.x != 0.
        || root.y != 0.
        || root.width.fract() != 0.
        || root.height.fract() != 0.
        || root.width > 4096.
        || root.height > 4096.
        || root.width * root.height > 1_048_576.
    {
        return Err(bad("invalid root canvas or output budget"));
    }
    for (id, n) in &s.nodes {
        if *id != n.id
            || *id == 0
            || *id >= s.next_id
            || n.name.len() > 512
            || n.name.chars().any(char::is_control)
            || ![n.x, n.y].iter().all(|v| v.is_finite() && v.abs() <= 1e6)
            || ![n.width, n.height]
                .iter()
                .all(|v| v.is_finite() && *v > 0. && *v <= 1e7)
        {
            return Err(bad("invalid node identity or geometry"));
        }
        // Frames and components own children/layout; every other kind is a
        // leaf. Instances materialize their subtree only at read time.
        if !matches!(n.kind, Kind::Frame | Kind::Component)
            && (!n.children.is_empty() || n.layout.is_some())
        {
            return Err(bad("only frames and components own children or layout"));
        }
        match (&n.kind, &n.text) {
            (Kind::Text, Some(t)) if t.valid() => {}
            (Kind::Text, _) => return Err(bad("text node requires a valid text style")),
            (_, Some(_)) => return Err(bad("text style requires a text node")),
            _ => {}
        }
        match (&n.kind, &n.instance) {
            (Kind::Instance, Some(_)) => {}
            (Kind::Instance, None) => {
                return Err(bad("instance node requires an instance spec"));
            }
            (_, Some(_)) => return Err(bad("instance spec requires an instance node")),
            _ => {}
        }
        if !n.variants.is_empty() && n.kind != Kind::Component {
            return Err(bad("variants require a component node"));
        }
        // Instances are fixed-sizing only: hug/fill on the materialized
        // root is deferred, so non-fixed sizing rejects on mutation and on
        // hostile restore alike.
        if n.kind == Kind::Instance && !n.sizing.is_fixed() {
            return Err(bad("instance sizing must be fixed"));
        }
        if let Some(l) = &n.layout {
            if ![
                l.gap,
                l.padding_top,
                l.padding_right,
                l.padding_bottom,
                l.padding_left,
            ]
            .iter()
            .all(|v| v.is_finite() && *v >= 0. && *v <= 100000.)
            {
                return Err(bad("invalid layout or empty content box"));
            }
        }
    }
    let mut visited = BTreeSet::new();
    let mut parents = BTreeMap::new();
    let mut pending = vec![(1, 0usize)];
    while let Some((id, depth)) = pending.pop() {
        if depth > 64 || !visited.insert(id) {
            return Err(bad("cycle, duplicate parent or tree depth exceeded"));
        }
        let n = s.nodes.get(&id).ok_or_else(|| bad("unknown child"))?;
        for child in &n.children {
            parents.insert(*child, id);
            pending.push((*child, depth + 1));
        }
    }
    if visited.len() != s.nodes.len() {
        return Err(bad("unreachable node"));
    }
    // Component/instance state: variant names, override targets and values,
    // instance references and the component-reference graph are validated
    // together so hostile restores cannot strand overrides or create
    // unbounded expansion cycles.
    let mut variant_names: BTreeMap<u64, BTreeSet<String>> = BTreeMap::new();
    for (id, n) in &s.nodes {
        if n.kind != Kind::Component {
            continue;
        }
        let mut names = BTreeSet::new();
        if n.variants.len() > MAX_VARIANTS {
            return Err(bad("variant budget exceeded"));
        }
        for v in &n.variants {
            if !valid_symbol_name(&v.name) || !names.insert(v.name.clone()) {
                return Err(bad("invalid or duplicate component variant"));
            }
            validate_override_set(s, &v.properties, *id, &parents)?;
        }
        variant_names.insert(*id, names);
    }
    let mut edges: BTreeMap<u64, BTreeSet<u64>> = BTreeMap::new();
    for (id, n) in &s.nodes {
        let Some(spec) = &n.instance else {
            continue;
        };
        let comp = s
            .nodes
            .get(&spec.component)
            .ok_or_else(|| bad("instance references unknown component"))?;
        if comp.kind != Kind::Component {
            return Err(bad("instance target is not a component"));
        }
        if let Some(var) = &spec.variant {
            if !valid_symbol_name(var) {
                return Err(bad("invalid instance variant name"));
            }
            let known = variant_names
                .get(&spec.component)
                .is_some_and(|names| names.contains(var));
            if !known {
                return Err(bad("instance variant does not exist on component"));
            }
        }
        validate_override_set(s, &spec.overrides, spec.component, &parents)?;
        // Edge from the nearest enclosing component to the referenced
        // component; canvas-level instances create no edge.
        let mut cursor = parents.get(id).copied();
        while let Some(p) = cursor {
            if s.nodes[&p].kind == Kind::Component {
                edges.entry(p).or_default().insert(spec.component);
                break;
            }
            cursor = parents.get(&p).copied();
        }
    }
    // Containment edges: expansion clones a component's whole descendant
    // subtree, including any nested component definitions and the instances
    // inside them. An ancestor→descendant edge therefore joins the same
    // acyclicity check — without it, component-in-component nesting plus a
    // back reference is admitted and only fails reads at the depth cap.
    for (id, n) in &s.nodes {
        if n.kind != Kind::Component {
            continue;
        }
        for desc in s.subtree(*id).into_iter().skip(1) {
            if s.nodes[&desc].kind == Kind::Component {
                edges.entry(*id).or_default().insert(desc);
            }
        }
    }
    // Kahn topological check: any leftover component means a reference
    // cycle, which would make read-time expansion unbounded.
    {
        let mut all: BTreeSet<u64> = edges.keys().copied().collect();
        for targets in edges.values() {
            all.extend(targets.iter().copied());
        }
        let mut indegree: BTreeMap<u64, usize> = all.iter().map(|id| (*id, 0)).collect();
        for targets in edges.values() {
            for t in targets {
                *indegree.get_mut(t).unwrap() += 1;
            }
        }
        let mut queue: Vec<u64> = indegree
            .iter()
            .filter(|(_, d)| **d == 0)
            .map(|(id, _)| *id)
            .collect();
        let mut removed = 0usize;
        while let Some(id) = queue.pop() {
            removed += 1;
            if let Some(targets) = edges.get(&id) {
                for t in targets {
                    let d = indegree.get_mut(t).unwrap();
                    *d -= 1;
                    if *d == 0 {
                        queue.push(*t);
                    }
                }
            }
        }
        if removed != all.len() {
            return Err(bad("component instance references form a cycle"));
        }
    }
    // Constraint state is durable on absolute children only. Flow children
    // get positions from their parent's layout, the root has no parent
    // frame, `scale` is deferred solver work, and `relative_to` is bounded
    // to the parent frame or a sibling until wider targets land. The
    // layout pass solves admitted constraints; this validation only gates
    // what may be stored.
    for (id, n) in &s.nodes {
        let Some(c) = &n.constraints else {
            continue;
        };
        if *id == 1 {
            return Err(bad("root cannot carry constraints"));
        }
        let Some(&parent) = parents.get(id) else {
            return Err(bad("constraints require a parent frame"));
        };
        if s.nodes[&parent].layout.is_some() {
            return Err(bad(
                "constraints require absolute placement; parent uses flow layout",
            ));
        }
        if c.horizontal == HorizontalAnchor::Scale || c.vertical == VerticalAnchor::Scale {
            return Err(bad("scale constraint anchoring is not supported"));
        }
        // C2 extent bounds: each present bound is finite within
        // 0..=MAX_CONSTRAINT_EXTENT and a present min never exceeds a
        // present max on the same axis.
        for (lo, hi) in [
            (c.min_width, c.max_width),
            (c.min_height, c.max_height),
        ] {
            if [lo, hi].into_iter().flatten().any(|v| {
                !v.is_finite() || v < 0. || v > MAX_CONSTRAINT_EXTENT
            }) {
                return Err(bad("constraint size bounds must be finite within 0..1e7"));
            }
            if let (Some(lo), Some(hi)) = (lo, hi) {
                if lo > hi {
                    return Err(bad("constraint minimum exceeds maximum"));
                }
            }
        }
        // C2 relative targets: the parent frame or a sibling sharing that
        // parent, never the node itself. Every non-root node appears in
        // `parents`, so ids outside the tree cannot resolve; the root only
        // resolves when it is the parent. Grandparents, descendants and
        // nodes under other parents stay deferred.
        if let Some(r) = c.relative_to {
            let resolves =
                r != *id && (r == parent || parents.get(&r) == Some(&parent));
            if !resolves {
                return Err(bad(
                    "constraint relative_to must name the parent frame or a sibling",
                ));
            }
        }
    }
    validate_variables(s)?;
    validate_prototype(s)?;
    validate_comments(s)?;
    if serde_json::to_vec(s)?.len() > MAX_BYTES {
        return Err(bad("design encoded state exceeds 8 MiB"));
    }
    Ok(())
}
