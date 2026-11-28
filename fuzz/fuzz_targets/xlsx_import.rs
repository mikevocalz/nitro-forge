//! Tally `importXlsx`: an untrusted .xlsx archive (zip 9 + quick-xml).
#![no_main]

use ignition_core::{Command, Engine};
use libfuzzer_sys::fuzz_target;
use nf_fuzz::{apply_atomic, binary, check_round_trip, read};
use serde_json::json;
use tally_engine::TallyEngine;

fuzz_target!(|data: &[u8]| {
    let mut engine = TallyEngine::new();
    if apply_atomic(&mut engine, binary("importXlsx", json!({}), data)).is_none() {
        return;
    }
    read(&mut engine, "describe", json!({}));
    read(&mut engine, "getRange", json!({"from": "A1", "to": "J40"}));
    check_round_trip(&engine, TallyEngine::new());
    // Whatever Tally imports it must be able to export and import again.
    let export = Command::new("exportXlsx", json!({})).with_binary(None);
    if let Ok(out) = engine.apply(export) {
        let bytes = out.output.expect("exportXlsx binary output");
        let mut again = TallyEngine::new();
        assert!(
            apply_atomic(&mut again, binary("importXlsx", json!({}), &bytes)).is_some(),
            "Tally rejected its own export of an imported workbook"
        );
    }
});
