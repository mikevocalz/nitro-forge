//! G2 3D projection rendering + G3a lighting tests: hand-verified affine
//! resample pixels, composition composition (effects/mattes/nested comps/
//! parents/particles), light rigs, budgets, undo/snapshot/hostile restore
//! and render-queue parity.
use super::*;

fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
}
fn shape_layer(e: &mut MotionEngine, comp: Option<u64>) -> u64 {
    let mut p = json!({"shape":{"kind":"rect","x":0,"y":0,"w":4,"h":4,"fill":[255,0,0,255]}});
    if let Some(c) = comp {
        p["comp"] = json!(c);
    }
    call(e, "addShapeLayer", p).data["layer_id"].as_u64().unwrap()
}
fn frame(e: &mut MotionEngine, t: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}
fn px(buf: &[u8], w: usize, x: usize, y: usize) -> [u8; 4] {
    let i = (y * w + x) * 4;
    [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
}
fn red_count(buf: &[u8]) -> usize {
    buf.chunks_exact(4)
        .filter(|p| p[0] == 255 && p[1] == 0 && p[2] == 0 && p[3] == 255)
        .count()
}

#[test]
fn ry_only_compresses_x_by_cos_ry_with_hand_verified_pixels() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    let id = shape_layer(&mut e, None);
    let baseline = frame(&mut e, 0.);
    assert_eq!(red_count(&baseline), 16);
    // ry = 60°: projected x' = cos(60°)·x = 0.5x about the (0,0) anchor.
    // Destination pixel centers inverse-map to source texels 2x+1, so the
    // 4x4 rect lands on dst x in {0,1} (src x 1 and 3), y unchanged.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":0,"ry":60,"z":0}}),
    );
    let f = frame(&mut e, 0.);
    assert_ne!(f, baseline);
    for y in 0..4 {
        for x in 0..8 {
            let want = if x <= 1 { [255, 0, 0, 255] } else { [0, 0, 0, 0] };
            assert_eq!(px(&f, 8, x, y), want, "pixel ({x},{y})");
        }
    }
    // Rows below the rect stay empty.
    for y in 4..8 {
        assert!(f[y * 8 * 4..(y + 1) * 8 * 4].iter().all(|v| *v == 0));
    }
    // Deterministic: same call reproduces identical bytes.
    assert_eq!(frame(&mut e, 0.), f);
}

#[test]
fn rx_only_compresses_y_and_combined_rx_ry_shears() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    let id = shape_layer(&mut e, None);
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":60,"ry":0,"z":0}}),
    );
    let rx_only = frame(&mut e, 0.);
    // rx = 60° collapses the projected y axis by cos(60°)=0.5: the rect
    // lands on dst y in {0,1} for x in {0..3}.
    for y in 0..8 {
        for x in 0..8 {
            let want = if y <= 1 && x <= 3 {
                [255, 0, 0, 255]
            } else {
                [0, 0, 0, 0]
            };
            assert_eq!(px(&rx_only, 8, x, y), want, "rx pixel ({x},{y})");
        }
    }
    // Combined rx+ry produces shear the 2D transform cannot express: the
    // frame differs from both single-axis projections.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":30,"ry":45,"z":3}}),
    );
    let both = frame(&mut e, 0.);
    assert_ne!(both, rx_only);
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":0,"ry":45,"z":0}}),
    );
    let ry_only = frame(&mut e, 0.);
    assert_ne!(both, ry_only);
    assert!(red_count(&both) > 0 && red_count(&both) < 16);
    // z is inert: identical rx/ry with different z renders identically.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":30,"ry":45,"z":-9999}}),
    );
    assert_eq!(frame(&mut e, 0.), both);
    // Edge-on (rx = 90°) collapses the projected plane to zero area: an
    // all-transparent frame, not garbage or an error.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":90,"ry":0,"z":0}}),
    );
    assert!(frame(&mut e, 0.).iter().all(|v| *v == 0));
}

#[test]
fn identity_3d_and_transform_free_layers_render_byte_identically() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    let id = shape_layer(&mut e, None);
    let baseline = frame(&mut e, 0.);
    // transform3d present but identity projects to the same affine and
    // resamples losslessly.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":0,"ry":0,"z":7}}),
    );
    assert_eq!(frame(&mut e, 0.), baseline);
    // Clearing returns to the plain 2D path — still identical.
    call(&mut e, "setLayer3D", json!({"layer":id,"transform3d":null}));
    assert_eq!(frame(&mut e, 0.), baseline);
}

#[test]
fn composes_with_effects_parents_mattes_and_nested_comps() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    // Parent transform still composes: parent tx=4 shifts the projected
    // child right by 4 canvas px.
    let parent = shape_layer(&mut e, None);
    call(&mut e, "updateLayer", json!({"id":parent,"transform":{"tx":4,"ty":0}}));
    let child = shape_layer(&mut e, None);
    call(
        &mut e,
        "updateLayer",
        json!({"id":child,"transform":{"tx":0,"ty":0}}),
    );
    call(
        &mut e,
        "setLayerParent",
        json!({"layer":child,"parent":parent}),
    );
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":child,"transform3d":{"ry":60}}),
    );
    let parented = frame(&mut e, 0.);
    // Child content: ry=60 compresses x by 0.5 then parent tx=4 shifts.
    // The parent shape itself (4x4 at tx=4) also renders flat below.
    assert!(red_count(&parented) > 0);
    // Effects run AFTER the resample: invert flips the lit/projected red.
    call(
        &mut e,
        "setLayerEffects",
        json!({"layer":child,"effects":[{"kind":"invert"}]}),
    );
    let effected = frame(&mut e, 0.);
    assert_ne!(effected, parented);
    // Matte source may itself be 3D: a second layer matted by the child.
    let matte_target = shape_layer(&mut e, None);
    call(
        &mut e,
        "setLayerMatte",
        json!({"layer":matte_target,"matte":{"source_layer":child,"mode":"alpha"}}),
    );
    assert!(frame(&mut e, 0.).len() == 8 * 8 * 4);
    // Nested comp: a 3D layer inside a comp renders through the child
    // scene and the comp layer composites it.
    let comp = call(&mut e, "addComposition", json!({"width":8,"height":8}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = shape_layer(&mut e, Some(comp));
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":inner,"transform3d":{"ry":60}}),
    );
    let inst = call(&mut e, "addCompLayer", json!({"comp":comp}))
        .data["layer_id"]
        .as_u64()
        .unwrap();
    // The comp instance itself is 3D-enabled too: its whole frame resamples.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":inst,"transform3d":{"rx":20,"ry":0,"z":0}}),
    );
    let nested = frame(&mut e, 0.);
    assert_ne!(nested, effected);
    // Render queue steps produce the identical frame as renderFrame.
    let job = call(
        &mut e,
        "addRenderJob",
        json!({"from_frame":0,"to_frame":0}),
    )
    .data["job_id"]
    .as_u64()
    .unwrap();
    let stepped = e
        .apply(Command::new("renderQueueFrame", json!({"job":job})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert_eq!(stepped, frame(&mut e, 0.));
}

#[test]
fn particles_and_media_layers_accept_3d() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":16,"height":16,"duration_s":2}));
    call(&mut e, "addParticlesLayer", json!({"name":"p"}));
    let pid = e
        .apply(Command::new("describe", json!({})))
        .unwrap()
        .data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["kind"] == json!("particles"))
        .unwrap()["id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setParticleEmitter",
        json!({"layer":pid,"emitter":{
            "rate":30,"lifetime_s":1,"angle_deg":-90,"spread_deg":0,
            "speed":40,"sprite":{"kind":"shape","shape":"rect","width":2,"height":2,"fill":[0,255,0,255]}
        }}),
    );
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":pid,"transform3d":{"ry":30}}),
    );
    // Renders without error and the projection changes the frame vs 2D.
    let f3d = frame(&mut e, 0.5);
    call(&mut e, "setLayer3D", json!({"layer":pid,"transform3d":null}));
    let f2d = frame(&mut e, 0.5);
    assert_ne!(f3d, f2d);
    // A media layer tolerates transform3d and stays transparent.
    let mid = call(&mut e, "addMediaLayer", json!({}))
        .data["layer_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":mid,"transform3d":{"rx":45}}),
    );
    assert!(frame(&mut e, 0.).iter().all(|v| *v == 0));
}

#[test]
fn light_rig_validation_atomicity_undo_and_snapshot() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let ambient = json!([{"type":"ambient","color":[1,1,1],"intensity":0.5}]);
    call(&mut e, "setLights", json!({"lights":ambient}));
    // describe materializes the root rig.
    let d = call(&mut e, "describe", json!({})).data;
    assert_eq!(d["lights"][0]["type"], json!("ambient"));
    let with_lights = e.snapshot().unwrap();
    // >8 lights reject; malformed rigs reject; unknown comp rejects.
    let nine: Vec<Value> = (0..9)
        .map(|_| json!({"type":"ambient","color":[1,1,1],"intensity":0.1}))
        .collect();
    assert!(try_call(&mut e, "setLights", json!({"lights":nine})).is_err());
    assert!(try_call(
        &mut e,
        "setLights",
        json!({"lights":[{"type":"ambient","color":[1,1],"intensity":1}]})
    )
    .is_err());
    assert!(try_call(&mut e, "setLights", json!({"comp":42,"lights":[]})).is_err());
    assert_eq!(e.snapshot().unwrap(), with_lights);
    // Equal rewrite is eventless; null clears.
    let same = try_call(&mut e, "setLights", json!({"lights":[{"type":"ambient","color":[1,1,1],"intensity":0.5}]})).unwrap();
    assert!(same.events.is_empty());
    call(&mut e, "setLights", json!({"lights":null}));
    assert!(call(&mut e, "describe", json!({})).data["lights"]
        .as_array()
        .unwrap()
        .is_empty());
    // Undo restores the rig; snapshot round-trips it.
    assert!(e.undo().unwrap());
    assert_eq!(
        call(&mut e, "describe", json!({})).data["lights"][0]["intensity"],
        json!(0.5)
    );
    let snap = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&snap).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), snap);
    // Hostile restore: invalid light rejects and leaves state untouched.
    let mut wire = serde_json::to_value(&*reopened.state).unwrap();
    wire["lights"] = json!([{"type":"ambient","color":[3,0,0],"intensity":1}]);
    let before = reopened.snapshot().unwrap();
    assert!(reopened
        .restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .is_err());
    assert_eq!(reopened.snapshot().unwrap(), before);
    // Comp-scoped rig: setLights with comp targets the nested composition.
    let comp = call(&mut e, "addComposition", json!({"width":4,"height":4}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setLights",
        json!({"comp":comp,"lights":[{"type":"directional","direction":[0,0,1],"color":[1,1,1],"intensity":1}]}),
    );
    let d = call(&mut e, "describe", json!({})).data;
    assert_eq!(d["compositions"][comp.to_string()]["lights"][0]["type"], json!("directional"));
}

#[test]
fn lights_shade_3d_layers_only_with_lambert_ambient() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":1}));
    let id = shape_layer(&mut e, None);
    let flat = frame(&mut e, 0.);
    // Identity-oriented 3D layer: normal is +Z.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":0,"ry":0,"z":0}}),
    );
    let lit_base = frame(&mut e, 0.);
    assert_eq!(lit_base, flat);
    // Full-white ambient at intensity 1 is the identity factor.
    call(
        &mut e,
        "setLights",
        json!({"lights":[{"type":"ambient","color":[1,1,1],"intensity":1}]}),
    );
    assert_eq!(frame(&mut e, 0.), flat);
    // Half-intensity white ambient halves the lit red channel.
    call(
        &mut e,
        "setLights",
        json!({"lights":[{"type":"ambient","color":[1,1,1],"intensity":0.5}]}),
    );
    let dim = frame(&mut e, 0.);
    assert_eq!(px(&dim, 8, 0, 0), [128, 0, 0, 255]);
    // Directional light toward +Z (the flat normal) at full intensity is
    // also identity; shining from -Z contributes zero — RGB goes black
    // while alpha (coverage) is preserved.
    call(
        &mut e,
        "setLights",
        json!({"lights":[{"type":"directional","direction":[0,0,1],"color":[1,1,1],"intensity":1}]}),
    );
    assert_eq!(frame(&mut e, 0.), flat);
    call(
        &mut e,
        "setLights",
        json!({"lights":[{"type":"directional","direction":[0,0,-1],"color":[1,1,1],"intensity":1}]}),
    );
    let dark = frame(&mut e, 0.);
    assert_eq!(px(&dark, 8, 0, 0), [0, 0, 0, 255]);
    assert_eq!(px(&dark, 8, 7, 7), [0, 0, 0, 0]);
    // A rig over a composition with no 3D layers changes nothing.
    call(&mut e, "setLayer3D", json!({"layer":id,"transform3d":null}));
    let unlit = frame(&mut e, 0.);
    assert_eq!(unlit, flat);
    // Tilted normal: ry=60° gives N=(cos rx·sin ry, -sin rx, cos rx·cos ry)
    // = (sin60, 0, cos60) ≈ (0.866, 0, 0.5) and projects x by cos60 = 0.5,
    // so the rect visibly occupies dst x in {0,1}, y in {0..3}.
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":id,"transform3d":{"rx":0,"ry":60,"z":0}}),
    );
    // Ambient 0.5 + directional [0,0,1] at 0.5·N·L = 0.5·0.5 = 0.25 → factor
    // 0.75 → 255·0.75 = 191. A [-1,0,0] directional has N·L < 0 → factor
    // stays at the ambient 0.5 → 128, proving the normal drives lambert.
    call(
        &mut e,
        "setLights",
        json!({"lights":[
            {"type":"ambient","color":[1,1,1],"intensity":0.5},
            {"type":"directional","direction":[0,0,1],"color":[1,1,1],"intensity":0.5}
        ]}),
    );
    let tilted = frame(&mut e, 0.);
    assert_eq!(px(&tilted, 8, 0, 0), [191, 0, 0, 255]);
    call(
        &mut e,
        "setLights",
        json!({"lights":[
            {"type":"ambient","color":[1,1,1],"intensity":0.5},
            {"type":"directional","direction":[-1,0,0],"color":[1,1,1],"intensity":0.5}
        ]}),
    );
    let tilted2 = frame(&mut e, 0.);
    assert_eq!(px(&tilted2, 8, 0, 0), [128, 0, 0, 255]);
    assert_eq!(px(&tilted2, 8, 2, 0), [0, 0, 0, 0]);
    // Nested composition rig: lights on the comp shade its own 3D layers
    // independently of the root rig.
    call(&mut e, "setLights", json!({"lights":[]}));
    let comp = call(&mut e, "addComposition", json!({"width":8,"height":8}))
        .data["comp_id"]
        .as_u64()
        .unwrap();
    let inner = shape_layer(&mut e, Some(comp));
    call(
        &mut e,
        "setLayer3D",
        json!({"layer":inner,"transform3d":{"rx":0,"ry":0,"z":0}}),
    );
    call(&mut e, "addCompLayer", json!({"comp":comp}));
    // Comp has no lights → inner renders unshaded even though root rig was cleared.
    let before_comp_lights = frame(&mut e, 0.);
    call(
        &mut e,
        "setLights",
        json!({"comp":comp,"lights":[{"type":"ambient","color":[1,1,1],"intensity":0.5}]}),
    );
    let comp_lit = frame(&mut e, 0.);
    assert_ne!(comp_lit, before_comp_lights);
}
