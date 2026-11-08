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
/// Built-in hatch patterns. `solid` fills; the line patterns are bounded
/// families of parallel world-space strokes rotated by `angle` and spaced by
/// `3.0 * scale` world units (`ansi31` = 45°, `crosshatch` = 45°+135°,
/// `horizontal` = 0°). Custom patterns are not admitted.
pub const HATCH_PATTERNS: &[&str] = &["solid", "ansi31", "crosshatch", "horizontal"];
pub const MAX_HATCHES: usize = 64;
pub const MAX_HATCH_LOOPS: usize = 8;
/// Per-loop and per-hatch sampled boundary vertex budgets.
pub const MAX_LOOP_VERTICES: usize = 2048;
pub const MAX_HATCH_VERTICES: usize = 4096;
/// A hatch fills explicit world-space boundary loops; it never references
/// points or entities, so later geometry edits cannot move it (associative
/// hatches are deferred). `loops` are sampled polygons in world units,
/// outermost first is not required — `fill_rule:"evenodd"` gives holes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hatch {
    pub id: u64,
    pub name: String,
    pub pattern: String,
    pub color: [u8; 4],
    /// Pattern rotation in degrees, added to each built-in family angle.
    pub angle: f64,
    /// Pitch multiplier on the built-in 3.0 world-unit base spacing.
    pub scale: f64,
    /// Line-pattern stroke width in world units; unused by `solid`.
    pub width: f64,
    pub visible: bool,
    pub locked: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub layer: u64,
    pub loops: Vec<Vec<[f64; 2]>>,
}
pub const MAX_DIMENSIONS: usize = 64;
/// Dimension kinds admitted in slice A3. `linear` measures the axis-aligned
/// distance between two points (`axis` selects x or y), `aligned` the direct
/// distance, `angular` the unsigned angle at a vertex between two rays,
/// `radial`/`diameter` the radius/diameter of a circle or arc entity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DimKind {
    Linear,
    Aligned,
    Angular,
    Radial,
    Diameter,
}
/// Measured axis for `linear` dimensions; absent for every other kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DimAxis {
    X,
    Y,
}
/// An associative dimension stores only authored references; measured
/// geometry is derived per read in `dimensions::measure`, never persisted.
/// References are weak: deleting a referenced point/entity orphans the
/// dimension (status `orphaned`, no measured geometry) instead of rejecting
/// the deletion, while writes require every reference to resolve. A
/// reference id that still exists under the wrong kind is malformed and
/// fails validation; an absent id is a legal orphan.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Dimension {
    pub id: u64,
    pub kind: DimKind,
    /// Point ids: 2 for linear/aligned, 3 (vertex, first, second) for
    /// angular, empty for radial/diameter which use `entity` instead.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<u64>,
    /// Circle/arc id for radial/diameter; 0 (skipped) for point kinds.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub entity: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<DimAxis>,
    pub name: String,
    pub color: [u8; 4],
    /// Stroke width in world units for the derived annotation strokes.
    pub width: f64,
    pub visible: bool,
    pub locked: bool,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub layer: u64,
}
pub const MAX_SHEETS: usize = 32;
pub const MAX_VIEWPORTS: usize = 64;
/// Paper-space sheet: a named page setup in fixed millimetres regardless of
/// the document `units` metadata (no unit conversion is implied anywhere in
/// draft). `width`/`height` are the physical sheet size; the four margins are
/// the printable-area insets measured inward from each edge. Sheet
/// coordinates have their origin at the paper's bottom-left corner with +y
/// up, in millimetres. There is no orientation field: portrait/landscape is
/// derived from `width` vs `height`, and `updateSheet` may swap them.
/// Title blocks, north arrows and other paper-space furniture are deferred.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sheet {
    pub id: u64,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub margin_top: f64,
    pub margin_right: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
}
/// Paper-space viewport: a rectangle in sheet millimetres (`x`,`y` is its
/// bottom-left corner, +y up) showing a window of model space. `center_x`/
/// `center_y` is the world point drawn at the viewport's center and `scale`
/// is paper millimetres per world unit (an AutoCAD-style viewport scale
/// denominator inverse: 0.02 shows 50 world units per paper mm). The model
/// window is clipped honestly by rendering into an offscreen scene exactly
/// the viewport's pixel size — Prism has no vector path-clip, so the clip is
/// the raster boundary, not a faked vector mask. Viewports are paper-space
/// objects: they carry no layer, reference model geometry only implicitly
/// through the shared world state, and there are no paper-space entities.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewportEntity {
    pub id: u64,
    pub sheet: u64,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub center_x: f64,
    pub center_y: f64,
    pub scale: f64,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hatches: BTreeMap<u64, Arc<Hatch>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dimensions: BTreeMap<u64, Arc<Dimension>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sheets: BTreeMap<u64, Arc<Sheet>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub viewports: BTreeMap<u64, Arc<ViewportEntity>>,
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
            hatches: BTreeMap::new(),
            dimensions: BTreeMap::new(),
            sheets: BTreeMap::new(),
            viewports: BTreeMap::new(),
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
    /// True when every authored dimension reference currently resolves:
    /// point kinds need their point ids present, radial/diameter need a
    /// circle or arc entity. Writes require this; later deletions may
    /// legitimately break it and produce `orphaned` read status.
    pub fn dimension_resolves(&self, d: &Dimension) -> bool {
        d.points.iter().all(|p| self.points.contains_key(p))
            && (d.entity == 0
                || self.circles.contains_key(&d.entity)
                || self.arcs.contains_key(&d.entity))
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
            || self.hatches.len() > MAX_HATCHES
            || self.dimensions.len() > MAX_DIMENSIONS
            || self.sheets.len() > MAX_SHEETS
            || self.viewports.len() > MAX_VIEWPORTS
        {
            return Err(bad("invalid draft header or count budget"));
        }
        let mut ids = BTreeSet::new();
        let mut layer_names = BTreeSet::new();
        let mut sheet_names = BTreeSet::new();
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
        for (&id, h) in &self.hatches {
            if id != h.id
                || id == 0
                || id >= self.next_id
                || !ids.insert(id)
                || h.name.len() > 512
                || !(h.layer == 0 || self.layers.contains_key(&h.layer))
                || !HATCH_PATTERNS.contains(&h.pattern.as_str())
                || !h.angle.is_finite()
                || h.angle.abs() > 360000.
                || !h.scale.is_finite()
                || !(1e-3..=1e3).contains(&h.scale)
                || !h.width.is_finite()
                || !(1e-6..=1000.).contains(&h.width)
                || h.loops.is_empty()
                || h.loops.len() > MAX_HATCH_LOOPS
            {
                return Err(bad("invalid hatch identity, style, pattern or budget"));
            }
            let mut vertices = 0usize;
            for boundary in &h.loops {
                if boundary.len() < 3
                    || boundary.len() > MAX_LOOP_VERTICES
                    || !boundary.iter().all(|p| coord(p[0]) && coord(p[1]))
                {
                    return Err(bad("invalid hatch boundary loop"));
                }
                vertices += boundary.len();
                if vertices > MAX_HATCH_VERTICES {
                    return Err(bad("hatch boundary vertex budget exceeded"));
                }
                // Shoelace double-area relative to the first vertex so large
                // world coordinates do not lose the area to cancellation.
                let (x0, y0) = (boundary[0][0], boundary[0][1]);
                let mut a2 = 0.;
                for i in 0..boundary.len() {
                    let p = boundary[i];
                    let q = boundary[(i + 1) % boundary.len()];
                    a2 += (p[0] - x0) * (q[1] - y0) - (q[0] - x0) * (p[1] - y0);
                }
                if a2.abs() <= 1e-12 {
                    return Err(bad("hatch boundary loop has zero area"));
                }
            }
        }
        for (&id, d) in &self.dimensions {
            if id != d.id
                || id == 0
                || id >= self.next_id
                || !ids.insert(id)
                || d.name.len() > 512
                || !(d.layer == 0 || self.layers.contains_key(&d.layer))
                || !d.width.is_finite()
                || !(1e-6..=1000.).contains(&d.width)
            {
                return Err(bad("invalid dimension identity, name, style or layer"));
            }
            let point_count = match d.kind {
                DimKind::Linear | DimKind::Aligned => 2,
                DimKind::Angular => 3,
                DimKind::Radial | DimKind::Diameter => 0,
            };
            if d.points.len() != point_count
                || d.points.iter().copied().collect::<BTreeSet<_>>().len() != d.points.len()
                || matches!(d.kind, DimKind::Linear) != d.axis.is_some()
                || (matches!(d.kind, DimKind::Radial | DimKind::Diameter) != (d.entity != 0))
            {
                return Err(bad("dimension kind/reference shape mismatch"));
            }
            // A reference may dangle (orphaned) but may never resolve to the
            // wrong identity kind: ids are unique across every collection.
            for &p in &d.points {
                if !self.points.contains_key(&p)
                    && (self.segments.contains_key(&p)
                        || self.circles.contains_key(&p)
                        || self.arcs.contains_key(&p)
                        || self.layers.contains_key(&p)
                        || self.hatches.contains_key(&p)
                        || self.constraints.contains_key(&p)
                        || self.dimensions.contains_key(&p)
                        || self.sheets.contains_key(&p)
                        || self.viewports.contains_key(&p))
                {
                    return Err(bad("dimension point reference has wrong identity kind"));
                }
            }
            if d.entity != 0
                && !self.circles.contains_key(&d.entity)
                && !self.arcs.contains_key(&d.entity)
                && (self.points.contains_key(&d.entity)
                    || self.segments.contains_key(&d.entity)
                    || self.layers.contains_key(&d.entity)
                    || self.hatches.contains_key(&d.entity)
                    || self.constraints.contains_key(&d.entity)
                    || self.dimensions.contains_key(&d.entity)
                    || self.sheets.contains_key(&d.entity)
                    || self.viewports.contains_key(&d.entity))
            {
                return Err(bad("dimension entity reference has wrong identity kind"));
            }
        }
        for (&id, sh) in &self.sheets {
            if id != sh.id
                || id == 0
                || id >= self.next_id
                || !ids.insert(id)
                || sh.name.is_empty()
                || sh.name.len() > 512
                || !sheet_names.insert(sh.name.as_str())
                || !sh.width.is_finite()
                || !(50.0..=2000.0).contains(&sh.width)
                || !sh.height.is_finite()
                || !(50.0..=2000.0).contains(&sh.height)
            {
                return Err(bad("invalid sheet identity, name or paper size"));
            }
            let margins = [
                sh.margin_top,
                sh.margin_right,
                sh.margin_bottom,
                sh.margin_left,
            ];
            if !margins
                .iter()
                .all(|m| m.is_finite() && *m >= 0.)
                || sh.margin_top + sh.margin_bottom >= sh.height
                || sh.margin_left + sh.margin_right >= sh.width
            {
                return Err(bad("invalid sheet margins"));
            }
        }
        for (&id, vp) in &self.viewports {
            if id != vp.id
                || id == 0
                || id >= self.next_id
                || !ids.insert(id)
                || vp.name.len() > 512
                || !self.sheets.contains_key(&vp.sheet)
            {
                return Err(bad("invalid viewport identity, name or sheet reference"));
            }
            let sheet = &self.sheets[&vp.sheet];
            if !vp.x.is_finite()
                || !vp.y.is_finite()
                || !vp.width.is_finite()
                || !vp.height.is_finite()
                || vp.width <= 0.
                || vp.height <= 0.
                || vp.x < 0.
                || vp.y < 0.
                || vp.x + vp.width > sheet.width
                || vp.y + vp.height > sheet.height
                || !coord(vp.center_x)
                || !coord(vp.center_y)
                || !vp.scale.is_finite()
                || !(1e-6..=1e3).contains(&vp.scale)
            {
                return Err(bad("viewport rectangle, view or scale outside bounds"));
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
