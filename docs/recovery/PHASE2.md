# Phase 2 — timeline cluster completed locally

NYC-Tron worktree: `/Users/mikevocalz/recovered-work/2026-11-05/tron-phase2`, branch `codex/phase2-timeline`.
Forge worktree: `/Users/mikevocalz/recovered-work/2026-11-05/forge-phase2`, branch `codex/phase2-timeline-adapter` (includes phase 1).

## Delivered

The recovered timeline models and eleven component exports are integrated onto NYC-Tron's alpha.3 source. This includes shuttle intent, loop ranges, headers, roll/slip/slide/ripple edits, insert/overwrite placement, transition handles, markers, grouped track stacks, preset selection and batch operations.

Browser testing exposed repeated track renames while the engine response was pending. Track and marker fields now send one write for Enter followed by blur, permit subsequent edits, and marker Escape discards a draft. The shuttle clears its held-key state on blur. Compact headers expose complete track settings below the lanes.

Forge exports `timelineClusterCallbacks(adapter)` from its existing timeline-cluster subpath. These bound callbacks retain adapter ownership, return the engine's authoritative view and reject invalid edits. Transition kind strings are checked against supported presets. The host still owns selected clip/cut, player state, view publication and error display; no optimistic document copy is introduced.

`pnpm verify:timeline-source /absolute/path/to/nyc-tron-checkout` checks the actual built cluster declarations. Its contract covers headers/stack, edit modes, transitions/presets, markers, loop range and batches. This explicit source gate does not pretend that the new components are in the published alpha.3 tarball. Production release pins remain unchanged.

## Executed checks

- NYC-Tron: 544 model/source/render tests pass; full workspace build and typechecks pass.
- Package verifier: 275 conditional exports and 357 ESM files validated.
- Local pack check: all 13 packages pass; artifacts are unpublished in `phase2-local-packs`. Their alpha.3 labels are inherited from the source baseline; they do not replace published release assets.
- Full Chromium lane: 254 pass, including nine cluster interaction tests and five capture cases.
- Reviewed 13 light/dark phone/tablet and RTL timeline captures. Page overflow and 44px compact settings targets are explicitly checked.
- Forge Splice: 25 tests pass against the phase-1 Rust nf-cli (Rust sources unchanged in phase 2). Includes real-engine bound callback ownership, marker/transition/loop writes and rejection without mutation.
- Splice TypeScript and the built-source consumer contract pass.

Logs are `phase2-*.log` beside these worktrees. NYC-Tron's `docs/TIMELINE_CLUSTER_2.md` records the control/API mapping and detailed scope. The 341-row/21-column roster is updated in `docs/recovery/roster-status.tsv`; completed unpublished rows are BUILT-LOCAL, never merged/DONE.

## Remaining boundaries

No new release, remote push or PR merge was performed. Browser tests use a Zustand stand-in; separate Forge tests exercise real Rust. No new native compilation, device, screen-reader or foldable acceptance was run. No app-window, orientation, manifest or navigation contract changed.

Actual media decoding/compositing, effects tracks, rendered transition previews and keyframed speed remain deferred on their named backends. Shuttle reverse/step capability is opt-in, and actual looping remains player-owned. Phase 3 is canvas/layers integration.
