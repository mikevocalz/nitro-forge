---
name: artcraft-intake
description: Review and integrate selected ArtCraft Rust engine features into NitroForge safely while preserving its seven first-party Ignition engines and app-neutral release contracts.
---
# NitroForge ArtCraft upstream intake skill

## Scope
ArtCraft's PhotoCraft, WordCraft, GridCraft, DeckCraft, PdfCraft, FilmCraft, SoundCraft and optional VectorCraft, DesignCraft, EffectCraft, FigCraft are **candidate sources**, not the same as NitroForge's Prism, Quill, Tally, Pitch, Folio, Splice or Cadence engines. Do not vendor them into Moyo or rename current `@nitro-forge/*` public APIs.

## Required sequence
1. Read `docs/ARCHITECTURE.md`, `docs/ENGINE_OPS.md`, `docs/ROSTER.md`, `docs/UPSTREAM.md` and the repo's current source candidate lock.
2. Resolve the exact GitHub repository, immutable commit SHA, base branch, licensing files, NOTICE, toolchain, transitive crates, optional fonts/media/codecs and security notices. Different upstream sources may have different licenses.
3. Classify changed upstream PRs as bugfix/feature/ABI/binary/license/security; inspect actual merged source, not PR titles. Record minimum Rust version, target flags and dependencies.
4. Adapt only specific reviewed engine operations behind the existing typed Ignition contract. Unknown commands and arbitrary filesystem paths, plug-ins, remote scripting or MCP exposure are denied by default. Never promise that every upstream feature is available.
5. Add negative tests for malformed, oversized, decompression-bomb and malicious content; verify atomic commands, unchanged state on errors, undo/redo, snapshots and import/export fidelity.
6. Build/test the admitted engine for host, iOS device, iOS simulator, Android arm64 and WASM; separately test actual Nitro native linkage and runtime editor behavior. A successful cargo cross-target check is admission evidence, **not working device integration**.
7. Publish only reviewed source pins and capability manifests, release by semver and let each consumer app upgrade via normal dependency PRs and its own CI/device gates.

## Verification records
For every candidate include `sourceRepository`, `baseRef`, `latestObservedSha`, `admittedSha` (nullable), license/NOTICE flags, API capability review, iOS/Android/WASM run evidence and exact upstream diff link. A reviewer must approve moving from observed to admitted.

Never auto-merge source updates into a production engine; scheduled discovery PRs may update *only observed* commit metadata, not installed Cargo dependencies or runtime code.
