# Independent ArtCraft upstream-sync policy

**Status:** Architecture/release policy, not an active watcher yet. 2026-11-02.

The NitroForge source of truth is **this standalone repository**, not Moyo. Its seven existing Ignition Rust engines are first-party. ArtCraft upstream projects (PhotoCraft, VectorCraft, DesignCraft, WordCraft, GridCraft, DeckCraft, PdfCraft, FilmCraft, EffectCraft, SoundCraft, FigCraft) are **optional additional sources of reviewed capabilities**, not drop-in replacements for the current API, schemas, native bridges or UI.

## Intake, pins and provenance

- Maintain `upstream.lock.json` with immutable SHA, exact source repository, license/NOTICE review state and capability/cross-platform admission results for each accepted engine. Start with *candidate* status; never imply that listing a repo means its code is linked.
- A scheduled job, or a separately authorized webhook/GitHub App, discovers merged upstream PRs, commits, tags, license changes and security fixes. Do not mistake unmerged PR heads for shipped features.
- For each candidate update, prepare a review PR with commit diff, affected crates/commands, migration risks, format compatibility, new features, license changes and dependency graph.
- CI proves the affected Rust engine integration, Ignition API compatibility, document snapshots/undo, native Nitro and iOS/Android builds, browser WASM, GPU rendering, accessibility and selected real devices *before* release. Source compile checks alone do not claim runtime or feature parity.
- Expose only reviewed typed operations through an adapter; do not hand arbitrary upstream plug-in loading, filesystem access, remote control, or scripting to untrusted apps/documents.
- Document adapter capabilities and exact source versions in a machine-readable manifest. Retain prior versions and formats for migration/rollback; publish stable semver SDK versions with native binary and web artifacts.
- Consumers (Moyo, DVNT, NYC-MON, Pa'Casa, Harlem Might) update the released NitroForge **npm packages**, not copied ArtCraft sources, through Renovate/Dependabot PRs. CI and real app acceptance determine adoption dates; no silent forced updates.
- Security fixes may justify prompt review, but bypassing compatibility tests is not automatic. Version updates across apps may be coordinated using a fleet compatibility baseline.

## Guardrails

Keep the Ignition engine trait, public typed product APIs and already-passing test contracts unless a deliberate, versioned migration is approved. Never assume PhotoCraft is the same as Prism, WordCraft as Quill, or GridCraft as Tally. Use an explicit compatibility adapter and test round-trip fidelity, including unsupported features and conversion losses.

ArtCraft branding, logos, fonts, code license, transitive dependencies and patents require individual review before vendoring source or distributing binaries. No upstream code has been imported by writing this file.

**Existing prior work:** Moyo's PhotoCraft source admission PR #95 recorded compile-only evidence for a pinned PhotoCraft commit; it did *not* establish a native bridge. Reference the immutable Moyo receipt, then repeat source admission in NitroForge rather than assuming all engines pass.

See [STUDIO_UI.md](./STUDIO_UI.md) for suite design and [SKIA_V3.md](./SKIA_V3.md) for the hard v3 rendering requirement.
