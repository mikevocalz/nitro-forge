# P03 indexed-frame source review

2026-11-07. Independent source inspection of the current NYC-Tron Swift/Kotlin/TypeScript indexed-frame delta and Forge frameSession capability consumer. No builds, tests or device actions were performed by this reviewer; the native owner runs its harness separately.

## Strict rational check corrected

The initial strictness finding is corrected in current production decodedImage source. When the indexed path supplies requiredTimeUs, the requested rational time must be numeric with epoch zero, the returned actual time must be numeric with epoch zero, and both CMTimeCompare(actual, time) == 0 and actual.microseconds == requiredTimeUs must hold. Distinct rational timestamps sharing a rounded microsecond bucket therefore reject before a frame file is produced. The Swift index retains exact edit-mapped CMTime values and binary-searches their unique rounded microsecond keys.

The native owner reports its separate harness passed 36 CFR/VFR/B-frame samples and rejection of a wrong rational timestamp differing by 0.1 microseconds within the same integer bucket. This reviewer confirmed the source correction without rerunning that harness or independently validating its output.
## Other inspected paths

Android checks that the requested integer timestamp belongs to the real compressed-sample index, decodes through the existing owned codec path and rejects an unequal actual output PTS. A mismatch deletes the generated frame file. Codec/extractor resources release through finally; index and decode use the serial worker's activity/time budget.

The optional JavaScript method/version capability is omitted when the linked native binary lacks the addition. Old binaries continue ordinary decode semantics. Forge prefers strict capability when present, checks actual presentation timing after awaiting decode and rejects mismatches. Existing source-generation checks prevent stale results from publishing after a superseding request or close.

AbortSignal cancels consumer admission/publication; the native job may still finish and produce a bounded-cache file. This review does not claim immediate native cancellation. The Swift index reader cancels through defer and checks its 30-second enumeration budget; image generation remains synchronous owned-worker work. Rebuilding the complete index per strict frame is linear in sample count and has no performance acceptance evidence here.

No other additional source blocker was found. Native harness results, Android execution and deployed binary compatibility remain separate evidence, not established by this source review.
