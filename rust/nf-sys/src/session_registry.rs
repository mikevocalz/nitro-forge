//! Native FFI sessions: global map lock protects only lookup/insert/remove.
//! Each engine gets an independent serial mutex for its synchronous state.
//! No user/engine code runs under the global map lock.

use ignition_core::{Engine, EngineError};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

struct Session {
    closing: AtomicBool,
    engine: Mutex<Option<Box<dyn Engine>>>,
}

/// One registry per native runtime. The FFI entrypoints use a OnceLock instance.
///
/// This is *per-session synchronization*, not a dedicated worker scheduler.
/// Nitro v1's native adapter must dispatch potentially expensive operations off
/// the JS/UI thread. This registry ensures unrelated sessions do not serialize.
pub struct ConcurrentSessions {
    next: AtomicU64,
    sessions: Mutex<HashMap<u64, Arc<Session>>>,
}

fn lock_unpoison<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

impl Default for ConcurrentSessions {
    fn default() -> Self {
        Self::new()
    }
}

impl ConcurrentSessions {
    pub fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn open(&self, engine: Box<dyn Engine>) -> Result<i64, EngineError> {
        // No recycling of handles, even after close. Avoid overflowing signed
        // i64 C ABI handles, and never issue zero as a valid handle.
        let id = self
            .next
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |next| {
                if next == 0 || next > i64::MAX as u64 {
                    None
                } else {
                    Some(next + 1)
                }
            })
            .map_err(|_| EngineError::internal("native session handle space exhausted"))?;

        let session = Arc::new(Session {
            closing: AtomicBool::new(false),
            engine: Mutex::new(Some(engine)),
        });
        lock_unpoison(&self.sessions).insert(id, session);
        Ok(id as i64)
    }

    /// Execute one atomic command on exactly one document.
    ///
    /// An in-progress command finishes before close() returns. Any task that
    /// obtained a handle before close but has not entered the session lock
    /// observes closing=true and is rejected. A panic kills only this session.
    pub fn with_engine<T>(
        &self,
        handle: i64,
        operation: impl FnOnce(&mut dyn Engine) -> Result<T, EngineError>,
    ) -> Result<T, EngineError> {
        let session = self.lookup(handle)?;
        let mut guard = lock_unpoison(&session.engine);
        if session.closing.load(Ordering::Acquire) {
            return Err(EngineError::not_found(format!(
                "closed native session {handle}"
            )));
        }
        let engine = guard
            .as_deref_mut()
            .ok_or_else(|| EngineError::not_found(format!("closed native session {handle}")))?;

        // Catch here, *inside* the session lock, so one panicking document
        // cannot unwind across a C ABI or poison the registry map lock.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| operation(engine)));
        let value = match result {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => {
                if !error.recoverable {
                    session.closing.store(true, Ordering::Release);
                    guard.take();
                }
                Err(error)
            }
            Err(_) => {
                session.closing.store(true, Ordering::Release);
                guard.take();
                Err(EngineError::internal(
                    "engine panicked; native session closed",
                ))
            }
        };
        let terminal = session.closing.load(Ordering::Acquire);
        drop(guard);
        if terminal {
            self.remove_if_current(handle as u64, &session);
        }
        value
    }

    /// Returns true once for a live handle. Never runs a document operation
    /// while holding the global map lock; waits for any in-flight operation.
    pub fn close(&self, handle: i64) -> bool {
        if handle <= 0 {
            return false;
        }
        let session = {
            let mut sessions = lock_unpoison(&self.sessions);
            let Some(session) = sessions.remove(&(handle as u64)) else {
                return false;
            };
            session.closing.store(true, Ordering::Release);
            session
        };
        lock_unpoison(&session.engine).take();
        true
    }

    fn lookup(&self, handle: i64) -> Result<Arc<Session>, EngineError> {
        if handle <= 0 {
            return Err(EngineError::not_found(format!(
                "invalid native session {handle}"
            )));
        }
        lock_unpoison(&self.sessions)
            .get(&(handle as u64))
            .cloned()
            .ok_or_else(|| EngineError::not_found(format!("no native session {handle}")))
    }

    fn remove_if_current(&self, id: u64, session: &Arc<Session>) {
        let mut sessions = lock_unpoison(&self.sessions);
        if sessions
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            sessions.remove(&id);
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        lock_unpoison(&self.sessions).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::{Command, CommandResult, EngineKind};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    struct Dummy {
        drops: Arc<AtomicUsize>,
    }
    impl Drop for Dummy {
        fn drop(&mut self) {
            self.drops.fetch_add(1, Ordering::SeqCst);
        }
    }
    impl Engine for Dummy {
        fn kind(&self) -> EngineKind {
            EngineKind::Tally
        }
        fn apply(&mut self, _command: Command) -> Result<CommandResult, EngineError> {
            Ok(CommandResult::empty())
        }
        fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
            Ok(vec![1, 2, 3])
        }
        fn restore(&mut self, _bytes: &[u8]) -> Result<(), EngineError> {
            Ok(())
        }
        fn undo(&mut self) -> Result<bool, EngineError> {
            Ok(false)
        }
        fn redo(&mut self) -> Result<bool, EngineError> {
            Ok(false)
        }
    }

    fn dummy(drops: &Arc<AtomicUsize>) -> Box<dyn Engine> {
        Box::new(Dummy {
            drops: Arc::clone(drops),
        })
    }

    #[test]
    fn open_close_does_not_reuse_handle_and_drops_exactly_once() {
        let sessions = ConcurrentSessions::new();
        let drops = Arc::new(AtomicUsize::new(0));
        let a = sessions.open(dummy(&drops)).unwrap();
        assert!(a > 0);
        assert_eq!(
            sessions.with_engine(a, |engine| engine.snapshot()).unwrap(),
            vec![1, 2, 3]
        );
        assert!(sessions.close(a));
        assert!(!sessions.close(a));
        assert!(sessions.with_engine(a, |engine| engine.snapshot()).is_err());
        let b = sessions.open(dummy(&drops)).unwrap();
        assert!(b > a);
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        assert!(sessions.close(b));
        assert_eq!(drops.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn unrelated_documents_progress_without_the_same_global_engine_lock() {
        let sessions = Arc::new(ConcurrentSessions::new());
        let drops = Arc::new(AtomicUsize::new(0));
        let slow = sessions.open(dummy(&drops)).unwrap();
        let fast = sessions.open(dummy(&drops)).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let slow_reg = Arc::clone(&sessions);
        let slow_thread = thread::spawn(move || {
            slow_reg.with_engine(slow, |_engine| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let fast_reg = Arc::clone(&sessions);
        let (complete_tx, complete_rx) = mpsc::channel();
        let fast_thread = thread::spawn(move || {
            let result = fast_reg.with_engine(fast, |engine| engine.snapshot());
            complete_tx.send(result).unwrap();
        });
        // A global engine mutex would make this wait until the slow session
        // unblocks. Always release it before asserting, so failures won't hang.
        let independent = complete_rx.recv_timeout(Duration::from_secs(2));
        release_tx.send(()).unwrap();
        assert!(slow_thread.join().unwrap().is_ok());
        fast_thread.join().unwrap();
        assert_eq!(independent.unwrap().unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn terminal_error_or_panic_closes_only_its_document() {
        let sessions = ConcurrentSessions::new();
        let drops = Arc::new(AtomicUsize::new(0));
        let bad = sessions.open(dummy(&drops)).unwrap();
        let other = sessions.open(dummy(&drops)).unwrap();
        let err = sessions
            .with_engine(bad, |_engine| -> Result<(), EngineError> {
                panic!("simulated per-document engine panic")
            })
            .unwrap_err();
        assert!(!err.recoverable);
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions
                .with_engine(other, |engine| engine.snapshot())
                .unwrap(),
            vec![1, 2, 3]
        );
        let terminal = sessions
            .with_engine(other, |_engine| -> Result<(), EngineError> {
                Err(EngineError::internal("fatal"))
            })
            .unwrap_err();
        assert!(!terminal.recoverable);
        assert_eq!(sessions.len(), 0);
        assert_eq!(drops.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn closing_prevents_new_commands_and_waits_for_in_flight_command() {
        let sessions = Arc::new(ConcurrentSessions::new());
        let drops = Arc::new(AtomicUsize::new(0));
        let id = sessions.open(dummy(&drops)).unwrap();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let running = Arc::clone(&sessions);
        let worker = thread::spawn(move || {
            running.with_engine(id, |_engine| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let closing = Arc::clone(&sessions);
        let (close_tx, close_rx) = mpsc::channel();
        let closer = thread::spawn(move || close_tx.send(closing.close(id)).unwrap());
        // Regardless of which thread gets scheduled next, release all work.
        release_tx.send(()).unwrap();
        assert!(worker.join().unwrap().is_ok());
        closer.join().unwrap();
        assert_eq!(close_rx.recv_timeout(Duration::from_secs(2)).unwrap(), true);
        assert!(sessions
            .with_engine(id, |engine| engine.snapshot())
            .is_err());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
}
