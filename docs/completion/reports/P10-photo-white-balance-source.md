# P10 photo develop white balance (Kelvin/tint) source checkpoint

Adds bounded white-balance controls to the existing persistent develop recipe
and makes them affect real preview pixels. This is one bounded P10 slice; it is
not ICC color management, camera calibration, a RAW decoder or RAWDevelopPanel
acceptance.

## Contract

`Develop` schema 1 gains two additive optional fields:
`temperature_kelvin` (finite, 2000..=40000 K; absent or explicit JSON null
means no illuminant correction) and `tint` (finite, -1..=1; default 0). Both
use serde defaults plus `skip_serializing_if` at neutral values, so recipes
and catalog snapshots written before this change deserialize, validate and
re-serialize byte-identically; `deny_unknown_fields` still rejects anything
else. `setDevelop`/`readDevelop`/`processPreview` semantics, the
original/version/hash/expected-recipe guards, journal undo and the 1 MP /
4096-side preview budget are unchanged. Out-of-range Kelvin/tint and hostile
restores reject before mutation.

## Color math (declared approximation)

White balance is a per-channel linear-light gain computed once per preview:

- `blackbody_rgb(K)` is a Tanner Helland-style sRGB blackbody fit
  (piecewise power/log approximation of the Planckian-locus RGB), returning
  ~0..255 channel values.
- Channel gains are `blackbody(6500 K) / blackbody(K)`, normalized to exactly
  `[1,1,1]` at the 6500 K reference, each clamped to `[0.125, 8]` so extreme
  illuminants saturate instead of extrapolating. Lower Kelvin therefore adds
  blue (cooling a warm-lit scene); higher Kelvin warms toward red.
- `tint` scales the linear green gain by `1 - 0.5*tint` (range ×[0.5, 1.5]),
  a bounded green/magenta trim, not a calibrated tint axis.
- Effective per-channel scale is `2^exposure_ev × wb_gain × rgb_gain`,
  applied after sRGB decode and before the existing contrast/encode stages.
  Alpha remains byte-exact.

This is honestly a white-balance approximation inside the declared sRGB
working space. It is not a Planckian-locus/CIE computation, not camera
calibration, and not an ICC/profile transform; profile-aware color management
remains deferred.

## Typed facade

`PhotoDevelopV1` gains optional `temperature_kelvin`/`tint` with the same
bounds; `ownDevelopRecipe` validates them before transport and the preview
response check now compares both fields (absent engine fields read as
neutral). Unknown recipe fields still reject rather than being dropped.

## Verification actually run

- `cargo test -p photo-engine`: 13 passed (was 11). New tests assert actual
  processed pixel values for 2500 K/10000 K/6500 K+tint cases, directional
  channel changes, alpha retention, recipe persistence across snapshot
  restore, undo/redo, equal-write eventless noops, legacy recipe
  deserialize/reserialize identity, explicit-null Kelvin, out-of-range and
  unknown-field rejection, and hostile-restore atomicity.
- `cargo build -p nf-cli`: pass.
- `pnpm --filter @nitro-forge/photo test`: 10 passed (was 8). New e2e drives
  a real Kelvin+tint recipe through the CLI host asserting exact output
  pixels `[200,109,95,255]`, undo/reopen persistence and stale-recipe
  rejection; a second suite rejects out-of-range white-balance fields before
  transport.
- `pnpm --filter @nitro-forge/photo typecheck`: pass.
- `pnpm --filter @nitro-forge/ignition exec vitest run
  tests/photo-motion-pipeline.test.ts tests/photo-registration.test.ts`:
  3 passed.

Not run: native targets, ICC/profile transforms, camera calibration, the
canonical RAWDevelopPanel binding, or any platform acceptance. No dependency,
FFI, snapshot-format or engine-identity change; the NFD1 payload shape is
unchanged because the new recipe fields live inside the existing `develop`
object.
