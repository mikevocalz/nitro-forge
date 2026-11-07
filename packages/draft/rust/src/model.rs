use ignition_core::EngineError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
pub const LIMIT: f64 = 1e6;
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
pub const SAFE_ID: u64 = 9_007_199_254_740_991;
pub fn bad(s: &str) -> EngineError {
    EngineError::validation(s)
}
pub fn coord(n: f64) -> bool {
    n.is_finite() && n.abs() <= LIMIT
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub id: u64,
    pub x: f64,
    pub y: f64,
    pub locked: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    pub id: u64,
    pub a: u64,
    pub b: u64,
    pub name: String,
    pub color: [u8; 4],
    pub width: f64,
    pub visible: bool,
    pub locked: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Definition {
    Fixed { point: u64, x: f64, y: f64 },
    Coincident { a: u64, b: u64 },
    Horizontal { segment: u64 },
    Vertical { segment: u64 },
    DistanceX { a: u64, b: u64, value: f64 },
    DistanceY { a: u64, b: u64, value: f64 },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Constraint {
    pub id: u64,
    pub enabled: bool,
    pub definition: Definition,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapSettings {
    pub grid: bool,
    pub spacing: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub endpoint: bool,
    pub midpoint: bool,
    pub projection: bool,
    pub intersection: bool,
}
impl Default for SnapSettings {
    fn default() -> Self {
        Self {
            grid: true,
            spacing: 10.,
            origin_x: 0.,
            origin_y: 0.,
            endpoint: true,
            midpoint: true,
            projection: true,
            intersection: true,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub kind: String,
    pub schema: u32,
    pub units: String,
    pub next_id: u64,
    pub points: BTreeMap<u64, Arc<Point>>,
    pub segments: BTreeMap<u64, Arc<Segment>>,
    pub order: Vec<u64>,
    pub constraints: BTreeMap<u64, Arc<Constraint>>,
    pub snaps: SnapSettings,
}
impl Default for State {
    fn default() -> Self {
        Self {
            kind: "draft".into(),
            schema: 1,
            units: "mm".into(),
            next_id: 1,
            points: BTreeMap::new(),
            segments: BTreeMap::new(),
            order: vec![],
            constraints: BTreeMap::new(),
            snaps: SnapSettings::default(),
        }
    }
}
impl State {
    pub fn allocate(&mut self) -> Result<u64, EngineError> {
        let id = self.next_id;
        self.next_id = id
            .checked_add(1)
            .filter(|v| *v <= SAFE_ID)
            .ok_or_else(|| bad("identity budget exhausted"))?;
        Ok(id)
    }
    pub fn point(&self, id: u64) -> Result<&Point, EngineError> {
        self.points
            .get(&id)
            .map(AsRef::as_ref)
            .ok_or_else(|| bad("unknown point"))
    }
    pub fn segment(&self, id: u64) -> Result<&Segment, EngineError> {
        self.segments
            .get(&id)
            .map(AsRef::as_ref)
            .ok_or_else(|| bad("unknown segment"))
    }
    pub fn point_fixed(&self, id: u64) -> bool {
        self.points.get(&id).is_some_and(|p| p.locked)
            || self
                .segments
                .values()
                .any(|s| s.locked && (s.a == id || s.b == id))
    }
    pub fn definition_points(&self, d: &Definition) -> Result<Vec<u64>, EngineError> {
        Ok(match *d {
            Definition::Fixed { point, .. } => vec![point],
            Definition::Coincident { a, b }
            | Definition::DistanceX { a, b, .. }
            | Definition::DistanceY { a, b, .. } => vec![a, b],
            Definition::Horizontal { segment } | Definition::Vertical { segment } => {
                let s = self.segment(segment)?;
                vec![s.a, s.b]
            }
        })
    }
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.kind != "draft"
            || self.schema != 1
            || !["mm", "cm", "m", "in"].contains(&self.units.as_str())
            || self.next_id == 0
            || self.next_id > SAFE_ID
            || self.points.len() > 64
            || self.segments.len() > 128
            || self.constraints.len() > 128
        {
            return Err(bad("invalid draft header or count budget"));
        }
        let mut ids = BTreeSet::new();
        for (&id, p) in &self.points {
            if id != p.id
                || id == 0
                || id >= self.next_id
                || !ids.insert(id)
                || !coord(p.x)
                || !coord(p.y)
            {
                return Err(bad("invalid point"));
            }
        }
        for (&id, s) in &self.segments {
            if id != s.id
                || id == 0
                || id >= self.next_id
                || !ids.insert(id)
                || s.a == s.b
                || s.name.len() > 512
                || !s.width.is_finite()
                || s.width < 1e-6
                || s.width > 1000.
            {
                return Err(bad("invalid segment"));
            }
            self.point(s.a)?;
            self.point(s.b)?;
        }
        if self.order.len() != self.segments.len()
            || self.order.iter().copied().collect::<BTreeSet<_>>()
                != self.segments.keys().copied().collect()
        {
            return Err(bad("segment order must be an exact permutation"));
        }
        for (&id, c) in &self.constraints {
            if id != c.id || id == 0 || id >= self.next_id || !ids.insert(id) {
                return Err(bad("invalid constraint identity"));
            }
            for p in self.definition_points(&c.definition)? {
                self.point(p)?;
            }
            match c.definition {
                Definition::Fixed { x, y, .. } if !coord(x) || !coord(y) => {
                    return Err(bad("fixed coordinate outside budget"))
                }
                Definition::Coincident { a, b }
                | Definition::DistanceX { a, b, .. }
                | Definition::DistanceY { a, b, .. }
                    if a == b =>
                {
                    return Err(bad("constraint requires distinct points"))
                }
                Definition::DistanceX { value, .. } | Definition::DistanceY { value, .. }
                    if !value.is_finite() || value.abs() > 2. * LIMIT =>
                {
                    return Err(bad("signed distance outside budget"))
                }
                _ => {}
            }
        }
        let s = &self.snaps;
        if !s.spacing.is_finite()
            || s.spacing < 1e-6
            || s.spacing > LIMIT
            || !coord(s.origin_x)
            || !coord(s.origin_y)
        {
            return Err(bad("invalid snap grid"));
        }
        if serde_json::to_vec(self)?.len() > MAX_BYTES {
            return Err(bad("draft state exceeds 8 MiB"));
        }
        Ok(())
    }
}
