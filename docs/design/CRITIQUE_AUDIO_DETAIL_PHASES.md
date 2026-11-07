# Audio and timeline detail source review

2026-11-07. Independent review of the next three implementation batches. This review inspected source and the phase reports. It ran no browser, native, engine or full-suite scenarios, as required by the component-review gate. Reported builds/typechecks belong to their executing agents. No visual or native scores are inferred here.

## NYC-Tron audio targets and copy

Inspected the private audio-chrome helper and the changes to TempoAndMetronome, MixingConsole, ChannelStrip, LevelFader, the native vertical fader, PanControl, SoloMuteButtons and MixGroupBar.

The target remains app-owned and finite, with a 44-point minimum. The compound console passes it into channel strips, which pass it into fader, pan and toggle controls. The 44-point strip remains 120 points wide; a requested 48-point target yields 128. The native vertical rail and thumb remain centered as their interaction width grows. Tempo passes the target into its existing PrecisionScrubber and its other controls. No alternate engine, audio context, native host or gesture stack was added.

Undefined copy overrides retain defaults in the shared merge helper. Static blank tempo, toggle and group labels are rejected. Nested label APIs retain the app's word order and avoid inventing localized numeric parsing. Existing scoped pending/error/cancellation ownership remains in place. Type-only fader label imports do not introduce a runtime component cycle.

No blocking source defect was found for this batch. This verdict covers the reviewed default and requested geometry paths, not arbitrary caller styles/travel lengths or every control in the suite. Routing/rack target APIs, routing/meter metadata copy, long translations, text scaling, RTL, assistive technology and native gesture behavior remain outside this source verdict. The source phase is suitable for commit and later acceptance; it does not certify a released consumer pin.

## Cadence detail composition

Inspected the routing, insert/preset and MIDI composition, its full CadenceMixerState read and the parent surface gate. Bus creation and routing use existing typed operations. Presets load from the actual selected insert and publish only while document, project, selection and enabled state still match. Parameter ranges match the existing engine validator. No output device, audio context, audition or measurement data is fabricated.

The first review found that a same-label numeric draft could survive switching from one insert to another in the older released control. The revised composition keys widget-local drafts/gestures by authoritative project revision, selected panel/track/slot/clip and availability. App selection remains above those keys; geometry and density do not enter them. The captured selection/project checks and shared operation gate prevent old callbacks from becoming writes to the new target. Awaited rejections remain rejected, while legacy void boundaries observe the same original task.

A follow-up found that remounting the pinned piano roll resets its uncontrolled horizontal scroll to zero while the parent could retain the velocity lane's old offset. The revised boundary acknowledgement passes zero to the velocity lane until the newly mounted piano roll reports its own offset; an old boundary's scroll event cannot acknowledge the new one. This is aligned reset behavior, not preservation of the prior horizontal anchor. Focus and scroll restoration still require acceptance.

The grid uses quarter-note bars correctly for representable signatures, including 6/8 as three quarters. Fractional-quarter bars are explicitly unsupported by this pinned piano-roll host; a limitation message leaves tick-based velocity editing available rather than drawing false bar lines. This limitation is not full time-signature acceptance. Selected MIDI notes remain index-based because that is the current engine/control contract; structural edit selection behavior should be exercised in the later review pass.

No blocking source defect remains in the reviewed Cadence changes after those corrections. The implementation is suitable for its source checkpoint. The parent reports TypeScript/static checks; this critic ran no runtime scenarios. Long projects, scrolling after edits, asynchronous failures, native gestures, accessibility, measured graphs and the remaining audio workflows stay open.

## Splice detail composition

Inspected the app-local transition, marker and batch composition. All mutations delegate through the supplied surface commit gate and existing typed timeline adapter. Existing transitions are updated rather than duplicated. Selected clips/markers and selected cuts are checked against the current authoritative view. The transition overlay uses the same stackOrder as the track lanes. App selection sits in a per-document Zustand store above the released-control read-revision keys.

The authoritative-read keys cancel older released controls' widget-local drafts/gestures without deriving identity from width, posture or density. The rejection observer returns the original promise to awaited paths. The host must wire the selection, overlay and detail controls before this constitutes an integrated stage. Touch-only additive selection, geometry changes during gestures, focus restoration and every rendered layout still need acceptance. No decoder, compositor, player-loop or export capability is inferred from these controls.

## Splice host wiring follow-up

The final host now calls the per-document selection hook unconditionally, passes filtered multi-selection to the existing lane, derives the single-primary highlight from that same selection, and supplies the transition overlay and detail controls through the existing stack composition. It does not create another timeline or document handle.

The first source review found a data-reachability gap: the adapter's durationFrames is the last clip end, while the engine permits markers, range markers and loop ranges after that point. Ripples deliberately leave those annotations fixed. The new spliceTimelineExtent helper computes UI bounds from clip end, annotation tails and loop out-point without rewriting authoritative clip duration. The root uses that same extent for zoom, ruler, playhead and lanes, and the detail composition uses it for marker bounds. The cursor and viewport are clamped when that extent changes; jumping to a marker also follows the cursor. This addresses the source mismatch for valid later annotations, including otherwise empty sequences.

No additional blocking source flaw was found in the final wiring. It is suitable for the source implementation checkpoint after the parent's combined static checks. That verdict does not prove modifier-key or touch selection, a late-marker jump, transition gestures, atomic batch behavior through the rendered controls, scrolling, focus restoration or native accessibility. Those scenarios remain in the later acceptance pass. No new runtime, browser or native scenario was executed by this critique, and no published alpha.4 asset or consumer pin is certified here.
