# P-prism-brush-ink-decision

2026-11-12. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against the engine contracts in
`docs/ARCHITECTURE.md`, the deferred brush ops in `docs/ENGINE_OPS.md`
("Brush engine ops (B-15, B-16, B-29, B-33) are not here: they wait on the
google/ink source admission (#46)"), the P06 exit criterion in
`docs/completion/P02-P11-IMPLEMENTATION-MAP.md:57-63`, and the source-admission
register in `docs/ADVANCED_NATIVE_PORT_ROSTER.md` (google/ink row: "Brush/ink
prediction, palm rejection … Muse stylus and PencilKit coexistence, real device
tests; not implemented").

## Current state — where the brush gate actually sits

- **Prism** (`packages/prism/rust/src/`): raster layers hold `Arc<Vec<u8>>`
  RGBA pixels; vector paths carry `Stroke { paint, width, join, cap, dash }`
  with analytic anti-aliased coverage (`render.rs`, `vector.rs`); `drawPixels`
  blends `w*h*4` RGBA src-over, clipped to canvas, with `{layer_id, rect,
  prev_b64}` undo (`docs/ENGINE_OPS.md` prism table). There is **no stroke
  input model, no dab/splat generator, no pressure/tilt channel, no
  stabilization or prediction, no brush preset store**. A brush stroke today
  can only be faked as a sequence of `drawPixels`/`fillLayer` calls from the
  host — exactly the "UI preview is not prediction or palm-rejection
  acceptance" gap the implementation map names.
- **Blocked rows**: B-15 `BrushPresetBrowser`, B-16 `BrushDynamicsInspector`,
  B-29 `BrushTaperControl` all list `existingBackendDependency: "brush
  engine (absent)"`; B-33 `BrushStabilizationPreview` lists `"ink stabilizer
  (google/ink candidate, forge #46)"` (`docs/completion/components.json`,
  PLAN.md rows 187/188/201/205). N-04 `PalmRejectionAndPrediction` is
  `forge-native`, N-01/N-03 pointer routing/Muse are host-side, and the P06
  exit criterion additionally requires erase modes and real timelapse
  encoding — none of which google/ink provides.
- **What the ops actually need** (derived from the component names and the
  P06 exit text): a *stroke sample model* `{t, x, y, pressure, tilt,
  orientation, contact}` → *modeled/smoothed+predicted samples* → *brush
  parameter resolution* (preset: size, opacity, flow, spacing, hardness;
  dynamics curves mapping velocity/pressure/tilt/random to those params;
  taper in/out) → *dab placement* along the modeled path → raster output the
  existing Prism `drawPixels`/path coverage can consume. B-33 specifically
  needs the sample-modeler half: given raw input samples, emit stabilized
  positions (and optionally predicted lookahead positions) without mutating
  document state until a stroke commits.

## Contract constraints that decide the shape

- Engines are synchronous, single-threaded, `Send`-only and **never block on
  I/O** (`docs/ARCHITECTURE.md:32-48`); bytes cross only via `restore`/
  `snapshot`/`nf_v1_apply_binary` (256 MiB cap). A brush engine must therefore
  be pure computation over op payloads — no font-file-style host asset is
  needed, but no external process or service call is possible either.
- Determinism is contractual: the same input samples must produce the same
  dabs on every target so stroke commits, undo and snapshot→restore→render
  agree. Platform stylus stacks (Android `MotionEvent` prediction,
  PencilKit, Windows Ink) are host-side input *sources*, not engine truth —
  the same split as the font decision's host-vs-engine boundary.
- `apply` is atomic and mutating ops journal before mutation
  (`docs/ARCHITECTURE.md`, AGENTS rules). A stroke is naturally one op (or a
  bounded batch); live "in-progress stroke" preview is a host concern unless
  an explicit preview op is added — read-only, eventless.
- No `unsafe` inside product engines; FFI lives only in `rust/nf-sys`. Any
  C++ dependency can therefore never live *inside* a Prism engine crate —
  at most behind a host-native module feeding bytes/ops across the boundary.

## Candidates

### (a) Port google/ink algorithms to Rust

**License**: Apache-2.0 (repo LICENSE; also shipped inside Chromium
`third_party/ink`, security-critical, autorolled). Porting is permitted with
copyright + license-text retention and an Apache-2.0 §4 modification notice —
same notice discipline the roster already requires
(`docs/recovery/roster-status.tsv` license column). **License is not the
blocker.**

**What ink actually is** (verified 2026-11): C++/Objective-C/WGSL, **Bazel
only** (MODULE.bazel, `bazel_build.sh`, `ndk_build.sh`, no CMake), module
version 1.1.0, ~693 commits, actively maintained — it is the core of the
Jetpack Ink API (alpha, Oct 2024) and Android's low-latency inking stack. The
README states plainly: *"the developers of this library are not currently
making hard guarantees about interface stability."* Module graph: `color`,
`types`, `geometry`, `brush` (stroke styles/behaviors), `strokes`
(`Stroke`/`InProgressStroke`), `rendering` (**only `android.graphics.Mesh`
based rendering** — Android JNI, not portable), `storage` (protobuf). Deps:
Abseil, protobuf, plus Tint/Dawn shader-generation machinery
(`patches/dawn`, `skia_user_config`).

**Fit**: ink produces *stroke meshes* — smoothed, modeled stroke shapes as
mesh-based vector graphics. That is stroke→vector-geometry, one level
*above* what B-15/B-16/B-29/B-33 need (they need sample modeling + dab
generation; ink's `brush` module assumes its own mesh rendering). Porting
the whole library means porting Abseil-shaped C++ geometry/protobuf/storage
machinery that Forge engines cannot use, to arrive at an API surface that
still emits meshes Prism would have to re-rasterize anyway. A *selective*
port of `brush`/`strokes` math is feasible but the unstable-interface
disclaimer means the port pins a moving target; every upstream rev requires
re-review.

**Verdict**: rejected as a wholesale port; retained as the authoritative
*reference* for any reimplementation (option c) and for parity testing.

### (b) FFI to prebuilt / build-from-source C++

**License**: Apache-2.0, same notice obligations; Chromium's
`third_party/ink` BUILD.gn adaptation proves it *can* build outside Bazel,
but that file is Chromium-maintained, not upstream-supported.

**Cost**: Bazel-or-hand-rolled build per target (iOS, Android, macOS,
Windows, Linux, and **WASM — which C++ ink cannot serve at all**), Abseil +
protobuf + Tint/Dawn transitive closure, JNI mesh rendering that is
Android-only, and a `Send`-only synchronous FFI boundary in `nf-sys` for a
library whose hot path is per-pointer-event (10s–100s of calls per stroke).
Interface instability + "security critical" Chromium classification means
upstream revs churn under us. There is no prebuilt distribution to link.

**Verdict**: rejected. The only viable FFI shape would be a *host-side*
native ink module producing dab/mesh bytes consumed by Prism ops — but ink
emits Android meshes, not raster dabs, so even that requires writing the
brush→dab layer ourselves. Paying the C++ tax buys nothing the Rust
reimplementation doesn't.

### (c) Reimplement the needed slice from spec/reference in Rust

The needed slice is small and well-documented:

- **Sample modeling / stabilization** (B-33, feeds N-04): the sibling repo
  **`google/ink-stroke-modeler`** (Apache-2.0, C++ but CMake-buildable,
  "minimal dependencies … only the C++ Standard Library and Abseil") is the
  exact algorithm ink migrated *away* from to a "newer input-smoothing
  implementation" — its `StrokeModeler` is a documented pipeline (wobble
  smoothing → position modeling as damped spring → stylus-state
  interpolation → prediction) with explicit `StrokeModelParams`. Its
  parameters and stage structure are published in `params.h`/`types.h` and
  suffice to reimplement deterministically in ~hundreds of lines of Rust.
  An unofficial `ink-stroke-modeler-ts` TypeScript port exists as prior art
  but is **not Google-maintained — do not admit it**; use it only to
  cross-check behavior if its license is later verified.
- **Brush dynamics/taper/presets** (B-15, B-16, B-29): standard brush-param
  algebra — spacing, size/opacity/flow curves vs velocity/pressure/tilt,
  taper envelopes, dab stamp generation — is spec-level work with no
  upstream dependency required. Ink's `brush` module can be read for
  behavioral reference (e.g. how it maps stylus state to brush params)
  without copying code paths tied to its mesh renderer.
- **Output**: dabs rasterize through the existing deterministic Prism
  coverage path (`drawPixels`/path strokes), or as generated subpaths —
  both already in `docs/ENGINE_OPS.md`.

**License**: Apache-2.0 reference reading needs no attribution for ideas;
any *ported constants/structure* carries the roster's standard
notice obligations. A clean-room-from-spec implementation of the modeler
stages needs no ink code at all.

**Platform matrix**: pure Rust — iOS/Android/macOS/Windows/Linux/WASM all
identical, same as every other engine crate.

**Verdict**: **admitted shape** — implement the brush/stroke-model slice in
Rust inside the Prism engine (or a shared `ignition`-level stroke crate if
N-04's forge-native consumer wants it without opening Prism docs), using
google/ink + ink-stroke-modeler as pinned-commit behavioral references.

### (d) Defer

Deferral cost: P06's exit criterion (brush/dynamics/taper/stabilization,
erase modes, prediction/Muse, timelapse) stays blocked; B-15/B-16/B-29/B-33
and F-09 `LocalMaskBrush` remain ABSENT; the eight NYC-Tron ink controls
stay host-preview-only. The P06 batch cannot close without *some* brush
engine. Deferral is only correct for the parts that genuinely need device
validation (N-01/N-03/N-04 hardware paths) — not for the deterministic
sample→dab core.

## Decision

**Adopt (c): reimplement the stroke-model + brush-dab slice in pure Rust,
with google/ink and google/ink-stroke-modeler (both Apache-2.0) admitted as
pinned-commit behavioral references — not as linked or ported dependencies.**
Reject (a) wholesale port and (b) FFI: ink's rendering is Android-mesh-only,
its build is Bazel+Abseil+protobuf+Tint/Dawn, its interface is explicitly
unstable, and C++ cannot serve the engine's WASM/test matrix or live inside
`Send`-only engine crates. Defer only the hardware-bound P06 rows.

Recommended build order (each independently shippable, all inside existing
op contracts):

1. **Stroke sample model + stabilization ops** (unblocks B-33): new
   read-only ops — e.g. `modelStroke {samples:[{t,x,y,pressure?,tilt?,
   orientation?}] , params?}` → `{modeled:[…], predicted?:[…]}` — pure
   function, eventless, bounded input (propose ≤4 096 samples/op). This is
   the ink-stroke-modeler slice; N-04 consumes the same modeler
   forge-native for palm/prediction policy.
2. **Brush preset + dynamics model** (unblocks B-15, B-16): document-level
   `brushes` table `{id, name, params}` + ops `addBrush`/`setBrush`/
   `removeBrush`/`listBrushes`, journaled like other document state.
   Dynamics curves are resolved host-side *or* engine-side per decision
   point 3 below.
3. **Stroke commit op** (unblocks B-29 taper and real drawing):
   `paintStroke {layer_id, brush_id, samples, commit?}` → dabs resolved
   through the brush model and composited via the existing raster path;
   one undo entry per stroke. Taper is brush params, not a separate op.
4. **Erase modes + timelapse** remain later P06 slices; ink contributes
   nothing here.

## Open decision points — need user sign-off

1. **Reference pinning**: which google/ink commit (and whether to also pin
   ink-stroke-modeler) is admitted as the behavioral reference. Recommend
   pinning both HEAD-of-main SHAs at implementation time and recording them
   in `docs/ADVANCED_NATIVE_PORT_ROSTER.md`; ink's unstable-interface
   disclaimer means the reference is a snapshot, not a tracking target.
2. **Modeler fidelity target**: ink-stroke-modeler's documented pipeline
   (wobble → spring position model → stylus-state interpolation →
   prediction) vs ink's newer internal smoothing (not published as a
   standalone spec). Recommend implementing the stroke-modeler pipeline —
   it is fully specified in its public headers — and treating ink's newer
   smoothing as inspiration only. If Android Ink API parity is later
   required, that becomes a separate admission review.
3. **Where dynamics resolve**: engine-side (deterministic, snapshot-stable,
   recommended) vs host-side (lets UI animate live but engine must still
   re-derive for commit). Recommend engine-side resolution with host sending
   raw samples; the host may run the same model for preview only.
4. **In-progress stroke preview**: confirm live preview stays host-side
   (host renders dabs to a scratch surface; engine sees one `paintStroke`
   commit) vs adding an engine `previewStroke` read op. Recommend host-side
   preview, engine commit-only — matches the photo-catalog "engine owns
   truth, host owns display" precedent.
5. **Budgets**: proposed caps needing approval — ≤4 096 input samples per
   `modelStroke`/`paintStroke` call, ≤64 brushes per document, dab count
   cap per stroke (e.g. ≤262 144) with Validation rejection, stroke JSON
   payloads stay under the 32 MiB command cap (sample arrays are small).
6. **Module placement**: stroke modeler inside `packages/prism/rust` vs a
   shared crate (N-04's forge-native palm/prediction consumer may want it
   without a Prism document). Recommend shared placement under `rust/` with
   Prism consuming it, decided when N-04 is scoped.
7. **NOTICE obligations**: if any ink/ink-stroke-modeler constants or code
   structure are ported rather than re-derived, the roster's notice
   requirements apply (copyright + Apache-2.0 text + §4 modification
   notice). A spec-level reimplementation needs none; track which path each
   stage took in the implementation report.
