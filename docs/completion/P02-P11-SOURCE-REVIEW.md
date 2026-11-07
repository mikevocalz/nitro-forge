# P02–P11 source and provenance review

2026-11-07. This review inspects the ten original phases and their existing exit criteria. It runs no tests, native builds or runtime scenarios. Source review does not complete a phase or certify a platform.

## Inventory and provenance

A read-only comparison of the pending `components.json` with its HEAD version found only the additive `librarySource`, phase `librarySourceSummary` and `librarySourceSnapshot` fields. Removing those additions reconstructs the prior JSON exactly. No completion, gate, platform acceptance, phase status, exit criterion or dependency changed in that comparison.

The 341 canonical IDs are unique in both inventories. P02–P11 contains 228 IDs: 217 library-scope implementations and 11 engine/platform integration requirements. Their integration IDs are N-01, N-03, N-04, N-10, N-11, N-13, N-14, N-15, N-16, N-18 and N-19. P02/P03 remain in progress; P04–P11 remain pending. The complete library inventory records 329 library-scope implementations, with 12 integration rows outside that scope; these are different counts.

The snapshot revision is `37645d149b19b3f9ff5feee4ca1ce004137994a4`. Reading that commit's `docs/completion/library-progress.json` blob produced SHA-256 `d97fcf0cf5924f2c8cfd0b776f24b96e891178f2726deea054e7fde4ee71c855`, matching the recorded snapshot. Thus this pending snapshot's provenance matches the actual committed ledger rather than merely the current branch name.

The initial synchronization script accepted a revision string without verifying its file bytes. The revised source checks the tracked ledger path and specified commit blob before writing, checks unique/equal ID sets and protects existing acceptance fields. The revised source also normalizes absent path arrays to empty arrays only for outside-library rows, preserving their outside-scope review label. In-scope implementations still require valid path arrays. The initial provenance, ID-set and outside-scope-schema findings were addressed before commit. No execution result is inferred from inspecting the script.

## Phase-map assessment

`P02-P11-IMPLEMENTATION-MAP.md` preserves the original exit criteria and distinguishes reusable UI controls from native/engine/provider integration. Its counts match the joined inventories. Existing source and historical proof are presented with their limits. P10 still needs a genuine photo/catalog/RAW backend and admitted processing dependencies; P11 still needs a persistent composition/evaluation/render backend. UI fields and request fixtures do not supply those engines.

All 228 P02–P11 rows retain unverified acceptance in the source ledger. This review does not authorize declaring the ten phases complete, releasing a new artifact, updating consumer pins or replacing the hardware/provider matrix.

## Prism source follow-up

The pending Prism detail helper composes canonical object/selection/artboard/color controls over existing Prism operations. Its read/preview callbacks check a captured generation before publishing, and its writes enter the parent gate/operation lock. Authoritative-state and selection keys cancel older alpha.4 widget drafts without using density or window geometry as identity. Numeric rotation units match the engine's degree contract; current out-of-default-range values remain representable.

An initial color-picker session retained its old draft across authoritative-state replacement and let old draft/cancel callbacks target a newer session. The revised source binds each picker session to the opening document and state, hides mismatched sessions and checks current generation plus session identity before draft/cancel updates. This addresses the identified cross-source/cross-session path in source. Runtime dialog, failure/focus and native input acceptance remain unverified.

The pinned foreground/background control supplies only the next pair, not a Swap-versus-Reset reason. A host must not infer an unambiguous semantic intent from identical next values; recent-color bookkeeping differs between engine swap and reset. The revised helper now commits the exact next pair atomically with remember:false rather than inferring Swap-versus-Reset intent, so it no longer claims an unavailable reason signal or adds misleading recent-color entries.

The concrete native-monitor and presentation-index source scopes are reviewed below. No unrelated native-cadence/media working-tree file is treated as reviewed or accepted here. Findings sent during implementation are not runtime verification.

## Native monitor and frame-session source review

Inspected the whole pending `packages/media-ui/src/video/NativeVideoMonitor.tsx` and `frameSession.ts`, their model test source and `reports/P03-monitor-ownership-source.md`. These video files were baseline untracked work before this checkpoint. This review does not approve staging the surrounding manifests, locks, native lab, experimental player archive or ABI port.

The monitor keeps native player/session resources in refs, binds events and queued UI actions to a committed source owner, hides old decoded images on changed-source renders and revokes ownership during layout cleanup. Adapter release is idempotent; it closes its session without deleting the decoder's shared cache. The installed player wrapper invalidates its own reference before native release and observes native cleanup errors, but that source inspection is not proof of Fabric teardown ordering on hardware.

The frame session validates and copies an increasing presentation-time index, bounds requests, coalesces pending previews and checks exact presentation timestamps. It rechecks generation after awaited transport/decode work and observable store writes, so subscriber-triggered replacement can supersede old success/error acknowledgements. Close settles active/pending waiters and aborts its decode signal. The two new subscriber model cases were inspected, not run.

The initial transport review found that Play could acknowledge success after source replacement and that native Play/Pause/Seek needed explicit ordering. The revised owner queue serializes those native operations, checks the live committed owner before and after each await, rechecks pending indexed frames when a queued Play reaches admission, and leaves decoder coalescing outside that transport queue. A rejected native operation does not poison later queue entries.

A further same-source intent race was corrected: an older Pause could await native work and then supersede a newer seek by issuing its own frame commit. The revised owner carries a monotonic high-level intent. UI actions claim it synchronously, queued actions skip obsolete intent, imperative frame commits also claim intent, and Pause checks its admission again before creating the final frame request. Obsolete same-owner UI failures cannot publish an error over the current intent. Play/Pause reuse the same admission rather than double-claiming it. This closes the identified source ordering/acknowledgement findings; it does not certify native event timing or ABI behavior.

The current working-tree package metadata selects an experimental Nitro v1 player peer and a local archive development dependency. Neither that archive's reproducibility/provenance nor compiled native ABI support is approved by a TypeScript pass. Native binary construction, event ordering, exact frame presentation, lifecycle, codec and device acceptance remain pending the user's review gate. Actual presentation-index production is still a separate required source/container capability. P02/P03 remain open.


## Presentation-index producer source review

Inspected the optional native presentationIndexV1 addition in NYC-Tron platform-services: the TypeScript facade/validator and exports, Swift module/record/asset-reader extension, and Kotlin module/record/extractor implementation. Old linked alpha.4 binaries do not advertise the optional method. Both producers enumerate actual compressed sample PTS, sort presentation order, and reject duplicate timestamps instead of synthesizing FPS positions. Their first-video-track choice follows the existing decoder contract. Aggregated/nondisplay/partial or encrypted sample limitations are rejected rather than claimed as complete support.

The installed iOS 27.1 CoreMedia header declares CMSampleBufferGetSampleAttachmentsArray as a CFArray of sample-attachment dictionaries and DoNotDisplay as a CFBoolean attachment key. No mismatch in the selected C attachment API was identified from that header inspection. Swift compilation, bridging behavior and AVAssetReader record generation remain unverified.

Android getSampleSize is available starting at API 28, according to the [official MediaExtractor reference](https://developer.android.com/reference/android/media/MediaExtractor#getSampleSize()). The revised implementation explicitly rejects older Android hosts before calling that accessor, without raising the host minimum SDK, and rejects a negative sample size paired with a valid PTS. The source API-availability and size-bound findings are addressed.

The facade bounds maxFrames before native admission. Its separately exported toMediaPresentationIndex validator now applies the same 1…200000 parameter bound itself, so direct Infinity, NaN or larger-limit inputs cannot bypass the cap. No additional blocker was identified in the final reviewed producer source. Native ABI, actual extractor/reader timeline completeness, source/container-index delivery and consumer adoption remain separate acceptance gates; no native compile or runtime tests ran in this review.

## Optional index consumer and candidate preservation

Reviewed the later NativeVideoMonitor index consumer. Explicit timestamps still pass the owned, bounded presentation-index validator. Omitted timestamps require both the optional version1 capability and method; linked alpha.4 binaries receive an explicit unsupported-capability error rather than synthetic FPS positions. The lookup carries an AbortSignal, and live-source plus numeric pending-token checks discard replaced results before allocating a player. Returned timestamps are strictly validated and the indexed duration must agree with the subsequent probe. Native resources remain in refs; the new store field is only a numeric admission token. No additional source blocker was identified in this reviewed change.

A static pass against the locally installed experimental player types is not reproducible default-package acceptance. The working-tree peer and local archive dependency are uncommitted prerequisites. Preserve the complete monitor source, model tests, video subpath and required package delta as an explicit opt-in integration patch while leaving the tracked default exports/manifests/lock unchanged. That avoids introducing fake declarations or hiding active product source with TypeScript exclusions. Original local working files must remain intact.

The opt-in patch's instructions must state that the experimental player source still needs generation/rebuild comparison, an approved artifact, compiled ABI/Fabric checks and native runtime acceptance before applying it to a production consumer. A current file-archive path or unpublished peer string records the candidate prerequisite; it does not promise that a fresh install can resolve it. Patch applicability is a static preservation check only. No runtime, unit or native compiler execution is inferred from this review.
