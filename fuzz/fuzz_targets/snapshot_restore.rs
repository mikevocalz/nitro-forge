//! `Engine::restore` for all twelve product engines: a stored document
//! (an NFD1 envelope a host reads back from disk or a sync peer). This is
//! the project-file importer for Cadence, Splice, Pitch, Scene (mesh
//! buffers), Photo and the rest. The first input byte picks the engine;
//! the rest is the snapshot.
#![no_main]

use ignition_core::Engine;
use libfuzzer_sys::fuzz_target;
use nf_fuzz::{check_error, check_round_trip};

fn run<E: Engine>(make: impl Fn() -> E, snapshot: &[u8]) {
    let mut engine = make();
    let before = engine.snapshot().expect("snapshot of a fresh engine");
    match engine.restore(snapshot) {
        Err(err) => {
            check_error("restore", &err);
            let after = engine.snapshot().expect("snapshot after a rejected restore");
            assert!(after == before, "rejected restore changed engine state");
        }
        Ok(()) => check_round_trip(&engine, make()),
    }
}

fuzz_target!(|data: &[u8]| {
    let Some((&selector, snapshot)) = data.split_first() else {
        return;
    };
    match selector % 12 {
        0 => run(cadence_engine::CadenceEngine::new, snapshot),
        1 => run(design_engine::DesignEngine::new, snapshot),
        2 => run(draft_engine::DraftEngine::new, snapshot),
        3 => run(folio_engine::FolioEngine::new, snapshot),
        4 => run(motion_engine::MotionEngine::new, snapshot),
        5 => run(photo_engine::PhotoEngine::new, snapshot),
        6 => run(pitch_engine::PitchEngine::new, snapshot),
        7 => run(|| prism_engine::PrismEngine::new(64, 64), snapshot),
        8 => run(quill_engine::QuillEngine::new, snapshot),
        9 => run(scene_engine::SceneEngine::new, snapshot),
        10 => run(splice_engine::SpliceEngine::new, snapshot),
        _ => run(tally_engine::TallyEngine::new, snapshot),
    }
});
