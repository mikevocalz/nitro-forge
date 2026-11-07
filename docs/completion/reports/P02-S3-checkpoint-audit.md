# P02-S3 checkpoint/cancellation audit — all 11 engines

2026-11-11. Read-only audit. Mechanism: `Engine::apply_long` default =
one pre-op `ctx.checkpoint()`; engines override to route heavy ops to
`Option<&TaskContext>`-aware variants (established pattern identical in
cadence/folio/quill/photo/motion/design/draft). `execute_batch` calls
`staged.apply` — **batch sub-commands never see a TaskContext**; any
heavy op inside `__batch` (≤64) or Splice `batch` (≤256) runs fully
uninterruptible in every batch-capable engine.

## Per-engine findings

| Engine | Long ops | Status | Action | Effort |
|---|---|---|---|---|
| Prism | applyFilter, drawPixels, fillLayer, flatten, renderRegion, thumbnails, magicWand, selectRegion, modifySelection, paintMask, refineMask, invertMask, booleanLayers, rasterizeLayer, floodFill, convertToPath (~15 ops, MAX_PIXELS 2^28) | No apply_long override; all pixel loops uninterruptible | Add apply_long + thread Option<&TaskContext> through raster/render/select/vector (mirror cadence mixdown_with_context). Prioritize flatten/applyFilter/drawPixels/fillLayer/renderRegion/rasterizeLayer/booleanLayers | High — 2-3 PRs |
| Cadence | render covered (mixdown_with_context). meter/loudness/spectrogram bypass apply_long → ctx-less mixdown + FFT | render ok; analysis ops uncheckpointed | Route meter/loudness/spectrogram through apply_long; checkpoint inside spectrogram FFT loop | Low-med |
| Splice | O(tracks×clips) plan ops only, no frame rendering | Fine as-is; optional per-step batch checkpoint | Optional | Low |
| Folio | save checkpointed (two-stage). open/encrypt/decrypt monolithic lopdf — cannot checkpoint inside dependency | save ok; rest dependency-bound | Document limitation | n/a |
| Pitch | structurally bounded doc ops | Fine | None | — |
| Tally | 16 384-cell ops + formula evals ~100ms borderline | Optional per-N-cell checkpoints in getRange/fillRange/commit_cells | Low priority | Low |
| Quill | exportDocx covered; importDocx quick-xml parse uncheckpointed | Optional ctx into docx::import_docx event loop | Medium | Medium |
| Photo | processPreview checkpointed every 4096px — best-in-repo | Covered | None | — |
| Motion | renderFrame checkpoints per layer + around flatten; inner Prism apply calls uninterruptible | Covered at Motion level; blocked on Prism | Pass ctx into inner prism.apply_long once Prism supports | Medium (dep Prism) |
| Design | Same as Motion (per-box checkpoints; inner Prism calls blocked) | Same | Same | Medium (dep Prism) |
| Draft | renderFrame per-entity checkpoints; solve bounded ≤16.7M MACs uncheckpointed | Fine; optional pre-checkpoint for solve | Trivial | Trivial |

## Cross-cutting recommendations

1. **Prism is the critical path** — Motion/Design per-layer raster work
   delegates to `PrismEngine::apply`, so their checkpoints can't
   interrupt pixel work. Prism `apply_long` unblocks honest progress
   for Motion/Design/Draw renders too.
2. **`execute_batch` needs a ctx-aware variant** (`batch.rs:74`) —
   cheapest systemic fix: `execute_batch_with_ctx` calling `apply_long`
   per step, or reject known-long ops inside batches.
3. Mirror the cadence/folio pattern exactly: checkpoint up front, route
   only heavy op names, `self.apply` fallback, `set_progress(1.0)` end;
   in-loop checkpoints every N items with monotonic progress.
