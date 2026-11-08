use super::*;
fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
}
fn shape(e: &mut MotionEngine, comp: Option<u64>) -> u64 {
    let mut p = json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,0,0,255]}});
    if let Some(c) = comp {
        p["comp"] = json!(c);
    }
    call(e, "addShapeLayer", p).data["layer_id"]
        .as_u64()
        .unwrap()
}
fn comp(e: &mut MotionEngine, p: Value) -> u64 {
    call(e, "addComposition", p).data["comp_id"]
        .as_u64()
        .unwrap()
}
fn comp_layer(e: &mut MotionEngine, target: u64, into: Option<u64>) -> u64 {
    let mut p = json!({"comp":target});
    if let Some(c) = into {
        p["into"] = json!(c);
    }
    call(e, "addCompLayer", p).data["layer_id"]
        .as_u64()
        .unwrap()
}
fn pixels(e: &mut MotionEngine, t: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}
fn ingest(e: &mut MotionEngine, w: u32, h: u32, bytes: Vec<u8>) -> u64 {
    e.apply(
        Command::new(
            "addRasterAsset",
            json!({"width":w,"height":h,"format":assets::FORMAT}),
        )
        .with_binary(Some(bytes)),
    )
    .unwrap()
    .data["asset_id"]
        .as_u64()
        .unwrap()
}
fn red_at(px: &[u8], i: usize) -> bool {
    px[i * 4..i * 4 + 4] == [255, 0, 0, 255]
}

#[test]
fn nested_comp_renders_real_pixels_with_proportional_time_mapping() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":3,"height":1,"duration_s":1}));
    let c = comp(&mut e, json!({"width":3,"height":1,"duration_s":2}));
    let inner = shape(&mut e, Some(c));
    // Child comp is 2s inside a 1s root: local time = 2 * root time.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":inner,"property":"tx","keys":[
            {"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},
            {"time":1,"value":2,"interpolation":"linear","in_handle":null,"out_handle":null}]}),
    );
    comp_layer(&mut e, c, None);
    assert_eq!(pixels(&mut e, 0.), {
        let mut v = vec![0; 12];
        v[0..4].copy_from_slice(&[255, 0, 0, 255]);
        v
    });
    // t=0.5 -> child t=1 -> tx=2 -> pixel x=2. Absolute mapping would give x=1.
    assert!(red_at(&pixels(&mut e, 0.5), 2));
    assert!(red_at(&pixels(&mut e, 1.), 2));
    // evaluate exposes the composition structure and evaluated layers.
    let ev = call(&mut e, "evaluate", json!({"time_s":0.5}));
    assert_eq!(ev.data["compositions"][c.to_string()]["id"], json!(c));
    assert_eq!(
        ev.data["compositions"][c.to_string()]["layers"][0]["transform"]["tx"],
        json!(2.0)
    );
    let d = call(&mut e, "describe", json!({}));
    assert_eq!(
        d.data["compositions"][c.to_string()]["duration_s"],
        json!(2.0)
    );
    assert_eq!(d.data["schema"], json!(2));
}

#[test]
fn comp_ops_duplicate_parent_reparent_and_removal_rules() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":1,"duration_s":1}));
    let a = comp(&mut e, json!({"width":4,"height":1,"name":"A"}));
    let b = comp(&mut e, json!({"width":4,"height":1,"name":"B"}));
    let inner = shape(&mut e, Some(a));
    // Transform parent inside one composition.
    let parent = shape(&mut e, Some(a));
    call(&mut e, "updateLayer", json!({"id":parent,"visible":false}));
    call(
        &mut e,
        "setLayerParent",
        json!({"layer":inner,"parent":parent}),
    );
    call(
        &mut e,
        "updateLayer",
        json!({"id":parent,"transform":{"tx":2}}),
    );
    let inst = comp_layer(&mut e, a, None);
    // Child inherits the parent's translation: red lands at x=2, not x=0.
    assert!(red_at(&pixels(&mut e, 0.), 2));
    // Clearing the parent link returns the child to its local transform.
    call(
        &mut e,
        "setLayerParent",
        json!({"layer":inner,"parent":null}),
    );
    assert!(red_at(&pixels(&mut e, 0.), 0));
    // setLayerParent across compositions and self-parenting reject atomically.
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "setLayerParent",
        json!({"layer":inner,"parent":inst})
    )
    .is_err());
    assert!(try_call(
        &mut e,
        "setLayerParent",
        json!({"layer":inner,"parent":inner})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Duplicate copies layers with fresh identities and keeps rendering.
    let dup = call(&mut e, "duplicateComposition", json!({"id":a})).data["comp_id"]
        .as_u64()
        .unwrap();
    assert_ne!(dup, a);
    let d = call(&mut e, "describe", json!({}));
    let src_layers = d.data["compositions"][a.to_string()]["layers"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(
        d.data["compositions"][dup.to_string()]["layers"]
            .as_array()
            .unwrap()
            .len(),
        src_layers
    );
    // Reparent the instanced comp layer into composition b, then undo.
    let pos_before = d.data["layers"].as_array().unwrap().len();
    call(
        &mut e,
        "reparentLayer",
        json!({"layer":inst,"comp":b,"index":0}),
    );
    let d2 = call(&mut e, "describe", json!({}));
    assert_eq!(d2.data["layers"].as_array().unwrap().len(), pos_before - 1);
    assert_eq!(
        d2.data["compositions"][b.to_string()]["layers"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(e.undo().unwrap());
    let d3 = call(&mut e, "describe", json!({}));
    assert_eq!(d3.data["layers"].as_array().unwrap().len(), pos_before);
    // removeComposition rejects while referenced, succeeds after unlinking.
    assert!(try_call(&mut e, "removeComposition", json!({"id":a})).is_err());
    call(&mut e, "removeLayer", json!({"id":inst}));
    // `a` still contains no comp references to itself; b holds none either,
    // but `a` is referenced by nothing now — removal succeeds.
    call(&mut e, "removeComposition", json!({"id":a}));
    // Unreferenced empty composition b can also be removed.
    call(&mut e, "removeComposition", json!({"id":b}));
    assert!(try_call(&mut e, "removeComposition", json!({"id":99})).is_err());
}

#[test]
fn comp_depth_cycle_caps_and_aggregate_layer_budget_are_enforced() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    // Ten compositions fit under the cap; comps are root-sized 8x8.
    let mut comps = Vec::new();
    for _ in 0..10 {
        comps.push(comp(&mut e, json!({"width":8,"height":8})));
    }
    // Chain root -> c1 -> ... -> c8 is the maximum admitted depth.
    for i in 0..8 {
        let target = comps[i];
        let into = if i == 0 { None } else { Some(comps[i - 1]) };
        comp_layer(&mut e, target, into);
    }
    // A ninth level rejects atomically.
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "addCompLayer",
        json!({"comp":comps[8],"into":comps[7]})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Direct cycle and self reference reject.
    assert!(try_call(
        &mut e,
        "addCompLayer",
        json!({"comp":comps[0],"into":comps[0]})
    )
    .is_err());
    // Two-node cycle: x -> y then y -> x.
    let (x, y) = (comps[8], comps[9]);
    comp_layer(&mut e, y, Some(x));
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "addCompLayer", json!({"comp":x,"into":y})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Sixteen-composition cap on a fresh document.
    let mut e3 = MotionEngine::new();
    call(&mut e3, "new", json!({"width":8,"height":8,"duration_s":1}));
    for _ in 0..16 {
        comp(&mut e3, json!({"width":8,"height":8}));
    }
    let before = e3.snapshot().unwrap();
    assert!(try_call(&mut e3, "addComposition", json!({})).is_err());
    assert_eq!(e3.snapshot().unwrap(), before);
    // Aggregate layer budget spans all compositions.
    let mut e2 = MotionEngine::new();
    call(&mut e2, "new", json!({"width":8,"height":8}));
    let c = comp(&mut e2, json!({}));
    for _ in 0..127 {
        shape(&mut e2, None);
    }
    shape(&mut e2, Some(c));
    let before = e2.snapshot().unwrap();
    assert!(try_call(
        &mut e2,
        "addShapeLayer",
        json!({
            "comp":c,
            "shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,0,0,255]}
        })
    )
    .is_err());
    assert_eq!(e2.snapshot().unwrap(), before);
}

#[test]
fn batch_atomicity_and_snapshot_schema_migration() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":2,"duration_s":1}));
    let c = comp(&mut e, json!({"width":2,"height":2}));
    shape(&mut e, Some(c));
    let inst = comp_layer(&mut e, c, None);
    let before = e.snapshot().unwrap();
    // A batch that links then deletes the referenced composition must not apply.
    assert!(try_call(
        &mut e,
        ignition_core::OP_BATCH,
        json!({"commands":[
            {"op":"updateLayer","payload":{"id":inst,"name":"Temp"}},
            {"op":"removeComposition","payload":{"id":c}}
        ]})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // schema:2 -> strip additive fields -> schema:1 restores cleanly.
    let _snap = e.snapshot().unwrap();
    let mut wire = serde_json::to_value(&*e.state).unwrap();
    wire["schema"] = json!(1);
    // schema:1 cannot express comp layers; drop the instance from the root.
    wire["layers"]
        .as_array_mut()
        .unwrap()
        .retain(|l| l.get("comp_id").is_none() || l["comp_id"].is_null());
    for layer in wire["layers"].as_array_mut().unwrap().iter_mut() {
        let o = layer.as_object_mut().unwrap();
        o.remove("kind");
        o.remove("parent_id");
        o.remove("comp_id");
    }
    wire.as_object_mut().unwrap().remove("compositions");
    wire.as_object_mut().unwrap().remove("next_comp_id");
    let mut old = MotionEngine::new();
    old.restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .unwrap();
    assert_eq!(old.state.schema, 1);
    assert!(old.state.compositions.is_empty());
    // First real mutation upgrades the snapshot to schema:2.
    let root_layer = if old.state.layers.is_empty() {
        shape(&mut old, None)
    } else {
        old.state.layers[0].id
    };
    call(
        &mut old,
        "updateLayer",
        json!({"id":root_layer,"name":"Migrated"}),
    );
    let mut reopened = MotionEngine::new();
    reopened.restore(&old.snapshot().unwrap()).unwrap();
    assert_eq!(reopened.state.schema, 2);
}

#[test]
fn shear_composed_parent_transform_fails_render_not_state() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let parent = shape(&mut e, None);
    let child = shape(&mut e, None);
    call(
        &mut e,
        "updateLayer",
        json!({"id":parent,"transform":{"sx":2,"sy":1}}),
    );
    call(
        &mut e,
        "updateLayer",
        json!({"id":child,"transform":{"rotation":45}}),
    );
    call(
        &mut e,
        "setLayerParent",
        json!({"layer":child,"parent":parent}),
    );
    // S(2,1)·R(45°) cannot decompose into a shear-free Prism transform.
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "renderFrame", json!({"time_s":0})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // evaluate still reports the child's local transform; parenting is a
    // render-time composition only.
    let ev = call(&mut e, "evaluate", json!({"time_s":0}));
    let layers = ev.data["layers"].as_array().unwrap();
    let evaluated = layers
        .iter()
        .find(|l| l["id"].as_u64() == Some(child))
        .unwrap();
    assert_eq!(evaluated["transform"]["rotation"], json!(45.0));
    assert_eq!(evaluated["transform"]["sx"], json!(1.0));
    assert_eq!(evaluated["parent_id"], json!(parent));
    // Clearing the parent makes the same document render again.
    call(
        &mut e,
        "setLayerParent",
        json!({"layer":child,"parent":null}),
    );
    assert!(e
        .apply(Command::new("renderFrame", json!({"time_s":0})).with_binary(None))
        .is_ok());
}

#[test]
fn duplicate_composition_preserves_comp_and_asset_references() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let inner = comp(&mut e, json!({"width":4,"height":4}));
    shape(&mut e, Some(inner));
    let outer = comp(&mut e, json!({"width":4,"height":4}));
    let inst = comp_layer(&mut e, inner, Some(outer));
    let asset = ingest(&mut e, 1, 1, vec![7, 8, 9, 255]);
    let raster = call(
        &mut e,
        "addRasterLayer",
        json!({"asset_id":asset,"comp":outer}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    let dup = call(&mut e, "duplicateComposition", json!({"id":outer})).data["comp_id"]
        .as_u64()
        .unwrap();
    assert_ne!(dup, outer);
    let d = call(&mut e, "describe", json!({}));
    let layers = d.data["compositions"][dup.to_string()]["layers"]
        .as_array()
        .unwrap();
    assert_eq!(layers.len(), 2);
    // comp_id/asset_id references still target the same shared entities while
    // layer identities are fresh.
    let comp_copy = layers
        .iter()
        .find(|l| l["comp_id"] == json!(inner))
        .expect("duplicated comp layer keeps comp_id reference");
    assert_ne!(comp_copy["id"].as_u64().unwrap(), inst);
    let raster_copy = layers
        .iter()
        .find(|l| l["asset_id"] == json!(asset))
        .expect("duplicated raster layer keeps asset_id reference");
    assert_ne!(raster_copy["id"].as_u64().unwrap(), raster);
    // The duplicated composition still renders through the shared references.
    comp_layer(&mut e, dup, None);
    assert!(e
        .apply(Command::new("renderFrame", json!({"time_s":0})).with_binary(None))
        .is_ok());
}

#[test]
fn set_layer_order_targets_the_owning_composition() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":1,"duration_s":1}));
    let a = comp(&mut e, json!({"width":4,"height":1}));
    let b = comp(&mut e, json!({"width":4,"height":1}));
    let r1 = shape(&mut e, None);
    let r2 = shape(&mut e, None);
    let a1 = shape(&mut e, Some(a));
    let a2 = shape(&mut e, Some(a));
    shape(&mut e, Some(b));
    // An exact permutation of one composition's id set reorders only it.
    call(&mut e, "setLayerOrder", json!({"order":[a2,a1]}));
    let d = call(&mut e, "describe", json!({}));
    let order_of = |v: &Value| -> Vec<u64> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|l| l["id"].as_u64().unwrap())
            .collect()
    };
    assert_eq!(
        order_of(&d.data["compositions"][a.to_string()]["layers"]),
        vec![a2, a1]
    );
    assert_eq!(order_of(&d.data["layers"]), vec![r1, r2]);
    call(&mut e, "setLayerOrder", json!({"order":[r2,r1]}));
    let d = call(&mut e, "describe", json!({}));
    assert_eq!(order_of(&d.data["layers"]), vec![r2, r1]);
    assert_eq!(
        order_of(&d.data["compositions"][a.to_string()]["layers"]),
        vec![a2, a1]
    );
    // Mixed or partial id sets reject atomically.
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "setLayerOrder", json!({"order":[r1,a1]})).is_err());
    assert!(try_call(&mut e, "setLayerOrder", json!({"order":[r1]})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn reparent_layer_index_bounds_and_root_target() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":1,"duration_s":1}));
    let a = comp(&mut e, json!({"width":4,"height":1}));
    shape(&mut e, Some(a));
    let l = shape(&mut e, None);
    // index beyond the destination length rejects atomically.
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "reparentLayer",
        json!({"layer":l,"comp":a,"index":2})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // index == len appends; comp 0 selects the root composition.
    call(
        &mut e,
        "reparentLayer",
        json!({"layer":l,"comp":a,"index":1}),
    );
    call(
        &mut e,
        "reparentLayer",
        json!({"layer":l,"comp":0,"index":0}),
    );
    let d = call(&mut e, "describe", json!({}));
    assert_eq!(d.data["layers"][0]["id"], json!(l));
    assert_eq!(d.data["layers"].as_array().unwrap().len(), 1);
    assert_eq!(
        d.data["compositions"][a.to_string()]["layers"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn schema2_missing_kind_rejects_while_schema1_infers() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":2,"duration_s":1}));
    shape(&mut e, None);
    let state = serde_json::to_value(&*e.state).unwrap();
    // schema:2 writers always emit kind; a missing one is hostile input.
    let mut s2 = state.clone();
    s2["layers"][0].as_object_mut().unwrap().remove("kind");
    let before = e.snapshot().unwrap();
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&s2).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // The identical payload at schema:1 restores via content inference.
    let mut s1 = state;
    s1["schema"] = json!(1);
    for layer in s1["layers"].as_array_mut().unwrap() {
        layer.as_object_mut().unwrap().remove("kind");
    }
    let mut old = MotionEngine::new();
    old.restore(&encode_envelope(&serde_json::to_vec(&s1).unwrap()))
        .unwrap();
    assert_eq!(old.state.layers[0].kind, Some(LayerKind::Shape));
}

#[test]
fn hostile_composition_restores_reject_without_mutating() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let c = comp(&mut e, json!({"width":2,"height":2}));
    shape(&mut e, Some(c));
    comp_layer(&mut e, c, None);
    let good = e.snapshot().unwrap();
    let state = serde_json::to_value(&*e.state).unwrap();
    // Unknown composition reference.
    let mut bad = state.clone();
    bad["layers"][0]["comp_id"] = json!(999);
    bad["layers"][0]["kind"] = json!("comp");
    bad["layers"][0].as_object_mut().unwrap().remove("shape");
    // make it a comp layer properly
    bad["layers"][0]["asset_id"] = Value::Null;
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&bad).unwrap()))
        .is_err());
    // Cyclic composition references.
    let mut cyc = state.clone();
    cyc["compositions"][c.to_string()]["layers"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":50,"name":"back","visible":true,"locked":false,
            "kind":"comp","comp_id":1,"transform":{"tx":0,"ty":0,"sx":1,"sy":1,"rotation":0,"ox":0,"oy":0},
            "opacity":1,"curves":[]}));
    cyc["next_layer_id"] = json!(60);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&cyc).unwrap()))
        .is_err());
    // Composition larger than its containing composition.
    let mut big = state.clone();
    big["compositions"][c.to_string()]["width"] = json!(8);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&big).unwrap()))
        .is_err());
    // Layer parent cycle inside a composition.
    let mut pc = state.clone();
    let layers = pc["compositions"][c.to_string()]["layers"]
        .as_array_mut()
        .unwrap();
    layers[0]["parent_id"] = json!(layers[0]["id"].as_u64().unwrap());
    // self-parent is rejected; make a two-layer cycle instead
    layers[0].as_object_mut().unwrap().remove("parent_id");
    if layers.len() > 1 {
        layers[0]["parent_id"] = json!(layers[1]["id"]);
        layers[1]["parent_id"] = json!(layers[0]["id"]);
    } else {
        layers[0]["parent_id"] = json!(layers[0]["id"].as_u64().unwrap());
    }
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&pc).unwrap()))
        .is_err());
    // Over-depth chain: root -> c(1) -> 2 -> ... -> 10 is ten comp levels.
    let mut deep = state.clone();
    for i in 2..=10u64 {
        deep["compositions"][i.to_string()] = json!({"id":i,"name":"d","width":2,"height":2,
            "duration_s":1,"frame_rate":{"num":30,"den":1},"layers":[]});
    }
    deep["next_comp_id"] = json!(11);
    for i in 2..=9u64 {
        deep["compositions"][i.to_string()]["layers"] = json!([{
            "id":100+i,"name":"l","visible":true,"locked":false,"kind":"comp",
            "comp_id":i+1,
            "transform":{"tx":0,"ty":0,"sx":1,"sy":1,"rotation":0,"ox":0,"oy":0},
            "opacity":1,"curves":[]}]);
    }
    deep["compositions"][c.to_string()]["layers"]
        .as_array_mut()
        .unwrap()
        .retain(|l| l["kind"] != "comp");
    deep["compositions"][c.to_string()]["layers"]
        .as_array_mut()
        .unwrap()
        .push(
            json!({"id":100,"name":"l","visible":true,"locked":false,"kind":"comp",
            "comp_id":2,
            "transform":{"tx":0,"ty":0,"sx":1,"sy":1,"rotation":0,"ox":0,"oy":0},
            "opacity":1,"curves":[]}),
        );
    deep["next_layer_id"] = json!(200);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&deep).unwrap()))
        .is_err());
    // schema:3 and wrong kind reject.
    let mut s3 = state.clone();
    s3["schema"] = json!(3);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&s3).unwrap()))
        .is_err());
    let mut wrong = state.clone();
    wrong["kind"] = json!("photo");
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&wrong).unwrap()))
        .is_err());
    // Every rejection left the document untouched.
    assert_eq!(e.snapshot().unwrap(), good);
}
