# P17 scene-render tier-1 implementation (Track B, B0 tier 1)

2026-11-13. Implementation record for the first buildable slice of the
B0 decision (`P17-3d-backend-decision.md`): the `rust/scene-render`
host service with its deterministic CPU rasterizer. This is **not**
the scene engine — the engine kind (tag 11, `packages/scene`) remains
an open sign-off item in the decision doc, as do the parity policy,
wgpu admission timing, shading-scope confirmation, geometry crate pick
and crate-layout confirmation. This slice implements only what the
doc already fixed: the folio-render-pattern sibling service and the
Tier-1 software renderer. Docs+code only claim what was run; see
"Verification" below.

## What was built

`rust/scene-render` — new workspace sibling crate (the layout the B0
doc recommends in open point 6), modeled on `rust/folio-render`:

- **Not an Engine.** No `EngineKind`, no `Command`/`Journal`, no `NFD1`
  snapshot, no sessions, no mutations. Stateless per call: each
  `render` frame carries the complete canonical scene description.
- **Wire protocol** identical to `nf-cli`/`folio-render`
  (`{"id","handle","op","payload"}` → `{"id","ok","data"|"error"}`),
  ops `render` and `describe`, `run_stdio` with the same
  frame-cap-before-parse and panic-to-internal-error behavior.
- **Scene description** (the canonical form the future engine emits):
  `width`/`height`/`format`, `camera` (perspective look-at with
  `fov_y_degrees`/`near`/`far`, or orthographic with `half_height`),
  `background`, `lights` (ambient/directional/point, ≤16), `materials`
  (PBR state: `color`/`metallic`/`roughness`/`specular`/`emission`/
  `texture`/`texture_filter`/`double_sided`), `textures` (named RGBA8
  by content — the host-side texture pattern the backlog fixes),
  `meshes` (world-space `positions_b64` f32le, optional
  `normals_b64`/`uvs_b64`/`indices_b64`, `material` index). Vertex
  attributes are little-endian binary base64, not JSON arrays.
- **Rasterizer** (the actual tier-1 deliverable): view-space
  Sutherland–Hodgman clipping against near/far, perspective-correct
  barycentric attribute interpolation (1/w weighting), screen-space
  edge-function coverage, z-buffer on ndc z, backface culling with
  `double_sided` escape, per-pixel Lambert diffuse + Blinn-Phong
  specular + ambient + emission, nearest/bilinear texture sampling
  with edge clamp, sRGB↔linear conversion at the color boundaries.
  Fixed evaluation order, f32 only, no threading — the determinism
  contract the B0 doc requires.
- **Deps**: `ignition-core`, `serde`, `serde_json`, `png` 0.18 —
  `png` was already in the workspace lock via prism-engine
  (MIT/Apache-2.0). No geometry crate (`glam`/`nalgebra` decision left
  open per B0 point 5 — ~120 lines of vec/mat code covers v1 needs).
  No `wgpu`, no C/C++.

## Bounds (fail-closed)

B0 open point 7's proposed caps, implemented pending sign-off:
≤4096 px/side and ≤32 MiB decoded RGBA output; ≤1,000,000 triangles;
≤3,000,000 vertices per scene (500,000 per mesh); ≤4096 meshes;
≤1024 materials; ≤16 lights; ≤256 textures totaling ≤64 MiB decoded
RGBA8 (≤4096² each); frame ≤256 MiB raw rejected before JSON parse.
All vertex/texture/camera data must be finite; textured materials on
UV-less meshes reject rather than silently sampling (0,0).

## Shading honesty

The admitted model is Lambert/Blinn-Phong, not PBR: `metallic` scales
diffuse by `(1−metallic)` and lerps specular tint toward albedo;
`roughness` maps to `shininess = 1 + 255(1−r)²` and scales specular
strength by `(1−r)`. Point lights use fixed `intensity/(1+d²)`
attenuation with optional hard `range`. No shadows, IBL, transparency,
texture alpha, wrap modes or post-processing — all deferred per B0.

## Deferred (explicitly not claimed)

Scene-graph engine state/transforms/evaluate (B1), primitive mesh
generation (B2), camera node math/picking (B3), node-material DAG
(B6), UV state/packer (B5), baking (B7 remainder), glTF/OBJ import,
wgpu tier-2 preview, any GPU path, WASM run (pure Rust so it *can*
compile, but no WASM target was built or tested), TS adapter (no
`packages/scene` exists yet — tag 11 approval pending), Engine ops
(none — this is a host service, so ENGINE_OPS.md documents it under
the folio-render-style "NOT an Engine" section).

## Verification (actually run)

- `cargo build -p scene-render` — clean, no warnings.
- `cargo test -p scene-render` — **11 integration tests pass**,
  all against the real compiled binary/library: real pixel renders
  (single triangle, z-buffer ordering, backface culling +
  double-sided, orthographic camera, textured quad, Lambert
  directional-light facing), byte-identical determinism across
  service instances, PNG magic, hostile bounds (zero/oversized dims,
  >32 MiB output, missing/degenerate camera, NaN vertices, out-of-
  range indices/materials, bad base64, texture size mismatch, unknown
  light/op, >1M-triangle scene), and a stdio wire-protocol roundtrip
  through `CARGO_BIN_EXE_scene-render`.
- Workspace build and draft-package vitest results recorded in
  STATUS/ROSTER at commit time.

## Open items handed back

B0 sign-offs still required: tag 11 engine kind + NFC1/NCC1, GPU
parity policy, wgpu admission timing, shadow-in-v1 question (this
slice ships **no** shadows — the cheaper option), geometry crate pick,
crate layout confirmation (sibling chosen per recommendation),
service budget caps, `MotionTransform3D` convergence.
