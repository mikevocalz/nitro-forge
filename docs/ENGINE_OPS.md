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
  When `__batch` runs as a task (`apply_long`), every step executes through the
  staged engine's `apply_long` on a scoped progress window: steps checkpoint for
  cancellation (a cancelled step rejects the whole batch with `Cancelled`,
  leaving document and history untouched) and task progress advances per step.

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

State `{ next_sheet, sheets: [Sheet], active: idx, names: [NamedRange], validations: [ValidationRule], next_validation, conditional_formats: [ConditionalRule], next_conditional, filters: [FilterRule], next_filter, charts: [ChartSpec], next_chart, sparklines: [SparklineSpec], next_sparkline, views: [SheetView], next_view, comments: [Comment], next_comment }`,
`Sheet = { id, name, tone?: string | null, is_protected?: boolean, active_view?: number | null, cells: { "A1": { raw: string } }, formats?: { "A1": CellFormat } }` — computed values are
derived, not stored. `formats` is durable per-cell display metadata keyed by
canonical address, independent of `cells`: it survives content edits, applies
to empty cells, and never affects evaluation. `active_view` is the durable id
of the sheet view last applied via `setSheetView` (schema:6 documents only);
restore requires it to reference a view bound to the same sheet.
`NamedRange = { name, sheet:
sheet-id, refers_to }` is a durable workbook-level name bound to one sheet;
`refers_to` is a canonical `"A1"` or `"A1:B2"` on that sheet.
`ConditionalRule = { id, sheet: sheet-id, range, criteria, format }` is a
durable workbook-level conditional-format rule bound to one sheet; `range`
is a canonical `"A1"`/`"A1:B2"`, `criteria` a COUNTIF-style string (see
conditional-format rules below), and `format` a bounded style payload
`{ bold?, italic?, underline?, color?, fill? }` — `color`/`fill` are
`#RRGGBB`, at least one attribute required. `ValidationRule = { id, sheet:
sheet-id, range, criteria }` is a durable workbook-level data-validation
rule bound to one sheet; `range` is a canonical `"A1"` or `"A1:B2"` on that
sheet and `criteria` is a bounded kind-tagged object (see validation rules
below). `FilterRule = { id, sheet: sheet-id, range, column?, criteria }` is
a durable workbook-level row-filter rule bound to one sheet; `range` is a
canonical `"A1"`/`"A1:B2"`, `column` an optional column letter inside that
range, and `criteria` a COUNTIF-style string (see filter rules below).
`ChartSpec = { id, sheet: sheet-id, kind, title?, range, series?, colors? }`
is a durable workbook-level chart object bound to one sheet; `kind` is
`line|column|bar|area|pie`, `title` a 1–512-byte string, `range` the
canonical `"A1"`/`"A1:B2"` data anchor on the bound sheet, `series` ≤32
`{name?,range?}` overrides (name ≤128 bytes, range canonical on the same
sheet, at least one field each) and `colors` ≤16 deduped `#RRGGBB` entries.
`SparklineSpec = { id, sheet: sheet-id, target, data, kind }` is a durable
workbook-level sparkline spec; `target`/`data` are canonical
`"A1"`/`"A1:B2"` ranges on the bound sheet and `kind` is
`line|column|bar|winloss`. `SheetView = { id, sheet: sheet-id, name,
filters: [ViewFilter] }` is a durable workbook-level named view bound to
one sheet; `name` is 1–128 bytes, unique case-insensitively among that
sheet's views, and each `ViewFilter = { range, column?, criteria }` is a
captured filter spec — a canonical `"A1"`/`"A1:B2"` range, optional column
letter inside it and a COUNTIF-style criteria string (the `FilterRule`
fields minus the rule id), at most 64 per view and 256 views per workbook.
Views capture the sheet's filter rules — the only durable view state the
engine owns; scroll, zoom, frozen panes/splits and column widths are host
view state and sorts are destructive mutations, so none are captured. `Comment =
{ id, sheet: sheet-id, anchor, author?, body, resolved }` is a durable
workbook-level comment bound to one sheet; `anchor` is a canonical
`"A1"`/`"A1:B2"` coordinate string (single cell or bounded rectangle under
the shared 16,384-cell cap), `body` required non-blank ≤8192 UTF-8 bytes,
`author` optional ≤128 bytes without control characters, `resolved` a
durable flag, at most 1024 comments per workbook. Chart/sparkline specs and
views are storage-only and comments are coordinate-bound metadata — the
engine never evaluates chart/sparkline data, renders, or remaps comment
anchors; hosts read cells and draw (see chart/sparkline/view/comment rules
below). Validation rules on one sheet may not
overlap; conditional and filter rules may. `CellFormat = { number_format?,
bold?, italic?, fill?, border? }` — all attributes optional; `number_format` is
a bounded opaque string (≤64 ASCII graphic/space chars, no `" \ { }`) holding
a preset id or custom pattern the host interprets; `fill`/`border.color` are
`#RRGGBB`; `border = { style: thin|medium|thick|dashed|dotted, color, sides:
[top,right,bottom,left] subset (1–4, deduped, canonical order) }`. Cell
addresses: `$?[A-Z]+$?[0-9]+` (case-insensitive), abs
markers accepted and normalized to plain `A1`. Every op that takes an address
or range (`setCell`, `clearCell`, `getCell`, `getRange`, `setRange`, `fillRange`,
`fillSeries`, `setFormat`, `clearFormat`) returns
`out_of_bounds` for an address past `XFD1048576` (16,384 columns × 1,048,576
rows) and changes nothing. A formula reference past the sheet evaluates to
`#REF!`. `restore` rejects a snapshot whose cell or format keys fall outside
the sheet, and whose stored formats violate the attribute invariants above
(canonicalizing border side order and dropping empty format objects).

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
| `fillSeries` | `{source:{from,to},target:{from,to},step?}` | `{changed}` | linear series; see series-fill rules below |
| `setFormat` | `{range:{from,to} \| cells:[addr…], format:{…patch}}` | `{changed}` | per-cell format patch; exactly one of `range`/`cells`; see format rules below |
| `clearFormat` | `{range:{from,to} \| cells:[addr…]}` | `{changed}` | removes stored formats; contents untouched |
| `defineName` | `{name,refers_to,sheet?}` | `{name}` | workbook-scoped name bound to `sheet` (name or index, default active); see name rules below |
| `updateName` | `{name,sheet?,refers_to?}` | `{name}` | retarget sheet and/or refers_to; at least one field required (explicit `null` fields count as absent); same-value is eventless |
| `removeName` | `{name}` | `{ok}` | name lookup is case-insensitive; missing → `not_found` |
| `listNames` | `{}` | `{names:[{name,sheet,sheet_id,refers_to}]}` | read-only; `sheet` is the current sheet name |
| `functionCatalog` | `{}` | `{functions:[{name,min_args,max_args,signature}]}` | read-only; `max_args:null` = variadic |
| `setValidation` | `{sheet?,range:{from,to},rule:{kind,…}}` | `{rule}` | create/replace the rule for an exact sheet+range; see validation rules below |
| `clearValidation` | `{id}` xor `{sheet?,range:{from,to}}` | `{cleared}` | by rule id, or every rule on the sheet intersecting the range; eventless when nothing matches |
| `validateCell` | `{sheet?,addr}` (`cell` alias accepted) | `{valid[,rule,expected,actual]}` | read-only; silent, no journal/events |
| `setConditionalFormat` | `{sheet?,range:{from,to},rule:{criteria,format}}` | `{rule}` | append a conditional-format rule; see conditional-format rules below |
| `clearConditionalFormat` | `{id}` xor `{sheet?,range:{from,to}}` | `{cleared}` | remove one rule by id, or every rule on the sheet intersecting the range |
| `getConditionalFormats` | `{sheet?}` | `{rules:[{id,sheet,sheet_id,range,criteria,format}]}` | read-only; `sheet` absent lists all rules |
| `evaluateConditionalFormats` | `{sheet?,range:{from,to}}` | `{cells:[{addr,computed,matches:[rule…]}]}` | read-only match report against computed values; see conditional-format rules below |
| `sortRange` | `{sheet?,range:{from,to},keys:[{column\|offset,ascending?}],has_header?}` | `{changed,sorted_rows}` | stable row permutation by computed key values; see sort rules below |
| `setFilter` | `{sheet?,range:{from,to},column?,criteria}` | `{rule}` | append a row-filter rule; see filter rules below |
| `clearFilter` | `{id}` xor `{sheet?,range:{from,to}}` | `{cleared}` | remove one rule by id, or every rule on the sheet intersecting the range |
| `getFilters` | `{sheet?}` | `{rules:[{id,sheet,sheet_id,range,column?,criteria}]}` | read-only; `sheet` absent lists all rules |
| `evaluateFilters` | `{sheet?,range:{from,to},id?}` | `{rows:[{row,visible,matched,failed}\|{row,matched}]}` | read-only per-row visibility report; see filter rules below |
| `insertChart` | `{sheet?,chart:{kind,title?,range:{from,to},series?,colors?}}` | `{chart}` | append a chart object; see chart rules below |
| `updateChart` | `{id,patch:{kind?,title?,range?,series?,colors?}}` | `{chart}` | partial patch; `null` clears title/series/colors; equal patch eventless |
| `removeChart` | `{id}` | `{ok}` | `sheet` alongside `id` rejects |
| `listCharts` | `{sheet?}` | `{charts:[{id,sheet,sheet_id,kind,title?,range,series?,colors?}]}` | read-only; `sheet` absent lists all |
| `setSparkline` | `{sheet?,cell\|range,data:{from,to},kind}` | `{sparkline}` | attach/replace a sparkline spec; see sparkline rules below |
| `clearSparkline` | `{id}` xor `{sheet?,cell\|range}` | `{cleared}` | `sheet`/`cell`/`range` alongside `id` reject |
| `listSparklines` | `{sheet?}` | `{sparklines:[{id,sheet,sheet_id,target,data,kind}]}` | read-only; `sheet` absent lists all |
| `saveSheetView` | `{sheet?,name}` | `{view}` | capture the sheet's current filter specs into a named view; same sheet+name updates in place keeping `id`; see view rules below |
| `setSheetView` | `{view:id\|null,sheet?}` | `{view}` | apply a view's captured specs to its bound sheet (fresh rule ids, records `active_view`); `null` clears the resolved sheet's selection only; `sheet` alongside an id rejects |
| `removeSheetView` | `{id}` | `{ok}` | removes the view and clears `active_view` references to it |
| `listSheetViews` | `{sheet?}` | `{views:[{id,sheet,sheet_id,name,filters:[{range,column?,criteria}],active}]}` | read-only; `sheet` absent lists all |
| `addComment` | `{sheet?,cell\|range,author?,body,resolved?}` | `{comment}` | attach a comment to a cell/range anchor; see comment rules below |
| `updateComment` | `{id,author?,body?}` | `{comment}` | partial patch; `author:null` clears; equal/no-field patch eventless |
| `removeComment` | `{id}` | `{ok}` | `not_found` on unknown id |
| `resolveComment` | `{id}` | `{comment}` | set `resolved:true`; already resolved eventless |
| `reopenComment` | `{id}` | `{comment}` | set `resolved:false`; already open eventless |
| `listComments` | `{sheet?,cell\|range?}` | `{comments:[{id,sheet,sheet_id,anchor,author?,body,resolved}]}` | read-only; `sheet` filters by bound sheet, `cell`/`range` narrow to containing/intersecting anchors on the resolved sheet |
| `clearCell` | `{addr}` | `{ok}` | |
| `getCell` | `{addr}` | `{raw,computed,format?}` | `computed` = evaluated value; `format` present only when stored |
| `getRange` | `{from,to}` | `{cells:[[{addr,raw,computed,format?}]]}` | |
| `evaluate` | `{formula}` | `{value}` | ad-hoc formula against active sheet, no write |
| `workbook` | `{}` | `{sheets:[{name,cell_count,tone,is_protected}],active}` | read-only |

Formula language (recursive-descent parser, case-insensitive fns):
numbers, `"strings"`, cell refs, ranges `A1:B2`, unary `-`, binary
`+ - * / ^`, `%` postfix, parens, `&` concat, comparisons `= <> < <= > >=`,
functions `SUM AVERAGE MIN MAX COUNT COUNTA COUNTIF SUMIF IF(cond,a,b) ROUND(x,n) ABS CONCAT`,
defined names (see name rules). Error values: `#DIV/0! #VALUE! #REF! #NAME? #NUM! #CYCLE!` — cycles detected via
evaluation-time visited set. Evaluation memoizes per-request.

Undo: per-cell previous `{addr, prev_raw}` (or removal); range edits group changed cells into one entry. No-op range edits emit no event and preserve redo. Fill reads all source cells before writing. Formula strings, names, whitespace and scientific notation remain unchanged; a reference shifted past row 1,048,576 or column XFD becomes `#REF!`, and a range with either endpoint off the sheet becomes a single `#REF!`. Lexically invalid source formulas reject the entire fill without mutation. Series inference lives in `fillSeries` (numeric literals only; no date serials — `formula.rs` has no date helpers); cross-sheet references are not supported.

`fillSeries` rules: `source` must be a single row or a single column of numeric literals (raws that parse as a finite `f64`; formulas, text, booleans and empty cells reject the op). A 1x1 source picks its axis from the target's one-dimensional extension and requires an explicit `step`. `step` is an optional finite JSON number; without it the step is `(last - first) / (count - 1)` along the axis, so inference needs at least two source cells. The first source cell anchors the series: `value(i) = first + step * (i - i_first)` with `i` the column index for a row source or the row index for a column source. The target must contain the source and may not widen perpendicular to the axis; it may extend in either direction along the axis. Target cells inside the source are skipped; every other target cell receives a numeric literal (never a formula), and a non-finite result rejects the whole op. Same bounds and 16,384-cell caps as `fillRange`; one undo entry, eventless when nothing changes.

Format rules: `setFormat`/`clearFormat` target the **active sheet** and take
exactly one of `range` (`{from,to}`, normalized/reversed bounds OK, shared
16,384-cell and on-sheet caps) or `cells` (array of addresses, deduped,
same cap). `setFormat`'s `format` object is a patch: each known key
(`number_format`, `bold`, `italic`, `fill`, `border`) sets its attribute, an
explicit `null` clears that attribute, absent keys are untouched, and unknown
keys or wrongly-typed values reject the whole op. Merging that leaves no
attributes removes the cell's format entry. `clearFormat` deletes stored
formats only. Cells whose stored format does not actually change are skipped,
so a no-op patch is eventless, journal-free and preserves redo. Each mutating
call records one undo entry covering every changed cell; undo/redo restore
prior formats exactly. Formats are orthogonal to contents — `setCell`,
`clearCell`, `setRange`, `fillRange` and `fillSeries` never read or write
them, and an address may hold a format with no content. `getCell`/`getRange`
expose `format` only when one is stored; `describe` returns the whole
`formats` map. Rendering `number_format` into display text (dates, currency,
percent, locale digits) is a host/display-layer concern — evaluation always
uses raw values, so formats cannot affect formulas, aggregates or errors.

Name rules: names are **workbook-scoped** entries, each bound to exactly one
sheet by durable sheet id — the Excel "workbook name with optional sheet
scope" collapsed to the only scope this engine resolves, since formulas have
no cross-sheet references. `refers_to` accepts `"A1"` or `"A1:B2"` (endpoints
in either order, `$` markers allowed); it is stored canonicalized, single-cell
targets keep the bare `"A1"` form, and whole-row/column refs or formula
targets are not supported. `name` must match `[A-Za-z_][A-Za-z0-9_]*` — the
formula tokenizer's word characters, since `.`/`$` could never round-trip
through `=name` — ≤64 bytes, be unique case-insensitively across the
workbook, and must not be cell-ref shaped in the tokenizer's
`$?[A-Za-z]+$?[0-9]+` sense regardless of grid bounds (`A1`, `A0`,
`ZZZZZZZZ1` all lex as references — a documented strict subset of Excel,
which only rejects refs inside the grid), R1C1 shaped (`R1`, `C1`, `R1C1`),
a `functionCatalog` name (`SUM`, `IF`, … case-insensitive — a bare `=NAME`
would resolve the name while `=NAME(...)` calls the function), the single
letters `R`/`C`, or the literals `TRUE`/`FALSE`; at most 256 names per
workbook. **Formula integration:** a
bare identifier in a formula or `evaluate` resolves to the name's target
when the formula's sheet is the name's bound sheet — a single-cell target
behaves like a cell ref, a multi-cell target like a range (aggregates and
`&`/scalar contexts follow the usual range rules), lookup is
case-insensitive, and `COUNTIF`/`SUMIF` accept a name in place of their
range argument. A name bound to a different sheet evaluates to `#NAME?`
(same limitation as cross-sheet cell refs); resolution is live, so
`updateName`/`removeName` change or break dependent formulas immediately.
`removeSheet` cascade-drops names bound to the removed sheet (recorded in the
same undo entry, so undo/redo restore them — re-admission re-checks the
name-table invariants, so a name redefined while its sheet was gone or a
table at the 256-name cap wins and the dropped entry is discarded rather
than corrupting the document); `duplicateSheet`/`moveSheet` do
not copy or retarget names. Mutating name ops record one undo entry each (whole-document inverse, like
sheet structural ops); `updateName` with unchanged values is eventless and
journal-free. `listNames`/`functionCatalog` are read-only, eventless. The
`functionCatalog` op returns the bounded evaluator set — `SUM AVERAGE MIN
MAX COUNT COUNTA COUNTIF SUMIF IF ROUND ABS CONCAT TRUE FALSE` — with
`min_args`/`max_args` (`null` = variadic) and a signature string; it is the
same list documented in the formula-language paragraph.

Conditional-format rules: rules are **workbook-scoped** entries bound to one
sheet by durable sheet id (same model as names/validation), at most 256 per
workbook. `setConditionalFormat` takes `range:{from,to}` (shared 16,384-cell
and on-sheet caps, canonicalized to `"A1"`/`"A1:B2"`), optional `sheet` (name
or index, default active), and `rule:{criteria,format}`. `criteria` is a
COUNTIF-style string evaluated by the same matcher as `COUNTIF`/`SUMIF`:
numbers and `=`/`<>`/`<`/`<=`/`>`/`>=`-prefixed numerics compare computed
numbers only, text supports `*`/`?`/`~` wildcards ASCII-case-insensitively,
relational non-numeric text and criteria over 255 chars reject, and `""`
matches only empty cells. `format` accepts `bold`/`italic`/`underline`
booleans (explicit `false` normalizes to absent) and `color`/`fill`
`#RRGGBB`; at least one attribute is required and unknown keys reject.
Unlike validation, rules **may overlap** on one sheet: an identical
sheet+range+criteria+format resubmission is an eventless no-op returning the
existing rule, anything else appends a new rule with a fresh workbook-unique
id. `clearConditionalFormat` takes exactly one of `id` (one rule) or
`range:{from,to}` plus optional `sheet`, removing every rule on that sheet
intersecting the rectangle (`{cleared}` counts removals; no hits is
eventless); `sheet` alongside `id` rejects rather than being ignored, and
`sheet:null` counts as absent. `removeSheet` cascade-drops the sheet's rules
into the same undo entry and undo re-admits each only while it still
satisfies the restore invariants (existing sheet, canonical in-bounds range,
parseable criteria, valid format, unique id, under the cap); `duplicateSheet`
does not copy rules. Mutations record one whole-document undo entry each;
`getConditionalFormats`/`evaluateConditionalFormats` are silent reads.
`evaluateConditionalFormats` evaluates each cell in `range` once through
the normal evaluator (so matches track formulas, edits, undo and reopen)
and reports `{addr, computed, matches}` per cell — `matches` lists every
covering rule whose criteria the computed value satisfies, in rule order.
Every candidate rule-cell match is charged one unit of the shared
1,000,000-step conditional allowance (see the aggregate-subset paragraph)
*before* criteria-type dispatch, so numeric comparisons and empty-cell
non-matches cannot bypass it: a rule×cell product over the allowance
fails the whole op with `#NUM!` (validation error) rather than emitting a
giant or partial match report — there is no truncation flag. This is a
**match report, not rendering**: the engine does not apply, merge
or prioritize styles, and error-valued cells (`#DIV/0!` etc.) report their
error literal and never match. Deferred loudly: the NYC-Tron rule `kind`
variants (`formula`, `color-scale`, `icon-set`, `data-bar`), `styleId`
host-style references, `enabled`/`stopIfTrue` ordering semantics, whole-
row/column ranges, and any pixel output — all host-side concerns; stored
rules deny unknown fields so crafted payloads cannot smuggle them past
restore. On restore each rule's `format` is normalized with the same
`false`-boolean collapse the op path applies, so `{"bold":false}` alone
fails validation (empty format) and `{"bold":false,"fill":"#RRGGBB"}`
stores canonically as `{"fill":"#RRGGBB"}` — identical-resubmission
equality and snapshot round-trips stay stable.

Validation rules: rules are **workbook-scoped** entries bound to one sheet by
durable sheet id, like names — `ValidationRule = { id, sheet: sheet-id,
range, criteria }` with `range` a canonical `"A1"`/`"A1:B2"` (endpoints in
either order, `$` allowed, re-canonicalized on restore) capped at the shared
16,384-cell bound, and `id` a workbook-unique handle from `next_validation`.
At most 256 rules per workbook. `criteria` is a flat kind-tagged object —
`{"kind":"number",min?,max?,integer?}` (computed value must be a finite number
within the optional inclusive bounds; `integer:true` requires an integral
value; no bounds means "must be a number"), `{"kind":"list",values:[…]}`
(computed value's text form must exactly equal one entry, case-sensitive;
1–512 nonempty entries of ≤8192 chars, matching the NYC-Tron
`ValidationDropdown` contract), or `{"kind":"text",min_length?,max_length?}`
(computed value's text form must have a Unicode-scalar length within the
optional inclusive bounds, each 1–65536, at least one required). Fields
belonging to other kinds reject. The text form is the string itself, finite
numbers via `fmt_num`, `TRUE`/`FALSE` for booleans, and the literal for
errors; empty cells, non-finite numbers and range results have none. Deferred
kinds — date bounds (the evaluator has no date serials), custom-formula
criteria, whole-row/column ranges, and the dropdown's `allowOther`/
`allowBlank` commit policy — are host concerns and reject as unknown kinds
or stray fields. `setValidation` targets `sheet` (name or index, default
active) plus `range:{from,to}`; rules on one sheet may not overlap — a
partial overlap rejects atomically, while the exact same sheet+range replaces
`criteria` in place keeping `id` (the edit path; identical resubmission is
eventless and journal-free). `clearValidation` takes exactly one of `id`
(removes that rule, `not_found` when absent) or `range`+optional `sheet`
(removes every rule on that sheet intersecting the rectangle; `{cleared:0}`
is eventless); `sheet` alongside `id` rejects rather than being ignored.
`validateCell` is a silent read: `{valid:true}` alone when no
rule covers the cell, otherwise `{valid,rule,expected,actual}` where `rule`
resolves the bound sheet's current name and `actual` is the computed value;
a blank cell (no stored raw — a formula computing to Empty is *not* blank
and must satisfy the criteria) reports valid under any rule — hosts enforce
"value required" at commit time, and error values satisfy `list` only via a
literal error-text entry and never satisfy `number`/`text`. Note the
`sheet` key differs by payload: op results (`setValidation`'s `rule`,
`validateCell`'s `rule`) report `sheet` as the bound sheet's current *name*
plus `sheet_id` (the durable id), while `describe` returns the raw stored
`Workbook` where each `validations[].sheet` is the durable sheet id, not a
name. Mutations record
one whole-document undo entry each like name ops; `removeSheet`
cascade-drops the sheet's rules into the same undo entry and undo/redo
re-admit them only while they still satisfy the restore invariants (existing
sheet, canonical in-bounds range, valid criteria, unique id, no overlap);
`duplicateSheet`/`moveSheet` do not copy or retarget rules.

Sort rules: `sortRange` permutes **whole rows** inside `range:{from,to}`
on `sheet` (name or index, default active) — rows are reordered, never
deleted or duplicated, and every column of the range moves together. The
permutation commits to the **resolved target sheet** (`commit_cells_on_sheet`):
prior-value lookup, the undo entry's sheet id and the mutation all follow
`sheet`, so sorting a non-active sheet never reads from or writes to the
active one, and protection guards that same sheet. `keys` is a nonempty
array of at most 16 entries, each with exactly one of `column` (a column
letter inside the range) or `offset` (0-based column offset from the
range's left edge) plus optional `ascending` (default `true`); earlier
keys dominate and the sort is stable, so rows equal on every key keep
their original order. Keys resolving to the same column are deduplicated
(first occurrence wins — a later key on an already-decided column is
inert) before evaluation.
`has_header:true` keeps the range's first row in place and sorts only the
rows below it. Keys compare **computed** cell values — formulas included —
under a documented total order: class rank empty < finite number < text <
boolean < error is fixed in both directions, and within a class numbers
compare numerically, text compares by Unicode `to_lowercase()` then byte
order (the same collation the formula `=`/`<` comparisons use — not
locale-aware), booleans `false < true`. Error values (`#DIV/0!`,
`#CYCLE!`, non-finite numbers, non-scalars) always sort **last in both
directions**; `ascending:false` inverts only the within-class comparison.
**Formulas move verbatim**: raw cell text — including `=A1` references — is
copied to the new row with no `shift_references` rewriting, so a moved
`=A1` still points at address `A1`, which may now hold a different row's
content. This deliberately differs from Excel's reference adjustment;
hosts needing that must not rely on `sortRange`. `formats` are
address-keyed display metadata and do not move with contents; cells
outside the range (including other columns of the same sheet rows) are
untouched. The op is atomic — everything validates and stages before
`commit_cells_on_sheet` writes — and records one undo entry, so undo/redo
restore the exact prior row order; an already-sorted range is eventless
and journal-free. Each key-cell evaluation charges one unit and each
key-level comparison charges one unit **as the comparison runs** (the
sort comparator spends through `Evaluator::charge_work`, one unit per key
examined; text keys are lowercased once at evaluation, not per
comparison) against the evaluator's shared 1,000,000-step conditional
allowance; exhaustion rejects before any mutation. Because effective keys
never exceed the range width and `rows × width ≤ 16,384` cells, the worst
case (~`n·⌈log₂n⌉` comparisons × width key examinations, ≈229k units for
a single-column 16,384-row range) stays far under the allowance; the
charge-during-sort remains the fail-closed defense.

Filter rules: rules are **workbook-scoped** entries bound to one sheet by
durable sheet id (same model as names/validation/conditional), at most 256
per workbook, and may overlap — a row is visible only when every covering
rule passes. `setFilter` takes `range:{from,to}` (shared 16,384-cell and
on-sheet caps, canonicalized to `"A1"`/`"A1:B2"`), optional `sheet` (name
or index, default active), optional `column` (a column letter that must lie
inside `range`), and `criteria` — a COUNTIF-style string evaluated by the
same `CriteriaMatcher` conditional formats use, so the same bounds apply
(≤255 chars, wildcards `*`/`?`/`~`, numbers compare numbers only,
relational non-numeric text rejects, error values never match). With
`column` set the rule tests that one cell per row; without it the rule
tests **every** column of its range at that row and the row passes only
when all of them satisfy the criteria (AND across columns — the honest
whole-row subset; NYC-Tron's per-column `SheetFilter` operator/operand UI
maps onto criteria strings host-side). A rule "covers" a row when the row
lies in its range's row span. An identical sheet+range+column+criteria
resubmission is an eventless no-op returning the existing rule; anything
else appends a new rule with a fresh workbook-unique id (there is no
update op — clear and re-set). `clearFilter` takes exactly one of `id` or
`range`+optional `sheet`, removing every rule on that sheet intersecting
the rectangle (`{cleared}` counts removals; no hits is eventless); `sheet`
alongside `id` rejects rather than being ignored, and `sheet:null` counts
as absent. **Hide-vs-delete: filters hide, never delete.** The engine
stores rules only; row visibility is a pure function of the rules and the
computed cell values, so it cannot go stale after edits, undo or reopen —
there is no separate stored hidden flag. Hidden rows stay fully
readable and writable: `getRange`, `setCell` and every other op treat
them normally, and hiding is presentation metadata the host applies at
render time. `getFilters {sheet?}` lists rules (absent `sheet` lists the
workbook); `evaluateFilters {sheet?,range:{from,to},id?}` is a silent
read reporting per 1-based sheet row inside `range`: without `id`, each
row reports `visible` plus the `matched`/`failed` covering-rule ids; with
`id` (a rule on the resolved sheet, `not_found` otherwise), each row
reports `matched` — rows outside the rule's row span report `matched:true`
because the rule imposes no constraint. Evaluation runs against computed
values through the normal evaluator, so results track edits, undo and
reopen; every cell-test charges the shared conditional allowance via
`match_value`. The pre-check caps the **worst-case** cell-test product —
rows × covering rules × each rule's full column span — at 65,536, counted
before any evaluation so oversized reports reject without work.
Whole-row rules short-circuit on the first failing column at evaluation
time, so the cap can reject a report whose *actual* test count would fit;
that conservative bound is deliberate (no tighter bound exists without
evaluating). `removeSheet`
cascade-drops the sheet's rules into the same undo entry and undo
re-admits each only while it still satisfies the restore invariants
(existing sheet, canonical in-bounds range, parseable criteria, in-range
column, unique id, under the cap); `duplicateSheet`/`moveSheet` do not
copy or retarget rules. Mutations record one whole-document undo entry
each; all three read ops are silent. Deferred loudly: per-operator filter
UI state, sort-by-header-text, Excel-style reference adjustment on sort,
and any actual row hiding in `getRange` output — all host concerns.

Chart rules: charts are **workbook-scoped** objects bound to one sheet by
durable sheet id (same model as names/rules), at most 256 per workbook,
each with a workbook-unique id. `insertChart` takes `sheet?` (name or
index, default active) and `chart:{kind,title?,range:{from,to},
series?,colors?}` — `kind` is the bounded `line|column|bar|area|pie`
enum, `title` a nonempty ≤512-byte string, `range` the data anchor
canonicalized to `"A1"`/`"A1:B2"` under the shared 16,384-cell cap,
`series` ≤32 `{name?,range?}` overrides (name ≤128 bytes, range
canonical on the same sheet, at least one field per entry) and `colors`
≤16 deduped `#RRGGBB` entries. Duplicate specs are allowed — charts are
objects, not keyed rules. `updateChart {id,patch}` is a partial patch:
present keys set, explicit `null` clears `title`/`series`/`colors`,
`kind`/`range` cannot be null, unknown patch keys and a `sheet` field
alongside `id` reject (the `clear*` mixed-selector precedent); an update
that leaves the spec unchanged is eventless. `removeChart {id}` removes
one chart (`sheet` alongside `id` rejects); `listCharts {sheet?}` is a
silent read listing `{id,sheet,sheet_id,kind,title?,range,series?,colors?}`
with the bound sheet's current name resolved. **Rendering stays
host-side**: the engine stores and returns the bounded spec only — it
never evaluates series data, computes geometry or draws pixels; hosts
read cells via `getRange`/`getCell` and render. Mutations record one
whole-document undo entry each; `removeSheet` cascade-drops the sheet's
charts into the same undo entry and undo re-admits each only while it
still satisfies the restore invariants (existing sheet, unique id, under
the cap, canonical in-cap ranges, bounded fields); `duplicateSheet`/
`moveSheet` do not copy or retarget charts.

Sparkline rules: specs are **workbook-scoped** entries bound to one sheet
by durable sheet id, at most 256 per workbook, each with a
workbook-unique id — `SparklineSpec = {id,sheet,target,data,kind}` where
`target` is the canonical `"A1"`/`"A1:B2"` anchor the sparkline is drawn
in and `data` the canonical `"A1"`/`"A1:B2"` source range (both under the
shared 16,384-cell cap), `kind` the bounded `line|column|bar|winloss`
enum. `setSparkline {sheet?,cell|range,data:{from,to},kind}` attaches a
spec: `cell` is a single address, `range` a `{from,to}` rectangle —
exactly one is required. One spec covers one `target` per sheet:
identical sheet+target+data+kind is an eventless no-op, the same target
with a different spec replaces in place keeping the id. Whether a
multi-cell `target` means "same sparkline per cell" or a grouped display
is a host decision — the engine only guarantees the stored bounds.
`clearSparkline` takes exactly one of `id` or a `cell`/`range` target
selector (+ optional `sheet`, default active) removing every spec on
that sheet with that target (`{cleared}` counts removals; no hits is
eventless); `sheet`/`cell`/`range` alongside `id` and `cell` alongside
`range` reject rather than being ignored. `listSparklines {sheet?}` is a
silent read listing `{id,sheet,sheet_id,target,data,kind}` with the bound
sheet's current name resolved. **Rendering stays host-side**: the engine
stores and returns the bounded spec only — it never evaluates the data
range or draws pixels. Mutations record one whole-document undo entry
each; `removeSheet` cascade-drops the sheet's specs into the same undo
entry and undo re-admits each only while it still satisfies the restore
invariants; `duplicateSheet`/`moveSheet` do not copy or retarget specs.

View rules: views are **workbook-scoped** named entries bound to one sheet
by durable sheet id — `SheetView = {id,sheet,name,filters}` where `filters`
is a list of captured specs `{range,column?,criteria}` (the `FilterRule`
fields minus the rule id), at most 256 views per workbook, 64 specs per
view and 128-byte names unique case-insensitively **per sheet**. Views
capture the sheet's *current* filter rules — the only durable view state
the engine owns; scroll, zoom, frozen panes/splits and column widths are
host view state and `sortRange` is a destructive mutation, so none are
captured (the honest subset; the engine does not own them). `saveSheetView
{sheet?,name}` captures the resolved sheet's (default active) filter
specs: re-saving the same case-insensitive name on the same sheet updates
the captured specs in place keeping the view `id` (the `setValidation`
replace precedent), an identical capture is eventless, and a sheet
carrying more than 64 filter rules rejects rather than truncating.
`setSheetView {view,sheet?}` applies a view by id: the bound sheet's
filter rules are replaced by the view's specs under fresh rule ids
(projected against the shared filter cap) and the selection is recorded
durably as the sheet's `active_view`; re-applying the already-active
view with identical specs is eventless, and `view:null` (+ optional
`sheet`, default active) clears only the selection without touching
filters — `sheet` alongside a view id rejects like the `clear*`
mixed-selector precedent. `removeSheetView {id}` removes the view and
clears `active_view` references to it; `listSheetViews {sheet?}` is a
silent read returning `{id,sheet,sheet_id,name,filters,active}` with the
bound sheet's current name resolved and `active` marking the sheet's
recorded selection. Mutations record one whole-document undo entry each;
`removeSheet` cascade-drops the sheet's views into the same undo entry
and undo re-admits each only while it still satisfies the restore
invariants (sweeping any `active_view` left dangling); `duplicateSheet`
does not copy views and clears `active_view` on the copy;
`moveSheet`/`renameSheet` do not retarget them. Bound-sheet protection
guards apply like the other rule tables.

Comment rules: comments are **workbook-scoped** entries bound to one sheet
by durable sheet id — `Comment = {id,sheet,anchor,author?,body,resolved}`
with a workbook-unique numeric id, at most 1024 per workbook.
`anchor` is a canonical `"A1"`/`"A1:B2"` coordinate string: `addComment
{sheet?,cell|range,author?,body,resolved?}` takes exactly one of `cell`
(a single address) or `range` (a `{from,to}` rectangle), canonicalized
like the sparkline target and capped at the shared 16,384-cell bound.
**Anchors are static coordinates**: they name grid positions, not content
— `setCell`/`clearCell`/`setRange`/`fillRange`/`fillSeries`/formats and
`sortRange` never move them (`sortRange` permutes cell contents while a
comment stays on its coordinates), and row/column insert/delete ops are
deferred entirely so there is nothing to remap against. `body` is required
non-blank ≤8192 UTF-8 bytes, `author` optional ≤128 bytes without control
characters, `resolved` an optional bool defaulting false (accepted at add
time for parity with `resolveComment`). `updateComment {id,author?,body?}`
patches author (`null` clears) and/or body — absent fields keep values, no
fields or an equal patch is eventless, and anchors are not re-pointable.
`removeComment {id}` deletes; `resolveComment`/`reopenComment {id}` flip
the durable flag with already-in-state calls eventless. `listComments
{sheet?,cell?,range?}` is a silent read returning `{id,sheet,sheet_id,
anchor,author?,body,resolved}` with the bound sheet's current name
resolved; `sheet` (name or index) filters by bound sheet — absent lists
every sheet when no anchor filter is given — and `cell`/`range` (exactly
one, mutually exclusive) narrow to comments whose anchor contains the cell
or intersects the range, evaluated on the resolved sheet (default active)
since addresses are sheet-relative. Single-entry, not threaded: NYC-Tron's
`CommentThread` carries `replies`, but the engine stores one body per
anchor — threading is a deferred host-side grouping, matching the quill
comments precedent; no timestamps or mentions (the engine is I/O-free).
Mutations record one whole-document undo entry each; `removeSheet`
cascade-drops the sheet's comments into the same undo entry and undo
re-admits each only while it still satisfies the restore invariants;
`duplicateSheet` does not copy comments and `moveSheet`/`renameSheet` do
not retarget them. Bound-sheet protection guards apply like the other
rule tables.

Protected sheets reject cell/clear/range/fill/format edits and targeted rename/remove/duplicate/move/color commands before mutation (including same-value edits). `new` rejects while any sheet is protected. Reads, activation, adding/editing other sheets and explicit unprotect remain allowed; unrelated structural edits can shift tab indices without changing protected sheet identity. Name mutations are guarded by the sheet each name is bound to: `defineName` rejects when its target sheet (payload `sheet`, default active) is protected, `updateName`/`removeName` reject when the name's current sheet — or, for `updateName`, an explicitly requested new target — is protected; `listNames`/`functionCatalog` stay allowed. Validation and conditional-format mutations follow the same bound-sheet rule: `setValidation`/`setConditionalFormat` reject when their target sheet (payload `sheet`, default active) is protected, `clearValidation`/`clearConditionalFormat` reject when the rule's sheet (by `id`) or the target sheet (by `range`) is protected; `validateCell`, `getConditionalFormats`, `evaluateConditionalFormats`, `getFilters` and `evaluateFilters` stay allowed. `sortRange` rejects when its target sheet (payload `sheet`, default active) is protected; `setFilter` rejects on its target sheet and `clearFilter` rejects on the rule's sheet (by `id`) or the target sheet (by `range`), same bound-sheet rule as the other rule tables. `insertChart`/`setSparkline` reject on their target sheet (payload `sheet`, default active), `updateChart`/`removeChart` reject on the chart's bound sheet and `clearSparkline` rejects on the spec's sheet (by `id`) or the target sheet (by `cell`/`range`); `listCharts`/`listSparklines` stay allowed. `saveSheetView` rejects on its target sheet (payload `sheet`, default active), `setSheetView` rejects on the view's bound sheet (or the resolved sheet for `view:null`) and `removeSheetView` rejects on the stored view's sheet; `listSheetViews` stays allowed. `addComment` rejects on its target sheet (payload `sheet`, default active) and `updateComment`/`removeComment`/`resolveComment`/`reopenComment` reject on the stored comment's sheet; `listComments` stays allowed. Undo/redo and restore are explicit document/history actions and remain allowed. Batch commands enforce this policy per staged command and roll back the whole batch on failure. This is an editing guard, not encryption or authentication. Missing legacy protection defaults to false; invalid serialized boolean values reject restore atomically.

Sheet creation/duplication reject exhausted ids before mutation; restore rejects ids for which the next id cannot be represented. Tab tones default to none when restoring older snapshots; unknown tones reject restore atomically. Sheet moves and color edits validate before mutation and support undo/redo via the workbook journal. Same-value requests return `{ok:true}` with no events and no undo entry, preserving redo history.

Conditional aggregate subset: `COUNTIF(range,criteria)` and `SUMIF(range,criteria[,sum_range])` require direct same-sheet cell/rectangular references (≤16384 cells). SUMIF ranges must have identical dimensions; mismatches return #VALUE! rather than adopting Excel's resized range behavior. Numeric criteria (numbers or strings with optional =/<>/</<=/>/>= prefix) compare evaluated numbers only, without text/Boolean coercion. Text =/<> criteria support * (sequence), ? (one original Unicode scalar), and ~ escaping * ? ~; other tildes are literal. Matching is ASCII-case-insensitive, non-ASCII exact, with no locale/casefold/normalization claim. Non-numeric relational text criteria return #VALUE!. Boolean criteria match evaluated Booleans only. Empty or empty-text criteria match empty cells and empty evaluated strings; * alone matches text, not empty cells. Comparisons do not cross value types.

Criteria expressions/cell references are evaluated normally; criteria range errors/cycles propagate. SUMIF evaluates sum cells only for matches, ignores matched nonnumeric values and propagates matched errors; nonfinite accumulated sums return #NUM!. Existing per-request memoization/depth/cycle rules remain intact. Each conditional rectangle is capped at16384 cells, criteria at255 Unicode scalars and matched text at4096 UTF-8 bytes (#VALUE! for string limits). A shared per-Evaluator allowance of1000000 conditional scan/string/DP steps returns #NUM! on exhaustion; matcher allocation work is charged before bounded DP buffers, and `Evaluator::match_value` (used by `evaluateConditionalFormats`) charges one flat unit per candidate rule-cell evaluation up front so every comparison path — numeric, boolean, empty-criteria, wildcard and type-mismatch — counts against the same allowance. These are explicit Tally semantics, not full Excel compatibility.

Snapshots: the NFD1 envelope is unchanged; the JSON payload is normally the bare
`Workbook` (`{next_sheet,sheets,active,names?,validations?,next_validation?,conditional_formats?,next_conditional,filters?,next_filter,charts?,next_chart?,sparklines?,next_sparkline?,views?,next_view?,comments?,next_comment?}`). When any sheet carries durable
post-release fields (`tone` set, `is_protected` true, `active_view` set, or a
nonempty `formats`
map) **or the workbook has any names, validation rules, conditional rules,
filter rules, charts, sparkline specs, views or comments**,
the payload is instead `{kind:"tally",schema:N,document:<Workbook>}` so
pre-wrapper readers fail closed rather than silently dropping those fields
(same precedent as pitch schema:2 and quill schema:2). `N` is `1` for
tone/protection/formats/names-only documents, `2` when `validations` is
nonempty and no later table is, `3` when `conditional_formats` is nonempty
and `filters` is empty — a schema:3 document may carry both earlier rule
tables — `4` when `filters` is nonempty, `5` when `charts` or
`sparklines` is nonempty, and `6` when `views` is nonempty or any sheet
carries `active_view`, `7` when `comments` is nonempty — each of which may
carry every earlier table.
`Workbook` does not deny unknown fields, so each newer table bumps
the schema: schema:1 readers would silently drop `validations`,
`conditional_formats`, `filters`, `charts`, `sparklines`, `views` or
`comments`, and the
higher
schemas make them reject the snapshot instead — the views bump to
schema:6 and the comments bump to schema:7 follow the same reasoning as
filters' bump to schema:4 (the new
tables and the `Sheet.active_view` field are not `deny_unknown_fields`-covered,
so an unbumped payload would be silently dropped by same-schema
readers). `formats`/`names`/`validations`/`conditional_formats`/`filters`/`charts`/`sparklines`/`views`/`comments`
entries ride
inside `document`; `restore` accepts schemas 1, 2, 3, 4, 5, 6 and 7, strictly validates
wrapper kind/schema/keys (`deny_unknown_fields`), then runs the existing
document validation — including name uniqueness, name legality, on-sheet
`refers_to`, existing sheet ids, validation-rule count/id uniqueness, bound
sheet existence, canonical in-sheet ranges within the cell cap, criteria
invariants, no overlapping validation rules per sheet, and conditional-rule
id uniqueness, sheet binding, criteria parseability, range
canonicalization/caps and format shapes (with the op-path `false`-boolean
normalization applied first), filter-rule count/id uniqueness, bound sheet
existence, canonical in-sheet ranges within the cell cap, criteria
parseability, in-range columns, and `next_filter` id-space repair,
chart/sparkline count and id uniqueness, bound sheet existence,
re-canonicalized in-cap ranges (including series ranges and palette
dedupe), bounded titles/series/colors and `next_chart`/`next_sparkline`
id-space repair, view count/id uniqueness, bound sheet existence,
legal names unique case-insensitively per sheet, bounded captured specs
with re-canonicalized in-cap ranges, parseable criteria, in-range columns,
`next_view` id-space repair and `active_view` selections referencing a view
bound to the same sheet, comment count/id uniqueness, bound sheet
existence, anchors re-canonicalized and capped like every other
refers_to table, bounded author/body fields, strict comment shape
(`deny_unknown_fields`) and `next_comment` id-space repair — all
re-canonicalized — before
replacing state and resetting the journal; bad input leaves state untouched.
Each table also restores only under the schema that introduced it:
nonempty `comments` require schema:7, nonempty `views` or any `active_view` require schema:6, nonempty `charts`/`sparklines` require schema:5, nonempty `filters`
requires schema:4, nonempty `conditional_formats`
requires schema:3 and nonempty
`validations` requires schema:2, so crafted lower-schema or bare-workbook
payloads carrying any table fail closed rather than silently dropping
version markers. Every rule/spec table is serde-optional, so a schema:2
payload (validations only) restores with empty `conditional_formats`/
`filters`/`charts`/`sparklines`/`views`/`comments`, a schema:3 payload restores with empty
`filters`/`charts`/`sparklines`/`views`/`comments`, a schema:4 payload restores with empty
`charts`/`sparklines`/`views`/`comments`, a schema:5 payload restores with empty
`views`/`comments`, a schema:6 payload restores with empty `comments`, and vice versa.
Workbooks without tone/protection/formats/names/validations/conditional
rules/filters/charts/sparklines/views/comments keep the legacy payload, so older snapshots
and older readers round-trip unchanged.

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
As a task (`apply_long`), each op runs through `apply_long` on a scoped
progress window, so cancellation lands between ops or inside a long one; a
cancelled op rejects the whole batch with `Cancelled` and no state change.

Undo: whole-document snapshot per op (capacity 64). Event `timeline:changed`
on structural ops; marker and loop ops emit `document:changed` only.

## folio-engine — `FolioEngine::new()`

Wraps `lopdf::Document` (add `lopdf` dep). `new()` = empty doc with zero pages
until `new`/`open`.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{pages?}` | `{ok}` | builds valid PDF with N blank letter pages via lopdf objects |
| `open` | `{bytes_b64}` | `{pages, encrypted}` | `lopdf::Document::load_mem`; corrupted → Serialization; `encrypted` is the real trailer `/Encrypt` state — lopdf auto-decrypts docs whose user or owner password is empty, so `true` means a password is required |
| `encrypt` | `{password, owner_password?, permissions?, encrypt_metadata?}` | `{ok, encrypted:true}` | mutating; Standard handler V4/R4 AES-128 (`StdCF`). `password` = user password, non-empty ≤127 UTF-8 bytes (key material truncated to 32 per spec); `owner_password` defaults to `password`; `permissions` = array of `print|modify|copy|annotate|fill|accessibility|assemble|printHighQuality`, omitted = all; `encrypt_metadata` bool default true. Already-encrypted → Validation. Generates a random trailer `/ID` when absent (lopdf key derivation requires it). One undo entry |
| `decrypt` | `{password}` | `{ok, encrypted:false}` | mutating; `password` is the **user** password. Wrong password → Validation `incorrect password`, state untouched; a password matching only `/O` → Unsupported (lopdf 0.36 derives the file key from the user password even when owner auth succeeds). Not-encrypted → Validation. One undo entry |
| `pageCount` | `{}` | `{pages}` | |
| `pageText` | `{page}` | `{text}` | 0-based page; extracts strings from `Tj`/`TJ`/`'`/`"` ops in content stream; may be lossy — documented |
| `addAnnotation` | `{page,rect:[x,y,w,h],contents,subtype?,author?,modified?}` | `{annot_id}` | real PDF: appends obj to page `/Annots` (`/Subtype /Text|/Highlight|/Underline|/StrikeOut|/Square|/Circle`, `/Rect`, `/Contents`; markup includes `/QuadPoints`); `Ink`/`Link` subtypes reject here — use the dedicated ops |
| `addInkAnnotation` | `{page,paths:[[[x,y],...],...],color?,width?,opacity?,contents?,author?,modified?}` | `{annot_id}` | `/Subtype /Ink`; `paths` = 1–64 strokes of ≥2 `[x,y]` points each, ≤2048 points total, coordinates finite within ±1 000 000; `/InkList` is the spec array-of-paths form (alternating x/y numbers per stroke); `color` `[r,g,b]` 0..=1 → `/C`; `width` (default 1, ≤100) → `/BS /W`; `opacity` 0..=1 → `/CA`; `/Rect` = stroke bounds padded by half the width (min 1 pt); optional `/Contents`/`/T`/`/M` follow `addAnnotation` rules |
| `addLinkAnnotation` | `{page,rect:[x,y,w,h],uri,contents?,author?,modified?}` | `{annot_id}` | `/Subtype /Link` with `/A << /S /URI /URI (…) >>` and invisible `/BS /W 0`; `rect` positive/nondegenerate within ±1 000 000 (same rule as shapes); `uri` non-empty ≤2048 bytes, valid RFC 3986 scheme (`ALPHA *(ALPHA/DIGIT/+/-/. )` then `:`), no whitespace or control characters |
| `listAnnotations` | `{page}` | `{annots:[{id,subtype,rect,contents,uri?,dest?}]}` | `uri`/`dest` appear only when the annotation carries a decodable `/A /URI` string or `/Dest` (string, name, or numeric array) |
| `setAnnotationContents` | `{page,id,contents}` | `{ok}` | page-owned Text/Highlight only; at most 32767 UTF-16 code units (64 KiB including BOM); real PDF text string; same-text request is eventless/no history |
| `addAnnotationReply` | `{page,id,contents,author,modified}` | `{annot_id}` | Text reply /IRT to a primary Text/Highlight, /RT /R; explicit metadata, bounded nonblank body |
| `setAnnotationReview` | `{page,id,resolved:boolean,author,modified}` | `{annot_id}` or `{ok}` | separate hidden author-specific Review state Text record: Completed/None; chains to previous author state; same state eventless |
| `listCommentThreads` | `{page,review_author?}` | `{threads:[{id,contents,subtype,rect,author?,modified?,replies,resolved?,review_state?}]}` | actual PDF body/metadata; state records omitted from body replies; author-specific projection only |
| `removeAnnotation` | `{page,id}` | `{ok}` | atomic annotation-descendant subtree removal; generic owned Widget/Ink retained; external references/popup lifecycle/unsupported graphs reject safely |
| `rotatePage` | `{page,degrees}` | `{ok}` | sets `/Rotate`, must be multiple of 90 |
| `movePage` | `{from,to}` | `{ok}` | 0-based indices; page at `from` is removed and reinserted at `to`; both must be `< pageCount`; `from === to` is an eventless no-op (no undo entry, no `document:changed`) |
| `deletePage` | `{page}` | `{ok}` | 0-based index; deleting the last remaining page → Validation; objects reachable only through the deleted page are collected. Inbound references that keep the deleted page reachable (named destinations in `/Names`→`/Dests`, a root `/Dests` dict, `/Outlines` `/Dest`/`/A`→`/GoTo`, `/OpenAction`, `/StructTreeRoot`) leave an orphaned `/Type /Page` object that is no longer in `/Kids` — a ghost page viewers may still resolve; dest scrubbing is not performed |
| `duplicatePage` | `{page}` | `{ok,page}` | deep-copies the page dict and each annotation into fresh indirect objects; `/Contents` streams, `/Resources` and other references are **shared** with the source; copy is inserted at `page+1`; `page` = copy's index. `/StructParents` and `/B` are stripped from the copy; `/PieceInfo`, `/Tabs`, `/AA` and page `/Metadata` are still copied verbatim (shared/stale). Inline (non-reference) annotation dicts are preserved as inline `/Annots` entries with the same link remap |
| `insertBlankPage` | `{index}` | `{ok,page}` | blank US-Letter page (empty content stream, empty resources) at `index`, `0..=pageCount`; `page` = new index |
| `save` | `{}` | `{bytes_b64,size}` | `doc.save_to` → real PDF bytes |
| `listPageInfo` | `{}` | `{pages:[{index,mediabox,rotate,annots_count,has_contents}]}` | read-only; `mediabox` `[x1,y1,x2,y2]` or null, resolved through the inheritable `/Parent` chain; `rotate` likewise (default 0); `has_contents` = decoded content streams carry bytes, `null` on encrypted documents (streams are ciphertext) |
| `addBookmark` | `{title,page,parent?}` | `{ok,id}` | mutating; appends an outline item as the last child of `parent` (an item `id`) or top-level when omitted. `title` non-empty ≤2048 UTF-16 code units; `page` 0-based index → `/Dest [page /Fit]`; `id` = new item dict object number. Hand-built `/Outlines` root+item dicts with correct `/First`/`/Last`/`/Next`/`/Prev`/`/Parent` links and spec `/Count` (visible descendants, sign = open/closed). One undo entry |
| `removeBookmark` | `{id}` | `{ok}` | mutating; removes the item `id` and its whole descendant subtree, repairs neighbour/parent links from the walked `/First`→`/Next` order (raw `/Prev`/`/Last` backlinks are never trusted), recounts `/Count`, deletes the objects, then prunes every object unreachable from the trailer — including orphans that pre-date the op, not only objects the removed items referenced. Rejects Unsupported when a surviving object still references the removed set (dangling-link guard; the scan covers `doc.objects` but not `doc.trailer` entries) |
| `listOutlines` | `{}` | `{outlines:[{id,title,page,dest?,children}]}` | read-only nested `/Outlines` tree. `id` = item dict object number (`null` for inline foreign items); `page` = 0-based index the `/Dest` or `/A`→`/D` resolves to (`null` when unresolvable — named dests that do not decode, remote go-to, deleted-page ghosts); `dest` = explicit-dest tail (`/Fit` + coords) or the unresolved dest name. Rejects encrypted documents (titles are ciphertext) |
| `listFormFields` | `{}` | `{fields:[{page,name,ft,v,ff,rect,signature,annot}]}` | read-only; walks each page's `/Annots` for widget annotations (`/Subtype /Widget`, or no `/Subtype` with `/FT` and `/Rect`). `name` = flattened field name (`/T` partials joined `.`), `ft` = nearest `/FT` up the `/Parent` chain (`Tx`/`Btn`/`Ch`/`Sig`/foreign name, null when unresolved), `v` = decoded `/V` (text for `Tx`/`Ch`, name for `Btn`, array for multi-value `Ch`, null otherwise), `ff` = nearest `/Ff`, `rect` = `[x,y,w,h]` or null, `signature` = `ft==="Sig"`, `annot` = `/Annots` object number (null for inline widgets). ≤10 000 fields, cycle-safe, indirect deref throughout. Rejects encrypted documents (names/values are ciphertext) |
| `fillFormField` | `{page,field|annot,value}` | `{ok}` | mutating; exactly one of `field` (flattened name, per-page match — ambiguous names reject, use `annot`) or `annot` (widget object number). Writes `/V` on the *field* dict (first `/Parent`-chain node with a field-identity key `/FT`/`/V`/`/Ff`/`/Opt`/`/Kids` — `/T` only as last resort; inheritable presentation attrs `/DA`/`/Q` never count — merged widget or parent field), never assumed to be the widget. `Tx`/`Ch`: `value` string ≤32 767 UTF-16 units → PDF text string (`/I` index arrays and `/Opt` validation not written). `Btn`: `value` ≤1024 bytes → `/V` name; `""`/`off`/`false`/`no`/`0` (case-insensitive) → `/Off`, anything else verbatim on-state name. Checkbox mirrors the name into `/AS` on the field's indirect widget dicts only (pure field dicts never get `/AS`; checkbox on-state names are NOT validated against `/AP`→`/N`, unlike radio); radio (`/Ff` bit 15) requires a kid `/AP`→`/N` state matching `value` (matching kid `/AS` = name, siblings `/Off`; no appearance states → reject). `/FT /Sig`, pushbuttons (`/Ff` bit 16), missing `/FT`, and inline field dicts reject. Sets `/NeedAppearances true` on `/AcroForm` (created if absent) — appearance streams are NOT regenerated. Equal `/V` → eventless no-op, except `Btn` fills also compare computed `/AS` states so a divergent foreign document is repaired. Rejects encrypted documents. One undo entry |
| `listSignatures` | `{}` | `{signatures:[{name,page,annot,signed,byte_range,byte_range_well_formed,sub_filter,signer,date,reason,contact,location,signature_type}]}` | read-only; every `/FT /Sig` field deduplicated by field dict — page `/Annots` widgets first (page order), then catalog `/AcroForm` `/Fields` walked through `/Kids` for fields with no on-page widget (`page`/`annot` null). `signed` = `/V` resolves to a dictionary; details come from that dict: `byte_range` = `/ByteRange` integers or null, `byte_range_well_formed` = shape check only (four non-negative ints, pair 2 at/after pair 1 end — NEVER verified against file bytes), `sub_filter`/`signature_type` = name objects, `signer`/`date`/`reason`/`contact`/`location` = `/Name`/`/M`/`/Reason`/`/ContactInfo`/`/Location` strings. NO cryptographic/CMS verification — lopdf parses objects only. ≤10 000 entries, cycle-safe, ≤4096 `/Fields` nodes at depth ≤32. Rejects encrypted documents |
| `listAttachments` | `{}` | `{attachments:[{name,size,description}]}` | read-only; walks catalog `/Names`→`/EmbeddedFiles` name tree (`/Names` pairs + `/Kids`, cycle-safe, depth ≤16, ≤256 nodes, ≤4096 pairs — larger/ragged trees reject). `name` = decoded key, `""` when the key is not a PDF string (the pair is still listed), `size` = embedded stream's declared `/Params` `/Size` or null (raw `/Length` never substituted — it may be compressed); declared size can differ from `getAttachment`'s actual decoded length on PDFs whose `/Params` lies, `description` = `/Desc` or null. Rejects encrypted documents |
| `getAttachment` | `{name}` | `{name,size}` + `bytes_b64` (or binary output) | read-only; exact-name match in the name tree → `/Filespec`→`/EF`→`/F` stream, decoded via `get_plain_content` (filters decompress), `size` = actual decoded byte length, ≤64 MiB decoded cap. The cap is checked AFTER lopdf has already materialized the decompressed stream — lopdf 0.36 has no bounded-decompression API, so a small compressed stream can expand past the cap before it is rejected (same pre-existing exposure as `pageText`/content reads); hosts should bound input PDF sizes. Unknown name or filespec without `/EF` stream → NotFound. Rejects encrypted documents |
| `addFileAttachment` | `{name,data_b64|binary,description?,page?,rect?}` | `{ok,name}` | mutating; embeds `data` (≤25 MiB decoded, base64 field or binary sidecar — not both; the op is listed in `binary_input_ops` so binary-capable hosts may send `Command.input`) as an `/EmbeddedFile` stream (`/Type`, `/Params << /Size /CheckSum MD5 >>` — `/CheckSum` is the 16 raw MD5 digest bytes as a PDF string), a `/Filespec` (`/F`/`/UF`/`/EF`/`/Desc`), and a `/Names`→`/EmbeddedFiles` entry. `name` non-empty ≤255 UTF-8 bytes, no control chars, unique (duplicates → Validation). `page` requires `rect` `[x,y,w,h]` (positive, ≤±1 000 000) and adds a `/Subtype /FileAttachment` annotation (`/FS` → filespec; `rect` without `page` rejects). Name tree is rebuilt as ONE sorted leaf holding every existing pair verbatim plus the new one, sorted by the keys' raw encoded string bytes (deterministic; spec-pedantic ordering only) — multi-leaf `/Limits` bookkeeping is dropped, old nodes pruned via `prune_unreachable` (also drops pre-existing orphans, same sweep as `removeBookmark`); non-string keys or ragged `/Names` arrays reject Unsupported rather than lose entries. NO appearance stream is generated — viewers render their default icon or nothing. Rejects encrypted documents (ciphertext strings + plaintext stream would corrupt). No equal/no-op case and no remove op this slice. One undo entry |
| `info` | `{}` | `{pages,has_annots,encrypted}` | read-only; `encrypted` mirrors `describe.encrypted` and the `open` flag |

Undo: previous serialized `doc` (lopdf Document clone — it implements Clone; cap 8). `encrypt`/`decrypt` record undo like every mutating op, so encryption state round-trips through undo/redo for free.

Encryption notes: `encrypt`/`decrypt` run on a cloned `Document` and commit only on success, so failures are atomic. Encrypted ciphertext persists in `save` bytes and NFD1 snapshots (snapshot = serialized PDF), so an encrypted document stays encrypted across `save`/`snapshot`/`restore`/`open`; `restore` of encrypted bytes leaves the doc encrypted until `decrypt`. While `encrypted` is true the document still parses (page tree/dicts are plaintext) but strings and streams are ciphertext — `pageText`, annotation contents and other content ops are not meaningful until `decrypt` succeeds. `describe` also reports `encrypted`. Only the Standard password handler at V4/R4 (AES-128) is produced; foreign documents using other handlers/versions may fail `decrypt` with a typed error rather than being silently mis-decrypted.

Annotation creation/editing encodes ASCII as PDFDocEncoding and non-ASCII as UTF-16BE via lopdf text_string. Annotation listing decodes PDF text strings; pageText remains the existing lossy content-stream extraction. Comment edits preserve the annotation id/type/geometry and unrelated PDF dictionary entries, with one undo entry; no author/date/appearance/reply/state is fabricated.

Comment metadata requires caller-owned nonblank author ≤256 UTF-8 bytes without controls and a full valid UTC PDF date `D:YYYYMMDDHHmmSSZ`. Optional addAnnotation metadata must supply both fields; no author/date is generated. Reply bodies cap at 32767 UTF-16 units. Review state and StateModel are PDF text strings; /IRT links are same-page indirect references, /RT is /R. State records have Hidden flag 2, zero Rect and empty Contents; later author state changes chain to the prior author state. Latest ordering is (validated UTC date,ObjectId); changed dates older than that author's latest reject before mutation. Equal dates use the fresh object id. Completed/None project resolved true/false only for explicit review_author; Accepted/Rejected/Cancelled retain review_state with resolved omitted, and no author query implies no global resolved value.

Admitted graphs require unique page-array ownership, including objects without /P, with no cycles/dangling/cross-page/grouping replies. Limits: 4096 references/page, 10000 pages/100000 references for ownership scanning, 100000 PDF objects, 256 records/thread, 64 links/depth. Deletion additionally scans at most 1000000 reference values/depth 64, rejecting unsupported external/popup relationships before mutation. Legal partial/non-UTC dates, unknown state models, nonempty state-record body text and unsupported reply relationships reject conservatively. Removing a comment/reply removes its descendant reply/state records in one undo entry. Original root review state is never overwritten. Existing comment-content edits preserve metadata.

Canonical reply/resolve bindings require explicit metadata provider, reviewAuthor, isCurrent admission and authoritative host commit(action) gate. The adapter rejects actor mismatch and unsupported mentions, rechecks generation after async provider/read work, rereads thread authority within the gate and checks again before the operation. This is caller-owned serialization, not native expected-revision CAS. Raw PDF dates are retained; timeLabel requires an explicit app formatter. No application-host activation or PDF visual rendering is claimed.

Axis-aligned markup accepts one caller-owned rectangle in default PDF user space. Highlight, Underline and StrikeOut persist required QuadPoints as counterclockwise bottom-left, bottom-right, top-right, top-left (ISO 32000-1 Table179), first edge defining horizontal +X text orientation. Width/height must be positive, all corners within ±1000000 units and distinct after lopdf f32 conversion. All annotation corners must remain finite in f32; creation contents cap at 32767 UTF-16 units. Validation precedes journal/object mutation. No glyph hit testing, crop/rotation transform, multi-line quadrilaterals or appearance stream is inferred. Cross-viewer display, including Acrobat's differing QuadPoints convention, remains unverified. Underline/StrikeOut do not enter the narrower Text/Highlight comment editing/reply/review contract. The pinned AnnotationToolbar supports the added underline/strike tool IDs; host supplies actual page coordinates.

Square/Circle annotations use positive bounded caller rectangles and standard PDF geometry, with an explicit solid one-point black DeviceGray border and transparent interior. They carry no QuadPoints or fabricated appearance stream. Because IC is emitted, headers below PDF1.4 are raised to1.4; higher headers and catalog version metadata remain intact, and undo restores the original header. Unsupported header versions reject before mutation. Generic list/delete/save/history apply; comment text/reply/review still supports only Text/Highlight. Renderer placement, styling controls and viewer visual acceptance remain separate.

Page-tree ops (`movePage`/`deletePage`/`duplicatePage`/`insertBlankPage`) treat the document's page order as the depth-first `/Kids` order under the catalog's `/Pages` root. Each structural op rewrites that root's `/Kids`/`/Count` as a flat array of page references and reparents every page to the root, so intermediate `/Pages` nodes are dropped; before reparenting, inheritable page attributes (`/MediaBox`, `/CropBox`, `/Rotate`, `/Resources`, `/UserUnit`) that a page does not define itself are materialized onto it from its ancestor chain, preserving effective values. Before the rewrite, the page iterator's yield is compared against a full recursive `/Kids` walk that counts terminal entries regardless of `/Type` (references and inline dictionaries alike); a mismatch means the tree hides subtrees from `get_pages` and the op rejects with Validation rather than silently dropping pages. All four ops reject encrypted documents with Unsupported: lopdf's `encrypt` rewrites strings and streams in place keyed by object id, so objects cloned under fresh ids (a duplicated page or its annotations) would carry ciphertext that decrypts to garbage under the new id — `decrypt` first. `listPageInfo` still works read-only on encrypted documents for the structural fields; `has_contents` reports `null` because content streams are ciphertext. Afterwards, objects that became unreachable from the trailer (orphaned `/Pages` nodes, a deleted page's exclusive contents/annots, replaced `/Annots` arrays) are removed — lopdf's writer emits every object in `doc.objects`, so orphans would otherwise persist as dead bytes; objects still referenced elsewhere (shared content streams after `duplicatePage`, shared `/Resources`, annots reachable from surviving pages) are kept. Page object ids are never renumbered, so named destinations, structure parents and `/ParentTree` entries stay valid for `movePage`/`duplicatePage`/`insertBlankPage`; for `deletePage` they stay *syntactically* valid but can resolve to a ghost: named destinations (`/Names`→`/Dests`, a root `/Dests` dict), `/Outlines` `/Dest`/`/A`→`/GoTo` actions, `/OpenAction` and `/StructTreeRoot` references to the deleted page's object id keep it reachable, leaving an orphaned `/Type /Page` object that is no longer in `/Kids`. Dest scrubbing is not performed in this slice. The catalog `/PageLabels` number tree is index-keyed, so it goes stale after any move/delete/insert (labels no longer match the new page order) and is not updated. `duplicatePage` copies the page dictionary and each annotation into fresh indirect objects — inline (non-reference) annotation dicts are preserved as inline `/Annots` entries — and remaps intra-page annotation links (`/IRT`, `/Popup`, and `/Parent` when it names another annotation — a widget's field `/Parent` stays shared); an annotation whose `/IRT`/`/Popup` points outside the page's annotation set rejects the whole op. `/StructParents` and `/B` are stripped from the copy (a shared struct-parent index would corrupt MCID mapping in tagged PDFs, and bead arrays would chain the copy into the source's thread beads); `/PieceInfo`, `/Tabs`, `/AA` and page `/Metadata` are still copied verbatim and remain shared/stale. `/Contents` streams and `/Resources` are shared between source and copy by reference. All page ops require an indirect `/Pages` root and validate fully before journaling; `movePage {from,to}` with `from === to` is an eventless no-op; each mutating op records one undo entry and emits one `document:changed`.

Outline ops (`listOutlines`/`addBookmark`/`removeBookmark`) hand-build and maintain the catalog `/Outlines` dictionary tree directly — lopdf 0.36's `Bookmark`/`build_outline` helpers were rejected because they keep a parallel bookmark table, emit `/A` action objects instead of `/Dest`, cannot insert or remove single items, and compute `/Count` as direct-child counts rather than the spec's visible-descendant count. Each item is an indirect dictionary with `/Title` (PDF text string), `/Parent`, `/Dest [page /Fit]`, and the `/First`/`/Last`/`/Next`/`/Prev` sibling links; `/Count` is recomputed for the whole tree after every mutation as the number of visible descendants, preserving each item's open/closed sign, and the root `/Count` is the total visible item count. Item identity is the dictionary's object number (the same `.0` convention as `annot_id`); it is stable across adds/removes because objects are never renumbered, so `removeBookmark {id}` keeps working after sibling edits, `movePage`, `duplicatePage`, `insertBlankPage` and save→open round-trips. `addBookmark` always appends as the *last* child of `parent` (or top-level); there is no insert-at-index in this slice. All three ops reject encrypted documents with Unsupported — new `/Title` strings would be plaintext in an encrypted file and existing titles are ciphertext — and the mutating ops additionally reject any outline tree containing inline (non-indirect) item dictionaries rather than risk corrupting nested dict values; `listOutlines` still lists them with `id: null`. `/Title` may be an indirect string (dereferenced before decoding). Sibling order, parent scopes and scope `/First`/`/Last` edge pointers are derived from the `/First`→`/Next` walk only: `/Prev` is never traversed and `/Last` is never trusted, so forged or stale backlinks cannot redirect a link repair into an unrelated object; `addBookmark` appends after the scope's last *walked* child and rejects a scope the walk saw as empty but that still carries a `/Last` chain pointer, and `removeBookmark` rewrites the scope's `/First`/`/Last` unconditionally from walked truth and re-walks the staged tree afterwards, rejecting if any previously reachable item id was lost. Bounds: non-empty titles ≤2048 UTF-16 code units, ≤4096 items, top-level items at depth 0 with the deepest admitted item at depth 64 (a chain can be 65 items deep), cycle-safe walks, named-destination collection capped at 4096 entries (names past the cap report as unresolved). The root `/Count` is omitted rather than written as 0 when the outline is empty. `removeBookmark` deletes the item plus its descendant subtree and then scans every surviving object for references into the removed set — an `/OpenAction`, named destination or stray link rejects the whole op with Unsupported instead of committing a dangling reference (the scan iterates `doc.objects`; trailer entries are not scanned) — before recounting and pruning every trailer-unreachable object, which includes pre-existing orphans, not only objects the removed items referenced. Destinations keep stable page object ids: `movePage`/`duplicatePage`/`insertBlankPage` leave outlines valid and `listOutlines` resolves the *current* page index, while `deletePage` never scrubs outline dests — the `/Dest` page reference keeps the deleted page reachable as an orphaned `/Type /Page` ghost (same documented behaviour as named destinations) and `listOutlines` reports `page: null` for it.

Form field ops (`listFormFields`/`fillFormField`) discover widgets by walking page `/Annots` — not the catalog `/AcroForm` `/Fields` tree — so fields without an on-page widget are never listed, and `/T` alone never marks an annot as a widget (it is also the annotation title key; the no-subtype fallback requires `/FT` plus `/Rect` — widgets have geometry, so a bare `/FT` dict without `/Subtype`/`/Rect` is a pure field dict). `/FT`, `/V`, `/Ff` and `/T` partial names inherit leaf→root through `/Parent` with the nearest definition winning; the flattened name joins every `/T` root→leaf with `.`. `fillFormField` writes `/V` on the first chain node carrying a field-identity key (`/FT`/`/V`/`/Ff`/`/Opt`/`/Kids`, `/T` last resort) — deliberately excluding inheritable presentation attributes `/DA` and `/Q`, which widget dictionaries legitimately carry and which would otherwise pull `/V` onto a widget kid while the parent field keeps a stale value — which is the merged widget dict for merged fields and the parent field dict for separate widget kids — so one fill updates every widget of the field, and `duplicatePage`'s shared field references mean filling through either copy's widget sets the same `/V`. Button semantics are a documented subset: `Btn` `/V` is a name object; the off-set is exactly `""`, `off`, `false`, `no`, `0` (case-insensitive) → `/Off`, every other value is stored verbatim as the on-state name (lopdf `#XX`-escapes on write). Checkbox on-state names are stored verbatim and are NOT validated against the widget's `/AP`→`/N` states (radio values are) — a name with no matching appearance stream still writes `/V`/`/AS` and relies on `/NeedAppearances`. Checkboxes mirror the state into `/AS` on every indirect widget dict of the field — real widget annotations only (`/Subtype /Widget`, or no subtype with `/FT` and `/Rect`); pure field dicts and inline dictionaries never receive `/AS`. Radio groups resolve `value` against kid `/AP`→`/N` state names — the matching kid's `/AS` takes the name, siblings take `/Off`, and kids or merged fields without appearance states cannot be selected. `/AS` writes skip inline (non-indirect) widget dictionaries, which lopdf cannot mutate through its object map; `/V` stays authoritative and `/NeedAppearances true` asks viewers to repaint. A `Btn` fill whose `/V` already matches is still a real mutation when any computed `/AS` differs, so foreign documents with divergent appearance states get repaired instead of an eventless no-op. `Tx`/`Ch` store a single PDF text string — choice `/I` indices, multi-select arrays and `/Opt` membership are not written. Signature fields (`/FT /Sig`) list with `signature: true` but always reject fills, as do pushbuttons and fields with no resolvable `/FT`. Both ops reject encrypted documents: `/T`/`/V` strings are ciphertext under lopdf's in-place encryption and a plaintext `/V` written post-encrypt would save unencrypted — `decrypt` first. `describe` gains `has_forms` (AcroForm `/Fields` non-empty or any widget annot). Bounds are fail-closed by design: a `/Parent` chain deeper than 64 links or more than 10 000 listed fields rejects the whole op rather than returning a partial list, and `fillFormField` scans at most 10 000 widget entries per page.

Signature and attachment ops (`listSignatures`/`listAttachments`/`getAttachment`/`addFileAttachment`) cover the read side of PDF signatures and embedded files. `listSignatures` collects `/FT /Sig` fields from page widgets AND the catalog `/AcroForm` `/Fields` tree (recursively through `/Kids`, cycle-safe), deduplicated by field dictionary id so a field with several widgets reports once at its first widget in page order; fields with no on-page widget report `page`/`annot` null. When `/V` resolves to a dictionary the op reports `/ByteRange` (raw integers plus a shape-only `byte_range_well_formed` check — four non-negative ints with the second pair starting at/after the first pair's end), `/SubFilter`, `/Name` signer, `/M` date, `/Reason`, `/ContactInfo`, `/Location` and `/Type`. There is deliberately NO signature verification: lopdf parses the object model, not CMS/PKCS#7, `/ByteRange` offsets refer to serialized-file byte positions the engine never re-derives, and any post-signing edit invalidates a signature without touching the dictionary — hosts must treat `signed:true` as "a signature dictionary is present", nothing more. `addFileAttachment` writes a real EmbeddedFile stream with `/Params` `/Size` and an MD5 `/CheckSum`, a `/Filespec`, and rebuilds the `/Names`→`/EmbeddedFiles` tree as a single sorted leaf — every existing pair is preserved verbatim (non-string keys reject rather than drop data), `/Limits` bookkeeping is not maintained for the single-leaf form, and unreachable old tree nodes are pruned with the same `prune_unreachable` sweep `removeBookmark` uses. Attachment names must be unique; there is no remove/replace op in this slice. `page`+`rect` add a `/FileAttachment` annotation without an appearance stream. All four ops reject encrypted documents: name keys, `/F`/`/UF`/`/Desc` and annotation `/Contents` are ciphertext strings and a plaintext EmbeddedFile stream would save unencrypted inside an encrypted file — `decrypt` first. `describe` gains `signature_count` and `attachment_count` as structural counts (accurate even on encrypted documents, since `/FT` is a name object and pair counting needs no string decode). `getAttachment`'s 64 MiB cap applies to the decoded result only: lopdf 0.36 materializes decompressed streams unboundedly before the cap is checked — a pre-existing lopdf limitation shared with `pageText`/content reads, not something this slice can bound (tracked as a known limitation in the folio backlog) — so hosts should bound input PDF sizes. `listAttachments` `size` is the declared `/Params` `/Size` while `getAttachment` `size` is the actual decoded length; the two can differ on PDFs whose declared size lies.

Freehand Ink annotations persist real `/InkList` stroke geometry — an array of paths, each alternating x/y coordinates (not path-painting operators) — with `/Rect` computed from the stroke bounds and an explicit `/BS` border; `color` maps to `/C` and `opacity` to `/CA`. Link annotations persist `/A << /S /URI /URI (…) >>` behind an invisible border; URI validation is syntactic (scheme shape, length, no whitespace/controls) and never checks reachability. Both carry optional Contents/author/date metadata under the `addAnnotation` rules, join generic list/delete/save/history like every annotation, and stay outside the Text/Highlight comment-edit/reply/review contract. `listAnnotations` surfaces decodable `/A /URI` as `uri` and `/Dest` (string, name or numeric array) as `dest`.

## pitch-engine — `PitchEngine::new()`

State `{ meta:{title}, size:{width,height}, next_id, slides:[Slide], sections:[Section], next_section_id,
masters:[SlideMaster], layouts:[SlideLayout], themes:[DeckTheme], deck_theme?:number }`,
`Section = { id, label, start_slide_id }` is a stable deck boundary. Older snapshots default to `sections:[]` and `next_section_id:1`.
`Slide = { id, layout:"blank"|"title"|"titleBody", background:[r,g,b,a]|null,
objects:[Obj], animations:[Anim], notes?:string, ink?:[InkStroke],
transition?:SlideTransition, timing?:SlideTiming, layout_id?:number }`,
`SlideMaster = { id, name, background?:[r,g,b,a] }`,
`SlideLayout = { id, master_id, name, placeholders:[Placeholder] }`,
`Placeholder = { id, kind:"title"|"body"|"image"|"media"|"date"|"footer"|"pageNumber",
x,y,w,h, label, inherit_theme?:bool }`,
`DeckTheme = { id, name, colors?:{slot:[r,g,b,a]}, fonts?:{slot:string} }`.
Deck themes are named color/font slot bundles (P14 slice 9, mirroring the
pinned NYC-Tron `ThemeAndTemplateGallery` `kind:"theme"` preset contract):
a flat deck-level collection plus a `deck_theme` binding. Color slots are
the OOXML theme color roles `dk1|lt1|dk2|lt2|accent1..accent6|hlink|
fol_hlink`; font slots are the OOXML major/minor latin typefaces
`major_latin|minor_latin`. Slots are sparse: an absent slot means "no
theme value stored", never an implicit default. Bounds: ≤32 themes,
names/font families non-blank ≤128 UTF-8 bytes; all ids share the
document `next_id` space. HONESTY BOUNDARY: the engine stores/validates
the slot maps and the deck→theme binding as DATA ONLY — it does NOT
resolve theme colors/fonts onto objects, masters, layouts or
placeholders, and placeholder `inherit_theme` stays an independent flag.
NYC-Tron `kind:"template"` presets (a bundled theme + master/layout set)
are deferred: masters/layouts/placeholders are separate validated
collections and the apply/bind slice does not exist yet, so a template
bundle has no honest semantics to store in this slice. Older snapshots
default to `themes:[]` and absent `deck_theme`.
Masters/layouts/placeholders are slide-master DATA (P14 slice 8a, mirroring
the pinned NYC-Tron `MasterLayoutEditor` contract): flat deck-level
collections, a layout back-references its master via `master_id`, and
placeholders are typed regions on layouts. Bounds: ≤64 masters, ≤256
layouts, ≤64 placeholders per layout; names/labels non-blank ≤128 UTF-8
bytes; placeholder x/y finite within ±1,000,000 and w/h finite >0
≤1,000,000. All ids share the document `next_id` space. HONESTY BOUNDARY:
the engine stores/validates these definitions and the slide→layout
binding; it does NOT render master content onto slides or resolve
placeholders into objects — apply/bind is a later slice. NYC-Tron layout
`parentId` inheritance is not modeled yet. `removeMaster` cascade-removes
its layouts; `removeLayout` and `removeMaster` clear slide `layout_id`
bindings without touching slide content. Older snapshots default to
`masters:[]`/`layouts:[]` and absent `layout_id`.
`SlideTransition = { kind:"fade"|"slideLeft"|"slideRight"|"slideUp"|"slideDown"|"wipe"|"zoom"|"morph",
duration_ms:1..=60000, direction?:"left"|"right"|"up"|"down" }`,
`SlideTiming = { duration_ms:1..=3600000, advance:"manual"|"after" }`.
`"morph"` is the morph transition kind: the host matches objects across
adjacent slides by their stored `morph_name` tags and interpolates between
them. The engine stores the kind and the tags as DATA ONLY — it performs
no morph evaluation, interpolation or rendering (same honesty boundary as
the other transition kinds).
`Obj = { id, kind:"text"|"rect"|"image"|"roundedRect"|"ellipse"|"triangle"|"diamond"|"line"|"arrow"|"star"|"connector"|"media", x,y,w,h, rotation_deg,
text?{content,font_size,color,bold,italic}, fill?[u8;4], stroke?:{width,color:[u8;4]}, connector?:ConnectorSpec, media?:MediaSpec, morph_name?:string, src?:string }`.
`morph_name` is an optional bounded non-blank tag (<=128 UTF-8 bytes),
unique per slide, that hosts use to pair objects across adjacent slides
during a `"morph"` transition; it is stored data only — the engine never
interpolates morph geometry.
Shape presets are inscribed in the object's axis-aligned `x,y,w,h` bounds
before `rotation_deg`: `roundedRect` is a rectangle with corner radius
`min(w,h)/4`; `ellipse` is the inscribed ellipse; `triangle` is isosceles
with apex at top-center and base on the bottom edge; `diamond` joins the
edge midpoints; `star` is a 5-point star inscribed in the bounds; `line` is
the horizontal segment from the left to the right edge midpoint and `arrow`
the same segment with a triangular head at the right end — `line`/`arrow`
are open shapes rendered from `stroke`. `stroke.width` is a finite slide-unit
measure >0 and <=10,000; `stroke` is admitted only on shape kinds (restore
rejects it on text/image). The engine stores kind/fill/stroke as data; hosts
own path rendering and hit testing.
`ConnectorSpec = { from:ConnectorEnd, to:ConnectorEnd, route:"straight"|"elbow",
arrows:"none"|"start"|"end"|"both", stroke?:{width,color:[u8;4]} }`,
`ConnectorEnd = {type:"free",x,y} | {type:"bound",object_id,side:"top"|"bottom"|"left"|"right"|"center"}`.
A connector object's `x,y,w,h` are stored zeros — connector geometry is never
stored. `describe` adds a `resolved` field to each connector object:
`{from:{x,y}, to:{x,y}, points:[[x,y]..]}` computed from CURRENT slide state.
Endpoint resolution: `free` is the absolute slide-space point (finite within
±1,000,000); `bound` resolves to the midpoint of `side` on the target object's
PRE-ROTATION stored axis-aligned bounds (`rotation_deg` is ignored;
`center` = bounds midpoint) computed from STATIC stored geometry — slide
animations never affect resolved endpoints. Object bounds are unbounded (any
finite f64), so extreme coordinates can overflow the anchor arithmetic;
`describe` then omits `resolved` for that connector rather than emitting
non-finite values. Bound targets must be
existing non-connector objects on the same slide; they cannot be the connector
itself. Route geometry is deterministic: `straight` → `[from, to]`; `elbow` →
`[from, (midX,from.y), (midX,to.y), to]` with `midX = (from.x+to.x)/2` (the
same H-V-H formula the pinned NYC-Tron connector control draws). Because
resolution happens at read time, moving or resizing a bound object moves the
connector endpoint — reconnection is implicit, never stored. `stroke` on a
connector reuses the shape-stroke bounds (width finite >0 <=10,000). The
engine stores endpoints/routing as data; hosts own path rendering, arrowhead
glyphs and hit testing. `moveObject`/`resizeObject`/`rotateObject` reject
connector objects (their bounds are meaningless); `setObjectOrder` still
applies. `slideAt` emits connectors like every object as kind-less
`{id,x,y,w,h,rotation,opacity}` entries — normally zero bounds since
connector geometry is resolved, not stored; hosts read connector paths from
`describe`'s `resolved` field.
`MediaSpec = { src:string, kind:"video"|"audio", mime?:string, poster?:string,
trim_in_ms?:u32, trim_out_ms?:u32, volume?:f64, fit?:"contain"|"cover"|"stretch",
autoplay?:bool, loop?:bool, muted?:bool, show_controls?:bool, hide_when_stopped?:bool }`.
A media object stores METADATA ONLY — the engine never decodes, buffers,
plays or renders media; decode/playback is host-side (the same honesty
boundary as slide transitions and the prototype runtime). `src`/`poster`
are host-resolved asset references (bounded non-empty strings ≤4096 UTF-8
bytes, the same reference model as image `src`), never embedded bytes;
`mime` is a bounded non-empty string ≤128 bytes. `trim_in_ms`/`trim_out_ms`
are whole milliseconds 0..=86,400,000 with `trim_in_ms <= trim_out_ms` when
both present; `volume` is a finite 0..=1 gain; `fit` and the playback flags
mirror the NYC-Tron `SlideMediaSettings` contract (kind is `video`|`audio`
there; still images stay on `kind:"image"`). Unlike connectors, media
objects have REAL bounds: `x,y,w,h` must be finite with `w,h > 0` (enforced
by `addMedia` and by restore), so `moveObject`/`resizeObject`/
`rotateObject`/`setObjectOrder`/`removeObject` and animations all apply.
Media objects carry no `text`/`fill`/`src`/`connector`/`stroke` payloads
(restore rejects them); `media` is present iff `kind=="media"` in both
directions.
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
| `addMaster` | `{name,background?}` | `{master_id}` | name non-blank ≤128 UTF-8 bytes; `background` optional `[r,g,b,a]` stored data for the host; ≤64 masters; id from `next_id`; one undo entry |
| `renameMaster` | `{id,name}` | `{ok}` | equal name is an eventless no-op preserving redo |
| `setMasterBackground` | `{id,color}` | `{ok}` | `color` `[r,g,b,a]` or null to clear; equal/absent-clear is an eventless no-op |
| `removeMaster` | `{id}` | `{ok}` | cascade-removes every layout of the master (with their placeholders) and clears slide `layout_id` bindings to those layouts; slide content untouched; one undo entry |
| `addLayout` | `{master,name}` | `{layout_id}` | `master` must be an existing master id; ≤256 layouts deck-wide; one undo entry |
| `renameLayout` | `{id,name}` | `{ok}` | equal name is an eventless no-op preserving redo |
| `removeLayout` | `{id}` | `{ok}` | clears slide `layout_id` bindings to it; slide content untouched; one undo entry |
| `setSlideLayout` | `{slide,layout}` | `{ok}` | slide = id; `layout` is an existing layout id or null/omitted to clear the binding; equal rebind is an eventless no-op; DATA ONLY — no master content is applied to the slide |
| `addPlaceholder` | `{layout,kind,x,y,w,h,label,inherit_theme?}` | `{placeholder_id}` | `layout` must exist; `kind` is the bounded catalog `title|body|image|media|date|footer|pageNumber`; bounds per the Placeholder contract; `label` non-blank ≤128 bytes; ≤64 placeholders per layout; id from `next_id`; one undo entry |
| `updatePlaceholder` | `{layout,id,kind?,x?,y?,w?,h?,label?,inherit_theme?}` | `{ok}` | partial in-place patch retains placeholder id and position; merged result re-validated; equal/empty patch is an eventless no-op preserving redo |
| `removePlaceholder` | `{layout,id}` | `{ok}` | unknown placeholder id → NotFound |
| `addTheme` | `{name,colors?,fonts?}` | `{theme_id}` | name non-blank ≤128 UTF-8 bytes; `colors` is an optional object of OOXML color slots (`dk1|lt1|dk2|lt2|accent1..accent6|hlink|fol_hlink`) → `[r,g,b,a]`, `fonts` an optional object of font slots (`major_latin|minor_latin`) → non-blank ≤128-byte family names; unknown slots reject; ≤32 themes; id from `next_id`; one undo entry; theme data emits the schema:6 snapshot wrapper |
| `renameTheme` | `{id,name}` | `{ok}` | equal name is an eventless no-op preserving redo |
| `setThemeColor` | `{id,slot,color}` | `{ok}` | `slot` is a bounded color slot; `color` `[r,g,b,a]` or null/omitted to clear the slot; equal/absent-clear is an eventless no-op |
| `setThemeFont` | `{id,slot,font}` | `{ok}` | `slot` is `major_latin|minor_latin`; `font` non-blank ≤128-byte string or null/omitted to clear; equal/absent-clear is an eventless no-op |
| `removeTheme` | `{id}` | `{ok}` | removing the deck-bound theme clears `deck_theme`; other bindings untouched; one undo entry |
| `setDeckTheme` | `{theme}` | `{ok}` | `theme` is an existing theme id or null/omitted to clear the deck→theme binding; equal rebind is an eventless no-op; DATA ONLY — no theme is applied to slides/masters/layouts |
| `deckTheme` | `{}` | `{theme_id,theme}` | read-only; `theme_id` is the bound theme id or null, `theme` the resolved `DeckTheme` or null |
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
| `setSlideTransition` | `{slide,kind,duration_ms?,direction?}` | `{ok}` | slide = id; stores slide-transition DATA for the host to animate — the engine never renders transitions. `kind` admits `fade|slideLeft|slideRight|slideUp|slideDown|wipe|zoom`; `kind:"none"` clears (same as `clearSlideTransition`). `duration_ms` required for non-none kinds, integer 1..=60000; `direction` optional `left|right|up|down` hint (meaningful for `wipe`). Validated before mutation; equal patch is an eventless no-op that preserves redo; transitions follow slide identity on reorder and die with the slide |
| `clearSlideTransition` | `{slide}` | `{ok}` | removes the slide's transition; absent is an eventless no-op |
| `slideTransition` | `{slide}` | `{transition:SlideTransition\|null}` | read-only transition data; `null` when unset |
| `setSlideTiming` | `{slide,duration_ms,advance}` | `{ok}` | slide = id; per-slide rehearsal/advance timing — `duration_ms` integer 1..=3600000 is the slide dwell time (rehearsal clock and auto-advance delay when `advance:"after"`); `advance` is `manual|after`. Validated before mutation; equal patch is an eventless no-op; timing follows slide identity and dies with the slide |
| `clearSlideTiming` | `{slide}` | `{ok}` | removes the slide's timing override; absent is an eventless no-op |
| `slideTiming` | `{slide}` | `{timing:SlideTiming\|null}` | read-only timing; `null` when the slide uses host-default timing |
| `setMorphName` | `{slide,object,name}` | `{ok}` | slide/object = ids; tags the object with a morph name (non-blank <=128 UTF-8 bytes) for host-side morph matching across adjacent slides under a `"morph"` transition. Names are unique per slide — a duplicate on the same slide rejects; the same name on different slides is the intended pairing. Equal re-tag is an eventless no-op; one undo entry; the tag dies with its object and morph data emits the schema:5 snapshot wrapper. DATA ONLY — no morph interpolation or rendering |
| `clearMorphName` | `{slide,object}` | `{ok}` | removes the object's morph tag; absent tag or unknown ids → NotFound for unknown ids, eventless no-op for absent tag |
| `addText` | `{slide,x,y,w,h,text,font_size?}` | `{object_id}` | |
| `setText` | `{slide,id,text}` | `{ok}` | |
| `setTextStyle` | `{slide,id,font_size?,bold?,italic?,color?}` | `{ok}` | Text objects only. Partial patch preserves omitted fields/content/geometry. Font size finite and >0; bold/italic strict booleans; color four integer RGBA channels 0..255. Explicit null invalid. Validated before mutation; one history entry/event only for a changed style. Empty/equal patch preserves redo and emits no event. |
| `addRect` | `{slide,x,y,w,h,fill}` | `{object_id}` | |
| `addShape` | `{slide,kind,x,y,w,h,fill?,stroke?}` | `{object_id}` | `kind` is the bounded preset set `rect|roundedRect|ellipse|triangle|diamond|line|arrow|star`; `fill` optional `[r,g,b,a]` (absent/null = no fill), `stroke` optional `{width,color:[r,g,b,a]}` with width finite >0 <=10,000; validated before mutation; same 4096-object/identity caps as `addRect`; one undo entry; new kinds/strokes emit the schema:4 snapshot wrapper |
| `addConnector` | `{slide,from,to,route?,arrows?,stroke?}` | `{object_id}` | `from`/`to` are `ConnectorEnd`s (`{type:"free",x,y}` or `{type:"bound",object_id,side}`); `route` defaults `"straight"`, `arrows` defaults `"none"`, `stroke` optional bounded outline; bound ends must reference existing non-connector objects on the slide; validated before mutation; same 4096-object/identity caps; one undo entry; connectors emit the schema:4 snapshot wrapper |
| `updateConnector` | `{slide,id,from?,to?,route?,arrows?,stroke?}` | `{ok}` | Partial in-place patch on a connector object; `from`/`to` replace the whole endpoint, `stroke:null` clears the outline, omitted fields preserve; bound ends re-validated (existing non-connector target, no self-bind); equal/empty patch is an eventless no-op preserving redo; one history entry/event only for actual change |
| `addMedia` | `{slide,src,kind,x,y,w,h,mime?,poster?,trim_in_ms?,trim_out_ms?,volume?,fit?,autoplay?,loop?,muted?,show_controls?,hide_when_stopped?}` | `{object_id}` | `kind` is `"video"|"audio"`; spec fields are flattened next to geometry. Stores bounded media METADATA ONLY — no decode/playback/pixels (host-side). `src`/`poster` bounded non-empty ≤4096 UTF-8 bytes, `mime` ≤128, trim ms 0..=86,400,000 with in<=out, `volume` 0..=1, `fit` `contain|cover|stretch`, flags strict booleans. `w,h > 0` required (media has real bounds). Validated before mutation; same 4096-object/identity caps; one undo entry; media emits the schema:4 snapshot wrapper |
| `updateMedia` | `{slide,id,src?,kind?,mime?,poster?,trim_in_ms?,trim_out_ms?,volume?,fit?,autoplay?,loop?,muted?,show_controls?,hide_when_stopped?}` | `{ok}` | Partial in-place patch on a media object mirroring `updateConnector`: omitted fields preserve, explicit `null` clears an optional field, `src`/`kind` replace the reference/kind (null invalid for both); the merged spec is re-validated (trim ordering, bounds); equal/empty patch is an eventless no-op preserving redo; one history entry/event only for actual change |
| `addChart` | `{slide,x,y,w,h,chart}` | `{object_id}` | `chart` is the embedded spec `{kind,title?,x_axis_label?,y_axis_label?,show_legend?,show_data_labels?,series:[{id,label,points:[{x,y}]}]}` mirroring the NYC-Tron `SheetChartSpec`/`SheetChartSeries` contract minus the sheet-source fields (`range`/`seriesIn`/`hasHeader`/`hasXValues`). `kind` is the bounded `line|column|area` catalog; 1..=32 series with unique non-blank ids <=64 UTF-8 bytes, non-blank labels <=128 bytes, 1..=1024 points per series, <=4096 points total, point x/y finite within ±1e12; `title`/axis labels non-blank <=128 bytes when present, flags strict booleans. `w,h > 0` required (real bounds: move/resize/rotate apply). DATA ONLY — the engine stores bounded embedded data and never renders charts; hosts draw from the spec. Validated before mutation; same 4096-object/identity caps; one undo entry; chart objects emit the schema:7 snapshot wrapper |
| `updateChart` | `{slide,id,chart}` | `{ok}` | Partial in-place patch on a chart object mirroring `updateMedia`: every spec field optional inside `chart`, omitted fields preserve, `series` replaces the whole series array, explicit `null` clears an optional text/flag field, `kind` replaces the chart kind (null invalid); the merged spec is re-validated; equal/empty patch is an eventless no-op preserving redo; one history entry/event only for actual change |
| `addTable` | `{slide,x,y,w,h,table}` | `{object_id}` | `table` is the embedded spec `{rows,cols,cells?}` — the bounded subset of the NYC-Tron `VirtualSpreadsheetGrid`/`TableCellLayout` contract (per-cell layout and formulas deferred). `rows` 1..=100, `cols` 1..=26, `cells` sparse `[{row,col,value}]` with 0-based indices inside the grid, unique (row,col) pairs, <=1024 cells; cell `value` is a non-blank string <=128 UTF-8 bytes, a finite number within ±1e12, or a boolean (null/blank cells are absent). `w,h > 0` required. DATA ONLY — the engine stores bounded embedded data and never renders tables; hosts draw from the spec. Validated before mutation; same 4096-object/identity caps; one undo entry; table objects emit the schema:7 snapshot wrapper |
| `updateTable` | `{slide,id,table}` | `{ok}` | Partial in-place patch on a table object: `rows`/`cols` replace the dimensions, `cells` replaces the sparse cell set (explicit `null` clears to empty), omitted fields preserve; the merged spec is re-validated so cells cannot survive outside shrunk dimensions; equal/empty patch is an eventless no-op preserving redo; one history entry/event only for actual change |
| `addImage` | `{slide,x,y,w,h,src}` | `{object_id}` | |
| `moveObject` | `{slide,id,x,y}` | `{ok}` | rejects connector objects (geometry resolves from endpoints); media/chart/table objects move normally |
| `setObjectOrder` | `{slide,id,to}` | `{ok}` | Absolute bottom-to-top object index within the slide; atomic undo; same-index request preserves history; animation references retain identity |
| `resizeObject` | `{slide,id,w,h}` | `{ok}` | w,h > 0; rejects connector objects; media/chart/table objects resize normally |
| `rotateObject` | `{slide,id,degrees}` | `{ok}` | rejects connector objects; media/chart/table objects rotate normally |
| `removeObject` | `{slide,id}` | `{ok}` | also drops its animations and any connectors bound to it — cascade-dropped connectors take their own animations with them (free-endpoint connectors survive) |
| `addAnimation` | `{slide,object,kind,start_s,duration_s,trigger?}` | `{index}` | duration > 0 |
| `addTriggeredAnimationV1` | same as `addAnimation` | `{index}` | explicit-trigger alias; old engines reject the unknown name rather than silently dropping `trigger` |
| `updateAnimation` | `{slide,index,kind?,start_s?,duration_s?,trigger?}` | `{ok}` | Partial in-place patch retains target object and list position. Existing index required; admitted effect kinds, finite start/delay >=0 and finite duration >0, both ≤86400; explicit null invalid. Validate before mutation, one history entry/event only for actual change; empty/equal patch preserves redo and emits no event. Trigger updates are validated against the complete candidate timeline; list order is unchanged. |
| `updateTriggeredAnimationV1` | same as `updateAnimation` | `{ok}` | explicit-trigger alias; old engines reject the unknown name |
| `removeAnimation` | `{slide,index}` | `{ok}` | staged validation; reject if a first relative animation would lose its predecessor |
| `slideAt` | `{slide,t_s,click_times?:number[]}` | `{objects:[{id,x,y,w,h,rotation,opacity}],schedule:[{index,start_s:number|null,end_s:number|null}]}` | read-only deterministic evaluation; missing click dependencies remain null/pending |
| `slideAtWithClicksV1` | same as `slideAt` | same as `slideAt` | explicit click-history alias; old engines reject the unknown name rather than silently ignoring `click_times` |
| `slideScene` | `{slide,t_s?,click_times?}` | `{slide,index,background,size,layout,layout_id,notes,ink_count,transition,timing,objects,animations,schedule?}` | read-only STRUCTURED scene description, data only: NO pixels or thumbnail bitmap (the engine has no rasterizer; hosts render filmstrip/canvas from this, the NYC-Tron `SlideSummary`/`SlideObject` filmstrip contract is a projection of these fields). `objects` are bottom-to-top z-order, each the stored `Obj` payload plus `z` and, on connectors, the same `resolved` polyline `describe` emits; `animations` is the verbatim program. Optional `t_s` (finite; `click_times` allowed only with it, an explicit `click_times` without `t_s` rejects) adds per-object `frame` = that object's `slideAt` entry verbatim plus top-level `schedule`; omitted `t_s` yields static geometry only. `ink_count` reports persistent-ink presence without duplicating stroke payloads (full strokes stay on `slideInk`/`describe`). No journal, no events, no state change |
| `slideNotes` | `{slide}` | `{notes:string\|null}` | read-only speaker notes for the slide id; `null` when unset |
| `deck` | `{}` | `{title,slide_count}` | read-only |

Undo: prior slide/object/animation state, including speaker notes and ink.

Legacy snapshots without size default to 960×540; invalid sizes reject restore before replacing state. Canvas adapters read persisted size.

Section count is at most 1024; labels are nonblank and at most 1024 UTF-8 bytes. IDs are positive, distinct and below `next_section_id`, with that counter within 1..9007199254740991. Every boundary starts at a distinct existing slide. Add/update validates the full candidate before one journal entry/event; failures consume no identities or redo history. Reordering carries boundaries with their start-slide IDs. Single/bulk slide deletion removes boundaries whose start slides are removed in the same undo step; no silent reassignment. Restore validates section identities/counter/labels/references before replacing state/history. Pinned alpha.4 slide controls have no section props/mutation callbacks; typed operations and read metadata do not imply default UI activation.

Trigger is `{type:"absolute"}` (legacy default, omitted when encoding), `{type:"on-click",click_index:0..255}`, `{type:"with-previous"}` or `{type:"after-previous"}`. Absolute preserves start_s from slide appearance. Other modes treat start_s as delay: click time+delay, immediately previous list entry's resolved start+delay, or its end+delay. First relative entries reject. Explicit host click_times must be a finite ordered prefix of actual slide-relative timestamps, at most256 entries in0..86400; no times are generated. Missing click slots remain pending and propagate through dependent entries. All resolved starts/ends must remain within86400 seconds. Updates/removals/object cleanup validate before mutation; deleting a predecessor that leaves the first entry relative rejects atomically. Other relative entries reanchor to the previous surviving list entry.

Progress p clamps linear `(t−resolvedStart)/duration` to0..1; pending means p=0. FadeIn multiplies opacity byp; SlideInLeft also translates x from−200 to0; ZoomIn center-scales0.5→1 and multiplies opacity byp. Pulse uses center-scale `1+0.2*(1−abs(2p−1))`; Spin adds360p degrees; FadeOut multiplies opacity by1−p; ZoomOut center-scales1→0.5 and multiplies opacity by1−p. Effects on a repeated object compose in declaration order, with multiplicative opacity and sequential geometry, including pending entrance contributions. Exit/emphasis contributions are neutral before their start. This is a declared supported evaluator, not full presentation-software compatibility.

Animation evaluation caps at4096 objects/animations per slide; references and object identities validate, effects are grouped per object for bounded work, and nonfinite composed output rejects rather than emitting invalid geometry. Restore validates timelines/targets before replacing state; missing triggers preserve legacy absolute semantics. SlideAt copies host click history through the typed API and remains history-free.

`slideScene` (P14 slice 12) is the per-slide structured scene read for host rendering: one call returns the slide chrome (background, layout, layout binding, notes, ink count, transition, timing), the complete bottom-to-top object inventory with stored geometry and every per-kind payload (text/fill/stroke/src, connector spec plus resolved polyline, media/chart/table specs, morph tag), and the verbatim animation program. When `t_s` is supplied it additionally embeds each object's `slideAt`-evaluated `frame` (`{id,x,y,w,h,rotation,opacity}`) and the resolved `schedule`, reusing the same evaluator so frame geometry, opacity and pending-click semantics cannot drift from `slideAt`. HONESTY BOUNDARY: structured description only. The engine has no rasterizer and returns no pixels or thumbnail bitmap; actual pixel output remains the host's job (the existing Prism `flatten` path, as the animation-pixels e2e demonstrates). `slideScene` is read-only: no journal entry, no `document:changed`, no state change, and it rejects unknown slide ids, non-finite `t_s`, unordered click histories and `click_times` without `t_s`.

The pinned alpha.4 SlideAnimationPane supports effect/add/remove but lacks timing/trigger edit callbacks. The adapter offers all seven real effects, retains nonabsolute sourceTrigger metadata and refuses to bind that old pane over triggered programs rather than mislabel relative delays as absolute starts. Typed engine APIs/readPitchSlideAt accept explicit click history. No fake preview timer, host UI activation or new Pitch renderer is provided. Actual CPU pixel integration is checked through the existing Prism renderer.

Explicit trigger intent uses `addTriggeredAnimationV1` / `updateTriggeredAnimationV1`; explicit click histories (including empty) use `slideAtWithClicksV1`. These aliases share current implementation semantics, but old engines reject their unknown names instead of silently ignoring new fields. The typed facade keeps legacy operation names when new arguments are omitted. Snapshots using nondefault deck size, section metadata/counter, nonabsolute triggers or new effects (without notes/ink) use an engine-local JSON `{kind:"pitch",schema:2,document:PitchState}` wrapper inside unchanged NFD1 framing; any document carrying slide speaker notes, non-empty slide ink, a slide transition or slide timing uses `{kind:"pitch",schema:3,document:PitchState}` instead; any document carrying a shape preset beyond `rect`/`image`/`text`, an object `stroke`, a connector, a media object/spec, any master/layout/placeholder definition or a slide `layout_id` binding uses `{kind:"pitch",schema:4,document:PitchState}``; any document carrying a `"morph"` transition kind or an object `morph_name` tag uses `{kind:"pitch",schema:5,document:PitchState}`; any document carrying a deck theme definition or a `deck_theme` binding uses `{kind:"pitch",schema:6,document:PitchState}`; any document carrying a chart or table object with embedded bounded data uses `{kind:"pitch",schema:7,document:PitchState}``. Root `meta` is absent so legacy readers fail rather than silently discard fields, and schema:2 readers reject schema:3 payloads, schema:≤3 readers reject schema:4 payloads, schema:≤4 readers reject schema:5 payloads, schema:≤5 readers reject schema:6 payloads and schema:≤6 readers reject schema:7 payloads rather than dropping notes/ink/transitions/timing/shapes/strokes/connectors/media/masters/layouts/placeholders/layout bindings/morph tags/themes/chart-table data (new `ObjKind` variants already fail closed as unknown variants, but the additive `stroke`/`connector`/`media`/`morph_name`/`themes`/`deck_theme`/`chart`/`table` fields do not, which is why shapes/strokes/connectors/media take schema:4, morph data takes schema:5, themes take schema:6 and chart/table data takes schema:7 rather than reusing earlier wrappers). Readers accept legacy root payloads and schema:2, schema:3, schema:4, schema:5, schema:6 and schema:7 wrappers, strictly validating wrapper kind/schema/keys before replacement; persisted empty-string notes normalize to absent, matching `setNotes` semantics. Legacy-feature-only documents keep the existing payload shape. Older unwrapped extended snapshots remain readable, but already-lost metadata cannot be recovered. P20 still requires matching reader/writer/runtime versions before activation; no old-reader forward-compatible roundtrip is claimed.

## quill-engine — `QuillEngine::new()`

State `{ next free n/a, blocks: [Block], bookmarks: [{name,block,offset}], comments: [Comment], styles: [StyleDef], sections: [Section] }`,
`Comment = { id, from:{block,offset}, to:{block,offset}, author?:string, body:string, resolved:bool }` — a range-anchored note; `from`/`to` are live positions re-mapped by edits like bookmarks (from is left-gravity, to right-gravity, so typing at either boundary extends the range; a fully deleted span collapses to the deletion start).
`Block = { kind:"para"|"h1"|"h2"|"h3"|"list"|"quote"|"table", inlines:[Inline], list?:{level:0..8,definition:{id,kind,levels:[9]}}, style_id?:string, table?:Table }`,
`Table = { rows, cols, cells:[TableCell] }` row-major with exactly `rows*cols` cells, carried by a `kind:"table"` block whose `inlines` is empty and which has no `list`/`style_id`,
`TableCell = { blocks:[Block] }` — a cell's own paragraph list (1..=64 `kind:"para"` blocks only: no other kinds, no nested `table` payload, no `list`, no `style_id`).
`StyleDef = { id, name, kind:"paragraph"|"character", properties }` where `properties` is a partial inline-style object in the `applyStyle` grammar.
`Section = { block, page:PageSetup, header_footer:HeaderFooter }` sorted by
`block` (first block index; section 0 always starts at block 0),
`PageSetup = { width,height,orientation:"portrait"|"landscape",margin_top,margin_bottom,margin_left,margin_right,columns,column_gap,start:"continuous"|"next-page"|"even-page"|"odd-page" }` in points,
`HeaderFooter = { header?,footer?,first_header?,first_footer?,even_header?,even_footer?,different_first,different_odd_even,page_numbers,number_start?,number_format:"decimal"|"roman"|"letters",link_previous }`.
`Inline = { text, style:{ bold,italic,underline,strike: bool, color?:hex str,
link?:url } }`. Positions `{ block, offset }` (offset = char index within block's
concatenated text). Ranges `{ start:Pos, end:Pos }`, `end` exclusive.

| op | payload | data | notes |
|---|---|---|---|
| `new` | `{}` | `{ok}` | one empty para |
| `insertText` | `{at:Pos,text}` | `{ok}` | inherits style of char to the left (or right if at 0); `\n` splits block; rejects table blocks (use `setCellText`) |
| `deleteRange` | `{from:Pos,to:Pos}` | `{deleted_text}` | cross-block merges survivors; rejects ranges starting on a table block (a covering range deletes it); cell text is not covered |
| `replaceRange` | `{from:Pos,to:Pos,text}` | `{deleted_text}` | `deleteRange` then `insertText` at `from` as one command; validates before mutating; one undo entry |
| `changeCase` | `{from:Pos,to:Pos,mode}` | `{from:Pos,to:Pos}` | modes lower/upper/sentence/capitalize; style-preserving Unicode scalar conversion, adjusted selection end; atomic one undo entry, unchanged/collapsed is eventless |
| `applyStyle` | `{from,to,style:{bold?,italic?,underline?,strike?,color?,link?,font_family?,font_size?,highlight?}}` | `{ok}` | re-splits inlines at range bounds; `font_family` string sets direct Latin family, null clears; 1–128 non-control characters, nonblank; `font_size` is 1–1638 points in half-point increments, null clears; `highlight` is exact `#RRGGBB` run background, null clears (DOCX explicit RGB shd only) |
| `setBlockKind` | `{block,kind}` | `{ok}` | Leaving list kind clears membership; entering legacy list kind uses the explicit bullet0 default below; rejects table blocks (`"table"` is not an accepted kind here — use `insertTable`) |
| `setListKind` | `{first,last,kind:"none"|"bullet"|"numbered"|"multilevel"}` | `{ok}` | Atomic inclusive block range; changing kind creates an independent definition, retaining existing levels; same kind is eventless. None clears membership. |
| `setListFormat` | `{first,last,level:0..8,format,start?,indent_twips?,hanging_twips?}` | `{ok}` | Updates each complete definition touched by selected list paragraphs in one undo. Formats bullet/decimal/lowerLetter/upperLetter/lowerRoman/upperRoman. |
| `shiftListLevel` | `{first,last,direction:1|-1}` | `{ok}` | One definition; canonical nesting policy: first item stays0, indent at most one below predecessor, all levels remain0..8. |
| `insertBlock` | `{index,kind?}` | `{block_index}` | |
| `splitBlock` | `{at:Pos}` | `{new_block_index}` | rejects table blocks |
| `mergeBlock` | `{index}` | `{ok}` | merge into previous; rejects ranges touching a table block |
| `text` | `{from?,to?}` | `{text}` | plain text, `\n` between blocks |
| `findText` | `{query,from?,to?,case_sensitive?}` | `{matches:[{from:Pos,to:Pos,text}],count}` | read-only; non-overlapping per-block matches, never spanning a block boundary; case-insensitive by default |
| `replaceText` | `{query,replacement,from?,to?,case_sensitive?}` | `{replaced}` | replace every non-overlapping match in range atomically: staged validation, one journal entry, one `document:changed`; replacement inherits each match's first-scalar style and must not contain newlines; `replaced` counts applied edits, so zero matches or unchanged text is eventless and reports 0 |
| `addBookmark` | `{name,pos:Pos}` (`at`/`anchor` accepted aliases) | `{ok,name}` | unique name, 1–64 non-blank non-control scalars, ≤1024 bookmarks |
| `removeBookmark` | `{name}` or `{pos:Pos}` | `{ok,name}` | exactly one selector; unknown name/position rejects |
| `listBookmarks` | `{}` | `{bookmarks:[{name,pos:Pos}]}` | read-only; sorted by position then name |
| `insertSection` | `{at:block, page_setup?, header_footer?}` | `{ok,section}` | `at` is a block index (1..block count, not an existing start); the new section copies the owning section's page/header-footer then applies the optional partial patches (Word "link to previous"); ≤128 sections |
| `removeSection` | `{section}` | `{ok}` | deletes the boundary; its blocks merge into the previous section, which keeps its settings; section 0 cannot be removed |
| `setPageSetup` | `{section, width?,height?,orientation?,margin_top?,margin_bottom?,margin_left?,margin_right?,columns?,column_gap?,start?}` | `{ok,section}` | partial patch on one section; merged result must satisfy bounds (width/height 36..14400pt, margins/gap ≥0, columns 1..32 int, margins+gaps leave positive text area) or the whole op rejects; equal values eventless |
| `setHeaderFooter` | `{section, header?,footer?,first_header?,first_footer?,even_header?,even_footer?,different_first?,different_odd_even?,page_numbers?,number_start?,number_format?,link_previous?}` | `{ok,section}` | partial patch; bodies are plain text ≤8192 chars, string sets / null clears; number_start 1..1000000 or null; equal values eventless |
| `listSections` | `{}` | `{sections:[{index,block,page,header_footer}]}` | read-only; document order |
| `defineStyle` | `{id,name,kind:"paragraph"|"character",properties}` | `{ok,id}` | durable named style; id unique, 1–64 non-blank non-control scalars, ≤256 defs; `properties` uses the `applyStyle` grammar |
| `updateStyle` | `{id,name?,properties?}` | `{ok,id}` | replaces named fields; never propagates to already-styled content; no fields → eventless |
| `removeStyle` | `{id}` | `{ok,id}` | deletes def and clears `style_id` refs on blocks atomically; copied inline props remain |
| `listStyles` | `{}` | `{styles:[StyleDef]}` | read-only; sorted by id |
| `addComment` | `{id,from:Pos,to:Pos,author?,body,resolved?}` | `{ok,id}` | range-anchored comment; id unique token 1–64 non-blank non-control scalars, ≤1024 comments; body non-blank plain text ≤8192 chars (newlines allowed), author ≤128 chars; `from == to` anchors a point |
| `updateComment` | `{id,author?,body?}` | `{ok,id}` | replaces named fields; `author:null` clears; anchors are not re-pointable; no effective change eventless |
| `removeComment` | `{id}` | `{ok,id}` | unknown id rejects |
| `resolveComment` | `{id}` | `{ok,id}` | sets `resolved:true`; already-resolved eventless |
| `reopenComment` | `{id}` | `{ok,id}` | sets `resolved:false`; already-open eventless |
| `listComments` | `{}` | `{comments:[{id,from,to,author,body,resolved}]}` | read-only; sorted by anchor position then id |
| `applyNamedStyle` | `{style_id,from,to}` (`id`/`style` accepted aliases) | `{ok}` | `"character"` kind only; copies properties onto range inlines like `applyStyle` — present props overwrite (null clears), absent props untouched; snapshot copy, no live link |
| `setBlockStyle` | `{block,style_id}` (`style_id` string or null; `id`/`style` aliases) | `{ok}` | `"paragraph"` kind only; sets `Block.style_id` and stamps properties onto the block's inlines; null clears only the reference; rejects table blocks |
| `insertTable` | `{index,rows,cols}` (`at` accepted alias for `index`) | `{ok,block_index}` | inserts one `kind:"table"` block; every cell starts with one empty paragraph; rows 1..=64, cols 1..=26, ≤256 tables/doc; anchors shift like `insertBlock` |
| `deleteTable` | `{block}` | `{ok}` | removes the table block; the doc must keep ≥1 block; bookmarks on it are removed, comment endpoints clamp to the deletion point, a section boundary starting on it merges away |
| `setCellText` | `{block,row,col,text}` | `{ok}` | replaces the cell's blocks with plain `para`s: `\n` splits, ≤64 blocks, ≤8192 chars; empty text → one empty paragraph; equal content eventless |
| `listTables` | `{}` | `{tables:[{block,rows,cols}]}` | read-only; document order |
| `describeTable` | `{block}` | `{block,rows,cols,cells:[[text]]}` | read-only; row-major grid of cell plain text (paragraphs joined `\n`) |
| `blocks` | `{}` | full structure | read-only |
| `layout` | `{page_width,font_size}` | `{pages:[{lines:[{block,start,end}]}]}` | greedy wrap; avg glyph width 0.5em (h1=1.4x h2=1.25x h3=1.1x); block keeps its page |
| `exportDocx` | `{}` | `{bytes_b64}` | Real ZIP; list paragraphs use numPr/ilvl/numId plus numbering.xml, its document relationship and content-type override; rejects documents containing table blocks (DOCX table export deferred) |
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

`findText`/`replaceText` share one search grammar: `query` is a nonempty string matched against each block's concatenated inline text as Unicode scalar offsets (the documented position unit — not UTF-16 units or grapheme clusters). `from`/`to` are optional `Pos` bounds defaulting to document start/end, validated like other ranges; only matches fully inside `[from,to)` count, and a match clipped by a bound is not reported. Matching is per-scalar: case-sensitive compares scalars exactly, case-insensitive (the default) compares each scalar's default Unicode lowercase expansion, so a scalar whose lowercase expands never matches a single other scalar. Matches are non-overlapping (after a hit, scanning resumes at the match end) and never span block boundaries — block text contains no `\n`, so a query containing `\n` simply matches nothing. `replaceText` stages the whole replacement on a cloned block list, validates list coherence, then commits one full-document journal entry and one `document:changed`; an empty `replacement` deletes matches, and zero matches or a replacement identical to the matched text is eventless with no journal entry and reports `replaced:0`. No snapshot schema change.

`addBookmark`/`removeBookmark`/`listBookmarks` implement named zero-width marks at `{block,offset}` positions (Unicode scalar offsets, the same unit as `Pos`). Names are unique per document (exact case-sensitive match), 1–64 non-blank characters without control characters, at most 1024 bookmarks. Design decision — position stability: blocks carry no identity, so bookmarks store a live `{block,offset}` mark re-anchored by every mutating op rather than a content anchor or block id. Marks have right gravity: a mark stays attached to the character after it, so text inserted exactly at a mark lands before the mark. The deterministic per-op rules: `insertText` shifts same-block marks at/after the insertion point right by the inserted length, and a `\n`-containing insert moves tail marks into the last new block after the final segment; `deleteRange` shifts later marks, clamps marks inside the deleted span to the deletion start, and removes marks whose whole block is deleted; `splitBlock` moves marks at/after the split to the tail block; `mergeBlock`/`insertBlock` shift block indices; `replaceRange` and `replaceText` compose delete+insert semantics so a mark at or inside a replaced span lands just after the replacement text; `changeCase` re-anchors marks through per-scalar case expansion; `new`/`importDocx` clear marks and batches carry them through staged edits. Bookmark ops and every position-moving edit record undo entries that restore the bookmark list in both directions; style/kind/list-metadata ops cannot move marks and leave them untouched on undo/redo. `listBookmarks` is read-only and eventless. `describe` and `blocks` return block structure only and never include bookmarks; `listBookmarks` is the bookmark accessor.

`defineStyle`/`updateStyle`/`removeStyle`/`listStyles`/`applyNamedStyle`/`setBlockStyle` implement durable named styles. A `StyleDef` is `{id,name,kind,properties}`: `id`/`name` are unique-ish tokens (id unique, 1–64 non-blank non-control scalars), `kind` is `"paragraph"` or `"character"`, and `properties` is a partial inline-style object validated with the exact `applyStyle` grammar (including null-clears) on define, update, use, and restore. Design decision — snapshot semantics, not live styles: applying a style copies its properties at that moment and stores no link back to the definition, so `updateStyle`/`removeStyle` never rewrite already-styled content (documented divergence, matching the backlog's "named bundle" scope; live-update propagation is deferred). Precedence: `applyNamedStyle` overwrites only the properties present in `properties` — a present key wins over the existing inline value (including `null` clears and `false` flags), an absent key leaves the inline value untouched; afterwards the copied values are ordinary direct formatting indistinguishable from `applyStyle` output. `setBlockStyle` requires `"paragraph"` kind, records `Block.style_id`, and stamps the same properties onto every inline in the block; `style_id:null` clears only the reference and never reverts stamped properties. `removeStyle` deletes the definition and clears `style_id` references atomically in one undo entry. Structural ops carry `style_id` with their block: `splitBlock`/`insertText` `\n`-splits give both halves the reference, `mergeBlock` keeps the head block's, and deleted blocks drop theirs. Kind mismatches reject (`applyNamedStyle` needs `"character"`, `setBlockStyle` needs `"paragraph"`); `describe`/`blocks` expose `style_id` per block while `listStyles` is the definition accessor. `new`/`importDocx` clear definitions and references; batches carry them through staged edits as one undo entry.

`insertSection`/`removeSection`/`setPageSetup`/`setHeaderFooter`/`listSections` implement durable sections, page setup, and headers/footers (P12 slice 4, model/ops half). A `Section` owns the blocks from its `block` start up to the next section's start; boundaries are live block indices re-anchored by every block-count-changing op with the same rigor as bookmarks — `insertText` `\n`-splits and `insertBlock` shift later starts, `splitBlock` shifts starts after the split block, `deleteRange`/`mergeBlock` drop a boundary whose anchor block is deleted (the section merges into the previous one, matching Word's deleted-section-break behavior) and shift the rest, and `changeCase`/`replaceText`/style/list ops cannot move boundaries. `insertSection` requires `at` in 1..block count and not an existing start, copies the owning section's page setup and header/footer (link-previous semantics baked into the copy), then applies optional `page_setup`/`header_footer` partial patches; `removeSection` deletes a nonzero boundary and keeps the previous section's settings; both record undo like other collection ops. `setPageSetup`/`setHeaderFooter` are partial patches validated as a merged whole — page fields follow the NYC-Tron `PageSetupPanel` bounds (points, 36..14400 page, 1..32 columns, margins+gaps leave positive text area) and header/footer bodies follow the `HeadersFootersEditor` contract (six optional plain-text bodies ≤8192 chars, different-first/odd-even flags, page-number fields); no fields or equal values are eventless. Section ops, edits, and batches carry the section list through staged clones as one undo entry; `new`/`importDocx` reset to the single default section. `describe`/`blocks` stay block-only; `listSections` is the accessor. Deferred honestly: no layout/pagination consumes page setup (`layout` keeps its own parameters), no DOCX `sectPr` import/export, no header/footer rendering, and link-previous/inheritance is stored metadata resolved by consumers, not computed.

`addComment`/`updateComment`/`removeComment`/`resolveComment`/`reopenComment`/`listComments` implement durable range-anchored comments (P12 slice 5). A `Comment` is `{id,from,to,author?,body,resolved}` where `from`/`to` are `{block,offset}` positions in the same scalar-offset unit as `Pos`; `from == to` anchors a point. Ids are unique tokens (1–64 non-blank non-control scalars), at most 1024 comments; bodies are non-blank plain text ≤8192 chars (newlines allowed); authors are optional, ≤128 non-control chars. Design decision — anchor stability: blocks carry no identity, so each endpoint is a live position re-mapped by every position-moving op with the same rigor as bookmarks, but with split gravity so typing at either boundary extends the range: `from` is left-gravity (an insert exactly at `from` stays put, pulling the new text inside) and `to` is right-gravity like a bookmark mark. `insertText` shifts endpoints past the insertion and `\n`-splits carry them into the tail blocks; `deleteRange` shifts/clamps endpoints and an endpoint inside a fully deleted span clamps to the deletion start, so a comment whose whole range is deleted collapses to a point rather than dropping; `splitBlock`/`mergeBlock`/`insertBlock` move endpoints across block boundaries; `replaceRange` composes delete+insert on the staged clone; `replaceText` re-anchors each endpoint through the per-block match spans (`from` keeps left gravity at a match start, `to` keeps bookmark right gravity, and endpoints strictly inside a match land after the replacement); `changeCase` maps endpoints through the same per-scalar source→output offset table bookmarks use. Comment ops, edits that move anchors, and batches carry the comment list through staged clones and before-image undo entries exactly like bookmarks/styles/sections; style/kind/list/section ops cannot move positions and leave comments untouched on undo/redo. `updateComment` replaces `body`/`author` only — anchors are never re-pointable by an op; `resolveComment`/`reopenComment` flip `resolved` and are eventless when already in that state. `new`/`importDocx` clear comments (DOCX comment import/export is deferred). `describe`/`blocks` stay block-only; `listComments` is the accessor, sorted by anchor position then id. Deferred honestly: no threading/replies, no timestamps or authorship beyond the stored strings (the engine is I/O-free with no clock), no DOCX `comments.xml` subset yet, and no consumer resolves anchor→pixel geometry.

`insertTable`/`deleteTable`/`setCellText`/`listTables`/`describeTable` implement block-model tables (P12 slice 7-A). A table is a single `kind:"table"` block in the top-level stream carrying `Table {rows,cols,cells}` — a dense row-major grid where each `TableCell` holds its own paragraph `blocks` (each cell gets one empty paragraph at insert). Design decision — why a block kind: the table occupies exactly one slot in `blocks`, so every position-anchored collection keeps its existing `{block,offset}`/`{block}` model with zero new anchor types; `insertTable` reuses the `insertBlock` remap (marks/boundaries at or after the index shift one), and `deleteTable` applies single-block-delete rules (bookmarks on the table are removed, comment endpoints clamp to the deletion point — start of the following block or end of the previous when last — and a section boundary starting on it merges into the previous section). Cell text is unreachable by `Pos`, so `setCellText` (the only cell-content op this slice) cannot move any top-level anchor and records a plain block-splice undo entry. Cell paragraphs are restricted to strict plain `para` blocks: any other `kind` (headings, quote, list — with or without list metadata — and nested tables), `list`, `style_id`, and any stray `table` payload are all rejected on restore (cell paragraphs carry no `style_id`/`list`/stray `table` payload and their inlines receive the same restore validation as top-level inlines — `setCellText` is the only op that writes them, produces `Block::empty(Para)` paragraphs with default-style text, and no `Pos` op can reach inside a cell). The table block itself carries nothing but its payload: `inlines` must be empty (only offset 0 is a valid `Pos` on it), and `list`/`style_id` are rejected (`setBlockStyle` refuses table blocks, so a reference is unreachable by design). Per-cell ≤64 blocks, document-wide ≤65536 cell blocks re-validated by `setCellText` before commit, ≤8192 chars per `setCellText`. Guards keep the invariant `kind=="table" ⇔ table payload present`: `insertText`/`splitBlock`/`mergeBlock`/`setBlockKind`/`setBlockStyle`/`deleteRange`-from reject table blocks, a `deleteRange`/`mergeBlock`/`setListKind` that would swallow one rejects atomically (list ops re-validate the merged candidate), `exportDocx` rejects documents containing tables rather than dropping cell content, and `findText`/`replaceText`/`text`/`layout`/`applyStyle`/`changeCase` treat a table block as an empty block — cell text is not searched, styled, cased, exported, or laid out this slice. `describe`/`blocks` expose the `table` payload per block; `listTables`/`describeTable` are the dedicated accessors. Deferred honestly: row/column insert/delete, cell merge/split, per-cell or table styling, nested tables, in-cell find/replace and rich cell editing (styles, lists, kinds inside cells), `text`/`layout` cell coverage, DOCX table import/export (`w:tbl`), and any consumer geometry. Schema: **no bump** — every snapshot tier deserializes `Block.kind` through the `BlockKind` enum, so schema≤3 and legacy readers fail closed on the unknown `"table"` variant instead of silently dropping the payload, the same fail-closed guarantee a schema:4 wrapper would give; the `table` field itself is serde-optional and omitted when absent.

Snapshots containing any explicit list membership use an engine-specific JSON wrapper `{kind:"quill",schema:2,document:{blocks:[...]}}` inside the unchanged NFD1 envelope. There is no root blocks field, so pre-list Quill readers fail closed rather than silently discarding unknown list fields. The current reader validates wrapper kind/schema/shape and the complete document before replacing live state/history; foreign/future/malformed wrappers reject. Snapshots without explicit list metadata keep the exact legacy `{blocks:[...]}` shape, including legacy kind:list defaults. Documents with bookmarks use `{kind:"quill",schema:3,document:{blocks:[...],bookmarks:[{name,block,offset}]}}`, emitted only when bookmarks exist (a document with both lists and bookmarks uses schema:3). Named styles join the same schema:3 wrapper — no schema bump, since schema:3 already gates pre-feature readers — emitted when bookmarks, comments, styles, non-default sections, or any `Block.style_id` exist; the document gains an optional `styles:[StyleDef]` key that is omitted when empty so bookmark-only schema:3 payloads stay byte-identical. Sections take the same schema:3 wrapper with no schema:4 bump: the schema:3 document is `deny_unknown_fields`, so a `sections` key already fails schema:3-era readers closed, and the key is emitted only when the section list differs from the single default section so bookmark/style-only payloads stay byte-identical; the reader treats an absent `sections` key as the default section, strictly validates an explicit list (1..=128 sections, strictly increasing starts, first at block 0, in-range blocks, page/header-footer bounds), and schema:2/legacy payloads carrying a `sections` key reject rather than silently dropping. Comments take the same schema:3 wrapper with no schema:4 bump, for the same reason sections needed none: the schema:3 document is `deny_unknown_fields`, so a `comments` key already fails schema:3-era readers closed rather than silently dropping them; the key is emitted only when comments exist so earlier schema:3 payloads stay byte-identical, the reader defaults an absent `comments` key to empty, and schema:2/legacy payloads carrying a `comments` key reject rather than silently dropping. The schema:3 reader strictly validates wrapper kind/schema/keys plus every bookmark name/uniqueness/position, every comment id/uniqueness/author/body grammar and ordered in-range anchors, and every style id/name/kind/properties grammar plus each `style_id` reference (must name a `"paragraph"` style) before replacing state; `bookmarks` stays a required document field while `styles`/`comments` default empty so earlier schema:3 snapshots still restore, schema:2 and legacy payloads restore with empty collections, `bookmarks`/`styles`/`comments`/`sections` keys outside schema:3 reject rather than silently dropping, and pre-feature readers fail closed on `schema != 2`/`!= 3`. No global envelope version or checkpoint/native tag changes.

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

NFD1 header/format remains unchanged; JSON payload carries `kind:"motion",schema:2` (schema:1 snapshots restore unchanged). Motion appends native/checkpoint tag 8 after Photo7; prior tags are unchanged. Versioning policy: snapshots always serialize the current `schema:N`; restore accepts `1..=N` and fills additive fields (`kind`, `parent_id`, `comp_id`, `blend`, `clipped`, `matte`, `effects`, `compositions`, `next_comp_id`) with serde defaults, inferring layer `kind` from content on schema:1 payloads only — schema:2 writers always emit `kind`, so a schema:2 payload missing it rejects on restore rather than being inferred. The first real mutation bumps a restored schema:1 document to schema:2; net-unchanged writes preserve the marker. Persistent composition owns width/height/duration/rational frame rate, monotonic safe-integer layer/key/comp IDs and bottom-to-top shape, immutable-raster or nested-composition layers. Layers contain exactly one `shape` (legacy rect/ellipse), `asset_id` or `comp_id`, never a placeholder; `kind` records which. Defaulted `assets:{}`/`next_asset_id:1`/`compositions:{}`/`next_comp_id:1` preserve old snapshots; empty/initial fields are omitted only from snapshot encoding. `describe` always materializes all four, matching the required SDK response. Every layer owns visible/locked/name, Prism-style pivoted 2D transform, opacity, scalar curves for tx/ty/sx/sy/rotation/ox/oy/opacity, an optional same-composition `parent_id` transform parent, an optional W3C `blend` mode and a `clipped` flag, and, for comp layers, the instantiated `comp_id`. Curves use hold/linear/Bezier keys with absolute time/value handles evaluated against the containing composition's own duration; exact key times resolve that key, outside keyed intervals holds endpoints, empty curves use layer base values. Bezier time is inverted, not substituted as its parameter.

| Op | Payload | Result | Notes |
| --- | --- | --- | --- |
| `new` | `{title?,width?,height?,duration_s?,frame_rate?}` | `{ok}` | Defaults640×360/10s/30fps, replaces document atomically. |
| `describe` | `{}` | full state | Read only. |
| `setComposition` | `{title?,width?,height?,duration_s?,frame_rate?}` | `{ok}` | Proposed duration must contain every retained key. |
| `addShapeLayer` | `{name?,shape:{kind:"rect"|"ellipse",x,y,w,h,fill:[r,g,b,a]},comp?}` | `{layer_id}` | Uses real Prism rendering; `comp` selects the containing composition (omitted/0 = root). |
| `addRasterAsset` | `{width,height,format:"rgba8-straight-srgb",pixels_b64?}` or owned binary input | `{asset_id}` | Immutable packed RGBA, exactly one byte source; strict bounded canonical base64. |
| `readRasterAsset` | `{id}` | `{id,width,height,format,pixels_b64?}` plus requested binary output | Read-only original owned bytes, including hidden RGB at alpha0. |
| `removeRasterAsset` | `{id}` | `{ok}` | Rejects any live layer reference in any composition. |
| `addRasterLayer` | `{asset_id,name?,comp?}` | `{layer_id}` | References an existing asset; native asset dimensions must fit the containing composition. |
| `addComposition` | `{name?,width?,height?,duration_s?}` | `{comp_id}` | Creates an empty nested composition (defaults 640×360, root duration, root frame rate); at most 16. |
| `duplicateComposition` | `{id}` | `{comp_id}` | Deep copy with fresh layer/key identities; parent links remapped inside the copy, name suffixed " copy". |
| `addCompLayer` | `{comp,name?,into?}` | `{layer_id}` | Instances composition `comp` as a layer inside `into` (omitted/0 = root); referenced comp dimensions must fit the container. |
| `removeComposition` | `{id}` | `{ok}` | Rejects while any comp layer references it; deletes the composition and its layers. |
| `setLayerParent` | `{layer,parent}` | `{ok}` | `parent` is a layer id or null; transform-only inheritance within one composition, rejects cross-composition/self/cyclic parents. |
| `reparentLayer` | `{layer,comp,index}` | `{ok}` | Moves a layer to composition `comp` (0 = root) at `index` after removal; cross-composition moves clear the layer's and its children's `parent_id` links. |
| `setLayerBlend` | `{layer,blend}` | `{ok}` | `blend` is one of the 13 W3C mode names (`normal`,`multiply`,`screen`,`overlay`,`darken`,`lighten`,`color-dodge`,`color-burn`,`hard-light`,`soft-light`,`difference`,`exclusion`,`add`) or null; null/`"normal"` clears to source-over. Applies to shape, raster and comp layers alike. |
| `setLayerClipped` | `{layer,clipped}` | `{ok}` | `clipped` boolean; a clipped layer renders only through the alpha of the nearest unclipped sibling below it in the same composition (consecutive clipped layers share that base's clip run). The bottom layer of a composition cannot be clipped; `setLayerOrder`/`removeLayer`/`reparentLayer` that would leave a clipped layer at the bottom reject atomically. |
| `setLayerMatte` | `{layer,matte}` | `{ok}` | `matte` is `{source_layer,mode,feather?,enabled?}` or null to clear. `source_layer` must be another layer in the same composition; `mode` is `alpha`, `alpha-inverted`, `luma` or `luma-inverted`; `feather` defaults 0 and is bounded 0..=64; `enabled` defaults true (`false` stores without masking). Locked targets reject; self, cross-composition, unknown and cyclic matte chains reject atomically, as do `removeLayer`/`reparentLayer`/`setLayerOrder`/`removeComposition`/`duplicateComposition` outcomes that would strand a matte reference. |
| `setLayerEffects` | `{layer,effects}` | `{ok}` | `effects` is a full-replacement array of typed effect objects (at most 16) or null/[] to clear. Kinds: `invert`, `grayscale`, `brightness{amount}` (-1..=1), `contrast{amount}` (0..=4 linear-light factor), `gaussian-blur{radius_px}` (0..=64), `fill{color:[r,g,b,a],opacity?}` (opacity 0..=1, default 1). Locked layers reject; unknown kinds, unknown fields and out-of-range params reject atomically, and `validate` re-checks bounds on restore. |
| `updateLayer` | `{id,name?,visible?,locked?,shape?,asset_id?,transform?:{tx?,ty?,sx?,sy?,rotation?,ox?,oy?},opacity?}` | `{ok}` | Locked layers require a separate unlock before editing; content kind is stable, raster reference may target another valid immutable asset (revalidated for existence and containing-composition fit like `addRasterLayer`; `asset_id:null` or an unknown/oversized asset rejects atomically). |
| `removeLayer` | `{id}` | `{ok}` | Removes owned curves; locked layer rejected. |
| `setLayerOrder` | `{order:[id,...]}` | `{ok}` | Exact unique permutation within the one composition owning that id set, identities retained. |
| `setPropertyKeys` | `{layer,property,keys:[{id?,time,value,interpolation,in_handle,out_handle}]}` | `{key_ids}` | Complete property-curve replacement in whichever composition holds the layer; known IDs must belong to that curve, omitted IDs allocate; empty clears. Handles nullable `{time,value}`. |
| `evaluate` | `{time_s}` | `{layers,compositions}` | Actual evaluated 2D state, read only; `layers` is the root, `compositions` maps each comp id to its metadata plus evaluated layers at the duration-scaled local time. Curves are cleared in output. `transform` values are layer-local — `parent_id` composition is applied only by `renderFrame`. Time within root composition. |
| `renderFrame` | `{time_s}` | `{width,height,pixels_b64?}` + binary output if requested | Ephemeral Prism scene composites actual RGBA; comp layers render through their own ephemeral Prism scene at their own dimensions/rate and composite as raster pixels honoring transform/opacity/visibility and transform-parent inheritance. No encoder/export queue. |

Nested compositions: at most 16 compositions plus the root, nesting depth at most 8 comp levels below the root, references acyclic (enforced in validate/restore for every comp, referenced or not), and a referenced composition's width/height must fit its containing composition (same rule as raster assets). A comp layer's local time is `parent_time * child.duration_s / parent.duration_s` clamped to the child duration — proportional mapping that telescopes to `root_time * leaf.duration_s / root.duration_s` along any chain; there is no wrap or offset. `evaluate` reports each comp once at its root-relative scaled time; `renderFrame` applies the mapping per instance. Transform parenting (`parent_id`) inherits only the parent's evaluated transform chain (outermost-first affine composition); opacity, visibility and curves do not inherit, and a chain whose composed affine requires shear fails rendering with a validation error rather than approximating. The composed effective transform must also decompose within Prism's transform bounds (scale magnitude 1e-6..1e4): individually valid parent/child scales can compose outside that range, in which case `renderFrame` fails validation on an otherwise valid document — a documented limitation, not state corruption. `evaluate` reports each layer's local (uncomposed) transform for the same reason; consumers needing world transforms must compose `parent_id` chains themselves. Removing a layer or moving it across compositions clears `parent_id` links that would dangle; `duplicateComposition` allocates fresh layer/key IDs and preserves `comp_id`/`asset_id` references. `setLayerOrder` targets whichever single composition (root included) owns the exact id set. There is no `updateComposition`/rename op yet — a nested composition's name, dimensions, duration and frame rate are fixed at creation (documented gap).

Blend modes and clipping map onto Prism's compositing inside each composition's ephemeral scene: `blend` passes the 13 W3C mode names through to Prism `setLayerBlend` (`"normal"`/`null` is the absent default, so blend-free layers serialize byte-identically to pre-B1 snapshots), and `clipped` passes to Prism `setClipped`, which masks a layer to the alpha of the nearest unclipped sibling below it in the same flat composition scene — the After Effects track-matte direction, where consecutive clipped layers form one clip run off the same base. Clipping is screen-space: `parent_id` transform inheritance affects geometry only and never changes clip scope, and a hidden clip base hides its whole run (Prism parity). Motion enforces the sibling-below rule in `validate`, so `setLayerOrder`, `removeLayer` or `reparentLayer` that would strand a clipped layer at the bottom of its composition reject atomically. Both fields are additive with serde defaults and `skip_serializing_if` unset values, so `schema` stays 2: schema:1 and pre-B1 schema:2 snapshots restore unchanged, and documents not using the features emit identical layer JSON — only snapshots that actually set `blend`/`clipped` carry the new keys (older binaries reject those via `deny_unknown_fields`, the accepted cost of staying on schema:2 per the slice-A additive policy).

Track mattes (`Layer.matte`, slice B2) follow the same additive policy: `matte` is `Option<LayerMatte>` with serde defaults, `schema` stays 2, and matte-free layers serialize identically to pre-B2 snapshots. A matte names another layer in the same composition as its mask source; `validate` requires the source to exist in that composition, rejects self-references and any cycle in the matte chain (counting disabled mattes too), and bounds chains at 8 edges so render recursion terminates. `setLayerMatte` enforces the same rules at op time plus the locked-layer check, and every structural op (`removeLayer`, `reparentLayer`, `setLayerOrder`, `removeComposition`, `duplicateComposition`) revalidates the whole state, so operations that would strand a matte reference reject atomically; `duplicateComposition` remaps matte sources to the copy's fresh layer identities like `parent_id`. Ordering semantics are After Effects-like at the composite step: when a layer's matte is enabled, the source layer's subtree is rendered standalone into an ephemeral Prism scene at the containing composition's dimensions — its evaluated transform (including `parent_id` inheritance), opacity, visibility and its own matte apply, while sibling blend modes and clipping do not (a lone staged layer has no siblings) — flattened to straight RGBA, and converted per mode: `alpha` reads the alpha channel, `alpha-inverted` complements it, and `luma`/`luma-inverted` read premultiplied Rec.601 luminance (`0.299R+0.587G+0.114B` scaled by alpha, so transparent pixels contribute 0) with the inverted mode complementing the result. The derived `width*height` mask is uploaded to the target's Prism layer via `addMask`/`paintMask`, feathered in Prism by `refineMask` when `feather`>0 (the same approximate-Gaussian feather as Prism masks, hard-bounded at 64px by `validate`), and multiplies the target layer's own alpha inside Prism's `render_layer` — before layer opacity, blend mode and clipping composite it against the layers below, so a matte interacts correctly with `blend`/`clipped`/`parent_id`. Unlike After Effects, which consumes the matte layer, the matte source layer still renders normally in the stack at its own position — there is currently no way to use a layer purely as a matte without it also drawing (a documented gap; `enabled:false` stores a matte without masking, and an invisible matte source yields an empty mask that hides the target — unlike After Effects, which falls back to the layer below, Motion applies no fallback; the source-exists rule is unconditional, so `removeLayer`/`reparentLayer` on a disabled matte's source still rejects). Matte chains compose: a matte source's own enabled matte applies while its subtree renders for the mask, and `matte_depth` resets at every composition boundary so worst-case matte recursion is `MAX_COMP_DEPTH`(8) comp renders × `MAX_MATTE_DEPTH`(8) matte hops — several hundred MB of transient mask buffers at the 1MP raster cap. Painted/raster masks on matte sources are deferred; matte sources are whole layers, not sub-regions.

Layer effect stacks (`Layer.effects`, slice C) follow the same additive policy: `effects` is a `Vec<LayerEffect>` with serde defaults, `schema` stays 2, and effect-free layers serialize identically to pre-C snapshots. Each entry is an internally tagged object (`{"kind":..., ...params}`) deserialized with a hand-rolled strict reader, so unknown kinds and unknown fields reject rather than being dropped. The v1 registry is bounded CPU passes over the layer's rendered straight-alpha RGBA at containing-composition dimensions: `invert` and `grayscale` (ITU-R 601) touch RGB only and leave alpha and hidden RGB semantics consistent with Prism/Photo precedents; `brightness` is Prism's additive -1..=1 amount; `contrast` reuses the photo develop linear-light math around the 0.18 pivot with a 0..=4 factor; `gaussian-blur` is three separable box-blur iterations on premultiplied RGBA (the same approximation as Prism's mask feather, alpha blurred with color, radius bounded at 64px); `fill` replaces RGB with `color`, scales alpha by `color[3]` and lerps the whole pixel toward that result by `opacity`. Rendering is rasterize-then-process-then-upload: a layer with a non-empty stack renders its content subtree plus evaluated transform (including `parent_id` inheritance) into an ephemeral canvas-sized Prism scene — shape, raster and comp layers alike, comp layers flattening their nested render first — the flattened RGBA runs the passes in stack order on the CPU, and the result uploads as a raster layer at canvas origin with identity transform. Ordering is After-Effects-like at the composite step: effects run AFTER the layer's own render including its transform (post-transform, canvas-space pixels), and BEFORE layer opacity, blend mode, clipping and matte, which still composite in the parent scene exactly as for effect-free layers; a matte source's own effects therefore feed its derived mask. Effects force rasterization — every effected layer costs one extra ephemeral scene plus up to 16 full-canvas CPU passes per frame, bounded by the 1-megapixel canvas cap, 16 effects/layer and 128 layers total; there is no GPU path and no per-effect enable/bypass flag (remove the entry instead). Each effected layer's uploaded raster is canvas-sized, so `validate` counts every layer with a non-empty stack (asset-backed or not, counted once when both) toward the same per-composition canvas-storage budget as raster layers: at most 16 canvas-raster layers and `width*height*4*count ≤ 16 MiB`, i.e. at most four effected layers on a 1-megapixel composition — worst-case transient scene memory is therefore bounded near 16 MiB of layer rasters plus per-effect scratch. Per-effect CPU cost is one full-canvas pass for `invert`/`grayscale`/`brightness`/`contrast`/`fill`, while `gaussian-blur` is six separable box-blur passes (three horizontal + three vertical iterations) plus two `width*height*4` f32 scratch buffers — 32 MiB transient at the 1MP cap per blur effect. Effect stacks are self-contained (no cross-layer references), so strand rules do not apply; undo/redo treat the whole stack atomically like every other layer field.

Whole proposed state validates before one journal/event on actual change; equal/empty writes and net-unchanged shared `__batch` preserve redo/events (schema marker ignored for equality). Sixteen Arc/COW history entries, 16MiB serialized state cap; width/height1..4096 and <=1,048,576 output pixels per composition, <=128 layers total across all compositions and <=128 curves, <=10,000 keys/curve and <=100,000 total. Duration finite >0..604800s per composition, keys separated >=1e-6s; rational frame rate num1..240000/den1..1001 with quotient1..240. RGBA channels are bytes; geometry finite/positive extents bounded1e7, transform translation/origin/rotation ±1e7, scale magnitude1e-6..1e4 with keys/handles retaining base sign, opacity0..1. Handles must stay in their adjacent time segments/property range. IDs positive and below their next counter, counters <=9007199254740991. Names/title <=512 UTF-8 bytes. Restore validates full kind/schema/state (including comp graph acyclicity/depth and per-comp budgets) before replacing document/history. Render tasks checkpoint between layers (including inside nested comp renders) and before/after synchronous Prism flatten; no cancellation within the compositor is claimed. Only addRasterAsset admits binary input; other unsolicited sidecars reject. No 3D, spring, painted layer mask, expression, particle, media decoder or encoded queue is implemented; the bounded CPU layer effect stack above is the only admitted effect form.

Raster assets declare packed straight-alpha sRGB RGBA8 (`rgba8-straight-srgb`); no codec/ICC/de-premultiplication is inferred. Positive width/height≤4096, one megapixel/4 MiB per asset, at most16 assets and4 MiB decoded total. Encoded length/padding/alphabet and declared aggregate are checked before RGBA decode allocation, then canonical bytes/exact length and full proposed state validate before publication. Snapshots serialize owned Arc buffers as base64 inside unchanged schema1/NFD1; asset IDs are unique positive safe integers below their defaulted next counter. No pixel-update operation exists: new pixels create a new identity. Referenced assets cannot be removed.

Prism raster layers use canvas-sized backing: referenced asset dimensions must fit composition dimensions, and shrinking below them rejects atomically. At most16 raster layers — plus any layer with a non-empty effect stack, which uploads the same canvas-sized raster — with logical current canvas storage count×width×height×4≤16 MiB; this is not a peak-RSS guarantee because the ephemeral Prism journal may retain previous canvases/regions. Assets/history/header changes share immutable Arc buffers. Render materializes the actual Prism addRasterLayer + binary drawPixels upload, applies the existing pivot/transform/opacity/visibility/keyframe path and composites real pixels. Fully transparent assets are valid, including nonzero pivots. Typed JSON-only hosts synchronously own the exact Uint8Array/Buffer subview and encode it before any await; native FFI uses the existing owned Command.input path. No optional Host binary shim or borrowed caller buffer is introduced.

## design-engine — `DesignEngine::new()` (fixed-frame layout slice)

Registered Design/design at appended checkpoint/native ordinal9 after Motion8; prior ordinals stay unchanged. Snapshot NFD1 JSON owns `kind:"design",schema:1,title,next_id,nodes` for schema-1-only documents, plus optional `variables`/`modes`/`active_mode`/`bindings` collections when present. Root node1 is a fixed canvas frame; all other nodes form one ordered acyclic tree of frames/rectangles/ellipses/text/component/instance nodes. Coordinates use document units; per-axis fixed/hug/fill modes are evaluated with bounded dependencies. Constraints are stored on absolute children only — C1/C2 admit and validate h/v anchors, extent bounds, the aspect-lock flag and parent/sibling `relative_to` targets but do not solve them (`evaluateLayout` ignores constraints). Components and instances are admitted (slice D): instances expand deterministically at read/render time only. No prototype runtime, images, clipping, groups or layers; text nodes are layout boxes only (no glyph rendering).

Snapshot versioning is presence-triggered, matching the quill/pitch/draft precedent: when any node has `kind:"text"` or a `text` style or `constraints`, any node is `kind:"component"`/`"instance"` or carries `variants`/`instance`, or any variable/mode/binding state exists, `snapshot()` emits `{kind:"design",schema:2,document:<internal schema:1 state>}` inside the unchanged NFD1 envelope; otherwise it emits the bare schema:1 state byte-identically. The same schema:2 wrapper covers every feature family to date — no schema:3 bump was needed because the wrapper already fails old readers closed and the internal state's new node kinds/fields are `deny_unknown_fields`/enum-gated. `restore` accepts strict `kind:"design",schema:2` wrappers (unknown wrapper fields/kind/schema reject) or bare schema:1 state, and rejects unwrapped state that contains text, constraints, component/instance or variable features so old readers fail closed on `kind:"text"`/`text`/`constraints`/`kind:"component"`/`kind:"instance"`/`instance`/`variants`/`variables` rather than silently dropping them. `describe`/`evaluateLayout` always expose the internal schema:1 state shape regardless of the snapshot wrapper. Removing the last text node and clearing every variable feature returns snapshots to the bare schema:1 form. The C2 constraint fields (`min_width`/`max_width`/`min_height`/`max_height`/`aspect_locked`, plus widened `relative_to` targets) are additive serde defaults inside `NodeConstraints`, which is `deny_unknown_fields`: they ride the same schema:2 wrapper with no schema:3 bump because absent fields serialize identically and old readers fail closed on the new keys rather than silently dropping them.

| Op | Payload | Result | Notes |
| --- | --- | --- | --- |
| `new` | `{title?,width?,height?}` | `{ok}` | Replaces document with an empty root canvas; defaults640×360. |
| `setComposition` | `{title?,width?,height?}` | `{ok}` | Root must be editable; canvas dimensions positive integers. |
| `describe` | `{}` | full state | Read only. |
| `addFrame` | `{parent,name?,x?,y?,width?,height?,fill?,visible?}` | `{node_id}` | Parent must be an editable frame. Defaults0,0/100×100/transparent. |
| `addShape` | same + `kind:"rect"|"ellipse"` | `{node_id}` | Real Prism shape primitives. |
| `addText` | `{parent?,name?,x?,y?,width?,height?,fill?,visible?,content,style?}` | `{node_id}` | `parent` defaults to root1; parent must be an editable frame. `content` is a required string ≤64KiB UTF-8 (only `\n`/`\t` control chars admitted). `style` is a partial font patch `{font_family?,font_size?,font_weight?,font_style?}` merged over defaults (`sans-serif`,16,400,`normal`); font_family 1..256 UTF-8 bytes without control chars, font_size finite >0..1e4, font_weight integer1..1000, font_style `normal`|`italic`. Defaults0,0/100×100/transparent fill. Creates a `kind:"text"` node; text nodes cannot own children or layout. |
| `updateNode` | `{id,name?,x?,y?,width?,height?,fill?,visible?,locked?,text?}` | `{ok}` | Root geometry uses setComposition. Locked node requires a separate lock-only unlock; locked ancestors block it. `text` is a partial TextStyle patch (`{content?,font_family?,font_size?,font_weight?,font_style?}`) merged over the node's current style; `null` is reserved and always rejected (a text node cannot exist without a style, and non-text nodes reject `text` outright). It requires a `kind:"text"` node and rejects on other kinds. A `text` field combined with other patch fields does not count as a lock-only unlock. `kind` itself is immutable. |
| `setFrameLayout` | `{id,layout:null|{direction:"row"|"column",wrap?:boolean,gap,padding_top,padding_right,padding_bottom,padding_left,align:"start"|"center"|"end"|"stretch",justify:"start"|"center"|"end"|"space-between"}}` | `{ok}` | Complete flow settings; null restores absolute child positioning. |
| `setAxisSizing` | `{id,axis:"x"|"y",mode:"fixed"|"hug"|"fill",value?}` | `{ok}` | Numeric value only for fixed. A transition to fixed without value freezes current evaluated size; explicit fixed value resizes. |
| `readAxisSizing` | `{id}` | `{x,y}` axis capability records | Read only; actual candidate admission supplies canHug/canFill and mode reasons. |
| `setChildOrder` | `{parent,order:[id,...]}` | `{ok}` | Exact unique permutation of existing direct children. |
| `reparentNode` | `{id,parent,index}` | `{ok}` | Index in destination after removal; retains authored local coordinates; rejects cycles. |
| `removeNode` | `{id}` | `{ok}` | Deletes subtree; root cannot be removed; every descendant must be editable. Also drops bindings on removed nodes. |
| `defineMode` | `{id?,name}` | `{ok}` | `id` optional, engine assigns `mode-N`; ≤128 modes, id ≤128 bytes, name ≤256 bytes without control chars. |
| `renameMode` | `{id,name}` | `{ok}` | Renames an existing mode. |
| `removeMode` | `{id}` | `{ok}` | Removes the mode, strips that mode's entry from every variable's `values`, and moves `active_mode` to the first remaining mode (or none). |
| `defineVariable` | `{id?,name,type,values?}` | `{ok}` | `type` is `"number"|"string"|"boolean"`; `values` is an optional sparse `{mode:VariableValue}` map. `id` optional, engine assigns `var-N`; ≤1024 variables. `VariableValue` is `{kind:"number"|"string"|"boolean",value}` or `{kind:"alias",variable_id}`; numbers finite ±1e9, strings ≤64KiB. |
| `setVariableValue` | `{id,mode,value}` | `{ok}` | Sets one mode's value; `mode` must exist. Alias targets are validated atomically: no cycles, target must share the variable's type, target must carry a value in that mode, and the chain must end in a literal of the declared type (the NYC-Tron `validateAlias` contract). |
| `removeVariable` | `{id}` | `{ok}` | Removes the variable and every binding referencing it. |
| `setActiveMode` | `{id}` | `{ok}` | `id` must be an existing mode. |
| `describeVariables` | `{}` | `{modes,active_mode,variables,bindings}` | Read-only and silent. Per variable: raw `values`, `resolved` literals per stored mode, and `problems` (alias faults, missing active-mode value). Bindings carry `resolved` numbers in the active mode. |
| `bindVariable` | `{node_id,path,variable_id}` | `{ok}` | Binds a number variable to a closed `BindPath` enum: `fill_r/g/b/a`, `gap`, `padding_top/right/bottom/left`, `x`,`y`,`width`,`height`. Requires an editable node; `gap`/`padding_*` need a frame, `x`/`y` need a non-root node with absolute placement, `width`/`height` need fixed sizing on that axis and are rejected on the root canvas (node1), whose geometry is setComposition-only. Rebinding the same path replaces the variable. |
| `unbindVariable` | `{node_id,path}` | `{ok}` | Removes the binding; absent bindings are a silent no-op. |
| `listBindings` | `{node_id?}` | `{bindings:[{node_id,path,variable_id,resolved}]}` | Read-only and silent; optional node filter. |
| `setConstraints` | `{id,constraints:null|{horizontal,vertical,min_width?,max_width?,min_height?,max_height?,aspect_locked?,relative_to?}}` | `{ok}` | `horizontal` is `"left"\|"right"\|"center"\|"stretch"\|"scale"`, `vertical` is `"top"\|"bottom"\|"center"\|"stretch"\|"scale"` (NYC-Tron `DesignConstraints` axes; `stretch` is the both-edges anchor). The optional C2 extent bounds are finite document-unit values in 0..=1e7 per axis and `min<=max` when both ends of an axis are present; `aspect_locked` is the NYC-Tron `aspectLocked` flag (no ratio is stored — a solver derives it from geometry at enforcement time); `relative_to` is an optional numeric node id mapping NYC-Tron `relativeToId` and may name the parent frame or a sibling (a node sharing the same parent), never the node itself — absent means the parent. Anchors are admitted only on absolute children: the node must be editable, non-root, and its parent must not use flow layout. `scale` anchors reject with "scale constraint anchoring is not supported" until the solver slice; out-of-range/inverted bounds and `relative_to` targets outside the parent/sibling scope reject with distinct reasons. `null` clears. Because validation is whole-document, `setFrameLayout` to flow, `reparentNode` under a flow parent, or `removeNode` of a `relative_to` target also rejects while a constrained node would be stranded. Equal writes are silent no-ops. C1/C2 store constraints only — `evaluateLayout`/`renderFrame` do not solve them, and x/y variable bindings keep overlaying evaluated position independently (bindings win for geometry; constraints carry no geometry yet). Deferred: `scale` anchors, grandparents/arbitrary-node `relative_to` targets, stored aspect ratios, and all solving/enforcement. |
| `readConstraints` | `{id?}` | `{solving:"storage-only",accepted,rejected,nodes:[{node_id,constraints,enforced:false}]}` | Read-only and silent; optional node filter. Lists only nodes carrying constraints; each `constraints` object echoes the stored fields (absent optional members omitted). `accepted`/`rejected` report the admitted anchor set, the parent/sibling `relative_to` scope and the extent-bound rules (`scale`, out-of-scope `relative_to` and invalid bounds rejected). |
| `createComponent` | `{id,name?,variants?}` | `{ok}` | Converts an existing non-root frame subtree into a `kind:"component"` definition; its children/layout become the instance template. `variants` is an optional list of `{name,properties:[NodeOverride]}` named override bundles (names unique per component, ≤256 bytes). Frames and components may parent children; instances cannot. |
| `updateComponent` | `{id,name?,variants?}` | `{ok}` | Requires a component node. `name` renames; a present `variants` array replaces the whole bundle list (`[]` clears). Absent fields are unchanged. |
| `createInstance` | `{component,parent?,name?,x?,y?,width?,height?,fill?,visible?,locked?,variant?,overrides?}` | `{node_id}` | Creates a `kind:"instance"` leaf (no stored children/layout; fixed sizing only — instance hug/fill is deferred). Box fields default from the component root node; `parent` defaults to root1 and must be a frame or component. `variant` names one of the component's variant bundles; `overrides` is a list of `{node,path,value}` targets inside the component subtree (the component root id targets the expanded instance root). |
| `updateInstance` | `{id,variant?,overrides?}` | `{ok}` | Requires an instance node. `variant` present sets the bundle name (`null` clears); `overrides` present replaces the whole list (`null`/`[]` clears). Absent fields are unchanged; equal writes are silent no-ops. |
| `detachInstance` | `{id}` | `{ok}` | Materializes one instance's current expansion as ordinary nodes: the instance keeps its id and becomes a `kind:"frame"` carrying the expanded (variant+override-applied) fields, and every expanded descendant is re-identified under fresh `next_id` values (nested instances detach to frames recursively; variant targets on cloned component nodes are re-identified too). Bindings do not follow clones; undo/redo work normally. |
| `describeComponents` | `{}` | `{expansion,components,instances}` | Read-only and silent. `components` lists `{id,name,variants:[{name,properties}]}`; `instances` lists `{id,name,component,variant,overrides,unavailable_reason?}` for the NYC-Tron tree/variant-picker contracts. `expansion` reports `{max_depth:8,max_nodes:16384,persisted:false}`. When the document currently exceeds a read expansion bound, every instance reports that bound's message as `unavailable_reason` instead of failing the op. |
| `evaluateLayout` | `{}` | `{boxes:[{id,kind,x,y,width,height,fill,visible,renderable}]}` | Read-only world-space preorder boxes over the *expanded* state: instances contribute their own box plus deterministic synthetic-id (`>= 2^53-1`) clones of the component subtree with variant/instance overrides applied. Synthetic ids are read-only handles — ops reject them as unknown nodes. `renderable:false` marks text nodes. |
| `renderFrame` | `{}` | `{width,height,pixels_b64?}` + binary output if requested | Actual ephemeral Prism RGBA scene over the same expanded state as `evaluateLayout`; no encoder/file delivery. Text nodes render their fill as a plain rect background only — glyphs are never drawn (real text rendering is a Prism/font-metrics gate). Component and instance boxes rasterize as plain rects. |

Absolute children use parent origin plus local x/y. Flow overrides child x/y in computed output, evaluates axis sizes, and applies padding/gap, cross-axis alignment and main-axis distribution. Stretch overrides evaluated cross size without changing stored size. Extra main space is nonnegative; overflowing fixed children retain size and start from leading padding. Center/end may overflow cross-axis bounds. Hidden nodes still occupy flow space and validate; visibility is inherited. Frames do not clip descendants. Every computed box, including hidden boxes, must satisfy Prism's finite ±1e7 coordinate/positive size constraints. Effective nested frame padding must leave positive content size. These checks precede mutation and restore.

Lock is authored edit permission on a node and its descendants, not a frozen world-space result: unlocked ancestor layout/reparent/order operations can reposition locked descendants. Separate unlock admits only the locked field; subtree removal checks every descendant. Root new/restore/history remain full-document lifecycle operations.

Wrapping defaults false for legacy schema1 snapshots; false is omitted when serializing, preserving the original nonwrap representation. True requires the updated reader. When true, ordered fixed children greedily form lines against padded main size; exact fits stay on the line and an oversized item occupies its own visibly overflowing line. Each line gets the maximum authored cross size of its children; align (including stretch) applies within that line, justify applies independently per line, and gap also separates lines. Wrapped lines start from leading cross padding without cross-line distribution. Hidden children still participate. No clamp or wrap-driven persistent resize occurs.

Whole candidate validation precedes one history/event entry; equal writes and net-equal atomic batches preserve redo/events. Sixteen Arc/COW history states, <=1024 nodes, <=64 parent edges, <=512-byte names/title, safe-integer IDs below next counter, 8MiB encoded state. Local x/y bounded1e6; positive fixed/evaluated sizes bounded1e7; gap/padding0..100000. Root width/height1..4096 and <=1,048,576 pixels before allocation. Restore checks kind/schema/tree/bounds/evaluated geometry before replacing state/history. Render tasks checkpoint between nodes and before/after synchronous Prism flatten; no inside-compositor interruption is claimed. Binary input, app activation and native rebuilt support remain outside this slice.

Sizing defaults to `{x:"fixed",y:"fixed"}` for old nodes and is omitted when both fixed. Width/height retain their authored values during hug/fill; direct width/height updates require fixed mode. `readAxisSizing` returns mode, value (current evaluated size for hug/fill, authored scalar for fixed), fixedValue, resolvedValue, canHug/canFill, optional unavailableReason (root/locked ancestry), and hugReason/fillReason from actual whole-candidate validation. Capability probes validate the authored candidate state while `value`/`resolvedValue` come from the binding-resolved effective overlay, so `canHug`/`canFill` can report true even when a resolved value still makes `evaluateLayout` fail. Root remains a fixed canvas edited through setComposition. Rect/ellipse have no intrinsic content and cannot hug. Empty hugged frames use0.001 intrinsic content units plus layout padding, allowing last-child removal. Absolute hug takes positive trailing extents from its anchored origin; negative leading children remain visible overflow rather than moving the origin.

Nonwrap main-axis hug sums resolved child extents/gaps/padding; cross hug uses the maximum intrinsic child extent. Fill requires definite parent content space: nonwrap flow main fill children share positive remaining space equally after fixed/hug siblings and gaps; cross fill takes content extent, and absolute fill takes parent content extent minus local offset. Exhausted/nonpositive remainder rejects atomically. Parent stretch still overrides effective cross size for legacy fixed children; nonwrap descendant fill sees that effective stretched parent size. Cross hug under parent stretch rejects; hug/stretch parents measure fixed children's intrinsic extents. Wrap main-axis hug has no definite line width and rejects. Fill directly inside wrapped flow is not admitted. Wrapped cross-axis hug measures actual line cross extents plus gaps/padding; stretch lines require fixed intrinsic cross children. Cyclic or excessive dependency chains reject before state/history replacement. Current capability flags/reasons reflect these restrictions, never a stored UI flag.

Transitioning hug/fill to fixed without an explicit numeric edit freezes evaluated geometry, including sizes over the former1e6 fixed cap; fixed size cap is aligned to the1e7 renderer bound. Root/output budgets and app window dimensions remain unchanged. The canonical source fixed-size numeric editor still advertises a1e6 limit; native/pinned host range alignment and control integration remain a separate gate, with no UI activation in this slice.

Variables and modes are durable document state (`variables` map ≤1024, `modes` ≤128, `active_mode`, `bindings` ≤4096), journaled and undone like any other mutation. `Variable.values` is sparse per mode; `describeVariables` resolves aliases per mode and reports coverage/alias diagnostics without mutating. Resolution follows the NYC-Tron `validateAlias` rules server-side on every write: alias chains must be acyclic, every hop target must share the root variable's type and carry a value in that mode, and the chain must terminate in a literal of the declared type. Whole-document validation runs inside `validate()`, so hostile restores are checked with the same rules under a shared 1,000,000-hop budget. `describeVariables` resolves aliases under a per-call memo keyed by (variable, mode), keeping dense alias documents linear per read.

Bindings never bake into nodes: `evaluateLayout`, `renderFrame`, `readAxisSizing` and the hug/fill freeze transition evaluate a transient effective-state overlay produced by `variables::effective`. In the overlay, `fill_*` channels resolve to rounded/clamped u8, `gap`/`padding_*` clamp to the authored 0..100000 bound, `x`/`y` replace local offsets (absolute placement only — flow children ignore them), and `width`/`height` apply only while the matching sizing axis stays `fixed` (never on the root canvas — `bindVariable` and `validate_variables` both reject root width/height paths); switching to hug/fill leaves the binding dormant rather than invalid. Unresolvable bindings (missing variable, no value in the active mode) fall back to authored values. Mutating ops still validate the authored state, so a binding that would overflow renderer bounds fails reads (`evaluateLayout`/`renderFrame`) but never bricks editing — the offending binding can always be removed. `describeVariables`/`listBindings` report the resolved number without range-checking it against layout bounds, so hosts should treat an out-of-domain resolved value as a pending layout-read failure, not valid geometry.

Node constraints are durable per-node state (`constraints:{horizontal,vertical,min_width?,max_width?,min_height?,max_height?,aspect_locked?,relative_to?}` inside the existing schema:2 wrapper — presence alone triggers the wrapper, no schema bump; C2 fields are additive serde defaults skipped when unset, so h/v-only constraints serialize byte-identically and old schema:2 readers fail closed on the new keys via `deny_unknown_fields` rather than silently dropping them). C1/C2 admit the NYC-Tron `DesignConstraints` contract minus `scale`, restricted to absolute children: `validate` rejects the root, any node whose parent uses flow layout, `scale` anchors, non-finite or out-of-range (0..=1e7) extent bounds, min exceeding max on an axis, and `relative_to` values outside the parent/sibling scope (self, unknown ids, the root from a non-root parent, and nodes under other parents all reject), each with a distinct reason, on both mutation and hostile restore. `aspect_locked` stores the NYC-Tron `aspectLocked` flag only; no ratio is persisted. Constraint solving is not implemented: `evaluateLayout`/`renderFrame` emit authored x/y regardless of stored constraints, `readConstraints` reports `solving:"storage-only"` and `enforced:false`, and x/y variable bindings remain the only position overlay — a node may carry both constraints and x/y bindings without conflict because constraints have no geometric effect yet. hug/fill sizing modes do not restrict constraint storage; constraint/sizing interplay is defined when the solver lands.

Components and instances (slice D, NYC-Tron L-01/L-05): `kind:"component"` is a frame-like definition node — it owns children and an optional flow layout, renders on canvas like a frame, and may carry `variants`, a list of named `{name,properties:[NodeOverride]}` bundles with unique names. `kind:"instance"` is a leaf storing `instance:{component,variant?,overrides?}`; it has no stored children or layout and fixed sizing only (instance hug/fill is deferred) — `setAxisSizing` rejects non-fixed modes on instances and `validate` rejects them on hostile restore too. An override is `{node,path,value}` where `node` is a template node id — the component root id targets the expanded instance root, descendant ids target that clone — `path` is one of `name|fill|x|y|width|height|visible|locked|text`, and `value` must match the path's scalar kind (`text` sets only content on a text target). `(node,path)` pairs must be unique per set, at most 64 variant bundles per component and 256 overrides per instance spec or variant bundle. Validation is whole-document on mutation and hostile restore: the component must exist and be a component, the variant must name a stored bundle, every override target must be the component root or a descendant, and removing/reparenting a targeted node or the component itself rejects while references would be stranded (clear overrides or remove instances first). The component-reference graph must be acyclic (Kahn check over reference edges plus ancestor→descendant containment edges — expansion clones a component's whole subtree including nested component definitions and their instances, so component-in-component nesting with a back reference rejects at validation rather than failing reads at the depth cap), which bounds expansion independent of the read caps.

Expansion is deterministic and read-only: `evaluateLayout`, `renderFrame` and `describeComponents` run `variables::effective` first (so bindings on template nodes resolve into clones) and then clone each instance's component subtree under synthetic ids `>= 2^53-1` in stored DFS order — template ids, children and clone sources always come from the pre-expansion node map, so in-place expansion of instances stored inside component subtrees cannot leak synthetic children into a later instance's template walk. Cloned `component` nodes have their variant override targets retargeted at the expansion's own clones. The instance node is wired as the materialized root (inheriting the component root's `children`/`layout` while keeping its own geometry/fill/visibility), the selected variant's properties and then the instance's overrides apply (instance values win on conflicts), and nested instance clones recurse. Bounds are `MAX_EXPANSION_DEPTH` 8 instance-nesting levels and `MAX_EXPANDED_NODES` 16384 clones per read; exceeding either fails `evaluateLayout`/`renderFrame` with an honest error while mutations remain possible so the document can be repaired, and `describeComponents` reports the bound message as each instance's `unavailable_reason`. The expanded form is never persisted: snapshots store only `InstanceSpec`, synthetic ids are not addressable by ops, and `detachInstance` is the single materialization path — it writes the expanded subtree as ordinary nodes (instance→frame keeping its id, descendants under fresh `next_id`s including re-identified variant targets on cloned component nodes, nested instances→frames) through the normal journal/undo pipeline, baking overrides, leaving variable bindings on the original template nodes rather than the clones, and expanding the whole document rather than only the detached cone (bounded by the same read caps). Deferred honestly: `group`/`layer` kinds, multi-axis variant properties, instance hug/fill sizing, component-root sizing propagation, overrides on the instance node's own stored fields (use `updateNode`), glyph text inside overrides beyond content, and UI control wiring pending the NYC-Tron `forge/design` release.

`__batch` (OP_BATCH) is supported: steps execute against a staged clone and commit as one journal entry/`document:changed` event only when the whole batch changes state; any step failure discards all staged mutations and preserves redo, and a net-unchanged batch emits no event. Batch steps return JSON only; binary output sidecars are rejected inside batches.

`renderFrame` has a payload/binary duality: a plain JSON apply returns `{width,height,pixels_b64}` with base64 RGBA in `data`; a command requesting binary output (`with_binary`) returns the raw RGBA bytes on the command output sidecar instead, with `{width,height}` metadata in `data`. Both paths run the same ephemeral Prism scene; no encoder or file delivery exists.

`readAxisSizing` is read-only and silent (no journal/event) but not free: each call runs a full sizing evaluation plus two whole-candidate validate+layout probes per axis, so cost is O(document) per invocation. Hosts should cache per revision rather than poll.

Text nodes (`kind:"text"`, schema-2 feature) carry a bounded `TextStyle` — `content` ≤64KiB UTF-8 admitting only `\n`/`\t` control characters, `font_family` 1..256 bytes without control chars, `font_size` finite in (0,1e4], `font_weight` integer1..1000, `font_style` `normal`|`italic`. They obey the same geometry/sizing/lock/tree rules as other leaf nodes and cannot own children or layout. Hug sizing uses a deterministic stub, not glyph metrics: width = longest `\n`-separated line's character count × font_size × 0.6, height = line count × font_size × 1.2 (minimum0.001 per axis). Real font metrics are a Prism/font gate; until then hug sizes text approximately. `renderFrame` marks text boxes `renderable:false` in `evaluateLayout`, skips all glyph work, and still draws the node's fill as a plain rect background. `addText` accepts optional `parent` (default root), required top-level `content`, and a font-only partial `style`; `updateNode` accepts a partial `text` patch merged over the current style; `text:null` is reserved and always rejected, and a `text` field combined with `locked` does not qualify as a lock-only unlock on a locked node.

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
| `findProfiles` | `{tolerance?}` | `{profiles:[{loops:[[entity ids]],area,centroid,bounds}],source_revision}`; deterministic closed-loop tracing, read-only. |
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

`findProfiles` traces closed loops over visible segments and analytic arcs without mutating state, journal or events; like `describe`/`evaluate`/`querySnap` it is a revision-bearing read and rejects inside atomic batches. `tolerance` is the world-unit endpoint coincidence radius, default1e-6, admitted range (0,1e6]. Only visible entities participate; hidden geometry is ignored exactly as in snaps/render. Segment ends are their authored point coordinates; partial-arc ends are the analytic start/end points; circles and full360° arcs expose no endpoints and each forms a standalone one-entity loop that can never join an open chain. Endpoint matching is pairwise within tolerance (not transitive clustering): a walk enters each edge at a matched end and leaves at its other end, closing when the arrival coordinate lies within tolerance of the walk's start coordinate. Matched ends may therefore differ by up to `tolerance` at every junction, not only at closure; the reported polygon treats each such gap as an implicit straight hop chord between the arrival coordinate and the next edge's entered end (arc ends are the analytic start/end points, never sampled nodes), and the final hop runs from the last arrival back to the walk's start vertex. At junctions the lowest document-order unused incident edge is followed, so figure-eights and ambiguous cycles resolve deterministically rather than enumerating all cycles; branches that dead-end are reported as open chains, not errors. Each entity belongs to at most one reported loop. Loops whose signed double-area magnitude is at or below1e-12 are dropped as zero-area (folded chains, figure-eight cancellation, coincident endpoints, and single-edge walks between near-coincident ends whose closing hop reverses the edge and self-cancels); their edges remain available to other starts.

Nesting groups loops into profiles: a loop whose first traced vertex (circle/arc center for closed loops) falls inside the smallest strictly larger loop's sampled polygon becomes an inner loop of that profile, recursively. Containment uses the same at-most-90° cubic node sampling as rendering, so near-tangent or interleaved non-convex arrangements are approximate but deterministic. Profile `loops` lists outermost first, then by depth and document order; entity ids inside each loop are in traversal order. `area` is the even-odd nesting sum of absolute loop areas (outer positive, holes negative, may be nonpositive for degenerate nesting); `centroid` is the outer loop's analytic centroid; `bounds` is the union of member loop bounds. Area and centroid are exact line integrals over the closed reported polygon: traversed segments contribute shoelace terms, arcs contribute analytic circular-segment integrals along their signed sweep (full circles yield πr² exactly), every implicit tolerance-hop chord contributes a straight segment term so the contour is exactly closed even when matched ends differ by up to `tolerance`, and bounds add exact quadrant-angle extremes inside each arc's sweep. Profiles sort by the earliest `order` position of any member entity. Defensive caps of128 profiles,128 edges per loop walk and128 total traced entities mirror the128-entity state budget and cannot bind under it; a walk that failed to close or exceeded its edge bound is abandoned as an open chain rather than rejected, and zero-area loops likewise never fail the query. This is bounded floating-point tracing for downstream consumers such as hatches, not a CAD kernel or exact-predicate guarantee.

Matching-reader safety: when any circle/arc exists or center/nearest_circle/tangent is enabled, snapshot JSON is `{kind:"draft",schema:2,document:<validated internal schema1 state>}` inside unchanged NFD1 framing. Legacy root required fields (units/points/etc.) are absent, so old readers fail rather than discard new geometry/settings. New readers accept strict Draft/schema2 wrappers or unchanged legacy state, reject unknown wrapper fields/kind/schema and reject unwrapped extended state. Empty circular maps plus false new flags retain the original legacy serialization. Describe/evaluate are current-source API state, not this persistence wrapper; native/checkpoint ordinals and global envelopes remain unchanged.
