//! Cancellation and progress for long-running commands (N-13).
//!
//! A `TaskContext` is shared between the thread running a command and the
//! threads observing it. Both fields are atomics, so polling progress or
//! requesting cancellation never waits on the document lock.

use crate::error::EngineError;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

#[derive(Debug, Default)]
struct Shared {
    cancelled: AtomicBool,
    /// `f32` progress in 0..=1, stored as bits.
    progress: AtomicU32,
}

/// Cheap, clonable handle to one task's cancel flag and progress value.
#[derive(Debug, Clone, Default)]
pub struct TaskContext {
    shared: Arc<Shared>,
}

impl TaskContext {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ask the running command to stop at its next checkpoint. Idempotent.
    pub fn cancel(&self) {
        self.shared.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.shared.cancelled.load(Ordering::Acquire)
    }

    /// `Err(Cancelled)` once cancellation was requested. Engines call this at
    /// checkpoints where stopping leaves the document unchanged.
    pub fn checkpoint(&self) -> Result<(), EngineError> {
        if self.is_cancelled() {
            Err(EngineError::cancelled())
        } else {
            Ok(())
        }
    }

    /// Record progress. Values are clamped to 0..=1 and never move backwards.
    pub fn set_progress(&self, value: f32) {
        let value = if value.is_nan() {
            0.0
        } else {
            value.clamp(0.0, 1.0)
        };
        let _ = self
            .shared
            .progress
            .try_update(Ordering::AcqRel, Ordering::Acquire, |bits| {
                (value > f32::from_bits(bits)).then_some(value.to_bits())
            });
    }

    pub fn progress(&self) -> f32 {
        f32::from_bits(self.shared.progress.load(Ordering::Acquire))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn progress_is_clamped_and_monotonic() {
        let ctx = TaskContext::new();
        assert_eq!(ctx.progress(), 0.0);
        ctx.set_progress(0.4);
        ctx.set_progress(0.2);
        assert_eq!(ctx.progress(), 0.4);
        ctx.set_progress(7.0);
        assert_eq!(ctx.progress(), 1.0);
        ctx.set_progress(f32::NAN);
        assert_eq!(ctx.progress(), 1.0);
    }

    #[test]
    fn cancel_is_shared_and_idempotent() {
        let ctx = TaskContext::new();
        let observer = ctx.clone();
        assert!(ctx.checkpoint().is_ok());
        observer.cancel();
        observer.cancel();
        let err = ctx.checkpoint().unwrap_err();
        assert_eq!(err.code, ErrorCode::Cancelled);
        assert!(err.recoverable);
    }
}
