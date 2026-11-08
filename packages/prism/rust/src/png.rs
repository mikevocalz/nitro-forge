//! PNG encoding for the `encodePng` read op.
//!
//! Honest subset: 8-bit RGBA (PNG colour type 6), non-interlaced, adaptive
//! per-scanline filtering, zlib/deflate compression via the `png` crate.
//! There is no palette, no 16-bit depth, no interlacing and no ancillary
//! chunks (no ICC/gAMA/tEXt). Output is deterministic: identical pixels
//! always produce identical bytes because the encoder settings and the
//! deflate backend are pinned by Cargo.lock.

use ignition_core::EngineError;

/// Encode straight-alpha RGBA8 pixels as a PNG byte stream.
///
/// `rgba` must be exactly `width * height * 4` bytes. Callers enforce the
/// export budget before rendering; this function only checks the buffer
/// length so a mismatch is an internal error, never a panic.
pub(crate) fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, EngineError> {
    if rgba.len() != width as usize * height as usize * 4 {
        return Err(EngineError::internal(
            "RGBA buffer size does not match dimensions",
        ));
    }
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Balanced);
        // `set_compression` maps Balanced to `Filter::Adaptive` (per-scanline
        // filter choice); it is deterministic for fixed input.
        let mut writer = encoder
            .write_header()
            .map_err(|e| EngineError::internal(format!("PNG header failed: {e}")))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| EngineError::internal(format!("PNG encode failed: {e}")))?;
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Minimal PNG reader for tests: signature, IHDR, per-chunk CRC and a
    /// stored/deflate zlib inflate through `flate2` (already in the tree).
    pub(crate) fn decode(png: &[u8]) -> (u32, u32, Vec<u8>) {
        use std::io::Read;
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n", "bad PNG signature");
        let mut pos = 8usize;
        let mut ihdr = None;
        let mut idat = Vec::new();
        while pos < png.len() {
            let len = u32::from_be_bytes(png[pos..pos + 4].try_into().unwrap()) as usize;
            let kind = &png[pos + 4..pos + 8];
            let data = &png[pos + 8..pos + 8 + len];
            // CRC32 over type+data.
            let mut crc: u32 = 0xffff_ffff;
            for &b in kind.iter().chain(data.iter()) {
                crc ^= b as u32;
                for _ in 0..8 {
                    crc = if crc & 1 != 0 {
                        (crc >> 1) ^ 0xedb8_8320
                    } else {
                        crc >> 1
                    };
                }
            }
            assert_eq!(
                crc ^ 0xffff_ffff,
                u32::from_be_bytes(png[pos + 8 + len..pos + 12 + len].try_into().unwrap()),
                "bad CRC for {}",
                String::from_utf8_lossy(kind)
            );
            match kind {
                b"IHDR" => ihdr = Some(data.to_vec()),
                b"IDAT" => idat.extend_from_slice(data),
                _ => {}
            }
            pos += 12 + len;
        }
        let ihdr = ihdr.expect("missing IHDR");
        assert_eq!(ihdr.len(), 13);
        assert_eq!(
            &ihdr[8..13],
            &[8, 6, 0, 0, 0],
            "expected 8-bit RGBA non-interlaced"
        );
        let width = u32::from_be_bytes(ihdr[0..4].try_into().unwrap());
        let height = u32::from_be_bytes(ihdr[4..8].try_into().unwrap());
        let mut raw = Vec::new();
        flate2::read::ZlibDecoder::new(&idat[..])
            .read_to_end(&mut raw)
            .expect("zlib inflate failed");
        // Unfilter: filter type must be 0..=4; reconstruct scanlines.
        let stride = width as usize * 4;
        let mut px = vec![0u8; width as usize * height as usize * 4];
        let mut prev = vec![0u8; stride];
        for y in 0..height as usize {
            let row = &raw[y * (stride + 1)..(y + 1) * (stride + 1)];
            let filter = row[0];
            let cur = &mut px[y * stride..(y + 1) * stride];
            for x in 0..stride {
                let a = if x >= 4 { cur[x - 4] } else { 0 };
                let b = prev[x];
                let c = if x >= 4 { prev[x - 4] } else { 0 };
                let v = row[x + 1] as i32
                    + match filter {
                        0 => 0,
                        1 => a as i32,
                        2 => b as i32,
                        3 => (a as i32 + b as i32) / 2,
                        4 => {
                            let p = a as i32 + b as i32 - c as i32;
                            let pa = (p - a as i32).abs();
                            let pb = (p - b as i32).abs();
                            let pc = (p - c as i32).abs();
                            if pa <= pb && pa <= pc {
                                a as i32
                            } else if pb <= pc {
                                b as i32
                            } else {
                                c as i32
                            }
                        }
                        f => panic!("unknown filter {f}"),
                    };
                cur[x] = v.rem_euclid(256) as u8;
            }
            prev.copy_from_slice(cur);
        }
        (width, height, px)
    }

    #[test]
    fn encodes_exact_pixels_and_is_deterministic() {
        // 2x2 with varied alpha incl. fully transparent.
        let rgba: Vec<u8> = vec![
            255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 20, 30, 40, 255,
        ];
        let png = encode_rgba(&rgba, 2, 2).unwrap();
        let (w, h, px) = decode(&png);
        assert_eq!((w, h), (2, 2));
        assert_eq!(px, rgba);
        assert_eq!(
            png,
            encode_rgba(&rgba, 2, 2).unwrap(),
            "encode must be deterministic"
        );
    }

    #[test]
    fn rejects_buffer_size_mismatch() {
        assert!(encode_rgba(&[0; 3], 1, 1).is_err());
        assert!(encode_rgba(&[0; 16], 2, 2).is_ok());
    }
}
