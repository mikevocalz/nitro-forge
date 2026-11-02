# NitroForge SDK publishing, npm freshness and multi-app release train

**Status:** specification plus scripts; no npm artifacts, ABI binaries or platform-specific editor renderers have been published from this PR. Existing Ignition Rust/`nf-cli` test evidence is recorded separately in `docs/ROSTER.md`.

## Invariants
- NitroForge owns a **standalone SDK repo**, public API and release train. Moyo, NYC-MON, DVNT, Pa'Casa, Harlem Might and outside consumers install signed/reproducible packages. No consumer source copies.
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
| REL-08 | Packaging | npm exports/types/source maps/d.ts, native binaries, Podspec/Gradle config, web assets | `pnpm pack` and install in clean external apps | PLANNED |
| REL-09 | Versioning | semver, changelog, ABI/feature manifest, rollback and signing | release candidate checks and provenance | PLANNED |
| REL-10 | Moyo integrator | Moyo Business native/Next.js import of same SDK/UI | cross-app offline/file/permissions suite | PLANNED |
| REL-11 | Second app integrator | NYC-MON or DVNT use same release without importing Moyo code | separate app build/device evidence | PLANNED |
| REL-12 | QA/release manager | staged rollout, upgrade/rollback, performance and customer data lifecycle | real release checklist and archived artifacts | PLANNED |

## Release procedure (not yet executed)
1. Run npm registry audit; classify new stable versions and native graph changes. Handle security updates quickly but not without tests.
2. Commit audited package manifest and `pnpm-lock.yaml` together. `pnpm install --frozen-lockfile` must pass without ignored peer errors or dual Dawn.
3. Run `node tooling/release/check-package-boundaries.mjs`, Rust workspace tests, `pnpm -r test`, `pnpm -r typecheck`, package build, source license/SBOM and native codegen.
4. For each selected engine, verify opening, mutation, undo/redo, NFD1 snapshot, reopen, export and corrupt-source handling through the **published** artifact, not a workspace path.
5. Validate iOS/Android native development builds on actual hardware, plus web WASM and Skia CanvasKit as appropriate. Verify device availability and list unsupported environments.
6. Package and install `@nitro-forge/ignition`, one engine and optional UI/render packages into two clean example apps with no monorepo aliases. Confirm host auth/storage remain external dependencies.
7. Tag semver release with changelog, upstream source SHA provenance, build receipts, compatibility feature manifest and rollback steps; publish artifacts only after approval.
8. Let Dependabot/Renovate open **consumer** version-bump PRs, canary a safe app, then roll out across Moyo, NYC-MON, DVNT and others after independent CI/device checks. No mandatory same-day upgrade on incompatible apps.

## Skills and standards
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md) + [Everything Claude Code verification loop](https://github.com/WorldFlowAI/everything-claude-code/blob/432485ba6b92c14fb357276a98957f348bcff9ee/skills/verification-loop/SKILL.md).
- [Expo overview/upgrade](https://github.com/expo/skills/tree/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills) and [Callstack upgrading RN](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/upgrading-react-native/SKILL.md).
- [Margelo build Nitro Modules](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md); [React Native Skia v3 migration](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration/) and [WebGPU Dawn compatibility](https://wcandillon.github.io/react-native-webgpu/docs/integrations/react-native-skia).
- [Moyo shared UI source and foldable skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md), [Argent device testing](https://github.com/software-mansion/argent/blob/1a17fd5755247b540b3f812e7e4b736c33c74c40/packages/skills/skills/argent-device-interact/SKILL.md).

### Status and limitations
Only manifest inspection and npm audit scripts are included here. They do not upgrade any package, rebuild Nitro, create native binaries, or release to npm. Need CI to verify the offline tests, then additional implementation PRs for packaging and native execution.
