use serde::{Deserialize, Serialize};
use std::fmt;

/// Closed set of error categories a host can rely on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// The op name or payload shape is not understood by the engine.
    InvalidCommand,
    /// A referenced entity (layer, track, cell, page, ...) does not exist.
    NotFound,
    /// The command is understood but violates document invariants.
    Validation,
    /// Snapshot bytes are truncated, foreign, or fail to decode.
    Serialization,
    /// An index, range, or coordinate is outside the legal domain.
    OutOfBounds,
    /// A feature is defined but not implemented for this document/op.
    Unsupported,
    /// Anything else. The session should be treated as dead by the host.
    Internal,
}

/// The only error type that crosses the engine boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineError {
    pub code: ErrorCode,
    pub message: String,
    /// `true` = document is intact, user may keep working.
    /// `false` = session is dead; host should restore from last snapshot.
    pub recoverable: bool,
}

impl EngineError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable: !matches!(code, ErrorCode::Internal),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidCommand, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }

    pub fn serialization(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Serialization, message)
    }

    pub fn out_of_bounds(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::OutOfBounds, message)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for EngineError {}

impl From<serde_json::Error> for EngineError {
    fn from(e: serde_json::Error) -> Self {
        EngineError::serialization(e.to_string())
    }
}
