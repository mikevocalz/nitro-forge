//! nf-cli — verification host for Nitro-Forge engines.
//! Speaks ignition_core::protocol over stdin/stdout. Used by package vitest
//! suites to drive the real compiled Rust engines end to end.

use ignition_core::{run_stdio, Engine, EngineKind};

fn factory(kind: EngineKind) -> Option<Box<dyn Engine>> {
    match kind {
        EngineKind::Prism => Some(Box::new(prism_engine::PrismEngine::new(0, 0))),
        EngineKind::Cadence => Some(Box::new(cadence_engine::CadenceEngine::new())),
        EngineKind::Splice => Some(Box::new(splice_engine::SpliceEngine::new())),
        EngineKind::Folio => Some(Box::new(folio_engine::FolioEngine::new())),
        EngineKind::Pitch => Some(Box::new(pitch_engine::PitchEngine::new())),
        EngineKind::Tally => Some(Box::new(tally_engine::TallyEngine::new())),
        EngineKind::Quill => Some(Box::new(quill_engine::QuillEngine::new())),
        EngineKind::Photo => Some(Box::new(photo_engine::PhotoEngine::new())),
        EngineKind::Motion => Some(Box::new(motion_engine::MotionEngine::new())),
    }
}

fn main() {
    if let Err(e) = run_stdio(factory) {
        eprintln!("nf-cli: {e}");
        std::process::exit(1);
    }
}
