use super::path::{MotionPath, PathNode, MAX_PATH_NODES, MAX_PATH_SAMPLES};
use super::*;

fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
}
fn layer(e: &mut MotionEngine) -> u64 {
    call(
        e,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,0,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap()
}
fn node(x: f64, y: f64) -> PathNode {
    PathNode {
        x,
        y,
        in_handle: None,
        out_handle: None,
    }
}
fn line_path(x0: f64, y0: f64, x1: f64, y1: f64) -> MotionPath {
    MotionPath {
        nodes: vec![node(x0, y0), node(x1, y1)],
        closed: false,
        auto_orient: false,
    }
}
fn progress_keys() -> Value {
    json!([
        {"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},
        {"time":1,"value":1,"interpolation":"linear","in_handle":null,"out_handle":null}
    ])
}
fn evaluated(e: &mut MotionEngine, t: f64) -> Value {
    call(e, "evaluate", json!({"time_s":t})).data["layers"][0].clone()
}

#[test]
fn polyline_arc_length_and_progress_are_exact() {
    // Right angle: (0,0)->(3,0)->(3,4), total length 7.
    let path = MotionPath {
        nodes: vec![node(0., 0.), node(3., 0.), node(3., 4.)],
        closed: false,
        auto_orient: false,
    };
    assert!((path.arc_length() - 7.).abs() < 1e-9);
    let (x, y, deg) = path.sample_at(0.).unwrap();
    assert_eq!((x, y, deg), (0., 0., 0.));
    // Half the arc length lands mid-second-segment at (3, 0.5), tangent +y.
    let (x, y, deg) = path.sample_at(0.5).unwrap();
    assert!((x - 3.).abs() < 1e-9 && (y - 0.5).abs() < 1e-9);
    assert!((deg - 90.).abs() < 1e-9);
    let (x, y, _) = path.sample_at(1.).unwrap();
    assert!((x - 3.).abs() < 1e-9 && (y - 4.).abs() < 1e-9);
    // A single-node path is a constant offset with zero tangent.
    let single = MotionPath {
        nodes: vec![node(2., 5.)],
        closed: false,
        auto_orient: false,
    };
    assert_eq!(single.sample_at(0.7).unwrap(), (2., 5., 0.));
    // Closed square perimeter 8: progress .5 is the opposite corner (2,2).
    let square = MotionPath {
        nodes: vec![node(0., 0.), node(2., 0.), node(2., 2.), node(0., 2.)],
        closed: true,
        auto_orient: false,
    };
    assert!((square.arc_length() - 8.).abs() < 1e-9);
    let (x, y, _) = square.sample_at(0.5).unwrap();
    assert!((x - 2.).abs() < 1e-9 && (y - 2.).abs() < 1e-9);
}

#[test]
fn bezier_paths_subdivide_within_the_sample_budget() {
    // Out-handle pulls the curve right; length exceeds the chord, stays
    // under the control polygon, and stays inside the sample cap.
    let mut path = line_path(0., 0., 10., 0.);
    path.nodes[0].out_handle = Some([0., 10.]);
    path.nodes[1].in_handle = Some([0., -10.]);
    let length = path.arc_length();
    assert!(length > 10. && length < 10. + 20.);
    // Many-node worst case stays within MAX_PATH_SAMPLES vertices.
    let mut many = MotionPath {
        nodes: (0..MAX_PATH_NODES)
            .map(|i| {
                let mut n = node(i as f64, (i % 2) as f64);
                n.out_handle = Some([1., 1.]);
                n
            })
            .collect(),
        closed: false,
        auto_orient: false,
    };
    assert!(many.validate().is_ok());
    assert!(many.arc_length().is_finite() && many.arc_length() > 0.);
    assert!(many.sample_count() <= MAX_PATH_SAMPLES);
    // 257 nodes and out-of-range coordinates reject.
    many.nodes.push(node(0., 0.));
    assert!(many.validate().is_err());
    let mut bad = line_path(0., 0., 1e7 + 1., 0.);
    assert!(bad.validate().is_err());
    bad = line_path(0., 0., 1., 0.);
    bad.nodes[0].out_handle = Some([f64::NAN, 0.]);
    assert!(bad.validate().is_err());
}

#[test]
fn path_progress_curve_positions_layer_along_path() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":1,"duration_s":1}));
    let id = layer(&mut e);
    call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":[{"x":0,"y":0},{"x":7,"y":0}]}}),
    );
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"path_progress","keys":progress_keys()}),
    );
    // Progress 0 -> path start adds (0,0); progress 1 -> path end adds (7,0).
    assert_eq!(evaluated(&mut e, 0.)["transform"]["tx"], json!(0.));
    assert_eq!(evaluated(&mut e, 0.5)["transform"]["tx"], json!(3.5));
    let end = evaluated(&mut e, 1.);
    assert_eq!(end["transform"]["tx"], json!(7.));
    assert_eq!(end["path_progress"], json!(1.));
    // Rendered pixels move with the evaluated offset.
    let frame = |e: &mut MotionEngine, t: f64| {
        e.apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
            .unwrap()
            .output
            .unwrap()
    };
    let start = frame(&mut e, 0.);
    let stop = frame(&mut e, 1.);
    assert_eq!(start[3], 255); // red pixel at x=0
    assert_eq!(stop[7 * 4 + 3], 255); // red pixel at x=7
    assert_eq!(stop[3], 0);
}

#[test]
fn auto_orient_adds_tangent_angle_to_rotation() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    let id = layer(&mut e);
    call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":[{"x":0,"y":0},{"x":4,"y":0},{"x":4,"y":4}],"auto_orient":true}}),
    );
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"path_progress","keys":progress_keys()}),
    );
    // Arc length 8: progress .25 is mid-first-leg (tangent 0deg), .5 sits on
    // the corner where the flattened edge direction is +y (90deg), .75 mid
    // second leg.
    let quarter = evaluated(&mut e, 0.25);
    assert_eq!(quarter["transform"]["rotation"], json!(0.));
    let half = evaluated(&mut e, 0.5);
    assert_eq!(half["transform"]["rotation"], json!(90.));
    let three_q = evaluated(&mut e, 0.75);
    assert_eq!(three_q["transform"]["rotation"], json!(90.));
    // Without auto_orient the same path leaves rotation untouched.
    call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":[{"x":0,"y":0},{"x":4,"y":0},{"x":4,"y":4}]}}),
    );
    assert_eq!(evaluated(&mut e, 0.5)["transform"]["rotation"], json!(0.));
}

#[test]
fn motion_path_validation_clear_and_hostile_restore() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    let id = layer(&mut e);
    let baseline = e.snapshot().unwrap();
    // path_progress curve without a path rejects atomically.
    assert!(try_call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"path_progress","keys":progress_keys()}),
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), baseline);
    // Over-budget and non-finite paths reject at op time.
    let nodes: Vec<Value> = (0..=MAX_PATH_NODES).map(|i| json!({"x":i,"y":0})).collect();
    assert!(try_call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":nodes}}),
    )
    .is_err());
    assert!(try_call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":[{"x":0,"y":0},{"x":1e7+1.0,"y":0}]}}),
    )
    .is_err());
    assert!(try_call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":[{"x":0,"y":0}],"bogus":1}}),
    )
    .is_err());
    // Locked layers reject path edits.
    call(&mut e, "setMotionPath", json!({"layer":id,"path":{"nodes":[{"x":0,"y":0},{"x":7,"y":0}]}}));
    call(&mut e, "updateLayer", json!({"id":id,"locked":true}));
    assert!(try_call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":null}),
    )
    .is_err());
    call(&mut e, "updateLayer", json!({"id":id,"locked":false}));
    // Clearing the path removes the progress curve and base atomically.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"path_progress","keys":progress_keys()}),
    );
    let with_path = e.snapshot().unwrap();
    call(&mut e, "setMotionPath", json!({"layer":id,"path":null}));
    let cleared = evaluated(&mut e, 0.5);
    assert!(cleared["path"].is_null() || cleared.get("path").is_none());
    assert_eq!(cleared["transform"]["tx"], json!(0.));
    assert!(cleared["curves"].as_array().unwrap().is_empty());
    let cleared_snap = e.snapshot().unwrap();
    // Hostile restores: path_progress without path, bad node count, and a
    // schema:2 document missing the additive fields still restores.
    let mut hostile = serde_json::to_value(&*e.state).unwrap();
    let layers = hostile["layers"].as_array_mut().unwrap();
    layers[0]["path_progress"] = json!(0.5);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
        .is_err());
    let mut hostile = serde_json::to_value(&*e.state).unwrap();
    let layers = hostile["layers"].as_array_mut().unwrap();
    layers[0]["path"] = json!({"nodes":[],"closed":false,"auto_orient":false});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
        .is_err());
    // A pre-E snapshot (no path/path_progress keys, no path_progress curve)
    // restores unchanged: strip the additive fields from the with-path
    // snapshot and confirm the result equals the cleared document.
    let (_, payload) = decode_envelope(&with_path).unwrap();
    let mut legacy: Value = serde_json::from_slice(&payload).unwrap();
    for layer in legacy["layers"].as_array_mut().unwrap() {
        layer.as_object_mut().unwrap().remove("path");
        layer.as_object_mut().unwrap().remove("path_progress");
        if let Some(curves) = layer["curves"].as_array_mut() {
            curves.retain(|c| c["property"] != "path_progress");
        }
    }
    let mut fresh = MotionEngine::new();
    fresh
        .restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
        .unwrap();
    assert_eq!(fresh.snapshot().unwrap(), cleared_snap);
    // Undo/redo round-trips the path op.
    call(&mut e, "setMotionPath", json!({"layer":id,"path":{"nodes":[{"x":0,"y":0},{"x":7,"y":0}]}}));
    let attached = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), cleared_snap);
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), attached);
}

#[test]
fn extreme_path_offsets_saturate_at_transform_bound() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    let id = layer(&mut e);
    call(
        &mut e,
        "updateLayer",
        json!({"id":id,"transform":{"tx":5e6,"rotation":1e7}}),
    );
    // Node x=1e7 plus tx=5e6 would reach 1.5e7, and the downward segment's
    // +90deg tangent would push rotation to 1e7+90 — both beyond Prism's
    // ±1e7 transform bound on an otherwise valid document.
    call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":[{"x":1e7,"y":0},{"x":1e7,"y":1}],"auto_orient":true}}),
    );
    let l = evaluated(&mut e, 0.);
    assert_eq!(l["transform"]["tx"], json!(1e7));
    assert_eq!(l["transform"]["ty"], json!(0.));
    assert_eq!(l["transform"]["rotation"], json!(1e7));
    // renderFrame must not fail on the saturated transform.
    let frame = e
        .apply(Command::new("renderFrame", json!({"time_s":0})).with_binary(None))
        .unwrap();
    assert_eq!(frame.data["width"], json!(8));
}
