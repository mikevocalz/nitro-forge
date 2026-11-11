use super::*;
use ignition_core::{decode_envelope, encode_envelope, Command, CommandResult, Engine};
use serde_json::{json, Value};
fn apply(e: &mut DraftEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn point(e: &mut DraftEngine, x: f64, y: f64) -> u64 {
    apply(e, "addPoint", json!({"x":x,"y":y})).data["point_id"]
        .as_u64()
        .unwrap()
}
fn segment(e: &mut DraftEngine, a: u64, b: u64) -> u64 {
    apply(e, "addSegment", json!({"a":a,"b":b})).data["segment_id"]
        .as_u64()
        .unwrap()
}
fn constraint(e: &mut DraftEngine, d: Value) -> u64 {
    apply(e, "addConstraint", json!({"definition":d})).data["constraint_id"]
        .as_u64()
        .unwrap()
}
fn state(e: &DraftEngine) -> model::State {
    let value: Value =
        serde_json::from_slice(decode_envelope(&e.snapshot().unwrap()).unwrap().1).unwrap();
    serde_json::from_value(value.get("document").cloned().unwrap_or(value)).unwrap()
}
fn viewport() -> Value {
    json!({"width":3,"height":1,"origin_x":0,"origin_y":0,"scale":1})
}
#[test]
fn all_admitted_linear_kinds_rank_dof_and_atomic_solved_geometry() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 3.);
    let b = point(&mut e, 5., 9.);
    let c = point(&mut e, 7., 4.);
    let d = point(&mut e, 0., 0.);
    let ab = segment(&mut e, a, b);
    let ad = segment(&mut e, a, d);
    constraint(&mut e, json!({"kind":"fixed","point":a,"x":1,"y":2}));
    constraint(&mut e, json!({"kind":"distance_x","a":a,"b":b,"value":4}));
    constraint(&mut e, json!({"kind":"horizontal","segment":ab}));
    let under = apply(&mut e, "solve", json!({}));
    assert_eq!(under.data["status"], "underconstrained");
    assert_eq!(under.data["rank"], 4);
    assert_eq!(under.data["dof"], 4);
    constraint(&mut e, json!({"kind":"coincident","a":b,"b":c}));
    constraint(&mut e, json!({"kind":"vertical","segment":ad}));
    constraint(&mut e, json!({"kind":"distance_y","a":a,"b":d,"value":-2}));
    let before = e.snapshot().unwrap();
    let solved = apply(&mut e, "solve", json!({}));
    assert_eq!(solved.data["status"], "solved");
    assert_eq!(solved.data["rank"], 8);
    assert_eq!(solved.data["dof"], 0);
    assert_eq!(solved.data["residual"].as_f64(), Some(0.));
    assert_eq!(solved.events.len(), 1);
    let s = state(&e);
    for (id, x, y) in [(a, 1., 2.), (b, 5., 2.), (c, 5., 2.), (d, 1., 0.)] {
        let p = s.point(id).unwrap();
        assert_eq!((p.x, p.y), (x, y));
    }
    let after = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), after);
    let noop = apply(&mut e, "solve", json!({}));
    assert!(noop.events.is_empty());
    assert_eq!(noop.data["applied"], false);
}
#[test]
fn inconsistent_rows_locked_coordinates_and_world_limits_never_publish_false_solution() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    apply(&mut e, "updatePoint", json!({"id":a,"locked":true}));
    let fixed = constraint(&mut e, json!({"kind":"fixed","point":a,"x":0.0001,"y":0}));
    let before = e.snapshot().unwrap();
    let approx = apply(&mut e, "solve", json!({"tolerance":0.001}));
    assert_eq!(approx.data["status"], "solved");
    assert!(approx.events.is_empty());
    assert_eq!(state(&e).point(a).unwrap().x, 0.);
    assert_eq!(e.snapshot().unwrap(), before);
    let strict = apply(&mut e, "solve", json!({"tolerance":1e-9}));
    assert_eq!(strict.data["status"], "inconsistent");
    assert_eq!(strict.data["unsatisfied_constraints"], json!([fixed]));
    assert!(strict.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 0., 0.);
    constraint(&mut e, json!({"kind":"fixed","point":a,"x":1000000,"y":0}));
    constraint(
        &mut e,
        json!({"kind":"distance_x","a":a,"b":b,"value":1000000}),
    );
    let before = e.snapshot().unwrap();
    assert!(e.apply(Command::new("solve", json!({}))).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn snaps_are_real_finite_candidates_with_deterministic_ties() {
    let mut e = DraftEngine::new();
    apply(
        &mut e,
        "setSnapSettings",
        json!({"grid":false,"endpoint":false,"midpoint":false,"projection":false,"intersection":false}),
    );
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 4., 0.);
    let ab = segment(&mut e, a, b);
    let c = point(&mut e, 2., -2.);
    let d = point(&mut e, 2., 2.);
    let cd = segment(&mut e, c, d);
    for (mode, x, y, tol, expected, kind) in [
        ("midpoint", 2., 0.2, 0.3, (2., 0.), "midpoint"),
        ("projection", 5., 0.2, 1.1, (4., 0.), "projection"),
        ("intersection", 2.1, 0.1, 0.2, (2., 0.), "intersection"),
    ] {
        apply(&mut e, "setSnapSettings", json!({mode:true}));
        let result = apply(&mut e, "querySnap", json!({"x":x,"y":y,"tolerance":tol}));
        assert_eq!(result.data["candidate"]["kind"], kind);
        assert_eq!(
            (
                result.data["candidate"]["x"].as_f64().unwrap(),
                result.data["candidate"]["y"].as_f64().unwrap()
            ),
            expected
        );
        if mode == "intersection" {
            assert_eq!(result.data["candidate"]["sources"], json!([ab, cd]));
        }
        apply(&mut e, "setSnapSettings", json!({mode:false}));
    }
    apply(
        &mut e,
        "setSnapSettings",
        json!({"endpoint":true,"projection":true}),
    );
    let snap = apply(&mut e, "querySnap", json!({"x":0,"y":0,"tolerance":0.1}));
    assert_eq!(snap.data["candidate"]["kind"], "endpoint");
    assert_eq!(snap.data["candidate"]["sources"], json!([a]));
    apply(
        &mut e,
        "setSnapSettings",
        json!({"endpoint":false,"projection":false,"grid":true,"spacing":10}),
    );
    let snap = apply(&mut e, "querySnap", json!({"x":5,"y":5,"tolerance":8}));
    assert_eq!(snap.data["candidate"]["x"].as_f64(), Some(10.));
    assert_eq!(snap.data["candidate"]["y"].as_f64(), Some(10.));
    assert!(e
        .apply(Command::new(
            "querySnap",
            json!({"x":0,"y":0,"tolerance":0})
        ))
        .is_err());
}
#[test]
fn actual_prism_rgba_degenerate_segments_and_projection_bounds() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.5);
    let b = point(&mut e, 3., 0.5);
    let seg = segment(&mut e, a, b);
    apply(
        &mut e,
        "updateSegment",
        json!({"id":seg,"color":[255,0,0,255]}),
    );
    let output = e
        .apply(Command::new("renderFrame", viewport()).with_binary(None))
        .unwrap();
    assert_eq!(
        output.output.unwrap(),
        vec![255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]
    );
    assert!(output.events.is_empty());
    let result = apply(&mut e, "renderFrame", viewport());
    assert!(result.data["pixels_b64"].is_string());
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "renderFrame",
            json!({"width":3,"height":1,"origin_x":-1000000,"origin_y":0,"scale":10000})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    apply(&mut e, "updatePoint", json!({"id":b,"x":0,"y":0.5}));
    let blank = e
        .apply(Command::new("renderFrame", viewport()).with_binary(None))
        .unwrap();
    assert_eq!(blank.output.unwrap(), vec![0; 12]);
}
#[test]
fn batch_revision_reads_reject_atomically_and_snapshots_validate_references() {
    let mut e = DraftEngine::new();
    let p = point(&mut e, 1., 2.);
    let original = e.snapshot().unwrap();
    apply(&mut e, "updatePoint", json!({"id":p,"x":3}));
    let changed = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    for op in ["querySnap", "describe", "evaluate"] {
        let payload = if op == "querySnap" {
            json!({"x":0,"y":0,"tolerance":1})
        } else {
            json!({})
        };
        assert!(e.apply(Command::new(ignition_core::OP_BATCH,json!({"commands":[{"op":"updatePoint","payload":{"id":p,"x":5}},{"op":op,"payload":payload}]}))).is_err());
        assert_eq!(e.snapshot().unwrap(), original);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
        assert!(e.undo().unwrap());
    }
    let saved = e.snapshot().unwrap();
    let mut reopened = DraftEngine::new();
    reopened.restore(&saved).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), saved);
    let mut invalid = serde_json::to_value(state(&e)).unwrap();
    invalid["next_id"] = json!(p);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), saved);
    assert!(e
        .apply(Command::new(
            "addConstraint",
            json!({"definition":{"kind":"circle_tangent","a":p,"b":p}})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), saved);
}
#[test]
fn resource_noop_history_and_exact_segment_locks_are_enforced() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 1., 0.);
    let ab = segment(&mut e, a, b);
    apply(&mut e, "updateSegment", json!({"id":ab,"locked":true}));
    constraint(&mut e, json!({"kind":"fixed","point":b,"x":1.0001,"y":0}));
    let before = e.snapshot().unwrap();
    let report = apply(&mut e, "solve", json!({"tolerance":0.001}));
    assert_eq!(state(&e).point(b).unwrap().x, 1.);
    assert!(report.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e
        .apply(Command::new("updatePoint", json!({"id":b,"x":2})))
        .is_err());
    let mut e = DraftEngine::new();
    let p = point(&mut e, 1., 2.);
    let original = e.snapshot().unwrap();
    apply(&mut e, "updatePoint", json!({"id":p,"x":3}));
    let changed = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    let revision = apply(&mut e, "describe", json!({})).data["source_revision"].clone();
    assert!(apply(&mut e, "updatePoint", json!({"id":p,"x":1}))
        .events
        .is_empty());
    assert!(e
        .apply(Command::new("addPoint", json!({"x":1000001,"y":0})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), original);
    assert_eq!(
        apply(&mut e, "describe", json!({})).data["source_revision"],
        revision
    );
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), changed);
    let mut e = DraftEngine::new();
    for i in 0..64 {
        point(&mut e, f64::from(i), 0.);
    }
    let max = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("addPoint", json!({"x":0,"y":0})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), max);
    let mut undone = 0;
    while e.undo().unwrap() {
        undone += 1
    }
    assert_eq!(undone, 16);
    let mut e = DraftEngine::new();
    let initial = apply(&mut e, "describe", json!({})).data["source_revision"]
        .as_u64()
        .unwrap();
    apply(
        &mut e,
        ignition_core::OP_BATCH,
        json!({"commands":[{"op":"addPoint","payload":{"x":0,"y":0}},{"op":"addPoint","payload":{"x":1,"y":0}}]}),
    );
    assert_eq!(
        apply(&mut e, "describe", json!({})).data["source_revision"]
            .as_u64()
            .unwrap(),
        initial + 1
    );
}
#[test]
fn endpoint_source_ties_and_collinear_intersection_absence_are_explicit() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, -1., 0.);
    let b = point(&mut e, 1., 0.);
    let ab = segment(&mut e, a, b);
    apply(&mut e, "updateSegment", json!({"id":ab,"visible":false}));
    apply(
        &mut e,
        "setSnapSettings",
        json!({"grid":false,"midpoint":false,"projection":false,"intersection":false}),
    );
    let snap = apply(&mut e, "querySnap", json!({"x":0,"y":0,"tolerance":1}));
    assert_eq!(snap.data["candidate"]["sources"], json!([a])); // all authored points, including hidden-segment endpoints
    apply(&mut e, "updateSegment", json!({"id":ab,"visible":true}));
    segment(&mut e, a, b);
    apply(
        &mut e,
        "setSnapSettings",
        json!({"endpoint":false,"intersection":true}),
    );
    assert!(
        apply(&mut e, "querySnap", json!({"x":0,"y":0,"tolerance":1})).data["candidate"].is_null()
    );
}

#[test]
fn oversized_restore_and_cancelled_reads_preserve_document() {
    use ignition_core::TaskContext;
    let mut e = DraftEngine::new();
    point(&mut e, 0., 0.);
    let before = e.snapshot().unwrap();
    let oversized = encode_envelope(&vec![b' '; model::MAX_BYTES + 1]);
    let error = e.restore(&oversized).unwrap_err();
    assert!(error.message.contains("8 MiB"));
    assert_eq!(e.snapshot().unwrap(), before);
    let context = TaskContext::new();
    context.cancel();
    assert!(e
        .apply_long(Command::new("renderFrame", viewport()), &context)
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn anchor_guides_use_real_axes_allowed_rays_and_world_tolerance() {
    let mut e = DraftEngine::new();
    apply(
        &mut e,
        "setSnapSettings",
        json!({"grid":false,"endpoint":false,"midpoint":false,"projection":false,"intersection":false,"ortho":true}),
    );
    let before = e.snapshot().unwrap();
    let none = apply(&mut e, "querySnap", json!({"x":12,"y":12,"tolerance":3}));
    assert!(none.data["candidate"].is_null());
    let snap = apply(
        &mut e,
        "querySnap",
        json!({"x":12,"y":12,"tolerance":2,"anchor":{"x":10,"y":10}}),
    );
    assert_eq!(snap.data["candidate"]["kind"], "ortho");
    assert_eq!(snap.data["candidate"]["angle_degrees"].as_f64(), Some(0.));
    assert_eq!(snap.data["candidate"]["x"].as_f64(), Some(12.));
    assert_eq!(snap.data["candidate"]["y"].as_f64(), Some(10.));
    assert_eq!(e.snapshot().unwrap(), before);
    apply(
        &mut e,
        "setSnapSettings",
        json!({"ortho":false,"polar":true,"polar_increment":100}),
    );
    let r = 350_f64.to_radians();
    let (x, y) = (3. + 10. * r.cos(), 4. + 10. * r.sin());
    let snap = apply(
        &mut e,
        "querySnap",
        json!({"x":x,"y":y,"tolerance":2,"anchor":{"x":3,"y":4}}),
    );
    assert_eq!(snap.data["candidate"]["angle_degrees"].as_f64(), Some(0.));
    assert!((snap.data["candidate"]["x"].as_f64().unwrap() - x).abs() < 1e-12);
    assert_eq!(snap.data["candidate"]["y"].as_f64(), Some(4.));
    apply(&mut e, "setSnapSettings", json!({"polar_increment":360}));
    let snap = apply(
        &mut e,
        "querySnap",
        json!({"x":-3,"y":1,"tolerance":4,"anchor":{"x":0,"y":0}}),
    );
    assert_eq!(snap.data["candidate"]["x"].as_f64(), Some(0.));
    assert_eq!(snap.data["candidate"]["y"].as_f64(), Some(0.));
    let snap = apply(
        &mut e,
        "querySnap",
        json!({"x":7,"y":8,"tolerance":0.1,"anchor":{"x":7,"y":8}}),
    );
    assert_eq!(snap.data["candidate"]["angle_degrees"].as_f64(), Some(0.));
    assert_eq!(snap.data["candidate"]["distance"].as_f64(), Some(0.));
    apply(&mut e, "setSnapSettings", json!({"polar_increment":0.01}));
    let snap = apply(
        &mut e,
        "querySnap",
        json!({"x":1,"y":1,"tolerance":0.001,"anchor":{"x":0,"y":0}}),
    );
    assert_eq!(snap.data["candidate"]["angle_degrees"].as_f64(), Some(45.));
    let before = e.snapshot().unwrap();
    for value in [json!(0), json!(360.1), Value::Null] {
        assert!(e
            .apply(Command::new(
                "setSnapSettings",
                json!({"polar_increment":value})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before)
    }
}
#[test]
fn command_line_creates_actual_geometry_and_one_history_entry() {
    let mut e = DraftEngine::new();
    let initial = e.snapshot().unwrap();
    let line = apply(
        &mut e,
        "executeCommand",
        json!({"command":"line 0 0.5 3 0.5"}),
    );
    assert_eq!(line.events.len(), 1);
    assert_eq!(line.data["result"]["point_ids"], json!([1, 2]));
    assert_eq!(line.data["result"]["segment_id"], 3);
    let created = e.snapshot().unwrap();
    let rendered = e
        .apply(Command::new("renderFrame", viewport()).with_binary(None))
        .unwrap();
    assert_eq!(
        rendered.output.unwrap(),
        vec![0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]
    );
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), initial);
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), created);
    apply(&mut e, "executeCommand", json!({"command":"MOVE 2 2 0.5"}));
    let rendered = e
        .apply(Command::new("renderFrame", viewport()).with_binary(None))
        .unwrap();
    assert_eq!(
        rendered.output.unwrap(),
        vec![0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0]
    );
    let point = apply(&mut e, "executeCommand", json!({"command":"POINT 1e1 -2"})).data["result"]
        ["point_id"]
        .as_u64()
        .unwrap();
    let seg = apply(
        &mut e,
        "executeCommand",
        json!({"command":format!("SEGMENT 2 {point}")}),
    )
    .data["result"]["segment_id"]
        .as_u64()
        .unwrap();
    apply(
        &mut e,
        "executeCommand",
        json!({"command":format!("DELETE SEGMENT {seg}")}),
    );
    apply(
        &mut e,
        "executeCommand",
        json!({"command":format!("DELETE POINT {point}")}),
    );
    assert_eq!(state(&e).points.len(), 2);
    let original = e.snapshot().unwrap();
    apply(&mut e, "executeCommand", json!({"command":"MOVE 2 1 0.5"}));
    let changed = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    for text in [
        "SPHERE 0 0 1",
        "POINT 1 2; DELETE POINT 1",
        "POINT (1+2) 3",
        "POINT NaN 1",
        "POINT 1e999 2",
        "MOVE 1 2",
        "DELETE LAYER 1",
        "POINT 1 2 3",
        "__batch",
    ] {
        assert!(e
            .apply(Command::new("executeCommand", json!({"command":text})))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), original)
    }
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), changed);
    let saved = e.snapshot().unwrap();
    let mut reopened = DraftEngine::new();
    reopened.restore(&saved).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), saved);
}
#[test]
fn command_snap_keeps_batch_revision_guard_and_failed_line_staging_is_atomic() {
    let mut e = DraftEngine::new();
    point(&mut e, 0., 0.);
    let before = e.snapshot().unwrap();
    assert!(e.apply(Command::new(ignition_core::OP_BATCH,json!({"commands":[{"op":"updatePoint","payload":{"id":1,"x":2}},{"op":"executeCommand","payload":{"command":"SNAP 0 0 1"}}]}))).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let snap = apply(
        &mut e,
        "executeCommand",
        json!({"command":"SNAP 0 0 1 0 0"}),
    );
    assert_eq!(
        snap.data["result"]["source_revision"],
        apply(&mut e, "describe", json!({})).data["source_revision"]
    );
    for i in 1..63 {
        point(&mut e, f64::from(i), 0.);
    }
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "executeCommand",
            json!({"command":"LINE 0 0 1 1"})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let mut legacy = serde_json::to_value(state(&e)).unwrap();
    for key in ["ortho", "polar", "polar_increment"] {
        legacy["snaps"].as_object_mut().unwrap().remove(key);
    }
    e.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
        .unwrap();
    assert!(!state(&e).snaps.ortho);
    assert!(!state(&e).snaps.polar);
    assert_eq!(state(&e).snaps.polar_increment, 45.);
}

#[test]
fn circular_analytic_intersections_tangents_and_directed_arcs() {
    use crate::circular::Geometry;
    let c = Geometry {
        id: 1,
        center: (0., 0.),
        radius: 1.,
        start: 0.,
        sweep: 360.,
        closed: true,
    };
    let near = |a: f64, b: f64| assert!((a - b).abs() < 1e-10, "{a} != {b}");
    assert_eq!(c.segment_hits((-2., 0.), (2., 0.)).len(), 2);
    assert_eq!(c.segment_hits((-2., 1.), (2., 1.)).len(), 1);
    assert!(c
        .segment_hits((-2., 1.00000001), (2., 1.00000001))
        .is_empty());
    assert!(c.segment_hits((1., 0.), (1., 0.)).is_empty());
    for (x, r, n) in [
        (2., 1., 1),
        (1., 1., 2),
        (0.5, 0.5, 1),
        (0., 1., 0),
        (0., 0.5, 0),
        (3., 1., 0),
    ] {
        let other = Geometry {
            center: (x, 0.),
            radius: r,
            ..c
        };
        let hits = c.circle_hits(&other);
        assert_eq!(hits.len(), n);
        for (px, py) in hits {
            near(px.hypot(py), 1.);
            near((px - x).hypot(py), r);
        }
    }
    assert_eq!(
        c.circle_hits(&Geometry {
            center: (1e-12, 0.),
            ..c
        })
        .len(),
        2
    );
    assert!(c.tangents((0.999999999, 0.)).is_empty());
    assert_eq!(c.tangents((1., 0.)).len(), 1);
    let ts = c.tangents((2., 0.));
    assert_eq!(ts.len(), 2);
    for (x, y) in ts {
        near(x.hypot(y), 1.);
        near(x * (2. - x) - y * y, 0.);
    }
    let a = Geometry {
        start: 10.,
        sweep: -100.,
        closed: false,
        ..c
    };
    assert!(a.contains(a.point(-45.)));
    assert!(!a.contains(a.point(90.)));
    assert_eq!(a.ends().len(), 2);
    let closest = a.closest((-2., 0.));
    near(closest.0, 0.);
    near(closest.1, -1.);
    assert_eq!(a.nodes().len(), 3);
    let full = Geometry { sweep: -360., ..a };
    assert_eq!(full.ends().len(), 1);
    let nodes = full.nodes();
    near(nodes[0].x, nodes[4].x);
    near(nodes[0].y, nodes[4].y);
    let tiny = Geometry { radius: 1e-6, ..c };
    assert!(tiny
        .segment_hits((-1e-5, 1.0001e-6), (1e-5, 1.0001e-6))
        .is_empty());
}

#[test]
fn circular_entities_locks_order_history_and_corrupt_restore_are_atomic() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    let s1 = segment(&mut e, a, b);
    let circle = apply(&mut e, "addCircle", json!({"center":a,"radius":1})).data["circle_id"]
        .as_u64()
        .unwrap();
    let arc = apply(
        &mut e,
        "addArc",
        json!({"center":a,"radius":2,"start_deg":30,"sweep_deg":-180}),
    )
    .data["arc_id"]
        .as_u64()
        .unwrap();
    let s2 = segment(&mut e, a, b);
    apply(&mut e, "setSegmentOrder", json!({"order":[s2,s1]}));
    assert_eq!(state(&e).order, vec![s2, circle, arc, s1]);
    apply(
        &mut e,
        "setEntityOrder",
        json!({"order":[arc,s1,circle,s2]}),
    );
    apply(&mut e, "updateCircle", json!({"id":circle,"locked":true}));
    let original = e.snapshot().unwrap();
    for (op, p) in [
        ("updatePoint", json!({"id":a,"x":1})),
        ("updateCircle", json!({"id":circle,"radius":2})),
        ("removeCircle", json!({"id":circle})),
        ("removePoint", json!({"id":a})),
        ("updateArc", json!({"id":arc,"sweep_deg":0})),
        ("updateArc", json!({"id":arc,"radius":1000001})),
    ] {
        assert!(e.apply(Command::new(op, p)).is_err());
        assert_eq!(e.snapshot().unwrap(), original);
    }
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["scope"], "point_coordinates");
    assert_eq!(state(&e).points[&a].x, 0.);
    apply(&mut e, "updateCircle", json!({"id":circle,"locked":false}));
    let unlocked = e.snapshot().unwrap();
    apply(&mut e, "updateCircle", json!({"id":circle,"radius":2}));
    let changed = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), unlocked);
    apply(&mut e, "updateCircle", json!({"id":circle,"radius":1}));
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), changed);
    let mut corrupt = serde_json::to_value(state(&e)).unwrap();
    corrupt["circles"][circle.to_string()]["center"] = json!(999);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&corrupt).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), changed);
    let mut reopened = DraftEngine::new();
    reopened.restore(&changed).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), changed);
    apply(&mut e, "removeCircle", json!({"id":circle}));
    apply(&mut e, "removeArc", json!({"id":arc}));
    assert!(state(&e).points.contains_key(&a));
}

#[test]
fn circular_commands_pixels_snap_defaults_and_projection_limits() {
    let mut e = DraftEngine::new();
    let empty = e.snapshot().unwrap();
    let described = apply(&mut e, "describe", json!({}));
    assert_eq!(described.data["circles"], json!({}));
    assert_eq!(described.data["snaps"]["tangent"], false);
    apply(
        &mut e,
        "executeCommand",
        json!({"command":"CIRCLE 2.5 2.5 1.5"}),
    );
    let saved = e.snapshot().unwrap();
    assert_eq!(state(&e).points.len(), 1);
    assert_eq!(state(&e).circles.len(), 1);
    let v = json!({"width":5,"height":5,"origin_x":0,"origin_y":0,"scale":1});
    let pixels = e
        .apply(Command::new("renderFrame", v.clone()).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert_eq!(pixels[3], 0);
    assert!(pixels[(1 * 5 + 2) * 4 + 3] > pixels[(2 * 5 + 2) * 4 + 3]);
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), empty);
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), saved);
    for command in [
        "CIRCLE 0 0 -1",
        "ARC 0 0 1 0 0",
        "ARC 0 0 1 0 361",
        "CIRCLE 1000000 0 1",
    ] {
        assert!(e
            .apply(Command::new("executeCommand", json!({"command":command})))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), saved);
    }
    apply(
        &mut e,
        "setSnapSettings",
        json!({"grid":false,"endpoint":false,"midpoint":false,"projection":false,"intersection":false,"center":true,"nearest_circle":false}),
    );
    assert_eq!(
        apply(
            &mut e,
            "querySnap",
            json!({"x":2.5,"y":2.5,"tolerance":1e-9})
        )
        .data["candidate"]["kind"],
        "center"
    );
    assert!(e
        .apply(Command::new(
            "renderFrame",
            json!({"width":1,"height":1,"origin_x":-1000000,"origin_y":0,"scale":10000})
        ))
        .is_err());
    let mut arc_engine = DraftEngine::new();
    apply(
        &mut arc_engine,
        "executeCommand",
        json!({"command":"ARC 2.5 2.5 1 0 90"}),
    );
    let p = arc_engine
        .apply(Command::new("renderFrame", v.clone()).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert!(p[(3 * 5 + 3) * 4 + 3] > 0);
    assert_eq!(p[(1 * 5 + 1) * 4 + 3], 0);
    apply(
        &mut arc_engine,
        "updateArc",
        json!({"id":2,"sweep_deg":-90}),
    );
    let p = arc_engine
        .apply(Command::new("renderFrame", v.clone()).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert!(p[(1 * 5 + 3) * 4 + 3] > 0);
    assert_eq!(p[(3 * 5 + 1) * 4 + 3], 0);
    apply(
        &mut arc_engine,
        "updateArc",
        json!({"id":2,"sweep_deg":360}),
    );
    arc_engine
        .apply(Command::new("renderFrame", v).with_binary(None))
        .unwrap();
}

#[test]
fn circular_query_returns_actual_center_nearest_tangent_and_intersection_sources() {
    let mut e = DraftEngine::new();
    let c = point(&mut e, 0., 0.);
    let circle = apply(&mut e, "addCircle", json!({"center":c,"radius":1})).data["circle_id"]
        .as_u64()
        .unwrap();
    let a = point(&mut e, -2., 0.);
    let b = point(&mut e, 2., 0.);
    let seg = segment(&mut e, a, b);
    apply(
        &mut e,
        "setSnapSettings",
        json!({"grid":false,"endpoint":false,"midpoint":false,"projection":false,"intersection":true}),
    );
    let hit = apply(&mut e, "querySnap", json!({"x":1,"y":0,"tolerance":1e-9}));
    assert_eq!(hit.data["candidate"]["kind"], "intersection");
    let mut sources = vec![circle, seg];
    sources.sort();
    assert_eq!(hit.data["candidate"]["sources"], json!(sources));
    apply(
        &mut e,
        "setSnapSettings",
        json!({"intersection":false,"nearest_circle":true}),
    );
    let hit = apply(&mut e, "querySnap", json!({"x":2,"y":0,"tolerance":1}));
    assert_eq!(hit.data["candidate"]["x"], 1.);
    assert_eq!(hit.data["candidate"]["kind"], "nearest_circle");
    apply(
        &mut e,
        "setSnapSettings",
        json!({"nearest_circle":false,"tangent":true}),
    );
    assert!(apply(
        &mut e,
        "querySnap",
        json!({"x":0.5,"y":0.8660254037844386,"tolerance":0.01})
    )
    .data["candidate"]
        .is_null());
    let hit = apply(
        &mut e,
        "querySnap",
        json!({"x":0.5,"y":0.8660254037844386,"tolerance":0.01,"anchor":{"x":2,"y":0}}),
    );
    assert_eq!(hit.data["candidate"]["kind"], "tangent");
    assert!((hit.data["candidate"]["x"].as_f64().unwrap() - 0.5).abs() < 1e-12);
    apply(&mut e, "updateCircle", json!({"id":circle,"visible":false}));
    assert!(apply(
        &mut e,
        "querySnap",
        json!({"x":0.5,"y":0.8660254037844386,"tolerance":1,"anchor":{"x":2,"y":0}})
    )
    .data["candidate"]
        .is_null());
}

#[test]
fn legacy_snapshot_defaults_and_locked_curve_solver_scope_are_explicit() {
    let mut e = DraftEngine::new();
    let empty = e.snapshot().unwrap();
    let payload: Value = serde_json::from_slice(decode_envelope(&empty).unwrap().1).unwrap();
    assert!(payload.get("circles").is_none());
    assert!(payload.get("arcs").is_none());
    for key in ["center", "nearest_circle", "tangent"] {
        assert!(payload["snaps"].get(key).is_none());
    }
    e.restore(&empty).unwrap();
    assert_eq!(e.snapshot().unwrap(), empty);
    let center = point(&mut e, 0., 0.);
    apply(
        &mut e,
        "addArc",
        json!({"center":center,"radius":1,"start_deg":0,"sweep_deg":-360,"locked":true}),
    );
    constraint(
        &mut e,
        json!({"kind":"fixed","point":center,"x":0.0001,"y":0}),
    );
    let before = e.snapshot().unwrap();
    let result = apply(&mut e, "solve", json!({"tolerance":0.0000001}));
    assert_eq!(result.data["scope"], "point_coordinates");
    assert_eq!(result.data["status"], "inconsistent");
    assert_eq!(e.snapshot().unwrap(), before);
    assert_eq!(state(&e).points[&center].x, 0.);
    assert!(e
        .apply(Command::new(
            "addConstraint",
            json!({"definition":{"kind":"radius","circle":2,"value":3}})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn extended_snapshots_require_matching_readers_without_changing_legacy_or_envelope() {
    // Even an old reader permissive about unknown keys must find its original required fields.
    #[derive(serde::Deserialize)]
    #[allow(dead_code)]
    struct LegacyRoot {
        kind: String,
        schema: u32,
        units: String,
        next_id: u64,
        points: Value,
        segments: Value,
        order: Value,
        constraints: Value,
        snaps: Value,
    }
    let mut e = DraftEngine::new();
    let legacy = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&legacy).unwrap();
    assert!(serde_json::from_slice::<LegacyRoot>(payload).is_ok());
    let mut reopened = DraftEngine::new();
    reopened.restore(&legacy).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), legacy);
    for flag in ["center", "nearest_circle", "tangent"] {
        apply(&mut e, "setSnapSettings", json!({flag:true}));
        let extended = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&extended).unwrap();
        assert!(serde_json::from_slice::<LegacyRoot>(payload).is_err());
        let value: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["kind"], "draft");
        assert_eq!(value["schema"], 2);
        assert_eq!(value["document"]["schema"], 1);
        reopened.restore(&extended).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), extended);
        apply(&mut e, "setSnapSettings", json!({flag:false}));
        assert_eq!(e.snapshot().unwrap(), legacy);
    }
    apply(&mut e, "executeCommand", json!({"command":"CIRCLE 0 0 1"}));
    let extended = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&extended).unwrap();
    assert!(serde_json::from_slice::<LegacyRoot>(payload).is_err());
    let wrapped: Value = serde_json::from_slice(payload).unwrap();
    reopened.restore(&extended).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), extended);
    let before = reopened.snapshot().unwrap();
    let mut wrong_kind = wrapped.clone();
    wrong_kind["kind"] = json!("motion");
    let mut wrong_schema = wrapped.clone();
    wrong_schema["schema"] = json!(3);
    let mut extra = wrapped.clone();
    extra["units"] = json!("mm");
    for invalid in [wrong_kind, wrong_schema, extra, wrapped["document"].clone()] {
        assert!(reopened
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(reopened.snapshot().unwrap(), before);
    }
    let mut arcs = DraftEngine::new();
    apply(
        &mut arcs,
        "executeCommand",
        json!({"command":"ARC 0 0 1 0 90"}),
    );
    let arc_snapshot = arcs.snapshot().unwrap();
    let (_, payload) = decode_envelope(&arc_snapshot).unwrap();
    assert!(serde_json::from_slice::<LegacyRoot>(payload).is_err());
    reopened.restore(&arc_snapshot).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), arc_snapshot);
}

fn circle(e: &mut DraftEngine, center: u64, radius: f64) -> u64 {
    apply(e, "addCircle", json!({"center":center,"radius":radius})).data["circle_id"]
        .as_u64()
        .unwrap()
}
fn arc(e: &mut DraftEngine, center: u64, radius: f64, start: f64, sweep: f64) -> u64 {
    apply(
        e,
        "addArc",
        json!({"center":center,"radius":radius,"start_deg":start,"sweep_deg":sweep}),
    )
    .data["arc_id"]
        .as_u64()
        .unwrap()
}
fn find_profiles(e: &mut DraftEngine, p: Value) -> Value {
    apply(e, "findProfiles", p).data
}
fn loop_ids(profile: &Value) -> Vec<u64> {
    profile["loops"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|l| l.as_array().unwrap().iter())
        .filter_map(|id| id.as_u64())
        .collect()
}

#[test]
fn profiles_trace_rectangle_circle_arc_chain_and_open_chain() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 4., 0.);
    let c = point(&mut e, 4., 3.);
    let d = point(&mut e, 0., 3.);
    let mut rect = vec![];
    for (u, v) in [(a, b), (b, c), (c, d), (d, a)] {
        rect.push(segment(&mut e, u, v));
    }
    let before = e.snapshot().unwrap();
    let result = e.apply(Command::new("findProfiles", json!({}))).unwrap();
    assert!(result.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    let data = result.data;
    assert_eq!(
        data["source_revision"],
        apply(&mut e, "describe", json!({})).data["source_revision"]
    );
    let profiles = data["profiles"].as_array().unwrap();
    assert_eq!(profiles.len(), 1);
    let mut member = loop_ids(&profiles[0]);
    member.sort_unstable();
    let mut want = rect.clone();
    want.sort_unstable();
    assert_eq!(member, want);
    assert!((profiles[0]["area"].as_f64().unwrap() - 12.).abs() < 1e-9);
    assert_eq!(profiles[0]["centroid"]["x"].as_f64(), Some(2.));
    assert_eq!(profiles[0]["centroid"]["y"].as_f64(), Some(1.5));
    assert_eq!(profiles[0]["bounds"]["min_x"].as_f64(), Some(0.));
    assert_eq!(profiles[0]["bounds"]["max_y"].as_f64(), Some(3.));
    // Deterministic: identical input yields identical output.
    assert_eq!(find_profiles(&mut e, json!({})), data);

    // Closed circle is a standalone analytic loop.
    let center = point(&mut e, 10., 10.);
    let circ = circle(&mut e, center, 2.);
    let profiles = find_profiles(&mut e, json!({}))["profiles"].clone();
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[1]["loops"], json!([[circ]]));
    assert!((profiles[1]["area"].as_f64().unwrap() - 4. * std::f64::consts::PI).abs() < 1e-9);
    assert_eq!(profiles[1]["centroid"]["x"].as_f64(), Some(10.));
    assert_eq!(profiles[1]["bounds"]["max_x"].as_f64(), Some(12.));

    // Arc swept portion plus its chord closes a half-disk profile.
    let ac = point(&mut e, 20., 0.);
    let a0 = point(&mut e, 25., 0.);
    let a1 = point(&mut e, 15., 0.);
    let curved = arc(&mut e, ac, 5., 0., 180.);
    let chord = segment(&mut e, a0, a1);
    // Full-sweep arc is a closed loop like a circle.
    let fc = point(&mut e, 30., 10.);
    let full = arc(&mut e, fc, 3., 40., 360.);
    let profiles = find_profiles(&mut e, json!({}))["profiles"].clone();
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 4);
    let half = profiles
        .iter()
        .find(|p| loop_ids(p).contains(&curved))
        .unwrap();
    let mut half_members = loop_ids(half);
    half_members.sort_unstable();
    assert_eq!(half_members, {
        let mut v = vec![curved, chord];
        v.sort_unstable();
        v
    });
    assert!(
        (half["area"].as_f64().unwrap() - 12.5 * std::f64::consts::PI).abs() < 1e-6,
        "half-disk area {}",
        half["area"]
    );
    assert_eq!(half["bounds"]["min_x"].as_f64(), Some(15.));
    assert_eq!(half["bounds"]["max_x"].as_f64(), Some(25.));
    assert_eq!(half["bounds"]["max_y"].as_f64(), Some(5.));
    let fullp = profiles
        .iter()
        .find(|p| loop_ids(p).contains(&full))
        .unwrap();
    assert!((fullp["area"].as_f64().unwrap() - 9. * std::f64::consts::PI).abs() < 1e-9);

    // Open chains and near-miss junctions produce no profile by default only
    // when the gap exceeds the coincidence tolerance.
    let o1 = point(&mut e, 40., 0.);
    let o2 = point(&mut e, 41., 0.);
    let o3 = point(&mut e, 42., 1.);
    segment(&mut e, o1, o2);
    segment(&mut e, o2, o3);
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        4
    );

    // Two chains whose ends miss by 5e-7: closed at the 1e-6 default, open at 1e-9.
    let t1 = point(&mut e, 60., 0.);
    let t2 = point(&mut e, 64., 0.);
    let t3 = point(&mut e, 64.0000005, 0.);
    let t4 = point(&mut e, 62., 3.);
    let t5 = point(&mut e, 60., 0.);
    segment(&mut e, t1, t2);
    segment(&mut e, t3, t4);
    segment(&mut e, t4, t5);
    let profiles = find_profiles(&mut e, json!({}))["profiles"].clone();
    assert_eq!(profiles.as_array().unwrap().len(), 5);
    let tight = find_profiles(&mut e, json!({"tolerance":1e-9}))["profiles"].clone();
    assert_eq!(tight.as_array().unwrap().len(), 4);
    for bad_tol in [json!(0), json!(-1), json!(1e7), json!("x")] {
        assert!(e
            .apply(Command::new("findProfiles", json!({"tolerance":bad_tol})))
            .is_err());
    }
}

#[test]
fn profiles_nest_deterministic_order_and_batch_guard() {
    let mut e = DraftEngine::new();
    let outer = [(0., 0.), (6., 0.), (6., 4.), (0., 4.)];
    let inner = [(2., 1.), (4., 1.), (4., 3.), (2., 3.)];
    let mut ring_ids = vec![];
    for rect in [outer, inner] {
        let pts: Vec<u64> = rect.iter().map(|&(x, y)| point(&mut e, x, y)).collect();
        for i in 0..4 {
            ring_ids.push(segment(&mut e, pts[i], pts[(i + 1) % 4]));
        }
    }
    let first = find_profiles(&mut e, json!({}));
    let second = find_profiles(&mut e, json!({}));
    assert_eq!(first, second);
    let profiles = first["profiles"].as_array().unwrap();
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0]["loops"].as_array().unwrap().len(), 2);
    // Outer loop first (depth ordering), then the hole; even-odd area 24 - 4.
    assert_eq!(profiles[0]["loops"][0].as_array().unwrap().len(), 4);
    assert_eq!(profiles[0]["loops"][1].as_array().unwrap().len(), 4);
    assert!((profiles[0]["area"].as_f64().unwrap() - 20.).abs() < 1e-9);
    assert_eq!(profiles[0]["centroid"]["x"].as_f64(), Some(3.));
    assert_eq!(profiles[0]["centroid"]["y"].as_f64(), Some(2.));
    assert_eq!(profiles[0]["bounds"]["max_x"].as_f64(), Some(6.));

    // A second disjoint profile sorts after the first by document order.
    let q = [(10., 0.), (12., 0.), (12., 2.), (10., 2.)];
    let pts: Vec<u64> = q.iter().map(|&(x, y)| point(&mut e, x, y)).collect();
    for i in 0..4 {
        segment(&mut e, pts[i], pts[(i + 1) % 4]);
    }
    let profiles = find_profiles(&mut e, json!({}))["profiles"].clone();
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 2);
    assert!(profiles[0]["bounds"]["max_x"].as_f64().unwrap() <= 6.);
    assert_eq!(profiles[1]["area"].as_f64(), Some(4.));

    // Read-only in every context: no journal, no events, revision guard intact.
    // Like describe/evaluate/querySnap it is a revision-bearing read and is
    // rejected inside atomic batches, even a read-only one.
    let before = e.snapshot().unwrap();
    let rev = apply(&mut e, "describe", json!({})).data["source_revision"].clone();
    for commands in [
        json!([{"op":"addPoint","payload":{"x":0,"y":0}},{"op":"findProfiles","payload":{}}]),
        json!([{"op":"findProfiles","payload":{}}]),
    ] {
        assert!(e
            .apply(Command::new(
                ignition_core::OP_BATCH,
                json!({"commands":commands})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    let lone = e.apply(Command::new("findProfiles", json!({}))).unwrap();
    assert_eq!(lone.data["source_revision"], rev);
    assert_eq!(e.snapshot().unwrap(), before);
    let _ = ring_ids;
}

#[test]
fn profiles_chord_closes_tolerance_gap_at_large_coordinates() {
    // A walk whose last edge ends 5e-7 from its start closes within the
    // default 1e-6 tolerance. The implicit closing chord keeps the shoelace
    // and moment integrals exact for the reported polyline; without it the
    // untranslated contour at ~1e6 coordinates picks up O(tol * |coord|)
    // error (about 2 world^2 of double-area here).
    let mut e = DraftEngine::new();
    let (ox, oy) = (999_990.0, 999_990.0);
    let a = point(&mut e, ox, oy);
    let b = point(&mut e, ox + 4., oy);
    let c = point(&mut e, ox + 4., oy + 3.);
    let d = point(&mut e, ox, oy + 3.);
    let near_a = point(&mut e, ox + 5e-7, oy);
    segment(&mut e, a, b);
    segment(&mut e, b, c);
    segment(&mut e, c, d);
    segment(&mut e, d, near_a);
    let profiles = find_profiles(&mut e, json!({}))["profiles"].clone();
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 1);
    // Pre-fix (traversed edges only, no hop chords) this reports area 11.75
    // and centroid x ~1021268: the untranslated contour moments at ~1e6
    // coordinates are not closed-contour invariant. Post-fix residuals are
    // f64 cancellation in the x^2/y^2 moment sums (~1e12 terms), bounded
    // well under these tolerances while still catching the open contour.
    let area = profiles[0]["area"].as_f64().unwrap();
    assert!((area - 12.).abs() < 0.1, "tolerance-closed area {area}");
    let cx = profiles[0]["centroid"]["x"].as_f64().unwrap();
    let cy = profiles[0]["centroid"]["y"].as_f64().unwrap();
    assert!((cx - (ox + 2.)).abs() < 0.5, "centroid x {cx}");
    assert!((cy - (oy + 1.5)).abs() < 0.5, "centroid y {cy}");
    // Tightening the tolerance below the gap leaves an open chain: no profile.
    let tight = find_profiles(&mut e, json!({"tolerance":1e-9}))["profiles"].clone();
    assert_eq!(tight.as_array().unwrap().len(), 0);
}

#[test]
fn profiles_near_coincident_single_segment_emits_no_phantom() {
    // One segment whose endpoints coincide within tolerance traces a
    // one-edge "loop"; the closing chord traverses the same segment in
    // reverse, so the double-area self-cancels and MIN_AREA2 drops it.
    // Away from the origin the uncancelled shoelace term would be nonzero.
    let mut e = DraftEngine::new();
    let a = point(&mut e, 100., 100.);
    let b = point(&mut e, 100.0000005, 100.);
    segment(&mut e, a, b);
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    // Two segments folding out and back to the start coordinate (a distinct
    // point ID may share coordinates) also collapse to exactly zero area.
    let c = point(&mut e, 200., 200.);
    let d = point(&mut e, 201., 200.);
    let dd = point(&mut e, 200., 200.);
    segment(&mut e, c, d);
    segment(&mut e, d, dd);
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[test]
fn profiles_negative_sweep_arc_closes_through_chord() {
    // Negative-sweep half arc plus its chord: analytic circular integrals
    // must combine with the chord into the exact half-disk area/centroid.
    let mut e = DraftEngine::new();
    let ac = point(&mut e, 0., 0.);
    let p0 = point(&mut e, -5., 0.);
    let p1 = point(&mut e, 5., 0.);
    let a = arc(&mut e, ac, 5., 180., -180.);
    let chord = segment(&mut e, p0, p1);
    let profiles = find_profiles(&mut e, json!({}))["profiles"].clone();
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 1);
    assert_eq!(loop_ids(&profiles[0]).len(), 2);
    assert!(loop_ids(&profiles[0]).contains(&a));
    assert!(loop_ids(&profiles[0]).contains(&chord));
    let area = profiles[0]["area"].as_f64().unwrap();
    assert!(
        (area - 12.5 * std::f64::consts::PI).abs() < 1e-6,
        "negative-sweep half-disk area {area}"
    );
    // Upper half (sweep passes through +90 deg): centroid 4r/(3pi) above the
    // diameter, regardless of traversal orientation.
    let cy = profiles[0]["centroid"]["y"].as_f64().unwrap();
    let want = 20. / (3. * std::f64::consts::PI);
    assert!((cy - want).abs() < 1e-6, "centroid y {cy} vs {want}");
}

#[test]
fn profiles_hidden_entities_are_excluded() {
    let mut e = DraftEngine::new();
    let pts: Vec<u64> = [(0., 0.), (4., 0.), (4., 3.), (0., 3.)]
        .iter()
        .map(|&(x, y)| point(&mut e, x, y))
        .collect();
    let mut segs = vec![];
    for i in 0..4 {
        segs.push(segment(&mut e, pts[i], pts[(i + 1) % 4]));
    }
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // Hiding any one rectangle edge opens the chain: no profile.
    apply(
        &mut e,
        "updateSegment",
        json!({"id":segs[2],"visible":false}),
    );
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    apply(
        &mut e,
        "updateSegment",
        json!({"id":segs[2],"visible":true}),
    );
    // A hidden standalone circle never forms a loop either.
    let c = point(&mut e, 20., 20.);
    let circ = circle(&mut e, c, 2.);
    apply(&mut e, "updateCircle", json!({"id":circ,"visible":false}));
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn profiles_junction_and_folded_loop_are_deterministic() {
    // Figure-eight: two squares sharing one corner point. The greedy
    // lowest-document-order rule at the degree-4 junction must resolve both
    // loops deterministically on repeated calls.
    let mut e = DraftEngine::new();
    let j = point(&mut e, 0., 0.);
    let p = point(&mut e, 2., 0.);
    let q = point(&mut e, 2., 2.);
    let r = point(&mut e, 0., 2.);
    let s = point(&mut e, -2., 0.);
    let t = point(&mut e, -2., -2.);
    let u = point(&mut e, 0., -2.);
    for (a, b) in [
        (j, p),
        (p, q),
        (q, r),
        (r, j),
        (j, s),
        (s, t),
        (t, u),
        (u, j),
    ] {
        segment(&mut e, a, b);
    }
    let first = find_profiles(&mut e, json!({}));
    assert_eq!(first, find_profiles(&mut e, json!({})));
    let profiles = first["profiles"].as_array().unwrap();
    assert_eq!(profiles.len(), 2);
    for p in profiles {
        assert!((p["area"].as_f64().unwrap() - 4.).abs() < 1e-9);
    }

    // Folded spur returning to (within tolerance of) its junction plus a
    // real square: the zero-area folded walk is dropped and its edges stay
    // available, while the square still reports exactly one profile.
    let mut f = DraftEngine::new();
    let j = point(&mut f, 10., 10.);
    let a = point(&mut f, 14., 10.);
    let b = point(&mut f, 14., 14.);
    let c = point(&mut f, 10., 14.);
    let spur = point(&mut f, 12., 10.);
    let back = point(&mut f, 10.0000005, 10.);
    // Spur edges are authored first so the folded walk is attempted first.
    segment(&mut f, j, spur);
    segment(&mut f, spur, back);
    segment(&mut f, j, a);
    segment(&mut f, a, b);
    segment(&mut f, b, c);
    segment(&mut f, c, j);
    let profiles = find_profiles(&mut f, json!({}))["profiles"].clone();
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 1);
    assert!((profiles[0]["area"].as_f64().unwrap() - 16.).abs() < 1e-9);
    assert_eq!(
        find_profiles(&mut f, json!({}))["profiles"],
        json!(profiles)
    );
}

fn layer(e: &mut DraftEngine, name: &str) -> u64 {
    apply(e, "addLayer", json!({"name":name})).data["layer_id"]
        .as_u64()
        .unwrap()
}
fn base64_decode(text: &str) -> Vec<u8> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut acc = 0u32;
    let mut bits = 0;
    for &b in text.as_bytes() {
        if b == b'=' {
            break;
        }
        let v = T.iter().position(|&t| t == b).unwrap() as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}
#[test]
fn layers_crud_reserved_names_defaults_and_history_are_atomic() {
    let mut e = DraftEngine::new();
    let walls = layer(&mut e, "Walls");
    assert!(e
        .apply(Command::new("addLayer", json!({"name":"Walls"})))
        .is_err());
    assert!(e
        .apply(Command::new("addLayer", json!({"name":"0"})))
        .is_err());
    assert!(e
        .apply(Command::new("addLayer", json!({"name":""})))
        .is_err());
    let notes = layer(&mut e, "Notes");
    apply(
        &mut e,
        "updateLayer",
        json!({"id":walls,"color":[255,0,0,255],"visible":false,"locked":true}),
    );
    let described = apply(&mut e, "describe", json!({})).data;
    assert_eq!(described["layers"][walls.to_string()]["name"], "Walls");
    assert_eq!(described["layers"][walls.to_string()]["visible"], false);
    // Equal writes preserve events and redo like every other draft op.
    let before = e.snapshot().unwrap();
    let noop = apply(
        &mut e,
        "updateLayer",
        json!({"id":walls,"color":[255,0,0,255],"visible":false,"locked":true}),
    );
    assert!(noop.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    // Reserved/unknown layer 0 and unknown ids reject without mutation.
    for op in ["updateLayer", "removeLayer"] {
        assert!(e.apply(Command::new(op, json!({"id":0}))).is_err());
        assert!(e.apply(Command::new(op, json!({"id":999}))).is_err());
    }
    // Entities default to implicit layer 0; nonzero layers serialize explicitly.
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    let seg = apply(&mut e, "addSegment", json!({"a":a,"b":b,"layer":notes})).data["segment_id"]
        .as_u64()
        .unwrap();
    let described = apply(&mut e, "describe", json!({})).data;
    assert_eq!(described["segments"][seg.to_string()]["layer"], notes);
    let plain = apply(&mut e, "addSegment", json!({"a":a,"b":b})).data["segment_id"]
        .as_u64()
        .unwrap();
    let described = apply(&mut e, "describe", json!({})).data;
    assert!(described["segments"][plain.to_string()]
        .get("layer")
        .is_none());
    // Nonempty layers reject removal; empty ones remove and undo/redo cleanly.
    assert!(e
        .apply(Command::new("removeLayer", json!({"id":notes})))
        .is_err());
    apply(&mut e, "removeSegment", json!({"id":seg}));
    apply(&mut e, "removeLayer", json!({"id":notes}));
    let snapshot = e.snapshot().unwrap();
    assert!(state(&e).layers.get(&notes).is_none());
    assert!(e.undo().unwrap());
    assert_eq!(state(&e).layers[&notes].name, "Notes");
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), snapshot);
    // Rename keeps uniqueness against peers and the reserved implicit name.
    let other = layer(&mut e, "Other");
    assert!(e
        .apply(Command::new(
            "updateLayer",
            json!({"id":walls,"name":"Other"})
        ))
        .is_err());
    assert!(e
        .apply(Command::new("updateLayer", json!({"id":walls,"name":"0"})))
        .is_err());
    apply(&mut e, "updateLayer", json!({"id":walls,"name":"Walls2"}));
    assert_eq!(state(&e).layers[&walls].name, "Walls2");
    assert!(state(&e).layers.contains_key(&other));
}
#[test]
fn hidden_layers_exclude_snaps_render_and_profiles() {
    let mut e = DraftEngine::new();
    let hidden = layer(&mut e, "Hidden");
    apply(&mut e, "updateLayer", json!({"id":hidden,"visible":false}));
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    let c = point(&mut e, 0., 3.);
    let d = point(&mut e, 3., 3.);
    let mut edges = Vec::new();
    for (p, q) in [(a, b), (b, d), (d, c), (c, a)] {
        edges.push(
            apply(&mut e, "addSegment", json!({"a":p,"b":q,"layer":hidden})).data["segment_id"]
                .as_u64()
                .unwrap(),
        );
    }
    // Midpoint/projection snaps and closed profiles ignore hidden-layer geometry.
    apply(
        &mut e,
        "setSnapSettings",
        json!({"grid":false,"endpoint":false,"projection":true,"intersection":false,"midpoint":true}),
    );
    assert!(apply(
        &mut e,
        "querySnap",
        json!({"x":1.5,"y":0.1,"tolerance":0.2})
    )
    .data["candidate"]
        .is_null());
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    // Render emits no stroke for the hidden rectangle.
    let pixels = apply(&mut e, "renderFrame", viewport()).data;
    let rgba = base64_decode(pixels["pixels_b64"].as_str().unwrap());
    assert!(rgba.iter().all(|v| *v == 0));
    // Restoring visibility returns real candidates, pixels and the profile.
    apply(&mut e, "updateLayer", json!({"id":hidden,"visible":true}));
    let snap = apply(
        &mut e,
        "querySnap",
        json!({"x":1.5,"y":0.1,"tolerance":0.2}),
    )
    .data;
    assert_eq!(snap["candidate"]["kind"], "midpoint");
    assert_eq!(snap["candidate"]["sources"], json!([edges[0]]));
    let pixels = apply(&mut e, "renderFrame", viewport()).data;
    let rgba = base64_decode(pixels["pixels_b64"].as_str().unwrap());
    assert!(rgba.iter().any(|v| *v != 0));
    let profiles = find_profiles(&mut e, json!({}));
    assert_eq!(profiles["profiles"].as_array().unwrap().len(), 1);
    assert!((profiles["profiles"][0]["area"].as_f64().unwrap() - 9.).abs() < 1e-9);
    // A hidden-layer circle loses center/nearest snaps like any hidden entity.
    let center = point(&mut e, 1.5, 1.5);
    apply(
        &mut e,
        "addCircle",
        json!({"center":center,"radius":1,"layer":hidden}),
    );
    apply(&mut e, "updateLayer", json!({"id":hidden,"visible":false}));
    apply(
        &mut e,
        "setSnapSettings",
        json!({"midpoint":false,"projection":false,"center":true,"nearest_circle":true}),
    );
    let snap = apply(
        &mut e,
        "querySnap",
        json!({"x":1.6,"y":1.5,"tolerance":0.5}),
    )
    .data;
    assert!(snap["candidate"].is_null());
}
#[test]
fn locked_layers_reject_edits_until_unlocked_and_assignment_is_allowed() {
    let mut e = DraftEngine::new();
    let locked = layer(&mut e, "Locked");
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":true}));
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    let seg = apply(&mut e, "addSegment", json!({"a":a,"b":b,"layer":locked})).data["segment_id"]
        .as_u64()
        .unwrap();
    let before = e.snapshot().unwrap();
    for (op, p) in [
        ("updateSegment", json!({"id":seg,"name":"renamed"})),
        ("updateSegment", json!({"id":seg,"layer":0})),
        ("removeSegment", json!({"id":seg})),
        ("updatePoint", json!({"id":a,"x":9.})),
        ("removePoint", json!({"id":a})),
    ] {
        assert!(e.apply(Command::new(op, p)).is_err(), "{op} must reject");
    }
    assert_eq!(e.snapshot().unwrap(), before);
    // New entities may be assigned to a locked layer, then share its lock.
    let c = point(&mut e, 0., 3.);
    let d = point(&mut e, 3., 3.);
    let other = apply(&mut e, "addSegment", json!({"a":c,"b":d,"layer":locked})).data["segment_id"]
        .as_u64()
        .unwrap();
    assert!(e
        .apply(Command::new(
            "updateSegment",
            json!({"id":other,"visible":false})
        ))
        .is_err());
    // Unlocking the layer restores edits; re-locking rejects them again.
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":false}));
    apply(&mut e, "updateSegment", json!({"id":seg,"name":"renamed"}));
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":true}));
    assert!(e
        .apply(Command::new(
            "updateSegment",
            json!({"id":seg,"name":"again"})
        ))
        .is_err());
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":false}));
    apply(&mut e, "updateSegment", json!({"id":seg,"name":"final"}));
    assert_eq!(state(&e).segments[&seg].name, "final");
    // Unknown layer assignment fails closed through full state validation.
    assert!(e
        .apply(Command::new(
            "addSegment",
            json!({"a":a,"b":b,"layer":4242})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "updateSegment",
            json!({"id":other,"layer":4242})
        ))
        .is_err());
}
#[test]
fn layer_snapshots_wrapper_defaults_and_hostile_restore() {
    let mut e = DraftEngine::new();
    // Layer-0-only documents keep the exact legacy bare serialization.
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    apply(&mut e, "addSegment", json!({"a":a,"b":b}));
    let legacy = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&legacy).unwrap();
    let value: Value = serde_json::from_slice(payload).unwrap();
    assert!(value.get("layers").is_none());
    assert!(value["segments"]["3"].get("layer").is_none());
    let mut reopened = DraftEngine::new();
    reopened.restore(&legacy).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), legacy);
    assert!(state(&reopened).layers.is_empty());
    // Any real layer usage requires the strict schema2 wrapper.
    let walls = layer(&mut e, "Walls");
    let seg = apply(&mut e, "addSegment", json!({"a":a,"b":b,"layer":walls})).data["segment_id"]
        .as_u64()
        .unwrap();
    let extended = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&extended).unwrap();
    let wrapped: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(wrapped["kind"], "draft");
    assert_eq!(wrapped["schema"], 2);
    assert_eq!(
        wrapped["document"]["layers"][walls.to_string()]["name"],
        "Walls"
    );
    reopened.restore(&extended).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), extended);
    assert_eq!(state(&reopened).segments[&seg].layer, walls);
    let before = reopened.snapshot().unwrap();
    // Hostile restores: dangling entity layer refs, reserved id 0, duplicate
    // names, unwrapped extended state and malformed layer fields all reject.
    let mut cases: Vec<Value> = Vec::new();
    let mut dangling = wrapped.clone();
    dangling["document"]["segments"][seg.to_string()]["layer"] = json!(4242);
    cases.push(dangling);
    let mut reserved = wrapped.clone();
    reserved["document"]["layers"]["0"] =
        json!({"id":0,"name":"Zero","color":null,"visible":true,"locked":false});
    cases.push(reserved);
    let mut duplicate = wrapped.clone();
    duplicate["document"]["layers"]["77"] =
        json!({"id":77,"name":"Walls","color":null,"visible":true,"locked":false});
    cases.push(duplicate);
    cases.push(wrapped["document"].clone());
    let mut bad_field = wrapped.clone();
    bad_field["document"]["segments"][seg.to_string()]["layer"] = json!("Walls");
    cases.push(bad_field);
    let mut empty_name = wrapped.clone();
    empty_name["document"]["layers"][walls.to_string()]["name"] = json!("");
    cases.push(empty_name);
    for invalid in cases {
        assert!(reopened
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(reopened.snapshot().unwrap(), before);
    }
    // Removing the last nonzero-layer entity still keeps the layer map, so the
    // wrapper requirement follows the map, not entity usage.
    apply(&mut e, "removeSegment", json!({"id":seg}));
    let still_wrapped = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&still_wrapped).unwrap();
    let value: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(value["schema"], 2);
    reopened.restore(&still_wrapped).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), still_wrapped);
}
fn square(e: &mut DraftEngine, size: f64, layer: u64) -> Vec<u64> {
    let a = point(e, 0., 0.);
    let b = point(e, size, 0.);
    let c = point(e, size, size);
    let d = point(e, 0., size);
    let mut edges = Vec::new();
    for (p, q) in [(a, b), (b, c), (c, d), (d, a)] {
        edges.push(
            apply(e, "addSegment", json!({"a":p,"b":q,"layer":layer})).data["segment_id"]
                .as_u64()
                .unwrap(),
        );
    }
    edges
}
fn hatch(e: &mut DraftEngine, payload: Value) -> u64 {
    apply(e, "addHatch", payload).data["hatch_id"]
        .as_u64()
        .unwrap()
}
fn pixels(e: &mut DraftEngine, w: u32, h: u32) -> Vec<u8> {
    let data = apply(
        e,
        "renderFrame",
        json!({"width":w,"height":h,"origin_x":0,"origin_y":0,"scale":1}),
    )
    .data;
    base64_decode(data["pixels_b64"].as_str().unwrap())
}
fn px(rgba: &[u8], w: u32, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * w + x) * 4) as usize;
    [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}
#[test]
fn hatches_solid_fill_and_line_patterns_render_real_clipped_pixels() {
    let mut e = DraftEngine::new();
    let edges = square(&mut e, 4., 0);
    // Solid fill via traced boundary ids: the interior pixel is exactly the
    // hatch color and nothing paints outside the loop.
    let solid = hatch(
        &mut e,
        json!({"boundary_ids":edges,"pattern":"solid","color":[255,0,0,255]}),
    );
    let rgba = pixels(&mut e, 6, 6);
    assert_eq!(px(&rgba, 6, 2, 2), [255, 0, 0, 255]);
    // Outside the 4x4 square but inside the 6x6 viewport stays transparent.
    assert_eq!(px(&rgba, 6, 5, 5)[3], 0);
    // Line pattern: real clipped strokes, sparse enough that the center is
    // not a solid fill and pixels differ from the solid render.
    apply(
        &mut e,
        "updateHatch",
        json!({"id":solid,"pattern":"ansi31","scale":1.,"width":0.5}),
    );
    let lines = pixels(&mut e, 5, 5);
    assert_ne!(lines, rgba);
    assert!(lines.iter().any(|v| *v != 0));
    // Crosshatch and horizontal are distinct admitted builtins.
    for pattern in ["crosshatch", "horizontal"] {
        apply(&mut e, "updateHatch", json!({"id":solid,"pattern":pattern}));
        assert!(pixels(&mut e, 5, 5).iter().any(|v| *v != 0));
    }
    // A circle boundary resolves through the same tracer.
    let center = point(&mut e, 8., 2.);
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":2.})).data["circle_id"]
        .as_u64()
        .unwrap();
    let disc = hatch(
        &mut e,
        json!({"boundary_ids":[circle],"pattern":"solid","color":[0,0,255,255]}),
    );
    let rgba = pixels(&mut e, 12, 5);
    // Viewport is 12x5 world units at scale 1: pixel (8,2) is the disc center.
    assert_eq!(px(&rgba, 12, 8, 2), [0, 0, 255, 255]);
    // Explicit point loops are admitted directly; rotation/scale/width are
    // bounded style fields.
    let tri = hatch(
        &mut e,
        json!({"loops":[[[20.,0.],[23.,0.],[21.5,2.]]],"pattern":"ansi31","angle":30.,"scale":0.5,"width":0.25,"color":[0,255,0,255]}),
    );
    assert!(state(&e).hatches[&tri].loops[0].len() == 3);
    // Equal writes are read-only; undo/redo restores each step.
    let before = e.snapshot().unwrap();
    let noop = apply(&mut e, "updateHatch", json!({"id":tri,"name":"Hatch"}));
    assert!(noop.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    apply(&mut e, "removeHatch", json!({"id":disc}));
    assert!(e.undo().unwrap());
    assert!(state(&e).hatches.contains_key(&disc));
    assert!(e.redo().unwrap());
    assert!(!state(&e).hatches.contains_key(&disc));
}
#[test]
fn hatch_line_patterns_pair_coincident_crossings() {
    let mut e = DraftEngine::new();
    // Regression: a boundary vertex lying exactly on a pattern line
    // contributes two coincident crossings. The square plus the triangle
    // whose apex (5,12) sits on the horizontal y=12 line yields hits
    // [0,5,5,10]; the coincident pair must survive pairing so both halves
    // of the [0,10] span draw (deduping used to drop the second half).
    let loops = vec![
        vec![[0., 0.], [10., 0.], [10., 13.], [0., 13.]],
        vec![[4., 14.], [6., 14.], [5., 12.]],
    ];
    let segs = crate::hatch::line_segments(&loops, (1., 0.), (0., 1.), 12.).unwrap();
    assert_eq!(segs.len(), 2);
    let us: Vec<(f64, f64)> = segs
        .iter()
        .map(|(a, b)| (a[0].min(b[0]), a[0].max(b[0])))
        .collect();
    for (got, want) in us.iter().zip([(0., 5.), (5., 10.)]) {
        assert!(
            (got.0 - want.0).abs() < 1e-6 && (got.1 - want.1).abs() < 1e-6,
            "interval {got:?} != {want:?}"
        );
    }
    hatch(
        &mut e,
        json!({"loops":[[[0.,0.],[10.,0.],[10.,13.],[0.,13.]],[[4.,14.],[6.,14.],[5.,12.]]],"pattern":"horizontal","scale":1.,"width":2.,"color":[255,0,0,255]}),
    );
    let rgba = pixels(&mut e, 11, 15);
    // Real pixels along the full clipped span, including past the apex.
    assert_eq!(px(&rgba, 11, 2, 12), [255, 0, 0, 255]);
    assert_eq!(px(&rgba, 11, 8, 12), [255, 0, 0, 255]);
    // Above the triangle and beside the pattern lines stays transparent.
    assert_eq!(px(&rgba, 11, 5, 14)[3], 0);
}
#[test]
fn hatch_line_patterns_shared_edges_and_even_odd_holes() {
    // Two squares sharing the full edge x=4: coincident crossings on the
    // shared edge must not collapse, so coverage runs continuously [0,8].
    let mut e = DraftEngine::new();
    hatch(
        &mut e,
        json!({"loops":[[[0.,0.],[4.,0.],[4.,4.],[0.,4.]],[[4.,0.],[8.,0.],[8.,4.],[4.,4.]]],"pattern":"horizontal","scale":0.5,"width":1.5,"color":[0,255,0,255]}),
    );
    let rgba = pixels(&mut e, 9, 5);
    for x in [1, 4, 7] {
        assert_eq!(px(&rgba, 9, x, 1), [0, 255, 0, 255], "x={x}");
    }
    // Nested loops form an even-odd hole: interior pattern lines paint
    // [0,4] and [8,12] but leave (4,8) empty.
    let mut e = DraftEngine::new();
    hatch(
        &mut e,
        json!({"loops":[[[0.,0.],[12.,0.],[12.,12.],[0.,12.]],[[4.,4.],[8.,4.],[8.,8.],[4.,8.]]],"pattern":"horizontal","scale":0.5,"width":3.,"color":[0,0,255,255]}),
    );
    let rgba = pixels(&mut e, 13, 13);
    assert_eq!(px(&rgba, 13, 2, 6), [0, 0, 255, 255]);
    assert_eq!(px(&rgba, 13, 10, 6), [0, 0, 255, 255]);
    assert_eq!(px(&rgba, 13, 6, 6)[3], 0);
    assert_eq!(px(&rgba, 13, 6, 5)[3], 0);
}
#[test]
fn hatch_boundary_tracing_is_validated_and_hatches_are_not_associative() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    let c = point(&mut e, 3., 3.);
    let d = point(&mut e, 0., 3.);
    let open = segment(&mut e, a, b);
    let _tail = segment(&mut e, b, c);
    let before = e.snapshot().unwrap();
    // Open chains, unknown ids, point ids and duplicates all reject atomically.
    for ids in [
        json!([open, _tail]),
        json!([open, 9999]),
        json!([open, a]),
        json!([open, open]),
        json!([]),
    ] {
        assert!(e
            .apply(Command::new("addHatch", json!({"boundary_ids":ids})))
            .is_err());
    }
    assert_eq!(e.snapshot().unwrap(), before);
    // Close the square; boundary tracing succeeds in any id order.
    let e1 = segment(&mut e, c, d);
    let e2 = segment(&mut e, d, a);
    let ids = vec![e2, open, e1, _tail];
    let h = hatch(&mut e, json!({"boundary_ids":ids,"pattern":"solid"}));
    let loops = state(&e).hatches[&h].loops.clone();
    assert_eq!(loops.len(), 1);
    assert!(loops[0].len() >= 4);
    // Non-associative: moving a boundary entity later does not move the hatch.
    apply(&mut e, "updatePoint", json!({"id":a,"x":9.}));
    assert_eq!(state(&e).hatches[&h].loops, loops);
    // Explicit loops must be closed polygons with real area.
    for loops in [
        json!([]),
        json!([[[0., 0.], [1., 0.]]]),
        json!([[[0., 0.], [1., 0.], [2., 0.]]]),
        json!([[[0., 0.], [1., 1.], [2., 2.], [3., 3.]]]),
    ] {
        assert!(e
            .apply(Command::new("addHatch", json!({"loops":loops})))
            .is_err());
    }
    // Both boundary sources at once, or neither, reject.
    assert!(e
        .apply(Command::new(
            "addHatch",
            json!({"loops":[[[0.,0.],[1.,0.],[0.,1.]]],"boundary_ids":[open]})
        ))
        .is_err());
    assert!(e
        .apply(Command::new("addHatch", json!({"pattern":"solid"})))
        .is_err());
    // `tolerance` only applies to boundary_ids tracing, never explicit loops.
    assert!(e
        .apply(Command::new(
            "addHatch",
            json!({"loops":[[[0.,0.],[4.,0.],[0.,4.]]],"tolerance":0.5})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "updateHatch",
            json!({"id":h,"loops":[[[0.,0.],[4.,0.],[0.,4.]]],"tolerance":0.5})
        ))
        .is_err());
    // Style bounds and unknown patterns reject through full validation.
    for patch in [
        json!({"pattern":"bogus"}),
        json!({"scale":0.}),
        json!({"scale":2000.}),
        json!({"angle":400000.}),
        json!({"width":0.}),
        json!({"color":[0,0,0]}),
        json!({"layer":4242}),
    ] {
        let mut payload = json!({"loops":[[[0.,0.],[4.,0.],[0.,4.]]],"pattern":"solid"});
        for (k, v) in patch.as_object().unwrap() {
            payload[k] = v.clone();
        }
        assert!(e.apply(Command::new("addHatch", payload)).is_err());
    }
}
#[test]
fn hatch_layers_locks_layer_removal_and_matching_reader_restore() {
    let mut e = DraftEngine::new();
    let hidden = layer(&mut e, "HatchLayer");
    apply(&mut e, "updateLayer", json!({"id":hidden,"visible":false}));
    let edges = square(&mut e, 4., 0);
    let on_hidden = hatch(
        &mut e,
        json!({"boundary_ids":edges,"pattern":"solid","color":[255,0,0,255],"layer":hidden}),
    );
    // Hidden layer: entity strokes draw, the fill does not.
    let rgba = pixels(&mut e, 5, 5);
    assert_ne!(px(&rgba, 5, 2, 2), [255, 0, 0, 255]);
    assert!(rgba.iter().any(|v| *v != 0));
    apply(&mut e, "updateLayer", json!({"id":hidden,"visible":true}));
    assert_eq!(px(&pixels(&mut e, 5, 5), 5, 2, 2), [255, 0, 0, 255]);
    // Locked layer rejects hatch edits/removal until unlocked.
    apply(&mut e, "updateLayer", json!({"id":hidden,"locked":true}));
    let before = e.snapshot().unwrap();
    for (op, p) in [
        ("updateHatch", json!({"id":on_hidden,"name":"x"})),
        ("updateHatch", json!({"id":on_hidden,"visible":false})),
        ("removeHatch", json!({"id":on_hidden})),
    ] {
        assert!(e.apply(Command::new(op, p)).is_err(), "{op} must reject");
    }
    assert_eq!(e.snapshot().unwrap(), before);
    apply(&mut e, "updateLayer", json!({"id":hidden,"locked":false}));
    // removeLayer refuses while a hatch references the layer.
    assert!(e
        .apply(Command::new("removeLayer", json!({"id":hidden})))
        .is_err());
    // Entity lock semantics mirror other entities.
    let free = hatch(&mut e, json!({"boundary_ids":edges,"pattern":"solid"}));
    apply(&mut e, "updateHatch", json!({"id":free,"locked":true}));
    assert!(e
        .apply(Command::new("updateHatch", json!({"id":free,"name":"x"})))
        .is_err());
    assert!(e
        .apply(Command::new("removeHatch", json!({"id":free})))
        .is_err());
    apply(&mut e, "updateHatch", json!({"id":free,"locked":false}));
    // Any hatch forces the strict schema2 wrapper; bare extended state and
    // hostile hatch fields fail closed on restore.
    let wrapped = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&wrapped).unwrap();
    let value: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(value["kind"], "draft");
    assert_eq!(value["schema"], 2);
    assert!(value["document"]["hatches"][free.to_string()]["loops"].is_array());
    let mut reopened = DraftEngine::new();
    reopened.restore(&wrapped).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), wrapped);
    let before = reopened.snapshot().unwrap();
    let mut cases: Vec<Value> = Vec::new();
    let mut bare = value["document"].clone();
    cases.push(bare.clone());
    bare["hatches"][free.to_string()]["pattern"] = json!("bogus");
    cases.push(json!({"kind":"draft","schema":2,"document":bare}));
    let mut dangling = value.clone();
    dangling["document"]["hatches"][free.to_string()]["layer"] = json!(4242);
    cases.push(dangling);
    let mut bad_loop = value.clone();
    bad_loop["document"]["hatches"][free.to_string()]["loops"] = json!([[[0., 0.], [1., 0.]]]);
    cases.push(bad_loop);
    // Hostile style/coordinate bounds on hatch fields fail closed too.
    for (key, bad_value) in [
        ("angle", json!(400000.)),
        ("scale", json!(2000.)),
        ("width", json!(0.)),
        ("name", json!("x".repeat(600))),
    ] {
        let mut bad_field = value.clone();
        bad_field["document"]["hatches"][free.to_string()][key] = bad_value;
        cases.push(bad_field);
    }
    let mut bad_coord = value.clone();
    bad_coord["document"]["hatches"][free.to_string()]["loops"] =
        json!([[[0., 0.], [2e6, 0.], [0., 1.]]]);
    cases.push(bad_coord);
    let mut unknown_field = value.clone();
    unknown_field["document"]["hatches"][free.to_string()]["extra"] = json!(1);
    cases.push(unknown_field);
    for invalid in cases {
        assert!(reopened
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(reopened.snapshot().unwrap(), before);
    }
    // Undo across the whole hatch lifecycle and describe exposes the map.
    apply(&mut e, "removeHatch", json!({"id":free}));
    assert!(!state(&e).hatches.contains_key(&free));
    assert!(e.undo().unwrap());
    assert!(state(&e).hatches.contains_key(&free));
    let described = apply(&mut e, "describe", json!({})).data;
    assert_eq!(described["hatches"][free.to_string()]["pattern"], "solid");
    let evaluated = apply(&mut e, "evaluate", json!({})).data;
    assert!(evaluated["hatches"][free.to_string()]["loops"].is_array());
}
fn dimension(e: &mut DraftEngine, payload: Value) -> u64 {
    apply(e, "addDimension", payload).data["dimension_id"]
        .as_u64()
        .unwrap()
}
fn evaluate(e: &mut DraftEngine) -> Value {
    apply(e, "evaluate", json!({})).data
}
#[test]
fn dimensions_measure_linked_geometry_and_recompute_associatively() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 4., 0.);
    let c = point(&mut e, 4., 3.);
    let linear = dimension(
        &mut e,
        json!({"kind":"linear","points":[a,b],"axis":"x","color":[255,0,0,255]}),
    );
    let mut ev = evaluate(&mut e);
    let d = &ev["dimensions"][linear.to_string()];
    assert_eq!(d["status"], "linked");
    assert_eq!(d["measured"]["value"], 4.);
    assert!(d["measured"]["lines"].as_array().unwrap().len() >= 3);
    // Associative: moving a referenced point recomputes the measurement.
    apply(&mut e, "updatePoint", json!({"id":b,"x":7.}));
    ev = evaluate(&mut e);
    assert_eq!(
        ev["dimensions"][linear.to_string()]["measured"]["value"],
        7.
    );
    // Aligned measures the direct distance; angular the unsigned vertex angle.
    let aligned = dimension(&mut e, json!({"kind":"aligned","points":[a,c]}));
    ev = evaluate(&mut e);
    let got = ev["dimensions"][aligned.to_string()]["measured"]["value"]
        .as_f64()
        .unwrap();
    assert!((got - 4f64.hypot(3.)).abs() < 1e-9);
    let angular = dimension(&mut e, json!({"kind":"angular","points":[a,b,c]}));
    ev = evaluate(&mut e);
    let got = ev["dimensions"][angular.to_string()]["measured"]["value"]
        .as_f64()
        .unwrap();
    // Vertex a=(0,0); rays to b=(7,0) and c=(4,3): angle between them.
    let want = (28f64 / 35.).acos().to_degrees();
    assert!((got - want).abs() < 1e-9);
    // Radial/diameter measure circle and arc entities.
    let center = point(&mut e, 20., 0.);
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":3.})).data["circle_id"]
        .as_u64()
        .unwrap();
    let arc = apply(
        &mut e,
        "addArc",
        json!({"center":center,"radius":3.,"start_deg":90.,"sweep_deg":90.}),
    )
    .data["arc_id"]
        .as_u64()
        .unwrap();
    let radial = dimension(&mut e, json!({"kind":"radial","entity":circle}));
    let diameter = dimension(&mut e, json!({"kind":"diameter","entity":arc}));
    ev = evaluate(&mut e);
    assert_eq!(
        ev["dimensions"][radial.to_string()]["measured"]["value"],
        3.
    );
    assert_eq!(
        ev["dimensions"][diameter.to_string()]["measured"]["value"],
        6.
    );
    // Real stroked pixels: only dimensions exist, no segments.
    let rgba = pixels(&mut e, 24, 4);
    assert!(rgba.iter().any(|v| *v != 0));
    // Describe exposes the authored map; evaluate adds status/measured.
    let described = apply(&mut e, "describe", json!({})).data;
    assert_eq!(
        described["dimensions"][linear.to_string()]["kind"],
        "linear"
    );
    assert!(described["dimensions"][linear.to_string()]
        .get("status")
        .is_none());
}
#[test]
fn dimension_orphans_on_delete_relinks_and_keeps_style_edits() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 5., 0.);
    let dim = dimension(
        &mut e,
        json!({"kind":"linear","points":[a,b],"axis":"y","name":"Width"}),
    );
    // Deleting a referenced point orphans the dimension instead of
    // rejecting: measured geometry clears, references stay authored.
    apply(&mut e, "removePoint", json!({"id":a}));
    let ev = evaluate(&mut e);
    let d = &ev["dimensions"][dim.to_string()];
    assert_eq!(d["status"], "orphaned");
    assert!(d["measured"].is_null());
    assert_eq!(d["points"], json!([a, b]));
    // Orphaned dimensions render nothing.
    assert!(pixels(&mut e, 6, 2).iter().all(|v| *v == 0));
    // Style-only edits on an orphan stay allowed; reference edits must resolve.
    apply(
        &mut e,
        "updateDimension",
        json!({"id":dim,"name":"Renamed","visible":false}),
    );
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "updateDimension",
            json!({"id":dim,"points":[a,b]})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Re-linking to live points restores measurement.
    let c = point(&mut e, 1., 1.);
    let dpt = point(&mut e, 1., 6.);
    apply(
        &mut e,
        "updateDimension",
        json!({"id":dim,"points":[c,dpt],"visible":true}),
    );
    let ev = evaluate(&mut e);
    let d = &ev["dimensions"][dim.to_string()];
    assert_eq!(d["status"], "linked");
    assert_eq!(d["measured"]["value"], 5.);
    // Entity deletion orphans radial/diameter references the same way.
    let center = point(&mut e, 20., 0.);
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":2.})).data["circle_id"]
        .as_u64()
        .unwrap();
    let radial = dimension(&mut e, json!({"kind":"radial","entity":circle}));
    apply(&mut e, "removeCircle", json!({"id":circle}));
    let ev = evaluate(&mut e);
    assert_eq!(ev["dimensions"][radial.to_string()]["status"], "orphaned");
    // Undo/redo across the whole lifecycle.
    assert!(e.undo().unwrap());
    assert!(evaluate(&mut e)["dimensions"][radial.to_string()]["status"] == "linked");
    assert!(e.redo().unwrap());
    assert_eq!(
        evaluate(&mut e)["dimensions"][radial.to_string()]["status"],
        "orphaned"
    );
}
#[test]
fn dimension_validation_is_atomic_and_bounds_enforced() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 1., 0.);
    let seg = segment(&mut e, a, b);
    let before = e.snapshot().unwrap();
    for payload in [
        // Unknown kind, missing/extra references, wrong axis pairing.
        json!({"kind":"bogus","points":[a,b]}),
        json!({"kind":"linear","points":[a]}),
        json!({"kind":"linear","points":[a,b]}),
        json!({"kind":"linear","points":[a,b],"axis":"z"}),
        json!({"kind":"aligned","points":[a,b],"axis":"x"}),
        json!({"kind":"angular","points":[a,b]}),
        json!({"kind":"angular","points":[a,a,b]}),
        json!({"kind":"radial"}),
        json!({"kind":"radial","entity":seg}),
        json!({"kind":"linear","points":[a,b],"axis":"x","entity":1}),
        json!({"kind":"linear","points":[a,9999],"axis":"x"}),
        json!({"kind":"linear","points":[a,seg],"axis":"x"}),
        json!({"kind":"radial","entity":9999}),
        json!({"kind":"linear","points":[a,b],"axis":"x","width":0.}),
        json!({"kind":"linear","points":[a,b],"axis":"x","layer":4242}),
        json!({"kind":"linear","points":[a,b],"axis":"x","bogus":1}),
    ] {
        assert!(
            e.apply(Command::new("addDimension", payload)).is_err(),
            "payload must reject"
        );
    }
    assert_eq!(e.snapshot().unwrap(), before);
    // Count budget: 64 dimensions maximum.
    let mut ids = Vec::new();
    for _ in 0..64 {
        ids.push(dimension(
            &mut e,
            json!({"kind":"linear","points":[a,b],"axis":"x"}),
        ));
    }
    assert!(e
        .apply(Command::new(
            "addDimension",
            json!({"kind":"linear","points":[a,b],"axis":"x"})
        ))
        .is_err());
    // Kind/shape changes through updateDimension revalidate atomically.
    let first = ids[0];
    assert!(e
        .apply(Command::new(
            "updateDimension",
            json!({"id":first,"kind":"radial"})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "updateDimension",
            json!({"id":first,"axis":null,"kind":"aligned"})
        ))
        .is_ok());
    assert_eq!(state(&e).dimensions[&first].kind, model::DimKind::Aligned);
}
#[test]
fn dimension_layers_locks_removal_and_matching_reader_restore() {
    let mut e = DraftEngine::new();
    let lay = layer(&mut e, "Dims");
    apply(&mut e, "updateLayer", json!({"id":lay,"visible":false}));
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    let _seg = apply(&mut e, "addSegment", json!({"a":a,"b":b,"layer":lay})).data["segment_id"]
        .as_u64()
        .unwrap();
    let dim = dimension(
        &mut e,
        json!({"kind":"linear","points":[a,b],"axis":"x","layer":lay,"color":[0,0,255,255]}),
    );
    // Hidden layer: dimension strokes do not render.
    assert!(pixels(&mut e, 4, 1).iter().all(|v| *v == 0));
    apply(&mut e, "updateLayer", json!({"id":lay,"visible":true}));
    assert!(pixels(&mut e, 4, 1).iter().any(|v| *v != 0));
    // Locked layer rejects dimension edits/removal until unlocked.
    apply(&mut e, "updateLayer", json!({"id":lay,"locked":true}));
    let before = e.snapshot().unwrap();
    for (op, p) in [
        ("updateDimension", json!({"id":dim,"name":"x"})),
        ("removeDimension", json!({"id":dim})),
    ] {
        assert!(e.apply(Command::new(op, p)).is_err(), "{op} must reject");
    }
    assert_eq!(e.snapshot().unwrap(), before);
    apply(&mut e, "updateLayer", json!({"id":lay,"locked":false}));
    // removeLayer refuses while a dimension references the layer.
    assert!(e
        .apply(Command::new("removeLayer", json!({"id":lay})))
        .is_err());
    // Entity lock semantics mirror hatches/entities.
    let free = dimension(&mut e, json!({"kind":"aligned","points":[a,b]}));
    apply(&mut e, "updateDimension", json!({"id":free,"locked":true}));
    assert!(e
        .apply(Command::new(
            "updateDimension",
            json!({"id":free,"name":"x"})
        ))
        .is_err());
    assert!(e
        .apply(Command::new("removeDimension", json!({"id":free})))
        .is_err());
    apply(&mut e, "updateDimension", json!({"id":free,"locked":false}));
    apply(&mut e, "removeDimension", json!({"id":free}));
    assert!(e.undo().unwrap());
    assert!(state(&e).dimensions.contains_key(&free));
    // Any dimension forces the strict schema2 wrapper; hostile restores of
    // every new field family fail closed.
    let wrapped = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&wrapped).unwrap();
    let value: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(value["kind"], "draft");
    assert_eq!(value["schema"], 2);
    assert_eq!(
        value["document"]["dimensions"][dim.to_string()]["kind"],
        "linear"
    );
    let mut reopened = DraftEngine::new();
    reopened.restore(&wrapped).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), wrapped);
    let before = reopened.snapshot().unwrap();
    let mut cases: Vec<Value> = Vec::new();
    cases.push(value["document"].clone()); // unwrapped extended state
                                           // A dimension point id that exists only as a segment is malformed even
                                           // though absent point ids are legal orphans.
    let seg_id = state(&e).segments.keys().next().copied().unwrap();
    let mut wrong_kind_ref = value.clone();
    wrong_kind_ref["document"]["dimensions"][dim.to_string()]["points"] = json!([a, seg_id]);
    cases.push(wrong_kind_ref);
    let mut bad_kind = value.clone();
    bad_kind["document"]["dimensions"][dim.to_string()]["kind"] = json!("bogus");
    cases.push(bad_kind);
    let mut bad_axis = value.clone();
    bad_axis["document"]["dimensions"][dim.to_string()]["axis"] = json!("z");
    cases.push(bad_axis);
    let mut dangling_layer = value.clone();
    dangling_layer["document"]["dimensions"][dim.to_string()]["layer"] = json!(4242);
    cases.push(dangling_layer);
    let mut unknown_field = value.clone();
    unknown_field["document"]["dimensions"][dim.to_string()]["extra"] = json!(1);
    cases.push(unknown_field);
    let mut orphan_point_ref_wrong_type = value.clone();
    orphan_point_ref_wrong_type["document"]["dimensions"][dim.to_string()]["points"] =
        json!([999999, seg_id]);
    cases.push(orphan_point_ref_wrong_type);
    for invalid in cases {
        assert!(reopened
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(reopened.snapshot().unwrap(), before);
    }
    // A legal orphan (absent point id) restores fine and reports orphaned.
    let mut orphan = value.clone();
    orphan["document"]["dimensions"][dim.to_string()]["points"] = json!([a, 424242]);
    let bytes = encode_envelope(&serde_json::to_vec(&orphan).unwrap());
    reopened.restore(&bytes).unwrap();
    let ev = apply(&mut reopened, "evaluate", json!({})).data;
    assert_eq!(ev["dimensions"][dim.to_string()]["status"], "orphaned");
}
#[test]
fn dimension_arrow_overshoot_at_world_budget_boundary_omits_legs() {
    let mut e = DraftEngine::new();
    // Points authored exactly on the ±1e6 world budget: the derived
    // dimension/extension lines stay in bounds, but schematic arrowhead
    // legs would overshoot past it. Overshooting legs are omitted rather
    // than failing the whole measurement.
    let a = point(&mut e, 0., 1e6);
    let b = point(&mut e, 4., 1e6);
    let linear = dimension(&mut e, json!({"kind":"linear","points":[a,b],"axis":"x"}));
    let aligned = dimension(&mut e, json!({"kind":"aligned","points":[a,b]}));
    let ev = evaluate(&mut e);
    for id in [linear, aligned] {
        let m = &ev["dimensions"][id.to_string()]["measured"];
        assert_eq!(m["value"], 4.);
        let lines = m["lines"].as_array().unwrap();
        // The three authored-derived strokes survive; at least one
        // arrowhead leg per tip pointed back inside the budget.
        assert!(lines.len() >= 3 && lines.len() < 7);
        for line in lines {
            for p in line.as_array().unwrap() {
                for c in p.as_array().unwrap() {
                    assert!(c.as_f64().unwrap().abs() <= 1e6);
                }
            }
        }
    }
    // renderFrame projects the same boundary geometry without error.
    let framed = apply(
        &mut e,
        "renderFrame",
        json!({"width":8,"height":4,"origin_x":0,"origin_y":0,"scale":1e-6}),
    );
    assert!(framed.data["pixels_b64"].is_string());
    // Radial/diameter on a boundary-fitting circle still measure and draw.
    let center = point(&mut e, 0., 999999.);
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":1.})).data["circle_id"]
        .as_u64()
        .unwrap();
    let arc = apply(
        &mut e,
        "addArc",
        json!({"center":center,"radius":1.,"start_deg":90.,"sweep_deg":90.}),
    )
    .data["arc_id"]
        .as_u64()
        .unwrap();
    let radial = dimension(&mut e, json!({"kind":"radial","entity":circle}));
    let diameter = dimension(&mut e, json!({"kind":"diameter","entity":arc}));
    let ev = evaluate(&mut e);
    assert_eq!(
        ev["dimensions"][radial.to_string()]["measured"]["value"],
        1.
    );
    assert_eq!(
        ev["dimensions"][diameter.to_string()]["measured"]["value"],
        2.
    );
    assert!(apply(
        &mut e,
        "renderFrame",
        json!({"width":8,"height":4,"origin_x":0,"origin_y":0,"scale":1e-6}),
    )
    .data["pixels_b64"]
        .is_string());
}
#[test]
fn dimension_angular_arc_overshoot_omits_arc_but_keeps_rays() {
    let mut e = DraftEngine::new();
    // Vertex near the +X budget edge with rays to both ±Y budget corners:
    // the quarter-span arc (r ≈ 250000) bulges past x = 1e6 mid-sweep, so
    // the whole arc polyline and both arc arrowheads are dropped while
    // the authored rays still measure and draw.
    let v = point(&mut e, 999999., 0.);
    let a = point(&mut e, 1e6, 1e6);
    let b = point(&mut e, 1e6, -1e6);
    let dim = dimension(&mut e, json!({"kind":"angular","points":[v,a,b]}));
    let ev = evaluate(&mut e);
    let m = &ev["dimensions"][dim.to_string()]["measured"];
    let got = m["value"].as_f64().unwrap();
    assert!((got - 180.).abs() < 1e-3);
    let lines = m["lines"].as_array().unwrap();
    // Only the two authored rays survive: no arc segments and no arc
    // arrowheads (a lone arrow tip would be disconnected).
    assert_eq!(lines.len(), 2);
    for line in lines {
        for p in line.as_array().unwrap() {
            for c in p.as_array().unwrap() {
                assert!(c.as_f64().unwrap().abs() <= 1e6);
            }
        }
    }
    // renderFrame projects the same boundary geometry without error.
    let framed = apply(
        &mut e,
        "renderFrame",
        json!({"width":8,"height":4,"origin_x":0,"origin_y":0,"scale":1e-6}),
    );
    assert!(framed.data["pixels_b64"].is_string());
}
#[test]
fn dimension_angular_arc_starts_at_arc_start_not_vertex() {
    let mut e = DraftEngine::new();
    // 90 degree angle at the origin: r = 1, arc runs (1,0) to (0,1).
    let v = point(&mut e, 0., 0.);
    let a = point(&mut e, 4., 0.);
    let b = point(&mut e, 0., 4.);
    let dim = dimension(&mut e, json!({"kind":"angular","points":[v,a,b]}));
    let ev = evaluate(&mut e);
    let m = &ev["dimensions"][dim.to_string()]["measured"];
    assert_eq!(m["value"], 90.);
    let lines = m["lines"].as_array().unwrap();
    // Exactly the two rays touch the vertex; the arc polyline begins at
    // the arc start (1,0), never with a spurious vertex-to-sample stroke.
    let touches_vertex = lines
        .iter()
        .filter(|line| {
            line.as_array().unwrap().iter().any(|p| {
                let xy = p.as_array().unwrap();
                xy[0].as_f64().unwrap() == 0. && xy[1].as_f64().unwrap() == 0.
            })
        })
        .count();
    assert_eq!(touches_vertex, 2);
    let arc_start_drawn = lines.iter().any(|line| {
        let pts = line.as_array().unwrap();
        pts.iter().any(|p| {
            let xy = p.as_array().unwrap();
            (xy[0].as_f64().unwrap() - 1.).abs() < 1e-9 && xy[1].as_f64().unwrap().abs() < 1e-9
        })
    });
    assert!(arc_start_drawn);
}
#[test]
fn dimension_degenerate_angle_and_hidden_dimension_render_honestly() {
    let mut e = DraftEngine::new();
    let v = point(&mut e, 0., 0.);
    let a = point(&mut e, 4., 0.);
    let b = point(&mut e, 0., 0.); // coincident coordinates, distinct id
    let dim = dimension(
        &mut e,
        json!({"kind":"angular","points":[v,a,b],"visible":true}),
    );
    // Undefined angle reports value:null rather than a fabricated number.
    let ev = evaluate(&mut e);
    let m = &ev["dimensions"][dim.to_string()]["measured"];
    assert!(m["value"].is_null());
    // Hiding the dimension removes its pixels while geometry stays authored.
    apply(&mut e, "updateDimension", json!({"id":dim,"visible":false}));
    assert!(pixels(&mut e, 5, 2).iter().all(|v| *v == 0));
    apply(&mut e, "updateDimension", json!({"id":dim,"visible":true}));
    assert!(pixels(&mut e, 5, 2).iter().any(|v| *v != 0));
    // updateDimension kind/points/entity/axis changes are full replacements.
    let b2 = point(&mut e, 0., 4.);
    apply(
        &mut e,
        "updateDimension",
        json!({"id":dim,"points":[v,a,b2]}),
    );
    let ev = evaluate(&mut e);
    let got = ev["dimensions"][dim.to_string()]["measured"]["value"]
        .as_f64()
        .unwrap();
    assert!((got - 90.).abs() < 1e-9);
}
#[test]
fn command_grammar_layers_hatches_dimensions_and_deletes() {
    let mut e = DraftEngine::new();
    let cmd =
        |e: &mut DraftEngine, text: &str| apply(e, "executeCommand", json!({"command":text})).data;
    // LAYER lifecycle routes through the same layer ops, one undo each.
    let lay = cmd(&mut e, "layer new Walls")["result"]["layer_id"]
        .as_u64()
        .unwrap();
    cmd(&mut e, &format!("LAYER RENAME {lay} Partitions"));
    cmd(&mut e, &format!("LAYER LOCK {lay} on"));
    let s = state(&e);
    assert_eq!(s.layers[&lay].name, "Partitions");
    assert!(s.layers[&lay].locked);
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "executeCommand",
            json!({"command":format!("LAYER VISIBLE {lay} off")})
        ))
        .is_ok());
    assert!(!state(&e).layers[&lay].visible);
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
    // Layer 0 stays reserved through the grammar.
    assert!(e
        .apply(Command::new(
            "executeCommand",
            json!({"command":"LAYER VISIBLE 0 off"})
        ))
        .is_err());
    // HATCH traces real segment boundaries into the hatch model.
    let edges = square(&mut e, 4., 0);
    let ids = edges
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join(" ");
    let hid = cmd(&mut e, &format!("HATCH ansi31 {ids}"))["result"]["hatch_id"]
        .as_u64()
        .unwrap();
    let h = &state(&e).hatches[&hid];
    assert_eq!(h.pattern, "ansi31");
    assert_eq!(h.loops.len(), 1);
    assert!(pixels(&mut e, 6, 6).iter().any(|v| *v != 0));
    // DIM kinds create linked dimensions measured by evaluate.
    let p = |e: &mut DraftEngine, x: f64, y: f64| {
        cmd(e, &format!("POINT {x} {y}"))["result"]["point_id"]
            .as_u64()
            .unwrap()
    };
    let a = p(&mut e, 0., 0.);
    let b = p(&mut e, 4., 0.);
    let c = p(&mut e, 4., 3.);
    let linear = cmd(&mut e, &format!("DIM LINEAR {a} {b} x"))["result"]["dimension_id"]
        .as_u64()
        .unwrap();
    let aligned = cmd(&mut e, &format!("dim aligned {a} {c}"))["result"]["dimension_id"]
        .as_u64()
        .unwrap();
    let angular = cmd(&mut e, &format!("DIM ANGULAR {a} {b} {c}"))["result"]["dimension_id"]
        .as_u64()
        .unwrap();
    let circle = cmd(&mut e, "CIRCLE 20 0 2")["result"]["entity"]["circle_id"]
        .as_u64()
        .unwrap();
    let arc = cmd(&mut e, "ARC 20 0 2 0 90")["result"]["entity"]["arc_id"]
        .as_u64()
        .unwrap();
    let radial = cmd(&mut e, &format!("DIM RADIAL {circle}"))["result"]["dimension_id"]
        .as_u64()
        .unwrap();
    let diameter = cmd(&mut e, &format!("DIM DIAMETER {arc}"))["result"]["dimension_id"]
        .as_u64()
        .unwrap();
    let ev = apply(&mut e, "evaluate", json!({})).data;
    let dims = &ev["dimensions"];
    assert_eq!(dims[&linear.to_string()]["status"], "linked");
    assert_eq!(dims[&linear.to_string()]["measured"]["value"], 4.);
    assert_eq!(dims[&aligned.to_string()]["status"], "linked");
    assert_eq!(dims[&angular.to_string()]["status"], "linked");
    assert_eq!(dims[&radial.to_string()]["measured"]["value"], 2.);
    assert_eq!(dims[&diameter.to_string()]["measured"]["value"], 4.);
    // Each grammar command is exactly one undo entry.
    let before = e.snapshot().unwrap();
    cmd(&mut e, &format!("DELETE DIMENSION {diameter}"));
    assert!(!state(&e).dimensions.contains_key(&diameter));
    assert!(e.undo().unwrap());
    assert!(state(&e).dimensions.contains_key(&diameter));
    assert_eq!(e.snapshot().unwrap(), before);
    cmd(&mut e, &format!("DELETE HATCH {hid}"));
    assert!(!state(&e).hatches.contains_key(&hid));
    cmd(&mut e, &format!("DELETE LAYER {lay}"));
    assert!(!state(&e).layers.contains_key(&lay));
    // Honest failures: unknown verbs/subcommands, bad flags, bad patterns,
    // bad axes, unresolved references and arity all reject without mutation.
    let before = e.snapshot().unwrap();
    for text in [
        "BLOCK 1 2",
        "LAYER FROB 1",
        "LAYER VISIBLE 1 maybe",
        "LAYER NEW",
        "LAYER RENAME 1",
        "HATCH bogus 1",
        "HATCH ansi31",
        "HATCH ansi31 999999",
        "DIM FROB 1",
        "DIM LINEAR 1 2 z",
        "DIM LINEAR 1 2",
        "DIM RADIAL 1 2",
        "DIM LINEAR 999999 999998 x",
        "DELETE FROB 1",
        "DELETE DIMENSION 999999",
    ] {
        assert!(
            e.apply(Command::new("executeCommand", json!({"command":text})))
                .is_err(),
            "{text} must reject"
        );
    }
    assert_eq!(e.snapshot().unwrap(), before);
}
fn sheet(e: &mut DraftEngine, name: &str) -> u64 {
    apply(
        e,
        "addSheet",
        json!({"name":name,"width":100.,"height":50.}),
    )
    .data["sheet_id"]
        .as_u64()
        .unwrap()
}
fn viewport_on(e: &mut DraftEngine, sheet_id: u64) -> u64 {
    apply(
        e,
        "addViewport",
        json!({"sheet":sheet_id,"x":20.,"y":10.,"width":60.,"height":30.,"center_x":5.,"center_y":0.,"scale":4.}),
    )
    .data["viewport_id"]
        .as_u64()
        .unwrap()
}
fn sheet_frame(sheet_id: u64) -> Value {
    json!({"sheet_id":sheet_id,"dpi":96.})
}
#[test]
fn paper_space_sheets_viewports_crud_validation_locks_and_history() {
    let mut e = DraftEngine::new();
    // Sheet defaults: 10 mm margins on every side.
    let a = sheet(&mut e, "A3");
    let b = sheet(&mut e, "Detail");
    let s = state(&e);
    assert_eq!(s.sheets[&a].margin_top, 10.);
    assert_eq!(s.sheets[&a].width, 100.);
    let vp = viewport_on(&mut e, a);
    // Duplicate names, bad sizes, bad margins and out-of-sheet rectangles reject atomically.
    let before = e.snapshot().unwrap();
    for (op, payload) in [
        ("addSheet", json!({"name":"A3","width":100.,"height":50.})),
        ("addSheet", json!({"name":"","width":100.,"height":50.})),
        ("addSheet", json!({"name":"Tiny","width":10.,"height":50.})),
        (
            "addSheet",
            json!({"name":"BadMargin","width":100.,"height":50.,"margin_top":30.,"margin_bottom":30.}),
        ),
        (
            "addSheet",
            json!({"name":"BadMargin2","width":100.,"height":50.,"margin_left":-1.}),
        ),
        (
            "addViewport",
            json!({"sheet":9999,"x":0.,"y":0.,"width":10.,"height":10.,"center_x":0.,"center_y":0.,"scale":1.}),
        ),
        (
            "addViewport",
            json!({"sheet":a,"x":-1.,"y":0.,"width":10.,"height":10.,"center_x":0.,"center_y":0.,"scale":1.}),
        ),
        (
            "addViewport",
            json!({"sheet":a,"x":90.,"y":0.,"width":20.,"height":10.,"center_x":0.,"center_y":0.,"scale":1.}),
        ),
        (
            "addViewport",
            json!({"sheet":a,"x":0.,"y":0.,"width":10.,"height":10.,"center_x":0.,"center_y":0.,"scale":0.}),
        ),
        (
            "addViewport",
            json!({"sheet":a,"x":0.,"y":0.,"width":10.,"height":10.,"center_x":0.,"center_y":0.,"scale":1e9}),
        ),
        (
            "addViewport",
            json!({"sheet":a,"x":0.,"y":0.,"width":10.,"height":10.,"center_x":0.,"center_y":0.,"scale":1.,"name":""}),
        ),
        ("updateViewport", json!({"id":vp,"name":""})),
        ("updateSheet", json!({"id":a,"width":10.})),
        ("updateSheet", json!({"id":9999,"name":"X"})),
        ("updateSheet", json!({"id":a,"name":"Detail"})),
        ("removeSheet", json!({"id":a})),
    ] {
        assert!(
            e.apply(Command::new(op, payload)).is_err(),
            "{op} must reject"
        );
    }
    assert_eq!(e.snapshot().unwrap(), before);
    // Shrinking a sheet under its viewport rejects through final validation.
    assert!(e
        .apply(Command::new("updateSheet", json!({"id":a,"width":30.})))
        .is_err());
    // Patch updates: rename, resize within viewport bounds stay legal.
    apply(
        &mut e,
        "updateSheet",
        json!({"id":a,"name":"Site","margin_left":5.}),
    );
    assert_eq!(state(&e).sheets[&a].name, "Site");
    assert_eq!(state(&e).sheets[&a].margin_left, 5.);
    // Locked viewport rejects edits and removal until unlocked.
    apply(&mut e, "updateViewport", json!({"id":vp,"locked":true}));
    assert!(e
        .apply(Command::new("updateViewport", json!({"id":vp,"scale":2.})))
        .is_err());
    assert!(e
        .apply(Command::new("removeViewport", json!({"id":vp})))
        .is_err());
    apply(&mut e, "updateViewport", json!({"id":vp,"locked":false}));
    apply(&mut e, "updateViewport", json!({"id":vp,"name":"Plan"}));
    assert_eq!(state(&e).viewports[&vp].name, "Plan");
    // Sheet removal requires emptying viewports first; one undo restores all.
    let before = e.snapshot().unwrap();
    apply(&mut e, "removeViewport", json!({"id":vp}));
    apply(&mut e, "removeSheet", json!({"id":b}));
    assert!(!state(&e).sheets.contains_key(&b));
    assert!(e.undo().unwrap());
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(state(&e).viewports.contains_key(&vp));
    // Re-adding then undoing a sheet is a single journal entry.
    let c = sheet(&mut e, "Temp");
    assert!(state(&e).sheets.contains_key(&c));
    assert!(e.undo().unwrap());
    assert!(!state(&e).sheets.contains_key(&c));
}
#[test]
fn sheet_render_composites_clipped_model_space_with_real_pixels() {
    let mut e = DraftEngine::new();
    let a = sheet(&mut e, "Sheet");
    let vp = viewport_on(&mut e, a);
    // A long model segment runs well past the viewport's world window; only
    // the in-window portion may appear, clipped by the offscreen raster.
    let p = point(&mut e, 0., 0.);
    let q = point(&mut e, 100., 0.);
    apply(
        &mut e,
        "addSegment",
        json!({"a":p,"b":q,"color":[0,0,0,255],"width":0.5}),
    );
    let r = apply(&mut e, "renderFrame", sheet_frame(a)).data;
    assert_eq!(r["width"], 378);
    assert_eq!(r["height"], 189);
    let rgba = base64_decode(r["pixels_b64"].as_str().unwrap());
    assert_eq!(rgba.len(), 378 * 189 * 4);
    let dark = |x: usize, y: usize| {
        let i = (y * 378 + x) * 4;
        rgba[i] < 128 && rgba[i + 1] < 128 && rgba[i + 2] < 128
    };
    let white = |x: usize, y: usize| {
        let i = (y * 378 + x) * 4;
        rgba[i] == 255 && rgba[i + 1] == 255 && rgba[i + 2] == 255 && rgba[i + 3] == 255
    };
    // Expected band: viewport x≈76..303px, y≈38..151px; segment maps near
    // viewport vertical center. Dark pixels exist inside, none outside it.
    let mut inside = 0usize;
    for y in 39..150 {
        for x in 77..302 {
            if dark(x, y) {
                inside += 1;
            }
        }
    }
    assert!(inside > 50, "viewport must show real clipped geometry");
    for y in 39..150 {
        for x in [10, 320, 350] {
            assert!(white(x, y), "paper outside viewport stays white at {x},{y}");
        }
    }
    // Column just right of the viewport border within its row band is white:
    // the 100-unit segment cannot spill past the clip.
    for y in 60..140 {
        assert!(white(310, y), "geometry clipped at viewport edge");
    }
    // Margin chrome and viewport border are real black strokes.
    assert!(dark(37, 94) || dark(38, 94));
    // Hidden viewport renders only paper + margins.
    apply(&mut e, "updateViewport", json!({"id":vp,"visible":false}));
    let r = apply(&mut e, "renderFrame", sheet_frame(a)).data;
    let rgba = base64_decode(r["pixels_b64"].as_str().unwrap());
    let interior_dark = (39..150)
        .flat_map(|y| (77..302).map(move |x| (x, y)))
        .filter(|&(x, y)| {
            let i = (y * 378 + x) * 4;
            rgba[i] < 128 && rgba[i + 1] < 128 && rgba[i + 2] < 128
        })
        .count();
    assert_eq!(interior_dark, 0);
    // Payload honesty: unknown sheet, bad dpi, mixed fields and dpi without
    // sheet_id all reject; the world-viewport form still works unchanged.
    let before = e.snapshot().unwrap();
    for payload in [
        json!({"sheet_id":9999,"dpi":96.}),
        json!({"sheet_id":a,"dpi":10.}),
        json!({"sheet_id":a,"dpi":601.}),
        json!({"sheet_id":a,"dpi":96.,"width":10}),
        json!({"dpi":96.,"width":3,"height":1,"origin_x":0,"origin_y":0,"scale":1}),
    ] {
        assert!(e.apply(Command::new("renderFrame", payload)).is_err());
    }
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn paper_space_snapshots_wrapper_roundtrip_and_hostile_restore() {
    let mut e = DraftEngine::new();
    let legacy = e.snapshot().unwrap();
    let mut reopened = DraftEngine::new();
    reopened.restore(&legacy).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), legacy);
    assert!(state(&reopened).sheets.is_empty());
    let a = sheet(&mut e, "A3");
    let vp = viewport_on(&mut e, a);
    apply(&mut e, "updateViewport", json!({"id":vp,"locked":true}));
    let extended = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&extended).unwrap();
    let wrapped: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(wrapped["kind"], "draft");
    assert_eq!(wrapped["schema"], 2);
    assert_eq!(wrapped["document"]["sheets"][a.to_string()]["name"], "A3");
    assert_eq!(
        wrapped["document"]["viewports"][vp.to_string()]["scale"],
        4.
    );
    reopened.restore(&extended).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), extended);
    assert_eq!(state(&reopened).viewports[&vp].sheet, a);
    let before = reopened.snapshot().unwrap();
    let mut cases: Vec<Value> = Vec::new();
    // Dangling sheet reference, reserved/duplicate sheet names, viewport
    // outside its sheet, bad scale and unwrapped extended state all reject.
    let mut dangling = wrapped.clone();
    dangling["document"]["viewports"][vp.to_string()]["sheet"] = json!(4242);
    cases.push(dangling);
    let mut dup = wrapped.clone();
    dup["document"]["sheets"]["77"] = json!({"id":77,"name":"A3","width":100.,"height":50.,"margin_top":10.,"margin_right":10.,"margin_bottom":10.,"margin_left":10.});
    cases.push(dup);
    let mut outside = wrapped.clone();
    outside["document"]["viewports"][vp.to_string()]["x"] = json!(95.);
    cases.push(outside);
    let mut bad_scale = wrapped.clone();
    bad_scale["document"]["viewports"][vp.to_string()]["scale"] = json!(0.);
    cases.push(bad_scale);
    let mut bad_margin = wrapped.clone();
    bad_margin["document"]["sheets"][a.to_string()]["margin_top"] = json!(-5.);
    cases.push(bad_margin);
    cases.push(wrapped["document"].clone());
    let mut bad_field = wrapped.clone();
    bad_field["document"]["viewports"][vp.to_string()]["rotation"] = json!(30.);
    cases.push(bad_field);
    for invalid in cases {
        assert!(reopened
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(reopened.snapshot().unwrap(), before);
    }
}
#[test]
fn sheet_viewport_renders_model_space_y_up_like_cad() {
    let mut e = DraftEngine::new();
    let a = sheet(&mut e, "Sheet");
    // 80x30 mm viewport at sheet (10,10); scale 4 mm/world unit shows
    // world x in [-10,10], y in [-3.75,3.75] about center (0,0).
    apply(
        &mut e,
        "addViewport",
        json!({"sheet":a,"x":10.,"y":10.,"width":80.,"height":30.,"center_x":0.,"center_y":0.,"scale":4.}),
    );
    // Asymmetric marker: a horizontal segment at world y=+3 (near the top of
    // the model window). CAD semantics: model +y must rise toward sheet +y,
    // i.e. land on the upper half of the viewport on paper.
    let p = point(&mut e, -8., 3.);
    let q = point(&mut e, 8., 3.);
    apply(
        &mut e,
        "addSegment",
        json!({"a":p,"b":q,"color":[0,0,0,255],"width":0.2}),
    );
    let r = apply(&mut e, "renderFrame", sheet_frame(a)).data;
    let rgba = base64_decode(r["pixels_b64"].as_str().unwrap());
    let w = r["width"].as_u64().unwrap() as usize;
    assert_eq!(w, 378);
    // Viewport pixel band: x 38..340, y 38..151 on the 378x189 sheet.
    let dark_rows = |y0: usize, y1: usize| {
        (y0..y1)
            .flat_map(|y| (38..340).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let i = (y * w + x) * 4;
                rgba[i] < 128 && rgba[i + 1] < 128 && rgba[i + 2] < 128
            })
            .count()
    };
    // Correct orientation puts the marker near row ~49 (upper band); a
    // mirrored viewport would put it near row ~140 (lower band).
    let upper = dark_rows(42, 62);
    let lower = dark_rows(125, 145);
    assert!(
        upper > 100 && upper > lower * 4,
        "model +y must render toward sheet +y: upper={upper} lower={lower}"
    );
}
fn block(e: &mut DraftEngine, name: &str) -> u64 {
    apply(e, "addBlock", json!({"name":name})).data["block_id"]
        .as_u64()
        .unwrap()
}
fn insert(e: &mut DraftEngine, block: u64, x: f64, y: f64) -> u64 {
    apply(e, "addInsert", json!({"block":block,"x":x,"y":y})).data["insert_id"]
        .as_u64()
        .unwrap()
}
fn snap(e: &mut DraftEngine, x: f64, y: f64, tolerance: f64) -> Value {
    apply(e, "querySnap", json!({"x":x,"y":y,"tolerance":tolerance})).data["candidate"].clone()
}
#[test]
fn blocks_instances_render_snaps_transform_and_single_undo() {
    let mut e = DraftEngine::new();
    // Definition "part": base (0,0), one segment (0,0)-(4,0) and one circle
    // centered (2,1) r1. Members are created directly into the block.
    let b = block(&mut e, "part");
    let p1 = point(&mut e, 0., 0.);
    let p2 = point(&mut e, 4., 0.);
    let pc = point(&mut e, 2., 1.);
    let seg = apply(
        &mut e,
        "addSegment",
        json!({"a":p1,"b":p2,"block":b,"color":[9,9,9,255],"width":0.5}),
    )
    .data["segment_id"]
        .as_u64()
        .unwrap();
    let circ = apply(
        &mut e,
        "addCircle",
        json!({"center":pc,"radius":1.,"block":b}),
    )
    .data["circle_id"]
        .as_u64()
        .unwrap();
    // Members are definition geometry: nothing draws or snaps at origin.
    let blank = pixels(&mut e, 8, 8);
    assert!(blank.iter().all(|v| *v == 0));
    assert!(snap(&mut e, 2., 0., 0.5).is_null());
    // Insert at (10,20) scale 2: segment -> (10,20)-(18,20), circle ->
    // center (14,22) r2.
    let i1 = apply(
        &mut e,
        "addInsert",
        json!({"block":b,"x":10.,"y":20.,"scale":2.}),
    )
    .data["insert_id"]
        .as_u64()
        .unwrap();
    let c = snap(&mut e, 18.3, 20.3, 0.5);
    assert_eq!(c["kind"], "endpoint");
    assert_eq!(c["x"], 18.);
    assert_eq!(c["y"], 20.);
    let mut sources = c["sources"].as_array().unwrap().clone();
    sources.sort_by_key(|v| v.as_u64().unwrap());
    assert_eq!(
        Value::Array(sources),
        json!([i1.min(seg), i1.max(seg)]),
        "virtual endpoint sources are [insert, member] sorted"
    );
    // Rotated insert: local (4,0) under 90deg -> (0,4) at origin insert.
    // One undo removes the whole insert atomically.
    let before_rot = e.snapshot().unwrap();
    apply(
        &mut e,
        "addInsert",
        json!({"block":b,"x":0.,"y":0.,"rotation_deg":90.}),
    );
    let c = snap(&mut e, 0.3, 4.3, 0.5);
    assert_eq!(c["kind"], "endpoint");
    let (sx, sy) = (c["x"].as_f64().unwrap(), c["y"].as_f64().unwrap());
    assert!((sx - 0.).abs() < 1e-9 && (sy - 4.).abs() < 1e-9);
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before_rot);
    assert!(snap(&mut e, 0.3, 4.3, 0.5).is_null());
    // Real pixels: the scaled instance draws near (18,20); origin stays empty.
    let rgba = pixels(&mut e, 24, 26);
    let mut dark = 0usize;
    for y in 18..23 {
        for x in 8..20 {
            let p = px(&rgba, 24, x, y);
            if p[0] < 200 && p[3] > 0 {
                dark += 1;
            }
        }
    }
    assert!(dark > 0, "scaled block instance must render real pixels");
    assert!(
        px(&rgba, 24, 2, 0)[3] == 0,
        "definition geometry must not draw"
    );
    // evaluate/describe expose the new collections; members keep block refs.
    let ev = apply(&mut e, "evaluate", json!({})).data;
    assert!(ev["blocks"][b.to_string()]["name"] == "part");
    assert!(ev["inserts"][i1.to_string()]["scale"] == 2.);
    let d = apply(&mut e, "describe", json!({})).data;
    assert_eq!(d["segments"][seg.to_string()]["block"], b);
    // Members remain in the definition after the insert undo.
    let s = state(&e);
    assert!(s.inserts.len() == 1);
    assert_eq!(s.segments[&seg].block, b);
    // Command grammar routes BLOCK/INSERT through the same ops.
    let cmd =
        |e: &mut DraftEngine, text: &str| apply(e, "executeCommand", json!({"command":text})).data;
    let gb = cmd(&mut e, "BLOCK NEW gadget")["result"]["block_id"]
        .as_u64()
        .unwrap();
    cmd(&mut e, &format!("INSERT {gb} 30 30"));
    let gi = state(&mut e)
        .inserts
        .values()
        .find(|i| i.block == gb)
        .unwrap()
        .id;
    cmd(&mut e, &format!("DELETE INSERT {gi}"));
    cmd(&mut e, &format!("DELETE BLOCK {gb}"));
    assert!(!state(&e).blocks.contains_key(&gb));
    // Unknown/cyclic/deep guards and locks.
    let before = e.snapshot().unwrap();
    for (op, payload) in [
        ("addInsert", json!({"block":9999,"x":0.,"y":0.})),
        ("addInsert", json!({"block":b,"parent":9999,"x":0.,"y":0.})),
        ("addInsert", json!({"block":b,"x":0.,"y":0.,"scale":0.})),
        ("addInsert", json!({"block":b,"x":0.,"y":0.,"scale":-2.})),
        (
            "addInsert",
            json!({"block":b,"x":0.,"y":0.,"rotation_deg":400000.}),
        ),
        ("addBlock", json!({"name":"part"})),
        ("addBlock", json!({"name":""})),
        ("updateBlock", json!({"id":9999,"name":"x"})),
        ("removeBlock", json!({"id":b})),
        ("removeInsert", json!({"id":9999})),
        ("updateInsert", json!({"id":9999,"x":1.})),
        ("addSegment", json!({"a":p1,"b":p2,"block":9999})),
    ] {
        assert!(
            e.apply(Command::new(op, payload)).is_err(),
            "{op} must reject"
        );
    }
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(state(&e).blocks.contains_key(&b));
    assert_eq!(state(&e).segments[&seg].block, b);
    // Locked insert rejects edits/removal until unlocked.
    apply(&mut e, "updateInsert", json!({"id":i1,"locked":true}));
    assert!(e
        .apply(Command::new("updateInsert", json!({"id":i1,"scale":3.})))
        .is_err());
    assert!(e
        .apply(Command::new("removeInsert", json!({"id":i1})))
        .is_err());
    apply(&mut e, "updateInsert", json!({"id":i1,"locked":false}));
    // Moving a member out of the block restores direct rendering/snapping.
    apply(&mut e, "updateSegment", json!({"id":seg,"block":0}));
    assert_eq!(snap(&mut e, 2., 0., 0.5)["x"], 2.);
    // Block removal still rejects while the circle remains a member.
    assert!(e
        .apply(Command::new("removeBlock", json!({"id":b})))
        .is_err());
    apply(&mut e, "updateCircle", json!({"id":circ,"block":0}));
    apply(&mut e, "removeInsert", json!({"id":i1}));
    apply(&mut e, "removeBlock", json!({"id":b}));
    assert!(!state(&e).blocks.contains_key(&b));
}
#[test]
fn nested_blocks_compose_transforms_and_cycles_depth_budgets_reject() {
    let mut e = DraftEngine::new();
    // inner: segment (0,0)-(1,0); outer contains an insert of inner at
    // local (5,0); root insert of outer at (100,100) -> world (105,100)-(106,100).
    let inner = block(&mut e, "inner");
    let a = point(&mut e, 0., 0.);
    let bpt = point(&mut e, 1., 0.);
    let iseg = apply(&mut e, "addSegment", json!({"a":a,"b":bpt,"block":inner})).data["segment_id"]
        .as_u64()
        .unwrap();
    let outer = block(&mut e, "outer");
    let nested = apply(
        &mut e,
        "addInsert",
        json!({"block":inner,"parent":outer,"x":5.,"y":0.}),
    )
    .data["insert_id"]
        .as_u64()
        .unwrap();
    // The nested insert alone draws nothing (it is definition geometry).
    assert!(pixels(&mut e, 8, 8).iter().all(|v| *v == 0));
    let root = apply(
        &mut e,
        "addInsert",
        json!({"block":outer,"x":100.,"y":100.}),
    )
    .data["insert_id"]
        .as_u64()
        .unwrap();
    let c = snap(&mut e, 106.3, 100.3, 0.5);
    assert_eq!(c["kind"], "endpoint");
    assert_eq!(
        (c["x"].as_f64().unwrap(), c["y"].as_f64().unwrap()),
        (106., 100.)
    );
    let sources = c["sources"].as_array().unwrap();
    assert!(sources.contains(&json!(root)) && sources.contains(&json!(iseg)));
    // Rotation composes through nesting: inner insert rotated 90 inside a
    // rotated outer lands at a computed world point.
    apply(
        &mut e,
        "updateInsert",
        json!({"id":nested,"rotation_deg":90.,"x":0.,"y":5.}),
    );
    // inner local (1,0) -> nested: rot90*s1 -> (0,1); +pos(0,5) in outer
    // space -> (0,6); outer identity at (100,100) -> world (100,106).
    let c = snap(&mut e, 100.2, 106.3, 0.5);
    assert_eq!(
        (c["x"].as_f64().unwrap(), c["y"].as_f64().unwrap()),
        (100., 106.)
    );
    // Self-cycle rejects atomically at write time.
    assert!(e
        .apply(Command::new(
            "addInsert",
            json!({"block":inner,"parent":inner,"x":0.,"y":0.})
        ))
        .is_err());
    let b2 = block(&mut e, "b2");
    apply(
        &mut e,
        "addInsert",
        json!({"block":b2,"parent":inner,"x":0.,"y":0.}),
    );
    // Two-block cycle and re-parenting into a cycle also reject.
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "addInsert",
            json!({"block":inner,"parent":b2,"x":0.,"y":0.})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "updateInsert",
            json!({"id":nested,"parent":inner})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Depth budget: a chain of 9 nested blocks exceeds MAX_BLOCK_DEPTH 8.
    let mut ids = Vec::new();
    for i in 0..9 {
        ids.push(block(&mut e, &format!("chain{i}")));
    }
    for i in 0..8 {
        let r = e.apply(Command::new(
            "addInsert",
            json!({"block":ids[i+1],"parent":ids[i],"x":0.,"y":0.}),
        ));
        if i < 7 {
            assert!(r.is_ok(), "depth {} must still be admitted", i + 2);
        } else {
            assert!(r.is_err(), "depth 9 must reject");
        }
    }
    // Expansion budget: 33 member segments x 32 inserts exceeds 1024
    // primitives; the insert that crosses the budget rejects atomically.
    let mut e2 = DraftEngine::new();
    let big = block(&mut e2, "big");
    let p = point(&mut e2, 0., 0.);
    let q = point(&mut e2, 1., 0.);
    for _ in 0..33 {
        apply(&mut e2, "addSegment", json!({"a":p,"b":q,"block":big}));
    }
    for n in 0..31 {
        assert!(
            e2.apply(Command::new(
                "addInsert",
                json!({"block":big,"x":0.,"y":0.})
            ))
            .is_ok(),
            "insert {n} within expansion budget"
        );
    }
    assert!(e2
        .apply(Command::new(
            "addInsert",
            json!({"block":big,"x":0.,"y":0.})
        ))
        .is_err());
    // Hidden inserts and hidden member layers emit nothing.
    let mut e3 = DraftEngine::new();
    let hb = block(&mut e3, "h");
    let hp1 = point(&mut e3, 0., 0.);
    let hp2 = point(&mut e3, 4., 0.);
    apply(&mut e3, "addSegment", json!({"a":hp1,"b":hp2,"block":hb}));
    let hi = insert(&mut e3, hb, 10., 10.);
    apply(&mut e3, "updateInsert", json!({"id":hi,"visible":false}));
    assert!(pixels(&mut e3, 16, 16).iter().all(|v| *v == 0));
    apply(&mut e3, "updateInsert", json!({"id":hi,"visible":true}));
    let lay = apply(&mut e3, "addLayer", json!({"name":"H","visible":false})).data["layer_id"]
        .as_u64()
        .unwrap();
    apply(&mut e3, "updateInsert", json!({"id":hi,"layer":lay}));
    assert!(pixels(&mut e3, 16, 16).iter().all(|v| *v == 0));
}
#[test]
fn block_snapshots_wrapper_roundtrip_and_hostile_restore() {
    let mut e = DraftEngine::new();
    let legacy = e.snapshot().unwrap();
    let mut reopened = DraftEngine::new();
    reopened.restore(&legacy).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), legacy);
    let b = block(&mut e, "widget");
    let p1 = point(&mut e, 0., 0.);
    let p2 = point(&mut e, 4., 0.);
    apply(&mut e, "addSegment", json!({"a":p1,"b":p2,"block":b}));
    let i = insert(&mut e, b, 10., 10.);
    let extended = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&extended).unwrap();
    let wrapped: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(wrapped["kind"], "draft");
    assert_eq!(wrapped["schema"], 2);
    assert_eq!(
        wrapped["document"]["blocks"][b.to_string()]["name"],
        "widget"
    );
    assert_eq!(wrapped["document"]["inserts"][i.to_string()]["block"], b);
    reopened.restore(&extended).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), extended);
    let before = reopened.snapshot().unwrap();
    let mut cases: Vec<Value> = Vec::new();
    // Unwrapped extended state, dangling block/parent refs, bad transform,
    // wrong-kind member block and a hand-built cyclic insert graph reject.
    cases.push(wrapped["document"].clone());
    let mut dangling = wrapped.clone();
    dangling["document"]["inserts"][i.to_string()]["block"] = json!(4242);
    cases.push(dangling);
    let mut bad_parent = wrapped.clone();
    bad_parent["document"]["inserts"][i.to_string()]["parent"] = json!(4242);
    cases.push(bad_parent);
    let mut bad_scale = wrapped.clone();
    bad_scale["document"]["inserts"][i.to_string()]["scale"] = json!(0.);
    cases.push(bad_scale);
    let mut bad_member = wrapped.clone();
    bad_member["document"]["segments"]["3"]["block"] = json!(4242);
    cases.push(bad_member);
    let mut cyclic = wrapped.clone();
    cyclic["document"]["blocks"]["50"] = json!({"id":50,"name":"c1","base_x":0.,"base_y":0.});
    cyclic["document"]["blocks"]["51"] = json!({"id":51,"name":"c2","base_x":0.,"base_y":0.});
    cyclic["document"]["inserts"]["60"] = json!({"id":60,"block":51,"parent":50,"name":"x","x":0.,"y":0.,"scale":1.,"rotation_deg":0.,"visible":true,"locked":false});
    cyclic["document"]["inserts"]["61"] = json!({"id":61,"block":50,"parent":51,"name":"x","x":0.,"y":0.,"scale":1.,"rotation_deg":0.,"visible":true,"locked":false});
    cyclic["document"]["next_id"] = json!(70);
    cases.push(cyclic);
    let mut unknown_field = wrapped.clone();
    unknown_field["document"]["inserts"][i.to_string()]["explode"] = json!(true);
    cases.push(unknown_field);
    for invalid in cases {
        assert!(reopened
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(reopened.snapshot().unwrap(), before);
    }
    // Removing the last block/insert returns snapshots to bare schema:1 form.
    apply(&mut e, "removeInsert", json!({"id":i}));
    // Circle/segment member still references the block: removal must fail.
    assert!(e
        .apply(Command::new("removeBlock", json!({"id":b})))
        .is_err());
    let seg_id = state(&e)
        .segments
        .values()
        .find(|s| s.block == b)
        .unwrap()
        .id;
    apply(&mut e, "updateSegment", json!({"id":seg_id,"block":0}));
    apply(&mut e, "removeBlock", json!({"id":b}));
    let bare = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&bare).unwrap();
    let value: Value = serde_json::from_slice(payload).unwrap();
    assert!(value.get("document").is_none());
    assert_eq!(value["kind"], "draft");
}

fn dist(s: &model::State, a: u64, b: u64) -> f64 {
    let (pa, pb) = (s.point(a).unwrap(), s.point(b).unwrap());
    (pa.x - pb.x).hypot(pa.y - pb.y)
}
#[test]
fn nonlinear_distance_radius_and_report_merge_move_real_geometry() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 4.);
    let center = point(&mut e, 20., 20.);
    let circle = circle(&mut e, center, 2.);
    constraint(&mut e, json!({"kind":"fixed","point":a,"x":0,"y":0}));
    let dc = constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":10}));
    let rc = constraint(&mut e, json!({"kind":"radius","entity":circle,"value":5}));
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["status"], "underconstrained");
    assert_eq!(report.data["nonlinear"]["status"], "solved");
    assert_eq!(report.data["unsatisfied_constraints"], json!([]));
    let s = state(&e);
    assert!((dist(&s, a, b) - 10.).abs() < 1e-6);
    assert!((s.circles[&circle].radius - 5.).abs() < 1e-6);
    // The shared center point is referenced but has zero nonlinear gradient:
    // it keeps its authored coordinates.
    assert_eq!((s.point(center).unwrap().x, s.point(center).unwrap().y), (20., 20.));
    assert!(report.events.len() == 1);
    // A second solve re-reports the satisfied constraints (the LM pass is
    // deterministic but not bit-idempotent at tolerance scale).
    let noop = apply(&mut e, "solve", json!({}));
    assert_eq!(noop.data["nonlinear"]["status"], "solved");
    assert!((dist(&state(&e), a, b) - 10.).abs() < 1e-6);
    let _ = (dc, rc);
}
#[test]
fn nonlinear_segment_kinds_solve_orientation_length_and_midpoint() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 4., 0.);
    let c = point(&mut e, 4., 1.);
    let d = point(&mut e, 5., 2.);
    let ab = segment(&mut e, a, b);
    let cd = segment(&mut e, c, d);
    constraint(&mut e, json!({"kind":"perpendicular","a":ab,"b":cd}));
    constraint(&mut e, json!({"kind":"equal","a":ab,"b":cd}));
    let m = point(&mut e, 9., 9.);
    constraint(&mut e, json!({"kind":"midpoint","point":m,"segment":ab}));
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["nonlinear"]["status"], "solved");
    let s = state(&e);
    let (sa, sb) = (s.segment(ab).unwrap(), s.segment(cd).unwrap());
    let (p_a, p_b) = (s.point(sa.a).unwrap(), s.point(sa.b).unwrap());
    let (p_c, p_d) = (s.point(sb.a).unwrap(), s.point(sb.b).unwrap());
    let (d1x, d1y) = (p_b.x - p_a.x, p_b.y - p_a.y);
    let (d2x, d2y) = (p_d.x - p_c.x, p_d.y - p_c.y);
    let (l1, l2) = (d1x.hypot(d1y), d2x.hypot(d2y));
    assert!((d1x * d2x + d1y * d2y).abs() / (l1 * l2) < 1e-6);
    assert!((l1 - l2).abs() < 1e-5);
    let pm = s.point(m).unwrap();
    assert!((pm.x - (p_a.x + p_b.x) * 0.5).abs() < 1e-6);
    assert!((pm.y - (p_a.y + p_b.y) * 0.5).abs() < 1e-6);
}
#[test]
fn nonlinear_angle_concentric_and_tangent_kinds_converge() {
    let mut e = DraftEngine::new();
    let v = point(&mut e, 0., 0.);
    let f = point(&mut e, 2., 0.);
    let spt = point(&mut e, 2., 2.);
    constraint(&mut e, json!({"kind":"angle","vertex":v,"first":f,"second":spt,"degrees":90}));
    let c1 = point(&mut e, 10., 10.);
    let c2 = point(&mut e, 13., 11.);
    let k1 = circle(&mut e, c1, 1.);
    let k2 = circle(&mut e, c2, 2.);
    constraint(&mut e, json!({"kind":"concentric","a":k1,"b":k2}));
    // External circle-circle tangent on a separate pair: k2's center must
    // end r2+r4 from k4's center (concentric pins k2 to k1's center).
    let c4 = point(&mut e, 20., 20.);
    let k4 = circle(&mut e, c4, 1.5);
    constraint(&mut e, json!({"kind":"tangent","a":k2,"b":k4}));
    let seg_a = point(&mut e, -6., 0.);
    let seg_b = point(&mut e, -6., 3.);
    let tangent_seg = segment(&mut e, seg_a, seg_b);
    let k3c = point(&mut e, 0., 0.);
    let k3 = circle(&mut e, k3c, 1.);
    constraint(&mut e, json!({"kind":"tangent","a":tangent_seg,"b":k3}));
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["nonlinear"]["status"], "solved", "{}", report.data);
    let s = state(&e);
    // Angle at v between rays to f and spt is 90 degrees.
    let (pv, pf, ps) = (s.point(v).unwrap(), s.point(f).unwrap(), s.point(spt).unwrap());
    let (ux, uy) = (pf.x - pv.x, pf.y - pv.y);
    let (wx, wy) = (ps.x - pv.x, ps.y - pv.y);
    let ang = (ux * wy - uy * wx).abs().atan2(ux * wx + uy * wy);
    assert!((ang - std::f64::consts::FRAC_PI_2).abs() < 1e-5);
    // Concentric centers coincide.
    assert!(dist(&s, c1, c2) < 1e-6);
    // External tangent: k2/k4 center distance equals r2+r4.
    let d = dist(&s, c2, c4);
    let rr = s.circles[&k2].radius + s.circles[&k4].radius;
    assert!((d - rr).abs() < 1e-5);
    // Segment tangent: closest-point distance from k3 center to the segment
    // equals its radius.
    let sa = s.segment(tangent_seg).unwrap();
    let (pa, pb) = (s.point(sa.a).unwrap(), s.point(sa.b).unwrap());
    let (cx, cy) = {
        let p = s.point(k3c).unwrap();
        (p.x, p.y)
    };
    let (dx, dy) = (pb.x - pa.x, pb.y - pa.y);
    let dd = dx * dx + dy * dy;
    let t = (((cx - pa.x) * dx + (cy - pa.y) * dy) / dd).clamp(0., 1.);
    let closest = ((cx - (pa.x + t * dx)).hypot(cy - (pa.y + t * dy)) - s.circles[&k3].radius).abs();
    assert!(closest < 1e-5);
}
#[test]
fn nonlinear_unconverged_keeps_geometry_and_reports_honestly() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 1., 0.);
    constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":10}));
    constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":20}));
    let before = state(&e);
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["status"], "unconverged");
    assert_eq!(report.data["nonlinear"]["status"], "unconverged");
    assert_eq!(report.data["applied"], false);
    let after = state(&e);
    assert_eq!(after.point(a).unwrap().x, before.point(a).unwrap().x);
    assert_eq!(after.point(b).unwrap().x, before.point(b).unwrap().x);
    // Disabled nonlinear constraints never trigger the pass.
    let mut e2 = DraftEngine::new();
    let a2 = point(&mut e2, 0., 0.);
    let b2 = point(&mut e2, 1., 0.);
    apply(&mut e2, "addConstraint", json!({"enabled":false,"definition":{"kind":"distance","a":a2,"b":b2,"value":10}}));
    let r2 = apply(&mut e2, "solve", json!({}));
    assert!(r2.data.get("nonlinear").is_none());
}
#[test]
fn nonlinear_locks_reference_guards_and_snapshot_wrapper() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 4.);
    apply(&mut e, "updatePoint", json!({"id":a,"locked":true}));
    constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":10}));
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["nonlinear"]["status"], "solved");
    let s = state(&e);
    assert_eq!((s.point(a).unwrap().x, s.point(a).unwrap().y), (0., 0.));
    assert!((dist(&s, a, b) - 10.).abs() < 1e-6);
    // Referenced entities cannot be deleted while constraints name them.
    let center = point(&mut e, 50., 50.);
    let k = circle(&mut e, center, 1.);
    constraint(&mut e, json!({"kind":"radius","entity":k,"value":2}));
    assert!(e.apply(Command::new("removeCircle", json!({"id":k}))).is_err());
    let c = point(&mut e, 60., 60.);
    let d = point(&mut e, 61., 60.);
    let cd = segment(&mut e, c, d);
    let ef = segment(&mut e, c, d);
    // parallel{cd,ef} is degenerate (same segment pair is fine: distinct ids)
    // but references both segments, so neither can be removed.
    constraint(&mut e, json!({"kind":"parallel","a":cd,"b":ef}));
    assert!(e.apply(Command::new("removeSegment", json!({"id":cd}))).is_err());
    assert!(e.apply(Command::new("removeSegment", json!({"id":ef}))).is_err());
    // Points referenced through segment endpoints are protected too.
    assert!(e.apply(Command::new("removePoint", json!({"id":c}))).is_err());
}
#[test]
fn nonlinear_snapshot_wrapper_roundtrip_and_bare_restore_rejection() {
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 4.);
    constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":10}));
    let bytes = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&bytes).unwrap();
    let wrapped: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(wrapped["kind"], "draft");
    assert_eq!(wrapped["schema"], 2);
    assert!(wrapped.get("document").is_some());
    let mut reopened = DraftEngine::new();
    reopened.restore(&bytes).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), bytes);
    // A bare schema1 document carrying a nonlinear kind must fail closed.
    let bare = serde_json::to_vec(&wrapped["document"]).unwrap();
    let mut hostile = DraftEngine::new();
    assert!(hostile.restore(&encode_envelope(&bare)).is_err());
    // Validation rejects malformed nonlinear definitions atomically.
    let mut e2 = DraftEngine::new();
    let p1 = point(&mut e2, 0., 0.);
    let p2 = point(&mut e2, 1., 0.);
    for bad in [
        json!({"kind":"distance","a":p1,"b":p1,"value":1}),
        json!({"kind":"distance","a":p1,"b":p2,"value":-1}),
        json!({"kind":"angle","vertex":p1,"first":p2,"second":p2,"degrees":90}),
        json!({"kind":"angle","vertex":p1,"first":p2,"second":p1,"degrees":200}),
        json!({"kind":"radius","entity":p1,"value":2}),
        json!({"kind":"radius","entity":9999,"value":2}),
        json!({"kind":"concentric","a":p1,"b":p2}),
        json!({"kind":"tangent","a":p1,"b":p2}),
    ] {
        assert!(e2.apply(Command::new("addConstraint", json!({"definition":bad}))).is_err());
    }
    let _ = p1;
    let _ = p2;
}
#[test]
fn nonlinear_apply_long_cancel_and_batch_solve() {
    use ignition_core::{ErrorCode, TaskContext};
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 1., 0.);
    constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":10}));
    let before = e.snapshot().unwrap();
    let ctx = TaskContext::new();
    ctx.cancel();
    let err = e
        .apply_long(Command::new("solve", json!({})), &ctx)
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Cancelled);
    assert_eq!(e.snapshot().unwrap(), before);
    // A live context solves through the same path and reports progress.
    let ctx2 = TaskContext::new();
    let ok = e
        .apply_long(Command::new("solve", json!({})), &ctx2)
        .unwrap();
    assert_eq!(ok.data["nonlinear"]["status"], "solved");
    assert!(ctx2.progress() > 0.);
    // Solve inside an atomic batch commits once with the nonlinear stage.
    let mut e2 = DraftEngine::new();
    let a2 = point(&mut e2, 0., 0.);
    let b2 = point(&mut e2, 1., 0.);
    apply(&mut e2, "addConstraint", json!({"definition":{"kind":"distance","a":a2,"b":b2,"value":8}}));
    let batch = ignition_core::Command::new(
        ignition_core::OP_BATCH,
        json!({"commands":[{"op":"solve","payload":{}}]}),
    );
    let res = e2.apply(batch).unwrap();
    assert_eq!(res.data["results"][0]["nonlinear"]["status"], "solved");
    let s2 = state(&e2);
    assert!((dist(&s2, a2, b2) - 8.).abs() < 1e-6);
}
#[test]
fn nonlinear_unconverged_publishes_nothing_including_linear_stage() {
    // Mixed doc: a satisfiable linear constraint (distance_x would move b
    // to x=5) plus conflicting nonlinear distances. The solve is atomic —
    // an unconverged nonlinear pass publishes NOTHING, not even the linear
    // stage's point updates.
    let mut e = DraftEngine::new();
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 1., 0.);
    constraint(&mut e, json!({"kind":"distance_x","a":a,"b":b,"value":5}));
    constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":10}));
    constraint(&mut e, json!({"kind":"distance","a":a,"b":b,"value":20}));
    let before = e.snapshot().unwrap();
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["status"], "unconverged");
    assert_eq!(report.data["applied"], false);
    assert_eq!(report.data["nonlinear"]["status"], "unconverged");
    assert!(report.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    // No journal entry: undo reverts the last real mutation (the third
    // addConstraint), leaving two constraints — a recorded solve would
    // have kept all three.
    assert!(e.undo().unwrap());
    assert_eq!(state(&e).constraints.len(), 2);
}
#[test]
fn nonlinear_converged_but_out_of_bounds_reports_unconverged_not_error() {
    // Center near the +X world budget; a radius solve to 5 would push the
    // circle extent past ±1e6. The converged iterate fails the pre-publish
    // entity-bounds check, so the solve reports `unconverged` and publishes
    // nothing instead of erroring inside publish->validate.
    let mut e = DraftEngine::new();
    let center = point(&mut e, 999_999., 0.);
    let k = circle(&mut e, center, 1.);
    constraint(&mut e, json!({"kind":"radius","entity":k,"value":5}));
    let before = e.snapshot().unwrap();
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["status"], "unconverged");
    assert_eq!(report.data["nonlinear"]["status"], "unconverged");
    assert_eq!(report.data["applied"], false);
    assert!(report.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    // An in-bounds radius on the same geometry still solves and publishes.
    let mut e2 = DraftEngine::new();
    let c2 = point(&mut e2, 10., 10.);
    let k2 = circle(&mut e2, c2, 1.);
    constraint(&mut e2, json!({"kind":"radius","entity":k2,"value":4}));
    let ok = apply(&mut e2, "solve", json!({}));
    assert_eq!(ok.data["nonlinear"]["status"], "solved");
    assert_eq!(ok.data["applied"], true);
    assert!((state(&e2).circles[&k2].radius - 4.).abs() < 1e-6);
}
#[test]
fn nonlinear_work_budget_reports_unconverged_not_op_error() {
    // 64 points fully referenced by 128 distance constraints: 128 solver
    // variables and 128 residual rows put a single iteration's normal
    // equations over the (test-build) work budget, so the pass must unwind
    // to an `unconverged` report — never an op error — and publish nothing.
    let mut e = DraftEngine::new();
    let ids: Vec<u64> = (0..64).map(|i| point(&mut e, i as f64, (i % 7) as f64)).collect();
    for i in 0..128 {
        let (a, b) = (ids[i % 64], ids[(i * 7 + 1) % 64]);
        assert!(a != b);
        constraint(
            &mut e,
            json!({"kind":"distance","a":a,"b":b,"value":1. + (i % 50) as f64}),
        );
    }
    let before = e.snapshot().unwrap();
    let report = apply(&mut e, "solve", json!({}));
    assert_eq!(report.data["status"], "unconverged");
    assert_eq!(report.data["applied"], false);
    assert_eq!(report.data["nonlinear"]["status"], "unconverged");
    assert!(report.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
}
