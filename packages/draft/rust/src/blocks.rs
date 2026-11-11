//! Named block definitions and bounded block-reference instances (slice A9).
//!
//! A `Block` is only a name plus a definition-space base point; membership
//! lives on the members themselves (`block` on segments/circles/arcs,
//! `parent` on inserts), so definitions never hold dangling member lists.
//! `expand` materializes every model-space insert (`parent == 0`) into flat
//! world-space primitives — transformed segment endpoints and analytic
//! circle/arc `Geometry` — which render and snaps consume. Member entities
//! keep their own `visible`/`layer`/style inside every instance, and each
//! insert level honors its own `visible`/`layer`; hidden subtrees emit
//! nothing. Hatches, dimensions and constraints are never block members.
//!
//! Nesting is real but bounded: `check_graph` rejects cyclic block graphs
//! and chains deeper than `MAX_BLOCK_DEPTH`, and `expand` enforces
//! `MAX_EXPANDED_PRIMITIVES` leaf primitives. `State::validate` runs both
//! on every mutation and restore, so reads can never recurse or exceed the
//! budget. Deferred honestly: block attributes, dynamic blocks, xrefs,
//! non-uniform scale, negative/mirror scale, explode/edit-in-place
//! semantics, `findProfiles` tracing through instances and text glyphs.
use crate::{circular, model::*};
use ignition_core::EngineError;
use std::collections::BTreeMap;

/// One materialized leaf primitive in world space. `root` is the outermost
/// model-space insert id and `member` the leaf entity id, so snap `sources`
/// identify both the instance and the definition geometry honestly.
#[derive(Clone, Debug)]
pub struct Virtual {
    pub root: u64,
    pub member: u64,
    pub segment: Option<((f64, f64), (f64, f64))>,
    pub curve: Option<circular::Geometry>,
    pub color: [u8; 4],
    pub width: f64,
}

/// Uniform similarity transform `p -> scale * R(theta) * p + t` mapping one
/// definition space into its parent space (world space at the root).
#[derive(Clone, Copy, Debug)]
struct Xform {
    scale: f64,
    sin: f64,
    cos: f64,
    tx: f64,
    ty: f64,
}
impl Xform {
    fn identity() -> Self {
        Self {
            scale: 1.,
            sin: 0.,
            cos: 1.,
            tx: 0.,
            ty: 0.,
        }
    }
    fn apply(&self, p: (f64, f64)) -> (f64, f64) {
        (
            self.scale * (self.cos * p.0 - self.sin * p.1) + self.tx,
            self.scale * (self.sin * p.0 + self.cos * p.1) + self.ty,
        )
    }
    /// `self ∘ inner`: maps inner's input space through `inner` then `self`.
    /// With inner(p) = si*Ri*p + ti this yields s1*s2, theta1+theta2 and
    /// t = s1*R1*t2 + t1.
    fn compose(&self, inner: &Self) -> Self {
        let (s, sn, cs) = (
            self.scale * inner.scale,
            self.sin * inner.cos + self.cos * inner.sin,
            self.cos * inner.cos - self.sin * inner.sin,
        );
        Self {
            scale: s,
            sin: sn,
            cos: cs,
            tx: self.scale * (self.cos * inner.tx - self.sin * inner.ty) + self.tx,
            ty: self.scale * (self.sin * inner.tx + self.cos * inner.ty) + self.ty,
        }
    }
    /// Total rotation in degrees for arc `start_deg` adjustment.
    fn angle_deg(&self) -> f64 {
        self.sin.atan2(self.cos).to_degrees()
    }
}

/// The insert's own transform: target-block space -> parent space. The
/// target block's base point lands on the insert position before
/// scale/rotation: `t = pos - s*R*base`.
fn insert_xform(s: &State, ins: &InsertEntity) -> Result<Xform, EngineError> {
    let block = s
        .blocks
        .get(&ins.block)
        .ok_or_else(|| bad("insert references unknown block"))?;
    let r = ins.rotation_deg.to_radians();
    let (sc, sn, cs) = (ins.scale, r.sin(), r.cos());
    let (bx, by) = (block.base_x, block.base_y);
    Ok(Xform {
        scale: sc,
        sin: sn,
        cos: cs,
        tx: ins.x - sc * (cs * bx - sn * by),
        ty: ins.y - sc * (sn * bx + cs * by),
    })
}

fn world_point(xf: &Xform, p: (f64, f64)) -> Result<(f64, f64), EngineError> {
    let w = xf.apply(p);
    if !coord(w.0) || !coord(w.1) {
        return Err(bad("block instance geometry exceeds world budget"));
    }
    Ok(w)
}

fn push_virtual(
    out: &mut Vec<Virtual>,
    root: u64,
    member: u64,
    color: [u8; 4],
    width: f64,
    segment: Option<((f64, f64), (f64, f64))>,
    curve: Option<circular::Geometry>,
) -> Result<(), EngineError> {
    if out.len() >= MAX_EXPANDED_PRIMITIVES {
        return Err(bad("block expansion exceeds primitive budget"));
    }
    out.push(Virtual {
        root,
        member,
        segment,
        curve,
        color,
        width,
    });
    Ok(())
}

/// Emit one circle/arc member transformed by `c` (definition -> world).
/// Mirrors authored-entity honesty: the whole transformed curve, radius
/// included, must stay inside the ±1e6 world budget.
#[allow(clippy::too_many_arguments)]
fn push_curve(
    s: &State,
    c: &Xform,
    root: u64,
    member: u64,
    center: u64,
    radius: f64,
    start_deg: f64,
    sweep_deg: f64,
    closed: bool,
    color: [u8; 4],
    width: f64,
    out: &mut Vec<Virtual>,
) -> Result<(), EngineError> {
    let p = s.point(center)?;
    let center = world_point(c, (p.x, p.y))?;
    let r = radius * c.scale;
    if !r.is_finite()
        || !(1e-6..=LIMIT).contains(&r)
        || ![center.0 - r, center.0 + r, center.1 - r, center.1 + r]
            .iter()
            .all(|v| coord(*v))
    {
        return Err(bad("block instance curve exceeds world budget"));
    }
    push_virtual(
        out,
        root,
        member,
        color,
        width * c.scale,
        None,
        Some(circular::Geometry {
            id: member,
            center,
            radius: r,
            start: start_deg + c.angle_deg(),
            sweep: sweep_deg,
            closed,
        }),
    )
}

/// Emit one insert's target-block members under `xf` (parent space -> world)
/// and recurse into member inserts. `depth` counts insert levels including
/// this one; `check_graph` caps it at MAX_BLOCK_DEPTH before any read runs.
fn emit_insert(
    s: &State,
    ins: &InsertEntity,
    xf: &Xform,
    depth: usize,
    root: u64,
    out: &mut Vec<Virtual>,
) -> Result<(), EngineError> {
    if depth > MAX_BLOCK_DEPTH {
        return Err(bad("block nesting depth exceeded"));
    }
    let own = insert_xform(s, ins)?;
    let c = xf.compose(&own);
    // Member entities keep document `order` for deterministic output.
    for id in &s.order {
        if let Some(seg) = s.segments.get(id) {
            if seg.block != ins.block || !seg.visible || !s.layer_visible(seg.layer) {
                continue;
            }
            let a = s.point(seg.a)?;
            let b = s.point(seg.b)?;
            let ends = (world_point(&c, (a.x, a.y))?, world_point(&c, (b.x, b.y))?);
            push_virtual(
                out,
                root,
                *id,
                seg.color,
                seg.width * c.scale,
                Some(ends),
                None,
            )?;
        } else if let Some(circ) = s.circles.get(id) {
            if circ.block != ins.block || !circ.visible || !s.layer_visible(circ.layer) {
                continue;
            }
            push_curve(
                s,
                &c,
                root,
                *id,
                circ.center,
                circ.radius,
                0.,
                360.,
                true,
                circ.color,
                circ.width,
                out,
            )?;
        } else if let Some(arc) = s.arcs.get(id) {
            if arc.block != ins.block || !arc.visible || !s.layer_visible(arc.layer) {
                continue;
            }
            push_curve(
                s,
                &c,
                root,
                *id,
                arc.center,
                arc.radius,
                arc.start_deg,
                arc.sweep_deg,
                false,
                arc.color,
                arc.width,
                out,
            )?;
        }
    }
    // Member inserts instantiate their own target inside this definition
    // space; `c` maps that space to world, so it becomes their parent xf.
    for mi in s.inserts.values().filter(|mi| mi.parent == ins.block) {
        if !mi.visible || !s.layer_visible(mi.layer) {
            continue;
        }
        emit_insert(s, mi, &c, depth + 1, root, out)?;
    }
    Ok(())
}

/// Materialize every visible model-space insert into world-space primitives
/// in deterministic order (root insert id, then document entity order, then
/// member-insert id order per nesting level). At most
/// `MAX_EXPANDED_PRIMITIVES` primitives; `State::validate` runs the same
/// expansion on every mutation and restore so reads stay inside budget.
pub fn expand(s: &State) -> Result<Vec<Virtual>, EngineError> {
    let mut out = Vec::new();
    for ins in s
        .inserts
        .values()
        .filter(|i| i.parent == 0 && i.visible && s.layer_visible(i.layer))
    {
        emit_insert(s, ins, &Xform::identity(), 1, ins.id, &mut out)?;
    }
    Ok(out)
}

/// Cycle and depth check over the block graph: an edge `parent -> block`
/// exists for every insert with `parent != 0`. Runs inside
/// `State::validate` so hostile restores and cycle-creating writes reject
/// atomically before any read can recurse.
pub fn check_graph(s: &State) -> Result<(), EngineError> {
    let mut graph: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    for ins in s.inserts.values() {
        if ins.parent != 0 {
            graph.entry(ins.parent).or_default().push(ins.block);
        }
    }
    for targets in graph.values_mut() {
        targets.sort_unstable();
        targets.dedup();
    }
    // Iterative DFS: color 0 unvisited / 1 on stack / 2 done; `depth` memoizes
    // the longest instantiation chain below each block (leaf = 1).
    let mut color: BTreeMap<u64, u8> = BTreeMap::new();
    let mut depth: BTreeMap<u64, usize> = BTreeMap::new();
    for &start in s.blocks.keys() {
        if color.get(&start).copied().unwrap_or(0) != 0 {
            continue;
        }
        color.insert(start, 1);
        let mut stack: Vec<(u64, usize)> = vec![(start, 0)];
        while let Some((node, idx)) = stack.last_mut() {
            let node = *node;
            let targets = graph.get(&node).cloned().unwrap_or_default();
            if *idx < targets.len() {
                let next = targets[*idx];
                *idx += 1;
                match color.get(&next).copied().unwrap_or(0) {
                    1 => return Err(bad("cyclic block reference")),
                    2 => {}
                    _ => {
                        color.insert(next, 1);
                        stack.push((next, 0));
                    }
                }
            } else {
                let mut d = 1usize;
                for &t in graph.get(&node).into_iter().flatten() {
                    d = d.max(1 + depth.get(&t).copied().unwrap_or(1));
                }
                depth.insert(node, d);
                color.insert(node, 2);
                stack.pop();
            }
        }
    }
    if depth.values().any(|&d| d > MAX_BLOCK_DEPTH) {
        return Err(bad("block nesting exceeds depth budget"));
    }
    Ok(())
}
