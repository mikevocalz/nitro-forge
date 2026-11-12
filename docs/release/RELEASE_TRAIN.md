# NitroForge SDK release train: GitHub Release tarballs and npm dependency freshness

**Status:** specification plus scripts; no release tarballs, ABI binaries or platform-specific editor renderers have been published from this PR. Existing Ignition Rust/`nf-cli` test evidence is recorded separately in `docs/ROSTER.md`.

## Invariants
- **Distribution is GitHub Release tarballs only**, the same model as NYC-Tron UI `v0.1.0-alpha.1`: each release attaches one `pnpm pack` tarball per package (built and verified by `pnpm run check:packages`) plus `SHA256SUMS`. Forge never publishes to npm. In this document npm is read-only: the registry is where third-party dependency freshness is checked.
- NitroForge owns a **standalone SDK repo**, public API and release train. Moyo, NYC-MON, DVNT, Pa'Casa, Harlem Might and outside consumers install pinned release tarballs by URL and verify them against `SHA256SUMS`. No consumer source copies.
- The seven `@nitro-forge/{prism,cadence,splice,folio,pitch,tally,quill}` engine packages and `@nitro-forge/ignition` remain headless. A future `@nitro-forge/renderer-skia`, `native-ui`, `adaptive-layout`, `editor-ui` are independently installable optional dependencies. A headless consumer does not pay for Skia, Expo or bundled editors.
- Native renderer requires **`react-native-skia` v3 Graphite**, `react-native-webgpu` compatible matching Dawn; never `@shopify/react-native-skia` v2. Keep Expo SDK and RN versions as an admitted, tested family.
- “Latest npm” has two meanings: `npm dist-tag latest` (available) and **latest admitted compatible** with Expo/RN/Nitro/Dawn (safe to install). Check both; a new registry tag is not a blank check to break a working app.

## Present scope

| Package/class | Current repo state | Release-ready? | Main blocker |
| --- | --- | --- | --- |
| `@nitro-forge/ignition` | TypeScript host + HybridObject spec | NO | Nitrogen/native bridge, tarball content/exports |
| Seven typed Rust engine APIs | Existing Rust/`nf-cli` tests recorded | NO | published artifacts/native/iOS/Android/web WASM |
| Expo sample | SDK54 originally on master; PR #1 targets SDK58/Skia3 | NO | regenerate lock, native linkage, iOS/Android/Web runtime |
| `@nitro-forge/renderer-skia` | planned | NO | Skia3 implementation/device proof |
| `@nitro-forge/native-ui` / adaptive layout | planned | NO | extracted shared Moyo/Expo UI and styling |
| `@nitro-forge/editor-ui` | planned design | NO | dock/inspector/editor work across platforms |
| ArtCraft adapters | observed candidate sources only | NO | license, source-admission, commands/native/WASM tests |

## Actual scripts in this PR
- `tooling/release/audit.mjs --offline`: list every package app/workspace manifest and version-auditable dependencies without network.
- `tooling/release/audit.mjs --registry`: compare direct package declarations against live npm **latest** tags, write a human review report. No npm dependency is installed, changed or auto-updated.
- `tooling/release/audit.test.mjs`: four Node built-in tests for spec parsing, latest comparison, numeric semver order and workspace distinction.
- `tooling/release/check-package-boundaries.mjs`: fail closed if headless engine production dependencies import Expo, Skia, React or Moyo packages; requires original engine names and ignition contracts. Reject old Shopify Skia dependency and non-v3 when a renderer package declares Skia.
- `.github/workflows/sdk-release-readiness.yml`: Node-only PR checks, weekly/manual npm report with artifact. It does **not** publish releases or auto-merge package updates.

### npm audit nuances
- `--registry` reports versions from npm's latest dist-tag; pre-release tags and unusual ranges require human investigation. npm `latest` cannot prove Expo SDK compatibility, native Autolinking, iOS deployment support or exact Dawn binary parity.
- PR #1 already includes Dependabot config for daily npm/Cargo dependency update **proposals**. Pair Skia and WebGPU updates in one reviewed PR and regenerate `pnpm-lock.yaml`. Don't create a parallel unattended npm update bot here.
- Explicitly reject v2 `@shopify/react-native-skia` coinstallation; Skia v3 uses new `react-native-skia` import/Graphite. Expo Go includes v2 and cannot be the proof environment.
- Do not pin latest package versions in this doc without a registry query and compatibility test. Repeat audit before each release and attach report.

## Role roster and ownership

| ID | Role | Artifact/deliverable | Required proof | Status |
| --- | --- | --- | --- | --- |
| REL-01 | Dependency manager | npm latest inventory, coherent Expo/RN/Skia3/WebGPU/Nitro group, fresh lock | full review report, frozen install | CHECK TOOL PROPOSED; install NOT RUN |
| REL-02 | Native ABI maintainer | Nitrogen-generated C++/Swift/Kotlin binding to `nf-sys`, stable source/binary ABI | iOS/Android app tests | PLANNED |
| REL-03 | Rust formats owner | correct Ignition `NFD1` and native source version migrations | fixture corpus, undo/snapshot parity | PLANNED |
| REL-04 | Web WASM maintainer | headless Rust WASM/worker runtime with real browser import/export | browser demo + performance | PLANNED |
| REL-05 | GPU lead | Skia v3 Graphite renderer, Dawn compatibility, bounds/CPU parity | real Metal/Vulkan logs, pixel diff | PLANNED |
| REL-06 | UI lead | native Expo UI, shared Tailwind v4, adaptive panes, Mobbin-reviewed original suite | iOS/Android/web Storybook + device | PLANNED |
| REL-07 | Licensing/security | crate and upstream notices, source provenance, archive/image bounds and sandbox | SBOM, risk disposition, malformed-file tests | PLANNED |
| REL-08 | Packaging | tarball exports/types/source maps/d.ts, native binaries, Podspec/Gradle config, web assets | `pnpm pack` tarballs attached to a GitHub Release, installed by URL in clean external apps | PLANNED |
| REL-09 | Versioning | semver, changelog, ABI/feature manifest, rollback and signing | release candidate checks and provenance | PLANNED |
| REL-10 | Moyo integrator | Moyo Business native/Next.js import of same SDK/UI | cross-app offline/file/permissions suite | PLANNED |
| REL-11 | Second app integrator | NYC-MON or DVNT use same release without importing Moyo code | separate app build/device evidence | PLANNED |
| REL-12 | QA/release manager | staged rollout, upgrade/rollback, performance and customer data lifecycle | real release checklist and archived artifacts | PLANNED |

## Release procedure (not yet executed)
1. Run npm registry audit; classify new stable versions and native graph changes. Handle security updates quickly but not without tests.
2. Commit audited package manifest and `pnpm-lock.yaml` together. `pnpm install --frozen-lockfile` must pass without ignored peer errors or dual Dawn.
3. Run `node tooling/release/check-package-boundaries.mjs`, Rust workspace tests, `pnpm -r test`, `pnpm -r typecheck`, package build, source license/SBOM and native codegen.
4. For each selected engine, verify opening, mutation, undo/redo, NFD1 snapshot, reopen, export and corrupt-source handling through the **release tarball**, not a workspace path.
5. Validate iOS/Android native development builds on actual hardware, plus web WASM and Skia CanvasKit as appropriate. Verify device availability and list unsupported environments.
6. Package and install `@nitro-forge/ignition`, one engine and optional UI/render packages into two clean example apps with no monorepo aliases. Confirm host auth/storage remain external dependencies.
7. Tag a semver GitHub Release with changelog, upstream source SHA provenance, build receipts, compatibility feature manifest and rollback steps. Attach the tarballs and `SHA256SUMS` only after approval. Never `npm publish`.
8. Each consumer moves its pinned tarball URLs and hashes in its own PR (Dependabot and Renovate do not track URL tarballs), canaries a safe app, then rolls out across Moyo, NYC-MON, DVNT and others after independent CI/device checks. No mandatory same-day upgrade on incompatible apps.

## Dependency baseline, 2026-11-11 (gate F1)

Checked against npm and crates.io on 2026-11-11. Every row is either bumped in this branch or held with its reason. React Native stays on 0.88.1; 0.89 is a release candidate only and is held.

### Bumped

| Dependency | From | To | Notes |
| --- | --- | --- | --- |
| Nitro v1 trio (`react-native-nitro-modules`, `nitro-core`, `nitrogen`) | nightly.120 (`g33ef045b96c0`) | nightly.136 (`gdb81de61bd32`, `alpha-nightly`) | Upstream diff is 8 commits: Kotlin struct equality without boxing, Swift enum cases starting with a digit, `open` Android view managers, release tooling. No runtime source change in `react-native-nitro-modules` or `nitro-core`. Regenerated `packages/ignition` and `native/persona/nitro` bindings are byte-identical to the committed nightly.120 output. |
| pnpm | 12.16.1 (root), 10.32.1 (`examples/native-cadence`) | 12.18.0 everywhere | The standalone native-cadence lockfile was re-resolved because pnpm 12 rejects the pnpm 10 lockfile (tarball entries without `integrity`). |
| expo / expo-router / @expo/ui | 58.0.23 / 58.0.30 / 58.0.27 | 58.0.24 / 58.0.31 / 58.0.28 | Patches renamed unchanged; `@expo/metro-file-map` moved 58.0.5 to 58.0.6 with it (see `docs/native/METRO_FILE_MAP_PORT.md`). |
| expo-constants, expo-linking | 58.0.15, 58.0.16 | 58.0.16, 58.0.17 | Peer floors of expo-router 58.0.31. |
| expo-asset, expo-dev-client, expo-haptics, expo-linear-gradient, expo-sensors, expo-status-bar | SDK 58 patch releases | latest 58.x | |
| react, react-dom | 19.3.0 and 19.3.1 mixed | 19.3.1 | |
| uniwind | 1.13.1 and 1.13.2 mixed | 1.13.2 | |
| react-native-gesture-handler | 3.4.0 | 3.5.0 | Still a deliberate deviation from SDK 58's bundled ~3.3.0; `verify-native-host.cjs` now names 3.5.0. Peer range `>=3.4.0 <4` unchanged. |
| turbo | 2.11.10 | 2.11.11 | |
| typescript | 5.9.3 (spatial-ink), 6.0.3 (adaptive-layout, labs, native-cadence) | 7.0.2 | Matches the root. |
| vitest | 3.2.7 (agpl-speed-curve, audio-ui, media-ui, spatial-ink) | 5.1.0 | Matches the root. |
| tailwindcss, @tailwindcss/vite, vite, @babel/parser, zustand, @webgpu/types | 4.3.4, 4.3.4, 8.3.5, 8.1.0, 5.0.16, 0.1.21 | 4.3.5, 4.3.5, 8.3.8, 8.1.2, 5.1.0, 0.1.74 | |
| Rust lockfile | | `cargo update` | 25 semver-compatible updates (cc, flate2, libc, syn, the wasm-bindgen family, zip 2.4.2 to 2.6.1 and others) and 5 removed transitive crates (bitflags 1, defmt x3, displaydoc). |

### Held

| Dependency | Held at | Latest | Reason |
| --- | --- | --- | --- |
| react-native | 0.88.1 | 0.89 RC | Release candidate only. |
| react-native-skia + react-native-webgpu | 3.9.1 + 0.21.0 | 3.10.0 + 0.21.3 | Both move Dawn 157.1.0 to 158.0.0 together; the Graphite/Dawn family needs an iOS and Android build of `apps/example` and NYC-Tron's T1 result on 3.10.0 before it moves. |
| react-native-svg | 15.16.0 | 15.16.1 | 15.16.1 ships its own `Package.swift`, which collides with the local SwiftPM patch; adopting it needs an iOS SwiftPM build. |
| react-native-video (vendored `experimental-build-v1.tgz`) | generated with nightly.120 | n/a | Third-party artifact with recorded provenance. A workspace override keeps it on the nightly.136 runtime; regenerating it needs the upstream checkout in `tooling/react-native-video-v1/README.md`. |
| quick-xml | 0.37.5 | 0.42.0 | RUSTSEC-2026-0194 and -0195 (denial of service). 0.42 changes `name()`, `unescape()` and `decode()`; Tally fails with 12 compile errors and Quill with 29. Needs an engine PR for the XLSX and DOCX readers. |
| lopdf | 0.36.0 | 0.47.0 | RUSTSEC-2026-0187 (stack overflow on deeply nested objects). 0.47 compiles after 3 call-site fixes but fails 8 of 149 folio-engine tests, including all three encrypted round-trip tests. Needs an engine PR. |
| zip | 2.6.1 | 9.5.1 | RUSTSEC-2026-0367, -0368, -0369, -0429. All four are in `ZipArchive::extract` / `ZipStreamReader::extract`, which no Forge crate calls (Tally and Quill read entries by name). The 2-to-9 migration goes with the quick-xml engine PR. |
| harfrust, moxcms, skrifa, rand, sha2, md-5 | current majors | newer majors | Semver-major crate releases; outside `cargo update` and not flagged by `cargo audit`. |

## Skills and standards
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md) + [Everything Claude Code verification loop](https://github.com/WorldFlowAI/everything-claude-code/blob/432485ba6b92c14fb357276a98957f348bcff9ee/skills/verification-loop/SKILL.md).
- [Expo overview/upgrade](https://github.com/expo/skills/tree/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills) and [Callstack upgrading RN](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/upgrading-react-native/SKILL.md).
- [Margelo build Nitro Modules](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md); [React Native Skia v3 migration](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/) and [WebGPU Dawn compatibility](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia).
- [Moyo shared UI source and foldable skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md), [Argent device testing](https://github.com/software-mansion/argent/blob/1a17fd5755247b540b3f812e7e4b736c33c74c40/packages/skills/skills/argent-device-interact/SKILL.md).

### Status and limitations
Only manifest inspection and npm audit scripts are included here. They do not upgrade any package, rebuild Nitro, create native binaries, or cut a release. Need CI to verify the offline tests, then additional implementation PRs for packaging and native execution.
