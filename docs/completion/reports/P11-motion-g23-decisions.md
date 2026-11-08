# P11 Motion G2/G3 design decisions — 3D projection rendering and lighting

2026-11-08. Design-decision record; admits no code and no dependency.
Backed by `P11-motion-backlog.md` items G1–G3, the merged G1 slice
(`transform3d` storage/eval — `renderFrame` ignores it), and the current
Prism/Motion render path. G1 is merged and honest: nonzero `rx`/`ry`/`z`
produce byte-identical pixels today.

## Current state (verified)

- `Layer.transform3d = {rx, ry, z}`: euler X/Y degrees + view depth,
  curve-animatable, snapshotted, `evaluate` reports a read-only
  `projected_transform` `{a..f}` orthographic affine. `renderFrame` does
  not consume it.
- `renderFrame` materializes an **ephemeral PrismEngine per frame**;
  nested comps render recursively; mattes/effects/particles already use a
  **rasterize-then-upload** pattern: render content to straight-alpha RGBA
  on CPU (or via a child Prism scene), CPU-process, upload through
  `addRasterLayer`+`drawPixels` with identity transform.
- Prism `Transform` is pivoted translate + rotate + **uniform-axis scale**
  (`model.rs`): no shear, no skew, no general affine, no projective warp,
  no mesh/quad deformation anywhere in `packages/prism/rust`. Verified by
  inspection — there is no warp/quad/perspective primitive to reuse.
- No camera model exists (deliberately deferred from G1); no lights;
  shadows deferred.

## Key geometric fact that shapes the decision

Under the G1 model (orthographic, view axis = layer-local Z, `z` only a
depth scalar, no perspective/FOV), the projection of a rotated plane is
**always affine**: `screen = anchor + M·(p − anchor)` with `M` a general
2×2 (rotation + non-uniform scale + shear). G1 already computes `M` as
`projected_transform`. Shear appears whenever the euler chain produces
off-diagonal terms both ways — i.e. generally when `rx` and `ry` are both
nonzero, or combined with `rotation`. Prism's TRS transform cannot express
shear, so G2 cannot be "pass `projected_transform` to Prism" except in
the shear-free subset.

## Options for G2

### Option A — motion-side CPU affine rasterization (recommended)

For each 3D-enabled layer: render the layer's content subtree (shape/
raster/comp, post-evaluated-transform, pre-opacity/blend/matte — the same
stage effects already rasterize at) into a canvas-sized straight-alpha RGBA
buffer via the existing ephemeral-Prism path, then resample that buffer
through the projected affine `M` on the CPU (affine texture mapping,
bilinear or nearest — pick nearest for determinism/speed parity with
particle sprite resampling, bilinear optional behind a flag) into the
parent scene's coordinate space, and upload the result through the
existing `addRasterLayer`+`drawPixels` path.

- **Pros**: zero Prism changes; exact for the entire G1 orthographic model
  (affine resampling is the correct math, not an approximation); reuses
  the established rasterize-then-upload precedent (effects C, particles F,
  mattes B2); deterministic and platform-stable like every other CPU pass;
  bounded — cost is one extra buffer + ≤1 MP resample per 3D layer per
  frame; composes unchanged with opacity/blend/clipping/matte because the
  upload lands at the same pipeline stage effects use.
- **Cons**: CPU resampling cost per 3D layer per frame (bounded by the
  1 MP canvas cap and the 128-layer cap, but real); resampling artifacts
  (aliasing on minification — document honestly, no mipmaps); duplicates
  a small amount of raster plumbing motion already owns; does not by
  itself deliver perspective (see below).
- **`z`/depth**: with no camera and orthographic projection, `z` has no
  screen effect. G2-ortho may use `z` only for stable painter-order tie
  breaks if desired, or leave it inert — recommend inert + documented,
  reserving depth semantics for the perspective slice.

### Option B — extend Prism with shear-capable affine or projective transform

Add a general-affine (or mesh/quad) transform op to Prism and pass
`projected_transform` through.

- **Pros**: keeps all rasterization inside Prism; benefits every engine;
  no motion-side resampler.
- **Cons**: cross-engine contract change (ENGINE_OPS, all-engine sync per
  AGENTS.md); Prism's compositor is layer/TRS-based — a shear path touches
  its transform validation, render, and likely its own tests; still does
  not deliver perspective or per-pixel depth; large blast radius for one
  Motion slice. Rejected for G2; revisit only if a second engine needs
  shear/projective transforms.

### Option C — admit only the shear-free subset

Render 3D only when `projected_transform` decomposes into Prism TRS
(rotation + axis scales, no shear) — practically, cases where at most one
of `rx`/`ry` is nonzero (each alone projects to axis scale + the 2D
rotation chain).

- **Pros**: smallest change; could ship inside Prism's existing transform.
- **Cons**: cripples the feature — combined `rx`+`ry` (the common case for
  real 3D orientation) silently can't render or must reject; a partial
  honest subset that misleads more than it helps. Rejected as the G2
  endpoint; acceptable only as an internal milestone of Option A if the
  resampler lands incrementally.

### Perspective / camera — deferred past G2

True perspective needs a `Camera` (fov, position, orientation) and
per-pixel projective mapping — a hom or per-triangle rasterization, not a
single affine. CPU projective rasterization is feasible (bounded: same
1 MP cap, triangle-subdivision or scanline homography, deterministic)
but roughly an order of magnitude costlier than affine resampling and
needs depth buffering for correct occlusion between 3D layers. **Recommend**
a separate later slice ("G2b") once Option A lands: ortho 3D rendering
first, perspective+camera+depth-sort second. This doc does not spec G2b;
it only fixes that G2 does not pretend to deliver it.

## G3 — lighting decision

Backlog: "CPU lambert/ambient on layer buffers (needs slice C path);
shadows explicitly deferred." Slice C (the rasterize-then-upload effect
path) has since merged, so the prerequisite exists.

Facts constraining the design: layers are flat RGBA — there are no normal
maps and no per-pixel geometry. For a flat layer under ortho projection,
the surface normal is **constant** across the layer: `N = RotY(ry)·
RotX(rx)·ẑ` (the layer-local +Z axis in view space), computable from the
evaluated `transform3d` alone.

Options:

- **G3a — per-layer uniform diffuse+ambient (recommended)**: `Light[]`
  on the composition (directional and/or point/ambient types, bounded
  count ≤8, each `{type, direction_or_position, color:[r,g,b],
  intensity}`-ish, exact schema at impl); shade factor per layer =
  `ambient + Σ intensity·max(0, N·L)` applied as a multiply over the
  layer's rasterized RGBA at the same post-transform/pre-opacity stage
  effects use. Exact for flat ortho layers — the normal really is
  constant — cheap (one factor per layer, or per-pixel multiply of a
  single scalar), deterministic.
- **G3b — per-pixel lighting with normal maps**: deferred — there is no
  normal-map authoring model, no image-asset normal convention, and no
  surface detail to light. Reopening requires an admitted normal source.
- **Specular**: deferred — needs a view/vector model that only becomes
  meaningful with camera/G2b; a Blinn-Phong hack on ortho directional
  light adds parameters without visual correctness.
- **Shadows**: deferred per backlog — needs either a shadow-map pass or
  analytic plane occlusion; both are large and interact with the
  deferred perspective work.

G3a depends on G2 only for the normal to matter (with G1's inert `rx`/`ry`
a layer's normal is always ẑ, so lighting without G2 would be a no-op for
tilted layers — honest sequencing: G2 then G3a). Lighting applies to the
layer's rendered buffer including its own 3D resample when present;
unlit (`transform3d`-free) layers are unaffected — `Light[]` on a
composition with no 3D layers changes nothing, which `validate` may warn
about but must not reject.

## Recommended path

1. **G2 = Option A**: motion-side bounded affine rasterization of
   3D-enabled layers through `projected_transform`, rasterize-then-upload,
   `z` inert, no camera/perspective/depth-sort. Acceptance: nonzero
   `rx`/`ry` produce visibly projected pixels (not byte-identical), shear
   cases render correctly, all existing compose stages (opacity, blend,
   clip, matte, effects, nested comp, parent transforms) still apply,
   determinism/seek-safety preserved, budgets documented (extra buffer +
   resample per 3D layer).
2. **G3 = G3a**: composition `Light[]` (≤8), per-layer lambert+ambient
   factor from the evaluated normal, same raster stage; specular,
   normal maps, shadows deferred.
3. **G2b (perspective/camera/depth)**: separate future slice; this doc
   fixes only that it is not part of G2/G3 and needs its own spec.

## Open questions for the implementation slices

- Resampler filter: nearest (parity with particle sprites, cheapest,
  aliasing documented) vs bilinear (smoother, ~4× tap cost, still
  deterministic). Recommend nearest for v1, bilinear behind a later flag.
- Does the 3D resample happen before or after the layer's own `effects`
  stack? Recommend **before** effects (3D placement is geometry; effects
  are post-transform pixel ops — same ordering logic as the existing
  "transform then effects" rule), but the G2 spec must pin this down.
- `projected_transform` shear + Prism TRS: Option A sidesteps it, but
  `evaluate`'s reported affine remains the contract — G2 must not change
  `evaluate` output shape.
- Light types for G3a: directional-only v1 vs directional+ambient+
  point. Recommend directional + global ambient v1; point lights add
  falloff parameters with little ortho payoff.
- Budget: does a 3D layer count against the canvas-raster-layer cap like
  effected/particle layers do? Recommend yes — same storage class.

## Acceptance criteria (for the future G2/G3 implementation specs)

- G2 spec must state: resample stage in the pipeline, filter choice,
  `z` semantics (inert vs tie-break), budget accounting, and honest
  aliasing/depth limitations; ENGINE_OPS updated before code.
- G2 tests must prove: rx-only, ry-only, combined rx+ry (shear) and
  rotation-combined cases each produce the hand-verified projected
  pixels; transform3d-free layers stay byte-identical; undo/redo,
  snapshot round-trip, hostile restore, nested-comp and matte/effect
  composition all covered; seek determinism.
- G3 spec must state: light schema/bounds, normal derivation, shade
  math, which layer kinds are lit (recommend all rendered kinds incl.
  comp instances), and deferred list (specular, normal maps, shadows,
  per-light shadows); ENGINE_OPS updated before code.
- Neither slice may claim perspective, camera, depth sorting, shadows,
  or GPU work; ROSTER entries must say so.
