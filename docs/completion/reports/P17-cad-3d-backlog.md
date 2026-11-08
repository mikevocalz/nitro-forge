# P17 CAD/3D/materials/nodes backlog

2026-11-07. Source-scoping record for dispatching implementation slices.
Audited `packages/draft` (engine tag 10) against NYC-Tron
`packages/ui/src/components/forge/cad/` contracts M-01–M-17 and the
P16-P17 backend entry plan. No slice is complete; this is a work list,
not acceptance.

## Current state

`draft-engine`: points/segments/circles/arcs (bounded), linear
constraints via Gaussian elimination (`solved|underconstrained|
inconsistent`), analytic snaps, bounded ASCII command grammar, `renderFrame`
via Prism paths (fill paints available; no text/glyph ops). Snapshot:
bare `State` JSON or strict `{kind:"draft",schema:2,document}` wrapper
gated by `requires_matching_reader()`; inner `State.schema` pinned 1.
TS: `DraftDocument` + `cad-bindings.ts` adapters; `DRAFT_SNAP_MODES`
marks `tangent` host-gated. All 17 P17 rows' `existingBackendDependency`
records "3D renderer + CAD/material engine (none; filament is an
unadopted candidate in forge #40)".

## Track A — 2D drafting/parametric CAD (pure Rust, unblocked)

Order: **A2 profiles → A1 layers → A4 hatches → A3 dimensions → A8
command grammar**; then **A7 paper space** (after A1), **A5 nonlinear
solver** (largest; start with distance/perpendicular/tangent subset),
**A9 blocks** (scope decision).

- A2 `findProfiles` read op: deterministic loop tracing over
  segments+arcs/circles; prerequisite for hatches/associative dims.
- A1 layers: `layers` map + `layer` field on entities; hidden ⇒ excluded
  from snaps/render; locked ⇒ edit rejection; default layer 0 on
  legacy restore.
- A3 associative dimensions: `dimensions` map (linear|aligned|angular|
  radial|diameter), measured derived geometry in `evaluate`,
  linked|orphaned status; render as Prism paths — **text deferred (no
  glyph backend; same gate as Quill fonts)**.
- A4 hatches: `hatches` map + bounded built-in patterns + solid fill via
  Prism `fill`; needs Prism `addMask` path-clip capability check first.
- A5 nonlinear solver: new `Definition` kinds (perpendicular, parallel,
  tangent, equal, distance, angle, radius, concentric, midpoint-on);
  LM/Gauss-Newton with hard budgets + `apply_long` checkpoints; keep
  linear path untouched; typed kinds only in v1 (expression field
  read-only).
- A7 paper space: `sheets`/`viewports` model + ops; `renderFrame{sheet_id}`;
  print is host-side (`printReady=false` until export exists).
  **Implemented 2026-11-07** (worktree forge-w3-draft-a7): sheets are named
  mm page setups (50..2000 mm, margins, unique names); viewports are
  sheet-contained mm rects with a world center + mm-per-unit scale, clipped
  honestly by offscreen raster boundary; deferred: paper-space entities,
  title blocks, active sheet, rotation/tint, print/export. See ROSTER
  "Draft paper space slice A7".
- A8 command grammar: `LAYER`, `DIM`, `HATCH`, maybe `BLOCK`; update
  `DRAFT_COMMAND_COMPLETIONS`.
- A9 blocks/instances: scope decision; transform-aware snaps moderate.

## Track B — 3D scene/materials/nodes (needs B0 decision first)

Recommendation: **new engine kind** (tag 11, e.g. `packages/scene`) —
draft's model is fundamentally 2D-bounded.

- **B0 decision doc first** (`P17-3d-backend-decision.md`): renderer
  candidates (filament C++ FFI / wgpu Apache-MIT / bounded CPU rasterizer
  for tests); geometry (glam/nalgebra/parry3d all permissive); UV
  (xatlas C or pure-Rust grid packer); textures stored host-side by
  content hash (engine keeps refs — 8 MiB cap); rendering stays
  host-side per P15 precedent.
- B1 scene-graph engine: nodes/meshes/cameras/lights/materials as pure
  state + world-transform `evaluate`; `renderFrame` honestly deferred.
- B2 primitive meshes (box/sphere/cylinder/plane/torus) in-engine;
  glTF/OBJ import is a separate dep decision (host decode preferred).
- B3 camera/gizmo/picking math: TRS, view/proj, orbit/pan/zoom,
  `Standard3DView`, gizmo drag deltas, ray→triangle→UV (`SurfaceBrushHit`).
- B4 PBR material + texture-set state (semantic channels per contract).
- B5 UV state: `setUV`/`markSeams`/`getIslands`/`packUV` (grid packer v1);
  UV preview renderable via existing Prism 2D paths.
- B6 node materials graph: generic typed DAG, cycle detection, bounded
  cook via `apply_long`+progress (maps to LiveNodeThumbnail contract);
  shared shape with G-14 PatchGraph.
- B7 rendering/texture painting/baking: host `scene-render` service;
  engine stores bake outputs as texture refs; GPU target matrix is a
  P18/P19 gate.

## Snapshot versioning rules (both tracks)

Extend `requires_matching_reader()` for new persisted collections/flags;
wrapper schema bump when semantics change; avoid inner `State.schema`
bumps. New engine starts clean at own `kind`/`schema:1`, tag 11.

## Blockers

Font/glyph backend (dimension + paper text), renderer/geometry/UV
admission (B0), glTF dep decision, GPU baking targets, alpha.4 lacks CAD
control exports (pin bump needed before UI wiring), NFC1/NCC1 tag 11
approval, `MotionTransform3D` type ownership.

## ENGINE_OPS.md gaps (draft section)

`updateCircle`/`updateArc` payloads unenumerated; `describe`/`evaluate`
normalization contract undocumented; `querySnap` `sources` semantics
vague; read-vs-mutating classification absent; `setEntityOrder` vs
`setSegmentOrder` interplay; `SOLVE` tolerance range not in grammar line;
no reserved/unimplemented op registry; `renderFrame` binary sidecar
contract; arc 360° endpoint snap rule; wrapper inner `schema:1` pin
clarification.
