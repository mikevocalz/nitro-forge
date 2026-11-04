# Skia v3 (Graphite) is mandatory

**Status:** package manifest/configuration migration requested on 2026-11-02; device/runtime verification and pnpm lock regeneration pending. Do not treat this document as a passing native build.

## Canonical packages

- `react-native-skia@3.8.1` — the modern **unscoped** package; Graphite backend.
- `react-native-webgpu@0.19.2` — matching Dawn-compatible pairing.
- Expo SDK 58 / RN 0.88 / React 19.3, aligned to Moyo's current cross-platform baseline.
- `@expo/ui` native-backed controls and the existing multi-platform styling adapters belong to the UI package; the headless Rust engines must remain UI-independent.

The older `@shopify/react-native-skia` package stops on 2.x and **must not coexist** with `react-native-skia`: both register the same native module. Never downgrade this repository to Skia 2 or substitute the v2 `@next` preview to make a build green.

Canonical upstream docs:
- [Skia v3 migration](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/)
- [Skia v3 release 3.8.1](https://github.com/wcandillon/react-native-skia/releases/tag/v3.8.1)
- [WebGPU integration compatibility](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia)
- [React Native WebGPU 0.19.2](https://github.com/wcandillon/react-native-webgpu/releases/tag/v0.19.2)
- [Expo SDK 58 upgrade](https://expo.dev/blog/how-to-upgrade-to-sdk-58)

## Requirements

1. Android `minSdkVersion >= 26`, **compileSdkVersion 37** for Expo 58 asset/filesystem/font/keep-awake AAR metadata, targetSdkVersion 36 until a separately reviewed target-behavior upgrade, Vulkan **1.1** capable GPU, native Gradle rebuild. Compile SDK 37 does not require installing API 37 on consumer devices, and Vulkan capability is device-specific.
2. iOS **16.4+** for Expo SDK 58 (Skia's standalone minimum is 15.1), Metal, rebuilt native dependencies. Because Expo Go bundles legacy v2, use **custom development builds** for v3.
3. Dawn must resolve to **one** version of `react-native-webgpu-dawn`, and `react-native-skia` + `react-native-webgpu` must use a compatible release pair. Skia 3.7+ pairs with WebGPU 0.17+; current pin is 3.8.1 + 0.19.2.
4. Web must load Skia's supported CanvasKit Web path. Browser support is a separate validation gate from iOS/Android Graphite.
5. Migrate imports to `react-native-skia` and update removed Canvas/snapshot/native-buffer APIs before adopting v3 in an existing application.
6. The engine/render boundary is not automatically zero-copy with Rust `wgpu`. Shared Dawn is verified for compatible React Native Skia/WebGPU libraries; verify Rust interoperability independently.

## Local commands and release audit

```sh
corepack enable
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm check:skia-v3
pnpm --filter @nitro-forge/example typecheck
pnpm --filter @nitro-forge/example start
# Use a native development build, not Expo Go:
pnpm --filter @nitro-forge/example exec expo run:ios
pnpm --filter @nitro-forge/example exec expo run:android
pnpm why react-native-webgpu-dawn   # inspection only; exits 0 even with duplicates
```

`pnpm check:skia-v3` is the Dawn gate: it fails when `pnpm-lock.yaml` resolves more than one `react-native-webgpu-dawn` version, or when `node_modules/.pnpm` holds more than one after an install. The scheduled `--registry` run reports npm drift in the run summary and a tracking issue; it does not fail, and the pins move only through a dependency PR that bumps Skia and WebGPU together.

**Dependency status:** GitHub Actions generated and committed an updated `pnpm-lock.yaml` and verified a frozen install ([CI run 41458549938](https://github.com/mikevocalz/nitro-forge/actions/runs/41458549938)). Android API 37 native compilation, Xcode linking, Skia v3 pixel output and real-device behavior still require separate evidence. Do not treat a frozen dependency install as a working native renderer. Test native codegen, architecture-specific artifacts, Skia scenes, GPU memory, actual devices, web bundling and Moyo integration separately. The runtime engine bridge is currently not implemented.

Run `node tooling/check-skia-v3.mjs` offline for the package policy. The scheduled GitHub Actions gate also uses `--registry` to compare pinned versions with the latest npm publications. A new npm release triggers a **review/update PR**, not an unverified auto-upgrade.

## Consumer apps

Moyo, DVNT, NYC-MON and other consumers must upgrade their own rendering dependencies through app-specific PRs. Moyo currently has `@shopify/react-native-skia` in its lockfile/catalog, so **NitroForge's v3 manifest does not mean Moyo is migrated**. Track and test that separately; never install v2 and v3 side-by-side in one host app.
