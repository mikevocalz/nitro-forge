# Nitro-Forge and NYC-Tron completion megaplan

2026-11-07. This document sequences the remaining work across phases P02–P20
for both repositories. It changes no phase status, acceptance field or
completion count. The original exit criteria in `components.json` remain
authoritative; this plan only orders the work and names entry points.

## Scope and ground truth

- 341 canonical component IDs; NYC-Tron `library-progress.json` records 329
  implemented library rows and 12 pending native-integration rows; all 341
  remain `acceptance: unverified`.
- Required platforms: ios, android, web, macos, windows, visionos, quest, pico.
- Authoritative worktrees: Forge `codex/complete-all-components` in
  `forge-complete`; NYC-Tron `codex/complete-all-components` in `tron-complete`.
- The `nitro-forge` cwd branch
  (`feat/forge-2046-design-studio-personas-2026-11-04`) is 0 ahead and 347
  behind the completion branch; nothing unique needs porting.
- All NYC-Tron local and remote branches are merged into its completion
  branch (verified by rev-list audit on 2026-11-07).
- Many older Forge remote branches carry commits not reachable from the
  completion branch. Most are superseded candidates; each needs an
  explicit merge-or-abandon decision during reconciliation rather than a
  blind merge.
- Review gate lifted by user decision on 2026-11-07: native rebuilds,
  simulator/emulator runs and full suites may run as normal plan steps.
- Android APK/emulator testing is opportunistic pending disk capacity; it
  stays a documented gap when unavailable.

## Phase 0 — reconciliation and baseline

Baseline recorded 2026-11-07 against `codex/complete-all-components` @
`48c4b21` (forge-complete) and `d5207cc` (tron-complete):

- Forge `cargo test --workspace`: all engine and FFI test binaries pass
  (27 `test result: ok` lines, zero failures).
- Forge `pnpm -r test`: all packages pass; `packages/cadence` WAV-export
  e2e hit the 5000 ms vitest timeout once under parallel load and passed
  40/40 on isolated rerun — recorded as a flake, not a regression.
  `packages/telemetry` passed 15/15 on rerun after the recursive run
  aborted.
- Forge `pnpm -r typecheck`: all 27 projects clean.
- NYC-Tron `pnpm test`: 969 tests, 0 failures.
- NYC-Tron branch audit: every local and remote branch is merged into
  `codex/complete-all-components`; nothing to port.
- Forge remote-branch audit (30 branches with unreachable commits) is in
  progress; merge-or-abandon decisions land before Wave 1 dispatch.

1. Audit each unmerged Forge remote branch; merge genuinely unique work or
   record it as abandoned with reason. Preserve the experimental
   player/monitor working-tree candidates exactly as they are.
2. Freeze a baseline: `cargo test --workspace`, `pnpm -r test`,
   `pnpm -r typecheck` in `forge-complete`; `pnpm test`, `pnpm typecheck`,
   `pnpm verify` component-program checks in `tron-complete`. Record
   results here or in linked reports.
3. Pin strategy: consumers stay on NYC-Tron `v0.1.0-alpha.4` with the
   existing capability-gated fallbacks until a stable post-alpha.4 set
   lands; the next release is cut from `tron-complete` during the NYC-Tron
   packaging track, then `tooling/nyc-tron.json` pins update per consumer.
4. Open question for user: whether new shared controls belong in
   `nyc-mon/packages/ui` or NYC-Tron-UI. Resolve before adapter work
   begins in the NYC-Tron track.

## Wave 1 — backend-heavy engine work

Parallel workstreams, one worktree each, implementer plus independent
reviewer per AGENTS rules.

### W1 — P10 photo catalog and RAW development

Production RAW decoder admission (LibRaw isolated proof exists; select and
verify the dependency), durable original storage, non-destructive
develop/lens/mask/retouch, ICC handling, encoded batch export. Entry:
`packages/photo`, `reports/P10-libraw-isolated-decode-source.md`,
`reports/P10-registered-photo-catalog-source.md`,
`P10-PHOTO-CATALOG-REGISTRATION-PLAN.md`, `P10-P11-ENGINE-PREREQUISITES.md`.

### W2 — P11 motion and compositing

Nested compositions, mattes/blending, effects, bounded expressions,
particles, 3D cameras/lights, encoded render queue with real progress.
Entry: `packages/motion`, `reports/P11-motion-source.md`,
`reports/P11-motion-independent-source-review.md`.

### W3 — P15 PDF editing and delivery

Admit a rendering/text-position backend after license and target-build
review; real page rasterization, glyph positions, selection/search; forms,
signatures with real keys and trust validation, secure redaction that
removes content in saved artifacts, encryption, comparison, native
print/scan integration, speech attachments. Entry: `packages/folio`,
`reports/P15-*.md`.

### W4 — P16 UI design and prototyping

Authoritative component/variable state, prototype interaction runtime,
real preview/handoff, presence/comments through the existing collaboration
service, multi-slice encoding/export. Entry: `packages/design`,
`reports/P16-design-fixed-frame-source.md`,
`reports/P16-P17-backend-entry-plan.md`, `N11-collaboration.md`.

### W5 — P17 CAD, 3D, materials and nodes

Promote `packages/draft` toward a real parametric constraint backend
(nonlinear constraints, dimensions, paper space); 3D scene ownership,
renderer, gizmos, UV/PBR/texture painting/baking, node materials. Requires
admitted geometry/renderer dependencies with GPU and target support.
Entry: `packages/draft`, `reports/P17-draft-source.md`,
`reports/P17-draft-circular-source.md`.

### W6 — P12–P14 office completion

- P12 Quill: layout/caret/IME/fonts, tables/page layout/review/TOC/
  citations/mail merge, speech/dictation. Extend `rust/src/lib.rs` and
  `rust/src/docx.rs` together; licensed font metrics required.
- P13 Tally: remaining grid/format/validation/sort/chart/pivot/import/
  comment/view ops with real workbook state and keyboard/clipboard
  semantics; extend `lib.rs`, `formula.rs`, `range_ops.rs`; workbook
  format import/export.
- P14 Pitch: masters/templates/diagrams/morph/notes/media/charts,
  presenter displays, rehearsal, persistent ink; deck/object schema,
  render/presentation ops, media integration.

## Wave 2 — infrastructure and host integration

P02/P03 proceed in parallel with Wave 1; P04–P09 follow their dependencies.

- P02: product recovery integration, player/decoder ownership, frame
  presentation, recording/device routing, delivery providers, cancellation
  and resource lifetime through every native operation, collaboration
  scope decision. Integration IDs N-10, N-11, N-13–N-16, N-18. Evidence:
  `reports/P02.md`, `reports/P02-recovery-buffer-ownership-source.md`,
  `N11-collaboration.md`.
- P03: real Android/iOS/web decode, native playback, frame-accurate seek,
  cancellation/bounds/codec/lifecycle. N-19. NYC-Tron decoder source plus
  `packages/media-ui/src/video` and the preserved native-cadence
  acceptance work. Existing evidence: iOS decoder bridge `b192a23`,
  Android MediaPlayer owner `101016b` (compile-checked, runtime pending).
- P04: complete adoption of shell controls by product hosts; real
  import/export delivery, clipboard/drag-drop, overlay coordination,
  workspace/document continuity.
- P05: compose every Prism operation into hosts; presentation,
  encoding and delivery provider paths; native graphics and text-input
  validation.
- P06: production brush pipeline (dynamics/taper/stabilization), erase
  modes, hardware input/prediction/Muse, palm rejection, real timelapse
  encoder. N-01, N-03, N-04.
- P07: ICC/gamut/proof, eyedropper, histograms/curves/scopes/sampling;
  color-management dependency admission.
- P08: Splice compositor/render cache, decoder-derived thumbnails/probes,
  encoder/export, effects/stickers/keyframed speed; consumes the P03
  decoder and an encoder provider.
- P09: Cadence device routing/recording/comping/latency/surround,
  offline DSP/model features, valid audio export; native input/output
  host and interruption handling.

## Wave 3 — native hosts and platform acceptance

- P18/N-09: native Windows, macOS, visionOS, Quest and PICO hosts and
  adapters; displays/input/lifecycle; QNX/Linux scope; ABI and toolchain
  validation. Preserve window, orientation and manifest contracts.
- Foldable/dual-screen/tablet/headset validation follows the
  `mikevocalz-foldable-layouts` skill acceptance scenarios.
- Platform matrix: every component row gets functional, error,
  undo/persistence, accessibility, adaptive-layout, performance,
  licensing and runtime evidence per applicable platform. This is the
  bulk of P19 evidence generation.
- Android runs when disk permits; CI builds may substitute partially.

## Wave 4 — NYC-Tron program track

Runs alongside the Forge waves and gates consumer pin updates.

1. Component review sign-off for all 329 implemented rows; record results
   in `library-progress.json` evidence fields.
2. Native interaction, accessibility, focus, foldable and performance
   validation across required platforms, extending the existing
   `docs/completion/P*-proof.json` pattern.
3. Platform adapters: real Windows Fluent, macOS AppKit, iOS SwiftUI and
   Android Compose implementations per repository rule 3; RN Views do not
   count.
4. The 12 pending N-xx rows: implement or descope explicitly with user
   sign-off.
5. Packaging: cut the next GitHub Release tarball set with checksums,
   update `tooling/nyc-tron.json` pins in Forge consumers, verify
   consuming applications.

## Wave 5 — acceptance and release

- P19: audit every row against functional, error, undo/persistence,
  accessibility, adaptive layout, performance, licensing and platform
  runtime evidence. No unverified row counts as complete. User review
  precedes promotion; evidence must match final source.
- P20: publish all completed packages and platform artifacts; verify
  checksums, exports, sizes, native consumers and migrations; update all
  consuming pins; close the 341-row ledger. Umbrella PRs nitro-forge #63
  and NYC-Tron-UI #54 merge only after P19.

## Verification and honesty rules

- Per slice: focused engine tests, vitest e2e through nf-cli, package
  typecheck, NYC-Tron scoped typecheck/lint.
- Per wave: `cargo test --workspace`, `pnpm -r test`, production builds,
  integration bridge, native builds for touched platforms.
- Runtime evidence via iOS simulator tooling, Android emulator when
  available, macOS/desktop hosts, web harness; physical foldables and
  headsets only when hardware is attached.
- `docs/ROSTER.md` and this directory's reports record only executed
  checks; unverified stays unverified. User-facing docs follow the
  no-ai-slop skill.
- Execution rule (user requirement, 2026-11-11): always use skills and
  subagents. Every implementation subagent must read the applicable
  skills before coding — the pinned `mikevocalz-foldable-layouts` skill
  for any layout/navigation work, relevant native platform skills
  (Nitro v1, Swift/Kotlin/C++, Expo) before native changes, domain
  skills before engine work, and `no-ai-slop` for user-facing docs.
  Additionally apply the everything-claude-code skill set installed at
  `~/.agents/skills/`: `coding-standards` and `tdd-workflow` for all
  implementation slices, `security-review` for auth/input/secrets/
  crypto-touching work (e.g. PDF encryption), `verification-loop`
  before merge, `backend-patterns`/`frontend-patterns` for service/UI
  work. Every slice gets an independent review subagent before merge;
  merges are performed by the orchestrator only after review approval
  plus a local verification run.

## Risks

- External dependency admission gates (RAW decoder, PDF renderer, ICC
  color management, 3D renderer, licensed fonts) each require license
  closure and target-build support before adoption.
- Media phases P08/P09/P14 depend on the P03 decoder and encoder
  providers; Wave 1 backends do not unblock them alone.
- NYC-Tron must ship a release before Forge can adopt new controls;
  sequence releases ahead of dependent Forge UI work.
- The 12 pending N-xx rows may be legitimately out of library scope and
  need per-row user decisions.
- Android disk constraint may persist; treat as a documented gap rather
  than a blocker for other platforms.
