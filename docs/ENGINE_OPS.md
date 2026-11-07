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
`Sheet = { id, name, tone?: string | null, cells: { "A1": { raw: string } } }` — computed values are
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
| `workbook` | `{}` | `{sheets:[{name,cell_count,tone}],active}` | read-only |

Formula language (recursive-descent parser, case-insensitive fns):
numbers, `"strings"`, cell refs, ranges `A1:B2`, unary `-`, binary
`+ - * / ^`, `%` postfix, parens, `&` concat, comparisons `= <> < <= > >=`,
functions `SUM AVERAGE MIN MAX COUNT COUNTA IF(cond,a,b) ROUND(x,n) ABS CONCAT`.
Error values: `#DIV/0! #VALUE! #REF! #NAME? #NUM! #CYCLE!` — cycles detected via
evaluation-time visited set. Evaluation memoizes per-request.

Undo: per-cell previous `{addr, prev_raw}` (or removal); range edits group changed cells into one entry. No-op range edits emit no event and preserve redo. Fill reads all source cells before writing. Formula strings, names, whitespace and scientific notation remain unchanged; a reference shifted past row 1,048,576 or column XFD becomes `#REF!`, and a range with either endpoint off the sheet becomes a single `#REF!`. Lexically invalid source formulas reject the entire fill without mutation. Numeric series inference and cross-sheet references are not supported.

Sheet creation/duplication reject exhausted ids before mutation; restore rejects ids for which the next id cannot be represented. Tab tones default to none when restoring older snapshots; unknown tones reject restore atomically. Sheet moves and color edits validate before mutation and support undo/redo via the workbook journal. Same-value requests return `{ok:true}` with no events and no undo entry, preserving redo history.

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
| `addAnnotation` | `{page,rect:[x,y,w,h],contents,subtype?}` | `{annot_id}` | real PDF: appends obj to page `/Annots` (`/Subtype /Text|/Highlight`, `/Rect`, `/Contents`) |
| `listAnnotations` | `{page}` | `{annots:[{id,subtype,rect,contents}]}` | |
| `removeAnnotation` | `{page,id}` | `{ok}` | |
| `rotatePage` | `{page,degrees}` | `{ok}` | sets `/Rotate`, must be multiple of 90 |
| `save` | `{}` | `{bytes_b64,size}` | `doc.save_to` → real PDF bytes |
| `info` | `{}` | `{pages,has_annots}` | read-only |

Undo: previous serialized `doc` (lopdf Document clone — it implements Clone; cap 8).

## pitch-engine — `PitchEngine::new()`

State `{ meta:{title}, next_id, slides:[Slide] }`,
`Slide = { id, layout:"blank"|"title"|"titleBody", background:[r,g,b,a]|null,
objects:[Obj], animations:[Anim] }`,
`Obj = { id, kind:"text"|"rect"|"image", x,y,w,h, rotation_deg,
text?{content,font_size,color,bold,italic}, fill?[u8;4], src?:string }`,
`Anim = { object_id, kind:"fadeIn"|"slideInLeft"|"zoomIn", start_s, duration_s }`.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{title?}` | `{ok}` | one blank slide |
| `addSlide` | `{layout?}` | `{slide_id}` | |
| `removeSlide` | `{id}` | `{ok}` | must keep ≥1 slide |
| `moveSlide` | `{from,to}` | `{ok}` | |
| `moveSlides` | `{order:number[]}` | `{ok}` | Complete unique slide-ID permutation; one undo entry. Identical order is a no-op. |
| `removeSlides` | `{ids:number[]}` | `{ok}` | Unique existing slide IDs; must keep ≥1 slide; one undo entry. Empty selection is a no-op. |
| `setBackground` | `{slide,color|null}` | `{ok}` | slide = id |
| `addText` | `{slide,x,y,w,h,text,font_size?}` | `{object_id}` | |
| `setText` | `{slide,id,text}` | `{ok}` | |
| `addRect` | `{slide,x,y,w,h,fill}` | `{object_id}` | |
| `addImage` | `{slide,x,y,w,h,src}` | `{object_id}` | |
| `moveObject` | `{slide,id,x,y}` | `{ok}` | |
| `setObjectOrder` | `{slide,id,to}` | `{ok}` | Absolute bottom-to-top object index within the slide; atomic undo; same-index request preserves history; animation references retain identity |
| `resizeObject` | `{slide,id,w,h}` | `{ok}` | w,h > 0 |
| `rotateObject` | `{slide,id,degrees}` | `{ok}` | |
| `removeObject` | `{slide,id}` | `{ok}` | also drops its animations |
| `addAnimation` | `{slide,object,kind,start_s,duration_s}` | `{index}` | duration > 0 |
| `removeAnimation` | `{slide,index}` | `{ok}` | |
| `slideAt` | `{slide,t_s}` | `{objects:[{id,x,y,w,h,rotation,opacity}]}` | animation interpolation: before start → hidden(0)/offset; during → eased progress; after → final. slideInLeft starts x-200px, zoomIn scales 0.5→1 |
| `deck` | `{}` | `{title,slide_count}` | read-only |

Undo: prior slide/object/animation state.

## quill-engine — `QuillEngine::new()`

State `{ next free n/a, blocks: [Block] }`,
`Block = { kind:"para"|"h1"|"h2"|"h3"|"list"|"quote", inlines:[Inline] }`,
`Inline = { text, style:{ bold,italic,underline,strike: bool, color?:hex str,
link?:url } }`. Positions `{ block, offset }` (offset = char index within block's
concatenated text). Ranges `{ start:Pos, end:Pos }`, `end` exclusive.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{}` | `{ok}` | one empty para |
| `insertText` | `{at:Pos,text}` | `{ok}` | inherits style of char to the left (or right if at 0); `\n` splits block |
| `deleteRange` | `{from:Pos,to:Pos}` | `{deleted_text}` | cross-block merges survivors |
| `replaceRange` | `{from:Pos,to:Pos,text}` | `{deleted_text}` | `deleteRange` then `insertText` at `from` as one command; validates before mutating; one undo entry |
| `applyStyle` | `{from,to,style:{bold?,italic?,underline?,strike?,color?,link?,font_family?}}` | `{ok}` | re-splits inlines at range bounds; `font_family` string sets direct Latin family, null clears; 1–128 non-control characters, nonblank |
| `setBlockKind` | `{block,kind}` | `{ok}` | |
| `insertBlock` | `{index,kind?}` | `{block_index}` | |
| `splitBlock` | `{at:Pos}` | `{new_block_index}` | |
| `mergeBlock` | `{index}` | `{ok}` | merge into previous |
| `text` | `{from?,to?}` | `{text}` | plain text, `\n` between blocks |
| `blocks` | `{}` | full structure | read-only |
| `layout` | `{page_width,font_size}` | `{pages:[{lines:[{block,start,end}]}]}` | greedy wrap; avg glyph width 0.5em (h1=1.4x h2=1.25x h3=1.1x); block keeps its page |
| `exportDocx` | `{}` | `{bytes_b64}` | valid minimal .docx (zip + `[Content_Types].xml` + `word/document.xml`); runs carry b/i/u/strike, blocks map to pStyle Heading1-3/ListParagraph/Quote |
| `importDocx` | `{bytes_b64}` | `{blocks}` | parse document.xml: paragraphs → blocks (pStyle), runs → inlines (b,i,u,strike); malformed → Serialization |

Deps: `zip = "2"`, `quick-xml = "0.37"` (adjust to versions that resolve).
Undo: prior `Vec<Block>` for structural ops; for `applyStyle`/`insertText`/
`deleteRange`/`replaceRange` record affected block range's previous content.

---

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
