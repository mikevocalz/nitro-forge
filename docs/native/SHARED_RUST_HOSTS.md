# Shared Rust engine hosts: Windows and QNX

## Scope and base

The first slice exposes the real existing Ignition engine library to additional
native hosts. It starts from the native stack in PR #10 at
`9279c9852448645f440a2481d1ae30d8a27f5438`; it must be reviewed and merged with
that prerequisite. The separate Apple/Android linkage PR #44 is outside this
change. Other Tally UI/engine PRs remain independent.

The source path is:

`host adapter → ForgeRustSession → nf_v1_* C ABI → existing Rust engine`

`ForgeSerialQueue` preserves command submission order at the asynchronous host
boundary. Rust keeps its existing per-document locks, error boundaries, undo
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
| CI | `.github/workflows/shared-rust-native-hosts.yml` | Build/link/run native Rust+C++ on Linux and Windows x64; retain saved document |
| Windows integration | `packages/ignition-windows/`, `WINDOWS_RUST_HOST.md` | RNW host boundary and integration instructions |
| QNX integration | Separate `mikevocalz/react-native-qnx` branch | Opt-in adapter built against this shared source and a QNX archive |

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

The initial default-parallel Rust build hit a local `encoding_rs` archive error
(`memory map must have a non-zero length`). Rebuilding with two jobs succeeded
without source or lockfile changes. This is recorded as an environment/build
observation; it is not a product fix.

## Target gates still required

1. Run the Windows MSVC CI job and inspect the actual link/runtime results.
2. Build the RNW integration inside a supported Windows application and exercise
   JS calls, reload/teardown, disposal, file handling and rendering there.
3. Build `nf-sys` with the exact QNX Rust/SDP toolchain and link the QNX adapter.
   Run the same native writer/reader on the target, then exercise the existing
   React Native QNX runtime and lifecycle.
4. Transfer the saved NFD1 document between targets and run the reader on each.
5. Measure latency, memory and UI responsiveness on actual hardware before making
   performance claims or turning the optional QNX integration on by default.

No QNX compiler or device is available locally. Passing the Linux host tests
does not clear either QNX or RNW runtime gates. This slice adds no third-party
engine dependency and changes no engine serialization or external data service.
Rollback consists of removing the optional host integration; the prerequisite
mobile bridge and existing engines remain independent.
