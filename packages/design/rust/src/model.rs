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
}
impl Default for State {
    fn default() -> Self {
        Self {
            kind: "design".into(),
            schema: 1,
            title: "Untitled".into(),
            next_id: 2,
            nodes: BTreeMap::from([(1, Arc::new(Node::frame(1, 640., 360.)))]),
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
/// Schema-2 features (currently text nodes) require the versioned snapshot
/// wrapper so schema:1 documents stay byte-identical and old readers fail
/// closed on the unknown `kind:"text"` node variant or `text` field.
pub fn requires_wrapper(s: &State) -> bool {
    s.nodes
        .values()
        .any(|n| n.kind == Kind::Text || n.text.is_some())
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
    let mut pending = vec![(1, 0usize)];
    while let Some((id, depth)) = pending.pop() {
        if depth > 64 || !visited.insert(id) {
            return Err(bad("cycle, duplicate parent or tree depth exceeded"));
        }
        let n = s.nodes.get(&id).ok_or_else(|| bad("unknown child"))?;
        for child in &n.children {
            pending.push((*child, depth + 1));
        }
    }
    if visited.len() != s.nodes.len() {
        return Err(bad("unreachable node"));
    }
    if serde_json::to_vec(s)?.len() > MAX_BYTES {
        return Err(bad("design encoded state exceeds 8 MiB"));
    }
    Ok(())
}
