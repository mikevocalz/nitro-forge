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
/// Upper magnitude admitted for C2 constraint extent bounds (min/max
/// width/height), matching the node geometry size bound.
pub const MAX_CONSTRAINT_EXTENT: f64 = 1e7;
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
/// `relative_to` targets. All of it is still storage + validation: no solver
/// reads these fields, `evaluateLayout` ignores them, and `scale` anchors
/// remain rejected. `relative_to` maps NYC-Tron `relativeToId` to the
/// engine's numeric node id; absent means the parent frame.
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
        n.kind == Kind::Text || n.text.is_some() || n.constraints.is_some()
    })
        || !s.variables.is_empty()
        || !s.modes.is_empty()
        || s.active_mode.is_some()
        || !s.bindings.is_empty()
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
        if n.kind != Kind::Frame && (!n.children.is_empty() || n.layout.is_some()) {
            return Err(bad("only frames own children or layout"));
        }
        match (&n.kind, &n.text) {
            (Kind::Text, Some(t)) if t.valid() => {}
            (Kind::Text, _) => return Err(bad("text node requires a valid text style")),
            (_, Some(_)) => return Err(bad("text style requires a text node")),
            _ => {}
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
    // Constraint state is durable on absolute children only. Flow children
    // get positions from their parent's layout, the root has no parent
    // frame, `scale` is deferred solver work, and `relative_to` is bounded
    // to the parent frame or a sibling until wider targets land.
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
    if serde_json::to_vec(s)?.len() > MAX_BYTES {
        return Err(bad("design encoded state exceeds 8 MiB"));
    }
    Ok(())
}
