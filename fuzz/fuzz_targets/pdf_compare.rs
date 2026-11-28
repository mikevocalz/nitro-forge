//! Folio `comparePdf`: an untrusted second PDF diffed against an open one.
#![no_main]

use folio_engine::FolioEngine;
use libfuzzer_sys::fuzz_target;
use nf_fuzz::{apply_atomic, binary, read};
use serde_json::json;

fuzz_target!(|data: &[u8]| {
    let mut engine = FolioEngine::new();
    read(&mut engine, "new", json!({"pages": 2})).expect("new");
    apply_atomic(&mut engine, binary("comparePdf", json!({}), data));
});
