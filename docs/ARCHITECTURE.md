# Nitro-Forge Architecture — Ignition Contracts

Status: ratified. All product engines (Prism, Cadence, Splice, Folio, Pitch, Tally, Quill, Photo, Motion, Design, Draft and Scene)
implement against these contracts. Changes require touching every engine, so they are
deliberately small.

## 1. System boundaries

```
React Native UI (per-product screens)
        │  JS / JSI
        ▼
@nitro-forge/<product>  (TypeScript API — command builders, typed errors, doc handles)
        │  Nitro HybridObject (async, dispatched on engine thread)
        ▼
Nitro-generated C++ bridge ─────────────── same surface compiled for WASM on web
        │
        ▼
<product>-engine  (pure Rust, no platform deps)
        │  implements
        ▼
ignition-core::Engine trait
```

Rust engines are the **single source of truth** for document state. The UI never edits
document data directly — it dispatches commands. AI features (optional) issue the same
commands through the same host; engines work fully offline with no provider.

## 2. The Engine contract (`ignition-core`)

```rust
pub trait Engine: Send + 'static {
    fn kind(&self) -> EngineKind;
    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError>;
    fn snapshot(&self) -> Result<Vec<u8>, EngineError>;
    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError>;
    fn undo(&mut self) -> Result<bool, EngineError>;
    fn redo(&mut self) -> Result<bool, EngineError>;
}
```

### Threading
- One `Engine` instance owns one open document. Engines are `Send` but never `Sync`:
  exactly one thread may drive an engine at a time. The host assigns each document
  handle to a dedicated engine worker and serializes calls.
- JS-facing Nitro methods are `async`; they hop to the engine worker so the UI thread
  never blocks on document work.
- Engines never block on I/O. File bytes cross the boundary in `restore`/`snapshot`.

### Ownership & memory
- Document memory lives entirely inside the Rust engine. The host holds only a `u64`
  handle; closing a document drops the engine.
- `snapshot()` returns owned bytes; the host copies them out. No shared buffers, no
  lifetime leakage across FFI.
- Large immutable payloads inside an engine (e.g. Prism pixel buffers, Folio page
  objects) use `Arc` so structural undo entries are cheap copies, not deep clones.

### Commands
- Commands are plain data: `{ op, payload }`, serialized as JSON. Every engine also
  accepts the reserved ops `__undo`, `__redo`, `__snapshot`, `__restore` is never sent
  through `apply` — it uses `restore()`.
- `apply` is atomic: either the command fully applies and returns events, or it
  returns an `EngineError` and document state is unchanged. Engines validate before
  mutating.
- Every successful `apply` returns `CommandResult { events, data }`. `data` carries
  op-specific results (e.g. created ids). `events` describe state changes for
  listeners (`document:changed`, `selection:*`, `transport:*`, …).

### Undo/redo
- Engines maintain a bounded `Journal<T>` of engine-specific undo entries recorded
  *before* mutation (e.g. a cell's previous value, a clip's previous span, the pixel
  region about to be overwritten).
- `undo`/`redo` return `Ok(false)` when the respective stack is empty — never an error.
- A new mutating `apply` clears the redo stack; read-only commands preserve it.

`__batch` is an engine-level atomic boundary for compound gestures. Each engine
stages its document state with a temporary one-entry journal, applies the bounded
command plan there, and records its original state once before publishing a
successful mutation. Original history is neither copied nor cleared while
staging. Read-only and rejected plans leave the original journal untouched.
Prism's shared raster buffers retain copy-on-write ownership. Native queues
already serialize the whole command, so no other document operation observes
an intermediate step. This adds no C ABI layout or generated Nitro type changes.

Batch execution has two paths behind `Engine::apply_batch`. Plain `apply`
runs each step through `apply` on the staged clone. Task-driven `apply_long`
routes `__batch` to `apply_batch` with the `TaskContext`, which runs every
step through the staged engine's own `apply_long` on a scoped child context:
each step observes cancellation and reports progress into its own slice of
the task's progress, so a heavy op inside a batch (for example Cadence
`render`, which returns base64 JSON inside a batch) checkpoints mid-step
instead of running uninterruptible. Splice's `batch` op applies the same
per-op routing on its scratch engine. Cancellation semantics are unchanged
and atomic: a cancelled or failed step returns `Cancelled`/the step's error,
the staged clone is dropped, and the committed document, IDs and journal are
untouched — a cancelled batch is rejected whole, never partially applied.
Synchronous `apply`/`nf-cli` batches keep the original non-interruptible
behavior.

### Errors
`EngineError { code, message, recoverable }` with a closed `ErrorCode` enum:
`InvalidCommand | NotFound | Validation | Serialization | OutOfBounds | Internal`.
`recoverable = true` means the document is intact and the user may continue; hosts
surface these as rejections, never crashes.

### Snapshots
Versioned envelope: `b"NFD1" || u8 format_tag || u32 LE len || payload`.
`format_tag` 0 = JSON. `restore` validates magic + version + length before decoding
and must reject truncated/foreign data with `Serialization` errors. Save → reopen is
the required round-trip guarantee for every product.

### Versioning
Envelope version and command schema version are independent. A `Command` may carry
`v`; engines currently accept only v1 and reject anything else with `Unsupported`.
(Reserved field; defined now so future engines can evolve without breaking hosts.)

### Failure recovery
- A panic inside `apply` must not corrupt the journal: engines validate first and only
  mutate committed state; `nf-cli` and the Nitro host wrap calls so a panic becomes an
  `Internal` error and the session is marked dead (subsequent calls fail cleanly).
- The host may `restore` from the last successful `snapshot` to resurrect a session.

## 3. Package layout (per product)

```
packages/<product>/
  package.json            # @nitro-forge/<product>
  nitro.json              # Nitrogen codegen config
  src/
    index.ts              # public API
    <Product>Engine.nitro.ts   # HybridObject spec
    commands.ts           # typed command builders (single source for op names)
    document.ts           # DocumentHandle wrapper
    errors.ts
  rust/                   # <product>-engine crate (workspace member)
  tests/                  # vitest e2e via nf-cli (real Rust engine)
```

## 4. Verification transport

Nitro is the production transport. For CI and TS-side tests, `nf-cli` (a workspace
binary in `rust/nf-cli`) exposes every engine over stdin/stdout JSON-lines. Vitest
suites spawn it and drive real open → modify → save → reopen → undo flows against
compiled Rust. iOS/Android/WASM packaging is tracked in `docs/ROSTER.md`.

## Additive native tasks and binary commands (recovery phase 6)

The pinned Nitro nightly-120 factory returns `ForgeDocument` and `ForgeMediaCache` resources. `document.applyBinary(command, input?)` returns `{dataJson, events, output?: ArrayBuffer}`; `startTask(command, input?)` returns a native-owned `ForgeTask` with `progress`, `cancel()` and `result()`. Document work retains FIFO order with snapshot/restore/close. Cancellation uses atomic control outside that queue, so it can reach a running task. Dropping the JS resource does not free control while the accepted job holds it. These methods do not change the JSON EngineHost transport.

The additive C ABI in `nf_v1.h` preserves existing result layouts. Binary inputs and outputs are capped at 256 MiB; command JSON remains capped at 32 MiB. Input is copied before leaving JS to prevent caller mutation; Rust results are copied to owned native storage and transferred as ArrayBuffer. This is not a zero-copy claim. Callers must free each C result exactly once and retain the opaque task through all worker/observer calls.

`Engine::apply_long` checks cancellation before atomic operations and forwards
`__batch` to `Engine::apply_batch` with the task context. Cadence synthesis checks every 8192 samples and between mix stages; EQ/compressor processing retains continuous state and is not interrupted mid-stage. Folio save and Quill DOCX export add safe read-only checkpoints. Other commands may finish after cancellation was requested; a successful atomic mutation is never reported as cancelled. `cancelled` is a recoverable error. Progress is monotonic checkpoint progress, not elapsed-time estimation; `TaskContext::scoped` gives batch steps disjoint progress windows so per-step `apply_long` progress composes into task-wide progress. Media decoding is a separate Expo queue and is not cancelled by ForgeTask.

The media cache owns derived bytes only. Capacity is 1..256 MiB, with at most 4096 entries and 1024-byte keys. Put copies input before queueing; get returns a copy and updates LRU order. Close drains earlier work, clears bytes and rejects later operations. Keys must encode source revision and decode options. It neither persists engine documents nor generates waveforms/thumbnails itself. See recovery/PHASE6.md for executed checks and platform gates.


The registered Photo engine adds catalog descriptors and version identities to the shared contract. Original bytes, decoder resources and durable asset retention remain host-owned; the catalog performs no I/O or RAW processing. Photo appends persisted/native kind tag 7 without changing established tags 0–6. Its explicit photo/schema-1 snapshot payload is inside unchanged NFD1 framing. Native binaries must include the new registered factory before opening this kind; source registration alone does not establish a target build or app rollout.


The registered Motion engine appends native and NFC1/NCC1 tag 8 after Photo 7; tags 0–7 stay fixed. Its `kind:"motion",schema:1` JSON payload uses the unchanged NFD1 envelope header. Motion owns bounded flat 2D shape layers and scalar hold/linear/absolute-handle Bezier curves; frame evaluation materializes an ephemeral Prism engine and returns its actual RGBA composite through the original JSON/binary command result contract. It does not duplicate the renderer or own media/encoder resources. Slice J1 adds a durable bounded `render_queue` of frame-range jobs stepped one real RGBA frame per `renderQueueFrame` through the same ephemeral-Prism path — raw pixels and exact integer progress only, journaled and undoable like every mutation; no encoder exists, so encoded export remains unimplemented. Slice G1 adds an optional per-layer `transform3d` (`rx`/`ry` euler degrees + `z` depth, animatable through the same scalar curves) that is stored, snapshotted and curve-evaluated — `evaluate` reports an orthographic `projected_transform` affine — but does not affect the 2D raster output until true projection rendering lands; no camera or lights exist yet. Slice H adds `kind:"media"` layers storing an optional `{source_id,in_point}` footage reference only — `source_id` is an opaque host reference the engine never resolves and `in_point` is stored source time, so media layers render fully transparent (a staged 1x1 transparent raster keeps their stack slot) until the P03 transport contract supplies real pixels; no footage decode or render is claimed. Geometry/translation/origin/rotation bounds match Prism's public 1e7 coordinate limit, with scale magnitude 1e-6..1e4 and same-sign scale curves.

Motion validates the complete candidate before mutation and retains sixteen Arc/COW history entries under a 16 MiB serialized-state cap. Render tasks checkpoint between layers and before/after synchronous Prism flatten, without promising interruption inside that compositor. Snapshot opening uses the shared owning DocumentHandle.openSnapshot helper. Registration, focused host tests and generated enum checks do not establish a native target rebuild, app rollout, encoding queue or complete P11 acceptance.

The registered Design engine appends native and NFC1/NCC1 tag 9 after Motion 8. Its explicit design/schema-1 tree uses the unchanged NFD1 envelope, sixteen Arc/COW history entries and an 8 MiB encoded-state cap. Fixed frame trees evaluate row/column layout into validated world boxes and render actual ephemeral Prism RGBA. Ancestor visibility and authored edit locks are explicit; unlocked ancestor layout may change a locked child's evaluated geometry. Frames have visible overflow, without a clipping claim. Text nodes (layout boxes only), variables/modes/bindings, stored-but-unsolved constraints (C1/C2), materialized components/instances (slice D) and the prototype catalog (slice E — screens/hotspots/interactions/transitions with deterministic `prototypeGraph`/`resolvePrototypeEvent` reads; the engine owns no playback clock) have since landed. Glyph text layout, comments, presence transport, native consumer rebuild and application activation remain separate work.

The registered Draft engine appends native/checkpoint identity 10 after Design9. It owns bounded 2D points, segments, snap settings and linear coordinate constraints, with real rank/DOF/residual results and atomic solved geometry. Exact locked coordinates remain fixed. World viewport and selection are host-owned; projected finite paths use actual Prism RGBA. Schema1 NFD1 snapshots have an 8 MiB cap and sixteen Arc/COW history entries. This source registration does not supply general nonlinear CAD, 3D processing, native target acceptance or default product activation.

The registered Scene engine appends native and NFC1/NCC1 tag 11 after Draft 10; tags 0–10 stay fixed. Its `kind:"scene",schema:1` JSON payload uses the unchanged NFD1 envelope header. Per the P17 Track-B B0 decision the engine owns document state only — group/layer/mesh/camera/light nodes with TRS transforms and acyclic parent graphs, PBR-state materials matching the scene-render model, custom base64 mesh attributes and deterministic primitives — and never rasterizes: `renderFrame` emits the canonical scene description the host submits unchanged to the `rust/scene-render` service, keeping the "engines own state, hosts own pixels" split. Bounded Journal undo (32 entries) and an 8 MiB encoded-state cap apply as elsewhere; node-material DAG, UV packing, glTF/OBJ import, GPU tier and native target acceptance remain separate work.
