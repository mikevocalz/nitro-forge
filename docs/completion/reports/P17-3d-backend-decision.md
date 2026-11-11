# P17 3D backend decision (Track B, B0)

2026-11-13. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against the Track B work list in
`P17-cad-3d-backlog.md` (§"Track B — 3D scene/materials/nodes"), the engine
contracts in `docs/ARCHITECTURE.md`, the Motion G1–G3a 3D precedent
(`packages/motion/rust/src/{transform3d,projection,lights}.rs`,
`docs/ENGINE_OPS.md` motion render section), and the decision-doc precedents
`P15-pdf-backend-decision.md`, `P-font-glyph-backend-decision.md`,
`P-encoder-provider-decision.md`. Docs-only: no builds, tests or device runs
were performed. Renderer license/version claims were read from public
registry and repository metadata at research time; admission still requires
the repo's file-level license-closure review.

## Current state — what exists and what does not

**Motion's "3D" is not a scene renderer.** `transform3d` stores per-layer
`rx`/`ry`/`z` euler+depth scalars and reports a read-only orthographic
`projected_transform` affine (`transform3d.rs`). `renderFrame` consumes it
through `projection.rs`: a deterministic nearest-neighbor CPU affine
resample of a *flat raster* layer — explicitly "Option A CPU affine
rasterization, not projective texturing: no perspective, camera, FOV, depth
sorting or z-based occlusion" (`docs/ENGINE_OPS.md` motion G2 paragraph).
`lights.rs` adds per-composition rigs (≤8 directional/ambient) shading
`transform3d` layers with a constant `RotY·RotX·ẑ` normal and Lambert+ambient
multiply — no normal maps, specular, shadows or per-pixel geometry. Motion's
boundary is honest and stays: it is 2.5D layer compositing inside an
existing raster pipeline, not a CAD scene. Track B is a different scope —
a real 3D scene engine (nodes/meshes/cameras/lights/PBR materials/UV/node
materials/baking) — and nothing here should be read as weakening or
duplicating Motion's contract. `MotionTransform3D` type ownership is
already listed as a Track B blocker in the backlog.

**Draft today** (`packages/draft`, tag 10) is the 2D-bounded engine the
backlog audited: points/segments/circles/arcs, linear + nonlinear
constraints (A5), paper space (A7), blocks (A9), `renderFrame` via Prism
paths. It has no 3D model, and the backlog's recommendation stands:
Track B is a **new engine kind** (tag 11, e.g. `packages/scene`) rather than
a draft extension. This decision doc assumes that recommendation; tag
allocation and NFC1/NCC1 approval remain user sign-off items, not assumed.

**The render gap.** Like every other engine, the scene engine must be
synchronous, single-threaded, `Send`-only and I/O-free
(`docs/ARCHITECTURE.md` §2). No GPU API, C++ renderer or windowing stack
can live inside `apply`. The established pattern — P15 `folio-render`, the
P-font hybrid, the P-encoder provider — is: **the engine owns deterministic
state; rendering lives in a host-side read service fed by serialized
scene/texture bytes.** This doc decides what that service's rasterizer
should be.

## Contract constraints that decide the shape

- **Determinism is the contract.** Snapshot→restore→render must produce
  identical results on every target, and `renderFrame`-class outputs are
  compared in tests across platforms. GPU rasterizers are *not* bit
  deterministic across vendors, drivers or even driver versions — the same
  scene renders differently on Metal vs Vulkan vs WebGPU vs ANGLE. Any GPU
  path can therefore only ever be a **display/preview** tier; it cannot be
  the source of truth for parity-claimed pixels, unless the parity claim
  is redefined (a user decision, flagged below).
- **WASM coverage.** The matrix includes web/WASM (ARCHITECTURE §4:
  "same surface compiled for WASM on web"). Pure-Rust options compile
  everywhere with zero FFI. wgpu reaches WASM via WebGPU/WebGL2 but needs
  a browser GPU context — unavailable or divergent in some hosts.
- **Texture ownership precedent.** The backlog already fixes textures as
  host-side bytes referenced by content hash inside the 8 MiB state cap —
  the photo-catalog pattern. The renderer receives texture bytes as input;
  it never owns them.
- **Test tier.** `nf-cli` JSON-lines and vitest drive real compiled Rust
  with no GPU. Any renderer that cannot produce deterministic pixels in a
  headless CI context cannot serve as the tested path — it can only be an
  untested acceleration layer.

## Candidates

| Candidate | License | Platform matrix | Determinism | Build cost | Maintenance status |
|---|---|---|---|---|---|
| **wgpu** (pure Rust, surface-less render-to-texture; no winit needed — `Instance`/`Device`/`Queue` + offscreen `Texture` render target) | MIT OR Apache-2.0 | Native: Vulkan (Linux/Android), Metal (macOS/iOS), DX12+GLES (Windows), best-effort macOS/iOS GL via ANGLE. WASM: WebGPU or WebGL2 | **Not bit-deterministic** across backends/drivers; within one pinned backend+driver reasonably stable but not contract-grade | Medium: ~30 crates of pure Rust, no C toolchain, compiles to WASM; shader toolchain is WGSL/naga (in-tree) | Very active — gfx-rs/linebender-adjacent, v30.x (Aug 2026), 17M+ recent downloads, MSRV 1.87 |
| **wgpu via winit/windowed surface** | same | same + needs a window/surface provider per host | same | adds winit + per-platform surface code the service doesn't need | same — but rejected shape: the host service renders offscreen to bytes, not to a window |
| **Filament (google/filament) via Rust bindings** | Filament itself Apache-2.0 | Filament upstream: Android/iOS/Linux/macOS/Windows + WASM via WebGPU/WebGL2 — genuinely broad | Same GPU non-determinism as wgpu, plus backend divergence across its 5+ native backends | **Very high**: C++ library, `matc` material compiler toolchain, per-target native builds; Windows dep tree was ~2.8 GiB extracted for the bindings author | Filament upstream: active Google project (20k stars). Bindings: **unusable** — `AThilenius/filament-rs` (MIT) is partial, untested, "no crate provided, use at your own risk", dormant since ~2020; `EYHN/rust-filament`/`filament-bindings` 0.2.2 (Apache-2.0) is unsafe-FFI, prebuilt-binary-only for win/mac/linux (no iOS/Android/WASM), last release 2022 |
| **Bounded pure-Rust CPU rasterizer** (custom software renderer in `rust/scene-render`: triangle setup + z-buffer + per-pixel Lambert/Blinn-Phong + texture sampling; optionally reusing `tiny-skia-path` for triangulation inputs) | MIT/Apache-2.0 family for any admitted helpers (`tiny-skia` BSD-3, `tiny-skia-path`; or zero deps) | **Identical everywhere** — pure Rust compiles for every target incl. WASM with no FFI, no GPU | **Total** — fixed pipeline order, no driver, no SIMD-dependent reordering if written deterministically; the same precedent as Motion's CPU affine resample and the font-metrics decision | Low-medium: one new crate, no external renderer; perf is the real cost (bounded by scene budgets, `apply_long`-style checkpoints) | Self-owned — no upstream to track; `tiny-skia` 0.12 (Feb 2026) and `vello_cpu` 0.3 (Oct 2026, Apache/MIT) prove the ecosystem's CPU-raster maturity if helpers are wanted |
| **tiny-skia / vello_cpu as the 3D rasterizer** | BSD-3 / Apache-2.0-or-MIT | all targets | deterministic | — | **Rejected as renderer**: both are strictly 2D rasterizers (fill/stroke/blend). They can composite *over* a 3D render or draw UV/island previews (P17 B5 already plans "UV preview renderable via existing Prism 2D paths"), but neither rasterizes triangles, depth or shading. Retained as optional compositing/preview helpers only |
| **softbuffer / window framebuffer paths** | MIT/Apache-2.0 | desktop/mobile windowed only | n/a | — | **Rejected**: softbuffer is a window-present blit library, not a renderer — it has no scene, mesh, material or GPU-API surface. Wrong tool entirely |
| **Platform-native 3D (Metal/Vulkan/D3D12/Metal via C FFI)** | OS APIs | per-platform | non-deterministic + N divergent implementations | highest — mirrors the rejected option (b) in the font decision | Rejected for the same reason platform text stacks were rejected: multiplies the test matrix, breaks parity, and WASM still needs a fallback anyway |

## Decision

**Two-tier `scene-render` host service — the P15 `folio-render` pattern,
adapted for the determinism split that 3D uniquely forces:**

1. **`scene-engine` (new engine kind, tag 11 — pending user approval)**:
   pure Rust, I/O-free. Owns the scene graph (nodes/meshes/cameras/lights/
   materials/UV state/node-material DAG), world-transform `evaluate`,
   bounded `Journal` undo, `NFD1` snapshots, and all mutation ops. Its
   `renderFrame`-class reads do **not** rasterize — they emit a canonical
   scene description (geometry refs + material params + camera) that the
   host feeds to `scene-render`, matching how draft `renderFrame` returns
   Prism paths and how folio owns bytes while `folio-render` owns pixels.
   Texture pixels stay host-side by content hash (8 MiB state cap, per
   backlog); UV/island previews reuse Prism 2D paths.

2. **`rust/scene-render` host service** (sibling crate, `nf-cli`-style
   JSON-lines transport for tests, per the `folio-render` §2 precedent):
   - **Tier 1 — deterministic CPU rasterizer (v1, admitted shape)**:
     bounded software renderer inside the service — triangle rasterization
     with z-buffer, per-pixel Lambert/Blinn-Phong shading, nearest/bi-linear
     texture sampling, flat per-face or interpolated normals as scoped.
     Pure Rust, fixed evaluation order, `TaskContext` checkpoints — the
     only tier that can back `nf-cli` tests, WASM, snapshot-parity claims
     and CI golden fixtures. This is new code, not an admitted dependency;
     helper crates (`tiny-skia-path` for polygon ops if wanted) are
     BSD-3/MIT-family and individually admissible.
   - **Tier 2 — wgpu preview path (admitted as a *candidate*, gated)**:
     surface-less offscreen `wgpu` device rendering the same canonical
     scene description for interactive hosts that want GPU speed. Explicitly
     **display-only**: it must never feed a parity-claimed or
     snapshot-derived pixel. Admission of the `wgpu` dependency itself is
     deferred to the GPU-target gate the backlog already assigns to
     P18/P19 — this doc decides the *shape* (offscreen, host-side,
     non-authoritative), not the dep.
   - **Filament: rejected.** No usable Rust binding exists (partial,
     untested, dormant `filament-rs`; stale unsafe `filament-bindings` with
     no iOS/Android/WASM prebuilts and a 2022 last release). Adopting it
     means owning a C++ build + `matc` material pipeline for every target —
     the largest build-matrix cost of any candidate — to reach the same
     GPU-non-determinism wgpu already gives in safe Rust with one dep tree.
     Revisit only if a Filament-specific feature (e.g. its PBR material
     model parity with a chosen import format) is later demonstrated
     necessary; that would be a new decision doc.

3. **Geometry/UV deps** (backlog already scoped, confirmed permissive):
   `glam` or `nalgebra` for math (MIT/Apache-2.0, pick at impl time —
   `nalgebra` is the heavier but more complete choice; `glam` the lighter),
   `parry3d` only if B3 picking/raycast needs its BVH (MIT/Apache-2.0),
   `xatlas` rejected for v1 in favor of the pure-Rust bounded grid packer
   the backlog already specifies (C dep + non-deterministic-ish packing
   buys nothing at v1 island counts).

**Honest v1 scope for Track B** (what this decision supports claiming):

- **In scope**: B1 scene-graph engine state + `evaluate` world transforms;
  B2 primitive meshes (box/sphere/cylinder/plane/torus) generated
  in-engine; B3 camera TRS/view/proj/orbit math + ray→triangle picking
  (`SurfaceBrushHit` inputs); B4 PBR material *state* (semantic channel
  params stored, not shaded beyond the CPU tier's admitted model);
  B5 UV state + grid packer + Prism-based UV preview; B6 bounded node-
  material DAG with cycle detection and `apply_long` cook; B7 `scene-render`
  Tier-1 CPU raster producing deterministic RGBA for `renderFrame`-class
  reads at bounded scene sizes.
- **Deferred**: GPU/PBR-quality shading, shadows, IBL/environment maps,
  post-processing, glTF/OBJ import (host decode, separate dep decision),
  GPU bake targets (P18/P19 gate per backlog), interactive viewport
  performance claims, text/dimension rendering in 3D views (still gated
  on the font backend decision), Motion `transform3d` convergence
  (`MotionTransform3D` ownership stays open).
- **Explicitly not claimed**: photoreal output, parity between Tier-1 and
  Tier-2 pixels, real-time frame rates, CAD-grade precision (f32 engine
  math with stated tolerances, not arbitrary-precision B-rep).

## Open decision points — need user sign-off

1. **New engine kind + tag 11** (`packages/scene`, NFC1/NCC1 registration):
   the backlog recommends it; this doc assumes but does not ratify it.
   Alternative — extending draft — was already argued against ("draft's
   model is fundamentally 2D-bounded").
2. **Parity policy for GPU pixels.** Recommended: Tier-2 wgpu output is
   display-only and never parity-claimed; Tier-1 CPU raster is the sole
   deterministic reference. Alternative: redefine the render contract to
   accept per-platform golden fixtures (weaker, multiplies test matrix —
   same rejection logic as platform text stacks). Needs explicit sign-off
   before any GPU path ships.
3. **`wgpu` dependency admission timing.** This doc admits the *design*;
   the crate dep waits for the P18/P19 GPU-target gate per the backlog.
   Confirm that gating, or pull a minimal wgpu spike earlier for the
   interactive-viewport milestone.
4. **CPU rasterizer shading scope.** Recommended v1: Lambert/Blinn-Phong +
   one shadow mode (or none) + bilinear textures, bounded triangle/texture
   budgets. Confirm whether shadows are in v1 or deferred — they roughly
   double the deterministic-rasterizer effort.
5. **Geometry crate pick** (`glam` vs `nalgebra`) and whether `parry3d`
   is admitted for picking — defer to implementation slice, but flag now
   since it affects dep review.
6. **Crate layout**: `rust/scene-render` sibling (folio-render precedent)
   vs `packages/scene/rust-render` — the glob admits one crate per package
   and the engine owns `packages/scene/rust`, so the sibling layout is
   recommended; confirm.
7. **Texture/scene budgets**: backlog fixes 8 MiB state cap; proposed
   service-side caps needing approval — ≤64 MiB decoded texture set per
   render call, ≤1 M triangles per frame, ≤4096 px output dimension,
   render budget enforced via `TaskContext` checkpoints (mirroring
   folio-render §5 bounds style).
8. **`MotionTransform3D` convergence**: whether Track B's camera/lighting
   model eventually subsumes Motion's G2/G3a orthographic path, or Motion
   keeps its own — affects whether `transform3d` types get shared or
   duplicated. Backlog lists it as a blocker; needs a decision before B3.

## Honest limitations

- Docs-only evaluation: no renderer was built, benchmarked or run on any
  target. wgpu platform claims are from its published support matrix;
  iOS/Android WebGPU-vs-WebGL2 fallback behavior, headless offscreen
  `Device` creation on each native backend, and WASM context acquisition
  are all unverified and must be proven per target before any admission
  claim.
- Filament assessment rests on public repo/binding metadata (binding
  dormancy, unsafe API, prebuilt coverage); Filament itself remains a
  viable C++ engine — the rejection is of the *adoption path*, not the
  renderer's quality. A future bindings revival could reopen this.
- "Deterministic" for the CPU tier means deterministic *for the pinned
  implementation* — it does not promise cross-implementation parity with
  any other rasterizer, and float non-associativity means the eval order
  must be fixed and documented in code.
- Crate versions/licenses (wgpu 30.x, tiny-skia 0.12, vello_cpu 0.3,
  filament-bindings 0.2.2) were read at research time; admission requires
  the repo's file-level license-closure review, same as P10/P15/P-encoder.
- This doc decides renderer *shape*; it does not admit `wgpu`, any
  geometry crate, or the `scene-render` crate itself — each is a separate
  Cargo/workspace change per repo rules.
