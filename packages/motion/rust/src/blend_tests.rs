use super::*;
fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
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
/// W3C Compositing Level 1 channel formula, mirroring Prism's reference so a
/// wrong mode name or dropped plumbing fails the pixel check.
fn blend_channel(mode: &str, cb: f64, cs: f64) -> f64 {
    match mode {
        "normal" => cs,
        "multiply" => cb * cs,
        "screen" => cb + cs - cb * cs,
        "overlay" => blend_channel("hard-light", cs, cb),
        "darken" => cb.min(cs),
        "lighten" => cb.max(cs),
        "color-dodge" => {
            if cb == 0. {
                0.
            } else if cs >= 1. {
                1.
            } else {
                (cb / (1. - cs)).min(1.)
            }
        }
        "color-burn" => {
            if cb >= 1. {
                1.
            } else if cs <= 0. {
                0.
            } else {
                1. - ((1. - cb) / cs).min(1.)
            }
        }
        "hard-light" => {
            if cs <= 0.5 {
                cb * 2. * cs
            } else {
                let s = 2. * cs - 1.;
                cb + s - cb * s
            }
        }
        "soft-light" => {
            if cs <= 0.5 {
                cb - (1. - 2. * cs) * cb * (1. - cb)
            } else {
                let d = if cb <= 0.25 {
                    ((16. * cb - 12.) * cb + 4.) * cb
                } else {
                    cb.sqrt()
                };
                cb + (2. * cs - 1.) * (d - cb)
            }
        }
        "difference" => (cb - cs).abs(),
        "exclusion" => cb + cs - 2. * cb * cs,
        "add" => (cb + cs).min(1.),
        _ => unreachable!("unknown mode {mode}"),
    }
}
const MODES: [&str; 13] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "add",
];
#[test]
fn every_w3c_blend_mode_composites_expected_pixels() {
    let cb = [100.0f64, 150.0, 200.0];
    let cs = [200.0f64, 100.0, 50.0];
    for mode in MODES {
        let mut e = MotionEngine::new();
        call(&mut e, "new", json!({"width":1,"height":1,"duration_s":1}));
        rect(&mut e, 0., 0., 1., 1., [100, 150, 200, 255]);
        let top = rect(&mut e, 0., 0., 1., 1., [200, 100, 50, 255]);
        call(&mut e, "setLayerBlend", json!({"layer":top,"blend":mode}));
        let mut px = vec![0u8; 4];
        for c in 0..3 {
            px[c] = (blend_channel(mode, cb[c] / 255., cs[c] / 255.) * 255.).round() as u8;
        }
        px[3] = 255;
        assert_eq!(pixels(&mut e, 0.), px, "blend mode {mode}");
        // Clearing with null restores normal compositing.
        call(&mut e, "setLayerBlend", json!({"layer":top,"blend":null}));
        assert_eq!(pixels(&mut e, 0.), vec![200, 100, 50, 255]);
    }
}
#[test]
fn blend_names_validate_atomically_and_undo_redo_roundtrip() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":1,"height":1,"duration_s":1}));
    rect(&mut e, 0., 0., 1., 1., [1, 2, 3, 255]);
    let top = rect(&mut e, 0., 0., 1., 1., [4, 5, 6, 255]);
    let before = e.snapshot().unwrap();
    for (op, bad) in [
        ("setLayerBlend", json!({"layer":top,"blend":"hue"})),
        ("setLayerBlend", json!({"layer":top,"blend":"MULTIPLY"})),
        ("setLayerBlend", json!({"layer":top,"blend":7})),
        ("setLayerBlend", json!({"layer":99,"blend":"multiply"})),
        ("setLayerClipped", json!({"layer":top,"clipped":"yes"})),
        ("setLayerClipped", json!({"layer":top})),
    ] {
        assert!(try_call(&mut e, op, bad.clone()).is_err(), "{bad}");
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // "normal" and null both store the absent default.
    call(
        &mut e,
        "setLayerBlend",
        json!({"layer":top,"blend":"multiply"}),
    );
    let multiplied = e.snapshot().unwrap();
    call(
        &mut e,
        "setLayerBlend",
        json!({"layer":top,"blend":"normal"}),
    );
    assert_eq!(e.snapshot().unwrap(), before);
    call(
        &mut e,
        "setLayerBlend",
        json!({"layer":top,"blend":"screen"}),
    );
    let screened = e.snapshot().unwrap();
    assert_ne!(screened, multiplied);
    // A repeated identical write is a silent no-op.
    let noop = call(
        &mut e,
        "setLayerBlend",
        json!({"layer":top,"blend":"screen"}),
    );
    assert!(noop.events.is_empty());
    // Undo/redo round-trips the blend field.
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), screened);
    // Locked layers reject both ops.
    call(&mut e, "updateLayer", json!({"id":top,"locked":true}));
    let locked = e.snapshot().unwrap();
    for (op, p) in [
        ("setLayerBlend", json!({"layer":top,"blend":"add"})),
        ("setLayerClipped", json!({"layer":top,"clipped":true})),
    ] {
        assert!(try_call(&mut e, op, p).is_err());
        assert_eq!(e.snapshot().unwrap(), locked);
    }
}
#[test]
fn clipped_masks_to_unclipped_sibling_below() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":3,"height":1,"duration_s":1}));
    let base = rect(&mut e, 0., 0., 2., 1., [255, 0, 0, 255]);
    let top = rect(&mut e, 1., 0., 2., 1., [0, 0, 255, 255]);
    // Bottom layer cannot clip: nothing below it.
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "setLayerClipped",
        json!({"layer":base,"clipped":true})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":top,"clipped":true}),
    );
    // x0: base only -> red. x1: both -> clipped layer wins through base alpha.
    // x2: outside the base -> clipped away entirely.
    assert_eq!(
        pixels(&mut e, 0.),
        vec![255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]
    );
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":top,"clipped":false}),
    );
    assert_eq!(
        pixels(&mut e, 0.),
        vec![255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]
    );
    // A second consecutive clipped layer joins the same clip run.
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":top,"clipped":true}),
    );
    let third = rect(&mut e, 0., 0., 3., 1., [0, 255, 0, 255]);
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":third,"clipped":true}),
    );
    // Both clipped layers composite through the base alpha (x0,x1): the top
    // of the run (green) wins where it covers.
    assert_eq!(
        pixels(&mut e, 0.),
        vec![0, 255, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0]
    );
    // Removing the base would leave a clipped layer at the bottom: rejected.
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "removeLayer", json!({"id":base})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Reordering a clipped layer to the bottom rejects atomically too.
    assert!(try_call(&mut e, "setLayerOrder", json!({"order":[top,base,third]})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Undo/redo round-trips the clipped flag.
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":top,"clipped":false}),
    );
    let unclipped_top = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), unclipped_top);
}
#[test]
fn blend_and_clip_compose_with_comp_layers_and_rasters() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":1,"duration_s":1}));
    // Nested comp: multiply-blended top over a mid gray base.
    let c = call(&mut e, "addComposition", json!({"width":2,"height":1})).data["comp_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "addShapeLayer",
        json!({"comp":c,"shape":{"kind":"rect","x":0,"y":0,"w":2,"h":1,"fill":[200,200,200,255]}}),
    );
    let top_in_comp = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":c,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[100,100,100,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setLayerBlend",
        json!({"layer":top_in_comp,"blend":"multiply"}),
    );
    let inst = call(&mut e, "addCompLayer", json!({"comp":c})).data["layer_id"]
        .as_u64()
        .unwrap();
    // The instance composites the comp's blended pixels at root.
    assert_eq!(
        pixels(&mut e, 0.),
        vec![78, 78, 78, 255, 200, 200, 200, 255]
    );
    // A root sibling below the instance provides the clip alpha.
    let base = rect(&mut e, 0., 0., 1., 1., [255, 0, 0, 255]);
    // New layers land on top; reorder so base sits below the instance.
    call(&mut e, "setLayerOrder", json!({"order":[base,inst]}));
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":inst,"clipped":true}),
    );
    // inst shows only through base's alpha (x0); x1 clips away.
    assert_eq!(pixels(&mut e, 0.), vec![78, 78, 78, 255, 0, 0, 0, 0]);
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":inst,"clipped":false}),
    );
    // A raster layer honors blend against whatever is beneath it.
    let asset = ingest(&mut e, 2, 1, vec![200, 100, 50, 255, 200, 100, 50, 255]);
    let raster = call(&mut e, "addRasterLayer", json!({"asset_id":asset})).data["layer_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setLayerBlend",
        json!({"layer":raster,"blend":"multiply"}),
    );
    let out = pixels(&mut e, 0.);
    // x0 beneath is the instance's [78,78,78]: multiply -> round(200*78/255)=61,
    // round(100*78/255)=31, round(50*78/255)=15.
    assert_eq!(&out[0..4], &[61, 31, 15, 255]);
    // x1 beneath is the instance's [200,200,200]: multiply -> 157/78/39.
    assert_eq!(&out[4..8], &[157, 78, 39, 255]);
}
#[test]
fn blend_clipped_survive_snapshot_and_hostile_restore_rejects() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":1,"duration_s":1}));
    rect(&mut e, 0., 0., 1., 1., [100, 150, 200, 255]);
    let top = rect(&mut e, 0., 0., 2., 1., [200, 100, 50, 255]);
    call(
        &mut e,
        "setLayerBlend",
        json!({"layer":top,"blend":"screen"}),
    );
    call(
        &mut e,
        "setLayerClipped",
        json!({"layer":top,"clipped":true}),
    );
    let snap = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&snap).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), snap);
    assert_eq!(pixels(&mut reopened, 0.), pixels(&mut e, 0.));
    // describe/evaluate expose the new fields; schema stays 2.
    let d = call(&mut e, "describe", json!({}));
    assert_eq!(d.data["schema"], json!(2));
    let layer = d.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"].as_u64() == Some(top))
        .unwrap()
        .clone();
    assert_eq!(layer["blend"], json!("screen"));
    assert_eq!(layer["clipped"], json!(true));
    let ev = call(&mut e, "evaluate", json!({"time_s":0}));
    let ev_layer = ev.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"].as_u64() == Some(top))
        .unwrap();
    assert_eq!(ev_layer["blend"], json!("screen"));
    assert_eq!(ev_layer["clipped"], json!(true));
    // Unset fields stay absent from the wire (additive, schema:2 unchanged).
    let wire = serde_json::to_value(&*e.state).unwrap();
    assert_eq!(wire["schema"], json!(2));
    assert!(wire["layers"][0].get("blend").is_none());
    assert!(wire["layers"][0].get("clipped").is_none());
    // Hostile restores: clipped bottom layer, unknown blend, wrong types.
    let mut bad_clip = serde_json::to_value(&*e.state).unwrap();
    bad_clip["layers"][0]["clipped"] = json!(true);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&bad_clip).unwrap()))
        .is_err());
    let mut bad_blend = serde_json::to_value(&*e.state).unwrap();
    bad_blend["layers"][1]["blend"] = json!("neon");
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&bad_blend).unwrap()))
        .is_err());
    let mut bad_type = serde_json::to_value(&*e.state).unwrap();
    bad_type["layers"][1]["clipped"] = json!("yes");
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&bad_type).unwrap()))
        .is_err());
    // schema:1 payloads without the new fields still restore.
    let mut s1 = serde_json::to_value(&*e.state).unwrap();
    s1["schema"] = json!(1);
    for layer in s1["layers"].as_array_mut().unwrap() {
        let o = layer.as_object_mut().unwrap();
        o.remove("kind");
        o.remove("parent_id");
        o.remove("blend");
        o.remove("clipped");
    }
    let mut old = MotionEngine::new();
    old.restore(&encode_envelope(&serde_json::to_vec(&s1).unwrap()))
        .unwrap();
    assert!(old
        .state
        .layers
        .iter()
        .all(|l| l.blend.is_none() && !l.clipped));
    assert_eq!(e.snapshot().unwrap(), snap);
}
