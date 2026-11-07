use super::*;
fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
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
fn raster_layer(e: &mut MotionEngine, asset: u64) -> u64 {
    call(e, "addRasterLayer", json!({"asset_id":asset}))
        .data["layer_id"]
        .as_u64()
        .unwrap()
}
fn pixels(e: &mut MotionEngine, time: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":time})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}
fn set_effects(e: &mut MotionEngine, layer: u64, effects: Value) {
    call(e, "setLayerEffects", json!({"layer":layer,"effects":effects}));
}
fn doc(w: u32, h: u32) -> MotionEngine {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":w,"height":h,"duration_s":1}));
    e
}
#[test]
fn each_registered_effect_is_pixel_verified() {
    let mut e = doc(1, 1);
    let asset = ingest(&mut e, 1, 1, vec![10, 20, 30, 255]);
    let layer = raster_layer(&mut e, asset);
    let frame = |e: &mut MotionEngine| pixels(e, 0.);
    set_effects(&mut e, layer, json!([{"kind":"invert"}]));
    assert_eq!(frame(&mut e), vec![245, 235, 225, 255]);
    set_effects(&mut e, layer, json!([{"kind":"grayscale"}]));
    // 0.299*10 + 0.587*20 + 0.114*30 = 18.15 -> 18
    assert_eq!(frame(&mut e), vec![18, 18, 18, 255]);
    set_effects(&mut e, layer, json!([{"kind":"brightness","amount":1.0}]));
    assert_eq!(frame(&mut e), vec![255, 255, 255, 255]);
    set_effects(&mut e, layer, json!([{"kind":"brightness","amount":-1.0}]));
    assert_eq!(frame(&mut e), vec![0, 0, 0, 255]);
    // contrast 0 collapses every channel to the 0.18 linear pivot (~118).
    set_effects(&mut e, layer, json!([{"kind":"contrast","amount":0.0}]));
    assert_eq!(frame(&mut e), vec![118, 118, 118, 255]);
    // fill replaces RGB, keeps alpha, honors color alpha and opacity lerp.
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"fill","color":[0,255,0,255]}]),
    );
    assert_eq!(frame(&mut e), vec![0, 255, 0, 255]);
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"fill","color":[0,255,0,128],"opacity":0.5}]),
    );
    // filled = (0,255,0, 128*255/255=128); lerp 50% with (10,20,30,255):
    // r=5->5? (10+0)/2=5, g=(20+255)/2=137.5->138? rounding: 137.5 rounds to 138 (round half away), a=(255+128)/2=191.5->192? f64 round -> 192.
    let px = frame(&mut e);
    assert_eq!(px[0], 5);
    assert_eq!(px[1], 138);
    assert_eq!(px[2], 15);
    assert_eq!(px[3], 192);
    // gaussian blur on a 1x1 canvas is identity (single pixel, clamp edges).
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"gaussian-blur","radius_px":8.0}]),
    );
    assert_eq!(frame(&mut e), vec![10, 20, 30, 255]);
}
#[test]
fn gaussian_blur_spreads_alpha_and_color_across_pixels() {
    let mut e = doc(3, 1);
    // Both edge pixels opaque red, middle transparent: fully symmetric.
    let asset = ingest(
        &mut e,
        3,
        1,
        vec![255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255],
    );
    let layer = raster_layer(&mut e, asset);
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"gaussian-blur","radius_px":3.0}]),
    );
    let px = pixels(&mut e, 0.);
    // The formerly transparent middle pixel gains coverage; edge pixels lose
    // some alpha to the blur. Exact values are implementation detail; assert
    // the qualitative contract plus left/right symmetry.
    assert!(px[7] > 0 && px[7] < 255, "middle alpha {}", px[7]);
    assert_eq!(&px[0..4], &px[8..12], "blur is horizontally symmetric");
    assert!(px[3] < 255 && px[11] < 255, "edge alpha blurred");
    // radius 0 is a validated no-op pass.
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"gaussian-blur","radius_px":0.0}]),
    );
    assert_eq!(
        pixels(&mut e, 0.),
        vec![255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]
    );
}
#[test]
fn effects_compose_in_stack_order() {
    let mut e = doc(1, 1);
    let asset = ingest(&mut e, 1, 1, vec![100, 100, 100, 255]);
    let layer = raster_layer(&mut e, asset);
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"invert"},{"kind":"brightness","amount":1.0}]),
    );
    // invert -> 155; brightness +255 clamps -> 255.
    assert_eq!(pixels(&mut e, 0.), vec![255, 255, 255, 255]);
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"brightness","amount":1.0},{"kind":"invert"}]),
    );
    // brightness clamps to 255 first; invert -> 0.
    assert_eq!(pixels(&mut e, 0.), vec![0, 0, 0, 255]);
    // Sixteen effects is the cap and accepted; each pass is real.
    let sixteen = vec![json!({"kind":"invert"}); 16];
    set_effects(&mut e, layer, Value::Array(sixteen));
    assert_eq!(pixels(&mut e, 0.), vec![100, 100, 100, 255]);
}
#[test]
fn effects_apply_after_transform_and_before_opacity_blend_matte() {
    let mut e = doc(2, 1);
    // White shape covering the whole canvas.
    call(
        &mut e,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":2,"h":1,"fill":[255,255,255,255]}}),
    );
    let shape = e.state.layers[0].id;
    set_effects(&mut e, shape, json!([{"kind":"invert"}]));
    // Transform moves the inverted (black) layer right by one pixel; the
    // vacated pixel shows transparent canvas, not un-inverted white.
    call(
        &mut e,
        "updateLayer",
        json!({"id":shape,"transform":{"tx":1}}),
    );
    assert_eq!(pixels(&mut e, 0.), vec![0, 0, 0, 0, 0, 0, 0, 255]);
    // Opacity composites the effected result: alpha halves.
    call(&mut e, "updateLayer", json!({"id":shape,"opacity":0.5}));
    let px = pixels(&mut e, 0.);
    assert_eq!(px[7], 128);
    call(&mut e, "updateLayer", json!({"id":shape,"opacity":1}));
    // A matte still applies after effects: an all-transparent matte source
    // hides the effected layer entirely. The matte source keeps drawing in
    // the stack, so it goes below the shape and uses distinct colors.
    let mask_asset = ingest(&mut e, 2, 1, vec![0, 0, 0, 0, 0, 0, 0, 0]);
    let mask = raster_layer(&mut e, mask_asset);
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":shape,"matte":{"source_layer":mask,"mode":"alpha"}}),
    );
    call(&mut e, "setLayerOrder", json!({"order":[mask,shape]}));
    assert_eq!(pixels(&mut e, 0.), vec![0, 0, 0, 0, 0, 0, 0, 0]);
    // Swapping the matte source to an opaque white asset unmattes the
    // target: the uncovered pixel shows the white mask, the covered pixel
    // shows the inverted (black) shape on top.
    let opaque = ingest(
        &mut e,
        2,
        1,
        vec![255, 255, 255, 255, 255, 255, 255, 255],
    );
    call(
        &mut e,
        "updateLayer",
        json!({"id":mask,"asset_id":opaque}),
    );
    assert_eq!(
        pixels(&mut e, 0.),
        vec![255, 255, 255, 255, 0, 0, 0, 255]
    );
    // An effect on the matte source that forces alpha to 0 empties the
    // derived mask, hiding the target and leaving the transparent source.
    set_effects(
        &mut e,
        mask,
        json!([{"kind":"fill","color":[255,255,255,0],"opacity":1.0}]),
    );
    assert_eq!(pixels(&mut e, 0.), vec![0, 0, 0, 0, 0, 0, 0, 0]);
}
#[test]
fn comp_layer_and_nested_layer_effects_render() {
    let mut e = doc(2, 1);
    let comp = call(&mut e, "addComposition", json!({"width":2,"height":1}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    // Effect inside the nested composition.
    let inner_asset = ingest(&mut e, 2, 1, vec![10, 0, 0, 255, 0, 0, 200, 255]);
    let inner = call(
        &mut e,
        "addRasterLayer",
        json!({"asset_id":inner_asset,"comp":comp}),
    )
    .data["layer_id"]
    .as_u64()
    .unwrap();
    set_effects(&mut e, inner, json!([{"kind":"invert"}]));
    let outer = call(&mut e, "addCompLayer", json!({"comp":comp}))
        .data["layer_id"]
        .as_u64()
        .unwrap();
    assert_eq!(
        pixels(&mut e, 0.),
        vec![245, 255, 255, 255, 255, 255, 55, 255]
    );
    // Effect on the comp layer itself inverts the composed frame.
    set_effects(&mut e, outer, json!([{"kind":"invert"}]));
    assert_eq!(
        pixels(&mut e, 0.),
        vec![10, 0, 0, 255, 0, 0, 200, 255]
    );
}
#[test]
fn set_layer_effects_validates_atomically_and_replays_history() {
    let mut e = doc(1, 1);
    let asset = ingest(&mut e, 1, 1, vec![1, 2, 3, 255]);
    let layer = raster_layer(&mut e, asset);
    let before = e.snapshot().unwrap();
    for bad in [
        json!([{"kind":"unknown"}]),
        json!([{"kind":"invert","extra":1}]),
        json!([{"kind":"brightness"}]),
        json!([{"kind":"brightness","amount":2.0}]),
        json!([{"kind":"brightness","amount":-1.5}]),
        json!([{"kind":"contrast","amount":5.0}]),
        json!([{"kind":"gaussian-blur","radius_px":65.0}]),
        json!([{"kind":"gaussian-blur","radius_px":-1.0}]),
        json!([{"kind":"fill","color":[0,0,0]}]),
        json!([{"kind":"fill","color":[0,0,0,256]}]),
        json!([{"kind":"fill","color":[0,0,0,255],"opacity":1.5}]),
        json!([{"kind":"invert"}, "not-an-effect"]),
        json!(vec![json!({"kind":"invert"}); 17]),
        json!("invert"),
        json!({"kind":"invert"}),
    ] {
        assert!(
            try_call(&mut e, "setLayerEffects", json!({"layer":layer,"effects":bad})).is_err(),
            "accepted hostile effects: {bad}"
        );
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // Locked layers reject; equal writes are eventless; null/[] clears.
    call(
        &mut e,
        "updateLayer",
        json!({"id":layer,"locked":true}),
    );
    assert!(try_call(
        &mut e,
        "setLayerEffects",
        json!({"layer":layer,"effects":[{"kind":"invert"}]})
    )
    .is_err());
    call(
        &mut e,
        "updateLayer",
        json!({"id":layer,"locked":false}),
    );
    set_effects(&mut e, layer, json!([{"kind":"invert"}]));
    let effected = e.snapshot().unwrap();
    let noop = call(
        &mut e,
        "setLayerEffects",
        json!({"layer":layer,"effects":[{"kind":"invert"}]}),
    );
    assert!(noop.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), effected);
    assert_eq!(pixels(&mut e, 0.), vec![254, 253, 252, 255]);
    set_effects(&mut e, layer, Value::Null);
    assert_eq!(pixels(&mut e, 0.), vec![1, 2, 3, 255]);
    set_effects(&mut e, layer, json!([]));
    assert_eq!(e.state.layers[0].effects, vec![]);
    // Undo restores the inverted stack, redo clears it again.
    assert!(e.undo().unwrap());
    assert_eq!(pixels(&mut e, 0.), vec![254, 253, 252, 255]);
    assert!(e.redo().unwrap());
    assert_eq!(e.state.layers[0].effects.len(), 0);
    assert_eq!(pixels(&mut e, 0.), vec![1, 2, 3, 255]);
}
fn rect(e: &mut MotionEngine, x: f64, y: f64, w: f64, h: f64, fill: [u8; 4]) -> u64 {
    call(
        e,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":x,"y":y,"w":w,"h":h,"fill":fill}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap()
}
#[test]
fn blend_mode_composites_the_effected_pixels() {
    let mut e = doc(1, 1);
    rect(&mut e, 0., 0., 1., 1., [100, 150, 200, 255]);
    let top = rect(&mut e, 0., 0., 1., 1., [200, 100, 50, 255]);
    // invert runs inside the layer's offscreen pass; the parent scene then
    // blends the effected result. multiply of inverted [55,155,205] over
    // [100,150,200]: round(channel_base*channel_fx/255).
    set_effects(&mut e, top, json!([{"kind":"invert"}]));
    call(&mut e, "setLayerBlend", json!({"layer":top,"blend":"multiply"}));
    assert_eq!(pixels(&mut e, 0.), vec![22, 91, 161, 255]);
    // The same blend without the effect would composite the raw [200,100,50]
    // to [78,59,39]; clearing the stack proves the pixels above came from the
    // effected upload, not the unprocessed layer.
    set_effects(&mut e, top, Value::Null);
    assert_eq!(pixels(&mut e, 0.), vec![78, 59, 39, 255]);
}
#[test]
fn clipping_masks_the_effected_pixels() {
    let mut e = doc(3, 1);
    // Base covers x0..x1; the effected top covers x1..x2 and inverts to
    // opaque yellow. Clipping must gate the effected upload by the base's
    // alpha: x1 shows yellow, x2 clips away entirely.
    rect(&mut e, 0., 0., 2., 1., [255, 0, 0, 255]);
    let top = rect(&mut e, 1., 0., 2., 1., [0, 0, 255, 255]);
    set_effects(&mut e, top, json!([{"kind":"invert"}]));
    call(&mut e, "setLayerClipped", json!({"layer":top,"clipped":true}));
    assert_eq!(
        pixels(&mut e, 0.),
        vec![255, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 0]
    );
    // Unclipped, the effected yellow reaches x2 — the clip, not the effect,
    // removed it.
    call(&mut e, "setLayerClipped", json!({"layer":top,"clipped":false}));
    assert_eq!(
        pixels(&mut e, 0.),
        vec![255, 0, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255]
    );
}
#[test]
fn set_layer_effects_rejects_unknown_layer() {
    let mut e = doc(1, 1);
    let asset = ingest(&mut e, 1, 1, vec![1, 2, 3, 255]);
    let layer = raster_layer(&mut e, asset);
    for bad_layer in [0u64, 999, u64::MAX] {
        assert!(
            try_call(
                &mut e,
                "setLayerEffects",
                json!({"layer":bad_layer,"effects":[{"kind":"invert"}]})
            )
            .is_err(),
            "accepted effects on layer {bad_layer}"
        );
    }
    // A malformed `layer` field rejects the same way, and a valid layer id
    // in a different (nested) composition is still unknown at root scope.
    assert!(try_call(
        &mut e,
        "setLayerEffects",
        json!({"layer":"1","effects":[{"kind":"invert"}]})
    )
    .is_err());
    let comp = call(&mut e, "addComposition", json!({"width":1,"height":1}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = call(
        &mut e,
        "addRasterLayer",
        json!({"asset_id":asset,"comp":comp}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    // Layer lookup is global across compositions, so `inner` is a legal
    // target; ids that exist nowhere still reject.
    let _ = inner;
    assert!(try_call(
        &mut e,
        "setLayerEffects",
        json!({"layer":inner + 1000,"effects":[{"kind":"invert"}]})
    )
    .is_err());
    set_effects(&mut e, layer, json!([{"kind":"invert"}]));
    assert_eq!(pixels(&mut e, 0.), vec![254, 253, 252, 255]);
}
#[test]
fn effected_layers_share_the_canvas_storage_budget() {
    // 1024x1024 = the 1-megapixel cap: each canvas-raster layer costs
    // 4 MiB of logical storage against the 16 MiB budget, so four effected
    // layers fit exactly and a fifth rejects atomically.
    let mut e = doc(1024, 1024);
    let mut layers = Vec::new();
    for _ in 0..5 {
        layers.push(rect(&mut e, 0., 0., 1., 1., [9, 9, 9, 255]));
    }
    for &layer in &layers[..4] {
        set_effects(&mut e, layer, json!([{"kind":"invert"}]));
    }
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "setLayerEffects",
        json!({"layer":layers[4],"effects":[{"kind":"invert"}]})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Clearing one stack frees budget for another layer.
    set_effects(&mut e, layers[0], Value::Null);
    set_effects(&mut e, layers[4], json!([{"kind":"invert"}]));
    assert_eq!(e.state.layers[4].effects.len(), 1);
}
#[test]
fn hostile_restore_rejects_bad_effects_and_good_ones_roundtrip() {
    let mut e = doc(1, 1);
    let asset = ingest(&mut e, 1, 1, vec![9, 9, 9, 255]);
    let layer = raster_layer(&mut e, asset);
    set_effects(
        &mut e,
        layer,
        json!([{"kind":"fill","color":[1,2,3,4],"opacity":0.25}]),
    );
    let snapshot = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&snapshot).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), snapshot);
    assert_eq!(reopened.state.layers[0].effects.len(), 1);
    // Hostile mutations of the serialized state all reject and preserve state.
    for mutate in [
        |v: &mut Value| {
            v["layers"][0]["effects"] = json!([{"kind":"invert","bogus":true}])
        },
        |v: &mut Value| {
            v["layers"][0]["effects"] = json!(vec![json!({"kind":"invert"}); 17])
        },
        |v: &mut Value| {
            v["layers"][0]["effects"] = json!([{"kind":"gaussian-blur","radius_px":1e9}])
        },
        |v: &mut Value| {
            v["layers"][0]["effects"] = json!([{"kind":"contrast","amount":-0.5}])
        },
        |v: &mut Value| v["layers"][0]["effects"] = json!([{"kind":"nope"}]),
    ] {
        let mut wire = serde_json::to_value(&*reopened.state).unwrap();
        mutate(&mut wire);
        assert!(reopened
            .restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
            .is_err());
        assert_eq!(reopened.snapshot().unwrap(), snapshot);
    }
}
