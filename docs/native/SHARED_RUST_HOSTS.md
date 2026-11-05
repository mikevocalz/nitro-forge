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
| Symbol gate | `tooling/native/nf_v1_symbols.txt`, `tooling/native/verify_nf_v1_host_link.py` | Same symbol list as the Apple/Android gate (PR #44); `nm` on ELF, `dumpbin` plus the linker map on COFF, machine type and CRT checks on Windows |
| CI | `.github/workflows/shared-rust-native-hosts.yml` | Build, symbol-check, link and run native Rust+C++ on Linux x64, Windows MSVC x64 and Windows MSVC ARM64; reopen every target's saved document on every other target |

Not in this PR (DEFER, recorded 2026-11-05):

- **RNW host adapter.** No `packages/ignition-windows` package or RNW module
  exists yet. Blocker: a React Native Windows app to register the module in,
  plus a decision on whether the Nitro v1 bridge or a hand-written RNW
  TurboModule fronts `ForgeRustSession` there.
- **QNX adapter.** No `react-native-qnx` branch consumes this package yet.
  Blocker: a QNX 8 Rust target. The pinned Rust 1.99.1 lists only QNX 7.x
  targets (`aarch64-unknown-nto-qnx700`, `aarch64-unknown-nto-qnx710`,
  `aarch64-unknown-nto-qnx710_iosock`, `x86_64-pc-nto-qnx710`,
  `x86_64-pc-nto-qnx710_iosock`, `i686-pc-nto-qnx700`), all tier 3 with no
  prebuilt std. A QNX 8 build needs a Rust toolchain that supports QNX 8 plus
  the SDP's `qcc`, neither of which CI has.

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

CI (`shared-rust-native-hosts.yml`, Rust 1.99.1) runs on `ubuntu-24.04`
(x86_64-unknown-linux-gnu), `windows-2022` (MSVC, x86_64-pc-windows-msvc, `/MD`)
and `windows-11-arm` (MSVC, aarch64-pc-windows-msvc, `/MD`). Each job checks
that the Rust archive and the linked executable define all seven `nf_v1_*`
symbols, that Windows objects and executable have the expected machine type
(8664 or AA64), and that the executable loads the dynamic release CRT. A
second job reopens the NFD1 file saved by each target on every target and
requires a byte-identical snapshot after restore.

The original author's local run (Linux x64, Rust/Cargo 1.99.1, GCC 13.3.0,
CMake 4.4.4) recorded:

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

1. Build an RNW integration inside a supported Windows application and exercise
   JS calls, reload/teardown, disposal, file handling and rendering there.
2. Build `nf-sys` with a QNX 8 Rust target and the SDP toolchain, then link the
   CMake package with `qcc`. The `QNX` link libraries in `CMakeLists.txt`
   (`m`, `socket`) are unverified until that build runs; confirm them with
   `--print native-static-libs` for the exact target.
3. Run the same writer/reader on QNX hardware (aarch64le and/or x86_64), then
   exercise the React Native QNX runtime and lifecycle.
4. Reopen a QNX-saved NFD1 file on Linux/Windows and the reverse.
5. Measure latency, memory and UI responsiveness on actual hardware before making
   performance claims or turning the optional QNX integration on by default.

Neither CI nor the development machine has a QNX SDP or device. Passing the
Linux and Windows host tests does not clear either QNX or RNW runtime gates. This slice adds no third-party
engine dependency and changes no engine serialization or external data service.
Rollback consists of removing the optional host integration; the prerequisite
mobile bridge and existing engines remain independent.
