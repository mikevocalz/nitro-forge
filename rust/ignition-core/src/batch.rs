use crate::{Command, CommandResult, Engine, EngineError, Event, COMMAND_VERSION};
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
pub fn execute_batch<E: Engine>(mut staged: E, batch: Batch) -> Result<(E, CommandResult), EngineError> {
    let mut results = Vec::with_capacity(batch.steps.len());
    let mut events = Vec::new();
    let mut changed = false;
    let mut budget = Budget(MAX_BATCH_JSON_BYTES);
    for command in batch.steps {
        let result = staged.apply(command)?;
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
    let result = CommandResult { data: json!({ "results": results }), events, output: None };
    consume(&result, &mut Budget(MAX_BATCH_JSON_BYTES))?;
    Ok((staged, result))
}
