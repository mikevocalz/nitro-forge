use super::*;
fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
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
fn layer(e: &mut MotionEngine, asset: u64) -> u64 {
    call(e, "addRasterLayer", json!({"asset_id":asset})).data["layer_id"]
        .as_u64()
        .unwrap()
}
fn pixels(e: &mut MotionEngine, time: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":time})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}
#[test]
fn immutable_owned_rgba_and_shared_asset_layers_render_actual_pixels() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":1,"duration_s":1}));
    let original = vec![255, 0, 0, 255, 99, 88, 77, 0];
    let asset = ingest(&mut e, 2, 1, original.clone());
    let first = layer(&mut e, asset);
    let ptr = Arc::as_ptr(&e.state.assets[&asset].pixels);
    assert_eq!(pixels(&mut e, 0.), vec![255, 0, 0, 255, 0, 0, 0, 0]);
    let second = layer(&mut e, asset);
    call(
        &mut e,
        "updateLayer",
        json!({"id":second,"transform":{"tx":1}}),
    );
    assert_eq!(pixels(&mut e, 0.), vec![255, 0, 0, 255, 255, 0, 0, 255]);
    assert_eq!(Arc::as_ptr(&e.state.assets[&asset].pixels), ptr);
    call(&mut e, "updateLayer", json!({"id":first,"visible":false}));
    assert_eq!(pixels(&mut e, 0.), vec![0, 0, 0, 0, 255, 0, 0, 255]);
    call(&mut e, "updateLayer", json!({"id":second,"opacity":0.5}));
    let output = pixels(&mut e, 0.);
    assert_eq!(&output[4..7], &[255, 0, 0]);
    assert_eq!(output[7], 128);
    call(
        &mut e,
        "setComposition",
        json!({"title":"Asset remains shared"}),
    );
    assert_eq!(Arc::as_ptr(&e.state.assets[&asset].pixels), ptr);
    let mut read = e
        .apply(Command::new("readRasterAsset", json!({"id":asset})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert_eq!(read, original);
    read[0] = 0;
    assert_eq!(*e.state.assets[&asset].pixels, original);
    let snapshot = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&snapshot).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), snapshot);
    assert_eq!(*reopened.state.assets[&asset].pixels, original);
}
#[test]
fn raster_pivot_curves_and_history_preserve_identity_and_bytes() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":3,"height":1,"duration_s":1}));
    let asset = ingest(&mut e, 1, 1, vec![7, 8, 9, 255]);
    let l = layer(&mut e, asset);
    let original = e.snapshot().unwrap();
    call(
        &mut e,
        "updateLayer",
        json!({"id":l,"transform":{"sx":-1,"ox":0.5,"tx":1}}),
    );
    assert_eq!(
        pixels(&mut e, 0.),
        vec![0, 0, 0, 0, 7, 8, 9, 255, 0, 0, 0, 0]
    );
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":l,"property":"tx","keys":[{"time":0,"value":1,"interpolation":"linear","in_handle":null,"out_handle":null},{"time":1,"value":2,"interpolation":"linear","in_handle":null,"out_handle":null}]}),
    );
    assert_eq!(
        pixels(&mut e, 1.),
        vec![0, 0, 0, 0, 0, 0, 0, 0, 7, 8, 9, 255]
    );
    assert!(e.undo().unwrap());
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), original);
    let noop = call(&mut e, "updateLayer", json!({"id":l,"opacity":1}));
    assert!(noop.events.is_empty());
    assert!(e.redo().unwrap());
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("removeRasterAsset", json!({"id":asset})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    call(&mut e, "removeLayer", json!({"id":l}));
    call(&mut e, "removeRasterAsset", json!({"id":asset}));
    assert!(e.state.assets.is_empty());
    assert!(e.undo().unwrap());
    assert!(e.state.assets.contains_key(&asset));
}
#[test]
fn malformed_input_resize_restore_and_raster_budgets_reject_atomically() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":1}));
    let asset = ingest(&mut e, 2, 1, vec![255; 8]);
    layer(&mut e, asset);
    let original = e.snapshot().unwrap();
    for command in [
        Command::new(
            "addRasterAsset",
            json!({"width":1,"height":1,"format":assets::FORMAT}),
        )
        .with_binary(Some(vec![1; 3])),
        Command::new(
            "addRasterAsset",
            json!({"width":1,"height":1,"format":assets::FORMAT,"pixels_b64":"AAAAAA=="}),
        )
        .with_binary(Some(vec![0; 4])),
        Command::new(
            "addRasterAsset",
            json!({"width":1,"height":1,"format":assets::FORMAT,"pixels_b64":"AAAAAB=="}),
        ),
        Command::new(
            "addRasterAsset",
            json!({"width":1,"height":1,"format":assets::FORMAT,"pixels_b64":"AAA="}),
        ),
        Command::new("setComposition", json!({"width":1})),
        Command::new(
            "updateLayer",
            json!({"id":1,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,0,0,255]}}),
        ),
    ] {
        assert!(e.apply(command).is_err());
        assert_eq!(e.snapshot().unwrap(), original)
    }
    let mut corrupt = serde_json::to_value(&*e.state).unwrap();
    corrupt["assets"][asset.to_string()]["pixels_b64"] = json!("AAA=");
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&corrupt).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), original);
    let mut legacy = serde_json::to_value(State::default()).unwrap();
    legacy.as_object_mut().unwrap().remove("assets");
    legacy.as_object_mut().unwrap().remove("next_asset_id");
    let mut old = MotionEngine::new();
    old.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
        .unwrap();
    assert!(old.state.assets.is_empty());
    assert_eq!(old.state.next_asset_id, 1);
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":1024,"height":1024}));
    let a = ingest(&mut e, 1, 1, vec![0; 4]);
    for _ in 0..4 {
        layer(&mut e, a);
    }
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("addRasterLayer", json!({"asset_id":a})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn wholly_transparent_rasters_render_even_with_nonzero_pivot() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":1}));
    let a = ingest(&mut e, 1, 1, vec![9, 8, 7, 0]);
    let l = layer(&mut e, a);
    assert_eq!(pixels(&mut e, 0.), vec![0; 8]);
    call(
        &mut e,
        "updateLayer",
        json!({"id":l,"transform":{"ox":17,"oy":19,"rotation":90,"sx":-1,"tx":2}}),
    );
    assert_eq!(pixels(&mut e, 0.), vec![0; 8]);
}
#[test]
fn decoded_asset_budget_and_legacy_shape_snapshot_are_validated_before_publication() {
    let mut e = MotionEngine::new();
    let shape = call(
        &mut e,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[1,2,3,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    let mut old = serde_json::to_value(&*e.state).unwrap();
    old.as_object_mut().unwrap().remove("assets");
    old.as_object_mut().unwrap().remove("next_asset_id");
    let mut restored = MotionEngine::new();
    restored
        .restore(&encode_envelope(&serde_json::to_vec(&old).unwrap()))
        .unwrap();
    assert!(restored
        .state
        .layers
        .iter()
        .any(|l| l.id == shape && l.shape.is_some() && l.asset_id.is_none()));
    let mut e = MotionEngine::new();
    ingest(&mut e, 1024, 1024, vec![0; assets::MAX_RGBA]);
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(
            Command::new(
                "addRasterAsset",
                json!({"width":1,"height":1,"format":assets::FORMAT})
            )
            .with_binary(Some(vec![0; 4]))
        )
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let mut state = serde_json::to_value(&*e.state).unwrap();
    state["assets"]["2"] =
        json!({"id":2,"width":1,"height":1,"format":assets::FORMAT,"pixels_b64":"AAAAAA=="});
    state["next_asset_id"] = json!(3);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
