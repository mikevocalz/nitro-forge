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
fn rect_comp(e: &mut MotionEngine, comp: u64) -> u64 {
    call(
        e,
        "addShapeLayer",
        json!({"comp":comp,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,255,0,255]}}),
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
fn raster_layer(e: &mut MotionEngine, asset: u64, comp: Option<u64>) -> u64 {
    let mut p = json!({"asset_id":asset});
    if let Some(c) = comp {
        p["comp"] = json!(c);
    }
    call(e, "addRasterLayer", p).data["layer_id"]
        .as_u64()
        .unwrap()
}
fn matte(layer: u64, source: u64, mode: &str) -> Value {
    json!({"layer":layer,"matte":{"source_layer":source,"mode":mode}})
}
fn comp(e: &mut MotionEngine, w: u32, h: u32) -> u64 {
    call(e, "addComposition", json!({"width":w,"height":h})).data["comp_id"]
        .as_u64()
        .unwrap()
}
/// 5x1 straight-alpha raster: white, white, black, transparent, white@128.
fn mask_asset(e: &mut MotionEngine) -> u64 {
    ingest(
        e,
        5,
        1,
        vec![
            255, 255, 255, 255, //
            255, 255, 255, 255, //
            0, 0, 0, 255, //
            9, 9, 9, 0, //
            255, 255, 255, 128,
        ],
    )
}
/// Source raster below a full-canvas blue target; returns (source, target).
fn masked_pair(e: &mut MotionEngine) -> (u64, u64) {
    let asset = mask_asset(e);
    let source = raster_layer(e, asset, None);
    let target = rect(e, 0., 0., 5., 1., [0, 0, 255, 255]);
    (source, target)
}
fn px(out: &[u8], i: usize) -> [u8; 4] {
    out[i * 4..i * 4 + 4].try_into().unwrap()
}

#[test]
fn every_matte_mode_pixel_verifies_alpha_and_luma() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":5,"height":1,"duration_s":1}));
    let (source, target) = masked_pair(&mut e);
    // alpha: mask = flattened alpha [255,255,255,0,128].
    call(&mut e, "setLayerMatte", matte(target, source, "alpha"));
    let out = pixels(&mut e, 0.);
    assert_eq!(px(&out, 0), [0, 0, 255, 255]);
    assert_eq!(px(&out, 1), [0, 0, 255, 255]);
    assert_eq!(px(&out, 2), [0, 0, 255, 255]);
    assert_eq!(px(&out, 3), [0, 0, 0, 0]);
    // Semi-transparent mask pixel composites to alpha 192 over the source.
    assert_eq!(px(&out, 4)[3], 192);
    // alpha-inverted: mask [0,0,0,255,127] -> source shows through x0..x2.
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha-inverted"}}),
    );
    let out = pixels(&mut e, 0.);
    assert_eq!(px(&out, 0), [255, 255, 255, 255]);
    assert_eq!(px(&out, 1), [255, 255, 255, 255]);
    assert_eq!(px(&out, 2), [0, 0, 0, 255]);
    assert_eq!(px(&out, 3), [0, 0, 255, 255]);
    // luma: premultiplied Rec.601 -> white 255, black 0, transparent 0.
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":{"source_layer":source,"mode":"luma"}}),
    );
    let out = pixels(&mut e, 0.);
    assert_eq!(px(&out, 0), [0, 0, 255, 255]);
    assert_eq!(px(&out, 1), [0, 0, 255, 255]);
    assert_eq!(px(&out, 2), [0, 0, 0, 255]);
    assert_eq!(px(&out, 3), [0, 0, 0, 0]);
    // luma-inverted complements: x0/x1 hide the target, x2..x4 reveal it.
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":{"source_layer":source,"mode":"luma-inverted"}}),
    );
    let out = pixels(&mut e, 0.);
    assert_eq!(px(&out, 0), [255, 255, 255, 255]);
    assert_eq!(px(&out, 1), [255, 255, 255, 255]);
    assert_eq!(px(&out, 2), [0, 0, 255, 255]);
    assert_eq!(px(&out, 3), [0, 0, 255, 255]);
    // Clearing the matte restores the unmasked target.
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":null}),
    );
    let out = pixels(&mut e, 0.);
    assert!(out.chunks_exact(4).all(|p| p[2] == 255 && p[3] == 255));
}

#[test]
fn matte_validates_atomically_and_rejects_bad_references() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":5,"height":1,"duration_s":1}));
    let (source, target) = masked_pair(&mut e);
    let c = comp(&mut e, 5, 1);
    let before = e.snapshot().unwrap();
    for p in [
        // Unknown source, self source, malformed matte payloads.
        json!({"layer":target,"matte":{"source_layer":99,"mode":"alpha"}}),
        json!({"layer":target,"matte":{"source_layer":target,"mode":"alpha"}}),
        json!({"layer":target,"matte":{"source_layer":source,"mode":"neon"}}),
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha","feather":65}}),
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha","feather":-1}}),
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha","feather":"2"}}),
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha","bogus":1}}),
        json!({"layer":target,"matte":"alpha"}),
        json!({"layer":target,"matte":{}}),
        json!({"layer":99,"matte":{"source_layer":source,"mode":"alpha"}}),
    ] {
        assert!(try_call(&mut e, "setLayerMatte", p.clone()).is_err(), "{p}");
        assert_eq!(e.snapshot().unwrap(), before, "{p}");
    }
    // A source inside a nested composition is not "same composition".
    let inner_source = rect_comp(&mut e, c);
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":{"source_layer":inner_source,"mode":"alpha"}})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Locked target rejects before any matte validation.
    call(&mut e, "updateLayer", json!({"id":target,"locked":true}));
    let locked = e.snapshot().unwrap();
    assert!(try_call(&mut e, "setLayerMatte", matte(target, source, "alpha")).is_err());
    assert_eq!(e.snapshot().unwrap(), locked);
    // Feather at the bound and enabled=false are accepted.
    call(&mut e, "updateLayer", json!({"id":target,"locked":false}));
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha","feather":64,"enabled":false}}),
    );
    // Disabled matte stores but does not mask: full blue target renders.
    let out = pixels(&mut e, 0.);
    assert!(out.chunks_exact(4).all(|p| p[2] == 255 && p[3] == 255));
}

#[test]
fn matte_cycles_transitive_depth_and_duplicates_are_rejected() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":1,"duration_s":1}));
    let a = rect(&mut e, 0., 0., 1., 1., [255, 0, 0, 255]);
    let b = rect(&mut e, 1., 0., 1., 1., [0, 255, 0, 255]);
    let c = rect(&mut e, 0., 0., 2., 1., [0, 0, 255, 255]);
    call(&mut e, "setLayerMatte", matte(a, b, "alpha"));
    // Direct two-node and self cycles reject; valid chains build.
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "setLayerMatte", matte(b, a, "alpha")).is_err());
    assert!(try_call(&mut e, "setLayerMatte", matte(c, c, "alpha")).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    call(&mut e, "setLayerMatte", matte(b, c, "alpha"));
    // Transitive: c cannot matte a (a -> b -> c would close a cycle).
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "setLayerMatte", matte(c, a, "alpha")).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Disabled mattes still count toward cycle rejection: d -> c is stored
    // but disabled, and c -> d would close c -> d -> c.
    let d = rect(&mut e, 0., 0., 1., 1., [255, 255, 0, 255]);
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":d,"matte":{"source_layer":c,"mode":"alpha","enabled":false}}),
    );
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "setLayerMatte", matte(c, d, "alpha")).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Matte chain depth is bounded at 8 edges: 9 linked layers fit, a
    // tenth edge rejects atomically.
    let mut e2 = MotionEngine::new();
    call(&mut e2, "new", json!({"width":1,"height":1,"duration_s":1}));
    let chain: Vec<u64> = (0..9)
        .map(|_| rect(&mut e2, 0., 0., 1., 1., [255, 0, 0, 255]))
        .collect();
    for i in 1..chain.len() {
        call(
            &mut e2,
            "setLayerMatte",
            matte(chain[i], chain[i - 1], "alpha"),
        );
    }
    let extra = rect(&mut e2, 0., 0., 1., 1., [0, 255, 0, 255]);
    let before = e2.snapshot().unwrap();
    assert!(try_call(&mut e2, "setLayerMatte", matte(extra, chain[8], "alpha")).is_err());
    assert_eq!(e2.snapshot().unwrap(), before);
    // duplicateComposition remaps matte sources to the copy's fresh ids and
    // the copy still renders its matte when instanced.
    let mut e3 = MotionEngine::new();
    call(&mut e3, "new", json!({"width":2,"height":1,"duration_s":1}));
    let c1 = comp(&mut e3, 2, 1);
    let asset = ingest(&mut e3, 2, 1, vec![255, 255, 255, 255, 0, 0, 0, 0]);
    let s = raster_layer(&mut e3, asset, Some(c1));
    let t = call(
        &mut e3,
        "addShapeLayer",
        json!({"comp":c1,"shape":{"kind":"rect","x":0,"y":0,"w":2,"h":1,"fill":[0,0,255,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    call(&mut e3, "setLayerMatte", matte(t, s, "alpha"));
    let dup = call(&mut e3, "duplicateComposition", json!({"id":c1})).data["comp_id"]
        .as_u64()
        .unwrap();
    let d = call(&mut e3, "describe", json!({}));
    let dup_layers = d.data["compositions"][dup.to_string()]["layers"]
        .as_array()
        .unwrap();
    let dup_target = dup_layers.iter().find(|l| l["kind"] == "shape").unwrap();
    let dup_source = dup_layers.iter().find(|l| l["kind"] == "raster").unwrap();
    assert_ne!(dup_target["id"], json!(t));
    assert_eq!(dup_target["matte"]["source_layer"], dup_source["id"]);
    call(&mut e3, "addCompLayer", json!({"comp":dup}));
    assert_eq!(pixels(&mut e3, 0.), vec![0, 0, 255, 255, 0, 0, 0, 0]);
}

#[test]
fn matte_strand_prevention_across_layer_ops() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":5,"height":1,"duration_s":1}));
    let (source, target) = masked_pair(&mut e);
    call(&mut e, "setLayerMatte", matte(target, source, "alpha"));
    // Removing the matte source strands the target's matte: rejected.
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "removeLayer", json!({"id":source})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Removing the matte target itself is fine; rebuild the pair after.
    call(&mut e, "removeLayer", json!({"id":target}));
    let target = rect(&mut e, 0., 0., 5., 1., [0, 0, 255, 255]);
    call(&mut e, "setLayerMatte", matte(target, source, "alpha"));
    // Reparenting either side across compositions strands the reference.
    let c = comp(&mut e, 5, 1);
    for layer in [source, target] {
        let before = e.snapshot().unwrap();
        assert!(try_call(
            &mut e,
            "reparentLayer",
            json!({"layer":layer,"comp":c,"index":0})
        )
        .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // Reordering within the composition keeps the matte valid: membership,
    // not stack position, is what validate enforces.
    call(&mut e, "setLayerOrder", json!({"order":[target, source]}));
    let d = call(&mut e, "describe", json!({}));
    let tl = d.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"].as_u64() == Some(target))
        .unwrap();
    assert_eq!(tl["matte"]["source_layer"], json!(source));
    // An unreferenced composition holding matte'd layers removes cleanly.
    let c2 = comp(&mut e, 5, 1);
    let cs = rect_comp(&mut e, c2);
    let ct = rect_comp(&mut e, c2);
    call(&mut e, "setLayerMatte", matte(ct, cs, "luma"));
    call(&mut e, "removeComposition", json!({"id":c2}));
    // A matte'd comp layer still protects its composition from removal.
    let c3 = comp(&mut e, 5, 1);
    rect_comp(&mut e, c3);
    let inst = call(&mut e, "addCompLayer", json!({"comp":c3})).data["layer_id"]
        .as_u64()
        .unwrap();
    let before = e.snapshot().unwrap();
    assert!(try_call(&mut e, "removeComposition", json!({"id":c3})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    call(&mut e, "removeLayer", json!({"id":inst}));
    call(&mut e, "removeComposition", json!({"id":c3}));
}

#[test]
fn matte_renders_inside_nested_compositions_and_on_comp_sources() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":2,"height":1,"duration_s":1}));
    // Matte fully inside a nested composition.
    let inner = comp(&mut e, 2, 1);
    let iasset = ingest(&mut e, 2, 1, vec![255, 255, 255, 255, 0, 0, 0, 255]);
    let is = raster_layer(&mut e, iasset, Some(inner));
    let it = call(
        &mut e,
        "addShapeLayer",
        json!({"comp":inner,"shape":{"kind":"rect","x":0,"y":0,"w":2,"h":1,"fill":[0,0,255,255]}}),
    )
    .data["layer_id"]
        .as_u64()
        .unwrap();
    // Luma matte inside the comp: opaque black has zero luminance, so the
    // target shows only over the white half and the black source remains.
    call(&mut e, "setLayerMatte", matte(it, is, "luma"));
    call(&mut e, "addCompLayer", json!({"comp":inner}));
    assert_eq!(pixels(&mut e, 0.), vec![0, 0, 255, 255, 0, 0, 0, 255]);
    // A comp layer instance can itself be a matte source: its rendered
    // subtree supplies the mask for a root target.
    let mut e2 = MotionEngine::new();
    call(&mut e2, "new", json!({"width":2,"height":1,"duration_s":1}));
    let mask_comp = comp(&mut e2, 2, 1);
    call(
        &mut e2,
        "addShapeLayer",
        json!({"comp":mask_comp,"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,255,255,255]}}),
    );
    let inst = call(&mut e2, "addCompLayer", json!({"comp":mask_comp})).data["layer_id"]
        .as_u64()
        .unwrap();
    let target = rect(&mut e2, 0., 0., 2., 1., [0, 0, 255, 255]);
    call(&mut e2, "setLayerMatte", matte(target, inst, "alpha"));
    // x0 masked by the comp's white half, x1 empty -> transparent.
    assert_eq!(pixels(&mut e2, 0.), vec![0, 0, 255, 255, 0, 0, 0, 0]);
    // Ordering: the mask applies to the target's own alpha before its blend
    // mode composites — multiply over red shows black only where revealed.
    let mut e3 = MotionEngine::new();
    call(&mut e3, "new", json!({"width":2,"height":1,"duration_s":1}));
    let red = rect(&mut e3, 0., 0., 2., 1., [255, 0, 0, 255]);
    let a3 = ingest(&mut e3, 2, 1, vec![255, 255, 255, 255, 0, 0, 0, 0]);
    let s3 = raster_layer(&mut e3, a3, None);
    let t3 = rect(&mut e3, 0., 0., 2., 1., [0, 0, 255, 255]);
    // Move the matte source below the red base so multiply sees red beneath.
    call(&mut e3, "setLayerOrder", json!({"order":[s3, red, t3]}));
    call(
        &mut e3,
        "setLayerBlend",
        json!({"layer":t3,"blend":"multiply"}),
    );
    call(&mut e3, "setLayerMatte", matte(t3, s3, "alpha"));
    // x0: multiply(blue, red) = black; x1: matte hides target -> red remains.
    assert_eq!(pixels(&mut e3, 0.), vec![0, 0, 0, 255, 255, 0, 0, 255]);
}

#[test]
fn matte_feather_softens_edges_within_bound() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":5,"height":1,"duration_s":1}));
    let asset = ingest(
        &mut e,
        5,
        1,
        vec![
            255, 255, 255, 255, //
            0, 0, 0, 0, //
            0, 0, 0, 0, //
            0, 0, 0, 0, //
            0, 0, 0, 0,
        ],
    );
    let source = raster_layer(&mut e, asset, None);
    let target = rect(&mut e, 0., 0., 5., 1., [0, 0, 255, 255]);
    // Transparent destination: output alpha equals the derived mask value.
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha","feather":4}}),
    );
    let out = pixels(&mut e, 0.);
    // x0's destination is the opaque white source pixel, so output alpha
    // stays 255; the softened mask shows as red/green bleed-through instead.
    assert!(
        px(&out, 0)[0] > 0 && px(&out, 0)[0] < 255,
        "{:?}",
        px(&out, 0)
    );
    // x1's destination is transparent, so output alpha equals the mask.
    let mid = px(&out, 1)[3];
    assert!(mid > 0 && mid < 255, "{mid}");
    assert_eq!(px(&out, 4)[3], 0);
    // feather 0 restores the hard edge: pure blue at x0, nothing elsewhere.
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":target,"matte":{"source_layer":source,"mode":"alpha","feather":0}}),
    );
    let out = pixels(&mut e, 0.);
    assert_eq!(px(&out, 0), [0, 0, 255, 255]);
    assert!(out[4..].chunks_exact(4).all(|p| p[3] == 0));
}

#[test]
fn matte_snapshot_undo_redo_equal_patch_and_hostile_restore() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":5,"height":1,"duration_s":1}));
    let (source, target) = masked_pair(&mut e);
    call(&mut e, "setLayerMatte", matte(target, source, "alpha"));
    let matted = e.snapshot().unwrap();
    // describe/evaluate expose the matte; schema stays 2 and unset fields on
    // other layers stay absent.
    let d = call(&mut e, "describe", json!({}));
    assert_eq!(d.data["schema"], json!(2));
    let tl = d.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"].as_u64() == Some(target))
        .unwrap()
        .clone();
    assert_eq!(tl["matte"]["source_layer"], json!(source));
    assert_eq!(tl["matte"]["mode"], json!("alpha"));
    assert_eq!(tl["matte"]["feather"], json!(0.0));
    assert_eq!(tl["matte"]["enabled"], json!(true));
    assert!(d.data["layers"][0].get("matte").is_none());
    let ev = call(&mut e, "evaluate", json!({"time_s":0}));
    let evl = ev.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"].as_u64() == Some(target))
        .unwrap();
    assert_eq!(evl["matte"]["source_layer"], json!(source));
    // An identical write is a silent no-op.
    let noop = call(&mut e, "setLayerMatte", matte(target, source, "alpha"));
    assert!(noop.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), matted);
    // Snapshot round-trips through restore with identical pixels.
    let mut reopened = MotionEngine::new();
    reopened.restore(&matted).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), matted);
    assert_eq!(pixels(&mut reopened, 0.), pixels(&mut e, 0.));
    // Undo removes the matte (full blue), redo restores it.
    assert!(e.undo().unwrap());
    let unmatte_out = pixels(&mut e, 0.);
    assert!(unmatte_out
        .chunks_exact(4)
        .all(|p| p[2] == 255 && p[3] == 255));
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), matted);
    // Hostile restores: each malformed matte rejects without touching state.
    let state = serde_json::to_value(&*e.state).unwrap();
    let tl_index = state["layers"]
        .as_array()
        .unwrap()
        .iter()
        .position(|l| l["id"].as_u64() == Some(target))
        .unwrap();
    let sl_index = state["layers"]
        .as_array()
        .unwrap()
        .iter()
        .position(|l| l["id"].as_u64() == Some(source))
        .unwrap();
    let mut cases: Vec<Value> = Vec::new();
    // Unknown source id.
    let mut bad = state.clone();
    bad["layers"][tl_index]["matte"]["source_layer"] = json!(999);
    cases.push(bad);
    // Self matte.
    let mut bad = state.clone();
    bad["layers"][tl_index]["matte"]["source_layer"] = json!(target);
    cases.push(bad);
    // Two-node cycle: source mattes the target back.
    let mut bad = state.clone();
    bad["layers"][sl_index]["matte"] =
        json!({"source_layer":target,"mode":"alpha","feather":0,"enabled":true});
    cases.push(bad);
    // Feather out of bounds, bad mode, wrong types, unknown field.
    for (key, value) in [
        ("feather", json!(65.0)),
        ("feather", json!(-1.0)),
        ("feather", json!("2")),
        ("mode", json!("neon")),
        ("enabled", json!("yes")),
    ] {
        let mut bad = state.clone();
        bad["layers"][tl_index]["matte"][key] = value;
        cases.push(bad);
    }
    let mut bad = state.clone();
    bad["layers"][tl_index]["matte"]["bogus"] = json!(1);
    cases.push(bad);
    // Cross-composition source: layer id 50 exists only inside a nested
    // composition of this document, never in the root layer set.
    let mut bad = state.clone();
    bad["compositions"] = json!({"1":{
        "id":1,"name":"c","width":5,"height":1,"duration_s":1,
        "frame_rate":{"num":30,"den":1},
        "layers":[{
            "id":50,"name":"l","visible":true,"locked":false,"kind":"shape",
            "shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,255,0,255]},
            "transform":{"tx":0,"ty":0,"sx":1,"sy":1,"rotation":0,"ox":0,"oy":0},
            "opacity":1,"curves":[]}]}});
    bad["next_comp_id"] = json!(2);
    bad["next_layer_id"] = json!(51);
    bad["layers"][tl_index]["matte"]["source_layer"] = json!(50);
    cases.push(bad);
    for bad in cases {
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&bad).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), matted);
    }
    // schema:1 payloads without the additive matte field still restore.
    let mut s1 = state;
    s1["schema"] = json!(1);
    for layer in s1["layers"].as_array_mut().unwrap() {
        let o = layer.as_object_mut().unwrap();
        o.remove("kind");
        o.remove("matte");
        o.remove("blend");
        o.remove("clipped");
        o.remove("parent_id");
        o.remove("comp_id");
    }
    s1.as_object_mut().unwrap().remove("compositions");
    s1.as_object_mut().unwrap().remove("next_comp_id");
    let mut old = MotionEngine::new();
    old.restore(&encode_envelope(&serde_json::to_vec(&s1).unwrap()))
        .unwrap();
    assert!(old.state.layers.iter().all(|l| l.matte.is_none()));
}

#[test]
fn nested_matte_source_applies_its_own_matte() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":3,"height":1,"duration_s":1}));
    // Innermost mask source: opaque only over x0..x1.
    let inner = rect(&mut e, 0., 0., 2., 1., [255, 255, 255, 255]);
    // Middle layer: full-canvas green, itself matted by `inner`, so its own
    // rendered alpha covers only x0..x1.
    let middle = rect(&mut e, 0., 0., 3., 1., [0, 255, 0, 255]);
    call(&mut e, "setLayerMatte", matte(middle, inner, "alpha"));
    // Target: full-canvas blue matted by the *matted* middle layer. If the
    // nested matte were dropped while rendering the mask source, the middle
    // layer's full-canvas alpha would reveal the target at x2 as well.
    let target = rect(&mut e, 0., 0., 3., 1., [0, 0, 255, 255]);
    call(&mut e, "setLayerMatte", matte(target, middle, "alpha"));
    let out = pixels(&mut e, 0.);
    assert_eq!(px(&out, 0), [0, 0, 255, 255]);
    assert_eq!(px(&out, 1), [0, 0, 255, 255]);
    assert_eq!(px(&out, 2), [0, 0, 0, 0]);
}

#[test]
fn invisible_matted_target_skips_mask_render() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":1,"height":1,"duration_s":1}));
    let source = rect(&mut e, 0., 0., 1., 1., [255, 255, 255, 255]);
    let target = rect(&mut e, 0., 0., 1., 1., [0, 0, 255, 255]);
    call(&mut e, "setLayerMatte", matte(target, source, "alpha"));
    assert_eq!(px(&pixels(&mut e, 0.), 0), [0, 0, 255, 255]);
    // Hiding the target skips the matte mask render entirely; the source
    // still composites on its own and the frame is unchanged otherwise.
    call(&mut e, "updateLayer", json!({"id":target,"visible":false}));
    assert_eq!(px(&pixels(&mut e, 0.), 0), [255, 255, 255, 255]);
}
