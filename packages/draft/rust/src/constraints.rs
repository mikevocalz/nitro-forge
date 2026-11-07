//! Linear coordinate equations only; rank/DOF refer to this admitted model.
use crate::model::*;
use ignition_core::EngineError;
use serde::Serialize;
use std::collections::BTreeMap;
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
