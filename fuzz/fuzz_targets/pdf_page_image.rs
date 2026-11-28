//! Folio `insertPageImage`: untrusted JPEG headers, PNG (chunks, inflate,
//! unfilter) and raw samples. The first input byte picks the format and,
//! for raw, the declared size and color space.
#![no_main]

use folio_engine::FolioEngine;
use ignition_core::{Command, Engine};
use libfuzzer_sys::fuzz_target;
use nf_fuzz::{apply_atomic, binary, read};
use serde_json::json;

fuzz_target!(|data: &[u8]| {
    let Some((&selector, image)) = data.split_first() else {
        return;
    };
    let payload = match selector % 3 {
        0 => json!({"page": 0, "rect": [10, 10, 200, 100], "format": "png"}),
        1 => json!({"page": 0, "rect": [10, 10, 200, 100], "format": "jpeg"}),
        _ => json!({
            "page": 0, "rect": [0, 0, 50, 50], "format": "raw",
            "width": u64::from(selector >> 2 & 0x0f) + 1,
            "height": u64::from(selector >> 6) + 1,
            "color_space": if selector & 2 == 0 { "DeviceRGB" } else { "DeviceGray" },
        }),
    };
    let mut engine = FolioEngine::new();
    read(&mut engine, "new", json!({"pages": 1})).expect("new");
    if apply_atomic(&mut engine, binary("insertPageImage", payload, image)).is_none() {
        return;
    }
    // An accepted image must leave a document Folio can save and reopen.
    let save = Command::new("save", json!({})).with_binary(None);
    let bytes = engine
        .apply(save)
        .expect("save after an accepted image")
        .output
        .expect("save binary output");
    let mut again = FolioEngine::new();
    assert!(
        apply_atomic(&mut again, binary("open", json!({}), &bytes)).is_some(),
        "Folio rejected its own save after insertPageImage"
    );
});
