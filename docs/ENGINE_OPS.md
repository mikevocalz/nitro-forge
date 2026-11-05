# Engine op surface — authoritative

Every product engine implements `ignition_core::Engine` and supports these ops via
`apply(Command { op, payload })`. Op names are the TS API contract — do not rename.

Universal ops every engine MUST support in `apply`:
- `new` — reset the document from `payload` (engine-specific params). Returns `{ ok: true }`.
- `describe` — return the complete document state as JSON in `data`. Read-only; records no undo.

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

State `{ width, height, next_id, layers: [Layer] }`.
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
| `setShapeFill` | `{id,color:[r,g,b,a]}` | `{ok}` | shape only; preserves geometry/ID, one undo step; NotFound if absent, Validation for raster/channels >255, InvalidCommand for malformed RGBA (including negative/non-integer channels) |
| `transformShape` | `{id,dx,dy,scale_x,scale_y}` | `{ok}` | shape only; translate by dx/dy and scale positive w/h about top-left; finite computed bounds required; one undo step; permits off-canvas geometry |
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

Undo: structural ops record prior `Vec<Layer>` (cheap — pixels are `Arc`);
`drawPixels`/`fillLayer`/`applyFilter` record `{layer_id, rect, prev_b64}`.

## tally-engine — `TallyEngine::new()`

State `{ next_sheet, sheets: [Sheet], active: idx }`,
`Sheet = { id, name, cells: { "A1": { raw: string } } }` — computed values are
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
| `setCell` | `{addr,value}` | `{addr,computed}` | on active sheet; `value` string starting `=` is a formula; numeric strings become numbers; empty string clears |
| `setRange` | `{from,values:string[][]}` | `{changed}` | nonempty rectangular paste; empty strings clear; at most 16,384 cells; must fit inside XFD1048576; one undo entry |
| `fillRange` | `{source:{from,to},target:{from,to}}` | `{changed}` | inclusive rectangles, target contains source; repeat source outside its bounds, shift relative references, preserve `$` locks; each rectangle at most 16,384 cells and inside XFD1048576; one undo entry |
| `clearCell` | `{addr}` | `{ok}` | |
| `getCell` | `{addr}` | `{raw,computed}` | `computed` = evaluated value |
| `getRange` | `{from,to}` | `{cells:[[{addr,raw,computed}]]}` | |
| `evaluate` | `{formula}` | `{value}` | ad-hoc formula against active sheet, no write |
| `workbook` | `{}` | `{sheets:[{name,cell_count}],active}` | read-only |

Formula language (recursive-descent parser, case-insensitive fns):
numbers, `"strings"`, cell refs, ranges `A1:B2`, unary `-`, binary
`+ - * / ^`, `%` postfix, parens, `&` concat, comparisons `= <> < <= > >=`,
functions `SUM AVERAGE MIN MAX COUNT COUNTA IF(cond,a,b) ROUND(x,n) ABS CONCAT`.
Error values: `#DIV/0! #VALUE! #REF! #NAME? #NUM! #CYCLE!` — cycles detected via
evaluation-time visited set. Evaluation memoizes per-request.

Undo: per-cell previous `{addr, prev_raw}` (or removal); range edits group changed cells into one entry. No-op range edits emit no event and preserve redo. Fill reads all source cells before writing. Formula strings, names, whitespace and scientific notation remain unchanged; a reference shifted past row 1,048,576 or column XFD becomes `#REF!`, and a range with either endpoint off the sheet becomes a single `#REF!`. Lexically invalid source formulas reject the entire fill without mutation. Numeric series inference and cross-sheet references are not supported.

## cadence-engine — `CadenceEngine::new()`

State `{ tempo_bpm, time_sig: [n,d], ppq: 960, playhead_ticks, next_id,
tracks: [Track] }`. `Track = { id, name, kind:"midi"|"audio", volume 0..=1,
pan -1..=1, muted, solo, clips: [Clip] }`.
`Clip = { id, start_ticks, length_ticks, notes: [Note] }` (midi tracks only;
audio track clips have no notes — `addNote` → Validation).
`Note = { pitch 0..127, velocity 0..127, start_ticks, length_ticks }` (clip-relative).

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
| `render` | `{from_ticks,to_ticks,sample_rate}` | `{samples_b64,frames,channels:2}` | f32le stereo; sine osc, 20ms linear attack/release, equal-power pan, track gain, mute/solo |

Ticks→seconds: `ticks / (ppq * bpm / 60)`. Undo: prior field values / removed entities.

## splice-engine — `SpliceEngine::new()`

State `{ fps, next_id, sources: {id: {name, duration_s}}, tracks: [Track] }`,
`Track = { id, kind:"video"|"audio", clips: [Clip] }`,
`Clip = { id, source_id, timeline_start_s, in_s, out_s, speed }`.
Clip's timeline length = `(out_s - in_s) / speed`.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{fps?}` | `{ok}` | default 30 |
| `addSource` | `{duration_s,name?}` | `{source_id}` | duration > 0 |
| `removeSource` | `{id}` | `{ok}` | Validation if referenced by a clip |
| `addTrack` | `{kind}` | `{track_id}` | video or audio |
| `removeTrack` | `{id}` | `{ok}` | |
| `addClip` | `{track,source,in_s,out_s,speed?,start_s?}` | `{clip_id}` | `start_s` defaults to end of track; reject overlap; `in<out≤source.duration` |
| `removeClip` | `{id}` | `{ok}` | |
| `moveClip` | `{id,start_s}` | `{ok}` | reject overlap |
| `trimClip` | `{id,in_s?,out_s?}` | `{ok}` | bounds vs source, in<out, reject overlap |
| `splitClip` | `{id,at_s}` | `{left_id,right_id}` | `at_s` timeline time strictly inside clip; right half keeps speed |
| `setSpeed` | `{id,speed}` | `{ok}` | 0.1..=10; adjusts timeline footprint; reject overlap |
| `duration` | `{}` | `{seconds}` | max clip end across tracks |
| `timeline` | `{}` | full structure | read-only |
| `renderPlan` | `{}` | `{tracks:[[clip refs in time order]]}` | ordered, resolved source spans — what an encoder consumes |

Undo: prior clip/track/source state. Event `timeline:changed` on structural ops.

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
| `applyStyle` | `{from,to,style:{bold?,italic?,...}}` | `{ok}` | re-splits inlines at range bounds |
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
