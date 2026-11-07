# nf-raw third-party notices

## LibRaw 0.22.3

`nf-raw` links **LibRaw 0.22.3** statically (`lib/libraw_r.a`, built from the
pinned upstream tarball by `build.rs`). Binaries produced from this crate —
including test binaries — contain LibRaw object code.

- Upstream: <https://www.libraw.org/> (source mirror:
  <https://github.com/LibRaw/LibRaw>)
- Version: 0.22.3 (`LIBRAW_VERSION_STR` = `0.22.3-Release`)
- Tarball: `https://www.libraw.org/data/LibRaw-0.22.3.tar.gz`
- SHA-256 pin: `789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4`
  (same pin as `tooling/raw-prototype/manifest.json`)

### License election

LibRaw is dual-licensed: **LGPL-2.1-only OR CDDL-1.0**. This project elects
**CDDL-1.0** for the LibRaw code linked into `nf-raw`. The license texts ship
inside the pinned source tree (fetched/extracted at build time, not vendored
into this repository):

- `LibRaw-0.22.3/COPYRIGHT` — copyright and license notices
- `LibRaw-0.22.3/LICENSE.LGPL` — GNU Lesser General Public License 2.1 text
- `LibRaw-0.22.3/LICENSE.CDDL` — Common Development and Distribution License
  1.0 text

CDDL-1.0 requires that the license text accompany distribution of the
licensed code; downstream distributors of binaries containing `libraw_r.a`
should include `LICENSE.CDDL` (and `COPYRIGHT`) from the pinned source tree.

### What this crate adds

`src/raw_shim.cpp` is original Nitro-Forge code: a thin C ABI over LibRaw
(`nf_raw_probe`, `nf_raw_decode`, `nf_raw_free`) implementing bounded
preview decode. No LibRaw source files are copied or modified; the upstream
`Makefile.dist` recipe builds the library unmodified.

### Other dependencies

- `cc` (build-dependency only): MIT OR Apache-2.0, Rust toolchain crate, no
  code shipped in produced binaries.
