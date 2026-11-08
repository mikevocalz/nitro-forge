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
    apply(&mut e, "updateSegment", json!({"id":segs[2],"visible":false}));
    assert_eq!(
        find_profiles(&mut e, json!({}))["profiles"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    apply(&mut e, "updateSegment", json!({"id":segs[2],"visible":true}));
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
    for (a, b) in [(j, p), (p, q), (q, r), (r, j), (j, s), (s, t), (t, u), (u, j)] {
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
    assert_eq!(find_profiles(&mut f, json!({}))["profiles"], json!(profiles));
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
    let seg = apply(&mut e, "addSegment", json!({"a":a,"b":b,"layer":notes}))
        .data["segment_id"]
        .as_u64()
        .unwrap();
    let described = apply(&mut e, "describe", json!({})).data;
    assert_eq!(described["segments"][seg.to_string()]["layer"], notes);
    let plain = apply(&mut e, "addSegment", json!({"a":a,"b":b})).data["segment_id"]
        .as_u64()
        .unwrap();
    let described = apply(&mut e, "describe", json!({})).data;
    assert!(described["segments"][plain.to_string()].get("layer").is_none());
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
        .apply(Command::new("updateLayer", json!({"id":walls,"name":"Other"})))
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
    assert!(apply(&mut e, "querySnap", json!({"x":1.5,"y":0.1,"tolerance":0.2})).data["candidate"].is_null());
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
    let snap = apply(&mut e, "querySnap", json!({"x":1.5,"y":0.1,"tolerance":0.2})).data;
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
    let snap = apply(&mut e, "querySnap", json!({"x":1.6,"y":1.5,"tolerance":0.5})).data;
    assert!(snap["candidate"].is_null());
}
#[test]
fn locked_layers_reject_edits_until_unlocked_and_assignment_is_allowed() {
    let mut e = DraftEngine::new();
    let locked = layer(&mut e, "Locked");
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":true}));
    let a = point(&mut e, 0., 0.);
    let b = point(&mut e, 3., 0.);
    let seg = apply(&mut e, "addSegment", json!({"a":a,"b":b,"layer":locked}))
        .data["segment_id"]
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
    let other = apply(&mut e, "addSegment", json!({"a":c,"b":d,"layer":locked}))
        .data["segment_id"]
        .as_u64()
        .unwrap();
    assert!(e
        .apply(Command::new("updateSegment", json!({"id":other,"visible":false})))
        .is_err());
    // Unlocking the layer restores edits; re-locking rejects them again.
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":false}));
    apply(&mut e, "updateSegment", json!({"id":seg,"name":"renamed"}));
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":true}));
    assert!(e
        .apply(Command::new("updateSegment", json!({"id":seg,"name":"again"})))
        .is_err());
    apply(&mut e, "updateLayer", json!({"id":locked,"locked":false}));
    apply(&mut e, "updateSegment", json!({"id":seg,"name":"final"}));
    assert_eq!(state(&e).segments[&seg].name, "final");
    // Unknown layer assignment fails closed through full state validation.
    assert!(e
        .apply(Command::new("addSegment", json!({"a":a,"b":b,"layer":4242})))
        .is_err());
    assert!(e
        .apply(Command::new("updateSegment", json!({"id":other,"layer":4242})))
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
    let seg = apply(&mut e, "addSegment", json!({"a":a,"b":b,"layer":walls}))
        .data["segment_id"]
        .as_u64()
        .unwrap();
    let extended = e.snapshot().unwrap();
    let (_, payload) = decode_envelope(&extended).unwrap();
    let wrapped: Value = serde_json::from_slice(payload).unwrap();
    assert_eq!(wrapped["kind"], "draft");
    assert_eq!(wrapped["schema"], 2);
    assert_eq!(wrapped["document"]["layers"][walls.to_string()]["name"], "Walls");
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
    reserved["document"]["layers"]["0"] = json!({"id":0,"name":"Zero","color":null,"visible":true,"locked":false});
    cases.push(reserved);
    let mut duplicate = wrapped.clone();
    duplicate["document"]["layers"]["77"] = json!({"id":77,"name":"Walls","color":null,"visible":true,"locked":false});
    cases.push(duplicate);
    cases.push(wrapped["document"].clone());
    let mut bad_field = wrapped.clone();
    bad_field["document"]["segments"][seg.to_string()]["layer"] = json!("Walls");
    cases.push(bad_field);
    let mut empty_name = wrapped.clone();
    empty_name["document"]["layers"][walls.to_string()]["name"] = json!("");
    cases.push(empty_name);
    for invalid in cases {
        assert!(
            reopened
                .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
                .is_err()
        );
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
            apply(
                e,
                "addSegment",
                json!({"a":p,"b":q,"layer":layer}),
            )
            .data["segment_id"]
                .as_u64()
                .unwrap(),
        );
    }
    edges
}
fn hatch(e: &mut DraftEngine, payload: Value) -> u64 {
    apply(e, "addHatch", payload).data["hatch_id"].as_u64().unwrap()
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
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":2.}))
        .data["circle_id"]
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
    let noop = apply(
        &mut e,
        "updateHatch",
        json!({"id":tri,"name":"Hatch"}),
    );
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
        json!([[[0.,0.],[1.,0.]]]),
        json!([[[0.,0.],[1.,0.],[2.,0.]]]),
        json!([[[0.,0.],[1.,1.],[2.,2.],[3.,3.]]]),
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
    bad_loop["document"]["hatches"][free.to_string()]["loops"] = json!([[[0.,0.],[1.,0.]]]);
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
        json!([[[0.,0.],[2e6,0.],[0.,1.]]]);
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
    assert_eq!(ev["dimensions"][linear.to_string()]["measured"]["value"], 7.);
    // Aligned measures the direct distance; angular the unsigned vertex angle.
    let aligned = dimension(&mut e, json!({"kind":"aligned","points":[a,c]}));
    ev = evaluate(&mut e);
    let got = ev["dimensions"][aligned.to_string()]["measured"]["value"]
        .as_f64()
        .unwrap();
    assert!((got - 4f64.hypot(3.)).abs() < 1e-9);
    let angular = dimension(
        &mut e,
        json!({"kind":"angular","points":[a,b,c]}),
    );
    ev = evaluate(&mut e);
    let got = ev["dimensions"][angular.to_string()]["measured"]["value"]
        .as_f64()
        .unwrap();
    // Vertex a=(0,0); rays to b=(7,0) and c=(4,3): angle between them.
    let want = (28f64 / 35.).acos().to_degrees();
    assert!((got - want).abs() < 1e-9);
    // Radial/diameter measure circle and arc entities.
    let center = point(&mut e, 20., 0.);
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":3.}))
        .data["circle_id"]
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
    assert_eq!(ev["dimensions"][radial.to_string()]["measured"]["value"], 3.);
    assert_eq!(ev["dimensions"][diameter.to_string()]["measured"]["value"], 6.);
    // Real stroked pixels: only dimensions exist, no segments.
    let rgba = pixels(&mut e, 24, 4);
    assert!(rgba.iter().any(|v| *v != 0));
    // Describe exposes the authored map; evaluate adds status/measured.
    let described = apply(&mut e, "describe", json!({})).data;
    assert_eq!(described["dimensions"][linear.to_string()]["kind"], "linear");
    assert!(described["dimensions"][linear.to_string()].get("status").is_none());
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
    apply(&mut e, "updateDimension", json!({"id":dim,"name":"Renamed","visible":false}));
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
    apply(&mut e, "updateDimension", json!({"id":dim,"points":[c,dpt],"visible":true}));
    let ev = evaluate(&mut e);
    let d = &ev["dimensions"][dim.to_string()];
    assert_eq!(d["status"], "linked");
    assert_eq!(d["measured"]["value"], 5.);
    // Entity deletion orphans radial/diameter references the same way.
    let center = point(&mut e, 20., 0.);
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":2.}))
        .data["circle_id"]
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
    assert_eq!(evaluate(&mut e)["dimensions"][radial.to_string()]["status"], "orphaned");
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
    let _seg = apply(
        &mut e,
        "addSegment",
        json!({"a":a,"b":b,"layer":lay}),
    )
    .data["segment_id"]
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
        .apply(Command::new("updateDimension", json!({"id":free,"name":"x"})))
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
    assert_eq!(value["document"]["dimensions"][dim.to_string()]["kind"], "linear");
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
    wrong_kind_ref["document"]["dimensions"][dim.to_string()]["points"] =
        json!([a, seg_id]);
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
    let linear = dimension(
        &mut e,
        json!({"kind":"linear","points":[a,b],"axis":"x"}),
    );
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
    let circle = apply(&mut e, "addCircle", json!({"center":center,"radius":1.}))
        .data["circle_id"]
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
    assert_eq!(ev["dimensions"][radial.to_string()]["measured"]["value"], 1.);
    assert_eq!(ev["dimensions"][diameter.to_string()]["measured"]["value"], 2.);
    assert!(apply(
        &mut e,
        "renderFrame",
        json!({"width":8,"height":4,"origin_x":0,"origin_y":0,"scale":1e-6}),
    )
    .data["pixels_b64"]
    .is_string());
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
