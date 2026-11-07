# P03 monitor ownership source checkpoint

2026-11-07. This is a source checkpoint in the original P02/P03 work, not phase completion or native acceptance.

## Baseline inspected

The checkout already contained uncommitted player work: media-ui's video export, frame session/monitor and model tests; native-cadence player acceptance entry and Metro/package/lock changes; player-port source/ABI scripts, experimental tarballs and an Android capture. Those files were inspected without changing or staging the manifests, locks, native lab, player port or historical evidence. The older port README/MIGRATION text still describes the dependency as unavailable, while the existing package edits select an experimental v1 artifact. That disagreement needs provenance/release reconciliation rather than a new acceptance claim.

The historical Android capture records a 192x128 load, progress, reported 0.750-second seek and released-player initialization rejection. It does not establish exact decoded presentation at every indexed frame, iOS player support, all codecs, foreground/audio-focus policy or the full mount/replacement lifecycle. The earlier decoder report separately records native H.264/AAC frame/PCM checks; that evidence does not certify this new monitor adapter.

## Source changes above that baseline

- NativeVideoMonitor binds each owner and its imperative callbacks to the committed URI/index/store source. Layout cleanup revokes the old owner synchronously. A changed-source render does not display the old decoded image or enable its actions. Native resources remain in refs.
- Event publication and queued actions require the same committed owner. Release is idempotent within the adapter. Fatal player failures close/release their session while preserving the visible error; stale release/error callbacks cannot poison a replacement source.
- Awaited seek controls receive the original task rejection; void transport callbacks observe it. Pending indexed decodes block Play, while additional seek requests can still coalesce. Recoverable frame-decode errors retain a real retry path through seeking. Display indices use the validated immutable frame-session index.
- The frame session publishes the paused state after Pause completes, then rechecks generation after every observable store publication. A synchronous subscriber's replacement request supersedes old success/error acknowledgements instead of acknowledging an obsolete frame.

Two model regression cases were added for subscriber-triggered replacement after decoded/error publication. They were not executed under the current review gate.

## Verification and original phase gaps

`pnpm --filter @nitro-forge/media-ui typecheck` and `git diff --check` passed. No dependency installation, native binary build, runtime scenario or test suite ran. The player source/ABI itself is unchanged by this checkpoint. Runtime/native event ordering, Fabric view teardown/release ordering and actual frame/transport behavior still need the accepted device pass.

P03 still needs a real source/container presentation-index producer: the adapter accepts actual timestamps and refuses nominal-FPS extrapolation, but MediaDecoder.probe does not expose an index. NativeVideoMonitor explicitly does not implement a web player; the canonical web decoder has a WebCodecs presentation path and a separately labeled seek-target fallback, which cannot be passed off as exact frame evidence. Wider codec/error/cancellation/cache, iOS player, physical-device, foreground/background, audio-focus and release-build acceptance remain open. P02's services/checkpoints/collaboration source and historical checks do not by themselves establish product recovery, recipient delivery or all-platform accessibility acceptance.

The parent's phase ledger must keep these original exit criteria open. Nothing here promotes P02/P03 to complete or replaces published alpha.4 assets.

## Optional native index consumer

The monitor now accepts explicit `presentationTimesUs` or loads actual timestamps only when the decoder advertises `presentationIndexVersion: 1` and a callable `presentationIndex`. A structural optional type preserves compatibility with released alpha.4 TypeScript declarations; no new named package import or dependency selection is required. Missing capability produces a clear error requesting explicit real timestamps or the new source candidate, with no FPS synthesis.

Index loading uses a readonly numeric `pendingIndexToken` in the per-instance Zustand store and an AbortController on the effect owner. Source replacement aborts consumer delivery and rejects/discards stale results; a player is allocated only after a valid current index exists. Native work already submitted may drain on its own serial owner. The loaded duration must match probe duration and the complete strictly validated index must fit within both. Existing source identity, transport admission/intent serialization and frame-session ownership remain in place. The local Zustand store initialization now uses an explicit if rather than logical assignment.

Direct installed TypeScript compiler checking passes for media-ui. No pnpm script, runtime test, native build or dependency/lockfile change was made for this consumer delta. This source candidate depends on an unreleased native capability when timestamps are omitted; existing alpha.4 binaries still require caller-supplied actual timestamps. Independent source review remains required.
