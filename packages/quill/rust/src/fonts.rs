//! Session font registry and deterministic advance metrics for Quill.
//!
//! Implements the engine side of `docs/completion/reports/
//! P-font-glyph-backend-decision.md` (hybrid option c on the (a) stack):
//! the host resolves family names to font *bytes*, which arrive through the
//! binary-input channel (`registerFont` accepts `bytes_b64` or the command
//! sidecar). The engine parses those exact bytes once with `skrifa`
//! (read-fonts underneath, re-exported as `skrifa::raw`) and keeps the
//! parsed `Font` — an `Arc`-backed owning value, cheap to clone — for
//! deterministic advance-width queries. Font *identity* — family, content
//! sha256, face index — is what `listFonts` reports.
//!
//! What this slice does and does not do, honestly:
//!
//! - **Measured**: per-character horizontal advance widths from the font's
//!   `cmap` + unhinted `hmtx` metrics, scaled linearly
//!   `advance_units * font_size / units_per_em`. No hinting, no variations,
//!   no autohinting (`skrifa` is pinned `default-features = false` +
//!   `"std"`, which excludes `autohint_shaping` — decision doc open point
//!   6).
//! - **Not shaped**: no `harfrust` pass — no kerning, ligatures, mark
//!   attachment, or bidi reordering. Shaped glyph output is not
//!   prefix-additive under reordering/ligatures, so the per-line prefix
//!   widths greedy wrap needs stay honest only for unshaped advances.
//!   `harfrust` admission is deferred to the shaping slice; the decision
//!   doc's shaping-scope question (point 3) is moot until then.
//! - **Not rendered**: no glyph outlines are drawn; rasterization stays
//!   host-side (or a later skrifa-outline → Prism slice). `layout` returns
//!   the same `{pages:[{lines:[{block,start,end}]}]}` spans as before.
//!
//! Session discipline: the registry is engine-session state, NOT document
//! state. It is excluded from `snapshot`/`restore`, from the undo journal,
//! and from `new` — a document never references font bytes (the doc's
//! "identity in docs, bytes host-owned" rule; no document field names a
//! registered face yet). `registerFont`/`removeFont` therefore emit
//! `document:changed` (observable read results change) but are not undone;
//! hosts re-register fonts per session/document as needed.
//!
//! Bounds (decision doc open point 5, approved values): ≤16 MiB per face,
//! ≤64 faces per engine session, ≤256 MiB total admitted font bytes.
//! Validation is atomic: every check runs before any state mutation, and a
//! corrupt/hostile font file is a validation error, never a panic (the
//! parse runs under `catch_unwind` because `skrifa` is fuzz-tested but the
//! engine must not rely on that for session safety).

use ignition_core::EngineError;
use sha2::{Digest, Sha256};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

/// Decision doc budget: largest single font face admitted.
pub const MAX_FONT_FACE_BYTES: usize = 16 * 1024 * 1024;
/// Decision doc budget: faces registered per engine session.
pub const MAX_FONT_FACES: usize = 64;
/// Decision doc budget: total admitted font bytes per session.
pub const MAX_FONT_TOTAL_BYTES: usize = 256 * 1024 * 1024;

/// One admitted font face: host-claimed family plus engine-verified
/// identity (sha256 of the exact bytes, face index inside a collection)
/// and the parsed font itself.
pub struct FontFace {
    pub family: String,
    pub sha256: String,
    pub face_index: u32,
    pub units_per_em: u16,
    pub num_glyphs: u32,
    /// Admitted byte length, kept for the session budget after the bytes
    /// themselves moved into the parsed `Font`'s shared blob.
    byte_len: usize,
    font: skrifa::Font,
}

/// What `registerFont` returns for both fresh registrations and dedup hits.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FontInfo {
    pub family: String,
    pub sha256: String,
    pub face_index: u32,
    pub units_per_em: u16,
    pub num_glyphs: u32,
    /// `false` when the (family, sha256, face_index) triple was already
    /// registered — the call was a no-op.
    pub registered: bool,
}

/// Session-scoped font table. `Clone` is cheap: `Font` clones share one
/// `Arc`'d blob, so `__batch` staging does not copy font bytes.
#[derive(Default, Clone)]
pub struct FontRegistry {
    faces: Vec<Arc<FontFace>>,
    total_bytes: usize,
}

impl FontRegistry {
    /// First registered face for `family` (exact match, registration
    /// order). Multi-face families (e.g. separate bold files under one
    /// family name) resolve to the earliest registration; richer family→
    /// face selection is deferred with the shaping slice.
    pub fn find(&self, family: &str) -> Option<&Arc<FontFace>> {
        self.faces.iter().find(|f| f.family == family)
    }

    /// All faces in registration order, for `listFonts`.
    pub fn faces(&self) -> &[Arc<FontFace>] {
        &self.faces
    }

    /// Validate and admit one font face. Atomic: all bounds and the parse
    /// check complete before `self` is touched. Re-registering an
    /// identical `(family, sha256, face_index)` triple is an idempotent
    /// no-op that still reports the face's metrics.
    pub fn register(
        &mut self,
        family: &str,
        face_index: u32,
        bytes: Vec<u8>,
    ) -> Result<FontInfo, EngineError> {
        crate::validate_font_family(family)?;
        if bytes.is_empty() {
            return Err(EngineError::validation("font bytes are empty"));
        }
        if bytes.len() > MAX_FONT_FACE_BYTES {
            return Err(EngineError::validation(format!(
                "font face exceeds the {} byte limit",
                MAX_FONT_FACE_BYTES
            )));
        }
        let sha256 = hex_sha256(&bytes);
        if let Some(existing) = self
            .faces
            .iter()
            .find(|f| f.family == family && f.sha256 == sha256 && f.face_index == face_index)
        {
            return Ok(FontInfo {
                family: existing.family.clone(),
                sha256: existing.sha256.clone(),
                face_index: existing.face_index,
                units_per_em: existing.units_per_em,
                num_glyphs: existing.num_glyphs,
                registered: false,
            });
        }
        if self.faces.len() >= MAX_FONT_FACES {
            return Err(EngineError::validation(format!(
                "font registry is full ({MAX_FONT_FACES} faces)"
            )));
        }
        if self.total_bytes + bytes.len() > MAX_FONT_TOTAL_BYTES {
            return Err(EngineError::validation(format!(
                "font registry exceeds the {} byte total limit",
                MAX_FONT_TOTAL_BYTES
            )));
        }

        // Hostile-input guard: skrifa is fuzz-tested, but a panic here
        // would still close the session — treat any panic as a validation
        // error instead. `Font` is an owning `Arc`-backed value, so the
        // parsed result moves out of the closure cleanly.
        let byte_len = bytes.len();
        let parsed = catch_unwind(AssertUnwindSafe(|| {
            skrifa::Font::new(bytes, face_index)
                .map(|font| (font.clone(), font.units_per_em(), font.num_glyphs()))
        }));
        let (font, units_per_em, num_glyphs) = match parsed {
            Ok(Some(parsed)) => parsed,
            Ok(None) => {
                return Err(EngineError::validation(
                    "bytes are not a recognized font at the requested face index",
                ))
            }
            Err(_) => {
                return Err(EngineError::validation(
                    "font parsing failed on hostile input",
                ))
            }
        };
        if units_per_em == 0 {
            return Err(EngineError::validation("font has zero units_per_em"));
        }
        // A truncated collection can still parse lazily down to an empty
        // glyph set; a font with no glyphs cannot measure anything.
        if num_glyphs == 0 {
            return Err(EngineError::validation("font has no glyphs"));
        }

        self.total_bytes += byte_len;
        self.faces.push(Arc::new(FontFace {
            family: family.to_owned(),
            sha256,
            face_index,
            units_per_em,
            num_glyphs,
            byte_len,
            font,
        }));
        let face = self.faces.last().expect("just pushed");
        Ok(FontInfo {
            family: face.family.clone(),
            sha256: face.sha256.clone(),
            face_index,
            units_per_em,
            num_glyphs,
            registered: true,
        })
    }

    /// Remove every face registered from the given content hash
    /// (all families/face indices sharing those bytes). Returns the number
    /// of faces removed.
    pub fn remove(&mut self, sha256: &str) -> usize {
        let before = self.faces.len();
        self.faces.retain(|f| f.sha256 != sha256);
        let removed = before - self.faces.len();
        if removed > 0 {
            self.total_bytes = self.faces.iter().map(|f| f.byte_len).sum();
        }
        removed
    }
}

/// A parsed face for a batch of measurements. `skrifa::Font` clones share
/// the face's `Arc`'d blob, so opening is a refcount bump — but callers
/// still open once per read op rather than per character.
pub struct FaceMeasure {
    font: skrifa::Font,
    units_per_em: f64,
}

impl FaceMeasure {
    /// Clone the face's parsed font. `None` is unreachable for a registered
    /// face (the font was validated at admission and is immutable) — kept
    /// as a defensive signature.
    pub fn open(face: &FontFace) -> Option<Self> {
        Some(Self {
            font: face.font.clone(),
            units_per_em: f64::from(face.units_per_em),
        })
    }

    pub fn units_per_em(&self) -> f64 {
        self.units_per_em
    }

    /// Advance width of `c` in *font units* (unscaled, unhinted):
    /// `cmap` lookup → `hmtx` advance; unmapped characters fall back to the
    /// `.notdef` glyph (id 0). Deterministic for fixed bytes — no system
    /// state is consulted.
    pub fn advance_units(&self, c: char) -> f64 {
        let charmap = self.font.charmap();
        let glyph = charmap
            .map_unicode(c)
            .or_else(|| charmap.map_unicode('\u{0}'))
            .unwrap_or_default();
        self.font.glyph_metrics().h_advance(glyph) as f64
    }
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
