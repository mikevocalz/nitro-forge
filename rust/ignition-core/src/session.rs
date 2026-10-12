use crate::engine::Engine;
use crate::error::EngineError;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

/// Handle-keyed registry of live engines.
///
/// The host (Nitro module or nf-cli) owns a registry. Each handle maps to one
/// engine on one worker. Dropping the registry drops every document.
pub struct SessionRegistry {
    engines: HashMap<u64, Box<dyn Engine>>,
    next_handle: AtomicU64,
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            engines: HashMap::new(),
            next_handle: AtomicU64::new(1),
        }
    }

    pub fn open(&mut self, engine: Box<dyn Engine>) -> u64 {
        let handle = self.next_handle.fetch_add(1, Ordering::Relaxed);
        self.engines.insert(handle, engine);
        handle
    }

    pub fn get(&self, handle: u64) -> Option<&dyn Engine> {
        self.engines.get(&handle).map(|e| e.as_ref())
    }

    pub fn get_mut(&mut self, handle: u64) -> Option<&mut dyn Engine> {
        self.engines.get_mut(&handle).map(|e| e.as_mut())
    }

    /// Close a document. Returns false if the handle was unknown.
    pub fn close(&mut self, handle: u64) -> bool {
        self.engines.remove(&handle).is_some()
    }

    pub fn require_mut(&mut self, handle: u64) -> Result<&mut dyn Engine, EngineError> {
        self.get_mut(handle)
            .ok_or_else(|| EngineError::not_found(format!("no engine for handle {handle}")))
    }

    pub fn require(&self, handle: u64) -> Result<&dyn Engine, EngineError> {
        self.get(handle)
            .ok_or_else(|| EngineError::not_found(format!("no engine for handle {handle}")))
    }

    pub fn len(&self) -> usize {
        self.engines.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{Command, CommandResult};
    use crate::engine::EngineKind;

    struct Dummy;
    impl Engine for Dummy {
        fn kind(&self) -> EngineKind {
            EngineKind::Tally
        }
        fn apply(&mut self, _cmd: Command) -> Result<CommandResult, EngineError> {
            Ok(CommandResult::empty())
        }
        fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
            Ok(vec![])
        }
        fn restore(&mut self, _d: &[u8]) -> Result<(), EngineError> {
            Ok(())
        }
        fn undo(&mut self) -> Result<bool, EngineError> {
            Ok(false)
        }
        fn redo(&mut self) -> Result<bool, EngineError> {
            Ok(false)
        }
    }

    #[test]
    fn open_close_cycle() {
        let mut reg = SessionRegistry::new();
        let h = reg.open(Box::new(Dummy));
        assert!(reg.get(h).is_some());
        assert!(reg.close(h));
        assert!(reg.get(h).is_none());
        assert!(!reg.close(h));
        assert!(reg.require_mut(h).is_err());
    }
}
