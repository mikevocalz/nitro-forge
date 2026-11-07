# Engine op surface — authoritative

Every product engine implements `ignition_core::Engine` and supports these ops via
`apply(Command { op, payload })`. Op names are the TS API contract — do not rename.

Universal ops every engine MUST support in `apply`:
- `new` — reset the document from `payload` (engine-specific params). Returns `{ ok: true }`.
- `describe` — return the complete document state as JSON in `data`. Read-only; records no undo.
- `__batch` — `{commands:[{op,payload?,v?},...]}` with 1..64 schema-v1 commands.
  Executes sequentially against an isolated staged document, then commits once
  with one undo entry. Failure preserves document state, IDs, prior undo and
  redo. Results are `{results:[stepData,...]}` in input order. Read-only batches
  create no history and preserve redo. Mutating batches emit one full-invalidation
  `document:changed` event plus their other domain events. Nested/reserved `__*`
  operations, unknown step fields and binary sidecars are rejected. Input and
  aggregate output JSON are bounded to 32 MiB. Binary output is available through
  the existing single-command transport, not nested batch steps.

Snapshot/undo protocol (implemented by host, engines implement trait):
`snapshot()` → `encode_envelope(json(doc))`; `restore(bytes)` → `decode_envelope` then
`serde_json::from_slice`, leaving state untouched on failure; `undo`/`redo` via a
`Journal<T>` of engine-specific undo entries recorded *before* mutation (capacity 64,
Folio 8 since entries are whole PDFs). `__undo`/`__redo`/`__snapshot` are handled by the
host — engines never see them.

Result conventions: `CommandResult.data` is the value shown below (`→ {...}`); every
mutating op also emits event `document:changed` plus any listed events. All validation
errors are `EngineError` with the appropriate code; state must be unchanged on error.

Positions/coords are f64 unless noted. Ids are engine-assigned u64 from a monotonically
increasing counter (survives undo via restore of prior value).

---

## prism-engine — `PrismEngine::new(width: u32, height: u32)`

State `{ width, height, next_id, layers: [Layer], colors: {foreground, background, recent} }`.
`colors` defaults to black on white with no recent colors (also for snapshots written before it existed); `new` keeps it.
`Layer = { id, name, opacity: 0..=1, visible: bool, content }` where
`content = {"type":"raster","pixels_b64": "…RGBA w*h*4"}` stored internally as
`Arc<Vec<u8>>` (serialize via `ignition_core::protocol::base64_encode/decode`) or
`{"type":"shape","shape":{"kind":"rect"|"ellipse","x","y","w","h","fill":[r,g,b,a u8]}}`.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{width,height}` | `{ok}` | blank document |
| `resize` | `{width,height}` | `{ok}` | raster layers crop/pad with transparent |
| `addRasterLayer` | `{name?}` | `{layer_id}` | transparent, top of stack |
| `addShape` | `{shape, name?}` | `{layer_id}` | |
| `setShapeFill` | `{id,color:[r,g,b,a]}` | `{ok}` | shape only; preserves geometry/ID, one undo step; NotFound if absent, Validation for non-shape content/channels >255, InvalidCommand for malformed RGBA (including negative/non-integer channels) |
| `transformShape` | `{id,dx,dy,scale_x,scale_y}` | `{ok}` | shape only; translate by dx/dy and scale positive w/h about top-left; finite computed bounds within ±1e7 required; one undo step; permits off-canvas geometry |
| `removeLayer` | `{id}` | `{ok}` | NotFound if absent |
| `moveLayer` | `{id,to_index}` | `{ok}` | index 0 = bottom |
| `renameLayer` | `{id,name}` | `{ok}` | |
| `setLayerOpacity` | `{id,opacity}` | `{ok}` | 0..=1 else Validation |
| `setLayerVisible` | `{id,visible}` | `{ok}` | |
| `drawPixels` | `{id,x,y,w,h,data_b64}` | `{ok}` | src-over blend; raster layer only; data = w*h*4 RGBA; clipped to canvas |
| `fillLayer` | `{id,color:[r,g,b,a]}` | `{ok}` | raster layer only |
| `applyFilter` | `{id,filter:{type,amount?}}` | `{ok}` | types: `grayscale`,`invert`,`brightness`(amount -1..=1); raster only |
| `flatten` | `{}` | `{pixels_b64,width,height}` | composited bottom→top honoring opacity/visible; shapes rasterized; read-only |
| `getLayer` | `{id}` | layer object | read-only |
| `setColors` | `{foreground?,background?,remember?}` | `{ok,changed}` | document palette; at least one color `[r,g,b,a]` u8; `remember` (default true) moves committed colors to the front of `recent` (dedup, max 16); identical palette → `changed:false`, no undo entry, no event |
| `swapColors` | `{}` | `{ok,changed}` | exchange foreground/background; equal colors → `changed:false` |
| `clearRecentColors` | `{}` | `{ok,changed}` | empty `recent` |
| `getColors` | `{}` | `{foreground,background,recent}` | read-only |

Undo: structural ops record prior `Vec<Layer>` (cheap — pixels are `Arc`);
`drawPixels`/`fillLayer`/`applyFilter` record `{layer_id, rect, prev_b64}`.
Palette ops record the prior palette.

### Canvas and layers (B cluster)

Layers also carry `locked`, `blend`, `parent` (group or boolean id, or null),
`clipped`, `transform {tx,ty,sx,sy,rotation,ox,oy}` and `mask
{enabled,inverted,mask_b64}` (canvas-sized alpha, or null). Content adds
`{"type":"group"}`, `{"type":"path","path":{subpaths,fill,stroke,fill_rule,paint_order}}`
and `{"type":"boolean","op","fill"}`. The document adds `artboards`,
`selected` (layer ids) and `selection_b64` (canvas-sized alpha; absent when
nothing is selected). Older snapshots without these fields restore with
defaults. Layers and artboards share one id counter.

A transform maps a content point `p` to `t + o + R(rotation)·S(sx,sy)·(p - o)`.
Coordinates and dimensions are bounded by ±1e7 (positive sizes where required); finite values alone are insufficient. Children render through their ancestors' transforms. A locked layer, or one
inside a locked group, rejects pixel, transform, mask, path, fill/stroke,
blend, opacity, removal and reparent edits with `Validation`; rename,
visibility and lock stay allowed.

| op | payload | data | notes |
|---|---|---|---|
| `setLayerTransform` | `{id,transform:{tx?,ty?,sx?,sy?,rotation?}}` | `{ok}` | partial merge; scale non-zero, within ±10000 |
| `translateLayers` | `{ids,dx,dy}` | `{ok}` | canvas delta, one step; all resulting local transforms validate before history/mutation; a child moving with its ancestor is carried once |
| `setTransformOrigin` | `{id,ox,oy}` | `{ok}` | pivot in content coords; `tx/ty` compensated so nothing moves |
| `layerBounds` | `{ids?}` | `{bounds:[{id,x,y,w,h,corners}\|{id,empty}]}` | canvas space; read-only |
| `hitTest` | `{x,y}` | `{layer_id,top_level_id}` | topmost painted leaf and its top-level ancestor; read-only |
| `alignLayers` | `{ids,align,to?}` | `{ok}` | `align`: left/hcenter/right/top/vcenter/bottom; `to`: `"selection"` (default, ≥2 ids), `"canvas"`, `{artboard}` |
| `distributeLayers` | `{ids,axis,mode?,spacing?}` | `{ok}` | ≥3 ids, or ≥2 with `spacing`; `mode` `spacing` (default) or `centers` |
| `selectLayers` | `{ids,mode?}` | `{ok}` | object selection; replace/add/remove/toggle |
| `selectRegion` | `{shape,mode?,feather?}` | `{ok}` | `shape` rect/ellipse `{x,y,w,h}` or polygon `{points}` (≥3); mode replace/add/subtract/intersect; feather 0..=250 |
| `selectAll` / `deselect` / `invertSelection` | `{}` | `{ok}` | deselecting nothing records nothing |
| `magicWand` | `{x,y,tolerance?,contiguous?,sample?,mode?}` | `{ok}` | tolerance 0..=255 (default 32) on max channel difference; `sample` `"composite"` (default) or `{layer}` |
| `modifySelection` | `{op,radius}` | `{ok}` | grow/shrink (exact distance transform, hard edge) or feather; needs a selection |
| `getSelection` | `{}` | `{empty}` or `{bounds,mask_b64,width,height}` | read-only |
| `groupLayers` | `{ids,name?}` | `{layer_id}` | siblings only; group sits above the topmost member |
| `ungroupLayer` | `{id}` | `{ok}` | group or boolean; group transform baked into children (rejects if that would skew), group opacity multiplied in; a masked group is rejected |
| `setLayerParent` | `{id,parent}` | `{ok}` | parent group/boolean or null; keeps the on-canvas position; no cycles |
| `setLayerLocked` / `setLayerBlend` / `setClipped` | `{id,locked}` / `{id,blend}` / `{id,clipped}` | `{ok}` | 13 W3C blend modes; a clipped layer clips to the nearest unclipped sibling below |
| `layerThumbnail` | `{id,max}` | `{width,height,pixels_b64}` | canvas extent, area-averaged to fit `max` (1..=1024); read-only |
| `renderRegion` | `{x,y,w,h,max}` | `{width,height,pixels_b64}` | composite crop, transparent outside the canvas; read-only |
| `addMask` | `{id,fill?}` | `{ok}` | reveal (default), hide, or selection |
| `removeMask` | `{id,apply?}` | `{ok}` | `apply` bakes into raster alpha (raster only) |
| `setMaskEnabled` / `invertMask` | `{id,enabled}` / `{id}` | `{ok}` | |
| `paintMask` | `{id,x,y,w,h,data_b64,mode?}` | `{ok}` | `w*h` alpha; replace/add/subtract; clipped to canvas |
| `refineMask` | `{id,feather,grow}` | `{ok}` | grow -250..=250 then feather 0..=250 |
| `maskThumbnail` | `{id,max}` | `{width,height,pixels_b64}` | grayscale; read-only |
| `addArtboard` / `removeArtboard` / `updateArtboard` / `moveArtboard` | `{name?,x,y,w,h}` / `{id}` / `{id,name?,x?,y?,w?,h?}` / `{id,to_index}` | `{artboard_id}` / `{ok}` | |
| `artboardThumbnail` | `{id,max}` | `{width,height,pixels_b64}` | read-only |
| `addPath` | `{path:{subpaths},fill?,stroke?,fill_rule?,name?}` | `{layer_id}` | node `{x,y,in?,out?,kind}`; handles are offsets |
| `setPathNodes` / `setPathNode` / `insertPathNode` / `removePathNode` | `{id,subpaths}` / `{id,subpath,index,node}` / same / `{id,subpath,index}` | `{ok}` | removing a subpath's last node removes the subpath; a path keeps one node |
| `setNodeKind` | `{id,subpath,index,kind}` | `{ok}` | smooth keeps handles collinear, symmetric mirrors length; handles derived from neighbors when absent |
| `setSubpathClosed` | `{id,subpath,closed}` | `{ok}` | |
| `setFill` | `{id,fill}` | `{ok}` | paint solid/linear/radial (focal `fx,fy` strictly inside); shapes take solid only |
| `setStroke` | `{id,stroke}` | `{ok}` | `{paint,width,join,cap,miter_limit,dash,dash_offset}`; null clears |
| `setFillRule` / `setPaintOrder` | `{id,rule}` / `{id,order}` | `{ok}` | nonzero/evenodd; fill-stroke/stroke-fill |
| `convertToPath` | `{id}` | `{ok}` | rect/ellipse shape to an editable path |
| `booleanLayers` | `{ids,op,name?}` | `{layer_id}` | ≥2 sibling shapes/paths stay editable children; fill from the bottom operand |
| `setBooleanOp` | `{id,op}` | `{ok}` | union/subtract/intersect/exclude |
| `rasterizeLayer` | `{id}` | `{ok}` | bakes content and transform into raster; descendants removed; mask, opacity, blend kept |
| `floodFill` | `{id,x,y,color,tolerance?,contiguous?,sample?}` | `{ok,filled}` | raster target; canvas region and pixel selection are bilinearly pulled back through layer/ancestor transforms; each local texel blends once; filled counts local texels; empty local coverage records nothing |

Rendering: path fills are 4×4 supersampled scanlines; strokes are
anti-aliased with miter/round/bevel joins, butt/round/square caps and dashes
(widths scale by the transform's mean scale). Boolean coverage combines per
pixel (max, a·(1-b), min, xor). Normal-mode compositing keeps the original
`src-over` arithmetic, so existing documents render byte-identically.

Brush engine ops (B-15, B-16, B-29, B-33) are not here: they wait on the
google/ink source admission (#46).

## tally-engine — `TallyEngine::new()`

State `{ next_sheet, sheets: [Sheet], active: idx }`,
`Sheet = { id, name, tone?: string | null, is_protected?: boolean, cells: { "A1": { raw: string } } }` — computed values are
derived, not stored. Cell addresses: `$?[A-Z]+$?[0-9]+` (case-insensitive), abs
markers accepted and normalized to plain `A1`. Every op that takes an address
(`setCell`, `clearCell`, `getCell`, `getRange`, `setRange`, `fillRange`) returns
`out_of_bounds` for an address past `XFD1048576` (16,384 columns × 1,048,576
rows) and changes nothing. A formula reference past the sheet evaluates to
`#REF!`. `restore` rejects a snapshot whose cell keys fall outside the sheet.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{}` | `{ok}` | one empty "Sheet1" |
| `addSheet` | `{name?}` | `{sheet}` | unique name required |
| `renameSheet` | `{sheet,to}` | `{ok}` | sheet = name or index |
| `removeSheet` | `{sheet}` | `{ok}` | must keep ≥1 sheet |
| `setActive` | `{sheet}` | `{ok}` | |
| `protectSheet` | `{sheet,protected:boolean}` | `{ok}` | persisted reversible editing guard; same-value request has no events/journal entry |
| `duplicateSheet` | `{sheet}` | `{sheet:{id,name,index}}` | deep-copy raw cells and tone immediately after source; unique `source Copy N` name (case insensitive); fresh id; original active sheet preserved; one structural undo entry |
| `moveSheet` | `{sheet,toIndex}` | `{ok}` | final zero-based index in current sheet range; preserves active sheet identity; one structural undo entry when changed |
| `setSheetColor` | `{sheet,tone}` | `{ok}` | tone = primary/accent/success/info/muted or null to clear; durable semantic theme token, one structural undo entry when changed |
| `setCell` | `{addr,value}` | `{addr,computed}` | on active sheet; `value` string starting `=` is a formula; numeric strings become numbers; empty string clears |
| `setRange` | `{from,values:string[][]}` | `{changed}` | nonempty rectangular paste; empty strings clear; at most 16,384 cells; must fit inside XFD1048576; one undo entry |
| `fillRange` | `{source:{from,to},target:{from,to}}` | `{changed}` | inclusive rectangles, target contains source; repeat source outside its bounds, shift relative references, preserve `$` locks; each rectangle at most 16,384 cells and inside XFD1048576; one undo entry |
| `clearCell` | `{addr}` | `{ok}` | |
| `getCell` | `{addr}` | `{raw,computed}` | `computed` = evaluated value |
| `getRange` | `{from,to}` | `{cells:[[{addr,raw,computed}]]}` | |
| `evaluate` | `{formula}` | `{value}` | ad-hoc formula against active sheet, no write |
| `workbook` | `{}` | `{sheets:[{name,cell_count,tone,is_protected}],active}` | read-only |

Formula language (recursive-descent parser, case-insensitive fns):
numbers, `"strings"`, cell refs, ranges `A1:B2`, unary `-`, binary
`+ - * / ^`, `%` postfix, parens, `&` concat, comparisons `= <> < <= > >=`,
functions `SUM AVERAGE MIN MAX COUNT COUNTA COUNTIF SUMIF IF(cond,a,b) ROUND(x,n) ABS CONCAT`.
Error values: `#DIV/0! #VALUE! #REF! #NAME? #NUM! #CYCLE!` — cycles detected via
evaluation-time visited set. Evaluation memoizes per-request.

Undo: per-cell previous `{addr, prev_raw}` (or removal); range edits group changed cells into one entry. No-op range edits emit no event and preserve redo. Fill reads all source cells before writing. Formula strings, names, whitespace and scientific notation remain unchanged; a reference shifted past row 1,048,576 or column XFD becomes `#REF!`, and a range with either endpoint off the sheet becomes a single `#REF!`. Lexically invalid source formulas reject the entire fill without mutation. Numeric series inference and cross-sheet references are not supported.

Protected sheets reject cell/clear/range/fill edits and targeted rename/remove/duplicate/move/color commands before mutation (including same-value edits). `new` rejects while any sheet is protected. Reads, activation, adding/editing other sheets and explicit unprotect remain allowed; unrelated structural edits can shift tab indices without changing protected sheet identity. Undo/redo and restore are explicit document/history actions and remain allowed. Batch commands enforce this policy per staged command and roll back the whole batch on failure. This is an editing guard, not encryption or authentication. Missing legacy protection defaults to false; invalid serialized boolean values reject restore atomically.

Sheet creation/duplication reject exhausted ids before mutation; restore rejects ids for which the next id cannot be represented. Tab tones default to none when restoring older snapshots; unknown tones reject restore atomically. Sheet moves and color edits validate before mutation and support undo/redo via the workbook journal. Same-value requests return `{ok:true}` with no events and no undo entry, preserving redo history.

Conditional aggregate subset: `COUNTIF(range,criteria)` and `SUMIF(range,criteria[,sum_range])` require direct same-sheet cell/rectangular references (≤16384 cells). SUMIF ranges must have identical dimensions; mismatches return #VALUE! rather than adopting Excel's resized range behavior. Numeric criteria (numbers or strings with optional =/<>/</<=/>/>= prefix) compare evaluated numbers only, without text/Boolean coercion. Text =/<> criteria support * (sequence), ? (one original Unicode scalar), and ~ escaping * ? ~; other tildes are literal. Matching is ASCII-case-insensitive, non-ASCII exact, with no locale/casefold/normalization claim. Non-numeric relational text criteria return #VALUE!. Boolean criteria match evaluated Booleans only. Empty or empty-text criteria match empty cells and empty evaluated strings; * alone matches text, not empty cells. Comparisons do not cross value types.

Criteria expressions/cell references are evaluated normally; criteria range errors/cycles propagate. SUMIF evaluates sum cells only for matches, ignores matched nonnumeric values and propagates matched errors; nonfinite accumulated sums return #NUM!. Existing per-request memoization/depth/cycle rules remain intact. Each conditional rectangle is capped at16384 cells, criteria at255 Unicode scalars and matched text at4096 UTF-8 bytes (#VALUE! for string limits). A shared per-Evaluator allowance of1000000 conditional scan/string/DP steps returns #NUM! on exhaustion; matcher allocation work is charged before bounded DP buffers. These are explicit Tally semantics, not full Excel compatibility.

## cadence-engine — `CadenceEngine::new()`

State `{ tempo_bpm, time_sig: [n,d], ppq: 960, playhead_ticks, next_id,
tracks: [Track], metronome: {enabled, volume 0..=1} }`. `Track = { id, name,
kind:"midi"|"audio"|"bus", volume 0..=1, pan -1..=1, muted, solo, clips: [Clip],
output: bus id|null, sends: [{bus, level 0..=1}], inserts: [Insert],
group: string|null, solo_safe, automation: {gain: Lane, pan: Lane} }`.
`Clip = { id, start_ticks, length_ticks, notes: [Note] }` (midi tracks only;
audio track clips have no notes — `addNote` → Validation; buses hold no clips).
`Note = { pitch 0..127, velocity 0..127, start_ticks, length_ticks, channel 0..15 }` (clip-relative).
`Insert = { id, bypassed, kind:"gain"|"eq"|"compressor", params }`; gain
`{gain_db -24..24}`; eq `{bands: [{type: peak|low_shelf|high_shelf|low_pass|high_pass,
freq_hz 20..20000, gain_db -24..24, q 0.1..18, enabled}]}` (≤8 bands); compressor
`{threshold_db -60..0, ratio 1..20, knee_db 0..24, attack_ms 0.1..200,
release_ms 5..2000, makeup_db 0..24}`. ≤8 inserts per track.
`Lane = { mode:"off"|"read", points: [{ticks, value}] }`, sorted, one point per tick;
gain values 0..=1, pan -1..=1. Fields added after the first release default on
restore, so older snapshots load unchanged.

Signal flow: source track notes → inserts → fader+pan (or read-mode automation,
linear between points, held at the ends) → its `output` (bus or master), plus
post-fader sends. Buses sum inputs → inserts → fader + balance (pan on a bus
attenuates the far side only) → master. Buses feed the master only. Audibility:
with anything soloed, a track sounds when soloed, solo-safe and unmuted, or
routed/sent into a soloed bus; a bus sounds when soloed, solo-safe and unmuted,
or fed by a soloed track; otherwise every unmuted track sounds. The metronome
(30 ms click per beat, 1.5 kHz on the downbeat) is mixed only when the read op
passes `include_metronome: true`.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{tempo_bpm?}` | `{ok}` | default 120, 4/4 |
| `setTempo` | `{bpm}` | `{ok}` | 20..=400 else Validation |
| `setTimeSig` | `{n,d}` | `{ok}` | d must be power of two |
| `transport` | `{to_ticks}` | `{ok}` | ≥0 |
| `addTrack` | `{name?,kind?}` | `{track_id}` | default midi |
| `removeTrack` | `{id}` | `{ok}` | |
| `renameTrack` | `{id,name}` | `{ok}` | |
| `setTrackGain` | `{id,volume}` | `{ok}` | |
| `setTrackPan` | `{id,pan}` | `{ok}` | |
| `setMuted` | `{id,muted}` | `{ok}` | |
| `setSolo` | `{id,solo}` | `{ok}` | solo takes precedence over mute |
| `addClip` | `{track,start_ticks,length_ticks}` | `{clip_id}` | reject overlap in same track |
| `removeClip` | `{id}` | `{ok}` | |
| `moveClip` | `{id,start_ticks}` | `{ok}` | reject overlap |
| `resizeClip` | `{id,length_ticks}` | `{ok}` | notes outside trimmed |
| `addNote` | `{clip,pitch,velocity?,start_ticks,length_ticks}` | `{index}` | pitch 0..127; bounds-checked vs clip length |
| `removeNote` | `{clip,index}` | `{ok}` | |
| `moveNote` | `{clip,index,start_ticks,pitch?}` | `{ok}` | note keeps its index; omitted pitch is unchanged; start+length past clip end → OutOfBounds; pitch 0..127 |
| `resizeNote` | `{clip,index,length_ticks}` | `{ok}` | length > 0; start+length past clip end → OutOfBounds |
| `setVelocity` | `{clip,index,velocity}` | `{ok}` | 0..127 integer |
| `project` | `{}` | meta: tempo, sig, track/clip/note counts, length_ticks | read-only |
| `render` | `{from_ticks,to_ticks,sample_rate,include_metronome?}` | `{samples_b64,frames,channels:2}` | f32le stereo mixdown per the signal flow above; ≤10 min at 48 kHz |
| `addTrack` kind `bus` | `{name?,kind:"bus"}` | `{track_id}` | default name `Bus N` |
| `removeTrack` (bus) | `{id}` | `{ok}` | tracks routed or sending to it fall back to the master in the same step |
| `setTrackOutput` | `{id,output}` | `{ok}` | `output` bus id or `null` (master); buses and missing ids rejected |
| `setSend` | `{track,bus,level}` | `{ok}` | adds or updates; level 0..1; source tracks only |
| `removeSend` | `{track,bus}` | `{ok}` | NotFound without that send |
| `addInsert` | `{track,kind,index?,params?}` | `{insert_id,index}` | defaults per kind, merged params validated; ≤8 |
| `removeInsert` | `{id}` | `{ok}` | |
| `moveInsert` | `{id,index}` | `{ok}` | index within the chain |
| `setInsertBypass` | `{id,bypassed}` | `{ok}` | |
| `setInsertParams` | `{id,params}` | `{ok}` | partial merge; unknown key or any out-of-range value rejects all |
| `insertPresets` | `{kind}` | `{presets:[{id,label,kind,params}]}` | read-only factory presets |
| `applyInsertPreset` | `{id,preset}` | `{ok}` | preset id of the insert's own kind |
| `eqResponse` | `{id,points?=128,sample_rate?=48000}` | `{points:[{hz,db}]}` | read-only; log-spaced 20 Hz..min(20 kHz, 0.49·sr) |
| `dynamicsCurve` | `{id}` | `{points:[{in_db,out_db}]}` | read-only; -60..0 dBFS, 1 dB steps, soft knee |
| `setTrackGroup` | `{id,group}` | `{ok}` | 1..=64 bytes trimmed, `null` clears |
| `setGroupSolo` | `{group,solo}` | `{tracks}` | every member, one undo step; NotFound for an empty group |
| `setGroupMuted` | `{group,muted}` | `{tracks}` | same |
| `setSoloSafe` | `{id,safe}` | `{ok}` | |
| `addAutomationPoint` | `{track,param,ticks,value}` | `{index}` | param `gain`/`pan`; duplicate tick → Validation |
| `moveAutomationPoint` | `{track,param,index,ticks,value}` | `{ok}` | stays between its neighbours (keeps its index) |
| `removeAutomationPoint` | `{track,param,index}` | `{ok}` | |
| `setAutomationMode` | `{track,param,mode}` | `{ok}` | `off`/`read`; write/touch/latch need live transport (Validation) |
| `setVelocities` | `{clip,changes:[{index,velocity}]}` | `{changed}` | all-or-nothing, one undo step; duplicate index → Validation |
| `setNoteChannel` | `{clip,index,channel}` | `{ok}` | 0..15; `addNote` also takes `channel?` |
| `setMetronome` | `{enabled,volume?}` | `{ok}` | volume 0..1 |
| `meter` | `{from_ticks,to_ticks,sample_rate,window_ms?=50,include_metronome?}` | `{window_frames,window_seconds,tracks:[{id,peak[],rms[],max_peak,clipped}],master}` | read-only; post-fader per track/bus; sample_rate 8000..192000; ≤4096 windows |
| `loudness` | same range | `{integrated_lufs,momentary_max_lufs,short_term_max_lufs,sample_peak_dbfs,momentary_lufs[],step_seconds}` | read-only BS.1770 K-weighted, gated; `null` = silent/too short |
| `spectrogram` | range + `{fft_size?=2048,hop?,bands?=64}` | `{bands_hz,hop_seconds,frames}` | read-only; Hann STFT of mono master, log bands, dB floored -120; ≤2048 frames |

Ticks→seconds: `ticks / (ppq * bpm / 60)`. Undo: prior field values / removed entities.

## splice-engine — `SpliceEngine::new()`

State `{ fps, next_id, sources: {id: {name, duration_s}}, tracks: [Track], markers: [Marker], loop_range? }`,
`Track = { id, kind:"video"|"audio"|"overlay", name?, locked, hidden, muted, solo, clips: [Clip], transitions: [Transition] }`,
`Clip = { id, source_id, timeline_start_s, in_s, out_s, speed }`,
`Transition = { id, left_id, right_id, kind, duration_s }`,
`Marker = { id, time_s, duration_s, name, note? }`, `loop_range = { in_s, out_s }`.
Clip's timeline length = `(out_s - in_s) / speed`. Overlay tracks hold source
clips composited above the video tracks; track order is stack order.

Locked tracks refuse every clip and transition edit (and `removeTrack`) with
`Validation` ("track N is locked"); ripples with `scope:"all"` leave them in
place. Header ops (`setTrackFlags`, `renameTrack`, `moveTrack`) still work on a
locked track.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{fps?}` | `{ok}` | default 30 |
| `addSource` | `{duration_s,name?}` | `{source_id}` | duration > 0 |
| `removeSource` | `{id}` | `{ok}` | Validation if referenced by a clip |
| `addTrack` | `{kind}` | `{track_id}` | video, audio or overlay |
| `removeTrack` | `{id}` | `{ok}` | |
| `setTrackFlags` | `{id,locked?,hidden?,muted?,solo?}` | `{ok,changed}` | at least one flag; `hidden` on video/overlay only, `muted`/`solo` on audio only; `changed:false` records no undo and emits nothing |
| `renameTrack` | `{id,name}` | `{ok,changed}` | trimmed, 1..=120 chars |
| `moveTrack` | `{id,index}` | `{ok,changed}` | `index` < track count (OutOfBounds) |
| `addClip` | `{track,source,in_s,out_s,speed?,start_s?,mode?,scope?}` | `{clip_id,created}` | `start_s` defaults to end of track; `in<out≤source.duration`; `mode` below |
| `removeClip` | `{id}` | `{ok}` | |
| `moveClip` | `{id,start_s,track?,mode?,scope?}` | `{ok,created}` | `track` moves across tracks of the same media class (audio↔audio, video↔overlay) |
| `trimClip` | `{id,in_s?,out_s?}` | `{ok}` | bounds vs source, in<out, reject overlap |
| `splitClip` | `{id,at_s}` | `{left_id,right_id}` | `at_s` timeline time strictly inside clip; right half keeps speed and takes over a transition on the clip's tail |
| `setSpeed` | `{id,speed}` | `{ok}` | 0.1..=10; adjusts timeline footprint; reject overlap |
| `rippleDelete` | `{id,scope?}` | `{ok}` | removes the clip and shifts clips starting at or after its end left by its length |
| `rippleTrim` | `{id,edge:"head"\|"tail",delta_s,scope?}` | `{ok}` | `delta_s` moves that edge (positive = later); head keeps the clip's start and moves `in_s`; later clips shift by the change in length |
| `rollEdit` | `{left,right,delta_s}` | `{ok}` | clips must touch on one track; moves the cut only |
| `slipClip` | `{id,delta_s}` | `{ok}` | `delta_s` is media time: `in_s` and `out_s` both move |
| `slideClip` | `{id,delta_s}` | `{ok}` | moves the clip; a touching previous clip's `out_s` and a touching next clip's `in_s`/start follow |
| `addTransition` | `{left,right,kind,duration_s}` | `{transition_id}` | clips touch on one track; centred on the cut; needs `duration_s/2` of clip length and media handle on each side; one per cut |
| `setTransition` | `{id,kind?,duration_s?}` | `{ok}` | same checks |
| `removeTransition` | `{id}` | `{ok}` | |
| `addMarker` | `{time_s,duration_s?,name?,note?}` | `{marker_id}` | `duration_s` 0 = point marker; name defaults to "Marker N"; name ≤120, note ≤2000 chars |
| `updateMarker` | `{id,time_s?,duration_s?,name?,note?}` | `{ok}` | at least one field |
| `removeMarker` | `{id}` | `{ok}` | |
| `setLoopRange` | `{in_s,out_s}` | `{ok}` | `0 ≤ in_s < out_s`; may run past the last clip |
| `clearLoopRange` | `{}` | `{ok}` | Validation when none is set |
| `batch` | `{ops:[{op,payload?}]}` | `{results:[data…]}` | 1..=256 ops, not `new` or `batch`; all apply or none; one undo entry; error message prefixed `ops[i] <op>:` |
| `duration` | `{}` | `{seconds}` | max clip end across tracks |
| `timeline` | `{}` | full structure | read-only |
| `renderPlan` | `{}` | `{tracks:[[clip refs in time order]], transitions:[[…per track]]}` | clip refs carry `track_active` (video/overlay: not hidden; audio: soloed if any track is soloed, else not muted); transitions carry `kind, left_clip_id, right_clip_id, cut_s, start_s, end_s, duration_s` |

`mode` (`addClip`, `moveClip`): `reject` (default) refuses an overlap;
`insert` splits a clip straddling `start_s` and pushes clips at or after it
right by the clip's length; `overwrite` trims, splits or removes whatever lies
under the new span. `created` lists clips that splits produced and that
survive. `scope` (`rippleDelete`, `rippleTrim`, insert): `track` (default) or
`all` unlocked tracks; an `all` ripple that would overlap a clip on another
track fails with Validation.

Transition kinds: `cross_dissolve`, `dip_to_black`, `dip_to_white`,
`wipe_left`, `wipe_right`, `push_left`, `push_right` on video/overlay tracks;
`cross_fade` on audio tracks. Splice stores them for the renderer; it does not
draw them.

Atomicity: multi-clip ops edit a copy and check clip invariants on it (starts
≥ 0, spans inside sources, speeds in range, no overlaps) before committing.
After any op that emits `timeline:changed`, transitions that no longer fit
their cut are dropped in the same undo entry and listed in the op's
`removed_transitions`. Markers and the loop range never move with clip edits.
Positions are bounded: clip ends, source durations, markers and the loop range
stay within 1e7 s (OutOfBounds past it), and ids stay below 2^53 so they survive
JavaScript numbers. `restore` rejects snapshots that break these invariants or
carry duplicate ids, two transitions on one cut, `fps` ≤ 0, empty sources,
header flags that do not fit the track kind, or invalid markers and loop range.
A `batch` whose ops change nothing records no undo entry and emits no event.

Undo: whole-document snapshot per op (capacity 64). Event `timeline:changed`
on structural ops; marker and loop ops emit `document:changed` only.

## folio-engine — `FolioEngine::new()`

Wraps `lopdf::Document` (add `lopdf` dep). `new()` = empty doc with zero pages
until `new`/`open`.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{pages?}` | `{ok}` | builds valid PDF with N blank letter pages via lopdf objects |
| `open` | `{bytes_b64}` | `{pages, encrypted:false}` | `lopdf::Document::load_mem`; corrupted → Serialization |
| `pageCount` | `{}` | `{pages}` | |
| `pageText` | `{page}` | `{text}` | 0-based page; extracts strings from `Tj`/`TJ`/`'`/`"` ops in content stream; may be lossy — documented |
| `addAnnotation` | `{page,rect:[x,y,w,h],contents,subtype?,author?,modified?}` | `{annot_id}` | real PDF: appends obj to page `/Annots` (`/Subtype /Text|/Highlight|/Underline|/StrikeOut|/Square|/Circle`, `/Rect`, `/Contents`; markup includes `/QuadPoints`) |
| `listAnnotations` | `{page}` | `{annots:[{id,subtype,rect,contents}]}` | |
| `setAnnotationContents` | `{page,id,contents}` | `{ok}` | page-owned Text/Highlight only; at most 32767 UTF-16 code units (64 KiB including BOM); real PDF text string; same-text request is eventless/no history |
| `addAnnotationReply` | `{page,id,contents,author,modified}` | `{annot_id}` | Text reply /IRT to a primary Text/Highlight, /RT /R; explicit metadata, bounded nonblank body |
| `setAnnotationReview` | `{page,id,resolved:boolean,author,modified}` | `{annot_id}` or `{ok}` | separate hidden author-specific Review state Text record: Completed/None; chains to previous author state; same state eventless |
| `listCommentThreads` | `{page,review_author?}` | `{threads:[{id,contents,subtype,rect,author?,modified?,replies,resolved?,review_state?}]}` | actual PDF body/metadata; state records omitted from body replies; author-specific projection only |
| `removeAnnotation` | `{page,id}` | `{ok}` | atomic annotation-descendant subtree removal; generic owned Widget/Ink retained; external references/popup lifecycle/unsupported graphs reject safely |
| `rotatePage` | `{page,degrees}` | `{ok}` | sets `/Rotate`, must be multiple of 90 |
| `save` | `{}` | `{bytes_b64,size}` | `doc.save_to` → real PDF bytes |
| `info` | `{}` | `{pages,has_annots}` | read-only |

Undo: previous serialized `doc` (lopdf Document clone — it implements Clone; cap 8).

Annotation creation/editing encodes ASCII as PDFDocEncoding and non-ASCII as UTF-16BE via lopdf text_string. Annotation listing decodes PDF text strings; pageText remains the existing lossy content-stream extraction. Comment edits preserve the annotation id/type/geometry and unrelated PDF dictionary entries, with one undo entry; no author/date/appearance/reply/state is fabricated.

Comment metadata requires caller-owned nonblank author ≤256 UTF-8 bytes without controls and a full valid UTC PDF date `D:YYYYMMDDHHmmSSZ`. Optional addAnnotation metadata must supply both fields; no author/date is generated. Reply bodies cap at 32767 UTF-16 units. Review state and StateModel are PDF text strings; /IRT links are same-page indirect references, /RT is /R. State records have Hidden flag 2, zero Rect and empty Contents; later author state changes chain to the prior author state. Latest ordering is (validated UTC date,ObjectId); changed dates older than that author's latest reject before mutation. Equal dates use the fresh object id. Completed/None project resolved true/false only for explicit review_author; Accepted/Rejected/Cancelled retain review_state with resolved omitted, and no author query implies no global resolved value.

Admitted graphs require unique page-array ownership, including objects without /P, with no cycles/dangling/cross-page/grouping replies. Limits: 4096 references/page, 10000 pages/100000 references for ownership scanning, 100000 PDF objects, 256 records/thread, 64 links/depth. Deletion additionally scans at most 1000000 reference values/depth 64, rejecting unsupported external/popup relationships before mutation. Legal partial/non-UTC dates, unknown state models, nonempty state-record body text and unsupported reply relationships reject conservatively. Removing a comment/reply removes its descendant reply/state records in one undo entry. Original root review state is never overwritten. Existing comment-content edits preserve metadata.

Canonical reply/resolve bindings require explicit metadata provider, reviewAuthor, isCurrent admission and authoritative host commit(action) gate. The adapter rejects actor mismatch and unsupported mentions, rechecks generation after async provider/read work, rereads thread authority within the gate and checks again before the operation. This is caller-owned serialization, not native expected-revision CAS. Raw PDF dates are retained; timeLabel requires an explicit app formatter. No application-host activation or PDF visual rendering is claimed.

Axis-aligned markup accepts one caller-owned rectangle in default PDF user space. Highlight, Underline and StrikeOut persist required QuadPoints as counterclockwise bottom-left, bottom-right, top-right, top-left (ISO 32000-1 Table179), first edge defining horizontal +X text orientation. Width/height must be positive, all corners within ±1000000 units and distinct after lopdf f32 conversion. All annotation corners must remain finite in f32; creation contents cap at 32767 UTF-16 units. Validation precedes journal/object mutation. No glyph hit testing, crop/rotation transform, multi-line quadrilaterals or appearance stream is inferred. Cross-viewer display, including Acrobat's differing QuadPoints convention, remains unverified. Underline/StrikeOut do not enter the narrower Text/Highlight comment editing/reply/review contract. The pinned AnnotationToolbar supports the added underline/strike tool IDs; host supplies actual page coordinates.

Square/Circle annotations use positive bounded caller rectangles and standard PDF geometry, with an explicit solid one-point black DeviceGray border and transparent interior. They carry no QuadPoints or fabricated appearance stream. Because IC is emitted, headers below PDF1.4 are raised to1.4; higher headers and catalog version metadata remain intact, and undo restores the original header. Unsupported header versions reject before mutation. Generic list/delete/save/history apply; comment text/reply/review still supports only Text/Highlight. Renderer placement, styling controls and viewer visual acceptance remain separate.

## pitch-engine — `PitchEngine::new()`

State `{ meta:{title}, size:{width,height}, next_id, slides:[Slide], sections:[Section], next_section_id }`,
`Section = { id, label, start_slide_id }` is a stable deck boundary. Older snapshots default to `sections:[]` and `next_section_id:1`.
`Slide = { id, layout:"blank"|"title"|"titleBody", background:[r,g,b,a]|null,
objects:[Obj], animations:[Anim], notes?:string, ink?:[InkStroke] }`,
`Obj = { id, kind:"text"|"rect"|"image", x,y,w,h, rotation_deg,
text?{content,font_size,color,bold,italic}, fill?[u8;4], src?:string }`,
`Anim = { object_id, kind:"fadeIn"|"slideInLeft"|"zoomIn"|"pulse"|"spin"|"fadeOut"|"zoomOut", start_s, duration_s, trigger? }`,
`InkStroke = { id, kind:"pen"|"highlighter"|"laser", points:[[x,y]..], width, color:[r,g,b,a], opacity?:0..=1 }`.
Ink `points` are `[x, y]` pairs in slide-space units (the same coordinate space
as object x/y/w/h), not normalized. Bounds: 1..=2048 points per stroke,
at most 256 strokes per slide, coordinates finite within ±1,000,000,
width finite >0 and <=10,000, color four integer RGBA channels 0..255,
opacity a finite 0..=1 multiplier (absent ≡ opaque apart from the color
alpha; `opacity:null` in an update clears it). Stroke ids share the
document `next_id` identity space.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{title?}` | `{ok}` | one blank slide |
| `setSlideSize` | `{width,height}` | `{ok}` | finite positive dimensions ≤100000; deck coordinates only, no object scaling or app window changes; one undo entry; identical size is eventless no-op |
| `addSlide` | `{layout?}` | `{slide_id}` | |
| `addSection` | `{label,start_slide}` | `{section_id}` | Creates a stable boundary at a unique existing slide. |
| `updateSection` | `{id,label?,start_slide?}` | `{ok}` | Rename/reassign boundary without changing its ID; equal/empty patch is eventless and preserves redo. |
| `removeSection` | `{id}` | `{ok}` | Removes only the boundary; retains all slides. |
| `removeSlide` | `{id}` | `{ok}` | must keep ≥1 slide |
| `moveSlide` | `{from,to}` | `{ok}` | |
| `moveSlides` | `{order:number[]}` | `{ok}` | Complete unique slide-ID permutation; one undo entry. Identical order is a no-op. |
| `removeSlides` | `{ids:number[]}` | `{ok}` | Unique existing slide IDs; must keep ≥1 slide; one undo entry. Empty selection is a no-op. |
| `setBackground` | `{slide,color|null}` | `{ok}` | slide = id |
| `setNotes` | `{slide,text}` | `{ok}` | slide = id; speaker notes are plain text ≤32768 UTF-8 bytes; empty string clears notes (absent ≡ cleared); equal/no-change patch is an eventless no-op that preserves redo; notes die with their slide (removeSlide/moveSlide/removeSlides follow slide identity) |
| `addInkStroke` | `{slide,stroke:{kind,points,width,color,opacity?}}` | `{stroke_id}` | slide = id; persistent annotation ink in slide-space coordinates; stroke `id` is engine-assigned from `next_id`; full payload validated before mutation; ≤256 strokes/slide, 1..=2048 points/stroke |
| `updateInkStroke` | `{slide,stroke_id,kind?,points?,width?,color?,opacity?}` | `{ok}` | Partial in-place patch retains stroke id and list position; `opacity:null` clears the optional field; validated before mutation; equal/empty patch is an eventless no-op that preserves redo |
| `removeInkStroke` | `{slide,stroke_id}` | `{ok}` | unknown stroke id → NotFound |
| `clearInk` | `{slide}` | `{ok}` | removes every ink stroke on the slide in one undo entry; empty slide is an eventless no-op |
| `slideInk` | `{slide}` | `{strokes:[InkStroke]}` | read-only persistent ink for the slide id; `[]` when unset |
| `addText` | `{slide,x,y,w,h,text,font_size?}` | `{object_id}` | |
| `setText` | `{slide,id,text}` | `{ok}` | |
| `setTextStyle` | `{slide,id,font_size?,bold?,italic?,color?}` | `{ok}` | Text objects only. Partial patch preserves omitted fields/content/geometry. Font size finite and >0; bold/italic strict booleans; color four integer RGBA channels 0..255. Explicit null invalid. Validated before mutation; one history entry/event only for a changed style. Empty/equal patch preserves redo and emits no event. |
| `addRect` | `{slide,x,y,w,h,fill}` | `{object_id}` | |
| `addImage` | `{slide,x,y,w,h,src}` | `{object_id}` | |
| `moveObject` | `{slide,id,x,y}` | `{ok}` | |
| `setObjectOrder` | `{slide,id,to}` | `{ok}` | Absolute bottom-to-top object index within the slide; atomic undo; same-index request preserves history; animation references retain identity |
| `resizeObject` | `{slide,id,w,h}` | `{ok}` | w,h > 0 |
| `rotateObject` | `{slide,id,degrees}` | `{ok}` | |
| `removeObject` | `{slide,id}` | `{ok}` | also drops its animations |
| `addAnimation` | `{slide,object,kind,start_s,duration_s,trigger?}` | `{index}` | duration > 0 |
| `addTriggeredAnimationV1` | same as `addAnimation` | `{index}` | explicit-trigger alias; old engines reject the unknown name rather than silently dropping `trigger` |
| `updateAnimation` | `{slide,index,kind?,start_s?,duration_s?,trigger?}` | `{ok}` | Partial in-place patch retains target object and list position. Existing index required; admitted effect kinds, finite start/delay >=0 and finite duration >0, both ≤86400; explicit null invalid. Validate before mutation, one history entry/event only for actual change; empty/equal patch preserves redo and emits no event. Trigger updates are validated against the complete candidate timeline; list order is unchanged. |
| `updateTriggeredAnimationV1` | same as `updateAnimation` | `{ok}` | explicit-trigger alias; old engines reject the unknown name |
| `removeAnimation` | `{slide,index}` | `{ok}` | staged validation; reject if a first relative animation would lose its predecessor |
| `slideAt` | `{slide,t_s,click_times?:number[]}` | `{objects:[{id,x,y,w,h,rotation,opacity}],schedule:[{index,start_s:number|null,end_s:number|null}]}` | read-only deterministic evaluation; missing click dependencies remain null/pending |
| `slideAtWithClicksV1` | same as `slideAt` | same as `slideAt` | explicit click-history alias; old engines reject the unknown name rather than silently ignoring `click_times` |
| `slideNotes` | `{slide}` | `{notes:string\|null}` | read-only speaker notes for the slide id; `null` when unset |
| `deck` | `{}` | `{title,slide_count}` | read-only |

Undo: prior slide/object/animation state, including speaker notes and ink.

Legacy snapshots without size default to 960×540; invalid sizes reject restore before replacing state. Canvas adapters read persisted size.

Section count is at most 1024; labels are nonblank and at most 1024 UTF-8 bytes. IDs are positive, distinct and below `next_section_id`, with that counter within 1..9007199254740991. Every boundary starts at a distinct existing slide. Add/update validates the full candidate before one journal entry/event; failures consume no identities or redo history. Reordering carries boundaries with their start-slide IDs. Single/bulk slide deletion removes boundaries whose start slides are removed in the same undo step; no silent reassignment. Restore validates section identities/counter/labels/references before replacing state/history. Pinned alpha.4 slide controls have no section props/mutation callbacks; typed operations and read metadata do not imply default UI activation.

Trigger is `{type:"absolute"}` (legacy default, omitted when encoding), `{type:"on-click",click_index:0..255}`, `{type:"with-previous"}` or `{type:"after-previous"}`. Absolute preserves start_s from slide appearance. Other modes treat start_s as delay: click time+delay, immediately previous list entry's resolved start+delay, or its end+delay. First relative entries reject. Explicit host click_times must be a finite ordered prefix of actual slide-relative timestamps, at most256 entries in0..86400; no times are generated. Missing click slots remain pending and propagate through dependent entries. All resolved starts/ends must remain within86400 seconds. Updates/removals/object cleanup validate before mutation; deleting a predecessor that leaves the first entry relative rejects atomically. Other relative entries reanchor to the previous surviving list entry.

Progress p clamps linear `(t−resolvedStart)/duration` to0..1; pending means p=0. FadeIn multiplies opacity byp; SlideInLeft also translates x from−200 to0; ZoomIn center-scales0.5→1 and multiplies opacity byp. Pulse uses center-scale `1+0.2*(1−abs(2p−1))`; Spin adds360p degrees; FadeOut multiplies opacity by1−p; ZoomOut center-scales1→0.5 and multiplies opacity by1−p. Effects on a repeated object compose in declaration order, with multiplicative opacity and sequential geometry, including pending entrance contributions. Exit/emphasis contributions are neutral before their start. This is a declared supported evaluator, not full presentation-software compatibility.

Animation evaluation caps at4096 objects/animations per slide; references and object identities validate, effects are grouped per object for bounded work, and nonfinite composed output rejects rather than emitting invalid geometry. Restore validates timelines/targets before replacing state; missing triggers preserve legacy absolute semantics. SlideAt copies host click history through the typed API and remains history-free.

The pinned alpha.4 SlideAnimationPane supports effect/add/remove but lacks timing/trigger edit callbacks. The adapter offers all seven real effects, retains nonabsolute sourceTrigger metadata and refuses to bind that old pane over triggered programs rather than mislabel relative delays as absolute starts. Typed engine APIs/readPitchSlideAt accept explicit click history. No fake preview timer, host UI activation or new Pitch renderer is provided. Actual CPU pixel integration is checked through the existing Prism renderer.

Explicit trigger intent uses `addTriggeredAnimationV1` / `updateTriggeredAnimationV1`; explicit click histories (including empty) use `slideAtWithClicksV1`. These aliases share current implementation semantics, but old engines reject their unknown names instead of silently ignoring new fields. The typed facade keeps legacy operation names when new arguments are omitted. Snapshots using nondefault deck size, section metadata/counter, nonabsolute triggers or new effects (without notes/ink) use an engine-local JSON `{kind:"pitch",schema:2,document:PitchState}` wrapper inside unchanged NFD1 framing; any document carrying slide speaker notes or non-empty slide ink uses `{kind:"pitch",schema:3,document:PitchState}` instead. Root `meta` is absent so legacy readers fail rather than silently discard fields, and schema:2 readers reject schema:3 payloads rather than dropping notes/ink. Readers accept legacy root payloads and both schema:2 and schema:3 wrappers, strictly validating wrapper kind/schema/keys before replacement; persisted empty-string notes normalize to absent, matching `setNotes` semantics. Legacy-feature-only documents keep the existing payload shape. Older unwrapped extended snapshots remain readable, but already-lost metadata cannot be recovered. P20 still requires matching reader/writer/runtime versions before activation; no old-reader forward-compatible roundtrip is claimed.

## quill-engine — `QuillEngine::new()`

State `{ next free n/a, blocks: [Block] }`,
`Block = { kind:"para"|"h1"|"h2"|"h3"|"list"|"quote", inlines:[Inline], list?:{level:0..8,definition:{id,kind,levels:[9]}} }`,
`Inline = { text, style:{ bold,italic,underline,strike: bool, color?:hex str,
link?:url } }`. Positions `{ block, offset }` (offset = char index within block's
concatenated text). Ranges `{ start:Pos, end:Pos }`, `end` exclusive.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{}` | `{ok}` | one empty para |
| `insertText` | `{at:Pos,text}` | `{ok}` | inherits style of char to the left (or right if at 0); `\n` splits block |
| `deleteRange` | `{from:Pos,to:Pos}` | `{deleted_text}` | cross-block merges survivors |
| `replaceRange` | `{from:Pos,to:Pos,text}` | `{deleted_text}` | `deleteRange` then `insertText` at `from` as one command; validates before mutating; one undo entry |
| `changeCase` | `{from:Pos,to:Pos,mode}` | `{from:Pos,to:Pos}` | modes lower/upper/sentence/capitalize; style-preserving Unicode scalar conversion, adjusted selection end; atomic one undo entry, unchanged/collapsed is eventless |
| `applyStyle` | `{from,to,style:{bold?,italic?,underline?,strike?,color?,link?,font_family?,font_size?,highlight?}}` | `{ok}` | re-splits inlines at range bounds; `font_family` string sets direct Latin family, null clears; 1–128 non-control characters, nonblank; `font_size` is 1–1638 points in half-point increments, null clears; `highlight` is exact `#RRGGBB` run background, null clears (DOCX explicit RGB shd only) |
| `setBlockKind` | `{block,kind}` | `{ok}` | Leaving list kind clears membership; entering legacy list kind uses the explicit bullet0 default below. |
| `setListKind` | `{first,last,kind:"none"|"bullet"|"numbered"|"multilevel"}` | `{ok}` | Atomic inclusive block range; changing kind creates an independent definition, retaining existing levels; same kind is eventless. None clears membership. |
| `setListFormat` | `{first,last,level:0..8,format,start?,indent_twips?,hanging_twips?}` | `{ok}` | Updates each complete definition touched by selected list paragraphs in one undo. Formats bullet/decimal/lowerLetter/upperLetter/lowerRoman/upperRoman. |
| `shiftListLevel` | `{first,last,direction:1|-1}` | `{ok}` | One definition; canonical nesting policy: first item stays0, indent at most one below predecessor, all levels remain0..8. |
| `insertBlock` | `{index,kind?}` | `{block_index}` | |
| `splitBlock` | `{at:Pos}` | `{new_block_index}` | |
| `mergeBlock` | `{index}` | `{ok}` | merge into previous |
| `text` | `{from?,to?}` | `{text}` | plain text, `\n` between blocks |
| `blocks` | `{}` | full structure | read-only |
| `layout` | `{page_width,font_size}` | `{pages:[{lines:[{block,start,end}]}]}` | greedy wrap; avg glyph width 0.5em (h1=1.4x h2=1.25x h3=1.1x); block keeps its page |
| `exportDocx` | `{}` | `{bytes_b64}` | Real ZIP; list paragraphs use numPr/ilvl/numId plus numbering.xml, its document relationship and content-type override. |
| `importDocx` | `{bytes_b64}` | `{blocks}` | parse document.xml: paragraphs → blocks (pStyle), runs → inlines (b,i,u,strike); malformed → Serialization |

Deps: `zip = "2"`, `quick-xml = "0.37"` (adjust to versions that resolve).
Undo: prior `Vec<Block>` for structural ops; for `applyStyle`/`insertText`/
`deleteRange`/`replaceRange` record affected content. replaceRange stages a private candidate before one full-document journal entry, preserving redo on list-budget failure.

---

`changeCase` uses locale-independent Rust Unicode default mappings. Lowercase context is computed for each entire affected paragraph, including outside the selection and across style runs, then aligned to source scalars by their lowercase expansion lengths; contextual output (including Greek final sigma) retains its source style. Alignment mismatch rejects rather than guessing. Uppercase and first-letter capitalization may expand one source scalar into several, all inheriting its style. No locale-specific Turkish/Lithuanian rules or Unicode titlecase/UAX29 segmentation are promised.

Capitalize mode treats Unicode alphanumeric scalars, General_Category=Mark combining marks and straight/curly apostrophes as word units; it uppercases a leading alphabetic scalar and lowercases the remainder. Sentence mode uppercases the first alphabetic scalar of the selected span in each paragraph and after ASCII `. ! ?` followed by whitespace; other selected text lowercases. These are explicit simple editing grammars, not linguistic sentence segmentation. Paragraph kinds and text/styles outside the selected range remain unchanged. Context UTF-8 bytes across all affected paragraphs and converted selection UTF-8 output are each capped at1MiB before live mutation. Positions remain Unicode scalar offsets, not UTF-16 units/graphemes. The returned selection end accounts for expansions; the ribbon adapter rebinds against it.

List definitions carry positive OOXML-compatible IDs<=2147483647, kind bullet/numbered/multilevel and nine levels. Each level stores one admitted format, start1..9999, left indent0..31680 twips and hanging0..left. Default starts1, indent720×(level+1), hanging360; bullet/numbered formats are bullet/decimal at all levels and multilevel cycles decimal/lowerLetter/lowerRoman. Shared Arc definitions serialize per membership; every same-ID copy must match. At most10000 list paragraphs/256 explicit definitions; DOCX numbering projection also caps256 instances. New list edits validate before journal/mutation, preserve all body text/Style fields and never insert literal marker prefixes. Split/newline retain list identity/level; merges retain destination membership, kind changes away from list clear it. Removing/replacing content preserves destination semantics. Old snapshots with kind:list and absent metadata remain supported with an explicit new default bullet0 interpretation; no previous numbering is claimed to have been retained.

DOCX lists use actual abstractNum/lvl/num definitions, direct per-paragraph numPr and distinct num IDs for independent restart instances. Each admitted level writes start/numFmt/lvlText, left/hanging and a matching numbering tab. Numeric templates are current-level `%n.`; bullet glyphs are `•`, `◦`, `▪` by level. Import retains instance IDs, level settings and startOverride restarts. The admitted subset requires explicit level format/start/indent/hanging; missing referenced levels/instances, custom templates, symbol-font/picture bullets, alternate suffix/alignment, full level overrides, style-inherited numbering, paragraph indentation overrides and combined numbered headings/quotes reject. Part targets are bounded local basenames, and numbering requires the transitional w namespace/prefix. Numbering XML<=4MiB/100000 events; relationships<=1MiB; inspected styles<=4MiB. Existing document XML<=256MiB bound remains. These are logical/parser limits, not a security or RSS certificate.

Own legacy bullet projection uses a reserved name only with the complete exact nine-level default template, level0 and one contiguous use; changed/missing template fields or disjoint uses reject rather than dropping settings. A foreign ListParagraph style without numPr imports as unnumbered para, so an absent marker is not fabricated. Explicit definitions never collapse merely because their visible format happens to be bullets. Snapshot/import validation checks definition coherence before replacing live state/history.

The canonical list adapter exposes real kind/format/shift callbacks only for a truthful none or single-definition context, including preceding same-instance items so preview continuation is correct. Nondefault starts or mixed contexts reject with an explicit projection error because the current control cannot display authoritative per-item/start markers. Native APIs and DOCX retain those values. No application UI/pin activation, marker-aware font layout or complete H-07/P12 acceptance is claimed.

Snapshots containing any explicit list membership use an engine-specific JSON wrapper `{kind:"quill",schema:2,document:{blocks:[...]}}` inside the unchanged NFD1 envelope. There is no root blocks field, so pre-list Quill readers fail closed rather than silently discarding unknown list fields. The current reader validates wrapper kind/schema/shape and the complete document before replacing live state/history; foreign/future/malformed wrappers reject. Snapshots without explicit list metadata keep the exact legacy `{blocks:[...]}` shape, including legacy kind:list defaults. No global envelope version or checkpoint/native tag changes.

## Shared engine rules
- serde `rename_all = "camelCase"` is NOT used — payloads use snake_case exactly as written above.
- Every state that serde round-trips must round-trip **identically** (test:
  apply mutations → snapshot → restore → describe equals).
- Write real unit tests in the crate (`#[cfg(test)]`) covering: happy path per op,
  validation errors (state unchanged), snapshot/restore equality, undo/redo
  chains, and the round-trip scenario `new → mutate → snapshot → restore → mutate`.
- Keep deps minimal: workspace `ignition-core`, `serde`, `serde_json`, plus the
  product-specific crates listed. No async, no I/O, no `unsafe`, no `unwrap` on
  untrusted input.

### Prism palette and document reset integration

Prism `new` preserves the palette while resetting layers/artboards/selections, as the recovered color contract specifies. Undo/redo restores the prior canvas state with its palette. Palette edits remain separate atomic history entries; a dialog commit to a selected shape/path uses `setFill` and does not also change the palette in a second command.

## Binary sidecar form (native v1 additive ABI)

Existing JSON/base64 commands remain compatible. `applyBinary`/`startTask` ask for raw output; only these input operations accept an optional raw sidecar:

| Engine | Input operation | Replaced JSON field | Raw output operation |
| --- | --- | --- | --- |
| Prism | drawPixels | data_b64 | flatten |
| Folio | open | bytes_b64 | save |
| Quill | importDocx | bytes_b64 | exportDocx |
| Cadence | none | none | render (interleaved little-endian Float32 stereo) |
| All | none for reserved operations | none | __snapshot (NFD1) |

Exactly one byte input source is required for an input operation. Supplying both a base64 field and sidecar rejects before mutation; unrelated operations reject sidecars. Raw output omits its base64 field and keeps other metadata/events. Version 1 is required. Binary fields are not serialized by serde. Tasks preserve the same operation/undo semantics; cancellation is cooperative at documented safe checkpoints, not a new engine operation.

## photo-engine — `PhotoEngine::new()`

Persistent catalog metadata/version identities and bounded non-destructive sRGB preview processing. No RAW decoder, durable original storage, native resource handles or file I/O. Immutable host-claimed original descriptors are **not content verified** by the catalog. Removing a catalog record never deletes host original bytes.

NFD1 payload is `{kind:"photo",schema:1,next_id,originals:{[id]:Original},versions:{[id]:Version}}`.
`Original={id,sha256,asset_ref,byte_length,camera_make,camera_model,rating,labels}`; `Version={id,original_id,name,develop?}`. IDs are generated strings `original-N` / `version-N`; checked counter ≤2^53−1. Hashes must be lowercase 64-hex and unique across originals (duplicate content imports reject). Asset refs are opaque 1..256-byte ASCII identifiers using letters/digits/`._:-`; the host owns durable retention and resolves the key. Byte length is 1..2^53−1. Camera strings ≤128 bytes; version names nonblank ≤128 bytes; labels nonblank ≤64 bytes, unique, at most32 and stored sorted. Strings reject control characters.

Limits: 10,000 originals, 100,000 versions total, 1..100 versions per original, **8MiB maximum encoded catalog state** and 16 undo entries. Structural states share immutable Arc records; changed records use copy-on-write. These are logical caps, not measured process RSS limits. Every mutation validates its candidate state before replacing live state/history. Noops/read operations have no events/journal entries. Batches are atomic and one outer undo entry. Restore requires exact kind/schema, valid identity/reference/counter/metadata/size invariants and rejects unknown fields before state replacement; successful restore clears prior history. Foreign engine payloads reject.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{}` | `{ok}` | empty catalog; no host asset deletion |
| `describe` | `{}` | complete catalog state | read-only |
| `readOriginal` | `{id}` | `{original,versions}` | read-only; supplied descriptor metadata only |
| `addOriginal` | `{sha256,asset_ref,byte_length,camera_make,camera_model}` | `{original_id,version_id}` | immutable descriptor plus initial version named Original, rating0/labels[]; duplicate hash rejects |
| `removeOriginal` | `{id}` | `{ok}` | removes metadata and associated versions only |
| `setRating` | `{id,rating}` | `{ok}` | integer0..5 |
| `setLabels` | `{id,labels:string[]}` | `{ok}` | replace sorted unique labels |
| `createVersion` | `{original_id,name}` | `{version_id}` | new identity/name with identity develop defaults; no decoded pixels/artifact created |
| `renameVersion` | `{id,name}` | `{ok}` | original reference immutable |
| `removeVersion` | `{id}` | `{ok}` | must retain at least one version per original |

Registered name `photo` appends native ordinal7 and NFC1/NCC1 tag7, preserving existing0..6. Only processPreview admits binary input; other unsolicited sidecars reject. Native binaries require rebuilding for the new kind; source registration alone is not native acceptance.

Develop recipe schema1 is `{schema:1,exposure_ev,contrast,rgb_gain:[r,g,b]}` with finite exposure −8..8, contrast0..4, gains0..8. Missing/identity recipe means0 EV/contrast1/gains1; defaults are omitted from snapshot encoding to preserve legacy identity snapshots. Invalid schema/values reject both edits and restore before mutation. Recipe changes use one existing journal entry; noops preserve redo. `readDevelop` returns explicit defaults. This is not a full RAW/ICC/white-balance recipe.

| op | payload | data | notes |
|---|---|---|---|
| `readDevelop` | `{id}` | `{develop}` | read-only, version id |
| `setDevelop` | `{id,develop}` | `{ok}` | complete validated recipe replacement, persistent undo/redo |
| `processPreview` | `{version_id,original_id,original_sha256,expected_develop,format,width,height,pixels_b64?}` | `{version_id,original_id,original_sha256,develop,format,width,height,row_stride,pixels_b64?}` plus optional binary output | read-only real packed RGBA processing; native input or base64, exactly one |

Preview format is `rgba8-straight-srgb`, shared with Motion assets; width/height are positive integers≤4096 and total pixels≤1048576. Input/output packed bytes are width×height×4, at most4MiB. All original/version/hash/expected-recipe checks precede processing; the hash is a host/provider assertion, not verification that the RGBA derives from a RAW original. No pixels/cache/native handles are persisted in the catalog.

Decode sRGB using the standard0.04045/12.92 transfer branch and exponent2.4; multiply linear channels by2^EV×RGBgain, apply contrast around fixed linear0.18, clip0..1, encode via0.0031308/12.92 branch and inverse exponent, then round nearest8-bit. Preserve alpha exactly, including zero; transform RGB independently even when transparent. Identity is byte-exact. These declared operators do not implement ICC, Kelvin/temperature/tint, lens, masks, tone curves or RAW demosaicing.

Native processPreview moves owned Command.input bytes and supports binary output; JSON-only hosts use bounded base64. Both input and output sizes are preflighted before decoded buffer allocation. The typed facade owns its exact caller view/recipe before awaits and validates returned identity/recipe/format/dimensions/length. Long previews checkpoint every4096 pixels and again after encoding before publication, with progress from actual work. No native platform/total RSS/bitwise cross-libm acceptance is claimed.

## motion-engine — `MotionEngine::new()` (bounded 2D slice)

NFD1 header/format remains unchanged; JSON payload carries `kind:"motion",schema:1`. Motion appends native/checkpoint tag 8 after Photo7; prior tags are unchanged. Persistent composition owns width/height/duration/rational frame rate, monotonic safe-integer layer/key IDs and bottom-to-top shape or immutable-raster layers. Layers contain exactly one `shape` (legacy rect/ellipse) or `asset_id`, never a placeholder shape. Defaulted `assets:{}`/`next_asset_id:1` preserve old shape snapshots; empty/initial fields are omitted only from snapshot encoding. `describe` always materializes both fields, matching the required SDK response. Every layer owns visible/locked/name, Prism-style pivoted 2D transform, opacity and scalar curves for tx/ty/sx/sy/rotation/ox/oy/opacity. Curves use hold/linear/Bezier keys with absolute time/value handles; exact key times resolve that key, outside keyed intervals holds endpoints, empty curves use layer base values. Bezier time is inverted, not substituted as its parameter.

| Op | Payload | Result | Notes |
| --- | --- | --- | --- |
| `new` | `{title?,width?,height?,duration_s?,frame_rate?}` | `{ok}` | Defaults640×360/10s/30fps, replaces document atomically. |
| `describe` | `{}` | full state | Read only. |
| `setComposition` | `{title?,width?,height?,duration_s?,frame_rate?}` | `{ok}` | Proposed duration must contain every retained key. |
| `addShapeLayer` | `{name?,shape:{kind:"rect"|"ellipse",x,y,w,h,fill:[r,g,b,a]}}` | `{layer_id}` | Uses real Prism rendering. |
| `addRasterAsset` | `{width,height,format:"rgba8-straight-srgb",pixels_b64?}` or owned binary input | `{asset_id}` | Immutable packed RGBA, exactly one byte source; strict bounded canonical base64. |
| `readRasterAsset` | `{id}` | `{id,width,height,format,pixels_b64?}` plus requested binary output | Read-only original owned bytes, including hidden RGB at alpha0. |
| `removeRasterAsset` | `{id}` | `{ok}` | Rejects any live layer reference. |
| `addRasterLayer` | `{asset_id,name?}` | `{layer_id}` | References an existing asset; native asset dimensions must fit the composition. |
| `updateLayer` | `{id,name?,visible?,locked?,shape?,asset_id?,transform?:{tx?,ty?,sx?,sy?,rotation?,ox?,oy?},opacity?}` | `{ok}` | Locked layers require a separate unlock before editing; content kind is stable, raster reference may target another valid immutable asset. |
| `removeLayer` | `{id}` | `{ok}` | Removes owned curves; locked layer rejected. |
| `setLayerOrder` | `{order:[id,...]}` | `{ok}` | Exact unique permutation, identities retained. |
| `setPropertyKeys` | `{layer,property,keys:[{id?,time,value,interpolation,in_handle,out_handle}]}` | `{key_ids}` | Complete property-curve replacement; known IDs must belong to that curve, omitted IDs allocate; empty clears. Handles nullable `{time,value}`. |
| `evaluate` | `{time_s}` | `{layers}` | Actual evaluated 2D state, read only; time within composition. |
| `renderFrame` | `{time_s}` | `{width,height,pixels_b64?}` + binary output if requested | Ephemeral Prism scene composites actual RGBA; original command controls JSON/binary delivery. No encoder/export queue. |

Whole proposed state validates before one journal/event on actual change; equal/empty writes and net-unchanged shared `__batch` preserve redo/events. Sixteen Arc/COW history entries, 16MiB serialized state cap; width/height1..4096 and <=1,048,576 output pixels, <=128 layers/curves, <=10,000 keys/curve and <=100,000 total. Duration finite >0..604800s, keys separated >=1e-6s; rational frame rate num1..240000/den1..1001 with quotient1..240. RGBA channels are bytes; geometry finite/positive extents bounded1e7, transform translation/origin/rotation ±1e7, scale magnitude1e-6..1e4 with keys/handles retaining base sign, opacity0..1. Handles must stay in their adjacent time segments/property range. IDs positive and below their next counter, counters <=9007199254740991. Names/title <=512 UTF-8 bytes. Restore validates full kind/schema/state before replacing document/history. Render tasks checkpoint between layers and before/after synchronous Prism flatten; no cancellation within the compositor is claimed. Only addRasterAsset admits binary input; other unsolicited sidecars reject. No 3D, nesting, spring, matte/effect, expression, particle, media decoder or encoded queue is implemented.

Raster assets declare packed straight-alpha sRGB RGBA8 (`rgba8-straight-srgb`); no codec/ICC/de-premultiplication is inferred. Positive width/height≤4096, one megapixel/4 MiB per asset, at most16 assets and4 MiB decoded total. Encoded length/padding/alphabet and declared aggregate are checked before RGBA decode allocation, then canonical bytes/exact length and full proposed state validate before publication. Snapshots serialize owned Arc buffers as base64 inside unchanged schema1/NFD1; asset IDs are unique positive safe integers below their defaulted next counter. No pixel-update operation exists: new pixels create a new identity. Referenced assets cannot be removed.

Prism raster layers use canvas-sized backing: referenced asset dimensions must fit composition dimensions, and shrinking below them rejects atomically. At most16 raster layers with logical current canvas storage count×width×height×4≤16 MiB; this is not a peak-RSS guarantee because the ephemeral Prism journal may retain previous canvases/regions. Assets/history/header changes share immutable Arc buffers. Render materializes the actual Prism addRasterLayer + binary drawPixels upload, applies the existing pivot/transform/opacity/visibility/keyframe path and composites real pixels. Fully transparent assets are valid, including nonzero pivots. Typed JSON-only hosts synchronously own the exact Uint8Array/Buffer subview and encode it before any await; native FFI uses the existing owned Command.input path. No optional Host binary shim or borrowed caller buffer is introduced.

## design-engine — `DesignEngine::new()` (fixed-frame layout slice)

Registered Design/design at appended checkpoint/native ordinal9 after Motion8; prior ordinals stay unchanged. Snapshot NFD1 JSON owns `kind:"design",schema:1,title,next_id,nodes`. Root node1 is a fixed canvas frame; all other nodes form one ordered acyclic tree of frames/rectangles/ellipses. Coordinates use document units; per-axis fixed/hug/fill modes are evaluated with bounded dependencies. No constraints, text, component/variable/prototype runtime or clipping is admitted.

| Op | Payload | Result | Notes |
| --- | --- | --- | --- |
| `new` | `{title?,width?,height?}` | `{ok}` | Replaces document with an empty root canvas; defaults640×360. |
| `setComposition` | `{title?,width?,height?}` | `{ok}` | Root must be editable; canvas dimensions positive integers. |
| `describe` | `{}` | full state | Read only. |
| `addFrame` | `{parent,name?,x?,y?,width?,height?,fill?,visible?}` | `{node_id}` | Parent must be an editable frame. Defaults0,0/100×100/transparent. |
| `addShape` | same + `kind:"rect"|"ellipse"` | `{node_id}` | Real Prism shape primitives. |
| `updateNode` | `{id,name?,x?,y?,width?,height?,fill?,visible?,locked?}` | `{ok}` | Root geometry uses setComposition. Locked node requires a separate lock-only unlock; locked ancestors block it. |
| `setFrameLayout` | `{id,layout:null|{direction:"row"|"column",wrap?:boolean,gap,padding_top,padding_right,padding_bottom,padding_left,align:"start"|"center"|"end"|"stretch",justify:"start"|"center"|"end"|"space-between"}}` | `{ok}` | Complete flow settings; null restores absolute child positioning. |
| `setAxisSizing` | `{id,axis:"x"|"y",mode:"fixed"|"hug"|"fill",value?}` | `{ok}` | Numeric value only for fixed. A transition to fixed without value freezes current evaluated size; explicit fixed value resizes. |
| `readAxisSizing` | `{id}` | `{x,y}` axis capability records | Read only; actual candidate admission supplies canHug/canFill and mode reasons. |
| `setChildOrder` | `{parent,order:[id,...]}` | `{ok}` | Exact unique permutation of existing direct children. |
| `reparentNode` | `{id,parent,index}` | `{ok}` | Index in destination after removal; retains authored local coordinates; rejects cycles. |
| `removeNode` | `{id}` | `{ok}` | Deletes subtree; root cannot be removed; every descendant must be editable. |
| `evaluateLayout` | `{}` | `{boxes:[{id,kind,x,y,width,height,fill,visible}]}` | Read-only world-space preorder boxes. |
| `renderFrame` | `{}` | `{width,height,pixels_b64?}` + binary output if requested | Actual ephemeral Prism RGBA scene; no encoder/file delivery. |

Absolute children use parent origin plus local x/y. Flow overrides child x/y in computed output, evaluates axis sizes, and applies padding/gap, cross-axis alignment and main-axis distribution. Stretch overrides evaluated cross size without changing stored size. Extra main space is nonnegative; overflowing fixed children retain size and start from leading padding. Center/end may overflow cross-axis bounds. Hidden nodes still occupy flow space and validate; visibility is inherited. Frames do not clip descendants. Every computed box, including hidden boxes, must satisfy Prism's finite ±1e7 coordinate/positive size constraints. Effective nested frame padding must leave positive content size. These checks precede mutation and restore.

Lock is authored edit permission on a node and its descendants, not a frozen world-space result: unlocked ancestor layout/reparent/order operations can reposition locked descendants. Separate unlock admits only the locked field; subtree removal checks every descendant. Root new/restore/history remain full-document lifecycle operations.

Wrapping defaults false for legacy schema1 snapshots; false is omitted when serializing, preserving the original nonwrap representation. True requires the updated reader. When true, ordered fixed children greedily form lines against padded main size; exact fits stay on the line and an oversized item occupies its own visibly overflowing line. Each line gets the maximum authored cross size of its children; align (including stretch) applies within that line, justify applies independently per line, and gap also separates lines. Wrapped lines start from leading cross padding without cross-line distribution. Hidden children still participate. No clamp or wrap-driven persistent resize occurs.

Whole candidate validation precedes one history/event entry; equal writes and net-equal atomic batches preserve redo/events. Sixteen Arc/COW history states, <=1024 nodes, <=64 parent edges, <=512-byte names/title, safe-integer IDs below next counter, 8MiB encoded state. Local x/y bounded1e6; positive fixed/evaluated sizes bounded1e7; gap/padding0..100000. Root width/height1..4096 and <=1,048,576 pixels before allocation. Restore checks kind/schema/tree/bounds/evaluated geometry before replacing state/history. Render tasks checkpoint between nodes and before/after synchronous Prism flatten; no inside-compositor interruption is claimed. Binary input, app activation and native rebuilt support remain outside this slice.

Sizing defaults to `{x:"fixed",y:"fixed"}` for old nodes and is omitted when both fixed. Width/height retain their authored values during hug/fill; direct width/height updates require fixed mode. `readAxisSizing` returns mode, value (current evaluated size for hug/fill, authored scalar for fixed), fixedValue, resolvedValue, canHug/canFill, optional unavailableReason (root/locked ancestry), and hugReason/fillReason from actual whole-candidate validation. Root remains a fixed canvas edited through setComposition. Rect/ellipse have no intrinsic content and cannot hug. Empty hugged frames use0.001 intrinsic content units plus layout padding, allowing last-child removal. Absolute hug takes positive trailing extents from its anchored origin; negative leading children remain visible overflow rather than moving the origin.

Nonwrap main-axis hug sums resolved child extents/gaps/padding; cross hug uses the maximum intrinsic child extent. Fill requires definite parent content space: nonwrap flow main fill children share positive remaining space equally after fixed/hug siblings and gaps; cross fill takes content extent, and absolute fill takes parent content extent minus local offset. Exhausted/nonpositive remainder rejects atomically. Parent stretch still overrides effective cross size for legacy fixed children; nonwrap descendant fill sees that effective stretched parent size. Cross hug under parent stretch rejects; hug/stretch parents measure fixed children's intrinsic extents. Wrap main-axis hug has no definite line width and rejects. Fill directly inside wrapped flow is not admitted. Wrapped cross-axis hug measures actual line cross extents plus gaps/padding; stretch lines require fixed intrinsic cross children. Cyclic or excessive dependency chains reject before state/history replacement. Current capability flags/reasons reflect these restrictions, never a stored UI flag.

Transitioning hug/fill to fixed without an explicit numeric edit freezes evaluated geometry, including sizes over the former1e6 fixed cap; fixed size cap is aligned to the1e7 renderer bound. Root/output budgets and app window dimensions remain unchanged. The canonical source fixed-size numeric editor still advertises a1e6 limit; native/pinned host range alignment and control integration remain a separate gate, with no UI activation in this slice.

## draft-engine — `DraftEngine::new()` (bounded 2D slice)

Draft appends native/NFC1/NCC1 tag 10 after Design9, preserving tags0..9. NFD1 framing is unchanged; JSON state carries `kind:"draft",schema:1`, units (`mm|cm|m|in` metadata), safe monotonic shared entity IDs, world points, ordered finite segments, analytic circles/arcs, linear point constraints and snap settings. Viewport transforms and selection are host state, never silently persisted as world geometry. No unit conversion is implied by units metadata.

| Op | Payload | Result / behavior |
| --- | --- | --- |
| `new` | `{units?}` | `{ok}`; resets to empty geometry, default mm/grid spacing10. |
| `describe` | `{}` | Full state plus ephemeral monotonic `source_revision`. |
| `addPoint` | `{x,y,locked?}` | `{point_id}`. |
| `updatePoint` | `{id,x?,y?,locked?}` | `{ok}`; locked points, locked-segment endpoints and locked-circle/arc centers cannot move. |
| `removePoint` | `{id}` | `{ok}`; rejects locks and remaining segment/circle/arc/constraint references. |
| `addSegment` | `{a,b,name?,color?,width?,visible?,locked?}` | `{segment_id}`; distinct existing point IDs; width in world units. |
| `updateSegment` | `{id,a?,b?,name?,color?,width?,visible?,locked?}` | `{ok}`; locked segment requires separate unlock. |
| `removeSegment` | `{id}` | `{ok}`; rejects lock and remaining horizontal/vertical constraint references. |
| `setSegmentOrder` | `{order:[id,...]}` | `{ok}`; exact unique segment permutation replacing segment slots only; circle/arc positions remain intact. |
| `addCircle` | `{center,radius,name?,color?,width?,visible?,locked?}` | `{circle_id}`; existing stable center point. |
| `addArc` | `{center,radius,start_deg,sweep_deg,name?,color?,width?,visible?,locked?}` | `{arc_id}`; signed degrees in world x/y axes. |
| `updateCircle` / `updateArc` | `{id,...partial admitted geometry/style fields}` | `{ok}`; locked entities require separate unlock before other edits. |
| `removeCircle` / `removeArc` | `{id}` | `{ok}`; rejects locked entity, retains shared center point. |
| `setEntityOrder` | `{order:[id,...]}` | `{ok}`; exact permutation of segments/circles/arcs. |
| `setSnapSettings` | `{grid?,spacing?,origin_x?,origin_y?,endpoint?,midpoint?,projection?,intersection?,center?,nearest_circle?,tangent?,ortho?,polar?,polar_increment?}` | `{ok}`; persistent world-grid/feature settings. |
| `querySnap` | `{x,y,tolerance,anchor?:{x,y}}` | `{candidate:null|{kind,x,y,distance,sources,angle_degrees?},source_revision}`; tolerance is world units, inclusive radius. |
| `executeCommand` | `{command}` | `{message,result}` from the same admitted model operations; bounded explicit grammar below. |
| `addConstraint` | `{definition,enabled?}` | `{constraint_id}`; stores intent, does not claim it is solved. |
| `updateConstraint` | `{id,definition?,enabled?}` | `{ok}`; atomic complete definition replacement. |
| `removeConstraint` | `{id}` | `{ok}`. |
| `solve` | `{tolerance?}` | `{scope:"point_coordinates",status,rank,dof,residual,unsatisfied_constraints,unsatisfied_locked_points,applied}`; consistent bounded geometry publishes atomically, otherwise no geometry/history/event change. |
| `evaluate` | `{}` | Actual world `{points,segments,circles,arcs,order,source_revision}`. |
| `renderFrame` | `{width,height,origin_x,origin_y,scale}` | Real Prism stroked-path RGBA; JSON/base64 or original command's binary output. Positive scale is pixels/world unit, origin maps to pixel0,0. |

Constraint definitions are `fixed {point,x,y}`, `coincident {a,b}`, `horizontal|vertical {segment}`, `distance_x|distance_y {a,b,value}` under a `kind` discriminator. Distances are signed axis differences (`b-a`), not nonlinear Euclidean distances. Locked points and endpoints of locked segments are exact fixed coordinates: the solver restores them exactly before recomputing residual/status. Gaussian elimination solves only these linear equations with deterministic bounded pivots; free coordinates retain authored values. Rank/DOF refer to this admitted coordinate matrix. `solved`/`underconstrained` mean residual within the requested absolute world tolerance (default1e-7, allowed1e-9..1e-3); residual/unsatisfied IDs remain explicit. Inconsistent attempts do not publish geometry or clear redo. Consistent solutions outside world bounds reject atomically.

Snaps use all authored points for endpoints, including standalone and hidden-segment-only points; midpoint/projection/intersection use visible segments. Projection clamps to a finite segment. Unique finite-segment intersections exclude zero-length, collinear/overlapping and angular-nearparallel pairs (relative determinant cutoff1e-12). Grid half-ties round away from zero. Candidate order is exact computed distance, then endpoint/center/intersection/midpoint/projection/nearest_circle/tangent/ortho/polar/grid priority, then stable source IDs; tolerance is a radius, not a near-tie priority override. When no candidate qualifies, `candidate` is null. Distinct point IDs may share coordinates; such zero-length segments skip projection/intersection and draw no path, retaining real geometry identities.

Limits:64 points/128 solver variables,128 segments/constraints,384 equation rows, at most16777216 elimination coefficient updates, world coordinates ±1e6, signed axis distances ±2e6, world stroke width1e-6..1000, grid spacing1e-6..1e6, names512 UTF-8 bytes,8 MiB serialized state and16 Arc/COW history entries. Full candidate/restore validates kind/schema, identities/references/order, finite bounds and budgets before live mutation. Equal writes and net-equal batches preserve redo/events. Revision-bearing `describe`/`evaluate`/`querySnap` reject inside shared atomic batches so no intermediate revision escapes as final geometry; successful batches advance source revision once. Undo/redo/restore advance the ephemeral source revision without changing persisted IDs.

Render viewport is width/height1..4096, <=1048576 pixels, world origin ±1e6, positive scale1e-6..1e4. Every transformed path coordinate and stroke must fit Prism's public ±1e7/positive-width limits before compositor/output allocation; unsupported projected extents reject rather than render a fabricated frame. Render tasks checkpoint between paths and before/after synchronous flatten, not within Prism. No binary input ops, nonlinear/general CAD, 3D, encoded export, default UI activation or native target acceptance is claimed.

Ortho/polar settings default false and polar increment45° when absent from old schema1 snapshots. Guides require a transient bounded world anchor; omitting it yields no guide candidates. Ortho projects onto the two bidirectional world axes through that anchor (0°/90°). Polar projects onto forward rays at k*increment<360°, increment0.01..360°, clamping a behind-ray dot product to zero. The nearest legal ray is chosen from neighboring angular indices plus the first/last wrap rays, without enumerating36000 rays or wrapping an illegal generated angle into a different ray. Nondivisor increments retain their actual gaps (100° admits0/100/200/300, never400° or40°). Exact guide ties use angle order after normal distance/mode/source priority. Guides still require the inclusive world tolerance; they are candidates, not silently enforced geometric constraints.

`executeCommand` accepts one ASCII command of at most4096 bytes,1..8 whitespace-delimited tokens of at most64 bytes each. Keywords are ASCII case-insensitive; finite decimal/scientific numbers and positive safe integer IDs are supported. Grammar: `POINT x y`; `LINE x1 y1 x2 y2`; `SEGMENT pointIdA pointIdB`; `CIRCLE centerX centerY radius`; `ARC centerX centerY radius startDegrees sweepDegrees`; `MOVE pointId x y` (absolute); `DELETE POINT|SEGMENT|CIRCLE|ARC|CONSTRAINT id`; `SOLVE [tolerance]`; `SNAP x y tolerance [anchorX anchorY]`. No expressions, code, unit suffixes, quotes, compound commands or unsupported primitives are evaluated. LINE stages two actual addPoint calls and addSegment; CIRCLE/ARC stage one real center point and the circular entity, committing one validated history step only after all succeed. Other commands re-enter their existing authoritative operation, including locks/reference validation, no-op behavior and SNAP's batch revision guard. An inconsistent SOLVE command rejects with its actual report instead of presenting success; underconstrained consistent geometry remains explicitly labeled. Failed parsing/staging does not consume IDs/history or clear redo. Command history/drafts stay host-owned. The typed canonical command binding forwards engine rejection so failed input stays in the control; snap feedback requires matching query.source_revision and authoritative host sourceRevision and is withheld for stale/closed sessions. Current CAD control source contracts are mapped, but alpha.4 does not publish those CAD exports; no default UI adoption is implied.

Circle/arc extension: old schema1 snapshots omit empty maps and false new flags; restore defaults them, while describe/evaluate always expose circular maps and describe normalizes the flags. There are at most128 total segments/circles/arcs (and at most64 each circles/arcs), sharing the existing safe entity ID space. Radius is1e-6..1e6 world units and the entire containing circle must fit ±1e6 even for partial arcs. Arc start is finite within ±360000°, signed sweep has absolute value1e-6..360°, and partial endpoints must remain distinct at represented precision. Positive sweep follows increasing world y (clockwise on the positive-y-down viewport). A full360° arc is valid with one endpoint snap at its start. Shared centers move all referencing unlocked entities; any locked curve fixes that center exactly. Radius/start/sweep are authored values, not solver variables; solve scope/rank/DOF explicitly cover point coordinates only, with no radius/angle/nonlinear satisfaction claim.

Center, nearest_circle and tangent modes default false. Circular snaps use only visible entities; endpoint adds arc ends, midpoint adds the half-sweep arc point. Nearest-circle projects radially or clamps to the nearer arc endpoint; a query at center deterministically selects +X for a circle or the arc start. Tangents require the supplied world anchor: inside yields none, exact boundary yields one contact, outside yields up to two filtered by directed arc membership. Unique analytic segment-circle and circle-circle intersections are arc-filtered; degenerate segments, concentric/coincident carriers and nonunique cocircular overlaps yield none. Segment-circle skips squared lengths<=1e-18. Distance boundaries use computed f64 comparisons without inflating radius by query tolerance; directed arc membership admits a1e-10-degree endpoint roundoff allowance. This is bounded floating-point geometry, not exact predicates or CAD conformance. New source bindings expose tangent availability only when the actual host anchor is present; feedback still requires matching source revision.

Persistent circles/arcs and snap math stay analytic. Rendering converts each circle or arc into at most four tangent-matched cubic spans of at most90° and uses the existing Prism path rasterizer; this is an explicit cubic display approximation, not precision plotting or a second renderer. All projected nodes, relative handles, absolute control points and strokes are checked against Prism limits before allocation. Existing Prism antialiasing/sampling applies. No released CAD UI adoption, native acceptance or complete P17 claim follows from these source operations.

Matching-reader safety: when any circle/arc exists or center/nearest_circle/tangent is enabled, snapshot JSON is `{kind:"draft",schema:2,document:<validated internal schema1 state>}` inside unchanged NFD1 framing. Legacy root required fields (units/points/etc.) are absent, so old readers fail rather than discard new geometry/settings. New readers accept strict Draft/schema2 wrappers or unchanged legacy state, reject unknown wrapper fields/kind/schema and reject unwrapped extended state. Empty circular maps plus false new flags retain the original legacy serialization. Describe/evaluate are current-source API state, not this persistence wrapper; native/checkpoint ordinals and global envelopes remain unchanged.
