use crate::error::EngineError;

/// Snapshot wire format:
///   [0..4)  magic  b"NFD1"
///   [4]     format tag (0 = JSON)
///   [5..9)  payload length, little-endian u32
///   [9..]   payload
///
/// The envelope is the only bytes a host ever stores. `decode_envelope` checks
/// magic, format tag, and length before a payload is decoded by an engine.
pub const ENVELOPE_MAGIC: &[u8; 4] = b"NFD1";
pub const ENVELOPE_VERSION: u8 = 1;
pub const ENVELOPE_FORMAT_JSON: u8 = 0;
const HEADER_LEN: usize = 4 + 1 + 4;

pub fn encode_envelope(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN + payload.len());
    out.extend_from_slice(ENVELOPE_MAGIC);
    out.push(ENVELOPE_FORMAT_JSON);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out
}

/// Returns `(format_tag, payload)` or a `Serialization` error. Never panics on
/// malformed input.
pub fn decode_envelope(data: &[u8]) -> Result<(u8, &[u8]), EngineError> {
    if data.len() < HEADER_LEN {
        return Err(EngineError::serialization(
            "snapshot too short to contain an envelope header",
        ));
    }
    if &data[0..4] != ENVELOPE_MAGIC {
        return Err(EngineError::serialization("bad envelope magic"));
    }
    let format = data[4];
    if format != ENVELOPE_FORMAT_JSON {
        return Err(EngineError::unsupported(format!(
            "unknown snapshot format tag {format}"
        )));
    }
    let len = u32::from_le_bytes(data[5..9].try_into().unwrap()) as usize;
    let payload = &data[HEADER_LEN..];
    if payload.len() != len {
        return Err(EngineError::serialization(format!(
            "envelope length mismatch: header says {len}, got {}",
            payload.len()
        )));
    }
    Ok((format, payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let payload = b"{\"hello\":1}";
        let bytes = encode_envelope(payload);
        let (fmt, decoded) = decode_envelope(&bytes).unwrap();
        assert_eq!(fmt, ENVELOPE_FORMAT_JSON);
        assert_eq!(decoded, payload);
    }

    #[test]
    fn rejects_garbage() {
        for bad in [
            &b""[..],
            b"NFD",
            b"XXXX\x00\x00\x00\x00\x00",
            b"NFD1\x00\x03\x00\x00\x00ab", // truncated payload
            b"NFD1\x07\x00\x00\x00\x00",   // bad format tag
        ] {
            assert!(decode_envelope(bad).is_err(), "accepted: {bad:?}");
        }
    }
}
