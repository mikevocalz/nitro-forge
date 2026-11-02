# ArtCraft source intake: observer, reviewer roster and release gates

**Current implementation in this PR:** a Node 24 standard-library watcher, 11 candidate pinned observations, offline tests, and an optional daily GitHub Actions job that proposes source-observation PRs. **No ArtCraft source has been integrated into Rust engines.**

## Goal and separation
The same approved ArtCraft fix can eventually reach Moyo, DVNT, NYC-MON, Pa'Casa, Harlem Might and third-party clients through **one NitroForge SDK release**, with individual client update PRs. NitroForge already has seven **first-party** Ignition engines. ArtCraft's various tools are *candidates* to be admitted via targeted adapters, not replacements.

| Current public engine/API | Candidate source | Feature intake question |
| --- | --- | --- |
| `@nitro-forge/prism` | PhotoCraft / VectorCraft / DesignCraft / optional FigCraft | Which raster/shape/path/filter operations can be safely translated into atomic Ignition commands? |
| `@nitro-forge/quill` | WordCraft | Which pagination/OOXML/editing operations exceed Quill's current implementation, with format round-trip proof? |
| `@nitro-forge/tally` | GridCraft | Which formula recalculation and XLSX/formatting features pass workbook fidelity tests? |
| `@nitro-forge/pitch` | DeckCraft | Which PPTX/animation features have demonstrated native and web behavior? |
| `@nitro-forge/folio` | PdfCraft | Which PDF text/render/annotation primitives work within bounds and permission rules? |
| `@nitro-forge/splice` | FilmCraft / EffectCraft | Which timeline and effect features can use safe media buffers without freezing UI? |
| `@nitro-forge/cadence` | SoundCraft | Which real audio render/track operations share a stable sample format and latency budget? |

## Daily observer implementation
- `upstream.candidates.json` lists public GitHub repo, base ref `main`, exact last observed SHA and separate `admittedSha` (currently null), licensing and runtime statuses (unreviewed/not-integrated).
- `tooling/upstream/watch.mjs` queries **only** fixed `https://api.github.com/repos/storytold/<repo>/git/ref/heads/main` paths. Repo names must pass a strict whitelist-by-structure; response must resolve to a commit SHA.
- `--validate` checks the catalog offline; `--check` reports live differences and exits 2 without writing; `--write` updates **only lastObservedSha** and writes a compare-link Markdown report, without changing `admittedSha`, `Cargo.toml`, source manifests, npm packages or built binaries.
- `tooling/upstream/watch.test.mjs` uses `node:test` to verify repo validation, immutable admitted field, no-change idempotence, report generation and bad-SHA rejection.
- `.github/workflows/artcraft-observer.yml` runs offline tests on PRs. On daily schedule or manual dispatch **only from master**, it queries GitHub, then `peter-evans/create-pull-request` creates/updates a reviewer-facing branch and PR. The bot's action commit is SHA-pinned; it cannot auto-merge.
- A repository setting may disallow Actions creating pull requests. If it does, the job fails and needs owner-approved GitHub Actions permission changes. Don't silently add PAT secrets or disable branch rules.
- The watcher does **not** claim it tracks unmerged PRs or release features; all merged commits on `main` become observable via HEAD comparison. The reviewer opens the compare link to identify the relevant actual PRs and behavior.

## Engineering roster

| ID | Expertise / owner | Required outcome | Evidence | Status |
| --- | --- | --- | --- | --- |
| UP-01 | GitHub automation | Source watcher and observed-only PR | Node offline tests + workflow, changed HEAD PR | Code proposed; tests unverified |
| UP-02 | Source reviewer | inspect all changed commits/merged PRs, stable SHA, license, NOTICE, transitive crates, codegen | signed-off candidate report | PLANNED |
| UP-03 | Rust engineer | admit reviewed source by exact SHA only after ABI/feature tests | cargo host/iOS/Android/WASM compile & execution | PLANNED |
| UP-04 | Engine maintainer | map upstream functionality to Ignition typed ops without breaking existing APIs | op-level regression/negative tests and docs/ENGINE_OPS updates | PLANNED |
| UP-05 | Security reviewer | reject unsupported filesystem/plugin/remote/AI command surfaces; malformed imports | fuzz/panic/memory and permission tests | PLANNED |
| UP-06 | Formats engineer | prove binary/document import/export fidelity, metadata and undo/redo | real fixture corpus per format | PLANNED |
| UP-07 | Graphics/native reviewer | render with Skia **v3 Graphite**, and verified Dawn/TypeGPU interop only as appropriate | device screenshot/parity, memory and GPU-loss traces | PLANNED |
| UP-08 | Browser/WASM reviewer | independently compile and run web adapter | browser edits/snapshots/worker cancellation | PLANNED |
| UP-09 | Release engineer | semver SDK, provenance, npm pack artifacts, feature manifest | package install + native/web matrix and changelog | PLANNED |
| UP-10 | App consumer leads | Moyo and second app adopt same released package through review PRs | CI+device acceptance per host; rollback instructions | PLANNED |

## Admission gates and mandatory skills
- [ArtCraft project intake skill / PR #2](https://github.com/mikevocalz/nitro-forge/pull/2), [Margelo C++/Swift/Kotlin and Nitro](https://github.com/margelo/react-native-skills/tree/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills), [Expo module skill](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-module/SKILL.md), [Everything Claude Code security review](https://github.com/WorldFlowAI/everything-claude-code/blob/432485ba6b92c14fb357276a98957f348bcff9ee/skills/security-review/SKILL.md), [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md), [Callstack RN performance](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md).
- Canonical source provenance: repository, commit SHA, Cargo.lock SHA, LICENSE/NOTICE, optional fonts/icons/media, cryptography/archive codecs and transitive dependencies. **No ArtCraft branding assets are admitted merely because source code is available.**
- Engine API and format compatibility must be explicit. Existing `NFD1` snapshots, atomic operations and undo commands must continue working or have an engineered migration path.
- Real native iOS/Android, WebAssembly and document-format tests all pass before publishing any new capability. A latest commit observation or Cargo check alone is not release readiness.
- Update downstream apps via their own dependency PRs, never patch ArtCraft sources separately in each app. Canary one app, then coordinate compatibility baseline and rollback as needed.

## How to verify this PR
```sh
node tooling/upstream/watch.mjs --validate
node --test tooling/upstream/watch.test.mjs
# Online read-only test:
node tooling/upstream/watch.mjs --check
# Online change detection on a reviewed workspace/CI branch only:
node tooling/upstream/watch.mjs --write
```
`--write` intentionally changes candidate observed SHA metadata and creates a summary file only when upstream changed; it is **not** an engine upgrade. The workflow opens an approval PR; it never uses a force-push or silently ships Rust source to app consumers.

### Current limits
The reference SHAs are **observations on 2026-11-02**, not accepted engine pins. Online fetching requires GitHub network and optional GITHUB_TOKEN. We have not run the watcher in the user's GitHub Actions environment or seen a bot PR created. The existing local/CLI Ignition test ledger remains separate from this source-monitoring evidence.
