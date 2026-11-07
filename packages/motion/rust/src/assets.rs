//! Owned immutable decoded RGBA8 assets; no codec, file or borrowed-buffer ownership.
use ignition_core::{base64_decode, base64_encode, EngineError};
use serde::{de::Error, Deserialize, Deserializer, Serialize, Serializer};
use std::sync::Arc;
pub const FORMAT: &str = "rgba8-straight-srgb";
pub const MAX_RGBA: usize = 4 * 1024 * 1024;
pub const MAX_ASSETS: usize = 16;
pub const MAX_RASTER_LAYERS: usize = 16;
pub const MAX_CANVAS_STORAGE: u64 = 16 * 1024 * 1024;
fn bad(message: &str) -> EngineError {
    EngineError::validation(message)
}
pub fn expected(width: u32, height: u32) -> Result<usize, EngineError> {
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width > 4096 || height > 4096 || pixels > 1_048_576 {
        return Err(bad("raster asset exceeds one-megapixel dimension budget"));
    }
    Ok((pixels * 4) as usize)
}
pub fn decode(text: &str, expected: usize) -> Result<Vec<u8>, EngineError> {
    if expected > MAX_RGBA || text.len() != expected.div_ceil(3) * 4 {
        return Err(bad("RGBA base64 length does not match bounded dimensions"));
    }
    let padding = (3 - expected % 3) % 3;
    if text.trim_end_matches('=').len() != text.len() - padding
        || !text.as_bytes()[..text.len() - padding]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'+' || *b == b'/')
    {
        return Err(bad("RGBA bytes require canonical base64 padding/alphabet"));
    }
    let bytes = base64_decode(text)?;
    // Core's common decoder is permissive; require canonical padding/alphabet/trailing bits here.
    if bytes.len() != expected || base64_encode(&bytes) != text {
        return Err(bad(
            "RGBA bytes require canonical base64 and exact dimensions",
        ));
    }
    Ok(bytes)
}
fn serialize_pixels<S: Serializer>(
    pixels: &Arc<Vec<u8>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&base64_encode(pixels))
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RasterAsset {
    pub id: u64,
    pub width: u32,
    pub height: u32,
    pub format: String,
    #[serde(rename = "pixels_b64", serialize_with = "serialize_pixels")]
    pub pixels: Arc<Vec<u8>>,
}
impl<'de> Deserialize<'de> for RasterAsset {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            id: u64,
            width: u32,
            height: u32,
            format: String,
            pixels_b64: String,
        }
        let wire = Wire::deserialize(deserializer)?;
        if wire.format != FORMAT {
            return Err(D::Error::custom("unsupported raster asset format"));
        }
        let length = expected(wire.width, wire.height).map_err(D::Error::custom)?;
        let pixels = decode(&wire.pixels_b64, length).map_err(D::Error::custom)?;
        Ok(Self {
            id: wire.id,
            width: wire.width,
            height: wire.height,
            format: wire.format,
            pixels: Arc::new(pixels),
        })
    }
}
pub fn initial_asset_id() -> u64 {
    1
}
/// Check total decoded dimensions and encoded lengths before any snapshot RGBA decoding.
pub fn preflight(value: &serde_json::Value) -> Result<(), EngineError> {
    let Some(assets) = value.get("assets") else {
        return Ok(());
    };
    let assets = assets
        .as_object()
        .ok_or_else(|| bad("raster assets must be an object"))?;
    if assets.len() > MAX_ASSETS {
        return Err(bad("raster asset count exceeded"));
    }
    let mut total = 0usize;
    for asset in assets.values() {
        let width = asset
            .get("width")
            .and_then(serde_json::Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| bad("invalid raster width"))?;
        let height = asset
            .get("height")
            .and_then(serde_json::Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| bad("invalid raster height"))?;
        let length = expected(width, height)?;
        total = total
            .checked_add(length)
            .filter(|v| *v <= MAX_RGBA)
            .ok_or_else(|| bad("decoded raster asset total exceeds 4 MiB"))?;
        let text = asset
            .get("pixels_b64")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| bad("raster asset bytes required"))?;
        if text.len() != length.div_ceil(3) * 4 {
            return Err(bad("raster encoded length mismatch"));
        }
    }
    Ok(())
}

pub fn is_initial_asset_id(id: &u64) -> bool {
    *id == 1
}
