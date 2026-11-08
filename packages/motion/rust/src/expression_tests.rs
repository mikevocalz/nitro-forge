use super::*;

fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
}
fn shape_layer(e: &mut MotionEngine) -> u64 {
    call(
        e,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,0,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap()
}
fn set_expr(e: &mut MotionEngine, layer: u64, property: &str, source: impl AsRef<str>) {
    let source = source.as_ref();
    try_call(
        e,
        "setExpression",
        json!({"layer":layer,"property":property,"source":source}),
    )
    .unwrap_or_else(|err| panic!("setExpression {property} {source:?} failed: {err:?}"));
}
fn eval_layer(e: &mut MotionEngine, t: f64, id: u64) -> Value {
    let r = e
        .apply(Command::new("evaluate", json!({"time_s":t})))
        .unwrap();
    r.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap()
        .clone()
}
fn described_layer(e: &mut MotionEngine, id: u64) -> Value {
    let r = call(e, "describe", json!({})).data;
    r["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap()
        .clone()
}
fn eval_prop(e: &mut MotionEngine, t: f64, id: u64, property: &str) -> f64 {
    let layer = eval_layer(e, t, id);
    match property {
        // 3D channels live under transform3d in evaluated output.
        "rx" | "ry" | "z" => layer["transform3d"][property].as_f64().unwrap(),
        // Scalar transform channels nest under `transform`.
        "tx" | "ty" | "sx" | "sy" | "rotation" | "ox" | "oy" => {
            layer["transform"][property].as_f64().unwrap()
        }
        // opacity/path_progress are top-level layer fields.
        _ => layer[property].as_f64().unwrap(),
    }
}
fn frame(e: &mut MotionEngine, t: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}
fn key(time: f64, value: f64) -> Value {
    json!([{"time":time,"value":value,"interpolation":"linear","in_handle":null,"out_handle":null}])
}

#[test]
fn parse_and_bounds_rejection_matrix_is_atomic() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    let baseline = e.snapshot().unwrap();
    for bad in [
        "1 +",
        "foo",
        "random(1)",
        "sin()",
        "sin(1,2)",
        "clamp(1,2)",
        "pow(2)",
        "this",
        "this.tx +",
        "this.bogus",
        "layer(1)",
        "layer(1).bogus",
        "layer(1.5).tx",
        "layer(-2).tx",
        "time(1)",
        "1 = 1",
        "1 &&",
        "(1",
        "1 ? 2",
        "",
        "sin(1).tx",
        "1 + * 2",
    ] {
        assert!(
            try_call(
                &mut e,
                "setExpression",
                json!({"layer":id,"property":"tx","source":bad})
            )
            .is_err(),
            "accepted {bad:?}"
        );
        assert_eq!(e.snapshot().unwrap(), baseline, "state changed for {bad:?}");
    }
    // Source byte cap.
    let oversized = format!("1+{}", "1".repeat(expressions::MAX_SOURCE_BYTES));
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":oversized})
    )
    .is_err());
    // AST node cap: ~600 literals + ~600 adds.
    let deep = format!("{}1", "1+".repeat(600));
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":deep})
    )
    .is_err());
    // Call cap: 65 nested sin() calls.
    let calls = format!("{}1{}", "sin(".repeat(65), ")".repeat(65));
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":calls})
    )
    .is_err());
    // Non-string / missing source reject; unknown property rejects.
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":42})
    )
    .is_err());
    assert!(try_call(&mut e, "setExpression", json!({"layer":id,"property":"tx"})).is_err());
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"bogus","source":"1"})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), baseline);
}

#[test]
fn mutual_exclusion_is_atomic_both_directions() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"tx","keys":key(0.,10.)}),
    );
    // setExpression deletes the tx curve in the same write.
    set_expr(&mut e, id, "tx", "time * 20");
    let described = described_layer(&mut e, id);
    assert_eq!(described["expressions"][0]["source"], json!("time * 20"));
    assert!(described["curves"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["property"] != json!("tx")));
    assert!((eval_prop(&mut e, 1., id, "tx") - 20.).abs() < 1e-9);
    // setPropertyKeys deletes the expression in the same write.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"tx","keys":key(0.,10.)}),
    );
    let described = described_layer(&mut e, id);
    assert!(described["expressions"]
        .as_array()
        .map_or(true, |v| v.is_empty()));
    assert!(described["curves"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["property"] == json!("tx")));
    assert!((eval_prop(&mut e, 0., id, "tx") - 10.).abs() < 1e-9);
    // Undo is one atomic entry per direction.
    assert!(e.undo().unwrap());
    let described = described_layer(&mut e, id);
    assert_eq!(described["expressions"][0]["source"], json!("time * 20"));
    assert!(described["curves"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["property"] != json!("tx")));
    assert!(e.undo().unwrap());
    let described = described_layer(&mut e, id);
    assert!(described["expressions"]
        .as_array()
        .map_or(true, |v| v.is_empty()));
    assert!(described["curves"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["property"] == json!("tx")));
}

#[test]
fn dependency_cycles_reject_at_op_time() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let a = shape_layer(&mut e);
    let b = shape_layer(&mut e);
    let baseline = e.snapshot().unwrap();
    // Self reference.
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":a,"property":"tx","source":"this.tx + 1"})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), baseline);
    // Two-property cycle on one layer: ty may read tx (no cycle yet).
    set_expr(&mut e, a, "ty", "this.tx * 2");
    let with_ty = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":a,"property":"tx","source":"this.ty + 1"})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), with_ty);
    // Clearing ty first, then a two-layer ping-pong still rejects.
    call(
        &mut e,
        "setExpression",
        json!({"layer":a,"property":"ty","source":null}),
    );
    set_expr(&mut e, a, "tx", format!("layer({b}).sx + 1"));
    let with_tx = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":b,"property":"sx","source":format!("layer({a}).tx + 1")})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), with_tx);
    // Acyclic cross-layer reads resolve in topo order.
    call(&mut e, "updateLayer", json!({"id":b,"transform":{"sx":3}}));
    set_expr(&mut e, b, "opacity", "0.5");
    set_expr(
        &mut e,
        a,
        "tx",
        format!("layer({b}).sx * 2 + layer({b}).opacity"),
    );
    // sx=3, opacity=0.5 → tx = 6.5.
    assert!((eval_prop(&mut e, 0., a, "tx") - 6.5).abs() < 1e-9);
}

#[test]
fn time_frame_fps_duration_and_nested_comp_time() {
    let mut e = MotionEngine::new();
    call(
        &mut e,
        "new",
        json!({"width":4,"height":4,"duration_s":10,"frame_rate":{"num":30,"den":1}}),
    );
    let id = shape_layer(&mut e);
    set_expr(&mut e, id, "tx", "time * 10");
    set_expr(&mut e, id, "ty", "frame");
    set_expr(&mut e, id, "sx", "fps");
    set_expr(&mut e, id, "sy", "duration / 10");
    // t=0.5s at 30fps → time=0.5→tx5, frame=15→ty15 (clamped? ty ±1e7 ok),
    // sx=30, sy=1.
    assert!((eval_prop(&mut e, 0.5, id, "tx") - 5.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 0.5, id, "ty") - 15.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 0.5, id, "sx") - 30.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 0.5, id, "sy") - 1.).abs() < 1e-9);
    // Nested composition: root 10s, child 5s → local time halves.
    let comp = call(&mut e, "addComposition", json!({"duration_s":5})).data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,255,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    set_expr(&mut e, inner, "tx", "time * 10");
    set_expr(&mut e, inner, "ty", "duration");
    let r = e
        .apply(Command::new("evaluate", json!({"time_s":4.})))
        .unwrap();
    let layer = r.data["compositions"][comp.to_string()]["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(inner))
        .unwrap();
    // local time = 4 * 5/10 = 2 → tx = 20; duration = 5.
    assert!((layer["transform"]["tx"].as_f64().unwrap() - 20.).abs() < 1e-9);
    assert!((layer["transform"]["ty"].as_f64().unwrap() - 5.).abs() < 1e-9);
}

#[test]
fn whitelisted_functions_and_this_refs() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let id = shape_layer(&mut e);
    let cases: &[(&str, f64)] = &[
        ("abs(-3)", 3.),
        ("floor(1.9)", 1.),
        ("ceil(1.1)", 2.),
        ("round(1.5)", 2.),
        ("trunc(-1.9)", -1.),
        ("sign(-4)", -1.),
        ("sign(0)", 0.),
        ("sqrt(2)", std::f64::consts::SQRT_2),
        ("cbrt(27)", 3.),
        ("exp(0)", 1.),
        ("ln(exp(1))", 1.),
        ("log10(100)", 2.),
        ("sin(0)", 0.),
        ("cos(0)", 1.),
        ("tan(0)", 0.),
        ("asin(1)", std::f64::consts::FRAC_PI_2),
        ("acos(1)", 0.),
        ("atan(1)", std::f64::consts::FRAC_PI_4),
        ("atan2(1,1)", std::f64::consts::FRAC_PI_4),
        ("pow(2,10)", 1024.),
        ("hypot(3,4)", 5.),
        ("min(2,3)", 2.),
        ("max(2,3)", 3.),
        ("mod(7,3)", 1.),
        ("clamp(5,0,1)", 1.),
        ("lerp(0,10,0.5)", 5.),
        ("smoothstep(0,1,0.5)", 0.5),
        ("1 < 2 ? 10 : 20", 10.),
        ("(1 > 2) + !(0)", 1.),
        ("2 * 3 + 4 / 2 - 1 % 2", 7.),
        ("-abs(-2)", -2.),
    ];
    for (source, want) in cases {
        set_expr(&mut e, id, "tx", source);
        let got = eval_prop(&mut e, 0., id, "tx");
        assert!((got - want).abs() < 1e-9, "{source} → {got}, want {want}");
    }
    // this.<prop> reads the resolved (curve-aware) value: ty keys 0→4 over
    // the duration, tx = this.ty * 2.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"ty","keys":[
            {"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},
            {"time":1,"value":4,"interpolation":"linear","in_handle":null,"out_handle":null}
        ]}),
    );
    set_expr(&mut e, id, "tx", "this.ty * 2");
    assert!((eval_prop(&mut e, 0.5, id, "tx") - 4.).abs() < 1e-9);
    // An expression reading another expression resolves through the graph.
    set_expr(&mut e, id, "sx", "this.tx + 1");
    assert!((eval_prop(&mut e, 0.5, id, "sx") - 5.).abs() < 1e-9);
}

#[test]
fn nonfinite_sanitizes_and_finite_clamps() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let id = shape_layer(&mut e);
    for (source, want) in [
        ("ln(-1)", 0.),     // NaN → 0
        ("sqrt(-1)", 0.),   // NaN → 0
        ("1/0", 0.),        // +inf → 0
        ("0/0", 0.),        // NaN → 0
        ("min(0/0,5)", 0.), // NaN propagates through min → 0
        ("-1/0", 0.),       // -inf → 0
        ("2e7", 1e7),       // finite → tx bound clamp
        ("-2e7", -1e7),
        ("clamp(2e7,-1e7,1e7)", 1e7),
        ("time", 0.), // finite in-bounds unchanged
    ] {
        set_expr(&mut e, id, "tx", source);
        let got = eval_prop(&mut e, 0., id, "tx");
        assert_eq!(got, want, "{source} → {got}, want {want}");
    }
    // Opacity/path_progress bounds clamp to 0..=1.
    set_expr(&mut e, id, "opacity", "2");
    assert_eq!(eval_prop(&mut e, 0., id, "opacity"), 1.);
    set_expr(&mut e, id, "opacity", "-3");
    assert_eq!(eval_prop(&mut e, 0., id, "opacity"), 0.);
}

#[test]
fn seek_determinism_and_render_pixels() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":1,"duration_s":1}));
    let id = shape_layer(&mut e);
    set_expr(&mut e, id, "tx", "time * 4");
    // Forward, backward, forward again: identical evaluated bytes.
    let fwd = e
        .apply(Command::new("evaluate", json!({"time_s":0.5})))
        .unwrap();
    let _ = eval_prop(&mut e, 0.9, id, "tx");
    let back = e
        .apply(Command::new("evaluate", json!({"time_s":0.5})))
        .unwrap();
    assert_eq!(fwd.data, back.data);
    // renderFrame composites the expression-driven transform.
    let start = frame(&mut e, 0.);
    let stop = frame(&mut e, 1.);
    assert_eq!(start[3], 255);
    assert_eq!(stop[4 * 4 + 3], 255);
    assert_eq!(stop[3], 0);
    // Read-only ops record nothing.
    assert!(e
        .apply(Command::new("evaluate", json!({"time_s":0.5})))
        .unwrap()
        .events
        .is_empty());
}

#[test]
fn equal_write_eventless_and_clear_semantics() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let id = shape_layer(&mut e);
    // Clearing an absent expression is eventless.
    let cleared = try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":null}),
    )
    .unwrap();
    assert!(cleared.events.is_empty());
    set_expr(&mut e, id, "tx", "time * 2");
    // Identical rewrite is eventless.
    let same = try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":"time * 2"}),
    )
    .unwrap();
    assert!(same.events.is_empty());
    // Clearing removes the expression; a later equal clear is eventless.
    call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":null}),
    );
    assert!(described_layer(&mut e, id)["expressions"]
        .as_array()
        .map_or(true, |v| v.is_empty()));
    // Locked layers reject.
    call(&mut e, "updateLayer", json!({"id":id,"locked":true}));
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":"1"})
    )
    .is_err());
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"tx","source":null})
    )
    .is_err());
}

#[test]
fn kind_gates_and_structural_clears() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    let baseline = e.snapshot().unwrap();
    // 3D channels require transform3d; path_progress requires a path.
    for (property, source) in [
        ("rx", "time"),
        ("ry", "time"),
        ("z", "time"),
        ("path_progress", "time / 2"),
    ] {
        assert!(
            try_call(
                &mut e,
                "setExpression",
                json!({"layer":id,"property":property,"source":source})
            )
            .is_err(),
            "{property} accepted without its gate"
        );
    }
    assert_eq!(e.snapshot().unwrap(), baseline);
    // With gates present the expressions are admitted.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":0,"ry":0,"z":0}}),
    );
    set_expr(&mut e, id, "rx", "time * 90");
    assert!((eval_prop(&mut e, 0.5, id, "rx") - 45.).abs() < 1e-9);
    // Clearing transform3d removes rx/ry/z expressions atomically.
    call(&mut e, "setLayer3D", json!({"layer":id,"transform3d":null}));
    assert!(described_layer(&mut e, id)["expressions"]
        .as_array()
        .map_or(true, |v| v.is_empty()));
    // path_progress expression animates the motion path.
    call(
        &mut e,
        "setMotionPath",
        json!({"layer":id,"path":{"nodes":[{"x":0,"y":0},{"x":7,"y":0}]}}),
    );
    set_expr(&mut e, id, "path_progress", "time");
    assert!((eval_prop(&mut e, 1., id, "tx") - 7.).abs() < 1e-6);
    // Clearing the path removes the path_progress expression too.
    call(&mut e, "setMotionPath", json!({"layer":id,"path":null}));
    let described = described_layer(&mut e, id);
    assert!(described["expressions"].as_array().map_or(true, |v| v
        .iter()
        .all(|e| e["property"] != json!("path_progress"))));
}

#[test]
fn hostile_restore_rejects_and_preserves_state() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let a = shape_layer(&mut e);
    let b = shape_layer(&mut e);
    set_expr(&mut e, a, "tx", format!("layer({b}).opacity * time"));
    set_expr(&mut e, b, "opacity", "0.5");
    let good = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&good).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), good);
    // Cross-composition layer() reference setup: a nested comp with one
    // layer whose id the root expression will (invalidly) name.
    let comp = call(&mut e, "addComposition", json!({})).data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,0,255,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    let pre = e.snapshot().unwrap();
    let restore_err = |e: &mut MotionEngine, mutate: &dyn Fn(&mut Value)| {
        let mut wire = serde_json::to_value(&*e.state).unwrap();
        mutate(&mut wire);
        let bytes = encode_envelope(&serde_json::to_vec(&wire).unwrap());
        assert!(e.restore(&bytes).is_err());
        assert_eq!(e.snapshot().unwrap(), pre);
    };
    // Unparseable source.
    restore_err(&mut e, &|w| {
        w["layers"][0]["expressions"][0]["source"] = json!("1 +");
    });
    // Oversized source.
    restore_err(&mut e, &|w| {
        w["layers"][0]["expressions"][0]["source"] = json!("1".repeat(5000));
    });
    // Unknown property name inside source.
    restore_err(&mut e, &|w| {
        w["layers"][0]["expressions"][0]["source"] = json!("this.bogus");
    });
    // Mutual exclusion: curve + expression on the same property.
    restore_err(&mut e, &|w| {
        w["layers"][0]["curves"] = json!([{
            "property":"tx",
            "keys":[{"id":1,"time":0,"value":0,"interpolation":"hold","in_handle":null,"out_handle":null}]
        }]);
        w["next_key_id"] = json!(2);
    });
    // Dangling layer() reference (id 999 does not exist).
    restore_err(&mut e, &|w| {
        w["layers"][0]["expressions"][0]["source"] = json!("layer(999).tx");
    });
    // Cross-composition layer() reference: root layer referencing a nested
    // comp's layer id is not "same composition".
    restore_err(&mut e, &|w| {
        w["layers"][0]["expressions"][0]["source"] = json!(format!("layer({inner}).tx"));
    });
    // Dependency cycle injected directly: a.tx reads b.opacity while
    // b.opacity reads a.tx.
    restore_err(&mut e, &|w| {
        w["layers"][1]["expressions"] = json!([{
            "property":"opacity","source":format!("layer({a}).tx")
        }]);
    });
    // Duplicate expression property on one layer.
    restore_err(&mut e, &|w| {
        let arr = w["layers"][0]["expressions"].as_array().unwrap().clone();
        let mut doubled = arr.clone();
        doubled.extend(arr);
        w["layers"][0]["expressions"] = json!(doubled);
    });
    // Kind gate: rx expression without transform3d.
    restore_err(&mut e, &|w| {
        w["layers"][0]["expressions"] = json!([{"property":"rx","source":"time"}]);
    });
    // Unknown field inside an expression entry fails closed.
    restore_err(&mut e, &|w| {
        w["layers"][0]["expressions"][0]["extra"] = json!(1);
    });
}

#[test]
fn cross_comp_layer_ref_rejects_and_same_comp_works() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let root_layer = shape_layer(&mut e);
    let comp = call(&mut e, "addComposition", json!({})).data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,255,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    let baseline = e.snapshot().unwrap();
    // A comp-layer expression naming a root layer id rejects: refs are
    // same-composition only.
    assert!(try_call(
        &mut e,
        "setExpression",
        json!({"layer":inner,"property":"tx","source":format!("layer({root_layer}).opacity")})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), baseline);
    // Same-comp layer() refs work inside the nested composition.
    let inner2 = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":2,"y":0,"w":1,"h":1,"fill":[255,255,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    call(&mut e, "updateLayer", json!({"id":inner2,"opacity":0.25}));
    set_expr(&mut e, inner, "tx", format!("layer({inner2}).opacity * 8"));
    let r = e
        .apply(Command::new("evaluate", json!({"time_s":0.})))
        .unwrap();
    let layer = r.data["compositions"][comp.to_string()]["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(inner))
        .unwrap();
    assert!((layer["transform"]["tx"].as_f64().unwrap() - 2.).abs() < 1e-9);
}

#[test]
fn duplicate_composition_remaps_layer_refs() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let comp = call(&mut e, "addComposition", json!({})).data["comp_id"]
        .as_u64()
        .unwrap();
    let a = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,0,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    let b = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":2,"y":0,"w":1,"h":1,"fill":[0,255,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    call(&mut e, "updateLayer", json!({"id":b,"opacity":0.5}));
    set_expr(&mut e, a, "tx", format!("layer({b}).opacity * 10"));
    // The copy's expression must reference the copy's layers, not the
    // originals — remap keeps duplicateComposition valid.
    let copy = call(&mut e, "duplicateComposition", json!({"id":comp})).data["comp_id"]
        .as_u64()
        .unwrap();
    let r = e
        .apply(Command::new("evaluate", json!({"time_s":0.})))
        .unwrap();
    let layers = r.data["compositions"][copy.to_string()]["layers"]
        .as_array()
        .unwrap();
    // Fresh ids: find the layer carrying an expression-driven tx = 5.
    let driven = layers
        .iter()
        .find(|l| (l["transform"]["tx"].as_f64().unwrap() - 5.).abs() < 1e-9)
        .expect("remapped expression did not evaluate");
    assert_ne!(driven["id"].as_u64().unwrap(), a);
}

#[test]
fn removing_a_referenced_layer_rejects() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let a = shape_layer(&mut e);
    let b = shape_layer(&mut e);
    set_expr(&mut e, a, "tx", format!("layer({b}).opacity"));
    let pre = e.snapshot().unwrap();
    // b is referenced by a's expression: removal would strand the ref.
    assert!(try_call(&mut e, "removeLayer", json!({"id":b})).is_err());
    assert_eq!(e.snapshot().unwrap(), pre);
    // this-refs don't block removal of the *referencing* layer.
    assert!(try_call(&mut e, "removeLayer", json!({"id":a})).is_ok());
}
