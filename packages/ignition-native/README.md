# Shared native Rust engine

This CMake package exposes the existing `nf-sys` Rust engines and the existing
`ForgeRustSession` / `ForgeSerialQueue` C++ implementation to native hosts. It
does not contain another engine, another FFI, a renderer, or a JavaScript runtime.
The source remains in `packages/ignition-v1-lab/cpp` so the mobile Nitro bridge
and Windows/QNX integrations compile the same implementation.

## Targets

| Target | Contract |
| --- | --- |
| `forge_rust_session` | C++20 synchronous document API, linked to the supplied `nf-sys` static library; includes `ForgeRustSession.hpp` |
| `forge_serial_queue` | Existing per-document FIFO queue; the host supplies an asynchronous scheduler and handles task errors |
| `forge_shared_engine_roundtrip` | Optional executable: Tally edits, undo/redo, failure isolation, save and reopen across two processes |

`ForgeRustSession` owns the Rust handle. Hosts own scheduling and filesystem I/O.
Run document work on a worker, keep returned strings/bytes owned, serialize each
document's operations, and close resources deterministically. A shared Rust
codebase still requires a separate binary for each OS, architecture and ABI.

## Linux development proof

Run from the repository root, using the same compiler toolchain for the archive
and host. The explicit path prevents a cross-build from picking up a host binary.

```sh
cargo build -p nf-sys --release --locked
cmake -S packages/ignition-native -B target/native-host \
  -DCMAKE_BUILD_TYPE=Release -DNF_BUILD_TESTS=ON \
  -DNF_RUST_LIBRARY="$PWD/target/release/libnf_sys.a"
cmake --build target/native-host --parallel 2
ctest --test-dir target/native-host --output-on-failure
```

Tests use real `nf-sys` symbols, not mocks. Checks remain enabled in Release.
The writer stores a sheet containing `SUM(A1:A2)`, changes an input, undoes and
redoes it, then saves NFD1 bytes and closes. A new process restores the file,
recomputes `42`, edits it, and undoes the edit. Invalid JSON, invalid addresses,
corrupt snapshots, independent sessions and closed-handle rejection are checked.
The existing serial-queue test verifies FIFO order and single-drain execution.

## Embed in a native host

Set `NF_RUST_LIBRARY` before adding this source directory. Link the exported
targets, rather than compiling a second copy of the session wrapper.

```cmake
set(NF_RUST_LIBRARY "/absolute/path/to/target/libnf_sys.a" CACHE FILEPATH "")
add_subdirectory("${FORGE_SOURCE_DIR}/packages/ignition-native" forge-native)
target_link_libraries(my_native_host PRIVATE forge_rust_session forge_serial_queue)
```

There is deliberately no Cargo invocation in CMake. Build `nf-sys` explicitly
with a pinned Rust toolchain and lockfile for the target. Header and library must
come from the same Forge revision. CMake rejects missing libraries and unsupported
host linkage; an existing path alone does not prove the archive has the right ABI.
The actual native link and runtime tests are the acceptance gate.

For a toolchain that adds system dependencies, inspect its actual output:

```sh
cargo rustc -p nf-sys --release --locked -- --print native-static-libs
```

Supply additional libraries as a semicolon-separated `NF_RUST_SYSTEM_LIBRARIES`
CMake value. Keep the same `--target` and Rust flags as the artifact build when
inspecting a cross-compiled archive.

## Windows

Build `nf-sys` for `x86_64-pc-windows-msvc` or `aarch64-pc-windows-msvc` to
match the host, then pass `target/<triple>/release/nf_sys.lib`. Configure the C++
host for the same architecture (`-A x64` or `-A ARM64`) and CRT. CI builds both
with MSVC Release and the dynamic CRT (`MultiThreadedDLL`, `/MD`), matching
Rust's default MSVC CRT choice. CMake rejects a static-CRT
`CMAKE_MSVC_RUNTIME_LIBRARY` and any 32-bit configuration: `nf_v1.h` declares
no calling convention, which is unambiguous only on x64 and ARM64. A mismatched
archive/host architecture fails at link time (LNK1112).

```powershell
cargo build -p nf-sys --release --locked --target x86_64-pc-windows-msvc
cmake -S packages/ignition-native -B target/native-windows -A x64 `
  -DNF_BUILD_TESTS=ON -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL `
  "-DNF_RUST_LIBRARY=$((Get-Location).Path)/target/x86_64-pc-windows-msvc/release/nf_sys.lib"
cmake --build target/native-windows --config Release
python tooling/native/verify_nf_v1_host_link.py --machine x64 `
  --archive target/x86_64-pc-windows-msvc/release/nf_sys.lib `
  --binary target/native-windows/Release/forge_shared_engine_roundtrip.exe `
  --map target/native-windows/forge_shared_engine_roundtrip.map
ctest --test-dir target/native-windows -C Release --output-on-failure
```

The symbol gate reads the same `tooling/native/nf_v1_symbols.txt` as the
Apple/Android gate. This proves native engine linkage; there is no React Native
Windows module in this package yet, so RNW registration, JS lifecycle and the
rendered UI are still open (see `docs/native/SHARED_RUST_HOSTS.md`).

## QNX

Not built yet. CI has no QNX SDP, and the pinned Rust 1.99.1 has no QNX 8
target (its `nto` targets are QNX 7.0/7.1 only, tier 3). When a QNX 8 Rust
target and the SDP are available: build the archive with that target, configure
this package with the SDP's CMake toolchain (`qcc`, aarch64le or x86_64), and
confirm the `QNX` link libraries against `--print native-static-libs`. Do not
use a Linux archive or treat host tests as QNX evidence. No `react-native-qnx`
adapter consumes this package yet; one stays opt-in until a target build and
device roundtrip pass.

With `NF_BUILD_TESTS=ON`, the same writer/reader executable can be built for QNX,
copied to a device and run against a writable location:

```sh
./forge_shared_engine_roundtrip write /tmp/tally-roundtrip.nfd
./forge_shared_engine_roundtrip read /tmp/tally-roundtrip.nfd
```

The reader also accepts a file produced by another platform from the same
revision. CI already does this across Linux x64, Windows x64 and Windows ARM64.
