use crate::{model::*, sizing};
use ignition_core::EngineError;
use serde::Serialize;
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize)]
pub struct BoxNode {
    pub id: u64,
    pub kind: Kind,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub fill: [u8; 4],
    pub visible: bool,
    /// False for `Kind::Text`: the box participates in layout but
    /// `renderFrame` emits only its fill background, never glyphs.
    pub renderable: bool,
}
/// Aggregate outcome of the automatic constraint pass inside one
/// [`evaluate_report`] call. Solving is derived, never stored: snapshots
/// keep only `Node.constraints`, so undo/restore need no solver state.
#[derive(Clone, Debug, Default)]
pub struct ConstraintSolve {
    /// Constrained absolute children placement visited (expanded synthetic
    /// ids included on expanded states).
    pub constrained: usize,
    /// Nodes whose constraints could not be fully satisfied — cyclic sibling
    /// references, non-positive solved extents, or bound/aspect conflicts.
    /// They keep their unconstrained evaluated box. Sorted, deduplicated.
    pub unsatisfied: Vec<u64>,
}
pub fn evaluate(s: &State) -> Result<Vec<BoxNode>, EngineError> {
    Ok(evaluate_report(s)?.0)
}
/// [`evaluate`] plus the constraint-solve summary `evaluateLayout` reports.
/// The pass is deterministic and bounded: each absolute parent's constrained
/// children solve in one topological pass over sibling `relative_to`
/// dependencies (cycles revert to authored geometry), so there is no
/// iteration cap to exhaust — only the document node budget applies.
pub fn evaluate_report(s: &State) -> Result<(Vec<BoxNode>, ConstraintSolve), EngineError> {
    let sizes = sizing::evaluate(s)?;
    let mut out = vec![];
    let mut solve = ConstraintSolve::default();
    place(s, &sizes, 1, 0., 0., true, &mut out, None, &mut solve)?;
    solve.unsatisfied.sort_unstable();
    solve.unsatisfied.dedup();
    Ok((out, solve))
}
/// Residual tolerance for reporting a constraint satisfied: absolute
/// document units on edge equations, relative on the aspect ratio.
const SOLVE_TOL: f64 = 1e-6;
/// Which pair of reference edges a per-axis anchor pins. Anchors are
/// flush: the contract stores no inset margins, so a pinned edge/midpoint/
/// span lands exactly on the reference edge/midpoint/span. (Margin-preserving
/// anchors cannot be responsive without stored insets — a margin measured
/// against the live reference drifts with it and never moves the child.)
#[derive(Clone, Copy, PartialEq, Eq)]
enum Edge {
    /// Min edge pinned (left/top); the max edge floats.
    Lead,
    /// Max edge pinned (right/bottom); the min edge floats.
    Trail,
    /// Midpoint pinned.
    Center,
    /// Both edges pinned: the child spans the reference extent.
    Stretch,
}
/// Evaluated rectangle in absolute document units.
#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
/// Resolved size on one axis: stretch derives from the live reference
/// extent, every other edge keeps the evaluated size; C2 `min_*`/`max_*`
/// bounds clamp the result. `None` when no positive finite size remains.
fn axis_size(
    edge: Edge,
    rlen: f64,
    base: f64,
    lo: Option<f64>,
    hi: Option<f64>,
) -> Option<f64> {
    let mut size = if edge == Edge::Stretch { rlen } else { base };
    if let Some(lo) = lo {
        size = size.max(lo);
    }
    if let Some(hi) = hi {
        size = size.min(hi);
    }
    (size.is_finite() && size > 0.).then_some(size)
}
fn clamp_extent(v: f64, lo: Option<f64>, hi: Option<f64>) -> f64 {
    let mut v = v;
    if let Some(lo) = lo {
        v = v.max(lo);
    }
    if let Some(hi) = hi {
        v = v.min(hi);
    }
    v
}
/// Position on one axis for an already-resolved size; Trail/Center depend
/// on the final size so the anchored edge/midpoint stays put under clamps.
fn axis_pos(edge: Edge, rmin: f64, rlen: f64, size: f64) -> f64 {
    match edge {
        Edge::Lead | Edge::Stretch => rmin,
        Edge::Trail => rmin + rlen - size,
        Edge::Center => rmin + rlen * 0.5 - size * 0.5,
    }
}
/// How far the final box misses the anchor equation on one axis.
fn axis_residual(edge: Edge, rmin: f64, rlen: f64, pos: f64, size: f64) -> f64 {
    match edge {
        Edge::Lead => (pos - rmin).abs(),
        Edge::Trail => (pos + size - (rmin + rlen)).abs(),
        Edge::Center => (pos + size * 0.5 - (rmin + rlen * 0.5)).abs(),
        Edge::Stretch => (pos - rmin)
            .abs()
            .max((pos + size - (rmin + rlen)).abs()),
    }
}
fn h_edge(a: HorizontalAnchor) -> Edge {
    match a {
        HorizontalAnchor::Left => Edge::Lead,
        HorizontalAnchor::Right => Edge::Trail,
        HorizontalAnchor::Center => Edge::Center,
        HorizontalAnchor::Stretch => Edge::Stretch,
        // `Scale` never reaches the solver: whole-document validation
        // rejects it before any read.
        HorizontalAnchor::Scale => Edge::Lead,
    }
}
fn v_edge(a: VerticalAnchor) -> Edge {
    match a {
        VerticalAnchor::Top => Edge::Lead,
        VerticalAnchor::Bottom => Edge::Trail,
        VerticalAnchor::Center => Edge::Center,
        VerticalAnchor::Stretch => Edge::Stretch,
        VerticalAnchor::Scale => Edge::Lead,
    }
}
/// One constrained absolute child, in the parent's `children` order.
struct Pending {
    id: u64,
    cons: NodeConstraints,
    /// Unconstrained evaluated box (absolute document units).
    base: Rect,
    /// Resolved per-axis anchor edges.
    edge_x: Edge,
    edge_y: Edge,
    /// `true` when the reference is the parent frame (a fixed box);
    /// otherwise `sibling` names the sibling node id.
    parent_ref: bool,
    sibling: u64,
    /// Index into `pendings` of the constrained sibling this node must
    /// solve after, when that sibling carries constraints itself.
    dep: Option<usize>,
}
/// Solve one pending node against its live reference box. Returns the
/// solved rect, or `None` when no positive finite box satisfies the size
/// rules — the caller then keeps the baseline geometry and reports the
/// node unsatisfied.
fn solve_pending_box(p: &Pending, r: &Rect) -> Option<(Rect, bool)> {
    let mut w = axis_size(p.edge_x, r.w, p.base.w, p.cons.min_width, p.cons.max_width)?;
    let mut h = axis_size(p.edge_y, r.h, p.base.h, p.cons.min_height, p.cons.max_height)?;
    // Aspect lock derives the ratio from the unconstrained evaluated
    // geometry. Width stays authoritative unless only the vertical axis
    // stretches (then height pins and width derives); a both-axes or
    // neither stretch defaults to height-from-width.
    if p.cons.aspect_locked {
        if !(p.base.w.is_finite() && p.base.w > 0.)
            || !(p.base.h.is_finite() && p.base.h > 0.)
        {
            return None;
        }
        let ratio = p.base.w / p.base.h;
        let derive_w = p.edge_y == Edge::Stretch && p.edge_x != Edge::Stretch;
        if derive_w {
            w = clamp_extent(h * ratio, p.cons.min_width, p.cons.max_width);
        } else {
            h = clamp_extent(w / ratio, p.cons.min_height, p.cons.max_height);
        }
        if !(w.is_finite() && w > 0.) || !(h.is_finite() && h > 0.) {
            return None;
        }
    }
    let x = axis_pos(p.edge_x, r.x, r.w, w);
    let y = axis_pos(p.edge_y, r.y, r.h, h);
    // A solved box must land inside the same bounds `place` enforces on
    // every emitted node (finite, |v| <= 1e7, positive extents — w/h are
    // already positive here). Out-of-bounds results report unsatisfied and
    // keep baseline geometry instead of failing the whole layout read.
    if ![x, y, w, h]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= 1e7)
    {
        return None;
    }
    let mut satisfied = axis_residual(p.edge_x, r.x, r.w, x, w) <= SOLVE_TOL
        && axis_residual(p.edge_y, r.y, r.h, y, h) <= SOLVE_TOL;
    if p.cons.aspect_locked {
        let ratio = p.base.w / p.base.h;
        satisfied &= ((w / h) - ratio).abs() <= SOLVE_TOL * ratio.abs().max(1.);
    }
    Some((Rect { x, y, w, h }, satisfied))
}
/// Per-scope solver state: pending nodes plus final boxes (baseline for
/// every child, overwritten as constrained nodes solve).
struct ScopeSolver<'a> {
    pendings: &'a [Pending],
    prect: Rect,
    finals: BTreeMap<u64, Rect>,
    done: Vec<bool>,
    failed: Vec<bool>,
    cyclic: Vec<bool>,
    unsat: Vec<u64>,
}
impl ScopeSolver<'_> {
    /// Depth-first solve honoring `dep` edges; `cyclic` members keep their
    /// baseline box so dependents resolve against stable geometry.
    /// Recursion depth is bounded by the sibling count (itself bounded by
    /// the document node budget), so no explicit cap is needed.
    fn run(&mut self, u: usize) {
        if self.done[u] {
            return;
        }
        if self.cyclic[u] {
            self.done[u] = true;
            self.failed[u] = true;
            self.unsat.push(self.pendings[u].id);
            return;
        }
        if let Some(d) = self.pendings[u].dep {
            if !self.cyclic[d] {
                self.run(d);
            }
        }
        let p = &self.pendings[u];
        let r = if p.parent_ref {
            self.prect
        } else {
            self.finals[&p.sibling]
        };
        match solve_pending_box(p, &r) {
            Some((rect, true)) => {
                self.finals.insert(p.id, rect);
                self.done[u] = true;
            }
            _ => {
                // Unsatisfied or failed: keep the baseline box already in
                // `finals` and report the node.
                self.done[u] = true;
                self.failed[u] = true;
                self.unsat.push(p.id);
            }
        }
    }
}
/// Solve the constrained absolute children of one parent. Returns the
/// final box for each *successfully* solved constrained child; unsatisfied
/// children are absent (callers fall back to baseline geometry) and their
/// ids land in `report.unsatisfied`.
fn solve_scope(
    s: &State,
    sizes: &sizing::Sizes,
    parent: &Node,
    parent_id: u64,
    prect: Rect,
    report: &mut ConstraintSolve,
) -> BTreeMap<u64, Rect> {
    let mut out = BTreeMap::new();
    // Baseline boxes for every child: unconstrained siblings are fixed
    // references, constrained ones may move during the solve.
    let mut base = BTreeMap::new();
    for cid in &parent.children {
        let c = &s.nodes[cid];
        base.insert(
            *cid,
            Rect {
                x: prect.x + c.x,
                y: prect.y + c.y,
                w: sizes.values[&(*cid, Axis::X)],
                h: sizes.values[&(*cid, Axis::Y)],
            },
        );
    }
    let mut pendings: Vec<Pending> = vec![];
    let mut index_of: BTreeMap<u64, usize> = BTreeMap::new();
    for cid in &parent.children {
        let c = &s.nodes[cid];
        let Some(cons) = &c.constraints else {
            continue;
        };
        report.constrained += 1;
        // Flush pinning needs only the reference identity: parent box or
        // the sibling's live box. A missing sibling means the state bypassed
        // validation — keep baseline and report.
        let (parent_ref, sibling) = match cons.relative_to {
            None => (true, parent_id),
            Some(r) if r == parent_id => (true, parent_id),
            Some(r) if base.contains_key(&r) => (false, r),
            Some(_) => {
                report.unsatisfied.push(*cid);
                continue;
            }
        };
        index_of.insert(*cid, pendings.len());
        pendings.push(Pending {
            id: *cid,
            cons: cons.clone(),
            edge_x: h_edge(cons.horizontal),
            edge_y: v_edge(cons.vertical),
            base: base[cid],
            parent_ref,
            sibling,
            dep: None,
        });
    }
    if pendings.is_empty() {
        return out;
    }
    for i in 0..pendings.len() {
        if !pendings[i].parent_ref {
            if let Some(&j) = index_of.get(&pendings[i].sibling) {
                pendings[i].dep = Some(j);
            }
        }
    }
    // `dep` is functional (each node has at most one), so cycles are found
    // by walking each chain once; members of a dep cycle revert to baseline
    // while nodes merely feeding into one still solve against that stable
    // baseline.
    let n = pendings.len();
    let mut cyclic = vec![false; n];
    let mut resolved = vec![false; n];
    for i in 0..n {
        if resolved[i] || cyclic[i] {
            continue;
        }
        let mut path: Vec<usize> = vec![];
        let mut pos: BTreeMap<usize, usize> = BTreeMap::new();
        let mut cur = i;
        loop {
            if cyclic[cur] || resolved[cur] {
                for &u in &path {
                    resolved[u] = true;
                }
                break;
            }
            if let Some(&p) = pos.get(&cur) {
                for &u in &path[p..] {
                    cyclic[u] = true;
                }
                for &u in &path[..p] {
                    resolved[u] = true;
                }
                break;
            }
            pos.insert(cur, path.len());
            path.push(cur);
            match pendings[cur].dep {
                Some(d) => cur = d,
                None => {
                    for &u in &path {
                        resolved[u] = true;
                    }
                    break;
                }
            }
        }
    }
    let finals = base.clone();
    let mut solver = ScopeSolver {
        pendings: &pendings,
        prect,
        finals,
        done: vec![false; n],
        failed: vec![false; n],
        cyclic,
        unsat: vec![],
    };
    for u in 0..n {
        solver.run(u);
    }
    for (i, p) in pendings.iter().enumerate() {
        if !solver.failed[i] {
            out.insert(p.id, solver.finals[&p.id]);
        }
    }
    report.unsatisfied.extend(solver.unsat);
    out
}
fn place(
    s: &State,
    sizes: &sizing::Sizes,
    id: u64,
    x: f64,
    y: f64,
    visible: bool,
    out: &mut Vec<BoxNode>,
    wh: Option<(f64, f64)>,
    solve: &mut ConstraintSolve,
) -> Result<(), EngineError> {
    let (width, height) = wh.unwrap_or((sizes.values[&(id, Axis::X)], sizes.values[&(id, Axis::Y)]));
    if ![x, y, width, height]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= 1e7)
        || width <= 0.
        || height <= 0.
    {
        return Err(bad("evaluated box exceeds Prism shape bounds"));
    }
    let n = &s.nodes[&id];
    let visible = visible && n.visible;
    out.push(BoxNode {
        id,
        kind: n.kind,
        x,
        y,
        width,
        height,
        fill: n.fill,
        visible,
        renderable: n.kind != Kind::Text,
    });
    if let Some(l) = &n.layout {
        let axis = sizing::main(l);
        let row = axis == Axis::X;
        let inner_w = width - l.padding_left - l.padding_right;
        let inner_h = height - l.padding_top - l.padding_bottom;
        if inner_w <= 0. || inner_h <= 0. {
            return Err(bad("evaluated layout content box is empty"));
        }
        let main = if row { inner_w } else { inner_h };
        let cross = if row { inner_h } else { inner_w };
        let lines = sizing::lines(&n.children, main, l.gap, l.wrap, |id| {
            sizes.values[&(id, axis)]
        });
        let mut cross_cursor = 0.;
        for line in lines {
            let line_cross = if l.wrap {
                line.iter()
                    .map(|id| sizes.values[&(*id, axis.other())])
                    .fold(0., f64::max)
            } else {
                cross
            };
            let count = line.len();
            let used = line
                .iter()
                .map(|id| sizes.values[&(*id, axis)])
                .sum::<f64>()
                + l.gap * count.saturating_sub(1) as f64;
            let extra = (main - used).max(0.);
            let mut cursor = match l.justify {
                Justify::Center => extra / 2.,
                Justify::End => extra,
                _ => 0.,
            };
            let gap = l.gap
                + if l.justify == Justify::SpaceBetween && count > 1 {
                    extra / (count - 1) as f64
                } else {
                    0.
                };
            for id in line {
                let size = sizes.values[&(id, axis.other())];
                let offset = match l.align {
                    Align::Center => (line_cross - size) / 2.,
                    Align::End => line_cross - size,
                    _ => 0.,
                };
                let (cx, cy) = if row {
                    (cursor, cross_cursor + offset)
                } else {
                    (cross_cursor + offset, cursor)
                };
                place(
                    s,
                    sizes,
                    id,
                    x + l.padding_left + cx,
                    y + l.padding_top + cy,
                    visible,
                    out,
                    None,
                    solve,
                )?;
                cursor += sizes.values[&(id, axis)] + gap;
            }
            cross_cursor += line_cross + l.gap;
        }
    } else {
        // Absolute children: C1/C2 constraints solve here against the
        // parent's evaluated box (or a sibling's solved box), pinning
        // flush to the reference edges.
        let solved = solve_scope(
            s,
            sizes,
            n,
            id,
            Rect {
                x,
                y,
                w: width,
                h: height,
            },
            solve,
        );
        for cid in &n.children {
            let c = &s.nodes[cid];
            let (cx, cy, cw, ch) = solved
                .get(cid)
                .map(|r| (r.x, r.y, r.w, r.h))
                .unwrap_or((
                    x + c.x,
                    y + c.y,
                    sizes.values[&(*cid, Axis::X)],
                    sizes.values[&(*cid, Axis::Y)],
                ));
            place(s, sizes, *cid, cx, cy, visible, out, Some((cw, ch)), solve)?;
        }
    }
    Ok(())
}
