# nf-color third-party notices

## moxcms 0.8.1

`nf-color` depends on **moxcms =0.8.1** (the exact version already resolved
in `Cargo.lock` via `image` 0.25 / `folio-render`; the `extended_range`
feature is enabled for gamut measurement). moxcms is pure Rust — no native
code, no `unsafe` in this crate's own source.

- Upstream: <https://github.com/awxkee/moxcms>
- License: **BSD-3-Clause OR Apache-2.0** (dual; either applies)
- License texts ship in the crate package:
  `LICENSE-APACHE.md`, `LICENSE.md` under the registry source
- crates.io: <https://crates.io/crates/moxcms>

## Test fixture ICC profiles (`tests/fixtures/`)

Real ICC profile binaries are vendored for tests. Provenance:

| File | Source | License |
|---|---|---|
| `sRGB-v4.icc` | [saucecontrol/Compact-ICC-Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles) `profiles/sRGB-v4.icc` | CC0-1.0 |
| `DisplayP3-v4.icc` | same repo, `profiles/DisplayP3-v4.icc` | CC0-1.0 |
| `Rec2020-v4.icc` | same repo, `profiles/Rec2020-g24-v4.icc` | CC0-1.0 |
| `sGrey-v4.icc` | same repo, `profiles/sGrey-v4.icc` | CC0-1.0 |
| `srgb-perceptual.icc` | [awxkee/moxcms](https://github.com/awxkee/moxcms) `assets/srgb_perceptual.icc` | BSD-3-Clause OR Apache-2.0 (repo license) |
| `hostile-swapped-intent.icc` | same repo, `assets/swapped_intent.icc` (byte-swapped rendering-intent field; moxcms parses tolerantly) | BSD-3-Clause OR Apache-2.0 |
| `hostile-truncated-desc.icc` | same repo, `assets/truncated_desc_v4.icc` (non-conforming truncated `desc` tag) | BSD-3-Clause OR Apache-2.0 |
| `cmyk-lcms-test1.icc` | [mm2/Little-CMS](https://github.com/mm2/Little-CMS) `testbed/test1.icc` (CMYK output-class profile, Lab PCS) | MIT (LittleCMS) |

The Compact-ICC-Profiles fixtures are minimal v4 matrix-shaper profiles
published explicitly for redistribution (CC0). The moxcms and lcms
testbed profiles are upstream test assets redistributed under their
respective licenses; they are test data only, not shipped product
artifacts.

## What this crate adds

`src/lib.rs` and `src/tests.rs` are original Nitro-Forge code: a bounded
provider API over moxcms (profile parsing caps, channel-layout
negotiation, transform cache, soft-proof chaining, gamut measurement).
No moxcms source files are copied or modified.
