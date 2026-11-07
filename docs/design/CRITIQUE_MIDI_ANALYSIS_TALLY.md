# MIDI, analysis and worksheet source review

2026-11-07. Independent source review of three implementation batches. The user's component-review gate keeps runtime, browser, native and full-suite execution deferred. This review inspected code and reports; it does not infer device behavior, visual quality or released-consumer acceptance from source. Reported builds and typechecks belong to their executing agents.

## MIDI grid and horizontal position

The new notation-grid helper keeps PPQ as quarter-note ticks and computes denominator beats and measure boundaries separately. Fractional-tick grid positions do not change note values or snap precision. Long grids retain a bounded line count. Legacy beatsPerBar remains the path when a musical timeSignature is absent; invalid signatures, grid budgets and scroll requests are rejected.

MIDIPianoRoll retains imperative handles, measured viewport size, reached offsets and pending restoration positions in refs. Restoration waits for measurement, clamps to content bounds and acknowledges reached positions through onScrollX. A user drag clears the pending programmatic target; obsolete restoration events are filtered, and unmounted bodies cannot update the retained scroll position through their scroll callbacks. These are source properties, not a replay of native event ordering or momentum behavior.

The optional versioned capability marker stays on the existing component export. Forge checks the version and individual features before sending timeSignature or scrollX, so alpha.4 keeps its explicit unsupported-signature path. Requested horizontal position and acknowledged velocity-lane position remain distinct. This avoids declaring that an unknown prop on an older component implements a new capability.

No blocking source defect was found in the reviewed MIDI changes and host feature probe. The phase is suitable for a source checkpoint after the parent's static checks. Rational-grid rendering, user drag versus programmatic restoration, momentum, clamping after content changes, note/velocity alignment, focus and native accessibility remain acceptance scenarios. Published alpha.4 and the 329/329 library implementation count are not promoted by this verdict.

## Cadence analysis

Source review in progress; no runtime or measurement result is certified here.

## Worksheet detail controls

Source review in progress; active-sheet admission and bounded frozen-prefix reads must remain with the existing document owner.
