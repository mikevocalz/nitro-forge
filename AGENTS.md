# Nitro-Forge — agent guide

## What this is
Monorepo of seven document engines (Prism, Cadence, Splice, Folio, Pitch, Tally,
Quill), each a pure-Rust crate implementing `ignition_core::Engine`, exposed to
TypeScript through `@nitro-forge/ignition` (Nitro in production, `nf-cli` in tests).

## Contracts (read before editing)
- `docs/ARCHITECTURE.md` — Engine trait semantics, threading, ownership, undo,
  envelope format, error codes.
- `docs/ENGINE_OPS.md` — authoritative op names/payloads per engine. The TS APIs
  and the Rust engines must stay in sync with it.
- `docs/ROSTER.md` — what has actually been verified.

## Commands
```bash
cargo test --workspace          # all engine + contract + FFI tests
cargo build -p nf-cli           # build the JSON-lines test host
pnpm -r test                    # vitest e2e suites (drive real engines via nf-cli)
pnpm -r typecheck               # tsc --noEmit per package
pnpm --filter @nitro-forge/console demo   # all-engines workflow demo
```

## Distribution
Forge packages ship as GitHub Release tarballs with `SHA256SUMS`, never npm. Moyo Business and other apps consume those versioned artifacts and must not become SDK dependencies. Keep current public engine names and operations until a separately reviewed API migration is approved.

## Rules for contributors (human or agent)
- Engines are synchronous, single-threaded, I/O-free, `Send`-only state machines.
- `apply` must be atomic: validate fully before mutating; errors leave state intact.
- Mutating ops record a `Journal` undo entry before mutation and emit
  `document:changed`; read-only ops record nothing and emit nothing.
- Snapshots are the `NFD1` envelope (`ignition_core::encode_envelope`); `restore`
  must reject bad input without touching state.
- Op names live in `docs/ENGINE_OPS.md` — change the doc and every engine together.
- No `unsafe` inside product engines (FFI lives in `rust/nf-sys` only).
- Never claim verification that wasn't run; update `docs/ROSTER.md` truthfully.

## Skills first: required before implementation or PR authoring
1. Read `docs/ENGINEERING_SKILLS.md`, the workstream-specific local `.agents/skills/*/SKILL.md`, and `docs/WORKSTREAM_ROSTER.md`.
2. Read the relevant *pinned* upstream skills from the skill registry before changing code. Verify the file and version actually exists; never claim a skill was loaded if only its name or README was read.
3. For Expo/native UI begin with `expo-overview`, then `expo-ui`, `expo-native-ui`, `expo-design-system`, `expo-module` and `expo-animation` as appropriate. For public TypeScript/React/native API changes, read **Margelo `api-design` first**, then its `build-nitro-modules` skill, then C++, Swift and Kotlin as the implementation requires. Match generated Nitro signatures exactly; never claim codegen exists until run. For tests and perf use Callstack + Software Mansion Argent.
4. Apply `petergyang/no-ai-slop` **to all docs, README and PR narratives**: specific facts, precise tests, no filler, no invented benchmarks. Also apply `pbakaus/impeccable`/Expo design-system audit for UI; use Mobbin as reference evidence, never copy proprietary assets.
5. Before a PR opens, provide a roster with named workstreams, ownership roles, source files, capability limits and acceptance evidence. For unfinished work use a **draft PR** and say exactly what is missing.

## Engineering invariants
- Seven headless Rust engines remain the source of truth for editable state. Keep `docs/ARCHITECTURE.md`, `docs/ENGINE_OPS.md` and `docs/ROSTER.md` authoritative. FFI is restricted to `rust/nf-sys`; no `unsafe` in engine code.
- `Ignition` commands must be atomic; undo/redo, NFD1 versioned snapshot/restore, bounded imports and session release must preserve document state.
- Nitro codegen is a *build step*, not proof of linked iOS/Android functionality. Native, web/WASM and GPU execution must each be measured separately.
- **Only `react-native-skia` v3 Graphite** in the future renderer; avoid Shopify v2 package. Read `docs/SKIA_V3.md` (lands with PR #1) and the project Skia skill before changes. Skia and WebGPU share Dawn only when verified matching versions; Rust GPU texture sharing is a separate research gate.
- Reusable UI controls have one owner: [NYC-Tron UI](https://github.com/mikevocalz/NYC-Tron-UI), released as `v0.1.0-alpha.1` GitHub Release tarballs (not npm). Forge imports them by release URL and never keeps a second copy. Product-specific Moyo styles/auth/storage stay in Moyo.
- A unified NitroForge workspace design from `docs/STUDIO_UI.md` (lands with PR #1); panel docking and document object snapping are separate systems. Mobbin references are research evidence only.
- `upstream` ArtCraft sources must be separate, audited, pinned and licensed. A repo URL is not an implementation or license approval.
- Never claim that documentation, a source audit, a mock test, or a simulator is equivalent to a shipped, production-tested editor.

## Verification and status language
Use `PASS` only for checks executed with linked evidence at the proposed commit. Use `NOT RUN` when unavailable, `BLOCKED` for missing runtime/tooling, and `FAIL` with an error link when checks fail. Required gates include `cargo test --workspace`, `pnpm -r test`, `pnpm -r typecheck`, native build/codegen, web build, actual device interaction, accessibility and rendering/performance as workstream-appropriate. Never substitute a manifest check for a native Skia/Graphite build. State upstream commit pins and applicable device evidence in every completed implementation PR.

## External and prior repositories
- [Moyo original shared UI](https://github.com/mikevocalz/moyolearn/tree/main/packages/ui) and its [PhotoCraft source-admission PR #95](https://github.com/mikevocalz/moyolearn/pull/95).
- [Moyo pinned foldable skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md). Read its full 18-scenario acceptance contract for adaptive work.
- [NitroForge prior PR #1](https://github.com/mikevocalz/nitro-forge/pull/1) pins Skia 3.8.1/WebGPU 0.19.2 in an unmerged *draft*. Do not assume it has shipped. It still needs pnpm lock regeneration and physical builds.
