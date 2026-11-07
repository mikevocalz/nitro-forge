use crate::{Command, CommandResult, Engine, EngineError, Event, TaskContext, COMMAND_VERSION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, Write};

pub const OP_BATCH: &str = "__batch";
pub const MAX_BATCH_COMMANDS: usize = 64;
const MAX_BATCH_JSON_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    commands: Vec<Step>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Step {
    op: String,
    #[serde(default)]
    payload: Value,
    #[serde(default = "version")]
    v: u32,
}
fn version() -> u32 { COMMAND_VERSION }

/// Only parse_batch can construct a validated transaction plan.
pub struct Batch { steps: Vec<Command> }

struct Budget(usize);
impl Write for Budget {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.0 { return Err(io::Error::other("batch JSON budget exceeded")); }
        self.0 -= bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}
fn consume(value: &impl Serialize, budget: &mut Budget) -> Result<(), EngineError> {
    serde_json::to_writer(budget, value)
        .map_err(|_| EngineError::validation("batch JSON exceeds 32 MiB"))
}

pub fn parse_batch(command: Command) -> Result<Batch, EngineError> {
    if command.v != COMMAND_VERSION {
        return Err(EngineError::unsupported("batch requires command schema v1"));
    }
    if command.input.is_some() {
        return Err(EngineError::invalid("batch does not accept a binary sidecar"));
    }
    consume(&command.payload, &mut Budget(MAX_BATCH_JSON_BYTES))?;
    let payload: Payload = serde_json::from_value(command.payload)
        .map_err(|error| EngineError::invalid(format!("invalid batch: {error}")))?;
    if payload.commands.is_empty() || payload.commands.len() > MAX_BATCH_COMMANDS {
        return Err(EngineError::validation("batch requires 1..64 commands"));
    }
    let mut steps = Vec::with_capacity(payload.commands.len());
    for step in payload.commands {
        if step.v != COMMAND_VERSION {
            return Err(EngineError::unsupported("batch steps require command schema v1"));
        }
        if step.op.is_empty() || step.op.starts_with("__") {
            return Err(EngineError::invalid("batch cannot nest or invoke reserved history/snapshot operations"));
        }
        steps.push(Command::new(step.op, step.payload));
    }
    Ok(Batch { steps })
}

/// Execute only on an engine's isolated document clone with a temporary
/// one-entry journal. The caller publishes its staged state and records the
/// original state exactly once after this function succeeds. Original history
/// is never cloned, cleared or modified during validation/execution.
///
/// Without a context each step runs through `Engine::apply`. With `ctx` every
/// step instead runs through `Engine::apply_long` on a scoped child context,
/// so engines checkpoint heavy ops inside a batch and report per-step
/// progress. A cancelled step aborts the whole batch with `Cancelled`; the
/// staged clone is dropped and the caller's document and journal stay
/// untouched, exactly like any other batch failure.
pub fn execute_batch<E: Engine>(staged: E, batch: Batch) -> Result<(E, CommandResult), EngineError> {
    execute_batch_maybe(staged, batch, None)
}

/// `execute_batch` for task-driven hosts: `ctx` is checked before every step
/// and each step gets a scoped slice of the task's progress.
pub fn execute_batch_with_ctx<E: Engine>(
    staged: E,
    batch: Batch,
    ctx: &TaskContext,
) -> Result<(E, CommandResult), EngineError> {
    execute_batch_maybe(staged, batch, Some(ctx))
}

fn execute_batch_maybe<E: Engine>(
    mut staged: E,
    batch: Batch,
    ctx: Option<&TaskContext>,
) -> Result<(E, CommandResult), EngineError> {
    let total = batch.steps.len();
    let mut results = Vec::with_capacity(total);
    let mut events = Vec::new();
    let mut changed = false;
    let mut budget = Budget(MAX_BATCH_JSON_BYTES);
    for (index, command) in batch.steps.into_iter().enumerate() {
        let result = match ctx {
            Some(ctx) => {
                ctx.checkpoint()?;
                let step = ctx.scoped(
                    index as f32 / total as f32,
                    (index + 1) as f32 / total as f32,
                );
                staged.apply_long(command, &step)?
            }
            None => staged.apply(command)?,
        };
        if result.output.is_some() {
            return Err(EngineError::invalid("batch steps return JSON; raw binary output is not supported"));
        }
        consume(&result, &mut budget)?;
        results.push(result.data);
        for event in result.events {
            if event.kind == "document:changed" { changed = true; }
            else { events.push(event); }
        }
    }
    // Null means full invalidation, rather than a stale dirty rectangle from
    // just one step of the compound edit.
    if changed { events.push(Event::new("document:changed", Value::Null)); }
    if let Some(ctx) = ctx {
        ctx.set_progress(1.0);
    }
    let result = CommandResult { data: json!({ "results": results }), events, output: None };
    consume(&result, &mut Budget(MAX_BATCH_JSON_BYTES))?;
    Ok((staged, result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{EngineKind, ErrorCode};
    use std::sync::{Arc, Mutex};

    /// Records which entry point each step took. `apply_long` honours the
    /// context like the trait default: checkpoint, run, report progress.
    #[derive(Debug, Default)]
    struct Spy {
        log: Arc<Mutex<Vec<String>>>,
        progress_seen: Arc<Mutex<Vec<f32>>>,
        /// Cancel the task when the Nth `apply_long` step starts.
        cancel_on_long: Option<usize>,
    }

    impl Engine for Spy {
        fn kind(&self) -> EngineKind {
            EngineKind::Tally
        }
        fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
            self.log.lock().unwrap().push(format!("apply:{}", cmd.op));
            Ok(CommandResult::read_only(json!({ "op": cmd.op })))
        }
        fn apply_batch(
            &mut self,
            _cmd: Command,
            _ctx: Option<&TaskContext>,
        ) -> Result<CommandResult, EngineError> {
            Err(EngineError::unsupported("__batch"))
        }
        fn apply_long(
            &mut self,
            cmd: Command,
            ctx: &TaskContext,
        ) -> Result<CommandResult, EngineError> {
            let index = self.log.lock().unwrap().len();
            self.log.lock().unwrap().push(format!("long:{}", cmd.op));
            self.progress_seen.lock().unwrap().push(ctx.progress());
            if self.cancel_on_long == Some(index) {
                ctx.cancel();
            }
            ctx.checkpoint()?;
            ctx.set_progress(1.0);
            Ok(CommandResult::read_only(json!({ "op": cmd.op })))
        }
        fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
            Ok(vec![])
        }
        fn restore(&mut self, _data: &[u8]) -> Result<(), EngineError> {
            Ok(())
        }
        fn undo(&mut self) -> Result<bool, EngineError> {
            Ok(false)
        }
        fn redo(&mut self) -> Result<bool, EngineError> {
            Ok(false)
        }
    }

    fn plan(ops: &[&str]) -> Batch {
        let commands: Vec<Value> = ops.iter().map(|op| json!({ "op": op })).collect();
        parse_batch(Command::new(OP_BATCH, json!({ "commands": commands }))).unwrap()
    }

    #[test]
    fn ctx_runs_every_step_through_apply_long_with_scoped_progress() {
        let spy = Spy::default();
        let log = Arc::clone(&spy.log);
        let seen = Arc::clone(&spy.progress_seen);
        let ctx = TaskContext::new();
        let (_spy, result) =
            execute_batch_with_ctx(spy, plan(&["a", "b", "c"]), &ctx).unwrap();
        assert_eq!(
            *log.lock().unwrap(),
            ["long:a", "long:b", "long:c"],
            "ctx batch must route steps through apply_long"
        );
        assert_eq!(result.data["results"].as_array().unwrap().len(), 3);
        assert_eq!(ctx.progress(), 1.0);
        // Each step observed the cumulative progress of the steps before it.
        let seen = seen.lock().unwrap();
        assert!((seen[0] - 0.0).abs() < f32::EPSILON);
        assert!((seen[1] - 1.0 / 3.0).abs() < 0.001);
        assert!((seen[2] - 2.0 / 3.0).abs() < 0.001);
    }

    #[test]
    fn no_ctx_keeps_steps_on_apply() {
        let spy = Spy::default();
        let log = Arc::clone(&spy.log);
        let (_spy, result) = execute_batch(spy, plan(&["a", "b"])).unwrap();
        assert_eq!(*log.lock().unwrap(), ["apply:a", "apply:b"]);
        assert_eq!(result.data["results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn cancel_before_first_step_rejects_without_running_anything() {
        let spy = Spy::default();
        let log = Arc::clone(&spy.log);
        let ctx = TaskContext::new();
        ctx.cancel();
        let err = execute_batch_with_ctx(spy, plan(&["a", "b"]), &ctx).unwrap_err();
        assert_eq!(err.code, ErrorCode::Cancelled);
        assert!(log.lock().unwrap().is_empty());
    }

    #[test]
    fn cancel_mid_batch_aborts_remaining_steps() {
        let spy = Spy {
            cancel_on_long: Some(1),
            ..Spy::default()
        };
        let log = Arc::clone(&spy.log);
        let ctx = TaskContext::new();
        let err = execute_batch_with_ctx(spy, plan(&["a", "b", "c"]), &ctx).unwrap_err();
        assert_eq!(err.code, ErrorCode::Cancelled);
        assert_eq!(*log.lock().unwrap(), ["long:a", "long:b"]);
        // The staged engine is consumed by the failed run: nothing commits.
    }
}
