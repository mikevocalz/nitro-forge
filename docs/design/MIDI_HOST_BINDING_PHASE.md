# MIDI meter and scroll host binding

Forge checks the existing MIDIPianoRoll import's optional version 1 capability marker before requesting rational timeSignature or controlled scrollX. It introduces no named import that would fail with the pinned alpha.4 package. A capable source/release receives the authoritative signature tuple and the retained horizontal anchor. Velocity waits for the current piano boundary's bounded scroll acknowledgement; callbacks from older widget boundaries stay ignored.

The alpha.4 path retains its whole-quarter bar fallback, fractional-quarter limitation message and remount-scroll acknowledgement. It does not claim the new source features are already shipped. The new canonical source preserves PPQ, note positions and snap units while drawing denominator-aware bars; controlling the horizontal anchor does not change document data or own a native resource.

Source build, package/public-slot typecheck and independent source review are recorded in NYC-Tron's P09-midi-grid-scroll.md. Forge's final preview typecheck and static build are recorded at this checkpoint. Runtime, keyboard, native gesture/accessibility, large-text and full-suite acceptance remain deferred to the user's review gate. Consumer pins and published assets remain unchanged.

Canonical source checkpoint: NYC-Tron `c81ef50`. The alpha.4 capability marker remains absent, so the existing fallback remains active until an accepted release supplies the new host.
