//! nf-color: host-side ICC color-management provider.
//!
//! This crate is the "provider outside the engines" described in
//! `docs/completion/reports/P07-icc-color-management-decision.md`. It wraps
//! **moxcms 0.8.1** (BSD-3-Clause OR Apache-2.0, pure Rust, already in the
//! workspace lockfile via `image` 0.25 / `folio-render`) and serves bounded,
//! synchronous CPU transforms over in-memory buffers. Like `nf-raw` and
//! `folio-render` it is **not** an `ignition_core::Engine`: no `EngineKind`,
//! no `Command`/`Journal`, no `NFD1` snapshot, no document I/O. Engines keep
//! `rgba8-straight-sRGB` as their single working space; color-managed
//! preview/proof/gamut are host-side transforms of engine output pixels.
//!
//! v1 scope (per the decision record):
//! - Profile parsing of host-supplied ICC bytes with explicit size/parse
//!   bounds (untrusted-input surface; see [`MAX_PROFILE_BYTES`]).
//! - Built-in matrix/TRC profiles: sRGB, Display-P3, Rec.2020, Adobe RGB,
//!   ProPhoto.
//! - RGB / RGBA / CMYK / Gray / Gray+Alpha interleaved buffer transforms
//!   with all four ICC rendering intents.
//! - sRGB ↔ profile transforms (any supported profile pair).
//! - Chained soft-proof: document space → proof profile → display space.
//! - Gamut measurement by out-of-range detection plus a round-trip
//!   cross-check (approximation of lcms `cmsFLAGS_GAMUTCHECK`; the method
//!   and thresholds are part of the contract — see [`GamutReport`]).

use std::sync::{Arc, OnceLock};

use moxcms::{
    ColorProfile, CmsError, DataColorSpace, Layout, ParsingOptions, ProfileClass, ProfileText,
    RenderingIntent as MoxIntent, Transform8BitExecutor, TransformF32Executor, TransformOptions,
};

#[cfg(test)]
mod tests;

// ---- Bounds (P07 decision record: "profile provenance", "transform cost") ----

/// Maximum accepted ICC profile size in bytes. moxcms's own parser default
/// is 10 MiB; we tighten it because host-supplied profiles are untrusted
/// input and every byte is parsed. 8 MiB covers real-world output profiles
/// (FOGRA/SWOP class, ~0.5–3 MiB) with headroom.
pub const MAX_PROFILE_BYTES: usize = 8 * 1024 * 1024;

/// Maximum pixels per transform call (fail-closed budget; the decision
/// record requires a megapixel cap until LUT cost is measured for live
/// preview). 16 MP at 4 channels u8 = 64 MiB per buffer.
pub const MAX_TRANSFORM_PIXELS: u64 = 16_777_216;

/// Maximum byte length of one transform buffer (src or dst). For f32
/// buffers the effective sample cap is `MAX_TRANSFORM_BYTES / 4` bytes of
/// f32 data per slice.
pub const MAX_TRANSFORM_BYTES: usize = 64 * 1024 * 1024;

/// f32 tolerance when flagging out-of-gamut proof channels. Values outside
/// `[-GAMUT_EPSILON, 1 + GAMUT_EPSILON]` count as out of range.
pub const GAMUT_EPSILON: f32 = 1.0 / 255.0;

/// Round-trip delta (in source-space normalized units) above which a pixel
/// is counted as gamut-clipped by the round-trip cross-check.
pub const GAMUT_ROUNDTRIP_DELTA: f32 = 2.0 / 255.0;

// ---- Errors ----

/// Typed provider errors. Never panics on hostile input; all failures are
/// reported here.
#[derive(Clone, Debug, PartialEq)]
pub enum ColorError {
    /// Argument failed local validation (empty buffer, bad length, channel
    /// mismatch, unsupported profile class for the requested layout).
    InvalidInput(&'static str),
    /// A documented bound was exceeded (profile size, pixel count, buffer
    /// bytes).
    LimitExceeded(&'static str),
    /// ICC profile bytes failed to parse or exceeded parse limits.
    ProfileParse(String),
    /// The profile pair / channel layout has no supported transform
    /// connection in moxcms 0.8.1.
    Unsupported(String),
    /// Transform construction or execution failed inside moxcms.
    Transform(String),
}

impl std::fmt::Display for ColorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ColorError::InvalidInput(r) => write!(f, "invalid nf-color input: {r}"),
            ColorError::LimitExceeded(r) => write!(f, "nf-color limit exceeded: {r}"),
            ColorError::ProfileParse(e) => write!(f, "ICC profile rejected: {e}"),
            ColorError::Unsupported(e) => write!(f, "unsupported color transform: {e}"),
            ColorError::Transform(e) => write!(f, "color transform failed: {e}"),
        }
    }
}

impl std::error::Error for ColorError {}

fn map_cms(e: CmsError) -> ColorError {
    ColorError::Transform(e.to_string())
}

// ---- Public vocabulary ----

/// ICC rendering intent. Maps 1:1 onto moxcms `RenderingIntent`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Intent {
    #[default]
    Perceptual,
    RelativeColorimetric,
    Saturation,
    AbsoluteColorimetric,
}

impl Intent {
    fn to_mox(self) -> MoxIntent {
        match self {
            Intent::Perceptual => MoxIntent::Perceptual,
            Intent::RelativeColorimetric => MoxIntent::RelativeColorimetric,
            Intent::Saturation => MoxIntent::Saturation,
            Intent::AbsoluteColorimetric => MoxIntent::AbsoluteColorimetric,
        }
    }
}

/// Interleaved sample layout of a pixel buffer, in the semantic sense the
/// host works with. Channel counts: Rgb=3, Rgba=4, Cmyk=4 (C,M,Y,K order),
/// Gray=1, GrayAlpha=2.
///
/// moxcms mapping note: a CMYK buffer is `Layout::Rgba` on a profile whose
/// `color_space` is `DataColorSpace::Cmyk`; alpha-carrying CMYK
/// (`Layout::Cmyka`, 5 channels) is intentionally not exposed in v1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Channels {
    Rgb,
    Rgba,
    Cmyk,
    Gray,
    GrayAlpha,
}

impl Channels {
    /// Samples per pixel.
    pub fn count(self) -> usize {
        match self {
            Channels::Rgb => 3,
            Channels::Rgba | Channels::Cmyk => 4,
            Channels::Gray => 1,
            Channels::GrayAlpha => 2,
        }
    }

    fn to_layout(self) -> Layout {
        match self {
            Channels::Rgb => Layout::Rgb,
            Channels::Rgba | Channels::Cmyk => Layout::Rgba,
            Channels::Gray => Layout::Gray,
            Channels::GrayAlpha => Layout::GrayAlpha,
        }
    }

    /// moxcms layout for this channel count on a profile with the given
    /// data colour space, or `None` when the combination is unsupported.
    fn for_color_space(self, space: DataColorSpace) -> Option<Layout> {
        let ok = match (self, space) {
            (Channels::Rgb | Channels::Rgba, DataColorSpace::Rgb) => true,
            (Channels::Gray | Channels::GrayAlpha, DataColorSpace::Gray) => true,
            (Channels::Cmyk, DataColorSpace::Cmyk) => true,
            _ => false,
        };
        ok.then(|| self.to_layout())
    }
}

/// Coarse description of a loaded profile for host UI (e.g. the NYC-Tron
/// `ColorSpaceChooser` needs a label and a channel class).
#[derive(Clone, Debug, PartialEq)]
pub struct ProfileInfo {
    /// ICC profile class signature: `"scnr"`, `"mntr"`, `"prtr"`, `"link"`,
    /// `"spac"`, `"abst"` or `"nmcl"`.
    pub class: &'static str,
    /// Data colour space signature, e.g. `"RGB "`, `"CMYK"`, `"GRAY"`.
    pub color_space: &'static str,
    /// PCS signature, e.g. `"XYZ "`, `"Lab "`.
    pub pcs: &'static str,
    /// Best-effort profile description (first text value found).
    pub description: Option<String>,
}

fn class_name(c: ProfileClass) -> &'static str {
    match c {
        ProfileClass::InputDevice => "scnr",
        ProfileClass::DisplayDevice => "mntr",
        ProfileClass::OutputDevice => "prtr",
        ProfileClass::DeviceLink => "link",
        ProfileClass::ColorSpace => "spac",
        ProfileClass::Abstract => "abst",
        ProfileClass::Named => "nmcl",
    }
}

fn space_name(s: DataColorSpace) -> &'static str {
    match s {
        DataColorSpace::Xyz => "XYZ ",
        DataColorSpace::Lab => "Lab ",
        DataColorSpace::Luv => "Luv ",
        DataColorSpace::YCbr => "YCbr",
        DataColorSpace::Yxy => "Yxy ",
        DataColorSpace::Rgb => "RGB ",
        DataColorSpace::Gray => "GRAY",
        DataColorSpace::Hsv => "HSV ",
        DataColorSpace::Hls => "HLS ",
        DataColorSpace::Cmyk => "CMYK",
        DataColorSpace::Cmy => "CMY ",
        DataColorSpace::Color2 => "2CLR",
        DataColorSpace::Color3 => "3CLR",
        DataColorSpace::Color4 => "4CLR",
        DataColorSpace::Color5 => "5CLR",
        DataColorSpace::Color6 => "6CLR",
        DataColorSpace::Color7 => "7CLR",
        DataColorSpace::Color8 => "8CLR",
        DataColorSpace::Color9 => "9CLR",
        DataColorSpace::Color10 => "10CL",
        DataColorSpace::Color11 => "11CL",
        DataColorSpace::Color12 => "12CL",
        DataColorSpace::Color13 => "13CL",
        DataColorSpace::Color14 => "14CL",
        DataColorSpace::Color15 => "15CL",
    }
}

fn first_text(t: &Option<ProfileText>) -> Option<String> {
    t.as_ref().and_then(|p| match p {
        ProfileText::PlainString(s) => Some(s.clone()),
        ProfileText::Localizable(l) => l.first().map(|r| r.value.clone()),
        ProfileText::Description(d) => {
            if !d.ascii_string.is_empty() {
                Some(d.ascii_string.clone())
            } else {
                Some(d.unicode_string.clone()).filter(|s| !s.is_empty())
            }
        }
    })
}

// ---- Profile ----

/// A parsed ICC profile (built-in or host-supplied bytes). Cheap to clone;
/// moxcms profiles are plain data with no interior mutability.
#[derive(Clone, Debug)]
pub struct Profile {
    inner: ColorProfile,
}

impl Profile {
    /// Parses host-supplied ICC profile bytes.
    ///
    /// Bounds: `bytes` must be non-empty, `< MAX_PROFILE_BYTES`, and must
    /// pass moxcms parsing with its default CLUT/TRC caps. This is the
    /// untrusted-input entry point; malformed or hostile profiles are
    /// rejected with [`ColorError::ProfileParse`] (or
    /// [`ColorError::LimitExceeded`]) without panicking.
    pub fn from_icc(bytes: &[u8]) -> Result<Profile, ColorError> {
        if bytes.is_empty() {
            return Err(ColorError::InvalidInput("empty ICC profile"));
        }
        if bytes.len() >= MAX_PROFILE_BYTES {
            return Err(ColorError::LimitExceeded("ICC profile exceeds MAX_PROFILE_BYTES"));
        }
        let options = ParsingOptions {
            max_profile_size: MAX_PROFILE_BYTES,
            ..Default::default()
        };
        let inner = ColorProfile::new_from_slice_with_options(bytes, options)
            .map_err(|e| ColorError::ProfileParse(e.to_string()))?;
        Ok(Profile { inner })
    }

    /// Built-in sRGB (IEC 61966-2-1 matrix/TRC profile synthesized by moxcms).
    pub fn srgb() -> Profile {
        Profile {
            inner: ColorProfile::new_srgb(),
        }
    }

    /// Built-in Display-P3.
    pub fn display_p3() -> Profile {
        Profile {
            inner: ColorProfile::new_display_p3(),
        }
    }

    /// Built-in Rec.2020 (`new_bt2020`).
    pub fn rec2020() -> Profile {
        Profile {
            inner: ColorProfile::new_bt2020(),
        }
    }

    /// Built-in Adobe RGB (1998).
    pub fn adobe_rgb() -> Profile {
        Profile {
            inner: ColorProfile::new_adobe_rgb(),
        }
    }

    /// Built-in ProPhoto RGB (ROMM).
    pub fn prophoto() -> Profile {
        Profile {
            inner: ColorProfile::new_pro_photo_rgb(),
        }
    }

    /// Coarse profile description for UI labeling.
    pub fn info(&self) -> ProfileInfo {
        ProfileInfo {
            class: class_name(self.inner.profile_class),
            color_space: space_name(self.inner.color_space),
            pcs: space_name(self.inner.pcs),
            description: first_text(&self.inner.description),
        }
    }

    /// The profile's declared data colour space (used for layout checks).
    pub fn color_space(&self) -> DataColorSpace {
        self.inner.color_space
    }

    /// The profile's profile-connection space.
    pub fn pcs(&self) -> DataColorSpace {
        self.inner.pcs
    }

    /// ICC profile class.
    pub fn class(&self) -> ProfileClass {
        self.inner.profile_class
    }
}

// ---- Transform ----

fn transform_options(intent: Intent) -> TransformOptions {
    TransformOptions {
        rendering_intent: intent.to_mox(),
        ..TransformOptions::default()
    }
}

/// A cached ICC transform between two profiles with fixed channel layouts
/// and one rendering intent. Construction validates the connection once;
/// `transform_*` calls are pure CPU work over caller buffers (synchronous,
/// single-threaded, I/O-free — matching engine-threading rules if a host
/// ever runs this on an engine worker).
///
/// Buffers are interleaved samples, normalized to `[0, 255]` for u8 and
/// `[0, 1]` nominally for f32 (moxcms may emit extended-range f32 values
/// outside `[0,1]`; gamut code relies on that). Alpha channels (Rgba,
/// GrayAlpha) pass through untransformed. CMYK uses 4-channel C,M,Y,K
/// order — note ICC CMYK is *process* CMYK, not spot separations (C-14/C-15
/// stay separate per the decision record).
#[derive(Clone)]
pub struct Transform {
    exec8: Arc<Transform8BitExecutor>,
    src_layout: Layout,
    dst_layout: Layout,
    // f32 executor is built lazily: gamut/soft-proof paths need it, plain
    // 8-bit preview paths do not, and LUT build cost is real.
    exec32: Arc<OnceLock<Result<Arc<TransformF32Executor>, String>>>,
    src_channels: Channels,
    dst_channels: Channels,
    src_profile: Profile,
    dst_profile: Profile,
    intent: Intent,
}

impl Transform {
    /// Builds a transform `src_profile[src_channels] → dst_profile[dst_channels]`
    /// under `intent`.
    ///
    /// Channel layouts are validated against each profile's declared data
    /// colour space: RGB profiles take `Rgb`/`Rgba`, Gray profiles take
    /// `Gray`/`GrayAlpha`, CMYK profiles take `Cmyk`. Anything else (Lab/XYZ
    /// device endpoints, mismatched layouts) is rejected with
    /// [`ColorError::Unsupported`] or [`ColorError::InvalidInput`].
    pub fn new(
        src_profile: &Profile,
        dst_profile: &Profile,
        src_channels: Channels,
        dst_channels: Channels,
        intent: Intent,
    ) -> Result<Transform, ColorError> {
        let src_layout = src_channels
            .for_color_space(src_profile.color_space())
            .ok_or_else(|| {
                ColorError::Unsupported(format!(
                    "layout {:?} incompatible with source profile colour space {}",
                    src_channels,
                    space_name(src_profile.color_space())
                ))
            })?;
        let dst_layout = dst_channels
            .for_color_space(dst_profile.color_space())
            .ok_or_else(|| {
                ColorError::Unsupported(format!(
                    "layout {:?} incompatible with destination profile colour space {}",
                    dst_channels,
                    space_name(dst_profile.color_space())
                ))
            })?;
        let options = transform_options(intent);
        let exec8 = src_profile
            .inner
            .create_transform_8bit(src_layout, &dst_profile.inner, dst_layout, options)
            .map_err(map_cms)?;
        Ok(Transform {
            exec8,
            src_layout,
            dst_layout,
            exec32: Arc::new(OnceLock::new()),
            src_channels,
            dst_channels,
            src_profile: src_profile.clone(),
            dst_profile: dst_profile.clone(),
            intent,
        })
    }

    /// Rendering intent this transform was built with.
    pub fn intent(&self) -> Intent {
        self.intent
    }

    /// Source channel layout.
    pub fn src_channels(&self) -> Channels {
        self.src_channels
    }

    /// Destination channel layout.
    pub fn dst_channels(&self) -> Channels {
        self.dst_channels
    }

    /// Source profile this transform was built from.
    pub fn src_profile(&self) -> &Profile {
        &self.src_profile
    }

    /// Destination profile this transform was built for.
    pub fn dst_profile(&self) -> &Profile {
        &self.dst_profile
    }

    fn check_len(
        src_len: usize,
        dst_len: usize,
        src_ch: usize,
        dst_ch: usize,
    ) -> Result<u64, ColorError> {
        if src_len % src_ch != 0 {
            return Err(ColorError::InvalidInput(
                "source buffer length is not a multiple of the source channel count",
            ));
        }
        if dst_len % dst_ch != 0 {
            return Err(ColorError::InvalidInput(
                "destination buffer length is not a multiple of the destination channel count",
            ));
        }
        let pixels = (src_len / src_ch) as u64;
        if pixels != (dst_len / dst_ch) as u64 {
            return Err(ColorError::InvalidInput(
                "source and destination pixel counts differ",
            ));
        }
        if pixels > MAX_TRANSFORM_PIXELS {
            return Err(ColorError::LimitExceeded(
                "transform exceeds MAX_TRANSFORM_PIXELS",
            ));
        }
        Ok(pixels)
    }

    /// Transforms interleaved u8 samples. `src` and `dst` are separate
    /// slices with equal pixel counts. Returns the number of pixels
    /// transformed. Alpha channels pass through.
    pub fn transform_u8(&self, src: &[u8], dst: &mut [u8]) -> Result<u64, ColorError> {
        let pixels = Self::check_len(
            src.len(),
            dst.len(),
            self.src_channels.count(),
            self.dst_channels.count(),
        )?;
        if src.len() > MAX_TRANSFORM_BYTES || dst.len() > MAX_TRANSFORM_BYTES {
            return Err(ColorError::LimitExceeded(
                "transform buffer exceeds MAX_TRANSFORM_BYTES",
            ));
        }
        self.exec8.transform(src, dst).map_err(map_cms)?;
        Ok(pixels)
    }

    fn exec32(&self) -> Result<&Arc<TransformF32Executor>, ColorError> {
        self.exec32
            .get_or_init(|| {
                // extended_range is enabled at the Cargo level; opting in
                // here keeps matrix-shaper f32 transforms unclipped so
                // gamut code can see out-of-range values.
                let options = TransformOptions {
                    allow_extended_range_rgb_xyz: true,
                    ..transform_options(self.intent)
                };
                self.src_profile
                    .inner
                    .create_transform_f32(
                        self.src_layout,
                        &self.dst_profile.inner,
                        self.dst_layout,
                        options,
                    )
                    .map_err(|e| e.to_string())
            })
            .as_ref()
            .map_err(|e| ColorError::Transform(format!("f32 transform build failed: {e}")))
    }

    /// Transforms interleaved normalized f32 samples (`[0,1]` nominally;
    /// moxcms may return extended-range values outside `[0,1]` — gamut code
    /// relies on that). Returns pixels transformed.
    pub fn transform_f32(&self, src: &[f32], dst: &mut [f32]) -> Result<u64, ColorError> {
        let pixels = Self::check_len(
            src.len(),
            dst.len(),
            self.src_channels.count(),
            self.dst_channels.count(),
        )?;
        // f32 is 4 bytes/sample; apply the byte budget to the sample count.
        if src.len().saturating_mul(4) > MAX_TRANSFORM_BYTES
            || dst.len().saturating_mul(4) > MAX_TRANSFORM_BYTES
        {
            return Err(ColorError::LimitExceeded(
                "transform buffer exceeds MAX_TRANSFORM_BYTES",
            ));
        }
        if src.iter().any(|v| !v.is_finite()) {
            return Err(ColorError::InvalidInput("non-finite source sample"));
        }
        let exec = self.exec32()?;
        exec.transform(src, dst).map_err(map_cms)?;
        Ok(pixels)
    }

    /// Convenience: built-in sRGB → `dst` profile, `intent`, RGBA buffers.
    pub fn from_srgb(
        dst_profile: &Profile,
        dst_channels: Channels,
        intent: Intent,
    ) -> Result<Transform, ColorError> {
        Transform::new(
            &Profile::srgb(),
            dst_profile,
            Channels::Rgba,
            dst_channels,
            intent,
        )
    }
}

// ---- Soft proof (C-25) ----

/// Channel layout used when a profile's role doesn't dictate one: RGB
/// profiles get RGBA (alpha passthrough for engine RGBA8 buffers), Gray
/// profiles get Gray, CMYK profiles get Cmyk.
fn default_channels(p: &Profile) -> Result<Channels, ColorError> {
    match p.color_space() {
        DataColorSpace::Rgb => Ok(Channels::Rgba),
        DataColorSpace::Gray => Ok(Channels::Gray),
        DataColorSpace::Cmyk => Ok(Channels::Cmyk),
        other => Err(ColorError::Unsupported(format!(
            "profile colour space {} has no default v1 channel layout",
            space_name(other)
        ))),
    }
}

/// Chained soft-proof transform: document space → proof profile → display
/// space, both legs under the caller's selected [`Intent`]. This matches
/// the decision record: paper/ink simulation is profile-driven (the output
/// profile encodes it); there is no bespoke ink model in v1.
///
/// The proof-space intermediate is **not** gamut-clipped on the f32 path —
/// out-of-range values are exactly what [`GamutMeter`] measures. The u8
/// path goes through the fixed-point pipeline and produces displayable
/// bytes.
pub struct SoftProof {
    doc_to_proof: Transform,
    proof_to_display: Transform,
}

impl SoftProof {
    /// `doc` is typically [`Profile::srgb`]; `proof` is the selected output
    /// (paper/ink) profile; `display` is the target display profile (sRGB
    /// fallback when the host has no ICC display profile — the honest
    /// default per the decision record).
    pub fn new(
        doc: &Profile,
        proof: &Profile,
        display: &Profile,
        intent: Intent,
    ) -> Result<SoftProof, ColorError> {
        let doc_ch = default_channels(doc)?;
        let proof_ch = default_channels(proof)?;
        let display_ch = default_channels(display)?;
        let doc_to_proof = Transform::new(doc, proof, doc_ch, proof_ch, intent)?;
        let proof_to_display =
            Transform::new(proof, display, proof_ch, display_ch, intent)?;
        Ok(SoftProof {
            doc_to_proof,
            proof_to_display,
        })
    }

    /// u8 chained proof. `src`/`dst` are doc-space interleaved u8 samples
    /// (typically RGBA8 straight alpha) with equal pixel counts; returns
    /// pixels transformed.
    pub fn transform_u8(&self, src: &[u8], dst: &mut [u8]) -> Result<u64, ColorError> {
        let proof_ch = self.doc_to_proof.dst_channels().count();
        let pixels = src.len() / self.doc_to_proof.src_channels().count();
        let mut mid = vec![0u8; pixels * proof_ch];
        self.doc_to_proof.transform_u8(src, &mut mid)?;
        self.proof_to_display.transform_u8(&mid, dst)
    }

    /// f32 chained proof with extended-range intermediates. `src`/`dst` are
    /// normalized f32 samples in doc space / display space. Allocates one
    /// scratch buffer internally (proof leg) — acceptable at preview scale;
    /// batch hosts should chunk below [`MAX_TRANSFORM_PIXELS`].
    pub fn transform_f32(&self, src: &[f32], dst: &mut [f32]) -> Result<u64, ColorError> {
        let proof_ch = self.doc_to_proof.dst_channels().count();
        let pixels = src.len() / self.doc_to_proof.src_channels().count();
        let mut mid = vec![0f32; pixels * proof_ch];
        self.doc_to_proof.transform_f32(src, &mut mid)?;
        self.proof_to_display.transform_f32(&mid, dst)
    }
}

// ---- Gamut measurement (C-10) ----

/// Result of a gamut measurement pass. Counts are pixels, not samples.
///
/// Method (contract — the decision record requires the method and
/// thresholds to be stated):
/// 1. `out_of_range`: transform source → proof in f32; a pixel counts when
///    any proof channel lands outside `[-GAMUT_EPSILON, 1+GAMUT_EPSILON]`.
///    This is the primary signal and works for RGB *and* CMYK proof
///    profiles.
/// 2. `roundtrip_mismatch`: the proof-space result is transformed back to
///    the source space; a pixel counts when any source channel differs
///    from the original by more than [`GAMUT_ROUNDTRIP_DELTA`]. This is an
///    approximation cross-check — moxcms has no `cmsFLAGS_GAMUTCHECK`
///    equivalent — and also catches in-gamut-but-heavily-remapped colors.
///
/// `unknown` vs measured: callers distinguish "no measurement ran" (never
/// constructed a [`GamutMeter`]) from these counts — `GamutWarning`'s
/// contract already separates the two states.
#[derive(Clone, Debug, PartialEq)]
pub struct GamutReport {
    /// Pixels examined.
    pub pixels: u64,
    /// Pixels whose proof-space channels left `[0,1]` (±epsilon).
    pub out_of_range: u64,
    /// Pixels failing the round-trip delta check.
    pub roundtrip_mismatch: u64,
    /// Pixels flagged by either method (union).
    pub total_flagged: u64,
    /// Method/threshold descriptor for UI copy and audit.
    pub method: &'static str,
}

/// Reusable gamut meter for one (source profile, proof profile, intent)
/// triple. Holds the forward transform and builds/caches the reverse
/// transform on first [`GamutMeter::measure_f32`].
pub struct GamutMeter {
    to_proof: Transform,
    back: OnceLock<Result<Transform, String>>,
    proof_channels: Channels,
}

impl GamutMeter {
    /// `src_channels` describes the input buffer layout (e.g.
    /// `Channels::Rgba` for RGBA8 engine output). The proof profile's
    /// channel layout is derived from its colour space (RGB or CMYK proof
    /// both supported).
    pub fn new(
        src_profile: &Profile,
        proof_profile: &Profile,
        src_channels: Channels,
        intent: Intent,
    ) -> Result<GamutMeter, ColorError> {
        let proof_ch = default_channels(proof_profile)?;
        let to_proof = Transform::new(src_profile, proof_profile, src_channels, proof_ch, intent)?;
        Ok(GamutMeter {
            to_proof,
            back: OnceLock::new(),
            proof_channels: proof_ch,
        })
    }

    /// Measures `src` (interleaved normalized f32 in source space) against
    /// the proof profile. `dst` must hold `pixels * proof_channels.count()`
    /// f32 and is used as scratch for the proof-space intermediate (its
    /// contents on return are unspecified). Returns the [`GamutReport`].
    pub fn measure_f32(&self, src: &[f32], dst: &mut [f32]) -> Result<GamutReport, ColorError> {
        let src_ch = self.to_proof.src_channels().count();
        let proof_ch = self.proof_channels.count();
        let pixels = self.to_proof.transform_f32(src, dst)? as usize;

        let back = self
            .back
            .get_or_init(|| {
                Transform::new(
                    self.to_proof.dst_profile(),
                    self.to_proof.src_profile(),
                    self.proof_channels,
                    self.to_proof.src_channels(),
                    self.to_proof.intent(),
                )
                .map_err(|e| e.to_string())
            })
            .as_ref()
            .map_err(|e| ColorError::Transform(format!("gamut round-trip build failed: {e}")))?;

        // Round-trip: proof → source, compare against the original.
        let mut rt = vec![0f32; src.len()];
        back.transform_f32(dst, &mut rt)?;

        let mut out_of_range = 0u64;
        let mut roundtrip = 0u64;
        let mut flagged = 0u64;
        for i in 0..pixels {
            let mut oor = false;
            for c in 0..proof_ch {
                let v = dst[i * proof_ch + c];
                if v < -GAMUT_EPSILON || v > 1.0 + GAMUT_EPSILON {
                    oor = true;
                    break;
                }
            }
            if oor {
                out_of_range += 1;
            }
            let mut bad = false;
            for c in 0..src_ch {
                let d = (rt[i * src_ch + c] - src[i * src_ch + c]).abs();
                if d > GAMUT_ROUNDTRIP_DELTA {
                    bad = true;
                    break;
                }
            }
            if bad {
                roundtrip += 1;
            }
            if oor || bad {
                flagged += 1;
            }
        }
        Ok(GamutReport {
            pixels: pixels as u64,
            out_of_range,
            roundtrip_mismatch: roundtrip,
            total_flagged: flagged,
            method: "f32 proof-space out-of-range (eps=1/255) OR round-trip delta>2/255",
        })
    }
}
