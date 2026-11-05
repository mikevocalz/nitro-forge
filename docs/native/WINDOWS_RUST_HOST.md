# Windows host for the shared Rust engine

## What this slice implements

`packages/ignition-windows` connects a React Native Windows TurboModule to the
existing `EngineHost` interface. It calls the same `ForgeRustSession` from PR #10,
the same `nf_v1_*` ABI, and the same `nf-sys` Rust library used by the shared native
host. It introduces no engine implementation, FFI variant, or saved-file format.

The path is:

`DocumentHandle / Tally → EngineHost → ForgeWindows RNW module → owned worker → ForgeRustSession → nf-sys`

The exported factory is `createWindowsHost(): EngineHost`. Its internal transport
uses opaque string tokens. The adapter maps them to monotonically increasing,
safe local JavaScript numbers required by the existing host interface. Rust
session IDs never reach JavaScript. Different host instances track and dispose
only their own documents, even when they share the registered RNW module.

This package is private and uses explicit host integration. It does not claim
that upstream Nitro v1 or Expo Modules run on Windows, and it adds no Windows UI
components. The host's views, file service, clipboard, focus and rendering remain
platform responsibilities.

The consuming Windows application supplies its audited RN/RNW host. This private
source package has no RN/RNW dependency or peer declarations: installing the
Forge workspace does not create a Windows application or resolve another React
Native SDK graph. Its sole workspace dependency is the existing Ignition API.

## Native ownership and ordering

One owned FIFO worker serves the module. Its document map exists only on that
thread, and all engine creation, commands, undo/redo, snapshot/restore and close
operations execute there. Calls on different documents also share this FIFO;
this initial transport does not claim parallel document throughput.

Every accepted task owns its strings and promise, catches its engine exceptions,
and resolves or rejects once. No task captures the module or worker by pointer.
The queue mutex protects admission and pending tasks only; it is released before
engine work and promise completion. A failed queue insertion rejects that call
without leaving another accepted task unscheduled. This owned worker does not
depend on recovery from arbitrary scheduler failure in `ForgeSerialQueue`.

Module destruction stops admission, drains accepted work, joins the worker and
destroys its remaining Rust sessions on the worker. Teardown can wait for a
running engine command; this slice has no cancellation or timeout mechanism.
Applications should dispose their `EngineHost` before replacing the React
instance. A destroyed JS runtime cannot receive a result; RNW's weak runtime
references guard delivery while native cleanup still completes.

RNW 0.85.0's `ReactPromise` owns its result writer and callbacks. Its TurboModule
provider uses `CallInvokerWriter`, which builds a dynamic result off the caller
thread and schedules JS delivery with `CallInvoker::invokeAsync`. Those
completion callbacks hold weak JS function/runtime references, not this module.
The adapter therefore resolves directly from its worker without another custom
JS dispatcher hop. The exact source files are linked below.

Commands and event details use the existing serialized JSON boundary. Snapshots
are NFD1 bytes, encoded as base64 only across the attributed RNW module transport.
The public host returns and accepts `Uint8Array`. Restore serializes the supplied
view before yielding, so later mutation of the caller's buffer cannot alter
queued native input. Win32 Crypt32 conversion runs on the worker and enforces
the existing 256 MiB native snapshot limit. Encoding, decoding, JS serialization
and Rust output ownership all involve copies; large-document responsiveness and
memory pressure remain device measurement work.

## Build the native libraries

Use a Windows development shell with Rust, CMake and an MSVC toolset supported
by the target RNW application. The first native evidence is Windows x64 Release
with the dynamic C/C++ runtime (`/MD`). Do not mix architectures or link a Debug
`/MDd` host to these Release objects.

From the Forge repository root, in PowerShell:

```powershell
rustup toolchain install 1.99.1 --profile minimal --target x86_64-pc-windows-msvc
cargo +1.99.1 build -p nf-sys --release --locked --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw "Rust build failed" }

$forgeRustLibrary = (Resolve-Path "target/x86_64-pc-windows-msvc/release/nf_sys.lib").Path
cmake -S packages/ignition-windows -B target/ignition-windows -A x64 `
  "-DNF_RUST_LIBRARY=$forgeRustLibrary" `
  -DNF_WINDOWS_BUILD_TESTS=ON `
  -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }
cmake --build target/ignition-windows --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw "Native build failed" }
ctest --test-dir target/ignition-windows -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw "Native tests failed" }
```

This builds `forge_windows_worker`, `forge_windows_codec`, and the shared
`forge_rust_session` from `packages/ignition-native`. On Windows the tests execute
the real Rust Tally engine through the owned worker and check the Crypt32 codec.
`ForgeWindowsModule.cpp` is compiled by the RNW host in the next step. Passing
these CMake tests alone does not verify RNW registration or JS execution.

The common MSVC system-library list is `advapi32`, `bcrypt`, `dbghelp`, `kernel32`,
`ntdll`, `userenv` and `ws2_32`; the Windows snapshot codec also links `crypt32`.
The native core CI verified the common list with its recorded Rust/MSVC versions.
For another toolchain, inspect Rust's `--print native-static-libs` output and
provide any additional libraries using `NF_RUST_SYSTEM_LIBRARIES` for CMake and
`ForgeRustSystemLibraries` for the MSBuild import.

## Register in an RNW 0.85 application

Keep the Windows app on a compatible RN/RNW 0.85 dependency set. RNW 0.85.0's
own package uses React Native 0.85.3 and React 19.2.3 in development; its public
peer range is React Native `^0.85.0`. This repository's mobile dependency graph
is not a Windows app template.

The exact RNW 0.85.0 `cpp-app` template selects the **v145** platform toolset and
imports the Composition C++ application property sheets. Supply that toolset
and the template's generated WinRT headers/SDK dependencies for an RNW build.
A successful MSVC 19.44 native-core build does not establish that those RNW host
prerequisites are installed. Do not silently downgrade the RNW template to make
a header-only compile appear to pass.

In the application's `.vcxproj`, after its item definitions and before the
`Microsoft.Cpp.targets` import, set absolute paths and import:

```xml
<PropertyGroup>
  <ForgeNativeBuildDir>C:\src\nitro-forge\target\ignition-windows</ForgeNativeBuildDir>
  <ForgeRustLibrary>C:\src\nitro-forge\target\x86_64-pc-windows-msvc\release\nf_sys.lib</ForgeRustLibrary>
</PropertyGroup>
<Import Project="C:\src\nitro-forge\packages\ignition-windows\windows\ForgeWindows.props" />
```

The import compiles the RNW adapter with C++20, disables the host's precompiled
header for that translation unit, links the libraries above, and fails with a
specific message when the required Release artifacts are missing. The
application's existing RNW properties supply `NativeModules.h`, the generated
`winrt/Microsoft.ReactNative.h`, and the RNW runtime link settings.

Call the registration function exactly once from the host's existing
`IReactPackageProvider::CreatePackage` implementation:

```cpp
#include <RegisterForgeWindows.hpp>

void ReactPackageProvider::CreatePackage(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const& packageBuilder) noexcept {
  // Keep the host's existing package registration here as well.
  nitroforge::windows::RegisterForgeWindows(packageBuilder);
}
```

The module uses `REACT_MODULE_NOREG` and explicitly calls
`AddTurboModule(L"ForgeWindows", MakeModuleProvider<ForgeWindowsModule>())`.
There is no automatic package-provider registration: the app must already add
that provider to its React host. This avoids silently registering the same
module through both attributed discovery and a manual provider.

Once registered, existing document code can select the Windows host:

```ts
import { DocumentHandle } from "@nitro-forge/ignition";
import { createWindowsHost } from "@nitro-forge/ignition-windows";

const host = createWindowsHost();
try {
  const document = await DocumentHandle.open(host, "tally");
  await document.apply("setCell", { addr: "A1", value: "42" });
  const bytes = await document.snapshot();
  await appFiles.writeDocument(bytes);
  await document.close();
} finally {
  await host.dispose();
}
```

`appFiles` is the application's existing file service, not a service introduced
by this package. Native engine work stays off the calling thread. The initial
JSON/base64 bridge still performs JS-side serialization and should be measured
with the actual documents the application uses.

## Actual RNW acceptance harness

The exported `@nitro-forge/ignition-windows/smoke` entry point resolves the real
registered module; it does not accept a mock `EngineHost`. Supply the app's byte
persistence functions:

```ts
import {
  writeWindowsTallyFixture,
  readWindowsTallyFixture,
} from "@nitro-forge/ignition-windows/smoke";

// First application launch:
const written = await writeWindowsTallyFixture((bytes) => appFiles.writeDocument(bytes));
console.log("Windows Tally write", written);

// After terminating and relaunching the application:
const reopened = await readWindowsTallyFixture(() => appFiles.readDocument());
console.log("Windows Tally reopen", reopened);
```

The writer checks formula values 30 → 42 → undo to 30 → redo to 42, writes real
NFD1 bytes, then closes. The reader creates a fresh Rust session, restores the
saved bytes exactly, recomputes 42, checks an empty restored undo journal, edits
to 43, undoes to 42 and verifies that corrupt NFD1 rejects without changing the
document. Record the application version, architecture, source commit, build
log, write/read output, file hash and an actual relaunch in the runtime roster.
An in-memory persistence callback does not prove filesystem or process lifetime.

## Evidence and remaining gates

| Check | Evidence in this slice |
| --- | --- |
| Same Rust engine and C++ session on Windows x64 | Shared native CI passes; see `SHARED_RUST_HOSTS.md` for run/commit and cross-platform file evidence |
| Windows worker behavior with actual Rust | Local Linux Release build passes `windows_worker_real_rust`: FIFO, edit/undo/restore, atomic rejection and teardown drain |
| Windows transport TypeScript checks | PASS: 10 boundary/lifecycle tests and package typecheck; full workspace tests (48) and typechecks also pass with pnpm 10.32.1 |
| Win32 codec and worker with MSVC | CMake targets supplied; Windows run must be recorded separately |
| RNW adapter translation unit in actual host | **NOT RUN locally**; requires the RNW 0.85 host toolchain/generated headers |
| Registered JS module, Hermes delivery, reload and app relaunch | **NOT RUN locally**; use the two-phase acceptance harness on Windows |
| Native UI, clipboard, focus, grid rendering and performance | Outside this transport slice; require the Windows application's own evidence |

The transport tests use a fake module to isolate boundary and lifetime behavior.
They do not count as a real Rust or RNW runtime test. The C++ worker test links the
actual Rust library, while the common native save/reopen probe separately tests
Windows file bytes across process lifetime. These evidence categories must stay
distinct when reporting readiness.

## Exact primary sources inspected

- [RNW 0.85.0 package metadata](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/package.json)
- [RNW 0.85.0 C++ app project template](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/templates/cpp-app/windows/MyApp/MyApp.vcxproj)
- [RNW attributed module and provider APIs](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/Microsoft.ReactNative.Cxx/NativeModules.h)
- [Explicit native package registration](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/Microsoft.ReactNative/ReactPackageBuilder.cpp)
- [Owned ReactPromise result state](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/Microsoft.ReactNative.Cxx/ReactPromise.h)
- [TurboModule promise callbacks](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/Microsoft.ReactNative/TurboModulesProvider.cpp)
- [Off-thread result conversion and JS call invoker](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/Microsoft.ReactNative/CallInvokerWriter.cpp)
- [CryptBinaryToStringA ownership/length/library contract](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-cryptbinarytostringa)
- [CryptStringToBinaryA input and strict decoding contract](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-cryptstringtobinarya)
