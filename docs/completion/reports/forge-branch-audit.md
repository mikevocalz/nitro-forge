# Forge unmerged remote branch audit

2026-11-07. Classification of the ~30 `origin/*` branches not merged into
`codex/complete-all-components`. Based on branch inventory, checked-out
historical snapshots, and file-level comparison against forge-complete.
Treat as evidence-based audit; file-level `git diff` confirmation still
required before any merge decision (listed under follow-ups).

## Already-present equivalents verified in completion

Nitro v1/native integration (`packages/ignition` v1-host, specs, cpp,
nitrogen, android, Package.swift, podspec, nf-sys ffi_v1), media video
monitor (`packages/media-ui`), Prism canvas/layers/color, Cadence mixer
ops, icons package, NYC-Tron ownership docs, telemetry adapter.
Absent: `packages/ignition-native`/`ignition-windows` (PR #57 draft).

## Classification

SUPERSEDED (no merge): `docs/nyc-tron-ui-single-component-owner`,
`feat/cadence-mixer-engine-ops-20261105`, `feat/color-ui-nyc-tron-20261105`,
`feat/expo58-native-hsv-picker-2026-11-04`,
`feat/expo58-native-video-monitor-2026-11-03`,
`feat/expo58-universal-color-controls-2026-11-03`,
`feat/forge-icons-rive-universal-suite-2026-11-02`,
`feat/ignition-nitro-v1-preview-2026-11-02`,
`feat/ignition-v1-apple-android-linkage-2026-11-05`,
`feat/nitro-v1-cpp-rust-session-2026-11-02`,
`feat/prism-canvas-layers-ops-20261105`,
`feat/rust-per-document-ffi-2026-11-02`,
`feat/test-telemetry-adapter-20261105`.

ABANDON (preserve ref, no merge): `chore/npm-release-consumer-gates-2026-11-02`
(revisit at P20 npm distribution), `feat/package-react-native-2026-11-02`
(same).

DOCS-ONLY (cherry-pick still-accurate sections after review):
`codex/package-build-distribution`,
`docs/advanced-gui-native-source-admission-20261105`,
`docs/cross-platform-gui-acceptance-2026-11-05`,
`docs/shared-expo-meta-adaptive-ui-2026-11-02`,
`docs/skills-roster-quality-gates-2026-11-02`.

MERGE-CANDIDATE (selective port only, never whole-branch merge):

- `feat/shared-rust-windows-qnx-2026-11-05` (140 commits) — unique
  `packages/ignition-native`, `ignition-windows`, `tooling/native`,
  `docs/native/WINDOWS_RUST_HOST.md`, `SHARED_RUST_HOSTS.md`. Port during
  P18; expect conflicts in `packages/ignition`, `rust/nf-sys`, workflows.
- `feat/skia-v3-runtime-validation-2026-11-02` — Skia v3 policy tooling:
  `tooling/check-skia-v3.mjs`, `skia-v3-policy*.mjs`, `docs/SKIA_V3.md`,
  two workflows. Verify Expo 58/RN 0.88 compatibility first.
- `feat/native-whiteboard-canvas-2026-11-02` (77),
  `feat/native-whiteboard-skia3-ink-2026-11-02` (93),
  `fix/board-nitro-v1-link-moyo`, `wip/nitro-forge-moyo-board-2026-11-04`
  (20) — Board/whiteboard engine + Skia3 ink + Moyo linkage; no Board
  package in completion. Consolidate into ONE port decision after
  file-level diff; UI stays in NYC-Tron.
- `feat/pen-connect-bluetooth-rive-2026-11-02` (8) and
  `feat/spatial-ink-logitech-muse-2026-11-02` (23) — BLE pen/Muse hardware
  path; Forge-side per port roster; needs provenance + device validation.
- `feat/artcraft-source-monitor-2026-11-02` (8) and
  `feat/studio-suite-upstream-monitor-2026-11-02` (6) — possible unique
  monitoring tooling; diff before deciding.

## Follow-ups before any merge

- Run `git log --oneline codex/complete-all-components..<branch>` and
  `git diff --stat` for all MERGE-CANDIDATE refs.
- Resolve remote head SHAs, esp. board/Muse/BLE/monitor branches.
- Check whether `feat/ignition-v1-apple-android-linkage` and
  `feat/ignition-v1-binary-tasks-cache-20261105` share head/content.
- Stale-base branches: whole-branch merge would likely regress
  completion — selective file ports only.

## File-level verification (2026-11-11, git log/diff/ls-tree confirmed)

Stack topology verified via merge-base:

```
studio-suite-upstream-monitor (746727b)
  └─ skia-v3-runtime-validation (b70fc6e)   [file set ⊂ shared-rust]
       └─ shared-rust-windows-qnx (4503912) [140 commits]
spatial-ink-logitech-muse (1500a81)
  └─ pen-connect-bluetooth-rive (77f2806)   [muse ⊂ pen-connect]
native-whiteboard-canvas (8c07e4a)
  └─ fix/board-nitro-v1-link-moyo (f72a9de) [canvas ⊂ fix except 3 renames]
wip-nitro-forge-moyo-board (798203a) ⊂ fix (unique commit = generated only)
native-whiteboard-skia3-ink (4c5c42e) — ORPHAN: 5 commits in no other branch
```

Ref `feat/ignition-v1-binary-tasks-cache-20261105` does not exist in this
repo — that audit follow-up is unresolvable as stated.

### Refined recommendations

- **PORT-FILES** `feat/shared-rust-windows-qnx-2026-11-05` (superset of
  skia-v3 + studio-suite rows): `packages/ignition-windows/**`,
  `ignition-v1-lab/**`, nf-sys/ignition-core diffs, per-engine rust
  additions, `packages/ignition` Forge.nitro/host hardening,
  `tooling/native/*` smoke tools, skia-v3 policy tooling, workflows,
  `docs/native/*`. P18 work; selective file ports only.
- **PORT-FILES** `fix/board-nitro-v1-link-moyo` — best board base
  (contains canvas): `packages/board/**` (regen nitrogen/ post-port),
  `apps/board-native-lab/**` (not generated android/), `tooling/
  board-kotlin-core`, verify scripts, board workflows, board docs.
- **DECISION NEEDED** `feat/native-whiteboard-skia3-ink-2026-11-02` —
  orphan `packages/native-board` (Skia v3 Graphite) competes with
  `packages/board`; compare `docs/native/NATIVE_BOARD_INK.md` vs
  `BOARD_SKIA3.md` before porting; spatial-ink changes conflict with
  pen-connect's version — prefer pen-connect.
- **PORT-FILES** `feat/pen-connect-bluetooth-rive-2026-11-02` (contains
  muse): `packages/{pen-connect,bluetooth-v1,spatial-ink}`,
  `apps/pen-connect-lab`, assets, workflows, docs. Caution: touches
  `tooling/nyc-tron.json` + pin verifier — review before porting.
- **PORT-FILES** `feat/artcraft-source-monitor-2026-11-02` — cleanest
  candidate, all-new paths: `tooling/upstream/*`, candidates json,
  intake roster doc, observer workflow.
- **CONTAINED (no port)**: skia-v3-runtime-validation, studio-suite-
  upstream-monitor (⊂ shared-rust); native-whiteboard-canvas,
  wip-nitro-forge-moyo-board (⊂ fix-board); spatial-ink-logitech-muse
  (⊂ pen-connect).
- Do NOT port `pnpm-lock.yaml` wholesale from any branch — stale-base
  artifact; regenerate.
