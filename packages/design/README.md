# Design fixed-frame backend

Design9 persists an ordered frame/rectangle/ellipse hierarchy and evaluates actual absolute or row/column layout with bounded per-axis fixed/hug/fill sizing, including real fixed-size wrapping. Real RGBA rendering reuses Prism. The root canvas is distinct from the application's window size.

See [ENGINE_OPS](../../docs/ENGINE_OPS.md) for operations, limits, overflow semantics and locking. Frames have visible overflow; hidden children keep layout space. Lock prevents authored edits through locked ancestry, not changes to derived position caused by an unlocked ancestor. There is no clipping, text, responsive constraints, components, variables or prototype runtime.

Registration appends ordinal9 without changing0..8. Native binaries require rebuilding for the new kind; the default app does not activate it. Fixed layout/rendering does not complete P16 acceptance.

Sizing capability reads validate actual proposed modes and report dependency/unsupported-combination reasons. Fixed transitions freeze the current evaluated size; authored fallback is retained while hugging/filling. Wrapped main hug and fill children inside wrapped flow remain explicitly unavailable. See ENGINE_OPS for empty/negative-extent and stretch semantics. No old-pinned inspector is activated.
