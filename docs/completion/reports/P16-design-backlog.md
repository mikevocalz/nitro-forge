# P16 design and prototyping backlog

2026-11-07. Source-scoping record for dispatching implementation slices.
Audited `packages/design` (engine tag 9) against NYC-Tron
`packages/ui/src/components/forge/design/` contracts L-01–L-15. No slice
is complete; this is a work list, not acceptance.

## Current state

`design-engine` (`#![forbid(unsafe_code)]`): `State{kind:"design",
schema:1,title,next_id,nodes}` flat node map; `Kind` = Frame|Rect|Ellipse
only; `Layout` row/column + wrap/gap/padding/align/justify; `Sizing`
fixed|hug|fill per axis; ops for frames/shapes/layout/sizing/order/
reparent/remove + reads `describe`/`evaluateLayout`/`readAxisSizing`/
`renderFrame` (Prism RGBA). Budgets: ≤1024 nodes, depth ≤64, root ≤4096px.
No versioned wrapper; `validate()` hard-requires `schema==1` with
`deny_unknown_fields`. TS has no `OPS` const map yet. Explicitly absent:
text, images, constraints, components/variables/prototype/comments/
presence/export.

## NYC-Tron contracts to satisfy

L-01 tree kinds (frame|component|instance|group|layer), L-02 autolayout
(done), L-03 hug/fill (done), L-04 constraints panel shape, L-05 variant
picker, L-06 reusable styles, L-07 variables+modes, L-08..L-11 prototype
graph/preview/flow, L-12 dev handoff, L-13 presence, L-14 comment pins,
L-15 export slices. **Pin blocker**: installed alpha.4 lacks the
`forge/design` subpath — control wiring waits for a NYC-Tron release.

## Slice order

- **A — schema foundation + text nodes**: introduce versioned wrapper
  (recommended over bare schema bump — keeps schema:1 byte-identical,
  old readers fail closed); add `Kind::Text` + `Node.text` bounded
  content/font fields; text renders as layout boxes only (`renderable:
  false` in describe) until a Prism text op exists — real glyph rendering
  is a separate prism-engine slice.
- **B — variables & modes**: `variables`/`modes`/`active_mode` state;
  alias cycle/type/mode-coverage validation ported to Rust; `bindVariable`
  over a closed bindable-path enum (fill, gap, padding, fixed x/y/w/h);
  resolved at read/render time, never baked into nodes.
- **C1 — constraints storage + absolute anchors**: `Node.constraints`
  h/v anchors on absolute children only; `scale`/non-parent `relative_to`
  rejected with reasons; `readConstraints` capability op.
- **C2 — min/max + aspect + relative targets** (after C1).
- **D — components & variants**: materialized-instance model — instance
  node stores `component_id`+variant+overrides; read-only deterministic
  expansion at evaluate/render (never persisted expanded); bounded
  expansion depth/nodes.
- **E — prototype graph + bounded runtime**: screens/hotspots/
  interactions/transitions catalog matching `PrototypeInteraction`
  contract; `prototypeGraph` + `resolvePrototypeEvent` as pure
  deterministic functions (no clocks — host schedules delay/duration);
  playback status/progress is host-owned, engine never fakes animation.
- **F — handoff + export contract**: `describeHandoff` read (measurements
  from evaluateLayout + typography/assets + deterministic snippets tagged
  with a new `state_revision` counter); export slices = screen/frame
  membership first, per-slice format/scale host-side; `exportSlice`
  returns RGBA+manifest (no PNG/SVG encoder exists — external blocker).
- **G — comments**: engine-owned threads/pins (durable doc state, undo,
  snapshot sync). Caps ~1024 threads, body ≤64 KiB.

## Presence/comments placement decision

Comments → engine document state (undo/atomic/snapshot for free).
Presence → collaboration-server transport only, never engine state:
cursors would create document revisions and force conflicts in the
whole-snapshot CAS model. Requires a new non-snapshot channel on
collaboration-server — tracked separately, coordinate with N-11/Yjs
ownership before building.

## ENGINE_OPS.md gaps to fix along the way

Undocumented `OP_BATCH` support for design; `renderFrame` payload/binary
duality; `readAxisSizing` cost semantics; schema/versioning policy
statement (write in Slice A); `setAxisSizing` freeze-transition example;
the "no constraints/text/component/variable/prototype/clipping" header
must be updated per slice.

## External blockers

NYC-Tron alpha.4 lacks `forge/design` subpath (needs release + pin
bump); Prism has no text op (font metrics undecided); no PNG/SVG encoder
admitted; presence transport needs collaboration-server work; prototype
playback clock is host-owned; native/JSI binaries need rebuild per new
ops.

## Constraint solver checkpoint (2026-11-08)

C1/C2 constraints are now enforced, closing the largest remaining Design
slice. `evaluateLayout` solves constraints automatically (no separate
solve op): flush edge/midpoint/span pinning against the parent-or-sibling
reference, C2 extent bounds, `aspect_locked` derived from evaluated
geometry, topological sibling-dependency resolution with cycle/bound/aspect
conflicts reported as unsatisfied (baseline geometry kept). `scale`
anchors, inset margins, wider `relative_to` targets, stored ratios and
constraint-aware hug/fill stay deferred. `readConstraints` reports live
`solve` status; `evaluateLayout` carries a `constraints` report block.
Snapshots unchanged (solving is derived). Evidence: 54 Rust tests, 19
Vitest incl. 1 new nf-cli solver e2e; see ROSTER.md.
