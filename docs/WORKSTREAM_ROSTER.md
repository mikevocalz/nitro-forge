# NitroForge delivery roster — open work, dependencies and acceptance

SOT-KEYWORDS: roster native skia studio ui upsteam verification artcraft meta mobbin release

The repository's `docs/ROSTER.md` records **actual existing Ignition engine evidence**. This document is a forward-looking workstream roster for new platform/editor work. It is NOT proof of tests, staffing, device availability or deliverables.

### Status vocabulary
- `COMPLETE (evidenced)`: implementation and its required tests were run and linked at the PR SHA.
- `IN PROGRESS`: working code exists but at least one acceptance gate remains.
- `PLANNED`: scope is approved but implementation not started.
- `BLOCKED`: missing tooling/license/device/provider review or failing tests.
- `NOT RUN`: validation absent or not yet executed. Never count as pass.

| ID | Lead expertise / reviewer | Workstream and exact deliverable | Dependencies | Exit evidence | Initial status |
| --- | --- | --- | --- | --- | --- |
| NF-00 | Architect / SDK maintainer | Maintain `Ignition` trait, `NFD1` snapshots, public API compatibility matrix | existing engines | contract/ABI tests + migration notes | existing baseline only |
| NF-01 | Dependencies / CI | Upgrade Expo sample to SDK58/RN0.88 and pinned Skia v3; regenerate lockfile; npm latest audit | PR #1 | frozen pnpm install; matching Dawn resolution; CI artifacts | IN PROGRESS, PR #1 draft |
| NF-02 | Graphics / GPU reviewer | `@nitro-forge/renderer-skia` v3 Graphite scene with canvas, CPU reference fallback, snapshot and device loss | NF-01 | iOS Metal/Android Vulkan device screenshots, web rendering and pixel/perf traces | PLANNED |
| NF-03 | Native C++/Rust reviewer | Generate/link Nitro HybridObject to `nf-sys` with safe handles and bounded queues | NF-01 | successful native builds and open/edit/undo/save/reopen tests | PLANNED |
| NF-04 | Web/WASM engineer | Compile/embed Ignition Rust engines behind worker/typed bridge | NF-00 | real WASM test and browser document round-trip | PLANNED |
| NF-05 | UI system + accessibility | Extract shared `@expo/ui` native controls from Moyo into product-neutral UI package, theme adapter | skills PR and Moyo review | shared source parity, screen reader and iOS/Android/web UI fixtures | PLANNED |
| NF-06 | Adaptive layout engineer | Pane system, Meta compatibility verification, Expo Modules 2 fold bridge, inspector and reserved regions | NF-05 | 18 foldable fixtures + Surface Duo real-device data, iPad resize, web layouts | PLANNED |
| NF-07 | Design/UX lead | Stable Studio shell and editor manifests consistent across Prism/Quill/Tally/Pitch/etc | NF-05, NF-06 | visual references, Storybook fixtures, keyboard/touch/RTL focus | PLANNED |
| NF-08 | UI interaction/gesture engineer | Dock/rail drag, resize, collapse, tab-stack, float where supported, presets | NF-07 | keyboard/touch/pointer tests, screenshot/geometry and layout restore | PLANNED |
| NF-09 | Graphics/geometry engineer | Document object snapping in Prism/Pitch/others with engine-backed operations | NF-02, NF-07 | guides/grid/edge accuracy, undo and export invariants | PLANNED |
| NF-10 | Source security/licensing reviewer | ArtCraft candidates: full license/transitive crates audit, pinned source inventory | NF-00 | exact SHA/NOTICE manifests and source admission reports | PLANNED |
| NF-11 | Rust integration lead | ArtCraft optional adapters into existing engine contract, no replacement or API drift | NF-10 | real operations, snapshot compatibility and feature matrix | PLANNED |
| NF-12 | Release/DX maintainer | Build provenance, npm publishable packages, semver and consumer update automation | NF-02–NF-11 | tarball contents, proven native binaries/web files, downstream install tests | PLANNED |
| NF-13 | Cross-app owners | Moyo, NYC-MON, DVNT, Pa'Casa/Harlem Might adapter smoke tests | NF-12 | per-host CI/mobile/web runs; no cross-tenant leakage | PLANNED |
| NF-14 | Quality lead / security | Attack malformed documents, memory pressure, FFI panic, async cancellation, accessibility and rollback | all | fuzz/negative tests, device logs and documented risk dispositions | PLANNED |

### PR dependency/order
1. Skills and evidence policy (this PR).
2. Skia v3 dependency PR #1 must be lockfile/native-build verified; do not silently merge new version pins.
3. Native Nitro/Graphite, independent web WASM and UI foundation can proceed in parallel after their prerequisite compatibility assessments.
4. Studio shell, rail interactions, and ArtCraft admission follow explicit contracts and separate test proof.
5. Publish only after two real consumer integration tests across native and web have passed.

### Required evidence packet in every implementation PR
- **Contract:** existing file/command names, new operations, input schema, ownership, supported format and feature flags.
- **Skills:** full pinned files actually read and relevant references. Link this roster.
- **Changes:** scoped file-by-file summary, generated code and external dependency hashes.
- **Validation:** commands + results + commit SHA, CI links, Apple/Android/browser device details, screenshot/media or memory trace links.
- **Security:** malformed/oversized input behavior, token/provider isolation, resource lifetime, cancellation and thread safety.
- **Accessibility/adaptive:** keyboard, input method editor, touch, focus, screen reader, RTL, reduced motion, hinge and shrink/expand.
- **Release:** version compatibility matrix, npm lock integrity, semver, rollback and declared unsupported platforms.

### Known blockers at kickoff
- `apps/example` still lacks functional native Nitrogen-generated implementation and physical GPU editor validation.
- PR #1 is draft; version pins without a regenerated pnpm lockfile cannot prove a frozen install.
- ArtCraft candidate projects are not source-admitted NitroForge engines.
- UI extraction from Moyo, component ownership, platform parity and licensing require separate reviewed PRs.
- Web-based preview or test-fixture results cannot substitute for actual native Expo UI Compose/SwiftUI and Skia device tests.
