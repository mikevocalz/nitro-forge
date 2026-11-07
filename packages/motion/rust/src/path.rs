//! Bounded motion paths (slice E): a single Prism-style node subpath that
//! drives `Property::PathProgress` through the existing curve machinery.
//!
//! Node model adopted from Prism (`prism_engine::model`): each node is an
//! `x`/`y` anchor plus optional cubic handles stored as *offsets from the
//! node* — `in` leads into the node from the previous segment, `out` leaves
//! toward the next. A segment with neither handle is a straight line;
//! otherwise it is a cubic Bézier with control points `from + out` and
//! `to + in` (missing handles contribute zero offsets). `closed` connects the
//! last node back to the first, so orbit paths work; Prism's `NodeKind` is
//! an authoring hint with no evaluation meaning and is intentionally not
//! part of this wire subset, as is multi-subpath support — progress across
//! disjoint subpaths is undefined, so one `MotionPath` is exactly one
//! subpath.
//!
//! Evaluation flattens the path into a polyline of at most
//! `MAX_PATH_SAMPLES` (4096) vertices and precomputes cumulative arc lengths
//! per call, so `progress` (0..=1) selects a point at a fraction of total
//! arc length — uniform speed along the path, not along flattened segments.
//! This is an approximation: cubic segments are adaptively subdivided
//! (proportional to control-polygon length, minimum one sample per segment)
//! and the tangent reported for `auto_orient` is the containing flattened
//! edge's direction, so curvature between samples is not represented.
//! Positions are exact for handle-free polylines.
use ignition_core::EngineError;
use serde::{Deserialize, Serialize};

/// Largest accepted node count per motion path.
pub const MAX_PATH_NODES: usize = 256;
/// Largest flattened vertex count (arc-length table size) per sample.
pub const MAX_PATH_SAMPLES: usize = 4096;
/// Same coordinate bound as Prism `MAX_COORD` / Motion transform fields.
const MAX_COORD: f64 = 1e7;

fn finite(v: f64) -> bool {
    v.is_finite() && v.abs() <= MAX_COORD
}
fn is_false(v: &bool) -> bool {
    !*v
}

/// One motion-path node; wire shape mirrors Prism's `Node` minus `kind`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathNode {
    pub x: f64,
    pub y: f64,
    /// Cubic handle offset leading into this node (from the previous
    /// segment's end tangent). Serialized as `"in"` for Prism parity.
    #[serde(rename = "in", default, skip_serializing_if = "Option::is_none")]
    pub in_handle: Option<[f64; 2]>,
    /// Cubic handle offset leaving this node toward the next segment.
    /// Serialized as `"out"` for Prism parity.
    #[serde(rename = "out", default, skip_serializing_if = "Option::is_none")]
    pub out_handle: Option<[f64; 2]>,
}

/// A single-subpath motion path in the layer's transform space (the same
/// space `tx`/`ty` translate within, so transform parents move the path
/// offset with the layer). `auto_orient` adds the path tangent angle, in
/// degrees clockwise in y-down canvas space, to the layer's evaluated
/// rotation — it composes with, never replaces, rotation keys.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MotionPath {
    pub nodes: Vec<PathNode>,
    /// Connect the last node back to the first (orbit paths).
    #[serde(default, skip_serializing_if = "is_false")]
    pub closed: bool,
    /// Add the sampled tangent angle to evaluated `rotation`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub auto_orient: bool,
}

impl MotionPath {
    /// Semantic validation beyond serde: node budget and finite bounded
    /// coordinates/handles. Called by `validate` on every state check so
    /// hostile restores cannot smuggle unbounded geometry.
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.nodes.is_empty() || self.nodes.len() > MAX_PATH_NODES {
            return Err(EngineError::validation("motion path needs 1..=256 nodes"));
        }
        for n in &self.nodes {
            if !finite(n.x) || !finite(n.y) {
                return Err(EngineError::validation("path node coordinates must be finite"));
            }
            for h in [n.in_handle, n.out_handle].into_iter().flatten() {
                if !finite(h[0]) || !finite(h[1]) {
                    return Err(EngineError::validation("path handles must be finite"));
                }
            }
        }
        Ok(())
    }

    /// Total arc length of the flattened path (test/diagnostic surface).
    #[cfg(test)]
    pub fn arc_length(&self) -> f64 {
        let table = self.table();
        table.cum.last().copied().unwrap_or(0.)
    }

    /// Flattened vertex count, proving the `MAX_PATH_SAMPLES` bound holds.
    #[cfg(test)]
    pub fn sample_count(&self) -> usize {
        self.table().pts.len()
    }

    /// Sample at `progress` in 0..=1 of total arc length. Returns
    /// `(x, y, tangent_degrees)`; a degenerate zero-length path returns its
    /// first node with a zero tangent. Out-of-range progress clamps rather
    /// than failing — property bounds already guarantee 0..=1.
    pub fn sample_at(&self, progress: f64) -> Result<(f64, f64, f64), EngineError> {
        self.validate()?;
        let table = self.table();
        let Some(&first) = table.pts.first() else {
            return Ok((0., 0., 0.));
        };
        let total = table.cum.last().copied().unwrap_or(0.);
        if table.pts.len() < 2 || total <= 0. {
            return Ok((first.0, first.1, 0.));
        }
        let target = progress.clamp(0., 1.) * total;
        // Largest i with cum[i] <= target, clamped so a segment follows.
        let mut lo = 0usize;
        let mut hi = table.cum.len() - 1;
        while lo + 1 < hi {
            let mid = (lo + hi) / 2;
            if table.cum[mid] <= target {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let i = lo.min(table.pts.len() - 2);
        let seg = table.cum[i + 1] - table.cum[i];
        let t = if seg > 0. { (target - table.cum[i]) / seg } else { 0. };
        let (a, b) = (table.pts[i], table.pts[i + 1]);
        let d = (b.0 - a.0, b.1 - a.1);
        Ok((
            a.0 + d.0 * t,
            a.1 + d.1 * t,
            d.1.atan2(d.0).to_degrees(),
        ))
    }

    /// Flatten to a vertex polyline plus cumulative arc lengths, bounded by
    /// `MAX_PATH_SAMPLES`. Cubic subdivision counts are proportional to each
    /// segment's control-polygon length under one shared budget.
    fn table(&self) -> PathTable {
        let n = self.nodes.len();
        let mut pts = Vec::with_capacity(MAX_PATH_SAMPLES.min(1 + n * 2));
        let Some(first) = self.nodes.first() else {
            return PathTable {
                pts: vec![],
                cum: vec![],
            };
        };
        pts.push((first.x, first.y));
        let seg_count = if self.closed && n > 1 { n } else { n.saturating_sub(1) };
        // Per-segment descriptors: (p0, p3, Option<(c1, c2)>, weight).
        let mut segs = Vec::with_capacity(seg_count);
        let mut beziers = 0usize;
        let mut bezier_weight = 0f64;
        for i in 0..seg_count {
            let a = &self.nodes[i];
            let b = &self.nodes[(i + 1) % n];
            let p0 = (a.x, a.y);
            let p3 = (b.x, b.y);
            let cubic = a.out_handle.is_some() || b.in_handle.is_some();
            if cubic {
                let h0 = a.out_handle.unwrap_or([0., 0.]);
                let h3 = b.in_handle.unwrap_or([0., 0.]);
                let c1 = (p0.0 + h0[0], p0.1 + h0[1]);
                let c2 = (p3.0 + h3[0], p3.1 + h3[1]);
                let w = dist(p0, c1) + dist(c1, c2) + dist(c2, p3);
                beziers += 1;
                bezier_weight += w;
                segs.push((p0, p3, Some((c1, c2)), w));
            } else {
                segs.push((p0, p3, None, dist(p0, p3)));
            }
        }
        // Every segment contributes at least its endpoint; leftover sample
        // budget distributes over bezier segments proportionally to weight.
        let extra = MAX_PATH_SAMPLES.saturating_sub(1 + seg_count);
        for (p0, p3, cubic, w) in &segs {
            match cubic {
                None => pts.push(*p3),
                Some((c1, c2)) => {
                    let add = if bezier_weight > 0. && beziers > 0 {
                        ((extra as f64) * w / bezier_weight) as usize
                    } else {
                        0
                    };
                    let k = 1 + add;
                    for j in 1..=k {
                        let t = j as f64 / k as f64;
                        pts.push(cubic_point(*p0, *c1, *c2, *p3, t));
                    }
                }
            }
        }
        let mut cum = Vec::with_capacity(pts.len());
        cum.push(0.);
        for w in pts.windows(2) {
            cum.push(cum.last().unwrap() + dist(w[0], w[1]));
        }
        PathTable { pts, cum }
    }
}

type Pt = (f64, f64);
fn dist(a: Pt, b: Pt) -> f64 {
    (b.0 - a.0).hypot(b.1 - a.1)
}
fn cubic_point(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: f64) -> Pt {
    let mt = 1. - t;
    let (a, b, c, d) = (mt * mt * mt, 3. * mt * mt * t, 3. * mt * t * t, t * t * t);
    (
        a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
        a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
    )
}
struct PathTable {
    pts: Vec<Pt>,
    cum: Vec<f64>,
}
