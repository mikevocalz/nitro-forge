//! Quill `importDocx`: an untrusted .docx archive (zip 9 + quick-xml).
#![no_main]

use ignition_core::{Command, Engine};
use libfuzzer_sys::fuzz_target;
use nf_fuzz::{apply_atomic, binary, check_round_trip, read};
use quill_engine::QuillEngine;
use serde_json::json;

fuzz_target!(|data: &[u8]| {
    let mut engine = QuillEngine::new();
    if apply_atomic(&mut engine, binary("importDocx", json!({}), data)).is_none() {
        return;
    }
    read(&mut engine, "describe", json!({}));
    read(&mut engine, "text", json!({}));
    read(&mut engine, "layout", json!({"page_width": 300.0, "font_size": 10.0}));
    check_round_trip(&engine, QuillEngine::new());
    // Whatever Quill imports it must be able to export and import again.
    let export = Command::new("exportDocx", json!({})).with_binary(None);
    if let Ok(out) = engine.apply(export) {
        let bytes = out.output.expect("exportDocx binary output");
        let mut again = QuillEngine::new();
        assert!(
            apply_atomic(&mut again, binary("importDocx", json!({}), &bytes)).is_some(),
            "Quill rejected its own export of an imported document"
        );
    }
});
