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

/// A sub-range of the parent task's progress that a scoped context reports
/// into, stored already mapped into the root task's 0..=1 units.
#[derive(Debug, Clone, Copy)]
struct Window {
    lo: f32,
    hi: f32,
}

/// Cheap, clonable handle to one task's cancel flag and progress value.
#[derive(Debug, Clone, Default)]
pub struct TaskContext {
    shared: Arc<Shared>,
    /// `Some` for a scoped child: `set_progress` maps 0..=1 into this window
    /// of the shared progress instead of reporting task-wide progress.
    window: Option<Window>,
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

    /// Return a child context that shares this task's cancellation flag but
    /// reports progress into the `lo..=hi` window of the task's overall
    /// progress. `lo`/`hi` are fractions of *this* context's progress, so
    /// windows nest: `ctx.scoped(0.0, 0.5).scoped(0.0, 0.5)` reports into
    /// 0..=0.25 of the root task. Used to give each step of a batch its own
    /// slice of progress while `apply_long` implementations keep reporting
    /// their usual 0..=1 within the step.
    pub fn scoped(&self, lo: f32, hi: f32) -> TaskContext {
        fn clean(v: f32) -> f32 {
            if v.is_nan() {
                0.0
            } else {
                v.clamp(0.0, 1.0)
            }
        }
        let (lo, hi) = (clean(lo), clean(hi));
        let window = match self.window {
            Some(w) => Window {
                lo: w.lo + lo * (w.hi - w.lo),
                hi: w.lo + hi * (w.hi - w.lo),
            },
            None => Window { lo, hi },
        };
        TaskContext {
            shared: Arc::clone(&self.shared),
            window: Some(window),
        }
    }

    /// Record progress. Values are clamped to 0..=1 and never move backwards.
    /// On a scoped context the value is first mapped into its window, so the
    /// shared task progress advances monotonically across steps.
    pub fn set_progress(&self, value: f32) {
        let value = if value.is_nan() {
            0.0
        } else {
            value.clamp(0.0, 1.0)
        };
        let value = match self.window {
            Some(w) => w.lo + value * (w.hi - w.lo),
            None => value,
        };
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
    fn scoped_progress_maps_into_window_and_stays_monotonic() {
        let ctx = TaskContext::new();
        let first = ctx.scoped(0.0, 0.5);
        let second = ctx.scoped(0.5, 1.0);
        // Scoped children share the cancel flag with the root task.
        first.cancel();
        assert!(ctx.is_cancelled());
        assert!(second.checkpoint().is_err());

        let ctx = TaskContext::new();
        let first = ctx.scoped(0.0, 0.5);
        let second = ctx.scoped(0.5, 1.0);
        first.set_progress(0.5);
        assert_eq!(ctx.progress(), 0.25);
        // A later window cannot move progress backwards.
        first.set_progress(1.0);
        second.set_progress(0.0);
        assert_eq!(ctx.progress(), 0.5);
        second.set_progress(1.0);
        assert_eq!(ctx.progress(), 1.0);
    }

    #[test]
    fn nested_scoped_windows_compose() {
        let ctx = TaskContext::new();
        let outer = ctx.scoped(0.0, 0.5);
        let inner = outer.scoped(0.0, 0.5);
        inner.set_progress(1.0);
        assert_eq!(ctx.progress(), 0.25);
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
