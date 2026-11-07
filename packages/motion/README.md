# Motion: bounded 2D engine source

Motion is registered after Photo as engine tag 8. It persists flat rect/ellipse and immutable raster-asset layers, 2D transforms/opacity and scalar hold/linear/Bezier keyframes, and renders genuine RGBA frames through Prism. NFD1's header is unchanged; JSON payload owns `kind:"motion",schema:1`.

The document has a 16 MiB serialized-state cap, sixteen Arc/COW history entries, at most 128 layers/curves, 100k keys total, and one-megapixel frame output. Scale animation retains a nonzero base sign to satisfy Prism's public transform API. See [ENGINE_OPS](../../docs/ENGINE_OPS.md) for exact operations and budgets.

`MotionDocument.openSnapshot` uses the shared borrowed-byte ownership helper. CLI and FFI factories, checkpoint tags and generated native enum include Motion 8 without changing tags 0..7. This source registration is not an app rollout, native binary validation or completed P11 acceptance. Spring, nested compositions, media decoding, mattes/effects, expressions, particles, 3D and encoded render queues remain unsupported.

Focused validation covers scalar math, actual moved/pivot-mirrored pixels, JSON/binary results, history/no-op/batch atomicity, corrupt/foreign/oversized restore, cancellation, resource caps, CLI/shared-snapshot opening and FFI/checkpoint/native-enum registration. No native target build or release was performed.

Raster assets own packed `rgba8-straight-srgb` bytes in Arc storage, with at most 16 assets and 4 MiB decoded total. Multiple layers can reference one immutable asset. Native asset dimensions must fit the composition; logical current raster canvas backing is capped at 16 MiB. Actual rendering uses Prism's binary raster upload/compositor. This storage bound does not claim peak RSS. The typed JSON facade copies/encodes caller views synchronously; native binary input is separately tested. See the [raster source report](../../docs/completion/reports/P11-motion-raster-source.md).
