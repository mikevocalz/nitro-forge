//! World-space finite-geometry candidates; no screen transform is guessed.
//! Effective geometry is authored model-space entities plus materialized
//! block-instance primitives (slice A9): block members never snap
//! untransformed, virtual candidates carry `sources` = sorted
//! [root insert id, member entity id].
use crate::{blocks, circular, model::*};
use ignition_core::EngineError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Anchor {
    pub x: f64,
    pub y: f64,
}
#[derive(Debug, Serialize)]
pub struct Snap {
    pub kind: &'static str,
    pub x: f64,
    pub y: f64,
    pub distance: f64,
    pub sources: Vec<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angle_degrees: Option<f64>,
}
#[derive(Clone)]
struct Candidate {
    kind: &'static str,
    x: f64,
    y: f64,
    priority: u8,
    sources: Vec<u64>,
    angle_degrees: Option<f64>,
}
type XY = circular::XY;
/// Drawable segment for snapping: authored endpoints or a transformed block
/// instance. `emit_ends` is true only for virtual segments — authored
/// endpoints already snap through the shared `points` pass.
struct SegItem {
    a: XY,
    b: XY,
    sources: Vec<u64>,
    emit_ends: bool,
}
struct CurveItem {
    g: circular::Geometry,
    sources: Vec<u64>,
}
fn merged(mut a: Vec<u64>, b: &[u64]) -> Vec<u64> {
    a.extend_from_slice(b);
    a.sort_unstable();
    a.dedup();
    a
}
pub fn query(
    s: &State,
    x: f64,
    y: f64,
    tolerance: f64,
    anchor: Option<Anchor>,
) -> Result<Option<Snap>, EngineError> {
    if !coord(x) || !coord(y) || !tolerance.is_finite() || tolerance <= 0. || tolerance > LIMIT {
        return Err(bad("snap query requires bounded world point/tolerance"));
    }
    let mut candidates = Vec::new();
    let settings = &s.snaps;
    if let Some(anchor) = anchor {
        if !coord(anchor.x) || !coord(anchor.y) {
            return Err(bad("snap anchor outside world budget"));
        }
        if settings.ortho {
            for (px, py, angle) in [(x, anchor.y, 0.), (anchor.x, y, 90.)] {
                candidates.push(Candidate {
                    kind: "ortho",
                    x: px,
                    y: py,
                    priority: 7,
                    sources: vec![],
                    angle_degrees: Some(angle),
                });
            }
        }
        if settings.polar {
            let (dx, dy) = (x - anchor.x, y - anchor.y);
            let angle = dy.atan2(dx).to_degrees().rem_euclid(360.);
            let increment = settings.polar_increment;
            let mut last = ((360. / increment).ceil() as u32).saturating_sub(1);
            while last > 0 && f64::from(last) * increment >= 360. {
                last -= 1;
            }
            let lower = ((angle / increment).floor() as u32).min(last);
            // Nearest circular ray lies among angle neighbors or the two wrap endpoints.
            let indices = BTreeSet::from([0, last, lower, lower.saturating_add(1).min(last)]);
            for index in indices {
                let angle = f64::from(index) * increment;
                let (ux, uy) = match angle {
                    0. => (1., 0.),
                    90. => (0., 1.),
                    180. => (-1., 0.),
                    270. => (0., -1.),
                    _ => {
                        let r = angle.to_radians();
                        (r.cos(), r.sin())
                    }
                };
                let along = (dx * ux + dy * uy).max(0.);
                candidates.push(Candidate {
                    kind: "polar",
                    x: anchor.x + along * ux,
                    y: anchor.y + along * uy,
                    priority: 8,
                    sources: vec![],
                    angle_degrees: Some(angle),
                });
            }
        }
    }

    if settings.grid {
        candidates.push(Candidate {
            kind: "grid",
            x: settings.origin_x
                + ((x - settings.origin_x) / settings.spacing).round() * settings.spacing,
            y: settings.origin_y
                + ((y - settings.origin_y) / settings.spacing).round() * settings.spacing,
            priority: 9,
            sources: vec![],
            angle_degrees: None,
        });
    }
    if settings.endpoint {
        for p in s.points.values() {
            candidates.push(Candidate {
                kind: "endpoint",
                x: p.x,
                y: p.y,
                priority: 0,
                sources: vec![p.id],
                angle_degrees: None,
            });
        }
    }
    // Effective drawable geometry: authored entities (block members
    // excluded — they are definition geometry) plus materialized block
    // instances. Deterministic order: authored id order, then instance
    // expansion order.
    let mut segs: Vec<SegItem> = Vec::new();
    for seg in s
        .segments
        .values()
        .filter(|seg| seg.visible && seg.block == 0 && s.layer_visible(seg.layer))
    {
        let a = s.point(seg.a)?;
        let b = s.point(seg.b)?;
        segs.push(SegItem {
            a: (a.x, a.y),
            b: (b.x, b.y),
            sources: vec![seg.id],
            emit_ends: false,
        });
    }
    let mut curves: Vec<CurveItem> = circular::geometries(s)
        .into_iter()
        .map(|g| CurveItem {
            sources: vec![g.id],
            g,
        })
        .collect();
    for v in blocks::expand(s)? {
        let mut sources = vec![v.root, v.member];
        sources.sort_unstable();
        if let Some((a, b)) = v.segment {
            segs.push(SegItem {
                a,
                b,
                sources,
                emit_ends: true,
            });
        } else if let Some(g) = v.curve {
            curves.push(CurveItem { g, sources });
        }
    }
    for seg in &segs {
        if settings.endpoint && seg.emit_ends {
            for p in [seg.a, seg.b] {
                candidates.push(Candidate {
                    kind: "endpoint",
                    x: p.0,
                    y: p.1,
                    priority: 0,
                    sources: seg.sources.clone(),
                    angle_degrees: None,
                });
            }
        }
        if settings.midpoint {
            candidates.push(Candidate {
                kind: "midpoint",
                x: (seg.a.0 + seg.b.0) / 2.,
                y: (seg.a.1 + seg.b.1) / 2.,
                priority: 3,
                sources: seg.sources.clone(),
                angle_degrees: None,
            });
        }
        if settings.projection {
            let (dx, dy) = (seg.b.0 - seg.a.0, seg.b.1 - seg.a.1);
            let len = dx * dx + dy * dy;
            if len > 1e-18 {
                let t = (((x - seg.a.0) * dx + (y - seg.a.1) * dy) / len).clamp(0., 1.);
                candidates.push(Candidate {
                    kind: "projection",
                    x: seg.a.0 + t * dx,
                    y: seg.a.1 + t * dy,
                    priority: 4,
                    sources: seg.sources.clone(),
                    angle_degrees: None,
                });
            }
        }
    }
    if settings.intersection {
        for (i, a) in segs.iter().enumerate() {
            for b in &segs[i + 1..] {
                let (p, q, r, t) = (a.a, a.b, b.a, b.b);
                let (u, v, w, z) = (q.0 - p.0, q.1 - p.1, t.0 - r.0, t.1 - r.1);
                let determinant = u * z - v * w;
                let lengths = ((u * u + v * v) * (w * w + z * z)).sqrt();
                if lengths <= 1e-18 || determinant.abs() <= 1e-12 * lengths {
                    continue;
                }
                let (dx, dy) = (r.0 - p.0, r.1 - p.1);
                let alpha = (dx * z - dy * w) / determinant;
                let beta = (dx * v - dy * u) / determinant;
                if (0.0..=1.0).contains(&alpha) && (0.0..=1.0).contains(&beta) {
                    candidates.push(Candidate {
                        kind: "intersection",
                        x: p.0 + alpha * u,
                        y: p.1 + alpha * v,
                        priority: 2,
                        sources: merged(a.sources.clone(), &b.sources),
                        angle_degrees: None,
                    });
                }
            }
        }
        for curve in &curves {
            for seg in &segs {
                for point in curve.g.segment_hits(seg.a, seg.b) {
                    candidates.push(Candidate {
                        kind: "intersection",
                        x: point.0,
                        y: point.1,
                        priority: 2,
                        sources: merged(curve.sources.clone(), &seg.sources),
                        angle_degrees: None,
                    });
                }
            }
        }
        for (i, first) in curves.iter().enumerate() {
            for second in &curves[i + 1..] {
                for point in first.g.circle_hits(&second.g) {
                    candidates.push(Candidate {
                        kind: "intersection",
                        x: point.0,
                        y: point.1,
                        priority: 2,
                        sources: merged(first.sources.clone(), &second.sources),
                        angle_degrees: None,
                    });
                }
            }
        }
    }
    for curve in &curves {
        let g = &curve.g;
        let mut push = |kind, point: (f64, f64), priority| {
            candidates.push(Candidate {
                kind,
                x: point.0,
                y: point.1,
                priority,
                sources: curve.sources.clone(),
                angle_degrees: None,
            })
        };
        if settings.center {
            push("center", g.center, 1);
        }
        if settings.endpoint {
            for point in g.ends() {
                push("endpoint", point, 0);
            }
        }
        if settings.midpoint && !g.closed {
            push("midpoint", g.point(g.start + g.sweep / 2.), 3);
        }
        if settings.nearest_circle {
            push("nearest_circle", g.closest((x, y)), 5);
        }
        if settings.tangent {
            if let Some(anchor) = anchor {
                for point in g.tangents((anchor.x, anchor.y)) {
                    push("tangent", point, 6);
                }
            }
        }
    }
    candidates.retain(|c| coord(c.x) && coord(c.y) && (c.x - x).hypot(c.y - y) <= tolerance);
    candidates.sort_by(|a, b| {
        let da = (a.x - x).hypot(a.y - y);
        let db = (b.x - x).hypot(b.y - y);
        da.total_cmp(&db)
            .then(a.priority.cmp(&b.priority))
            .then(a.sources.cmp(&b.sources))
            .then_with(|| {
                a.angle_degrees
                    .unwrap_or(-1.)
                    .total_cmp(&b.angle_degrees.unwrap_or(-1.))
            })
            .then(a.x.total_cmp(&b.x))
            .then(a.y.total_cmp(&b.y))
    });
    Ok(candidates.first().map(|c| Snap {
        kind: c.kind,
        x: c.x,
        y: c.y,
        distance: (c.x - x).hypot(c.y - y),
        sources: c.sources.clone(),
        angle_degrees: c.angle_degrees,
    }))
}
