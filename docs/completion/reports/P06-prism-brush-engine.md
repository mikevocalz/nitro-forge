# P06 — Prism brush/stroke engine (implementation report)

Branch `codex/w5-prism-brush`, worktree
`recovered-work/2026-11-05/forge-w5-prism-brush`. Implements the build order
and budgets of `P-prism-brush-ink-decision.md` (google/ink admitted as a
pinned-commit **behavioral** reference only — no code copied, no dependency
added).

## What landed

Pure-Rust, deterministic, I/O-free pipeline in
`packages/prism/rust/src/stroke.rs` (~1700 lines incl. tests), wired through
`ops.rs`, `lib.rs`, `model.rs`:

1. **Stroke input model + stabilization** — `modelStroke` (read-only).
   Bounded samples `{t(seconds),x,y,pressure?,tilt?,orientation?,contact?}`
   run through: speed-adaptive wobble smoothing (time-windowed weighted
   moving average blended by tip speed), a damped-spring position model
   with end-of-stroke convergence, stylus-state interpolation projecting
   modeled positions back onto the raw polyline for pressure/tilt/
   orientation, and optional velocity-lookahead prediction.
2. **Brush presets + dynamics** — `addBrush`/`setBrush`/`removeBrush`/
   `listBrushes`. Brushes live in the document (`brushes` in the wire
   format and snapshots, sharing the entity id counter, ≤64 presets).
   Fields: size, opacity, flow, spacing, hardness, color, `dynamics`
   coefficients (pressure/velocity/tilt → size/opacity/flow multipliers)
   and `taper` (arc-length envelope).
3. **Dab generation + rasterization** — `paintStroke` models the samples,
   resolves dynamics+taper per dab (≤262144 dabs), and stamps circular
   anti-aliased coverage src-over onto a raster layer through the existing
   `raster::blend_pixel` path. One pixel-region undo entry per committed
   stroke; `commit:false` is a read-only dry run returning `{dabs,bounds}`.
   `brush_id` (stored preset) or inline `brush` spec; exactly one required.
4. **Atomicity/hostile input** — all validation precedes id allocation,
   journaling and mutation; rejected ops leave state, ids, undo and redo
   untouched (a regression where `addBrush` consumed `next_id` before
   validating was found and fixed). Budgets: ≤4096 samples/op, ≤32768
   modeled points, finite coordinates within `MAX_COORD`, non-decreasing
   timestamps.
5. **TS API** — `modelStroke`, `addBrush`, `setBrush`, `removeBrush`,
   `listBrushes`, `paintStroke` on `PrismDocument` plus matching types in
   `canvas-types.ts`. `docs/ENGINE_OPS.md` §prism documents payloads,
   returns and budgets.

## Fidelity vs ink-stroke-modeler (google/ink)

Reimplemented from the published algorithm structure (Apache-2.0 reference,
pinned commit per the decision record):

- Wobble smoothing: same duration-weighted moving-average + speed-based
  blend shape; parameters exposed via `params`.
- Position model: mass-on-damped-spring with drag, driven by a corrected
  anchor; same qualitative behavior.
- Stylus-state interpolation: modeled tip projected onto the raw input
  polyline; pressure/tilt/orientation interpolated along it.
- End-of-stroke convergence loop with configurable stopping distance and
  iteration cap.

Known differences / NOT implemented:

- **Loop contraction mitigation** (ink's `cubic_bezier`/loop handling) —
  absent; tight loops may overshoot differently.
- **Kalman predictor** — `predict` is a simple damped velocity lookahead,
  not the reference's Kalman-filter prediction.
- No stylus-tool/tilt-axis special-casing beyond normalized tilt and
  orientation angles; no per-platform input quirks.
- Dab shape is circular with a hardness falloff — no textured/stamp
  brushes, no rotation, no scatter, no dual-brush.
- Dynamics coefficients are linear multipliers clamped to sane ranges —
  not ink's full pressure-curve DSL.

## Deferred (honest scope)

- Erase modes (pixel/vector/mask eraser brushes) — not started.
- Timelapse stroke encoding (`TimelapsePlaybackExporter`, B-32) — no
  encoder exists; engine history is not yet a recording format.
- Hardware/platform input: Android MotionEvent prediction, PencilKit,
  Windows Ink, Muse spatial ink, palm rejection — host-side or later work
  (N-01, N-03, N-04).
- Live in-progress stroke preview remains host-side per the decision
  record; the engine commits one `paintStroke`.
- UI components B-15/B-16/B-17/B-29/B-33 remain ABSENT in
  `docs/completion/PLAN.md` — engine ops exist, UI is separate work.

## Verification actually run

- `cargo test -p prism-engine` — **151 pass, 0 fail**
- `cargo build -p nf-cli` — clean (one unused-field warning fixed)
- `pnpm install --prefer-offline` — clean, no ENOSPC
- `pnpm --filter @nitro-forge/prism test` — **32 pass** (5 files; 5 new
  brush/stroke e2e tests driving the real Rust engine via nf-cli:
  determinism/bounds, CRUD+snapshot round-trip, commit/dry-run/undo,
  validation rejections, taper coverage)
- `pnpm --filter @nitro-forge/prism typecheck` — clean
