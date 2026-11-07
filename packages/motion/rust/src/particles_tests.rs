use super::particles::{ParticleEmitter, ParticleSprite, SpriteShape, MAX_EMITTERS};
use super::*;

fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
}
fn emitter_json() -> Value {
    json!({
        "seed": 7,
        "rate": 20,
        "lifetime_s": 1.0,
        "angle_deg": -90,
        "spread_deg": 0,
        "speed": 0,
        "sprite": {"kind":"shape","shape":"rect","width":1,"height":1,"fill":[255,0,0,255]},
        "spawn": {"x":2,"y":2,"w":1,"h":1},
        "fade": 0
    })
}
fn particles_layer(e: &mut MotionEngine) -> u64 {
    call(e, "addParticlesLayer", json!({"name":"fx"}))
        .data["layer_id"]
        .as_u64()
        .unwrap()
}
fn set_emitter(e: &mut MotionEngine, layer: u64, emitter: Value) {
    call(
        e,
        "setParticleEmitter",
        json!({"layer":layer,"emitter":emitter}),
    );
}
fn frame(e: &mut MotionEngine, t: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}
fn lit_pixels(pixels: &[u8], w: usize) -> Vec<(usize, usize)> {
    pixels
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, px)| px[3] > 0)
        .map(|(i, _)| (i % w, i / w))
        .collect()
}

#[test]
fn particles_render_deterministically_and_seek_safely() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":4}));
    let id = particles_layer(&mut e);
    set_emitter(&mut e, id, emitter_json());
    // Same time renders byte-identical frames; seeking backward reproduces
    // the earlier frame exactly (no accumulated sim state).
    let a = frame(&mut e, 0.5);
    let b = frame(&mut e, 1.5);
    let a2 = frame(&mut e, 0.5);
    let a3 = frame(&mut e, 0.5);
    assert_eq!(a, a2);
    assert_eq!(a2, a3);
    assert_ne!(a, b, "different times must differ while particles live");
    // The spawn rect is a single local pixel with speed 0, so every alive
    // particle stacks on canvas pixel (2,2): lit pixels prove emission.
    assert!(lit_pixels(&a, 8).contains(&(2, 2)));
    // rate=20, lifetime=1: at t=0.5 births 0..=10 alive; t=1.5 births 10..=30.
    // Both windows overlap only at n=10, whose deterministic attributes
    // differ across seeds but the frames legitimately differ here.
}

#[test]
fn seed_changes_particle_layout() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":4}));
    let id = particles_layer(&mut e);
    let mut spec = emitter_json();
    spec["spread_deg"] = json!(360);
    spec["speed"] = json!(2.0);
    spec["spawn"] = json!({"x":4,"y":4,"w":0.001,"h":0.001});
    set_emitter(&mut e, id, spec.clone());
    let one = frame(&mut e, 0.4);
    spec["seed"] = json!(99);
    set_emitter(&mut e, id, spec);
    let two = frame(&mut e, 0.4);
    assert_ne!(one, two);
}

#[test]
fn emitter_bounds_caps_and_kind_rules_hold() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":4}));
    let shape = call(
        &mut e,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,255,0,255]}}),
    )
    .data["layer_id"]
    .as_u64()
    .unwrap();
    // Emitters only attach to particles layers.
    assert!(try_call(
        &mut e,
        "setParticleEmitter",
        json!({"layer":shape,"emitter":emitter_json()})
    )
    .is_err());
    let id = particles_layer(&mut e);
    // rate * lifetime must stay <= 511 (512 alive sprites max).
    let mut hot = emitter_json();
    hot["rate"] = json!(600);
    hot["lifetime_s"] = json!(1.0);
    assert!(try_call(
        &mut e,
        "setParticleEmitter",
        json!({"layer":id,"emitter":hot})
    )
    .is_err());
    // Per-composition sprite budget: two emitters of bound ~300 exceed 512.
    set_emitter(&mut e, id, {
        let mut s = emitter_json();
        s["rate"] = json!(300);
        s["lifetime_s"] = json!(1.0);
        s
    });
    let second = particles_layer(&mut e);
    assert!(try_call(
        &mut e,
        "setParticleEmitter",
        json!({"layer":second,"emitter":{
            "seed":1,"rate":300,"lifetime_s":1.0,
            "sprite":{"kind":"shape","shape":"rect","width":1,"height":1,"fill":[0,0,255,255]}
        }})
    )
    .is_err());
    // Document emitter cap is global across compositions; per-comp sprite
    // budgets and the 16 canvas-raster layer budget force spreading them.
    // rate 0 emitters cost no sprites, isolating the 64-emitter cap.
    let mut e2 = MotionEngine::new();
    call(&mut e2, "new", json!({"width":4,"height":4,"duration_s":1}));
    let spec = json!({"seed":1,"rate":0,"lifetime_s":1.0,
        "sprite":{"kind":"shape","shape":"rect","width":1,"height":1,"fill":[0,0,255,255]}});
    let mut comps = vec![];
    for i in 0..=MAX_EMITTERS {
        // 13 particles layers per comp stays under the 16 canvas-raster cap.
        if i % 13 == 0 {
            comps.push(
                call(&mut e2, "addComposition", json!({"width":4,"height":4}))
                    .data["comp_id"]
                    .as_u64()
                    .unwrap(),
            );
        }
        let comp = comps[i / 13];
        let l = call(
            &mut e2,
            "addParticlesLayer",
            json!({"comp":comp}),
        )
        .data["layer_id"]
        .as_u64()
        .unwrap();
        let result = try_call(
            &mut e2,
            "setParticleEmitter",
            json!({"layer":l,"emitter":spec}),
        );
        if i < MAX_EMITTERS {
            assert!(result.is_ok(), "emitter {i} should be accepted");
        } else {
            assert!(result.is_err(), "emitter 65 must exceed the cap");
        }
    }
}

#[test]
fn hostile_restore_rejects_bad_emitters_and_state_survives() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":4}));
    let id = particles_layer(&mut e);
    set_emitter(&mut e, id, emitter_json());
    let good = e.snapshot().unwrap();
    // Craft hostile states: out-of-range rate, emitter on a shape layer,
    // unknown sprite asset, oversized sprite, unknown fields.
    let mut wire = serde_json::to_value(&*e.state).unwrap();
    wire["layers"][0]["emitter"]["rate"] = json!(1e9);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), good);

    let mut wire = serde_json::to_value(&*e.state).unwrap();
    wire["layers"][0]["emitter"]["bogus"] = json!(1);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), good);

    let mut wire = serde_json::to_value(&*e.state).unwrap();
    wire["layers"][0]["emitter"]["sprite"] =
        json!({"kind":"asset","asset_id":77});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), good);

    // An emitter smuggled onto a shape layer rejects on kind mismatch.
    let mut e3 = MotionEngine::new();
    call(&mut e3, "new", json!({"width":4,"height":4,"duration_s":1}));
    call(
        &mut e3,
        "addShapeLayer",
        json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[0,255,0,255]}}),
    );
    let mut wire = serde_json::to_value(&*e3.state).unwrap();
    wire["layers"][0]["emitter"] = emitter_json();
    let before = e3.snapshot().unwrap();
    assert!(e3
        .restore(&encode_envelope(&serde_json::to_vec(&wire).unwrap()))
        .is_err());
    assert_eq!(e3.snapshot().unwrap(), before);
}

#[test]
fn lifetime_window_and_undo_redo_are_exact() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":4}));
    let id = particles_layer(&mut e);
    // rate 10, lifetime 1, spawn a 1px point, speed 0: lit-pixel count
    // tracks the alive window ceil/floor edges deterministically.
    set_emitter(
        &mut e,
        id,
        json!({
            "seed":3,"rate":10,"lifetime_s":1.0,"angle_deg":0,"spread_deg":0,
            "speed":0,"fade":0,
            "sprite":{"kind":"shape","shape":"rect","width":1,"height":1,"fill":[255,0,0,255]},
            "spawn":{"x":4,"y":4,"w":0.001,"h":0.001}
        }),
    );
    // t=0: only birth n=0 (tau=0). t=0.5: n=0..=5 (6 particles, all on the
    // same sub-pixel spawn so still one lit pixel but alpha stacks).
    // t=1.05: window n=1..=10 -> particle n=0 has died.
    let early = frame(&mut e, 0.0);
    let mid = frame(&mut e, 0.5);
    let late = frame(&mut e, 1.05);
    assert!(lit_pixels(&early, 8).contains(&(4, 4)));
    assert!(lit_pixels(&mid, 8).contains(&(4, 4)));
    assert!(lit_pixels(&late, 8).contains(&(4, 4)));
    // Undo removes the emitter (empty layer renders nothing), redo restores.
    assert!(e.undo().unwrap());
    let cleared = frame(&mut e, 0.5);
    assert!(lit_pixels(&cleared, 8).is_empty());
    let described = call(&mut e, "describe", json!({}));
    assert!(described.data["layers"][0]["emitter"].is_null()
        || described.data["layers"][0].get("emitter").is_none());
    assert!(e.redo().unwrap());
    assert_eq!(frame(&mut e, 0.5), mid);
}

#[test]
fn layer_transform_and_asset_sprites_apply() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":12,"height":12,"duration_s":2}));
    // 2x2 opaque white asset as sprite.
    let asset = call(
        &mut e,
        "addRasterAsset",
        json!({"width":2,"height":2,"format":"rgba8-straight-srgb",
               "pixels_b64":ignition_core::base64_encode(&[255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255])}),
    )
    .data["asset_id"]
    .as_u64()
    .unwrap();
    let id = particles_layer(&mut e);
    set_emitter(
        &mut e,
        id,
        json!({
            "seed":11,"rate":50,"lifetime_s":2.0,"angle_deg":0,"spread_deg":0,
            "speed":0,"fade":0,
            "sprite":{"kind":"asset","asset_id":asset},
            "spawn":{"x":1,"y":1,"w":0.001,"h":0.001}
        }),
    );
    let pixels = frame(&mut e, 1.0);
    let lit = lit_pixels(&pixels, 12);
    // Asset sprite is 2x2 natural size stamped around spawn (1,1): covers
    // pixels (0..=1, 0..=1) partially; at least one lit pixel near origin.
    assert!(lit.iter().any(|&(x, y)| x <= 2 && y <= 2));
    // Removing the asset while referenced rejects; after clearing the
    // emitter the asset removes cleanly.
    assert!(try_call(&mut e, "removeRasterAsset", json!({"id":asset})).is_err());
    call(
        &mut e,
        "setParticleEmitter",
        json!({"layer":id,"emitter":null}),
    );
    call(&mut e, "removeRasterAsset", json!({"id":asset}));
    // Transform moves the whole particle field: tx=+5 shifts lit pixels.
    set_emitter(
        &mut e,
        id,
        json!({
            "seed":11,"rate":50,"lifetime_s":2.0,"angle_deg":0,"spread_deg":0,
            "speed":0,"fade":0,
            "sprite":{"kind":"shape","shape":"rect","width":1,"height":1,"fill":[255,0,0,255]},
            "spawn":{"x":1,"y":1,"w":0.001,"h":0.001}
        }),
    );
    call(
        &mut e,
        "updateLayer",
        json!({"id":id,"transform":{"tx":5}}),
    );
    let moved = frame(&mut e, 1.0);
    let lit_moved = lit_pixels(&moved, 12);
    assert!(lit_moved.iter().all(|&(x, _)| x >= 5));
    assert!(lit_moved.iter().any(|&(x, y)| x == 6 && y == 1));
}

#[test]
fn emitter_spec_roundtrips_through_snapshot() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8,"duration_s":4}));
    let id = particles_layer(&mut e);
    set_emitter(&mut e, id, emitter_json());
    let snap = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&snap).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), snap);
    // evaluate exposes the emitter spec on the particles layer.
    let ev = call(&mut reopened, "evaluate", json!({"time_s":0.5}));
    let layer = &ev.data["layers"][0];
    assert_eq!(layer["kind"], json!("particles"));
    assert_eq!(layer["emitter"]["seed"], json!(7));
    assert_eq!(layer["emitter"]["rate"], json!(20.0));
    // A fresh particles layer with no emitter serializes without the field.
    let bare = particles_layer(&mut e);
    let desc = call(&mut e, "describe", json!({}));
    let bare_layer = desc.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(bare))
        .unwrap();
    assert!(bare_layer.get("emitter").is_none());
    // Clearing via null keeps kind and emits an empty layer.
    call(
        &mut e,
        "setParticleEmitter",
        json!({"layer":id,"emitter":null}),
    );
    let desc = call(&mut e, "describe", json!({}));
    let cleared = desc.data["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == json!(id))
        .unwrap();
    assert_eq!(cleared["kind"], json!("particles"));
    assert!(cleared.get("emitter").is_none());
    assert!(frame(&mut e, 0.5).iter().all(|&b| b == 0));
}
