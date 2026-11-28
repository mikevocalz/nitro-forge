//! Folio `open`: an untrusted PDF (lopdf 0.47), then every structural
//! read a host runs on an opened file, then save -> reopen.
#![no_main]

use folio_engine::FolioEngine;
use ignition_core::{Command, Engine};
use libfuzzer_sys::fuzz_target;
use nf_fuzz::{apply_atomic, binary, check_round_trip, read};
use serde_json::json;

fuzz_target!(|data: &[u8]| {
    let mut engine = FolioEngine::new();
    if apply_atomic(&mut engine, binary("open", json!({}), data)).is_none() {
        return;
    }
    for op in [
        "pageCount",
        "info",
        "describe",
        "listPageInfo",
        "listOutlines",
        "listFormFields",
        "listSignatures",
        "listAttachments",
    ] {
        read(&mut engine, op, json!({}));
    }
    read(&mut engine, "pageText", json!({"page": 0}));
    read(&mut engine, "listAnnotations", json!({"page": 0}));
    check_round_trip(&engine, FolioEngine::new());
    // Folio must reopen whatever it saves.
    let save = Command::new("save", json!({})).with_binary(None);
    if let Ok(out) = engine.apply(save) {
        let bytes = out.output.expect("save binary output");
        let mut again = FolioEngine::new();
        assert!(
            apply_atomic(&mut again, binary("open", json!({}), &bytes)).is_some(),
            "Folio rejected its own save of an opened document"
        );
    }
});
