//! ignition-core — the shared engine contracts for Nitro-Forge.
//!
//! Every Nitro-Forge product engine is a synchronous, single-threaded state
//! machine implementing [`Engine`]. See docs/ARCHITECTURE.md for the ratified
//! contract (threading, ownership, commands, undo, snapshots, failure recovery).

mod batch;
mod command;
mod engine;
mod envelope;
mod error;
mod journal;
mod protocol;
mod session;
mod task;

pub use command::{
    Command, CommandResult, Event, COMMAND_VERSION, OP_REDO, OP_SNAPSHOT, OP_UNDO,
};
pub use batch::{parse_batch, execute_batch, OP_BATCH, MAX_BATCH_COMMANDS};
pub use engine::{Engine, EngineKind};
pub use envelope::{decode_envelope, encode_envelope, ENVELOPE_FORMAT_JSON, ENVELOPE_MAGIC, ENVELOPE_VERSION};
pub use error::{EngineError, ErrorCode};
pub use journal::Journal;
pub use protocol::{
    base64_decode, base64_encode, run_stdio, FrameRequest, FrameResponse,
};
pub use session::SessionRegistry;
pub use task::TaskContext;
