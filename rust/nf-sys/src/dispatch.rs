//! One routing function for every v1 entry point (apply_parts, apply_binary
//! and scheduled tasks), so reserved ops, the snapshot cap and the binary
//! input rules cannot drift between them.

use crate::ffi_v1::bounded_snapshot;
use ignition_core::{
    base64_encode, Command, CommandResult, Engine, EngineError, TaskContext, OP_REDO, OP_SNAPSHOT,
    OP_UNDO,
};
use serde_json::json;

/// Largest binary sidecar accepted in either direction. Same cap as a
/// snapshot, because a snapshot is the largest byte result an engine makes.
pub(crate) const MAX_BINARY_BYTES: usize = 256 * 1024 * 1024;

fn reserved(data: serde_json::Value) -> CommandResult {
    CommandResult::read_only(data)
}

/// Run one command against a locked engine. With `ctx`, the command runs as a
/// task through `Engine::apply_long`; reserved ops check for cancellation
/// before starting and cannot be interrupted once running.
pub(crate) fn run_command(
    engine: &mut dyn Engine,
    command: Command,
    ctx: Option<&TaskContext>,
) -> Result<CommandResult, EngineError> {
    if command.v != 1 {
        return Err(EngineError::unsupported("unsupported command version"));
    }
    if let Some(input) = &command.input {
        if input.len() > MAX_BINARY_BYTES {
            return Err(EngineError::validation("binary input exceeds 256 MiB"));
        }
        if !engine.binary_input_ops().contains(&command.op.as_str()) {
            return Err(EngineError::invalid(format!(
                "op '{}' does not accept binary input",
                command.op
            )));
        }
    }
    let reserved_op = matches!(command.op.as_str(), OP_UNDO | OP_REDO | OP_SNAPSHOT);
    if reserved_op {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?;
        }
    }
    let result = match command.op.as_str() {
        OP_UNDO => engine
            .undo()
            .map(|undone| reserved(json!({ "undone": undone }))),
        OP_REDO => engine
            .redo()
            .map(|redone| reserved(json!({ "redone": redone }))),
        OP_SNAPSHOT => bounded_snapshot(engine).map(|bytes| {
            if command.binary_output {
                let mut result = reserved(json!({ "size": bytes.len() }));
                result.output = Some(bytes);
                result
            } else {
                reserved(json!({ "bytes": base64_encode(&bytes) }))
            }
        }),
        _ => match ctx {
            Some(ctx) => engine.apply_long(command, ctx),
            None => engine.apply(command),
        },
    }?;
    if reserved_op {
        if let Some(ctx) = ctx {
            ctx.set_progress(1.0);
        }
    }
    if result
        .output
        .as_ref()
        .is_some_and(|bytes| bytes.len() > MAX_BINARY_BYTES)
    {
        return Err(EngineError::validation("binary output exceeds 256 MiB"));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::factory;
    use ignition_core::{EngineKind, ErrorCode};

    #[test]
    fn input_bytes_are_rejected_for_ops_that_do_not_read_them() {
        let mut tally = factory(EngineKind::Tally).unwrap();
        let cmd = Command::new("new", json!({})).with_binary(Some(vec![1]));
        let err = run_command(tally.as_mut(), cmd, None).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidCommand);
        assert!(err.message.contains("does not accept binary input"));
    }

    #[test]
    fn folio_add_file_attachment_accepts_binary_sidecar() {
        // `binary_input_ops` is the host-side gate: without
        // "addFileAttachment" listed, `input` bytes never reach the op.
        let mut folio = factory(EngineKind::Folio).unwrap();
        run_command(
            folio.as_mut(),
            Command::new("new", json!({ "pages": 1 })),
            None,
        )
        .unwrap();
        let add = Command::new("addFileAttachment", json!({ "name": "raw.bin" }))
            .with_binary(Some(b"sidecar bytes".to_vec()));
        run_command(folio.as_mut(), add, None).unwrap();
        let got = run_command(
            folio.as_mut(),
            Command::new("getAttachment", json!({ "name": "raw.bin" })),
            None,
        )
        .unwrap();
        let b64 = got.data["bytes_b64"].as_str().unwrap();
        assert_eq!(
            ignition_core::base64_decode(b64).unwrap(),
            b"sidecar bytes".to_vec()
        );
    }

    #[test]
    fn binary_snapshot_returns_raw_envelope_bytes() {
        let mut tally = factory(EngineKind::Tally).unwrap();
        let cmd = Command::new(OP_SNAPSHOT, json!({})).with_binary(None);
        let result = run_command(tally.as_mut(), cmd, None).unwrap();
        let bytes = result.output.expect("binary snapshot bytes");
        assert_eq!(&bytes[..4], b"NFD1");
        assert_eq!(result.data["size"], bytes.len());
        let json = run_command(tally.as_mut(), Command::new(OP_SNAPSHOT, json!({})), None).unwrap();
        assert!(json.output.is_none());
        assert_eq!(json.data["bytes"], base64_encode(&bytes));
    }

    #[test]
    fn cancelled_task_never_runs_reserved_ops() {
        let mut tally = factory(EngineKind::Tally).unwrap();
        let ctx = TaskContext::new();
        ctx.cancel();
        let err =
            run_command(tally.as_mut(), Command::new(OP_UNDO, json!({})), Some(&ctx)).unwrap_err();
        assert_eq!(err.code, ErrorCode::Cancelled);
    }
}
