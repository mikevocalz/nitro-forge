//! Shared harness for the Nitro-Forge importer fuzz targets.
//!
//! Every target drives a real host entry point: an engine's binary-input
//! op (`importXlsx`, `importDocx`, `registerFont`, `open`, ...), an
//! engine's `restore`, or a host provider's parse call. The oracles are the
//! engine contract from docs/ARCHITECTURE.md, not just "no panic":
//!
//! - untrusted bytes never panic, abort, overflow the stack, or allocate
//!   past libFuzzer's `-rss_limit_mb`;
//! - a rejected input is a typed, recoverable error that is not
//!   `ErrorCode::Internal` (Internal tells the host the session is dead);
//! - a rejected input leaves the engine exactly as it was (snapshot bytes
//!   before == after);
//! - an accepted input yields a document that snapshots and restores into
//!   a fresh engine, and the restored engine snapshots to the same bytes.

use ignition_core::{Command, CommandResult, Engine, EngineError, ErrorCode};
use serde_json::Value;

/// Assert the error contract for a rejected untrusted input.
pub fn check_error(op: &str, err: &EngineError) {
    assert!(
        err.code != ErrorCode::Internal && err.recoverable,
        "{op}: untrusted input produced a non-recoverable/internal error: {err:?}"
    );
}

/// Run `cmd` and enforce atomicity: on `Err` the engine's snapshot must be
/// unchanged and the error must satisfy [`check_error`].
pub fn apply_atomic<E: Engine>(engine: &mut E, cmd: Command) -> Option<CommandResult> {
    let op = cmd.op.clone();
    let before = engine.snapshot().expect("snapshot of a valid engine");
    match engine.apply(cmd) {
        Ok(result) => Some(result),
        Err(err) => {
            check_error(&op, &err);
            let after = engine.snapshot().expect("snapshot after a rejected op");
            assert!(before == after, "{op}: rejected input changed engine state");
            None
        }
    }
}

/// A binary-input command: payload fields plus the file bytes as the
/// sidecar, which is how hosts hand importers a file.
pub fn binary(op: &str, payload: Value, bytes: &[u8]) -> Command {
    let mut cmd = Command::new(op, payload);
    cmd.input = Some(bytes.to_vec());
    cmd
}

/// A JSON-only command. Errors are checked but tolerated: these are
/// follow-up reads on a document an importer accepted.
pub fn read<E: Engine>(engine: &mut E, op: &str, payload: Value) -> Option<CommandResult> {
    match engine.apply(Command::new(op, payload)) {
        Ok(r) => Some(r),
        Err(err) => {
            check_error(op, &err);
            None
        }
    }
}

/// An accepted document must survive snapshot → restore into `fresh`, and
/// the restored engine must snapshot to identical bytes.
pub fn check_round_trip<E: Engine>(engine: &E, mut fresh: E) {
    let snap = engine.snapshot().expect("snapshot of an imported document");
    fresh
        .restore(&snap)
        .unwrap_or_else(|e| panic!("own snapshot failed to restore: {e:?}"));
    let again = fresh.snapshot().expect("snapshot of the restored document");
    assert!(snap == again, "snapshot -> restore -> snapshot is not stable");
}
