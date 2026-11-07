# P10 isolated LibRaw decode proof and integration proposal

Actual result: isolated macOS arm64 source build decoded a genuine Pentax K-7 camera DNG through `open_buffer`, RAW unpack and basic half-size RGB processing. This is prototype tooling, not a Forge RAW provider, catalog engine, iOS build or completed P10.

## Pinned sources and fixture

[Official LibRaw downloads](https://www.libraw.org/download) list 0.22.3 artifacts although the page retains an older 0.22.2 heading. The downloaded [0.22.3 source archive](https://www.libraw.org/data/LibRaw-0.22.3.tar.gz) has SHA-256 `789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4`; its header and runtime identify 0.22.3. The prototype uses that exact archive, upstream Makefile.dist reentrant static target, clang++ and system zlib. No global install, default dependency, Cargo/package lock or app/native-platform file changed. Optional JPEG, DNG SDK, RawSpeed, LCMS and OpenMP integrations are not enabled.

The [raw.pixls.us repository](https://raw.pixls.us/) requires camera-original submissions and separately identifies non-CC0 samples. Its [per-file repository data](https://raw.pixls.us/json/getrepository.php?set=all) lists item 827, Pentax K-7 12bit (3:2), date 2017-01-12, as [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/), with SHA-256 `f441c36678dfca4f38e25a580f4f8485d78d8067a054153bc36be71e56c92386`. The downloaded camera DNG matches that hash. No PNG, generated mosaic or renamed raster is used. Neither fixture nor third-party source/binary is committed; the manifest retains exact source/license/hash provenance.

## Reproduction and measured result

Run `python3 tooling/raw-prototype/run.py /tmp/nf-raw-proof`. The opt-in script checks disk capacity and source/fixture hashes, builds only inside the specified directory, compiles the local CLI and writes result.json plus a real P6 preview. Initial disk availability was 12 GiB; downloads were approximately 1.6 MiB source and 20 MiB fixture, far below 1 GiB.

Observed on macOS 27.0 arm64:

- LibRaw `0.22.3-Release`; camera make/model `Pentax` / `K-7`.
- RAW plane 4736×3136, validated row pitch 9472 bytes; 14,741,139 nonzero unpacked samples counted per row using that pitch.
- Actual preview 2342×1561, 10,967,586 RGB bytes, all 256 byte values present.
- PPM SHA-256 `0a4064721a74e34a78b3aecdbc1e0026262592df06bbd91e4a19badc7372257f`.
- Invalid non-RAW input exits 1 at probe, producing no output artifact. The reproducible runner uses a fresh temporary output path on every invocation and asserts both rejection and artifact absence.

The prototype caps input at 64 MiB, RAW dimensions at 40 million pixels and requests LibRaw's 256 MiB RAW-memory limit. These do not establish a total process-memory bound, malicious-file safety or cancellation proof. Memory and output ownership are RAII; LibRaw and its retained input bytes live on the one synchronous CLI thread. Production work must use an exclusive native worker rather than the UI thread.

## Native license and platform admission

The archive's [COPYRIGHT](https://github.com/LibRaw/LibRaw/blob/0.22.3/COPYRIGHT) offers LGPL 2.1 or CDDL 1.0 and identifies included permissive component notices. Proposed native integration uses the CDDL option for isolated library files, retaining notices and making covered source/modifications available under its terms. This is an engineering distribution proposal, not final legal approval. Static iOS distribution must close the exact file-level license manifest and source-delivery requirements; using LGPL instead introduces a separate relinking/compliance review. Optional codec libraries need separate admission and are not implicitly approved.

Only the macOS arm64 static build/CLI ran. iOS needs a reproducible cross-build with explicit SDK, minimum target, architecture and separate device/simulator libraries or XCFramework, no OpenMP/global package lookup, then a real consuming Nitro v1 build. No iOS ABI/link/runtime support is asserted. Android/Windows/Linux/QNX/XR/WASM and other cameras/formats remain unverified.

## Proposed bounded real provider/catalog integration

1. Add a native RAW provider outside the I/O-free Rust engines. A job accepts immutable original bytes plus stable original id and revision, and owns LibRaw, bytes and output on one exclusive worker. Expose separate probe and decode-preview operations with validated size/work limits, real stage/error codes and cooperative cancellation. Return binary RGB/RGBA with declared stride/color/orientation plus metadata, never a fake completion timer.
2. Reuse the existing document binary boundary and [TaskControl](../../../packages/ignition/cpp/NitroForgeV1/TaskControl.hpp) ownership patterns after reviewing the generated Nitro v1 API. Decode resources and pointers stay outside serialized engine/Zustand state. Preview cache entries are evictable; originals require a durable host asset store, not only [ByteCache](../../../packages/ignition/cpp/NitroForgeV1/ByteCache.hpp).
3. Add an explicit photo/catalog document kind using the [P10/P11 factory/snapshot integration plan](../P10-P11-ENGINE-PREREQUISITES.md). Persist bounded original/version ids, content hashes, metadata/rating/develop state and durable host asset references, with atomic undo and validated kind/schema snapshots. Native bytes are supplied through the host; Rust performs no file I/O. Binding a decoded preview is a read result tied to original/revision; late jobs cannot overwrite a different photo/version.
4. First acceptance uses this admitted fixture: import to durable original storage, probe/unpack/preview through the worker, persist catalog identity/rating/version, save/reopen and reproduce the actual preview, then verify cancellation and stale-original rejection. Add native platform consumers only after this contract and license design is reviewed.

LibRaw basic processing is a decode/preview starting point. It does not complete production develop quality, ICC/proofing, lens profiles, masking/retouch, batch encoding, camera coverage or P10 acceptance. No UI/backend callback is enabled by this proof. No broad P19 platform suite ran.

After review, RAW sample traversal now validates `raw_pitch` is at least width×sizeof(unsigned short) and divisible by the sample size, then follows row stride rather than assuming packed rows. Re-running the pinned fixture and automated negative passed; sample count and preview hash above are unchanged. No iOS cross-compile ran. A separate bounded RAW-preview → Prism import/render/snapshot proof is owned by the integration task; no catalog implementation is implied.

## Actual Prism pixel and document integration proof

The separate `prism_roundtrip.py` uses the admitted LibRaw preview and the real freshly built nf-cli/Prism engine. It verifies source/fixture/preview hashes, explicitly reduces the decoded RGB to a bounded 512×341 nearest-sample preview, expands alpha to 255 and calls real new/addRasterLayer/drawPixels/flatten operations. The flattened RGBA bytes match exactly. Pixel import is one undo/redo step; an actual NFD snapshot reopens in a second engine session with identical bytes and pixels. The original DNG hash remains unchanged.

Executed `cargo build -p nf-cli` and `python3 tooling/raw-prototype/prism_roundtrip.py /tmp/nf-raw-proof`. Output RGBA SHA-256: `ff6e4d096a3991c65d724d8dec652013170e064a5a164e04e1d54cfb99f2a4c9`. NFD SHA-256: `31f7dbf3a304b5a77539625e6d85213ea7e364bea47b0edecbfcb17767395d1d`. The engine executable hash and source/result hashes are recorded in the machine-readable proof evidence. This validates a real desktop decode→engine-pixels→history→snapshot path, not a production native RAW importer, durable original store, catalog, color-managed develop pipeline or iOS/Android support. The explicit preview reduction is a verification budget, not a claim about full-quality development.
