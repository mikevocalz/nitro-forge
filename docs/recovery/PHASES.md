# Recovery phases

Latest integration/publication: see [MERGE.md](MERGE.md). Phase checkpoints below retain their historical evidence.

Scope: finish the interrupted local NYC-Tron and Nitro-Forge work from the durable recovery copies. The 341-component table includes broader backlog; absent, deferred and struck work outside the interrupted branches is not silently added to this recovery scope.

Each phase finishes with integrated source, required exports and engine documentation, passing relevant checks, a status-table update and a local commit. Physical-device acceptance remains distinct from source, browser and native compilation evidence. Local completion does not imply pushed or merged PRs.

| Phase | Work | Exit criteria | Status |
| --- | --- | --- | --- |
| 1 | Alpha.3 release consumers | Combine the six follow-ups, reconcile runtime/config/exports and lockfile, pass combined tests/types and browser builds | COMPLETE locally |
| 2 | Timeline cluster 2 | Finish recovered clD-tron controls, exports, component/browser gates and matching Forge timeline adapter contracts | COMPLETE locally; unpublished |
| 3 | Canvas and layers | Integrate U1-U4 into clB-tron; finish exports, source notices, browser acceptance and Prism bindings to #60 operations | COMPLETE locally; unpublished |
| 4 | Audio cluster 2 | Finish clE-tron exports and browser gates, then bind the #58 Cadence operations with engine-backed tests | COMPLETE locally; unpublished |
| 5 | Workspace, color and transfers | Finish shell/color/presenter work and clACJN-forge workspace/import/export adapters against real engines | COMPLETE; unpublished |
| 6 | Native tasks, decoding and desktop review | Finish native task/cache/binary transport, decoder and recovery dialog coverage; complete #57 source review; record actual supported platform gates | COMPLETE within documented platform limits |

## Phase 1 evidence

Worktree: `/Users/mikevocalz/recovered-work/2026-11-05/forge-phase1`.
Branch: `codex/phase1-alpha3-integration`. All six preceding follow-up commits are ancestors of this branch.

- NYC-Tron alpha.3 release already succeeded: run 42126058079, 14 tarballs.
- Frozen workspace install passes with the existing pnpm 12 and Metro 0.87.2 configuration and patches retained.
- `cargo test --locked --workspace`: 245 pass, zero failures.
- `pnpm -r test`: 394 pass, one existing skipped native check, zero failures.
- `pnpm -r typecheck`: all workspace package typechecks pass.
- Dependency-free audio graph tests: eight pass.
- `pnpm test:lab-config`: two regression checks pass. They verify that lab watch folders include the workspace while retaining Expo and Uniwind configuration.
- Studio preview production build, audio-lab web export and media-lab web export pass.
- Both release-pin verification commands pass; all 21 manifest references agree with alpha.3 and all six consumed package hashes match the release.
- Studio UI boundary check passes. Studio app.json is byte-identical to the Studio alpha.3 baseline; no window/orientation contract was changed.

The combined build exposed and fixed missing workspace watch folders in the audio and media labs. Before that fix, Expo's web asset export rejected Audio API icons from pnpm's store outside projectRoot. Both labs now preserve their existing configuration and add the workspace root.

The root `test:rust` command now points to the actual root Cargo workspace rather than a nonexistent `rust/Cargo.toml`.

Logs: `/Users/mikevocalz/recovered-work/2026-11-05/phase1-*.log`.
Status table: `docs/recovery/roster-status.tsv`, 341 rows and 21 columns. No source row is promoted to DONE merely because a branch was combined.

No new native build or physical-device/screen-reader/foldable acceptance was run. No remote branch was pushed or PR merged in this phase. Original repositories and all recovered working files remain preserved.

## Phase 3 evidence

See [PHASE3.md](PHASE3.md) for canvas integration, Prism bindings, checks and remaining platform/backend boundaries. Phase 4 is complete locally; see PHASE4.md.

## Phase 4 evidence

See [PHASE4.md](PHASE4.md) for audio controls, Cadence bindings, validation and remaining platform/backend boundaries. Phase 5 is complete; see PHASE5.md.

## Phase 5 evidence

See [PHASE5.md](PHASE5.md) for workspace, transfer/color bindings and host session ink, validation and explicit backend/platform limits. Push each completed phase under the user’s standing instruction. Phase 6 is next.

## Phase 6 evidence

See [PHASE6.md](PHASE6.md) for native runtime, decoding/recovery checks, PR #57 source audit and remaining Android/RNW/QNX/device gates. Both phase branches are pushed under the standing instruction.
