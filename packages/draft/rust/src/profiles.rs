//! Deterministic closed-profile tracing over visible segments and analytic arcs.
//! Read-only derived geometry: no state, journal or events are produced.
//! Endpoint coincidence uses a world-unit tolerance; matched ends may differ
//! by up to that tolerance, so area/centroid integrals include the implicit
//! straight hop chords between each arrival and the next entered end (and
//! back to the walk start) to keep the contour exactly closed. At junctions
//! (degree > 2) the lowest document-order unused incident edge is followed,
//! so ambiguous figure-eights resolve deterministically rather than
//! enumerating cycles.
use crate::{circular, model::*};
use ignition_core::EngineError;
use serde_json::{json, Value};

/// World-unit endpoint coincidence used when the caller supplies no tolerance.
pub const DEFAULT_TOLERANCE: f64 = 1e-6;
/// The entity budget is already 128, so these caps can never bind beyond the
/// state limits; they keep every profile, loop and traced walk bounded under
/// hostile endpoint clustering.
const MAX_PROFILES: usize = 128;
const MAX_LOOP_EDGES: usize = 128;
const MAX_TRACED: usize = 128;
/// Loops whose signed double-area magnitude is at or below this bound are
/// dropped as zero-area (figure-eights, folded chains, coincident endpoints).
const MIN_AREA2: f64 = 1e-12;

type XY = circular::XY;

#[derive(Clone, Copy)]
enum Kind {
    Segment { a: XY, b: XY },
    Arc { g: circular::Geometry },
    Closed { g: circular::Geometry },
}

struct Edge {
    id: u64,
    /// Position in `state.order`; the deterministic document ordering rule.
    ord: usize,
    kind: Kind,
    /// Authored end0/end1 coordinates; end0 is the segment `a` point or the arc
    /// start point, so entered end 0 always means forward sweep direction.
    ends: [XY; 2],
    open: bool,
}

#[derive(Clone, Copy)]
struct EndPt {
    x: f64,
    y: f64,
    edge: usize,
    end: u8,
}

struct Loop {
    ids: Vec<u64>,
    a2: f64,
    x2dy: f64,
    y2dx: f64,
    bounds: (f64, f64, f64, f64),
    poly: Vec<XY>,
    test: XY,
    ord: usize,
}

fn curve_moments(g: &circular::Geometry) -> (f64, f64, f64) {
    let r = g.radius;
    let (cx, cy) = g.center;
    let t0 = g.start.to_radians();
    let t1 = (g.start + g.sweep).to_radians();
    let (s0, c0) = t0.sin_cos();
    let (s1, c1) = t1.sin_cos();
    // Line integrals along the swept arc: a2 = contour(x dy - y dx),
    // x2dy = contour(x^2 dy), y2dx = contour(y^2 dx); all signed by sweep.
    let a2 = r * (cx * (s1 - s0) - cy * (c1 - c0)) + r * r * (t1 - t0);
    let fx = |t: f64| {
        let (sn, _) = t.sin_cos();
        cx * cx * r * sn
            + 2. * cx * r * r * (t / 2. + (2. * t).sin() / 4.)
            + r * r * r * (sn - sn * sn * sn / 3.)
    };
    let kx = |t: f64| {
        let (_, cs) = t.sin_cos();
        cy * cy * r * (-cs)
            + 2. * cy * r * r * (t / 2. - (2. * t).sin() / 4.)
            + r * r * r * (-cs + cs * cs * cs / 3.)
    };
    (a2, fx(t1) - fx(t0), -(kx(t1) - kx(t0)))
}

/// Segment line integrals from `p0` to `p1`; also used for the implicit
/// closing chord that makes a tolerance-closed walk exactly closed.
fn segment_moments(p0: XY, p1: XY) -> (f64, f64, f64) {
    let (x0, y0) = p0;
    let (x1, y1) = p1;
    let (u, v) = (x1 - x0, y1 - y0);
    (
        x0 * y1 - x1 * y0,
        v * (x0 * x0 + x0 * u + u * u / 3.),
        u * (y0 * y0 + y0 * v + v * v / 3.),
    )
}

/// (contour(x dy - y dx), contour(x^2 dy), contour(y^2 dx)) along the edge in
/// the entered-end direction; reversing a path negates every line integral.
fn moments(e: &Edge, entered: u8) -> (f64, f64, f64) {
    match e.kind {
        Kind::Segment { a, b } => {
            segment_moments(if entered == 0 { a } else { b }, if entered == 0 { b } else { a })
        }
        Kind::Arc { g } | Kind::Closed { g } => {
            let (a2, x2, y2) = curve_moments(&g);
            if entered == 1 {
                (-a2, -x2, -y2)
            } else {
                (a2, x2, y2)
            }
        }
    }
}

fn edge_bounds(e: &Edge) -> (f64, f64, f64, f64) {
    let g = match e.kind {
        Kind::Segment { a, b } => return (a.0.min(b.0), a.1.min(b.1), a.0.max(b.0), a.1.max(b.1)),
        Kind::Arc { g } | Kind::Closed { g } => g,
    };
    if g.closed || g.sweep.abs() == 360. {
        return (
            g.center.0 - g.radius,
            g.center.1 - g.radius,
            g.center.0 + g.radius,
            g.center.1 + g.radius,
        );
    }
    let mut b = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    let mut include = |p: XY| {
        b.0 = b.0.min(p.0);
        b.1 = b.1.min(p.1);
        b.2 = b.2.max(p.0);
        b.3 = b.3.max(p.1);
    };
    for p in g.ends() {
        include(p);
    }
    // Exact axis extremes occur at quadrant angles inside the swept interval.
    let dir = g.sweep.signum();
    let span = g.sweep.abs();
    for q in [0., 90., 180., 270.] {
        let t = (dir * (q - g.start)).rem_euclid(360.);
        if t > 0. && t < span {
            include(g.point(g.start + dir * t));
        }
    }
    b
}

fn build(s: &State) -> Result<Vec<Edge>, EngineError> {
    let mut edges = Vec::new();
    for (ord, id) in s.order.iter().enumerate() {
        if let Some(seg) = s.segments.get(id) {
            if !seg.visible || !s.layer_visible(seg.layer) {
                continue;
            }
            let a = s.point(seg.a)?;
            let b = s.point(seg.b)?;
            edges.push(Edge {
                id: *id,
                ord,
                kind: Kind::Segment {
                    a: (a.x, a.y),
                    b: (b.x, b.y),
                },
                ends: [(a.x, a.y), (b.x, b.y)],
                open: true,
            });
        } else if let Some(c) = s.circles.get(id) {
            if !c.visible || !s.layer_visible(c.layer) {
                continue;
            }
            let p = s.point(c.center)?;
            let center = (p.x, p.y);
            edges.push(Edge {
                id: *id,
                ord,
                kind: Kind::Closed {
                    g: circular::Geometry {
                        id: *id,
                        center,
                        radius: c.radius,
                        start: 0.,
                        sweep: 360.,
                        closed: true,
                    },
                },
                ends: [center, center],
                open: false,
            });
        } else if let Some(a) = s.arcs.get(id) {
            if !a.visible || !s.layer_visible(a.layer) {
                continue;
            }
            let p = s.point(a.center)?;
            let g = circular::Geometry {
                id: *id,
                center: (p.x, p.y),
                radius: a.radius,
                start: a.start_deg,
                sweep: a.sweep_deg,
                closed: false,
            };
            if a.sweep_deg.abs() == 360. {
                edges.push(Edge {
                    id: *id,
                    ord,
                    kind: Kind::Closed { g },
                    ends: [(p.x, p.y), (p.x, p.y)],
                    open: false,
                });
            } else {
                let ends = g.ends();
                if ends.len() != 2 {
                    return Err(bad("partial arc must expose two ends"));
                }
                edges.push(Edge {
                    id: *id,
                    ord,
                    kind: Kind::Arc { g },
                    ends: [ends[0], ends[1]],
                    open: true,
                });
            }
        }
    }
    Ok(edges)
}

/// Greedy walk from `start` end 0; returns (edge, entered end) traversal or
/// None on any dead end. Edges already in the path are never reused, so a walk
/// is bounded by the open-edge count.
fn trace(start: usize, edges: &[Edge], pts: &[EndPt], tol: f64) -> Option<Vec<(usize, u8)>> {
    let mut path: Vec<(usize, u8)> = Vec::new();
    let (sx, sy) = edges[start].ends[0];
    let mut cur = start;
    let mut entered = 0u8;
    loop {
        path.push((cur, entered));
        if path.len() > MAX_LOOP_EDGES {
            return None;
        }
        let arrive = edges[cur].ends[1 - entered as usize];
        if (arrive.0 - sx).hypot(arrive.1 - sy) <= tol {
            return Some(path);
        }
        // Lowest document-order unused incident edge wins at every node.
        let mut best: Option<(usize, u8)> = None;
        for p in pts {
            if (p.x - arrive.0).hypot(p.y - arrive.1) > tol {
                continue;
            }
            if path.iter().any(|&(e, _)| e == p.edge) {
                continue;
            }
            if best.is_none_or(|(be, bend)| (p.edge, p.end) < (be, bend)) {
                best = Some((p.edge, p.end));
            }
        }
        let (next, end) = best?;
        cur = next;
        entered = end;
    }
}

fn inside(poly: &[XY], p: XY) -> bool {
    let mut hit = false;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        if (a.1 > p.1) != (b.1 > p.1) {
            let x = a.0 + (p.1 - a.1) * (b.0 - a.0) / (b.1 - a.1);
            if p.0 < x {
                hit = !hit;
            }
        }
    }
    hit
}

fn push_poly(e: &Edge, entered: u8, poly: &mut Vec<XY>) {
    match e.kind {
        Kind::Segment { a, b } => {
            if entered == 0 {
                poly.push(a);
                poly.push(b);
            } else {
                poly.push(b);
                poly.push(a);
            }
        }
        Kind::Arc { g } | Kind::Closed { g } => {
            let nodes = g.nodes();
            if entered == 1 {
                for n in nodes.iter().rev() {
                    poly.push((n.x, n.y));
                }
            } else {
                for n in nodes {
                    poly.push((n.x, n.y));
                }
            }
        }
    }
}

fn loop_from_path(path: &[(usize, u8)], edges: &[Edge]) -> Loop {
    let mut l = Loop {
        ids: Vec::with_capacity(path.len()),
        a2: 0.,
        x2dy: 0.,
        y2dx: 0.,
        bounds: (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        poly: Vec::new(),
        test: (0., 0.),
        ord: usize::MAX,
    };
    for &(ei, entered) in path {
        let e = &edges[ei];
        let (a2, x2, y2) = moments(e, entered);
        l.a2 += a2;
        l.x2dy += x2;
        l.y2dx += y2;
        l.ids.push(e.id);
        l.ord = l.ord.min(e.ord);
        let b = edge_bounds(e);
        l.bounds.0 = l.bounds.0.min(b.0);
        l.bounds.1 = l.bounds.1.min(b.1);
        l.bounds.2 = l.bounds.2.max(b.2);
        l.bounds.3 = l.bounds.3.max(b.3);
        push_poly(e, entered, &mut l.poly);
    }
    // `trace` matches edge endpoints pairwise within `tol`, so consecutive
    // traversed edges can meet at points up to `tol` apart and the walk's
    // final arrival can sit `tol` from its start. The reported polygon —
    // the sampled `poly` vertices connected cyclically — therefore contains
    // small implicit hop chords between each arrival and the next edge's
    // entered end that the edge integrals alone do not cover. Shoelace and
    // moment sums are only translation-invariant for exactly closed
    // contours, so every hop is integrated as a straight segment between
    // the authored/analytic end coordinates (arc ends are `Geometry::ends`,
    // never sampled nodes). Exactly coincident matches contribute zero; a
    // single-edge walk's closing hop is the edge reversed and self-cancels
    // to zero area, and a standalone closed curve's hop is degenerate.
    for k in 0..path.len() {
        let (ei, en) = path[k];
        let (ni, nn) = path[(k + 1) % path.len()];
        let from = edges[ei].ends[1 - en as usize];
        let to = edges[ni].ends[nn as usize];
        let (a2, x2, y2) = segment_moments(from, to);
        l.a2 += a2;
        l.x2dy += x2;
        l.y2dx += y2;
    }
    let (fi, fe) = path[0];
    l.test = edges[fi].ends[fe as usize];
    l
}

fn closed_loop(ei: usize, edges: &[Edge]) -> Loop {
    loop_from_path(&[(ei, 0)], edges)
}

pub fn find(s: &State, tolerance: f64) -> Result<Value, EngineError> {
    if !tolerance.is_finite() || tolerance <= 0. || tolerance > LIMIT {
        return Err(bad("findProfiles tolerance outside world budget"));
    }
    let edges = build(s)?;
    let mut pts = Vec::new();
    for (i, e) in edges.iter().enumerate() {
        if !e.open {
            continue;
        }
        for end in 0..2u8 {
            let p = e.ends[end as usize];
            pts.push(EndPt {
                x: p.0,
                y: p.1,
                edge: i,
                end,
            });
        }
    }
    let mut visited = vec![false; edges.len()];
    let mut loops: Vec<Loop> = Vec::new();
    let mut traced = 0usize;
    // Closed circles and full-sweep arcs are standalone loops; they expose no
    // endpoints and can never join an open chain.
    for i in 0..edges.len() {
        if edges[i].open {
            continue;
        }
        visited[i] = true;
        traced += 1;
        loops.push(closed_loop(i, &edges));
    }
    for i in 0..edges.len() {
        if visited[i] || !edges[i].open {
            continue;
        }
        let Some(path) = trace(i, &edges, &pts, tolerance) else {
            continue;
        };
        let l = loop_from_path(&path, &edges);
        if l.a2.abs() <= MIN_AREA2 {
            // Zero-area/folded loop: edges stay unvisited so other starts may
            // still close a real profile through them.
            continue;
        }
        if traced + path.len() > MAX_TRACED {
            return Err(bad("findProfiles traced-entity budget exceeded"));
        }
        traced += path.len();
        for &(ei, _) in &path {
            visited[ei] = true;
        }
        loops.push(l);
    }
    // Nesting: a loop belongs to the smallest strictly larger loop whose
    // sampled polygon contains its first traced vertex (centers for closed
    // loops). Strict area decrease makes parent chains acyclic.
    let n = loops.len();
    let mut parent = vec![usize::MAX; n];
    for i in 0..n {
        let mut best: Option<usize> = None;
        for j in 0..n {
            if i == j || loops[j].a2.abs() <= loops[i].a2.abs() {
                continue;
            }
            if !inside(&loops[j].poly, loops[i].test) {
                continue;
            }
            let key = |k: usize| (loops[k].a2.abs(), loops[k].ord, loops[k].ids[0]);
            if best.is_none_or(|b| key(j) < key(b)) {
                best = Some(j);
            }
        }
        parent[i] = best.unwrap_or(usize::MAX);
    }
    let depth = |mut i: usize| {
        let mut d = 0usize;
        while parent[i] != usize::MAX {
            i = parent[i];
            d += 1;
        }
        d
    };
    let root = |mut i: usize| {
        while parent[i] != usize::MAX {
            i = parent[i];
        }
        i
    };
    let mut groups: std::collections::BTreeMap<usize, Vec<usize>> =
        std::collections::BTreeMap::new();
    for i in 0..n {
        groups.entry(root(i)).or_default().push(i);
    }
    let mut keyed = Vec::with_capacity(groups.len());
    for (_, mut members) in groups {
        members.sort_by_key(|&i| (depth(i), loops[i].ord));
        // Document ordering rule: profiles sort by the earliest `order`
        // position of any member entity; member entity sets are disjoint, so
        // keys are unique and the output order is fully deterministic.
        let key = members
            .iter()
            .map(|&i| loops[i].ord)
            .min()
            .unwrap_or(usize::MAX);
        let mut area = 0.;
        let mut bounds = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for &i in &members {
            let sign = if depth(i) % 2 == 0 { 1. } else { -1. };
            area += sign * loops[i].a2.abs() / 2.;
            let b = loops[i].bounds;
            bounds.0 = bounds.0.min(b.0);
            bounds.1 = bounds.1.min(b.1);
            bounds.2 = bounds.2.max(b.2);
            bounds.3 = bounds.3.max(b.3);
        }
        let outer = &loops[members[0]];
        keyed.push((
            key,
            json!({
                "loops": members.iter().map(|&i| loops[i].ids.clone()).collect::<Vec<_>>(),
                "area": area,
                "centroid": {"x": outer.x2dy / outer.a2, "y": -outer.y2dx / outer.a2},
                "bounds": {
                    "min_x": bounds.0,
                    "min_y": bounds.1,
                    "max_x": bounds.2,
                    "max_y": bounds.3,
                },
            }),
        ));
    }
    if keyed.len() > MAX_PROFILES {
        return Err(bad("findProfiles profile budget exceeded"));
    }
    keyed.sort_by_key(|&(key, _)| key);
    Ok(Value::Array(keyed.into_iter().map(|(_, p)| p).collect()))
}
