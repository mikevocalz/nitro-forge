//! Resident-memory accounting for `Engine::resident_bytes`.
//!
//! Pixels dominate a Prism document: each raster layer and mask is a
//! canvas-sized buffer, and structural undo entries share those buffers
//! through `Arc`. Counting every `Arc` once (by address) keeps the number
//! honest when the same pixels sit in the live stack and in history.
//! Vector geometry, names and palettes are small next to pixels and are
//! counted only as fixed per-layer overhead.

use std::collections::HashSet;
use std::sync::Arc;

use crate::model::{Content, Layer};

/// Accumulates bytes, counting each shared pixel buffer once.
#[derive(Default)]
pub(crate) struct Tally {
    seen: HashSet<usize>,
    bytes: usize,
}

impl Tally {
    /// A shared buffer: counted the first time its address is seen.
    pub(crate) fn shared(&mut self, buffer: &Arc<Vec<u8>>) {
        if self.seen.insert(Arc::as_ptr(buffer) as usize) {
            self.bytes = self.bytes.saturating_add(buffer.capacity());
        }
    }

    /// A buffer owned by exactly one place (pixel-region undo entries).
    pub(crate) fn owned(&mut self, buffer: &[u8]) {
        self.bytes = self.bytes.saturating_add(buffer.len());
    }

    pub(crate) fn layers(&mut self, layers: &[Layer]) {
        self.bytes = self
            .bytes
            .saturating_add(layers.len().saturating_mul(std::mem::size_of::<Layer>()));
        for layer in layers {
            if let Content::Raster(pixels) = &layer.content {
                self.shared(pixels);
            }
            if let Some(mask) = &layer.mask {
                self.shared(&mask.alpha);
            }
        }
    }

    pub(crate) fn selection(&mut self, selection: &Option<Arc<Vec<u8>>>) {
        if let Some(alpha) = selection {
            self.shared(alpha);
        }
    }

    pub(crate) fn total(&self) -> usize {
        self.bytes
    }
}

#[cfg(test)]
mod tests {
    use crate::PrismEngine;
    use ignition_core::{Command, Engine};
    use serde_json::json;

    fn apply(e: &mut PrismEngine, op: &str, payload: serde_json::Value) -> serde_json::Value {
        e.apply(Command::new(op, payload)).expect(op).data
    }

    #[test]
    fn counts_raster_pixels_and_shares_them_with_structural_undo() {
        let mut e = PrismEngine::new(0, 0);
        apply(&mut e, "new", json!({"width": 64, "height": 64}));
        let empty = e.resident_bytes().expect("prism accounts for itself");
        let canvas = 64 * 64 * 4;
        assert!(empty < canvas, "no layer yet: {empty}");

        apply(&mut e, "addRasterLayer", json!({}));
        let one = e.resident_bytes().unwrap();
        assert!(one >= empty + canvas, "one raster layer: {one}");

        // Toggling visibility records a structural undo entry that shares
        // the layer's pixels; the buffer must not be counted twice.
        let id = apply(&mut e, "describe", json!({}))["layers"][0]["id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "setLayerVisible",
            json!({"id": id, "visible": false}),
        );
        let shared = e.resident_bytes().unwrap();
        assert!(
            shared < one + canvas,
            "shared buffer counted twice: {shared}"
        );

        apply(&mut e, "addRasterLayer", json!({}));
        assert!(e.resident_bytes().unwrap() >= shared + canvas);
    }

    #[test]
    fn restore_replaces_the_accounted_document() {
        let mut big = PrismEngine::new(0, 0);
        apply(&mut big, "new", json!({"width": 128, "height": 128}));
        apply(&mut big, "addRasterLayer", json!({}));
        let mut small = PrismEngine::new(0, 0);
        apply(&mut small, "new", json!({"width": 2, "height": 2}));
        apply(&mut small, "addRasterLayer", json!({}));
        let before = big.resident_bytes().unwrap();
        big.restore(&small.snapshot().unwrap()).unwrap();
        let after = big.resident_bytes().unwrap();
        assert!(after < before / 100, "{before} -> {after}");
    }
}
