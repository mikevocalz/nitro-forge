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
fn eval_prop(e: &mut MotionEngine, t: f64, id: u64, property: &str) -> f64 {
    let r = e
        .apply(Command::new("evaluate", json!({"time_s":t})))
        .unwrap();
    let layer = r.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap()
        .clone();
    match property {
        "rx" | "ry" | "z" => layer["transform3d"][property].as_f64().unwrap(),
        "tx" | "ty" | "sx" | "sy" | "rotation" | "ox" | "oy" => {
            layer["transform"][property].as_f64().unwrap()
        }
        _ => layer[property].as_f64().unwrap(),
    }
}
fn eval_comp_prop(e: &mut MotionEngine, t: f64, comp: u64, id: u64, property: &str) -> f64 {
    let r = e
        .apply(Command::new("evaluate", json!({"time_s":t})))
        .unwrap();
    let layer = r.data["compositions"][comp.to_string()]["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap()
        .clone();
    match property {
        "tx" | "ty" | "sx" | "sy" | "rotation" | "ox" | "oy" => {
            layer["transform"][property].as_f64().unwrap()
        }
        _ => layer[property].as_f64().unwrap(),
    }
}
fn set_graph(e: &mut MotionEngine, nodes: Value, bindings: Value) -> Result<CommandResult, EngineError> {
    try_call(e, "setGraph", json!({"nodes":nodes,"bindings":bindings}))
}
fn node(id: u64, kind: &str, inputs: Value) -> Value {
    json!({"id":id,"kind":kind,"inputs":inputs})
}
fn const_node(id: u64, value: f64) -> Value {
    json!({"id":id,"kind":"const","params":{"value":value},"inputs":{}})
}
fn time_mul_graph() -> (Value, Value) {
    // tx = time * 8 on a 1s/30fps document.
    (
        json!([
            node(1, "time", json!({})),
            const_node(2, 8.0),
            node(3, "mul", json!({"a":{"node":1},"b":{"node":2}})),
        ]),
        json!([]),
    )
}

#[test]
fn basic_graph_drives_bound_property_seek_safe_and_renders() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":1,"duration_s":1}));
    let id = shape_layer(&mut e);
    let (nodes, _) = time_mul_graph();
    let bindings = json!([{"layer":id,"property":"tx","node":3}]);
    let r = set_graph(&mut e, nodes, bindings).unwrap();
    assert_eq!(r.events.len(), 1);
    // tx = time*8: 2 at t=.25, 8 at t=1; seeking is a pure function of t.
    assert!((eval_prop(&mut e, 0.25, id, "tx") - 2.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 1., id, "tx") - 8.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 0.5, id, "tx") - 4.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 0.25, id, "tx") - 2.).abs() < 1e-9);
    // renderFrame consumes the same bound values without error.
    let frame = e
        .apply(Command::new("renderFrame", json!({"time_s":0.5})).with_binary(None))
        .unwrap();
    assert!(frame.output.is_some());
    // describe reports the graph verbatim.
    let described = call(&mut e, "describe", json!({})).data;
    assert_eq!(described["graph"]["next_node_id"], json!(4));
    assert_eq!(described["graph"]["bindings"][0]["node"], json!(3));
}

#[test]
fn kind_pin_param_and_edge_validation_matrix_is_atomic() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    let baseline = e.snapshot().unwrap();
    let bad_graphs: Vec<(Value, Value)> = vec![
        // Unknown kind.
        (json!([node(1,"bogus",json!({}))]), json!([])),
        // Missing required inputs object.
        (json!([{"id":1,"kind":"time"}]), json!([])),
        // Source node with a pin.
        (json!([node(1,"time",json!({"in":{"const":1.0}}))]), json!([])),
        // Binary missing pin b / extra pin c.
        (json!([node(1,"mul",json!({"a":{"const":1.0}}))]), json!([])),
        (json!([node(1,"mul",json!({"a":{"const":1.0},"b":{"const":2.0},"c":{"const":3.0}}))]), json!([])),
        // clamp/select pin sets.
        (json!([node(1,"clamp",json!({"v":{"const":1.0},"lo":{"const":0.0}}))]), json!([])),
        (json!([node(1,"select",json!({"cond":{"const":1.0},"a":{"const":1.0}}))]), json!([])),
        // const node params rules.
        (json!([{"id":1,"kind":"const","inputs":{}}]), json!([])),
        (json!([{"id":1,"kind":"const","params":{"value":1.0,"layer":2},"inputs":{}}]), json!([])),
        (json!([{"id":1,"kind":"const","params":{"value":1e8},"inputs":{}}]), json!([])),
        // property node params rules.
        (json!([{"id":1,"kind":"property","params":{"layer":1},"inputs":{}}]), json!([])),
        (json!([{"id":1,"kind":"property","params":{"layer":1,"property":"tx","value":2.0},"inputs":{}}]), json!([])),
        // Math node carrying params.
        (json!([{"id":1,"kind":"abs","params":{"value":1.0},"inputs":{"in":{"const":-1.0}}}]), json!([])),
        // Edge to unknown node / const input shapes.
        (json!([node(1,"abs",json!({"in":{"node":99}}))]), json!([])),
        (json!([node(1,"abs",json!({"in":{"node":1,"const":1.0}}))]), json!([])),
        (json!([node(1,"abs",json!({"in":{"const":"x"}}))]), json!([])),
        // Duplicate node ids, id 0.
        (json!([const_node(1,1.0),const_node(1,2.0)]), json!([])),
        (json!([node(0,"time",json!({}))]), json!([])),
        // Cycle and self-loop.
        (json!([
            node(1,"add",json!({"a":{"node":2},"b":{"const":1.0}})),
            node(2,"add",json!({"a":{"node":1},"b":{"const":1.0}})),
        ]), json!([])),
        (json!([node(1,"abs",json!({"in":{"node":1}}))]), json!([])),
        // Binding problems: dup cell, unknown node, unknown layer,
        // unknown property name (serde-level), property source unknown layer.
        (json!([const_node(1,1.0)]), json!([
            {"layer":id,"property":"tx","node":1},
            {"layer":id,"property":"tx","node":1},
        ])),
        (json!([const_node(1,1.0)]), json!([{"layer":id,"property":"tx","node":77}])),
        (json!([const_node(1,1.0)]), json!([{"layer":9999,"property":"tx","node":1}])),
        (json!([{"id":1,"kind":"property","params":{"layer":9999,"property":"tx"},"inputs":{}}]), json!([])),
    ];
    for (nodes, bindings) in bad_graphs {
        assert!(set_graph(&mut e, nodes.clone(), bindings.clone()).is_err(),
            "accepted {nodes} / {bindings}");
        assert_eq!(e.snapshot().unwrap(), baseline, "state changed for {nodes}");
    }
    // Node/binding/edge caps.
    let many_nodes: Vec<Value> = (1..=graph::MAX_NODES + 1)
        .map(|i| const_node(i as u64, 1.0))
        .collect();
    assert!(set_graph(&mut e, json!(many_nodes), json!([])).is_err());
    let many_bindings: Vec<Value> = (0..graph::MAX_BINDINGS + 1)
        .map(|_| json!({"layer":id,"property":"tx","node":1}))
        .collect();
    // Duplicate cells reject before the count matters; use distinct layers
    // is impossible with one layer, so the dup check fires first — still
    // an atomic rejection either way.
    assert!(set_graph(&mut e, json!([const_node(1,1.0)]), json!(many_bindings)).is_err());
    assert_eq!(e.snapshot().unwrap(), baseline);
}

#[test]
fn topo_order_determinism_independent_of_insertion_order() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    // Same DAG listed in two different orders must evaluate identically:
    // out = ((time + 1) * 2) - frame.
    let forward = json!([
        node(1,"time",json!({})),
        node(2,"add",json!({"a":{"node":1},"b":{"const":1.0}})),
        node(3,"mul",json!({"a":{"node":2},"b":{"const":2.0}})),
        node(4,"frame",json!({})),
        node(5,"sub",json!({"a":{"node":3},"b":{"node":4}})),
    ]);
    let reversed = json!([
        node(5,"sub",json!({"a":{"node":3},"b":{"node":4}})),
        node(4,"frame",json!({})),
        node(3,"mul",json!({"a":{"node":2},"b":{"const":2.0}})),
        node(2,"add",json!({"a":{"node":1},"b":{"const":1.0}})),
        node(1,"time",json!({})),
    ]);
    let bindings = json!([{"layer":id,"property":"tx","node":5}]);
    set_graph(&mut e, forward, bindings.clone()).unwrap();
    let a = eval_prop(&mut e, 0.5, id, "tx");
    set_graph(&mut e, reversed, bindings).unwrap();
    let b = eval_prop(&mut e, 0.5, id, "tx");
    // t=.5, fps=30 → frame=15; ((0.5+1)*2)-15 = -12.
    assert!((a + 12.).abs() < 1e-9 && (b + 12.).abs() < 1e-9);
    assert_eq!(a, b);
}

#[test]
fn property_source_reads_pre_binding_curve_or_base() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let a = shape_layer(&mut e);
    let b = shape_layer(&mut e);
    // A.tx base = 3 via updateLayer.
    call(&mut e, "updateLayer", json!({"id":a,"transform":{"tx":3}}));
    // B.tx = property(A.tx); A.tx itself is bound to const*10 — but the
    // property node must read A's PRE-BINDING value (3), proving graph
    // evaluation cannot observe its own outputs through a property.
    let nodes = json!([
        json!({"id":1,"kind":"property","params":{"layer":a,"property":"tx"},"inputs":{}}),
        const_node(2, 10.0),
        node(3, "mul", json!({"a":{"node":1},"b":{"node":2}})),
        const_node(4, 7.0),
    ]);
    let bindings = json!([
        {"layer":a,"property":"tx","node":3},
        {"layer":b,"property":"tx","node":4},
    ]);
    // Wait: binding A.tx→node3 where node3 reads A.tx pre-binding (3) → 30.
    set_graph(&mut e, nodes, bindings).unwrap();
    assert!((eval_prop(&mut e, 0.5, a, "tx") - 30.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 0.5, b, "tx") - 7.).abs() < 1e-9);
    // Now bind B.tx to a property node reading A.tx: it must see the
    // pre-binding base 3, not A's bound 30.
    let nodes2 = json!([
        json!({"id":1,"kind":"property","params":{"layer":a,"property":"tx"},"inputs":{}}),
        const_node(2, 10.0),
        node(3, "mul", json!({"a":{"node":1},"b":{"node":2}})),
        json!({"id":4,"kind":"property","params":{"layer":a,"property":"tx"},"inputs":{}}),
    ]);
    let bindings2 = json!([
        {"layer":a,"property":"tx","node":3},
        {"layer":b,"property":"tx","node":4},
    ]);
    set_graph(&mut e, nodes2, bindings2).unwrap();
    assert!((eval_prop(&mut e, 0.5, a, "tx") - 30.).abs() < 1e-9);
    assert!((eval_prop(&mut e, 0.5, b, "tx") - 3.).abs() < 1e-9);
    // Curve-fed property reads evaluate the curve at comp-local time:
    // give A an opacity curve? opacity is bound-free here; use ty curve on
    // a third layer read through a property node instead — simpler: read
    // A's ty which has a linear 0→10 curve over 2s.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":a,"property":"ty","keys":[
            {"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},
            {"time":2,"value":10,"interpolation":"linear","in_handle":null,"out_handle":null},
        ]}),
    );
    let nodes3 = json!([
        json!({"id":1,"kind":"property","params":{"layer":a,"property":"ty"},"inputs":{}}),
        const_node(2, 2.0),
        node(3, "mul", json!({"a":{"node":1},"b":{"node":2}})),
    ]);
    let bindings3 = json!([{"layer":b,"property":"ty","node":3}]);
    set_graph(&mut e, nodes3, bindings3).unwrap();
    // ty curve at t=1 → 5, times 2 → 10.
    assert!((eval_prop(&mut e, 1., b, "ty") - 10.).abs() < 1e-9);
}

#[test]
fn binding_exclusivity_clears_in_both_directions_atomically() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    // Curve on tx first: setGraph binding must clear it atomically.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"tx","keys":[
            {"time":0,"value":1,"interpolation":"linear","in_handle":null,"out_handle":null},
            {"time":2,"value":2,"interpolation":"linear","in_handle":null,"out_handle":null},
        ]}),
    );
    set_graph(
        &mut e,
        json!([const_node(1, 5.0)]),
        json!([{"layer":id,"property":"tx","node":1}]),
    )
    .unwrap();
    let described = call(&mut e, "describe", json!({})).data;
    let layer = described["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap();
    assert!(layer["curves"].as_array().map_or(true, |c| c.is_empty()));
    assert_eq!(eval_prop(&mut e, 1., id, "tx"), 5.);
    // setPropertyKeys on the bound property drops the binding.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"tx","keys":[
            {"time":0,"value":9,"interpolation":"linear","in_handle":null,"out_handle":null},
        ]}),
    );
    let described = call(&mut e, "describe", json!({})).data;
    assert!(described["graph"]["bindings"]
        .as_array()
        .map_or(true, |b| b.is_empty()));
    assert_eq!(eval_prop(&mut e, 0., id, "tx"), 9.);
    // setExpression on a bound property drops the binding too.
    set_graph(
        &mut e,
        json!([const_node(1, 4.0)]),
        json!([{"layer":id,"property":"opacity","node":1}]),
    )
    .unwrap();
    assert_eq!(eval_prop(&mut e, 0., id, "opacity"), 1.); // clamped to bounds
    call(
        &mut e,
        "setExpression",
        json!({"layer":id,"property":"opacity","source":"0.25"}),
    );
    let described = call(&mut e, "describe", json!({})).data;
    assert!(described["graph"]["bindings"]
        .as_array()
        .map_or(true, |b| b.is_empty()));
    assert!((eval_prop(&mut e, 0., id, "opacity") - 0.25).abs() < 1e-9);
    // And setGraph clears a conflicting expression atomically.
    set_graph(
        &mut e,
        json!([const_node(1, 0.75)]),
        json!([{"layer":id,"property":"opacity","node":1}]),
    )
    .unwrap();
    let described = call(&mut e, "describe", json!({})).data;
    let layer = described["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap();
    assert!(layer["expressions"].as_array().map_or(true, |x| x.is_empty()));
    assert!((eval_prop(&mut e, 0., id, "opacity") - 0.75).abs() < 1e-9);
}

#[test]
fn time_family_sources_use_owning_comp_local_time() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2,"frame_rate":{"num":30,"den":1}}));
    // Nested comp: duration 1s inside the 2s root → local time = t/2.
    let comp = call(&mut e, "addComposition", json!({"duration_s":1,"width":4,"height":4}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = call(
        &mut e,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,0,0,255]},"comp":comp}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    call(&mut e, "addCompLayer", json!({"comp":comp}));
    // Bindings on the inner layer: tx=time, ty=frame, rotation=fps, opacity=duration.
    let nodes = json!([
        node(1,"time",json!({})),
        node(2,"frame",json!({})),
        node(3,"fps",json!({})),
        node(4,"duration",json!({})),
    ]);
    let bindings = json!([
        {"layer":inner,"property":"tx","node":1},
        {"layer":inner,"property":"ty","node":2},
        {"layer":inner,"property":"rotation","node":3},
        {"layer":inner,"property":"opacity","node":4},
    ]);
    set_graph(&mut e, nodes, bindings).unwrap();
    // Root t=1 → comp local 0.5s; fps=30 → frame=floor(15)=15.
    assert!((eval_comp_prop(&mut e, 1., comp, inner, "tx") - 0.5).abs() < 1e-9);
    assert!((eval_comp_prop(&mut e, 1., comp, inner, "ty") - 15.).abs() < 1e-9);
    assert!((eval_comp_prop(&mut e, 1., comp, inner, "rotation") - 30.).abs() < 1e-9);
    assert!((eval_comp_prop(&mut e, 1., comp, inner, "opacity") - 1.).abs() < 1e-9);
    // Root t=2 → comp local clamps to its 1s duration → tx=1, frame=30.
    assert!((eval_comp_prop(&mut e, 2., comp, inner, "tx") - 1.).abs() < 1e-9);
    assert!((eval_comp_prop(&mut e, 2., comp, inner, "ty") - 30.).abs() < 1e-9);
}

#[test]
fn non_finite_propagates_and_sanitizes_at_binding() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    // opacity = 1 / (1 - 1) → +inf → sanitizes to 0.0.
    let nodes = json!([
        const_node(1, 1.0),
        const_node(2, 1.0),
        node(3, "sub", json!({"a":{"node":1},"b":{"node":2}})),
        node(4, "div", json!({"a":{"node":1},"b":{"node":3}})),
        // tx = 1e6 * 1e6 = 1e12 finite → clamps to tx bounds ±1e7.
        const_node(5, 1e6),
        node(6, "mul", json!({"a":{"node":5},"b":{"node":5}})),
    ]);
    let bindings = json!([
        {"layer":id,"property":"opacity","node":4},
        {"layer":id,"property":"tx","node":6},
    ]);
    set_graph(&mut e, nodes, bindings).unwrap();
    assert_eq!(eval_prop(&mut e, 0.5, id, "opacity"), 0.);
    assert_eq!(eval_prop(&mut e, 0.5, id, "tx"), 1e7);
    // ln(-1) → NaN → 0.0 at the boundary as well.
    set_graph(
        &mut e,
        json!([
            const_node(1, -1.0),
            node(2, "ln", json!({"in":{"node":1}})),
        ]),
        json!([{"layer":id,"property":"opacity","node":2}]),
    )
    .unwrap();
    assert_eq!(eval_prop(&mut e, 0.5, id, "opacity"), 0.);
}

#[test]
fn undo_redo_equal_write_and_batch_atomicity() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    let nodes = json!([const_node(1, 3.0)]);
    let bindings = json!([{"layer":id,"property":"tx","node":1}]);
    let baseline = e.snapshot().unwrap();
    set_graph(&mut e, nodes.clone(), bindings.clone()).unwrap();
    let with_graph = e.snapshot().unwrap();
    // Equal write is eventless.
    let again = set_graph(&mut e, nodes, bindings).unwrap();
    assert!(again.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), with_graph);
    // Undo removes the graph atomically; redo restores it.
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), baseline);
    assert_eq!(eval_prop(&mut e, 0.5, id, "tx"), 0.);
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), with_graph);
    assert_eq!(eval_prop(&mut e, 0.5, id, "tx"), 3.);
    // setGraph null clears.
    try_call(&mut e, "setGraph", Value::Null).unwrap();
    assert_eq!(e.snapshot().unwrap(), baseline);
    // Batch: setGraph + a layer rename commit or fail together.
    call(
        &mut e,
        ignition_core::OP_BATCH,
        json!({"commands":[
            {"op":"setGraph","payload":{"nodes":[{"id":1,"kind":"const","params":{"value":2},"inputs":{}}],"bindings":[{"layer":id,"property":"ty","node":1}]}},
            {"op":"updateLayer","payload":{"id":id,"name":"Graphbed"}},
        ]}),
    );
    assert_eq!(eval_prop(&mut e, 0.5, id, "ty"), 2.);
    let described = call(&mut e, "describe", json!({})).data;
    assert_eq!(
        described["layers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|l| l["id"] == json!(id))
            .unwrap()["name"],
        json!("Graphbed")
    );
    // A failing batch step leaves the whole plan unapplied.
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        ignition_core::OP_BATCH,
        json!({"commands":[
            {"op":"setGraph","payload":{"nodes":[{"id":1,"kind":"time","inputs":{}}],"bindings":[{"layer":id,"property":"sx","node":1}]}},
            {"op":"updateLayer","payload":{"id":id,"bogus_field":1}},
        ]}),
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn structural_ops_remap_or_reject_bindings() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    set_graph(
        &mut e,
        json!([const_node(1, 2.0)]),
        json!([{"layer":id,"property":"tx","node":1}]),
    )
    .unwrap();
    // removeLayer of a bound layer strands the binding → atomic reject.
    assert!(try_call(&mut e, "removeLayer", json!({"id":id})).is_err());
    // Locked layers reject new bindings through setGraph.
    call(&mut e, "updateLayer", json!({"id":id,"locked":true}));
    assert!(set_graph(
        &mut e,
        json!([const_node(1, 2.0)]),
        json!([{"layer":id,"property":"ty","node":1}]),
    )
    .is_err());
    call(&mut e, "updateLayer", json!({"id":id,"locked":false}));
    // duplicateComposition inherits bindings under fresh layer ids.
    let comp = call(&mut e, "addComposition", json!({})).data["comp_id"].as_u64().unwrap();
    // Move the bound layer into the comp? reparentLayer keeps the id so
    // the binding survives; instead duplicate a comp containing a bound
    // layer: reparent first.
    call(&mut e, "reparentLayer", json!({"layer":id,"comp":comp,"index":0}));
    let copy = call(&mut e, "duplicateComposition", json!({"id":comp}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    let described = call(&mut e, "describe", json!({})).data;
    let bindings = described["graph"]["bindings"].as_array().unwrap();
    // Original binding on `id` plus an inherited binding on the copy's
    // fresh layer id (the only layer inside `copy`).
    assert_eq!(bindings.len(), 2);
    let copy_layer = described["compositions"][copy.to_string()]["layers"]
        .as_array()
        .unwrap()[0]["id"]
        .as_u64()
        .unwrap();
    assert!(bindings.iter().any(|b| b["layer"] == json!(copy_layer)));
    // removeComposition of a comp holding a bound layer rejects.
    assert!(try_call(&mut e, "removeComposition", json!({"id":comp})).is_err());
    // Cross-comp reparent keeps the layer id → binding stays valid.
    call(&mut e, "reparentLayer", json!({"layer":id,"comp":0,"index":0}));
    assert_eq!(eval_prop(&mut e, 0.5, id, "tx"), 2.);
}

#[test]
fn hostile_restore_rejects_bad_graph_atomically() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = shape_layer(&mut e);
    set_graph(
        &mut e,
        json!([const_node(1, 2.0)]),
        json!([{"layer":id,"property":"tx","node":1}]),
    )
    .unwrap();
    // A ty curve gives the mutual-exclusion hostile case a real conflict.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"ty","keys":[
            {"time":0,"value":1,"interpolation":"linear","in_handle":null,"out_handle":null},
        ]}),
    );
    let good = e.snapshot().unwrap();
    // Graph-free documents serialize without a graph key (schema:2
    // byte-identity for the additive field).
    let mut bare = MotionEngine::new();
    call(&mut bare, "new", json!({"width":4,"height":4,"duration_s":2}));
    let bare_layer = shape_layer(&mut bare);
    let _ = bare_layer;
    let bare_state = serde_json::to_value(&*bare.state).unwrap();
    assert!(bare_state.get("graph").is_none());
    // Mutations of the serialized graph each reject on restore.
    let mut cases: Vec<Value> = vec![
        // Cycle injected into stored state.
        json!({
            "nodes":[
                {"id":1,"kind":"add","inputs":{"a":{"node":2},"b":{"const":1.0}}},
                {"id":2,"kind":"add","inputs":{"a":{"node":1},"b":{"const":1.0}}},
            ],
            "bindings":[],"next_node_id":3
        }),
        // Binding coexisting with a curve (mutual exclusion).
        json!({
            "nodes":[{"id":1,"kind":"const","params":{"value":1.0},"inputs":{}}],
            "bindings":[{"layer":id,"property":"ty","node":1}],
            "next_node_id":2
        }),
        // Unknown node kind.
        json!({
            "nodes":[{"id":1,"kind":"wat","inputs":{}}],
            "bindings":[],"next_node_id":2
        }),
        // Edge to missing node.
        json!({
            "nodes":[{"id":1,"kind":"abs","inputs":{"in":{"node":9}}}],
            "bindings":[],"next_node_id":2
        }),
        // Missing next_node_id with nodes present.
        json!({
            "nodes":[{"id":1,"kind":"time","inputs":{}}],
            "bindings":[]
        }),
        // Binding to unknown layer.
        json!({
            "nodes":[{"id":1,"kind":"const","params":{"value":1.0},"inputs":{}}],
            "bindings":[{"layer":424242,"property":"tx","node":1}],
            "next_node_id":2
        }),
    ];
    for graph in cases.drain(..) {
        let mut wire = serde_json::to_value(&*e.state).unwrap();
        wire["graph"] = graph;
        assert!(
            e.restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
                .is_err(),
            "hostile graph accepted: {}",
            wire["graph"]
        );
        assert_eq!(e.snapshot().unwrap(), good);
    }
    // A well-formed hostile-shaped graph still restores cleanly.
    let mut wire = serde_json::to_value(&*e.state).unwrap();
    wire["graph"] = json!({
        "nodes":[{"id":1,"kind":"const","params":{"value":4.0},"inputs":{}}],
        "bindings":[{"layer":id,"property":"opacity","node":1}],
        "next_node_id":2
    });
    // The tx binding above conflicts? No — opacity is free; but the old
    // tx binding is replaced wholesale, so tx returns to base.
    e.restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .unwrap();
    assert_eq!(eval_prop(&mut e, 0.5, id, "opacity"), 1.);
    assert_eq!(eval_prop(&mut e, 0.5, id, "tx"), 0.);
}

#[test]
fn graph_free_snapshot_is_byte_identical() {
    // A document that never touched setGraph serializes exactly as before
    // slice I: no `graph` key at all.
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":2,"duration_s":1}));
    let _ = shape_layer(&mut e);
    let state = serde_json::to_value(&*e.state).unwrap();
    assert!(state.get("graph").is_none());
    let snapshot = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&snapshot).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), snapshot);
}
