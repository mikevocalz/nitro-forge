# Nitro Modules v1 alpha — Ignition document-session prototype

**Status:** isolated Nitro v1 API and generator probe. Not a native engine bridge, not installed in Expo or any consumer application, not publishable. Last source review: **2026-11-02**.

## Version and official source evidence

- [Margelo Nitro v1 release `v1.0.0-alpha.nightly.115.gcdaf72e60229`](https://github.com/margelo/nitro/releases/tag/v1.0.0-alpha.nightly.115.gcdaf72e60229), published 2026-11-02. This is a **prerelease**; stable npm `latest` remains 0.37.1 until verified otherwise.
- The v1 implementation package, `nitro-core`, and `nitrogen` generator must use the **same exact alpha** build. Do not mix v0 generated code with v1 native runtime.
- [Official v1 Nitrogen README at release tag](https://github.com/margelo/nitro/blob/v1.0.0-alpha.nightly.115.gcdaf72e60229/packages/nitrogen/README.md) is authoritative for this alpha. The [Margelo skill repository](https://github.com/margelo/react-native-skills/tree/1e9e17be6f41c838db472d6a4b943fc26355a3be) is essential for API design, C++, Swift/Kotlin and native lifecycle; where its examples describe the **old interface/HybridObject style**, follow the exact v1 source instead.
- [Nitro v1 template](https://github.com/margelo/nitro/tree/v1.0.0-alpha.nightly.115.gcdaf72e60229/packages/template) specifies `@Apple` / `@Android` decorators, `export declare class ... extends HybridObject`, `#nitro/*` package import map, `nitro.json.apple/android`, and generated class modules. The previous `nitro.json.ios` /`autolinking` and `createHybridObject<T>()` approach are not interchangeable.

## Why this is a different API, not a version bump

| Existing Ignition (v0 alpha-era API) | Nitro v1 preview | Benefit and remaining work |
| --- | --- | --- |
| `Forge` interface, `createHybridObject<Forge>()` | Generated `ForgeFactory` native class with declared constructor and factory method | TypeScript and native constructor consistency; requires Nitrogen and actual C++ implementation |
| JS `number` for Rust `u64` session handle | `ForgeDocument` is an opaque native-owned HybridObject returned by `open()` | No unsafe numeric document ID exposed to JS. Internal Rust handles still require generation/lifecycle validation |
| `applyJson(string): Promise<string>` | `apply(ForgeCommand): Promise<ForgeCommandResult>` with a named command/result envelope and serialized `payloadJson` / `dataJson` | Removes the ambiguous outer JSON status frame, but retains heterogeneous Rust payload JSON until Nitrogen supports nested `AnyJSON` in named struct properties; benchmark costs |
| `snapshotB64()/restoreB64()` | `snapshot(): Promise<ArrayBuffer>`, `restore(ArrayBuffer)` | Avoids base64 encoding over the JS/native boundary, not necessarily zero copies between Rust/native/Skia |
| Global Forge module dispatches every session by handle | One ForgeDocument native object per document | Allows per-session ownership and cleanup after implementation. Current `nf-sys` global mutex remains a blocker |
| Generated v0 interface, `nitro.json.autolinking` | v1 class annotations, runtime registration via constructor/implementation | Must port Native C++/Swift/Kotlin and packaging; no compatibility shim should hide broken build |
| 64-bit values not safely represented as JS numbers | v1 `UInt64` maps to `bigint` | Could allow exact revision IDs / asset IDs in a later reviewed API; not a reason to expose raw session addresses |

**Intentionally not done:** mapping an unproven `UInt64` revision onto Ignition's current document model. The Rust state machine does not currently expose a canonical revision through its `Engine` trait; fabricating one in the JS wrapper would be misleading.

## Exact files in this PR

```text
packages/ignition-v1-lab/
  package.json               # private, alpha pinned, not a product dependency
  nitro.json                 # v1 apple/android config, no legacy autolinking
  tsconfig.json              # TS6 + resolvePackageJsonImports
  src/
    contracts.ts             # seven immutable engine kinds + typed command/result
    index.ts                 # v1 class exports, runtime installed only when imported
    specs/
      ForgeFactory.nitro.ts  # new ForgeFactory().open(kind): Promise<ForgeDocument>
      ForgeDocument.nitro.ts # apply, owned NFD1 bytes, restore, undo/redo, close
tooling/nitro-v1/
  verify-generated.mjs       # enforce output and stable app isolation
.github/workflows/
  nitro-v1-codegen.yml       # isolated codegen, package checks and TypeScript
```

The preview is designed to use native **C++** as its portable Rust bridge on Android and Apple, rather than duplicating Rust document logic in Swift and Kotlin. Platform-specific SwiftUI/Compose editor views stay in the separate shared Expo UI layer. Nitro v1's visionOS/macOS/tvOS support is promising for future NitroForge adapters but not validated by this PR.

### Intended call site (not runnable until native backend exists)

```ts
import { ForgeFactory } from '@nitro-forge/ignition-v1-lab'

const factory = new ForgeFactory()
const document = await factory.open('prism')
try {
  await document.apply({ op: 'new', payload: { width: 512, height: 512 } })
  await document.apply({ op: 'addRasterLayer', payload: { name: 'Sketch' } })
  const bytes = await document.snapshot()  // NFD1 as ArrayBuffer
  await document.restore(bytes)
} finally {
  await document.close()                    // deterministic release, not GC-only
  factory.dispose()
}
```

**Do not import this private package into Moyo, NYC-MON, DVNT or the existing `apps/example` yet.** It is deliberately codegen-only so Nitro 0.x and v1 runtimes are never autolinked into the same native binary.

## Native ownership and performance gates

- `ForgeFactory` constructor must remain lightweight. `open` constructs a fully ready session asynchronously, with explicit failure and cancellation semantics.
- `ForgeDocument` owns one Rust `Engine` handle behind native RAII; `close` is idempotent; finalizer `dispose` releases it safely when not explicitly closed. Never let a stale callback dereference closed Rust state.
- Rust `u64` handle remains **native-only**; no pointer/number export. Use v1 `UInt64` only for supported, documented 64-bit domain values and test BigInt/Swift/Kotlin conversions.
- `nf-sys` currently holds the global registry lock while executing each `Engine` operation. To achieve per-document concurrency, refactor that owner boundary first; Promise-returning generated methods alone do **not** establish concurrency.
- C++ translates the typed outer `ForgeCommand` and its validated `payloadJson` to existing Rust JSON commands and validates `NFD1` data; memory and buffer ownership must match `nf_free_bytes`, `nf_free_string` and native `ArrayBuffer` destruction. Do not call unreviewed `nf_alloc_copy` or claim zero-copy without proof.
- Nitro v1's `AnyJSON` supports nested structured JS values but may allocate for large commands. Validate maximum payload size/recursion and compare against typed structs/byte-buffer operations. Don't route raw file paths, untrusted callbacks, arbitrary plug-ins or MCP commands from user documents.
- Preserve strict per-engine command behavior from `docs/ENGINE_OPS.md`, atomic undo/redo, `NFD1` snapshot migrations, errors, and bounded imports.

## Workstreams and mandatory evidence

| ID | Role | Implementable work | Evidence | Status |
| --- | --- | --- | --- | --- |
| V1-01 | API architect | v1 generated factory/document class signatures, typed commands and lifecycle | successful Nitrogen + TypeScript compile | IN PROGRESS |
| V1-02 | Package/release | isolate exact alpha runtime/generator version and generated `#nitro` exports; no v0 app mixing | frozen install/lock evidence | IN PROGRESS |
| V1-03 | C++/Rust engineer | implement generated HybridFactory/HybridDocument classes, real `nf-sys` open/edit/undo/save | C++ linking + Rust FFI engine corpus | NOT RUN |
| V1-04 | Rust concurrency | move engine execution off global registry lock into one owner per document | multi-doc race test + memory, close/cancel | NOT RUN |
| V1-05 | iOS native | Swift 6/C++ framework/CocoaPods/SwiftPM or verified integration, Metal build | iPad/iOS simulator & device test logs | NOT RUN |
| V1-06 | Android native | Kotlin/C++/CMake JNI, app lifecycle, Vulkan 1.1 on real device | Android Gradle + physical tablet/Duo | NOT RUN |
| V1-07 | Web runtime | equivalent WASM document-session implementation independent of Nitro native | browser create/edit/save/reopen, SSR | NOT RUN |
| V1-08 | Graphics | test Prism bytes into Skia **v3** Graphite without hidden buffering/copies | CPU/GPU parity, Dawn, pixel/memory traces | NOT RUN |
| V1-09 | Compatibility/QA | preserve seven engine APIs, Moyo-independent SDK package, device regressions | existing Ignition CLI tests + consumer install | NOT RUN |
| V1-10 | Security/release | reject malformed command, oversized bytes, handle reuse, memory lifetime; semver and rollback | audit + device CI + signed release | NOT RUN |

## Skills used and release guidance

- [Margelo API Design](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md): factory returns ready resource, no half-initialized sessions, explicit async errors, direct public API and ownership.
- [Build Nitro Modules](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md): codegen exact generated signatures, C++ implementation, native C ABI and real packaged example.
- [C++](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/cpp/SKILL.md), [Swift](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/swift/SKILL.md), [Kotlin](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md): RAII, single-owner queue/worker, Swift/Android native lifecycle; no duplicated business logic.
- [Expo Overview](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-overview/SKILL.md), [Expo Upgrade](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-upgrade/SKILL.md) and [Callstack RN performance](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md): keep Expo SDK58/RN0.88, no v0/v1 autolink mix, device proof and memory.
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md): precise statuses and verifiable result.
- The [Moyo foldable skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md) remains required when native editor views actually mount across tablets, Surface Duo and resized windows; this PR changes no UI.

## PR exit and promotion gates

1. CI confirms **exact v1 alpha package available**, Nitrogen code-generation produces two classes, TS6 typechecks, and stable Ignition typecheck remains passing.
2. In separate implementation PR, write/link generated C++ bindings and an isolated v1 Expo developer app; compile iOS and Android. Package generated code and native binaries for external consumers.
3. Prove iOS/Android/Web actual create → edit → undo/redo → `NFD1` save → reopen, with malformed-input negatives, race tests and retained resources.
4. Benchmark JSON-vs-typed commands and base64-vs-ArrayBuffer, plus actual Skia v3 render; report measured speed/memory instead of guessing gains.
5. Only then assess switching `@nitro-forge/ignition` to v1 as a **reviewed, versioned compatibility migration**. A prerelease is not an automatic production dependency upgrade.

