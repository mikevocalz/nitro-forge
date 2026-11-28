//! Quill `registerFont`: an untrusted TrueType/OpenType file (skrifa +
//! harfrust), then shaping (`layout`) and glyph rasterization
//! (`renderPage`, tiny-skia) with that face.
#![no_main]

use ignition_core::Engine;
use libfuzzer_sys::fuzz_target;
use nf_fuzz::{binary, check_error, read};
use quill_engine::QuillEngine;
use serde_json::json;

fuzz_target!(|data: &[u8]| {
    let mut engine = QuillEngine::new();
    // The font registry is session state (no snapshot bytes), so a
    // rejected face is checked through listFonts instead of the snapshot.
    let cmd = binary("registerFont", json!({"family": "Fuzz"}), data);
    if let Err(err) = engine.apply(cmd) {
        check_error("registerFont", &err);
        let fonts = read(&mut engine, "listFonts", json!({})).expect("listFonts");
        assert_eq!(fonts.data["fonts"].as_array().map(Vec::len), Some(0));
        return;
    }
    read(
        &mut engine,
        "insertText",
        json!({"at": {"block": 0, "offset": 0},
               "text": "Hello, World! fi ffl AV 0123 \u{e9}\u{4e2d}\u{1f600}"}),
    );
    read(
        &mut engine,
        "layout",
        json!({"page_width": 120.0, "font_size": 11.0, "font": "Fuzz"}),
    );
    read(
        &mut engine,
        "renderPage",
        json!({"page_width": 120.0, "page_height": 60.0, "font_size": 11.0,
               "font": "Fuzz", "page": 0}),
    );
});
