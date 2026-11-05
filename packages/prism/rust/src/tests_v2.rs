//! Op-level tests for the canvas/layers surface (ops.rs). Every mutating op
//! is checked for: the effect, exactly one undo step (undo restores the
//! prior `describe`, redo re-applies it), and rejection paths that leave
//! both the document and the journal untouched.

use ignition_core::{Command, Engine, ErrorCode};
use serde_json::{json, Value};

use crate::b64;
use crate::PrismEngine;

fn eng(w: u32, h: u32) -> PrismEngine {
    PrismEngine::new(w, h)
}

fn run(e: &mut PrismEngine, op: &str, p: Value) -> Value {
    e.apply(Command::new(op, p)).unwrap_or_else(|err| panic!("{op} failed: {err:?}")).data
}

fn describe(e: &mut PrismEngine) -> Value {
    run(e, "describe", json!({}))
}

fn id(v: &Value) -> u64 {
    v["layer_id"].as_u64().or_else(|| v["artboard_id"].as_u64()).expect("id in result")
}

/// Applies `op`, checks it changed the document, and that a single undo
/// restores the prior state and redo restores the new one.
fn one_step(e: &mut PrismEngine, op: &str, p: Value) -> Value {
    let before = describe(e);
    let depth = e.journal.undo_len();
    let out = run(e, op, p);
    let after = describe(e);
    assert_ne!(before, after, "{op} changed nothing");
    assert_eq!(e.journal.undo_len(), depth + 1, "{op} must record exactly one undo step");
    assert!(e.undo().unwrap());
    assert_eq!(describe(e), before, "{op} undo");
    assert!(e.redo().unwrap());
    assert_eq!(describe(e), after, "{op} redo");
    out
}

fn rejects(e: &mut PrismEngine, op: &str, p: Value, code: ErrorCode) {
    let before = describe(e);
    let depth = e.journal.undo_len();
    let err = e.apply(Command::new(op, p.clone())).expect_err(&format!("{op} {p} should fail"));
    assert_eq!(err.code, code, "{op} {p}: {}", err.message);
    assert_eq!(describe(e), before, "{op} must not mutate on error");
    assert_eq!(e.journal.undo_len(), depth, "{op} must not record on error");
}

fn layer<'a>(d: &'a Value, lid: u64) -> &'a Value {
    d["layers"].as_array().unwrap().iter().find(|l| l["id"] == lid).expect("layer")
}

fn rect(e: &mut PrismEngine, x: f64, y: f64, w: f64, h: f64, fill: [u8; 4]) -> u64 {
    id(&run(e, "addShape", json!({"shape": {"kind": "rect", "x": x, "y": y, "w": w, "h": h, "fill": fill}})))
}

fn flat(e: &mut PrismEngine) -> Vec<u8> {
    b64::decode(run(e, "flatten", json!({}))["pixels_b64"].as_str().unwrap()).unwrap()
}

fn px(buf: &[u8], w: usize, x: usize, y: usize) -> [u8; 4] {
    let o = (y * w + x) * 4;
    [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]
}

fn bounds(e: &mut PrismEngine, lid: u64) -> (f64, f64, f64, f64) {
    let b = &run(e, "layerBounds", json!({"ids": [lid]}))["bounds"][0];
    (b["x"].as_f64().unwrap(), b["y"].as_f64().unwrap(), b["w"].as_f64().unwrap(), b["h"].as_f64().unwrap())
}

fn selection_mask(e: &mut PrismEngine) -> Option<Vec<u8>> {
    let s = run(e, "getSelection", json!({}));
    s["mask_b64"].as_str().map(|m| b64::decode(m).unwrap())
}

const RED: [u8; 4] = [255, 0, 0, 255];
const BLUE: [u8; 4] = [0, 0, 255, 255];

// -- transform ---------------------------------------------------------------

#[test]
fn set_layer_transform_moves_pixels_and_bounds() {
    let mut e = eng(8, 8);
    let r = rect(&mut e, 0.0, 0.0, 2.0, 2.0, RED);
    one_step(&mut e, "setLayerTransform", json!({"id": r, "transform": {"tx": 3, "ty": 4}}));
    assert_eq!(bounds(&mut e, r), (3.0, 4.0, 2.0, 2.0));
    let f = flat(&mut e);
    assert_eq!(px(&f, 8, 3, 4), RED);
    assert_eq!(px(&f, 8, 0, 0), [0, 0, 0, 0]);
    rejects(&mut e, "setLayerTransform", json!({"id": r, "transform": {"sx": 0}}), ErrorCode::Validation);
    rejects(&mut e, "setLayerTransform", json!({"id": r, "transform": 5}), ErrorCode::InvalidCommand);
    rejects(&mut e, "setLayerTransform", json!({"id": 99, "transform": {}}), ErrorCode::NotFound);
}

#[test]
fn rotation_turns_raster_content() {
    let mut e = eng(9, 9);
    let l = id(&run(&mut e, "addRasterLayer", json!({})));
    // 1x3 vertical bar centered at (4,4) → rotate 90° about the center.
    let data = RED.repeat(3);
    run(&mut e, "drawPixels", json!({"id": l, "x": 4, "y": 3, "w": 1, "h": 3, "data_b64": b64::encode(&data)}));
    run(&mut e, "setTransformOrigin", json!({"id": l, "ox": 4.5, "oy": 4.5}));
    one_step(&mut e, "setLayerTransform", json!({"id": l, "transform": {"rotation": 90}}));
    let f = flat(&mut e);
    assert_eq!(px(&f, 9, 3, 4)[3], 255, "bar is now horizontal");
    assert_eq!(px(&f, 9, 5, 4)[3], 255);
    assert_eq!(px(&f, 9, 4, 3)[3], 0);
}

#[test]
fn transform_origin_keeps_rendering_fixed() {
    let mut e = eng(16, 16);
    let r = rect(&mut e, 2.0, 2.0, 4.0, 2.0, RED);
    run(&mut e, "setLayerTransform", json!({"id": r, "transform": {"rotation": 30, "sx": 1.5}}));
    let before = flat(&mut e);
    let b0 = bounds(&mut e, r);
    one_step(&mut e, "setTransformOrigin", json!({"id": r, "ox": 4, "oy": 3}));
    assert_eq!(flat(&mut e), before);
    let b1 = bounds(&mut e, r);
    assert!((b0.0 - b1.0).abs() < 1e-9 && (b0.1 - b1.1).abs() < 1e-9);
    // Rotating about the new pivot keeps the pivot's canvas position.
    let t = layer(&describe(&mut e), r)["transform"].clone();
    assert_eq!(t["ox"], 4.0);
}

#[test]
fn translate_layers_moves_many_in_one_step() {
    let mut e = eng(10, 10);
    let a = rect(&mut e, 0.0, 0.0, 1.0, 1.0, RED);
    let b = rect(&mut e, 2.0, 0.0, 1.0, 1.0, BLUE);
    one_step(&mut e, "translateLayers", json!({"ids": [a, b], "dx": 1, "dy": 2}));
    assert_eq!(bounds(&mut e, a).0, 1.0);
    assert_eq!(bounds(&mut e, b), (3.0, 2.0, 1.0, 1.0));
    rejects(&mut e, "translateLayers", json!({"ids": [a, a], "dx": 1, "dy": 0}), ErrorCode::Validation);
    rejects(&mut e, "translateLayers", json!({"ids": [], "dx": 1, "dy": 0}), ErrorCode::Validation);
    rejects(&mut e, "translateLayers", json!({"ids": [a, 77], "dx": 1, "dy": 0}), ErrorCode::NotFound);
}

#[test]
fn hit_test_finds_topmost_and_leaf() {
    let mut e = eng(10, 10);
    let a = rect(&mut e, 0.0, 0.0, 5.0, 5.0, RED);
    let b = rect(&mut e, 3.0, 3.0, 5.0, 5.0, BLUE);
    assert_eq!(run(&mut e, "hitTest", json!({"x": 4, "y": 4}))["layer_id"], b);
    assert_eq!(run(&mut e, "hitTest", json!({"x": 1, "y": 1}))["layer_id"], a);
    assert_eq!(run(&mut e, "hitTest", json!({"x": 9, "y": 0}))["layer_id"], Value::Null);
    let g = id(&run(&mut e, "groupLayers", json!({"ids": [a, b]})));
    let h = run(&mut e, "hitTest", json!({"x": 1, "y": 1}));
    assert_eq!((h["top_level_id"].as_u64(), h["layer_id"].as_u64()), (Some(g), Some(a)));
}

#[test]
fn align_and_distribute() {
    let mut e = eng(40, 20);
    let a = rect(&mut e, 0.0, 0.0, 2.0, 2.0, RED);
    let b = rect(&mut e, 5.0, 4.0, 4.0, 2.0, RED);
    let c = rect(&mut e, 30.0, 8.0, 2.0, 2.0, RED);
    one_step(&mut e, "alignLayers", json!({"ids": [a, b, c], "align": "top"}));
    for l in [a, b, c] {
        assert_eq!(bounds(&mut e, l).1, 0.0);
    }
    one_step(&mut e, "alignLayers", json!({"ids": [a], "align": "right", "to": "canvas"}));
    assert_eq!(bounds(&mut e, a).0, 38.0);
    run(&mut e, "alignLayers", json!({"ids": [a], "align": "left", "to": "canvas"}));
    // Spacing: span 0..32, sizes 2+4+2 → gap 12; b goes to 14.
    one_step(&mut e, "distributeLayers", json!({"ids": [a, b, c], "axis": "horizontal"}));
    assert_eq!(bounds(&mut e, b).0, 14.0);
    one_step(&mut e, "distributeLayers", json!({"ids": [a, b, c], "axis": "horizontal", "spacing": 1}));
    assert_eq!(bounds(&mut e, b).0, 3.0);
    assert_eq!(bounds(&mut e, c).0, 8.0);
    rejects(&mut e, "alignLayers", json!({"ids": [a], "align": "top"}), ErrorCode::Validation);
    rejects(&mut e, "alignLayers", json!({"ids": [a, b], "align": "middle"}), ErrorCode::Validation);
    rejects(&mut e, "distributeLayers", json!({"ids": [a, b], "axis": "horizontal"}), ErrorCode::Validation);
    let art = id(&run(&mut e, "addArtboard", json!({"x": 20, "y": 10, "w": 10, "h": 10})));
    run(&mut e, "alignLayers", json!({"ids": [a], "align": "bottom", "to": {"artboard": art}}));
    assert_eq!(bounds(&mut e, a).1, 18.0);
}

// -- selection ---------------------------------------------------------------

#[test]
fn object_selection_modes() {
    let mut e = eng(4, 4);
    let a = rect(&mut e, 0.0, 0.0, 1.0, 1.0, RED);
    let b = rect(&mut e, 1.0, 0.0, 1.0, 1.0, RED);
    one_step(&mut e, "selectLayers", json!({"ids": [a]}));
    one_step(&mut e, "selectLayers", json!({"ids": [b], "mode": "add"}));
    assert_eq!(describe(&mut e)["selected"], json!([a, b]));
    one_step(&mut e, "selectLayers", json!({"ids": [a], "mode": "toggle"}));
    assert_eq!(describe(&mut e)["selected"], json!([b]));
    run(&mut e, "removeLayer", json!({"id": b}));
    assert_eq!(describe(&mut e)["selected"], json!([]), "removal prunes the selection");
    rejects(&mut e, "selectLayers", json!({"ids": [a], "mode": "xor"}), ErrorCode::Validation);
}

#[test]
fn region_selection_combines() {
    let mut e = eng(8, 8);
    one_step(&mut e, "selectRegion", json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 4, "h": 4}}));
    one_step(
        &mut e,
        "selectRegion",
        json!({"shape": {"kind": "rect", "x": 2, "y": 2, "w": 4, "h": 4}, "mode": "subtract"}),
    );
    let m = selection_mask(&mut e).unwrap();
    assert_eq!(m[0], 255);
    assert_eq!(m[3 * 8 + 3], 0);
    one_step(
        &mut e,
        "selectRegion",
        json!({"shape": {"kind": "polygon", "points": [[4, 4], [8, 4], [8, 8]]}, "mode": "add"}),
    );
    assert_eq!(selection_mask(&mut e).unwrap()[5 * 8 + 7], 255);
    let s = run(&mut e, "getSelection", json!({}));
    assert_eq!(s["bounds"]["x"], 0);
    rejects(&mut e, "selectRegion", json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 0, "h": 4}}), ErrorCode::Validation);
    rejects(&mut e, "selectRegion", json!({"shape": {"kind": "polygon", "points": [[0, 0], [1, 1]]}}), ErrorCode::Validation);
    rejects(&mut e, "selectRegion", json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1}, "mode": "or"}), ErrorCode::Validation);
    rejects(&mut e, "selectRegion", json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1}, "feather": 999}), ErrorCode::Validation);
}

#[test]
fn select_all_invert_deselect() {
    let mut e = eng(4, 4);
    assert_eq!(run(&mut e, "getSelection", json!({}))["empty"], true);
    one_step(&mut e, "selectAll", json!({}));
    one_step(&mut e, "invertSelection", json!({}));
    assert_eq!(run(&mut e, "getSelection", json!({}))["empty"], true, "inverting everything selects nothing");
    one_step(&mut e, "invertSelection", json!({}));
    one_step(&mut e, "deselect", json!({}));
    let depth = e.journal.undo_len();
    run(&mut e, "deselect", json!({}));
    assert_eq!(e.journal.undo_len(), depth, "deselecting nothing is not an undo step");
}

#[test]
fn magic_wand_and_modify_selection() {
    let mut e = eng(8, 8);
    let bg = id(&run(&mut e, "addRasterLayer", json!({})));
    run(&mut e, "fillLayer", json!({"id": bg, "color": BLUE}));
    rect(&mut e, 2.0, 2.0, 3.0, 3.0, RED);
    one_step(&mut e, "magicWand", json!({"x": 3, "y": 3, "tolerance": 0}));
    let m = selection_mask(&mut e).unwrap();
    assert_eq!(m.iter().filter(|&&v| v == 255).count(), 9);
    one_step(&mut e, "modifySelection", json!({"op": "grow", "radius": 1}));
    assert_eq!(selection_mask(&mut e).unwrap()[3 * 8 + 1], 255);
    one_step(&mut e, "modifySelection", json!({"op": "shrink", "radius": 1}));
    one_step(&mut e, "modifySelection", json!({"op": "feather", "radius": 3}));
    // Wand on the raster layer alone ignores the red shape above.
    run(&mut e, "magicWand", json!({"x": 3, "y": 3, "tolerance": 0, "sample": {"layer": bg}}));
    assert_eq!(selection_mask(&mut e).unwrap().iter().filter(|&&v| v == 255).count(), 64);
    run(&mut e, "deselect", json!({}));
    rejects(&mut e, "modifySelection", json!({"op": "grow", "radius": 1}), ErrorCode::Validation);
    rejects(&mut e, "magicWand", json!({"x": 8, "y": 0}), ErrorCode::OutOfBounds);
    rejects(&mut e, "magicWand", json!({"x": 1, "y": 1, "tolerance": 300}), ErrorCode::Validation);
}

// -- groups, lock, blend, clipping -------------------------------------------

#[test]
fn group_and_ungroup_preserve_render() {
    let mut e = eng(10, 10);
    let a = rect(&mut e, 0.0, 0.0, 3.0, 3.0, RED);
    let b = rect(&mut e, 2.0, 2.0, 3.0, 3.0, BLUE);
    let before = flat(&mut e);
    let g = id(&one_step(&mut e, "groupLayers", json!({"ids": [a, b], "name": "pair"})));
    assert_eq!(flat(&mut e), before);
    let d = describe(&mut e);
    assert_eq!(layer(&d, a)["parent"], g);
    assert_eq!(layer(&d, g)["content"]["type"], "group");
    run(&mut e, "setLayerTransform", json!({"id": g, "transform": {"tx": 2, "ty": 1}}));
    assert_eq!(bounds(&mut e, a), (2.0, 1.0, 3.0, 3.0));
    let moved = flat(&mut e);
    one_step(&mut e, "ungroupLayer", json!({"id": g}));
    assert_eq!(flat(&mut e), moved, "ungroup bakes the group transform");
    let d = describe(&mut e);
    assert_eq!(layer(&d, a)["parent"], Value::Null);
    let ids: Vec<u64> = d["layers"].as_array().unwrap().iter().map(|l| l["id"].as_u64().unwrap()).collect();
    assert_eq!(ids, vec![a, b], "children keep their order in the group's place");
}

#[test]
fn group_requires_siblings_and_set_parent_rules() {
    let mut e = eng(6, 6);
    let a = rect(&mut e, 0.0, 0.0, 1.0, 1.0, RED);
    let b = rect(&mut e, 1.0, 0.0, 1.0, 1.0, RED);
    let c = rect(&mut e, 2.0, 0.0, 1.0, 1.0, RED);
    let g = id(&run(&mut e, "groupLayers", json!({"ids": [a, b]})));
    rejects(&mut e, "groupLayers", json!({"ids": [a, c]}), ErrorCode::Validation);
    rejects(&mut e, "setLayerParent", json!({"id": g, "parent": a}), ErrorCode::Validation);
    rejects(&mut e, "setLayerParent", json!({"id": g, "parent": g}), ErrorCode::Validation);
    one_step(&mut e, "setLayerParent", json!({"id": c, "parent": g}));
    assert_eq!(layer(&describe(&mut e), c)["parent"], g);
    one_step(&mut e, "setLayerParent", json!({"id": c, "parent": null}));
    rejects(&mut e, "ungroupLayer", json!({"id": c}), ErrorCode::Validation);
    // Removing a group removes its subtree.
    run(&mut e, "removeLayer", json!({"id": g}));
    assert_eq!(describe(&mut e)["layers"].as_array().unwrap().len(), 1);
}

#[test]
fn set_parent_keeps_visual_position() {
    let mut e = eng(12, 12);
    let a = rect(&mut e, 0.0, 0.0, 2.0, 2.0, RED);
    let b = rect(&mut e, 6.0, 6.0, 2.0, 2.0, BLUE);
    let g = id(&run(&mut e, "groupLayers", json!({"ids": [a]})));
    run(&mut e, "setLayerTransform", json!({"id": g, "transform": {"tx": 3, "ty": 3}}));
    let before = bounds(&mut e, b);
    run(&mut e, "setLayerParent", json!({"id": b, "parent": g}));
    let after = bounds(&mut e, b);
    assert!((before.0 - after.0).abs() < 1e-9 && (before.1 - after.1).abs() < 1e-9);
}

#[test]
fn locked_layers_refuse_edits() {
    let mut e = eng(4, 4);
    let r = id(&run(&mut e, "addRasterLayer", json!({})));
    let s = rect(&mut e, 0.0, 0.0, 1.0, 1.0, RED);
    one_step(&mut e, "setLayerLocked", json!({"id": r, "locked": true}));
    rejects(&mut e, "fillLayer", json!({"id": r, "color": RED}), ErrorCode::Validation);
    rejects(&mut e, "removeLayer", json!({"id": r}), ErrorCode::Validation);
    rejects(&mut e, "setLayerOpacity", json!({"id": r, "opacity": 0.5}), ErrorCode::Validation);
    rejects(&mut e, "setLayerTransform", json!({"id": r, "transform": {"tx": 1}}), ErrorCode::Validation);
    rejects(&mut e, "setLayerBlend", json!({"id": r, "blend": "multiply"}), ErrorCode::Validation);
    rejects(&mut e, "addMask", json!({"id": r}), ErrorCode::Validation);
    // Rename and visibility stay allowed.
    run(&mut e, "renameLayer", json!({"id": r, "name": "bg"}));
    run(&mut e, "setLayerVisible", json!({"id": r, "visible": false}));
    // A locked group locks its children.
    let g = id(&run(&mut e, "groupLayers", json!({"ids": [s]})));
    run(&mut e, "setLayerLocked", json!({"id": g, "locked": true}));
    rejects(&mut e, "translateLayers", json!({"ids": [s], "dx": 1, "dy": 0}), ErrorCode::Validation);
    run(&mut e, "setLayerLocked", json!({"id": g, "locked": false}));
    run(&mut e, "translateLayers", json!({"ids": [s], "dx": 1, "dy": 0}));
}

#[test]
fn blend_modes_render() {
    let mut e = eng(1, 1);
    let bottom = id(&run(&mut e, "addRasterLayer", json!({})));
    run(&mut e, "fillLayer", json!({"id": bottom, "color": [200, 100, 50, 255]}));
    let top = id(&run(&mut e, "addRasterLayer", json!({})));
    run(&mut e, "fillLayer", json!({"id": top, "color": [128, 255, 0, 255]}));
    one_step(&mut e, "setLayerBlend", json!({"id": top, "blend": "multiply"}));
    // 200*128/255=100.4→100, 100*1=100, 50*0=0
    assert_eq!(px(&flat(&mut e), 1, 0, 0), [100, 100, 0, 255]);
    run(&mut e, "setLayerBlend", json!({"id": top, "blend": "screen"}));
    assert_eq!(px(&flat(&mut e), 1, 0, 0), [228, 255, 50, 255]);
    run(&mut e, "setLayerBlend", json!({"id": top, "blend": "difference"}));
    assert_eq!(px(&flat(&mut e), 1, 0, 0), [72, 155, 50, 255]);
    rejects(&mut e, "setLayerBlend", json!({"id": top, "blend": "hue-shift"}), ErrorCode::Validation);
    assert_eq!(layer(&describe(&mut e), top)["blend"], "difference");
}

#[test]
fn clipping_masks_to_base_alpha() {
    let mut e = eng(6, 1);
    let base = rect(&mut e, 0.0, 0.0, 3.0, 1.0, RED);
    let top = id(&run(&mut e, "addRasterLayer", json!({})));
    run(&mut e, "fillLayer", json!({"id": top, "color": BLUE}));
    rejects(&mut e, "setClipped", json!({"id": base, "clipped": true}), ErrorCode::Validation);
    one_step(&mut e, "setClipped", json!({"id": top, "clipped": true}));
    let f = flat(&mut e);
    assert_eq!(px(&f, 6, 1, 0), BLUE, "inside the base the clipped layer shows");
    assert_eq!(px(&f, 6, 4, 0), [0, 0, 0, 0], "outside the base it is clipped away");
    run(&mut e, "setLayerVisible", json!({"id": base, "visible": false}));
    assert!(flat(&mut e).iter().all(|&v| v == 0), "hiding the base hides its clip run");
}

// -- thumbnails --------------------------------------------------------------

#[test]
fn thumbnails_and_region_render() {
    let mut e = eng(100, 50);
    let r = rect(&mut e, 0.0, 0.0, 50.0, 50.0, RED);
    let t = run(&mut e, "layerThumbnail", json!({"id": r, "max": 20}));
    assert_eq!((t["width"].as_u64(), t["height"].as_u64()), (Some(20), Some(10)));
    let p = b64::decode(t["pixels_b64"].as_str().unwrap()).unwrap();
    assert_eq!(px(&p, 20, 2, 2), RED);
    assert_eq!(px(&p, 20, 15, 2), [0, 0, 0, 0]);
    let region = run(&mut e, "renderRegion", json!({"x": 40, "y": 0, "w": 20, "h": 10, "max": 64}));
    assert_eq!(region["width"], 20);
    let rp = b64::decode(region["pixels_b64"].as_str().unwrap()).unwrap();
    assert_eq!(px(&rp, 20, 0, 0), RED);
    assert_eq!(px(&rp, 20, 19, 0), [0, 0, 0, 0]);
    rejects(&mut e, "layerThumbnail", json!({"id": r, "max": 0}), ErrorCode::Validation);
    rejects(&mut e, "renderRegion", json!({"x": 0, "y": 0, "w": -1, "h": 2, "max": 4}), ErrorCode::Validation);
}

// -- masks ---------------------------------------------------------------------

#[test]
fn mask_lifecycle() {
    let mut e = eng(4, 1);
    let l = id(&run(&mut e, "addRasterLayer", json!({})));
    run(&mut e, "fillLayer", json!({"id": l, "color": RED}));
    rejects(&mut e, "addMask", json!({"id": l, "fill": "selection"}), ErrorCode::Validation);
    one_step(&mut e, "addMask", json!({"id": l, "fill": "reveal"}));
    rejects(&mut e, "addMask", json!({"id": l}), ErrorCode::Validation);
    one_step(&mut e, "paintMask", json!({"id": l, "x": 0, "y": 0, "w": 2, "h": 1, "data_b64": b64::encode(&[0, 0])}));
    let f = flat(&mut e);
    assert_eq!(px(&f, 4, 0, 0)[3], 0);
    assert_eq!(px(&f, 4, 3, 0), RED);
    one_step(&mut e, "invertMask", json!({"id": l}));
    assert_eq!(px(&flat(&mut e), 4, 0, 0), RED);
    one_step(&mut e, "setMaskEnabled", json!({"id": l, "enabled": false}));
    assert_eq!(px(&flat(&mut e), 4, 3, 0), RED);
    run(&mut e, "setMaskEnabled", json!({"id": l, "enabled": true}));
    let t = run(&mut e, "maskThumbnail", json!({"id": l, "max": 4}));
    let tp = b64::decode(t["pixels_b64"].as_str().unwrap()).unwrap();
    assert_eq!(px(&tp, 4, 0, 0), [255, 255, 255, 255], "thumbnail shows the inverted mask");
    one_step(&mut e, "refineMask", json!({"id": l, "feather": 1, "grow": 0}));
    one_step(&mut e, "removeMask", json!({"id": l, "apply": true}));
    let d = describe(&mut e);
    assert_eq!(layer(&d, l)["mask"], Value::Null);
    let raw = b64::decode(layer(&d, l)["content"]["pixels_b64"].as_str().unwrap()).unwrap();
    assert!(raw[3] > 0 && raw[15] < 255, "applied mask changed raster alpha");
    rejects(&mut e, "invertMask", json!({"id": l}), ErrorCode::Validation);
    let s = rect(&mut e, 0.0, 0.0, 1.0, 1.0, RED);
    run(&mut e, "addMask", json!({"id": s}));
    rejects(&mut e, "removeMask", json!({"id": s, "apply": true}), ErrorCode::Validation);
}

#[test]
fn mask_from_selection_and_resize() {
    let mut e = eng(4, 4);
    let l = id(&run(&mut e, "addRasterLayer", json!({})));
    run(&mut e, "selectRegion", json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 2, "h": 2}}));
    run(&mut e, "addMask", json!({"id": l, "fill": "selection"}));
    run(&mut e, "resize", json!({"width": 6, "height": 3}));
    let d = describe(&mut e);
    let mask = b64::decode(layer(&d, l)["mask"]["mask_b64"].as_str().unwrap()).unwrap();
    assert_eq!(mask.len(), 18);
    assert_eq!(mask[0], 255);
    let sel = b64::decode(d["selection_b64"].as_str().unwrap()).unwrap();
    assert_eq!(sel.len(), 18);
}

// -- artboards -----------------------------------------------------------------

#[test]
fn artboard_lifecycle() {
    let mut e = eng(20, 10);
    rect(&mut e, 10.0, 0.0, 10.0, 10.0, BLUE);
    let a = id(&one_step(&mut e, "addArtboard", json!({"x": 0, "y": 0, "w": 10, "h": 10})));
    let b = id(&one_step(&mut e, "addArtboard", json!({"name": "Back", "x": 10, "y": 0, "w": 10, "h": 10})));
    assert_eq!(describe(&mut e)["artboards"][0]["name"], "Artboard 1");
    one_step(&mut e, "updateArtboard", json!({"id": a, "name": "Front", "w": 8}));
    one_step(&mut e, "moveArtboard", json!({"id": b, "to_index": 0}));
    assert_eq!(describe(&mut e)["artboards"][0]["id"], b);
    let t = run(&mut e, "artboardThumbnail", json!({"id": b, "max": 5}));
    let tp = b64::decode(t["pixels_b64"].as_str().unwrap()).unwrap();
    assert_eq!(px(&tp, 5, 2, 2), BLUE);
    one_step(&mut e, "removeArtboard", json!({"id": a}));
    rejects(&mut e, "updateArtboard", json!({"id": b, "w": 0}), ErrorCode::Validation);
    rejects(&mut e, "moveArtboard", json!({"id": b, "to_index": 3}), ErrorCode::OutOfBounds);
    rejects(&mut e, "removeArtboard", json!({"id": 999}), ErrorCode::NotFound);
    // Layer and artboard ids come from one counter.
    let l = id(&run(&mut e, "addRasterLayer", json!({})));
    assert!(l > b);
}

// -- vector ----------------------------------------------------------------------

fn tri() -> Value {
    json!({"subpaths": [{"closed": true, "nodes": [
        {"x": 1, "y": 1}, {"x": 9, "y": 1}, {"x": 1, "y": 9}
    ]}]})
}

#[test]
fn add_path_renders_fill_and_stroke() {
    let mut e = eng(10, 10);
    let p = id(&one_step(&mut e, "addPath", json!({"path": tri(), "fill": {"type": "solid", "color": RED}})));
    let f = flat(&mut e);
    assert_eq!(px(&f, 10, 2, 2), RED);
    assert_eq!(px(&f, 10, 8, 8), [0, 0, 0, 0]);
    one_step(
        &mut e,
        "setStroke",
        json!({"id": p, "stroke": {"paint": {"type": "solid", "color": BLUE}, "width": 2, "join": "round"}}),
    );
    assert_eq!(px(&flat(&mut e), 10, 4, 1), BLUE, "stroke paints over the edge");
    one_step(&mut e, "setPaintOrder", json!({"id": p, "order": "stroke-fill"}));
    assert_eq!(px(&flat(&mut e), 10, 4, 1)[0], 255, "fill now on top of the inner half");
    one_step(&mut e, "setFillRule", json!({"id": p, "rule": "evenodd"}));
    rejects(&mut e, "addPath", json!({"path": {"subpaths": []}}), ErrorCode::Validation);
    rejects(&mut e, "addPath", json!({"path": {"subpaths": [{"nodes": [{"x": "a"}]}]}}), ErrorCode::InvalidCommand);
    rejects(
        &mut e,
        "setStroke",
        json!({"id": p, "stroke": {"paint": {"type": "solid", "color": BLUE}, "width": 0}}),
        ErrorCode::Validation,
    );
    rejects(
        &mut e,
        "setStroke",
        json!({"id": p, "stroke": {"paint": {"type": "solid", "color": BLUE}, "width": 1, "dash": [0, 0]}}),
        ErrorCode::Validation,
    );
}

#[test]
fn path_node_edits() {
    let mut e = eng(10, 10);
    let p = id(&run(&mut e, "addPath", json!({"path": tri(), "fill": {"type": "solid", "color": RED}})));
    one_step(&mut e, "setPathNode", json!({"id": p, "subpath": 0, "index": 2, "node": {"x": 9, "y": 9}}));
    one_step(&mut e, "insertPathNode", json!({"id": p, "subpath": 0, "index": 3, "node": {"x": 1, "y": 9}}));
    let nodes = layer(&describe(&mut e), p)["content"]["path"]["subpaths"][0]["nodes"].clone();
    assert_eq!(nodes.as_array().unwrap().len(), 4);
    assert_eq!(px(&flat(&mut e), 10, 2, 7), RED, "the square is filled now");
    one_step(&mut e, "setNodeKind", json!({"id": p, "subpath": 0, "index": 1, "kind": "smooth"}));
    let n1 = layer(&describe(&mut e), p)["content"]["path"]["subpaths"][0]["nodes"][1].clone();
    let (i, o) = (n1["in"].as_array().unwrap().clone(), n1["out"].as_array().unwrap().clone());
    let cross = i[0].as_f64().unwrap() * o[1].as_f64().unwrap() - i[1].as_f64().unwrap() * o[0].as_f64().unwrap();
    assert!(cross.abs() < 1e-9, "smooth handles are collinear");
    one_step(&mut e, "setNodeKind", json!({"id": p, "subpath": 0, "index": 1, "kind": "symmetric"}));
    one_step(&mut e, "removePathNode", json!({"id": p, "subpath": 0, "index": 3}));
    one_step(&mut e, "setSubpathClosed", json!({"id": p, "subpath": 0, "closed": false}));
    one_step(
        &mut e,
        "setPathNodes",
        json!({"id": p, "subpaths": [{"closed": true, "nodes": [{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 4}]}]}),
    );
    rejects(&mut e, "setPathNode", json!({"id": p, "subpath": 0, "index": 9, "node": {"x": 0, "y": 0}}), ErrorCode::OutOfBounds);
    rejects(&mut e, "setPathNode", json!({"id": p, "subpath": 4, "index": 0, "node": {"x": 0, "y": 0}}), ErrorCode::OutOfBounds);
    rejects(&mut e, "setNodeKind", json!({"id": p, "subpath": 0, "index": 0, "kind": "bent"}), ErrorCode::InvalidCommand);
    let r = rect(&mut e, 0.0, 0.0, 1.0, 1.0, RED);
    rejects(&mut e, "setPathNode", json!({"id": r, "subpath": 0, "index": 0, "node": {"x": 0, "y": 0}}), ErrorCode::Validation);
}

#[test]
fn gradients_and_shape_fills() {
    let mut e = eng(10, 1);
    let r = rect(&mut e, 0.0, 0.0, 10.0, 1.0, RED);
    let grad = json!({"type": "linear", "x0": 0, "y0": 0, "x1": 10, "y1": 0, "stops": [
        {"offset": 0, "color": [0, 0, 0, 255]}, {"offset": 1, "color": [250, 0, 0, 255]}]});
    rejects(&mut e, "setFill", json!({"id": r, "fill": grad}), ErrorCode::Validation);
    one_step(&mut e, "setFill", json!({"id": r, "fill": {"type": "solid", "color": BLUE}}));
    one_step(&mut e, "convertToPath", json!({"id": r}));
    one_step(&mut e, "setFill", json!({"id": r, "fill": grad}));
    let f = flat(&mut e);
    assert!(px(&f, 10, 0, 0)[0] < px(&f, 10, 9, 0)[0], "gradient ramps left to right");
    rejects(
        &mut e,
        "setFill",
        json!({"id": r, "fill": {"type": "radial", "cx": 5, "cy": 0, "r": 2, "fx": 9, "fy": 0, "stops": [
            {"offset": 0, "color": RED}, {"offset": 1, "color": BLUE}]}}),
        ErrorCode::Validation,
    );
    rejects(
        &mut e,
        "setFill",
        json!({"id": r, "fill": {"type": "linear", "x0": 0, "y0": 0, "x1": 1, "y1": 0, "stops": [
            {"offset": 0.8, "color": RED}, {"offset": 0.2, "color": BLUE}]}}),
        ErrorCode::Validation,
    );
}

#[test]
fn boolean_ops_with_editable_operands() {
    let mut e = eng(10, 4);
    let a = rect(&mut e, 0.0, 0.0, 6.0, 4.0, RED);
    let b = rect(&mut e, 4.0, 0.0, 6.0, 4.0, BLUE);
    let bo = id(&one_step(&mut e, "booleanLayers", json!({"ids": [a, b], "op": "subtract"})));
    let f = flat(&mut e);
    assert_eq!(px(&f, 10, 1, 1), RED, "result takes the bottom operand's fill");
    assert_eq!(px(&f, 10, 5, 1)[3], 0, "overlap subtracted");
    assert_eq!(px(&f, 10, 8, 1)[3], 0, "top operand never painted");
    one_step(&mut e, "setBooleanOp", json!({"id": bo, "op": "intersect"}));
    let f = flat(&mut e);
    assert_eq!(px(&f, 10, 5, 1), RED);
    assert_eq!(px(&f, 10, 1, 1)[3], 0);
    // Operands stay editable.
    run(&mut e, "setLayerTransform", json!({"id": b, "transform": {"tx": -2}}));
    assert_eq!(px(&flat(&mut e), 10, 3, 1), RED);
    one_step(&mut e, "setBooleanOp", json!({"id": bo, "op": "exclude"}));
    let ras = id(&run(&mut e, "addRasterLayer", json!({})));
    rejects(&mut e, "booleanLayers", json!({"ids": [a, ras], "op": "union"}), ErrorCode::Validation);
    rejects(&mut e, "booleanLayers", json!({"ids": [a], "op": "union"}), ErrorCode::Validation);
    rejects(&mut e, "setClipped", json!({"id": b, "clipped": true}), ErrorCode::Validation);
    rejects(&mut e, "setLayerParent", json!({"id": ras, "parent": bo}), ErrorCode::Validation);
    // Release the operands back.
    run(&mut e, "ungroupLayer", json!({"id": bo}));
    assert_eq!(layer(&describe(&mut e), a)["parent"], Value::Null);
}

#[test]
fn rasterize_expands_vector_and_groups() {
    let mut e = eng(6, 6);
    let a = rect(&mut e, 0.0, 0.0, 2.0, 2.0, RED);
    let b = rect(&mut e, 2.0, 2.0, 2.0, 2.0, BLUE);
    let g = id(&run(&mut e, "groupLayers", json!({"ids": [a, b]})));
    run(&mut e, "setLayerTransform", json!({"id": g, "transform": {"tx": 1}}));
    let before = flat(&mut e);
    one_step(&mut e, "rasterizeLayer", json!({"id": g}));
    assert_eq!(flat(&mut e), before);
    let d = describe(&mut e);
    assert_eq!(d["layers"].as_array().unwrap().len(), 1);
    assert_eq!(layer(&d, g)["content"]["type"], "raster");
    rejects(&mut e, "rasterizeLayer", json!({"id": g}), ErrorCode::Validation);
}

// -- region fill -------------------------------------------------------------------

#[test]
fn flood_fill_contiguous_and_selection() {
    let mut e = eng(5, 1);
    let l = id(&run(&mut e, "addRasterLayer", json!({})));
    run(&mut e, "drawPixels", json!({"id": l, "x": 2, "y": 0, "w": 1, "h": 1, "data_b64": b64::encode(&RED)}));
    one_step(&mut e, "floodFill", json!({"id": l, "x": 0, "y": 0, "color": BLUE, "tolerance": 0}));
    let f = flat(&mut e);
    assert_eq!(px(&f, 5, 1, 0), BLUE);
    assert_eq!(px(&f, 5, 2, 0), RED, "the red pixel bounds the region");
    assert_eq!(px(&f, 5, 3, 0)[3], 0);
    e.undo().unwrap();
    run(&mut e, "floodFill", json!({"id": l, "x": 0, "y": 0, "color": BLUE, "tolerance": 0, "contiguous": false}));
    assert_eq!(px(&flat(&mut e), 5, 4, 0), BLUE, "global fill reaches past the red pixel");
    e.undo().unwrap();
    run(&mut e, "selectRegion", json!({"shape": {"kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1}}));
    run(&mut e, "floodFill", json!({"id": l, "x": 0, "y": 0, "color": BLUE, "tolerance": 0}));
    let f = flat(&mut e);
    assert_eq!(px(&f, 5, 0, 0), BLUE);
    assert_eq!(px(&f, 5, 1, 0)[3], 0, "fill stays inside the selection");
    // Seed outside the selection fills nothing and records nothing.
    let depth = e.journal.undo_len();
    let r = run(&mut e, "floodFill", json!({"id": l, "x": 4, "y": 0, "color": BLUE, "tolerance": 0}));
    assert_eq!(r["filled"], 0);
    assert_eq!(e.journal.undo_len(), depth);
    rejects(&mut e, "floodFill", json!({"id": l, "x": 9, "y": 0, "color": BLUE}), ErrorCode::OutOfBounds);
    let s = rect(&mut e, 0.0, 0.0, 1.0, 1.0, RED);
    rejects(&mut e, "floodFill", json!({"id": s, "x": 0, "y": 0, "color": BLUE}), ErrorCode::Validation);
}

#[test]
fn snapshot_round_trips_new_state_and_rejects_bad_trees() {
    let mut e = eng(6, 6);
    let a = rect(&mut e, 0.0, 0.0, 2.0, 2.0, RED);
    let b = id(&run(&mut e, "addPath", json!({"path": tri(), "fill": {"type": "solid", "color": BLUE}})));
    let g = id(&run(&mut e, "groupLayers", json!({"ids": [a, b]})));
    run(&mut e, "addMask", json!({"id": g}));
    run(&mut e, "setLayerBlend", json!({"id": g, "blend": "overlay"}));
    run(&mut e, "addArtboard", json!({"x": 0, "y": 0, "w": 3, "h": 3}));
    run(&mut e, "selectAll", json!({}));
    run(&mut e, "selectLayers", json!({"ids": [a]}));
    let snap = e.snapshot().unwrap();
    let mut r = eng(1, 1);
    r.restore(&snap).unwrap();
    assert_eq!(describe(&mut r), describe(&mut e));
    assert_eq!(flat(&mut r), flat(&mut e));
    // A parent pointing at a raster layer is rejected.
    let mut wire: Value = serde_json::from_slice(ignition_core::decode_envelope(&snap).unwrap().1).unwrap();
    wire["layers"][0]["parent"] = json!(9999);
    let bad = ignition_core::encode_envelope(&serde_json::to_vec(&wire).unwrap());
    let before = describe(&mut r);
    assert_eq!(r.restore(&bad).unwrap_err().code, ErrorCode::Serialization);
    assert_eq!(describe(&mut r), before);
}

#[test]
fn old_snapshots_without_new_fields_restore() {
    let wire = json!({"width": 2, "height": 1, "next_id": 2, "layers": [
        {"id": 1, "name": "bg", "opacity": 1.0, "visible": true,
         "content": {"type": "raster", "pixels_b64": b64::encode(&[1, 2, 3, 255, 4, 5, 6, 255])}}]});
    let mut e = eng(1, 1);
    e.restore(&ignition_core::encode_envelope(&serde_json::to_vec(&wire).unwrap())).unwrap();
    let d = describe(&mut e);
    assert_eq!(d["layers"][0]["blend"], "normal");
    assert_eq!(d["layers"][0]["locked"], false);
    assert_eq!(d["artboards"], json!([]));
}
