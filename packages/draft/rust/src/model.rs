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
    #[serde(default, skip_serializing_if = "is_zero")]
    pub layer: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Circle {
    pub id: u64,
    pub center: u64,
    pub radius: f64,
    pub name: String,
    pub color: [u8; 4],
    pub width: f64,
    pub visible: bool,
    pub locked: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub layer: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArcEntity {
    pub id: u64,
    pub center: u64,
    pub radius: f64,
    pub start_deg: f64,
    pub sweep_deg: f64,
    pub name: String,
    pub color: [u8; 4],
    pub width: f64,
    pub visible: bool,
    pub locked: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub layer: u64,
}
fn is_false(value: &bool) -> bool {
    !*value
}
fn is_zero(value: &u64) -> bool {
    *value == 0
}
/// Named visibility/lock grouping for entities. Layer id 0 is implicit and
/// reserved: it is never stored in `State::layers`, cannot be added, renamed,
/// removed, hidden or locked, and is the default for legacy state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layer {
    pub id: u64,
    pub name: String,
    pub color: Option<[u8; 4]>,
    pub visible: bool,
    pub locked: bool,
}
pub const MAX_LAYERS: usize = 128;
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
    #[serde(default)]
    pub ortho: bool,
    #[serde(default)]
    pub polar: bool,
    #[serde(default = "default_polar_increment")]
    pub polar_increment: f64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub center: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub nearest_circle: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub tangent: bool,
}
fn default_polar_increment() -> f64 {
    45.
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
            ortho: false,
            polar: false,
            polar_increment: default_polar_increment(),
            center: false,
            nearest_circle: false,
            tangent: false,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub circles: BTreeMap<u64, Arc<Circle>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub arcs: BTreeMap<u64, Arc<ArcEntity>>,
    pub order: Vec<u64>,
    pub constraints: BTreeMap<u64, Arc<Constraint>>,
    pub snaps: SnapSettings,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub layers: BTreeMap<u64, Arc<Layer>>,
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
            circles: BTreeMap::new(),
            arcs: BTreeMap::new(),
            order: vec![],
            constraints: BTreeMap::new(),
            snaps: SnapSettings::default(),
            layers: BTreeMap::new(),
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
    /// Implicit layer 0 is always visible and unlocked; unknown nonzero ids
    /// fail closed (hidden/locked) though validation rejects them anyway.
    pub fn layer_visible(&self, id: u64) -> bool {
        self.layers.get(&id).map_or(id == 0, |l| l.visible)
    }
    pub fn layer_locked(&self, id: u64) -> bool {
        self.layers.get(&id).map_or(id != 0, |l| l.locked)
    }
    pub fn point_fixed(&self, id: u64) -> bool {
        self.circles
            .values()
            .any(|c| (c.locked || self.layer_locked(c.layer)) && c.center == id)
            || self
                .arcs
                .values()
                .any(|a| (a.locked || self.layer_locked(a.layer)) && a.center == id)
            || self.points.get(&id).is_some_and(|p| p.locked)
            || self.segments.values().any(|s| {
                (s.locked || self.layer_locked(s.layer)) && (s.a == id || s.b == id)
            })
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
    fn validate_circle(
        &self,
        key: u64,
        id: u64,
        center: u64,
        radius: f64,
        width: f64,
        name: &str,
        layer: u64,
        ids: &mut BTreeSet<u64>,
    ) -> Result<(), EngineError> {
        let p = self.point(center)?;
        if key != id
            || id == 0
            || id >= self.next_id
            || !ids.insert(id)
            || name.len() > 512
            || !(layer == 0 || self.layers.contains_key(&layer))
            || !radius.is_finite()
            || !(1e-6..=LIMIT).contains(&radius)
            || ![p.x - radius, p.x + radius, p.y - radius, p.y + radius]
                .iter()
                .all(|v| coord(*v))
            || !width.is_finite()
            || !(1e-6..=1000.).contains(&width)
        {
            return Err(bad(
                "invalid circular entity identity, center, radius, extent or style",
            ));
        }
        Ok(())
    }
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.kind != "draft"
            || self.schema != 1
            || !["mm", "cm", "m", "in"].contains(&self.units.as_str())
            || self.next_id == 0
            || self.next_id > SAFE_ID
            || self.points.len() > 64
            || self.segments.len() + self.circles.len() + self.arcs.len() > 128
            || self.circles.len() > 64
            || self.arcs.len() > 64
            || self.constraints.len() > 128
            || self.layers.len() > MAX_LAYERS
        {
            return Err(bad("invalid draft header or count budget"));
        }
        let mut ids = BTreeSet::new();
        let mut layer_names = BTreeSet::new();
        for (&id, l) in &self.layers {
            if id != l.id
                || id == 0
                || id >= self.next_id
                || !ids.insert(id)
                || l.name.is_empty()
                || l.name == "0"
                || l.name.len() > 512
                || !layer_names.insert(l.name.as_str())
            {
                return Err(bad("invalid layer identity, name or budget"));
            }
        }
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
                || !(s.layer == 0 || self.layers.contains_key(&s.layer))
                || !s.width.is_finite()
                || s.width < 1e-6
                || s.width > 1000.
            {
                return Err(bad("invalid segment"));
            }
            self.point(s.a)?;
            self.point(s.b)?;
        }
        for (&id, c) in &self.circles {
            self.validate_circle(
                id,
                c.id,
                c.center,
                c.radius,
                c.width,
                &c.name,
                c.layer,
                &mut ids,
            )?;
        }
        for (&id, a) in &self.arcs {
            self.validate_circle(
                id,
                a.id,
                a.center,
                a.radius,
                a.width,
                &a.name,
                a.layer,
                &mut ids,
            )?;
            if !a.start_deg.is_finite()
                || a.start_deg.abs() > 360000.
                || !a.sweep_deg.is_finite()
                || a.sweep_deg.abs() < 1e-6
                || a.sweep_deg.abs() > 360.
            {
                return Err(bad("invalid directed arc angles"));
            }
            let p = self.point(a.center)?;
            let start = a.start_deg.rem_euclid(360.).to_radians();
            let end = (a.start_deg + a.sweep_deg).rem_euclid(360.).to_radians();
            if a.sweep_deg.abs() < 360.
                && (p.x + a.radius * start.cos(), p.y + a.radius * start.sin())
                    == (p.x + a.radius * end.cos(), p.y + a.radius * end.sin())
            {
                return Err(bad("arc endpoints indistinguishable at world precision"));
            }
        }
        let entities: BTreeSet<u64> = self
            .segments
            .keys()
            .chain(self.circles.keys())
            .chain(self.arcs.keys())
            .copied()
            .collect();
        if self.order.len() != entities.len()
            || self.order.iter().copied().collect::<BTreeSet<_>>() != entities
        {
            return Err(bad("entity order must be an exact permutation"));
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
        if !s.polar_increment.is_finite()
            || !(0.01..=360.).contains(&s.polar_increment)
            || !s.spacing.is_finite()
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
