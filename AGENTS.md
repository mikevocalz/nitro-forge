# NitroForge agent instructions

## What this repository is
Independent `Ignition` Rust document engines (Prism, Cadence, Splice, Folio, Pitch, Tally, Quill) with a reusable cross-platform SDK and proposed unified Studio UI. Moyo Business and other apps consume **versioned NitroForge artifacts**; they must not become SDK dependencies. Keep current public engine names and operations until a separately reviewed API migration is approved.

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
- **Only `react-native-skia` v3 Graphite** in the future renderer; avoid Shopify v2 package. Read `docs/SKIA_V3.md` and the project Skia skill before changes. Skia and WebGPU share Dawn only when verified matching versions; Rust GPU texture sharing is a separate research gate.
- One shared cross-platform UI component implementation across native iOS/Android and web. Expo UI SwiftUI/Compose controls, Moyo-derived AdaptivePanes/fold/Meta adapters where verified, responsive Tailwind v4 theme contracts. Product-specific Moyo styles/auth/storage stay in Moyo.
- A unified NitroForge workspace design from `docs/STUDIO_UI.md`; panel docking and document object snapping are separate systems. Mobbin references are research evidence only.
- `upstream` ArtCraft sources must be separate, audited, pinned and licensed. A repo URL is not an implementation or license approval.
- Never claim that documentation, a source audit, a mock test, or a simulator is equivalent to a shipped, production-tested editor.

## Verification and status language
Use `PASS` only for checks executed with linked evidence at the proposed commit. Use `NOT RUN` when unavailable, `BLOCKED` for missing runtime/tooling, and `FAIL` with an error link when checks fail. Required gates include `cargo test --workspace`, `pnpm -r test`, `pnpm -r typecheck`, native build/codegen, web build, actual device interaction, accessibility and rendering/performance as workstream-appropriate. Never substitute a manifest check for a native Skia/Graphite build. State upstream commit pins and applicable device evidence in every completed implementation PR.

## External and prior repositories
- [Moyo original shared UI](https://github.com/mikevocalz/moyolearn/tree/main/packages/ui) and its [PhotoCraft source-admission PR #95](https://github.com/mikevocalz/moyolearn/pull/95).
- [Moyo pinned foldable skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md). Read its full 18-scenario acceptance contract for adaptive work.
- [NitroForge prior PR #1](https://github.com/mikevocalz/nitro-forge/pull/1) pins Skia 3.8.1/WebGPU 0.19.2 in an unmerged *draft*. Do not assume it has shipped. It still needs pnpm lock regeneration and physical builds.
