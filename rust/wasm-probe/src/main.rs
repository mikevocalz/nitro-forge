//! WASI round-trip probe for every Nitro-Forge engine.
//!
//! Mirrors the semantics of `examples/native-cadence/verify-engines.ts`:
//! open an engine, apply `new`, apply `describe`, snapshot (must carry the
//! `NFD1` envelope magic), restore, compare `describe` output, then confirm
//! an invalid snapshot is rejected without mutating the document.
//!
//! Build: `cargo build -p nf-wasm-probe --target wasm32-wasip1`
//! Run:   `node run-wasi.mjs` (Node's built-in WASI support).

use ignition_core::{Command, Engine, EngineKind};
use serde_json::Value;
use std::process::ExitCode;

fn factory(kind: EngineKind) -> Box<dyn Engine> {
    match kind {
        EngineKind::Prism => Box::new(prism_engine::PrismEngine::new(32, 32)),
        EngineKind::Cadence => Box::new(cadence_engine::CadenceEngine::new()),
        EngineKind::Splice => Box::new(splice_engine::SpliceEngine::new()),
        EngineKind::Folio => Box::new(folio_engine::FolioEngine::new()),
        EngineKind::Pitch => Box::new(pitch_engine::PitchEngine::new()),
        EngineKind::Tally => Box::new(tally_engine::TallyEngine::new()),
        EngineKind::Quill => Box::new(quill_engine::QuillEngine::new()),
        EngineKind::Photo => Box::new(photo_engine::PhotoEngine::new()),
        EngineKind::Motion => Box::new(motion_engine::MotionEngine::new()),
        EngineKind::Design => Box::new(design_engine::DesignEngine::new()),
        EngineKind::Draft => Box::new(draft_engine::DraftEngine::new()),
        EngineKind::Scene => Box::new(scene_engine::SceneEngine::new()),
    }
}

/// `describe` may embed a revision counter that `restore` legitimately bumps
/// (draft `source_revision`); strip it before comparison, as the TS verifier
/// does.
fn describe_json(engine: &mut dyn Engine) -> Result<String, String> {
    let result = engine
        .apply(Command::new("describe", Value::Object(Default::default())))
        .map_err(|e| format!("describe failed: {e}"))?;
    let mut data = result.data;
    if let Value::Object(ref mut map) = data {
        map.remove("source_revision");
    }
    Ok(data.to_string())
}

fn verify_engine(kind: EngineKind) -> Result<(), String> {
    let mut engine = factory(kind);

    // Newly allocated engines are not initialized documents; `new` is the
    // documented initialization op (prism needs explicit dimensions).
    let new_payload = if kind == EngineKind::Prism {
        serde_json::json!({ "width": 32, "height": 32 })
    } else {
        Value::Object(Default::default())
    };
    engine
        .apply(Command::new("new", new_payload))
        .map_err(|e| format!("new failed: {e}"))?;

    let before = describe_json(engine.as_mut())?;

    let bytes = engine.snapshot().map_err(|e| format!("snapshot failed: {e}"))?;
    if bytes.len() < 4 || &bytes[0..4] != b"NFD1" {
        return Err("snapshot missing NFD1 envelope magic".into());
    }

    engine
        .restore(&bytes)
        .map_err(|e| format!("restore failed: {e}"))?;
    let after_restore = describe_json(engine.as_mut())?;
    if after_restore != before {
        return Err(format!(
            "snapshot round trip changed document ({} bytes -> {} bytes describe)",
            before.len(),
            after_restore.len()
        ));
    }

    // An invalid snapshot must be rejected and leave the document untouched.
    let rejected = engine.restore(&[0]).is_err();
    if !rejected {
        return Err("accepted invalid snapshot".into());
    }
    let after_reject = describe_json(engine.as_mut())?;
    if after_reject != before {
        return Err("invalid restore changed document".into());
    }

    Ok(())
}

fn main() -> ExitCode {
    let kinds = [
        EngineKind::Prism,
        EngineKind::Cadence,
        EngineKind::Splice,
        EngineKind::Folio,
        EngineKind::Pitch,
        EngineKind::Tally,
        EngineKind::Quill,
        EngineKind::Photo,
        EngineKind::Motion,
        EngineKind::Design,
        EngineKind::Draft,
        EngineKind::Scene,
    ];

    let mut failures = 0;
    for kind in kinds {
        let name = kind.as_str();
        match verify_engine(kind) {
            Ok(()) => println!("PASS {name}"),
            Err(e) => {
                println!("FAIL {name}: {e}");
                failures += 1;
            }
        }
    }
    if failures == 0 {
        println!("ALL {} ENGINES VERIFIED", kinds.len());
        ExitCode::SUCCESS
    } else {
        println!("{failures} ENGINE(S) FAILED");
        ExitCode::FAILURE
    }
}
