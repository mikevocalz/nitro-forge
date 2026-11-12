# F3: proposals for the three deferred studio-preview rows

Status: Proposed. Nothing in this file is implemented.
Date: 2026-11-11
Deciders: the repository owner, one decision per row
Baselines read: nitro-forge `master` at `0ad4ed2`; NYC-Tron-UI `main` at `693e068` (`v1.0.0-rc.1`)

Each row in `docs/NYC_TRON_UI_HANDOFF.md` ("Studio preview rows against
NYC-Tron-UI v1.0.0") is deferred because a Tron component offers a control
that the Forge engine behind it cannot honour. Each section below is an
ADR-style record with two options:

- **Option A** changes the component in NYC-Tron UI. Tron stays
  palette-agnostic and never imports `@nitro-forge/*`. Any change to a Tron
  public type after `rc.1` is a stop-and-report item, and it has to merge
  before Tron `rc.2` (prompt §7, step 3).
- **Option B** adds or extends an engine op in Forge. Tron is untouched.

The owner picks A or B per row. The recommendation at the end of each section
is input to that choice, not the choice.

Sources read for every row: the component source on Tron `main`, the engine's
`packages/<engine>/src/index.ts`, its section of `docs/ENGINE_OPS.md`, and its
Rust crate under `packages/<engine>/rust/src`.

---

## ADR F3-1: I-15 `PivotFieldList` and Tally pivots

### Context

`PivotFieldList` (`packages/ui/src/components/forge/spreadsheet/PivotFieldList.tsx`)
renders four zones, `rows`, `columns`, `values` and `filters`, and an
"Add <field> to <zone>" button per field and zone. Its only assignment
callback is `onAssign(fieldId, zone, signal)`. A filters assignment carries no
accepted values.

Tally stores a pivot as a spec (`pivot_ops.rs`). `PivotFilterInput` is
`{field, values}` and `valid_filter_values` rejects an empty `values` list
(1 to 64 values, each 1 to 512 bytes). `insertPivot` also needs
`source.range` and at least one `values` slot (`fields_ok`:
`!p.values.is_empty()`).

Two separate gaps follow:

1. Every "Add ... to filters" press produces a filter with no values, which
   Tally rejects.
2. On a workbook with no pivot, the first assignment cannot create one: there
   is no source range, and a first assignment to `rows` has no value slot.

Gap 2 does not need either option. The host keeps a draft spec in app state
(source range taken from the grid selection through a "Use selection as pivot
source" step outside the list, plus the zone assignments so far) and calls
`insertPivot` only once the draft has a source range and one value slot.
Later assignments call `updatePivot`. Both options below assume that host
work; they differ only on gap 1.

### Option A: filter values become part of the Tron contract

Filters turn into an opt-in capability. Without it, the filters zone and its
buttons do not render. With it, the component asks the host for a field's
values and shows a picker before it calls back.

```ts
// PivotFieldList.tsx (NYC-Tron UI)
export type PivotZone = 'rows' | 'columns' | 'values' | 'filters';
export type PivotAxisZone = Exclude<PivotZone, 'filters'>;

interface PivotAssignmentBase { id: string; fieldId: string }
export interface PivotAxisAssignment extends PivotAssignmentBase {
  zone: PivotAxisZone;
  aggregate: 'sum' | 'count' | 'average' | 'min' | 'max';
}
export interface PivotFilterAssignment extends PivotAssignmentBase {
  zone: 'filters';
  /** Accepted values, 1..maxValues. */
  values: readonly string[];
}
export type PivotAssignment = PivotAxisAssignment | PivotFilterAssignment;

/** Supplied by hosts that can filter. Omit it and the filters zone is not rendered. */
export interface PivotFilterCapability {
  /** Most values one filter may accept. Tally: 64. */
  readonly maxValues: number;
  /** Distinct values of a field, for the picker. Rejects with an Error the list shows. */
  listValues(fieldId: string, signal: AbortSignal): Promise<readonly string[]>;
  onAssign(fieldId: string, values: readonly string[], signal?: AbortSignal): unknown;
  onChangeValues(id: string, values: readonly string[], signal?: AbortSignal): unknown;
}

export interface PivotFieldListProps /* existing fields */ {
  onAssign: (fieldId: string, zone: PivotAxisZone, signal?: AbortSignal) => unknown; // narrowed
  filters?: PivotFilterCapability; // new
}
```

Caller examples:

```tsx
// Forge, Tally host
<PivotFieldList
  fields={fields}
  assignments={assignments}
  onAssign={(fieldId, zone, signal) => pivots.assign(fieldId, zone, signal)}
  filters={{
    maxValues: 64,
    listValues: (fieldId, signal) => pivots.distinctValues(fieldId, signal), // getRange over the source column
    onAssign: (fieldId, values, signal) => pivots.addFilter(fieldId, values, signal),
    onChangeValues: (id, values, signal) => pivots.setFilterValues(id, values, signal),
  }}
  {...rest}
/>

// A host with no filter support: no `filters` prop, no filters zone.
<PivotFieldList fields={fields} assignments={assignments} onAssign={assign} {...rest} />
```

Error and cleanup semantics: `listValues` runs under the list's existing
`useScopedControl` guard; a revision or scope change aborts its signal and the
picker closes. A rejected `listValues` shows its message in the existing
`ErrorMessage`. The picker refuses to confirm zero values or more than
`maxValues`. A `PivotFilterAssignment` with zero values, or a filter
assignment passed with no `filters` capability, throws `RangeError` at render
like the existing input checks.

Test that proves it (Tron, `packages/ui/tests/pivot-field-list.test.mjs` plus a
browser spec): without `filters`, no element named "Add <field> to filters"
and no filters header exist; with `filters`, pressing "Add Region to filters"
calls `listValues('region')`, selecting two values calls
`filters.onAssign('region', ['East', 'West'])` once, confirming zero values is
impossible, and a scope change during `listValues` aborts it with no callback.
Forge then adds `apps/studio-preview/src/tally-pivot-wiring.test.ts`, which
drives the same calls into a real `TallyEngine` and asserts `describePivot`.

| Dimension | Assessment |
| --- | --- |
| Effort | 2 to 3 days in Tron (picker, discriminated assignment type, tests, browser fixture); 1 day Forge wiring |
| Risk | Medium. New picker UI inside a component with drag-and-drop ownership code; needs its own accessibility pass |
| Public API impact | Breaking after `rc.1`: `PivotAssignment` becomes a union, `onAssign` narrows to `PivotAxisZone`, filters disappear unless `filters` is passed. Stop-and-report item; must merge before `rc.2` |
| Consumers | Forge studio-preview (not yet mounted). No Tron example mounts `PivotFieldList`. Any external `rc.1` consumer passing a filters assignment breaks at type level |

Design critique (brief): the four-zone list with per-zone text buttons
already reads as a long form; adding an inline value picker makes the filters
zone the tallest block on the panel. The picker should open as a popover
anchored to the filter row (outer view `rounded-md`, rows `rounded-sm` per
§2.5), with a search field once a field has more than about 12 values, and a
live count against `maxValues`. Hiding the zone entirely when `filters` is
absent is better than showing a disabled zone with no explanation.

### Option B: Tally accepts a filter field with no values, meaning "all"

This matches spreadsheet behaviour: a field dropped in the filters area
starts as "(All)" and keeps every record until someone narrows it. The Tron
component's `onAssign(fieldId, 'filters')` becomes valid as written.

```ts
// packages/tally/src/index.ts
/** One field filter: a source field offset plus 0-64 accepted literal values.
 *  An empty list keeps every record ("All"); refresh output is identical to
 *  having no filter on that field. */
export interface PivotFilterInput {
  field: number;
  values: string[];
}
```

```rust
// packages/tally/rust/src/pivot_ops.rs
fn valid_filter_values(values: &[String]) -> bool {
    values.len() <= MAX_PIVOT_FILTER_VALUES
        && values.iter().all(|v| !v.is_empty() && v.len() <= MAX_PIVOT_FILTER_VALUE_LEN)
}
// plan_refresh: a filter whose `values` is empty admits every record.
```

No new op name. `insertPivot` and `updatePivot` payloads keep their shape;
only the lower bound moves from 1 to 0. Undo is unchanged: both ops already
record `UndoEntry::Reset { prev }` before mutating, so assigning or clearing a
filter is one undo step.

Caller example (Forge host):

```ts
onAssign={(fieldId, zone, signal) =>
  zone === 'filters'
    ? tally.updatePivot(id, { filters: [...current.filters, { field: offset(fieldId), values: [] }] })
    : assignAxis(fieldId, zone, signal)}
```

Errors: a duplicate filter field still rejects (`fields_ok` keeps the unique
check); more than 64 values or an empty-string value still rejects with
`Validation`.

Test that proves it: in `pivot_ops.rs`, `insertPivot` with
`filters: [{field: 1, values: []}]` succeeds, `describePivot` echoes the empty
list, and `refreshPivot` writes cells identical to the same spec with no
filters; `values: [""]` and 65 values still reject. Mirror it in
`packages/tally/tests/pivots.e2e.test.ts`, and add the studio-preview wiring
test above.

| Dimension | Assessment |
| --- | --- |
| Effort | Half a day in Tally plus `ENGINE_OPS.md`; 1 day Forge wiring including the draft-spec step |
| Risk | Low. One bound and one branch in refresh. Forward compatibility: a snapshot with an empty filter list fails `stored_ok` in older Tally binaries; acceptable before Forge's first release, worth a line in the release notes |
| Public API impact | Tally TS type doc only. No Tron change |
| Consumers | Tally hosts only; the xlsx reader ignores pivot parts, so import and export are unaffected. Users can place a field in filters but cannot narrow it until a value picker exists |

### Recommendation (I-15)

B, because it makes the component's existing contract correct for Tally with
a half-day engine change and no Tron API break after `rc.1`. Its cost is that
filters stay "All" until a value picker ships; Option A's picker can land later
as an additive Tron minor (an optional `filters.listValues` on top of B) instead
of a breaking `rc.2` change. Choose A if a usable value filter is required for
Forge v1. The owner decides.

---

## ADR F3-2: E-35 `BeatDetectionMarkerLane` and Cadence beat detection

### Context

`BeatDetectionMarkerLane` (`packages/ui/src/components/forge/audio/BeatDetectionMarkerLane.tsx`)
always renders a "Beat detection sensitivity" `PrecisionScrubber` (0 to 1) and
requires `sensitivity` and `onSensitivityCommit`. Its `lane` prop is a
`TimelineMarkers` with required `onAdd`, `onUpdate` and `onRemove`.

Cadence `detectBeats` (`analysis.rs`, `mix_ops.rs`) takes `fft_size` and `hop`
and is read-only. Its threshold is fixed at mean + one standard deviation of
the spectral flux. Cadence's `Doc` has no markers; marker ops exist in Splice
(`addMarker`, `updateMarker`, `removeMarker`, in seconds), not in Cadence.

So the scrubber and the marker edits would both be live controls with nothing
behind them.

### Option A: the lane renders only what the host supplies

```ts
// BeatDetectionMarkerLane.tsx (NYC-Tron UI)
/** Present only when the host's detector has a sensitivity control. */
export interface BeatSensitivityControl {
  /** 0..1; higher finds more onsets. */
  readonly value: number;
  onCommit(value: number, signal?: AbortSignal): unknown;
}
export interface BeatDetectionMarkerLaneProps /* existing, minus sensitivity and onSensitivityCommit */ {
  sensitivity?: BeatSensitivityControl; // replaces `sensitivity: number` + `onSensitivityCommit`
  lane: BeatMarkerLane;
}

// TimelineMarkers.tsx: editing becomes a grouped optional capability.
export interface TimelineMarkerEditing {
  onAdd(at: { frame: number; seconds: number }): void;
  onUpdate(id: string, update: MarkerUpdate): void;
  onRemove(id: string): void;
}
export interface TimelineMarkersProps /* existing, minus onAdd/onUpdate/onRemove */ {
  /** Omit for a read-only lane: markers can be selected and sought, not added, moved, renamed or removed. */
  editing?: TimelineMarkerEditing;
}
```

Caller example (Forge, Cadence host, detected onsets kept in app state):

```tsx
<BeatDetectionMarkerLane
  status={status}
  detectedBpm={result?.estimated_bpm ?? null}
  onDetect={signal => runDetect(signal)}       // cadence.detectBeats(range)
  onCancel={cancelDetect}
  lane={{ markers: onsetMarkers, viewport, rate, durationFrames, playheadFrame, onSelect, onSeek }}
/>
```

Errors and cleanup: unchanged from today. A `sensitivity.value` outside 0..1
still throws `RangeError`. `editing` absent removes the add, move, rename and
remove controls rather than disabling them, so no control is live without a
handler.

Test that proves it (Tron unit plus `timeline` browser spec): without
`sensitivity`, no element labelled "Beat detection sensitivity"; without
`lane.editing`, no add, remove or rename control, and arrow keys on a selected
marker do not call anything, while seek still fires; with both supplied, the
existing behaviour and tests pass unchanged.

| Dimension | Assessment |
| --- | --- |
| Effort | 2 days in Tron (two components, `TimelineMarkers` used elsewhere, browser fixtures `timeline.tsx`/`timeline2.tsx`) |
| Risk | Medium. `TimelineMarkers` is shared with the Splice timeline rows; its prop change ripples to every caller |
| Public API impact | Breaking after `rc.1` for both `BeatDetectionMarkerLaneProps` and `TimelineMarkersProps`. An additive variant (make the four callbacks optional and hide what is missing) avoids the break but leaves split state; `api-design` prefers the grouped object |
| Consumers | Forge studio-preview Cadence surface (not mounted) and Splice timeline (`TimelineMarkers`); Tron timeline fixtures |

Design critique (brief): a read-only onset lane is honest but thin. Without
storage the detected beats vanish on reload and cannot be undone or nudged,
which is the main reason anyone runs beat detection in a DAW. Removing the
scrubber also leaves "Detect clip beats" as a single shot with no way to
retry with a different threshold, so users will re-run it and get the same
result.

### Option B: Cadence gets a sensitivity parameter and marker storage

```ts
// packages/cadence/src/index.ts
detectBeats(range: AnalysisRange, options: { fftSize?: number; hop?: number; sensitivity?: number } = {}): Promise<BeatDetectionResult>;

/** A project marker in ticks, so it follows tempo changes. */
export interface CadenceMarker { id: number; ticks: number; length_ticks: number; name: string; note?: string }
export interface MarkerInput { ticks: number; length_ticks?: number; name?: string; note?: string }

addMarker(marker: MarkerInput): Promise<{ marker_id: number }>;
/** Detected beats in one undo step. 1..8192 markers. */
addMarkers(markers: readonly MarkerInput[]): Promise<{ marker_ids: number[] }>;
updateMarker(id: number, patch: Partial<MarkerInput>): Promise<{ ok: true }>;
removeMarker(id: number): Promise<{ ok: true }>;
listMarkers(): Promise<{ markers: CadenceMarker[] }>;
```

```rust
// packages/cadence/rust/src/analysis.rs
pub struct BeatOptions { pub fft_size: usize, pub hop: usize, pub sensitivity: f64 } // 0.0..=1.0, default 0.5
// threshold = mean + k * sigma, k = 2.0 * (1.0 - sensitivity); 0.5 gives k = 1.0, today's output.

// packages/cadence/rust/src/lib.rs
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Marker { id: u64, ticks: u64, length_ticks: u64, name: String, #[serde(default, skip_serializing_if = "Option::is_none")] note: Option<String> }
struct Doc { /* existing */ #[serde(default)] markers: Vec<Marker> }
// mix_ops.rs: fn op_add_marker / op_add_markers / op_update_marker / op_remove_marker / op_list_markers
//   (&mut self, p: &Value) -> OpResult
```

Payloads follow Splice's marker rows in `ENGINE_OPS.md`, in ticks instead of
seconds: `addMarker {ticks, length_ticks?=0, name?, note?}` returns
`{marker_id}`; name 1..120 characters, default "Marker N"; note up to 2000;
`ticks` within the project length bound the other tick ops use.
`detectBeats` accepts `sensitivity` 0..1, otherwise `Validation`.

Undo: Cadence's journal stores whole-`Doc` snapshots, so each mutating marker
op is one undo step and `addMarkers` is one step for the whole batch.
`detectBeats` stays read-only. `listMarkers` is read-only.

Caller example (Forge host): `detectBeats(range, { sensitivity })`, convert
each `onsets_seconds` value to ticks with `seconds * ppq * bpm / 60` plus the
range start, then `addMarkers(...)`. The lane's `onAdd`, `onUpdate` and
`onRemove` map to `addMarker`, `updateMarker` and `removeMarker`, converting
`MarkerUpdate.seconds` to ticks the same way.

Test that proves it (Rust, `mix_ops_tests.rs`): the existing four-click test
returns identical onsets with `sensitivity` omitted and with `0.5`; with
`0.0` it finds no more onsets than default and with `1.0` no fewer, on a fixture
with quiet and loud clicks where the counts differ; `sensitivity: 1.5`
rejects. Markers: `addMarkers` of 4 then one `undo` leaves 0, `redo` restores
4; `updateMarker` keeps the id; a snapshot without `markers` restores with an
empty list. TS e2e in `packages/cadence/tests/mixer-ops.e2e.test.ts`, and a
`cadence-beats-wiring.test.ts` in studio-preview.

| Dimension | Assessment |
| --- | --- |
| Effort | 2 to 3 days: one parameter, five ops, docs, TS client, tests, studio-preview wiring |
| Risk | Low to medium. Detection change is one line and defaults to today's result. `Doc` does not use `deny_unknown_fields`, so an older Cadence binary loads a project with markers and silently drops them on the next save; note it in release notes |
| Public API impact | Additive in `@nitro-forge/cadence` and `ENGINE_OPS.md`. No Tron change |
| Consumers | Cadence hosts, the Nitro and C ABI op tables (new op names pass through the existing generic `apply`), studio-preview |

### Recommendation (E-35)

B. Sensitivity maps onto a real knob in the detector (the threshold
multiplier), and markers need undo and persistence that only the engine can
give. It needs no Tron change after `rc.1`, and the component's current
contract fits it without edits. The owner decides.

---

## ADR F3-3: B-11 `LayerBlendAndOpacity` and Prism alpha

### Context

`LayerBlendAndOpacity` (`packages/ui/src/components/forge/layers/LayerBlendAndOpacity.tsx`)
takes capability catalogs for blend `modes` and compositing `spaces`, each
entry with an optional `unavailableReason`. The "Layer alpha representation"
menu is hard-coded to Straight and Premultiplied; `LayerAlphaMode` is
`'straight' | 'premultiplied'` and there is no catalog for it.

Prism stores raster layers as straight RGBA8 (`Content::Raster { pixels_b64 }`)
and composites in straight alpha (`render.rs`, the `premult / out_a` step).
Its `Layer` has `opacity`, `blend` and no alpha-mode field. `setLayerBlend` and
`setLayerOpacity` exist; nothing changes alpha representation.

### Option A: an alpha-mode catalog, like modes and spaces

```ts
// layer-blend-model.ts (NYC-Tron UI)
export interface LayerAlphaOption {
  readonly id: LayerAlphaMode;
  readonly label: string;
  readonly unavailableReason?: string;
}
/** Default when omitted: Straight and Premultiplied, both available (rc.1 behaviour). */
export const defaultAlphaModes = [
  { id: 'straight', label: 'Straight alpha' },
  { id: 'premultiplied', label: 'Premultiplied alpha' },
] as const satisfies readonly LayerAlphaOption[];

// LayerBlendAndOpacity.tsx
export interface LayerBlendAndOpacityProps /* existing */ {
  /** Alpha representations the compositor accepts. One entry renders as read-only text. */
  alphaModes?: readonly LayerAlphaOption[];
}
// validateLayerBlend(value, modes, spaces, alphaModes): value.alphaMode must be in the catalog; ids unique; 1..2 entries.
```

Caller example (Forge, Prism host):

```tsx
<LayerBlendAndOpacity
  scope={docId} layerId={String(layer.id)} value={value}
  modes={PRISM_BLEND_MODES} spaces={[{ id: 'srgb', label: 'sRGB', transfer: 'encoded', modeIds: PRISM_MODE_IDS }]}
  alphaModes={[{ id: 'straight', label: 'Straight alpha' }]}
  onCommit={(next, { kind }, signal) =>
    kind === 'mode' ? prism.setLayerBlend(id, next.mode)
    : kind === 'opacity' ? prism.setLayerOpacity(id, next.opacity)
    : Promise.reject(new Error(`Prism cannot change ${kind}`))}
/>
```

Errors: an alpha value outside the catalog, duplicate ids or an empty catalog
throw `RangeError`, matching the modes and spaces checks. A catalog entry with
`unavailableReason` renders disabled with the reason as its description, as
blend modes already do.

Test that proves it (Tron, `packages/ui/tests/layer-blend.test.mjs` and
`tests/browser/layer-blend.spec.mjs`): with `alphaModes` omitted the menu
offers both entries (rc.1 parity); with one entry no "Layer alpha
representation" menu button exists and the text reads "Straight alpha";
with Premultiplied marked unavailable, selecting it does not call `onCommit`;
`validateLayerBlend` throws for `alphaMode: 'premultiplied'` against a
straight-only catalog. Forge adds `prism-blend-wiring.test.ts` asserting the
mode and opacity paths against a real `PrismEngine`.

| Dimension | Assessment |
| --- | --- |
| Effort | 1 day in Tron (model, component, unit and browser tests, `LayerBlendDemo` update); half a day Forge wiring |
| Risk | Low. Additive optional prop; the default reproduces rc.1 exactly |
| Public API impact | Additive after `rc.1`: new optional prop, new exported type and constant, `validateLayerBlend` gains an optional fourth parameter. Still a public API change, so stop-and-report; must merge before `rc.2` |
| Consumers | Forge studio-preview Prism surface; Tron `examples/native-instruments/LayerBlendDemo.tsx` and `tests/browser/fixtures/layer-blend.tsx` (both keep working unchanged) |

Design critique (brief): a menu with one item asks the user to open it to
learn there is no choice. Rendering the single entry as a label in the same
row keeps the inspector's rhythm and removes a dead tap target. With two
entries and one unavailable, the disabled item with its reason is the more
useful form, because it explains why Premultiplied is greyed out. The
compositing-space menu has the same one-entry problem for Prism and should
get the same treatment in the same change.

### Option B: Prism gets a per-layer alpha interpretation op

```ts
// packages/prism/src/index.ts
export type AlphaMode = "straight" | "premultiplied";
/** How a raster layer's stored RGB is read at composite time. Raster layers only. */
setLayerAlphaMode(id: number, alphaMode: AlphaMode): Promise<{ ok: true }>;
```

```rust
// packages/prism/rust/src/model.rs
pub struct Layer { /* existing */ #[serde(default, skip_serializing_if = "AlphaMode::is_straight")] pub alpha_mode: AlphaMode }
// ops.rs
fn op_set_layer_alpha_mode(&mut self, p: &Value) -> Result<CommandResult, EngineError>
// payload {id, alpha_mode}; NotFound for a missing id, Validation for non-raster content
// or an unknown mode, ensure_unlocked; self.record() then set. Same mode: changed:false, no undo entry.
// render.rs: a premultiplied layer un-premultiplies (rgb * 255 / a, a > 0) as it is read,
// before opacity, mask, blend and clipping.
```

The op reinterprets stored bytes and does not convert them, so switching back
restores the original appearance exactly. Undo is one `UndoEntry::Doc`
snapshot per change, like `setLayerBlend`. `samplePixels`, `flatten`, export
and Motion's ephemeral Prism scenes all go through the same `render_layer`,
so they pick up the mode.

Test that proves it (Rust, `tests_v2.rs`): a raster pixel `(128,0,0,128)`
marked premultiplied composites over opaque white to the same result as
`(255,0,0,128)` marked straight; toggling back restores the first flatten
byte for byte; `setLayerAlphaMode` on a shape layer rejects; undo restores
`straight`; a snapshot without `alpha_mode` restores as straight. TS e2e in
`packages/prism/tests/canvas-layers.e2e.test.ts`.

| Dimension | Assessment |
| --- | --- |
| Effort | 3 to 4 days: model, op, render path, every read path that bypasses `render_layer` (the `flatten` and mask code paths need an audit), docs, tests |
| Risk | Medium to high. Touches the composite hot path; 8-bit un-premultiply loses precision at low alpha; Motion's matte and effect stages consume Prism output and need checking |
| Public API impact | Additive in `@nitro-forge/prism` and `ENGINE_OPS.md`. No Tron change. `LayerWire` does not deny unknown fields, so an older Prism binary loads a snapshot that sets `alpha_mode` and silently drops it, showing the layer as straight |
| Consumers | Prism hosts, Motion (uses Prism for composition scenes), Photo export paths, studio-preview |

### Recommendation (B-11)

A. Prism's model is straight alpha throughout, and nobody has asked for
premultiplied interpretation of imported rasters; adding it would grow the
render path to satisfy one menu. Option A is additive, keeps rc.1 behaviour
by default, and follows the catalog pattern the component already uses for
modes and spaces. It is still a Tron public API change after `rc.1`, so it
needs the owner's approval and has to merge before `rc.2`. If Forge later
imports premultiplied footage, Option B can land then and Forge would pass
both catalog entries. The owner decides.

---

## Summary for the owner

| Row | Option A (Tron) | Option B (Forge) | Recommended |
| --- | --- | --- | --- |
| I-15 `PivotFieldList` | Opt-in `filters` capability with a value picker; breaking type change | Tally accepts an empty filter list as "All"; host keeps a draft spec until it has a source and a value | B |
| E-35 `BeatDetectionMarkerLane` | Optional sensitivity and read-only marker lane; breaking change to two components | `detectBeats` `sensitivity` plus five Cadence marker ops | B |
| B-11 `LayerBlendAndOpacity` | Optional `alphaModes` catalog; additive | `setLayerAlphaMode` with premultiplied interpretation in the render path | A |

If the recommendations are taken, one Tron change (B-11, additive) goes into
`rc.2`, and two Forge engine changes land on Forge `master` independently of
the Tron release.

## Skills used and their outputs

- Margelo `api-design`: every option above carries the typed contract, at
  least one caller example, and its error and cleanup semantics. Choices made
  under its rules: grouped optional capability objects (`filters`,
  `sensitivity`, `editing`) instead of paired optional props; a discriminated
  `PivotAssignment` union instead of an optional `values` field; catalogs with
  `unavailableReason` for capability discovery; `as const satisfies` for the
  alpha-mode preset.
- `engineering:architecture`: each section is an ADR record (status, context,
  options with an assessment table, consequences in the risk and consumer
  rows, recommendation).
- `design:design-critique`: a short critique of each Option A's UI effect,
  inline in each section.
- `no-ai-slop`: applied to all prose in this file.
