# F0 status refresh, 2026-11-13

F1, F3, F7 and F8 are **in-progress**, not passed. This read-only source and
receipt review starts from master `b000c8ab9f8201bcba3c67163f6c8f700acf6453`.
It corrects stale reasons without changing acceptance text, gate signatures,
validators, source code, dependencies, F2 or F6. It is not a new product execution
or a complete candidate matrix. Engineering documentation guidance was applied
by keeping original receipts and their limits beside this summary.

## Merged work and remaining acceptance

| Gate | Landed / recorded | Still required |
|---|---|---|
| F1 | Dependency baseline #78, final merge `17abb543f69da99f8a2821c766e32476cc5b0300`. `RELEASE_TRAIN.md` records Nitro nightly.136, pnpm 12.18.0, the Expo/React/toolchain bumps, Rust updates and explicit holds. Audit #83 final merge `d31cf2cf9500cb32ed1ec43ef68e628856e9f54f`. | Full §5 audit and disposition of every hold; fresh `pnpm outdated -r`; build, typecheck, workspace/package suites and the original all-22-workflow requirement on the chosen graph with independent signoff. A successful subset is not that requirement. |
| F3 | `docs/proposals/F3-deferred-rows.md` exists. #81 implements the recorded option-B Tally/Cadence decisions; final merge `a58994d4802de2db9067ae3cbe824912c4a50b9c`. Original browser/engine proof is retained below. | Forge Prism B11 `alphaModes` catalog wiring, row tests and rendered review remain incomplete at this baseline; the three-row gate is not signed. The original proposal remains historical, rather than being rewritten to imply later approval. |
| F7 | Source-bound #82 shell rendering and #81 real Tally/Cadence browser interactions exist. Web is partial in both the compatibility file and ROSTER. | Complete fresh Rust/C ABI/iOS/Android/web receipts at one final candidate. Historical simulator/emulator probes do not establish runtime at this baseline or #85. Physical-device, broader browser and remaining target work stay NOT RUN. |
| F8 | #86 merged §2.5 and the radius direction into `design/DIRECTION.md` at `b000c8ab9f8201bcba3c67163f6c8f700acf6453`. | Shared radius tokens/migration, validator wired into `validate:v1`, view inventory, full §3.3 sequence per studio, consistent seven-studio/two-lab construction, iPad-size captures, interactions and native accessibility review. Direction approval alone is not implementation acceptance. |

F1 holds include RN 0.89 prerelease, Skia/WebGPU/Dawn native compatibility,
SVG's SPM collision, vendored video generation/provenance, quick-xml's Tally/Quill
migration, lopdf encrypted-roundtrip failures, zip migration and the documented
major Rust crate holds. This summary does not dispose of them or reinterpret
advisory ignores as a security conclusion. The existing cargo-audit report at
`../2026-11-13-9378368/cargo-audit.md` and the dependency section of
`../../RELEASE_TRAIN.md` preserve their original scope.

## Exact CI identities and omissions

`ci-snapshot.json` is a dated primary GitHub metadata snapshot, not a promise
that still-running workflows have completed. It retains each run's head,
conclusion, timestamps and URL. A run at a PR head usually tests a synthetic
merge; final merge identities below do not relabel those executions.

- #78 head `397e1656dffd782115707a60f12bd7895c747755`: 20 returned workflow
  runs completed success. This is not a claim that all 22 required workflows
  were independently reconciled or that a fresh full §5 audit ran.
- #83 head `d380a19e3bd4edc632817e1a91bf90219959b10e`: audit run
  [43510259292](https://github.com/mikevocalz/nitro-forge/actions/runs/43510259292)
  succeeded at tested merge `9f64228e589a42e86f5b6a2909dba8cab7da8cd2`.
  Original `job-132178346347.log` records `cargo audit --deny warnings`,
  1,509 loaded advisories and 185 dependencies. The configured seven advisory
  ignores remain; no local cargo audit was run in this refresh.
- #81 head `c0b000aef9b91bd5d5cae6317a20fbd87caffe8f`: 14 returned workflows
  completed success. Studio run
  [43518003107](https://github.com/mikevocalz/nitro-forge/actions/runs/43518003107)
  checked out `0c8ba55452fb7dd952d6c933dd56071862f350c3`.
  Original `job-132204809529.log` has 50 Rust result lines, 1,452 passed,
  zero failed and **two ignored**. Zero-test result lines are included in the 50.
  A job success does not prove optional service bodies executed with providers.
- Active #85 head `f6b6e17e0600fcb1f8e14023a1692026738daaa7` is separate from
  this master baseline. At this snapshot **15 of 17 returned workflows completed
  success; two native workflows remained in-progress**: audio native build
  [43536267385](https://github.com/mikevocalz/nitro-forge/actions/runs/43536267385)
  and Cadence native consumer
  [43536267383](https://github.com/mikevocalz/nitro-forge/actions/runs/43536267383).
  Completed jobs checked out `2463139896b61e8bfe49a2ad6dd2da50fb02043a` (merge
  into `fe6cc5a3b3e9fbba72be7bca3e6aa9453b8c256e`), not a final master merge.
  Its Studio Rust job `132265903612` likewise records 1,452 passed, zero failed,
  **two ignored** across 50 result lines. `pr85-selected-job-excerpts.json`
  preserves the separately reviewed Chromium preview/dev renders, Metro exports,
  actual pin-download checks and package suite excerpts; the Office job explicitly
  reports **39 passed and five skipped** in one suite. Those skipped tests are
  not counted as executed. The excerpts are selected, not full logs, and neither
  they nor a bundle export show native runtime or complete platform acceptance.

`rust-summary.json` contains only parsed result-line totals from the two original
Rust logs, not new test runs. Complete raw Rust/audit logs are retained here.
The original historical native and C ABI entries in `compatibility.v1.json`
remain unchanged and source-bound. No result is transferred onto #85 or this
status-refresh commit.

## Browser receipt preservation

- [#82 original receipt](forge-pr82-2026-11-13-166f22f/RECEIPT.md): head
  `166f22f7267fe9eb8f6c1f97a9b8b9555e03d926`, tested merge
  `370e10b6b2c95ddeeeb2ae0ad89815e5305c884f`, final merge
  `ba1dfb5819742f27483a95db8109496dfd838e39`. Original CI provenance and both
  unedited captures are retained. Launcher/Prism shell rendered; the static
  host's missing backend and Animated fallback warning are retained. This is
  not engine or accessibility acceptance.
- [#81 original receipt](forge-pr81-2026-11-13-c0b000a/RECEIPT.md): head
  `c0b000aef9b91bd5d5cae6317a20fbd87caffe8f`, tested merge
  `0c8ba55452fb7dd952d6c933dd56071862f350c3`, final merge
  `a58994d4802de2db9067ae3cbe824912c4a50b9c`. Original eleven unedited product
  captures, network observations and source/artifact/binary provenance are
  retained. The real bridge verified all twelve engine kinds; browser actions
  cover the Tally pivot and Cadence sensitivity/marker cases described there.
  Native playback, cancellation timing and loading/error visual review were
  not manually exercised. Independent R2's scoped receipt review is recorded
  in the original receipt; it is not a new full F3/F7/F8 signature.

These are product proof captures, not copied private design references. Files
were copied byte-for-byte from the retained outputs; `SHA256SUMS` binds this
preservation packet. No new screenshot, dependency install, build, browser
session, native launch, full Rust suite, package typecheck or physical-device
check ran for this status refresh. Local verification is limited to source-only
gate tests, candidate/stable validator behavior and structural diff assertions.
