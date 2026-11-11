# P11 Motion camera/perspective decision (G2b scope)

2026-11-15. Design-decision record; admits no code and no dependency.
Backed by `P11-motion-backlog.md` (G1–G3 checkpoints),
`P11-motion-g23-decisions.md` (G2 Option A landed; perspective/camera/FOV/
depth/z-occlusion explicitly deferred as "G2b"), `docs/ENGINE_OPS.md` motion
render paragraphs, `packages/motion/rust/src/{projection,transform3d,lights}.rs`,
`docs/ARCHITECTURE.md`, and the Track B precedent
`P17-3d-backend-decision.md` (deterministic CPU rasterizer + wgpu
display-only tier for a future scene engine). Docs-only: no builds, tests or
renders were run.

## Consumers — who actually needs perspective pixels

- **`renderFrame` / `renderQueueFrame` RGBA reads** are the only pixel
  consumers. They are synchronous, in-engine, deterministic CPU output
  compared in tests and (eventually, once an encoder provider exists — the
  shared P08/P09/P14/J2 gap) exported to video. Whatever perspective model
  ships must produce parity-claimed pixels inside this contract.
- **`evaluate`'s `projected_transform`** is a read-only *affine* report. Any
  camera/perspective model changes what a 3D layer's screen mapping is, so
  this field's contract is directly implicated — either it stays the
  orthographic report (documented as such) or a new field/op is added.
- **Nested compositions** render through the same composition renderer, so
  any perspective path automatically applies per-comp; a `Camera` on one
  comp cannot leak into a parent comp's framing.
- **TS/console consumers** see only schema'd state and `evaluate` output —
  no new op is strictly required for them to keep working.
- **Track B (`packages/scene` + `scene-render`)** is the real 3D consumer
  set: nodes/meshes/cameras/lights/PBR, host-side render service. Its
  open decision point 8 already asks whether `MotionTransform3D` converges
  with the scene camera/lighting model — this doc feeds that question.

## Current state (verified)

- G2 landed CPU affine resampling (`projection.rs`): each `transform3d`
  layer's staged canvas-sized straight-alpha RGBA is inverse-mapped
  nearest-neighbor through `projected_affine` (rotation + non-uniform scale
  + shear — exact for the orthographic model), checkpointed per
  `CHECKPOINT_PX` row-band, singularity → transparent. `z` is evaluated but
  render-inert; there is no `Camera` op, no FOV, no depth sort, no z-buffer.
- G3a landed per-comp `lights` (≤8 directional/ambient) shading `transform3d`
  layers with a constant `RotY·RotX·ẑ` normal — Lambert+ambient multiply,
  post-effects/pre-opacity. Point falloff, specular, normal maps, shadows
  deferred.
- Every layer kind stages through the same rasterize-then-upload path:
  shapes, rasters, nested comps, effects, mattes, particles all produce a
  canvas-sized RGBA buffer before compositing. Perspective would slot into
  the same stage.
- No text layers exist (font provider still rejected — backlog blocker);
  `media` layers store host-supplied footage *references* only, pixels
  arrive via the P03 transport contract (slice H, unblocked schema /
  blocked pixels). Neither kind needs perspective-specific handling: both
  are flat buffers by the time they reach the resample stage.
- `P17-3d-backend-decision.md` already decided the shape for true 3D:
  in-engine state + canonical scene description, host-side
  `rust/scene-render` service with a **deterministic Tier-1 CPU rasterizer**
  (z-buffer, Lambert/Blinn-Phong, bounded) and a **display-only wgpu Tier-2**
  that can never feed parity-claimed pixels. GPU rasterizers are
  non-deterministic across vendors/drivers; WASM coverage requires pure
  Rust; `nf-cli` tests run headless with no GPU.

## The geometric fact that bounds the options

Motion layers are **flat quads**: each `transform3d` layer is a plane with
constant normal `RotY(ry)·RotX(rx)·ẑ`. A perspective camera maps each such
plane to screen through a **per-layer 3×3 homography** (8 DOF — the affine
is the `w=1` special case). Two separable problems follow:

1. **Per-layer warp**: replace the affine inverse-map in `resample` with a
   homography inverse-map (per-destination-pixel divide by `w`). Cost is the
   same order as today — one projective map evaluation per pixel, nearest
   tap, `TaskContext` checkpoints — roughly 1.5–2× the affine pass, still
   fully deterministic in fixed f64 order. This alone delivers camera FOV,
   camera position/orbit, and per-layer perspective foreshortening.
2. **Inter-layer occlusion**: homography warps say nothing about which of
   two tilted planes is in front. Correct occlusion needs either (i)
   painter-order sort by a per-layer depth key, or (ii) a shared
   canvas-sized depth buffer with per-pixel plane-depth tests. (i) is cheap
   but wrong for intersecting/self-overlapping configurations; (ii) is
   honest for planar quads — each layer contributes a plane equation, depth
   is evaluated analytically per pixel, one f32 buffer (4 MiB at the 1 MP
   cap) shared across the frame. Both are bounded; (ii) is the only one
   that is actually correct.

`z` currently means "depth toward viewer" with no screen effect. Under any
camera model `z` becomes a plane-offset input to the homography and the
depth test — its semantics must be pinned in the admitting spec.

## Options

### Option A — motion-side bounded projective rasterization ("G2b in-engine")

Extend `projection.rs` with a `Camera` model (position/orientation/FOV or
look-at + fov + near/far — schema TBD by the admitting spec) and replace
the affine resample for camera-enabled compositions with a homography
resample; add a shared canvas depth buffer for z-occlusion between
`transform3d` layers, falling back to painter order for non-3D layers.

- **License/platform**: zero new dependencies — the math is f64 matrix
  ops motion already does by hand (`projected_affine`); a geometry crate
  (`glam`/`nalgebra`, MIT/Apache-2.0 per P17) is optional and admissible at
  impl time but not required. Pure Rust, compiles for every target incl.
  WASM, no FFI — identical platform story to the landed affine pass.
- **Determinism**: preserved if written to the existing standard — fixed
  evaluation order, no SIMD-dependent reordering, checkpointed per row-band
  (`CHECKPOINT_PX` precedent), float non-associativity documented. Nearest-
  neighbor keeps parity with particle sprites and the affine path; a
  bilinear/projective-correct filter is a later flag, not v1.
- **Pros**: keeps `renderFrame`'s synchronous in-engine pixel contract;
  reuses the established rasterize-then-upload stage so opacity/blend/
  clip/matte/effects/nested comps compose unchanged; bounded by the
  existing 1 MP canvas cap, 128-layer cap and canvas-raster storage budget;
  the only option that can ever produce parity-claimed perspective pixels
  inside Motion today.
- **Cons**: real new code — camera schema, homography derivation, per-pixel
  divide, depth buffer, `z` semantics, `evaluate` contract decision; cost
  roughly doubles the 3D resample and adds a 4 MiB depth buffer per
  composition render; scope discipline required so it doesn't metastasize
  into a scene engine inside Motion (mesh deformation, per-pixel geometry,
  shadows stay out).
- **Sub-decision inside A**: homography-only (per-layer warp, keep painter
  order — smaller, but silently wrong occlusion between tilted planes) vs
  homography + shared depth buffer (correct for planar quads, ~1 extra
  pass). Recommend the depth buffer if A is ever admitted; homography-only
  is acceptable only as an explicitly documented intermediate with
  occlusion listed as a limitation.

### Option B — defer perspective to the Track B scene-render service

Motion's perspective needs route through `packages/scene` +
`rust/scene-render` (P17 decision): either Motion emits a scene description
and the host renders it, or perspective-demanding content moves to the
scene engine entirely.

- **License/platform/determinism**: inherits P17's analysis verbatim —
  Tier-1 CPU rasterizer is the only parity-claimable path; wgpu Tier-2 is
  display-only; Filament rejected. No new information here.
- **Pros**: true 3D (meshes, per-pixel depth, shadows later) lives in one
  engine instead of being half-built twice; `MotionTransform3D` convergence
  (P17 open point 8) resolves naturally; Motion stays honest 2.5D.
- **Cons — and they are structural, not preferential**: `renderFrame` is a
  synchronous in-engine read returning RGBA; the scene-render service is
  host-side and fed by serialized scene bytes. Adopting B means changing
  Motion's render contract (emit scene description, host renders, pixels
  return via a transport) — a cross-engine architecture change needing the
  same user sign-off as the P17 engine-kind decision, plus it makes Motion
  renders depend on a service that does not exist yet and is gated behind
  P18/P19 for GPU and tag-11 approval for the engine. B also cannot serve
  Motion's *current* consumers: `renderQueueFrame` stepping and nested-comp
  composition happen inside the engine; routing them through a host
  service breaks seek-determinism tests unless the whole read path moves
  host-side — a much bigger contract change than "add a camera op."
- **Verdict**: B is the correct *eventual* home for general 3D, but it is
  not an available near-term answer for Motion's camera question. Choosing
  B now means choosing "Motion never gets perspective" until Track B
  ships — which is a legitimate decision, but it should be made as such,
  not as a deferred implementation detail.

### Option C — keep Motion 2.5D permanently

No camera op, ever. `transform3d` stays orthographic; `z` stays render-
inert; the G2/G3a honest limitations become the permanent contract.

- **Pros**: zero further cost; the current contract is already honest,
  tested and deterministic; every deferred item (perspective, depth,
  shadows, specular, point falloff) stays off the books; consumers that
  need real 3D use Track B when it exists.
- **Cons**: forecloses a real product capability — After Effects-style
  camera moves (dolly/orbit/FOV) are a mainstream motion-design feature,
  and the flat-quad homography case covers a large fraction of what users
  actually ask for (tilted planes in perspective, not meshes). If Motion's
  product scope includes camera work, C is a scope decision masquerading
  as a technical one.

## Decision

**Recommend a sequenced C → A → B path, with C as the standing contract
and A admitted only on demonstrated product need:**

1. **Now (this decision's operative effect): keep 2.5D.** No camera op, no
   perspective, `z` stays render-inert, G2/G3a limitations stand. Update
   `docs/ENGINE_OPS.md`/`P11-motion-backlog.md` only to point at this doc —
   no code, no schema change. This matches the backlog's existing "GPU/
   true-perspective 3D raster decision" blocker: it is now decided as
   *deferred-with-a-named-path*, not open-ended.
2. **If/when camera perspective is product-required for Motion, admit
   Option A as a single bounded slice ("G2b")**: `Camera` schema +
   homography resample + shared depth buffer, nearest-neighbor, CPU-only,
   same budgets and determinism standard as the affine pass. Its spec must
   pin: camera parameterization, `z` semantics, depth-buffer scope (3D
   layers only vs all layers), `evaluate`/`projected_transform` contract
   (recommend keeping the orthographic report unchanged and adding a
   separate projected-camera read rather than mutating the field), and the
   homography-only-vs-depth-buffer sub-choice (recommend depth buffer).
3. **Track B remains the home for everything beyond flat quads** — meshes,
   per-pixel geometry, shadows, specular/normal maps, GPU preview. If A
   lands, its matrix/depth math should be written to be liftable into
   `scene-render` Tier-1 later (shared helpers, not shared crates — the
   engine cannot call a host service), and P17 open point 8
   (`MotionTransform3D` convergence) should be revisited at that time.

**Explicit non-recommendation**: do not build homography-without-depth as
the endpoint (silently wrong occlusion is worse than honest 2.5D), and do
not pursue GPU/wgpu inside Motion — the P17 analysis applies unchanged:
non-deterministic across drivers, useless for parity-claimed pixels,
redundant with the future scene-render Tier-2 which is display-only anyway.

## Open decision points — need user sign-off

1. **Ratify C-now**: confirm Motion's contract stays 2.5D until product
   demand justifies G2b. If camera work is already committed roadmap, skip
   to point 2 and spec G2b directly.
2. **`evaluate` contract under perspective**: keep `projected_transform`
   as the orthographic report + add a camera-space read, vs redefine the
   field. Recommend additive (schema stays 2, serde-defaulted new field).
3. **Depth-buffer scope**: z-test only among `transform3d` layers
   (recommended — bounded, honest for the feature's actual use) vs all
   layers incl. raster/comp (correct generality, more cost, more edge
   cases with mattes/blends that already composite in Prism).
4. **Camera parameterization**: free position+orientation+FOV vs a
   constrained orbit/look-at model. Recommend the constrained model for
   v1 (fewer singularities, easier validation bounds, matches the
   flat-quad use case); free camera invites gimbal-lock and near-plane
   edge cases the spec must then bound.
5. **`z` semantics**: repurpose existing `Transform3D.z` as camera-space
   depth (recommended — it already means "depth toward viewer") vs add a
   separate field. Must be pinned before any G2b code; hostile-restore
   bounds already exist (±1e7).
6. **Convergence with Track B**: whether G2b's camera/light types are
   designed to be *identical* to the scene engine's (shared schema
   vocabulary, easing later `MotionTransform3D` convergence) or Motion-
   local (faster, risk of divergent dialects). Recommend shared
   vocabulary where cheap.
7. **Budget additions**: +1 canvas-sized f32 depth buffer per composition
   render (4 MiB at 1 MP) and ~2× resample cost per camera-enabled 3D
   layer — confirm these join the existing canvas-raster accounting rather
   than a new budget class.

## Honest limitations

- Docs-only evaluation: no homography resampler, depth buffer or camera
  math was implemented or benchmarked. The ~1.5–2× cost estimate over the
  affine pass is an order-of-magnitude judgment, not a measurement; the
  4 MiB depth-buffer figure assumes one f32 per pixel at the 1 MP cap.
- Planar-quad occlusion via a single depth buffer is correct only because
  Motion layers are flat planes; it does not extend to self-intersecting
  geometry, which does not exist in Motion's model — stated so nobody
  reads G2b as partial mesh support.
- The Option B analysis inherits P17's unverified items: `scene-render`
  does not exist, tag-11/NFC1 approval is pending, and the wgpu Tier-2
  platform claims are published-matrix, not tested.
- This doc decides *whether and where* perspective may live; it admits no
  `Camera` op, no schema field, no dependency. Any G2b implementation is
  a separate spec that must update `docs/ENGINE_OPS.md` before code, per
  AGENTS.md.
