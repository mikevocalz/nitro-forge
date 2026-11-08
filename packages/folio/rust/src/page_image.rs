//! `insertPageImage` — place an image XObject on a page (P15 slice F / F-11).
//!
//! Payload `{page, rect:[x,y,w,h], format, image_b64|binary sidecar,
//! width?, height?, color_space?}`. The op NEVER rewrites existing page
//! content: it appends a new content stream (`q w 0 0 h x y cm /Xn Do Q`)
//! to the page's `/Contents` and registers the image under the page's
//! effective `/Resources`→`/XObject`. Existing streams — including inline
//! `BI`…`EI` images that lopdf's content decode/encode round-trip cannot
//! write back — are left byte-identical. One undo entry restores the
//! whole document.
//!
//! Honest input contract — three formats, no faked decoding:
//! - `jpeg`: the bytes are embedded VERBATIM as a `/DCTDecode` stream.
//!   The engine parses only the JPEG marker stream up to the first frame
//!   header (SOF) to read width/height/component count — it never
//!   decodes pixels. Only 8-bit, 1- or 3-component JPEGs are admitted
//!   (→ `/DeviceGray`/`/DeviceRGB`); 4-component (CMYK/YCCK) and other
//!   precisions reject Unsupported because correct `/Decode` handling
//!   depends on Adobe APP14 markers the engine does not interpret.
//! - `png`: real decode to raw samples — 8-bit, non-interlaced, color
//!   types 0 (gray), 2 (RGB), 4 (gray+alpha), 6 (RGBA). Palette (type 3),
//!   16-bit, interlaced and truncated/corrupt PNGs reject. Alpha is
//!   DISCARDED (samples become gray/RGB) — there is no alpha channel in
//!   the admitted output contract. IDAT is zlib-inflated under a hard
//!   byte bound and rows are unfiltered with lopdf's PNG predictor.
//! - `raw`: the bytes ARE the interleaved samples — 8 bits/component,
//!   `/DeviceRGB` (3 B/px) or `/DeviceGray` (1 B/px), length must equal
//!   `width*height*channels` exactly. `width`/`height` are required.
//!
//! Non-JPEG image streams are FlateDecode-compressed when that is
//! smaller (lopdf `Stream::compress` rule). All limits are enforced
//! before any mutation: ≤64 MiB encoded input, ≤25 MP, ≤200 MiB of PNG
//! scanline data.
use super::*;
use lopdf::filters::png::decode_frame;
use lopdf::Dictionary;
use std::collections::BTreeSet;
use std::io::Read as _;

/// Encoded image input cap (base64-decoded or binary sidecar).
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
/// Pixel-count cap shared by all three formats.
const MAX_IMAGE_PIXELS: u64 = 25_000_000;
/// PNG scanline-data cap after inflation (filter bytes included).
const MAX_PNG_SCANLINES: u64 = 200 * 1024 * 1024;
/// Bound on JPEG marker segments scanned before the first SOF.
const MAX_JPEG_SEGMENTS: usize = 4096;
/// Bound on `/Parent` chain walk for inherited `/Resources`.
const MAX_RESOURCE_DEPTH: usize = 64;

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// A fully validated image ready to become a stream object.
struct ImageSpec {
    width: u64,
    height: u64,
    /// `"DeviceRGB"` or `"DeviceGray"`.
    color_space: &'static str,
    /// `"jpeg"`, `"png"` or `"raw"` — reported back to the caller.
    format: &'static str,
    /// `/DCTDecode` verbatim bytes for jpeg; raw samples otherwise.
    content: Vec<u8>,
    dct: bool,
}

fn invalid_image(msg: impl Into<String>) -> EngineError {
    EngineError::validation(format!("insertPageImage: {}", msg.into()))
}

fn unsupported_image(msg: impl Into<String>) -> EngineError {
    EngineError::unsupported(format!("insertPageImage: {}", msg.into()))
}

fn check_pixels(width: u64, height: u64) -> Result<(), EngineError> {
    if width == 0 || height == 0 {
        return Err(invalid_image("image dimensions must be positive"));
    }
    if width.saturating_mul(height) > MAX_IMAGE_PIXELS {
        return Err(invalid_image(format!(
            "image exceeds the {MAX_IMAGE_PIXELS} pixel cap"
        )));
    }
    Ok(())
}

/// JPEG SOF markers (excluding DHT JPG C4/C8 and DAC CC, which share the
/// Cx range but are not frame headers).
fn is_jpeg_sof(marker: u8) -> bool {
    matches!(
        marker,
        0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE
            | 0xCF
    )
}

/// Walk JPEG markers up to the first frame header and return
/// `(width, height, components)`. Never touches entropy-coded data.
fn jpeg_header(bytes: &[u8]) -> Result<(u64, u64, usize), EngineError> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err(invalid_image("jpeg bytes do not start with the SOI marker"));
    }
    let mut i = 2usize;
    for _ in 0..MAX_JPEG_SEGMENTS {
        // Markers are FF-prefixed; fill bytes (0xFF) may repeat.
        while i < bytes.len() && bytes[i] != 0xFF {
            i += 1;
        }
        while i < bytes.len() && bytes[i] == 0xFF {
            i += 1;
        }
        if i >= bytes.len() {
            return Err(invalid_image("truncated jpeg marker stream"));
        }
        let marker = bytes[i];
        i += 1;
        match marker {
            // Standalone markers carry no length field.
            0x01 | 0xD0..=0xD9 => {
                if marker == 0xD9 {
                    return Err(invalid_image("jpeg has no frame header"));
                }
                continue;
            }
            0xDA => return Err(invalid_image("jpeg scan starts before a frame header")),
            _ => {}
        }
        if i + 2 > bytes.len() {
            return Err(invalid_image("truncated jpeg segment length"));
        }
        let seg_len = u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
        if seg_len < 2 || i + seg_len > bytes.len() {
            return Err(invalid_image("jpeg segment length out of bounds"));
        }
        if is_jpeg_sof(marker) {
            // SOF payload: precision(1) height(2) width(2) components(1)…
            if seg_len < 8 {
                return Err(invalid_image("jpeg frame header is truncated"));
            }
            let precision = bytes[i + 2];
            let height = u16::from_be_bytes([bytes[i + 3], bytes[i + 4]]) as u64;
            let width = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u64;
            let components = bytes[i + 7] as usize;
            if precision != 8 {
                return Err(unsupported_image(format!(
                    "jpeg precision {precision} is not supported (8-bit only)"
                )));
            }
            return Ok((width, height, components));
        }
        i += seg_len;
    }
    Err(invalid_image("jpeg has too many marker segments"))
}

fn jpeg_spec(bytes: &[u8]) -> Result<ImageSpec, EngineError> {
    let (width, height, components) = jpeg_header(bytes)?;
    check_pixels(width, height)?;
    let color_space = match components {
        1 => "DeviceGray",
        3 => "DeviceRGB",
        _ => {
            return Err(unsupported_image(format!(
                "jpeg with {components} components is not admitted (1=gray, 3=RGB only; CMYK/YCCK needs Adobe-marker-aware /Decode handling)"
            )))
        }
    };
    Ok(ImageSpec {
        width,
        height,
        color_space,
        format: "jpeg",
        content: bytes.to_vec(),
        dct: true,
    })
}

/// One parsed PNG: pixel dimensions plus interleaved 8-bit samples with
/// the alpha channel already removed (channels = 1 gray or 3 RGB).
struct PngImage {
    width: u64,
    height: u64,
    channels: usize,
    samples: Vec<u8>,
}

fn png_spec(bytes: &[u8]) -> Result<ImageSpec, EngineError> {
    let img = png_decode(bytes)?;
    check_pixels(img.width, img.height)?;
    Ok(ImageSpec {
        width: img.width,
        height: img.height,
        color_space: if img.channels == 1 {
            "DeviceGray"
        } else {
            "DeviceRGB"
        },
        format: "png",
        content: img.samples,
        dct: false,
    })
}

fn png_decode(bytes: &[u8]) -> Result<PngImage, EngineError> {
    if bytes.len() < PNG_SIGNATURE.len() + 12 || !bytes.starts_with(&PNG_SIGNATURE) {
        return Err(invalid_image("bytes are not a PNG file"));
    }
    let mut pos = PNG_SIGNATURE.len();
    let mut ihdr: Option<(u64, u64, u8, u8, u8)> = None; // w,h,depth,ctype,interlace
    let mut idat: Vec<u8> = Vec::new();
    let mut seen_idat = false;
    let mut ended = false;
    while pos + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]])
            as usize;
        let ctype = [bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]];
        let data_start = pos + 8;
        let data_end = data_start
            .checked_add(len)
            .and_then(|e| e.checked_add(4))
            .filter(|&e| e <= bytes.len())
            .ok_or_else(|| invalid_image("png chunk length out of bounds"))?;
        // CRC covers the chunk type + data.
        let stored_crc = u32::from_be_bytes([
            bytes[data_end - 4],
            bytes[data_end - 3],
            bytes[data_end - 2],
            bytes[data_end - 1],
        ]);
        let mut crc_input = Vec::with_capacity(4 + len);
        crc_input.extend_from_slice(&ctype);
        crc_input.extend_from_slice(&bytes[data_start..data_end - 4]);
        if crc32fast::hash(&crc_input) != stored_crc {
            return Err(invalid_image("png chunk CRC mismatch"));
        }
        let data = &bytes[data_start..data_end - 4];
        match &ctype {
            b"IHDR" => {
                if ihdr.is_some() || len != 13 || seen_idat {
                    return Err(invalid_image("png IHDR is misplaced or malformed"));
                }
                let width = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as u64;
                let height = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as u64;
                ihdr = Some((
                    width,
                    height,
                    data[8],
                    data[9],
                    data[12],
                ));
            }
            b"IDAT" => {
                if ihdr.is_none() {
                    return Err(invalid_image("png IDAT precedes IHDR"));
                }
                seen_idat = true;
                idat.extend_from_slice(data);
            }
            b"IEND" => {
                ended = true;
                break;
            }
            _ => {
                if ihdr.is_none() {
                    return Err(invalid_image("png chunk precedes IHDR"));
                }
                // PLTE/tRNS/etc. are skipped; palette color type rejects below.
            }
        }
        pos = data_end;
    }
    if !ended {
        return Err(invalid_image("png is missing IEND"));
    }
    let Some((width, height, depth, color_type, interlace)) = ihdr else {
        return Err(invalid_image("png is missing IHDR"));
    };
    if depth != 8 {
        return Err(unsupported_image(format!(
            "png bit depth {depth} is not supported (8-bit only)"
        )));
    }
    if interlace != 0 {
        return Err(unsupported_image(
            "interlaced png is not supported",
        ));
    }
    let png_channels = match color_type {
        0 => 1usize, // gray
        2 => 3,      // RGB
        4 => 2,      // gray + alpha → gray
        6 => 4,      // RGBA → RGB
        3 => {
            return Err(unsupported_image(
                "palette png is not supported",
            ))
        }
        other => {
            return Err(unsupported_image(format!(
                "png color type {other} is not supported"
            )))
        }
    };
    if !seen_idat {
        return Err(invalid_image("png has no IDAT data"));
    }
    let scanline_bytes = height
        .saturating_mul(1 + width.saturating_mul(png_channels as u64));
    if scanline_bytes > MAX_PNG_SCANLINES {
        return Err(invalid_image(format!(
            "png scanline data exceeds the {MAX_PNG_SCANLINES} byte cap"
        )));
    }
    // Inflate under a hard bound: never materialize more than expected+1.
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(&idat[..])
        .take(scanline_bytes + 1)
        .read_to_end(&mut raw)
        .map_err(|e| invalid_image(format!("png IDAT inflate failed: {e}")))?;
    if raw.len() as u64 != scanline_bytes {
        return Err(invalid_image(
            "png IDAT does not inflate to the expected scanline size",
        ));
    }
    let unfiltered = decode_frame(&raw, png_channels, width as usize)
        .map_err(|e| invalid_image(format!("png row decode failed: {e}")))?;
    // Strip the alpha channel where present.
    let (channels, samples) = match color_type {
        4 => (
            1usize,
            unfiltered
                .chunks_exact(2)
                .map(|px| px[0])
                .collect::<Vec<u8>>(),
        ),
        6 => (
            3usize,
            unfiltered
                .chunks_exact(4)
                .flat_map(|px| [px[0], px[1], px[2]])
                .collect::<Vec<u8>>(),
        ),
        _ => (png_channels, unfiltered),
    };
    Ok(PngImage {
        width,
        height,
        channels,
        samples,
    })
}

fn raw_spec(p: &Value, bytes: &[u8]) -> Result<ImageSpec, EngineError> {
    let width = req_u64(p, "width")?;
    let height = req_u64(p, "height")?;
    check_pixels(width, height)?;
    let color_space = match req_str(p, "color_space")? {
        "DeviceRGB" => "DeviceRGB",
        "DeviceGray" => "DeviceGray",
        other => {
            return Err(invalid_image(format!(
                "raw color_space '{other}' is not supported (DeviceRGB|DeviceGray)"
            )))
        }
    };
    let channels = if color_space == "DeviceRGB" { 3 } else { 1 };
    let expected = width
        .checked_mul(height)
        .and_then(|px| px.checked_mul(channels))
        .ok_or_else(|| invalid_image("raw image dimensions overflow"))?;
    if bytes.len() as u64 != expected {
        return Err(invalid_image(format!(
            "raw image data is {} bytes, expected {expected} ({width}x{height}x{channels} at 8 bpc)",
            bytes.len()
        )));
    }
    Ok(ImageSpec {
        width,
        height,
        color_space,
        format: "raw",
        content: bytes.to_vec(),
        dct: false,
    })
}

/// Resolve an indirect-or-inline dictionary object to an owned clone.
fn dict_clone(doc: &Document, obj: &Object) -> Result<Dictionary, EngineError> {
    match obj {
        Object::Dictionary(d) => Ok(d.clone()),
        Object::Reference(id) => doc
            .get_object(*id)
            .and_then(Object::as_dict)
            .map(|d| d.clone())
            .map_err(ser_err),
        _ => Err(EngineError::unsupported(
            "insertPageImage: /Resources or /XObject is not a dictionary",
        )),
    }
}

/// The page's effective `/Resources` dictionary — its own when present,
/// otherwise the nearest ancestor's (the attribute is inheritable).
/// Always returns an owned clone so the shared original is never
/// mutated; `/Parent` cycles and deep chains are bounded.
fn page_resources(doc: &Document, page_id: ObjectId) -> Result<Dictionary, EngineError> {
    let mut current = Some(page_id);
    let mut seen = BTreeSet::new();
    for _ in 0..MAX_RESOURCE_DEPTH {
        let Some(id) = current else { break };
        if !seen.insert(id) {
            return Err(EngineError::unsupported(
                "insertPageImage: /Parent chain contains a cycle",
            ));
        }
        let dict = doc
            .get_object(id)
            .and_then(Object::as_dict)
            .map_err(ser_err)?;
        if let Ok(res) = dict.get(b"Resources") {
            return dict_clone(doc, res);
        }
        current = dict.get(b"Parent").ok().and_then(|o| o.as_reference().ok());
    }
    Ok(Dictionary::new())
}

/// What the page's `/Contents` currently is, resolved before journaling
/// so the post-journal update is mechanical.
enum ContentsPlan {
    /// No `/Contents` — set to the new stream reference.
    Missing,
    /// Single stream reference — becomes `[old, new]`.
    Single(ObjectId),
    /// Array — cloned items plus the new reference appended.
    Array(Vec<Object>),
    /// Direct (non-indirect) stream object — re-homed as an indirect
    /// object, then `[old, new]`.
    DirectStream(Stream),
}

fn contents_plan(doc: &Document, page_id: ObjectId) -> Result<ContentsPlan, EngineError> {
    let page = doc
        .get_object(page_id)
        .and_then(Object::as_dict)
        .map_err(ser_err)?;
    match page.get(b"Contents") {
        Err(_) => Ok(ContentsPlan::Missing),
        Ok(Object::Reference(id)) => Ok(ContentsPlan::Single(*id)),
        Ok(Object::Array(items)) => Ok(ContentsPlan::Array(items.clone())),
        Ok(Object::Stream(s)) => Ok(ContentsPlan::DirectStream(s.clone())),
        Ok(_) => Err(EngineError::unsupported(
            "insertPageImage: page /Contents is not a stream or array of streams",
        )),
    }
}

impl FolioEngine {
    /// `insertPageImage {page,rect,format,width?,height?,color_space?,
    /// image_b64|binary}` → `{ok,name,width,height,color_space,format}`.
    /// Mutating; one undo entry; rejects encrypted documents.
    pub(super) fn op_insert_page_image(
        &mut self,
        cmd: &mut Command,
    ) -> Result<CommandResult, EngineError> {
        // Binary sidecar or `image_b64` — resolved before payload reads.
        let image_bytes = cmd.bytes_input("image_b64", b64_decode)?;
        if image_bytes.len() > MAX_IMAGE_BYTES {
            return Err(invalid_image(format!(
                "image input exceeds the {MAX_IMAGE_BYTES} byte cap"
            )));
        }
        let p = &cmd.payload;
        let page = req_u64(p, "page")?;
        let page_id = self.page_id(page)?;
        let rect = req_rect(p)?;
        let format = req_str(p, "format")?;
        reject_encrypted(&self.doc, "image insertion")?;
        let spec = match format {
            "jpeg" => jpeg_spec(&image_bytes)?,
            "png" => png_spec(&image_bytes)?,
            "raw" => raw_spec(p, &image_bytes)?,
            other => {
                return Err(EngineError::invalid(format!(
                    "unknown image format '{other}' (expected jpeg|png|raw)"
                )))
            }
        };
        // `rect` uses the same positive/nondegenerate/±1e6 rule as
        // annotations; returns f32 corners for the content-stream matrix.
        let [x1, y1, x2, y2] = markup::checked_rect(rect)?;
        let (dx, dy, dw, dh) = (
            f64::from(x1),
            f64::from(y1),
            f64::from(x2 - x1),
            f64::from(y2 - y1),
        );

        // ---- resolve everything fallible BEFORE journaling -------------
        let mut resources = page_resources(&self.doc, page_id)?;
        let mut xobjects = match resources.get(b"XObject") {
            Ok(o) => dict_clone(&self.doc, o)?,
            Err(_) => Dictionary::new(),
        };
        let plan = contents_plan(&self.doc, page_id)?;

        // ---- build the two new streams (local, infallible-ish) ---------
        let mut img_dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => Object::Integer(spec.width as i64),
            "Height" => Object::Integer(spec.height as i64),
            "ColorSpace" => Object::Name(spec.color_space.as_bytes().to_vec()),
            "BitsPerComponent" => Object::Integer(8),
        };
        if spec.dct {
            img_dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        }
        let mut img_stream = Stream::new(img_dict, spec.content);
        if !spec.dct {
            // FlateDecode only when smaller — lopdf's compress() rule.
            img_stream.compress().map_err(ser_err)?;
        }

        // The XObject name derives from the image's future object id, so
        // objects are added only AFTER journaling; everything above is
        // read-only and every fallible step already ran.
        self.journal.record(self.doc.clone());

        let img_id = self.doc.add_object(Object::Stream(img_stream));
        let mut name = format!("X{}", img_id.0);
        let mut suffix = 0u8;
        while xobjects.has(name.as_bytes()) {
            suffix += 1;
            name = format!("X{}{}", img_id.0, (b'a' + suffix.min(25)) as char);
        }
        xobjects.set(name.as_bytes().to_vec(), Object::Reference(img_id));
        resources.set("XObject", Object::Dictionary(xobjects));

        let content = format!(
            "q\n{} 0 0 {} {} {} cm\n/{} Do\nQ\n",
            fmt_num(dw),
            fmt_num(dh),
            fmt_num(dx),
            fmt_num(dy),
            name
        );
        let content_stream = Stream::new(dictionary! {}, content.into_bytes());
        let content_id = self.doc.add_object(Object::Stream(content_stream));

        // Resolve the new `/Contents` value first — the direct-stream arm
        // may need one more `add_object`, which cannot run while the page
        // dictionary is mutably borrowed.
        let new_contents = match plan {
            ContentsPlan::Missing => Object::Reference(content_id),
            ContentsPlan::Single(old) => Object::Array(vec![
                Object::Reference(old),
                Object::Reference(content_id),
            ]),
            ContentsPlan::Array(mut items) => {
                items.push(Object::Reference(content_id));
                Object::Array(items)
            }
            ContentsPlan::DirectStream(s) => {
                let old_id = self.doc.add_object(Object::Stream(s));
                Object::Array(vec![
                    Object::Reference(old_id),
                    Object::Reference(content_id),
                ])
            }
        };
        let page_dict = self
            .doc
            .get_object_mut(page_id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?;
        page_dict.set("Resources", Object::Dictionary(resources));
        page_dict.set("Contents", new_contents);

        Ok(CommandResult::data(json!({
            "ok": true,
            "name": name,
            "width": spec.width,
            "height": spec.height,
            "color_space": spec.color_space,
            "format": spec.format,
        })))
    }
}

/// Format an f64 as a PDF real without exponent notation or trailing
/// noise — Rust's `Display` already prints the shortest round-trip
/// decimal, which every PDF reader accepts.
fn fmt_num(v: f64) -> String {
    if v == v.trunc() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write as _;

    fn apply(e: &mut FolioEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).unwrap().data
    }
    fn apply_err(e: &mut FolioEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }
    fn new_doc() -> FolioEngine {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({"pages": 1}));
        e
    }
    fn saved_pdf(e: &mut FolioEngine) -> Vec<u8> {
        let d = apply(e, "save", json!({}));
        b64_decode(d["bytes_b64"].as_str().unwrap()).unwrap()
    }

    /// Build a real PNG: signature + IHDR + one IDAT (zlib of the given
    /// already-filtered scanlines) + IEND, CRCs verified.
    fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(12 + data.len());
        v.extend_from_slice(&(data.len() as u32).to_be_bytes());
        v.extend_from_slice(kind);
        v.extend_from_slice(data);
        let mut crc_in = Vec::with_capacity(4 + data.len());
        crc_in.extend_from_slice(kind);
        crc_in.extend_from_slice(data);
        v.extend_from_slice(&crc32fast::hash(&crc_in).to_be_bytes());
        v
    }

    /// `scanlines` = per-row bytes INCLUDING the leading filter byte.
    fn make_png(
        width: u32,
        height: u32,
        depth: u8,
        color_type: u8,
        interlace: u8,
        scanlines: &[u8],
    ) -> Vec<u8> {
        let mut ihdr = Vec::with_capacity(13);
        ihdr.extend_from_slice(&width.to_be_bytes());
        ihdr.extend_from_slice(&height.to_be_bytes());
        ihdr.push(depth);
        ihdr.push(color_type);
        ihdr.push(0); // compression
        ihdr.push(0); // filter method
        ihdr.push(interlace);
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(scanlines).unwrap();
        let idat = enc.finish().unwrap();
        let mut png = PNG_SIGNATURE.to_vec();
        png.extend_from_slice(&png_chunk(b"IHDR", &ihdr));
        png.extend_from_slice(&png_chunk(b"IDAT", &idat));
        png.extend_from_slice(&png_chunk(b"IEND", &[]));
        png
    }

    /// Minimal structurally-valid JPEG marker stream ending at SOF0 —
    /// enough for the engine's header parse (it never decodes pixels).
    fn make_jpeg(width: u16, height: u16, components: u8) -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8];
        // SOF0: len = 2 + 1 + 2 + 2 + 1 + 3*ncomp
        let seg_len = 8 + 3 * components as usize;
        v.extend_from_slice(&[0xFF, 0xC0]);
        v.extend_from_slice(&(seg_len as u16).to_be_bytes());
        v.push(8); // precision
        v.extend_from_slice(&height.to_be_bytes());
        v.extend_from_slice(&width.to_be_bytes());
        v.push(components);
        for i in 1..=components {
            v.extend_from_slice(&[i, 0x22, 0]);
        }
        v.extend_from_slice(&[0xFF, 0xD9]);
        v
    }

    /// Locate the image XObject stream on page 0 of `doc`; returns the
    /// stream dict and its *decoded* sample bytes (DCTDecode content is
    /// returned verbatim — lopdf cannot inflate JPEG).
    fn page_image_stream(doc: &Document) -> (lopdf::Dictionary, Vec<u8>) {
        let page_id = *doc.get_pages().get(&1).unwrap();
        let images = doc.get_page_images(page_id).unwrap();
        assert_eq!(images.len(), 1, "expected exactly one image XObject");
        let img = &images[0];
        let stream = doc.get_object(img.id).unwrap().as_stream().unwrap();
        let content = match stream.dict.get(b"Filter") {
            // DCTDecode is verbatim JPEG; lopdf cannot inflate it.
            Ok(Object::Name(n)) if n.as_slice() == b"DCTDecode" => stream.content.clone(),
            // Unfiltered streams have no /Filter key at all.
            Err(_) => stream.content.clone(),
            _ => stream.decompressed_content().unwrap(),
        };
        (stream.dict.clone(), content)
    }

    #[test]
    fn raw_rgb_image_inserts_and_round_trips() {
        let mut e = new_doc();
        // 2x2 RGB: red, green, blue, white.
        let px = [
            255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
        ];
        let d = apply(
            &mut e,
            "insertPageImage",
            json!({
                "page": 0, "rect": [10, 20, 100, 50],
                "format": "raw", "width": 2, "height": 2,
                "color_space": "DeviceRGB", "image_b64": b64_encode(&px),
            }),
        );
        assert_eq!(d["ok"], true);
        assert_eq!(d["width"], 2);
        assert_eq!(d["height"], 2);
        assert_eq!(d["color_space"], "DeviceRGB");
        assert_eq!(d["format"], "raw");

        // Saved PDF parses; image XObject carries the right dict.
        let bytes = saved_pdf(&mut e);
        let doc = Document::load_mem(&bytes).unwrap();
        let (dict, samples) = page_image_stream(&doc);
        assert_eq!(dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Image");
        assert_eq!(dict.get(b"Width").unwrap().as_i64().unwrap(), 2);
        assert_eq!(dict.get(b"Height").unwrap().as_i64().unwrap(), 2);
        assert_eq!(
            dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
            b"DeviceRGB"
        );
        assert_eq!(samples, px);

        // The appended content stream places it at the rect.
        let page_id = *doc.get_pages().get(&1).unwrap();
        let content = doc.get_page_content(page_id).unwrap();
        let text = String::from_utf8_lossy(&content);
        assert!(text.contains(" cm\n"), "{text}");
        assert!(text.contains(" Do\n"), "{text}");
        assert!(text.contains("100 0 0 50 10 20 cm"), "{text}");

        // Undo removes image + content stream entirely. (lopdf's
        // get_page_images errors when /XObject is absent — treat as empty.)
        assert!(e.undo().unwrap());
        let bytes = saved_pdf(&mut e);
        let doc = Document::load_mem(&bytes).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        assert!(doc.get_page_images(page_id).map(|v| v.is_empty()).unwrap_or(true));
        assert!(doc.get_page_content(page_id).unwrap().is_empty());
    }

    #[test]
    fn raw_gray_and_validation_failures_preserve_state() {
        let mut e = new_doc();
        let before = e.serialize_doc().unwrap();
        let undo_len = e.journal.undo_len();
        // Wrong sample length.
        let err = apply_err(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"raw","width":2,"height":2,
                   "color_space":"DeviceGray","image_b64":b64_encode(&[0u8;3])}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
        // Bad color space / missing dims / bad format / bad page / bad rect.
        for p in [
            json!({"page":0,"rect":[0,0,10,10],"format":"raw","width":1,"height":1,"color_space":"DeviceCMYK","image_b64":b64_encode(&[0u8])}),
            json!({"page":0,"rect":[0,0,10,10],"format":"raw","width":1,"image_b64":b64_encode(&[0u8])}),
            json!({"page":0,"rect":[0,0,10,10],"format":"gif","image_b64":b64_encode(&[0u8])}),
            json!({"page":9,"rect":[0,0,10,10],"format":"raw","width":1,"height":1,"color_space":"DeviceGray","image_b64":b64_encode(&[0u8])}),
            json!({"page":0,"rect":[0,0,-1,10],"format":"raw","width":1,"height":1,"color_space":"DeviceGray","image_b64":b64_encode(&[0u8])}),
        ] {
            assert!(e.apply(Command::new("insertPageImage", p)).is_err());
        }
        assert_eq!(e.serialize_doc().unwrap(), before);
        assert_eq!(e.journal.undo_len(), undo_len);

        // 1x1 gray works.
        let d = apply(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,50,50],"format":"raw","width":1,"height":1,
                   "color_space":"DeviceGray","image_b64":b64_encode(&[128u8])}),
        );
        assert_eq!(d["color_space"], "DeviceGray");
    }

    #[test]
    fn png_rgb_and_alpha_decode_to_samples() {
        let mut e = new_doc();
        // 2x1 RGB, one filter-0 row: [filter][6 pixel bytes].
        let rgb = make_png(
            2,
            1,
            8,
            2,
            0,
            &[0, 255, 0, 0, 0, 255, 0],
        );
        let d = apply(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"png","image_b64":b64_encode(&rgb)}),
        );
        assert_eq!(d["width"], 2);
        assert_eq!(d["height"], 1);
        assert_eq!(d["color_space"], "DeviceRGB");
        let bytes = saved_pdf(&mut e);
        let doc = Document::load_mem(&bytes).unwrap();
        let (_, samples) = page_image_stream(&doc);
        assert_eq!(samples, vec![255, 0, 0, 0, 255, 0]);

        // 1x1 RGBA → alpha discarded → DeviceRGB, 3 bytes.
        let mut e2 = new_doc();
        let rgba = make_png(1, 1, 8, 6, 0, &[0, 10, 20, 30, 40]);
        let d = apply(
            &mut e2,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"png","image_b64":b64_encode(&rgba)}),
        );
        assert_eq!(d["color_space"], "DeviceRGB");
        let bytes = saved_pdf(&mut e2);
        let doc = Document::load_mem(&bytes).unwrap();
        let (dict, samples) = page_image_stream(&doc);
        assert_eq!(
            dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
            b"DeviceRGB"
        );
        assert_eq!(samples, vec![10, 20, 30]);

        // 1x1 gray+alpha → DeviceGray.
        let mut e3 = new_doc();
        let ga = make_png(1, 1, 8, 4, 0, &[0, 200, 255]);
        let d = apply(
            &mut e3,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"png","image_b64":b64_encode(&ga)}),
        );
        assert_eq!(d["color_space"], "DeviceGray");
        let bytes = saved_pdf(&mut e3);
        let doc = Document::load_mem(&bytes).unwrap();
        let (_, samples) = page_image_stream(&doc);
        assert_eq!(samples, vec![200]);
    }

    #[test]
    fn png_up_filter_and_split_idat_decode() {
        let mut e = new_doc();
        // 2x2 gray, rows use the Up filter on row 2: row0 = filter0+[10,20];
        // row1 = filter2+[5,5] → decoded = previous row + 5 = [15,25].
        // IDAT is split into two chunks — PNG IDATs concatenate into ONE
        // zlib stream, so the compressed bytes are split, not the raw rows.
        let mut png = PNG_SIGNATURE.to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 0, 0, 0, 0]);
        png.extend_from_slice(&png_chunk(b"IHDR", &ihdr));
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&[0u8, 10, 20, 2, 5, 5]).unwrap();
        let compressed = enc.finish().unwrap();
        let half = compressed.len() / 2;
        png.extend_from_slice(&png_chunk(b"IDAT", &compressed[..half]));
        png.extend_from_slice(&png_chunk(b"IDAT", &compressed[half..]));
        png.extend_from_slice(&png_chunk(b"IEND", &[]));
        let d = apply(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"png","image_b64":b64_encode(&png)}),
        );
        assert_eq!(d["color_space"], "DeviceGray");
        let bytes = saved_pdf(&mut e);
        let doc = Document::load_mem(&bytes).unwrap();
        let (_, samples) = page_image_stream(&doc);
        assert_eq!(samples, vec![10, 20, 15, 25]);
    }

    #[test]
    fn png_rejects_unsupported_and_corrupt() {
        let mut e = new_doc();
        let before = e.serialize_doc().unwrap();
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("palette", make_png(1, 1, 8, 3, 0, &[0, 0, 0, 0])),
            ("16-bit", make_png(1, 1, 16, 0, 0, &[0, 0, 0, 0])),
            ("interlaced", make_png(1, 1, 8, 0, 1, &[0, 0])),
            ("not png", b"hello".to_vec()),
            ("truncated", make_png(1, 1, 8, 0, 0, &[0, 0])[..20].to_vec()),
        ];
        for (name, bytes) in cases {
            let err = apply_err(
                &mut e,
                "insertPageImage",
                json!({"page":0,"rect":[0,0,10,10],"format":"png","image_b64":b64_encode(&bytes)}),
            );
            assert!(
                matches!(
                    err.code,
                    ignition_core::ErrorCode::Validation | ignition_core::ErrorCode::Unsupported
                ),
                "{name}: {err:?}"
            );
        }
        // CRC corruption: flip a byte inside IDAT data region.
        let mut bad = make_png(1, 1, 8, 0, 0, &[0, 42]);
        let n = bad.len();
        bad[n - 20] ^= 0xFF;
        assert!(e
            .apply(Command::new(
                "insertPageImage",
                json!({"page":0,"rect":[0,0,10,10],"format":"png","image_b64":b64_encode(&bad)})
            ))
            .is_err());
        assert_eq!(e.serialize_doc().unwrap(), before);
    }

    #[test]
    fn jpeg_passthrough_embeds_verbatim_dctdecode() {
        let mut e = new_doc();
        let jpg = make_jpeg(4, 3, 3);
        let d = apply(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"jpeg","image_b64":b64_encode(&jpg)}),
        );
        assert_eq!(d["width"], 4);
        assert_eq!(d["height"], 3);
        assert_eq!(d["color_space"], "DeviceRGB");
        assert_eq!(d["format"], "jpeg");
        let bytes = saved_pdf(&mut e);
        let doc = Document::load_mem(&bytes).unwrap();
        let (dict, content) = page_image_stream(&doc);
        assert_eq!(dict.get(b"Filter").unwrap().as_name().unwrap(), b"DCTDecode");
        assert_eq!(content, jpg, "jpeg bytes must pass through verbatim");
        // Reopened doc still lists the image.
        let images = doc
            .get_page_images(*doc.get_pages().get(&1).unwrap())
            .unwrap();
        assert_eq!(images[0].width, 4);
        assert_eq!(images[0].height, 3);

        // 1-component jpeg → DeviceGray; 4-component → Unsupported.
        let mut e2 = new_doc();
        let gray = make_jpeg(2, 2, 1);
        let d = apply(
            &mut e2,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"jpeg","image_b64":b64_encode(&gray)}),
        );
        assert_eq!(d["color_space"], "DeviceGray");
        let cmyk = make_jpeg(2, 2, 4);
        let err = apply_err(
            &mut e2,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"jpeg","image_b64":b64_encode(&cmyk)}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        // Non-jpeg bytes reject as Validation.
        let err = apply_err(
            &mut e2,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"jpeg","image_b64":b64_encode(b"notajpeg")}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Validation);
    }

    #[test]
    fn inherited_resources_are_cloned_not_mutated() {
        let mut e = new_doc();
        // Move /Resources from the page up to the /Pages root: the page
        // then inherits it. Insertion must clone, not mutate the parent.
        let page_id = e.page_id(0).unwrap();
        let pages_id = {
            let page = e.doc.get_object(page_id).unwrap().as_dict().unwrap();
            page.get(b"Parent").unwrap().as_reference().unwrap()
        };
        let res = e
            .doc
            .get_object(page_id)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .clone();
        e.doc
            .get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .remove(b"Resources");
        e.doc
            .get_object_mut(pages_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Resources", res);

        let px = [255u8, 0, 0];
        apply(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"raw","width":1,"height":1,
                   "color_space":"DeviceRGB","image_b64":b64_encode(&px)}),
        );
        // The parent's /Resources must NOT contain the new XObject.
        let parent_res = e
            .doc
            .get_object(pages_id)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(parent_res.get(b"XObject").is_err());
        // The page now owns a /Resources clone carrying the image.
        let page_res = e
            .doc
            .get_object(page_id)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(page_res.get(b"XObject").is_ok());
        // And the saved file still resolves the image through the page.
        let bytes = saved_pdf(&mut e);
        let doc = Document::load_mem(&bytes).unwrap();
        assert_eq!(doc.get_page_images(*doc.get_pages().get(&1).unwrap()).unwrap().len(), 1);
    }

    #[test]
    fn existing_contents_array_is_preserved() {
        let mut e = new_doc();
        // Give the page a real content stream first.
        let page_id = e.page_id(0).unwrap();
        let cid = e.doc.add_object(Object::Stream(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf (Hi) Tj ET".to_vec(),
        )));
        e.doc
            .get_object_mut(page_id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Contents", Object::Reference(cid));
        let px = [0u8, 0, 0];
        apply(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"raw","width":1,"height":1,
                   "color_space":"DeviceRGB","image_b64":b64_encode(&px)}),
        );
        // /Contents became a two-stream array; original stream untouched.
        let contents = e
            .doc
            .get_object(page_id)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Contents")
            .unwrap()
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(contents.len(), 2);
        let first = contents[0].as_reference().unwrap();
        assert_eq!(first, cid);
        // pageText still sees the original text.
        assert_eq!(apply(&mut e, "pageText", json!({"page":0}))["text"], "Hi");
    }

    #[test]
    fn insert_page_image_rejects_encrypted() {
        let mut e = new_doc();
        apply(&mut e, "encrypt", json!({"password": "pw"}));
        let err = apply_err(
            &mut e,
            "insertPageImage",
            json!({"page":0,"rect":[0,0,10,10],"format":"raw","width":1,"height":1,
                   "color_space":"DeviceRGB","image_b64":b64_encode(&[0u8,0,0])}),
        );
        assert_eq!(err.code, ignition_core::ErrorCode::Unsupported);
        assert_eq!(apply(&mut e, "info", json!({}))["encrypted"], true);
    }
}
