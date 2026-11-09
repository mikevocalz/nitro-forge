use crate::command::{Command, CommandResult};
use crate::error::EngineError;
use crate::TaskContext;
use crate::OP_BATCH;
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
    Photo,
    Motion,
    Design,
    Draft,
    Scene,
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
            EngineKind::Photo => "photo",
            EngineKind::Motion => "motion",
            EngineKind::Design => "design",
            EngineKind::Draft => "draft",
            EngineKind::Scene => "scene",
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
            "photo" => Some(EngineKind::Photo),
            "motion" => Some(EngineKind::Motion),
            "design" => Some(EngineKind::Design),
            "draft" => Some(EngineKind::Draft),
            "scene" => Some(EngineKind::Scene),
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
    /// Ops that read `Command::input` (the binary sidecar). Hosts reject a
    /// command that carries input bytes for any other op, so bytes are never
    /// silently dropped. Default: none.
    fn binary_input_ops(&self) -> &'static [&'static str] {
        &[]
    }

    /// Apply a `__batch` command atomically on this engine.
    ///
    /// `apply` calls this with `ctx: None`; `apply_long` calls it with
    /// `Some(ctx)` so every batch step runs through `apply_long` and can be
    /// cancelled. Implementations keep the staged-clone commit contract:
    /// validate and execute the plan on an isolated clone with a temporary
    /// journal, then publish state and record one undo entry only on success.
    /// A `None` context preserves the original synchronous behavior exactly.
    fn apply_batch(
        &mut self,
        cmd: Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError>;

    /// Run a command as a cancelable task. Same atomicity contract as
    /// `apply`: a cancelled command returns `ErrorCode::Cancelled` and leaves
    /// the document unchanged.
    ///
    /// The default routes `__batch` to `apply_batch` with the task context,
    /// checks for cancellation once, then runs `apply` to completion. Engines
    /// with long ops override it to check `ctx` between chunks or stages and
    /// report progress through `ctx.set_progress`; overrides must forward
    /// `OP_BATCH` to `apply_batch` themselves so batch steps stay cancellable.
    fn apply_long(&mut self, cmd: Command, ctx: &TaskContext) -> Result<CommandResult, EngineError> {
        if cmd.op == OP_BATCH {
            return self.apply_batch(cmd, Some(ctx));
        }
        ctx.checkpoint()?;
        let result = self.apply(cmd)?;
        ctx.set_progress(1.0);
        Ok(result)
    }
}
