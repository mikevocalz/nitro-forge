//! Associative dimension measurement. Dimensions store only authored
//! references; every read re-derives world-space annotation geometry
//! (extension lines, dimension line, arrowhead legs, angle rays/arc) so
//! moving referenced geometry recomputes the result. There is no glyph
//! backend, so numeric text labels are deferred: only strokes are produced.
//! Orphaned dimensions (dangling references after deletions) measure to
//! `None` — derived geometry is never cached, so nothing stale is kept.
use crate::model::*;
use ignition_core::{EngineError, TaskContext};
use serde::Serialize;
use serde_json::{json, Value};

/// Straight world-space strokes emitted per dimension: extension lines,
/// the dimension line, arrowhead legs, angular rays and the angle arc
/// polyline. Arrowheads are open stroked chevrons, not filled solids.
pub const MAX_DIM_LINES: usize = 64;
/// Angle arc samples at most one vertex per 15 degrees of sweep.
const ARC_SEGMENT_DEGREES: f64 = 15.;
/// Arrowhead length is schematic: 10% of the measured span, clamped.
const ARROW_FRACTION: f64 = 0.1;
const ARROW_MIN: f64 = 1e-3;
const ARROW_MAX: f64 = 5.;
const ARROW_HALF_ANGLE: f64 = 30f64.to_radians();

type XY = (f64, f64);
type Line = (XY, XY);

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Measured {
    /// World units for linear/aligned/radial/diameter, degrees for angular.
    /// `None` only for a degenerate angular anchor (coincident coordinates),
    /// where the angle is genuinely undefined rather than zero.
    pub value: Option<f64>,
    pub lines: Vec<Line>,
}

fn unit(from: XY, to: XY) -> Option<XY> {
    let (dx, dy) = (to.0 - from.0, to.1 - from.1);
    let len = dx.hypot(dy);
    (len > 1e-12).then_some((dx / len, dy / len))
}

fn push(lines: &mut Vec<Line>, a: XY, b: XY) {
    // Zero-length strokes draw nothing; dropping them keeps evaluate and
    // render identical and avoids degenerate-dot ambiguity.
    if a != b {
        lines.push((a, b));
    }
}

/// Two stroked chevron legs from `tip` back into the measured span.
/// `inward` is the unit direction pointing from the tip into the span and
/// `span` is the measured length used only to size the arrowhead.
fn arrows(lines: &mut Vec<Line>, tip: XY, inward: XY, span: f64) {
    if span <= 1e-9 {
        return;
    }
    let len = (ARROW_FRACTION * span).clamp(ARROW_MIN, ARROW_MAX);
    let base = inward.1.atan2(inward.0);
    for sign in [-1., 1.] {
        let angle = base + sign * ARROW_HALF_ANGLE;
        let end = (tip.0 + len * angle.cos(), tip.1 + len * angle.sin());
        // Arrowheads are schematic overshoot, not authored geometry: a leg
        // that would leave the ±1e6 world budget is omitted rather than
        // failing the whole measurement.
        if coord(end.0) && coord(end.1) {
            push(lines, tip, end);
        }
    }
}

fn point_xy(s: &State, id: u64) -> Result<XY, EngineError> {
    let p = s.point(id)?;
    Ok((p.x, p.y))
}

/// Curve entity (circle or arc) referenced by radial/diameter kinds:
/// center, radius and the arc's start angle (circles use +X).
fn curve(s: &State, id: u64) -> Result<(XY, f64, f64), EngineError> {
    if let Some(c) = s.circles.get(&id) {
        return Ok((point_xy(s, c.center)?, c.radius, 0.));
    }
    let a = s
        .arcs
        .get(&id)
        .ok_or_else(|| bad("dimension entity is not a circle or arc"))?;
    Ok((point_xy(s, a.center)?, a.radius, a.start_deg))
}

fn measure_kind(s: &State, d: &Dimension) -> Result<Measured, EngineError> {
    let mut lines = Vec::new();
    let mut value = None;
    match d.kind {
        DimKind::Linear => {
            // Work in (measured, offset) coordinates so x and y share one
            // code path; `w` maps back to world space.
            let (a, b) = (point_xy(s, d.points[0])?, point_xy(s, d.points[1])?);
            let axis_y = d.axis == Some(DimAxis::Y);
            let (m1, o1, m2, o2) = if axis_y {
                (a.1, a.0, b.1, b.0)
            } else {
                (a.0, a.1, b.0, b.1)
            };
            let w = |m: f64, o: f64| {
                if axis_y {
                    (o, m)
                } else {
                    (m, o)
                }
            };
            let om = (o1 + o2) / 2.;
            let (lo, hi) = (m1.min(m2), m1.max(m2));
            value = Some((m1 - m2).abs());
            // Extension lines run perpendicular from each point to the
            // dimension line, which sits at the mean offset coordinate.
            push(&mut lines, w(m1, o1), w(m1, om));
            push(&mut lines, w(m2, o2), w(m2, om));
            push(&mut lines, w(lo, om), w(hi, om));
            let lo_in = w(1., 0.);
            let hi_in = w(-1., 0.);
            arrows(&mut lines, w(lo, om), lo_in, hi - lo);
            arrows(&mut lines, w(hi, om), hi_in, hi - lo);
        }
        DimKind::Aligned => {
            let (a, b) = (point_xy(s, d.points[0])?, point_xy(s, d.points[1])?);
            let span = (b.0 - a.0).hypot(b.1 - a.1);
            value = Some(span);
            if let Some(u) = unit(a, b) {
                // No offset control in this slice: the dimension line runs
                // through the measured points themselves.
                push(&mut lines, a, b);
                arrows(&mut lines, a, u, span);
                arrows(&mut lines, b, (-u.0, -u.1), span);
            }
        }
        DimKind::Angular => {
            let (v, a, b) = (
                point_xy(s, d.points[0])?,
                point_xy(s, d.points[1])?,
                point_xy(s, d.points[2])?,
            );
            let (va, vb) = ((a.0 - v.0, a.1 - v.1), (b.0 - v.0, b.1 - v.1));
            let (la, lb) = (va.0.hypot(va.1), vb.0.hypot(vb.1));
            if la <= 1e-12 || lb <= 1e-12 {
                // Coincident anchor coordinates: the angle is undefined.
                if la > 1e-12 {
                    push(&mut lines, v, a);
                }
                if lb > 1e-12 {
                    push(&mut lines, v, b);
                }
            } else {
                let cos = ((va.0 * vb.0 + va.1 * vb.1) / (la * lb)).clamp(-1., 1.);
                value = Some(cos.acos().to_degrees());
                push(&mut lines, v, a);
                push(&mut lines, v, b);
                let (ta, tb) = (
                    va.1.atan2(va.0).to_degrees(),
                    vb.1.atan2(vb.0).to_degrees(),
                );
                let mut sweep = (tb - ta).rem_euclid(360.);
                if sweep > 180. {
                    sweep -= 360.;
                }
                if sweep.abs() > 1e-9 {
                    // Bounded polyline approximation of the angle arc at
                    // one quarter of the nearer ray length.
                    let r = 0.25 * la.min(lb);
                    let n = ((sweep.abs() / ARC_SEGMENT_DEGREES).ceil() as usize)
                        .clamp(1, 24);
                    let mut prev = v;
                    for i in 1..=n {
                        let angle = (ta + sweep * i as f64 / n as f64).to_radians();
                        let p = (
                            v.0 + r * angle.cos(),
                            v.1 + r * angle.sin(),
                        );
                        push(&mut lines, prev, p);
                        prev = p;
                    }
                    // Arrowheads on the arc ends point along the arc's
                    // travel direction back into the swept span.
                    let sign = sweep.signum();
                    let tangent = |deg: f64| {
                        let r = deg.to_radians();
                        (-r.sin(), r.cos())
                    };
                    let start_angle = ta.to_radians();
                    let start = (
                        v.0 + r * start_angle.cos(),
                        v.1 + r * start_angle.sin(),
                    );
                    let end_angle = (ta + sweep).to_radians();
                    let end = (
                        v.0 + r * end_angle.cos(),
                        v.1 + r * end_angle.sin(),
                    );
                    let (ta_u, tb_u) = (tangent(ta), tangent(tb));
                    arrows(
                        &mut lines,
                        start,
                        (sign * ta_u.0, sign * ta_u.1),
                        r * sweep.abs().to_radians(),
                    );
                    arrows(
                        &mut lines,
                        end,
                        (-sign * tb_u.0, -sign * tb_u.1),
                        r * sweep.abs().to_radians(),
                    );
                }
            }
        }
        DimKind::Radial | DimKind::Diameter => {
            let (c, r, start_deg) = curve(s, d.entity)?;
            let angle = start_deg.to_radians();
            let u = (angle.cos(), angle.sin());
            if d.kind == DimKind::Radial {
                value = Some(r);
                let rim = (c.0 + r * u.0, c.1 + r * u.1);
                push(&mut lines, c, rim);
                arrows(&mut lines, rim, (-u.0, -u.1), r);
            } else {
                value = Some(2. * r);
                let p1 = (c.0 - r * u.0, c.1 - r * u.1);
                let p2 = (c.0 + r * u.0, c.1 + r * u.1);
                push(&mut lines, p1, p2);
                arrows(&mut lines, p1, u, 2. * r);
                arrows(&mut lines, p2, (-u.0, -u.1), 2. * r);
            }
        }
    }
    if lines.len() > MAX_DIM_LINES {
        return Err(bad("dimension stroke budget exceeded"));
    }
    for &(a, b) in &lines {
        if !coord(a.0) || !coord(a.1) || !coord(b.0) || !coord(b.1) {
            return Err(bad("dimension geometry exceeds world budget"));
        }
    }
    if value.is_some_and(|v| !v.is_finite()) {
        return Err(bad("dimension measurement is not finite"));
    }
    Ok(Measured { value, lines })
}

/// Measure one dimension. `Ok(None)` means a reference dangles (orphaned);
/// callers surface that as status, never as fabricated geometry.
pub fn measure(s: &State, d: &Dimension) -> Result<Option<Measured>, EngineError> {
    if !s.dimension_resolves(d) {
        return Ok(None);
    }
    measure_kind(s, d).map(Some)
}

fn project(x: f64, y: f64, origin_x: f64, origin_y: f64, scale: f64) -> Result<[f64; 2], EngineError> {
    let (px, py) = ((x - origin_x) * scale, (y - origin_y) * scale);
    if ![px, py].iter().all(|v| v.is_finite() && v.abs() <= 1e7) {
        return Err(bad(
            "projected dimension coordinate exceeds Prism public coordinate limits",
        ));
    }
    Ok([px, py])
}

/// Dimension annotation paths. Orphaned or fully degenerate dimensions emit
/// nothing; hidden dimensions and hidden layers are excluded like entities.
pub fn render(
    s: &State,
    origin_x: f64,
    origin_y: f64,
    scale: f64,
    ctx: Option<&TaskContext>,
) -> Result<Vec<Value>, EngineError> {
    let mut paths = Vec::new();
    for d in s.dimensions.values() {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        if !d.visible || !s.layer_visible(d.layer) {
            continue;
        }
        let Some(m) = measure(s, d)? else {
            continue;
        };
        let width = d.width * scale;
        if !width.is_finite() || width <= 0. || width > 1e7 {
            return Err(bad("projected dimension stroke exceeds Prism limit"));
        }
        let mut subpaths = Vec::with_capacity(m.lines.len());
        for (a, b) in m.lines {
            let [x1, y1] = project(a.0, a.1, origin_x, origin_y, scale)?;
            let [x2, y2] = project(b.0, b.1, origin_x, origin_y, scale)?;
            if x1 == x2 && y1 == y2 {
                continue;
            }
            subpaths.push(json!({
                "closed": false,
                "nodes": [
                    {"x": x1, "y": y1},
                    {"x": x2, "y": y2},
                ],
            }));
        }
        if subpaths.is_empty() {
            continue;
        }
        paths.push(json!({
            "path": {"subpaths": subpaths},
            "stroke": {"paint":{"type":"solid","color":d.color},"width":width,"cap":"butt"},
        }));
    }
    Ok(paths)
}
