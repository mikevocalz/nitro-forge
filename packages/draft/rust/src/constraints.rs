//! Linear coordinate equations solved by Gaussian elimination, plus the
//! slice-A5 bounded Gauss-Newton/LM pass over the admitted nonlinear kinds.
//! Rank/DOF refer to the linear coordinate matrix only.
use crate::model::*;
use ignition_core::{EngineError, TaskContext};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone)]
struct Row {
    a: Vec<f64>,
    b: f64,
    constraint: Option<u64>,
    lock: Option<u64>,
}
#[derive(Debug, Serialize)]
pub struct Report {
    pub scope: &'static str,
    pub status: &'static str,
    pub rank: usize,
    pub dof: usize,
    pub residual: f64,
    pub unsatisfied_constraints: Vec<u64>,
    pub unsatisfied_locked_points: Vec<u64>,
    pub applied: bool,
}
pub struct Solved {
    pub report: Report,
    pub points: Vec<(u64, f64, f64)>,
}
pub fn solve(s: &State, tolerance: f64) -> Result<Solved, EngineError> {
    if !tolerance.is_finite() || !(1e-9..=1e-3).contains(&tolerance) {
        return Err(bad("solver tolerance must be 1e-9..1e-3 world units"));
    }
    let indices: BTreeMap<u64, usize> = s
        .points
        .keys()
        .enumerate()
        .map(|(i, &id)| (id, i * 2))
        .collect();
    let n = indices.len() * 2;
    let mut rows = Vec::new();
    let mut row = |terms: Vec<(u64, usize, f64)>,
                   b: f64,
                   c: Option<u64>,
                   lock: Option<u64>|
     -> Result<(), EngineError> {
        let mut a = vec![0.; n];
        for (id, axis, value) in terms {
            let i = indices
                .get(&id)
                .ok_or_else(|| bad("constraint references unknown point"))?;
            a[i + axis] += value;
        }
        rows.push(Row {
            a,
            b,
            constraint: c,
            lock,
        });
        Ok(())
    };
    for (&id, p) in &s.points {
        if s.point_fixed(id) {
            row(vec![(id, 0, 1.)], p.x, None, Some(id))?;
            row(vec![(id, 1, 1.)], p.y, None, Some(id))?;
        }
    }
    for (&id, c) in &s.constraints {
        if !c.enabled {
            continue;
        }
        match c.definition {
            Definition::Fixed { point, x, y } => {
                row(vec![(point, 0, 1.)], x, Some(id), None)?;
                row(vec![(point, 1, 1.)], y, Some(id), None)?;
            }
            Definition::Coincident { a, b } => {
                for axis in [0, 1] {
                    row(vec![(a, axis, -1.), (b, axis, 1.)], 0., Some(id), None)?;
                }
            }
            Definition::Horizontal { segment } | Definition::Vertical { segment } => {
                let seg = s.segment(segment)?;
                let axis = if matches!(c.definition, Definition::Horizontal { .. }) {
                    1
                } else {
                    0
                };
                row(
                    vec![(seg.a, axis, -1.), (seg.b, axis, 1.)],
                    0.,
                    Some(id),
                    None,
                )?;
            }
            Definition::DistanceX { a, b, value } | Definition::DistanceY { a, b, value } => {
                let axis = if matches!(c.definition, Definition::DistanceX { .. }) {
                    0
                } else {
                    1
                };
                row(vec![(a, axis, -1.), (b, axis, 1.)], value, Some(id), None)?;
            }
            // Slice-A5 kinds carry no linear rows; solve_nonlinear handles them.
            _ => {}
        }
    }
    if n > 128 || rows.len() > 384 {
        return Err(bad("solver dimension budget exceeded"));
    }
    let original = rows.clone();
    let mut pivots = Vec::new();
    let mut work = 0usize;
    let mut rank = 0;
    for col in 0..n {
        let pivot = (rank..rows.len())
            .max_by(|&a, &b| rows[a].a[col].abs().total_cmp(&rows[b].a[col].abs()));
        let Some(pivot) = pivot else { break };
        if rows[pivot].a[col].abs() < 1e-10 {
            continue;
        }
        rows.swap(rank, pivot);
        let factor = rows[rank].a[col];
        for j in col..n {
            rows[rank].a[j] /= factor;
        }
        rows[rank].b /= factor;
        for i in 0..rows.len() {
            if i == rank {
                continue;
            }
            let factor = rows[i].a[col];
            if factor.abs() < 1e-12 {
                continue;
            }
            for j in col..n {
                work += 1;
                if work > 16_777_216 {
                    return Err(bad("solver work budget exceeded"));
                }
                rows[i].a[j] -= factor * rows[rank].a[j];
            }
            rows[i].b -= factor * rows[rank].b;
        }
        pivots.push(col);
        rank += 1;
        if rank == rows.len() {
            break;
        }
    }
    let mut values: Vec<f64> = s.points.values().flat_map(|p| [p.x, p.y]).collect();
    for (i, &col) in pivots.iter().enumerate() {
        let mut value = rows[i].b;
        for j in 0..n {
            if j != col {
                value -= rows[i].a[j] * values[j];
            }
        }
        values[col] = value;
    }
    for (&id, p) in &s.points {
        if s.point_fixed(id) {
            let i = indices[&id];
            values[i] = p.x;
            values[i + 1] = p.y;
        }
    }
    if values.iter().any(|v| !v.is_finite()) {
        return Err(bad("nonfinite linear solution"));
    }
    let mut residual: f64 = 0.;
    let (mut unsatisfied, mut locks) = (Vec::new(), Vec::new());
    for r in &original {
        let error = (r.a.iter().zip(&values).map(|(a, v)| a * v).sum::<f64>() - r.b).abs();
        residual = residual.max(error);
        if error > tolerance {
            if let Some(id) = r.constraint {
                unsatisfied.push(id)
            }
            if let Some(id) = r.lock {
                locks.push(id)
            }
        }
    }
    unsatisfied.sort_unstable();
    unsatisfied.dedup();
    locks.sort_unstable();
    locks.dedup();
    let status = if residual > tolerance {
        "inconsistent"
    } else if rank < n {
        "underconstrained"
    } else {
        "solved"
    };
    let points = s
        .points
        .keys()
        .enumerate()
        .map(|(i, &id)| (id, values[i * 2], values[i * 2 + 1]))
        .collect();
    Ok(Solved {
        report: Report {
            scope: "point_coordinates",
            status,
            rank,
            dof: n - rank,
            residual,
            unsatisfied_constraints: unsatisfied,
            unsatisfied_locked_points: locks,
            applied: false,
        },
        points,
    })
}

// ---------------------------------------------------------------------------
// Slice A5: bounded nonlinear constraint solver.
//
// Levenberg-Marquardt (damped Gauss-Newton) over point coordinates and
// circle/arc radii. Deterministic: constraints iterate in BTreeMap id order,
// variables in id order, the Jacobian is a central finite difference with a
// fixed relative step, and the damping schedule is fixed — no randomness and
// no wall-clock input. Hard budgets: MAX_NONLINEAR_ITERATIONS outer
// iterations, LAMBDA_RETRIES damping retries per iteration and a scalar work
// counter; exhaustion reports `unconverged` rather than failing the op.
// Only converged (every residual within tolerance) solutions are published;
// an unconverged pass keeps the incoming geometry and reports the residual
// it actually has. The linear Gaussian-elimination stage is untouched and
// runs first; the nonlinear pass then refines the same points/radii against
// ALL enabled constraints (linear kinds contribute their exact linear rows)
// so it cannot silently drift a satisfied linear constraint.
// ---------------------------------------------------------------------------

/// Outer LM iterations per solve.
pub const MAX_NONLINEAR_ITERATIONS: usize = 48;
/// Damping retries inside one iteration before the pass stalls.
const LAMBDA_RETRIES: usize = 8;
/// Scalar work units (residual evals, Jacobian entries, normal-equation
/// updates, elimination ops) one solve may consume before reporting
/// `unconverged`.
const MAX_NONLINEAR_WORK: usize = 33_554_432;
/// Central-difference relative step for the numerical Jacobian.
const FD_REL: f64 = 1e-6;

#[derive(Debug, Serialize)]
pub struct NonlinearReport {
    /// `"solved"` when every enabled constraint residual is within tolerance;
    /// `"unconverged"` when the iteration/damping/work budgets ended first
    /// (never a proven inconsistency — GN cannot certify one).
    pub status: &'static str,
    pub iterations: usize,
    /// Max absolute residual at the configuration the engine keeps: the
    /// converged point when solved, the incoming (post-linear) geometry when
    /// unconverged. Mixed native units per row (world units for lengths,
    /// radians for angles, unitless sines/cosines for parallel/perpendicular).
    pub residual: f64,
    pub unsatisfied_constraints: Vec<u64>,
}

pub struct NonlinearOutcome {
    pub report: NonlinearReport,
    /// Converged point updates; empty unless `report.status == "solved"`.
    pub points: Vec<(u64, f64, f64)>,
    /// Converged circle/arc radius updates; empty unless solved.
    pub radii: Vec<(u64, f64)>,
}

/// One solver variable: a point coordinate or a circle/arc radius.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Var {
    Point { id: u64, axis: usize },
    Radius { id: u64 },
}

/// Variable layout plus the immutable base geometry residuals fall back to
/// for coordinates/radii that are not variables (fixed points, entities not
/// referenced by nonlinear kinds, locked participants).
struct Layout {
    index: BTreeMap<Var, usize>,
    points: BTreeMap<u64, (f64, f64)>,
    radii: BTreeMap<u64, f64>,
}

impl Layout {
    fn coord(&self, x: &[f64], id: u64, axis: usize) -> f64 {
        match self.index.get(&Var::Point { id, axis }) {
            Some(&i) => x[i],
            None => {
                let p = self.points[&id];
                if axis == 0 {
                    p.0
                } else {
                    p.1
                }
            }
        }
    }
    fn radius(&self, x: &[f64], id: u64) -> f64 {
        match self.index.get(&Var::Radius { id }) {
            Some(&i) => x[i],
            None => self.radii[&id],
        }
    }
}

/// Append the residual rows of one enabled constraint. `cons` receives the
/// owning constraint id once per emitted row for unsatisfied reporting.
#[allow(clippy::too_many_arguments)]
fn residual_rows(
    s: &State,
    c: &Constraint,
    l: &Layout,
    x: &[f64],
    out: &mut Vec<f64>,
    cons: &mut Vec<u64>,
) -> Result<(), EngineError> {
    let pt = |id: u64, axis: usize| l.coord(x, id, axis);
    let mut row = |value: f64| {
        out.push(value);
        cons.push(c.id);
    };
    match c.definition {
        // --- linear kinds: exact same equations as the Gaussian stage ---
        Definition::Fixed { point, x: fx, y: fy } => {
            row(pt(point, 0) - fx);
            row(pt(point, 1) - fy);
        }
        Definition::Coincident { a, b } => {
            row(pt(a, 0) - pt(b, 0));
            row(pt(a, 1) - pt(b, 1));
        }
        Definition::Horizontal { segment } | Definition::Vertical { segment } => {
            let seg = s.segment(segment)?;
            let axis = if matches!(c.definition, Definition::Horizontal { .. }) {
                1
            } else {
                0
            };
            row(pt(seg.b, axis) - pt(seg.a, axis));
        }
        Definition::DistanceX { a, b, value } | Definition::DistanceY { a, b, value } => {
            let axis = if matches!(c.definition, Definition::DistanceX { .. }) {
                0
            } else {
                1
            };
            row(pt(b, axis) - pt(a, axis) - value);
        }
        // --- slice A5 nonlinear kinds ---
        Definition::Distance { a, b, value } => {
            let dx = pt(b, 0) - pt(a, 0);
            let dy = pt(b, 1) - pt(a, 1);
            row(dx.hypot(dy) - value);
        }
        Definition::Angle {
            vertex,
            first,
            second,
            degrees,
        } => {
            let (ux, uy) = (pt(first, 0) - pt(vertex, 0), pt(first, 1) - pt(vertex, 1));
            let (vx, vy) = (pt(second, 0) - pt(vertex, 0), pt(second, 1) - pt(vertex, 1));
            let (lu, lv) = (ux.hypot(uy), vx.hypot(vy));
            if lu < 1e-12 || lv < 1e-12 {
                // Degenerate ray: angle undefined; report a large residual
                // with zero gradient rather than fabricating satisfaction.
                row(std::f64::consts::PI);
            } else {
                let angle = (ux * vy - uy * vx).abs().atan2(ux * vx + uy * vy);
                row(angle - degrees.to_radians());
            }
        }
        Definition::Perpendicular { a, b } | Definition::Parallel { a, b } => {
            let (sa, sb) = (s.segment(a)?, s.segment(b)?);
            let (d1x, d1y) = (pt(sa.b, 0) - pt(sa.a, 0), pt(sa.b, 1) - pt(sa.a, 1));
            let (d2x, d2y) = (pt(sb.b, 0) - pt(sb.a, 0), pt(sb.b, 1) - pt(sb.a, 1));
            let (l1, l2) = (d1x.hypot(d1y), d2x.hypot(d2y));
            if l1 < 1e-9 || l2 < 1e-9 {
                row(1.0);
            } else if matches!(c.definition, Definition::Perpendicular { .. }) {
                row((d1x * d2x + d1y * d2y) / (l1 * l2));
            } else {
                row((d1x * d2y - d1y * d2x) / (l1 * l2));
            }
        }
        Definition::Equal { a, b } => {
            let (sa, sb) = (s.segment(a)?, s.segment(b)?);
            let l1 = (pt(sa.b, 0) - pt(sa.a, 0))
                .hypot(pt(sa.b, 1) - pt(sa.a, 1));
            let l2 = (pt(sb.b, 0) - pt(sb.a, 0))
                .hypot(pt(sb.b, 1) - pt(sb.a, 1));
            row(l1 - l2);
        }
        Definition::Radius { entity, value } => {
            row(l.radius(x, entity) - value);
        }
        Definition::Concentric { a, b } => {
            let (ca, cb) = (s.curve(a)?, s.curve(b)?);
            row(pt(ca.0, 0) - pt(cb.0, 0));
            row(pt(ca.0, 1) - pt(cb.0, 1));
        }
        Definition::Midpoint { point, segment } => {
            let seg = s.segment(segment)?;
            row(pt(point, 0) - (pt(seg.a, 0) + pt(seg.b, 0)) * 0.5);
            row(pt(point, 1) - (pt(seg.a, 1) + pt(seg.b, 1)) * 0.5);
        }
        Definition::Tangent { a, b, internal } => {
            // Resolve each participant to segment endpoints or curve
            // (center point + radius); arcs contribute their carrier circle.
            enum Side {
                Segment { a: u64, b: u64 },
                Curve { center: u64, radius: u64 },
            }
            let side = |id: u64| -> Result<Side, EngineError> {
                if s.segments.contains_key(&id) {
                    let seg = s.segment(id)?;
                    Ok(Side::Segment {
                        a: seg.a,
                        b: seg.b,
                    })
                } else {
                    let (center, _) = s.curve(id)?;
                    Ok(Side::Curve {
                        center,
                        radius: id,
                    })
                }
            };
            match (side(a)?, side(b)?) {
                (Side::Curve { center: c1, radius: r1 }, Side::Curve { center: c2, radius: r2 }) => {
                    let d = (pt(c1, 0) - pt(c2, 0)).hypot(pt(c1, 1) - pt(c2, 1));
                    let (r1, r2) = (l.radius(x, r1), l.radius(x, r2));
                    row(if internal {
                        d - (r1 - r2).abs()
                    } else {
                        d - (r1 + r2)
                    });
                }
                (Side::Segment { a: sa, b: sb }, Side::Curve { center, radius })
                | (Side::Curve { center, radius }, Side::Segment { a: sa, b: sb }) => {
                    // Closest point on the segment to the circle center;
                    // residual = distance - radius (signed, smooth pieces).
                    let (ax, ay) = (pt(sa, 0), pt(sa, 1));
                    let (dx, dy) = (pt(sb, 0) - ax, pt(sb, 1) - ay);
                    let dd = dx * dx + dy * dy;
                    let t = if dd < 1e-18 {
                        0.
                    } else {
                        ((pt(center, 0) - ax) * dx + (pt(center, 1) - ay) * dy) / dd
                    }
                    .clamp(0., 1.);
                    let (fx, fy) = (ax + t * dx, ay + t * dy);
                    let dist = (pt(center, 0) - fx).hypot(pt(center, 1) - fy);
                    row(dist - l.radius(x, radius));
                }
                _ => return Err(bad("tangent requires a circular entity")),
            }
        }
    }
    Ok(())
}

/// Bounded LM/Gauss-Newton pass over every enabled constraint. Runs against
/// the post-linear state: linear kinds contribute their exact linear rows so
/// the refinement cannot drift a satisfied linear constraint. Returns
/// converged point/radius updates only when every residual reaches
/// `tolerance`; otherwise the incoming geometry is kept and reported.
pub fn solve_nonlinear(
    s: &State,
    tolerance: f64,
    ctx: Option<&TaskContext>,
) -> Result<NonlinearOutcome, EngineError> {
    if !tolerance.is_finite() || !(1e-9..=1e-3).contains(&tolerance) {
        return Err(bad("solver tolerance must be 1e-9..1e-3 world units"));
    }
    let enabled: Vec<&Constraint> = s
        .constraints
        .values()
        .map(|c| &**c)
        .filter(|c| c.enabled)
        .collect();
    // Variables: every point referenced by an enabled nonlinear constraint
    // (free coordinates only) plus every circle/arc radius appearing in a
    // radius-dependent nonlinear residual whose entity is not locked.
    let mut point_ids = BTreeSet::new();
    let mut radius_ids = BTreeSet::new();
    for c in &enabled {
        if !c.definition.nonlinear() {
            continue;
        }
        for p in s.definition_points(&c.definition)? {
            point_ids.insert(p);
        }
        match c.definition {
            Definition::Radius { entity, .. } => {
                radius_ids.insert(entity);
            }
            Definition::Tangent { a, b, .. } => {
                for id in [a, b] {
                    if s.is_curve(id) {
                        radius_ids.insert(id);
                    }
                }
            }
            _ => {}
        }
    }
    let mut index = BTreeMap::new();
    let mut vars = 0usize;
    for id in point_ids {
        if s.point_fixed(id) {
            continue;
        }
        index.insert(Var::Point { id, axis: 0 }, vars);
        index.insert(Var::Point { id, axis: 1 }, vars + 1);
        vars += 2;
    }
    for id in radius_ids {
        if s.curve_radius_fixed(id) {
            continue;
        }
        index.insert(Var::Radius { id }, vars);
        vars += 1;
    }
    let layout = Layout {
        index,
        points: s.points.iter().map(|(&id, p)| (id, (p.x, p.y))).collect(),
        radii: s
            .circles
            .iter()
            .map(|(&id, c)| (id, c.radius))
            .chain(s.arcs.iter().map(|(&id, a)| (id, a.radius)))
            .collect(),
    };
    // `index` iterates in Var order, which is exactly the insertion order the
    // indices were assigned in: all point vars (id, then axis) followed by
    // radius vars (id).
    let mut x: Vec<f64> = layout
        .index
        .keys()
        .map(|&var| match var {
            Var::Point { id, axis } => {
                let p = &layout.points[&id];
                if axis == 0 {
                    p.0
                } else {
                    p.1
                }
            }
            Var::Radius { id } => layout.radii[&id],
        })
        .collect();
    let eval = |x: &[f64]| -> Result<(Vec<f64>, Vec<u64>), EngineError> {
        let mut out = Vec::new();
        let mut cons = Vec::new();
        for c in &enabled {
            residual_rows(s, c, &layout, x, &mut out, &mut cons)?;
        }
        Ok((out, cons))
    };
    let metrics = |r: &[f64], cons: &[u64]| -> (f64, Vec<u64>) {
        let mut residual = 0f64;
        let mut unsat: BTreeSet<u64> = BTreeSet::new();
        for (i, &v) in r.iter().enumerate() {
            let a = v.abs();
            if a > residual {
                residual = a;
            }
            if a > tolerance {
                unsat.insert(cons[i]);
            }
        }
        (residual, unsat.into_iter().collect())
    };
    let (initial_r, initial_cons) = eval(&x)?;
    let (initial_residual, initial_unsat) = metrics(&initial_r, &initial_cons);
    if initial_residual <= tolerance || vars == 0 {
        return Ok(NonlinearOutcome {
            report: NonlinearReport {
                status: if initial_residual <= tolerance {
                    "solved"
                } else {
                    "unconverged"
                },
                iterations: 0,
                residual: initial_residual,
                unsatisfied_constraints: initial_unsat,
            },
            points: Vec::new(),
            radii: Vec::new(),
        });
    }
    let mut work = 0usize;
    let bump = |n: usize, work: &mut usize| -> Result<(), EngineError> {
        *work += n;
        if *work > MAX_NONLINEAR_WORK {
            Err(bad("nonlinear solver work budget exceeded"))
        } else {
            Ok(())
        }
    };
    let mut r = initial_r;
    let mut cost = 0.5 * r.iter().map(|v| v * v).sum::<f64>();
    let mut maxabs = initial_residual;
    let mut lambda = 1e-3f64;
    let mut iterations = 0usize;
    let mut converged = false;
    'outer: while iterations < MAX_NONLINEAR_ITERATIONS {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?;
            ctx.set_progress(iterations as f32 / MAX_NONLINEAR_ITERATIONS as f32);
        }
        bump(r.len() * 4, &mut work)?;
        // Central-difference Jacobian, stored as one column per variable.
        let mut cols: Vec<Vec<f64>> = Vec::with_capacity(vars);
        for j in 0..vars {
            let h = FD_REL * x[j].abs().max(1.0);
            let mut xp = x.clone();
            let mut xm = x.clone();
            xp[j] += h;
            xm[j] -= h;
            let (rp, _) = eval(&xp)?;
            let (rm, _) = eval(&xm)?;
            bump(2 * rp.len() * 4, &mut work)?;
            let mut col: Vec<f64> = rp
                .iter()
                .zip(&rm)
                .map(|(a, b)| (a - b) / (2. * h))
                .collect();
            // Truncate finite-difference noise: entries below 1e-9 of the
            // column's largest magnitude are numerical zero, and leaving
            // them in lets ~1e-6 gradient noise pair with ~1e-10 curvature
            // to produce absurd undamped steps on genuinely insensitive
            // variables (e.g. a segment endpoint beyond a tangent's closest
            // point).
            let scale = col.iter().fold(0f64, |m, v| m.max(v.abs()));
            if scale > 0. {
                let floor = scale * 1e-9;
                for v in &mut col {
                    if v.abs() < floor {
                        *v = 0.;
                    }
                }
            }
            cols.push(col);
        }
        // Normal equations A = JtJ, g = Jtr (upper triangle only).
        let mut a = vec![vec![0f64; vars]; vars];
        let mut g = vec![0f64; vars];
        for j in 0..vars {
            bump(cols[j].len(), &mut work)?;
            g[j] = cols[j].iter().zip(&r).map(|(u, v)| u * v).sum();
            for k in j..vars {
                bump(cols[j].len(), &mut work)?;
                let dot: f64 = cols[j].iter().zip(&cols[k]).map(|(u, v)| u * v).sum();
                a[j][k] = dot;
                a[k][j] = dot;
            }
        }
        // Marquardt damping floor scaled to the problem: variables with
        // ~zero curvature (insensitive directions, FD noise) must not get
        // steps inversely proportional to 1e-12.
        let a_scale = (0..vars)
            .fold(0f64, |m, i| m.max(a[i][i].abs()))
            .max(1e-12);
        let damp_floor = a_scale * 1e-6;
        let mut accepted = false;
        for _ in 0..LAMBDA_RETRIES {
            // Marquardt damping: A + lambda * diag(A) (floored for zero cols).
            let mut m = a.clone();
            for i in 0..vars {
                m[i][i] += lambda * a[i][i].abs().max(damp_floor);
            }
            let rhs: Vec<f64> = g.iter().map(|v| -v).collect();
            let delta = match solve_dense(&m, &rhs, vars, &mut work) {
                Ok(d) => d,
                Err(e) => {
                    // A spent work budget is a hard bound, not a damping
                    // failure; only genuine singularity retries with more
                    // damping.
                    if work > MAX_NONLINEAR_WORK {
                        return Err(e);
                    }
                    lambda *= 8.;
                    continue;
                }
            };
            let xn: Vec<f64> = x.iter().zip(&delta).map(|(u, v)| u + v).collect();
            // Radius variables must stay positive; coordinates may roam
            // (final world bounds are enforced by publish validation). A
            // step larger than the world budget can never be a useful
            // iterate — reject it like any other cost increase.
            // Trust region: reject any component step beyond a small multiple
            // of the variable's own magnitude — legitimate GN/LM iterates are
            // local, and an oversized step only comes from noise or a bad
            // linearization, so damping (not clipping) resolves it.
            let trust = delta.iter().enumerate().all(|(i, v)| {
                v.abs() <= 64. * x[i].abs().max(1.0)
            });
            let sane = trust
                && delta.iter().all(|v| v.abs() <= LIMIT)
                && xn.iter().zip(&x).all(|(n, o)| (n - o).abs() <= LIMIT);
            let radius_ok = sane
                && layout
                    .index
                    .iter()
                    .filter(|(v, _)| matches!(v, Var::Radius { .. }))
                    .all(|(_, &i)| xn[i].is_finite() && xn[i] > 0.);
            if !radius_ok || xn.iter().any(|v| !v.is_finite()) {
                lambda *= 8.;
                continue;
            }
            let (rn, _) = eval(&xn)?;
            bump(rn.len() * 4, &mut work)?;
            let costn = 0.5 * rn.iter().map(|v| v * v).sum::<f64>();
            if costn < cost {
                x = xn;
                r = rn;
                cost = costn;
                maxabs = r.iter().fold(0f64, |m, v| m.max(v.abs()));
                lambda = (lambda * 0.25).max(1e-11);
                accepted = true;
                break;
            }
            lambda *= 8.;
        }
        if !accepted {
            break 'outer;
        }
        iterations += 1;
        if maxabs <= tolerance {
            converged = true;
            break 'outer;
        }
    }
    if maxabs <= tolerance {
        converged = true;
    }
    // The row->constraint map is identical for every eval (same enabled set,
    // same row structure), so `initial_cons` labels the final `r` as well.
    let (report_residual, report_unsat) = if converged {
        metrics(&r, &initial_cons)
    } else {
        // Unconverged keeps the incoming geometry: report the residual the
        // kept configuration actually has, not the rejected iterate.
        (initial_residual, initial_unsat)
    };
    let (points, radii) = if converged {
        let mut by_point: BTreeMap<u64, (f64, f64)> = BTreeMap::new();
        let mut radii = Vec::new();
        for (&var, &i) in &layout.index {
            match var {
                Var::Point { id, axis } => {
                    let e = by_point.entry(id).or_insert((0., 0.));
                    if axis == 0 {
                        e.0 = x[i];
                    } else {
                        e.1 = x[i];
                    }
                }
                Var::Radius { id } => radii.push((id, x[i])),
            }
        }
        let points = by_point
            .into_iter()
            .map(|(id, (px, py))| (id, px, py))
            .collect();
        (points, radii)
    } else {
        (Vec::new(), Vec::new())
    };
    Ok(NonlinearOutcome {
        report: NonlinearReport {
            status: if converged { "solved" } else { "unconverged" },
            iterations,
            residual: report_residual,
            unsatisfied_constraints: report_unsat,
        },
        points,
        radii,
    })
}

/// Dense Gaussian elimination with partial pivoting for the small normal
/// equations; `work` counts coefficient updates against the shared budget.
fn solve_dense(
    a: &[Vec<f64>],
    rhs: &[f64],
    n: usize,
    work: &mut usize,
) -> Result<Vec<f64>, EngineError> {
    let mut m = a.to_vec();
    let mut b = rhs.to_vec();
    for col in 0..n {
        let pivot = (col..n)
            .max_by(|&i, &j| m[i][col].abs().total_cmp(&m[j][col].abs()))
            .ok_or_else(|| bad("singular normal equations"))?;
        if m[pivot][col].abs() < 1e-300 {
            return Err(bad("singular normal equations"));
        }
        m.swap(col, pivot);
        b.swap(col, pivot);
        let factor = m[col][col];
        for i in (col + 1)..n {
            let f = m[i][col] / factor;
            if f == 0. {
                continue;
            }
            for j in col..n {
                *work += 1;
                if *work > MAX_NONLINEAR_WORK {
                    return Err(bad("nonlinear solver work budget exceeded"));
                }
                m[i][j] -= f * m[col][j];
            }
            b[i] -= f * b[col];
        }
    }
    let mut x = vec![0f64; n];
    for i in (0..n).rev() {
        let mut v = b[i];
        for j in (i + 1)..n {
            v -= m[i][j] * x[j];
        }
        x[i] = v / m[i][i];
    }
    Ok(x)
}
