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
fn media_layer(e: &mut MotionEngine) -> u64 {
    call(
        e,
        "addMediaLayer",
        json!({"name":"clip","media":{"source_id":"host://clip/7","in_point":2.5}}),
    )
    .data["layer_id"]
    .as_u64()
    .unwrap()
}
fn find_layer(e: &mut MotionEngine, id: u64) -> Value {
    let described = call(e, "describe", json!({})).data;
    described["layers"]
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
fn add_set_clear_media_round_trip() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = media_layer(&mut e);
    let stored = find_layer(&mut e, id);
    assert_eq!(stored["kind"], json!("media"));
    assert_eq!(stored["media"]["source_id"], json!("host://clip/7"));
    assert_eq!(stored["media"]["in_point"], json!(2.5));
    // Schema stays 2: media is additive serde, describe reports schema 2.
    let described = call(&mut e, "describe", json!({})).data;
    assert_eq!(described["schema"], json!(2));
    // evaluate exposes the stored spec verbatim; in_point does not remap time.
    let evaluated = e
        .apply(Command::new("evaluate", json!({"time_s":1})))
        .unwrap()
        .data;
    let ev = evaluated["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap();
    assert_eq!(ev["media"]["source_id"], json!("host://clip/7"));
    // Replace then clear via setLayerMedia.
    call(
        &mut e,
        "setLayerMedia",
        json!({"layer":id,"media":{"source_id":"other","in_point":0}}),
    );
    assert_eq!(find_layer(&mut e, id)["media"]["source_id"], json!("other"));
    call(&mut e, "setLayerMedia", json!({"layer":id,"media":null}));
    assert!(find_layer(&mut e, id).get("media").is_none());
    // Empty media layer still renders transparent and kind stays media.
    assert!(frame(&mut e, 0.).iter().all(|b| *b == 0));
    // Undo restores the spec; redo re-clears.
    assert!(e.undo().unwrap());
    assert_eq!(find_layer(&mut e, id)["media"]["source_id"], json!("other"));
    assert!(e.redo().unwrap());
    assert!(find_layer(&mut e, id).get("media").is_none());
}

#[test]
fn media_renders_transparent_and_never_fakes_pixels() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let media = media_layer(&mut e);
    // A media-only frame is fully transparent at every time — no footage,
    // no checkerboard, no placeholder pixels.
    for t in [0., 0.5, 1., 2.] {
        assert!(frame(&mut e, t).iter().all(|b| *b == 0));
    }
    // Sibling shape pixels composite normally; the media layer contributes
    // nothing above or below it.
    let shape = shape_layer(&mut e);
    call(
        &mut e,
        "updateLayer",
        json!({"id":shape,"transform":{"tx":0,"ty":0}}),
    );
    let pixels = frame(&mut e, 0.);
    assert!(pixels.iter().any(|b| *b != 0));
    // Transform/opacity/blend still apply to the (transparent) layer
    // without error; a fill effect cannot invent alpha from nothing.
    call(
        &mut e,
        "updateLayer",
        json!({"id":media,"transform":{"tx":1,"ty":1,"sx":2,"sy":2},"opacity":0.5}),
    );
    call(
        &mut e,
        "setLayerEffects",
        json!({"layer":media,"effects":[{"kind":"fill","color":[9,9,9,255],"opacity":1}]}),
    );
    let with_effect = frame(&mut e, 0.);
    // Only the shape's own pixels remain; the effected media layer adds none.
    let shape_only = {
        let mut solo = MotionEngine::new();
        call(&mut solo, "new", json!({"width":4,"height":4,"duration_s":2}));
        let s = shape_layer(&mut solo);
        call(
            &mut solo,
            "updateLayer",
            json!({"id":s,"transform":{"tx":0,"ty":0}}),
        );
        frame(&mut solo, 0.)
    };
    assert_eq!(with_effect, shape_only);
}

#[test]
fn media_composes_like_other_layers_minus_content() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let media = media_layer(&mut e);
    let shape = shape_layer(&mut e);
    // Transform parenting, blend, clipping flags and matte all accept a
    // media layer; curves animate its transform like any other layer.
    call(&mut e, "setLayerParent", json!({"layer":media,"parent":shape}));
    call(&mut e, "setLayerBlend", json!({"layer":media,"blend":"multiply"}));
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":media,"property":"tx","keys":[
            {"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},
            {"time":2,"value":2,"interpolation":"linear","in_handle":null,"out_handle":null}
        ]}),
    );
    let mid = e
        .apply(Command::new("evaluate", json!({"time_s":1})))
        .unwrap()
        .data;
    let ev = mid["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(media))
        .unwrap();
    assert_eq!(ev["transform"]["tx"], json!(1.));
    assert_eq!(ev["parent_id"], json!(shape));
    // A media layer as matte source derives an all-zero (transparent) mask,
    // hiding the target — honest behavior for a layer with no pixels.
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":shape,"matte":{"source_layer":media,"mode":"alpha"}}),
    );
    assert!(frame(&mut e, 0.).iter().all(|b| *b == 0));
    // Nested composition target works.
    let comp = call(&mut e, "addComposition", json!({"name":"inner"}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = call(
        &mut e,
        "addMediaLayer",
        json!({"comp":comp,"media":{"source_id":"nested","in_point":1}}),
    )
    .data["layer_id"]
    .as_u64()
    .unwrap();
    let described = call(&mut e, "describe", json!({})).data;
    let inner_stored = described["compositions"][comp.to_string()]["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(inner))
        .unwrap();
    assert_eq!(inner_stored["kind"], json!("media"));
    assert_eq!(inner_stored["media"]["source_id"], json!("nested"));
}

#[test]
fn media_validation_bounds_and_kind_exclusivity() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let shape = shape_layer(&mut e);
    let media = media_layer(&mut e);
    let before = e.snapshot().unwrap();
    // source_id bounds: empty, >512 bytes, control characters.
    for bad_id in [
        json!({"source_id":"","in_point":0}),
        json!({"source_id":"x".repeat(513),"in_point":0}),
        json!({"source_id":"bad\n id","in_point":0}),
        json!({"source_id":"tab\tid","in_point":0}),
    ] {
        assert!(try_call(
            &mut e,
            "setLayerMedia",
            json!({"layer":media,"media":bad_id})
        )
        .is_err());
        assert!(try_call(
            &mut e,
            "addMediaLayer",
            json!({"media":bad_id})
        )
        .is_err());
    }
    // in_point bounds: negative, non-finite, above the duration ceiling.
    for bad_point in [json!(-0.5), json!(1e30), json!("2"), json!(null)] {
        assert!(try_call(
            &mut e,
            "setLayerMedia",
            json!({"layer":media,"media":{"source_id":"ok","in_point":bad_point}})
        )
        .is_err());
    }
    // Missing source_id and unknown fields reject (deny_unknown_fields).
    for bad_media in [
        json!({"in_point":0}),
        json!({"source_id":"ok","in_point":0,"fps":24}),
        json!("not-an-object"),
        json!([1, 2]),
    ] {
        assert!(try_call(
            &mut e,
            "setLayerMedia",
            json!({"layer":media,"media":bad_media})
        )
        .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // Kind exclusivity: setLayerMedia rejects non-media layers.
    assert!(try_call(
        &mut e,
        "setLayerMedia",
        json!({"layer":shape,"media":{"source_id":"x","in_point":0}})
    )
    .is_err());
    // updateLayer cannot patch media content (allowlist rejects it).
    assert!(try_call(
        &mut e,
        "updateLayer",
        json!({"id":media,"media":{"source_id":"x","in_point":0}})
    )
    .is_err());
    // Locked media layers reject edits.
    call(&mut e, "updateLayer", json!({"id":media,"locked":true}));
    let locked_state = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "setLayerMedia",
        json!({"layer":media,"media":{"source_id":"x","in_point":0}})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), locked_state);
    // Hostile restores: media spec on a shape layer, media kind with a
    // shape payload, out-of-bounds spec, and unknown media fields all
    // reject without touching live state.
    for mutate in [
        // media field on a non-media layer
        |s: &mut Value| {
            s["layers"][0]["media"] = json!({"source_id":"x","in_point":0});
        },
        // media kind carrying a shape payload
        |s: &mut Value| {
            s["layers"][1]["kind"] = json!("media");
            s["layers"][1]["shape"] = json!({"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,0,0,255]});
            s["layers"][1].as_object_mut().unwrap().remove("media");
        },
        // out-of-range in_point
        |s: &mut Value| {
            s["layers"][1]["media"]["in_point"] = json!(-1);
        },
        // oversized source_id
        |s: &mut Value| {
            s["layers"][1]["media"]["source_id"] = json!("x".repeat(600));
        },
        // unknown field inside media
        |s: &mut Value| {
            s["layers"][1]["media"]["codec"] = json!("h264");
        },
    ] {
        let mut wire = serde_json::to_value(&*e.state).unwrap();
        mutate(&mut wire);
        let bytes = encode_envelope(&serde_json::to_vec(&wire).unwrap());
        let mut hostile = MotionEngine::new();
        assert!(hostile.restore(&bytes).is_err());
        // And the live engine rejects the same bytes without state loss.
        assert!(e.restore(&bytes).is_err());
        assert_eq!(e.snapshot().unwrap(), locked_state);
    }
}

#[test]
fn media_snapshot_round_trip_undo_redo_and_equal_writes() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":2}));
    let id = media_layer(&mut e);
    // Snapshot round-trip preserves kind/media; schema stays 2.
    let bytes = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&bytes).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), bytes);
    let wire: Value = serde_json::from_slice(&decode_envelope(&bytes).unwrap().1).unwrap();
    assert_eq!(wire["schema"], json!(2));
    assert_eq!(wire["layers"][0]["kind"], json!("media"));
    assert_eq!(wire["layers"][0]["media"]["in_point"], json!(2.5));
    // Equal writes are eventless and preserve redo.
    let equal = try_call(
        &mut e,
        "setLayerMedia",
        json!({"layer":id,"media":{"source_id":"host://clip/7","in_point":2.5}}),
    )
    .unwrap();
    assert!(equal.events.is_empty());
    // addMediaLayer without a spec creates an empty media layer.
    let empty = call(&mut e, "addMediaLayer", json!({"name":"empty"}))
        .data["layer_id"]
        .as_u64()
        .unwrap();
    let stored = find_layer(&mut e, empty);
    assert_eq!(stored["kind"], json!("media"));
    assert!(stored.get("media").is_none());
    // removeLayer works on media layers; source_ids are not raster assets,
    // so removeRasterAsset is unaffected by them.
    call(&mut e, "removeLayer", json!({"id":empty}));
    assert!(e
        .apply(Command::new(
            "removeRasterAsset",
            json!({"id":999})
        ))
        .is_err());
    // Undo/redo across add+set is atomic per op.
    assert!(e.undo().unwrap());
    assert!(find_layer(&mut e, id)["media"]["source_id"] == json!("host://clip/7"));
}
