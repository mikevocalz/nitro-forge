//! Bounded scalar value node graph (slice I): a document-global DAG of f64
//! nodes evaluated once per composition context per frame. Nodes compute
//! numbers only — no pixels, no multi-type outputs, no clock, no I/O. A
//! `binding` attaches one node's `out` to a `(layer, property)` cell and is
//! mutually exclusive with that property's curve and slice-D expression
//! (last write wins, atomic clear). `property` source nodes read the
//! PRE-BINDING curve/base value — never an expression result and never a
//! graph-bound value — which makes graph evaluation acyclic across the
//! layer boundary by construction. Topo order is Kahn's algorithm with
//! ascending-id ties, so evaluation is a flat iterative pass: no recursion
//! anywhere in this module, matching the iterative-walk rule the slice-D
//! review enforced on expression dependency walks.
use crate::{expressions, Property, SAFE_ID};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Stored graph: nodes plus the bindings that attach node outputs to layer
/// properties. Rides `State` as additive serde-defaulted state — schema
/// stays 2 and graph-free documents serialize byte-identically.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Graph {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<GraphNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bindings: Vec<Binding>,
    /// Monotonic node-id counter, same discipline as layer/key/comp ids.
    /// Absent in a hostile `graph` payload defaults to 1, which rejects any
    /// supplied node id — fail closed.
    #[serde(default = "default_next_node_id", skip_serializing_if = "is_one_u64")]
    pub next_node_id: u64,
}
fn default_next_node_id() -> u64 {
    1
}
fn is_one_u64(v: &u64) -> bool {
    *v == 1
}
impl Default for Graph {
    fn default() -> Self {
        Self {
            nodes: vec![],
            bindings: vec![],
            next_node_id: 1,
        }
    }
}
impl Graph {
    /// True when the graph carries no state at all; `State` skips
    /// serializing it so graph-free documents stay byte-identical. A
    /// cleared-but-formerly-used graph keeps its `next_node_id` and
    /// therefore still serializes the counter.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// One graph node: a closed-kind f64 function with a fixed per-kind input
/// pin set. Every declared pin must be present exactly once in `inputs`,
/// valued as an edge ref (`{"node":id}`) or a const literal
/// (`{"const":f64}`). Every node has exactly one output pin `out`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GraphNode {
    pub id: u64,
    pub kind: NodeKind,
    /// Per-kind non-input constants only (`const` value, `property`
    /// layer/property); absent elsewhere. Bounded by the fixed three-field
    /// shape — far under the spec's ≤8 params per node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<NodeParams>,
    pub inputs: BTreeMap<String, EdgeRef>,
}

/// Closed node-kind enum (spec table): six sources, unary/binary math,
/// comparisons, and the three-pin `clamp`/`lerp`/`smoothstep`/`select`
/// set. Wire names are the lowercase kind strings.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum NodeKind {
    // Sources (0 input pins).
    Const,
    Time,
    Frame,
    Fps,
    Duration,
    Property,
    // Unary math (pin `in`).
    Neg,
    Not,
    Abs,
    Floor,
    Ceil,
    Round,
    Trunc,
    Sign,
    Sqrt,
    Cbrt,
    Exp,
    Ln,
    Log10,
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
    // Binary math, logic and comparisons (pins `a`,`b`).
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Min,
    Max,
    Pow,
    Atan2,
    Hypot,
    And,
    Or,
    Eq,
    Neq,
    Lt,
    Lte,
    Gt,
    Gte,
    // Three-pin shapes.
    Clamp,
    Lerp,
    Smoothstep,
    Select,
}
impl NodeKind {
    /// The exact input pin set this kind declares; `inputs` must match it
    /// key-for-key. Sources declare none.
    pub fn pins(self) -> &'static [&'static str] {
        match self {
            Self::Const
            | Self::Time
            | Self::Frame
            | Self::Fps
            | Self::Duration
            | Self::Property => &[],
            Self::Neg
            | Self::Not
            | Self::Abs
            | Self::Floor
            | Self::Ceil
            | Self::Round
            | Self::Trunc
            | Self::Sign
            | Self::Sqrt
            | Self::Cbrt
            | Self::Exp
            | Self::Ln
            | Self::Log10
            | Self::Sin
            | Self::Cos
            | Self::Tan
            | Self::Asin
            | Self::Acos
            | Self::Atan => &["in"],
            Self::Add
            | Self::Sub
            | Self::Mul
            | Self::Div
            | Self::Mod
            | Self::Min
            | Self::Max
            | Self::Pow
            | Self::Atan2
            | Self::Hypot
            | Self::And
            | Self::Or
            | Self::Eq
            | Self::Neq
            | Self::Lt
            | Self::Lte
            | Self::Gt
            | Self::Gte => &["a", "b"],
            Self::Clamp => &["v", "lo", "hi"],
            Self::Lerp => &["a", "b", "t"],
            Self::Smoothstep => &["e0", "e1", "x"],
            Self::Select => &["cond", "a", "b"],
        }
    }
}

/// Non-input constants. `const` nodes carry `value`; `property` nodes carry
/// `layer` + `property`. Every other kind must leave `params` absent.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NodeParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property: Option<Property>,
}

/// One input pin value: either a reference to another node's `out` or a
/// const literal. Untagged wire shapes `{"node":id}` / `{"const":f64}`;
/// the inner structs deny unknown fields so mixed/extra keys reject.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum EdgeRef {
    Node(NodeRef),
    Const(ConstRef),
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NodeRef {
    pub node: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ConstRef {
    #[serde(rename = "const")]
    pub value: f64,
}

/// A binding attaches one node's `out` to a `(layer, property)` cell — the
/// graph's only route to layer state. Mutually exclusive with that
/// property's curve and slice-D expression.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Binding {
    pub layer: u64,
    pub property: Property,
    pub node: u64,
}

/// Caps from the admitted spec, all inside the existing 16 MiB state cap.
pub const MAX_NODES: usize = 512;
pub const MAX_BINDINGS: usize = 128;
pub const MAX_EDGES: usize = 2048;
/// Defensive per-table primitive-op ceiling; unreachable on validated
/// state (≤512 nodes × ≤4 pin reads ≈ 2048 ops) and saturates to 0.0.
pub const MAX_OPS: u32 = 4096;
/// `const` node param and const-pin literals stay within the shared
/// ±1e7 geometry/param bound; non-finite values reject.
const MAX_CONST: f64 = 1e7;

/// Owning-composition evaluation context for the time-family sources.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CompEnv {
    /// Seconds inside the owning composition (same mapping as curves).
    pub time: f64,
    /// `floor(time * fps)` of the owning composition.
    pub frame: f64,
    /// Rational frame rate `num/den` as f64.
    pub fps: f64,
    /// Owning composition `duration_s`.
    pub duration: f64,
}

/// Kahn topo sort over input edges with ascending-node-id ties — a total
/// order, platform-stable. Returns the processed prefix; on a cycle the
/// unprocessed remainder is simply absent, and evaluation resolves those
/// nodes (and everything downstream of them) to 0.0 rather than looping.
/// `validate` rejects cycles before this ever runs on admitted state.
pub(crate) fn topo_order(nodes: &[GraphNode]) -> Vec<u64> {
    let ids: BTreeSet<u64> = nodes.iter().map(|n| n.id).collect();
    // Adjacency: dependency -> dependents, plus per-node indegree.
    let mut indegree: BTreeMap<u64, usize> = BTreeMap::new();
    let mut dependents: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    for n in nodes {
        indegree.insert(n.id, 0);
    }
    for n in nodes {
        for edge in n.inputs.values() {
            if let EdgeRef::Node(r) = edge {
                if ids.contains(&r.node) {
                    *indegree.get_mut(&n.id).unwrap() += 1;
                    dependents.entry(r.node).or_default().push(n.id);
                }
            }
        }
    }
    // Ready set keyed by id gives the ascending-id tie-break for free.
    let mut ready: BTreeSet<u64> = indegree
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(&id, _)| id)
        .collect();
    let mut order = Vec::with_capacity(nodes.len());
    while let Some(&id) = ready.iter().next() {
        ready.remove(&id);
        order.push(id);
        if let Some(list) = dependents.get(&id) {
            for &dep in list {
                let d = indegree.get_mut(&dep).unwrap();
                *d -= 1;
                if *d == 0 {
                    ready.insert(dep);
                }
            }
        }
    }
    order
}

/// Structural validation of the graph alone (caps, ids, kind/pin/param
/// shape, edge targets, acyclicity, binding shape). Layer/property
/// referential checks live in `State::validate`, which owns layer access.
pub(crate) fn validate_structure(g: &Graph) -> Result<(), &'static str> {
    if g.next_node_id == 0 || g.next_node_id > SAFE_ID {
        return Err("invalid graph node id counter");
    }
    if g.nodes.len() > MAX_NODES {
        return Err("graph node budget exceeded");
    }
    if g.bindings.len() > MAX_BINDINGS {
        return Err("graph binding budget exceeded");
    }
    let mut ids = BTreeSet::new();
    let mut edges = 0usize;
    for n in &g.nodes {
        if n.id == 0 || n.id >= g.next_node_id || !ids.insert(n.id) {
            return Err("invalid graph node identity");
        }
        let pins: BTreeSet<&str> = n.inputs.keys().map(String::as_str).collect();
        let declared: BTreeSet<&str> = n.kind.pins().iter().copied().collect();
        if pins != declared {
            return Err("graph node input pins do not match kind");
        }
        edges += n.inputs.len();
        for edge in n.inputs.values() {
            match edge {
                EdgeRef::Node(r) => {
                    if r.node == 0 {
                        return Err("invalid graph edge target");
                    }
                }
                EdgeRef::Const(c) => {
                    if !c.value.is_finite() {
                        return Err("non-finite graph const input");
                    }
                }
            }
        }
        match (n.kind, n.params) {
            (NodeKind::Const, Some(p)) => {
                let v = p.value.ok_or("const node requires params.value")?;
                if !v.is_finite() || v.abs() > MAX_CONST {
                    return Err("invalid const node value");
                }
                if p.layer.is_some() || p.property.is_some() {
                    return Err("const node params mismatch");
                }
            }
            (NodeKind::Property, Some(p)) => {
                if p.layer.is_none() || p.property.is_none() || p.value.is_some() {
                    return Err("property node requires layer and property params");
                }
            }
            (NodeKind::Const | NodeKind::Property, None) => {
                return Err("graph node requires params");
            }
            (_, None) => {}
            (_, Some(_)) => return Err("graph node params not admitted for kind"),
        }
    }
    if edges > MAX_EDGES {
        return Err("graph edge budget exceeded");
    }
    // Every edge target must name an existing node.
    for n in &g.nodes {
        for edge in n.inputs.values() {
            if let EdgeRef::Node(r) = edge {
                if !ids.contains(&r.node) {
                    return Err("graph edge references unknown node");
                }
            }
        }
    }
    if topo_order(&g.nodes).len() != g.nodes.len() {
        return Err("cyclic graph");
    }
    let mut cells = BTreeSet::new();
    for b in &g.bindings {
        if !cells.insert((b.layer, b.property)) {
            return Err("duplicate graph binding");
        }
        if !ids.contains(&b.node) {
            return Err("graph binding references unknown node");
        }
    }
    Ok(())
}

/// Evaluate one node kind. `get(pin)` supplies resolved f64 inputs (the
/// caller has already substituted edge values and const literals);
/// `prop(layer, property)` supplies pre-binding property reads for the
/// `property` source kind. Non-finite values propagate IEEE-style and
/// sanitize only at binding consumers, identical to slice D.
pub(crate) fn eval_kind(
    kind: NodeKind,
    params: Option<NodeParams>,
    get: &dyn Fn(&str) -> f64,
    env: &CompEnv,
    prop: &mut dyn FnMut(u64, Property) -> f64,
) -> f64 {
    match kind {
        NodeKind::Const => params.and_then(|p| p.value).unwrap_or(f64::NAN),
        NodeKind::Time => env.time,
        NodeKind::Frame => env.frame,
        NodeKind::Fps => env.fps,
        NodeKind::Duration => env.duration,
        NodeKind::Property => match params.and_then(|p| p.layer.zip(p.property)) {
            Some((layer, property)) => prop(layer, property),
            None => f64::NAN,
        },
        NodeKind::Neg => -get("in"),
        NodeKind::Not => {
            // Truthiness is `v != 0.0` (IEEE: NaN is truthy), matching &&/||.
            if get("in") != 0. {
                0.
            } else {
                1.
            }
        }
        NodeKind::Abs => get("in").abs(),
        NodeKind::Floor => get("in").floor(),
        NodeKind::Ceil => get("in").ceil(),
        NodeKind::Round => get("in").round(),
        NodeKind::Trunc => get("in").trunc(),
        NodeKind::Sign => {
            let v = get("in");
            if v.is_nan() {
                f64::NAN
            } else if v > 0. {
                1.
            } else if v < 0. {
                -1.
            } else {
                0.
            }
        }
        NodeKind::Sqrt => get("in").sqrt(),
        NodeKind::Cbrt => get("in").cbrt(),
        NodeKind::Exp => get("in").exp(),
        NodeKind::Ln => get("in").ln(),
        NodeKind::Log10 => get("in").log10(),
        NodeKind::Sin => get("in").sin(),
        NodeKind::Cos => get("in").cos(),
        NodeKind::Tan => get("in").tan(),
        NodeKind::Asin => get("in").asin(),
        NodeKind::Acos => get("in").acos(),
        NodeKind::Atan => get("in").atan(),
        NodeKind::Add => get("a") + get("b"),
        NodeKind::Sub => get("a") - get("b"),
        NodeKind::Mul => get("a") * get("b"),
        NodeKind::Div => get("a") / get("b"),
        // Same remainder as the expression grammar's `%` (Rust `%`).
        NodeKind::Mod => get("a") % get("b"),
        // NaN-propagating min/max like the expression helpers.
        NodeKind::Min => expressions::fmin(get("a"), get("b")),
        NodeKind::Max => expressions::fmax(get("a"), get("b")),
        NodeKind::Pow => get("a").powf(get("b")),
        NodeKind::Atan2 => get("a").atan2(get("b")),
        NodeKind::Hypot => get("a").hypot(get("b")),
        NodeKind::Clamp => expressions::fclamp(get("v"), get("lo"), get("hi")),
        NodeKind::Lerp => {
            let (a, b, t) = (get("a"), get("b"), get("t"));
            a + (b - a) * t
        }
        NodeKind::Smoothstep => {
            let t = expressions::fclamp(
                (get("x") - get("e0")) / (get("e1") - get("e0")),
                0.,
                1.,
            );
            t * t * (3. - 2. * t)
        }
        NodeKind::Select => {
            // Spec: cond >= 0.5 selects `a`, otherwise `b`.
            if get("cond") >= 0.5 {
                get("a")
            } else {
                get("b")
            }
        }
        NodeKind::And => {
            if get("a") != 0. && get("b") != 0. {
                1.
            } else {
                0.
            }
        }
        NodeKind::Or => {
            if get("a") != 0. || get("b") != 0. {
                1.
            } else {
                0.
            }
        }
        NodeKind::Eq => (get("a") == get("b")) as u8 as f64,
        NodeKind::Neq => (get("a") != get("b")) as u8 as f64,
        NodeKind::Lt => (get("a") < get("b")) as u8 as f64,
        NodeKind::Lte => (get("a") <= get("b")) as u8 as f64,
        NodeKind::Gt => (get("a") > get("b")) as u8 as f64,
        NodeKind::Gte => (get("a") >= get("b")) as u8 as f64,
    }
}
