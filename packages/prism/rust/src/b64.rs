//! Minimal base64 codec (no external deps).
//!
//! Mirrors the semantics of `ignition_core::protocol::base64_encode/decode`,
//! which are not reachable outside that crate (the `protocol` module is
//! private). Used for `pixels_b64` / `data_b64` fields.

use ignition_core::EngineError;

const ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

pub fn decode(s: &str) -> Result<Vec<u8>, EngineError> {
    let mut table = [255u8; 256];
    for (i, &c) in ALPHABET.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let s = s.trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        let v = table[c as usize];
        if v == 255 {
            return Err(EngineError::serialization("invalid base64 data"));
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        for case in [&b""[..], b"f", b"fo", b"foo", b"hello world", &[0, 1, 2, 255, 254, 253]] {
            let enc = encode(case);
            assert_eq!(decode(&enc).unwrap(), case);
        }
        assert_eq!(encode(b"hello"), "aGVsbG8=");
        assert_eq!(decode("aGVsbG8=").unwrap(), b"hello");
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode("!!!").is_err());
        assert!(decode("a GV").is_err());
    }
}
