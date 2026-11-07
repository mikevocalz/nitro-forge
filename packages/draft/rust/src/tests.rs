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
    serde_json::from_slice(decode_envelope(&e.snapshot().unwrap()).unwrap().1).unwrap()
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
