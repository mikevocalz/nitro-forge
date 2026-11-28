//! The engine table. Each engine is linked only when its Cargo feature is on
//! (see Cargo.toml), so an app can ship just the studios it uses. A kind the
//! FFI knows but this build left out opens to a typed `unsupported` error,
//! never a crash.

use ignition_core::{Engine, EngineError, EngineKind};

/// Construct a fresh engine, or `None` when its feature is off in this build.
pub(crate) fn factory(kind: EngineKind) -> Option<Box<dyn Engine>> {
    match kind {
        #[cfg(feature = "prism")]
        EngineKind::Prism => Some(Box::new(prism_engine::PrismEngine::new(0, 0))),
        #[cfg(feature = "cadence")]
        EngineKind::Cadence => Some(Box::new(cadence_engine::CadenceEngine::new())),
        #[cfg(feature = "splice")]
        EngineKind::Splice => Some(Box::new(splice_engine::SpliceEngine::new())),
        #[cfg(feature = "folio")]
        EngineKind::Folio => Some(Box::new(folio_engine::FolioEngine::new())),
        #[cfg(feature = "pitch")]
        EngineKind::Pitch => Some(Box::new(pitch_engine::PitchEngine::new())),
        #[cfg(feature = "tally")]
        EngineKind::Tally => Some(Box::new(tally_engine::TallyEngine::new())),
        #[cfg(feature = "quill")]
        EngineKind::Quill => Some(Box::new(quill_engine::QuillEngine::new())),
        #[cfg(feature = "photo")]
        EngineKind::Photo => Some(Box::new(photo_engine::PhotoEngine::new())),
        #[cfg(feature = "motion")]
        EngineKind::Motion => Some(Box::new(motion_engine::MotionEngine::new())),
        #[cfg(feature = "design")]
        EngineKind::Design => Some(Box::new(design_engine::DesignEngine::new())),
        #[cfg(feature = "draft")]
        EngineKind::Draft => Some(Box::new(draft_engine::DraftEngine::new())),
        #[cfg(feature = "scene")]
        EngineKind::Scene => Some(Box::new(scene_engine::SceneEngine::new())),
        // Only reachable in a build with at least one engine feature off.
        #[allow(unreachable_patterns)]
        _ => None,
    }
}

/// True when `kind` is compiled into this build. Constructs nothing.
pub(crate) fn is_linked(kind: EngineKind) -> bool {
    match kind {
        EngineKind::Prism => cfg!(feature = "prism"),
        EngineKind::Cadence => cfg!(feature = "cadence"),
        EngineKind::Splice => cfg!(feature = "splice"),
        EngineKind::Folio => cfg!(feature = "folio"),
        EngineKind::Pitch => cfg!(feature = "pitch"),
        EngineKind::Tally => cfg!(feature = "tally"),
        EngineKind::Quill => cfg!(feature = "quill"),
        EngineKind::Photo => cfg!(feature = "photo"),
        EngineKind::Motion => cfg!(feature = "motion"),
        EngineKind::Design => cfg!(feature = "design"),
        EngineKind::Draft => cfg!(feature = "draft"),
        EngineKind::Scene => cfg!(feature = "scene"),
    }
}

/// The engines this build links, in `EngineKind::ALL` order.
pub(crate) fn linked_kinds() -> Vec<EngineKind> {
    EngineKind::ALL
        .into_iter()
        .filter(|kind| is_linked(*kind))
        .collect()
}

/// The error every entry point returns for a known engine this build left out.
/// `unsupported` and recoverable: the caller can open another engine.
pub(crate) fn not_linked(kind: EngineKind) -> EngineError {
    let linked: Vec<&str> = linked_kinds().iter().map(EngineKind::as_str).collect();
    let linked = if linked.is_empty() {
        "none".to_owned()
    } else {
        linked.join(", ")
    };
    EngineError::unsupported(format!(
        "engine '{}' not linked in this build (linked: {linked}); rebuild nf-sys with its feature, e.g. NF_ENGINES",
        kind.as_str()
    ))
}

/// Open helper shared by the legacy and v1 C ABIs.
pub(crate) fn open_kind(kind: EngineKind) -> Result<Box<dyn Engine>, EngineError> {
    factory(kind).ok_or_else(|| not_linked(kind))
}
