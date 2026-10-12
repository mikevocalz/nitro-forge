/// Bounded undo/redo journal.
///
/// Engines record an undo entry *before* applying a mutation. The entry type is
/// engine-defined: a cell's previous value, a removed clip, the pixel region
/// about to be overwritten — whatever is sufficient to invert the command.
///
/// Recording a new entry clears the redo stack, matching editor convention.
pub struct Journal<T> {
    undo: Vec<T>,
    redo: Vec<T>,
    capacity: usize,
}

impl<T> Journal<T> {
    pub fn new(capacity: usize) -> Self {
        Self {
            undo: Vec::new(),
            redo: Vec::new(),
            capacity: capacity.max(1),
        }
    }

    /// Record an undo entry. Call this before mutating; clears redo.
    pub fn record(&mut self, entry: T) {
        if self.undo.len() == self.capacity {
            self.undo.remove(0);
        }
        self.undo.push(entry);
        self.redo.clear();
    }

    /// Pop the most recent undo entry. The engine is responsible for pushing
    /// the corresponding redo entry while applying the inverse.
    pub fn pop_undo(&mut self) -> Option<T> {
        self.undo.pop()
    }

    pub fn push_redo(&mut self, entry: T) {
        self.redo.push(entry);
    }

    pub fn pop_redo(&mut self) -> Option<T> {
        self.redo.pop()
    }

    /// Re-push an entry onto undo without touching redo (used by `Engine::redo`
    /// implementations after re-applying a command).
    pub fn push_undo(&mut self, entry: T) {
        self.undo.push(entry);
    }

    pub fn undo_len(&self) -> usize {
        self.undo.len()
    }

    pub fn redo_len(&self) -> usize {
        self.redo.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_entry_clears_redo() {
        let mut j: Journal<u32> = Journal::new(4);
        j.record(1);
        j.push_redo(9);
        j.record(2);
        assert_eq!(j.redo_len(), 0);
        assert_eq!(j.undo_len(), 2);
    }

    #[test]
    fn capacity_evicts_oldest() {
        let mut j: Journal<u32> = Journal::new(2);
        j.record(1);
        j.record(2);
        j.record(3);
        assert_eq!(j.pop_undo(), Some(3));
        assert_eq!(j.pop_undo(), Some(2));
        assert_eq!(j.pop_undo(), None);
    }
}
