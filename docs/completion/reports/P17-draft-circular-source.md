# P17 Draft circles and arcs source checkpoint

This extends the bounded Draft engine; it does not complete P17 or activate CAD controls in the installed alpha.4 UI.

## Implemented

- Stable circle/arc IDs share the existing entity allocator. A circle/arc references an actual persistent point as center; shared-center edits move all references. Locked curves fix that point exactly, require separate unlock for geometry/style edits, and cannot be deleted. Removing a curve retains its center; referenced points cannot be removed.
- Full entity ordering covers segments/circles/arcs. Existing setSegmentOrder keeps its exact segment-permutation contract and replaces only segment slots.
- Circles/arcs are analytic world geometry. Directed start/sweep angles support negative sweeps, wrap and full360° arcs. Radius/angles remain authored values outside the linear solver. Solve reports explicitly declare scope point_coordinates; rank/DOF do not describe full circular scene freedom.
- Visible circular entities supply centers, arc endpoints/half-sweep midpoints, closest points, world-anchor tangent contacts and unique segment/circular intersections. New modes default false. Tangents never fabricate a contact for an interior anchor. All identical circular-carrier pairs are excluded, including partial arcs sharing only an isolated endpoint.
- CIRCLE/ARC commands stage an actual center and curve through existing authoritative operations, one undo step after complete validation. DELETE supports both new entities. Invalid parsing/geometry leaves IDs, snapshots, events and redo intact.
- Render converts analytic circles/arcs to at most four tangent-matched cubic spans, then uses existing Prism paths and RGBA flatten. This is a display approximation, not precision plotting. All projected nodes/control points/strokes are checked before compositor construction.
- Existing schema1 snapshots default absent maps/flags and retain their original serialization when circular maps are empty and new flags false. Documents with circles/arcs or enabled center/nearest_circle/tangent flags save a strict Draft-only JSON wrapper `{kind:"draft",schema:2,document:...}` inside unchanged NFD1 framing. Original root required fields are absent, so even permissive old readers fail instead of dropping new geometry/settings. New readers reject unknown wrapper kind/schema/fields and unwrapped extended state. describe normalizes empty circular maps/flags for the typed API. Bounds remain64 points,128 total segments/circles/arcs, at most64 each circular kind,16 journal entries and8MiB state. Entire containing circles fit the bounded world even for partial arcs.

## Contracts inspected

NYC-Tron source ObjectSnapsAndOrtho accepts host settings, mode availability, revision/scoped commit and host renderFeedback. DraftingCommandLine accepts completions and an asynchronous rejecting onExecute callback. The adapters add only real supported completions/modes, retain source_revision checks and require explicit host anchorAvailable for tangent availability. They create no canvas, viewport transform or local geometry owner. The pinned alpha.4 package does not expose these CAD controls; no installed/default UI adoption is claimed.

## Numeric scope

Distance boundaries use computed f64 comparisons rather than expanding geometry by snap tolerance. Directed arc inclusion allows1e-10 degrees for endpoint roundoff; finite segment/circular intersection skips squared segment lengths<=1e-18. Identical circular-carrier pairs are not returned as intersections, even when their bounded arcs share only an isolated endpoint. Partial arcs with indistinguishable represented endpoints reject. Circular rasterization inherits Prism flattening, antialiasing and sampling; no exact-predicate, plotting or CAD-conformance guarantee is made.

## Validation

- cargo test -p draft-engine:17 tests passed, including analytic tangencies/nearconcentric pairs/tiny radii, directed/full arcs, entity ordering/locks/history/corrupt restore, parser atomicity and actual Prism circular RGBA.
- Direct Draft TypeScript check passed.
- Draft Vitest:7 tests passed across2 files, including actual nf-cli circular commands, real pixels, move/delete, undo/redo and owned snapshot reopen, plus anchor availability and stale feedback bindings.
- nf-cli built from current source. Vitest resolved @nitro-forge/ignition to its real workspace source with a task-only /tmp config because workspace symlinks were not installed. This is source/CLI evidence, not published-consumer evidence.
- cargo check -p draft-engine --tests passed. No dependency/lock, shared registration, native build, runtime device, release or public pin change.

Remaining P17 scope includes nonlinear/radius/angle constraints, general CAD and3D, precision export, released CAD-control adoption and native/product acceptance. No full-phase completion claim.
