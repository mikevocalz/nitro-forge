# Motion 2D source slice proposal

This is a proposed backend boundary, not a completed P11 engine or product. Photo currently appends identity 7; reserve Motion identity 8 only after its registration review. No shared registration changes are made here.

## Persistent schema (Motion snapshot schema 1)

```
MotionState {
 schema: 1,
 title: string,
 width: u32, height: u32,
 duration_s: f64,
 frame_rate: { num: u32, den: u32 },
 next_layer_id: u64, next_key_id: u64,
 layers: Layer[] // bottom to top
}
Layer {
 id: u64, name: string, visible: bool, locked: bool,
 shape: PrismShape, // existing rect or ellipse geometry and RGBA8 fill
 transform: { tx, ty, sx, sy, rotation, ox, oy }, // existing Prism units/formula
 opacity: f64,
 curves: Curve[]
}
Curve {
 property: 'tx'|'ty'|'sx'|'sy'|'rotation'|'ox'|'oy'|'opacity',
 keys: Key[]
}
Key {
 id: u64, time: f64, value: f64,
 interpolation: 'hold'|'linear'|'bezier',
 in_handle: {time:f64,value:f64}|null,
 out_handle: {time:f64,value:f64}|null
}
```

A curve's property identifies one typed field; arbitrary property strings cannot become expressions. Base value comes from that field in the layer. Global monotonic counters retain layer/key identities across edits; UI IDs are lossless decimal strings. One curve per layer/property. No nested compositions, parent IDs, external resource handles, frame caches, playhead, selection or render-job state in this schema.

Handles are absolute time/value coordinates, matching inspected NYC-Tron `motion-curves.ts`, rather than normalized easing tuples. Key interpolation controls the outgoing segment. Missing handles default to the straight segment's one-third/two-third controls. Before/after the keyed range hold the first/last value; an empty curve returns the base field. An exact key time returns that key's value (including hold discontinuities). Cubic time is inverted by a fixed 64-step bisection before evaluating value. Rotation is unwrapped degrees; no implicit shortest-angle interpolation. The first public-Prism-command implementation requires scale magnitude at least 1e-6. Scale keys/handles retain the base scale sign, so animation cannot cross zero. Collapsed rendering is not claimed through a command API that rejects it.

## Operations and atomicity

| Op | Payload / result | Behavior |
| --- | --- | --- |
| `new` | `{title?,width,height,duration_s,frame_rate}` → `{ok}` | Validate complete header first, reset layers/counters in one change. |
| `describe` | `{}` → full schema | Read only. |
| `setComposition` | `{title?,width?,height?,duration_s?,frame_rate?}` → `{ok}` | Validate all retained key times against proposed duration before mutation. |
| `addShapeLayer` | `{name?,shape}` → `{layer_id}` | Prism rect/ellipse schema; actual supported primitives only. |
| `updateLayer` | `{id,name?,visible?,locked?,transform?,opacity?,shape?}` → `{ok}` | Merge partial values, validate full candidate; lock blocks content/transform edits but can be cleared explicitly. |
| `removeLayer` | `{id}` → `{ok}` | Remove layer and its owned curves atomically. |
| `setLayerOrder` | `{order:u64[]}` → `{ok}` | Exact unique permutation; retains identities/curves. |
| `setPropertyKeys` | `{layer,property,keys:KeyInput[]}` → `{key_ids}` | Atomic complete-curve replacement. Existing IDs must belong to this curve; omitted ID allocates globally only after full validation. Empty list clears this property's animation. |
| `evaluate` | `{time_s}` → `{layers:[{id,transform,opacity,visible,shape}]}` | Finite time within composition; deterministic model evaluation only. |
| `renderFrame` | `{time_s}`, binary preferred → `{width,height,pixels_b64?}` + RGBA output | Actual evaluated Prism composite. Read only, transparent background. |
| shared `batch` | Existing core command batch | Stage clone with private one-entry journal; commit original once only when state changed. |

All writes fully validate the candidate before recording one whole-state journal entry. Equal/empty changes preserve undo/redo and emit no events; real changes emit exactly one `document:changed`. A failed op, failed batch or restore leaves state/history unchanged. Snapshot keeps the existing NFD1 format byte/header unchanged, with kind="motion" and schema=1 in its JSON payload; Motion=8 applies only to native enum and NFC1/NCC1 tags; restore validates every counter/ID, dimension, curve and budget before replacement. Undo/redo use shared bounded Journal (16, with Arc/COW state/layer/key storage), resetting only on successful restore. Counter overflow or IDs above 9,007,199,254,740,991 (the host safe-integer ceiling) are errors before mutation. `renderFrame`/`evaluate` never record history or emit change events.

## Actual rendering reuse

`motion-engine -> prism-engine -> ignition-core` is acyclic. Motion owns evaluation and persistent state. For one frame create a temporary `PrismEngine::new(width,height)`, issue real `addShape` commands in bottom-to-top order, then existing `setLayerTransform`, `setLayerOpacity` and `setLayerVisible` with evaluated values. Use the returned Prism IDs locally; they do not replace Motion identity. Call `Command::new("flatten", {}).with_binary(None)` for binary result support and pass its real RGBA output through a read-only Motion result. The inspected Prism constructor starts with an empty layer vector; no raster layer is allocated or needed. Do not persist this temporary engine or its journal. Prism's public Engine command API is sufficient, so no renderer copy or private-module exposure is needed.

Core Command::with_binary(None) and Prism flatten.with_bytes already establish the binary-output contract. Before registration, check mutation journal temporary allocation cost. The initial frame cap below limits that path. Later optimization may add a reviewed Prism scene-entry API; this proposal does not invent one. Cancellation should checkpoint between materialized layers and before/after flatten, with no claim of cancellation within Prism's synchronous flatten.

## Explicit initial budgets

- Width/height 1..4096 and total output at most 1,048,576 pixels (4 MiB RGBA); reject rather than downsample silently.
- At most 128 shape layers and 128 curves across the composition, at most 10,000 keys per curve and 100,000 keys total, matching canonical timeline page ceilings.
- Duration >0 and at most 604,800 seconds; key times within [0,duration], adjacent keys separated by at least 1e-6 seconds.
- Finite transform/key/handle values bounded to ±1e7 for translation/origin/rotation, ±1e4 for scale; opacity in [0,1]. Validate cubic handle values against the same property range, with each incoming/outgoing handle time inside its adjacent segment. No value clamping on restore or import.
- Rational frame rate num 1..240000, den 1..1001, quotient 1..240; time remains seconds, frame timestamps derived as integer frame*den/num without accumulated additions.
- Title/name at most 512 UTF-8 bytes. At most 16 MiB serialized snapshot payload, checked before parsing/restore; apply shared envelope size checks too. Validate proposed whole state, not just incoming arrays, before allocation-heavy operations.

## Adoption gaps and acceptance

The canonical timeline/value/speed/curve models can map their stable string property/key IDs to `(layer,property,key)` with supplied authoritative bounds. Their UI-side curve insertion/subdivision math is not an engine implementation; all supplied keys must still be validated here. Gallery spring easing is excluded until an actual spring evaluator and persistent contract are added. CompositionLayerTree's nesting/composition/camera/light variants are not supported by flat shape layers. No node graph execution, matte/effect processing, expression sandbox, particles, 3D, media decoder, encoder, destination artifact or render queue is claimed. `renderFrame` returns one genuine bounded RGBA frame, not an encoded movie or file export.

Registration must append Motion=8 consistently across core string parsing/envelope identity, CLI and FFI factories, C/C++/TS engine kind tables and host codegen, without changing existing 0..7 identities. Native engine interfaces and app rollout wait for root coordination. Required focused checks after implementation: real Prism RGBA pixels at distinct evaluated times, atomic validation/history/redo/batch, snapshot roundtrip/corrupt restore, budget exhaustion and identity stability. Native lifecycle, target builds and complete P11 acceptance remain separate work.

## Prototype evidence

`curve.rs` is a dependency-free standalone scalar evaluator prototype, not workspace registration. `rustc --edition=2021 --test tooling/motion-prototype/curve.rs -o /tmp/motion-curve-prototype-tests` and that test binary passed three focused tests: endpoint/hold/linear semantics; nonuniform cubic-time inversion versus parameter-time substitution; and whole-curve invalid-tail/key-spacing/handle/time validation. This supplies mathematical evidence only. It does not prove rendering, engine history, persistence, registration or P11 completion.
