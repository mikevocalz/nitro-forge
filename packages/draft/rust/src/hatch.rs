//! Hatch rasterization through the existing Prism compositor. Prism exposes
//! no vector path-clip op (`addMask` is a canvas-space alpha buffer and
//! `setClipped` clips a whole layer to the composite below), so clipping is
//! done honestly here: `solid` becomes a real Prism `fill` with
//! `fill_rule:"evenodd"` over the stored boundary loops, and built-in line
//! patterns are generated as world-space strokes whose segments are clipped
//! to the loops analytically (even-odd interval pairing along each pattern
//! line). Nothing is drawn outside the boundary and no clip is faked.
use crate::model::*;
use ignition_core::{EngineError, TaskContext};
use serde_json::{json, Value};

/// World-unit base pitch of the built-in line patterns, multiplied by
/// `Hatch::scale`.
const BASE_PITCH: f64 = 3.0;
/// Pattern lines per family per hatch; exceeding this rejects the render
/// rather than silently dropping detail.
const MAX_LINES_PER_FAMILY: usize = 512;
/// Stroked subpaths emitted per hatch across all families.
const MAX_SEGMENTS: usize = 4096;
/// Intersection parameter dedupe, relative to the line coordinate.
const PARAM_EPS: f64 = 1e-9;

/// Built-in family angles in degrees, before `Hatch::angle` rotation.
fn families(pattern: &str) -> &'static [f64] {
    match pattern {
        "ansi31" => &[45.],
        "crosshatch" => &[45., 135.],
        "horizontal" => &[0.],
        _ => &[],
    }
}

fn project(x: f64, y: f64, origin_x: f64, origin_y: f64, scale: f64) -> Result<[f64; 2], EngineError> {
    let (px, py) = ((x - origin_x) * scale, (y - origin_y) * scale);
    if ![px, py].iter().all(|v| v.is_finite() && v.abs() <= 1e7) {
        return Err(bad(
            "projected hatch coordinate exceeds Prism public coordinate limits",
        ));
    }
    Ok([px, py])
}

fn node(p: [f64; 2]) -> Value {
    json!({"x": p[0], "y": p[1]})
}

/// Even-odd clipped segments of one infinite pattern line against every
/// stored boundary loop. `dir`/`nrm` are orthonormal; `c` is the line's
/// normal coordinate. Intersections are collected per polygon edge with the
/// half-open crossing rule, sorted and paired into interior intervals.
fn line_segments(
    loops: &[Vec<[f64; 2]>],
    dir: (f64, f64),
    nrm: (f64, f64),
    c: f64,
) -> Vec<([f64; 2], [f64; 2])> {
    let mut hits: Vec<f64> = Vec::new();
    for boundary in loops {
        for i in 0..boundary.len() {
            let p = boundary[i];
            let q = boundary[(i + 1) % boundary.len()];
            let (v0, v1) = (
                p[0] * nrm.0 + p[1] * nrm.1 - c,
                q[0] * nrm.0 + q[1] * nrm.1 - c,
            );
            if (v0 > 0.) == (v1 > 0.) {
                continue;
            }
            let (u0, u1) = (p[0] * dir.0 + p[1] * dir.1, q[0] * dir.0 + q[1] * dir.1);
            let u = u0 + (0. - v0) * (u1 - u0) / (v1 - v0);
            hits.push(u);
        }
    }
    hits.sort_by(|a, b| a.total_cmp(b));
    hits.dedup_by(|a, b| (*a - *b).abs() <= PARAM_EPS * (1. + a.abs().max(b.abs())));
    let mut out = Vec::new();
    for pair in hits.chunks_exact(2) {
        let (u0, u1) = (pair[0], pair[1]);
        if u1 - u0 <= PARAM_EPS * (1. + u0.abs().max(u1.abs())) {
            continue;
        }
        let point = |u: f64| [dir.0 * u + nrm.0 * c, dir.1 * u + nrm.1 * c];
        out.push((point(u0), point(u1)));
    }
    out
}

fn hatch_paths(
    s: &State,
    origin_x: f64,
    origin_y: f64,
    scale: f64,
    ctx: Option<&TaskContext>,
) -> Result<Vec<Value>, EngineError> {
    let mut paths = Vec::new();
    for hatch in s.hatches.values() {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        if !hatch.visible || !s.layer_visible(hatch.layer) {
            continue;
        }
        if hatch.pattern == "solid" {
            let mut subpaths = Vec::with_capacity(hatch.loops.len());
            for boundary in &hatch.loops {
                let mut nodes = Vec::with_capacity(boundary.len());
                for p in boundary {
                    let [x, y] = project(p[0], p[1], origin_x, origin_y, scale)?;
                    nodes.push(node([x, y]));
                }
                subpaths.push(json!({"closed":true,"nodes":nodes}));
            }
            paths.push(json!({
                "path": {"subpaths": subpaths},
                "fill": {"type":"solid","color":hatch.color},
                "fill_rule": "evenodd",
            }));
            continue;
        }
        let fams = families(&hatch.pattern);
        if fams.is_empty() {
            return Err(bad("unknown hatch pattern"));
        }
        // World-space bounds of every stored boundary vertex.
        let mut bounds = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for boundary in &hatch.loops {
            for p in boundary {
                bounds.0 = bounds.0.min(p[0]);
                bounds.1 = bounds.1.min(p[1]);
                bounds.2 = bounds.2.max(p[0]);
                bounds.3 = bounds.3.max(p[1]);
            }
        }
        let pitch = BASE_PITCH * hatch.scale;
        let width = hatch.width * scale;
        if !width.is_finite() || width <= 0. || width > 1e7 {
            return Err(bad("projected hatch stroke exceeds Prism limit"));
        }
        let mut segments = 0usize;
        for &family in fams {
            if let Some(ctx) = ctx {
                ctx.checkpoint()?
            }
            let angle = (family + hatch.angle).to_radians();
            let dir = (angle.cos(), angle.sin());
            let nrm = (-dir.1, dir.0);
            // Normal-coordinate extent of the boundary box plus one pitch of
            // margin so edge-touching lines still intersect.
            let mut cmin = f64::INFINITY;
            let mut cmax = f64::NEG_INFINITY;
            for corner in [
                (bounds.0, bounds.1),
                (bounds.0, bounds.3),
                (bounds.2, bounds.1),
                (bounds.2, bounds.3),
            ] {
                let c = corner.0 * nrm.0 + corner.1 * nrm.1;
                cmin = cmin.min(c);
                cmax = cmax.max(c);
            }
            let lines = ((cmax - cmin) / pitch).ceil() as usize + 3;
            if lines > MAX_LINES_PER_FAMILY {
                return Err(bad("hatch pattern line budget exceeded"));
            }
            let mut subpaths: Vec<Value> = Vec::new();
            let mut c = cmin - pitch;
            while c <= cmax + pitch {
                for (a, b) in line_segments(&hatch.loops, dir, nrm, c) {
                    segments += 1;
                    if segments > MAX_SEGMENTS {
                        return Err(bad("hatch pattern segment budget exceeded"));
                    }
                    let [x1, y1] = project(a[0], a[1], origin_x, origin_y, scale)?;
                    let [x2, y2] = project(b[0], b[1], origin_x, origin_y, scale)?;
                    subpaths.push(json!({
                        "closed": false,
                        "nodes": [node([x1, y1]), node([x2, y2])],
                    }));
                }
                c += pitch;
                if !c.is_finite() {
                    return Err(bad("hatch pattern coordinate overflow"));
                }
            }
            if subpaths.is_empty() {
                continue;
            }
            paths.push(json!({
                "path": {"subpaths": subpaths},
                "stroke": {"paint":{"type":"solid","color":hatch.color},"width":width,"cap":"butt"},
            }));
        }
    }
    Ok(paths)
}

/// Hatch paths precede entity paths so geometry strokes draw on top.
pub fn render(
    s: &State,
    origin_x: f64,
    origin_y: f64,
    scale: f64,
    ctx: Option<&TaskContext>,
) -> Result<Vec<Value>, EngineError> {
    hatch_paths(s, origin_x, origin_y, scale, ctx)
}
