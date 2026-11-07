//! Media/footage layer references (slice H-schema): durable `media`
//! `{source_id, in_point}` storage only — no pixels. `source_id` is an
//! opaque host-owned reference the engine never resolves; real frame
//! transport is blocked on the P03 decoder contract, so media layers have
//! no in-engine pixels and `renderFrame` composites them as fully
//! transparent (documented limitation, never faked footage).
use serde::{Deserialize, Serialize};

/// `source_id` is a bounded opaque host reference: non-empty, at most 512
/// UTF-8 bytes, no control characters. The engine stores and round-trips
/// it verbatim; it performs no lookup, decode or validation against any
/// media catalog.
pub const MAX_SOURCE_ID_BYTES: usize = 512;
/// `in_point` is a nonnegative source-time offset in seconds, bounded by
/// the same 604800s ceiling as composition durations. It is authored
/// metadata only — nothing consumes it until the H transport slice maps
/// source time to frames.
pub const MAX_IN_POINT: f64 = 604800.;

/// The media content of a `kind:"media"` layer. Exactly one content source
/// per layer like every other kind; `media` may be absent on a media layer
/// (the `addParticlesLayer`/`emitter` precedent: an empty media layer
/// renders transparent until `setLayerMedia` attaches a spec).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayerMedia {
    /// Opaque host reference to decoded footage; never resolved in-engine.
    pub source_id: String,
    /// Source-time in-point in seconds (0..=604800); stored, not yet
    /// consumed by evaluation or rendering.
    #[serde(default)]
    pub in_point: f64,
}

impl LayerMedia {
    pub fn valid(&self) -> bool {
        !self.source_id.is_empty()
            && self.source_id.len() <= MAX_SOURCE_ID_BYTES
            && !self.source_id.chars().any(char::is_control)
            && self.in_point.is_finite()
            && (0. ..=MAX_IN_POINT).contains(&self.in_point)
    }
}
