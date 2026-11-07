//! World-space finite-geometry candidates; no screen transform is guessed.
use crate::model::*;
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
                    priority: 4,
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
                    priority: 5,
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
            priority: 6,
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
    for seg in s.segments.values().filter(|s| s.visible) {
        let a = s.point(seg.a)?;
        let b = s.point(seg.b)?;
        if settings.midpoint {
            candidates.push(Candidate {
                kind: "midpoint",
                x: (a.x + b.x) / 2.,
                y: (a.y + b.y) / 2.,
                priority: 2,
                sources: vec![seg.id],
                angle_degrees: None,
            });
        }
        if settings.projection {
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let len = dx * dx + dy * dy;
            if len > 1e-18 {
                let t = (((x - a.x) * dx + (y - a.y) * dy) / len).clamp(0., 1.);
                candidates.push(Candidate {
                    kind: "projection",
                    x: a.x + t * dx,
                    y: a.y + t * dy,
                    priority: 3,
                    sources: vec![seg.id],
                    angle_degrees: None,
                });
            }
        }
    }
    if settings.intersection {
        let segments: Vec<_> = s.segments.values().filter(|s| s.visible).collect();
        for (i, a) in segments.iter().enumerate() {
            for b in &segments[i + 1..] {
                let (p, q, r, t) = (s.point(a.a)?, s.point(a.b)?, s.point(b.a)?, s.point(b.b)?);
                let (u, v, w, z) = (q.x - p.x, q.y - p.y, t.x - r.x, t.y - r.y);
                let determinant = u * z - v * w;
                let lengths = ((u * u + v * v) * (w * w + z * z)).sqrt();
                if lengths <= 1e-18 || determinant.abs() <= 1e-12 * lengths {
                    continue;
                }
                let (dx, dy) = (r.x - p.x, r.y - p.y);
                let alpha = (dx * z - dy * w) / determinant;
                let beta = (dx * v - dy * u) / determinant;
                if (0.0..=1.0).contains(&alpha) && (0.0..=1.0).contains(&beta) {
                    candidates.push(Candidate {
                        kind: "intersection",
                        x: p.x + alpha * u,
                        y: p.y + alpha * v,
                        priority: 1,
                        sources: vec![a.id, b.id],
                        angle_degrees: None,
                    });
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
