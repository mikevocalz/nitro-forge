//! ignition-core's NFD1 snapshot envelope and base64 codec: the framing
//! every stored document and every `*_b64` payload field goes through.
#![no_main]

use ignition_core::{base64_decode, base64_encode, decode_envelope, encode_envelope};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok((format, payload)) = decode_envelope(data) {
        assert_eq!(format, ignition_core::ENVELOPE_FORMAT_JSON);
        // An accepted envelope is exactly the encoding of its payload.
        assert_eq!(encode_envelope(payload), data);
    }
    if let Ok(text) = std::str::from_utf8(data) {
        if let Ok(bytes) = base64_decode(text) {
            // Whatever decodes must re-encode and decode to the same bytes.
            assert_eq!(base64_decode(&base64_encode(&bytes)).unwrap(), bytes);
        }
    }
    assert_eq!(base64_decode(&base64_encode(data)).unwrap(), data);
});
