use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Reserved ops understood by the engine *host*, not by individual `apply`
/// implementations: `__undo`, `__redo`, `__snapshot`. `__restore` is routed to
/// `Engine::restore`.
pub const OP_UNDO: &str = "__undo";
pub const OP_REDO: &str = "__redo";
pub const OP_SNAPSHOT: &str = "__snapshot";

/// Current command schema version.
pub const COMMAND_VERSION: u32 = 1;

/// A unit of intent. `op` names the verb; `payload` carries its arguments.
/// Commands are pure data — they serialize as JSON across every transport
/// (Nitro, nf-cli, WASM, AI tool calls).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Command {
    #[serde(default = "default_version")]
    pub v: u32,
    pub op: String,
    #[serde(default)]
    pub payload: Value,
}

fn default_version() -> u32 {
    COMMAND_VERSION
}

impl Command {
    pub fn new(op: impl Into<String>, payload: Value) -> Self {
        Self {
            v: COMMAND_VERSION,
            op: op.into(),
            payload,
        }
    }
}

/// A state-change notification produced by a successful `apply`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub kind: String,
    #[serde(default)]
    pub detail: Value,
}

impl Event {
    pub fn new(kind: impl Into<String>, detail: Value) -> Self {
        Self {
            kind: kind.into(),
            detail,
        }
    }
}

/// The result of a successful `apply`: op-specific return data plus the events
/// the host should fan out to listeners.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandResult {
    #[serde(default)]
    pub events: Vec<Event>,
    #[serde(default)]
    pub data: Value,
}

impl CommandResult {
    pub fn empty() -> Self {
        Self {
            events: vec![Event::new("document:changed", Value::Null)],
            data: Value::Null,
        }
    }

    pub fn data(data: Value) -> Self {
        Self {
            events: vec![Event::new("document:changed", Value::Null)],
            data,
        }
    }
}
