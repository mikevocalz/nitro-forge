//! Integration tests for scene-render (P17 Track-B tier-1 CPU
//! rasterizer). All tests run the real compiled service — no GPU, no
//! external libraries, fully deterministic.

use ignition_core::{base64_encode, base64_decode, ErrorCode, FrameRequest};
use scene_render::SceneRenderService;
use serde_json::{json, Value};

// ---- Scene builders ----

fn f32b64(vals: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(vals.len() * 4);
    for v in vals {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    base64_encode(&bytes)
}

fn u32b64(vals: &[u32]) -> String {
    let mut bytes = Vec::with_capacity(vals.len() * 4);
    for v in vals {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    base64_encode(&bytes)
}

/// Default camera: perspective at (0,0,5) looking at origin, fov 60.
fn camera() -> Value {
    json!({
        "type": "perspective",
        "position": [0.0, 0.0, 5.0],
        "target": [0.0, 0.0, 0.0],
        "up": [0.0, 1.0, 0.0],
        "fov_y_degrees": 60.0,
        "near": 0.1,
        "far": 100.0,
    })
}

fn base_scene(width: u32, height: u32) -> Value {
    json!({
        "width": width,
        "height": height,
        "camera": camera(),
        "background": "#000000",
    })
}

/// Unlit red emission material — pixel-exact assertions without light
/// math in the way.
fn emission_material(rgb: [f32; 3]) -> Value {
    json!({ "emission": rgb, "roughness": 1.0 })
}

/// One non-indexed triangle in the z=0 plane. `order` gives the three
/// (x,y) pairs; winding determines front/back facing.
fn tri_mesh(order: &[[f32; 2]], z: f32, material: usize) -> Value {
    let mut pos = Vec::new();
    for p in order {
        pos.extend_from_slice(&[p[0], p[1], z]);
    }
    json!({
        "positions_b64": f32b64(&pos),
        "material": material,
    })
}

/// Front-facing (CCW from the camera) triangle covering the center.
fn front_tri(z: f32) -> Value {
    tri_mesh(&[[-1.0, -1.0], [1.0, -1.0], [0.0, 1.0]], z, 0)
}

fn call(svc: &SceneRenderService, id: u64, op: &str, payload: Value) -> Value {
    let res = svc.handle_frame(&FrameRequest {
        id,
        handle: 0,
        op: op.to_string(),
        payload,
    });
    assert!(res.ok, "op {op} failed: {:?}", res.error);
    res.data.unwrap()
}

fn call_err(svc: &SceneRenderService, op: &str, payload: Value) -> ErrorCode {
    let res = svc.handle_frame(&FrameRequest {
        id: 99,
        handle: 0,
        op: op.to_string(),
        payload,
    });
    assert!(!res.ok, "op {op} unexpectedly succeeded");
    res.error.unwrap().code
}

fn render_rgba(svc: &SceneRenderService, scene: Value) -> (u32, u32, Vec<u8>) {
    let data = call(svc, 1, "render", scene);
    assert_eq!(data["format"], "raw");
    let w = data["width"].as_u64().unwrap() as usize;
    let h = data["height"].as_u64().unwrap() as usize;
    let rgba = base64_decode(data["bytes_b64"].as_str().unwrap()).unwrap();
    assert_eq!(rgba.len(), w * h * 4);
    (w as u32, h as u32, rgba)
}

fn px(rgba: &[u8], w: usize, x: usize, y: usize) -> [u8; 4] {
    let i = (y * w + x) * 4;
    [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}

// ---- Tests ----

#[test]
fn describe_reports_tier1_bounds() {
    let svc = SceneRenderService::new();
    let data = call(&svc, 1, "describe", json!({}));
    assert_eq!(data["service"], "scene-render");
    assert_eq!(data["tier"], 1);
    assert_eq!(data["deterministic"], true);
    assert_eq!(data["bounds"]["max_triangles"], 1_000_000);
    assert!(data["deferred"].as_array().unwrap().len() > 0);
}

#[test]
fn single_triangle_renders_real_pixels_and_is_deterministic() {
    let svc = SceneRenderService::new();
    let mut scene = base_scene(64, 64);
    scene["materials"] = json!([emission_material([1.0, 0.0, 0.0])]);
    scene["meshes"] = json!([front_tri(0.0)]);

    let (w, h, rgba) = render_rgba(&svc, scene.clone());
    assert_eq!((w, h), (64, 64));
    // Center is covered by the triangle → opaque red.
    let c = px(&rgba, w as usize, 32, 32);
    assert_eq!(c, [255, 0, 0, 255]);
    // Corner is background → opaque black.
    let corner = px(&rgba, w as usize, 2, 2);
    assert_eq!(corner, [0, 0, 0, 255]);

    // Determinism: a fresh service produces byte-identical output.
    let svc2 = SceneRenderService::new();
    let data2 = call(&svc2, 1, "render", scene);
    let rgba2 = base64_decode(data2["bytes_b64"].as_str().unwrap()).unwrap();
    assert_eq!(rgba, rgba2);
}

#[test]
fn z_buffer_keeps_nearest_triangle_regardless_of_submission_order() {
    let svc = SceneRenderService::new();
    let mut scene = base_scene(64, 64);
    scene["materials"] = json!([
        emission_material([1.0, 0.0, 0.0]), // mat 0: red (near)
        emission_material([0.0, 0.0, 1.0]), // mat 1: blue (far)
    ]);
    // Far triangle submitted FIRST — order must not decide coverage.
    let far = tri_mesh(&[[-1.0, -1.0], [1.0, -1.0], [0.0, 1.0]], -1.0, 1);
    let near = tri_mesh(&[[-1.0, -1.0], [1.0, -1.0], [0.0, 1.0]], 1.0, 0);
    scene["meshes"] = json!([far, near]);
    let (_, _, rgba) = render_rgba(&svc, scene);
    assert_eq!(px(&rgba, 64, 32, 32), [255, 0, 0, 255]);
}

#[test]
fn backfaces_are_culled_unless_double_sided() {
    let svc = SceneRenderService::new();
    // Reversed winding → back face for the default camera.
    let back = tri_mesh(&[[-1.0, -1.0], [0.0, 1.0], [1.0, -1.0]], 0.0, 0);

    let mut scene = base_scene(64, 64);
    scene["materials"] = json!([emission_material([1.0, 0.0, 0.0])]);
    scene["meshes"] = json!([back]);
    let (_, _, rgba) = render_rgba(&svc, scene);
    assert_eq!(px(&rgba, 64, 32, 32), [0, 0, 0, 255], "backface must be culled");

    // Same geometry with double_sided → drawn.
    let mut scene2 = base_scene(64, 64);
    let mut m = emission_material([1.0, 0.0, 0.0]);
    m["double_sided"] = json!(true);
    scene2["materials"] = json!([m]);
    scene2["meshes"] = json!([back]);
    let (_, _, rgba2) = render_rgba(&svc, scene2);
    assert_eq!(px(&rgba2, 64, 32, 32), [255, 0, 0, 255]);
}

#[test]
fn orthographic_camera_renders_axis_aligned_geometry() {
    let svc = SceneRenderService::new();
    let mut scene = base_scene(64, 64);
    scene["camera"] = json!({
        "type": "orthographic",
        "position": [0.0, 0.0, 5.0],
        "target": [0.0, 0.0, 0.0],
        "up": [0.0, 1.0, 0.0],
        "half_height": 1.0,
        "near": 0.1,
        "far": 100.0,
    });
    scene["materials"] = json!([emission_material([0.0, 1.0, 0.0])]);
    scene["meshes"] = json!([front_tri(0.0)]);
    let (_, _, rgba) = render_rgba(&svc, scene);
    assert_eq!(px(&rgba, 64, 32, 32), [0, 255, 0, 255]);
}

#[test]
fn textured_material_samples_and_requires_uvs() {
    let svc = SceneRenderService::new();
    // 1x1 sRGB-red texture.
    let tex = json!({
        "width": 1,
        "height": 1,
        "format": "rgba8",
        "bytes_b64": base64_encode(&[255, 0, 0, 255]),
    });
    let mut scene = base_scene(64, 64);
    scene["textures"] = json!({ "t": tex });
    scene["materials"] = json!([{
        "color": [1.0, 1.0, 1.0],
        "texture": "t",
        "texture_filter": "nearest",
        "roughness": 1.0,
    }]);
    scene["lights"] = json!([{
        "type": "ambient",
        "color": [1.0, 1.0, 1.0],
        "intensity": 1.0,
    }]);
    // Quad with uvs covering [0,1]².
    let pos = [
        -1.0f32, -1.0, 0.0, 1.0, -1.0, 0.0, 1.0, 1.0, 0.0, -1.0, 1.0, 0.0,
    ];
    let uv = [0.0f32, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0];
    let mut mesh = json!({
        "positions_b64": f32b64(&pos),
        "uvs_b64": f32b64(&uv),
        "material": 0,
    });
    // Non-indexed needs verts % 3 == 0; 4 verts fails → use indices.
    let _ = &mut mesh;
    mesh["indices_b64"] = json!(u32b64(&[0, 1, 2, 0, 2, 3]));
    scene["meshes"] = json!([mesh]);
    let (_, _, rgba) = render_rgba(&svc, scene);
    let c = px(&rgba, 64, 32, 32);
    // sRGB red texture → linear → shade → sRGB: approximately red.
    assert!(c[0] > 200 && c[1] < 60 && c[2] < 60, "textured pixel was {c:?}");

    // Textured material on a mesh WITHOUT uvs must fail closed.
    let mut bad = base_scene(64, 64);
    bad["materials"] = json!([{
        "color": [1.0, 1.0, 1.0],
        "texture": "t",
    }]);
    bad["textures"] = json!({ "t": tex });
    bad["meshes"] = json!([front_tri(0.0)]);
    assert_eq!(
        call_err(&svc, "render", bad),
        ErrorCode::InvalidCommand,
        "textured material without uvs must reject"
    );
}

#[test]
fn directional_light_lambert_diffuse_and_facing() {
    let svc = SceneRenderService::new();
    // White diffuse material, no specular, no emission. The front
    // triangle's geometric normal points toward the camera (+z).
    let material = |roughness: f32| {
        json!({
            "color": [1.0, 1.0, 1.0],
            "specular": [0.0, 0.0, 0.0],
            "roughness": roughness,
        })
    };
    // Light traveling -z (from the camera toward the scene): L = +z,
    // N·L = 1 → full diffuse → white.
    let mut scene = base_scene(64, 64);
    scene["materials"] = json!([material(1.0)]);
    scene["lights"] = json!([{
        "type": "directional",
        "direction": [0.0, 0.0, -1.0],
        "color": [1.0, 1.0, 1.0],
        "intensity": 1.0,
    }]);
    scene["meshes"] = json!([front_tri(0.0)]);
    let (_, _, rgba) = render_rgba(&svc, scene);
    let lit = px(&rgba, 64, 32, 32);
    assert!(lit[0] > 200 && lit[1] > 200 && lit[2] > 200, "lit pixel {lit:?}");

    // Same light traveling +z (from behind the surface): N·L < 0 →
    // no diffuse → black.
    let mut scene2 = base_scene(64, 64);
    scene2["materials"] = json!([material(1.0)]);
    scene2["lights"] = json!([{
        "type": "directional",
        "direction": [0.0, 0.0, 1.0],
        "color": [1.0, 1.0, 1.0],
        "intensity": 1.0,
    }]);
    scene2["meshes"] = json!([front_tri(0.0)]);
    let (_, _, rgba2) = render_rgba(&svc, scene2);
    let dark = px(&rgba2, 64, 32, 32);
    assert!(dark[0] < 30 && dark[1] < 30 && dark[2] < 30, "unlit pixel {dark:?}");

    // Grazing light at 45°: N·L = cos45 ≈ 0.707 → mid gray.
    let mut scene3 = base_scene(64, 64);
    scene3["materials"] = json!([material(1.0)]);
    let inv = std::f32::consts::FRAC_1_SQRT_2;
    scene3["lights"] = json!([{
        "type": "directional",
        "direction": [0.0, 0.0, -1.0],
        "color": [1.0, 1.0, 1.0],
        "intensity": 1.0,
    }]);
    // Tilt the surface normal by using a light direction with a y
    // component instead: direction (0,-sin45,-cos45) normalized →
    // L=(0,sin45,cos45), N·L=cos45.
    scene3["lights"][0]["direction"] = json!([0.0, -inv, -inv]);
    scene3["meshes"] = json!([front_tri(0.0)]);
    let (_, _, rgba3) = render_rgba(&svc, scene3);
    let mid = px(&rgba3, 64, 32, 32);
    // linear 0.707 → sRGB ≈ 0.85 → ~217. Allow tolerance for
    // interpolation across the triangle.
    assert!(mid[0] > 180 && mid[0] < 245, "grazing pixel {mid:?}");
}

#[test]
fn png_format_produces_real_png_bytes() {
    let svc = SceneRenderService::new();
    let mut scene = base_scene(32, 32);
    scene["format"] = json!("png");
    scene["materials"] = json!([emission_material([0.0, 0.0, 1.0])]);
    scene["meshes"] = json!([front_tri(0.0)]);
    let data = call(&svc, 1, "render", scene);
    assert_eq!(data["format"], "png");
    let bytes = base64_decode(data["bytes_b64"].as_str().unwrap()).unwrap();
    assert_eq!(&bytes[0..8], b"\x89PNG\r\n\x1a\n");
}

#[test]
fn bounds_and_hostile_input_fail_closed() {
    let svc = SceneRenderService::new();

    // Zero and oversized dimensions.
    let mut s = base_scene(0, 64);
    assert_eq!(call_err(&svc, "render", s.clone()), ErrorCode::OutOfBounds);
    s = base_scene(5000, 64);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::OutOfBounds);
    // 4096x4096 RGBA = 64 MiB > 32 MiB decoded cap.
    s = base_scene(4096, 4096);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::OutOfBounds);

    // Missing camera.
    let mut s = base_scene(64, 64);
    s.as_object_mut().unwrap().remove("camera");
    assert_eq!(call_err(&svc, "render", s), ErrorCode::InvalidCommand);

    // Degenerate camera (position == target).
    let mut s = base_scene(64, 64);
    s["camera"]["target"] = json!([0.0, 0.0, 5.0]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::InvalidCommand);

    // Non-finite vertex data (NaN f32).
    let mut s = base_scene(64, 64);
    s["materials"] = json!([emission_material([1.0, 0.0, 0.0])]);
    s["meshes"] = json!([{
        "positions_b64": f32b64(&[f32::NAN, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
    }]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::InvalidCommand);

    // Index out of range.
    let mut s = base_scene(64, 64);
    s["materials"] = json!([emission_material([1.0, 0.0, 0.0])]);
    s["meshes"] = json!([{
        "positions_b64": f32b64(&[-1.0, -1.0, 0.0, 1.0, -1.0, 0.0, 0.0, 1.0, 0.0]),
        "indices_b64": u32b64(&[0, 1, 7]),
    }]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::OutOfBounds);

    // Bad base64.
    let mut s = base_scene(64, 64);
    s["materials"] = json!([emission_material([1.0, 0.0, 0.0])]);
    s["meshes"] = json!([{ "positions_b64": "!!!not-base64!!!" }]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::InvalidCommand);

    // Material index out of range.
    let mut s = base_scene(64, 64);
    s["materials"] = json!([emission_material([1.0, 0.0, 0.0])]);
    let mut m = front_tri(0.0);
    m["material"] = json!(9);
    s["meshes"] = json!([m]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::OutOfBounds);

    // Texture byte-length mismatch.
    let mut s = base_scene(64, 64);
    s["textures"] = json!({
        "t": { "width": 2, "height": 2, "bytes_b64": base64_encode(&[0u8; 4]) }
    });
    s["materials"] = json!([{
        "color": [1.0, 1.0, 1.0], "texture": "t"
    }]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::InvalidCommand);

    // Unknown light type.
    let mut s = base_scene(64, 64);
    s["lights"] = json!([{ "type": "spot", "position": [0.0, 0.0, 0.0] }]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::InvalidCommand);

    // Unknown op.
    assert_eq!(
        call_err(&svc, "bogusOp", json!({})),
        ErrorCode::InvalidCommand
    );
}

#[test]
fn triangle_budget_rejects_over_cap_scenes() {
    let svc = SceneRenderService::new();
    let mut s = base_scene(64, 64);
    s["materials"] = json!([emission_material([1.0, 0.0, 0.0])]);
    // One mesh, 3 vertices, indices covering 1,000,001 triangles —
    // over the MAX_TRIANGLES cap. Rejected at parse, before raster.
    let n = scene_render::MAX_TRIANGLES + 1;
    let indices: Vec<u32> = (0..(n * 3) as u32).map(|i| i % 3).collect();
    s["meshes"] = json!([{
        "positions_b64": f32b64(&[-1.0, -1.0, 0.0, 1.0, -1.0, 0.0, 0.0, 1.0, 0.0]),
        "indices_b64": u32b64(&indices),
    }]);
    assert_eq!(call_err(&svc, "render", s), ErrorCode::OutOfBounds);
}

#[test]
fn stdio_wire_protocol_roundtrip() {
    // Drive the real binary end-to-end: describe + render + error.
    let bin = env!("CARGO_BIN_EXE_scene-render");
    let mut child = std::process::Command::new(bin)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn scene-render");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();
    use std::io::{BufRead, BufReader, Write};
    let mut lines = BufReader::new(&mut stdout).lines();

    let mut scene = base_scene(16, 16);
    scene["materials"] = json!([emission_material([1.0, 1.0, 1.0])]);
    scene["meshes"] = json!([front_tri(0.0)]);

    for (id, op, payload) in [
        (1u64, "describe", json!({})),
        (2u64, "render", scene),
        (3u64, "render", json!({ "width": 0 })),
    ] {
        writeln!(
            stdin,
            "{}",
            json!({ "id": id, "handle": 0, "op": op, "payload": payload })
        )
        .unwrap();
        stdin.flush().unwrap();
        let line = lines.next().unwrap().unwrap();
        let res: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(res["id"], id);
        match id {
            1 => assert_eq!(res["ok"], true),
            2 => {
                assert_eq!(res["ok"], true);
                assert_eq!(res["data"]["format"], "raw");
            }
            3 => assert_eq!(res["ok"], false),
            _ => unreachable!(),
        }
    }
    drop(stdin);
    let status = child.wait().unwrap();
    assert!(status.success());
}
