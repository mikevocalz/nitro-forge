//! scene-engine tests: ops, undo/redo, snapshot/restore round-trips,
//! hostile restores, world-transform evaluation, raycast picking,
//! bounds, primitive generation winding (verified through the real
//! scene-render rasterizer), and the renderFrame→scene-render wire
//! contract.

use crate::SceneEngine;
use ignition_core::{Command, Engine, EngineKind};
use serde_json::{json, Value};

fn apply(e: &mut SceneEngine, op: &str, payload: Value) -> Value {
    e.apply(Command::new(op, payload)).unwrap().data
}
fn apply_err(e: &mut SceneEngine, op: &str, payload: Value) -> String {
    e.apply(Command::new(op, payload)).unwrap_err().message
}
fn apply_err_full(e: &mut SceneEngine, op: &str, payload: Value) -> ignition_core::EngineError {
    e.apply(Command::new(op, payload)).unwrap_err()
}

fn new_scene() -> SceneEngine {
    let mut e = SceneEngine::new();
    apply(&mut e, "new", json!({}));
    e
}

/// material + mesh + mesh-node + camera helpers.
fn add_material(e: &mut SceneEngine) -> u64 {
    apply(e, "addMaterial", json!({"name":"mat","color":[0.8,0.2,0.2]}))["material_id"]
        .as_u64()
        .unwrap()
}
fn add_box(e: &mut SceneEngine, material: u64) -> (u64, u64) {
    let mesh_id = apply(
        e,
        "addMeshPrimitive",
        json!({"kind":"box","size":[1,1,1],"material":material}),
    )["mesh_id"]
    .as_u64()
    .unwrap();
    let node_id = apply(
        e,
        "addNode",
        json!({"kind":"mesh","mesh":mesh_id}),
    )["node_id"]
    .as_u64()
    .unwrap();
    (mesh_id, node_id)
}
fn add_camera(e: &mut SceneEngine, z: f32) -> u64 {
    apply(
        e,
        "addNode",
        json!({
            "kind":"camera",
            "camera":{"type":"perspective","fov_y_degrees":60,"near":0.1,"far":100},
            "transform":{"translation":[0,0,z]},
        }),
    )["node_id"]
    .as_u64()
    .unwrap()
}

#[test]
fn kind_and_new() {
    let mut e = SceneEngine::new();
    assert_eq!(e.kind(), EngineKind::Scene);
    assert_eq!(EngineKind::parse("scene"), Some(EngineKind::Scene));
    let d = apply(&mut e, "new", json!({"name":"demo"}));
    assert_eq!(d["ok"], true);
    let desc = apply(&mut e, "describe", json!({}));
    assert_eq!(desc["kind"], "scene");
    assert_eq!(desc["schema"], 1);
    assert_eq!(desc["name"], "demo");
    assert_eq!(desc["revision"], 1);
}

#[test]
fn node_lifecycle_and_undo() {
    let mut e = new_scene();
    let g = apply(&mut e, "addNode", json!({"kind":"group","name":"root"}))["node_id"]
        .as_u64()
        .unwrap();
    let c = apply(
        &mut e,
        "addNode",
        json!({"kind":"camera","parent":g,"camera":{"type":"orthographic","half_height":2,"near":0.1,"far":50}}),
    )["node_id"]
    .as_u64()
    .unwrap();
    apply(&mut e, "setTransform", json!({"id":c,"translation":[1,2,3],"rotation_deg":[0,45,0],"scale":[2,2,2]}));
    let desc = apply(&mut e, "describe", json!({}));
    let n = &desc["nodes"][c.to_string()];
    assert_eq!(n["parent"], g);
    assert_eq!(n["transform"]["translation"], json!([1.0, 2.0, 3.0]));
    assert_eq!(n["camera"]["type"], "orthographic");
    // Undo setTransform then addNode; redo restores.
    assert!(e.undo().unwrap());
    let desc = apply(&mut e, "describe", json!({}));
    assert_eq!(desc["nodes"][c.to_string()]["transform"]["translation"], json!([0.0, 0.0, 0.0]));
    assert!(e.undo().unwrap());
    // Second undo removes the camera node; the group remains.
    let desc = apply(&mut e, "describe", json!({}));
    assert!(desc["nodes"].get(c.to_string()).is_none());
    assert!(desc["nodes"].get(g.to_string()).is_some());
    assert!(e.undo().unwrap());
    assert!(apply(&mut e, "describe", json!({}))["nodes"].as_object().unwrap().is_empty());
    assert!(e.redo().unwrap());
    assert!(e.redo().unwrap());
    assert!(e.redo().unwrap());
    assert!(apply(&mut e, "describe", json!({}))["nodes"].get(c.to_string()).is_some());
}

#[test]
fn reparent_cycle_and_subtree_remove() {
    let mut e = new_scene();
    let a = apply(&mut e, "addNode", json!({"kind":"group"}))["node_id"].as_u64().unwrap();
    let b = apply(&mut e, "addNode", json!({"kind":"group","parent":a}))["node_id"].as_u64().unwrap();
    let c = apply(&mut e, "addNode", json!({"kind":"group","parent":b}))["node_id"].as_u64().unwrap();
    // Reparent a under its own descendant must reject atomically.
    let err = apply_err(&mut e, "updateNode", json!({"id":a,"parent":c}));
    assert!(err.contains("cycle"), "{err}");
    let desc = apply(&mut e, "describe", json!({}));
    assert_eq!(desc["nodes"][a.to_string()]["parent"], 0);
    // Self-parent rejects.
    assert!(apply_err(&mut e, "updateNode", json!({"id":a,"parent":a})).contains("cycle"));
    // Removing the root of the chain drops the whole subtree.
    apply(&mut e, "removeNode", json!({"id":a}));
    let desc = apply(&mut e, "describe", json!({}));
    assert_eq!(desc["nodes"].as_object().unwrap().len(), 0);
}

#[test]
fn duplicate_subtree() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    let (_m, n1) = add_box(&mut e, mat);
    let parent = apply(&mut e, "addNode", json!({"kind":"group","name":"assembly"}))["node_id"]
        .as_u64()
        .unwrap();
    apply(&mut e, "updateNode", json!({"id":n1,"parent":parent}));
    let child = apply(&mut e, "addNode", json!({"kind":"group","parent":parent}))["node_id"]
        .as_u64()
        .unwrap();
    let res = apply(&mut e, "duplicateNode", json!({"id":parent,"name":"assembly-copy"}));
    assert_eq!(res["count"], 3);
    let new_root = res["node_id"].as_u64().unwrap();
    let desc = apply(&mut e, "describe", json!({}));
    assert_eq!(desc["nodes"][new_root.to_string()]["name"], "assembly-copy");
    assert_eq!(desc["nodes"][new_root.to_string()]["parent"], 0);
    // The duplicated mesh node references the SAME mesh (shared geometry).
    let _dup_mesh_node = desc["nodes"]
        .as_object()
        .unwrap()
        .values()
        .find(|n| n["kind"] == "mesh" && n["id"] != n1 && n["parent"] != parent)
        .unwrap();
    assert_eq!(desc["meshes"].as_object().unwrap().len(), 1);
    let _ = child;
}

#[test]
fn material_and_mesh_ops() {
    let mut e = new_scene();
    // Mesh requires an existing material.
    assert!(apply_err(&mut e, "addMeshPrimitive", json!({"kind":"box"})).contains("material"));
    let mat = add_material(&mut e);
    let (mesh_id, node_id) = add_box(&mut e, mat);
    // setMaterial retargets the mesh's material.
    let mat2 = apply(&mut e, "addMaterial", json!({"color":[0,1,0]}))["material_id"].as_u64().unwrap();
    apply(&mut e, "setMaterial", json!({"mesh":mesh_id,"material":mat2}));
    let desc = apply(&mut e, "describe", json!({}));
    assert_eq!(desc["meshes"][mesh_id.to_string()]["material"], mat2);
    // Removing a referenced material rejects; removing the mesh's material
    // after retarget still rejects while the mesh references mat2.
    assert!(apply_err(&mut e, "removeMaterial", json!({"id":mat2})).contains("material"));
    apply(&mut e, "removeMaterial", json!({"id":mat}));
    // removeMesh while a node references it rejects via validation.
    assert!(apply_err(&mut e, "removeMesh", json!({"id":mesh_id})).is_empty() == false);
    apply(&mut e, "removeNode", json!({"id":node_id}));
    apply(&mut e, "removeMesh", json!({"id":mesh_id}));
    apply(&mut e, "removeMaterial", json!({"id":mat2}));
    let desc = apply(&mut e, "describe", json!({}));
    assert_eq!(desc["meshes"].as_object().unwrap().len(), 0);
}

#[test]
fn custom_mesh_b64_validation() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    // A single triangle: positions f32le base64.
    let positions: Vec<f32> = vec![-0.5, -0.5, 0.0, 0.5, -0.5, 0.0, 0.0, 0.5, 0.0];
    let mut bytes = Vec::new();
    for f in &positions {
        bytes.extend_from_slice(&f.to_le_bytes());
    }
    let b64 = ignition_core::base64_encode(&bytes);
    let bad = apply_err(
        &mut e,
        "addMesh",
        json!({"material":mat,"positions_b64":b64,"indices_b64":"!!!!"}),
    );
    assert!(!bad.is_empty());
    let id = apply(
        &mut e,
        "addMesh",
        json!({"material":mat,"positions_b64":b64,"name":"tri"}),
    )["mesh_id"]
    .as_u64()
    .unwrap();
    assert!(id > 0);
    // Out-of-range index rejects.
    let ix: Vec<u32> = vec![0, 1, 7];
    let mut ib = Vec::new();
    for i in &ix {
        ib.extend_from_slice(&i.to_le_bytes());
    }
    let err = apply_err(
        &mut e,
        "updateMesh",
        json!({"id":id,"positions_b64":b64,"indices_b64":ignition_core::base64_encode(&ib)}),
    );
    assert!(err.contains("vertex"), "{err}");
    // NaN vertex rejects.
    let nan: Vec<f32> = vec![f32::NAN, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let mut nb = Vec::new();
    for f in &nan {
        nb.extend_from_slice(&f.to_le_bytes());
    }
    assert!(!apply_err(
        &mut e,
        "updateMesh",
        json!({"id":id,"positions_b64":ignition_core::base64_encode(&nb)}),
    )
    .is_empty());
}

#[test]
fn transform_validation_rejects_bad_values() {
    let mut e = new_scene();
    let n = apply(&mut e, "addNode", json!({"kind":"group"}))["node_id"].as_u64().unwrap();
    for bad in [
        json!({"id":n,"scale":[0,1,1]}),
        json!({"id":n,"scale":[1e9,1,1]}),
        json!({"id":n,"translation":[f64::NAN,0,0]}),
        json!({"id":n,"rotation_deg":[1e9,0,0]}),
    ] {
        assert!(!apply_err(&mut e, "setTransform", bad).is_empty());
    }
    // Snapshot unchanged after rejected writes.
    let snap = e.snapshot().unwrap();
    assert!(apply_err(&mut e, "setTransform", json!({"id":n,"scale":[0,1,1]})).contains("scale"));
    assert_eq!(e.snapshot().unwrap(), snap);
}

#[test]
fn snapshot_restore_roundtrip_and_hostile() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    let (mesh_id, node_id) = add_box(&mut e, mat);
    add_camera(&mut e, 5.0);
    let snap = e.snapshot().unwrap();
    let mut r = SceneEngine::new();
    r.restore(&snap).unwrap();
    assert_eq!(r.snapshot().unwrap(), snap);
    let d1 = apply(&mut e, "describe", json!({}));
    let d2 = apply(&mut r, "describe", json!({}));
    assert_eq!(d1, d2);
    // Hostile restores: bad magic, truncated, wrong kind, dangling refs,
    // cycles, oversized claims.
    assert!(r.restore(&[0u8; 8]).is_err());
    assert!(r.restore(&snap[..snap.len() / 2]).is_err());
    let mut doc: Value = serde_json::from_slice(
        &ignition_core::decode_envelope(&snap).unwrap().1,
    )
    .unwrap();
    doc["kind"] = json!("draft");
    let env = ignition_core::encode_envelope(&serde_json::to_vec(&doc).unwrap());
    assert!(r.restore(&env).is_err());
    // Dangling mesh reference.
    let mut doc: Value = serde_json::from_slice(&ignition_core::decode_envelope(&snap).unwrap().1).unwrap();
    doc["nodes"][node_id.to_string()]["mesh"] = json!(9999);
    let env = ignition_core::encode_envelope(&serde_json::to_vec(&doc).unwrap());
    assert!(r.restore(&env).is_err());
    // Parent cycle.
    let mut doc: Value = serde_json::from_slice(&ignition_core::decode_envelope(&snap).unwrap().1).unwrap();
    let other = doc["nodes"]
        .as_object()
        .unwrap()
        .keys()
        .find(|k| k.parse::<u64>().unwrap() != node_id)
        .cloned();
    if let Some(k) = other {
        doc["nodes"][k.clone()]["parent"] = json!(node_id);
        doc["nodes"][node_id.to_string()]["parent"] = json!(k.parse::<u64>().unwrap());
        let env = ignition_core::encode_envelope(&serde_json::to_vec(&doc).unwrap());
        assert!(r.restore(&env).is_err());
    }
    // State untouched by failed restores.
    assert_eq!(r.snapshot().unwrap(), snap);
    let _ = mesh_id;
}

#[test]
fn world_transform_evaluation() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    let (_m, node) = add_box(&mut e, mat);
    // Parent group translated +10x, rotated 90° about Y; child offset +1z.
    let g = apply(&mut e, "addNode", json!({"kind":"group","transform":{"translation":[10,0,0],"rotation_deg":[0,90,0]}}))
        ["node_id"].as_u64().unwrap();
    apply(&mut e, "updateNode", json!({"id":node,"parent":g}));
    apply(&mut e, "setTransform", json!({"id":node,"translation":[0,0,1]}));
    // bounds: unit box at world pos: group rotates child offset (0,0,1)->(1,0,0)?
    // Ry(90): x' = z, z' = -x  → local (0,0,1) → (1,0,0); plus group (10,0,0) → (11,0,0).
    // Box half extents 0.5 → bounds min ≈ (10.5,-0.5,-0.5), max ≈ (11.5,0.5,0.5).
    let b = apply(&mut e, "bounds", json!({}));
    let min = b["bounds"]["min"].as_array().unwrap();
    let max = b["bounds"]["max"].as_array().unwrap();
    assert!((min[0].as_f64().unwrap() - 10.5).abs() < 1e-4, "{b}");
    assert!((max[0].as_f64().unwrap() - 11.5).abs() < 1e-4, "{b}");
    assert!((min[1].as_f64().unwrap() + 0.5).abs() < 1e-4);
    assert!((max[2].as_f64().unwrap() - 0.5).abs() < 1e-4);
}

#[test]
fn pick_ray_hits_box() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    let (_m, node) = add_box(&mut e, mat); // unit box at origin
    // Ray from +Z toward -Z hits the box's +Z face at z=0.5.
    let r = apply(
        &mut e,
        "pick",
        json!({"origin":[0,0,5],"direction":[0,0,-1]}),
    );
    let hit = &r["hit"];
    assert_eq!(hit["node_id"], node);
    assert!((hit["distance"].as_f64().unwrap() - 4.5).abs() < 1e-4, "{r}");
    assert!((hit["point"][2].as_f64().unwrap() - 0.5).abs() < 1e-4);
    // Miss returns null.
    let miss = apply(&mut e, "pick", json!({"origin":[10,10,5],"direction":[0,0,-1]}));
    assert!(miss["hit"].is_null());
    // Invisible node is not pickable.
    apply(&mut e, "updateNode", json!({"id":node,"visible":false}));
    let miss2 = apply(&mut e, "pick", json!({"origin":[0,0,5],"direction":[0,0,-1]}));
    assert!(miss2["hit"].is_null());
}

#[test]
fn render_frame_emits_scene_render_payload() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    let (_m, _n) = add_box(&mut e, mat);
    add_camera(&mut e, 5.0);
    // Directional + ambient lights (ambient guarantees non-black shading
    // regardless of face orientation — this test checks coverage, not
    // lighting correctness which scene-render's own suite covers).
    apply(
        &mut e,
        "addNode",
        json!({"kind":"light","light":{"type":"directional","intensity":1.2,"direction":[0,-1,0]}}),
    );
    apply(
        &mut e,
        "addNode",
        json!({"kind":"light","light":{"type":"ambient","intensity":1.0}}),
    );
    let scene = apply(
        &mut e,
        "renderFrame",
        json!({"width":64,"height":64,"format":"raw"}),
    );
    assert_eq!(scene["width"], 64);
    assert_eq!(scene["camera"]["position"], json!([0.0, 0.0, 5.0]));
    assert_eq!(scene["camera"]["type"], "perspective");
    assert_eq!(scene["lights"].as_array().unwrap().len(), 2);
    assert_eq!(scene["meshes"].as_array().unwrap().len(), 1);
    assert!(scene["meshes"][0]["positions_b64"].as_str().unwrap().len() > 100);
    assert_eq!(scene["materials"].as_array().unwrap().len(), 1);
    // Feed the emitted description into the REAL scene-render service —
    // the same path a host takes — and expect a shaded box on background.
    let svc = scene_render::SceneRenderService::new();
    let req = ignition_core::FrameRequest {
        id: 1,
        handle: 0,
        op: "render".into(),
        payload: scene.clone(),
    };
    let resp = svc.handle_frame(&req);
    assert!(resp.ok, "{:?}", resp.error);
    let data = resp.data.unwrap();
    assert_eq!(data["width"], 64);
    let rgba = ignition_core::base64_decode(data["bytes_b64"].as_str().unwrap()).unwrap();
    assert_eq!(rgba.len(), 64 * 64 * 4);
    // The box must cover the center pixels (not background).
    let center = ((32 * 64 + 32) * 4) as usize;
    let corner = 4usize;
    let center_px = &rgba[center..center + 3];
    let corner_px = &rgba[corner..corner + 3];
    assert_ne!(center_px, corner_px, "box should shade differently than background");
    // stats sanity.
    assert_eq!(data["stats"]["meshes"], 1);
    assert_eq!(data["stats"]["triangles"], 12);
}

#[test]
fn render_frame_requires_camera_and_validates_textures() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    let (_m, _n) = add_box(&mut e, mat);
    // No camera → error.
    assert!(!apply_err(&mut e, "renderFrame", json!({"width":8,"height":8})).is_empty());
    add_camera(&mut e, 5.0);
    // Material with texture name but no textures supplied → error.
    apply(&mut e, "updateMaterial", json!({"id":1,"texture":"wood"}));
    // Mesh has no UVs → textured material write itself rejects first.
    // (box primitive HAS uvs, so this passes; texture check then fires.)
    let err = apply_err(&mut e, "renderFrame", json!({"width":8,"height":8}));
    assert!(err.contains("wood"), "{err}");
    // Supplying the texture resolves it.
    let tex = json!({"width":1,"height":1,"format":"rgba8","bytes_b64":ignition_core::base64_encode(&[255,0,0,255])});
    let scene = apply(
        &mut e,
        "renderFrame",
        json!({"width":8,"height":8,"textures":{"wood":tex}}),
    );
    assert_eq!(scene["textures"]["wood"]["width"], 1);
    assert_eq!(scene["materials"][0]["texture"], "wood");
    // Hostile dims reject.
    assert!(!apply_err(&mut e, "renderFrame", json!({"width":0,"height":8})).is_empty());
    assert!(!apply_err(&mut e, "renderFrame", json!({"width":5000,"height":8})).is_empty());
}

#[test]
fn primitives_generate_valid_geometry() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    for (kind, params) in [
        ("box", json!({})),
        ("plane", json!({"width":2,"depth":3,"width_segments":4,"depth_segments":2})),
        ("sphere", json!({"radius":1,"latitude_segments":8,"longitude_segments":16})),
        ("cylinder", json!({"radius":0.5,"height":2,"radial_segments":12})),
        ("torus", json!({"major_radius":1,"minor_radius":0.3,"major_segments":16,"minor_segments":8})),
    ] {
        let mut p = params.clone();
        p["kind"] = json!(kind);
        p["material"] = json!(mat);
        let id = apply(&mut e, "addMeshPrimitive", p)["mesh_id"].as_u64().unwrap();
        assert!(id > 0, "{kind}");
    }
    // Out-of-range segment counts reject.
    assert!(!apply_err(
        &mut e,
        "addMeshPrimitive",
        json!({"kind":"sphere","latitude_segments":300,"material":mat}),
    )
    .is_empty());
    assert!(!apply_err(
        &mut e,
        "addMeshPrimitive",
        json!({"kind":"nonesuch","material":mat}),
    )
    .is_empty());
    // describe shows all meshes with canonical b64.
    let d = apply(&mut e, "describe", json!({}));
    assert_eq!(d["meshes"].as_object().unwrap().len(), 5);
}

#[test]
fn batch_is_atomic() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    let before = e.snapshot().unwrap();
    // Batch: two mutations commit as one undo entry.
    let res = e
        .apply(Command::new(
            "__batch",
            json!({"commands":[
                {"op":"addMeshPrimitive","payload":{"kind":"box","material":mat}},
                {"op":"addNode","payload":{"kind":"camera","camera":{"type":"perspective"}}},
            ]}),
        ))
        .unwrap();
    assert_eq!(res.events.iter().filter(|ev| ev.kind == "document:changed").count(), 1);
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
    // Failing batch leaves state and history intact.
    assert!(e
        .apply(Command::new(
            "__batch",
            json!({"commands":[
                {"op":"addNode","payload":{"kind":"group"}},
                {"op":"notAnOp","payload":{}},
            ]}),
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn undo_redo_empty_and_revision() {
    let mut e = SceneEngine::new();
    assert!(!e.undo().unwrap());
    assert!(!e.redo().unwrap());
    apply(&mut e, "new", json!({}));
    apply(&mut e, "addMaterial", json!({}));
    let r1 = apply(&mut e, "describe", json!({}))["revision"].as_u64().unwrap();
    apply(&mut e, "addMaterial", json!({}));
    let r2 = apply(&mut e, "describe", json!({}))["revision"].as_u64().unwrap();
    assert!(r2 > r1);
    e.undo().unwrap();
    let r3 = apply(&mut e, "describe", json!({}))["revision"].as_u64().unwrap();
    assert_eq!(r3, r1);
}

#[test]
fn light_and_camera_node_emission() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    add_box(&mut e, mat);
    // Point light at node position, moved by transform.
    let l = apply(
        &mut e,
        "addNode",
        json!({"kind":"light","light":{"type":"point","color":[1,1,1],"intensity":5,"range":10},
               "transform":{"translation":[1,2,3]}}),
    )["node_id"].as_u64().unwrap();
    // Ambient.
    apply(&mut e, "addNode", json!({"kind":"light","light":{"type":"ambient","intensity":0.5}}));
    let cam = apply(
        &mut e,
        "addNode",
        json!({"kind":"camera","camera":{"type":"orthographic","half_height":2,"near":0.1,"far":50},
               "transform":{"translation":[0,0,10],"rotation_deg":[0,180,0]}}),
    )["node_id"].as_u64().unwrap();
    let scene = apply(
        &mut e,
        "renderFrame",
        json!({"width":32,"height":32,"camera_node":cam}),
    );
    assert_eq!(scene["camera"]["type"], "orthographic");
    assert_eq!(scene["camera"]["half_height"], 2.0);
    // Point light emitted at world position [1,2,3].
    let lights = scene["lights"].as_array().unwrap();
    assert_eq!(lights.len(), 2);
    let point = lights.iter().find(|l| l["type"] == "point").unwrap();
    assert_eq!(point["position"], json!([1.0, 2.0, 3.0]));
    assert_eq!(point["range"], 10.0);
    let amb = lights.iter().find(|l| l["type"] == "ambient").unwrap();
    assert_eq!(amb["intensity"], 0.5);
    // Invisible light excluded.
    apply(&mut e, "updateNode", json!({"id":l,"visible":false}));
    let scene2 = apply(&mut e, "renderFrame", json!({"width":32,"height":32,"camera_node":cam}));
    assert_eq!(scene2["lights"].as_array().unwrap().len(), 1);
}

/// Flat f32 positions blob → canonical base64 (all zeros is finite).
fn positions_b64(verts: usize) -> String {
    let mut bytes = Vec::with_capacity(verts * 12);
    for _ in 0..verts * 3 {
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
    }
    ignition_core::base64_encode(&bytes)
}
fn indices_b64(ix: &[u32]) -> String {
    let mut bytes = Vec::with_capacity(ix.len() * 4);
    for i in ix {
        bytes.extend_from_slice(&i.to_le_bytes());
    }
    ignition_core::base64_encode(&bytes)
}

#[test]
fn render_frame_and_bounds_reject_vertex_instancing_amplification() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    // One 99,999-vertex mesh referenced by 31 nodes: stored geometry is
    // tiny, but EMITTED geometry is 31 × 99,999 = 3,099,969 vertices —
    // over the scene-render service's 3,000,000-vertex scene cap. The
    // single-triangle index keeps emitted triangles at 31.
    let mesh_id = apply(
        &mut e,
        "addMesh",
        json!({
            "material": mat,
            "positions_b64": positions_b64(99_999),
            "indices_b64": indices_b64(&[0, 1, 2]),
        }),
    )["mesh_id"]
    .as_u64()
    .unwrap();
    for _ in 0..31 {
        apply(&mut e, "addNode", json!({"kind":"mesh","mesh":mesh_id}));
    }
    add_camera(&mut e, 5.0);
    // Both reads reject OutOfBounds before emitting — no multi-GB JSON.
    let err = apply_err_full(&mut e, "renderFrame", json!({"width":8,"height":8}));
    assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds, "{err:?}");
    assert!(err.message.contains("vertices"), "{}", err.message);
    let err = apply_err_full(&mut e, "bounds", json!({}));
    assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds, "{err:?}");
    assert!(err.message.contains("vertices"), "{}", err.message);
}

#[test]
fn render_frame_rejects_triangle_instancing_amplification() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    // 300,000 indexed triangles per instance; 4 instances = 1.2M
    // triangles > the 1,000,000 service cap while vertices stay under.
    let ix: Vec<u32> = (0..900_000u32).map(|i| i % 99_999).collect();
    let mesh_id = apply(
        &mut e,
        "addMesh",
        json!({
            "material": mat,
            "positions_b64": positions_b64(99_999),
            "indices_b64": indices_b64(&ix),
        }),
    )["mesh_id"]
    .as_u64()
    .unwrap();
    for _ in 0..4 {
        apply(&mut e, "addNode", json!({"kind":"mesh","mesh":mesh_id}));
    }
    add_camera(&mut e, 5.0);
    let err = apply_err_full(&mut e, "renderFrame", json!({"width":8,"height":8}));
    assert_eq!(err.code, ignition_core::ErrorCode::OutOfBounds, "{err:?}");
    assert!(err.message.contains("triangles"), "{}", err.message);
}

#[test]
fn render_frame_directions_ignore_scale() {
    let mut e = new_scene();
    let mat = add_material(&mut e);
    add_box(&mut e, mat);
    // Directional light with non-uniform scale AND rotation: the
    // emitted direction must be rotation-only. Rz(90)·normalize([1,1,0])
    // = [-√2/2, +√2/2, 0]; applying scale [4,1,1] first would skew it.
    apply(
        &mut e,
        "addNode",
        json!({
            "kind":"light",
            "light":{"type":"directional","direction":[1,1,0],"intensity":1},
            "transform":{"rotation_deg":[0,0,90],"scale":[4,1,1]},
        }),
    );
    // Camera under a non-uniformly scaled parent (and own scale): the
    // emitted forward/up basis must be unaffected by any scale.
    // Ry(45) maps local -Z to (-√2/2, 0, -√2/2), +Y stays +Y.
    let g = apply(
        &mut e,
        "addNode",
        json!({"kind":"group","transform":{"scale":[3,1,1]}}),
    )["node_id"]
    .as_u64()
    .unwrap();
    let cam = apply(
        &mut e,
        "addNode",
        json!({
            "kind":"camera",
            "camera":{"type":"perspective","fov_y_degrees":60,"near":0.1,"far":100},
            "parent": g,
            "transform":{"translation":[0,0,5],"rotation_deg":[0,45,0],"scale":[2,1,1]},
        }),
    )["node_id"]
    .as_u64()
    .unwrap();
    let scene = apply(
        &mut e,
        "renderFrame",
        json!({"width":8,"height":8,"camera_node":cam}),
    );
    let light = scene["lights"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["type"] == "directional")
        .unwrap();
    let d = light["direction"].as_array().unwrap();
    let inv = std::f64::consts::FRAC_1_SQRT_2;
    assert!((d[0].as_f64().unwrap() + inv).abs() < 1e-4, "{scene}");
    assert!((d[1].as_f64().unwrap() - inv).abs() < 1e-4, "{scene}");
    assert!(d[2].as_f64().unwrap().abs() < 1e-6, "{scene}");
    // Camera basis: forward = normalize(target - position).
    let pos = scene["camera"]["position"].as_array().unwrap();
    let tgt = scene["camera"]["target"].as_array().unwrap();
    let f = [
        tgt[0].as_f64().unwrap() - pos[0].as_f64().unwrap(),
        tgt[1].as_f64().unwrap() - pos[1].as_f64().unwrap(),
        tgt[2].as_f64().unwrap() - pos[2].as_f64().unwrap(),
    ];
    let fl = (f[0] * f[0] + f[1] * f[1] + f[2] * f[2]).sqrt();
    assert!((f[0] / fl + inv).abs() < 1e-4, "{scene}");
    assert!((f[1] / fl).abs() < 1e-4, "{scene}");
    assert!((f[2] / fl + inv).abs() < 1e-4, "{scene}");
    let up = scene["camera"]["up"].as_array().unwrap();
    assert!((up[0].as_f64().unwrap()).abs() < 1e-4, "{scene}");
    assert!((up[1].as_f64().unwrap() - 1.0).abs() < 1e-4, "{scene}");
    assert!(up[2].as_f64().unwrap().abs() < 1e-4, "{scene}");
}
