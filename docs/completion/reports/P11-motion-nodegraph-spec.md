# P11 Motion slice I — value node-graph spec

2026-11-08. Specification only — no engine code, ops or snapshot changes are
admitted by this document. Slice I is unblocked once this spec and its
ENGINE_OPS entry land; implementation must follow both. Backlog source:
`P11-motion-backlog.md` item I: "`State.graph` acyclic, topo-sort, step cap;
feeds expressions/properties, NOT pixel compositing. Needs admitted
node-type/port spec first." This document is that admitted spec.

## Scope decision

The graph is a **scalar value DAG**: nodes compute f64 outputs from f64
inputs, once per evaluation, in a deterministic topological order. It
produces numbers only — it cannot composite pixels, sample rasters, or
drive any render-stage decision. Pixel/node compositing (AE-style layer
graphs) is explicitly out of scope and stays out unless a later slice
reopens it.

Relationship to slice D: the graph and expressions share the same value
domain (f64, same property bounds, same sanitize/clamp rule) but are
separate mechanisms in v1. A graph node output reaches a layer property
through an explicit **binding** (below); expressions reach properties
through source text. The two never reference each other — no
`graph()` call inside expression grammar and no expression node kind.
This keeps both evaluators acyclic by construction and avoids a combined
dependency solver.

## Model

`State.graph` (serde-defaulted, `skip_serializing_if` empty-equivalent):

```
graph := { nodes: [Node], next_node_id: u64 }
Node  := { id, kind, params?, inputs: { pin: EdgeRef } }
EdgeRef := { node: u64 }            -- reads that node's `out`
         | { const: f64 }          -- literal input, no edge
```

- Node `id`: monotonic positive safe integer from `next_node_id`, same
  discipline as layer/key/comp ids.
- Every node has exactly one output pin named `out` (f64). Inputs are a
  fixed per-kind pin set; every declared input pin must be present exactly
  once, valued either as an edge ref or a const literal.
- `params` is a per-kind bounded object (e.g. `clamp`'s `lo`/`hi` may be
  const pins instead — see below; params exist only where a kind needs a
  non-input constant). Prefer pins over params wherever possible so the
  graph stays a pure DAG of f64.

Caps (inside the existing 16 MiB state cap, enforced by `validate`):

- ≤512 nodes, ≤2048 input edges total (each input pin holds at most one
  ref), ≤64 const-valued pins per node implicit in pin-count bounds.
- Node params, when present: finite f64 within ±1e7, ≤8 params per node.
- Names/tags: none — nodes are anonymous beyond `id`; UI naming is a host
  concern layered on ids later.

## Admitted node kinds (closed enum, `deny_unknown_fields`)

Sources (0 input pins):

| kind | out |
| --- | --- |
| `const` | params.value (or a single const pin — pick one form at impl; spec prefers `params:{value}`) |
| `time` | owning-comp local `time_s` (same mapping as expression `time`) |
| `frame` | `floor(time*fps)` of owning comp |
| `fps` | owning comp rational rate as f64 |
| `duration` | owning comp `duration_s` |
| `property` | resolved value of `{layer, property}` — params carry `layer` id + `property` name |

Unary math (1 input `in`): `abs floor ceil round trunc sign sqrt cbrt exp
ln log10 sin cos tan asin acos atan mod? ` — `mod`/`pow`/`atan2`/`hypot`/
`min`/`max`/`clamp`/`lerp`/`smoothstep` are the multi-input set:

| kind | pins |
| --- | --- |
| `neg`, `not` | `in` |
| `add sub mul div` | `a`, `b` |
| `min max pow atan2 hypot` | `a`, `b` |
| `clamp` | `v`, `lo`, `hi` |
| `lerp` | `a`, `b`, `t` |
| `smoothstep` | `e0`, `e1`, `x` |
| `select` | `cond`, `a`, `b` (cond ≥0.5 → a else b; ternary equivalent) |
| `and or` | `a`, `b` (nonzero → 1.0) |
| `eq neq lt lte gt gte` | `a`, `b` (→ 1.0/0.0) |

`mod` is admitted as `mod(a,b)` = IEEE `a - b*floor(a/b)`-style remainder
matching the expression grammar's `%`; division by zero follows the same
non-finite propagation rule as expressions (sanitize only at consumers).

`property` source nodes read the **pre-binding** resolved value: the
layer property's curve/base value *before* any graph binding is applied,
and expressions are excluded from `property` reads entirely (an
expression-owned property reads as its base+curve value, which is the
cleared/absent value — documented, deterministic). This single rule makes
graph evaluation acyclic across the layer boundary: graph outputs can
depend on un-bound property values, never on other graph outputs through
a property.

## Property bindings

A binding attaches a graph node output to a `(layer, property)` cell:

```
binding := { layer: u64, property: Property, node: u64 }
```

Stored on `State.graph.bindings: [Binding]` (≤128 bindings — one per
bindable property per layer worst case is 128×13; the tighter 128 cap
keeps binding density honest). Validation rules:

- Exactly one value source per `(layer, property)`: a binding conflicts
  with a non-empty `Curve` on that property **and** with a slice-D
  `PropertyExpr` — all three are mutually exclusive, last-write-wins with
  atomic clear, same precedent as expression↔keys. `setGraph` (below)
  performs the clears; `setPropertyKeys`/`setExpression` must symmetrically
  drop a conflicting binding in their journal entry.
- Bound `property` must satisfy the same kind rules as curves
  (`rx`/`ry`/`z` require `transform3d`, `path_progress` requires `path`,
  `sx`/`sy` sign rules apply to the *result* at eval, not the binding).
- The bound layer must exist in some composition; `validate` re-checks on
  restore including dangling layer/node ids after `removeLayer`/
  `removeComposition`/`reparentLayer` — structural ops that strand a
  binding reject atomically, matching the matte/parent_id precedent.
  `duplicateComposition` remaps binding `layer` ids like `parent_id`.

## Evaluation order and determinism

Per `evaluate`/`renderFrame` call:

1. Evaluate all curves/base values for every layer (existing pass).
2. Topo-sort `graph.nodes` once per call: Kahn's algorithm over input
   edges, ties broken by ascending node id — total order, platform-stable.
   Cycles cannot exist (rejected at write/restore), but the sort still
   verifies acyclicity defensively; a detected cycle resolves all
   downstream nodes to 0.0 rather than looping.
3. Evaluate each node once in topo order, memoized; `property` sources
   read step-1 values (pre-binding). Each node eval is O(1) arithmetic —
   ≤512 nodes ⇒ ≤512 evals per frame, trivially inside any step budget.
   The backlog's "step cap" is therefore the node cap itself plus a
   defensive per-call op counter (≤4096 primitive ops) that saturates to
   0.0 on exceed.
4. Apply bindings: bound property = node `out`, sanitized (non-finite →
   0.0, finite → clamped to `Property::bounds`) exactly like expression
   results.
5. Continue the existing pipeline (path offset, parent compose, render)
   unchanged — bindings land at the same point curve values do.

`evaluate(t)`/`renderFrame(t)` remain pure functions of `t`: no clock, no
I/O, no host calls, seek-safe both directions. `time`/`frame`/`fps`/
`duration` source nodes evaluate against the **owning composition's**
local time — the duration-scaled time that composition's layers already
see for curve evaluation — not the root clock. One graph serves all
compositions; nodes are shared, so a `time`-family node feeding bindings
in two compositions evaluates once per consuming comp context (memoized
per comp-local time; ≤16 comps bounds the multiplier). The alternative
(graph-global root time) was rejected: it would make nested-comp bindings
inconsistent with the curve time model every other property already uses.

## Snapshot representation

`graph` rides `State` as additive serde-defaulted state: schema stays 2,
graph-free documents serialize byte-identically, old readers fail closed
on the unknown `graph`/`bindings` keys (accepted schema:2 cost). Node
kinds are a closed serde enum; unknown kinds reject on restore. Restore
validates the full graph (kind/pin-shape, edge targets exist, acyclic,
caps, binding exclusivity and referential integrity) before replacing
state/history — same atomic gate as every other feature.

## Ops

| Op | Payload | Result | Notes |
| --- | --- | --- | --- |
| `setGraph` | `{nodes?, bindings?}` or `null` | `{ok}` | Full-replacement of graph nodes and bindings (the `setLayerEffects`/`setPropertyKeys` precedent — no incremental add/remove/connect ops in v1). `null`/empty clears. Whole candidate validates (shape, caps, acyclicity, binding exclusivity vs curves/expressions, referential integrity) before one journal entry/event; equal write eventless; locked-layer bindings reject. Clears performed on conflicting curves/expressions happen in the same journal entry. |

`describe` returns the graph verbatim; `evaluate` reports bound properties
in the same resolved-value fields as today — no output shape change.
Read ops record nothing, emit nothing.

## Failure semantics

- Write/restore validation failures: `Validation`/`InvalidCommand`,
  atomic, state intact.
- Defensive runtime cycle/op-cap exceed: affected downstream values →
  0.0, frame still renders (cannot happen for validated state; the guard
  exists for corrupted-in-memory invariants only).
- Non-finite node outputs propagate IEEE-style and sanitize at binding
  consumers (0.0 / property-bound clamp), identical to slice D.

## Deferred (explicit)

- Multi-output/multi-type nodes (vectors, colors, strings, booleans as
  distinct types), loop/feedback nodes, subgraphs/groups, node metadata
  (names, positions, colors) — UI concern.
- Any pixel-domain node: textures, samplers, compositing, per-pixel
  graphs. The backlog's "NOT pixel compositing" is a hard boundary.
- Expression↔graph cross-references (`graph()` in expressions, `expr`
  node kind), shared dependency solver.
- GPU/parallel evaluation, incremental re-eval caching across frames
  (each call re-evaluates all nodes — ≤512 O(1) evals is already trivial).
- Per-node UI, AE-style node editor integration, integration with the
  render queue (J1) beyond feeding property values.

## Acceptance criteria for the implementation slice

1. ENGINE_OPS motion table gains the `setGraph` row and the graph paragraph
   **before** code merges; doc and engine stay in sync.
2. `cargo test -p motion-engine` covers: node-kind/pin validation matrix,
   edge-target and cap rejection, cycle rejection at write and hostile
   restore, topo-order determinism (same graph → same values regardless of
   node insertion order), `property` source pre-binding read semantics,
   binding exclusivity clears in both directions (graph vs keys vs
   expressions), `time`-family per-comp-context evaluation incl. nested
   comp scaling, non-finite sanitize/clamp, seek determinism, undo/redo
   atomicity, equal-write eventless, `duplicateComposition`/`removeLayer`
   binding remap/strand rejection, snapshot round-trip and schema:2
   byte-identity for graph-free docs.
3. `pnpm --filter @nitro-forge/motion test` gains an nf-cli case driving a
   small graph (e.g. `time → mul → binding on tx`) through `setGraph` →
   `evaluate`/`renderFrame`; typecheck clean.
4. ROSTER entry records executed checks truthfully; no claim of pixel
   compositing, multi-type nodes, or UI.
