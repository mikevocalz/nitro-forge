# P11 Motion slice D — bounded expressions spec

2026-11-08. Specification only — no engine code, ops or snapshot changes are
admitted by this document. Slice D is unblocked once this spec and its
ENGINE_OPS entry land; implementation must follow both. Backlog source:
`P11-motion-backlog.md` item D.

## Scope decision

Backlog item D specifies a hand-rolled parser producing an AST with grammar
arithmetic/comparison/ternary + whitelisted functions + `time`/`frame`/`fps`/
`duration`/`this.<prop>`/`comp().layer()` refs, bounds source ≤4 KiB, AST
≤512 nodes, eval ≤10k steps, and leaves open whether an expression owns or
yields to keys. This spec chooses the **expression grammar** (not a
Design-style declarative binding) because expressions are the admitted
backlog form and Design bindings cannot express the time-varying math Motion
needs. Design's `Binding` precedent is cited only for the storage shape:
bindings live on `State`/`Layer`, resolve at read/eval time, and never bake
into authored values.

## Model

- Storage: `Layer.expressions: Vec<PropertyExpr>` where
  `PropertyExpr { property: Property, source: String }`. One expression per
  `(layer, property)`; `source` is the UTF-8 expression text, not a parsed
  AST. Parsing happens at op time and again on `restore` (hostile input
  rejects, never partially parses).
- Wire/property names reuse the existing `Property` enum exactly: `tx`,
  `ty`, `sx`, `sy`, `rotation`, `ox`, `oy`, `opacity`, `path_progress`,
  `rx`, `ry`, `z`. All are scalar f64. Effect params, emitter params, matte
  params, blend/clip flags and non-scalar fields are **not** bindable in v1.
- Ownership rule (the backlog's open question): **mutually exclusive,
  last-write-wins with atomic clear.** A `(layer, property)` may have keys,
  an expression, or neither — never both. `setExpression` on a property
  with existing keys deletes that property's `Curve` in the same journal
  entry; `setPropertyKeys` on a property with an expression deletes the
  `PropertyExpr` in the same journal entry. This mirrors the `setMotionPath`
  precedent (path null clears `path_progress` curve atomically). Expressions
  do not nest inside keys and keys do not nest inside expressions.
- `evaluate`/`renderFrame` resolve each property as: expression value if an
  expression exists, else curve-evaluated value, else layer base value.
  `this.<prop>` reads the **resolved** value (expression-aware) of the named
  property on the same layer — see dependency rules below.

## Grammar

Hand-rolled recursive-descent parser → AST, no eval-time parsing. Values are
f64 only; comparisons and logic return 1.0/0.0 (no separate bool type —
keeps the evaluator and snapshot trivially bounded).

```
expr    := ternary
ternary := logic ("?" expr ":" expr)?
logic   := cmp (("&&" | "||") cmp)*
cmp     := add (("<"|"<="|">"|">="|"=="|"!=") add)*
add     := mul (("+"|"-") mul)*
mul     := unary (("*"|"/"|"%") unary)*
unary   := ("-"|"!") unary | postfix
postfix := primary ("." ident ("(" args ")")?)?   -- property refs only
primary := number | ident | ident "(" args ")" | "(" expr ")"
```

Identifiers:

- `time` — seconds, the explicit `time_s` argument of `evaluate`/
  `renderFrame`, mapped into the owning composition's local time exactly
  like curve evaluation (nested comps see their duration-scaled local
  time).
- `frame` — `floor(time * fps)` of the owning composition; `fps` — rational
  frame rate as f64; `duration` — owning composition `duration_s`.
- `this.<prop>` — resolved value of `<prop>` on the owner layer, where
  `<prop>` is any bindable `Property` name.
- `layer(<id>).<prop>` — resolved value of `<prop>` on layer `<id>` **in the
  same composition** as the owner. Cross-composition reads are deferred
  (see Deferrals); `comp(<id>)` selectors are not admitted in v1.
- Bare identifiers other than the four time constants and function names
  reject at parse time.

Whitelisted functions (closed set, all pure f64→f64, deterministic across
platforms — implementations must avoid libm-variant-sensitive results or
document platform-exactness like particles do):

`abs, floor, ceil, round, trunc, sign, sqrt, cbrt, exp, ln, log10, sin, cos,
tan, asin, acos, atan, atan2, pow, hypot, min, max, clamp(v,lo,hi),
lerp(a,b,t), mod, smoothstep(e0,e1,x)`.

`random`/noise/time-source functions are **excluded** — determinism is the
contract; there is no clock and no host call anywhere in evaluation.

## Evaluation determinism

- Expressions are pure functions of document state plus the explicit
  `time_s` input. No clock, no I/O, no host calls, no ambient state.
- Dependency resolution: within one layer, `this.<prop>`/`layer().<prop>`
  references form a directed graph over `(layer, property)` cells across
  the whole document. `validate` (and `setExpression`) topo-sort this graph
  per evaluation; **any cycle rejects atomically** at op/restore time —
  e.g. `tx` expr reading `this.ty` while `ty` expr reads `this.tx`, or a
  two-layer ping-pong. Self-reference (`tx` expr reading `this.tx`) is a
  cycle and rejects.
- Cross-layer reads see the referenced property's resolved value computed
  in the same pass; the topo order is the only order, so results are
  order-independent and seek-safe forward/backward (same guarantee as
  particles: `evaluate(t)` is a pure function of `t`).
- Step accounting: the grammar has no loops, recursion or unbounded
  iteration, so a single expression evaluation visits each AST node at
  most once per referenced-cell resolution. The ≤512-node AST cap already
  bounds one eval far below the 10k-step ceiling; the runtime step counter
  is a defensive guard that, on exceed, resolves the property to 0.0 and
  records nothing (see Failure semantics). Documented worst case: ≤128
  layers × 13 properties × 512 nodes ≈ 852k node visits per frame — bounded
  but real; hosts should treat heavy expression documents as CPU cost.

## Bounds and validation

- `source`: ≤4096 UTF-8 bytes, must parse, AST ≤512 nodes (counted at
  parse), ≤64 function-call nodes (subset of AST cap, keeps deep call
  nesting bounded).
- Result values: finite f64 required at each op; NaN/±inf **propagates**
  through arithmetic (IEEE) and is sanitized only at the property
  boundary: non-finite result → `0.0`; finite result → clamped into the
  property's existing `Property::bounds` range (`opacity`/`path_progress`
  0..=1, `sx`/`sy` ±1e4, rest ±1e7). Clamping, not rejection — evaluation
  is read-only and cannot fail the frame.
- `validate` re-checks on restore: parseable source, AST/node caps,
  property names valid for the layer kind (`rx`/`ry`/`z` still require
  `transform3d`, `path_progress` still requires `path`), mutual exclusion
  with that property's curve, referenced layer ids exist in the same
  composition, and the whole-document expression dependency graph is
  acyclic. All rejections are atomic before state/history replacement.
- New caps ride inside the existing 16 MiB serialized-state cap; no new
  top-level budget is introduced. Expression sources count toward it like
  every other field.

## Snapshot representation

`Layer.expressions` is additive serde-defaulted and
`skip_serializing_if` empty — schema stays 2, expression-free layers
serialize byte-identically to current snapshots, and old readers fail
closed on the unknown field (the accepted schema:2 cost already paid by
blend/clipped/matte/effects/path/emitter/transform3d). `describe` returns
the expressions verbatim inside layer JSON; `evaluate` output is unchanged
in shape — resolved values land in the same fields curves already produce.

## Ops and event/undo semantics

| Op | Payload | Result | Notes |
| --- | --- | --- | --- |
| `setExpression` | `{layer, property, source}` | `{ok}` | `source` string ≤4 KiB or `null` to clear. Full validation (parse, caps, mutual exclusion, dependency acyclicity) before one journal entry/event; equal source is eventless; `null` on an absent expression is eventless. Locked layers reject. Clearing also removes the `(layer,property)` curve per the ownership rule — one atomic journal entry covers both deletions. |

Undo/redo treat the expression, the cleared curve and any replaced curve as
one entry, exactly like `setMotionPath` clearing `path_progress`. Read-only
paths (`describe`, `evaluate`, `renderFrame`) never record. No new event
types; `document:changed` only.

## Failure semantics

- Parse/validate failures at op time: `Validation`/`InvalidCommand`,
  state intact.
- Runtime step-cap exceed or non-finite intermediate: sanitized per the
  bounds rule; evaluation never fails a frame for expression content.
- Hostile restore with unparseable source, oversized AST, dangling
  `layer()` ref, mutual-exclusion violation or dependency cycle: rejects
  atomically, document/history untouched.

## Deferred (explicit)

- Host-side scripting (JS/WASM expression hosts), string/color/vector
  outputs, per-effect/per-emitter/per-matte parameter binding.
- Cross-composition `comp(<id>)` layer reads and `this` on nested-comp
  instances beyond the containing comp's local time already defined.
- `random`/seeded noise (a pure `rand(seed,channel)` hash like particles
  could be admitted later without breaking determinism).
- Expression editing UI, linting, or AE-style pick-whip.
- Expressions inside snapshots of other engines; no ENGINE_OPS entries for
  non-Motion engines.

## Acceptance criteria for the implementation slice

1. ENGINE_OPS motion table gains the `setExpression` row and the
   expressions paragraph **before** code merges; doc and engine stay in
   sync per AGENTS.md.
2. `cargo test -p motion-engine` covers: parse/bounds rejection matrix,
   mutual-exclusion atomic clear both directions, dependency-cycle
   rejection (self, two-property, two-layer), `time`/`frame`/`fps`/
   `duration` correctness at non-zero and nested-comp-scaled times,
   whitelisted-function spot checks, non-finite→0 and bound clamping,
   seek determinism (same `t` → identical bytes forward and backward),
   undo/redo atomicity, equal-write eventless, hostile-restore rejection
   preserving state.
3. `pnpm --filter @nitro-forge/motion test` gains an nf-cli case driving a
   real expression through `setExpression` → `evaluate`/`renderFrame`;
   typecheck clean.
4. ROSTER entry records executed checks truthfully; no claim of UI,
   cross-comp reads, or non-scalar binding.
