# Agent-native phase 1.3: install order for a new studio

Status: read from `package.json` files, `tooling/`, `packages/ignition/scripts/`, `docs/native/NITRO_V1_HOST_INTEGRATION.md`, `.github/workflows/` and `apps/example`. No command here was run on this machine (4.9 GB free, no install allowed). Where a command comes from CI or a script, the source is named. UNVERIFIED marks a step the files do not settle.

Nothing here is published to npm. `compatibility.v1.json` records `distribution: github-release-tarballs`, `npm: not-used`, and no tag or release exists for the Forge packages. The engines, `ignition`, `studio-layout`, `editor-controls`, `studio-workspace` and `icons` are version `0.1.0` (`adaptive-layout` is `0.1.0-alpha.0` and `agpl-speed-curve` is `0.0.0-experimental`; the private root `package.json` says `0.0.0`). They resolve through `workspace:*`. A consumer outside this monorepo has no installable `@nitro-forge/ignition`, engine, `studio-layout` or `editor-controls` today.

## The chain

Each step needs the one above it. Step 7 fails at first render if step 6 is skipped, and every studio-workspace component throws without `StudioUIProvider` ("No substitute UI is installed").

| # | Step | Command or edit | Registry add can do it? |
|---|---|---|---|
| 0 | Toolchain | Node >=24.3.0, pnpm 12.18.0 (`packageManager`), Rust with `cargo`, Xcode for Apple, Android NDK and `cargo-ndk` for Android | No |
| 1 | `@nitro-forge/ignition` (native host) | see below | No (decision 4) |
| 2 | Engine package, for example `@nitro-forge/tally` | `workspace:*` dependency, Rust crate linked through `nf-sys` | No (decision 3) |
| 3 | `@nitro-forge/studio-layout` and `@nitro-forge/editor-controls` | `workspace:*` dependencies, private packages | No (decision 3) |
| 4 | `@nitro-forge/icons` | registry item `forge-icon` | Yes, plus peers |
| 5 | NYC-Tron tarballs | URL dependencies from `tooling/nyc-tron.json` | No for the packages, yes for registry items that wrap them |
| 6 | Theme CSS | generated `theme.css` or `theme.native.css`, plus an import | Files yes, build step no |
| 7 | `StudioUIProvider` and host | registry items `studio-ui-provider`, `nyc-tron-host` plus app code | Files yes, host wiring is app code |
| 8 | Studio components | registry items from `03-design-handoff.md` | Yes |

Registry mechanics (decision 28, corrected by decision 45): the built `r/*.json` files are committed in each repo and served from `raw.githubusercontent.com/<owner>/<repo>/<ref>/r/{name}.json`. `<ref>` is a moving branch (`master` for `@nitro-forge`, `main` for `@nyc-tron`) until the owner cuts release tags, then `node tooling/registry/set-ref.mjs <tag> [<tag>]` pins both. A consumer adds an item with `npx shadcn@latest add @nitro-forge/<item>`. The `@nyc-tron` items it depends on resolve only once NYC-Tron's `r/` is on its `main` branch. Pin the CLI version too (`npx shadcn@4.23.0`) if you need a reproducible install, because `@latest` moves. A live fetch from raw.githubusercontent.com has not been run. UNVERIFIED.

### Step 0. Toolchain

- Node >=24.3.0 and pnpm 12.18.0 come from the root `package.json` (`engines`, `packageManager`). CI runs `corepack enable && pnpm install --frozen-lockfile --ignore-scripts` on Node 24 (`.github/workflows/ignition-v1-integration.yml`).
- Rust: `cargo` is required for every native archive. The Apple script builds three targets (`aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`); install them with `rustup target add` (the script does not install them).
- Android: `ANDROID_NDK_HOME` must point at the NDK the Expo app uses, and `cargo-ndk` must be installed.
- The workspace pins one Nitro runtime for the whole graph: `react-native-nitro-modules` and `nitro-core` at `1.0.0-alpha.nightly.136.gdb81de61bd32` (`pnpm-workspace.yaml` overrides). Metro is pinned at 0.87.2 and ten dependencies carry pnpm patches (`patches/`). A consumer outside the monorepo needs the same pins. UNVERIFIED: whether a clean consumer app builds without the patches.

### Step 1. `@nitro-forge/ignition` (host, native module, Nitrogen output)

From the repo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nitro-forge/ignition codegen          # nitrogen; output is committed, regenerate only after a spec change
pnpm --filter @nitro-forge/ignition typecheck
pnpm --filter @nitro-forge/ignition exec vitest run tests/nitro-host.test.ts
cargo test --locked -p nf-sys && cargo build --locked -p nf-sys
```

Native archives, run before Expo prebuild or build (`docs/native/NITRO_V1_HOST_INTEGRATION.md`):

```bash
bash packages/ignition/scripts/build-apple.sh        # writes packages/ignition/native/ForgeRust.xcframework
ANDROID_NDK_HOME=/path/to/ndk bash packages/ignition/scripts/build-android.sh   # default ABIs: armeabi-v7a arm64-v8a x86 x86_64, platform 24
bash packages/ignition/scripts/build-android.sh arm64-v8a                       # a subset
```

Facts to know:

- `build-apple.sh` refuses to run if `native/ForgeRust.xcframework` already exists ("Remove the previous generated ... before rebuilding").
- The integration doc says the Apple archive covers arm64 iPhone and Apple Silicon simulators, not Intel simulators. The script builds `x86_64-apple-ios` and lipos it into the simulator slice. The script and the doc disagree. The script is the later source of truth; UNVERIFIED which is right on a real Intel simulator.
- iOS minimum is 16 (`Package.swift`, `IPHONEOS_DEPLOYMENT_TARGET=16.0`). The Expo example sets Android `minSdkVersion` 29. The Android script builds with `--platform 24`.
- Nitro v1 links through SwiftPM on Apple (`experiments.swiftPackageManager: true` in `apps/example/app.json`); the podspec `NitroForgeV1.podspec` is for React Native dependency discovery only.
- For tests without a device, `cargo build --locked -p nf-cli` builds the JSON-lines host (`@nitro-forge/ignition/cli`).
- Not run on this machine: Rust tests, Android NDK link, Xcode link, any device launch. The integration doc itself lists those as not run at integration time. UNVERIFIED on current commit.

### Step 2. Engine package

Add the package as a `workspace:*` dependency, for example `"@nitro-forge/tally": "workspace:*"` (`apps/example/package.json` shows all of them). Each engine package depends on `@nitro-forge/ignition` and has no install command of its own. The Rust side is already linked: `rust/nf-sys/Cargo.toml` depends on all 12 engine crates (prism, cadence, splice, folio, pitch, tally, quill, photo, motion, design, draft, scene), so the step 1 archive contains every engine. A new studio that needs one engine still ships all 12 in the archive. UNVERIFIED: whether a feature flag trims that.

Engine contract tests need `@nyc-tron/ui` as a devDependency (URL tarball); apps do not.

### Step 3. `@nitro-forge/studio-layout` and `@nitro-forge/editor-controls`

`studio-layout` is private, pure TypeScript, no build step (`"exports": {".": "./src/index.ts"}`). Used by `studio-workspace` (`model.ts`, `index.tsx`, `stage.tsx`, `app-manifest.ts`). Add `"@nitro-forge/studio-layout": "workspace:*"`. No tarball exists. Distribution is blocked on the versioning scheme in decision 3.

`editor-controls` holds the editor controls (audio, timeline, spreadsheet, layers, color, photo, motion, office and the rest), moved unchanged from NYC-Tron UI in #95. It is private and has 450 exports, one per file: import `@nitro-forge/editor-controls/<path>`, for example `@nitro-forge/editor-controls/layers/LayerStack`. Add `"@nitro-forge/editor-controls": "workspace:*"`. It needs `@nyc-tron/ui` from step 5 and the rc.2 export patch described in `packages/editor-controls/README.md`. Never import `@nyc-tron/ui/components/forge/*`; `pnpm verify:nyc-tron` fails on it. `prism-editor` needs this step for its layers panel.

### Step 4. `@nitro-forge/icons`

`workspace:*` today. Peers (all optional in the package, required in practice): `react` >=19, `react-native` >=0.81, `react-native-svg` >=15. The root patches `react-native-svg@15.16.0` (`patches/react-native-svg@15.16.0.patch`); the example and `studio-workspace` pin 15.16.0. Entry points: `@nitro-forge/icons` (catalog and glyph data, headless), `@nitro-forge/icons/native` and `/web` (the `ForgeIcon` component).

### Step 5. NYC-Tron tarballs

Seven packages pinned in `tooling/nyc-tron.json`, release `v1.0.0-rc.2` of `mikevocalz/NYC-Tron-UI`, commit `0e09d3be8263b3dbb2eab1a78e5dd66b83b68e44`. They are GitHub release assets, not npm packages. The URL pattern is:

```
https://github.com/mikevocalz/NYC-Tron-UI/releases/download/v1.0.0-rc.2/nyc-tron-<name>-1.0.0-rc.2.tgz
```

| Package | Used by |
|---|---|
| `@nyc-tron/ui` | `studio-workspace` (dependency), `apps/example`, engine devDependencies |
| `@nyc-tron/core` | `apps/example` |
| `@nyc-tron/expo-controls` | `apps/example` (Select, NativePopover, NativeActionMenu) |
| `@nyc-tron/reserved-regions` | `apps/example` |
| `@nyc-tron/platform-services` | pinned, not in `apps/example` dependencies |
| `@nyc-tron/native-controls` | pinned, named in cadence comments, not in `apps/example` dependencies |
| `@nyc-tron/hardware-keys` | pinned, not in `apps/example` dependencies |

Put the exact URL in the consumer's `package.json` (`"@nyc-tron/ui": "<url>"`). The sha256 for each file is in `tooling/nyc-tron.json` and in the release's `SHA256SUMS`. Checks:

```bash
pnpm verify:nyc-tron                                  # node tooling/verify-nyc-tron-pin.mjs: manifests and lockfile use the pinned URL
node tooling/verify-nyc-tron-pin.mjs --download       # also re-hashes the release assets
```

The pin check requires dependency sections to use the exact URL and peer ranges to be caret ranges the pinned version satisfies.

Optional dev link to a local NYC-Tron checkout: `withNycTronDevLink(config, { projectRoot })` from `tooling/nyc-tron-metro.cjs`, active only when `NYC_TRON_ROOT` is set. Native modules still come from the installed tarball.

Peer set `studio-workspace` also needs: `zustand` 5.1.0, `react-native-gesture-handler` >=3.4 <4, and `react-native-reanimated` >=4.7.1 <5 (the turret's native motion file imports it; the package marks it optional). The example pins gesture-handler 3.5.0, reanimated 4.7.1 and `react-native-worklets` 0.13.1.

### Step 6. Theme CSS

`packages/studio-workspace/src/theme.css` and `theme.native.css` are generated and committed. Regenerate after editing `theme.ts`:

```bash
pnpm --filter @nitro-forge/studio-workspace build:theme   # node build-theme.mjs
```

Then import the right file:

- Expo with Uniwind (`apps/example/global.css`): `@import 'tailwindcss';`, `@import 'uniwind';`, then `@import '../../packages/studio-workspace/src/theme.native.css';`. Metro config wraps Expo's config with `withUniwindConfig(config, { cssEntryFile: './global.css', dtsFile: './src/uniwind-types.d.ts', polyfills: { rem: 14 } })`.
- Web with Vite and Tailwind 4 (`apps/studio-preview/src/style.css`): `@import "tailwindcss" important;`, `@source` lines for `packages/studio-workspace/src`, `node_modules/@nyc-tron/ui/dist/components` and `node_modules/@nyc-tron/expo-controls/dist/components` (NYC-Tron publishes only `dist/`, so Tailwind must scan it), then `@import` of `theme.css`.

NYC-Tron ships no colours. Its components read the semantic variables the generated CSS declares (`--color-primary`, `--color-surface-raised`, `--color-border`, `--color-text` and the rest). Without this step the controls render without brand colour. A registry add can copy the CSS files but cannot run the generator or edit the app's CSS entry file.

### Step 7. `StudioUIProvider` and host

Provider and host mapping, from `apps/example/src/studio-ui.tsx` and `apps/example/app/_layout.tsx`:

```tsx
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ScopedVariables } from 'uniwind';
import { Select } from '@nyc-tron/expo-controls/Select';
import { NativePopover } from '@nyc-tron/expo-controls/NativePopover';
import { NativeActionMenu } from '@nyc-tron/expo-controls/NativeActionMenu';
import { nycTronStudioUI } from '@nitro-forge/studio-workspace/nyc-tron-host';

export const studioUI = nycTronStudioUI({
  View, Text, Pressable, Image, Select, ActionMenu: NativeActionMenu, NativePopover, GroupedSelect: Select,
  TokenScope: ({ variables, children }) => <ScopedVariables variables={variables}>{children}</ScopedVariables>,
  ScrollView: ScrollView as never, TextInput: TextInput as never,
});

// root layout
<StudioUIProvider components={studioUI}>{/* app */}</StudioUIProvider>
```

The example casts `ScrollView` and `TextInput` because React Native 0.88 types their refs as instance interfaces. The web host (`apps/studio-preview/src/studio-ui.tsx`) is the web counterpart and was not read for this document (UNVERIFIED).

### Step 8. Components

Only now do the registry items for studio chrome work: `forge-workspace`, `prism-editor`, `persona-turret` and the rest.

## Registry add versus tarball or native install

| Needs | Registry add | Tarball, workspace or native install |
|---|---|---|
| Copy `forge-workspace`, `prism-editor`, `persona-*`, `forge-directions`, `studio-theme` sources | Yes | |
| Copy `forge-icon`, `forge-icon-button`, `studio-ui-provider`, `nyc-tron-host` sources | Yes | |
| Install `react-native-svg`, `zustand`, gesture-handler, reanimated | Yes, as npm dependencies of the item | |
| Run `build-theme.mjs` | | Yes (a script, and it imports `theme.ts` directly) |
| Edit the app's CSS entry and Metro config | | Yes (app code) |
| `@nyc-tron/*` packages | Items declare `registryDependencies`; the packages themselves are GitHub tarball URLs | Yes |
| `@nitro-forge/ignition`: Nitrogen codegen, `ForgeRust.xcframework`, Android static archives, CMake, podspec, Swift package | | Yes (decision 4) |
| Engine packages and their Rust crates | | Yes (decision 3) |
| `@nitro-forge/studio-layout` | | Yes (decision 3) |
| `@nitro-forge/editor-controls` | | Yes (decision 3) |
| Quill, Tally, Splice and Prism binding adapters | Deferred | Need the engine facade first |
| Expo config plugin for brand identity (`tooling/brand/plugin.cjs`) | | Yes, not in registry scope |

Two items need a native prerequisite even though their own files are plain TypeScript. `prism-editor` imports `base64ToBytes` and `bytesToBase64` from the `@nitro-forge/ignition` package index, so a copy of it resolves only after step 1. `prism-editor` also imports `LayerStack` and the `LayerRow` type from `@nitro-forge/editor-controls` (step 3). `forge-workspace`, `forge-document-stage` and `studio-layout` consumers need `@nitro-forge/studio-layout` from step 3 for the `Studio` type and the dock model.

## Known gaps in the chain

- No document today gives these steps in order. This file is the first.
- Steps 1 to 3 cannot be reproduced outside the monorepo: no tarball or release exists for `ignition`, the engines, `studio-layout` or `editor-controls`.
- NYC-Tron's published `registry.json` (on its `agent-native-20261119` branch) still lists `forge/inputs/PrecisionScrubber` and has no `shell/PrecisionScrubber`, so `prism-editor`'s `@nyc-tron/shell/PrecisionScrubber` dependency does not resolve until NYC-Tron rebuilds its registry. `check-imports.mjs` reports it.
- The Apple archive script and the integration doc disagree on Intel simulator support (step 1).
- Seven NYC-Tron packages are pinned; the example installs four. Which of the other three a new studio needs is not stated in the repo. UNVERIFIED.
