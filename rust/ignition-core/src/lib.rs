//! ignition-core — the shared engine contracts for Nitro-Forge.
//!
//! Every Nitro-Forge product engine is a synchronous, single-threaded state
//! machine implementing [`Engine`]. See docs/ARCHITECTURE.md for the ratified
//! contract (threading, ownership, commands, undo, snapshots, failure recovery).

mod command;
mod engine;
mod envelope;
mod error;
mod heap;
mod journal;
mod protocol;
mod session;

pub use command::{
    Command, CommandResult, Event, COMMAND_VERSION, OP_REDO, OP_SNAPSHOT, OP_UNDO,
};
pub use engine::{Engine, EngineKind};
pub use envelope::{decode_envelope, encode_envelope, ENVELOPE_FORMAT_JSON, ENVELOPE_MAGIC, ENVELOPE_VERSION};
pub use error::{EngineError, ErrorCode};
pub use heap::HeapSize;
pub use journal::Journal;
pub use protocol::{
    base64_decode, base64_encode, run_stdio, FrameRequest, FrameResponse,
};
pub use session::SessionRegistry;
