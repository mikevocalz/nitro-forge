# Shared Rust engine hosts: Windows and QNX

## Scope and base

The first slice exposes the real existing Ignition engine library to additional
native hosts. It starts from the native stack in PR #10 at
`9279c9852448645f440a2481d1ae30d8a27f5438`; it must be reviewed and merged with
that prerequisite. The separate Apple/Android linkage PR #44 is outside this
change. Other Tally UI/engine PRs remain independent.

The source path is:

`host adapter → ForgeRustSession → nf_v1_* C ABI → existing Rust engine`

QNX reuses `ForgeSerialQueue` at the asynchronous host boundary. Windows uses
one owned FIFO worker for all document operations. Rust keeps its existing per-document locks, error boundaries, undo
journal and NFD1 snapshot format. The shared CMake package compiles the existing
C++ implementation directly; it does not copy or move the mobile implementation.

This is reuse of Forge's current Rust engines. It does not assert that every
ArtCraft subsystem, media backend, native view or Expo module is already portable.
Native UI, GPU surfaces, file pickers, playback devices and other OS services
still belong to their platform hosts. The Windows renderer and the QNX
Fabric/Hermes/Qt host remain separate from the document engine.

## Owned changes

| Area | Files | Responsibility |
| --- | --- | --- |
| Shared native build | `packages/ignition-native/` | Consume an explicitly built target archive; export the same session/queue targets |
| Native acceptance probe | `tooling/native/shared_engine_roundtrip.cpp` | Tally edit, formula recomputation, undo/redo, binary save and reopen in another process |
| Symbol gate | `tooling/native/nf_v1_symbols.txt`, `tooling/native/verify_nf_v1_host_link.py` | Verify the shared ABI in the Rust archive and linked executable; check Windows machine type and release CRT |
| CI | `.github/workflows/shared-rust-native-hosts.yml` | Linux x64, Windows MSVC x64/ARM64, worker/codec tests, TypeScript contract, and cross-target document interchange |
| Windows integration | `packages/ignition-windows/`, `WINDOWS_RUST_HOST.md` | RNW host boundary and integration instructions |
| QNX integration | [react-native-qnx PR #42](https://github.com/mikevocalz/react-native-qnx/pull/42) | Opt-in native owner and Linux host fixture; actual QNX build remains gated |

## Engineering skills applied

The required sequence was read from
[`margelo/react-native-skills` at `1e9e17be6f41c838db472d6a4b943fc26355a3be`](https://github.com/margelo/react-native-skills/tree/1e9e17be6f41c838db472d6a4b943fc26355a3be).

| Skill | Decision in this slice |
| --- | --- |
| `api-design` | Preserve the existing document contract, explicit readiness/disposal and observable errors; no platform-only engine API |
| `build-nitro-modules` | Reuse the real native implementation and generated contract where supported; do not claim upstream Nitro or Expo support for an unimplemented target |
| `cpp` | Reuse RAII ownership and FIFO queue; require an explicit target library; keep build logic separate from engine logic |
| `build-nitro-modules/references/repo-structure-and-workflow.md` | Isolated branch/draft PR, package-scoped build, executable evidence and CI; existing repository naming/tooling retained |

No new HybridObject or mobile scaffold is needed for the shared build target.
The existing v1 bridge uses the exact Nitro alpha already pinned on the base
branch. No npm dependency upgrade or generated-file edit is part of the shared
native build.

## Acceptance evidence

Local development machine: Linux x64, Rust/Cargo 1.99.1, GCC 13.3.0, CMake 4.4.4.

[CI run 42121532215](https://github.com/mikevocalz/nitro-forge/actions/runs/42121532215)
at commit `88ef06e2a5d0977d3de643fbaf368f32dbcacdb6` passes all three native
jobs (Linux x64, Windows x64 and Windows ARM64) and all three document
interchange jobs. Each target reopens all three saved NFD1 files. The newly added
Windows worker/codec and TypeScript steps require their own updated run.
The symbol gate uses `nm` on Linux and MSVC `dumpbin` plus a linker map on
Windows. Shared CMake now rejects 32-bit hosts and explicit static CRT builds.

- The optimized real `nf-sys` archive builds with the lockfile unchanged.
- The complete Rust workspace passes 204 tests, including 13 nf-sys boundary,
  concurrency, close and allocation-accounting tests.
- The shared CMake target builds in Release. All three CTest cases pass.
- The writer creates a real 145-byte NFD1 document; a separate reader process
  restores it and computes the expected result. Assertions do not disappear under
  `NDEBUG`.
- Malformed command JSON, an invalid cell address and corrupt NFD1 input reject
  without changing the document; independent documents remain isolated.
- The existing queue test executes 500 commands in submission order, with only
  one drain active at a time.
- [CI run 42119257282](https://github.com/mikevocalz/nitro-forge/actions/runs/42119257282)
  at commit `2f33f2fb204077c4a493788ee36890c76f03b31a` passes on both Linux x64
  and Windows x64/MSVC 19.44.35229.0: 13 Rust ABI tests and all three native CTest
  cases on each platform.
- The Windows-created NFD1 artifact was downloaded and reopened with the Linux
  native reader. It recomputed `42`, accepted a further edit, and undid it.
  Windows and Linux produced identical 145-byte files with SHA-256
  `4b3521173c19799e3636d4ef2e12afcad0f9eccb34ba21a23ab8eef8dd312304`.
- All 48 workspace JavaScript tests and all package typechecks pass, including
  the Windows adapter's 10 boundary/lifecycle tests. Frozen installation adds
  only one workspace importer; existing versions remain unchanged.
- The Windows worker's real Rust test passes on Linux.
- Independent review found no remaining blocker in the common package or native
  adapters. It found and fixed caller-thread document disposal in the QNX owner;
  live Rust sessions now close on the owned worker. The inherited
  queue does not guarantee recovery when a scheduler fails concurrently with
  another submission, or when a throwing task is followed by a scheduling
  failure. Adapters must own a live executor and catch task failures; this slice
  does not promote the queue to an arbitrary failing-scheduler abstraction.

The initial default-parallel Rust build hit a local `encoding_rs` archive error
(`memory map must have a non-zero length`). Rebuilding with two jobs succeeded
without source or lockfile changes. This is recorded as an environment/build
observation; it is not a product fix.

## QNX Rust dependency compatibility

The installed Rust 1.99.1 target list includes `aarch64-unknown-qnx` and
`x86_64-pc-qnx`. Running `rustc --print cfg --target aarch64-unknown-qnx`
reports `target_os="qnx"`. This query does not require QNX standard libraries
or an SDP and is not a cross-compilation result.

The locked `getrandom` 0.3.4 source selects its QNX backend, errno helper and
libc dependency using only `target_os="nto"`; it does not select a default
backend for `target_os="qnx"`. The actual `cargo tree -i getrandom --locked`
dependency path is `nf-sys → folio-engine → lopdf 0.36.0 → rand 0.9.5 →
rand_core 0.9.5 → getrandom 0.3.4`. The installed `libc` 0.2.190 already
recognizes both names.

This is a source-level compatibility blocker for that newer target and the
current full-engine lockfile, in addition to the unavailable SDP/target standard
library. It needs a reviewed compatible toolchain/dependency selection and an
actual QNX build. No crate patch, unsafe random fallback or forced target cfg is
introduced here. Sources inspected: the locked crate's
[`backends.rs`](https://github.com/rust-random/getrandom/blob/v0.3.4/src/backends.rs),
[`util_libc.rs`](https://github.com/rust-random/getrandom/blob/v0.3.4/src/util_libc.rs)
and [`Cargo.toml`](https://github.com/rust-random/getrandom/blob/v0.3.4/Cargo.toml),
plus the installed compiler's target configuration and Cargo dependency tree.

## Target gates still required

1. Verify the expanded MSVC x64/ARM64 worker, codec, ABI and interchange CI jobs.
2. Build the RNW integration inside a supported Windows application and exercise
   JS calls, reload/teardown, disposal, file handling and rendering there.
3. Resolve the QNX target/dependency mismatch above, build `nf-sys` with the exact
   QNX Rust/SDP toolchain, and link the QNX adapter.
   Run the same native writer/reader on the target, then exercise the existing
   React Native QNX runtime and lifecycle.
4. Extend the verified Windows-to-Linux document transfer to the QNX target.
5. Measure latency, memory and UI responsiveness on actual hardware before making
   performance claims or turning the optional QNX integration on by default.

No QNX compiler or device is available locally. Passing the Linux host tests
does not clear either QNX or RNW runtime gates. This slice adds no third-party
engine dependency and changes no engine serialization or external data service.
Rollback consists of removing the optional host integration; the prerequisite
mobile bridge and existing engines remain independent.
