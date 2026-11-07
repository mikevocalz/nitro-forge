# Opt-in Forge monitor integration candidate

`forge-integration-candidate.patch` preserves the recovered local Forge monitor, frame session, tests, native acceptance host and their exact package/lock deltas against commit `c6e7ece`. It does not activate them in the tracked default workspace. Original local working files remain intact. Do not apply this patch over those already-modified files.

The monitor accepts actual explicit presentation timestamps or the new optional native presentation-index capability. A source replacement aborts/discards pending index results before allocating a player. Missing capability is an error; nominal FPS is never used to invent an index. Native operations are serialized and guarded by source/intent ownership. See [source review](../../docs/completion/P02-P11-SOURCE-REVIEW.md) and [monitor report](../../docs/completion/reports/P03-monitor-ownership-source.md).

Application was checked against a temporary Git index loaded from the pinned commit. Direct media-ui TypeScript checking passed against this machine's recovered candidate dependencies. Tests were written but not executed; no native compilation/runtime acceptance is claimed.

The package delta deliberately records the recovered experimental `.1` file dependency and optional unpublished peer. It is not a fresh-install promise: rebuild the recovered source with the pinned generator/runtime, verify packed output and provenance, compile native targets and complete ABI/Fabric/player lifecycle acceptance before selecting an artifact or enabling defaults. See [player provenance](PROVENANCE.md). The local tarball is not embedded in this integration patch. Acceptance-host manifests and locks must move together after an approved artifact is resolved.

The source gate remains open for genuine CFR/VFR/B-frame fixtures, cancellation/replacement/disposal, codecs, foreground/audio focus, iOS/Android player behavior and final platform acceptance. No phase is declared complete.
