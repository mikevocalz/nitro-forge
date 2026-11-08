# Prism dependency notices

The `encodePng` read op encodes rendered RGBA through the `png` crate 0.18.1
(already present in the workspace dependency tree via folio-render's `image`
dependency; promoted to a direct dependency here). The crate and its
encode-path transitive dependencies are offered under permissive licenses;
this distribution uses the MIT option where a crate offers MIT OR
Apache-2.0. Sources and checksums are pinned in Cargo.lock; no upstream code
was copied into the engine.

- `png` 0.18.1 — MIT OR Apache-2.0. Exact source:
  https://github.com/image-rs/image-png (crate `png`, tag png-0.18.1 / the
  0.18.1 crates.io release).
- `flate2` 1.1.10 — MIT OR Apache-2.0.
  https://github.com/rust-lang/flate2-rs
- `miniz_oxide` 0.8.9 / 0.9.1 — MIT OR Zlib OR Apache-2.0 (MIT option used).
  https://github.com/Frommi/miniz_oxide
- `fdeflate` 0.3.7 — MIT OR Apache-2.0.
  https://github.com/image-rs/fdeflate
- `crc32fast` — MIT OR Apache-2.0. https://github.com/srijs/crc32fast
- `bitflags` 2.13.2 — MIT OR Apache-2.0.
  https://github.com/bitflags/bitflags
- `adler2` 2.0.1 — 0BSD OR MIT OR Apache-2.0 (MIT option used).
  https://github.com/oyvindln/adler2
- `simd-adler32` 0.3.10 — MIT. https://github.com/powturbo/simd-adler32

Copyright holders are the respective crate authors (The Rust Project
Developers et al.); full license texts ship inside each crate's Cargo
package under `~/.cargo/registry` and in the crates.io archives.
