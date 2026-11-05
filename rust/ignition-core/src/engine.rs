use crate::command::{Command, CommandResult};
use crate::error::EngineError;
use serde::{Deserialize, Serialize};

/// Identity of an engine implementation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Prism,
    Cadence,
    Splice,
    Folio,
    Pitch,
    Tally,
    Quill,
}

impl EngineKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            EngineKind::Prism => "prism",
            EngineKind::Cadence => "cadence",
            EngineKind::Splice => "splice",
            EngineKind::Folio => "folio",
            EngineKind::Pitch => "pitch",
            EngineKind::Tally => "tally",
            EngineKind::Quill => "quill",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "prism" => Some(EngineKind::Prism),
            "cadence" => Some(EngineKind::Cadence),
            "splice" => Some(EngineKind::Splice),
            "folio" => Some(EngineKind::Folio),
            "pitch" => Some(EngineKind::Pitch),
            "tally" => Some(EngineKind::Tally),
            "quill" => Some(EngineKind::Quill),
            _ => None,
        }
    }
}

/// The single contract every Nitro-Forge engine implements.
///
/// Semantics (see docs/ARCHITECTURE.md):
/// - `apply` is atomic: full success + events, or an `EngineError` and no mutation.
/// - `snapshot`/`restore` round-trip the complete document through the versioned
///   byte envelope produced by `envelope::encode_envelope`.
/// - `undo`/`redo` return `Ok(false)` on empty stacks — never an error.
/// - Engines are `Send`, driven by exactly one thread, and never perform I/O.
pub trait Engine: Send + 'static {
    fn kind(&self) -> EngineKind;

    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError>;

    /// Serialize the entire document to the versioned envelope.
    fn snapshot(&self) -> Result<Vec<u8>, EngineError>;

    /// Replace the entire document from envelope bytes. Implementations must
    /// validate magic/version/length before decoding and leave `self`
    /// unmodified on failure.
    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError>;

    fn undo(&mut self) -> Result<bool, EngineError>;
    fn redo(&mut self) -> Result<bool, EngineError>;

    /// Estimated bytes this document owns on the heap: the live document plus
    /// its undo/redo journal. Hosts report it to the JS garbage collector.
    ///
    /// Must not allocate or panic, and should cost at most O(live document):
    /// hosts read it after every command. Whole-document undo snapshots may be
    /// charged at the live document's size instead of being walked one by one.
    /// Use saturating arithmetic (see `HeapSize`).
    ///
    /// The default 0 means "not measured". Every engine linked into nf-sys
    /// overrides it, and nf-sys tests fail if a linked engine reports 0.
    fn heap_size_estimate(&self) -> usize {
        0
    }
}
