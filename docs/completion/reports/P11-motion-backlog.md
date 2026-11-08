# P11 motion and compositing backlog

2026-11-07. Source-scoping record for dispatching implementation slices.
Backed by `components.json`, `P12-P20-IMPLEMENTATION-MAP.md`,
`packages/motion/rust` and NYC-Tron motion model contracts. No slice is
complete; this is a work list, not acceptance.

## Current state

`packages/motion` (engine tag 8): flat `Layer` (shape rect|ellipse or
raster asset, 2D transform, opacity, 8 scalar curve-bound properties,
hold|linear|bezier keys). Ops: composition settings, layer CRUD/order,
raster asset add/read/remove, `evaluate`, `renderFrame` (ephemeral
PrismEngine per frame), snapshots schema:1, caps (128 layers/curves,
16 MiB state, 4096² canvas). Prism v2 capabilities already available but
unused: 13 W3C blend modes, masks, groups/parents, path layers, booleans,
artboards. Media decode is host-side only; no encoder exists in Forge.

## Slice order (A–G unblocked; H–J partially blocked)

- **A — nested compositions**: schema:2, `compositions` map, layer
  `kind: shape|raster|comp`, `parent_id`, `comp_id`; depth ≤8, ≤16 comps,
  acyclic; ops `addComposition`/`duplicateComposition`/`setLayerParent`/
  `reparentLayer`/`removeComposition`; recursive offscreen-Prism render.
  Versioning decision: always serialize `schema:N`, restore accepts
  `1..=N` with serde defaults (additive; simpler than Pitch wrapper).
- **B1 — blend modes + parenting + clipping**: map to Prism
  `setLayerBlend`/`setLayerParent`/`clipped`; ops `setLayerBlend`,
  `setLayerClipped`.
- **B2 — mattes**: `Layer.matte{source_layer,mode:alpha|alpha-inverted|
  luma|luma-inverted,feather,enabled}`; render source subtree to buffer,
  derive mask, bounded feather (≤64 px), composite; `setLayerMatte`.
  Painted masks deferred (no authoring model yet).
- **C — effect stack**: `Layer.effects[]` typed params; v1 registry =
  bounded CPU RGBA passes (invert, grayscale, brightness, contrast,
  gaussian-blur, fill/tint) reusing photo develop math precedent; ≤16
  effects/layer. Requires rasterize-then-upload render refactor.
- **D — bounded expressions + time remap**: hand-rolled parser → AST;
  grammar = arithmetic/comparison/ternary + whitelisted functions +
  `time/frame/fps/duration/this.<prop>/comp().layer()` refs; source ≤4 KiB,
  AST ≤512 nodes, eval ≤10k steps; spec MUST be written into ENGINE_OPS
  before coding. Expression owns or yields to keys — pick and document.
  **Implemented 2026-11-08** per `P11-motion-expressions-spec.md` (chose
  mutually-exclusive last-write-wins ownership; `layer(<id>)` same-comp
  refs only, `comp()` deferred; no time-remap op — backlog item folded
  into expressions only). See ROSTER slice-D checkpoint.
- **E — motion paths**: `Layer.path` adopting Prism node model;
  `Property::PathProgress` via existing curve machinery; arc-length table
  (≤256 nodes, ≤4096 samples); `setMotionPath`, `auto_orient`.
- **F — particles**: deterministic emitter (seeded PRNG + closed-form
  integration, no sim state); `setParticleEmitter`; ≤512 sprites/frame,
  ≤64 emitters; sprites = shapes or existing assets.
- **G1 — 3D schema/eval**: `Transform3D`, `Camera`, `Light[]`; ops for
  each; `evaluate` returns projected 2D transform; honest limitation
  documented until G2.
- **G2 — true projection rendering**: needs design note + check of Prism
  quad/path warp capability first; may admit only affine-preserving cases.
- **G3 — lighting**: CPU lambert/ambient on layer buffers (needs slice C
  path); shadows explicitly deferred.
- **H — media/footage layers**: engine stores `media{source_id,in_point}`
  refs only. Frame transport decision needed: recommend per-call packed
  `{layer_id,rgba}` sidecars over per-frame assets. Schema/ops unblocked;
  real pixels blocked on P03 Forge-side transport contract.
- **I — node graph (value nodes only)**: `State.graph` acyclic, topo-sort,
  step cap; feeds expressions/properties, NOT pixel compositing. Needs
  admitted node-type/port spec first.
  **Implemented 2026-11-08** per `P11-motion-nodegraph-spec.md` (scalar f64
  DAG, closed 48-kind enum, ≤512 nodes/≤2048 edges/≤128 bindings,
  `(layer,property)` bindings mutually exclusive with curves and
  expressions, pre-binding `property` reads, per-comp time-family eval,
  single `setGraph` full-replacement op). See ROSTER slice-I checkpoint.
- **J1 — render queue model**: durable `render_queue` jobs, ops
  enqueue/reorder/cancel/remove + `renderQueueFrame` raw RGBA stepping
  with real progress. **J2 encoded export blocked** — no encoder provider
  exists (shared gap with P08/P09/P14); queue must not fake completion.

Suggested dispatch: A → B1 → B2 → C → D → E → F → G1 → (H-schema, I, J1
parallel) → G2/G3 → H-transport → J2.

## Blockers

P03 decoder transport contract (H pixels), encoder provider (J2),
expression/node specs (D, I — write spec first), GPU/3D raster decision
(G2/G3), font provider (text layers — keep rejected), shadows (G3 defer).

## Doc gaps

ENGINE_OPS motion table is complete and matches code. Minor: `evaluate`
clears `curves` in output — undocumented; fix when next touched.
