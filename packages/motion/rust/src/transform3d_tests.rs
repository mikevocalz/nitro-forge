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
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":4,"h":4,"fill":[255,0,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap()
}
fn linear_keys() -> Value {
    json!([
        {"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},
        {"time":2,"value":90,"interpolation":"linear","in_handle":null,"out_handle":null}
    ])
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
fn frame(e: &mut MotionEngine, t: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}

#[test]
fn set_eval_curves_and_projected_transform() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":2}));
    let id = shape_layer(&mut e);
    // 2D-only layer: no transform3d, no projection field.
    let plain = eval_layer(&mut e, 0., id);
    assert!(plain.get("transform3d").is_none());
    assert!(plain.get("projected_transform").is_none());
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":30,"ry":45,"z":5}}),
    );
    // describe exposes the authored 3D transform.
    let described = call(&mut e, "describe", json!({})).data;
    let stored = described["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap();
    assert_eq!(stored["transform3d"]["rx"], json!(30.));
    assert_eq!(stored["transform3d"]["z"], json!(5.));
    // rx curve evaluates; ry/z keep base values; curves clear in output.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"rx","keys":linear_keys()}),
    );
    let mid = eval_layer(&mut e, 1., id);
    assert_eq!(mid["transform3d"]["rx"], json!(45.));
    assert_eq!(mid["transform3d"]["ry"], json!(45.));
    assert_eq!(mid["transform3d"]["z"], json!(5.));
    assert!(mid["curves"].as_array().unwrap().is_empty());
    // Projected orthographic affine for identity 2D transform:
    // a'=cos(ry), b'=0, c'=sin(ry)·sin(rx), d'=cos(rx), e'=f'=0.
    let p = &mid["projected_transform"];
    let (sry, cry) = 45f64.to_radians().sin_cos();
    let (srx, crx) = 45f64.to_radians().sin_cos();
    for (k, want) in [
        ("a", cry),
        ("b", 0.),
        ("c", sry * srx),
        ("d", crx),
        ("e", 0.),
        ("f", 0.),
    ] {
        assert!(
            (p[k].as_f64().unwrap() - want).abs() < 1e-9,
            "{k}: {} != {want}",
            p[k]
        );
    }
    // z never enters the orthographic coefficients.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":45,"ry":45,"z":-9000}}),
    );
    let deep = eval_layer(&mut e, 1., id);
    assert_eq!(deep["projected_transform"], mid["projected_transform"]);
}

#[test]
fn render_ignores_3d_and_snapshot_round_trips() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let id = shape_layer(&mut e);
    let before = frame(&mut e, 0.);
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":80,"ry":-30,"z":1000}}),
    );
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"z","keys":[
            {"time":0,"value":-500,"interpolation":"linear","in_handle":null,"out_handle":null},
            {"time":1,"value":500,"interpolation":"linear","in_handle":null,"out_handle":null}
        ]}),
    );
    // Documented G1 behavior: nonzero rx/ry/z change nothing in the raster.
    assert_eq!(frame(&mut e, 0.), before);
    assert_eq!(frame(&mut e, 1.), frame(&mut e, 0.));
    // Snapshot round-trip preserves the 3D state byte-identically.
    let snap = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&snap).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), snap);
    let restored = eval_layer(&mut reopened, 0.5, id);
    assert_eq!(restored["transform3d"]["z"], json!(0.));
    assert!(restored["projected_transform"].is_object());
    // Undo/redo across the curve write.
    assert!(e.undo().unwrap());
    let undone = eval_layer(&mut e, 0.5, id);
    assert!(undone["curves"].as_array().unwrap().is_empty());
    assert_eq!(undone["transform3d"]["z"], json!(1000.));
    assert!(e.redo().unwrap());
}

#[test]
fn clear_is_atomic_and_equal_writes_are_eventless() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4}));
    let id = shape_layer(&mut e);
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":10}}),
    );
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"ry","keys":linear_keys()}),
    );
    // Identical rewrite: no event, no history.
    let same = try_call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":10,"ry":0,"z":0}}),
    )
    .unwrap();
    // ry base is still 0 (curve holds keys, base untouched) so this is equal.
    assert!(same.events.is_empty());
    // Clearing removes transform3d AND the ry curve in one write.
    let cleared = call(&mut e, "setLayer3D", json!({"layer":id,"transform3d":null}));
    assert_eq!(cleared.events.len(), 1);
    let described = call(&mut e, "describe", json!({})).data;
    let stored = described["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap();
    assert!(stored.get("transform3d").is_none());
    assert!(stored["curves"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["property"] != json!("ry")));
    // Clearing an absent transform3d is eventless.
    let again = try_call(&mut e, "setLayer3D", json!({"layer":id})).unwrap();
    assert!(again.events.is_empty());
    // Undo restores the 3D transform and its curve.
    assert!(e.undo().unwrap());
    let restored = call(&mut e, "describe", json!({})).data;
    let layer = restored["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap();
    assert_eq!(layer["transform3d"]["rx"], json!(10.));
    assert!(layer["curves"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["property"] == json!("ry")));
}

#[test]
fn bounds_locked_and_hostile_restore_reject_atomically() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4}));
    let id = shape_layer(&mut e);
    let baseline = e.snapshot().unwrap();
    for bad3d in [
        json!({"rx":1e7 + 1.}),
        json!({"ry":-1e7 - 1.}),
        json!({"z":f64::INFINITY}),
        json!({"rx":"30"}),
        json!({"roll":10}),
        json!("rx"),
    ] {
        assert!(
            try_call(
                &mut e,
                "setLayer3D",
                json!({"layer":id,"transform3d":bad3d})
            )
            .is_err(),
            "accepted {bad3d}"
        );
        assert_eq!(e.snapshot().unwrap(), baseline);
    }
    // 3D curves require transform3d.
    assert!(try_call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"rx","keys":linear_keys()})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), baseline);
    // Out-of-range curve values reject through the shared bound.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":0}}),
    );
    assert!(try_call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"rx","keys":[
            {"time":0,"value":1e7 + 1.,"interpolation":"hold","in_handle":null,"out_handle":null}
        ]})
    )
    .is_err());
    // Locked layers reject 3D edits.
    call(&mut e, "updateLayer", json!({"id":id,"locked":true}));
    assert!(try_call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":1}})
    )
    .is_err());
    // Hostile restores must leave the current (locked, transform3d) state
    // untouched — capture it fresh since earlier ops in this test mutated.
    let pre_hostile = e.snapshot().unwrap();
    // Hostile restore: strip transform3d but keep an rx curve.
    let mut state = (*e.state).clone();
    {
        let layers = &mut state.layers;
        let arc = Arc::make_mut(&mut layers[0]);
        arc.locked = false;
        arc.transform3d = None;
        arc.curves.push(Curve {
            property: Property::Rx,
            keys: Arc::new(vec![Key {
                id: 1,
                at: curve::Point {
                    time: 0.,
                    value: 10.,
                },
                interpolation: curve::Interpolation::Hold,
                incoming: None,
                outgoing: None,
            }]),
        });
        // next_key_id must admit the injected key id.
        state.next_key_id = state.next_key_id.max(2);
    }
    let hostile = encode_envelope(&serde_json::to_vec(&state).unwrap());
    assert!(e.restore(&hostile).is_err());
    assert_eq!(e.snapshot().unwrap(), pre_hostile);
    // Hostile restore: out-of-range transform3d value.
    let mut state = (*e.state).clone();
    Arc::make_mut(&mut state.layers[0]).transform3d = Some(Transform3D {
        rx: 1e9,
        ry: 0.,
        z: 0.,
    });
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), pre_hostile);
    // Hostile restore: unknown transform3d field fails closed.
    let mut wire = serde_json::to_value(&*e.state).unwrap();
    wire["layers"][0]["transform3d"] = json!({"rx":0,"ry":0,"z":0,"roll":1});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), pre_hostile);
}

#[test]
fn nested_comp_layers_project_too() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":2}));
    let comp = call(&mut e, "addComposition", json!({"width":8,"height":8})).data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":0,"y":0,"w":2,"h":2,"fill":[0,255,0,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":inner,"transform3d":{"ry":90}}),
    );
    let r = e
        .apply(Command::new("evaluate", json!({"time_s":0})))
        .unwrap();
    let comp_json = &r.data["compositions"][comp.to_string()];
    let layer = comp_json["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(inner))
        .unwrap();
    assert_eq!(layer["transform3d"]["ry"], json!(90.));
    // ry = 90° edge-on: projected x coefficient vanishes.
    assert!(layer["projected_transform"]["a"].as_f64().unwrap().abs() < 1e-9);
}
