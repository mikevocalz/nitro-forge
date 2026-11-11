//! Analytic world circles/arcs and bounded cubic path conversion, not a renderer.
use crate::model::*;
use serde::Serialize;
pub type XY = (f64, f64);
#[derive(Clone, Copy, Debug)]
pub struct Geometry {
    pub id: u64,
    pub center: XY,
    pub radius: f64,
    pub start: f64,
    pub sweep: f64,
    pub closed: bool,
}
#[derive(Serialize)]
pub struct Node {
    pub x: f64,
    pub y: f64,
    #[serde(rename = "in", skip_serializing_if = "Option::is_none")]
    pub incoming: Option<[f64; 2]>,
    #[serde(rename = "out", skip_serializing_if = "Option::is_none")]
    pub outgoing: Option<[f64; 2]>,
}
impl Geometry {
    pub fn point(&self, angle: f64) -> XY {
        let r = angle.rem_euclid(360.).to_radians();
        (
            self.center.0 + self.radius * r.cos(),
            self.center.1 + self.radius * r.sin(),
        )
    }
    pub fn contains(&self, p: XY) -> bool {
        if self.closed || self.sweep.abs() == 360. {
            return true;
        }
        let angle = (p.1 - self.center.1)
            .atan2(p.0 - self.center.0)
            .to_degrees();
        let delta = ((angle - self.start.rem_euclid(360.)) * self.sweep.signum()).rem_euclid(360.);
        delta <= self.sweep.abs() + 1e-10 || 360. - delta <= 1e-10
    }
    pub fn ends(&self) -> Vec<XY> {
        if self.closed {
            vec![]
        } else if self.sweep.abs() == 360. {
            vec![self.point(self.start)]
        } else {
            vec![self.point(self.start), self.point(self.start + self.sweep)]
        }
    }
    pub fn closest(&self, p: XY) -> XY {
        let (dx, dy) = (p.0 - self.center.0, p.1 - self.center.1);
        let d = dx.hypot(dy);
        if d == 0. {
            return self.point(if self.closed { 0. } else { self.start });
        }
        let q = (
            self.center.0 + self.radius * dx / d,
            self.center.1 + self.radius * dy / d,
        );
        if self.contains(q) {
            return q;
        }
        self.ends()
            .into_iter()
            .min_by(|a, b| {
                (a.0 - p.0)
                    .hypot(a.1 - p.1)
                    .total_cmp(&(b.0 - p.0).hypot(b.1 - p.1))
            })
            .unwrap()
    }
    pub fn tangents(&self, anchor: XY) -> Vec<XY> {
        let (dx, dy) = (anchor.0 - self.center.0, anchor.1 - self.center.1);
        let d2 = dx * dx + dy * dy;
        let r2 = self.radius * self.radius;
        if d2 < r2 {
            return vec![];
        }
        if d2 == r2 {
            if d2 == 0. {
                return vec![];
            }
            let d = d2.sqrt();
            let p = (
                self.center.0 + self.radius * dx / d,
                self.center.1 + self.radius * dy / d,
            );
            return if self.contains(p) { vec![p] } else { vec![] };
        }
        let base = (self.center.0 + r2 * dx / d2, self.center.1 + r2 * dy / d2);
        let k = self.radius * (d2 - r2).sqrt() / d2;
        [
            (base.0 - k * dy, base.1 + k * dx),
            (base.0 + k * dy, base.1 - k * dx),
        ]
        .into_iter()
        .filter(|p| self.contains(*p))
        .collect()
    }
    pub fn segment_hits(&self, a: XY, b: XY) -> Vec<XY> {
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len = dx * dx + dy * dy;
        if len <= 1e-18 {
            return vec![];
        }
        let t = ((self.center.0 - a.0) * dx + (self.center.1 - a.1) * dy) / len;
        let foot = (a.0 + t * dx, a.1 + t * dy);
        let dist2 = (foot.0 - self.center.0).powi(2) + (foot.1 - self.center.1).powi(2);
        let r2 = self.radius * self.radius;
        let h2 = r2 - dist2;
        if h2 < 0. {
            return vec![];
        }
        let offsets = if h2 == 0. {
            vec![0.]
        } else {
            let d = (h2 / len).sqrt();
            vec![-d, d]
        };
        offsets
            .into_iter()
            .filter_map(|offset| {
                let u = t + offset;
                if !(0.0..=1.0).contains(&u) {
                    return None;
                }
                let p = (a.0 + u * dx, a.1 + u * dy);
                self.contains(p).then_some(p)
            })
            .collect()
    }
    pub fn circle_hits(&self, other: &Self) -> Vec<XY> {
        let (dx, dy) = (
            other.center.0 - self.center.0,
            other.center.1 - self.center.1,
        );
        let d = dx.hypot(dy);
        if d == 0. {
            return vec![];
        }
        if d > self.radius + other.radius || d < (self.radius - other.radius).abs() {
            return vec![];
        }
        let along = if d == self.radius + other.radius {
            self.radius
        } else if d == (self.radius - other.radius).abs() {
            if self.radius >= other.radius {
                self.radius
            } else {
                -self.radius
            }
        } else {
            ((self.radius - other.radius) * (self.radius + other.radius) + d * d) / (2. * d)
        };
        let h2 = (self.radius - along) * (self.radius + along);
        if h2 < 0. {
            return vec![];
        }
        let base = (
            self.center.0 + along * dx / d,
            self.center.1 + along * dy / d,
        );
        let points = if h2 == 0. {
            vec![base]
        } else {
            let k = h2.sqrt() / d;
            vec![
                (base.0 - k * dy, base.1 + k * dx),
                (base.0 + k * dy, base.1 - k * dx),
            ]
        };
        points
            .into_iter()
            .filter(|p| self.contains(*p) && other.contains(*p))
            .collect()
    }
    /// Standard tangent-matched cubic approximation with each span <=90 degrees.
    pub fn nodes(&self) -> Vec<Node> {
        let pieces = (self.sweep.abs() / 90.).ceil() as usize;
        let step = self.sweep / pieces as f64;
        let count = if self.closed { pieces } else { pieces + 1 };
        let mut nodes: Vec<Node> = (0..count)
            .map(|i| {
                let p = self.point(if !self.closed && self.sweep.abs() == 360. && i == pieces {
                    self.start
                } else {
                    self.start + step * i as f64
                });
                Node {
                    x: p.0,
                    y: p.1,
                    incoming: None,
                    outgoing: None,
                }
            })
            .collect();
        for i in 0..pieces {
            let a = (self.start + step * i as f64).rem_euclid(360.).to_radians();
            let b = (if self.sweep.abs() == 360. && i + 1 == pieces {
                self.start
            } else {
                self.start + step * (i + 1) as f64
            })
            .rem_euclid(360.)
            .to_radians();
            let k = 4. / 3. * (step.to_radians() / 4.).tan() * self.radius;
            nodes[i].outgoing = Some([-k * a.sin(), k * a.cos()]);
            nodes[(i + 1) % count].incoming = Some([k * b.sin(), -k * b.cos()]);
        }
        nodes
    }
}
pub fn geometries(s: &State) -> Vec<Geometry> {
    let mut out = Vec::new();
    // Block members (slice A9) are definition geometry: they never draw or
    // snap directly — only transformed insert instances do (see `blocks`).
    for c in s
        .circles
        .values()
        .filter(|c| c.visible && c.block == 0 && s.layer_visible(c.layer))
    {
        let p = &s.points[&c.center];
        out.push(Geometry {
            id: c.id,
            center: (p.x, p.y),
            radius: c.radius,
            start: 0.,
            sweep: 360.,
            closed: true,
        })
    }
    for a in s
        .arcs
        .values()
        .filter(|a| a.visible && a.block == 0 && s.layer_visible(a.layer))
    {
        let p = &s.points[&a.center];
        out.push(Geometry {
            id: a.id,
            center: (p.x, p.y),
            radius: a.radius,
            start: a.start_deg,
            sweep: a.sweep_deg,
            closed: false,
        })
    }
    out.sort_by_key(|g| g.id);
    out
}
