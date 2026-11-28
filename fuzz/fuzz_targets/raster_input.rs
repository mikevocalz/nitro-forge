//! Raw RGBA sidecars with caller-declared dimensions: Motion
//! `addRasterAsset` and Prism `drawPixels`. The first five bytes are the
//! engine selector and the declared width/height; the rest is pixels.
#![no_main]

use libfuzzer_sys::fuzz_target;
use nf_fuzz::{apply_atomic, binary, read};
use serde_json::json;

fuzz_target!(|data: &[u8]| {
    if data.len() < 5 {
        return;
    }
    let width = u16::from_le_bytes([data[1], data[2]]);
    let height = u16::from_le_bytes([data[3], data[4]]);
    let pixels = &data[5..];
    if data[0] & 1 == 0 {
        let mut engine = motion_engine::MotionEngine::new();
        let payload = json!({"width": width, "height": height, "format": "rgba8-straight-srgb"});
        apply_atomic(&mut engine, binary("addRasterAsset", payload, pixels));
    } else {
        let mut engine = prism_engine::PrismEngine::new(64, 64);
        let layer = read(&mut engine, "addRasterLayer", json!({})).expect("addRasterLayer");
        let id = layer.data["layer_id"].clone();
        let x = i64::from(data[0] >> 1) - 64;
        let payload = json!({"id": id, "x": x, "y": x / 2, "w": width, "h": height});
        apply_atomic(&mut engine, binary("drawPixels", payload, pixels));
    }
});
