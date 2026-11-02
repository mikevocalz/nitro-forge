# @nitro-forge/react-native

App-neutral **native transport** for NitroForge's seven Ignition Rust document engines (Prism, Cadence, Splice, Folio, Pitch, Tally and Quill).

**Status:** private pre-release, NOT published or production-ready. This package is being promoted from the isolated `ignition-v1-lab` prototype in stacked PRs #8–#10. Do not install it in Moyo, NYC-MON, DVNT or another production native host yet.

## Public API (target)

```ts
import { ForgeFactory } from '@nitro-forge/react-native';

const factory = new ForgeFactory();
const doc = await factory.open('tally');
try {
  await doc.apply({ op: 'new', payloadJson: '{}' });
  await doc.apply({ op: 'setCell', payloadJson: '{"addr":"A1","value":"42"}' });
  const snapshot: ArrayBuffer = await doc.snapshot();
  await doc.restore(snapshot);
} finally {
  await doc.close();
  factory.dispose();
}
```

The package exposes the **generated** `ForgeFactory` and `ForgeDocument` classes directly, rather than a second JavaScript wrapper. `ForgeDocument` owns native state. Rust `u64` session handles never surface as JavaScript numbers. The NFD1 snapshot uses an owning `ArrayBuffer`, not a base64 snapshot string. The heterogeneous command payload still uses `payloadJson` because the tested Nitro v1 prerelease did not generate nested `AnyJSON` structs.

The package is **headless and unbranded**: it owns no Expo UI, Tailwind themes, navigation, Better Auth provider, business storage, or Moyo component. Other NitroForge packages can supply shared responsive native UI independently.

## Source and versions

- [Margelo Nitro v1 alpha](https://github.com/margelo/nitro/releases/tag/v1.0.0-alpha.nightly.115.gcdaf72e60229) — exact source-pinned code generator/native API, prerelease
- `nitro-core`, `nitrogen`, `react-native-nitro-modules` must all resolve to `1.0.0-alpha.nightly.115.gcdaf72e60229`
- The current SDK host target is Expo SDK 58 / RN 0.88. Nitro v1 is **not** installed alongside the legacy 0.x Nitro runtime in one app
- Rust/C ABI is maintained in `rust/nf-sys` with per-document locking and source/type parity across the seven engines
- Skia v3 Graphite remains a **separate rendering package**; no GPU texture interoperability is implied by this transport

## Development checks

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @nitro-forge/react-native codegen
pnpm --filter @nitro-forge/react-native typecheck
node tooling/nitro-v1/verify-generated.mjs
cargo test --workspace --locked
```

The repository's CI also compiles the new C++ session adapter and checks actual v1 generated class signatures. Codegen and Linux C++/Rust passing **do not** establish a working mobile module. Generated native bindings must be packaged alongside Apple/Android build registration and the Rust staticlib.

## Release blockers

- Correct iOS Xcode/SwiftPM/Podspec link and Android Gradle/CMake/JNI autolinking from a **clean external Expo 58 development app**
- Real JavaScript-to-native `new ForgeFactory().open(...)` execution on iOS/Android; no WebView editor
- Binary NFD1 round-trip, resource lifetime, malformed-input, concurrent-close and physical-device memory benchmarks
- Web/WASM supported by a **separate** adapter; do not load native Nitro into SSR or browser
- npm `pack` / clean external consumer install after packaging native artifacts, generated JavaScript and type declarations
- Licenses, NOTICE/SBOM review, semver compatibility, and real device QA

Refer to [Nitro v1 design](../../docs/native/NITRO_V1_ALPHA.md) and [C++ bridge implementation](../../docs/native/NITRO_V1_CPP_BRIDGE.md). All tests must include their exact Git SHA and platform; `NOT RUN` is not `PASS`.
