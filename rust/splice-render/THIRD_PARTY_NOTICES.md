# splice-render third-party notices

`splice-render` is original Nitro-Forge code: a deterministic software
rasterizer (alpha-over compositing, parametric transition shapes,
speed-curve retime, gain/pan/cross-fade mixing) and a JSON-lines host
service. No third-party raster, codec, or math crates are used.

## Dependencies

- `ignition-core` (workspace path dependency): MIT, first-party.
- `serde` / `serde_json` (crates.io): MIT OR Apache-2.0, Rust toolchain
  crates used for JSON payload handling only; no code shipped beyond
  normal Rust dependency linkage.

No native libraries are linked. Binaries produced from this crate
contain no third-party object code beyond the Rust dependencies above.
