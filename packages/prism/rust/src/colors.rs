//! Document color state: foreground, background and recently committed
//! colors. A color picker commits here (roster C-01), so a chosen color is
//! part of the saved document instead of living only in UI state.
//!
//! The palette is independent of the layer stack: `new` and layer undo
//! entries leave it alone, and it has its own undo entry.

use serde::{Deserialize, Serialize};

/// Most recent colors kept, newest first.
pub const RECENT_CAPACITY: usize = 16;

pub type Rgba = [u8; 4];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocColors {
    pub foreground: Rgba,
    pub background: Rgba,
    #[serde(default)]
    pub recent: Vec<Rgba>,
}

impl Default for DocColors {
    fn default() -> Self {
        Self {
            foreground: [0, 0, 0, 255],
            background: [255, 255, 255, 255],
            recent: Vec::new(),
        }
    }
}

impl DocColors {
    /// Returns the palette after committing the given colors, or `None`
    /// when nothing would change. Committed colors move to the front of
    /// `recent` (deduplicated, capped) when `remember` is set.
    pub fn committed(&self, fg: Option<Rgba>, bg: Option<Rgba>, remember: bool) -> Option<Self> {
        let mut next = self.clone();
        if let Some(c) = fg {
            next.foreground = c;
        }
        if let Some(c) = bg {
            next.background = c;
        }
        if remember {
            // Background first so a simultaneous foreground commit ends up newest.
            for c in [bg, fg].into_iter().flatten() {
                next.remember(c);
            }
        }
        (next != *self).then_some(next)
    }

    fn remember(&mut self, c: Rgba) {
        self.recent.retain(|r| *r != c);
        self.recent.insert(0, c);
        self.recent.truncate(RECENT_CAPACITY);
    }

    pub fn swapped(&self) -> Option<Self> {
        if self.foreground == self.background {
            return None;
        }
        let mut next = self.clone();
        std::mem::swap(&mut next.foreground, &mut next.background);
        Some(next)
    }

    /// Restored snapshots may carry an oversized list; keep the newest entries.
    pub fn normalized(mut self) -> Self {
        self.recent.truncate(RECENT_CAPACITY);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = [255, 0, 0, 255];
    const BLUE: Rgba = [0, 0, 255, 255];

    #[test]
    fn commit_sets_and_remembers_newest_first() {
        let c = DocColors::default()
            .committed(Some(RED), None, true)
            .unwrap()
            .committed(Some(BLUE), None, true)
            .unwrap();
        assert_eq!(c.foreground, BLUE);
        assert_eq!(c.recent, vec![BLUE, RED]);
    }

    #[test]
    fn recommitting_moves_to_front_without_duplicates() {
        let c = DocColors::default()
            .committed(Some(RED), None, true)
            .unwrap()
            .committed(Some(BLUE), None, true)
            .unwrap()
            .committed(Some(RED), None, true)
            .unwrap();
        assert_eq!(c.recent, vec![RED, BLUE]);
    }

    #[test]
    fn recent_is_capped() {
        let mut c = DocColors::default();
        for i in 0..40u8 {
            c = c.committed(Some([i, 0, 0, 255]), None, true).unwrap();
        }
        assert_eq!(c.recent.len(), RECENT_CAPACITY);
        assert_eq!(c.recent[0], [39, 0, 0, 255]);
    }

    #[test]
    fn identical_commit_is_no_change() {
        let c = DocColors::default();
        assert!(c.committed(Some([0, 0, 0, 255]), None, false).is_none());
    }

    #[test]
    fn swap_of_equal_colors_is_no_change() {
        let mut c = DocColors::default();
        c.background = c.foreground;
        assert!(c.swapped().is_none());
    }
}
